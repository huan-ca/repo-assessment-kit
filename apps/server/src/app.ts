import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
import {
  approvalSchema,
  createRunBodySchema,
  decisionComparisonSchema,
  discoveryTopics,
  productClaimSchema,
  reviewInputSchema,
  runIdSchema,
  runStates,
  type Approval,
  type CapabilityResult,
  type ControlResult,
  type ErrorEnvelope,
  type EvidenceOccurrence,
  type Finding,
  type DeletionJobView,
  type PackageView,
  type ProductClaim,
  type Review,
  type RunDocument,
  type RunEvent,
  type SecretHandleView,
  type TargetSnapshot,
} from "@rak/contracts";
import { IdempotencyConflict, RakStore, requestDigest, type StoredRun } from "@rak/persistence";
import {
  WorkflowConflict,
  createBlockedCoverage,
  createDraftRun,
  createPhases,
  transitionRun,
} from "@rak/workflow";

export interface AppOptions {
  store?: RakStore;
  bootstrapToken?: string;
  now?: () => Date;
  nextId?: () => string;
  launcherProvider?: "codex" | "claude-code";
  hostOs?: "macos" | "linux";
  hostArch?: "arm64" | "x86_64";
  requireSession?: boolean;
  allowMissingOriginForInject?: boolean;
  publicOrigin?: string;
  snapshotResolver?: (run: StoredRun) => Promise<TargetSnapshot> | TargetSnapshot;
}

interface ActionBody {
  expectedRowVersion?: number;
  snapshotId?: string;
  reason?: string;
  recoveryPlanId?: string;
  retryAttemptIds?: string[];
}

function errorEnvelope(
  request: FastifyRequest,
  code: string,
  message: string,
  retryable = false,
  details: ErrorEnvelope["error"]["details"] = [],
): ErrorEnvelope {
  return { error: { code, message, requestId: request.id, retryable, details } };
}

function parseCursor(cursor: unknown): number {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string") throw new Error("INVALID_CURSOR");
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  const match = /^rak-page-v1:([0-9]+)$/.exec(decoded);
  if (!match) throw new Error("INVALID_CURSOR");
  return Number(match[1]);
}

function encodeCursor(offset: number): string {
  return Buffer.from(`rak-page-v1:${offset}`).toString("base64url");
}

function parsePageQuery(query: Record<string, unknown>): { offset: number; limit: number } {
  const offset = parseCursor(query["cursor"]);
  const rawLimit = query["limit"];
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("INVALID_LIMIT");
  return { offset, limit };
}

function page<T>(all: T[], query: Record<string, unknown>): { items: T[]; nextCursor?: string } {
  const { offset, limit } = parsePageQuery(query);
  const items = all.slice(offset, offset + limit);
  const next = offset + items.length;
  return next < all.length ? { items, nextCursor: encodeCursor(next) } : { items };
}

function rejectUnknownQuery(query: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(query).find((key) => !allowed.includes(key));
  if (unknown) throw new Error("UNKNOWN_QUERY");
}

function uuidV7(): string {
  const bytes = randomBytes(16);
  const milliseconds = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((milliseconds >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

function parseIfMatch(request: FastifyRequest): number {
  const header = request.headers["if-match"];
  const match = typeof header === "string" ? /^"([0-9]+)"$/.exec(header) : null;
  if (!match) throw new Error("ROW_VERSION_MISMATCH");
  return Number(match[1]);
}

export function createApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: false });
  const store = options.store ?? new RakStore(process.env["RAK_DATABASE_PATH"] ?? ":memory:");
  const bootstrapTokenHash = createHash("sha256")
    .update(
      options.bootstrapToken ??
        process.env["RAK_BOOTSTRAP_TOKEN"] ??
        randomBytes(32).toString("hex"),
    )
    .digest();
  const now = options.now ?? (() => new Date());
  const nextId = options.nextId ?? uuidV7;
  const publicOrigin = new URL(
    options.publicOrigin ?? process.env["RAK_PUBLIC_ORIGIN"] ?? "http://localhost:80",
  );
  if (
    !["http:", "https:"].includes(publicOrigin.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(publicOrigin.hostname) ||
    publicOrigin.username !== "" ||
    publicOrigin.password !== "" ||
    publicOrigin.pathname !== "/" ||
    publicOrigin.search !== "" ||
    publicOrigin.hash !== ""
  ) {
    throw new Error("PUBLIC_ORIGIN_MUST_BE_LOOPBACK");
  }
  const trustedOrigin = publicOrigin.origin;
  const trustedAuthority = publicOrigin.host;
  const trustedAuthorities = new Set([trustedAuthority]);
  if (publicOrigin.port === "") {
    trustedAuthorities.add(
      `${trustedAuthority}:${publicOrigin.protocol === "https:" ? "443" : "80"}`,
    );
  }
  const sessions = new Set<string>();
  const secretValues = new Map<string, Buffer>();
  const secretUploads = new Map<
    string,
    { handleId: string; runId: string; expiresAt: number; valueExpiresAt: number }
  >();
  let bootstrapConsumed = false;

  void app.register(cookie, { secret: randomBytes(32).toString("hex"), hook: "onRequest" });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 65_536 },
    (_request, body, done) => done(null, body),
  );
  app.decorate("rakStore", store);
  app.addHook("onClose", async () => {
    for (const value of secretValues.values()) value.fill(0);
    secretValues.clear();
    secretUploads.clear();
  });

  app.setErrorHandler((error, request, reply) => {
    let status = 500;
    let code = "INTERNAL_INVARIANT";
    const message = error instanceof Error ? error.message : "Unknown server error";
    if (
      error instanceof ZodError ||
      message === "INVALID_CURSOR" ||
      message === "INVALID_LIMIT" ||
      message === "UNKNOWN_QUERY"
    ) {
      status = 400;
      code = "SCHEMA_INVALID";
    } else if (error instanceof IdempotencyConflict) {
      status = 409;
      code = error.code;
    } else if (error instanceof WorkflowConflict || message === "RUN_STATE_CONFLICT") {
      status = 409;
      code = "RUN_STATE_CONFLICT";
    } else if (message === "ROW_VERSION_MISMATCH") {
      status = 412;
      code = "ROW_VERSION_MISMATCH";
    } else if (message === "DISCOVERY_INCOMPLETE") {
      status = 422;
      code = message;
    } else if (message === "SOURCE_HANDLE_INVALID") {
      status = 422;
      code = message;
    } else if (message === "REVIEW_GATES_INCOMPLETE") {
      status = 422;
      code = message;
    } else if (message === "SECRET_CHANNEL_REQUIRED") {
      status = 422;
      code = message;
    } else if (
      message === "APPROVAL_SCOPE_INVALID" ||
      message === "DELETION_CONFIRMATION_INVALID" ||
      message === "PACKAGE_VALIDATION_FAILED"
    ) {
      status = 422;
      code = message;
    } else if (message === "NOT_FOUND") {
      status = 404;
      code = "NOT_FOUND";
    }
    const details =
      error instanceof ZodError
        ? error.issues.map((issue) => ({ path: issue.path.join("."), reason: issue.message }))
        : [];
    return reply.code(status).send(errorEnvelope(request, code, message, false, details));
  });

  app.addHook("onRequest", async (request, reply) => {
    const localSurface =
      request.url.startsWith("/api/v1") ||
      request.url === "/health/live" ||
      request.url === "/health/ready";
    const rawAuthority = request.headers.host;
    if (
      localSurface &&
      (typeof rawAuthority !== "string" || !trustedAuthorities.has(rawAuthority))
    ) {
      await reply.code(403).send(errorEnvelope(request, "ORIGIN_DENIED", "Host is not trusted"));
      return;
    }
    if (
      localSurface &&
      request.headers.origin !== undefined &&
      request.headers.origin !== trustedOrigin
    ) {
      await reply.code(403).send(errorEnvelope(request, "ORIGIN_DENIED", "Origin is not trusted"));
      return;
    }
    if (
      !request.url.startsWith("/api/v1") ||
      request.url === "/api/v1/session/bootstrap" ||
      request.url.startsWith("/api/v1/secret-uploads/")
    )
      return;
    if (options.requireSession === false) return;
    const session = request.cookies["rak_session"];
    if (!session || !sessions.has(session)) {
      await reply
        .code(401)
        .send(errorEnvelope(request, "SESSION_REQUIRED", "A local session is required"));
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!["POST", "PUT", "DELETE"].includes(request.method)) return;
    if (
      request.url === "/api/v1/session/bootstrap" ||
      (request.url === "/api/v1/session" && request.method === "DELETE") ||
      request.url.startsWith("/api/v1/secret-uploads/")
    )
      return;
    const origin = request.headers.origin;
    if (
      (!origin && options.allowMissingOriginForInject !== true) ||
      (origin && origin !== trustedOrigin)
    ) {
      await reply
        .code(403)
        .send(errorEnvelope(request, "ORIGIN_DENIED", "Mutation origin does not match"));
      return;
    }
    if (!request.headers["idempotency-key"]) {
      await reply
        .code(400)
        .send(errorEnvelope(request, "SCHEMA_INVALID", "Idempotency-Key is required"));
    }
  });

  app.get("/health/live", async () => ({ status: "ok" as const }));
  app.get("/health/ready", async (_request, reply) => {
    return store.checkIntegrity()
      ? { status: "ready" as const }
      : reply.code(503).send({ status: "not-ready" as const, reason: "SQLite quick_check failed" });
  });

  app.post("/api/v1/session/bootstrap", async (request, reply) => {
    const body = z
      .object({ token: z.string().min(1) })
      .strict()
      .parse(request.body);
    const actual = createHash("sha256").update(body.token).digest();
    if (bootstrapConsumed || !timingSafeEqual(actual, bootstrapTokenHash)) {
      return reply
        .code(401)
        .send(
          errorEnvelope(request, "SESSION_TOKEN_INVALID", "Bootstrap token is invalid or consumed"),
        );
    }
    bootstrapConsumed = true;
    const session = randomBytes(32).toString("base64url");
    sessions.add(session);
    return reply
      .setCookie("rak_session", session, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: 12 * 60 * 60,
      })
      .code(204)
      .send();
  });

  app.delete("/api/v1/session", async (request, reply) => {
    const session = request.cookies["rak_session"];
    if (session) sessions.delete(session);
    return reply.clearCookie("rak_session", { path: "/" }).code(204).send();
  });

  app.get("/api/v1/system", async () => ({
    productVersion: "0.1.0",
    contractProfile: "rak-contract/1.0.0",
    workflowProfile: "rak-workflow/1.0.0",
    exportProfile: "rak-export-profile/1.0.0",
    launcherProvider: options.launcherProvider ?? "codex",
    hostOs: options.hostOs ?? (process.platform === "darwin" ? "macos" : "linux"),
    hostArch: options.hostArch ?? (process.arch === "arm64" ? "arm64" : "x86_64"),
    prerequisites: [],
  }));

  app.get("/api/v1/source-handles", async () => ({ items: store.listSourceHandles() }));

  app.post("/api/v1/runs", async (request, reply) => {
    const body = createRunBodySchema.parse(request.body);
    const sourceInput = body.source;
    const key = String(request.headers["idempotency-key"]);
    const replay = store.replayIdempotent("local-operator", "createRun", "-", key, body);
    if (replay) {
      const replayRun = replay.body as RunDocument;
      return reply.code(201).header("etag", `"${replayRun.rowVersion}"`).send(replay.body);
    }
    if (sourceInput.kind === "local") {
      const source = store
        .listSourceHandles()
        .find((item) => item.sourceHandleId === sourceInput.sourceHandleId);
      if (!source || source.kind !== "local") throw new Error("SOURCE_HANDLE_INVALID");
    } else {
      const source = store
        .listSourceHandles()
        .find((item) => item.sourceHandleId === sourceInput.sshHandleId);
      if (!source || source.kind !== "ssh") throw new Error("SOURCE_HANDLE_INVALID");
    }
    const current = now().toISOString();
    const run = createDraftRun({
      runId: `run_${nextId()}`,
      projectSlug: body.projectSlug,
      provider: body.provider,
      now: current,
    });
    const capabilities: CapabilityResult[] = [
      {
        capabilityId: "source-acquisition",
        scope: "run",
        declaredBy: ["registered-source-handle"],
        support: "supported",
        attestation: "passed",
        approval: "not-required",
        effective: "available",
        reasonCode: "SOURCE_HANDLE_REGISTERED",
        reason: "The selected source handle is registered for isolated acquisition.",
        evidenceOccurrenceIds: [],
        coverageEffects: [],
        checkedAt: current,
      },
      {
        capabilityId: "dynamic-runtime",
        scope: "run",
        declaredBy: ["runtime-capability-gate"],
        support: "unsupported",
        attestation: "missing",
        approval: "missing",
        effective: "blocked",
        reasonCode: "RUNTIME_NOT_ATTESTED",
        reason: "Native VM, broker, signer, and request-guard attestations have not passed.",
        evidenceOccurrenceIds: [],
        coverageEffects: ["runtime-readiness", "dynamic-browser-security"],
        checkedAt: current,
      },
    ];
    const coverage = createBlockedCoverage(run.runId, nextId).map((item) => {
      if (!["runtime-readiness", "dynamic-browser-security"].includes(item.domainId)) return item;
      return {
        ...item,
        status: "blocked" as const,
        plannedControls: 1,
        reconciledControls: 1,
        counts: { ...item.counts, blocked: 1 },
        limitationIds: [`lim_${item.domainId}`],
      };
    });
    const dynamicControl = {
      runId: run.runId,
      plannedControlId: "ctl_release_runtime_capability",
      profileId: "rak-baseline/1.0.0",
      controlId: "rak.runtime.capability-gate/1.0.0",
      title: "Authorized dynamic assessment capability",
      currentResult: {
        schemaVersion: "1.0.0" as const,
        controlResultId: `ctlr_${nextId()}`,
        runId: run.runId,
        plannedControlId: "ctl_release_runtime_capability",
        profileId: "rak-baseline/1.0.0",
        controlId: "rak.runtime.capability-gate/1.0.0",
        plannedScope: "dynamic-assessment",
        status: "blocked" as const,
        reasonCode: "RUNTIME_NOT_ATTESTED",
        reason: "Native VM, broker, signer, and request-guard attestations have not passed.",
        techniqueIds: [],
        evidenceOccurrenceIds: [],
        limitationId: "lim_dynamic-runtime",
        activityId: `act_${nextId()}`,
        completedAt: current,
      },
    };
    store.atomic(() => {
      store.createRun(
        {
          run,
          engagementId: body.engagementId,
          source: body.source,
          selectedProfiles: body.selectedProfiles,
          optionalServiceIds: body.optionalServiceIds,
        },
        createPhases(run.runId, nextId),
        makeEvent(store, run, current, "run.state.changed", "Draft assessment created"),
      );
      store.putObjects(
        run.runId,
        "capability",
        capabilities.map((item) => ({ ...item, runId: run.runId })),
        (item) => item.capabilityId,
      );
      store.putObjects(run.runId, "coverage", coverage, (item) => item.coverageId);
      store.putObjects(run.runId, "control", [dynamicControl], (item) => item.plannedControlId);
      store.recordLimitation({
        limitationId: "lim_dynamic-runtime",
        runId: run.runId,
        domain: "dynamic-browser-security",
        code: "RUNTIME_NOT_ATTESTED",
        reason: "The native hostile-runtime containment stack is unavailable or unattested.",
        effect: "Dynamic controls are blocked; static assessment remains eligible to run.",
        followUp: "Run the native runtime preflight or continue static-only.",
        createdAt: current,
      });
      store.saveIdempotent(
        "local-operator",
        "createRun",
        "-",
        key,
        body,
        { status: 201, body: run },
        addHours(now(), 24),
      );
    });
    return reply.code(201).header("etag", `"${run.rowVersion}"`).send(run);
  });

  app.get("/api/v1/runs", async (request) => {
    const query = request.query as Record<string, unknown>;
    rejectUnknownQuery(query, ["cursor", "limit", "state"]);
    const state = query["state"];
    if (state !== undefined && (!runStates.includes(state as never) || typeof state !== "string")) {
      throw new ZodError([
        { code: "custom", path: ["state"], message: "invalid run state", input: state },
      ]);
    }
    const { offset, limit } = parsePageQuery(query);
    const rows = store.listRuns(state as string | undefined, limit + 1, offset);
    const items = rows.slice(0, limit);
    return rows.length > limit ? { items, nextCursor: encodeCursor(offset + limit) } : { items };
  });

  app.get("/api/v1/runs/:runId", async (request) => {
    const { runId } = request.params as { runId: string };
    const record = requiredRun(store, runId);
    return {
      run: record.run,
      phases: store.getPhases(runId),
      currentCapabilities: store.listCapabilities(runId),
      coverageSummary: store.listCoverage(runId),
    };
  });

  app.put("/api/v1/runs/:runId/discovery", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const claims = z
      .object({ claims: z.array(productClaimSchema) })
      .strict()
      .parse(request.body).claims as unknown as ProductClaim[];
    if (claims.some((claim) => claim.runId !== runId)) throw new Error("SCHEMA_INVALID");
    const response = mutateDraft(store, request, runId, "putDiscovery", { claims }, now, (run) => {
      store.putObjects(runId, "claim", claims, (claim) => claim.claimId);
      return { claims, rowVersion: run.rowVersion + 1 };
    });
    return reply.header("etag", `"${response.rowVersion}"`).send(response);
  });

  app.put("/api/v1/runs/:runId/approvals", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const approvals = z
      .object({ approvals: z.array(approvalSchema) })
      .strict()
      .parse(request.body).approvals as unknown as Approval[];
    if (approvals.some((approval) => approval.runId !== runId)) throw new Error("SCHEMA_INVALID");
    const response = mutateDraft(
      store,
      request,
      runId,
      "putApprovals",
      { approvals },
      now,
      (run) => {
        store.putObjects(runId, "approval", approvals, (approval) => approval.approvalId);
        const capabilities = recomputeCapabilities(
          store.listCapabilities(runId),
          approvals,
          now().toISOString(),
        );
        store.putObjects(
          runId,
          "capability",
          capabilities.map((item) => ({ ...item, runId })),
          (item) => item.capabilityId,
        );
        return { approvals, capabilities, rowVersion: run.rowVersion + 1 };
      },
    );
    return reply.header("etag", `"${response.rowVersion}"`).send(response);
  });

  app.post("/api/v1/runs/:runId/secrets", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = z
      .object({
        purpose: z.enum(["target-service", "probe"]),
        recipient: z.string().min(1).max(200),
        approvalId: z.string().min(1).optional(),
        expiresAt: z
          .string()
          .datetime({ offset: false })
          .refine((value) => Date.parse(value) > now().getTime(), "expiry must be in the future"),
      })
      .strict()
      .parse(request.body);
    if (
      body.approvalId &&
      !store.listApprovals(runId).some((approval) => approval.approvalId === body.approvalId)
    ) {
      throw new Error("APPROVAL_SCOPE_INVALID");
    }
    const handleId = `sec_${nextId()}`;
    const uploadToken = randomBytes(32).toString("base64url");
    const uploadTokenExpiresAt = new Date(
      Math.min(Date.parse(body.expiresAt), now().getTime() + 5 * 60_000),
    ).toISOString();
    const response = mutateDraft(store, request, runId, "createSecret", body, now, (run) => {
      store.createSecretMetadata({
        secretHandleId: handleId,
        runId,
        purpose: body.purpose,
        recipient: body.recipient,
        ...(body.approvalId ? { approvalId: body.approvalId } : {}),
        expiresAt: body.expiresAt,
        createdAt: now().toISOString(),
      });
      secretUploads.set(uploadToken, {
        handleId,
        runId,
        expiresAt: Date.parse(uploadTokenExpiresAt),
        valueExpiresAt: Date.parse(body.expiresAt),
      });
      const handle: SecretHandleView = {
        secretHandleId: handleId,
        purpose: body.purpose,
        recipient: body.recipient,
        expiresAt: body.expiresAt,
        uploaded: false,
        remainingUses: 1,
      };
      return {
        handle,
        uploadPath: `/api/v1/secret-uploads/${uploadToken}`,
        uploadTokenExpiresAt,
        rowVersion: run.rowVersion + 1,
      };
    });
    return reply.code(201).header("etag", `"${response.rowVersion}"`).send({
      handle: response.handle,
      uploadPath: response.uploadPath,
      uploadTokenExpiresAt: response.uploadTokenExpiresAt,
    });
  });

  app.put("/api/v1/secret-uploads/:uploadToken", async (request, reply) => {
    const { uploadToken } = request.params as { uploadToken: string };
    const upload = secretUploads.get(uploadToken);
    if (!upload || upload.expiresAt <= now().getTime()) {
      secretUploads.delete(uploadToken);
      throw new Error("NOT_FOUND");
    }
    const declaredLength = Number(request.headers["content-length"]);
    const bytes = request.body;
    if (
      !Buffer.isBuffer(bytes) ||
      !Number.isInteger(declaredLength) ||
      declaredLength < 1 ||
      declaredLength > 65_536 ||
      bytes.byteLength !== declaredLength
    ) {
      return reply
        .code(400)
        .send(errorEnvelope(request, "SCHEMA_INVALID", "Secret length is invalid"));
    }
    secretUploads.delete(uploadToken);
    secretValues.set(upload.handleId, Buffer.from(bytes));
    store.setSecretState(upload.handleId, "UPLOADED", now().toISOString());
    setTimeout(
      () => {
        const value = secretValues.get(upload.handleId);
        value?.fill(0);
        secretValues.delete(upload.handleId);
      },
      Math.min(2_147_483_647, Math.max(0, upload.valueExpiresAt - now().getTime())),
    ).unref();
    return reply.code(204).send();
  });

  app.delete("/api/v1/runs/:runId/secrets/:handleId", async (request, reply) => {
    const { runId, handleId } = request.params as { runId: string; handleId: string };
    const response = mutateDraft(store, request, runId, "revokeSecret", null, now, (run) => {
      const belongs = store.database
        .prepare("SELECT 1 FROM secret_handles WHERE id=? AND run_id=?")
        .get(handleId, runId);
      if (!belongs) throw new Error("NOT_FOUND");
      const value = secretValues.get(handleId);
      value?.fill(0);
      secretValues.delete(handleId);
      for (const [token, upload] of secretUploads) {
        if (upload.handleId === handleId) secretUploads.delete(token);
      }
      store.setSecretState(handleId, "REVOKED", now().toISOString());
      return { rowVersion: run.rowVersion + 1 };
    });
    return reply.header("etag", `"${response.rowVersion}"`).code(204).send();
  });

  app.post("/api/v1/runs/:runId/revisions", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = z
      .object({ reason: z.string().min(1), copyDiscovery: z.boolean() })
      .strict()
      .parse(request.body);
    const key = String(request.headers["idempotency-key"]);
    const replay = store.replayIdempotent("local-operator", "createRevision", runId, key, body);
    if (replay) return reply.code(201).header("etag", '"0"').send(replay.body);
    const parent = requiredRun(store, runId);
    if (parseIfMatch(request) !== parent.run.rowVersion) throw new Error("ROW_VERSION_MISMATCH");
    const current = now().toISOString();
    const revision = createDraftRun({
      runId: `run_${nextId()}`,
      parentRunId: runId,
      projectSlug: parent.run.projectSlug,
      provider: parent.run.provider,
      revision: parent.run.revision + 1,
      now: current,
    });
    store.atomic(() => {
      store.createRun(
        { ...parent, run: revision },
        createPhases(revision.runId, nextId),
        makeEvent(store, revision, current, "run.state.changed", "Successor revision created"),
      );
      if (body.copyDiscovery) {
        const copied = store.listClaims(runId).map((claim) => ({
          ...claim,
          runId: revision.runId,
          revision: 1,
          supersedesClaimId: claim.claimId,
        }));
        store.putObjects(revision.runId, "claim", copied, (claim) => claim.claimId);
      }
      store.saveIdempotent(
        "local-operator",
        "createRevision",
        runId,
        key,
        body,
        { status: 201, body: revision },
        addHours(now(), 24),
      );
    });
    return reply.code(201).header("etag", '"0"').send(revision);
  });

  const action = (
    path: string,
    operation: string,
    allowed: readonly RunDocument["state"][],
    to: RunDocument["state"],
    bodySchema: z.ZodType,
    validate: (body: ActionBody, run: RunDocument) => void = () => undefined,
    effect: (updated: RunDocument) => void = () => undefined,
    afterAccept: (runId: string) => Promise<void> | void = () => undefined,
  ) => {
    app.post(path, async (request, reply) => {
      const { runId } = request.params as { runId: string };
      const body = bodySchema.parse(request.body ?? {}) as ActionBody;
      const result = mutateAction(
        store,
        request,
        runId,
        operation,
        body,
        allowed,
        to,
        now,
        nextId,
        validate,
        effect,
      );
      await afterAccept(runId);
      return reply.code(202).header("etag", `"${result.rowVersion}"`).send(result);
    });
  };
  action(
    "/api/v1/runs/:runId/actions/resolve-target",
    "resolveTarget",
    ["DRAFT"],
    "RESOLVING_TARGET",
    z.object({ expectedRowVersion: z.number().int().nonnegative() }).strict(),
    (body, run) => {
      if (body.expectedRowVersion !== run.rowVersion) throw new Error("ROW_VERSION_MISMATCH");
      const claims = store.listClaims(run.runId);
      if (
        claims.length !== discoveryTopics.length ||
        new Set(claims.map((claim) => claim.topic)).size !== discoveryTopics.length
      )
        throw new Error("DISCOVERY_INCOMPLETE");
    },
    () => undefined,
    async (runId) => {
      const record = requiredRun(store, runId);
      if (!options.snapshotResolver) {
        store.recordLimitation({
          limitationId: "lim_target-resolution-unresolved",
          runId,
          domain: "repository-composition",
          code: "TARGET_RESOLVER_UNAVAILABLE",
          reason: "No trusted acquisition worker is connected.",
          effect: "Target identity and source integrity remain unresolved; execution cannot start.",
          followUp:
            "Connect the typed acquisition worker and retry with a successor run if needed.",
          createdAt: now().toISOString(),
        });
        store.surfaceLimitation(runId, "lim_target-resolution-unresolved", now().toISOString());
        return;
      }
      try {
        const snapshot = await options.snapshotResolver(record);
        store.admitSnapshot(runId, snapshot, now().toISOString());
      } catch (error) {
        store.recordLimitation({
          limitationId: "lim_target-resolution-failed",
          runId,
          domain: "repository-composition",
          code: "TARGET_RESOLUTION_FAILED",
          reason: error instanceof Error ? error.message : "Target resolution failed.",
          effect: "No immutable snapshot was admitted; execution cannot start.",
          followUp: "Inspect the acquisition worker receipt and retry safely.",
          createdAt: now().toISOString(),
        });
        store.surfaceLimitation(runId, "lim_target-resolution-failed", now().toISOString());
      }
    },
  );
  action(
    "/api/v1/runs/:runId/actions/start",
    "startRun",
    ["READY"],
    "EXECUTING",
    z.object({ snapshotId: z.string().min(1) }).strict(),
    (body, run) => {
      if (!body.snapshotId || body.snapshotId !== run.targetSnapshotId)
        throw new Error("RUN_STATE_CONFLICT");
    },
    (updated) => {
      const phase = store
        .getPhases(updated.runId)
        .find((candidate) => candidate.phaseKey === "static-inventory");
      const snapshot = store.getSnapshot(updated.runId);
      if (!phase || !snapshot) throw new Error("RUN_STATE_CONFLICT");
      store.queueAttempt({
        attemptId: `att_${nextId()}`,
        runId: updated.runId,
        phaseId: phase.phaseId,
        attemptNumber: 1,
        state: "QUEUED",
        inputDigest: requestDigest({
          snapshotId: snapshot.snapshotId,
          manifestDigest: snapshot.manifestDigest,
          workflowProfile: updated.workflowProfile,
          exportProfile: updated.exportProfile,
        }),
        fenceToken: 1,
        createdAt: now().toISOString(),
      });
    },
  );
  action(
    "/api/v1/runs/:runId/actions/pause",
    "pauseRun",
    ["EXECUTING", "WAITING_INPUT"],
    "PAUSING",
    z.object({ reason: z.string().min(1) }).strict(),
  );
  action(
    "/api/v1/runs/:runId/actions/resume",
    "resumeRun",
    ["PAUSED", "RECOVERABLE_FAILURE"],
    "EXECUTING",
    z
      .object({
        recoveryPlanId: z.string().min(1),
        retryAttemptIds: z.array(z.string()),
      })
      .strict(),
  );
  action(
    "/api/v1/runs/:runId/actions/cancel",
    "cancelRun",
    runStates.filter(
      (state) => !["COMPLETED", "CANCELLED", "FAILED", "CANCELLING"].includes(state),
    ),
    "CANCELLING",
    z.object({ reason: z.string().min(1) }).strict(),
    () => undefined,
    (updated) => {
      const revokedHandleIds = store.revokeRunSecrets(updated.runId, now().toISOString());
      for (const handleId of revokedHandleIds) {
        const value = secretValues.get(handleId);
        value?.fill(0);
        secretValues.delete(handleId);
      }
      for (const [token, upload] of secretUploads) {
        if (upload.runId === updated.runId) secretUploads.delete(token);
      }
      if (updated.state === "DRAFT") return;
      store.queueCleanup({
        cleanupId: `cln_${nextId()}`,
        runId: updated.runId,
        reason: "Operator cancellation requested",
        createdAt: now().toISOString(),
      });
    },
  );
  action(
    "/api/v1/runs/:runId/actions/runtime-gate",
    "rerunRuntimeGate",
    ["EXECUTING", "WAITING_INPUT"],
    "EXECUTING",
    z.object({}).strict(),
    () => undefined,
    (updated) => {
      const refreshed = store.listCapabilities(updated.runId).map((capability) =>
        capability.capabilityId === "dynamic-runtime"
          ? {
              ...capability,
              effective: "blocked" as const,
              reasonCode: "RUNTIME_NOT_ATTESTED",
              reason:
                "Native VM, broker, signer, and request-guard attestations remain unavailable.",
              checkedAt: now().toISOString(),
            }
          : capability,
      );
      store.putObjects(
        updated.runId,
        "capability",
        refreshed.map((item) => ({ ...item, runId: updated.runId })),
        (item) => item.capabilityId,
      );
    },
  );
  action(
    "/api/v1/runs/:runId/actions/validate",
    "validateRun",
    ["EXECUTING"],
    "VALIDATING",
    z.object({}).strict(),
  );
  action(
    "/api/v1/runs/:runId/packages",
    "createPackage",
    ["REVIEW_REQUIRED"],
    "PACKAGING",
    z
      .object({
        encryption: z
          .union([
            z.object({ mode: z.literal("x25519"), recipient: z.string().min(1) }).strict(),
            z.object({ mode: z.literal("scrypt") }).strict(),
          ])
          .optional(),
      })
      .strict(),
    (body, run) => {
      if ((body as { encryption?: { mode: string } }).encryption?.mode === "scrypt") {
        throw new Error("SECRET_CHANNEL_REQUIRED");
      }
      const decisionRaw = store.getObject<unknown>(run.runId, "decision", "current");
      const decision = decisionRaw ? decisionComparisonSchema.safeParse(decisionRaw) : undefined;
      const reviews = store.listObjects<{ kind: string; verdict: string }>(run.runId, "review");
      const requiredReviews = new Set([
        "independent-security",
        "independent-decision",
        "technical-human",
        "lay-human",
      ]);
      const reviewsPass = [...requiredReviews].every((kind) =>
        reviews.some(
          (review) =>
            review.kind === kind &&
            (review.verdict === "passed" || review.verdict === "passed-with-objections"),
        ),
      );
      const coverageReconciled = store
        .listCoverage(run.runId)
        .every((item) => item.plannedControls === item.reconciledControls);
      if (!decision?.success || !reviewsPass || !coverageReconciled)
        throw new Error("REVIEW_GATES_INCOMPLETE");
    },
    (updated) => {
      const packageView: PackageView & { runId: string } = {
        packageId: `pkg_${nextId()}`,
        runId: updated.runId,
        revision: updated.revision,
        state: "REQUESTED",
      };
      store.putObjects(updated.runId, "package", [packageView], (item) => item.packageId);
    },
  );

  app.get("/api/v1/runs/:runId/capabilities", async (request) => {
    const { runId } = request.params as { runId: string };
    requiredRun(store, runId);
    return { items: store.listCapabilities(runId) };
  });
  app.get("/api/v1/runs/:runId/coverage", async (request) => {
    const { runId } = request.params as { runId: string };
    requiredRun(store, runId);
    const items = store.listCoverage(runId);
    return { items, limitationIds: [...new Set(items.flatMap((item) => item.limitationIds))] };
  });
  app.get("/api/v1/runs/:runId/controls", async (request) => {
    const { runId } = request.params as { runId: string };
    requiredRun(store, runId);
    const query = request.query as Record<string, unknown>;
    rejectUnknownQuery(query, ["cursor", "limit", "status", "profileId"]);
    const items = store.listObjects<{
      plannedControlId: string;
      profileId: string;
      controlId: string;
      title: string;
      currentResult?: ControlResult;
    }>(runId, "control");
    return page(
      items
        .filter((item) => !query["status"] || item.currentResult?.status === query["status"])
        .filter((item) => !query["profileId"] || item.profileId === query["profileId"]),
      query,
    );
  });
  app.get("/api/v1/runs/:runId/findings", async (request) => {
    const { runId } = request.params as { runId: string };
    requiredRun(store, runId);
    const query = request.query as Record<string, unknown>;
    rejectUnknownQuery(query, ["cursor", "limit", "severity", "validationState", "domainId"]);
    return page(
      store
        .listFindings(runId)
        .filter((item) => !query["severity"] || item.technicalSeverity === query["severity"])
        .filter(
          (item) => !query["validationState"] || item.validationState === query["validationState"],
        )
        .filter(
          (item) =>
            !query["domainId"] ||
            (item as Finding & { domainId?: string }).domainId === query["domainId"],
        ),
      query,
    );
  });
  app.get("/api/v1/runs/:runId/findings/:findingId", async (request) => {
    const { runId, findingId } = request.params as { runId: string; findingId: string };
    requiredRun(store, runId);
    const finding = store.getObject<Finding>(runId, "finding", findingId);
    if (!finding) throw new Error("NOT_FOUND");
    const evidence = finding.evidenceOccurrenceIds
      .map((id) => store.getObject<EvidenceOccurrence>(runId, "evidence", id))
      .filter((item): item is EvidenceOccurrence => item !== undefined);
    return { finding, evidence, controls: [], reviews: [] };
  });
  app.get("/api/v1/runs/:runId/evidence", async (request) => {
    const { runId } = request.params as { runId: string };
    requiredRun(store, runId);
    const query = request.query as Record<string, unknown>;
    rejectUnknownQuery(query, ["cursor", "limit", "type", "sensitivity", "validationState"]);
    return page(
      store
        .listEvidence(runId)
        .filter((item) => !query["type"] || item.evidenceType === query["type"])
        .filter((item) => !query["sensitivity"] || item.sensitivity === query["sensitivity"])
        .filter(
          (item) => !query["validationState"] || item.validationState === query["validationState"],
        ),
      query,
    );
  });
  app.get("/api/v1/runs/:runId/evidence/:evidenceId", async (request) => {
    const { runId, evidenceId } = request.params as { runId: string; evidenceId: string };
    requiredRun(store, runId);
    const occurrence = store.getObject<EvidenceOccurrence>(runId, "evidence", evidenceId);
    if (!occurrence) throw new Error("NOT_FOUND");
    return {
      occurrence,
      previewAvailable:
        store.getObject<unknown>(runId, "evidence-preview", evidenceId) !== undefined,
      downloadAvailable:
        store.getObject<unknown>(runId, "evidence-download", evidenceId) !== undefined,
    };
  });
  app.get("/api/v1/runs/:runId/evidence/:evidenceId/preview", async (request, reply) => {
    const { runId, evidenceId } = request.params as { runId: string; evidenceId: string };
    requiredRun(store, runId);
    const occurrence = store.getObject<EvidenceOccurrence>(runId, "evidence", evidenceId);
    if (
      !occurrence ||
      occurrence.validationState !== "validated" ||
      !["none-required", "redacted"].includes(occurrence.redactionState)
    )
      throw new Error("NOT_FOUND");
    const previewRaw = store.getObject<unknown>(runId, "evidence-preview", evidenceId);
    if (!previewRaw) throw new Error("NOT_FOUND");
    const preview = z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("escaped-text"),
            mediaType: z.literal("text/plain"),
            text: z.string().max(1_048_576),
            truncated: z.boolean(),
            derivativeEvidenceId: z.string().min(1),
          })
          .strict(),
        z
          .object({
            kind: z.literal("reencoded-image"),
            mediaType: z.enum(["image/png", "image/jpeg"]),
            path: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\).+$/),
            width: z.number().int().positive().max(20_000),
            height: z.number().int().positive().max(20_000),
            derivativeEvidenceId: z.string().min(1),
          })
          .strict(),
      ])
      .parse(previewRaw);
    return reply
      .header("x-content-type-options", "nosniff")
      .header("cross-origin-resource-policy", "same-origin")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "no-store")
      .send(preview);
  });
  app.get("/api/v1/runs/:runId/evidence/:evidenceId/download", async (request, reply) => {
    const { runId, evidenceId } = request.params as { runId: string; evidenceId: string };
    requiredRun(store, runId);
    const occurrence = store.getObject<EvidenceOccurrence>(runId, "evidence", evidenceId);
    if (
      !occurrence ||
      occurrence.validationState !== "validated" ||
      !["none-required", "redacted"].includes(occurrence.redactionState)
    )
      throw new Error("NOT_FOUND");
    const downloadRaw = store.getObject<unknown>(runId, "evidence-download", evidenceId);
    if (!downloadRaw) throw new Error("NOT_FOUND");
    const download = z
      .object({
        bytesBase64: z.string().min(1),
        mediaType: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
        byteLength: z.string().regex(/^[0-9]+$/),
        sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict()
      .parse(downloadRaw);
    const bytes = Buffer.from(download.bytesBase64, "base64");
    if (
      String(bytes.byteLength) !== download.byteLength ||
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== download.sha256
    )
      throw new Error("INTERNAL_INVARIANT");
    return reply
      .header("content-type", download.mediaType)
      .header("x-content-type-options", "nosniff")
      .header("cross-origin-resource-policy", "same-origin")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "no-store")
      .header("content-disposition", `attachment; filename="${evidenceId}"`)
      .send(bytes);
  });
  app.get("/api/v1/runs/:runId/decision", async (request) => {
    const { runId } = request.params as { runId: string };
    requiredRun(store, runId);
    const decision = store.getObject<unknown>(runId, "decision", "current");
    if (!decision) throw new Error("NOT_FOUND");
    return decisionComparisonSchema.parse(decision);
  });
  app.post("/api/v1/runs/:runId/reviews", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = reviewInputSchema.parse(request.body);
    const response = mutateState(
      store,
      request,
      runId,
      "createReview",
      body,
      ["REVIEW_REQUIRED"],
      now,
      (run) => {
        if (!run.targetSnapshotId) throw new Error("RUN_STATE_CONFLICT");
        const reviewId = `rev_${nextId()}`;
        const evidenceId = `evd_${nextId()}`;
        const completedAt = now().toISOString();
        const occurrence: EvidenceOccurrence & { runId: string } = {
          schemaVersion: "1.0.0",
          evidenceId,
          runId,
          blobId: `blb_${nextId()}`,
          evidenceType: "human-review-record",
          title: `${body.kind} review record`,
          snapshotId: run.targetSnapshotId,
          activityId: `act_${nextId()}`,
          capturedAt: completedAt,
          sensitivity: "customer-confidential",
          redactionState: "none-required",
          validationState: "validated",
          collectionLimitations: [],
          derivedFromEvidenceIds: body.itemResults.flatMap((item) => item.evidenceOccurrenceIds),
          linkedClaimIds: [],
          linkedFindingIds: [],
          linkedControlIds: [],
        };
        store.putObjects(runId, "evidence", [occurrence], (item) => item.evidenceId);
        const review: Review & { runId: string } = {
          schemaVersion: "1.0.0",
          reviewId,
          runId,
          kind: body.kind,
          reviewerAgentId: `agt_${body.reviewerRole.replaceAll(/[^a-z0-9-]/gi, "-")}`,
          inputDigest: body.inputDigest,
          verdict: body.verdict,
          itemResults: body.itemResults.map((item) => ({
            itemId: item.itemId,
            outcome: item.outcome,
            evidenceOccurrenceIds: item.evidenceOccurrenceIds,
            ...(item.objection ? { objection: item.objection } : {}),
          })),
          acceptedCorrectionIds: [],
          limitationIds: [],
          reviewEvidenceId: evidenceId,
          completedAt,
        };
        store.putReview(runId, review);
        return { review, rowVersion: run.rowVersion + 1 };
      },
    );
    return reply.code(201).header("etag", `"${response.rowVersion}"`).send(response);
  });
  app.get("/api/v1/runs/:runId/packages", async (request) => {
    const { runId } = request.params as { runId: string };
    requiredRun(store, runId);
    return { items: store.listPackages(runId) };
  });
  app.get("/api/v1/runs/:runId/packages/:packageId/digest", async (request, reply) => {
    const { runId, packageId } = request.params as { runId: string; packageId: string };
    requiredRun(store, runId);
    const validated = store.getValidatedPackage(runId, packageId);
    if (!validated?.view.zipSha256) throw new Error("NOT_FOUND");
    return reply
      .header("x-content-type-options", "nosniff")
      .header("cross-origin-resource-policy", "same-origin")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "no-store")
      .type("text/plain")
      .send(`${validated.view.zipSha256}\n`);
  });
  app.get("/api/v1/runs/:runId/packages/:packageId/download", async (request, reply) => {
    const { runId, packageId } = request.params as { runId: string; packageId: string };
    requiredRun(store, runId);
    const validated = store.getValidatedPackage(runId, packageId);
    if (!validated?.view.zipSha256 || !validated.view.zipByteLength) throw new Error("NOT_FOUND");
    const bytes = readFileSync(validated.artifactPath);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (
      digest !== validated.view.zipSha256 ||
      String(bytes.byteLength) !== validated.view.zipByteLength
    )
      throw new Error("PACKAGE_VALIDATION_FAILED");
    return reply
      .type("application/zip")
      .header("x-content-type-options", "nosniff")
      .header("cross-origin-resource-policy", "same-origin")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "no-store")
      .header("content-disposition", `attachment; filename="${packageId}.zip"`)
      .send(bytes);
  });

  app.post("/api/v1/runs/:runId/deletion", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = z
      .object({
        scope: z.enum(["internal-only", "run-except-packages", "entire-run"]),
        includePackages: z.boolean(),
        projectSlugConfirmation: z.string(),
        packageDigestConfirmations: z.array(z.string().regex(/^sha256:[0-9a-f]{64}$/)),
      })
      .strict()
      .parse(request.body);
    const response = mutateState(
      store,
      request,
      runId,
      "requestRunDeletion",
      body,
      ["COMPLETED", "CANCELLED", "FAILED"],
      now,
      (run) => {
        if (
          body.projectSlugConfirmation !== run.projectSlug ||
          body.includePackages !== (body.scope === "entire-run")
        ) {
          throw new Error("DELETION_CONFIRMATION_INVALID");
        }
        const packageDigests = store
          .listPackages(runId)
          .flatMap((item) => (item.zipSha256 ? [item.zipSha256] : []))
          .sort();
        if (
          body.includePackages &&
          JSON.stringify([...body.packageDigestConfirmations].sort()) !==
            JSON.stringify(packageDigests)
        ) {
          throw new Error("DELETION_CONFIRMATION_INVALID");
        }
        const deletionJobId = `del_${nextId()}`;
        const job: DeletionJobView = {
          deletionJobId,
          runId,
          scope: body.scope,
          state: "REQUESTED",
          removedClasses: [],
          recoveryPossible: false,
        };
        store.putDeletionJob(runId, job);
        return { deletionJobId, rowVersion: run.rowVersion + 1 };
      },
    );
    return reply.code(202).header("etag", `"${response.rowVersion}"`).send(response);
  });

  app.get("/api/v1/runs/:runId/deletions/:deletionJobId", async (request) => {
    const { runId, deletionJobId } = request.params as {
      runId: string;
      deletionJobId: string;
    };
    requiredRun(store, runId);
    const job = store.getDeletionJob<DeletionJobView>(runId, deletionJobId);
    if (!job) throw new Error("NOT_FOUND");
    return job;
  });

  app.post("/api/v1/runs/:runId/deletions/:deletionJobId/restore", async (request, reply) => {
    const { runId, deletionJobId } = request.params as {
      runId: string;
      deletionJobId: string;
    };
    const body = z
      .object({
        projectSlugConfirmation: z.string(),
        trashPathDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict()
      .parse(request.body);
    const response = mutateState(
      store,
      request,
      runId,
      "restoreRunDeletion",
      body,
      ["COMPLETED", "CANCELLED", "FAILED"],
      now,
      (run) => {
        const job = store.getDeletionJob<DeletionJobView>(runId, deletionJobId);
        if (
          !job ||
          job.state !== "TRASHED" ||
          !job.recoveryPossible ||
          job.trashPathDigest !== body.trashPathDigest ||
          run.projectSlug !== body.projectSlugConfirmation
        ) {
          throw new Error("DELETION_CONFIRMATION_INVALID");
        }
        const restoring: DeletionJobView = { ...job, state: "RESTORING" };
        store.putDeletionJob(runId, restoring);
        return { deletionJobId, state: "RESTORING" as const, rowVersion: run.rowVersion + 1 };
      },
    );
    return reply.code(202).header("etag", `"${response.rowVersion}"`).send(response);
  });

  app.get("/api/v1/runs/:runId/events", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    requiredRun(store, runId);
    const lastHeader = request.headers["last-event-id"];
    if (
      lastHeader !== undefined &&
      (typeof lastHeader !== "string" || !/^[0-9]+$/.test(lastHeader))
    ) {
      return reply
        .code(400)
        .send(errorEnvelope(request, "SCHEMA_INVALID", "Last-Event-ID must be a sequence"));
    }
    let last = Number(lastHeader ?? 0);
    const minimum = Number(
      store.database
        .prepare("SELECT MIN(sequence) FROM run_events WHERE run_id=?")
        .pluck()
        .get(runId) ?? 0,
    );
    if (last > 0 && minimum > 0 && last < minimum - 1) {
      const envelope = errorEnvelope(
        request,
        "EVENT_HISTORY_EXPIRED",
        "Requested event history is no longer retained",
      );
      envelope.error.operatorAction =
        "Refetch getRun, getCapabilities, listCoverage, listFindings, listEvidence, and listPackages.";
      return reply.code(410).send(envelope);
    }
    const events = store.listEvents(runId, last);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
    });
    for (const event of events) {
      reply.raw.write(
        `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
      last = Number(event.sequence);
    }
    const poll = setInterval(() => {
      try {
        for (const event of store.listEvents(runId, last)) {
          reply.raw.write(
            `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
          last = Number(event.sequence);
        }
      } catch {
        reply.raw.end();
      }
    }, 1_000);
    const heartbeat = setInterval(() => reply.raw.write(`: heartbeat ${Date.now()}\n\n`), 15_000);
    poll.unref();
    heartbeat.unref();
    reply.raw.once("close", () => {
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  });

  return app;
}

function requiredRun(store: RakStore, runId: string) {
  runIdSchema.parse(runId);
  const record = store.getRun(runId);
  if (!record) throw new Error("NOT_FOUND");
  return record;
}

function makeEvent(
  store: RakStore,
  run: RunDocument,
  occurredAt: string,
  type: RunEvent["type"],
  summary: string,
): RunEvent {
  return {
    schemaVersion: "1.0.0",
    sequence: store.nextSequence(run.runId),
    runId: run.runId,
    rowVersion: run.rowVersion,
    type,
    occurredAt,
    summary,
  };
}

function mutateDraft<T>(
  store: RakStore,
  request: FastifyRequest,
  runId: string,
  operation: string,
  body: unknown,
  now: () => Date,
  mutation: (run: RunDocument) => T & { rowVersion: number },
): T & { rowVersion: number } {
  const key = String(request.headers["idempotency-key"]);
  const replay = store.replayIdempotent("local-operator", operation, runId, key, body);
  if (replay) return replay.body as T & { rowVersion: number };
  const record = requiredRun(store, runId);
  if (parseIfMatch(request) !== record.run.rowVersion) throw new Error("ROW_VERSION_MISMATCH");
  if (record.run.state !== "DRAFT") throw new Error("RUN_STATE_CONFLICT");
  return store.atomic(() => {
    const response = mutation(record.run);
    const current = now().toISOString();
    const updated = { ...record.run, rowVersion: record.run.rowVersion + 1, updatedAt: current };
    store.updateRun(
      updated,
      makeEvent(store, updated, current, "run.state.changed", `${operation} accepted`),
    );
    store.saveIdempotent(
      "local-operator",
      operation,
      runId,
      key,
      body,
      { status: 200, body: response },
      addHours(now(), 24),
    );
    return response;
  });
}

function mutateState<T>(
  store: RakStore,
  request: FastifyRequest,
  runId: string,
  operation: string,
  body: unknown,
  allowedStates: readonly RunDocument["state"][],
  now: () => Date,
  mutation: (run: RunDocument) => T & { rowVersion: number },
): T & { rowVersion: number } {
  const key = String(request.headers["idempotency-key"]);
  const replay = store.replayIdempotent("local-operator", operation, runId, key, body);
  if (replay) return replay.body as T & { rowVersion: number };
  const record = requiredRun(store, runId);
  if (parseIfMatch(request) !== record.run.rowVersion) throw new Error("ROW_VERSION_MISMATCH");
  if (!allowedStates.includes(record.run.state)) throw new Error("RUN_STATE_CONFLICT");
  return store.atomic(() => {
    const response = mutation(record.run);
    const current = now().toISOString();
    const updated: RunDocument = {
      ...record.run,
      rowVersion: record.run.rowVersion + 1,
      updatedAt: current,
    };
    store.updateRun(
      updated,
      makeEvent(store, updated, current, "run.state.changed", `${operation} accepted`),
    );
    store.saveIdempotent(
      "local-operator",
      operation,
      runId,
      key,
      body,
      { status: 200, body: response },
      addHours(now(), 24),
    );
    return response;
  });
}

function mutateAction(
  store: RakStore,
  request: FastifyRequest,
  runId: string,
  operation: string,
  body: ActionBody,
  allowed: readonly RunDocument["state"][],
  to: RunDocument["state"],
  now: () => Date,
  nextId: () => string,
  validate: (body: ActionBody, run: RunDocument) => void,
  effect: (updated: RunDocument) => void,
) {
  const key = String(request.headers["idempotency-key"]);
  const replay = store.replayIdempotent("local-operator", operation, runId, key, body);
  if (replay)
    return replay.body as {
      operationId: string;
      runId: string;
      commandId: string;
      acceptedState: RunDocument["state"];
      rowVersion: number;
    };
  const record = requiredRun(store, runId);
  if (parseIfMatch(request) !== record.run.rowVersion) throw new Error("ROW_VERSION_MISMATCH");
  if (!allowed.includes(record.run.state)) throw new Error("RUN_STATE_CONFLICT");
  validate(body, record.run);
  return store.atomic(() => {
    const current = now().toISOString();
    const updated =
      record.run.state === to
        ? { ...record.run, rowVersion: record.run.rowVersion + 1, updatedAt: current }
        : record.run.state === "DRAFT" && to === "CANCELLING"
          ? {
              ...record.run,
              rowVersion: record.run.rowVersion + 1,
              updatedAt: current,
            }
          : transitionRun(record.run, to, current);
    const response = {
      operationId: `op_${nextId()}`,
      runId,
      commandId: `cmd_${nextId()}`,
      acceptedState: updated.state,
      rowVersion: updated.rowVersion,
    };
    const draftCancellation = operation === "cancelRun" && record.run.state === updated.state;
    store.updateRun(
      updated,
      makeEvent(
        store,
        updated,
        current,
        draftCancellation ? "warning.raised" : "run.state.changed",
        draftCancellation
          ? `${operation} revoked transient inputs without changing run state`
          : `${operation} accepted`,
      ),
    );
    effect(updated);
    store.saveIdempotent(
      "local-operator",
      operation,
      runId,
      key,
      body,
      { status: 202, body: response },
      addHours(now(), 24),
    );
    return response;
  });
}

function recomputeCapabilities(
  current: CapabilityResult[],
  approvals: Approval[],
  checkedAt: string,
): CapabilityResult[] {
  return current.map((capability) => {
    const approval = approvals.find((item) => item.capabilityId === capability.capabilityId);
    if (!approval) return capability;
    const approved =
      approval.decision === "approved" && Date.parse(approval.expiresAt) > Date.parse(checkedAt);
    return {
      ...capability,
      approval: approved ? "approved" : "denied",
      effective: approved && capability.attestation === "passed" ? "available" : "denied",
      reasonCode: approved ? "APPROVAL_RECORDED" : "APPROVAL_DENIED_OR_EXPIRED",
      reason: approved ? "A current DRAFT approval is recorded." : "Approval is denied or expired.",
      checkedAt,
    };
  });
}

function addHours(date: Date, hours: number): string {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

declare module "fastify" {
  interface FastifyInstance {
    rakStore: RakStore;
  }
}

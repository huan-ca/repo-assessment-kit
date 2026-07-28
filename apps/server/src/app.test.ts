import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoveryTopics } from "@rak/contracts";
import { RakStore, requestDigest } from "@rak/persistence";
import { createApp } from "./app.js";

const openApps: Array<ReturnType<typeof createApp>> = [];
const sameOrigin = "http://localhost";
const digest = `sha256:${"a".repeat(64)}` as const;
afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

function setup(withSnapshotResolver = false, publicOrigin?: string) {
  const store = new RakStore();
  store.addSourceHandle({
    sourceHandleId: "src_fixture",
    kind: "local",
    displayName: "Fixture repository",
    allowedRootFingerprint: digest,
    registeredAt: "2026-07-28T00:00:00.000Z",
  });
  let id = 0;
  const app = createApp({
    store,
    bootstrapToken: "bootstrap",
    requireSession: false,
    ...(publicOrigin ? { publicOrigin } : {}),
    now: () => new Date("2026-07-28T00:00:00.000Z"),
    nextId: () => `01982c12-2a00-7000-8000-${String(++id).padStart(12, "0")}`,
    ...(withSnapshotResolver
      ? {
          snapshotResolver: () => ({
            schemaVersion: "1.0.0" as const,
            snapshotId: digest,
            sourceKind: "local" as const,
            sanitizedLocator: "registered-local-source/repo",
            gitObjectFormat: "sha1" as const,
            commitSha: "a".repeat(40),
            baseCommitSha: "a".repeat(40),
            mode: "commit-only" as const,
            manifestBlobId: "blb_fixture",
            manifestDigest: digest,
            archiveDigest: digest,
            beforeSourceDigest: digest,
            afterSourceDigest: digest,
            includedDirtyPaths: [],
            excludedDirtyPaths: [],
            submodules: "not-present" as const,
            lfs: "not-present" as const,
            createdAt: "2026-07-28T00:00:00.000Z",
          }),
        }
      : {}),
  });
  openApps.push(app);
  return { app, store };
}

async function createRun(
  app: ReturnType<typeof createApp>,
  input: { key?: string; projectSlug?: string; origin?: string | null; host?: string } = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/runs",
    headers: {
      "idempotency-key": input.key ?? "create-1",
      ...(input.host ? { host: input.host } : {}),
      ...(input.origin === null ? {} : { origin: input.origin ?? sameOrigin }),
    },
    payload: {
      projectSlug: input.projectSlug ?? "fixture",
      engagementId: "eng_fixture",
      provider: "codex",
      source: {
        kind: "local",
        sourceHandleId: "src_fixture",
        relativePath: "repo",
        mode: "commit-only",
      },
      selectedProfiles: ["rak-baseline/1.0.0"],
      optionalServiceIds: [],
    },
  });
}

function claimsFor(runId: string) {
  return discoveryTopics.map((topic, index) => ({
    schemaVersion: "1.0.0" as const,
    claimId: `clm_${index}`,
    runId,
    topic,
    unknown: {
      reason: "Not supplied",
      confidenceEffect: "Reduces decision confidence",
      coverageEffect: "Recorded as unknown",
      followUp: "Customer owner",
    },
    provenance: "unverified" as const,
    confidence: "low" as const,
    evidenceOccurrenceIds: [],
    conflictsWithClaimIds: [],
    revision: 1,
  }));
}

describe("local loopback API", () => {
  it("exposes only the specified liveness and readiness probes", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/health/live" })).json()).toEqual({
      status: "ok",
    });
    expect((await app.inject({ method: "GET", url: "/health/ready" })).json()).toEqual({
      status: "ready",
    });
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(404);
    for (const headers of [
      { host: "evil.example", origin: "http://evil.example" },
      { host: "evil@localhost", origin: "http://localhost" },
      { host: "%6cocalhost", origin: "http://localhost" },
      { host: "localhost", origin: "http://evil@localhost" },
      { host: "localhost/path", origin: "http://localhost" },
    ]) {
      const rejected = await app.inject({
        method: "GET",
        url: "/health/live",
        headers,
      });
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json().error.code).toBe("ORIGIN_DENIED");
    }
  });

  it("accepts the pinned proxy authority and rejects matching untrusted Host/Origin", async () => {
    const { app } = setup(false, "http://localhost:4173");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/health/ready",
          headers: { host: "localhost:4173", origin: "http://localhost:4173" },
        })
      ).statusCode,
    ).toBe(200);
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/session/bootstrap",
      headers: { host: "evil.example", origin: "http://evil.example" },
      payload: { token: "bootstrap" },
    });
    expect(bootstrap.statusCode).toBe(403);
    expect(bootstrap.json().error.code).toBe("ORIGIN_DENIED");
    const hostUserinfo = await app.inject({
      method: "POST",
      url: "/api/v1/session/bootstrap",
      headers: { host: "evil@localhost:4173", origin: "http://localhost:4173" },
      payload: { token: "bootstrap" },
    });
    expect(hostUserinfo.statusCode).toBe(403);
    expect(hostUserinfo.json().error.code).toBe("ORIGIN_DENIED");
    const originUserinfo = await app.inject({
      method: "POST",
      url: "/api/v1/session/bootstrap",
      headers: { host: "localhost:4173", origin: "http://evil@localhost:4173" },
      payload: { token: "bootstrap" },
    });
    expect(originUserinfo.statusCode).toBe(403);
    expect(originUserinfo.json().error.code).toBe("ORIGIN_DENIED");
    const trustedBootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/session/bootstrap",
      headers: { host: "localhost:4173", origin: "http://localhost:4173" },
      payload: { token: "bootstrap" },
    });
    expect(trustedBootstrap.statusCode).toBe(204);
    const mutation = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: {
        host: "evil.example",
        origin: "http://evil.example",
        "idempotency-key": "evil-authority",
      },
      payload: {
        projectSlug: "evil-authority",
        engagementId: "eng_fixture",
        provider: "codex",
        source: {
          kind: "local",
          sourceHandleId: "src_fixture",
          relativePath: "repo",
          mode: "commit-only",
        },
        selectedProfiles: [],
        optionalServiceIds: [],
      },
    });
    expect(mutation.statusCode).toBe(403);
    expect(mutation.json().error.code).toBe("ORIGIN_DENIED");
    const trustedMutation = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: {
        host: "localhost:4173",
        origin: "http://localhost:4173",
        "idempotency-key": "trusted-proxy",
      },
      payload: {
        projectSlug: "trusted-proxy",
        engagementId: "eng_fixture",
        provider: "codex",
        source: {
          kind: "local",
          sourceHandleId: "src_fixture",
          relativePath: "repo",
          mode: "commit-only",
        },
        selectedProfiles: [],
        optionalServiceIds: [],
      },
    });
    expect(trustedMutation.statusCode, trustedMutation.body).toBe(201);
  });

  it("creates a durable DRAFT with honest blocked runtime capability", async () => {
    const { app } = setup();
    const response = await createRun(app);
    expect(response.statusCode).toBe(201);
    const run = response.json();
    const detail = await app.inject({ method: "GET", url: `/api/v1/runs/${run.runId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().phases).toHaveLength(14);
    expect(detail.json().currentCapabilities).toContainEqual(
      expect.objectContaining({
        capabilityId: "dynamic-runtime",
        effective: "blocked",
        reasonCode: "RUNTIME_NOT_ATTESTED",
      }),
    );
    expect(detail.json().coverageSummary).toHaveLength(15);
    expect(detail.json().coverageSummary).toContainEqual(
      expect.objectContaining({
        domainId: "dynamic-browser-security",
        status: "blocked",
        reconciledControls: 1,
      }),
    );
    const controls = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.runId}/controls`,
    });
    expect(controls.json().items).toContainEqual(
      expect.objectContaining({
        plannedControlId: "ctl_release_runtime_capability",
        currentResult: expect.objectContaining({
          status: "blocked",
          reasonCode: "RUNTIME_NOT_ATTESTED",
        }),
      }),
    );
  });

  it("enforces strict discovery, row versions, lifecycle, and idempotency", async () => {
    const { app } = setup();
    const create = await createRun(app);
    const run = create.json();
    const expanded = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/actions/resolve-target`,
      headers: {
        "idempotency-key": "resolve-expanded",
        "if-match": '"0"',
        origin: sameOrigin,
      },
      payload: { expectedRowVersion: 0, arbitraryCommand: "git status" },
    });
    expect(expanded.statusCode).toBe(400);
    expect(expanded.json().error.code).toBe("SCHEMA_INVALID");
    const premature = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/actions/resolve-target`,
      headers: { "idempotency-key": "resolve-early", "if-match": '"0"', origin: sameOrigin },
      payload: { expectedRowVersion: 0 },
    });
    expect(premature.statusCode).toBe(422);
    expect(premature.json().error.code).toBe("DISCOVERY_INCOMPLETE");

    const claims = claimsFor(run.runId);
    const expandedDiscovery = await app.inject({
      method: "PUT",
      url: `/api/v1/runs/${run.runId}/discovery`,
      headers: {
        "idempotency-key": "discovery-expanded",
        "if-match": '"0"',
        origin: sameOrigin,
      },
      payload: { claims, hostCommand: "rm -rf /" },
    });
    expect(expandedDiscovery.statusCode).toBe(400);
    const discovery = await app.inject({
      method: "PUT",
      url: `/api/v1/runs/${run.runId}/discovery`,
      headers: { "idempotency-key": "discovery-1", "if-match": '"0"', origin: sameOrigin },
      payload: { claims },
    });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json().rowVersion).toBe(1);
    const replay = await app.inject({
      method: "PUT",
      url: `/api/v1/runs/${run.runId}/discovery`,
      headers: { "idempotency-key": "discovery-1", "if-match": '"0"', origin: sameOrigin },
      payload: { claims },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(discovery.json());
    const conflict = await app.inject({
      method: "PUT",
      url: `/api/v1/runs/${run.runId}/discovery`,
      headers: { "idempotency-key": "discovery-1", "if-match": '"1"', origin: sameOrigin },
      payload: { claims: claims.slice(1) },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

    const resolve = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/actions/resolve-target`,
      headers: { "idempotency-key": "resolve-1", "if-match": '"1"', origin: sameOrigin },
      payload: { expectedRowVersion: 1 },
    });
    expect(resolve.statusCode).toBe(202);
    expect(resolve.json()).toMatchObject({ acceptedState: "RESOLVING_TARGET", rowVersion: 2 });
    const unresolved = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.runId}`,
    });
    expect(unresolved.json().run).toMatchObject({
      rowVersion: 3,
      limitationIds: expect.arrayContaining(["lim_target-resolution-unresolved"]),
    });
    const illegalPause = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/actions/pause`,
      headers: { "idempotency-key": "pause-1", "if-match": '"3"', origin: sameOrigin },
      payload: { reason: "operator" },
    });
    expect(illegalPause.statusCode).toBe(409);
    expect(illegalPause.json().error.code).toBe("RUN_STATE_CONFLICT");
  });

  it("admits only a trusted immutable snapshot and queues static work while runtime is blocked", async () => {
    const { app, store } = setup(true);
    const create = await createRun(app);
    const run = create.json();
    const secret = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/secrets`,
      headers: { "idempotency-key": "active-secret", "if-match": '"0"', origin: sameOrigin },
      payload: {
        purpose: "probe",
        recipient: "fixture",
        expiresAt: "2026-07-28T01:00:00.000Z",
      },
    });
    const secretBytes = Buffer.from("active-run-secret");
    expect(
      (
        await app.inject({
          method: "PUT",
          url: secret.json().uploadPath,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(secretBytes.byteLength),
          },
          payload: secretBytes,
        })
      ).statusCode,
    ).toBe(204);
    const discovery = await app.inject({
      method: "PUT",
      url: `/api/v1/runs/${run.runId}/discovery`,
      headers: { "idempotency-key": "discovery", "if-match": '"1"', origin: sameOrigin },
      payload: { claims: claimsFor(run.runId) },
    });
    expect(discovery.statusCode).toBe(200);
    const resolve = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/actions/resolve-target`,
      headers: { "idempotency-key": "resolve", "if-match": '"2"', origin: sameOrigin },
      payload: { expectedRowVersion: 2 },
    });
    expect(resolve.statusCode).toBe(202);
    const ready = await app.inject({ method: "GET", url: `/api/v1/runs/${run.runId}` });
    expect(ready.json().run).toMatchObject({
      state: "READY",
      rowVersion: 4,
      targetSnapshotId: digest,
    });
    expect(store.getSnapshot(run.runId)).toMatchObject({
      beforeSourceDigest: digest,
      afterSourceDigest: digest,
    });
    const start = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/actions/start`,
      headers: { "idempotency-key": "start", "if-match": '"4"', origin: sameOrigin },
      payload: { snapshotId: digest },
    });
    expect(start.statusCode).toBe(202);
    expect(start.json().acceptedState).toBe("EXECUTING");
    expect(store.listAttempts(run.runId)).toContainEqual(
      expect.objectContaining({ state: "QUEUED", fenceToken: 1 }),
    );
    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/actions/cancel`,
      headers: { "idempotency-key": "cancel", "if-match": '"5"', origin: sameOrigin },
      payload: { reason: "Operator stopped the fixture run" },
    });
    expect(cancel.statusCode, cancel.body).toBe(202);
    expect(store.listAttempts(run.runId)).toContainEqual(
      expect.objectContaining({ state: "CANCELLED", fenceToken: 2 }),
    );
    expect(
      store.database
        .prepare("SELECT state FROM cleanup_records WHERE run_id=?")
        .pluck()
        .get(run.runId),
    ).toBe("COMPLETE");
    expect(
      store.database
        .prepare("SELECT state FROM secret_handles WHERE id=?")
        .pluck()
        .get(secret.json().handle.secretHandleId),
    ).toBe("REVOKED");
    expect(store.getRun(run.runId)?.run.state).toBe("CANCELLED");
  });

  it("requires exact origin and paginates every run with an opaque cursor", async () => {
    const { app } = setup();
    const missingOrigin = await createRun(app, {
      key: "missing-origin",
      projectSlug: "missing-origin",
      origin: null,
    });
    expect(missingOrigin.statusCode).toBe(403);
    const deleteSession = await app.inject({ method: "DELETE", url: "/api/v1/session" });
    expect(deleteSession.statusCode).toBe(204);
    for (let index = 0; index < 205; index += 1) {
      const response = await createRun(app, {
        key: `create-${index}`,
        projectSlug: `fixture-${index}`,
      });
      expect(response.statusCode).toBe(201);
    }
    const first = await app.inject({ method: "GET", url: "/api/v1/runs?limit=200" });
    expect(first.json().items).toHaveLength(200);
    expect(first.json().nextCursor).not.toMatch(/^[0-9]+$/);
    const second = await app.inject({
      method: "GET",
      url: `/api/v1/runs?limit=200&cursor=${encodeURIComponent(first.json().nextCursor)}`,
    });
    expect(second.json().items).toHaveLength(5);
    expect(second.json().nextCursor).toBeUndefined();
    const unknownQuery = await app.inject({
      method: "GET",
      url: "/api/v1/runs?globalSearch=anything",
    });
    expect(unknownQuery.statusCode).toBe(400);
  });

  it("refuses package requests without a protected secret channel and completed review gates", async () => {
    const { app, store } = setup();
    const create = await createRun(app);
    const run = create.json();
    const reviewRequired = { ...run, state: "REVIEW_REQUIRED" };
    store.database
      .prepare("UPDATE runs SET state=?,document_json=? WHERE id=?")
      .run("REVIEW_REQUIRED", JSON.stringify(reviewRequired), run.runId);
    const scrypt = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/packages`,
      headers: { "idempotency-key": "package-scrypt", "if-match": '"0"', origin: sameOrigin },
      payload: { encryption: { mode: "scrypt" } },
    });
    expect(scrypt.statusCode).toBe(422);
    expect(scrypt.json().error.code).toBe("SECRET_CHANNEL_REQUIRED");
    const incomplete = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/packages`,
      headers: { "idempotency-key": "package-incomplete", "if-match": '"0"', origin: sameOrigin },
      payload: {},
    });
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json().error.code).toBe("REVIEW_GATES_INCOMPLETE");
    expect(store.listPackages(run.runId)).toEqual([]);
  });

  it("keeps secret bytes out of SQLite and supports one-use upload plus revocation", async () => {
    const { app, store } = setup();
    const create = await createRun(app);
    const run = create.json();
    const secret = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/secrets`,
      headers: { "idempotency-key": "secret", "if-match": '"0"', origin: sameOrigin },
      payload: {
        purpose: "probe",
        recipient: "fixture-probe",
        expiresAt: "2026-07-28T01:00:00.000Z",
      },
    });
    expect(secret.statusCode).toBe(201);
    const secretBytes = "sentinel-secret-value";
    const upload = await app.inject({
      method: "PUT",
      url: secret.json().uploadPath,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(Buffer.byteLength(secretBytes)),
      },
      payload: Buffer.from(secretBytes),
    });
    expect(upload.statusCode).toBe(204);
    expect(
      JSON.stringify(store.database.prepare("SELECT * FROM secret_handles").all()),
    ).not.toContain(secretBytes);
    const replayUpload = await app.inject({
      method: "PUT",
      url: secret.json().uploadPath,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(Buffer.byteLength(secretBytes)),
      },
      payload: Buffer.from(secretBytes),
    });
    expect(replayUpload.statusCode).toBe(404);
    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/v1/runs/${run.runId}/secrets/${secret.json().handle.secretHandleId}`,
      headers: { "idempotency-key": "revoke", "if-match": '"1"', origin: sameOrigin },
    });
    expect(revoke.statusCode).toBe(204);
    expect(
      store.database
        .prepare("SELECT state FROM secret_handles WHERE id=?")
        .pluck()
        .get(secret.json().handle.secretHandleId),
    ).toBe("REVOKED");
  });

  it("revokes uploaded and pending secrets while DRAFT cancellation remains DRAFT", async () => {
    const { app, store } = setup();
    const run = (await createRun(app)).json();
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/secrets`,
      headers: { "idempotency-key": "secret-uploaded", "if-match": '"0"', origin: sameOrigin },
      payload: {
        purpose: "probe",
        recipient: "fixture",
        expiresAt: "2026-07-28T01:00:00.000Z",
      },
    });
    const bytes = Buffer.from("must-be-zeroized");
    expect(
      (
        await app.inject({
          method: "PUT",
          url: uploaded.json().uploadPath,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(bytes.byteLength),
          },
          payload: bytes,
        })
      ).statusCode,
    ).toBe(204);
    const pending = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/secrets`,
      headers: { "idempotency-key": "secret-pending", "if-match": '"1"', origin: sameOrigin },
      payload: {
        purpose: "target-service",
        recipient: "fixture",
        expiresAt: "2026-07-28T01:00:00.000Z",
      },
    });
    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/actions/cancel`,
      headers: { "idempotency-key": "cancel-draft", "if-match": '"2"', origin: sameOrigin },
      payload: { reason: "Operator cancelled before target resolution" },
    });
    expect(cancel.statusCode, cancel.body).toBe(202);
    expect(cancel.json().acceptedState).toBe("DRAFT");
    expect(store.getRun(run.runId)?.run.state).toBe("DRAFT");
    expect(store.listEvents(run.runId).at(-1)).toMatchObject({
      type: "warning.raised",
      summary: expect.stringContaining("without changing run state"),
    });
    expect(
      store.database
        .prepare("SELECT DISTINCT state FROM secret_handles WHERE run_id=?")
        .pluck()
        .all(run.runId),
    ).toEqual(["REVOKED"]);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: pending.json().uploadPath,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "1",
          },
          payload: Buffer.from("x"),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      store.database
        .prepare("SELECT COUNT(*) FROM cleanup_records WHERE run_id=?")
        .pluck()
        .get(run.runId),
    ).toBe(0);
  });

  it("creates successor revisions and guarded review/deletion records", async () => {
    const { app, store } = setup();
    const create = await createRun(app);
    const run = create.json();
    const revision = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/revisions`,
      headers: { "idempotency-key": "revision", "if-match": '"0"', origin: sameOrigin },
      payload: { reason: "Changed assessment inputs", copyDiscovery: false },
    });
    expect(revision.statusCode).toBe(201);
    expect(revision.json()).toMatchObject({ parentRunId: run.runId, revision: 2, state: "DRAFT" });

    const reviewRun = {
      ...run,
      state: "REVIEW_REQUIRED",
      targetSnapshotId: digest,
    };
    store.database
      .prepare("UPDATE runs SET state=?,document_json=? WHERE id=?")
      .run("REVIEW_REQUIRED", JSON.stringify(reviewRun), run.runId);
    const review = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/reviews`,
      headers: { "idempotency-key": "review", "if-match": '"0"', origin: sameOrigin },
      payload: {
        kind: "technical-human",
        reviewerRole: "consultant",
        inputDigest: digest,
        verdict: "passed",
        itemResults: [],
      },
    });
    expect(review.statusCode).toBe(201);
    expect(
      store.getObject(run.runId, "evidence", review.json().review.reviewEvidenceId),
    ).toBeTruthy();

    const completed = {
      ...reviewRun,
      state: "COMPLETED",
      rowVersion: 1,
      terminalAt: "2026-07-28T00:00:00.000Z",
    };
    store.database
      .prepare("UPDATE runs SET state=?,row_version=?,document_json=? WHERE id=?")
      .run("COMPLETED", 1, JSON.stringify(completed), run.runId);
    const deletion = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.runId}/deletion`,
      headers: { "idempotency-key": "deletion", "if-match": '"1"', origin: sameOrigin },
      payload: {
        scope: "internal-only",
        includePackages: false,
        projectSlugConfirmation: "fixture",
        packageDigestConfirmations: [],
      },
    });
    expect(deletion.statusCode).toBe(202);
    const job = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.runId}/deletions/${deletion.json().deletionJobId}`,
    });
    expect(job.json()).toMatchObject({ state: "REQUESTED", recoveryPossible: false });
  });

  it("serves only a packager-bound validated artifact", async () => {
    const { app, store } = setup();
    const create = await createRun(app);
    const run = create.json();
    const packaging = { ...run, state: "PACKAGING" };
    store.database
      .prepare("UPDATE runs SET state=?,document_json=? WHERE id=?")
      .run("PACKAGING", JSON.stringify(packaging), run.runId);
    const directory = mkdtempSync(join(tmpdir(), "rak-package-"));
    const artifactPath = join(directory, "package.zip");
    const bytes = Buffer.from("fixture-package");
    writeFileSync(artifactPath, bytes);
    const packageDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
    const packageId = "pkg_01982c12-2a00-7000-8000-000000000099";
    const certificatePayload = {
      schemaVersion: "1.0.0",
      packageId,
      runId: run.runId,
      runRevision: 1,
      packageDigest,
      byteLength: String(bytes.byteLength),
      validationReportId: "val_fixture",
      artifactPath: "generated/fixture/package.zip",
      validatedAt: "2026-07-28T00:00:00.000Z",
    } as const;
    store.admitPackageValidation(
      {
        ...certificatePayload,
        certificateDigest: requestDigest(certificatePayload) as `sha256:${string}`,
      },
      artifactPath,
    );
    const digestResponse = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.runId}/packages/${packageId}/digest`,
    });
    expect(digestResponse.body).toBe(`${packageDigest}\n`);
    expect(digestResponse.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(digestResponse.headers["cache-control"]).toBe("no-store");
    const download = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.runId}/packages/${packageId}/download`,
    });
    expect(download.rawPayload).toEqual(bytes);
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(download.headers["cache-control"]).toBe("no-store");
    expect(download.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
  });

  it("replays then remains live and returns 410 for expired event history", async () => {
    const { app, store } = setup(false, "http://127.0.0.1:34173");
    const create = await createRun(app, {
      origin: "http://127.0.0.1:34173",
      host: "127.0.0.1:34173",
    });
    const run = create.json();
    const address = await app.listen({ host: "127.0.0.1", port: 34173 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/v1/runs/${run.runId}/events`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("id: 1");
    const event = {
      schemaVersion: "1.0.0",
      sequence: "2",
      runId: run.runId,
      rowVersion: 0,
      type: "warning.raised",
      occurredAt: "2026-07-28T00:00:01.000Z",
      summary: "live fixture event",
    };
    store.database
      .prepare(
        `INSERT INTO run_events
         (run_id,sequence,row_version,type,public_payload_json,occurred_at,published)
         VALUES(?,?,?,?,?,?,0)`,
      )
      .run(run.runId, 2, 0, event.type, JSON.stringify(event), event.occurredAt);
    const live = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("live SSE event timed out")), 3_000),
      ),
    ]);
    expect(new TextDecoder().decode(live.value)).toContain("live fixture event");
    controller.abort();
    await reader.cancel().catch(() => undefined);

    store.database.prepare("DELETE FROM run_events WHERE run_id=?").run(run.runId);
    store.database
      .prepare(
        `INSERT INTO run_events
         (run_id,sequence,row_version,type,public_payload_json,occurred_at,published)
         VALUES(?,?,?,?,?,?,0)`,
      )
      .run(
        run.runId,
        5,
        0,
        event.type,
        JSON.stringify({ ...event, sequence: "5" }),
        event.occurredAt,
      );
    const expired = await fetch(`${address}/api/v1/runs/${run.runId}/events`, {
      headers: { "Last-Event-ID": "1" },
    });
    expect(expired.status).toBe(410);
    const expiredBody = (await expired.json()) as {
      error: { operatorAction: string };
    };
    expect(expiredBody.error.operatorAction).toContain("Refetch getRun");
  });
});

import type {
  AppData,
  Approval,
  CapabilityResult,
  DecisionComparison,
  DomainCoverage,
  EvidenceOccurrence,
  Finding,
  PackageView,
  ProductClaim,
  RunDetail,
  RunDocument,
  SourceHandleView,
  SystemView,
} from "./model.js";
import type { DraftSetup, LauncherProvider } from "./model.js";
import { fixtureData } from "./fixtures.js";

export type DataMode = "live" | "preview";

interface SessionBootstrapDependencies {
  readToken: () => string | null;
  clearToken: () => void;
  postToken: (token: string) => Promise<void>;
}

export function createSessionBootstrapSingleFlight(dependencies: SessionBootstrapDependencies) {
  let request: Promise<void> | undefined;
  return (): Promise<void> => {
    if (request) return request;
    const token = dependencies.readToken();
    if (!token) return Promise.resolve();
    dependencies.clearToken();
    request = dependencies.postToken(token);
    return request;
  };
}

const bootstrapSession = createSessionBootstrapSingleFlight({
  readToken: () => new URLSearchParams(window.location.hash.slice(1)).get("bootstrap"),
  clearToken: () =>
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`),
  postToken: async (token) => {
    const response = await fetch("/api/v1/session/bootstrap", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      throw new Error(`Session bootstrap failed with status ${String(response.status)}.`);
    }
  },
});

export function bootstrapSessionFromFragment(): Promise<void> {
  return bootstrapSession();
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Request failed with status ${String(response.status)}`);
  return (await response.json()) as T;
}

export async function loadInitialData(signal?: AbortSignal): Promise<{
  data?: AppData;
  mode: DataMode;
  liveError?: string;
}> {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "1"
  ) {
    return {
      data: fixtureData,
      mode: "preview",
      liveError: "Explicit interface preview requested; the local API was not contacted.",
    };
  }
  try {
    const system = await getJson<SystemView>("/api/v1/system", signal);
    const [handles, runs] = await Promise.all([
      getJson<{ items: SourceHandleView[] }>("/api/v1/source-handles", signal),
      getJson<{ items: RunDocument[]; nextCursor?: string }>("/api/v1/runs?limit=1", signal),
    ]);
    const run = runs.items[0];
    if (!run) {
      return {
        data: {
          ...fixtureData,
          runAvailable: false,
          decisionAvailable: false,
          system,
          sourceHandles: handles.items,
        },
        mode: "live",
      };
    }

    const runPath = `/api/v1/runs/${encodeURIComponent(run.runId)}`;
    const detail = await getJson<RunDetail>(runPath, signal);
    const [coverage, findings, evidence, decision, packages] = await Promise.allSettled([
      getJson<{ items: DomainCoverage[]; limitationIds: string[] }>(`${runPath}/coverage`, signal),
      getJson<{ items: Finding[]; nextCursor?: string }>(`${runPath}/findings?limit=50`, signal),
      getJson<{ items: EvidenceOccurrence[]; nextCursor?: string }>(
        `${runPath}/evidence?limit=50`,
        signal,
      ),
      getJson<DecisionComparison>(`${runPath}/decision`, signal),
      getJson<{ items: PackageView[] }>(`${runPath}/packages`, signal),
    ]);

    return {
      data: {
        runAvailable: true,
        decisionAvailable: decision.status === "fulfilled",
        system,
        sourceHandles: handles.items,
        run: {
          ...detail,
          coverageSummary:
            coverage.status === "fulfilled" ? coverage.value.items : detail.coverageSummary,
        },
        events: [],
        findings: findings.status === "fulfilled" ? findings.value.items : [],
        evidence: evidence.status === "fulfilled" ? evidence.value.items : [],
        decision: decision.status === "fulfilled" ? decision.value : fixtureData.decision,
        packages: packages.status === "fulfilled" ? packages.value.items : [],
      },
      mode: "live",
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      mode: "live",
      liveError: error instanceof Error ? error.message : "The local API is unavailable.",
    };
  }
}

export function makeIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function mutation<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body: unknown,
  rowVersion?: number,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "idempotency-key": makeIdempotencyKey(),
      ...(rowVersion === undefined ? {} : { "if-match": `"${String(rowVersion)}"` }),
    },
    body: body === null ? null : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`The operation was not accepted (status ${String(response.status)}).`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

export async function createRun(
  setup: DraftSetup,
  provider: LauncherProvider,
): Promise<RunDocument> {
  return mutation<RunDocument>("/api/v1/runs", "POST", {
    projectSlug: setup.projectSlug,
    engagementId: setup.engagementId,
    provider,
    source:
      setup.sourceKind === "local"
        ? {
            kind: "local",
            sourceHandleId: setup.sourceHandleId,
            relativePath: setup.relativePath,
            mode: setup.mode,
          }
        : {
            kind: "ssh-git",
            sshHandleId: setup.sourceHandleId,
            url: setup.sshUrl,
            ...(setup.ref ? { ref: setup.ref } : {}),
          },
    selectedProfiles: setup.profiles,
    optionalServiceIds: setup.optionalServiceIds,
  });
}

export async function saveDiscovery(
  run: RunDocument,
  claims: ProductClaim[],
): Promise<{ claims: ProductClaim[]; rowVersion: number }> {
  return mutation(
    `/api/v1/runs/${encodeURIComponent(run.runId)}/discovery`,
    "PUT",
    { claims },
    run.rowVersion,
  );
}

export async function saveApprovals(
  run: RunDocument,
  approvals: Approval[],
): Promise<{ approvals: Approval[]; capabilities: CapabilityResult[]; rowVersion: number }> {
  return mutation(
    `/api/v1/runs/${encodeURIComponent(run.runId)}/approvals`,
    "PUT",
    { approvals },
    run.rowVersion,
  );
}

export async function createAndUploadSecret(
  run: RunDocument,
  value: string,
  onAuthoritativeVersion?: (rowVersion: number) => void,
): Promise<{ secretHandleId: string; rowVersion: number }> {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const createResponse = await fetch(`/api/v1/runs/${encodeURIComponent(run.runId)}/secrets`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "idempotency-key": makeIdempotencyKey(),
      "if-match": `"${String(run.rowVersion)}"`,
    },
    body: JSON.stringify({
      purpose: "target-service",
      recipient: "sandbox-target",
      expiresAt,
    }),
  });
  if (!createResponse.ok) {
    throw new Error(
      `The credential handle was not created (status ${String(createResponse.status)}).`,
    );
  }
  const etag = createResponse.headers.get("etag");
  const matchedVersion = etag?.match(/^"(\d+)"$/)?.[1];
  if (!matchedVersion) {
    throw new Error("The credential handle response did not include an authoritative ETag.");
  }
  const rowVersion = Number(matchedVersion);
  onAuthoritativeVersion?.(rowVersion);
  const created = (await createResponse.json()) as {
    handle: { secretHandleId: string };
    uploadPath: string;
    uploadTokenExpiresAt: string;
  };
  const bytes = new TextEncoder().encode(value);
  const response = await fetch(created.uploadPath, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Secret upload failed with status ${String(response.status)}.`);
  return {
    secretHandleId: created.handle.secretHandleId,
    rowVersion,
  };
}

export async function runAction(
  path: string,
  rowVersion: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  return mutation(path, "POST", body, rowVersion);
}

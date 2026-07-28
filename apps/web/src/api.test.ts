import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAndUploadSecret,
  createRun,
  createSessionBootstrapSingleFlight,
  loadInitialData,
  saveApprovals,
} from "./api.js";
import { fixtureData } from "./fixtures.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("one-time session bootstrap", () => {
  it("survives a StrictMode-style first cleanup and posts the token exactly once", async () => {
    let finishPost: (() => void) | undefined;
    const postToken = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPost = resolve;
        }),
    );
    const clearToken = vi.fn();
    const bootstrap = createSessionBootstrapSingleFlight({
      readToken: () => "one-time-token",
      clearToken,
      postToken,
    });

    const firstEffectController = new AbortController();
    const firstMount = bootstrap();
    firstEffectController.abort();
    const secondMount = bootstrap();

    expect(firstMount).toBe(secondMount);
    expect(firstEffectController.signal.aborted).toBe(true);
    expect(postToken).toHaveBeenCalledTimes(1);
    expect(postToken).toHaveBeenCalledWith("one-time-token");
    expect(clearToken).toHaveBeenCalledTimes(1);

    finishPost?.();
    await expect(secondMount).resolves.toBeUndefined();
  });

  it("keeps an authenticated zero-run workspace live without exposing sample run truth", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(fixtureData.system))
      .mockResolvedValueOnce(Response.json({ items: fixtureData.sourceHandles }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadInitialData();

    expect(result.mode).toBe("live");
    expect(result.data?.runAvailable).toBe(false);
    expect(result.data?.sourceHandles).toEqual(fixtureData.sourceHandles);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps a persisted live run authoritative when a derived resource is not ready", async () => {
    const persistedRun = {
      ...fixtureData.run.run,
      runId: "run_persisted",
      projectSlug: "browser-live",
      state: "DRAFT" as const,
    };
    const persistedDetail = { ...fixtureData.run, run: persistedRun };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(fixtureData.system))
      .mockResolvedValueOnce(Response.json({ items: fixtureData.sourceHandles }))
      .mockResolvedValueOnce(Response.json({ items: [persistedRun] }))
      .mockResolvedValueOnce(Response.json(persistedDetail))
      .mockResolvedValueOnce(Response.json({ items: [], limitationIds: [] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadInitialData();

    expect(result.mode).toBe("live");
    expect(result.data?.run.run.projectSlug).toBe("browser-live");
    expect(result.data?.decisionAvailable).toBe(false);
    expect(result.data?.findings).toEqual([]);
    expect(result.liveError).toBeUndefined();
  });

  it("fails closed in live mode instead of substituting preview records", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("loopback unavailable")));

    const result = await loadInitialData();

    expect(result.mode).toBe("live");
    expect(result.data).toBeUndefined();
    expect(result.liveError).toBe("loopback unavailable");
  });

  it("propagates the secret-create ETag before approval mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            handle: { secretHandleId: "sec_one_use" },
            uploadPath: "/api/v1/secret-uploads/token",
            uploadTokenExpiresAt: "2026-07-28T15:00:00.000Z",
          },
          { status: 201, headers: { etag: '"19"' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ approvals: [], capabilities: [], rowVersion: 20 }));
    vi.stubGlobal("fetch", fetchMock);
    const onVersion = vi.fn();

    const secret = await createAndUploadSecret(
      { ...fixtureData.run.run, rowVersion: 18 },
      "one-use-value",
      onVersion,
    );
    await saveApprovals({ ...fixtureData.run.run, rowVersion: secret.rowVersion }, []);

    expect(secret).toEqual({ secretHandleId: "sec_one_use", rowVersion: 19 });
    expect(onVersion).toHaveBeenCalledWith(19);
    const secretCreate = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const approvals = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect((secretCreate.headers as Record<string, string>)["if-match"]).toBe('"18"');
    expect((approvals.headers as Record<string, string>)["if-match"]).toBe('"19"');
  });

  it("creates the first live draft from the exact frozen request shape", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(fixtureData.run.run));
    vi.stubGlobal("fetch", fetchMock);
    const setup = {
      projectSlug: "customer-portal",
      engagementId: "eng-204",
      sourceKind: "local" as const,
      sourceHandleId: "src_local_customer",
      relativePath: ".",
      sshUrl: "",
      ref: "",
      mode: "commit-only" as const,
      profiles: ["general-security-baseline"],
      optionalServiceIds: [],
    };

    await expect(createRun(setup, "codex")).resolves.toEqual(fixtureData.run.run);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/runs");
    expect(request.method).toBe("POST");
    expect(JSON.parse(String(request.body))).toEqual({
      projectSlug: "customer-portal",
      engagementId: "eng-204",
      provider: "codex",
      source: {
        kind: "local",
        sourceHandleId: "src_local_customer",
        relativePath: ".",
        mode: "commit-only",
      },
      selectedProfiles: ["general-security-baseline"],
      optionalServiceIds: [],
    });
  });
});

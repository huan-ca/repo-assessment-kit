import { constants } from "node:fs";
import { open, rename, mkdir, lstat, unlink } from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  digestCanonical,
  HostHelperError,
  parseStrictJsonBytes,
} from "./host-helper-protocol.mjs";

const EMPTY = Object.freeze({
  schemaVersion: "rak-host-helper-journal/1.0.0",
  counters: {},
  nonces: {},
  fences: {},
  idempotency: {},
  resources: {},
  cleanup: {},
});
const STATE_KEYS = [...Object.keys(EMPTY), "journalDigest"].sort();

function withDigest(value) {
  const body = structuredClone(value);
  delete body.journalDigest;
  return { ...body, journalDigest: digestCanonical(body) };
}

async function durableWrite(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${canonicalJson(withDigest(value))}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, filePath);
  const directory = await open(path.dirname(filePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function createHostHelperJournal(root, installationId, options = {}) {
  const fixture = options.mode === "fixture-test-only";
  if (fixture) await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root).catch(() => undefined);
  const expectedOwner = fixture ? process.getuid?.() : 0;
  if (
    rootInfo === undefined ||
    rootInfo.isSymbolicLink() ||
    !rootInfo.isDirectory() ||
    (rootInfo.mode & 0o777) !== 0o700 ||
    (expectedOwner !== undefined && rootInfo.uid !== expectedOwner)
  ) {
    throw new HostHelperError("AUTH_FAILED", "helper journal root is unsafe");
  }
  const filePath = path.join(root, `${installationId}.json`);
  const lockPath = `${filePath}.lock`;
  let lock;
  try {
    lock = await open(
      lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await lock.writeFile(`${process.pid}\n`, "utf8");
    await lock.sync();
  } catch (error) {
    const info = await lstat(lockPath).catch(() => undefined);
    if (info?.isFile() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o600) {
      const stalePid = Number.parseInt(
        await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW)
          .then(async (file) => {
            try {
              return await file.readFile("utf8");
            } finally {
              await file.close();
            }
          })
          .catch(() => ""),
        10,
      );
      let alive = true;
      try {
        process.kill(stalePid, 0);
      } catch (probe) {
        alive = probe?.code !== "ESRCH";
      }
      if (!alive) {
        await unlink(lockPath);
        return createHostHelperJournal(root, installationId, options);
      }
    }
    throw new HostHelperError("AUTH_FAILED", "helper journal singleton is already active", {
      cause: error,
    });
  }
  let state;
  try {
    const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || (info.mode & 0o777) !== 0o600) throw new Error("unsafe journal");
      state = parseStrictJsonBytes(await file.readFile(), "helper journal");
    } finally {
      await file.close();
    }
    const keys = Object.keys(state).sort();
    const { journalDigest, ...body } = state;
    if (
      keys.length !== STATE_KEYS.length ||
      keys.some((key, index) => key !== STATE_KEYS[index]) ||
      journalDigest !== digestCanonical(body) ||
      body.schemaVersion !== EMPTY.schemaVersion
    )
      throw new Error("journal integrity failed");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    state = structuredClone(EMPTY);
    await durableWrite(filePath, state);
  }
  let queue = Promise.resolve();
  const transaction = (callback) => {
    const pending = queue.then(async () => {
      const draft = structuredClone(state);
      const result = await callback(draft);
      await durableWrite(filePath, draft);
      state = draft;
      return result;
    });
    queue = pending.catch(() => {});
    return pending;
  };
  return Object.freeze({
    async admit(request) {
      return transaction((draft) => {
        const prior = draft.idempotency[request.idempotencyKey];
        if (prior !== undefined) {
          if (
            prior.requestDigest !== request.requestDigest ||
            prior.operation !== request.operation
          ) {
            throw new HostHelperError("IDEMPOTENCY_CONFLICT", "idempotency binding conflicts");
          }
          if (prior.result === undefined) {
            throw new HostHelperError(
              "INVALID_TRANSITION",
              "accepted effect requires reconciliation before replay",
            );
          }
          return { replay: true, result: prior.result };
        }
        const scope = `${request.installationId}:${request.runId}`;
        const counter = BigInt(request.counter);
        const highest = BigInt(draft.counters[scope] ?? "-1");
        if (counter <= highest || draft.nonces[request.nonce] !== undefined) {
          throw new HostHelperError("REPLAY", "counter or nonce was replayed");
        }
        const fence = BigInt(request.fenceToken);
        const currentFence = BigInt(draft.fences[request.runId] ?? request.fenceToken);
        if (fence < currentFence)
          throw new HostHelperError("STALE_FENCE", "request fence is stale");
        draft.counters[scope] = request.counter;
        draft.nonces[request.nonce] = request.requestDigest;
        draft.fences[request.runId] = request.fenceToken;
        draft.idempotency[request.idempotencyKey] = {
          requestDigest: request.requestDigest,
          operation: request.operation,
          requestId: request.requestId,
          commandId: request.commandId,
          runId: request.runId,
          attemptId: request.attemptId,
          fenceToken: request.fenceToken,
          state: "ACCEPTED",
        };
        return { replay: false };
      });
    },
    async complete(request, result) {
      await transaction((draft) => {
        const admission = draft.idempotency[request.idempotencyKey];
        if (admission?.requestDigest !== request.requestDigest) {
          throw new HostHelperError("INTERNAL", "durable admission is missing");
        }
        admission.state = result.state;
        admission.result = structuredClone(result);
        const resourceId =
          request.operation === "vm.create"
            ? request.payload.runtimeId
            : request.operation === "provider.stage"
              ? request.payload.jobId
              : request.operation === "source.acquire"
                ? result.result?.sourceCommandId
                : undefined;
        if (resourceId !== undefined) {
          draft.resources[resourceId] = {
            resourceId,
            operation: request.operation,
            runId: request.runId,
            attemptId: request.attemptId,
            fenceToken: request.fenceToken,
            creationNonce:
              result.result?.creationNonce ?? result.result?.runtimeCreationNonce ?? request.nonce,
            state: result.state,
          };
        }
        const cleanupId =
          request.operation === "vm.destroy" || request.operation === "vm.emergencyStop"
            ? request.payload.runtimeId
            : request.operation === "provider.cleanup"
              ? request.payload.jobId
              : undefined;
        if (cleanupId !== undefined && result.result?.cleanup?.state === "COMPLETE") {
          delete draft.resources[cleanupId];
          draft.cleanup[cleanupId] = structuredClone(result.result.cleanup);
        }
      });
    },
    async snapshot() {
      await queue;
      return structuredClone(state);
    },
    async pendingAccepted() {
      await queue;
      return Object.entries(state.idempotency)
        .filter(([, entry]) => entry.state === "ACCEPTED" && entry.result === undefined)
        .map(([idempotencyKey, entry]) => ({ idempotencyKey, ...structuredClone(entry) }));
    },
    async reconcileAccepted(idempotencyKey, requestDigest, result) {
      await transaction((draft) => {
        const entry = draft.idempotency[idempotencyKey];
        if (
          entry?.state !== "ACCEPTED" ||
          entry.requestDigest !== requestDigest ||
          entry.result !== undefined
        ) {
          throw new HostHelperError("INVALID_TRANSITION", "accepted reconciliation does not bind");
        }
        entry.state = result.state;
        entry.result = structuredClone(result);
      });
    },
    async recordMaintenance(resourceId, phase, detail = {}) {
      await transaction((draft) => {
        draft.cleanup[resourceId] = {
          phase,
          detail: structuredClone(detail),
          recordedAt: new Date().toISOString(),
        };
      });
    },
    async close() {
      await queue;
      await lock.close();
      await unlink(lockPath);
    },
  });
}

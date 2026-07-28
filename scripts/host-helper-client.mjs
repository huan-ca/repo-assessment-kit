import { constants } from "node:fs";
import { open, lstat, rename, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";
import { dirname, join } from "node:path";

import {
  HOST_HELPER_PATHS,
  HostHelperError,
  createFrameDecoder,
  encodeFrame,
  newRequestIdentity,
  signHostRequest,
  verifyHostResponse,
  parseStrictJsonBytes,
} from "./host-helper-protocol.mjs";
import { loadProductionInstallationConfig } from "./production-installation-config.mjs";

async function checkedFile(path, mode, expectedBytes, owner = process.getuid?.(), group) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      (before.mode & 0o777) !== mode ||
      (owner !== undefined && before.uid !== owner) ||
      (group !== undefined && before.gid !== group) ||
      (expectedBytes !== undefined && before.size !== expectedBytes)
    ) {
      throw new Error("unsafe");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      throw new Error("changed");
    }
    return bytes;
  } catch (error) {
    throw new HostHelperError(
      "HELPER_AUTHORITY_UNAVAILABLE",
      "helper authority file is unavailable",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

async function checkedFileHash(path, mode, maximumBytes, owner, group) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.uid !== owner ||
      before.gid !== group ||
      (before.mode & 0o777) !== mode ||
      before.size > maximumBytes
    ) {
      throw new Error("unsafe transfer file");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      throw new Error("transfer changed");
    }
    return `sha256:${hash.digest("hex")}`;
  } catch (error) {
    throw new HostHelperError("HELPER_TRANSFER_INVALID", "transfer file authority is invalid", {
      cause: error,
    });
  } finally {
    await handle?.close();
  }
}

async function checkedSocket(path, owner) {
  const info = await lstat(path).catch(() => undefined);
  if (
    info === undefined ||
    info.isSymbolicLink() ||
    !info.isSocket() ||
    (info.mode & 0o777) !== 0o600 ||
    (owner !== undefined && info.uid !== owner)
  ) {
    throw new HostHelperError(
      "HELPER_SOCKET_UNAVAILABLE",
      "production helper socket is unavailable",
    );
  }
  return info;
}

async function reserveCounter(paths, fixtureInitial) {
  let lock;
  try {
    lock = await open(
      paths.clientCounterLock,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    const existing = await lstat(paths.clientCounterLock).catch(() => undefined);
    if (
      existing?.isFile() &&
      !existing.isSymbolicLink() &&
      (existing.mode & 0o777) === 0o600 &&
      Date.now() - existing.mtimeMs > 60_000
    ) {
      await unlink(paths.clientCounterLock);
      return reserveCounter(paths, fixtureInitial);
    }
    throw new HostHelperError("HELPER_COUNTER_BUSY", "helper counter reservation is unavailable", {
      cause: error,
    });
  }
  try {
    let prior = 0n;
    try {
      const bytes = await checkedFile(paths.clientCounter, 0o600, undefined);
      const text = bytes.toString("utf8");
      if (!/^(?:0|[1-9]\d*)\n$/u.test(text)) throw new Error("invalid counter");
      prior = BigInt(text.trim());
    } catch (error) {
      const absent = await lstat(paths.clientCounter).catch((cause) => cause?.code === "ENOENT");
      if (absent !== true) throw error;
      prior = BigInt(fixtureInitial ?? 0);
    }
    const next = prior + 1n;
    const temporary = `${paths.clientCounter}.tmp-${process.pid}`;
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(`${next}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, paths.clientCounter);
    const directory = await open(dirname(paths.clientCounter), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return next;
  } finally {
    await lock.close();
    await unlink(paths.clientCounterLock).catch(() => {});
  }
}

export function createProductionHostHelperClient(options = {}) {
  const fixture = options.mode === "fixture-test-only";
  const paths = fixture ? { ...HOST_HELPER_PATHS, ...options.paths } : HOST_HELPER_PATHS;
  return Object.freeze({
    async request(operation, payload, context) {
      const { installationId, runId, attemptId, fenceToken, commandId } = context;
      let installation;
      if (!fixture) {
        installation = (await loadProductionInstallationConfig()).config;
        if (
          installation?.schemaVersion !== "rak-host-helper-config/1.0.0" ||
          installation.clientUid !== process.getuid?.() ||
          !process.getgroups?.().includes(installation.clientGid)
        ) {
          throw new HostHelperError(
            "HELPER_AUTHORITY_UNAVAILABLE",
            "helper client identity binding failed",
          );
        }
        await checkedFile(paths.config, 0o440, undefined, 0, installation.clientGid);
      }
      const clientUid = fixture ? process.getuid?.() : installation.clientUid;
      const socketIdentity = await checkedSocket(paths.socket, clientUid);
      const key = await checkedFile(paths.clientKey, 0o600, 32, clientUid);
      const counter = await reserveCounter(
        paths,
        fixture ? (options.initialCounter ?? 0) : undefined,
      );
      const now = options.clock?.() ?? Date.now();
      const identity = newRequestIdentity();
      const request = signHostRequest(
        {
          protocolVersion: "1.0.0",
          installationId,
          requestId: identity.requestId,
          commandId,
          runId,
          attemptId,
          fenceToken,
          idempotencyKey: commandId,
          counter: String(counter),
          nonce: identity.nonce,
          issuedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
          operation,
          payload,
          requestDigest: "",
          mac: "",
        },
        key,
      );
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection({ path: paths.socket });
        let settled = false;
        const decoder = createFrameDecoder((response) => {
          try {
            settled = true;
            resolve(verifyHostResponse(response, request, key));
          } catch (error) {
            reject(error);
          } finally {
            socket.destroy();
          }
        });
        socket.setTimeout(65_000, () =>
          socket.destroy(new HostHelperError("HELPER_TIMEOUT", "helper response timed out")),
        );
        socket.on("connect", async () => {
          try {
            const after = await checkedSocket(paths.socket, clientUid);
            if (after.dev !== socketIdentity.dev || after.ino !== socketIdentity.ino) {
              throw new HostHelperError("HELPER_SOCKET_CHANGED", "helper socket identity changed");
            }
            let verified;
            if (fixture && typeof options.peerCredentialVerifier === "function") {
              verified = await options.peerCredentialVerifier(undefined, socket);
            } else {
              const verifier = installation.peerCredentialVerifier;
              const binary = await checkedFile(paths.peerVerifier, 0o755, undefined, 0);
              if (
                verifier?.path !== paths.peerVerifier ||
                verifier.ownerUid !== 0 ||
                verifier.mode !== "0755" ||
                verifier.platform !== process.platform ||
                verifier.sha256 !== `sha256:${createHash("sha256").update(binary).digest("hex")}`
              ) {
                throw new HostHelperError(
                  "HELPER_PEER_ATTESTATION_UNAVAILABLE",
                  "peer verifier installation binding failed",
                );
              }
              verified = await new Promise((verifyResolve, verifyReject) => {
                const child = spawn(
                  paths.peerVerifier,
                  ["verify", "--fd", "3", "--expected-uid", "0"],
                  {
                    shell: false,
                    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
                    stdio: ["ignore", "pipe", "pipe", socket],
                  },
                );
                const chunks = [];
                let bytes = 0;
                child.stdout.on("data", (chunk) => {
                  bytes += chunk.byteLength;
                  if (bytes > 1024) child.kill("SIGKILL");
                  else chunks.push(chunk);
                });
                child.stderr.on("data", (chunk) => {
                  if (chunk.byteLength > 1024) child.kill("SIGKILL");
                });
                child.once("error", verifyReject);
                child.once("close", (code) => {
                  const output = Buffer.concat(chunks).toString("utf8");
                  verifyResolve(code === 0 && output === '{"verified":true,"uid":0}\n');
                });
              });
            }
            if (verified !== true) {
              throw new HostHelperError(
                "HELPER_PEER_ATTESTATION_UNAVAILABLE",
                "root helper peer credentials are unavailable",
              );
            }
            socket.end(encodeFrame(request));
          } catch (error) {
            socket.destroy(error);
          }
        });
        socket.on("data", decoder);
        socket.on("end", () => {
          try {
            decoder.finish();
          } catch (error) {
            if (!settled) reject(error);
          }
        });
        socket.on("error", reject);
      });
    },
    providerPreflight(provider, payload, context) {
      return this.request("provider.preflight", { provider, ...payload }, context);
    },
    providerStage(payload, context) {
      return this.request("provider.stage", payload, context);
    },
    providerExecute(payload, context) {
      return this.request("provider.execute", payload, context);
    },
    providerCancel(payload, context) {
      return this.request("provider.cancel", payload, context);
    },
    providerCleanup(payload, context) {
      return this.request("provider.cleanup", payload, context);
    },
    providerStatus(payload, context) {
      return this.request("provider.status", payload, context);
    },
    acquireSsh(payload, context) {
      const {
        url,
        ref,
        acquisitionProfileId,
        approvalIds = [],
        snapshotMode = "commit-only",
      } = payload;
      return this.request(
        "source.acquire",
        {
          source: {
            kind: "ssh-git",
            acquisitionProfileId,
            url,
            ...(ref === undefined ? {} : { ref }),
          },
          snapshotMode,
          acquireSubmodules: false,
          acquireLfs: false,
          approvalIds,
          limitsProfileId: acquisitionProfileId,
        },
        context,
      );
    },
    sourceStatus(sourceCommandIdOrPayload, context) {
      const sourceCommandId =
        typeof sourceCommandIdOrPayload === "string"
          ? sourceCommandIdOrPayload
          : sourceCommandIdOrPayload?.sourceCommandId;
      return this.request("source.status", { sourceCommandId }, context);
    },
    finalizeSsh(
      { sourceCommandId, expectedSnapshotId, expectedManifestDigest, expectedArchiveDigest },
      context,
    ) {
      return this.request(
        "source.finalize",
        {
          sourceCommandId,
          expectedSnapshotId,
          expectedManifestDigest,
          expectedArchiveDigest,
        },
        context,
      );
    },
    async verifySshTransfer({ sourceCommandId, manifestDigest, archiveDigest }, context) {
      for (const value of [context.installationId, context.runId, sourceCommandId]) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
          throw new HostHelperError("HELPER_TRANSFER_INVALID", "transfer identity is invalid");
        }
      }
      const root = join(paths.transferRoot, context.installationId, context.runId, sourceCommandId);
      const rootInfo = await lstat(root).catch(() => undefined);
      const transferInstallation = fixture
        ? undefined
        : (await loadProductionInstallationConfig()).config;
      const group = fixture ? process.getgid?.() : transferInstallation.clientGid;
      if (
        rootInfo === undefined ||
        rootInfo.isSymbolicLink() ||
        !rootInfo.isDirectory() ||
        (rootInfo.mode & 0o777) !== 0o750 ||
        (!fixture && (rootInfo.uid !== 0 || rootInfo.gid !== group))
      ) {
        throw new HostHelperError(
          "HELPER_TRANSFER_INVALID",
          "transfer directory authority is invalid",
        );
      }
      const manifest = await checkedFile(
        join(root, "manifest.json"),
        0o440,
        undefined,
        fixture ? process.getuid?.() : 0,
        group,
      );
      const computedArchiveDigest = await checkedFileHash(
        join(root, "snapshot.tar"),
        0o440,
        1024 * 1024 * 1024,
        fixture ? process.getuid?.() : 0,
        group,
      );
      if (
        `sha256:${createHash("sha256").update(manifest).digest("hex")}` !== manifestDigest ||
        computedArchiveDigest !== archiveDigest
      ) {
        throw new HostHelperError(
          "HELPER_TRANSFER_DIGEST_MISMATCH",
          "transfer digest or size is invalid",
        );
      }
      const manifestDocument = parseStrictJsonBytes(manifest, "SSH snapshot manifest");
      if (
        manifestDocument === null ||
        typeof manifestDocument !== "object" ||
        Array.isArray(manifestDocument)
      ) {
        throw new HostHelperError("HELPER_TRANSFER_INVALID", "transfer manifest is invalid");
      }
      return Object.freeze({
        sourceCommandId,
        manifestDigest,
        archiveDigest,
        archivePath: join(root, "snapshot.tar"),
        manifest: manifestDocument,
      });
    },
    releaseSsh(sourceCommandId, context) {
      return this.request("source.release", { sourceCommandId }, context);
    },
    vmPreflight(payload, context) {
      return this.request("vm.preflight", payload, context);
    },
    vmCreate(payload, context) {
      return this.request("vm.create", payload, context);
    },
    vmStageSnapshot(payload, context) {
      return this.request("vm.stageSnapshot", payload, context);
    },
    vmCompile(payload, context) {
      return this.request("vm.compile", payload, context);
    },
    vmAcquireBuildInputs(payload, context) {
      return this.request("vm.acquireBuildInputs", payload, context);
    },
    vmBuild(payload, context) {
      return this.request("vm.build", payload, context);
    },
    vmStart(payload, context) {
      return this.request("vm.start", payload, context);
    },
    vmProbe(payload, context) {
      return this.request("vm.probe", payload, context);
    },
    vmCollect(payload, context) {
      return this.request("vm.collect", payload, context);
    },
    vmStatus(runtimeId, context) {
      return this.request("vm.status", { runtimeId }, context);
    },
    vmHeartbeat(runtimeId, context) {
      return this.request("vm.heartbeat", { runtimeId }, context);
    },
    vmPause(payload, context) {
      return this.request("vm.pause", payload, context);
    },
    vmResume(payload, context) {
      return this.request("vm.resume", payload, context);
    },
    vmStop(payload, context) {
      return this.request("vm.stop", payload, context);
    },
    vmDestroy(payload, context) {
      return this.request("vm.destroy", payload, context);
    },
    secretStore(payload, context) {
      return this.request("secret.store", payload, context);
    },
    secretConsume(payload, context) {
      return this.request("secret.consume", payload, context);
    },
    secretRevoke(payload, context) {
      return this.request("secret.revoke", payload, context);
    },
    requestGuardAdmit(payload, context) {
      return this.request("request-guard.admit", payload, context);
    },
    requestGuardIssue(payload, context) {
      return this.request("request-guard.issue", payload, context);
    },
    requestGuardRevoke(payload, context) {
      return this.request("request-guard.revoke", payload, context);
    },
    emergencyStop(runtimeId, reason, context) {
      return this.request("vm.emergencyStop", { runtimeId, reason }, context);
    },
    reconcile(runIds, context) {
      return this.request(
        "reconcile.list",
        { installationId: context.installationId, runIds },
        context,
      );
    },
  });
}

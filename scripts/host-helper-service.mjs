import net from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, chown, lstat, open } from "node:fs/promises";

import {
  HOST_HELPER_PATHS,
  HostHelperError,
  createFrameDecoder,
  encodeFrame,
  signHostResponse,
  validateHostOperationResult,
  validateHostRequest,
} from "./host-helper-protocol.mjs";
import { createHostHelperJournal } from "./host-helper-journal.mjs";
import { createProductionHostDrivers, validateFixedOperation } from "./host-helper-operations.mjs";
import { loadProductionInstallationConfig } from "./production-installation-config.mjs";

const ERROR_CODES = new Set([
  "PROTOCOL_VERSION",
  "AUTH_FAILED",
  "REPLAY",
  "EXPIRED",
  "STALE_FENCE",
  "IDEMPOTENCY_CONFLICT",
  "UNKNOWN_REGISTERED_ID",
  "INVALID_TRANSITION",
  "POLICY_REJECTED",
  "RESOURCE_LIMIT",
  "NOT_CHECKPOINTABLE",
  "RESOURCE_NOT_FOUND",
  "INTERNAL",
]);

async function checkedAuthority(path, mode, expectedBytes, owner = 0) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.uid !== owner ||
      (before.mode & 0o777) !== mode ||
      (expectedBytes !== undefined && before.size !== expectedBytes)
    )
      throw new Error("unsafe authority");
    const bytes = await file.readFile();
    const after = await file.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    )
      throw new Error("authority changed");
    return bytes;
  } catch (error) {
    throw new HostHelperError("AUTH_FAILED", "helper authority is invalid", { cause: error });
  } finally {
    await file?.close();
  }
}

function responseBase(request, state) {
  const safe = (value) =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
      ? value
      : "invalid";
  return {
    protocolVersion: "1.0.0",
    requestId: safe(request?.requestId),
    commandId: safe(request?.commandId),
    operation: safe(request?.operation),
    requestDigest:
      typeof request?.requestDigest === "string" &&
      /^sha256:[a-f0-9]{64}$/u.test(request.requestDigest)
        ? request.requestDigest
        : `sha256:${"0".repeat(64)}`,
    state,
    heartbeatAt: new Date().toISOString(),
  };
}

export async function createHostHelperService(options = {}) {
  const fixture = options.mode === "fixture-test-only";
  const paths = fixture ? { ...HOST_HELPER_PATHS, ...options.paths } : HOST_HELPER_PATHS;
  if (!fixture && typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new HostHelperError("AUTH_FAILED", "production helper must run as root");
  }
  const config =
    fixture && options.config ? options.config : (await loadProductionInstallationConfig()).config;
  const key =
    fixture && options.key
      ? options.key
      : await checkedAuthority(paths.clientKey, 0o600, 32, config.clientUid);
  if (!Buffer.isBuffer(key) || key.byteLength !== 32) {
    throw new HostHelperError("AUTH_FAILED", "helper client key is invalid");
  }
  const journal =
    fixture && options.journal
      ? options.journal
      : await createHostHelperJournal(paths.journalRoot, config.installationId, {
          mode: fixture ? "fixture-test-only" : "production",
        });
  const drivers =
    fixture && options.drivers ? options.drivers : createProductionHostDrivers(config);
  const clock = fixture && options.clock ? options.clock : Date.now;

  const verifyClientPeer = async (socket) => {
    if (fixture) return options.peerCredentialVerifier?.(undefined, socket) ?? true;
    const verifier = config.peerCredentialVerifier;
    const verifierBytes = await checkedAuthority(HOST_HELPER_PATHS.peerVerifier, 0o755);
    if (
      verifier?.path !== HOST_HELPER_PATHS.peerVerifier ||
      verifier.ownerUid !== 0 ||
      verifier.mode !== "0755" ||
      verifier.platform !== process.platform ||
      verifier.sha256 !== `sha256:${createHash("sha256").update(verifierBytes).digest("hex")}`
    ) {
      throw new HostHelperError("AUTH_FAILED", "peer verifier is not registered");
    }
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        verifier.path,
        ["verify", "--fd", "3", "--expected-uid", String(config.clientUid)],
        {
          shell: false,
          env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
          stdio: ["ignore", "pipe", "pipe", socket],
        },
      );
      const output = [];
      let bytes = 0;
      child.stdout.on("data", (chunk) => {
        bytes += chunk.byteLength;
        if (bytes > 1024) child.kill("SIGKILL");
        else output.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        if (chunk.byteLength > 1024) child.kill("SIGKILL");
      });
      child.once("error", reject);
      child.once("close", (code) =>
        resolve({
          code,
          output: Buffer.concat(output).toString("utf8"),
        }),
      );
    });
    return result.code === 0 && result.output === `{"verified":true,"uid":${config.clientUid}}\n`;
  };

  const handle = async (request) => {
    try {
      validateHostRequest(request, { key, now: clock() });
      if (request.installationId !== config.installationId) {
        throw new HostHelperError("AUTH_FAILED", "installation binding failed");
      }
      const registration = validateFixedOperation(request.operation, request.payload, config);
      const admission = await journal.admit(request);
      if (admission.replay) return admission.result;
      const driver = drivers[request.operation];
      if (typeof driver !== "function") {
        throw new HostHelperError("UNKNOWN_REGISTERED_ID", "operation driver is unavailable");
      }
      // Admission is durable before the effect. Drivers only receive the registered record,
      // authenticated payload, and immutable authority context.
      const result = await driver(structuredClone(request.payload), {
        installationId: request.installationId,
        runId: request.runId,
        attemptId: request.attemptId,
        fenceToken: request.fenceToken,
        creationNonce: registration.creationNonce,
        registration: structuredClone(registration),
        recordPhase:
          request.operation === "vm.emergencyStop"
            ? (phase) =>
                journal.recordMaintenance(request.payload.runtimeId, phase, {
                  runId: request.runId,
                  fenceToken: request.fenceToken,
                })
            : undefined,
      });
      validateHostOperationResult(request.operation, result, result?.state ?? "SUCCEEDED");
      const response = signHostResponse(
        { ...responseBase(request, result?.state ?? "SUCCEEDED"), result },
        key,
      );
      await journal.complete(request, response);
      return response;
    } catch (error) {
      const code = ERROR_CODES.has(error?.code) ? error.code : "INTERNAL";
      const response = signHostResponse(
        {
          ...responseBase(request, "REJECTED"),
          error: {
            code,
            message: code,
            retryable: code === "INTERNAL",
            cleanupRequired: code === "INTERNAL" || code === "INVALID_TRANSITION",
          },
        },
        key,
      );
      if (request?.idempotencyKey && request?.requestDigest) {
        await journal.complete(request, response).catch(() => {});
      }
      return response;
    }
  };

  return Object.freeze({
    handle,
    journal,
    async reconcile() {
      const snapshot = await journal.snapshot();
      const driver = drivers["reconcile.list"];
      if (typeof driver !== "function") {
        throw new HostHelperError("UNKNOWN_REGISTERED_ID", "reconcile driver is unavailable");
      }
      await journal.recordMaintenance("installation", "RECONCILING");
      const result = await driver(
        {
          installationId: config.installationId,
          runIds: [...new Set(Object.values(snapshot.resources).map((item) => item.runId))],
        },
        {
          installationId: config.installationId,
          runId: "maintenance",
          attemptId: "maintenance",
          fenceToken: "0",
          registration: config.operations["reconcile.list"],
        },
      );
      validateHostOperationResult("reconcile.list", result, result?.state);
      if (result.installationId !== config.installationId) {
        throw new HostHelperError(
          "INVALID_TRANSITION",
          "reconcile result installation binding is invalid",
        );
      }
      const pending = await journal.pendingAccepted();
      const reconciledCommands = result.reconciledCommands ?? [];
      if (
        !Array.isArray(reconciledCommands) ||
        reconciledCommands.length !== pending.length ||
        new Set(reconciledCommands.map((item) => item?.idempotencyKey)).size !==
          reconciledCommands.length ||
        reconciledCommands.some(
          (item) =>
            item === null ||
            typeof item !== "object" ||
            Array.isArray(item) ||
            Object.keys(item).sort().join(",") !== "idempotencyKey,requestDigest,result",
        )
      ) {
        throw new HostHelperError("INTERNAL", "reconcile command results are invalid");
      }
      for (const command of reconciledCommands) {
        const expected = pending.find(
          (item) =>
            item.idempotencyKey === command.idempotencyKey &&
            item.requestDigest === command.requestDigest,
        );
        if (expected === undefined) {
          throw new HostHelperError(
            "INVALID_TRANSITION",
            "reconcile result does not bind a pending command",
          );
        }
        if (
          command.result === null ||
          typeof command.result !== "object" ||
          Array.isArray(command.result) ||
          !["SUCCEEDED", "REJECTED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(
            command.result.state,
          )
        ) {
          throw new HostHelperError("INVALID_TRANSITION", "reconcile result is not terminal");
        }
        const response = signHostResponse(
          {
            protocolVersion: "1.0.0",
            requestId: expected.requestId,
            commandId: expected.commandId,
            operation: expected.operation,
            requestDigest: expected.requestDigest,
            state: command.result.state,
            heartbeatAt: new Date(clock()).toISOString(),
            result: structuredClone(command.result),
          },
          key,
        );
        validateHostOperationResult(expected.operation, command.result, command.result.state);
        await journal.reconcileAccepted(command.idempotencyKey, command.requestDigest, response);
      }
      await journal.recordMaintenance("installation", "RECONCILED", {
        state: result.state,
        pendingCount: pending.length,
        reconciledCount: reconciledCommands.length,
      });
      return result;
    },
    async emergencyStop(runId, runtimeId) {
      const snapshot = await journal.snapshot();
      const resource = snapshot.resources[runtimeId];
      if (
        resource?.runId !== runId ||
        typeof resource.creationNonce !== "string" ||
        resource.creationNonce.length === 0
      ) {
        throw new HostHelperError("RESOURCE_NOT_FOUND", "registered runtime was not found");
      }
      const driver = drivers["vm.emergencyStop"];
      await journal.recordMaintenance(runtimeId, "FENCED", {
        runId,
        creationNonce: resource.creationNonce,
      });
      const result = await driver(
        { runtimeId, reason: "OPERATOR_STOP" },
        {
          installationId: config.installationId,
          runId,
          attemptId: resource.attemptId,
          fenceToken: resource.fenceToken,
          creationNonce: resource.creationNonce,
          registration: config.operations["vm.emergencyStop"],
          recordPhase: (phase) =>
            journal.recordMaintenance(runtimeId, phase, {
              runId,
              creationNonce: resource.creationNonce,
            }),
        },
      );
      await journal.recordMaintenance(runtimeId, "STOPPED", {
        cleanup: result.cleanup,
      });
      return result;
    },
    async listen() {
      const existing = await lstat(paths.socket).catch((error) =>
        error?.code === "ENOENT" ? undefined : Promise.reject(error),
      );
      if (existing !== undefined) {
        throw new HostHelperError("AUTH_FAILED", "helper singleton socket already exists");
      }
      const server = net.createServer({ allowHalfOpen: true }, (socket) => {
        socket.pause();
        let received = false;
        const decoder = createFrameDecoder(async (request) => {
          if (received) {
            socket.destroy();
            return;
          }
          received = true;
          const response = await handle(request);
          socket.end(encodeFrame(response));
        });
        socket.on("data", (chunk) => {
          try {
            decoder(chunk);
          } catch {
            socket.destroy();
          }
        });
        socket.on("end", () => {
          if (!received) socket.destroy();
        });
        socket.on("error", () => {});
        void verifyClientPeer(socket).then(
          (verified) => {
            if (verified === true) socket.resume();
            else socket.destroy();
          },
          () => socket.destroy(),
        );
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(paths.socket, resolve);
      });
      await chmod(paths.socket, 0o600);
      if (!fixture) await chown(paths.socket, config.clientUid, config.clientGid);
      return server;
    },
  });
}

import { spawn } from "node:child_process";
import { createHash, verify } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import {
  canonicalJson,
  digestCanonical,
  HostHelperError,
  parseStrictJsonBytes,
  validateHostOperationPayload,
} from "./host-helper-protocol.mjs";
import { validateProviderTaskEnvelope } from "../container/provider-task.mjs";

const PROVIDERS = new Set(["codex", "claude-code"]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const IMMUTABLE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,300}@sha256:[a-f0-9]{64}$/u;
const ALLOWED_OPERATIONS = new Set([
  "source.status",
  "source.cancel",
  "source.finalize",
  "source.release",
  "analyzer.start",
  "analyzer.status",
  "analyzer.pause",
  "analyzer.cancel",
  "analyzer.finalize",
  "vm.preflight",
  "vm.create",
  "vm.stageSnapshot",
  "vm.compile",
  "vm.acquireBuildInputs",
  "vm.build",
  "vm.start",
  "vm.probe",
  "vm.collect",
  "vm.status",
  "vm.heartbeat",
  "vm.pause",
  "vm.resume",
  "vm.stop",
  "vm.destroy",
  "provider.preflight",
  "provider.stage",
  "provider.execute",
  "provider.cancel",
  "provider.cleanup",
  "provider.status",
  "source.acquire",
  "secret.store",
  "secret.consume",
  "secret.revoke",
  "request-guard.admit",
  "request-guard.issue",
  "request-guard.revoke",
  "vm.emergencyStop",
  "reconcile.list",
]);
const ARCHITECTURE_PAYLOAD_KEYS = Object.freeze({
  "source.status": ["sourceCommandId"],
  "source.cancel": ["sourceCommandId", "reason"],
  "source.finalize": [
    "sourceCommandId",
    "expectedSnapshotId",
    "expectedManifestDigest",
    "expectedArchiveDigest",
  ],
  "source.release": ["sourceCommandId"],
  "analyzer.start": [
    "jobId",
    "snapshotId",
    "pluginId",
    "configProfileId",
    "limitsProfileId",
    "outputQuotaBytes",
  ],
  "analyzer.status": ["jobId"],
  "analyzer.pause": ["jobId", "deadlineAt"],
  "analyzer.cancel": ["jobId", "reason", "deadlineAt"],
  "analyzer.finalize": ["jobId", "expectedReceipts"],
  "vm.preflight": ["nativeArchitecture", "vmProfileId", "guestImageDigest"],
  "vm.create": ["runtimeId", "snapshotId", "vmProfileId", "guestImageDigest", "nativeArchitecture"],
  "vm.stageSnapshot": ["runtimeId", "snapshotId", "archiveDigest", "manifestDigest"],
  "vm.compile": ["runtimeId", "candidateRelPaths", "policyId", "approvalIds"],
  "vm.acquireBuildInputs": ["runtimeId", "compiledPlanId", "approvalId"],
  "vm.build": ["runtimeId", "compiledPlanId", "limitsProfileId"],
  "vm.start": ["runtimeId", "compiledPlanId", "secretEnvelopeIds"],
  "vm.probe": ["runtimeId", "signedControlPlan", "secretEnvelopeIds"],
  "vm.collect": ["runtimeId", "declaredArtifactIds", "totalByteLimit"],
  "vm.status": ["runtimeId"],
  "vm.heartbeat": ["runtimeId"],
  "vm.pause": ["runtimeId", "deadlineAt"],
  "vm.resume": ["runtimeId", "compiledPlanId"],
  "vm.stop": ["runtimeId", "deadlineAt"],
  "vm.destroy": ["runtimeId", "preserveDeclaredReceipts"],
});

function fail(code, message) {
  throw new HostHelperError(code, message);
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value, keys) {
  if (!record(value)) fail("POLICY_REJECTED", "operation payload is not an object");
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("POLICY_REJECTED", "operation payload has missing or unknown fields");
  }
}
function safeId(value) {
  return typeof value === "string" && SAFE_ID.test(value);
}
function digest(value) {
  return typeof value === "string" && DIGEST.test(value);
}

export function validateFixedOperation(operation, payload, config) {
  if (!ALLOWED_OPERATIONS.has(operation)) {
    fail("UNKNOWN_REGISTERED_ID", "operation is not registered");
  }
  validateHostOperationPayload(operation, payload);
  if (ARCHITECTURE_PAYLOAD_KEYS[operation] !== undefined) {
    exact(payload, ARCHITECTURE_PAYLOAD_KEYS[operation]);
    for (const [name, value] of Object.entries(payload)) {
      if (
        /(?:Id|Ids)$/u.test(name) &&
        !(safeId(value) || (Array.isArray(value) && value.every(safeId)))
      ) {
        fail("POLICY_REJECTED", "architecture operation contains an invalid registered ID");
      }
    }
    if (
      operation === "vm.preflight" &&
      (!["amd64", "arm64"].includes(payload.nativeArchitecture) ||
        !safeId(payload.vmProfileId) ||
        !digest(payload.guestImageDigest))
    ) {
      fail("POLICY_REJECTED", "VM preflight binding is invalid");
    }
  } else
    switch (operation) {
      case "provider.preflight":
        exact(payload, [
          "provider",
          "releaseAuthorityDigest",
          "immutableImageReference",
          "providerHomeAuthorityDigest",
          "networkPolicyDigest",
          "outputSchemaDigest",
        ]);
        if (
          !PROVIDERS.has(payload.provider) ||
          !IMMUTABLE_IMAGE.test(payload.immutableImageReference) ||
          ![
            payload.releaseAuthorityDigest,
            payload.providerHomeAuthorityDigest,
            payload.networkPolicyDigest,
            payload.outputSchemaDigest,
          ].every(digest)
        ) {
          fail("POLICY_REJECTED", "provider preflight binding is invalid");
        }
        break;
      case "provider.stage": {
        exact(payload, [
          "jobId",
          "provider",
          "envelopeDigest",
          "taskBytesBase64",
          "taskBytesDigest",
          "outputSchemaDigest",
          "providerHomeAuthorityDigest",
        ]);
        const taskBytes =
          typeof payload.taskBytesBase64 === "string"
            ? Buffer.from(payload.taskBytesBase64, "base64")
            : Buffer.alloc(0);
        let taskEnvelope;
        try {
          taskEnvelope = parseStrictJsonBytes(taskBytes, "provider task envelope");
          validateProviderTaskEnvelope(taskEnvelope, payload.provider);
        } catch {
          fail("POLICY_REJECTED", "provider task bytes are invalid");
        }
        if (
          !safeId(payload.jobId) ||
          !PROVIDERS.has(payload.provider) ||
          taskBytes.byteLength < 1 ||
          taskBytes.byteLength > 524_288 ||
          taskBytes.toString("base64") !== payload.taskBytesBase64 ||
          `sha256:${createHash("sha256").update(taskBytes).digest("hex")}` !==
            payload.taskBytesDigest ||
          digestCanonical(taskEnvelope) !== payload.envelopeDigest ||
          ![
            payload.envelopeDigest,
            payload.taskBytesDigest,
            payload.outputSchemaDigest,
            payload.providerHomeAuthorityDigest,
          ].every(digest)
        ) {
          fail("POLICY_REJECTED", "provider stage binding is invalid");
        }
        break;
      }
      case "provider.execute":
        exact(payload, [
          "jobId",
          "provider",
          "stagedTaskId",
          "immutableImageReference",
          "networkAttestationDigest",
          "deadlineAt",
          "wallSeconds",
          "outputBytes",
        ]);
        if (
          !safeId(payload.jobId) ||
          !safeId(payload.stagedTaskId) ||
          !PROVIDERS.has(payload.provider) ||
          !IMMUTABLE_IMAGE.test(payload.immutableImageReference) ||
          !digest(payload.networkAttestationDigest) ||
          !Number.isSafeInteger(payload.wallSeconds) ||
          payload.wallSeconds < 1 ||
          payload.wallSeconds > 7200 ||
          !Number.isSafeInteger(payload.outputBytes) ||
          payload.outputBytes < 1 ||
          payload.outputBytes > 16 * 1024 * 1024 ||
          !Number.isFinite(Date.parse(payload.deadlineAt))
        ) {
          fail("POLICY_REJECTED", "provider execute binding is invalid");
        }
        break;
      case "provider.cancel":
        exact(payload, ["jobId", "reasonCode"]);
        if (
          !safeId(payload.jobId) ||
          !["CANCELLED_BY_CALLER", "DEADLINE_EXPIRED", "FENCE_CHANGED", "EMERGENCY_STOP"].includes(
            payload.reasonCode,
          )
        ) {
          fail("POLICY_REJECTED", "provider cancellation binding is invalid");
        }
        break;
      case "provider.cleanup":
        exact(payload, ["jobId", "preserveReceiptIds"]);
        if (
          !Array.isArray(payload.preserveReceiptIds) ||
          payload.preserveReceiptIds.some((id) => !safeId(id))
        ) {
          fail("POLICY_REJECTED", "provider cleanup receipts are invalid");
        }
        break;
      case "provider.status":
        exact(payload, ["jobId"]);
        break;
      case "source.acquire":
        exact(payload, [
          "source",
          "snapshotMode",
          "acquireSubmodules",
          "acquireLfs",
          "approvalIds",
          "limitsProfileId",
        ]);
        if (
          !record(payload.source) ||
          payload.source.kind !== "ssh-git" ||
          Object.keys(payload.source).some(
            (key) => !["kind", "acquisitionProfileId", "url", "ref"].includes(key),
          ) ||
          !safeId(payload.source.acquisitionProfileId) ||
          !safeId(config.acquisitionProfiles?.[payload.source.acquisitionProfileId]?.sshHandleId) ||
          config.sshHandles?.[
            config.acquisitionProfiles?.[payload.source.acquisitionProfileId]?.sshHandleId
          ]?.url !== payload.source.url ||
          (payload.source.ref ?? null) !==
            (config.sshHandles?.[
              config.acquisitionProfiles?.[payload.source.acquisitionProfileId]?.sshHandleId
            ]?.ref ?? null) ||
          payload.limitsProfileId !== payload.source.acquisitionProfileId ||
          payload.snapshotMode !== "commit-only" ||
          payload.acquireSubmodules !== false ||
          payload.acquireLfs !== false ||
          !Array.isArray(payload.approvalIds) ||
          payload.approvalIds.some((approvalId) => !safeId(approvalId)) ||
          !safeId(payload.limitsProfileId)
        ) {
          fail("POLICY_REJECTED", "SSH acquisition payload is invalid");
        }
        break;
      case "secret.store":
        exact(payload, [
          "handleId",
          "purpose",
          "recipient",
          "approvalDigest",
          "expiresAt",
          "maxUses",
          "sealedValue",
        ]);
        if (
          !["target-service", "probe"].includes(payload.purpose) ||
          payload.maxUses !== 1 ||
          !digest(payload.approvalDigest) ||
          typeof payload.sealedValue !== "string" ||
          payload.sealedValue.length < 16 ||
          payload.sealedValue.length > 64 * 1024
        ) {
          fail("POLICY_REJECTED", "secret handle is invalid");
        }
        if (
          Date.parse(payload.expiresAt) <= Date.now() ||
          config.secretRecipients?.[payload.recipient]?.purpose !== payload.purpose
        ) {
          fail("POLICY_REJECTED", "secret recipient or expiry is invalid");
        }
        break;
      case "secret.consume":
        exact(payload, ["handleId", "purpose", "recipient", "runtimeCreationNonce"]);
        if (
          !safeId(payload.handleId) ||
          !["target-service", "probe"].includes(payload.purpose) ||
          !safeId(payload.recipient) ||
          !/^[a-f0-9]{64}$/u.test(payload.runtimeCreationNonce)
        ) {
          fail("POLICY_REJECTED", "secret consumption binding is invalid");
        }
        break;
      case "secret.revoke":
        exact(payload, ["handleId", "reasonCode"]);
        break;
      case "request-guard.admit":
        exact(payload, ["runtimeId", "signedControlPlan", "compiledPlanDigest"]);
        if (!digest(payload.compiledPlanDigest) || !record(payload.signedControlPlan)) {
          fail("POLICY_REJECTED", "request-guard plan is invalid");
        }
        exact(payload.signedControlPlan, [
          "payload",
          "payloadDigest",
          "signatureAlgorithm",
          "signingKeyId",
          "signature",
        ]);
        {
          const plan = payload.signedControlPlan;
          const authority = config.requestGuardAuthorities?.[plan.signingKeyId];
          const planDigest = digestCanonical(plan.payload);
          const signature = Buffer.from(plan.signature, "base64");
          if (
            plan.signatureAlgorithm !== "Ed25519" ||
            plan.payloadDigest !== planDigest ||
            plan.payload?.runtimeId !== payload.runtimeId ||
            plan.payload?.compiledPlanDigest !== payload.compiledPlanDigest ||
            authority?.algorithm !== "Ed25519" ||
            authority?.production !== true ||
            signature.toString("base64") !== plan.signature ||
            !verify(
              null,
              Buffer.concat([
                Buffer.from("rak-dynamic-control-plan/v1\0", "utf8"),
                Buffer.from(canonicalJson(plan.payload), "utf8"),
              ]),
              authority.publicKeyPem,
              signature,
            )
          ) {
            fail("POLICY_REJECTED", "request-guard signature or authority is invalid");
          }
        }
        break;
      case "request-guard.issue": {
        exact(payload, [
          "runtimeId",
          "runtimeCreationNonce",
          "snapshotId",
          "compiledPlanId",
          "compiledPlanDigest",
          "internalOrigins",
          "selectedProfileIds",
          "approvalIds",
          "plannedControlIds",
          "probeProfileId",
          "requestedExpiresAt",
        ]);
        const issuer = config.requestGuardIssuer;
        const registration = config.operations?.["request-guard.issue"];
        if (
          issuer?.profile !== "rak-dynamic-control-plan-issuer/1.0.0" ||
          !safeId(issuer.signingKeyId) ||
          !digest(issuer.publicKeySha256) ||
          !digest(issuer.catalogSha256) ||
          !record(issuer.signer) ||
          registration?.driverProfile !== "rak-fixed-runtime-broker/1.0.0" ||
          registration.binary !== issuer.signer.binary ||
          registration.ownerUid !== issuer.signer.ownerUid ||
          registration.mode !== issuer.signer.mode ||
          registration.sha256 !== issuer.signer.sha256 ||
          !Number.isSafeInteger(issuer.maxLifetimeSeconds) ||
          issuer.maxLifetimeSeconds < 1 ||
          issuer.maxLifetimeSeconds > 1800 ||
          Date.parse(payload.requestedExpiresAt) <= Date.now() ||
          Date.parse(payload.requestedExpiresAt) > Date.now() + issuer.maxLifetimeSeconds * 1000
        ) {
          fail("POLICY_REJECTED", "request-guard issuer authority is unavailable");
        }
        break;
      }
      case "request-guard.revoke":
        exact(payload, ["runtimeId", "controlPlanDigest", "reasonCode"]);
        break;
      case "vm.emergencyStop":
        exact(payload, ["runtimeId", "reason"]);
        if (
          !safeId(payload.runtimeId) ||
          !["SEV_0", "SEV_1", "SEV_2", "BOUNDARY_DRIFT", "OPERATOR_STOP"].includes(
            payload.reason,
          ) ||
          config.runtime?.lima?.instance !== payload.runtimeId
        ) {
          fail("POLICY_REJECTED", "emergency stop binding is invalid");
        }
        break;
      case "reconcile.list":
        exact(payload, ["installationId", "runIds"]);
        if (
          payload.installationId !== config.installationId ||
          !Array.isArray(payload.runIds) ||
          payload.runIds.some((id) => !safeId(id))
        ) {
          fail("POLICY_REJECTED", "reconcile run IDs are invalid");
        }
        break;
    }
  const registration = config.operations?.[operation];
  if (registration === undefined) fail("UNKNOWN_REGISTERED_ID", "operation is not configured");
  return registration;
}

export function createBlockedHostDrivers(reason = "HELPER_EXTERNAL_PREREQUISITE_UNAVAILABLE") {
  const blocked = async () => {
    throw new HostHelperError("POLICY_REJECTED", reason);
  };
  return Object.fromEntries([...ALLOWED_OPERATIONS].map((operation) => [operation, blocked]));
}

async function verifyFixedBinary(registration) {
  if (
    typeof registration?.binary !== "string" ||
    !registration.binary.startsWith("/") ||
    registration.ownerUid !== 0 ||
    registration.mode !== "0755" ||
    !DIGEST.test(registration.sha256)
  )
    fail("UNKNOWN_REGISTERED_ID", "fixed binary registration is invalid");
  let file;
  try {
    file = await open(registration.binary, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    const bytes = await file.readFile();
    if (
      !info.isFile() ||
      info.uid !== 0 ||
      (info.mode & 0o777) !== 0o755 ||
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== registration.sha256
    )
      fail("POLICY_REJECTED", "fixed binary installation binding failed");
  } catch (error) {
    if (error instanceof HostHelperError) throw error;
    fail("POLICY_REJECTED", "fixed binary is unavailable");
  } finally {
    await file?.close();
  }
  return registration.binary;
}

function runFixed(binary, argv, { timeout = 30_000, stdin = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, argv, {
      shell: false,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    const stdout = [];
    let total = 0;
    let stderrTotal = 0;
    child.stdout.on("data", (chunk) => {
      total += chunk.byteLength;
      if (total <= 64 * 1024) stdout.push(chunk);
      else child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      stderrTotal += chunk.byteLength;
      if (stderrTotal > 64 * 1024) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The process may already have exited.
        }
      }
    });
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The process may already have exited.
      }
    }, timeout);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new HostHelperError("INTERNAL", "fixed helper driver failed"));
      else resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(stdin);
  });
}

export function createProductionHostDrivers(config) {
  const drivers = createBlockedHostDrivers();
  for (const operation of ALLOWED_OPERATIONS) {
    const registration = config.operations?.[operation];
    if (registration?.driverProfile !== "rak-fixed-runtime-broker/1.0.0") continue;
    drivers[operation] = async (payload, context) => {
      const binary = await verifyFixedBinary(registration);
      const output = await runFixed(binary, ["operation", operation], {
        timeout: registration.timeoutMs,
        stdin: `${canonicalJson({
          protocolVersion: "1.0.0",
          operation,
          installationId: context.installationId,
          runId: context.runId,
          attemptId: context.attemptId,
          fenceToken: context.fenceToken,
          creationNonce: context.creationNonce,
          payload,
        })}\n`,
      });
      const result = parseStrictJsonBytes(Buffer.from(output), "fixed broker result");
      if (
        result === null ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        !["SUCCEEDED", "REJECTED", "FAILED", "RUNNING", "ACCEPTED"].includes(result.state)
      ) {
        fail("INTERNAL", "fixed broker result is invalid");
      }
      return result;
    };
  }
  const lima = config.runtime?.lima;
  if (
    lima?.profile === "rak-lima-plain-native/1.0.0" &&
    typeof lima.binary === "string" &&
    typeof lima.instance === "string"
  ) {
    drivers["vm.emergencyStop"] = async (payload, context) => {
      if (payload.runtimeId !== lima.instance || context.creationNonce !== lima.creationNonce) {
        fail("RESOURCE_NOT_FOUND", "runtime identity does not match");
      }
      const order = [];
      const residueIds = [];
      await context.recordPhase?.("verify-runtime-identity");
      try {
        await runFixed(await verifyFixedBinary(lima.broker), [
          "verify-runtime",
          payload.runtimeId,
          context.creationNonce,
        ]);
      } catch {
        fail("RESOURCE_NOT_FOUND", "live runtime creation nonce does not match");
      }
      for (const operation of ["fence", "revoke-network", "revoke-secrets", "cancel-cgroups"]) {
        order.push(operation);
        await context.recordPhase?.(operation);
        try {
          const binary = await verifyFixedBinary(lima.broker);
          await runFixed(binary, [
            "emergency-stop",
            operation,
            payload.runtimeId,
            context.creationNonce,
          ]);
        } catch {
          residueIds.push(`phase-${operation}`);
        }
      }
      for (const [phase, argv] of [
        ["stop-runtime", ["stop", "--force", lima.instance]],
        ["delete-runtime", ["delete", "--force", lima.instance]],
      ]) {
        order.push(phase);
        await context.recordPhase?.(phase);
        try {
          await runFixed(await verifyFixedBinary(lima), argv);
        } catch {
          residueIds.push(`phase-${phase}`);
        }
      }
      await context.recordPhase?.("verify-residue");
      try {
        const residue = await runFixed(await verifyFixedBinary(lima.broker), [
          "residue-probe",
          payload.runtimeId,
          context.creationNonce,
        ]);
        const brokerResidue = parseStrictJsonBytes(Buffer.from(residue), "runtime residue result");
        if (!Array.isArray(brokerResidue) || brokerResidue.some((id) => !safeId(id))) {
          fail("INTERNAL", "runtime residue result is invalid");
        }
        residueIds.push(...brokerResidue);
      } catch {
        residueIds.push("broker-residue-unknown");
      }
      try {
        const list = parseStrictJsonBytes(
          Buffer.from(await runFixed(await verifyFixedBinary(lima), ["list", "--json"])),
          "Lima instance list",
        );
        if (!Array.isArray(list) || list.some((entry) => entry?.name === lima.instance)) {
          residueIds.push("lima-instance-residue");
        }
      } catch {
        residueIds.push("lima-instance-status-unknown");
      }
      if (typeof lima.instanceDirectory === "string") {
        const disk = await lstat(lima.instanceDirectory).catch((error) =>
          error?.code === "ENOENT" ? undefined : Promise.reject(error),
        );
        if (disk !== undefined) residueIds.push("lima-disk-residue");
      }
      const uniqueResidueIds = [...new Set(residueIds)];
      return {
        runtimeId: payload.runtimeId,
        state: uniqueResidueIds.length === 0 ? "SUCCEEDED" : "FAILED",
        cleanup: {
          state: uniqueResidueIds.length === 0 ? "COMPLETE" : "RESIDUE",
          removedResourceIds: uniqueResidueIds.length === 0 ? [payload.runtimeId] : [],
          residueIds: uniqueResidueIds,
          checkedAt: new Date().toISOString(),
        },
      };
    };
  }
  return Object.freeze(drivers);
}

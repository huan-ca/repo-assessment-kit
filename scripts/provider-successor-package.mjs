#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  DEFAULT_LIMITS,
  createDeterministicZip,
  reopenZip,
  validateArchivePath,
} from "../packages/packaging/dist/index.js";
import { parseStrictJson as parseReleaseStrictJson } from "./release-run-state.mjs";

const execFileAsync = promisify(execFile);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const CONTROL_ID = /^[A-Z0-9][A-Z0-9._/-]{0,127}$/u;
const PROVIDERS = new Set(["codex", "claude-code"]);
const RESULTS = new Set(["pass", "fail", "partial", "blocked", "not-applicable", "not-tested"]);
const AUTHOR_TASKS = Object.freeze([
  "architecture-analysis",
  "product-code-trace",
  "security-analysis",
  "decision-synthesis",
]);
const REVIEW_TASKS = new Map([
  ["finding-review", "security-analysis"],
  ["decision-review", "decision-synthesis"],
  ["plain-language-review", "decision-synthesis"],
]);
const REQUIRED_RELEASE_AUTHORITIES = Object.freeze([
  "independent-security",
  "independent-decision",
  "technical-human",
  "lay-human",
  "cross-provider-equivalence",
  "official-schema-validation",
  "signed-release-assets",
  "runtime-platform",
  "release-authorization",
]);
const ACTIVE_CONTENT =
  /<(?:script|iframe|object|embed|svg|math|form|style|link|meta)\b|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=/iu;
const PRIVATE_KEY =
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/giu;
const AWS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu;
const ASSIGNMENT_SECRET =
  /\b(?:aws_secret_access_key|client_secret|private_key|password|authorization)\s*[:=]\s*["']?[^\s"',;]{8,}/giu;
const HOST_PATH =
  /(?:\/(?:Users|home|workspace|tmp|var\/folders|etc)\/[^\s"'<>]+|[A-Za-z]:\\(?:Users|Documents and Settings|Windows)\\[^\s"'<>]+)/gu;
const COMPLIANCE =
  /\b(?:fully compliant|guaranteed compliant|certified|legally required|meets all regulatory requirements|is secure|no vulnerabilities were found)\b/giu;
const MAX_OUTCOMES = 64;
const MAX_CLAIMS = 256;
const MAX_LIMITATIONS = 256;
const MAX_TEXT = 2_048;

export class ProviderSuccessorPackageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProviderSuccessorPackageError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new ProviderSuccessorPackageError(code, message, details);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)) fail("SCHEMA_INVALID", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("SCHEMA_INVALID", `${label} has missing or unknown fields`);
  }
}

function boundedId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail("SCHEMA_INVALID", `${label} is invalid`);
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("SCHEMA_INVALID", "non-I-JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) fail("SCHEMA_INVALID", "non-I-JSON value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalDigest(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function parseStrictJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("PACKAGE_INVALID", `${label} is not UTF-8`);
  }
  if (text.includes("\0")) fail("PACKAGE_INVALID", `${label} contains NUL`);
  try {
    return parseReleaseStrictJson(text, label);
  } catch {
    fail("PACKAGE_INVALID", `${label} is not strict JSON`);
  }
}

function assertBoundedValue(value, label, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 4_096 || depth > 12)
    fail("PROVIDER_PROPOSAL_QUARANTINED", `${label} is an object bomb`);
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  )
    return;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_TEXT)
      fail("PROVIDER_PROPOSAL_QUARANTINED", `${label} contains oversized text`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CLAIMS)
      fail("PROVIDER_PROPOSAL_QUARANTINED", `${label} array is oversized`);
    for (const entry of value) assertBoundedValue(entry, label, state, depth + 1);
    return;
  }
  if (!isRecord(value)) fail("PROVIDER_PROPOSAL_QUARANTINED", `${label} contains an invalid type`);
  if (Object.keys(value).length > 32)
    fail("PROVIDER_PROPOSAL_QUARANTINED", `${label} object is oversized`);
  for (const entry of Object.values(value)) assertBoundedValue(entry, label, state, depth + 1);
}

function sanitizeSummary(value) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > MAX_TEXT) {
    fail("PROVIDER_PROPOSAL_QUARANTINED", "claim summary is invalid");
  }
  if (ACTIVE_CONTENT.test(value))
    fail("PROVIDER_PROPOSAL_QUARANTINED", "active content is prohibited");
  ACTIVE_CONTENT.lastIndex = 0;
  return value
    .replace(PRIVATE_KEY, "[REDACTED SECRET]")
    .replace(AWS_KEY, "[REDACTED SECRET]")
    .replace(ASSIGNMENT_SECRET, "[REDACTED SECRET]")
    .replace(HOST_PATH, "[REDACTED HOST PATH]")
    .replace(COMPLIANCE, "technical coverage only")
    .replaceAll(/./gsu, (character) =>
      (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127 ? "" : character,
    )
    .trim();
}

function matches(pattern, value) {
  pattern.lastIndex = 0;
  const matched = pattern.test(value);
  pattern.lastIndex = 0;
  return matched;
}

function uniqueIds(value, label, maximum) {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((entry) => typeof entry !== "string" || !ID.test(entry)) ||
    new Set(value).size !== value.length
  ) {
    fail("PROVIDER_PROPOSAL_QUARANTINED", `${label} is invalid`);
  }
  return [...value].sort();
}

function normalizeAuthorContent(content, proposalEvidenceIds, knownEvidenceIds) {
  exactKeys(content, ["claims", "limitations"], "author proposal content");
  if (!Array.isArray(content.claims) || content.claims.length > MAX_CLAIMS)
    fail("PROVIDER_PROPOSAL_QUARANTINED", "claims are invalid");
  if (!Array.isArray(content.limitations) || content.limitations.length > MAX_LIMITATIONS)
    fail("PROVIDER_PROPOSAL_QUARANTINED", "limitations are invalid");
  const cited = new Set(proposalEvidenceIds);
  const claims = content.claims.map((claim, index) => {
    exactKeys(
      claim,
      ["claimId", "controlId", "result", "evidenceOccurrenceIds", "summary"],
      `claim ${index}`,
    );
    boundedId(claim.claimId, `claim ${index} ID`);
    if (typeof claim.controlId !== "string" || !CONTROL_ID.test(claim.controlId))
      fail("PROVIDER_PROPOSAL_QUARANTINED", `claim ${index} control ID is invalid`);
    if (!RESULTS.has(claim.result))
      fail("PROVIDER_PROPOSAL_QUARANTINED", `claim ${index} result is invalid`);
    const evidenceOccurrenceIds = uniqueIds(
      claim.evidenceOccurrenceIds,
      `claim ${index} evidence`,
      64,
    );
    if (
      evidenceOccurrenceIds.length === 0 ||
      evidenceOccurrenceIds.some((id) => !cited.has(id) || !knownEvidenceIds.has(id))
    )
      fail("EVIDENCE_REFERENCE_MISMATCH", `claim ${index} cites unavailable evidence`);
    return {
      claimId: claim.claimId,
      controlId: claim.controlId,
      result: claim.result,
      evidenceOccurrenceIds,
      summary: sanitizeSummary(claim.summary),
    };
  });
  if (new Set(claims.map(({ claimId }) => claimId)).size !== claims.length)
    fail("PROVIDER_PROPOSAL_QUARANTINED", "claim IDs are duplicated");
  const limitations = content.limitations.map((limitation, index) => {
    exactKeys(limitation, ["limitationId", "code", "evidenceOccurrenceIds"], `limitation ${index}`);
    boundedId(limitation.limitationId, `limitation ${index} ID`);
    if (typeof limitation.code !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(limitation.code))
      fail("PROVIDER_PROPOSAL_QUARANTINED", `limitation ${index} code is invalid`);
    const evidenceOccurrenceIds = uniqueIds(
      limitation.evidenceOccurrenceIds,
      `limitation ${index} evidence`,
      64,
    );
    if (evidenceOccurrenceIds.some((id) => !cited.has(id) || !knownEvidenceIds.has(id)))
      fail("EVIDENCE_REFERENCE_MISMATCH", `limitation ${index} cites unavailable evidence`);
    return { limitationId: limitation.limitationId, code: limitation.code, evidenceOccurrenceIds };
  });
  return { claims, limitations };
}

function normalizeReviewContent(content, knownProposalDigests, knownEvidenceIds) {
  exactKeys(
    content,
    ["authorProposalDigest", "verdict", "objectionCodes", "evidenceOccurrenceIds"],
    "review proposal content",
  );
  if (
    !DIGEST.test(content.authorProposalDigest) ||
    !knownProposalDigests.has(content.authorProposalDigest)
  )
    fail("REVIEW_BINDING_INVALID", "review is not bound to an admitted author proposal");
  if (!["passed", "passed-with-objections", "failed"].includes(content.verdict))
    fail("PROVIDER_PROPOSAL_QUARANTINED", "review verdict is invalid");
  const objectionCodes = uniqueIds(content.objectionCodes, "review objection codes", 64);
  const evidenceOccurrenceIds = uniqueIds(content.evidenceOccurrenceIds, "review evidence", 64);
  if (evidenceOccurrenceIds.some((id) => !knownEvidenceIds.has(id)))
    fail("EVIDENCE_REFERENCE_MISMATCH", "review cites unavailable evidence");
  return {
    authorProposalDigest: content.authorProposalDigest,
    verdict: content.verdict,
    objectionCodes,
    evidenceOccurrenceIds,
  };
}

function validateProposalIdentity(outcome) {
  const proposal = outcome.proposal;
  exactKeys(
    proposal,
    [
      "schemaVersion",
      "schemaId",
      "taskId",
      "runId",
      "attemptId",
      "fenceToken",
      "evidenceOccurrenceIds",
      "limitationIds",
      "content",
    ],
    "provider proposal",
  );
  if (
    proposal.schemaVersion !== "1.0.0" ||
    proposal.schemaId !== "rak-agent-proposal/1.0.0" ||
    proposal.taskId !== outcome.taskId ||
    proposal.runId !== outcome.runId ||
    proposal.attemptId !== outcome.attemptId ||
    proposal.fenceToken !== outcome.fenceToken
  )
    fail("PROVIDER_PROPOSAL_QUARANTINED", "proposal identity is not current");
  const digest = canonicalDigest(proposal);
  if (outcome.proposalDigest !== digest)
    fail("PROVIDER_PROPOSAL_QUARANTINED", "proposal digest mismatch", {
      quarantinedProposalDigest: digest,
    });
  return digest;
}

function normalizeProviderOutcomes(outcomes, evidenceOccurrences, runId, providerRunIds) {
  if (!Array.isArray(outcomes) || outcomes.length === 0 || outcomes.length > MAX_OUTCOMES)
    fail("SCHEMA_INVALID", "normalized provider outcomes are empty or oversized");
  const knownEvidenceIds = new Set(
    evidenceOccurrences.map((occurrence) => boundedId(occurrence.evidenceId, "evidence ID")),
  );
  const prepared = outcomes.map((outcome, index) => {
    exactKeys(
      outcome,
      [
        "provider",
        "taskKind",
        "providerRole",
        "taskId",
        "runId",
        "attemptId",
        "fenceToken",
        "outcome",
        "proposalDigest",
        "evidenceViewDigest",
        "allowedEvidenceOccurrenceIds",
        "proposal",
      ],
      `provider outcome ${index}`,
    );
    if (!PROVIDERS.has(outcome.provider)) fail("SCHEMA_INVALID", "provider is invalid");
    if (!(providerRunIds ?? new Set([runId])).has(outcome.runId))
      fail("SCHEMA_INVALID", "provider outcome run binding mismatch");
    for (const key of ["taskKind", "providerRole", "taskId", "attemptId", "fenceToken"]) {
      boundedId(outcome[key], `provider outcome ${key}`);
    }
    if (!["author", "independent-reviewer"].includes(outcome.providerRole))
      fail("SCHEMA_INVALID", "provider role is invalid");
    if (outcome.outcome !== "succeeded")
      fail("SCHEMA_INVALID", "only successful outcomes are admissible");
    if (!DIGEST.test(outcome.evidenceViewDigest))
      fail("SCHEMA_INVALID", "evidence view digest is invalid");
    const allowed = uniqueIds(
      outcome.allowedEvidenceOccurrenceIds,
      "allowed evidence occurrence IDs",
      512,
    );
    if (allowed.some((id) => !knownEvidenceIds.has(id)))
      fail("EVIDENCE_REFERENCE_MISMATCH", "evidence view cites unavailable occurrence");
    assertBoundedValue(outcome.proposal, "provider proposal");
    const digest = validateProposalIdentity(outcome);
    const proposalEvidence = uniqueIds(
      outcome.proposal.evidenceOccurrenceIds,
      "proposal evidence",
      512,
    );
    if (proposalEvidence.some((id) => !allowed.includes(id)))
      fail("EVIDENCE_REFERENCE_MISMATCH", "proposal cites outside its admitted evidence view");
    return {
      ...outcome,
      allowedEvidenceOccurrenceIds: allowed,
      proposalDigest: digest,
      proposalEvidence,
    };
  });
  const authorDigests = new Set(
    prepared
      .filter(({ providerRole }) => providerRole === "author")
      .map(({ proposalDigest }) => proposalDigest),
  );
  return prepared.map((outcome) => {
    const content =
      outcome.providerRole === "author"
        ? normalizeAuthorContent(
            outcome.proposal.content,
            outcome.proposalEvidence,
            knownEvidenceIds,
          )
        : normalizeReviewContent(outcome.proposal.content, authorDigests, knownEvidenceIds);
    return { ...outcome, content };
  });
}

function deriveProviderRecords(outcomes, run, snapshot, generatedAt) {
  const activities = [];
  const occurrences = [];
  for (const outcome of outcomes) {
    const activity = {
      schemaVersion: "1.0.0",
      activityId: `act_${outcome.proposalDigest.slice(7, 39)}`,
      runId: run.runId,
      snapshotId: snapshot.snapshotId,
      kind:
        outcome.providerRole === "author"
          ? "provider-proposal-validation"
          : "provider-independent-review",
      provider: outcome.provider,
      providerRole: outcome.providerRole,
      taskKind: outcome.taskKind,
      taskId: outcome.taskId,
      attemptId: outcome.attemptId,
      fenceToken: outcome.fenceToken,
      evidenceViewDigest: outcome.evidenceViewDigest,
      proposalDigest: outcome.proposalDigest,
      occurredAt: generatedAt,
    };
    activities.push(activity);
    occurrences.push({
      schemaVersion: "1.0.0",
      evidenceId: `evd_${outcome.proposalDigest.slice(7, 39)}`,
      runId: run.runId,
      snapshotId: snapshot.snapshotId,
      activityId: activity.activityId,
      evidenceType:
        outcome.providerRole === "author"
          ? "trusted-provider-derivative"
          : "independent-provider-review",
      sensitivity: "customer-confidential",
      redactionState: "redacted",
      validationState: "validated",
      collectionLimitations: [
        "rak-output-class:O3-trusted-derivative",
        "Provider output is a deterministic, redacted proposal derivative and is not authority.",
      ],
      derivedFromEvidenceIds: [...outcome.proposalEvidence],
      capturedAt: generatedAt,
    });
  }
  return { activities, occurrences };
}

function reconcileProviderOutcomes(outcomes) {
  const effectiveContent = (outcome) => outcome.content ?? outcome.proposal?.content;
  const byTask = [];
  for (const taskKind of AUTHOR_TASKS) {
    const authors = outcomes.filter(
      (outcome) => outcome.taskKind === taskKind && outcome.providerRole === "author",
    );
    const providerEntries = [...PROVIDERS].map((provider) => {
      const outcome = authors.find((candidate) => candidate.provider === provider);
      return outcome === undefined
        ? { provider, status: "missing", claims: [], limitationCodes: ["PROVIDER_OUTCOME_MISSING"] }
        : {
            provider,
            status: "present",
            claims: effectiveContent(outcome).claims.map(({ controlId, result }) => ({
              controlId,
              result,
            })),
            limitationCodes: effectiveContent(outcome)
              .limitations.map(({ code }) => code)
              .sort(),
          };
    });
    const left = providerEntries[0];
    const right = providerEntries[1];
    const equivalent =
      left.status === "present" &&
      right.status === "present" &&
      canonicalJson(left.claims) === canonicalJson(right.claims) &&
      canonicalJson(left.limitationCodes) === canonicalJson(right.limitationCodes);
    byTask.push({ taskKind, providers: providerEntries, equivalent });
  }
  const authorByDigest = new Map(
    outcomes
      .filter(({ providerRole }) => providerRole === "author")
      .map((outcome) => [outcome.proposalDigest, outcome]),
  );
  const reviews = outcomes
    .filter(({ providerRole }) => providerRole === "independent-reviewer")
    .map((outcome) => {
      const content = effectiveContent(outcome);
      const author = authorByDigest.get(content.authorProposalDigest);
      const distinctProvider = author !== undefined && author.provider !== outcome.provider;
      const expectedAuthorTask = REVIEW_TASKS.get(outcome.taskKind);
      const taskBound = author !== undefined && author.taskKind === expectedAuthorTask;
      return {
        taskKind: outcome.taskKind,
        provider: outcome.provider,
        authorProposalDigest: content.authorProposalDigest,
        distinctProvider,
        distinctRole: author !== undefined && author.providerRole !== outcome.providerRole,
        taskBound,
        verdict: content.verdict,
        accepted:
          distinctProvider &&
          taskBound &&
          content.verdict !== "failed" &&
          author?.providerRole === "author",
      };
    });
  return {
    schemaVersion: "1.0.0",
    profile: "rak-provider-reconciliation/1.0.0",
    requiredTasks: byTask,
    independentReviews: reviews,
    crossProviderEquivalent:
      byTask.every(({ equivalent }) => equivalent) &&
      [...REVIEW_TASKS.keys()].every((taskKind) =>
        reviews.some((review) => review.taskKind === taskKind && review.accepted),
      ),
  };
}

function recordBinding(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "receiptDigest"));
}

export async function evaluateSuccessorReleaseReadiness({
  runId,
  packageDigest,
  proposalDigest,
  records = [],
  providerOutcomes,
  authority,
  now = Date.now(),
}) {
  boundedId(runId, "readiness run ID");
  if (!DIGEST.test(packageDigest) || !DIGEST.test(proposalDigest))
    fail("SCHEMA_INVALID", "readiness digest is invalid");
  const fixtureAuthority = authority?.mode === "fixture-test-only" ? authority : undefined;
  const accepted = new Map();
  const rejectedRecordIds = [];
  for (const record of records) {
    const keys = [
      "schemaVersion",
      "recordId",
      "runId",
      "packageDigest",
      "kind",
      "verdict",
      "inputDigest",
      "issuedAt",
      "expiresAt",
      "issuer",
      "signatureAlgorithm",
      "signingKeyId",
      "signature",
      "receiptDigest",
    ];
    const binding = isRecord(record) ? recordBinding(record) : undefined;
    const valid =
      exactKeysBoolean(record, keys) &&
      record.schemaVersion === "rak-external-release-record/1.0.0" &&
      record.runId === runId &&
      record.packageDigest === packageDigest &&
      record.inputDigest === proposalDigest &&
      REQUIRED_RELEASE_AUTHORITIES.includes(record.kind) &&
      record.verdict === "passed" &&
      typeof record.issuer === "string" &&
      ID.test(record.issuer) &&
      record.signatureAlgorithm === "Ed25519" &&
      typeof record.signingKeyId === "string" &&
      ID.test(record.signingKeyId) &&
      typeof record.signature === "string" &&
      record.signature.length > 0 &&
      Number.isFinite(Date.parse(record.issuedAt)) &&
      Number.isFinite(Date.parse(record.expiresAt)) &&
      Date.parse(record.issuedAt) <= now &&
      Date.parse(record.expiresAt) > now &&
      record.receiptDigest ===
        canonicalDigest({
          domain: "rak-external-release-record/v1",
          binding,
        }) &&
      fixtureAuthority !== undefined &&
      (await fixtureAuthority.verify(structuredClone(record))) === true &&
      !accepted.has(record.kind);
    if (valid) accepted.set(record.kind, structuredClone(record));
    else
      rejectedRecordIds.push(
        isRecord(record) && typeof record.recordId === "string" ? record.recordId : "malformed",
      );
  }
  const reconciliation = reconcileProviderOutcomes(providerOutcomes);
  const blockers = REQUIRED_RELEASE_AUTHORITIES.filter((kind) => !accepted.has(kind));
  if (!reconciliation.crossProviderEquivalent && !blockers.includes("cross-provider-equivalence"))
    blockers.push("cross-provider-equivalence");
  return {
    schemaVersion: "1.0.0",
    profile: "rak-release-readiness/1.0.0",
    runId,
    packageDigest,
    proposalDigest,
    acceptedRecordIds: [...accepted.values()].map(({ recordId }) => recordId).sort(),
    rejectedRecordIds: rejectedRecordIds.sort(),
    blockers: [...new Set(blockers)].sort(),
    fixtureAuthorityUsed: fixtureAuthority !== undefined,
    customerReleaseAuthorized:
      fixtureAuthority !== undefined && blockers.length === 0 && rejectedRecordIds.length === 0,
  };
}

function exactKeysBoolean(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

async function readBaseDraft(baseDraft) {
  exactKeys(baseDraft, ["zipPath", "zipSha256", "runId", "snapshotId"], "base draft");
  if (!DIGEST.test(baseDraft.zipSha256)) fail("SCHEMA_INVALID", "base ZIP digest is invalid");
  const handle = await open(baseDraft.zipPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail("PACKAGE_INVALID", "base draft is not a regular file");
    const bytes = await handle.readFile();
    if (sha256(bytes) !== baseDraft.zipSha256)
      fail("PACKAGE_INVALID", "base draft digest mismatch");
    return { bytes, stat: before, handle };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readHeldFile(handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (bytesRead === 0) fail("BASE_DRAFT_MUTATED", "base draft became short");
    offset += bytesRead;
  }
  return bytes;
}

function verifyPayload(payload, expected = {}) {
  if (payload.size < 3 || payload.size > DEFAULT_LIMITS.maxEntries)
    fail("PACKAGE_INVALID", "successor entry count is invalid");
  const manifestBytes = payload.get("manifest.json");
  const checksumsBytes = payload.get("SHA256SUMS");
  if (manifestBytes === undefined || checksumsBytes === undefined)
    fail("PACKAGE_INVALID", "manifest or checksums are missing");
  const manifest = parseStrictJson(manifestBytes, "manifest");
  assertBoundedValue(manifest, "manifest");
  if (!isRecord(manifest) || !Array.isArray(manifest.entries))
    fail("PACKAGE_INVALID", "manifest shape is invalid");
  if (expected.runId !== undefined && manifest.runId !== expected.runId)
    fail("PACKAGE_INVALID", "manifest run binding mismatch");
  if (expected.snapshotId !== undefined && manifest.snapshotId !== expected.snapshotId)
    fail("PACKAGE_INVALID", "manifest snapshot binding mismatch");
  const entryMap = new Map();
  for (const entry of manifest.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      typeof entry.sha256 !== "string" ||
      typeof entry.byteLength !== "string"
    )
      fail("PACKAGE_INVALID", "manifest entry is invalid");
    validateArchivePath(entry.path);
    if (entryMap.has(entry.path)) fail("PACKAGE_INVALID", "manifest path is duplicated");
    entryMap.set(entry.path, entry);
    const bytes = payload.get(entry.path);
    if (
      bytes === undefined ||
      sha256(bytes) !== entry.sha256 ||
      String(bytes.byteLength) !== entry.byteLength
    )
      fail("PACKAGE_INVALID", `manifest mismatch: ${entry.path}`);
  }
  const payloadPaths = [...payload.keys()].filter(
    (path) => !["manifest.json", "SHA256SUMS"].includes(path),
  );
  if (payloadPaths.length !== entryMap.size || payloadPaths.some((path) => !entryMap.has(path)))
    fail("PACKAGE_INVALID", "manifest inventory is incomplete");
  const checksumLines = Buffer.from(checksumsBytes).toString("utf8").trimEnd().split("\n");
  const checksumPaths = new Set();
  for (const line of checksumLines) {
    const match = /^(?:sha256:)?([a-f0-9]{64}) {2}([^\r\n]+)$/u.exec(line);
    if (
      match === null ||
      checksumPaths.has(match[2]) ||
      sha256(payload.get(match[2]) ?? Buffer.alloc(0)) !== `sha256:${match[1]}`
    )
      fail("PACKAGE_INVALID", "checksum inventory is invalid");
    checksumPaths.add(match[2]);
  }
  if (
    checksumPaths.size !== payload.size - 1 ||
    [...payload.keys()].some((path) => path !== "SHA256SUMS" && !checksumPaths.has(path))
  )
    fail("PACKAGE_INVALID", "checksum inventory is incomplete");
  if (
    expected.successor === true &&
    (manifest.profile !== "rak-provider-successor-draft/1.0.0" ||
      manifest.status !== "DRAFT_VALIDATED_RELEASE_BLOCKED" ||
      manifest.customerReleaseAuthorized !== false ||
      typeof manifest.parentPackageDigest !== "string" ||
      !DIGEST.test(manifest.parentPackageDigest))
  )
    fail("PACKAGE_INVALID", "successor manifest truth is invalid");
  return manifest;
}

function checksumText(payload) {
  return `${[...payload.entries()]
    .filter(([path]) => path !== "SHA256SUMS")
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([path, bytes]) => `${sha256(bytes).slice("sha256:".length)}  ${path}`)
    .join("\n")}\n`;
}

function successorManifest(payload, metadata, eligibilityByPath, baseEligibilityByPath) {
  return {
    schemaVersion: "1.0.0",
    profile: "rak-provider-successor-draft/1.0.0",
    runId: metadata.runId,
    parentRunId: metadata.parentRunId,
    parentPackageDigest: metadata.parentPackageDigest,
    snapshotId: metadata.snapshotId,
    generatedAt: metadata.generatedAt,
    status: metadata.status,
    customerReleaseAuthorized: metadata.customerReleaseAuthorized,
    entries: [...payload.entries()]
      .filter(([path]) => !["manifest.json", "SHA256SUMS"].includes(path))
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([path, bytes]) => ({
        path,
        byteLength: String(bytes.byteLength),
        sha256: sha256(bytes),
        eligibility:
          eligibilityByPath.get(path) ??
          baseEligibilityByPath.get(path) ??
          fail("PACKAGE_INVALID", `base artifact has no preserved eligibility: ${path}`),
      })),
  };
}

async function verifyPrivateOutputDirectory(outputDirectory) {
  const info = await lstat(outputDirectory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (typeof process.getuid === "function" && info.uid !== process.getuid()) ||
    (info.mode & 0o077) !== 0
  )
    fail("OUTPUT_DIRECTORY_UNSAFE", "output directory must be an existing owner-private directory");
  const canonical = await realpath(outputDirectory);
  if (canonical !== outputDirectory)
    fail("OUTPUT_DIRECTORY_UNSAFE", "output directory must be an absolute canonical path");
  return canonical;
}

async function atomicExclusiveWrite(path, bytes) {
  const handle = await open(
    path,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(dirname(path), fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export function validateProviderSuccessorZip(zipBytes, expected = {}) {
  if (!(zipBytes instanceof Uint8Array) || zipBytes.byteLength === 0)
    fail("PACKAGE_INVALID", "successor ZIP is empty");
  const payload = new Map(reopenZip(zipBytes).map(({ path, content }) => [path, content]));
  const manifest = verifyPayload(payload, { ...expected, successor: true });
  for (const path of [
    "data/provider-activity.json",
    "data/provider-reconciliation.json",
    "data/release-readiness.json",
    "reports/provider-successor.md",
  ]) {
    if (!payload.has(path)) fail("PACKAGE_INVALID", `successor artifact is missing: ${path}`);
  }
  const readiness = parseStrictJson(
    payload.get("data/release-readiness.json"),
    "release readiness",
  );
  const reconciliation = parseStrictJson(
    payload.get("data/provider-reconciliation.json"),
    "provider reconciliation",
  );
  if (
    readiness.customerReleaseAuthorized !== false ||
    readiness.status !== "DRAFT_VALIDATED_RELEASE_BLOCKED" ||
    readiness.packageDigest !== null ||
    !Array.isArray(readiness.acceptedRecordIds) ||
    readiness.acceptedRecordIds.length !== 0 ||
    !Array.isArray(readiness.blockers) ||
    readiness.blockers.length !== REQUIRED_RELEASE_AUTHORITIES.length ||
    REQUIRED_RELEASE_AUTHORITIES.some((kind) => !readiness.blockers.includes(kind)) ||
    reconciliation.schemaVersion !== "1.0.0" ||
    reconciliation.profile !== "rak-provider-reconciliation/1.0.0" ||
    manifest.customerReleaseAuthorized !== false
  )
    fail("PACKAGE_INVALID", "successor readiness or reconciliation truth is invalid");
  const text = [...payload.entries()]
    .filter(([path]) => /\.(?:json|md|html|txt|csv)$/iu.test(path))
    .map(([, bytes]) => Buffer.from(bytes).toString("utf8"))
    .join("\n");
  const derivedPaths = new Set(
    manifest.entries
      .filter(
        (entry) => entry.eligibility?.validatorId === "rak-provider-successor-validator/1.0.0",
      )
      .map(({ path }) => path),
  );
  const derivedText = [...payload.entries()]
    .filter(
      ([path]) =>
        (derivedPaths.has(path) || path === "manifest.json") &&
        /\.(?:json|md|html|txt|csv)$/iu.test(path),
    )
    .map(([, bytes]) => Buffer.from(bytes).toString("utf8"))
    .join("\n");
  if (
    matches(PRIVATE_KEY, text) ||
    matches(AWS_KEY, text) ||
    matches(ASSIGNMENT_SECRET, text) ||
    matches(HOST_PATH, text) ||
    matches(ACTIVE_CONTENT, derivedText) ||
    matches(COMPLIANCE, derivedText)
  ) {
    fail("PACKAGE_INVALID", "successor ZIP contains prohibited content");
  }
  for (const pattern of [
    PRIVATE_KEY,
    AWS_KEY,
    ASSIGNMENT_SECRET,
    HOST_PATH,
    ACTIVE_CONTENT,
    COMPLIANCE,
  ])
    pattern.lastIndex = 0;
  return {
    status: "passed",
    zipSha256: sha256(zipBytes),
    manifestSha256: sha256(Buffer.from(payload.get("manifest.json"))),
    entryCount: payload.size,
    manifest,
  };
}

async function freshProcessValidate(zipPath, expected) {
  const scriptPath = fileURLToPath(import.meta.url);
  const { stdout } = await execFileAsync(
    process.execPath,
    [scriptPath, "--validate-successor-zip", zipPath, expected.runId, expected.snapshotId],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH ?? "" },
    },
  );
  const result = JSON.parse(stdout);
  if (result.status !== "passed" || result.processId === process.pid)
    fail("PACKAGE_INVALID", "fresh-process successor validation failed");
  return result;
}

export async function createProviderSuccessorPackage({
  normalizedProviderOutcomes,
  baseDraft,
  run,
  snapshot,
  evidenceOccurrences,
  provenanceActivities,
  externalReviewCertificates = [],
  outputDirectory,
  packageBaseName,
  projectSlug,
  commitSha,
  generatedAt,
  authority,
}) {
  exactKeys(
    run,
    run.providerRunIds === undefined
      ? ["runId"]
      : ["runId", "providerRunIds", "aggregationProfile"],
    "run",
  );
  boundedId(run.runId, "successor run ID");
  let providerRunIds;
  if (run.providerRunIds !== undefined) {
    if (run.aggregationProfile !== "rak-paired-provider-runs/1.0.0")
      fail("SCHEMA_INVALID", "paired provider runs require the frozen aggregation profile");
    providerRunIds = new Set(uniqueIds(run.providerRunIds, "provider run IDs", 16));
    if (providerRunIds.size < 2)
      fail("SCHEMA_INVALID", "cross-provider successor requires at least two provider run IDs");
  }
  if (
    !isRecord(snapshot) ||
    typeof snapshot.snapshotId !== "string" ||
    typeof projectSlug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectSlug) ||
    typeof commitSha !== "string" ||
    !/^[a-f0-9]{40,64}$/u.test(commitSha) ||
    typeof packageBaseName !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(packageBaseName) ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    !Array.isArray(evidenceOccurrences) ||
    !Array.isArray(provenanceActivities)
  )
    fail("SCHEMA_INVALID", "successor package input is invalid");
  const canonicalOutputDirectory = await verifyPrivateOutputDirectory(outputDirectory);
  const base = await readBaseDraft(baseDraft);
  try {
    const basePayload = new Map(reopenZip(base.bytes).map(({ path, content }) => [path, content]));
    const baseManifest = verifyPayload(basePayload, {
      runId: baseDraft.runId,
      snapshotId: baseDraft.snapshotId,
    });
    if (baseDraft.snapshotId !== snapshot.snapshotId)
      fail("PACKAGE_INVALID", "base draft snapshot does not match the current snapshot");
    const outcomes = normalizeProviderOutcomes(
      normalizedProviderOutcomes,
      evidenceOccurrences,
      run.runId,
      providerRunIds,
    );
    const providerRecords = deriveProviderRecords(outcomes, run, snapshot, generatedAt);
    const reconciliation = reconcileProviderOutcomes(outcomes);
    const combinedProposalDigest = canonicalDigest(
      outcomes.map(({ provider, taskKind, providerRole, proposalDigest }) => ({
        provider,
        taskKind,
        providerRole,
        proposalDigest,
      })),
    );
    const successorRunId = `run_${canonicalDigest({
      profile: "rak-provider-successor/1.0.0",
      runId: run.runId,
      base: baseDraft.zipSha256,
      combinedProposalDigest,
    }).slice(7, 39)}`;
    // A successor ZIP is always a draft. External records authorize release of the immutable,
    // final digest after creation; proposal/reviewer-role task success never relabels this package.
    const status = "DRAFT_VALIDATED_RELEASE_BLOCKED";
    const activityDocument = {
      schemaVersion: "1.0.0",
      profile: "rak-provider-activity/1.0.0",
      runId: successorRunId,
      sourceRunId: run.runId,
      snapshotId: snapshot.snapshotId,
      generatedAt,
      activities: providerRecords.activities,
      occurrences: providerRecords.occurrences,
      suppliedProvenanceActivityIds: provenanceActivities
        .map(({ activityId }) => activityId)
        .sort(),
    };
    const readinessDocument = {
      schemaVersion: "1.0.0",
      profile: "rak-release-readiness/1.0.0",
      runId: successorRunId,
      packageDigest: null,
      proposalDigest: combinedProposalDigest,
      acceptedRecordIds: [],
      rejectedRecordIds: [],
      blockers: [...REQUIRED_RELEASE_AUTHORITIES],
      fixtureAuthorityUsed: false,
      customerReleaseAuthorized: false,
      status,
      reason:
        "Final-digest external authorities are unavailable inside this self-digesting draft and must be verified as signed sidecar records.",
    };
    const safeReport = [
      "# Provider successor draft",
      "",
      `Status: ${status}`,
      "",
      "Provider proposals are untrusted inputs. This successor contains only closed, validated, redacted derivatives with evidence references.",
      "",
      `Cross-provider equivalent: ${String(reconciliation.crossProviderEquivalent)}`,
      "",
      `Release blockers: ${REQUIRED_RELEASE_AUTHORITIES.join(", ")}`,
      "",
      "This is a technical assessment draft, not a compliance certification or legal opinion.",
      "",
    ].join("\n");
    const payload = new Map(
      [...basePayload.entries()].filter(
        ([path]) => !["manifest.json", "SHA256SUMS"].includes(path),
      ),
    );
    const additions = new Map([
      ["data/provider-activity.json", Buffer.from(`${canonicalJson(activityDocument)}\n`)],
      ["data/provider-reconciliation.json", Buffer.from(`${canonicalJson(reconciliation)}\n`)],
      ["data/release-readiness.json", Buffer.from(`${canonicalJson(readinessDocument)}\n`)],
      ["reports/provider-successor.md", Buffer.from(safeReport)],
    ]);
    for (const [path, bytes] of additions) payload.set(path, bytes);
    const eligibilityByPath = new Map();
    for (const [path] of additions) {
      eligibilityByPath.set(path, {
        outputClass: "O3-trusted-derivative",
        validatorId: "rak-provider-successor-validator/1.0.0",
        sourceEvidenceIds: providerRecords.occurrences.map(({ evidenceId }) => evidenceId).sort(),
        provenanceActivityIds: providerRecords.activities
          .map(({ activityId }) => activityId)
          .sort(),
        authorProposalDigests: outcomes
          .filter(({ providerRole }) => providerRole === "author")
          .map(({ proposalDigest }) => proposalDigest)
          .sort(),
        independentReviewProposalDigests: outcomes
          .filter(({ providerRole }) => providerRole === "independent-reviewer")
          .map(({ proposalDigest }) => proposalDigest)
          .sort(),
      });
    }
    const baseEligibilityByPath = new Map(
      baseManifest.entries.map((entry) => [entry.path, structuredClone(entry.eligibility)]),
    );
    const manifest = successorManifest(
      payload,
      {
        runId: successorRunId,
        parentRunId: baseManifest.runId,
        parentPackageDigest: baseDraft.zipSha256,
        snapshotId: snapshot.snapshotId,
        generatedAt,
        status,
        customerReleaseAuthorized: false,
      },
      eligibilityByPath,
      baseEligibilityByPath,
    );
    payload.set("manifest.json", Buffer.from(`${canonicalJson(manifest)}\n`));
    payload.set("SHA256SUMS", Buffer.from(checksumText(payload)));
    verifyPayload(payload, { runId: successorRunId, snapshotId: snapshot.snapshotId });
    const zipBytes = createDeterministicZip(payload);
    const reopened = validateProviderSuccessorZip(zipBytes, {
      runId: successorRunId,
      snapshotId: snapshot.snapshotId,
    });
    const zipPath = join(canonicalOutputDirectory, `${packageBaseName}.zip`);
    const zipSha256Path = `${zipPath}.sha256`;
    await atomicExclusiveWrite(zipPath, zipBytes);
    const freshProcessValidation = await freshProcessValidate(zipPath, {
      runId: successorRunId,
      snapshotId: snapshot.snapshotId,
    });
    await atomicExclusiveWrite(
      zipSha256Path,
      Buffer.from(`${freshProcessValidation.zipSha256}  ${basename(zipPath)}\n`, "utf8"),
    );
    const after = await base.handle.stat();
    const afterBytes = await readHeldFile(base.handle, base.stat.size);
    if (
      after.dev !== base.stat.dev ||
      after.ino !== base.stat.ino ||
      after.size !== base.stat.size ||
      sha256(afterBytes) !== baseDraft.zipSha256
    )
      fail("BASE_DRAFT_MUTATED", "base draft changed while creating successor");
    const releaseReadiness = await evaluateSuccessorReleaseReadiness({
      runId: successorRunId,
      packageDigest: freshProcessValidation.zipSha256,
      proposalDigest: combinedProposalDigest,
      records: externalReviewCertificates,
      providerOutcomes: outcomes,
      authority,
    });
    return {
      successor: {
        schemaVersion: "1.0.0",
        runId: successorRunId,
        parentRunId: baseDraft.runId,
        snapshotId: snapshot.snapshotId,
        zipPath,
        zipSha256Path,
        zipSha256: freshProcessValidation.zipSha256,
        status,
        customerReleaseAuthorized: false,
        freshProcessValidation,
        reopenedValidation: reopened,
      },
      providerActivity: activityDocument,
      reconciliation,
      releaseReadiness,
      quarantinedProposalDigests: [],
    };
  } finally {
    await base.handle.close();
  }
}

if (process.argv[2] === "--validate-successor-zip") {
  const [, , , zipPath, runId, snapshotId] = process.argv;
  try {
    const result = validateProviderSuccessorZip(await readFile(zipPath), { runId, snapshotId });
    process.stdout.write(
      `${JSON.stringify({ ...result, manifest: undefined, processId: process.pid })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "validation failed"}\n`);
    process.exitCode = 1;
  }
}

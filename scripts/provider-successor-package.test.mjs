import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDeterministicZip, reopenZip } from "../packages/packaging/dist/index.js";
import {
  ProviderSuccessorPackageError,
  createProviderSuccessorPackage,
  evaluateSuccessorReleaseReadiness,
  validateProviderSuccessorZip,
} from "./provider-successor-package.mjs";

const GENERATED_AT = "2026-07-28T12:00:00.000Z";
const SNAPSHOT_ID = `sha256:${"a".repeat(64)}`;
const COMMIT = "b".repeat(40);
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const canonicalDigest = (value) => sha256(Buffer.from(canonical(value)));

function checksums(payload) {
  return `${[...payload.entries()]
    .filter(([path]) => path !== "SHA256SUMS")
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([path, bytes]) => `${sha256(bytes).slice("sha256:".length)}  ${path}`)
    .join("\n")}\n`;
}

function replacePayloadEntry(zipBytes, path, replacement, mutateManifest = () => {}) {
  const payload = new Map(reopenZip(zipBytes).map((entry) => [entry.path, entry.content]));
  payload.set(path, Buffer.from(replacement));
  const manifest = JSON.parse(Buffer.from(payload.get("manifest.json")).toString("utf8"));
  const entry = manifest.entries.find((candidate) => candidate.path === path);
  entry.byteLength = String(payload.get(path).byteLength);
  entry.sha256 = sha256(payload.get(path));
  mutateManifest(manifest);
  payload.set("manifest.json", Buffer.from(`${canonical(manifest)}\n`));
  payload.set("SHA256SUMS", Buffer.from(checksums(payload)));
  return createDeterministicZip(payload);
}

async function baseDraft(root) {
  const payload = new Map([
    ["data/base.json", Buffer.from('{"status":"DRAFT_VALIDATED_RELEASE_BLOCKED"}\n')],
  ]);
  const manifest = {
    schemaVersion: "1.0.0",
    profile: "rak-offline-draft/1.0.0",
    runId: "run-base",
    snapshotId: SNAPSHOT_ID,
    generatedAt: GENERATED_AT,
    status: "DRAFT_VALIDATED_RELEASE_BLOCKED",
    entries: [...payload.entries()].map(([path, bytes]) => ({
      path,
      byteLength: String(bytes.byteLength),
      sha256: sha256(bytes),
      eligibility: {
        outputClass: "O0-uncredentialed",
        proofDigest: `sha256:${"e".repeat(64)}`,
        sourceEvidenceIds: ["ev-base"],
        provenanceActivityIds: ["act-base"],
      },
    })),
  };
  payload.set("manifest.json", Buffer.from(`${canonical(manifest)}\n`));
  payload.set("SHA256SUMS", Buffer.from(checksums(payload)));
  const bytes = createDeterministicZip(payload);
  const zipPath = join(root, "base.zip");
  await writeFile(zipPath, bytes);
  return {
    zipPath,
    zipSha256: sha256(bytes),
    runId: "run-base",
    snapshotId: SNAPSHOT_ID,
  };
}

function proposal(outcome, content, evidenceOccurrenceIds = ["ev-1"]) {
  const document = {
    schemaVersion: "1.0.0",
    schemaId: "rak-agent-proposal/1.0.0",
    taskId: outcome.taskId,
    runId: outcome.runId,
    attemptId: outcome.attemptId,
    fenceToken: outcome.fenceToken,
    evidenceOccurrenceIds,
    limitationIds: [],
    content,
  };
  return { ...outcome, proposal: document, proposalDigest: canonicalDigest(document) };
}

function author(provider, taskKind, summary = "Bounded technical observation.") {
  const outcome = {
    provider,
    taskKind,
    providerRole: "author",
    taskId: `task-${provider}-${taskKind}`,
    runId: "run-current",
    attemptId: `attempt-${provider}-${taskKind}`,
    fenceToken: "1",
    outcome: "succeeded",
    proposalDigest: "",
    evidenceViewDigest: `sha256:${"c".repeat(64)}`,
    allowedEvidenceOccurrenceIds: ["ev-1"],
    proposal: undefined,
  };
  return proposal(outcome, {
    claims: [
      {
        claimId: `claim-${provider}-${taskKind}`,
        controlId: `CONTROL/${taskKind.toUpperCase()}`,
        result: "partial",
        evidenceOccurrenceIds: ["ev-1"],
        summary,
      },
    ],
    limitations: [],
  });
}

function reviewer(provider, taskKind, authorOutcome) {
  const outcome = {
    provider,
    taskKind,
    providerRole: "independent-reviewer",
    taskId: `task-${provider}-${taskKind}`,
    runId: "run-current",
    attemptId: `attempt-${provider}-${taskKind}`,
    fenceToken: "1",
    outcome: "succeeded",
    proposalDigest: "",
    evidenceViewDigest: `sha256:${"d".repeat(64)}`,
    allowedEvidenceOccurrenceIds: ["ev-1"],
    proposal: undefined,
  };
  return proposal(outcome, {
    authorProposalDigest: authorOutcome.proposalDigest,
    verdict: "passed",
    objectionCodes: [],
    evidenceOccurrenceIds: ["ev-1"],
  });
}

function equivalentOutcomes(summary = "Bounded technical observation.") {
  const authorTasks = [
    "architecture-analysis",
    "product-code-trace",
    "security-analysis",
    "decision-synthesis",
  ];
  const outcomes = authorTasks.flatMap((taskKind) => [
    author("codex", taskKind, summary),
    author("claude-code", taskKind, summary),
  ]);
  const codexSecurity = outcomes.find(
    ({ provider, taskKind }) => provider === "codex" && taskKind === "security-analysis",
  );
  const codexDecision = outcomes.find(
    ({ provider, taskKind }) => provider === "codex" && taskKind === "decision-synthesis",
  );
  outcomes.push(
    reviewer("claude-code", "finding-review", codexSecurity),
    reviewer("claude-code", "decision-review", codexDecision),
    reviewer("claude-code", "plain-language-review", codexDecision),
  );
  return outcomes;
}

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "rak-successor-"));
  const outputDirectory = join(root, "successor");
  await mkdir(outputDirectory, { mode: 0o700 });
  const base = await baseDraft(root);
  return {
    root,
    options: {
      normalizedProviderOutcomes: equivalentOutcomes(),
      baseDraft: base,
      run: { runId: "run-current" },
      snapshot: { snapshotId: SNAPSHOT_ID },
      evidenceOccurrences: [{ evidenceId: "ev-1" }],
      provenanceActivities: [{ activityId: "source-activity-1" }],
      externalReviewCertificates: [],
      outputDirectory,
      packageBaseName: "provider-successor",
      projectSlug: "fixture",
      commitSha: COMMIT,
      generatedAt: GENERATED_AT,
      ...overrides,
    },
  };
}

async function create(overrides = {}) {
  const { options } = await fixture(overrides);
  return createProviderSuccessorPackage(options);
}

function externalRecord(kind, runId, packageDigest, proposalDigest) {
  const record = {
    schemaVersion: "rak-external-release-record/1.0.0",
    recordId: `record-${kind}`,
    runId,
    packageDigest,
    kind,
    verdict: "passed",
    inputDigest: proposalDigest,
    issuedAt: "2026-07-28T11:00:00.000Z",
    expiresAt: "2026-07-29T11:00:00.000Z",
    issuer: `issuer-${kind}`,
    signatureAlgorithm: "Ed25519",
    signingKeyId: `key-${kind}`,
    signature: "fixture-signature",
  };
  return {
    ...record,
    receiptDigest: canonicalDigest({
      domain: "rak-external-release-record/v1",
      binding: record,
    }),
  };
}

test("creates a new deterministic blocked successor and leaves its base unchanged", async () => {
  const { options } = await fixture();
  const before = await readFile(options.baseDraft.zipPath);
  const first = await createProviderSuccessorPackage(options);
  const secondRoot = await mkdtemp(join(tmpdir(), "rak-successor-second-"));
  const second = await createProviderSuccessorPackage({
    ...options,
    outputDirectory: secondRoot,
  });
  assert.equal(first.successor.status, "DRAFT_VALIDATED_RELEASE_BLOCKED");
  assert.equal(first.successor.customerReleaseAuthorized, false);
  assert.equal(first.successor.zipSha256, second.successor.zipSha256);
  assert.notEqual(first.successor.zipSha256, options.baseDraft.zipSha256);
  assert.deepEqual(await readFile(options.baseDraft.zipPath), before);
  assert.equal(first.successor.freshProcessValidation.status, "passed");
  assert.equal(first.reconciliation.crossProviderEquivalent, true);
});

test("derives provider activity and occurrence eligibility for every successor artifact", async () => {
  const result = await create();
  const entries = reopenZip(await readFile(result.successor.zipPath));
  const manifest = JSON.parse(
    Buffer.from(entries.find(({ path }) => path === "manifest.json").content).toString("utf8"),
  );
  const successorEntries = manifest.entries.filter(({ path }) =>
    [
      "data/provider-activity.json",
      "data/provider-reconciliation.json",
      "data/release-readiness.json",
      "reports/provider-successor.md",
    ].includes(path),
  );
  assert.equal(successorEntries.length, 4);
  assert.ok(
    successorEntries.every(
      ({ eligibility }) =>
        eligibility.outputClass === "O3-trusted-derivative" &&
        eligibility.provenanceActivityIds.length === 11 &&
        eligibility.sourceEvidenceIds.length === 11,
    ),
  );
});

for (const [name, hostile] of [
  ["AWS key", `Observed AKIA${"A".repeat(16)} in output.`],
  [
    "private key",
    "Observed -----BEGIN PRIVATE KEY----- ABCDEFGHIJKLMNOP -----END PRIVATE KEY-----.",
  ],
  ["host path", "Observed /home/alice/private/repository.txt."],
  ["compliance overclaim", "The repository is fully compliant."],
]) {
  test(`redacts and excludes ${name} from admitted closed proposal derivatives`, async () => {
    const result = await create({ normalizedProviderOutcomes: equivalentOutcomes(hostile) });
    const bytes = await readFile(result.successor.zipPath);
    const text = reopenZip(bytes)
      .map(({ content }) => Buffer.from(content).toString("utf8"))
      .join("\n");
    assert.ok(!text.includes(hostile));
  });
}

test("quarantines active HTML without writing it into a package", async () => {
  await assert.rejects(
    create({ normalizedProviderOutcomes: equivalentOutcomes("<script>alert(1)</script>") }),
    (error) =>
      error instanceof ProviderSuccessorPackageError &&
      error.code === "PROVIDER_PROPOSAL_QUARANTINED",
  );
});

test("rejects arbitrary proposal members", async () => {
  const outcomes = equivalentOutcomes();
  const first = outcomes[0];
  first.proposal.content = { ...first.proposal.content, rawTranscript: "do not package me" };
  first.proposalDigest = canonicalDigest(first.proposal);
  await assert.rejects(
    create({ normalizedProviderOutcomes: outcomes }),
    (error) => error.code === "SCHEMA_INVALID",
  );
});

test("rejects object bombs before semantic admission", async () => {
  const outcomes = equivalentOutcomes();
  let bomb = { claims: [], limitations: [] };
  for (let index = 0; index < 20; index += 1) bomb = { child: bomb };
  outcomes[0].proposal.content = bomb;
  outcomes[0].proposalDigest = canonicalDigest(outcomes[0].proposal);
  await assert.rejects(
    create({ normalizedProviderOutcomes: outcomes }),
    (error) => error.code === "PROVIDER_PROPOSAL_QUARANTINED",
  );
});

test("rejects an evidence reference outside the current admitted view", async () => {
  const outcomes = equivalentOutcomes();
  outcomes[0].proposal.content.claims[0].evidenceOccurrenceIds = ["ev-missing"];
  outcomes[0].proposalDigest = canonicalDigest(outcomes[0].proposal);
  await assert.rejects(
    create({ normalizedProviderOutcomes: outcomes }),
    (error) => error.code === "EVIDENCE_REFERENCE_MISMATCH",
  );
});

test("same-provider review is visible but never accepted as independent", async () => {
  const outcomes = equivalentOutcomes();
  const security = outcomes.find(
    ({ provider, taskKind }) => provider === "codex" && taskKind === "security-analysis",
  );
  const index = outcomes.findIndex(({ taskKind }) => taskKind === "finding-review");
  outcomes[index] = reviewer("codex", "finding-review", security);
  const result = await create({ normalizedProviderOutcomes: outcomes });
  const review = result.reconciliation.independentReviews.find(
    ({ taskKind }) => taskKind === "finding-review",
  );
  assert.equal(review.distinctProvider, false);
  assert.equal(review.accepted, false);
  assert.equal(result.reconciliation.crossProviderEquivalent, false);
  assert.equal(result.successor.customerReleaseAuthorized, false);
});

test("detects successor ZIP tampering", async () => {
  const result = await create();
  const bytes = Buffer.from(await readFile(result.successor.zipPath));
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  assert.throws(() => validateProviderSuccessorZip(bytes), /ZIP|checksum|manifest|invalid/i);
});

test("rejects a self-consistent ZIP that relabels draft release truth", async () => {
  const result = await create();
  const bytes = await readFile(result.successor.zipPath);
  const entries = new Map(reopenZip(bytes).map((entry) => [entry.path, entry.content]));
  const readiness = JSON.parse(
    Buffer.from(entries.get("data/release-readiness.json")).toString("utf8"),
  );
  readiness.customerReleaseAuthorized = true;
  readiness.acceptedRecordIds = ["forged"];
  readiness.blockers = [];
  const tampered = replacePayloadEntry(
    bytes,
    "data/release-readiness.json",
    `${canonical(readiness)}\n`,
    (manifest) => {
      manifest.customerReleaseAuthorized = true;
      manifest.status = "RELEASED";
    },
  );
  assert.throws(() => validateProviderSuccessorZip(tampered), /truth is invalid/i);
});

test("rejects duplicate JSON members even with recomputed manifest and checksums", async () => {
  const result = await create();
  const bytes = await readFile(result.successor.zipPath);
  const entries = new Map(reopenZip(bytes).map((entry) => [entry.path, entry.content]));
  const original = Buffer.from(entries.get("data/release-readiness.json")).toString("utf8").trim();
  const duplicate = `${original.slice(0, -1)},"customerReleaseAuthorized":false}\n`;
  const tampered = replacePayloadEntry(bytes, "data/release-readiness.json", duplicate);
  assert.throws(() => validateProviderSuccessorZip(tampered), /strict JSON/i);
});

test("exclusive finalization refuses to overwrite an existing successor", async () => {
  const { options } = await fixture();
  await createProviderSuccessorPackage(options);
  await assert.rejects(createProviderSuccessorPackage(options), /exist/i);
});

test("production authority omission leaves every release authority blocked", async () => {
  const result = await create();
  assert.equal(result.releaseReadiness.customerReleaseAuthorized, false);
  assert.equal(result.releaseReadiness.fixtureAuthorityUsed, false);
  assert.equal(result.releaseReadiness.blockers.length, 9);
});

test("explicit fixture authority authorizes only a complete current bound certificate set", async () => {
  const result = await create();
  const records = [
    "independent-security",
    "independent-decision",
    "technical-human",
    "lay-human",
    "cross-provider-equivalence",
    "official-schema-validation",
    "signed-release-assets",
    "runtime-platform",
    "release-authorization",
  ].map((kind) =>
    externalRecord(
      kind,
      result.successor.runId,
      result.successor.zipSha256,
      result.releaseReadiness.proposalDigest,
    ),
  );
  const readiness = await evaluateSuccessorReleaseReadiness({
    runId: result.successor.runId,
    packageDigest: result.successor.zipSha256,
    proposalDigest: result.releaseReadiness.proposalDigest,
    records,
    providerOutcomes: equivalentOutcomes(),
    authority: {
      mode: "fixture-test-only",
      async verify() {
        return true;
      },
    },
    now: Date.parse(GENERATED_AT),
  });
  assert.equal(readiness.customerReleaseAuthorized, true);
  assert.deepEqual(readiness.blockers, []);
  assert.equal(readiness.acceptedRecordIds.length, 9);
});

test("a stale, mismatched, duplicate, or unsigned record cannot authorize release", async () => {
  const result = await create();
  const good = externalRecord(
    "official-schema-validation",
    result.successor.runId,
    result.successor.zipSha256,
    result.releaseReadiness.proposalDigest,
  );
  const bad = { ...good, recordId: "tampered", packageDigest: `sha256:${"f".repeat(64)}` };
  const readiness = await evaluateSuccessorReleaseReadiness({
    runId: result.successor.runId,
    packageDigest: result.successor.zipSha256,
    proposalDigest: result.releaseReadiness.proposalDigest,
    records: [good, good, bad],
    providerOutcomes: equivalentOutcomes(),
    authority: { mode: "fixture-test-only", verify: () => true },
    now: Date.parse(GENERATED_AT),
  });
  assert.equal(readiness.customerReleaseAuthorized, false);
  assert.ok(readiness.rejectedRecordIds.length >= 2);
});

#!/usr/bin/env node

import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { decodeProviderBrokerResult } from "./provider-broker.mjs";
import { reopenZip } from "../packages/packaging/dist/index.js";
import {
  createProviderSuccessorPackage,
  validateProviderSuccessorZip,
} from "./provider-successor-package.mjs";
import { createProductionHostHelperClient } from "./host-helper-client.mjs";
import { loadProductionInstallationConfig } from "./production-installation-config.mjs";
import { createProviderTaskEnvelope } from "../packages/agent-adapters/dist/index.js";
import {
  canonicalJson,
  exclusiveFsyncWrite,
  loadJournal,
  parseStrictJson,
  sha256,
  stableReleaseId,
} from "./release-run-state.mjs";
import { createCapsule, createTask, safeEvidenceView } from "./run-release-assessment.mjs";
import {
  captureImmutableLocalIdentity,
  verifyImmutableLocalSnapshot,
} from "./immutable-local-snapshot.mjs";
import { verifyReleaseRun } from "./verify-release-run.mjs";

export const PAIR_STATE_FILE = "provider-pair-state.json";
export const CUSTOMER_RELEASE_FILE = "customer-release-certificate.json";
export const HUMAN_REVIEW_KINDS = Object.freeze([
  "independent-security",
  "independent-decision",
  "technical-human",
  "lay-human",
  "customer-acceptance",
]);
export const PLATFORM_CERTIFICATE_KINDS = Object.freeze([
  "linux-arm64",
  "linux-x86-64",
  "macos-arm64",
  "macos-x86-64",
]);

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const NONCE = /^[A-Za-z0-9_-]{16,256}$/u;
const PAIR_SCHEMA = "rak-provider-pair-state/1.0.0";
const REVIEW_SCHEMA = "rak-signed-human-review/1.0.0";
const AUTHORIZATION_SCHEMA = "rak-signed-customer-release-authorization/1.0.0";
const RELEASE_SCHEMA = "rak-customer-release-certificate/1.0.0";
const REVIEW_DOMAIN = "rak-signed-human-review/v1";
const AUTHORIZATION_DOMAIN = "rak-signed-customer-release-authorization/v1";
const RELEASE_DOMAIN = "rak-customer-release-certificate/v1";
const REQUIRED_AUTHOR_TASKS = Object.freeze([
  "architecture-analysis",
  "product-code-trace",
  "security-analysis",
  "decision-synthesis",
]);
const CROSS_REVIEW_TASKS = new Map([
  ["finding-review", "security-analysis"],
  ["decision-review", "decision-synthesis"],
  ["plain-language-review", "decision-synthesis"],
]);
const INPUT_BINDING_KEYS = Object.freeze([
  "snapshotId",
  "snapshotManifestDigest",
  "discoveryRevisionDigest",
  "workflowProfile",
  "exportProfile",
  "contractProfile",
  "assessmentPlanDigest",
  "policyDigest",
  "toolchainLockDigest",
  "standardsLockDigest",
  "instructionBundleDigest",
  "capabilityRequirementsDigest",
]);
const CERTIFICATE_KEYS = Object.freeze([
  "releaseAssets",
  "toolchain",
  "images",
  "sbom",
  "provenance",
  "vulnerability",
  "officialSchemas",
  "platforms",
  "providerCanaries",
  "providerEquivalence",
  "ssh",
  "cleanupReceipts",
]);
const PRODUCTION_DEPENDENCY_TOKEN = Symbol("production-release-dependencies");

export class PublicReleaseTransitionError extends Error {
  constructor(code, message, remediation, details = undefined) {
    super(message);
    this.name = "PublicReleaseTransitionError";
    this.code = code;
    this.remediation = remediation;
    if (details !== undefined) this.details = structuredClone(details);
  }
}

function fail(code, message, remediation, details) {
  throw new PublicReleaseTransitionError(code, message, remediation, details);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, code = "RECORD_SCHEMA_INVALID") {
  if (!isRecord(value)) fail(code, "Record must be an object.", "Use the frozen JSON schema.");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code, "Record has missing or unknown fields.", "Use exactly the frozen JSON fields.");
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    fail("RECORD_SCHEMA_INVALID", `${label} is invalid.`, "Use a bounded release identifier.");
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail("RECORD_SCHEMA_INVALID", `${label} is invalid.`, "Use a lowercase SHA-256 digest.");
  }
}

function without(value, fields) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));
}

function domainBytes(domain, payload) {
  return Buffer.from(`${domain}\0${canonicalJson(payload)}`, "utf8");
}

function recordDigest(value) {
  return sha256(canonicalJson(value));
}

function validateClosedReceipt(receipt, outboxName, bytes) {
  exactKeys(
    receipt,
    ["receiptId", "outboxName", "mediaType", "byteLength", "sha256", "closed"],
    "CROSS_REVIEW_RECEIPT_INVALID",
  );
  if (
    !ID.test(receipt.receiptId) ||
    receipt.outboxName !== outboxName ||
    typeof receipt.mediaType !== "string" ||
    !/^(?:0|[1-9]\d*)$/u.test(receipt.byteLength) ||
    !DIGEST.test(receipt.sha256) ||
    receipt.closed !== true ||
    (bytes !== undefined &&
      (receipt.byteLength !== String(bytes.byteLength) || receipt.sha256 !== sha256(bytes)))
  ) {
    fail(
      "CROSS_REVIEW_RECEIPT_INVALID",
      "Cross-review receipt is not exact, closed, and byte-bound.",
      "Preserve the provider result and retry with a fresh pair.",
    );
  }
}

function validateTimeWindow(record, now) {
  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now ||
    expiresAt <= now ||
    expiresAt <= issuedAt
  ) {
    fail(
      "SIGNED_RECORD_TIME_INVALID",
      "Signed record is future-issued, expired, or has an invalid time window.",
      "Obtain a newly signed current record.",
    );
  }
}

function publicKeyFor(authorities, keyId, purpose, kind) {
  if (authorities?.mode !== "fixture-test-only" && authorities?.mode !== "production") {
    fail(
      "RELEASE_AUTHORITY_UNAVAILABLE",
      "Trusted release authority configuration is unavailable.",
      "Install root-owned configured public review and release keys.",
    );
  }
  if (authorities.mode === "production" && String(keyId).startsWith("fixture-")) {
    fail(
      "FIXTURE_AUTHORITY_REJECTED",
      "Fixture signing keys are prohibited by the public release route.",
      "Use a configured production public key.",
    );
  }
  const collection = purpose === "review" ? authorities.reviewKeys : authorities.authorizationKeys;
  const configured = collection instanceof Map ? collection.get(keyId) : collection?.[keyId];
  const key = isRecord(configured) ? configured.publicKey : configured;
  if (
    key === undefined ||
    (purpose === "review" && (!isRecord(configured) || configured.kind !== kind))
  ) {
    fail(
      "SIGNING_KEY_UNTRUSTED",
      "Signing key is not trusted for this record kind.",
      "Use the configured key assigned to this review or authorization kind.",
    );
  }
  return {
    key,
    configured,
    keyDigest: sha256(createPublicKey(key).export({ type: "spki", format: "der" })),
  };
}

function verifyEd25519(record, domain, key) {
  let signature;
  try {
    signature = Buffer.from(record.signature, "base64");
    if (signature.byteLength !== 64) throw new Error("invalid signature length");
    const publicKey = createPublicKey(key);
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
    if (
      !verifySignature(
        null,
        domainBytes(domain, without(record, ["signature"])),
        publicKey,
        signature,
      )
    ) {
      throw new Error("signature mismatch");
    }
  } catch {
    fail(
      "SIGNED_RECORD_SIGNATURE_INVALID",
      "Ed25519 signature verification failed.",
      "Sign the exact domain-separated canonical payload with its configured key.",
    );
  }
}

async function readNoFollowJson(filePath, label) {
  return parseStrictJson((await readNoFollowBytes(filePath, label)).toString("utf8"), label);
}

async function readNoFollowBytes(filePath, label) {
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("not a regular file");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error("changed during read");
    }
    return bytes;
  } catch (error) {
    if (error instanceof PublicReleaseTransitionError) throw error;
    fail(
      "RELEASE_PATH_UNSAFE",
      `${label} is absent, symbolic, non-regular, or unstable.`,
      "Use the exact owner-private no-symlink generated path.",
    );
  } finally {
    await handle?.close();
  }
}

async function assertPrivatePath(candidate, generatedRoot, kind) {
  const root = await realpath(generatedRoot).catch(() => undefined);
  const absolute = path.resolve(candidate);
  if (root === undefined || absolute === root || !absolute.startsWith(`${root}${path.sep}`)) {
    fail(
      "RELEASE_PATH_OUTSIDE_GENERATED",
      "Release path is outside the installation generated root.",
      "Use an emitted generated run, pair, or record path.",
    );
  }
  let cursor = root;
  for (const segment of path.relative(root, absolute).split(path.sep)) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor).catch(() => undefined);
    const expectedType =
      cursor === absolute
        ? kind === "directory"
          ? info?.isDirectory()
          : info?.isFile()
        : info?.isDirectory();
    if (
      info === undefined ||
      info.isSymbolicLink() ||
      !expectedType ||
      (typeof process.getuid === "function" && info.uid !== process.getuid()) ||
      (info.mode & 0o077) !== 0
    ) {
      fail(
        "RELEASE_PATH_UNSAFE",
        "Release path is not owner-private, has a symlink, or has the wrong type.",
        "Use a mode-0700 directory or mode-0600 regular file owned by this account.",
      );
    }
  }
  return await realpath(absolute);
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicPairWrite(pairDirectory, state) {
  const next = structuredClone(state);
  next.journalDigest = sha256(canonicalJson({ ...next, journalDigest: undefined }));
  const destination = path.join(pairDirectory, PAIR_STATE_FILE);
  const temporary = `${destination}.tmp-${randomBytes(8).toString("hex")}`;
  const handle = await open(
    temporary,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, destination);
  await fsyncDirectory(pairDirectory);
  Object.assign(state, next);
}

async function processStartToken(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    return stat.slice(close + 2).split(" ")[19];
  } catch {
    return undefined;
  }
}

async function withPairLock(pairDirectory, operation) {
  const lockPath = path.join(pairDirectory, ".transition.lock");
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
    let handle;
    try {
      handle = await open(
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(
        `${JSON.stringify({
          pid: process.pid,
          processStartToken: await processStartToken(process.pid),
        })}\n`,
      );
      await handle.sync();
      acquired = true;
    } catch (error) {
      if (error?.code !== "EEXIST" || attempt > 0) break;
      const existing = await readNoFollowJson(lockPath, "pair transition lock").catch(
        () => undefined,
      );
      const existingInfo = await lstat(lockPath).catch(() => undefined);
      let ownerAlive = existingInfo !== undefined && Date.now() - existingInfo.mtimeMs < 5_000;
      if (isRecord(existing) && Number.isSafeInteger(existing.pid) && existing.pid > 0) {
        ownerAlive = true;
        try {
          process.kill(existing.pid, 0);
        } catch (ownerError) {
          ownerAlive = ownerError?.code !== "ESRCH";
        }
        if (
          ownerAlive &&
          typeof existing.processStartToken === "string" &&
          (await processStartToken(existing.pid)) !== existing.processStartToken
        ) {
          ownerAlive = false;
        }
      }
      if (ownerAlive) break;
      if (
        existingInfo === undefined ||
        existingInfo.isSymbolicLink() ||
        !existingInfo.isFile() ||
        (existingInfo.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === "function" && existingInfo.uid !== process.getuid())
      ) {
        break;
      }
      await unlink(lockPath);
      await fsyncDirectory(pairDirectory);
    } finally {
      await handle?.close();
    }
  }
  if (!acquired) {
    fail(
      "PAIR_TRANSITION_BUSY",
      "Another exclusive pair transition is active.",
      "Retry after the current pair transition completes; dead-owner locks recover automatically.",
    );
  }
  try {
    return await operation();
  } finally {
    await unlink(lockPath).catch(() => {});
    await fsyncDirectory(pairDirectory);
  }
}

function validateInputBinding(binding, digest) {
  exactKeys(binding, INPUT_BINDING_KEYS, "INPUT_BINDING_INVALID");
  for (const field of INPUT_BINDING_KEYS.filter((key) => key.endsWith("Digest"))) {
    assertDigest(binding[field], field);
  }
  if (
    binding.workflowProfile !== "rak-workflow/1.0.0" ||
    binding.exportProfile !== "rak-export-profile/1.0.0" ||
    binding.contractProfile !== "rak-contract/1.0.0" ||
    sha256(canonicalJson(binding)) !== digest
  ) {
    fail(
      "INPUT_BINDING_INVALID",
      "Architecture section 7.4 input binding is malformed or has a digest mismatch.",
      "Run both providers from the exact same frozen input and release profiles.",
    );
  }
}

async function loadTerminalRun(runDirectory, expectedProvider, kitRoot) {
  const loaded = await loadJournal(runDirectory, kitRoot);
  const { state } = loaded;
  if (
    state.provider !== expectedProvider ||
    state.status !== "DRAFT_VALIDATED_RELEASE_BLOCKED" ||
    state.cleanup?.status !== "verified" ||
    state.cleanup?.residue?.length !== 0 ||
    state.providerSuccessor?.successor?.status !== "DRAFT_VALIDATED_RELEASE_BLOCKED" ||
    (state.runtimeMode === "isolated" &&
      (state.isolatedRuntime?.state !== "SUCCEEDED" ||
        state.isolatedRuntime?.cleanup?.state !== "COMPLETE" ||
        state.isolatedRuntime?.cleanup?.residueIds?.length !== 0))
  ) {
    fail(
      "PAIR_RUN_NOT_ELIGIBLE",
      `${expectedProvider} run is not an immutable terminal closed-provider draft.`,
      "Complete the production provider run and zero-residue cleanup first.",
    );
  }
  const receipt = await verifyReleaseRun(loaded.runDirectory, kitRoot);
  if (
    receipt.runId !== state.runId ||
    receipt.provider !== expectedProvider ||
    receipt.journalDigest !== state.journalDigest ||
    receipt.status !== "DRAFT_VALIDATED_RELEASE_BLOCKED" ||
    receipt.customerReleaseAuthorized !== false
  ) {
    fail(
      "PAIR_RECEIPT_INVALID",
      "Terminal run receipt does not bind the current journal.",
      "Preserve the drifted run and create a fresh provider run.",
    );
  }
  validateInputBinding(state.inputBinding, state.inputBindingDigest);
  if (state.runtimeMode === "isolated") {
    const runtimeJournal = await readNoFollowBytes(
      state.isolatedRuntime.journalPath,
      "isolated runtime journal",
    ).catch(() => undefined);
    if (
      runtimeJournal === undefined ||
      sha256(runtimeJournal) !== state.isolatedRuntime.journalDigest ||
      !Array.isArray(state.isolatedRuntime.receiptDigests) ||
      state.isolatedRuntime.receiptDigests.length === 0 ||
      new Set(state.isolatedRuntime.receiptDigests).size !==
        state.isolatedRuntime.receiptDigests.length ||
      state.isolatedRuntime.receiptDigests.some((digest) => !DIGEST.test(digest)) ||
      !Array.isArray(state.isolatedRuntime.cleanup.receiptDigests) ||
      state.isolatedRuntime.cleanup.receiptDigests.some(
        (receipt) => !isRecord(receipt) || !DIGEST.test(receipt.digest ?? ""),
      )
    ) {
      fail(
        "PAIR_RUNTIME_RECEIPT_INVALID",
        "Terminal isolated runtime receipts or durable journal are incomplete.",
        "Preserve the run and repeat through the authenticated runtime helper.",
      );
    }
  }
  await verifyImmutableLocalSnapshot({
    snapshotRoot: state.snapshot.snapshotRoot,
    manifest: state.snapshot.manifest,
  }).catch(() => {
    fail(
      "PAIR_SNAPSHOT_DRIFT",
      "Terminal run snapshot bytes no longer match its admitted manifest.",
      "Preserve the run for incident review and create a fresh run.",
    );
  });
  if (state.source?.kind === "ssh") {
    const sourceReceipts = state.sourceAcquisition;
    const receiptKeys = Object.keys(sourceReceipts?.receipts ?? {})
      .sort()
      .join(",");
    const journalBytes = await readNoFollowBytes(
      sourceReceipts?.journalPath,
      "SSH acquisition journal",
    ).catch(() => undefined);
    if (
      receiptKeys !== "acquisition,cleanup,finalize,import,release" ||
      sourceReceipts.receiptDigests?.length !== 5 ||
      new Set(sourceReceipts.receiptDigests).size !== 5 ||
      canonicalJson(sourceReceipts.receiptDigests) !==
        canonicalJson(Object.values(sourceReceipts.receipts).sort()) ||
      sourceReceipts.receiptDigests.some((digest) => !DIGEST.test(digest)) ||
      sourceReceipts.cleanup?.state !== "COMPLETE" ||
      sourceReceipts.cleanup?.residueIds?.length !== 0 ||
      journalBytes === undefined ||
      sha256(journalBytes) !== sourceReceipts.journalDigest
    ) {
      fail(
        "PAIR_SSH_RECEIPT_INVALID",
        "Terminal SSH source receipts or zero-residue cleanup are incomplete.",
        "Preserve the run and repeat trusted helper acquisition.",
      );
    }
  }
  if (["local", "ssh"].includes(state.source?.kind)) {
    const currentSource = await captureImmutableLocalIdentity({
      sourceRoot: state.source.path,
    });
    if (
      currentSource.manifest.payloadDigest !== state.snapshot.payloadDigest ||
      canonicalJson(currentSource.manifest.payload) !==
        canonicalJson(state.snapshot.manifest.payload)
    ) {
      fail(
        "PAIR_SOURCE_DRIFT",
        "Terminal run source bytes no longer match its admitted snapshot.",
        "Preserve the run for incident review and create a fresh run.",
      );
    }
  }
  const providerSuccessor = state.providerSuccessor.successor;
  let providerSuccessorBytes;
  try {
    const successorHandle = await open(
      providerSuccessor.zipPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      providerSuccessorBytes = await successorHandle.readFile();
    } finally {
      await successorHandle.close();
    }
  } catch {
    fail(
      "PAIR_PROVIDER_PACKAGE_DRIFT",
      "Terminal provider successor is absent or unsafe.",
      "Preserve the run for incident review and create a fresh run.",
    );
  }
  if (
    sha256(providerSuccessorBytes) !== providerSuccessor.zipSha256 ||
    validateProviderSuccessorZip(providerSuccessorBytes, {
      runId: providerSuccessor.runId,
      snapshotId: providerSuccessor.snapshotId,
    }).zipSha256 !== providerSuccessor.zipSha256
  ) {
    fail(
      "PAIR_PROVIDER_PACKAGE_DRIFT",
      "Terminal provider successor changed after validation.",
      "Preserve the run for incident review and create a fresh run.",
    );
  }
  const outcomes = [];
  for (const task of state.tasks) {
    if (task.outcome !== "succeeded" || task.admittedProposal === undefined) continue;
    const proposal = await readNoFollowJson(task.admittedProposal.path, "admitted proposal");
    if (sha256(canonicalJson(proposal)) !== task.admittedProposal.proposalDigest) {
      fail(
        "PAIR_PROPOSAL_DRIFT",
        "Admitted provider proposal changed after its terminal receipt.",
        "Preserve the run and create a fresh provider run.",
      );
    }
    outcomes.push({
      provider: state.provider,
      taskKind: task.taskKind,
      providerRole: task.providerRole,
      taskId: task.taskId,
      runId: state.runId,
      attemptId: task.attemptId,
      fenceToken: task.fenceToken,
      outcome: task.outcome,
      proposalDigest: task.admittedProposal.proposalDigest,
      evidenceViewDigest: task.evidenceViewDigest,
      allowedEvidenceOccurrenceIds: task.allowedEvidenceOccurrenceIds,
      proposal,
    });
  }
  for (const taskKind of REQUIRED_AUTHOR_TASKS) {
    if (
      !outcomes.some(
        (outcome) => outcome.providerRole === "author" && outcome.taskKind === taskKind,
      )
    ) {
      fail(
        "PAIR_AUTHOR_OUTCOME_MISSING",
        `Required ${expectedProvider} author outcome ${taskKind} is missing.`,
        "Complete all closed author tasks before pairing.",
      );
    }
  }
  return { ...loaded, state, receipt, outcomes };
}

function normalizedEvidence(outcomes) {
  const ids = new Set();
  for (const outcome of outcomes) {
    for (const id of outcome.allowedEvidenceOccurrenceIds) ids.add(id);
  }
  return [...ids].sort().map((evidenceId) => ({ evidenceId }));
}

async function createCrossReviews({ runs, reviewer, pairId, now, pairDirectory, pairState }) {
  if (reviewer?.mode !== "fixture-test-only" && reviewer?.mode !== "production") {
    fail(
      "CROSS_REVIEW_RUNTIME_UNAVAILABLE",
      "Production provider broker/client is unavailable for cross-review.",
      "Provision both authenticated provider sessions, signed images, and provider-egress authority.",
    );
  }
  const reviews = [];
  for (const authorRun of runs) {
    const reviewerProvider = authorRun.state.provider === "codex" ? "claude-code" : "codex";
    const reviewerRun = runs.find(({ state }) => state.provider === reviewerProvider);
    if (reviewerRun === undefined) {
      fail(
        "CROSS_REVIEW_PROVIDER_MISSING",
        "Opposite provider run is unavailable.",
        "Supply one terminal run from each provider.",
      );
    }
    for (const [taskKind, authorTaskKind] of CROSS_REVIEW_TASKS) {
      const author = authorRun.outcomes.find(
        (candidate) => candidate.providerRole === "author" && candidate.taskKind === authorTaskKind,
      );
      if (author === undefined) {
        fail(
          "CROSS_REVIEW_AUTHOR_MISSING",
          "Cross-review author proposal is unavailable.",
          "Complete the exact foreign author task first.",
        );
      }
      let journalEntry = pairState.crossReviewTasks.find(
        (entry) =>
          entry.taskKind === taskKind &&
          entry.reviewerProvider === reviewerProvider &&
          entry.authorProposalDigest === author.proposalDigest,
      );
      const nonce = journalEntry?.nonce ?? randomBytes(32).toString("base64url");
      const evidenceView = await safeEvidenceView(reviewerRun.state.package.zipPath);
      const agentTask = createTask({
        state: reviewerRun.state,
        taskKind,
        providerRole: "independent-reviewer",
        evidenceView,
        attemptNumber: 1,
        expectedAuthorProposalDigest: author.proposalDigest,
        clock: () => now,
        taskScope: `${pairId}:${nonce}`,
      });
      const capsule = createCapsule(
        reviewerRun.state,
        agentTask,
        evidenceView,
        author.proposalDigest,
      );
      const envelope = createProviderTaskEnvelope(
        reviewerProvider,
        capsule,
        {
          outputAccess: "proposal-outbox",
          providerInference: { attested: true, destination: reviewerProvider },
        },
        new Map([
          [
            "material-claims-cited",
            (proposal) =>
              Array.isArray(proposal.evidenceOccurrenceIds) &&
              proposal.evidenceOccurrenceIds.length > 0
                ? []
                : ["material claims require cited evidence"],
          ],
        ]),
      );
      const taskId = agentTask.taskId;
      const attemptId = agentTask.attemptId;
      const fenceToken = agentTask.fenceToken;
      const jobId = stableReleaseId("job", taskId, attemptId, fenceToken, nonce);
      const task = {
        taskId,
        jobId,
        runId: reviewerRun.state.runId,
        attemptId,
        fenceToken,
        taskKind,
        providerRole: "independent-reviewer",
        reviewerProvider,
        authorProvider: author.provider,
        authorProposalDigest: author.proposalDigest,
        evidenceViewDigest: agentTask.evidenceView.digest,
        allowedEvidenceOccurrenceIds: agentTask.evidenceView.allowedEvidenceIds,
        nonce,
        capsule,
        envelope,
      };
      const taskDirectory = path.join(pairDirectory, "internal", "cross-review-tasks");
      await mkdir(taskDirectory, { recursive: true, mode: 0o700 });
      const taskPath = path.join(taskDirectory, `${jobId}.json`);
      const envelopeBytes = Buffer.from(`${canonicalJson(envelope)}\n`, "utf8");
      if (envelopeBytes.byteLength > 524_288) {
        fail(
          "CROSS_REVIEW_TASK_TOO_LARGE",
          "Canonical cross-review task bytes exceed the fixed helper staging limit.",
          "Reduce the bounded safe-evidence view and create a fresh pair.",
        );
      }
      task.envelopeDigest = sha256(canonicalJson(envelope));
      task.taskBytesDigest = sha256(envelopeBytes);
      if (journalEntry === undefined) {
        journalEntry = {
          taskId,
          jobId,
          taskKind,
          authorProvider: author.provider,
          reviewerProvider,
          authorProposalDigest: author.proposalDigest,
          reviewerRunId: reviewerRun.state.runId,
          attemptId,
          fenceToken,
          nonce,
          envelopeDigest: sha256(canonicalJson(envelope)),
          taskBytesDigest: sha256(envelopeBytes),
          deadlineAt: agentTask.deadlineAt,
          budget: structuredClone(agentTask.budget),
          state: "ADMITTED",
          admittedAt: now,
        };
        pairState.crossReviewTasks.push(journalEntry);
        await atomicPairWrite(pairDirectory, pairState);
        await exclusiveFsyncWrite(taskPath, envelopeBytes, 0o600);
      } else {
        if (
          journalEntry.deadlineAt !== agentTask.deadlineAt ||
          canonicalJson(journalEntry.budget) !== canonicalJson(agentTask.budget)
        ) {
          fail(
            "CROSS_REVIEW_TASK_DRIFT",
            "Prepared cross-review deadline or budget changed after admission.",
            "Preserve the pair for incident review.",
          );
        }
        if ((await lstat(taskPath).catch(() => undefined)) === undefined) {
          if (
            journalEntry.envelopeDigest !== sha256(canonicalJson(envelope)) ||
            journalEntry.taskBytesDigest !== sha256(envelopeBytes) ||
            journalEntry.deadlineAt !== agentTask.deadlineAt ||
            canonicalJson(journalEntry.budget) !== canonicalJson(agentTask.budget)
          ) {
            fail(
              "CROSS_REVIEW_TASK_DRIFT",
              "Prepared cross-review authority cannot reconstruct its exact task bytes.",
              "Preserve the pair for incident review.",
            );
          }
          await exclusiveFsyncWrite(taskPath, envelopeBytes, 0o600);
        }
        const persistedEnvelope = await readNoFollowJson(taskPath, "cross-review task envelope");
        if (
          journalEntry.envelopeDigest !== sha256(canonicalJson(persistedEnvelope)) ||
          canonicalJson(persistedEnvelope) !== canonicalJson(envelope)
        ) {
          fail(
            "CROSS_REVIEW_TASK_DRIFT",
            "Persisted cross-review task does not match its admitted authority.",
            "Preserve the pair for incident review.",
          );
        }
      }
      if (journalEntry.state === "COMPLETED") {
        const proposal = await readNoFollowJson(
          path.join(taskDirectory, `${jobId}.proposal.json`),
          "completed cross-review proposal",
        );
        const proposalDigest = sha256(canonicalJson(proposal));
        if (proposalDigest !== journalEntry.reviewerProposalDigest) {
          fail(
            "CROSS_REVIEW_RESULT_DRIFT",
            "Completed cross-review proposal changed after admission.",
            "Preserve the pair for incident review.",
          );
        }
        reviews.push({
          provider: reviewerProvider,
          taskKind,
          providerRole: "independent-reviewer",
          taskId,
          runId: reviewerRun.state.runId,
          attemptId,
          fenceToken,
          outcome: "succeeded",
          proposalDigest,
          evidenceViewDigest: agentTask.evidenceView.digest,
          allowedEvidenceOccurrenceIds: agentTask.evidenceView.allowedEvidenceIds,
          proposal,
        });
        continue;
      }
      const result = await reviewer.runReview(structuredClone(task));
      exactKeys(result, [
        "jobId",
        "provider",
        "providerSessionId",
        "attemptId",
        "fenceToken",
        "nonce",
        "proposal",
        "proposalBytes",
        "proposalBytesDigest",
        "proposalReceipt",
        "operationalLogReceipt",
        "cleanup",
        ...(reviewer.mode === "production" ? ["helperCleanupReceipt"] : []),
      ]);
      const { proposal } = result;
      validateClosedReceipt(result.proposalReceipt, "provider-proposal", result.proposalBytes);
      validateClosedReceipt(result.operationalLogReceipt, "provider-operational-log");
      exactKeys(proposal, [
        "schemaVersion",
        "schemaId",
        "taskId",
        "runId",
        "attemptId",
        "fenceToken",
        "evidenceOccurrenceIds",
        "limitationIds",
        "content",
      ]);
      exactKeys(proposal.content, [
        "authorProposalDigest",
        "verdict",
        "objectionCodes",
        "evidenceOccurrenceIds",
      ]);
      if (
        reviewerProvider === author.provider ||
        result.jobId !== jobId ||
        result.provider !== reviewerProvider ||
        typeof result.providerSessionId !== "string" ||
        !ID.test(result.providerSessionId) ||
        result.attemptId !== attemptId ||
        result.fenceToken !== fenceToken ||
        result.nonce !== nonce ||
        proposal.taskId !== taskId ||
        proposal.runId !== reviewerRun.state.runId ||
        proposal.attemptId !== attemptId ||
        proposal.fenceToken !== fenceToken ||
        proposal.schemaVersion !== "1.0.0" ||
        proposal.schemaId !== "rak-agent-proposal/1.0.0" ||
        proposal.content.authorProposalDigest !== author.proposalDigest ||
        !["passed", "passed-with-objections"].includes(proposal.content.verdict) ||
        !Array.isArray(proposal.evidenceOccurrenceIds) ||
        new Set(proposal.evidenceOccurrenceIds).size !== proposal.evidenceOccurrenceIds.length ||
        proposal.evidenceOccurrenceIds.some(
          (id) => !agentTask.evidenceView.allowedEvidenceIds.includes(id),
        ) ||
        !Array.isArray(proposal.limitationIds) ||
        proposal.limitationIds.some((id) => typeof id !== "string" || !ID.test(id)) ||
        !Array.isArray(proposal.content.objectionCodes) ||
        proposal.content.objectionCodes.some(
          (code) => typeof code !== "string" || !ID.test(code),
        ) ||
        !Array.isArray(proposal.content.evidenceOccurrenceIds) ||
        proposal.content.evidenceOccurrenceIds.some(
          (id) => !agentTask.evidenceView.allowedEvidenceIds.includes(id),
        ) ||
        !DIGEST.test(result.proposalBytesDigest) ||
        !Buffer.isBuffer(result.proposalBytes) ||
        result.proposalBytesDigest !== sha256(result.proposalBytes) ||
        canonicalJson(
          parseStrictJson(result.proposalBytes.toString("utf8"), "cross-review proposal bytes"),
        ) !== canonicalJson(proposal) ||
        result.proposalReceipt.sha256 !== result.proposalBytesDigest ||
        result.cleanup?.status !== "verified" ||
        !Array.isArray(result.cleanup.residue) ||
        result.cleanup.residue.length !== 0 ||
        (reviewer.mode === "production" &&
          (result.helperCleanupReceipt?.state !== "COMPLETE" ||
            result.helperCleanupReceipt.jobId !== jobId ||
            result.helperCleanupReceipt.attemptId !== attemptId ||
            result.helperCleanupReceipt.fenceToken !== fenceToken ||
            result.helperCleanupReceipt.residueIds?.length !== 0 ||
            result.helperCleanupReceipt.receiptDigest !==
              sha256(
                canonicalJson(
                  Object.fromEntries(
                    Object.entries(result.helperCleanupReceipt).filter(
                      ([key]) => key !== "receiptDigest",
                    ),
                  ),
                ),
              )))
      ) {
        fail(
          "CROSS_REVIEW_BINDING_INVALID",
          "Cross-provider review did not bind the exact foreign author digest and fresh authority.",
          "Retry through the opposite production provider with a fresh attempt, fence, and nonce.",
        );
      }
      const proposalDigest = sha256(canonicalJson(proposal));
      reviews.push({
        provider: reviewerProvider,
        taskKind,
        providerRole: "independent-reviewer",
        taskId,
        runId: reviewerRun.state.runId,
        attemptId,
        fenceToken,
        outcome: "succeeded",
        proposalDigest,
        evidenceViewDigest: agentTask.evidenceView.digest,
        allowedEvidenceOccurrenceIds: agentTask.evidenceView.allowedEvidenceIds,
        proposal,
      });
      Object.assign(journalEntry, {
        reviewerProposalDigest: proposalDigest,
        providerSessionId: result.providerSessionId,
        proposalReceiptDigest: recordDigest(result.proposalReceipt),
        operationalLogReceiptDigest: recordDigest(result.operationalLogReceipt),
        cleanupDigest: recordDigest(result.cleanup),
        ...(result.helperCleanupReceipt === undefined
          ? {}
          : { helperCleanupReceiptDigest: result.helperCleanupReceipt.receiptDigest }),
        state: "COMPLETED",
        completedAt: now,
      });
      await exclusiveFsyncWrite(
        path.join(taskDirectory, `${jobId}.proposal.json`),
        Buffer.from(`${canonicalJson(proposal)}\n`),
        0o600,
      ).catch(async (error) => {
        if (error?.code !== "EEXIST") throw error;
        const existing = await readNoFollowJson(
          path.join(taskDirectory, `${jobId}.proposal.json`),
          "cross-review proposal",
        );
        if (canonicalJson(existing) !== canonicalJson(proposal)) throw error;
      });
      await atomicPairWrite(pairDirectory, pairState);
    }
  }
  return { reviews, taskJournal: pairState.crossReviewTasks };
}

function validateReview(record, state, authorities, now) {
  exactKeys(record, [
    "schemaVersion",
    "recordId",
    "kind",
    "reviewerId",
    "organizationId",
    "independenceDeclaration",
    "equivalencePairId",
    "successorZipDigest",
    "reconciliationDigest",
    "inputBindingDigest",
    "decision",
    "limitationIds",
    "issuedAt",
    "expiresAt",
    "nonce",
    "signingKeyId",
    "signature",
  ]);
  assertId(record.recordId, "recordId");
  assertId(record.reviewerId, "reviewerId");
  assertId(record.organizationId, "organizationId");
  assertId(record.signingKeyId, "signingKeyId");
  if (
    record.schemaVersion !== REVIEW_SCHEMA ||
    !HUMAN_REVIEW_KINDS.includes(record.kind) ||
    typeof record.independenceDeclaration !== "string" ||
    record.independenceDeclaration.trim().length < 8 ||
    record.independenceDeclaration.length > 1024 ||
    record.equivalencePairId !== state.equivalencePairId ||
    record.successorZipDigest !== state.successorZipDigest ||
    record.reconciliationDigest !== state.reconciliationDigest ||
    record.inputBindingDigest !== state.inputBindingDigest ||
    record.decision !== "approved" ||
    !Array.isArray(record.limitationIds) ||
    record.limitationIds.some((id) => typeof id !== "string" || !ID.test(id)) ||
    typeof record.nonce !== "string" ||
    !NONCE.test(record.nonce)
  ) {
    fail(
      record.decision === "rejected" ? "HUMAN_REVIEW_REJECTED" : "HUMAN_REVIEW_INVALID",
      "Human review is rejected, incomplete, or bound to different release inputs.",
      "Provide one current approved independently signed review for the exact pair digest.",
    );
  }
  validateTimeWindow(record, now);
  const { key, keyDigest } = publicKeyFor(authorities, record.signingKeyId, "review", record.kind);
  verifyEd25519(record, REVIEW_DOMAIN, key);
  return keyDigest;
}

function validateCertificateSet(certificates, state, authorities, now) {
  exactKeys(certificates, CERTIFICATE_KEYS, "AUTHORIZATION_CERTIFICATES_INCOMPLETE");
  const scalarKinds = [
    "releaseAssets",
    "toolchain",
    "images",
    "sbom",
    "provenance",
    "vulnerability",
    "officialSchemas",
    "providerCanaries",
    "providerEquivalence",
  ];
  const all = [];
  for (const kind of scalarKinds) all.push([kind, certificates[kind]]);
  if (
    !Array.isArray(certificates.platforms) ||
    certificates.platforms.length !== PLATFORM_CERTIFICATE_KINDS.length ||
    !Array.isArray(certificates.cleanupReceipts) ||
    certificates.cleanupReceipts.length < 2
  ) {
    fail(
      "AUTHORIZATION_CERTIFICATES_INCOMPLETE",
      "Four native platforms and both cleanup receipts are required.",
      "Supply the complete signed product-release certificate set.",
    );
  }
  for (const certificate of certificates.platforms) all.push(["platform", certificate]);
  for (const certificate of certificates.cleanupReceipts) all.push(["cleanup", certificate]);
  if (state.sshRequired === true) all.push(["ssh", certificates.ssh]);
  else if (certificates.ssh !== null) all.push(["ssh", certificates.ssh]);
  const ids = new Set();
  const nonces = new Set();
  const platformKinds = new Set();
  for (const [expectedKind, certificate] of all) {
    exactKeys(
      certificate,
      [
        "schemaVersion",
        "certificateId",
        "kind",
        "equivalencePairId",
        "subjectDigest",
        "decision",
        "issuedAt",
        "expiresAt",
        "nonce",
        "signingKeyId",
        "signature",
      ],
      "AUTHORIZATION_CERTIFICATE_INVALID",
    );
    assertId(certificate.certificateId, "certificateId");
    assertId(certificate.signingKeyId, "certificate signingKeyId");
    assertDigest(certificate.subjectDigest, "certificate subjectDigest");
    validateTimeWindow(certificate, now);
    if (
      certificate.schemaVersion !== "rak-signed-release-certificate/1.0.0" ||
      certificate.equivalencePairId !== state.equivalencePairId ||
      certificate.decision !== "approved" ||
      !NONCE.test(certificate.nonce) ||
      ids.has(certificate.certificateId) ||
      nonces.has(certificate.nonce) ||
      (expectedKind !== "platform" &&
        expectedKind !== "cleanup" &&
        certificate.kind !== expectedKind)
    ) {
      fail(
        "AUTHORIZATION_CERTIFICATE_INVALID",
        "Release certificate is duplicated, rejected, or bound to another pair.",
        "Regenerate the complete signed certificate set for this pair.",
      );
    }
    if (expectedKind === "platform") platformKinds.add(certificate.kind);
    ids.add(certificate.certificateId);
    nonces.add(certificate.nonce);
    const cleanupSubject =
      certificate.kind === "cleanup:codex"
        ? state.cleanup.receiptDigests[0]
        : certificate.kind === "cleanup:claude-code"
          ? state.cleanup.receiptDigests[1]
          : undefined;
    const configuredSubject =
      expectedKind === "cleanup"
        ? cleanupSubject
        : expectedKind === "providerEquivalence"
          ? state.reconciliationDigest
          : expectedKind === "ssh"
            ? sha256(canonicalJson(state.sshReceiptDigests))
            : authorities.certificateSubjects?.[certificate.kind];
    if (
      typeof configuredSubject !== "string" ||
      certificate.subjectDigest !== configuredSubject ||
      (expectedKind === "cleanup" &&
        certificates.cleanupReceipts.filter(
          ({ subjectDigest }) => subjectDigest === certificate.subjectDigest,
        ).length !== 1)
    ) {
      fail(
        "CERTIFICATE_SUBJECT_BINDING_INVALID",
        "Release certificate does not bind the configured current artifact.",
        "Regenerate certificates for the exact signed assets and pair receipts.",
      );
    }
    const configured =
      authorities.certificateKeys instanceof Map
        ? authorities.certificateKeys.get(certificate.signingKeyId)
        : authorities.certificateKeys?.[certificate.signingKeyId];
    if (
      configured === undefined ||
      (isRecord(configured) && configured.kind !== certificate.kind)
    ) {
      fail(
        "CERTIFICATE_KEY_UNTRUSTED",
        "Certificate signing key is not configured.",
        "Use a production certificate authority configured for this release.",
      );
    }
    verifyEd25519(
      certificate,
      "rak-signed-release-certificate/v1",
      configured.publicKey ?? configured,
    );
  }
  if (
    platformKinds.size !== PLATFORM_CERTIFICATE_KINDS.length ||
    PLATFORM_CERTIFICATE_KINDS.some((kind) => !platformKinds.has(kind))
  ) {
    fail(
      "AUTHORIZATION_CERTIFICATES_INCOMPLETE",
      "Native platform certificate matrix is incomplete.",
      "Supply Linux and macOS ARM64 and x86-64 certificates.",
    );
  }
  if (
    !Array.isArray(authorities.unresolvedBoundaryDefects) ||
    authorities.unresolvedBoundaryDefects.some((defect) => {
      if (!isRecord(defect)) return true;
      const keys = Object.keys(defect).sort().join(",");
      if (
        keys !== "defectId,severity,state" ||
        !ID.test(defect.defectId) ||
        !["Critical", "High", "Medium", "Low"].includes(defect.severity) ||
        !["unresolved", "resolved"].includes(defect.state)
      ) {
        return true;
      }
      return ["Critical", "High"].includes(defect.severity) && defect.state !== "resolved";
    })
  ) {
    fail(
      "UNRESOLVED_BOUNDARY_DEFECT",
      "Critical or High boundary defects remain unresolved or defect authority is absent.",
      "Resolve or independently accept every applicable boundary defect before authorization.",
    );
  }
  return sha256(canonicalJson(certificates));
}

function validateAuthorization(record, state, reviews, authorities, now) {
  exactKeys(record, [
    "schemaVersion",
    "recordId",
    "equivalencePairId",
    "successorZipDigest",
    "reconciliationDigest",
    "inputBindingDigest",
    "reviewDigests",
    "certificates",
    "decision",
    "issuedAt",
    "expiresAt",
    "nonce",
    "signingKeyId",
    "signature",
  ]);
  assertId(record.recordId, "authorization recordId");
  assertId(record.signingKeyId, "authorization signingKeyId");
  exactKeys(record.reviewDigests, HUMAN_REVIEW_KINDS);
  if (
    record.schemaVersion !== AUTHORIZATION_SCHEMA ||
    record.equivalencePairId !== state.equivalencePairId ||
    record.successorZipDigest !== state.successorZipDigest ||
    record.reconciliationDigest !== state.reconciliationDigest ||
    record.inputBindingDigest !== state.inputBindingDigest ||
    record.decision !== "approved" ||
    typeof record.nonce !== "string" ||
    !NONCE.test(record.nonce)
  ) {
    fail(
      record.decision === "rejected"
        ? "RELEASE_AUTHORIZATION_REJECTED"
        : "RELEASE_AUTHORIZATION_INVALID",
      "Customer release authorization is rejected or bound to other inputs.",
      "Sign a current authorization for the exact successor, reconciliation, input, and reviews.",
    );
  }
  for (const kind of HUMAN_REVIEW_KINDS) {
    if (record.reviewDigests[kind] !== recordDigest(reviews.get(kind))) {
      fail(
        "AUTHORIZATION_REVIEW_BINDING_INVALID",
        "Authorization does not bind the exact admitted review set.",
        "Regenerate authorization from fresh review records.",
      );
    }
  }
  validateTimeWindow(record, now);
  const certificateSetDigest = validateCertificateSet(record.certificates, state, authorities, now);
  const { key, keyDigest } = publicKeyFor(authorities, record.signingKeyId, "authorization");
  const reviewKeyDigests = [...reviews.values()].map(
    (review) => publicKeyFor(authorities, review.signingKeyId, "review", review.kind).keyDigest,
  );
  if (
    reviewKeyDigests.includes(keyDigest) ||
    [...reviews.values()].some(({ signingKeyId }) => signingKeyId === record.signingKeyId)
  ) {
    fail(
      "AUTHORIZATION_KEY_NOT_INDEPENDENT",
      "Release authorization key is also a reviewer key.",
      "Use a distinct configured release-authority key.",
    );
  }
  verifyEd25519(record, AUTHORIZATION_DOMAIN, key);
  return certificateSetDigest;
}

async function loadPair(pairDirectory, kitRoot) {
  const generatedRoot = path.join(await realpath(kitRoot), "generated");
  const canonicalPair = await assertPrivatePath(pairDirectory, generatedRoot, "directory");
  const statePath = path.join(canonicalPair, PAIR_STATE_FILE);
  await assertPrivatePath(statePath, generatedRoot, "file");
  const state = await readNoFollowJson(statePath, "provider pair journal");
  if (
    state.schemaVersion !== PAIR_SCHEMA ||
    state.journalDigest !== sha256(canonicalJson({ ...state, journalDigest: undefined }))
  ) {
    fail(
      "PAIR_JOURNAL_INTEGRITY_INVALID",
      "Provider pair journal digest is invalid.",
      "Preserve the pair for incident review and create a new pair.",
    );
  }
  validateInputBinding(state.inputBinding, state.inputBindingDigest);
  return { pairDirectory: canonicalPair, state };
}

async function loadReviews(pairDirectory, state) {
  const reviews = new Map();
  for (const kind of HUMAN_REVIEW_KINDS) {
    const binding = state.admittedReviews.find((entry) => entry.kind === kind);
    if (binding === undefined) continue;
    const record = await readNoFollowJson(
      path.join(pairDirectory, "reviews", `${binding.recordId}.json`),
      `${kind} review`,
    );
    if (recordDigest(record) !== binding.recordDigest || record.nonce !== binding.nonce) {
      fail(
        "HUMAN_REVIEW_DRIFT",
        "Admitted human review changed after admission.",
        "Preserve the pair and create a new pair.",
      );
    }
    reviews.set(kind, record);
  }
  return reviews;
}

async function allocatePairDirectory(generatedRoot, pairId) {
  const pairsRoot = path.join(generatedRoot, "pairs");
  await mkdir(pairsRoot, { recursive: true, mode: 0o700 });
  await chmod(pairsRoot, 0o700);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = path.join(pairsRoot, `${pairId}-${randomBytes(6).toString("hex")}`);
    try {
      await mkdir(candidate, { mode: 0o700 });
      await fsyncDirectory(pairsRoot);
      return await realpath(candidate);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  fail(
    "PAIR_DIRECTORY_COLLISION",
    "Could not allocate a unique provider pair directory.",
    "Retry after checking generated/pairs ownership and permissions.",
  );
}

async function loadProductionReleaseDependencies() {
  try {
    const { config, releaseAuthorities: authorities } = await loadProductionInstallationConfig();
    return createProductionReviewerDependencies(config, authorities);
  } catch (error) {
    if (error instanceof PublicReleaseTransitionError) throw error;
    fail(
      "PUBLIC_RELEASE_PREFLIGHT_BLOCKED",
      "Root-owned production release authority configuration is unavailable.",
      "Install /etc/repo-assessment-kit/host-helper.json as root:client-group mode 0440.",
    );
  }
}

function createProductionReviewerDependencies(config, authorities) {
  const helper = createProductionHostHelperClient();
  const reviewer = {
    mode: "production",
    async runReview(task) {
      const profile = config.providerReviewProfiles[task.reviewerProvider];
      if (!isRecord(profile)) {
        fail(
          "CROSS_REVIEW_RUNTIME_UNAVAILABLE",
          "Configured production reviewer profile is unavailable.",
          "Register both provider homes, images, network policy, and schema authority.",
        );
      }
      const jobId = stableReleaseId(
        "job",
        task.taskId,
        task.attemptId,
        task.fenceToken,
        task.nonce,
      );
      if (jobId !== task.jobId) {
        fail(
          "CROSS_REVIEW_BINDING_INVALID",
          "Cross-review job identity does not match its task authority.",
          "Create a fresh pair through the production transition.",
        );
      }
      const envelope = task.envelope;
      const context = {
        installationId: config.installationId,
        runId: task.runId,
        attemptId: task.attemptId,
        fenceToken: task.fenceToken,
        commandId: `${jobId}.preflight`,
      };
      const preflight = await helper.providerPreflight(
        task.reviewerProvider,
        {
          releaseAuthorityDigest: profile.releaseAuthorityDigest,
          immutableImageReference: profile.immutableImageReference,
          providerHomeAuthorityDigest: profile.providerHomeAuthorityDigest,
          networkPolicyDigest: profile.networkPolicyDigest,
          outputSchemaDigest: profile.outputSchemaDigest,
        },
        context,
      );
      if (preflight.state !== "SUCCEEDED") {
        fail(
          preflight.error?.code ?? "CROSS_REVIEW_PREFLIGHT_BLOCKED",
          "Production reviewer preflight was blocked.",
          "Correct the fixed provider runtime prerequisite and retry.",
        );
      }
      const envelopeDigest = sha256(canonicalJson(envelope));
      const taskBytes = Buffer.from(`${canonicalJson(envelope)}\n`, "utf8");
      if (
        envelopeDigest !== task.envelopeDigest ||
        task.taskBytesDigest !== sha256(taskBytes) ||
        taskBytes.byteLength > 524_288
      ) {
        fail(
          "CROSS_REVIEW_TASK_DRIFT",
          "Persisted cross-review envelope digest changed before staging.",
          "Preserve the pair for incident review.",
        );
      }
      const staged = await helper.providerStage(
        {
          jobId,
          provider: task.reviewerProvider,
          envelopeDigest,
          taskBytesDigest: task.taskBytesDigest,
          taskBytesBase64: taskBytes.toString("base64"),
          outputSchemaDigest: profile.outputSchemaDigest,
          providerHomeAuthorityDigest: profile.providerHomeAuthorityDigest,
        },
        { ...context, commandId: `${jobId}.stage` },
      );
      if (staged.state !== "SUCCEEDED") {
        fail(
          staged.error?.code ?? "CROSS_REVIEW_STAGE_BLOCKED",
          "Production reviewer task staging was blocked.",
          "Correct the fixed staging prerequisite and retry.",
        );
      }
      let executed;
      let cleanupResponse;
      try {
        executed = await helper.providerExecute(
          {
            jobId,
            provider: task.reviewerProvider,
            stagedTaskId: staged.result.stagedTaskId,
            immutableImageReference: profile.immutableImageReference,
            networkAttestationDigest: profile.networkPolicyDigest,
            deadlineAt: task.capsule.task.deadlineAt,
            wallSeconds: task.capsule.task.budget.wallSeconds,
            outputBytes: task.capsule.task.budget.outputBytes,
          },
          { ...context, commandId: `${jobId}.execute` },
        );
      } finally {
        cleanupResponse = await helper
          .providerCleanup(
            {
              jobId,
              preserveReceiptIds: [],
            },
            { ...context, commandId: `${jobId}.cleanup` },
          )
          .catch(() => undefined);
      }
      if (executed.state !== "SUCCEEDED") {
        fail(
          executed.error?.code ?? "CROSS_REVIEW_EXECUTE_BLOCKED",
          "Production reviewer execution was blocked.",
          "Correct provider runtime prerequisites and retry with a fresh pair.",
        );
      }
      const providerResult = decodeProviderBrokerResult(executed.result.providerResult);
      const cleanupBinding = {
        state: cleanupResponse?.result?.cleanup?.state ?? "RESIDUE",
        jobId,
        attemptId: task.attemptId,
        fenceToken: task.fenceToken,
        removedResourceIds: cleanupResponse?.result?.cleanup?.removedResourceIds ?? [],
        residueIds: cleanupResponse?.result?.cleanup?.residueIds ?? [
          "provider-cleanup-unavailable",
        ],
        checkedAt: cleanupResponse?.result?.cleanup?.checkedAt ?? new Date().toISOString(),
      };
      const helperCleanupReceipt = {
        ...cleanupBinding,
        receiptDigest: sha256(canonicalJson(cleanupBinding)),
      };
      if (
        providerResult.state !== "completed" ||
        providerResult.proposalOutbox === undefined ||
        cleanupResponse?.state !== "SUCCEEDED" ||
        helperCleanupReceipt.state !== "COMPLETE" ||
        helperCleanupReceipt.residueIds.length !== 0
      ) {
        fail(
          "CROSS_REVIEW_RESULT_INVALID",
          "Production reviewer did not return a closed proposal with verified cleanup.",
          "Preserve provider receipts and retry with a fresh pair.",
        );
      }
      const proposalBytes = Buffer.from(providerResult.proposalOutbox.bytes);
      return {
        jobId,
        provider: task.reviewerProvider,
        providerSessionId: providerResult.providerSessionId,
        attemptId: task.attemptId,
        fenceToken: task.fenceToken,
        nonce: task.nonce,
        proposal: parseStrictJson(proposalBytes.toString("utf8"), "cross-review proposal"),
        proposalBytes,
        proposalBytesDigest: sha256(proposalBytes),
        proposalReceipt: providerResult.proposalOutbox.receipt,
        operationalLogReceipt: providerResult.operationalLogReceipt,
        cleanup: {
          status: "verified",
          residue: [],
        },
        helperCleanupReceipt,
      };
    },
  };
  return { reviewer, authorities };
}

export function createPublicReleaseTransition({
  kitRoot = path.resolve(import.meta.dirname, ".."),
  mode = "production",
  reviewer,
  authorities,
  clock = () => Date.now(),
  productionDependencyToken,
} = {}) {
  if (mode === "fixture-test-only") {
    if (reviewer?.mode !== mode || authorities?.mode !== mode) {
      fail(
        "FIXTURE_SEAM_INVALID",
        "Fixture transition requires explicit fixture-only reviewer and authorities.",
        "Inject all fixture authorities in-process with mode fixture-test-only.",
      );
    }
  } else if (
    (reviewer !== undefined || authorities !== undefined) &&
    productionDependencyToken !== PRODUCTION_DEPENDENCY_TOKEN
  ) {
    fail(
      "PRODUCTION_DEPENDENCY_INJECTION_REJECTED",
      "Public production transition cannot accept injected broker or signing authorities.",
      "Install fixed root-owned production authorities; use fixture-test-only mode in tests.",
    );
  }
  const operations = Object.freeze({
    async pair({ codexRunDirectory, claudeRunDirectory }) {
      if (codexRunDirectory === claudeRunDirectory) {
        fail(
          "PAIR_RUN_REUSE",
          "A provider run cannot occupy both sides of a pair.",
          "Supply one explicit Codex run and one explicit Claude Code run.",
        );
      }
      const [codex, claude] = await Promise.all([
        loadTerminalRun(codexRunDirectory, "codex", kitRoot),
        loadTerminalRun(claudeRunDirectory, "claude-code", kitRoot),
      ]);
      if (
        codex.state.runId === claude.state.runId ||
        canonicalJson(codex.state.inputBinding) !== canonicalJson(claude.state.inputBinding) ||
        codex.state.inputBindingDigest !== claude.state.inputBindingDigest
      ) {
        fail(
          "PAIR_INPUT_MISMATCH",
          "Provider runs have reused IDs or different architecture section 7.4 inputs.",
          "Run both providers against the exact same snapshot, discovery, plan, policies, and locks.",
        );
      }
      const generatedRoot = path.join(await realpath(kitRoot), "generated");
      const pairIndex = path.join(generatedRoot, "pairs");
      const pairId = stableReleaseId(
        "pair",
        codex.state.runId,
        claude.state.runId,
        codex.state.inputBindingDigest,
      );
      const existingIndex = path.join(pairIndex, `${pairId}.used`);
      const existingInfo = await lstat(existingIndex).catch(() => undefined);
      let pairDirectory;
      let pairState;
      if (existingInfo !== undefined) {
        if (
          existingInfo.isSymbolicLink() ||
          !existingInfo.isFile() ||
          (existingInfo.mode & 0o077) !== 0
        ) {
          fail(
            "PAIR_INDEX_INVALID",
            "Pair one-use index is unsafe.",
            "Preserve generated/pairs for incident review.",
          );
        }
        const relativePair = (await readFile(existingIndex, "utf8")).trim();
        pairDirectory = path.join(generatedRoot, relativePair);
        const existingPair = await loadPair(pairDirectory, kitRoot);
        if (
          existingPair.state.equivalencePairId !== pairId ||
          existingPair.state.codexRunId !== codex.state.runId ||
          existingPair.state.claudeRunId !== claude.state.runId ||
          existingPair.state.state !== "PAIRING"
        ) {
          fail(
            "PAIR_REPLAY",
            "These immutable run identities have already been paired.",
            "Use fresh provider run IDs for a new equivalence pair.",
          );
        }
        pairState = existingPair.state;
      } else {
        pairDirectory = await allocatePairDirectory(generatedRoot, pairId);
      }
      const createdAt = pairState?.createdAt ?? new Date(clock()).toISOString();
      pairState ??= {
        schemaVersion: PAIR_SCHEMA,
        equivalencePairId: pairId,
        codexRunId: codex.state.runId,
        claudeRunId: claude.state.runId,
        inputBinding: structuredClone(codex.state.inputBinding),
        inputBindingDigest: codex.state.inputBindingDigest,
        runReceiptDigests: {
          codex: codex.receipt.receiptDigest,
          "claude-code": claude.receipt.receiptDigest,
        },
        runDirectories: {
          codex: path.relative(generatedRoot, codex.runDirectory),
          "claude-code": path.relative(generatedRoot, claude.runDirectory),
        },
        authorProposalDigests: [...codex.outcomes, ...claude.outcomes]
          .filter(({ providerRole }) => providerRole === "author")
          .map(({ proposalDigest }) => proposalDigest)
          .sort(),
        crossReviewTasks: [],
        providerRunIds: [codex.state.runId, claude.state.runId],
        successorRunId: null,
        successorSnapshotId: codex.state.offlineDraft.snapshotId,
        successorZipDigest: null,
        reconciliationDigest: null,
        admittedReviews: [],
        authorization: null,
        pendingAdmission: null,
        pendingRelease: null,
        state: "PAIRING",
        blockers: ["CROSS_PROVIDER_REVIEW_REQUIRED"],
        cleanup: { status: "pending", receiptDigests: [], residue: [] },
        sshRequired: [codex, claude].some(({ state }) => state.source?.kind === "ssh"),
        sshReceiptDigests: [codex, claude]
          .flatMap(({ state }) => state.sourceAcquisition?.receiptDigests ?? [])
          .sort(),
        createdAt,
        journalDigest: "",
      };
      if (existingInfo === undefined) {
        await atomicPairWrite(pairDirectory, pairState);
        await exclusiveFsyncWrite(
          existingIndex,
          `${path.relative(generatedRoot, pairDirectory)}\n`,
          0o600,
        );
      }
      return withPairLock(pairDirectory, async () => {
        const cross = await createCrossReviews({
          runs: [codex, claude],
          reviewer,
          pairId,
          now: createdAt,
          pairDirectory,
          pairState,
        });
        const outcomes = [
          ...codex.outcomes.filter(({ providerRole }) => providerRole === "author"),
          ...claude.outcomes.filter(({ providerRole }) => providerRole === "author"),
          ...cross.reviews,
        ];
        const base = codex.state.package;
        const preparedSuccessorPath = path.join(pairDirectory, "paired-provider-successor.zip");
        const existingSuccessor = await lstat(preparedSuccessorPath).catch(() => undefined);
        let successor;
        if (existingSuccessor === undefined) {
          successor = await createProviderSuccessorPackage({
            normalizedProviderOutcomes: outcomes,
            baseDraft: {
              zipPath: base.zipPath,
              zipSha256: base.zipSha256,
              runId: codex.state.offlineDraft.runId,
              snapshotId: codex.state.offlineDraft.snapshotId,
            },
            run: {
              runId: pairId,
              providerRunIds: [codex.state.runId, claude.state.runId],
              aggregationProfile: "rak-paired-provider-runs/1.0.0",
            },
            snapshot: { snapshotId: codex.state.offlineDraft.snapshotId },
            evidenceOccurrences: normalizedEvidence(outcomes),
            provenanceActivities: [],
            outputDirectory: pairDirectory,
            packageBaseName: "paired-provider-successor",
            projectSlug: codex.state.projectSlug,
            commitSha: codex.state.snapshot.analysisMirrorCommitSha,
            generatedAt: createdAt,
          });
        } else {
          if (
            existingSuccessor.isSymbolicLink() ||
            !existingSuccessor.isFile() ||
            (existingSuccessor.mode & 0o077) !== 0
          ) {
            fail(
              "SUCCESSOR_ZIP_UNSAFE",
              "Prepared paired-provider successor is not owner-private and regular.",
              "Preserve the pair for incident review.",
            );
          }
          const zipBytes = await readNoFollowBytes(
            preparedSuccessorPath,
            "prepared paired-provider successor",
          );
          const payload = new Map(
            reopenZip(zipBytes).map(({ path: entryPath, content }) => [entryPath, content]),
          );
          const reconciliation = parseStrictJson(
            payload.get("data/provider-reconciliation.json")?.toString("utf8") ?? "",
            "prepared provider reconciliation",
          );
          const manifest = parseStrictJson(
            payload.get("manifest.json")?.toString("utf8") ?? "",
            "prepared successor manifest",
          );
          const validation = validateProviderSuccessorZip(zipBytes, {
            runId: manifest.runId,
            snapshotId: codex.state.offlineDraft.snapshotId,
          });
          successor = {
            reconciliation,
            successor: {
              runId: manifest.runId,
              snapshotId: codex.state.offlineDraft.snapshotId,
              zipPath: preparedSuccessorPath,
              zipSha256: validation.zipSha256,
            },
          };
        }
        if (!successor.reconciliation.crossProviderEquivalent) {
          pairState.state = "DRAFT_VALIDATED_RELEASE_BLOCKED";
          pairState.blockers = ["CROSS_PROVIDER_OUTCOME_MISMATCH"];
          pairState.crossReviewTasks = cross.taskJournal;
          pairState.reconciliationDigest = sha256(canonicalJson(successor.reconciliation));
          pairState.successorRunId = successor.successor.runId;
          pairState.successorZipDigest = successor.successor.zipSha256;
          await atomicPairWrite(pairDirectory, pairState);
          fail(
            "PAIR_RECONCILIATION_BLOCKED",
            "Required provider outcomes do not reconcile.",
            "Create fresh successor provider runs after resolving the fixed outcome differences.",
            { pairDirectory },
          );
        }
        pairState.crossReviewTasks = cross.taskJournal;
        pairState.reconciliationDigest = sha256(canonicalJson(successor.reconciliation));
        pairState.successorRunId = successor.successor.runId;
        pairState.successorZipDigest = successor.successor.zipSha256;
        pairState.state = "DRAFT_VALIDATED_RELEASE_BLOCKED";
        pairState.blockers = [...HUMAN_REVIEW_KINDS.map((kind) => `REVIEW_REQUIRED:${kind}`)];
        const cleanupByProvider = Object.fromEntries(
          ["codex", "claude-code"].map((provider) => [
            provider,
            [
              ...((provider === "codex" ? codex : claude).state.providerCleanupReceiptDigests ??
                []),
              ...cross.taskJournal
                .filter(({ reviewerProvider }) => reviewerProvider === provider)
                .map(({ helperCleanupReceiptDigest }) => helperCleanupReceiptDigest)
                .filter((digest) => DIGEST.test(digest ?? "")),
            ],
          ]),
        );
        if (
          reviewer.mode === "production" &&
          Object.values(cleanupByProvider).some(
            (digests) => digests.length === 0 || digests.some((digest) => !DIGEST.test(digest)),
          )
        ) {
          fail(
            "PROVIDER_CLEANUP_RECEIPT_MISSING",
            "A provider run or cross-review lacks an exact helper cleanup receipt.",
            "Preserve the pair and rerun through the authenticated production broker/helper.",
          );
        }
        pairState.cleanup = {
          status: "verified",
          receiptDigests:
            reviewer.mode === "production"
              ? ["codex", "claude-code"].map((provider) =>
                  sha256(canonicalJson([...new Set(cleanupByProvider[provider])].sort())),
                )
              : [
                  sha256(canonicalJson({ provider: "codex", cleanup: codex.state.cleanup })),
                  sha256(
                    canonicalJson({
                      provider: "claude-code",
                      cleanup: claude.state.cleanup,
                    }),
                  ),
                ],
          residue: [],
        };
        await atomicPairWrite(pairDirectory, pairState);
        return { pairDirectory, state: structuredClone(pairState) };
      });
    },

    async review({ pairDirectory, recordPath }) {
      const loaded = await loadPair(pairDirectory, kitRoot);
      const { state } = loaded;
      if (state.state !== "DRAFT_VALIDATED_RELEASE_BLOCKED" || state.authorization !== null) {
        fail(
          "PAIR_STATE_INVALID",
          "Pair is not accepting human reviews.",
          "Use a blocked pair before authorization.",
        );
      }
      const generatedRoot = path.join(await realpath(kitRoot), "generated");
      const canonicalRecord = await assertPrivatePath(recordPath, generatedRoot, "file");
      const record = await readNoFollowJson(canonicalRecord, "signed human review");
      const signingPublicKeyDigest = validateReview(record, state, authorities, clock());
      const duplicates = state.admittedReviews.some(
        (entry) =>
          entry.kind === record.kind ||
          entry.recordId === record.recordId ||
          entry.reviewerId === record.reviewerId ||
          entry.signingKeyId === record.signingKeyId ||
          entry.signingPublicKeyDigest === signingPublicKeyDigest ||
          entry.nonce === record.nonce,
      );
      if (duplicates) {
        fail(
          "HUMAN_REVIEW_REPLAY",
          "Review kind, identity, key, record ID, or nonce has already been admitted.",
          "Obtain a distinct one-use independent review.",
        );
      }
      const reviewsDirectory = path.join(loaded.pairDirectory, "reviews");
      await mkdir(reviewsDirectory, { mode: 0o700 }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
      const admittedRecordDigest = recordDigest(record);
      const reviewPath = path.join(reviewsDirectory, `${record.recordId}.json`);
      if (
        state.pendingAdmission !== null &&
        (state.pendingAdmission.type !== "review" ||
          state.pendingAdmission.recordId !== record.recordId ||
          state.pendingAdmission.recordDigest !== admittedRecordDigest)
      ) {
        fail(
          "PAIR_ADMISSION_INCOMPLETE",
          "A different pair admission is prepared but incomplete.",
          "Resume the exact prepared record admission.",
        );
      }
      if (state.pendingAdmission === null) {
        state.pendingAdmission = {
          type: "review",
          recordId: record.recordId,
          recordDigest: admittedRecordDigest,
        };
        await atomicPairWrite(loaded.pairDirectory, state);
      }
      const existingReview = await lstat(reviewPath).catch(() => undefined);
      if (existingReview === undefined) {
        await exclusiveFsyncWrite(reviewPath, `${JSON.stringify(record, null, 2)}\n`, 0o600);
      } else if (
        recordDigest(await readNoFollowJson(reviewPath, "prepared human review")) !==
        admittedRecordDigest
      ) {
        fail(
          "HUMAN_REVIEW_SIDECAR_CONFLICT",
          "Prepared review sidecar conflicts with its journal digest.",
          "Preserve the pair for incident review.",
        );
      }
      state.admittedReviews.push({
        kind: record.kind,
        recordId: record.recordId,
        reviewerId: record.reviewerId,
        organizationId: record.organizationId,
        signingKeyId: record.signingKeyId,
        signingPublicKeyDigest,
        nonce: record.nonce,
        recordDigest: admittedRecordDigest,
      });
      state.pendingAdmission = null;
      state.admittedReviews.sort((left, right) => left.kind.localeCompare(right.kind));
      state.blockers = HUMAN_REVIEW_KINDS.filter(
        (kind) => !state.admittedReviews.some((entry) => entry.kind === kind),
      ).map((kind) => `REVIEW_REQUIRED:${kind}`);
      if (state.blockers.length === 0) state.blockers = ["FINAL_AUTHORIZATION_REQUIRED"];
      await atomicPairWrite(loaded.pairDirectory, state);
      return { state: structuredClone(state), admittedRecordId: record.recordId };
    },

    async authorize({ pairDirectory, recordPath }) {
      const loaded = await loadPair(pairDirectory, kitRoot);
      const { state } = loaded;
      if (state.authorization !== null) {
        fail(
          "AUTHORIZATION_REPLAY",
          "This pair already consumed a final authorization.",
          "Final authorizations are one-use.",
        );
      }
      const reviews = await loadReviews(loaded.pairDirectory, state);
      if (reviews.size !== HUMAN_REVIEW_KINDS.length) {
        fail(
          "HUMAN_REVIEWS_INCOMPLETE",
          "All five distinct approved human reviews are required.",
          "Admit exactly one current review of each required kind.",
        );
      }
      for (const review of reviews.values()) validateReview(review, state, authorities, clock());
      const generatedRoot = path.join(await realpath(kitRoot), "generated");
      const canonicalRecord = await assertPrivatePath(recordPath, generatedRoot, "file");
      const record = await readNoFollowJson(canonicalRecord, "signed release authorization");
      const certificateSetDigest = validateAuthorization(
        record,
        state,
        reviews,
        authorities,
        clock(),
      );
      const authorizationPath = path.join(loaded.pairDirectory, "authorization.json");
      const authorizationRecordDigest = recordDigest(record);
      if (
        state.pendingAdmission !== null &&
        (state.pendingAdmission.type !== "authorization" ||
          state.pendingAdmission.recordId !== record.recordId ||
          state.pendingAdmission.recordDigest !== authorizationRecordDigest)
      ) {
        fail(
          "PAIR_ADMISSION_INCOMPLETE",
          "A different pair admission is prepared but incomplete.",
          "Resume the exact prepared authorization admission.",
        );
      }
      if (state.pendingAdmission === null) {
        state.pendingAdmission = {
          type: "authorization",
          recordId: record.recordId,
          recordDigest: authorizationRecordDigest,
        };
        await atomicPairWrite(loaded.pairDirectory, state);
      }
      const existingAuthorization = await lstat(authorizationPath).catch(() => undefined);
      if (existingAuthorization === undefined) {
        await exclusiveFsyncWrite(authorizationPath, `${JSON.stringify(record, null, 2)}\n`, 0o600);
      } else if (
        recordDigest(
          await readNoFollowJson(authorizationPath, "prepared release authorization"),
        ) !== authorizationRecordDigest
      ) {
        fail(
          "AUTHORIZATION_SIDECAR_CONFLICT",
          "Prepared authorization sidecar conflicts with its journal digest.",
          "Preserve the pair for incident review.",
        );
      }
      state.authorization = {
        recordId: record.recordId,
        nonce: record.nonce,
        signingKeyId: record.signingKeyId,
        recordDigest: authorizationRecordDigest,
        certificateSetDigest,
      };
      state.pendingAdmission = null;
      state.blockers = ["CUSTOMER_RELEASE_REVALIDATION_REQUIRED"];
      await atomicPairWrite(loaded.pairDirectory, state);
      return { state: structuredClone(state), authorizationRecordId: record.recordId };
    },

    async release({ pairDirectory }) {
      const loaded = await loadPair(pairDirectory, kitRoot);
      const { state } = loaded;
      if (state.state === "CUSTOMER_RELEASE_AUTHORIZED") {
        fail(
          "CUSTOMER_RELEASE_REPLAY",
          "Customer release has already been published for this pair.",
          "The digest-bound release transition is one-use.",
        );
      }
      if (state.authorization === null) {
        fail(
          "FINAL_AUTHORIZATION_REQUIRED",
          "No final customer release authorization is admitted.",
          "Admit the independently signed authorization first.",
        );
      }
      const [codex, claude] = await Promise.all([
        loadTerminalRun(
          path.join(await realpath(kitRoot), "generated", state.runDirectories.codex),
          "codex",
          kitRoot,
        ),
        loadTerminalRun(
          path.join(await realpath(kitRoot), "generated", state.runDirectories["claude-code"]),
          "claude-code",
          kitRoot,
        ),
      ]);
      if (
        codex.state.runId !== state.codexRunId ||
        claude.state.runId !== state.claudeRunId ||
        codex.receipt.receiptDigest !== state.runReceiptDigests.codex ||
        claude.receipt.receiptDigest !== state.runReceiptDigests["claude-code"] ||
        canonicalJson(codex.state.inputBinding) !== canonicalJson(state.inputBinding) ||
        canonicalJson(claude.state.inputBinding) !== canonicalJson(state.inputBinding)
      ) {
        fail(
          "PAIR_RUN_DRIFT",
          "One or both terminal provider runs no longer match the pair journal.",
          "Preserve the pair for incident review and create fresh runs.",
        );
      }
      const reviews = await loadReviews(loaded.pairDirectory, state);
      if (reviews.size !== HUMAN_REVIEW_KINDS.length) {
        fail(
          "HUMAN_REVIEWS_INCOMPLETE",
          "The complete review set is no longer present.",
          "Preserve the pair for incident review.",
        );
      }
      for (const review of reviews.values()) validateReview(review, state, authorities, clock());
      const authorization = await readNoFollowJson(
        path.join(loaded.pairDirectory, "authorization.json"),
        "signed release authorization",
      );
      if (
        recordDigest(authorization) !== state.authorization.recordDigest ||
        authorization.nonce !== state.authorization.nonce
      ) {
        fail(
          "AUTHORIZATION_DRIFT",
          "Final authorization changed after admission.",
          "Preserve the pair for incident review.",
        );
      }
      const certificateSetDigest = validateAuthorization(
        authorization,
        state,
        reviews,
        authorities,
        clock(),
      );
      if (certificateSetDigest !== state.authorization.certificateSetDigest) {
        fail(
          "CERTIFICATE_SET_DRIFT",
          "Release certificate set changed after authorization.",
          "Preserve the pair for incident review.",
        );
      }
      const successorPath = path.join(loaded.pairDirectory, "paired-provider-successor.zip");
      let successorHandle;
      let zipBytes;
      try {
        successorHandle = await open(successorPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const before = await successorHandle.stat();
        if (!before.isFile() || (before.mode & 0o077) !== 0) throw new Error("unsafe ZIP");
        zipBytes = await successorHandle.readFile();
        const after = await successorHandle.stat();
        if (
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs
        ) {
          throw new Error("ZIP drift");
        }
      } catch {
        fail(
          "SUCCESSOR_ZIP_UNSAFE",
          "Paired successor ZIP is absent or unsafe.",
          "Preserve the pair and create a fresh pair.",
        );
      } finally {
        await successorHandle?.close();
      }
      const validation = validateProviderSuccessorZip(zipBytes, {
        runId: state.successorRunId,
        snapshotId: state.successorSnapshotId,
      });
      if (
        validation.zipSha256 !== state.successorZipDigest ||
        sha256(canonicalJson(state.inputBinding)) !== state.inputBindingDigest ||
        state.cleanup.status !== "verified" ||
        state.cleanup.residue.length !== 0 ||
        state.blockers.some(
          (code) =>
            !["CUSTOMER_RELEASE_REVALIDATION_REQUIRED"].includes(code) &&
            state.state !== "CUSTOMER_RELEASE_PREPARED",
        )
      ) {
        fail(
          "CUSTOMER_RELEASE_GATE_FAILED",
          "Fresh successor, input, cleanup, or blocker validation failed.",
          "Preserve the pair for incident review and create a new pair.",
        );
      }
      const issuedAt = state.pendingRelease?.issuedAt ?? new Date(clock()).toISOString();
      const certificate = {
        schemaVersion: RELEASE_SCHEMA,
        certificateId: stableReleaseId(
          "release",
          state.equivalencePairId,
          state.successorZipDigest,
          state.authorization.recordDigest,
        ),
        equivalencePairId: state.equivalencePairId,
        successorZipDigest: state.successorZipDigest,
        reconciliationDigest: state.reconciliationDigest,
        inputBindingDigest: state.inputBindingDigest,
        reviewDigests: Object.fromEntries(
          HUMAN_REVIEW_KINDS.map((kind) => [kind, recordDigest(reviews.get(kind))]),
        ),
        authorizationDigest: state.authorization.recordDigest,
        certificateSetDigest,
        issuedAt,
        customerReleaseAuthorized: true,
      };
      certificate.certificateDigest = sha256(
        canonicalJson({ domain: RELEASE_DOMAIN, certificate }),
      );
      if (state.state !== "CUSTOMER_RELEASE_PREPARED") {
        state.state = "CUSTOMER_RELEASE_PREPARED";
        state.pendingRelease = {
          certificateId: certificate.certificateId,
          certificateDigest: certificate.certificateDigest,
          issuedAt,
        };
        state.blockers = [];
        await atomicPairWrite(loaded.pairDirectory, state);
      } else if (state.pendingRelease?.certificateDigest !== certificate.certificateDigest) {
        fail(
          "CUSTOMER_RELEASE_PREPARED_DRIFT",
          "Prepared customer release certificate no longer matches fresh validation.",
          "Preserve the pair for incident review.",
        );
      }
      const releasePath = path.join(loaded.pairDirectory, CUSTOMER_RELEASE_FILE);
      const existingRelease = await lstat(releasePath).catch(() => undefined);
      if (existingRelease === undefined) {
        await exclusiveFsyncWrite(releasePath, `${JSON.stringify(certificate, null, 2)}\n`, 0o600);
      } else {
        const existingCertificate = await readNoFollowJson(
          releasePath,
          "customer release certificate",
        );
        if (canonicalJson(existingCertificate) !== canonicalJson(certificate)) {
          fail(
            "CUSTOMER_RELEASE_SIDECAR_CONFLICT",
            "Existing customer release sidecar conflicts with the prepared digest.",
            "Preserve the pair for incident review.",
          );
        }
      }
      state.state = "CUSTOMER_RELEASE_AUTHORIZED";
      state.pendingRelease = null;
      state.blockers = [];
      await atomicPairWrite(loaded.pairDirectory, state);
      return { state: structuredClone(state), certificate };
    },
  });
  return Object.freeze({
    pair: operations.pair,
    async review(input) {
      const loaded = await loadPair(input.pairDirectory, kitRoot);
      return withPairLock(loaded.pairDirectory, () => operations.review(input));
    },
    async authorize(input) {
      const loaded = await loadPair(input.pairDirectory, kitRoot);
      return withPairLock(loaded.pairDirectory, () => operations.authorize(input));
    },
    async release(input) {
      const loaded = await loadPair(input.pairDirectory, kitRoot);
      return withPairLock(loaded.pairDirectory, () => operations.release(input));
    },
  });
}

function parseCli(argv) {
  const usage =
    "Usage: public-release-transition.mjs pair --codex-run-dir <generated run> --claude-run-dir <generated run>\n" +
    "   or: public-release-transition.mjs review --pair-dir <generated pair> --record <signed review JSON>\n" +
    "   or: public-release-transition.mjs authorize --pair-dir <generated pair> --record <signed authorization JSON>\n" +
    "   or: public-release-transition.mjs release --pair-dir <generated pair>";
  const [verb, ...rest] = argv;
  if (
    verb === "pair" &&
    rest.length === 4 &&
    rest[0] === "--codex-run-dir" &&
    rest[2] === "--claude-run-dir" &&
    !rest[1].startsWith("-") &&
    !rest[3].startsWith("-")
  ) {
    return { verb, codexRunDirectory: rest[1], claudeRunDirectory: rest[3] };
  }
  if (
    ["review", "authorize"].includes(verb) &&
    rest.length === 4 &&
    rest[0] === "--pair-dir" &&
    rest[2] === "--record" &&
    !rest[1].startsWith("-") &&
    !rest[3].startsWith("-")
  ) {
    return { verb, pairDirectory: rest[1], recordPath: rest[3] };
  }
  if (
    verb === "release" &&
    rest.length === 2 &&
    rest[0] === "--pair-dir" &&
    !rest[1].startsWith("-")
  ) {
    return { verb, pairDirectory: rest[1] };
  }
  fail("CLI_ARGUMENT_INVALID", usage, "Use exactly one frozen public release command.");
}

async function main() {
  const command = parseCli(process.argv.slice(2));
  const dependencies = await loadProductionReleaseDependencies();
  const transition = createPublicReleaseTransition({
    ...dependencies,
    productionDependencyToken: PRODUCTION_DEPENDENCY_TOKEN,
  });
  const result =
    command.verb === "pair"
      ? await transition.pair(command)
      : command.verb === "review"
        ? await transition.review(command)
        : command.verb === "authorize"
          ? await transition.authorize(command)
          : await transition.release(command);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    const code =
      error instanceof PublicReleaseTransitionError
        ? error.code
        : "PUBLIC_RELEASE_TRANSITION_FAILED";
    const remediation =
      error instanceof PublicReleaseTransitionError
        ? error.remediation
        : "Inspect the owner-private release journal.";
    process.stderr.write(`${JSON.stringify({ status: "blocked", code, remediation })}\n`);
    process.exitCode = 78;
  });
}

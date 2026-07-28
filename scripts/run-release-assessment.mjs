#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createBrokeredAgentAdapter } from "../packages/agent-adapters/dist/index.js";
import { reopenZip } from "../packages/packaging/dist/index.js";
import {
  captureImmutableLocalIdentity,
  createImmutableLocalSnapshot,
  verifyImmutableLocalSnapshot,
} from "./immutable-local-snapshot.mjs";
import {
  computeProviderAdmissionDigest,
  sha256Canonical as brokerDocumentDigest,
  validateProviderBrokerResultDocument,
} from "./provider-broker.mjs";
import {
  ProviderSuccessorPackageError,
  createProviderSuccessorPackage,
} from "./provider-successor-package.mjs";
import {
  ReleaseRunError,
  assertResumable,
  atomicFsyncWrite,
  canonicalJson,
  captureLocalGitBinding,
  createUniqueRunDirectory,
  exclusiveFsyncWrite,
  isWithin,
  loadJournal,
  loadReleaseConfig,
  parseStrictJson,
  resolveGeneratedRoot,
  sha256,
  stableReleaseId,
  writeJournal,
} from "./release-run-state.mjs";
import { verifyDraftZip, verifyReleaseRun } from "./verify-release-run.mjs";
import { createProductionHostHelperClient } from "./host-helper-client.mjs";
import { createProductionIsolatedRuntimeFlow } from "./production-runtime-flow.mjs";
import { createProductionSshSourceFlow } from "./production-ssh-source.mjs";
import { loadProductionInstallationConfig } from "./production-installation-config.mjs";

const execFileAsync = promisify(execFile);
const PROVIDERS = new Set(["codex", "claude-code"]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TASKS = Object.freeze([
  ["architecture-analysis", "author"],
  ["product-code-trace", "author"],
  ["security-analysis", "author"],
  ["finding-review", "independent-reviewer"],
  ["decision-synthesis", "author"],
  ["decision-review", "independent-reviewer"],
  ["plain-language-review", "independent-reviewer"],
]);
const REVIEW_AUTHOR_TASK = Object.freeze({
  "finding-review": "security-analysis",
  "decision-review": "decision-synthesis",
  "plain-language-review": "decision-synthesis",
});
const AUTHORITY_ORDER = Object.freeze([
  "release-safety-policy",
  "typed-task-context",
  "release-task-instructions",
  "untrusted-evidence",
  "provider-proposal",
]);
const ALLOWED_COMMANDS = Object.freeze([
  "get-run-context",
  "get-evidence-metadata",
  "get-safe-evidence-text",
  "submit-proposal",
  "report-limitation",
]);
const AUTHOR_PROPOSAL_PROFILE = "rak-author-claims-proposal/1.0.0";
const REVIEW_PROPOSAL_PROFILE = "rak-review-proposal/1.0.0";
const AUTHOR_PROPOSAL_INSTRUCTIONS =
  "Return content with exactly claims and limitations. Every claim has exactly claimId, controlId, result, evidenceOccurrenceIds, and summary; every cited evidence ID must be admitted. Every limitation has exactly limitationId, code, and evidenceOccurrenceIds. Provider output is a proposal only and grants no review, human, release, compliance, or cross-provider authority.";
const REVIEW_PROPOSAL_INSTRUCTIONS =
  "Return content with exactly authorProposalDigest, verdict, objectionCodes, and evidenceOccurrenceIds. authorProposalDigest must equal the capsule expected author digest and every evidence ID must be admitted. This is a fresh-session proposal review only and grants no organizational independence, human, release, compliance, or cross-provider authority.";
const RELEASE_INPUT_PROFILES = Object.freeze({
  workflowProfile: "rak-workflow/1.0.0",
  exportProfile: "rak-export-profile/1.0.0",
  contractProfile: "rak-contract/1.0.0",
});
export const REQUIRED_RELEASE_AUTHORITIES = Object.freeze([
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
const TRUSTED_RELEASE_FAILURE_CODES = new Set([
  "CLI_ARGUMENT_INVALID",
  "DISCOVERY_PATH_UNSAFE",
  "OFFLINE_CERTIFICATE_INVALID",
  "OFFLINE_DRAFT_INVALID",
  "OFFLINE_DRAFT_PATH_ESCAPE",
  "OFFLINE_RESUME_REQUIRES_SUCCESSOR",
  "PROVIDER_HOME_AUTHORITY_DRIFT",
  "PROVIDER_HOME_AUTHORITY_UNAVAILABLE",
  "PROVIDER_TASKS_INCOMPLETE",
  "RESUME_CONFIG_DRIFT",
  "RESUME_PACKAGE_DRIFT",
  "RESUME_SNAPSHOT_MANIFEST_DRIFT",
  "RESUME_SOURCE_DRIFT",
  "SNAPSHOT_INTEGRITY_CHANGED",
  "SOURCE_INTEGRITY_CHANGED",
  "SOURCE_OUTPUT_OVERLAP",
  "SSH_TRUSTED_HELPER_UNAVAILABLE",
]);

function typedLimitation(code, message, remediation, stage, taskId = undefined) {
  const limitation = { code, message, remediation, stage };
  if (taskId !== undefined) limitation.taskId = taskId;
  return limitation;
}

function exactObjectKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

async function createReleaseInputBinding({ state, config, kitRoot }) {
  const [toolchainLock, standardsLock] = await Promise.all([
    readNoFollowFile(path.join(kitRoot, "release/toolchain.lock.json"), "toolchain lock"),
    readNoFollowFile(
      path.join(kitRoot, "packages/analyzers/assets/schema-registry.json"),
      "standards lock",
    ),
  ]);
  return {
    snapshotId: state.offlineDraft.snapshotId,
    snapshotManifestDigest: state.snapshot.manifestDigest,
    discoveryRevisionDigest: state.discoveryDigest,
    ...RELEASE_INPUT_PROFILES,
    assessmentPlanDigest: sha256(
      canonicalJson({
        profile: "rak-release-assessment-plan/1.0.0",
        tasks: TASKS,
        requiredReleaseAuthorities: REQUIRED_RELEASE_AUTHORITIES,
      }),
    ),
    policyDigest: sha256(
      canonicalJson({
        profile: "rak-release-provider-policy/1.0.0",
        authorityOrder: AUTHORITY_ORDER,
        allowedCommands: ALLOWED_COMMANDS,
      }),
    ),
    toolchainLockDigest: sha256(toolchainLock),
    standardsLockDigest: sha256(standardsLock),
    instructionBundleDigest: sha256(
      canonicalJson({
        profile: "rak-release-provider-instructions/1.0.0",
        author: {
          profile: AUTHOR_PROPOSAL_PROFILE,
          instructions: AUTHOR_PROPOSAL_INSTRUCTIONS,
        },
        reviewer: {
          profile: REVIEW_PROPOSAL_PROFILE,
          instructions: REVIEW_PROPOSAL_INSTRUCTIONS,
        },
      }),
    ),
    capabilityRequirementsDigest: sha256(
      canonicalJson({
        profile: "rak-release-capability-requirements/1.0.0",
        runtime: config.runtime,
        optionalServices: config.optionalServices,
        sandboxCredentialMetadata: config.sandboxCredentials.map(
          ({ purpose, recipient, production }) => ({ purpose, recipient, production }),
        ),
      }),
    ),
  };
}

export async function evaluateReleaseReadiness({
  runId,
  packageDigest,
  records,
  authority,
  now = Date.now(),
}) {
  const accepted = new Map();
  const rejected = [];
  for (const record of records) {
    const expectedKeys = [
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
    const binding =
      record !== null && typeof record === "object"
        ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== "receiptDigest"))
        : undefined;
    const valid =
      exactObjectKeys(record, expectedKeys) &&
      record.schemaVersion === "rak-external-release-record/1.0.0" &&
      record.runId === runId &&
      record.packageDigest === packageDigest &&
      REQUIRED_RELEASE_AUTHORITIES.includes(record.kind) &&
      record.verdict === "passed" &&
      record.signatureAlgorithm === "Ed25519" &&
      Number.isFinite(Date.parse(record.issuedAt)) &&
      Number.isFinite(Date.parse(record.expiresAt)) &&
      Date.parse(record.issuedAt) <= now &&
      Date.parse(record.expiresAt) > now &&
      record.receiptDigest ===
        sha256(canonicalJson({ domain: "rak-external-release-record/v1", binding })) &&
      (await authority.verify(structuredClone(record))) === true &&
      !accepted.has(record.kind);
    if (valid) accepted.set(record.kind, structuredClone(record));
    else rejected.push(record?.recordId ?? "malformed");
  }
  const blockers = REQUIRED_RELEASE_AUTHORITIES.filter((kind) => !accepted.has(kind));
  return {
    schemaVersion: "1.0.0",
    profile: "rak-release-readiness/1.0.0",
    runId,
    packageDigest,
    acceptedRecordIds: [...accepted.values()].map(({ recordId }) => recordId),
    rejectedRecordIds: rejected,
    blockers,
    customerReleaseAuthorized: blockers.length === 0 && rejected.length === 0,
  };
}

function timestampForOffline(value) {
  return value.replace(/\.\d{3}Z$/u, ".000Z");
}

function parseCliArguments(argv) {
  const usage =
    "Usage: node scripts/run-release-assessment.mjs run --provider <codex|claude-code> --config <path>\n" +
    "   or: node scripts/run-release-assessment.mjs resume --provider <codex|claude-code> --run-dir <path>";
  if (argv.length !== 5 || !["run", "resume"].includes(argv[0]) || argv[1] !== "--provider") {
    throw new ReleaseRunError("CLI_ARGUMENT_INVALID", usage, usage);
  }
  const [verb, , provider, pathFlag, suppliedPath] = argv;
  if (
    !PROVIDERS.has(provider) ||
    suppliedPath.length === 0 ||
    suppliedPath.startsWith("-") ||
    (verb === "run" && pathFlag !== "--config") ||
    (verb === "resume" && pathFlag !== "--run-dir")
  ) {
    throw new ReleaseRunError("CLI_ARGUMENT_INVALID", usage, usage);
  }
  return { verb, provider, suppliedPath };
}

export async function runOfflineDraft({
  kitRoot,
  sourcePath,
  projectSlug,
  discoveryPath,
  runDirectory,
  generatedAt,
  analysisGitDir,
  snapshotRoot,
  signal,
}) {
  const outputRoot = path.join(runDirectory, "offline");
  await mkdir(outputRoot, { mode: 0o700 });
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.join(kitRoot, "scripts/run-offline-assessment.mjs"),
      "--source",
      sourcePath,
      "--project",
      projectSlug,
      "--discovery",
      discoveryPath,
      "--output-root",
      outputRoot,
      "--generated-at",
      timestampForOffline(generatedAt),
    ],
    {
      cwd: kitRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      signal,
      env: {
        PATH: process.env.PATH,
        LANG: "C",
        LC_ALL: "C",
        NO_PROXY: "*",
        no_proxy: "*",
        RAK_TRUSTED_ANALYSIS_GIT_DIR: analysisGitDir,
        RAK_TRUSTED_ANALYSIS_WORK_TREE: snapshotRoot,
      },
    },
  );
  const result = parseStrictJson(stdout, "offline assessment result");
  if (
    result.status !== "DRAFT_VALIDATED_RELEASE_BLOCKED" ||
    result.customerReleaseAuthorized === true
  ) {
    throw new ReleaseRunError(
      "OFFLINE_DRAFT_INVALID",
      "Offline assessment did not return the frozen draft-only status.",
      "Inspect the retained offline diagnostics and do not continue provider execution.",
    );
  }
  const nestedRunDirectory = await realpath(result.runDirectory);
  const zipPath = await realpath(result.zipPath);
  if (!isWithin(outputRoot, nestedRunDirectory) || !isWithin(nestedRunDirectory, zipPath)) {
    throw new ReleaseRunError(
      "OFFLINE_DRAFT_PATH_ESCAPE",
      "Offline assessment returned an artifact outside its release run directory.",
      "Preserve the run for incident review and start a successor run.",
    );
  }
  const validation = await verifyDraftZip(zipPath);
  const certificate = parseStrictJson(
    await readFile(result.validationCertificatePath, "utf8"),
    "offline validation certificate",
  );
  if (
    certificate.verdict !== "DRAFT_VALIDATED_RELEASE_BLOCKED" ||
    certificate.customerReleaseAuthorized !== false ||
    certificate.zipSha256 !== validation.zipSha256
  ) {
    throw new ReleaseRunError(
      "OFFLINE_CERTIFICATE_INVALID",
      "Offline validation certificate does not bind the reopened draft ZIP.",
      "Do not use this package; preserve it for incident review.",
    );
  }
  return {
    runDirectory: nestedRunDirectory,
    zipPath,
    validationCertificatePath: await realpath(result.validationCertificatePath),
    commitSha: result.commitSha,
    sourceIntegrityDigest: result.sourceIntegrityDigest,
    runId: validation.runId,
    snapshotId: validation.snapshotId,
    validation,
  };
}

export function safeEvidenceView(zipPath) {
  return readFile(zipPath).then((zipBytes) => {
    const entries = reopenZip(zipBytes);
    const evidence = [];
    for (const entry of entries) {
      if (!entry.path.startsWith("evidence/") || !entry.path.endsWith(".txt")) continue;
      if (evidence.length >= 24) break;
      const payload = entry.content.subarray(0, 16_384).toString("utf8").replaceAll("\0", "\uFFFD");
      const evidenceId = path.posix.basename(entry.path, ".txt");
      evidence.push({
        evidenceId,
        sourceLocator: entry.path,
        mediaType: "text/plain",
        sensitivity: "internal",
        truncated: entry.content.byteLength > 16_384,
        byteLength: Buffer.byteLength(payload),
        escapedPayload: payload,
      });
    }
    if (evidence.length === 0) {
      const coverage = entries.find(({ path: pathName }) => pathName === "data/coverage.json");
      if (coverage === undefined) throw new Error("Draft has no safe provider evidence view");
      const payload = coverage.content.subarray(0, 16_384).toString("utf8");
      evidence.push({
        evidenceId: `evd_${sha256(payload).slice(7, 39)}`,
        sourceLocator: "data/coverage.json",
        mediaType: "application/json",
        sensitivity: "internal",
        truncated: coverage.content.byteLength > 16_384,
        byteLength: Buffer.byteLength(payload),
        escapedPayload: payload,
      });
    }
    return {
      evidence,
      allowedEvidenceIds: evidence.map(({ evidenceId }) => evidenceId),
      digest: sha256(canonicalJson(evidence)),
    };
  });
}

export function createTask({
  state,
  taskKind,
  providerRole,
  evidenceView,
  attemptNumber,
  expectedAuthorProposalDigest,
  clock,
  taskScope = "",
}) {
  const taskId = stableReleaseId("tsk", state.runId, taskKind, providerRole, taskScope);
  const attemptId = stableReleaseId("att", taskId, String(attemptNumber));
  const fenceToken = String(attemptNumber);
  const task = {
    schemaVersion: "1.0.0",
    taskId,
    runId: state.runId,
    attemptId,
    fenceToken,
    taskKind,
    providerRole,
    target: {
      snapshotId: state.offlineDraft.snapshotId,
      commitSha: state.snapshot.analysisMirrorCommitSha,
      manifestDigest: state.snapshot.manifestDigest,
    },
    evidenceView: {
      viewId: stableReleaseId("view", state.runId, evidenceView.digest),
      digest: evidenceView.digest,
      allowedEvidenceIds: evidenceView.allowedEvidenceIds,
    },
    proposalProfileId:
      providerRole === "author" ? AUTHOR_PROPOSAL_PROFILE : REVIEW_PROPOSAL_PROFILE,
    proposalInstructions:
      providerRole === "author" ? AUTHOR_PROPOSAL_INSTRUCTIONS : REVIEW_PROPOSAL_INSTRUCTIONS,
    ...(expectedAuthorProposalDigest === undefined ? {} : { expectedAuthorProposalDigest }),
    requiredOutputSchemaId: "rak-agent-proposal/1.0.0",
    acceptanceChecks: ["material-claims-cited"],
    allowedCommands: [...ALLOWED_COMMANDS],
    budget: { wallSeconds: 900, outputBytes: 1_048_576 },
    deadlineAt: new Date(Date.parse(clock()) + 900_000).toISOString(),
  };
  task.instructionBundleDigest = sha256(
    canonicalJson({
      profile: "rak-release-provider-instructions/1.0.0",
      taskKind,
      providerRole,
      proposalProfileId: task.proposalProfileId,
      proposalInstructions: task.proposalInstructions,
      ...(expectedAuthorProposalDigest === undefined ? {} : { expectedAuthorProposalDigest }),
    }),
  );
  return task;
}

export function createCapsule(state, task, evidenceView, expectedAuthorProposalDigest) {
  return {
    schemaVersion: "1.0.0",
    task,
    runContext: {
      projectSlug: state.projectSlug,
      runtimeMode: state.runtimeMode,
      draftStatus: "DRAFT_VALIDATED_RELEASE_BLOCKED",
      customerReleaseAuthorized: false,
      proposalProfileId: task.proposalProfileId,
      ...(expectedAuthorProposalDigest === undefined
        ? {}
        : {
            reviewAuthorTaskKind: REVIEW_AUTHOR_TASK[task.taskKind],
            reviewAuthorProposalDigest: expectedAuthorProposalDigest,
          }),
    },
    evidence: evidenceView.evidence,
    authorityOrder: [...AUTHORITY_ORDER],
  };
}

const acceptanceChecks = new Map([
  [
    "material-claims-cited",
    (proposal) =>
      Array.isArray(proposal.evidenceOccurrenceIds) && proposal.evidenceOccurrenceIds.length > 0
        ? []
        : ["material claims require cited evidence"],
  ],
]);

async function createJob(state, envelope, task, attemptNumber, attestationAuthority) {
  const jobId = stableReleaseId("job", task.taskId, task.attemptId, task.fenceToken);
  const envelopeDigest = sha256(canonicalJson(envelope));
  const core = {
    schemaVersion: "provider-broker-job/1.0.0",
    jobId,
    provider: state.provider,
    runId: state.runId,
    attemptId: task.attemptId,
    attemptNumber,
    fenceToken: task.fenceToken,
    deadlineAt: task.deadlineAt,
    budget: task.budget,
    oneUseNonce: randomBytes(32).toString("hex"),
    providerHomeId: state.providerHomeId,
    providerHomeAuthority: state.providerHomeAuthority,
    releaseAuthorityDigest: state.releaseAuthorityDigest,
    envelope,
    envelopeDigest,
  };
  const admissionDigest = computeProviderAdmissionDigest(core);
  const attestation = await attestationAuthority(structuredClone({ ...core, admissionDigest }));
  return {
    ...core,
    admissionDigest,
    providerEgressAttestation: attestation,
  };
}

async function persistBrokerJob(runDirectory, job) {
  const jobsDirectory = path.join(runDirectory, "internal/provider-jobs");
  await mkdir(path.join(runDirectory, "internal"), { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  await mkdir(jobsDirectory, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  await mkdir(path.join(runDirectory, "internal/provider-results"), { mode: 0o700 }).catch(
    (error) => {
      if (error?.code !== "EEXIST") throw error;
    },
  );
  await atomicFsyncWrite(
    path.join(jobsDirectory, `${job.jobId}.json`),
    `${JSON.stringify(job, null, 2)}\n`,
  );
}

function createBrokerTransport({ broker, state, runDirectory, task, attemptNumber, journal }) {
  return {
    available: true,
    async execute(input, signal) {
      try {
        const envelope = input.taskEnvelope;
        const provisional = await createJob(
          state,
          envelope,
          task,
          attemptNumber,
          broker.providerEgressAttestation,
        );
        if (provisional.providerEgressAttestation === undefined) {
          throw new Error("PROVIDER_EGRESS_ATTESTATION_UNAVAILABLE");
        }
        await persistBrokerJob(runDirectory, provisional);
        journal.jobId = provisional.jobId;
        journal.oneUseNonceDigest = sha256(provisional.oneUseNonce);
        journal.envelopeDigest = provisional.envelopeDigest;
        journal.admissionDigest = provisional.admissionDigest;
        const authority = {
          jobId: provisional.jobId,
          provider: provisional.provider,
          runId: provisional.runId,
          attemptId: provisional.attemptId,
          attemptNumber: provisional.attemptNumber,
          fenceToken: provisional.fenceToken,
          deadlineAt: provisional.deadlineAt,
          budget: provisional.budget,
          envelopeDigest: provisional.envelopeDigest,
          admissionDigest: provisional.admissionDigest,
          oneUseNonce: provisional.oneUseNonce,
          providerHomeId: provisional.providerHomeId,
          providerHomeAuthorityDigest: provisional.providerHomeAuthority.payloadDigest,
          releaseAuthorityDigest: provisional.releaseAuthorityDigest,
          cancelled: false,
        };
        state.providerJobs = (state.providerJobs ?? []).filter(
          ({ jobId }) => jobId !== authority.jobId,
        );
        state.providerJobs.push(authority);
        await writeJournal(runDirectory, state);
        const result = await broker.execute(provisional, signal);
        if (broker.mode === "production") {
          const cleanup = result?.helperCleanupReceipt;
          if (
            cleanup?.state !== "COMPLETE" ||
            cleanup.jobId !== provisional.jobId ||
            cleanup.attemptId !== provisional.attemptId ||
            cleanup.fenceToken !== provisional.fenceToken ||
            cleanup.residueIds?.length !== 0 ||
            !DIGEST.test(cleanup.receiptDigest)
          ) {
            throw new Error("PROVIDER_HELPER_CLEANUP_INVALID");
          }
          journal.helperCleanupReceipt = structuredClone(cleanup);
          journal.helperCleanupReceiptDigest = cleanup.receiptDigest;
          state.providerCleanupReceiptDigests = [
            ...new Set([...(state.providerCleanupReceiptDigests ?? []), cleanup.receiptDigest]),
          ].sort();
          await writeJournal(runDirectory, state);
        }
        return result;
      } catch (error) {
        state.limitations.push(
          typedLimitation(
            "PROVIDER_BROKER_CALL_FAILED",
            "The trusted broker call failed; untrusted exception detail was not journaled.",
            "Inspect the closed broker authority and correct the typed prerequisite.",
            "PROVIDER_TASKS",
            task.taskId,
          ),
        );
        throw error;
      }
    },
  };
}

export function createProductionBrokerAdapter({
  kitRoot = path.resolve(import.meta.dirname, ".."),
  commandRunner = execFileAsync,
} = {}) {
  const brokerPath = path.join(kitRoot, "scripts/provider-broker.mjs");
  const helper = createProductionHostHelperClient();
  let boundRunDirectory;
  const adapter = {
    mode: "production",
    sshSourceFlow: createProductionSshSourceFlow(),
    isolatedRuntimeFlow: createProductionIsolatedRuntimeFlow(),
    installationConfig: undefined,
    available: false,
    reason: typedLimitation(
      "PROVIDER_HOST_HELPER_PREFLIGHT_REQUIRED",
      "Authenticated production host-helper preflight has not completed.",
      "Install the fixed helper socket/key/config and registered provider authority.",
      "PROVIDER_TASKS",
    ),
    acquireSsh(payload, context) {
      return helper.acquireSsh(payload, context);
    },
    async initialize({ provider, runId, engagementId, runDirectory }) {
      if (!PROVIDERS.has(provider) || !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(engagementId ?? "")) {
        adapter.reason = typedLimitation(
          "PROVIDER_ENGAGEMENT_AUTHORITY_INVALID",
          "Production provider engagement identity is absent or invalid.",
          "Set the nonsecret RAK_ENGAGEMENT_ID selected during provider login.",
          "PROVIDER_TASKS",
        );
        return { available: false, reason: adapter.reason };
      }
      adapter.bindRunDirectory(runDirectory);
      try {
        adapter.installationConfig = (await loadProductionInstallationConfig()).config;
        const context = {
          installationId: "repo-assessment-kit",
          runId,
          attemptId: stableReleaseId("att", runId, "provider-initialize"),
          fenceToken: "1",
          commandId: stableReleaseId("cmd", runId, "provider-reconcile"),
        };
        const reconciled = await helper.reconcile([runId], context);
        const authority = reconciled.result?.providerAuthorities?.[provider];
        if (
          reconciled.state !== "SUCCEEDED" ||
          authority?.engagementId !== engagementId ||
          typeof authority.providerHomeId !== "string" ||
          authority.providerHomeAuthority?.payload?.providerHomeId !== authority.providerHomeId ||
          !DIGEST.test(authority.providerHomeAuthority?.payloadDigest) ||
          !DIGEST.test(authority.providerEgressAttestation?.payloadDigest) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,300}@sha256:[a-f0-9]{64}$/u.test(
            authority.immutableImageReference ?? "",
          ) ||
          !DIGEST.test(authority.outputSchemaDigest)
        ) {
          throw new Error("PROVIDER_AUTHORITY_UNAVAILABLE");
        }
        const preflight = await helper.providerPreflight(
          provider,
          {
            releaseAuthorityDigest: authority.releaseAuthorityDigest,
            immutableImageReference: authority.immutableImageReference,
            providerHomeAuthorityDigest: authority.providerHomeAuthority.payloadDigest,
            networkPolicyDigest: authority.providerEgressAttestation.payloadDigest,
            outputSchemaDigest: authority.outputSchemaDigest,
          },
          { ...context, commandId: stableReleaseId("cmd", runId, "provider-preflight") },
        );
        if (preflight.state !== "SUCCEEDED") throw new Error("PROVIDER_PREFLIGHT_BLOCKED");
        adapter.providerHomeId = authority.providerHomeId;
        adapter.releaseAuthorityDigest = authority.releaseAuthorityDigest;
        adapter.providerHomeAuthority = structuredClone(authority.providerHomeAuthority);
        adapter.providerEgressAttestation = () =>
          structuredClone(authority.providerEgressAttestation);
        adapter.cliVersion = authority.cliVersion ?? "helper-owned";
        adapter.imageDigest = authority.immutableImageReference.slice(
          authority.immutableImageReference.indexOf("@") + 1,
        );
        adapter.verifiedRelease = {
          profile: "rak-verified-release/1.0.0",
          verified: true,
          images: {
            [provider === "codex" ? "codex" : "claude"]: {
              immutableReference: authority.immutableImageReference,
            },
          },
        };
        adapter.available = true;
        adapter.reason = undefined;
        return { available: true };
      } catch (error) {
        adapter.available = false;
        adapter.reason = typedLimitation(
          typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.code)
            ? error.code
            : "PROVIDER_HOST_HELPER_UNAVAILABLE",
          "Authenticated production host-helper/provider authority is unavailable.",
          "Install the helper socket/key/config, signed provider image, login authority, and egress policy.",
          "PROVIDER_TASKS",
        );
        return { available: false, reason: adapter.reason };
      }
    },
    bindRunDirectory(runDirectory) {
      boundRunDirectory = runDirectory;
    },
    async execute(job, signal) {
      if (boundRunDirectory === undefined) {
        throw new Error("PROVIDER_BROKER_RUN_DIRECTORY_UNBOUND");
      }
      await access(brokerPath);
      let stdout;
      try {
        ({ stdout } = await commandRunner(
          process.execPath,
          [brokerPath, "execute", "--run-dir", boundRunDirectory, "--job-id", job.jobId],
          {
            cwd: kitRoot,
            encoding: "utf8",
            maxBuffer: 64 * 1024,
            signal,
            env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
          },
        ));
      } catch (error) {
        stdout = error?.stdout;
        if (typeof stdout !== "string" || stdout.length === 0) throw error;
      }
      const summary = parseStrictJson(stdout, "provider broker summary");
      const resultPath = path.join(
        boundRunDirectory,
        "internal/provider-results",
        `${job.jobId}.json`,
      );
      const resultInfo = await lstat(resultPath);
      if (
        !resultInfo.isFile() ||
        resultInfo.isSymbolicLink() ||
        (resultInfo.mode & 0o777) !== 0o600
      ) {
        throw new Error("PROVIDER_BROKER_RESULT_PATH_UNSAFE");
      }
      const document = parseStrictJson(
        await readFile(resultPath, "utf8"),
        "provider broker result",
      );
      const resultDigest = brokerDocumentDigest({
        schemaVersion: document.schemaVersion,
        jobId: document.jobId,
        status: document.status,
        result: document.result,
      });
      if (
        document.schemaVersion !== "provider-broker-result/1.0.0" ||
        document.jobId !== job.jobId ||
        document.resultDigest !== resultDigest ||
        summary.jobId !== job.jobId ||
        summary.status !== document.status ||
        summary.resultDigest !== resultDigest ||
        document.result?.state !== document.status
      ) {
        throw new Error("PROVIDER_BROKER_RESULT_BINDING_INVALID");
      }
      return validateProviderBrokerResultDocument(document);
    },
  };
  return adapter;
}

async function executeProviderTasks(state, runDirectory, broker, clock, signal) {
  broker?.bindRunDirectory?.(runDirectory);
  if (broker?.available === true) {
    if (
      typeof broker.providerHomeId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(broker.providerHomeId) ||
      broker.providerHomeAuthority?.payload?.providerHomeId !== broker.providerHomeId ||
      broker.providerHomeAuthority?.payloadDigest === undefined ||
      !DIGEST.test(broker.releaseAuthorityDigest ?? "")
    ) {
      throw new ReleaseRunError(
        "PROVIDER_HOME_AUTHORITY_UNAVAILABLE",
        "Trusted launcher did not supply an opaque provider-home authority.",
        "Run provider login/preflight through the trusted launcher and retry.",
      );
    }
    if (state.providerHomeId !== undefined && state.providerHomeId !== broker.providerHomeId) {
      throw new ReleaseRunError(
        "PROVIDER_HOME_AUTHORITY_DRIFT",
        "Provider-home authority changed after journal binding.",
        "Do not resume this run; restore the original provider home or start a successor.",
      );
    }
    state.providerHomeId = broker.providerHomeId;
    state.providerHomeAuthority = structuredClone(broker.providerHomeAuthority);
    if (
      state.releaseAuthorityDigest !== undefined &&
      state.releaseAuthorityDigest !== broker.releaseAuthorityDigest
    ) {
      throw new ReleaseRunError(
        "PROVIDER_RELEASE_AUTHORITY_DRIFT",
        "Provider release authority changed after journal binding.",
        "Restore the original production release authority or start a successor run.",
      );
    }
    state.releaseAuthorityDigest = broker.releaseAuthorityDigest;
    await writeJournal(runDirectory, state);
  }
  const evidenceView = await safeEvidenceView(state.package.zipPath);
  const previousByTask = new Map(state.tasks.map((entry) => [entry.taskKind, entry]));
  state.tasks = [];
  for (const [taskKind, providerRole] of TASKS) {
    const previous = previousByTask.get(taskKind);
    const attemptNumber = (previous?.attemptNumber ?? 0) + 1;
    const authorTaskKind = REVIEW_AUTHOR_TASK[taskKind];
    const expectedAuthorProposalDigest =
      authorTaskKind === undefined
        ? undefined
        : state.tasks.find((candidate) => candidate.taskKind === authorTaskKind)?.admittedProposal
            ?.proposalDigest;
    if (authorTaskKind !== undefined && expectedAuthorProposalDigest === undefined) {
      state.limitations.push(
        typedLimitation(
          "REVIEW_AUTHOR_PROPOSAL_UNAVAILABLE",
          `${taskKind} could not be admitted because its author proposal is unavailable.`,
          "Produce and admit the exact author proposal before retrying the reviewer task.",
          "PROVIDER_TASKS",
        ),
      );
      continue;
    }
    const task = createTask({
      state,
      taskKind,
      providerRole,
      evidenceView,
      attemptNumber,
      expectedAuthorProposalDigest,
      clock,
    });
    const taskJournal = {
      taskId: task.taskId,
      taskKind,
      providerRole,
      attemptId: task.attemptId,
      attemptNumber,
      fenceToken: task.fenceToken,
      state: "ADMITTED",
      outcome: "provider-unavailable",
      limitationIds: [],
      evidenceViewDigest: task.evidenceView.digest,
      allowedEvidenceOccurrenceIds: task.evidenceView.allowedEvidenceIds,
      ...(expectedAuthorProposalDigest === undefined ? {} : { expectedAuthorProposalDigest }),
    };
    state.tasks.push(taskJournal);
    if (broker?.available !== true || broker.providerEgressAttestation === undefined) {
      const limitation =
        broker?.reason ??
        typedLimitation(
          "PROVIDER_EGRESS_ATTESTATION_UNAVAILABLE",
          "No trusted signed provider-egress attestation is available.",
          "Run release preflight with the trusted network authority and pinned provider runtime.",
          "PROVIDER_TASKS",
          task.taskId,
        );
      taskJournal.state = "LIMITED";
      taskJournal.limitationIds = [limitation.code];
      state.limitations.push({ ...limitation, taskId: task.taskId });
      continue;
    }
    let normalizedProposal;
    const adapter = createBrokeredAgentAdapter({
      provider: state.provider,
      transport: createBrokerTransport({
        broker,
        state,
        runDirectory,
        task,
        attemptNumber,
        journal: taskJournal,
      }),
      normalizer: {
        normalize(_provider, bytes) {
          normalizedProposal = parseStrictJson(
            Buffer.from(bytes).toString("utf8"),
            "provider proposal",
          );
          return normalizedProposal;
        },
      },
      acceptanceChecks,
      metadata: {
        adapterVersion: "rak-release-orchestrator/1.0.0",
        cliVersion: broker.cliVersion ?? "broker-owned",
        imageDigest: broker.imageDigest ?? `sha256:${"0".repeat(64)}`,
      },
      clock,
    });
    const outcome = await adapter.run({
      capsule: createCapsule(state, task, evidenceView, expectedAuthorProposalDigest),
      requestedCapabilities: {
        outputAccess: "proposal-outbox",
        providerInference: { attested: true, destination: state.provider },
      },
      signal,
    });
    const currentTaskJournal = state.tasks.find(({ taskId }) => taskId === task.taskId);
    if (currentTaskJournal === undefined) throw new Error("PROVIDER_TASK_JOURNAL_LOST");
    currentTaskJournal.state = "CLOSED";
    currentTaskJournal.outcome = outcome.outcome;
    currentTaskJournal.limitationIds = outcome.limitationIds;
    if (outcome.providerSessionId !== undefined) {
      currentTaskJournal.providerSessionId = outcome.providerSessionId;
    }
    if (outcome.proposalReceipt !== undefined) {
      currentTaskJournal.proposalReceipt = outcome.proposalReceipt;
    }
    currentTaskJournal.operationalLogReceipt = outcome.operationalLogReceipt;
    currentTaskJournal.outcomeDigest = sha256(canonicalJson(outcome));
    const reviewBindingValid =
      expectedAuthorProposalDigest === undefined ||
      normalizedProposal?.content?.authorProposalDigest === expectedAuthorProposalDigest;
    if (outcome.outcome === "succeeded" && !reviewBindingValid) {
      currentTaskJournal.outcome = "contract-invalid";
      currentTaskJournal.limitationIds = ["REVIEW_AUTHOR_BINDING_INVALID"];
      state.limitations.push(
        typedLimitation(
          "REVIEW_AUTHOR_BINDING_INVALID",
          `${taskKind} did not bind the exact admitted author proposal.`,
          "Retry the reviewer task with the journaled author proposal digest.",
          "PROVIDER_TASKS",
          task.taskId,
        ),
      );
    } else if (outcome.outcome === "succeeded" && normalizedProposal !== undefined) {
      const proposalDirectory = path.join(runDirectory, "internal/admitted-proposals");
      await mkdir(proposalDirectory, { recursive: true, mode: 0o700 });
      const proposalPath = path.join(proposalDirectory, `${task.taskId}.json`);
      const proposalBytes = Buffer.from(`${canonicalJson(normalizedProposal)}\n`);
      await atomicFsyncWrite(proposalPath, proposalBytes);
      currentTaskJournal.admittedProposal = {
        path: proposalPath,
        digest: sha256(proposalBytes),
        proposalDigest: sha256(canonicalJson(normalizedProposal)),
        evidenceOccurrenceIds: normalizedProposal.evidenceOccurrenceIds,
      };
    }
    if (outcome.outcome !== "succeeded") {
      state.limitations.push(
        typedLimitation(
          `PROVIDER_TASK_${outcome.outcome.toUpperCase().replaceAll("-", "_")}`,
          `${taskKind} ended with ${outcome.outcome}.`,
          "Review the closed broker receipt, correct the typed prerequisite, and resume.",
          "PROVIDER_TASKS",
          task.taskId,
        ),
      );
    }
    await writeJournal(runDirectory, state);
  }
}

async function createIntegratedProviderSuccessor(state, runDirectory, generatedAt) {
  if (
    !state.tasks.every(
      ({ outcome, admittedProposal }) => outcome === "succeeded" && admittedProposal,
    )
  )
    return undefined;
  const evidenceView = await safeEvidenceView(state.package.zipPath);
  const normalizedProviderOutcomes = [];
  for (const task of state.tasks) {
    const proposal = parseStrictJson(
      await readNoFollowFile(task.admittedProposal.path, `admitted proposal ${task.taskId}`),
      `admitted proposal ${task.taskId}`,
    );
    normalizedProviderOutcomes.push({
      provider: state.provider,
      taskKind: task.taskKind,
      providerRole: task.providerRole,
      taskId: task.taskId,
      runId: state.runId,
      attemptId: task.attemptId,
      fenceToken: task.fenceToken,
      outcome: task.outcome,
      proposalDigest: sha256(canonicalJson(proposal)),
      evidenceViewDigest: task.evidenceViewDigest,
      allowedEvidenceOccurrenceIds: task.allowedEvidenceOccurrenceIds,
      proposal,
    });
  }
  try {
    return await createProviderSuccessorPackage({
      normalizedProviderOutcomes,
      baseDraft: {
        zipPath: state.package.zipPath,
        zipSha256: state.package.zipSha256,
        runId: state.offlineDraft.runId,
        snapshotId: state.offlineDraft.snapshotId,
      },
      run: { runId: state.runId },
      snapshot: { snapshotId: state.offlineDraft.snapshotId },
      evidenceOccurrences: evidenceView.evidence.map(({ evidenceId }) => ({ evidenceId })),
      provenanceActivities: [],
      externalReviewCertificates: [],
      outputDirectory: runDirectory,
      packageBaseName: `${state.projectSlug}-provider-successor-draft`,
      projectSlug: state.projectSlug,
      commitSha: state.snapshot.analysisMirrorCommitSha,
      generatedAt,
    });
  } catch (error) {
    state.limitations.push(
      typedLimitation(
        "PROVIDER_SUCCESSOR_QUARANTINED",
        "Provider outputs remained private because closed successor admission failed.",
        "Produce closed task-schema proposals and independent cross-provider reviews before generating a successor package.",
        "PROVIDER_TASKS",
      ),
    );
    state.providerSuccessor = {
      status: "QUARANTINED",
      reasonCode: error instanceof ProviderSuccessorPackageError ? error.code : "UNEXPECTED_ERROR",
      proposalDigests: normalizedProviderOutcomes.map(({ proposalDigest }) => proposalDigest),
    };
    return undefined;
  }
}

async function readNoFollowFile(filePath, label) {
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} is not a regular file`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(`${label} changed while it was read`);
    }
    return bytes;
  } finally {
    await handle?.close();
  }
}

async function createAnalysisGitMetadata({ analysisGitDir, snapshotRoot, generatedAt }) {
  const baseEnvironment = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
    GIT_DIR: analysisGitDir,
    GIT_WORK_TREE: snapshotRoot,
  };
  await execFileAsync("git", ["init", "-q", analysisGitDir], {
    env: baseEnvironment,
    stdio: ["ignore", "ignore", "pipe"],
  });
  for (const [key, value] of [
    ["user.email", "release-snapshot@example.invalid"],
    ["user.name", "RAK Immutable Snapshot"],
    ["core.hooksPath", "/dev/null"],
    ["core.fsmonitor", "false"],
  ]) {
    await execFileAsync("git", ["config", key, value], { env: baseEnvironment });
  }
  await execFileAsync("git", ["add", "--all", "--", "."], {
    env: baseEnvironment,
    cwd: snapshotRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  await execFileAsync("git", ["commit", "-q", "-m", "immutable assessment snapshot"], {
    env: {
      ...baseEnvironment,
      GIT_AUTHOR_DATE: generatedAt,
      GIT_COMMITTER_DATE: generatedAt,
    },
    cwd: snapshotRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    env: baseEnvironment,
    encoding: "utf8",
  });
  return {
    gitDir: await realpath(analysisGitDir),
    workTree: snapshotRoot,
    commitSha: stdout.trim(),
    identityDigest: sha256(
      canonicalJson({
        profile: "rak-analysis-mirror/1.0.0",
        commitSha: stdout.trim(),
        snapshotRoot,
      }),
    ),
  };
}

async function verifyRegisteredSourceMatchesSnapshot(state, runDirectory, stage) {
  const identity = await captureImmutableLocalIdentity({ sourceRoot: state.source.path });
  if (
    identity.manifest.payloadDigest !== state.snapshot.payloadDigest ||
    canonicalJson(identity.manifest.payload) !== canonicalJson(state.snapshot.manifest.payload)
  ) {
    state.status = "FAILED_INTEGRITY";
    state.currentStage = "FAILED_INTEGRITY";
    state.cleanup = { status: "integrity-stop", residue: [] };
    await writeJournal(runDirectory, state);
    throw new ReleaseRunError(
      "SOURCE_INTEGRITY_CHANGED",
      "Registered source bytes or source-state metadata differ from the admitted snapshot.",
      "Preserve the run for incident review and start a successor run.",
    );
  }
  state.sourceCompletionVerification = {
    stage,
    payloadDigest: identity.manifest.payloadDigest,
    manifestDigest: identity.manifestDigest,
    sourceStateDigest: identity.sourceStateDigest,
  };
}

async function verifyAdmittedSnapshot(state, runDirectory) {
  try {
    return await verifyImmutableLocalSnapshot({
      snapshotRoot: state.snapshot.snapshotRoot,
      manifest: state.snapshot.manifest,
    });
  } catch (error) {
    state.status = "FAILED_INTEGRITY";
    state.currentStage = "FAILED_INTEGRITY";
    state.cleanup = { status: "integrity-stop", residue: [] };
    await writeJournal(runDirectory, state);
    throw new ReleaseRunError(
      "SNAPSHOT_INTEGRITY_CHANGED",
      `The admitted immutable snapshot failed verification: ${error.message ?? String(error)}`,
      "Preserve the run for incident review and start a successor run.",
    );
  }
}

export function compareRequiredProviderOutcomes(left, right) {
  const normalize = (value) => ({
    discoveryTopics: value.discoveryTopics,
    domains: value.domains,
    requiredSchemasValid: value.requiredSchemasValid,
    materialityValid: value.materialityValid,
    sourceIntegrityValid: value.sourceIntegrityValid,
    controlReconciliationValid: value.controlReconciliationValid,
    securityReviewPresent: value.securityReviewPresent,
    decisionReviewPresent: value.decisionReviewPresent,
    requiredArtifactsPresent: value.requiredArtifactsPresent,
    redactionValid: value.redactionValid,
    manifestAndZipValid: value.manifestAndZipValid,
    prohibitedActionsObserved: value.prohibitedActionsObserved,
  });
  const leftBinding = normalize(left);
  const rightBinding = normalize(right);
  return {
    equivalent: canonicalJson(leftBinding) === canonicalJson(rightBinding),
    leftDigest: sha256(canonicalJson(leftBinding)),
    rightDigest: sha256(canonicalJson(rightBinding)),
  };
}

async function prepareNewRun({ provider, configPath, kitRoot, clock, acquisitionClient }) {
  const { path: canonicalConfigPath, config } = await loadReleaseConfig(configPath, kitRoot);
  const outputRoot = await resolveGeneratedRoot(config.outputRoot, kitRoot);
  const suppliedDiscoveryPath = path.resolve(kitRoot, config.discoveryPath);
  const discoveryBytes = await readNoFollowFile(suppliedDiscoveryPath, "discovery input").catch(
    (error) => {
      throw new ReleaseRunError(
        "DISCOVERY_PATH_UNSAFE",
        `Discovery input must be a stable no-follow regular file: ${error.message}`,
        "Supply the exact trusted discovery JSON file.",
      );
    },
  );
  parseStrictJson(discoveryBytes.toString("utf8"), "discovery input");
  let createdAt = clock();
  const configDigest = sha256(canonicalJson(config));
  let source;
  let runDirectory;
  let sourceAcquisition;
  if (config.source.kind === "ssh") {
    const sshSourceFlow = acquisitionClient?.sshSourceFlow;
    if (typeof sshSourceFlow?.execute !== "function") {
      throw new ReleaseRunError(
        "SSH_TRUSTED_HELPER_UNAVAILABLE",
        "SSH source acquisition requires the authenticated production host-helper client.",
        "Install the fixed helper socket/key/config and registered acquisition profile.",
      );
    }
    const acquisitionIndexDirectory = path.join(outputRoot, ".ssh-acquisitions");
    await mkdir(acquisitionIndexDirectory, { mode: 0o700 }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    const acquisitionIndexPath = path.join(
      acquisitionIndexDirectory,
      `${stableReleaseId("ssh", config.projectSlug, provider, configDigest)}.json`,
    );
    const existingIndex = await readNoFollowFile(acquisitionIndexPath, "SSH acquisition index")
      .then((bytes) => parseStrictJson(bytes.toString("utf8"), "SSH acquisition index"))
      .catch((error) => {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      });
    if (
      existingIndex !== undefined &&
      (!exactObjectKeys(existingIndex, ["schemaVersion", "createdAt", "context", "runDirectory"]) ||
        existingIndex.schemaVersion !== "1.0.0" ||
        !isWithin(outputRoot, existingIndex.runDirectory) ||
        existingIndex.context?.installationId !== "repo-assessment-kit" ||
        !ID.test(existingIndex.context?.runId ?? "") ||
        existingIndex.context?.fenceToken !== "1")
    ) {
      throw new ReleaseRunError(
        "SSH_ACQUISITION_INDEX_INVALID",
        "Prepared SSH acquisition index is malformed or escaped its generated root.",
        "Preserve the owner-private acquisition state for incident review.",
      );
    }
    if (existingIndex !== undefined) createdAt = existingIndex.createdAt;
    const provisionalRunId =
      existingIndex?.context?.runId ??
      stableReleaseId(
        "run",
        config.projectSlug,
        provider,
        sha256(canonicalJson(config)),
        createdAt,
      );
    const attemptId = stableReleaseId("att", provisionalRunId, "ssh-acquisition");
    const context = existingIndex?.context ?? {
      installationId: "repo-assessment-kit",
      runId: provisionalRunId,
      attemptId,
      fenceToken: "1",
      commandId: stableReleaseId("cmd", provisionalRunId, "ssh-acquisition"),
    };
    try {
      runDirectory =
        existingIndex?.runDirectory ??
        (await createUniqueRunDirectory(outputRoot, config.projectSlug, "ssh", createdAt));
      if (!isWithin(outputRoot, runDirectory)) throw new Error("SSH_ACQUISITION_INDEX_INVALID");
      if (existingIndex === undefined) {
        await exclusiveFsyncWrite(
          acquisitionIndexPath,
          `${JSON.stringify({ schemaVersion: "1.0.0", createdAt, context, runDirectory }, null, 2)}\n`,
          0o600,
        );
      }
      const acquisitionJournal = [];
      const acquisitionJournalPath = path.join(
        runDirectory,
        "internal",
        "ssh-acquisition-journal.json",
      );
      await mkdir(path.dirname(acquisitionJournalPath), { recursive: true, mode: 0o700 });
      const priorJournal = await readNoFollowFile(acquisitionJournalPath, "SSH acquisition journal")
        .then((bytes) => parseStrictJson(bytes.toString("utf8"), "SSH acquisition journal"))
        .catch((error) => {
          if (error?.code === "ENOENT") return undefined;
          throw error;
        });
      acquisitionJournal.push(...(priorJournal?.entries ?? []));
      const resumeState = acquisitionJournal.at(-1)?.state;
      const completed = await sshSourceFlow.execute({
        source: config.source,
        context,
        snapshotStore: path.join(runDirectory, "internal", "ssh-transfer-store"),
        ...(resumeState === undefined ? {} : { resumeState }),
        async journal(entry) {
          acquisitionJournal.push(structuredClone(entry));
          await atomicFsyncWrite(
            acquisitionJournalPath,
            `${JSON.stringify(
              {
                schemaVersion: "rak-ssh-acquisition-journal/1.0.0",
                sourceBindingDigest: sha256(canonicalJson(config.source)),
                context,
                entries: acquisitionJournal,
              },
              null,
              2,
            )}\n`,
          );
        },
      });
      const commitSha = completed.source.resolvedCommitSha;
      const objectFormat = commitSha.length === 40 ? "sha1" : "sha256";
      source = {
        kind: "ssh",
        path: completed.snapshot.root,
        objectFormat,
        commitSha,
        treeObjectId: commitSha,
        indexDigest: completed.snapshot.manifestDigest,
        statusDigest: completed.snapshot.archiveDigest,
        dirty: false,
      };
      sourceAcquisition = {
        sourceCommandId: completed.source.sourceCommandId,
        snapshotId: completed.snapshot.snapshotId,
        manifestDigest: completed.snapshot.manifestDigest,
        archiveDigest: completed.snapshot.archiveDigest,
        receipts: structuredClone(completed.receipts),
        receiptDigests: Object.values(completed.receipts).sort(),
        cleanup: structuredClone(completed.state.cleanup),
        journalPath: acquisitionJournalPath,
        journalDigest: sha256(
          await readNoFollowFile(acquisitionJournalPath, "SSH acquisition journal"),
        ),
        acquisitionIndexPath,
      };
    } catch (error) {
      if (error?.state?.phase === "RELEASED" && error.state.snapshotRoot === undefined) {
        await unlink(acquisitionIndexPath).catch(() => {});
      }
      throw new ReleaseRunError(
        typeof error?.code === "string" ? error.code : "SSH_TRUSTED_HELPER_UNAVAILABLE",
        "Authenticated trusted SSH acquisition preflight is blocked.",
        "Install the registered repository-scoped SSH profile, signed acquisition image, and exact known-host authority.",
      );
    }
  } else {
    source = await captureLocalGitBinding(path.resolve(kitRoot, config.source.path));
    if (isWithin(source.path, outputRoot) || isWithin(outputRoot, source.path)) {
      throw new ReleaseRunError(
        "SOURCE_OUTPUT_OVERLAP",
        "Source and generated output roots must not contain one another.",
        "Assess a separate immutable worktree or mirror outside this kit's generated directory.",
      );
    }
    runDirectory = await createUniqueRunDirectory(
      outputRoot,
      config.projectSlug,
      source.commitSha,
      createdAt,
    );
  }
  const internalDirectory = path.join(runDirectory, "internal");
  const snapshotStore = path.join(internalDirectory, "snapshot-store");
  await mkdir(snapshotStore, { recursive: true, mode: 0o700 });
  await chmod(snapshotStore, 0o700);
  const snapshotCapture = await createImmutableLocalSnapshot({
    registeredRoot: source.path,
    relativePath: ".",
    outputRoot: snapshotStore,
    snapshotName: "source",
  });
  await verifyImmutableLocalSnapshot({
    snapshotRoot: snapshotCapture.snapshotRoot,
    manifest: snapshotCapture.manifest,
  });
  const analysisGitDir = path.join(internalDirectory, "analysis.git");
  const analysis = await createAnalysisGitMetadata({
    analysisGitDir,
    snapshotRoot: snapshotCapture.snapshotRoot,
    generatedAt: createdAt,
  });
  await verifyImmutableLocalSnapshot({
    snapshotRoot: snapshotCapture.snapshotRoot,
    manifest: snapshotCapture.manifest,
  });
  const discoveryPath = path.join(internalDirectory, "discovery.json");
  await atomicFsyncWrite(discoveryPath, discoveryBytes);
  const snapshot = {
    identityKind: "deterministic-snapshot-mirror",
    snapshotRoot: snapshotCapture.snapshotRoot,
    manifestPath: snapshotCapture.manifestPath,
    manifestDigest: snapshotCapture.manifestDigest,
    payloadDigest: snapshotCapture.manifest.payloadDigest,
    entryCount: snapshotCapture.manifest.payload.entryCount,
    totalFileBytes: snapshotCapture.manifest.payload.totalFileBytes,
    manifest: snapshotCapture.manifest,
    analysisGitDir: analysis.gitDir,
    analysisMirrorCommitSha: analysis.commitSha,
    originalCommitSha: source.commitSha,
    originalObjectFormat: source.objectFormat,
    originalTreeObjectId: source.treeObjectId,
    originalIndexDigest: source.indexDigest,
    originalStatusDigest: source.statusDigest,
    identityDigest: sha256(
      canonicalJson({
        profile: "rak-analysis-mirror/1.0.0",
        analysisCommitSha: analysis.commitSha,
        originalGit: source,
        snapshotManifestDigest: snapshotCapture.manifestDigest,
      }),
    ),
  };
  const state = {
    schemaVersion: "1.0.0",
    revision: 0,
    runId: stableReleaseId(
      "run",
      config.projectSlug,
      provider,
      configDigest,
      source.commitSha,
      snapshotCapture.manifestDigest,
      createdAt,
      path.basename(runDirectory),
    ),
    provider,
    projectSlug: config.projectSlug,
    status: "ACTIVE",
    currentStage: "OFFLINE_DRAFT",
    configDigest,
    configPath: canonicalConfigPath,
    discoveryPath,
    discoveryDigest: sha256(discoveryBytes),
    source,
    ...(sourceAcquisition === undefined ? {} : { sourceAcquisition }),
    snapshot,
    runtimeMode: config.runtime.mode,
    runDirectory,
    createdAt,
    updatedAt: createdAt,
    stages: [{ stage: "CONFIG_AND_SOURCE", status: "PASSED", at: createdAt }],
    offlineDraft: null,
    tasks: [],
    package: null,
    limitations: [],
    cleanup: { status: "not-required", residue: [] },
  };
  await writeJournal(runDirectory, state);
  if (sourceAcquisition?.acquisitionIndexPath !== undefined) {
    await unlink(sourceAcquisition.acquisitionIndexPath);
  }
  return { config, state, runDirectory };
}

async function revalidateResume(state, runDirectory) {
  const config = (
    await loadReleaseConfig(state.configPath, path.resolve(import.meta.dirname, ".."))
  ).config;
  if (sha256(canonicalJson(config)) !== state.configDigest) {
    throw new ReleaseRunError(
      "RESUME_CONFIG_DRIFT",
      "Release configuration changed after the run was created.",
      "Restore the exact file or start a successor run with the new configuration.",
    );
  }
  const localSourceChanged =
    config.source.kind === "local" &&
    (await captureLocalGitBinding(state.source.path).then(
      (current) =>
        current.commitSha !== state.source.commitSha ||
        current.objectFormat !== state.source.objectFormat ||
        current.treeObjectId !== state.source.treeObjectId ||
        current.indexDigest !== state.source.indexDigest ||
        current.statusDigest !== state.source.statusDigest,
    ));
  const sshAuthorityInvalid =
    config.source.kind === "ssh" &&
    (state.source.kind !== "ssh" ||
      state.sourceAcquisition?.cleanup?.state !== "COMPLETE" ||
      state.sourceAcquisition.cleanup.residueIds?.length !== 0 ||
      Object.keys(state.sourceAcquisition.receipts ?? {})
        .sort()
        .join(",") !== "acquisition,cleanup,finalize,import,release" ||
      state.sourceAcquisition.receiptDigests?.length !== 5 ||
      new Set(state.sourceAcquisition.receiptDigests).size !== 5 ||
      canonicalJson(state.sourceAcquisition.receiptDigests) !==
        canonicalJson(Object.values(state.sourceAcquisition.receipts).sort()) ||
      state.sourceAcquisition.receiptDigests.some((digest) => !DIGEST.test(digest)) ||
      sha256(
        await readNoFollowFile(
          state.sourceAcquisition.journalPath,
          "SSH acquisition journal",
        ).catch(() => Buffer.alloc(0)),
      ) !== state.sourceAcquisition.journalDigest);
  if (localSourceChanged || sshAuthorityInvalid) {
    state.status = "DRIFTED";
    state.currentStage = "DRIFTED";
    state.cleanup = { status: "integrity-stop", residue: [] };
    await writeJournal(runDirectory, state);
    throw new ReleaseRunError(
      "RESUME_SOURCE_DRIFT",
      "The admitted source authority or frozen bytes changed after the run was created.",
      "Do not resume; start a successor run for the new source state.",
    );
  }
  if (config.runtime.mode === "isolated" && state.isolatedRuntime !== undefined) {
    const runtimeJournal = await readNoFollowFile(
      state.isolatedRuntime.journalPath,
      "isolated runtime journal",
    ).catch(() => undefined);
    if (
      runtimeJournal === undefined ||
      sha256(runtimeJournal) !== state.isolatedRuntime.journalDigest ||
      state.isolatedRuntime.state !== "SUCCEEDED" ||
      state.isolatedRuntime.cleanup?.state !== "COMPLETE" ||
      state.isolatedRuntime.cleanup?.residueIds?.length !== 0 ||
      !Array.isArray(state.isolatedRuntime.receiptDigests) ||
      state.isolatedRuntime.receiptDigests.length === 0 ||
      state.isolatedRuntime.receiptDigests.some((digest) => !DIGEST.test(digest))
    ) {
      throw new ReleaseRunError(
        "ISOLATED_RUNTIME_RECEIPT_DRIFT",
        "Isolated runtime terminal receipts or durable journal changed after admission.",
        "Preserve the run for incident review and start a successor.",
      );
    }
  }
  const manifestBytes = await readNoFollowFile(state.snapshot.manifestPath, "snapshot manifest");
  if (
    sha256(manifestBytes) !== state.snapshot.manifestDigest ||
    canonicalJson(parseStrictJson(manifestBytes.toString("utf8"), "snapshot manifest")) !==
      canonicalJson(state.snapshot.manifest)
  ) {
    throw new ReleaseRunError(
      "RESUME_SNAPSHOT_MANIFEST_DRIFT",
      "The immutable snapshot manifest changed after journal admission.",
      "Do not resume; preserve the run for incident review.",
    );
  }
  await verifyAdmittedSnapshot(state, runDirectory);
  await verifyRegisteredSourceMatchesSnapshot(state, runDirectory, "resume");
  return config;
}

async function executeIsolatedRuntime({ state, config, broker, runDirectory, signal }) {
  if (config.runtime.mode !== "isolated") return;
  const flow = broker?.isolatedRuntimeFlow;
  const installation = broker?.installationConfig;
  const acquisition = state.sourceAcquisition;
  if (typeof flow?.run !== "function" || installation === undefined || acquisition === undefined) {
    state.limitations.push(
      typedLimitation(
        "ISOLATED_RUNTIME_AUTHORITY_UNAVAILABLE",
        "The isolated run lacks a registered helper runtime or helper-owned snapshot authority.",
        "Use trusted SSH acquisition and install the fixed runtime/control catalog.",
        "ISOLATED_RUNTIME",
      ),
    );
    await writeJournal(runDirectory, state);
    return;
  }
  const sealedSecrets = [];
  for (const credential of config.sandboxCredentials) {
    const sealedValue = process.env[credential.handleEnvironment];
    if (typeof sealedValue !== "string" || sealedValue.length < 16) {
      state.limitations.push(
        typedLimitation(
          "ISOLATED_RUNTIME_SECRET_UNAVAILABLE",
          "A selected disposable probe secret has no sealed environment value.",
          `Set ${credential.handleEnvironment} to ciphertext sealed for the registered recipient.`,
          "ISOLATED_RUNTIME",
        ),
      );
      await writeJournal(runDirectory, state);
      return;
    }
    sealedSecrets.push({
      handleId: credential.handleId,
      purpose: credential.purpose,
      recipient: credential.recipient,
      approvalDigest: credential.approvalDigest,
      expiresAt: credential.expiresAt,
      sealedValue,
      disposable: true,
      environment: "non-production",
      revocable: true,
    });
  }
  const attemptId = stableReleaseId("att", state.runId, "isolated-runtime");
  const runtimeId = stableReleaseId("runtime", state.runId, attemptId);
  const journalPath = path.join(runDirectory, "internal", "isolated-runtime-journal.json");
  const priorJournal = await readNoFollowFile(journalPath, "isolated runtime journal")
    .then((bytes) => parseStrictJson(bytes.toString("utf8"), "isolated runtime journal"))
    .catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
  if (
    priorJournal !== undefined &&
    (!exactObjectKeys(priorJournal, ["schemaVersion", "runId", "attemptId", "entries"]) ||
      priorJournal.schemaVersion !== "rak-isolated-runtime-journal/1.0.0" ||
      priorJournal.runId !== state.runId ||
      priorJournal.attemptId !== attemptId ||
      !Array.isArray(priorJournal.entries))
  ) {
    throw new ReleaseRunError(
      "ISOLATED_RUNTIME_JOURNAL_INVALID",
      "Prepared isolated-runtime effects do not match this run and attempt.",
      "Preserve the run for incident review and start a successor.",
    );
  }
  const entries = structuredClone(priorJournal?.entries ?? []);
  const result = await flow.run(
    {
      installationId: installation.installationId,
      runId: state.runId,
      attemptId,
      fenceToken: "1",
      runtime: {
        runtimeId,
        nativeArchitecture: installation.runtime.lima.nativeArchitecture,
        vmProfileId: installation.operations["vm.preflight"].profileId,
        guestImageDigest: installation.runtime.lima.guestImageDigest,
      },
      snapshot: {
        snapshotId: acquisition.snapshotId,
        archiveDigest: acquisition.archiveDigest,
        manifestDigest: acquisition.manifestDigest,
      },
      compile: {
        candidateRelPaths: config.runtime.candidateRelPaths,
        policyId: installation.operations["vm.compile"].profileId,
        approvalIds: config.runtime.approvalIds,
      },
      build: {
        limitsProfileId: installation.operations["vm.build"].profileId,
        acquisitionApprovalId: config.runtime.buildAcquisitionApprovalId ?? null,
      },
      controlPlanAuthority: {
        selectedProfileIds: config.runtime.selectedProfileIds,
        approvalIds: config.runtime.approvalIds,
        plannedControlIds: config.runtime.plannedControlIds,
        probeProfileId: config.runtime.probeProfileId,
        targetOrigins: config.runtime.targetOrigins.map(
          ({ scheme, host, port }) => `${scheme}://${host}:${port}`,
        ),
        lifetimeSeconds: Math.min(
          config.runtime.controlPlanLifetimeSeconds ?? 1800,
          installation.requestGuardIssuer.maxLifetimeSeconds,
        ),
      },
      secrets: sealedSecrets,
      probe: { secretEnvelopeIds: [] },
      collect: {
        declaredArtifactIds: config.runtime.declaredArtifactIds,
        totalByteLimit: config.runtime.artifactByteLimit,
      },
    },
    {
      signal,
      resumeEntries: entries,
      async journal(entry) {
        entries.push(structuredClone(entry));
        await atomicFsyncWrite(
          journalPath,
          `${JSON.stringify(
            {
              schemaVersion: "rak-isolated-runtime-journal/1.0.0",
              runId: state.runId,
              attemptId,
              entries,
            },
            null,
            2,
          )}\n`,
        );
      },
    },
  );
  state.isolatedRuntime = {
    ...structuredClone(result),
    journalPath,
    journalDigest: sha256(await readNoFollowFile(journalPath, "isolated runtime journal")),
  };
  if (result.state !== "SUCCEEDED" || result.cleanup.state !== "COMPLETE") {
    state.limitations.push(
      typedLimitation(
        result.reasonCode === "NONE" ? "ISOLATED_RUNTIME_BLOCKED" : result.reasonCode,
        "The isolated runtime did not complete with zero-residue helper cleanup.",
        "Correct the registered runtime/control prerequisite and start a successor run.",
        "ISOLATED_RUNTIME",
      ),
    );
  }
  await writeJournal(runDirectory, state);
}

export async function finalizeReleaseFailure({ state, runDirectory, broker, error, signal }) {
  if (["FAILED_INTEGRITY", "DRIFTED", "CANCELLED"].includes(state.status)) return;
  const cancelled = signal?.aborted === true;
  const residue = [];
  let authorityFenced = false;
  for (const task of state.tasks ?? []) {
    if (!["ADMITTED", "RUNNING"].includes(task.state)) continue;
    task.cancelled = true;
    task.state = "CANCELLED";
    task.outcome = "cancelled";
    for (const authority of state.providerJobs ?? []) {
      if (authority.jobId !== task.jobId) continue;
      task.retiredFenceToken = authority.fenceToken;
      task.retiredNonceDigest = sha256(authority.oneUseNonce);
      authority.cancelled = true;
      authority.fenceToken = String(Number.parseInt(authority.fenceToken, 10) + 1);
      authority.oneUseNonce = randomBytes(32).toString("hex");
      authorityFenced = true;
    }
  }
  // Persist the authority fence before invoking fallible external cleanup.
  if (authorityFenced) await writeJournal(runDirectory, state);
  for (const task of state.tasks ?? []) {
    if (task.cancelled !== true) continue;
    if (task.jobId !== undefined && typeof broker?.cancel === "function") {
      try {
        await broker.cancel(task.jobId);
      } catch {
        residue.push(`BROKER_CANCEL_RESIDUE:${task.jobId}`);
      }
    }
  }
  if (typeof broker?.cleanup === "function") {
    try {
      await broker.cleanup(runDirectory);
    } catch {
      residue.push("BROKER_CLEANUP_RESIDUE");
    }
  }
  state.status = cancelled ? "CANCELLED" : "RECOVERABLE_FAILURE";
  state.cleanup = {
    status:
      residue.length > 0 ? "residue" : cancelled ? "cancelled-and-closed" : "failed-and-closed",
    residue,
  };
  const failureCode =
    typeof error?.code === "string" && TRUSTED_RELEASE_FAILURE_CODES.has(error.code)
      ? error.code
      : "UNEXPECTED_ERROR";
  state.limitations.push(
    typedLimitation(
      cancelled ? "RUN_CANCELLED" : "RELEASE_STAGE_FAILED",
      cancelled
        ? "The release run was cancelled by the operator."
        : `The release stage failed (${failureCode}).`,
      cancelled
        ? "Start a successor run; cancelled runs do not resume."
        : "Correct the typed prerequisite and resume only this explicitly resumable stage.",
      state.currentStage,
    ),
  );
  await writeJournal(runDirectory, state);
}

export async function runReleaseAssessment({
  provider,
  configPath,
  kitRoot = path.resolve(import.meta.dirname, ".."),
  broker,
  clock = () => new Date().toISOString(),
  signal,
  offlineRunner = runOfflineDraft,
}) {
  if (!PROVIDERS.has(provider)) throw new Error("unsupported provider");
  const selectedBroker =
    broker ??
    createProductionBrokerAdapter({
      kitRoot,
    });
  const prepared = await prepareNewRun({
    provider,
    configPath,
    kitRoot,
    clock,
    acquisitionClient: selectedBroker,
  });
  const { state, runDirectory } = prepared;
  try {
    if (broker === undefined) {
      await selectedBroker.initialize({
        provider,
        runId: state.runId,
        engagementId: process.env.RAK_ENGAGEMENT_ID,
        runDirectory,
      });
      if (selectedBroker.verifiedRelease !== undefined) {
        state.verifiedRelease = structuredClone(selectedBroker.verifiedRelease);
        state.installationId = "repo-assessment-kit";
        await writeJournal(runDirectory, state);
      }
    }
    if (prepared.config.runtime.mode === "isolated") {
      state.currentStage = "ISOLATED_RUNTIME";
      await writeJournal(runDirectory, state);
      await executeIsolatedRuntime({
        state,
        config: prepared.config,
        broker: selectedBroker,
        runDirectory,
        signal,
      });
      state.currentStage = "OFFLINE_DRAFT";
      await writeJournal(runDirectory, state);
    }
    await verifyAdmittedSnapshot(state, runDirectory);
    const draft = await offlineRunner({
      kitRoot,
      sourcePath: state.snapshot.snapshotRoot,
      projectSlug: state.projectSlug,
      discoveryPath: state.discoveryPath,
      runDirectory,
      generatedAt: state.createdAt,
      analysisGitDir: state.snapshot.analysisGitDir,
      snapshotRoot: state.snapshot.snapshotRoot,
      signal,
    });
    await verifyAdmittedSnapshot(state, runDirectory);
    const sourceChanged =
      state.source.kind === "local" &&
      (await captureLocalGitBinding(state.source.path).then(
        (after) =>
          after.commitSha !== state.source.commitSha ||
          after.objectFormat !== state.source.objectFormat ||
          after.treeObjectId !== state.source.treeObjectId ||
          after.indexDigest !== state.source.indexDigest ||
          after.statusDigest !== state.source.statusDigest,
      ));
    if (sourceChanged) {
      state.status = "FAILED_INTEGRITY";
      state.currentStage = "FAILED_INTEGRITY";
      await writeJournal(runDirectory, state);
      throw new ReleaseRunError(
        "SOURCE_INTEGRITY_CHANGED",
        "Source bytes changed during offline assessment.",
        "Preserve the run for incident review and start a successor run.",
      );
    }
    if (draft.commitSha !== state.snapshot.analysisMirrorCommitSha) {
      throw new Error("offline draft commit binding mismatch");
    }
    state.offlineDraft = {
      runId: draft.runId,
      snapshotId: draft.snapshotId,
      sourceIntegrityDigest: draft.sourceIntegrityDigest,
      validationCertificatePath: draft.validationCertificatePath,
    };
    state.inputBinding = await createReleaseInputBinding({
      state,
      config: prepared.config,
      kitRoot,
    });
    state.inputBindingDigest = sha256(canonicalJson(state.inputBinding));
    state.package = {
      zipPath: draft.zipPath,
      zipSha256: draft.validation.zipSha256,
      zipByteLength: draft.validation.zipByteLength,
      manifestSha256: draft.validation.manifestSha256,
      status: "DRAFT_VALIDATED_RELEASE_BLOCKED",
      customerReleaseAuthorized: false,
    };
    state.stages.push({ stage: "OFFLINE_DRAFT", status: "PASSED", at: clock() });
    state.currentStage = "PROVIDER_TASKS";
    await writeJournal(runDirectory, state);
    await executeProviderTasks(state, runDirectory, selectedBroker, clock, signal);
    await verifyAdmittedSnapshot(state, runDirectory);
    state.stages.push({
      stage: "PROVIDER_TASKS",
      status: state.tasks.every(({ outcome }) => outcome === "succeeded") ? "PASSED" : "LIMITED",
      at: clock(),
    });
    const successor = await createIntegratedProviderSuccessor(state, runDirectory, clock());
    if (successor !== undefined) {
      state.providerSuccessor = successor;
      state.stages.push({ stage: "PROVIDER_SUCCESSOR_DRAFT", status: "PASSED", at: clock() });
    }
    state.currentStage = "PACKAGE_VALIDATION";
    await writeJournal(runDirectory, state);
    const validation = await verifyDraftZip(state.package.zipPath, {
      runId: state.offlineDraft.runId,
      snapshotId: state.offlineDraft.snapshotId,
    });
    await verifyAdmittedSnapshot(state, runDirectory);
    await verifyRegisteredSourceMatchesSnapshot(state, runDirectory, "complete");
    state.package.zipSha256 = validation.zipSha256;
    state.package.zipByteLength = validation.zipByteLength;
    state.package.manifestSha256 = validation.manifestSha256;
    state.stages.push({ stage: "PACKAGE_VALIDATION", status: "PASSED", at: clock() });
    state.status = "DRAFT_VALIDATED_RELEASE_BLOCKED";
    state.currentStage = "DRAFT_VALIDATED_RELEASE_BLOCKED";
    state.completedAt = clock();
    state.cleanup = { status: "verified", residue: [] };
    await writeJournal(runDirectory, state);
    const receipt = await verifyReleaseRun(runDirectory, kitRoot);
    return { state, receipt };
  } catch (error) {
    await finalizeReleaseFailure({
      state,
      runDirectory,
      broker: selectedBroker,
      error,
      signal,
    });
    throw error;
  }
}

async function admitIsolatedRuntimeCrashRecovery(state, runDirectory, requestedProvider) {
  if (
    state.provider !== requestedProvider ||
    state.currentStage !== "ISOLATED_RUNTIME" ||
    !(
      (state.status === "ACTIVE" && state.cleanup?.status === "not-required") ||
      (state.status === "RECOVERABLE_FAILURE" && state.cleanup?.status === "failed-and-closed")
    ) ||
    (state.cleanup?.residue?.length ?? 0) !== 0
  ) {
    return false;
  }
  const attemptId = stableReleaseId("att", state.runId, "isolated-runtime");
  const journalPath = path.join(runDirectory, "internal", "isolated-runtime-journal.json");
  const info = await lstat(journalPath).catch(() => undefined);
  if (
    info === undefined ||
    info.isSymbolicLink() ||
    !info.isFile() ||
    (info.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  ) {
    return false;
  }
  const journal = await readNoFollowFile(journalPath, "isolated runtime journal")
    .then((bytes) => parseStrictJson(bytes.toString("utf8"), "isolated runtime journal"))
    .catch(() => undefined);
  return (
    exactObjectKeys(journal, ["schemaVersion", "runId", "attemptId", "entries"]) &&
    journal.schemaVersion === "rak-isolated-runtime-journal/1.0.0" &&
    journal.runId === state.runId &&
    journal.attemptId === attemptId &&
    Array.isArray(journal.entries) &&
    journal.entries.length > 0 &&
    journal.entries.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        ["PREPARED", "COMPLETED"].includes(entry.phase) &&
        typeof entry.commandId === "string" &&
        entry.commandId.startsWith(`${attemptId}:`),
    )
  );
}

export async function resumeReleaseAssessment({
  provider,
  runDirectory,
  kitRoot = path.resolve(import.meta.dirname, ".."),
  broker,
  clock = () => new Date().toISOString(),
  signal,
}) {
  const loaded = await loadJournal(runDirectory, kitRoot);
  const { state } = loaded;
  const selectedBroker =
    broker ??
    createProductionBrokerAdapter({
      kitRoot,
    });
  const isolatedCrashRecovery = await admitIsolatedRuntimeCrashRecovery(
    state,
    loaded.runDirectory,
    provider,
  );
  if (!isolatedCrashRecovery) assertResumable(state, provider);
  try {
    if (broker === undefined) {
      await selectedBroker.initialize({
        provider,
        runId: state.runId,
        engagementId: process.env.RAK_ENGAGEMENT_ID,
        runDirectory: loaded.runDirectory,
      });
    }
    const config = await revalidateResume(state, loaded.runDirectory);
    if (config.runtime.mode === "isolated" && state.isolatedRuntime === undefined) {
      await executeIsolatedRuntime({
        state,
        config,
        broker: selectedBroker,
        runDirectory: loaded.runDirectory,
        signal,
      });
      state.currentStage = "OFFLINE_DRAFT";
      await writeJournal(loaded.runDirectory, state);
    } else if (
      config.runtime.mode === "isolated" &&
      state.currentStage === "ISOLATED_RUNTIME" &&
      state.isolatedRuntime?.state === "SUCCEEDED" &&
      state.isolatedRuntime?.cleanup?.state === "COMPLETE"
    ) {
      state.currentStage = "OFFLINE_DRAFT";
      await writeJournal(loaded.runDirectory, state);
    }
    if (state.currentStage === "OFFLINE_DRAFT") {
      throw new ReleaseRunError(
        "OFFLINE_RESUME_REQUIRES_SUCCESSOR",
        "An interrupted offline source traversal is not reused.",
        "Start a successor run so source integrity is captured from a fresh boundary.",
      );
    }
    if (state.currentStage === "PROVIDER_TASKS") {
      await executeProviderTasks(state, loaded.runDirectory, selectedBroker, clock, signal);
      const providerTasksPassed = state.tasks.every(({ outcome }) => outcome === "succeeded");
      state.stages.push({
        stage: "PROVIDER_TASKS",
        status: providerTasksPassed ? "PASSED" : "LIMITED",
        at: clock(),
      });
      if (!providerTasksPassed) {
        throw new ReleaseRunError(
          "PROVIDER_TASKS_INCOMPLETE",
          "One or more resumed provider tasks did not produce a validated proposal.",
          "Correct the typed broker prerequisite and resume with a new fenced attempt.",
        );
      }
      state.currentStage = "PACKAGE_VALIDATION";
      await writeJournal(loaded.runDirectory, state);
    }
    const validation = await verifyDraftZip(state.package.zipPath, {
      runId: state.offlineDraft.runId,
      snapshotId: state.offlineDraft.snapshotId,
    });
    if (
      validation.zipSha256 !== state.package.zipSha256 ||
      validation.manifestSha256 !== state.package.manifestSha256
    ) {
      state.status = "FAILED_INTEGRITY";
      state.currentStage = "FAILED_INTEGRITY";
      state.cleanup = { status: "integrity-stop", residue: [] };
      await writeJournal(loaded.runDirectory, state);
      throw new ReleaseRunError(
        "RESUME_PACKAGE_DRIFT",
        "The draft package changed after its journal binding.",
        "Do not resume; preserve the run for incident review.",
      );
    }
    state.status = "DRAFT_VALIDATED_RELEASE_BLOCKED";
    state.currentStage = "DRAFT_VALIDATED_RELEASE_BLOCKED";
    state.completedAt = clock();
    state.cleanup = { status: "verified", residue: [] };
    await writeJournal(loaded.runDirectory, state);
    const receipt = await verifyReleaseRun(loaded.runDirectory, kitRoot);
    return { state, receipt };
  } catch (error) {
    await finalizeReleaseFailure({
      state,
      runDirectory: loaded.runDirectory,
      broker: selectedBroker,
      error,
      signal,
    });
    throw error;
  }
}

async function main() {
  const { verb, provider, suppliedPath } = parseCliArguments(process.argv.slice(2));
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("operator cancellation"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const result =
      verb === "run"
        ? await runReleaseAssessment({
            provider,
            configPath: suppliedPath,
            signal: controller.signal,
          })
        : await resumeReleaseAssessment({
            provider,
            runDirectory: suppliedPath,
            signal: controller.signal,
          });
    process.stdout.write(
      `${JSON.stringify(
        {
          status: result.receipt.status,
          customerReleaseAuthorized: false,
          runDirectory: result.state.runDirectory,
          journalDigest: result.state.journalDigest,
          verificationReceiptDigest: result.receipt.receiptDigest,
          limitations: result.state.limitations,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    const typed =
      error instanceof ReleaseRunError
        ? {
            code: error.code,
            message: error.message,
            remediation: error.remediation,
          }
        : {
            code: "RELEASE_RUN_FAILED",
            message: error instanceof Error ? error.message : String(error),
            remediation: "Inspect the retained owner-private journal and correct the prerequisite.",
          };
    process.stderr.write(`${JSON.stringify(typed)}\n`);
    process.exitCode = 1;
  });
}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error The release broker is intentionally a Node ESM script boundary.
import * as providerBroker from "../scripts/provider-broker.mjs";
// @ts-expect-error The release orchestrator is intentionally a Node ESM script boundary.
import * as releaseRunner from "../scripts/run-release-assessment.mjs";
// @ts-expect-error The release journal is intentionally a Node ESM script boundary.
import * as releaseState from "../scripts/release-run-state.mjs";
// @ts-expect-error The release verifier is intentionally a Node ESM script boundary.
import { verifyReleaseRun } from "../scripts/verify-release-run.mjs";

const {
  computeProviderAdmissionDigest,
  createProviderBroker,
  sha256Canonical,
  validateProviderBrokerAuthority,
} = providerBroker;
const {
  compareRequiredProviderOutcomes,
  evaluateReleaseReadiness,
  finalizeReleaseFailure,
  REQUIRED_RELEASE_AUTHORITIES,
  resumeReleaseAssessment,
  runOfflineDraft,
  runReleaseAssessment,
} = releaseRunner;
const {
  canonicalJson,
  assertResumable,
  normalizeSshSourceUrl,
  parseStrictJson,
  resolveGeneratedRoot,
  sha256,
  validateReleaseConfig,
} = releaseState;

const ROOT = path.resolve(import.meta.dirname, "..");
const TOPICS = [
  "target-customers",
  "buyers",
  "user-roles",
  "customer-pain",
  "valuable-workflows",
  "alternatives-differentiators",
  "revenue-retention-critical-behavior",
  "contractual-obligations",
  "expected-scale",
  "feature-parity-expectations",
];
const NOW = "2026-07-28T18:00:00.000Z";

type FixtureBrokerJob = {
  schemaVersion: "provider-broker-job/1.0.0";
  jobId: string;
  provider: "codex";
  runId: string;
  attemptId: string;
  attemptNumber: number;
  fenceToken: string;
  deadlineAt: string;
  budget: { wallSeconds: number; outputBytes: number };
  envelopeDigest: string;
  admissionDigest: string;
  oneUseNonce: string;
  providerHomeId: string;
  providerHomeAuthority: { payloadDigest: string };
  releaseAuthorityDigest: string;
  envelope: {
    capsule: {
      runContext: Record<string, string | boolean>;
      task: {
        taskId: string;
        runId: string;
        attemptId: string;
        fenceToken: string;
        taskKind: string;
        providerRole: "author" | "independent-reviewer";
        proposalProfileId: "rak-author-claims-proposal/1.0.0" | "rak-review-proposal/1.0.0";
        proposalInstructions: string;
        expectedAuthorProposalDigest?: string;
        requiredOutputSchemaId: string;
        evidenceView: { allowedEvidenceIds: string[] };
      };
    };
  };
};

let temporaryRoot: string;
let sourceRoot: string;
let discoveryPath: string;
let configPath: string;
let outputRelative: string;

function git(arguments_: string[], cwd: string): string {
  return execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
}

function baseConfig() {
  return {
    schemaVersion: "1.0.0",
    projectSlug: "release-fixture",
    source: {
      kind: "local",
      path: sourceRoot,
      workingTreeMode: "frozen-working-tree",
    },
    discoveryPath,
    outputRoot: outputRelative,
    runtime: { mode: "static-only", targetOrigins: [] },
    sandboxCredentials: [],
    optionalServices: [],
  };
}

function receipt(outboxName: string, bytes: Buffer) {
  return {
    receiptId: `receipt-${outboxName}`,
    outboxName,
    mediaType: outboxName === "provider-proposal" ? "application/json" : "text/plain",
    byteLength: String(bytes.byteLength),
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    closed: true,
  };
}

function closedSshFlowResult(snapshotRoot: string) {
  const receipts = {
    acquisition: sha256("ssh-acquisition"),
    finalize: sha256("ssh-finalize"),
    import: sha256("ssh-import"),
    release: sha256("ssh-release"),
    cleanup: sha256("ssh-cleanup"),
  };
  return {
    state: {
      version: "1.0.0",
      phase: "RELEASED",
      snapshotRoot,
      cleanup: {
        state: "COMPLETE",
        removedResourceIds: ["ssh-transfer"],
        residueIds: [],
        checkedAt: NOW,
      },
    },
    source: {
      kind: "ssh",
      state: "CLOSED",
      sourceCommandId: "ssh-command-wrapper",
      sanitizedLocator: "ssh://git@example.invalid/repository.git",
      resolvedCommitSha: "a".repeat(40),
      beforeSourceDigest: sha256("ssh-before"),
      afterSourceDigest: sha256("ssh-after"),
      limitationCodes: [],
    },
    snapshot: {
      state: "IMMUTABLE",
      snapshotId: "ssh-snapshot-wrapper",
      root: snapshotRoot,
      manifestDigest: sha256("ssh-manifest"),
      archiveDigest: sha256("ssh-archive"),
      entryCount: 1,
      totalFileBytes: 18,
      readOnly: true,
    },
    receipts,
  };
}

async function writeSshReleaseConfig(
  name: string,
  runtime:
    | { mode: "static-only"; targetOrigins: [] }
    | {
        mode: "isolated";
        targetOrigins: Array<{ scheme: "https"; host: string; port: number }>;
        selectedProfileIds: string[];
        approvalIds: string[];
        plannedControlIds: string[];
        probeProfileId: string;
        candidateRelPaths: string[];
        declaredArtifactIds: string[];
        artifactByteLimit: string;
      },
) {
  const outputRoot = `generated/${name}-${process.pid}`;
  const candidate = path.join(temporaryRoot, `${name}.json`);
  await writeFile(
    candidate,
    JSON.stringify({
      schemaVersion: "1.0.0",
      projectSlug: name,
      source: {
        kind: "ssh",
        url: "ssh://git@example.invalid/repository.git",
        ref: "refs/heads/main",
        acquisitionProfileId: "repository-readonly",
      },
      discoveryPath,
      outputRoot,
      runtime,
      sandboxCredentials: [],
      optionalServices: [],
    }),
  );
  return { configPath: candidate, outputRoot: path.join(ROOT, outputRoot) };
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "rak-release-run-"));
  sourceRoot = path.join(temporaryRoot, "source");
  await mkdir(sourceRoot);
  await writeFile(
    path.join(sourceRoot, "package.json"),
    JSON.stringify({ name: "release-fixture", version: "1.0.0" }),
  );
  await writeFile(
    path.join(sourceRoot, "server.js"),
    "export function health() { return { ok: true }; }\n",
  );
  git(["init", "-q"], sourceRoot);
  git(["config", "user.email", "fixture@example.invalid"], sourceRoot);
  git(["config", "user.name", "Fixture"], sourceRoot);
  git(["add", "."], sourceRoot);
  git(["commit", "-qm", "fixture"], sourceRoot);
  // Dirty and untracked bytes are part of frozen-working-tree mode and must remain unchanged.
  await writeFile(
    path.join(sourceRoot, "server.js"),
    "export function health() { return { ok: true, dirty: true }; }\n",
  );
  await writeFile(path.join(sourceRoot, "untracked.txt"), "included untracked context\n");
  discoveryPath = path.join(temporaryRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    JSON.stringify({
      topics: Object.fromEntries(
        TOPICS.map((topic) => [
          topic,
          {
            unknown: {
              reason: "No owner interview was supplied for this fixture.",
              confidenceEffect: "Decision confidence remains low.",
              coverageEffect: "Business context remains unverified.",
              followUp: "The engagement owner must answer before release.",
            },
            provenance: "unverified",
            confidence: "low",
          },
        ]),
      ),
    }),
  );
  outputRelative = `generated/release-run-tests-${process.pid}`;
  configPath = path.join(temporaryRoot, "config.json");
  await writeFile(configPath, JSON.stringify(baseConfig()));
});

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
  await rm(path.join(ROOT, outputRelative), { recursive: true, force: true });
});

describe("strict release configuration and trust paths", () => {
  it("rejects duplicate JSON members, unknown fields, and static authority requests", () => {
    expect(() => parseStrictJson('{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}')).toThrow(
      /duplicate JSON member/u,
    );
    expect(() => validateReleaseConfig({ ...baseConfig(), extra: true })).toThrow(
      /missing or unknown/u,
    );
    expect(() =>
      validateReleaseConfig({
        ...baseConfig(),
        runtime: {
          mode: "static-only",
          targetOrigins: [{ scheme: "https", host: "sandbox.invalid", port: 443 }],
        },
      }),
    ).toThrow(/Static-only runs cannot request/u);
    expect(() =>
      validateReleaseConfig({
        ...baseConfig(),
        runtime: {
          mode: "isolated",
          targetOrigins: [{ scheme: "https", host: "sandbox.invalid", port: 443 }],
          selectedProfileIds: ["browser-readonly"],
          approvalIds: ["approval-probe"],
          plannedControlIds: ["health-probe"],
          probeProfileId: "http-probe",
          candidateRelPaths: ["compose.yaml"],
          declaredArtifactIds: ["probe-summary"],
          artifactByteLimit: "1048576",
        },
      }),
    ).toThrow(/trusted SSH snapshot/u);
  });

  it("normalizes closed SSH forms and rejects credentials, ambiguity, options, and local schemes", () => {
    expect(normalizeSshSourceUrl("git@example.invalid:owner/repo.git")).toMatchObject({
      user: "git",
      host: "example.invalid",
      port: 22,
      repositoryPath: "owner/repo.git",
    });
    for (const hostile of [
      "ssh://git:password@example.invalid/owner/repo.git",
      "ssh://git@example.invalid/owner/repo.git?upload-pack=evil",
      "ssh://git@example.invalid/owner/%2e%2e/repo.git",
      "git@example.invalid:-oProxyCommand=evil",
      "file:///tmp/repo",
      "--upload-pack=evil",
      "git@127.0.0.1:repo.git",
    ]) {
      expect(() => normalizeSshSourceUrl(hostile)).toThrow();
    }
  });

  it("does not create through a symlinked output-root component", async () => {
    const generated = await resolveGeneratedRoot("generated", ROOT);
    const outside = path.join(temporaryRoot, "outside");
    await mkdir(outside);
    const link = path.join(generated, `escape-${process.pid}`);
    await symlink(outside, link);
    try {
      await expect(
        resolveGeneratedRoot(`generated/escape-${process.pid}/created-before-reject`, ROOT),
      ).rejects.toThrow(/symlink|unsafe/u);
      expect(await lstat(path.join(outside, "created-before-reject")).catch(() => undefined)).toBe(
        undefined,
      );
    } finally {
      await rm(link);
    }
  });
});

describe("release orchestration", () => {
  it("runs a dirty frozen local tree through the offline draft and injected typed broker", async () => {
    const beforeServer = await readFile(path.join(sourceRoot, "server.js"));
    const beforeUntracked = await readFile(path.join(sourceRoot, "untracked.txt"));
    const jobs: FixtureBrokerJob[] = [];
    const homePayload = {
      schemaVersion: "provider-home-authority/1.0.0",
      providerHomeId: "fixture-provider-home",
      engagementId: "fixture-engagement",
      provider: "codex",
      authStoreId: "fixture-auth-store",
      deploymentId: "fixture-deployment",
      issuedAt: NOW,
      expiresAt: "2026-07-28T18:10:00.000Z",
      nonce: "fixture-home-nonce",
    };
    const homeAuthority = {
      payload: homePayload,
      payloadDigest: sha256Canonical({
        domain: "rak-provider-home-authority/v1",
        payload: homePayload,
      }),
      signatureAlgorithm: "Ed25519",
      signingKeyId: "fixture-key",
      signature: "fixture-signature",
    };
    let currentJob: FixtureBrokerJob | undefined;
    const actualBroker = createProviderBroker({
      clock: () => Date.parse(NOW),
      journal: {
        async currentAuthority() {
          if (currentJob === undefined) throw new Error("missing job");
          return {
            jobId: currentJob.jobId,
            provider: currentJob.provider,
            runId: currentJob.runId,
            attemptId: currentJob.attemptId,
            attemptNumber: currentJob.attemptNumber,
            fenceToken: currentJob.fenceToken,
            deadlineAt: currentJob.deadlineAt,
            budget: currentJob.budget,
            envelopeDigest: currentJob.envelopeDigest,
            admissionDigest: currentJob.admissionDigest,
            oneUseNonce: currentJob.oneUseNonce,
            providerHomeId: currentJob.providerHomeId,
            providerHomeAuthorityDigest: currentJob.providerHomeAuthority.payloadDigest,
            releaseAuthorityDigest: currentJob.releaseAuthorityDigest,
            cancelled: false,
          };
        },
        async admitOnce() {},
        async recordResult() {},
        async recordCleanup() {},
      },
      attestationVerifier: {
        async verify() {
          return true;
        },
        async injectNetwork() {
          return "fixture-network";
        },
      },
      providerHomeAuthorityVerifier: {
        async verify() {
          return true;
        },
      },
      staging: {
        async stage(job: FixtureBrokerJob) {
          return {
            taskHandle: "fixture-task",
            outboxHandle: "fixture-outbox",
            authSession: {
              handle: "fixture-auth",
              provider: job.provider,
              providerHomeId: job.providerHomeId,
              fileName: "auth.json",
              fileType: "regular",
              mode: "0400",
              symlink: false,
              unexpectedEntries: 0,
              sha256: `sha256:${"b".repeat(64)}`,
              authStoreId: homePayload.authStoreId,
              deploymentId: homePayload.deploymentId,
              homeAuthorityDigest: homeAuthority.payloadDigest,
            },
            outputSchema: {
              handle: "fixture-schema",
              schemaId: "rak-agent-proposal/1.0.0",
              fileType: "regular",
              mode: "0444",
              sha256: "sha256:cd2ef0587c89430df6b4592fafbd3f54e4023bfb238a8ed5056a2724476c4e3f",
            },
          };
        },
        async cleanup() {},
      },
      containerExecutor: {
        available: true,
        async execute() {
          if (currentJob === undefined) throw new Error("missing job");
          const task = currentJob.envelope.capsule.task;
          const proposalBytes = Buffer.from(
            JSON.stringify({
              schemaVersion: "1.0.0",
              schemaId: task.requiredOutputSchemaId,
              taskId: task.taskId,
              runId: task.runId,
              attemptId: task.attemptId,
              fenceToken: task.fenceToken,
              evidenceOccurrenceIds: [task.evidenceView.allowedEvidenceIds[0]],
              limitationIds: [],
              content:
                currentJob.envelope.capsule.runContext["reviewAuthorProposalDigest"] === undefined
                  ? {
                      claims: [
                        {
                          claimId: `claim-${task.taskKind}`,
                          controlId: `CONTROL/${task.taskKind.toUpperCase()}`,
                          result: "partial",
                          evidenceOccurrenceIds: [task.evidenceView.allowedEvidenceIds[0]],
                          summary: `Bounded ${task.taskKind} proposal.`,
                        },
                      ],
                      limitations: [],
                    }
                  : {
                      authorProposalDigest:
                        currentJob.envelope.capsule.runContext["reviewAuthorProposalDigest"],
                      verdict: "passed",
                      objectionCodes: [],
                      evidenceOccurrenceIds: [task.evidenceView.allowedEvidenceIds[0]],
                    },
            }),
          );
          const logBytes = Buffer.from(`job=${currentJob.jobId};state=completed`);
          return {
            state: "completed",
            proposalOutbox: {
              bytes: proposalBytes,
              receipt: receipt("provider-proposal", proposalBytes),
            },
            operationalLogReceipt: receipt("provider-operational-log", logBytes),
            operationalLogBytes: logBytes,
            providerSessionId: `session-${task.taskKind}`,
            startedAt: NOW,
            endedAt: NOW,
            limitationIds: [],
          };
        },
        async cancel() {},
      },
      sessionStatus: {
        async read() {
          return {
            schemaVersion: "1.0.0",
            provider: "codex",
            engagementId: homePayload.engagementId,
            homeId: homePayload.providerHomeId,
            state: "authenticated",
            cliVersion: "fixture",
            imageDigest: `sha256:${"d".repeat(64)}`,
            authIsolation: "sterile-read-only",
            authStoreId: homePayload.authStoreId,
            deploymentId: homePayload.deploymentId,
            homeAuthorityDigest: homeAuthority.payloadDigest,
            checkedAt: NOW,
            limitationIds: [],
          };
        },
      },
    });
    const broker = {
      available: true,
      providerHomeId: "fixture-provider-home",
      providerHomeAuthority: homeAuthority,
      releaseAuthorityDigest: `sha256:${"c".repeat(64)}`,
      cliVersion: "fixture",
      imageDigest: `sha256:${"d".repeat(64)}`,
      providerEgressAttestation(job: FixtureBrokerJob) {
        const payload = {
          schemaVersion: "1.0.0",
          jobId: job.jobId,
          provider: job.provider,
          attemptNumber: job.attemptNumber,
          fenceToken: job.fenceToken,
          envelopeDigest: job.envelopeDigest,
          admissionDigest: job.admissionDigest,
          destinations: [{ scheme: "https", host: "api.openai.com", port: 443 }],
          issuedAt: NOW,
          expiresAt: "2026-07-28T18:10:00.000Z",
          nonce: `egress-${job.jobId}`,
        };
        return {
          payload,
          payloadDigest: sha256Canonical({
            domain: "rak-provider-egress-attestation/v1",
            payload,
          }),
          signatureAlgorithm: "Ed25519",
          signingKeyId: "fixture-key",
          signature: "fixture-signature",
        };
      },
      async execute(job: FixtureBrokerJob, signal?: AbortSignal) {
        jobs.push(job);
        currentJob = job;
        return actualBroker.execute(job, signal);
      },
    };
    let offlineSourcePath: string | undefined;
    const result = await runReleaseAssessment({
      provider: "codex",
      configPath,
      kitRoot: ROOT,
      broker,
      clock: () => NOW,
      async offlineRunner(arguments_: Parameters<typeof runOfflineDraft>[0]) {
        offlineSourcePath = arguments_.sourcePath;
        return runOfflineDraft(arguments_);
      },
    });
    expect(result.receipt).toMatchObject({
      status: "DRAFT_VALIDATED_RELEASE_BLOCKED",
      customerReleaseAuthorized: false,
    });
    expect(result.state.tasks).toHaveLength(7);
    expect(result.state.limitations, JSON.stringify(result.state.providerSuccessor)).toEqual([]);
    expect(result.state.providerSuccessor).toMatchObject({
      successor: {
        status: "DRAFT_VALIDATED_RELEASE_BLOCKED",
        customerReleaseAuthorized: false,
      },
      quarantinedProposalDigests: [],
    });
    expect(JSON.stringify(result.state)).not.toMatch(
      /AKIA1234567890ABCDEF|\/workspace\/customer\/secret/u,
    );
    expect(
      result.state.tasks.map(
        ({ outcome, limitationIds }: { outcome: string; limitationIds: string[] }) => ({
          outcome,
          limitationIds,
        }),
      ),
    ).toEqual(
      Array.from({ length: 7 }, () => ({
        outcome: "succeeded",
        limitationIds: [],
      })),
    );
    expect(jobs).toHaveLength(7);
    expect(
      jobs.every(
        (job) =>
          job.schemaVersion === "provider-broker-job/1.0.0" &&
          job.admissionDigest === computeProviderAdmissionDigest(job) &&
          job.providerHomeId === "fixture-provider-home",
      ),
    ).toBe(true);
    expect(await readFile(path.join(sourceRoot, "server.js"))).toEqual(beforeServer);
    expect(await readFile(path.join(sourceRoot, "untracked.txt"))).toEqual(beforeUntracked);
    expect(offlineSourcePath).toBe(result.state.snapshot.snapshotRoot);
    expect(offlineSourcePath).not.toBe(result.state.source.path);
    expect(
      (await readdir(path.join(result.state.runDirectory, "internal/snapshot-store"))).sort(),
    ).toEqual(["source", "source.manifest.json"]);
    const secondReceipt = await verifyReleaseRun(result.state.runDirectory, ROOT);
    expect(secondReceipt.receiptDigest).toBe(result.receipt.receiptDigest);
  }, 30_000);

  it("compares required outcomes rather than provider prose or package bytes", () => {
    const required = {
      discoveryTopics: Object.fromEntries(TOPICS.map((topic) => [topic, "unknown"])),
      domains: { "repository-composition": "pass", "runtime-readiness": "blocked" },
      requiredSchemasValid: true,
      materialityValid: true,
      sourceIntegrityValid: true,
      controlReconciliationValid: true,
      securityReviewPresent: true,
      decisionReviewPresent: true,
      requiredArtifactsPresent: true,
      redactionValid: true,
      manifestAndZipValid: true,
      prohibitedActionsObserved: false,
    };
    expect(
      compareRequiredProviderOutcomes(
        { ...required, prose: "Codex wording", zipDigest: "a" },
        { ...required, prose: "Claude wording", zipDigest: "b" },
      ).equivalent,
    ).toBe(true);
    expect(
      compareRequiredProviderOutcomes(required, {
        ...required,
        domains: { ...required.domains, "runtime-readiness": "pass" },
      }).equivalent,
    ).toBe(false);
  });

  it("detects same-path dirty-byte changes even when Git porcelain status is unchanged", async () => {
    const original = await readFile(path.join(sourceRoot, "server.js"));
    try {
      await expect(
        runReleaseAssessment({
          provider: "codex",
          configPath,
          kitRoot: ROOT,
          clock: () => NOW,
          async offlineRunner(arguments_: Parameters<typeof runOfflineDraft>[0]) {
            const draft = await runOfflineDraft(arguments_);
            await writeFile(
              path.join(sourceRoot, "server.js"),
              "export function health() { return { ok: true, dirty: 'changed' }; }\n",
            );
            return draft;
          },
        }),
      ).rejects.toThrow(/source bytes|source-state metadata/iu);
    } finally {
      await writeFile(path.join(sourceRoot, "server.js"), original);
    }
  }, 30_000);

  it("fences admitted tasks and records cancellation cleanup", async () => {
    const runDirectory = path.join(temporaryRoot, "cancel-finalizer");
    await mkdir(runDirectory);
    const authority = {
      jobId: "job-1",
      provider: "codex",
      runId: "run-fixture",
      attemptId: "attempt-1",
      attemptNumber: 1,
      fenceToken: "1",
      deadlineAt: "2026-07-28T18:15:00.000Z",
      budget: { wallSeconds: 900, outputBytes: 1024 },
      envelopeDigest: `sha256:${"c".repeat(64)}`,
      admissionDigest: `sha256:${"d".repeat(64)}`,
      oneUseNonce: "nonce-1",
      providerHomeId: "home-1",
      providerHomeAuthorityDigest: `sha256:${"e".repeat(64)}`,
      releaseAuthorityDigest: `sha256:${"f".repeat(64)}`,
      cancelled: false,
    };
    const staleJob = {
      ...authority,
      providerHomeAuthority: { payloadDigest: authority.providerHomeAuthorityDigest },
    };
    const state = {
      schemaVersion: "1.0.0",
      revision: 0,
      runId: "run-fixture",
      provider: "codex",
      configDigest: `sha256:${"a".repeat(64)}`,
      source: { commitSha: "a".repeat(40) },
      snapshot: { manifestDigest: `sha256:${"b".repeat(64)}` },
      runDirectory,
      createdAt: NOW,
      status: "ACTIVE",
      currentStage: "PROVIDER_TASKS",
      tasks: [{ taskId: "task-1", jobId: "job-1", state: "ADMITTED", outcome: "pending" }],
      providerJobs: [authority],
      limitations: [],
      cleanup: { status: "not-required", residue: [] as string[] },
    };
    const cancelled: string[] = [];
    const controller = new AbortController();
    controller.abort();
    await finalizeReleaseFailure({
      state,
      runDirectory,
      broker: {
        async cancel(jobId: string) {
          cancelled.push(jobId);
        },
        async cleanup() {},
      },
      error: new Error("operator cancellation"),
      signal: controller.signal,
    });
    expect(cancelled).toEqual(["job-1"]);
    expect(state).toMatchObject({
      status: "CANCELLED",
      cleanup: { status: "cancelled-and-closed", residue: [] },
      tasks: [{ state: "CANCELLED", cancelled: true, outcome: "cancelled" }],
    });
    expect(() => validateProviderBrokerAuthority(staleJob, state.providerJobs[0])).toThrow(
      /current journaled authority/iu,
    );
  });

  it("records cleanup residue and preserves integrity terminal states", async () => {
    const runDirectory = path.join(temporaryRoot, "residue-finalizer");
    await mkdir(runDirectory);
    const state = {
      schemaVersion: "1.0.0",
      revision: 0,
      runId: "run-fixture",
      provider: "codex",
      configDigest: `sha256:${"a".repeat(64)}`,
      source: { commitSha: "a".repeat(40) },
      snapshot: { manifestDigest: `sha256:${"b".repeat(64)}` },
      runDirectory,
      createdAt: NOW,
      status: "ACTIVE",
      currentStage: "PROVIDER_TASKS",
      tasks: [{ taskId: "task-1", jobId: "job-1", state: "RUNNING", outcome: "pending" }],
      limitations: [],
      cleanup: { status: "not-required", residue: [] as string[] },
    };
    await finalizeReleaseFailure({
      state,
      runDirectory,
      broker: {
        async cancel() {
          throw new Error("cancel residue");
        },
        async cleanup() {
          throw new Error("cleanup residue");
        },
      },
      error: new Error("provider crashed"),
    });
    expect(state.status).toBe("RECOVERABLE_FAILURE");
    expect(state.cleanup.status).toBe("residue");
    expect(state.cleanup.residue).toHaveLength(2);
    expect(() =>
      assertResumable(
        {
          ...state,
          status: "RECOVERABLE_FAILURE",
          currentStage: "PROVIDER_TASKS",
          cleanup: { status: "residue", residue: ["BROKER_CLEANUP_RESIDUE"] },
        },
        "codex",
      ),
    ).toThrow(/not attested closed/iu);
    state.status = "FAILED_INTEGRITY";
    const revision = state.revision;
    await finalizeReleaseFailure({
      state,
      runDirectory,
      broker: {},
      error: new Error("must not downgrade"),
    });
    expect(state.status).toBe("FAILED_INTEGRITY");
    expect(state.revision).toBe(revision);
  });

  it("does not persist an untrusted failure code containing secrets or host paths", async () => {
    const runDirectory = path.join(temporaryRoot, "hostile-error-code-finalizer");
    await mkdir(runDirectory);
    const state = {
      schemaVersion: "1.0.0",
      revision: 0,
      runId: "run-hostile-error",
      provider: "codex",
      configDigest: `sha256:${"a".repeat(64)}`,
      source: { commitSha: "a".repeat(40) },
      snapshot: { manifestDigest: `sha256:${"b".repeat(64)}` },
      runDirectory,
      createdAt: NOW,
      status: "ACTIVE",
      currentStage: "PROVIDER_TASKS",
      tasks: [],
      limitations: [],
      cleanup: { status: "not-required", residue: [] as string[] },
    };
    const hostile = new Error("provider failed") as Error & { code: string };
    hostile.code = "AKIA1234567890ABCDEF:/workspace/customer/secret";
    await finalizeReleaseFailure({
      state,
      runDirectory,
      broker: {},
      error: hostile,
    });
    const serialized = JSON.stringify(state);
    expect(serialized).toContain("UNEXPECTED_ERROR");
    expect(serialized).not.toMatch(/AKIA1234567890ABCDEF|\/workspace\/customer\/secret/u);
    expect(await readFile(path.join(runDirectory, "release-run-state.json"), "utf8")).not.toMatch(
      /AKIA1234567890ABCDEF|\/workspace\/customer\/secret/u,
    );
  });

  it("retries the indexed SSH wrapper from its durable PREPARED state without reacquiring", async () => {
    const fixture = await writeSshReleaseConfig("ssh-wrapper-retry", {
      mode: "static-only",
      targetOrigins: [],
    });
    let executions = 0;
    let acquisitions = 0;
    let observedResumeState: unknown;
    const sshSourceFlow = {
      async execute(input: {
        context: { runId: string };
        snapshotStore: string;
        resumeState?: unknown;
        journal(entry: unknown): Promise<void>;
      }) {
        executions += 1;
        observedResumeState = input.resumeState;
        if (input.resumeState === undefined) {
          acquisitions += 1;
          const state = {
            version: "1.0.0",
            phase: "ACQUIRING",
            runId: input.context.runId,
            sourceBindingDigest: sha256("source-binding"),
            sourceCommandId: "ssh-command-wrapper",
          };
          await input.journal({
            schemaVersion: "1.0.0",
            profile: "rak-production-ssh-source-journal/1.0.0",
            status: "PREPARED",
            phase: "ACQUIRING",
            effect: "source.status",
            state,
          });
          throw Object.assign(new Error("simulated SSH wrapper crash"), {
            code: "SSH_WRAPPER_CRASH",
            state,
          });
        }
        const snapshotRoot = path.join(input.snapshotStore, "fixture-import");
        await mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
        await writeFile(path.join(snapshotRoot, "source.js"), "export const recovered = true;\n");
        return closedSshFlowResult(snapshotRoot);
      },
    };
    const broker = {
      available: false,
      sshSourceFlow,
      reason: {
        code: "FIXTURE_PROVIDER_UNUSED",
        message: "provider is not reached",
        remediation: "none",
        stage: "PROVIDER_TASKS",
      },
    };
    try {
      await expect(
        runReleaseAssessment({
          provider: "codex",
          configPath: fixture.configPath,
          kitRoot: ROOT,
          broker,
          clock: () => NOW,
        }),
      ).rejects.toMatchObject({ code: "SSH_WRAPPER_CRASH" });
      await expect(
        runReleaseAssessment({
          provider: "codex",
          configPath: fixture.configPath,
          kitRoot: ROOT,
          broker,
          clock: () => NOW,
          async offlineRunner() {
            throw Object.assign(new Error("stop after recovered source admission"), {
              code: "OFFLINE_WRAPPER_STOP",
            });
          },
        }),
      ).rejects.toMatchObject({ code: "OFFLINE_WRAPPER_STOP" });
      expect(executions).toBe(2);
      expect(acquisitions).toBe(1);
      expect(observedResumeState).toMatchObject({
        phase: "ACQUIRING",
        sourceCommandId: "ssh-command-wrapper",
      });
    } finally {
      await rm(fixture.outputRoot, { recursive: true, force: true });
    }
  });

  it("feeds existing isolated-runtime journal entries into public resume without repeating effects", async () => {
    const fixture = await writeSshReleaseConfig("runtime-wrapper-resume", {
      mode: "isolated",
      targetOrigins: [{ scheme: "https", host: "sandbox.invalid", port: 443 }],
      selectedProfileIds: ["browser-readonly"],
      approvalIds: ["approval-probe"],
      plannedControlIds: ["health-probe"],
      probeProfileId: "http-probe",
      candidateRelPaths: ["compose.yaml"],
      declaredArtifactIds: ["probe-summary"],
      artifactByteLimit: "1048576",
    });
    const sshSourceFlow = {
      async execute(input: {
        context: { runId: string };
        snapshotStore: string;
        journal(entry: unknown): Promise<void>;
      }) {
        const snapshotRoot = path.join(input.snapshotStore, "fixture-import");
        await mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
        await writeFile(path.join(snapshotRoot, "source.js"), "export const isolated = true;\n");
        await input.journal({
          schemaVersion: "1.0.0",
          profile: "rak-production-ssh-source-journal/1.0.0",
          status: "COMPLETED",
          phase: "RELEASED",
          effect: "zero-residue-admitted",
          state: {
            version: "1.0.0",
            phase: "RELEASED",
            runId: input.context.runId,
            sourceBindingDigest: sha256("source-binding"),
            sourceCommandId: "ssh-command-wrapper",
            snapshotRoot,
          },
        });
        return closedSshFlowResult(snapshotRoot);
      },
    };
    let runtimeCalls = 0;
    let runtimeEffects = 0;
    let observedResumeEntries: unknown[] = [];
    const isolatedRuntimeFlow = {
      async run(
        input: { runId: string; attemptId: string; runtime: { runtimeId: string } },
        options: {
          resumeEntries?: unknown[];
          journal(entry: unknown): Promise<void>;
        },
      ) {
        runtimeCalls += 1;
        observedResumeEntries = structuredClone(options.resumeEntries ?? []);
        if (observedResumeEntries.length === 0) {
          runtimeEffects += 1;
          await options.journal({
            schemaVersion: "rak-isolated-runtime-flow-journal/1.0.0",
            phase: "COMPLETED",
            step: "01-preflight",
            operation: "vm.preflight",
            commandId: `${input.attemptId}:01-preflight`,
            payloadDigest: sha256("runtime-payload"),
            responseDigest: sha256("runtime-response"),
            result: { state: "SUCCEEDED" },
          });
          throw Object.assign(new Error("simulated runtime wrapper crash"), {
            code: "RUNTIME_WRAPPER_CRASH",
          });
        }
        return {
          schemaVersion: "rak-isolated-runtime-flow/1.0.0",
          runId: input.runId,
          attemptId: input.attemptId,
          runtimeId: input.runtime.runtimeId,
          state: "SUCCEEDED",
          reasonCode: "NONE",
          completedSteps: ["01-preflight"],
          receiptDigests: [sha256("runtime-response")],
          cleanup: {
            state: "COMPLETE",
            receiptDigests: [{ operation: "vm.destroy", digest: sha256("runtime-cleanup") }],
            residueIds: [],
          },
        };
      },
    };
    const broker = {
      available: false,
      sshSourceFlow,
      isolatedRuntimeFlow,
      installationConfig: {
        installationId: "repo-assessment-kit",
        runtime: {
          lima: {
            nativeArchitecture: "arm64",
            guestImageDigest: sha256("guest-image"),
          },
        },
        operations: {
          "vm.preflight": { profileId: "vm-profile" },
          "vm.compile": { profileId: "compile-policy" },
          "vm.build": { profileId: "build-limits" },
        },
        requestGuardIssuer: { maxLifetimeSeconds: 1800 },
      },
      reason: {
        code: "FIXTURE_PROVIDER_UNUSED",
        message: "provider is not reached",
        remediation: "none",
        stage: "PROVIDER_TASKS",
      },
    };
    try {
      await expect(
        runReleaseAssessment({
          provider: "codex",
          configPath: fixture.configPath,
          kitRoot: ROOT,
          broker,
          clock: () => NOW,
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_WRAPPER_CRASH" });
      const runEntries = (await readdir(fixture.outputRoot)).filter(
        (entry) => !entry.startsWith("."),
      );
      expect(runEntries).toHaveLength(1);
      const recoveredRunDirectory = path.join(fixture.outputRoot, runEntries[0]!);
      const statePath = path.join(recoveredRunDirectory, "release-run-state.json");
      const crashedState = JSON.parse(await readFile(statePath, "utf8"));
      crashedState.status = "ACTIVE";
      crashedState.currentStage = "ISOLATED_RUNTIME";
      crashedState.cleanup = { status: "not-required", residue: [] };
      crashedState.journalDigest = sha256(
        canonicalJson({ ...crashedState, journalDigest: undefined }),
      );
      await writeFile(statePath, `${JSON.stringify(crashedState, null, 2)}\n`, { mode: 0o600 });
      await expect(
        resumeReleaseAssessment({
          provider: "codex",
          runDirectory: recoveredRunDirectory,
          kitRoot: ROOT,
          broker,
          clock: () => NOW,
        }),
      ).rejects.toMatchObject({ code: "OFFLINE_RESUME_REQUIRES_SUCCESSOR" });
      expect(runtimeCalls).toBe(2);
      expect(runtimeEffects).toBe(1);
      expect(observedResumeEntries).toHaveLength(1);
      expect(observedResumeEntries[0]).toMatchObject({
        phase: "COMPLETED",
        operation: "vm.preflight",
      });
      const terminalStatePath = path.join(recoveredRunDirectory, "release-run-state.json");
      const terminalCrashState = JSON.parse(await readFile(terminalStatePath, "utf8"));
      terminalCrashState.status = "ACTIVE";
      terminalCrashState.currentStage = "ISOLATED_RUNTIME";
      terminalCrashState.cleanup = { status: "not-required", residue: [] };
      terminalCrashState.journalDigest = sha256(
        canonicalJson({ ...terminalCrashState, journalDigest: undefined }),
      );
      await writeFile(terminalStatePath, `${JSON.stringify(terminalCrashState, null, 2)}\n`, {
        mode: 0o600,
      });
      await expect(
        resumeReleaseAssessment({
          provider: "codex",
          runDirectory: recoveredRunDirectory,
          kitRoot: ROOT,
          broker,
          clock: () => NOW,
        }),
      ).rejects.toMatchObject({ code: "OFFLINE_RESUME_REQUIRES_SUCCESSOR" });
      expect(runtimeCalls).toBe(2);
      expect(runtimeEffects).toBe(1);
    } finally {
      await rm(fixture.outputRoot, { recursive: true, force: true });
    }
  });
});

describe("external release readiness", () => {
  const runId = "run-readiness";
  const packageDigest = `sha256:${"c".repeat(64)}`;

  function releaseRecord(kind: string) {
    const binding = {
      schemaVersion: "rak-external-release-record/1.0.0",
      recordId: `record-${kind}`,
      runId,
      packageDigest,
      kind,
      verdict: "passed",
      inputDigest: `sha256:${"d".repeat(64)}`,
      issuedAt: NOW,
      expiresAt: "2026-07-28T19:00:00.000Z",
      issuer: `fixture-${kind}`,
      signatureAlgorithm: "Ed25519",
      signingKeyId: "fixture-key",
      signature: "fixture-signature",
    };
    return {
      ...binding,
      receiptDigest: sha256(canonicalJson({ domain: "rak-external-release-record/v1", binding })),
    };
  }

  it("blocks when any required external authority is absent", async () => {
    const result = await evaluateReleaseReadiness({
      runId,
      packageDigest,
      records: REQUIRED_RELEASE_AUTHORITIES.slice(1).map(releaseRecord),
      authority: {
        async verify() {
          return true;
        },
      },
      now: Date.parse(NOW),
    });
    expect(result.customerReleaseAuthorized).toBe(false);
    expect(result.blockers).toEqual(["independent-security"]);
  });

  it("authorizes only a complete current signed authority set", async () => {
    const result = await evaluateReleaseReadiness({
      runId,
      packageDigest,
      records: REQUIRED_RELEASE_AUTHORITIES.map(releaseRecord),
      authority: {
        async verify() {
          return true;
        },
      },
      now: Date.parse(NOW),
    });
    expect(result).toMatchObject({
      blockers: [],
      rejectedRecordIds: [],
      customerReleaseAuthorized: true,
    });
  });
});

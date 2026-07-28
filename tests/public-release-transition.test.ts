import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CUSTOMER_RELEASE_FILE,
  createPublicReleaseTransition,
  HUMAN_REVIEW_KINDS,
  PLATFORM_CERTIFICATE_KINDS,
  // @ts-expect-error Public transition is intentionally a Node ESM script boundary.
} from "../scripts/public-release-transition.mjs";
// @ts-expect-error Release state is intentionally a Node ESM script boundary.
import { canonicalJson, sha256, stableReleaseId } from "../scripts/release-run-state.mjs";
// @ts-expect-error Release runner is intentionally a Node ESM script boundary.
import { runReleaseAssessment } from "../scripts/run-release-assessment.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const NOW = "2026-07-28T18:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}`;
const created: string[] = [];

type FixtureTask = {
  taskId: string;
  runId: string;
  attemptId: string;
  fenceToken: string;
  taskKind: string;
  requiredOutputSchemaId: string;
  expectedAuthorProposalDigest?: string;
  evidenceView: { allowedEvidenceIds: string[] };
};

type FixtureCrossTask = {
  taskId: string;
  jobId: string;
  runId: string;
  attemptId: string;
  fenceToken: string;
  taskKind: string;
  reviewerProvider: string;
  authorProposalDigest: string;
  nonce: string;
  capsule: { task: FixtureTask };
};

function domainBytes(domain: string, payload: unknown) {
  return Buffer.from(`${domain}\0${canonicalJson(payload)}`, "utf8");
}

async function fixturePair() {
  const generated = path.join(ROOT, "generated");
  await mkdir(generated, { recursive: true, mode: 0o700 });
  await chmod(generated, 0o700);
  const pairDirectory = await mkdtemp(path.join(generated, "transition-test-pair-"));
  created.push(pairDirectory);
  await chmod(pairDirectory, 0o700);
  const inputBinding = {
    snapshotId: "snapshot-fixture",
    snapshotManifestDigest: DIGEST,
    discoveryRevisionDigest: DIGEST,
    workflowProfile: "rak-workflow/1.0.0",
    exportProfile: "rak-export-profile/1.0.0",
    contractProfile: "rak-contract/1.0.0",
    assessmentPlanDigest: DIGEST,
    policyDigest: DIGEST,
    toolchainLockDigest: DIGEST,
    standardsLockDigest: DIGEST,
    instructionBundleDigest: DIGEST,
    capabilityRequirementsDigest: DIGEST,
  };
  const state = {
    schemaVersion: "rak-provider-pair-state/1.0.0",
    equivalencePairId: "pair_fixture",
    codexRunId: "run_codex",
    claudeRunId: "run_claude",
    inputBinding,
    inputBindingDigest: sha256(canonicalJson(inputBinding)),
    runReceiptDigests: { codex: DIGEST, "claude-code": DIGEST },
    runDirectories: { codex: "runs/codex", "claude-code": "runs/claude" },
    authorProposalDigests: Array.from({ length: 8 }, (_, index) => sha256(`proposal-${index}`)),
    crossReviewTasks: [],
    providerRunIds: ["run_codex", "run_claude"],
    successorRunId: "run_successor",
    successorSnapshotId: "snapshot-fixture",
    successorZipDigest: sha256("successor"),
    reconciliationDigest: sha256("reconciliation"),
    admittedReviews: [],
    authorization: null,
    pendingAdmission: null,
    pendingRelease: null,
    state: "DRAFT_VALIDATED_RELEASE_BLOCKED",
    blockers: HUMAN_REVIEW_KINDS.map((kind: string) => `REVIEW_REQUIRED:${kind}`),
    cleanup: { status: "verified", receiptDigests: [sha256("c"), sha256("d")], residue: [] },
    sshRequired: false,
    sshReceiptDigests: [],
    createdAt: NOW,
    journalDigest: "",
  };
  state.journalDigest = sha256(canonicalJson({ ...state, journalDigest: undefined }));
  await writeFile(
    path.join(pairDirectory, "provider-pair-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { pairDirectory, state };
}

function keyFixture(kind: string) {
  const pair = generateKeyPairSync("ed25519");
  return {
    kind,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
  };
}

function signedCertificate(
  state: Awaited<ReturnType<typeof fixturePair>>["state"],
  kind: string,
  subjectDigest: string,
  key: ReturnType<typeof keyFixture>,
  index: number,
) {
  const payload = {
    schemaVersion: "rak-signed-release-certificate/1.0.0",
    certificateId: `certificate_${kind}_${index}`,
    kind,
    equivalencePairId: state.equivalencePairId,
    subjectDigest,
    decision: "approved",
    issuedAt: NOW,
    expiresAt: "2026-07-28T19:00:00.000Z",
    nonce: `certificate-nonce-${kind.replaceAll(":", "-")}-${index}`,
    signingKeyId: `certificate-key-${kind}`,
  };
  return {
    ...payload,
    signature: sign(
      null,
      domainBytes("rak-signed-release-certificate/v1", payload),
      key.privateKey,
    ).toString("base64"),
  };
}

function authorizationFixture(
  state: Awaited<ReturnType<typeof fixturePair>>["state"],
  reviews: Record<string, ReturnType<typeof signedReview>>,
  authorizationKey: ReturnType<typeof keyFixture>,
) {
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
  const certificateSubjects = Object.fromEntries(
    scalarKinds.map((kind) => [
      kind,
      kind === "providerEquivalence" ? state.reconciliationDigest : sha256(`subject-${kind}`),
    ]),
  );
  const certificateKinds = [
    ...scalarKinds,
    ...PLATFORM_CERTIFICATE_KINDS,
    "cleanup:codex",
    "cleanup:claude-code",
  ];
  const certificateKeys = Object.fromEntries(
    certificateKinds.map((kind) => {
      const key = keyFixture(kind);
      return [
        `certificate-key-${kind}`,
        { kind, publicKey: key.publicKey, privateKey: key.privateKey },
      ];
    }),
  );
  const createCertificate = (kind: string, subject: string, index: number) =>
    signedCertificate(
      state,
      kind,
      subject,
      {
        kind,
        privateKey: certificateKeys[`certificate-key-${kind}`]!.privateKey,
        publicKey: certificateKeys[`certificate-key-${kind}`]!.publicKey,
      },
      index,
    );
  const certificates = {
    ...Object.fromEntries(
      scalarKinds.map((kind, index) => [
        kind,
        createCertificate(kind, certificateSubjects[kind], index),
      ]),
    ),
    platforms: PLATFORM_CERTIFICATE_KINDS.map((kind: string, index: number) =>
      createCertificate(kind, sha256(`subject-${kind}`), scalarKinds.length + index),
    ),
    cleanupReceipts: [
      createCertificate("cleanup:codex", state.cleanup.receiptDigests[0], 20),
      createCertificate("cleanup:claude-code", state.cleanup.receiptDigests[1], 21),
    ],
    ssh: null,
  };
  const reviewDigests = Object.fromEntries(
    HUMAN_REVIEW_KINDS.map((kind: string) => [kind, sha256(canonicalJson(reviews[kind]))]),
  );
  const payload = {
    schemaVersion: "rak-signed-customer-release-authorization/1.0.0",
    recordId: "authorization_fixture",
    equivalencePairId: state.equivalencePairId,
    successorZipDigest: state.successorZipDigest,
    reconciliationDigest: state.reconciliationDigest,
    inputBindingDigest: state.inputBindingDigest,
    reviewDigests,
    certificates,
    decision: "approved",
    issuedAt: NOW,
    expiresAt: "2026-07-28T19:00:00.000Z",
    nonce: "authorization-nonce-fixture-123456",
    signingKeyId: "authorization-key",
  };
  return {
    record: {
      ...payload,
      signature: sign(
        null,
        domainBytes("rak-signed-customer-release-authorization/v1", payload),
        authorizationKey.privateKey,
      ).toString("base64"),
    },
    certificateKeys: Object.fromEntries(
      Object.entries(certificateKeys).map(([id, value]) => [
        id,
        { kind: value.kind, publicKey: value.publicKey },
      ]),
    ),
    certificateSubjects: {
      ...certificateSubjects,
      ...Object.fromEntries(
        PLATFORM_CERTIFICATE_KINDS.map((kind: string) => [kind, sha256(`subject-${kind}`)]),
      ),
    },
  };
}

function signedReview(
  state: Awaited<ReturnType<typeof fixturePair>>["state"],
  key: ReturnType<typeof keyFixture>,
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    schemaVersion: "rak-signed-human-review/1.0.0",
    recordId: `review_${key.kind}`,
    kind: key.kind,
    reviewerId: `reviewer_${key.kind}`,
    organizationId: `organization_${key.kind}`,
    independenceDeclaration: "I independently reviewed the exact bound release evidence.",
    equivalencePairId: state.equivalencePairId,
    successorZipDigest: state.successorZipDigest,
    reconciliationDigest: state.reconciliationDigest,
    inputBindingDigest: state.inputBindingDigest,
    decision: "approved",
    limitationIds: [],
    issuedAt: NOW,
    expiresAt: "2026-07-28T19:00:00.000Z",
    nonce: `nonce-${key.kind}-1234567890`,
    signingKeyId: `key_${key.kind}`,
    ...overrides,
  };
  return {
    ...payload,
    signature: sign(
      null,
      domainBytes("rak-signed-human-review/v1", payload),
      key.privateKey,
    ).toString("base64"),
  };
}

async function recordFile(record: unknown) {
  const directory = await mkdtemp(path.join(ROOT, "generated", "transition-test-record-"));
  created.push(directory);
  await chmod(directory, 0o700);
  const file = path.join(directory, "record.json");
  await writeFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return file;
}

async function completeReviewFixture(
  defectOverrides: Array<{ defectId: string; severity: string; state: string }> = [],
) {
  const { pairDirectory, state } = await fixturePair();
  const reviewKeys = Object.fromEntries(
    HUMAN_REVIEW_KINDS.map((kind: string) => {
      const key = keyFixture(kind);
      return [`key_${kind}`, { kind, key }];
    }),
  );
  const authorizationKey = keyFixture("authorization");
  const reviews = Object.fromEntries(
    HUMAN_REVIEW_KINDS.map((kind: string) => [
      kind,
      signedReview(state, reviewKeys[`key_${kind}`].key),
    ]),
  );
  const authorization = authorizationFixture(state, reviews, authorizationKey);
  const authorities = {
    mode: "fixture-test-only",
    reviewKeys: Object.fromEntries(
      Object.entries(reviewKeys).map(([id, value]) => [
        id,
        { kind: value.kind, publicKey: value.key.publicKey },
      ]),
    ),
    authorizationKeys: {
      "authorization-key": { publicKey: authorizationKey.publicKey },
    },
    certificateKeys: authorization.certificateKeys,
    certificateSubjects: authorization.certificateSubjects,
    unresolvedBoundaryDefects: defectOverrides,
  };
  const transition = createPublicReleaseTransition({
    mode: "fixture-test-only",
    reviewer: { mode: "fixture-test-only" },
    authorities,
    clock: () => Date.parse(NOW),
  });
  for (const kind of HUMAN_REVIEW_KINDS) {
    await transition.review({
      pairDirectory,
      recordPath: await recordFile(reviews[kind]),
    });
  }
  return { pairDirectory, state, transition, authorization, authorities, reviews };
}

function fixtureProviderBroker(provider: "codex" | "claude-code") {
  const providerHomeId = `home-${provider}`;
  return {
    available: true,
    providerHomeId,
    providerHomeAuthority: {
      payload: { providerHomeId },
      payloadDigest: sha256(`home-authority-${provider}`),
    },
    releaseAuthorityDigest: sha256(`release-authority-${provider}`),
    providerEgressAttestation: async () => ({
      payloadDigest: sha256(`egress-${provider}`),
    }),
    async execute(job: { envelope: { capsule: { task: FixtureTask } } }) {
      const task = job.envelope.capsule.task;
      const evidenceId = task.evidenceView.allowedEvidenceIds[0];
      const proposal = {
        schemaVersion: "1.0.0",
        schemaId: task.requiredOutputSchemaId,
        taskId: task.taskId,
        runId: task.runId,
        attemptId: task.attemptId,
        fenceToken: task.fenceToken,
        evidenceOccurrenceIds: [evidenceId],
        limitationIds: [],
        content:
          task.expectedAuthorProposalDigest === undefined
            ? {
                claims: [
                  {
                    claimId: `claim-${task.taskKind}`,
                    controlId: `CONTROL/${task.taskKind.toUpperCase()}`,
                    result: "partial",
                    evidenceOccurrenceIds: [evidenceId],
                    summary: `Bounded ${task.taskKind} proposal.`,
                  },
                ],
                limitations: [],
              }
            : {
                authorProposalDigest: task.expectedAuthorProposalDigest,
                verdict: "passed",
                objectionCodes: [],
                evidenceOccurrenceIds: [evidenceId],
              },
      };
      const bytes = Buffer.from(JSON.stringify(proposal));
      const logBytes = Buffer.from("fixture operational log");
      return {
        state: "completed",
        startedAt: NOW,
        endedAt: NOW,
        limitationIds: [],
        providerSessionId: `session-${provider}-${task.taskKind}`,
        proposalOutbox: {
          bytes,
          receipt: {
            receiptId: `proposal-${provider}-${task.taskKind}`,
            outboxName: "provider-proposal",
            mediaType: "application/json",
            byteLength: String(bytes.byteLength),
            sha256: sha256(bytes),
            closed: true,
          },
        },
        operationalLogReceipt: {
          receiptId: `log-${provider}-${task.taskKind}`,
          outboxName: "provider-operational-log",
          mediaType: "text/plain",
          byteLength: String(logBytes.byteLength),
          sha256: sha256(logBytes),
          closed: true,
        },
      };
    },
  };
}

async function terminalPairFixture() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "rak-transition-e2e-"));
  created.push(fixtureRoot);
  const source = path.join(fixtureRoot, "source");
  await mkdir(source);
  await writeFile(path.join(source, "package.json"), '{"name":"transition-e2e"}\n');
  await writeFile(path.join(source, "server.js"), "export const ok = true;\n");
  for (const arguments_ of [
    ["init", "-q"],
    ["config", "user.email", "fixture@example.invalid"],
    ["config", "user.name", "Fixture"],
    ["add", "."],
    ["commit", "-qm", "fixture"],
  ]) {
    execFileSync("git", arguments_, {
      cwd: source,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    });
  }
  const discovery = path.join(fixtureRoot, "discovery.json");
  const topics = [
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
  await writeFile(
    discovery,
    JSON.stringify({
      topics: Object.fromEntries(
        topics.map((topic) => [
          topic,
          {
            unknown: {
              reason: "Fixture has no owner interview.",
              confidenceEffect: "Confidence remains low.",
              coverageEffect: "Business context is unverified.",
              followUp: "Obtain owner input.",
            },
            provenance: "unverified",
            confidence: "low",
          },
        ]),
      ),
    }),
  );
  const outputRoot = `generated/transition-e2e-${process.pid}-${Date.now()}`;
  created.push(path.join(ROOT, outputRoot));
  const config = path.join(fixtureRoot, "config.json");
  await writeFile(
    config,
    JSON.stringify({
      schemaVersion: "1.0.0",
      projectSlug: "transition-e2e",
      source: { kind: "local", path: source, workingTreeMode: "frozen-working-tree" },
      discoveryPath: discovery,
      outputRoot,
      runtime: { mode: "static-only", targetOrigins: [] },
      sandboxCredentials: [],
      optionalServices: [],
    }),
  );
  const codex = await runReleaseAssessment({
    provider: "codex",
    configPath: config,
    kitRoot: ROOT,
    broker: fixtureProviderBroker("codex"),
    clock: () => NOW,
  });
  const claude = await runReleaseAssessment({
    provider: "claude-code",
    configPath: config,
    kitRoot: ROOT,
    broker: fixtureProviderBroker("claude-code"),
    clock: () => NOW,
  });
  const reviewer = {
    mode: "fixture-test-only",
    async runReview(task: FixtureCrossTask) {
      const agentTask = task.capsule.task;
      const evidenceId = agentTask.evidenceView.allowedEvidenceIds[0];
      const proposal = {
        schemaVersion: "1.0.0",
        schemaId: "rak-agent-proposal/1.0.0",
        taskId: task.taskId,
        runId: task.runId,
        attemptId: task.attemptId,
        fenceToken: task.fenceToken,
        evidenceOccurrenceIds: [evidenceId],
        limitationIds: [],
        content: {
          authorProposalDigest: task.authorProposalDigest,
          verdict: "passed",
          objectionCodes: [],
          evidenceOccurrenceIds: [evidenceId],
        },
      };
      const proposalBytes = Buffer.from(JSON.stringify(proposal));
      return {
        jobId: task.jobId,
        provider: task.reviewerProvider,
        providerSessionId: `cross-session-${task.taskKind}`,
        attemptId: task.attemptId,
        fenceToken: task.fenceToken,
        nonce: task.nonce,
        proposal,
        proposalBytes,
        proposalBytesDigest: sha256(proposalBytes),
        proposalReceipt: {
          receiptId: `cross-proposal-${task.taskKind}`,
          outboxName: "provider-proposal",
          mediaType: "application/json",
          byteLength: String(proposalBytes.byteLength),
          sha256: sha256(proposalBytes),
          closed: true,
        },
        operationalLogReceipt: {
          receiptId: `cross-log-${task.taskKind}`,
          outboxName: "provider-operational-log",
          mediaType: "text/plain",
          byteLength: "0",
          sha256: sha256(Buffer.alloc(0)),
          closed: true,
        },
        cleanup: { status: "verified", residue: [] },
      };
    },
  };
  const pairTransition = createPublicReleaseTransition({
    mode: "fixture-test-only",
    reviewer,
    authorities: {
      mode: "fixture-test-only",
      reviewKeys: {},
      authorizationKeys: {},
      certificateKeys: {},
      certificateSubjects: {},
      unresolvedBoundaryDefects: [],
    },
    clock: () => Date.parse(NOW),
  });
  if (codex.state.providerSuccessor === undefined || claude.state.providerSuccessor === undefined) {
    throw new Error(
      JSON.stringify({
        codex: codex.state.tasks.map(
          ({
            taskKind,
            outcome,
            limitationIds,
          }: {
            taskKind: unknown;
            outcome: unknown;
            limitationIds: unknown;
          }) => ({
            taskKind,
            outcome,
            limitationIds,
          }),
        ),
        claude: claude.state.tasks.map(
          ({
            taskKind,
            outcome,
            limitationIds,
          }: {
            taskKind: unknown;
            outcome: unknown;
            limitationIds: unknown;
          }) => ({
            taskKind,
            outcome,
            limitationIds,
          }),
        ),
      }),
    );
  }
  const pair = await pairTransition.pair({
    codexRunDirectory: codex.state.runDirectory,
    claudeRunDirectory: claude.state.runDirectory,
  });
  created.push(pair.pairDirectory);
  return { pair, reviewer, pairTransition, codex, claude };
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((target) => rm(target, { recursive: true, force: true })),
  );
});

describe("public release transition authorities", () => {
  it("rejects production dependency injection", () => {
    expect(() =>
      createPublicReleaseTransition({
        reviewer: { mode: "production" },
        authorities: { mode: "production" },
      }),
    ).toThrow(/cannot accept injected/iu);
  });

  it("admits one current exact-digest Ed25519 review and rejects its replay", async () => {
    const { pairDirectory, state } = await fixturePair();
    const key = keyFixture("independent-security");
    const transition = createPublicReleaseTransition({
      mode: "fixture-test-only",
      reviewer: { mode: "fixture-test-only" },
      authorities: {
        mode: "fixture-test-only",
        reviewKeys: {
          "key_independent-security": {
            kind: "independent-security",
            publicKey: key.publicKey,
          },
        },
        authorizationKeys: {},
        certificateKeys: {},
        certificateSubjects: {},
        unresolvedBoundaryDefects: [],
      },
      clock: () => Date.parse(NOW),
    });
    const recordPath = await recordFile(signedReview(state, key));
    await expect(transition.review({ pairDirectory, recordPath })).resolves.toMatchObject({
      admittedRecordId: "review_independent-security",
    });
    await expect(transition.review({ pairDirectory, recordPath })).rejects.toMatchObject({
      code: "HUMAN_REVIEW_REPLAY",
    });
  });

  it.each([
    ["future-issued", { issuedAt: "2026-07-28T18:30:00.000Z" }, "SIGNED_RECORD_TIME_INVALID"],
    ["expired", { expiresAt: "2026-07-28T17:59:59.000Z" }, "SIGNED_RECORD_TIME_INVALID"],
    ["rejected", { decision: "rejected" }, "HUMAN_REVIEW_REJECTED"],
    ["wrong digest", { successorZipDigest: DIGEST }, "HUMAN_REVIEW_INVALID"],
  ])("rejects %s review authority", async (_name, override, code) => {
    const { pairDirectory, state } = await fixturePair();
    const key = keyFixture("independent-security");
    const transition = createPublicReleaseTransition({
      mode: "fixture-test-only",
      reviewer: { mode: "fixture-test-only" },
      authorities: {
        mode: "fixture-test-only",
        reviewKeys: {
          "key_independent-security": {
            kind: "independent-security",
            publicKey: key.publicKey,
          },
        },
        authorizationKeys: {},
        certificateKeys: {},
        certificateSubjects: {},
        unresolvedBoundaryDefects: [],
      },
      clock: () => Date.parse(NOW),
    });
    const recordPath = await recordFile(signedReview(state, key, override));
    await expect(transition.review({ pairDirectory, recordPath })).rejects.toMatchObject({ code });
  });

  it("keeps public CLI fail-closed without fixed production configuration", () => {
    let failure = "";
    try {
      execFileSync(
        path.join(ROOT, "start-codex.sh"),
        ["pair", "--codex-run-dir", "generated/a", "--claude-run-dir", "generated/b"],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      failure = String((error as { stderr?: string }).stderr ?? "");
    }
    expect(failure).toMatch(/PUBLIC_RELEASE_PREFLIGHT_BLOCKED/u);
    expect(failure).not.toMatch(/fixture|private.?key/iu);
  });

  it("writes only the admitted review and digest-bound pair update", async () => {
    const { pairDirectory, state } = await fixturePair();
    const key = keyFixture("lay-human");
    const transition = createPublicReleaseTransition({
      mode: "fixture-test-only",
      reviewer: { mode: "fixture-test-only" },
      authorities: {
        mode: "fixture-test-only",
        reviewKeys: {
          "key_lay-human": { kind: "lay-human", publicKey: key.publicKey },
        },
        authorizationKeys: {},
        certificateKeys: {},
        certificateSubjects: {},
        unresolvedBoundaryDefects: [],
      },
      clock: () => Date.parse(NOW),
    });
    await transition.review({
      pairDirectory,
      recordPath: await recordFile(signedReview(state, key)),
    });
    const journal = JSON.parse(
      await readFile(path.join(pairDirectory, "provider-pair-state.json"), "utf8"),
    );
    expect(journal.pendingAdmission).toBeNull();
    expect(journal.admittedReviews).toHaveLength(1);
    expect(journal.journalDigest).toBe(
      sha256(canonicalJson({ ...journal, journalDigest: undefined })),
    );
  });

  it("admits five distinct reviews and one complete certificate-bound authorization", async () => {
    const fixture = await completeReviewFixture();
    const result = await fixture.transition.authorize({
      pairDirectory: fixture.pairDirectory,
      recordPath: await recordFile(fixture.authorization.record),
    });
    expect(result.authorizationRecordId).toBe("authorization_fixture");
    expect(result.state.admittedReviews).toHaveLength(5);
    expect(result.state.authorization).toMatchObject({
      recordId: "authorization_fixture",
    });
    expect(result.state.blockers).toEqual(["CUSTOMER_RELEASE_REVALIDATION_REQUIRED"]);
  });

  it("blocks authorization while a Critical boundary defect is unresolved", async () => {
    const fixture = await completeReviewFixture([
      { defectId: "boundary-critical", severity: "Critical", state: "unresolved" },
    ]);
    await expect(
      fixture.transition.authorize({
        pairDirectory: fixture.pairDirectory,
        recordPath: await recordFile(fixture.authorization.record),
      }),
    ).rejects.toMatchObject({ code: "UNRESOLVED_BOUNDARY_DEFECT" });
  });

  it("allows visible unresolved Medium defects without weakening the signed gate", async () => {
    const fixture = await completeReviewFixture([
      { defectId: "boundary-medium", severity: "Medium", state: "unresolved" },
    ]);
    await expect(
      fixture.transition.authorize({
        pairDirectory: fixture.pairDirectory,
        recordPath: await recordFile(fixture.authorization.record),
      }),
    ).resolves.toMatchObject({ authorizationRecordId: "authorization_fixture" });
  });

  it("recovers an owner-private transition lock left by a dead process", async () => {
    const { pairDirectory, state } = await fixturePair();
    await writeFile(
      path.join(pairDirectory, ".transition.lock"),
      `${JSON.stringify({ pid: 2_147_483_647, processStartToken: "dead" })}\n`,
      { mode: 0o600 },
    );
    const key = keyFixture("lay-human");
    const transition = createPublicReleaseTransition({
      mode: "fixture-test-only",
      reviewer: { mode: "fixture-test-only" },
      authorities: {
        mode: "fixture-test-only",
        reviewKeys: { "key_lay-human": { kind: "lay-human", publicKey: key.publicKey } },
        authorizationKeys: {},
        certificateKeys: {},
        certificateSubjects: {},
        unresolvedBoundaryDefects: [],
      },
      clock: () => Date.parse(NOW),
    });
    await expect(
      transition.review({
        pairDirectory,
        recordPath: await recordFile(signedReview(state, key)),
      }),
    ).resolves.toMatchObject({ admittedRecordId: "review_lay-human" });
  });

  it("recovers an aged zero-byte lock left between exclusive creation and owner admission", async () => {
    const { pairDirectory, state } = await fixturePair();
    const lockPath = path.join(pairDirectory, ".transition.lock");
    await writeFile(lockPath, "", { mode: 0o600 });
    const old = new Date(Date.now() - 10_000);
    await utimes(lockPath, old, old);
    const key = keyFixture("customer-acceptance");
    const transition = createPublicReleaseTransition({
      mode: "fixture-test-only",
      reviewer: { mode: "fixture-test-only" },
      authorities: {
        mode: "fixture-test-only",
        reviewKeys: {
          "key_customer-acceptance": {
            kind: "customer-acceptance",
            publicKey: key.publicKey,
          },
        },
        authorizationKeys: {},
        certificateKeys: {},
        certificateSubjects: {},
        unresolvedBoundaryDefects: [],
      },
      clock: () => Date.parse(NOW),
    });
    await expect(
      transition.review({
        pairDirectory,
        recordPath: await recordFile(signedReview(state, key)),
      }),
    ).resolves.toMatchObject({ admittedRecordId: "review_customer-acceptance" });
  });

  it("resumes an exactly prepared review sidecar without duplicating authority", async () => {
    const { pairDirectory, state } = await fixturePair();
    const key = keyFixture("technical-human");
    const record = signedReview(state, key);
    const reviewsDirectory = path.join(pairDirectory, "reviews");
    await mkdir(reviewsDirectory, { mode: 0o700 });
    await writeFile(
      path.join(reviewsDirectory, `${record.recordId}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      { mode: 0o600 },
    );
    Reflect.set(state, "pendingAdmission", {
      type: "review",
      recordId: record.recordId,
      recordDigest: sha256(canonicalJson(record)),
    });
    state.journalDigest = sha256(canonicalJson({ ...state, journalDigest: undefined }));
    await writeFile(
      path.join(pairDirectory, "provider-pair-state.json"),
      `${JSON.stringify(state, null, 2)}\n`,
      { mode: 0o600 },
    );
    const transition = createPublicReleaseTransition({
      mode: "fixture-test-only",
      reviewer: { mode: "fixture-test-only" },
      authorities: {
        mode: "fixture-test-only",
        reviewKeys: {
          "key_technical-human": { kind: "technical-human", publicKey: key.publicKey },
        },
        authorizationKeys: {},
        certificateKeys: {},
        certificateSubjects: {},
        unresolvedBoundaryDefects: [],
      },
      clock: () => Date.parse(NOW),
    });
    await expect(
      transition.review({ pairDirectory, recordPath: await recordFile(record) }),
    ).resolves.toMatchObject({ admittedRecordId: record.recordId });
    const journal = JSON.parse(
      await readFile(path.join(pairDirectory, "provider-pair-state.json"), "utf8"),
    );
    expect(journal.pendingAdmission).toBeNull();
    expect(journal.admittedReviews).toHaveLength(1);
  });

  it("runs two terminal providers through cross-review, five reviews, authorization, and release", async () => {
    const fixture = await terminalPairFixture();
    let { pair } = fixture;
    const { reviewer } = fixture;
    const interruptedPair = structuredClone(pair.state);
    interruptedPair.state = "PAIRING";
    interruptedPair.successorRunId = null;
    interruptedPair.successorZipDigest = null;
    interruptedPair.reconciliationDigest = null;
    interruptedPair.blockers = ["CROSS_PROVIDER_REVIEW_REQUIRED"];
    interruptedPair.journalDigest = sha256(
      canonicalJson({ ...interruptedPair, journalDigest: undefined }),
    );
    await writeFile(
      path.join(pair.pairDirectory, "provider-pair-state.json"),
      `${JSON.stringify(interruptedPair, null, 2)}\n`,
      { mode: 0o600 },
    );
    pair = await fixture.pairTransition.pair({
      codexRunDirectory: fixture.codex.state.runDirectory,
      claudeRunDirectory: fixture.claude.state.runDirectory,
    });
    const reviewKeys = Object.fromEntries(
      HUMAN_REVIEW_KINDS.map((kind: string) => {
        const key = keyFixture(kind);
        return [`key_${kind}`, { kind, key }];
      }),
    );
    const reviews = Object.fromEntries(
      HUMAN_REVIEW_KINDS.map((kind: string) => [
        kind,
        signedReview(pair.state, reviewKeys[`key_${kind}`].key),
      ]),
    );
    const authorizationKey = keyFixture("authorization");
    const authorization = authorizationFixture(pair.state, reviews, authorizationKey);
    const transition = createPublicReleaseTransition({
      mode: "fixture-test-only",
      reviewer,
      authorities: {
        mode: "fixture-test-only",
        reviewKeys: Object.fromEntries(
          Object.entries(reviewKeys).map(([id, value]) => [
            id,
            { kind: value.kind, publicKey: value.key.publicKey },
          ]),
        ),
        authorizationKeys: {
          "authorization-key": { publicKey: authorizationKey.publicKey },
        },
        certificateKeys: authorization.certificateKeys,
        certificateSubjects: authorization.certificateSubjects,
        unresolvedBoundaryDefects: [],
      },
      clock: () => Date.parse(NOW),
    });
    for (const kind of HUMAN_REVIEW_KINDS) {
      await transition.review({
        pairDirectory: pair.pairDirectory,
        recordPath: await recordFile(reviews[kind]),
      });
    }
    const authorized = await transition.authorize({
      pairDirectory: pair.pairDirectory,
      recordPath: await recordFile(authorization.record),
    });
    const preparedCertificate = {
      schemaVersion: "rak-customer-release-certificate/1.0.0",
      certificateId: stableReleaseId(
        "release",
        pair.state.equivalencePairId,
        pair.state.successorZipDigest,
        authorized.state.authorization.recordDigest,
      ),
      equivalencePairId: pair.state.equivalencePairId,
      successorZipDigest: pair.state.successorZipDigest,
      reconciliationDigest: pair.state.reconciliationDigest,
      inputBindingDigest: pair.state.inputBindingDigest,
      reviewDigests: Object.fromEntries(
        HUMAN_REVIEW_KINDS.map((kind: string) => [kind, sha256(canonicalJson(reviews[kind]))]),
      ),
      authorizationDigest: authorized.state.authorization.recordDigest,
      certificateSetDigest: authorized.state.authorization.certificateSetDigest,
      issuedAt: NOW,
      customerReleaseAuthorized: true,
    };
    const certificateDigest = sha256(
      canonicalJson({
        domain: "rak-customer-release-certificate/v1",
        certificate: preparedCertificate,
      }),
    );
    const preparedState = authorized.state;
    preparedState.state = "CUSTOMER_RELEASE_PREPARED";
    preparedState.pendingRelease = {
      certificateId: preparedCertificate.certificateId,
      certificateDigest,
      issuedAt: NOW,
    };
    preparedState.blockers = [];
    preparedState.journalDigest = sha256(
      canonicalJson({ ...preparedState, journalDigest: undefined }),
    );
    await writeFile(
      path.join(pair.pairDirectory, "provider-pair-state.json"),
      `${JSON.stringify(preparedState, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      path.join(pair.pairDirectory, CUSTOMER_RELEASE_FILE),
      `${JSON.stringify({ ...preparedCertificate, certificateDigest }, null, 2)}\n`,
      { mode: 0o600 },
    );
    const released = await transition.release({ pairDirectory: pair.pairDirectory });
    expect(released.state.state).toBe("CUSTOMER_RELEASE_AUTHORIZED");
    expect(released.certificate.customerReleaseAuthorized).toBe(true);
    expect(released.certificate.successorZipDigest).toBe(pair.state.successorZipDigest);
  }, 30_000);
});

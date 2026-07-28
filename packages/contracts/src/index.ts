import { z } from "zod";

export const contractVersions = Object.freeze({
  assessment: "rak-contract/1.0.0",
  workflow: "rak-workflow/1.0.0",
  exportProfile: "rak-export-profile/1.0.0",
  schema: "1.0.0",
});

export const runStates = [
  "DRAFT",
  "RESOLVING_TARGET",
  "READY",
  "EXECUTING",
  "WAITING_INPUT",
  "PAUSING",
  "PAUSED",
  "RECOVERABLE_FAILURE",
  "VALIDATING",
  "REVIEW_REQUIRED",
  "PACKAGING",
  "COMPLETED",
  "CANCELLING",
  "CANCELLED",
  "FAILED",
] as const;
export type RunState = (typeof runStates)[number];

export const phaseKeys = [
  "discovery",
  "target-snapshot",
  "static-inventory",
  "static-security-quality",
  "runtime-capability",
  "dynamic-assessment",
  "product-code-traceability",
  "decision-synthesis",
  "independent-security-review",
  "independent-decision-review",
  "deterministic-validation",
  "technical-human-review",
  "lay-human-review",
  "package",
] as const;
export type PhaseKey = (typeof phaseKeys)[number];
export const phaseStates = [
  "PENDING",
  "READY",
  "RUNNING",
  "WAITING_INPUT",
  "RETRYABLE_FAILURE",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;
export type PhaseState = (typeof phaseStates)[number];

export const discoveryTopics = [
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
] as const;
export type DiscoveryTopic = (typeof discoveryTopics)[number];

export const assessmentDomains = [
  "repository-composition",
  "stack-detection",
  "architecture-boundaries",
  "engineering-maintainability",
  "features-use-cases",
  "dependency-inventory",
  "dependency-vulnerabilities",
  "secret-detection",
  "sast",
  "iac-container-license",
  "runtime-readiness",
  "dynamic-browser-security",
  "security-independent-review",
  "modernization-decision",
  "evidence-package-integrity",
] as const;
export type AssessmentDomain = (typeof assessmentDomains)[number];
export const coverageStatuses = [
  "pass",
  "fail",
  "partial",
  "blocked",
  "not applicable",
  "not tested",
] as const;
export type CoverageStatus = (typeof coverageStatuses)[number];
export type LauncherProvider = "codex" | "claude-code";
export type Digest = `sha256:${string}`;
export type Timestamp = string;

const timestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    "timestamp must be UTC RFC 3339 with milliseconds",
  )
  .datetime({ offset: false });
const digest = z.custom<Digest>(
  (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value),
  "expected a sha256 digest",
);
const uuidV7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const prefixedId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}${uuidV7}$`), `expected ${prefix}UUIDv7`);
export const runIdSchema = prefixedId("run_");

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code <= 31 || code === 127);
  });
}

function isNormalizedRoute(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacter(value) ||
    value.includes("?") ||
    value.includes("#")
  )
    return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (decoded.includes("\\") || hasControlCharacter(decoded)) return false;
  const segments = decoded.split("/");
  return !segments.some((segment) => segment === "." || segment === "..");
}

function isNormalizedRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !hasControlCharacter(value) &&
    !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

export interface RunDocument {
  schemaVersion: "1.0.0";
  runId: string;
  parentRunId?: string;
  projectSlug: string;
  revision: number;
  rowVersion: number;
  state: RunState;
  workflowProfile: "rak-workflow/1.0.0";
  exportProfile: "rak-export-profile/1.0.0";
  provider: LauncherProvider;
  targetSnapshotId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  terminalAt?: Timestamp;
  limitationIds: string[];
  packageId?: string;
}

export interface PhaseDocument {
  schemaVersion: "1.0.0";
  phaseId: string;
  runId: string;
  phaseKey: PhaseKey;
  phaseRevision: number;
  state: PhaseState;
  currentAttemptId?: string;
  required: boolean;
  dependsOn: string[];
  limitationIds: string[];
}

export interface TargetSnapshot {
  schemaVersion: "1.0.0";
  snapshotId: string;
  sourceKind: "ssh-git" | "local";
  sanitizedLocator: string;
  gitObjectFormat: "sha1" | "sha256";
  commitSha: string;
  baseCommitSha: string;
  mode: "commit-only" | "frozen-working-tree";
  manifestBlobId: string;
  manifestDigest: Digest;
  archiveDigest: Digest;
  beforeSourceDigest: Digest;
  afterSourceDigest: Digest;
  includedDirtyPaths: string[];
  excludedDirtyPaths: string[];
  submodules: "not-present" | "pointers-only" | "explicitly-acquired";
  lfs: "not-present" | "pointers-only" | "explicitly-acquired";
  createdAt: Timestamp;
}

export interface ProductClaim {
  schemaVersion: "1.0.0";
  claimId: string;
  runId: string;
  topic: DiscoveryTopic;
  statement?: string;
  unknown?: {
    reason: string;
    confidenceEffect: string;
    coverageEffect: string;
    followUp: string;
  };
  provenance:
    | "owner-stated"
    | "documented"
    | "observed"
    | "analytics-supported"
    | "code-inferred"
    | "unverified"
    | "conflicting";
  speakerRole?: string;
  capturedAt?: Timestamp;
  analytics?: {
    dataset: string;
    query: string;
    windowStart: Timestamp;
    windowEnd: Timestamp;
  };
  inferenceReasoning?: string;
  confidence: "high" | "medium" | "low";
  evidenceOccurrenceIds: string[];
  conflictsWithClaimIds: string[];
  supersedesClaimId?: string;
  revision: number;
}

export interface CapabilityResult {
  capabilityId: string;
  scope: "installation" | "engagement" | "run" | "attempt";
  declaredBy: string[];
  support: "supported" | "unsupported";
  attestation: "passed" | "failed" | "missing" | "expired";
  approval: "approved" | "denied" | "not-required" | "missing";
  effective: "available" | "unavailable" | "blocked" | "denied" | "not-applicable";
  reasonCode: string;
  reason: string;
  evidenceOccurrenceIds: string[];
  coverageEffects: string[];
  checkedAt: Timestamp;
}

export interface Approval {
  schemaVersion: "1.0.0";
  approvalId: string;
  runId: string;
  capabilityId: string;
  decision: "approved" | "denied";
  destinations: Array<{ scheme: string; host: string; port: number; pathPrefix?: string }>;
  methods?: string[];
  dataCategories: string[];
  recipientServices: string[];
  credentialHandleId?: string;
  disclosureVersion: string;
  approverRole: string;
  approvedAt: Timestamp;
  expiresAt: Timestamp;
  revokedAt?: Timestamp;
}

export interface DomainCoverage {
  schemaVersion: "1.0.0";
  coverageId: string;
  runId: string;
  domainId: AssessmentDomain;
  status: CoverageStatus;
  plannedControls: number;
  reconciledControls: number;
  counts: Record<CoverageStatus, number>;
  exclusions: string[];
  unsupportedEcosystems: string[];
  limitationIds: string[];
  evidenceOccurrenceIds: string[];
}

export interface ControlResult {
  schemaVersion: "1.0.0";
  controlResultId: string;
  runId: string;
  plannedControlId: string;
  profileId: string;
  controlId: string;
  plannedScope: string;
  status: CoverageStatus;
  reasonCode?: string;
  reason?: string;
  techniqueIds: string[];
  evidenceOccurrenceIds: string[];
  limitationId?: string;
  activityId: string;
  reviewedBy?: string;
  completedAt: Timestamp;
}

export interface EvidenceOccurrence {
  schemaVersion: "1.0.0";
  evidenceId: string;
  runId: string;
  blobId: string;
  evidenceType: string;
  title: string;
  snapshotId: string;
  activityId: string;
  capturedAt: Timestamp;
  sourceLocator?: {
    repoRelPath: string;
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
  };
  packageRelPath?: string;
  externalLocator?: string;
  sensitivity: "public" | "customer-confidential" | "secret-suspected" | "restricted";
  redactionState: "none-required" | "pending" | "redacted" | "excluded";
  validationState: "unreviewed" | "validated" | "disputed" | "invalidated";
  collectionLimitations: string[];
  derivedFromEvidenceIds: string[];
  linkedClaimIds: string[];
  linkedFindingIds: string[];
  linkedControlIds: string[];
  supersedesEvidenceId?: string;
}

export interface Finding {
  schemaVersion: "1.0.0";
  findingId: string;
  runId: string;
  fingerprint: { algorithm: "rak-finding/v1"; value: string };
  revision: number;
  supersedesFindingId?: string;
  title: string;
  description: string;
  category: string;
  technicalSeverity: "critical" | "high" | "medium" | "low" | "informational";
  businessPriority: "urgent" | "high" | "medium" | "low" | "unassigned";
  confidence: "high" | "medium" | "low";
  validationState:
    | "unreviewed"
    | "corroborated"
    | "independently reproduced"
    | "disputed"
    | "invalidated";
  evidenceOccurrenceIds: string[];
  locations: Array<{ repoRelPath: string; startLine?: number; endLine?: number }>;
  cweMappings: Array<{
    cweId: string;
    catalogVersion: "4.20";
    primary: boolean;
    method: "tool" | "analyst" | "imported";
    confidence: "high" | "medium" | "low";
  }>;
  cvss: Array<{
    system: "CVSS";
    version: string;
    vector: string;
    score: string;
    band: string;
    scorer: string;
    scoredAt: Timestamp;
    evidenceOccurrenceIds: string[];
    imported: boolean;
  }>;
  remediationTheme?: string;
}

export interface DecisionComparison {
  schemaVersion: "1.0.0";
  runId: string;
  criteria: Array<{
    criterion:
      | "recoverability"
      | "system-boundaries"
      | "security-risk"
      | "engineering-risk"
      | "critical-feature-parity"
      | "expected-scale"
      | "rebuild-feasibility";
    options: Record<
      "remediation" | "incremental-replacement" | "full-rebuild",
      {
        assessment: string;
        state: "evidenced" | "unverified" | "conflicting";
        confidence: "high" | "medium" | "low";
        claimIds: string[];
        evidenceOccurrenceIds: string[];
      }
    >;
  }>;
  recommendation:
    | { kind: "single"; option: "remediation" | "incremental-replacement" | "full-rebuild" }
    | {
        kind: "conditional-sequence";
        options: Array<"remediation" | "incremental-replacement" | "full-rebuild">;
      };
  rationale: string;
  confidence: "high" | "medium" | "low";
  assumptions: string[];
  dependencies: string[];
  reversalConditions: string[];
}

export interface RunEvent {
  schemaVersion: "1.0.0";
  sequence: string;
  runId: string;
  rowVersion: number;
  type:
    | "run.state.changed"
    | "phase.state.changed"
    | "job.state.changed"
    | "capability.changed"
    | "coverage.changed"
    | "finding.admitted"
    | "review.required"
    | "artifact.admitted"
    | "package.state.changed"
    | "warning.raised";
  occurredAt: Timestamp;
  phaseId?: string;
  attemptId?: string;
  summary: string;
}

export interface PackageView {
  packageId: string;
  runId: string;
  revision: number;
  state: "REQUESTED" | "STAGING" | "VALIDATING" | "VALIDATED" | "FAILED";
  zipByteLength?: string;
  zipSha256?: Digest;
  encrypted?: { kind: "age-v1"; byteLength: string; sha256: Digest };
  validationReportId?: string;
}

export interface SecretHandleView {
  secretHandleId: string;
  purpose: string;
  recipient: string;
  expiresAt: Timestamp;
  uploaded: boolean;
  remainingUses: 0 | 1;
}

export interface Review {
  schemaVersion: "1.0.0";
  reviewId: string;
  runId: string;
  kind: "independent-security" | "independent-decision" | "technical-human" | "lay-human";
  reviewerAgentId: string;
  inputDigest: Digest;
  verdict: "passed" | "passed-with-objections" | "failed";
  itemResults: Array<{
    itemId: string;
    outcome:
      | "corroborated"
      | "independently reproduced"
      | "disputed"
      | "invalidated"
      | "not assessed";
    objection?: string;
    evidenceOccurrenceIds: string[];
  }>;
  acceptedCorrectionIds: string[];
  limitationIds: string[];
  reviewEvidenceId: string;
  completedAt: Timestamp;
}

export interface DeletionJobView {
  deletionJobId: string;
  runId: string;
  scope: "internal-only" | "run-except-packages" | "entire-run";
  state:
    | "REQUESTED"
    | "PRECHECK"
    | "TRASHED"
    | "RESTORING"
    | "RESTORED"
    | "PURGING"
    | "PURGED"
    | "FAILED";
  trashPathDigest?: Digest;
  trashedAt?: Timestamp;
  purgeAfter?: Timestamp;
  removedClasses: string[];
  recoveryPossible: boolean;
  failureCode?: string;
}

export interface PackageValidationCertificate {
  schemaVersion: "1.0.0";
  packageId: string;
  runId: string;
  runRevision: number;
  packageDigest: Digest;
  byteLength: string;
  validationReportId: string;
  certificateDigest: Digest;
  artifactPath: string;
  validatedAt: Timestamp;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    details: Array<{ path?: string; reason: string }>;
    operatorAction?: string;
    coverageEffects?: string[];
  };
}

export interface DynamicControlPlanPayload {
  schemaVersion: "1.0.0";
  controlPlanId: string;
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
  internalOrigins: Array<{ scheme: "http" | "https"; host: string; port: number }>;
  controls: Array<{
    plannedControlId: string;
    safetyClass:
      | "P0-passive"
      | "P1-anonymous-read"
      | "P2-authenticated-read"
      | "P3-session-bootstrap";
    internalOrigin: { scheme: "http" | "https"; host: string; port: number };
    method: "GET" | "HEAD" | "OPTIONS" | "POST";
    routeTemplate: string;
    principalPseudonym?: string;
    rolePseudonym?: string;
    tenantPseudonym?: string;
    secretPurpose?: "target-service" | "probe";
    secretRecipient?: string;
    fixtureIds: string[];
    expectedSideEffects: string[];
    budgets: {
      requests: number;
      bytes: string;
      requestsPerSecond: number;
      wallSeconds: number;
      redirects: number;
    };
    permittedOutputClass: "O0" | "O2" | "O3";
    abortTriggers: string[];
    cleanupAssertion: string;
    coverageOnDenyOrInterruption: "blocked" | "not tested" | "partial";
  }>;
  probeProfileId: string;
  issuedAt: Timestamp;
  expiresAt: Timestamp;
  nonce: string;
}
export interface SignedDynamicControlPlan {
  payload: DynamicControlPlanPayload;
  payloadDigest: Digest;
  signatureAlgorithm: "Ed25519";
  signingKeyId: string;
  signature: string;
}

export const runDocumentSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    runId: runIdSchema,
    parentRunId: prefixedId("run_").optional(),
    projectSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    revision: z.number().int().positive(),
    rowVersion: z.number().int().nonnegative(),
    state: z.enum(runStates),
    workflowProfile: z.literal("rak-workflow/1.0.0"),
    exportProfile: z.literal("rak-export-profile/1.0.0"),
    provider: z.enum(["codex", "claude-code"]),
    targetSnapshotId: digest.optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
    terminalAt: timestamp.optional(),
    limitationIds: z.array(z.string()),
    packageId: prefixedId("pkg_").optional(),
  })
  .strict();

export const targetSnapshotSchema: z.ZodType<TargetSnapshot> = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    snapshotId: digest,
    sourceKind: z.enum(["ssh-git", "local"]),
    sanitizedLocator: z.string().min(1),
    gitObjectFormat: z.enum(["sha1", "sha256"]),
    commitSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    baseCommitSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    mode: z.enum(["commit-only", "frozen-working-tree"]),
    manifestBlobId: z.string().min(1),
    manifestDigest: digest,
    archiveDigest: digest,
    beforeSourceDigest: digest,
    afterSourceDigest: digest,
    includedDirtyPaths: z.array(
      z.string().refine(isNormalizedRelativePath, "expected normalized relative path"),
    ),
    excludedDirtyPaths: z.array(
      z.string().refine(isNormalizedRelativePath, "expected normalized relative path"),
    ),
    submodules: z.enum(["not-present", "pointers-only", "explicitly-acquired"]),
    lfs: z.enum(["not-present", "pointers-only", "explicitly-acquired"]),
    createdAt: timestamp,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const expectedLength = snapshot.gitObjectFormat === "sha1" ? 40 : 64;
    if (
      snapshot.commitSha.length !== expectedLength ||
      snapshot.baseCommitSha.length !== expectedLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["commitSha"],
        message: "commit length must match gitObjectFormat",
      });
    }
    if (snapshot.beforeSourceDigest !== snapshot.afterSourceDigest) {
      context.addIssue({
        code: "custom",
        path: ["afterSourceDigest"],
        message: "source integrity digest changed during acquisition",
      });
    }
  });

const unknownClaimSchema = z
  .object({
    reason: z.string().min(1),
    confidenceEffect: z.string().min(1),
    coverageEffect: z.string().min(1),
    followUp: z.string().min(1),
  })
  .strict();
export const productClaimSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    claimId: z.string().min(1),
    runId: prefixedId("run_"),
    topic: z.enum(discoveryTopics),
    statement: z.string().min(1).optional(),
    unknown: unknownClaimSchema.optional(),
    provenance: z.enum([
      "owner-stated",
      "documented",
      "observed",
      "analytics-supported",
      "code-inferred",
      "unverified",
      "conflicting",
    ]),
    speakerRole: z.string().min(1).optional(),
    capturedAt: timestamp.optional(),
    analytics: z
      .object({
        dataset: z.string().min(1),
        query: z.string().min(1),
        windowStart: timestamp,
        windowEnd: timestamp,
      })
      .strict()
      .optional(),
    inferenceReasoning: z.string().min(1).optional(),
    confidence: z.enum(["high", "medium", "low"]),
    evidenceOccurrenceIds: z.array(z.string()),
    conflictsWithClaimIds: z.array(z.string()),
    supersedesClaimId: z.string().optional(),
    revision: z.number().int().positive(),
  })
  .strict()
  .superRefine((claim, context) => {
    if ((claim.statement === undefined) === (claim.unknown === undefined)) {
      context.addIssue({
        code: "custom",
        message: "exactly one of statement and unknown is required",
      });
    }
    if (claim.provenance === "owner-stated" && (!claim.speakerRole || !claim.capturedAt)) {
      context.addIssue({
        code: "custom",
        message: "owner-stated requires speakerRole and capturedAt",
      });
    }
    if (claim.provenance === "analytics-supported" && !claim.analytics) {
      context.addIssue({ code: "custom", message: "analytics-supported requires analytics" });
    }
    if (claim.provenance === "code-inferred" && !claim.inferenceReasoning) {
      context.addIssue({ code: "custom", message: "code-inferred requires inferenceReasoning" });
    }
    if (
      claim.provenance === "conflicting" &&
      claim.conflictsWithClaimIds.length + claim.evidenceOccurrenceIds.length < 2
    ) {
      context.addIssue({ code: "custom", message: "conflicting requires at least two references" });
    }
  });

export const approvalSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    approvalId: z.string().min(1),
    runId: prefixedId("run_"),
    capabilityId: z.string().min(1),
    decision: z.enum(["approved", "denied"]),
    destinations: z.array(
      z
        .object({
          scheme: z.string().min(1),
          host: z.string().min(1),
          port: z.number().int().min(1).max(65535),
          pathPrefix: z.string().optional(),
        })
        .strict(),
    ),
    methods: z.array(z.string()).optional(),
    dataCategories: z.array(z.string()),
    recipientServices: z.array(z.string()),
    credentialHandleId: z.string().optional(),
    disclosureVersion: z.string().min(1),
    approverRole: z.string().min(1),
    approvedAt: timestamp,
    expiresAt: timestamp,
    revokedAt: timestamp.optional(),
  })
  .strict();

const decisionOptionSchema = z
  .object({
    assessment: z
      .string()
      .min(1)
      .refine(
        (value) => !/\b(certified|certification|legally compliant|compliant with)\b/i.test(value),
        "unsupported certification or compliance claim",
      ),
    state: z.enum(["evidenced", "unverified", "conflicting"]),
    confidence: z.enum(["high", "medium", "low"]),
    claimIds: z.array(z.string()),
    evidenceOccurrenceIds: z.array(z.string()),
  })
  .strict();
const decisionCriteria = [
  "recoverability",
  "system-boundaries",
  "security-risk",
  "engineering-risk",
  "critical-feature-parity",
  "expected-scale",
  "rebuild-feasibility",
] as const;
export const decisionComparisonSchema: z.ZodType<DecisionComparison> = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    runId: prefixedId("run_"),
    criteria: z.array(
      z
        .object({
          criterion: z.enum(decisionCriteria),
          options: z
            .object({
              remediation: decisionOptionSchema,
              "incremental-replacement": decisionOptionSchema,
              "full-rebuild": decisionOptionSchema,
            })
            .strict(),
        })
        .strict(),
    ),
    recommendation: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("single"),
          option: z.enum(["remediation", "incremental-replacement", "full-rebuild"]),
        })
        .strict(),
      z
        .object({
          kind: z.literal("conditional-sequence"),
          options: z
            .array(z.enum(["remediation", "incremental-replacement", "full-rebuild"]))
            .min(1),
        })
        .strict(),
    ]),
    rationale: z.string().min(1),
    confidence: z.enum(["high", "medium", "low"]),
    assumptions: z.array(z.string()),
    dependencies: z.array(z.string()),
    reversalConditions: z.array(z.string()),
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      decision.criteria.length !== decisionCriteria.length ||
      new Set(decision.criteria.map((item) => item.criterion)).size !== decisionCriteria.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "all seven decision criteria are required exactly once",
      });
    }
  });

export const reviewInputSchema = z
  .object({
    kind: z.enum(["technical-human", "lay-human"]),
    reviewerRole: z.string().min(1),
    inputDigest: digest,
    verdict: z.enum(["passed", "passed-with-objections", "failed"]),
    itemResults: z.array(
      z
        .object({
          itemId: z.string().min(1),
          outcome: z.enum([
            "corroborated",
            "independently reproduced",
            "disputed",
            "invalidated",
            "not assessed",
          ]),
          objection: z.string().min(1).optional(),
          evidenceOccurrenceIds: z.array(z.string()),
        })
        .strict(),
    ),
    notes: z.string().optional(),
  })
  .strict();

export const packageValidationCertificateSchema: z.ZodType<PackageValidationCertificate> = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    packageId: prefixedId("pkg_"),
    runId: runIdSchema,
    runRevision: z.number().int().positive(),
    packageDigest: digest,
    byteLength: z.string().regex(/^[0-9]+$/),
    validationReportId: z.string().min(1),
    certificateDigest: digest,
    artifactPath: z
      .string()
      .refine(isNormalizedRelativePath, "artifactPath must be a normalized relative path"),
    validatedAt: timestamp,
  })
  .strict();

export const createRunBodySchema = z
  .object({
    projectSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    engagementId: z.string().min(1),
    provider: z.enum(["codex", "claude-code"]),
    source: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("ssh-git"),
          sshHandleId: z.string().min(1),
          url: z.string().regex(/^ssh:\/\/|^[^@\s]+@[^:\s]+:/),
          ref: z.string().min(1).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("local"),
          sourceHandleId: z.string().min(1),
          relativePath: z
            .string()
            .refine(
              isNormalizedRelativePath,
              "relativePath must be a normalized relative POSIX path",
            ),
          mode: z.enum(["commit-only", "frozen-working-tree"]),
        })
        .strict(),
    ]),
    selectedProfiles: z.array(z.string()),
    optionalServiceIds: z.array(z.string()),
  })
  .strict();

export const dynamicControlPlanPayloadSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    controlPlanId: z.string().min(1),
    runId: prefixedId("run_"),
    runtimeId: z.string().min(1),
    runtimeCreationNonce: z.string().min(1),
    attemptId: z.string().min(1),
    fenceToken: z.string().regex(/^[0-9]+$/),
    snapshotId: z.string().min(1),
    compiledPlanId: z.string().min(1),
    compiledPlanDigest: digest,
    selectedProfileIds: z.array(z.string()),
    approvalIds: z.array(z.string()),
    authorityDigest: digest,
    internalOrigins: z.array(
      z
        .object({
          scheme: z.enum(["http", "https"]),
          host: z.string().min(1),
          port: z.number().int().min(1).max(65535),
        })
        .strict(),
    ),
    controls: z.array(
      z
        .object({
          plannedControlId: z.string().min(1),
          safetyClass: z.enum([
            "P0-passive",
            "P1-anonymous-read",
            "P2-authenticated-read",
            "P3-session-bootstrap",
          ]),
          internalOrigin: z
            .object({
              scheme: z.enum(["http", "https"]),
              host: z.string().min(1),
              port: z.number().int().min(1).max(65535),
            })
            .strict(),
          method: z.enum(["GET", "HEAD", "OPTIONS", "POST"]),
          routeTemplate: z
            .string()
            .refine(isNormalizedRoute, "routeTemplate must be a normalized absolute route"),
          principalPseudonym: z.string().optional(),
          rolePseudonym: z.string().optional(),
          tenantPseudonym: z.string().optional(),
          secretPurpose: z.enum(["target-service", "probe"]).optional(),
          secretRecipient: z.string().optional(),
          fixtureIds: z.array(z.string()),
          expectedSideEffects: z.array(z.string()),
          budgets: z
            .object({
              requests: z.number().int().positive().max(500),
              bytes: z.string().regex(/^[0-9]+$/),
              requestsPerSecond: z.number().positive().max(2),
              wallSeconds: z.number().int().positive().max(1800),
              redirects: z.number().int().nonnegative().max(5),
            })
            .strict(),
          permittedOutputClass: z.enum(["O0", "O2", "O3"]),
          abortTriggers: z.array(z.string()),
          cleanupAssertion: z.string().min(1),
          coverageOnDenyOrInterruption: z.enum(["blocked", "not tested", "partial"]),
        })
        .strict(),
    ),
    probeProfileId: z.string().min(1),
    issuedAt: timestamp,
    expiresAt: timestamp,
    nonce: z.string().min(1),
  })
  .strict()
  .superRefine((payload, context) => {
    const enrolledOrigins = new Set(
      payload.internalOrigins.map((origin) => `${origin.scheme}://${origin.host}:${origin.port}`),
    );
    for (const [index, control] of payload.controls.entries()) {
      const origin = `${control.internalOrigin.scheme}://${control.internalOrigin.host}:${control.internalOrigin.port}`;
      if (!enrolledOrigins.has(origin)) {
        context.addIssue({
          code: "custom",
          path: ["controls", index, "internalOrigin"],
          message: "control origin must be enrolled in internalOrigins",
        });
      }
      if (
        ["P0-passive", "P1-anonymous-read", "P2-authenticated-read"].includes(
          control.safetyClass,
        ) &&
        !["GET", "HEAD", "OPTIONS"].includes(control.method)
      ) {
        context.addIssue({
          code: "custom",
          path: ["controls", index, "method"],
          message: `${control.safetyClass} cannot issue POST`,
        });
      }
      if (control.safetyClass === "P3-session-bootstrap" && control.method !== "POST") {
        context.addIssue({
          code: "custom",
          path: ["controls", index, "method"],
          message: "P3-session-bootstrap requires POST",
        });
      }
      const allowedSideEffects =
        control.safetyClass === "P3-session-bootstrap"
          ? new Set(["session-creation", "session-revocation"])
          : new Set<string>();
      if (control.expectedSideEffects.some((effect) => !allowedSideEffects.has(effect))) {
        context.addIssue({
          code: "custom",
          path: ["controls", index, "expectedSideEffects"],
          message: "expected side effects exceed the safety class",
        });
      }
    }
  }) as unknown as z.ZodType<DynamicControlPlanPayload>;

export const signedDynamicControlPlanSchema = z
  .object({
    payload: dynamicControlPlanPayloadSchema,
    payloadDigest: digest,
    signatureAlgorithm: z.literal("Ed25519"),
    signingKeyId: z.string().min(1),
    signature: z.string().min(1),
  })
  .strict() as unknown as z.ZodType<SignedDynamicControlPlan>;

export function parseStrict<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

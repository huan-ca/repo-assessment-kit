import type {
  Approval,
  CapabilityResult,
  CoverageStatus,
  DomainCoverage,
  EvidenceOccurrence,
  Finding,
  LauncherProvider,
  PackageView,
  PhaseDocument,
  ProductClaim,
  RunDocument,
  RunEvent,
} from "@rak/contracts";

export type {
  Approval,
  CapabilityResult,
  CoverageStatus,
  DomainCoverage,
  EvidenceOccurrence,
  Finding,
  LauncherProvider,
  PackageView,
  PhaseDocument,
  ProductClaim,
  RunDocument,
  RunEvent,
};

export type View =
  | "welcome"
  | "readiness"
  | "assessments"
  | "new"
  | "discovery"
  | "consent"
  | "review"
  | "overview"
  | "capability"
  | "coverage"
  | "findings"
  | "finding"
  | "evidence"
  | "evidence-detail"
  | "decision"
  | "release"
  | "help";

export interface SystemView {
  productVersion: string;
  contractProfile: "rak-contract/1.0.0";
  workflowProfile: "rak-workflow/1.0.0";
  exportProfile: "rak-export-profile/1.0.0";
  launcherProvider: LauncherProvider;
  hostOs: "macos" | "linux";
  hostArch: "arm64" | "x86_64";
  prerequisites: CapabilityResult[];
}

export interface RunDetail {
  run: RunDocument;
  phases: PhaseDocument[];
  currentCapabilities: CapabilityResult[];
  coverageSummary: DomainCoverage[];
}

export interface SourceHandleView {
  sourceHandleId: string;
  kind: "local" | "ssh";
  displayName: string;
  allowedRootFingerprint: `sha256:${string}`;
  registeredAt: string;
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

export interface AppData {
  runAvailable: boolean;
  decisionAvailable: boolean;
  system: SystemView;
  sourceHandles: SourceHandleView[];
  run: RunDetail;
  events: RunEvent[];
  findings: Finding[];
  evidence: EvidenceOccurrence[];
  decision: DecisionComparison;
  packages: PackageView[];
}

export interface DraftSetup {
  projectSlug: string;
  engagementId: string;
  sourceKind: "local" | "ssh-git";
  sourceHandleId: string;
  relativePath: string;
  sshUrl: string;
  ref: string;
  mode: "commit-only" | "frozen-working-tree";
  profiles: string[];
  optionalServiceIds: string[];
}

export interface DraftClaim {
  topic: ProductClaim["topic"];
  statement: string;
  isUnknown: boolean;
  unknownReason: string;
  confidenceEffect: string;
  coverageEffect: string;
  followUp: string;
  provenance: ProductClaim["provenance"];
  confidence: ProductClaim["confidence"];
  speakerRole: string;
  inferenceReasoning: string;
  analyticsDataset: string;
  analyticsQuery: string;
  analyticsWindowStart: string;
  analyticsWindowEnd: string;
}

export interface ConsentChoice {
  capabilityId: string;
  decision: "" | "approved" | "denied";
}

export const viewTitles: Record<View, string> = {
  welcome: "A careful assessment starts with clear boundaries",
  readiness: "System readiness",
  assessments: "Assessments",
  new: "Start an assessment",
  discovery: "Product context",
  consent: "Access and consent",
  review: "Review setup",
  overview: "Assessment overview",
  capability: "Runtime capability",
  coverage: "Coverage and limitations",
  findings: "Findings",
  finding: "Finding detail",
  evidence: "Supporting records",
  "evidence-detail": "Supporting record detail",
  decision: "Decision comparison",
  release: "Reviews and release",
  help: "Help and glossary",
};

export const stateLabels: Record<RunDocument["state"], string> = {
  DRAFT: "Setup in progress",
  RESOLVING_TARGET: "Preparing a safe copy",
  READY: "Ready to begin",
  EXECUTING: "Assessment in progress",
  WAITING_INPUT: "Input is needed",
  PAUSING: "Pausing safely",
  PAUSED: "Paused",
  RECOVERABLE_FAILURE: "Action is needed to continue",
  VALIDATING: "Checking assessment records",
  REVIEW_REQUIRED: "Review is required",
  PACKAGING: "Preparing the customer package",
  COMPLETED: "Complete",
  CANCELLING: "Stopping and cleaning up",
  CANCELLED: "Stopped",
  FAILED: "Could not complete",
};

export const coverageLabels: Record<CoverageStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  partial: "Partly tested",
  blocked: "Blocked",
  "not applicable": "Not applicable",
  "not tested": "Not tested",
};

export function providerName(provider: LauncherProvider): string {
  return provider === "codex" ? "Codex" : "Claude Code";
}

export function launcherName(provider: LauncherProvider): string {
  return provider === "codex" ? "start-codex.sh" : "start-cc.sh";
}

export function shortId(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 12)}…${value.slice(-6)}`;
}

export function statusTone(status: string): "positive" | "danger" | "caution" | "neutral" {
  if (["pass", "SUCCEEDED", "COMPLETED", "VALIDATED", "available"].includes(status))
    return "positive";
  if (["fail", "FAILED", "invalidated"].includes(status)) return "danger";
  if (
    ["partial", "blocked", "not tested", "WAITING_INPUT", "RETRYABLE_FAILURE", "denied"].includes(
      status,
    )
  )
    return "caution";
  return "neutral";
}

export function coverageSummarySentence(coverage: DomainCoverage[]): string {
  const counts = Object.fromEntries(
    Object.keys(coverageLabels).map((status) => [
      status,
      coverage.filter((item) => item.status === status).length,
    ]),
  ) as Record<CoverageStatus, number>;
  return [
    `All ${coverage.length} required assessment areas are accounted for.`,
    `${counts.pass} passed,`,
    `${counts.fail} failed,`,
    `${counts.partial} were partly tested,`,
    `${counts.blocked} were blocked,`,
    `${counts["not applicable"]} ${counts["not applicable"] === 1 ? "was" : "were"} not applicable,`,
    `and ${counts["not tested"]} ${counts["not tested"] === 1 ? "was" : "were"} not tested.`,
  ].join(" ");
}

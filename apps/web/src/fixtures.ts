import {
  assessmentDomains,
  coverageStatuses,
  phaseKeys,
  type AssessmentDomain,
  type CoverageStatus,
} from "@rak/contracts";
import type {
  AppData,
  CapabilityResult,
  DecisionComparison,
  DomainCoverage,
  EvidenceOccurrence,
  Finding,
  PhaseDocument,
} from "./model.js";

const now = "2026-07-28T14:22:18.000Z";
const digest = `sha256:${"a".repeat(64)}` as const;
const runId = "run_0198f9d4-demo";

const capability = (
  capabilityId: string,
  effective: CapabilityResult["effective"],
  reason: string,
  effects: string[] = [],
): CapabilityResult => ({
  capabilityId,
  scope: "run",
  declaredBy: ["rak-workflow/1.0.0"],
  support: effective === "not-applicable" ? "unsupported" : "supported",
  attestation: effective === "available" ? "passed" : "missing",
  approval: effective === "denied" ? "denied" : effective === "available" ? "approved" : "missing",
  effective,
  reasonCode: effective.toUpperCase().replaceAll("-", "_"),
  reason,
  evidenceOccurrenceIds: effective === "available" ? ["evd_runtime_gate"] : [],
  coverageEffects: effects,
  checkedAt: now,
});

const phases: PhaseDocument[] = phaseKeys.map((phaseKey, index) => ({
  schemaVersion: "1.0.0",
  phaseId: `phs_${String(index + 1).padStart(2, "0")}`,
  runId,
  phaseKey,
  phaseRevision: 1,
  state:
    index < 4 ? "SUCCEEDED" : index === 4 ? "RUNNING" : index === 5 ? "WAITING_INPUT" : "PENDING",
  required: phaseKey !== "dynamic-assessment",
  dependsOn: index === 0 ? [] : [`phs_${String(index).padStart(2, "0")}`],
  limitationIds: phaseKey === "dynamic-assessment" ? ["lim_runtime_isolation"] : [],
}));

const statusByDomain: Partial<Record<AssessmentDomain, CoverageStatus>> = {
  "repository-composition": "pass",
  "stack-detection": "pass",
  "architecture-boundaries": "partial",
  "engineering-maintainability": "pass",
  "features-use-cases": "partial",
  "dependency-inventory": "pass",
  "dependency-vulnerabilities": "pass",
  "secret-detection": "pass",
  sast: "pass",
  "iac-container-license": "not applicable",
  "runtime-readiness": "blocked",
  "dynamic-browser-security": "blocked",
  "security-independent-review": "not tested",
  "modernization-decision": "not tested",
  "evidence-package-integrity": "not tested",
};

const coverage: DomainCoverage[] = assessmentDomains.map((domainId, index) => {
  const status = statusByDomain[domainId] ?? "not tested";
  const counts = Object.fromEntries(
    coverageStatuses.map((item) => [item, item === status ? 1 : 0]),
  ) as Record<CoverageStatus, number>;
  return {
    schemaVersion: "1.0.0",
    coverageId: `cov_${String(index + 1).padStart(2, "0")}`,
    runId,
    domainId,
    status,
    plannedControls: 1,
    reconciledControls: 1,
    counts,
    exclusions:
      status === "not applicable" ? ["No infrastructure-as-code files were identified."] : [],
    unsupportedEcosystems: [],
    limitationIds: ["blocked", "partial", "not tested"].includes(status) ? [`lim_${domainId}`] : [],
    evidenceOccurrenceIds: status === "pass" ? [`evd_${domainId}`] : [],
  };
});

const findings: Finding[] = [
  {
    schemaVersion: "1.0.0",
    findingId: "fnd_session_boundary",
    runId,
    fingerprint: { algorithm: "rak-finding/v1", value: "session-boundary" },
    revision: 1,
    title: "Session boundary depends on an unverified deployment setting",
    description:
      "The application checks session cookies in code, but the current evidence does not establish the production proxy and transport settings.",
    category: "authentication",
    technicalSeverity: "high",
    businessPriority: "high",
    confidence: "medium",
    validationState: "disputed",
    evidenceOccurrenceIds: ["evd_auth_middleware", "evd_runtime_gate"],
    locations: [{ repoRelPath: "src/auth/session.ts", startLine: 41, endLine: 83 }],
    cweMappings: [
      {
        cweId: "CWE-614",
        catalogVersion: "4.20",
        primary: true,
        method: "analyst",
        confidence: "medium",
      },
    ],
    cvss: [],
    remediationTheme: "Confirm deployment settings and make secure cookie behavior explicit.",
  },
  {
    schemaVersion: "1.0.0",
    findingId: "fnd_boundary_strength",
    runId,
    fingerprint: { algorithm: "rak-finding/v1", value: "boundary-strength" },
    revision: 1,
    title: "Service boundaries are clear enough for staged replacement",
    description:
      "Repository structure and dependency direction indicate two separable services, subject to runtime confirmation.",
    category: "architecture",
    technicalSeverity: "informational",
    businessPriority: "medium",
    confidence: "medium",
    validationState: "corroborated",
    evidenceOccurrenceIds: ["evd_architecture_map"],
    locations: [{ repoRelPath: "docs/architecture.md", startLine: 9, endLine: 74 }],
    cweMappings: [],
    cvss: [],
    remediationTheme: "Preserve the service contract while replacing one boundary at a time.",
  },
];

const evidence: EvidenceOccurrence[] = [
  {
    schemaVersion: "1.0.0",
    evidenceId: "evd_auth_middleware",
    runId,
    blobId: "blb_auth",
    evidenceType: "source-location",
    title: "Authentication middleware location",
    snapshotId: "snp_6c388b8272b6d3673f",
    activityId: "act_static_inventory",
    capturedAt: now,
    sourceLocator: { repoRelPath: "src/auth/session.ts", startLine: 41, endLine: 83 },
    sensitivity: "customer-confidential",
    redactionState: "none-required",
    validationState: "validated",
    collectionLimitations: ["Runtime cookie behavior was not observed."],
    derivedFromEvidenceIds: [],
    linkedClaimIds: [],
    linkedFindingIds: ["fnd_session_boundary"],
    linkedControlIds: ["ctl_session_cookie"],
  },
  {
    schemaVersion: "1.0.0",
    evidenceId: "evd_runtime_gate",
    runId,
    blobId: "blb_runtime",
    evidenceType: "capability-result",
    title: "Runtime isolation prerequisite result",
    snapshotId: "snp_6c388b8272b6d3673f",
    activityId: "act_runtime_gate",
    capturedAt: now,
    sensitivity: "public",
    redactionState: "none-required",
    validationState: "validated",
    collectionLimitations: ["Lima is not available on this host."],
    derivedFromEvidenceIds: [],
    linkedClaimIds: [],
    linkedFindingIds: ["fnd_session_boundary"],
    linkedControlIds: ["ctl_runtime_available"],
  },
  {
    schemaVersion: "1.0.0",
    evidenceId: "evd_architecture_map",
    runId,
    blobId: "blb_architecture",
    evidenceType: "escaped-text",
    title: "Observed service boundary map",
    snapshotId: "snp_6c388b8272b6d3673f",
    activityId: "act_architecture",
    capturedAt: now,
    packageRelPath: "evidence/architecture-map.txt",
    sensitivity: "customer-confidential",
    redactionState: "redacted",
    validationState: "validated",
    collectionLimitations: [],
    derivedFromEvidenceIds: [],
    linkedClaimIds: [],
    linkedFindingIds: ["fnd_boundary_strength"],
    linkedControlIds: [],
  },
];

const decision: DecisionComparison = {
  schemaVersion: "1.0.0",
  runId,
  recommendation: {
    kind: "conditional-sequence",
    options: ["remediation", "incremental-replacement"],
  },
  rationale:
    "Current static evidence supports stabilizing the session boundary before replacing the separable account service. Runtime evidence is still missing.",
  confidence: "medium",
  criteria: [
    "recoverability",
    "system-boundaries",
    "security-risk",
    "engineering-risk",
    "critical-feature-parity",
    "expected-scale",
    "rebuild-feasibility",
  ].map((criterion) => ({
    criterion: criterion as DecisionComparison["criteria"][number]["criterion"],
    options: {
      remediation: {
        assessment: "Keeps customer behavior intact while addressing the immediate boundary risk.",
        state: "evidenced",
        confidence: "medium",
        claimIds: [],
        evidenceOccurrenceIds: ["evd_auth_middleware"],
      },
      "incremental-replacement": {
        assessment:
          "Uses the observed service boundary, but needs runtime contract evidence first.",
        state: "evidenced",
        confidence: "medium",
        claimIds: [],
        evidenceOccurrenceIds: ["evd_architecture_map"],
      },
      "full-rebuild": {
        assessment: "Could simplify the system, but feature-parity obligations remain unverified.",
        state: "unverified",
        confidence: "low",
        claimIds: [],
        evidenceOccurrenceIds: [],
      },
    },
  })),
  assumptions: ["The documented service boundary reflects the deployed system."],
  dependencies: ["A safe runtime environment and owner confirmation of parity-critical workflows."],
  reversalConditions: [
    "Runtime evidence shows the boundary cannot be isolated.",
    "Owner discovery identifies high-cost behavior missing from the current trace.",
  ],
};

export const fixtureData: AppData = {
  runAvailable: true,
  decisionAvailable: true,
  system: {
    productVersion: "0.1.0",
    contractProfile: "rak-contract/1.0.0",
    workflowProfile: "rak-workflow/1.0.0",
    exportProfile: "rak-export-profile/1.0.0",
    launcherProvider: "codex",
    hostOs: "linux",
    hostArch: "arm64",
    prerequisites: [
      capability(
        "provider-authentication",
        "available",
        "Codex launcher authentication is available.",
      ),
      capability("host-runtime-isolation", "blocked", "Lima is not installed on this host.", [
        "Live runtime and browser checks are blocked.",
      ]),
      capability("static-analyzers", "available", "Pinned static analyzers are available."),
    ],
  },
  sourceHandles: [
    {
      sourceHandleId: "src_local_customer",
      kind: "local",
      displayName: "Registered customer repository",
      allowedRootFingerprint: digest,
      registeredAt: now,
    },
    {
      sourceHandleId: "src_ssh_deploy",
      kind: "ssh",
      displayName: "Read-only engagement deploy key",
      allowedRootFingerprint: digest,
      registeredAt: now,
    },
  ],
  run: {
    run: {
      schemaVersion: "1.0.0",
      runId,
      projectSlug: "northstar-portal",
      revision: 2,
      rowVersion: 18,
      state: "EXECUTING",
      workflowProfile: "rak-workflow/1.0.0",
      exportProfile: "rak-export-profile/1.0.0",
      provider: "codex",
      targetSnapshotId: "snp_6c388b8272b6d3673f",
      createdAt: "2026-07-28T13:00:00.000Z",
      updatedAt: now,
      limitationIds: ["lim_runtime_isolation"],
    },
    phases,
    currentCapabilities: [
      capability("provider-inference", "available", "Approved through the current Codex launcher."),
      capability("target-code-execution", "denied", "Target-code execution was not approved.", [
        "Dynamic assessment is blocked. Static assessment continues.",
      ]),
      capability("runtime-isolation", "blocked", "A disposable worker VM could not be attested.", [
        "Browser and live-runtime controls are blocked.",
      ]),
    ],
    coverageSummary: coverage,
  },
  events: [
    {
      schemaVersion: "1.0.0",
      sequence: "31",
      runId,
      rowVersion: 16,
      type: "phase.state.changed",
      occurredAt: "2026-07-28T14:18:00.000Z",
      phaseId: "phs_04",
      summary: "Static security and quality checks finished.",
    },
    {
      schemaVersion: "1.0.0",
      sequence: "32",
      runId,
      rowVersion: 18,
      type: "warning.raised",
      occurredAt: now,
      phaseId: "phs_05",
      summary: "Live runtime checks are blocked; static assessment continues.",
    },
  ],
  findings,
  evidence,
  decision,
  packages: [
    {
      packageId: "pkg_demo",
      runId,
      revision: 2,
      state: "FAILED",
      validationReportId: "evd_validation",
    },
  ],
};

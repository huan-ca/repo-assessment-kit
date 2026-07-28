import { createHash } from "node:crypto";
import { posix } from "node:path";

import sanitizeHtml from "sanitize-html";
import {
  assessmentDomains,
  discoveryTopics,
  productClaimSchema,
  runDocumentSchema,
  targetSnapshotSchema,
  type ControlResult,
  type DomainCoverage,
  type EvidenceOccurrence,
  type Finding,
  type ProductClaim,
  type RunDocument,
  type TargetSnapshot,
} from "@rak/contracts";

export const reportFormats = Object.freeze(["markdown", "html", "csv", "sarif", "cyclonedx"]);

export type Confidence = "high" | "medium" | "low";
export type EvidenceState = "evidenced" | "unverified" | "conflicting";
export type CoverageStatus =
  | "pass"
  | "fail"
  | "partial"
  | "blocked"
  | "not applicable"
  | "not tested";
export type DecisionOption = "remediation" | "incremental-replacement" | "full-rebuild";
export type DecisionCriterionName = DecisionCriterion["criterion"];

export type ReportEvidence = EvidenceOccurrence;

export type ReportFinding = Finding & {
  consequence?: string;
  affectedParty?: string;
  nextAction?: string;
  limitations?: string[];
};

export type ReportControl = ControlResult;

export type ReportCoverage = DomainCoverage;

export interface DecisionCriterion {
  criterion:
    | "recoverability"
    | "system-boundaries"
    | "security-risk"
    | "engineering-risk"
    | "critical-feature-parity"
    | "expected-scale"
    | "rebuild-feasibility";
  options: Record<
    DecisionOption,
    {
      assessment: string;
      state: EvidenceState;
      confidence: Confidence;
      claimIds: string[];
      evidenceOccurrenceIds: string[];
    }
  >;
}

export interface ReportDecision {
  schemaVersion: "1.0.0";
  runId: string;
  criteria: DecisionCriterion[];
  recommendation:
    | { kind: "single"; option: DecisionOption }
    | { kind: "conditional-sequence"; options: DecisionOption[] };
  rationale: string;
  confidence: Confidence;
  assumptions: string[];
  dependencies: string[];
  reversalConditions: string[];
}

export interface ReportReview {
  schemaVersion: "1.0.0";
  reviewId: string;
  runId: string;
  kind: "independent-security" | "independent-decision" | "technical-human" | "lay-human";
  reviewerAgentId: string;
  inputDigest: string;
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
  completedAt: string;
}

export interface SecurityProfileGuidance {
  generalBaselineProfileId: string;
  overlayProfileIds: string[];
  deeperProfiles: Array<{
    profileId: string;
    applicability: "recommended-for-confirmation" | "not-recommended";
    triggeringSignals: string[];
    evidenceOccurrenceIds: string[];
    requiresCustomerConfirmation: true;
  }>;
}

export interface ReportEquivalenceCertificate {
  schemaVersion: "1.0.0";
  runId: string;
  requiredSchemasValid: true;
  materialityValid: true;
  sourceIntegrityValid: true;
  controlReconciliationValid: true;
  securityReviewPresent: true;
  decisionReviewPresent: true;
  requiredArtifactsPresent: true;
  redactionValid: true;
  manifestAndZipValid: true;
  prohibitedActionsObserved: false;
  validationReportId: string;
}

export interface ScreenshotRecord {
  screenshotId: string;
  title: string;
  status: "captured" | "unavailable";
  packageRelPath?: string;
  evidenceOccurrenceId?: string;
  unavailableReason?: string;
}

export interface ComponentRecord {
  name: string;
  version?: string;
  packageUrl?: string;
  type?: string;
  dependsOn?: string[];
}

export interface ReportInput {
  run: RunDocument;
  targetSnapshot: TargetSnapshot;
  productClaims: ProductClaim[];
  findings: ReportFinding[];
  controls: ReportControl[];
  coverage: ReportCoverage[];
  evidence: ReportEvidence[];
  decision: ReportDecision;
  reviews: ReportReview[];
  equivalenceCertificate: ReportEquivalenceCertificate;
  components: ComponentRecord[];
  screenshots: ScreenshotRecord[];
  securityProfileGuidance: SecurityProfileGuidance;
  logs?: Array<{ packageRelPath: string; description: string }>;
  scope: string[];
  limitations: Array<{
    limitationId: string;
    description: string;
    effect: string;
    name?: string;
    reason?: string;
    nextAction?: string;
    owner?: string;
  }>;
  principalIssue: string;
  businessConsequence: string;
  generatedAt: string;
  packageIdentityDigest: string;
}

export type ReportNode =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; caption: string; headers: string[]; rows: string[][] }
  | {
      kind: "evidence-links";
      references: Array<{ evidenceId: string; label: string; purpose: string }>;
    }
  | { kind: "package-links"; links: Array<{ path: string; label: string }> };

export interface ReportDocument {
  title: string;
  reportKind: string;
  projectSlug: string;
  sourceScope: string;
  generatedAt: string;
  packageIdentityDigest: string;
  nodes: ReportNode[];
}

export interface ReportFile {
  path: string;
  mediaType: string;
  content: string;
}

export interface GeneratedReportBundle {
  files: ReportFile[];
  documents: Record<
    "executive" | "decision" | "technical" | "security" | "coverage-limitations",
    ReportDocument
  >;
}

export interface ContentGateOptions {
  knownSecrets?: string[];
  forbiddenHostPaths?: string[];
}

const OPTION_LABELS: Record<DecisionOption, string> = {
  remediation: "Remediate the current system",
  "incremental-replacement": "Replace it in controlled stages",
  "full-rebuild": "Build a new system",
};

const CRITERION_LANGUAGE: Record<DecisionCriterionName, { name: string; definition: string }> = {
  recoverability: {
    name: "Recoverability",
    definition: "how much of the current system can be repaired and retained",
  },
  "system-boundaries": {
    name: "Separation between system parts",
    definition: "whether one part can change without unsafe effects on unrelated parts",
  },
  "security-risk": {
    name: "Security concern",
    definition: "how serious and widespread the supported security concerns are",
  },
  "engineering-risk": {
    name: "Change and operating difficulty",
    definition: "how hard the system is to understand, change, test, and operate",
  },
  "critical-feature-parity": {
    name: "Preserving essential behavior",
    definition: "which valuable behavior a replacement must keep",
  },
  "expected-scale": {
    name: "Expected demand",
    definition: "whether the option can support confirmed future usage",
  },
  "rebuild-feasibility": {
    name: "Practicality of building anew",
    definition:
      "whether a new system can be delivered without unacceptable discovery, transition, or business risk",
  },
};

const DOMAIN_LANGUAGE: Record<string, { name: string; purpose: string }> = {
  "repository-composition": {
    name: "Repository contents",
    purpose: "identifies the files and major source areas that were inspected",
  },
  "stack-detection": {
    name: "Technology identification",
    purpose: "identifies languages, frameworks, and build systems",
  },
  "architecture-boundaries": {
    name: "Separation between system parts",
    purpose: "checks whether parts can change without unsafe effects elsewhere",
  },
  "engineering-maintainability": {
    name: "Ease of safe change",
    purpose: "examines how understandable, testable, and maintainable the code is",
  },
  "features-use-cases": {
    name: "Features and user workflows",
    purpose: "traces valuable behavior to implementation evidence",
  },
  "dependency-inventory": {
    name: "Third-party component inventory",
    purpose: "records external software components",
  },
  "dependency-vulnerabilities": {
    name: "Known component weaknesses",
    purpose: "checks dependencies against available vulnerability information",
  },
  "secret-detection": {
    name: "Credential and secret detection",
    purpose: "looks for exposed credential-like material using the recorded techniques",
  },
  sast: {
    name: "Static code security checks",
    purpose: "looks for security-relevant code patterns without running the application",
  },
  "iac-container-license": {
    name: "Infrastructure, container, and license checks",
    purpose: "examines deployment definitions, images, and dependency licenses",
  },
  "runtime-readiness": {
    name: "Readiness for safe runtime testing",
    purpose: "checks whether the application can be exercised within approved safeguards",
  },
  "dynamic-browser-security": {
    name: "Browser and running-application checks",
    purpose: "tests approved behavior in a controlled running environment",
  },
  "security-independent-review": {
    name: "Independent security review",
    purpose: "checks material security conclusions through a separate review",
  },
  "modernization-decision": {
    name: "Modernization option comparison",
    purpose: "compares repair, staged replacement, and rebuilding",
  },
  "evidence-package-integrity": {
    name: "Evidence and package integrity",
    purpose: "checks that report inputs and packaged outputs reconcile",
  },
};

export const REPORT_RENDERER_CSS =
  "body{font-family:system-ui,sans-serif;line-height:1.5;max-width:72rem;margin:2rem auto;padding:0 1rem;color:#17202a}h1,h2,h3{line-height:1.2}table{border-collapse:collapse;width:100%}th,td{border:1px solid #adb5bd;padding:.5rem;text-align:left;vertical-align:top}caption{font-weight:700;text-align:left;margin:.5rem 0}code{background:#f1f3f5;padding:.1rem .25rem}a{color:#174ea6}.skip-link{display:block;font-weight:700}aside{border-left:.25rem solid #6c757d;padding-left:1rem}";
export const REPORT_RENDERER_CSS_SHA256 = createHash("sha256")
  .update(REPORT_RENDERER_CSS)
  .digest("base64");
const REPORT_HTML_SANITIZE_OPTIONS = {
  allowedTags: [
    "html",
    "head",
    "meta",
    "title",
    "style",
    "body",
    "a",
    "header",
    "p",
    "nav",
    "h1",
    "h2",
    "h3",
    "ul",
    "li",
    "aside",
    "main",
    "footer",
    "table",
    "caption",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "code",
  ],
  allowedAttributes: {
    html: ["lang"],
    meta: ["charset", "http-equiv", "content", "name"],
    a: ["class", "href"],
    nav: ["aria-label"],
    main: ["id"],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    th: ["scope"],
  },
  allowedSchemes: [] as string[],
  allowProtocolRelative: false,
  allowVulnerableTags: true,
};
const PLACEHOLDER_PATTERN =
  /\b(?:TODO|TBD|FIXME|CHANGEME|PLACEHOLDER|COMING\s+SOON|XXX|INSERT\s+(?:TEXT|CONTENT|HERE)|LOREM\s+IPSUM|YOUR\s+(?:COMPANY|PROJECT|NAME))\b/i;
const HOST_PATH_PATTERN =
  /(?:^|[\s"'(])(?:\/(?:Users|home|workspace|tmp|var\/folders|etc)\/[^\s"'<>]+|[A-Za-z]:\\(?:Users|Documents and Settings|Windows)\\[^\s"'<>]+)/m;
const COMPLIANCE_CLAIM_PATTERN =
  /\b(?:fully compliant|guaranteed compliant|meets all regulatory requirements|(?:is|are|was|were|achieved|provides?)\s+(?!not\b)(?:[A-Za-z -]+\s+)?(?:certified|certification|compliant))\b/i;
const SECRET_PATTERN =
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|-----BEGIN (?:OPENSSH|RSA|EC|DSA|ENCRYPTED)? ?PRIVATE KEY-----|(?:aws_secret_access_key|client_secret|private_key)\s*[:=]\s*["']?[A-Za-z0-9/+_=.-]{16,}/i;
const REQUIRED_DECISION_CRITERIA = [
  "recoverability",
  "system-boundaries",
  "security-risk",
  "engineering-risk",
  "critical-feature-parity",
  "expected-scale",
  "rebuild-feasibility",
] as const satisfies readonly DecisionCriterionName[];

function assertText(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty`);
}

function recommendationText(decision: ReportDecision): string {
  return decision.recommendation.kind === "single"
    ? OPTION_LABELS[decision.recommendation.option]
    : decision.recommendation.options.map((option) => OPTION_LABELS[option]).join(", then ");
}

function evidenceStateText(state: EvidenceState): string {
  if (state === "evidenced") return "Supported by collected evidence";
  if (state === "conflicting") return "Available information conflicts";
  return "Not yet verified";
}

function evidenceLinks(input: ReportInput, ids: string[], purpose: string): ReportNode {
  const byId = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  return {
    kind: "evidence-links",
    references: [...new Set(ids)].sort(compareUtf8).map((evidenceId) => {
      const item = byId.get(evidenceId);
      const locator =
        item?.packageRelPath ??
        item?.sourceLocator?.repoRelPath ??
        item?.externalLocator ??
        "packaged evidence index";
      return {
        evidenceId,
        label:
          item === undefined
            ? `Supporting record at ${locator}`
            : `${item.title} — ${humanize(item.evidenceType)} at ${locator}`,
        purpose,
      };
    }),
  };
}

function evidencePurpose(input: ReportInput, evidenceId: string): string {
  const finding = input.findings.find(({ evidenceOccurrenceIds }) =>
    evidenceOccurrenceIds.includes(evidenceId),
  );
  if (finding !== undefined) return `supports the reported finding “${finding.title}”`;
  const claim = input.productClaims.find(({ evidenceOccurrenceIds }) =>
    evidenceOccurrenceIds.includes(evidenceId),
  );
  if (claim !== undefined) return `supports the discovery topic “${humanize(claim.topic)}”`;
  const control = input.controls.find(({ evidenceOccurrenceIds }) =>
    evidenceOccurrenceIds.includes(evidenceId),
  );
  if (control !== undefined) return `supports the ${control.controlId} control result`;
  return "provides traceable support for the assessment";
}

function evidenceSummary(input: ReportInput, ids: string[], purpose: string): string {
  const byId = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  const summaries = [...new Set(ids)].sort(compareUtf8).map((id) => {
    const item = byId.get(id);
    return item === undefined
      ? `Supporting record in the packaged evidence index; ${purpose}`
      : `${item.title} at ${
          item.packageRelPath ?? item.sourceLocator?.repoRelPath ?? "the packaged evidence index"
        }; ${purpose}`;
  });
  return summaries.join("; ") || "No supporting record was linked.";
}

function plainLanguage(text: string): string {
  return text
    .replace(
      /\bobserved boundary\b/gi,
      "part of the system that the recorded evidence shows can be changed separately",
    )
    .replace(/\bsystem boundaries\b/gi, "separation between parts of the system")
    .replace(
      /\bcritical feature parity\b/gi,
      "preserving the valuable behavior that a replacement must keep",
    )
    .replace(
      /\brebuild feasibility\b/gi,
      "whether building a new system is practical without unacceptable transition risk",
    )
    .replace(/\bboundaries\b/gi, "separation between system parts");
}

function documentMetadata(
  input: ReportInput,
  title: string,
  reportKind: string,
): Omit<ReportDocument, "nodes"> {
  return {
    title,
    reportKind,
    projectSlug: input.run.projectSlug,
    sourceScope: input.targetSnapshot.commitSha,
    generatedAt: input.generatedAt,
    packageIdentityDigest: input.packageIdentityDigest,
  };
}

function buildExecutive(input: ReportInput): ReportDocument {
  const materialFindings = input.findings.filter(
    ({ validationState }) => validationState !== "disputed" && validationState !== "invalidated",
  );
  const unknownCriteria = input.decision.criteria.flatMap(({ criterion, options }) =>
    Object.values(options).some(({ state }) => state !== "evidenced") ? [criterion] : [],
  );
  const discoveryUnknowns = input.productClaims.flatMap((claim) =>
    claim.unknown === undefined ? [] : [{ topic: claim.topic, ...claim.unknown }],
  );
  const nonPassCoverage = input.coverage.filter(({ status }) => status !== "pass");
  const hasMaterialUnknown =
    input.limitations.length + unknownCriteria.length + discoveryUnknowns.length > 0 ||
    nonPassCoverage.length > 0;
  const recommendation =
    materialFindings.length === 0
      ? `Conditional planning direction: ${recommendationText(input.decision)}. No admitted finding establishes an urgent verified risk, so the owner should confirm the missing facts before authorizing corrective or replacement work.`
      : `Recommended path: ${recommendationText(input.decision)}. ${plainLanguage(input.decision.rationale)}`;
  const ownerAction =
    materialFindings.length === 0 || hasMaterialUnknown
      ? "Software owner decision: assign an owner and due date for the listed evidence gaps, then decide whether the available evidence is sufficient to authorize the next modernization step."
      : `Software owner decision: confirm whether to authorize ${recommendationText(input.decision).toLowerCase()} and name the accountable delivery owner.`;
  const recoverability = input.decision.criteria.find(
    ({ criterion }) => criterion === "recoverability",
  );
  const strengths = [
    ...(recoverability === undefined
      ? []
      : Object.entries(recoverability.options)
          .filter(([, option]) => option.state === "evidenced")
          .map(
            ([option, value]) =>
              `${OPTION_LABELS[option as DecisionOption]} — ${plainLanguage(value.assessment)}`,
          )),
    ...input.coverage
      .filter(({ status }) => status === "pass")
      .slice(0, 3)
      .map(({ domainId }) => {
        const language = domainLanguage(domainId);
        return `${language.name}: the recorded controls passed for the stated scope. This ${language.purpose}; it is not a guarantee beyond that scope.`;
      }),
  ];
  const evidenceIds = [
    ...input.decision.criteria.flatMap(({ options }) =>
      Object.values(options).flatMap(({ evidenceOccurrenceIds }) => evidenceOccurrenceIds),
    ),
    ...materialFindings.flatMap(({ evidenceOccurrenceIds }) => evidenceOccurrenceIds),
  ];
  return {
    ...documentMetadata(input, "Executive assessment", "Executive"),
    nodes: [
      { kind: "heading", level: 1, text: "Executive assessment" },
      { kind: "heading", level: 2, text: "Decision at a glance" },
      { kind: "paragraph", text: recommendation },
      {
        kind: "paragraph",
        text: `Confidence is ${input.decision.confidence}. Confidence describes the strength and completeness of current evidence, not certainty about future results.`,
      },
      { kind: "heading", level: 2, text: "What we assessed" },
      {
        kind: "paragraph",
        text: `${input.run.projectSlug} at source revision ${input.targetSnapshot.commitSha}. ${input.scope.join(" ")}`,
      },
      { kind: "heading", level: 2, text: "Principal issues and owner actions" },
      {
        kind: "table",
        caption: "Supported issues, consequences, and next steps",
        headers: [
          "Issue",
          "Affected people or system",
          "Business consequence",
          "Next action",
          "Evidence strength and limit",
        ],
        rows:
          materialFindings.length === 0
            ? [
                [
                  "No admitted finding",
                  "No affected party was established by an admitted finding.",
                  "No verified impact was established. This does not prove that no issue exists.",
                  "Resolve the material unknowns and incomplete coverage before authorizing risk-driven remediation.",
                  "Current evidence did not establish a finding; recorded limits still apply.",
                ],
              ]
            : materialFindings.map((finding) => [
                finding.title,
                finding.affectedParty ?? "Affected party was not recorded.",
                finding.consequence ?? finding.description,
                finding.nextAction ??
                  finding.remediationTheme ??
                  "Software owner: assign an accountable follow-up.",
                `${finding.validationState}; ${finding.confidence} confidence. ${
                  finding.limitations?.join("; ") || "No finding-specific limit was recorded."
                }`,
              ]),
      },
      ...materialFindings.map((finding) =>
        evidenceLinks(
          input,
          finding.evidenceOccurrenceIds,
          `supports the reported issue “${finding.title}”`,
        ),
      ),
      { kind: "heading", level: 2, text: "Evidenced strengths and recoverability" },
      {
        kind: "list",
        items: nonEmptyList(
          strengths,
          "No evidenced strength or recoverability conclusion was recorded; treat recoverability as unknown.",
        ),
      },
      { kind: "heading", level: 2, text: "Three paths considered on equal terms" },
      {
        kind: "table",
        caption: "Summary of each modernization path",
        headers: ["Path", "Current evidence summary", "Evidence state"],
        rows: (["remediation", "incremental-replacement", "full-rebuild"] as const).map(
          (option) => {
            const assessments = input.decision.criteria.map(({ options }) => options[option]);
            const supported = assessments.filter(({ state }) => state === "evidenced").length;
            return [
              OPTION_LABELS[option],
              plainLanguage(
                [...new Set(assessments.map(({ assessment }) => assessment))].join(" "),
              ),
              `${supported} of ${assessments.length} decision factors are supported by collected evidence.`,
            ];
          },
        ),
      },
      { kind: "heading", level: 2, text: "Important unknowns and limits" },
      {
        kind: "list",
        items:
          input.limitations.length +
            unknownCriteria.length +
            discoveryUnknowns.length +
            nonPassCoverage.length ===
          0
            ? ["No material unknown was recorded in the supplied assessment data."]
            : [
                ...input.limitations.map(formatLimitation),
                ...discoveryUnknowns.map(
                  ({ topic, reason, confidenceEffect, coverageEffect, followUp }) =>
                    `${humanize(topic)} is unknown because ${reason} Confidence effect: ${confidenceEffect} Coverage effect: ${coverageEffect} Software owner follow-up: ${followUp}`,
                ),
                ...unknownCriteria.map((criterion) => {
                  const language = CRITERION_LANGUAGE[criterion];
                  return `${language.name} (${language.definition}) includes information that is not fully verified. Effect: confidence in the option comparison is lower. Software owner follow-up: provide or confirm the missing decision evidence.`;
                }),
                ...nonPassCoverage.map((coverage) => formatCoverageGap(input, coverage)),
              ],
      },
      { kind: "heading", level: 2, text: "What could change the recommendation" },
      {
        kind: "list",
        items: nonEmptyList(
          input.decision.reversalConditions.map(plainLanguage),
          "No specific reversal condition was recorded; the owner should define one before authorization.",
        ),
      },
      { kind: "heading", level: 2, text: "Next owner decision" },
      { kind: "paragraph", text: ownerAction },
      { kind: "heading", level: 2, text: "Evidence behind this summary" },
      evidenceLinks(input, evidenceIds, "supports the executive decision summary"),
    ],
  };
}

function buildDecision(input: ReportInput): ReportDocument {
  const nodes: ReportNode[] = [
    { kind: "heading", level: 1, text: "Modernization decision comparison" },
    {
      kind: "paragraph",
      text: `Recommendation: ${recommendationText(input.decision)}. Confidence: ${input.decision.confidence}.`,
    },
    {
      kind: "table",
      caption: "Equal comparison of the three modernization options",
      headers: [
        "Decision factor",
        "Repair current system",
        "Replace in stages",
        "Build new system",
      ],
      rows: input.decision.criteria.map(({ criterion, options }) => [
        `${CRITERION_LANGUAGE[criterion].name}: ${CRITERION_LANGUAGE[criterion].definition}.`,
        optionCell(options.remediation),
        optionCell(options["incremental-replacement"]),
        optionCell(options["full-rebuild"]),
      ]),
    },
    { kind: "heading", level: 2, text: "Why this path is recommended" },
    { kind: "paragraph", text: plainLanguage(input.decision.rationale) },
    { kind: "heading", level: 2, text: "Assumptions" },
    {
      kind: "list",
      items: nonEmptyList(
        input.decision.assumptions.map(plainLanguage),
        "No additional assumption recorded.",
      ),
    },
    { kind: "heading", level: 2, text: "Dependencies" },
    {
      kind: "list",
      items: nonEmptyList(
        input.decision.dependencies.map(plainLanguage),
        "No additional dependency recorded.",
      ),
    },
    { kind: "heading", level: 2, text: "What could change the recommendation" },
    {
      kind: "list",
      items: nonEmptyList(
        input.decision.reversalConditions.map(plainLanguage),
        "No specific reversal condition was recorded.",
      ),
    },
  ];
  for (const criterion of input.decision.criteria) {
    nodes.push(
      {
        kind: "heading",
        level: 3,
        text: `${CRITERION_LANGUAGE[criterion.criterion].name} supporting records`,
      },
      evidenceLinks(
        input,
        Object.values(criterion.options).flatMap(
          ({ evidenceOccurrenceIds }) => evidenceOccurrenceIds,
        ),
        `supports the ${CRITERION_LANGUAGE[criterion.criterion].name.toLowerCase()} comparison`,
      ),
    );
  }
  return {
    ...documentMetadata(input, "Modernization decision comparison", "Decision"),
    nodes,
  };
}

function optionCell(option: DecisionCriterion["options"][DecisionOption]): string {
  return `${plainLanguage(option.assessment)} Evidence state: ${evidenceStateText(option.state)}. Confidence: ${option.confidence}.`;
}

function domainLanguage(domainId: string): { name: string; purpose: string } {
  return (
    DOMAIN_LANGUAGE[domainId] ?? {
      name: humanize(domainId),
      purpose: "records the stated assessment coverage",
    }
  );
}

function coverageStatusEffect(status: CoverageStatus): string {
  if (status === "pass")
    return "The recorded controls support a positive conclusion only for their stated scope.";
  if (status === "fail") return "A supported concern requires review and an accountable response.";
  if (status === "partial")
    return "Only part of this area was assessed, so conclusions remain incomplete.";
  if (status === "blocked")
    return "The planned checks could not run, so no runtime or unobserved behavior should be inferred.";
  if (status === "not applicable")
    return "This area was treated as outside the confirmed scope; applicability must be revisited if scope changes.";
  return "No conclusion is available because the planned checks did not run.";
}

function coverageNextAction(status: CoverageStatus): string {
  if (status === "pass")
    return "Assessment owner: retain the supporting record and reassess when scope changes.";
  if (status === "fail")
    return "Software owner: assign the concern, choose a response, and record verification evidence.";
  if (status === "not applicable")
    return "Software owner: confirm that the exclusion remains correct for the intended use.";
  return "Software owner: remove the stated blocker or approve another evidence source, then rerun the affected checks.";
}

function formatCoverageGap(input: ReportInput, coverage: ReportCoverage): string {
  const language = domainLanguage(coverage.domainId);
  const limitations = coverageLimitations(input, coverage);
  const reason =
    coverage.exclusions.join("; ") ||
    coverage.unsupportedEcosystems.join("; ") ||
    limitations.map(({ reason }) => reason).join(" ") ||
    `The recorded result is ${coverage.status}.`;
  return `${language.name} (${language.purpose}). Reason: ${reason} Effect: ${coverageStatusEffect(
    coverage.status,
  )} ${limitations.map(({ effect }) => effect).join(" ")} Next action: ${
    limitations
      .map(
        ({ owner, nextAction }) =>
          `${owner ?? "Software owner"}: ${
            nextAction ?? "provide the missing information and rerun the affected checks"
          }.`,
      )
      .join(" ") || coverageNextAction(coverage.status)
  }`;
}

function coverageLimitations(
  input: ReportInput,
  coverage: ReportCoverage,
): ReportInput["limitations"] {
  const byId = new Map(input.limitations.map((item) => [item.limitationId, item]));
  return coverage.limitationIds.map((limitationId) => {
    const limitation = byId.get(limitationId);
    if (limitation === undefined)
      throw new Error(
        `Coverage for ${coverage.domainId} references missing limitation ${limitationId}`,
      );
    return limitation;
  });
}

function formatLimitation(limitation: ReportInput["limitations"][number]): string {
  const name = limitation.name ?? limitation.description.replace(/[.:;]+$/u, "");
  const reason = limitation.reason ?? limitation.description;
  const owner = limitation.owner ?? "Software owner";
  const nextAction =
    limitation.nextAction ??
    "provide or approve the missing information, then rerun the affected checks";
  return `${name} (recorded limitation reference ${limitation.limitationId}). Reason: ${reason} Effect: ${limitation.effect} Next action: ${owner}: ${nextAction}.`;
}

function buildTechnical(input: ReportInput): ReportDocument {
  const findingRows = input.findings.map((finding) => [
    finding.findingId,
    finding.title,
    finding.technicalSeverity,
    finding.businessPriority,
    finding.confidence,
    finding.validationState,
    finding.locations.map(formatLocation).join("; ") || "No source location recorded",
  ]);
  return {
    ...documentMetadata(input, "Technical assessment", "Technical"),
    nodes: [
      { kind: "heading", level: 1, text: "Technical assessment" },
      { kind: "paragraph", text: `Assessment snapshot: ${input.targetSnapshot.snapshotId}.` },
      { kind: "heading", level: 2, text: "Assessment scope" },
      { kind: "list", items: nonEmptyList(input.scope, "No scope statement was supplied.") },
      { kind: "heading", level: 2, text: "Findings" },
      {
        kind: "table",
        caption: "Technical finding index",
        headers: [
          "ID",
          "Finding",
          "Technical severity",
          "Business priority",
          "Confidence",
          "Validation",
          "Location",
        ],
        rows:
          findingRows.length === 0
            ? [["None", "No findings were admitted.", "—", "—", "—", "—", "—"]]
            : findingRows,
      },
      ...input.findings.flatMap((finding): ReportNode[] => [
        { kind: "heading", level: 3, text: `${finding.findingId}: ${finding.title}` },
        { kind: "paragraph", text: finding.description },
        {
          kind: "paragraph",
          text: `Remediation theme: ${finding.remediationTheme ?? "No remediation theme recorded."}`,
        },
        evidenceLinks(
          input,
          finding.evidenceOccurrenceIds,
          `supports the technical finding “${finding.title}”`,
        ),
      ]),
      { kind: "heading", level: 2, text: "Evidence index" },
      {
        kind: "table",
        caption: "Evidence index",
        headers: ["Supporting record", "Purpose", "Type", "Validation", "Location", "Limitations"],
        rows: input.evidence.map((item) => [
          `${item.title} — ${item.packageRelPath ?? item.sourceLocator?.repoRelPath ?? "packaged evidence index"}`,
          evidencePurpose(input, item.evidenceId),
          item.evidenceType,
          item.validationState,
          item.packageRelPath ?? item.sourceLocator?.repoRelPath ?? "External or excluded",
          item.collectionLimitations.join("; ") || "None recorded",
        ]),
      },
    ],
  };
}

function buildSecurity(input: ReportInput): ReportDocument {
  const securityFindings = input.findings.filter(({ category }) =>
    /security|credential|authentication|authorization|injection|crypt/i.test(category),
  );
  const securityControls = input.controls.filter(({ profileId }) =>
    /baseline|asvs|wstg|security|owasp/i.test(profileId),
  );
  return {
    ...documentMetadata(input, "Security assessment", "Security"),
    nodes: [
      { kind: "heading", level: 1, text: "Security assessment" },
      {
        kind: "paragraph",
        text: "This report describes technical coverage against the selected security profiles. It is not a legal opinion, certification, or statement of regulatory compliance.",
      },
      { kind: "heading", level: 2, text: "Security findings" },
      {
        kind: "table",
        caption: "Security findings and customer actions",
        headers: [
          "ID",
          "Finding",
          "Severity",
          "Evidence strength",
          "Business consequence",
          "Next action",
          "Limits",
        ],
        rows:
          securityFindings.length === 0
            ? [
                [
                  "None",
                  "No security finding was admitted.",
                  "—",
                  "—",
                  "—",
                  "—",
                  "Review recorded coverage limits.",
                ],
              ]
            : securityFindings.map((finding) => [
                finding.findingId,
                finding.title,
                finding.technicalSeverity,
                `${finding.validationState}; ${finding.confidence} confidence`,
                finding.consequence ?? finding.description,
                finding.nextAction ??
                  finding.remediationTheme ??
                  "Confirm an accountable next step.",
                finding.limitations?.join("; ") ?? "None recorded",
              ]),
      },
      ...securityFindings.map((finding) =>
        evidenceLinks(
          input,
          finding.evidenceOccurrenceIds,
          `supports the security finding “${finding.title}”`,
        ),
      ),
      { kind: "heading", level: 2, text: "Security control coverage" },
      {
        kind: "table",
        caption: "General baseline and selected security profile coverage",
        headers: ["Profile", "Control", "Result", "Reason", "Evidence"],
        rows:
          securityControls.length === 0
            ? [
                [
                  "General baseline",
                  "Inventory unavailable",
                  "not tested",
                  "No security control results were supplied.",
                  "None",
                ],
              ]
            : securityControls.map((control) => [
                control.profileId,
                control.controlId,
                control.status,
                control.reason ??
                  (control.status === "pass"
                    ? "Verified by the recorded evidence."
                    : "No reason recorded"),
                evidenceSummary(
                  input,
                  control.evidenceOccurrenceIds,
                  `supports the ${control.controlId} control result`,
                ),
              ]),
      },
      { kind: "heading", level: 2, text: "Deeper profile guidance" },
      {
        kind: "table",
        caption: "Profiles that may need customer confirmation",
        headers: ["Profile", "Applicability", "Triggering signals", "Customer confirmation"],
        rows:
          input.securityProfileGuidance.deeperProfiles.length === 0
            ? [
                [
                  "No deeper profile recommended",
                  "not-recommended",
                  "No triggering signal was recorded.",
                  "Any future applicability still requires customer confirmation.",
                ],
              ]
            : input.securityProfileGuidance.deeperProfiles.map((profile) => [
                profile.profileId,
                profile.applicability,
                profile.triggeringSignals.join("; "),
                profile.requiresCustomerConfirmation
                  ? "Required before treating the profile as applicable."
                  : "Missing required confirmation state.",
              ]),
      },
    ],
  };
}

function buildCoverage(input: ReportInput): ReportDocument {
  return {
    ...documentMetadata(input, "Coverage and limitations", "Coverage and limitations"),
    nodes: [
      { kind: "heading", level: 1, text: "Coverage and limitations" },
      {
        kind: "paragraph",
        text: "A blocked or untested check is not a pass. Static assessment results remain useful when a safe runtime is unavailable, but runtime conclusions are limited.",
      },
      { kind: "heading", level: 2, text: "Assessment coverage" },
      {
        kind: "table",
        caption: "Coverage status for every required assessment domain",
        headers: [
          "Coverage area",
          "Purpose",
          "Overall result",
          "Reason",
          "Effect",
          "Next action",
          "Reconciled controls",
        ],
        rows: input.coverage.map((coverage) => {
          const language = domainLanguage(coverage.domainId);
          const limitations = coverageLimitations(input, coverage);
          return [
            language.name,
            language.purpose,
            coverage.status,
            coverage.exclusions.join("; ") ||
              coverage.unsupportedEcosystems.join("; ") ||
              limitations
                .map(
                  ({ name, reason, description }) =>
                    `${name ?? description}: ${reason ?? description}`,
                )
                .join(" ") ||
              (coverage.status === "pass"
                ? "The planned controls reconciled with recorded results."
                : "No concrete limitation reason was recorded."),
            `${coverageStatusEffect(coverage.status)} ${limitations
              .map(({ effect }) => effect)
              .join(" ")}`.trim(),
            limitations
              .map(
                ({ owner, nextAction }) =>
                  `${owner ?? "Software owner"}: ${
                    nextAction ?? "provide the missing information and rerun the affected checks"
                  }.`,
              )
              .join(" ") || coverageNextAction(coverage.status),
            `${coverage.reconciledControls} of ${coverage.plannedControls}; ${Object.entries(
              coverage.counts,
            )
              .map(([status, count]) => `${status}: ${count}`)
              .join("; ")}`,
          ];
        }),
      },
      { kind: "heading", level: 2, text: "Recorded limitations" },
      {
        kind: "table",
        caption: "Limitations and their effect on conclusions",
        headers: ["Limitation name", "Reason", "Effect", "Next action"],
        rows:
          input.limitations.length === 0
            ? [
                [
                  "No recorded limitation",
                  "No limitation was supplied.",
                  "No additional coverage effect was recorded.",
                  "Assessment owner: confirm this remains accurate before release.",
                ],
              ]
            : input.limitations.map((limitation) => [
                `${limitation.name ?? limitation.description.replace(/[.:;]+$/u, "")} (reference ${limitation.limitationId})`,
                limitation.reason ?? limitation.description,
                limitation.effect,
                `${limitation.owner ?? "Software owner"}: ${
                  limitation.nextAction ??
                  "provide or approve the missing information, then rerun the affected checks"
                }.`,
              ]),
      },
      { kind: "heading", level: 2, text: "Discovery unknowns" },
      {
        kind: "table",
        caption: "Unknown product facts and their decision effect",
        headers: [
          "Product question",
          "Why unknown",
          "Confidence effect",
          "Coverage effect",
          "Owner and follow-up",
        ],
        rows: discoveryUnknownRows(input),
      },
      { kind: "heading", level: 2, text: "Screenshot inventory" },
      {
        kind: "table",
        caption: "Captured and unavailable screenshots",
        headers: ["ID", "Description", "Status", "File or unavailable reason", "Evidence"],
        rows: screenshotRows(input),
      },
    ],
  };
}

function discoveryUnknownRows(input: ReportInput): string[][] {
  const unknowns = input.productClaims.flatMap((claim) =>
    claim.unknown === undefined ? [] : [{ topic: claim.topic, ...claim.unknown }],
  );
  return unknowns.length === 0
    ? [
        [
          "No discovery topic is marked unknown",
          "Every required topic has a recorded statement.",
          "No additional confidence reduction was recorded from discovery.",
          "No additional coverage reduction was recorded from discovery.",
          "Software owner: keep the statements current when product facts change.",
        ],
      ]
    : unknowns.map(({ topic, reason, confidenceEffect, coverageEffect, followUp }) => [
        humanize(topic),
        reason,
        confidenceEffect,
        coverageEffect,
        `Software owner: ${followUp}`,
      ]);
}

function screenshotRows(input: ReportInput): string[][] {
  const { screenshots } = input;
  if (screenshots.length === 0) {
    return [
      [
        "screenshots-none",
        "Runtime screenshots",
        "unavailable",
        "No screenshot inventory was supplied; screenshot coverage is unavailable.",
        "None",
      ],
    ];
  }
  return screenshots.map((item) => [
    item.screenshotId,
    item.title,
    item.status,
    item.status === "captured"
      ? (item.packageRelPath ?? "Captured file path is missing")
      : (item.unavailableReason ?? "Unavailable reason is missing"),
    item.evidenceOccurrenceId === undefined
      ? "No supporting record was linked."
      : evidenceSummary(input, [item.evidenceOccurrenceId], "supports this screenshot record"),
  ]);
}

export function generateReportBundle(
  input: ReportInput,
  gateOptions: ContentGateOptions = {},
): GeneratedReportBundle {
  validateReportInput(input);
  const documents = {
    executive: buildExecutive(input),
    decision: buildDecision(input),
    technical: buildTechnical(input),
    security: buildSecurity(input),
    "coverage-limitations": buildCoverage(input),
  };
  const declaredPaths = new Set([
    "data/evidence-index.json",
    ...input.evidence.flatMap(({ packageRelPath }) =>
      packageRelPath === undefined ? [] : [packageRelPath],
    ),
    ...input.screenshots.flatMap(({ packageRelPath }) =>
      packageRelPath === undefined ? [] : [packageRelPath],
    ),
  ]);
  const files: ReportFile[] = [];
  for (const [kind, document] of Object.entries(documents)) {
    files.push({
      path: `reports/${kind}.md`,
      mediaType: "text/markdown; charset=utf-8",
      content: renderMarkdown(document, declaredPaths),
    });
    files.push({
      path: `reports/${kind}.html`,
      mediaType: "text/html; charset=utf-8",
      content: renderHtml(document, declaredPaths),
    });
  }
  files.push({
    path: "index.html",
    mediaType: "text/html; charset=utf-8",
    content: renderIndexHtml(input),
  });
  files.push(...generateMachineReadableFiles(input));
  validateMachineReadableFiles(files, input);
  for (const file of files) {
    validateCustomerContent(file.path, file.content, gateOptions);
    if (file.path.endsWith(".html")) validateStaticHtml(file.path, file.content, true);
  }
  return { files, documents };
}

function renderIndexHtml(input: ReportInput): string {
  return renderHtml(
    {
      ...documentMetadata(input, "Repository assessment package", "Package index"),
      nodes: [
        { kind: "heading", level: 1, text: "Repository assessment package" },
        {
          kind: "paragraph",
          text: "This package contains customer reports, machine-readable results, supporting evidence, and integrity records for this assessment.",
        },
        {
          kind: "package-links",
          links: [
            {
              path: "reports/executive.html",
              label: "Executive report — conclusion and business impact",
            },
            {
              path: "reports/decision.html",
              label: "Decision report — equal comparison of all three paths",
            },
            {
              path: "reports/technical.html",
              label: "Technical report — architecture, engineering, and evidence details",
            },
            {
              path: "reports/security.html",
              label: "Security report — findings, baseline, and profile guidance",
            },
            {
              path: "reports/coverage-limitations.html",
              label: "Coverage and limitations — what was and was not tested",
            },
          ],
        },
        {
          kind: "paragraph",
          text: "Verify SHA256SUMS and the detached package digest before delivery. Technical coverage is not certification or proof that the product is secure.",
        },
        {
          kind: "paragraph",
          text: "Evidence labels distinguish owner statements, documents, observed behavior, analytics, code inference, unverified information, and conflicting information.",
        },
        {
          kind: "paragraph",
          text: "Only pass is a positive verification. Fail, partial, blocked, not applicable, and not tested each have a different meaning explained in the coverage report.",
        },
      ],
    },
    new Set([
      "reports/executive.html",
      "reports/decision.html",
      "reports/technical.html",
      "reports/security.html",
      "reports/coverage-limitations.html",
    ]),
  );
}

export function renderMarkdown(
  document: ReportDocument,
  declaredPaths = new Set<string>(),
): string {
  const output: string[] = [
    `Project: ${escapeMarkdown(document.projectSlug)}`,
    `Source scope: ${escapeMarkdown(document.sourceScope)}`,
    `Generated: ${escapeMarkdown(document.generatedAt)}`,
    `Report kind: ${escapeMarkdown(document.reportKind)}`,
    `Package identity digest: ${escapeMarkdown(document.packageIdentityDigest)}`,
    "",
    "## How to read this report",
    "",
    "Start with the conclusion, then follow evidence links and review coverage limits before acting.",
    "",
  ];
  for (const node of document.nodes) {
    if (node.kind === "heading")
      output.push(`${"#".repeat(node.level)} ${escapeMarkdown(node.text)}`);
    if (node.kind === "paragraph") output.push(escapeMarkdown(node.text));
    if (node.kind === "list")
      output.push(node.items.map((item) => `- ${escapeMarkdown(item)}`).join("\n"));
    if (node.kind === "table") {
      output.push(
        `Table: ${escapeMarkdown(node.caption)}\n\n| ${node.headers.map(escapeMarkdownCell).join(" | ")} |\n| ${node.headers.map(() => "---").join(" | ")} |\n${node.rows
          .map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`)
          .join("\n")}`,
      );
    }
    if (node.kind === "evidence-links") {
      output.push(
        node.references.length === 0
          ? "No packaged evidence was linked."
          : node.references
              .map(({ evidenceId, label, purpose }) => {
                const packagePath = "data/evidence-index.json";
                const href = `../${packagePath}#${encodeURIComponent(evidenceId)}`;
                return declaredPaths.has(packagePath)
                  ? `- [${escapeMarkdown(label)}](${href}) — ${escapeMarkdown(purpose)}`
                  : `- ${escapeMarkdown(label)} — ${escapeMarkdown(purpose)}; see the packaged evidence index`;
              })
              .join("\n"),
      );
    }
    if (node.kind === "package-links") {
      output.push(
        node.links
          .map(({ path, label }) =>
            declaredPaths.has(path)
              ? `- [${escapeMarkdown(label)}](${path})`
              : `- ${escapeMarkdown(label)}: unavailable`,
          )
          .join("\n"),
      );
    }
    output.push("");
  }
  return `${output.join("\n").trim()}\n`;
}

export function renderHtml(document: ReportDocument, declaredPaths = new Set<string>()): string {
  const headings = document.nodes.filter(
    (node): node is Extract<ReportNode, { kind: "heading" }> =>
      node.kind === "heading" && node.level === 2,
  );
  const body = document.nodes
    .map((node, index) => {
      if (node.kind === "heading")
        return `<h${node.level} id="${headingId(node.text, index)}">${escapeHtml(node.text)}</h${node.level}>`;
      if (node.kind === "paragraph") return `<p>${escapeHtml(node.text)}</p>`;
      if (node.kind === "list")
        return `<ul>${node.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
      if (node.kind === "table")
        return `<table><caption>${escapeHtml(node.caption)}</caption><thead><tr>${node.headers.map((value) => `<th scope="col">${escapeHtml(value)}</th>`).join("")}</tr></thead><tbody>${node.rows
          .map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`;
      if (node.kind === "evidence-links") {
        if (node.references.length === 0) return "<p>No packaged evidence was linked.</p>";
        return `<ul>${node.references
          .map(({ evidenceId, label, purpose }) => {
            const packagePath = "data/evidence-index.json";
            const href = `../${packagePath}#${encodeURIComponent(evidenceId)}`;
            return declaredPaths.has(packagePath)
              ? `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a> — ${escapeHtml(purpose)}</li>`
              : `<li>${escapeHtml(label)} — ${escapeHtml(purpose)}; see the packaged evidence index</li>`;
          })
          .join("")}</ul>`;
      }
      return `<ul>${node.links
        .map(({ path, label }) =>
          declaredPaths.has(path)
            ? `<li><a href="${escapeHtml(path)}">${escapeHtml(label)}</a></li>`
            : `<li>${escapeHtml(label)}: unavailable</li>`,
        )
        .join("")}</ul>`;
    })
    .join("");
  const csp = `default-src 'none'; img-src 'self' data:; style-src 'sha256-${REPORT_RENDERER_CSS_SHA256}'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  const toc = headings
    .map(
      (heading) =>
        `<li><a href="#${headingId(heading.text, document.nodes.indexOf(heading))}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join("");
  const raw = `<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(`${document.projectSlug} — ${document.title}`)}</title><style>${REPORT_RENDERER_CSS}</style></head><body><a class="skip-link" href="#main-content">Skip to main report</a><header><p>Project: ${escapeHtml(document.projectSlug)} · Source scope: ${escapeHtml(document.sourceScope)} · Generated: ${escapeHtml(document.generatedAt)} · Report kind: ${escapeHtml(document.reportKind)} · Package identity digest: ${escapeHtml(document.packageIdentityDigest)}</p><nav aria-label="Report contents"><h2>Contents</h2><ul>${toc}</ul></nav><aside><h2>How to read this report</h2><p>Start with the conclusion, follow descriptive evidence links, and review coverage limits before acting.</p></aside></header><main id="main-content">${body}</main><footer><p>Evidence states distinguish supported, unverified, and conflicting information. Coverage states distinguish pass, fail, partial, blocked, not applicable, and not tested. Technical coverage is not certification, a legal opinion, or proof that the product is secure.</p></footer></body></html>`;
  return `<!doctype html>${sanitizeHtml(raw, REPORT_HTML_SANITIZE_OPTIONS)}\n`;
}

function headingId(text: string, index: number): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `section-${index}-${slug || "untitled"}`;
}

export function generateMachineReadableFiles(input: ReportInput): ReportFile[] {
  const nativeFiles: Array<[string, unknown]> = [
    ["data/run.json", input.run],
    ["data/target-snapshot.json", input.targetSnapshot],
    ["data/product-claims.json", input.productClaims],
    ["data/findings.json", input.findings],
    ["data/controls.json", input.controls],
    ["data/coverage.json", input.coverage],
    ["data/evidence-index.json", input.evidence],
    ["data/decision.json", input.decision],
    ["data/reviews.json", input.reviews],
    ["data/equivalence-certificate.json", input.equivalenceCertificate],
    ["data/screenshots.json", normalizedScreenshotInventory(input.screenshots)],
  ];
  return [
    ...nativeFiles.map(([path, value]) => ({
      path,
      mediaType: "application/json",
      content: stableJson(value),
    })),
    {
      path: "exports/findings.sarif.json",
      mediaType: "application/sarif+json",
      content: stableJson(toSarif(input)),
    },
    {
      path: "exports/sbom.cdx.json",
      mediaType: "application/vnd.cyclonedx+json",
      content: stableJson(toCycloneDx(input)),
    },
    {
      path: "exports/findings.csv",
      mediaType: "text/csv; charset=utf-8",
      content: toFindingsCsv(input.findings),
    },
  ];
}

export function validateMachineReadableFiles(files: ReportFile[], input: ReportInput): void {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const requiredJson = [
    "data/run.json",
    "data/target-snapshot.json",
    "data/product-claims.json",
    "data/findings.json",
    "data/controls.json",
    "data/coverage.json",
    "data/evidence-index.json",
    "data/decision.json",
    "data/reviews.json",
    "data/equivalence-certificate.json",
    "data/screenshots.json",
    "exports/findings.sarif.json",
    "exports/sbom.cdx.json",
  ];
  const parsed = new Map<string, unknown>();
  for (const path of requiredJson) {
    const file = byPath.get(path);
    if (file === undefined) throw new Error(`Machine-readable output is missing: ${path}`);
    try {
      parsed.set(path, JSON.parse(file.content));
    } catch {
      throw new Error(`${path}: invalid JSON`);
    }
  }
  const run = runDocumentSchema.safeParse(parsed.get("data/run.json"));
  if (!run.success) throw new Error("data/run.json failed its offline contract");
  const claims = parsed.get("data/product-claims.json");
  if (
    !Array.isArray(claims) ||
    claims.some((claim) => !productClaimSchema.safeParse(claim).success)
  )
    throw new Error("data/product-claims.json failed its offline contract");
  for (const path of [
    "data/findings.json",
    "data/controls.json",
    "data/coverage.json",
    "data/evidence-index.json",
    "data/reviews.json",
    "data/screenshots.json",
  ]) {
    if (!Array.isArray(parsed.get(path))) throw new Error(`${path}: expected an array`);
  }
  validateSarif(parsed.get("exports/findings.sarif.json"), input);
  validateCycloneDx(parsed.get("exports/sbom.cdx.json"));
  const csv = byPath.get("exports/findings.csv")?.content;
  if (csv === undefined || !csv.startsWith('"finding_id",'))
    throw new Error("Findings CSV header is invalid");
}

export function validateSarif(value: unknown, input: ReportInput): void {
  const root = asRecord(value, "SARIF root");
  if (root["version"] !== "2.1.0") throw new Error("SARIF must declare version 2.1.0");
  if (
    root["$schema"] !==
    "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json"
  )
    throw new Error("SARIF must use the pinned Errata 01 schema");
  const runs = arrayValue(root["runs"], "SARIF runs");
  if (runs.length !== 1) throw new Error("SARIF must contain exactly one run");
  const run = asRecord(runs[0], "SARIF run");
  const tool = asRecord(run["tool"], "SARIF tool");
  const driver = asRecord(tool["driver"], "SARIF driver");
  const rules = arrayValue(driver["rules"], "SARIF rules");
  const results = arrayValue(run["results"], "SARIF results");
  const ruleIds = uniqueRecordStrings(rules, "id", "SARIF rule");
  if (results.length !== input.findings.length)
    throw new Error("SARIF result count does not match native findings");
  const nativeIds = new Set(input.findings.map(({ findingId }) => findingId));
  const evidenceIds = new Set(input.evidence.map(({ evidenceId }) => evidenceId));
  const resultIds = new Set<string>();
  const fingerprints = new Set<string>();
  for (const resultValue of results) {
    const result = asRecord(resultValue, "SARIF result");
    const ruleId = stringValue(result["ruleId"], "SARIF result ruleId");
    if (!ruleIds.has(ruleId) || !nativeIds.has(ruleId) || resultIds.has(ruleId))
      throw new Error(`SARIF result has invalid or duplicate rule ID: ${ruleId}`);
    resultIds.add(ruleId);
    const properties = asRecord(result["properties"], "SARIF result properties");
    if (properties["dev.repo-assessment-kit.findingId"] !== ruleId)
      throw new Error(`SARIF result ${ruleId} is not linked to its native finding`);
    for (const evidenceId of stringArray(
      properties["dev.repo-assessment-kit.evidenceIds"],
      "SARIF evidence IDs",
    )) {
      if (!evidenceIds.has(evidenceId))
        throw new Error(`SARIF result ${ruleId} references missing evidence ${evidenceId}`);
    }
    const partial = asRecord(result["partialFingerprints"], "SARIF fingerprints");
    const fingerprint = stringValue(partial["repoAssessmentKitFinding/v1"], "SARIF fingerprint");
    if (fingerprints.has(fingerprint)) throw new Error("SARIF fingerprints must be unique");
    fingerprints.add(fingerprint);
    for (const locationValue of arrayValue(result["locations"], "SARIF locations")) {
      const location = asRecord(locationValue, "SARIF location");
      const physical = asRecord(location["physicalLocation"], "SARIF physical location");
      const artifact = asRecord(physical["artifactLocation"], "SARIF artifact location");
      const uri = stringValue(artifact["uri"], "SARIF artifact URI");
      if (/^(?:[a-z]+:|\/|\\)/i.test(uri) || uri.includes(".."))
        throw new Error(`SARIF location is not repository-relative: ${uri}`);
    }
  }
}

export function validateCycloneDx(value: unknown): void {
  const root = asRecord(value, "CycloneDX root");
  if (root["bomFormat"] !== "CycloneDX" || root["specVersion"] !== "1.7")
    throw new Error("CycloneDX must use the 1.7 JSON profile");
  if (root["$schema"] !== "https://cyclonedx.org/schema/bom-1.7.schema.json")
    throw new Error("CycloneDX schema URI is not pinned to 1.7");
  const components = arrayValue(root["components"], "CycloneDX components");
  if (components.length === 0) throw new Error("CycloneDX component inventory must not be empty");
  const refs = uniqueRecordStrings(components, "bom-ref", "CycloneDX component");
  const dependencies = arrayValue(root["dependencies"], "CycloneDX dependencies");
  const dependencyRefs = new Set<string>();
  for (const dependencyValue of dependencies) {
    const dependency = asRecord(dependencyValue, "CycloneDX dependency");
    const ref = stringValue(dependency["ref"], "CycloneDX dependency ref");
    if (!refs.has(ref) || dependencyRefs.has(ref))
      throw new Error(`CycloneDX dependency has invalid or duplicate ref: ${ref}`);
    dependencyRefs.add(ref);
    for (const target of stringArray(dependency["dependsOn"], "CycloneDX dependency targets")) {
      if (!refs.has(target)) throw new Error(`CycloneDX dependency target is missing: ${target}`);
    }
  }
  const compositions = arrayValue(root["compositions"], "CycloneDX compositions");
  if (
    compositions.length !== 1 ||
    asRecord(compositions[0], "CycloneDX composition")["aggregate"] !== "unknown"
  )
    throw new Error("CycloneDX repository-discovery composition must be unknown");
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a nonempty string`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return arrayValue(value, label).map((item) => stringValue(item, label));
}

function uniqueRecordStrings(values: unknown[], property: string, label: string): Set<string> {
  const output = new Set<string>();
  for (const value of values) {
    const item = asRecord(value, label);
    const text = stringValue(item[property], `${label} ${property}`);
    if (output.has(text)) throw new Error(`${label} ${property} must be unique: ${text}`);
    output.add(text);
  }
  return output;
}

export function validateReportInput(input: ReportInput): void {
  const runResult = runDocumentSchema.safeParse(input.run);
  if (!runResult.success)
    throw new Error(`Run document failed the offline contract: ${runResult.error.message}`);
  const targetResult = targetSnapshotSchema.safeParse(input.targetSnapshot);
  if (!targetResult.success)
    throw new Error(`Target snapshot failed the offline contract: ${targetResult.error.message}`);
  assertSubstantiveText(input.principalIssue, "principalIssue");
  assertSubstantiveText(input.businessConsequence, "businessConsequence");
  assertSubstantiveText(input.decision.rationale, "decision rationale");
  if (input.scope.length === 0 || input.scope.some((item) => item.trim().length < 12))
    throw new Error("Assessment scope must contain substantive statements");
  if (!/^sha256:[a-f0-9]{64}$/.test(input.packageIdentityDigest))
    throw new Error("Package identity digest must be a sha256 digest");
  if (!Number.isFinite(Date.parse(input.generatedAt)))
    throw new Error("Report generatedAt must be an RFC 3339 timestamp");
  if (input.components.length === 0)
    throw new Error("Repository-discovery component inventory must not be empty");

  const evidenceIds = new Set(input.evidence.map(({ evidenceId }) => evidenceId));
  if (evidenceIds.size === 0) throw new Error("At least one evidence item is required");
  if (evidenceIds.size !== input.evidence.length) throw new Error("Evidence IDs must be unique");
  const claimIds = new Set<string>();
  const claimTopics = new Set<string>();
  for (const claim of input.productClaims) {
    const result = productClaimSchema.safeParse(claim);
    if (!result.success)
      throw new Error(`Product claim failed the offline contract: ${result.error.message}`);
    if (claimIds.has(claim.claimId)) throw new Error(`Duplicate claim ID: ${claim.claimId}`);
    if (claimTopics.has(claim.topic))
      throw new Error(`Duplicate product discovery topic: ${claim.topic}`);
    claimIds.add(claim.claimId);
    claimTopics.add(claim.topic);
  }
  for (const topic of discoveryTopics) {
    if (!claimTopics.has(topic))
      throw new Error(`Required product discovery topic is missing: ${topic}`);
  }

  const findingIds = new Set<string>();
  for (const finding of input.findings) {
    if (findingIds.has(finding.findingId))
      throw new Error(`Duplicate finding ID: ${finding.findingId}`);
    findingIds.add(finding.findingId);
    requireEvidenceReferences(
      `Finding ${finding.findingId}`,
      finding.evidenceOccurrenceIds,
      evidenceIds,
      finding.validationState === "invalidated",
    );
  }
  const criteria = new Set(input.decision.criteria.map(({ criterion }) => criterion));
  if (
    criteria.size !== REQUIRED_DECISION_CRITERIA.length ||
    input.decision.criteria.length !== REQUIRED_DECISION_CRITERIA.length
  )
    throw new Error("Decision comparison must contain seven unique required criteria");
  for (const criterion of REQUIRED_DECISION_CRITERIA) {
    if (!criteria.has(criterion)) throw new Error(`Decision criterion is missing: ${criterion}`);
  }
  for (const criterion of input.decision.criteria) {
    for (const [optionName, option] of Object.entries(criterion.options)) {
      assertSubstantiveText(
        option.assessment,
        `Decision factor ${criterion.criterion}/${optionName} assessment`,
      );
      for (const claimId of option.claimIds) {
        if (!claimIds.has(claimId))
          throw new Error(
            `Decision factor ${criterion.criterion}/${optionName} references missing claim ${claimId}`,
          );
      }
      if (
        option.state === "evidenced" &&
        option.evidenceOccurrenceIds.length === 0 &&
        option.claimIds.length === 0
      )
        throw new Error(
          `Decision factor ${criterion.criterion}/${optionName} claims evidence but has no reference`,
        );
      requireEvidenceReferences(
        `Decision factor ${criterion.criterion}/${optionName}`,
        option.evidenceOccurrenceIds,
        evidenceIds,
        option.state !== "evidenced",
      );
    }
  }
  const recommendedOptions =
    input.decision.recommendation.kind === "single"
      ? [input.decision.recommendation.option]
      : input.decision.recommendation.options;
  if (recommendedOptions.length === 0)
    throw new Error("Conditional recommendation must contain at least one option");
  if (input.decision.schemaVersion !== "1.0.0" || input.decision.runId !== input.run.runId)
    throw new Error("Decision document identity is invalid");
  for (const option of recommendedOptions) {
    for (const criterion of input.decision.criteria) {
      const assessment = criterion.options[option];
      if (
        assessment.state === "evidenced" &&
        assessment.evidenceOccurrenceIds.length === 0 &&
        assessment.claimIds.length === 0
      )
        throw new Error(`Recommended option ${option} is not linked to evidence`);
    }
  }
  if (input.controls.length === 0) throw new Error("Control inventory must not be empty");
  const baselineControls = input.controls.filter(
    ({ profileId }) => profileId === input.securityProfileGuidance.generalBaselineProfileId,
  );
  if (
    baselineControls.length === 0 ||
    !/general.*(?:security|baseline)|(?:security|baseline).*general/i.test(
      input.securityProfileGuidance.generalBaselineProfileId,
    )
  )
    throw new Error("A nonempty general security baseline is required");
  for (const control of input.controls) {
    if (control.status !== "pass" && (control.reason === undefined || control.reason.trim() === ""))
      throw new Error(
        `Control ${control.controlId} requires a reason for status ${control.status}`,
      );
    requireEvidenceReferences(
      `Control ${control.controlId}`,
      control.evidenceOccurrenceIds,
      evidenceIds,
      control.status === "not applicable" ||
        control.status === "not tested" ||
        control.status === "blocked",
    );
  }
  const coverageDomains = new Set(input.coverage.map(({ domainId }) => domainId));
  if (
    coverageDomains.size !== assessmentDomains.length ||
    input.coverage.length !== assessmentDomains.length
  )
    throw new Error("Coverage must contain every required assessment domain exactly once");
  for (const domain of assessmentDomains) {
    if (!coverageDomains.has(domain))
      throw new Error(`Required coverage domain is missing: ${domain}`);
  }
  for (const coverage of input.coverage) {
    const total = Object.values(coverage.counts).reduce((sum, value) => sum + value, 0);
    if (
      coverage.reconciledControls !== coverage.plannedControls ||
      total !== coverage.reconciledControls
    )
      throw new Error(`Coverage for ${coverage.domainId} does not reconcile`);
    if (
      coverage.status !== "pass" &&
      coverage.limitationIds.length === 0 &&
      coverage.exclusions.length === 0 &&
      coverage.evidenceOccurrenceIds.length === 0
    )
      throw new Error(
        `Non-pass coverage for ${coverage.domainId} requires a limitation or evidence`,
      );
  }
  for (const screenshot of input.screenshots) {
    const capturedValid =
      screenshot.status === "captured" &&
      screenshot.packageRelPath !== undefined &&
      screenshot.evidenceOccurrenceId !== undefined &&
      screenshot.unavailableReason === undefined;
    const unavailableValid =
      screenshot.status === "unavailable" &&
      screenshot.unavailableReason !== undefined &&
      screenshot.unavailableReason.trim() !== "" &&
      screenshot.packageRelPath === undefined;
    if (!capturedValid && !unavailableValid)
      throw new Error(
        `Screenshot ${screenshot.screenshotId} must have a captured file or unavailable reason`,
      );
    if (screenshot.status === "captured") {
      const evidence = input.evidence.find(
        ({ evidenceId }) => evidenceId === screenshot.evidenceOccurrenceId,
      );
      if (evidence === undefined)
        throw new Error(`Screenshot ${screenshot.screenshotId} references missing evidence`);
      if (evidence.packageRelPath !== screenshot.packageRelPath)
        throw new Error(`Screenshot ${screenshot.screenshotId} path does not match its evidence`);
    }
  }
  for (const profile of input.securityProfileGuidance.deeperProfiles) {
    assertText(profile.profileId, "Deeper security profile ID");
    if (
      profile.applicability === "recommended-for-confirmation" &&
      profile.triggeringSignals.length === 0
    )
      throw new Error(
        `Recommended deeper profile ${profile.profileId} requires triggering signals`,
      );
    if (profile.requiresCustomerConfirmation !== true)
      throw new Error(`Deeper profile ${profile.profileId} must require customer confirmation`);
    requireEvidenceReferences(
      `Deeper profile ${profile.profileId}`,
      profile.evidenceOccurrenceIds,
      evidenceIds,
      profile.applicability === "not-recommended",
    );
  }
  const requiredReviewKinds = new Set([
    "independent-security",
    "independent-decision",
    "technical-human",
    "lay-human",
  ]);
  for (const review of input.reviews) {
    if (
      review.schemaVersion !== "1.0.0" ||
      review.runId !== input.run.runId ||
      !/^sha256:[a-f0-9]{64}$/.test(review.inputDigest) ||
      !Number.isFinite(Date.parse(review.completedAt))
    )
      throw new Error(`Review ${review.reviewId} failed its offline contract`);
    if (!evidenceIds.has(review.reviewEvidenceId))
      throw new Error(`Review ${review.reviewId} references missing evidence`);
    for (const item of review.itemResults)
      requireEvidenceReferences(
        `Review item ${item.itemId}`,
        item.evidenceOccurrenceIds,
        evidenceIds,
        item.outcome === "not assessed",
      );
    if (review.verdict === "failed") throw new Error(`Required review failed: ${review.kind}`);
    requiredReviewKinds.delete(review.kind);
  }
  if (requiredReviewKinds.size > 0)
    throw new Error(`Required reviews are missing: ${[...requiredReviewKinds].join(", ")}`);
  validateEquivalenceCertificate(input.equivalenceCertificate, input.run.runId);
}

function validateEquivalenceCertificate(
  certificate: ReportEquivalenceCertificate,
  runId: string,
): void {
  if (certificate.schemaVersion !== "1.0.0" || certificate.runId !== runId)
    throw new Error("Equivalence certificate identity is invalid");
  for (const property of [
    "requiredSchemasValid",
    "materialityValid",
    "sourceIntegrityValid",
    "controlReconciliationValid",
    "securityReviewPresent",
    "decisionReviewPresent",
    "requiredArtifactsPresent",
    "redactionValid",
    "manifestAndZipValid",
  ] as const) {
    if (certificate[property] !== true)
      throw new Error(`Equivalence certificate gate failed: ${property}`);
  }
  if (certificate.prohibitedActionsObserved !== false)
    throw new Error("Equivalence certificate recorded a prohibited action");
  assertText(certificate.validationReportId, "Equivalence validation report ID");
}

function assertSubstantiveText(value: string, label: string): void {
  assertText(value, label);
  if (value.trim().length < 20 || value.trim().split(/\s+/).length < 4)
    throw new Error(`${label} must be substantive`);
}

export function validateCustomerContent(
  path: string,
  content: string | Uint8Array,
  options: ContentGateOptions = {},
): void {
  const text = typeof content === "string" ? content : new TextDecoder().decode(content);
  if (text.includes("\u0000")) throw new Error(`${path}: NUL bytes are prohibited`);
  if (PLACEHOLDER_PATTERN.test(text)) throw new Error(`${path}: unresolved placeholder content`);
  if (HOST_PATH_PATTERN.test(text)) throw new Error(`${path}: absolute host path detected`);
  if (SECRET_PATTERN.test(text)) throw new Error(`${path}: credential-like secret detected`);
  if (COMPLIANCE_CLAIM_PATTERN.test(text))
    throw new Error(`${path}: unsupported compliance or certification claim`);
  for (const secret of options.knownSecrets ?? []) {
    if (secret.length > 0 && text.includes(secret))
      throw new Error(`${path}: known secret value detected`);
  }
  for (const hostPath of options.forbiddenHostPaths ?? []) {
    if (hostPath.length > 0 && text.includes(hostPath))
      throw new Error(`${path}: forbidden host path detected`);
  }
}

export function validateStaticHtml(path: string, html: string, requireReportShell = false): void {
  if (html.length > 10 * 1024 * 1024) throw new Error(`${path}: HTML byte limit exceeded`);
  if (
    /<(?:script|iframe|frame|frameset|form|input|button|textarea|select|object|embed|svg|math|video|audio|canvas|base)\b/i.test(
      html,
    )
  )
    throw new Error(`${path}: forbidden active HTML element`);
  const withoutDoctype = html.replace(/^<!doctype html>/i, "").trim();
  const structured = sanitizeHtml(withoutDoctype, REPORT_HTML_SANITIZE_OPTIONS);
  if (structured !== withoutDoctype)
    throw new Error(`${path}: structured HTML sanitation changed the document`);
  if (
    /<(?:script|iframe|frame|frameset|form|input|button|textarea|select|object|embed|svg|math|video|audio|canvas|base)\b/i.test(
      html,
    )
  )
    throw new Error(`${path}: forbidden active HTML element`);
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html))
    throw new Error(`${path}: meta refresh is prohibited`);
  if (/<(?:marquee|link)\b/i.test(html))
    throw new Error(`${path}: untrusted or active HTML element`);
  if (/\s(?:on[a-z]+|style|srcdoc)\s*=/i.test(html))
    throw new Error(`${path}: forbidden active HTML attribute`);
  if (/\sdownload(?:\s|=|>)/i.test(html) || /<a\b[^>]*href\s*=\s*["']data:/i.test(html))
    throw new Error(`${path}: active download payload is prohibited`);
  for (const match of html.matchAll(/\s(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const target = match[1] ?? "";
    const withoutFragment = target.split(/[?#]/, 1)[0] ?? "";
    const resolved = posix.normalize(posix.join(posix.dirname(path), withoutFragment));
    if (
      /^(?:https?:|javascript:|vbscript:|file:|ftp:|\/\/)/i.test(target) ||
      target.includes("\\") ||
      resolved.startsWith("../") ||
      resolved.startsWith("/")
    )
      throw new Error(`${path}: unsafe or external HTML resource`);
  }
  const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)];
  if (styleBlocks.length !== 1 || styleBlocks[0]?.[1] !== REPORT_RENDERER_CSS)
    throw new Error(`${path}: report CSS does not match the release-owned block`);
  const expectedCsp = `style-src 'sha256-${REPORT_RENDERER_CSS_SHA256}'`;
  if (!html.includes("default-src 'none'") || !html.includes(expectedCsp))
    throw new Error(`${path}: CSP or CSS hash mismatch`);
  if (requireReportShell) {
    for (const required of [
      'class="skip-link"',
      "<header>",
      '<main id="main-content">',
      "<footer>",
      'aria-label="Report contents"',
      "How to read this report",
      "Package identity digest:",
    ]) {
      if (!html.includes(required)) throw new Error(`${path}: required report shell is incomplete`);
    }
  }
}

function requireEvidenceReferences(
  label: string,
  references: string[],
  evidenceIds: Set<string>,
  emptyAllowed: boolean,
): void {
  if (!emptyAllowed && references.length === 0) throw new Error(`${label} requires evidence`);
  for (const id of references) {
    if (!evidenceIds.has(id)) throw new Error(`${label} references missing evidence ${id}`);
  }
}

function normalizedScreenshotInventory(screenshots: ScreenshotRecord[]): ScreenshotRecord[] {
  return screenshots.length === 0
    ? [
        {
          screenshotId: "screenshots-none",
          title: "Runtime screenshots",
          status: "unavailable",
          unavailableReason:
            "No screenshot inventory was supplied; screenshot coverage is unavailable.",
        },
      ]
    : screenshots;
}

function toSarif(input: ReportInput): Record<string, unknown> {
  return {
    $schema:
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Repository Assessment Kit",
            semanticVersion: "1.0.0",
            rules: input.findings.map((finding) => ({
              id: finding.findingId,
              name: finding.title,
              shortDescription: { text: finding.title },
              fullDescription: { text: finding.description },
            })),
          },
        },
        results: input.findings.map((finding) => ({
          ruleId: finding.findingId,
          level: sarifLevel(finding.technicalSeverity),
          message: { text: finding.description },
          locations: finding.locations.map(({ repoRelPath, startLine, endLine }) => ({
            physicalLocation: {
              artifactLocation: { uri: encodeURI(repoRelPath) },
              region:
                startLine === undefined
                  ? undefined
                  : { startLine, ...(endLine === undefined ? {} : { endLine }) },
            },
          })),
          partialFingerprints: {
            "repoAssessmentKitFinding/v1": sha256(
              `${finding.findingId}\u0000${finding.title}\u0000${finding.category}`,
            ),
          },
          properties: {
            "dev.repo-assessment-kit.findingId": finding.findingId,
            "dev.repo-assessment-kit.evidenceIds": finding.evidenceOccurrenceIds,
            "dev.repo-assessment-kit.validationState": finding.validationState,
            "dev.repo-assessment-kit.confidence": finding.confidence,
            "dev.repo-assessment-kit.technicalSeverity": finding.technicalSeverity,
          },
        })),
        invocations: [{ executionSuccessful: true }],
      },
    ],
  };
}

function sarifLevel(severity: ReportFinding["technicalSeverity"]): string {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "medium") return "warning";
  return "note";
}

function toCycloneDx(input: ReportInput): Record<string, unknown> {
  const components = [...input.components].sort((a, b) => compareUtf8(a.name, b.name));
  const refs = components.map((component) => componentRef(component));
  return {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: `urn:uuid:${deterministicUuid(input.targetSnapshot.snapshotId)}`,
    version: 1,
    metadata: {
      timestamp: input.generatedAt,
      tools: {
        components: [{ type: "application", name: "Repository Assessment Kit", version: "1.0.0" }],
      },
      component: {
        type: "application",
        "bom-ref": `rak-target:${input.targetSnapshot.snapshotId}`,
        name: input.run.projectSlug,
        version: input.targetSnapshot.commitSha,
      },
    },
    components: components.map((component) => ({
      type: component.type ?? "library",
      "bom-ref": componentRef(component),
      name: component.name,
      ...(component.version === undefined ? {} : { version: component.version }),
      ...(component.packageUrl === undefined ? {} : { purl: component.packageUrl }),
      properties: [{ name: "dev.repo-assessment-kit.observation", value: "repository-discovery" }],
    })),
    dependencies: components.map((component, index) => ({
      ref: refs[index],
      dependsOn: (component.dependsOn ?? [])
        .map((name) => components.find((candidate) => candidate.name === name))
        .filter((candidate): candidate is ComponentRecord => candidate !== undefined)
        .map(componentRef)
        .sort(compareUtf8),
    })),
    compositions: [{ aggregate: "unknown", assemblies: refs }],
  };
}

function componentRef(component: ComponentRecord): string {
  return (
    component.packageUrl ??
    `rak-component:${sha256(`${component.name}@${component.version ?? "unknown"}`)}`
  );
}

function deterministicUuid(seed: string): string {
  const hex = sha256(seed).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function toFindingsCsv(findings: ReportFinding[]): string {
  const rows = [
    [
      "finding_id",
      "title",
      "technical_severity",
      "business_priority",
      "confidence",
      "validation_state",
      "category",
      "evidence_ids",
      "locations",
      "remediation_theme",
    ],
    ...findings.map((finding) => [
      finding.findingId,
      finding.title,
      finding.technicalSeverity,
      finding.businessPriority,
      finding.confidence,
      finding.validationState,
      finding.category,
      finding.evidenceOccurrenceIds.join(";"),
      finding.locations.map(formatLocation).join(";"),
      finding.remediationTheme ?? "",
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function formatLocation(location: {
  repoRelPath: string;
  startLine?: number;
  endLine?: number;
}): string {
  if (location.startLine === undefined) return location.repoRelPath;
  return `${location.repoRelPath}:${location.startLine}${location.endLine === undefined ? "" : `-${location.endLine}`}`;
}

function nonEmptyList(values: string[], fallback: string): string[] {
  return values.length === 0 ? [fallback] : values;
}

function humanize(value: string): string {
  const result = value.replaceAll("-", " ");
  return `${result.slice(0, 1).toUpperCase()}${result.slice(1)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeMarkdown(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([`*_[\]])/g, "\\$1");
  return escaped
    .split("\n")
    .map((line) =>
      line.replace(/^(\s{0,3})(#{1,6}(?=\s)|>(?=\s)|[-+](?=\s)|\d+[.)](?=\s))/u, "$1\\$2"),
    )
    .join("\n");
}

function escapeMarkdownCell(value: string): string {
  return escapeMarkdown(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

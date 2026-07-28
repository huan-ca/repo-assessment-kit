import { describe, expect, it } from "vitest";
import { assessmentDomains, discoveryTopics } from "@rak/contracts";

import {
  generateReportBundle,
  validateCustomerContent,
  validateCycloneDx,
  validateReportInput,
  validateSarif,
  validateStaticHtml,
  type ReportInput,
} from "../src/index.js";

const RUN_ID = "run_018f47a0-7b2c-7abc-8def-0123456789ab";
const DIGEST = `sha256:${"a".repeat(64)}` as const;
const NOW = "2026-07-28T00:00:00.000Z";

function fixture(): ReportInput {
  const option = (assessment: string) => ({
    assessment,
    state: "evidenced" as const,
    confidence: "high" as const,
    claimIds: [],
    evidenceOccurrenceIds: ["EV-1"],
  });
  const criteria = [
    "recoverability",
    "system-boundaries",
    "security-risk",
    "engineering-risk",
    "critical-feature-parity",
    "expected-scale",
    "rebuild-feasibility",
  ] as const;
  return {
    run: {
      schemaVersion: "1.0.0",
      runId: RUN_ID,
      projectSlug: "customer-portal",
      revision: 1,
      rowVersion: 1,
      state: "PACKAGING",
      workflowProfile: "rak-workflow/1.0.0",
      exportProfile: "rak-export-profile/1.0.0",
      provider: "codex",
      targetSnapshotId: DIGEST,
      createdAt: NOW,
      updatedAt: NOW,
      limitationIds: ["L-1"],
    },
    targetSnapshot: {
      schemaVersion: "1.0.0",
      snapshotId: DIGEST,
      sourceKind: "local",
      sanitizedLocator: "customer-portal",
      gitObjectFormat: "sha1",
      commitSha: "a".repeat(40),
      baseCommitSha: "a".repeat(40),
      mode: "commit-only",
      manifestBlobId: "blob-manifest",
      manifestDigest: DIGEST,
      archiveDigest: DIGEST,
      beforeSourceDigest: DIGEST,
      afterSourceDigest: DIGEST,
      includedDirtyPaths: [],
      excludedDirtyPaths: [],
      submodules: "not-present",
      lfs: "not-present",
      createdAt: NOW,
    },
    productClaims: discoveryTopics.map((topic, index) => ({
      schemaVersion: "1.0.0",
      claimId: `claim-${index + 1}`,
      runId: RUN_ID,
      topic,
      statement: `The owner supplied substantive assessment context for ${topic}.`,
      provenance: "owner-stated",
      speakerRole: "software owner",
      capturedAt: NOW,
      confidence: "high",
      evidenceOccurrenceIds: ["EV-1"],
      conflictsWithClaimIds: [],
      revision: 1,
    })),
    findings: [
      {
        schemaVersion: "1.0.0",
        findingId: "F-1",
        runId: RUN_ID,
        fingerprint: { algorithm: "rak-finding/v1", value: "finding-fingerprint-1" },
        revision: 1,
        title: "Shared administrator access",
        description: "Several operators use one privileged account, reducing accountability.",
        category: "authentication security",
        technicalSeverity: "high",
        businessPriority: "urgent",
        confidence: "high",
        validationState: "corroborated",
        evidenceOccurrenceIds: ["EV-1"],
        locations: [{ repoRelPath: "src/auth.ts", startLine: 12 }],
        cweMappings: [],
        cvss: [],
        remediationTheme: "Give each operator an individual account.",
        consequence: "A harmful change may not be attributable to one person.",
        affectedParty: "Operators and customers",
        nextAction: "Create individual access and review privileges.",
      },
    ],
    controls: [
      {
        schemaVersion: "1.0.0",
        controlResultId: "ctl-result-1",
        runId: RUN_ID,
        plannedControlId: "planned-auth-1",
        controlId: "AUTH-1",
        profileId: "general-security-baseline/1",
        plannedScope: "Repository authentication controls",
        status: "pass",
        techniqueIds: ["static-review"],
        evidenceOccurrenceIds: ["EV-1"],
        activityId: "activity-1",
        completedAt: NOW,
      },
    ],
    coverage: assessmentDomains.map((domainId, index) => ({
      schemaVersion: "1.0.0",
      coverageId: `coverage-${index + 1}`,
      runId: RUN_ID,
      domainId,
      status: "pass",
      plannedControls: 1,
      reconciledControls: 1,
      counts: {
        pass: 1,
        fail: 0,
        partial: 0,
        blocked: 0,
        "not applicable": 0,
        "not tested": 0,
      },
      exclusions: [],
      unsupportedEcosystems: [],
      limitationIds: [],
      evidenceOccurrenceIds: ["EV-1"],
    })),
    evidence: [
      {
        schemaVersion: "1.0.0",
        evidenceId: "EV-1",
        runId: RUN_ID,
        blobId: "blob-1",
        evidenceType: "source-excerpt",
        title: "Authentication configuration",
        snapshotId: DIGEST,
        activityId: "activity-1",
        capturedAt: NOW,
        packageRelPath: "evidence/auth.txt",
        sensitivity: "customer-confidential",
        redactionState: "none-required",
        validationState: "validated",
        collectionLimitations: [],
        derivedFromEvidenceIds: [],
        linkedClaimIds: [],
        linkedFindingIds: ["F-1"],
        linkedControlIds: ["AUTH-1"],
      },
    ],
    decision: {
      schemaVersion: "1.0.0",
      runId: RUN_ID,
      criteria: criteria.map((criterion) => ({
        criterion,
        options: {
          remediation: option(
            "Existing boundaries permit focused repairs without losing established workflows.",
          ),
          "incremental-replacement": option(
            "A staged replacement remains feasible but needs additional transition investment.",
          ),
          "full-rebuild": option(
            "A complete rebuild adds avoidable feature discovery and delivery risk.",
          ),
        },
      })),
      recommendation: { kind: "single", option: "remediation" },
      rationale: "The observed boundary can be repaired while preserving established workflows.",
      confidence: "high",
      assumptions: ["The current workflow remains commercially important."],
      dependencies: ["The owner confirms account ownership."],
      reversalConditions: ["Undocumented coupling prevents safe isolation."],
    },
    reviews: (
      ["independent-security", "independent-decision", "technical-human", "lay-human"] as const
    ).map((kind, index) => ({
      schemaVersion: "1.0.0",
      reviewId: `review-${index + 1}`,
      runId: RUN_ID,
      kind,
      reviewerAgentId: `reviewer-${index + 1}`,
      inputDigest: DIGEST,
      verdict: "passed",
      itemResults: [
        {
          itemId: `item-${index + 1}`,
          outcome: "corroborated",
          evidenceOccurrenceIds: ["EV-1"],
        },
      ],
      acceptedCorrectionIds: [],
      limitationIds: [],
      reviewEvidenceId: "EV-1",
      completedAt: NOW,
    })),
    equivalenceCertificate: {
      schemaVersion: "1.0.0",
      runId: RUN_ID,
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
      validationReportId: "validation-1",
    },
    components: [{ name: "fastify", version: "5.0.0", packageUrl: "pkg:npm/fastify@5.0.0" }],
    screenshots: [
      {
        screenshotId: "shot-none",
        title: "Administrator login",
        status: "unavailable",
        unavailableReason:
          "A safe runtime was blocked because sandbox credentials were not supplied.",
      },
    ],
    securityProfileGuidance: {
      generalBaselineProfileId: "general-security-baseline/1",
      overlayProfileIds: [],
      deeperProfiles: [
        {
          profileId: "identity-assurance-review/1",
          applicability: "recommended-for-confirmation",
          triggeringSignals: ["Shared privileged account behavior was observed."],
          evidenceOccurrenceIds: ["EV-1"],
          requiresCustomerConfirmation: true,
        },
      ],
    },
    scope: [
      "Source, architecture, engineering quality, security, and runtime readiness were assessed.",
    ],
    limitations: [
      {
        limitationId: "L-1",
        description: "Runtime checks were blocked.",
        effect: "Behavior after login was not observed.",
      },
    ],
    principalIssue: "Privileged access is shared, which weakens accountability.",
    businessConsequence: "The owner may be unable to determine who made a harmful change.",
    generatedAt: "2026-07-28T00:00:00.000Z",
    packageIdentityDigest: DIGEST,
  };
}

describe("report generation", () => {
  it("creates substantive customer reports and all machine-readable projections", () => {
    const bundle = generateReportBundle(fixture());
    const paths = bundle.files.map(({ path }) => path);
    expect(paths).toContain("reports/executive.md");
    expect(paths).toContain("reports/security.html");
    expect(paths).toContain("exports/findings.sarif.json");
    expect(paths).toContain("exports/sbom.cdx.json");
    expect(paths).toContain("exports/findings.csv");
    expect(paths).toContain("data/screenshots.json");
    expect(bundle.files.find(({ path }) => path === "reports/decision.md")?.content).toContain(
      "Repair current system",
    );
    expect(
      bundle.files.find(({ path }) => path === "reports/coverage-limitations.md")?.content,
    ).toContain("safe runtime was blocked");
    const html = bundle.files.find(({ path }) => path === "reports/executive.html")?.content ?? "";
    expect(html).toContain('class="skip-link"');
    expect(html).toContain('<main id="main-content">');
    expect(html).toContain("<footer>");
    expect(html).toContain("How to read this report");
    expect(html).toContain("Package identity digest:");
    expect(html).toContain("Authentication configuration");
    expect(html).toContain("supports the executive decision summary");
    expect(html).not.toContain(">Evidence record EV-1<");
    const markdown =
      bundle.files.find(({ path }) => path === "reports/executive.md")?.content ?? "";
    expect(markdown).toContain("Confidence is high.");
    expect(markdown).toContain("(recorded limitation reference L-1).");
    expect(markdown).not.toMatch(/\\[.(]/);
  });

  it("keeps zero-finding decisions conditional and evidence-honest", () => {
    const input = fixture();
    input.findings = [];
    input.principalIssue = "Urgent risks require immediate remediation.";
    input.businessConsequence = "Verified risks create urgent customer impact.";
    input.decision.rationale = "Remediate the verified risks immediately.";
    const executive =
      generateReportBundle(input).files.find(({ path }) => path === "reports/executive.md")
        ?.content ?? "";

    expect(executive).toContain("Conditional planning direction");
    expect(executive).toContain("No admitted finding establishes an urgent verified risk");
    expect(executive).toContain("No verified impact was established");
    expect(executive).toContain("Evidenced strengths and recoverability");
    expect(executive).toContain("What could change the recommendation");
    expect(executive).toContain("Software owner decision:");
    expect(executive).not.toContain("Urgent risks require immediate remediation");
    expect(executive).not.toContain("Remediate the verified risks immediately");
  });

  it("explains unknown-only discovery effects, follow-up ownership, and decision terms", () => {
    const input = fixture();
    input.findings = [];
    input.productClaims = input.productClaims.map((claim) => ({
      schemaVersion: "1.0.0",
      claimId: claim.claimId,
      runId: claim.runId,
      topic: claim.topic,
      unknown: {
        reason: "The owner has not confirmed this product fact.",
        confidenceEffect: "Decision confidence remains low.",
        coverageEffect: "Related workflow coverage is incomplete.",
        followUp: "confirm the fact with the product owner before authorization.",
      },
      provenance: "unverified",
      confidence: "low",
      evidenceOccurrenceIds: [],
      conflictsWithClaimIds: [],
      revision: claim.revision,
    }));
    for (const criterion of input.decision.criteria) {
      for (const option of Object.values(criterion.options)) {
        option.state = "unverified";
        option.confidence = "low";
      }
    }
    input.decision.confidence = "low";
    const bundle = generateReportBundle(input);
    const executive =
      bundle.files.find(({ path }) => path === "reports/executive.html")?.content ?? "";
    const coverage =
      bundle.files.find(({ path }) => path === "reports/coverage-limitations.html")?.content ?? "";
    const decision =
      bundle.files.find(({ path }) => path === "reports/decision.html")?.content ?? "";

    expect(executive).toContain("Confidence effect: Decision confidence remains low.");
    expect(executive).toContain("Coverage effect: Related workflow coverage is incomplete.");
    expect(executive).toContain("Software owner follow-up:");
    expect(coverage).toContain("Unknown product facts and their decision effect");
    expect(coverage).toContain("Software owner:");
    expect(decision).toContain(
      "Separation between system parts: whether one part can change without unsafe effects",
    );
    expect(decision).toContain(
      "Preserving essential behavior: which valuable behavior a replacement must keep",
    );
    expect(decision).not.toMatch(
      /\bobserved boundary\b|\bcritical feature parity\b|\brebuild feasibility\b/i,
    );
  });

  it("renders descriptive coverage, limitation, and evidence labels instead of bare IDs", () => {
    const bundle = generateReportBundle(fixture());
    const customerReports = bundle.files
      .filter(({ path }) => path.startsWith("reports/") && path.endsWith(".html"))
      .map(({ content }) => content)
      .join("\n");
    expect(customerReports).toContain("Authentication configuration");
    expect(customerReports).toContain("Runtime checks were blocked (reference L-1)");
    expect(customerReports).toContain("Separation between system parts");
    expect(customerReports).toContain("Next action:");
    expect(customerReports).not.toContain("Evidence record EV-1");
    expect(customerReports).not.toContain("| EV-1 |");
    expect(customerReports).not.toContain("| L-1 |");
  });

  it("escapes hostile source text in both output formats", () => {
    const input = fixture();
    input.findings[0]!.consequence =
      '<script>alert("x")</script> hostile customer text [click](https://evil.invalid)';
    const bundle = generateReportBundle(input);
    const html = bundle.files.find(({ path }) => path === "reports/executive.html")?.content ?? "";
    const markdown =
      bundle.files.find(({ path }) => path === "reports/executive.md")?.content ?? "";
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(markdown).not.toContain("[click](https://evil.invalid)");
    expect(markdown).toContain("\\[click\\](https://evil.invalid)");
  });

  it("rejects missing finding and decision evidence references", () => {
    const input = fixture();
    input.findings[0]!.evidenceOccurrenceIds = ["EV-MISSING"];
    expect(() => validateReportInput(input)).toThrow(/missing evidence EV-MISSING/);

    const decisionInput = fixture();
    decisionInput.decision.criteria[0]!.options.remediation.evidenceOccurrenceIds = [];
    expect(() => validateReportInput(decisionInput)).toThrow(
      /claims evidence but has no reference/,
    );
  });

  it("rejects non-pass controls without reasons and unreconciled coverage", () => {
    const input = fixture();
    input.controls[0]!.status = "blocked";
    input.controls[0]!.evidenceOccurrenceIds = [];
    expect(() => validateReportInput(input)).toThrow(/requires a reason/);

    const coverageInput = fixture();
    coverageInput.coverage[0]!.reconciledControls = 0;
    expect(() => validateReportInput(coverageInput)).toThrow(/does not reconcile/);
  });

  it("requires the seven decision criteria, allowed provenance, baseline, and every domain", () => {
    const criteria = fixture();
    criteria.decision.criteria = [];
    expect(() => validateReportInput(criteria)).toThrow(/seven unique required criteria/);

    const provenance = fixture();
    (provenance.productClaims[0] as unknown as Record<string, unknown>)["provenance"] =
      "fabricated";
    expect(() => validateReportInput(provenance)).toThrow(/Product claim failed/);

    const baseline = fixture();
    baseline.controls = [];
    expect(() => validateReportInput(baseline)).toThrow(/Control inventory/);

    const coverage = fixture();
    coverage.coverage.pop();
    expect(() => validateReportInput(coverage)).toThrow(/every required assessment domain/);
  });

  it("resolves captured screenshots to matching packaged evidence", () => {
    const input = fixture();
    input.screenshots = [
      {
        screenshotId: "shot-1",
        title: "Runtime login",
        status: "captured",
        packageRelPath: "screenshots/login.png",
        evidenceOccurrenceId: "EV-MISSING",
      },
    ];
    expect(() => validateReportInput(input)).toThrow(/references missing evidence/);
  });

  it("rejects active HTML and malformed machine-readable projections", () => {
    expect(() =>
      validateStaticHtml(
        "index.html",
        '<!doctype html><script>fetch("https://evil.invalid")</script><iframe src="https://evil.invalid"></iframe>',
      ),
    ).toThrow(/forbidden active HTML/);

    const input = fixture();
    const bundle = generateReportBundle(input);
    const canonicalHtml = bundle.files.find(({ path }) => path === "index.html")!.content;
    for (const mutate of [
      (html: string) => html.replace("</main>", "<marquee>unsafe</marquee></main>"),
      (html: string) =>
        html.replace(
          "<head>",
          '<head><link rel="stylesheet" href="data:text/css,body{display:none}">',
        ),
      (html: string) => html.replace("</main>", "<blink>x</blink></main>"),
      (html: string) => html.replace('<main id="main-content">', '<main id="main-content" x="1">'),
      (html: string) =>
        html.replace(
          'href="#main-content"',
          'href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;" download="payload.html"',
        ),
    ]) {
      expect(() => validateStaticHtml("index.html", mutate(canonicalHtml), true)).toThrow(
        /sanitation changed|untrusted or active HTML|active download payload/,
      );
    }

    const sarif = JSON.parse(
      bundle.files.find(({ path }) => path === "exports/findings.sarif.json")!.content,
    ) as Record<string, unknown>;
    sarif["version"] = "2.0.0";
    expect(() => validateSarif(sarif, input)).toThrow(/version 2.1.0/);

    const cyclone = JSON.parse(
      bundle.files.find(({ path }) => path === "exports/sbom.cdx.json")!.content,
    ) as Record<string, unknown>;
    const components = cyclone["components"] as Array<Record<string, unknown>>;
    components.push({ ...components[0] });
    expect(() => validateCycloneDx(cyclone)).toThrow(/must be unique/);
  });

  it("requires every screenshot to have a captured file or explicit unavailable reason", () => {
    const input = fixture();
    input.screenshots = [{ screenshotId: "bad", title: "Missing", status: "unavailable" }];
    expect(() => validateReportInput(input)).toThrow(/captured file or unavailable reason/);
  });

  it("blocks secrets, host paths, placeholders, and unsupported executive claims", () => {
    expect(() =>
      validateCustomerContent("reports/technical.md", "token=seeded-value", {
        knownSecrets: ["seeded-value"],
      }),
    ).toThrow(/secret/);
    expect(() =>
      validateCustomerContent("reports/technical.md", "read /home/alice/private.txt"),
    ).toThrow(/host path/);
    expect(() => validateCustomerContent("reports/technical.md", "TODO add analysis")).toThrow(
      /placeholder/,
    );
    expect(() => validateCustomerContent("reports/technical.md", "read /etc/passwd")).toThrow(
      /host path/,
    );
    expect(() => validateCustomerContent("reports/technical.md", "literal PLACEHOLDER")).toThrow(
      /placeholder/,
    );
    expect(() => validateCustomerContent("reports/technical.md", "AKIAIOSFODNN7EXAMPLE")).toThrow(
      /secret/,
    );
    expect(() =>
      validateCustomerContent("reports/executive.md", "The product is fully compliant."),
    ).toThrow(/compliance/);
  });
});

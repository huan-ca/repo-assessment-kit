import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assessmentDomains, discoveryTopics } from "@rak/contracts";
import canonicalize from "canonicalize";
import { describe, expect, it } from "vitest";

import {
  buildPackageReleasePrerequisites,
  collectStagingArtifacts,
  createCustomerPackage,
  encryptionCapability,
  LOCKED_REPORT_RENDERER_CSS,
  LOCKED_REPORT_RENDERER_CSS_SHA256,
  reopenZip,
  validateArchivePath,
  validatePersistedZipInFreshProcess,
  validateReopenedZip,
  verifyDetachedDigest,
  type CreatePackageOptions,
  type PackageArtifact,
  type StrongEncryptionProvider,
} from "../src/index.js";

const RUN_ID = "run_018f47a0-7b2c-7abc-8def-0123456789ab";
const COMMIT = "a".repeat(40);
const DIGEST = `sha256:${"a".repeat(64)}`;
const NOW = "2026-07-28T00:00:00.000Z";
const PROJECT = "customer-portal";

function canonicalDigestForTest(value: unknown): string {
  const serialized = canonicalize(value);
  if (serialized === undefined) throw new Error("test value is not canonicalizable");
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function o0Eligibility(): PackageArtifact["eligibility"] {
  return {
    schemaVersion: "1.0.0",
    sources: [
      {
        occurrence: {
          evidenceId: "EV-1",
          runId: RUN_ID,
          snapshotId: DIGEST,
          activityId: "activity-1",
          evidenceType: "source-excerpt",
          sensitivity: "customer-confidential",
          redactionState: "none-required",
          validationState: "validated",
          collectionLimitations: ["rak-output-class:O0-uncredentialed"],
          derivedFromEvidenceIds: [],
        },
        activity: {
          activityId: "activity-1",
          runId: RUN_ID,
          kind: "uncredentialed-evidence-capture",
        },
      },
    ],
  };
}

function artifact(
  path: string,
  content: string,
  mediaType = path.endsWith(".json") ? "application/json" : "text/plain",
): PackageArtifact {
  return {
    path,
    content,
    artifactKind: "customer-deliverable",
    mediaType,
    sensitivity: "customer-confidential",
    redactionState: "none-required",
    evidenceOccurrenceIds: ["EV-1"],
    eligibility: o0Eligibility(),
  };
}

function safeHtml(title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${LOCKED_REPORT_RENDERER_CSS_SHA256}'" /><title>${title}</title><style>${LOCKED_REPORT_RENDERER_CSS}</style></head><body><a class="skip-link" href="#main-content">Skip to main report</a><header><nav aria-label="Report contents">Contents</nav><h2>How to read this report</h2><p>Package identity digest: ${DIGEST}</p></header><main id="main-content"><h1>${title}</h1><p>This is a substantive customer assessment report with evidence and limitations.</p></main><footer><p>Technical coverage is not certification or proof of security.</p></footer></body></html>`;
}

function fullArtifacts(): PackageArtifact[] {
  const evidence = {
    schemaVersion: "1.0.0",
    evidenceId: "EV-1",
    runId: RUN_ID,
    blobId: "blob-1",
    evidenceType: "source-excerpt",
    title: "Authentication evidence",
    snapshotId: DIGEST,
    activityId: "activity-1",
    capturedAt: NOW,
    packageRelPath: "evidence/item.txt",
    sensitivity: "customer-confidential",
    redactionState: "none-required",
    validationState: "validated",
    collectionLimitations: ["rak-output-class:O0-uncredentialed"],
    derivedFromEvidenceIds: [],
    linkedClaimIds: [],
    linkedFindingIds: ["F-1"],
    linkedControlIds: ["AUTH-1"],
  };
  const finding = {
    schemaVersion: "1.0.0",
    findingId: "F-1",
    runId: RUN_ID,
    fingerprint: { algorithm: "rak-finding/v1", value: "fingerprint-1" },
    revision: 1,
    title: "Shared privileged access",
    description: "Operators share privileged access, which reduces accountability.",
    category: "authentication security",
    technicalSeverity: "high",
    businessPriority: "urgent",
    confidence: "high",
    validationState: "corroborated",
    evidenceOccurrenceIds: ["EV-1"],
    locations: [{ repoRelPath: "src/auth.ts", startLine: 12 }],
    cweMappings: [],
    cvss: [],
  };
  const control = {
    schemaVersion: "1.0.0",
    controlResultId: "ctl-result-1",
    runId: RUN_ID,
    plannedControlId: "planned-auth-1",
    profileId: "general-security-baseline/1",
    controlId: "AUTH-1",
    plannedScope: "Authentication controls",
    status: "pass",
    techniqueIds: ["static-review"],
    evidenceOccurrenceIds: ["EV-1"],
    activityId: "activity-1",
    completedAt: NOW,
  };
  const coverage = assessmentDomains.map((domainId, index) => ({
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
  }));
  const option = (assessment: string) => ({
    assessment,
    state: "evidenced",
    confidence: "high",
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
  ].map((criterion) => ({
    criterion,
    options: {
      remediation: option("Focused remediation preserves useful established workflows."),
      "incremental-replacement": option(
        "Staged replacement controls transition and discovery risk.",
      ),
      "full-rebuild": option("A rebuild carries greater feature discovery and delivery risk."),
    },
  }));
  const run = {
    schemaVersion: "1.0.0",
    runId: RUN_ID,
    projectSlug: PROJECT,
    revision: 1,
    rowVersion: 1,
    state: "PACKAGING",
    workflowProfile: "rak-workflow/1.0.0",
    exportProfile: "rak-export-profile/1.0.0",
    provider: "codex",
    targetSnapshotId: DIGEST,
    createdAt: NOW,
    updatedAt: NOW,
    limitationIds: [],
  };
  const claims = discoveryTopics.map((topic, index) => ({
    schemaVersion: "1.0.0",
    claimId: `claim-${index + 1}`,
    runId: RUN_ID,
    topic,
    statement: `The owner supplied substantive context for ${topic}.`,
    provenance: "owner-stated",
    speakerRole: "software owner",
    capturedAt: NOW,
    confidence: "high",
    evidenceOccurrenceIds: ["EV-1"],
    conflictsWithClaimIds: [],
    revision: 1,
  }));
  const reviews = [
    "independent-security",
    "independent-decision",
    "technical-human",
    "lay-human",
  ].map((kind, index) => ({
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
  }));
  const sarif = {
    $schema:
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "Repository Assessment Kit", rules: [{ id: "F-1" }] } },
        results: [
          {
            ruleId: "F-1",
            message: { text: finding.description },
            locations: [{ physicalLocation: { artifactLocation: { uri: "src/auth.ts" } } }],
            properties: {
              "dev.repo-assessment-kit.findingId": "F-1",
              "dev.repo-assessment-kit.evidenceIds": ["EV-1"],
            },
          },
        ],
      },
    ],
  };
  const cyclone = {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    components: [{ type: "library", "bom-ref": "pkg:npm/fastify@5.0.0", name: "fastify" }],
    dependencies: [{ ref: "pkg:npm/fastify@5.0.0", dependsOn: [] }],
    compositions: [{ aggregate: "unknown", assemblies: ["pkg:npm/fastify@5.0.0"] }],
  };
  const paths = [
    "index.html",
    "reports/executive.html",
    "reports/decision.html",
    "reports/technical.html",
    "reports/security.html",
    "reports/coverage-limitations.html",
  ];
  const artifacts = paths.map((path) => artifact(path, safeHtml(path), "text/html"));
  for (const path of [
    "reports/executive.md",
    "reports/decision.md",
    "reports/technical.md",
    "reports/security.md",
    "reports/coverage-limitations.md",
  ])
    artifacts.push(
      artifact(path, `# ${path}\n\nSubstantive customer assessment content and evidence.\n`),
    );
  artifacts.push(
    artifact("data/run.json", JSON.stringify(run)),
    artifact(
      "data/target-snapshot.json",
      JSON.stringify({
        schemaVersion: "1.0.0",
        snapshotId: DIGEST,
        sourceKind: "local",
        sanitizedLocator: PROJECT,
        gitObjectFormat: "sha1",
        commitSha: COMMIT,
        baseCommitSha: COMMIT,
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
      }),
    ),
    artifact("data/product-claims.json", JSON.stringify(claims)),
    artifact("data/findings.json", JSON.stringify([finding])),
    artifact("data/controls.json", JSON.stringify([control])),
    artifact("data/coverage.json", JSON.stringify(coverage)),
    artifact("data/evidence-index.json", JSON.stringify([evidence])),
    artifact(
      "data/decision.json",
      JSON.stringify({
        schemaVersion: "1.0.0",
        runId: RUN_ID,
        criteria,
        recommendation: { kind: "single", option: "remediation" },
        rationale: "Focused repair is supported by the observed system boundaries.",
        confidence: "high",
        assumptions: [],
        dependencies: [],
        reversalConditions: [],
      }),
    ),
    artifact("data/reviews.json", JSON.stringify(reviews)),
    artifact(
      "data/equivalence-certificate.json",
      JSON.stringify({
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
      }),
    ),
    artifact(
      "data/screenshots.json",
      JSON.stringify([
        {
          screenshotId: "screenshots-none",
          title: "Runtime screenshots",
          status: "unavailable",
          unavailableReason: "A safe runtime was blocked because credentials were unavailable.",
        },
      ]),
    ),
    artifact("exports/findings.sarif.json", JSON.stringify(sarif), "application/sarif+json"),
    artifact("exports/sbom.cdx.json", JSON.stringify(cyclone), "application/vnd.cyclonedx+json"),
    artifact(
      "exports/findings.csv",
      '"finding_id","title"\r\n"F-1","Shared privileged access"\r\n',
      "text/csv",
    ),
    artifact("licenses/NOTICE.txt", "Repository Assessment Kit dependency notices.\n"),
    {
      ...artifact("evidence/item.txt", "Validated authentication source evidence.\n"),
      evidenceOccurrenceIds: ["EV-1"],
    },
  );
  return artifacts;
}

async function outputDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rak-package-test-"));
  const generated = join(root, "generated");
  await mkdir(generated);
  const runDirectory = join(generated, `${PROJECT}-${COMMIT}-20260728T000000Z`);
  await mkdir(runDirectory);
  return runDirectory;
}

async function options(
  packageBaseName: string,
  artifacts = fullArtifacts(),
): Promise<CreatePackageOptions> {
  const base = {
    outputDirectory: await outputDirectory(),
    packageBaseName,
    projectSlug: PROJECT,
    commitSha: COMMIT,
    runId: RUN_ID,
    snapshotId: DIGEST,
    generatedAt: NOW,
    artifacts,
  };
  return {
    ...base,
    releasePrerequisites: buildPackageReleasePrerequisites({
      ...base,
      validatorId: "test-trusted-validator",
      evidenceOccurrenceIds: ["EV-1"],
      validationReportDigests: {
        ADMISSION_COMPLETE: DIGEST,
        REDACTION_COMPLETE: DIGEST,
        REVIEWS_COMPLETE: DIGEST,
        STAGING_FROZEN: DIGEST,
      },
    }),
  };
}

async function optionsWithInvalidArtifacts(
  packageBaseName: string,
  artifacts: PackageArtifact[],
): Promise<CreatePackageOptions> {
  const result = await options(packageBaseName);
  result.artifacts = artifacts;
  return result;
}

describe("package safety", () => {
  it("creates deterministic ZIPs and validates reopened checksums", async () => {
    const first = await createCustomerPackage(await options("customer-assessment"));
    const second = await createCustomerPackage(await options("customer-assessment"));
    const firstBytes = await readFile(first.zipPath);
    const secondBytes = await readFile(second.zipPath);
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(first.stageCertificates).toHaveLength(8);
    expect(first.releaseStatus).toBe("validated-not-released");
    expect(first.stages).not.toContain("RELEASED");
    expect(first.standardsValidation.officialSchemas.releaseBlocking).toBe(true);
    expect(reopenZip(firstBytes).map(({ path }) => path)).toContain("manifest.json");
  });

  it("detects ZIP and detached-digest tampering", async () => {
    const result = await createCustomerPackage(await options("tamper"));
    const bytes = await readFile(result.zipPath);
    const offset = bytes.indexOf(Buffer.from("Validated authentication"));
    bytes[offset] = (bytes[offset] ?? 0) ^ 1;
    expect(() => validateReopenedZip(bytes, result.manifest)).toThrow(/CRC mismatch/);
    expect(() => verifyDetachedDigest(bytes, `${result.zipSha256}  tamper.zip\n`)).toThrow(
      /digest mismatch/,
    );
    const persisted = await createCustomerPackage(await options("persisted-tamper"));
    const independent = await validatePersistedZipInFreshProcess(persisted.zipPath);
    expect(independent.processId).not.toBe(process.pid);
    const persistedBytes = await readFile(persisted.zipPath);
    const persistedOffset = persistedBytes.indexOf(Buffer.from("Validated authentication"));
    persistedBytes[persistedOffset] = (persistedBytes[persistedOffset] ?? 0) ^ 1;
    await writeFile(persisted.zipPath, persistedBytes);
    await expect(validatePersistedZipInFreshProcess(persisted.zipPath)).rejects.toThrow(
      /Fresh-process ZIP validation failed/,
    );
  });

  it("rejects unsafe and colliding paths", async () => {
    for (const unsafe of ["../secret", "/etc/passwd", "C:\\Users\\secret", "a//b"]) {
      expect(() => validateArchivePath(unsafe)).toThrow(/Unsafe archive path/);
    }
    await expect(
      createCustomerPackage(
        await optionsWithInvalidArtifacts("duplicate", [
          ...fullArtifacts(),
          artifact("evidence/item.txt", "duplicate"),
        ]),
      ),
    ).rejects.toThrow(/Duplicate package path/);
    await expect(
      createCustomerPackage(
        await optionsWithInvalidArtifacts("collision", [
          ...fullArtifacts(),
          artifact("Evidence/ITEM.TXT", "collision"),
        ]),
      ),
    ).rejects.toThrow(/collision/);
  });

  it("cannot override or omit the frozen required inventory", async () => {
    await expect(
      createCustomerPackage({ ...(await options("override")), requiredPaths: [] }),
    ).rejects.toThrow(/cannot be overridden/);
    const incomplete = fullArtifacts().filter(({ path }) => path !== "reports/executive.md");
    await expect(createCustomerPackage(await options("incomplete", incomplete))).rejects.toThrow(
      /Required customer artifact is missing/,
    );
  });

  it("requires final redaction and all release prerequisites", async () => {
    const pending = fullArtifacts();
    (
      pending.find(({ path }) => path === "evidence/item.txt") as unknown as Record<string, unknown>
    )["redactionState"] = "pending";
    await expect(
      createCustomerPackage(await optionsWithInvalidArtifacts("pending", pending)),
    ).rejects.toThrow(/redaction is not final/);
    const fabricated = await options("fabricated-certificate");
    fabricated.releasePrerequisites.certificates[0]!.outputDigest = DIGEST;
    await expect(createCustomerPackage(fabricated)).rejects.toThrow(
      /digest or derivation is invalid/,
    );
  });

  it("derives output eligibility from frozen evidence and provenance and fails closed", async () => {
    const missing = fullArtifacts();
    delete (missing[0] as unknown as { eligibility?: unknown }).eligibility;
    await expect(
      createCustomerPackage(await optionsWithInvalidArtifacts("missing-provenance", missing)),
    ).rejects.toThrow(/evidence\/provenance eligibility proof is required/);

    for (const [name, outputClass, activityKind, evidenceType, sensitivity] of [
      ["o1-relabeled", "O1-secret-control", "secret-control", "secret-control", "restricted"],
      [
        "o2-relabeled",
        "O2-credential-tainted-raw",
        "credential-tainted-capture",
        "credential-tainted-raw",
        "restricted",
      ],
    ] as const) {
      const artifacts = fullArtifacts();
      const candidate = artifacts[0]!;
      candidate.artifactKind = "benign-customer-summary";
      candidate.sensitivity = "public";
      const source = candidate.eligibility.sources[0]!;
      source.activity.kind = activityKind;
      source.occurrence.evidenceType = evidenceType;
      source.occurrence.sensitivity = sensitivity;
      source.occurrence.collectionLimitations = [`rak-output-class:${outputClass}`];
      await expect(
        createCustomerPackage(await optionsWithInvalidArtifacts(name, artifacts)),
      ).rejects.toThrow(new RegExp(`${outputClass} is prohibited`));
    }

    const o3Artifacts = fullArtifacts();
    const o3 = o3Artifacts.find(({ path }) => path === "evidence/item.txt")!;
    o3.content = JSON.stringify({
      schemaVersion: "1.0.0",
      controlId: "AUTH-1",
      result: "pass",
    });
    const o3Source = o3.eligibility.sources[0]!;
    o3Source.activity.kind = "trusted-credential-derivation";
    o3Source.occurrence.evidenceType = "trusted-credential-derivative";
    o3Source.occurrence.collectionLimitations = ["rak-output-class:O3-trusted-derivative"];
    o3Source.occurrence.derivedFromEvidenceIds = ["restricted-o2-source"];
    o3Source.deterministicValidation = {
      validatorId: "rak-o3-deterministic-validator/1.0.0",
      inputDigest: canonicalDigestForTest({
        occurrence: o3Source.occurrence,
        activity: o3Source.activity,
      }),
      outputDigest: createHash("sha256").update(String(o3.content)).digest("hex"),
      status: "passed",
    };
    await expect(
      createCustomerPackage(await optionsWithInvalidArtifacts("o3-no-review", o3Artifacts)),
    ).rejects.toThrow(/technical-human review proof is missing/);

    const forgedO4Artifacts = fullArtifacts();
    const forgedO4 = forgedO4Artifacts.find(({ path }) => path === "evidence/item.txt")!;
    const forgedO4Source = forgedO4.eligibility.sources[0]!;
    forgedO4Source.activity.kind = "technical-human-summary";
    forgedO4Source.occurrence.evidenceType = "credential-derived-human-summary";
    forgedO4Source.occurrence.collectionLimitations = ["rak-output-class:O4-human-summary"];
    forgedO4Source.occurrence.derivedFromEvidenceIds = ["unproven-o3-parent"];
    forgedO4Source.technicalHumanReview = {
      reviewId: "review-3",
      kind: "technical-human",
      verdict: "passed",
      inputDigest: DIGEST,
      evidenceOccurrenceIds: ["EV-1"],
    };
    await expect(
      createCustomerPackage(
        await optionsWithInvalidArtifacts("forged-o4-parent", forgedO4Artifacts),
      ),
    ).rejects.toThrow(/not bound to a validated O3 parent/);
  });

  it("blocks active HTML, external resources, and event handlers", async () => {
    for (const hostile of [
      '<script>fetch("https://evil.invalid")</script>',
      '<iframe src="https://evil.invalid"></iframe>',
      '<form action="https://evil.invalid"></form>',
      '<p onclick="alert(1)">Click</p>',
      '<img src="https://evil.invalid/tracker.png">',
    ]) {
      const artifacts = fullArtifacts();
      artifacts.find(({ path }) => path === "index.html")!.content = `<!doctype html>${hostile}`;
      await expect(createCustomerPackage(await options("active-html", artifacts))).rejects.toThrow(
        /forbidden active HTML|unsafe or external HTML resource|active HTML attribute|unknown HTML/,
      );
    }
    const arbitraryCss = "body{background:hotpink}";
    const arbitraryHash = createHash("sha256").update(arbitraryCss).digest("base64");
    const artifacts = fullArtifacts();
    const index = artifacts.find(({ path }) => path === "index.html")!;
    index.content = String(index.content)
      .replace(LOCKED_REPORT_RENDERER_CSS, arbitraryCss)
      .replace(LOCKED_REPORT_RENDERER_CSS_SHA256, arbitraryHash);
    await expect(createCustomerPackage(await options("arbitrary-css", artifacts))).rejects.toThrow(
      /renderer CSS does not match the release lock/,
    );

    for (const [name, mutate] of [
      ["marquee", (html: string) => html.replace("</main>", "<marquee>unsafe</marquee></main>")],
      [
        "data-stylesheet",
        (html: string) =>
          html.replace(
            "<head>",
            '<head><link rel="stylesheet" href="data:text/css,body{display:none}">',
          ),
      ],
      ["unknown-element", (html: string) => html.replace("</main>", "<blink>x</blink></main>")],
      [
        "unknown-attribute",
        (html: string) =>
          html.replace('<main id="main-content">', '<main id="main-content" x="1">'),
      ],
      [
        "data-download",
        (html: string) =>
          html.replace(
            'href="#main-content"',
            'href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;" download="payload.html"',
          ),
      ],
    ] as const) {
      const hostileArtifacts = fullArtifacts();
      const hostileIndex = hostileArtifacts.find(({ path }) => path === "index.html")!;
      hostileIndex.content = mutate(String(hostileIndex.content));
      await expect(
        createCustomerPackage(await options(`active-html-${name}`, hostileArtifacts)),
      ).rejects.toThrow(
        /forbidden active HTML|unknown HTML|active download payload|canonical serialization/,
      );
    }
  });

  it("blocks common secrets, host paths, placeholders, and SSH material", async () => {
    for (const [name, content, message] of [
      ["aws", "AKIAIOSFODNN7EXAMPLE", /secret/],
      ["etc", "read /etc/passwd", /host path/],
      ["placeholder", "literal PLACEHOLDER", /placeholder/],
      ["ssh", "-----BEGIN OPENSSH PRIVATE KEY-----", /SSH|private-key/],
    ] as const) {
      const artifacts = fullArtifacts();
      artifacts.find(({ path }) => path === "evidence/item.txt")!.content = content;
      await expect(createCustomerPackage(await options(name, artifacts))).rejects.toThrow(message);
    }
  });

  it("rejects invalid native, SARIF, CycloneDX, and screenshot references", async () => {
    const cases: Array<[string, (artifacts: PackageArtifact[]) => void, RegExp]> = [
      [
        "decision",
        (artifacts) => {
          artifacts.find(({ path }) => path === "data/decision.json")!.content = JSON.stringify({
            schemaVersion: "1.0.0",
            runId: RUN_ID,
            criteria: [],
          });
        },
        /seven unique criteria/,
      ],
      [
        "sarif",
        (artifacts) => {
          const item = artifacts.find(({ path }) => path === "exports/findings.sarif.json")!;
          const value = JSON.parse(String(item.content)) as Record<string, unknown>;
          value["version"] = "2.0.0";
          item.content = JSON.stringify(value);
        },
        /SARIF version/,
      ],
      [
        "cyclone",
        (artifacts) => {
          const item = artifacts.find(({ path }) => path === "exports/sbom.cdx.json")!;
          const value = JSON.parse(String(item.content)) as Record<string, unknown>;
          const components = value["components"] as unknown[];
          components.push({ ...(components[0] as object) });
          item.content = JSON.stringify(value);
        },
        /Duplicate CycloneDX/,
      ],
      [
        "screenshot",
        (artifacts) => {
          artifacts.find(({ path }) => path === "data/screenshots.json")!.content =
            '[{"screenshotId":"shot","status":"captured","packageRelPath":"screenshots/missing.png","evidenceOccurrenceId":"EV-MISSING"}]';
        },
        /missing evidence/,
      ],
      [
        "duplicate-json-key",
        (artifacts) => {
          artifacts.find(({ path }) => path === "data/run.json")!.content =
            '{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}';
        },
        /invalid JSON/,
      ],
    ];
    for (const [name, mutate, message] of cases) {
      const artifacts = fullArtifacts();
      mutate(artifacts);
      await expect(createCustomerPackage(await options(name, artifacts))).rejects.toThrow(message);
    }
  });

  it("enforces the generated run-directory naming contract", async () => {
    const bad = await options("bad-directory");
    bad.outputDirectory = await mkdtemp(join(tmpdir(), "arbitrary-output-"));
    await expect(createCustomerPackage(bad)).rejects.toThrow(/generated\//);
  });

  it("rejects symlinks from a staging tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "rak-stage-"));
    await writeFile(join(root, "real.txt"), "safe");
    await symlink(join(root, "real.txt"), join(root, "alias.txt"));
    await expect(collectStagingArtifacts(root, {})).rejects.toThrow(/symlinks are prohibited/);
  });

  it("reports encryption unavailable and rejects recovery mismatch", async () => {
    expect(encryptionCapability(undefined)).toEqual(expect.objectContaining({ available: false }));
    const unavailableOptions = await options("plain-only");
    unavailableOptions.encryption = { requested: true };
    const unavailable = await createCustomerPackage(unavailableOptions);
    expect(unavailable.encryption.status).toBe("unavailable");

    const provider: StrongEncryptionProvider = {
      name: "test age harness",
      algorithm: "age-v1",
      trusted: true,
      async encryptAndVerify() {
        return { encrypted: Buffer.from("age-encrypted"), recoveredZipSha256: "0".repeat(64) };
      },
    };
    const encryptedOptions = await options("bad-recovery");
    encryptedOptions.encryption = { requested: true, provider };
    await expect(createCustomerPackage(encryptedOptions)).rejects.toThrow(/recovery digest/);
  });
});

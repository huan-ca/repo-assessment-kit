import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assessRepository,
  assessmentDomains,
  assertCoverageReconciles,
  projectCycloneDx,
  projectFindingsCsv,
  projectNativeJson,
  projectSarif,
  validateAssessmentReferences,
  validateCycloneDxProjection,
  validateNativeAssessmentProjection,
  validateSarifProjection,
} from "../src/index.js";

const fixtureRoot = path.resolve(import.meta.dirname, "../../../fixtures/ecosystems");
const fixtures = [
  ["node-typescript", "node"],
  ["python", "python"],
  ["go", "go"],
  ["java", "java"],
  ["dotnet", "dotnet"],
  ["ruby", "ruby"],
  ["php", "php"],
] as const;
const deterministicOptions = {
  runId: "run_01900000-0000-7000-a000-000000000001",
  snapshotId: "snp_01900000-0000-7000-a000-000000000001",
  generatedAt: "2026-07-28T00:00:00.000Z",
};

describe("deterministic repository assessment", () => {
  it.each(fixtures)(
    "detects the %s fixture as %s with reconciled coverage",
    async (directory, ecosystem) => {
      const assessment = await assessRepository(
        path.join(fixtureRoot, directory),
        deterministicOptions,
      );

      expect(assessment.ecosystems).toContain(ecosystem);
      expect(assessment.primaryEcosystem).toBe(ecosystem);
      expect(assessment.reducedDepth).toBe(true);
      expect(assessment.coverage.map((item) => item.domainId)).toEqual(assessmentDomains);
      expect(() => assertCoverageReconciles(assessment.coverage)).not.toThrow();
      expect(assessment.tools.find((tool) => tool.toolId === "kit-walker")).toMatchObject({
        invocation: "invoked",
        outcome: "succeeded",
      });
      expect(
        assessment.tools
          .filter((tool) => tool.toolId !== "kit-walker")
          .every((tool) => tool.invocation === "not-invoked" && tool.outcome === "not-run"),
      ).toBe(true);
      expect(assessment.securityProfileSignals[0]).toMatchObject({
        profileId: "OWASP-ASVS/5.0.0/L1",
        kind: "baseline",
        application: "always-applied",
        state: "applied-reduced-depth",
        coverage: expect.objectContaining({ status: "partial" }),
      });
    },
  );

  it("uses explicit reduced-depth generic fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-generic-"));
    await writeFile(path.join(root, "README.md"), "# Unfamiliar repository\n", "utf8");

    const assessment = await assessRepository(root, deterministicOptions);

    expect(assessment.primaryEcosystem).toBe("generic");
    expect(assessment.reducedDepth).toBe(true);
    expect(assessment.limitations).toContain(
      "No first-class ecosystem was detected; generic static coverage is explicitly reduced-depth.",
    );
    expect(
      assessment.coverage.find((coverage) => coverage.domainId === "stack-detection")
        ?.unsupportedEcosystems,
    ).toEqual(["generic"]);
  });

  it("never follows symlinks and reports bounded exclusions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-symlink-"));
    const outside = await mkdtemp(path.join(tmpdir(), "rak-outside-"));
    await writeFile(path.join(outside, "private.txt"), "password=should-never-be-read", "utf8");
    await symlink(path.join(outside, "private.txt"), path.join(root, "escape.txt"));

    const assessment = await assessRepository(root, deterministicOptions);

    expect(assessment.files).toEqual([
      expect.objectContaining({
        repoRelPath: "escape.txt",
        classification: "symlink",
        exclusionReason: "symlinks are recorded but never followed",
      }),
    ]);
    expect(projectNativeJson(assessment)).not.toContain("should-never-be-read");
    expect(
      assessment.coverage.find((coverage) => coverage.domainId === "repository-composition")
        ?.status,
    ).toBe("partial");
  });

  it("reports malformed manifests as limitations rather than clean inventory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-malformed-"));
    await writeFile(path.join(root, "package.json"), '{"dependencies":', "utf8");

    const assessment = await assessRepository(root, deterministicOptions);

    expect(assessment.primaryEcosystem).toBe("node");
    expect(assessment.dependencies).toEqual([]);
    expect(assessment.limitations).toContain(
      "package.json: malformed manifest; dependency extraction skipped",
    );
    expect(
      assessment.coverage.find((coverage) => coverage.domainId === "dependency-inventory")?.status,
    ).toBe("partial");
  });

  it("excludes invalid UTF-8 instead of lossy parsing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-invalid-utf8-"));
    await writeFile(path.join(root, "source.ts"), Buffer.from([0xc3, 0x28]));

    const assessment = await assessRepository(root, deterministicOptions);

    expect(assessment.files).toEqual([
      expect.objectContaining({
        repoRelPath: "source.ts",
        classification: "excluded",
        exclusionReason: "invalid UTF-8",
      }),
    ]);
    expect(assessment.composition.exclusions).toContain("source.ts: invalid UTF-8");
  });

  it("extracts honest feature, architecture, maintainability, and runtime signals", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-signals-"));
    await mkdir(path.join(root, "src", "routes"), { recursive: true });
    await writeFile(
      path.join(root, "src", "routes", "users.ts"),
      'router.get("/users", handler); // TODO validate pagination\n',
      "utf8",
    );
    await writeFile(path.join(root, "README.md"), "# Customer portal\n", "utf8");
    await writeFile(path.join(root, "Dockerfile"), "FROM scratch\n", "utf8");

    const assessment = await assessRepository(root, deterministicOptions);

    expect(assessment.featureCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "/users",
          provenance: "code-inferred",
          confidence: "medium",
        }),
        expect.objectContaining({
          name: "Customer portal",
          provenance: "documented",
          confidence: "low",
        }),
      ]),
    );
    const evidenceIds = new Set(assessment.evidence.map((item) => item.evidenceId));
    expect(
      assessment.featureCatalog.every((feature) =>
        feature.evidenceOccurrenceIds.every((id) => evidenceIds.has(id)),
      ),
    ).toBe(true);
    const broken = structuredClone(assessment);
    if (broken.featureCatalog[0] !== undefined) {
      broken.featureCatalog[0].evidenceOccurrenceIds = ["evd_missing"];
      expect(() => validateAssessmentReferences(broken)).toThrow(/references missing evidence/u);
    }
    expect(assessment.architectureSignals.length).toBeGreaterThan(0);
    expect(assessment.maintainabilitySignals).toContainEqual(
      expect.objectContaining({ signal: "todo-fixme-markers", value: "1" }),
    );
    expect(assessment.runtimeReadiness).toContainEqual(
      expect.objectContaining({ signal: "Dockerfile", status: "observed" }),
    );
  });

  it("preserves distinct same-line occurrences across a repo-like multi-file tree", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-occurrences-"));
    await mkdir(path.join(root, "apps", "api", "src"), { recursive: true });
    await mkdir(path.join(root, "packages", "security", "src"), { recursive: true });
    await mkdir(path.join(root, "config"), { recursive: true });
    await writeFile(
      path.join(root, "apps", "api", "src", "routes.ts"),
      'router.get("/health", health); router.get("/ready", ready);\n',
      "utf8",
    );
    await writeFile(
      path.join(root, "packages", "security", "src", "digests.ts"),
      'export const algorithms = ["md5", "sha1"];\n',
      "utf8",
    );
    await writeFile(
      path.join(root, "config", "example.env"),
      "password=not-a-real-secret password=also-not-a-real-secret\n",
      "utf8",
    );

    const first = await assessRepository(root, deterministicOptions);
    const second = await assessRepository(root, deterministicOptions);
    const evidenceIds = first.evidence.map((item) => item.evidenceId);
    const findingIds = first.findings.map((item) => item.findingId);
    const featureIds = first.featureCatalog.map((item) => item.featureId);

    expect(new Set(evidenceIds).size).toBe(evidenceIds.length);
    expect(new Set(findingIds).size).toBe(findingIds.length);
    expect(new Set(featureIds).size).toBe(featureIds.length);
    expect(
      first.evidence.filter(
        (item) =>
          item.repoRelPath === "apps/api/src/routes.ts" &&
          item.evidenceType === "feature-route-signal",
      ),
    ).toHaveLength(2);
    expect(
      first.evidence.filter(
        (item) =>
          item.repoRelPath === "packages/security/src/digests.ts" &&
          item.evidenceType === "static-pattern-match",
      ),
    ).toHaveLength(2);
    expect(
      first.evidence.filter(
        (item) =>
          item.repoRelPath === "config/example.env" && item.evidenceType === "secret-pattern-match",
      ),
    ).toHaveLength(2);
    expect(() => validateAssessmentReferences(first)).not.toThrow();
    expect(projectNativeJson(first)).toBe(projectNativeJson(second));
  });

  it("drops seeded secret values from all native and projected outputs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-secret-"));
    const fakeSecret = `AKIA${"Z".repeat(16)}`;
    await writeFile(
      path.join(root, ".env"),
      `API_KEY=${fakeSecret}\ntrace=/home/customer/private/file.ts\n`,
      "utf8",
    );

    const assessment = await assessRepository(root, deterministicOptions);
    const outputs = [
      projectNativeJson(assessment),
      JSON.stringify(projectSarif(assessment)),
      JSON.stringify(projectCycloneDx(assessment)),
      projectFindingsCsv(assessment),
    ];

    expect(assessment.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "secret-detection",
          evidenceOccurrenceIds: [expect.stringMatching(/^evd_/u)],
        }),
      ]),
    );
    for (const output of outputs) {
      expect(output).not.toContain(fakeSecret);
      expect(output).not.toContain("/home/customer");
    }
  });

  it("redacts temporary host paths from feature claims and native output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-host-path-"));
    await writeFile(
      path.join(root, "README.md"),
      "# Customer portal /tmp/customer/private/source\n",
      "utf8",
    );

    const assessment = await assessRepository(root, deterministicOptions);
    const native = projectNativeJson(assessment);

    expect(assessment.featureCatalog[0]?.name).toContain("[REDACTED HOST PATH]");
    expect(native).not.toContain("/tmp/customer");
  });

  it("rejects contradictory coverage aggregates and missing non-pass reasons", async () => {
    const assessment = await assessRepository(
      path.join(fixtureRoot, "node-typescript"),
      deterministicOptions,
    );
    const forged = assessment.coverage.map((coverage) => ({
      ...coverage,
      status: "pass" as const,
      counts: {
        pass: 0,
        fail: 0,
        partial: 1,
        blocked: 0,
        "not applicable": 0,
        "not tested": 0,
      },
      limitationIds: [],
      exclusions: [],
      evidenceOccurrenceIds: [],
    }));

    expect(() => assertCoverageReconciles(forged)).toThrow(/contradicts counts/u);

    const missingReason = assessment.coverage.map((coverage) =>
      coverage.domainId === "architecture-boundaries"
        ? {
            ...coverage,
            limitationIds: [],
            exclusions: [],
            evidenceOccurrenceIds: [],
          }
        : coverage,
    );
    expect(() => assertCoverageReconciles(missingReason)).toThrow(/lacks a reason or evidence/u);
  });

  it("reports unsupported npm lockfile versions as opaque reduced coverage", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-lock-version-"));
    await writeFile(path.join(root, "package.json"), '{"name":"fixture"}', "utf8");
    await writeFile(
      path.join(root, "package-lock.json"),
      '{"name":"fixture","lockfileVersion":999,"packages":{}}',
      "utf8",
    );

    const assessment = await assessRepository(root, deterministicOptions);

    expect(assessment.limitations).toContain(
      "package-lock.json: unsupported npm lockfileVersion 999; retained as opaque inventory evidence and dependency depth reduced",
    );
    expect(assessment.reducedDepth).toBe(true);
  });

  it("distinguishes evidence-triggered deeper security profiles from the baseline", async () => {
    const assessment = await assessRepository(
      path.join(fixtureRoot, "python"),
      deterministicOptions,
    );

    expect(assessment.securityProfileSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "OWASP-ASVS/5.0.0/L1",
          kind: "baseline",
          application: "always-applied",
          state: "applied-reduced-depth",
        }),
        expect.objectContaining({
          profileId: "OWASP-ASVS/5.0.0/L2",
          kind: "overlay-recommendation",
          application: "recommended-only",
          state: "recommended-not-confirmed",
          customerConfirmationRequired: true,
          customerConfirmed: false,
          trigger: expect.stringContaining("flask"),
        }),
      ]),
    );
  });

  it("applies supported customer-confirmed overlays distinctly from recommendations", async () => {
    const assessment = await assessRepository(path.join(fixtureRoot, "python"), {
      ...deterministicOptions,
      selectedSecurityOverlayIds: ["OWASP-ASVS/5.0.0/L2", "OWASP-WSTG/4.2"],
      securityOverlayApplication: {
        customerConfirmed: true,
        confirmationReference: "discovery-revision-7",
      },
    });
    const baseline = assessment.securityProfileSignals.find(
      (profile) => profile.kind === "baseline",
    );
    const selected = assessment.securityProfileSignals.filter(
      (profile) => profile.kind === "selected-overlay",
    );

    expect(baseline).toMatchObject({
      application: "always-applied",
      coverage: { status: "partial" },
    });
    expect(selected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "OWASP-ASVS/5.0.0/L2",
          customerConfirmationRequired: true,
          customerConfirmed: true,
          confirmationReference: "discovery-revision-7",
          coverage: expect.objectContaining({ status: "partial" }),
        }),
        expect.objectContaining({
          profileId: "OWASP-WSTG/4.2",
          coverage: expect.objectContaining({ status: "blocked" }),
        }),
      ]),
    );
    expect(
      assessment.securityProfileSignals.some(
        (profile) =>
          profile.profileId === "OWASP-ASVS/5.0.0/L2" && profile.kind === "overlay-recommendation",
      ),
    ).toBe(false);
  });

  it("rejects unsupported, duplicate, and unconfirmed overlay selections", async () => {
    const root = path.join(fixtureRoot, "python");
    await expect(
      assessRepository(root, {
        ...deterministicOptions,
        selectedSecurityOverlayIds: ["UNSUPPORTED/9.9"] as never,
        securityOverlayApplication: {
          customerConfirmed: true,
          confirmationReference: "confirmation",
        },
      }),
    ).rejects.toThrow(/Unsupported security overlay/u);
    await expect(
      assessRepository(root, {
        ...deterministicOptions,
        selectedSecurityOverlayIds: ["OWASP-ASVS/5.0.0/L2", "OWASP-ASVS/5.0.0/L2"],
        securityOverlayApplication: {
          customerConfirmed: true,
          confirmationReference: "confirmation",
        },
      }),
    ).rejects.toThrow(/must be unique/u);
    await expect(
      assessRepository(root, {
        ...deterministicOptions,
        selectedSecurityOverlayIds: ["OWASP-ASVS/5.0.0/L2"],
      }),
    ).rejects.toThrow(/require customer confirmation/u);
  });

  it("neutralizes formula-leading CSV fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-csv-formula-"));
    await writeFile(path.join(root, "=2+2.js"), 'eval("fixture")', "utf8");

    const assessment = await assessRepository(root, deterministicOptions);
    const csv = projectFindingsCsv(assessment);

    expect(csv).toContain(`"'=2+2.js:1"`);
    expect(csv).not.toContain(`"=2+2.js:1"`);
  });

  it("creates standards-shaped, deterministic machine projections", async () => {
    const assessment = await assessRepository(
      path.join(fixtureRoot, "node-typescript"),
      deterministicOptions,
    );
    const sarif = projectSarif(assessment);
    const cycloneDx = projectCycloneDx(assessment, "fixture");
    const csv = projectFindingsCsv(assessment);

    expect(sarif).toMatchObject({ version: "2.1.0", runs: [expect.any(Object)] });
    expect(cycloneDx).toMatchObject({
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      compositions: [{ aggregate: "unknown", assemblies: ["assessed-application"] }],
    });
    expect(csv).toMatch(/^"findingId","title"/u);
    expect(projectNativeJson(assessment)).toBe(projectNativeJson(assessment));
    expect(() => validateSarifProjection(sarif, assessment)).not.toThrow();
    expect(() => validateCycloneDxProjection(cycloneDx)).not.toThrow();
  });

  it("emits structured CWE taxonomy and rejects malformed projections", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rak-projection-validation-"));
    await writeFile(path.join(root, "source.js"), 'eval("fixture")', "utf8");
    const assessment = await assessRepository(root, deterministicOptions);
    const sarif = projectSarif(assessment);
    const run = (
      sarif["runs"] as Array<{
        taxonomies: Array<{ name: string; version: string; taxa: unknown[] }>;
        results: Array<{ taxa: unknown[] }>;
      }>
    )[0];

    expect(run?.taxonomies).toEqual([
      expect.objectContaining({
        name: "CWE",
        version: "4.20",
        taxa: [expect.objectContaining({ id: "CWE-95" })],
      }),
    ]);
    expect(run?.results[0]?.taxa).toEqual([expect.objectContaining({ id: "CWE-95" })]);
    expect(() => validateSarifProjection({ ...sarif, version: "2.0.0" }, assessment)).toThrow(
      /frozen 2.1.0/u,
    );

    const cycloneDx = projectCycloneDx(assessment);
    expect(() => validateCycloneDxProjection({ ...cycloneDx, specVersion: "1.6" })).toThrow(
      /frozen 1.7/u,
    );
  });

  it("rejects unknown top-level and critical nested projection properties", async () => {
    const assessment = await assessRepository(
      path.join(fixtureRoot, "python"),
      deterministicOptions,
    );
    expect(() =>
      validateNativeAssessmentProjection({
        ...assessment,
        unknownForbiddenByStrictRakSchema: true,
      }),
    ).toThrow(/unknown properties/u);
    const missingNative = structuredClone(assessment) as Partial<typeof assessment>;
    delete missingNative.runId;
    expect(() => validateNativeAssessmentProjection(missingNative)).toThrow(
      /missing required properties/u,
    );
    expect(() =>
      projectNativeJson({
        ...assessment,
        unknownForbiddenByStrictRakSchema: true,
      } as typeof assessment),
    ).toThrow(/unknown properties/u);

    const sarif = projectSarif(assessment);
    expect(() =>
      validateSarifProjection({ ...sarif, unknownForbiddenByStrictSarifProfile: true }, assessment),
    ).toThrow(/unknown properties/u);
    const missingSarif = structuredClone(sarif);
    delete missingSarif["runs"];
    expect(() => validateSarifProjection(missingSarif, assessment)).toThrow(
      /missing required properties/u,
    );
    const nestedSarif = structuredClone(sarif) as {
      runs: Array<{ tool: { driver: Record<string, unknown> } }>;
    };
    nestedSarif.runs[0]!.tool.driver["unknownDriverProperty"] = true;
    expect(() => validateSarifProjection(nestedSarif, assessment)).toThrow(/unknown properties/u);

    const cycloneDx = projectCycloneDx(assessment);
    expect(() =>
      validateCycloneDxProjection({
        ...cycloneDx,
        unknownForbiddenByStrictCycloneDxProfile: true,
      }),
    ).toThrow(/unknown properties/u);
    const missingCycloneDx = structuredClone(cycloneDx);
    delete missingCycloneDx["metadata"];
    expect(() => validateCycloneDxProjection(missingCycloneDx)).toThrow(
      /missing required properties/u,
    );
    const nestedCycloneDx = structuredClone(cycloneDx) as {
      metadata: Record<string, unknown>;
    };
    nestedCycloneDx.metadata["unknownMetadataProperty"] = true;
    expect(() => validateCycloneDxProjection(nestedCycloneDx)).toThrow(/unknown properties/u);
  });
});

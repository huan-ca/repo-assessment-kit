import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reopenZip } from "../packages/packaging/dist/index.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/run-offline-assessment.mjs");
const NOW = "2026-07-28T12:34:56.000Z";
const SECRET = "AKIAIOSFODNN7EXAMPLE";
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
] as const;

interface Fixture {
  name: string;
  source: string;
  output: string;
  expectedEcosystem: string;
}

let temporaryRoot: string;
let discoveryPath: string;
let fixtures: Fixture[];

function run(command: string, arguments_: string[], cwd: string): string {
  return execFileSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

async function sourceDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (relativeDirectory === "" && child.name === ".git") continue;
      const relativePath =
        relativeDirectory === "" ? child.name : `${relativeDirectory}/${child.name}`;
      const absolutePath = path.join(directory, child.name);
      const info = await lstat(absolutePath);
      hash.update(relativePath);
      hash.update(String(info.mode & 0o777));
      if (info.isDirectory()) await visit(absolutePath, relativePath);
      else hash.update(await readFile(absolutePath));
    }
  }
  await visit(root, "");
  return hash.digest("hex");
}

async function createFixture(
  name: string,
  expectedEcosystem: string,
  files: Record<string, string>,
): Promise<Fixture> {
  const source = path.join(temporaryRoot, `source-${name}`);
  const output = path.join(temporaryRoot, `output-${name}`);
  await mkdir(source);
  await mkdir(output);
  await writeTree(source, files);
  run("git", ["init", "-q"], source);
  run("git", ["config", "user.email", "fixture@example.invalid"], source);
  run("git", ["config", "user.name", "Fixture"], source);
  run("git", ["add", "."], source);
  run("git", ["commit", "-qm", "fixture"], source);
  return { name, source, output, expectedEcosystem };
}

function invoke(
  fixture: Fixture,
  output = fixture.output,
): {
  status: string;
  runDirectory: string;
  zipPath: string;
  validationCertificatePath: string;
  commitSha: string;
  sourceIntegrityDigest: string;
} {
  return JSON.parse(
    run(
      process.execPath,
      [
        SCRIPT,
        "--source",
        fixture.source,
        "--project",
        `fixture-${fixture.name}`,
        "--discovery",
        discoveryPath,
        "--output-root",
        output,
        "--generated-at",
        NOW,
      ],
      ROOT,
    ),
  );
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "rak-offline-integration-"));
  discoveryPath = path.join(temporaryRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    JSON.stringify({
      topics: Object.fromEntries(
        TOPICS.map((topic) => [
          topic,
          {
            unknown: {
              reason: "The fixture has no software owner interview.",
              confidenceEffect: "Decision confidence remains low.",
              coverageEffect: "Repository evidence cannot confirm this business context.",
              followUp: "The engagement owner must provide this context before release.",
            },
            provenance: "unverified",
            confidence: "low",
          },
        ]),
      ),
    }),
  );
  fixtures = await Promise.all([
    createFixture("node", "node", {
      "package.json": JSON.stringify({
        name: "fixture-node",
        version: "1.0.0",
        scripts: { preinstall: "touch EXECUTED" },
        dependencies: { express: "5.0.0" },
      }),
      "src/server.js": "export function health() { return { ok: true }; }\n",
      "README.md": `# Customer portal\n\nSeeded credential ${SECRET}\n`,
    }),
    createFixture("python", "python", {
      "pyproject.toml": "[project]\nname='fixture-python'\nversion='1.0.0'\n",
      "app.py": "def health():\n    return {'ok': True}\n",
      "README.md": "# Reporting workflow\n",
    }),
    createFixture("go", "go", {
      "go.mod": "module example.invalid/fixture\n\ngo 1.24\n",
      "main.go": "package main\nfunc main() {}\n",
      "README.md": "# Import service\n",
    }),
    createFixture("java", "java", {
      "pom.xml":
        "<project><modelVersion>4.0.0</modelVersion><groupId>x</groupId><artifactId>fixture</artifactId><version>1</version></project>",
      "src/main/java/App.java": "public class App { public static void main(String[] x) {} }\n",
      "README.md": "# Administration console\n",
    }),
    createFixture("dotnet", "dotnet", {
      "Fixture.csproj":
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>',
      "Program.cs": 'System.Console.WriteLine("fixture");\n',
      "README.md": "# Billing workflow\n",
    }),
    createFixture("ruby", "ruby", {
      Gemfile: "source 'https://rubygems.org'\ngem 'rack', '3.1.0'\n",
      "app.rb": "class App; end\n",
      "README.md": "# Account workflow\n",
    }),
    createFixture("php", "php", {
      "composer.json": JSON.stringify({
        name: "example/fixture",
        require: { "laravel/framework": "11.0.0" },
      }),
      "index.php": "<?php echo 'fixture';\n",
      "README.md": "# Support workflow\n",
    }),
  ]);
  await writeFile(
    path.join(fixtures[0]!.source, "README.md"),
    `# Customer portal\n\nSeeded credential ${SECRET}\n\nWorking-tree assessment note.\n`,
  );
  await mkdir(path.join(fixtures[0]!.source, "notes"));
  await writeFile(
    path.join(fixtures[0]!.source, "notes/untracked.txt"),
    "Untracked context is intentionally included in the frozen working tree.\n",
  );
});

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("offline local assessment orchestration", () => {
  it("assesses seven ecosystem repositories without mutation and emits honest validated drafts", async () => {
    for (const fixture of fixtures) {
      const before = await sourceDigest(fixture.source);
      const result = invoke(fixture);
      const after = await sourceDigest(fixture.source);

      expect(after).toBe(before);
      expect(await lstat(path.join(fixture.source, "EXECUTED")).catch(() => undefined)).toBe(
        undefined,
      );
      expect(result.status).toBe("DRAFT_VALIDATED_RELEASE_BLOCKED");
      expect(path.basename(result.runDirectory)).toMatch(
        new RegExp(`^fixture-${fixture.name}-${result.commitSha}-20260728T123456Z$`),
      );

      const validation = JSON.parse(await readFile(result.validationCertificatePath, "utf8"));
      expect(validation).toMatchObject({
        verdict: "DRAFT_VALIDATED_RELEASE_BLOCKED",
        customerReleaseAuthorized: false,
        zipReopenedInFreshParserInvocation: true,
      });
      expect(validation.releaseBlockers).toContain("technical human review");

      const zipBytes = await readFile(result.zipPath);
      expect(zipBytes.includes(Buffer.from(SECRET))).toBe(false);
      const entries = new Map(
        reopenZip(zipBytes).map(({ path: entryPath, content }) => [entryPath, content]),
      );
      const status = JSON.parse(
        Buffer.from(entries.get("data/package-status.json")!).toString("utf8"),
      );
      const screenshots = JSON.parse(
        Buffer.from(entries.get("data/screenshots.json")!).toString("utf8"),
      );
      const assessment = JSON.parse(
        Buffer.from(entries.get("data/assessment.json")!).toString("utf8"),
      );
      const claims = JSON.parse(
        Buffer.from(entries.get("data/product-claims.json")!).toString("utf8"),
      );
      const targetSnapshot = JSON.parse(
        Buffer.from(entries.get("data/target-snapshot.json")!).toString("utf8"),
      );
      const sourceIntegrity = JSON.parse(
        Buffer.from(entries.get("data/source-integrity.json")!).toString("utf8"),
      );
      const manifest = JSON.parse(Buffer.from(entries.get("manifest.json")!).toString("utf8"));
      const provenanceActivities = JSON.parse(
        Buffer.from(entries.get("data/provenance-activities.json")!).toString("utf8"),
      );
      const executive = Buffer.from(entries.get("reports/executive.md")!).toString("utf8");
      const decisionReport = Buffer.from(entries.get("reports/decision.md")!).toString("utf8");
      const coverageReport = Buffer.from(entries.get("reports/coverage-limitations.md")!).toString(
        "utf8",
      );

      expect(status.status).toBe("DRAFT_RELEASE_BLOCKED");
      expect(status.customerReleaseAuthorized).toBe(false);
      expect(manifest.entries).not.toHaveLength(0);
      expect(manifest.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eligibility: expect.objectContaining({
              outputClass: "O0-uncredentialed",
              proofDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            }),
          }),
        ]),
      );
      expect(
        manifest.entries.every(
          (entry: { eligibility?: { outputClass?: string } }) =>
            entry.eligibility?.outputClass === "O0-uncredentialed",
        ),
      ).toBe(true);
      expect(provenanceActivities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "uncredentialed-evidence-capture" }),
        ]),
      );
      expect(screenshots).toEqual([
        expect.objectContaining({
          status: "unavailable",
          unavailableReason: expect.stringContaining("disabled"),
        }),
      ]);
      expect(assessment.primaryEcosystem).toBe(fixture.expectedEcosystem);
      expect(assessment.tools).toHaveLength(8);
      expect(
        assessment.tools
          .filter(({ toolId }: { toolId: string }) => toolId !== "kit-walker")
          .every(
            ({
              availability,
              invocation,
              networkUsed,
              targetCodeExecuted,
            }: {
              availability: string;
              invocation: string;
              networkUsed: boolean;
              targetCodeExecuted: boolean;
            }) =>
              availability === "unavailable" &&
              invocation === "not-invoked" &&
              networkUsed === false &&
              targetCodeExecuted === false,
          ),
      ).toBe(true);
      expect(claims).toHaveLength(10);
      expect(claims.every(({ unknown }: { unknown?: unknown }) => unknown !== undefined)).toBe(
        true,
      );
      expect(executive).toContain("Evidenced strengths and recoverability");
      expect(executive).toContain("What could change the planning direction");
      expect(executive).toContain("Software owner decision:");
      expect(executive).toContain("Confidence effect: Decision confidence remains low");
      expect(executive).toContain(
        "Coverage effect: Repository evidence cannot confirm this business context",
      );
      expect(executive).not.toContain("stabilizing urgent risks");
      expect(decisionReport).not.toContain("remediate urgent verified risks");
      expect(decisionReport).toContain("Separation between system parts");
      expect(decisionReport).toContain("Preserving essential behavior");
      expect(decisionReport).not.toMatch(
        /\bSystem boundaries\b|\bCritical feature parity\b|\bRebuild feasibility\b|heuristic|seams|implementation debt|coexistence discipline|parity criteria|architecture review|runtime evidence|operational risk/i,
      );
      expect(coverageReport).toContain("Next action");
      expect(coverageReport).toContain("Software owner:");
      expect(coverageReport).toContain("Static inference only");
      expect(coverageReport).toContain("Reduced-depth built-in checks only");
      expect(coverageReport).toContain("Safe runtime readiness not exercised");
      expect(coverageReport).toContain("Required external analysis tool not run");
      expect(coverageReport).not.toMatch(/has \d+ recorded coverage limitation/i);
      expect(
        [...entries]
          .filter(([entryPath]) => entryPath.startsWith("reports/") && entryPath.endsWith(".md"))
          .map(([, content]) => Buffer.from(content).toString("utf8"))
          .join("\n"),
      ).not.toMatch(/\\[.(]/);
      expect(coverageReport).not.toMatch(/\|\s*(?:cov|lim)_[a-z0-9-]+\s*\|/i);
      if (assessment.findings.length === 0) {
        expect(executive).toContain("No admitted finding establishes an urgent verified risk");
        expect(executive).not.toContain("remediation of verified risks");
      }
      expect(sourceIntegrity).toMatchObject({
        mode: "frozen-working-tree",
        unchanged: true,
        before: {
          sourceDigest: result.sourceIntegrityDigest,
        },
        after: {
          sourceDigest: result.sourceIntegrityDigest,
        },
      });
      expect(sourceIntegrity.before.statusDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      if (fixture.name === "node") {
        expect(targetSnapshot).toMatchObject({
          mode: "frozen-working-tree",
          includedDirtyPaths: ["README.md", "notes/untracked.txt"],
          excludedDirtyPaths: [],
        });
      } else {
        expect(targetSnapshot.includedDirtyPaths).toEqual([]);
      }
    }
  }, 120_000);

  it("is byte-deterministic for the same source, discovery, and timestamp", async () => {
    const fixture = fixtures[0]!;
    const secondOutput = path.join(temporaryRoot, "output-node-repeat");
    await mkdir(secondOutput);
    const firstResult = JSON.parse(
      await readFile(
        path.join(
          fixture.output,
          (await readdir(fixture.output))[0]!,
          `fixture-node-${run("git", ["rev-parse", "HEAD"], fixture.source)}-20260728T123456Z-DRAFT.zip.validation.json`,
        ),
        "utf8",
      ),
    );
    const secondResult = invoke(fixture, secondOutput);
    const secondValidation = JSON.parse(
      await readFile(secondResult.validationCertificatePath, "utf8"),
    );
    expect(secondValidation.zipSha256).toBe(firstResult.zipSha256);
  });

  it("rejects hostile control-character paths without newline or NUL ambiguity", async () => {
    const fixture = await createFixture("hostile-path", "generic", {
      "README.md": "# Hostile path fixture\n",
    });
    await expect(
      writeFile(path.join(fixture.source, "impossible\0path.txt"), "not created"),
    ).rejects.toThrow();
    await writeFile(path.join(fixture.source, "line\nbreak.txt"), "hostile path");

    expect(() => invoke(fixture)).toThrow(/unsafe repository-relative path/u);
    expect(await readFile(path.join(fixture.source, "line\nbreak.txt"), "utf8")).toBe(
      "hostile path",
    );
    expect(await readdir(fixture.output)).toEqual([]);
  });
});

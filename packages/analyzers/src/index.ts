export const baselineAnalyzerIds = Object.freeze([
  "kit-walker",
  "scc",
  "syft",
  "osv-scanner",
  "gitleaks",
  "trivy",
  "opengrep",
  "pmd-cpd",
]);
export {
  loadReleaseSchemaRegistry,
  validateWithOfficialReleaseSchema,
  verifyReleaseSchemaAssets,
  type ReleaseSchemaAsset,
  type ReleaseSchemaKind,
  type ReleaseSchemaRegistry,
  type ReleaseSchemaValidation,
} from "./release-assets.js";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { validateWithOfficialReleaseSchema } from "./release-assets.js";

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
export type Ecosystem = "node" | "python" | "go" | "java" | "dotnet" | "ruby" | "php" | "generic";
export type CoverageStatus =
  | "pass"
  | "fail"
  | "partial"
  | "blocked"
  | "not applicable"
  | "not tested";

export const supportedSecurityOverlayIds = [
  "OWASP-ASVS/5.0.0/L2",
  "OWASP-ASVS/5.0.0/L3",
  "OWASP-WSTG/4.2",
  "NIST-SSDF/1.1",
] as const;
export type SupportedSecurityOverlayId = (typeof supportedSecurityOverlayIds)[number];

export interface ToolExecutionRecord {
  toolId: string;
  displayName: string;
  availability: "available" | "unavailable" | "not-configured";
  invocation: "invoked" | "not-invoked";
  outcome: "succeeded" | "failed" | "not-run";
  reasonCode?: string;
  reason?: string;
  networkUsed: false;
  targetCodeExecuted: false;
}

export interface RepositoryFile {
  repoRelPath: string;
  byteLength: number;
  extension: string;
  classification: "text" | "binary" | "symlink" | "excluded";
  exclusionReason?: string;
}

export interface StackSignal {
  ecosystem: Ecosystem;
  signal: string;
  repoRelPath: string;
  confidence: "high" | "medium" | "low";
}

export interface ArchitectureSignal {
  boundary: string;
  repoRelPath: string;
  provenance: "observed" | "code-inferred";
  limitation: string;
}

export interface FeatureCatalogItem {
  featureId: string;
  name: string;
  kind: "route" | "documented-capability" | "entrypoint";
  provenance: "documented" | "code-inferred";
  repoRelPath: string;
  line?: number;
  confidence: "medium" | "low";
  evidenceOccurrenceIds: string[];
  limitations: string[];
}

export interface DependencyComponent {
  bomRef: string;
  purl: string;
  ecosystem: Ecosystem;
  name: string;
  version?: string;
  scope: "required" | "development" | "unknown";
  repoRelPath: string;
}

export interface StaticFinding {
  schemaVersion: "1.0.0";
  findingId: string;
  runId: string;
  fingerprint: { algorithm: "rak-finding/v1"; value: string };
  revision: number;
  title: string;
  description: string;
  category: string;
  technicalSeverity: "critical" | "high" | "medium" | "low" | "informational";
  businessPriority: "unassigned";
  confidence: "high" | "medium" | "low";
  validationState: "unreviewed";
  evidenceOccurrenceIds: string[];
  locations: Array<{ repoRelPath: string; startLine?: number; endLine?: number }>;
  cweMappings: Array<{
    cweId: string;
    catalogVersion: "4.20";
    primary: true;
    method: "tool";
    confidence: "medium" | "low";
  }>;
  cvss: [];
  ruleId: string;
}

export interface EvidenceCandidate {
  evidenceId: string;
  evidenceType: string;
  title: string;
  repoRelPath: string;
  startLine?: number;
  safeExcerpt: string;
  sensitivity: "public" | "customer-confidential" | "secret-suspected" | "restricted";
  redactionState: "none-required" | "redacted" | "excluded";
  collectionLimitations: string[];
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

export interface RepositoryAssessment {
  schemaVersion: "1.0.0";
  profile: "rak-contract/1.0.0";
  runId: string;
  snapshotId: string;
  generatedAt: string;
  ecosystems: Ecosystem[];
  primaryEcosystem: Ecosystem;
  reducedDepth: boolean;
  files: RepositoryFile[];
  composition: {
    filesInspected: number;
    textFilesInspected: number;
    bytesInspected: string;
    extensions: Record<string, number>;
    exclusions: string[];
  };
  stackSignals: StackSignal[];
  architectureSignals: ArchitectureSignal[];
  maintainabilitySignals: Array<{
    signal: string;
    value: string;
    interpretation: string;
    limitation: string;
  }>;
  runtimeReadiness: Array<{
    signal: string;
    repoRelPath?: string;
    status: "observed" | "absent" | "unknown";
    limitation: string;
  }>;
  securityProfileSignals: Array<{
    profileId: string;
    kind: "baseline" | "selected-overlay" | "overlay-recommendation";
    application: "always-applied" | "operator-selected" | "recommended-only";
    state: "applied-reduced-depth" | "recommended-not-confirmed";
    customerConfirmationRequired: boolean;
    customerConfirmed: boolean;
    confirmationReference?: string;
    trigger: string;
    evidenceOccurrenceIds: string[];
    controls: Array<{
      controlId: string;
      status: "partial" | "blocked" | "not tested";
      reasonCode: string;
      reason: string;
      evidenceOccurrenceIds: string[];
    }>;
    coverage: {
      status: "partial" | "blocked" | "not tested";
      plannedControls: number;
      reconciledControls: number;
      counts: Record<CoverageStatus, number>;
    };
    limitation: string;
  }>;
  featureCatalog: FeatureCatalogItem[];
  dependencies: DependencyComponent[];
  findings: StaticFinding[];
  evidence: EvidenceCandidate[];
  tools: ToolExecutionRecord[];
  coverage: DomainCoverage[];
  limitations: string[];
}

export interface AssessRepositoryOptions {
  runId?: string;
  snapshotId?: string;
  generatedAt?: string;
  availableTools?: readonly string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  selectedSecurityOverlayIds?: readonly SupportedSecurityOverlayId[];
  securityOverlayApplication?: {
    customerConfirmed: true;
    confirmationReference: string;
  };
}

export const offlineProjectionSchemaProfiles = Object.freeze({
  nativeAssessment: Object.freeze({
    schemaId: "https://schemas.repo-assessment-kit.dev/rak/1.0/repository-assessment.schema.json",
    schemaVersion: "1.0.0",
    validation: "official-full-plus-rak-semantics",
    officialFullSchemaBundled: true,
    releaseGate: null,
  }),
  sarif: Object.freeze({
    schemaId:
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    schemaVersion: "2.1.0",
    validation: "official-full-plus-rak-semantics",
    officialFullSchemaBundled: true,
    releaseGate: null,
  }),
  cycloneDx: Object.freeze({
    schemaId: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    schemaVersion: "1.7",
    validation: "official-full-plus-rak-semantics",
    officialFullSchemaBundled: true,
    releaseGate: null,
  }),
});

export const strictProjectionKeyProfiles = Object.freeze({
  nativeAssessmentTopLevel: Object.freeze([
    "schemaVersion",
    "profile",
    "runId",
    "snapshotId",
    "generatedAt",
    "ecosystems",
    "primaryEcosystem",
    "reducedDepth",
    "files",
    "composition",
    "stackSignals",
    "architectureSignals",
    "maintainabilitySignals",
    "runtimeReadiness",
    "securityProfileSignals",
    "featureCatalog",
    "dependencies",
    "findings",
    "evidence",
    "tools",
    "coverage",
    "limitations",
  ]),
  sarifTopLevel: Object.freeze(["$schema", "version", "runs"]),
  cycloneDxTopLevel: Object.freeze([
    "$schema",
    "bomFormat",
    "specVersion",
    "serialNumber",
    "version",
    "metadata",
    "components",
    "dependencies",
    "compositions",
  ]),
});

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "generated",
  "state",
  ".agent-build",
]);
const TEXT_EXTENSIONS = new Set([
  "",
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".csproj",
  ".css",
  ".env",
  ".go",
  ".gradle",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".php",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sln",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const SECRET_PATTERNS: ReadonlyArray<{ id: string; expression: RegExp }> = [
  {
    id: "private-key",
    expression:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu,
  },
  { id: "aws-access-key", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu },
  {
    id: "token",
    expression:
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|xox[baprs]-[A-Za-z0-9-]{10,200})\b/gu,
  },
  {
    id: "credential-assignment",
    expression:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*[:=]\s*["']?[^\s"',;]{6,}["']?/giu,
  },
];
const HOST_PATH_PATTERNS: readonly RegExp[] = [
  /(?:\/Users|\/home|\/workspace|\/root|\/tmp|\/private\/tmp|\/var\/tmp)\/[^\s"'<>]+/gu,
  /\b[A-Za-z]:\\Users\\[^\s"'<>]+/gu,
];

interface InspectedText {
  repoRelPath: string;
  text: string;
  byteLength: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, value: string): string {
  const digest = hash(value);
  return `${prefix}_${digest.slice(0, 8)}-${digest.slice(8, 12)}-7${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function sourceOccurrenceKey(
  collector: string,
  repoRelPath: string,
  detector: string,
  startOffset: number,
  matchLength: number,
): string {
  return [
    collector,
    repoRelPath,
    detector,
    startOffset.toString(),
    (startOffset + matchLength).toString(),
  ].join("\0");
}

function normalizeRelative(candidate: string): string {
  const normalized = candidate.split(path.sep).join("/");
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "." || part === "..") ||
    hasControlCharacter ||
    normalized.includes("\\")
  ) {
    throw new Error(`Unsafe repository-relative path: ${JSON.stringify(candidate)}`);
  }
  return normalized;
}

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function safeExcerpt(text: string, start: number, end: number): string {
  const line = lineAt(text, start);
  const matchLength = Math.max(0, end - start);
  return `[REDACTED SECRET PATTERN CONTEXT: line ${line}, matched ${matchLength} characters]`;
}

function sanitizePublicText(input: string): string {
  let result = input;
  for (const rule of SECRET_PATTERNS) {
    rule.expression.lastIndex = 0;
    result = result.replace(rule.expression, "[REDACTED SECRET]");
  }
  for (const pattern of HOST_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED HOST PATH]");
  }
  return result;
}

async function walkRepository(
  rootPath: string,
  options: Required<Pick<AssessRepositoryOptions, "maxFiles" | "maxFileBytes" | "maxTotalBytes">>,
): Promise<{ files: RepositoryFile[]; texts: InspectedText[]; exclusions: string[] }> {
  const files: RepositoryFile[] = [];
  const texts: InspectedText[] = [];
  const exclusions: string[] = [];
  let totalRead = 0;

  async function visit(absoluteDirectory: string, relativeDirectory: string): Promise<void> {
    const entries = (await readdir(absoluteDirectory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (files.length >= options.maxFiles) {
        exclusions.push(`file budget reached (${options.maxFiles})`);
        return;
      }
      const relativePath = normalizeRelative(
        relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`,
      );
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          exclusions.push(`${relativePath}: excluded directory`);
          continue;
        }
        await visit(absolutePath, relativePath);
        continue;
      }
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        files.push({
          repoRelPath: relativePath,
          byteLength: 0,
          extension: path.posix.extname(relativePath).toLowerCase(),
          classification: "symlink",
          exclusionReason: "symlinks are recorded but never followed",
        });
        exclusions.push(`${relativePath}: symlink not followed`);
        continue;
      }
      if (!stats.isFile()) {
        files.push({
          repoRelPath: relativePath,
          byteLength: stats.size,
          extension: path.posix.extname(relativePath).toLowerCase(),
          classification: "excluded",
          exclusionReason: "unsupported file type",
        });
        continue;
      }
      const extension = path.posix.extname(relativePath).toLowerCase();
      if (stats.size > options.maxFileBytes) {
        files.push({
          repoRelPath: relativePath,
          byteLength: stats.size,
          extension,
          classification: "excluded",
          exclusionReason: `file exceeds ${options.maxFileBytes} byte limit`,
        });
        exclusions.push(`${relativePath}: oversized`);
        continue;
      }
      if (totalRead + stats.size > options.maxTotalBytes) {
        files.push({
          repoRelPath: relativePath,
          byteLength: stats.size,
          extension,
          classification: "excluded",
          exclusionReason: `total inspection budget ${options.maxTotalBytes} exceeded`,
        });
        exclusions.push(`${relativePath}: total byte budget reached`);
        continue;
      }
      const content = await readFile(absolutePath);
      totalRead += content.byteLength;
      const isText = TEXT_EXTENSIONS.has(extension) && !content.includes(0);
      if (isText) {
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(content);
        } catch {
          files.push({
            repoRelPath: relativePath,
            byteLength: content.byteLength,
            extension,
            classification: "excluded",
            exclusionReason: "invalid UTF-8",
          });
          exclusions.push(`${relativePath}: invalid UTF-8`);
          continue;
        }
        files.push({
          repoRelPath: relativePath,
          byteLength: content.byteLength,
          extension,
          classification: "text",
        });
        texts.push({
          repoRelPath: relativePath,
          text,
          byteLength: content.byteLength,
        });
      } else {
        files.push({
          repoRelPath: relativePath,
          byteLength: content.byteLength,
          extension,
          classification: "binary",
        });
      }
    }
  }

  await visit(rootPath, "");
  return { files, texts, exclusions };
}

const ECOSYSTEM_MARKERS: ReadonlyArray<{
  ecosystem: Exclude<Ecosystem, "generic">;
  expression: RegExp;
  signal: string;
}> = [
  {
    ecosystem: "node",
    expression: /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json)$/u,
    signal: "Node package manifest or lockfile",
  },
  {
    ecosystem: "python",
    expression: /(?:^|\/)(?:requirements[^/]*\.txt|pyproject\.toml|Pipfile|poetry\.lock)$/u,
    signal: "Python dependency manifest",
  },
  { ecosystem: "go", expression: /(?:^|\/)go\.(?:mod|sum)$/u, signal: "Go module manifest" },
  {
    ecosystem: "java",
    expression: /(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?)$/u,
    signal: "Java build manifest",
  },
  {
    ecosystem: "dotnet",
    expression: /\.(?:csproj|fsproj|vbproj|sln)$/u,
    signal: ".NET project or solution",
  },
  {
    ecosystem: "ruby",
    expression: /(?:^|\/)(?:Gemfile|Gemfile\.lock|[^/]+\.gemspec)$/u,
    signal: "Ruby dependency manifest",
  },
  {
    ecosystem: "php",
    expression: /(?:^|\/)composer\.(?:json|lock)$/u,
    signal: "Composer manifest",
  },
];

function detectStack(files: readonly RepositoryFile[]): {
  ecosystems: Ecosystem[];
  signals: StackSignal[];
} {
  const found = new Set<Ecosystem>();
  const signals: StackSignal[] = [];
  for (const file of files) {
    for (const marker of ECOSYSTEM_MARKERS) {
      if (marker.expression.test(file.repoRelPath)) {
        found.add(marker.ecosystem);
        signals.push({
          ecosystem: marker.ecosystem,
          signal: marker.signal,
          repoRelPath: file.repoRelPath,
          confidence: "high",
        });
      }
    }
  }
  if (found.size === 0) {
    found.add("generic");
    signals.push({
      ecosystem: "generic",
      signal: "No first-class ecosystem manifest observed",
      repoRelPath: ".repository-root",
      confidence: "low",
    });
  }
  return {
    ecosystems: [...found].sort(),
    signals: signals.sort((a, b) => a.repoRelPath.localeCompare(b.repoRelPath)),
  };
}

function collectArchitectureSignals(files: readonly RepositoryFile[]): ArchitectureSignal[] {
  const seen = new Set<string>();
  const signals: ArchitectureSignal[] = [];
  const boundaryNames = new Set([
    "api",
    "app",
    "apps",
    "client",
    "cmd",
    "controllers",
    "domain",
    "infrastructure",
    "internal",
    "models",
    "packages",
    "repositories",
    "routes",
    "server",
    "services",
    "src",
    "web",
  ]);
  for (const file of files) {
    const parts = file.repoRelPath.split("/");
    const boundary = parts.find((part) => boundaryNames.has(part.toLowerCase()));
    if (boundary === undefined || seen.has(boundary.toLowerCase())) continue;
    seen.add(boundary.toLowerCase());
    signals.push({
      boundary,
      repoRelPath: file.repoRelPath,
      provenance: "code-inferred",
      limitation:
        "Directory naming suggests a boundary; imports and runtime coupling were not executed.",
    });
  }
  return signals.sort((a, b) => a.boundary.localeCompare(b.boundary));
}

function collectFeatures(
  runId: string,
  texts: readonly InspectedText[],
): { features: FeatureCatalogItem[]; evidence: EvidenceCandidate[] } {
  const features: FeatureCatalogItem[] = [];
  const evidence: EvidenceCandidate[] = [];
  const routePattern =
    /\b(?:app|router|server)\s*\.\s*(?:get|post|put|patch|delete|route)\s*\(\s*["'`]([^"'`]+)["'`]/giu;
  const annotationPattern =
    /@(?:Get|Post|Put|Patch|Delete|RequestMapping)\s*\(\s*["']([^"']+)["']/gu;
  const headingPattern = /^#{1,3}\s+(.{3,100})$/gmu;
  for (const file of texts) {
    for (const [detector, pattern] of [
      ["fluent-route", routePattern],
      ["route-annotation", annotationPattern],
    ] as const) {
      pattern.lastIndex = 0;
      for (const match of file.text.matchAll(pattern)) {
        const name = match[1];
        if (name === undefined || match.index === undefined) continue;
        const line = lineAt(file.text, match.index);
        const occurrenceKey = sourceOccurrenceKey(
          "feature-route",
          file.repoRelPath,
          detector,
          match.index,
          match[0].length,
        );
        const evidenceId = stableId("evd", `${runId}\0${occurrenceKey}`);
        features.push({
          featureId: stableId("fea", occurrenceKey),
          name: sanitizePublicText(name),
          kind: "route",
          provenance: "code-inferred",
          repoRelPath: file.repoRelPath,
          line,
          confidence: "medium",
          evidenceOccurrenceIds: [evidenceId],
          limitations: [
            "Route presence does not establish customer value, reachability, authorization, or runtime behavior.",
          ],
        });
        evidence.push({
          evidenceId,
          evidenceType: "feature-route-signal",
          title: "Static route feature signal",
          repoRelPath: file.repoRelPath,
          startLine: line,
          safeExcerpt: `[ROUTE DECLARATION OBSERVED AT LINE ${line}]`,
          sensitivity: "customer-confidential",
          redactionState: "none-required",
          collectionLimitations: [
            "The route value is retained on the catalog item only after secret and host-path redaction.",
          ],
        });
      }
    }
    if (/(?:^|\/)(?:README|FEATURES)[^/]*\.md$/iu.test(file.repoRelPath)) {
      headingPattern.lastIndex = 0;
      for (const match of file.text.matchAll(headingPattern)) {
        const name = match[1]?.trim();
        if (name === undefined || match.index === undefined) continue;
        const line = lineAt(file.text, match.index);
        const occurrenceKey = sourceOccurrenceKey(
          "feature-documentation",
          file.repoRelPath,
          "markdown-heading",
          match.index,
          match[0].length,
        );
        const evidenceId = stableId("evd", `${runId}\0${occurrenceKey}`);
        features.push({
          featureId: stableId("fea", occurrenceKey),
          name: sanitizePublicText(name),
          kind: "documented-capability",
          provenance: "documented",
          repoRelPath: file.repoRelPath,
          line,
          confidence: "low",
          evidenceOccurrenceIds: [evidenceId],
          limitations: [
            "Documentation is a repository claim and was not confirmed by an owner or runtime observation.",
          ],
        });
        evidence.push({
          evidenceId,
          evidenceType: "feature-documentation-signal",
          title: "Documented feature signal",
          repoRelPath: file.repoRelPath,
          startLine: line,
          safeExcerpt: `[DOCUMENTATION HEADING OBSERVED AT LINE ${line}]`,
          sensitivity: "customer-confidential",
          redactionState: "none-required",
          collectionLimitations: [
            "The heading is retained on the catalog item only after secret and host-path redaction.",
          ],
        });
      }
    }
  }
  const limited = features
    .sort((a, b) => a.repoRelPath.localeCompare(b.repoRelPath) || (a.line ?? 0) - (b.line ?? 0))
    .slice(0, 250);
  const retainedEvidenceIds = new Set(limited.flatMap((feature) => feature.evidenceOccurrenceIds));
  return {
    features: limited,
    evidence: evidence.filter((item) => retainedEvidenceIds.has(item.evidenceId)),
  };
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  const object = jsonObject(value);
  if (object === undefined) throw new Error(`${label} must be an object`);
  return object;
}

function assertExactKeys(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  const object = requireObject(value, label);
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(object).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unknown properties: ${unknown.sort().join(", ")}`);
  }
  return object;
}

function assertRequiredKeys(
  object: Readonly<Record<string, unknown>>,
  requiredKeys: readonly string[],
  label: string,
): void {
  const missing = requiredKeys.filter((key) => !Object.prototype.hasOwnProperty.call(object, key));
  if (missing.length > 0) {
    throw new Error(`${label} is missing required properties: ${missing.join(", ")}`);
  }
}

function addDependency(
  result: DependencyComponent[],
  ecosystem: Ecosystem,
  repoRelPath: string,
  name: string,
  version: string | undefined,
  scope: DependencyComponent["scope"],
): void {
  const purlType: Record<Ecosystem, string> = {
    node: "npm",
    python: "pypi",
    go: "golang",
    java: "maven",
    dotnet: "nuget",
    ruby: "gem",
    php: "composer",
    generic: "generic",
  };
  const purlName = encodeURIComponent(name).replaceAll("%2F", "/");
  const resolvedVersion =
    version !== undefined && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(version)
      ? `@${encodeURIComponent(version)}`
      : "";
  const component: DependencyComponent = {
    bomRef: `urn:rak-component:${hash(`${ecosystem}\0${name}\0${version ?? ""}\0${repoRelPath}`)}`,
    purl: `pkg:${purlType[ecosystem]}/${purlName}${resolvedVersion}`,
    ecosystem,
    name,
    scope,
    repoRelPath,
  };
  if (version !== undefined) component.version = version;
  result.push(component);
}

function collectDependencies(texts: readonly InspectedText[]): {
  components: DependencyComponent[];
  limitations: string[];
} {
  const components: DependencyComponent[] = [];
  const limitations: string[] = [];
  for (const file of texts) {
    try {
      if (/(?:^|\/)package\.json$/u.test(file.repoRelPath)) {
        const manifest = jsonObject(JSON.parse(file.text));
        if (manifest === undefined) throw new Error("root must be an object");
        for (const [field, scope] of [
          ["dependencies", "required"],
          ["devDependencies", "development"],
        ] as const) {
          const dependencies = jsonObject(manifest[field]);
          for (const [name, version] of Object.entries(dependencies ?? {}).sort(([a], [b]) =>
            a.localeCompare(b),
          )) {
            if (typeof version === "string")
              addDependency(components, "node", file.repoRelPath, name, version, scope);
          }
        }
      } else if (/(?:^|\/)package-lock\.json$/u.test(file.repoRelPath)) {
        const lockfile = jsonObject(JSON.parse(file.text));
        if (lockfile === undefined) throw new Error("root must be an object");
        const lockfileVersion = lockfile["lockfileVersion"];
        if (typeof lockfileVersion !== "number" || ![1, 2, 3].includes(lockfileVersion)) {
          limitations.push(
            `${file.repoRelPath}: unsupported npm lockfileVersion ${String(lockfileVersion)}; retained as opaque inventory evidence and dependency depth reduced`,
          );
        }
      } else if (/(?:^|\/)composer\.json$/u.test(file.repoRelPath)) {
        const manifest = jsonObject(JSON.parse(file.text));
        if (manifest === undefined) throw new Error("root must be an object");
        for (const [name, version] of Object.entries(jsonObject(manifest["require"]) ?? {}).sort(
          ([a], [b]) => a.localeCompare(b),
        )) {
          if (typeof version === "string")
            addDependency(components, "php", file.repoRelPath, name, version, "required");
        }
      } else if (/requirements[^/]*\.txt$/u.test(file.repoRelPath)) {
        for (const line of file.text.split(/\r?\n/u)) {
          const match = /^\s*([A-Za-z0-9_.-]+)\s*(?:==\s*([^\s;#]+))?/u.exec(line);
          if (match?.[1] !== undefined)
            addDependency(components, "python", file.repoRelPath, match[1], match[2], "required");
        }
      } else if (/(?:^|\/)go\.mod$/u.test(file.repoRelPath)) {
        for (const line of file.text.split(/\r?\n/u)) {
          const match = /^\s*([A-Za-z0-9_.~/-]+\.[A-Za-z0-9_.~/-]+)\s+(v[^\s]+)\s*$/u.exec(line);
          if (match?.[1] !== undefined)
            addDependency(components, "go", file.repoRelPath, match[1], match[2], "required");
        }
      } else if (/(?:^|\/)Gemfile$/u.test(file.repoRelPath)) {
        for (const match of file.text.matchAll(
          /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gmu,
        )) {
          if (match[1] !== undefined)
            addDependency(components, "ruby", file.repoRelPath, match[1], match[2], "required");
        }
      } else if (/(?:pom\.xml|\.csproj)$/u.test(file.repoRelPath)) {
        const ecosystem: Ecosystem = file.repoRelPath.endsWith(".csproj") ? "dotnet" : "java";
        const expression =
          ecosystem === "dotnet"
            ? /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/gu
            : /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/gu;
        for (const match of file.text.matchAll(expression)) {
          const name =
            ecosystem === "java" ? `${match[1] ?? "unknown"}:${match[2] ?? "unknown"}` : match[1];
          const version = ecosystem === "java" ? match[3] : match[2];
          if (name !== undefined)
            addDependency(components, ecosystem, file.repoRelPath, name, version, "required");
        }
      }
    } catch {
      limitations.push(`${file.repoRelPath}: malformed manifest; dependency extraction skipped`);
    }
  }
  const unique = new Map<string, DependencyComponent>();
  for (const component of components)
    unique.set(`${component.bomRef}\0${component.repoRelPath}`, component);
  return {
    components: [...unique.values()].sort((a, b) => a.bomRef.localeCompare(b.bomRef)),
    limitations,
  };
}

function scanSecrets(
  runId: string,
  texts: readonly InspectedText[],
): { findings: StaticFinding[]; evidence: EvidenceCandidate[] } {
  const findings: StaticFinding[] = [];
  const evidence: EvidenceCandidate[] = [];
  for (const file of texts) {
    for (const rule of SECRET_PATTERNS) {
      rule.expression.lastIndex = 0;
      for (const match of file.text.matchAll(rule.expression)) {
        if (match.index === undefined) continue;
        const line = lineAt(file.text, match.index);
        const occurrenceKey = sourceOccurrenceKey(
          "secret-pattern-match",
          file.repoRelPath,
          rule.id,
          match.index,
          match[0].length,
        );
        const evidenceId = stableId("evd", `${runId}\0${occurrenceKey}`);
        findings.push({
          schemaVersion: "1.0.0",
          findingId: stableId("fnd", `${runId}\0${occurrenceKey}`),
          runId,
          fingerprint: {
            algorithm: "rak-finding/v1",
            value: hash(occurrenceKey),
          },
          revision: 1,
          title: "Potential secret material in repository",
          description:
            "A deterministic pattern matched credential-like material. The matched value was discarded and must be independently reviewed.",
          category: "secret-detection",
          technicalSeverity: rule.id === "private-key" ? "high" : "medium",
          businessPriority: "unassigned",
          confidence: "medium",
          validationState: "unreviewed",
          evidenceOccurrenceIds: [evidenceId],
          locations: [{ repoRelPath: file.repoRelPath, startLine: line, endLine: line }],
          cweMappings: [
            {
              cweId: "CWE-798",
              catalogVersion: "4.20",
              primary: true,
              method: "tool",
              confidence: "medium",
            },
          ],
          cvss: [],
          ruleId: `rak/${rule.id}`,
        });
        evidence.push({
          evidenceId,
          evidenceType: "secret-pattern-match",
          title: "Redacted secret-pattern context",
          repoRelPath: file.repoRelPath,
          startLine: line,
          safeExcerpt: safeExcerpt(file.text, match.index, match.index + match[0].length),
          sensitivity: "secret-suspected",
          redactionState: "redacted",
          collectionLimitations: [
            "Matched value discarded; pattern match is not proof the credential is valid or reachable.",
          ],
        });
      }
    }
  }
  return { findings, evidence };
}

function collectHeuristicFindings(
  runId: string,
  texts: readonly InspectedText[],
): { findings: StaticFinding[]; evidence: EvidenceCandidate[] } {
  const rules: ReadonlyArray<{
    id: string;
    expression: RegExp;
    title: string;
    description: string;
    severity: StaticFinding["technicalSeverity"];
    cweId: string;
  }> = [
    {
      id: "dynamic-code-execution",
      expression: /\b(?:eval|new\s+Function)\s*\(/gu,
      title: "Dynamic code execution primitive observed",
      description:
        "A syntax-only heuristic observed a dynamic code execution primitive. Reachability and exploitability were not established.",
      severity: "medium",
      cweId: "CWE-95",
    },
    {
      id: "weak-hash",
      expression: /\b(?:md5|sha1)\b/giu,
      title: "Legacy hash algorithm reference observed",
      description:
        "A syntax-only heuristic observed a legacy hash name. The use may be non-security-sensitive and requires review.",
      severity: "low",
      cweId: "CWE-328",
    },
  ];
  const findings: StaticFinding[] = [];
  const evidence: EvidenceCandidate[] = [];
  for (const file of texts) {
    for (const rule of rules) {
      rule.expression.lastIndex = 0;
      for (const match of file.text.matchAll(rule.expression)) {
        if (match.index === undefined) continue;
        const line = lineAt(file.text, match.index);
        const occurrenceKey = sourceOccurrenceKey(
          "static-pattern-match",
          file.repoRelPath,
          rule.id,
          match.index,
          match[0].length,
        );
        const evidenceId = stableId("evd", `${runId}\0${occurrenceKey}`);
        findings.push({
          schemaVersion: "1.0.0",
          findingId: stableId("fnd", `${runId}\0${occurrenceKey}`),
          runId,
          fingerprint: { algorithm: "rak-finding/v1", value: hash(occurrenceKey) },
          revision: 1,
          title: rule.title,
          description: rule.description,
          category: "sast",
          technicalSeverity: rule.severity,
          businessPriority: "unassigned",
          confidence: "low",
          validationState: "unreviewed",
          evidenceOccurrenceIds: [evidenceId],
          locations: [{ repoRelPath: file.repoRelPath, startLine: line, endLine: line }],
          cweMappings: [
            {
              cweId: rule.cweId,
              catalogVersion: "4.20",
              primary: true,
              method: "tool",
              confidence: "low",
            },
          ],
          cvss: [],
          ruleId: `rak/${rule.id}`,
        });
        evidence.push({
          evidenceId,
          evidenceType: "static-pattern-match",
          title: rule.title,
          repoRelPath: file.repoRelPath,
          startLine: line,
          safeExcerpt: `[STATIC PATTERN ${rule.id} OBSERVED AT LINE ${line}]`,
          sensitivity: "customer-confidential",
          redactionState: "none-required",
          collectionLimitations: [
            "Only rule identity and location are retained; syntax-only matching does not establish reachability or exploitability.",
          ],
        });
      }
    }
  }
  return { findings, evidence };
}

function toolRecords(availableTools: readonly string[]): ToolExecutionRecord[] {
  const available = new Set(availableTools);
  const tools = [
    ["kit-walker", "RAK deterministic repository walker"],
    ["scc", "scc"],
    ["syft", "Syft"],
    ["osv-scanner", "OSV-Scanner"],
    ["gitleaks", "Gitleaks"],
    ["trivy", "Trivy"],
    ["opengrep", "Opengrep"],
    ["pmd-cpd", "PMD/CPD"],
  ] as const;
  return tools.map(([toolId, displayName]) => {
    if (toolId === "kit-walker") {
      return {
        toolId,
        displayName,
        availability: "available",
        invocation: "invoked",
        outcome: "succeeded",
        networkUsed: false,
        targetCodeExecuted: false,
      };
    }
    const isAvailable = available.has(toolId);
    return {
      toolId,
      displayName,
      availability: isAvailable ? "available" : "unavailable",
      invocation: "not-invoked",
      outcome: "not-run",
      reasonCode: isAvailable ? "SAFE_ADAPTER_NOT_INVOKED" : "TOOL_UNAVAILABLE",
      reason: isAvailable
        ? "The deterministic local-inspection lane records availability but does not invoke external binaries."
        : "No attested tool binary was supplied to this deterministic local-inspection lane.",
      networkUsed: false,
      targetCodeExecuted: false,
    };
  });
}

function emptyCounts(): Record<CoverageStatus, number> {
  return {
    pass: 0,
    fail: 0,
    partial: 0,
    blocked: 0,
    "not applicable": 0,
    "not tested": 0,
  };
}

function aggregateCoverageStatus(counts: Readonly<Record<CoverageStatus, number>>): CoverageStatus {
  if (counts.fail > 0) return "fail";
  if (counts.partial > 0) return "partial";
  if (counts.blocked > 0) return "blocked";
  if (counts["not tested"] > 0) return "not tested";
  if (counts["not applicable"] > 0) return "not applicable";
  return "pass";
}

function coverageRecord(
  runId: string,
  domainId: AssessmentDomain,
  statuses: readonly CoverageStatus[],
  evidenceOccurrenceIds: readonly string[],
  unsupportedEcosystems: readonly string[],
  exclusions: readonly string[],
  limitationIds: readonly string[],
): DomainCoverage {
  const counts = emptyCounts();
  for (const status of statuses) counts[status] += 1;
  const status = aggregateCoverageStatus(counts);
  return {
    schemaVersion: "1.0.0",
    coverageId: stableId("cov", `${runId}\0${domainId}`),
    runId,
    domainId,
    status,
    plannedControls: statuses.length,
    reconciledControls: statuses.length,
    counts,
    exclusions: [...exclusions],
    unsupportedEcosystems: [...unsupportedEcosystems],
    limitationIds: [...limitationIds],
    evidenceOccurrenceIds: [...new Set(evidenceOccurrenceIds)].sort(),
  };
}

function buildCoverage(
  runId: string,
  ecosystem: Ecosystem,
  evidence: readonly EvidenceCandidate[],
  exclusions: readonly string[],
): DomainCoverage[] {
  const genericLimitations = ecosystem === "generic" ? ["lim_generic_reduced_depth"] : [];
  const unsupported = ecosystem === "generic" ? ["generic"] : [];
  const evidenceIds = evidence.map((item) => item.evidenceId);
  const coverage = assessmentDomains.map((domain): DomainCoverage => {
    switch (domain) {
      case "repository-composition":
      case "stack-detection":
        return coverageRecord(
          runId,
          domain,
          [exclusions.length === 0 ? "pass" : "partial"],
          evidenceIds,
          unsupported,
          exclusions,
          genericLimitations,
        );
      case "architecture-boundaries":
      case "engineering-maintainability":
      case "features-use-cases":
        return coverageRecord(runId, domain, ["partial"], evidenceIds, unsupported, exclusions, [
          "lim_static_inference_only",
          ...genericLimitations,
        ]);
      case "secret-detection":
      case "sast":
        return coverageRecord(runId, domain, ["partial"], evidenceIds, unsupported, exclusions, [
          "lim_kit_rules_only",
          ...genericLimitations,
        ]);
      case "runtime-readiness":
        return coverageRecord(
          runId,
          domain,
          ["blocked"],
          evidenceIds,
          unsupported,
          [],
          ["lim_safe_runtime_gate_not_run", ...genericLimitations],
        );
      case "dynamic-browser-security":
        return coverageRecord(
          runId,
          domain,
          ["blocked"],
          [],
          unsupported,
          [],
          ["lim_runtime_not_authorized"],
        );
      case "dependency-inventory":
        return coverageRecord(runId, domain, ["partial"], evidenceIds, unsupported, exclusions, [
          "lim_manifest_only",
          ...genericLimitations,
        ]);
      case "dependency-vulnerabilities":
      case "iac-container-license":
        return coverageRecord(
          runId,
          domain,
          ["not tested"],
          [],
          unsupported,
          [],
          ["lim_external_tool_not_run"],
        );
      case "security-independent-review":
      case "modernization-decision":
      case "evidence-package-integrity":
        return coverageRecord(
          runId,
          domain,
          ["not tested"],
          [],
          unsupported,
          [],
          ["lim_downstream_phase"],
        );
    }
  });
  assertCoverageReconciles(coverage);
  return coverage;
}

export function assertCoverageReconciles(coverage: readonly DomainCoverage[]): void {
  const domains = new Set<AssessmentDomain>();
  for (const record of coverage) {
    if (domains.has(record.domainId))
      throw new Error(`Duplicate coverage domain: ${record.domainId}`);
    domains.add(record.domainId);
    for (const [status, count] of Object.entries(record.counts)) {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error(`Invalid ${status} count for ${record.domainId}`);
      }
    }
    const total = Object.values(record.counts).reduce((sum, count) => sum + count, 0);
    if (record.plannedControls !== record.reconciledControls || total !== record.plannedControls) {
      throw new Error(`Coverage does not reconcile for ${record.domainId}`);
    }
    const aggregate = aggregateCoverageStatus(record.counts);
    if (record.status !== aggregate) {
      throw new Error(
        `Coverage aggregate ${record.status} contradicts counts for ${record.domainId}; expected ${aggregate}`,
      );
    }
    if (
      record.status !== "pass" &&
      record.limitationIds.length === 0 &&
      record.exclusions.length === 0 &&
      record.evidenceOccurrenceIds.length === 0
    ) {
      throw new Error(`Non-pass coverage lacks a reason or evidence for ${record.domainId}`);
    }
  }
  if (domains.size !== assessmentDomains.length) {
    throw new Error(
      `Expected ${assessmentDomains.length} coverage domains, received ${domains.size}`,
    );
  }
}

export async function assessRepository(
  repositoryRoot: string,
  options: AssessRepositoryOptions = {},
): Promise<RepositoryAssessment> {
  const root = path.resolve(repositoryRoot);
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Repository root must be a real directory, not a symlink");
  }
  const runId = options.runId ?? stableId("run", "deterministic-local-assessment");
  const snapshotId = options.snapshotId ?? stableId("snp", root);
  const generatedAt = options.generatedAt ?? DEFAULT_TIMESTAMP;
  const selectedOverlayIds = [...(options.selectedSecurityOverlayIds ?? [])] as string[];
  const supportedOverlays = new Set<string>(supportedSecurityOverlayIds);
  if (selectedOverlayIds.some((profileId) => !supportedOverlays.has(profileId))) {
    const unsupported = selectedOverlayIds.find((profileId) => !supportedOverlays.has(profileId));
    throw new Error(`Unsupported security overlay: ${String(unsupported)}`);
  }
  if (new Set(selectedOverlayIds).size !== selectedOverlayIds.length) {
    throw new Error("Selected security overlay IDs must be unique");
  }
  if (
    selectedOverlayIds.length > 0 &&
    (options.securityOverlayApplication === undefined ||
      options.securityOverlayApplication.customerConfirmed !== true ||
      options.securityOverlayApplication.confirmationReference.trim() === "")
  ) {
    throw new Error(
      "Selected security overlays require customer confirmation and a confirmation reference",
    );
  }
  if (selectedOverlayIds.length === 0 && options.securityOverlayApplication !== undefined) {
    throw new Error("Security overlay application was supplied without selected overlay IDs");
  }
  const walked = await walkRepository(root, {
    maxFiles: options.maxFiles ?? 10_000,
    maxFileBytes: options.maxFileBytes ?? 1_000_000,
    maxTotalBytes: options.maxTotalBytes ?? 50_000_000,
  });
  const detected = detectStack(walked.files);
  const primaryEcosystem = detected.ecosystems[0] ?? "generic";
  const dependencies = collectDependencies(walked.texts);
  const secrets = scanSecrets(runId, walked.texts);
  const heuristicSecurity = collectHeuristicFindings(runId, walked.texts);
  const featureCatalog = collectFeatures(runId, walked.texts);
  const inventoryEvidence: EvidenceCandidate[] = walked.files.map((file) => ({
    evidenceId: stableId(
      "evd",
      `${runId}\0inventory\0${file.repoRelPath}\0${file.byteLength}\0${file.classification}`,
    ),
    evidenceType: "repository-file-inventory",
    title: "Repository file inventory entry",
    repoRelPath: file.repoRelPath,
    safeExcerpt: `[${file.classification.toUpperCase()} FILE: ${file.byteLength} BYTES]`,
    sensitivity: "customer-confidential",
    redactionState: file.classification === "excluded" ? "excluded" : "none-required",
    collectionLimitations: [
      "Inventory metadata establishes presence and size only; file behavior was not executed.",
    ],
  }));
  const evidence = [
    ...inventoryEvidence,
    ...featureCatalog.evidence,
    ...secrets.evidence,
    ...heuristicSecurity.evidence,
  ].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const inventoryEvidenceByPath = new Map(
    inventoryEvidence.map((item) => [item.repoRelPath, item.evidenceId]),
  );
  const webFrameworks = new Set([
    "express",
    "fastify",
    "next",
    "flask",
    "django",
    "spring-boot",
    "microsoft.aspnetcore",
    "rack",
    "rails",
    "laravel/framework",
  ]);
  const observedFrameworkDependencies = dependencies.components.filter((component) =>
    webFrameworks.has(component.name.toLowerCase()),
  );
  const baselineEvidenceIds = inventoryEvidence.map((item) => item.evidenceId);
  const profileCoverage = (
    status: "partial" | "blocked" | "not tested",
  ): RepositoryAssessment["securityProfileSignals"][number]["coverage"] => {
    const counts = emptyCounts();
    counts[status] = 1;
    return { status, plannedControls: 1, reconciledControls: 1, counts };
  };
  const securityProfileSignals: RepositoryAssessment["securityProfileSignals"] = [
    {
      profileId: "OWASP-ASVS/5.0.0/L1",
      kind: "baseline",
      application: "always-applied",
      state: "applied-reduced-depth",
      customerConfirmationRequired: false,
      customerConfirmed: false,
      trigger: "General web/API technical baseline for repository assessment.",
      evidenceOccurrenceIds: baselineEvidenceIds,
      controls: [
        {
          controlId: "RAK-STATIC-BASELINE/1.0.0",
          status: "partial",
          reasonCode: "BASELINE_SCANNERS_UNAVAILABLE",
          reason: "Kit-owned deterministic heuristics ran, but locked baseline scanners did not.",
          evidenceOccurrenceIds: baselineEvidenceIds,
        },
      ],
      coverage: profileCoverage("partial"),
      limitation:
        "The baseline is applied at reduced depth and cannot claim full control verification without the locked control planner and required analyzers.",
    },
  ];
  for (const profileId of selectedOverlayIds.sort()) {
    const status: "partial" | "blocked" | "not tested" =
      profileId === "OWASP-WSTG/4.2"
        ? "blocked"
        : profileId === "NIST-SSDF/1.1"
          ? "not tested"
          : "partial";
    const reasonCode =
      status === "blocked"
        ? "SAFE_RUNTIME_UNAVAILABLE"
        : status === "not tested"
          ? "ORGANIZATIONAL_EVIDENCE_OUT_OF_SCOPE"
          : "OVERLAY_SCANNERS_UNAVAILABLE";
    const reason =
      status === "blocked"
        ? "The selected runtime overlay could not run because the safe runtime gate was unavailable."
        : status === "not tested"
          ? "The selected organizational overlay requires evidence outside the inspected repository scope."
          : "The selected overlay was applied to static signals, but locked overlay analyzers did not run.";
    securityProfileSignals.push({
      profileId,
      kind: "selected-overlay",
      application: "operator-selected",
      state: "applied-reduced-depth",
      customerConfirmationRequired: true,
      customerConfirmed: true,
      confirmationReference: options.securityOverlayApplication!.confirmationReference,
      trigger: "Operator-selected profile with recorded customer confirmation.",
      evidenceOccurrenceIds: baselineEvidenceIds,
      controls: [
        {
          controlId: `${profileId}/selected-scope`,
          status,
          reasonCode,
          reason,
          evidenceOccurrenceIds: baselineEvidenceIds,
        },
      ],
      coverage: profileCoverage(status),
      limitation: reason,
    });
  }
  if (
    observedFrameworkDependencies.length > 0 &&
    !selectedOverlayIds.includes("OWASP-ASVS/5.0.0/L2")
  ) {
    const recommendationEvidenceIds = [
      ...new Set(
        observedFrameworkDependencies.flatMap((component) => {
          const evidenceId = inventoryEvidenceByPath.get(component.repoRelPath);
          return evidenceId === undefined ? [] : [evidenceId];
        }),
      ),
    ];
    securityProfileSignals.push({
      profileId: "OWASP-ASVS/5.0.0/L2",
      kind: "overlay-recommendation",
      application: "recommended-only",
      state: "recommended-not-confirmed",
      customerConfirmationRequired: true,
      customerConfirmed: false,
      trigger: `Web framework dependency observed: ${observedFrameworkDependencies
        .map((component) => component.name)
        .sort()
        .join(", ")}.`,
      evidenceOccurrenceIds: recommendationEvidenceIds,
      controls: [
        {
          controlId: "OWASP-ASVS/5.0.0/L2/recommendation",
          status: "not tested",
          reasonCode: "CUSTOMER_CONFIRMATION_REQUIRED",
          reason: "The evidence-triggered deeper profile is a recommendation and was not applied.",
          evidenceOccurrenceIds: recommendationEvidenceIds,
        },
      ],
      coverage: profileCoverage("not tested"),
      limitation:
        "Customer confirmation of exposure, authentication, tenancy, data sensitivity, and business criticality is required before selecting a deeper profile.",
    });
  }
  const findings = [...secrets.findings, ...heuristicSecurity.findings].sort((a, b) =>
    a.findingId.localeCompare(b.findingId),
  );
  const extensions: Record<string, number> = {};
  for (const file of walked.files) {
    const key = file.extension === "" ? "(none)" : file.extension;
    extensions[key] = (extensions[key] ?? 0) + 1;
  }
  const testFiles = walked.files.filter((file) =>
    /(?:^|\/)(?:test|tests|spec|specs)(?:\/|$)|\.(?:test|spec)\./iu.test(file.repoRelPath),
  ).length;
  const sourceFiles = walked.files.filter((file) =>
    /\.(?:[cm]?[jt]sx?|py|go|java|cs|rb|php)$/u.test(file.repoRelPath),
  ).length;
  const todoCount = walked.texts.reduce(
    (count, file) => count + (file.text.match(/\b(?:TODO|FIXME)\b/gu)?.length ?? 0),
    0,
  );
  const runtimeReadiness: RepositoryAssessment["runtimeReadiness"] = [];
  const runtimeMarkers = [
    ["Dockerfile", /(?:^|\/)Dockerfile(?:\.[^/]*)?$/u],
    ["Compose definition", /(?:^|\/)(?:compose|docker-compose)\.ya?ml$/u],
    ["Environment example", /(?:^|\/)\.env\.example$/u],
  ] as const;
  for (const [signal, expression] of runtimeMarkers) {
    const observed = walked.files.find((file) => expression.test(file.repoRelPath));
    const item: RepositoryAssessment["runtimeReadiness"][number] = {
      signal,
      status: observed === undefined ? "absent" : "observed",
      limitation:
        "Presence was inspected statically; the configuration was not interpreted or executed.",
    };
    if (observed !== undefined) item.repoRelPath = observed.repoRelPath;
    runtimeReadiness.push(item);
  }
  const limitations = [
    "Static inspection only: no repository code, hooks, builds, tests, package managers, or target configuration were executed.",
    "No network access or dependency resolution occurred.",
    "Feature and architecture signals are repository-derived hypotheses, not owner-confirmed product claims.",
    "Kit-owned secret and SAST heuristics are reduced-depth and do not substitute for the baseline scanners.",
    "Projection validation uses checked-in strict RAK subsets; complete public native, official SARIF Errata 01, and official CycloneDX 1.7 schemas remain explicit release gates and are not claimed as bundled.",
    ...walked.exclusions,
    ...dependencies.limitations,
  ];
  if (primaryEcosystem === "generic") {
    limitations.push(
      "No first-class ecosystem was detected; generic static coverage is explicitly reduced-depth.",
    );
  }
  const coverage = buildCoverage(runId, primaryEcosystem, evidence, [
    ...walked.exclusions,
    ...dependencies.limitations,
  ]);
  const result: RepositoryAssessment = {
    schemaVersion: "1.0.0",
    profile: "rak-contract/1.0.0",
    runId,
    snapshotId,
    generatedAt,
    ecosystems: detected.ecosystems,
    primaryEcosystem,
    reducedDepth: coverage.some((record) => record.status !== "pass"),
    files: walked.files,
    composition: {
      filesInspected: walked.files.length,
      textFilesInspected: walked.texts.length,
      bytesInspected: walked.texts.reduce((sum, file) => sum + file.byteLength, 0).toString(),
      extensions,
      exclusions: walked.exclusions,
    },
    stackSignals: detected.signals,
    architectureSignals: collectArchitectureSignals(walked.files),
    maintainabilitySignals: [
      {
        signal: "source-files",
        value: sourceFiles.toString(),
        interpretation: "Count of recognized source-code files within inspection limits.",
        limitation: "Generated and vendored code classification is heuristic.",
      },
      {
        signal: "test-files",
        value: testFiles.toString(),
        interpretation: "Files with test/spec path or filename markers.",
        limitation: "Presence does not establish that tests run, pass, or cover critical behavior.",
      },
      {
        signal: "todo-fixme-markers",
        value: todoCount.toString(),
        interpretation: "Textual maintenance markers observed in inspected text.",
        limitation: "Markers are neither defects nor a complete debt inventory.",
      },
    ],
    runtimeReadiness,
    securityProfileSignals,
    featureCatalog: featureCatalog.features,
    dependencies: dependencies.components,
    findings,
    evidence,
    tools: toolRecords(options.availableTools ?? []),
    coverage,
    limitations,
  };
  assertNoSensitiveOutput(result);
  return result;
}

export function assertNoSensitiveOutput(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const pattern of [
    ...SECRET_PATTERNS.map((rule) => rule.expression),
    ...HOST_PATH_PATTERNS,
  ]) {
    pattern.lastIndex = 0;
    if (pattern.test(serialized)) {
      throw new Error("Assessment output contains secret material or an absolute host path");
    }
  }
}

function sarifLevel(severity: StaticFinding["technicalSeverity"]): "error" | "warning" | "note" {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "medium") return "warning";
  return "note";
}

export function projectSarif(assessment: RepositoryAssessment): Record<string, unknown> {
  const rules = new Map<string, StaticFinding>();
  for (const finding of assessment.findings) {
    if (!rules.has(finding.ruleId)) rules.set(finding.ruleId, finding);
  }
  const cweIds = [
    ...new Set(
      assessment.findings.flatMap((finding) => finding.cweMappings.map((mapping) => mapping.cweId)),
    ),
  ].sort();
  const projection = {
    $schema:
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Repository Assessment Kit deterministic walker",
            semanticVersion: "1.0.0",
            informationUri: "https://repo-assessment-kit.dev/",
            rules: [...rules.entries()].map(([ruleId, finding]) => ({
              id: ruleId,
              name: finding.title,
              shortDescription: { text: finding.title },
              relationships: finding.cweMappings.map((mapping) => ({
                target: {
                  id: mapping.cweId,
                  toolComponent: { name: "CWE" },
                },
                kinds: ["relevant"],
              })),
              properties: {
                cweCatalogVersion: "4.20",
              },
            })),
          },
        },
        taxonomies: [
          {
            name: "CWE",
            organization: "MITRE",
            version: "4.20",
            informationUri: "https://cwe.mitre.org/",
            taxa: cweIds.map((cweId) => ({
              id: cweId,
              name: cweId,
              shortDescription: {
                text: `Common Weakness Enumeration ${cweId}`,
              },
            })),
          },
        ],
        automationDetails: { id: assessment.runId },
        invocations: [
          {
            executionSuccessful: true,
            properties: {
              networkUsed: false,
              targetCodeExecuted: false,
              limitations: assessment.limitations,
            },
          },
        ],
        results: assessment.findings.map((finding) => ({
          ruleId: finding.ruleId,
          level: sarifLevel(finding.technicalSeverity),
          message: { text: finding.description },
          partialFingerprints: {
            "repoAssessmentKitFinding/v1": finding.fingerprint.value,
          },
          taxa: finding.cweMappings.map((mapping) => ({
            id: mapping.cweId,
            toolComponent: { name: "CWE" },
          })),
          locations: finding.locations.map((location) => {
            const physicalLocation: {
              artifactLocation: { uri: string };
              region?: { startLine: number; endLine?: number };
            } = {
              artifactLocation: { uri: location.repoRelPath },
            };
            if (location.startLine !== undefined) {
              physicalLocation.region = { startLine: location.startLine };
              if (location.endLine !== undefined) {
                physicalLocation.region.endLine = location.endLine;
              }
            }
            return { physicalLocation };
          }),
          properties: {
            "dev.repo-assessment-kit.findingId": finding.findingId,
            evidenceIds: finding.evidenceOccurrenceIds,
            validationState: finding.validationState,
            confidence: finding.confidence,
            nativeSeverity: finding.technicalSeverity,
          },
        })),
      },
    ],
  };
  assertNoSensitiveOutput(projection);
  validateSarifProjection(projection, assessment);
  return projection;
}

export function projectCycloneDx(
  assessment: RepositoryAssessment,
  componentName = "assessed-repository",
): Record<string, unknown> {
  const projection = {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: `urn:uuid:${stableId("bom", assessment.runId).slice(4)}`,
    version: 1,
    metadata: {
      timestamp: assessment.generatedAt,
      lifecycles: [{ phase: "discovery" }],
      tools: {
        components: [
          {
            type: "application",
            name: "Repository Assessment Kit deterministic walker",
            version: "1.0.0",
          },
        ],
      },
      component: {
        type: "application",
        "bom-ref": "assessed-application",
        name: componentName,
      },
    },
    components: assessment.dependencies.map((dependency) => {
      const component: Record<string, unknown> = {
        type: "library",
        "bom-ref": dependency.bomRef,
        name: dependency.name,
        scope: dependency.scope === "development" ? "optional" : "required",
        properties: [
          { name: "dev.repo-assessment-kit.ecosystem", value: dependency.ecosystem },
          { name: "dev.repo-assessment-kit.sourceManifest", value: dependency.repoRelPath },
        ],
        purl: dependency.purl,
      };
      if (dependency.version !== undefined) component["version"] = dependency.version;
      return component;
    }),
    dependencies: [
      {
        ref: "assessed-application",
        dependsOn: assessment.dependencies.map((dependency) => dependency.bomRef),
      },
      ...assessment.dependencies.map((dependency) => ({
        ref: dependency.bomRef,
        dependsOn: [],
      })),
    ],
    compositions: [
      {
        aggregate: "unknown",
        assemblies: ["assessed-application"],
      },
    ],
  };
  assertNoSensitiveOutput(projection);
  validateCycloneDxProjection(projection);
  return projection;
}

function objectArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => jsonObject(item) === undefined)) {
    throw new Error(`${field} must be an array of objects`);
  }
  return value as Record<string, unknown>[];
}

export function validateSarifProjection(value: unknown, assessment?: RepositoryAssessment): void {
  const root = assertExactKeys(value, strictProjectionKeyProfiles.sarifTopLevel, "SARIF");
  assertRequiredKeys(root, strictProjectionKeyProfiles.sarifTopLevel, "SARIF");
  if (
    root?.["version"] !== "2.1.0" ||
    root["$schema"] !==
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json"
  ) {
    throw new Error("SARIF must declare the frozen 2.1.0 Errata 01 schema");
  }
  const runs = objectArray(root["runs"], "SARIF runs");
  if (runs.length !== 1) throw new Error("RAK SARIF requires exactly one run");
  const run = runs[0];
  if (run === undefined) throw new Error("SARIF run missing");
  assertExactKeys(
    run,
    ["tool", "taxonomies", "automationDetails", "invocations", "results"],
    "SARIF run",
  );
  assertRequiredKeys(
    run,
    ["tool", "taxonomies", "automationDetails", "invocations", "results"],
    "SARIF run",
  );
  const tool = assertExactKeys(run["tool"], ["driver"], "SARIF tool");
  const driver = assertExactKeys(
    tool["driver"],
    ["name", "semanticVersion", "informationUri", "rules"],
    "SARIF driver",
  );
  assertRequiredKeys(
    driver,
    ["name", "semanticVersion", "informationUri", "rules"],
    "SARIF driver",
  );
  if (typeof driver["name"] !== "string" || typeof driver["semanticVersion"] !== "string") {
    throw new Error("SARIF tool driver identity is incomplete");
  }
  assertExactKeys(run["automationDetails"], ["id"], "SARIF automationDetails");
  objectArray(run["invocations"], "SARIF invocations").forEach((invocation, index) => {
    assertExactKeys(
      invocation,
      ["executionSuccessful", "properties"],
      `SARIF invocations[${index}]`,
    );
    assertExactKeys(
      invocation["properties"],
      ["networkUsed", "targetCodeExecuted", "limitations"],
      `SARIF invocations[${index}].properties`,
    );
  });
  const rules = objectArray(driver["rules"], "SARIF rules");
  const ruleIds = new Set(
    rules.map((rule, ruleIndex) => {
      assertExactKeys(
        rule,
        ["id", "name", "shortDescription", "relationships", "properties"],
        `SARIF rules[${ruleIndex}]`,
      );
      assertRequiredKeys(
        rule,
        ["id", "name", "shortDescription", "relationships", "properties"],
        `SARIF rules[${ruleIndex}]`,
      );
      assertExactKeys(
        rule["shortDescription"],
        ["text"],
        `SARIF rules[${ruleIndex}].shortDescription`,
      );
      assertExactKeys(
        rule["properties"],
        ["cweCatalogVersion"],
        `SARIF rules[${ruleIndex}].properties`,
      );
      if (typeof rule["id"] !== "string") throw new Error("SARIF rule ID missing");
      const relationships = objectArray(
        rule["relationships"],
        `SARIF relationships for ${rule["id"]}`,
      );
      if (relationships.length === 0) {
        throw new Error(`SARIF rule ${rule["id"]} has no structured CWE relationship`);
      }
      relationships.forEach((relationship, relationshipIndex) => {
        assertExactKeys(
          relationship,
          ["target", "kinds"],
          `SARIF rules[${ruleIndex}].relationships[${relationshipIndex}]`,
        );
        const target = assertExactKeys(
          relationship["target"],
          ["id", "toolComponent"],
          `SARIF rules[${ruleIndex}].relationships[${relationshipIndex}].target`,
        );
        assertExactKeys(
          target["toolComponent"],
          ["name"],
          `SARIF rules[${ruleIndex}].relationships[${relationshipIndex}].toolComponent`,
        );
      });
      return rule["id"];
    }),
  );
  const taxonomies = objectArray(run["taxonomies"], "SARIF taxonomies");
  taxonomies.forEach((taxonomy, taxonomyIndex) => {
    assertExactKeys(
      taxonomy,
      ["name", "organization", "version", "informationUri", "taxa"],
      `SARIF taxonomies[${taxonomyIndex}]`,
    );
  });
  const cwe = taxonomies.find(
    (taxonomy) => taxonomy["name"] === "CWE" && taxonomy["version"] === "4.20",
  );
  if (cwe === undefined) throw new Error("SARIF CWE 4.20 taxonomy missing");
  const cweIds = new Set(
    objectArray(cwe["taxa"], "SARIF CWE taxa").map((taxon, taxonIndex) => {
      assertExactKeys(taxon, ["id", "name", "shortDescription"], `SARIF CWE taxa[${taxonIndex}]`);
      assertExactKeys(
        taxon["shortDescription"],
        ["text"],
        `SARIF CWE taxa[${taxonIndex}].shortDescription`,
      );
      if (typeof taxon["id"] !== "string" || !/^CWE-[1-9][0-9]*$/u.test(taxon["id"])) {
        throw new Error("Invalid SARIF CWE taxon");
      }
      return taxon["id"];
    }),
  );
  const evidenceIds = new Set(assessment?.evidence.map((item) => item.evidenceId) ?? []);
  const nativeFindingIds = new Set(assessment?.findings.map((finding) => finding.findingId) ?? []);
  const seenFindingIds = new Set<string>();
  for (const [resultIndex, result] of objectArray(run["results"], "SARIF results").entries()) {
    assertExactKeys(
      result,
      ["ruleId", "level", "message", "partialFingerprints", "taxa", "locations", "properties"],
      `SARIF results[${resultIndex}]`,
    );
    assertRequiredKeys(
      result,
      ["ruleId", "level", "message", "partialFingerprints", "taxa", "locations", "properties"],
      `SARIF results[${resultIndex}]`,
    );
    assertExactKeys(result["message"], ["text"], `SARIF results[${resultIndex}].message`);
    if (typeof result["ruleId"] !== "string" || !ruleIds.has(result["ruleId"])) {
      throw new Error("SARIF result references an unknown rule");
    }
    const fingerprints = assertExactKeys(
      result["partialFingerprints"],
      ["repoAssessmentKitFinding/v1"],
      `SARIF results[${resultIndex}].partialFingerprints`,
    );
    if (
      typeof fingerprints?.["repoAssessmentKitFinding/v1"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(fingerprints["repoAssessmentKitFinding/v1"] as string)
    ) {
      throw new Error("SARIF result fingerprint is invalid");
    }
    for (const [taxonIndex, taxon] of objectArray(result["taxa"], "SARIF result taxa").entries()) {
      assertExactKeys(
        taxon,
        ["id", "toolComponent"],
        `SARIF results[${resultIndex}].taxa[${taxonIndex}]`,
      );
      assertExactKeys(
        taxon["toolComponent"],
        ["name"],
        `SARIF results[${resultIndex}].taxa[${taxonIndex}].toolComponent`,
      );
      if (typeof taxon["id"] !== "string" || !cweIds.has(taxon["id"])) {
        throw new Error("SARIF result references an unknown CWE taxon");
      }
    }
    for (const [locationIndex, location] of objectArray(
      result["locations"],
      "SARIF locations",
    ).entries()) {
      assertExactKeys(
        location,
        ["physicalLocation"],
        `SARIF results[${resultIndex}].locations[${locationIndex}]`,
      );
      const physical = assertExactKeys(
        location["physicalLocation"],
        ["artifactLocation", "region"],
        `SARIF results[${resultIndex}].locations[${locationIndex}].physicalLocation`,
      );
      const artifact = assertExactKeys(
        physical["artifactLocation"],
        ["uri"],
        `SARIF results[${resultIndex}].locations[${locationIndex}].artifactLocation`,
      );
      if (physical["region"] !== undefined) {
        assertExactKeys(
          physical["region"],
          ["startLine", "endLine"],
          `SARIF results[${resultIndex}].locations[${locationIndex}].region`,
        );
      }
      const uri = artifact["uri"];
      if (typeof uri !== "string") throw new Error("SARIF artifact URI missing");
      normalizeRelative(uri);
    }
    const properties = assertExactKeys(
      result["properties"],
      [
        "dev.repo-assessment-kit.findingId",
        "evidenceIds",
        "validationState",
        "confidence",
        "nativeSeverity",
      ],
      `SARIF results[${resultIndex}].properties`,
    );
    const findingId = properties["dev.repo-assessment-kit.findingId"];
    if (typeof findingId !== "string" || seenFindingIds.has(findingId)) {
      throw new Error("SARIF finding IDs must be present and unique");
    }
    seenFindingIds.add(findingId);
    if (assessment !== undefined && !nativeFindingIds.has(findingId)) {
      throw new Error("SARIF result does not resolve to a native finding");
    }
    const resultEvidenceIds = properties?.["evidenceIds"];
    if (
      !Array.isArray(resultEvidenceIds) ||
      resultEvidenceIds.some(
        (id) => typeof id !== "string" || (assessment !== undefined && !evidenceIds.has(id)),
      )
    ) {
      throw new Error("SARIF result evidence references do not resolve");
    }
  }
  if (assessment !== undefined && seenFindingIds.size !== assessment.findings.length) {
    throw new Error("SARIF result count differs from native findings");
  }
  assertNoSensitiveOutput(value);
  validateWithOfficialReleaseSchema("sarif", value);
}

export function validateCycloneDxProjection(value: unknown): void {
  const root = assertExactKeys(value, strictProjectionKeyProfiles.cycloneDxTopLevel, "CycloneDX");
  assertRequiredKeys(root, strictProjectionKeyProfiles.cycloneDxTopLevel, "CycloneDX");
  if (
    root?.["bomFormat"] !== "CycloneDX" ||
    root["specVersion"] !== "1.7" ||
    root["$schema"] !== "https://cyclonedx.org/schema/bom-1.7.schema.json" ||
    root["version"] !== 1
  ) {
    throw new Error("CycloneDX must declare the frozen 1.7 JSON profile");
  }
  if (typeof root["serialNumber"] !== "string" || !root["serialNumber"].startsWith("urn:uuid:")) {
    throw new Error("CycloneDX serial number is invalid");
  }
  const metadata = assertExactKeys(
    root["metadata"],
    ["timestamp", "lifecycles", "tools", "component"],
    "CycloneDX metadata",
  );
  assertRequiredKeys(
    metadata,
    ["timestamp", "lifecycles", "tools", "component"],
    "CycloneDX metadata",
  );
  objectArray(metadata["lifecycles"], "CycloneDX lifecycles").forEach((lifecycle, index) =>
    assertExactKeys(lifecycle, ["phase"], `CycloneDX lifecycles[${index}]`),
  );
  const tools = assertExactKeys(metadata["tools"], ["components"], "CycloneDX metadata tools");
  objectArray(tools["components"], "CycloneDX metadata tool components").forEach(
    (component, index) =>
      assertExactKeys(
        component,
        ["type", "name", "version"],
        `CycloneDX metadata tool components[${index}]`,
      ),
  );
  assertExactKeys(
    metadata["component"],
    ["type", "bom-ref", "name"],
    "CycloneDX metadata component",
  );
  const components = objectArray(root["components"], "CycloneDX components");
  const refs = new Set<string>(["assessed-application"]);
  for (const [componentIndex, component] of components.entries()) {
    assertExactKeys(
      component,
      ["type", "bom-ref", "name", "scope", "properties", "purl", "version"],
      `CycloneDX components[${componentIndex}]`,
    );
    assertRequiredKeys(
      component,
      ["type", "bom-ref", "name", "scope", "properties", "purl"],
      `CycloneDX components[${componentIndex}]`,
    );
    const ref = component["bom-ref"];
    if (typeof ref !== "string" || refs.has(ref)) {
      throw new Error("CycloneDX bom-ref values must be present and unique");
    }
    refs.add(ref);
    if (
      typeof component["name"] !== "string" ||
      typeof component["purl"] !== "string" ||
      !component["purl"].startsWith("pkg:")
    ) {
      throw new Error("CycloneDX component name or package URL is invalid");
    }
    objectArray(
      component["properties"],
      `CycloneDX components[${componentIndex}].properties`,
    ).forEach((property, propertyIndex) =>
      assertExactKeys(
        property,
        ["name", "value"],
        `CycloneDX components[${componentIndex}].properties[${propertyIndex}]`,
      ),
    );
  }
  for (const [dependencyIndex, dependency] of objectArray(
    root["dependencies"],
    "CycloneDX dependencies",
  ).entries()) {
    assertExactKeys(dependency, ["ref", "dependsOn"], `CycloneDX dependencies[${dependencyIndex}]`);
    if (typeof dependency["ref"] !== "string" || !refs.has(dependency["ref"])) {
      throw new Error("CycloneDX dependency source does not resolve");
    }
    if (
      !Array.isArray(dependency["dependsOn"]) ||
      dependency["dependsOn"].some((ref) => typeof ref !== "string" || !refs.has(ref))
    ) {
      throw new Error("CycloneDX dependency target does not resolve");
    }
  }
  const compositions = objectArray(root["compositions"], "CycloneDX compositions");
  compositions.forEach((composition, index) =>
    assertExactKeys(composition, ["aggregate", "assemblies"], `CycloneDX compositions[${index}]`),
  );
  if (
    compositions.length !== 1 ||
    ![
      "complete",
      "incomplete",
      "incomplete_first_party_only",
      "incomplete_first_party_proprietary_only",
      "incomplete_first_party_opensource_only",
      "incomplete_third_party_only",
      "incomplete_third_party_proprietary_only",
      "incomplete_third_party_opensource_only",
      "unknown",
      "not_specified",
    ].includes(String(compositions[0]?.["aggregate"]))
  ) {
    throw new Error("CycloneDX composition completeness is missing or invalid");
  }
  assertNoSensitiveOutput(value);
  validateWithOfficialReleaseSchema("cyclonedx", value);
}

function csvCell(value: string): string {
  const neutralized = /^[\t\r =+\-@]/u.test(value) ? `'${value}` : value;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function projectFindingsCsv(assessment: RepositoryAssessment): string {
  const rows = [
    [
      "findingId",
      "title",
      "category",
      "technicalSeverity",
      "confidence",
      "validationState",
      "ruleId",
      "locations",
      "evidenceOccurrenceIds",
    ],
    ...assessment.findings.map((finding) => [
      finding.findingId,
      finding.title,
      finding.category,
      finding.technicalSeverity,
      finding.confidence,
      finding.validationState,
      finding.ruleId,
      finding.locations
        .map((location) => `${location.repoRelPath}:${location.startLine ?? ""}`)
        .join(";"),
      finding.evidenceOccurrenceIds.join(";"),
    ]),
  ];
  const csv = `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  assertNoSensitiveOutput(csv);
  return csv;
}

export function validateAssessmentReferences(assessment: RepositoryAssessment): void {
  const evidenceIds = new Set<string>();
  for (const evidence of assessment.evidence) {
    if (evidenceIds.has(evidence.evidenceId)) {
      throw new Error(`Duplicate evidence occurrence ${evidence.evidenceId}`);
    }
    evidenceIds.add(evidence.evidenceId);
  }
  const requireEvidence = (owner: string, references: readonly string[]): void => {
    if (references.length === 0) {
      throw new Error(`${owner} has no evidence occurrence`);
    }
    for (const evidenceId of references) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`${owner} references missing evidence ${evidenceId}`);
      }
    }
  };
  for (const feature of assessment.featureCatalog) {
    requireEvidence(`Feature ${feature.featureId}`, feature.evidenceOccurrenceIds);
  }
  for (const finding of assessment.findings) {
    requireEvidence(`Finding ${finding.findingId}`, finding.evidenceOccurrenceIds);
  }
  for (const coverage of assessment.coverage) {
    for (const evidenceId of coverage.evidenceOccurrenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Coverage ${coverage.domainId} references missing evidence ${evidenceId}`);
      }
    }
  }
  const profileKeys = new Set<string>();
  let baselineCount = 0;
  for (const profile of assessment.securityProfileSignals) {
    const profileKey = `${profile.kind}\0${profile.profileId}`;
    if (profileKeys.has(profileKey)) {
      throw new Error(`Duplicate security profile signal ${profile.profileId}`);
    }
    profileKeys.add(profileKey);
    if (profile.kind === "baseline") {
      baselineCount += 1;
      if (
        profile.application !== "always-applied" ||
        profile.state !== "applied-reduced-depth" ||
        profile.customerConfirmationRequired ||
        profile.customerConfirmed
      ) {
        throw new Error("Security baseline must be visibly always applied");
      }
    } else if (profile.kind === "selected-overlay") {
      if (
        !supportedSecurityOverlayIds.includes(profile.profileId as SupportedSecurityOverlayId) ||
        profile.application !== "operator-selected" ||
        !profile.customerConfirmationRequired ||
        !profile.customerConfirmed ||
        typeof profile.confirmationReference !== "string" ||
        profile.confirmationReference.trim() === ""
      ) {
        throw new Error(
          `Selected overlay ${profile.profileId} lacks supported, confirmed application`,
        );
      }
    } else if (
      profile.application !== "recommended-only" ||
      !profile.customerConfirmationRequired ||
      profile.customerConfirmed ||
      profile.state !== "recommended-not-confirmed"
    ) {
      throw new Error(`Overlay recommendation ${profile.profileId} must remain unconfirmed`);
    }
    if (
      profile.controls.length !== profile.coverage.plannedControls ||
      profile.coverage.plannedControls !== profile.coverage.reconciledControls
    ) {
      throw new Error(`Security profile coverage does not reconcile for ${profile.profileId}`);
    }
    const expectedCounts = emptyCounts();
    for (const control of profile.controls) {
      expectedCounts[control.status] += 1;
      for (const evidenceId of control.evidenceOccurrenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          throw new Error(
            `Security profile control ${control.controlId} references missing evidence ${evidenceId}`,
          );
        }
      }
    }
    if (
      Object.entries(expectedCounts).some(
        ([status, count]) => profile.coverage.counts[status as CoverageStatus] !== count,
      ) ||
      profile.coverage.status !== aggregateCoverageStatus(expectedCounts)
    ) {
      throw new Error(
        `Security profile coverage counts contradict controls for ${profile.profileId}`,
      );
    }
    for (const evidenceId of profile.evidenceOccurrenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(
          `Security profile ${profile.profileId} references missing evidence ${evidenceId}`,
        );
      }
    }
  }
  if (baselineCount !== 1) {
    throw new Error("Assessment must contain exactly one applied security baseline");
  }
}

export function validateNativeAssessmentProjection(value: unknown): void {
  const root = assertExactKeys(
    value,
    strictProjectionKeyProfiles.nativeAssessmentTopLevel,
    "Native assessment",
  );
  assertRequiredKeys(
    root,
    strictProjectionKeyProfiles.nativeAssessmentTopLevel,
    "Native assessment",
  );
  if (root["schemaVersion"] !== "1.0.0" || root["profile"] !== "rak-contract/1.0.0") {
    throw new Error("Native assessment contract version is invalid");
  }
  const validateArray = (
    field: string,
    keys: readonly string[],
    nested?: (item: Record<string, unknown>, index: number) => void,
  ): void => {
    objectArray(root[field], `Native assessment ${field}`).forEach((item, index) => {
      assertExactKeys(item, keys, `${field}[${index}]`);
      nested?.(item, index);
    });
  };
  validateArray("files", [
    "repoRelPath",
    "byteLength",
    "extension",
    "classification",
    "exclusionReason",
  ]);
  const composition = assertExactKeys(
    root["composition"],
    ["filesInspected", "textFilesInspected", "bytesInspected", "extensions", "exclusions"],
    "composition",
  );
  assertRequiredKeys(
    composition,
    ["filesInspected", "textFilesInspected", "bytesInspected", "extensions", "exclusions"],
    "composition",
  );
  validateArray("stackSignals", ["ecosystem", "signal", "repoRelPath", "confidence"]);
  validateArray("architectureSignals", ["boundary", "repoRelPath", "provenance", "limitation"]);
  validateArray("maintainabilitySignals", ["signal", "value", "interpretation", "limitation"]);
  validateArray("runtimeReadiness", ["signal", "repoRelPath", "status", "limitation"]);
  validateArray(
    "securityProfileSignals",
    [
      "profileId",
      "kind",
      "application",
      "state",
      "customerConfirmationRequired",
      "customerConfirmed",
      "confirmationReference",
      "trigger",
      "evidenceOccurrenceIds",
      "controls",
      "coverage",
      "limitation",
    ],
    (profile, profileIndex) => {
      assertRequiredKeys(
        profile,
        [
          "profileId",
          "kind",
          "application",
          "state",
          "customerConfirmationRequired",
          "customerConfirmed",
          "trigger",
          "evidenceOccurrenceIds",
          "controls",
          "coverage",
          "limitation",
        ],
        `securityProfileSignals[${profileIndex}]`,
      );
      objectArray(profile["controls"], `securityProfileSignals[${profileIndex}].controls`).forEach(
        (control, controlIndex) => {
          assertExactKeys(
            control,
            ["controlId", "status", "reasonCode", "reason", "evidenceOccurrenceIds"],
            `securityProfileSignals[${profileIndex}].controls[${controlIndex}]`,
          );
          assertRequiredKeys(
            control,
            ["controlId", "status", "reasonCode", "reason", "evidenceOccurrenceIds"],
            `securityProfileSignals[${profileIndex}].controls[${controlIndex}]`,
          );
        },
      );
      const profileCoverage = assertExactKeys(
        profile["coverage"],
        ["status", "plannedControls", "reconciledControls", "counts"],
        `securityProfileSignals[${profileIndex}].coverage`,
      );
      assertRequiredKeys(
        profileCoverage,
        ["status", "plannedControls", "reconciledControls", "counts"],
        `securityProfileSignals[${profileIndex}].coverage`,
      );
      const profileCounts = assertExactKeys(
        profileCoverage["counts"],
        ["pass", "fail", "partial", "blocked", "not applicable", "not tested"],
        `securityProfileSignals[${profileIndex}].coverage.counts`,
      );
      assertRequiredKeys(
        profileCounts,
        ["pass", "fail", "partial", "blocked", "not applicable", "not tested"],
        `securityProfileSignals[${profileIndex}].coverage.counts`,
      );
    },
  );
  validateArray("featureCatalog", [
    "featureId",
    "name",
    "kind",
    "provenance",
    "repoRelPath",
    "line",
    "confidence",
    "evidenceOccurrenceIds",
    "limitations",
  ]);
  validateArray("dependencies", [
    "bomRef",
    "purl",
    "ecosystem",
    "name",
    "version",
    "scope",
    "repoRelPath",
  ]);
  validateArray(
    "findings",
    [
      "schemaVersion",
      "findingId",
      "runId",
      "fingerprint",
      "revision",
      "title",
      "description",
      "category",
      "technicalSeverity",
      "businessPriority",
      "confidence",
      "validationState",
      "evidenceOccurrenceIds",
      "locations",
      "cweMappings",
      "cvss",
      "ruleId",
    ],
    (finding, findingIndex) => {
      assertExactKeys(
        finding["fingerprint"],
        ["algorithm", "value"],
        `findings[${findingIndex}].fingerprint`,
      );
      objectArray(finding["locations"], `findings[${findingIndex}].locations`).forEach(
        (location, locationIndex) =>
          assertExactKeys(
            location,
            ["repoRelPath", "startLine", "endLine"],
            `findings[${findingIndex}].locations[${locationIndex}]`,
          ),
      );
      objectArray(finding["cweMappings"], `findings[${findingIndex}].cweMappings`).forEach(
        (mapping, mappingIndex) =>
          assertExactKeys(
            mapping,
            ["cweId", "catalogVersion", "primary", "method", "confidence"],
            `findings[${findingIndex}].cweMappings[${mappingIndex}]`,
          ),
      );
    },
  );
  validateArray("evidence", [
    "evidenceId",
    "evidenceType",
    "title",
    "repoRelPath",
    "startLine",
    "safeExcerpt",
    "sensitivity",
    "redactionState",
    "collectionLimitations",
  ]);
  validateArray("tools", [
    "toolId",
    "displayName",
    "availability",
    "invocation",
    "outcome",
    "reasonCode",
    "reason",
    "networkUsed",
    "targetCodeExecuted",
  ]);
  validateArray(
    "coverage",
    [
      "schemaVersion",
      "coverageId",
      "runId",
      "domainId",
      "status",
      "plannedControls",
      "reconciledControls",
      "counts",
      "exclusions",
      "unsupportedEcosystems",
      "limitationIds",
      "evidenceOccurrenceIds",
    ],
    (coverage, coverageIndex) => {
      assertRequiredKeys(
        coverage,
        [
          "schemaVersion",
          "coverageId",
          "runId",
          "domainId",
          "status",
          "plannedControls",
          "reconciledControls",
          "counts",
          "exclusions",
          "unsupportedEcosystems",
          "limitationIds",
          "evidenceOccurrenceIds",
        ],
        `coverage[${coverageIndex}]`,
      );
      const counts = assertExactKeys(
        coverage["counts"],
        ["pass", "fail", "partial", "blocked", "not applicable", "not tested"],
        `coverage[${coverageIndex}].counts`,
      );
      assertRequiredKeys(
        counts,
        ["pass", "fail", "partial", "blocked", "not applicable", "not tested"],
        `coverage[${coverageIndex}].counts`,
      );
    },
  );
  assertNoSensitiveOutput(value);
  validateWithOfficialReleaseSchema("native", value);
}

export function projectNativeJson(assessment: RepositoryAssessment): string {
  validateNativeAssessmentProjection(assessment);
  assertCoverageReconciles(assessment.coverage);
  validateAssessmentReferences(assessment);
  assertNoSensitiveOutput(assessment);
  return `${JSON.stringify(assessment, null, 2)}\n`;
}

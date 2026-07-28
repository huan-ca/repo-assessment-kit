#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  assessRepository,
  assertNoSensitiveOutput,
  projectCycloneDx,
  projectFindingsCsv,
  projectNativeJson,
  projectSarif,
  validateAssessmentReferences,
  validateCycloneDxProjection,
  validateNativeAssessmentProjection,
  validateSarifProjection,
} from "../packages/analyzers/dist/index.js";
import { discoveryTopics, productClaimSchema } from "../packages/contracts/dist/index.js";
import { admitTextEvidence } from "../packages/evidence/dist/index.js";
import {
  createDeterministicZip,
  derivePackageArtifactEligibility,
  reopenZip,
} from "../packages/packaging/dist/index.js";
import {
  renderHtml,
  renderMarkdown,
  validateCustomerContent,
  validateStaticHtml,
} from "../packages/reporting/dist/index.js";

const DEFAULT_TIMESTAMP = () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
const ZIP_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.000Z$/;
const PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_INTEGRITY_FILES = 100_000;
const MAX_INTEGRITY_BYTES = 2 * 1024 * 1024 * 1024;

function usage() {
  return `Usage:
  node scripts/run-offline-assessment.mjs \\
    --source <local-git-repository> \\
    --project <project-slug> \\
    --discovery <discovery.json> \\
    --output-root <directory> \\
    [--generated-at <YYYY-MM-DDTHH:mm:ss.000Z>]
`;
}

function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  const allowed = new Set([
    "--source",
    "--project",
    "--discovery",
    "--output-root",
    "--generated-at",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || value === undefined || value.startsWith("--")) {
      throw new Error(`Unknown or incomplete argument: ${key ?? "(missing)"}\n${usage()}`);
    }
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}`);
    values.set(key, value);
  }
  for (const key of ["--source", "--project", "--discovery", "--output-root"]) {
    if (!values.has(key)) throw new Error(`Required argument is missing: ${key}\n${usage()}`);
  }
  const projectSlug = values.get("--project");
  if (!PROJECT_SLUG.test(projectSlug) || projectSlug.length > 80) {
    throw new Error("Project slug must be lowercase kebab-case and at most 80 characters");
  }
  const generatedAt = values.get("--generated-at") ?? DEFAULT_TIMESTAMP();
  const timestampMatch = ZIP_TIMESTAMP.exec(generatedAt);
  if (timestampMatch === null || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("--generated-at must be a valid UTC timestamp with .000Z milliseconds");
  }
  return {
    source: values.get("--source"),
    projectSlug,
    discoveryPath: values.get("--discovery"),
    outputRoot: values.get("--output-root"),
    generatedAt,
    directoryTimestamp: `${timestampMatch[1]}${timestampMatch[2]}${timestampMatch[3]}T${timestampMatch[4]}${timestampMatch[5]}${timestampMatch[6]}Z`,
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function prefixedDigest(value) {
  return `sha256:${digest(value)}`;
}

function stableId(prefix, key) {
  const hex = digest(key);
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function prettyJson(value) {
  return `${JSON.stringify(JSON.parse(stableJson(value)), null, 2)}\n`;
}

async function canonicalDirectory(candidate, label) {
  const supplied = path.resolve(candidate);
  const suppliedInfo = await lstat(supplied);
  if (!suppliedInfo.isDirectory() || suppliedInfo.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory and not a symlink`);
  }
  return realpath(supplied);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function git(sourceRoot, arguments_) {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      "filter.lfs.smudge=cat",
      ...arguments_,
    ],
    {
      cwd: sourceRoot,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        ...(process.env.RAK_TRUSTED_ANALYSIS_GIT_DIR === undefined
          ? {}
          : {
              GIT_DIR: process.env.RAK_TRUSTED_ANALYSIS_GIT_DIR,
              GIT_WORK_TREE: process.env.RAK_TRUSTED_ANALYSIS_WORK_TREE,
            }),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
        NO_PROXY: "*",
        no_proxy: "*",
      },
    },
  );
}

function inspectGitIdentity(sourceRoot) {
  let topLevel;
  let commitSha;
  let objectFormat;
  try {
    topLevel = git(sourceRoot, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
    commitSha = git(sourceRoot, ["rev-parse", "--verify", "HEAD^{commit}"]).toString("utf8").trim();
    objectFormat = git(sourceRoot, ["rev-parse", "--show-object-format"]).toString("utf8").trim();
  } catch (error) {
    throw new Error(
      `Source must be a local Git repository with a valid HEAD commit: ${error.message}`,
    );
  }
  if (path.resolve(topLevel) !== sourceRoot) {
    throw new Error("Source path must be the canonical Git worktree root, not a subdirectory");
  }
  if (!SHA256.test(commitSha) && !/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error("Git returned an invalid commit object ID");
  }
  if (!["sha1", "sha256"].includes(objectFormat)) {
    throw new Error(`Unsupported Git object format: ${objectFormat}`);
  }
  return { commitSha, objectFormat };
}

function normalizeGitStatusPath(pathBytes) {
  let candidate;
  try {
    candidate = new TextDecoder("utf-8", { fatal: true }).decode(pathBytes);
  } catch {
    throw new Error("Git status contains a path that is not valid UTF-8");
  }
  const hasControlCharacter = [...candidate].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    candidate.length === 0 ||
    candidate.startsWith("/") ||
    /^[A-Za-z]:/u.test(candidate) ||
    candidate.includes("\\") ||
    hasControlCharacter
  ) {
    throw new Error("Git status contains an unsafe repository-relative path");
  }
  const segments = candidate.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Git status path contains an empty, dot, or parent segment");
  }
  return segments.join("/");
}

function parsePorcelainV1Z(status) {
  if (status.byteLength === 0) return [];
  if (status.at(-1) !== 0) throw new Error("Git status did not end with a NUL delimiter");
  const fields = [];
  let start = 0;
  for (let index = 0; index < status.byteLength; index += 1) {
    if (status[index] !== 0) continue;
    fields.push(status.subarray(start, index));
    start = index + 1;
  }
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.byteLength === 0) {
      if (index !== fields.length - 1) throw new Error("Git status contains an empty record");
      continue;
    }
    if (field.byteLength < 4 || field[2] !== 0x20) {
      throw new Error("Git status contains a malformed porcelain record");
    }
    const statusCode = field.subarray(0, 2).toString("ascii");
    paths.push(normalizeGitStatusPath(field.subarray(3)));
    if (statusCode.includes("R") || statusCode.includes("C")) {
      const original = fields[index + 1];
      if (original === undefined || original.byteLength === 0) {
        throw new Error("Git rename/copy status is missing its original path");
      }
      paths.push(normalizeGitStatusPath(original));
      index += 1;
    }
  }
  return [...new Set(paths)].sort(compareUtf8);
}

async function integritySnapshot(sourceRoot) {
  const entries = [];
  let files = 0;
  let bytes = 0;
  async function visit(absoluteDirectory, relativeDirectory) {
    const children = await readdir(absoluteDirectory, { withFileTypes: true });
    children.sort((left, right) => compareUtf8(left.name, right.name));
    for (const child of children) {
      if (relativeDirectory === "" && child.name === ".git") continue;
      const relativePath =
        relativeDirectory === "" ? child.name : `${relativeDirectory}/${child.name}`;
      const absolutePath = path.join(absoluteDirectory, child.name);
      const info = await lstat(absolutePath);
      if (info.isDirectory()) {
        entries.push({ path: `${relativePath}/`, type: "directory", mode: info.mode & 0o777 });
        await visit(absolutePath, relativePath);
      } else if (info.isFile()) {
        files += 1;
        bytes += info.size;
        if (files > MAX_INTEGRITY_FILES || bytes > MAX_INTEGRITY_BYTES) {
          throw new Error("Source integrity snapshot exceeds the offline assessment safety budget");
        }
        const content = await readFile(absolutePath);
        entries.push({
          path: relativePath,
          type: "file",
          mode: info.mode & 0o777,
          byteLength: String(info.size),
          sha256: prefixedDigest(content),
        });
      } else if (info.isSymbolicLink()) {
        const target = await readlink(absolutePath).catch(() => "unreadable-symlink");
        entries.push({
          path: relativePath,
          type: "symlink",
          linkMetadataDigest: prefixedDigest(target),
        });
      } else {
        throw new Error(`Unsupported filesystem entry in source: ${relativePath}`);
      }
    }
  }
  await visit(sourceRoot, "");
  const status = git(sourceRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const includedDirtyPaths = parsePorcelainV1Z(status);
  const excludedDirtyPaths = [];
  const statusDigest = prefixedDigest(status);
  const manifestText = stableJson({
    entries,
    includedDirtyPaths,
    excludedDirtyPaths,
    statusDigest,
  });
  const manifestDigest = prefixedDigest(manifestText);
  return {
    manifest: entries,
    manifestDigest,
    statusDigest,
    sourceDigest: manifestDigest,
    includedDirtyPaths,
    excludedDirtyPaths,
  };
}

async function loadDiscovery(discoveryPath, runId, generatedAt) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(discoveryPath, "utf8"));
  } catch (error) {
    throw new Error(`Discovery file is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Discovery file must contain an object");
  }
  const topics = parsed.topics;
  if (topics === null || typeof topics !== "object" || Array.isArray(topics)) {
    throw new Error("Discovery file must contain a topics object");
  }
  const suppliedTopics = Object.keys(topics);
  const extras = suppliedTopics.filter((topic) => !discoveryTopics.includes(topic));
  if (extras.length > 0) throw new Error(`Unknown discovery topics: ${extras.join(", ")}`);
  const claims = discoveryTopics.map((topic, index) => {
    const supplied = topics[topic];
    if (supplied === undefined) throw new Error(`Required discovery topic is missing: ${topic}`);
    if (supplied === null || typeof supplied !== "object" || Array.isArray(supplied)) {
      throw new Error(`Discovery topic ${topic} must be an object`);
    }
    const claim = {
      schemaVersion: "1.0.0",
      claimId: `claim-${index + 1}-${digest(topic).slice(0, 12)}`,
      runId,
      topic,
      ...supplied,
      confidence: supplied.confidence ?? (supplied.unknown === undefined ? "medium" : "low"),
      evidenceOccurrenceIds: supplied.evidenceOccurrenceIds ?? [],
      conflictsWithClaimIds: supplied.conflictsWithClaimIds ?? [],
      revision: 1,
    };
    if (claim.provenance === "owner-stated" && claim.capturedAt === undefined) {
      claim.capturedAt = generatedAt;
    }
    const result = productClaimSchema.safeParse(claim);
    if (!result.success) {
      throw new Error(
        `Discovery topic ${topic} is invalid: ${result.error.issues.map(({ message }) => message).join("; ")}`,
      );
    }
    return result.data;
  });
  return claims;
}

function reportDocument({
  projectSlug,
  commitSha,
  generatedAt,
  identityDigest,
  title,
  kind,
  nodes,
}) {
  return {
    title,
    reportKind: kind,
    projectSlug,
    sourceScope: `Local Git commit ${commitSha}`,
    generatedAt,
    packageIdentityDigest: identityDigest,
    nodes,
  };
}

function comparisonRows(assessment, claims) {
  const unknownCount = claims.filter(({ unknown }) => unknown !== undefined).length;
  const findings = assessment.findings.length;
  const partialDomains = assessment.coverage.filter(({ status }) => status !== "pass").length;
  const context = `${findings} static findings, ${partialDomains} domains with limited coverage, and ${unknownCount} discovery unknowns`;
  return [
    [
      "Recoverability",
      `Repair can preserve existing behavior; whether repair is practical needs human review (${context}).`,
      "Staged replacement can isolate parts worth retaining after a technical reviewer confirms which parts can change separately.",
      "A rebuild removes known code maintenance problems but creates the largest burden of rediscovering valuable behavior.",
    ],
    [
      "Separation between system parts — whether one part can change without unsafe effects elsewhere",
      "Evidence about separation between system parts comes from pattern-based clues, not confirmation, because no provider or technical reviewer assessed the design.",
      "Incremental work depends on a technical reviewer confirming safe points where parts can be changed separately.",
      "A rebuild may clarify separation between system parts, but dependencies between systems must still work.",
    ],
    [
      "Security risk",
      "Pattern-based static checks identified areas for review, but locked scanners and independent review were unavailable.",
      "Incremental replacement can prioritize exposed areas after independent validation.",
      "A rebuild does not inherently remove security risk and still needs verified controls.",
    ],
    [
      "Engineering risk",
      "Focused changes limit immediate disruption while retaining current maintenance constraints.",
      "A staged path spreads transition risk and requires the old and new parts to operate safely together.",
      "A full rewrite concentrates delivery, data-move, and live-service disruption risk.",
    ],
    [
      "Preserving essential behavior — which valuable behavior a replacement must keep",
      "Existing workflows remain in place, subject to the recorded discovery unknowns.",
      "Each replacement slice needs an owner-confirmed written list of behavior it must preserve before delivery.",
      "All valuable workflows and obligations must be rediscovered and reimplemented.",
    ],
    [
      "Expected scale",
      "Capacity conclusions are unverified because this run did not execute the application.",
      "Capacity-related change points require measurements from safely running the application before replacement.",
      "A new design could target scale, but present demand and bottlenecks remain unverified.",
    ],
    [
      "Practicality of building anew — whether a new system can be delivered without unacceptable transition risk",
      "This question does not select repair as a primary method, although repairs can create safe points for later change.",
      "Provides reversible learning before committing to broader replacement.",
      "Cannot be responsibly selected from static evidence without owner and technical review.",
    ],
  ];
}

const OFFLINE_DOMAIN_NAMES = {
  "repository-composition": "Repository contents",
  "stack-detection": "Technology identification",
  "architecture-boundaries": "Separation between system parts",
  "engineering-maintainability": "Ease of safe change",
  "features-use-cases": "Features and user workflows",
  "dependency-inventory": "Third-party component inventory",
  "dependency-vulnerabilities": "Known component weaknesses",
  "secret-detection": "Credential and secret detection",
  sast: "Static code security checks",
  "iac-container-license": "Infrastructure, container, and license checks",
  "runtime-readiness": "Readiness for safe runtime testing",
  "dynamic-browser-security": "Browser and running-application checks",
  "security-independent-review": "Independent security review",
  "modernization-decision": "Modernization option comparison",
  "evidence-package-integrity": "Evidence and package integrity",
};

const OFFLINE_LIMITATION_DETAILS = {
  lim_static_inference_only: {
    name: "Static inference only",
    reason:
      "Architecture, maintainability, and feature conclusions came from repository patterns without running the product or obtaining provider and human confirmation.",
    effect:
      "The report may miss behavior, coupling, or product obligations that are not visible in repository text.",
    action:
      "Technical owner: review the design and feature hypotheses with the software owner, then record confirming or conflicting evidence.",
  },
  lim_kit_rules_only: {
    name: "Reduced-depth built-in checks only",
    reason:
      "The release-owned static pattern checks ran, but the locked secret and code-security scanners were unavailable.",
    effect:
      "The assessment cannot make a complete dependency, secret, or code-security conclusion.",
    action:
      "Security review owner: run the locked scanners and independently review any resulting candidate concerns.",
  },
  lim_safe_runtime_gate_not_run: {
    name: "Safe runtime readiness not exercised",
    reason: "The offline assessment did not approve or start a controlled application runtime.",
    effect: "Startup, configuration, service health, and behavior after launch remain unknown.",
    action:
      "Runtime assessment owner: prepare and approve a bounded runtime plan, then record the observed readiness result.",
  },
  lim_runtime_not_authorized: {
    name: "Browser and running-application checks not authorized",
    reason: "Offline local mode did not authorize browser or running-application requests.",
    effect: "Behavior in a browser, after login, or across live routes was not observed.",
    action:
      "Software owner: approve a safe runtime scope and test account, or explicitly retain this limitation.",
  },
  lim_manifest_only: {
    name: "Manifest-only component inventory",
    reason:
      "Dependency declarations were read without installing packages or resolving the complete dependency graph.",
    effect: "Indirect components and the versions actually used at runtime may be missing.",
    action:
      "Engineering owner: supply an approved lockfile or resolved component inventory and rerun component analysis.",
  },
  lim_external_tool_not_run: {
    name: "Required external analysis tool not run",
    reason:
      "The locked dependency, infrastructure, container, or license analysis tool was unavailable in offline mode.",
    effect:
      "No conclusion is available for the affected vulnerability, infrastructure, container, or license checks.",
    action:
      "Assessment owner: make the named locked tool available, rerun the affected check, and review its admitted results.",
  },
  lim_downstream_phase: {
    name: "Required later review phase not completed",
    reason:
      "Independent review, final decision synthesis, or customer-package release validation occurs after this offline static draft.",
    effect:
      "The affected conclusion is not independently reviewed and cannot authorize customer release.",
    action:
      "Engagement owner: complete the required independent and human reviews and final package validation.",
  },
  lim_generic_reduced_depth: {
    name: "Technology ecosystem not specifically supported",
    reason: "No first-class technology ecosystem was identified for specialized analysis.",
    effect: "Only generic repository checks ran, so technology-specific behavior may be missed.",
    action:
      "Technical owner: confirm the technology stack and select or add the matching assessment adapter.",
  },
};

function offlineCoverageDetails(coverage) {
  const details = coverage.limitationIds.map((limitationId) => {
    const detail = OFFLINE_LIMITATION_DETAILS[limitationId];
    if (detail === undefined) {
      throw new Error(`No lay explanation is registered for coverage limitation ${limitationId}`);
    }
    return detail;
  });
  for (const exclusion of coverage.exclusions) {
    details.push({
      name: "Excluded repository material",
      reason: exclusion,
      effect: "The excluded material did not contribute to this coverage conclusion.",
      action:
        "Software owner: confirm the exclusion is acceptable or approve a bounded way to include the material.",
    });
  }
  for (const ecosystem of coverage.unsupportedEcosystems) {
    details.push({
      name: "Unsupported technology ecosystem",
      reason: `${ecosystem} did not have first-class analysis support.`,
      effect: "Technology-specific behavior may be missing from this conclusion.",
      action: "Technical owner: confirm the stack and provide the matching assessment adapter.",
    });
  }
  return details;
}

function offlineEvidenceReferences(assessment, ids, purpose) {
  const byId = new Map(assessment.evidence.map((item) => [item.evidenceId, item]));
  return {
    kind: "evidence-links",
    references: [...new Set(ids)].sort(compareUtf8).map((evidenceId) => {
      const item = byId.get(evidenceId);
      const locator =
        item === undefined
          ? "packaged evidence index"
          : `${item.repoRelPath}${item.startLine === undefined ? "" : `:${item.startLine}`}`;
      return {
        evidenceId,
        label:
          item === undefined
            ? `Supporting record at ${locator}`
            : `${item.title} — ${item.evidenceType.replaceAll("-", " ")} at ${locator}`,
        purpose,
      };
    }),
  };
}

function offlineEvidenceSummary(assessment, ids, purpose) {
  const byId = new Map(assessment.evidence.map((item) => [item.evidenceId, item]));
  return (
    [...new Set(ids)]
      .sort(compareUtf8)
      .map((id) => {
        const item = byId.get(id);
        return item === undefined
          ? `Supporting record in the packaged evidence index; ${purpose}`
          : `${item.title} at ${item.repoRelPath}; ${purpose}`;
      })
      .join("; ") || "No supporting record was linked."
  );
}

function offlineCoverageEffect(status) {
  if (status === "pass") return "Supports a conclusion only for the recorded static scope.";
  if (status === "fail") return "A supported concern requires review and an accountable response.";
  if (status === "partial") return "Only part of this area was assessed.";
  if (status === "blocked") return "The planned checks could not run, so no result is implied.";
  if (status === "not applicable") return "Applicability must be revisited if scope changes.";
  return "No conclusion is available because the planned checks did not run.";
}

function offlineCoverageAction(status) {
  return status === "pass"
    ? "Assessment owner: retain the supporting record and reassess when scope changes."
    : "Software owner: remove the stated blocker or approve another evidence source, then rerun the affected checks.";
}

function buildReports(context) {
  const { assessment, claims, commitSha, generatedAt, identityDigest, projectSlug } = context;
  const unavailableTools = assessment.tools
    .filter(({ availability }) => availability !== "available")
    .map(({ displayName, reason }) => `${displayName}: ${reason}`);
  const unknownTopics = claims
    .filter(({ unknown }) => unknown !== undefined)
    .map(({ topic }) => topic);
  const evidenceIds = assessment.evidence.slice(0, 20).map(({ evidenceId }) => evidenceId);
  const base = { projectSlug, commitSha, generatedAt, identityDigest };
  const documents = new Map();
  documents.set(
    "executive",
    reportDocument({
      ...base,
      title: "Executive assessment",
      kind: "Executive draft",
      nodes: [
        { kind: "heading", level: 1, text: "Offline static assessment" },
        { kind: "heading", level: 2, text: "Decision at a glance" },
        {
          kind: "paragraph",
          text:
            assessment.findings.length === 0
              ? "No admitted finding establishes an urgent verified risk. Do not authorize risk-driven remediation or replacement from this draft alone. The conditional next step is to resolve the recorded unknowns, obtain the missing reviews, and then compare repair, staged replacement, and rebuilding."
              : "Static checks recorded candidate concerns that still require independent review. The conditional next step is to review those concerns, resolve the recorded unknowns, and then compare repair, staged replacement, and rebuilding; this draft does not establish urgent verified risks.",
        },
        {
          kind: "paragraph",
          text: "Decision confidence is low because runtime behavior, customer impact, complete scanner coverage, provider analysis, and human review remain unavailable.",
        },
        { kind: "heading", level: 2, text: "What was assessed" },
        {
          kind: "paragraph",
          text: `The repository was inspected without running its code or using the network. The bounded static reader inspected ${assessment.composition.filesInspected} entries across ${assessment.ecosystems.length} detected technology ecosystem(s).`,
        },
        { kind: "heading", level: 2, text: "Principal issues and owner actions" },
        {
          kind: "table",
          caption: "Candidate issues, impact limits, and follow-up",
          headers: [
            "Issue",
            "Affected people or system",
            "Business consequence",
            "Next action",
            "Evidence strength and limit",
          ],
          rows:
            assessment.findings.length === 0
              ? [
                  [
                    "No admitted finding",
                    "No affected party was established.",
                    "No verified customer or business impact was established. This does not prove that no issue exists.",
                    "Software owner: resolve discovery and runtime gaps before authorizing risk-driven remediation.",
                    "The recorded static techniques produced no admitted finding; unavailable tools and reviews still limit the conclusion.",
                  ],
                ]
              : assessment.findings.map((finding) => [
                  finding.title,
                  "The affected people, data, or system require human confirmation.",
                  "Business impact is unknown until the candidate concern is independently reviewed.",
                  "Software owner: assign independent review and record an accepted response before authorization.",
                  `${finding.validationState}; ${finding.confidence} confidence. Runtime confirmation and independent review are unavailable.`,
                ]),
        },
        ...assessment.findings.map((finding) =>
          offlineEvidenceReferences(
            assessment,
            finding.evidenceOccurrenceIds,
            `supports the candidate static concern “${finding.title}”`,
          ),
        ),
        { kind: "heading", level: 2, text: "Evidenced strengths and recoverability" },
        {
          kind: "list",
          items: [
            `Repository inspection completed without executing target code; ${assessment.composition.filesInspected} entries were inventoried.`,
            `Detected technology context was retained for ${assessment.ecosystems.join(", ") || "the generic repository profile"}.`,
            "Repair may preserve existing behavior, but recoverability remains conditional until architecture and product obligations receive human review.",
          ],
        },
        { kind: "heading", level: 2, text: "Three paths considered on equal terms" },
        {
          kind: "table",
          caption: "Current planning position for each path",
          headers: ["Path", "Current position", "Evidence limit"],
          rows: [
            [
              "Repair the current system",
              "May preserve existing behavior while addressing reviewed concerns.",
              "No repair should be authorized as a response to verified risk until candidate findings are reviewed.",
            ],
            [
              "Replace in controlled stages",
              "May provide reversible learning if separation between system parts is confirmed.",
              "Architecture separation and essential behavior remain incompletely verified.",
            ],
            [
              "Build a new system",
              "Could change the design but would require rediscovery and transition planning.",
              "Current static evidence does not establish that rebuilding is necessary or practical.",
            ],
          ],
        },
        { kind: "heading", level: 2, text: "Important unknowns and limits" },
        {
          kind: "list",
          items: [
            ...claims
              .filter(({ unknown }) => unknown !== undefined)
              .map(
                ({ topic, unknown }) =>
                  `${topic.replaceAll("-", " ")} is unknown because ${unknown.reason} Confidence effect: ${unknown.confidenceEffect} Coverage effect: ${unknown.coverageEffect} Software owner follow-up: ${unknown.followUp}`,
              ),
            "Runtime behavior was not observed. Effect: conclusions about behavior after startup or login are unavailable. Software owner follow-up: approve a safe runtime assessment or retain the limitation.",
            "Independent provider and human reviews were not performed. Effect: candidate concerns and the option comparison are not release-ready. Assessment owner follow-up: complete the required reviews.",
          ],
        },
        { kind: "heading", level: 2, text: "What could change the planning direction" },
        {
          kind: "list",
          items: [
            "A safe runtime assessment establishes materially different behavior.",
            "The software owner confirms essential workflows or obligations that favor another path.",
            "Independent review invalidates a candidate concern or shows that parts cannot be changed separately.",
          ],
        },
        { kind: "heading", level: 2, text: "Next owner decision" },
        {
          kind: "paragraph",
          text: "Software owner decision: assign owners and due dates for product discovery, observations from safely running the application, and independent review; then decide whether evidence is sufficient to authorize repair, staged replacement, or further investigation.",
        },
        { kind: "heading", level: 2, text: "Release status" },
        {
          kind: "paragraph",
          text: "Draft validated; customer release blocked. Independent provider analysis, independent security and decision review, technical human review, and lay human review were not performed and are not represented as complete.",
        },
      ],
    }),
  );
  documents.set(
    "decision",
    reportDocument({
      ...base,
      title: "Modernization decision comparison",
      kind: "Decision draft",
      nodes: [
        { kind: "heading", level: 1, text: "Three-option comparison" },
        {
          kind: "paragraph",
          text:
            assessment.findings.length === 0
              ? "All three paths use the same seven defined questions. No admitted finding establishes an urgent verified risk, so this draft does not recommend risk-driven remediation. Resolve missing context and reviews before choosing repair, staged replacement, or rebuilding."
              : "All three paths use the same seven defined questions. Candidate static concerns require review before they can justify corrective work. Resolve missing context and reviews, then choose among repair, staged replacement, and rebuilding.",
        },
        {
          kind: "table",
          caption: "Equal-criteria comparison",
          headers: ["Criterion", "Remediation", "Incremental replacement", "Full rebuild"],
          rows: comparisonRows(assessment, claims),
        },
        { kind: "heading", level: 2, text: "Confidence and reversal conditions" },
        {
          kind: "paragraph",
          text: "Confidence is low. A safe runtime assessment, owner-confirmed essential behavior, independent security evidence, or proof that parts of the current system cannot be changed separately could change the sequence.",
        },
        offlineEvidenceReferences(
          assessment,
          evidenceIds,
          "supports the static inputs used in the option comparison",
        ),
      ],
    }),
  );
  documents.set(
    "technical",
    reportDocument({
      ...base,
      title: "Technical assessment",
      kind: "Technical static draft",
      nodes: [
        { kind: "heading", level: 1, text: "Repository and implementation signals" },
        {
          kind: "paragraph",
          text: `The kit walker inspected ${assessment.composition.filesInspected} entries and ${assessment.composition.bytesInspected} text bytes. Detected ecosystems: ${assessment.ecosystems.join(", ")}. No target build, test, hook, package manager, or executable configuration was run.`,
        },
        { kind: "heading", level: 2, text: "Feature and use-case catalog" },
        {
          kind: "table",
          caption: "Repository-derived feature hypotheses",
          headers: ["Name", "Kind", "Provenance", "Location", "Evidence"],
          rows: assessment.featureCatalog.map((feature) => [
            feature.name,
            feature.kind,
            feature.provenance,
            `${feature.repoRelPath}${feature.line === undefined ? "" : `:${feature.line}`}`,
            offlineEvidenceSummary(
              assessment,
              feature.evidenceOccurrenceIds,
              `supports the feature hypothesis “${feature.name}”`,
            ),
          ]),
        },
        { kind: "heading", level: 2, text: "Tool availability" },
        {
          kind: "list",
          items:
            unavailableTools.length === 0
              ? ["All configured tools reported availability."]
              : unavailableTools,
        },
        { kind: "heading", level: 2, text: "Maintainability signals" },
        {
          kind: "table",
          caption: "Bounded static signals",
          headers: ["Signal", "Value", "Interpretation", "Limitation"],
          rows: assessment.maintainabilitySignals.map((signal) => [
            signal.signal === "todo-fixme-markers" ? "maintenance-comment-markers" : signal.signal,
            signal.value,
            signal.interpretation,
            signal.limitation,
          ]),
        },
        offlineEvidenceReferences(
          assessment,
          evidenceIds,
          "supports the repository and implementation summary",
        ),
      ],
    }),
  );
  documents.set(
    "security",
    reportDocument({
      ...base,
      title: "Security assessment",
      kind: "Security static draft",
      nodes: [
        { kind: "heading", level: 1, text: "General security baseline" },
        {
          kind: "paragraph",
          text: "The general static baseline ran at reduced depth. Kit-owned pattern-based checks are not substitutes for Gitleaks, Trivy, Opengrep, OSV-Scanner, or an independent security reviewer, all of which remain explicitly unavailable when not present.",
        },
        { kind: "heading", level: 2, text: "Findings" },
        {
          kind: "table",
          caption: "Static findings",
          headers: ["Title", "Severity", "Confidence", "Location", "Evidence"],
          rows: assessment.findings.map((finding) => [
            finding.title,
            finding.technicalSeverity,
            finding.confidence,
            finding.locations
              .map(
                ({ repoRelPath, startLine }) =>
                  `${repoRelPath}${startLine === undefined ? "" : `:${startLine}`}`,
              )
              .join(", "),
            offlineEvidenceSummary(
              assessment,
              finding.evidenceOccurrenceIds,
              `supports the candidate concern “${finding.title}”`,
            ),
          ]),
        },
        { kind: "heading", level: 2, text: "Profile guidance" },
        {
          kind: "list",
          items: assessment.securityProfileSignals.map(
            (profile) => `${profile.profileId}: ${profile.kind}; ${profile.limitation}`,
          ),
        },
        {
          kind: "paragraph",
          text: "These results describe technical coverage only. They do not claim legal applicability, compliance, certification, attestation, or proof that the product is secure.",
        },
        offlineEvidenceReferences(assessment, evidenceIds, "supports the static security summary"),
      ],
    }),
  );
  documents.set(
    "coverage-limitations",
    reportDocument({
      ...base,
      title: "Coverage and limitations",
      kind: "Coverage draft",
      nodes: [
        { kind: "heading", level: 1, text: "What was and was not assessed" },
        {
          kind: "table",
          caption: "Required domain coverage",
          headers: [
            "Coverage area",
            "Status",
            "Recorded limitation",
            "Reason",
            "Effect",
            "Next action",
            "Controls",
          ],
          rows: assessment.coverage.map((coverage) => {
            const name = OFFLINE_DOMAIN_NAMES[coverage.domainId] ?? coverage.domainId;
            const limitations = offlineCoverageDetails(coverage);
            if (coverage.status !== "pass" && limitations.length === 0) {
              throw new Error(`${coverage.domainId} has no concrete lay limitation explanation`);
            }
            return [
              name,
              coverage.status,
              limitations.map(({ name: limitationName }) => limitationName).join("; ") ||
                "No recorded limitation",
              limitations.map(({ reason }) => reason).join(" ") ||
                "The planned static controls reconciled with recorded results.",
              limitations.map(({ effect }) => effect).join(" ") ||
                offlineCoverageEffect(coverage.status),
              limitations.map(({ action }) => action).join(" ") ||
                offlineCoverageAction(coverage.status),
              `${coverage.reconciledControls} of ${coverage.plannedControls} reconciled`,
            ];
          }),
        },
        { kind: "heading", level: 2, text: "Discovery unknowns" },
        {
          kind: "list",
          items:
            unknownTopics.length === 0
              ? ["All ten discovery topics were answered in the supplied file."]
              : claims
                  .filter(({ unknown }) => unknown !== undefined)
                  .map(
                    ({ topic, unknown }) =>
                      `${topic.replaceAll("-", " ")}. Reason: ${unknown.reason} Confidence effect: ${unknown.confidenceEffect} Coverage effect: ${unknown.coverageEffect} Next action: Software owner: ${unknown.followUp}`,
                  ),
        },
        { kind: "heading", level: 2, text: "Runtime and screenshots" },
        {
          kind: "paragraph",
          text: "Runtime execution and browser automation were unavailable by design in this offline local mode. No screenshot was captured; the screenshot inventory records the explicit reason.",
        },
        { kind: "heading", level: 2, text: "Release blockers" },
        {
          kind: "list",
          items: [
            "Provider architecture and product-code trace analysis unavailable.",
            "Independent security and decision reviews unavailable.",
            "Technical and lay human reviews unavailable.",
            "Official complete export schema execution unavailable in the current package APIs.",
            "Cross-provider equivalence certificate unavailable.",
          ],
        },
      ],
    }),
  );
  const files = [];
  const declared = new Set(["data/evidence-index.json"]);
  for (const [name, document] of documents) {
    files.push({
      path: `reports/${name}.md`,
      mediaType: "text/markdown; charset=utf-8",
      content: renderMarkdown(document, declared),
    });
    files.push({
      path: `reports/${name}.html`,
      mediaType: "text/html; charset=utf-8",
      content: renderHtml(document, declared),
    });
  }
  const indexDocument = reportDocument({
    ...base,
    title: "Offline assessment draft",
    kind: "Draft package index",
    nodes: [
      { kind: "heading", level: 1, text: "Offline assessment draft" },
      {
        kind: "paragraph",
        text: "This deterministic package passed local integrity, reference, export, content, checksum, and ZIP-reopen checks. It is not customer-released because provider and human review gates remain unavailable.",
      },
      {
        kind: "package-links",
        links: [...documents.keys()].map((name) => ({
          path: `reports/${name}.html`,
          label: `${name} report`,
        })),
      },
    ],
  });
  files.push({
    path: "index.html",
    mediaType: "text/html; charset=utf-8",
    content: renderHtml(
      indexDocument,
      new Set(
        files
          .filter(({ path: filePath }) => filePath.endsWith(".html"))
          .map(({ path: filePath }) => filePath),
      ),
    ),
  });
  for (const file of files) {
    validateCustomerContent(file.path, file.content);
    if (file.path.endsWith(".html")) validateStaticHtml(file.path, file.content, true);
  }
  return files;
}

function packageArtifact(payload, pathName, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  payload.set(pathName, bytes);
}

function offlineArtifactEligibility(pathName, bytes, occurrence, activity) {
  return derivePackageArtifactEligibility({
    path: pathName,
    content: bytes,
    artifactKind: "offline-assessment-draft",
    mediaType: "application/octet-stream",
    sensitivity: "customer-confidential",
    redactionState: "none-required",
    evidenceOccurrenceIds: [occurrence.evidenceId],
    eligibility: {
      schemaVersion: "1.0.0",
      sources: [
        {
          occurrence: {
            evidenceId: occurrence.evidenceId,
            runId: occurrence.runId,
            snapshotId: occurrence.snapshotId,
            activityId: occurrence.activityId,
            evidenceType: occurrence.evidenceType,
            sensitivity: occurrence.sensitivity,
            redactionState: occurrence.redactionState,
            validationState: occurrence.validationState,
            collectionLimitations: occurrence.collectionLimitations,
            derivedFromEvidenceIds: occurrence.derivedFromEvidenceIds,
          },
          activity: {
            activityId: activity.activityId,
            runId: activity.runId,
            kind: activity.kind,
          },
        },
      ],
    },
  });
}

function checksumText(payload) {
  return `${[...payload.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([pathName, bytes]) => `${digest(bytes)}  ${pathName}`)
    .join("\n")}\n`;
}

function validateChecksums(payload) {
  const checksumBytes = payload.get("SHA256SUMS");
  if (checksumBytes === undefined) throw new Error("SHA256SUMS is missing");
  const lines = checksumBytes.toString("utf8").trimEnd().split("\n");
  const seen = new Set();
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) {2}([^\r\n]+)$/.exec(line);
    if (match === null) throw new Error("Malformed checksum line");
    const [, expected, pathName] = match;
    const bytes = payload.get(pathName);
    if (
      pathName === "SHA256SUMS" ||
      bytes === undefined ||
      seen.has(pathName) ||
      digest(bytes) !== expected
    ) {
      throw new Error(`Checksum validation failed for ${pathName}`);
    }
    seen.add(pathName);
  }
  for (const pathName of payload.keys()) {
    if (pathName !== "SHA256SUMS" && !seen.has(pathName))
      throw new Error(`Checksum missing for ${pathName}`);
  }
}

function validatePayloadSafety(payload) {
  for (const [pathName, bytes] of payload) {
    if (/\.(?:json|md|html|csv|txt)$/u.test(pathName) || pathName === "SHA256SUMS") {
      assertNoSensitiveOutput(bytes.toString("utf8"));
    }
  }
}

async function atomicWrite(destination, content) {
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
  await rename(temporary, destination);
}

async function validateZipInFreshProcess(zipPath, expectedManifestDigest) {
  const output = execFileSync(process.execPath, [new URL(import.meta.url).pathname], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      RAK_OFFLINE_VALIDATE_ZIP: zipPath,
      RAK_OFFLINE_EXPECTED_MANIFEST_DIGEST: expectedManifestDigest,
    },
  });
  const result = JSON.parse(output);
  if (
    result.status !== "ZIP_REOPEN_VALID" ||
    result.zipSha256 !== prefixedDigest(await readFile(zipPath))
  ) {
    throw new Error("Fresh-process ZIP validation returned an invalid certificate");
  }
  return result;
}

async function freshZipValidationMain(zipPath, expectedManifestDigest) {
  const zipBytes = await readFile(zipPath);
  const reopenedPayload = new Map(
    reopenZip(zipBytes).map(({ path: pathName, content }) => [pathName, content]),
  );
  validateChecksums(reopenedPayload);
  validatePayloadSafety(reopenedPayload);
  const manifestBytes = reopenedPayload.get("manifest.json");
  if (manifestBytes === undefined || prefixedDigest(manifestBytes) !== expectedManifestDigest) {
    throw new Error("Fresh-process ZIP manifest binding mismatch");
  }
  process.stdout.write(
    prettyJson({
      status: "ZIP_REOPEN_VALID",
      zipSha256: prefixedDigest(zipBytes),
      manifestSha256: prefixedDigest(manifestBytes),
      entriesVerified: reopenedPayload.size,
    }),
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const sourceRoot = await canonicalDirectory(options.source, "Source");
  if (sourceRoot === path.parse(sourceRoot).root)
    throw new Error("Filesystem root cannot be assessed");
  const outputRoot = path.resolve(options.outputRoot);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const canonicalOutputRoot = await realpath(outputRoot);
  if (isWithin(sourceRoot, canonicalOutputRoot) || isWithin(canonicalOutputRoot, sourceRoot)) {
    throw new Error("Output root and source repository must not contain one another");
  }
  const discoveryPath = await realpath(path.resolve(options.discoveryPath));
  if (isWithin(sourceRoot, discoveryPath)) {
    // Reading a supplied in-repository discovery file is safe; it remains part of integrity.
  }

  const { commitSha, objectFormat } = inspectGitIdentity(sourceRoot);
  const before = await integritySnapshot(sourceRoot);
  const runId = stableId("run", `${options.projectSlug}\0${commitSha}\0${before.sourceDigest}`);
  const snapshotId = before.manifestDigest;
  const claims = await loadDiscovery(discoveryPath, runId, options.generatedAt);
  const assessment = await assessRepository(sourceRoot, {
    runId,
    snapshotId,
    generatedAt: options.generatedAt,
    availableTools: [],
  });
  validateNativeAssessmentProjection(assessment);
  validateAssessmentReferences(assessment);
  const nativeJson = projectNativeJson(assessment);
  const sarif = projectSarif(assessment);
  const cyclonedx = projectCycloneDx(assessment);
  validateSarifProjection(sarif, assessment);
  validateCycloneDxProjection(cyclonedx);
  const csv = projectFindingsCsv(assessment);

  const after = await integritySnapshot(sourceRoot);
  if (before.sourceDigest !== after.sourceDigest) {
    throw new Error(
      "SOURCE_INTEGRITY_CHANGED: assessment changed tracked or untracked target content",
    );
  }

  const targetSnapshot = {
    schemaVersion: "1.0.0",
    snapshotId,
    sourceKind: "local",
    sanitizedLocator: options.projectSlug,
    gitObjectFormat: objectFormat,
    commitSha,
    baseCommitSha: commitSha,
    mode: "frozen-working-tree",
    manifestBlobId: stableId("blb", before.manifestDigest),
    manifestDigest: before.manifestDigest,
    archiveDigest: prefixedDigest(stableJson(before.manifest)),
    beforeSourceDigest: before.sourceDigest,
    afterSourceDigest: after.sourceDigest,
    includedDirtyPaths: before.includedDirtyPaths,
    excludedDirtyPaths: before.excludedDirtyPaths,
    submodules: "pointers-only",
    lfs: "pointers-only",
    createdAt: options.generatedAt,
  };
  const identityDigest = prefixedDigest(
    stableJson({ commitSha, sourceDigest: before.sourceDigest, discovery: claims }),
  );
  const admittedEvidence = assessment.evidence.map((candidate) => {
    const admitted = admitTextEvidence({
      runId,
      snapshotId,
      activityId: stableId("act", `kit-walker\0${candidate.evidenceId}`),
      repoRelPath: candidate.repoRelPath,
      evidenceType: candidate.evidenceType,
      title: candidate.title,
      text: candidate.safeExcerpt,
      capturedAt: options.generatedAt,
      startLine: candidate.startLine,
      occurrenceKey: candidate.evidenceId,
      collectionLimitations: candidate.collectionLimitations,
    });
    return {
      ...admitted.occurrence,
      evidenceId: candidate.evidenceId,
      validationState: "validated",
      collectionLimitations: [
        ...admitted.occurrence.collectionLimitations,
        "rak-output-class:O0-uncredentialed",
      ],
      linkedFindingIds: assessment.findings
        .filter(({ evidenceOccurrenceIds }) => evidenceOccurrenceIds.includes(candidate.evidenceId))
        .map(({ findingId }) => findingId),
      safeText: admitted.safeText,
    };
  });
  const packageEligibilityActivity = {
    activityId: stableId("act", `offline-package-eligibility\0${runId}`),
    runId,
    attemptId: stableId("att", `offline-package-eligibility\0${runId}`),
    agentId: "rak-offline-static-validator/1.0.0",
    kind: "uncredentialed-evidence-capture",
    captureMethod: "release-owned-offline-static-validation",
    configDigest: identityDigest,
    startedAt: options.generatedAt,
    endedAt: options.generatedAt,
    outcome: "succeeded",
  };
  const packageEligibilityOccurrence = {
    schemaVersion: "1.0.0",
    evidenceId: stableId("ev", `offline-package-eligibility\0${runId}`),
    runId,
    blobId: stableId("blb", `offline-package-eligibility\0${identityDigest}`),
    evidenceType: "offline-package-eligibility",
    title: "Offline uncredentialed package eligibility",
    snapshotId,
    activityId: packageEligibilityActivity.activityId,
    capturedAt: options.generatedAt,
    sensitivity: "customer-confidential",
    redactionState: "none-required",
    validationState: "validated",
    collectionLimitations: [
      "rak-output-class:O0-uncredentialed",
      "Offline static assessment supplied no target or probe credential.",
    ],
    derivedFromEvidenceIds: admittedEvidence.map(({ evidenceId }) => evidenceId).sort(compareUtf8),
    linkedClaimIds: [],
    linkedFindingIds: [],
    linkedControlIds: [],
  };
  const controls = assessment.coverage.map((coverage) => ({
    schemaVersion: "1.0.0",
    controlResultId: stableId("ctl", `${runId}\0${coverage.domainId}`),
    runId,
    plannedControlId: `offline-static/${coverage.domainId}`,
    profileId: "general-security-baseline/offline-static-1",
    controlId: `RAK-OFFLINE/${coverage.domainId}`,
    plannedScope: coverage.domainId,
    status: coverage.status,
    ...(coverage.status === "pass"
      ? {}
      : {
          reasonCode:
            coverage.status === "blocked"
              ? "OFFLINE_RUNTIME_UNAVAILABLE"
              : "REDUCED_STATIC_COVERAGE",
          reason:
            "Offline local mode records unavailable runtime, provider, scanner, and review capabilities without treating them as passed.",
          limitationId: coverage.limitationIds[0] ?? `limitation-${coverage.domainId}`,
        }),
    techniqueIds: ["kit-walker/static"],
    evidenceOccurrenceIds: coverage.evidenceOccurrenceIds,
    activityId: stableId("act", `coverage\0${coverage.domainId}`),
    completedAt: options.generatedAt,
  }));
  const packageStatus = {
    schemaVersion: "1.0.0",
    status: "DRAFT_RELEASE_BLOCKED",
    customerReleaseAuthorized: false,
    runId,
    snapshotId,
    inputBindingDigest: identityDigest,
    deterministicGates: {
      discoveryComplete: true,
      sourceIntegrityVerified: true,
      analyzerNativeValidated: true,
      analyzerReferencesValidated: true,
      sarifSubsetValidated: true,
      cyclonedxSubsetValidated: true,
      reportsRenderedAndContentScanned: true,
      screenshotInventoryPresent: true,
      packageChecksumsPlanned: true,
      zipReopenPlanned: true,
    },
    unavailableReleaseGates: [
      "provider architecture analysis",
      "provider product-code trace analysis",
      "independent security review",
      "independent decision review",
      "technical human review",
      "lay human review",
      "cross-provider equivalence dry run",
      "complete pinned official SARIF and CycloneDX schema execution",
    ],
    statement:
      "This is a deterministically validated offline draft. Missing provider and human gates were not fabricated and customer release is blocked.",
  };
  packageStatus.validationRecordId = `draft-validation:${digest(stableJson(packageStatus))}`;

  const reports = buildReports({
    assessment,
    claims,
    commitSha,
    generatedAt: options.generatedAt,
    identityDigest,
    projectSlug: options.projectSlug,
  });
  const payload = new Map();
  for (const report of reports) packageArtifact(payload, report.path, report.content);
  packageArtifact(
    payload,
    "data/run.json",
    prettyJson({
      schemaVersion: "1.0.0",
      runId,
      projectSlug: options.projectSlug,
      state: "REVIEW_REQUIRED",
      provider: "offline-local",
      commitSha,
      sourceIntegrityDigest: before.sourceDigest,
      generatedAt: options.generatedAt,
    }),
  );
  packageArtifact(payload, "data/target-snapshot.json", prettyJson(targetSnapshot));
  packageArtifact(
    payload,
    "data/source-integrity.json",
    prettyJson({
      schemaVersion: "1.0.0",
      mode: "frozen-working-tree",
      before: {
        manifestDigest: before.manifestDigest,
        statusDigest: before.statusDigest,
        sourceDigest: before.sourceDigest,
        includedDirtyPaths: before.includedDirtyPaths,
        excludedDirtyPaths: [],
      },
      after: {
        manifestDigest: after.manifestDigest,
        statusDigest: after.statusDigest,
        sourceDigest: after.sourceDigest,
        includedDirtyPaths: after.includedDirtyPaths,
        excludedDirtyPaths: [],
      },
      unchanged: true,
    }),
  );
  packageArtifact(payload, "data/product-claims.json", prettyJson(claims));
  packageArtifact(payload, "data/findings.json", prettyJson(assessment.findings));
  packageArtifact(payload, "data/controls.json", prettyJson(controls));
  packageArtifact(payload, "data/coverage.json", prettyJson(assessment.coverage));
  const evidenceIndex = [...admittedEvidence, packageEligibilityOccurrence].map((evidence) => {
    const occurrence = { ...evidence };
    delete occurrence.safeText;
    return occurrence;
  });
  packageArtifact(payload, "data/evidence-index.json", prettyJson(evidenceIndex));
  packageArtifact(
    payload,
    "data/provenance-activities.json",
    prettyJson([
      ...admittedEvidence.map((evidence) => ({
        activityId: evidence.activityId,
        runId,
        attemptId: stableId("att", `kit-walker\0${evidence.evidenceId}`),
        agentId: "rak-kit-walker/1.0.0",
        kind: "uncredentialed-evidence-capture",
        captureMethod: "bounded-static-repository-read",
        startedAt: options.generatedAt,
        endedAt: options.generatedAt,
        outcome: "succeeded",
      })),
      packageEligibilityActivity,
    ]),
  );
  packageArtifact(
    payload,
    "data/decision.json",
    prettyJson({
      schemaVersion: "1.0.0",
      runId,
      recommendation: {
        kind: "conditional-sequence",
        options: ["remediation", "incremental-replacement"],
      },
      confidence: "low",
      criteria: comparisonRows(assessment, claims),
      releaseBlocked: true,
    }),
  );
  packageArtifact(
    payload,
    "data/reviews.json",
    prettyJson({
      schemaVersion: "1.0.0",
      status: "unavailable",
      reviews: [],
      requiredKinds: [
        "independent-security",
        "independent-decision",
        "technical-human",
        "lay-human",
      ],
      reason: "Offline local mode does not fabricate provider or human reviews.",
    }),
  );
  packageArtifact(
    payload,
    "data/equivalence-certificate.json",
    prettyJson({
      schemaVersion: "1.0.0",
      status: "unavailable",
      reason: "A single offline local run cannot establish Codex and Claude Code equivalence.",
    }),
  );
  packageArtifact(
    payload,
    "data/screenshots.json",
    prettyJson([
      {
        screenshotId: "screenshot-runtime-overview",
        title: "Runtime overview",
        status: "unavailable",
        unavailableReason:
          "Runtime and browser execution are disabled in offline local static mode.",
      },
    ]),
  );
  packageArtifact(payload, "data/package-status.json", prettyJson(packageStatus));
  packageArtifact(payload, "data/assessment.json", nativeJson);
  packageArtifact(payload, "exports/findings.sarif.json", prettyJson(sarif));
  packageArtifact(payload, "exports/sbom.cdx.json", prettyJson(cyclonedx));
  packageArtifact(payload, "exports/findings.csv", csv);
  packageArtifact(
    payload,
    "licenses/NOTICE.txt",
    "Repository Assessment Kit offline draft. Analyzer availability and limitations are recorded in data/assessment.json.\n",
  );
  for (const evidence of admittedEvidence.filter(
    ({ evidenceId }) =>
      assessment.findings.some(({ evidenceOccurrenceIds }) =>
        evidenceOccurrenceIds.includes(evidenceId),
      ) ||
      assessment.featureCatalog.some(({ evidenceOccurrenceIds }) =>
        evidenceOccurrenceIds.includes(evidenceId),
      ),
  )) {
    packageArtifact(payload, `evidence/${evidence.evidenceId}.txt`, `${evidence.safeText}\n`);
  }
  const manifest = {
    schemaVersion: "1.0.0",
    profile: "rak-offline-draft/1.0.0",
    runId,
    snapshotId,
    generatedAt: options.generatedAt,
    status: "DRAFT_RELEASE_BLOCKED",
    entries: [...payload.entries()]
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([pathName, bytes]) => ({
        path: pathName,
        byteLength: String(bytes.byteLength),
        sha256: prefixedDigest(bytes),
        eligibility: offlineArtifactEligibility(
          pathName,
          bytes,
          packageEligibilityOccurrence,
          packageEligibilityActivity,
        ),
      })),
  };
  packageArtifact(payload, "manifest.json", prettyJson(manifest));
  packageArtifact(payload, "SHA256SUMS", checksumText(payload));
  validateChecksums(payload);
  validatePayloadSafety(payload);

  const zipBytes = createDeterministicZip(payload);
  const reopenedPayload = new Map(
    reopenZip(zipBytes).map(({ path: pathName, content }) => [pathName, content]),
  );
  validateChecksums(reopenedPayload);
  validatePayloadSafety(reopenedPayload);
  if (
    stableJson(JSON.parse(reopenedPayload.get("manifest.json").toString("utf8"))) !==
    stableJson(manifest)
  ) {
    throw new Error("Reopened ZIP manifest differs from the validated manifest");
  }
  const zipDigest = digest(zipBytes);
  const runDirectory = path.join(
    canonicalOutputRoot,
    `${options.projectSlug}-${commitSha}-${options.directoryTimestamp}`,
  );
  await mkdir(runDirectory, { recursive: false, mode: 0o700 });
  const zipName = `${options.projectSlug}-${commitSha}-${options.directoryTimestamp}-DRAFT.zip`;
  const zipPath = path.join(runDirectory, zipName);
  await atomicWrite(zipPath, zipBytes);
  await atomicWrite(`${zipPath}.sha256`, `${zipDigest}  ${zipName}\n`);
  const freshZipValidation = await validateZipInFreshProcess(
    zipPath,
    prefixedDigest(payload.get("manifest.json")),
  );
  const validationCertificate = {
    schemaVersion: "1.0.0",
    certificateKind: "offline-draft-validation",
    certificateId: `draft-validation:${digest(`${zipDigest}\0${identityDigest}`)}`,
    verdict: "DRAFT_VALIDATED_RELEASE_BLOCKED",
    customerReleaseAuthorized: false,
    runId,
    snapshotId,
    commitSha,
    sourceIntegrityDigest: before.sourceDigest,
    inputBindingDigest: identityDigest,
    zipSha256: `sha256:${zipDigest}`,
    zipReopenedInFreshParserInvocation: true,
    checksumEntriesVerified: freshZipValidation.entriesVerified,
    releaseBlockers: packageStatus.unavailableReleaseGates,
    generatedAt: options.generatedAt,
  };
  await atomicWrite(`${zipPath}.validation.json`, prettyJson(validationCertificate));
  process.stdout.write(
    `${prettyJson({
      status: validationCertificate.verdict,
      runDirectory,
      zipPath,
      validationCertificatePath: `${zipPath}.validation.json`,
      commitSha,
      sourceIntegrityDigest: before.sourceDigest,
    })}`,
  );
}

const freshZipPath = process.env.RAK_OFFLINE_VALIDATE_ZIP;
const runPromise =
  freshZipPath === undefined
    ? main()
    : freshZipValidationMain(freshZipPath, process.env.RAK_OFFLINE_EXPECTED_MANIFEST_DIGEST ?? "");
runPromise.catch((error) => {
  process.stderr.write(
    `offline assessment failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

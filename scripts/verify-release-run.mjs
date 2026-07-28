#!/usr/bin/env node

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  validateCycloneDxProjection,
  validateNativeAssessmentProjection,
  validateSarifProjection,
} from "../packages/analyzers/dist/index.js";
import { reopenZip } from "../packages/packaging/dist/index.js";
import { validateCustomerContent, validateStaticHtml } from "../packages/reporting/dist/index.js";
import {
  RELEASE_RECEIPT_FILE,
  canonicalJson,
  exclusiveFsyncWrite,
  isWithin,
  loadJournal,
  parseStrictJson,
  sha256,
  verifyImmutablePath,
} from "./release-run-state.mjs";

const REQUIRED = [
  "index.html",
  "reports/executive.html",
  "reports/executive.md",
  "reports/decision.html",
  "reports/decision.md",
  "reports/technical.html",
  "reports/technical.md",
  "reports/security.html",
  "reports/security.md",
  "reports/coverage-limitations.html",
  "reports/coverage-limitations.md",
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
  "data/assessment.json",
  "data/package-status.json",
  "exports/findings.sarif.json",
  "exports/sbom.cdx.json",
  "exports/findings.csv",
  "manifest.json",
  "SHA256SUMS",
];

function exactKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseChecksums(text) {
  const result = new Map();
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    const unsafeName =
      match !== null &&
      [...match[2]].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f || character === "\\";
      });
    if (match === null || unsafeName || result.has(match[2])) {
      throw new Error("SHA256SUMS contains a malformed or duplicate entry");
    }
    result.set(match[2], `sha256:${match[1]}`);
  }
  return result;
}

function assertSafeZipPath(pathName) {
  const hasControl = [...pathName].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    pathName.length === 0 ||
    pathName.startsWith("/") ||
    pathName.includes("\\") ||
    hasControl ||
    pathName.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`ZIP contains an unsafe path: ${pathName}`);
  }
}

export async function verifyDraftZip(zipPath, expected = {}) {
  const info = await lstat(zipPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Draft ZIP is not a regular file");
  const zipBytes = await readFile(zipPath);
  if (zipBytes.byteLength > 512 * 1024 * 1024) throw new Error("Draft ZIP exceeds release limit");
  const entries = reopenZip(zipBytes);
  if (entries.length > 100_000) throw new Error("Draft ZIP has too many entries");
  const payload = new Map();
  for (const entry of entries) {
    assertSafeZipPath(entry.path);
    if (payload.has(entry.path)) throw new Error(`Draft ZIP contains duplicate ${entry.path}`);
    payload.set(entry.path, entry.content);
  }
  for (const required of REQUIRED) {
    if (!payload.has(required)) throw new Error(`Draft ZIP is missing ${required}`);
  }
  const checksums = parseChecksums(payload.get("SHA256SUMS").toString("utf8"));
  for (const [pathName, bytes] of payload) {
    if (pathName === "SHA256SUMS") continue;
    if (checksums.get(pathName) !== sha256(bytes)) {
      throw new Error(`Draft ZIP checksum mismatch: ${pathName}`);
    }
  }
  if (checksums.size !== payload.size - 1) {
    throw new Error("Draft ZIP checksum inventory does not reconcile");
  }
  const manifest = parseStrictJson(payload.get("manifest.json").toString("utf8"), "manifest");
  const manifestKeys = [
    "schemaVersion",
    "profile",
    "runId",
    "snapshotId",
    "generatedAt",
    "status",
    "entries",
  ];
  if (
    !exactKeys(manifest, manifestKeys) ||
    manifest.schemaVersion !== "1.0.0" ||
    manifest.profile !== "rak-offline-draft/1.0.0" ||
    manifest.status !== "DRAFT_RELEASE_BLOCKED" ||
    !Array.isArray(manifest.entries)
  ) {
    throw new Error("Draft ZIP manifest identity or status is invalid");
  }
  const manifestPaths = new Set();
  for (const entry of manifest.entries) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      typeof entry.byteLength !== "string" ||
      typeof entry.sha256 !== "string" ||
      manifestPaths.has(entry.path) ||
      !payload.has(entry.path) ||
      String(payload.get(entry.path).byteLength) !== entry.byteLength ||
      sha256(payload.get(entry.path)) !== entry.sha256
    ) {
      throw new Error("Draft ZIP manifest entry does not bind the reopened payload");
    }
    manifestPaths.add(entry.path);
  }
  if (manifestPaths.size !== payload.size - 2) {
    throw new Error("Draft ZIP manifest inventory does not reconcile");
  }
  for (const [pathName, bytes] of payload) {
    if (pathName.endsWith(".html")) {
      const content = bytes.toString("utf8");
      validateCustomerContent(pathName, content);
      validateStaticHtml(pathName, content, true);
    }
  }
  const assessment = parseStrictJson(
    payload.get("data/assessment.json").toString("utf8"),
    "native assessment",
  );
  const sarif = parseStrictJson(
    payload.get("exports/findings.sarif.json").toString("utf8"),
    "SARIF projection",
  );
  const cyclonedx = parseStrictJson(
    payload.get("exports/sbom.cdx.json").toString("utf8"),
    "CycloneDX projection",
  );
  validateNativeAssessmentProjection(assessment);
  validateSarifProjection(sarif, assessment);
  validateCycloneDxProjection(cyclonedx);
  const reviews = parseStrictJson(payload.get("data/reviews.json").toString("utf8"), "reviews");
  const equivalence = parseStrictJson(
    payload.get("data/equivalence-certificate.json").toString("utf8"),
    "equivalence certificate",
  );
  const packageStatus = parseStrictJson(
    payload.get("data/package-status.json").toString("utf8"),
    "package status",
  );
  if (
    reviews.status !== "unavailable" ||
    equivalence.status !== "unavailable" ||
    packageStatus.customerReleaseAuthorized !== false
  ) {
    throw new Error("Draft ZIP falsely represents an unavailable release gate as complete");
  }
  if (expected.runId !== undefined && manifest.runId !== expected.runId) {
    throw new Error("Draft ZIP run binding mismatch");
  }
  if (expected.snapshotId !== undefined && manifest.snapshotId !== expected.snapshotId) {
    throw new Error("Draft ZIP snapshot binding mismatch");
  }
  return {
    status: "DRAFT_VALIDATED_RELEASE_BLOCKED",
    customerReleaseAuthorized: false,
    zipSha256: sha256(zipBytes),
    zipByteLength: String(zipBytes.byteLength),
    manifestSha256: sha256(payload.get("manifest.json")),
    entriesVerified: payload.size,
    runId: manifest.runId,
    snapshotId: manifest.snapshotId,
    packageStatus,
  };
}

export async function verifyReleaseRun(
  runDirectory,
  kitRoot = path.resolve(import.meta.dirname, ".."),
) {
  const loaded = await loadJournal(runDirectory, kitRoot);
  const { state } = loaded;
  if (state.package?.zipPath === undefined) throw new Error("Journal has no draft ZIP binding");
  const zipPath = await realpath(state.package.zipPath);
  const suppliedZipInfo = await lstat(state.package.zipPath);
  if (!suppliedZipInfo.isFile() || suppliedZipInfo.isSymbolicLink()) {
    throw new Error("Journal package path is not a no-follow regular file");
  }
  if (!isWithin(loaded.runDirectory, zipPath)) {
    throw new Error("Journal package path escapes the generated run directory");
  }
  if (!(await verifyImmutablePath(zipPath, state.package.zipByteLength, state.package.zipSha256))) {
    throw new Error("Journal-bound draft ZIP changed after validation");
  }
  const validation = await verifyDraftZip(zipPath, {
    runId: state.offlineDraft.runId,
    snapshotId: state.offlineDraft.snapshotId,
  });
  if (
    validation.zipSha256 !== state.package.zipSha256 ||
    validation.manifestSha256 !== state.package.manifestSha256
  ) {
    throw new Error("Fresh draft validation does not match the journal package binding");
  }
  const receipt = {
    schemaVersion: "1.0.0",
    receiptKind: "rak-release-verification/1.0.0",
    runId: state.runId,
    provider: state.provider,
    inputBinding: state.inputBinding,
    inputBindingDigest: state.inputBindingDigest,
    journalDigest: state.journalDigest,
    configDigest: state.configDigest,
    originalSourceStateDigest: sha256(canonicalJson(state.source)),
    snapshotManifestDigest: state.snapshot.manifestDigest,
    packageZipSha256: validation.zipSha256,
    packageManifestSha256: validation.manifestSha256,
    providerTaskOutcomeDigest: sha256(
      canonicalJson(
        state.tasks.map(({ taskId, outcome, proposalReceipt, limitationIds }) => ({
          taskId,
          outcome,
          proposalReceipt,
          limitationIds,
        })),
      ),
    ),
    status: "DRAFT_VALIDATED_RELEASE_BLOCKED",
    customerReleaseAuthorized: false,
    limitations: state.limitations,
    verifiedAt: state.completedAt ?? state.updatedAt,
  };
  receipt.receiptDigest = sha256(canonicalJson(receipt));
  const receiptPath = path.join(loaded.runDirectory, RELEASE_RECEIPT_FILE);
  const existingInfo = await lstat(receiptPath).catch(() => undefined);
  if (existingInfo !== undefined) {
    if (!existingInfo.isFile() || existingInfo.isSymbolicLink()) {
      throw new Error("Existing verification receipt is not a no-follow regular file");
    }
    const existing = parseStrictJson(await readFile(receiptPath, "utf8"), "verification receipt");
    if (canonicalJson(existing) !== canonicalJson(receipt)) {
      throw new Error("Immutable verification receipt conflicts with current run bindings");
    }
    return existing;
  }
  await exclusiveFsyncWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--run-dir" || argv[1].startsWith("-")) {
    throw new Error(
      "Usage: node scripts/verify-release-run.mjs --run-dir <generated run directory>",
    );
  }
  return argv[1];
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  verifyReleaseRun(parseArguments(process.argv.slice(2)))
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(
        `release verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}

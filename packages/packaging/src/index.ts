import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { link, lstat, open, readdir, realpath, stat, unlink } from "node:fs/promises";
import { basename, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assessmentDomains,
  discoveryTopics,
  productClaimSchema,
  runDocumentSchema,
  targetSnapshotSchema,
} from "@rak/contracts";
import canonicalize from "canonicalize";

export {
  AgeCliEncryptionProvider,
  ageCliCapability,
  type AgeCliCapability,
  type AgeCliProviderOptions,
  type VerifiedAgeReleaseAuthority,
} from "./age-provider.js";

const canonicalizeJson = canonicalize as unknown as (input: unknown) => string | undefined;
const execFileAsync = promisify(execFile);

export const packageStages = Object.freeze([
  "ADMISSION_COMPLETE",
  "REDACTION_COMPLETE",
  "REVIEWS_COMPLETE",
  "STAGING_FROZEN",
  "MANIFESTED",
  "PREZIP_VALID",
  "ZIP_CREATED",
  "ZIP_REOPEN_VALID",
  "RELEASED",
]);

export interface PackageArtifact {
  path: string;
  content: Uint8Array | string;
  artifactKind: string;
  mediaType: string;
  schemaOrProfile?: string;
  sensitivity: "public" | "customer-confidential";
  redactionState: "none-required" | "redacted";
  evidenceOccurrenceIds: string[];
  eligibility: PackageArtifactEligibility;
  references?: string[];
}

export type PackageOutputClass =
  | "O0-uncredentialed"
  | "O1-secret-control"
  | "O2-credential-tainted-raw"
  | "O3-trusted-derivative"
  | "O4-human-summary";

export interface PackageEligibilityOccurrence {
  evidenceId: string;
  runId: string;
  snapshotId: string;
  activityId: string;
  evidenceType: string;
  sensitivity: "public" | "customer-confidential" | "secret-suspected" | "restricted";
  redactionState: "none-required" | "pending" | "redacted" | "excluded";
  validationState: "unreviewed" | "validated" | "disputed" | "invalidated";
  collectionLimitations: string[];
  derivedFromEvidenceIds: string[];
}

export interface PackageEligibilityActivity {
  activityId: string;
  runId: string;
  kind:
    | "uncredentialed-evidence-capture"
    | "secret-control"
    | "credential-tainted-capture"
    | "trusted-credential-derivation"
    | "technical-human-summary";
}

export interface PackageEligibilityValidation {
  validatorId: "rak-o3-deterministic-validator/1.0.0";
  inputDigest: string;
  outputDigest: string;
  status: "passed";
}

export interface PackageEligibilityReview {
  reviewId: string;
  kind: "technical-human";
  verdict: "passed" | "passed-with-objections";
  inputDigest: string;
  evidenceOccurrenceIds: string[];
}

export interface PackageArtifactEligibility {
  schemaVersion: "1.0.0";
  sources: Array<{
    occurrence: PackageEligibilityOccurrence;
    activity: PackageEligibilityActivity;
    deterministicValidation?: PackageEligibilityValidation;
    technicalHumanReview?: PackageEligibilityReview;
    o3ParentProof?: {
      occurrence: PackageEligibilityOccurrence;
      activity: PackageEligibilityActivity & { kind: "trusted-credential-derivation" };
      fixedResult: Record<string, unknown>;
      deterministicValidation: PackageEligibilityValidation;
      technicalHumanReview: PackageEligibilityReview;
    };
  }>;
}

export interface PackageManifest {
  schemaVersion: "1.0.0";
  profile: "rak-export-profile/1.0.0";
  runId: string;
  snapshotId: string;
  generatedAt: string;
  entries: PackageManifestEntry[];
}

export interface PackageManifestEntry {
  path: string;
  role: "payload" | "manifest-self" | "checksums-self";
  artifactKind: string;
  mediaType: string;
  byteLength?: string;
  sha256?: string;
  schemaOrProfile?: string;
  sensitivity: string;
  redactionState: string;
  evidenceOccurrenceIds: string[];
  eligibility?: {
    outputClass: "O0-uncredentialed" | "O3-trusted-derivative" | "O4-human-summary";
    proofDigest: string;
    sourceEvidenceIds: string[];
    provenanceActivityIds: string[];
    deterministicValidatorIds: string[];
    technicalHumanReviewIds: string[];
  };
}

export interface PackageContentGates {
  knownSecrets?: string[];
  forbiddenHostPaths?: string[];
  placeholderPattern?: RegExp;
}

export interface PackageLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxPathBytes: number;
}

export interface StrongEncryptionProvider {
  name: string;
  algorithm: "age-v1";
  trusted: true;
  encryptAndVerify(plainZip: Uint8Array): Promise<{
    encrypted: Uint8Array;
    recoveredZipSha256: string;
  }>;
}

export type EncryptionCapability =
  | { available: true; mechanism: "age-v1"; provider: string }
  | { available: false; reason: string };

export interface PackageBinding {
  packageRequestDigest: string;
  artifactSetDigest: string;
  runId: string;
  snapshotId: string;
}

export interface BuildPrerequisiteCertificatesOptions {
  projectSlug: string;
  commitSha: string;
  runId: string;
  snapshotId: string;
  generatedAt: string;
  packageBaseName: string;
  artifacts: PackageArtifact[];
  validatorId: string;
  evidenceOccurrenceIds: string[];
  validationReportDigests: Record<PrerequisiteStage, string>;
}

export interface CreatePackageOptions {
  outputDirectory: string;
  packageBaseName: string;
  projectSlug: string;
  commitSha: string;
  runId: string;
  snapshotId: string;
  generatedAt: string;
  artifacts: PackageArtifact[];
  releasePrerequisites: PackageReleasePrerequisites;
  /** @deprecated The required inventory is frozen and cannot be overridden. */
  requiredPaths?: string[];
  gates?: PackageContentGates;
  limits?: Partial<PackageLimits>;
  encryption?: { requested: boolean; provider?: StrongEncryptionProvider };
}

export interface PackageReleasePrerequisites {
  certificates: PackageStageCertificate[];
}

export type PackageStage = (typeof packageStages)[number];
export type PrerequisiteStage =
  | "ADMISSION_COMPLETE"
  | "REDACTION_COMPLETE"
  | "REVIEWS_COMPLETE"
  | "STAGING_FROZEN";

export interface PackageStageCertificate {
  schemaVersion: "1.0.0";
  certificateId: string;
  certificateDigest: string;
  runId: string;
  snapshotId: string;
  stage: PackageStage;
  status: "passed";
  current: true;
  packageRequestDigest: string;
  artifactSetDigest: string;
  inputDigest: string;
  outputDigest: string;
  previousCertificateDigest?: string;
  validationReportDigest: string;
  evidenceOccurrenceIds: string[];
  issuedAt: string;
  issuer:
    | { kind: "trusted-validator"; validatorId: string }
    | {
        kind: "reviewer-panel";
        validatorId: string;
        reviewerKinds: Array<
          "independent-security" | "independent-decision" | "technical-human" | "lay-human"
        >;
      };
}

export interface PackageResult {
  zipPath: string;
  zipSha256Path: string;
  zipSha256: string;
  manifest: PackageManifest;
  stages: readonly string[];
  stageCertificates: PackageStageCertificate[];
  standardsValidation: {
    semanticSubset: "passed";
    officialSchemas: {
      status: "unavailable";
      reason: string;
      releaseBlocking: true;
    };
  };
  releaseStatus: "validated-not-released";
  encryption:
    | { status: "not-requested" }
    | { status: "unavailable"; reason: string }
    | {
        status: "created";
        mechanism: "age-v1";
        path: string;
        sha256Path: string;
        sha256: string;
      };
}

export interface ZipEntry {
  path: string;
  content: Uint8Array;
  crc32: number;
}

export interface FreshProcessZipValidation {
  status: "passed";
  zipSha256: string;
  manifestDigest: string;
  validationDigest: string;
  processId: number;
}

export const DEFAULT_LIMITS: PackageLimits = Object.freeze({
  maxEntries: 10_000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxPathBytes: 512,
});

export const REQUIRED_CUSTOMER_FILES = Object.freeze([
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
  "data/screenshots.json",
  "exports/findings.sarif.json",
  "exports/sbom.cdx.json",
  "exports/findings.csv",
  "licenses/NOTICE.txt",
]);

const GENERATED_PATHS = new Set(["manifest.json", "SHA256SUMS"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_PLACEHOLDER_PATTERN =
  /\b(?:TODO|TBD|FIXME|CHANGEME|PLACEHOLDER|COMING\s+SOON|XXX|INSERT\s+(?:TEXT|CONTENT|HERE)|LOREM\s+IPSUM|YOUR\s+(?:COMPANY|PROJECT|NAME))\b/i;
const HOST_PATH_PATTERN =
  /(?:^|[\s"'(])(?:\/(?:Users|home|workspace|tmp|var\/folders|etc)\/[^\s"'<>]+|[A-Za-z]:\\(?:Users|Documents and Settings|Windows)\\[^\s"'<>]+)/m;
const TEXT_MEDIA_PATTERN = /^(?:text\/|application\/(?:json|sarif\+json|xml|javascript))/;
const SSH_MATERIAL_PATTERN =
  /BEGIN (?:OPENSSH|RSA|EC|DSA|ENCRYPTED)? ?PRIVATE KEY|SSH_AUTH_SOCK|IdentityFile\s+/i;
const SECRET_PATTERN =
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|(?:aws_secret_access_key|client_secret|private_key)\s*[:=]\s*["']?[A-Za-z0-9/+_=.-]{16,}/i;
const COMPLIANCE_CLAIM_PATTERN =
  /\b(?:fully compliant|guaranteed compliant|meets all regulatory requirements|(?:is|are|was|were|achieved|provides?)\s+(?!not\b)(?:[A-Za-z -]+\s+)?(?:certified|certification|compliant))\b/i;
const LOCKED_HTML_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  html: ["lang"],
  head: [],
  meta: ["charset", "http-equiv", "content", "name"],
  title: [],
  style: [],
  body: [],
  a: ["class", "href"],
  header: [],
  p: [],
  nav: ["aria-label"],
  h1: ["id"],
  h2: ["id"],
  h3: ["id"],
  ul: [],
  li: [],
  aside: [],
  main: ["id"],
  footer: [],
  table: [],
  caption: [],
  thead: [],
  tbody: [],
  tr: [],
  th: ["scope"],
  td: [],
  code: [],
});
export const LOCKED_REPORT_RENDERER_CSS =
  "body{font-family:system-ui,sans-serif;line-height:1.5;max-width:72rem;margin:2rem auto;padding:0 1rem;color:#17202a}h1,h2,h3{line-height:1.2}table{border-collapse:collapse;width:100%}th,td{border:1px solid #adb5bd;padding:.5rem;text-align:left;vertical-align:top}caption{font-weight:700;text-align:left;margin:.5rem 0}code{background:#f1f3f5;padding:.1rem .25rem}a{color:#174ea6}.skip-link{display:block;font-weight:700}aside{border-left:.25rem solid #6c757d;padding-left:1rem}";
export const LOCKED_REPORT_RENDERER_CSS_SHA256 = createHash("sha256")
  .update(LOCKED_REPORT_RENDERER_CSS)
  .digest("base64");
const REQUIRED_CRITERIA = new Set([
  "recoverability",
  "system-boundaries",
  "security-risk",
  "engineering-risk",
  "critical-feature-parity",
  "expected-scale",
  "rebuild-feasibility",
]);

export function encryptionCapability(
  provider: StrongEncryptionProvider | undefined,
): EncryptionCapability {
  if (provider === undefined) {
    return {
      available: false,
      reason:
        "Strong encryption is unavailable: no trusted age v1 provider with decrypt-and-verify support was supplied.",
    };
  }
  if (provider.algorithm !== "age-v1" || provider.trusted !== true) {
    return {
      available: false,
      reason: "Strong encryption is unavailable: only a trusted age v1 provider is accepted.",
    };
  }
  return { available: true, mechanism: "age-v1", provider: provider.name };
}

export function buildPackageReleasePrerequisites(
  options: BuildPrerequisiteCertificatesOptions,
): PackageReleasePrerequisites {
  const artifacts = normalizeArtifacts(options.artifacts, DEFAULT_LIMITS);
  const binding = computePackageBinding(options, artifacts);
  const certificates: PackageStageCertificate[] = [];
  for (const stage of packageStages.slice(0, 4) as readonly PrerequisiteStage[]) {
    const previous = certificates.at(-1);
    const inputDigest = previous?.outputDigest ?? binding.packageRequestDigest;
    const issuer: PackageStageCertificate["issuer"] =
      stage === "REVIEWS_COMPLETE"
        ? {
            kind: "reviewer-panel",
            validatorId: options.validatorId,
            reviewerKinds: [
              "independent-security",
              "independent-decision",
              "technical-human",
              "lay-human",
            ],
          }
        : { kind: "trusted-validator", validatorId: options.validatorId };
    certificates.push(
      createStageCertificate({
        binding,
        stage,
        inputDigest,
        ...(previous === undefined
          ? {}
          : { previousCertificateDigest: previous.certificateDigest }),
        validationReportDigest: options.validationReportDigests[stage],
        evidenceOccurrenceIds: options.evidenceOccurrenceIds,
        issuedAt: options.generatedAt,
        issuer,
      }),
    );
  }
  return { certificates };
}

function computePackageBinding(
  options: Pick<
    BuildPrerequisiteCertificatesOptions,
    "projectSlug" | "commitSha" | "runId" | "snapshotId" | "generatedAt" | "packageBaseName"
  >,
  artifacts: NormalizedArtifact[],
): PackageBinding {
  const artifactSetDigest = canonicalDigest(
    artifacts.map((artifact) => ({
      path: artifact.path,
      sha256: sha256(artifact.bytes),
      byteLength: String(artifact.bytes.byteLength),
      artifactKind: artifact.artifactKind,
      mediaType: artifact.mediaType,
      sensitivity: artifact.sensitivity,
      redactionState: artifact.redactionState,
      evidenceOccurrenceIds: [...artifact.evidenceOccurrenceIds].sort(compareUtf8),
      eligibility: artifact.derivedEligibility,
    })),
  );
  return {
    runId: options.runId,
    snapshotId: options.snapshotId,
    artifactSetDigest,
    packageRequestDigest: canonicalDigest({
      projectSlug: options.projectSlug,
      commitSha: options.commitSha,
      runId: options.runId,
      snapshotId: options.snapshotId,
      generatedAt: options.generatedAt,
      packageBaseName: options.packageBaseName,
      artifactSetDigest,
    }),
  };
}

function createStageCertificate(options: {
  binding: PackageBinding;
  stage: PackageStage;
  inputDigest: string;
  previousCertificateDigest?: string;
  validationReportDigest: string;
  evidenceOccurrenceIds: string[];
  issuedAt: string;
  issuer: PackageStageCertificate["issuer"];
}): PackageStageCertificate {
  const outputDigest = canonicalDigest({
    stage: options.stage,
    inputDigest: options.inputDigest,
    artifactSetDigest: options.binding.artifactSetDigest,
    packageRequestDigest: options.binding.packageRequestDigest,
    validationReportDigest: options.validationReportDigest,
    issuer: options.issuer,
  });
  const body = {
    schemaVersion: "1.0.0" as const,
    runId: options.binding.runId,
    snapshotId: options.binding.snapshotId,
    stage: options.stage,
    status: "passed" as const,
    current: true as const,
    packageRequestDigest: options.binding.packageRequestDigest,
    artifactSetDigest: options.binding.artifactSetDigest,
    inputDigest: options.inputDigest,
    outputDigest,
    ...(options.previousCertificateDigest === undefined
      ? {}
      : { previousCertificateDigest: options.previousCertificateDigest }),
    validationReportDigest: options.validationReportDigest,
    evidenceOccurrenceIds: [...options.evidenceOccurrenceIds].sort(compareUtf8),
    issuedAt: options.issuedAt,
    issuer: options.issuer,
  };
  const certificateDigest = canonicalDigest(body);
  return {
    ...body,
    certificateId: `cert_${certificateDigest.slice("sha256:".length, 30)}`,
    certificateDigest,
  };
}

export async function createCustomerPackage(options: CreatePackageOptions): Promise<PackageResult> {
  validatePackageBaseName(options.packageBaseName);
  if (options.requiredPaths !== undefined)
    throw new Error("Required customer inventory is frozen and cannot be overridden");
  const outputDirectory = await validateOutputDirectory(
    options.outputDirectory,
    options.projectSlug,
    options.commitSha,
    options.generatedAt,
  );
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const artifacts = normalizeArtifacts(options.artifacts, limits);
  const binding = computePackageBinding(options, artifacts);
  validateReleasePrerequisites(options.releasePrerequisites, binding, options.generatedAt);
  validateRequiredInventory(artifacts, [...REQUIRED_CUSTOMER_FILES]);
  validateReferences(artifacts);
  validateContentGates(artifacts, options.gates ?? {});

  const manifest = createManifest({
    runId: options.runId,
    snapshotId: options.snapshotId,
    generatedAt: options.generatedAt,
    artifacts,
  });
  const manifestText = canonicalizeJson(manifest);
  if (manifestText === undefined) throw new Error("Manifest could not be canonicalized");
  const payload = new Map(artifacts.map((artifact) => [artifact.path, artifact.bytes]));
  payload.set("manifest.json", Buffer.from(`${manifestText}\n`));
  const checksums = createChecksums(payload);
  payload.set("SHA256SUMS", Buffer.from(checksums));

  validateOfflineDocuments(payload);
  validateEligibilityAgainstPayload(artifacts, payload);
  validateCertificateEvidence(options.releasePrerequisites, payload);
  validateSemanticReferences(payload);
  validateHtmlResources(payload);
  validatePayloadAgainstManifest(payload, manifest);
  validatePayloadContent(payload, options.gates ?? {});
  const zipBytes = createDeterministicZip(payload, limits);
  validateReopenedZip(zipBytes, manifest, limits, options.gates ?? {});

  const zipPath = join(outputDirectory, `${options.packageBaseName}.zip`);
  const zipSha256 = sha256(zipBytes);
  const zipSha256Path = `${zipPath}.sha256`;
  await atomicWrite(zipPath, zipBytes);
  const freshValidation = await validatePersistedZipInFreshProcess(zipPath);
  if (freshValidation.zipSha256 !== zipSha256)
    throw new Error("Fresh-process ZIP digest differs from the created archive");
  await atomicWrite(zipSha256Path, Buffer.from(`${zipSha256}  ${basename(zipPath)}\n`, "utf8"));

  let encryption: PackageResult["encryption"] = { status: "not-requested" };
  if (options.encryption?.requested === true) {
    const capability = encryptionCapability(options.encryption.provider);
    if (!capability.available) {
      encryption = { status: "unavailable", reason: capability.reason };
    } else {
      const provider = options.encryption.provider;
      if (provider === undefined) throw new Error("Encryption provider disappeared");
      const result = await provider.encryptAndVerify(zipBytes);
      if (result.encrypted.byteLength === 0)
        throw new Error("Trusted encryption provider returned no data");
      if (result.recoveredZipSha256 !== zipSha256)
        throw new Error("Encrypted package recovery digest does not match the validated ZIP");
      const encryptedPath = `${zipPath}.age`;
      const encryptedSha256 = sha256(result.encrypted);
      const encryptedSha256Path = `${encryptedPath}.sha256`;
      await atomicWrite(encryptedPath, result.encrypted);
      await atomicWrite(
        encryptedSha256Path,
        Buffer.from(`${encryptedSha256}  ${basename(encryptedPath)}\n`, "utf8"),
      );
      encryption = {
        status: "created",
        mechanism: "age-v1",
        path: encryptedPath,
        sha256Path: encryptedSha256Path,
        sha256: encryptedSha256,
      };
    }
  }
  const stageCertificates = [...options.releasePrerequisites.certificates];
  let prior = stageCertificates.at(-1);
  for (const stage of packageStages.slice(4, -1)) {
    if (prior === undefined) throw new Error("Prerequisite certificate chain disappeared");
    const validationReportDigest =
      stage === "ZIP_REOPEN_VALID"
        ? freshValidation.validationDigest
        : canonicalDigest({
            stage,
            zipSha256,
            manifestDigest: sha256(payload.get("manifest.json")!),
          });
    const certificate = createStageCertificate({
      binding,
      stage,
      inputDigest: prior.outputDigest,
      previousCertificateDigest: prior.certificateDigest,
      validationReportDigest,
      evidenceOccurrenceIds: prior.evidenceOccurrenceIds,
      issuedAt: options.generatedAt,
      issuer: { kind: "trusted-validator", validatorId: "rak-packaging/1.0.0" },
    });
    stageCertificates.push(certificate);
    prior = certificate;
  }
  return {
    zipPath,
    zipSha256Path,
    zipSha256,
    manifest,
    stages: packageStages.slice(0, -1),
    stageCertificates,
    standardsValidation: {
      semanticSubset: "passed",
      officialSchemas: {
        status: "unavailable",
        reason:
          "Vendored official SARIF Errata 01, CycloneDX 1.7, and complete native schema validators are not present in this release image.",
        releaseBlocking: true,
      },
    },
    releaseStatus: "validated-not-released",
    encryption,
  };
}

function validateReleasePrerequisites(
  prerequisites: PackageReleasePrerequisites | undefined,
  binding: PackageBinding,
  generatedAt: string,
): void {
  if (prerequisites === undefined || prerequisites === null)
    throw new Error("Package release prerequisites are required");
  if (prerequisites.certificates.length !== 4)
    throw new Error("Exactly four prerequisite stage certificates are required");
  let previous: PackageStageCertificate | undefined;
  for (const [index, stage] of (
    packageStages.slice(0, 4) as readonly PrerequisiteStage[]
  ).entries()) {
    const certificate = prerequisites.certificates[index];
    if (certificate === undefined || certificate.stage !== stage)
      throw new Error(`Stage certificate is missing or out of order: ${stage}`);
    if (
      certificate.schemaVersion !== "1.0.0" ||
      certificate.runId !== binding.runId ||
      certificate.snapshotId !== binding.snapshotId ||
      certificate.packageRequestDigest !== binding.packageRequestDigest ||
      certificate.artifactSetDigest !== binding.artifactSetDigest ||
      certificate.status !== "passed" ||
      certificate.current !== true
    )
      throw new Error(`${stage} certificate is not bound to the current package request`);
    const expectedInput = previous?.outputDigest ?? binding.packageRequestDigest;
    if (
      certificate.inputDigest !== expectedInput ||
      certificate.previousCertificateDigest !== previous?.certificateDigest
    )
      throw new Error(`${stage} certificate chain is invalid`);
    if (
      !/^sha256:[a-f0-9]{64}$/.test(certificate.validationReportDigest) ||
      certificate.evidenceOccurrenceIds.length === 0 ||
      certificate.issuer.validatorId.trim() === "" ||
      !Number.isFinite(Date.parse(certificate.issuedAt)) ||
      Date.parse(certificate.issuedAt) > Date.parse(generatedAt) ||
      (previous !== undefined && Date.parse(certificate.issuedAt) < Date.parse(previous.issuedAt))
    )
      throw new Error(`${stage} certificate validation occurrence is invalid`);
    if (
      stage === "REVIEWS_COMPLETE"
        ? !hasRequiredReviewPanel(certificate.issuer)
        : certificate.issuer.kind !== "trusted-validator"
    )
      throw new Error(`${stage} certificate issuer is invalid`);
    const expected = createStageCertificate({
      binding,
      stage,
      inputDigest: certificate.inputDigest,
      ...(previous === undefined ? {} : { previousCertificateDigest: previous.certificateDigest }),
      validationReportDigest: certificate.validationReportDigest,
      evidenceOccurrenceIds: certificate.evidenceOccurrenceIds,
      issuedAt: certificate.issuedAt,
      issuer: certificate.issuer,
    });
    if (
      certificate.outputDigest !== expected.outputDigest ||
      certificate.certificateDigest !== expected.certificateDigest ||
      certificate.certificateId !== expected.certificateId
    )
      throw new Error(`${stage} certificate digest or derivation is invalid`);
    previous = certificate;
  }
}

function validateCertificateEvidence(
  prerequisites: PackageReleasePrerequisites,
  payload: Map<string, Uint8Array>,
): void {
  const evidence = requiredArray(payload, "data/evidence-index.json");
  const evidenceIds = new Set(
    evidence.map((value) =>
      requiredString(objectValue(value, "evidence item")["evidenceId"], "evidence ID"),
    ),
  );
  for (const certificate of prerequisites.certificates) {
    for (const evidenceId of certificate.evidenceOccurrenceIds) {
      if (!evidenceIds.has(evidenceId))
        throw new Error(
          `${certificate.stage} certificate references missing validation evidence ${evidenceId}`,
        );
    }
  }
}

function validateEligibilityAgainstPayload(
  artifacts: NormalizedArtifact[],
  payload: Map<string, Uint8Array>,
): void {
  const evidence = requiredArray(payload, "data/evidence-index.json");
  const evidenceById = new Map(
    evidence.map((value) => {
      const item = objectValue(value, "evidence item");
      return [requiredString(item["evidenceId"], "evidence ID"), item] as const;
    }),
  );
  const reviews = requiredArray(payload, "data/reviews.json");
  const reviewsById = new Map(
    reviews.map((value) => {
      const item = objectValue(value, "review");
      return [requiredString(item["reviewId"], "review ID"), item] as const;
    }),
  );

  for (const artifact of artifacts) {
    for (const source of artifact.eligibility.sources) {
      const packaged = evidenceById.get(source.occurrence.evidenceId);
      if (packaged === undefined)
        throw new Error(
          `${artifact.path}: eligibility proof references evidence absent from the frozen index`,
        );
      const packagedOccurrence = projectEligibilityOccurrence(packaged);
      if (canonicalDigest(packagedOccurrence) !== canonicalDigest(source.occurrence))
        throw new Error(
          `${artifact.path}: eligibility occurrence does not match the frozen evidence index`,
        );

      const reviewProof = source.technicalHumanReview;
      if (reviewProof !== undefined) {
        const review = reviewsById.get(reviewProof.reviewId);
        if (
          review === undefined ||
          review["kind"] !== reviewProof.kind ||
          review["verdict"] !== reviewProof.verdict ||
          review["inputDigest"] !== reviewProof.inputDigest
        )
          throw new Error(
            `${artifact.path}: eligibility review does not match the frozen review record`,
          );
        const reviewedEvidence = new Set(
          collectNamedStringArrayValues(review, "evidenceOccurrenceIds"),
        );
        for (const evidenceId of reviewProof.evidenceOccurrenceIds) {
          if (!reviewedEvidence.has(evidenceId))
            throw new Error(
              `${artifact.path}: technical-human review does not cover eligibility evidence`,
            );
        }
      }
      const parent = source.o3ParentProof;
      if (parent !== undefined) {
        const packagedParent = evidenceById.get(parent.occurrence.evidenceId);
        if (
          packagedParent === undefined ||
          canonicalDigest(projectEligibilityOccurrence(packagedParent)) !==
            canonicalDigest(parent.occurrence)
        )
          throw new Error(
            `${artifact.path}: O4 parent proof does not match the frozen evidence index`,
          );
        const parentReview = reviewsById.get(parent.technicalHumanReview.reviewId);
        if (
          parentReview === undefined ||
          parentReview["kind"] !== parent.technicalHumanReview.kind ||
          parentReview["verdict"] !== parent.technicalHumanReview.verdict ||
          parentReview["inputDigest"] !== parent.technicalHumanReview.inputDigest
        )
          throw new Error(
            `${artifact.path}: O4 parent review does not match the frozen review record`,
          );
      }
    }
  }
}

function projectEligibilityOccurrence(
  packaged: Record<string, unknown>,
): PackageEligibilityOccurrence {
  return {
    evidenceId: requiredString(packaged["evidenceId"], "evidence ID"),
    runId: requiredString(packaged["runId"], "evidence run ID"),
    snapshotId: requiredString(packaged["snapshotId"], "evidence snapshot ID"),
    activityId: requiredString(packaged["activityId"], "evidence activity ID"),
    evidenceType: requiredString(packaged["evidenceType"], "evidence type"),
    sensitivity: requiredString(
      packaged["sensitivity"],
      "evidence sensitivity",
    ) as PackageEligibilityOccurrence["sensitivity"],
    redactionState: requiredString(
      packaged["redactionState"],
      "evidence redaction state",
    ) as PackageEligibilityOccurrence["redactionState"],
    validationState: requiredString(
      packaged["validationState"],
      "evidence validation state",
    ) as PackageEligibilityOccurrence["validationState"],
    collectionLimitations: stringArray(
      packaged["collectionLimitations"],
      "evidence collection limitations",
    ),
    derivedFromEvidenceIds: stringArray(packaged["derivedFromEvidenceIds"], "derived evidence IDs"),
  };
}

function hasRequiredReviewPanel(issuer: PackageStageCertificate["issuer"]): boolean {
  if (issuer.kind !== "reviewer-panel") return false;
  const kinds = new Set(issuer.reviewerKinds);
  return (
    kinds.size === 4 &&
    kinds.has("independent-security") &&
    kinds.has("independent-decision") &&
    kinds.has("technical-human") &&
    kinds.has("lay-human")
  );
}

export interface DerivedPackageEligibility {
  outputClass: "O0-uncredentialed" | "O3-trusted-derivative" | "O4-human-summary";
  proofDigest: string;
  sourceEvidenceIds: string[];
  provenanceActivityIds: string[];
  deterministicValidatorIds: string[];
  technicalHumanReviewIds: string[];
}

interface NormalizedArtifact extends Omit<PackageArtifact, "content"> {
  bytes: Uint8Array;
  derivedEligibility: DerivedPackageEligibility;
}

function normalizeArtifacts(
  artifacts: PackageArtifact[],
  limits: PackageLimits,
): NormalizedArtifact[] {
  if (artifacts.length > limits.maxEntries - 2) throw new Error("Package entry limit exceeded");
  const normalized: NormalizedArtifact[] = [];
  const exact = new Set<string>();
  const collisionKeys = new Map<string, string>();
  let totalBytes = 0;
  for (const artifact of artifacts) {
    const path = validateArchivePath(artifact.path, limits.maxPathBytes);
    if (GENERATED_PATHS.has(path))
      throw new Error(`${path} is generated by the packaging pipeline`);
    if (exact.has(path)) throw new Error(`Duplicate package path: ${path}`);
    exact.add(path);
    const collisionKey = path.normalize("NFC").toLocaleLowerCase("en-US");
    const previous = collisionKeys.get(collisionKey);
    if (previous !== undefined)
      throw new Error(`Case or Unicode path collision: ${previous} and ${path}`);
    collisionKeys.set(collisionKey, path);
    if (artifact.sensitivity !== "public" && artifact.sensitivity !== "customer-confidential")
      throw new Error(`${path}: secret or restricted artifacts cannot enter customer staging`);
    if (artifact.redactionState !== "none-required" && artifact.redactionState !== "redacted")
      throw new Error(`${path}: redaction is not final`);
    const bytes =
      typeof artifact.content === "string"
        ? Buffer.from(artifact.content, "utf8")
        : Buffer.from(artifact.content);
    if (bytes.byteLength > limits.maxEntryBytes)
      throw new Error(`${path}: entry size limit exceeded`);
    totalBytes += bytes.byteLength;
    if (totalBytes > limits.maxTotalBytes) throw new Error("Package total size limit exceeded");
    const derivedEligibility = derivePackageArtifactEligibility(artifact, bytes, path);
    normalized.push({ ...artifact, path, bytes, derivedEligibility });
  }
  return normalized.sort((left, right) => compareUtf8(left.path, right.path));
}

const OUTPUT_CLASS_LIMITATIONS: Readonly<Record<PackageOutputClass, string>> = Object.freeze({
  "O0-uncredentialed": "rak-output-class:O0-uncredentialed",
  "O1-secret-control": "rak-output-class:O1-secret-control",
  "O2-credential-tainted-raw": "rak-output-class:O2-credential-tainted-raw",
  "O3-trusted-derivative": "rak-output-class:O3-trusted-derivative",
  "O4-human-summary": "rak-output-class:O4-human-summary",
});

export function derivePackageArtifactEligibility(
  artifact: PackageArtifact,
  suppliedBytes?: Uint8Array,
  validatedPath?: string,
): DerivedPackageEligibility {
  const path = validatedPath ?? artifact.path;
  const bytes =
    suppliedBytes ??
    (typeof artifact.content === "string"
      ? Buffer.from(artifact.content, "utf8")
      : Buffer.from(artifact.content));
  const eligibility = artifact.eligibility;
  if (
    eligibility === undefined ||
    eligibility.schemaVersion !== "1.0.0" ||
    !Array.isArray(eligibility.sources) ||
    eligibility.sources.length === 0
  )
    throw new Error(`${path}: frozen evidence/provenance eligibility proof is required`);

  const classes = new Set<PackageOutputClass>();
  const sourceEvidenceIds = new Set<string>();
  const provenanceActivityIds = new Set<string>();
  const deterministicValidatorIds = new Set<string>();
  const technicalHumanReviewIds = new Set<string>();
  for (const source of eligibility.sources) {
    const occurrence = source?.occurrence;
    const activity = source?.activity;
    if (
      occurrence === undefined ||
      activity === undefined ||
      occurrence.evidenceId.trim() === "" ||
      occurrence.runId.trim() === "" ||
      occurrence.snapshotId.trim() === "" ||
      occurrence.activityId.trim() === "" ||
      occurrence.evidenceType.trim() === "" ||
      !Array.isArray(occurrence.collectionLimitations) ||
      !Array.isArray(occurrence.derivedFromEvidenceIds) ||
      !["public", "customer-confidential", "secret-suspected", "restricted"].includes(
        occurrence.sensitivity,
      ) ||
      !["none-required", "pending", "redacted", "excluded"].includes(occurrence.redactionState) ||
      occurrence.validationState !== "validated" ||
      activity.activityId !== occurrence.activityId ||
      activity.runId !== occurrence.runId
    )
      throw new Error(`${path}: missing or invalid frozen evidence/provenance metadata`);
    const outputClass = deriveOutputClass(path, occurrence, activity);
    classes.add(outputClass);
    sourceEvidenceIds.add(occurrence.evidenceId);
    provenanceActivityIds.add(activity.activityId);

    if (outputClass === "O1-secret-control" || outputClass === "O2-credential-tainted-raw")
      throw new Error(`${path}: ${outputClass} is prohibited from customer staging`);
    if (outputClass === "O3-trusted-derivative") {
      validateO3Proof(path, source, bytes);
      deterministicValidatorIds.add(source.deterministicValidation!.validatorId);
      technicalHumanReviewIds.add(source.technicalHumanReview!.reviewId);
    } else if (outputClass === "O4-human-summary") {
      validateTechnicalHumanReview(path, source.technicalHumanReview, occurrence.evidenceId);
      validateO4ParentProof(path, source);
      technicalHumanReviewIds.add(source.technicalHumanReview!.reviewId);
      technicalHumanReviewIds.add(source.o3ParentProof!.technicalHumanReview.reviewId);
      deterministicValidatorIds.add(source.o3ParentProof!.deterministicValidation.validatorId);
      sourceEvidenceIds.add(source.o3ParentProof!.occurrence.evidenceId);
      provenanceActivityIds.add(source.o3ParentProof!.activity.activityId);
    } else if (
      source.deterministicValidation !== undefined ||
      source.technicalHumanReview !== undefined ||
      source.o3ParentProof !== undefined
    ) {
      throw new Error(`${path}: O0 eligibility proof contains inapplicable elevated proof`);
    }
  }
  if (classes.size !== 1)
    throw new Error(`${path}: mixed output classes are not packageable as one artifact`);
  const outputClass = [...classes][0];
  if (
    outputClass !== "O0-uncredentialed" &&
    outputClass !== "O3-trusted-derivative" &&
    outputClass !== "O4-human-summary"
  )
    throw new Error(`${path}: output class is not package eligible`);
  const declaredEvidenceIds = [...artifact.evidenceOccurrenceIds].sort(compareUtf8);
  const derivedEvidenceIds = [...sourceEvidenceIds].sort(compareUtf8);
  if (
    declaredEvidenceIds.length !== derivedEvidenceIds.length ||
    declaredEvidenceIds.some((value, index) => value !== derivedEvidenceIds[index])
  )
    throw new Error(`${path}: artifact evidence links do not match eligibility provenance`);
  return {
    outputClass,
    proofDigest: canonicalDigest(eligibility),
    sourceEvidenceIds: derivedEvidenceIds,
    provenanceActivityIds: [...provenanceActivityIds].sort(compareUtf8),
    deterministicValidatorIds: [...deterministicValidatorIds].sort(compareUtf8),
    technicalHumanReviewIds: [...technicalHumanReviewIds].sort(compareUtf8),
  };
}

function validateO4ParentProof(
  path: string,
  source: PackageArtifactEligibility["sources"][number],
): void {
  const parent = source.o3ParentProof;
  if (
    parent === undefined ||
    !source.occurrence.derivedFromEvidenceIds.includes(parent.occurrence.evidenceId) ||
    deriveOutputClass(path, parent.occurrence, parent.activity) !== "O3-trusted-derivative"
  )
    throw new Error(`${path}: O4 summary is not bound to a validated O3 parent`);
  const serializedResult = canonicalizeJson(parent.fixedResult);
  if (serializedResult === undefined)
    throw new Error(`${path}: O4 parent fixed result is not canonicalizable`);
  const resultBytes = Buffer.from(serializedResult, "utf8");
  const expectedInput = canonicalDigest({
    occurrence: parent.occurrence,
    activity: parent.activity,
  });
  if (
    parent.deterministicValidation.validatorId !== "rak-o3-deterministic-validator/1.0.0" ||
    parent.deterministicValidation.status !== "passed" ||
    parent.deterministicValidation.inputDigest !== expectedInput ||
    parent.deterministicValidation.outputDigest !== sha256(resultBytes)
  )
    throw new Error(`${path}: O4 parent deterministic validation is invalid`);
  validateO3FixedSchema(path, resultBytes);
  validateTechnicalHumanReview(path, parent.technicalHumanReview, parent.occurrence.evidenceId);
}

function deriveOutputClass(
  path: string,
  occurrence: PackageEligibilityOccurrence,
  activity: PackageEligibilityActivity,
): PackageOutputClass {
  const byActivity: Readonly<Record<PackageEligibilityActivity["kind"], PackageOutputClass>> = {
    "uncredentialed-evidence-capture": "O0-uncredentialed",
    "secret-control": "O1-secret-control",
    "credential-tainted-capture": "O2-credential-tainted-raw",
    "trusted-credential-derivation": "O3-trusted-derivative",
    "technical-human-summary": "O4-human-summary",
  };
  const outputClass = byActivity[activity.kind];
  if (outputClass === undefined)
    throw new Error(`${path}: provenance activity kind is not release-owned`);
  const markers = occurrence.collectionLimitations.filter((value) =>
    value.startsWith("rak-output-class:"),
  );
  if (
    markers.length !== 1 ||
    markers[0] !== OUTPUT_CLASS_LIMITATIONS[outputClass] ||
    !occurrence.collectionLimitations.every((value) => typeof value === "string")
  )
    throw new Error(`${path}: evidence limitations conflict with provenance output class`);

  if (outputClass === "O1-secret-control") {
    if (
      occurrence.evidenceType !== "secret-control" ||
      !["secret-suspected", "restricted"].includes(occurrence.sensitivity)
    )
      throw new Error(`${path}: O1 evidence metadata is inconsistent`);
  } else if (outputClass === "O2-credential-tainted-raw") {
    if (
      occurrence.evidenceType !== "credential-tainted-raw" ||
      occurrence.sensitivity !== "restricted"
    )
      throw new Error(`${path}: O2 evidence metadata is inconsistent`);
  } else if (outputClass === "O3-trusted-derivative") {
    if (
      occurrence.evidenceType !== "trusted-credential-derivative" ||
      occurrence.derivedFromEvidenceIds.length === 0 ||
      occurrence.sensitivity === "secret-suspected" ||
      occurrence.sensitivity === "restricted" ||
      (occurrence.redactionState !== "none-required" && occurrence.redactionState !== "redacted")
    )
      throw new Error(`${path}: O3 evidence metadata is inconsistent`);
  } else if (outputClass === "O4-human-summary") {
    if (
      occurrence.evidenceType !== "credential-derived-human-summary" ||
      occurrence.derivedFromEvidenceIds.length === 0 ||
      occurrence.sensitivity === "secret-suspected" ||
      occurrence.sensitivity === "restricted" ||
      (occurrence.redactionState !== "none-required" && occurrence.redactionState !== "redacted")
    )
      throw new Error(`${path}: O4 evidence metadata is inconsistent`);
  } else if (
    occurrence.sensitivity === "secret-suspected" ||
    occurrence.sensitivity === "restricted" ||
    (occurrence.redactionState !== "none-required" && occurrence.redactionState !== "redacted") ||
    [
      "secret-control",
      "credential-tainted-raw",
      "trusted-credential-derivative",
      "credential-derived-human-summary",
    ].includes(occurrence.evidenceType)
  ) {
    throw new Error(`${path}: O0 evidence metadata is inconsistent`);
  }
  return outputClass;
}

function validateO3Proof(
  path: string,
  source: PackageArtifactEligibility["sources"][number],
  bytes: Uint8Array,
): void {
  const validation = source.deterministicValidation;
  const expectedInput = canonicalDigest({
    occurrence: source.occurrence,
    activity: source.activity,
  });
  if (
    validation === undefined ||
    validation.validatorId !== "rak-o3-deterministic-validator/1.0.0" ||
    validation.status !== "passed" ||
    validation.inputDigest !== expectedInput ||
    validation.outputDigest !== sha256(bytes)
  )
    throw new Error(`${path}: O3 deterministic validation proof is missing or invalid`);
  validateO3FixedSchema(path, bytes);
  validateTechnicalHumanReview(path, source.technicalHumanReview, source.occurrence.evidenceId);
}

function validateO3FixedSchema(path: string, bytes: Uint8Array): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error(`${path}: O3 derivative is not valid fixed-schema JSON`);
  }
  const value = objectValue(parsed, "O3 derivative");
  const allowedKeys = new Set([
    "schemaVersion",
    "controlId",
    "result",
    "boundedCount",
    "locatorSha256",
  ]);
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    value["schemaVersion"] !== "1.0.0" ||
    typeof value["controlId"] !== "string" ||
    !/^[A-Z0-9][A-Z0-9._/-]{0,127}$/.test(value["controlId"])
  )
    throw new Error(`${path}: O3 derivative violates the release-owned fixed schema`);
  const facts = ["result", "boundedCount", "locatorSha256"].filter(
    (key) => value[key] !== undefined,
  );
  if (facts.length !== 1)
    throw new Error(`${path}: O3 derivative must contain exactly one bounded fact`);
  if (
    value["result"] !== undefined &&
    !["pass", "fail", "partial", "blocked", "not-applicable", "not-tested", true, false].includes(
      value["result"] as never,
    )
  )
    throw new Error(`${path}: O3 derivative result is outside release-owned vocabulary`);
  if (
    value["boundedCount"] !== undefined &&
    (!Number.isInteger(value["boundedCount"]) ||
      (value["boundedCount"] as number) < 0 ||
      (value["boundedCount"] as number) > 10_000)
  )
    throw new Error(`${path}: O3 derivative count is outside the release-owned bound`);
  if (
    value["locatorSha256"] !== undefined &&
    !/^sha256:[a-f0-9]{64}$/.test(String(value["locatorSha256"]))
  )
    throw new Error(`${path}: O3 derivative locator digest is invalid`);
}

function validateTechnicalHumanReview(
  path: string,
  review: PackageEligibilityReview | undefined,
  evidenceId: string,
): void {
  if (
    review === undefined ||
    review.reviewId.trim() === "" ||
    review.kind !== "technical-human" ||
    (review.verdict !== "passed" && review.verdict !== "passed-with-objections") ||
    !/^sha256:[a-f0-9]{64}$/.test(review.inputDigest) ||
    !Array.isArray(review.evidenceOccurrenceIds) ||
    !review.evidenceOccurrenceIds.includes(evidenceId)
  )
    throw new Error(`${path}: required technical-human review proof is missing or invalid`);
}

export function createManifest(options: {
  runId: string;
  snapshotId: string;
  generatedAt: string;
  artifacts: NormalizedArtifact[];
}): PackageManifest {
  const entries: PackageManifestEntry[] = options.artifacts.map((artifact) => ({
    path: artifact.path,
    role: "payload",
    artifactKind: artifact.artifactKind,
    mediaType: artifact.mediaType,
    byteLength: String(artifact.bytes.byteLength),
    sha256: sha256(artifact.bytes),
    ...(artifact.schemaOrProfile === undefined
      ? {}
      : { schemaOrProfile: artifact.schemaOrProfile }),
    sensitivity: artifact.sensitivity,
    redactionState: artifact.redactionState,
    evidenceOccurrenceIds: [...artifact.evidenceOccurrenceIds].sort(compareUtf8),
    eligibility: artifact.derivedEligibility,
  }));
  entries.push(
    {
      path: "manifest.json",
      role: "manifest-self",
      artifactKind: "package-manifest",
      mediaType: "application/json",
      schemaOrProfile: "rak-export-profile/1.0.0",
      sensitivity: "customer-confidential",
      redactionState: "none-required",
      evidenceOccurrenceIds: [],
    },
    {
      path: "SHA256SUMS",
      role: "checksums-self",
      artifactKind: "checksums",
      mediaType: "text/plain",
      sensitivity: "customer-confidential",
      redactionState: "none-required",
      evidenceOccurrenceIds: [],
    },
  );
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  return {
    schemaVersion: "1.0.0",
    profile: "rak-export-profile/1.0.0",
    runId: options.runId,
    snapshotId: options.snapshotId,
    generatedAt: options.generatedAt,
    entries,
  };
}

function createChecksums(payload: Map<string, Uint8Array>): string {
  return `${[...payload.entries()]
    .filter(([path]) => path !== "SHA256SUMS")
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([path, bytes]) => `${sha256(bytes)}  ${path}`)
    .join("\n")}\n`;
}

export function validatePayloadAgainstManifest(
  payload: Map<string, Uint8Array>,
  manifest: PackageManifest,
): void {
  const manifestPaths = new Set(manifest.entries.map(({ path }) => path));
  if (manifestPaths.size !== manifest.entries.length)
    throw new Error("Manifest contains duplicate paths");
  for (const path of payload.keys()) {
    if (!manifestPaths.has(path)) throw new Error(`Undeclared package file: ${path}`);
  }
  for (const entry of manifest.entries) {
    const content = payload.get(entry.path);
    if (content === undefined)
      throw new Error(`Manifest references missing artifact: ${entry.path}`);
    if (entry.role === "payload") {
      if (entry.sha256 === undefined || entry.byteLength === undefined)
        throw new Error(`Manifest payload metadata is incomplete: ${entry.path}`);
      if (sha256(content) !== entry.sha256 || String(content.byteLength) !== entry.byteLength)
        throw new Error(`Manifest digest or size mismatch: ${entry.path}`);
      validateManifestEligibility(entry.path, entry.eligibility);
    } else if (entry.sha256 !== undefined || entry.byteLength !== undefined) {
      throw new Error(`Self-referential manifest entry contains a digest or size: ${entry.path}`);
    }
  }
  validateChecksumFile(payload);
}

function validateManifestEligibility(
  path: string,
  eligibility: PackageManifestEntry["eligibility"],
): void {
  if (
    eligibility === undefined ||
    !["O0-uncredentialed", "O3-trusted-derivative", "O4-human-summary"].includes(
      eligibility.outputClass,
    ) ||
    !/^sha256:[a-f0-9]{64}$/.test(eligibility.proofDigest) ||
    eligibility.sourceEvidenceIds.length === 0 ||
    eligibility.provenanceActivityIds.length === 0 ||
    new Set(eligibility.sourceEvidenceIds).size !== eligibility.sourceEvidenceIds.length ||
    new Set(eligibility.provenanceActivityIds).size !== eligibility.provenanceActivityIds.length
  )
    throw new Error(`${path}: manifest eligibility proof is missing or invalid`);
  if (
    eligibility.outputClass === "O0-uncredentialed" &&
    (eligibility.deterministicValidatorIds.length > 0 ||
      eligibility.technicalHumanReviewIds.length > 0)
  )
    throw new Error(`${path}: O0 manifest eligibility contains elevated proof`);
  if (
    eligibility.outputClass === "O3-trusted-derivative" &&
    (eligibility.deterministicValidatorIds.length === 0 ||
      eligibility.technicalHumanReviewIds.length === 0)
  )
    throw new Error(`${path}: O3 manifest eligibility proof is incomplete`);
  if (
    eligibility.outputClass === "O4-human-summary" &&
    (eligibility.deterministicValidatorIds.length === 0 ||
      eligibility.technicalHumanReviewIds.length === 0)
  )
    throw new Error(`${path}: O4 manifest eligibility proof is incomplete`);
}

export function verifyDetachedDigest(archiveBytes: Uint8Array, detachedDigest: string): void {
  const match = /^([a-f0-9]{64})(?: {2}[^\r\n]+)?\n?$/.exec(detachedDigest);
  if (match?.[1] === undefined) throw new Error("Detached ZIP digest is malformed");
  if (sha256(archiveBytes) !== match[1]) throw new Error("Detached ZIP digest mismatch");
}

function validateChecksumFile(payload: Map<string, Uint8Array>): void {
  const checksumBytes = payload.get("SHA256SUMS");
  if (checksumBytes === undefined) throw new Error("SHA256SUMS is missing");
  const lines = Buffer.from(checksumBytes).toString("utf8").trimEnd().split("\n");
  const seen = new Set<string>();
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) {2}([^\r\n]+)$/.exec(line);
    if (match === null) throw new Error("SHA256SUMS contains a malformed line");
    const digest = match[1];
    const path = match[2];
    if (digest === undefined || path === undefined || !SHA256_PATTERN.test(digest))
      throw new Error("SHA256SUMS contains an invalid digest");
    if (seen.has(path)) throw new Error(`SHA256SUMS contains duplicate path: ${path}`);
    seen.add(path);
    if (path === "SHA256SUMS") throw new Error("SHA256SUMS must not hash itself");
    const content = payload.get(path);
    if (content === undefined) throw new Error(`SHA256SUMS references missing artifact: ${path}`);
    if (sha256(content) !== digest) throw new Error(`Checksum mismatch: ${path}`);
  }
  const expected = [...payload.keys()].filter((path) => path !== "SHA256SUMS");
  for (const path of expected) {
    if (!seen.has(path)) throw new Error(`SHA256SUMS is missing artifact: ${path}`);
  }
}

function validateRequiredInventory(artifacts: NormalizedArtifact[], requiredPaths: string[]): void {
  const paths = new Set(artifacts.map(({ path }) => path));
  for (const required of requiredPaths) {
    if (!paths.has(required)) throw new Error(`Required customer artifact is missing: ${required}`);
  }
  if (![...paths].some((path) => path.startsWith("evidence/")))
    throw new Error("Required customer evidence inventory is empty");
}

function validateReferences(artifacts: NormalizedArtifact[]): void {
  const paths = new Set(artifacts.map(({ path }) => path));
  for (const artifact of artifacts) {
    for (const reference of artifact.references ?? []) {
      const normalized = validateArchivePath(reference, DEFAULT_LIMITS.maxPathBytes);
      if (!paths.has(normalized))
        throw new Error(`${artifact.path} references missing artifact ${reference}`);
    }
  }
}

function validateContentGates(artifacts: NormalizedArtifact[], gates: PackageContentGates): void {
  for (const artifact of artifacts)
    validateArtifactContent(artifact.path, artifact.bytes, artifact.mediaType, gates);
}

function validatePayloadContent(
  payload: Map<string, Uint8Array>,
  gates: PackageContentGates,
): void {
  for (const [path, bytes] of payload) {
    const mediaType = path.endsWith(".json")
      ? "application/json"
      : path.endsWith(".html") || path.endsWith(".md") || path === "SHA256SUMS"
        ? "text/plain"
        : "application/octet-stream";
    validateArtifactContent(path, bytes, mediaType, gates);
  }
}

function validateArtifactContent(
  path: string,
  bytes: Uint8Array,
  mediaType: string,
  gates: PackageContentGates,
): void {
  const text = Buffer.from(bytes).toString("utf8");
  if (SSH_MATERIAL_PATTERN.test(text))
    throw new Error(`${path}: SSH or private-key material detected`);
  if (SECRET_PATTERN.test(text)) throw new Error(`${path}: credential-like secret detected`);
  for (const secret of gates.knownSecrets ?? []) {
    if (secret.length > 0 && text.includes(secret))
      throw new Error(`${path}: known secret value detected`);
  }
  if (!TEXT_MEDIA_PATTERN.test(mediaType) && !/\.(?:md|html|csv|json|txt|log)$/i.test(path)) return;
  const placeholder = gates.placeholderPattern ?? DEFAULT_PLACEHOLDER_PATTERN;
  placeholder.lastIndex = 0;
  if (placeholder.test(text)) throw new Error(`${path}: unresolved placeholder content`);
  if (HOST_PATH_PATTERN.test(text)) throw new Error(`${path}: absolute host path detected`);
  if (COMPLIANCE_CLAIM_PATTERN.test(text))
    throw new Error(`${path}: unsupported compliance or certification claim`);
  if (/\.html$/i.test(path)) validatePackagedHtml(path, text);
  for (const hostPath of gates.forbiddenHostPaths ?? []) {
    if (hostPath.length > 0 && text.includes(hostPath))
      throw new Error(`${path}: forbidden host path detected`);
  }
}

function validatePackagedHtml(path: string, html: string): void {
  if (
    /<(?:script|iframe|frame|frameset|form|input|button|textarea|select|object|embed|svg|math|video|audio|canvas|base|marquee|link)\b/i.test(
      html,
    )
  )
    throw new Error(`${path}: forbidden active HTML element`);
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html))
    throw new Error(`${path}: meta refresh is prohibited`);
  if (/\s(?:on[a-z]+|style|srcdoc)\s*=/i.test(html))
    throw new Error(`${path}: forbidden active HTML attribute`);
  if (/\sdownload(?:\s|=|>)/i.test(html) || /<a\b[^>]*href\s*=\s*["']data:/i.test(html))
    throw new Error(`${path}: active download payload is prohibited`);
  validateCanonicalLockedHtml(path, html);
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
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)];
  if (styles.length !== 1 || styles[0]?.[1] !== LOCKED_REPORT_RENDERER_CSS)
    throw new Error(`${path}: renderer CSS does not match the release lock`);
  const encodedHash = `style-src 'sha256-${LOCKED_REPORT_RENDERER_CSS_SHA256}'`;
  if (!html.includes("default-src 'none'") || !html.includes(encodedHash))
    throw new Error(`${path}: CSP or CSS hash mismatch`);
  for (const required of [
    'class="skip-link"',
    "<header>",
    '<main id="main-content">',
    "<footer>",
    "How to read this report",
    "Package identity digest:",
  ]) {
    if (!html.includes(required)) throw new Error(`${path}: required report shell is incomplete`);
  }
}

/**
 * Independently parses and serializes the small, release-owned HTML grammar. A package is
 * rejected unless every byte is already in this canonical form, so an unknown element or
 * attribute can never be silently discarded at the trust boundary.
 */
function validateCanonicalLockedHtml(path: string, html: string): void {
  const doctype = "<!doctype html>";
  if (!html.startsWith(doctype))
    throw new Error(`${path}: HTML is not in the locked canonical serialization`);
  const document = html.slice(doctype.length).trim();
  let cursor = 0;
  let canonical = "";
  const stack: string[] = [];

  while (cursor < document.length) {
    if (document[cursor] !== "<") {
      const next = document.indexOf("<", cursor);
      const end = next === -1 ? document.length : next;
      canonical += document.slice(cursor, end);
      cursor = end;
      continue;
    }

    const closing = /^<\/([a-z][a-z0-9]*)>/.exec(document.slice(cursor));
    if (closing) {
      const tag = closing[1]!;
      if (!(tag in LOCKED_HTML_ATTRIBUTES) || tag === "meta" || stack.pop() !== tag)
        throw new Error(`${path}: malformed or unknown HTML element`);
      canonical += closing[0];
      cursor += closing[0].length;
      continue;
    }

    const openingEnd = findCanonicalTagEnd(document, cursor);
    if (openingEnd === -1) throw new Error(`${path}: malformed or unknown HTML element`);
    const source = document.slice(cursor, openingEnd + 1);
    const opening = /^<([a-z][a-z0-9]*)([\s\S]*?)( \/)?>$/.exec(source);
    if (!opening) throw new Error(`${path}: malformed or unknown HTML element`);
    const tag = opening[1]!;
    const allowedAttributes = LOCKED_HTML_ATTRIBUTES[tag];
    if (!allowedAttributes) throw new Error(`${path}: unknown HTML element <${tag}>`);
    const selfClosing = opening[3] !== undefined;
    if ((tag === "meta") !== selfClosing)
      throw new Error(`${path}: HTML is not in the locked canonical serialization`);

    const attributesSource = opening[2] ?? "";
    const attributes: Array<[string, string]> = [];
    let attributeCursor = 0;
    while (attributeCursor < attributesSource.length) {
      const attribute = /^ ([a-z][a-z0-9-]*)="([^"]*)"/.exec(
        attributesSource.slice(attributeCursor),
      );
      if (!attribute) throw new Error(`${path}: malformed or noncanonical HTML attribute`);
      const name = attribute[1]!;
      if (!allowedAttributes.includes(name))
        throw new Error(`${path}: unknown HTML attribute ${name} on <${tag}>`);
      if (attributes.some(([existing]) => existing === name))
        throw new Error(`${path}: duplicate HTML attribute ${name}`);
      attributes.push([name, attribute[2] ?? ""]);
      attributeCursor += attribute[0].length;
    }

    const serializedAttributes = attributes.map(([name, value]) => ` ${name}="${value}"`).join("");
    canonical += `<${tag}${serializedAttributes}${selfClosing ? " />" : ">"}`;
    cursor = openingEnd + 1;
    if (!selfClosing) stack.push(tag);
  }

  if (stack.length > 0 || canonical !== document || !canonical.startsWith("<html "))
    throw new Error(`${path}: HTML is not in the locked canonical serialization`);
}

function findCanonicalTagEnd(document: string, start: number): number {
  let quoted = false;
  for (let index = start + 1; index < document.length; index += 1) {
    const character = document[index];
    if (character === '"') quoted = !quoted;
    else if (character === ">" && !quoted) return index;
    else if (character === "<" && !quoted) return -1;
  }
  return -1;
}

function validateHtmlResources(payload: Map<string, Uint8Array>): void {
  for (const [path, bytes] of payload) {
    if (!path.endsWith(".html")) continue;
    const html = Buffer.from(bytes).toString("utf8");
    for (const match of html.matchAll(/\s(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
      const target = match[1] ?? "";
      if (target.startsWith("#") || target.startsWith("data:")) continue;
      const withoutFragment = target.split(/[?#]/, 1)[0] ?? "";
      const resolved = posix.normalize(posix.join(posix.dirname(path), withoutFragment));
      if (!payload.has(resolved))
        throw new Error(`${path}: undeclared local HTML resource ${target}`);
    }
  }
}

function validateSemanticReferences(payload: Map<string, Uint8Array>): void {
  const paths = new Set(payload.keys());
  const evidenceIndex = parseOptionalJsonArray(payload, "data/evidence-index.json");
  const evidenceIds = new Set<string>();
  const evidencePaths = new Map<string, string>();
  for (const item of evidenceIndex) {
    const evidenceId = propertyString(item, "evidenceId");
    if (evidenceId !== undefined) {
      if (evidenceIds.has(evidenceId))
        throw new Error(`Duplicate evidence ID in package: ${evidenceId}`);
      evidenceIds.add(evidenceId);
    }
    const packageRelPath = propertyString(item, "packageRelPath");
    if (packageRelPath !== undefined) {
      if (!paths.has(packageRelPath))
        throw new Error(
          `Evidence ${evidenceId ?? "record"} references missing artifact ${packageRelPath}`,
        );
      if (evidenceId !== undefined) evidencePaths.set(evidenceId, packageRelPath);
    }
  }
  const screenshots = parseOptionalJsonArray(payload, "data/screenshots.json");
  for (const item of screenshots) {
    if (propertyString(item, "status") !== "captured") continue;
    const packageRelPath = propertyString(item, "packageRelPath");
    const evidenceId = propertyString(item, "evidenceOccurrenceId");
    if (packageRelPath === undefined || !paths.has(packageRelPath))
      throw new Error(
        `Captured screenshot ${propertyString(item, "screenshotId") ?? "record"} references missing artifact ${packageRelPath ?? "(none)"}`,
      );
    if (evidenceId === undefined || evidencePaths.get(evidenceId) !== packageRelPath)
      throw new Error("Captured screenshot path does not match its evidence");
  }
  for (const path of ["data/findings.json", "data/controls.json", "data/decision.json"]) {
    const bytes = payload.get(path);
    if (bytes === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      throw new Error(`${path}: invalid JSON`);
    }
    for (const evidenceId of collectNamedStringArrayValues(value, "evidenceOccurrenceIds")) {
      if (!evidenceIds.has(evidenceId))
        throw new Error(`${path} references missing evidence ${evidenceId}`);
    }
  }
}

function validateOfflineDocuments(payload: Map<string, Uint8Array>): void {
  const run = runDocumentSchema.safeParse(parseRequiredJson(payload, "data/run.json"));
  if (!run.success) throw new Error("data/run.json failed its offline contract");

  const claims = requiredArray(payload, "data/product-claims.json");
  if (claims.some((claim) => !productClaimSchema.safeParse(claim).success))
    throw new Error("data/product-claims.json failed its offline contract");
  const claimTopics = new Set(
    claims.map((claim) =>
      requiredString(objectValue(claim, "product claim")["topic"], "claim topic"),
    ),
  );
  for (const topic of discoveryTopics) {
    if (!claimTopics.has(topic)) throw new Error(`Product discovery topic is missing: ${topic}`);
  }

  const target = targetSnapshotSchema.safeParse(
    parseRequiredJson(payload, "data/target-snapshot.json"),
  );
  if (!target.success) throw new Error("data/target-snapshot.json failed its offline contract");

  const evidence = requiredArray(payload, "data/evidence-index.json");
  const evidenceIds = new Set<string>();
  for (const value of evidence) {
    const item = objectValue(value, "evidence item");
    if (item["schemaVersion"] !== "1.0.0") throw new Error("Evidence schema version is invalid");
    const id = requiredString(item["evidenceId"], "evidence ID");
    if (evidenceIds.has(id)) throw new Error(`Duplicate evidence ID: ${id}`);
    evidenceIds.add(id);
    if (item["redactionState"] !== "none-required" && item["redactionState"] !== "redacted")
      throw new Error(`Evidence ${id} has non-final redaction`);
  }

  const findings = requiredArray(payload, "data/findings.json");
  const findingIds = new Set<string>();
  for (const value of findings) {
    const item = objectValue(value, "finding");
    if (item["schemaVersion"] !== "1.0.0") throw new Error("Finding schema version is invalid");
    const id = requiredString(item["findingId"], "finding ID");
    if (findingIds.has(id)) throw new Error(`Duplicate finding ID: ${id}`);
    findingIds.add(id);
    validateEvidenceIdArray(item["evidenceOccurrenceIds"], evidenceIds, `Finding ${id}`);
  }

  const controls = requiredArray(payload, "data/controls.json");
  if (controls.length === 0) throw new Error("Control inventory must not be empty");
  if (
    !controls.some((value) => {
      const item = objectValue(value, "control");
      return (
        typeof item["profileId"] === "string" &&
        /general.*(?:security|baseline)|(?:security|baseline).*general/i.test(item["profileId"])
      );
    })
  )
    throw new Error("General security baseline is missing");
  for (const value of controls) {
    const item = objectValue(value, "control");
    if (item["schemaVersion"] !== "1.0.0") throw new Error("Control schema version is invalid");
    const status = requiredString(item["status"], "control status");
    if (status !== "pass" && (typeof item["reason"] !== "string" || item["reason"].trim() === ""))
      throw new Error("Non-pass control requires a reason");
    validateEvidenceIdArray(item["evidenceOccurrenceIds"], evidenceIds, "Control");
  }

  const coverage = requiredArray(payload, "data/coverage.json");
  const domains = new Set(
    coverage.map((value) =>
      requiredString(objectValue(value, "coverage")["domainId"], "coverage domain"),
    ),
  );
  if (domains.size !== assessmentDomains.length || coverage.length !== assessmentDomains.length)
    throw new Error("Coverage must include every required assessment domain exactly once");
  for (const domain of assessmentDomains) {
    if (!domains.has(domain)) throw new Error(`Coverage domain is missing: ${domain}`);
  }
  for (const value of coverage) {
    const item = objectValue(value, "coverage");
    if (item["schemaVersion"] !== "1.0.0") throw new Error("Coverage schema version is invalid");
    const planned = item["plannedControls"];
    const reconciled = item["reconciledControls"];
    const counts = objectValue(item["counts"], "coverage counts");
    const total = ["pass", "fail", "partial", "blocked", "not applicable", "not tested"].reduce(
      (sum, status) => {
        const count = counts[status];
        if (typeof count !== "number" || !Number.isInteger(count) || count < 0)
          throw new Error("Coverage counts must be nonnegative integers");
        return sum + count;
      },
      0,
    );
    if (
      typeof planned !== "number" ||
      typeof reconciled !== "number" ||
      planned !== reconciled ||
      reconciled !== total
    )
      throw new Error("Coverage controls do not reconcile");
  }

  const decision = objectValue(parseRequiredJson(payload, "data/decision.json"), "decision");
  if (decision["schemaVersion"] !== "1.0.0" || decision["runId"] !== run.data.runId)
    throw new Error("Decision document identity is invalid");
  const criteria = arrayValue(decision["criteria"], "decision criteria");
  const criterionNames = new Set(
    criteria.map((value) =>
      requiredString(objectValue(value, "decision criterion")["criterion"], "criterion"),
    ),
  );
  if (criteria.length !== 7 || criterionNames.size !== 7)
    throw new Error("Decision must contain seven unique criteria");
  for (const criterion of REQUIRED_CRITERIA) {
    if (!criterionNames.has(criterion))
      throw new Error(`Decision criterion is missing: ${criterion}`);
  }
  for (const evidenceId of collectNamedStringArrayValues(decision, "evidenceOccurrenceIds")) {
    if (!evidenceIds.has(evidenceId))
      throw new Error(`Decision references missing evidence ${evidenceId}`);
  }

  const reviews = requiredArray(payload, "data/reviews.json");
  const passedReviews = new Set(
    reviews.flatMap((value) => {
      const item = objectValue(value, "review");
      if (
        item["schemaVersion"] !== "1.0.0" ||
        item["runId"] !== run.data.runId ||
        typeof item["reviewerAgentId"] !== "string" ||
        typeof item["inputDigest"] !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(item["inputDigest"]) ||
        !Array.isArray(item["itemResults"]) ||
        !Array.isArray(item["acceptedCorrectionIds"]) ||
        !Array.isArray(item["limitationIds"]) ||
        !evidenceIds.has(requiredString(item["reviewEvidenceId"], "review evidence")) ||
        typeof item["completedAt"] !== "string" ||
        !Number.isFinite(Date.parse(item["completedAt"]))
      )
        throw new Error("Review failed its offline contract");
      for (const resultValue of item["itemResults"]) {
        const result = objectValue(resultValue, "review item");
        validateEvidenceIdArray(result["evidenceOccurrenceIds"], evidenceIds, "Review item");
      }
      return item["verdict"] === "passed" || item["verdict"] === "passed-with-objections"
        ? [requiredString(item["kind"], "review kind")]
        : [];
    }),
  );
  for (const kind of [
    "independent-security",
    "independent-decision",
    "technical-human",
    "lay-human",
  ]) {
    if (!passedReviews.has(kind)) throw new Error(`Required passed review is missing: ${kind}`);
  }

  const equivalence = objectValue(
    parseRequiredJson(payload, "data/equivalence-certificate.json"),
    "equivalence certificate",
  );
  if (equivalence["schemaVersion"] !== "1.0.0" || equivalence["runId"] !== run.data.runId)
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
  ]) {
    if (equivalence[property] !== true)
      throw new Error(`Equivalence certificate gate failed: ${property}`);
  }
  if (equivalence["prohibitedActionsObserved"] !== false)
    throw new Error("Equivalence certificate recorded a prohibited action");
  requiredString(equivalence["validationReportId"], "equivalence validation report ID");

  const screenshots = requiredArray(payload, "data/screenshots.json");
  if (screenshots.length === 0) throw new Error("Screenshot inventory must not be empty");
  for (const value of screenshots) {
    const item = objectValue(value, "screenshot");
    if (
      item["status"] === "unavailable" &&
      (typeof item["unavailableReason"] !== "string" || item["unavailableReason"].trim() === "")
    )
      throw new Error("Unavailable screenshot requires a reason");
    if (
      item["status"] === "captured" &&
      !evidenceIds.has(requiredString(item["evidenceOccurrenceId"], "screenshot evidence"))
    )
      throw new Error("Captured screenshot references missing evidence");
  }

  validatePackagedSarif(
    parseRequiredJson(payload, "exports/findings.sarif.json"),
    findingIds,
    evidenceIds,
  );
  validatePackagedCycloneDx(parseRequiredJson(payload, "exports/sbom.cdx.json"));
}

function validatePackagedSarif(
  value: unknown,
  nativeFindingIds: Set<string>,
  evidenceIds: Set<string>,
): void {
  const root = objectValue(value, "SARIF");
  if (
    root["version"] !== "2.1.0" ||
    root["$schema"] !==
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json"
  )
    throw new Error("SARIF version or pinned schema is invalid");
  const runs = arrayValue(root["runs"], "SARIF runs");
  if (runs.length !== 1) throw new Error("SARIF must contain one run");
  const run = objectValue(runs[0], "SARIF run");
  const results = arrayValue(run["results"], "SARIF results");
  const seen = new Set<string>();
  for (const value of results) {
    const result = objectValue(value, "SARIF result");
    const id = requiredString(result["ruleId"], "SARIF rule ID");
    if (!nativeFindingIds.has(id) || seen.has(id))
      throw new Error(`SARIF result has invalid or duplicate finding ID: ${id}`);
    seen.add(id);
    const properties = objectValue(result["properties"], "SARIF properties");
    validateEvidenceIdArray(
      properties["dev.repo-assessment-kit.evidenceIds"],
      evidenceIds,
      `SARIF result ${id}`,
    );
    for (const locationValue of arrayValue(result["locations"], "SARIF locations")) {
      const location = objectValue(locationValue, "SARIF location");
      const physical = objectValue(location["physicalLocation"], "SARIF physical location");
      const artifact = objectValue(physical["artifactLocation"], "SARIF artifact location");
      const uri = requiredString(artifact["uri"], "SARIF artifact URI");
      if (/^(?:[a-z]+:|\/|\\)/i.test(uri) || uri.includes(".."))
        throw new Error(`SARIF location is unsafe: ${uri}`);
    }
  }
  if (seen.size !== nativeFindingIds.size)
    throw new Error("SARIF results do not reconcile with native findings");
}

function validatePackagedCycloneDx(value: unknown): void {
  const root = objectValue(value, "CycloneDX");
  if (
    root["bomFormat"] !== "CycloneDX" ||
    root["specVersion"] !== "1.7" ||
    root["$schema"] !== "https://cyclonedx.org/schema/bom-1.7.schema.json"
  )
    throw new Error("CycloneDX version or pinned schema is invalid");
  const components = arrayValue(root["components"], "CycloneDX components");
  if (components.length === 0) throw new Error("CycloneDX components must not be empty");
  const refs = new Set<string>();
  for (const value of components) {
    const ref = requiredString(objectValue(value, "CycloneDX component")["bom-ref"], "bom-ref");
    if (refs.has(ref)) throw new Error(`Duplicate CycloneDX bom-ref: ${ref}`);
    refs.add(ref);
  }
  for (const value of arrayValue(root["dependencies"], "CycloneDX dependencies")) {
    const dependency = objectValue(value, "CycloneDX dependency");
    const ref = requiredString(dependency["ref"], "CycloneDX dependency ref");
    if (!refs.has(ref)) throw new Error(`CycloneDX dependency ref is missing: ${ref}`);
    for (const target of stringArray(dependency["dependsOn"], "CycloneDX dependsOn")) {
      if (!refs.has(target)) throw new Error(`CycloneDX dependency target is missing: ${target}`);
    }
  }
}

function parseRequiredJson(payload: Map<string, Uint8Array>, path: string): unknown {
  const bytes = payload.get(path);
  if (bytes === undefined) throw new Error(`Required JSON artifact is missing: ${path}`);
  const text = Buffer.from(bytes).toString("utf8");
  try {
    assertNoDuplicateJsonKeys(text, path);
    return JSON.parse(text);
  } catch {
    throw new Error(`${path}: invalid JSON`);
  }
}

function assertNoDuplicateJsonKeys(text: string, path: string): void {
  let cursor = 0;
  const whitespace = () => {
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  };
  const stringToken = (): string => {
    const start = cursor;
    cursor += 1;
    while (cursor < text.length) {
      const character = text[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      cursor += 1;
      if (character === '"') return JSON.parse(text.slice(start, cursor)) as string;
    }
    throw new Error(`${path}: unterminated JSON string`);
  };
  const value = (): void => {
    whitespace();
    const character = text[cursor];
    if (character === "{") {
      cursor += 1;
      whitespace();
      const keys = new Set<string>();
      if (text[cursor] === "}") {
        cursor += 1;
        return;
      }
      while (cursor < text.length) {
        if (text[cursor] !== '"') throw new Error(`${path}: invalid JSON object key`);
        const key = stringToken();
        if (keys.has(key)) throw new Error(`${path}: duplicate JSON key ${key}`);
        keys.add(key);
        whitespace();
        if (text[cursor] !== ":") throw new Error(`${path}: invalid JSON object separator`);
        cursor += 1;
        value();
        whitespace();
        if (text[cursor] === "}") {
          cursor += 1;
          return;
        }
        if (text[cursor] !== ",") throw new Error(`${path}: invalid JSON object`);
        cursor += 1;
        whitespace();
      }
      throw new Error(`${path}: unterminated JSON object`);
    }
    if (character === "[") {
      cursor += 1;
      whitespace();
      if (text[cursor] === "]") {
        cursor += 1;
        return;
      }
      while (cursor < text.length) {
        value();
        whitespace();
        if (text[cursor] === "]") {
          cursor += 1;
          return;
        }
        if (text[cursor] !== ",") throw new Error(`${path}: invalid JSON array`);
        cursor += 1;
      }
      throw new Error(`${path}: unterminated JSON array`);
    }
    if (character === '"') {
      stringToken();
      return;
    }
    const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(
      text.slice(cursor),
    );
    if (match?.[0] === undefined) throw new Error(`${path}: invalid JSON value`);
    cursor += match[0].length;
  };
  value();
  whitespace();
  if (cursor !== text.length) throw new Error(`${path}: trailing JSON data`);
}

function requiredArray(payload: Map<string, Uint8Array>, path: string): unknown[] {
  return arrayValue(parseRequiredJson(payload, path), path);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a nonempty string`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return arrayValue(value, label).map((item) => requiredString(item, label));
}

function validateEvidenceIdArray(value: unknown, evidenceIds: Set<string>, label: string): void {
  for (const id of stringArray(value, `${label} evidence IDs`)) {
    if (!evidenceIds.has(id)) throw new Error(`${label} references missing evidence ${id}`);
  }
}

function parseOptionalJsonArray(payload: Map<string, Uint8Array>, path: string): unknown[] {
  const bytes = payload.get(path);
  if (bytes === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error(`${path}: invalid JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${path}: expected a JSON array`);
  return parsed;
}

function propertyString(value: unknown, property: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const result = (value as Record<string, unknown>)[property];
  return typeof result === "string" ? result : undefined;
}

function collectNamedStringArrayValues(value: unknown, property: string): string[] {
  const output: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) output.push(...collectNamedStringArrayValues(item, property));
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === property && Array.isArray(item)) {
        for (const candidate of item) {
          if (typeof candidate !== "string")
            throw new Error(`${property} must contain only strings`);
          output.push(candidate);
        }
      } else {
        output.push(...collectNamedStringArrayValues(item, property));
      }
    }
  }
  return output;
}

export function createDeterministicZip(
  payload: Map<string, Uint8Array>,
  limits: PackageLimits = DEFAULT_LIMITS,
): Uint8Array {
  if (payload.size > limits.maxEntries) throw new Error("ZIP entry limit exceeded");
  const entries = [...payload.entries()].sort(([left], [right]) => compareUtf8(left, right));
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  let total = 0;
  for (const [path, bytesLike] of entries) {
    validateArchivePath(path, limits.maxPathBytes);
    const name = Buffer.from(path, "utf8");
    const bytes = Buffer.from(bytesLike);
    if (bytes.byteLength > limits.maxEntryBytes)
      throw new Error(`${path}: ZIP entry size limit exceeded`);
    total += bytes.byteLength;
    if (total > limits.maxTotalBytes) throw new Error("ZIP total size limit exceeded");
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.byteLength, 18);
    local.writeUInt32LE(bytes.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.byteLength, 20);
    central.writeUInt32LE(bytes.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100444 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.byteLength + name.byteLength + bytes.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function reopenZip(
  zipBytesLike: Uint8Array,
  limits: PackageLimits = DEFAULT_LIMITS,
): ZipEntry[] {
  const zip = Buffer.from(zipBytesLike);
  if (zip.byteLength < 22) throw new Error("ZIP is truncated");
  const endOffset = zip.byteLength - 22;
  if (zip.readUInt32LE(endOffset) !== 0x06054b50) throw new Error("ZIP end record is missing");
  if (zip.readUInt16LE(endOffset + 4) !== 0 || zip.readUInt16LE(endOffset + 6) !== 0)
    throw new Error("Multi-disk ZIP files are prohibited");
  const count = zip.readUInt16LE(endOffset + 10);
  if (count !== zip.readUInt16LE(endOffset + 8) || count > limits.maxEntries)
    throw new Error("ZIP entry count is invalid");
  const centralSize = zip.readUInt32LE(endOffset + 12);
  const centralOffset = zip.readUInt32LE(endOffset + 16);
  if (centralOffset + centralSize !== endOffset)
    throw new Error("ZIP central directory bounds are invalid");
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  const collisions = new Map<string, string>();
  let cursor = centralOffset;
  let total = 0;
  let expectedLocalOffset = 0;
  let previousPath: string | undefined;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > endOffset || zip.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("ZIP central directory entry is invalid");
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const expectedCrc = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const disk = zip.readUInt16LE(cursor + 34);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const path = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if ((flags & 0x0800) === 0 || (flags & 0x0001) !== 0 || method !== 0 || disk !== 0)
      throw new Error(`${path}: unsupported or encrypted ZIP entry`);
    validateArchivePath(path, limits.maxPathBytes);
    if (previousPath !== undefined && compareUtf8(previousPath, path) >= 0)
      throw new Error("ZIP entries are not in deterministic path order");
    previousPath = path;
    if (seen.has(path)) throw new Error(`Duplicate ZIP entry: ${path}`);
    seen.add(path);
    const collisionKey = path.normalize("NFC").toLocaleLowerCase("en-US");
    const previous = collisions.get(collisionKey);
    if (previous !== undefined)
      throw new Error(`Case or Unicode ZIP collision: ${previous} and ${path}`);
    collisions.set(collisionKey, path);
    if (size !== compressedSize || size > limits.maxEntryBytes)
      throw new Error(`${path}: ZIP size is invalid`);
    total += size;
    if (total > limits.maxTotalBytes) throw new Error("ZIP decompression size limit exceeded");
    if (localOffset + 30 > centralOffset || zip.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error(`${path}: ZIP local header is invalid`);
    if (localOffset !== expectedLocalOffset)
      throw new Error(`${path}: ZIP local entries overlap or contain undeclared data`);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const localName = zip
      .subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .toString("utf8");
    if (localName !== path) throw new Error(`${path}: ZIP local and central names differ`);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > centralOffset) throw new Error(`${path}: ZIP data bounds are invalid`);
    const content = zip.subarray(dataStart, dataEnd);
    if (crc32(content) !== expectedCrc) throw new Error(`${path}: ZIP CRC mismatch`);
    entries.push({ path, content: Buffer.from(content), crc32: expectedCrc });
    expectedLocalOffset = dataEnd;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (expectedLocalOffset !== centralOffset) throw new Error("ZIP contains undeclared local data");
  if (cursor !== endOffset) throw new Error("ZIP central directory contains trailing data");
  return entries;
}

export function validateReopenedZip(
  zipBytes: Uint8Array,
  expectedManifest: PackageManifest,
  limits: PackageLimits = DEFAULT_LIMITS,
  gates: PackageContentGates = {},
): void {
  const reopened = reopenZip(zipBytes, limits);
  const payload = new Map(reopened.map(({ path, content }) => [path, content]));
  const manifestBytes = payload.get("manifest.json");
  if (manifestBytes === undefined) throw new Error("Reopened ZIP has no manifest");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  } catch {
    throw new Error("Reopened ZIP manifest is invalid JSON");
  }
  const actualCanonical = canonicalizeJson(parsed);
  const expectedCanonical = canonicalizeJson(expectedManifest);
  if (actualCanonical === undefined || actualCanonical !== expectedCanonical)
    throw new Error("Reopened ZIP manifest differs from the validated manifest");
  validatePayloadAgainstManifest(payload, expectedManifest);
  validateOfflineDocuments(payload);
  validateSemanticReferences(payload);
  validateHtmlResources(payload);
  validatePayloadContent(payload, gates);
}

export function validateStandaloneZip(
  zipBytes: Uint8Array,
  limits: PackageLimits = DEFAULT_LIMITS,
): Omit<FreshProcessZipValidation, "processId"> {
  const reopened = reopenZip(zipBytes, limits);
  const payload = new Map(reopened.map(({ path, content }) => [path, content]));
  const manifestBytes = payload.get("manifest.json");
  if (manifestBytes === undefined) throw new Error("Reopened ZIP has no manifest");
  let manifest: PackageManifest;
  try {
    const parsed = JSON.parse(Buffer.from(manifestBytes).toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("manifest root is not an object");
    manifest = parsed as PackageManifest;
  } catch {
    throw new Error("Reopened ZIP manifest is invalid JSON");
  }
  validatePayloadAgainstManifest(payload, manifest);
  validateOfflineDocuments(payload);
  validateSemanticReferences(payload);
  validateHtmlResources(payload);
  validatePayloadContent(payload, {});
  const zipSha256 = sha256(zipBytes);
  const manifestDigest = sha256(manifestBytes);
  return {
    status: "passed",
    zipSha256,
    manifestDigest,
    validationDigest: canonicalDigest({
      validator: "rak-fresh-process-zip-validator/1.0.0",
      zipSha256,
      manifestDigest,
      entryCount: reopened.length,
    }),
  };
}

export async function validatePersistedZipInFreshProcess(
  zipPath: string,
): Promise<FreshProcessZipValidation> {
  const packageRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const cliPath = join(packageRoot, "dist", "zip-validator-cli.js");
  let stdout: string;
  try {
    const result = await execFileAsync(process.execPath, [cliPath, zipPath], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
      env: { PATH: process.env["PATH"] ?? "" },
    });
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown child-process failure";
    throw new Error(`Fresh-process ZIP validation failed: ${message}`);
  }
  let result: unknown;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error("Fresh-process ZIP validator returned invalid output");
  }
  if (
    result === null ||
    typeof result !== "object" ||
    (result as Record<string, unknown>)["status"] !== "passed" ||
    typeof (result as Record<string, unknown>)["processId"] !== "number"
  )
    throw new Error("Fresh-process ZIP validator did not return a passing certificate");
  return result as FreshProcessZipValidation;
}

export async function collectStagingArtifacts(
  root: string,
  metadata: Record<string, Omit<PackageArtifact, "path" | "content"> & { references?: string[] }>,
): Promise<PackageArtifact[]> {
  const canonicalRoot = await realpath(root);
  const rootInfo = await stat(canonicalRoot);
  if (!rootInfo.isDirectory()) throw new Error("Staging root must be a directory");
  const paths = await walk(canonicalRoot);
  const artifacts: PackageArtifact[] = [];
  for (const absolutePath of paths) {
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`${absolutePath}: unsafe staging file type`);
    if (info.nlink !== 1)
      throw new Error(`${absolutePath}: hardlinked staging files are prohibited`);
    const relPath = relative(canonicalRoot, absolutePath).split(sep).join("/");
    const details = metadata[relPath];
    if (details === undefined) throw new Error(`${relPath}: staging metadata is missing`);
    const handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1)
        throw new Error(`${absolutePath}: staging file changed before read`);
      const content = await handle.readFile();
      const after = await handle.stat();
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        content.byteLength !== after.size
      )
        throw new Error(`${absolutePath}: staging file changed during read`);
      artifacts.push({ path: relPath, content, ...details });
    } finally {
      await handle.close();
    }
  }
  return artifacts;
}

async function walk(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`${path}: staging symlinks are prohibited`);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else if (entry.isFile()) output.push(path);
    else throw new Error(`${path}: special staging files are prohibited`);
  }
  return output.sort(compareUtf8);
}

export function validateArchivePath(path: string, maxBytes = DEFAULT_LIMITS.maxPathBytes): string {
  if (path.length === 0 || path !== path.normalize("NFC"))
    throw new Error(`Unsafe archive path: ${path}`);
  if (Buffer.byteLength(path, "utf8") > maxBytes)
    throw new Error(`Archive path is too long: ${path}`);
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    path.includes("\u0000") ||
    path.endsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error(`Unsafe archive path: ${path}`);
  return path;
}

async function validateOutputDirectory(
  directory: string,
  projectSlug: string,
  commitSha: string,
  generatedAt: string,
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectSlug)) throw new Error("Project slug is invalid");
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(commitSha))
    throw new Error("Commit must be a full SHA-1 or SHA-256 object ID");
  const parsed = new Date(generatedAt);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Package timestamp is invalid");
  const timestamp = parsed.toISOString().replace(/[-:]/g, "").replace(".000", "");
  const expectedName = `${projectSlug}-${commitSha}-${timestamp}`;
  const canonical = await realpath(directory);
  const info = await stat(canonical);
  if (!info.isDirectory()) throw new Error("Package output must be an existing directory");
  if (basename(canonical) !== expectedName || basename(resolve(canonical, "..")) !== "generated")
    throw new Error(`Package output must be generated/${expectedName}`);
  return canonical;
}

function validatePackageBaseName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(name) || name === "." || name === "..")
    throw new Error("Package base name is unsafe");
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, path);
    await unlink(temporaryPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalDigest(value: unknown): string {
  const serialized = canonicalizeJson(value);
  if (serialized === undefined) throw new Error("Value could not be canonicalized");
  return `sha256:${sha256(Buffer.from(serialized, "utf8"))}`;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

import { createHash, createPublicKey } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { parseStrictJsonBytes } from "./host-helper-protocol.mjs";

export const PRODUCTION_INSTALLATION_CONFIG_PATH = "/etc/repo-assessment-kit/host-helper.json";

export const HUMAN_REVIEW_KINDS = Object.freeze([
  "independent-security",
  "independent-decision",
  "technical-human",
  "lay-human",
  "customer-acceptance",
]);

export const RELEASE_CERTIFICATE_KINDS = Object.freeze([
  "releaseAssets",
  "toolchain",
  "images",
  "sbom",
  "provenance",
  "vulnerability",
  "officialSchemas",
  "providerCanaries",
  "providerEquivalence",
  "linux-arm64",
  "linux-x86-64",
  "macos-arm64",
  "macos-x86-64",
  "ssh",
  "cleanup:codex",
  "cleanup:claude-code",
]);

export const RELEASE_CERTIFICATE_SUBJECT_KINDS = Object.freeze(
  RELEASE_CERTIFICATE_KINDS.filter((kind) => kind !== "ssh" && !kind.startsWith("cleanup:")),
);

export const HOST_HELPER_OPERATION_KINDS = Object.freeze([
  "source.acquire",
  "source.status",
  "source.cancel",
  "source.finalize",
  "source.release",
  "analyzer.start",
  "analyzer.status",
  "analyzer.pause",
  "analyzer.cancel",
  "analyzer.finalize",
  "vm.preflight",
  "vm.create",
  "vm.stageSnapshot",
  "vm.compile",
  "vm.acquireBuildInputs",
  "vm.build",
  "vm.start",
  "vm.probe",
  "vm.collect",
  "vm.status",
  "vm.heartbeat",
  "vm.pause",
  "vm.resume",
  "vm.stop",
  "vm.destroy",
  "provider.preflight",
  "provider.stage",
  "provider.execute",
  "provider.cancel",
  "provider.cleanup",
  "provider.status",
  "secret.store",
  "secret.consume",
  "secret.revoke",
  "request-guard.admit",
  "request-guard.issue",
  "request-guard.revoke",
  "vm.emergencyStop",
  "reconcile.list",
]);

const REQUIRED_CERTIFICATE_KINDS = RELEASE_CERTIFICATE_KINDS.filter((kind) => kind !== "ssh");
const CONFIG_KEYS = Object.freeze([
  "schemaVersion",
  "installationId",
  "clientUid",
  "clientGid",
  "peerCredentialVerifier",
  "operations",
  "runtime",
  "acquisitionProfiles",
  "sshHandles",
  "secretRecipients",
  "requestGuardAuthorities",
  "requestGuardIssuer",
  "providerReviewProfiles",
  "humanReviewKeys",
  "releaseAuthorizationKey",
  "releaseCertificateKeys",
  "releaseCertificateSubjects",
  "unresolvedBoundaryDefects",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SHORT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IMMUTABLE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,300}@sha256:[a-f0-9]{64}$/u;
const ABSOLUTE_PATH = /^\/(?:[^/\0]+\/)*[^/\0]+$/u;
const PEM_OR_PRIVATE = /-----BEGIN |(?:^|[-_.:/])private(?:[-_.:/]|$)|privateKey|secretKey/iu;
const FIXTURE_VALUE = /(?:^|[-_.:/])fixture(?:[-_.:/]|$)/iu;

export class ProductionInstallationConfigError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ProductionInstallationConfigError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new ProductionInstallationConfigError(code, message, options);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, keys, label) {
  if (!record(value)) fail("INSTALLATION_CONFIG_INVALID", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("INSTALLATION_CONFIG_INVALID", `${label} has missing or unknown fields`);
  }
}

function assertId(value, label, pattern = ID) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("INSTALLATION_CONFIG_INVALID", `${label} is invalid`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail("INSTALLATION_CONFIG_INVALID", `${label} is not a SHA-256 digest`);
  }
}

function assertPath(value, label) {
  if (typeof value !== "string" || !ABSOLUTE_PATH.test(value)) {
    fail("INSTALLATION_CONFIG_INVALID", `${label} is not an absolute fixed path`);
  }
}

function rejectForbiddenConfigStrings(value, path = "configuration") {
  if (typeof value === "string") {
    if (PEM_OR_PRIVATE.test(value)) {
      fail(
        "INSTALLATION_CONFIG_PRIVATE_MATERIAL",
        `${path} contains embedded PEM or private-key material`,
      );
    }
    if (FIXTURE_VALUE.test(value)) {
      fail("INSTALLATION_CONFIG_FIXTURE_VALUE", `${path} contains a fixture-only value`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbiddenConfigStrings(entry, `${path}[${index}]`));
    return;
  }
  if (record(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (PEM_OR_PRIVATE.test(key)) {
        fail(
          "INSTALLATION_CONFIG_PRIVATE_MATERIAL",
          `${path}.${key} is a prohibited private-material field`,
        );
      }
      rejectForbiddenConfigStrings(entry, `${path}.${key}`);
    }
  }
}

function validateFixedBinary(value, label) {
  exact(value, ["binary", "ownerUid", "mode", "sha256"], label);
  assertPath(value.binary, `${label}.binary`);
  if (value.ownerUid !== 0 || value.mode !== "0755") {
    fail("INSTALLATION_CONFIG_INVALID", `${label} owner or mode is invalid`);
  }
  assertDigest(value.sha256, `${label}.sha256`);
}

function validateAuthorityKey(value, label, withKind = false) {
  exact(
    value,
    withKind
      ? ["kind", "signingKeyId", "publicKeyPath", "publicKeySha256"]
      : ["signingKeyId", "publicKeyPath", "publicKeySha256"],
    label,
  );
  assertId(value.signingKeyId, `${label}.signingKeyId`);
  assertPath(value.publicKeyPath, `${label}.publicKeyPath`);
  assertDigest(value.publicKeySha256, `${label}.publicKeySha256`);
}

function validateDistinct(entries, selector, label) {
  const seen = new Set();
  for (const entry of entries) {
    const value = selector(entry);
    if (seen.has(value)) {
      fail("INSTALLATION_CONFIG_DUPLICATE", `${label} duplicates ${value}`);
    }
    seen.add(value);
  }
  return seen;
}

function validateOperations(operations) {
  exact(operations, HOST_HELPER_OPERATION_KINDS, "operations");
  for (const operation of HOST_HELPER_OPERATION_KINDS) {
    const value = operations[operation];
    exact(
      value,
      [
        "driverProfile",
        "binary",
        "ownerUid",
        "mode",
        "sha256",
        "timeoutMs",
        "creationNonce",
        "profileId",
      ],
      `operations.${operation}`,
    );
    if (value.driverProfile !== "rak-fixed-runtime-broker/1.0.0") {
      fail("INSTALLATION_CONFIG_INVALID", `operations.${operation}.driverProfile is invalid`);
    }
    assertPath(value.binary, `operations.${operation}.binary`);
    assertDigest(value.sha256, `operations.${operation}.sha256`);
    assertId(value.creationNonce, `operations.${operation}.creationNonce`, SHORT_ID);
    assertId(value.profileId, `operations.${operation}.profileId`, SHORT_ID);
    if (
      value.ownerUid !== 0 ||
      value.mode !== "0755" ||
      !Number.isSafeInteger(value.timeoutMs) ||
      value.timeoutMs < 1 ||
      value.timeoutMs > 120_000
    ) {
      fail("INSTALLATION_CONFIG_INVALID", `operations.${operation} execution authority is invalid`);
    }
  }
}

function validateRuntime(runtime) {
  exact(runtime, ["lima"], "runtime");
  exact(
    runtime.lima,
    [
      "profile",
      "binary",
      "ownerUid",
      "mode",
      "sha256",
      "instance",
      "instanceDirectory",
      "creationNonce",
      "nativeArchitecture",
      "guestImageDigest",
      "broker",
    ],
    "runtime.lima",
  );
  if (runtime.lima.profile !== "rak-lima-plain-native/1.0.0") {
    fail("INSTALLATION_CONFIG_INVALID", "runtime.lima.profile is invalid");
  }
  for (const name of ["binary", "instanceDirectory"]) {
    assertPath(runtime.lima[name], `runtime.lima.${name}`);
  }
  if (runtime.lima.ownerUid !== 0 || runtime.lima.mode !== "0755") {
    fail("INSTALLATION_CONFIG_INVALID", "runtime.lima owner or mode is invalid");
  }
  assertDigest(runtime.lima.sha256, "runtime.lima.sha256");
  assertId(runtime.lima.instance, "runtime.lima.instance", SHORT_ID);
  assertId(runtime.lima.creationNonce, "runtime.lima.creationNonce", SHORT_ID);
  if (!["amd64", "arm64"].includes(runtime.lima.nativeArchitecture)) {
    fail("INSTALLATION_CONFIG_INVALID", "runtime.lima.nativeArchitecture is invalid");
  }
  assertDigest(runtime.lima.guestImageDigest, "runtime.lima.guestImageDigest");
  validateFixedBinary(runtime.lima.broker, "runtime.lima.broker");
}

function validateSshAuthorities(config) {
  if (!record(config.acquisitionProfiles) || Object.keys(config.acquisitionProfiles).length < 1) {
    fail("INSTALLATION_CONFIG_INVALID", "acquisitionProfiles must not be empty");
  }
  if (!record(config.sshHandles) || Object.keys(config.sshHandles).length < 1) {
    fail("INSTALLATION_CONFIG_INVALID", "sshHandles must not be empty");
  }
  for (const [profileId, profile] of Object.entries(config.acquisitionProfiles)) {
    assertId(profileId, "acquisition profile ID", SHORT_ID);
    exact(profile, ["sshHandleId"], `acquisitionProfiles.${profileId}`);
    assertId(profile.sshHandleId, `${profileId}.sshHandleId`, SHORT_ID);
    if (config.sshHandles[profile.sshHandleId] === undefined) {
      fail("INSTALLATION_CONFIG_INVALID", `${profileId} references an unknown SSH handle`);
    }
  }
  for (const [handleId, handle] of Object.entries(config.sshHandles)) {
    assertId(handleId, "SSH handle ID", SHORT_ID);
    const credentialField =
      handle.credentialKind === "key-file" ? "credentialPath" : "agentSocketPath";
    if (!["key-file", "agent-socket"].includes(handle.credentialKind)) {
      fail("INSTALLATION_CONFIG_INVALID", `${handleId}.credentialKind is invalid`);
    }
    exact(
      handle,
      [
        "credentialKind",
        credentialField,
        "knownHostsPath",
        "host",
        "port",
        "hostKeyFingerprint",
        "url",
        "ref",
        "expiresAt",
        "maxUses",
        "scope",
      ],
      `sshHandles.${handleId}`,
    );
    assertPath(handle[credentialField], `${handleId}.${credentialField}`);
    assertPath(handle.knownHostsPath, `${handleId}.knownHostsPath`);
    if (
      typeof handle.host !== "string" ||
      handle.host.length > 253 ||
      !Number.isSafeInteger(handle.port) ||
      handle.port < 1 ||
      handle.port > 65_535 ||
      typeof handle.hostKeyFingerprint !== "string" ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/u.test(handle.hostKeyFingerprint) ||
      typeof handle.url !== "string" ||
      handle.url.length < 1 ||
      handle.url.length > 2048 ||
      (handle.ref !== null && (typeof handle.ref !== "string" || handle.ref.length > 1024)) ||
      !Number.isFinite(Date.parse(handle.expiresAt)) ||
      !Number.isSafeInteger(handle.maxUses) ||
      handle.maxUses < 1 ||
      handle.scope !== "repository-read-only"
    ) {
      fail("INSTALLATION_CONFIG_INVALID", `${handleId} SSH authority is invalid`);
    }
  }
}

function validateProviderAuthorities(value) {
  exact(value, ["codex", "claude-code"], "providerReviewProfiles");
  for (const provider of ["codex", "claude-code"]) {
    const profile = value[provider];
    exact(
      profile,
      [
        "releaseAuthorityDigest",
        "immutableImageReference",
        "providerHomeAuthorityDigest",
        "networkPolicyDigest",
        "outputSchemaDigest",
      ],
      `providerReviewProfiles.${provider}`,
    );
    if (!IMMUTABLE_IMAGE.test(profile.immutableImageReference)) {
      fail(
        "INSTALLATION_CONFIG_INVALID",
        `providerReviewProfiles.${provider}.immutableImageReference is invalid`,
      );
    }
    for (const name of [
      "releaseAuthorityDigest",
      "providerHomeAuthorityDigest",
      "networkPolicyDigest",
      "outputSchemaDigest",
    ]) {
      assertDigest(profile[name], `providerReviewProfiles.${provider}.${name}`);
    }
  }
}

function validateSecretAndGuardAuthorities(config) {
  if (!record(config.secretRecipients) || Object.keys(config.secretRecipients).length < 1) {
    fail("INSTALLATION_CONFIG_INVALID", "secretRecipients must not be empty");
  }
  for (const [recipientId, recipient] of Object.entries(config.secretRecipients)) {
    assertId(recipientId, "secret recipient ID", SHORT_ID);
    exact(
      recipient,
      ["purpose", "publicKeyPath", "publicKeySha256"],
      `secretRecipients.${recipientId}`,
    );
    if (!["target-service", "probe"].includes(recipient.purpose)) {
      fail("INSTALLATION_CONFIG_INVALID", `${recipientId}.purpose is invalid`);
    }
    assertPath(recipient.publicKeyPath, `${recipientId}.publicKeyPath`);
    assertDigest(recipient.publicKeySha256, `${recipientId}.publicKeySha256`);
  }
  if (
    !record(config.requestGuardAuthorities) ||
    Object.keys(config.requestGuardAuthorities).length < 1
  ) {
    fail("INSTALLATION_CONFIG_INVALID", "requestGuardAuthorities must not be empty");
  }
  for (const [keyId, authority] of Object.entries(config.requestGuardAuthorities)) {
    assertId(keyId, "request-guard key ID", SHORT_ID);
    exact(
      authority,
      ["algorithm", "production", "publicKeyPath", "publicKeySha256"],
      `requestGuardAuthorities.${keyId}`,
    );
    if (authority.algorithm !== "Ed25519" || authority.production !== true) {
      fail("INSTALLATION_CONFIG_INVALID", `${keyId} request-guard authority is invalid`);
    }
    assertPath(authority.publicKeyPath, `${keyId}.publicKeyPath`);
    assertDigest(authority.publicKeySha256, `${keyId}.publicKeySha256`);
  }
  exact(
    config.requestGuardIssuer,
    [
      "profile",
      "signingKeyId",
      "publicKeyPath",
      "publicKeySha256",
      "signer",
      "maxLifetimeSeconds",
      "catalogPath",
      "catalogSha256",
    ],
    "requestGuardIssuer",
  );
  if (
    config.requestGuardIssuer.profile !== "rak-dynamic-control-plan-issuer/1.0.0" ||
    !Number.isSafeInteger(config.requestGuardIssuer.maxLifetimeSeconds) ||
    config.requestGuardIssuer.maxLifetimeSeconds < 1 ||
    config.requestGuardIssuer.maxLifetimeSeconds > 1800
  ) {
    fail("INSTALLATION_CONFIG_INVALID", "requestGuardIssuer profile or lifetime is invalid");
  }
  assertId(config.requestGuardIssuer.signingKeyId, "requestGuardIssuer.signingKeyId", SHORT_ID);
  assertPath(config.requestGuardIssuer.publicKeyPath, "requestGuardIssuer.publicKeyPath");
  assertDigest(config.requestGuardIssuer.publicKeySha256, "requestGuardIssuer.publicKeySha256");
  validateFixedBinary(config.requestGuardIssuer.signer, "requestGuardIssuer.signer");
  assertPath(config.requestGuardIssuer.catalogPath, "requestGuardIssuer.catalogPath");
  assertDigest(config.requestGuardIssuer.catalogSha256, "requestGuardIssuer.catalogSha256");
}

function validateReleaseAuthorities(config) {
  if (
    !Array.isArray(config.humanReviewKeys) ||
    config.humanReviewKeys.length !== HUMAN_REVIEW_KINDS.length
  ) {
    fail("INSTALLATION_CONFIG_INVALID", "humanReviewKeys must contain exactly five entries");
  }
  config.humanReviewKeys.forEach((entry, index) => {
    validateAuthorityKey(entry, `humanReviewKeys[${index}]`, true);
    if (!HUMAN_REVIEW_KINDS.includes(entry.kind)) {
      fail("INSTALLATION_CONFIG_INVALID", `humanReviewKeys[${index}].kind is invalid`);
    }
  });
  const reviewKinds = validateDistinct(
    config.humanReviewKeys,
    ({ kind }) => kind,
    "human-review kind",
  );
  if (HUMAN_REVIEW_KINDS.some((kind) => !reviewKinds.has(kind))) {
    fail("INSTALLATION_CONFIG_INVALID", "humanReviewKeys is incomplete");
  }
  const allKeyIds = validateDistinct(
    config.humanReviewKeys,
    ({ signingKeyId }) => signingKeyId,
    "signing key ID",
  );
  const allDigests = validateDistinct(
    config.humanReviewKeys,
    ({ publicKeySha256 }) => publicKeySha256,
    "public-key digest",
  );

  validateAuthorityKey(config.releaseAuthorizationKey, "releaseAuthorizationKey");
  if (
    allKeyIds.has(config.releaseAuthorizationKey.signingKeyId) ||
    allDigests.has(config.releaseAuthorizationKey.publicKeySha256)
  ) {
    fail(
      "INSTALLATION_CONFIG_DUPLICATE",
      "releaseAuthorizationKey is not distinct from all human-review keys",
    );
  }
  allKeyIds.add(config.releaseAuthorizationKey.signingKeyId);
  allDigests.add(config.releaseAuthorizationKey.publicKeySha256);

  if (
    !Array.isArray(config.releaseCertificateKeys) ||
    ![REQUIRED_CERTIFICATE_KINDS.length, RELEASE_CERTIFICATE_KINDS.length].includes(
      config.releaseCertificateKeys.length,
    )
  ) {
    fail(
      "INSTALLATION_CONFIG_INVALID",
      "releaseCertificateKeys has an invalid applicable-kind count",
    );
  }
  config.releaseCertificateKeys.forEach((entry, index) => {
    validateAuthorityKey(entry, `releaseCertificateKeys[${index}]`, true);
    if (!RELEASE_CERTIFICATE_KINDS.includes(entry.kind)) {
      fail("INSTALLATION_CONFIG_INVALID", `releaseCertificateKeys[${index}].kind is invalid`);
    }
    if (allKeyIds.has(entry.signingKeyId) || allDigests.has(entry.publicKeySha256)) {
      fail(
        "INSTALLATION_CONFIG_DUPLICATE",
        `releaseCertificateKeys[${index}] reuses a key ID or digest`,
      );
    }
    allKeyIds.add(entry.signingKeyId);
    allDigests.add(entry.publicKeySha256);
  });
  const certificateKinds = validateDistinct(
    config.releaseCertificateKeys,
    ({ kind }) => kind,
    "release-certificate kind",
  );
  if (REQUIRED_CERTIFICATE_KINDS.some((kind) => !certificateKinds.has(kind))) {
    fail("INSTALLATION_CONFIG_INVALID", "releaseCertificateKeys omits a required kind");
  }

  exact(
    config.releaseCertificateSubjects,
    RELEASE_CERTIFICATE_SUBJECT_KINDS,
    "releaseCertificateSubjects",
  );
  for (const kind of RELEASE_CERTIFICATE_SUBJECT_KINDS) {
    assertDigest(config.releaseCertificateSubjects[kind], `releaseCertificateSubjects.${kind}`);
  }

  if (!Array.isArray(config.unresolvedBoundaryDefects)) {
    fail("INSTALLATION_CONFIG_INVALID", "unresolvedBoundaryDefects must be an array");
  }
  const defectIds = new Set();
  for (const [index, defect] of config.unresolvedBoundaryDefects.entries()) {
    exact(defect, ["defectId", "severity", "state"], `unresolvedBoundaryDefects[${index}]`);
    assertId(defect.defectId, `unresolvedBoundaryDefects[${index}].defectId`);
    if (defectIds.has(defect.defectId)) {
      fail("INSTALLATION_CONFIG_DUPLICATE", `duplicate defect ID ${defect.defectId}`);
    }
    defectIds.add(defect.defectId);
    if (!["Critical", "High", "Medium", "Low"].includes(defect.severity)) {
      fail("INSTALLATION_CONFIG_INVALID", `defect ${defect.defectId} severity is invalid`);
    }
    if (!["unresolved", "resolved"].includes(defect.state)) {
      fail("INSTALLATION_CONFIG_INVALID", `defect ${defect.defectId} state is invalid`);
    }
  }
}

export function validateProductionInstallationConfig(value) {
  exact(value, CONFIG_KEYS, "installation configuration");
  rejectForbiddenConfigStrings(value);
  if (value.schemaVersion !== "rak-host-helper-config/1.0.0") {
    fail("INSTALLATION_CONFIG_INVALID", "schemaVersion is unsupported");
  }
  assertId(value.installationId, "installationId", SHORT_ID);
  if (
    !Number.isSafeInteger(value.clientUid) ||
    value.clientUid < 1 ||
    !Number.isSafeInteger(value.clientGid) ||
    value.clientGid < 1
  ) {
    fail("INSTALLATION_CONFIG_INVALID", "client UID or GID is invalid");
  }
  exact(
    value.peerCredentialVerifier,
    ["path", "ownerUid", "mode", "platform", "sha256"],
    "peerCredentialVerifier",
  );
  if (
    value.peerCredentialVerifier.path !== "/usr/local/libexec/rak-peer-cred" ||
    value.peerCredentialVerifier.ownerUid !== 0 ||
    value.peerCredentialVerifier.mode !== "0755" ||
    !["linux", "darwin"].includes(value.peerCredentialVerifier.platform)
  ) {
    fail("INSTALLATION_CONFIG_INVALID", "peerCredentialVerifier is invalid");
  }
  assertDigest(value.peerCredentialVerifier.sha256, "peerCredentialVerifier.sha256");
  validateOperations(value.operations);
  validateRuntime(value.runtime);
  validateSshAuthorities(value);
  validateProviderAuthorities(value.providerReviewProfiles);
  validateSecretAndGuardAuthorities(value);
  const issuerOperation = value.operations["request-guard.issue"];
  if (
    issuerOperation.driverProfile !== "rak-fixed-runtime-broker/1.0.0" ||
    issuerOperation.binary !== value.requestGuardIssuer.signer.binary ||
    issuerOperation.ownerUid !== value.requestGuardIssuer.signer.ownerUid ||
    issuerOperation.mode !== value.requestGuardIssuer.signer.mode ||
    issuerOperation.sha256 !== value.requestGuardIssuer.signer.sha256
  ) {
    fail(
      "INSTALLATION_CONFIG_INVALID",
      "request-guard issue operation does not bind the configured fixed signer",
    );
  }
  validateReleaseAuthorities(value);
  return structuredClone(value);
}

function metadataStable(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs
  );
}

function validateFileMetadata(metadata, requirements, label) {
  if (
    !record(metadata) ||
    metadata.isFile !== true ||
    metadata.uid !== requirements.uid ||
    (requirements.gid !== undefined && metadata.gid !== requirements.gid) ||
    (metadata.mode & 0o777) !== requirements.mode ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0
  ) {
    fail("INSTALLATION_AUTHORITY_UNSAFE", `${label} owner, group, mode, or type is unsafe`);
  }
}

async function loadCheckedFile(reader, path, requirements, label) {
  let loaded;
  try {
    loaded = await reader(path);
  } catch (cause) {
    fail("INSTALLATION_AUTHORITY_UNAVAILABLE", `${label} is unavailable`, { cause });
  }
  if (
    !record(loaded) ||
    !(loaded.bytes instanceof Uint8Array) ||
    !record(loaded.before) ||
    !record(loaded.after)
  ) {
    fail("INSTALLATION_AUTHORITY_UNSAFE", `${label} reader result is invalid`);
  }
  validateFileMetadata(loaded.before, requirements, label);
  if (
    loaded.bytes.byteLength !== loaded.before.size ||
    !metadataStable(loaded.before, loaded.after)
  ) {
    fail("INSTALLATION_AUTHORITY_CHANGED", `${label} changed during its held-descriptor read`);
  }
  return { bytes: Buffer.from(loaded.bytes), before: loaded.before };
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseEd25519(bytes, label) {
  try {
    const key = createPublicKey(bytes);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
    return key;
  } catch (cause) {
    fail("INSTALLATION_PUBLIC_KEY_INVALID", `${label} is not an Ed25519 public key`, {
      cause,
    });
  }
}

async function hydratePublicKey(entry, reader, clientGid, label, { ed25519 = true } = {}) {
  const loaded = await loadCheckedFile(
    reader,
    entry.publicKeyPath,
    { uid: 0, gid: clientGid, mode: 0o440 },
    label,
  );
  const { bytes } = loaded;
  if (sha256(bytes) !== entry.publicKeySha256) {
    fail("INSTALLATION_AUTHORITY_DIGEST_MISMATCH", `${label} digest is not pinned`);
  }
  if (ed25519) parseEd25519(bytes, label);
  return bytes;
}

async function loadWithReader(reader) {
  const loadedConfig = await loadCheckedFile(
    reader,
    PRODUCTION_INSTALLATION_CONFIG_PATH,
    { uid: 0, gid: undefined, mode: 0o440 },
    "production installation configuration",
  );
  let parsed;
  try {
    parsed = parseStrictJsonBytes(loadedConfig.bytes, "production installation configuration");
  } catch (cause) {
    fail("INSTALLATION_CONFIG_JSON_INVALID", "installation configuration is not strict JSON", {
      cause,
    });
  }
  const config = validateProductionInstallationConfig(parsed);
  if (loadedConfig.before.gid !== config.clientGid) {
    fail(
      "INSTALLATION_AUTHORITY_UNSAFE",
      "installation configuration group does not match clientGid",
    );
  }

  const reviewKeys = {};
  for (const entry of config.humanReviewKeys) {
    reviewKeys[entry.signingKeyId] = {
      kind: entry.kind,
      publicKey: await hydratePublicKey(
        entry,
        reader,
        config.clientGid,
        `${entry.kind} human-review public key`,
      ),
    };
  }
  const authorizationKey = await hydratePublicKey(
    config.releaseAuthorizationKey,
    reader,
    config.clientGid,
    "release-authorization public key",
  );
  const certificateKeys = {};
  for (const entry of config.releaseCertificateKeys) {
    certificateKeys[entry.signingKeyId] = {
      kind: entry.kind,
      publicKey: await hydratePublicKey(
        entry,
        reader,
        config.clientGid,
        `${entry.kind} release-certificate public key`,
      ),
    };
  }
  const requestGuardAuthorities = {};
  for (const [keyId, entry] of Object.entries(config.requestGuardAuthorities)) {
    requestGuardAuthorities[keyId] = {
      algorithm: "Ed25519",
      production: true,
      publicKeyPem: await hydratePublicKey(
        entry,
        reader,
        config.clientGid,
        `${keyId} request-guard public key`,
      ),
    };
  }
  const requestGuardIssuerPublicKey = await hydratePublicKey(
    config.requestGuardIssuer,
    reader,
    config.clientGid,
    "request-guard issuer public key",
  );
  const requestGuardCatalog = await loadCheckedFile(
    reader,
    config.requestGuardIssuer.catalogPath,
    { uid: 0, gid: config.clientGid, mode: 0o440 },
    "request-guard issuer catalog",
  );
  if (sha256(requestGuardCatalog.bytes) !== config.requestGuardIssuer.catalogSha256) {
    fail(
      "INSTALLATION_AUTHORITY_DIGEST_MISMATCH",
      "request-guard issuer catalog digest is not pinned",
    );
  }
  const secretRecipients = {};
  for (const [recipientId, entry] of Object.entries(config.secretRecipients)) {
    secretRecipients[recipientId] = {
      purpose: entry.purpose,
      publicKey: await hydratePublicKey(
        entry,
        reader,
        config.clientGid,
        `${recipientId} secret-recipient public key`,
        { ed25519: false },
      ),
    };
  }
  return Object.freeze({
    config: Object.freeze({
      ...config,
      requestGuardAuthorities,
      requestGuardIssuer: {
        ...config.requestGuardIssuer,
        publicKeyPem: requestGuardIssuerPublicKey,
        catalogBytes: requestGuardCatalog.bytes,
      },
      secretRecipients,
    }),
    releaseAuthorities: Object.freeze({
      mode: "production",
      reviewKeys,
      authorizationKeys: {
        [config.releaseAuthorizationKey.signingKeyId]: authorizationKey,
      },
      certificateKeys,
      certificateSubjects: structuredClone(config.releaseCertificateSubjects),
      unresolvedBoundaryDefects: structuredClone(config.unresolvedBoundaryDefects),
    }),
  });
}

async function productionReader(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const beforeStat = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const afterStat = await handle.stat({ bigint: true });
    const metadata = (stat) => ({
      isFile: stat.isFile(),
      uid: Number(stat.uid),
      gid: Number(stat.gid),
      mode: Number(stat.mode & 0o777n),
      size: Number(stat.size),
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      mtimeNs: stat.mtimeNs.toString(),
    });
    return { bytes, before: metadata(beforeStat), after: metadata(afterStat) };
  } finally {
    await handle.close();
  }
}

export async function loadProductionInstallationConfig() {
  return loadWithReader(productionReader);
}

export async function loadFixtureTestInstallationConfig(options) {
  if (
    !record(options) ||
    options.mode !== "fixture-test-only" ||
    typeof options.readFile !== "function" ||
    Object.keys(options).some((key) => !["mode", "readFile"].includes(key))
  ) {
    fail(
      "FIXTURE_TEST_SEAM_REQUIRED",
      'fixture loading requires exactly mode:"fixture-test-only" and readFile',
    );
  }
  return loadWithReader(options.readFile);
}

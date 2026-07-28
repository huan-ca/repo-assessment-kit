#!/usr/local/libexec/repo-assessment-kit/node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const productionConfigUrl = import.meta.url.startsWith(
  "file:///usr/local/libexec/repo-assessment-kit/",
)
  ? new URL("./scripts/production-installation-config.mjs", import.meta.url)
  : new URL("../../../scripts/production-installation-config.mjs", import.meta.url);
const { loadProductionInstallationConfig } = await import(productionConfigUrl);

const EXPECTED_UID = 62345;
const EXPECTED_GID = 62345;
const EXPECTED_NODE_VERSION = "v24.4.1";
const VERIFIED_RELEASE = "/var/lib/repo-assessment-kit/release/verified-host-helper.txt";
const RECORD_KEYS = Object.freeze([
  "profile",
  "verified",
  "sourceCommit",
  "manifestSha256",
  "signingKeyId",
  "platform",
  "architecture",
  "nodeVersion",
  "installerSha256",
  "nodeSha256",
  "peerVerifierSha256",
  "productionHostHelperSha256",
  "hostHelperServiceSha256",
  "hostHelperJournalSha256",
  "hostHelperOperationsSha256",
  "hostHelperProtocolSha256",
  "productionInstallationConfigSha256",
  "providerTaskSha256",
  "installationValidatorSha256",
  "serviceEntrypointSha256",
  "linuxServiceDefinitionSha256",
  "macosServiceDefinitionSha256",
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function fail(message) {
  process.stderr.write(`host-helper installation invalid: ${message}\n`);
  process.exitCode = 78;
}

async function requirePath(path, predicate, mode, uid, gid) {
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    !predicate(info) ||
    (info.mode & 0o777) !== mode ||
    info.uid !== uid ||
    info.gid !== gid
  ) {
    throw new Error(`${path} has unsafe type, owner, group, or mode`);
  }
}

function expectedArchitecture(architecture = process.arch) {
  if (["arm64", "aarch64"].includes(architecture)) return "arm64";
  if (["x64", "x86_64", "amd64"].includes(architecture)) return "x86-64";
  throw new Error("unsupported architecture");
}

export function validateVerifiedReleaseMetadata(metadata) {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    metadata.isFile !== true ||
    metadata.isSymbolicLink === true ||
    metadata.uid !== 0 ||
    metadata.gid !== 0 ||
    metadata.mode !== 0o400 ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 1 ||
    metadata.size > 64 * 1024
  ) {
    throw new Error("preverified host-helper authority has unsafe metadata");
  }
}

export function parseVerifiedHostHelperRecord(
  bytes,
  { platform = process.platform, architecture = process.arch } = {},
) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("preverified host-helper authority is not strict UTF-8");
  }
  if (!text.endsWith("\n") || text.includes("\r") || text.includes("\0")) {
    throw new Error("preverified host-helper authority is not canonical line data");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length !== RECORD_KEYS.length) {
    throw new Error("preverified host-helper authority has missing or extra fields");
  }
  const values = {};
  for (const line of lines) {
    if (!/^[A-Za-z][A-Za-z0-9]*=[^=\s][^=\s]*$/u.test(line)) {
      throw new Error("preverified host-helper authority contains a malformed line");
    }
    const separator = line.indexOf("=");
    const key = line.slice(0, separator);
    if (!RECORD_KEYS.includes(key) || Object.hasOwn(values, key)) {
      throw new Error("preverified host-helper authority contains an unknown or duplicate field");
    }
    values[key] = line.slice(separator + 1);
  }
  if (RECORD_KEYS.some((key) => !Object.hasOwn(values, key))) {
    throw new Error("preverified host-helper authority has a missing field");
  }
  if (
    values.profile !== "rak-verified-host-helper-release/1.0.0" ||
    values.verified !== "true" ||
    values.nodeVersion !== EXPECTED_NODE_VERSION
  ) {
    throw new Error("preverified host-helper authority profile is invalid");
  }
  if (!/^[a-f0-9]{40,64}$/u.test(values.sourceCommit)) {
    throw new Error("preverified host-helper source commit is invalid");
  }
  if (!DIGEST.test(values.signingKeyId)) {
    throw new Error("preverified host-helper signing key ID is invalid");
  }
  if (values.platform !== platform || values.architecture !== expectedArchitecture(architecture)) {
    throw new Error("preverified host-helper platform binding is invalid");
  }
  for (const key of RECORD_KEYS.filter((key) => key.endsWith("Sha256"))) {
    if (!DIGEST.test(values[key])) {
      throw new Error(`preverified host-helper ${key} is invalid`);
    }
  }
  return Object.freeze(values);
}

export function verifyRecordedArtifact(record, key, bytes) {
  if (!RECORD_KEYS.includes(key) || !key.endsWith("Sha256") || key === "manifestSha256") {
    throw new Error("preverified host-helper artifact key is invalid");
  }
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (record[key] !== digest) {
    throw new Error(`installed ${key} does not match preverified authority`);
  }
}

async function loadVerifiedHostHelperRecord() {
  const handle = await open(VERIFIED_RELEASE, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    const metadata = {
      isFile: before.isFile(),
      isSymbolicLink: false,
      uid: Number(before.uid),
      gid: Number(before.gid),
      mode: Number(before.mode & 0o777n),
      size: Number(before.size),
    };
    validateVerifiedReleaseMetadata(metadata);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      throw new Error("preverified host-helper authority changed during read");
    }
    return parseVerifiedHostHelperRecord(bytes);
  } finally {
    await handle.close();
  }
}

export async function validateProductionHostHelperInstallation() {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("validation must run as root");
  }
  if (!["linux", "darwin"].includes(process.platform)) {
    throw new Error("unsupported operating system");
  }
  if (process.version !== EXPECTED_NODE_VERSION) {
    throw new Error(`Node runtime must be exactly ${EXPECTED_NODE_VERSION}`);
  }
  const verifiedRelease = await loadVerifiedHostHelperRecord();
  await requirePath(
    "/usr/local/libexec/repo-assessment-kit",
    (info) => info.isDirectory(),
    0o555,
    0,
    0,
  );
  await requirePath(
    "/usr/local/libexec/repo-assessment-kit/node",
    (info) => info.isFile(),
    0o755,
    0,
    0,
  );
  await requirePath("/usr/local/libexec/rak-peer-cred", (info) => info.isFile(), 0o755, 0, 0);
  for (const path of [
    "/usr/local/libexec/repo-assessment-kit/scripts/production-host-helper.mjs",
    "/usr/local/libexec/repo-assessment-kit/scripts/host-helper-service.mjs",
    "/usr/local/libexec/repo-assessment-kit/scripts/host-helper-journal.mjs",
    "/usr/local/libexec/repo-assessment-kit/scripts/host-helper-operations.mjs",
    "/usr/local/libexec/repo-assessment-kit/scripts/host-helper-protocol.mjs",
    "/usr/local/libexec/repo-assessment-kit/scripts/production-installation-config.mjs",
    "/usr/local/libexec/repo-assessment-kit/container/provider-task.mjs",
  ]) {
    await requirePath(path, (info) => info.isFile(), 0o444, 0, 0);
  }
  for (const path of [
    "/usr/local/libexec/repo-assessment-kit/validate-production-host-helper.mjs",
    "/usr/local/libexec/repo-assessment-kit/service-entrypoint.mjs",
  ]) {
    await requirePath(path, (info) => info.isFile(), 0o555, 0, 0);
  }
  const serviceDefinition =
    process.platform === "linux"
      ? "/etc/systemd/system/repo-assessment-kit-host-helper.service"
      : "/Library/LaunchDaemons/com.repo-assessment-kit.host-helper.plist";
  await requirePath(serviceDefinition, (info) => info.isFile(), 0o444, 0, 0);
  const installedArtifacts = [
    ["nodeSha256", "/usr/local/libexec/repo-assessment-kit/node"],
    ["peerVerifierSha256", "/usr/local/libexec/rak-peer-cred"],
    [
      "productionHostHelperSha256",
      "/usr/local/libexec/repo-assessment-kit/scripts/production-host-helper.mjs",
    ],
    [
      "hostHelperServiceSha256",
      "/usr/local/libexec/repo-assessment-kit/scripts/host-helper-service.mjs",
    ],
    [
      "hostHelperJournalSha256",
      "/usr/local/libexec/repo-assessment-kit/scripts/host-helper-journal.mjs",
    ],
    [
      "hostHelperOperationsSha256",
      "/usr/local/libexec/repo-assessment-kit/scripts/host-helper-operations.mjs",
    ],
    [
      "hostHelperProtocolSha256",
      "/usr/local/libexec/repo-assessment-kit/scripts/host-helper-protocol.mjs",
    ],
    [
      "productionInstallationConfigSha256",
      "/usr/local/libexec/repo-assessment-kit/scripts/production-installation-config.mjs",
    ],
    ["providerTaskSha256", "/usr/local/libexec/repo-assessment-kit/container/provider-task.mjs"],
    [
      "installationValidatorSha256",
      "/usr/local/libexec/repo-assessment-kit/validate-production-host-helper.mjs",
    ],
    ["serviceEntrypointSha256", "/usr/local/libexec/repo-assessment-kit/service-entrypoint.mjs"],
    process.platform === "linux"
      ? ["linuxServiceDefinitionSha256", serviceDefinition]
      : ["macosServiceDefinitionSha256", serviceDefinition],
  ];
  for (const [key, path] of installedArtifacts) {
    verifyRecordedArtifact(verifiedRelease, key, await readFile(path));
  }
  const installation = await loadProductionInstallationConfig();
  const actualPeerVerifierDigest = `sha256:${createHash("sha256")
    .update(await readFile("/usr/local/libexec/rak-peer-cred"))
    .digest("hex")}`;
  if (
    actualPeerVerifierDigest !== installation.config.peerCredentialVerifier.sha256 ||
    actualPeerVerifierDigest !== verifiedRelease.peerVerifierSha256
  ) {
    throw new Error("native peer verifier digest does not match production configuration");
  }
  if (
    installation.config.clientUid !== EXPECTED_UID ||
    installation.config.clientGid !== EXPECTED_GID
  ) {
    throw new Error("configuration does not bind the dedicated client identity");
  }
  await requirePath(
    "/var/run/repo-assessment-kit",
    (info) => info.isDirectory(),
    0o700,
    EXPECTED_UID,
    EXPECTED_GID,
  );
  await requirePath(
    "/var/lib/repo-assessment-kit/host-helper",
    (info) => info.isDirectory(),
    0o700,
    0,
    0,
  );
  await requirePath(
    "/var/lib/repo-assessment-kit/transfers",
    (info) => info.isDirectory(),
    0o710,
    0,
    EXPECTED_GID,
  );
  await requirePath(
    "/run/secrets/rak-host-helper-client.key",
    (info) => info.isFile(),
    0o600,
    EXPECTED_UID,
    EXPECTED_GID,
  );
  if ((await readFile("/run/secrets/rak-host-helper-client.key")).byteLength !== 32) {
    throw new Error("client key must contain exactly 32 raw bytes");
  }
  const socket = await lstat("/var/run/repo-assessment-kit/host-helper.sock").catch((error) =>
    error?.code === "ENOENT" ? undefined : Promise.reject(error),
  );
  if (socket !== undefined) {
    throw new Error("host-helper socket already exists; reconcile stale state before startup");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await validateProductionHostHelperInstallation();
    process.stdout.write("host-helper installation authority verified\n");
  } catch (error) {
    fail(error instanceof Error ? error.message : "unknown validation failure");
  }
}

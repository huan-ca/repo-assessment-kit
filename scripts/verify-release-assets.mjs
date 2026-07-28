import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  HOST_HELPER_INSTALLER_PATH,
  HOST_HELPER_MODULE_PATHS,
  HOST_HELPER_PLATFORM_PATHS,
  HOST_HELPER_SERVICE_PATHS,
} from "./create-release-manifest.mjs";

const digestPattern = /^[a-f0-9]{64}$/u;
const taggedDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const releaseRoot = path.resolve(import.meta.dirname, "../release");
const bundleRoot = path.resolve(import.meta.dirname, "..");
export const VERIFIED_HOST_HELPER_RECORD_PATH =
  "/var/lib/repo-assessment-kit/release/verified-host-helper.txt";
export const TRUSTED_RELEASE_SIGNING_KEY_PATH =
  "/etc/repo-assessment-kit/release/release-signing-public-key.pem";

function fail(message, code = 1) {
  process.stderr.write(`release verification failed: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const values = {
    manifest: path.join(releaseRoot, "release-manifest.json"),
    toolchain: path.join(releaseRoot, "toolchain.lock.json"),
    signature: path.join(releaseRoot, "release-signature.json"),
    trustedKey: path.join(releaseRoot, "release-signing-public-key.pem"),
    trustedKeyExplicit: false,
    output: undefined,
    inventoryOnly: false,
    emitHostHelperRecord: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--inventory-only") {
      values.inventoryOnly = true;
      continue;
    }
    if (argument === "--emit-host-helper-record") {
      values.emitHostHelperRecord = true;
      continue;
    }
    const key = {
      "--manifest": "manifest",
      "--toolchain": "toolchain",
      "--signature": "signature",
      "--trusted-key": "trustedKey",
      "--output": "output",
    }[argument];
    if (key === undefined || argv[index + 1] === undefined)
      fail(
        "usage: verify-release-assets.mjs [--manifest FILE] [--toolchain FILE] [--signature FILE] [--trusted-key FILE] [--output FILE] [--inventory-only] [--emit-host-helper-record]",
        64,
      );
    values[key] = path.resolve(argv[++index]);
    if (key === "trustedKey") values.trustedKeyExplicit = true;
  }
  return values;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, keys, label) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown fields: ${unknown.join(", ")}`);
}

async function regularFile(filePath, label) {
  const handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${label} must be a regular file`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function jsonFile(filePath, label) {
  const bytes = await regularFile(filePath, label);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

async function confinedReleasePath(relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(`${label} path is unsafe`);
  const candidate = path.resolve(releaseRoot, relativePath);
  const parent = await realpath(path.dirname(candidate));
  if (parent !== releaseRoot && !parent.startsWith(`${releaseRoot}${path.sep}`))
    throw new Error(`${label} escapes the release directory`);
  return candidate;
}

function constantEqual(left, right) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function canonicalAuthorityPayload(payload) {
  return Buffer.from(
    `{"manifestSha256":${JSON.stringify(payload.manifestSha256)},"profile":"rak-release-authority/1.0.0","toolchainLockSha256":${JSON.stringify(payload.toolchainLockSha256)}}`,
    "utf8",
  );
}

export function validateManifest(value) {
  const manifest = object(value, "release manifest");
  exactKeys(
    manifest,
    [
      "schemaVersion",
      "createdAt",
      "sourceCommit",
      "nodeVersion",
      "pnpmVersion",
      "images",
      "hostHelper",
    ],
    "release manifest",
  );
  if (
    manifest.schemaVersion !== 2 ||
    manifest.nodeVersion !== "24.4.1" ||
    manifest.pnpmVersion !== "11.17.0" ||
    !/^[a-f0-9]{40,64}$/u.test(manifest.sourceCommit ?? "") ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  )
    throw new Error("release manifest identity is invalid");
  const images = object(manifest.images, "release manifest images");
  exactKeys(images, ["codex", "claude", "acquisition", "browser"], "release manifest images");
  for (const name of ["codex", "claude", "acquisition", "browser"]) {
    const image = object(images[name], `${name} manifest image`);
    exactKeys(image, ["reference", "digest", "platforms"], `${name} manifest image`);
    if (
      typeof image.reference !== "string" ||
      image.reference.length === 0 ||
      !taggedDigestPattern.test(image.digest ?? "") ||
      !Array.isArray(image.platforms) ||
      image.platforms.length !== 2 ||
      !image.platforms.includes("linux/amd64") ||
      !image.platforms.includes("linux/arm64")
    )
      throw new Error(`${name} manifest image is incomplete`);
  }
  return manifest;
}

async function validateHostHelperAsset(recordValue, expectedPath, label, root) {
  const record = object(recordValue, label);
  exactKeys(record, ["path", "sha256"], label);
  if (record.path !== expectedPath || !taggedDigestPattern.test(record.sha256 ?? ""))
    throw new Error(`${label} identity is invalid`);
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, expectedPath);
  const resolvedRoot = await realpath(absoluteRoot);
  const resolvedParent = await realpath(path.dirname(candidate));
  if (
    resolvedRoot !== absoluteRoot ||
    resolvedParent !== path.dirname(candidate) ||
    (resolvedParent !== resolvedRoot && !resolvedParent.startsWith(`${resolvedRoot}${path.sep}`))
  )
    throw new Error(`${label} path must be canonical within the release bundle`);
  const bytes = await regularFile(candidate, label);
  const actualDigest = `sha256:${sha256(bytes)}`;
  if (!constantEqual(actualDigest, record.sha256)) throw new Error(`${label} digest mismatch`);
  return record.sha256;
}

export async function validateHostHelperRelease(value, root = bundleRoot) {
  const hostHelper = object(value, "host helper release");
  exactKeys(
    hostHelper,
    ["profile", "installer", "modules", "platforms", "serviceDefinitions"],
    "host helper release",
  );
  if (hostHelper.profile !== "rak-host-helper-release/1.0.0")
    throw new Error("host helper release identity is invalid");
  const installerSha256 = await validateHostHelperAsset(
    hostHelper.installer,
    HOST_HELPER_INSTALLER_PATH,
    "host helper installer",
    root,
  );

  const modules = object(hostHelper.modules, "host helper modules");
  exactKeys(modules, Object.keys(HOST_HELPER_MODULE_PATHS), "host helper modules");
  const moduleDigests = {};
  for (const [name, expectedPath] of Object.entries(HOST_HELPER_MODULE_PATHS)) {
    moduleDigests[name] = await validateHostHelperAsset(
      modules[name],
      expectedPath,
      `host helper module ${name}`,
      root,
    );
  }

  const serviceDefinitions = object(
    hostHelper.serviceDefinitions,
    "host helper service definitions",
  );
  exactKeys(
    serviceDefinitions,
    Object.keys(HOST_HELPER_SERVICE_PATHS),
    "host helper service definitions",
  );
  const serviceDefinitionDigests = {};
  for (const [name, expectedPath] of Object.entries(HOST_HELPER_SERVICE_PATHS)) {
    serviceDefinitionDigests[name] = await validateHostHelperAsset(
      serviceDefinitions[name],
      expectedPath,
      `host helper ${name} service definition`,
      root,
    );
  }

  const platforms = object(hostHelper.platforms, "host helper platforms");
  exactKeys(platforms, Object.keys(HOST_HELPER_PLATFORM_PATHS), "host helper platforms");
  const platformDigests = {};
  for (const [name, definition] of Object.entries(HOST_HELPER_PLATFORM_PATHS)) {
    const platform = object(platforms[name], `host helper platform ${name}`);
    exactKeys(
      platform,
      ["platform", "architecture", "nodeVersion", "node", "peerVerifier"],
      `host helper platform ${name}`,
    );
    if (
      platform.platform !== definition.platform ||
      platform.architecture !== definition.architecture ||
      platform.nodeVersion !== "v24.4.1"
    )
      throw new Error(`host helper platform ${name} identity is invalid`);
    platformDigests[name] = {
      platform: platform.platform,
      architecture: platform.architecture,
      nodeVersion: platform.nodeVersion,
      nodeSha256: await validateHostHelperAsset(
        platform.node,
        definition.node,
        `host helper platform ${name} Node`,
        root,
      ),
      peerVerifierSha256: await validateHostHelperAsset(
        platform.peerVerifier,
        definition.peerVerifier,
        `host helper platform ${name} peer verifier`,
        root,
      ),
    };
  }
  return {
    installerSha256,
    modules: moduleDigests,
    platforms: platformDigests,
    serviceDefinitions: serviceDefinitionDigests,
  };
}

async function validateDigestBoundFile(record, label, blockers) {
  if (
    record === null ||
    typeof record !== "object" ||
    !digestPattern.test(record.sha256 ?? "") ||
    typeof record.source !== "string" ||
    record.source.length === 0
  ) {
    blockers.push(`${label}: provenance record is absent or malformed`);
    return;
  }
  if (record.stagedPath === null || record.stagedPath === undefined) {
    blockers.push(`${label}: pinned asset is not staged for offline verification`);
    return;
  }
  const filePath = await confinedReleasePath(record.stagedPath, label);
  const bytes = await regularFile(filePath, label);
  if (!constantEqual(sha256(bytes), record.sha256))
    blockers.push(`${label}: staged digest mismatch`);
}

async function auditToolchain(value, manifest) {
  const blockers = [];
  const verifiedTools = {};
  const lock = object(value, "toolchain lock");
  exactKeys(
    lock,
    ["schemaVersion", "profile", "generatedFrom", "tools", "images", "releaseReadiness"],
    "toolchain lock",
  );
  if (
    lock.schemaVersion !== "1.0.0" ||
    lock.profile !== "rak-toolchain-lock/1.0.0" ||
    !Array.isArray(lock.tools) ||
    lock.tools.length > 8
  )
    throw new Error("toolchain lock identity or inventory is invalid");
  const toolIds = new Set();
  for (const rawTool of lock.tools) {
    const tool = object(rawTool, "tool");
    if (
      typeof tool.toolId !== "string" ||
      toolIds.has(tool.toolId) ||
      typeof tool.version !== "string" ||
      tool.version.length === 0
    )
      throw new Error("tool identity is missing or duplicated");
    toolIds.add(tool.toolId);
    const license = object(tool.license, `${tool.toolId} license`);
    const licensePath = await confinedReleasePath(license.path, `${tool.toolId} license`);
    const licenseBytes = await regularFile(licensePath, `${tool.toolId} license`);
    if (
      typeof license.spdx !== "string" ||
      !digestPattern.test(license.sha256 ?? "") ||
      !constantEqual(sha256(licenseBytes), license.sha256)
    )
      blockers.push(`${tool.toolId}: license notice digest mismatch`);
    const platforms = object(tool.platforms, `${tool.toolId} platforms`);
    exactKeys(platforms, ["linux/amd64", "linux/arm64"], `${tool.toolId} platforms`);
    for (const platform of ["linux/amd64", "linux/arm64"]) {
      const artifact = object(platforms[platform], `${tool.toolId} ${platform}`);
      await validateDigestBoundFile(artifact, `${tool.toolId} ${platform} binary`, blockers);
      if (artifact.sbom === null) blockers.push(`${tool.toolId} ${platform}: SBOM is absent`);
      else
        await validateDigestBoundFile(artifact.sbom, `${tool.toolId} ${platform} SBOM`, blockers);
    }
    if (tool.toolId === "age") {
      const platform =
        process.platform === "linux" && process.arch === "x64"
          ? "linux/amd64"
          : process.platform === "linux" && process.arch === "arm64"
            ? "linux/arm64"
            : undefined;
      if (platform === undefined) blockers.push("age: native release platform is unsupported");
      else {
        const artifact = platforms[platform];
        if (
          typeof artifact?.executableStagedPath === "string" &&
          digestPattern.test(artifact.executableSha256 ?? "")
        ) {
          const executablePath = await confinedReleasePath(
            artifact.executableStagedPath,
            "age executable",
          );
          const executableBytes = await regularFile(executablePath, "age executable");
          if (!constantEqual(sha256(executableBytes), artifact.executableSha256))
            blockers.push(`age ${platform}: staged executable digest mismatch`);
          verifiedTools.age = {
            version: tool.version,
            platform,
            executableSha256: artifact.executableSha256,
            stagedPath: executablePath,
          };
        } else {
          blockers.push(`age ${platform}: staged executable digest/path is absent`);
        }
      }
    }
    await validateDigestBoundFile(tool.provenance, `${tool.toolId} provenance`, blockers);
    if (tool.vulnerabilityScan === null)
      blockers.push(`${tool.toolId}: current vulnerability-scan evidence is absent`);
    else
      await validateDigestBoundFile(
        tool.vulnerabilityScan,
        `${tool.toolId} vulnerability scan`,
        blockers,
      );
  }
  const images = object(lock.images, "toolchain images");
  exactKeys(images, ["codex", "claude", "acquisition", "browser"], "toolchain images");
  const verifiedImages = {};
  for (const name of ["codex", "claude", "acquisition", "browser"]) {
    const record = images[name];
    if (record === null) {
      blockers.push(`${name}: signed image evidence is absent`);
      continue;
    }
    const image = object(record, `${name} image evidence`);
    exactKeys(
      image,
      ["reference", "digest", "platforms", "sbom", "provenance", "license", "vulnerabilityScan"],
      `${name} image evidence`,
    );
    const manifestImage = manifest.images[name];
    if (
      image.reference !== manifestImage.reference ||
      image.digest !== manifestImage.digest ||
      JSON.stringify(image.platforms) !== JSON.stringify(manifestImage.platforms)
    )
      blockers.push(`${name}: manifest and toolchain image identity differ`);
    for (const evidenceKind of ["sbom", "provenance", "license", "vulnerabilityScan"])
      await validateDigestBoundFile(image[evidenceKind], `${name} image ${evidenceKind}`, blockers);
    verifiedImages[name] = {
      reference: image.reference,
      digest: image.digest,
      immutableReference: `${image.reference.split("@")[0]}@${image.digest}`,
      platforms: [...image.platforms],
    };
  }
  return { blockers, images: verifiedImages, tools: verifiedTools };
}

export async function verifyAuthority(signaturePath, trustedKeyPath, manifestDigest, lockDigest) {
  const { value } = await jsonFile(signaturePath, "release signature");
  const envelope = object(value, "release signature");
  exactKeys(
    envelope,
    ["schemaVersion", "profile", "keyId", "algorithm", "payload", "signature"],
    "release signature",
  );
  if (
    envelope.schemaVersion !== "1.0.0" ||
    envelope.profile !== "rak-release-signature/1.0.0" ||
    envelope.algorithm !== "Ed25519" ||
    !taggedDigestPattern.test(envelope.keyId ?? "")
  )
    throw new Error("release signature identity is invalid");
  const payload = object(envelope.payload, "release signature payload");
  exactKeys(
    payload,
    ["profile", "manifestSha256", "toolchainLockSha256"],
    "release signature payload",
  );
  if (
    payload.profile !== "rak-release-authority/1.0.0" ||
    !constantEqual(payload.manifestSha256 ?? "", manifestDigest) ||
    !constantEqual(payload.toolchainLockSha256 ?? "", lockDigest)
  )
    throw new Error("release signature payload is stale or mismatched");
  const publicKeyBytes = await regularFile(trustedKeyPath, "release signing public key");
  const publicKey = createPublicKey(publicKeyBytes);
  if (publicKey.asymmetricKeyType !== "ed25519")
    throw new Error("release signing key must be Ed25519");
  const keyId = `sha256:${sha256(publicKey.export({ type: "spki", format: "der" }))}`;
  if (!constantEqual(keyId, envelope.keyId)) throw new Error("release signing key ID mismatch");
  const signature = Buffer.from(envelope.signature ?? "", "base64");
  if (
    signature.byteLength !== 64 ||
    !verifySignature(null, canonicalAuthorityPayload(payload), publicKey, signature)
  )
    throw new Error("release signature is invalid");
  return envelope.keyId;
}

const VERIFIED_HOST_HELPER_RECORD_KEYS = Object.freeze([
  "profile",
  "verified",
  "sourceCommit",
  "manifestSha256",
  "signingKeyId",
  "platform",
  "architecture",
  "nodeVersion",
  "nodeSha256",
  "peerVerifierSha256",
  "installerSha256",
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

export function serializeVerifiedHostHelperRecord(recordValue) {
  const record = object(recordValue, "verified host helper record");
  exactKeys(record, VERIFIED_HOST_HELPER_RECORD_KEYS, "verified host helper record");
  if (
    Object.keys(record).length !== VERIFIED_HOST_HELPER_RECORD_KEYS.length ||
    record.profile !== "rak-verified-host-helper-release/1.0.0" ||
    record.verified !== true ||
    !/^[a-f0-9]{40,64}$/u.test(record.sourceCommit ?? "") ||
    !taggedDigestPattern.test(record.manifestSha256 ?? "") ||
    !taggedDigestPattern.test(record.signingKeyId ?? "") ||
    !["linux", "darwin"].includes(record.platform) ||
    !["arm64", "x86-64"].includes(record.architecture) ||
    record.nodeVersion !== "v24.4.1"
  )
    throw new Error("verified host helper record identity is invalid");
  for (const key of VERIFIED_HOST_HELPER_RECORD_KEYS.filter((key) => key.endsWith("Sha256"))) {
    if (!taggedDigestPattern.test(record[key] ?? ""))
      throw new Error(`verified host helper record ${key} is invalid`);
  }
  return `${VERIFIED_HOST_HELPER_RECORD_KEYS.map(
    (key) => `${key}=${record[key] === true ? "true" : record[key]}`,
  ).join("\n")}\n`;
}

function nativeHostHelperIdentity(platform = process.platform, architecture = process.arch) {
  const recordPlatform = platform === "linux" ? "linux" : platform === "darwin" ? "darwin" : null;
  const recordArchitecture =
    architecture === "arm64" ? "arm64" : architecture === "x64" ? "x86-64" : null;
  if (recordPlatform === null || recordArchitecture === null)
    throw new Error("native host-helper release platform is unsupported");
  return {
    platform: recordPlatform,
    architecture: recordArchitecture,
    manifestPlatform: `${recordPlatform === "darwin" ? "macos" : "linux"}-${recordArchitecture}`,
  };
}

function createVerifiedHostHelperRecord({
  manifest,
  manifestSha256,
  signingKeyId,
  hostHelper,
  platform = process.platform,
  architecture = process.arch,
}) {
  const native = nativeHostHelperIdentity(platform, architecture);
  const selected = hostHelper.platforms[native.manifestPlatform];
  if (selected === undefined) throw new Error("native host-helper release payload is absent");
  return {
    profile: "rak-verified-host-helper-release/1.0.0",
    verified: true,
    sourceCommit: manifest.sourceCommit,
    manifestSha256: `sha256:${manifestSha256}`,
    signingKeyId,
    platform: native.platform,
    architecture: native.architecture,
    nodeVersion: selected.nodeVersion,
    nodeSha256: selected.nodeSha256,
    peerVerifierSha256: selected.peerVerifierSha256,
    installerSha256: hostHelper.installerSha256,
    productionHostHelperSha256: hostHelper.modules.productionHostHelper,
    hostHelperServiceSha256: hostHelper.modules.hostHelperService,
    hostHelperJournalSha256: hostHelper.modules.hostHelperJournal,
    hostHelperOperationsSha256: hostHelper.modules.hostHelperOperations,
    hostHelperProtocolSha256: hostHelper.modules.hostHelperProtocol,
    productionInstallationConfigSha256: hostHelper.modules.productionInstallationConfig,
    providerTaskSha256: hostHelper.modules.providerTask,
    installationValidatorSha256: hostHelper.modules.installationValidator,
    serviceEntrypointSha256: hostHelper.modules.serviceEntrypoint,
    linuxServiceDefinitionSha256: hostHelper.serviceDefinitions.linux,
    macosServiceDefinitionSha256: hostHelper.serviceDefinitions.macos,
  };
}

async function emitVerifiedHostHelperRecord(record) {
  if (typeof process.geteuid !== "function" || process.geteuid() !== 0)
    throw new Error("verified host-helper record emission requires root");
  const parent = path.dirname(VERIFIED_HOST_HELPER_RECORD_PATH);
  await validateSecureRootDirectory(parent, "verified host-helper record directory");
  const handle = await open(VERIFIED_HOST_HELPER_RECORD_PATH, "wx", 0o400);
  try {
    await handle.writeFile(serializeVerifiedHostHelperRecord(record), "utf8");
    await handle.chown(0, 0);
    await handle.chmod(0o400);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function validateSecureRootDirectory(directory, label, expectedUid = 0, expectedGid = 0) {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== expectedUid ||
    info.gid !== expectedGid ||
    (info.mode & 0o022) !== 0 ||
    (await realpath(directory)) !== directory
  )
    throw new Error(`${label} must be canonical, root:root, and non-writable by group/other`);
}

async function validateFixedSigningKeyAuthority(
  keyPath = TRUSTED_RELEASE_SIGNING_KEY_PATH,
  expectedUid = 0,
  expectedGid = 0,
) {
  await validateSecureRootDirectory(
    path.dirname(keyPath),
    "trusted release-signing key directory",
    expectedUid,
    expectedGid,
  );
  const info = await lstat(keyPath);
  const mode = info.mode & 0o777;
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== expectedUid ||
    info.gid !== expectedGid ||
    ![0o400, 0o444].includes(mode) ||
    (await realpath(keyPath)) !== keyPath
  )
    throw new Error(
      "trusted release-signing key must be canonical, root:root, non-symlink, and mode 0400 or 0444",
    );
}

export async function validateReleaseAuthorityFixtureTestOnly(options) {
  if (
    options?.mode !== "fixture-test-only" ||
    typeof options.recordDirectory !== "string" ||
    typeof options.signingKey !== "string"
  )
    throw new Error("explicit fixture-test-only release-authority paths are required");
  await validateSecureRootDirectory(
    path.resolve(options.recordDirectory),
    "verified host-helper record directory",
    process.getuid(),
    process.getgid(),
  );
  await validateFixedSigningKeyAuthority(
    path.resolve(options.signingKey),
    process.getuid(),
    process.getgid(),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.inventoryOnly && options.emitHostHelperRecord)
    throw new Error("inventory-only verification cannot emit a host-helper authority record");
  if (options.emitHostHelperRecord) {
    if (options.trustedKeyExplicit)
      throw new Error("host-helper authority emission does not accept a trusted-key override");
    options.trustedKey = TRUSTED_RELEASE_SIGNING_KEY_PATH;
    await validateFixedSigningKeyAuthority();
  }
  const [{ bytes: manifestBytes, value: manifestValue }, { bytes: lockBytes, value: lockValue }] =
    await Promise.all([
      jsonFile(options.manifest, "release manifest"),
      jsonFile(options.toolchain, "toolchain lock"),
    ]);
  const manifest = validateManifest(manifestValue);
  const [audit, hostHelper] = await Promise.all([
    auditToolchain(lockValue, manifest),
    validateHostHelperRelease(manifest.hostHelper),
  ]);
  const manifestSha256 = sha256(manifestBytes);
  const toolchainLockSha256 = sha256(lockBytes);

  if (options.inventoryOnly) {
    const result = {
      profile: "rak-release-inventory-audit/1.0.0",
      verified: false,
      status: audit.blockers.length === 0 ? "authority-not-checked" : "unavailable",
      manifestSha256,
      toolchainLockSha256,
      blockingReasons: audit.blockers,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = audit.blockers.length === 0 ? 0 : 2;
  } else {
    if (audit.blockers.length > 0)
      throw new Error(`release evidence is incomplete: ${audit.blockers.join("; ")}`);
    const signingKeyId = await verifyAuthority(
      options.signature,
      options.trustedKey,
      manifestSha256,
      toolchainLockSha256,
    );
    const hostHelperRecord = createVerifiedHostHelperRecord({
      manifest,
      manifestSha256,
      signingKeyId,
      hostHelper,
    });
    const result = {
      profile: "rak-verified-release/1.0.0",
      verified: true,
      sourceCommit: manifest.sourceCommit,
      manifestSha256,
      toolchainLockSha256,
      images: audit.images,
      tools: audit.tools,
      verifiedAt: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result)}\n`;
    if (options.output !== undefined)
      await writeFile(options.output, serialized, { encoding: "utf8", flag: "wx", mode: 0o444 });
    if (options.emitHostHelperRecord) await emitVerifiedHostHelperRecord(hostHelperRecord);
    process.stdout.write(serialized);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : "unknown verifier error");
  }
}

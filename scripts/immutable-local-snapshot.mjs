#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const PROFILE = "rak-immutable-local-snapshot/1.0.0";
const MANIFEST_PROFILE = "rak-snapshot-manifest/1.0.0";
const IDENTITY_PROFILE = "rak-immutable-local-identity/1.0.0";
const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 100_000,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxDepth: 64,
});
const DEFAULT_EXCLUSIONS = Object.freeze([[".git", "git-control-path"]]);
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const SAFE_SNAPSHOT_NAME = /^[a-z0-9][a-z0-9._-]{0,119}$/;

export class ImmutableSnapshotError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ImmutableSnapshotError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ImmutableSnapshotError(code, message, details);
}

function compareBytes(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function hasControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareBytes)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort(compareBytes).join(",") === [...keys].sort(compareBytes).join(",")
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function prefixedSha256(bytes) {
  return `sha256:${sha256(bytes)}`;
}

function procPath(fileHandle, child) {
  const base = `/proc/self/fd/${fileHandle.fd}`;
  return child === undefined ? base : `${base}/${child}`;
}

function assertLinuxProcFd() {
  if (process.platform !== "linux") {
    fail(
      "SIGNED_NATIVE_SNAPSHOT_HELPER_REQUIRED",
      "Immutable local snapshots require the signed native helper on this operating system",
      { platform: process.platform },
    );
  }
}

async function assertProcFdAvailable(handle) {
  try {
    const info = await stat(procPath(handle));
    if (!info.isDirectory()) throw new Error("descriptor is not a directory");
  } catch (error) {
    fail(
      "SIGNED_NATIVE_SNAPSHOT_HELPER_REQUIRED",
      "Linux proc-fd traversal is unavailable; no path-based fallback is permitted",
      { cause: error.message },
    );
  }
}

function decodeEntryName(bytes) {
  let value;
  try {
    value = UTF8.decode(bytes);
  } catch {
    fail("INVALID_UTF8_PATH", "Source contains a filename that is not valid UTF-8");
  }
  if (!Buffer.from(value, "utf8").equals(Buffer.from(bytes))) {
    fail("INVALID_UTF8_PATH", "Source filename does not have a canonical UTF-8 encoding");
  }
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    hasControlCharacter(value)
  ) {
    fail("UNSAFE_SOURCE_PATH", "Source contains an unsafe control or separator path", {
      path: JSON.stringify(value),
    });
  }
  return value;
}

function decodeSymlinkTarget(bytes) {
  let value;
  try {
    value = UTF8.decode(bytes);
  } catch {
    fail("INVALID_UTF8_PATH", "Source contains a symbolic-link target that is not valid UTF-8");
  }
  if (!Buffer.from(value, "utf8").equals(Buffer.from(bytes))) {
    fail("INVALID_UTF8_PATH", "Symbolic-link target is not canonically encoded UTF-8");
  }
  return value;
}

function validateRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.posix.isAbsolute(value) ||
    value.includes("\\") ||
    hasControlCharacter(value)
  ) {
    fail("UNSAFE_SOURCE_PATH", "relativePath must be a non-empty safe relative POSIX path");
  }
  const components = value === "." ? [] : value.split("/");
  if (components.some((part) => part === "" || part === "." || part === "..")) {
    fail("UNSAFE_SOURCE_PATH", "relativePath cannot contain empty, dot, or parent components");
  }
  for (const component of components) {
    if (component.normalize("NFC") !== component) {
      fail("UNSAFE_SOURCE_PATH", "relativePath components must be NFC-normalized");
    }
  }
  return components;
}

function validateLimits(input = {}) {
  if (!hasExactKeys(input, Object.keys(input))) {
    fail("INVALID_SNAPSHOT_LIMIT", "limits must be an object");
  }
  const allowed = new Set(Object.keys(DEFAULT_LIMITS));
  for (const name of Object.keys(input)) {
    if (!allowed.has(name)) fail("INVALID_SNAPSHOT_LIMIT", `Unknown snapshot limit: ${name}`);
  }
  const limits = { ...DEFAULT_LIMITS, ...input };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail("INVALID_SNAPSHOT_LIMIT", `${name} must be a positive safe integer`);
    }
  }
  return Object.freeze(limits);
}

function normalizeExclusions(extra = []) {
  const result = new Map(DEFAULT_EXCLUSIONS);
  for (const item of extra) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      typeof item[0] !== "string" ||
      typeof item[1] !== "string"
    ) {
      fail("INVALID_EXCLUSION", "Each exclusion must be a [relativePath, reason] pair");
    }
    const components = validateRelativePath(item[0]);
    if (components.length === 0) fail("INVALID_EXCLUSION", "Cannot exclude the source root");
    result.set(components.join("/"), item[1]);
  }
  return result;
}

function relativeTargetStaysInside(entryPath, target) {
  if (
    target.length === 0 ||
    path.posix.isAbsolute(target) ||
    target.includes("\\") ||
    hasControlCharacter(target)
  ) {
    return false;
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), target));
  return resolved !== ".." && !resolved.startsWith("../") && !path.posix.isAbsolute(resolved);
}

function metadata(statValue) {
  return {
    device: statValue.dev.toString(),
    inode: statValue.ino.toString(),
    mode: statValue.mode.toString(),
    links: statValue.nlink.toString(),
    size: statValue.size.toString(),
    modifiedNs: statValue.mtimeNs.toString(),
    changedNs: statValue.ctimeNs.toString(),
  };
}

function sameFileState(left, right) {
  return canonicalJson(metadata(left)) === canonicalJson(metadata(right));
}

async function openDirectoryNoFollow(parent, name) {
  try {
    return await open(
      procPath(parent, name),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
    );
  } catch (error) {
    fail("SOURCE_RACE_OR_ESCAPE", "A source directory changed or became a symlink", {
      path: name,
      cause: error.code,
    });
  }
}

async function openRegularNoFollow(parent, name) {
  try {
    return await open(
      procPath(parent, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
    );
  } catch (error) {
    fail("SOURCE_RACE_OR_ESCAPE", "A source file changed or became a symlink", {
      path: name,
      cause: error.code,
    });
  }
}

async function openDestinationDirectory(parent, name) {
  try {
    return await open(
      procPath(parent, name),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
    );
  } catch (error) {
    fail("SNAPSHOT_DESTINATION_RACE", "A snapshot destination directory was replaced", {
      path: name,
      cause: error.code,
    });
  }
}

async function listNames(directory) {
  const raw = await readdir(procPath(directory), { encoding: "buffer" });
  return raw.sort(compareBytes).map(decodeEntryName);
}

async function hashFileHandle(handle, limit) {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let offset = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
    if (offset > limit) fail("SNAPSHOT_FILE_LIMIT", "A source file exceeds the byte limit");
    digest.update(buffer.subarray(0, bytesRead));
  }
  return { byteLength: offset, digest: digest.digest("hex") };
}

async function copyFileHandle(source, destinationPath, expectedBytes, expectedDigest, executable) {
  let destination;
  try {
    destination = await open(
      destinationPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_CLOEXEC,
      executable ? 0o500 : 0o400,
    );
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      await destination.write(buffer.subarray(0, bytesRead), 0, bytesRead, offset);
      digest.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    await destination.sync();
    if (offset !== expectedBytes || digest.digest("hex") !== expectedDigest) {
      fail("SOURCE_MUTATED_DURING_CAPTURE", "Copied bytes differ from the captured source file");
    }
  } finally {
    await destination?.close();
  }
}

async function inspectTree({ source, sourceDevice, destination, exclusions, limits, copy }) {
  const entries = [];
  const excluded = [];
  const sourceState = [];
  const collisionKeys = new Map();
  let totalBytes = 0;

  async function walk(directory, destinationDirectory, relativeDirectory, depth) {
    if (depth > limits.maxDepth) fail("SNAPSHOT_DEPTH_LIMIT", "Source exceeds maximum depth");
    const names = await listNames(directory);
    for (const name of names) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const normalized = relative.normalize("NFC");
      if (normalized !== relative) {
        fail("UNICODE_PATH_COLLISION", "Source paths must already be NFC-normalized", {
          path: relative,
        });
      }
      const collisionKey = normalized.toLocaleLowerCase("en-US");
      const prior = collisionKeys.get(collisionKey);
      if (prior !== undefined && prior !== relative) {
        fail("CASE_UNICODE_PATH_COLLISION", "Source contains case or Unicode-colliding paths", {
          first: prior,
          second: relative,
        });
      }
      collisionKeys.set(collisionKey, relative);
      const excludedReason = exclusions.get(relative);
      if (excludedReason !== undefined) {
        excluded.push({ path: relative, reason: excludedReason });
        continue;
      }
      if (entries.length >= limits.maxEntries) {
        fail("SNAPSHOT_ENTRY_LIMIT", "Source exceeds maximum entry count");
      }

      let before;
      try {
        before = await lstat(procPath(directory, name), { bigint: true });
      } catch (error) {
        fail("SOURCE_RACE_OR_ESCAPE", "A source entry disappeared during capture", {
          path: relative,
          cause: error.code,
        });
      }
      if (before.dev !== sourceDevice) {
        fail("SOURCE_MOUNT_ESCAPE", "Cross-device source entries are not permitted", {
          path: relative,
        });
      }

      if (before.isDirectory()) {
        const child = await openDirectoryNoFollow(directory, name);
        let destinationChild;
        try {
          const opened = await child.stat({ bigint: true });
          if (!opened.isDirectory() || opened.dev !== sourceDevice || opened.ino !== before.ino) {
            fail("SOURCE_RACE_OR_ESCAPE", "A directory changed while it was opened", {
              path: relative,
            });
          }
          if (copy) {
            try {
              await mkdir(procPath(destinationDirectory, name), { mode: 0o700 });
            } catch (error) {
              fail("SNAPSHOT_DESTINATION_RACE", "Could not create snapshot directory", {
                path: relative,
                cause: error.code,
              });
            }
            destinationChild = await openDestinationDirectory(destinationDirectory, name);
          }
          entries.push({ path: relative, type: "directory", executable: true });
          sourceState.push({ path: relative, ...metadata(opened) });
          await walk(child, destinationChild, relative, depth + 1);
          const after = await child.stat({ bigint: true });
          if (!sameFileState(opened, after)) {
            fail("SOURCE_MUTATED_DURING_CAPTURE", "A source directory mutated during capture", {
              path: relative,
            });
          }
        } finally {
          await destinationChild?.close();
          await child.close();
        }
        continue;
      }

      if (before.isFile()) {
        if (before.nlink !== 1n) {
          fail("HARDLINK_AMBIGUITY", "Hard-linked source files are not permitted", {
            path: relative,
            links: before.nlink.toString(),
          });
        }
        const file = await openRegularNoFollow(directory, name);
        try {
          const opened = await file.stat({ bigint: true });
          if (
            !opened.isFile() ||
            opened.dev !== sourceDevice ||
            opened.ino !== before.ino ||
            opened.nlink !== 1n
          ) {
            fail("SOURCE_RACE_OR_ESCAPE", "A file changed while it was opened", { path: relative });
          }
          if (opened.size > BigInt(limits.maxFileBytes)) {
            fail("SNAPSHOT_FILE_LIMIT", "A source file exceeds the byte limit", {
              path: relative,
            });
          }
          const captured = await hashFileHandle(file, limits.maxFileBytes);
          const afterRead = await file.stat({ bigint: true });
          if (!sameFileState(opened, afterRead) || BigInt(captured.byteLength) !== opened.size) {
            fail("SOURCE_MUTATED_DURING_CAPTURE", "A source file mutated while it was read", {
              path: relative,
            });
          }
          totalBytes += captured.byteLength;
          if (totalBytes > limits.maxTotalBytes) {
            fail("SNAPSHOT_TOTAL_LIMIT", "Source exceeds maximum total bytes");
          }
          const executable = (Number(opened.mode) & 0o111) !== 0;
          if (copy) {
            await copyFileHandle(
              file,
              procPath(destinationDirectory, name),
              captured.byteLength,
              captured.digest,
              executable,
            );
          }
          entries.push({
            path: relative,
            type: "file",
            executable,
            byteLength: captured.byteLength,
            sha256: `sha256:${captured.digest}`,
          });
          sourceState.push({ path: relative, ...metadata(afterRead) });
        } finally {
          await file.close();
        }
        continue;
      }

      if (before.isSymbolicLink()) {
        let target;
        let after;
        try {
          target = decodeSymlinkTarget(
            await readlink(procPath(directory, name), { encoding: "buffer" }),
          );
          after = await lstat(procPath(directory, name), { bigint: true });
        } catch (error) {
          if (error instanceof ImmutableSnapshotError) throw error;
          fail("SOURCE_RACE_OR_ESCAPE", "A symbolic link changed during capture", {
            path: relative,
            cause: error.code,
          });
        }
        if (!after.isSymbolicLink() || !sameFileState(before, after)) {
          fail("SOURCE_MUTATED_DURING_CAPTURE", "A symbolic link mutated during capture", {
            path: relative,
          });
        }
        if (!relativeTargetStaysInside(relative, target)) {
          fail("ESCAPING_SYMLINK", "Absolute or escaping symbolic links are not permitted", {
            path: relative,
          });
        }
        if (copy) {
          await symlink(target, procPath(destinationDirectory, name));
        }
        entries.push({ path: relative, type: "symlink", executable: false, target });
        sourceState.push({ path: relative, ...metadata(after) });
        continue;
      }

      fail("SPECIAL_FILE_REJECTED", "Special source entries are not permitted", {
        path: relative,
      });
    }
  }

  await walk(source, destination, "", 0);
  entries.sort((left, right) => compareBytes(left.path, right.path));
  excluded.sort((left, right) => compareBytes(left.path, right.path));
  sourceState.sort((left, right) => compareBytes(left.path, right.path));
  return { entries, excluded, sourceState, totalBytes };
}

async function freezeTree(root, entries) {
  for (const entry of entries) {
    if (entry.type === "file") {
      await chmod(path.join(root, entry.path), entry.executable ? 0o555 : 0o444);
    }
  }
  const directories = entries
    .filter((entry) => entry.type === "directory")
    .sort((left, right) => right.path.split("/").length - left.path.split("/").length);
  for (const entry of directories) await chmod(path.join(root, entry.path), 0o555);
  await chmod(root, 0o555);
}

function buildManifest(captured) {
  const payload = {
    schemaVersion: "1.0.0",
    profile: PROFILE,
    entries: captured.entries,
    excluded: captured.excluded,
    entryCount: captured.entries.length,
    totalFileBytes: captured.totalBytes,
  };
  const manifest = {
    schemaVersion: "1.0.0",
    profile: MANIFEST_PROFILE,
    payload,
    payloadDigest: prefixedSha256(canonicalJson(payload)),
  };
  const bytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  return { manifest, bytes, digest: prefixedSha256(bytes) };
}

export async function captureImmutableLocalIdentity(options) {
  assertLinuxProcFd();
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    fail("INVALID_IDENTITY_REQUEST", "Identity options must be an object");
  }
  const allowed = new Set(["sourceRoot", "limits", "exclusions"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail("UNKNOWN_IDENTITY_OPTION", `Unknown identity option: ${key}`);
  }
  if (!path.isAbsolute(options.sourceRoot ?? "")) {
    fail("INVALID_SOURCE_ROOT", "sourceRoot must be absolute");
  }
  const limits = validateLimits(options.limits);
  const exclusions = normalizeExclusions(options.exclusions);
  let source;
  try {
    try {
      source = await open(
        options.sourceRoot,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
      );
    } catch (error) {
      fail("INVALID_SOURCE_ROOT", "sourceRoot must be a real directory, not a symlink", {
        cause: error.code,
      });
    }
    await assertProcFdAvailable(source);
    const initial = await source.stat({ bigint: true });
    const captured = await inspectTree({
      source,
      sourceDevice: initial.dev,
      destination: undefined,
      exclusions,
      limits,
      copy: false,
    });
    const beforeRewalk = await source.stat({ bigint: true });
    if (!sameFileState(initial, beforeRewalk)) {
      fail("SOURCE_MUTATED_DURING_CAPTURE", "Source root mutated during identity capture");
    }
    const verified = await inspectTree({
      source,
      sourceDevice: initial.dev,
      destination: undefined,
      exclusions,
      limits,
      copy: false,
    });
    const final = await source.stat({ bigint: true });
    if (canonicalJson(captured) !== canonicalJson(verified) || !sameFileState(initial, final)) {
      fail("SOURCE_MUTATED_DURING_CAPTURE", "Source changed during identity verification");
    }
    const canonicalManifest = buildManifest(captured);
    const sourceState = {
      root: metadata(final),
      entries: captured.sourceState,
    };
    return Object.freeze({
      schemaVersion: "1.0.0",
      profile: IDENTITY_PROFILE,
      manifest: canonicalManifest.manifest,
      manifestDigest: canonicalManifest.digest,
      sourceState,
      sourceStateDigest: prefixedSha256(canonicalJson(sourceState)),
    });
  } finally {
    await source?.close();
  }
}

export async function verifyImmutableLocalSnapshot(options) {
  assertLinuxProcFd();
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    fail("INVALID_VERIFICATION_REQUEST", "Verification options must be an object");
  }
  const allowed = new Set(["snapshotRoot", "manifest", "limits"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail("UNKNOWN_VERIFICATION_OPTION", `Unknown option: ${key}`);
  }
  if (!path.isAbsolute(options.snapshotRoot ?? "")) {
    fail("INVALID_SNAPSHOT_ROOT", "snapshotRoot must be absolute");
  }
  const manifest = options.manifest;
  if (
    !hasExactKeys(manifest, ["schemaVersion", "profile", "payload", "payloadDigest"]) ||
    manifest.schemaVersion !== "1.0.0" ||
    manifest.profile !== MANIFEST_PROFILE ||
    !hasExactKeys(manifest.payload, [
      "schemaVersion",
      "profile",
      "entries",
      "excluded",
      "entryCount",
      "totalFileBytes",
    ]) ||
    manifest.payload?.schemaVersion !== "1.0.0" ||
    manifest.payload?.profile !== PROFILE ||
    !Array.isArray(manifest.payload.entries) ||
    !Array.isArray(manifest.payload.excluded)
  ) {
    fail("INVALID_SNAPSHOT_MANIFEST", "Snapshot manifest is not the closed release profile");
  }
  const expectedPayloadDigest = prefixedSha256(canonicalJson(manifest.payload));
  if (manifest.payloadDigest !== expectedPayloadDigest) {
    fail("INVALID_SNAPSHOT_MANIFEST", "Snapshot manifest payload digest does not match");
  }
  const limits = validateLimits(options.limits);
  let snapshot;
  try {
    snapshot = await open(
      options.snapshotRoot,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
    );
  } catch (error) {
    fail("INVALID_SNAPSHOT_ROOT", "snapshotRoot must be a no-follow directory", {
      cause: error.code,
    });
  }
  try {
    await assertProcFdAvailable(snapshot);
    const rootInfo = await snapshot.stat({ bigint: true });
    if ((Number(rootInfo.mode) & 0o222) !== 0) {
      fail("SNAPSHOT_NOT_READ_ONLY", "Snapshot root remains writable");
    }
    const observed = await inspectTree({
      source: snapshot,
      sourceDevice: rootInfo.dev,
      destination: undefined,
      exclusions: new Map(),
      limits,
      copy: false,
    });
    if (
      canonicalJson(observed.entries) !== canonicalJson(manifest.payload.entries) ||
      observed.totalBytes !== manifest.payload.totalFileBytes ||
      observed.entries.length !== manifest.payload.entryCount
    ) {
      fail("SNAPSHOT_REREAD_MISMATCH", "Snapshot content does not match its manifest");
    }
    const entryTypes = new Map(observed.entries.map((entry) => [entry.path, entry.type]));
    for (const state of observed.sourceState) {
      if (entryTypes.get(state.path) !== "symlink" && (Number(state.mode) & 0o222) !== 0) {
        fail("SNAPSHOT_NOT_READ_ONLY", "Snapshot contains a writable entry", {
          path: state.path,
        });
      }
    }
    const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
    return Object.freeze({
      schemaVersion: "1.0.0",
      profile: "rak-snapshot-verification/1.0.0",
      manifestDigest: prefixedSha256(manifestBytes),
      entryCount: observed.entries.length,
      totalFileBytes: observed.totalBytes,
      readOnly: true,
    });
  } finally {
    await snapshot.close();
  }
}

export async function createImmutableLocalSnapshot(options) {
  assertLinuxProcFd();
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    fail("INVALID_SNAPSHOT_REQUEST", "Snapshot options must be an object");
  }
  const allowed = new Set([
    "registeredRoot",
    "relativePath",
    "outputRoot",
    "snapshotName",
    "limits",
    "exclusions",
    "testHooks",
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail("UNKNOWN_SNAPSHOT_OPTION", `Unknown snapshot option: ${key}`);
  }
  if (!path.isAbsolute(options.registeredRoot ?? "")) {
    fail("INVALID_REGISTERED_ROOT", "registeredRoot must be absolute");
  }
  if (!path.isAbsolute(options.outputRoot ?? "")) {
    fail("INVALID_OUTPUT_ROOT", "outputRoot must be absolute");
  }
  if (!SAFE_SNAPSHOT_NAME.test(options.snapshotName ?? "")) {
    fail("INVALID_SNAPSHOT_NAME", "snapshotName must be a bounded lowercase filename");
  }
  const components = validateRelativePath(options.relativePath ?? ".");
  const limits = validateLimits(options.limits);
  const exclusions = normalizeExclusions(options.exclusions);

  let source;
  let outputHandle;
  let snapshotHandle;
  let temporaryRoot;
  let finalRoot;
  let temporaryManifest;
  try {
    try {
      source = await open(
        options.registeredRoot,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
      );
    } catch (error) {
      fail("INVALID_REGISTERED_ROOT", "registeredRoot must be a real directory, not a symlink", {
        cause: error.code,
      });
    }
    await assertProcFdAvailable(source);
    for (const component of components) {
      const next = await openDirectoryNoFollow(source, component);
      await source.close();
      source = next;
    }
    const sourceInitial = await source.stat({ bigint: true });
    try {
      outputHandle = await open(
        options.outputRoot,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
      );
    } catch (error) {
      fail("INVALID_OUTPUT_ROOT", "outputRoot must be an existing real directory, not a symlink", {
        cause: error.code,
      });
    }
    await assertProcFdAvailable(outputHandle);
    const sourceReal = await realpath(procPath(source));
    const outputReal = await realpath(procPath(outputHandle));
    const outputRelative = path.relative(sourceReal, outputReal);
    if (
      outputRelative === "" ||
      (!outputRelative.startsWith(`..${path.sep}`) &&
        outputRelative !== ".." &&
        !path.isAbsolute(outputRelative))
    ) {
      fail("OUTPUT_INSIDE_SOURCE", "Snapshot output must not be inside the selected source");
    }
    const nonce = `${process.pid}-${Date.now().toString(36)}-${createHash("sha256")
      .update(`${options.snapshotName}-${Math.random()}`)
      .digest("hex")
      .slice(0, 12)}`;
    const temporaryName = `.${options.snapshotName}.${nonce}.tmp`;
    const temporaryManifestName = `.${options.snapshotName}.${nonce}.manifest.tmp`;
    const finalManifestName = `${options.snapshotName}.manifest.json`;
    temporaryRoot = procPath(outputHandle, temporaryName);
    temporaryManifest = procPath(outputHandle, temporaryManifestName);
    finalRoot = path.join(outputReal, options.snapshotName);
    for (const destinationName of [options.snapshotName, finalManifestName]) {
      try {
        await lstat(procPath(outputHandle, destinationName));
        fail("SNAPSHOT_DESTINATION_EXISTS", "Final snapshot destination already exists", {
          destination: path.join(outputReal, destinationName),
        });
      } catch (error) {
        if (error instanceof ImmutableSnapshotError) throw error;
        if (error.code !== "ENOENT") throw error;
      }
    }
    try {
      await mkdir(temporaryRoot, { mode: 0o700 });
      snapshotHandle = await open(
        temporaryRoot,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
      );
    } catch (error) {
      fail("SNAPSHOT_DESTINATION_EXISTS", "Could not create a new private snapshot root", {
        cause: error.code,
      });
    }
    const anchoredTemporaryRoot = procPath(snapshotHandle);

    const captured = await inspectTree({
      source,
      sourceDevice: sourceInitial.dev,
      destination: snapshotHandle,
      exclusions,
      limits,
      copy: true,
    });
    await options.testHooks?.afterCapture?.();
    const sourceBeforeRewalk = await source.stat({ bigint: true });
    if (!sameFileState(sourceInitial, sourceBeforeRewalk)) {
      fail("SOURCE_MUTATED_DURING_CAPTURE", "Source root mutated during capture");
    }
    const verified = await inspectTree({
      source,
      sourceDevice: sourceInitial.dev,
      destination: undefined,
      exclusions,
      limits,
      copy: false,
    });
    if (canonicalJson(captured) !== canonicalJson(verified)) {
      fail("SOURCE_MUTATED_DURING_CAPTURE", "Source manifest changed during verification");
    }
    const sourceFinal = await source.stat({ bigint: true });
    if (!sameFileState(sourceInitial, sourceFinal)) {
      fail("SOURCE_MUTATED_DURING_CAPTURE", "Source root changed during verification");
    }

    const canonicalManifest = buildManifest(captured);
    const { manifest } = canonicalManifest;
    const manifestBytes = canonicalManifest.bytes;
    await writeFile(temporaryManifest, manifestBytes, {
      mode: 0o400,
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    });
    const reread = await readFile(temporaryManifest);
    if (!reread.equals(manifestBytes)) fail("MANIFEST_REREAD_MISMATCH", "Manifest reread failed");
    await freezeTree(anchoredTemporaryRoot, captured.entries);
    await snapshotHandle.sync();
    const frozen = await inspectTree({
      source: snapshotHandle,
      sourceDevice: (await snapshotHandle.stat({ bigint: true })).dev,
      destination: undefined,
      exclusions: new Map(),
      limits,
      copy: false,
    });
    if (canonicalJson(frozen.entries) !== canonicalJson(captured.entries)) {
      fail("SNAPSHOT_REREAD_MISMATCH", "Frozen snapshot bytes do not match the capture manifest");
    }
    await snapshotHandle.close();
    snapshotHandle = undefined;
    await chmod(temporaryManifest, 0o444);
    await outputHandle.sync();
    for (const destinationName of [options.snapshotName, finalManifestName]) {
      try {
        await lstat(procPath(outputHandle, destinationName));
        fail("SNAPSHOT_DESTINATION_EXISTS", "Final snapshot destination appeared during capture", {
          destination: path.join(outputReal, destinationName),
        });
      } catch (error) {
        if (error instanceof ImmutableSnapshotError) throw error;
        if (error.code !== "ENOENT") throw error;
      }
    }
    try {
      await rename(temporaryRoot, procPath(outputHandle, options.snapshotName));
    } catch (error) {
      fail("SNAPSHOT_DESTINATION_EXISTS", "Final snapshot destination already exists", {
        cause: error.code,
      });
    }
    temporaryRoot = undefined;
    const manifestPath = path.join(outputReal, finalManifestName);
    try {
      await rename(temporaryManifest, procPath(outputHandle, finalManifestName));
    } catch (error) {
      await rm(procPath(outputHandle, options.snapshotName), { recursive: true, force: true });
      fail("SNAPSHOT_DESTINATION_EXISTS", "Final manifest destination already exists", {
        cause: error.code,
      });
    }
    temporaryManifest = undefined;
    await outputHandle.sync();
    return Object.freeze({
      schemaVersion: "1.0.0",
      profile: PROFILE,
      snapshotRoot: finalRoot,
      manifestPath,
      manifestDigest: prefixedSha256(manifestBytes),
      manifest,
    });
  } catch (error) {
    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
    if (temporaryManifest !== undefined) await rm(temporaryManifest, { force: true });
    throw error;
  } finally {
    await snapshotHandle?.close();
    await outputHandle?.close();
    await source?.close();
  }
}

function usage() {
  return `Usage: node scripts/immutable-local-snapshot.mjs \\
  --registered-root <absolute-directory> \\
  --relative-path <relative-posix-path> \\
  --output-root <absolute-generated-directory> \\
  --snapshot-name <lowercase-name>\n`;
}

function parseCli(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return null;
  const allowed = new Set([
    "--registered-root",
    "--relative-path",
    "--output-root",
    "--snapshot-name",
  ]);
  if (argv.length % 2 !== 0) fail("INVALID_CLI_ARGUMENTS", usage().trim());
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || value === undefined || value.startsWith("--") || values.has(key)) {
      fail("INVALID_CLI_ARGUMENTS", `Unknown, duplicate, or incomplete argument: ${key}`);
    }
    values.set(key, value);
  }
  for (const key of allowed) {
    if (!values.has(key)) fail("INVALID_CLI_ARGUMENTS", `Required argument missing: ${key}`);
  }
  return {
    registeredRoot: values.get("--registered-root"),
    relativePath: values.get("--relative-path"),
    outputRoot: values.get("--output-root"),
    snapshotName: values.get("--snapshot-name"),
  };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options === null) {
    process.stdout.write(usage());
    return;
  }
  const result = await createImmutableLocalSnapshot(options);
  process.stdout.write(
    `${canonicalJson({
      schemaVersion: result.schemaVersion,
      profile: result.profile,
      snapshotRoot: result.snapshotRoot,
      manifestPath: result.manifestPath,
      manifestDigest: result.manifestDigest,
    })}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    const typed =
      error instanceof ImmutableSnapshotError
        ? error
        : new ImmutableSnapshotError("SNAPSHOT_INTERNAL_ERROR", error.message);
    process.stderr.write(
      `${canonicalJson({
        schemaVersion: "1.0.0",
        error: { code: typed.code, message: typed.message, details: typed.details },
      })}\n`,
    );
    process.exitCode = typed.code === "SIGNED_NATIVE_SNAPSHOT_HELPER_REQUIRED" ? 78 : 65;
  });
}

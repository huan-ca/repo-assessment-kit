import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { createProductionHostHelperClient } from "./host-helper-client.mjs";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TERMINAL_FAILURE = new Set(["REJECTED", "FAILED", "CANCELLED", "INTERRUPTED"]);
const DEFAULT_LIMITS = Object.freeze({
  maxPolls: 120,
  pollIntervalMs: 1_000,
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxEntries: 100_000,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxDepth: 64,
});
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export class ProductionSshSourceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProductionSshSourceError";
    this.code = code;
    if (options.state !== undefined) this.state = options.state;
    if (options.cleanup !== undefined) this.cleanup = options.cleanup;
  }
}

function fail(code, message, options) {
  throw new ProductionSshSourceError(code, message, options);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    fail("SSH_FLOW_INVALID_RECEIPT", "A helper receipt is not canonical I-JSON");
  }
  return JSON.stringify(value);
}

function digestJson(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function exactObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!exactObject(value)) return false;
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateLimits(input = {}) {
  if (!exactObject(input)) fail("SSH_IMPORT_LIMIT_INVALID", "SSH import limits must be an object");
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in limits)) fail("SSH_IMPORT_LIMIT_INVALID", `Unknown SSH import limit: ${key}`);
    if (!Number.isSafeInteger(value) || value < (key === "pollIntervalMs" ? 0 : 1)) {
      fail("SSH_IMPORT_LIMIT_INVALID", `${key} must be a bounded positive integer`);
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

function helperResult(response, operation) {
  if (!exactObject(response) || response.operation !== operation) {
    fail("SSH_HELPER_RESPONSE_INVALID", `The ${operation} response is not bound to its operation`);
  }
  if (response.error !== undefined) {
    fail(
      typeof response.error?.code === "string"
        ? response.error.code
        : "SSH_HELPER_OPERATION_FAILED",
      `The ${operation} helper operation failed`,
    );
  }
  if (!exactObject(response.result)) {
    fail("SSH_HELPER_RESPONSE_INVALID", `The ${operation} response has no result`);
  }
  return response.result;
}

function validateContext(context) {
  if (
    !exactObject(context) ||
    !SAFE_ID.test(context.installationId ?? "") ||
    !SAFE_ID.test(context.runId ?? "") ||
    !SAFE_ID.test(context.attemptId ?? "") ||
    typeof context.fenceToken !== "string" ||
    context.fenceToken.length === 0 ||
    !SAFE_ID.test(context.commandId ?? "")
  ) {
    fail("SSH_FLOW_CONTEXT_INVALID", "SSH flow context does not match the fixed helper identity");
  }
}

function commandContext(context, suffix) {
  const commandId = `${context.commandId}:${suffix}`;
  if (!SAFE_ID.test(commandId)) {
    fail("SSH_FLOW_CONTEXT_INVALID", "Derived SSH helper command identity is invalid");
  }
  return { ...context, commandId };
}

async function emit(journal, status, phase, effect, state, details = {}) {
  if (journal === undefined) return;
  if (typeof journal !== "function") {
    fail("SSH_FLOW_JOURNAL_INVALID", "SSH flow journal must be a callback");
  }
  await journal(
    Object.freeze({
      schemaVersion: "1.0.0",
      profile: "rak-production-ssh-source-journal/1.0.0",
      status,
      phase,
      effect,
      state: Object.freeze({ ...state }),
      ...details,
    }),
  );
}

async function effect(journal, phase, name, state, action) {
  await emit(journal, "PREPARED", phase, name, state);
  const value = await action();
  await emit(journal, "COMPLETED", phase, name, state, { resultDigest: digestJson(value) });
  return value;
}

function validateSource(source) {
  if (
    !exactObject(source) ||
    source.kind !== "ssh" ||
    typeof source.url !== "string" ||
    source.url.length === 0 ||
    !SAFE_ID.test(source.acquisitionProfileId ?? "") ||
    (source.ref !== undefined && (typeof source.ref !== "string" || source.ref.length === 0))
  ) {
    fail(
      "SSH_SOURCE_AUTHORITY_MISSING",
      "SSH source requires an exact URL and registered acquisitionProfileId authority",
    );
  }
}

function validateResumeState(state, source, context) {
  if (state === undefined) {
    return Object.freeze({
      version: "1.0.0",
      phase: "INITIAL",
      runId: context.runId,
      sourceBindingDigest: digestJson(source),
    });
  }
  if (
    !exactObject(state) ||
    state.version !== "1.0.0" ||
    state.runId !== context.runId ||
    state.sourceBindingDigest !== digestJson(source) ||
    !["INITIAL", "ACQUIRING", "ACQUIRED", "FINALIZED", "IMPORTED", "RELEASED"].includes(state.phase)
  ) {
    fail("SSH_RESUME_STATE_INVALID", "SSH resume state does not match this run and source");
  }
  if (state.phase !== "INITIAL" && !SAFE_ID.test(state.sourceCommandId ?? "")) {
    fail("SSH_RESUME_STATE_INVALID", "SSH resume state is missing its source command identity");
  }
  return Object.freeze({ ...state });
}

function terminalIdentity(result, prior) {
  const merged = { ...prior, ...result };
  if (
    merged.state !== "SUCCEEDED" ||
    !SAFE_ID.test(merged.sourceCommandId ?? "") ||
    typeof merged.sanitizedLocator !== "string" ||
    merged.sanitizedLocator.length === 0 ||
    typeof merged.resolvedCommitSha !== "string" ||
    merged.resolvedCommitSha.length === 0 ||
    !SAFE_ID.test(merged.snapshotId ?? "") ||
    !DIGEST.test(merged.manifestDigest ?? "") ||
    !DIGEST.test(merged.archiveDigest ?? "") ||
    !DIGEST.test(merged.beforeSourceDigest ?? "") ||
    !DIGEST.test(merged.afterSourceDigest ?? "") ||
    !Array.isArray(merged.limitationCodes) ||
    merged.limitationCodes.some((value) => typeof value !== "string")
  ) {
    fail(
      "SSH_ACQUISITION_RESULT_INCOMPLETE",
      "Trusted SSH acquisition did not return the complete immutable snapshot identity",
    );
  }
  return Object.freeze(merged);
}

async function pollAcquisition(client, acquired, context, limits, journal, state, signal) {
  let current = acquired;
  for (let poll = 0; poll <= limits.maxPolls; poll += 1) {
    if (current.state === "SUCCEEDED") return terminalIdentity(current, acquired);
    if (TERMINAL_FAILURE.has(current.state)) {
      fail("SSH_ACQUISITION_FAILED", `Trusted SSH acquisition ended in ${current.state}`);
    }
    if (signal?.aborted) {
      fail("SSH_ACQUISITION_CANCELLED", "Trusted SSH acquisition was cancelled");
    }
    if (poll === limits.maxPolls) {
      fail("SSH_ACQUISITION_TIMEOUT", "Trusted SSH acquisition exceeded its bounded poll count");
    }
    if (limits.pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, limits.pollIntervalMs));
    }
    const response = await effect(journal, "ACQUIRING", "source.status", state, () =>
      client.sourceStatus(
        acquired.sourceCommandId,
        commandContext(context, `status-${String(poll + 1)}`),
      ),
    );
    current = helperResult(response, "source.status");
  }
  fail("SSH_ACQUISITION_TIMEOUT", "Trusted SSH acquisition did not terminate");
}

function decodeString(field, label) {
  const zero = field.indexOf(0);
  const end = zero === -1 ? field.length : zero;
  if (zero !== -1 && field.subarray(zero).some((value) => value !== 0)) {
    fail("SSH_ARCHIVE_NONCANONICAL", `${label} has bytes after its NUL terminator`);
  }
  try {
    const decoded = UTF8.decode(field.subarray(0, end));
    if (!Buffer.from(decoded, "utf8").equals(field.subarray(0, end))) throw new Error();
    return decoded;
  } catch {
    fail("SSH_ARCHIVE_PATH_INVALID", `${label} is not canonical UTF-8`);
  }
}

function parseOctal(field, label) {
  const text = field.toString("ascii");
  if (!/^[0-7]+(?:\0| )$/u.test(text)) {
    fail("SSH_ARCHIVE_NONCANONICAL", `${label} is not canonical USTAR octal`);
  }
  const value = Number.parseInt(text.slice(0, -1), 8);
  if (!Number.isSafeInteger(value)) fail("SSH_ARCHIVE_LIMIT", `${label} exceeds safe bounds`);
  return value;
}

function validateArchivePath(value, limits) {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.normalize("NFC") !== value ||
    [...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 0x1f || point === 0x7f;
    })
  ) {
    fail("SSH_ARCHIVE_PATH_INVALID", "USTAR entry path is unsafe");
  }
  const components = value.split("/");
  if (
    components.length > limits.maxDepth ||
    components.some((component) => component === "" || component === "." || component === "..")
  ) {
    fail("SSH_ARCHIVE_PATH_INVALID", "USTAR entry path escapes or exceeds depth limits");
  }
  return components;
}

function parseHeader(header, limits) {
  if (
    !header.subarray(257, 263).equals(Buffer.from("ustar\0", "binary")) ||
    !header.subarray(263, 265).equals(Buffer.from("00", "ascii"))
  ) {
    fail("SSH_ARCHIVE_FORMAT_INVALID", "Only canonical POSIX USTAR archives are admitted");
  }
  let checksum = 0;
  for (let index = 0; index < header.length; index += 1) {
    checksum += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (parseOctal(header.subarray(148, 156), "checksum") !== checksum) {
    fail("SSH_ARCHIVE_CHECKSUM_INVALID", "USTAR header checksum does not match");
  }
  const name = decodeString(header.subarray(0, 100), "USTAR name");
  const prefix = decodeString(header.subarray(345, 500), "USTAR prefix");
  const entryPath = prefix.length === 0 ? name : `${prefix}/${name}`;
  const components = validateArchivePath(entryPath, limits);
  const type = header[156];
  if (![0, 0x30, 0x35].includes(type)) {
    fail(
      "SSH_ARCHIVE_TYPE_REJECTED",
      "Links, devices, PAX, sparse, and special USTAR entries reject",
    );
  }
  if (decodeString(header.subarray(157, 257), "USTAR link name") !== "") {
    fail("SSH_ARCHIVE_TYPE_REJECTED", "USTAR links are not admitted");
  }
  const size = parseOctal(header.subarray(124, 136), "size");
  const mode = parseOctal(header.subarray(100, 108), "mode");
  const uid = parseOctal(header.subarray(108, 116), "uid");
  const gid = parseOctal(header.subarray(116, 124), "gid");
  parseOctal(header.subarray(136, 148), "mtime");
  if (uid !== 0 || gid !== 0) {
    fail("SSH_ARCHIVE_NONCANONICAL", "Canonical USTAR ownership must be root:root");
  }
  const directory = type === 0x35;
  if (
    (directory && (size !== 0 || mode !== 0o555)) ||
    (!directory && ![0o444, 0o555].includes(mode))
  ) {
    fail("SSH_ARCHIVE_NONCANONICAL", "Canonical USTAR type, size, and mode disagree");
  }
  return { path: entryPath, components, directory, size, executable: mode === 0o555 };
}

async function readExact(handle, buffer, position, label) {
  let consumed = 0;
  while (consumed < buffer.length) {
    const read = await handle.read(buffer, consumed, buffer.length - consumed, position + consumed);
    if (read.bytesRead === 0) fail("SSH_ARCHIVE_TRUNCATED", `${label} is truncated`);
    consumed += read.bytesRead;
  }
}

function procPath(handle, child = "") {
  return child === "" ? `/proc/self/fd/${handle.fd}` : `/proc/self/fd/${handle.fd}/${child}`;
}

async function openParent(root, components) {
  let current = root;
  const opened = [];
  try {
    for (const component of components.slice(0, -1)) {
      const next = await open(
        procPath(current, component),
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
      ).catch(() =>
        fail("SSH_IMPORT_PARENT_MISSING", "USTAR file precedes its declared directory"),
      );
      opened.push(next);
      current = next;
    }
    return { parent: current, opened };
  } catch (error) {
    await Promise.allSettled(opened.map((handle) => handle.close()));
    throw error;
  }
}

function manifestEntries(manifest) {
  const entries = manifest?.payload?.entries;
  if (
    !hasExactKeys(manifest, ["schemaVersion", "profile", "payload", "payloadDigest"]) ||
    manifest.schemaVersion !== "1.0.0" ||
    manifest.profile !== "rak-snapshot-manifest/1.0.0" ||
    !hasExactKeys(manifest.payload, [
      "schemaVersion",
      "profile",
      "entries",
      "excluded",
      "entryCount",
      "totalFileBytes",
    ]) ||
    manifest.payload.schemaVersion !== "1.0.0" ||
    manifest.payload.profile !== "rak-immutable-local-snapshot/1.0.0" ||
    !Array.isArray(entries) ||
    !Array.isArray(manifest.payload.excluded) ||
    manifest.payload.entryCount !== entries.length ||
    !Number.isSafeInteger(manifest.payload.totalFileBytes) ||
    manifest.payload.totalFileBytes < 0
  ) {
    fail("SSH_MANIFEST_INVALID", "SSH snapshot manifest is not the closed canonical profile");
  }
  if (
    typeof manifest.payloadDigest !== "string" ||
    manifest.payloadDigest !== digestJson(manifest.payload)
  ) {
    fail("SSH_MANIFEST_INVALID", "SSH snapshot manifest payload digest does not match");
  }
  return entries;
}

function compareManifest(manifest, observed) {
  const expected = manifestEntries(manifest).map((entry) => {
    if (!exactObject(entry) || typeof entry.path !== "string") {
      fail("SSH_MANIFEST_INVALID", "SSH snapshot manifest entry is invalid");
    }
    if (entry.type === "directory") {
      if (!hasExactKeys(entry, ["path", "type", "executable"]) || entry.executable !== false) {
        fail("SSH_MANIFEST_INVALID", "SSH manifest directory entry is not closed");
      }
      return { path: entry.path, type: "directory", executable: false };
    }
    if (
      !hasExactKeys(entry, ["path", "type", "executable", "byteLength", "sha256"]) ||
      entry.type !== "file" ||
      typeof entry.executable !== "boolean" ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0 ||
      !DIGEST.test(entry.sha256 ?? "")
    ) {
      fail("SSH_MANIFEST_INVALID", "SSH manifest admits regular files and directories only");
    }
    return {
      path: entry.path,
      type: "file",
      executable: entry.executable,
      byteLength: entry.byteLength,
      sha256: entry.sha256,
    };
  });
  const expectedTotal = expected.reduce((total, entry) => total + (entry.byteLength ?? 0), 0);
  if (expectedTotal !== manifest.payload.totalFileBytes) {
    fail("SSH_MANIFEST_INVALID", "SSH manifest totalFileBytes does not match its entries");
  }
  expected.sort((left, right) => compareUtf8(left.path, right.path));
  observed.sort((left, right) => compareUtf8(left.path, right.path));
  if (canonicalJson(expected) !== canonicalJson(observed)) {
    fail(
      "SSH_MANIFEST_MISMATCH",
      "USTAR entries do not exactly match the signed snapshot manifest",
    );
  }
}

async function syncDirectory(handle) {
  await handle.sync();
}

async function importCanonicalSshSnapshot({
  archivePath,
  archiveDigest,
  manifest,
  manifestDigest,
  snapshotStore,
  snapshotId,
  limits: limitInput,
}) {
  const limits = validateLimits(limitInput);
  if (
    !path.isAbsolute(archivePath ?? "") ||
    !path.isAbsolute(snapshotStore ?? "") ||
    !SAFE_ID.test(snapshotId ?? "") ||
    !DIGEST.test(archiveDigest ?? "") ||
    !DIGEST.test(manifestDigest ?? "")
  ) {
    fail("SSH_IMPORT_REQUEST_INVALID", "SSH transfer import binding is invalid");
  }
  const canonicalManifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  const observedManifestDigest = `sha256:${createHash("sha256")
    .update(canonicalManifestBytes)
    .digest("hex")}`;
  if (observedManifestDigest !== manifestDigest) {
    fail("SSH_MANIFEST_DIGEST_MISMATCH", "Canonical SSH manifest digest changed before import");
  }
  await mkdir(snapshotStore, { recursive: true, mode: 0o700 });
  await chmod(snapshotStore, 0o700);
  const store = await open(
    snapshotStore,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
  );
  const stagingName = `.ssh-import-${randomUUID()}`;
  const finalName = `ssh-${createHash("sha256").update(snapshotId).digest("hex")}`;
  let archive;
  let staging;
  let committed = false;
  try {
    archive = await open(
      archivePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
    );
    const before = await archive.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limits.maxArchiveBytes)) {
      fail("SSH_ARCHIVE_LIMIT", "SSH snapshot archive exceeds its fixed byte limit");
    }
    await mkdir(procPath(store, stagingName), { mode: 0o700 });
    staging = await open(
      procPath(store, stagingName),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
    );
    const archiveHash = createHash("sha256");
    const seen = new Set();
    const collisionKeys = new Set();
    const observed = [];
    let totalBytes = 0;
    let position = 0;
    let zeroBlocks = 0;
    while (position < Number(before.size)) {
      const header = Buffer.alloc(512);
      await readExact(archive, header, position, "USTAR header");
      archiveHash.update(header);
      position += 512;
      if (header.every((value) => value === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks === 2) break;
        continue;
      }
      if (zeroBlocks !== 0) fail("SSH_ARCHIVE_NONCANONICAL", "USTAR has an isolated zero block");
      const entry = parseHeader(header, limits);
      if (seen.has(entry.path)) fail("SSH_ARCHIVE_DUPLICATE", "USTAR contains a duplicate path");
      const collisionKey = entry.path.normalize("NFC").toLocaleLowerCase("en-US");
      if (collisionKeys.has(collisionKey)) {
        fail("SSH_ARCHIVE_DUPLICATE", "USTAR contains a case or Unicode-colliding path");
      }
      seen.add(entry.path);
      collisionKeys.add(collisionKey);
      if (seen.size > limits.maxEntries || entry.size > limits.maxFileBytes) {
        fail("SSH_ARCHIVE_LIMIT", "USTAR entry count or file size exceeds fixed limits");
      }
      totalBytes += entry.size;
      if (totalBytes > limits.maxTotalBytes) {
        fail("SSH_ARCHIVE_LIMIT", "USTAR total file bytes exceed the fixed limit");
      }
      const { parent, opened } = await openParent(staging, entry.components);
      const name = entry.components.at(-1);
      try {
        if (entry.directory) {
          await mkdir(procPath(parent, name), { mode: 0o700 });
          const directory = await open(
            procPath(parent, name),
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC,
          );
          await directory.sync();
          await directory.close();
          observed.push({ path: entry.path, type: "directory", executable: false });
        } else {
          const file = await open(
            procPath(parent, name),
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW |
              constants.O_CLOEXEC,
            0o400,
          );
          const fileHash = createHash("sha256");
          try {
            let remaining = entry.size;
            while (remaining > 0) {
              const length = Math.min(64 * 1024, remaining);
              const bytes = Buffer.allocUnsafe(length);
              await readExact(archive, bytes, position, "USTAR file payload");
              archiveHash.update(bytes);
              fileHash.update(bytes);
              await file.write(bytes);
              position += length;
              remaining -= length;
            }
            await file.sync();
          } finally {
            await file.close();
          }
          await chmod(procPath(parent, name), entry.executable ? 0o500 : 0o400);
          observed.push({
            path: entry.path,
            type: "file",
            executable: entry.executable,
            byteLength: entry.size,
            sha256: `sha256:${fileHash.digest("hex")}`,
          });
        }
        await syncDirectory(parent);
      } finally {
        await Promise.allSettled(opened.reverse().map((handle) => handle.close()));
      }
      const padding = (512 - (entry.size % 512)) % 512;
      if (padding > 0) {
        const bytes = Buffer.alloc(padding);
        await readExact(archive, bytes, position, "USTAR padding");
        if (!bytes.every((value) => value === 0)) {
          fail("SSH_ARCHIVE_NONCANONICAL", "USTAR file padding is not zero");
        }
        archiveHash.update(bytes);
        position += padding;
      }
    }
    if (zeroBlocks !== 2 || position !== Number(before.size)) {
      fail("SSH_ARCHIVE_NONCANONICAL", "USTAR must end with exactly two zero blocks");
    }
    const after = await archive.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      fail("SSH_ARCHIVE_CHANGED", "SSH transfer archive changed while held open");
    }
    if (`sha256:${archiveHash.digest("hex")}` !== archiveDigest) {
      fail("SSH_ARCHIVE_DIGEST_MISMATCH", "SSH transfer archive digest changed before import");
    }
    compareManifest(manifest, observed);
    for (const entry of [...observed]
      .filter((item) => item.type === "directory")
      .sort((left, right) => right.path.split("/").length - left.path.split("/").length)) {
      await chmod(procPath(staging, entry.path), 0o500);
    }
    await chmod(procPath(store, stagingName), 0o500);
    await staging.sync();
    await rename(procPath(store, stagingName), procPath(store, finalName));
    await store.sync();
    committed = true;
    const receipt = Object.freeze({
      schemaVersion: "1.0.0",
      profile: "rak-ssh-snapshot-import/1.0.0",
      snapshotId,
      manifestDigest,
      archiveDigest,
      entryCount: observed.length,
      totalFileBytes: totalBytes,
      readOnly: true,
    });
    return Object.freeze({
      snapshotRoot: path.join(snapshotStore, finalName),
      receipt,
      receiptDigest: digestJson(receipt),
    });
  } catch (error) {
    if (error instanceof ProductionSshSourceError) throw error;
    fail("SSH_IMPORT_FAILED", "SSH snapshot import failed closed", { cause: error });
  } finally {
    await archive?.close();
    await staging?.close();
    await store.close();
    if (!committed)
      await rm(path.join(snapshotStore, stagingName), { recursive: true, force: true });
  }
}

function releaseCleanup(result) {
  const cleanup = result?.cleanup;
  if (
    result?.state !== "SUCCEEDED" ||
    !exactObject(cleanup) ||
    cleanup.state !== "COMPLETE" ||
    !Array.isArray(cleanup.residueIds) ||
    cleanup.residueIds.length !== 0
  ) {
    fail("SSH_RELEASE_RESIDUE", "SSH source release did not prove zero residue", {
      cleanup,
    });
  }
  return cleanup;
}

function createFlow(client) {
  return Object.freeze({
    async execute({
      source,
      context,
      snapshotStore,
      resumeState,
      journal,
      signal,
      limits: limitInput,
    }) {
      validateSource(source);
      validateContext(context);
      if (!path.isAbsolute(snapshotStore ?? "")) {
        fail("SSH_IMPORT_REQUEST_INVALID", "snapshotStore must be an absolute owner-private path");
      }
      const limits = validateLimits(limitInput);
      let state = validateResumeState(resumeState, source, context);
      let primaryError;
      try {
        if (state.phase === "INITIAL") {
          const acquireResponse = await effect(journal, "ACQUIRING", "source.acquire", state, () =>
            client.acquireSsh(
              {
                url: source.url,
                ...(source.ref === undefined ? {} : { ref: source.ref }),
                acquisitionProfileId: source.acquisitionProfileId,
              },
              commandContext(context, "acquire"),
            ),
          );
          const acquired = helperResult(acquireResponse, "source.acquire");
          if (!SAFE_ID.test(acquired.sourceCommandId ?? "")) {
            fail(
              "SSH_ACQUISITION_RESULT_INCOMPLETE",
              "SSH acquisition returned no command identity",
            );
          }
          state = Object.freeze({
            ...state,
            sourceCommandId: acquired.sourceCommandId,
            phase: "ACQUIRING",
          });
          await emit(journal, "COMPLETED", "ACQUIRING", "source-command-admitted", state);
          const identity = await pollAcquisition(
            client,
            acquired,
            context,
            limits,
            journal,
            state,
            signal,
          );
          state = Object.freeze({
            ...state,
            phase: "ACQUIRED",
            acquisition: identity,
            acquisitionReceiptDigest: digestJson(identity),
          });
          await emit(journal, "COMPLETED", "ACQUIRED", "acquisition-admitted", state);
        } else if (state.phase === "ACQUIRING") {
          const statusResponse = await effect(journal, "ACQUIRING", "source.status", state, () =>
            client.sourceStatus(state.sourceCommandId, commandContext(context, "resume-status-1")),
          );
          const identity = await pollAcquisition(
            client,
            helperResult(statusResponse, "source.status"),
            context,
            limits,
            journal,
            state,
            signal,
          );
          state = Object.freeze({
            ...state,
            phase: "ACQUIRED",
            acquisition: identity,
            acquisitionReceiptDigest: digestJson(identity),
          });
          await emit(journal, "COMPLETED", "ACQUIRED", "acquisition-admitted", state);
        }
        if (state.phase === "ACQUIRED") {
          const identity = terminalIdentity(state.acquisition, state.acquisition);
          const finalizeResponse = await effect(
            journal,
            "FINALIZING",
            "source.finalize",
            state,
            () =>
              client.finalizeSsh(
                {
                  sourceCommandId: state.sourceCommandId,
                  expectedSnapshotId: identity.snapshotId,
                  expectedManifestDigest: identity.manifestDigest,
                  expectedArchiveDigest: identity.archiveDigest,
                },
                commandContext(context, "finalize"),
              ),
          );
          const finalized = helperResult(finalizeResponse, "source.finalize");
          if (
            finalized.state !== "SUCCEEDED" ||
            finalized.sourceCommandId !== state.sourceCommandId ||
            finalized.snapshotId !== identity.snapshotId ||
            finalized.manifestDigest !== identity.manifestDigest ||
            finalized.archiveDigest !== identity.archiveDigest ||
            !exactObject(finalized.receipt)
          ) {
            fail("SSH_FINALIZE_DRIFT", "SSH finalize result drifted from the admitted identity");
          }
          state = Object.freeze({
            ...state,
            phase: "FINALIZED",
            finalized,
            finalizeReceiptDigest: digestJson(finalized.receipt),
          });
          await emit(journal, "COMPLETED", "FINALIZED", "finalize-admitted", state);
        }
        if (state.phase === "FINALIZED") {
          const transfer = await effect(journal, "IMPORTING", "transfer.verify", state, () =>
            client.verifySshTransfer(
              {
                sourceCommandId: state.sourceCommandId,
                manifestDigest: state.finalized.manifestDigest,
                archiveDigest: state.finalized.archiveDigest,
              },
              context,
            ),
          );
          const imported = await effect(journal, "IMPORTING", "transfer.import", state, () =>
            importCanonicalSshSnapshot({
              archivePath: transfer.archivePath,
              archiveDigest: state.finalized.archiveDigest,
              manifest: transfer.manifest,
              manifestDigest: state.finalized.manifestDigest,
              snapshotStore,
              snapshotId: state.finalized.snapshotId,
              limits,
            }),
          );
          state = Object.freeze({
            ...state,
            phase: "IMPORTED",
            snapshotRoot: imported.snapshotRoot,
            importReceipt: imported.receipt,
            importReceiptDigest: imported.receiptDigest,
          });
          await emit(journal, "COMPLETED", "IMPORTED", "transfer-admitted", state);
        }
      } catch (error) {
        primaryError = error;
      }

      if (state.sourceCommandId !== undefined && state.phase !== "RELEASED") {
        if (signal?.aborted && ["ACQUIRING", "ACQUIRED"].includes(state.phase)) {
          try {
            await effect(journal, "CANCELLING", "source.cancel", state, () =>
              client.request(
                "source.cancel",
                { sourceCommandId: state.sourceCommandId, reason: "CANCELLED_BY_CALLER" },
                commandContext(context, "cancel"),
              ),
            );
          } catch (error) {
            primaryError ??= error;
          }
        }
        try {
          const releaseResponse = await effect(journal, "RELEASING", "source.release", state, () =>
            client.releaseSsh(state.sourceCommandId, commandContext(context, "release")),
          );
          const released = helperResult(releaseResponse, "source.release");
          const cleanup = releaseCleanup(released);
          state = Object.freeze({
            ...state,
            phase: "RELEASED",
            releaseReceiptDigest: digestJson(released),
            cleanupReceiptDigest: digestJson(cleanup),
            cleanup,
          });
          await emit(journal, "COMPLETED", "RELEASED", "zero-residue-admitted", state);
        } catch (releaseError) {
          const cleanup = releaseError.cleanup ?? { state: "RESIDUE", residueIds: ["unknown"] };
          throw new ProductionSshSourceError(
            "SSH_RELEASE_FAILED",
            primaryError === undefined
              ? "SSH source release failed or left residue"
              : "SSH source flow failed and release did not prove zero residue",
            { cause: releaseError, state, cleanup },
          );
        }
      }
      if (primaryError !== undefined) {
        throw new ProductionSshSourceError(
          primaryError.code ?? "SSH_SOURCE_FLOW_FAILED",
          primaryError.message ?? "SSH source flow failed",
          { cause: primaryError, state, cleanup: state.cleanup },
        );
      }
      if (state.phase !== "RELEASED" || state.snapshotRoot === undefined) {
        fail("SSH_RESUME_STATE_INVALID", "SSH flow is released without an imported snapshot", {
          state,
          cleanup: state.cleanup,
        });
      }
      const receipts = Object.freeze({
        acquisition: state.acquisitionReceiptDigest,
        finalize: state.finalizeReceiptDigest,
        import: state.importReceiptDigest,
        release: state.releaseReceiptDigest,
        cleanup: state.cleanupReceiptDigest,
      });
      if (Object.values(receipts).some((value) => !DIGEST.test(value ?? ""))) {
        fail("SSH_RECEIPT_INCOMPLETE", "SSH source flow did not close every required receipt");
      }
      const closedSource = Object.freeze({
        kind: "ssh",
        state: "CLOSED",
        sourceCommandId: state.sourceCommandId,
        sanitizedLocator: state.acquisition.sanitizedLocator,
        resolvedCommitSha: state.acquisition.resolvedCommitSha,
        beforeSourceDigest: state.acquisition.beforeSourceDigest,
        afterSourceDigest: state.acquisition.afterSourceDigest,
        limitationCodes: Object.freeze([...state.acquisition.limitationCodes]),
      });
      const closedSnapshot = Object.freeze({
        state: "IMMUTABLE",
        snapshotId: state.finalized.snapshotId,
        root: state.snapshotRoot,
        manifestDigest: state.finalized.manifestDigest,
        archiveDigest: state.finalized.archiveDigest,
        entryCount: state.importReceipt.entryCount,
        totalFileBytes: state.importReceipt.totalFileBytes,
        readOnly: true,
      });
      return Object.freeze({
        state,
        source: closedSource,
        snapshot: closedSnapshot,
        receipts,
      });
    },
  });
}

export function createProductionSshSourceFlow() {
  return createFlow(createProductionHostHelperClient());
}

export function createFixtureSshSourceFlow(options) {
  if (
    !exactObject(options) ||
    options.mode !== "fixture-test-only" ||
    !exactObject(options.helperClient)
  ) {
    fail(
      "SSH_FIXTURE_MODE_REQUIRED",
      "Injected SSH helper clients require explicit fixture-test-only mode",
    );
  }
  return createFlow(options.helperClient);
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ProductionSshSourceError, createFixtureSshSourceFlow } from "./production-ssh-source.mjs";

const source = Object.freeze({
  kind: "ssh",
  url: "git@example.test:owner/repository.git",
  ref: "main",
  acquisitionProfileId: "profile-1",
});
const context = Object.freeze({
  installationId: "installation-1",
  runId: "run-1",
  attemptId: "attempt-1",
  fenceToken: "1",
  commandId: "source-flow",
});
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const digestJson = (value) => sha256(canonicalJson(value));

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, "0")} `;
}

function tarHeader({
  name,
  size = 0,
  type = "0",
  mode = type === "5" ? 0o555 : 0o444,
  linkName = "",
}) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(mode, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(size, 12), 124, 12, "ascii");
  header.write(octal(0, 12), 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write(linkName, 157, 100, "utf8");
  header.write("ustar\0", 257, 6, "binary");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const value of header) checksum += value;
  header.write(octal(checksum, 8), 148, 8, "ascii");
  return header;
}

function buildTar(entries) {
  const parts = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.bytes ?? "");
    parts.push(tarHeader({ ...entry, size: entry.size ?? bytes.length }), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function buildManifest(entries) {
  const payloadEntries = entries.map((entry) => {
    if (entry.type === "5") {
      return { path: entry.name, type: "directory", executable: false };
    }
    const bytes = Buffer.from(entry.bytes ?? "");
    return {
      path: entry.name,
      type: "file",
      executable: entry.mode === 0o555,
      byteLength: bytes.length,
      sha256: sha256(bytes),
    };
  });
  payloadEntries.sort((left, right) => compareUtf8(left.path, right.path));
  const payload = {
    schemaVersion: "1.0.0",
    profile: "rak-immutable-local-snapshot/1.0.0",
    entries: payloadEntries,
    excluded: [],
    entryCount: payloadEntries.length,
    totalFileBytes: payloadEntries.reduce((total, entry) => total + (entry.byteLength ?? 0), 0),
  };
  return {
    schemaVersion: "1.0.0",
    profile: "rak-snapshot-manifest/1.0.0",
    payload,
    payloadDigest: digestJson(payload),
  };
}

async function fixtureTransfer(entries = [{ name: "README.md", bytes: "safe\n" }]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-ssh-flow-"));
  const archivePath = path.join(root, "snapshot.tar");
  const archive = buildTar(entries);
  const manifest = buildManifest(entries);
  await writeFile(archivePath, archive, { mode: 0o440 });
  await chmod(archivePath, 0o440);
  return {
    root,
    archivePath,
    archive,
    archiveDigest: sha256(archive),
    manifest,
    manifestDigest: sha256(`${canonicalJson(manifest)}\n`),
  };
}

function successHelper(transfer, overrides = {}) {
  const calls = [];
  const identity = {
    sourceCommandId: "source-command-1",
    state: "SUCCEEDED",
    sanitizedLocator: "example.test/owner/repository",
    resolvedCommitSha: "a".repeat(40),
    snapshotId: "snapshot-1",
    manifestDigest: transfer.manifestDigest,
    archiveDigest: transfer.archiveDigest,
    beforeSourceDigest: sha256("before"),
    afterSourceDigest: sha256("before"),
    limitationCodes: [],
  };
  const response = (operation, result) => ({ operation, state: result.state, result });
  const helper = {
    async acquireSsh(payload) {
      calls.push(["acquire", payload]);
      return response("source.acquire", overrides.acquire ?? identity);
    },
    async sourceStatus(commandId) {
      calls.push(["status", commandId]);
      return response("source.status", overrides.status ?? identity);
    },
    async finalizeSsh(payload) {
      calls.push(["finalize", payload]);
      return response(
        "source.finalize",
        overrides.finalize ?? {
          sourceCommandId: identity.sourceCommandId,
          state: "SUCCEEDED",
          snapshotId: identity.snapshotId,
          manifestDigest: identity.manifestDigest,
          archiveDigest: identity.archiveDigest,
          receipt: { artifactId: "artifact-1", digest: sha256("finalized") },
        },
      );
    },
    async verifySshTransfer(payload) {
      calls.push(["verify", payload]);
      if (overrides.verifyError) throw overrides.verifyError;
      return {
        sourceCommandId: identity.sourceCommandId,
        archivePath: transfer.archivePath,
        archiveDigest: identity.archiveDigest,
        manifestDigest: identity.manifestDigest,
        manifest: overrides.manifest ?? transfer.manifest,
      };
    },
    async releaseSsh(commandId) {
      calls.push(["release", commandId]);
      return response(
        "source.release",
        overrides.release ?? {
          sourceCommandId: identity.sourceCommandId,
          state: "SUCCEEDED",
          cleanup: {
            state: "COMPLETE",
            removedResourceIds: ["source-command-1"],
            residueIds: [],
            checkedAt: "2026-07-28T12:00:00.000Z",
          },
        },
      );
    },
    async request(operation) {
      calls.push([operation]);
      return response(operation, {
        sourceCommandId: identity.sourceCommandId,
        state: "CANCELLED",
        cleanup: {
          state: "COMPLETE",
          removedResourceIds: [],
          residueIds: [],
          checkedAt: "2026-07-28T12:00:00.000Z",
        },
      });
    },
  };
  return { helper, calls, identity };
}

test("trusted SSH flow polls, imports, releases, journals effects, and returns closed receipts", async () => {
  const transfer = await fixtureTransfer();
  const { helper, calls, identity } = successHelper(transfer, {
    acquire: { sourceCommandId: "source-command-1", state: "RUNNING" },
  });
  const events = [];
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  const result = await flow.execute({
    source,
    context,
    snapshotStore: path.join(transfer.root, "snapshots"),
    journal: async (event) => events.push(event),
    limits: { pollIntervalMs: 0 },
  });
  assert.equal(result.source.state, "CLOSED");
  assert.equal(result.snapshot.state, "IMMUTABLE");
  assert.equal(result.snapshot.snapshotId, identity.snapshotId);
  assert.equal(await readFile(path.join(result.snapshot.root, "README.md"), "utf8"), "safe\n");
  assert.equal((await stat(result.snapshot.root)).mode & 0o777, 0o500);
  assert.ok(Object.values(result.receipts).every((value) => /^sha256:[a-f0-9]{64}$/u.test(value)));
  assert.deepEqual(
    calls.map(([name]) => name),
    ["acquire", "status", "finalize", "verify", "release"],
  );
  for (const effectName of [
    "source.acquire",
    "source.status",
    "source.finalize",
    "transfer.verify",
    "transfer.import",
    "source.release",
  ]) {
    const prepared = events.findIndex(
      (event) => event.effect === effectName && event.status === "PREPARED",
    );
    const completed = events.findIndex(
      (event) => event.effect === effectName && event.status === "COMPLETED",
    );
    assert.ok(prepared >= 0 && completed > prepared, `${effectName} journal order`);
  }
});

test("missing authority and helper injection fail with precise blocks", async () => {
  assert.throws(
    () => createFixtureSshSourceFlow({ helperClient: {} }),
    (error) => error.code === "SSH_FIXTURE_MODE_REQUIRED",
  );
  const transfer = await fixtureTransfer();
  const { helper } = successHelper(transfer);
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  await assert.rejects(
    flow.execute({
      source: { kind: "ssh", url: source.url },
      context,
      snapshotStore: path.join(transfer.root, "snapshots"),
    }),
    (error) => error.code === "SSH_SOURCE_AUTHORITY_MISSING",
  );
});

test("resume from ACQUIRED does not duplicate source.acquire", async () => {
  const transfer = await fixtureTransfer();
  const { helper, calls, identity } = successHelper(transfer);
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  const result = await flow.execute({
    source,
    context,
    snapshotStore: path.join(transfer.root, "snapshots"),
    resumeState: {
      version: "1.0.0",
      phase: "ACQUIRED",
      runId: context.runId,
      sourceBindingDigest: digestJson(source),
      sourceCommandId: identity.sourceCommandId,
      acquisition: identity,
      acquisitionReceiptDigest: digestJson(identity),
    },
    limits: { pollIntervalMs: 0 },
  });
  assert.equal(result.state.phase, "RELEASED");
  assert.equal(
    calls.some(([name]) => name === "acquire"),
    false,
  );
});

test("finalize digest drift blocks import but still releases", async () => {
  const transfer = await fixtureTransfer();
  const { helper, calls } = successHelper(transfer, {
    finalize: {
      sourceCommandId: "source-command-1",
      state: "SUCCEEDED",
      snapshotId: "snapshot-1",
      manifestDigest: sha256("changed"),
      archiveDigest: transfer.archiveDigest,
      receipt: { artifactId: "artifact-1" },
    },
  });
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  await assert.rejects(
    flow.execute({
      source,
      context,
      snapshotStore: path.join(transfer.root, "snapshots"),
      limits: { pollIntervalMs: 0 },
    }),
    (error) => error.code === "SSH_FINALIZE_DRIFT" && error.cleanup.state === "COMPLETE",
  );
  assert.equal(
    calls.some(([name]) => name === "verify"),
    false,
  );
  assert.equal(calls.at(-1)[0], "release");
});

test("manifest mismatch cleans staging and still releases", async () => {
  const transfer = await fixtureTransfer();
  const mismatched = structuredClone(transfer.manifest);
  mismatched.payload.entries[0].sha256 = sha256("different");
  mismatched.payloadDigest = digestJson(mismatched.payload);
  const mismatchedDigest = sha256(`${canonicalJson(mismatched)}\n`);
  transfer.manifestDigest = mismatchedDigest;
  const { helper, calls } = successHelper(transfer, { manifest: mismatched });
  const snapshots = path.join(transfer.root, "snapshots");
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  await assert.rejects(
    flow.execute({
      source,
      context,
      snapshotStore: snapshots,
      limits: { pollIntervalMs: 0 },
    }),
    (error) => error.code === "SSH_MANIFEST_MISMATCH",
  );
  assert.deepEqual(await readdir(snapshots), []);
  assert.equal(calls.at(-1)[0], "release");
});

test("manifest profile rejects unknown fields and still releases", async () => {
  const transfer = await fixtureTransfer();
  transfer.manifest = { ...transfer.manifest, transferPath: "/caller/chosen" };
  transfer.manifestDigest = sha256(`${canonicalJson(transfer.manifest)}\n`);
  const { helper, calls } = successHelper(transfer);
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  await assert.rejects(
    flow.execute({
      source,
      context,
      snapshotStore: path.join(transfer.root, "snapshots"),
      limits: { pollIntervalMs: 0 },
    }),
    (error) => error.code === "SSH_MANIFEST_INVALID",
  );
  assert.equal(calls.at(-1)[0], "release");
});

test("release residue is terminal and reports residue", async () => {
  const transfer = await fixtureTransfer();
  const { helper } = successHelper(transfer, {
    release: {
      sourceCommandId: "source-command-1",
      state: "SUCCEEDED",
      cleanup: {
        state: "RESIDUE",
        removedResourceIds: [],
        residueIds: ["worker-1"],
        checkedAt: "2026-07-28T12:00:00.000Z",
      },
    },
  });
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  await assert.rejects(
    flow.execute({
      source,
      context,
      snapshotStore: path.join(transfer.root, "snapshots"),
      limits: { pollIntervalMs: 0 },
    }),
    (error) =>
      error.code === "SSH_RELEASE_FAILED" &&
      error.cleanup.state === "RESIDUE" &&
      error.cleanup.residueIds[0] === "worker-1",
  );
});

test("cancel closes the helper source before release", async () => {
  const transfer = await fixtureTransfer();
  const { helper, calls } = successHelper(transfer, {
    acquire: { sourceCommandId: "source-command-1", state: "RUNNING" },
  });
  const controller = new AbortController();
  controller.abort();
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  await assert.rejects(
    flow.execute({
      source,
      context,
      snapshotStore: path.join(transfer.root, "snapshots"),
      signal: controller.signal,
      limits: { pollIntervalMs: 0 },
    }),
    (error) => error.code === "SSH_ACQUISITION_CANCELLED" && error.cleanup.state === "COMPLETE",
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    ["acquire", "source.cancel", "release"],
  );
});

async function rejectsArchive(entries, expectedCode, limits = undefined) {
  const transfer = await fixtureTransfer(entries);
  const { helper } = successHelper(transfer);
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  await assert.rejects(
    flow.execute({
      source,
      context,
      snapshotStore: path.join(transfer.root, "snapshots"),
      limits,
    }),
    (error) => error instanceof ProductionSshSourceError && error.code === expectedCode,
  );
}

test("canonical USTAR import rejects traversal, links, devices, and duplicates", async () => {
  await rejectsArchive([{ name: "../escape", bytes: "x" }], "SSH_ARCHIVE_PATH_INVALID");
  await rejectsArchive(
    [{ name: "link", type: "2", linkName: "target" }],
    "SSH_ARCHIVE_TYPE_REJECTED",
  );
  await rejectsArchive([{ name: "device", type: "3" }], "SSH_ARCHIVE_TYPE_REJECTED");
  await rejectsArchive(
    [
      { name: "same", bytes: "one" },
      { name: "same", bytes: "two" },
    ],
    "SSH_ARCHIVE_DUPLICATE",
  );
});

test("canonical USTAR import enforces entry, file, and total limits", async () => {
  await rejectsArchive(
    [
      { name: "one", bytes: "1" },
      { name: "two", bytes: "2" },
    ],
    "SSH_ARCHIVE_LIMIT",
    { maxEntries: 1 },
  );
  await rejectsArchive([{ name: "large", bytes: "12" }], "SSH_ARCHIVE_LIMIT", {
    maxFileBytes: 1,
  });
  await rejectsArchive(
    [
      { name: "one", bytes: "1" },
      { name: "two", bytes: "2" },
    ],
    "SSH_ARCHIVE_LIMIT",
    { maxTotalBytes: 1 },
  );
});

test("archive digest drift and import failure leave no snapshot residue", async () => {
  const transfer = await fixtureTransfer();
  const snapshots = path.join(transfer.root, "snapshots");
  const { helper } = successHelper(transfer, {
    acquire: {
      sourceCommandId: "source-command-1",
      state: "SUCCEEDED",
      sanitizedLocator: "example.test/owner/repository",
      resolvedCommitSha: "a".repeat(40),
      snapshotId: "snapshot-1",
      manifestDigest: transfer.manifestDigest,
      archiveDigest: sha256("wrong"),
      beforeSourceDigest: sha256("before"),
      afterSourceDigest: sha256("before"),
      limitationCodes: [],
    },
    finalize: {
      sourceCommandId: "source-command-1",
      state: "SUCCEEDED",
      snapshotId: "snapshot-1",
      manifestDigest: transfer.manifestDigest,
      archiveDigest: sha256("wrong"),
      receipt: { artifactId: "artifact-1" },
    },
  });
  const flow = createFixtureSshSourceFlow({
    mode: "fixture-test-only",
    helperClient: helper,
  });
  await assert.rejects(
    flow.execute({
      source,
      context,
      snapshotStore: snapshots,
      limits: { pollIntervalMs: 0 },
    }),
    (error) => error.code === "SSH_ARCHIVE_DIGEST_MISMATCH",
  );
  assert.deepEqual(await readdir(snapshots), []);
});

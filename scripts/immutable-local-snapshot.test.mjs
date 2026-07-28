import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  captureImmutableLocalIdentity,
  createImmutableLocalSnapshot,
  ImmutableSnapshotError,
  verifyImmutableLocalSnapshot,
} from "./immutable-local-snapshot.mjs";

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-snapshot-test-"));
  const registeredRoot = path.join(root, "registered");
  const source = path.join(registeredRoot, "repo");
  const outputRoot = path.join(root, "generated");
  await mkdir(source, { recursive: true });
  await mkdir(outputRoot);
  return { root, registeredRoot, source, outputRoot };
}

async function withFixture(callback) {
  const value = await fixture();
  try {
    return await callback(value);
  } finally {
    await execFileAsync("chmod", ["-R", "u+w", value.root]).catch(() => {});
    await rm(value.root, { recursive: true, force: true });
  }
}

function request(value, snapshotName = "snapshot-1") {
  return {
    registeredRoot: value.registeredRoot,
    relativePath: "repo",
    outputRoot: value.outputRoot,
    snapshotName,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ImmutableSnapshotError);
    assert.equal(error.code, code);
    return true;
  });
}

test("captures dirty and untracked bytes, records exclusions, and freezes a strict snapshot", async () =>
  withFixture(async (value) => {
    await mkdir(path.join(value.source, "src"));
    await writeFile(path.join(value.source, "tracked.txt"), "dirty working tree\n");
    await writeFile(path.join(value.source, "untracked.txt"), "untracked\n");
    await writeFile(path.join(value.source, "src", "run.sh"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    await mkdir(path.join(value.source, ".git"));
    await writeFile(path.join(value.source, ".git", "secret"), "git-control");
    await mkdir(path.join(value.source, "generated"));
    await writeFile(path.join(value.source, "generated", "prior"), "prior output");
    await symlink("tracked.txt", path.join(value.source, "safe-link"));
    const before = await readFile(path.join(value.source, "tracked.txt"));

    const result = await createImmutableLocalSnapshot(request(value));
    assert.equal(result.profile, "rak-immutable-local-snapshot/1.0.0");
    assert.equal(
      await readFile(path.join(result.snapshotRoot, "tracked.txt"), "utf8"),
      "dirty working tree\n",
    );
    assert.equal(
      await readFile(path.join(result.snapshotRoot, "untracked.txt"), "utf8"),
      "untracked\n",
    );
    assert.equal(await readlink(path.join(result.snapshotRoot, "safe-link")), "tracked.txt");
    await assert.rejects(access(path.join(result.snapshotRoot, ".git")));
    assert.equal(
      await readFile(path.join(result.snapshotRoot, "generated", "prior"), "utf8"),
      "prior output",
    );
    assert.deepEqual(result.manifest.payload.excluded, [
      { path: ".git", reason: "git-control-path" },
    ]);
    assert.ok(
      result.manifest.payload.entries.some(
        (entry) => entry.path === "untracked.txt" && entry.type === "file",
      ),
    );
    assert.deepEqual(await readFile(path.join(value.source, "tracked.txt")), before);
    assert.equal((await lstat(result.snapshotRoot)).mode & 0o222, 0);
    assert.equal((await lstat(path.join(result.snapshotRoot, "tracked.txt"))).mode & 0o222, 0);
    const manifestBytes = await readFile(result.manifestPath);
    assert.equal(
      result.manifestDigest,
      `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
    );
    const verification = await verifyImmutableLocalSnapshot({
      snapshotRoot: result.snapshotRoot,
      manifest: result.manifest,
    });
    assert.equal(verification.readOnly, true);
    assert.equal(verification.manifestDigest, result.manifestDigest);
  }));

test("independent no-follow reverification detects same-uid post-capture tampering", async () =>
  withFixture(async (value) => {
    await writeFile(path.join(value.source, "file.txt"), "admitted");
    const result = await createImmutableLocalSnapshot(request(value));
    const copied = path.join(result.snapshotRoot, "file.txt");
    await chmod(copied, 0o600);
    await writeFile(copied, "tampered");
    await expectCode(
      verifyImmutableLocalSnapshot({
        snapshotRoot: result.snapshotRoot,
        manifest: result.manifest,
      }),
      "SNAPSHOT_REREAD_MISMATCH",
    );
  }));

test("identity-only capture equals the copied snapshot manifest without writing payload bytes", async () =>
  withFixture(async (value) => {
    await mkdir(path.join(value.source, "generated"));
    await writeFile(path.join(value.source, "generated", "customer.txt"), "customer output");
    await writeFile(path.join(value.source, "dirty.txt"), "dirty and untracked");
    await symlink("dirty.txt", path.join(value.source, "safe-link"));

    const identity = await captureImmutableLocalIdentity({ sourceRoot: value.source });
    const snapshot = await createImmutableLocalSnapshot(request(value));

    assert.equal(identity.profile, "rak-immutable-local-identity/1.0.0");
    assert.deepEqual(identity.manifest, snapshot.manifest);
    assert.equal(identity.manifestDigest, snapshot.manifestDigest);
    assert.match(identity.sourceStateDigest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(identity.sourceState.entries.length > 0);
    assert.equal(
      await readFile(path.join(snapshot.snapshotRoot, "generated", "customer.txt"), "utf8"),
      "customer output",
    );
  }));

test("identity-only capture rejects concurrent outside-symlink swapping without copying residue", async () =>
  withFixture(async (value) => {
    const victim = path.join(value.source, "victim.bin");
    const alternate = path.join(value.source, "alternate");
    const staging = path.join(value.source, "staging");
    const outside = path.join(value.root, "outside-sentinel");
    const sentinel = Buffer.from("OUTSIDE-SENTINEL");
    await writeFile(victim, Buffer.alloc(12 * 1024 * 1024, 0x42));
    await writeFile(outside, sentinel);
    await symlink(outside, alternate);
    let stop = false;
    const swapper = (async () => {
      while (!stop) {
        try {
          await rename(victim, staging);
          await rename(alternate, victim);
          await rename(staging, alternate);
          await rename(victim, staging);
          await rename(alternate, victim);
          await rename(staging, alternate);
        } catch {
          // Deliberate gaps are safe typed failures.
        }
      }
    })();
    let identity;
    let rejection;
    try {
      identity = await captureImmutableLocalIdentity({ sourceRoot: value.source });
    } catch (error) {
      rejection = error;
    } finally {
      stop = true;
      await swapper;
    }
    if (identity) {
      const sentinelDigest = `sha256:${createHash("sha256").update(sentinel).digest("hex")}`;
      const victimEntry = identity.manifest.payload.entries.find(
        (entry) => entry.path === "victim.bin",
      );
      assert.notEqual(victimEntry?.sha256, sentinelDigest);
      assert.deepEqual(await readdir(value.outputRoot), []);
    } else {
      assert.ok(rejection instanceof ImmutableSnapshotError);
      assert.ok(
        ["SOURCE_RACE_OR_ESCAPE", "SOURCE_MUTATED_DURING_CAPTURE", "ESCAPING_SYMLINK"].includes(
          rejection.code,
        ),
        rejection.code,
      );
    }
  }));

test("rejects hardlinks and FIFOs", async () => {
  await withFixture(async (value) => {
    await writeFile(path.join(value.source, "first"), "same inode");
    await link(path.join(value.source, "first"), path.join(value.source, "second"));
    await expectCode(createImmutableLocalSnapshot(request(value)), "HARDLINK_AMBIGUITY");
  });
  await withFixture(async (value) => {
    await execFileAsync("mkfifo", [path.join(value.source, "pipe")]);
    await expectCode(createImmutableLocalSnapshot(request(value)), "SPECIAL_FILE_REJECTED");
  });
});

test("rejects absolute and escaping symbolic links without following them", async () => {
  await withFixture(async (value) => {
    await symlink("/etc/passwd", path.join(value.source, "absolute"));
    await expectCode(createImmutableLocalSnapshot(request(value)), "ESCAPING_SYMLINK");
  });
  await withFixture(async (value) => {
    await symlink("../outside", path.join(value.source, "escape"));
    await expectCode(createImmutableLocalSnapshot(request(value)), "ESCAPING_SYMLINK");
  });
});

test("rejects case and NFC path collisions", async () => {
  await withFixture(async (value) => {
    await writeFile(path.join(value.source, "Readme"), "one");
    await writeFile(path.join(value.source, "README"), "two");
    await expectCode(createImmutableLocalSnapshot(request(value)), "CASE_UNICODE_PATH_COLLISION");
  });
  await withFixture(async (value) => {
    await writeFile(path.join(value.source, "\u00e9"), "composed");
    await writeFile(path.join(value.source, "e\u0301"), "decomposed");
    await expectCode(createImmutableLocalSnapshot(request(value)), "UNICODE_PATH_COLLISION");
  });
});

test("detects a regular-file mutation followed by byte restoration", async () =>
  withFixture(async (value) => {
    const target = path.join(value.source, "mutable.txt");
    await writeFile(target, "original");
    const original = await readFile(target);
    await expectCode(
      createImmutableLocalSnapshot({
        ...request(value),
        testHooks: {
          async afterCapture() {
            await writeFile(target, "changed!");
            await writeFile(target, original);
          },
        },
      }),
      "SOURCE_MUTATED_DURING_CAPTURE",
    );
    assert.deepEqual(await readFile(target), original);
  }));

test("held descriptors defeat a parent-directory symlink swap", async () =>
  withFixture(async (value) => {
    await writeFile(path.join(value.source, "inside.txt"), "trusted-inside");
    const outside = path.join(value.root, "outside");
    const parked = path.join(value.root, "parked-registered");
    await mkdir(path.join(outside, "repo"), { recursive: true });
    await writeFile(path.join(outside, "repo", "sentinel.txt"), "OUTSIDE-SENTINEL");

    const result = await createImmutableLocalSnapshot({
      ...request(value),
      testHooks: {
        async afterCapture() {
          await rename(value.registeredRoot, parked);
          await symlink(outside, value.registeredRoot);
        },
      },
    });
    assert.equal(
      await readFile(path.join(result.snapshotRoot, "inside.txt"), "utf8"),
      "trusted-inside",
    );
    await assert.rejects(access(path.join(result.snapshotRoot, "sentinel.txt")));
    await rm(value.registeredRoot);
    await rename(parked, value.registeredRoot);
  }));

test("concurrent regular-file to outside-symlink swapping never admits outside bytes", async () =>
  withFixture(async (value) => {
    const victim = path.join(value.source, "victim.bin");
    const alternate = path.join(value.source, "alternate");
    const staging = path.join(value.source, "staging");
    const outside = path.join(value.root, "outside-sentinel");
    await writeFile(victim, Buffer.alloc(12 * 1024 * 1024, 0x41));
    await writeFile(outside, "OUTSIDE-SENTINEL");
    await symlink(outside, alternate);
    let stop = false;
    const swapper = (async () => {
      while (!stop) {
        try {
          await rename(victim, staging);
          await rename(alternate, victim);
          await rename(staging, alternate);
          await rename(victim, staging);
          await rename(alternate, victim);
          await rename(staging, alternate);
        } catch {
          // Capture may observe a deliberate gap and reject. Continue until it settles.
        }
      }
    })();
    let result;
    let rejection;
    try {
      result = await createImmutableLocalSnapshot(request(value));
    } catch (error) {
      rejection = error;
    } finally {
      stop = true;
      await swapper;
    }
    if (result) {
      const copied = await readFile(path.join(result.snapshotRoot, "victim.bin"));
      assert.equal(copied.includes(Buffer.from("OUTSIDE-SENTINEL")), false);
    } else {
      assert.ok(rejection instanceof ImmutableSnapshotError);
      assert.ok(
        ["SOURCE_RACE_OR_ESCAPE", "SOURCE_MUTATED_DURING_CAPTURE", "ESCAPING_SYMLINK"].includes(
          rejection.code,
        ),
        rejection.code,
      );
    }
  }));

test("fails closed for an output path inside source and for an existing destination", async () => {
  await withFixture(async (value) => {
    await mkdir(path.join(value.source, "generated"));
    await expectCode(
      createImmutableLocalSnapshot({
        ...request(value),
        outputRoot: path.join(value.source, "generated"),
      }),
      "OUTPUT_INSIDE_SOURCE",
    );
  });
  await withFixture(async (value) => {
    await writeFile(path.join(value.source, "file"), "content");
    await mkdir(path.join(value.outputRoot, "snapshot-1"));
    await expectCode(createImmutableLocalSnapshot(request(value)), "SNAPSHOT_DESTINATION_EXISTS");
  });
});

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { TargetSnapshot } from "@rak/contracts";
import type { RakStore, StoredRun } from "@rak/persistence";

interface LocalSource {
  kind: "local";
  sourceHandleId: string;
  relativePath: string;
  mode: "commit-only" | "frozen-working-tree";
}

function sha256(bytes: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function git(repository: string, arguments_: string[]): Buffer {
  return execFileSync("git", ["-C", repository, ...arguments_], {
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: "/nonexistent",
      LC_ALL: "C",
    },
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assertContained(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(root, rel) !== candidate) {
    throw new Error("SOURCE_HANDLE_INVALID");
  }
}

function listWorkingFiles(repository: string): string[] {
  return git(repository, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function captureWorkingManifest(repository: string, artifactRoot?: string) {
  const entries: Array<{ path: string; kind: "file" | "symlink"; bytes: string; digest: string }> =
    [];
  for (const path of listWorkingFiles(repository)) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
      throw new Error("SOURCE_PATH_INVALID");
    }
    const absolute = join(repository, ...path.split("/"));
    assertContained(repository, absolute);
    const before = lstatSync(absolute);
    if (!before.isFile() && !before.isSymbolicLink()) throw new Error("SOURCE_TYPE_UNSAFE");
    if (before.isSymbolicLink()) {
      const target = readlinkSync(absolute);
      if (target.startsWith("/") || target.includes("\0")) throw new Error("SOURCE_SYMLINK_UNSAFE");
      const resolvedTarget = resolve(dirname(absolute), target);
      try {
        assertContained(repository, resolvedTarget);
      } catch {
        throw new Error("SOURCE_SYMLINK_UNSAFE");
      }
    }
    const content = before.isSymbolicLink()
      ? Buffer.from(readlinkSync(absolute))
      : readFileSync(absolute);
    const after = lstatSync(absolute);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new Error("SOURCE_MUTATED_DURING_CAPTURE");
    }
    const digest = sha256(content);
    entries.push({
      path,
      kind: before.isSymbolicLink() ? "symlink" : "file",
      bytes: String(content.byteLength),
      digest,
    });
    if (artifactRoot) {
      const objectPath = join(artifactRoot, "objects", digest.slice("sha256:".length));
      mkdirSync(dirname(objectPath), { recursive: true, mode: 0o700 });
      try {
        const descriptor = openSync(
          objectPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o400,
        );
        writeFileSync(descriptor, content);
        closeSync(descriptor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (sha256(readFileSync(objectPath)) !== digest)
          throw new Error("SNAPSHOT_OBJECT_COLLISION");
      }
    }
  }
  return entries;
}

function statusPaths(repository: string): string[] {
  return git(repository, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .sort();
}

function captureSourceState(repository: string) {
  const commit = git(repository, ["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"])
    .toString("utf8")
    .trim();
  const index = git(repository, ["ls-files", "--stage", "-z"]);
  const status = git(repository, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = captureWorkingManifest(repository);
  return {
    commit,
    indexDigest: sha256(index),
    statusDigest: sha256(status),
    entries,
  };
}

export function createLocalSnapshotResolver(input: {
  store: RakStore;
  snapshotRoot: string;
  now?: () => Date;
}): (run: StoredRun) => TargetSnapshot {
  const now = input.now ?? (() => new Date());
  return (run) => {
    const source = run.source as LocalSource;
    if (source.kind !== "local") throw new Error("SSH_ACQUISITION_WORKER_REQUIRED");
    const registeredRoot = input.store.getSourceHandleRoot(source.sourceHandleId);
    if (!registeredRoot) throw new Error("SOURCE_HANDLE_INVALID");
    const root = realpathSync(registeredRoot);
    const repository = realpathSync(join(root, ...source.relativePath.split("/")));
    assertContained(root, repository);
    const commitSha = git(repository, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      "HEAD^{commit}",
    ])
      .toString("utf8")
      .trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commitSha)) {
      throw new Error("SOURCE_COMMIT_INVALID");
    }
    const beforeState = captureSourceState(repository);
    const beforeEntries = beforeState.entries;
    const beforeSourceDigest = sha256(JSON.stringify(beforeState));
    const dirtyPaths = statusPaths(repository);
    mkdirSync(input.snapshotRoot, { recursive: true, mode: 0o700 });
    const staging = join(input.snapshotRoot, `.staging-${process.pid}-${Date.now()}`);
    mkdirSync(staging, { recursive: false, mode: 0o700 });
    let manifest: unknown;
    let archiveDigest: `sha256:${string}`;
    if (source.mode === "commit-only") {
      const archivePath = join(staging, "snapshot.tar");
      git(repository, ["archive", "--format=tar", `--output=${archivePath}`, commitSha]);
      archiveDigest = sha256(readFileSync(archivePath));
      manifest = {
        version: "rak-snapshot-manifest/1.0.0",
        mode: source.mode,
        commitSha,
        tree: git(repository, ["ls-tree", "-r", "-z", "--full-tree", commitSha]).toString("base64"),
      };
    } else {
      const entries = captureWorkingManifest(repository, staging);
      manifest = {
        version: "rak-snapshot-manifest/1.0.0",
        mode: source.mode,
        commitSha,
        entries,
      };
      archiveDigest = sha256(JSON.stringify(manifest));
    }
    const manifestJson = JSON.stringify(manifest);
    const manifestDigest = sha256(manifestJson);
    writeFileSync(join(staging, "manifest.json"), manifestJson, {
      encoding: "utf8",
      mode: 0o400,
      flag: "wx",
    });
    const afterSourceDigest = sha256(JSON.stringify(captureSourceState(repository)));
    if (beforeSourceDigest !== afterSourceDigest) throw new Error("SOURCE_MUTATED_DURING_CAPTURE");
    const finalPath = join(input.snapshotRoot, manifestDigest.slice("sha256:".length));
    renameSync(staging, finalPath);
    const attributes = beforeEntries.find((entry) => entry.path === ".gitattributes");
    const lfs =
      attributes && readFileSync(join(repository, ".gitattributes"), "utf8").includes("filter=lfs")
        ? "pointers-only"
        : "not-present";
    const hasSubmodules = git(repository, ["ls-files", "--stage"])
      .toString("utf8")
      .split("\n")
      .some((line) => line.startsWith("160000 "));
    return {
      schemaVersion: "1.0.0",
      snapshotId: manifestDigest,
      sourceKind: "local",
      sanitizedLocator: `${source.sourceHandleId}/${source.relativePath}`,
      gitObjectFormat: commitSha.length === 40 ? "sha1" : "sha256",
      commitSha,
      baseCommitSha: commitSha,
      mode: source.mode,
      manifestBlobId: `blb_${manifestDigest.slice(-32)}`,
      manifestDigest,
      archiveDigest,
      beforeSourceDigest,
      afterSourceDigest,
      includedDirtyPaths: source.mode === "frozen-working-tree" ? dirtyPaths : [],
      excludedDirtyPaths: source.mode === "commit-only" ? dirtyPaths : [],
      submodules: hasSubmodules ? "pointers-only" : "not-present",
      lfs,
      createdAt: now().toISOString(),
    };
  };
}

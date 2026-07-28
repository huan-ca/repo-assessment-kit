import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RakStore, type StoredRun } from "@rak/persistence";
import { createDraftRun } from "@rak/workflow";
import { createLocalSnapshotResolver } from "./local-acquisition.js";

describe("fixed local acquisition", () => {
  it("captures a commit-bound immutable archive without changing the source", () => {
    const root = mkdtempSync(join(tmpdir(), "rak-source-"));
    const repository = join(root, "repository");
    mkdirSync(repository);
    execFileSync("git", ["init", "-q", repository]);
    execFileSync("git", ["-C", repository, "config", "user.email", "fixture@example.invalid"]);
    execFileSync("git", ["-C", repository, "config", "user.name", "Fixture"]);
    writeFileSync(join(repository, "README.md"), "fixture\n");
    execFileSync("git", ["-C", repository, "add", "README.md"]);
    execFileSync("git", ["-C", repository, "commit", "-qm", "fixture"]);
    writeFileSync(join(repository, "untracked.txt"), "not in commit archive\n");
    const beforeStatus = execFileSync("git", [
      "-C",
      repository,
      "status",
      "--porcelain",
    ]).toString();
    const store = new RakStore();
    store.addSourceHandle(
      {
        sourceHandleId: "src_fixture",
        kind: "local",
        displayName: "Fixture",
        allowedRootFingerprint: `sha256:${"a".repeat(64)}`,
        registeredAt: "2026-07-28T00:00:00.000Z",
      },
      root,
    );
    const run: StoredRun = {
      run: createDraftRun({
        runId: "run_01982c12-2a00-7000-8000-000000000001",
        projectSlug: "fixture",
        provider: "codex",
        now: "2026-07-28T00:00:00.000Z",
      }),
      engagementId: "eng_fixture",
      source: {
        kind: "local",
        sourceHandleId: "src_fixture",
        relativePath: "repository",
        mode: "commit-only",
      },
      selectedProfiles: [],
      optionalServiceIds: [],
    };
    const snapshotRoot = join(root, "snapshots");
    const snapshot = createLocalSnapshotResolver({
      store,
      snapshotRoot,
      now: () => new Date("2026-07-28T00:00:00.000Z"),
    })(run);
    expect(snapshot.beforeSourceDigest).toBe(snapshot.afterSourceDigest);
    expect(snapshot.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.excludedDirtyPaths).toContain("untracked.txt");
    expect(
      readFileSync(
        join(snapshotRoot, snapshot.manifestDigest.slice("sha256:".length), "snapshot.tar"),
      ).byteLength,
    ).toBeGreaterThan(0);
    expect(execFileSync("git", ["-C", repository, "status", "--porcelain"]).toString()).toBe(
      beforeStatus,
    );
    store.close();
  });

  it("requires the typed acquisition worker for SSH sources", () => {
    const store = new RakStore();
    const run: StoredRun = {
      run: createDraftRun({
        runId: "run_01982c12-2a00-7000-8000-000000000002",
        projectSlug: "fixture",
        provider: "codex",
        now: "2026-07-28T00:00:00.000Z",
      }),
      engagementId: "eng_fixture",
      source: { kind: "ssh-git", sshHandleId: "ssh_fixture", url: "git@example.invalid:repo" },
      selectedProfiles: [],
      optionalServiceIds: [],
    };
    expect(() =>
      createLocalSnapshotResolver({ store, snapshotRoot: join(tmpdir(), "unused") })(run),
    ).toThrow("SSH_ACQUISITION_WORKER_REQUIRED");
    store.close();
  });

  it("rejects an escaping tracked symlink without changing the source", () => {
    const root = mkdtempSync(join(tmpdir(), "rak-symlink-source-"));
    const repository = join(root, "repository");
    mkdirSync(repository);
    execFileSync("git", ["init", "-q", repository]);
    execFileSync("git", ["-C", repository, "config", "user.email", "fixture@example.invalid"]);
    execFileSync("git", ["-C", repository, "config", "user.name", "Fixture"]);
    writeFileSync(join(root, "outside-secret"), "outside\n");
    symlinkSync("../../outside-secret", join(repository, "escape"));
    execFileSync("git", ["-C", repository, "add", "escape"]);
    execFileSync("git", ["-C", repository, "commit", "-qm", "escaping symlink"]);
    const beforeStatus = execFileSync("git", [
      "-C",
      repository,
      "status",
      "--porcelain=v1",
    ]).toString();
    const store = new RakStore();
    store.addSourceHandle(
      {
        sourceHandleId: "src_symlink",
        kind: "local",
        displayName: "Symlink fixture",
        allowedRootFingerprint: `sha256:${"b".repeat(64)}`,
        registeredAt: "2026-07-28T00:00:00.000Z",
      },
      root,
    );
    const run: StoredRun = {
      run: createDraftRun({
        runId: "run_01982c12-2a00-7000-8000-000000000003",
        projectSlug: "symlink-fixture",
        provider: "codex",
        now: "2026-07-28T00:00:00.000Z",
      }),
      engagementId: "eng_fixture",
      source: {
        kind: "local",
        sourceHandleId: "src_symlink",
        relativePath: "repository",
        mode: "frozen-working-tree",
      },
      selectedProfiles: [],
      optionalServiceIds: [],
    };
    expect(() =>
      createLocalSnapshotResolver({ store, snapshotRoot: join(root, "snapshots") })(run),
    ).toThrow("SOURCE_SYMLINK_UNSAFE");
    expect(execFileSync("git", ["-C", repository, "status", "--porcelain=v1"]).toString()).toBe(
      beforeStatus,
    );
    store.close();
  });
});

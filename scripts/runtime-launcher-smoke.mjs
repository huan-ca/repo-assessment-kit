#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "rak-launcher-smoke-"));
const fakeBin = path.join(temporary, "bin");
const dockerLog = path.join(temporary, "docker.log");
const realNode = process.execPath;
try {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(fakeBin, { mode: 0o700 }));
  const nodeHarness = `#!/bin/sh
set -eu
case "\${1:-}" in
  */scripts/verify-release-assets.mjs)
    output=
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --output ]; then output=$2; break; fi
      shift
    done
    test -n "$output"
    printf '%s\\n' '{"profile":"rak-verified-release/1.0.0","verified":true,"images":{"codex":{"immutableReference":"registry.invalid/rak-codex@sha256:${"1".repeat(64)}"},"claude":{"immutableReference":"registry.invalid/rak-claude@sha256:${"2".repeat(64)}"},"acquisition":{"immutableReference":"registry.invalid/rak-acquisition@sha256:${"3".repeat(64)}"}}}' >"$output"
    exit 0
    ;;
  */scripts/verify-network-attestation.mjs) exit 0 ;;
esac
exec ${JSON.stringify(realNode)} "$@"
`;
  const dockerHarness = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >>"$RAK_FAKE_DOCKER_LOG"
case "\${1:-}:\${2:-}" in
  info:) exit 0 ;;
  info:--format) printf '%s\\n' '["name=rootless"]'; exit 0 ;;
  image:inspect)
    case "$*" in
      *io.repo-assessment-kit.provider*) printf '%s\\n' "\${RAK_FAKE_PROVIDER_LABEL:-codex}" ;;
      *) printf '%s\\n' 'sha256:${"4".repeat(64)}' ;;
    esac
    exit 0
    ;;
  network:inspect) printf '%s\\n' '${"5".repeat(64)}'; exit 0 ;;
  create:*) printf '%s\\n' rak-fake-container; exit 0 ;;
  start:*|cp:*|rm:*) exit 0 ;;
  run:*) exit 0 ;;
esac
exit 1
`;
  writeFileSync(path.join(fakeBin, "node"), nodeHarness, { mode: 0o700 });
  writeFileSync(path.join(fakeBin, "docker"), dockerHarness, { mode: 0o700 });
  chmodSync(path.join(fakeBin, "node"), 0o700);
  chmodSync(path.join(fakeBin, "docker"), 0o700);

  const commonEnv = {
    PATH: `${fakeBin}:${path.dirname(realNode)}:/usr/bin:/bin`,
    RAK_ENGAGEMENT_ID: "engagement-smoke",
    RAK_FAKE_DOCKER_LOG: dockerLog,
  };
  const status = spawnSync(path.join(root, "start-codex.sh"), ["status"], {
    cwd: root,
    encoding: "utf8",
    env: commonEnv,
  });
  assert.equal(status.status, 0, status.stderr);
  const dockerCalls = readFileSync(dockerLog, "utf8");
  assert.match(dockerCalls, /--network none/u);
  assert.match(dockerCalls, /rak-engagement-smoke-codex-home-v1:\/home\/node/u);
  assert.match(
    dockerCalls,
    new RegExp(`registry\\.invalid/rak-codex@sha256:${"1".repeat(64)}`, "u"),
  );
  assert.doesNotMatch(dockerCalls, /rak-codex:0\.1\.0/u);
  assert.doesNotMatch(dockerCalls, /docker\.sock|--privileged|--cap-add|--volume \//u);

  const relabeled = spawnSync(path.join(root, "start-codex.sh"), ["status"], {
    cwd: root,
    encoding: "utf8",
    env: { ...commonEnv, RAK_FAKE_PROVIDER_LABEL: "attacker-controlled" },
  });
  assert.equal(relabeled.status, 77);
  assert.match(relabeled.stderr, /code=provider_image_identity_mismatch/u);

  const extra = spawnSync(path.join(root, "start-codex.sh"), ["status", "--verbose"], {
    cwd: root,
    encoding: "utf8",
    env: commonEnv,
  });
  assert.equal(extra.status, 64);

  const badEngagement = spawnSync(path.join(root, "start-codex.sh"), ["status"], {
    cwd: root,
    encoding: "utf8",
    env: { ...commonEnv, RAK_ENGAGEMENT_ID: "../../shared" },
  });
  assert.equal(badEngagement.status, 78);
  assert.match(badEngagement.stderr, /code=invalid_engagement_id/u);

  const resumeEscape = spawnSync(
    path.join(root, "start-codex.sh"),
    ["resume", "--run-dir", temporary],
    { cwd: root, encoding: "utf8", env: commonEnv },
  );
  assert.equal(resumeEscape.status, 78);
  assert.match(resumeEscape.stderr, /code=invalid_release_run_directory/u);

  const capabilitySource = readFileSync(path.join(root, "scripts/runtime-capability.sh"), "utf8");
  assert.doesNotMatch(capabilitySource, /awk -F: "\$3/u);
  assert.match(capabilitySource, /awk -F: .*'\$3 >= 65536/u);

  const source = path.join(temporary, "source");
  const output = path.join(temporary, "output");
  mkdirSync(source);
  mkdirSync(output);
  const gitInit = spawnSync("git", ["init", "-q", source], { encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const localAcquisition = spawnSync(
    path.join(root, "scripts/acquire-source.sh"),
    ["local", source, "HEAD", output],
    { cwd: root, encoding: "utf8", env: commonEnv },
  );
  assert.equal(localAcquisition.status, 78);
  assert.match(localAcquisition.stderr, /LOCAL_FROZEN_SNAPSHOT_HELPER_REQUIRED/u);

  const keyDirectory = path.join(temporary, "key");
  const hostsDirectory = path.join(temporary, "hosts");
  const sshOutput = path.join(temporary, "ssh-output");
  mkdirSync(keyDirectory);
  mkdirSync(hostsDirectory);
  mkdirSync(sshOutput);
  const key = path.join(keyDirectory, "deploy-key");
  const knownHosts = path.join(hostsDirectory, "known_hosts");
  writeFileSync(key, "test-only-key", { mode: 0o600 });
  writeFileSync(knownHosts, "example.invalid ssh-ed25519 test-only", { mode: 0o600 });
  const acquisition = spawnSync(
    path.join(root, "scripts/acquire-source.sh"),
    ["ssh", "git@example.invalid:owner/repository.git", "main", key, knownHosts, sshOutput],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...commonEnv,
        RAK_GIT_NETWORK: "rak-git-egress",
        RAK_GIT_NETWORK_NONCE: "6".repeat(64),
        RAK_GIT_EGRESS_ATTESTATION: path.join(temporary, "attestation.json"),
      },
    },
  );
  assert.equal(acquisition.status, 0, acquisition.stderr);
  const acquisitionCalls = readFileSync(dockerLog, "utf8");
  assert.match(
    acquisitionCalls,
    new RegExp(`registry\\.invalid/rak-acquisition@sha256:${"3".repeat(64)}`, "u"),
  );
  assert.doesNotMatch(acquisitionCalls, /rak-acquisition:0\.1\.0/u);
  assert.match(acquisitionCalls, /--network rak-git-egress/u);
  assert.match(acquisitionCalls, /:\/run\/secrets\/key:ro/u);
  assert.match(acquisitionCalls, /:\/run\/secrets\/known_hosts:ro/u);
  assert.doesNotMatch(acquisitionCalls, /:\/source:ro/u);
  assert.doesNotMatch(acquisitionCalls, /docker\.sock|--privileged|--cap-add/u);

  process.stdout.write("runtime launcher closed-surface smoke passed\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

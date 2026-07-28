import {
  chmod,
  chown,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  providerEndpoints,
  verifyNetworkAttestation,
} from "../scripts/lib/network-attestation.mjs";

const root = path.resolve(import.meta.dirname, "..");
const run = (file: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) =>
  spawnSync("/bin/bash", [path.join(root, file), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("provider launcher policy", () => {
  it("provides one plain-language customer entry point", async () => {
    const launcher = await readFile(path.join(root, "start.sh"), "utf8");
    expect(launcher).toContain("Recommended mode:");
    expect(launcher).toContain("generated/preflight-latest.json");
    expect(launcher).toContain("guided-rootless-docker.sh");
    expect(launcher).toContain('launcher="$repo_root/start-cc.sh"');
    expect(launcher).toContain('launcher="$repo_root/start-codex.sh"');

    const result = run("start.sh", [], { RAK_PROVIDER: "unsupported" });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("Provider must be codex or claude.");

    const guided = await readFile(path.join(root, "scripts/guided-rootless-docker.sh"), "utf8");
    expect(guided).toContain("brew install lima");
    expect(guided).toContain("template:docker");
    expect(guided).toContain("name=rootless");
    expect(guided).toContain("docker context use");
    expect(guided).not.toMatch(/docker-rootful|--privileged|sudo /u);
  });

  it.each([
    ["start-codex.sh", "--dangerously-bypass-approvals-and-sandbox"],
    ["start-cc.sh", "--dangerously-skip-permissions"],
    ["start-codex.sh", "--sandbox"],
    ["start-cc.sh", "--permission-mode"],
  ])("rejects trailing provider flag %s %s", (launcher, flag) => {
    const result = run(launcher, ["interactive", flag]);
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("trailing provider arguments are not accepted");
  });

  it("requires a locally built provider image", () => {
    const result = run("start-codex.sh", ["interactive"]);
    expect([69, 77]).toContain(result.status);
    expect(result.stderr).not.toContain("signed release bundle");
  });

  it.each(["run", "resume"])("refuses unbrokered %s", (verb) => {
    const result = run("start-codex.sh", [verb]);
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("requires the P5 task broker");
  });

  it("provider compose has home-only, offline services", async () => {
    const compose = await readFile(path.join(root, "container/compose.yaml"), "utf8");
    expect(compose).toContain("network_mode: none");
    expect(compose).not.toMatch(/ports:|generated|state|\/source|\.ssh|docker\.sock/u);
    expect(compose.match(/\/home\/node/gu)).toHaveLength(2);
  });

  it("packages Playwright in a separate optional browser compartment", async () => {
    const dockerfile = await readFile(path.join(root, "container/Dockerfile.browser"), "utf8");
    const probe = await readFile(path.join(root, "container/browser-probe.mjs"), "utf8");
    const preflight = await readFile(path.join(root, "scripts/runtime-preflight.mjs"), "utf8");

    expect(dockerfile).toContain("@playwright/test@${PLAYWRIGHT_VERSION}");
    expect(dockerfile).toContain("playwright install --with-deps chromium");
    expect(dockerfile).toContain("USER node");
    expect(probe).toContain('process.argv[2] !== "probe"');
    expect(probe).not.toMatch(/goto\(|process\.env|http:/u);
    expect(preflight).toContain('"practical-without-browser"');
    expect(preflight).toContain('"practical-with-browser"');
    expect(preflight).toContain("browserCoverageLimitations");
    expect(preflight).not.toContain('block(\n    "playwright_');
  });

  it("builds and records all containers locally without a signing workflow", async () => {
    const builder = await readFile(path.join(root, "scripts/ensure-local-images.mjs"), "utf8");
    expect(builder).toContain("generated");
    expect(builder).toContain("local-images.json");
    expect(builder).toContain('"rak-codex:0.1.0"');
    expect(builder).toContain('"rak-claude:0.1.0"');
    expect(builder).toContain('"rak-acquisition:0.1.0"');
    expect(builder).toContain('"rak-browser:0.1.0"');
    expect(builder).toContain("sourceFingerprint");
    expect(builder).not.toContain('run("git"');
    const practical = await readFile(path.join(root, "scripts/practical-assessment.mjs"), "utf8");
    const practicalLauncher = await readFile(
      path.join(root, "scripts/practical-assessment.sh"),
      "utf8",
    );
    const customerLauncher = await readFile(path.join(root, "start.sh"), "utf8");
    const practicalLauncherStat = await stat(path.join(root, "scripts/practical-assessment.sh"));
    expect(practical).toContain("Product, customers, and feature-parity catalog");
    expect(practical).toContain("Security assessment");
    expect(practical).toContain("Dynamic verification and screenshots");
    expect(practical).toContain("Independent challenge review");
    expect(practical).toContain("Modernization decision");
    expect(practical).toContain("rak-validate-practical-assessment.mjs");
    expect(practicalLauncher).toContain("--git");
    expect(practicalLauncher).toContain("--ref");
    expect(practicalLauncher).toContain('git "${clone_args[@]}"');
    expect(practicalLauncher).not.toMatch(/eval |sh -c/u);
    expect(practicalLauncherStat.mode & 0o111).not.toBe(0);
    expect(practicalLauncher).toContain("Assessment stopped at line");
    expect(customerLauncher).toContain("https://*|ssh://*|git@*:*)");
    await expect(
      readFile(path.join(root, ".github/workflows/customer-release.yml"), "utf8"),
    ).rejects.toThrow();
  });
});

describe("attestations and native gates", () => {
  const signedFixture = (
    privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
    overrides: Record<string, unknown> = {},
  ) => {
    const now = Date.now();
    const payload = {
      schemaVersion: 1,
      issuer: "rak-host-helper",
      status: "available",
      kind: "provider-inference",
      subject: "codex",
      dockerNetwork: "rak-provider-egress",
      networkId: "1".repeat(64),
      policyDigest: `sha256:${"2".repeat(64)}`,
      allowedEndpoints: providerEndpoints["codex"],
      issuedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      nonce: "3".repeat(64),
      ...overrides,
    };
    return {
      payload,
      signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64url"),
    };
  };

  const expected = (installationRoot: string, overrides: Record<string, unknown> = {}) => ({
    kind: "provider-inference",
    subject: "codex",
    network: "rak-provider-egress",
    networkId: "1".repeat(64),
    nonce: "3".repeat(64),
    installationRoot,
    ...overrides,
  });

  it("rejects unsigned and forged attestations", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rak-attestation-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signed = signedFixture(privateKey);
    expect(() => verifyNetworkAttestation(signed.payload, publicKey, expected(directory))).toThrow(
      /unsigned/u,
    );
    expect(() =>
      verifyNetworkAttestation(
        {
          ...signed,
          signature: `${signed.signature[0] === "A" ? "B" : "A"}${signed.signature.slice(1)}`,
        },
        publicKey,
        expected(directory),
      ),
    ).toThrow(/signature/u);
  });

  it.each([
    ["wrong purpose", { kind: "git-acquisition" }],
    ["wrong subject/host", { subject: "claude-code" }],
    ["wrong network", { network: "unrestricted-bridge" }],
    ["wrong network identity", { networkId: "4".repeat(64) }],
    ["wrong nonce", { nonce: "5".repeat(64) }],
  ])("rejects %s", async (_label, mismatch) => {
    const directory = await mkdtemp(path.join(tmpdir(), "rak-attestation-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    expect(() =>
      verifyNetworkAttestation(signedFixture(privateKey), publicKey, expected(directory, mismatch)),
    ).toThrow(/mismatch/u);
  });

  it("rejects unrelated Git hosts and stale attestations", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rak-attestation-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const stale = signedFixture(privateKey, {
      issuedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    expect(() => verifyNetworkAttestation(stale, publicKey, expected(directory))).toThrow(
      /freshness/u,
    );
    const git = signedFixture(privateKey, {
      kind: "git-acquisition",
      subject: "git@example.com:owner/repo.git",
      allowedEndpoints: [{ host: "unrelated.example", port: 22 }],
    });
    expect(() =>
      verifyNetworkAttestation(
        git,
        publicKey,
        expected(directory, {
          kind: "git-acquisition",
          subject: "git@example.com:owner/repo.git",
        }),
      ),
    ).toThrow(/mismatch/u);
  });

  it("consumes a signed nonce exactly once", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rak-attestation-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signed = signedFixture(privateKey);
    expect(() => verifyNetworkAttestation(signed, publicKey, expected(directory))).not.toThrow();
    expect(() => verifyNetworkAttestation(signed, publicKey, expected(directory))).toThrow(
      /already consumed/u,
    );
  });

  it("refuses symbolic or permissive replay-ledger components without external writes", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signed = signedFixture(privateKey);

    const symbolicInstallation = await mkdtemp(path.join(tmpdir(), "rak-attestation-install-"));
    const external = await mkdtemp(path.join(tmpdir(), "rak-attestation-external-"));
    await symlink(external, path.join(symbolicInstallation, "state"), "dir");
    expect(() =>
      verifyNetworkAttestation(signed, publicKey, expected(symbolicInstallation)),
    ).toThrow(/owner-private|symbolic/u);
    expect(await readdir(external)).toEqual([]);

    const permissiveInstallation = await mkdtemp(path.join(tmpdir(), "rak-attestation-install-"));
    await mkdir(path.join(permissiveInstallation, "state"), { mode: 0o755 });
    expect(() =>
      verifyNetworkAttestation(signed, publicKey, expected(permissiveInstallation)),
    ).toThrow(/owner-private/u);
  });

  it("refuses a replay installation owned by a different account", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signed = signedFixture(privateKey);
    let foreignInstallation = "/";
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      foreignInstallation = await mkdtemp(path.join(tmpdir(), "rak-attestation-foreign-"));
      await chown(foreignInstallation, 65_534, 65_534);
    }
    expect(() =>
      verifyNetworkAttestation(signed, publicKey, expected(foreignInstallation)),
    ).toThrow(/owned/u);
  });

  it("refuses a symbolic replay marker and leaves its external target unchanged", async () => {
    const installation = await mkdtemp(path.join(tmpdir(), "rak-attestation-install-"));
    const external = path.join(
      await mkdtemp(path.join(tmpdir(), "rak-attestation-external-")),
      "sentinel",
    );
    await writeFile(external, "unchanged", { mode: 0o600 });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signed = signedFixture(privateKey);
    verifyNetworkAttestation(signed, publicKey, expected(installation));
    const ledger = path.join(installation, "state/network-attestation-nonces");
    const [marker] = await readdir(ledger);
    expect(marker).toBeDefined();
    await unlink(path.join(ledger, marker!));
    await symlink(external, path.join(ledger, marker!));
    expect(() => verifyNetworkAttestation(signed, publicKey, expected(installation))).toThrow(
      /unsafe|installation-mismatched/u,
    );
    expect(await readFile(external, "utf8")).toBe("unchanged");
  });

  it("production verifier refuses an unsigned operator record", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rak-attestation-cli-"));
    const file = path.join(directory, "network.json");
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        status: "available",
        kind: "provider-inference",
        subject: "codex",
        dockerNetwork: "unrestricted-bridge",
        allowedHosts: ["api.openai.com"],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const refused = spawnSync(
      process.execPath,
      [
        "scripts/verify-network-attestation.mjs",
        "provider-inference",
        "codex",
        "unrestricted-bridge",
        "1".repeat(64),
        "3".repeat(64),
        file,
      ],
      { cwd: root },
    );
    expect(refused.status).toBe(77);
  });

  it("fails a required runtime gate when Lima is unavailable", async () => {
    const emptyPath = await mkdtemp(path.join(tmpdir(), "rak-path-"));
    const result = run("scripts/runtime-capability.sh", ["--require-available"], {
      PATH: emptyPath,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"status":"blocked"');
  });
});

describe("acquisition path containment", () => {
  const makeRepository = async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "rak-source-"));
    spawnSync("git", ["init", "-q", repository]);
    spawnSync("git", ["-C", repository, "config", "user.email", "qa@example.invalid"]);
    spawnSync("git", ["-C", repository, "config", "user.name", "QA"]);
    await writeFile(path.join(repository, "probe.txt"), "probe\n");
    spawnSync("git", ["-C", repository, "add", "probe.txt"]);
    spawnSync("git", ["-C", repository, "commit", "-qm", "initial"]);
    return repository;
  };

  it("rejects output inside source and .git without creating paths", async () => {
    const repository = await makeRepository();
    for (const output of [
      path.join(repository, "output"),
      path.join(repository, ".git", "output"),
    ]) {
      await mkdir(output);
      const result = run("scripts/acquire-source.sh", ["local", repository, "HEAD", output]);
      expect(result.status).toBe(66);
      expect(result.stderr).toContain("must be disjoint");
    }
    const absent = path.join(repository, ".git", "not-created");
    const result = run("scripts/acquire-source.sh", ["local", repository, "HEAD", absent]);
    expect(result.status).toBe(66);
    expect(result.stderr).toContain("must already exist");
  });

  it("rejects output containing source, symlink aliases, and nonempty output", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "rak-parent-"));
    const repository = path.join(parent, "source");
    await mkdir(repository);
    spawnSync("git", ["init", "-q", repository]);
    const containing = run("scripts/acquire-source.sh", ["local", repository, "HEAD", parent]);
    expect(containing.status).toBe(66);

    const realOutput = await mkdtemp(path.join(tmpdir(), "rak-output-"));
    const alias = path.join(parent, "output-alias");
    await symlink(realOutput, alias);
    const aliased = run("scripts/acquire-source.sh", ["local", repository, "HEAD", alias]);
    expect(aliased.status).toBe(66);
    expect(aliased.stderr).toContain("symlink aliases");

    await writeFile(path.join(realOutput, "hostile"), "occupied\n");
    const nonempty = run("scripts/acquire-source.sh", ["local", repository, "HEAD", realOutput]);
    expect(nonempty.status).toBe(66);
    expect(nonempty.stderr).toContain("must be empty");
  });

  it("rejects output overlapping either SSH secret parent", async () => {
    const secretDirectory = await mkdtemp(path.join(tmpdir(), "rak-secrets-"));
    const key = path.join(secretDirectory, "key");
    const knownHosts = path.join(secretDirectory, "known_hosts");
    await writeFile(key, "key\n");
    await chmod(key, 0o600);
    await writeFile(knownHosts, "example.invalid ssh-ed25519 AAAA\n");
    const nestedOutput = path.join(secretDirectory, "output");
    await mkdir(nestedOutput);
    const nested = run("scripts/acquire-source.sh", [
      "ssh",
      "git@example.invalid:owner/repo.git",
      "main",
      key,
      knownHosts,
      nestedOutput,
    ]);
    expect(nested.status).toBe(66);
    expect(nested.stderr).toContain("must be disjoint");
    const parent = run("scripts/acquire-source.sh", [
      "ssh",
      "git@example.invalid:owner/repo.git",
      "main",
      key,
      knownHosts,
      secretDirectory,
    ]);
    expect(parent.status).toBe(66);
  });

  it("keeps the acquisition worker at fixed numeric non-root identity", async () => {
    const dockerfile = await readFile(path.join(root, "container/Dockerfile.acquisition"), "utf8");
    const launcher = await readFile(path.join(root, "scripts/acquire-source.sh"), "utf8");
    const entrypoint = await readFile(
      path.join(root, "container/acquisition-entrypoint.sh"),
      "utf8",
    );
    expect(dockerfile).toContain("USER 10001:10001");
    expect(launcher).not.toContain('--user "$(id -u):$(id -g)"');
    expect(launcher).not.toMatch(/--volume\s+"\$output:\/out/u);
    expect(launcher).toContain("docker cp");
    expect(launcher).not.toContain(":/source:ro");
    expect(launcher).toContain("LOCAL_FROZEN_SNAPSHOT_HELPER_REQUIRED");
    expect(entrypoint).not.toContain("repository=/source");
    expect(entrypoint).toContain('snapshotMode: "immutable-commit"');
  });
});

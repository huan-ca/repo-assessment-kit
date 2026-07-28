import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdtemp, mkdir, rename, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createReleaseManifestFixtureTestOnly,
  HOST_HELPER_INSTALLER_PATH,
  HOST_HELPER_MODULE_PATHS,
  HOST_HELPER_PLATFORM_PATHS,
  HOST_HELPER_SERVICE_PATHS,
} from "./create-release-manifest.mjs";
import {
  serializeVerifiedHostHelperRecord,
  validateHostHelperRelease,
  validateManifest,
  validateReleaseAuthorityFixtureTestOnly,
  verifyAuthority,
} from "./verify-release-assets.mjs";

const sourceCommit = "a".repeat(40);
const tagged = (character) => `sha256:${character.repeat(64)}`;
const images = {
  codex: {
    reference: "rak-codex:0.1.0",
    digest: tagged("1"),
    platforms: ["linux/amd64", "linux/arm64"],
  },
  claude: {
    reference: "rak-claude:0.1.0",
    digest: tagged("2"),
    platforms: ["linux/amd64", "linux/arm64"],
  },
  acquisition: {
    reference: "rak-acquisition:0.1.0",
    digest: tagged("3"),
    platforms: ["linux/amd64", "linux/arm64"],
  },
  browser: {
    reference: "rak-browser:0.1.0",
    digest: tagged("4"),
    platforms: ["linux/amd64", "linux/arm64"],
  },
};

async function writeArtifact(root, relativePath) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `fixture:${relativePath}\n`);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-release-authority-"));
  const paths = [
    HOST_HELPER_INSTALLER_PATH,
    ...Object.values(HOST_HELPER_MODULE_PATHS),
    ...Object.values(HOST_HELPER_SERVICE_PATHS),
    ...Object.values(HOST_HELPER_PLATFORM_PATHS).flatMap(({ node, peerVerifier }) => [
      node,
      peerVerifier,
    ]),
  ];
  await Promise.all(paths.map((relativePath) => writeArtifact(root, relativePath)));
  const manifest = await createReleaseManifestFixtureTestOnly({
    mode: "fixture-test-only",
    root,
    sourceCommit,
    createdAt: "2026-07-28T00:00:00.000Z",
    images,
  });
  return { root, manifest };
}

test("fixture manifest binds every fixed host-helper artifact and validates exact bytes", async () => {
  const { root, manifest } = await fixture();

  assert.equal(validateManifest(manifest), manifest);
  const verified = await validateHostHelperRelease(manifest.hostHelper, root);

  assert.deepEqual(Object.keys(verified.modules), Object.keys(HOST_HELPER_MODULE_PATHS));
  assert.deepEqual(Object.keys(verified.platforms), Object.keys(HOST_HELPER_PLATFORM_PATHS));
  assert.match(verified.installerSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(verified.serviceDefinitions.linux, /^sha256:[0-9a-f]{64}$/u);
  assert.match(verified.serviceDefinitions.macos, /^sha256:[0-9a-f]{64}$/u);
});

test("host-helper verification rejects changed bytes, substituted paths, and open maps", async () => {
  const changed = await fixture();
  await writeFile(path.join(changed.root, HOST_HELPER_MODULE_PATHS.providerTask), "tampered\n");
  await assert.rejects(
    validateHostHelperRelease(changed.manifest.hostHelper, changed.root),
    /providerTask digest mismatch/u,
  );

  const substituted = await fixture();
  substituted.manifest.hostHelper.installer.path = "scripts/not-the-installer.sh";
  await assert.rejects(
    validateHostHelperRelease(substituted.manifest.hostHelper, substituted.root),
    /installer identity is invalid/u,
  );

  const openMap = await fixture();
  openMap.manifest.hostHelper.modules.untrusted = {
    path: "scripts/untrusted.mjs",
    sha256: tagged("9"),
  };
  await assert.rejects(
    validateHostHelperRelease(openMap.manifest.hostHelper, openMap.root),
    /unknown fields: untrusted/u,
  );

  const linked = await fixture();
  await rename(path.join(linked.root, "scripts"), path.join(linked.root, "scripts-real"));
  await symlink("scripts-real", path.join(linked.root, "scripts"));
  await assert.rejects(
    validateHostHelperRelease(linked.manifest.hostHelper, linked.root),
    /path must be canonical within the release bundle/u,
  );
});

test("external Ed25519 authority binds the exact manifest and toolchain digests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "rak-release-signature-"));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ type: "spki", format: "pem" });
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const keyId = `sha256:${createHash("sha256").update(publicKeyDer).digest("hex")}`;
  const manifestSha256 = "4".repeat(64);
  const toolchainLockSha256 = "5".repeat(64);
  const payload = {
    profile: "rak-release-authority/1.0.0",
    manifestSha256,
    toolchainLockSha256,
  };
  const canonical = Buffer.from(
    `{"manifestSha256":"${manifestSha256}","profile":"rak-release-authority/1.0.0","toolchainLockSha256":"${toolchainLockSha256}"}`,
  );
  const envelope = {
    schemaVersion: "1.0.0",
    profile: "rak-release-signature/1.0.0",
    keyId,
    algorithm: "Ed25519",
    payload,
    signature: sign(null, canonical, privateKey).toString("base64"),
  };
  const signaturePath = path.join(root, "release-signature.json");
  const keyPath = path.join(root, "release-signing-public-key.pem");
  await writeFile(signaturePath, JSON.stringify(envelope));
  await writeFile(keyPath, publicKeyBytes);

  assert.equal(
    await verifyAuthority(signaturePath, keyPath, manifestSha256, toolchainLockSha256),
    keyId,
  );
  await assert.rejects(
    verifyAuthority(signaturePath, keyPath, "6".repeat(64), toolchainLockSha256),
    /payload is stale or mismatched/u,
  );
});

test("verified host-helper record is closed, path-free, and line-oriented", () => {
  const digest = tagged("7");
  const record = {
    profile: "rak-verified-host-helper-release/1.0.0",
    verified: true,
    sourceCommit,
    manifestSha256: digest,
    signingKeyId: tagged("8"),
    platform: "linux",
    architecture: "arm64",
    nodeVersion: "v24.4.1",
    nodeSha256: digest,
    peerVerifierSha256: digest,
    installerSha256: digest,
    productionHostHelperSha256: digest,
    hostHelperServiceSha256: digest,
    hostHelperJournalSha256: digest,
    hostHelperOperationsSha256: digest,
    hostHelperProtocolSha256: digest,
    productionInstallationConfigSha256: digest,
    providerTaskSha256: digest,
    installationValidatorSha256: digest,
    serviceEntrypointSha256: digest,
    linuxServiceDefinitionSha256: digest,
    macosServiceDefinitionSha256: digest,
  };

  const serialized = serializeVerifiedHostHelperRecord(record);
  assert.equal(serialized.split("\n")[0], "profile=rak-verified-host-helper-release/1.0.0");
  assert.match(serialized, /\nverified=true\n/u);
  assert.match(serialized, /\ninstallerSha256=sha256:[0-9a-f]{64}\n/u);
  assert.ok(!serialized.includes("path="));
  assert.ok(serialized.endsWith("\n"));
  assert.throws(
    () => serializeVerifiedHostHelperRecord({ ...record, arbitraryPath: "/tmp/forged" }),
    /unknown fields: arbitraryPath/u,
  );
  assert.throws(
    () => serializeVerifiedHostHelperRecord({ ...record, verified: false }),
    /identity is invalid/u,
  );
});

test("inventory-only mode cannot emit the fixed authority record", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          path.join(import.meta.dirname, "verify-release-assets.mjs"),
          "--inventory-only",
          "--emit-host-helper-record",
        ],
        { encoding: "utf8", stdio: "pipe" },
      ),
    (error) => {
      assert.match(
        error.stderr,
        /inventory-only verification cannot emit a host-helper authority record/u,
      );
      return true;
    },
  );
});

test("fixed record emission rejects key overrides and permissive authority paths", async () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          path.join(import.meta.dirname, "verify-release-assets.mjs"),
          "--emit-host-helper-record",
          "--trusted-key",
          "/tmp/self-signing-key.pem",
        ],
        { encoding: "utf8", stdio: "pipe" },
      ),
    (error) => {
      assert.match(error.stderr, /does not accept a trusted-key override/u);
      return true;
    },
  );

  const root = await mkdtemp(path.join(os.tmpdir(), "rak-authority-permissions-"));
  const signingKey = path.join(root, "release-signing-public-key.pem");
  await writeFile(signingKey, "fixture public key\n", { mode: 0o400 });
  await validateReleaseAuthorityFixtureTestOnly({
    mode: "fixture-test-only",
    recordDirectory: root,
    signingKey,
  });

  await chmod(signingKey, 0o600);
  await assert.rejects(
    validateReleaseAuthorityFixtureTestOnly({
      mode: "fixture-test-only",
      recordDirectory: root,
      signingKey,
    }),
    /mode 0400 or 0444/u,
  );

  await chmod(signingKey, 0o400);
  await chmod(root, 0o722);
  await assert.rejects(
    validateReleaseAuthorityFixtureTestOnly({
      mode: "fixture-test-only",
      recordDirectory: root,
      signingKey,
    }),
    /non-writable by group\/other/u,
  );
});

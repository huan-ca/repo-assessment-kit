import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyAuthority } from "./verify-release-assets.mjs";

test("protected release signer emits an Ed25519 authority accepted by the verifier", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rak-release-signing-"));
  try {
    const manifest = path.join(directory, "manifest.json");
    const toolchain = path.join(directory, "toolchain.json");
    const privateKeyPath = path.join(directory, "private.pem");
    const signature = path.join(directory, "signature.json");
    const publicKey = path.join(directory, "public.pem");
    const { privateKey } = generateKeyPairSync("ed25519");
    await Promise.all([
      writeFile(manifest, '{"manifest":true}\n'),
      writeFile(toolchain, '{"toolchain":true}\n'),
      writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), {
        mode: 0o600,
      }),
    ]);
    execFileSync(
      process.execPath,
      [
        path.join(import.meta.dirname, "sign-release-bundle.mjs"),
        "--manifest",
        manifest,
        "--toolchain",
        toolchain,
        "--private-key",
        privateKeyPath,
        "--signature",
        signature,
        "--public-key",
        publicKey,
      ],
      { stdio: "pipe" },
    );
    const envelope = JSON.parse(await readFile(signature, "utf8"));
    assert.equal(
      await verifyAuthority(
        signature,
        publicKey,
        envelope.payload.manifestSha256,
        envelope.payload.toolchainLockSha256,
      ),
      envelope.keyId,
    );
    await assert.rejects(
      verifyAuthority(signature, publicKey, "0".repeat(64), envelope.payload.toolchainLockSha256),
      /stale or mismatched/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release toolchain generator binds all required image evidence and omits optional scanners", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rak-release-toolchain-"));
  try {
    const evidenceRoot = path.join(directory, "release", "evidence", "images");
    for (const [index, name] of ["codex", "claude", "acquisition", "browser"].entries()) {
      const imageDirectory = path.join(evidenceRoot, name);
      await mkdir(imageDirectory, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(imageDirectory, "metadata.json"),
          JSON.stringify({
            name,
            reference: `ghcr.io/example/rak-${name}:test`,
            digest: `sha256:${String(index + 1).repeat(64)}`,
            platforms: ["linux/amd64", "linux/arm64"],
          }),
        ),
        ...["sbom.cdx.json", "provenance.json", "license.txt", "vulnerability-scan.json"].map(
          (file) => writeFile(path.join(imageDirectory, file), `${name}:${file}\n`),
        ),
      ]);
    }
    const output = path.join(directory, "release", "toolchain.lock.json");
    execFileSync(
      process.execPath,
      [
        path.join(import.meta.dirname, "create-release-toolchain.mjs"),
        "--evidence-root",
        evidenceRoot,
        "--output",
        output,
      ],
      { stdio: "pipe" },
    );
    const lock = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(lock.tools, []);
    assert.deepEqual(Object.keys(lock.images), ["codex", "claude", "acquisition", "browser"]);
    assert.equal(lock.releaseReadiness.status, "available");
    assert.match(lock.images.browser.sbom.path, /^evidence\/images\/browser\//u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

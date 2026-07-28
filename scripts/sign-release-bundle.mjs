#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function usage() {
  process.stderr.write(
    "usage: sign-release-bundle.mjs --manifest FILE --toolchain FILE --private-key FILE --signature FILE --public-key FILE\n",
  );
  process.exit(64);
}

const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const key = {
    "--manifest": "manifest",
    "--toolchain": "toolchain",
    "--private-key": "privateKey",
    "--signature": "signature",
    "--public-key": "publicKey",
  }[args[index]];
  if (key === undefined || args[index + 1] === undefined) usage();
  options[key] = path.resolve(args[index + 1]);
}
if (Object.keys(options).length !== 5) usage();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [manifestBytes, toolchainBytes, privateKeyBytes] = await Promise.all([
  readFile(options.manifest),
  readFile(options.toolchain),
  readFile(options.privateKey),
]);
const privateKey = createPrivateKey(privateKeyBytes);
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("release key must be Ed25519");
const publicKey = createPublicKey(privateKey);
const publicDer = publicKey.export({ type: "spki", format: "der" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const payload = {
  profile: "rak-release-authority/1.0.0",
  manifestSha256: sha256(manifestBytes),
  toolchainLockSha256: sha256(toolchainBytes),
};
const canonicalPayload = Buffer.from(
  `{"manifestSha256":"${payload.manifestSha256}","profile":"${payload.profile}","toolchainLockSha256":"${payload.toolchainLockSha256}"}`,
);
const envelope = {
  schemaVersion: "1.0.0",
  profile: "rak-release-signature/1.0.0",
  keyId: `sha256:${sha256(publicDer)}`,
  algorithm: "Ed25519",
  payload,
  signature: sign(null, canonicalPayload, privateKey).toString("base64"),
};
await writeFile(options.publicKey, publicPem, { flag: "wx", mode: 0o444 });
await writeFile(options.signature, `${JSON.stringify(envelope, null, 2)}\n`, {
  flag: "wx",
  mode: 0o444,
});

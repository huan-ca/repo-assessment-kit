import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  parseVerifiedHostHelperRecord,
  validateVerifiedReleaseMetadata,
  verifyRecordedArtifact,
} from "./validate-production-host-helper.mjs";

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const architecture = process.arch === "arm64" ? "arm64" : "x86-64";
const artifactKeys = [
  "installerSha256",
  "nodeSha256",
  "peerVerifierSha256",
  "productionHostHelperSha256",
  "hostHelperServiceSha256",
  "hostHelperJournalSha256",
  "hostHelperOperationsSha256",
  "hostHelperProtocolSha256",
  "productionInstallationConfigSha256",
  "providerTaskSha256",
  "installationValidatorSha256",
  "serviceEntrypointSha256",
  "linuxServiceDefinitionSha256",
  "macosServiceDefinitionSha256",
];

function recordText(overrides = {}) {
  const values = {
    profile: "rak-verified-host-helper-release/1.0.0",
    verified: "true",
    sourceCommit: createHash("sha256").update("source commit").digest("hex"),
    manifestSha256: sha256("release manifest"),
    signingKeyId: sha256("release signing key"),
    platform: process.platform,
    architecture,
    nodeVersion: "v24.4.1",
    ...Object.fromEntries(artifactKeys.map((key) => [key, sha256(key)])),
    ...overrides,
  };
  return Buffer.from(
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
}

test("tampered Node cannot be authorized by a digest colocated with the tamper", () => {
  const original = Buffer.from("preverified node bytes");
  const tampered = Buffer.from("tampered node bytes");
  const record = parseVerifiedHostHelperRecord(recordText({ nodeSha256: sha256(original) }));
  verifyRecordedArtifact(record, "nodeSha256", original);
  const colocatedDigest = sha256(tampered);
  assert.notEqual(colocatedDigest, record.nodeSha256);
  assert.throws(
    () => verifyRecordedArtifact(record, "nodeSha256", tampered),
    /does not match preverified authority/,
  );
});

test("missing, duplicate, unknown, and malformed record fields fail closed", () => {
  const valid = recordText().toString("utf8");
  assert.throws(
    () => parseVerifiedHostHelperRecord(Buffer.from(valid.replace(/^verified=.*\n/mu, ""))),
    /missing or extra fields/,
  );
  assert.throws(
    () =>
      parseVerifiedHostHelperRecord(Buffer.from(valid.replace(/verified=true/u, "profile=true"))),
    /unknown or duplicate field/,
  );
  assert.throws(
    () => parseVerifiedHostHelperRecord(Buffer.from(`${valid}extra=value\n`)),
    /missing or extra fields/,
  );
  assert.throws(
    () => parseVerifiedHostHelperRecord(Buffer.from(valid.replace(/\n$/u, ""))),
    /canonical line data/,
  );
});

test("bad or permissive authority metadata fails before use", () => {
  const safe = { isFile: true, isSymbolicLink: false, uid: 0, gid: 0, mode: 0o400, size: 100 };
  validateVerifiedReleaseMetadata(safe);
  for (const metadata of [
    { ...safe, isSymbolicLink: true },
    { ...safe, uid: 501 },
    { ...safe, gid: 20 },
    { ...safe, mode: 0o440 },
    { ...safe, mode: 0o600 },
    { ...safe, isFile: false },
  ]) {
    assert.throws(() => validateVerifiedReleaseMetadata(metadata), /unsafe metadata/);
  }
});

test("module and selected service drift fail against the ceremony record", () => {
  const moduleBytes = Buffer.from("host helper module");
  const serviceBytes = Buffer.from("fixed service definition");
  const record = parseVerifiedHostHelperRecord(
    recordText({
      hostHelperServiceSha256: sha256(moduleBytes),
      linuxServiceDefinitionSha256: sha256(serviceBytes),
    }),
  );
  assert.throws(
    () =>
      verifyRecordedArtifact(
        record,
        "hostHelperServiceSha256",
        Buffer.concat([moduleBytes, Buffer.from("x")]),
      ),
    /does not match preverified authority/,
  );
  assert.throws(
    () =>
      verifyRecordedArtifact(
        record,
        "linuxServiceDefinitionSha256",
        Buffer.concat([serviceBytes, Buffer.from("x")]),
      ),
    /does not match preverified authority/,
  );
});

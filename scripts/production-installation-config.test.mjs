import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  HOST_HELPER_OPERATION_KINDS,
  HUMAN_REVIEW_KINDS,
  PRODUCTION_INSTALLATION_CONFIG_PATH,
  RELEASE_CERTIFICATE_KINDS,
  RELEASE_CERTIFICATE_SUBJECT_KINDS,
  ProductionInstallationConfigError,
  loadFixtureTestInstallationConfig,
  validateProductionInstallationConfig,
} from "./production-installation-config.mjs";

const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const markerDigest = (marker) => `sha256:${marker.repeat(64)}`;

function publicKey() {
  return generateKeyPairSync("ed25519").publicKey.export({
    type: "spki",
    format: "pem",
  });
}

function fixture() {
  const files = new Map();
  let sequence = 0;
  const authority = (kind) => {
    sequence += 1;
    const bytes = publicKey();
    const publicKeyPath = `/etc/repo-assessment-kit/keys/authority-${sequence}.pub`;
    files.set(publicKeyPath, bytes);
    return {
      ...(kind === undefined ? {} : { kind }),
      signingKeyId: `authority-${sequence}`,
      publicKeyPath,
      publicKeySha256: digest(bytes),
    };
  };
  const humanReviewKeys = HUMAN_REVIEW_KINDS.map(authority);
  const releaseAuthorizationKey = authority();
  const releaseCertificateKeys = RELEASE_CERTIFICATE_KINDS.filter((kind) => kind !== "ssh").map(
    authority,
  );
  const guardBytes = publicKey();
  const guardPath = "/etc/repo-assessment-kit/keys/request-guard.pub";
  files.set(guardPath, guardBytes);
  const issuerBytes = publicKey();
  const issuerPath = "/etc/repo-assessment-kit/keys/request-guard-issuer.pub";
  files.set(issuerPath, issuerBytes);
  const catalogBytes = Buffer.from('{"schemaVersion":"rak-control-catalog/1.0.0"}\n');
  const catalogPath = "/etc/repo-assessment-kit/control-catalog.json";
  files.set(catalogPath, catalogBytes);
  const recipientBytes = publicKey();
  const recipientPath = "/etc/repo-assessment-kit/keys/recipient.pub";
  files.set(recipientPath, recipientBytes);
  const operation = Object.fromEntries(
    HOST_HELPER_OPERATION_KINDS.map((name, index) => [
      name,
      {
        driverProfile: "rak-fixed-runtime-broker/1.0.0",
        binary: "/usr/local/libexec/rak-runtime-broker",
        ownerUid: 0,
        mode: "0755",
        sha256: markerDigest("a"),
        timeoutMs: 30_000,
        creationNonce: `creation-${index}`,
        profileId: `profile-${index}`,
      },
    ]),
  );
  operation["request-guard.issue"] = {
    ...operation["request-guard.issue"],
    binary: "/usr/local/libexec/rak-control-plan-signer",
    sha256: markerDigest("9"),
  };
  const config = {
    schemaVersion: "rak-host-helper-config/1.0.0",
    installationId: "production-installation-1",
    clientUid: 1042,
    clientGid: 1042,
    peerCredentialVerifier: {
      path: "/usr/local/libexec/rak-peer-cred",
      ownerUid: 0,
      mode: "0755",
      platform: "linux",
      sha256: markerDigest("b"),
    },
    operations: operation,
    runtime: {
      lima: {
        profile: "rak-lima-plain-native/1.0.0",
        binary: "/usr/local/bin/limactl",
        ownerUid: 0,
        mode: "0755",
        sha256: markerDigest("c"),
        instance: "rak-runtime-1",
        instanceDirectory: "/var/lib/repo-assessment-kit/lima/rak-runtime-1",
        creationNonce: "runtime-creation-1",
        nativeArchitecture: "arm64",
        guestImageDigest: markerDigest("d"),
        broker: {
          binary: "/usr/local/libexec/rak-runtime-broker",
          ownerUid: 0,
          mode: "0755",
          sha256: markerDigest("a"),
        },
      },
    },
    acquisitionProfiles: {
      "acquisition-1": { sshHandleId: "ssh-handle-1" },
    },
    sshHandles: {
      "ssh-handle-1": {
        credentialKind: "key-file",
        credentialPath: "/run/secrets/rak-repository-key",
        knownHostsPath: "/etc/repo-assessment-kit/ssh/known-hosts",
        host: "git.example.test",
        port: 22,
        hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
        url: "git@git.example.test:owner/repository.git",
        ref: "main",
        expiresAt: "2030-01-01T00:00:00.000Z",
        maxUses: 2,
        scope: "repository-read-only",
      },
    },
    secretRecipients: {
      "target-service-1": {
        purpose: "target-service",
        publicKeyPath: recipientPath,
        publicKeySha256: digest(recipientBytes),
      },
    },
    requestGuardAuthorities: {
      "request-guard-1": {
        algorithm: "Ed25519",
        production: true,
        publicKeyPath: guardPath,
        publicKeySha256: digest(guardBytes),
      },
    },
    requestGuardIssuer: {
      profile: "rak-dynamic-control-plan-issuer/1.0.0",
      signingKeyId: "request-guard-issuer-1",
      publicKeyPath: issuerPath,
      publicKeySha256: digest(issuerBytes),
      signer: {
        binary: "/usr/local/libexec/rak-control-plan-signer",
        ownerUid: 0,
        mode: "0755",
        sha256: markerDigest("9"),
      },
      maxLifetimeSeconds: 1800,
      catalogPath,
      catalogSha256: digest(catalogBytes),
    },
    providerReviewProfiles: Object.fromEntries(
      ["codex", "claude-code"].map((provider, index) => [
        provider,
        {
          releaseAuthorityDigest: markerDigest(index === 0 ? "e" : "f"),
          immutableImageReference: `registry.example/rak/${provider}@${markerDigest(
            index === 0 ? "1" : "2",
          )}`,
          providerHomeAuthorityDigest: markerDigest(index === 0 ? "3" : "4"),
          networkPolicyDigest: markerDigest(index === 0 ? "5" : "6"),
          outputSchemaDigest: markerDigest(index === 0 ? "7" : "8"),
        },
      ]),
    ),
    humanReviewKeys,
    releaseAuthorizationKey,
    releaseCertificateKeys,
    releaseCertificateSubjects: Object.fromEntries(
      RELEASE_CERTIFICATE_SUBJECT_KINDS.map((kind, index) => [
        kind,
        markerDigest((index + 10).toString(16).slice(-1)),
      ]),
    ),
    unresolvedBoundaryDefects: [
      { defectId: "boundary-1", severity: "High", state: "unresolved" },
      { defectId: "boundary-2", severity: "Low", state: "resolved" },
    ],
  };
  const configBytes = Buffer.from(`${JSON.stringify(config)}\n`);
  files.set(PRODUCTION_INSTALLATION_CONFIG_PATH, configBytes);
  const metadata = new Map(
    [...files].map(([path, bytes], index) => [
      path,
      {
        isFile: true,
        uid: 0,
        gid: config.clientGid,
        mode: 0o440,
        size: Buffer.byteLength(bytes),
        dev: "1",
        ino: String(index + 1),
        mtimeNs: "1000000000",
      },
    ]),
  );
  const read = async (path) => {
    const bytes = files.get(path);
    const before = metadata.get(path);
    if (bytes === undefined || before === undefined) throw new Error("missing authority");
    return {
      bytes: Buffer.from(bytes),
      before: structuredClone(before),
      after: structuredClone(before),
    };
  };
  return { config, files, metadata, read };
}

function configFailure(config, code = "INSTALLATION_CONFIG_INVALID") {
  assert.throws(
    () => validateProductionInstallationConfig(config),
    (error) => error instanceof ProductionInstallationConfigError && error.code === code,
  );
}

test("validates the exact production union and the published JSON schema is strict JSON", async () => {
  const { config } = fixture();
  assert.deepEqual(validateProductionInstallationConfig(config), config);
  const schema = JSON.parse(
    await readFile(new URL("../release/host-helper-config.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(schema.$id, "rak-host-helper-config/1.0.0");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(new Set(schema.required), new Set(Object.keys(config)));
});

test("fixture-only loader verifies held metadata, digests, Ed25519 and hydrates authorities", async () => {
  const { config, metadata, read } = fixture();
  for (const value of metadata.values()) value.mode |= 0o100000;
  const loaded = await loadFixtureTestInstallationConfig({
    mode: "fixture-test-only",
    readFile: read,
  });
  assert.equal(loaded.config.installationId, config.installationId);
  assert.equal(
    loaded.releaseAuthorities.reviewKeys[config.humanReviewKeys[0].signingKeyId].kind,
    HUMAN_REVIEW_KINDS[0],
  );
  assert.ok(Buffer.isBuffer(loaded.config.requestGuardAuthorities["request-guard-1"].publicKeyPem));
  await assert.rejects(
    loadFixtureTestInstallationConfig({ readFile: read }),
    (error) => error.code === "FIXTURE_TEST_SEAM_REQUIRED",
  );
});

test("rejects unknown fields and any missing member of the exact config closure", () => {
  const { config } = fixture();
  config.unexpected = true;
  configFailure(config);
  delete config.unexpected;
  delete config.runtime;
  configFailure(config);
  const nested = fixture().config;
  nested.providerReviewProfiles.codex.extra = "authority";
  configFailure(nested);
});

test("rejects duplicate review/certificate kinds, key IDs, key digests and defect IDs", () => {
  const duplicateReviewKind = fixture().config;
  duplicateReviewKind.humanReviewKeys[1].kind = duplicateReviewKind.humanReviewKeys[0].kind;
  configFailure(duplicateReviewKind, "INSTALLATION_CONFIG_DUPLICATE");

  const duplicateKeyId = fixture().config;
  duplicateKeyId.releaseCertificateKeys[1].signingKeyId =
    duplicateKeyId.releaseCertificateKeys[0].signingKeyId;
  configFailure(duplicateKeyId, "INSTALLATION_CONFIG_DUPLICATE");

  const duplicateKeyDigest = fixture().config;
  duplicateKeyDigest.releaseCertificateKeys[1].publicKeySha256 =
    duplicateKeyDigest.releaseCertificateKeys[0].publicKeySha256;
  configFailure(duplicateKeyDigest, "INSTALLATION_CONFIG_DUPLICATE");

  const duplicateCertificateKind = fixture().config;
  duplicateCertificateKind.releaseCertificateKeys[1].kind =
    duplicateCertificateKind.releaseCertificateKeys[0].kind;
  configFailure(duplicateCertificateKind, "INSTALLATION_CONFIG_DUPLICATE");

  const duplicateDefect = fixture().config;
  duplicateDefect.unresolvedBoundaryDefects[1].defectId =
    duplicateDefect.unresolvedBoundaryDefects[0].defectId;
  configFailure(duplicateDefect, "INSTALLATION_CONFIG_DUPLICATE");
});

test("rejects missing/wrong key-kind mappings, fixture values and embedded PEM", () => {
  const wrongKind = fixture().config;
  wrongKind.humanReviewKeys[0].kind = "releaseAssets";
  configFailure(wrongKind);

  const omittedCertificateKind = fixture().config;
  omittedCertificateKind.releaseCertificateKeys.pop();
  configFailure(omittedCertificateKind);

  const fixtureValue = fixture().config;
  fixtureValue.installationId = "fixture-installation";
  configFailure(fixtureValue, "INSTALLATION_CONFIG_FIXTURE_VALUE");

  const embeddedPem = fixture().config;
  embeddedPem.requestGuardAuthorities["request-guard-1"].publicKeyPath =
    "-----BEGIN PUBLIC KEY-----";
  configFailure(embeddedPem, "INSTALLATION_CONFIG_PRIVATE_MATERIAL");
});

test("rejects unsafe config/key metadata, drift, digest mismatch and non-Ed25519 keys", async () => {
  const unsafeConfig = fixture();
  unsafeConfig.metadata.get(PRODUCTION_INSTALLATION_CONFIG_PATH).uid = 1000;
  await assert.rejects(
    loadFixtureTestInstallationConfig({
      mode: "fixture-test-only",
      readFile: unsafeConfig.read,
    }),
    (error) => error.code === "INSTALLATION_AUTHORITY_UNSAFE",
  );

  const unsafeKey = fixture();
  const keyPath = unsafeKey.config.humanReviewKeys[0].publicKeyPath;
  unsafeKey.metadata.get(keyPath).mode = 0o644;
  await assert.rejects(
    loadFixtureTestInstallationConfig({
      mode: "fixture-test-only",
      readFile: unsafeKey.read,
    }),
    (error) => error.code === "INSTALLATION_AUTHORITY_UNSAFE",
  );

  const driftingKey = fixture();
  const driftPath = driftingKey.config.humanReviewKeys[0].publicKeyPath;
  const driftRead = async (path) => {
    const result = await driftingKey.read(path);
    if (path === driftPath) result.after.mtimeNs = "1000000001";
    return result;
  };
  await assert.rejects(
    loadFixtureTestInstallationConfig({
      mode: "fixture-test-only",
      readFile: driftRead,
    }),
    (error) => error.code === "INSTALLATION_AUTHORITY_CHANGED",
  );

  const digestMismatch = fixture();
  digestMismatch.config.humanReviewKeys[0].publicKeySha256 = markerDigest("0");
  const changedConfig = Buffer.from(`${JSON.stringify(digestMismatch.config)}\n`);
  digestMismatch.files.set(PRODUCTION_INSTALLATION_CONFIG_PATH, changedConfig);
  digestMismatch.metadata.get(PRODUCTION_INSTALLATION_CONFIG_PATH).size = changedConfig.byteLength;
  await assert.rejects(
    loadFixtureTestInstallationConfig({
      mode: "fixture-test-only",
      readFile: digestMismatch.read,
    }),
    (error) => error.code === "INSTALLATION_AUTHORITY_DIGEST_MISMATCH",
  );

  const nonEd25519 = fixture();
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
    type: "spki",
    format: "pem",
  });
  const rsaPath = nonEd25519.config.releaseAuthorizationKey.publicKeyPath;
  nonEd25519.files.set(rsaPath, rsa);
  nonEd25519.metadata.get(rsaPath).size = Buffer.byteLength(rsa);
  nonEd25519.config.releaseAuthorizationKey.publicKeySha256 = digest(rsa);
  const rsaConfig = Buffer.from(`${JSON.stringify(nonEd25519.config)}\n`);
  nonEd25519.files.set(PRODUCTION_INSTALLATION_CONFIG_PATH, rsaConfig);
  nonEd25519.metadata.get(PRODUCTION_INSTALLATION_CONFIG_PATH).size = rsaConfig.byteLength;
  await assert.rejects(
    loadFixtureTestInstallationConfig({
      mode: "fixture-test-only",
      readFile: nonEd25519.read,
    }),
    (error) => error.code === "INSTALLATION_PUBLIC_KEY_INVALID",
  );
});

test("rejects unknown unresolved-boundary enums", () => {
  const severity = fixture().config;
  severity.unresolvedBoundaryDefects[0].severity = "Severe";
  configFailure(severity);
  const state = fixture().config;
  state.unresolvedBoundaryDefects[0].state = "accepted";
  configFailure(state);
});

test("rejects a decorative request-guard signer not bound to the fixed issue operation", () => {
  const { config } = fixture();
  config.operations["request-guard.issue"].sha256 = markerDigest("0");
  configFailure(config);
});

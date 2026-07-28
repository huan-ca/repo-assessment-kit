import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const providerEndpoints = Object.freeze({
  codex: Object.freeze([
    Object.freeze({ host: "api.openai.com", port: 443 }),
    Object.freeze({ host: "auth.openai.com", port: 443 }),
    Object.freeze({ host: "chatgpt.com", port: 443 }),
  ]),
  "claude-code": Object.freeze([
    Object.freeze({ host: "api.anthropic.com", port: 443 }),
    Object.freeze({ host: "claude.ai", port: 443 }),
    Object.freeze({ host: "console.anthropic.com", port: 443 }),
  ]),
});

const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function gitEndpoint(subject) {
  if (subject.startsWith("ssh://")) {
    const parsed = new URL(subject);
    if (!parsed.hostname || parsed.username.includes("\0") || parsed.password) return null;
    return { host: parsed.hostname.toLowerCase(), port: parsed.port ? Number(parsed.port) : 22 };
  }
  const match = /^(?:[a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+):[^:\s]+$/u.exec(subject);
  return match ? { host: match[1].toLowerCase(), port: 22 } : null;
}

function expectedEndpoints(kind, subject) {
  if (kind === "provider-inference") return providerEndpoints[subject] ?? null;
  if (kind === "git-acquisition") {
    const endpoint = gitEndpoint(subject);
    return endpoint ? [endpoint] : null;
  }
  return null;
}

const sameEndpoints = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  canonicalJson(
    [...actual].sort((left, right) =>
      `${left.host}:${left.port}`.localeCompare(`${right.host}:${right.port}`),
    ),
  ) ===
    canonicalJson(
      [...expected].sort((left, right) =>
        `${left.host}:${left.port}`.localeCompare(`${right.host}:${right.port}`),
      ),
    );

function assertPrivateDirectory(directory, label) {
  const entry = lstatSync(directory);
  const owner = typeof process.geteuid === "function" ? process.geteuid() : entry.uid;
  if (
    entry.isSymbolicLink() ||
    !entry.isDirectory() ||
    entry.uid !== owner ||
    (entry.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} is not an owner-private, non-symbolic directory`);
  }
  if (realpathSync.native(directory) !== path.resolve(directory)) {
    throw new Error(`${label} resolves outside its fixed installation path`);
  }
}

function ensurePrivateChild(parent, name, label) {
  const child = path.join(parent, name);
  try {
    mkdirSync(child, { mode: 0o700 });
    const parentDescriptor = openSync(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      fsyncSync(parentDescriptor);
    } finally {
      closeSync(parentDescriptor);
    }
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  assertPrivateDirectory(child, label);
  return child;
}

function publicKeyDigest(publicKey) {
  const key =
    publicKey?.type === "public" && typeof publicKey?.export === "function"
      ? publicKey
      : createPublicKey(publicKey);
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

function consumeAttestation(envelope, publicKey, installationRoot) {
  if (typeof installationRoot !== "string" || !path.isAbsolute(installationRoot)) {
    throw new Error("installation root must be one fixed absolute path");
  }
  const root = path.resolve(installationRoot);
  const rootEntry = lstatSync(root);
  const owner = typeof process.geteuid === "function" ? process.geteuid() : rootEntry.uid;
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory() || rootEntry.uid !== owner) {
    throw new Error("installation root is not an owned, non-symbolic directory");
  }
  if (realpathSync.native(root) !== root) {
    throw new Error("installation root resolves through a symbolic path");
  }
  const state = ensurePrivateChild(root, "state", "installation state");
  const ledger = ensurePrivateChild(state, "network-attestation-nonces", "network replay ledger");
  const installationId = createHash("sha256")
    .update("rak-installation\0")
    .update(root)
    .update("\0")
    .update(publicKeyDigest(publicKey))
    .digest("hex");
  const attestationId = createHash("sha256")
    .update("rak-network-attestation\0")
    .update(installationId)
    .update("\0")
    .update(canonicalJson(envelope.payload))
    .update("\0")
    .update(envelope.signature)
    .digest("hex");
  const markerPath = path.join(ledger, `${attestationId}.used`);
  const marker = `${canonicalJson({
    schemaVersion: "rak-network-attestation-consumption/1.0.0",
    installationId: `sha256:${installationId}`,
    attestationId: `sha256:${attestationId}`,
    issuer: envelope.payload.issuer,
    kind: envelope.payload.kind,
    subject: envelope.payload.subject,
    networkId: envelope.payload.networkId,
    nonce: envelope.payload.nonce,
    signatureSha256: `sha256:${createHash("sha256").update(envelope.signature).digest("hex")}`,
  })}\n`;
  let descriptor;
  try {
    descriptor = openSync(
      markerPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = lstatSync(markerPath);
    if (
      existing.isSymbolicLink() ||
      !existing.isFile() ||
      existing.uid !== owner ||
      (existing.mode & 0o177) !== 0 ||
      readFileSync(markerPath, "utf8") !== marker
    ) {
      throw new Error("attestation replay marker is unsafe or installation-mismatched");
    }
    throw new Error("attestation nonce was already consumed");
  }
  try {
    const created = fstatSync(descriptor);
    if (!created.isFile() || created.uid !== owner || (created.mode & 0o177) !== 0) {
      throw new Error("attestation replay marker permissions are unsafe");
    }
    writeFileSync(descriptor, marker, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const ledgerDescriptor = openSync(
    ledger,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(ledgerDescriptor);
  } finally {
    closeSync(ledgerDescriptor);
  }
}

export function verifyNetworkAttestation(envelope, publicKey, expected) {
  if (!exactKeys(envelope, ["payload", "signature"])) throw new Error("unsigned attestation");
  const { payload, signature } = envelope;
  if (
    !exactKeys(payload, [
      "schemaVersion",
      "issuer",
      "status",
      "kind",
      "subject",
      "dockerNetwork",
      "networkId",
      "policyDigest",
      "allowedEndpoints",
      "issuedAt",
      "expiresAt",
      "nonce",
    ]) ||
    typeof signature !== "string" ||
    !/^[a-zA-Z0-9_-]{86}$/u.test(signature)
  ) {
    throw new Error("malformed signed attestation");
  }
  const endpointShape =
    Array.isArray(payload.allowedEndpoints) &&
    payload.allowedEndpoints.every(
      (endpoint) =>
        exactKeys(endpoint, ["host", "port"]) &&
        typeof endpoint.host === "string" &&
        /^[a-zA-Z0-9.-]{1,253}$/u.test(endpoint.host) &&
        Number.isInteger(endpoint.port) &&
        endpoint.port > 0 &&
        endpoint.port <= 65_535,
    );
  const endpoints = expectedEndpoints(expected.kind, expected.subject);
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  const now = expected.now ?? Date.now();
  const valid =
    payload.schemaVersion === 1 &&
    payload.issuer === "rak-host-helper" &&
    payload.status === "available" &&
    payload.kind === expected.kind &&
    payload.subject === expected.subject &&
    payload.dockerNetwork === expected.network &&
    payload.networkId === expected.networkId &&
    payload.nonce === expected.nonce &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/u.test(payload.dockerNetwork) &&
    /^[0-9a-f]{64}$/u.test(payload.networkId) &&
    /^sha256:[0-9a-f]{64}$/u.test(payload.policyDigest) &&
    /^[0-9a-f]{64}$/u.test(payload.nonce) &&
    endpointShape &&
    endpoints !== null &&
    sameEndpoints(payload.allowedEndpoints, endpoints) &&
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= now + 5_000 &&
    issuedAt >= now - 60_000 &&
    expiresAt > now &&
    expiresAt <= issuedAt + 300_000;
  if (!valid) throw new Error("attestation scope, network, endpoint, nonce, or freshness mismatch");
  const signed = Buffer.from(canonicalJson(payload));
  if (!verifySignature(null, signed, publicKey, Buffer.from(signature, "base64url"))) {
    throw new Error("attestation signature is invalid");
  }
  consumeAttestation(envelope, publicKey, expected.installationRoot);
  return payload;
}

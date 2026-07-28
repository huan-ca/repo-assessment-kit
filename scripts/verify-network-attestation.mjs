import { readFileSync } from "node:fs";
import path from "node:path";
import { verifyNetworkAttestation } from "./lib/network-attestation.mjs";

const [kind, subject, network, networkId, nonce, file] = process.argv.slice(2);
if (!kind || !subject || !network || !networkId || !nonce || !file) {
  console.error("signed network attestation arguments are required");
  process.exit(64);
}
const root = path.resolve(import.meta.dirname, "..");
try {
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  const publicKey = readFileSync(path.join(root, "release/network-attestor-public-key.pem"));
  verifyNetworkAttestation(envelope, publicKey, {
    kind,
    subject,
    network,
    networkId,
    nonce,
    installationRoot: root,
  });
} catch (error) {
  console.error(
    `network attestation refused: ${error instanceof Error ? error.message : "invalid"}`,
  );
  process.exit(77);
}

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  reopenZip,
  validateStandaloneZip,
  verifyDetachedDigest,
} from "../packages/packaging/dist/index.js";
import {
  validateCycloneDxProjection,
  validateSarifProjection,
  verifyReleaseSchemaAssets,
} from "../packages/analyzers/dist/index.js";

function fail(message, code = 1) {
  process.stderr.write(`customer package verification failed: ${message}\n`);
  process.exit(code);
}

function parseArgs(args) {
  let zip;
  let digest;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--zip" && args[index + 1] !== undefined) zip = path.resolve(args[++index]);
    else if (args[index] === "--digest" && args[index + 1] !== undefined)
      digest = path.resolve(args[++index]);
    else fail("usage: verify-package.mjs --zip PACKAGE.zip --digest PACKAGE.zip.sha256", 64);
  }
  if (zip === undefined || digest === undefined)
    fail("usage: verify-package.mjs --zip PACKAGE.zip --digest PACKAGE.zip.sha256", 64);
  return { zip, digest };
}

async function regularFile(filePath, label) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  return readFile(filePath);
}

const options = parseArgs(process.argv.slice(2));
try {
  const [zipBytes, detachedBytes] = await Promise.all([
    regularFile(options.zip, "customer ZIP"),
    regularFile(options.digest, "detached digest"),
  ]);
  verifyDetachedDigest(zipBytes, detachedBytes.toString("utf8"));
  const packageValidation = validateStandaloneZip(zipBytes);
  const entries = new Map(reopenZip(zipBytes).map((entry) => [entry.path, entry.content]));
  const requiredProjection = (entryPath) => {
    const bytes = entries.get(entryPath);
    if (bytes === undefined) throw new Error(`required projection is missing: ${entryPath}`);
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  };
  const sarif = requiredProjection("exports/findings.sarif.json");
  const cycloneDx = requiredProjection("exports/sbom.cdx.json");
  validateSarifProjection(sarif);
  validateCycloneDxProjection(cycloneDx);
  const schemaAssets = verifyReleaseSchemaAssets();
  process.stdout.write(
    `${JSON.stringify({
      profile: "rak-customer-package-verification/1.0.0",
      status: "passed",
      zipSha256: createHash("sha256").update(zipBytes).digest("hex"),
      manifestDigest: packageValidation.manifestDigest,
      packageValidationDigest: packageValidation.validationDigest,
      schemaRegistryDigest: schemaAssets.registryDigest,
      officialSchemas: ["sarif-2.1.0-errata01", "cyclonedx-1.7"],
    })}\n`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "unknown package validation error");
}

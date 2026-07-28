#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const names = ["codex", "claude", "acquisition", "browser"];
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--evidence-root" || args[2] !== "--output") {
  process.stderr.write(
    "usage: create-release-toolchain.mjs --evidence-root release/evidence/images --output release/toolchain.lock.json\n",
  );
  process.exit(64);
}
const evidenceRoot = path.resolve(args[1]);
const output = path.resolve(args[3]);
const releaseRoot = path.resolve(path.dirname(output));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidence = async (name, file) => {
  const absolute = path.join(evidenceRoot, name, file);
  return {
    path: path.relative(releaseRoot, absolute).split(path.sep).join("/"),
    sha256: digest(await readFile(absolute)),
  };
};

const images = {};
for (const name of names) {
  const metadata = JSON.parse(
    await readFile(path.join(evidenceRoot, name, "metadata.json"), "utf8"),
  );
  if (
    metadata.name !== name ||
    typeof metadata.reference !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(metadata.digest) ||
    JSON.stringify(metadata.platforms) !== JSON.stringify(["linux/amd64", "linux/arm64"])
  )
    throw new Error(`${name} image metadata is invalid`);
  images[name] = {
    reference: metadata.reference,
    digest: metadata.digest,
    platforms: metadata.platforms,
    sbom: await evidence(name, "sbom.cdx.json"),
    provenance: await evidence(name, "provenance.json"),
    license: await evidence(name, "license.txt"),
    vulnerabilityScan: await evidence(name, "vulnerability-scan.json"),
  };
}

const lock = {
  schemaVersion: "1.0.0",
  profile: "rak-toolchain-lock/1.0.0",
  generatedFrom: {
    research: "protected GitHub customer-release workflow",
    accessedAt: new Date().toISOString().slice(0, 10),
  },
  tools: [],
  images,
  releaseReadiness: {
    status: "available",
    blockingReasons: [],
    optionalScannerToolsIncluded: false,
  },
};
await writeFile(output, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx", mode: 0o444 });

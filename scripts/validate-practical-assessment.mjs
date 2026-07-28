#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root || process.argv.length !== 3) {
  process.stderr.write("usage: validate-practical-assessment.mjs OUTPUT_DIRECTORY\n");
  process.exit(64);
}

const required = [
  "owner-context.md",
  "executive-report.md",
  "modernization-decision.md",
  "passes/01-product-and-use-cases.md",
  "passes/02-architecture-and-stack.md",
  "passes/03-security.md",
  "passes/04-quality-and-operations.md",
  "passes/05-dynamic-verification.md",
  "passes/06-independent-review.md",
  "assessment-manifest.json",
];
const prohibited =
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu;
const failures = [];
for (const relativePath of required) {
  const absolutePath = path.join(root, relativePath);
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size < 80) failures.push(`${relativePath}: missing or too short`);
    else {
      const content = readFileSync(absolutePath, "utf8");
      if (prohibited.test(content)) failures.push(`${relativePath}: contains secret-like material`);
      prohibited.lastIndex = 0;
    }
  } catch {
    failures.push(`${relativePath}: missing`);
  }
}
if (failures.length) {
  process.stderr.write(`Assessment package validation failed:\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write("Assessment package structure and secret-safety checks passed.\n");

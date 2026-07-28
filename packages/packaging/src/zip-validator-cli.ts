import { readFile } from "node:fs/promises";

import { validateStandaloneZip } from "./index.js";

const zipPath = process.argv[2];
if (zipPath === undefined || process.argv.length !== 3) {
  process.stderr.write("usage: zip-validator-cli <zip-path>\n");
  process.exitCode = 64;
} else {
  try {
    const result = validateStandaloneZip(await readFile(zipPath));
    process.stdout.write(`${JSON.stringify({ ...result, processId: process.pid })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown validation failure";
    process.stderr.write(`ZIP validation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

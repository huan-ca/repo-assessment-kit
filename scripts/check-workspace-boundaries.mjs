import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const allowed = {
  "@rak/contracts": [],
  "@rak/workflow": ["@rak/contracts"],
  "@rak/persistence": ["@rak/contracts"],
  "@rak/evidence": ["@rak/contracts"],
  "@rak/analyzers": ["@rak/contracts"],
  "@rak/runtime": ["@rak/contracts"],
  "@rak/agent-adapters": ["@rak/contracts"],
  "@rak/reporting": ["@rak/contracts"],
  "@rak/packaging": ["@rak/contracts"],
  "@rak/server": [
    "@rak/contracts",
    "@rak/workflow",
    "@rak/persistence",
    "@rak/evidence",
    "@rak/analyzers",
    "@rak/runtime",
    "@rak/agent-adapters",
    "@rak/reporting",
    "@rak/packaging",
  ],
  "@rak/web": ["@rak/contracts"],
};

const manifests = [];
for (const parent of ["apps", "packages"]) {
  for (const entry of await readdir(path.join(root, parent), { withFileTypes: true })) {
    if (entry.isDirectory()) manifests.push(path.join(root, parent, entry.name, "package.json"));
  }
}

const failures = [];
for (const manifestPath of manifests) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const workspaceDependencies = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  }).filter((name) => name.startsWith("@rak/"));
  const permitted = new Set(allowed[manifest.name] ?? []);
  for (const dependency of workspaceDependencies) {
    if (!permitted.has(dependency))
      failures.push(`${manifest.name} must not depend on ${dependency}`);
  }
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`workspace dependency boundaries verified (${manifests.length} manifests)`);
}

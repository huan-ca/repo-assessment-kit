import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const required = [
  "start-codex.sh",
  "start-cc.sh",
  "container/Dockerfile.codex",
  "container/Dockerfile.claude",
  "container/Dockerfile.acquisition",
  "container/Dockerfile.browser",
  "container/browser-probe.mjs",
  "container/compose.yaml",
  "container/runtime/lima.yaml",
  ".env.example",
  "pnpm-lock.yaml",
];
for (const file of required) await access(path.join(root, file));

for (const launcher of [
  "start-codex.sh",
  "start-cc.sh",
  "scripts/launcher.sh",
  "scripts/acquire-source.sh",
  "scripts/runtime-capability.sh",
  "scripts/native-isolation-gates.sh",
]) {
  const result = spawnSync("bash", ["-n", path.join(root, launcher)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${launcher}: ${result.stderr}`);
}
const webPackage = await readFile(path.join(root, "apps/web/package.json"), "utf8");
const server = await readFile(path.join(root, "apps/server/src/index.ts"), "utf8");
if (!webPackage.includes("--host 127.0.0.1") || !server.includes('host: "127.0.0.1"')) {
  throw new Error("local development listeners must use loopback");
}
console.log("foundation smoke assertions passed");

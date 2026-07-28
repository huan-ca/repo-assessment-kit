import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = async (file) => readFile(path.join(root, file), "utf8");
const launcher = await read("scripts/launcher.sh");
const compose = await read("container/compose.yaml");
const acquisition = await read("scripts/acquire-source.sh");
const nativeWorkflow = await read(".github/workflows/native-runtime.yml");
const taskRunner = await read("container/provider-task.mjs");

for (const file of ["container/Dockerfile.codex", "container/Dockerfile.claude"]) {
  const dockerfile = await read(file);
  if (/^COPY\s+(?:--\S+\s+)*\.\s+/mu.test(dockerfile)) {
    throw new Error(`${file} copies the kit tree`);
  }
  for (const forbidden of ["generated", "state", "/source", ".ssh", "EXPOSE"]) {
    if (dockerfile.includes(forbidden)) throw new Error(`${file} contains forbidden ${forbidden}`);
  }
}
for (const forbidden of [
  "/opt/rak",
  "/source",
  ".ssh",
  "state",
  "/var/run/docker.sock",
  "/run/docker.sock",
  "dangerously-",
  "bypassPermissions",
  '"$@"',
]) {
  if (launcher.includes(forbidden))
    throw new Error(`provider launcher contains forbidden ${forbidden}`);
}
const generatedLauncherLines = launcher.split("\n").filter((line) => line.includes("generated"));
if (
  generatedLauncherLines.length !== 4 ||
  generatedLauncherLines.some(
    (line) =>
      !/start-\{codex,cc\}\.sh (?:pair|review|authorize|release) .*<generated (?:run|pair)>/u.test(
        line,
      ),
  )
) {
  throw new Error("provider launcher exposes generated paths outside closed transition usage");
}
if (!launcher.includes("--network none") || !launcher.includes("requires the P5 task broker")) {
  throw new Error("provider launcher lacks fail-closed network or broker gate");
}
for (const forbidden of ["ports:", "generated", "state", "/source", ".ssh", "docker.sock"]) {
  if (compose.includes(forbidden))
    throw new Error(`provider compose contains forbidden ${forbidden}`);
}
if ((compose.match(/network_mode: none/gu) ?? []).length !== 1) {
  throw new Error("provider compose must inherit network none");
}
if (
  !acquisition.includes(":/run/secrets/key:ro") ||
  acquisition.includes(":/source:ro") ||
  !acquisition.includes("LOCAL_FROZEN_SNAPSHOT_HELPER_REQUIRED")
) {
  throw new Error("acquisition does not isolate SSH secrets or fail closed for local worktrees");
}
if (
  acquisition.includes('--user "$(id -u):$(id -g)"') ||
  /--volume\s+"\$output:\/out/u.test(acquisition) ||
  !acquisition.includes("docker cp")
) {
  throw new Error("acquisition lacks fixed non-root anonymous-volume copy-out");
}
for (const fixed of [
  '"--sandbox"',
  '"read-only"',
  '"--ignore-user-config"',
  '"--ignore-rules"',
  '"--ephemeral"',
  '"--strict-config"',
  `'approval_policy="never"'`,
  '"mcp_servers={}"',
  '"notify=[]"',
  '"project_doc_max_bytes=0"',
  '"dontAsk"',
  '"--setting-sources"',
  '"--strict-mcp-config"',
]) {
  if (!taskRunner.includes(fixed)) {
    throw new Error(`provider task runner is missing fixed fail-closed flag ${fixed}`);
  }
}
for (const forbidden of [
  "workspace-write",
  "dangerously-bypass",
  "bypassPermissions",
  "acceptEdits",
  "full-auto",
]) {
  if (taskRunner.includes(forbidden)) {
    throw new Error(`provider task runner contains incompatible or bypass flag ${forbidden}`);
  }
}
if (!taskRunner.includes('"dontAsk"')) {
  throw new Error("provider task flags are not fixed fail-closed modes");
}
if (
  !nativeWorkflow.includes("runtime-capability.sh --require-available") ||
  !nativeWorkflow.includes("native-isolation-gates.sh")
) {
  throw new Error("native workflow can pass without isolation gates");
}
console.log("provider, acquisition, network, and native-gate boundaries verified");

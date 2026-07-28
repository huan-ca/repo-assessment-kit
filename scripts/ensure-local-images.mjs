#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "generated", "local-images.json");
const images = Object.freeze({
  codex: { reference: "rak-codex:0.1.0", label: "io.repo-assessment-kit.provider=codex" },
  claude: { reference: "rak-claude:0.1.0", label: "io.repo-assessment-kit.provider=claude-code" },
  acquisition: {
    reference: "rak-acquisition:0.1.0",
    label: "io.repo-assessment-kit.component=acquisition",
  },
  browser: { reference: "rak-browser:0.1.0", label: "io.repo-assessment-kit.component=browser" },
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() : "";
    throw new Error(detail || `${command} failed with exit code ${result.status ?? "unknown"}`);
  }
  return (result.stdout ?? "").trim();
}

function sourceFingerprint() {
  const files = run("git", ["ls-files", "container", "pnpm-lock.yaml", "package.json"], {
    capture: true,
  })
    .split("\n")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(path.join(root, file)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function inspectImages() {
  return Object.fromEntries(
    Object.entries(images).map(([name, definition]) => {
      const [id, label] = run(
        "docker",
        [
          "image",
          "inspect",
          "--format",
          `{{.Id}}|{{index .Config.Labels "${definition.label.split("=")[0]}"}}`,
          definition.reference,
        ],
        { capture: true },
      ).split("|");
      if (!/^sha256:[0-9a-f]{64}$/u.test(id) || label !== definition.label.split("=")[1])
        throw new Error(`The locally built ${name} image has an unexpected identity.`);
      return [name, { reference: definition.reference, imageId: id }];
    }),
  );
}

try {
  run("docker", ["info"], { capture: true });
  const securityOptions = run("docker", ["info", "--format", "{{json .SecurityOptions}}"], {
    capture: true,
  });
  if (!securityOptions.includes("name=rootless"))
    throw new Error("select a rootless Docker context before building the containers");
  const fingerprint = sourceFingerprint();
  let current;
  try {
    current = JSON.parse(readFileSync(output, "utf8"));
  } catch {
    current = null;
  }
  let inspected;
  try {
    inspected = inspectImages();
  } catch {
    inspected = null;
  }
  if (current?.sourceFingerprint !== fingerprint || inspected === null) {
    process.stdout.write(
      "Building the assessment containers locally. The first build can take several minutes.\n",
    );
    run("docker", [
      "compose",
      "--file",
      "container/compose.yaml",
      "--profile",
      "codex",
      "--profile",
      "claude",
      "--profile",
      "acquisition",
      "--profile",
      "browser",
      "build",
    ]);
    inspected = inspectImages();
  } else {
    process.stdout.write("Local assessment containers are already up to date.\n");
  }
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify(
      {
        schemaVersion: "rak-local-images/1.0.0",
        sourceFingerprint: fingerprint,
        builtAt: new Date().toISOString(),
        images: inspected,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  renameSync(temporary, output);
} catch (error) {
  process.stderr.write(
    `Local container setup failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
}

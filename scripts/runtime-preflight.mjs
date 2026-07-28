#!/usr/bin/env node
import { accessSync, constants, existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { HOST_HELPER_PATHS, parseStrictJsonBytes } from "./host-helper-protocol.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--provider" || !["codex", "claude-code"].includes(args[1])) {
  process.stderr.write("usage: runtime-preflight.mjs --provider <codex|claude-code>\n");
  process.exit(64);
}
const provider = args[1];
const root = path.resolve(import.meta.dirname, "..");
const imageKey = provider === "codex" ? "codex" : "claude";
const expectedLabel = provider;

function executable(command) {
  const pathValue = process.env.PATH ?? "";
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(directory, `${command}${suffix}`);
      try {
        accessSync(candidate, constants.X_OK);
        if (!lstatSync(candidate).isDirectory()) return candidate;
      } catch {
        // Continue without exposing host paths in the report.
      }
    }
  }
  return null;
}

function run(command, argv, timeout = 3_000) {
  const resolved = executable(command);
  if (!resolved) return { available: false, ok: false, output: "" };
  const result = spawnSync(resolved, argv, {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
  return {
    available: true,
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(0, 512),
  };
}

function firstVersion(output) {
  return output.match(/\b\d+(?:\.\d+){1,3}(?:[-+._a-zA-Z0-9]*)?\b/u)?.[0] ?? null;
}

const dockerVersion = run("docker", ["version", "--format", "{{.Server.Version}}"]);
const dockerInfo = run("docker", [
  "info",
  "--format",
  "{{json .SecurityOptions}}|{{.Architecture}}|{{.OSType}}",
]);
const dockerCompose = run("docker", ["compose", "version", "--short"]);
const localImageReference = imageKey === "codex" ? "rak-codex:0.1.0" : "rak-claude:0.1.0";
const localBrowserImageReference = "rak-browser:0.1.0";
const dockerImage = run("docker", [
  "image",
  "inspect",
  "--format",
  '{{.Id}}|{{index .Config.Labels "io.repo-assessment-kit.provider"}}',
  localImageReference,
]);
const browserDockerImage = run("docker", [
  "image",
  "inspect",
  "--format",
  '{{.Id}}|{{index .Config.Labels "io.repo-assessment-kit.component"}}|{{index .Config.Labels "io.repo-assessment-kit.playwright-version"}}',
  localBrowserImageReference,
]);
const dockerParts = dockerInfo.output.split("|");
const imageParts = dockerImage.output.split("|");
const browserImageParts = browserDockerImage.output.split("|");
const dockerRootless = dockerInfo.ok && dockerParts[0]?.includes("name=rootless");
const localImageReady =
  dockerImage.ok &&
  /^sha256:[0-9a-f]{64}$/u.test(imageParts[0] ?? "") &&
  imageParts[1] === expectedLabel;
const localBrowserImageReady =
  browserDockerImage.ok &&
  /^sha256:[0-9a-f]{64}$/u.test(browserImageParts[0] ?? "") &&
  browserImageParts[1] === "browser" &&
  browserImageParts[2] === "1.54.1";
const browserProbe = localBrowserImageReady
  ? run(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "256",
        "--memory",
        "1g",
        "--cpus",
        "2",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=256m",
        "--shm-size",
        "256m",
        localBrowserImageReference,
        "probe",
      ],
      15_000,
    )
  : { available: dockerVersion.available, ok: false, output: "" };

const podman = run("podman", ["version", "--format", "{{.Server.Version}}"]);
const lima = run("limactl", ["--version"]);
const ssh = run("ssh", ["-V"]);
const age = run("age", ["--version"]);
const codexHostCliAvailable = executable("codex") !== null;
const claudeHostCliAvailable = executable("claude") !== null;
const orchestratorPath = path.join(root, "scripts/run-release-assessment.mjs");
const orchestratorAvailable =
  existsSync(orchestratorPath) && !lstatSync(orchestratorPath).isSymbolicLink();

const engagementId = process.env.RAK_ENGAGEMENT_ID ?? "";
const engagementValid = /^[a-z0-9][a-z0-9-]{0,47}$/u.test(engagementId);
let helperConfig;
let helperAuthorityAvailable = false;
try {
  const socketInfo = lstatSync(HOST_HELPER_PATHS.socket);
  const keyInfo = lstatSync(HOST_HELPER_PATHS.clientKey);
  const configInfo = lstatSync(HOST_HELPER_PATHS.config);
  helperConfig = parseStrictJsonBytes(
    readFileSync(HOST_HELPER_PATHS.config),
    "host-helper configuration",
  );
  helperAuthorityAvailable =
    socketInfo.isSocket() &&
    !socketInfo.isSymbolicLink() &&
    (socketInfo.mode & 0o777) === 0o600 &&
    socketInfo.uid === helperConfig?.clientUid &&
    keyInfo.isFile() &&
    !keyInfo.isSymbolicLink() &&
    (keyInfo.mode & 0o777) === 0o600 &&
    keyInfo.uid === helperConfig?.clientUid &&
    keyInfo.size === 32 &&
    configInfo.isFile() &&
    !configInfo.isSymbolicLink() &&
    configInfo.uid === 0 &&
    configInfo.gid === helperConfig?.clientGid &&
    (configInfo.mode & 0o777) === 0o440 &&
    helperConfig?.schemaVersion === "rak-host-helper-config/1.0.0";
} catch {
  helperAuthorityAvailable = false;
}

const runtimeInstance = helperConfig?.runtime?.lima?.instance ?? "";
const runtimeInstanceValid = /^rak-runtime-[a-zA-Z0-9_-]{1,48}$/u.test(runtimeInstance);
let limaInstanceReachable = false;
if (lima.ok && runtimeInstanceValid) {
  limaInstanceReachable = run(
    "limactl",
    ["shell", runtimeInstance, "--", "sh", "-c", "exit 0"],
    5_000,
  ).ok;
}

const blockers = [];
const isolatedRuntimeBlockers = [];
const interactiveProviderBlockers = [];
const browserCoverageLimitations = [];
const block = (code, detail, remediation) => blockers.push({ code, detail, remediation });
const isolateBlock = (code, detail, remediation) =>
  isolatedRuntimeBlockers.push({ code, detail, remediation });
const interactiveBlock = (code, detail, remediation) =>
  interactiveProviderBlockers.push({ code, detail, remediation });
const browserLimit = (code, detail, remediation) =>
  browserCoverageLimitations.push({ code, detail, remediation });
if (!engagementValid) {
  interactiveBlock(
    "invalid_engagement_id",
    "The engagement identity is absent or invalid.",
    "Run preflight through start-codex.sh or start-cc.sh so a private .rak_id is loaded or created.",
  );
}
if (!dockerVersion.available) {
  block(
    "docker_unavailable",
    "Docker CLI was not found.",
    "Install Docker and configure an attested rootless daemon/context.",
  );
} else if (!dockerVersion.ok || !dockerInfo.ok) {
  block(
    "docker_daemon_unavailable",
    "The active Docker daemon is unreachable.",
    "Start the rootless Docker daemon/context.",
  );
} else if (!dockerRootless) {
  block(
    "docker_not_rootless",
    "The active Docker daemon did not attest rootless mode.",
    "Select an attested rootless Docker context; rootful fallback is prohibited.",
  );
}
if (dockerVersion.ok && !dockerCompose.ok) {
  block(
    "docker_compose_unavailable",
    "Docker Compose v2 is unavailable.",
    "Install the Docker Compose v2 plugin used by the release runtime.",
  );
}
if (dockerVersion.ok && dockerInfo.ok && dockerRootless && !localImageReady) {
  block(
    "local_provider_image_unavailable",
    `The ${provider} assessment container has not been built locally yet.`,
    "Build the containers from this repository. The guided start command can do this for you.",
  );
}
if (!orchestratorAvailable) {
  block(
    "orchestrator_unavailable",
    "The trusted host release orchestrator is absent or is a symbolic link.",
    "Restore scripts/run-release-assessment.mjs from this repository.",
  );
}
if (!lima.ok) {
  isolateBlock(
    "lima_unavailable",
    "Lima is not installed.",
    "Install the release-supported Lima version before enabling hostile target runtime.",
  );
} else if (!runtimeInstanceValid || !limaInstanceReachable) {
  isolateBlock(
    "native_runtime_unavailable",
    "The named disposable Lima runtime is absent, invalid, or unreachable.",
    "Create a fresh release-owned native-architecture runtime and run native isolation gates.",
  );
}
if (!helperAuthorityAvailable) {
  isolateBlock(
    "host_helper_authority_unavailable",
    "The advanced isolated-runtime helper is unavailable.",
    "Ask the technical operator to install the host helper if runtime execution is required. Static assessment can continue.",
  );
  interactiveBlock(
    "provider_helper_authority_unavailable",
    "Provider authority cannot be issued without the production helper.",
    "Install the signed helper configuration, provider home, image, and network authorities.",
  );
}
if (!localBrowserImageReady) {
  browserLimit(
    "browser_image_unavailable",
    "The local browser container containing Playwright and Chromium has not been built.",
    "Build the local containers or continue without screenshots.",
  );
} else if (!browserProbe.ok) {
  browserLimit(
    "browser_probe_failed",
    "The browser image could not complete its bounded Chromium launch test.",
    "Repair the browser image or continue without screenshots and browser-flow verification.",
  );
}

const staticAvailable = blockers.length === 0;
const isolatedAvailable = staticAvailable && isolatedRuntimeBlockers.length === 0;
const browserAvailable = browserCoverageLimitations.length === 0;
const recommendation = !staticAvailable
  ? {
      mode: "blocked",
      label: "Not ready to assess",
      detail: "Resolve the required blockers before starting an assessment.",
    }
  : isolatedAvailable && browserAvailable
    ? {
        mode: "full-isolated-browser",
        label: "Full isolated assessment with browser evidence",
        detail:
          "This is the fullest compatible mode: isolated runtime testing, screenshots, and browser-flow verification are available.",
      }
    : isolatedAvailable
      ? {
          mode: "isolated-without-browser",
          label: "Isolated assessment without browser evidence",
          detail:
            "Runtime isolation is available. Continue without screenshots or browser-flow verification.",
        }
      : browserAvailable
        ? {
            mode: "static-with-browser",
            label: "Static assessment with browser evidence",
            detail:
              "Browser evidence is available, but hostile target runtime isolation is not. Use static analysis and approved external application URLs only.",
          }
        : {
            mode: "static-without-browser",
            label: "Static assessment without browser evidence",
            detail:
              "Code, architecture, dependency, security, and use-case analysis can continue without screenshots or browser-flow verification.",
          };

const report = {
  schemaVersion: "rak-runtime-preflight/1.0.0",
  generatedAt: new Date().toISOString(),
  provider,
  status: blockers.length === 0 ? "available" : "blocked",
  recommendation,
  host: {
    platform: os.platform(),
    architecture: os.arch(),
  },
  capabilities: {
    readiness: {
      staticRelease: {
        status: blockers.length === 0 ? "available" : "blocked",
        blockers,
      },
      isolatedRuntime: {
        status:
          blockers.length === 0 && isolatedRuntimeBlockers.length === 0 ? "available" : "blocked",
        blockers: [...blockers, ...isolatedRuntimeBlockers],
      },
      interactiveProvider: {
        status:
          blockers.length === 0 && interactiveProviderBlockers.length === 0
            ? "available"
            : "blocked",
        blockers: [...blockers, ...interactiveProviderBlockers],
      },
    },
    docker: {
      cliAvailable: dockerVersion.available,
      daemonReachable: dockerVersion.ok && dockerInfo.ok,
      version: firstVersion(dockerVersion.output),
      rootless: dockerRootless,
      serverArchitecture: dockerInfo.ok ? dockerParts[1] || null : null,
      serverOs: dockerInfo.ok ? dockerParts[2] || null : null,
      composeV2: dockerCompose.ok,
      composeVersion: firstVersion(dockerCompose.output),
    },
    podmanDiagnosticOnly: {
      available: podman.available,
      reachable: podman.ok,
      version: firstVersion(podman.output),
      supportedForRelease: false,
    },
    lima: {
      available: lima.available,
      version: firstVersion(lima.output),
      instanceNameValid: runtimeInstanceValid,
      instanceReachable: limaInstanceReachable,
      nativeArchitectureRequired: true,
    },
    providerImage: {
      reference: localImageReference,
      builtLocally: true,
      present: dockerImage.ok,
      imageId: localImageReady ? imageParts[0] : null,
      identityVerified: localImageReady,
    },
    providerHostCliDiagnosticOnly: {
      codex: { available: codexHostCliAvailable, executed: false },
      claudeCode: { available: claudeHostCliAvailable, executed: false },
      usedForRelease: false,
      note: "Host provider CLIs are never executed by preflight or used for release.",
    },
    sshClient: { available: ssh.available, version: firstVersion(ssh.output) },
    age: { available: age.available, version: firstVersion(age.output) },
    playwright: {
      packagedInBrowserImage: true,
      reference: localBrowserImageReference,
      imagePresent: browserDockerImage.ok,
      identityVerified: localBrowserImageReady,
      version: localBrowserImageReady ? browserImageParts[2] : null,
      browserExecutablePresent: localBrowserImageReady,
      boundedLaunchSmoke: browserProbe.ok,
      optionalForStaticAssessment: true,
    },
    trustedOrchestrator: { available: orchestratorAvailable },
    hostHelper: {
      authorityAvailable: helperAuthorityAvailable,
      fixedPaths: true,
      directRuntimeFallback: false,
    },
    providerEgress: {
      configured: helperAuthorityAvailable,
      verified: false,
      note: "Preflight is read-only. A fresh signature, scope, endpoint, network ID, nonce, and expiry are verified and consumed immediately before login or interactive use.",
    },
  },
  blockers,
  limitations: {
    isolatedRuntime: isolatedRuntimeBlockers,
    interactiveProvider: interactiveProviderBlockers,
    browserCoverage: browserCoverageLimitations,
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (blockers.length > 0) process.exit(78);

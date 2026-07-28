import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const HOST_HELPER_MODULE_PATHS = Object.freeze({
  productionHostHelper: "scripts/production-host-helper.mjs",
  hostHelperService: "scripts/host-helper-service.mjs",
  hostHelperJournal: "scripts/host-helper-journal.mjs",
  hostHelperOperations: "scripts/host-helper-operations.mjs",
  hostHelperProtocol: "scripts/host-helper-protocol.mjs",
  productionInstallationConfig: "scripts/production-installation-config.mjs",
  providerTask: "container/provider-task.mjs",
  installationValidator: "container/runtime/install/validate-production-host-helper.mjs",
  serviceEntrypoint: "container/runtime/install/service-entrypoint.mjs",
});

export const HOST_HELPER_SERVICE_PATHS = Object.freeze({
  linux: "container/runtime/install/repo-assessment-kit-host-helper.service",
  macos: "container/runtime/install/com.repo-assessment-kit.host-helper.plist",
});

export const HOST_HELPER_INSTALLER_PATH = "scripts/install-production-host-helper.sh";

export const HOST_HELPER_PLATFORM_PATHS = Object.freeze({
  "linux-arm64": Object.freeze({
    platform: "linux",
    architecture: "arm64",
    node: "container/runtime/install/payload/linux-arm64/node",
    peerVerifier: "container/runtime/install/payload/linux-arm64/rak-peer-cred",
  }),
  "linux-x86-64": Object.freeze({
    platform: "linux",
    architecture: "x86-64",
    node: "container/runtime/install/payload/linux-x86-64/node",
    peerVerifier: "container/runtime/install/payload/linux-x86-64/rak-peer-cred",
  }),
  "macos-arm64": Object.freeze({
    platform: "macos",
    architecture: "arm64",
    node: "container/runtime/install/payload/macos-arm64/node",
    peerVerifier: "container/runtime/install/payload/macos-arm64/rak-peer-cred",
  }),
  "macos-x86-64": Object.freeze({
    platform: "macos",
    architecture: "x86-64",
    node: "container/runtime/install/payload/macos-x86-64/node",
    peerVerifier: "container/runtime/install/payload/macos-x86-64/rak-peer-cred",
  }),
});

const IMAGE_DEFINITIONS = Object.freeze([
  ["codex", "RAK_CODEX_IMAGE_DIGEST", "rak-codex:0.1.0"],
  ["claude", "RAK_CLAUDE_IMAGE_DIGEST", "rak-claude:0.1.0"],
  ["acquisition", "RAK_ACQUISITION_IMAGE_DIGEST", "rak-acquisition:0.1.0"],
  ["browser", "RAK_BROWSER_IMAGE_DIGEST", "rak-browser:0.1.0"],
]);
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function artifact(root, relativePath) {
  return {
    path: relativePath,
    sha256: sha256(await readFile(path.join(root, relativePath))),
  };
}

export async function createHostHelperReleaseSection(root) {
  const modules = Object.fromEntries(
    await Promise.all(
      Object.entries(HOST_HELPER_MODULE_PATHS).map(async ([name, relativePath]) => [
        name,
        await artifact(root, relativePath),
      ]),
    ),
  );
  const serviceDefinitions = Object.fromEntries(
    await Promise.all(
      Object.entries(HOST_HELPER_SERVICE_PATHS).map(async ([name, relativePath]) => [
        name,
        await artifact(root, relativePath),
      ]),
    ),
  );
  const platforms = Object.fromEntries(
    await Promise.all(
      Object.entries(HOST_HELPER_PLATFORM_PATHS).map(async ([name, definition]) => [
        name,
        {
          platform: definition.platform,
          architecture: definition.architecture,
          nodeVersion: "v24.4.1",
          node: await artifact(root, definition.node),
          peerVerifier: await artifact(root, definition.peerVerifier),
        },
      ]),
    ),
  );
  return {
    profile: "rak-host-helper-release/1.0.0",
    installer: await artifact(root, HOST_HELPER_INSTALLER_PATH),
    modules,
    platforms,
    serviceDefinitions,
  };
}

export async function createReleaseManifestFixtureTestOnly(options) {
  if (
    options?.mode !== "fixture-test-only" ||
    typeof options.root !== "string" ||
    typeof options.sourceCommit !== "string" ||
    typeof options.createdAt !== "string" ||
    options.images === undefined
  ) {
    throw new Error("explicit fixture-test-only manifest inputs are required");
  }
  return {
    schemaVersion: 2,
    createdAt: options.createdAt,
    sourceCommit: options.sourceCommit,
    nodeVersion: "24.4.1",
    pnpmVersion: "11.17.0",
    images: structuredClone(options.images),
    hostHelper: await createHostHelperReleaseSection(path.resolve(options.root)),
  };
}

function productionImages() {
  return Object.fromEntries(
    IMAGE_DEFINITIONS.map(([name, variable, reference]) => {
      const digest = process.env[variable];
      if (!DIGEST.test(digest ?? "")) {
        throw new Error(`${variable} must contain a verified sha256 image digest`);
      }
      return [name, { reference, digest, platforms: ["linux/amd64", "linux/arm64"] }];
    }),
  );
}

async function main() {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3) {
    process.stderr.write("usage: pnpm release:manifest -- OUTPUT.json\n");
    process.exitCode = 64;
    return;
  }
  const root = path.resolve(import.meta.dirname, "..");
  let sourceCommit;
  try {
    sourceCommit = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error("release manifest requires a committed source revision");
  }
  const manifest = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    sourceCommit,
    nodeVersion: "24.4.1",
    pnpmVersion: "11.17.0",
    images: productionImages(),
    hostHelper: await createHostHelperReleaseSection(root),
  };
  await writeFile(path.resolve(output), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o444,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "release manifest creation failed"}\n`,
    );
    process.exitCode = 65;
  }
}

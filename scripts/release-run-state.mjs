import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  chmod,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  stat,
} from "node:fs/promises";
import path from "node:path";

export const RELEASE_STATE_FILE = "release-run-state.json";
export const RELEASE_RECEIPT_FILE = "release-verification-receipt.json";
export const RELEASE_STATE_VERSION = "1.0.0";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ENV_HANDLE = /^RAK_SANDBOX_[A-Z0-9_]{1,112}$/u;
const BOUNDED_ID = /^[a-z0-9][a-z0-9._/-]{0,127}$/u;
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/u;
const TERMINAL = new Set([
  "COMPLETED",
  "DRAFT_VALIDATED_RELEASE_BLOCKED",
  "CANCELLED",
  "FAILED_INTEGRITY",
  "DRIFTED",
]);
const RESUMABLE_STAGES = new Set(["OFFLINE_DRAFT", "PROVIDER_TASKS", "PACKAGE_VALIDATION"]);
const CONFIG_KEYS = [
  "schemaVersion",
  "projectSlug",
  "source",
  "discoveryPath",
  "outputRoot",
  "runtime",
  "sandboxCredentials",
  "optionalServices",
];

export class ReleaseRunError extends Error {
  constructor(code, message, remediation, details = undefined) {
    super(message);
    this.name = "ReleaseRunError";
    this.code = code;
    this.remediation = remediation;
    if (details !== undefined) this.details = details;
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ReleaseRunError(
      "JSON_NOT_IJSON",
      "JSON contains a non-finite number.",
      "Replace the value with a finite I-JSON number.",
    );
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function stableReleaseId(prefix, ...parts) {
  const hex = createHash("sha256").update(parts.join("\0")).digest("hex");
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedString(value, maximum = 4096) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function assertConfig(condition, code, message, remediation) {
  if (!condition) throw new ReleaseRunError(code, message, remediation);
}

export function normalizeSshSourceUrl(value) {
  const hasWhitespaceControlOrBackslash =
    typeof value === "string" &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x20 || codePoint === 0x7f || character === "\\";
    });
  assertConfig(
    boundedString(value) &&
      !hasWhitespaceControlOrBackslash &&
      !value.includes("%") &&
      !value.startsWith("-"),
    "CONFIG_SSH_SOURCE_INVALID",
    "SSH URL contains whitespace, controls, escapes, or option-like input.",
    "Use a literal ssh://user@host[:port]/owner/repo.git or user@host:owner/repo.git URL.",
  );
  let user;
  let host;
  let port = 22;
  let repositoryPath;
  if (value.startsWith("ssh://")) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      parsed = undefined;
    }
    assertConfig(
      parsed !== undefined &&
        parsed.protocol === "ssh:" &&
        parsed.username.length > 0 &&
        parsed.password === "" &&
        parsed.search === "" &&
        parsed.hash === "" &&
        parsed.hostname.length > 0 &&
        parsed.pathname.startsWith("/") &&
        parsed.pathname.length > 1,
      "CONFIG_SSH_SOURCE_INVALID",
      "SSH URL has malformed authority, credentials, query, fragment, or repository path.",
      "Use ssh://user@host[:port]/owner/repo.git without password, query, or fragment.",
    );
    user = parsed.username;
    host = parsed.hostname.toLowerCase();
    if (parsed.port !== "") {
      port = Number(parsed.port);
      assertConfig(
        Number.isInteger(port) && port >= 1 && port <= 65535,
        "CONFIG_SSH_SOURCE_INVALID",
        "SSH URL port is invalid.",
        "Use an explicit decimal port from 1 through 65535.",
      );
    }
    repositoryPath = parsed.pathname.slice(1);
  } else {
    const match =
      /^([A-Za-z0-9][A-Za-z0-9._-]{0,63})@([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?):([^:]+)$/u.exec(
        value,
      );
    assertConfig(
      match !== null,
      "CONFIG_SSH_SOURCE_INVALID",
      "SCP-style SSH URL is malformed or ambiguous.",
      "Use user@host:owner/repo.git with an exact DNS hostname.",
    );
    [, user, host, repositoryPath] = match;
    host = host.toLowerCase();
  }
  assertConfig(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(user) &&
      HOST.test(host) &&
      host !== "localhost" &&
      !/^\d+(?:\.\d+){3}$/u.test(host) &&
      repositoryPath.length <= 2048 &&
      !repositoryPath.startsWith("-") &&
      !repositoryPath.startsWith("/") &&
      !repositoryPath.includes("//") &&
      repositoryPath
        .split("/")
        .every(
          (segment) =>
            segment.length > 0 &&
            segment !== "." &&
            segment !== ".." &&
            /^[A-Za-z0-9._+-]+$/u.test(segment),
        ),
    "CONFIG_SSH_SOURCE_INVALID",
    "SSH user, host, or repository path is unsafe or outside the release grammar.",
    "Use a DNS host and a repository-relative path with ordinary Git path characters.",
  );
  return {
    user,
    host,
    port,
    repositoryPath,
    normalized: `ssh://${user}@${host}:${port}/${repositoryPath}`,
  };
}

// JSON.parse silently accepts duplicate members. This scanner recognizes JSON strings and
// object scopes before JSON.parse so a duplicate can never be normalized away.
function rejectDuplicateMembers(text) {
  const stack = [];
  let index = 0;
  let expectingKey = false;
  function skipWhitespace() {
    while (index < text.length && /\s/u.test(text[index])) index += 1;
  }
  function readString() {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      index += 1;
    }
    throw new SyntaxError("unterminated JSON string");
  }
  while (index < text.length) {
    skipWhitespace();
    const character = text[index];
    if (character === undefined) break;
    if (character === "{") {
      stack.push({ kind: "object", keys: new Set() });
      expectingKey = true;
      index += 1;
    } else if (character === "[") {
      stack.push({ kind: "array" });
      expectingKey = false;
      index += 1;
    } else if (character === "}" || character === "]") {
      stack.pop();
      expectingKey = false;
      index += 1;
    } else if (character === ",") {
      expectingKey = stack.at(-1)?.kind === "object";
      index += 1;
    } else if (character === '"') {
      const value = readString();
      skipWhitespace();
      if (expectingKey && stack.at(-1)?.kind === "object" && text[index] === ":") {
        const scope = stack.at(-1);
        if (scope.keys.has(value)) throw new SyntaxError(`duplicate JSON member: ${value}`);
        scope.keys.add(value);
        expectingKey = false;
      }
    } else {
      index += 1;
    }
  }
}

export function parseStrictJson(text, label = "JSON document") {
  assertConfig(
    Buffer.byteLength(text, "utf8") <= 1_048_576,
    "CONFIG_TOO_LARGE",
    `${label} exceeds the 1 MiB limit.`,
    "Reduce the document to the frozen release fields.",
  );
  try {
    rejectDuplicateMembers(text);
    return JSON.parse(text);
  } catch (error) {
    throw new ReleaseRunError(
      "CONFIG_JSON_INVALID",
      `${label} is not strict JSON: ${error instanceof Error ? error.message : String(error)}`,
      "Provide UTF-8 JSON with unique object members and no comments.",
    );
  }
}

export function validateReleaseConfig(value) {
  assertConfig(
    exactKeys(value, CONFIG_KEYS),
    "CONFIG_SHAPE_INVALID",
    "Release configuration has missing or unknown fields.",
    "Validate the file against release/assessment-run.schema.json.",
  );
  assertConfig(
    value.schemaVersion === "1.0.0",
    "CONFIG_VERSION_UNSUPPORTED",
    "Only rak-release-run-config/1.0.0 is supported.",
    "Set schemaVersion to 1.0.0 and use the frozen field set.",
  );
  assertConfig(
    boundedString(value.projectSlug, 80) && PROJECT_SLUG.test(value.projectSlug),
    "CONFIG_PROJECT_INVALID",
    "projectSlug must be lowercase kebab-case and at most 80 characters.",
    "Use a slug such as customer-portal.",
  );
  assertConfig(
    value.source !== null && typeof value.source === "object" && !Array.isArray(value.source),
    "CONFIG_SOURCE_INVALID",
    "source must be a typed local or SSH source.",
    "Use the local or ssh object from the release schema.",
  );
  if (value.source.kind === "local") {
    assertConfig(
      exactKeys(value.source, ["kind", "path", "workingTreeMode"]) &&
        boundedString(value.source.path) &&
        value.source.workingTreeMode === "frozen-working-tree",
      "CONFIG_LOCAL_SOURCE_INVALID",
      "Local source does not match the frozen-working-tree contract.",
      "Supply kind, path, and workingTreeMode=frozen-working-tree only.",
    );
  } else if (value.source.kind === "ssh") {
    const keys =
      value.source.ref === undefined
        ? ["kind", "url", "acquisitionProfileId"]
        : ["kind", "url", "ref", "acquisitionProfileId"];
    assertConfig(
      exactKeys(value.source, keys) &&
        boundedString(value.source.url) &&
        normalizeSshSourceUrl(value.source.url) !== undefined &&
        boundedString(value.source.acquisitionProfileId, 128) &&
        BOUNDED_ID.test(value.source.acquisitionProfileId) &&
        (value.source.ref === undefined || boundedString(value.source.ref, 512)),
      "CONFIG_SSH_SOURCE_INVALID",
      "SSH source does not match the trusted acquisition contract.",
      "Use ssh:// or git@host:path with a release-owned acquisitionProfileId.",
    );
  } else {
    throw new ReleaseRunError(
      "CONFIG_SOURCE_KIND_UNSUPPORTED",
      "source.kind must be local or ssh.",
      "Choose one of the two frozen source variants.",
    );
  }
  for (const [field, item] of [
    ["discoveryPath", value.discoveryPath],
    ["outputRoot", value.outputRoot],
  ]) {
    assertConfig(
      boundedString(item),
      "CONFIG_PATH_INVALID",
      `${field} must be a non-empty bounded path.`,
      `Supply an absolute or kit-repository-relative ${field}.`,
    );
  }
  const isolatedRuntimeKeys = [
    "mode",
    "targetOrigins",
    "selectedProfileIds",
    "approvalIds",
    "plannedControlIds",
    "probeProfileId",
    "candidateRelPaths",
    "declaredArtifactIds",
    "artifactByteLimit",
    ...(value.runtime?.buildAcquisitionApprovalId === undefined
      ? []
      : ["buildAcquisitionApprovalId"]),
    ...(value.runtime?.controlPlanLifetimeSeconds === undefined
      ? []
      : ["controlPlanLifetimeSeconds"]),
  ];
  assertConfig(
    exactKeys(
      value.runtime,
      value.runtime?.mode === "isolated" ? isolatedRuntimeKeys : ["mode", "targetOrigins"],
    ) &&
      ["static-only", "isolated"].includes(value.runtime.mode) &&
      Array.isArray(value.runtime.targetOrigins) &&
      value.runtime.targetOrigins.length <= 32,
    "CONFIG_RUNTIME_INVALID",
    "runtime does not match the frozen capability request.",
    "Use mode static-only or isolated and a bounded targetOrigins array.",
  );
  for (const origin of value.runtime.targetOrigins) {
    assertConfig(
      exactKeys(origin, ["scheme", "host", "port"]) &&
        ["http", "https"].includes(origin.scheme) &&
        boundedString(origin.host, 253) &&
        HOST.test(origin.host) &&
        !origin.host.includes("*") &&
        Number.isInteger(origin.port) &&
        origin.port >= 1 &&
        origin.port <= 65535,
      "CONFIG_ORIGIN_INVALID",
      "A target origin is malformed or contains a wildcard.",
      "Supply an exact http/https host and port.",
    );
  }
  if (value.runtime.mode === "isolated") {
    assertConfig(
      value.source.kind === "ssh",
      "CONFIG_ISOLATED_SOURCE_UNSUPPORTED",
      "Isolated runtime requires a helper-owned trusted SSH snapshot.",
      "Use source.kind=ssh; local client snapshots have no safe client-to-helper byte channel.",
    );
    for (const field of [
      "selectedProfileIds",
      "approvalIds",
      "plannedControlIds",
      "candidateRelPaths",
      "declaredArtifactIds",
    ]) {
      const entries = value.runtime[field];
      assertConfig(
        Array.isArray(entries) &&
          entries.length <= 64 &&
          new Set(entries).size === entries.length &&
          entries.every((entry) =>
            field === "candidateRelPaths"
              ? boundedString(entry, 512) &&
                !path.posix.isAbsolute(entry) &&
                !entry.includes("\\") &&
                entry.split("/").every((part) => part !== "" && part !== "." && part !== "..")
              : BOUNDED_ID.test(entry),
          ),
        "CONFIG_RUNTIME_SELECTOR_INVALID",
        `${field} contains an invalid, duplicated, or unbounded selector.`,
        "Use only registered bounded IDs and safe relative candidate paths.",
      );
    }
    assertConfig(
      BOUNDED_ID.test(value.runtime.probeProfileId) &&
        /^(?:[1-9]\d*)$/u.test(value.runtime.artifactByteLimit) &&
        Number(value.runtime.artifactByteLimit) <= 16 * 1024 * 1024 &&
        (value.runtime.buildAcquisitionApprovalId === undefined ||
          BOUNDED_ID.test(value.runtime.buildAcquisitionApprovalId)) &&
        (value.runtime.controlPlanLifetimeSeconds === undefined ||
          (Number.isSafeInteger(value.runtime.controlPlanLifetimeSeconds) &&
            value.runtime.controlPlanLifetimeSeconds >= 1 &&
            value.runtime.controlPlanLifetimeSeconds <= 1800)),
      "CONFIG_RUNTIME_SELECTOR_INVALID",
      "Isolated runtime selectors or limits are invalid.",
      "Use registered selectors, a bounded artifact limit, and at most a 30-minute plan lifetime.",
    );
  }
  assertConfig(
    Array.isArray(value.sandboxCredentials) && value.sandboxCredentials.length <= 32,
    "CONFIG_CREDENTIALS_INVALID",
    "sandboxCredentials must be a bounded array.",
    "Supply only non-production handle metadata.",
  );
  const handles = new Set();
  const handleIds = new Set();
  for (const credential of value.sandboxCredentials) {
    assertConfig(
      exactKeys(credential, [
        "handleId",
        "purpose",
        "recipient",
        "handleEnvironment",
        "approvalDigest",
        "expiresAt",
        "production",
      ]) &&
        BOUNDED_ID.test(credential.handleId) &&
        credential.purpose === "probe" &&
        BOUNDED_ID.test(credential.recipient) &&
        ENV_HANDLE.test(credential.handleEnvironment) &&
        DIGEST.test(credential.approvalDigest) &&
        Number.isFinite(Date.parse(credential.expiresAt)) &&
        credential.production === false &&
        !handleIds.has(credential.handleId) &&
        !handles.has(credential.handleEnvironment),
      "CONFIG_CREDENTIAL_INVALID",
      "A sandbox credential is malformed, duplicated, or not explicitly non-production.",
      "Use unique probe-only RAK_SANDBOX_* sealed-value handles and production:false.",
    );
    handles.add(credential.handleEnvironment);
    handleIds.add(credential.handleId);
  }
  assertConfig(
    Array.isArray(value.optionalServices) && value.optionalServices.length === 0,
    "CONFIG_OPTIONAL_SERVICE_DENIED",
    "Optional services are disabled for the MVP release run.",
    "Set optionalServices to an empty array.",
  );
  if (value.runtime.mode === "static-only") {
    assertConfig(
      value.runtime.targetOrigins.length === 0 && value.sandboxCredentials.length === 0,
      "CONFIG_STATIC_AUTHORITY_INVALID",
      "Static-only runs cannot request origins or sandbox credentials.",
      "Remove targetOrigins and sandboxCredentials or select isolated mode.",
    );
  }
  return structuredClone(value);
}

export async function loadReleaseConfig(configPath, kitRoot) {
  const absolute = path.resolve(kitRoot, configPath);
  const info = await lstat(absolute).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.isSymbolicLink()) {
    throw new ReleaseRunError(
      "CONFIG_PATH_UNSAFE",
      "Configuration must be a real regular file and not a symbolic link.",
      "Place the JSON configuration in the kit repository or use a trusted absolute file.",
    );
  }
  return {
    path: await realpath(absolute),
    config: validateReleaseConfig(parseStrictJson(await readFile(absolute, "utf8"), "config")),
  };
}

export function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export async function resolveGeneratedRoot(candidate, kitRoot) {
  const generatedRoot = path.join(await realpath(kitRoot), "generated");
  await mkdir(generatedRoot, { recursive: true, mode: 0o700 });
  const generatedInfo = await lstat(generatedRoot);
  assertConfig(
    generatedInfo.isDirectory() &&
      !generatedInfo.isSymbolicLink() &&
      (typeof process.getuid !== "function" || generatedInfo.uid === process.getuid()),
    "OUTPUT_ROOT_PERMISSIONS_UNSAFE",
    "The kit generated directory is not an owner-controlled real directory.",
    "Restore generated/ as a directory owned by the current account.",
  );
  await chmod(generatedRoot, 0o700);
  await assertPrivateOwnedPath(generatedRoot, "directory");
  const requested = path.resolve(kitRoot, candidate);
  assertConfig(
    isWithin(generatedRoot, requested),
    "OUTPUT_ROOT_OUTSIDE_GENERATED",
    "outputRoot must resolve beneath the kit generated/ directory.",
    "Use generated or a child such as generated/customer.",
  );
  const suffix = path.relative(generatedRoot, requested);
  let cursor = generatedRoot;
  for (const segment of suffix === "" ? [] : suffix.split(path.sep)) {
    const child = path.join(cursor, segment);
    const existing = await lstat(child).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing === undefined) {
      await mkdir(child, { mode: 0o700 });
      await fsyncDirectory(cursor);
    } else {
      assertConfig(
        existing.isDirectory() &&
          !existing.isSymbolicLink() &&
          (typeof process.getuid !== "function" || existing.uid === process.getuid()) &&
          (existing.mode & 0o077) === 0,
        "OUTPUT_ROOT_COMPONENT_UNSAFE",
        "outputRoot contains a symlink, non-directory, foreign-owned, or shared component.",
        "Use owner-private real directories beneath generated/.",
      );
    }
    cursor = child;
  }
  const canonical = await realpath(requested);
  assertConfig(
    isWithin(generatedRoot, canonical),
    "OUTPUT_ROOT_SYMLINK_ESCAPE",
    "outputRoot resolves outside generated/ through a symbolic link.",
    "Remove the symlink and use a real directory beneath generated/.",
  );
  return canonical;
}

function gitRead(sourceRoot, arguments_) {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      ...arguments_,
    ],
    {
      cwd: sourceRoot,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
        NO_PROXY: "*",
        no_proxy: "*",
      },
    },
  );
}

export async function captureLocalSourceBinding(candidate) {
  const supplied = path.resolve(candidate);
  const suppliedInfo = await lstat(supplied).catch(() => undefined);
  assertConfig(
    suppliedInfo !== undefined && suppliedInfo.isDirectory() && !suppliedInfo.isSymbolicLink(),
    "LOCAL_SOURCE_PATH_UNSAFE",
    "Local source must be a real directory, not a symbolic link.",
    "Use the canonical root of an existing Git worktree.",
  );
  const sourceRoot = await realpath(supplied);
  assertConfig(
    sourceRoot !== path.parse(sourceRoot).root,
    "LOCAL_SOURCE_PATH_UNSAFE",
    "Filesystem root cannot be assessed.",
    "Select the exact Git worktree root.",
  );
  let commitSha;
  let topLevel;
  try {
    commitSha = gitRead(sourceRoot, ["rev-parse", "--verify", "HEAD^{commit}"])
      .toString("utf8")
      .trim();
    topLevel = gitRead(sourceRoot, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  } catch {
    throw new ReleaseRunError(
      "LOCAL_SOURCE_GIT_INVALID",
      "Local source is not a Git worktree with a valid HEAD commit.",
      "Commit the intended immutable assessment scope and retry from its worktree root.",
    );
  }
  assertConfig(
    path.resolve(topLevel) === sourceRoot && /^[a-f0-9]{40,64}$/u.test(commitSha),
    "LOCAL_SOURCE_SCOPE_INVALID",
    "Local source must be the canonical Git worktree root with a full commit ID.",
    "Pass the exact worktree root instead of a parent or subdirectory.",
  );
  const entries = [];
  let fileCount = 0;
  let byteCount = 0;
  async function visit(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => compareUtf8(left.name, right.name));
    for (const child of children) {
      if (relativeDirectory === "" && child.name === ".git") continue;
      const relativePath =
        relativeDirectory === "" ? child.name : `${relativeDirectory}/${child.name}`;
      const absolutePath = path.join(directory, child.name);
      const info = await lstat(absolutePath);
      if (info.isDirectory()) {
        entries.push({ path: `${relativePath}/`, kind: "directory", mode: info.mode & 0o777 });
        await visit(absolutePath, relativePath);
      } else if (info.isFile()) {
        fileCount += 1;
        byteCount += info.size;
        assertConfig(
          fileCount <= 100_000 && byteCount <= 2 * 1024 * 1024 * 1024,
          "LOCAL_SOURCE_BUDGET_EXCEEDED",
          "Local source exceeds the release integrity-snapshot budget.",
          "Reduce the immutable scope or revise the frozen budget through the tech lead.",
        );
        entries.push({
          path: relativePath,
          kind: "file",
          mode: info.mode & 0o777,
          byteLength: String(info.size),
          sha256: sha256(await readFile(absolutePath)),
        });
      } else if (info.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          kind: "symlink",
          linkMetadataDigest: sha256(await readlink(absolutePath)),
        });
      } else {
        throw new ReleaseRunError(
          "LOCAL_SOURCE_SPECIAL_FILE",
          `Local source contains an unsupported special entry: ${relativePath}`,
          "Remove the special entry from the frozen assessment scope.",
        );
      }
    }
  }
  await visit(sourceRoot, "");
  const status = gitRead(sourceRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return {
    kind: "local",
    path: sourceRoot,
    commitSha,
    manifestDigest: sha256(canonicalJson(entries)),
    workingTreeDigest: sha256(status),
    sourceDigest: sha256(canonicalJson({ commitSha, entries, statusDigest: sha256(status) })),
    fileCount,
    byteCount: String(byteCount),
  };
}

export async function captureLocalGitBinding(candidate) {
  const supplied = path.resolve(candidate);
  const info = await lstat(supplied).catch(() => undefined);
  assertConfig(
    info !== undefined && info.isDirectory() && !info.isSymbolicLink(),
    "LOCAL_SOURCE_PATH_UNSAFE",
    "Local source must be a real directory, not a symbolic link.",
    "Use the canonical root of an existing Git worktree.",
  );
  const sourceRoot = await realpath(supplied);
  let topLevel;
  let commitSha;
  let objectFormat;
  let treeObjectId;
  let index;
  let status;
  try {
    topLevel = gitRead(sourceRoot, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
    commitSha = gitRead(sourceRoot, ["rev-parse", "--verify", "HEAD^{commit}"])
      .toString("utf8")
      .trim();
    objectFormat = gitRead(sourceRoot, ["rev-parse", "--show-object-format"])
      .toString("utf8")
      .trim();
    treeObjectId = gitRead(sourceRoot, ["rev-parse", "HEAD^{tree}"]).toString("utf8").trim();
    index = gitRead(sourceRoot, ["ls-files", "--stage", "-z"]);
    status = gitRead(sourceRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  } catch {
    throw new ReleaseRunError(
      "LOCAL_SOURCE_GIT_INVALID",
      "Local source is not a Git worktree with a valid immutable HEAD.",
      "Commit the intended scope and retry from its exact worktree root.",
    );
  }
  assertConfig(
    path.resolve(topLevel) === sourceRoot &&
      /^[a-f0-9]{40,64}$/u.test(commitSha) &&
      /^[a-f0-9]{40,64}$/u.test(treeObjectId) &&
      ["sha1", "sha256"].includes(objectFormat),
    "LOCAL_SOURCE_SCOPE_INVALID",
    "Git returned an invalid root or object identity.",
    "Pass the exact canonical worktree root.",
  );
  return {
    kind: "local",
    path: sourceRoot,
    objectFormat,
    commitSha,
    treeObjectId,
    indexDigest: sha256(index),
    statusDigest: sha256(status),
    dirty: status.byteLength > 0,
  };
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function atomicFsyncWrite(destination, content, mode = 0o600) {
  const directory = path.dirname(destination);
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  const handle = await open(
    temporary,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    mode,
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, destination);
  await fsyncDirectory(directory);
}

export async function exclusiveFsyncWrite(destination, content, mode = 0o600) {
  const handle = await open(
    destination,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    mode,
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsyncDirectory(path.dirname(destination));
}

export function journalBinding(state) {
  return sha256(
    canonicalJson({
      runId: state.runId,
      provider: state.provider,
      configDigest: state.configDigest,
      source: state.source,
      snapshot: state.snapshot,
      runDirectory: state.runDirectory,
      createdAt: state.createdAt,
    }),
  );
}

export async function writeJournal(runDirectory, state) {
  const next = structuredClone(state);
  next.updatedAt = new Date().toISOString();
  next.revision = (state.revision ?? 0) + 1;
  next.journalBindingDigest = journalBinding(next);
  next.journalDigest = sha256(
    canonicalJson({
      ...next,
      journalDigest: undefined,
    }),
  );
  await atomicFsyncWrite(
    path.join(runDirectory, RELEASE_STATE_FILE),
    `${JSON.stringify(next, null, 2)}\n`,
  );
  Object.assign(state, next);
  return state;
}

async function assertPrivateOwnedPath(absolutePath, kind) {
  const info = await lstat(absolutePath).catch(() => undefined);
  assertConfig(
    info !== undefined &&
      !info.isSymbolicLink() &&
      (kind === "directory" ? info.isDirectory() : info.isFile()),
    "RUN_PATH_UNSAFE",
    `Release ${kind} is missing, symbolic, or has the wrong type.`,
    "Use the exact generated run directory created by this kit.",
  );
  const currentUser = typeof process.getuid === "function" ? process.getuid() : undefined;
  assertConfig(
    (currentUser === undefined || info.uid === currentUser) && (info.mode & 0o077) === 0,
    "RUN_PATH_PERMISSIONS_UNSAFE",
    `Release ${kind} is not owner-private.`,
    `Set the ${kind} owner to the current account and remove group/other permissions.`,
  );
}

async function assertNoSymlinkComponents(generatedRoot, requestedDirectory) {
  const relative = path.relative(generatedRoot, requestedDirectory);
  assertConfig(
    relative !== "" &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative),
    "RUN_DIRECTORY_OUTSIDE_GENERATED",
    "Run directory is not a child of this kit's generated directory.",
    "Pass the exact runDirectory emitted by the release runner.",
  );
  let cursor = generatedRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    await assertPrivateOwnedPath(cursor, "directory");
  }
}

export async function loadJournal(runDirectory, kitRoot) {
  const canonicalKitRoot = await realpath(kitRoot);
  const generatedRoot = path.join(canonicalKitRoot, "generated");
  await assertPrivateOwnedPath(generatedRoot, "directory");
  const requestedDirectory = path.resolve(runDirectory);
  await assertNoSymlinkComponents(generatedRoot, requestedDirectory);
  const canonicalDirectory = await realpath(requestedDirectory).catch(() => undefined);
  if (canonicalDirectory === undefined) {
    throw new ReleaseRunError(
      "RUN_DIRECTORY_NOT_FOUND",
      "The supplied generated run directory does not exist.",
      "Pass the exact runDirectory returned by the original run command.",
    );
  }
  const statePath = path.join(canonicalDirectory, RELEASE_STATE_FILE);
  await assertPrivateOwnedPath(statePath, "file");
  const state = parseStrictJson(await readFile(statePath, "utf8"), "release journal");
  const expectedDigest = sha256(
    canonicalJson({
      ...state,
      journalDigest: undefined,
    }),
  );
  assertConfig(
    state.schemaVersion === RELEASE_STATE_VERSION &&
      DIGEST.test(state.journalDigest) &&
      state.journalDigest === expectedDigest &&
      state.journalBindingDigest === journalBinding(state) &&
      state.runDirectory === canonicalDirectory &&
      state.runId ===
        stableReleaseId(
          "run",
          state.projectSlug,
          state.provider,
          state.configDigest,
          state.source.commitSha,
          state.snapshot.manifestDigest,
          state.createdAt,
          path.basename(state.runDirectory),
        ),
    "JOURNAL_INTEGRITY_INVALID",
    "The release journal or its immutable bindings failed verification.",
    "Do not resume this run. Preserve it for incident review and start a successor run.",
  );
  return { runDirectory: canonicalDirectory, state };
}

export async function createUniqueRunDirectory(outputRoot, projectSlug, commitSha, timestamp) {
  const safeTime = timestamp.replace(/[-:.]/gu, "").replace("000Z", "Z");
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const nonce = randomBytes(6).toString("hex");
    const candidate = path.join(
      outputRoot,
      `${projectSlug}-${commitSha}-${safeTime}-release-${nonce}`,
    );
    try {
      await mkdir(candidate, { mode: 0o700 });
      await fsyncDirectory(outputRoot);
      return await realpath(candidate);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new ReleaseRunError(
    "RUN_DIRECTORY_COLLISION",
    "Could not allocate a unique generated run directory.",
    "Retry the run after checking generated/ directory permissions.",
  );
}

export function assertResumable(state, requestedProvider) {
  if (state.provider !== requestedProvider) {
    throw new ReleaseRunError(
      "RESUME_PROVIDER_MISMATCH",
      "The requested provider does not match the journal binding.",
      `Resume with --provider ${state.provider}.`,
    );
  }
  if (TERMINAL.has(state.status)) {
    throw new ReleaseRunError(
      "RUN_NOT_RESUMABLE",
      `Run status ${state.status} is terminal.`,
      "Start a successor run with the original configuration.",
    );
  }
  if (state.cleanup?.status !== "failed-and-closed" || (state.cleanup?.residue?.length ?? 0) > 0) {
    throw new ReleaseRunError(
      "RUN_CLEANUP_RESIDUE",
      "Run cleanup is not attested closed and cannot be resumed.",
      "Use the trusted cleanup workflow, attest zero residue, then start a successor run.",
    );
  }
  if (!RESUMABLE_STAGES.has(state.currentStage)) {
    throw new ReleaseRunError(
      "STAGE_NOT_RESUMABLE",
      `Stage ${state.currentStage} is not explicitly resumable.`,
      "Preserve this run for review and start a successor run.",
    );
  }
}

export async function verifyImmutablePath(absolutePath, expectedSize, expectedDigest) {
  const info = await stat(absolutePath);
  if (!info.isFile() || String(info.size) !== expectedSize) return false;
  return sha256(await readFile(absolutePath)) === expectedDigest;
}

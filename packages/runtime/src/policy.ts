export type RuntimePolicyResult =
  | { accepted: true; normalized: Readonly<Record<string, unknown>> }
  | { accepted: false; rejectionCodes: string[] };

const TOP_LEVEL_KEYS = new Set(["services", "networks"]);
const SERVICE_KEYS = new Set([
  "image",
  "build",
  "command",
  "entrypoint",
  "depends_on",
  "environment",
  "user",
  "working_dir",
  "healthcheck",
  "networks",
  "deploy",
  "init",
  "stop_grace_period",
]);
const BUILD_KEYS = new Set(["context", "dockerfile", "dockerfile_inline", "args", "target"]);
const DEPLOY_KEYS = new Set(["replicas", "resources"]);
const RESOURCE_KEYS = new Set(["limits", "reservations"]);
const RESOURCE_VALUE_KEYS = new Set(["cpus", "memory", "pids"]);
const HEALTHCHECK_KEYS = new Set([
  "test",
  "interval",
  "timeout",
  "retries",
  "start_period",
  "start_interval",
  "disable",
]);
const FORBIDDEN_SERVICE_KEYS = new Map<string, string>([
  ["privileged", "PRIVILEGED_FORBIDDEN"],
  ["cap_add", "CAPABILITY_ADD_FORBIDDEN"],
  ["cap_drop", "TARGET_ISOLATION_OVERRIDE_FORBIDDEN"],
  ["devices", "DEVICE_ACCESS_FORBIDDEN"],
  ["device_cgroup_rules", "DEVICE_ACCESS_FORBIDDEN"],
  ["gpus", "DEVICE_ACCESS_FORBIDDEN"],
  ["runtime", "CUSTOM_RUNTIME_FORBIDDEN"],
  ["use_api_socket", "CONTAINER_API_SOCKET_FORBIDDEN"],
  ["network_mode", "NAMESPACE_SHARING_FORBIDDEN"],
  ["pid", "NAMESPACE_SHARING_FORBIDDEN"],
  ["ipc", "NAMESPACE_SHARING_FORBIDDEN"],
  ["uts", "NAMESPACE_SHARING_FORBIDDEN"],
  ["userns_mode", "NAMESPACE_SHARING_FORBIDDEN"],
  ["cgroup", "CGROUP_OVERRIDE_FORBIDDEN"],
  ["cgroup_parent", "CGROUP_OVERRIDE_FORBIDDEN"],
  ["volumes", "BIND_OR_SOCKET_MOUNT_FORBIDDEN"],
  ["volumes_from", "VOLUME_INHERITANCE_FORBIDDEN"],
  ["ports", "HOST_PORT_FORBIDDEN"],
  ["expose", "TARGET_NETWORK_OVERRIDE_FORBIDDEN"],
  ["extra_hosts", "EXTRA_HOST_FORBIDDEN"],
  ["dns", "CUSTOM_DNS_FORBIDDEN"],
  ["dns_opt", "CUSTOM_DNS_FORBIDDEN"],
  ["dns_search", "CUSTOM_DNS_FORBIDDEN"],
  ["mac_address", "STATIC_NETWORK_IDENTITY_FORBIDDEN"],
  ["links", "TARGET_NETWORK_OVERRIDE_FORBIDDEN"],
  ["sysctls", "UNSAFE_SYSCTL_FORBIDDEN"],
  ["security_opt", "TARGET_ISOLATION_OVERRIDE_FORBIDDEN"],
  ["read_only", "TARGET_ISOLATION_OVERRIDE_FORBIDDEN"],
  ["tmpfs", "TARGET_ISOLATION_OVERRIDE_FORBIDDEN"],
  ["provider", "PROVIDER_HOOK_FORBIDDEN"],
  ["post_start", "LIFECYCLE_HOOK_FORBIDDEN"],
  ["pre_stop", "LIFECYCLE_HOOK_FORBIDDEN"],
  ["secrets", "TARGET_SECRET_CHANNEL_FORBIDDEN"],
  ["configs", "TARGET_CONFIG_CHANNEL_FORBIDDEN"],
  ["logging", "REMOTE_LOGGING_FORBIDDEN"],
]);
const CREDENTIAL_NAME =
  /(?:^|_)(?:prod(?:uction)?|secret|token|pass(?:word)?|credential|api_?key|private_?key|access_?key|client_?secret|auth|database_?url|dsn)(?:_|$)/iu;
const MAX_SERVICE_CPUS = 1;
const MAX_SERVICE_MEMORY = 2 * 1024 * 1024 * 1024;
const MAX_SERVICE_PIDS = 256;
const MAX_TOTAL_CPUS = 3;
const MAX_TOTAL_MEMORY = 6 * 1024 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  rejections: Set<string>,
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    rejections.add("UNKNOWN_ISOLATION_FIELD");
  }
}

function parseCpu(value: unknown): number | undefined {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseMemory(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const match = /^(\d+)([kmgt])?i?b?$/iu.exec(value.trim());
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const powers: Record<string, number> = { "": 0, k: 1, m: 2, g: 3, t: 4 };
  const exponent = powers[(match[2] ?? "").toLowerCase()];
  if (exponent === undefined) return undefined;
  const bytes = amount * 1024 ** exponent;
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

function validateEnvironment(value: unknown, rejections: Set<string>): void {
  const entries: Array<[string, unknown]> = isRecord(value)
    ? Object.entries(value)
    : Array.isArray(value)
      ? value.map((item) => {
          if (typeof item !== "string") return ["", item];
          const separator = item.indexOf("=");
          return separator === -1
            ? [item, undefined]
            : [item.slice(0, separator), item.slice(separator + 1)];
        })
      : [];
  if (entries.length === 0 && !(isRecord(value) || Array.isArray(value))) {
    rejections.add("INVALID_ENVIRONMENT");
    return;
  }
  for (const [name, environmentValue] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) rejections.add("INVALID_ENVIRONMENT");
    if (CREDENTIAL_NAME.test(name)) rejections.add("CREDENTIAL_ENVIRONMENT_FORBIDDEN");
    if (
      environmentValue === undefined ||
      (typeof environmentValue === "string" && environmentValue.includes("${"))
    ) {
      rejections.add("ENVIRONMENT_INTERPOLATION_FORBIDDEN");
    }
    if (
      environmentValue !== undefined &&
      typeof environmentValue !== "string" &&
      typeof environmentValue !== "number" &&
      typeof environmentValue !== "boolean"
    ) {
      rejections.add("INVALID_ENVIRONMENT");
    }
  }
}

function safeRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !/^(?:https?|git|ssh):/iu.test(value) &&
    !value.split("/").some((segment) => segment === "..")
  );
}

function validateDockerfile(text: string, rejections: Set<string>): void {
  if (Buffer.byteLength(text, "utf8") > 262_144) {
    rejections.add("DOCKERFILE_TOO_LARGE");
    return;
  }
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (/^ADD\s+(?:--\S+\s+)*(?:(?:https?|git|ssh):|git@)/iu.test(trimmed)) {
      rejections.add("REMOTE_DOCKERFILE_ADD_FORBIDDEN");
    }
    if (/^ADD\s+\[/iu.test(trimmed) && /"(?:https?|git|ssh):/iu.test(trimmed)) {
      rejections.add("REMOTE_DOCKERFILE_ADD_FORBIDDEN");
    }
    if (/^USER\s+(?:0(?::0)?|root(?::root)?)\s*$/iu.test(trimmed)) {
      rejections.add("ROOT_USER_FORBIDDEN");
    }
    const from = /^FROM(?:\s+--\S+)*\s+(\S+)/iu.exec(trimmed);
    if (from?.[1] !== undefined && from[1] !== "scratch" && !from[1].includes("@sha256:")) {
      rejections.add("MUTABLE_IMAGE_FORBIDDEN");
    }
    if (/^RUN\s+.*--mount=type=(?:ssh|secret)/iu.test(trimmed)) {
      rejections.add("BUILDKIT_SECRET_FORBIDDEN");
    }
    if (/^RUN\s+.*--network=(?:host|default)/iu.test(trimmed)) {
      rejections.add("BUILD_NETWORK_OVERRIDE_FORBIDDEN");
    }
  }
}

function validateBuild(value: unknown, rejections: Set<string>): void {
  if (typeof value === "string") {
    if (!safeRelativePath(value)) rejections.add("REMOTE_OR_ESCAPING_REFERENCE");
    return;
  }
  if (!isRecord(value)) {
    rejections.add("INVALID_BUILD_MODEL");
    return;
  }
  unknownKeys(value, BUILD_KEYS, rejections);
  if (!safeRelativePath(value["context"])) rejections.add("REMOTE_OR_ESCAPING_REFERENCE");
  if (value["dockerfile"] !== undefined && !safeRelativePath(value["dockerfile"])) {
    rejections.add("REMOTE_OR_ESCAPING_REFERENCE");
  }
  if (value["dockerfile_inline"] !== undefined) {
    if (typeof value["dockerfile_inline"] !== "string") rejections.add("INVALID_BUILD_MODEL");
    else validateDockerfile(value["dockerfile_inline"], rejections);
  }
  if (value["args"] !== undefined) validateEnvironment(value["args"], rejections);
}

function validateResources(
  value: unknown,
  rejections: Set<string>,
): { cpus: number; memory: number } {
  if (!isRecord(value)) {
    rejections.add("INVALID_RESOURCE_POLICY");
    return { cpus: MAX_SERVICE_CPUS, memory: MAX_SERVICE_MEMORY };
  }
  unknownKeys(value, RESOURCE_VALUE_KEYS, rejections);
  const cpus = value["cpus"] === undefined ? MAX_SERVICE_CPUS : parseCpu(value["cpus"]);
  const memory = value["memory"] === undefined ? MAX_SERVICE_MEMORY : parseMemory(value["memory"]);
  const pids = value["pids"] === undefined ? MAX_SERVICE_PIDS : Number(value["pids"]);
  if (cpus === undefined || cpus > MAX_SERVICE_CPUS) rejections.add("RESOURCE_LIMIT_EXCEEDED");
  if (memory === undefined || memory > MAX_SERVICE_MEMORY)
    rejections.add("RESOURCE_LIMIT_EXCEEDED");
  if (!Number.isInteger(pids) || pids < 1 || pids > MAX_SERVICE_PIDS)
    rejections.add("RESOURCE_LIMIT_EXCEEDED");
  return {
    cpus: cpus ?? MAX_SERVICE_CPUS,
    memory: memory ?? MAX_SERVICE_MEMORY,
  };
}

function validateDeploy(value: unknown, rejections: Set<string>): { cpus: number; memory: number } {
  if (!isRecord(value)) {
    rejections.add("INVALID_RESOURCE_POLICY");
    return { cpus: MAX_SERVICE_CPUS, memory: MAX_SERVICE_MEMORY };
  }
  unknownKeys(value, DEPLOY_KEYS, rejections);
  if (value["replicas"] !== undefined && value["replicas"] !== 1) {
    rejections.add("REPLICA_LIMIT_EXCEEDED");
  }
  if (value["resources"] === undefined) {
    return { cpus: MAX_SERVICE_CPUS, memory: MAX_SERVICE_MEMORY };
  }
  if (!isRecord(value["resources"])) {
    rejections.add("INVALID_RESOURCE_POLICY");
    return { cpus: MAX_SERVICE_CPUS, memory: MAX_SERVICE_MEMORY };
  }
  unknownKeys(value["resources"], RESOURCE_KEYS, rejections);
  const limits =
    value["resources"]["limits"] === undefined
      ? { cpus: MAX_SERVICE_CPUS, memory: MAX_SERVICE_MEMORY }
      : validateResources(value["resources"]["limits"], rejections);
  if (value["resources"]["reservations"] !== undefined) {
    validateResources(value["resources"]["reservations"], rejections);
  }
  return limits;
}

function validateNetworks(value: unknown, rejections: Set<string>): void {
  if (!isRecord(value)) {
    rejections.add("INVALID_NETWORK_MODEL");
    return;
  }
  for (const network of Object.values(value)) {
    if (!isRecord(network)) {
      rejections.add("INVALID_NETWORK_MODEL");
      continue;
    }
    unknownKeys(network, new Set(["internal", "driver", "external"]), rejections);
    if (network["external"] === true) rejections.add("EXTERNAL_NETWORK_FORBIDDEN");
    if (network["driver"] !== undefined && network["driver"] !== "bridge") {
      rejections.add("CUSTOM_NETWORK_DRIVER_FORBIDDEN");
    }
    if (network["internal"] !== undefined && network["internal"] !== true) {
      rejections.add("NON_INTERNAL_NETWORK_FORBIDDEN");
    }
  }
}

function validateServiceNetworks(value: unknown, rejections: Set<string>): void {
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== "string" || item.length === 0)) {
      rejections.add("INVALID_NETWORK_MODEL");
    }
    return;
  }
  if (!isRecord(value)) {
    rejections.add("INVALID_NETWORK_MODEL");
    return;
  }
  for (const configuration of Object.values(value)) {
    if (
      configuration !== null &&
      (!isRecord(configuration) || Object.keys(configuration).length > 0)
    ) {
      rejections.add("TARGET_NETWORK_OVERRIDE_FORBIDDEN");
    }
  }
}

function validateHealthcheck(value: unknown, rejections: Set<string>): void {
  if (!isRecord(value)) {
    rejections.add("INVALID_HEALTHCHECK");
    return;
  }
  unknownKeys(value, HEALTHCHECK_KEYS, rejections);
  if (value["disable"] === true) rejections.add("HEALTHCHECK_DISABLE_FORBIDDEN");
}

export function validateRuntimePolicy(candidate: unknown): RuntimePolicyResult {
  if (!isRecord(candidate)) return { accepted: false, rejectionCodes: ["INVALID_RUNTIME_MODEL"] };
  const rejections = new Set<string>();
  unknownKeys(candidate, TOP_LEVEL_KEYS, rejections);
  if (!isRecord(candidate["services"]) || Object.keys(candidate["services"]).length === 0) {
    rejections.add("INVALID_RUNTIME_MODEL");
  } else {
    let totalCpus = 0;
    let totalMemory = 0;
    for (const service of Object.values(candidate["services"])) {
      if (!isRecord(service)) {
        rejections.add("INVALID_SERVICE_MODEL");
        continue;
      }
      for (const key of Object.keys(service)) {
        const forbidden = FORBIDDEN_SERVICE_KEYS.get(key);
        if (forbidden !== undefined) rejections.add(forbidden);
      }
      unknownKeys(
        service,
        new Set([...SERVICE_KEYS, ...FORBIDDEN_SERVICE_KEYS.keys()]),
        rejections,
      );
      if (service["image"] === undefined && service["build"] === undefined) {
        rejections.add("SERVICE_SOURCE_REQUIRED");
      }
      if (
        typeof service["image"] === "string" &&
        service["image"] !== "scratch" &&
        !service["image"].includes("@sha256:")
      ) {
        rejections.add("MUTABLE_IMAGE_FORBIDDEN");
      }
      if (service["image"] !== undefined && typeof service["image"] !== "string") {
        rejections.add("INVALID_IMAGE_REFERENCE");
      }
      if (service["user"] !== undefined) {
        if (
          typeof service["user"] !== "string" ||
          !/^\d+(?::\d+)?$/u.test(service["user"]) ||
          service["user"].split(":")[0] === "0"
        ) {
          rejections.add("ROOT_OR_NON_NUMERIC_USER_FORBIDDEN");
        }
      }
      if (service["environment"] !== undefined)
        validateEnvironment(service["environment"], rejections);
      if (service["build"] !== undefined) validateBuild(service["build"], rejections);
      if (service["networks"] !== undefined)
        validateServiceNetworks(service["networks"], rejections);
      if (service["healthcheck"] !== undefined)
        validateHealthcheck(service["healthcheck"], rejections);
      const resources =
        service["deploy"] === undefined
          ? { cpus: MAX_SERVICE_CPUS, memory: MAX_SERVICE_MEMORY }
          : validateDeploy(service["deploy"], rejections);
      totalCpus += resources.cpus;
      totalMemory += resources.memory;
    }
    if (totalCpus > MAX_TOTAL_CPUS || totalMemory > MAX_TOTAL_MEMORY) {
      rejections.add("TOTAL_RESOURCE_LIMIT_EXCEEDED");
    }
  }
  if (candidate["networks"] !== undefined) validateNetworks(candidate["networks"], rejections);
  if (rejections.size > 0) return { accepted: false, rejectionCodes: [...rejections].sort() };
  return {
    accepted: true,
    normalized: deepFreeze(structuredClone(candidate)),
  };
}

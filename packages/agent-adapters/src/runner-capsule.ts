import type {
  AcceptanceCheckCatalog,
  AgentTaskCapsule,
  ProviderTaskEnvelope,
  RequestedProviderCapabilities,
} from "./types.js";
import {
  AdapterContractError,
  deniedCapabilityReasons,
  validateTaskCapsule,
} from "./validation.js";

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function createProviderTaskEnvelope(
  provider: "codex" | "claude-code",
  capsule: AgentTaskCapsule,
  requestedCapabilities: RequestedProviderCapabilities,
  acceptanceChecks: AcceptanceCheckCatalog,
): ProviderTaskEnvelope {
  validateTaskCapsule(capsule, acceptanceChecks);
  if (
    requestedCapabilities === null ||
    typeof requestedCapabilities !== "object" ||
    Array.isArray(requestedCapabilities)
  ) {
    throw new AdapterContractError(
      "PROVIDER_CAPABILITY_DENIED",
      "Provider task capabilities must be a typed object.",
    );
  }
  const denials = deniedCapabilityReasons(requestedCapabilities, provider);
  if (denials.length > 0) {
    throw new AdapterContractError(
      "PROVIDER_CAPABILITY_DENIED",
      `Provider task envelope was denied: ${denials.join(",")}`,
    );
  }
  return {
    schemaVersion: "1.0.0",
    provider,
    capsule: structuredClone(capsule),
    requestedCapabilities: structuredClone(requestedCapabilities),
  };
}

export function serializeProviderTaskEnvelope(
  provider: "codex" | "claude-code",
  capsule: AgentTaskCapsule,
  requestedCapabilities: RequestedProviderCapabilities,
  acceptanceChecks: AcceptanceCheckCatalog,
): string {
  return JSON.stringify(
    createProviderTaskEnvelope(provider, capsule, requestedCapabilities, acceptanceChecks),
  );
}

export function parseProviderTaskEnvelope(
  serialized: string,
  invokedProvider: "codex" | "claude-code",
  acceptanceChecks: AcceptanceCheckCatalog,
): ProviderTaskEnvelope {
  if (Buffer.byteLength(serialized, "utf8") > 1_048_576) {
    throw new AdapterContractError(
      "TASK_CONTRACT_INVALID",
      "Provider envelope exceeds the release limit.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new AdapterContractError("TASK_CONTRACT_INVALID", "Provider envelope is not valid JSON.");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasExactKeys(value, ["schemaVersion", "provider", "capsule", "requestedCapabilities"])
  ) {
    throw new AdapterContractError(
      "TASK_CONTRACT_INVALID",
      "Provider envelope has missing or unknown fields.",
    );
  }
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== "1.0.0" || record["provider"] !== invokedProvider) {
    throw new AdapterContractError(
      "TASK_CONTRACT_INVALID",
      "Provider envelope identity does not match the invoked provider.",
    );
  }
  return createProviderTaskEnvelope(
    invokedProvider,
    record["capsule"] as AgentTaskCapsule,
    record["requestedCapabilities"] as RequestedProviderCapabilities,
    acceptanceChecks,
  );
}

// Compatibility names for the typed runner seam. These are aliases, not the obsolete
// prompt-only capsule contract.
export type ProviderRunnerCapsule = ProviderTaskEnvelope;
export const createProviderRunnerCapsule = createProviderTaskEnvelope;
export const serializeProviderRunnerCapsule = serializeProviderTaskEnvelope;
export const parseProviderRunnerCapsule = parseProviderTaskEnvelope;

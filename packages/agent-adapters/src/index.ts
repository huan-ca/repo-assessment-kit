export { createAgentAdapter, createClaudeCodeAdapter, createCodexAdapter } from "./adapter.js";
export type { AdapterMetadata } from "./adapter.js";
export { createBrokeredAgentAdapter, createBrokeredProviderExecutor } from "./executor.js";
export { createProviderBrokerTransport } from "./broker-transport.js";
export type { ProviderBrokerJobFactory } from "./broker-transport.js";
export {
  providerCliSpecs,
  registeredAcceptanceCheckIds,
  registeredOutputSchemaIds,
} from "./provider-spec.js";
export type { ProviderName } from "./provider-spec.js";
export {
  createProviderTaskEnvelope,
  createProviderRunnerCapsule,
  parseProviderTaskEnvelope,
  parseProviderRunnerCapsule,
  serializeProviderTaskEnvelope,
  serializeProviderRunnerCapsule,
} from "./runner-capsule.js";
export type { ProviderRunnerCapsule } from "./runner-capsule.js";
export {
  AdapterContractError,
  AUTHOR_PROPOSAL_INSTRUCTIONS,
  AUTHOR_PROPOSAL_PROFILE,
  REVIEW_PROPOSAL_INSTRUCTIONS,
  REVIEW_PROPOSAL_PROFILE,
  deniedCapabilityReasons,
  validateAgentProposal,
  validateAgentTask,
  validateTaskCapsule,
} from "./validation.js";
export type * from "./types.js";

export const supportedProviders = Object.freeze(["codex", "claude-code"] as const);

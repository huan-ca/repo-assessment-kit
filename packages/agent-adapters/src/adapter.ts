import { createHash } from "node:crypto";

import type {
  AcceptanceCheckCatalog,
  AgentAdapter,
  AgentOutcome,
  AgentTask,
  ArtifactReceipt,
  ProviderExecutionResult,
  ProviderExecutor,
  ProviderLaunchPlan,
  RequestedProviderCapabilities,
} from "./types.js";
import { providerCliSpecs } from "./provider-spec.js";
import { createProviderTaskEnvelope } from "./runner-capsule.js";
import {
  AdapterContractError,
  deniedCapabilityReasons,
  validateAgentProposal,
  validateTaskCapsule,
} from "./validation.js";

export type AdapterMetadata = {
  adapterVersion: string;
  cliVersion: string;
  imageDigest: `sha256:${string}`;
};

function emptyLogReceipt(provider: "codex" | "claude-code", taskId: string): ArtifactReceipt {
  const bytes = Buffer.from(`provider=${provider};task=${taskId};state=not-started`, "utf8");
  return {
    receiptId: `log_${taskId}`,
    outboxName: "provider-operational-log",
    mediaType: "text/plain",
    byteLength: String(bytes.byteLength),
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    closed: true,
  };
}

function baseOutcome(
  provider: "codex" | "claude-code",
  task: AgentTask,
  metadata: AdapterMetadata,
  startedAt: string,
  endedAt: string,
  outcome: AgentOutcome["outcome"],
  operationalLogReceipt: ArtifactReceipt,
  limitationIds: string[],
): AgentOutcome {
  return {
    schemaVersion: "1.0.0",
    taskId: task.taskId,
    runId: task.runId,
    attemptId: task.attemptId,
    fenceToken: task.fenceToken,
    provider,
    adapterVersion: metadata.adapterVersion,
    cliVersion: metadata.cliVersion,
    imageDigest: metadata.imageDigest,
    outcome,
    operationalLogReceipt,
    limitationIds,
    startedAt,
    endedAt,
  };
}

function mapState(result: ProviderExecutionResult): AgentOutcome["outcome"] {
  switch (result.state) {
    case "completed":
      return "succeeded";
    case "contract-invalid":
      return "contract-invalid";
    case "budget-exhausted":
      return "budget-exhausted";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
  }
}

function createLaunchPlan(
  provider: "codex" | "claude-code",
  capsule: Parameters<AgentAdapter["run"]>[0]["capsule"],
  requestedCapabilities: RequestedProviderCapabilities,
  acceptanceChecks: AcceptanceCheckCatalog,
): ProviderLaunchPlan {
  const spec = providerCliSpecs[provider];
  return {
    provider,
    executable: spec.executable,
    fixedArguments: spec.fixedArguments,
    stdin: JSON.stringify(capsule),
    environment: Object.freeze({}),
    networkDestination: provider,
    outputChannel: "proposal-outbox",
    permissionMode: spec.permissionMode,
    taskEnvelope: createProviderTaskEnvelope(
      provider,
      capsule,
      requestedCapabilities,
      acceptanceChecks,
    ),
  };
}

export function createAgentAdapter(
  provider: "codex" | "claude-code",
  executor: ProviderExecutor,
  metadata: AdapterMetadata,
  acceptanceChecks: AcceptanceCheckCatalog,
  clock: () => string = () => new Date().toISOString(),
): AgentAdapter {
  return {
    provider,
    async run(input): Promise<AgentOutcome> {
      const initialTime = clock();
      try {
        validateTaskCapsule(input.capsule, acceptanceChecks);
      } catch (error) {
        if (!(error instanceof AdapterContractError)) throw error;
        return baseOutcome(
          provider,
          input.capsule.task,
          metadata,
          initialTime,
          clock(),
          "contract-invalid",
          emptyLogReceipt(provider, input.capsule.task.taskId),
          [error.code],
        );
      }
      const denied = deniedCapabilityReasons(input.requestedCapabilities, provider);
      if (denied.length > 0) {
        return baseOutcome(
          provider,
          input.capsule.task,
          metadata,
          initialTime,
          clock(),
          "permission-denied",
          emptyLogReceipt(provider, input.capsule.task.taskId),
          denied,
        );
      }
      if (!executor.available) {
        return baseOutcome(
          provider,
          input.capsule.task,
          metadata,
          initialTime,
          clock(),
          "provider-unavailable",
          emptyLogReceipt(provider, input.capsule.task.taskId),
          ["PROVIDER_UNAVAILABLE"],
        );
      }

      let result: ProviderExecutionResult;
      try {
        result = await executor.execute(
          createLaunchPlan(provider, input.capsule, input.requestedCapabilities, acceptanceChecks),
          input.signal,
        );
      } catch {
        return baseOutcome(
          provider,
          input.capsule.task,
          metadata,
          initialTime,
          clock(),
          "failed",
          emptyLogReceipt(provider, input.capsule.task.taskId),
          ["PROVIDER_EXECUTION_FAILED"],
        );
      }
      const mapped = mapState(result);
      if (mapped !== "succeeded") {
        return baseOutcome(
          provider,
          input.capsule.task,
          metadata,
          result.startedAt,
          result.endedAt,
          mapped,
          result.operationalLogReceipt,
          result.limitationIds,
        );
      }
      let proposalErrors: string[];
      try {
        proposalErrors = validateAgentProposal(
          result.proposal,
          input.capsule.task,
          acceptanceChecks,
        );
      } catch {
        proposalErrors = ["acceptance validator failed closed"];
      }
      if (proposalErrors.length > 0 || result.proposalReceipt === undefined) {
        return baseOutcome(
          provider,
          input.capsule.task,
          metadata,
          result.startedAt,
          result.endedAt,
          "contract-invalid",
          result.operationalLogReceipt,
          [...result.limitationIds, "PROPOSAL_ACCEPTANCE_FAILED"],
        );
      }
      const outcome = baseOutcome(
        provider,
        input.capsule.task,
        metadata,
        result.startedAt,
        result.endedAt,
        "succeeded",
        result.operationalLogReceipt,
        result.limitationIds,
      );
      outcome.proposalReceipt = result.proposalReceipt;
      if (result.providerSessionId !== undefined)
        outcome.providerSessionId = result.providerSessionId;
      if (result.modelId !== undefined) outcome.modelId = result.modelId;
      return outcome;
    },
  };
}

export function createCodexAdapter(
  executor: ProviderExecutor,
  metadata: AdapterMetadata,
  acceptanceChecks: AcceptanceCheckCatalog,
  clock?: () => string,
): AgentAdapter {
  return createAgentAdapter("codex", executor, metadata, acceptanceChecks, clock);
}

export function createClaudeCodeAdapter(
  executor: ProviderExecutor,
  metadata: AdapterMetadata,
  acceptanceChecks: AcceptanceCheckCatalog,
  clock?: () => string,
): AgentAdapter {
  return createAgentAdapter("claude-code", executor, metadata, acceptanceChecks, clock);
}

import { createHash } from "node:crypto";

import { createAgentAdapter } from "./adapter.js";
import type { AdapterMetadata } from "./adapter.js";
import { providerCliSpecs } from "./provider-spec.js";
import { parseProviderTaskEnvelope } from "./runner-capsule.js";
import type {
  AcceptanceCheckCatalog,
  AgentAdapter,
  ArtifactReceipt,
  ProviderExecutionResult,
  ProviderExecutor,
  ProviderLaunchPlan,
  ProviderOutputNormalizer,
  ProviderRunnerTransport,
  ProviderRunnerTransportResult,
} from "./types.js";
import { validateAgentProposal } from "./validation.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const BYTE_LENGTH = /^(?:0|[1-9]\d*)$/u;

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validReceipt(receipt: ArtifactReceipt, outboxName: string): boolean {
  const expectedKeys = [
    "receiptId",
    "outboxName",
    "mediaType",
    "byteLength",
    "sha256",
    "closed",
  ].sort();
  const actualKeys =
    receipt !== null && typeof receipt === "object" ? Object.keys(receipt).sort() : [];
  return (
    receipt !== null &&
    typeof receipt === "object" &&
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    receipt.closed === true &&
    receipt.outboxName === outboxName &&
    typeof receipt.receiptId === "string" &&
    receipt.receiptId.length > 0 &&
    typeof receipt.mediaType === "string" &&
    receipt.mediaType.length > 0 &&
    BYTE_LENGTH.test(receipt.byteLength) &&
    DIGEST.test(receipt.sha256)
  );
}

function validateTransportMetadata(result: ProviderRunnerTransportResult): boolean {
  return (
    validReceipt(result.operationalLogReceipt, "provider-operational-log") &&
    Number.isFinite(Date.parse(result.startedAt)) &&
    Number.isFinite(Date.parse(result.endedAt)) &&
    Date.parse(result.endedAt) >= Date.parse(result.startedAt) &&
    Array.isArray(result.limitationIds) &&
    result.limitationIds.every((value) => typeof value === "string")
  );
}

function contractInvalid(
  result: ProviderRunnerTransportResult,
  limitation: string,
): ProviderExecutionResult {
  return {
    state: "contract-invalid",
    operationalLogReceipt: result.operationalLogReceipt,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    limitationIds: [...result.limitationIds, limitation],
  };
}

export function createBrokeredProviderExecutor(input: {
  provider: "codex" | "claude-code";
  transport: ProviderRunnerTransport;
  normalizer: ProviderOutputNormalizer;
  acceptanceChecks: AcceptanceCheckCatalog;
}): ProviderExecutor {
  return {
    get available() {
      return input.transport.available;
    },
    async execute(
      plan: ProviderLaunchPlan,
      signal?: AbortSignal,
    ): Promise<ProviderExecutionResult> {
      const spec = providerCliSpecs[input.provider];
      const validatedEnvelope = parseProviderTaskEnvelope(
        JSON.stringify(plan.taskEnvelope),
        input.provider,
        input.acceptanceChecks,
      );
      if (
        plan.provider !== input.provider ||
        plan.taskEnvelope.provider !== input.provider ||
        plan.executable !== spec.executable ||
        !sameStrings(plan.fixedArguments, spec.fixedArguments) ||
        plan.stdin !== JSON.stringify(plan.taskEnvelope.capsule) ||
        plan.outputChannel !== "proposal-outbox" ||
        plan.networkDestination !== input.provider ||
        plan.permissionMode !== spec.permissionMode ||
        Object.keys(plan.environment).length !== 0
      ) {
        throw new Error("PROVIDER_LAUNCH_PLAN_INVALID");
      }
      const result = await input.transport.execute(
        {
          taskEnvelope: validatedEnvelope,
          executable: spec.executable,
          fixedArguments: spec.fixedArguments,
        },
        signal,
      );
      if (!validateTransportMetadata(result)) {
        throw new Error("PROVIDER_RUNNER_METADATA_INVALID");
      }
      if (result.state !== "completed") {
        const nonCompleted: ProviderExecutionResult = {
          state: result.state,
          operationalLogReceipt: result.operationalLogReceipt,
          startedAt: result.startedAt,
          endedAt: result.endedAt,
          limitationIds: result.limitationIds,
        };
        if (result.providerSessionId !== undefined)
          nonCompleted.providerSessionId = result.providerSessionId;
        if (result.modelId !== undefined) nonCompleted.modelId = result.modelId;
        return nonCompleted;
      }
      if (result.proposalOutbox === undefined) {
        return contractInvalid(result, "PROPOSAL_OUTBOX_MISSING");
      }
      const { bytes, receipt } = result.proposalOutbox;
      if (!(bytes instanceof Uint8Array)) {
        return contractInvalid(result, "PROPOSAL_RECEIPT_INVALID");
      }
      const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (
        !validReceipt(receipt, "provider-proposal") ||
        (receipt.mediaType !== "application/json" &&
          receipt.mediaType !== "application/x-ndjson") ||
        receipt.byteLength !== String(bytes.byteLength) ||
        receipt.sha256 !== actualDigest ||
        bytes.byteLength > plan.taskEnvelope.capsule.task.budget.outputBytes
      ) {
        return contractInvalid(result, "PROPOSAL_RECEIPT_INVALID");
      }
      let proposal: unknown;
      try {
        proposal = input.normalizer.normalize(input.provider, bytes);
      } catch {
        return contractInvalid(result, "PROPOSAL_NORMALIZATION_FAILED");
      }
      if (
        validateAgentProposal(proposal, plan.taskEnvelope.capsule.task, input.acceptanceChecks)
          .length > 0
      ) {
        return contractInvalid(result, "PROPOSAL_ACCEPTANCE_FAILED");
      }
      const completed: ProviderExecutionResult = {
        state: "completed",
        proposal,
        proposalReceipt: receipt,
        operationalLogReceipt: result.operationalLogReceipt,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        limitationIds: result.limitationIds,
      };
      if (result.providerSessionId !== undefined)
        completed.providerSessionId = result.providerSessionId;
      if (result.modelId !== undefined) completed.modelId = result.modelId;
      return completed;
    },
  };
}

export function createBrokeredAgentAdapter(input: {
  provider: "codex" | "claude-code";
  transport: ProviderRunnerTransport;
  normalizer: ProviderOutputNormalizer;
  acceptanceChecks: AcceptanceCheckCatalog;
  metadata: AdapterMetadata;
  clock?: () => string;
}): AgentAdapter {
  return createAgentAdapter(
    input.provider,
    createBrokeredProviderExecutor(input),
    input.metadata,
    input.acceptanceChecks,
    input.clock,
  );
}

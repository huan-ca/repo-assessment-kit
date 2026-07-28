import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AUTHOR_PROPOSAL_INSTRUCTIONS,
  AUTHOR_PROPOSAL_PROFILE,
  createBrokeredProviderExecutor,
  createClaudeCodeAdapter,
  createCodexAdapter,
  parseProviderRunnerCapsule,
  providerCliSpecs,
  serializeProviderRunnerCapsule,
  validateTaskCapsule,
} from "./src/index.js";
import type {
  AcceptanceCheckCatalog,
  AgentTask,
  AgentTaskCapsule,
  ArtifactReceipt,
  ProviderExecutor,
  ProviderLaunchPlan,
  ProviderRunnerTransport,
  RequestedProviderCapabilities,
} from "./src/index.js";

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const clock = () => "2026-07-28T10:00:00.000Z";

function receipt(name: string): ArtifactReceipt {
  const bytes = Buffer.from(name);
  return {
    receiptId: `receipt-${name}`,
    outboxName: name,
    mediaType: "application/json",
    byteLength: String(bytes.byteLength),
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    closed: true,
  };
}

function task(): AgentTask {
  const value: AgentTask = {
    schemaVersion: "1.0.0",
    taskId: "task-1",
    runId: "run_1",
    attemptId: "attempt-1",
    fenceToken: "7",
    taskKind: "architecture-analysis",
    providerRole: "author",
    target: {
      snapshotId: "snapshot-1",
      commitSha: "a".repeat(40),
      manifestDigest: digest("a"),
    },
    evidenceView: {
      viewId: "view-1",
      digest: digest("b"),
      allowedEvidenceIds: ["evidence-1"],
    },
    instructionBundleDigest: digest("c"),
    proposalProfileId: AUTHOR_PROPOSAL_PROFILE,
    proposalInstructions: AUTHOR_PROPOSAL_INSTRUCTIONS,
    requiredOutputSchemaId: "rak-agent-proposal/1.0.0",
    acceptanceChecks: ["material-claims-cited"],
    allowedCommands: [
      "get-run-context",
      "get-evidence-metadata",
      "get-safe-evidence-text",
      "submit-proposal",
      "report-limitation",
    ],
    budget: { wallSeconds: 120, outputBytes: 4096 },
    deadlineAt: "2026-07-28T11:00:00.000Z",
  };
  const instructionBinding = {
    profile: "rak-release-provider-instructions/1.0.0",
    proposalInstructions: value.proposalInstructions,
    proposalProfileId: value.proposalProfileId,
    providerRole: value.providerRole,
    taskKind: value.taskKind,
  };
  value.instructionBundleDigest = `sha256:${createHash("sha256")
    .update(
      `{${Object.keys(instructionBinding)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${JSON.stringify(
              instructionBinding[key as keyof typeof instructionBinding],
            )}`,
        )
        .join(",")}}`,
    )
    .digest("hex")}` as `sha256:${string}`;
  return value;
}

function capsule(): AgentTaskCapsule {
  return {
    schemaVersion: "1.0.0",
    task: task(),
    runContext: { projectSlug: "fixture" },
    evidence: [
      {
        evidenceId: "evidence-1",
        sourceLocator: "src/index.ts:1",
        mediaType: "text/plain",
        sensitivity: "internal",
        truncated: false,
        byteLength: 12,
        escapedPayload: "untrusted text",
      },
    ],
    authorityOrder: [
      "release-safety-policy",
      "typed-task-context",
      "release-task-instructions",
      "untrusted-evidence",
      "provider-proposal",
    ],
  };
}

function capabilities(provider: "codex" | "claude-code"): RequestedProviderCapabilities {
  return {
    outputAccess: "proposal-outbox",
    providerInference: { attested: true, destination: provider },
  };
}

const checks: AcceptanceCheckCatalog = new Map([
  [
    "material-claims-cited",
    (proposal) =>
      Array.isArray(proposal["evidenceOccurrenceIds"]) &&
      proposal["evidenceOccurrenceIds"].length > 0
        ? []
        : ["material claims require evidence"],
  ],
]);

function proposal() {
  return {
    schemaVersion: "1.0.0",
    schemaId: "rak-agent-proposal/1.0.0",
    taskId: "task-1",
    runId: "run_1",
    attemptId: "attempt-1",
    fenceToken: "7",
    evidenceOccurrenceIds: ["evidence-1"],
    limitationIds: [],
    content: {
      claims: [
        {
          claimId: "claim-1",
          controlId: "ARCHITECTURE/BOUNDARY",
          result: "partial",
          evidenceOccurrenceIds: ["evidence-1"],
          summary: "Bounded proposal.",
        },
      ],
      limitations: [],
    },
  };
}

function executor(onPlan?: (plan: ProviderLaunchPlan) => void): ProviderExecutor {
  return {
    available: true,
    async execute(plan) {
      onPlan?.(plan);
      return {
        state: "completed",
        proposal: proposal(),
        proposalReceipt: receipt("proposal"),
        operationalLogReceipt: receipt("operational-log"),
        providerSessionId: "session-1",
        startedAt: clock(),
        endedAt: clock(),
        limitationIds: [],
      };
    },
  };
}

const metadata = {
  adapterVersion: "1.0.0",
  cliVersion: "fixture-only",
  imageDigest: digest("d"),
};

describe("Codex and Claude adapter parity", () => {
  it.each([
    ["codex", createCodexAdapter, "read-only/never"],
    ["claude-code", createClaudeCodeAdapter, "dontAsk/deny-precedence"],
  ] as const)(
    "uses the same task capsule and acceptance validator for %s",
    async (provider, factory, permissionMode) => {
      let launchPlan: ProviderLaunchPlan | undefined;
      const adapter = factory(
        executor((plan) => (launchPlan = plan)),
        metadata,
        checks,
        clock,
      );
      const outcome = await adapter.run({
        capsule: capsule(),
        requestedCapabilities: capabilities(provider),
      });
      expect(outcome.outcome).toBe("succeeded");
      expect(outcome.proposalReceipt).toEqual(receipt("proposal"));
      expect(launchPlan).toMatchObject({
        provider,
        environment: {},
        networkDestination: provider,
        outputChannel: "proposal-outbox",
        permissionMode,
      });
      expect(launchPlan?.fixedArguments).toEqual(providerCliSpecs[provider].fixedArguments);
      expect(launchPlan?.stdin).toContain('"authorityOrder"');
      expect(launchPlan?.stdin).not.toContain("/workspace/");
      expect(launchPlan?.stdin).not.toContain('"prompt"');
    },
  );

  it("round-trips only a typed broker-owned runner capsule and rejects obsolete prompt input", () => {
    const serialized = serializeProviderRunnerCapsule(
      "codex",
      capsule(),
      capabilities("codex"),
      checks,
    );
    expect(parseProviderRunnerCapsule(serialized, "codex", checks)).toEqual({
      schemaVersion: "1.0.0",
      provider: "codex",
      capsule: capsule(),
      requestedCapabilities: capabilities("codex"),
    });
    expect(() =>
      parseProviderRunnerCapsule(
        JSON.stringify({ schemaVersion: 1, taskId: "task-1", prompt: "obsolete" }),
        "codex",
        checks,
      ),
    ).toThrowError(/missing or unknown fields/u);
  });

  it("rejects the same malformed task, context, evidence, and capability values as the runner", () => {
    const mutations: Array<(value: AgentTaskCapsule) => void> = [
      (value) => value.task.acceptanceChecks.push("material-claims-cited"),
      (value) => {
        value.task.acceptanceChecks = ["unregistered-check"];
      },
      (value) => {
        value.task.requiredOutputSchemaId = "";
      },
      (value) => {
        value.task.evidenceView.viewId = "";
      },
      (value) => {
        (value.runContext as Record<string, unknown>)["nested"] = { denied: true };
      },
      (value) => {
        (value.evidence[0] as unknown as Record<string, unknown>)["mediaType"] = "text/html";
      },
      (value) => {
        (value.evidence[0] as unknown as Record<string, unknown>)["sensitivity"] = "secret";
      },
      (value) => {
        (value.evidence[0] as unknown as Record<string, unknown>)["truncated"] = "false";
      },
      (value) => {
        value.evidence[0]!.byteLength = 1.5;
      },
      (value) => {
        value.evidence[0]!.sourceLocator = "";
      },
    ];
    for (const mutate of mutations) {
      const value = capsule();
      mutate(value);
      expect(() => validateTaskCapsule(value, checks)).toThrow();
    }

    for (const invalid of ["false", 1, null]) {
      const invalidCapabilities = capabilities("codex") as unknown as Record<string, unknown>;
      invalidCapabilities["permissionBypass"] = invalid;
      expect(() =>
        serializeProviderRunnerCapsule(
          "codex",
          capsule(),
          invalidCapabilities as unknown as RequestedProviderCapabilities,
          checks,
        ),
      ).toThrow(/CAPABILITY_VALUE_INVALID/u);
    }
  });

  it("admits runner output only through a closed receipt and the shared proposal validator", async () => {
    const proposalBytes = Buffer.from(JSON.stringify(proposal()), "utf8");
    const proposalReceipt: ArtifactReceipt = {
      receiptId: "receipt-provider-proposal",
      outboxName: "provider-proposal",
      mediaType: "application/json",
      byteLength: String(proposalBytes.byteLength),
      sha256: `sha256:${createHash("sha256").update(proposalBytes).digest("hex")}`,
      closed: true,
    };
    const operationalLogReceipt: ArtifactReceipt = {
      ...receipt("provider-operational-log"),
      outboxName: "provider-operational-log",
    };
    let transportCalls = 0;
    const transport: ProviderRunnerTransport = {
      available: true,
      async execute(input) {
        transportCalls += 1;
        expect(input.taskEnvelope.provider).toBe("codex");
        expect(input.fixedArguments).toEqual(providerCliSpecs.codex.fixedArguments);
        return {
          state: "completed",
          proposalOutbox: { bytes: proposalBytes, receipt: proposalReceipt },
          operationalLogReceipt,
          startedAt: clock(),
          endedAt: clock(),
          limitationIds: [],
        };
      },
    };
    const brokered = createBrokeredProviderExecutor({
      provider: "codex",
      transport,
      normalizer: {
        normalize: (_provider, bytes) => JSON.parse(Buffer.from(bytes).toString("utf8")),
      },
      acceptanceChecks: checks,
    });
    const outcome = await createCodexAdapter(brokered, metadata, checks, clock).run({
      capsule: capsule(),
      requestedCapabilities: capabilities("codex"),
    });
    expect(outcome.outcome).toBe("succeeded");
    expect(outcome.proposalReceipt).toEqual(proposalReceipt);
    expect(transportCalls).toBe(1);

    const tamperedTransport: ProviderRunnerTransport = {
      ...transport,
      async execute() {
        return {
          state: "completed",
          proposalOutbox: {
            bytes: proposalBytes,
            receipt: { ...proposalReceipt, sha256: digest("f") },
          },
          operationalLogReceipt,
          startedAt: clock(),
          endedAt: clock(),
          limitationIds: [],
        };
      },
    };
    const rejected = await createCodexAdapter(
      createBrokeredProviderExecutor({
        provider: "codex",
        transport: tamperedTransport,
        normalizer: {
          normalize: (_provider, bytes) => JSON.parse(Buffer.from(bytes).toString("utf8")),
        },
        acceptanceChecks: checks,
      }),
      metadata,
      checks,
      clock,
    ).run({
      capsule: capsule(),
      requestedCapabilities: capabilities("codex"),
    });
    expect(rejected.outcome).toBe("contract-invalid");
    expect(rejected.limitationIds).toContain("PROPOSAL_RECEIPT_INVALID");
  });

  it.each(["codex", "claude-code"] as const)(
    "fails closed when %s is unavailable",
    async (provider) => {
      const unavailable: ProviderExecutor = {
        available: false,
        async execute() {
          throw new Error("must not execute");
        },
      };
      const factory = provider === "codex" ? createCodexAdapter : createClaudeCodeAdapter;
      const outcome = await factory(unavailable, metadata, checks, clock).run({
        capsule: capsule(),
        requestedCapabilities: capabilities(provider),
      });
      expect(outcome.outcome).toBe("provider-unavailable");
      expect(outcome.limitationIds).toEqual(["PROVIDER_UNAVAILABLE"]);
    },
  );

  it.each(["codex", "claude-code"] as const)(
    "denies bypass, source, SSH, state, output tree, helper/runtime, and arbitrary network equally for %s",
    async (provider) => {
      let executed = false;
      const guarded = executor(() => {
        executed = true;
      });
      const factory = provider === "codex" ? createCodexAdapter : createClaudeCodeAdapter;
      const outcome = await factory(guarded, metadata, checks, clock).run({
        capsule: capsule(),
        requestedCapabilities: {
          ...capabilities(provider),
          permissionBypass: true,
          sourceAccess: true,
          sshAccess: true,
          stateAccess: true,
          generatedTreeAccess: true,
          helperAccess: true,
          runtimeAccess: true,
          arbitraryNetwork: true,
        },
      });
      expect(outcome.outcome).toBe("permission-denied");
      expect(outcome.limitationIds).toEqual([
        "PERMISSION_BYPASS_DENIED",
        "SOURCE_ACCESS_DENIED",
        "SSH_ACCESS_DENIED",
        "STATE_ACCESS_DENIED",
        "GENERATED_TREE_ACCESS_DENIED",
        "RUNTIME_ACCESS_DENIED",
        "HELPER_ACCESS_DENIED",
        "ARBITRARY_NETWORK_DENIED",
      ]);
      expect(executed).toBe(false);
    },
  );

  it.each(["codex", "claude-code"] as const)(
    "rejects source paths embedded in the shared capsule for %s",
    async (provider) => {
      const badCapsule = capsule();
      badCapsule.evidence[0]!.sourceLocator = "/live/source/private.ts";
      const factory = provider === "codex" ? createCodexAdapter : createClaudeCodeAdapter;
      const outcome = await factory(executor(), metadata, checks, clock).run({
        capsule: badCapsule,
        requestedCapabilities: capabilities(provider),
      });
      expect(outcome.outcome).toBe("contract-invalid");
      expect(outcome.limitationIds).toContain("TASK_CONTRACT_INVALID");
    },
  );

  it.each(["codex", "claude-code"] as const)(
    "applies identical evidence acceptance failures for %s",
    async (provider) => {
      const invalidExecutor = executor();
      invalidExecutor.execute = async () => ({
        state: "completed",
        proposal: { ...proposal(), evidenceOccurrenceIds: ["unavailable-evidence"] },
        proposalReceipt: receipt("proposal"),
        operationalLogReceipt: receipt("operational-log"),
        startedAt: clock(),
        endedAt: clock(),
        limitationIds: [],
      });
      const factory = provider === "codex" ? createCodexAdapter : createClaudeCodeAdapter;
      const outcome = await factory(invalidExecutor, metadata, checks, clock).run({
        capsule: capsule(),
        requestedCapabilities: capabilities(provider),
      });
      expect(outcome.outcome).toBe("contract-invalid");
      expect(outcome.limitationIds).toContain("PROPOSAL_ACCEPTANCE_FAILED");
    },
  );

  it.each(["codex", "claude-code"] as const)(
    "rejects generic and unsafe content before a provider task can succeed for %s",
    async (provider) => {
      for (const content of [
        { summary: "generic proposal" },
        {
          claims: [
            {
              claimId: "claim-1",
              controlId: "ARCHITECTURE/BOUNDARY",
              result: "partial",
              evidenceOccurrenceIds: ["evidence-1"],
              summary: "<script>unsafe</script>",
            },
          ],
          limitations: [],
        },
      ]) {
        const invalidExecutor = executor();
        invalidExecutor.execute = async () => ({
          state: "completed",
          proposal: { ...proposal(), content },
          proposalReceipt: receipt("proposal"),
          operationalLogReceipt: receipt("operational-log"),
          startedAt: clock(),
          endedAt: clock(),
          limitationIds: [],
        });
        const factory = provider === "codex" ? createCodexAdapter : createClaudeCodeAdapter;
        const outcome = await factory(invalidExecutor, metadata, checks, clock).run({
          capsule: capsule(),
          requestedCapabilities: capabilities(provider),
        });
        expect(outcome.outcome).toBe("contract-invalid");
        expect(outcome.limitationIds).toContain("PROPOSAL_ACCEPTANCE_FAILED");
      }
    },
  );
});

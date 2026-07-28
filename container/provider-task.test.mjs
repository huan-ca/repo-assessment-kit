import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Ajv2020 from "../packages/contracts/node_modules/ajv/dist/2020.js";
import ts from "typescript";

import {
  AUTHOR_PROPOSAL_INSTRUCTIONS,
  AUTHOR_PROPOSAL_PROFILE,
  REVIEW_PROPOSAL_INSTRUCTIONS,
  REVIEW_PROPOSAL_PROFILE,
  buildProviderLaunchPlan,
  createProviderEventStreamParser,
  executeProviderPlan,
  extractProviderProposal,
  REGISTERED_ACCEPTANCE_CHECK_IDS,
  REGISTERED_OUTPUT_SCHEMA_IDS,
  validateProviderTaskEnvelope,
} from "./provider-task.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const instructionDigest = (task) => {
  const document = {
    ...(task.expectedAuthorProposalDigest === undefined
      ? {}
      : { expectedAuthorProposalDigest: task.expectedAuthorProposalDigest }),
    profile: "rak-release-provider-instructions/1.0.0",
    proposalInstructions: task.proposalInstructions,
    proposalProfileId: task.proposalProfileId,
    providerRole: task.providerRole,
    taskKind: task.taskKind,
  };
  const canonical = `{${Object.keys(document)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(document[key])}`)
    .join(",")}}`;
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
};

function envelope(provider = "codex") {
  const value = {
    schemaVersion: "1.0.0",
    provider,
    capsule: {
      schemaVersion: "1.0.0",
      task: {
        schemaVersion: "1.0.0",
        taskId: "task-1",
        runId: "run-1",
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
        deadlineAt: "2099-07-28T11:00:00.000Z",
      },
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
    },
    requestedCapabilities: {
      outputAccess: "proposal-outbox",
      providerInference: { attested: true, destination: provider },
    },
  };
  value.capsule.task.instructionBundleDigest = instructionDigest(value.capsule.task);
  return value;
}

const schema = JSON.parse(
  await readFile(new URL("./task-capsule.schema.json", import.meta.url), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validateSchema = ajv.compile(schema);

const providerSpecSource = await readFile(
  new URL("../packages/agent-adapters/src/provider-spec.ts", import.meta.url),
  "utf8",
);
const providerSpecModule = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(providerSpecSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  ).toString("base64")}`
);

test("JSON schema and runner admit the same typed capsule for both providers", () => {
  for (const provider of ["codex", "claude-code"]) {
    const candidate = envelope(provider);
    assert.equal(validateSchema(candidate), true, JSON.stringify(validateSchema.errors));
    assert.equal(validateProviderTaskEnvelope(candidate, provider), candidate);
  }
});

test("runner supplies the typed capsule on stdin with fixed fail-closed flags", () => {
  const codex = buildProviderLaunchPlan("codex", envelope().capsule);
  assert.deepEqual(codex.args, [
    "exec",
    "--sandbox",
    "read-only",
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--strict-config",
    "-c",
    'approval_policy="never"',
    "--json",
    "--output-schema",
    "/run/rak/schema/agent-proposal.schema.json",
    "-C",
    "/run/rak/proposal",
    "-c",
    "mcp_servers={}",
    "-c",
    "notify=[]",
    "-c",
    "project_doc_max_bytes=0",
    "-",
  ]);
  assert.equal(JSON.parse(codex.stdin).task.taskId, "task-1");

  const claude = buildProviderLaunchPlan("claude-code", envelope("claude-code").capsule);
  assert.deepEqual(claude.args, [
    "-p",
    "--permission-mode",
    "dontAsk",
    "--output-format",
    "stream-json",
    "--verbose",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--tools",
    "",
  ]);
  assert.equal(JSON.parse(claude.stdin).authorityOrder[0], "release-safety-policy");
  assert.equal(claude.args.includes("--dangerously-skip-permissions"), false);
});

test("runner flags and registered contracts match the exported canonical adapter spec", () => {
  for (const provider of ["codex", "claude-code"]) {
    const plan = buildProviderLaunchPlan(provider, envelope(provider).capsule);
    const canonical = providerSpecModule.providerCliSpecs[provider];
    assert.equal(plan.command, canonical.executable);
    assert.deepEqual(plan.args, [...canonical.fixedArguments]);
  }
  assert.deepEqual(REGISTERED_ACCEPTANCE_CHECK_IDS, [
    ...providerSpecModule.registeredAcceptanceCheckIds,
  ]);
  assert.deepEqual(REGISTERED_OUTPUT_SCHEMA_IDS, [...providerSpecModule.registeredOutputSchemaIds]);
});

test("the pinned Codex 0.145.0 parser accepts the exact fixed unattended argv", () => {
  const version = spawnSync("codex", ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /\b0\.145\.0\b/u);
  const plan = buildProviderLaunchPlan("codex", envelope().capsule);
  const probe = spawnSync(plan.command, [...plan.args.slice(0, -1), "--help"], {
    encoding: "utf8",
  });
  assert.equal(probe.status, 0, probe.stderr);
  assert.match(probe.stdout, /Run Codex non-interactively/u);
});

test("unknown fields, prompt-only capsules, and arbitrary commands fail closed", () => {
  const cases = [
    { ...envelope(), prompt: "obsolete" },
    { schemaVersion: 1, taskId: "task-1", prompt: "obsolete" },
    (() => {
      const value = envelope();
      value.capsule.task.allowedCommands.push("run-shell");
      return value;
    })(),
    (() => {
      const value = envelope();
      value.capsule.task.command = "sh";
      return value;
    })(),
  ];
  for (const candidate of cases) {
    assert.equal(validateSchema(candidate), false);
    assert.throws(
      () => validateProviderTaskEnvelope(candidate, "codex"),
      /invalid provider task capsule/u,
    );
  }
});

test("provider mismatch, unattested inference, bypass, and compartment visibility fail closed", () => {
  const cases = [
    ["provider mismatch", (value) => (value.provider = "claude-code")],
    [
      "inference mismatch",
      (value) => (value.requestedCapabilities.providerInference.destination = "claude-code"),
    ],
    [
      "unattested inference",
      (value) => (value.requestedCapabilities.providerInference.attested = false),
    ],
    ["permission bypass", (value) => (value.requestedCapabilities.permissionBypass = true)],
    ["source", (value) => (value.requestedCapabilities.sourceAccess = true)],
    ["SSH", (value) => (value.requestedCapabilities.sshAccess = true)],
    ["state", (value) => (value.requestedCapabilities.stateAccess = true)],
    ["kit", (value) => (value.requestedCapabilities.kitAccess = true)],
    ["generated", (value) => (value.requestedCapabilities.generatedTreeAccess = true)],
    ["helper", (value) => (value.requestedCapabilities.helperAccess = true)],
    ["runtime", (value) => (value.requestedCapabilities.runtimeAccess = true)],
    ["network", (value) => (value.requestedCapabilities.arbitraryNetwork = true)],
    ["output", (value) => (value.requestedCapabilities.outputAccess = "generated-tree")],
  ];
  for (const [label, mutate] of cases) {
    const candidate = envelope();
    mutate(candidate);
    if (label !== "provider mismatch" && label !== "inference mismatch") {
      assert.equal(validateSchema(candidate), false, label);
    }
    assert.throws(
      () => validateProviderTaskEnvelope(candidate, "codex"),
      /invalid provider task capsule/u,
      label,
    );
  }
});

test("source paths and non-allowlisted evidence fail closed", () => {
  const sourcePath = envelope();
  sourcePath.capsule.evidence[0].sourceLocator = "/live/source/private.ts";
  assert.equal(validateSchema(sourcePath), false);
  assert.throws(() => validateProviderTaskEnvelope(sourcePath, "codex"), /exposes a path/u);

  const unavailable = envelope();
  unavailable.capsule.evidence[0].evidenceId = "evidence-not-allowed";
  assert.equal(validateSchema(unavailable), true);
  assert.throws(() => validateProviderTaskEnvelope(unavailable, "codex"), /unavailable/u);
});

test("the required output schema and acceptance-check contract cannot be omitted or expanded", () => {
  const noChecks = envelope();
  noChecks.capsule.task.acceptanceChecks = [];
  assert.equal(validateSchema(noChecks), false);
  assert.throws(() => validateProviderTaskEnvelope(noChecks, "codex"), /acceptance checks/u);

  const duplicateCheck = envelope();
  duplicateCheck.capsule.task.acceptanceChecks.push("material-claims-cited");
  assert.equal(validateSchema(duplicateCheck), false);
  assert.throws(() => validateProviderTaskEnvelope(duplicateCheck, "codex"), /duplicates/u);

  const extraOutputContract = envelope();
  extraOutputContract.capsule.task.outputSchema = { type: "object" };
  assert.equal(validateSchema(extraOutputContract), false);
  assert.throws(
    () => validateProviderTaskEnvelope(extraOutputContract, "codex"),
    /missing or unknown fields/u,
  );

  const unregisteredCheck = envelope();
  unregisteredCheck.capsule.task.acceptanceChecks = ["operator-supplied-check"];
  assert.equal(validateSchema(unregisteredCheck), false);
  assert.throws(
    () => validateProviderTaskEnvelope(unregisteredCheck, "codex"),
    /not release-owned/u,
  );

  const unregisteredSchema = envelope();
  unregisteredSchema.capsule.task.requiredOutputSchemaId = "operator-schema/1";
  assert.equal(validateSchema(unregisteredSchema), false);
  assert.throws(
    () => validateProviderTaskEnvelope(unregisteredSchema, "codex"),
    /not release-owned/u,
  );
});

function finalProposal() {
  return {
    schemaVersion: "1.0.0",
    schemaId: "rak-agent-proposal/1.0.0",
    taskId: "task-1",
    runId: "run-1",
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
          summary: "Bounded structured result.",
        },
      ],
      limitations: [],
    },
  };
}

function codexStream(proposal = finalProposal()) {
  return [
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { id: "item-1", type: "agent_message", text: JSON.stringify(proposal) },
    },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
  ]
    .map(JSON.stringify)
    .join("\n")
    .concat("\n");
}

function claudeStream(proposal = finalProposal()) {
  const serialized = JSON.stringify(proposal);
  return [
    { type: "system", subtype: "init", tools: [], mcp_servers: [] },
    { type: "assistant", message: { content: [{ type: "text", text: serialized }] } },
    { type: "result", subtype: "success", is_error: false, result: serialized },
  ]
    .map(JSON.stringify)
    .join("\n")
    .concat("\n");
}

test("pinned Codex and Claude streams extract exactly one schema-valid final proposal", () => {
  for (const [provider, stream] of [
    ["codex", codexStream()],
    ["claude-code", claudeStream()],
  ]) {
    const bytes = extractProviderProposal(
      provider,
      Buffer.from(stream),
      envelope(provider).capsule.task,
    );
    assert.deepEqual(JSON.parse(Buffer.from(bytes).toString("utf8")), finalProposal());
  }
});

test("chunk boundaries cannot alter provider event parsing", () => {
  for (const [provider, stream] of [
    ["codex", codexStream()],
    ["claude-code", claudeStream()],
  ]) {
    const parser = createProviderEventStreamParser(provider, envelope(provider).capsule.task);
    const bytes = Buffer.from(stream);
    for (let offset = 0; offset < bytes.length; offset += 3) {
      parser.push(bytes.subarray(offset, Math.min(offset + 3, bytes.length)));
    }
    assert.deepEqual(JSON.parse(Buffer.from(parser.finish()).toString("utf8")), finalProposal());
    assert.throws(() => parser.finish(), /parser was already closed/u);
  }
});

test("multiple finals, trailing events, tool events, errors, duplicate members and binary fail closed", () => {
  const task = envelope().capsule.task;
  const codexEvents = codexStream().trimEnd().split("\n");
  const secondFinal = JSON.stringify({
    type: "item.completed",
    item: { id: "item-2", type: "agent_message", text: JSON.stringify(finalProposal()) },
  });
  const cases = [
    `${codexEvents.slice(0, 3).join("\n")}\n${secondFinal}\n${codexEvents[3]}\n`,
    `${codexStream()}${JSON.stringify({ type: "turn.started" })}\n`,
    [
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item-tool", type: "command_execution", command: "cat /source" },
      }),
      JSON.stringify({ type: "turn.completed", usage: {} }),
    ].join("\n"),
    '{"type":"thread.started","type":"turn.started","thread_id":"x"}\n',
  ];
  for (const stream of cases) {
    assert.throws(
      () => extractProviderProposal("codex", Buffer.from(stream), task),
      /invalid provider task capsule/u,
    );
  }
  assert.throws(
    () => extractProviderProposal("codex", Buffer.from([0xff, 0x00, 0x01]), task),
    /invalid provider task capsule/u,
  );

  const claudeTool = [
    { type: "system", subtype: "init", tools: ["Bash"], mcp_servers: [] },
    { type: "result", subtype: "error", is_error: true, result: "denied" },
  ]
    .map(JSON.stringify)
    .join("\n");
  assert.throws(
    () =>
      extractProviderProposal(
        "claude-code",
        Buffer.from(claudeTool),
        envelope("claude-code").capsule.task,
      ),
    /tools or MCP authority/u,
  );
});

test("proposal identity and evidence allowlist are revalidated after stream extraction", () => {
  for (const mutation of [
    (proposal) => {
      proposal.runId = "run-other";
    },
    (proposal) => {
      proposal.evidenceOccurrenceIds = ["evidence-not-allowed"];
    },
    (proposal) => {
      proposal.extra = "unknown";
    },
  ]) {
    const proposal = finalProposal();
    mutation(proposal);
    assert.throws(
      () =>
        extractProviderProposal(
          "codex",
          Buffer.from(codexStream(proposal)),
          envelope().capsule.task,
        ),
      /invalid provider task capsule/u,
    );
  }
});

test("task-specific content rejects generic, unsafe, and structurally unbound author proposals", () => {
  const cases = [
    { ...finalProposal(), content: { summary: "generic content" } },
    ...[
      "AKIA1234567890ABCDEF",
      "/workspace/customer/secret",
      "<script>alert(1)</script>",
      "The repository is fully compliant.",
    ].map((summary) => {
      const value = finalProposal();
      value.content.claims[0].summary = summary;
      return value;
    }),
    (() => {
      const value = finalProposal();
      value.content.claims[0].evidenceOccurrenceIds = ["evidence-not-allowed"];
      return value;
    })(),
    (() => {
      const value = finalProposal();
      value.content.limitations = [
        {
          limitationId: "limitation-1",
          code: "EVIDENCE_GAP",
          evidenceOccurrenceIds: ["evidence-1"],
        },
      ];
      return value;
    })(),
  ];
  for (const proposal of cases) {
    assert.throws(
      () =>
        extractProviderProposal(
          "codex",
          Buffer.from(codexStream(proposal)),
          envelope().capsule.task,
        ),
      /invalid provider task capsule/u,
    );
  }
});

test("task kind, role, and release-owned proposal profile cannot be mismatched", () => {
  const candidate = envelope();
  candidate.capsule.task.providerRole = "independent-reviewer";
  candidate.capsule.task.proposalProfileId = REVIEW_PROPOSAL_PROFILE;
  candidate.capsule.task.proposalInstructions = REVIEW_PROPOSAL_INSTRUCTIONS;
  candidate.capsule.task.expectedAuthorProposalDigest = digest("d");
  assert.equal(validateSchema(candidate), false);
  assert.throws(
    () => validateProviderTaskEnvelope(candidate, "codex"),
    /task kind and provider role/u,
  );
});

test("review proposals bind the exact capsule author digest and closed review shape", () => {
  const candidate = envelope();
  const task = candidate.capsule.task;
  task.taskKind = "finding-review";
  task.providerRole = "independent-reviewer";
  task.proposalProfileId = REVIEW_PROPOSAL_PROFILE;
  task.proposalInstructions = REVIEW_PROPOSAL_INSTRUCTIONS;
  task.expectedAuthorProposalDigest = digest("d");
  task.instructionBundleDigest = instructionDigest(task);
  assert.equal(validateProviderTaskEnvelope(candidate, "codex"), candidate);
  const review = {
    ...finalProposal(),
    content: {
      authorProposalDigest: digest("d"),
      verdict: "passed",
      objectionCodes: [],
      evidenceOccurrenceIds: ["evidence-1"],
    },
  };
  assert.deepEqual(
    JSON.parse(
      Buffer.from(
        extractProviderProposal("codex", Buffer.from(codexStream(review)), task),
      ).toString("utf8"),
    ),
    review,
  );
  review.content.authorProposalDigest = digest("e");
  assert.throws(
    () => extractProviderProposal("codex", Buffer.from(codexStream(review)), task),
    /expected author proposal/u,
  );
});

async function assertDescendantTimeout({ wallBudget, deadlineBudget, maximumElapsed }) {
  const directory = await mkdtemp(join(tmpdir(), "rak-provider-timeout-"));
  const descendantPidPath = join(directory, "descendant.pid");
  const descendantScript = `
    const { spawn } = require("node:child_process");
    process.on("SIGTERM", () => {});
    spawn(process.execPath, ["-e", ${JSON.stringify(
      `const {writeFileSync}=require("node:fs");writeFileSync(${JSON.stringify(
        descendantPidPath,
      )},String(process.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000)`,
    )}], {
      stdio: ["ignore", "inherit", "inherit"]
    });
    setInterval(() => {}, 1000);
  `;
  const started = performance.now();
  try {
    await assert.rejects(
      executeProviderPlan({
        plan: {
          command: process.execPath,
          args: ["-e", descendantScript],
          stdin: "",
        },
        cwd: directory,
        environment: { PATH: process.env.PATH },
        wallBudget,
        deadlineBudget,
        outputLimit: 4096,
        proposalPath: join(directory, "events.jsonl"),
      }),
      /provider exceeded the admitted task time budget/u,
    );
    const elapsed = performance.now() - started;
    assert.ok(
      elapsed < maximumElapsed,
      `descendant-held stdio exceeded the bound: ${Math.round(elapsed)}ms`,
    );
    const descendantPid = Number(await readFile(descendantPidPath, "utf8"));
    let descendantAlive = true;
    for (let attempt = 0; attempt < 20 && descendantAlive; attempt += 1) {
      try {
        const stat = await readFile(`/proc/${descendantPid}/stat`, "utf8");
        descendantAlive = !/\)\s+Z\s/u.test(stat);
        if (!descendantAlive) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        descendantAlive = false;
      }
    }
    assert.equal(descendantAlive, false, "provider descendant survived the process-group kill");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("wall timeout kills the full descendant process group and closes held stdio", async () => {
  await assertDescendantTimeout({
    wallBudget: 1000,
    deadlineBudget: 10_000,
    maximumElapsed: 1800,
  });
});

test("deadline kills the full descendant process group and closes held stdio", async () => {
  await assertDescendantTimeout({
    wallBudget: 10_000,
    deadlineBudget: 500,
    maximumElapsed: 1300,
  });
});

test("entrypoint exposes no provider flags and retains the broker-owned task verb", async () => {
  const entrypoint = await readFile(new URL("./provider-entrypoint.sh", import.meta.url), "utf8");
  assert.match(entrypoint, /if \[ "\$#" -ne 2 \]/u);
  assert.match(entrypoint, /codex:task\)/u);
  assert.match(entrypoint, /claude-code:task\)/u);
  assert.doesNotMatch(entrypoint, /dangerously-|:run|:resume/u);
});

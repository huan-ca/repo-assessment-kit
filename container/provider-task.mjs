import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const TASK_PATH = "/run/rak/task/task.json";
const PROPOSAL_PATH = "/run/rak/proposal/proposal.json";
const OUTPUT_SCHEMA_PATH = "/run/rak/schema/agent-proposal.schema.json";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const CONTROL_ID = /^[A-Z0-9][A-Z0-9._/-]{0,127}$/u;
const LIMITATION_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const RESULTS = new Set(["pass", "fail", "partial", "blocked", "not-applicable", "not-tested"]);
const VERDICTS = new Set(["passed", "passed-with-objections", "failed"]);
const AUTHOR_TASKS = new Set([
  "architecture-analysis",
  "product-code-trace",
  "security-analysis",
  "decision-synthesis",
]);
const REVIEW_TASKS = new Map([
  ["finding-review", "security-analysis"],
  ["decision-review", "decision-synthesis"],
  ["plain-language-review", "decision-synthesis"],
]);
export const AUTHOR_PROPOSAL_PROFILE = "rak-author-claims-proposal/1.0.0";
export const REVIEW_PROPOSAL_PROFILE = "rak-review-proposal/1.0.0";
export const AUTHOR_PROPOSAL_INSTRUCTIONS =
  "Return content with exactly claims and limitations. Every claim has exactly claimId, controlId, result, evidenceOccurrenceIds, and summary; every cited evidence ID must be admitted. Every limitation has exactly limitationId, code, and evidenceOccurrenceIds. Provider output is a proposal only and grants no review, human, release, compliance, or cross-provider authority.";
export const REVIEW_PROPOSAL_INSTRUCTIONS =
  "Return content with exactly authorProposalDigest, verdict, objectionCodes, and evidenceOccurrenceIds. authorProposalDigest must equal the capsule expected author digest and every evidence ID must be admitted. This is a fresh-session proposal review only and grants no organizational independence, human, release, compliance, or cross-provider authority.";
const PROHIBITED_CONTENT =
  /<(?:script|iframe|object|embed|svg|math|form|style|link|meta)\b|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=|-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:aws_secret_access_key|client_secret|private_key|password|authorization)\s*[:=]\s*["']?[^\s"',;]{8,}|(?:\/(?:Users|home|workspace|tmp|var\/folders|etc)\/[^\s"'<>]+|[A-Za-z]:\\(?:Users|Documents and Settings|Windows)\\[^\s"'<>]+)|\b(?:fully compliant|guaranteed compliant|certified|legally required|meets all regulatory requirements|is secure|no vulnerabilities were found)\b/iu;
const TASK_KINDS = new Set([
  "repository-map",
  "product-code-trace",
  "architecture-analysis",
  "security-analysis",
  "finding-review",
  "decision-synthesis",
  "decision-review",
  "plain-language-review",
]);
const COMMANDS = new Set([
  "get-run-context",
  "get-evidence-metadata",
  "get-safe-evidence-text",
  "submit-proposal",
  "report-limitation",
]);
export const REGISTERED_ACCEPTANCE_CHECK_IDS = Object.freeze(["material-claims-cited"]);
export const REGISTERED_OUTPUT_SCHEMA_IDS = Object.freeze(["rak-agent-proposal/1.0.0"]);
const ACCEPTANCE_CHECKS = new Set(REGISTERED_ACCEPTANCE_CHECK_IDS);
const OUTPUT_SCHEMAS = new Set(REGISTERED_OUTPUT_SCHEMA_IDS);
const AUTHORITY_ORDER = [
  "release-safety-policy",
  "typed-task-context",
  "release-task-instructions",
  "untrusted-evidence",
  "provider-proposal",
];
const DENIED_CAPABILITIES = [
  "permissionBypass",
  "sourceAccess",
  "sshAccess",
  "stateAccess",
  "kitAccess",
  "generatedTreeAccess",
  "runtimeAccess",
  "helperAccess",
  "arbitraryNetwork",
];

function fail(message) {
  throw new Error(`invalid provider task capsule: ${message}`);
}

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(`${label} is not an object`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(record(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} has missing or unknown fields`);
  }
}

function boundedString(value, label, maximum = 1024) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    fail(`${label} is missing or too long`);
  }
}

function uniqueStringArray(value, label, options = {}) {
  if (!Array.isArray(value) || value.length < (options.minimum ?? 0)) fail(`${label} is invalid`);
  if (value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 1024)) {
    fail(`${label} contains an invalid value`);
  }
  if (new Set(value).size !== value.length) fail(`${label} contains duplicates`);
}

function boundedIdArray(value, label, maximum = 64, minimum = 0) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || !ID.test(item)) ||
    new Set(value).size !== value.length
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function validateSafeText(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 2048 ||
    PROHIBITED_CONTENT.test(value) ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code < 32 || code === 127);
    })
  ) {
    fail(`${label} contains unsafe or invalid text`);
  }
}

function proposalProfile(task) {
  if (task.providerRole === "author" && AUTHOR_TASKS.has(task.taskKind)) {
    return {
      profile: AUTHOR_PROPOSAL_PROFILE,
      instructions: AUTHOR_PROPOSAL_INSTRUCTIONS,
      reviewAuthorTaskKind: undefined,
    };
  }
  const reviewAuthorTaskKind = REVIEW_TASKS.get(task.taskKind);
  if (task.providerRole === "independent-reviewer" && reviewAuthorTaskKind !== undefined) {
    return {
      profile: REVIEW_PROPOSAL_PROFILE,
      instructions: REVIEW_PROPOSAL_INSTRUCTIONS,
      reviewAuthorTaskKind,
    };
  }
  fail("task kind and provider role do not select a release-owned proposal profile");
}

function expectedInstructionBundleDigest(task) {
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
}

function validateProposalContent(content, proposal, task) {
  const selected = proposalProfile(task);
  const cited = new Set(proposal.evidenceOccurrenceIds);
  const allowed = new Set(task.evidenceView.allowedEvidenceIds);
  if (task.providerRole === "author") {
    exactKeys(content, ["claims", "limitations"], "author proposal content");
    if (
      !Array.isArray(content.claims) ||
      content.claims.length === 0 ||
      content.claims.length > 256
    ) {
      fail("author proposal claims are invalid");
    }
    if (!Array.isArray(content.limitations) || content.limitations.length > 256) {
      fail("author proposal limitations are invalid");
    }
    const claimIds = new Set();
    for (const [index, claim] of content.claims.entries()) {
      exactKeys(
        claim,
        ["claimId", "controlId", "result", "evidenceOccurrenceIds", "summary"],
        `claim ${index}`,
      );
      if (!ID.test(claim.claimId) || claimIds.has(claim.claimId))
        fail(`claim ${index} ID is invalid`);
      claimIds.add(claim.claimId);
      if (!CONTROL_ID.test(claim.controlId)) fail(`claim ${index} control ID is invalid`);
      if (!RESULTS.has(claim.result)) fail(`claim ${index} result is invalid`);
      const evidenceIds = boundedIdArray(
        claim.evidenceOccurrenceIds,
        `claim ${index} evidence`,
        64,
        1,
      );
      if (evidenceIds.some((id) => !cited.has(id) || !allowed.has(id))) {
        fail(`claim ${index} cites unavailable evidence`);
      }
      validateSafeText(claim.summary, `claim ${index} summary`);
    }
    const limitationIds = new Set();
    for (const [index, limitation] of content.limitations.entries()) {
      exactKeys(
        limitation,
        ["limitationId", "code", "evidenceOccurrenceIds"],
        `limitation ${index}`,
      );
      if (!ID.test(limitation.limitationId) || limitationIds.has(limitation.limitationId)) {
        fail(`limitation ${index} ID is invalid`);
      }
      limitationIds.add(limitation.limitationId);
      if (!LIMITATION_CODE.test(limitation.code)) fail(`limitation ${index} code is invalid`);
      const evidenceIds = boundedIdArray(
        limitation.evidenceOccurrenceIds,
        `limitation ${index} evidence`,
      );
      if (evidenceIds.some((id) => !cited.has(id) || !allowed.has(id))) {
        fail(`limitation ${index} cites unavailable evidence`);
      }
    }
    if (
      proposal.limitationIds.length !== limitationIds.size ||
      proposal.limitationIds.some((id) => !limitationIds.has(id))
    ) {
      fail("proposal limitation IDs do not bind author limitations");
    }
    return;
  }
  exactKeys(
    content,
    ["authorProposalDigest", "verdict", "objectionCodes", "evidenceOccurrenceIds"],
    "review proposal content",
  );
  if (
    !DIGEST.test(content.authorProposalDigest) ||
    content.authorProposalDigest !== task.expectedAuthorProposalDigest
  ) {
    fail("review proposal does not bind the expected author proposal");
  }
  if (!VERDICTS.has(content.verdict)) fail("review verdict is invalid");
  const objectionCodes = boundedIdArray(content.objectionCodes, "review objection codes");
  if (
    (content.verdict === "passed" && objectionCodes.length !== 0) ||
    (content.verdict !== "passed" && objectionCodes.length === 0)
  ) {
    fail("review verdict and objections are inconsistent");
  }
  const evidenceIds = boundedIdArray(content.evidenceOccurrenceIds, "review evidence", 64, 1);
  if (evidenceIds.some((id) => !cited.has(id) || !allowed.has(id))) {
    fail("review cites unavailable evidence");
  }
  if (proposal.limitationIds.length !== 0) {
    fail("review proposal cannot declare unstructured limitations");
  }
  if (selected.reviewAuthorTaskKind === undefined) fail("review profile is invalid");
}

function parseStrictJson(text, label) {
  if (typeof text !== "string" || text.length === 0 || text.includes("\0")) {
    fail(`${label} is empty or binary`);
  }
  const scopes = [];
  let index = 0;
  let expectsKey = false;
  const skip = () => {
    while (/\s/u.test(text[index] ?? "")) index += 1;
  };
  const readString = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
      } else if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      } else {
        index += 1;
      }
    }
    fail(`${label} contains an unterminated string`);
  };
  while (index < text.length) {
    skip();
    const character = text[index];
    if (character === "{") {
      scopes.push({ kind: "object", keys: new Set() });
      expectsKey = true;
      index += 1;
    } else if (character === "[") {
      scopes.push({ kind: "array" });
      expectsKey = false;
      index += 1;
    } else if (character === "}" || character === "]") {
      scopes.pop();
      expectsKey = false;
      index += 1;
    } else if (character === ",") {
      expectsKey = scopes.at(-1)?.kind === "object";
      index += 1;
    } else if (character === '"') {
      const value = readString();
      skip();
      if (expectsKey && scopes.at(-1)?.kind === "object" && text[index] === ":") {
        const scope = scopes.at(-1);
        if (scope.keys.has(value)) fail(`${label} contains duplicate member ${value}`);
        scope.keys.add(value);
        expectsKey = false;
      }
    } else {
      index += 1;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not strict JSON`);
  }
}

function validateFinalProposal(proposal, task) {
  exactKeys(
    proposal,
    [
      "schemaVersion",
      "schemaId",
      "taskId",
      "runId",
      "attemptId",
      "fenceToken",
      "evidenceOccurrenceIds",
      "limitationIds",
      "content",
    ],
    "provider proposal",
  );
  if (
    proposal.schemaVersion !== "1.0.0" ||
    proposal.schemaId !== "rak-agent-proposal/1.0.0" ||
    proposal.schemaId !== task.requiredOutputSchemaId ||
    proposal.taskId !== task.taskId ||
    proposal.runId !== task.runId ||
    proposal.attemptId !== task.attemptId ||
    proposal.fenceToken !== task.fenceToken
  ) {
    fail("provider proposal identity does not match the admitted task");
  }
  uniqueStringArray(proposal.evidenceOccurrenceIds, "proposal evidence IDs");
  uniqueStringArray(proposal.limitationIds, "proposal limitation IDs");
  const allowed = new Set(task.evidenceView.allowedEvidenceIds);
  if (proposal.evidenceOccurrenceIds.some((value) => !allowed.has(value))) {
    fail("provider proposal cites unavailable evidence");
  }
  if (
    proposal.content === null ||
    typeof proposal.content !== "object" ||
    Array.isArray(proposal.content)
  ) {
    fail("provider proposal content is not an object");
  }
  validateProposalContent(proposal.content, proposal, task);
  const bytes = Buffer.from(JSON.stringify(proposal), "utf8");
  if (bytes.byteLength > task.budget.outputBytes) fail("provider proposal exceeds output budget");
  return bytes;
}

function lineObjects(bytes, maximumBytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    fail("provider event stream is empty or oversized");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("provider event stream is not UTF-8");
  }
  if (text.includes("\0")) fail("provider event stream contains binary data");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.some((line) => line.trim() === "" || line.length > 4_194_304)) {
    fail("provider event stream contains an empty or oversized event");
  }
  return lines.map((line, index) => parseStrictJson(line, `provider event ${index + 1}`));
}

function parseCodexEvents(events, task) {
  let state = "initial";
  let finalText;
  for (const event of events) {
    record(event, "Codex event");
    if (event.type === "thread.started" && state === "initial") {
      exactKeys(event, ["type", "thread_id"], "Codex thread event");
      boundedString(event.thread_id, "Codex thread ID");
      state = "thread";
    } else if (event.type === "turn.started" && state === "thread") {
      exactKeys(event, ["type"], "Codex turn-start event");
      state = "turn";
    } else if (event.type === "item.completed" && state === "turn") {
      exactKeys(event, ["type", "item"], "Codex item event");
      exactKeys(event.item, ["id", "type", "text"], "Codex item");
      if (event.item.type !== "agent_message" || finalText !== undefined) {
        fail("Codex stream contains a tool, unknown, or duplicate final item");
      }
      boundedString(event.item.id, "Codex item ID");
      boundedString(event.item.text, "Codex final payload", task.budget.outputBytes);
      finalText = event.item.text;
      state = "final";
    } else if (event.type === "turn.completed" && state === "final") {
      exactKeys(event, ["type", "usage"], "Codex turn-complete event");
      record(event.usage, "Codex usage");
      state = "closed";
    } else {
      fail("Codex stream contains an unknown, out-of-order, error, or trailing event");
    }
  }
  if (state !== "closed" || finalText === undefined)
    fail("Codex stream has no closed final result");
  return validateFinalProposal(parseStrictJson(finalText, "Codex final payload"), task);
}

function parseClaudeEvents(events, task) {
  let state = "initial";
  let assistantText;
  let finalText;
  for (const event of events) {
    record(event, "Claude event");
    if (event.type === "system" && event.subtype === "init" && state === "initial") {
      if (
        !Array.isArray(event.tools) ||
        event.tools.length !== 0 ||
        (Array.isArray(event.mcp_servers) && event.mcp_servers.length !== 0)
      ) {
        fail("Claude stream initialized with tools or MCP authority");
      }
      state = "initialized";
    } else if (event.type === "assistant" && state === "initialized") {
      record(event.message, "Claude assistant message");
      if (!Array.isArray(event.message.content) || event.message.content.length !== 1) {
        fail("Claude assistant event is not one structured text result");
      }
      const content = event.message.content[0];
      exactKeys(content, ["type", "text"], "Claude assistant content");
      if (content.type !== "text") fail("Claude stream contains a tool result");
      boundedString(content.text, "Claude assistant payload", task.budget.outputBytes);
      assistantText = content.text;
      state = "assistant";
    } else if (event.type === "result" && state === "assistant") {
      if (event.subtype !== "success" || event.is_error !== false) {
        fail("Claude stream reports an error");
      }
      boundedString(event.result, "Claude final payload", task.budget.outputBytes);
      if (event.result !== assistantText) fail("Claude assistant and final payloads differ");
      finalText = event.result;
      state = "closed";
    } else {
      fail("Claude stream contains an unknown, out-of-order, error, or trailing event");
    }
  }
  if (state !== "closed" || finalText === undefined) {
    fail("Claude stream has no closed final result");
  }
  return validateFinalProposal(parseStrictJson(finalText, "Claude final payload"), task);
}

export function extractProviderProposal(provider, bytes, task) {
  const maximumStreamBytes = Math.min(16_777_216, task.budget.outputBytes * 8 + 65_536);
  const events = lineObjects(bytes, maximumStreamBytes);
  if (provider === "codex") return parseCodexEvents(events, task);
  if (provider === "claude-code") return parseClaudeEvents(events, task);
  fail("unsupported provider");
}

export function createProviderEventStreamParser(provider, task) {
  const maximumStreamBytes = Math.min(16_777_216, task.budget.outputBytes * 8 + 65_536);
  const chunks = [];
  let byteLength = 0;
  let closed = false;
  return Object.freeze({
    push(chunk) {
      if (closed || !(chunk instanceof Uint8Array) || chunk.byteLength === 0) {
        fail("provider event stream chunk is invalid or parser is closed");
      }
      byteLength += chunk.byteLength;
      if (byteLength > maximumStreamBytes) fail("provider event stream is oversized");
      chunks.push(Buffer.from(chunk));
    },
    finish() {
      if (closed) fail("provider event stream parser was already closed");
      closed = true;
      return extractProviderProposal(provider, Buffer.concat(chunks), task);
    },
  });
}

function validateTask(task) {
  const selected = proposalProfile(task);
  exactKeys(
    task,
    [
      "schemaVersion",
      "taskId",
      "runId",
      "attemptId",
      "fenceToken",
      "taskKind",
      "providerRole",
      "target",
      "evidenceView",
      "instructionBundleDigest",
      "proposalProfileId",
      "proposalInstructions",
      ...(selected.reviewAuthorTaskKind === undefined ? [] : ["expectedAuthorProposalDigest"]),
      "requiredOutputSchemaId",
      "acceptanceChecks",
      "allowedCommands",
      "budget",
      "deadlineAt",
    ],
    "task",
  );
  if (task.schemaVersion !== "1.0.0") fail("unsupported task schema");
  for (const field of ["taskId", "runId", "attemptId", "fenceToken"])
    boundedString(task[field], field);
  if (!TASK_KINDS.has(task.taskKind)) fail("task kind is not release-owned");
  if (task.providerRole !== "author" && task.providerRole !== "independent-reviewer") {
    fail("provider role is invalid");
  }
  if (
    task.proposalProfileId !== selected.profile ||
    task.proposalInstructions !== selected.instructions
  ) {
    fail("proposal profile is not the exact release-owned task profile");
  }
  if (
    selected.reviewAuthorTaskKind === undefined
      ? task.expectedAuthorProposalDigest !== undefined
      : !DIGEST.test(task.expectedAuthorProposalDigest)
  ) {
    fail("expected author proposal binding is invalid");
  }

  exactKeys(task.target, ["snapshotId", "commitSha", "manifestDigest"], "target");
  boundedString(task.target.snapshotId, "snapshot ID");
  if (!COMMIT.test(task.target.commitSha)) fail("commit SHA is not immutable");
  if (!DIGEST.test(task.target.manifestDigest)) fail("manifest digest is invalid");

  exactKeys(task.evidenceView, ["viewId", "digest", "allowedEvidenceIds"], "evidence view");
  boundedString(task.evidenceView.viewId, "evidence view ID");
  if (!DIGEST.test(task.evidenceView.digest)) fail("evidence-view digest is invalid");
  uniqueStringArray(task.evidenceView.allowedEvidenceIds, "evidence allowlist");

  if (
    !DIGEST.test(task.instructionBundleDigest) ||
    task.instructionBundleDigest !== expectedInstructionBundleDigest(task)
  ) {
    fail("instruction digest does not bind the release-owned proposal profile");
  }
  boundedString(task.requiredOutputSchemaId, "required output schema ID");
  if (!OUTPUT_SCHEMAS.has(task.requiredOutputSchemaId)) {
    fail("required output schema is not release-owned");
  }
  uniqueStringArray(task.acceptanceChecks, "acceptance checks", { minimum: 1 });
  if (task.acceptanceChecks.some((checkId) => !ACCEPTANCE_CHECKS.has(checkId))) {
    fail("acceptance check is not release-owned");
  }
  uniqueStringArray(task.allowedCommands, "allowed commands", { minimum: 1 });
  if (task.allowedCommands.some((command) => !COMMANDS.has(command)))
    fail("task requests an unknown command");
  if (
    !task.allowedCommands.includes("submit-proposal") &&
    !task.allowedCommands.includes("report-limitation")
  ) {
    fail("task cannot produce a bounded result");
  }

  exactKeys(task.budget, ["wallSeconds", "outputBytes"], "task budget");
  if (
    !Number.isInteger(task.budget.wallSeconds) ||
    task.budget.wallSeconds < 1 ||
    task.budget.wallSeconds > 7200
  ) {
    fail("wall budget is outside release limits");
  }
  if (
    !Number.isInteger(task.budget.outputBytes) ||
    task.budget.outputBytes < 1 ||
    task.budget.outputBytes > 10_485_760
  ) {
    fail("output budget is outside release limits");
  }
  boundedString(task.deadlineAt, "task deadline");
  if (!Number.isFinite(Date.parse(task.deadlineAt))) fail("task deadline is invalid");
}

function validateCapsule(capsule) {
  exactKeys(
    capsule,
    ["schemaVersion", "task", "runContext", "evidence", "authorityOrder"],
    "capsule",
  );
  if (capsule.schemaVersion !== "1.0.0") fail("unsupported capsule schema");
  validateTask(record(capsule.task, "task"));

  record(capsule.runContext, "run context");
  for (const [key, value] of Object.entries(capsule.runContext)) {
    boundedString(key, "run-context key");
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      fail("run context contains a non-scalar value");
    }
  }
  if (
    !Array.isArray(capsule.authorityOrder) ||
    capsule.authorityOrder.length !== AUTHORITY_ORDER.length ||
    capsule.authorityOrder.some((value, index) => value !== AUTHORITY_ORDER[index])
  ) {
    fail("task authority order is not frozen");
  }
  if (!Array.isArray(capsule.evidence)) fail("evidence is not an array");
  const allowed = new Set(capsule.task.evidenceView.allowedEvidenceIds);
  const seen = new Set();
  for (const evidence of capsule.evidence) {
    exactKeys(
      evidence,
      [
        "evidenceId",
        "sourceLocator",
        "mediaType",
        "sensitivity",
        "truncated",
        "byteLength",
        "escapedPayload",
      ],
      "evidence record",
    );
    boundedString(evidence.evidenceId, "evidence ID");
    if (!allowed.has(evidence.evidenceId) || seen.has(evidence.evidenceId)) {
      fail("capsule contains unavailable or duplicate evidence");
    }
    seen.add(evidence.evidenceId);
    boundedString(evidence.sourceLocator, "evidence locator");
    if (evidence.sourceLocator.startsWith("/") || evidence.sourceLocator.includes("..")) {
      fail("evidence locator exposes a path");
    }
    if (evidence.mediaType !== "text/plain" && evidence.mediaType !== "application/json") {
      fail("evidence media type is invalid");
    }
    if (evidence.sensitivity !== "public" && evidence.sensitivity !== "internal") {
      fail("evidence sensitivity is invalid");
    }
    if (typeof evidence.truncated !== "boolean") fail("evidence truncation flag is invalid");
    if (
      !Number.isInteger(evidence.byteLength) ||
      evidence.byteLength < 0 ||
      evidence.byteLength > capsule.task.budget.outputBytes
    ) {
      fail("evidence record exceeds the task budget");
    }
    if (typeof evidence.escapedPayload !== "string" || evidence.escapedPayload.includes("\0")) {
      fail("evidence payload is invalid");
    }
  }
}

export function validateProviderTaskEnvelope(value, invokedProvider) {
  exactKeys(
    value,
    ["schemaVersion", "provider", "capsule", "requestedCapabilities"],
    "provider envelope",
  );
  if (value.schemaVersion !== "1.0.0") fail("unsupported provider-envelope schema");
  if (value.provider !== "codex" && value.provider !== "claude-code") fail("unsupported provider");
  if (value.provider !== invokedProvider) fail("provider destination mismatch");
  validateCapsule(record(value.capsule, "capsule"));

  const capabilities = record(value.requestedCapabilities, "requested capabilities");
  const allowedCapabilityKeys = [...DENIED_CAPABILITIES, "outputAccess", "providerInference"];
  if (Object.keys(capabilities).some((key) => !allowedCapabilityKeys.includes(key))) {
    fail("unknown capability denied");
  }
  for (const capability of DENIED_CAPABILITIES) {
    if (capabilities[capability] === true) fail(`${capability} denied`);
    if (capabilities[capability] !== undefined && typeof capabilities[capability] !== "boolean") {
      fail(`${capability} is invalid`);
    }
  }
  if (capabilities.outputAccess !== "proposal-outbox") fail("output access denied");
  exactKeys(capabilities.providerInference, ["attested", "destination"], "provider inference");
  if (capabilities.providerInference.attested !== true) fail("provider network is unattested");
  if (capabilities.providerInference.destination !== invokedProvider) {
    fail("provider destination mismatch");
  }
  return value;
}

export function buildProviderLaunchPlan(provider, capsule) {
  const stdin = JSON.stringify(capsule);
  if (provider === "codex") {
    return {
      command: "codex",
      args: [
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
        OUTPUT_SCHEMA_PATH,
        "-C",
        "/run/rak/proposal",
        "-c",
        "mcp_servers={}",
        "-c",
        "notify=[]",
        "-c",
        "project_doc_max_bytes=0",
        "-",
      ],
      stdin,
    };
  }
  if (provider === "claude-code") {
    return {
      command: "claude",
      args: [
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
      ],
      stdin,
    };
  }
  fail("unsupported provider");
}

function signalProcessGroup(child, signal) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    child.kill(signal);
  }
}

export async function executeProviderPlan({
  plan,
  cwd,
  environment,
  wallBudget,
  deadlineBudget,
  outputLimit,
  proposalPath,
  parseOutput,
  streamOutputLimit = outputLimit,
}) {
  const child = spawn(plan.command, plan.args, {
    cwd,
    detached: true,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  child.stdin.end(plan.stdin);

  const chunks = [];
  const errors = [];
  let outputBytes = 0;
  let terminationReason;
  let forceKill;
  const terminate = (reason) => {
    terminationReason ??= reason;
    signalProcessGroup(child, "SIGTERM");
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    forceKill ??= setTimeout(() => signalProcessGroup(child, "SIGKILL"), 250);
  };
  child.stdout.on("data", (chunk) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > streamOutputLimit) {
      terminate("provider output exceeded the admitted task budget");
      return;
    }
    chunks.push(chunk);
  });
  let errorBytes = 0;
  child.stderr.on("data", (chunk) => {
    if (errorBytes < 4096) {
      errors.push(chunk.subarray(0, 4096 - errorBytes));
      errorBytes += chunk.byteLength;
    }
  });
  const timeout = setTimeout(
    () => terminate("provider exceeded the admitted task time budget"),
    Math.min(deadlineBudget, wallBudget),
  );
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
    clearTimeout(forceKill);
  }
  if (terminationReason !== undefined) throw new Error(terminationReason);
  if (exitCode !== 0) {
    const message = Buffer.concat(errors).toString("utf8").slice(0, 4096);
    throw new Error(`provider failed with ${exitCode}: ${message}`);
  }
  const raw = Buffer.concat(chunks);
  const proposal = parseOutput === undefined ? raw : parseOutput(raw);
  if (!(proposal instanceof Uint8Array) || proposal.byteLength > outputLimit) {
    throw new Error("provider final proposal exceeded the admitted output budget");
  }
  await writeFile(proposalPath, proposal, { mode: 0o600, flag: "wx" });
}

async function run() {
  const provider = process.argv[2];
  if (provider !== "codex" && provider !== "claude-code") fail("unsupported provider");
  const envelope = validateProviderTaskEnvelope(
    JSON.parse(await readFile(TASK_PATH, "utf8")),
    provider,
  );
  const deadlineBudget = Date.parse(envelope.capsule.task.deadlineAt) - Date.now();
  if (deadlineBudget <= 0) fail("task deadline has expired");
  await executeProviderPlan({
    plan: buildProviderLaunchPlan(provider, envelope.capsule),
    cwd: "/run/rak/proposal",
    environment: {
      HOME: "/home/node",
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      CODEX_HOME: "/run/rak/provider-auth/codex",
      CLAUDE_CONFIG_DIR: "/run/rak/provider-auth/claude",
      DISABLE_AUTOUPDATER: "1",
    },
    wallBudget: envelope.capsule.task.budget.wallSeconds * 1000,
    deadlineBudget,
    outputLimit: envelope.capsule.task.budget.outputBytes,
    streamOutputLimit: Math.min(16_777_216, envelope.capsule.task.budget.outputBytes * 8 + 65_536),
    proposalPath: PROPOSAL_PATH,
    parseOutput: (bytes) => extractProviderProposal(provider, bytes, envelope.capsule.task),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}

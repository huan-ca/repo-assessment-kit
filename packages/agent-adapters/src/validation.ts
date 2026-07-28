import { createHash } from "node:crypto";

import type {
  AcceptanceCheckCatalog,
  AgentCommand,
  AgentTask,
  AgentTaskCapsule,
  RequestedProviderCapabilities,
} from "./types.js";
import { registeredAcceptanceCheckIds, registeredOutputSchemaIds } from "./provider-spec.js";

const COMMANDS = new Set<AgentCommand>([
  "get-run-context",
  "get-evidence-metadata",
  "get-safe-evidence-text",
  "submit-proposal",
  "report-limitation",
]);
const TASK_KINDS = new Set<AgentTask["taskKind"]>([
  "repository-map",
  "product-code-trace",
  "architecture-analysis",
  "security-analysis",
  "finding-review",
  "decision-synthesis",
  "decision-review",
  "plain-language-review",
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const CONTROL_ID = /^[A-Z0-9][A-Z0-9._/-]{0,127}$/u;
const LIMITATION_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const AUTHOR_TASKS = new Set<AgentTask["taskKind"]>([
  "architecture-analysis",
  "product-code-trace",
  "security-analysis",
  "decision-synthesis",
]);
const REVIEW_TASKS = new Set<AgentTask["taskKind"]>([
  "finding-review",
  "decision-review",
  "plain-language-review",
]);
const RESULTS = new Set(["pass", "fail", "partial", "blocked", "not-applicable", "not-tested"]);
const VERDICTS = new Set(["passed", "passed-with-objections", "failed"]);
export const AUTHOR_PROPOSAL_PROFILE = "rak-author-claims-proposal/1.0.0";
export const REVIEW_PROPOSAL_PROFILE = "rak-review-proposal/1.0.0";
export const AUTHOR_PROPOSAL_INSTRUCTIONS =
  "Return content with exactly claims and limitations. Every claim has exactly claimId, controlId, result, evidenceOccurrenceIds, and summary; every cited evidence ID must be admitted. Every limitation has exactly limitationId, code, and evidenceOccurrenceIds. Provider output is a proposal only and grants no review, human, release, compliance, or cross-provider authority.";
export const REVIEW_PROPOSAL_INSTRUCTIONS =
  "Return content with exactly authorProposalDigest, verdict, objectionCodes, and evidenceOccurrenceIds. authorProposalDigest must equal the capsule expected author digest and every evidence ID must be admitted. This is a fresh-session proposal review only and grants no organizational independence, human, release, compliance, or cross-provider authority.";
const PROHIBITED_CONTENT =
  /<(?:script|iframe|object|embed|svg|math|form|style|link|meta)\b|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=|-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:aws_secret_access_key|client_secret|private_key|password|authorization)\s*[:=]\s*["']?[^\s"',;]{8,}|(?:\/(?:Users|home|workspace|tmp|var\/folders|etc)\/[^\s"'<>]+|[A-Za-z]:\\(?:Users|Documents and Settings|Windows)\\[^\s"'<>]+)|\b(?:fully compliant|guaranteed compliant|certified|legally required|meets all regulatory requirements|is secure|no vulnerabilities were found)\b/iu;

export class AdapterContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdapterContractError";
  }
}

function assert(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) throw new AdapterContractError(code, message);
}

function boundedString(value: unknown, maximum = 1024): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function expectedInstructionBundleDigest(task: AgentTask): string {
  const document: Record<string, string> = {
    profile: "rak-release-provider-instructions/1.0.0",
    proposalInstructions: task.proposalInstructions,
    proposalProfileId: task.proposalProfileId,
    providerRole: task.providerRole,
    taskKind: task.taskKind,
  };
  if (task.expectedAuthorProposalDigest !== undefined) {
    document["expectedAuthorProposalDigest"] = task.expectedAuthorProposalDigest;
  }
  const canonical = `{${Object.keys(document)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(document[key])}`)
    .join(",")}}`;
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function validateAgentTask(task: AgentTask, checks: AcceptanceCheckCatalog): void {
  assert(isRecord(task), "TASK_CONTRACT_INVALID", "Task must be an object.");
  assert(
    hasExactKeys(task, [
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
      ...(task.providerRole === "independent-reviewer" ? ["expectedAuthorProposalDigest"] : []),
      "requiredOutputSchemaId",
      "acceptanceChecks",
      "allowedCommands",
      "budget",
      "deadlineAt",
    ]),
    "TASK_CONTRACT_INVALID",
    "Task has missing or unknown fields.",
  );
  assert(isRecord(task.target), "TASK_CONTRACT_INVALID", "Target identity must be an object.");
  assert(isRecord(task.evidenceView), "TASK_CONTRACT_INVALID", "Evidence view must be an object.");
  assert(isRecord(task.budget), "TASK_CONTRACT_INVALID", "Task budget must be an object.");
  assert(
    hasExactKeys(task.target, ["snapshotId", "commitSha", "manifestDigest"]),
    "TASK_CONTRACT_INVALID",
    "Target identity has missing or unknown fields.",
  );
  assert(
    hasExactKeys(task.evidenceView, ["viewId", "digest", "allowedEvidenceIds"]),
    "TASK_CONTRACT_INVALID",
    "Evidence view has missing or unknown fields.",
  );
  assert(
    hasExactKeys(task.budget, ["wallSeconds", "outputBytes"]),
    "TASK_CONTRACT_INVALID",
    "Task budget has missing or unknown fields.",
  );
  assert(task.schemaVersion === "1.0.0", "TASK_CONTRACT_INVALID", "Unsupported task schema.");
  for (const value of [task.taskId, task.runId, task.attemptId, task.fenceToken]) {
    assert(boundedString(value), "TASK_CONTRACT_INVALID", "Task identity is missing.");
  }
  assert(TASK_KINDS.has(task.taskKind), "TASK_CONTRACT_INVALID", "Task kind is not release-owned.");
  assert(
    task.providerRole === "author" || task.providerRole === "independent-reviewer",
    "TASK_CONTRACT_INVALID",
    "Invalid provider role.",
  );
  const authorProfile = task.providerRole === "author" && AUTHOR_TASKS.has(task.taskKind);
  const reviewProfile =
    task.providerRole === "independent-reviewer" && REVIEW_TASKS.has(task.taskKind);
  assert(
    authorProfile || reviewProfile,
    "TASK_CONTRACT_INVALID",
    "Task kind and provider role do not select a release-owned proposal profile.",
  );
  assert(
    task.proposalProfileId ===
      (authorProfile ? AUTHOR_PROPOSAL_PROFILE : REVIEW_PROPOSAL_PROFILE) &&
      task.proposalInstructions ===
        (authorProfile ? AUTHOR_PROPOSAL_INSTRUCTIONS : REVIEW_PROPOSAL_INSTRUCTIONS),
    "TASK_CONTRACT_INVALID",
    "Proposal profile is not the exact release-owned task profile.",
  );
  assert(
    authorProfile
      ? task.expectedAuthorProposalDigest === undefined
      : typeof task.expectedAuthorProposalDigest === "string" &&
          DIGEST.test(task.expectedAuthorProposalDigest),
    "TASK_CONTRACT_INVALID",
    "Expected author proposal binding is invalid.",
  );
  assert(boundedString(task.target.snapshotId), "TASK_CONTRACT_INVALID", "Snapshot ID is missing.");
  assert(
    /^[a-f0-9]{40,64}$/u.test(task.target.commitSha),
    "TASK_CONTRACT_INVALID",
    "Commit SHA must be immutable.",
  );
  assert(
    DIGEST.test(task.target.manifestDigest),
    "TASK_CONTRACT_INVALID",
    "Manifest digest is invalid.",
  );
  assert(
    boundedString(task.evidenceView.viewId),
    "TASK_CONTRACT_INVALID",
    "Evidence-view ID is invalid.",
  );
  assert(
    DIGEST.test(task.evidenceView.digest),
    "TASK_CONTRACT_INVALID",
    "Evidence-view digest is invalid.",
  );
  assert(
    Array.isArray(task.evidenceView.allowedEvidenceIds) &&
      task.evidenceView.allowedEvidenceIds.every((value) => boundedString(value)),
    "TASK_CONTRACT_INVALID",
    "Evidence allowlist is invalid.",
  );
  assert(
    DIGEST.test(task.instructionBundleDigest) &&
      task.instructionBundleDigest === expectedInstructionBundleDigest(task),
    "TASK_CONTRACT_INVALID",
    "Instruction digest does not bind the release-owned proposal profile.",
  );
  assert(
    new Set(task.evidenceView.allowedEvidenceIds).size ===
      task.evidenceView.allowedEvidenceIds.length,
    "TASK_CONTRACT_INVALID",
    "Evidence allowlist contains duplicates.",
  );
  assert(
    Array.isArray(task.allowedCommands) && task.allowedCommands.length > 0,
    "TASK_CONTRACT_INVALID",
    "Task has no allowed commands.",
  );
  assert(
    task.allowedCommands.every((command) => COMMANDS.has(command)),
    "TASK_CONTRACT_INVALID",
    "Task requests an unknown command.",
  );
  assert(
    new Set(task.allowedCommands).size === task.allowedCommands.length,
    "TASK_CONTRACT_INVALID",
    "Task commands contain duplicates.",
  );
  assert(
    task.allowedCommands.includes("submit-proposal") ||
      task.allowedCommands.includes("report-limitation"),
    "TASK_CONTRACT_INVALID",
    "Task cannot produce a bounded result.",
  );
  assert(
    Number.isInteger(task.budget.wallSeconds) &&
      task.budget.wallSeconds > 0 &&
      task.budget.wallSeconds <= 7200,
    "TASK_CONTRACT_INVALID",
    "Wall budget is outside release limits.",
  );
  assert(
    Number.isInteger(task.budget.outputBytes) &&
      task.budget.outputBytes > 0 &&
      task.budget.outputBytes <= 10_485_760,
    "TASK_CONTRACT_INVALID",
    "Output budget is outside release limits.",
  );
  assert(
    boundedString(task.deadlineAt) && Number.isFinite(Date.parse(task.deadlineAt)),
    "TASK_CONTRACT_INVALID",
    "Task deadline is invalid.",
  );
  assert(
    boundedString(task.requiredOutputSchemaId) &&
      (registeredOutputSchemaIds as readonly string[]).includes(task.requiredOutputSchemaId),
    "TASK_CONTRACT_INVALID",
    "Required output schema is not release-owned.",
  );
  assert(
    Array.isArray(task.acceptanceChecks) &&
      task.acceptanceChecks.length > 0 &&
      task.acceptanceChecks.every((value) => boundedString(value)),
    "TASK_CONTRACT_INVALID",
    "Task has no acceptance checks.",
  );
  assert(
    new Set(task.acceptanceChecks).size === task.acceptanceChecks.length,
    "TASK_CONTRACT_INVALID",
    "Task acceptance checks contain duplicates.",
  );
  for (const checkId of task.acceptanceChecks) {
    assert(
      (registeredAcceptanceCheckIds as readonly string[]).includes(checkId) && checks.has(checkId),
      "TASK_CONTRACT_INVALID",
      `Acceptance check ${checkId} is not release-owned.`,
    );
  }
}

export function validateTaskCapsule(
  capsule: AgentTaskCapsule,
  checks: AcceptanceCheckCatalog,
): void {
  assert(isRecord(capsule), "TASK_CONTRACT_INVALID", "Task capsule must be an object.");
  assert(
    hasExactKeys(capsule, ["schemaVersion", "task", "runContext", "evidence", "authorityOrder"]),
    "TASK_CONTRACT_INVALID",
    "Task capsule has missing or unknown fields.",
  );
  validateAgentTask(capsule.task, checks);
  assert(capsule.schemaVersion === "1.0.0", "TASK_CONTRACT_INVALID", "Unsupported capsule schema.");
  assert(isRecord(capsule.runContext), "TASK_CONTRACT_INVALID", "Run context must be an object.");
  for (const [key, value] of Object.entries(capsule.runContext)) {
    assert(boundedString(key), "TASK_CONTRACT_INVALID", "Run-context key is invalid.");
    assert(
      value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)),
      "TASK_CONTRACT_INVALID",
      "Run context contains a non-scalar value.",
    );
  }
  const expectedAuthority = [
    "release-safety-policy",
    "typed-task-context",
    "release-task-instructions",
    "untrusted-evidence",
    "provider-proposal",
  ];
  assert(
    Array.isArray(capsule.authorityOrder) &&
      capsule.authorityOrder.length === expectedAuthority.length &&
      capsule.authorityOrder.every((value, index) => value === expectedAuthority[index]),
    "TASK_CONTRACT_INVALID",
    "Task authority order is not frozen.",
  );
  assert(Array.isArray(capsule.evidence), "TASK_CONTRACT_INVALID", "Evidence must be an array.");
  const allowedEvidence = new Set(capsule.task.evidenceView.allowedEvidenceIds);
  const seen = new Set<string>();
  for (const evidence of capsule.evidence) {
    assert(isRecord(evidence), "TASK_CONTRACT_INVALID", "Evidence record must be an object.");
    assert(
      hasExactKeys(evidence, [
        "evidenceId",
        "sourceLocator",
        "mediaType",
        "sensitivity",
        "truncated",
        "byteLength",
        "escapedPayload",
      ]),
      "TASK_CONTRACT_INVALID",
      "Evidence record has missing or unknown fields.",
    );
    assert(boundedString(evidence.evidenceId), "TASK_CONTRACT_INVALID", "Evidence ID is invalid.");
    assert(
      allowedEvidence.has(evidence.evidenceId),
      "TASK_CONTRACT_INVALID",
      "Capsule contains non-allowlisted evidence.",
    );
    assert(
      !seen.has(evidence.evidenceId),
      "TASK_CONTRACT_INVALID",
      "Capsule contains duplicate evidence.",
    );
    seen.add(evidence.evidenceId);
    assert(
      Number.isInteger(evidence.byteLength) &&
        evidence.byteLength >= 0 &&
        evidence.byteLength <= capsule.task.budget.outputBytes,
      "TASK_CONTRACT_INVALID",
      "Evidence record exceeds the task budget.",
    );
    assert(
      boundedString(evidence.sourceLocator) &&
        !evidence.sourceLocator.startsWith("/") &&
        !evidence.sourceLocator.includes(".."),
      "TASK_CONTRACT_INVALID",
      "Evidence locator exposes a path.",
    );
    assert(
      evidence.mediaType === "text/plain" || evidence.mediaType === "application/json",
      "TASK_CONTRACT_INVALID",
      "Evidence media type is invalid.",
    );
    assert(
      evidence.sensitivity === "public" || evidence.sensitivity === "internal",
      "TASK_CONTRACT_INVALID",
      "Evidence sensitivity is invalid.",
    );
    assert(
      typeof evidence.truncated === "boolean",
      "TASK_CONTRACT_INVALID",
      "Evidence truncation flag is invalid.",
    );
    assert(
      typeof evidence.escapedPayload === "string",
      "TASK_CONTRACT_INVALID",
      "Evidence payload is invalid.",
    );
    assert(
      !evidence.escapedPayload.includes(String.fromCharCode(0)),
      "TASK_CONTRACT_INVALID",
      "Evidence payload contains a forbidden delimiter.",
    );
  }
}

export function deniedCapabilityReasons(
  requested: RequestedProviderCapabilities,
  provider: "codex" | "claude-code",
): string[] {
  const reasons: string[] = [];
  if (!isRecord(requested)) return ["CAPABILITY_CONTRACT_INVALID"];
  const capabilityKeys = new Set([
    "permissionBypass",
    "sourceAccess",
    "sshAccess",
    "stateAccess",
    "kitAccess",
    "generatedTreeAccess",
    "runtimeAccess",
    "helperAccess",
    "arbitraryNetwork",
    "outputAccess",
    "providerInference",
  ]);
  if (Object.keys(requested).some((key) => !capabilityKeys.has(key))) {
    reasons.push("UNKNOWN_CAPABILITY_DENIED");
  }
  const denied: Array<[keyof RequestedProviderCapabilities, string]> = [
    ["permissionBypass", "PERMISSION_BYPASS_DENIED"],
    ["sourceAccess", "SOURCE_ACCESS_DENIED"],
    ["sshAccess", "SSH_ACCESS_DENIED"],
    ["stateAccess", "STATE_ACCESS_DENIED"],
    ["kitAccess", "KIT_ACCESS_DENIED"],
    ["generatedTreeAccess", "GENERATED_TREE_ACCESS_DENIED"],
    ["runtimeAccess", "RUNTIME_ACCESS_DENIED"],
    ["helperAccess", "HELPER_ACCESS_DENIED"],
    ["arbitraryNetwork", "ARBITRARY_NETWORK_DENIED"],
  ];
  for (const [field, reason] of denied) {
    if (requested[field] === true) reasons.push(reason);
    else if (requested[field] !== undefined && requested[field] !== false)
      reasons.push("CAPABILITY_VALUE_INVALID");
  }
  if (requested.outputAccess !== "proposal-outbox") reasons.push("OUTPUT_ACCESS_DENIED");
  if (
    !isRecord(requested.providerInference) ||
    !hasExactKeys(requested.providerInference, ["attested", "destination"]) ||
    requested.providerInference.attested !== true
  )
    reasons.push("PROVIDER_NETWORK_UNATTESTED");
  if (
    isRecord(requested.providerInference) &&
    typeof requested.providerInference["attested"] !== "boolean"
  )
    reasons.push("CAPABILITY_VALUE_INVALID");
  if (
    !isRecord(requested.providerInference) ||
    requested.providerInference["destination"] !== provider
  )
    reasons.push("PROVIDER_DESTINATION_MISMATCH");
  return [...new Set(reasons)];
}

export function validateAgentProposal(
  proposal: unknown,
  task: AgentTask,
  checks: AcceptanceCheckCatalog,
): string[] {
  if (proposal === null || typeof proposal !== "object" || Array.isArray(proposal))
    return ["proposal must be an object"];
  const object = proposal as Record<string, unknown>;
  const allowedKeys = new Set([
    "schemaVersion",
    "schemaId",
    "taskId",
    "runId",
    "attemptId",
    "fenceToken",
    "evidenceOccurrenceIds",
    "limitationIds",
    "content",
  ]);
  const errors: string[] = [];
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) errors.push(`unknown proposal field: ${key}`);
  }
  if (object["schemaVersion"] !== "1.0.0") errors.push("schemaVersion mismatch");
  if (object["schemaId"] !== task.requiredOutputSchemaId)
    errors.push("required output schema mismatch");
  for (const field of ["taskId", "runId", "attemptId", "fenceToken"] as const) {
    if (object[field] !== task[field]) errors.push(`${field} mismatch`);
  }
  if (!Array.isArray(object["evidenceOccurrenceIds"])) {
    errors.push("evidenceOccurrenceIds must be an array");
  } else {
    const allowedEvidence = new Set(task.evidenceView.allowedEvidenceIds);
    if (
      object["evidenceOccurrenceIds"].length > 10_000 ||
      new Set(object["evidenceOccurrenceIds"]).size !== object["evidenceOccurrenceIds"].length
    ) {
      errors.push("evidenceOccurrenceIds must be unique and bounded");
    }
    for (const evidenceId of object["evidenceOccurrenceIds"]) {
      if (typeof evidenceId !== "string" || !allowedEvidence.has(evidenceId))
        errors.push("proposal cites unavailable evidence");
    }
  }
  if (
    !Array.isArray(object["limitationIds"]) ||
    object["limitationIds"].some((item) => typeof item !== "string" || !ID.test(item)) ||
    new Set(object["limitationIds"]).size !== object["limitationIds"].length
  ) {
    errors.push("limitationIds must be a unique bounded ID array");
  }
  if (
    object["content"] === null ||
    typeof object["content"] !== "object" ||
    Array.isArray(object["content"])
  ) {
    errors.push("content must be an object");
  } else {
    const content = object["content"] as Record<string, unknown>;
    const cited = new Set(
      Array.isArray(object["evidenceOccurrenceIds"])
        ? object["evidenceOccurrenceIds"].filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
    const allowed = new Set(task.evidenceView.allowedEvidenceIds);
    const validEvidenceIds = (
      value: unknown,
      label: string,
      minimum: number,
    ): value is string[] => {
      if (
        !Array.isArray(value) ||
        value.length < minimum ||
        value.length > 64 ||
        value.some((id) => typeof id !== "string" || !ID.test(id)) ||
        new Set(value).size !== value.length
      ) {
        errors.push(`${label} is invalid`);
        return false;
      }
      if (value.some((id) => !cited.has(id) || !allowed.has(id))) {
        errors.push(`${label} cites unavailable evidence`);
        return false;
      }
      return true;
    };
    if (task.providerRole === "author") {
      if (!hasExactKeys(content, ["claims", "limitations"])) {
        errors.push("author proposal content has missing or unknown fields");
      }
      const claims = content["claims"];
      const limitations = content["limitations"];
      if (!Array.isArray(claims) || claims.length === 0 || claims.length > 256) {
        errors.push("author proposal claims are invalid");
      } else {
        const claimIds = new Set<string>();
        for (const [index, claim] of claims.entries()) {
          if (
            !isRecord(claim) ||
            !hasExactKeys(claim, [
              "claimId",
              "controlId",
              "result",
              "evidenceOccurrenceIds",
              "summary",
            ])
          ) {
            errors.push(`claim ${index} has missing or unknown fields`);
            continue;
          }
          if (
            typeof claim["claimId"] !== "string" ||
            !ID.test(claim["claimId"]) ||
            claimIds.has(claim["claimId"])
          ) {
            errors.push(`claim ${index} ID is invalid`);
          } else {
            claimIds.add(claim["claimId"]);
          }
          if (typeof claim["controlId"] !== "string" || !CONTROL_ID.test(claim["controlId"])) {
            errors.push(`claim ${index} control ID is invalid`);
          }
          if (typeof claim["result"] !== "string" || !RESULTS.has(claim["result"])) {
            errors.push(`claim ${index} result is invalid`);
          }
          validEvidenceIds(claim["evidenceOccurrenceIds"], `claim ${index} evidence`, 1);
          if (
            typeof claim["summary"] !== "string" ||
            claim["summary"].length === 0 ||
            Buffer.byteLength(claim["summary"], "utf8") > 2048 ||
            PROHIBITED_CONTENT.test(claim["summary"]) ||
            [...claim["summary"]].some((character) => {
              const code = character.codePointAt(0);
              return code !== undefined && (code < 32 || code === 127);
            })
          ) {
            errors.push(`claim ${index} summary contains unsafe or invalid text`);
          }
        }
      }
      const contentLimitationIds = new Set<string>();
      if (!Array.isArray(limitations) || limitations.length > 256) {
        errors.push("author proposal limitations are invalid");
      } else {
        for (const [index, limitation] of limitations.entries()) {
          if (
            !isRecord(limitation) ||
            !hasExactKeys(limitation, ["limitationId", "code", "evidenceOccurrenceIds"])
          ) {
            errors.push(`limitation ${index} has missing or unknown fields`);
            continue;
          }
          if (
            typeof limitation["limitationId"] !== "string" ||
            !ID.test(limitation["limitationId"]) ||
            contentLimitationIds.has(limitation["limitationId"])
          ) {
            errors.push(`limitation ${index} ID is invalid`);
          } else {
            contentLimitationIds.add(limitation["limitationId"]);
          }
          if (typeof limitation["code"] !== "string" || !LIMITATION_CODE.test(limitation["code"])) {
            errors.push(`limitation ${index} code is invalid`);
          }
          validEvidenceIds(limitation["evidenceOccurrenceIds"], `limitation ${index} evidence`, 0);
        }
      }
      if (
        Array.isArray(object["limitationIds"]) &&
        (object["limitationIds"].length !== contentLimitationIds.size ||
          object["limitationIds"].some(
            (limitationId) =>
              typeof limitationId !== "string" || !contentLimitationIds.has(limitationId),
          ))
      ) {
        errors.push("proposal limitation IDs do not bind author limitations");
      }
    } else {
      if (
        !hasExactKeys(content, [
          "authorProposalDigest",
          "verdict",
          "objectionCodes",
          "evidenceOccurrenceIds",
        ])
      ) {
        errors.push("review proposal content has missing or unknown fields");
      }
      if (
        content["authorProposalDigest"] !== task.expectedAuthorProposalDigest ||
        typeof content["authorProposalDigest"] !== "string" ||
        !DIGEST.test(content["authorProposalDigest"])
      ) {
        errors.push("review proposal does not bind the expected author proposal");
      }
      const verdict = content["verdict"];
      if (typeof verdict !== "string" || !VERDICTS.has(verdict)) {
        errors.push("review verdict is invalid");
      }
      const objections = content["objectionCodes"];
      if (
        !Array.isArray(objections) ||
        objections.length > 64 ||
        objections.some((code) => typeof code !== "string" || !ID.test(code)) ||
        new Set(objections).size !== objections.length
      ) {
        errors.push("review objection codes are invalid");
      } else if (
        (verdict === "passed" && objections.length !== 0) ||
        (verdict !== "passed" && objections.length === 0)
      ) {
        errors.push("review verdict and objections are inconsistent");
      }
      validEvidenceIds(content["evidenceOccurrenceIds"], "review evidence", 1);
      if (Array.isArray(object["limitationIds"]) && object["limitationIds"].length !== 0) {
        errors.push("review proposal cannot declare unstructured limitations");
      }
    }
  }
  for (const checkId of task.acceptanceChecks) {
    const check = checks.get(checkId);
    if (check !== undefined) errors.push(...check(object, task));
  }
  return errors;
}

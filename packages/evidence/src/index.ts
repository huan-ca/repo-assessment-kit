export const admittedEvidenceRoot = "objects/sha256" as const;
import { createHash } from "node:crypto";

export type Digest = `sha256:${string}`;
export type EvidenceSensitivity =
  | "public"
  | "customer-confidential"
  | "secret-suspected"
  | "restricted";

export interface EvidenceBlob {
  schemaVersion: "1.0.0";
  blobId: string;
  runId: string;
  sha256: Digest;
  byteLength: string;
  mediaType: string;
  storageRelPath: string;
  storageState: "QUARANTINED" | "ADMITTED" | "REDACTED" | "DELETED";
  createdAt: string;
}

export interface EvidenceOccurrence {
  schemaVersion: "1.0.0";
  evidenceId: string;
  runId: string;
  blobId: string;
  evidenceType: string;
  title: string;
  snapshotId: string;
  activityId: string;
  capturedAt: string;
  sourceLocator?: {
    repoRelPath: string;
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
  };
  packageRelPath?: string;
  externalLocator?: string;
  sensitivity: EvidenceSensitivity;
  redactionState: "none-required" | "pending" | "redacted" | "excluded";
  validationState: "unreviewed" | "validated" | "disputed" | "invalidated";
  collectionLimitations: string[];
  derivedFromEvidenceIds: string[];
  linkedClaimIds: string[];
  linkedFindingIds: string[];
  linkedControlIds: string[];
  supersedesEvidenceId?: string;
}

export interface RedactionMatch {
  kind: "secret" | "host-path";
  ruleId: string;
  start: number;
  end: number;
}

export interface SanitizedEvidence {
  text: string;
  matches: RedactionMatch[];
  sensitivity: EvidenceSensitivity;
  redactionState: "none-required" | "redacted";
}

export interface AdmitTextEvidenceInput {
  runId: string;
  snapshotId: string;
  activityId: string;
  repoRelPath: string;
  evidenceType: string;
  title: string;
  text: string;
  capturedAt: string;
  mediaType?: string;
  startLine?: number;
  endLine?: number;
  occurrenceKey?: string;
  collectionLimitations?: string[];
}

export interface AdmittedTextEvidence {
  blob: EvidenceBlob;
  occurrence: EvidenceOccurrence;
  safeText: string;
  redactions: RedactionMatch[];
}

const SECRET_RULES: ReadonlyArray<{ id: string; expression: RegExp }> = [
  {
    id: "private-key",
    expression:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu,
  },
  { id: "aws-access-key", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu },
  {
    id: "github-token",
    expression: /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/gu,
  },
  { id: "slack-token", expression: /\bxox[baprs]-[A-Za-z0-9-]{10,200}\b/gu },
  {
    id: "credential-assignment",
    expression:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*[:=]\s*["']?[^\s"',;]{6,}["']?/giu,
  },
  {
    id: "url-credential",
    expression: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@[^/\s]+/giu,
  },
];

const HOST_PATH_RULES: ReadonlyArray<{ id: string; expression: RegExp }> = [
  {
    id: "posix-user-path",
    expression:
      /(?:\/Users|\/home|\/workspace|\/root|\/tmp|\/private\/tmp|\/var\/tmp)\/[^\s"'<>]+/gu,
  },
  {
    id: "windows-user-path",
    expression: /\b[A-Za-z]:\\Users\\[^\s"'<>]+/gu,
  },
];

function hash(value: string | Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function contractId(prefix: string, key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function normalizeRepositoryPath(candidate: string): string {
  const hasControlCharacter = [...candidate].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    candidate.length === 0 ||
    candidate.startsWith("/") ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.includes("\\") ||
    hasControlCharacter
  ) {
    throw new Error("Evidence paths must be non-empty repository-relative POSIX paths");
  }
  const parts = candidate.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("Evidence paths cannot contain empty, dot, or parent segments");
  }
  return parts.join("/");
}

export function containsAbsoluteHostPath(value: unknown): boolean {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized === undefined) return false;
  return HOST_PATH_RULES.some(({ expression }) => {
    expression.lastIndex = 0;
    return expression.test(serialized);
  });
}

export function sanitizeEvidenceText(input: string): SanitizedEvidence {
  const matches: RedactionMatch[] = [];
  for (const { id, expression } of SECRET_RULES) {
    expression.lastIndex = 0;
    for (const match of input.matchAll(expression)) {
      if (match.index === undefined) continue;
      matches.push({
        kind: "secret",
        ruleId: id,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  for (const { id, expression } of HOST_PATH_RULES) {
    expression.lastIndex = 0;
    for (const match of input.matchAll(expression)) {
      if (match.index === undefined) continue;
      matches.push({
        kind: "host-path",
        ruleId: id,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  const ordered: RedactionMatch[] = [];
  for (const match of matches.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )) {
    const previous = ordered.at(-1);
    if (previous === undefined || match.start >= previous.end) ordered.push(match);
  }
  let cursor = 0;
  let text = "";
  for (const match of ordered) {
    text += input.slice(cursor, match.start);
    text += match.kind === "secret" ? "[REDACTED SECRET]" : "[REDACTED HOST PATH]";
    cursor = match.end;
  }
  text += input.slice(cursor);

  return {
    text,
    matches: ordered,
    sensitivity: ordered.some((match) => match.kind === "secret")
      ? "secret-suspected"
      : "customer-confidential",
    redactionState: ordered.length === 0 ? "none-required" : "redacted",
  };
}

export function admitTextEvidence(input: AdmitTextEvidenceInput): AdmittedTextEvidence {
  const repoRelPath = normalizeRepositoryPath(input.repoRelPath);
  const sanitized = sanitizeEvidenceText(input.text);
  const digest = hash(sanitized.text);
  const blobKey = `${input.runId}\0${digest}`;
  const blobId = contractId("blb", blobKey);
  const occurrenceKey =
    input.occurrenceKey ??
    [
      input.runId,
      input.snapshotId,
      input.activityId,
      repoRelPath,
      String(input.startLine ?? ""),
      input.evidenceType,
      digest,
    ].join("\0");
  const evidenceId = contractId("evd", occurrenceKey);
  const storageRelPath = `objects/sha256/${digest.slice(7, 9)}/${digest.slice(7)}`;
  const blob: EvidenceBlob = {
    schemaVersion: "1.0.0",
    blobId,
    runId: input.runId,
    sha256: digest,
    byteLength: Buffer.byteLength(sanitized.text).toString(),
    mediaType: input.mediaType ?? "text/plain; charset=utf-8",
    storageRelPath,
    storageState: sanitized.redactionState === "redacted" ? "REDACTED" : "ADMITTED",
    createdAt: input.capturedAt,
  };
  const sourceLocator: NonNullable<EvidenceOccurrence["sourceLocator"]> = {
    repoRelPath,
  };
  if (input.startLine !== undefined) sourceLocator.startLine = input.startLine;
  if (input.endLine !== undefined) sourceLocator.endLine = input.endLine;
  const occurrence: EvidenceOccurrence = {
    schemaVersion: "1.0.0",
    evidenceId,
    runId: input.runId,
    blobId,
    evidenceType: input.evidenceType,
    title: sanitizeEvidenceText(input.title).text,
    snapshotId: input.snapshotId,
    activityId: input.activityId,
    capturedAt: input.capturedAt,
    sourceLocator,
    packageRelPath: `evidence/${evidenceId}.txt`,
    sensitivity: sanitized.sensitivity,
    redactionState: sanitized.redactionState,
    validationState: "unreviewed",
    collectionLimitations: [...(input.collectionLimitations ?? [])],
    derivedFromEvidenceIds: [],
    linkedClaimIds: [],
    linkedFindingIds: [],
    linkedControlIds: [],
  };
  assertSafePublicEvidence({ blob, occurrence, safeText: sanitized.text });
  return { blob, occurrence, safeText: sanitized.text, redactions: sanitized.matches };
}

export function assertSafePublicEvidence(value: unknown): void {
  if (containsAbsoluteHostPath(value)) {
    throw new Error("Evidence output contains an absolute host path");
  }
  const serialized = JSON.stringify(value);
  for (const { expression } of SECRET_RULES) {
    expression.lastIndex = 0;
    if (expression.test(serialized)) {
      throw new Error("Evidence output contains secret material");
    }
  }
}

export function deduplicateBlobs(admitted: readonly AdmittedTextEvidence[]): EvidenceBlob[] {
  const byDigest = new Map<string, EvidenceBlob>();
  for (const item of admitted) {
    const key = `${item.blob.runId}\0${item.blob.sha256}`;
    const existing = byDigest.get(key);
    if (existing === undefined) byDigest.set(key, item.blob);
  }
  return [...byDigest.values()].sort((left, right) => left.sha256.localeCompare(right.sha256));
}

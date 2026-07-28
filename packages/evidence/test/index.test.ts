import { describe, expect, it } from "vitest";

import {
  admitTextEvidence,
  assertSafePublicEvidence,
  containsAbsoluteHostPath,
  deduplicateBlobs,
  normalizeRepositoryPath,
  sanitizeEvidenceText,
} from "../src/index.js";

const context = {
  runId: "run_01900000-0000-7000-a000-000000000001",
  snapshotId: "snp_01900000-0000-7000-a000-000000000001",
  activityId: "act_01900000-0000-7000-a000-000000000001",
  repoRelPath: "config/example.env",
  evidenceType: "fixture",
  title: "Fixture evidence",
  capturedAt: "2026-07-28T00:00:00.000Z",
};

describe("evidence admission", () => {
  it("separates per-run content blobs from occurrences", () => {
    const first = admitTextEvidence({ ...context, text: "safe=true\n", occurrenceKey: "first" });
    const second = admitTextEvidence({
      ...context,
      text: "safe=true\n",
      occurrenceKey: "second",
      startLine: 2,
    });

    expect(first.blob.sha256).toBe(second.blob.sha256);
    expect(first.blob.blobId).toBe(second.blob.blobId);
    expect(first.occurrence.evidenceId).not.toBe(second.occurrence.evidenceId);
    expect(deduplicateBlobs([first, second])).toHaveLength(1);
  });

  it("redacts secret values and host paths before hashing or retention", () => {
    const awsKey = `AKIA${"A".repeat(16)}`;
    const source = `password=not-a-real-password\nkey=${awsKey}\ntrace=/home/alice/project/src.ts\ntemporary=/tmp/customer/private/token.txt\n`;
    const admitted = admitTextEvidence({ ...context, text: source });
    const serialized = JSON.stringify(admitted);

    expect(serialized).not.toContain("not-a-real-password");
    expect(serialized).not.toContain(awsKey);
    expect(serialized).not.toContain("/home/alice");
    expect(serialized).not.toContain("/tmp/customer");
    expect(admitted.safeText).toContain("[REDACTED SECRET]");
    expect(admitted.safeText).toContain("[REDACTED HOST PATH]");
    expect(admitted.occurrence.redactionState).toBe("redacted");
    expect(admitted.occurrence.sensitivity).toBe("secret-suspected");
    expect(() => assertSafePublicEvidence(admitted)).not.toThrow();
  });

  it("recognizes common sensitive forms without returning their values", () => {
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "ZmFrZS10ZXN0LWtleQ==",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const result = sanitizeEvidenceText(privateKey);

    expect(result.text).toBe("[REDACTED SECRET]");
    expect(result.matches).toEqual([
      expect.objectContaining({ kind: "secret", ruleId: "private-key" }),
    ]);
  });

  it("rejects absolute, parent, Windows, and ambiguous evidence paths", () => {
    for (const candidate of ["/tmp/a", "../a", "a/../b", "C:\\Users\\alice\\a", "a//b", "./a"]) {
      expect(() => normalizeRepositoryPath(candidate)).toThrow();
    }
    expect(normalizeRepositoryPath("src/a.ts")).toBe("src/a.ts");
    expect(containsAbsoluteHostPath({ trace: "/workspace/customer/repo" })).toBe(true);
    expect(containsAbsoluteHostPath({ trace: "/tmp/customer/repo" })).toBe(true);
  });
});

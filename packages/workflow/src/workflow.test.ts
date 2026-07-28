import { describe, expect, it } from "vitest";
import type { RunState } from "@rak/contracts";
import {
  canTransitionPhase,
  canTransitionRun,
  createDraftRun,
  transitionRun,
  WorkflowConflict,
} from "./index.js";

describe("run lifecycle", () => {
  it("implements every legal DRAFT and terminal boundary", () => {
    expect(canTransitionRun("DRAFT", "RESOLVING_TARGET")).toBe(true);
    expect(canTransitionRun("DRAFT", "EXECUTING")).toBe(false);
    for (const terminal of ["COMPLETED", "CANCELLED", "FAILED"] satisfies RunState[]) {
      expect(canTransitionRun(terminal, "EXECUTING")).toBe(false);
    }
  });

  it("increments rowVersion and rejects illegal transitions", () => {
    const run = createDraftRun({
      runId: "run_1",
      projectSlug: "fixture",
      provider: "codex",
      now: "2026-07-28T00:00:00.000Z",
    });
    expect(transitionRun(run, "RESOLVING_TARGET", "2026-07-28T00:00:01.000Z")).toMatchObject({
      state: "RESOLVING_TARGET",
      rowVersion: 1,
    });
    expect(() => transitionRun(run, "EXECUTING", "2026-07-28T00:00:01.000Z")).toThrow(
      WorkflowConflict,
    );
  });

  it("covers legal and terminal phase edges", () => {
    expect(canTransitionPhase("PENDING", "READY")).toBe(true);
    expect(canTransitionPhase("READY", "RUNNING")).toBe(true);
    expect(canTransitionPhase("READY", "SKIPPED")).toBe(true);
    expect(canTransitionPhase("RUNNING", "WAITING_INPUT")).toBe(true);
    expect(canTransitionPhase("RUNNING", "RETRYABLE_FAILURE")).toBe(true);
    expect(canTransitionPhase("RETRYABLE_FAILURE", "READY")).toBe(true);
    for (const terminal of ["SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"] as const) {
      expect(canTransitionPhase(terminal, "READY")).toBe(false);
      expect(canTransitionPhase(terminal, "RUNNING")).toBe(false);
    }
  });
});

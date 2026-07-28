import {
  assessmentDomains,
  phaseKeys,
  type AssessmentDomain,
  type CoverageStatus,
  type DomainCoverage,
  type LauncherProvider,
  type PhaseDocument,
  type PhaseState,
  type RunDocument,
  type RunState,
} from "@rak/contracts";

export type { LauncherProvider } from "@rak/contracts";

const transitions: Readonly<Record<RunState, readonly RunState[]>> = Object.freeze({
  DRAFT: ["RESOLVING_TARGET"],
  RESOLVING_TARGET: ["READY", "RECOVERABLE_FAILURE", "CANCELLING"],
  READY: ["EXECUTING", "CANCELLING"],
  EXECUTING: [
    "WAITING_INPUT",
    "PAUSING",
    "VALIDATING",
    "RECOVERABLE_FAILURE",
    "FAILED",
    "CANCELLING",
  ],
  WAITING_INPUT: ["EXECUTING", "PAUSING", "FAILED", "CANCELLING"],
  PAUSING: ["PAUSED", "RECOVERABLE_FAILURE", "CANCELLING"],
  PAUSED: ["EXECUTING", "CANCELLING"],
  RECOVERABLE_FAILURE: ["READY", "EXECUTING", "FAILED", "CANCELLING"],
  VALIDATING: ["REVIEW_REQUIRED", "RECOVERABLE_FAILURE", "FAILED", "CANCELLING"],
  REVIEW_REQUIRED: ["PACKAGING", "EXECUTING", "FAILED", "CANCELLING"],
  PACKAGING: ["COMPLETED", "RECOVERABLE_FAILURE", "FAILED", "CANCELLING"],
  CANCELLING: ["CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
});

const phaseTransitions: Readonly<Record<PhaseState, readonly PhaseState[]>> = Object.freeze({
  PENDING: ["READY"],
  READY: ["RUNNING", "SKIPPED", "CANCELLED"],
  RUNNING: ["WAITING_INPUT", "RETRYABLE_FAILURE", "SUCCEEDED", "FAILED", "CANCELLED"],
  WAITING_INPUT: ["RUNNING", "CANCELLED"],
  RETRYABLE_FAILURE: ["READY", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  SKIPPED: [],
  CANCELLED: [],
});

export class WorkflowConflict extends Error {
  readonly code = "RUN_STATE_CONFLICT";
}

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return transitions[from].includes(to);
}

export function transitionRun(run: RunDocument, to: RunState, now: string): RunDocument {
  if (!canTransitionRun(run.state, to)) {
    throw new WorkflowConflict(`Run cannot transition from ${run.state} to ${to}`);
  }
  const terminal = to === "COMPLETED" || to === "CANCELLED" || to === "FAILED";
  return {
    ...run,
    state: to,
    rowVersion: run.rowVersion + 1,
    updatedAt: now,
    ...(terminal ? { terminalAt: now } : {}),
  };
}

export function canTransitionPhase(from: PhaseState, to: PhaseState): boolean {
  return phaseTransitions[from].includes(to);
}

export function transitionPhase(
  phase: PhaseDocument,
  to: PhaseState,
  conditional: boolean,
): PhaseDocument {
  if (!canTransitionPhase(phase.state, to) || (to === "SKIPPED" && !conditional)) {
    throw new WorkflowConflict(`Phase cannot transition from ${phase.state} to ${to}`);
  }
  return { ...phase, state: to };
}

export function createPhases(runId: string, nextId: () => string): PhaseDocument[] {
  return phaseKeys.map((phaseKey, index) => ({
    schemaVersion: "1.0.0",
    phaseId: `phs_${nextId()}`,
    runId,
    phaseKey,
    phaseRevision: 1,
    state: index === 0 ? "READY" : "PENDING",
    required: phaseKey !== "dynamic-assessment",
    dependsOn: index === 0 ? [] : [phaseKeys[index - 1] as string],
    limitationIds: [],
  }));
}

export function createBlockedCoverage(
  runId: string,
  nextId: () => string,
  checkedDomains: readonly AssessmentDomain[] = assessmentDomains,
): DomainCoverage[] {
  const emptyCounts: Record<CoverageStatus, number> = {
    pass: 0,
    fail: 0,
    partial: 0,
    blocked: 0,
    "not applicable": 0,
    "not tested": 0,
  };
  return checkedDomains.map((domainId) => ({
    schemaVersion: "1.0.0",
    coverageId: `cov_${nextId()}`,
    runId,
    domainId,
    status: "not tested",
    plannedControls: 0,
    reconciledControls: 0,
    counts: { ...emptyCounts },
    exclusions: [],
    unsupportedEcosystems: [],
    limitationIds: [],
    evidenceOccurrenceIds: [],
  }));
}

export interface ClockPort {
  now(): Date;
}
export interface IdentifierPort {
  next(): string;
}

export function createDraftRun(input: {
  runId: string;
  projectSlug: string;
  provider: LauncherProvider;
  now: string;
  parentRunId?: string;
  revision?: number;
}): RunDocument {
  return {
    schemaVersion: "1.0.0",
    runId: input.runId,
    ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
    projectSlug: input.projectSlug,
    revision: input.revision ?? 1,
    rowVersion: 0,
    state: "DRAFT",
    workflowProfile: "rak-workflow/1.0.0",
    exportProfile: "rak-export-profile/1.0.0",
    provider: input.provider,
    createdAt: input.now,
    updatedAt: input.now,
    limitationIds: [],
  };
}

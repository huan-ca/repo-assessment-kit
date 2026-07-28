import type { DynamicControl, RuntimeCapability, RuntimeCoverageResolution } from "./types.js";

const REQUIRED_CONTROLLERS = ["cpu", "memory", "pids", "io"] as const;

export type RuntimeCapabilityInput = {
  runtimeCapabilityId: string;
  runId: string;
  snapshotId: string;
  nativeArchitecture: "amd64" | "arm64";
  attestations?: RuntimeCapability["attestations"];
  candidates?: RuntimeCapability["candidates"];
  selectedCandidateId?: string;
  verifiedSnapshot: boolean;
  policyCompilable: boolean;
  plannedControls: Array<Pick<DynamicControl, "plannedControlId">>;
  browserRequired: boolean;
  browser: RuntimeCapability["browser"];
  passiveScan?: RuntimeCapability["passiveScan"];
  approvalIds?: string[];
  limitsProfileId: string;
};

export function evaluateRuntimeCapability(input: RuntimeCapabilityInput): RuntimeCapability {
  const reasons: RuntimeCapability["blockingReasons"] = [];
  const affectedControlIds = input.plannedControls.map((control) => control.plannedControlId);
  const block = (code: string, message: string, followUp: string): void => {
    reasons.push({ code, message, affectedControlIds, followUp });
  };

  if (input.plannedControls.length === 0) {
    return {
      schemaVersion: "1.0.0",
      runtimeCapabilityId: input.runtimeCapabilityId,
      runId: input.runId,
      snapshotId: input.snapshotId,
      state: "not applicable",
      nativeArchitecture: input.nativeArchitecture,
      candidates: input.candidates ?? [],
      policyChecks: [],
      browser: input.browser,
      passiveScan: input.passiveScan ?? { kind: "none", state: "not-applicable" },
      attemptedSafeSteps: ["runtime-applicability"],
      blockingReasons: [],
      approvalIds: input.approvalIds ?? [],
      limitsProfileId: input.limitsProfileId,
    };
  }

  if (input.attestations === undefined) {
    block(
      "RUNTIME_ATTESTATION_MISSING",
      "Trusted native runtime attestation is unavailable.",
      "Continue static-only or provision the trusted native broker.",
    );
  } else {
    if (!input.attestations.docker.rootless) {
      block(
        "ROOTLESS_DOCKER_REQUIRED",
        "The attested Docker engine is not rootless.",
        "Provision the pinned rootless guest.",
      );
    }
    if (input.attestations.cgroupVersion !== 2) {
      block(
        "CGROUP_V2_REQUIRED",
        "The runtime does not attest cgroup v2.",
        "Provision the pinned guest with cgroup v2.",
      );
    }
    for (const controller of REQUIRED_CONTROLLERS) {
      if (!input.attestations.delegatedControllers.includes(controller)) {
        block(
          "CGROUP_CONTROLLER_MISSING",
          `Required ${controller} delegation is missing.`,
          "Provision all release-required delegated controllers.",
        );
      }
    }
  }
  if (!input.verifiedSnapshot) {
    block(
      "SNAPSHOT_NOT_VERIFIED",
      "The immutable snapshot is not verified.",
      "Re-stage and verify the immutable snapshot.",
    );
  }
  if (!input.policyCompilable) {
    block(
      "RUNTIME_POLICY_REJECTED",
      "The target runtime cannot be compiled without relaxing policy.",
      "Continue static-only; controls are never relaxed.",
    );
  }
  if (input.browserRequired && input.browser.chromium !== "available") {
    block(
      "BROWSER_UNAVAILABLE",
      "The release browser is unavailable.",
      "Continue static-only or install the pinned compatible browser.",
    );
  }

  const capability: RuntimeCapability = {
    schemaVersion: "1.0.0",
    runtimeCapabilityId: input.runtimeCapabilityId,
    runId: input.runId,
    snapshotId: input.snapshotId,
    state: reasons.length === 0 ? "capable" : "blocked",
    nativeArchitecture: input.nativeArchitecture,
    candidates: input.candidates ?? [],
    policyChecks: [
      {
        checkId: "release-runtime-gate",
        outcome: reasons.length === 0 ? "accepted" : "rejected",
        reasonCodes: reasons.map((reason) => reason.code),
        evidenceOccurrenceIds: [],
      },
    ],
    browser: input.browser,
    passiveScan: input.passiveScan ?? { kind: "none", state: "unavailable" },
    attemptedSafeSteps: [
      "native-attestation",
      "snapshot-verification",
      "runtime-policy-compilation",
      ...(input.browserRequired ? ["browser-compatibility"] : []),
    ],
    blockingReasons: reasons,
    approvalIds: input.approvalIds ?? [],
    limitsProfileId: input.limitsProfileId,
  };
  if (input.attestations !== undefined) {
    capability.attestations = input.attestations;
  }
  if (input.selectedCandidateId !== undefined) {
    capability.selectedCandidateId = input.selectedCandidateId;
  }
  return capability;
}

export function resolveRuntimeCoverage(
  capability: RuntimeCapability,
  plannedControlIds: readonly string[],
): RuntimeCoverageResolution {
  if (capability.state === "capable") {
    return { staticAssessment: "continues", dynamicCoverage: "available", controlResults: [] };
  }
  const reason = capability.blockingReasons[0];
  const status = capability.state === "not applicable" ? "not applicable" : "blocked";
  return {
    staticAssessment: "continues",
    dynamicCoverage: capability.state,
    controlResults: plannedControlIds.map((plannedControlId) => ({
      plannedControlId,
      status,
      reasonCode: reason?.code ?? "RUNTIME_NOT_APPLICABLE",
      reason: reason?.message ?? "No dynamic control applies to this run.",
    })),
  };
}

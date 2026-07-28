export { canonicalize, sha256Digest } from "./canonical.js";
export { evaluateRuntimeCapability, resolveRuntimeCoverage } from "./capability.js";
export type { RuntimeCapabilityInput } from "./capability.js";
export {
  ControlPlanError,
  InMemoryControlPlanAdmissionJournal,
  admitSignedDynamicControlPlan,
  assertStrictControlPlanPayload,
  createSignedDynamicControlPlan,
  dispatchAdmittedControlPlan,
  reconcileControlPlanAdmission,
  revokeControlPlan,
  validateControlPlanAuthority,
  verifySignedDynamicControlPlan,
} from "./control-plan.js";
export type { VerifyControlPlanInput } from "./control-plan.js";
export { validateRuntimePolicy } from "./policy.js";
export type { RuntimePolicyResult } from "./policy.js";
export type * from "./types.js";

export const runtimeSecurityDefaults = Object.freeze({
  targetEgress: "denied",
  hostDockerSocket: "forbidden",
  sourceMount: "read-only",
  runtimeFallback: "static-only",
} as const);

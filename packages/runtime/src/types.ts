import type { KeyObject } from "node:crypto";

import type {
  Digest,
  DynamicControlPlanPayload,
  SignedDynamicControlPlan,
  Timestamp,
} from "@rak/contracts";

export type {
  Digest,
  DynamicControlPlanPayload,
  SignedDynamicControlPlan,
  Timestamp,
} from "@rak/contracts";

export type RuntimeBlockingReason = {
  code: string;
  message: string;
  affectedControlIds: string[];
  followUp: string;
};

export type RuntimeCapability = {
  schemaVersion: "1.0.0";
  runtimeCapabilityId: string;
  runId: string;
  snapshotId: string;
  state: "capable" | "blocked" | "not applicable";
  nativeArchitecture: "amd64" | "arm64";
  attestations?: {
    hostOs: "macos" | "linux";
    lima: { version: string; digest: Digest };
    guestImage: { version: string; digest: Digest };
    kernel: string;
    docker: { version: string; digest: Digest; rootless: true };
    compose: { version: string; digest: Digest };
    rootlessKit: { version: string; digest: Digest };
    cgroupVersion: 2;
    delegatedControllers: Array<"cpu" | "memory" | "pids" | "io">;
    firewallPolicyDigest: Digest;
    brokerEphemeralPublicKey: string;
  };
  candidates: Array<{
    candidateId: string;
    kind: "compose" | "dockerfile" | "other";
    relPaths: string[];
    requiredCapabilities: string[];
  }>;
  selectedCandidateId?: string;
  policyChecks: Array<{
    checkId: string;
    outcome: "accepted" | "rejected";
    reasonCodes: string[];
    evidenceOccurrenceIds: string[];
  }>;
  browser: { chromium: "available" | "blocked"; playwrightVersion?: string };
  passiveScan: { kind: "zap-baseline" | "rak-passive-http" | "none"; state: string };
  attemptedSafeSteps: string[];
  blockingReasons: RuntimeBlockingReason[];
  approvalIds: string[];
  limitsProfileId: string;
};

export type DynamicControl = DynamicControlPlanPayload["controls"][number];

export type ReleaseControl = Omit<DynamicControl, "budgets"> & {
  maximumBudgets: DynamicControl["budgets"];
};

export type ControlPlanAuthority = {
  runId: string;
  runtimeId: string;
  runtimeCreationNonce: string;
  attemptId: string;
  fenceToken: string;
  snapshotId: string;
  compiledPlanId: string;
  compiledPlanDigest: Digest;
  selectedProfileIds: string[];
  approvalIds: string[];
  authorityDigest: Digest;
  internalOrigins: DynamicControlPlanPayload["internalOrigins"];
  probeProfileId: string;
  releaseControls: ReadonlyMap<string, ReleaseControl>;
  now: Timestamp;
  expiresAtUpperBound: Timestamp;
};

export type TrustedControlPlanSigner = {
  available: boolean;
  signControlPlan(input: {
    domain: "rak-dynamic-control-plan/v1";
    canonicalPayload: Uint8Array;
    payloadDigest: Digest;
  }): Promise<{
    signatureAlgorithm: "Ed25519";
    signingKeyId: string;
    signature: string;
  }>;
};

export type VerificationKey = string | Buffer | KeyObject;

export type ControlPlanAdmission = {
  controlPlanId: string;
  payloadDigest: Digest;
  signatureDigest: Digest;
  canonicalPayloadBase64: string;
  signatureAlgorithm: "Ed25519";
  signingKeyId: string;
  signature: string;
  runId: string;
  runtimeId: string;
  runtimeCreationNonce: string;
  attemptId: string;
  fenceToken: string;
  snapshotId: string;
  compiledPlanId: string;
  compiledPlanDigest: Digest;
  selectedProfileIds: string[];
  approvalIds: string[];
  authorityDigest: Digest;
  probeProfileId: string;
  internalOrigins: DynamicControlPlanPayload["internalOrigins"];
  nonce: string;
  expiresAt: Timestamp;
  admittedAt: Timestamp;
  state: "admitted" | "revoked";
  revokedAt?: Timestamp;
  revocationReason?: string;
};

export interface ControlPlanAdmissionJournal {
  findByPlanId(controlPlanId: string): Promise<ControlPlanAdmission | undefined>;
  findByNonce(nonce: string): Promise<ControlPlanAdmission | undefined>;
  append(record: ControlPlanAdmission): Promise<void>;
  revoke(controlPlanId: string, at: Timestamp, reason: string): Promise<void>;
}

export type RuntimeCoverageResolution = {
  staticAssessment: "continues";
  dynamicCoverage: "available" | "blocked" | "not applicable";
  controlResults: Array<{
    plannedControlId: string;
    status: "blocked" | "not applicable";
    reasonCode: string;
    reason: string;
  }>;
};

export type RuntimeBroker = {
  available: boolean;
  probe(input: {
    signedControlPlan: SignedDynamicControlPlan;
    admission: ControlPlanAdmission;
    secretEnvelopeIds: string[];
  }): Promise<{
    controlPlanId: string;
    controlPlanDigest: Digest;
    controlResultReceiptIds: string[];
  }>;
};

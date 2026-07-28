export type Digest = `sha256:${string}`;
export type AgentCommand =
  | "get-run-context"
  | "get-evidence-metadata"
  | "get-safe-evidence-text"
  | "submit-proposal"
  | "report-limitation";

export type ArtifactReceipt = {
  receiptId: string;
  outboxName: string;
  mediaType: string;
  byteLength: string;
  sha256: Digest;
  closed: true;
};

export type AgentTask = {
  schemaVersion: "1.0.0";
  taskId: string;
  runId: string;
  attemptId: string;
  fenceToken: string;
  taskKind:
    | "repository-map"
    | "product-code-trace"
    | "architecture-analysis"
    | "security-analysis"
    | "finding-review"
    | "decision-synthesis"
    | "decision-review"
    | "plain-language-review";
  providerRole: "author" | "independent-reviewer";
  target: { snapshotId: string; commitSha: string; manifestDigest: Digest };
  evidenceView: { viewId: string; digest: Digest; allowedEvidenceIds: string[] };
  instructionBundleDigest: Digest;
  proposalProfileId: "rak-author-claims-proposal/1.0.0" | "rak-review-proposal/1.0.0";
  proposalInstructions: string;
  expectedAuthorProposalDigest?: Digest;
  requiredOutputSchemaId: string;
  acceptanceChecks: string[];
  allowedCommands: AgentCommand[];
  budget: { wallSeconds: number; outputBytes: number };
  deadlineAt: string;
};

export type AgentOutcome = {
  schemaVersion: "1.0.0";
  taskId: string;
  runId: string;
  attemptId: string;
  fenceToken: string;
  provider: "codex" | "claude-code";
  adapterVersion: string;
  cliVersion: string;
  imageDigest: Digest;
  modelId?: string;
  providerSessionId?: string;
  outcome:
    | "succeeded"
    | "contract-invalid"
    | "permission-denied"
    | "provider-unavailable"
    | "budget-exhausted"
    | "cancelled"
    | "failed";
  proposalReceipt?: ArtifactReceipt;
  operationalLogReceipt: ArtifactReceipt;
  limitationIds: string[];
  startedAt: string;
  endedAt: string;
};

export type SafeEvidenceRecord = {
  evidenceId: string;
  sourceLocator: string;
  mediaType: "text/plain" | "application/json";
  sensitivity: "public" | "internal";
  truncated: boolean;
  byteLength: number;
  escapedPayload: string;
};

export type AgentTaskCapsule = {
  schemaVersion: "1.0.0";
  task: AgentTask;
  runContext: Readonly<Record<string, string | number | boolean | null>>;
  evidence: SafeEvidenceRecord[];
  authorityOrder: readonly [
    "release-safety-policy",
    "typed-task-context",
    "release-task-instructions",
    "untrusted-evidence",
    "provider-proposal",
  ];
};

export type RequestedProviderCapabilities = {
  permissionBypass?: boolean;
  sourceAccess?: boolean;
  sshAccess?: boolean;
  stateAccess?: boolean;
  kitAccess?: boolean;
  generatedTreeAccess?: boolean;
  runtimeAccess?: boolean;
  helperAccess?: boolean;
  arbitraryNetwork?: boolean;
  outputAccess: "proposal-outbox";
  providerInference: {
    attested: boolean;
    destination: "codex" | "claude-code";
  };
};

export type ProviderTaskEnvelope = {
  schemaVersion: "1.0.0";
  provider: "codex" | "claude-code";
  capsule: AgentTaskCapsule;
  requestedCapabilities: RequestedProviderCapabilities;
};

export type ProviderLaunchPlan = {
  provider: "codex" | "claude-code";
  executable: "codex" | "claude";
  fixedArguments: readonly string[];
  stdin: string;
  environment: Readonly<Record<string, never>>;
  networkDestination: "codex" | "claude-code";
  outputChannel: "proposal-outbox";
  permissionMode: "read-only/never" | "dontAsk/deny-precedence";
  taskEnvelope: ProviderTaskEnvelope;
};

export type ProviderExecutionResult = {
  state: "completed" | "contract-invalid" | "budget-exhausted" | "cancelled" | "failed";
  proposal?: unknown;
  proposalReceipt?: ArtifactReceipt;
  operationalLogReceipt: ArtifactReceipt;
  providerSessionId?: string;
  modelId?: string;
  startedAt: string;
  endedAt: string;
  limitationIds: string[];
};

export interface ProviderExecutor {
  readonly available: boolean;
  execute(plan: ProviderLaunchPlan, signal?: AbortSignal): Promise<ProviderExecutionResult>;
}

export type ProviderRunnerTransportResult = {
  state: "completed" | "budget-exhausted" | "cancelled" | "failed";
  proposalOutbox?: { bytes: Uint8Array; receipt: ArtifactReceipt };
  operationalLogReceipt: ArtifactReceipt;
  providerSessionId?: string;
  modelId?: string;
  startedAt: string;
  endedAt: string;
  limitationIds: string[];
};

export interface ProviderRunnerTransport {
  readonly available: boolean;
  execute(
    input: {
      taskEnvelope: ProviderTaskEnvelope;
      executable: "codex" | "claude";
      fixedArguments: readonly string[];
    },
    signal?: AbortSignal,
  ): Promise<ProviderRunnerTransportResult>;
}

export type ProviderEgressDestination = {
  scheme: "https" | "wss";
  host: string;
  port: number;
};

export type SignedProviderEgressAttestation = {
  payload: {
    schemaVersion: "1.0.0";
    jobId: string;
    provider: "codex" | "claude-code";
    attemptNumber: number;
    fenceToken: string;
    envelopeDigest: Digest;
    admissionDigest: Digest;
    destinations: ProviderEgressDestination[];
    issuedAt: string;
    expiresAt: string;
    nonce: string;
  };
  payloadDigest: Digest;
  signatureAlgorithm: "Ed25519";
  signingKeyId: string;
  signature: string;
};

export type ProviderBrokerJob = {
  schemaVersion: "provider-broker-job/1.0.0";
  jobId: string;
  provider: "codex" | "claude-code";
  runId: string;
  attemptId: string;
  attemptNumber: number;
  fenceToken: string;
  deadlineAt: string;
  budget: { wallSeconds: number; outputBytes: number };
  oneUseNonce: string;
  providerHomeId: string;
  providerHomeAuthority: SignedProviderHomeAuthority;
  envelope: ProviderTaskEnvelope;
  envelopeDigest: Digest;
  admissionDigest: Digest;
  providerEgressAttestation: SignedProviderEgressAttestation;
};

export type SignedProviderHomeAuthority = {
  payload: {
    schemaVersion: "provider-home-authority/1.0.0";
    providerHomeId: string;
    engagementId: string;
    provider: "codex" | "claude-code";
    authStoreId: string;
    deploymentId: string;
    issuedAt: string;
    expiresAt: string;
    nonce: string;
  };
  payloadDigest: Digest;
  signatureAlgorithm: "Ed25519";
  signingKeyId: string;
  signature: string;
};

export interface ProviderBrokerClient {
  readonly available: boolean;
  execute(job: ProviderBrokerJob, signal?: AbortSignal): Promise<ProviderRunnerTransportResult>;
}

export interface ProviderOutputNormalizer {
  normalize(provider: "codex" | "claude-code", bytes: Uint8Array): unknown;
}

export type AcceptanceCheck = (
  proposal: Readonly<Record<string, unknown>>,
  task: AgentTask,
) => string[];
export type AcceptanceCheckCatalog = ReadonlyMap<string, AcceptanceCheck>;

export type AgentAdapter = {
  readonly provider: "codex" | "claude-code";
  run(input: {
    capsule: AgentTaskCapsule;
    requestedCapabilities: RequestedProviderCapabilities;
    signal?: AbortSignal;
  }): Promise<AgentOutcome>;
};

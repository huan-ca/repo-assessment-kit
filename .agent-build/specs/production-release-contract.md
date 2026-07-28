# P7 production runtime and customer-release contract

Status: frozen by the tech lead on 2026-07-28. This file refines, and does not weaken,
`architecture.md`, `safety.md`, or `release-contract.md`.

## Public operations

Both launchers expose the same closed release operations in addition to their provider-specific
`login`, `status`, `interactive`, `preflight`, `run`, and `resume`:

```text
pair --codex-run-dir <generated run> --claude-run-dir <generated run>
review --pair-dir <generated pair> --record <signed review JSON>
authorize --pair-dir <generated pair> --record <signed authorization JSON>
release --pair-dir <generated pair>
```

No additional argument, provider flag, command, image, mount, network, credential path, signing
key, or pass-through separator is accepted. Every path is an existing no-symlink regular file or
owner-private directory beneath the installation's `generated/` root. `run` and `resume` use the
production host-helper/provider-broker adapter below; an injected adapter remains test-only and is
never selected by a public launcher.

`pair` allocates a unique owner-private pair directory and immutable
`rak-provider-pair-state/1.0.0` journal before cross-review. `review` admits exactly one signed,
one-use review record. `authorize` admits exactly one signed, one-use final authorization record
after every required review and release certificate is current. `release` performs a fresh complete
revalidation and publishes only a digest-bound authorization sidecar; it does not mutate or relabel
the immutable successor ZIP.

Missing runtime, provider home, signed assets, SSH authority, review key, certificate, native
platform record, or signer produces a typed blocked preflight. It never selects a fixture, creates
a signature, relaxes a gate, or calls a provider directly.

## Installation authority and helper transport

Production uses fixed installation paths, overrideable only through an explicit in-process
`fixture-test-only` seam:

```text
/var/run/repo-assessment-kit/host-helper.sock        mode 0600, non-symlink Unix socket
/run/secrets/rak-host-helper-client.key              mode 0600, 32 raw bytes
/etc/repo-assessment-kit/host-helper.json            mode 0440, root-owned, non-symlink
/etc/repo-assessment-kit/release/release-signing-public-key.pem
                                                    mode 0444, root-owned, non-symlink
/var/lib/repo-assessment-kit/release/verified-host-helper.txt
                                                    mode 0400, root-owned, non-symlink
/var/lib/repo-assessment-kit/host-helper/             mode 0700, root-owned
/var/lib/repo-assessment-kit/transfers/               mode 0710, root-owned
```

The root service binds one dedicated unprivileged `clientUid` and `clientGid` in that configuration.
The socket and client key are owned by `clientUid` (the configuration is owned by root with
`clientGid` group and no other access); the journal and service remain root-owned. The public
launcher/orchestrator runs as that dedicated UID and never as root. Both peers invoke the native
verifier: the service admits only `clientUid`, and the client admits only UID 0. A UID, GID, owner,
mode, or peer mismatch blocks before a frame or effect.

The helper accepts only `serve`, `reconcile`, and
`emergency-stop --run-id <id> --runtime-id <id>`. The client has no generic production socket/path
option. Frames are four-byte big-endian length plus strict UTF-8 JSON and are bounded to 1 MiB
before allocation. Every request is the frozen `HostRequest` from `architecture.md` and binds
installation, run, attempt, fence, monotonically increasing counter, random 256-bit nonce,
60-second expiry, idempotency key, canonical request digest, and HMAC-SHA-256. Responses bind the
request digest and use the same MAC; comparison is constant-time.

The helper fsyncs counter, nonce, idempotency, resource, fence, result, and cleanup state before an
effect or terminal reply. Same idempotency key plus same digest returns the durable result. A
different digest, replayed nonce/counter, stale fence, expiry, unknown field/registered ID,
mismatched creation nonce, or invalid transition fails before effect. Diagnostics are fixed codes
and never include raw paths, secrets, provider output, Git output, or target bytes.

The only helper-to-client byte transfer is a finalized source snapshot under the fixed transfer
root. Its directory is derived—not supplied—from
`<installationId>/<runId>/<sourceCommandId>/`, is root-owned with the configured client group and
mode 0750, and contains exactly `snapshot.tar` plus `manifest.json` as root-owned,
configured-client-group, mode-0440 regular files. `source.finalize` fsyncs those files and their
directories before returning their digests and receipt. The client derives the same path from the
authenticated result, reads both through held no-follow descriptors, rechecks owner/group/mode and
the returned digests, validates the bounded canonical archive, and extracts into its owner-private
run snapshot store without links, devices, absolute paths, traversal, duplicates, or special
files. It then invokes `source.release`; release deletes only the exact creation-nonce-bound
transfer and reports zero residue. Missing, changed, or uncleared material blocks the run. No other
operation exports bytes or accepts a destination/path.

The merged production request has exactly these envelope keys and no others:

```text
protocolVersion:"1.0.0", installationId, requestId, commandId, runId, attemptId,
fenceToken, idempotencyKey, counter, nonce, issuedAt, expiresAt, operation, payload,
requestDigest, mac
```

`operation` selects exactly one payload from the architecture `HostOperationRequestMap` or the
additional map below; an operation/body mismatch is invalid. `requestDigest` is the canonical
SHA-256 of the complete request without `requestDigest` and `mac`; `mac` is HMAC-SHA-256 over the
canonical request including `requestDigest` but without `mac`. A success response has exactly
`protocolVersion,requestId,commandId,operation,requestDigest,state,heartbeatAt,result,mac`; a
failure replaces `result` with the frozen bounded `error`. Unknown response fields or a
request/operation/digest/MAC mismatch are rejected by the client.

Additional closed operations are:

```text
provider.preflight {
  provider, releaseAuthorityDigest, immutableImageReference, providerHomeAuthorityDigest,
  networkPolicyDigest, outputSchemaDigest
}
provider.stage {
  jobId, provider, envelopeDigest, taskBytesDigest, taskBytesBase64,
  outputSchemaDigest, providerHomeAuthorityDigest
}
provider.execute {
  jobId, provider, stagedTaskId, immutableImageReference, networkAttestationDigest,
  deadlineAt, wallSeconds, outputBytes
}
provider.cancel { jobId, reasonCode }
provider.cleanup { jobId, preserveReceiptIds }
provider.status { jobId }
secret.store {
  handleId, purpose, recipient, approvalDigest, expiresAt, maxUses:1, sealedValue
}
secret.consume { handleId, purpose, recipient, runtimeCreationNonce }
secret.revoke { handleId, reasonCode }
request-guard.admit { runtimeId, signedControlPlan, compiledPlanDigest }
request-guard.issue {
  runtimeId, runtimeCreationNonce, snapshotId, compiledPlanId, compiledPlanDigest,
  internalOrigins, selectedProfileIds, approvalIds, plannedControlIds, probeProfileId,
  requestedExpiresAt
}
request-guard.revoke { runtimeId, controlPlanDigest, reasonCode }
```

There is no `exec`, shell, arbitrary argv/environment, generic file copy/delete, arbitrary
Docker/Lima/SSH operation, or caller-selected mount/network/destination.

Every persisted provider broker job, its admission digest, and its current run-journal authority
bind the exact `releaseAuthorityDigest` returned by the authenticated helper reconciliation and
used by `provider.preflight`. The egress-attestation or network-policy digest is a separate field
and must never be substituted for release authority.

`request-guard.issue` is the sole production control-plan issuance path and is not a generic
signing operation. It runs only after the helper has durably completed `vm.create`,
`vm.stageSnapshot`, `vm.compile`, and `vm.start` for the same authenticated
run/attempt/fence. The helper resolves the creation nonce, snapshot, compiled plan, exact
post-start internal origins, selected profiles, approvals, planned controls, and probe profile
against its own current journal and root-owned registered catalog. The request can select only
registered IDs and can lower the expiry; it cannot supply methods, routes, budgets, destinations,
control payload bytes, signing material, or a signature. Any mismatch or expansion is a typed
failure before signing.

The helper constructs the complete frozen `SignedDynamicControlPlan` payload, derives the
run/attempt/fence/runtime bindings and a fresh one-use nonce, limits expiry to the earliest
registered approval/runtime lease or 30 minutes, signs only the
`rak-dynamic-control-plan/v1` domain through the configured fixed external signer, and journals a
PREPARED record before that effect. Its successful result has exactly
`state,runtimeId,controlPlanId,controlPlanDigest,signedControlPlan,issuedAt,expiresAt`; the digest
equals `signedControlPlan.payloadDigest`. Reconciliation returns only the byte-identical durable
result for the same command/request digest. Rejection uses the bounded host failure envelope and
never returns a partial signature.

Root installation configuration binds one
`rak-dynamic-control-plan-issuer/1.0.0` profile: signing key ID, public verification key
path/digest, fixed signer binary owner/mode/digest, maximum lifetime, and one root-owned immutable
catalog path/digest containing the registered dynamic profiles, approvals, control definitions,
and probe profiles. The private key and its path are never accepted by Node, JSON, environment,
argv, images, or generated artifacts.

For `runtime.mode:"isolated"`, the public run configuration carries only bounded selections:
`selectedProfileIds`, `approvalIds`, `plannedControlIds`, `probeProfileId`,
`candidateRelPaths`, optional `buildAcquisitionApprovalId`, `declaredArtifactIds`,
`artifactByteLimit`, and optional lower `controlPlanLifetimeSeconds`, in addition to exact
`targetOrigins`. These values select registered authority; they do not define it. Static-only
configuration omits them. An isolated sandbox credential entry has exactly
`handleId,purpose,recipient,handleEnvironment,approvalDigest,expiresAt,production`; production is
false, purpose is `probe` for this MVP path, and the `RAK_SANDBOX_*` environment value is sealed
ciphertext for the configured recipient, never plaintext or forwarding authority. Target-service
credentials are a typed unsupported capability until a separately frozen pre-start preparation
protocol exists; they are never silently injected after service start.

The production isolated-runtime path requires `source.kind:"ssh"` because that helper-owned
acquisition is the only frozen source-byte channel into the host runtime. A local source remains
valid for `static-only`; selecting local plus isolated is a typed configuration error. The client
does not invent a local client-to-helper archive, path, mount, or copy fallback.

`provider.stage.taskBytesBase64` is canonical padded base64 for one non-empty task of at most
524,288 decoded bytes. The helper decodes it before any effect, requires
`taskBytesDigest == SHA-256(decoded bytes)`, parses strict JSON, requires the frozen
`provider-task-envelope/1.0.0` shape, and requires `envelopeDigest` to bind its canonical envelope.
Only then may the fixed broker materialize it in the registered staging compartment. The raw task
bytes are neither written to the helper journal nor returned in a response. This is the sole
client-to-helper provider-task byte channel; there is no input path, task handle invented by the
caller, or generic copy operation.

## Fixed host and runtime execution

The strict helper configuration binds the installation/journal, exact public verification keys,
native Lima binary and immutable guest image, `rak-lima-plain-native/1.0.0`, rootless runtime
broker, request guard, firewall, secret broker, acquisition/provider image digests, resource
profiles, network policies, provider homes, and SSH handles.

Peer credentials use the signed native `/usr/local/libexec/rak-peer-cred` verifier whose exact
path, owner, mode, platform, and executable digest are bound in helper configuration. The Node
client/service passes only the already-connected Unix socket as inherited descriptor 3 and invokes
fixed `verify --fd 3 --expected-uid <configured uid>` arguments. The verifier uses Linux
`SO_PEERCRED` or macOS `getpeereid`, returns one bounded strict result, and has no path/socket/open
operation. Missing verifier, unsupported platform, digest/mode/owner mismatch, unexpected peer, or
malformed output blocks before request/effect. Undocumented Node handle methods are never authority.

The helper executes `limactl` and the in-VM broker with constant argv assembled from registered IDs.
Lima plain mode has no host mounts, agent/guest forwarding, dynamic forwards, bridged network,
built-in containerd, or target port forward. The guest must be native architecture, cgroup v2 with
delegated CPU/memory/PID/I/O, 65,536 subordinate IDs, root-owned default-deny firewall, and
broker-only rootless Docker. No workload receives a physical-host, rootful, or broker Docker
socket.

Provider execution mounts exactly a sterile tmpfs home, one allowlisted read-only auth-session
file selected by opaque provider-home authority, one read-only task, one read-only release-owned
schema, and one fresh writable proposal outbox. It uses the signed immutable provider image,
resource limits, no-new-privileges, all capabilities dropped, read-only root, and exact signed
provider-egress network. Cleanup removes task/outbox/network, reconciles process group and cgroup,
and returns `COMPLETE` or bounded residue IDs. Residue blocks resume and release.

The root-owned firewall denies external IPv4/IPv6/DNS/LAN/metadata/control/provider destinations by
default. Only the registered provider workload may use its provider policy; only acquisition may
use the exact Git host/port. The request guard is the sole probe-to-target path and admits only a
current signed control plan. Emergency stop first fences the run, revokes policies and secrets,
cancels processes/cgroups, destroys the exact tagged runtime by creation nonce, fsyncs cleanup, and
reports residue without broad deletion.

The root installer never trusts a digest beside the payload it authenticates. Before any
installation mutation or payload execution it requires the fixed, root-owned
`verified-host-helper.txt` record above, produced by the separate signed-release verification
ceremony. Its closed line-oriented schema binds
`profile,verified,sourceCommit,manifestSha256,signingKeyId,platform,architecture,nodeVersion` and SHA-256 values
for the Node executable, native peer verifier, every helper/provider-task/validator/entrypoint
module, the root-executed installer itself, and both platform service definitions. Unknown,
duplicate, missing, malformed,
wrong-platform, permissive, non-root, or symlinked authority fails before mutation. The installer
uses only OS-native hashing to compare every source payload byte to this record before executing
Node or copying a file into the installation. To close hash/use races, it first copies the bounded
payload set without executing it into a newly created root-owned mode-0700 staging directory,
hashes those staged regular non-symlink files against the signed authority, and thereafter installs
only from those held/staged bytes. It never returns to mutable checkout paths after verification.
The verify path hashes the installed Node and every other installed byte against the authority
before executing Node. The installed pre-start validator rechecks the same authority against every
installed byte. A colocated `node.sha256`, mutable checkout comparison, self-generated manifest,
or root ownership of an unverified payload is not release authority.

The verifier may emit the fixed host-helper record only after checking the release signature
against the fixed out-of-band public key above. Caller-selected public keys are permitted for
non-installing fixture/general verification only and can never emit this installation authority.
The key, its parent directories, and the record directory must be canonical root-owned,
non-symlink, and not group/other writable.

The secret broker accepts only sealed input for frozen target/probe purposes, never provider or SSH
credentials. Handles bind purpose, recipient, run, runtime, fence, expiry, and max-use one.
Consumption is journaled before a mode-0400 recipient-only tmpfs exposure. No list, readback,
search, export, generic resolve, environment forwarding, or persistent plaintext operation exists.

## Trusted SSH acquisition

Run configuration carries only normalized SSH URL/ref and `acquisitionProfileId`, never key or
known-host paths. The installation registers an opaque `sshHandleId` binding one exact
repository-scoped read-only key or approved agent socket, one exact known-hosts file, expected
host/port/fingerprint, expiry, and maximum uses.

`source.acquire` creates one ephemeral non-root worker from the signed acquisition image. It mounts
only the exact key as read-only 0400 (or socket), known-hosts as 0444, and bounded work volume. It
uses empty tmpfs home, strict host checking, no prompt, no system/global Git config, disabled
hooks/helpers/LFS filters/file protocol/submodules, and fixed Git argv. Egress permits only the
registered host/port. It resolves one full commit, exports without executing repository config,
creates and verifies the canonical snapshot, then destroys worker/network/credential mounts.
Success requires no process, mount, socket, network, temporary directory, or credential residue;
uncertainty is `RESIDUE` and blocks release.

The public orchestrator calls `source.acquire`, waits only through `source.status`, admits the
returned IDs/digests, calls `source.finalize`, imports the fixed transfer as described above, and
always calls `source.release`. It records the acquisition, finalize, transfer-import, and cleanup
receipt digests in the source-run journal. Pairing and final release bind those SSH receipt digests;
neither a raw key path nor a caller-selected transfer path enters configuration or journal state.

## Provider-pair state and cross-review

Input runs must be terminal `DRAFT_VALIDATED_RELEASE_BLOCKED`, one Codex and one Claude, with
successful closed authors. Pairing rejects reused run IDs, provider/journal/receipt/package/proposal
drift, source/discovery mismatch, or differing architecture section 7.4 input-binding fields.

The owner-private immutable pair journal binds:

```text
schemaVersion, equivalencePairId, codexRunId, claudeRunId
inputBinding, inputBindingDigest, both run receipt digests
author proposal digests, cross-review task attempts/fences/nonces
providerRunIds, successor ZIP digest, reconciliation digest
admitted review record IDs/nonces, authorization record ID/nonce
state, blockers, cleanup, journalDigest
```

Pairing creates fresh cross-reviews: Claude reviews admitted Codex authors and Codex reviews
admitted Claude authors. Each task receives only the same bounded evidence view plus exact foreign
author digest, uses a fresh attempt/fence/nonce and closed reviewer profile, and runs through the
production broker. Same-provider review never satisfies the gate. Successor creation uses
`rak-paired-provider-runs/1.0.0` plus both run IDs. Equivalence compares fixed required
outcome/coverage/evidence/limitation fields, not prose or ZIP bytes.

## Human review, authorization, and release

Each `rak-signed-human-review/1.0.0` contains only:

```text
recordId, kind:
  independent-security|independent-decision|technical-human|lay-human|customer-acceptance
reviewerId, organizationId, independenceDeclaration
equivalencePairId, successorZipDigest, reconciliationDigest, inputBindingDigest
decision: approved|rejected
limitationIds, issuedAt, expiresAt, nonce, signingKeyId, signature
```

Ed25519 signs the domain-separated canonical payload without `signature`. Production accepts only
configured trusted keys. The helper configuration contains an exact `humanReviewKeys` array whose
entries are `{kind,signingKeyId,publicKeyPath,publicKeySha256}`. A key is authorized for exactly one
kind. The required set is exactly one approved record for each of the five named kinds—no missing
or duplicate kind—with five distinct `recordId`, `reviewerId`, `signingKeyId`, and nonce values.
The `customer-acceptance` reviewer may share the customer's organization but no reviewer or key may
fill another kind. Production rejects fixture keys, expiry, future issue time, record/nonce replay,
wrong digest, unknown fields, `rejected`, unresolved Critical/High boundary defects, or missing
independence. Admission is exclusive/fsynced.

The final `rak-signed-customer-release-authorization/1.0.0` binds the pair; successor ZIP,
reconciliation, and input-binding digests; every review digest; signed
release-assets/toolchain/images/SBOM/provenance/vulnerability certificates; official schema
certificate; native Linux ARM64/x86-64 and macOS ARM64/x86-64 runtime certificates; real provider
canary/equivalence certificates; applicable SSH certificate; cleanup receipts; decision; one-use
nonce; expiry; key ID; and signature. Release authority is distinct from reviewer keys.
Configuration binds exactly one `releaseAuthorizationKey` as
`{signingKeyId,publicKeyPath,publicKeySha256}`; its signing key ID and public-key digest must differ
from all five human-review keys.

The helper configuration also contains an exact `releaseCertificateKeys` array. Each entry is
`{kind,signingKeyId,publicKeyPath,publicKeySha256}` and authorizes that key for exactly one of:

```text
releaseAssets|toolchain|images|sbom|provenance|vulnerability|officialSchemas|
providerCanaries|providerEquivalence|linux-arm64|linux-x86-64|macos-arm64|
macos-x86-64|ssh|cleanup:codex|cleanup:claude-code
```

There is exactly one entry for every applicable kind (all except `ssh` are always applicable);
duplicate kinds are invalid. Public-key files are root-owned, mode 0440 with the configured client
group, non-symlinks and are read through held no-follow descriptors; their bytes must match
`publicKeySha256` and parse as Ed25519 public keys. A closed `releaseCertificateSubjects` object
binds the exact current subject digest for every non-SSH, non-cleanup kind above. The SSH subject is
derived from the helper-issued acquisition
receipt digest(s) bound in the two source-run journals. The two cleanup subjects are derived from
the exact Codex and Claude Code helper cleanup receipt digests bound in the pair journal. A
configured subject, kind, signer, or digest may not substitute for another.

The same root-owned configuration contains a closed `unresolvedBoundaryDefects` array with only
`{defectId,severity,state}` records. `Critical` or `High` entries whose state is not `resolved`
block authorization and release. Unknown fields, severities, or states make the production
authority configuration invalid.

All human-review, final-authorization, and release-certificate public-key files use the same
root-owned, configured-client-group, mode-0440, held-no-follow descriptor and pinned-digest rule.

`release` reopens the ZIP and revalidates pair journal, signatures/nonces/expiries/digests, review
set, signed bundle, schemas, provider equivalence, applicable SSH, four platforms, zero residue, and
no release blocker. Only then it atomically writes an exclusive
`rak-customer-release-certificate/1.0.0` sidecar and changes pair state to
`CUSTOMER_RELEASE_AUTHORIZED`. The immutable ZIP still truthfully records its pre-authorization
draft state. Failure leaves `DRAFT_VALIDATED_RELEASE_BLOCKED` and persists only fixed blocker codes.

Fixture authorities are accepted only by exported in-process seams requiring
`mode:"fixture-test-only"`. Public CLIs reject fixture keys, self-signatures, unsigned records,
mutable tags, environment private keys, and generated certificates.

## Required deterministic evidence

Tests must prove strict framing/JSON/MAC/counter/nonce/expiry/fence/idempotency/crash replay/fsync
ordering/response binding/reconciliation; no arbitrary command/mount/network/path/socket/rootful/
privileged/broad-SSH/secret-readback fallback; provider and SSH staging; signed firewall,
request-guard and secret replay/expiry; emergency-stop order and residue; pair mismatch/replay,
foreign reviewer binding and same-provider rejection; record/key/nonce/expiry/digest attacks;
incomplete certificates and one-use authorization; and precise public blocked preflight here
without Docker/Lima/signers/provider sessions/SSH handles.

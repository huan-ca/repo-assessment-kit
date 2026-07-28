# Independent P7 production helper/runtime/SSH QA

Date: 2026-07-28  
Scope: reopened P7 production host-helper transport, journal, fixed operation boundary,
runtime/emergency-stop path, trusted SSH acquisition, and public launcher reachability.

## Verdict

**NEEDS FIXES / NO-GO.**

There are **six High implementation defects**. Five were directly reproduced with the
current code; the sixth follows deterministically from the fixed emergency-stop driver and
violates the required unresponsive-component behavior. This is not a PASS even though the
existing focused tests pass.

Separately, the native Linux ARM64/x86-64 and macOS ARM64/x86-64 Lima/rootless/cgroup/
firewall/request-guard/emergency-stop/residue matrix, real signed runtime-broker installation,
and real SSH authority/canary evidence were not available in this Linux ARM64 container.
Those are mandatory external release artifacts, but they are **not** the reason the
implementation verdict fails.

## Execution summary

| Check | Result | Evidence |
|---|---:|---|
| Existing helper + provider-broker Node tests | PASS, 19/19 | `.agent-build/artifacts/p7-product-helper-qa-independent/focused-node-final.txt` |
| Focused release-run Vitest tests | PASS, 11/11 | `.agent-build/artifacts/p7-product-helper-qa-independent/release-run-vitest.txt` |
| Independent adversarial helper probes | FAIL, 7 unsafe acceptances / missing enforcement observations across 4 boundary classes | `.agent-build/artifacts/p7-product-helper-qa-independent/adversarial-probes.txt` |
| Closed launcher negative arguments | PASS, 4/4 | `.agent-build/artifacts/p7-product-helper-qa-independent/launcher-negatives.txt` |
| Public SSH run, Codex and Claude launchers | FAIL, 0/2 reachable | `.agent-build/artifacts/p7-product-helper-qa-independent/public-ssh-run*.stderr` |
| Public read-only Codex preflight without installed host authority | PASS (precise fail-closed result) | `.agent-build/artifacts/p7-product-helper-qa-independent/preflight-codex.json` |
| Native production helper execution | BLOCKED by absent root-owned installation and non-root test user | `.agent-build/artifacts/p7-product-helper-qa-independent/production-reconcile.stderr` |

Focused automated total: **30 passed, 0 failed**. Those tests do not cover the reproduced
contract failures below.

## Acceptance matrix

| Contract / acceptance criterion | Status | Evidence and exact repro |
|---|---|---|
| Strict 4-byte framing, strict UTF-8 JSON, duplicate-name rejection, request digest/MAC, expiry, exact request envelope | PASS for covered request cases | Run `node --test scripts/host-helper-protocol.test.mjs`; 5/5 helper tests pass in `focused-node-final.txt`. The request decoder rejects duplicates, trailing data, oversized frames, bad MAC and a tested incomplete payload. |
| Exact MAC-bound **response** shape and operation-specific result/error schema | **FAIL** | Run the inline probe recorded in `adversarial-probes.txt`. A correctly MACed response with `state:"ROOT_SHELL_GRANTED"`, invalid timestamp, unknown result fields, and raw diagnostic-like text is accepted by `verifyHostResponse`. `scripts/host-helper-protocol.mjs:406-443` checks only top-level key names/bindings/MAC, not state, timestamp, bounded error, or `HostOperationResultMap`. |
| Durable counter, nonce, fence and completed idempotency replay | PASS for ordinary completed operations | Existing journal test passes. Same key/digest replays a completed durable response; stale fence and conflicting digest are rejected. |
| Crash-after-admission recovery, durable resource/result/cleanup reconciliation | **FAIL** | `adversarial-probes.txt`: admit a request, close/reopen the journal before completion, then replay the identical request. Actual: `INVALID_TRANSITION accepted effect requires reconciliation before replay`, with the only record still `ACCEPTED`. `scripts/host-helper-journal.mjs:139-175` has no recovery transition. `production-host-helper.mjs:34-48` reports maintenance `reconcile` as blocked rather than reconciling. |
| Closed, typed `HostOperationRequestMap` validation before effect | **FAIL** | `adversarial-probes.txt` shows `validateFixedOperation` accepting invalid `vm.preflight` (`sparc`, bad digest), traversal/object-valued `provider.cancel`, SSH-purpose `secret.consume`, and object-valued broad-target `vm.emergencyStop`. `scripts/host-helper-operations.mjs:121-130,205-219,274-324` validates many architecture operations only by key names/`*Id` heuristics and leaves several added operations untyped. |
| No generic exec/mount/network/file/secret-readback operation | PASS at public protocol operation-name layer | Existing helper test rejects `exec`, `docker.run`, `file.read`, `secret.read`, and `ssh.exec`. Production drivers use a fixed registered binary, fixed `["operation", operation]` argv, canonical stdin, `shell:false`, and a fixed environment. This does not cure the typed-payload defect above. |
| Authority no-follow/owner/mode/digest and singleton socket | PARTIAL / external proof missing | Static implementation uses `O_NOFOLLOW` and owner/mode/digest checks for key/config/fixed binaries and refuses an existing socket. Fixture socket round trip passes. A real root-owned installation, socket-replacement race suite, and signed native binary installation were unavailable, so this criterion is not fully verified. |
| Native peer verifier invoked on already-connected FD 3 for both client/service boundary | **FAIL** | `adversarial-probes.txt`: supply a rejecting service-side `peerCredentialVerifier`; a request succeeds and `serverVerifierCalls` is `0`. The client invokes the verifier (`host-helper-client.mjs:190-237`), but the accepted server connection goes directly to decoding/handling (`host-helper-service.mjs:171-193`) without native peer verification. |
| Fixed Lima/firewall/request-guard/secret/provider drivers | **FAIL** | The fixed-binary dispatch itself is closed, and signed request-guard admission has verification code, but the pre-effect typed validation defect applies to runtime, secrets, provider cancellation/status and emergency stop. No installed signed broker/firewall/secret broker was available for positive native execution. |
| Emergency stop order, persistence, unresponsive components, exact cleanup/residue | **FAIL** | `host-helper-operations.mjs:455-487` calls fence → revoke network → revoke secrets → cancel cgroups → Lima stop → residue sequentially, but aborts on the first failed command. Therefore an unresponsive broker at any early step prevents later containment, forced runtime stop, and residue reporting. No cleanup/order stage is persisted to the helper journal before each effect. The returned result also adds `stopOrderDigest`, which is outside the frozen `vm.emergencyStop` result shape and is accepted only because response validation is incomplete. |
| Trusted SSH acquisition through production helper | **FAIL** | Execute `./start-codex.sh run --config examples/run.ssh-static.sample.json` and the equivalent `start-cc.sh`. Both exit 1 with `SSH_TRUSTED_HELPER_UNAVAILABLE`. `run-release-assessment.mjs:1157-1163` unconditionally rejects every SSH config before calling the implemented helper client. Thus AC-2 and the frozen production SSH path are unreachable, not merely blocked because this host lacks an authority. |
| Public launcher closed verbs, no provider pass-through, production injection rejection | PASS for tested CLI negatives; PARTIAL overall | Four malformed/missing argument cases exit 64/78 with closed usage or typed remediation (`launcher-negatives.txt`). No public adapter/socket/path injection flag is present. Full production-injection and every verb permutation were not exhaustively fuzzed. |
| Precise public blocked preflight without Docker/Lima/signed helper/provider session | PASS | `./start-codex.sh preflight` exits 78 and emits closed JSON naming `docker_unavailable`, `release_assets_unverified`, `host_helper_authority_unavailable`, `lima_unavailable`, and `provider_helper_authority_unavailable`, with remediations and no direct fallback (`preflight-codex.json`). |
| AC-4 safe isolated runtime | **FAIL / externally blocked** | No native runtime was available, which is correctly reported by preflight. More importantly, malformed operation acceptance, absent service-side peer verification, non-reconcilable crash state, and fail-short emergency stop prevent accepting the production runtime boundary. |
| AC-9 both launcher product paths | **FAIL** | Both launchers share the same precise blocked preflight and closed CLI, but both have 0/2 reachable SSH runs and no real provider/native success evidence. |
| AC-10 four native platforms and release readiness | **FAIL** | Required four-native-host matrix and real runtime/SSH/provider certificates are absent from this environment; High implementation defects also independently block release. |

## Defects

### H-1 — Client accepts arbitrary MAC-valid helper result/state/error content

**Owner:** runtime/backend  
**Repro:** run the probe captured in `adversarial-probes.txt`; inspect its first line.  
**Expected:** client rejects any state, timestamp, error, or operation result not exactly
matching the frozen response union.  
**Actual:** malformed state, timestamp and arbitrary result fields are returned as trusted.
This can propagate unvalidated broker fields or raw diagnostics across the trust boundary.

### H-2 — Durably accepted effects cannot be reconciled after a crash

**Owner:** runtime/backend  
**Repro:** the crash-replay section of `adversarial-probes.txt`.  
**Expected:** startup/reconcile determines the exact resource/result under installation,
run, attempt, fence, digest and creation nonce, then persists the terminal result or safely
cleans it.  
**Actual:** identical replay is permanently `INVALID_TRANSITION`; offline `reconcile` only
prints a blocked record. Resource and cleanup maps are not populated by the service.

### H-3 — Closed operations admit invalid typed values before dispatch

**Owner:** runtime/backend  
**Repro:** the four `PROBE closed-payload` lines in `adversarial-probes.txt`.  
**Expected:** every payload field is type/range/enum/digest/registered-authority checked
before journal admission or effect.  
**Actual:** invalid native architecture/digest, traversal-like IDs, prohibited secret
purpose, object-valued reason, and broad-target-like runtime ID are accepted by the
operation validator.

### H-4 — Helper service does not invoke native peer credential verification

**Owner:** runtime/backend  
**Repro:** the `PROBE service-peer-verifier` line in `adversarial-probes.txt`.  
**Expected:** the service verifies the already-connected client socket through the pinned
native verifier before decoding/authenticating/effect.  
**Actual:** the configured rejecting service verifier is never called and the request
succeeds. Only the client verifies its server peer.

### H-5 — Public production SSH acquisition is unreachable

**Owner:** backend/release orchestrator  
**Repro:** run both launcher commands listed in the matrix.  
**Expected:** normalized SSH configuration selects its registered opaque handle, calls
`source.acquire`, and either succeeds or reports the specific missing/mismatched authority.
**Actual:** both launchers unconditionally reject every SSH configuration before helper
selection. This is a missing core AC-2 product path, not missing host-only evidence.

### H-6 — Emergency stop aborts containment on the first unresponsive component

**Owner:** runtime/backend  
**Repro:** inspect `scripts/host-helper-operations.mjs:455-487`; each awaited stop phase is
inside a single fail-short sequence. Configure the fixed broker so its `fence` or
`revoke-network` command exits nonzero.  
**Expected:** bounded best-effort continuation performs every remaining independent
containment action, force-stops the exact runtime, persists each stage, probes residue, and
returns bounded residue.  
**Actual:** the first rejection throws; later revocation, cgroup cancellation, forced stop
and residue reporting do not run.

## Coverage notes

- The independent probe is intentionally outside the product test tree and does not modify
  product code. It exercises exported production validation/journal/client/service
  primitives through the documented fixture-only seam.
- Existing tests cover happy-path request authentication, completed replay, one fixed
  effect, a fixture socket, generic operation-name denial, and provider-broker proposal
  controls. They do not assert operation-specific response schemas, accepted-effect crash
  recovery, server-side peer verification, complete typed operation values, public SSH
  reachability, or emergency-stop failure continuation.
- Not verified here: real root-owned authority installation; actual `rak-peer-cred`;
  signed Lima/guest/broker/firewall/request-guard/secret binaries; native cgroup and
  rootless confinement; real provider sessions; real repository-scoped SSH key/agent and
  known-hosts use; cleanup/residue on all four native platform/architecture combinations.
  Per the frozen safety/release contract these remain release blockers until genuine native
  evidence is supplied.

## Evidence locations

- Report: `.agent-build/test-runs/release/product-helper-qa-independent.md`
- Evidence root:
  `.agent-build/artifacts/p7-product-helper-qa-independent/`

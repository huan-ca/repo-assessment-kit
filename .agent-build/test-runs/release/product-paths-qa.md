# P7 production product-path QA

Status: IN PROGRESS  
QA lane: fresh independent runtime/helper/SSH and public pair/review/authorize/release verification  
Contract freeze: 2026-07-28  
Product code policy: read-only; this lane writes only this report and
`.agent-build/artifacts/p7-product-qa/**`.

## Frozen-contract critique

The QA oracle is the conjunction of `production-release-contract.md`,
`release-contract.md`, architecture/safety contracts, P7, and brief AC-2/4/8/9/10.
The production contract is directionally fail-closed and unusually explicit about prohibited
capability. QA initially identified two ambiguities: the merged helper request/result schema and
the exact human-review cardinality/key mapping. The tech lead accepted and froze corrections before
execution. The contract now specifies the exact request/success/failure keys and digest/MAC inputs,
the architecture-plus-production closed operation union, and exact client response rejection. It
also requires exactly one approved record for each of five kinds, five distinct record/reviewer/
key/nonce values, one configured key bound to each kind, and a final authorization key distinct
from every review key. These corrections are now the exact QA oracle.

Other acceptance-sensitive details are sufficiently testable: closed launcher grammar, generated
root confinement/no-follow paths, authenticated bounded framing, durable replay/fence/idempotency
state, registered host/runtime/SSH resources, one-use secret semantics, cross-provider binding,
signed digest-bound records, fresh release revalidation, and fail-closed preflight.

## Acceptance and adversarial matrix

| ID | Contract / AC | Concrete checks | Required evidence | Initial status |
|---|---|---|---|---|
| H1 | Helper framing | Reject short/oversize length, invalid UTF-8, duplicate-key/trailing/non-object JSON, unknown fields/version/operation before effect | focused deterministic test output and journal/effect assertions | PENDING |
| H2 | Helper authentication/replay | Reject bad MAC/request digest/response binding, duplicate nonce/counter, expiry/future issue, stale fence; constant-time MAC path | focused tests | PENDING |
| H3 | Helper durability | Same idempotency+digest returns exact durable result; conflict rejects; crash before/after effect reconciles once; fsync precedes effect/reply | crash-injection tests and ordered trace | PENDING |
| H4 | Registered authority only | Reject arbitrary argv/env/commands, caller paths/sockets, mounts, networks, destinations, Docker/Lima/SSH primitives, rootful/privileged/broad SSH | negative API/CLI tests | PENDING |
| R1 | Native runtime containment / AC-4 | Fixed Lima plain-native config, native architecture, no host mounts/forwarding/containerd, rootless broker-only socket, cgroup v2 limits, immutable guest | deterministic config tests plus real native evidence | PENDING |
| R2 | Provider staging | Exact sterile mounts, signed image/network, read-only task/schema/auth session, fresh outbox, dropped privilege/caps/read-only root; cleanup/residue | focused tests plus real runtime evidence | PENDING |
| R3 | Firewall/request guard | Default-deny v4/v6/DNS/LAN/metadata/control/provider; exact provider/acquisition exceptions; only current signed plan reaches target; revoke blocks | focused tests plus hostile native exercise | PENDING |
| R4 | Secret broker | Sealed store only; purpose/recipient/run/runtime/fence/expiry/max-use binding; journal-before-exposure; no list/readback/search/export/env/persistence; replay fails | focused tests | PENDING |
| R5 | Emergency stop/reconcile | Fence → revoke policies/secrets → cancel cgroups/processes → destroy exact creation nonce → fsync cleanup; bounded residue blocks resume/release; no broad delete | ordered fault-injection tests | PENDING |
| S1 | Trusted SSH / AC-2 | Strict normalized SSH URL/ref+opaque profile only; exact repo-scoped key/socket+known-hosts; fixed Git; hooks/helpers/LFS/file/submodules disabled; exact egress | focused hostile tests plus real trusted SSH run | PENDING |
| S2 | SSH cleanup / AC-2 | Full commit and immutable snapshot; source before/after unchanged; no key/agent/config/output residue; uncertainty becomes RESIDUE and blocks | tests, filesystem scan, real run | PENDING |
| P1 | Pair admission | Reject provider mismatch, reused IDs, receipt/package/proposal/journal drift, source/discovery/input mismatch; allocate private immutable journal | focused tests | PENDING |
| P2 | Cross-review binding | Fresh opposite-provider tasks bind exact foreign author digest and bounded view; same-provider output and run drift cannot satisfy gate | focused tests | PENDING |
| V1 | Human-review records | Strict schema/domain-separated Ed25519; trusted non-fixture key; identity/independence; nonce/record replay, expiry/future, digest, unknown field, rejection attacks | focused tests | PENDING |
| A1 | Final authorization | Strict signature; key independent from reviewer keys; binds pair/ZIP/reconciliation/input/review/certificate/cleanup digests; nonce/expiry; incomplete certificates and replay fail | focused tests | PENDING |
| L1 | Release transition / AC-8 | Fresh reopen/revalidation; tampered ZIP/journal/review/cert/cleanup blocks; exclusive sidecar; immutable ZIP remains draft; atomic authorized state only on success | focused tests | PENDING |
| C1 | Public grammar / AC-9 | Both launchers expose identical exact verbs/options; reject extras/provider flags/pass-through/signing keys/env flag injection and out-of-root/symlink paths | shell/process tests | PENDING |
| C2 | Public blocked preflight | Without helper/runtime/signed assets/provider homes/SSH/review/release authorities, every applicable command returns typed remediation and never fixture/direct-provider/signing fallback | process tests in unavailable environment | PENDING |
| E1 | Real external evidence / AC-2/4/9/10 | Real Codex+Claude runs, trusted SSH, hostile credentialed target, native Linux/macOS arm64+x86-64 certificates, signed bundle and independent human/final records | non-fixture artifacts and exact commands | PENDING |
| CI | Regression | Focused production suites and repository `pnpm ci` after implementation freeze | captured command logs | PENDING |

This is the pre-execution matrix preserved as the audit plan. Final PASS/FAIL outcomes are in the
acceptance matrix below.

## Acceptance matrix

Final row count for this pass: **6 PASS / 14 FAIL / 20 total**.

| ID | Result | Evidence / exact repro |
|---|---|---|
| H1 strict framing/JSON | PASS | `node --test scripts/host-helper-protocol.test.mjs scripts/provider-broker.test.mjs`; duplicate JSON, trailing bytes, frame bounds, merged closed payloads pass. |
| H2 MAC/replay/counter/fence | PASS | Same focused command; MAC/digest, nonce/counter, stale fence, one-use and response-binding tests pass. |
| H3 durability/idempotency/reconcile | PASS | Same focused command; durable result replay and service-level pending-digest reconciliation pass. |
| H4 no arbitrary host capability | PASS | Same focused command; generic exec/file/secret-read/SSH operations, payload mounts, broadened destinations and provider authority bypasses reject. |
| R1 native fixed runtime / AC-4 | FAIL | Public isolated config always records `ISOLATED_RUNTIME_UNAVAILABLE`; no public VM lifecycle. No native four-platform evidence. |
| R2 provider staging/cleanup | FAIL | Helper adapter and broker cleanup path exist, but helper cleanup receipt is not bound into the release-run task/journal/final cleanup authority; no real provider runtime evidence. |
| R3 firewall/request guard | FAIL | Closed signed-plan validation exists at helper boundary, but public isolated flow never invokes it and no real hostile/native enforcement evidence exists. |
| R4 secret broker | FAIL | Closed operation and negative schema tests exist; one-use exposure/revoke/crash behavior is delegated to an unavailable fixed broker and not deterministically proven. |
| R5 emergency stop/residue | FAIL | Live creation-nonce verification/order was added, but no real runtime order/residue evidence was available in this environment. |
| S1 trusted SSH / AC-2 | FAIL | Helper acquisition adapter exists; public SSH run unconditionally stops after acquire instead of importing/finalizing a snapshot. |
| S2 SSH cleanup/resume / AC-2 | FAIL | No completed trusted SSH run/zero-residue artifact; every SSH resume is unconditionally rejected. |
| P1 pair mismatch/replay/drift | FAIL | Implementation present, but no committed deterministic public-transition suite or real paired runs were available. |
| P2 cross-review binding | FAIL | Foreign digest/same-provider checks exist, but crash resume reconstructs time-dependent task bytes with a new clock and can fail drift instead of replaying admitted work. |
| V1 five human reviews | FAIL | Exact schema/signature/key/nonce checks exist, but no runnable deterministic suite or five real independent signed records were supplied. |
| A1 final authorization | FAIL | Certificate/key/digest validation exists, but no deterministic suite or real authorization/certificate set was supplied. |
| L1 release/tamper/atomicity | FAIL | Prepared-state recovery code exists, but remained untested; no signed authorized package exists. |
| C1 public launcher grammar / AC-9 | PASS | Both launchers: all four exact verbs reached the same typed preflight; pass-through attacks exited 64. Ten manual assertions passed. |
| C2 blocked public preflight | PASS | Eight exact operations across both launchers exited 78 with `PUBLIC_RELEASE_PREFLIGHT_BLOCKED`; no fixture/direct-provider/signing fallback. Runtime preflight exited 78 with Docker/release-assets/helper blockers. |
| E1 real external evidence / AC-2/4/9/10 | FAIL | No real Codex+Claude pair, trusted SSH, signed bundle, hostile credentialed target, five human records/final authority, or four native-platform certificates. Fixtures are not counted. |
| CI repository regression | FAIL | Focused host/provider suite **24/24 PASS**; host lint and shell parse PASS. `pnpm run ci` stopped at formatting; latest `pnpm format:check` lists five unformatted files. |

Selected brief criteria: **AC-2 FAIL, AC-4 FAIL, AC-8 FAIL, AC-9 FAIL, AC-10 FAIL**.

## Defects

### P7-PATH-16 — HIGH — Trusted SSH run/resume product path cannot complete

- Repro: invoke `run` with a valid SSH config and fully available acquisition helper, then attempt
  resume.
- Expected: send the exact registered `source.acquire` payload, admit/finalize a zero-residue
  canonical snapshot transfer, record full commit/source identity, and resume from the same helper
  journal binding.
- Actual: the helper-client wrapper constructs the closed acquisition payload, but
  `prepareNewRun` unconditionally throws `SSH_TRUSTED_SNAPSHOT_TRANSFER_UNAVAILABLE` even if
  acquisition succeeded; it never finalizes/imports the helper transfer. `revalidateResume`
  unconditionally rejects every non-local source.
- Owner: release/runtime integration.

### P7-PATH-17 — HIGH — Public isolated-runtime run path never invokes runtime controls

- Repro: invoke `run` with `runtime.mode:"isolated"` in a fully provisioned helper/Lima/broker
  installation.
- Expected: execute the fixed preflight/create/stage/compile/build/start/request-guard/secret/
  probe/collect/stop/destroy lifecycle, enforce firewall/resources, and persist cleanup/residue.
- Actual: `prepareNewRun` unconditionally appends `ISOLATED_RUNTIME_UNAVAILABLE` for every isolated
  config and proceeds with the static path. No helper VM, firewall, request-guard, secret, or
  runtime cleanup operation is called by public run/resume.
- Owner: release/runtime integration.

### P7-PATH-18 — HIGH — Helper cleanup receipt is not bound into release authority

- Repro: complete a production provider broker task and inspect the release-run task/journal,
  cleanup state, pair cleanup receipt set, and final authorization subjects.
- Expected: the exact helper cleanup receipt digest, fence, removed IDs, residue IDs, and preserved
  receipt IDs are admitted into run and pair authority; residue blocks resume/release.
- Actual: broker encodes a `helperCleanupReceipt`, but the release orchestrator does not bind it
  into its task/journal/final cleanup receipts. Final release can reason only over local cleanup
  metadata, not the helper-issued provider cleanup authority.
- Owner: release/runtime integration.

### P7-PATH-13 — HIGH — Cross-review crash replay reconstructs time-dependent task bytes

- Repro: crash after an `ADMITTED` cross-review entry is fsynced and restart pair after the
  original task deadline clock has advanced.
- Expected: resume the exact admitted envelope bytes/attempt/fence/nonce and helper idempotency.
- Actual: restart calls `createTask` using a new `createdAt`; `deadlineAt` changes, so the
  reconstructed envelope differs from the admitted digest and fails `CROSS_REVIEW_TASK_DRIFT`
  instead of reconciling/replaying the exact task.
- Owner: release/backend.

### P7-PATH-10 — MEDIUM — Reopened P7 operations lack operator documentation

- Repro: search operator/customer docs for pair/review/authorize/release, helper installation,
  trusted SSH registration, authorities/certificates, and recovery.
- Expected: complete AC-10 procedures.
- Actual: no complete procedure; runtime README still describes only the original launcher verbs.
- Owner: release/docs.

### P7-PATH-19 — MEDIUM — Current full CI fails formatting

- Repro: `pnpm run ci` or `pnpm format:check`.
- Expected: clean full pipeline.
- Actual: formatting fails on five current files:
  `release/host-helper-config.schema.json`, `host-helper-protocol.mjs`,
  `host-helper-service.mjs`, `production-installation-config.mjs`, and
  `public-release-transition.mjs`. No later CI stages run.
- Owner: integration/devops.

### Resolved during this QA pass

The following early defects were fixed and rechecked before this report closed: merged fixed
drivers, service crash reconciliation, production release dependency loader, fresh bound-run
revalidation, review/authorization key digest independence, pair transition locking/path
confinement, duplicate frame decode, production broker selection, helper maintenance CLI,
client/server peer credential and socket ownership, live emergency-stop nonce verification, and
prepared release-sidecar recovery. These are not counted as open defects.

## Coverage notes

Deterministic coverage is strong for the framed helper and existing provider broker (**24/24**),
but there is no committed deterministic suite for the new public transition. Pair/review/
authorize/release signature, concurrency, tamper, expiry, certificate, and crash cases therefore
remain FAIL even where code exists. Actual fixed runtime/firewall/secret/SSH enforcement is also
not available here. No fixture is counted as a real provider, SSH, platform, human, or release
artifact.

## Verdict

**NEEDS FIXES / CUSTOMER RELEASE NO-GO.**

Open implementation defects: **4 High, 2 Medium**. The High blockers are trusted SSH completion/
resume, public isolated-runtime orchestration, helper cleanup-receipt binding, and deterministic
cross-review crash replay. The Medium blockers are reopened-path documentation and failing CI
formatting.

External evidence blockers remain independently release-blocking: signed release/tool/image/SBOM/
provenance/vulnerability authorities, real authenticated Codex and Claude runs, trusted SSH,
hostile credentialed target exercises, native Linux ARM64/x86-64 and macOS ARM64/x86-64 evidence,
five independent human reviews, final customer authorization, and release sign-off.

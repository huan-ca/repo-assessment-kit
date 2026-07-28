# P5 runtime and agent-adapter QA — final re-verification

Date: 2026-07-28 UTC  
Scope: `packages/runtime/**`, `packages/agent-adapters/**`,
`container/provider-task.mjs`, and the executable provider/native gates. Product code was
read-only during QA.

## Verdict

**NEEDS FIXES / RELEASE BLOCKED.**

The deterministic fixes for **RTA-001, RTA-002, and RTA-003 pass re-verification**.
The typed container half of **RTA-004 passes**, but AC-9 still fails because both public
launchers refuse `run` pending the P5 task broker. Native Lima/request-guard/broker and real
pinned Codex/Claude containment remain **BLOCKED** and are explicit safety §18–19 release
blockers.

No new product defect was found in the corrected deterministic runtime/adapter boundary.
No tests or product files were added or modified by QA.

## Final RTA status

| Defect | Final status | Evidence |
|---|---|---|
| RTA-001 — unsafe runtime models accepted | **PASS / FIX VERIFIED** | All three original adversarial candidates now return `accepted:false` with specific reason codes. Focused tests cover the same cases plus excessive per-service resources. |
| RTA-002 — post-admission signed-envelope mutation dispatched | **PASS / FIX VERIFIED** | Admitted envelope and nested controls are deeply frozen. A cloned-and-mutated envelope is reverified and rejected before broker invocation. Exact canonical bytes, signature/key, full identity/authority, expiry, and durable admission are compared at dispatch. |
| RTA-003 — absolute dynamic-control ceilings absent | **PASS / FIX VERIFIED** | The original 501-request/rate-999/wall-99999/redirect-999 fixture returns `CONTROL_PLAN_POLICY` even when the supplied release catalog repeats those values. |
| RTA-004 — production runner not typed / AC-9 unavailable | **PARTIAL: typed seam PASS; AC-9 FAIL** | Container schema and runner consume the same typed capsule and reject prompt-only/hostile requests. However, `./start-codex.sh run` and `./start-cc.sh run` both still exit 78, so neither required end-to-end dry run exists. |

## Commands and results

### Focused type/build/tests

```sh
pnpm --filter @rak/runtime typecheck
pnpm --filter @rak/agent-adapters typecheck
pnpm exec vitest run \
  packages/runtime/control-plan.test.ts \
  packages/agent-adapters/adapter.test.ts
node --test container/provider-task.test.mjs
pnpm --filter @rak/runtime build
pnpm --filter @rak/agent-adapters build
```

Result: **PASS**, all exit 0.

```text
Vitest: 2 files passed, 24 tests passed
Container runner: 7 tests passed, 0 failed
```

The container tests prove:

- both providers admit the same typed `AgentTaskCapsule`;
- fixed fail-closed flags and capsule-on-stdin;
- obsolete prompt-only capsules, unknown fields, and arbitrary commands rejected;
- provider mismatch, unattested inference, permission bypass, source, SSH, state, kit,
  generated tree, helper, runtime, arbitrary network, and output bypass rejected;
- source paths/non-allowlisted evidence rejected;
- output schema/acceptance-check contract cannot be omitted or structurally expanded;
- provider entrypoint exposes only broker-owned verbs and no arbitrary flags.

### Whole-repository regression gates

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

Result: **PASS**, all exit 0.

```text
Typecheck: all workspace projects passed
Tests: 13 files passed, 112 Vitest tests passed
Container runner: 7 tests passed
Build: all workspace projects passed
Smoke: foundation smoke assertions passed
Smoke: provider, acquisition, network, and native-gate boundaries verified
```

### RTA-001 original adversarial reproducer

The exact prior candidates were submitted to built `validateRuntimePolicy`:

1. root user + custom DNS + unsafe sysctl + `PROD_TOKEN` environment + external macvlan;
2. inline Dockerfile with `USER root` and remote `ADD`;
3. one million replicas + unknown isolation-affecting field.

Observed:

```text
root_user_custom_dns_sysctl_external_network
  accepted:false
  CREDENTIAL_ENVIRONMENT_FORBIDDEN,CUSTOM_DNS_FORBIDDEN,
  CUSTOM_NETWORK_DRIVER_FORBIDDEN,EXTERNAL_NETWORK_FORBIDDEN,
  ROOT_OR_NON_NUMERIC_USER_FORBIDDEN,UNSAFE_SYSCTL_FORBIDDEN

unsafe_build_controls
  accepted:false
  REMOTE_DOCKERFILE_ADD_FORBIDDEN,ROOT_USER_FORBIDDEN

unlimited_replica_and_unknown_field
  accepted:false
  REPLICA_LIMIT_EXCEEDED,UNKNOWN_ISOLATION_FIELD

unexpected_acceptances=0
```

The validator now uses closed top-level/service/build/resource/network key sets, rejects
target isolation overrides, checks Dockerfile instructions, enforces non-root numeric users
and resource ceilings, and deeply freezes accepted normalized models.

### RTA-002 original mutation reproducer

Reproduction:

1. Create, sign, verify, and admit a plan whose route is `/safe`.
2. Attempt to assign `/mutated-after-admission` to the admitted control.
3. Dispatch using current authority and pinned verification keys.
4. Separately, the focused suite clones the envelope, mutates the clone, and asserts the
   broker is not called.

Observed for the original direct-mutation path:

```json
{
  "mutationRejected": true,
  "frozen": true,
  "brokerCalled": true,
  "dispatchedRoute": "/safe"
}
```

The broker call is correct because only the still-valid `/safe` envelope is dispatched.
The cloned mutation case passes with `brokerCalled === false`.

Implementation evidence:

- admission deep-clones and deep-freezes the verified envelope;
- durable admission stores canonical payload bytes, signature/key, expiry, run/runtime/
  creation nonce/attempt/fence/snapshot/compiled plan/profile/approval/authority/origin/
  probe/nonce identities;
- dispatch re-runs signature and current-authority verification and compares the full
  durable binding before calling the broker;
- reconciliation compares the expanded binding and rejects expired admission.

### RTA-003 original oversized-budget reproducer

Original payload/catalog values:

```json
{
  "requests": 501,
  "bytes": "999999999999999999999",
  "requestsPerSecond": 999,
  "wallSeconds": 99999,
  "redirects": 999
}
```

Observed:

```json
{
  "rejected": true,
  "code": "CONTROL_PLAN_POLICY",
  "message": "Control budget exceeds release-wide safety maxima."
}
```

The fixed ceilings are 500 requests, 1 MiB per-control bytes, 2 requests/second,
1800 seconds, and 5 redirects.

### RTA-004 typed container runner and executable gates

The current provider runner and JSON schema now use:

```text
provider-task-envelope/1.0.0
  provider
  typed AgentTaskCapsule
  requestedCapabilities
```

They no longer accept `{schemaVersion, taskId, prompt}`. Codex and Claude receive the same
typed capsule on stdin, with provider-specific fixed permission flags. Deterministic
container tests pass.

Executable gate:

```sh
./start-codex.sh run
./start-cc.sh run
./scripts/runtime-capability.sh --require-available
```

Observed:

```text
run requires the P5 task broker; direct provider execution is refused
run requires the P5 task broker; direct provider execution is refused
{"status":"blocked","reason":"Lima is not installed on the host"}
codex_run_exit=78 claude_run_exit=78 native_runtime_exit=1
```

Only an unpinned local `codex` executable is present. `claude`, `limactl`, and `docker` are
unavailable. The refusal is the correct fail-closed behavior, but it does not satisfy
brief AC-9.

### Private signer material scan

```sh
rg -n \
  "BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY|privateKey|signingKey" \
  packages/runtime packages/agent-adapters container scripts .env.example release
```

Result: **PASS**. Private-key generation/use appears only in
`packages/runtime/control-plan.test.ts`. Production sources contain signer/key identifiers
and public verification interfaces, not private key material.

## Acceptance matrix

| Acceptance / safety check | Status | Evidence |
|---|---|---|
| Runtime capability gate blocks unsafe/unavailable dynamic work and continues static assessment | PASS (deterministic) | Focused runtime test plus native gate blocked reason. |
| Unsafe Compose/build/runtime candidates rejected | PASS for corrected deterministic validator | Original hostile fixtures and focused tests pass. Full native compiler/build proof remains BLOCKED. |
| Missing production signer/native broker fail closed | PASS (deterministic) | `CONTROL_PLAN_SIGNER_UNAVAILABLE` and `NATIVE_BROKER_UNAVAILABLE`; no fallback. |
| Canonical digest, Ed25519 domain/signature/key ID | PASS (deterministic) | Altered bytes/wrong key/unknown key/digest mismatch tests pass. Production signer attestation remains BLOCKED. |
| Full run/runtime/nonce/attempt/fence/snapshot/compiled-plan/origin/profile/approval/budget binding | PASS (deterministic) | Current-authority verification plus expanded durable admission and reconciliation comparisons. |
| Altered bytes, ID swap, replay, stale/expired authority, origin drift, expansion | PASS (deterministic) | Focused suite and original reproducers pass. |
| Revoke/reconcile/restart and dispatch without admission | PASS (deterministic) | Revoked/missing admission cannot dispatch; exact identity reattaches; mismatch/expiry revokes. Durable native crash/fsync proof remains BLOCKED. |
| Codex/Claude share typed capsule and acceptance path | PASS (deterministic and container seam) | Adapter and container tests pass for both providers. |
| Bypass/source/SSH/state/kit/generated/helper/runtime/network/unattested/mismatched-provider denial | PASS (deterministic and container seam) | All hostile request rows reject before provider execution. |
| Real provider OS/network/MCP/credential containment | BLOCKED | Pinned images/providers and provider inference gateway unavailable. |
| AC-4 isolated safe fixture launch and request-guard controls | BLOCKED | Lima/Docker/native broker/request guard/browser unavailable. |
| AC-9 both launchers complete equivalent dry runs and validated ZIPs | **FAIL** | Both launchers exit 78 pending the task broker. |

## Remaining defects and blockers

### RTA-004 — High — AC-9 executable provider workflow is still unavailable

Likely owner: workflow/agent-adapters/devops.

Repro:

```sh
./start-codex.sh run
./start-cc.sh run
```

Expected: each completes the documented end-to-end dry run through the typed broker seam
and produces a package accepted by the common suite.

Actual: each exits 78 because the public launcher still has no P5 task-broker path.

The prompt-only container defect is fixed; this remaining defect is executable integration
and end-to-end acceptance.

### Native/real-provider release blocker

Likely owner: runtime/devops and agent-adapters/devops.

Safety §18–19 requires native four-host Lima/rootless/cgroup/firewall/request-guard/
emergency-stop/residue evidence and both real pinned provider images. None is available in
this environment. Deterministic mocks and source inspection do not prove these physical
boundaries.

## Coverage notes

Verified:

- corrected policy rejection and resource ceilings;
- immutable signed-envelope admission;
- dispatch-time canonical/signature/current-authority/full-admission verification;
- replay, expiry, revoke, reconciliation, and result-swap behavior;
- absolute dynamic-control ceilings;
- typed package/container capsule parity;
- all requested provider compartment denials;
- focused and whole-repository type/build/test/smoke gates.

Not verified:

- host-helper signer socket mode and real provisioned key;
- native durable journal fsync/crash recovery;
- Lima/rootless Docker/cgroup/firewall/request guard;
- redirect, WebSocket, service worker, raw socket, or compromised-browser physical bypass;
- P0–P3 real positive probes and PX real rejection;
- emergency stop and residue cleanup;
- real pinned Codex and Claude credentials/homes/network/MCP containment;
- end-to-end package equivalence through both launchers.

Those gaps remain release blockers, not silent passes.

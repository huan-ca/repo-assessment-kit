# P5 QA — provider runner and task-capsule integration (final re-verification)

Date: 2026-07-28 UTC  
Scope: `container/provider-task.mjs`, `container/task-capsule.schema.json`,
`container/provider-task.test.mjs`, provider entrypoint/public launcher interaction,
`packages/agent-adapters`, and prior defects P5PR-001 through P5PR-004.

## Verdict

**Scoped deterministic remediation: PASS. Product release: BLOCKED / NO-GO.**

P5PR-001, P5PR-002, P5PR-003, and P5PR-004 no longer reproduce. The implementation now has:

- one typed provider task envelope for both providers;
- matching release-owned output-schema and acceptance-check IDs;
- matching strict runner/adapter validation;
- one canonical fixed flag source checked against the executable runner;
- a typed brokered executor seam that validates the closed proposal receipt, normalizes provider
  output, applies proposal acceptance, and returns a normalized `AgentOutcome`; and
- process-group wall/deadline termination that passes both the new focused tests and the exact prior
  adversarial harness.

Release remains **BLOCKED** because neither real pinned provider image, signed provider-egress
network, physical compartment, nor AC-9 end-to-end dry run was available. Public `run`, `resume`,
and `interactive` correctly remain exit 78 until a trusted broker invokes the private `task`
entrypoint. Safety §19 does not permit mock/unit evidence to substitute for real-provider
containment.

No product code was changed. Transient runtime evidence remains under
`.agent-build/artifacts/p5-provider-runner/`.

## Commands and observed results

### Focused build and tests

```sh
pnpm --filter @rak/agent-adapters typecheck
pnpm exec vitest run packages/agent-adapters/adapter.test.ts
node --test container/provider-task.test.mjs
```

Result: **PASS**.

```text
agent-adapters typecheck: exit 0
adapter tests:             13 passed / 13
container runner tests:    10 passed / 10
```

The container suite includes canonical flag/ID comparison and full descendant process-group wall
and deadline tests.

### Exact prior runtime probe

```sh
node .agent-build/artifacts/p5-provider-runner/probe-runtime.mjs
```

Result:

```text
stdin-and-unvalidated-output:
  exit 0 in 32 ms; raw outbox contains "not-a-valid-proposal\n"
stdout-output-budget:
  exit 1 in 27 ms; "provider output exceeded the admitted task budget"; no outbox
wall-timeout:
  exit 1 in 1031 ms; "provider exceeded the admitted task time budget"
deadline-timeout:
  exit 1 in 505 ms; "provider exceeded the admitted task time budget"
expired-before-spawn:
  exit 1 in 24 ms; "task deadline has expired"; no outbox
```

The same probe previously took about 5 seconds for both timeouts. It now terminates the process
group and closes held stdio at the admitted boundary. Raw provider stdout remains intentionally
untrusted; the brokered executor seam below rejects it unless it normalizes and passes the shared
proposal validator.

### Hostile runner/adapter parity matrix

The same values were independently passed to `validateProviderTaskEnvelope` and
`validateTaskCapsule` after rebuilding adapter output.

```text
case                         executable runner   typed adapter
unregistered acceptance ID  REJECT              REJECT
duplicate acceptance ID     REJECT              REJECT
unregistered output schema  REJECT              REJECT
empty evidence-view ID      REJECT              REJECT
nested run context           REJECT              REJECT
invalid evidence media type  REJECT              REJECT
invalid sensitivity          REJECT              REJECT
non-boolean truncated        REJECT              REJECT
fractional byte length       REJECT              REJECT
empty source locator         REJECT              REJECT
permissionBypass="false"     REJECT              REJECT / CAPABILITY_VALUE_INVALID
permissionBypass=1           REJECT              REJECT / CAPABILITY_VALUE_INVALID
permissionBypass=null        REJECT              REJECT / CAPABILITY_VALUE_INVALID
```

The earlier semantic divergence no longer reproduces. The focused suites additionally reject
unknown fields, obsolete prompt capsules, provider/inference mismatch, unattested inference,
permission bypass, source/SSH/state/kit/generated/helper/runtime access, arbitrary network,
non-outbox output, arbitrary commands, source paths, and non-allowlisted evidence.

### Canonical provider flags and registered IDs

Direct comparison of `buildProviderLaunchPlan` with `providerCliSpecs`:

```text
codex parity: true
  exec --sandbox workspace-write --ask-for-approval never --json -
claude-code parity: true
  -p --permission-mode dontAsk --output-format stream-json --verbose
  --strict-mcp-config --tools ""
registered acceptance IDs:
  material-claims-cited
registered output schema IDs:
  rak-agent-proposal/1.0.0
```

The adapter and executable runner now use identical flags and release-owned contract IDs.

### Typed executor proposal/outcome seam

A direct two-provider probe used `createBrokeredProviderExecutor` with:

- an exact typed task envelope and canonical flags;
- a closed `provider-proposal` receipt whose byte length and SHA-256 matched its bytes;
- a provider event normalizer;
- the shared `material-claims-cited` acceptance catalog; and
- both valid and non-allowlisted-evidence proposals.

Observed:

```json
{"provider":"codex","validOutcome":"succeeded","receipt":"provider-proposal","invalidOutcome":"contract-invalid","invalidLimitations":["PROPOSAL_ACCEPTANCE_FAILED"]}
{"provider":"claude-code","validOutcome":"succeeded","receipt":"provider-proposal","invalidOutcome":"contract-invalid","invalidLimitations":["PROPOSAL_ACCEPTANCE_FAILED"]}
```

Focused adapter tests also reject tampered proposal receipt digests with
`PROPOSAL_RECEIPT_INVALID`.

### Entrypoint, launcher, and signer-material checks

```sh
for verb in run resume interactive; do
  ./start-codex.sh "$verb"
  ./start-cc.sh "$verb"
done
```

All six invocations returned exit 78. `provider-entrypoint.sh` continues to accept only exact
two-argument `login`, `status`, or broker-owned `task` combinations.

```sh
rg -n --hidden -i \
  "BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY|private[_ -]?key|signing[_ -]?key|signer[_ -]?secret" \
  container packages/agent-adapters scripts release .env.example
```

No signer private key/material was found. Matches were acquisition path handling and documentation
that explicitly says the network-attestor private key is absent.

## Acceptance matrix

| Criterion / check | Status | Evidence |
|---|---|---|
| Strict unknown-field/provider/obsolete-prompt denial | **PASS** | 10/10 runner tests and direct hostile matrix. |
| Unattested/wrong-destination provider inference rejected | **PASS (contract)** | Runner and adapter reject; physical signed egress enforcement remains **BLOCKED**. |
| Bypass/source/SSH/state/kit/generated/helper/runtime/arbitrary-network/non-outbox denial | **PASS (contract)** | Runner hostile suite and adapter parity suite pass. Physical containment remains **BLOCKED**. |
| Same typed capsule semantics for Codex and Claude | **PASS** | Both use the same envelope/capsule schema, registered IDs, validation, stdin shape, and executor acceptance. |
| Release-owned output schema and acceptance IDs cannot be expanded | **PASS** | Both seams reject unregistered IDs; JSON Schema and canonical exported IDs agree. |
| Canonical fixed fail-closed provider flags | **PASS** | Direct equality is true for both providers; container test asserts exported spec parity. |
| Typed brokered proposal/receipt/acceptance/outcome seam | **PASS (deterministic)** | Valid receipt/proposal succeeds for both; bad evidence becomes `contract-invalid`; bad digest test rejects. |
| Stdout budget | **PASS** | Exact prior probe rejects 2 bytes against a 1-byte budget and creates no outbox. |
| Expired deadline before spawn | **PASS** | Exact prior probe rejects in 24 ms with no outbox. |
| Wall/deadline process-tree budgets | **PASS** | Exact prior probe returns near 1031/505 ms; focused descendant tests pass. |
| Stdin transport | **PASS** | Captured stdin is the complete five-field typed `AgentTaskCapsule`, not a prompt-only input. |
| Entrypoint exposes no arbitrary provider flags | **PASS** | Exact arity and private `task` verb tests pass. |
| Public unbrokered launchers remain refused | **PASS** | Codex/Claude `run`, `resume`, and `interactive` all exit 78. |
| No signer private material in provider sources/images | **PASS (static)** | Targeted scan found none; Docker context exclusions remain present. |
| AC-9 real equivalent Codex/Claude dry runs and ZIPs | **BLOCKED / FAIL for release** | No trusted broker transport deployment, real provider images, or end-to-end output packages were available. |
| Real provider filesystem/network/MCP/credential containment | **BLOCKED** | No Docker/Claude/signed provider network and no real hostile provider run. |

## Prior defect re-verification

### P5PR-001 — production executor/broker integration absent

**RESOLVED for the typed deterministic seam; end-to-end deployment BLOCKED.**

`createBrokeredProviderExecutor` now validates the task envelope and launch plan, calls a typed
`ProviderRunnerTransport`, checks receipt metadata/digest/byte limit, normalizes provider bytes,
applies `validateAgentProposal`, and maps results through the adapters to `AgentOutcome`. Both
providers pass valid and invalid-proposal probes. A real broker transport/container deployment was
not available and is not claimed.

### P5PR-002 — adapter validation differs from runner

**RESOLVED.**

Every prior divergent mutation now rejects at both seams. Non-boolean denied capability values
produce `CAPABILITY_VALUE_INVALID`; acceptance and output schema IDs must be in the frozen exported
registries.

### P5PR-003 — wall/deadline termination misses descendants

**RESOLVED.**

The runner now spawns a detached process group, signals the group, destroys stdio, and performs a
bounded forced group kill. The exact old harness improved from approximately 5 seconds to 1031 ms
for a 1-second wall and 505 ms for a 0.5-second deadline. The new descendant tests pass.

### P5PR-004 — adapter and runner use different CLI flags

**RESOLVED.**

`providerCliSpecs` is the adapter source of truth; the container suite asserts its executable
plans match those exact arrays. Direct comparison passed for both providers.

## Open defects

No deterministic product defect was reproduced in this focused re-verification.

## Coverage notes

- Covered: strict schema/contract rejection, hostile requested capabilities, typed envelope and
  stdin, frozen IDs, canonical flags, executor receipt/digest/normalization/acceptance/outcome seam,
  output budget, expired deadline, descendant wall/deadline behavior, entrypoint and launcher
  refusal, and static private-material absence.
- Not covered: real signed broker transport, immutable task mount and outbox permissions in a live
  container, provider authentication/home separation, signed egress/firewall identity, filesystem
  canaries, MCP/tool/child-network denial, real Codex/Claude event formats, cancellation under a
  live provider, image SBOM/provenance, or AC-9 package equivalence.
- The runtime harness relocates only the hard-coded `/run/rak` paths because the QA user cannot
  create that root-owned directory. The focused suite additionally tests exported
  `executeProviderPlan` directly with real descendant processes.

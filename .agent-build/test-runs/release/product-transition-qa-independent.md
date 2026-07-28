# Independent QA — P7 public product transition

Date: 2026-07-28 UTC  
Scope: reopened public `pair` / `review` / `authorize` / `release` transition only  
Frozen sources: `brief.md` AC-8/9/10, `production-release-contract.md`,
`release-contract.md`, architecture §7.4, safety §§14.4–14.5 and 19.

## Verdict

**NEEDS FIXES / NO-GO.**

The updated implementation passes the closed launcher, injected-authority, signed-review,
five-kind, final-key separation, unresolved-High, concurrent-admission, ZIP no-follow, and
two-phase sidecar checks exercised below. It does not yet prove or provide a complete,
recoverable real production pair transition. One High release blocker remains:

1. no executable real-provider transition was possible, and the persisted cross-review
   envelope has no demonstrated registered byte handoff to the fixed production broker.

Per the assigned rule, any High implementation issue makes the verdict a failure.

## Acceptance matrix

| Contract / acceptance check | Result | Evidence and reproduction |
|---|---|---|
| Both launchers expose identical closed pair/review/authorize/release argv | **PASS** | Both `./start-codex.sh` and `./start-cc.sh` accepted each exact verb shape. An added `--extra x` on `release` returned usage and exit 64 on both. |
| Public paths are confined to generated and production prerequisites are fail-closed | **PASS (blocked-path only)** | With `/etc/repo-assessment-kit/host-helper.json` absent, all eight exact launcher/verb combinations returned exit 78 and `PUBLIC_RELEASE_PREFLIGHT_BLOCKED`, specifically requiring the root-owned mode-0400 config. No path or provider effect occurred. Success path could not be exercised. |
| Production rejects injected/self fixture authorities | **PASS** | Harness called the exported constructor with injected production reviewer authority and received `PRODUCTION_DEPENDENCY_INJECTION_REJECTED`; explicit `fixture-test-only` remained available only in process. |
| One-use review admission is serialized | **PASS** | Two concurrent admissions of the same signed review produced exactly one fulfillment and one `PAIR_TRANSITION_BUSY`. |
| Signed review strict schema, kind-key mapping, and time window | **PASS** | Unknown member → `RECORD_SCHEMA_INVALID`; correct key used for a different review kind → `SIGNING_KEY_UNTRUSTED`; expired record → `SIGNED_RECORD_TIME_INVALID`. |
| Exactly five distinct review kinds, record/reviewer/key/key-digest/nonce identities | **PASS in exercised fixture transition** | Five separately signed kinds admitted; code rejects duplicate kind, record ID, reviewer ID, signing key ID, public-key digest, or nonce before write. Positive authorization proceeded only after all five were present. |
| Final authorization key ID and public-key digest differ from all review keys | **PASS** | Authorization with the same key ID but a different public key was rejected `AUTHORIZATION_KEY_NOT_INDEPENDENT`; a distinct ID/key authorization was admitted as `authorization-distinct`. Production configuration also rejects a duplicate ID. |
| Critical/High unresolved boundary defects reject authorization | **PASS** | Exact valid authorization with `{defectId,severity:"High",state:"open"}` authority was rejected `UNRESOLVED_BOUNDARY_DEFECT`; clearing the unresolved defect allowed the positive authorization. |
| Exact authorization/certificate set, four platforms, per-kind keys, cleanup and optional SSH | **PASS by code/harness, production artifacts unavailable** | Positive fixture authorization supplied the exact closed set, four distinct platform kinds, two provider-specific cleanup subjects, exact review digests, and distinct certificate nonces/IDs. Current validators bind per-kind configured subjects/keys. No real signed platform/provider/SSH certificate inventory was installed to prove the production case. |
| Real production broker performs fresh cross-provider review with exact envelope/proposal/receipt bindings | **FAIL** | No root-owned production installation, authenticated provider homes, fixed broker, or two eligible terminal provider runs exist. More importantly, product code persists envelope bytes under the pair, but `provider.stage` sends only `jobId` and digests; the fixed helper driver receives no bytes, path, pair ID, or registered task handle. Repo search found no production registration/handoff mapping for that pair file. See Defect H-1. |
| Pair claim is durable before provider effects; retry is idempotent | **PASS with residual PID-reuse risk** | Pair index/journal and each cross-review `ADMITTED` entry are fsynced before broker call; missing task files are reconstructed only when their exact admitted digests match; completed proposals resume without a new provider effect. Concurrent duplicate admission produced one success/one busy. Dead-PID locks recover automatically. The lock does not bind process start identity, so PID reuse can cause a false live-owner decision; tracked as a non-blocking residual risk. |
| Fresh release revalidates source runs and architecture §7.4 input bindings | **PASS by implementation** | `loadTerminalRun` fresh-loads the journal, receipt, draft ZIP, proposal files, and input binding; independently verifies snapshot bytes against the admitted manifest; and recaptures local-source identity to compare payload digest and manifest. The same path runs again during final release. |
| Release validates immutable successor ZIP and never relabels it | **PASS by implementation; final production flow blocked** | Release uses held `O_NOFOLLOW`, compares inode/size/mtime, reopens with expected successor run/snapshot IDs, checks ZIP digest, and writes only `customer-release-certificate.json`. No code writes the successor ZIP. |
| Review/authorization/release sidecar ↔ journal recovery | **PASS for implemented two-phase paths** | Review and authorization persist `pendingAdmission` before sidecar; release persists `CUSTOMER_RELEASE_PREPARED` and certificate digest before sidecar. Existing identical sidecars reconcile; conflicting sidecars fail closed. |
| AC-8 customer-ready real artifact completeness | **FAIL / not verifiable** | No authorized paired successor exists. The available self-assessment is a blocked Codex-only draft; no real production certificate sidecar can be created. |
| AC-9 Codex/Claude successful equivalent dry runs | **FAIL** | Available generated release run is Codex-only and its provider tasks are `provider-unavailable`; no eligible Claude terminal run exists. Public pair therefore cannot complete. |
| AC-10 release readiness / no deferred core capability | **FAIL** | Native four-platform/provider/SSH certificate authorities and production transition prerequisites are absent; H-1 remains a release blocker. |

## Defects

### H-1 — No demonstrated task-byte handoff to the real production cross-review broker

Severity: **High**  
Likely owner: runtime/helper + transition

Reproduction:

1. Inspect `createCrossReviews`: it writes the canonical envelope to
   `pair/internal/cross-review-tasks/<jobId>.json` and records its digests.
2. Inspect production `reviewer.runReview`: `provider.stage` receives only
   `jobId`, provider, `envelopeDigest`, `taskBytesDigest`, schema digest, and
   provider-home digest.
3. Inspect `host-helper-operations.mjs`: the fixed driver is invoked with the
   authenticated operation payload; that payload has no envelope bytes, path,
   pair ID, or registered opaque task-file handle.
4. Run `rg -n "taskBytesDigest|cross-review-tasks|provider.stage" scripts`.
   No registration that maps the production helper/broker to the persisted pair
   task file exists.
5. Attempt any exact public transition command in the current environment. It
   blocks before effects with `PUBLIC_RELEASE_PREFLIGHT_BLOCKED`; there is no
   installed fixed broker or real-provider result demonstrating an external
   handoff.

Expected: the production helper independently receives/locates one previously
registered immutable task object using an authenticated opaque ID, verifies its
bytes against both digests, and stages those exact bytes.

Actual: the product persists bytes in the unprivileged pair tree and sends only
digests. No executable repository-owned handoff from that file to the fixed
production broker is present or testable.

Impact: the public production pair path cannot demonstrate a real cross-provider
review; digest-only staging either blocks or relies on an unspecified external
capability.

## Test evidence and counts

Commands run:

```text
node --check scripts/public-release-transition.mjs
pnpm exec eslint scripts/public-release-transition.mjs scripts/provider-broker.mjs --max-warnings 0
pnpm test:release-seams
node .agent-build/artifacts/p7-product-transition-qa-independent/transition-adversarial.mjs
./start-{codex,cc}.sh <each exact transition verb and injected-extra negatives>
```

Results:

- syntax checks: 1/1 pass;
- focused lint: 1/1 pass;
- repository release-seam suite: 61/61 pass;
- independent signed-transition harness: 8/8 expected outcomes pass;
- public launcher exact/negative checks: 10/10 pass;
- real production pair/review/authorize/release successes: 0;
- total executed deterministic checks: 81, with 81 producing expected local
  outcomes; acceptance remains failed by the one unexercised/reproduced High
  transition defects.

Harness and transient sandboxes:

- `.agent-build/artifacts/p7-product-transition-qa-independent/transition-adversarial.mjs`
- `.agent-build/artifacts/p7-product-transition-qa-independent/sandbox-*`

## Coverage notes

Covered: launcher symmetry and closed argv; precise first missing prerequisite;
generated-path pre-effect blocking; fixture/production injection boundary; review
signature/schema/kind/expiry; five-review admission; concurrent one-use lock;
final key ID/digest separation; signed certificate shape and four-platform set;
unresolved High rejection; authorization two-phase persistence; release ZIP and
sidecar code path; existing 61 provider/snapshot/successor seam tests.

Not covered with real authority: successful host-helper socket transport, real
Codex/Claude provider sessions, fixed broker staging/execution, real platform
certificates, SSH acquisition certificate, actual authorized successor release,
and forced process-kill fault injection at every fsync boundary. These are
release-blocking gaps, not silent passes.

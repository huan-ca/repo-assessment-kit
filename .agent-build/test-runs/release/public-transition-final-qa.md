# P7 final QA lane B — public paired-provider/customer transition

Date: 2026-07-28 UTC  
Scope: public `pair` → opposite-provider cross-review → five signed human reviews →
authorization → immutable successor release sidecar, including public run/resume recovery
bindings.  
Verdict: **PRODUCT TRANSITION PASS; EXTERNAL RELEASE NO-GO**

## Acceptance matrix

| Criterion / contract check | Result | Evidence and exact reproduction |
|---|---|---|
| Real fixture path: one Codex run plus one Claude Code run, foreign-author cross-reviews, five review kinds, authorization, release | **PASS in fixture-test-only mode** | `tests/public-release-transition.test.ts` passes 15/15. The final test resumes a `PAIRING` journal, completes six opposite-provider review tasks, admits the five named human kinds, authorizes, resumes `CUSTOMER_RELEASE_PREPARED`, and reaches `CUSTOMER_RELEASE_AUTHORIZED`. Evidence: `focused-transition-reverify.txt`. |
| Production-mode end-to-end pair/review/authorize/release | **FAIL — external authorities unavailable** | All eight exact transition invocations across both launchers exit 78 with `PUBLIC_RELEASE_PREFLIGHT_BLOCKED`; `/etc/repo-assessment-kit/host-helper.json`, authenticated provider homes, fixed helper/broker, real signed certificate bundle, and eligible real Codex/Claude runs are unavailable. Evidence: `launcher-grammar-probe.txt`. This is not evidence of a product bypass, but AC-9/AC-10 remain unmet. |
| Public launcher grammar is identical and closed | **PASS** | QA probe passes 16/16: eight exact commands fail closed at production preflight, while extra flags, reordered flags, pass-through `--`, and a caller provider flag exit 64. Run `bash .agent-build/artifacts/p7-public-transition-final-qa/launcher-grammar-probe.sh`. |
| Public production dependency injection / fixture authority denial | **PASS** | Focused transition test rejects injected production reviewer/authority dependencies. Production configuration tests reject fixture IDs, embedded keys, duplicate authority identities, unsafe key metadata, and helper seam injection. |
| Cross-review is opposite-provider, foreign-author-digest bound, and same-provider review is insufficient | **PASS** | Focused transition E2E validates foreign author digest and fresh provider identity. Release seams pass same-provider rejection and exact review proposal binding. Evidence: `focused-transition-vitest.txt`, `release-seams-rerun.txt`. |
| Provider stage bytes, digest, deadline, attempt/fence/nonce, and replay are exact | **PASS** | Production transition sends canonical padded `taskBytesBase64`, `taskBytesDigest`, and the admitted deadline/budget; helper seams reject noncanonical/digest-mismatched bytes before effect; broker seams reject replay/stale fence and enforce timeout/deadline. Release seams: 113/113 pass. |
| Exactly five distinct current human reviews with exact kind/key/digest/nonce/record/reviewer bindings | **PASS** | Positive five-kind authorization passes; future, expired, rejected, wrong-successor-digest, and replay reviews fail. Production configuration rejects duplicated key IDs/digests and wrong kind mappings. |
| Authorization is distinct from all review keys and binds exact reviews, successor, reconciliation, input, certificates, subjects, SSH applicability, and cleanup | **PASS in deterministic fixture/config seams** | Positive complete authorization passes. Successor authority seams reject stale/mismatched/duplicate/unsigned records. Production config and transition validators enforce distinct key ID/public-key digest, exact per-kind certificate subject, four platform kinds, conditional SSH, and provider-specific cleanup receipt subjects. No real signed authority bundle was available. |
| Unresolved Critical/High defects block; unresolved Medium remains visible without blocking | **PASS** | Focused tests reject unresolved Critical and accept unresolved Medium. Production config tests reject unknown defect fields/enums and duplicate IDs. |
| Live and dead transition locks serialize/recover safely | **PASS after fix** | The unchanged immediate probe receives `PAIR_TRANSITION_BUSY` during the narrow incomplete-write grace. The updated independent probe then ages the same zero-byte lock beyond five seconds; recovery succeeds and exactly one review is admitted. Named-PID dead-owner recovery also passes. Run `node .agent-build/artifacts/p7-public-transition-final-qa/stale-lock-probe.mjs`; evidence: `stale-lock-probe-reverify-aged.txt`. Closed defect H-1. |
| `PAIRING` prepared-task recovery is idempotent | **PASS in fixture mode** | Focused E2E rewrites the completed pair to `PAIRING`, clears successor/reconciliation bindings, reruns `pair`, reuses completed exact-digest task journal/proposals, and reaches the same successor before human review. Shared helper seams also prove durable PREPARED replay. |
| Review/authorization prepared sidecar recovery | **PASS for review; authorization covered by shared two-phase implementation** | Focused test restores exact `pendingAdmission` plus review sidecar and admits once. Authorization uses the same pending digest/exclusive sidecar pattern and positive authorization passes. Conflicting bytes fail closed by code path; no forced-kill test exists at every fsync edge. |
| `CUSTOMER_RELEASE_PREPARED` sidecar recovery | **PASS** | Focused E2E prewrites exact prepared journal and exact certificate sidecar, then `release` revalidates and reaches `CUSTOMER_RELEASE_AUTHORIZED` without ZIP mutation. |
| Source/run/config/snapshot/proposal/ZIP drift blocks fresh release | **PASS across shared validators/seams** | Full Vitest covers strict duplicate/unknown config, output-root symlink, source byte drift, immutable snapshot drift, and package checksum tamper. Release seams cover successor ZIP tamper/self-relabel/duplicate JSON, proposal/evidence drift, SSH digest/manifest drift, and no-follow snapshot checks. |
| Isolated-runtime PREPARED journal is recoverable through public resume without repeating effects | **PASS after fix** | The original focused repro now passes: resume consumes the one durable runtime entry, calls the wrapper exactly once on recovery without repeating the recorded effect, completes runtime, and reaches the intentional `OFFLINE_RESUME_REQUIRES_SUCCESSOR` boundary. Evidence: `isolated-resume-reverify.txt`. Closed defect H-2. |
| Immutable successor remains a blocked draft; release writes only a digest-bound sidecar | **PASS in fixture mode** | Successor seams reject release-truth relabeling and overwrite; transition E2E verifies the successor digest is unchanged and only `customer-release-certificate.json` becomes authorized. |
| Zero provider/runtime/source cleanup residue before release | **PASS in deterministic seams** | Runtime, SSH, broker, successor, and transition tests reject or preserve residue; cleanup certificate subjects bind the two provider-specific receipt aggregates. Real helper cleanup receipts were unavailable. |
| AC-8 customer-ready paired package | **FAIL — no real authority** | Fixture package/sidecar is structurally valid, but there is no real authorized paired successor deliverable signed by the required human/customer/platform/provider authorities. |
| AC-9 both real providers and equivalent release outputs | **FAIL — no real authority** | No authenticated real Codex and Claude Code terminal runs or production cross-review executions were available. |
| AC-10 release readiness, recovery, and all platform gates | **FAIL — external evidence only** | Local product recovery checks pass. Linux ARM64/x86-64 and macOS ARM64/x86-64, real provider, SSH, customer, and final authority certificates remain unavailable. |

## Defects

### H-1 — CLOSED — Crash-created empty transition lock recovery

Original severity: **High (release-blocking availability/recovery)**  
Likely owner: backend/runtime transition

Reproduction:

1. Create an eligible blocked pair and a valid signed human review.
2. Create owner-private mode-0600 `.transition.lock` with zero bytes, modeling death after
   exclusive creation but before the owner record write.
3. Invoke `transition.review`.
4. Observe `PAIR_TRANSITION_BUSY` during the five-second incomplete-write grace.
5. Age the same lock beyond the grace and retry; observe successful recovery and one admission.

Automated repro:

```text
node .agent-build/artifacts/p7-public-transition-final-qa/stale-lock-probe.mjs
```

Expected: an unparseable/incomplete lock that can result from the implementation's own creation
window is safely identified as stale (using a durable owner token/atomic lock record protocol) and
recovered, or a bounded reconciliation mechanism makes progress.

Reverification: **PASS.** The implementation now protects a newly created incomplete lock for a
five-second grace, then safely reclaims an aged zero-byte owner-private lock. Independent probe
observed immediate `PAIR_TRANSITION_BUSY`, aged retry `SUCCESS`, and one admitted review. Evidence:
`stale-lock-probe-reverify-immediate.txt` and `stale-lock-probe-reverify-aged.txt`.

### H-2 — CLOSED — Isolated-runtime PREPARED recovery

Original severity: **High (release run/resume recovery)**  
Likely owner: backend/runtime orchestrator

Reproduction:

```text
pnpm exec vitest run tests/release-run.test.ts \
  -t "feeds existing isolated-runtime journal entries into public resume without repeating effects" \
  --reporter=verbose
```

Expected: resume recognizes the exact durable isolated-runtime entry, calls the runtime wrapper
with that entry, performs no duplicate effect, completes runtime, then stops at the intentional
`OFFLINE_RESUME_REQUIRES_SUCCESSOR` boundary.

Reverification: **PASS.** The recovery predicate now narrowly admits the exact isolated-runtime
crash state produced by failure finalization. The original focused test passes and verifies two
wrapper calls total, one external effect total, and the original completed journal entry supplied
to recovery. Evidence: `isolated-resume-reverify.txt`.

## Evidence counts

Final/superseding executions:

- full Vitest regression: **174 pass, 0 fail, 174 total**;
- release seam suite: **113 pass, 0 fail**, plus launcher closed-surface smoke pass
  (`full-test-final.txt`);
- independent launcher grammar/preflight probe: **16 pass, 0 fail**
  (`launcher-grammar-probe.txt`);
- independent aged stale-lock recovery probe: **1 pass, 0 fail**
  (`stale-lock-probe-reverify-aged.txt`).

Total non-duplicated final checks counted above: **305 pass, 0 fail, 305 total**.
The combined transition/release-run focus is **28/28 pass**
(`focused-transition-reverify.txt`) and is a subset, so it is not added again. Earlier failing
evidence is retained as the reproducible pre-fix baseline; the final full-suite and independent
reverification artifacts supersede it.

## Coverage notes

Covered deterministically: closed launcher grammar, production injection denial, exact production
configuration closure, opposite-provider and same-provider rules, canonical task byte transport,
deadline/budget/fence/nonce replay, five review kinds, key/digest/subject independence, unresolved
defects, certificate inventory, cleanup/SSH applicability, `PAIRING` recovery, review and release
sidecar recovery, source/snapshot/proposal/ZIP/config drift, immutable release truth, and residue
blocking.

Not covered with real external authority: installed root-owned helper/config/key files; peer
credential verification against the real service; authenticated Codex and Claude Code sessions;
real provider canary/equivalence certificates; trusted SSH acquisition against a real private
repository; native Linux ARM64/x86-64 and macOS ARM64/x86-64 certificates; five actual human
signers; customer acceptance; final release-authority signature. These are explicit P7 release
blockers, not product defects inferred from the local fixture.

Fault injection is not exhaustive at every fsync/rename boundary. The exercised zero-byte lock
creation window, isolated-runtime PREPARED transition, review prepared sidecar, and
customer-release prepared sidecar now pass.

## Verdict

**PRODUCT TRANSITION PASS; EXTERNAL RELEASE NO-GO.** Both High product defects are closed by
independent reproduction, the combined focus passes 28/28, and the final local suite passes
305/305 counted checks. Customer release remains blocked solely because the real provider, SSH,
four-platform, human/customer, and final release-authority evidence has not been installed and
exercised. Those unavailable authorities are not reclassified as product defects.

Evidence and QA-only probes are under
`.agent-build/artifacts/p7-public-transition-final-qa/`. No product files were edited.

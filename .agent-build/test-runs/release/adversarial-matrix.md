# P7 adversarial QA report

Date: 2026-07-28 UTC  
Target: `/workspace/rendervo-alt-3bcd18f5/targets/repo-assessment-kit`  
Scope: `.agent-build/brief.md` Must criteria, frozen specifications, P7 release contract, hostile
inputs, live loopback API/UI, package/report truth, and available release gates. Product code
remained read-only in this lane.

## Verdict

**P7 CUSTOMER RELEASE NO-GO / BLOCKED.**

Five Must criteria pass with reproducible deterministic and live evidence; five fail because a
mandatory real release gate remains. The candidate continues to label
all produced output `DRAFT_VALIDATED_RELEASE_BLOCKED` and
`customerReleaseAuthorized:false`, which is the correct fail-closed truth.

No injected broker, fake attestation, temporary mirror, fixture provider, parser-only probe, or
deterministic encryption test was counted as real Docker/Lima, SSH, provider, native-platform,
human-review, signed-asset, or customer-package evidence.

## Acceptance matrix

| Criterion | Result | Evidence and exact repro |
| --- | --- | --- |
| **AC-1 Guided discovery** | **PASS** | Real loopback traversal captured all ten topics and an explicit unknown with reason/confidence/coverage/follow-up; `browser-live/06`, `07`, `10` screenshots and `browser-live/observations.json`. The fresh offline package records both discovery unknowns and effects in `lay-final-reports.txt`. |
| **AC-2 Controlled intake and immutability** | **FAIL: real SSH gate** | Local frozen-working-tree intake is now integrated: proc-fd/`O_NOFOLLOW` capture, snapshot-only child analysis, Git/source-state journal binding, before/after identity verification, and no target mutation pass. The 113-entry self-assessment draft also passes. Real SSH acquisition, repository-scoped key/known-host handling, and cleanup were unavailable, so the criterion's separate SSH path remains unverified. |
| **AC-3 Complete static assessment** | **PASS** | Seven-ecosystem/offline suites and real draft package contain repository, stack, architecture, maintainability, feature, runtime-readiness, and distinct security outputs. Package/report validation is covered by final CI and `release-assets.md`; the 113-entry self-assessment draft completes without the earlier duplicate-evidence failure. |
| **AC-4 Safe runtime assessment** | **FAIL** | Static-only blocked-state truth and control accounting pass deterministic/live checks, but Docker/Lima, firewall/request guard, no-host-socket containment, hostile runnable fixture, sentinel endpoint, emergency stop, and residue could not be exercised. `preflight-current.json` fails closed. A mandatory real runnable-target path is unverified. |
| **AC-5 Evidence, coverage, validation, redaction** | **PASS** | Evidence/report/package suites reject missing references, manifest/checksum tamper, unsafe O1/O2 content, seeded AWS/private-key/SSH/host-path values, and enforce O3/O4 review gates. Fresh lay package gives a specific reason/effect/action for every non-pass domain. Evidence: baseline CI, release-assets focused logs, `lay-final-reports.txt`. |
| **AC-6 Modernization decision support** | **PASS** | Fresh independently opened draft compares repair, staged replacement, and rebuild on the same seven questions, states low confidence, assumptions/unknowns, reversal evidence, and the next owner decision without compliance claims or the earlier unsupported urgency. Evidence: `lay-final-command.txt`, `lay-final-reports.txt`. |
| **AC-7 Security baseline and overlays** | **PASS** | Deterministic analyzer/report suites apply the baseline, keep overlays distinguishable, cite deeper-profile signals, and avoid certification language. Independent security review confirms the typed contracts but separately blocks real release gates; `security-review.md`. |
| **AC-8 Customer-ready package** | **FAIL: real authority gate** | Draft ZIP/HTML/CSP/path/checksum/tamper/encryption validators pass, `generated/` is ignored, and fresh lay review passes. Closed task-specific author/reviewer profiles, exact author-digest binding, pinned schema bytes, and the successor builder pass: an actual injected broker completes 7/7 tasks and creates a validated blocked successor with zero quarantine. No real paired-provider, independently reviewed, signed customer ZIP exists; `verify-package.mjs` correctly rejects the available draft. |
| **AC-9 Cross-agent compatibility** | **FAIL: real provider gate** | Closed launchers and shared task-specific capsule/broker contracts pass; affected Node suites pass 50/50 and installed Codex 0.145.0 accepts its exact arguments. There is no real Codex or Claude authenticated brokered dry run and no pair of customer-ready ZIPs. Claude is unavailable. |
| **AC-10 Platform/docs/release readiness** | **FAIL** | Runbooks/examples/strict config validate and Linux ARM64 real `age` v1.3.1 encryption/recovery passes. Signed tool/image inventory reports 52 blockers. Linux x86-64 and both macOS architectures, real Docker/Lima, signed images, release signing, real providers/SSH, and final customer sign-off are absent. See `release-assets.md` and preflight evidence. |

## Adversarial control matrix

| Control | Result | Evidence |
| --- | --- | --- |
| Closed launcher verbs/arguments | **PASS after fix** | Unknown/extra/bare arguments fail 64; unsafe/missing paths fail typed 78; `preflight` is read-only. `launcher-recheck-1.txt`, `runtime-launcher-final.txt`. |
| Signed immutable provider image | **PASS contract / release asset BLOCKED** | Launcher consumes only closed `rak-verified-release/1.0.0` immutable references. Missing/unsigned assets fail closed. No legitimate signed bundle exists. |
| Strict config and SSH grammar | **PASS deterministic** | Duplicate/unknown fields, raw/static credentials, production targets, wildcards, optional destinations, userinfo/query/percent/option-like/local SSH forms reject. `release-config-negative.txt`, release-run 11/11. |
| Hostile source paths | **PASS integrated** | Snapshot and identity suite passes 11/11: swap races, outside symlinks, hardlinks, FIFO, collisions, mutation/restoration, output-inside-source, identity-only comparison, and zero-copy-residue checks. Release-run proves child analysis receives only the private snapshot and detects same-path dirty-byte drift. |
| Prompt/provider envelope attacks | **PASS deterministic** | Unknown/prompt-only capsules, provider mismatch, nonallowlisted evidence, arbitrary commands, bypass capabilities, altered admission, replay/stale fence all reject. |
| Provider proposal/stream contract | **PASS deterministic** | Codex JSONL and Claude stream JSON extract exactly one proposal. Closed task-specific author/reviewer shapes, role/task/profile/instruction binding, exact reviewer author digest, schema digest, secrets/host paths/active content/compliance checks, chunking, multiple/trailing/tool/error/binary/duplicate/identity attacks all pass. |
| Cancellation/timeout/cleanup/fence | **PASS deterministic** | Broker kills process groups and closes staging. Run/resume share a guarded finalizer that fences authority before fallible cleanup, rejects stale authority, records cancellation/residue, blocks residue resume, and preserves integrity terminals. Release-run 11/11 passes. |
| Output-root confinement | **PASS after fix** | Componentwise admission rejects a symlink parent without creating the external child; `output-root-symlink-recheck.txt`. |
| HTML/ZIP/tamper/encryption | **PASS deterministic; signed release BLOCKED** | Official schema/package tests, fresh-process reopen, CRC/manifest/checksum/tamper/recovery mismatch pass. Successor package passes 18/18 including active content, object bombs, secrets/host paths/compliance text, authority tamper, and exclusive finalization. Real ARM64 age encrypt/decrypt passes with pinned upstream binary but test-shaped, non-release authority. |
| Live secret mutation | **PASS after fix** | Fresh real loopback: secret handle POST 201, one-use PUT 204, input cleared, approvals PUT 200, review reached, no console errors. `live-fix-first.json/png`. |
| Live persistence/fixture truth | **PASS after fix** | Restart against same SQLite retains `browser-fix`; no `northstar-portal` or sample activity. `live-fix-restart.json/png`. |
| Responsive/accessibility | **PASS after fix** | 320/390/768/1280 have no overflow; fresh 200% probe is 1280/1280. Steady overview has labeled polite atomic status region. `live-fix-first.json`, `live-fix-overview.json`. |
| Loopback authority | **PASS after fix** | `/health/live` and `/health/ready`: canonical public Host 200; evil Host, evil Origin, and userinfo-shaped Host 403. `live-health-fix.txt`. |
| Generated exclusion | **PASS** | Exact `git check-ignore -v` probe resolves to `.gitignore`; `generated-ignore.txt`. |
| Self-assessment | **PASS as labeled mirror / target identity unavailable** | Because the target has no `HEAD`, a clearly labeled committed mirror was assessed. Immutable snapshot-only analysis completed, producing a validated 113-entry draft ZIP with verified manifest/journal/receipt and zero cleanup residue. Provider tasks remained truthfully limited. `self-assessment.md`. |
| Production dependency audit | **PASS after fix** | Ajv upgraded; `pnpm audit --prod --audit-level moderate` reports no known vulnerabilities. `audit-recheck.txt`. |

## Open defects

No unresolved Critical implementation defect was established on the frozen tree. The remaining
High items are release gates that fail closed.

### P7-SEC-04 — High release gate — trusted host/runtime enforcement is absent

Owner: runtime/provider integration.

The public production broker intentionally has no trusted attestation, staging, isolated-container,
session, firewall, request-guard, or emergency-stop capability in this checkout. Preflight exits
78 with typed `docker_unavailable`, `release_assets_unverified`, `lima_unavailable`, and
`provider_egress_not_configured` blockers. Injected seams prove only fail-closed contracts.

Expected before release: signed host authority, rootless Docker/Lima isolation, default-deny
firewall/request guard, secret broker, real cancellation/emergency stop, cleanup attestation, and
the hostile four-platform matrix.

### P7-SEC-05 — High release gate — signed release assets are absent

Owner: release assets/supply chain.

The toolchain declares release readiness unavailable. Legitimate signed manifest/key material,
staged multi-architecture binaries/images, complete SBOM/provenance/license evidence, and current
vulnerability scans are absent. Inventory-only verification reports 52 blockers. The launcher
correctly refuses mutable or unsigned substitutes.

### P7-SEC-06 — High release gate — real provider and SSH equivalence is absent

Owner: provider/acquisition integration.

No real Codex/Claude authenticated brokered task pair, exact-egress enforcement, provider-home
isolation, cancellation/cleanup dry run, or real SSH deploy-key/known-host/no-residue acquisition
was performed. The installed Codex parser and injected broker tests are not substitutes.

### P7-SEC-07 — High release gate — no public paired-provider/customer-release transition

Owner: release integration/reporting.

The single-run provider boundary is now closed and produces a safe validated blocked successor.
However, there is no public paired-run state machine binding distinct Codex and Claude run
identities, equivalent inputs, distinct-provider reviews, independent human records, the reopened
successor ZIP, and a separate final-digest authority. Same-provider reviews remain correctly
non-independent.

Expected before release: aggregate real paired provider runs under the frozen paired-run profile,
bind each reviewer to the admitted author digest, admit the required independent reviews, reopen
the successor, then require a separately signed final authorization.

### External customer-release gates

Owners: runtime, release assets, provider/acquisition, tech lead.

The Linux x86-64 and macOS ARM64/x86-64 matrices, credentialed hostile target/O1–O4 covert-output
review, signed-authority `age` customer package, technical/customer acceptance, and final release
certificate remain absent. These independently block AC-2, AC-4, AC-8, AC-9, and AC-10.

## Resolved defects reverified

| ID | Resolution evidence |
| --- | --- |
| P7-QA-001 launcher interface | Closed verbs/typed arguments and launcher smoke pass. |
| P7-QA-003 Codex unsupported flag | Exact installed Codex 0.145.0 parser accepts the fixed arguments. |
| P7-QA-004 mutable image identity | Signed verifier result and immutable reference are mandatory. |
| P7-QA-005 missing examples | All four examples exist; strict configs validate. |
| P7-QA-006 output symlink side effect | Rejected before external creation. |
| P7-QA-009 broker admission E2E gap | Release-run test now drives actual `createProviderBroker` through injected privileged seams; canonical digest/home/egress/staging/receipts/cleanup pass. |
| P7-QA-010 provider-home identity | Signed launcher/deployment home authority is bound and cannot be synthesized per run. |
| P7-QA-011 stream-to-proposal parsing | Provider-specific bounded extractors and hostile stream tests pass. |
| Generic-proposal portion of P7-SEC-07 | Closed task-specific author/reviewer profiles, exact author-digest binding, pinned schema digest, and actual-broker 7/7 integration now produce a validated blocked successor with zero quarantine; the paired-run/release transition remains open above. |
| P7-SEC-01 local worktree TOCTOU | Public local intake now uses proc-fd/`O_NOFOLLOW` capture, snapshot-only child analysis, repeated immutable verification, and final identity-only source comparison; snapshot 11/11 and release-run 11/11 pass. |
| P7-SEC-02 commit-vs-frozen helper mismatch | Dirty/untracked frozen bytes are captured and journal-bound by the integrated helper. The container's unsafe commit-only local fallback remains disabled. |
| P7-SEC-03 resume finalization | Run/resume share authority fencing and typed cleanup; cancellation, residue, stale authority, terminal monotonicity, and package/source drift tests pass. |
| P7-QA-012 duplicate evidence self-assessment | The current 113-entry self-assessment draft completes with verified manifest, journal, receipt, and zero residue. |
| Earlier stale lay-review finding | Fresh real offline package independently passes the previously failed lay checks. |
| P7-SEC-09 replay-ledger path confinement | Owner-private, no-symlink, installation-bound, exclusive/fsynced ledger tests pass. |
| Browser 412/fixture/zoom/live-region/health defects | Exact fresh live rechecks pass; evidence under `artifacts/p7-qa/live-fix-*`. |

## Coverage notes

- Available evidence covers Linux ARM64 deterministic suites, a real installed Codex argument
  parser, real Chromium loopback UI/API, and real pinned upstream ARM64 age encryption/recovery.
- It does not cover Docker/Lima containment, Linux x86-64, macOS ARM64/x86-64, Claude, provider
  login/inference, signed provider images, real SSH, external egress, credentialed hostile
  applications, native emergency stop, or a signed customer ZIP.
- The target itself has no Git `HEAD`; the self-assessment mirror is explicitly not the target
  identity.
- Final frozen `pnpm run ci` passes: 157/157 Vitest, 61/61 release-seam Node tests, formatting,
  lint, boundaries, types, fixtures, shell syntax, builds, and smoke checks.
- Focused final evidence: affected provider/broker/successor Node suites 50/50, release-run 11/11,
  immutable snapshot plus successor package 29/29, post-doc formatting pass, and production
  dependency audit with no known vulnerabilities.
- Transient evidence and scripts written by this lane are under
  `.agent-build/artifacts/p7-qa/`. QA reports are under `.agent-build/test-runs/release/`.

# Final independent P7 production-boundary QA

Date: 2026-07-28  
Scope: current post-fix helper protocol/configuration and request guard, signed release verifier
and fixed authority record, root installer/service definitions, provider boundary, SSH
acquisition/resume, isolated runtime recovery, public release transition, and repository CI.

## Verdict

### Product implementation: **PASS**

No Critical or High production helper/provider implementation defect was reproduced in the
current workspace. All three High defects from the preceding audit are fixed and independently
reverified:

- operation payload and nested result schemas now reject every retained adversarial probe;
- `vm.emergencyStop` now uses the frozen `{runtimeId,state,cleanup}` result shape;
- the distinct `releaseAuthorityDigest` is bound into the provider job, admission digest, journal,
  subprocess preflight, and helper validation.

The final full repository gate completed successfully: formatting, lint, boundaries, typecheck,
**174/174 Vitest**, **126/126 release-seam tests**, fixture verification, shell syntax, build,
foundation smoke, and security smoke all passed.

### External production release: **NO-GO pending real infrastructure evidence**

This Linux ARM64 container does not contain the mandatory root-installed signed host-helper
ceremony, real root/dedicated-client peer-verifier execution, production Lima/rootless runtime,
real provider accounts/canaries, repository-scoped SSH credential authority, or the required
four-platform native certificate matrix. The product correctly fails closed without them, but
fixture/static proof cannot be relabeled as production release evidence.

## Execution summary

| Check | Result | Evidence |
|---|---:|---|
| Retained independent adversarial helper probes | PASS, all 15 former unsafe acceptances rejected; frozen emergency shape accepted | `.agent-build/artifacts/p7-product-helper-qa-final/postfix-adversarial-probes.txt` |
| Focused helper/config/installer/verifier/runtime/SSH/provider Node suites | PASS, 83/83 | `postfix-focused-node.txt` |
| Focused request-guard/release/public-transition Vitest | PASS, 41/41 | `postfix-focused-vitest-rerun.txt` |
| Full `pnpm run ci` | PASS | `postfix-full-ci-final.txt` |
| Full Vitest within CI | PASS, 174/174 | `postfix-full-ci-final.txt` |
| Release seams within CI | PASS, 126/126 | `postfix-full-ci-final.txt` |
| Foundation and security smoke | PASS | `postfix-full-ci-final.txt`, `postfix-security-smoke.txt` |
| Public Codex/Claude preflight without installed authority | PASS, precise fail-closed | `preflight-codex.json`, `preflight-cc.json` |
| Public Codex/Claude SSH run on this host | BLOCKED as required; real integration unavailable | `public-ssh-codex.stderr`, `public-ssh-cc.stderr` |

## Acceptance matrix

| Contract / acceptance criterion | Status | Evidence and repro |
|---|---|---|
| Strict length framing, strict UTF-8/JSON, duplicate rejection, exact request/response envelopes, digest/MAC, expiry and replay protection | **PASS** | `host-helper-protocol.test.mjs` passes within both `postfix-focused-node.txt` and full CI. Retained MAC-valid adversarial requests are rejected. |
| Every fixed operation payload is typed before durable admission/effect | **PASS** | The retained probe now records `unsafeAccepted:false` for all 11 prior attacks. Product tests additionally cover valid-MAC type confusion and the complete frozen payload attack table. |
| Operation-specific results, nested records, states and cleanup are closed and typed | **PASS** | Retained invalid nested `vm.preflight.capability` and `provider.execute.providerResult` are rejected. Product test `nested helper results are closed and typed` passes. |
| Frozen emergency-stop result contract | **PASS** | Retained probe rejects the former `{state,cleanup,stopOrderDigest}` result and accepts `{runtimeId,state,cleanup}`. |
| Durable counter/nonce/fence/idempotency; crash restart/reconciliation/replay | **PASS at product level** | Journal and service tests prove pending durable admission, digest-bound reconciliation, terminal replay, and no duplicate effect. Runtime recovery tests prove completed-entry replay and PREPARED-only exact pending-command resumption. |
| Request-guard selection, signed issue, admission/revocation and helper result binding | **PASS** | Focused Node tests cover bounded selections, fixed issue registration, signed result validation, and decorative signer rejection. Runtime Vitest and flow tests prove guard rejection precedes secret exposure/probe. |
| Dual client/service native peer verification and UID/GID/owner/mode checks | **PASS at implementation/static-test level** | Independent rejecting service verifier is invoked before effect. Installer/config tests bind verifier bytes, root service identity, dedicated non-root client identity, fixed FD 3 invocation, and authority metadata. Real two-user native execution remains external. |
| Exact production installation configuration and signed fixed authority record | **PASS** | Configuration suite closes the complete union and rejects missing/duplicate/unsafe key, certificate, defect, runtime and signer authority. Verified-release tests prove external Ed25519 authority, exact manifest/toolchain binding, closed path-free record, and no inventory-only authorization. |
| Root installer and systemd/launchd service definitions | **PASS at static/fixture level** | Installer tests pass: only install/verify/dry-run, root requirement, signed authority before staging/mutation, every helper artifact digest-bound, fixed entrypoints/no caller args, stale socket refusal, compatible systemd hardening. Shell syntax passes. Actual root installation remains external. |
| Provider stage carries exact canonical task bytes; execute and cleanup are receipt-bound | **PASS** | Provider/helper tests cover canonical padded base64, exact byte/envelope digests, immutable schema authority, cleanup in `finally`, zero-residue receipt admission, result encoding, cancellation and replay fences. |
| Shared provider release authority is consistent across reconcile, job, journal, subprocess and helper | **PASS** | Product test `release authority digest is part of the job and journal admission binding` passes. Current source uses `job.releaseAuthorityDigest` in subprocess preflight; retained source check confirms the former egress-digest substitution is gone. |
| SSH acquire → status → finalize → canonical transfer import → release; resume/cancel/zero residue | **PASS at product level** | SSH suite passes polling, bounded canonical USTAR, manifest closure, digest drift, resume without duplicate acquire, cancel, release on failure, and residue blocking. Wrapper release tests cover indexed PREPARED retry and owner-private bound recovery sidecars. Real SSH authority/canary remains external. |
| Isolated runtime order, issued guard, secrets, cancellation/emergency, residue and crash recovery | **PASS at product level** | Runtime suite passes exact flow, response drift, issued guard, secret lifecycle, emergency/destroy, uncertain cleanup blocking, completed resume and PREPARED-only retry. Real native Lima/cgroup/firewall proof remains external. |
| Human reviews, authorization and release bind signed assets/native/provider/SSH/cleanup authorities and unresolved defect gate | **PASS at product level** | `public-release-transition.test.ts` passes complete two-provider cross-review, five distinct reviews, authorization and release; stale/mismatched/unsigned records and unresolved High/Critical defects fail closed. |
| Public blocked preflight without production authority is precise and non-fallback | **PASS** | Both launchers exit 78 with typed blockers for missing Docker/release assets/helper/Lima/provider authority and no direct runtime/provider fallback. Public SSH runs reach the production flow and stop on `INSTALLATION_AUTHORITY_UNAVAILABLE`. |
| Repository quality gate | **PASS** | Re-run `pnpm run ci`; final evidence shows format, lint, typecheck, all tests, fixtures, shell checks, builds and smoke checks complete with exit 0. |
| Four real native platforms and live production integrations | **NOT AVAILABLE / external NO-GO** | No genuine Linux x86-64, macOS ARM64/x86-64, signed root installation, provider canary, or repository-scoped SSH canary was available here. These must be supplied as signed external certificates before customer release. |

## Defects

No open Critical or High product implementation defect was found in this final boundary recheck.

The first full-CI attempt encountered five documentation formatting failures while other lanes were
still editing. The owning lane corrected them; the independent final rerun passed completely. This
transient failure is preserved in `postfix-full-ci.txt` and is not an open defect.

## Residual external release gates

1. Install and verify the externally signed fixed helper payload as root using the release
   ceremony record; exercise the dedicated non-root client and root service through the real
   native peer verifier.
2. Produce genuine runtime certificates for Linux ARM64/x86-64 and macOS ARM64/x86-64 covering
   Lima native architecture, rootless runtime, cgroup/resource enforcement, firewall/request
   guard, emergency stop, cleanup and zero residue.
3. Produce real Codex and Claude provider canary/equivalence certificates using the immutable
   images, provider-home authorities and exact provider-egress policies.
4. Produce the applicable real SSH acquisition certificate using the repository-scoped
   read-only key or approved agent, exact known-host fingerprint, acquisition image/network
   policy, finalized transfer import, and zero-residue release.
5. Admit those current certificates plus SBOM/provenance/vulnerability/schema assets into the
   five-review and customer-authorization release flow. Fixture or self-authored evidence must
   not satisfy these gates.

## Coverage notes

- This report distinguishes verified product behavior from unavailable external/native proof.
- The adversarial probe remains outside the product test tree and was rerun unchanged against the
  current implementation, preventing the fixes from being credited solely from newly added happy
  tests.
- No product, specification, documentation or plan file was edited by QA. Only this report and
  transient evidence under `.agent-build/artifacts/` were written.

## Evidence locations

- Report: `.agent-build/test-runs/release/product-helper-qa-final.md`
- Evidence root: `.agent-build/artifacts/p7-product-helper-qa-final/`

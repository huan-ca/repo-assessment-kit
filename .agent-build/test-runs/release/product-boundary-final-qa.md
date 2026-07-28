# P7 product-boundary final QA — lane A

Date: 2026-07-28 UTC  
Scope: production installer/service, host-helper protocol and peer boundary, trusted SSH source,
and public isolated-runtime run/resume. Product code was not modified.

## Verdict

**NEEDS FIXES / CUSTOMER RELEASE NO-GO.**

The current product boundary passes the available deterministic adversarial checks. The latest
repository test command passes **287/287 tests** (**174 Vitest + 113 Node release seams**) plus the
launcher smoke. The focused boundary command passes **55/56**: its only failure is a stale installer
test that still expects the removed byte-for-byte `require_package_match` implementation after the
installer moved to preverified per-file digest authority. The full CI command separately stops at
formatting on two concurrently changed release-authority files.

No open High/Critical implementation defect was reproduced in this lane after the isolated-runtime
resume fix landed and passed 13/13 focused release-run tests. Release nevertheless remains blocked
because the required real root-owned installation, native peer verifier, trusted SSH authority,
Docker/Lima runtime, signed assets, real providers, and four native host certificates are absent.
Fixture and source-level evidence do not substitute for those release artifacts.

## Acceptance matrix

| Boundary / acceptance criterion | Result | Evidence and exact reproduction |
|---|---|---|
| Installer has fixed paths, numeric nonzero UID/GID, exact modes, root-only install/verify, and no auto-start | **PASS deterministic; real install unavailable** | `node --test container/runtime/install/installer-static.test.mjs` exercises fixed UID/GID, service entrypoints, peer digest binding, and no `systemctl start/enable` or `launchctl bootstrap`. The current combined run is 55/56 only because its fifth test names the superseded comparison function; the first four pass. Running `bash scripts/install-production-host-helper.sh --dry-run` as UID 1000 exits 78 with `root is required` (`installer-nonroot-refusal.log`). A real root install/verify could not run. |
| Installer rejects unverified/stale payload rather than trusting the checkout | **PASS by implementation; committed test stale** | Current `install-production-host-helper.sh` requires root-owned mode-0400 `verified-host-helper.txt`, a closed exact key set, platform/architecture/source/signing identity, and SHA-256 authority for Node, peer verifier, every helper module, provider task, validators, and both service files. It verifies a root-only staging tree before install and re-verifies installed bytes. The stale test expects removed `require_package_match()` / `cmp -s`; see defect M-1. |
| Service uses fixed root entrypoint and refuses caller path/argv injection | **PASS** | `boundary-probes.mjs` accepts only `serve`, `reconcile`, and exact `emergency-stop --run-id … --runtime-id …`; arbitrary config/socket paths, pass-through shell argv, and traversal IDs all reject (11/11 probe outcomes overall). Static installer tests confirm fixed systemd/launchd program arguments and no environment-file/instance interpolation. |
| H1 — strict framing and JSON closure | **PASS** | `node --test scripts/host-helper-protocol.test.mjs`: bounded four-byte frame, strict UTF-8/I-JSON, duplicate/trailing/non-object/unknown field/version/operation rejection. `former-defects-recheck.log` also shows nested `vm.preflight` and `provider.execute` result attacks rejected. |
| H2 — digest/MAC/counter/nonce/expiry/fence/response binding | **PASS** | Same protocol suite proves bad digest/MAC, replayed nonce/counter, expired request, stale fence, response operation/digest/MAC mismatch, and exact authenticated result closure reject before effects. |
| H3 — durable idempotency/crash reconciliation | **PASS deterministic** | Same suite proves fsynced admission before effect, same idempotency+digest returns the durable result, changed digest conflicts, crash-after-admission becomes a typed reconciliation item, and service reconciliation closes pending work once. No root-service process-kill/native socket restart was available. |
| Client/service peer verification and UID/GID/mode rejection | **PASS fixture/static; native proof unavailable** | Protocol socket test checks inode/owner/mode and response binding; the prior independent dual-peer probe confirms service-side verifier invocation and rejection before effect. Production config/client bind client UID/GID, service expects that UID, client expects UID 0, and verifier path/owner/mode/digest are fixed. The signed C verifier could not be compiled (`cc` absent) or exercised across real UID 0/62345 processes. |
| No generic host capability | **PASS** | Protocol and custom probes reject generic exec/shell, arbitrary paths/sockets/copy/delete, mounts, networks/destinations, broad SSH, secret readback, caller routes, and caller signing material. Former 15 typed-payload/nested-result unsafe acceptances all now report `unsafeAccepted:false`. |
| Trusted SSH exact authority and fixed source flow | **PASS deterministic; real SSH unavailable** | SSH suite proves exact URL/ref/profile binding; acquire→status polling→finalize→held no-follow transfer verification→canonical USTAR import→release; hooks/helpers/LFS/file/submodules/path traversal/links/devices/duplicates/bombs reject; every failure still releases. Both public launchers reach this product path and block precisely with `INSTALLATION_AUTHORITY_UNAVAILABLE`, not a fixture/direct-Git fallback. |
| Public SSH acquisition index/replay | **PASS deterministic** | `tests/release-run.test.ts` passes “retries the indexed SSH wrapper from its durable PREPARED state without reacquiring”: two wrapper executions, one acquire effect, and prior state supplied on retry. Index is owner-private under generated output and removed after run-state admission. |
| Exactly five SSH receipt digests and cleanup binding | **PASS deterministic** | Production source result closes exactly `acquisition,finalize,import,release,cleanup`. Resume revalidation requires exactly those five keys, five distinct canonical digests equal to sorted receipt values, zero cleanup residue, and an unchanged SSH journal digest. SSH suite proves residue is terminal. No real helper-issued receipts exist. |
| Public local/static accepted; local+isolated rejected | **PASS** | Existing local frozen-tree release test passes without source mutation. `boundary-probes.mjs` rejects local+isolated with `CONFIG_ISOLATED_SOURCE_UNSUPPORTED`; no local archive/mount/copy fallback is selected. |
| Public isolated run invokes fixed runtime and `request-guard.issue` | **PASS deterministic; native runtime unavailable** | Runtime suite proves exact VM lifecycle, bounded catalog selectors, `request-guard.issue` after start facts, signed result binding, default failure before secret/probe, cleanup and residue. Custom probes reject caller routes/traversal. Public isolated sample reaches production acquisition and blocks on missing installation authority. |
| Probe-only sealed secret handling | **PASS deterministic** | Config probes reject `production:true`, provider-purpose credentials, and a non-`RAK_SANDBOX_*` selector. Runtime tests prove post-start target-service secret rejection before effects, store/consume ordering, revoke after failure, and no readback operation. |
| Public isolated journal replay / no repeated effect | **PASS after re-verification** | `pnpm exec vitest run tests/release-run.test.ts --reporter=verbose` passes 13/13. The crash fixture persists one completed preflight entry; resume receives that entry and produces `runtimeCalls=2` with `runtimeEffects=1`. A second resume from terminal runtime receipts performs no additional runtime call/effect. |
| Public fail-closed behavior without native prerequisites | **PASS** | Codex and Claude SSH commands both return the same typed missing-installation block. Runtime preflight on Linux/ARM64 exits 78 and records absent Docker, signed release assets, host-helper authority, Lima, engagement ID, and provider-helper authority; it explicitly states direct runtime fallback is false. |
| Repository regression gate | **FAIL** | Current `pnpm test` passes 174/174 Vitest + 113/113 Node + launcher smoke. Current focused boundary run is 55/56 because of stale installer test M-1. `pnpm run ci` stops at Prettier on `release/release-manifest.schema.json` and `scripts/create-release-manifest.mjs` (M-2), so lint/typecheck/build/smoke do not complete in that final invocation. |
| AC-2 / AC-4 / AC-9 / AC-10 real release evidence | **FAIL — external evidence unavailable** | No root-owned installation, signed native peer binary, real repository-scoped SSH key/agent and known-host binding, real Codex+Claude sessions, Docker/Lima/rootless/firewall/request-guard hostile run, or native Linux ARM64/x86-64 and macOS ARM64/x86-64 certificates. These are explicit P7 release blockers, not code failures inferred from missing infrastructure. |

## Defects

### M-1 — Stale installer integrity test fails after the installer authority model changed

- Severity: **Medium** (release regression gate)
- Likely owner: release-assets / installer
- Repro:
  `node --test container/runtime/install/installer-static.test.mjs`
- Expected: committed installer tests assert the current preverified digest-authority contract and
  pass.
- Actual: test 5 asserts `/require_package_match\(\)/` and `cmp -s "$1" "$2"`, which no longer
  exist. The installer now uses `require_authorized_file`, `verify_payload_tree`, and a closed
  root-owned preverification record. Combined focused result: **55 pass, 1 fail**.
- Product impact: no boundary bypass was found; the release gate is red and the new supply-chain
  path lacks an aligned committed regression assertion.

### M-2 — Full CI stops at formatting in two release-authority files

- Severity: **Medium** (integration/release hygiene)
- Likely owner: release-assets / integration
- Repro: `pnpm run ci`
- Expected: formatting, lint, typecheck, tests, fixtures, shell, build, and smoke all complete.
- Actual: Prettier flags `release/release-manifest.schema.json` and
  `scripts/create-release-manifest.mjs`; later CI stages do not run.
- Evidence: `pnpm-run-ci-final.log`.

## External release-evidence blockers (not code defects)

1. Root-owned installation/verify ceremony at UID/GID 0/62345 with the exact signed helper payload.
2. Signed native `rak-peer-cred` on Linux ARM64/x86-64 and macOS ARM64/x86-64, including real
   service/client peer mismatch tests.
3. Real repository-scoped read-only SSH acquisition with exact known-host fingerprint, five helper
   receipts, interruption/replay, and zero credential/mount/network/process residue.
4. Native Lima/rootless/cgroup/firewall/request-guard/secret/emergency-stop/residue exercises on all
   four required native platforms.
5. Real authenticated Codex and Claude Code provider runs and the signed release certificate/human
   review inventory required by the frozen production contract.

## Coverage notes

- Strong deterministic coverage: strict host protocol, durable helper journal, typed operation
  closure, fixture socket/peer rejection, canonical SSH transfer/import/cleanup, exactly-five
  receipt revalidation, isolated VM-flow ordering, request-guard issuance, sealed one-use probe
  secrets, cleanup residue, and public journal replay.
- Not silently passed: actual root ownership/modes, native socket peer credentials, real SSH,
  physical runtime containment, provider sessions, external signers, and four-platform evidence.
- The custom QA probe is transient evidence under the assigned artifact directory; no product code
  or committed test was changed by this lane.

## Evidence and commands

Evidence root: `.agent-build/artifacts/p7-product-boundary-final-qa/`

- `pnpm test` → **174/174 Vitest + 113/113 Node + launcher smoke PASS**:
  `pnpm-test-final.log`
- focused boundary command → **55/56**, stale installer assertion only:
  `focused-boundary-tests-final.tap`
- installer-only current TAP: `installer-static-current.tap`
- public run/resume focused Vitest → **13/13 PASS** (command output also represented in the full
  test log)
- custom path/argv/config/secret probe → **11/11 expected outcomes**:
  `boundary-probes.mjs`, `boundary-probes.log`
- former helper defects recheck → all former unsafe acceptances false:
  `former-defects-recheck.log`
- public blocked SSH, both providers:
  `public-codex-ssh-blocked.log`, `public-claude-ssh-blocked.log`
- public blocked isolated run: `public-codex-isolated-blocked.log`
- Linux/ARM64 preflight and missing native prerequisites: `runtime-preflight-codex.log`
- non-root installer refusal: `installer-nonroot-refusal.log`
- full CI formatting failure: `pnpm-run-ci-final.log`


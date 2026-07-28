# P7 release security, privacy, and safety review

Date: 2026-07-28 UTC  
Target: `/workspace/rendervo-alt-3bcd18f5/targets/repo-assessment-kit`  
Review mode: independent release review; product/spec/code remained read-only

## Verdict

**BLOCKED / CUSTOMER RELEASE NO-GO.**

No Critical defect was established. The High findings below and the missing real-runtime release
evidence block customer release. Deterministic tests prove useful fail-closed contracts, but they do
not prove containment on Docker/Lima, provider authentication or inference, SSH acquisition,
credentialed hostile targets, native platforms, or the signed release toolchain.

The current package truth is safe: all exercised output remains
`DRAFT_VALIDATED_RELEASE_BLOCKED` with `customerReleaseAuthorized:false`. That fail-closed label
must remain until every named gate passes.

## Blocking findings

### P7-SEC-04 — High release gate — trusted host/runtime enforcement is not implemented or proven

Locations/evidence:

- `scripts/runtime-capability.sh:85-94` checks for a future `rak-runtime-broker` and fixed gate.
- `scripts/provider-broker.mjs:1184-1268` CLI intentionally injects unavailable container,
  network, staging, and session capabilities.
- `scripts/verify-network-attestation.mjs` verifies a deterministic signed record, but no reviewed
  release host helper/firewall authority is present in this checkout.
- Preflight reports Docker and Lima unavailable in this environment.

Impact:

There is no real evidence that a hostile build/target cannot reach the host, Docker socket, LAN,
metadata services, provider endpoints, or secrets. There is also no real emergency-stop,
unresponsive-daemon, residue, cgroup, native-architecture, request-guard, or firewall-drift
exercise. Injected broker tests cannot substitute for these controls.

Required remediation:

Ship the frozen authenticated host helper, native Lima plain-mode image, in-VM broker, root-owned
default-deny firewall, request guard, secret broker, emergency stop, and cleanup attestation. Pass
the four native host matrix with hostile mount/socket/device/network/namespace and residue
canaries. No emulation or host-socket fallback may count.

### P7-SEC-05 — High release gate — signed release assets and real tool supply chain are absent

Locations/evidence:

- `release/toolchain.lock.json:283-290` declares `releaseReadiness.status:"unavailable"`; staged
  binaries, SBOMs, provenance, vulnerability scans, and provider/acquisition image evidence are
  absent.
- `release/release-manifest.json`, `release/release-signature.json`, and
  `release/release-signing-public-key.pem` are absent.
- `scripts/verify-release-assets.mjs --inventory-only` cannot establish a verified authority.
- Syft, Trivy, Gitleaks, OSV-Scanner, and the other locked native scanners are unavailable here.

Impact:

The candidate cannot prove that the binaries, schemas, rules, databases, or images used for a
customer assessment are the reviewed release artifacts. Deterministic parsers and fixture scans
do not establish tool authenticity, current vulnerability status, or official-schema
conformance.

Required remediation:

Stage the exact multi-architecture assets and images, generate SBOM/license/provenance and current
vulnerability evidence, sign the manifest and toolchain lock with the release authority, and
verify from a clean offline install. Any missing or mismatched asset remains a hard block.

### P7-SEC-06 — High release gate — real provider and acquisition equivalence is absent

Evidence:

- The real installed Codex 0.145.0 parser accepts the fixed unattended arguments.
- Claude Code, Docker, provider login sessions, provider egress authority, and real provider
  executor are unavailable.
- `scripts/run-release-assessment.mjs:1014-1020` deliberately blocks SSH acquisition without the
  trusted helper.
- Provider/broker tests use injected fake transport/container/session implementations.

Impact:

There is no real proof that Codex and Claude receive equivalent bounded capsules, that only
allowlisted auth files cross from login homes, that the network permits only the provider
destination, or that provider output/cleanup behaves as modeled. There is also no real SSH
known-host/deploy-key/ephemeral cleanup evidence.

Required remediation:

For each provider, perform login, networkless status, brokered no-op task, hostile prompt/capsule
canary, cancellation, timeout, cleanup, and package dry run with the exact signed image. Compare
required outcomes rather than prose. Exercise real SSH acquisition with a repository-scoped
read-only key, strict known hosts, bounded egress, source-before/after equality, and no key/socket
residue.

### P7-SEC-07 — High release gate — the public provider path cannot produce a reviewed customer package

Locations:

- `container/provider-task.mjs:135-264` enforces the closed author/reviewer profiles.
- `scripts/run-release-assessment.mjs:343-421, 798-866` binds those profiles and creates the
  successor.
- The missing boundary is the public paired-run/human-authority transition, not the single-run
  proposal validator.

Impact:

The new isolated successor module can reject or redact hostile proposal content, derive
provenance, reconcile two explicitly paired provider runs, preserve base eligibility, build a new
blocked ZIP, and validate it in a fresh process. Its focused 18/18 suite is a useful fail-closed
seam. The public boundary now supplies exact release-owned author/reviewer profiles and
instructions, verifies their instruction digest, validates exact closed content and evidence/
limitation bindings, pins the exact output-schema bytes, journals each admitted author-proposal
digest, and binds reviewer capsules to it. The injected actual-broker run completes 7/7 tasks and
creates a validated blocked successor with zero quarantine. Invalid or hostile content remains
quarantined with typed text. A single-provider run can only create a blocked same-provider
successor; same-provider reviews are explicitly not accepted as independent. Separate Codex/Claude
runs are not aggregated under the paired-run profile, and no real provider or human-review records
exist. A provider “success” therefore cannot establish independent-review,
cross-provider-equivalence, or customer-package authority.

Required remediation:

Add an explicit paired-run state machine that binds both provider run identities, equivalent
inputs, distinct-provider independent decisions, human reviews, and the newly reopened ZIP. Raw
provider content must remain internal until secret/host-path/compliance, O1–O4, provenance, and
human-review gates pass. Final-digest release authority must remain a separate signed sidecar
transition; it cannot be self-asserted inside the ZIP.

## Medium findings

None remain open from this security pass.

## Remaining product gaps versus release-evidence prerequisites

The following are product/release-integration gaps, not merely limitations of this review host:

- The production provider-broker CLI deliberately installs unavailable network, staging,
  container, provider-home, and session capabilities. No signed production implementation is
  present in this checkout.
- The signed runtime broker, firewall/request guard, secret broker, fixed host helper, and trusted
  SSH acquisition helper required by the safety architecture are not present as executable,
  attestable release components.
- There is no public paired Codex/Claude aggregation state machine, human-record transition, or
  reviewed-customer-package transition. The single-run task-specific contract is now closed and
  fail-closed.
- The final signed manifest/toolchain/image bundle is not assembled. Inventory data intentionally
  records unstaged artifacts and unavailable readiness.

The following are empirical/environmental prerequisites after those product gaps are supplied:

- native macOS ARM64/x86-64 and Linux ARM64/x86-64 containment, cleanup, emergency-stop, and
  request-guard evidence;
- authenticated real Codex and Claude inference/cancellation/cleanup runs with equivalent inputs;
- a real repository-scoped SSH acquisition and no-residue run;
- current SBOM/provenance/license/vulnerability verification of the exact staged candidate;
- independent technical, security, decision, lay, and customer acceptance of the exact final
  digest.

## Fixed and independently rechecked during this review

| Earlier risk | Resolution evidence |
| --- | --- |
| Public launcher lacked closed `preflight`/`run`/`resume` and could diverge from the broker | Closed grammar, typed exit codes, no direct fallback; launcher smoke passes |
| Resume accepted weak/arbitrary generated paths | Kit-root binding, owner-private no-symlink components, journal/run binding |
| SSH grammar accepted embedded password/query/option forms | Strict `ssh://`/SCP normalization rejects credentials, query, percent escapes, local/IP hosts, and option-shaped paths |
| Provider task inherited writable login configuration | Sterile task home; exact auth file read-only; Codex/Claude fixed flags/config; no source, SSH, Docker socket, or login home |
| Mutable image tag/self-label was treated as identity | Launcher/acquisition require signed verifier output and immutable `reference@sha256` |
| Broker result/receipt schemas were open | Closed bounded receipts, sanitized journal projection, one-use/fence/admission binding |
| Broker CLI trusted a loose `/generated/` substring | Script-derived kit root plus verified owner-private journal/run paths |
| Verification receipt could be overwritten | Exclusive immutable receipt; an identical repeat is idempotent and a conflicting repeat fails |
| `age` accepted a version-printing executable | Signed authority, exact native executable path/digest/platform/version and safe file mode; fake binary is rejected before execution |
| Output-root symlink rejection mutated the external target first | Component-by-component no-follow admission; exact repro now rejects with no external child creation |
| Preflight returned success while blocked / conflated static and isolated readiness | Nonzero blocked exit and distinct static, isolated, and interactive profiles |
| Raw provider JSONL/stream output could not become one typed proposal | Bounded version-specific stream parsers reject duplicate/out-of-order/tool/error/trailing/multiple-final/binary output and rebind proposal identity/evidence/schema/budget |
| Local file capture could follow a swap-to-symlink race or miss same-path dirty-byte drift | The public orchestrator captures through the proc-fd/O_NOFOLLOW helper, analyzes only that snapshot, verifies it around every stage, and uses the same identity-only two-pass walker to compare complete live bytes/source state at completion and resume; immutable 11/11 and release-run 11/11 pass |
| Security-critical broker/snapshot/launcher/successor suites were outside CI | Root `test:release-seams` now runs provider task/broker, immutable snapshot, successor, and launcher smoke; frozen full recheck passes 61/61 plus launcher smoke |
| Local acquisition silently exported only the commit for frozen mode | Host and container local branches now fail with typed `LOCAL_FROZEN_SNAPSHOT_HELPER_REQUIRED`; SSH identity is explicitly immutable-commit |
| Replay ledger trusted a mutable/symlinkable state path | Canonical installation root, owner-private no-symlink state/ledger, `O_NOFOLLOW` exclusive marker, full attestation binding, and file/directory fsync; foundation/security smoke pass |
| Resume could escape a broker throw/abort without terminal cleanup or a stale-authority fence | Run and resume share a guarded finalizer; affected task and provider-job authority are cancelled before fallible cleanup, the old broker authority is rejected, residue is typed and blocks resume, and integrity terminals are monotonic |
| Public draft journal used a misleading `COMPLETED` state despite missing release controls | New-run and resume now terminalize only as `DRAFT_VALIDATED_RELEASE_BLOCKED`, matching the package and immutable receipt |
| Discovery input used a path-based `lstat`/`realpath`/read sequence | The orchestrator now opens once with `O_NOFOLLOW`, validates the held handle before and after read, parses those bytes, and persists a private digest-bound copy |
| Earlier lay review found unsupported urgency, missing decision context, machine labels, and unclear evidence links | Fresh generated-package review after reporting fixes passes the no-finding lay checks for decision options, confidence, unknowns, reversal conditions, and owner action; release authority and signed-candidate customer acceptance remain separate gates |
| Attempted raw provider-successor appendix lacked safe output admission/provenance | Isolated successor module now uses closed task-specific derivatives, secret/host-path/compliance/active-content gates, O3 provenance, independent-review binding, preserved base eligibility, exclusive output, strict fresh-process validation, and immutable draft truth; focused suite 18/18 passes. Public integration remains P7-SEC-07 |
| Broker/successor exceptions could persist untrusted text in the run journal | Both catches now persist fixed typed text only; a hostile AWS-key/host-path regression proves proposal content does not reach journal state |
| Common finalizer could persist an arbitrary exception `code` | Only an allowlisted internal release failure code is now persisted; hostile AWS-key/host-path `error.code` regression maps to `UNEXPECTED_ERROR` and stays out of memory/disk journal state |
| Generic provider content could pass the broker but fail successor admission | Exact author/reviewer profiles, instruction digest, task-role mapping, evidence/limitation binding, safe text, reviewer-author digest, and pinned schema bytes are now enforced at the provider boundary; injected actual-broker orchestration completes 7/7 and creates a validated blocked successor |
| Multiple same-line detector matches collided on evidence/finding IDs and broke the exact self-assessment | Identity now includes collector/detector, path, exact source offsets, and run ID where scoped; analyzer 24/24 and the fresh 113-entry orchestrated self-assessment pass with zero cleanup residue |
| Full CI had not passed on a frozen candidate | Frozen-tree `pnpm run ci` now passes formatting, lint, type checks, 157 Vitest tests, 61 release-seam tests, fixtures, shell checks, all builds, and foundation/security smoke |

Focused final evidence before report:

- Release/foundation/packaging Vitest: 41/41 pass.
- Provider task/broker Node tests: 32/32 pass; agent-adapter tests: 15/15 pass.
- Integrated release-run suite after immutable snapshot/failure-finalizer wiring: 11/11 pass;
  immutable helper/identity tests: 11/11 pass.
- Isolated provider-successor package tests: 18/18 pass; relevant ESLint and Prettier pass.
- Combined independent recheck of release-run, immutable snapshot, and provider-successor:
  40/40 pass; the focused changed-file ESLint and Prettier checks pass.
- Runtime launcher smoke and relevant JavaScript syntax checks pass.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.
- Secret-pattern review found only explicit seeded test/report fixtures, not an apparent live key.
- Full frozen-tree `pnpm run ci`: pass.

## Real evidence versus deterministic seams

| Control | Evidence | Release result |
| --- | --- | --- |
| Strict config, closed launcher, SSH grammar, journal/receipt, provider envelope/fence/receipt schemas | Deterministic tests and adversarial local repros | Pass for the tested contracts |
| O1/O2 exclusion and O3/O4 review gates | Deterministic evidence/report/package suites | Pass for seeded fixtures only |
| Codex fixed CLI arguments | Real installed Codex 0.145.0 parser | Pass for argument parsing only |
| Live loopback UI/auth/origin/browser slice | Real Playwright/Chromium QA evidence | Pass for available slice |
| Official `age` encrypt/decrypt/recovery | Release-assets lane evidence; signed bundle still absent | Not a release pass |
| Provider task execution and blocked successor | Injected actual broker with closed content contract, 7/7 tasks, zero quarantine | Seam pass; real paired-provider/human gate blocked |
| Docker/Lima/firewall/request guard/secret broker | Not available | Blocked |
| SSH/deploy-key acquisition and cleanup | Not available | Blocked |
| Native tools, official schemas, SBOM/provenance/vulnerability scans | Not available as signed release assets | Blocked |
| Credentialed hostile target and covert O1–O4 output review | Not run | Blocked |
| Independent lay/customer package acceptance | Fresh lay fixture passes; signed-candidate customer/release-authority acceptance absent | Lay seam pass; release blocked |

## Exact release gates

Customer release remains prohibited until all of the following are evidenced on the exact signed
candidate:

1. Pass macOS ARM64/x86-64 and Linux ARM64/x86-64 native Lima/rootless/cgroup/firewall/request-
   guard/emergency-stop/residue tests with no host socket, mount, device, LAN, metadata, DNS, or
   provider-credential leakage.
2. Verify the signed manifest/toolchain/images, native binaries, official schemas/rules/databases,
   SBOMs, provenance, licenses, and current vulnerability scans from a clean offline install.
3. Pass real Codex and Claude login/status/task/cancellation/cleanup/dry-run conformance with
   provider-home isolation and exact egress.
4. Pass real local immutable acquisition and SSH acquisition, including hostile path/race/archive,
   deploy-key/known-host, before/after equality, and no-residue canaries.
5. Pass safe and hostile isolated P0–P3 controls, O1–O4 handling, sandbox-secret purpose/recipient/
   expiry/replay, and credentialed-output covert-channel review using only disposable
   least-privileged non-production credentials.
6. Produce a real `age` encrypted package from signed authority and independently decrypt/reopen/
   checksum it; plaintext is never an encryption substitute.
7. Pass independent technical, lay, and customer-acceptance review of the exact package, plus
   accessibility/platform, crash/cancel/migration/quota, and incident-response exercises.
8. Rerun the full CI/audit/secret/supply-chain checks on the frozen tree and retain immutable
   evidence. Only a separately reviewed release authority may change
   `customerReleaseAuthorized` to true.

## Residual privacy and safety constraints

Customer repositories, discovery answers, paths, evidence, provider session metadata, sandbox
credential handles, and packages are customer-confidential operational data. Production
credentials/endpoints remain prohibited. Raw credentialed responses, DOM/body/header data, traces,
HAR, downloads, screenshots, logs, and target-controlled artifacts remain O1/O2 and must not enter
customer packages automatically. O3/O4 derivatives remain bounded low-capacity channels and
require independent review. The product must continue to state that it is a technical assessment,
not certification, legal advice, or proof of security.

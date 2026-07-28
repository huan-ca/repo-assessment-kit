# Supported coverage matrix

## Release status

**P7 CUSTOMER RELEASE NO-GO / BLOCKED**

This matrix distinguishes implemented and tested behavior from unavailable release gates. “Pass”
means only the evidence scope named in the row; it does not imply customer-release support. The
authoritative coverage words inside an assessment package remain `pass`, `fail`, `partial`,
`blocked`, `not applicable`, and `not tested`.

| Evidence label                 | Meaning                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Deterministic pass**         | Contract, fixture, parser, validator, or fail-closed behavior passed in the available environment.            |
| **Observed slice pass**        | A real component was exercised, but not the complete native release path.                                     |
| **Reduced-depth pass**         | The declared static capability ran without unavailable external/native tools; its limitations remain visible. |
| **Deterministic product pass** | The closed product transition passed accepted local QA; this does not supply native or external authority.    |
| **Blocked**                    | A required real authority, platform, service, credential, reviewer, or signed candidate was unavailable.      |
| **Best effort**                | Documented for operator convenience, but not a required or supported native release platform.                 |

## Host and platform coverage

| Host/platform | Available evidence                                                                                                                                   | Customer-release state                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux ARM64   | Accepted deterministic product-transition QA, live loopback Chromium slice, installed Codex argument parser, and real upstream `age` v1.3.1 recovery | **Blocked.** No real root-installed helper/runtime/SSH evidence, signed Docker/Lima run, provider executor, signed tool/image bundle, or customer package |
| Linux x86-64  | Contract and fixture behavior only; no native run                                                                                                    | **Blocked**                                                                                                                                               |
| macOS ARM64   | Contract, deterministic installer/service checks, and documentation only; no native run or launchd/systemd sandbox-parity evidence                   | **Blocked**                                                                                                                                               |
| macOS x86-64  | Contract, deterministic installer/service checks, and documentation only; no native run or launchd/systemd sandbox-parity evidence                   | **Blocked**                                                                                                                                               |
| WSL           | Documented as best effort; no release evidence                                                                                                       | **Not tested / not a substitute for a native gate**                                                                                                       |

No emulation result, Docker Desktop observation, parser-only probe, injected broker, or fixture
attestation clears a native platform row.

Accepted deterministic product-transition QA is **305/305**, comprising 174 Vitest checks and 126
release seams. Final full CI also passes 174/174 Vitest, 126/126 release seams, fixtures, shell
syntax, build, foundation smoke, and security smoke; the production audit reports no known
vulnerabilities.

The CI host has no native C compiler. It therefore did not compile the signed `rak-peer-cred`
payloads or execute the required Linux ARM64/x86-64 and macOS ARM64/x86-64 matrix. That missing
external native evidence keeps every platform release row blocked without changing the deterministic
product result.

## Assessment capability coverage

| Capability                                      | Current evidence                                                                                                                                                                                                         | Declared support for this candidate                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Ten-topic product/customer discovery            | Deterministic suite and real loopback UI traversal preserve statements and structured unknowns                                                                                                                           | **Observed slice pass**                                                                |
| Local frozen-working-tree acquisition           | No-follow snapshot, source-state binding, dirty/untracked byte coverage, drift rejection, and self-assessment mirror pass                                                                                                | **Deterministic pass; real signed deployment run still required**                      |
| Signed host-installer authority                 | Manifest v2 `hostHelper`, fixed out-of-band key, root-only record emission, mode-`0400` authority, exact platform payloads, root staging/rehash, account/group closure, and no-auto-start behavior pass deterministic QA | **Deterministic product pass; real root installation blocked**                         |
| Root helper and native peer boundary            | Fixed root service, public client UID/GID, socket/key/config/journal paths, native peer verifier, fixed operations, and recovery pass accepted deterministic product-transition QA                                       | **Deterministic product pass; real root-installed verification blocked**               |
| SSH Git acquisition                             | Registered read-only handle, strict known hosts/fingerprint, fixed worker/finalize/import/release path, and recovery pass deterministic seams; no real trusted run is recorded                                           | **Deterministic product pass; real deployment evidence blocked**                       |
| Fixed snapshot transfer                         | Helper-derived installation/run/source-command directories, fixed `snapshot.tar`/`manifest.json`, no-follow import, release, and residue checks pass deterministic seams                                                 | **Deterministic product pass; real crash/recovery evidence blocked**                   |
| Static repository composition and stack         | All seven fixture ecosystems detected                                                                                                                                                                                    | **Reduced-depth pass**                                                                 |
| Architecture and boundary inference             | Kit-owned static heuristics with explicit limitations                                                                                                                                                                    | **Reduced-depth pass**                                                                 |
| Engineering quality and maintainability         | Kit-owned static heuristics; native scanners unavailable                                                                                                                                                                 | **Reduced-depth pass**                                                                 |
| Features, use cases, and parity traceability    | Evidence-linked deterministic projection; owner unknowns remain explicit                                                                                                                                                 | **Deterministic pass**                                                                 |
| Runtime readiness                               | Static signals and honest blocked-state accounting                                                                                                                                                                       | **Reduced-depth pass**                                                                 |
| Isolated target launch and browser automation   | Root-catalog resolution, fixed external signer, `request-guard.issue`, signed guard/firewall, secret-broker, rootless runtime, and cleanup paths pass deterministic seams; no native deployment run exists               | **Deterministic product pass; real native-platform evidence blocked**                  |
| Security baseline and overlay reporting         | Baseline, selected-overlay, and recommended-only states remain distinct in deterministic suites                                                                                                                          | **Deterministic pass; external scanner/runtime depth blocked**                         |
| Evidence provenance and references              | Closed provenance labels, reference validation, collision regression, and coverage reconciliation pass                                                                                                                   | **Deterministic pass**                                                                 |
| Secret and sensitive-path handling              | Seeded fixture exclusion, redaction, O1/O2 quarantine, and O3/O4 gates pass                                                                                                                                              | **Deterministic fixture pass; credentialed hostile-target review blocked**             |
| Modernization option comparison                 | Repair, controlled staged replacement, and rebuild use the same criteria; fresh no-finding fixture corrected earlier lay defects                                                                                         | **Deterministic report pass; independent human/customer review blocked**               |
| Native/SARIF/CycloneDX export                   | Current official/kit schema and semantic validation passes                                                                                                                                                               | **Deterministic pass**                                                                 |
| Draft report/package creation                   | Manifest, checksums, strict ZIP reopen, tamper rejection, immutable receipt, and draft truth pass                                                                                                                        | **Deterministic pass for drafts only**                                                 |
| Signed customer ZIP                             | No signed release bundle or authorized customer package exists                                                                                                                                                           | **Blocked**                                                                            |
| Optional `age` encryption                       | Real Linux ARM64 upstream executable encrypt/decrypt test passed with a test-shaped authority                                                                                                                            | **Observed cryptographic slice pass; signed release use blocked**                      |
| Codex launcher                                  | Closed verbs and installed CLI argument parsing pass                                                                                                                                                                     | **Deterministic/parser pass; authenticated brokered dry run blocked**                  |
| Claude Code launcher                            | Closed verbs and shared contracts pass                                                                                                                                                                                   | **Deterministic contract pass; CLI/authenticated dry run blocked**                     |
| Provider author/reviewer integration            | Exact closed profiles, 7/7 injected brokered task kinds, author-digest review binding, sanitized errors, and a validated blocked successor draft                                                                         | **Deterministic pass**                                                                 |
| Cross-provider equivalence                      | Closed comparison and successor-package integration have focused deterministic coverage                                                                                                                                  | **Blocked pending real paired Codex/Claude runs and digest-bound independent reviews** |
| Public pair/review/authorize/release transition | Closed public verbs, five distinct signed human-review kinds, distinct release authority, exact certificate binding, defect gates, and sidecar-only release pass accepted deterministic transition QA                    | **Deterministic product pass; no real customer authorization issued**                  |
| Independent security/decision review            | Deterministic review gates fail closed                                                                                                                                                                                   | **Blocked for the exact final package**                                                |
| Independent technical/lay/customer review       | Fresh fixture copy passes automated lay checks; no exact-candidate human/customer authority exists                                                                                                                       | **Blocked**                                                                            |

## Static ecosystem depth

Every ecosystem below is detected and returns explicit reduced coverage when native scanners or
runtime tools are unavailable. “Reduced-depth pass” does not mean full language-specific security or
runtime coverage.

| Ecosystem       | Fixture detection | External/native tool depth  | Runtime depth |
| --------------- | ----------------- | --------------------------- | ------------- |
| Node/TypeScript | **Pass**          | **Blocked / reduced depth** | **Blocked**   |
| Python          | **Pass**          | **Blocked / reduced depth** | **Blocked**   |
| Go              | **Pass**          | **Blocked / reduced depth** | **Blocked**   |
| Java            | **Pass**          | **Blocked / reduced depth** | **Blocked**   |
| .NET            | **Pass**          | **Blocked / reduced depth** | **Blocked**   |
| Ruby            | **Pass**          | **Blocked / reduced depth** | **Blocked**   |
| PHP             | **Pass**          | **Blocked / reduced depth** | **Blocked**   |

Unavailable release tools include the locked native scanner and inventory set. Their absence is
recorded as unavailable/not invoked/not run; it is never converted to a pass.

## Acceptance-criterion summary

| Brief criterion                                      | Current result                                              | Release consequence                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| AC-1 Guided discovery                                | **Pass**                                                    | None beyond final-candidate review                                          |
| AC-2 Controlled intake and immutability              | **Fail: real SSH gate**                                     | Blocks release                                                              |
| AC-3 Complete static assessment                      | **Pass**                                                    | Native external-tool depth remains a disclosed limitation                   |
| AC-4 Safe runtime assessment                         | **Fail: real isolated runtime gate**                        | Blocks release                                                              |
| AC-5 Evidence, coverage, validation, redaction       | **Pass**                                                    | Credentialed hostile-target evidence still belongs to the real runtime gate |
| AC-6 Modernization decision support                  | **Pass for current deterministic report evidence**          | Exact-package human/customer acceptance still blocks release                |
| AC-7 Security baseline and overlays                  | **Pass for deterministic implementation**                   | Real scanner/runtime depth remains blocked                                  |
| AC-8 Customer-ready package                          | **Fail: no signed, independently reviewed customer ZIP**    | Blocks release                                                              |
| AC-9 Codex and Claude Code compatibility             | **Fail: no paired real dry runs**                           | Blocks release                                                              |
| AC-10 Platform, documentation, and release readiness | **Fail: native matrix, signed assets, and sign-off absent** | Blocks release                                                              |

The current total is five deterministic acceptance passes and five criteria blocked by mandatory
real release gates. See the [release checklist](release-checklist.md) for the work required before
re-evaluation and the
[release-readiness report](../.agent-build/test-runs/release/release-readiness.md) for evidence
reconciliation.

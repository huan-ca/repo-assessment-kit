# Local assessment toolchain

_Accessed and validated: 2026-07-27._

## Question

Which production-usable, local-first tools should the kit use to assess Node/TypeScript, Python, Go, Java, .NET, Ruby, and PHP web/API repositories on Linux ARM64 and x86-64, without modifying or executing an untrusted target?

This unblocks the analyzer interface, scanner images, evidence formats, license notices, update process, and the boundary between safe baseline analysis and explicitly approved dynamic/deep analysis.

“Good enough” means: every first-class ecosystem gets repository/dependency inventory, CycloneDX SBOM, known-vulnerability, secret, SAST, IaC/container, license, and basic quality coverage; every tool runs locally, emits machine-readable evidence, has a redistributable license, and has a credible ARM64/x86-64 path. Runtime tests remain capability-gated and non-destructive.

## Recommendation

**Use a small layered suite, with high confidence:** kit-owned inventory plus **scc**, **Syft**, **OSV-Scanner**, **Gitleaks**, **Trivy**, **Opengrep with kit-owned rules**, and **PMD/CPD** for the always-safe static baseline; add **ZAP Baseline** and **Playwright** only after the runtime-capability gate. Preserve each tool's native JSON and normalize into the kit schema; also emit SARIF where the tool supports it and CycloneDX JSON from Syft.

Do not run package managers, builds, tests, repository scripts, project-configured linters, ZAP API/full scans, or any autofix command in the baseline. Those belong to a separately consented “trusted deep scan” in a disposable, network-restricted target-runtime container.

The important SAST choice is **Opengrep, not a redistributed Semgrep community ruleset**. Opengrep supports all seven languages, JSON/SARIF, signed ARM64 releases, and is LGPL-2.1. Semgrep's community rules are now under a non-sublicensable, non-transferable license limited to internal business use and explicitly may not be distributed or made available as a service. The kit should therefore ship and test a modest rule pack it owns; third-party rules enter only after a per-rule license audit.

## Minimum production matrix

| Domain | Default tool and invocation posture | Canonical evidence | Architectur​e / redistribution |
|---|---|---|---|
| Repository inventory | Kit walker over the immutable exported commit plus `scc --format json --by-file`; enumerate manifests, lockfiles, CI, Docker/Compose, IaC, generated/vendor candidates, file sizes and symlinks. Do not invoke repository code. | Kit JSON; scc JSON/CSV | scc is MIT and ships Linux `arm64` and `x86_64` release archives. Its complexity is a lexical estimate, not a maintainability verdict. |
| Packages / SBOM | `syft dir:/target -o syft-json=… -o cyclonedx-json=…`, with an explicit kit config and exclusions. | **CycloneDX JSON** for delivery; Syft JSON retained as raw evidence | Apache-2.0; official Linux amd64/arm64 archives, checksums, signatures and SBOMs. Syft lists JavaScript, Python, Go, Java, .NET, Ruby and PHP package types. |
| Source dependency CVEs | `osv-scanner scan source --recursive --format json`; stage a dated offline database and disable resolution/network by default. Never use `fix`. | Native JSON; SARIF derivative where supported | Apache-2.0; official Linux amd64/arm64 binaries. It directly supports the seven ecosystems' common lock/manifests. Maven `pom.xml` transitive resolution normally queries deps.dev and is disabled offline, so report reduced depth unless egress is approved. |
| Secrets | Gitleaks filesystem scan plus a separately bounded Git-history scan when `.git` is in scope; explicit kit config, `--redact=100`, maximum file size and timeout. | Native JSON and SARIF; never retain the matched secret | MIT; official cross-platform Go binaries including Linux arm64/amd64. Gitleaks supports JSON, CSV, JUnit and SARIF. A clean result is not proof that no secret exists. |
| SAST | `opengrep scan --config /kit/rules --json-output … --sarif-output …`; kit-owned pinned rules only, no autofix, validators, builds, registry lookup, or repository rules/config. | Native JSON plus SARIF 2.1.0 | Engine LGPL-2.1; signed self-contained glibc/musl aarch64 releases and amd64 releases. Covers C#, Go, Java, JS/TS, PHP, Python and Ruby. Distributing the engine requires LGPL notices/source-or-relink compliance review. |
| IaC, Dockerfile, image and license checks | `trivy fs` with explicit scanners/config and pre-staged DB/check bundle; use `trivy image` only against an image already produced inside the isolated target runtime. Run standard package-license scan always; `--license-full` is an optional slower pass. | Native JSON; SARIF for findings; do not use its SBOM as the canonical SBOM | Apache-2.0; signed Linux ARM64/amd64 archives/images. Trivy repo/fs covers vulnerabilities, misconfiguration, secrets and licenses. Its license risk classes are opinionated triage, not legal conclusions. |
| Quality / duplication | scc per-file language/size/lexical-complexity plus PMD Java source rules and PMD CPD across all seven languages. Run PMD from the kit ruleset, never target-supplied custom Java rules. | scc JSON/CSV; PMD JSON/SARIF; CPD XML/CSV normalized by the kit | PMD is principally BSD-style with identified Apache-2.0 portions; JVM distribution is architecture-neutral when used with pinned multi-arch Temurin. CPD supports C#, Go, Java, JS/TS, PHP, Python and Ruby. |
| Passive web scan | After launch and scope gates only: ZAP **Baseline** against a single allowlisted sandbox origin, traditional spider, passive rules, hard time/URL limits, no API/full/active scan. | ZAP JSON plus HTML/Markdown appendix | Apache-2.0. Official stable images exist, but the project does not make a sufficiently clear ARM64 guarantee in its Docker docs; rebuild from the official source on the kit's multi-arch JRE base and make both-arch smoke tests a release gate. |
| Browser / API observation | Kit-authored Playwright flows limited to approved accounts and read-only navigation/requests; proxy through ZAP for passive observation. Block downloads/uploads and mutating methods by default. | Kit control JSON, Playwright JSON/JUnit, traces/screenshots only after redaction | Apache-2.0. Version of library and browser must match. The official Docker docs warn the image is not for untrusted sites and recommend a non-root user plus seccomp; Alpine/musl is unsupported. ARM64 browser execution remains a release-gated gap below. |

This matrix deliberately tolerates overlap: Syft is the SBOM authority; OSV-Scanner is the source-lockfile advisory authority; Trivy owns IaC/container/image and license triage. Duplicate CVE/secret observations are correlated, not counted as independent findings.

## Ecosystem depth

| Ecosystem | Safe baseline | Optional trusted deep scan (not baseline) | Known limitation |
|---|---|---|---|
| Node / TypeScript | Syft + OSV lockfiles; Opengrep; scc/CPD | Repository-pinned ESLint, `tsc --noEmit`, tests with lifecycle scripts disabled until explicitly approved | ESLint flat config is executable JavaScript; dependency installation can run scripts. |
| Python | Syft + OSV requirements/Poetry/PDM/uv/Pipenv; Opengrep; scc/CPD | Pinned Ruff in check-only mode, repository tests | Treat `pyproject` as untrusted input; plugins/test configuration can execute Python. |
| Go | Syft + OSV `go.mod`; Opengrep; scc/CPD | Staticcheck, `go vet`, tests with `GONOSUMDB`/proxy/egress policy | Go package loading may invoke the Go tool and fetch modules. |
| Java | Syft + OSV Maven/Gradle files; Opengrep; PMD/CPD | SpotBugs and repository build/tests | Offline Maven scanning can miss transitives; builds and plugins execute code. |
| .NET | Syft + OSV `packages.lock.json`, `packages.config`, `deps.json`; Opengrep; scc/CPD | `dotnet format analyzers --verify-no-changes --no-restore --report …` and tests | Microsoft explicitly warns `dotnet format` may restore, compile, and run analyzers and should only be used on trusted code. |
| Ruby | Syft + OSV `Gemfile.lock`/`gems.locked`; Opengrep; scc/CPD | Repository-pinned RuboCop JSON and tests | Ruby configs, plugins, Bundler and tests execute code. |
| PHP | Syft + OSV `composer.lock`; Opengrep; scc/CPD | Repository-pinned PHPStan JSON and tests | Composer scripts, autoload/bootstrap files and PHPStan extensions execute code. |

“First-class” should mean tested adapters and honest coverage for all seven ecosystems, not identical semantic depth. The brief explicitly defers equal-depth ecosystem analysis.

## Safe, non-destructive execution contract

Every baseline adapter should enforce all of the following, rather than relying on a scanner's good behavior:

1. Export the recorded commit into an isolated scan namespace. Mount it read-only at `/target`; mount only a fresh per-tool output directory read-write. Do not mount agent homes, SSH, provider credentials, the host Docker socket, or the operational database.
2. Run as a numeric non-root user with read-only root filesystem, `no-new-privileges`, all capabilities dropped, bounded CPU/memory/PIDs/output bytes/time, a tmpfs scratch directory, and network disabled after signed tools/databases/rules are staged.
3. Invoke a fixed binary with an argv array. Never pass repository paths or config through a shell. Resolve the target and output paths under allowlisted roots; reject escaping symlinks and special files.
4. Supply an explicit kit-owned config/rules path and working directory outside `/target`. Do not auto-load `.gitleaks.toml`, `.trivy.yaml`, Semgrep/Opengrep rules, PMD custom Java rules, build files, or other target-controlled executable configuration.
5. Disable mutating or execution features: no fixes/autofix/remediation, local builds, dependency restore, package install, validators, hooks, plugins, custom reporters/templates, or remote registry rules.
6. Distinguish “findings” exit codes from tool failure. Record command identity (without secrets), engine/rule/DB versions and digests, start/end time, timeout, exclusions, stderr, truncation, and coverage status.
7. Redact at ingestion and again at packaging. Gitleaks output must be fully redacted; raw ZAP/Playwright bodies, traces and screenshots require content/size limits and the same final secret scan as reports.

Repository-owned test/lint commands are never made safe merely by mounting the source read-only: they can read credentials, consume resources, access the network, exploit parsers/runtimes, or attack neighboring services. The trusted deep tier still needs a disposable copy, no secrets, narrow egress, and explicit consent.

## Update, pinning, and repeatability

- Maintain a signed `toolchain.lock.json` containing each engine version, source URL, SHA-256, upstream license/NOTICE digest, image digest per architecture, rule-pack Git commit, and database/check-bundle digest and creation time.
- Build first-party multi-stage scanner images for `linux/amd64` and `linux/arm64`; do not execute curl-install scripts at assessment time. Verify upstream checksums/signatures, generate an SBOM for the tool image, scan it, and publish its notices.
- Pin engines and rules for a released kit. Refresh vulnerability DBs and advisory data on an explicit channel (normally before each engagement or daily in connected mode), preserve the exact snapshot with run metadata, and warn/fail when stale. “Same scanner version” is not deterministic when its DB or rules changed.
- Run monthly dependency/rule review and an expedited security-update path. Promote updates only after the seven-ecosystem fixture suite, malicious-repository fixtures, normalization/schema tests, false-positive snapshots, and both-architecture smoke tests pass.
- Keep raw native output because SARIF/CycloneDX adapters can lose tool-specific fields. Normalized findings must identify the adapter schema version and raw evidence digest.
- Never silently fall back to online mode. A missing/stale DB, unsupported lockfile, parse error, timeout, file-size exclusion, or unavailable architecture becomes `partial`/`blocked` with a reason.

## Options compared and rejected

| Option | Decision | Reason |
|---|---|---|
| One-tool Trivy-only stack | Reject | Operationally simple, but weaker as the sole SBOM/SAST/secret/history/quality source. Use it for its strongest domains and retain independent Gitleaks and kit-owned SAST. |
| Syft + Grype | Do not include in minimum | Both are good Apache-2.0, multi-arch tools, but OSV-Scanner maps directly to all seven source lockfile ecosystems and supports a downloadable offline OSV DB. Grype would add a third overlapping CVE engine; retain it as a future validation profile for image/SBOM disputes. |
| Semgrep CE + `semgrep-rules` | Reject for shipped baseline | Engine is LGPL-2.1, but the current community rules license forbids distribution and service use. Registry configs also create network/metrics behavior. A customer may opt into its hosted/commercial product with explicit egress consent. |
| CodeQL CLI | Reject as default | Excellent deeper analysis, but GitHub limits CodeQL use by repository/license context; database creation commonly builds code. It is an optional customer-provided integration, not a redistributable universal local baseline. |
| SonarQube Community Build | Reject for MVP | Long-running server/database, heavier operations, plugin/version matrix and less convenient evidence portability; it does not solve hostile-repository execution. |
| Checkov/Terrascan/Hadolint alongside Trivy | Defer | Useful specialist checks but duplicate the minimum IaC/Dockerfile baseline and increase rules, normalization and license-update burden. Add only when fixture evidence shows a Trivy gap. |
| ScanCode Toolkit as mandatory license scan | Defer | Richer license/copyright evidence and many formats, but materially heavier and its full multi-arch packaging/performance must be benchmarked. Trivy package plus full-file license scan is adequate triage; neither constitutes legal advice. |
| ZAP API or Full Scan / Nuclei templates | Reject by default | They perform active requests/attacks and can mutate state. Enable only as a separately authorized security profile against a disposable target with reviewed operations/templates. |
| Hosted Snyk, Semgrep Cloud, GitHub Advanced Security, SonarCloud | Optional opt-in only | Potentially deeper results, but repository/findings egress, credentials, licensing, retention and destination disclosure conflict with the local-default requirement. No silent fallback/upload. |

## Evidence and feasibility results

- Syft officially scans directories/images and emits CycloneDX, SPDX and Syft JSON; its catalog includes npm, Python, Go modules, Java archives, .NET, gems and Composer/PEAR package types.
- OSV-Scanner's source table includes `package-lock`/pnpm/yarn, Python requirements and modern locks, `go.mod`, Maven/Gradle, .NET lock/config/deps, Composer and Gem locks. Its documentation states Maven transitive resolution uses deps.dev by default and is disabled offline.
- Trivy documents repository scanning for vulnerabilities, misconfiguration, secrets and licenses, and extended source-file license scanning via `--license-full`. It also documents SARIF coverage for vulnerability, misconfiguration and secret findings.
- ZAP documents Baseline as a short spider followed by passive scanning with “no actual attacks”; it documents API Scan as including active rules, which is why API Scan is excluded from the baseline.
- Playwright documents exact version pinning, glibc rather than Alpine/musl, and non-root + seccomp for untrusted browsing. It also warns its official image is intended for test/development rather than visiting untrusted websites.
- On 2026-07-27, a scratch-only Linux `aarch64` spike downloaded the latest official release assets and successfully ran: OSV-Scanner **2.4.0**, Syft **1.49.0** (`Platform: linux/arm64`), Gitleaks **8.30.1**, Trivy **0.72.0**, scc **3.7.0**, and Opengrep **1.26.0**. No target/product files were installed or changed. Official release assets also list the corresponding amd64 builds; x86-64 execution still belongs in CI/release validation.

## Risks, gaps, and what would change the recommendation

1. **Browser ARM64 is unresolved and release-blocking.** The Playwright docs do not promise a Linux ARM64 official-image matrix. Validate Chromium + Playwright in the selected ARM64 image, including sandboxing, tracing and proxying. If it fails, use an architecture-specific Chromium runner behind the same adapter and mark WebKit/Firefox reduced; do not claim parity.
2. **ZAP official-image ARM64 support is insufficiently documented.** Build from the Apache-licensed release on the kit's multi-arch JRE base and run passive-scan fixtures on both architectures. Failure flips the recommendation to a kit-controlled passive HTTP/header analyzer on ARM64 with ZAP only on validated platforms.
3. **Kit-owned SAST rules are real product work.** Start with high-confidence OWASP/CWE-aligned patterns for each language, require positive/negative fixtures and rule metadata, and report rule-count/domain coverage. If maintaining useful rules proves infeasible, a commercial local engine becomes an explicit product/license decision rather than a silent registry dependency.
4. **Offline dependency depth varies.** Maven manifests without lock/verification data and dynamically resolved ecosystems can be partial. Never run a resolver automatically; request approved egress or a customer-produced lock/SBOM.
5. **License classification is not legal analysis.** Preserve detected expression/text/confidence and customer policy separately; unknown/custom/dual licenses require human review.
6. **Parser attack surface remains.** Scanner containers process hostile bytes. Track scanner CVEs, keep resource limits and network isolation, and treat crashes/timeouts as evidence, not reasons to weaken isolation.
7. A future permissively licensed, well-maintained multi-language SAST rule corpus with tested coverage would reduce kit maintenance and could replace the initial rule pack. A future stable, documented multi-arch Playwright/ZAP release would close the largest platform gaps.

## Validation plan

Before freezing P1/P4:

1. Build identical tool image recipes for amd64 and arm64, verify signatures/checksums/notices, and run `--version` plus one scan per tool on each architecture.
2. Create one small fixture per ecosystem containing: direct and transitive dependencies, one known vulnerable locked version, one seeded fake secret, one kit SAST finding, one quality/duplication finding, and representative Docker/IaC. Assert raw and normalized output, locations, rule IDs, DB/rule provenance and allowed coverage statuses.
3. Add hostile fixtures: symlink escape, FIFO/device, giant/minified/binary file, decompression bomb, executable project config, malicious MSBuild/Gradle/npm/Composer hooks, custom analyzer/plugin, scanner timeout, invalid encoding, output flood and prompt-injection text. Assert zero code execution, egress, target writes and secret leakage.
4. Diff the target before/after every run, inspect container mounts/capabilities/network, and verify that only the per-tool evidence directory changed.
5. Run ZAP Baseline and Playwright against an isolated fixture app with a request recorder. Assert one allowlisted origin, no mutating method, no active ZAP rule, bounded crawl, redacted bodies/screenshots, and correct `blocked` behavior when the runtime gate fails.
6. Golden-test normalization against native output schema changes. An unknown engine/rules/DB version or malformed/truncated output must fail the adapter clearly, never become “zero findings.”
7. Benchmark a medium and large repository on both architectures; set explicit time/memory/file/output budgets and document exclusions. Run false-positive review with a security engineer before promoting rule or DB updates.

## Sources

All accessed 2026-07-27.

- Syft repository, formats, ecosystems and Apache-2.0 license: https://github.com/anchore/syft
- Syft releases (architecture assets, checksums, signatures, SBOMs): https://github.com/anchore/syft/releases
- OSV-Scanner repository, offline mode, license and remediation warning: https://github.com/google/osv-scanner
- OSV supported manifests and offline-resolution limitations: https://google.github.io/osv-scanner/supported-languages-and-lockfiles/
- Gitleaks repository, redaction/report formats, license: https://github.com/gitleaks/gitleaks
- Gitleaks releases: https://github.com/gitleaks/gitleaks/releases
- Trivy repository scanning: https://www.trivy.dev/docs/latest/guide/target/repository/
- Trivy license scanning: https://www.trivy.dev/docs/latest/scanner/license/
- Trivy secret scanning: https://www.trivy.dev/docs/latest/guide/scanner/secret/
- Trivy reporting/SARIF: https://trivy.dev/docs/v0.59/configuration/reporting/
- Trivy releases and signed multi-arch assets: https://github.com/aquasecurity/trivy/releases
- Opengrep repository, languages, output, LGPL and signed releases: https://github.com/opengrep/opengrep
- Semgrep CLI safety/network/metrics/output options: https://semgrep.dev/docs/cli-reference
- Semgrep community rules repository: https://github.com/semgrep/semgrep-rules
- Semgrep Rules License (not redistributable/serviceable): https://semgrep.dev/legal/rules-license/
- scc repository, formats, complexity caveat and MIT license: https://github.com/boyter/scc
- PMD/CPD languages and current release: https://pmd.github.io/index.html
- PMD report formats: https://pmd.github.io/pmd/pmd_userdocs_report_formats.html
- PMD redistribution license: https://pmd.github.io/pmd/license.html
- Microsoft warning and non-mutating/report flags for `dotnet format`: https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format
- RuboCop JSON format and MIT license: https://docs.rubocop.org/rubocop/latest/formatters.html and https://docs.rubocop.org/rubocop/latest/about/license.html
- PHPStan JSON format: https://phpstan.org/user-guide/output-format
- Ruff check-only/output behavior and images: https://docs.astral.sh/ruff/configuration/ and https://docs.astral.sh/ruff/installation/
- ZAP Baseline behavior and formats: https://www.zaproxy.org/docs/docker/baseline-scan/
- ZAP API Scan active-rule behavior: https://www.zaproxy.org/docs/docker/api-scan/
- ZAP Docker release/update behavior: https://www.zaproxy.org/docs/docker/about/
- Playwright container hardening, version pinning and libc constraints: https://playwright.dev/docs/docker
- CodeQL use constraints and SARIF: https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-cli/sarif-output

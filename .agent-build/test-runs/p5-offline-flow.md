# P5 offline local flow QA

Date: 2026-07-28  
Scope: `scripts/run-offline-assessment.mjs`, `tests/offline-assessment.integration.test.ts`,
`docs/offline-assessment.md`, and the current analyzer/evidence/reporting/packaging contracts.  
Verdict: **PASS for the P5 offline draft contract; customer release remains BLOCKED at P7.**

The deterministic offline draft flow works as documented. It must remain
`DRAFT_VALIDATED_RELEASE_BLOCKED`; full customer release remains P7-blocked.

## Final recheck of P5-OFF-001 and P5-OFF-002

The results in this section supersede the original defect observations later retained for audit
history.

- Focused integration:

  ```sh
  pnpm exec vitest run tests/offline-assessment.integration.test.ts --reporter=verbose
  ```

  Result: PASS, 1 file and 3 tests passed in 4.34s. The suite now directly covers the seven
  ecosystems, dirty tracked and untracked paths, before/after source-integrity binding,
  determinism, and rejection of a newline filename without producing output.

- Independent hostile-status fixture:
  `/tmp/rak-qa-offline-recheck-VOmflT`

  The successful frozen worktree contained:

  ```text
   M README.md
  R  old-name.txt -> "renamed target.txt"
  ?? -leading.txt
  ?? "space name.txt"
  ?? "unicodé.txt"
  ```

  The real CLI returned `DRAFT_VALIDATED_RELEASE_BLOCKED`. Its ZIP SHA-256 was
  `533764bc29358e554edfdfa0ef5f10ca29b23f6cb0105bcc3e7b960afd018c4c`.

  `data/target-snapshot.json` and both sides of `data/source-integrity.json` contained the same
  normalized, UTF-8-sorted inventory:

  ```json
  [
    "-leading.txt",
    "README.md",
    "old-name.txt",
    "renamed target.txt",
    "space name.txt",
    "unicodé.txt"
  ]
  ```

  `excludedDirtyPaths` was empty, as required for the frozen-only mode. The rename source and
  destination were both retained, so the Git status transition was not collapsed.

- Source binding: before/after `manifestDigest` and `sourceDigest` were identical at
  `sha256:bf0f69aafaaa7a8c260a385118d5a27c83520806cadb3276cfe448f96e8542a2`;
  before/after `statusDigest` was
  `sha256:9a520f0359a842992ffa76b87820b267824532276312ccc65f8f2210f7dc213a`.
  The same source digest appeared in the target snapshot, run record, and external validation
  certificate. `data/source-integrity.json` was covered by `manifest.json`.

- Hostile path rejection: the focused test's newline filename and an independent
  `back\slash.txt` fixture both failed with
  `Git status contains an unsafe repository-relative path`; their output roots remained empty.
  A NUL filename is rejected by the host filesystem/Node API before assessment.

- Frozen-only behavior: attempting to pass `--mode commit-only` exited 1 with
  `Unknown or incomplete argument: --mode`. The CLI does not silently switch capture modes.

- Root command documentation:

  ```sh
  pnpm assessment:offline -- \
    --source /tmp/rak-qa-offline-recheck-VOmflT/source \
    --project root-command-check \
    --discovery /tmp/rak-qa-offline-recheck-VOmflT/discovery.json \
    --output-root /tmp/rak-qa-offline-recheck-VOmflT/root-command-output \
    --generated-at 2026-07-28T13:02:00.000Z
  ```

  Historical result: FAIL because the standalone separator was forwarded to Node.

  Final corrected command, exactly as documented:

  ```sh
  pnpm assessment:offline \
    --source /tmp/rak-qa-offline-recheck-VOmflT/source \
    --project root-command-doc-final \
    --discovery /tmp/rak-qa-offline-recheck-VOmflT/discovery.json \
    --output-root /tmp/rak-qa-offline-recheck-VOmflT/root-command-doc-final \
    --generated-at 2026-07-28T13:04:00.000Z
  ```

  Final result: PASS, exit 0 with `DRAFT_VALIDATED_RELEASE_BLOCKED`. Separately,
  `pnpm assessment:offline --help` printed usage and exited 0. The prose now correctly says
  “five workspace packages” and lists five filters.

## Test environment and reproducible commands

- Target: `/workspace/rendervo-alt-3bcd18f5/targets/repo-assessment-kit`
- Node/pnpm workspace dependencies were already installed.
- Focused package build:

  ```sh
  pnpm --filter @rak/contracts \
    --filter @rak/analyzers \
    --filter @rak/evidence \
    --filter @rak/reporting \
    --filter @rak/packaging build
  ```

  Result: PASS, all five packages built.

- Seven-ecosystem offline integration:

  ```sh
  pnpm exec vitest run tests/offline-assessment.integration.test.ts --reporter=verbose
  ```

  Original result: PASS, 1 file and 2 tests passed in 4.48s. Final recheck result: PASS,
  1 file and 3 tests passed in 4.34s. The test created fresh Node, Python,
  Go, Java, .NET, Ruby, and PHP Git repositories and invoked the real offline CLI against
  every repository.

- Contract suites:

  ```sh
  pnpm exec vitest run \
    packages/analyzers/test/index.test.ts \
    packages/evidence/test/index.test.ts \
    packages/reporting/test/index.test.ts \
    packages/packaging/test/index.test.ts \
    --reporter=verbose
  ```

  Result: PASS, 4 files and 47 tests passed in 2.10s.

  Final recheck including contracts: PASS, 5 files and 51 tests passed in 2.66s.

- Independent adversarial fixture root:
  `/tmp/rak-qa-offline-adversarial-wKyjv8`
- Independent run output:
  `/tmp/rak-qa-offline-adversarial-wKyjv8/generated/adversarial-fixture-9574e03d04ae182f1d3814c892b380e5717b2f24-20260728T123456Z`
- Independent repeat output:
  `/tmp/rak-qa-offline-adversarial-wKyjv8/generated-repeat/adversarial-fixture-9574e03d04ae182f1d3814c892b380e5717b2f24-20260728T123456Z`

The independent fixture had:

- a tracked modification to `README.md`;
- untracked `UNTRACKED.txt`;
- configured `core.hooksPath` and `core.fsmonitor` canaries;
- package-manager and target-execution canaries;
- an unreachable proxy/network canary;
- a seeded AWS-shaped credential, absolute host path, and production-shaped endpoint;
- one owner-stated discovery topic and nine explicit unknowns.

The real CLI invocation was:

```sh
HTTP_PROXY=http://127.0.0.1:9 \
HTTPS_PROXY=http://127.0.0.1:9 \
ALL_PROXY=http://127.0.0.1:9 \
NO_PROXY= no_proxy= \
node scripts/run-offline-assessment.mjs \
  --source /tmp/rak-qa-offline-adversarial-wKyjv8/source \
  --project adversarial-fixture \
  --discovery /tmp/rak-qa-offline-adversarial-wKyjv8/discovery.json \
  --output-root /tmp/rak-qa-offline-adversarial-wKyjv8/generated \
  --generated-at 2026-07-28T12:34:56.000Z
```

Result: exit 0 with `DRAFT_VALIDATED_RELEASE_BLOCKED`.

## Acceptance matrix

| Check | Result | Evidence and reproduction |
| --- | --- | --- |
| Seven supported ecosystems | PASS | The focused integration test created and assessed fresh Node, Python, Go, Java, .NET, Ruby, and PHP repos. It asserted the matching `primaryEcosystem`, unchanged source digest, no package-script execution, and draft-only status for each. |
| Full commit/run identity and generated naming | PASS | Independent commit `9574e03d04ae182f1d3814c892b380e5717b2f24` appears in stdout, `data/run.json`, `data/target-snapshot.json`, validation certificate, run-directory name, and `-DRAFT.zip` name. Directory matched `adversarial-fixture-<full-sha>-20260728T123456Z`. |
| Dirty/untracked source identity description | PASS | Final focused integration reports `README.md` and `notes/untracked.txt`. Independent hostile-status recheck reported modified, rename-source, rename-destination, leading-dash, spaced, and Unicode paths in both `data/target-snapshot.json` and `data/source-integrity.json`; `excludedDirtyPaths` remained empty for frozen mode. P5-OFF-001 is resolved. |
| Before/after source unchanged | PASS | External file hashes and Git status were unchanged by both the original and final runs. Final hostile-status run recorded identical before/after manifest/source digest `sha256:bf0f69aafaaa7a8c260a385118d5a27c83520806cadb3276cfe448f96e8542a2` and status digest `sha256:9a520f0359a842992ffa76b87820b267824532276312ccc65f8f2210f7dc213a`; that source digest also matched the run record and validation certificate. |
| Hooks and fsmonitor suppressed | PASS | Configured hook and fsmonitor scripts would create marker files. After the real CLI run, `HOOK_EXECUTED=ABSENT` and `FSMONITOR_EXECUTED=ABSENT`. Implementation passes `core.hooksPath=/dev/null`, `core.fsmonitor=false`, and `core.untrackedCache=false` to fixed Git argv. |
| Package manager and target code not executed | PASS | Fixture `preinstall`, test script, and executable target canaries would create markers. `PACKAGE_MANAGER_EXECUTED=ABSENT` and `TARGET_CODE_EXECUTED=ABSENT`. Technical report states no target build, test, hook, package manager, or executable configuration ran. |
| No network use | PASS | The CLI completed with all proxy variables pointed at closed `127.0.0.1:9` and no bypass. Native tool records report `networkUsed:false`; all external scanners were `not-invoked`. This proves the tested path did not require outbound traffic, though syscall-level tracing was unavailable. |
| Ten discovery topics and explicit unknowns | PASS | Integration test passed with ten unknown topics. Independent run retained exactly ten unique claims: one `owner-stated` claim and nine `unverified` claims with explicit unknown reason, confidence effect, coverage effect, and follow-up. Removing `buyers` caused exit 1 with `Required discovery topic is missing: buyers`. |
| Allowed provenance and feature/evidence references | PASS | Analyzer suite passed feature extraction for documented and code-inferred features and rejected a missing feature evidence ID. Reporting suite rejected unsupported provenance and missing finding/decision evidence. The independent package passed `validateAssessmentReferences`; every retained finding/feature/coverage evidence reference resolved. |
| Fifteen-domain coverage honesty | PASS | Independent package contained all 15 domains; every record had `plannedControls=1`, `reconciledControls=1`, and counts summing to one. Runtime/browser were `blocked`; unavailable scanner/review domains were `not tested`; static domains were `partial`. No unavailable area was reported as pass. |
| Tool-unavailable honesty | PASS | Native assessment contained eight tool records. Only `kit-walker` was available/invoked. `scc`, Syft, OSV-Scanner, Gitleaks, Trivy, Opengrep, and PMD/CPD were all `unavailable`, `not-invoked`, `not-run`, with `TOOL_UNAVAILABLE`, `networkUsed:false`, and `targetCodeExecuted:false`. |
| General security baseline and deeper-profile guidance | PASS | Independent output applied `OWASP-ASVS/5.0.0/L1` at reduced depth. Express evidence triggered an `OWASP-ASVS/5.0.0/L2` recommendation marked `recommended-not-confirmed` and customer-confirmation-required. Analyzer tests also passed selected-overlay separation and invalid/unconfirmed overlay rejection. |
| Seeded secret, SSH material, and host-path absence | PASS | The seven-ecosystem integration asserted the seeded value `AKIAIOSFODNN7EXAMPLE` was absent from ZIP bytes. Independent ZIP scan found none of that value, `/home/qa/private/customer.db`, `BEGIN OPENSSH PRIVATE KEY`, or `SSH_AUTH_SOCK`. Evidence tests passed redaction-before-hashing; packaging tests passed rejection of AWS-shaped secrets, host paths, placeholders, and SSH keys. |
| Screenshot reason | PASS | `data/screenshots.json` contained one `unavailable` item with reason: `Runtime and browser execution are disabled in offline local static mode.` Reporting and packaging suites passed missing-reason/missing-evidence rejection. |
| Equal-criteria three-option decision | PASS | `reports/decision.md` and `data/decision.json` compare remediation, incremental replacement, and full rebuild across the same seven criteria, give a conditional remediation-to-incremental sequence, low confidence, and reversal conditions. |
| Native assessment validation | PASS | Independent ZIP was reopened and passed `validateNativeAssessmentProjection` and `validateAssessmentReferences`. Analyzer tests passed malformed, missing-key, unknown-key, and contradictory-coverage rejection. |
| SARIF validation | PASS within declared offline subset | Independent `exports/findings.sarif.json` declared SARIF 2.1.0 and passed `validateSarifProjection` against native findings. Analyzer tests passed strict nested-key, CWE 4.20, evidence, and malformed-projection rejection. Full official-schema execution remains explicitly unavailable and release-blocking. |
| CycloneDX validation | PASS within declared offline subset | Independent `exports/sbom.cdx.json` declared CycloneDX 1.7, contained a dependency graph/composition, and passed `validateCycloneDxProjection`. Strict malformed and duplicate-reference tests passed. Full official-schema execution remains explicitly unavailable and release-blocking. |
| CSV validation/safety | PASS | Independent CSV had the required nine-column header. Analyzer tests passed deterministic projection and formula-leading-cell neutralization. |
| Manifest, internal checksums, and detached checksum | PASS | Reopened ZIP had 30 entries, 28 manifest entries covering every payload item other than the self-referential `manifest.json` and `SHA256SUMS`, plus 29 valid internal checksum lines. Running `sha256sum -c <zip>.sha256` from the run directory returned `<zip>: OK`. |
| ZIP reopen in a fresh process | PASS | External certificate reported `zipReopenedInFreshParserInvocation:true` and `checksumEntriesVerified:30`. The focused integration test asserts the same for every ecosystem. |
| ZIP tamper rejection | PASS | A one-byte mutation of the independent ZIP, passed through the script's fresh validation mode, exited 1 with `data/evidence-index.json: ZIP CRC mismatch`. Packaging tests also passed ZIP/detached-digest and persisted fresh-process tamper rejection. |
| Deterministic repeat | PASS | Two independent output roots with identical source, discovery, project, and timestamp produced identical ZIPs. Both SHA-256 values were `5e0485d35981fb036a4f7517cead98b4ac9a97554a14d866f7017234d05df3c5`; `cmp` returned 0. |
| Draft-only release status and certificate honesty | PASS | Stdout and external certificate say `DRAFT_VALIDATED_RELEASE_BLOCKED`; internal status says `DRAFT_RELEASE_BLOCKED`; both set `customerReleaseAuthorized:false`. `data/reviews.json` has no reviews and says provider/human reviews are unavailable. Equivalence certificate is `unavailable`. Release blockers list provider analyses, independent security/decision reviews, technical/lay reviews, cross-provider equivalence, and complete official-schema validation. No provider, human, customer-release, compliance, or certification result is fabricated. |
| Hostile Git-status filenames | PASS | Newline and backslash filenames were rejected before output creation. Safe leading-dash, spaced, and Unicode filenames passed and were preserved exactly. A staged rename retained both original and destination paths. |
| Frozen-only behavior | PASS | The CLI and docs explicitly support only `frozen-working-tree`. `--mode commit-only` is rejected as an unknown argument; no fallback or false excluded-path inventory occurs. |
| Root CLI documentation | PASS | The corrected exact published command `pnpm assessment:offline --source ...` completed a full fixture assessment with `DRAFT_VALIDATED_RELEASE_BLOCKED`; `pnpm assessment:offline --help` exited 0. The prose says five workspace packages and lists five filters. P5-OFF-002 is resolved. |
| `generated/` exclusion | PASS | `.gitignore` contains `generated/`; `git check-ignore -v generated/probe` resolves to that rule. `.dockerignore` also excludes `generated`. |

## Resolved defects

### P5-OFF-001 — High — dirty and untracked inputs were falsely reported as absent

Owning lane: analyzer/offline orchestration.

Reproduction:

1. Create a local Git repo with a valid commit.
2. Modify a tracked file and create an untracked file.
3. Run the documented offline CLI.
4. Reopen the ZIP and inspect `data/target-snapshot.json`.

Expected:

- For `mode: "frozen-working-tree"`, every included dirty/untracked path is listed in
  `includedDirtyPaths`, or the run uses `commit-only` and lists omitted paths in
  `excludedDirtyPaths`.
- The list agrees with the captured Git porcelain-v2 state.

Original actual:

```json
{
  "mode": "frozen-working-tree",
  "includedDirtyPaths": [],
  "excludedDirtyPaths": []
}
```

while the source status was:

```text
1 .M N... README.md
? UNTRACKED.txt
```

Impact: the opaque source digest does bind the actual bytes and the assessment did not mutate them,
but a reviewer cannot tell that the assessed snapshot included uncommitted content. This contradicts
the architecture's local-source identity contract and makes the human-readable snapshot disposition
misleading.

Resolution verified: the CLI now parses NUL-delimited porcelain status, validates and sorts paths,
binds the status digest and path lists into the manifest/source digest, populates
`includedDirtyPaths`, writes `data/source-integrity.json`, and has focused regression coverage.
Tracked modifications, untracked paths, rename pairs, spaces, a leading dash, and Unicode all
passed. Newline and backslash paths failed closed without output.

### P5-OFF-002 — Medium — documented root invocation was not executable as written

Owning lane: docs/offline orchestration.

Current reproduction:

```sh
pnpm assessment:offline -- \
  --source /tmp/rak-qa-offline-recheck-VOmflT/source \
  --project root-command-check \
  --discovery /tmp/rak-qa-offline-recheck-VOmflT/discovery.json \
  --output-root /tmp/rak-qa-offline-recheck-VOmflT/root-command-output \
  --generated-at 2026-07-28T13:02:00.000Z
```

Expected: the documented root convenience command completes the same assessment as the direct Node
command.

Actual:

```text
$ node scripts/run-offline-assessment.mjs -- --source ...
offline assessment failed: Unknown or incomplete argument: --
[ELIFECYCLE] Command failed with exit code 1.
```

The working invocation omits the separator:

```sh
pnpm assessment:offline --source ... --project ... --discovery ... --output-root ...
```

That form exited 0 and returned `DRAFT_VALIDATED_RELEASE_BLOCKED`. The earlier
`pnpm assessment:offline -- --help` check was a false positive because the CLI handles `--help`
before parsing the unexpected separator. Separately, the docs say “Build the four workspace
packages” but list five packages.

Resolution verified: the standalone separator was removed and “four” was changed to “five.”
The exact corrected published command completed a full fixture assessment and returned
`DRAFT_VALIDATED_RELEASE_BLOCKED`. `pnpm assessment:offline --help` also exited successfully.

## Coverage notes

- The focused integration suite gives strong end-to-end evidence for all seven supported ecosystems,
  dirty/untracked identity, hostile control-character rejection, source immutability, and
  deterministic ZIP generation.
- The analyzer/evidence/reporting/packaging suites cover malformed manifests, symlinks, invalid
  UTF-8, reference integrity, coverage reconciliation, provenance, secret/host-path redaction,
  strict native/SARIF/CycloneDX projections, CSV injection safety, unsafe archive paths, required
  inventory, active HTML, checksums, fresh-process reopen, and tamper detection.
- The independent manual runs cover rename status, leading-dash/spaced/Unicode filenames,
  backslash rejection, explicit frozen-only behavior, hook and fsmonitor suppression,
  package-manager/target execution canaries, closed-proxy operation, missing discovery rejection,
  and direct inspection of the generated package.
- No syscall tracer was available, so the network result is based on a closed proxy canary, successful
  completion, fixed implementation subprocesses, and recorded tool metadata rather than syscall-level
  observation.
- This lane did not test SSH cloning, runtime/container launch, browser automation, Codex/Claude
  provider execution, platform matrix, human review, cross-provider equivalence, or customer release.
  Those are intentionally outside the offline-local contract and remain P7 release blockers.
- This QA lane modified only this report. The implementation lane added the dirty-path and hostile
  control-character regression coverage now present in
  `tests/offline-assessment.integration.test.ts`.

## Verdict

**PASS for the P5 offline draft contract.** The core local draft pipeline is deterministic,
non-executing, redacted, integrity-verifiable, honest about unavailable tools and release gates,
and now accurately binds and reports frozen-working-tree dirty/untracked disposition.
P5-OFF-001 and P5-OFF-002 are resolved. Both the direct Node flow and exact documented root
convenience flow pass.

Even after those fixes, this output must remain `DRAFT_VALIDATED_RELEASE_BLOCKED`. Full customer
release remains P7-blocked on provider runs, independent security and decision reviews, technical
and lay human reviews, cross-provider equivalence, complete official-schema validation, and the
required release/platform dry runs.

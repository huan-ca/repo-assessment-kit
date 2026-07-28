# P5/P6 integrated QA

Initial run: 2026-07-28 UTC  
Final corrected-tree recheck: 2026-07-28 UTC  
Target: `/workspace/rendervo-alt-3bcd18f5/targets/repo-assessment-kit`  
Product code was read-only during this verification.

## Verdict

**PASS for the deterministic P5 assessment-engine/deliverable implementation and the P6 local
web implementation. Customer release remains BLOCKED at P7.**

P5 and P6 may be recorded complete with their unavailable external/native/customer evidence
carried forward as explicit P7 release gates. The integrated repository builds and its complete
declared CI suite passes. The offline flow creates only
`DRAFT_VALIDATED_RELEASE_BLOCKED` output and the provider launchers fail closed, so this verdict
does not authorize a customer release or claim that AC-9/AC-10 have passed.

No new must-fix product defect reproduced in the P5/P6 deterministic scope. The corrected
cancellation, proxy-authority, acquisition, persistence/migration, HTTP hardening, packaging
provenance, and production-dependency changes passed without regression.

## Reproducible integrated evidence

Run from the target root:

```sh
pnpm run ci
```

Result: **PASS, exit 0**.

| Gate | Observed result |
| --- | --- |
| Prettier | All matched files use Prettier style |
| ESLint and package boundaries | PASS; 11 workspace manifests verified |
| Typecheck | PASS; 11 of 12 workspace projects plus the tests project |
| Vitest | PASS; 16 files, **132/132 tests** |
| Provider task runner | PASS; **10/10 Node tests** |
| Ecosystem fixtures | PASS; all seven roots verified |
| Launcher/shell syntax | PASS |
| Build | PASS; 11 of 12 workspace projects, including the production web bundle |
| Foundation smoke | PASS |
| Security smoke | PASS; provider, acquisition, network, and native gates verified |
| Production dependency audit | PASS; no known vulnerabilities at `high` threshold |

The line
`offline assessment failed: Git status contains an unsafe repository-relative path` is the
expected hostile-path negative case inside a passing offline integration test, not a CI failure.

The 132 Vitest tests include:

- 23 analyzer, 4 evidence, 9 reporting, and 12 packaging tests;
- 13 runtime signed-control-plan and policy tests;
- 13 agent-adapter tests plus the separate 10-test executable provider-runner suite;
- 12 server API, 3 local-acquisition, 4 contract, 3 workflow, and 1 persistence tests;
- 10 web model/API/proxy tests;
- 22 foundation tests; and
- 3 real offline-orchestration integration tests.

The corrected-tree additions directly exercise:

- DRAFT cancellation revoking pending/uploaded secret material without creating an invalid
  lifecycle transition;
- pinned proxy authority acceptance while rejecting attacker-controlled matching `Host` and
  `Origin`;
- escaping tracked-symlink rejection during local acquisition without source mutation;
- complete frozen OpenAPI operation/header/schema publication;
- startup migration-chain, backup, reopen, and terminal-immutability behavior;
- hardened evidence and package response admission;
- derivation of package eligibility from frozen provenance, including O1/O2 exclusion and O3/O4
  proof gates; and
- staging-tree symlink rejection.

### Production dependency audit

```sh
pnpm audit --prod --audit-level high
```

Result: **PASS, exit 0**:

```text
No known vulnerabilities found
```

### Offline command and safe local fixtures

```sh
pnpm assessment:offline --help
```

Result: **PASS, exit 0**. The documented arguments are
`--source`, `--project`, `--discovery`, `--output-root`, and optional `--generated-at`.

The complete CI run invoked
`tests/offline-assessment.integration.test.ts`, which created fresh local Git repositories for
Node/TypeScript, Python, Go, Java, .NET, Ruby, and PHP and ran the real offline CLI against each.
All three integration tests passed. They verify unchanged source bytes, exact commit/run binding,
dirty and untracked path accounting, no package-script execution, seeded-secret exclusion,
deterministic ZIP bytes, and hostile control-character path rejection.

The focused offline evidence in `.agent-build/test-runs/p5-offline-flow.md` additionally records
fresh-process ZIP reopening, checksum verification, tamper rejection, ten discovery topics,
fifteen coverage domains, and the intentional `DRAFT_VALIDATED_RELEASE_BLOCKED` result.

### Provider and native release-gate probes

```sh
./start-codex.sh run
./start-cc.sh run
```

Observed:

```text
Codex exit:       78
Claude Code exit: 78
run requires the P5 task broker; direct provider execution is refused
```

This is the required fail-closed behavior for P5. It is also direct evidence that the real
end-to-end agent runs required by AC-9 have not occurred and cannot be credited.

`docker`, `limactl`, `age`, and `claude` were not installed in this environment. The Codex CLI was
present, but unbrokered execution remained refused. `generated/probe` resolved to the
`generated/` rule in `.gitignore`.

### Browser evidence reviewed

The final real-browser report is `.agent-build/test-runs/p6-browser.md`; screenshots and probe
scripts are under `.agent-build/test-runs/p6-browser/`.

Current evidence establishes:

- bootstrap returned 204, removed the fragment, and established an HttpOnly,
  `SameSite=Strict` session;
- live `/api/v1/system`, `/api/v1/source-handles`, and `/api/v1/runs?limit=1` returned 200;
- the live zero-run workspace did not substitute the preview fixture;
- `/health/live` returned 200 through the strict loopback preview proxy;
- the explicit preview exercised welcome/setup, all ten discovery topics, consent boundaries,
  runtime-blocked/static-continues state, progress, pause/cancel recovery language, all six
  coverage states, findings/evidence, the equal-criteria three-option decision, package gating,
  limitations, and glossary/help;
- no credential value was rendered or written to local/session storage;
- the checked 320 CSS px routes had no horizontal overflow, and keyboard focus, headings,
  landmarks, and the live status region were present; and
- the browser reported no final console errors.

This supports the P6 implementation verdict. The full human/accessibility/platform release
matrix remains listed below rather than being inferred from the screenshots.

## Acceptance matrix

| Criterion | P5/P6 result | Evidence and release boundary |
| --- | --- | --- |
| AC-1 guided discovery and provenance | **PASS** | Strict contracts and the offline integration require all ten topics; explicit unknowns carry confidence/coverage effects and follow-up. Only the seven frozen provenance labels are admitted. |
| AC-2 controlled target and immutability | **PASS for local deterministic path; SSH release proof BLOCKED** | Real local Git fixture runs record a full SHA, bind before/after source digests, preserve dirty/untracked inventory, reject escaping tracked symlinks, and leave source unchanged. The API accepts the typed SSH source contract but requires the trusted acquisition worker; no real private SSH clone was performed. |
| AC-3 complete static assessment | **PASS at declared reduced depth** | Seven ecosystems produce the required domain/evidence/feature/security projections, with absent scanners explicitly unavailable/not invoked. Security remains independently reviewable. Real external scanner depth is a P7 gate. |
| AC-4 safe runtime assessment | **PASS for gate/blocked/static-continuation behavior; real isolated runtime BLOCKED** | Runtime policy, signed dynamic plans, budgets, broker admission, fail-closed provider/native gates, and honest blocked coverage pass deterministic tests. No Docker/Lima target was launched, so runnable-target and sentinel-production-endpoint proof remains P7 work. |
| AC-5 evidence, coverage, redaction, and package validation | **PASS for deterministic fixtures** | Reference validation, fifteen-domain reconciliation, provenance-derived O1/O2 exclusion and O3/O4 proof gates, seeded AWS/SSH/host-path exclusion, canonical HTML, staging-symlink rejection, manifest/checksums, fresh-process ZIP reopen, and tamper rejection pass. Complete official native/SARIF/CycloneDX schemas remain unavailable and release-blocking. |
| AC-6 modernization decision support | **PASS** | Reporting tests and the offline draft compare remediation, incremental replacement, and full rebuild across the same seven criteria, with evidence/unverified status, confidence, assumptions, dependencies, and reversal conditions. Compliance/certification language is constrained. |
| AC-7 baseline and overlays | **PASS for deterministic profile model** | General baseline is always present; selected overlays remain distinct and require customer confirmation; deeper-profile recommendations cite triggering evidence and remain recommendation-only. Real external controls are not represented as run. |
| AC-8 customer-ready package | **PASS for draft construction/integrity; customer-deliverable authorization BLOCKED** | Required inventory, safe static HTML, manifest, checksums, ZIP, detached digest, screenshot-unavailable reason, and redaction gates pass. Output remains explicitly draft/not released because official full schemas and human/provider reviews are absent. |
| AC-9 Codex/Claude compatibility | **PASS for typed contract parity; release criterion BLOCKED/FAIL** | Both providers share the same closed task capsule, canonical flags, receipt/proposal validation, output schema, and acceptance checks. Both public end-to-end `run` commands exit 78 without the trusted broker; no equivalent real ZIP pair exists. |
| AC-10 platform/docs/release readiness | **PASS for build/docs/static smoke and production dependency audit; release criterion BLOCKED/FAIL** | Workspace CI, launch syntax, loopback rules, docs, deterministic fixtures, and `pnpm audit --prod --audit-level high` pass. No Linux/macOS ARM64/x86-64 matrix, native Lima runtime, real agent dry runs, customer reviews, or real age encryption run was available. |

## P5/P6 done-when matrix

| Phase obligation | Result | Evidence |
| --- | --- | --- |
| P5 backend/shared acceptance suites | **PASS** | Full CI: 132/132 Vitest and 10/10 provider-runner tests; production high-severity audit reports no known vulnerabilities. |
| Seven first-class ecosystems | **PASS at declared reduced depth** | All seven fresh fixture repos assessed; unavailable tools remain explicit. |
| Blocked-runtime flow completes without invalidating static work | **PASS** | Runtime and offline tests plus browser coverage evidence. |
| Source remains unchanged | **PASS for local deterministic path** | Before/after source and Git status assertions across offline/local-acquisition tests. |
| Seeded secrets absent | **PASS for deterministic corpus** | Evidence/offline/package tests and ZIP-byte assertions. |
| Required draft package validates and verifies | **PASS** | Manifest, checksum, persisted fresh-process reopen, and tamper tests. Status remains draft/not released. |
| P6 primary and off-path UI states | **PASS for explicit preview plus live bootstrap/empty workspace** | Final browser report and screenshots 01–30. |
| P6 loopback/session/credential boundary | **PASS** | Strict proxy unit test, real bootstrap/session responses, and credential-storage/render checks. |
| P6 320 px and checked accessibility behavior | **PASS for exercised routes** | No overflow at 320; visible focus, heading/landmark/live-region evidence. |
| P6 full human/accessibility release proof | **DEFERRED TO P7** | No independent screen-reader session, 200% zoom run, complete 360/390/768/1024/1280/1440 matrix, or lay-human review was supplied. |

## Defects

No new deterministic P5/P6 defect was found.

The following are release blockers, not passing evidence and not waived by this report:

1. real Codex and Claude Code brokered end-to-end assessments with equivalent validated ZIPs;
2. real SSH acquisition through the trusted signer/helper boundary;
3. native-architecture Lima/Docker isolation and runnable/non-runnable target exercises without a
   host Docker socket;
4. real external scanner execution and complete official native, SARIF 2.1.0 Errata 01, and
   CycloneDX 1.7 schema validation;
5. Linux ARM64/x86-64 and macOS ARM64/x86-64 release smoke matrix;
6. hostile-provider/runtime/network/credential and sentinel-production-endpoint adversarial runs;
7. real `age` encryption and recovery proof when encryption is offered;
8. consultant technical review, customer/lay review, and full WCAG-oriented human/browser matrix;
   and
9. final release certificates/checklist and customer-release authorization.

## Coverage notes

- The CI result is reproducible and exercises the integrated product rather than isolated
  assertions only.
- Static/offline and fail-closed seams are strongly covered. Unavailable provider, VM, scanner,
  platform, SSH, encryption, and human-review systems were not silently passed.
- The browser report proves live bootstrap/empty-state integration and broad deterministic state
  presentation. It does not prove a complete live run mutation sequence against a real provider,
  nor every design-spec viewport/screen-reader/zoom row.
- The strict validators exercised in P5 are checked-in reduced profiles. They are not substitutes
  for the official full-schema release gate.

## Release decision

**P5/P6 integration: PASS. P7 customer release: NO-SHIP / BLOCKED.**

The deterministic implementation is ready to enter P7 adversarial verification. It is not
customer-release ready until every blocker above has reproducible evidence and the final P7
checklist is signed off.

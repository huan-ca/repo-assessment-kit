# P5 QA — evidence and analyzers

Date: 2026-07-28  
Scope: `packages/evidence/**`, `packages/analyzers/**`, and the seven
`fixtures/ecosystems/**` roots only.  
Verdict: **PASS for the evidence/analyzers slice; external and official full-schema release
gates remain BLOCKED**

## Final narrow recheck — 2026-07-28

Final scoped verdict: **PASS**

This final recheck supersedes both earlier verdicts for the current implementation.

### Acceptance matrix

| Requirement | Result | Evidence |
|---|---|---|
| Focused typecheck/build/tests | **PASS** | `pnpm --filter @rak/evidence typecheck && pnpm --filter @rak/analyzers typecheck && pnpm --filter @rak/evidence build && pnpm --filter @rak/analyzers build && pnpm exec vitest run packages/evidence/test/index.test.ts packages/analyzers/test/index.test.ts --reporter=verbose && pnpm fixtures:verify` exited 0. Vitest reported 2 files and 27 tests passed; all seven fixture roots verified. |
| Native strict closed-key profile | **PASS** | Independent fixtures proved `validateNativeAssessmentProjection` rejects an unknown top-level property, a missing `runId`, and a missing nested profile-control `reason`; `projectNativeJson` also rejects the unknown-property assessment. Critical nested arrays and profile coverage keys have exact-key/required-key checks. |
| SARIF strict closed-key profile | **PASS** | Independent fixtures proved rejection of unknown top-level data, missing `runs`, an unknown nested tool-driver property, and missing nested driver `name`. Existing semantic checks still enforce frozen version, structured CWE taxonomy, rules/results, fingerprints, locations, and native finding/evidence references. |
| CycloneDX strict closed-key profile | **PASS** | Independent fixtures proved rejection of unknown top-level data, missing `metadata`, an unknown nested metadata property, and missing nested metadata `component`. Existing semantic checks still enforce frozen version/profile, component/dependency references, purls, composition, and sensitive-output rules. |
| Full-schema metadata honesty | **PASS; release gate BLOCKED** | `offlineProjectionSchemaProfiles` identifies all three validators as `checked-in-strict-subset`, sets `officialFullSchemaBundled:false`, and names a separate release gate for the complete native schema, official SARIF 2.1.0 Errata 01 schema, and official CycloneDX 1.7 schema. The implementation does not misrepresent subset validation as official full-schema validation. Those full-schema gates remain outstanding release work, not a pass. |
| Supported overlay selection | **PASS** | Unsupported IDs, duplicate IDs, unconfirmed selection, blank confirmation references, and application metadata without selected IDs are rejected. Supported IDs with `customerConfirmed:true` and a nonblank confirmation reference are accepted. |
| Baseline/selected/recommended distinction | **PASS** | The baseline is exactly one `baseline`/`always-applied`/`applied-reduced-depth` profile with partial coverage and no customer-confirmation claim. Selected ASVS L2 and WSTG profiles are `selected-overlay`/`operator-selected`, retain the confirmation reference, and honestly report partial/blocked coverage. Without selection, the Flask-triggered ASVS L2 signal remains `overlay-recommendation`/`recommended-only`/`recommended-not-confirmed` with `not tested` coverage. A selected profile is not simultaneously emitted as a recommendation. |
| Coverage reconciliation | **PASS** | Normal domain coverage reconciles. Profile controls reconcile exactly to planned/reconciled totals and status counts. Independently changing a selected overlay's count caused `validateAssessmentReferences` to reject the assessment. Prior forged domain-coverage regression remains passing. |
| External scanner/Docker/runtime evidence | **BLOCKED, correctly gated** | Docker, scc, Syft, OSV-Scanner, Gitleaks, Trivy, Opengrep, PMD, and CPD remain unavailable. Tool records remain unavailable/not-invoked/not-run, and runtime domains remain reduced/blocked rather than successful. |

### Defects

No remaining defect was found in the requested narrow recheck.

### Coverage notes

- The checked-in strict subset validators now fail closed for the exercised top-level and
  critical nested keys. They are intentionally not evidence that complete official
  schemas pass.
- Official full-schema validation, real scanner adapters, Docker/runtime isolation,
  native-output version drift, hostile output/resource fixtures, and multi-architecture
  execution remain explicit release gates outside this successful narrow recheck.

### Final verdict

**PASS for the current evidence/analyzers slice.** Strict subset validation, overlay
selection/confirmation, profile distinction, and coverage reconciliation satisfy the
requested recheck. Overall product release remains **BLOCKED** on the honestly declared
official full-schema and external tool/runtime gates.

## Recheck — 2026-07-28

Previous recheck verdict (superseded): **NEEDS FIXES**

This recheck supersedes the initial matrix below for current implementation status. The
initial findings remain as audit history.

### Recheck acceptance matrix

| Requirement | Result | Current evidence |
|---|---|---|
| Focused typecheck/build/tests | **PASS** | `pnpm --filter @rak/evidence typecheck && pnpm --filter @rak/analyzers typecheck && pnpm --filter @rak/evidence build && pnpm --filter @rak/analyzers build && pnpm exec vitest run packages/evidence/test/index.test.ts packages/analyzers/test/index.test.ts --reporter=verbose && pnpm fixtures:verify` exited 0. Vitest reported 2 files and 24 tests passed; fixture verification reported all seven roots verified. |
| Seven ecosystem detection and declared depth | **PASS** | Independent iteration over Node/TypeScript, Python, Go, Java, .NET, Ruby, and PHP detected every expected ecosystem. Every result now sets `reducedDepth:true`; only `kit-walker` is invoked; partial/not-tested/blocked domains remain visible with limitations. The prior contradictory full-depth declaration is fixed. |
| No target execution/network and absent scanner honesty | **PASS for deterministic static slice; external proof BLOCKED** | The original `preinstall` canary remained absent. scc, Syft, OSV-Scanner, Gitleaks, Trivy, Opengrep, and PMD/CPD all remain `unavailable`/`not-invoked`/`not-run`; records say `networkUsed:false` and `targetCodeExecuted:false`. `command -v` confirms Docker and all external tools are unavailable. No real tool, Docker, or runtime result is credited as a pass. |
| AC-3 feature/use-case evidence traceability | **PASS for this slice** | Every feature now carries at least one evidence occurrence ID; all feature and finding IDs resolved in the independent hostile fixture. `projectNativeJson` invokes `validateAssessmentReferences`, and a missing feature evidence ID is regression-tested. Full substantive external-scanner/provider assessment remains downstream/gated. |
| AC-5 coverage reconciliation | **PASS** | The original forged coverage array (`status:"pass"` with `partial:1`, no reasons/evidence) is now rejected. Aggregate/count consistency, non-negative integer counts, and non-pass reason/evidence are regression-tested. |
| AC-5 secret and host-path redaction | **PASS for seeded deterministic fixtures** | `/tmp/customer/private/token.txt` is detected and redacted; admitted serialization no longer contains it. The README `/tmp/...` feature-heading fixture is absent from native, SARIF, CycloneDX, and CSV outputs. Existing AWS/private-key/credential and `/home`/Windows fixtures still pass. |
| Malformed/unsupported input honesty | **PASS for tested inputs** | Malformed JSON and invalid UTF-8 remain explicit limitations. `package-lock.json` with `lockfileVersion:999` now emits an unsupported-version limitation, retained opaque inventory evidence, partial inventory coverage, and `reducedDepth:true`. |
| AC-7 baseline and overlays | **FAIL** | `securityProfileSignals` now distinguishes an ASVS L1 `baseline` from evidence-triggered `overlay-recommendation` records, and recommendations remain customer-unconfirmed. However, the baseline state is only `planned-not-tested`, `AssessRepositoryOptions` exposes no supported overlay selection, and no configured overlay result can be applied/reported. This does not satisfy “every assessment applies a general baseline” or “operator can configure a supported framework overlay.” External scanners being unavailable explains reduced coverage but does not implement the configuration contract. |
| Native JSON strict contract | **FAIL** | References, coverage, redaction, and deterministic serialization pass, but no strict RAK assessment JSON Schema is bundled/applied. Adding `unknownForbiddenByStrictRakSchema:true` to an assessment is accepted by `projectNativeJson`. Architecture §8 requires strict schemas with unknown fields rejected. |
| SARIF projection | **FAIL — semantic fixes pass, official schema gate missing** | Structured CWE 4.20 taxonomy, rule relationships, resolvable finding/evidence IDs, safe paths, and malformed semantic fixture rejection now pass. No official Errata 01 schema is bundled or evaluated. Adding an unknown top-level property is accepted by `validateSarifProjection`, showing it is not the official strict schema gate required by the standards research. |
| CycloneDX projection | **FAIL — semantic fixes pass, official schema gate missing** | The local validator checks frozen version/profile, refs, purls, dependencies, composition, and sensitive output. No official CycloneDX 1.7 schema is bundled or evaluated. Adding an unknown top-level property is accepted by `validateCycloneDxProjection`. |
| CSV projection | **PASS for prior defect** | The original `=2+2.js:1` cell is now emitted with a leading apostrophe and no raw formula-leading quoted cell. Regression test passes. |
| AC-8 package contribution | **FAIL** | Native/SARIF/CycloneDX strict-schema gates remain incomplete, so these projections are not release-valid yet. Manifest/checksum/ZIP behavior remains outside this package assignment. |

### Prior defect disposition

| Initial defect | Recheck |
|---|---|
| `/tmp` host path leakage | **FIXED** |
| Coverage aggregate/reason validation | **FIXED** |
| Feature catalog lacked evidence links | **FIXED** |
| CSV formula-leading fields | **FIXED** |
| Seven ecosystems incorrectly labeled full depth | **FIXED** |
| Unsupported npm lockfile version silently ignored | **FIXED** |
| SARIF CWE only in free-form tags | **FIXED** |
| Official SARIF/CycloneDX schema validation absent | **OPEN** |
| AC-7 baseline/overlay configuration absent | **OPEN** |

### Recheck defects

#### P1 — Official strict native, SARIF, and CycloneDX schema validation is absent

Likely owner: contracts/analyzers.

Evidence:

- Repository schema search finds only RAK run-document and signed-control-plan schemas; no
  assessment, SARIF Errata 01, or CycloneDX 1.7 schema asset.
- `validateSarifProjection` and `validateCycloneDxProjection` are useful local semantic
  checks, but both accept an added unknown top-level property.
- `projectNativeJson` likewise accepts an unknown assessment property.

Reproduction:

```bash
node --input-type=module <<'NODE'
import path from 'node:path';
import {
  assessRepository, projectNativeJson, projectSarif, projectCycloneDx,
  validateSarifProjection, validateCycloneDxProjection
} from './packages/analyzers/dist/index.js';
const options={
  runId:'run_01900000-0000-7000-a000-000000000001',
  snapshotId:'snp_01900000-0000-7000-a000-000000000001',
  generatedAt:'2026-07-28T00:00:00.000Z'
};
const assessment=await assessRepository(path.resolve('fixtures/ecosystems/python'),options);
projectNativeJson({...assessment,unknownForbiddenByStrictRakSchema:true});
const sarif={...projectSarif(assessment),unknownForbiddenByOfficialSchema:true};
const cdx={...projectCycloneDx(assessment),unknownForbiddenByOfficialSchema:true};
validateSarifProjection(sarif,assessment);
validateCycloneDxProjection(cdx);
console.log('all malformed unknown-property fixtures accepted');
NODE
```

Actual: all three malformed unknown-property fixtures are accepted.  
Expected: bundled, offline, official/strict schemas reject them before release, followed
by the existing RAK semantic gates.

#### P1 — AC-7 overlay selection/application contract is not implemented

Likely owner: analyzers/workflow/contracts.

Reproduction: inspect `AssessRepositoryOptions`, then assess any fixture and inspect
`securityProfileSignals`.

Actual: no overlay-selection option exists. The general baseline is
`planned-not-tested`; deeper profiles can only be `recommended-not-confirmed`.  
Expected: operator-selected supported overlays can be supplied, applied, and reported
distinctly from the always-applied baseline, while recommendations stay unconfirmed.

### Recheck coverage notes

- All seven original concrete defect reproducers were rerun independently and now pass.
- Docker, scc, Syft, OSV-Scanner, Gitleaks, Trivy, Opengrep, PMD, and CPD remain
  **BLOCKED/unavailable**. Native output parsing, timeout/OOM/output-flood behavior,
  tool-image provenance, offline DBs, and multi-architecture execution remain unverified.
- The fixture roots still contain only minimal manifests. Source-level rules across all
  seven languages, negative/native-output-version fixtures, malicious configs/build hooks,
  and output floods remain unverified.
- Dynamic runtime, package ZIP/checksum/reopen, and real framework execution are outside
  this assignment and are not silently passed.

### Recheck verdict

**NEEDS FIXES.** The seven previously actionable analyzer/evidence defects are fixed.
Release remains blocked on strict offline native/SARIF/CycloneDX schema validation and the
AC-7 baseline/overlay configuration contract. External tools and runtime remain honestly
gated rather than misclaimed.

## Initial acceptance matrix — superseded by the recheck above

| Requirement | Result | Evidence and reproduction |
|---|---|---|
| Focused type safety and unit suite | **PASS** | From the target root: `pnpm --filter @rak/evidence typecheck && pnpm --filter @rak/analyzers typecheck && pnpm exec vitest run packages/evidence/test/index.test.ts packages/analyzers/test/index.test.ts --reporter=verbose`. Both typechecks exited 0; Vitest reported 2 files and 17 tests passed. |
| Seven first-class ecosystems are detected | **PASS** | The focused suite exercised Node/TypeScript, Python, Go, Java, .NET, Ruby, and PHP. All seven expected primary ecosystems were detected. `pnpm fixtures:verify` also exited 0 with `seven ecosystem fixture roots verified`. |
| P5 done-when: every ecosystem yields declared depth or explicit reduced coverage | **FAIL** | All seven assessments set `reducedDepth: false`, while only `kit-walker` is invoked and the same results declare architecture, maintainability, features, inventory, secrets, and SAST `partial`; vulnerability and IaC/license checks `not tested`; and runtime/browser `blocked`. The limitations simultaneously say kit secret/SAST heuristics are reduced-depth. The top-level depth declaration therefore contradicts the detailed coverage and unavailable baseline analyzers. Repro: assess each `fixtures/ecosystems/<name>` with deterministic options and print `primaryEcosystem`, `reducedDepth`, invoked tools, coverage, and limitations. |
| AC-3: substantive static domains and honest feature/use-case traceability | **FAIL** | Composition and stack detection work, architecture/maintainability/runtime signals are explicitly heuristic, and malformed `package.json` becomes partial coverage. However, `FeatureCatalogItem` has no evidence ID and feature extraction creates no evidence occurrence. An adversarial README heading produced a documented feature while `assessment.evidence` had no matching path/line (`featureEvidenceResolved: false`). Thus a feature/use-case claim cannot be deterministically resolved to evidence. |
| AC-4 / safety §§6, 18: no target execution or network; unavailable runtime is not a pass | **PASS for the static slice; dynamic proof BLOCKED** | A fixture `package.json` contained a `preinstall` canary that would create `EXECUTED`; after assessment the canary did not exist. Source inspection found no child-process/network imports or calls in either package. Every tool record reports `networkUsed:false` and `targetCodeExecuted:false`. Runtime readiness and dynamic browser security are `blocked`, not pass. Docker is unavailable in this environment, so isolated runtime/real dynamic tooling was not verified and is not credited as a pass. |
| Absent scanner is never claimed | **PASS** | With no supplied tools, scc, Syft, OSV-Scanner, Gitleaks, Trivy, Opengrep, and PMD/CPD each report `availability:"unavailable"`, `invocation:"not-invoked"`, `outcome:"not-run"`, and `TOOL_UNAVAILABLE`. `command -v` confirmed Docker and all seven external tool commands are unavailable. |
| Malformed and unsupported inputs are honest | **FAIL** | Malformed `package.json` is correctly recorded as `malformed manifest; dependency extraction skipped` and dependency inventory is partial. In contrast, `package-lock.json` with `lockfileVersion:999` is silently ignored: no unsupported-version limitation is emitted (`unsupportedLockfileExplicitlyReported:false`). This violates the locked-format rule that unknown versions remain opaque evidence with explicit reduced coverage. |
| AC-5 / architecture §§8, 13, 17: finding/evidence linkage | **PASS for generated findings** | In the adversarial fixture, every generated finding evidence ID resolved to an existing evidence candidate (`findingEvidenceResolved:true`). Existing tests also prove identical bytes retain distinct occurrences while blobs deduplicate per run. |
| AC-5 / safety §§14, 18: coverage reconciliation and non-pass reasons | **FAIL** | Normal generated records include limitation IDs and arithmetically reconcile. The validator itself is not a semantic gate: it accepted all 15 forged records with `status:"pass"`, counts containing one `partial`, and empty limitation/evidence arrays. It checks only total counts, planned/reconciled equality, uniqueness, and domain count; it does not check aggregate status against counts or require a reason/evidence/limitation for non-pass controls. |
| AC-5 / safety §§14, 18: seeded secret and host-path redaction | **FAIL** | Existing tests pass for AWS-like keys, credential assignments, private keys, `/home`, `/workspace`, and Windows user paths. An independently seeded `trace=/tmp/customer/private/token.txt` was admitted with `redactionState:"none-required"`; `containsAbsoluteHostPath` returned false; `assertSafePublicEvidence` accepted it; serialized evidence retained the full path. A README heading containing `/tmp/customer/private/source` also survived native JSON. Absolute host-path release blocking is therefore incomplete. |
| AC-7: security baseline and overlay distinction | **FAIL** | The kit-owned secret/SAST heuristics run and are correctly labeled partial, but no baseline external scanner executes, vulnerability and IaC/license domains remain `not tested`, and this slice contains no configurable framework-overlay result or trigger recommendation. Real scanner proof is gated because binaries are unavailable; it is not treated as passing evidence. |
| Native JSON projection | **FAIL** | Projection is deterministic and includes coverage, tools, findings, and limitations, but it carries the `/tmp/...` host-path leak and unresolved feature claims described above. |
| SARIF 2.1.0 Errata 01 projection | **FAIL** | Shape checks pass (`version:"2.1.0"`, Errata 01 schema URI, results and evidence IDs). There is no official-schema or RAK semantic validation test. CWE is emitted only as a rule property tag such as `external/cwe/CWE-95`, with no SARIF taxonomy object, contrary to the standards profile's explicit “do not put CWE only in free-form tags” rule. |
| CycloneDX 1.7 projection | **PARTIAL / BLOCKED** | Shape checks pass (`bomFormat:"CycloneDX"`, `specVersion:"1.7"`, composition `unknown`) and no seeded AWS key or `/home` path appeared. No bundled official CycloneDX 1.7 schema or schema-validation test exists, so standards conformance and malformed-projection rejection are unverified. This is not a full pass. |
| CSV projection safety | **FAIL** | CSV is deterministic and quotes/escapes cells, but does not neutralize spreadsheet formulas. A finding in repo-relative path `=2+2.js` produced a cell beginning `=2+2.js:1`. Quoting is not a formula-neutralization policy for spreadsheet consumers; safety §18 explicitly requires formula fixtures. |
| AC-8 customer-ready package implications | **FAIL for this slice's release contribution** | The four machine projections exist, but native/SARIF/CSV blockers above prevent safe package admission. Package manifest/checksum/ZIP behavior is outside this assignment and was not credited or failed here. |

## Defects

### P1 — Absolute `/tmp` host paths pass evidence admission and native export

Likely owner: evidence/analyzers.

Reproduction:

```bash
node --input-type=module <<'NODE'
import { admitTextEvidence, assertSafePublicEvidence, containsAbsoluteHostPath } from './packages/evidence/dist/index.js';
const x=admitTextEvidence({
  runId:'run_01900000-0000-7000-a000-000000000001',
  snapshotId:'snp_01900000-0000-7000-a000-000000000001',
  activityId:'act_01900000-0000-7000-a000-000000000001',
  repoRelPath:'README.md', evidenceType:'fixture', title:'fixture',
  text:'trace=/tmp/customer/private/token.txt\n',
  capturedAt:'2026-07-28T00:00:00.000Z'
});
console.log(containsAbsoluteHostPath(x.safeText), x.occurrence.redactionState);
assertSafePublicEvidence(x);
console.log(JSON.stringify(x).includes('/tmp/customer/private/token.txt'));
NODE
```

Actual: `false none-required` followed by `true`; no exception.  
Expected: the absolute host path is redacted or the artifact is rejected.  
Impact: safety §19.2 defines any secret/host-path match as a package blocker.

### P1 — Coverage semantic validator accepts false aggregate status and missing reasons

Likely owner: analyzers/evidence contracts.

Reproduction: create one record for every `assessmentDomains` value with
`status:"pass"`, `plannedControls:1`, `reconciledControls:1`, counts containing
`partial:1` and `pass:0`, plus empty `limitationIds` and `evidenceOccurrenceIds`;
pass the array to `assertCoverageReconciles`.

Actual: no exception.  
Expected: deterministic rejection because aggregate status contradicts counts and the
non-pass control has no reason/evidence or limitation.

### P1 — Feature/use-case catalog claims cannot link to evidence

Likely owner: analyzers/evidence.

Reproduction: assess a repository containing only
`README.md` with `# Customer portal`. Inspect the resulting feature and evidence arrays.

Actual: a `documented` `FeatureCatalogItem` is created, but the item has no evidence
reference and no evidence occurrence is created for its path/line.  
Expected: each catalog assertion carries a resolvable evidence occurrence or is explicitly
unverified/conflicting under the canonical claim model.

### P1 — CSV permits formula-leading customer-controlled cells

Likely owner: analyzers/reporting.

Reproduction: assess a repository file named `=2+2.js` containing
`eval("fixture")`, then call `projectFindingsCsv`.

Actual excerpt:

```csv
"...","rak/dynamic-code-execution","=2+2.js:1","..."
```

Expected: spreadsheet-formula-neutralized cell content or a validated safe CSV profile.

### P1 — Seven ecosystems are labeled full depth while all scanner-backed domains are reduced

Likely owner: analyzers.

Reproduction: assess each root under `fixtures/ecosystems`. Print `reducedDepth`, invoked
tools, coverage, and limitations.

Actual: all seven return `reducedDepth:false`; only `kit-walker` runs; numerous required
domains are partial/not tested; limitations explicitly call the heuristics reduced-depth.  
Expected: a consistent declared depth, normally explicit reduced depth until the required
scanner adapters run successfully.

### P2 — Unsupported lockfile version is silently ignored

Likely owner: analyzers.

Reproduction: assess a Node fixture containing a valid `package.json` and:

```json
{"name":"qa","lockfileVersion":999,"packages":{}}
```

Actual: no limitation mentions the unsupported lockfile version and no opaque evidence is
created for it.  
Expected: explicit unsupported-version/reduced-coverage limitation and preserved opaque
evidence, never silent coercion or omission.

### P2 — SARIF CWE mapping is only a free-form tag; no schema validation exists

Likely owner: analyzers/contracts.

Reproduction: produce a heuristic finding, call `projectSarif`, and inspect
`runs[0].tool.driver.rules`.

Actual: CWE appears only in `properties.tags` (for example
`external/cwe/CWE-95`); no SARIF taxonomy is emitted. Tests assert only a small shape and do
not validate the official Errata 01 schema or RAK semantic profile.  
Expected: versioned CWE 4.20 SARIF taxonomy representation plus official-schema and
semantic validation.

## Coverage notes

- Verified deterministically: TypeScript builds, 17 focused tests, all seven ecosystem
  marker detections, generic fallback, symlink non-following, malformed `package.json`,
  bounded static signals, finding-to-evidence resolution, basic secret redaction,
  deterministic projections, scanner absence reporting, and a target-execution canary.
- Not verified because the environment lacks the binaries: Docker, scc, Syft, OSV-Scanner,
  Gitleaks, Trivy, Opengrep, PMD, and CPD. Their real native output parsing, version drift,
  timeout/output-flood/OOM behavior, ARM64/x86-64 images, licenses, digests, and offline DB
  behavior remain **BLOCKED**, not passed.
- The seven fixture roots contain manifests only; they do not exercise source-level rules
  in all seven languages, negative fixtures, malicious executable configs/build hooks,
  native scanner output version changes, or output floods required by architecture §17
  and safety §18.
- Official offline SARIF Errata 01 and CycloneDX 1.7 schema validation is absent.
- Packaging, ZIP reopen, checksums, screenshots/logs, framework overlays, independent
  security review, and dynamic runtime are outside the assigned package slice.

## Initial verdict — superseded

At the initial run, the verdict was **NEEDS FIXES**. Blocking items were absolute host-path leakage, weak coverage semantic
validation, unresolved feature evidence, formula-unsafe CSV, inconsistent reduced-depth
declaration, and nonconformant/unvalidated SARIF. Real scanner and Docker evidence remains
gated and must be supplied later; it is not a substitute for fixing the deterministic
failures above.

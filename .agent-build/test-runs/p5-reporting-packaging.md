# P5 QA — reporting and packaging

Initial run: 2026-07-28  
Second re-verification: 2026-07-28 00:56 UTC  
Narrow recheck: 2026-07-28 01:09 UTC  
Final structured-HTML recheck: 2026-07-28 01:16 UTC  
Scope: `packages/reporting/**` and `packages/packaging/**` only  
Final scoped verdict: **PASS — prior structured HTML bypasses are closed; release remains
explicitly blocked on unavailable official full schemas and external gates**

## Final structured-HTML recheck

This is the current scoped result. Subsequent sections are retained as historical QA
snapshots.

### Commands and focused suite

```sh
pnpm --filter @rak/reporting run clean
pnpm --filter @rak/reporting run build
pnpm --filter @rak/packaging run clean
pnpm --filter @rak/packaging run build
pnpm exec eslint packages/reporting/src/index.ts packages/reporting/test/index.test.ts packages/packaging/src/index.ts packages/packaging/src/zip-validator-cli.ts packages/packaging/test/index.test.ts --max-warnings 0
pnpm exec vitest run packages/reporting/test/index.test.ts packages/packaging/test/index.test.ts --reporter=verbose
```

Result: clean builds and focused ESLint passed; **2 test files and 20/20 tests passed**.

### Exact reproducer matrix

| Payload / invariant | Reporting result | Packaging result |
|---|---|---|
| Canonical renderer output | **PASS** | **PASS** through complete package test |
| `<marquee>` | **REJECT** — sanitation changed document | **REJECT** in complete package test |
| `<link rel="stylesheet" href="data:text/css,...">` | **REJECT** — sanitation changed document | **REJECT** in complete package test |
| `<a download href="data:text/html,...">` | **REJECT** — sanitation changed document | **REJECT** in complete package test |
| `onclick` event attribute | **REJECT** — sanitation changed document | **REJECT** in complete package test |
| inline `style` attribute | **REJECT** — sanitation changed document | **REJECT** by the same exercised packaging attribute gate, `\s(?:on[a-z]+|style|srcdoc)\s*=` |
| `srcdoc` attribute | **REJECT** — sanitation changed document | **REJECT** by the same packaging attribute gate |
| unknown attribute `x="1"` | **REJECT** — sanitation changed document | **REJECT** in complete package test |
| unknown `<blink>` tag | **REJECT** — sanitation changed document | **REJECT** in complete package test |
| Exact CSS changed and CSP hash recomputed | **REJECT** — release-owned CSS mismatch | **REJECT** — renderer CSS does not match release lock |
| Canonical sanitizer equality | **PASS** | **PASS** — locked canonical serializer requires byte equality |
| CSP/CSS lock | **PASS** | **PASS** |

Direct reporting output:

```text
ACCEPT canonical
REJECT marquee ... structured HTML sanitation changed the document
REJECT data-stylesheet ... structured HTML sanitation changed the document
REJECT data-download ... structured HTML sanitation changed the document
REJECT onclick ... structured HTML sanitation changed the document
REJECT style-attr ... structured HTML sanitation changed the document
REJECT srcdoc ... structured HTML sanitation changed the document
REJECT unknown-attr ... structured HTML sanitation changed the document
REJECT unknown-tag ... structured HTML sanitation changed the document
REJECT css-lock ... report CSS does not match the release-owned block
```

Reporting now rejects whenever `sanitizeHtml(input) !== input`; it no longer discards a
changed sanitizer result. Packaging independently parses the locked release grammar,
rejects unknown tags/attributes or noncanonical bytes, prohibits data downloads and active
attributes, and enforces the exact shared CSS digest lock. The original structured-HTML P1
is **closed**.

### Final scoped verdict

**PASS for the reporting/packaging structured HTML fix.** All exact prior bypasses now
fail closed and canonical output remains accepted. No new scoped defect was found.
This does not change the broader release state: official complete native/SARIF/CycloneDX
schemas remain unavailable and release-blocking, so package results correctly remain
`validated-not-released`; customer/native/Codex-Claude/real-age gates remain blocked and
are not claimed as passed.

## Narrow recheck

This 01:09 UTC result is historical and superseded by the final structured-HTML recheck
above. The subsequent sections retain the two earlier QA snapshots and their defect
history.

### Commands

```sh
pnpm --filter @rak/reporting run clean
pnpm --filter @rak/reporting run build
pnpm --filter @rak/packaging run clean
pnpm --filter @rak/packaging run build
pnpm exec eslint packages/reporting/src/index.ts packages/reporting/test/index.test.ts packages/packaging/src/index.ts packages/packaging/src/zip-validator-cli.ts packages/packaging/test/index.test.ts --max-warnings 0
pnpm exec vitest run packages/reporting/test/index.test.ts packages/packaging/test/index.test.ts --reporter=verbose
```

Result: clean builds and focused ESLint passed; **2 test files and 20/20 tests passed**.

### Narrow acceptance matrix

| Recheck | Result | Evidence |
|---|---|---|
| Typed digest-bound prerequisite certificate chain | **PASS for integrity/binding seam** | Certificates bind run, snapshot, package-request digest, artifact-set digest, prior certificate digest/output, validation-report digest, evidence IDs, time, issuer kind, and review panel. Mutating a hard-coded certificate output digest fails with `digest or derivation is invalid`. The focused happy path produces eight ordered certificates. This is deterministic integrity, not cryptographic authorship; the official/customer release gate remains closed. |
| Persisted ZIP validation in a fresh process | **PASS** | `validatePersistedZipInFreshProcess` invokes `dist/zip-validator-cli.js` with `process.execPath`; the test asserts returned PID differs from the parent. Persisted byte tampering makes the child validator fail. In-memory CRC and detached-digest tamper cases also fail. |
| Exact release-owned CSS lock | **PASS** | Reporting compares the sole style block to `REPORT_RENDERER_CSS`; packaging compares to the matching `LOCKED_REPORT_RENDERER_CSS`. Replacing CSS and recomputing its CSP hash still fails with `renderer CSS does not match the release lock`. |
| Structured HTML sanitizer / allowlist | **FAIL** | `validateStaticHtml` calls `sanitizeHtml`, but only checks that sanitized output is nonempty; it neither compares sanitized output with the input nor validates from the sanitized tree. Direct repros accepted `<marquee>` and an active `<a download href="data:text/html,...">`. Packaging imports no structured parser/sanitizer and uses regex/string checks, so it has the same class of bypass. This violates architecture §14.1’s structured reparse and explicit “no active download” rule. |
| Validated-not-released official-schema gate | **PASS** | Result is explicitly `releaseStatus: "validated-not-released"`; `stages` excludes `RELEASED`; `standardsValidation.officialSchemas` is `status: "unavailable"` and `releaseBlocking: true`. The package can be integrity-validated but cannot be represented as released while official full validators are unavailable. |
| Official full schemas, customer/native runs, real age | **BLOCKED as required** | Vendored complete native/SARIF/CycloneDX schema execution is explicitly unavailable and release-blocking. No customer/consultant/lay/native-host/Codex-Claude pair or real age provider was supplied. None is claimed as passed. |

### Structured HTML bypass reproducer

Run after the clean builds:

```sh
node --input-type=module -e 'import {validateStaticHtml,REPORT_RENDERER_CSS,REPORT_RENDERER_CSS_SHA256} from "./packages/reporting/dist/index.js"; const base=(extra)=>`<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;sha256-${REPORT_RENDERER_CSS_SHA256}&#39;"><style>${REPORT_RENDERER_CSS}</style>${extra}</head><body><a class="skip-link" href="#main-content">Skip</a><header><nav aria-label="Report contents"></nav><p>How to read this report</p><p>Package identity digest:</p></header><main id="main-content"><h1>Report</h1></main><footer>End</footer></body></html>`; for(const [name,extra] of [["data-css",`<link rel="stylesheet" href="data:text/css,body%7Bdisplay:none%7D">`],["unknown-tag",`<marquee>moving content</marquee>`]]){try{validateStaticHtml("index.html",base(extra),true);console.log("ACCEPTED",name)}catch(e){console.log("REJECTED",name,e.message)}}'
```

Observed:

```text
ACCEPTED data-css
ACCEPTED unknown-tag
```

Active-download variant:

```text
<a download href="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E">download</a>
```

Observed: `validateStaticHtml(..., true)` returned successfully and printed
`ACCEPTED_ACTIVE_DOWNLOAD`.

### Final scoped defect

#### P1 — Sanitized HTML output is discarded, permitting disallowed/active nodes

- **Owner:** reporting and packaging backend
- **Expected:** parse under limits and fail if any tag/attribute/URL is outside the frozen
  allowlist; prohibit active downloads and non-image data URLs; package validation uses the
  same structured validator.
- **Actual:** reporting accepts input whenever the sanitized remainder is nonempty, while
  continuing to validate the original text with incomplete regexes. Packaging does not use
  the structured sanitizer. A `download` data-HTML link and unknown tags pass.
- **Repro:** commands above.
- **Impact:** a hand-assembled customer report with the exact CSS/CSP shell can include
  prohibited interactive content and still pass the advertised HTML gate.

### Final scoped verdict

**NEEDS FIXES.** Certificate-chain integrity/binding, child-process ZIP reopen/tamper,
exact CSS locking, and honest validated-not-released schema status pass. Fix the structured
HTML boundary by rejecting any sanitizer transformation (or validating exclusively from a
bounded parsed tree), forbidding `download` and non-approved data URLs, and invoking the
same validator from packaging. Official full-schema/customer/native/real-age gates remain
blocked exactly as required.

## Second re-verification

The implementation changed materially after the initial QA below. This section records the
00:56 UTC intermediate result and is superseded by the final narrow recheck above; later
“initial” sections are retained as the reproducible defect history.

### Current verification commands

Run from `/workspace/rendervo-alt-3bcd18f5/targets/repo-assessment-kit`.

```sh
pnpm --filter @rak/reporting run clean
pnpm --filter @rak/reporting run build
pnpm --filter @rak/packaging run clean
pnpm --filter @rak/packaging run build
pnpm exec eslint packages/reporting/src/index.ts packages/reporting/test/index.test.ts packages/packaging/src/index.ts packages/packaging/test/index.test.ts --max-warnings 0
pnpm exec vitest run packages/reporting/test/index.test.ts packages/packaging/test/index.test.ts --reporter=verbose
```

Result: clean builds and focused ESLint passed. Vitest reported **2 files passed, 20 tests
passed**. The first attempt used `pnpm --filter ... clean`, which pnpm interpreted as its own
recursive clean command and rejected with `Unknown option: 'recursive'`; invoking the
package script explicitly with `run clean` succeeded and is the correct reproducer.

### Prior-defect closure matrix

| Prior defect / requested recheck | Current result | Re-verification evidence |
|---|---|---|
| Required-inventory override | **PASS — original repro closed** | `requiredPaths: []` now fails with `Required customer inventory is frozen and cannot be overridden`; omission of a frozen file also fails in the focused suite. |
| Pending redaction admitted as released | **PASS — original artifact-state repro closed** | Runtime mutation to `redactionState: "pending"` fails with `redaction is not final`. Common release review kinds, source-integrity boolean, and control-reconciliation boolean are required. |
| Stage-certificate bypass | **FAIL — residual blocker** | `validateReleasePrerequisites` accepts any IDs matching `^cert_[A-Za-z0-9_-]+$` plus caller-supplied `true` booleans/review-kind strings. It does not resolve or cryptographically/semantically verify a certificate/validation-occurrence record, stage order, run/snapshot binding, freshness, or the claimed reviews. The passing test itself uses hard-coded `cert_admission`, `cert_redaction`, `cert_reviews`, and `cert_staging`. Later “certificates” are synthesized from the final ZIP digest rather than persisted validation occurrences. A caller that can assemble the artifact set can therefore assert fabricated prerequisite tokens. Likely owner: packaging/workflow/persistence backend. |
| Active script/iframe/form/event/external HTML | **PASS — original repro closed** | Focused tests reject script, iframe, form, event handler, and remote image cases. Direct `validateStaticHtml` call rejected script content with `forbidden active HTML element`. |
| Exact HTML parser/release-CSS contract | **PARTIAL / FAIL overall** | The dangerous original cases are rejected, but validation is regex/string based rather than reparsing with a bounded non-browser HTML parser. Packaging accepts any single inline CSS block whose self-computed hash appears in CSP; it does not compare CSS to the reporting renderer’s release-owned lock. This does not fully satisfy architecture §14.1/safety §14.3. Likely owner: reporting/packaging backend. |
| Zero decision criteria / unequal decision model | **PASS** | Reporting and packaging require all seven unique frozen criteria; every option assessment is substantive and linked as evidenced/unverified/conflicting. |
| Arbitrary product-claim provenance | **PASS** | Reporting and packaging now call the contracts `productClaimSchema`; the invalid `"fabricated"` provenance unit case fails. Required discovery topics are also enforced. |
| Empty baseline and missing coverage domains | **PASS** | Reporting requires a nonempty named general baseline and all assessment domains exactly once. Packaging independently checks baseline presence, every domain, counts, and reconciliation. |
| Deeper security-profile guidance | **PASS at report-generator boundary; package-only trust remains tied to certificates** | Reporting validates profile ID, triggering signals, evidence, applicability, and `requiresCustomerConfirmation`, and renders guidance separately from baseline controls. Packaging has no canonical guidance document to compare with hand-authored report text, so a package assembled without `generateReportBundle` relies on the unverified review certificates noted above. |
| Captured screenshot references | **PASS** | Reporting resolves screenshot evidence ID and exact package path. Packaging independently requires captured evidence/path and an actual included file; unavailable screenshots require an explicit reason. |
| `/etc`, placeholder variants, representative AWS key, SSH material | **PASS for requested deterministic corpus** | Direct checks rejected `/etc/passwd`, `PLACEHOLDER`, `coming soon`, `xxx`, `AKIAIOSFODNN7EXAMPLE`, and an OpenSSH private-key header. Exact supplied values remain supported. This proves detection of the seeded cases, not absence of unknown/steganographic secrets. |
| Native document validation | **PASS for implemented contracts; partial schema coverage** | Run, target, and product claims use contracts schemas. Packaging additionally checks evidence/findings/controls/coverage/decision/reviews/equivalence/screenshots and semantic references, including duplicate JSON keys. Several native documents are still validated by hand-written partial field checks rather than their complete pinned JSON Schemas. |
| SARIF and CycloneDX semantics | **PASS for requested adversarial cases; FAIL against official-schema requirement** | Version/schema URI, counts/IDs/evidence, unsafe locations, unique fingerprints/bom-refs, dependency refs, and CycloneDX composition are checked; invalid-version and duplicate-ref tests fail. Neither package invokes the vendored official SARIF Errata 01 or CycloneDX 1.7 JSON Schema, so schema-validity claims remain broader than the implementation proves. Likely owner: contracts/reporting/packaging backend. |
| Frozen generated path | **PASS** | Direct `/tmp` output failed with `Package output must be generated/proj-<full-sha>-20260728T000000Z`; focused test proves the exact `generated/<project>-<commit>-<timestamp>` directory contract. |
| ZIP/checksum/reopen/tamper | **PASS for in-process mechanism; fresh-process requirement remains** | Deterministic ZIP, manifest, checksums, detached digest, unsafe/overlapping/duplicate entries, and byte/detached-digest tamper checks pass. `createCustomerPackage` and tests still call `validateReopenedZip` in the same Node process; architecture §14.3 requires a fresh-process reopen certificate. Likely owner: packaging backend. |
| Optional encryption | **PASS at interface level; real age unavailable** | Strong encryption remains explicitly unavailable without a provider; only declared trusted age-v1 is allowed and recovery-digest mismatch fails. No real pinned age binary/X25519/scrypt run was available. |
| AC-9 and customer/native/age gates | **BLOCKED / not proven** | No real Codex/Claude pair, customer package, native architecture matrix, consultant/lay review, or real age provider was supplied to this lane. Caller-supplied equivalence/review documents are structurally checked but are not substitutes for those external runs. |

### Direct adversarial output

```text
REJECT "read /etc/passwd" ... absolute host path detected
REJECT "PLACEHOLDER" ... unresolved placeholder content
REJECT "coming soon" ... unresolved placeholder content
REJECT "xxx" ... unresolved placeholder content
REJECT "AKIAIOSFODNN7EXAMPLE" ... credential-like secret detected
REJECT "-----BEGIN OPENSSH PRIVATE KEY-----" ... credential-like secret detected
ACTIVE_HTML_REJECT index.html: forbidden active HTML element
CYCLONEDX_REJECT CycloneDX component bom-ref must be unique: x
OVERRIDE_REJECT Required customer inventory is frozen and cannot be overridden
PATH_REJECT Package output must be generated/proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20260728T000000Z
```

### Final defects

#### P0 — Prerequisite “certificates” are unverified caller assertions

- **Owner:** workflow/persistence/packaging backend
- **Repro:** inspect `validateReleasePrerequisites`; replace each prerequisite with any
  format-valid `cert_fabricated` string and set the two booleans to `true`.
- **Expected:** resolve immutable validation occurrences bound to the same run, snapshot,
  revision, input digest and previous stage; verify verdict/review kinds/freshness/order.
- **Actual:** only token syntax, booleans and presence of four review-kind labels are checked.
- **Impact:** a caller capable of supplying otherwise well-shaped artifacts can falsely
  assert admission/redaction/reviews/staging and obtain `RELEASED`.

#### P1 — Pinned official export/native schemas are not actually executed

- **Owner:** contracts/reporting/packaging backend
- **Expected:** complete offline official SARIF Errata 01 and CycloneDX 1.7 schema validation,
  plus complete native schemas, before and after ZIP.
- **Actual:** useful deterministic semantic subsets are hand-coded, but schema URI equality
  is not official-schema validation and several native documents receive partial checks.
- **Impact:** malformed constructs outside the hand-written subset can be certified valid.

#### P1 — ZIP reopen is not isolated in a fresh process

- **Owner:** packaging backend
- **Expected:** a fresh process reopens and validates the persisted ZIP and emits its own
  stage occurrence.
- **Actual:** the in-memory ZIP is reopened synchronously in the creating process; later
  persisted-file/detached-digest tests are deterministic but not an independent process.

#### P2 — Packaged HTML validation does not prove parser/locked-CSS conformance

- **Owner:** reporting/packaging backend
- **Expected:** bounded HTML reparse and exact release-owned CSS lock comparison.
- **Actual:** regex/string checks block the tested active constructs, while packaging accepts
  arbitrary inline CSS if its hash is self-consistent with CSP.

### Re-verification verdict

**NEEDS FIXES.** The original inventory, pending-redaction, active-HTML, decision,
provenance, baseline, coverage, screenshot, seeded-secret, generated-path, and ordinary
tamper reproducers are closed. Do not ship while prerequisite certificates remain
unresolved caller assertions. Complete official offline schema execution and a
fresh-process ZIP reopen certificate before claiming architecture §§14/17 and safety
§§14/19. External/customer/native/real-age/AC-9 gates remain unavailable, not passed.

## Initial commands and baseline evidence (historical)

Run from `/workspace/rendervo-alt-3bcd18f5/targets/repo-assessment-kit`.

```sh
pnpm --filter @rak/reporting typecheck
pnpm --filter @rak/packaging typecheck
pnpm exec eslint packages/reporting/src/index.ts packages/reporting/test/index.test.ts packages/packaging/src/index.ts packages/packaging/test/index.test.ts --max-warnings 0
pnpm exec vitest run packages/reporting/test/index.test.ts packages/packaging/test/index.test.ts --reporter=verbose
```

Result: both TypeScript builds and focused ESLint passed. Vitest reported **2 files passed,
16 tests passed**. The passing suite proves deterministic ZIP construction, SHA-256/checksum
verification, ordinary byte-tamper rejection, path/duplicate/case collision checks, staging
symlink/hardlink checks, known-secret/selected-host-path/selected-placeholder checks, report
escaping, basic reference checks, separate report files, machine-readable projections, and
strong-encryption recovery-digest enforcement.

Package manifests have no `test` script, so `pnpm --filter <package> test` does not execute
these tests; the explicit Vitest command above is the reproducible test command.

## Acceptance matrix

| Criterion / contract | Result | Evidence and reproducible check |
|---|---|---|
| AC-5: every material finding/decision factor resolves to evidence or is visibly unverified/conflicting | **FAIL** | The normal unit test rejects a missing finding evidence ID and an evidenced decision option with no reference. However, `validateReportInput` accepts an empty `decision.criteria` array, an arbitrary product-claim provenance value (`"fabricated"`), and a captured screenshot whose `evidenceOccurrenceId` is absent. See adversarial check A. Product claims are untyped `Record<string, unknown>[]` and never validated. |
| AC-5: coverage/limitations and non-pass honesty | **PARTIAL / FAIL overall** | Unit tests prove non-pass controls need reasons and aggregate counts must reconcile. A report with no controls and no coverage domains is nevertheless accepted, so the required baseline/all-domain accounting can be omitted. |
| AC-5: seeded-secret/redaction/package reference gate | **FAIL** | Known secret strings supplied through `gates.knownSecrets` are rejected, but package creation accepts runtime-invalid `redactionState: "pending"`, a representative AWS key, `/etc/passwd`, and literal `PLACEHOLDER`; it still returns `REDACTION_COMPLETE` and `RELEASED`. References are checked only when a caller manually populates `PackageArtifact.references`; native JSON/SARIF/CycloneDX semantic references are not inspected. See check B. No SSH-material corpus dry run was present. |
| AC-6: equal three-option decision model with the seven frozen criteria | **FAIL** | Output includes three option columns and recommendation/confidence/assumptions/dependencies/reversal sections, but no validator requires the seven criteria, uniqueness, consistent depth, or even one criterion. A 441-byte decision Markdown report was emitted with zero criteria. See check A. |
| AC-6: evidence-linked recommendation and prohibited claims | **FAIL** | Option evidence is partially validated, but the recommendation/rationale itself has no required evidence link. Compliance-language scanning applies only to executive HTML/Markdown, not decision, security, index, or other shipped content. |
| AC-7: mandatory general baseline, distinguishable overlays, deeper-profile recommendation with triggering signals and customer-confirmation label | **FAIL** | The security report can display controls filtered by profile name, but an empty control inventory is accepted and rendered as “not tested.” There is no input/validation/report contract for a recommended deeper profile, triggering evidence/signals, applicability state, or customer-confirmation requirement. |
| AC-8: substantive, plain-language, separate reports | **PARTIAL / FAIL overall** | Five distinct Markdown/HTML reports, including separate security and coverage/limitations reports, are generated. Executive content leads with scope/issue/consequence/recommendation/alternatives/confidence/unknowns. However, minimum content is not enforced; empty scope/coverage/findings and one-word narratives pass. The design-required report shell is absent: generated HTML had CSP and no script, but no skip link, `main`, footer, TOC, table captions, package digest, or “How to read this report.” See check C. |
| AC-8: screenshot presence or explicit unavailability | **PARTIAL / FAIL overall** | An unavailable screenshot requires a reason, and an empty inventory is normalized to an explicit unavailable record. A captured screenshot path/evidence ID is not resolved to an existing evidence item or package artifact, so nonexistent screenshots pass report validation. |
| AC-8: native JSON, SARIF, CycloneDX, CSV inventory | **PARTIAL / FAIL overall** | All named projections are emitted, with SARIF 2.1.0 Errata schema URI, CycloneDX 1.7 identifiers, and quoted CSV. Neither package imports the contracts package at runtime, invokes offline schemas, rejects duplicate CycloneDX refs, performs the required SARIF/CycloneDX semantic checks, or protects CSV consumers from formula cells. Packaging checks only file presence unless the caller overrides it. |
| AC-8: strict required inventory and customer-ready index | **FAIL** | `CreatePackageOptions.requiredPaths` lets any caller replace the frozen inventory. With `requiredPaths: []`, a package containing only `evidence/only.txt`, `manifest.json`, and `SHA256SUMS` was created and marked through every stage. With `requiredPaths: ["index.html"]`, active script/iframe HTML was accepted into a released ZIP. See checks B and D. |
| AC-8 / architecture §14.3: certified nine-stage, immutable staging pipeline | **FAIL** | `packageStages` is returned wholesale after in-memory processing; there are no prior-stage certificates, admission/review/source/control/incident/cleanup checks, validation occurrences, or state transitions. `collectStagingArtifacts` rejects observed links/types but does not freeze the tree or protect the later read from mutation. Reopen validation runs in the same process, not a fresh process. |
| AC-8: manifest, SHA-256, ZIP reopen, tamper validation | **PASS for implemented narrow mechanism** | Unit tests prove RFC-8785-library canonical manifest generation, payload size/digest entries, `SHA256SUMS` coverage, deterministic ZIP bytes, detached lowercase SHA-256, reopen checks, and CRC rejection after byte tampering. This does not compensate for the ability to admit incomplete/unsafe content before those integrity operations. |
| AC-8: generated run-directory convention | **FAIL** | The API accepts any existing `outputDirectory` and arbitrary safe base name. It does not enforce or construct `generated/<project>-<commit>-<timestamp>/`, nor prove all artifacts are contained there. Repository `.gitignore` policy was outside the owned package slice. |
| Optional encryption: strong or explicitly unavailable, never fake/legacy | **PASS at interface level; real provider unavailable** | No provider returns an explicit strong-encryption-unavailable reason. Only a trusted provider declaring `age-v1` is accepted; empty ciphertext and recovered-ZIP digest mismatch fail. No legacy ZIP encryption exists. A real pinned age 1.3.1 X25519/scrypt invocation, actual decrypt, architecture lock, and passphrase-handling path are not implemented/proven here, so do not treat the mock-provider test as real encryption validation. |
| AC-9: Codex/Claude output equivalence and end-to-end ZIPs | **BLOCKED / not proven** | This slice has no real `start-codex.sh` or `start-cc.sh` dry-run output, customer repository, equivalence pair, native host run, or validated customer ZIP. The report merely serializes a caller-supplied equivalence object without validating it. Do not claim AC-9 from these package tests. |

## Adversarial deterministic checks

### A — missing decision/provenance/screenshot gates are accepted

```sh
node --input-type=module -e 'import {validateReportInput,generateReportBundle,validateCustomerContent} from "./packages/reporting/dist/index.js"; const x={run:{runId:"r",projectSlug:"p"},targetSnapshot:{commitSha:"x",snapshotId:"s"},productClaims:[{claimId:"c",statement:"x",provenance:"fabricated"}],findings:[],controls:[],coverage:[],evidence:[],decision:{criteria:[],recommendation:{kind:"single",option:"full-rebuild"},rationale:"r",confidence:"high",assumptions:[],dependencies:[],reversalConditions:[]},reviews:[],equivalenceCertificate:{},components:[],screenshots:[{screenshotId:"shot",title:"shot",status:"captured",packageRelPath:"screenshots/missing.png",evidenceOccurrenceId:"EV-MISSING"}],scope:[],limitations:[],principalIssue:"p",businessConsequence:"b",generatedAt:"2026-01-01T00:00:00Z"}; validateReportInput(x); const b=generateReportBundle(x); console.log(JSON.stringify({acceptedInvalidProvenance:x.productClaims[0].provenance,acceptedDecisionCriteria:x.decision.criteria.length,acceptedMissingScreenshotEvidence:x.screenshots[0].evidenceOccurrenceId,decisionReportBytes:b.files.find(f=>f.path==="reports/decision.md").content.length})); for (const s of ["read /etc/passwd","PLACEHOLDER","coming soon","xxx"]) {try {validateCustomerContent("reports/technical.md",s); console.log("CONTENT_ACCEPTED",JSON.stringify(s))} catch(e){console.log("CONTENT_REJECTED",JSON.stringify(s),e.message)}}'
```

Observed:

```text
{"acceptedInvalidProvenance":"fabricated","acceptedDecisionCriteria":0,"acceptedMissingScreenshotEvidence":"EV-MISSING","decisionReportBytes":441}
CONTENT_ACCEPTED "read /etc/passwd"
CONTENT_ACCEPTED "PLACEHOLDER"
CONTENT_ACCEPTED "coming soon"
CONTENT_ACCEPTED "xxx"
```

### B — incomplete, unredacted package receives all release stages

```sh
node --input-type=module -e 'import {mkdtemp,readFile} from "node:fs/promises"; import {tmpdir} from "node:os"; import {join} from "node:path"; import {createCustomerPackage,reopenZip} from "./packages/packaging/dist/index.js"; const out=await mkdtemp(join(tmpdir(),"rak-adversarial-")); const a={path:"evidence/only.txt",content:"read /etc/passwd; PLACEHOLDER; AKIAIOSFODNN7EXAMPLE",artifactKind:"raw",mediaType:"text/plain",sensitivity:"customer-confidential",redactionState:"pending",evidenceOccurrenceIds:[]}; const r=await createCustomerPackage({outputDirectory:out,packageBaseName:"incomplete",runId:"r",snapshotId:"s",generatedAt:"2026-01-01T00:00:00Z",artifacts:[a],requiredPaths:[]}); console.log(JSON.stringify({entries:reopenZip(await readFile(r.zipPath)).map(x=>x.path),redactionState:r.manifest.entries.find(x=>x.path==="evidence/only.txt").redactionState,stages:r.stages}));'
```

Observed: ZIP entries were only `SHA256SUMS`, `evidence/only.txt`, and `manifest.json`;
manifest redaction state was `pending`; the result nevertheless returned all stages from
`ADMISSION_COMPLETE` through `RELEASED`.

### C — generated HTML misses the required shared report shell

Using a minimal valid `ReportInput`, the generated executive HTML check returned:

```json
{"bytes":1633,"csp":true,"script":false,"main":false,"footer":false,"skip":false,"toc":false,"caption":false,"packageDigest":false,"howToRead":false}
```

This proves the renderer's CSP/no-script positive behavior and the design §14 shell gaps.

### D — active customer index HTML is released

```sh
node --input-type=module -e 'import {mkdtemp,readFile} from "node:fs/promises"; import {tmpdir} from "node:os"; import {join} from "node:path"; import {createCustomerPackage,reopenZip} from "./packages/packaging/dist/index.js"; const out=await mkdtemp(join(tmpdir(),"rak-htmlgate-")); const base={artifactKind:"x",mediaType:"text/html",sensitivity:"customer-confidential",redactionState:"none-required",evidenceOccurrenceIds:[]}; const artifacts=[{...base,path:"index.html",content:"<!doctype html><script>fetch(\"https://evil.invalid\")</script><iframe src=\"https://evil.invalid\"></iframe>"},{...base,path:"evidence/item.html",content:"<p>evidence</p>"}]; const r=await createCustomerPackage({outputDirectory:out,packageBaseName:"active-html",runId:"r",snapshotId:"s",generatedAt:"2026-01-01T00:00:00Z",artifacts,requiredPaths:["index.html"]}); console.log(reopenZip(await readFile(r.zipPath)).map(e=>e.path));'
```

Observed: package creation succeeded and the ZIP contained the active `index.html`.

## Initial defects (historical; closure status is in final re-verification)

### P0 — Package release can bypass inventory, redaction, reviews, and all prior stages

- **Owner:** packaging/backend
- **Repro:** adversarial check B.
- **Expected:** frozen required inventory; only admitted/redacted/reviewed artifacts; each
  stage requires a validation certificate and transition; invalid redaction state blocks
  before ZIP creation.
- **Actual:** caller replaces required inventory, runtime-invalid redaction state passes,
  and all nine stage names are returned without certificates or prerequisite checks.
- **Impact:** the system can label an incomplete, unreviewed, potentially sensitive archive
  as `RELEASED`. This is a direct false-positive release gate.

### P0 — Shipped active HTML is not reparsed or blocked

- **Owner:** reporting + packaging/backend
- **Repro:** adversarial check D.
- **Expected:** every shipped HTML file is reparsed under limits and rejects scripts,
  iframes, external URLs, forbidden attributes/tags, CSP/hash mismatch, and undeclared
  resources.
- **Actual:** arbitrary active `index.html` is accepted and archived. Packaging performs
  only placeholder/host-path/known-secret text scans.
- **Impact:** opening the alleged customer-safe offline package can execute active content
  and make external requests.

### P1 — Decision/evidence/provenance gates accept materially incomplete reports

- **Owner:** reporting/backend
- **Repro:** adversarial check A.
- **Expected:** all seven unique frozen criteria and all three equally represented options;
  allowed claim provenance only; recommendation evidence; captured screenshot references
  resolve to included evidence/files.
- **Actual:** zero criteria, fabricated provenance, and nonexistent screenshot evidence
  pass and produce reports.
- **Impact:** AC-5/6 can be reported as complete without the evidence model or actual
  modernization comparison.

### P1 — Required security/profile and coverage content can be omitted

- **Owner:** reporting/backend (with evidence/contracts inputs)
- **Repro:** call `generateReportBundle` with empty `controls` and `coverage`.
- **Expected:** general baseline always present; configured overlay distinguishable;
  deeper-profile recommendation carries triggering signals/customer-confirmation state;
  all required domains and every non-pass reason represented.
- **Actual:** empty collections pass; no deeper-profile contract exists.
- **Impact:** a customer package can look complete while omitting the required security and
  coverage assessment.

### P1 — Secret/host-path/placeholder scan is too narrow and redaction state is not enforced

- **Owner:** evidence/redaction + packaging/backend
- **Repro:** checks A and B.
- **Expected:** pinned detector corpus plus supplied/canary/common-encoding checks, all host
  paths, SSH/private-key patterns, structured scans, valid redaction derivation/state.
- **Actual:** only caller-supplied exact known secrets and narrow regexes are checked;
  `/etc/passwd`, `PLACEHOLDER`, a representative AWS key, and `pending` redaction passed.
- **Impact:** seeded-secret and artifact-hygiene acceptance cannot be claimed.

### P1 — Machine-readable files are emitted without offline schema/semantic validation

- **Owner:** reporting + packaging/backend
- **Repro:** inspect imports and generation paths; neither package invokes contracts/offline
  validators, while packaging presence-checks paths.
- **Expected:** native schema, SARIF Errata 01, CycloneDX 1.7 and RAK semantic checks before
  ZIP and again on reopen; broken references/duplicate refs/unsafe locations fail.
- **Actual:** serializers emit plausible shapes, but semantic validity is trusted.
- **Impact:** required export files can exist yet be unusable or internally inconsistent.

### P2 — Customer report design contract and substantiveness gates are incomplete

- **Owner:** reporting/backend
- **Repro:** check C.
- **Expected:** design §14 shared shell, descriptive evidence links, package index, required
  sections, seven-criterion depth, and readable/substantive content gates.
- **Actual:** reports are escaped and separated but omit major shell/content requirements;
  evidence links normally render as bare inert IDs because the renderer checks
  `data/evidence-index.json#<id>` against a set containing evidence artifact paths.
- **Impact:** output is not yet directly customer-ready or design-conformant.

### P2 — Run-directory convention is not enforced

- **Owner:** packaging/backend orchestration
- **Repro:** all unit/adversarial tests create successfully under arbitrary `/tmp` output
  directories and arbitrary safe base names.
- **Expected:** one correctly named `generated/<project>-<commit>-<timestamp>/` tree.
- **Actual:** packaging accepts any existing directory and does not bind naming to project,
  commit, or timestamp.

## Coverage notes and unavailable evidence

- No product code was changed. This report is the only file added by this QA lane.
- No real customer repository/report, consultant review, lay review, native host matrix,
  screenshot image, SSH-material package, Codex dry run, or Claude Code dry run was
  available. These remain **unproven**, not passed.
- The design asks for printable/offline/lay-review report verification. Static inspection
  found missing structural requirements; no browser/print screenshot was warranted because
  the generated report already fails the required shell structurally.
- The encryption result is deliberately limited to interface behavior. A mock object that
  declares `age-v1` is not evidence that pinned age encryption works or meets customer
  requirements.
- Integrity primitives are the strongest part of this slice, but they protect the bytes
  admitted to the ZIP; they do not establish that those bytes were complete, safe,
  semantically valid, redacted, or reviewed.

## Initial verdict (historical; superseded by final re-verification)

The initial run was **NEEDS FIXES** because inventory/stage/redaction bypass and active HTML
acceptance were reproducible. The final re-verification at the top records which exploit
reproducers closed and the remaining certificate/schema/fresh-process blockers. AC-9 and
native/customer/lay gates remain explicitly unavailable until real dry-run evidence exists.

# Standards and formats

_Accessed and current as of 2026-07-27._

## Question

Which exact versions and profiles should the Repository Assessment Kit use for its portable schemas, findings, SBOM, security control mappings, severity, evidence provenance, package integrity, optional encryption, and customer-facing language?

This decision unblocks the architecture's evidence, export, validation, packaging, and reporting contracts. “Good enough” means:

- every emitted artifact declares an immutable format/profile version and validates offline;
- a later standards update cannot silently change a completed assessment;
- technical findings remain traceable without implying legal applicability, certification, or compliance;
- the same contracts work through Codex and Claude Code on both supported architectures.

## Recommendation

**Adopt a release-pinned “RAK 1” export profile, with high confidence.** Use:

| Concern | Exact choice for RAK 1 |
|---|---|
| Native contracts | JSON Schema Draft 2020-12, strict JSON/I-JSON-compatible instances, semantic rules layered above schema |
| Findings interchange | SARIF 2.1.0 **Plus Errata 01**, JSON, with a namespaced RAK property profile |
| SBOM | CycloneDX 1.7 JSON, repository-discovery profile |
| Weakness taxonomy | CWE catalog 4.20 (catalog schema 7.3), precise Base/Variant mappings where supported |
| Application requirements | OWASP ASVS 5.0.0; applicable Level 1 is the default application-control baseline |
| Runtime test techniques | OWASP WSTG 4.2, using versioned scenario IDs and links |
| Awareness grouping | OWASP Top 10:2025, as a many-to-many category overlay only |
| Secure-development process | NIST SP 800-218 SSDF 1.1, as a process-evidence overlay |
| Vulnerability severity | CVSS 4.0, publishing both vector and score; retain imported older vectors without conversion |
| Evidence provenance | A small native model aligned to W3C PROV-DM/PROV-O Entity–Activity–Agent concepts; no RDF requirement in MVP |
| Integrity | SHA-256 per file; canonical manifest JSON using RFC 8785 JCS; detached SHA-256 for ZIP and encrypted wrapper |
| Optional encryption | `age` CLI 1.3.1 using the age v1 file format; X25519 recipient mode preferred, scrypt passphrase mode as fallback |
| Executive prose | A testable plain-language house profile: audience-first, active voice, short sections/sentences, acronyms expanded, and mandatory lay review |

Do not use floating `latest`/`stable` URLs, unversioned framework IDs, or a single aggregate “security score.” A run must record the exact profile versions, source snapshot digests, validator versions, tool versions, and target commit. Historical exports are immutable.

## Options compared

| Decision | Recommended | Viable alternative | Why the recommendation fits this product |
|---|---|---|---|
| Native JSON dialect | Draft 2020-12 | Draft 7 | 2020-12 is the current published JSON Schema dialect and has vocabularies, `prefixItems`, dynamic references, and `unevaluated*`; Draft 7 is older and should only be accepted for imported tool output. |
| Findings | SARIF 2.1.0 Errata 01 | Native JSON only | SARIF provides broad interchange for tool rules/results, locations, taxonomies, fingerprints, and invocations. Native JSON remains canonical because SARIF does not model the full assessment/evidence/decision domain. |
| SBOM | CycloneDX 1.7 JSON | SPDX; CycloneDX XML | CycloneDX is already selected, 1.7 is current, and JSON fits the TypeScript/offline-schema stack. Do not convert another format merely to claim more completeness. |
| Application baseline | ASVS 5.0.0 L1 + applicability gate | Top 10 checklist | ASVS contains verifiable requirements and L1 is explicitly its minimum starting point. Top 10 is an awareness list, not an adequate verification checklist. |
| Testing guide | WSTG 4.2 | WSTG “latest” / 5.0 development | 4.2 is the current versioned stable release. OWASP says 5.0 is in development and specifically recommends versioned IDs/links. |
| Process overlay | SSDF 1.1 | Treat ASVS as SDLC coverage | SSDF covers producer practices; ASVS explicitly focuses on the application and excludes much CI/CD and operational activity. |
| Vulnerability score | CVSS 4.0 plus separate business priority and confidence | CVSS 3.1; home-grown numeric score | CVSS 4.0 is current and separates Base, Threat, Environmental, and Supplemental data. FIRST states Base measures severity, not risk. A private formula would create false precision. |
| Provenance | Native JSON subset mapped to W3C PROV | Full PROV-O/RDF; in-toto-only | Entity/Activity/Agent is a stable conceptual model, while full RDF adds complexity without improving the customer ZIP. In-toto is build-attestation-shaped rather than assessment-evidence-shaped. |
| Integrity | Raw-file SHA-256 + JCS manifest + detached archive digest | ZIP CRC; hash manifest with unspecified serialization | ZIP CRC is not a security integrity control. Raw byte hashes verify files; JCS makes manifest generation reproducible; a detached digest covers the final container. |
| Encryption | age v1 X25519; scrypt fallback | AES-encrypted 7z; OpenPGP RFC 9580 | age has a small, modern authenticated file format and simple recipient workflow. 7z adds another archive and weaker metadata conventions; OpenPGP is more interoperable in some enterprises but materially more complex. Add RFC 9580 OpenPGP only when a customer requirement justifies it. |

## Format profiles and implementation implications

### 1. Native JSON and JSON Schema

JSON Schema’s official site identifies Draft 2020-12 as the current release and publishes its meta-schema at `https://json-schema.org/draft/2020-12/schema`. The release separates `format-annotation` from `format-assertion`, so merely including `format: "date-time"` does not guarantee rejection by every validator ([JSON Schema specification](https://json-schema.org/specification), [Draft 2020-12 details](https://json-schema.org/draft/2020-12)).

Requirements:

- Every public schema has:
  - `"$schema": "https://json-schema.org/draft/2020-12/schema"`;
  - an immutable absolute `$id`, such as `https://schemas.repo-assessment-kit.dev/rak/1.0/evidence.schema.json`;
  - a native contract `schemaVersion` using SemVer.
- Vendor the exact meta-schemas and all referenced schemas in the released image. Production/package validation is offline and must reject an unresolved or network `$ref`.
- Use strict objects (`additionalProperties: false` or `unevaluatedProperties: false`) at contract boundaries. Allow future data only under a defined `extensions` object with reverse-DNS keys.
- Enable and test `format` assertions explicitly. Validate RFC 3339 timestamps, URI references, UUIDs, commit hashes, and digest syntax in the semantic layer where JSON Schema is insufficient.
- Reject duplicate JSON member names before ordinary parsing. Restrict hashable/canonical artifacts to the I-JSON constraints used by JCS: valid Unicode, no duplicate names, and numbers safely representable as IEEE-754 doubles. Store digests, byte counts beyond the safe integer range, decimal scores needing exact representation, and identifiers as strings where necessary.
- Schema success is necessary, not sufficient. A second validator must enforce reference existence, target-commit consistency, allowed state transitions, unique IDs, acyclic `derivedFrom`, coverage rules, and “reason required for every non-pass” rules.
- Emit native assessment JSON as the source of truth. SARIF and CycloneDX are validated projections; no round trip from either is expected to reproduce the complete native model.

### 2. SARIF findings profile

Use the OASIS SARIF 2.1.0 Plus Errata 01 schema:

`https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json`

SARIF requires `version: "2.1.0"` and supports taxonomies, versioned partial fingerprints, baselines, locations, invocations, and property bags ([SARIF 2.1.0 Plus Errata 01](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)). The errata schema fixes normative/schema defects without changing the declared SARIF version.

RAK SARIF profile:

- One `run` per analyzer execution or logically homogeneous assessment pass.
- Populate `tool.driver.name`, exact `semanticVersion`/`version`, `informationUri`, and complete rule descriptors. Record `automationDetails.id` and sanitized invocation outcome.
- Use repository-relative artifact URIs with a base rooted at the recorded immutable commit; never emit host absolute paths. Include precise regions when known and explicitly omit them when not known.
- Each native finding has one SARIF `result`, a stable native ID in `properties["dev.repo-assessment-kit.findingId"]`, evidence IDs, validation state, confidence, native severity, and any CVSS data in the same namespaced property bag.
- Use `result.partialFingerprints` with a documented and versioned algorithm name such as `repoAssessmentKitFinding/v1`. Do not include secrets or raw sensitive source in fingerprint inputs.
- Represent CWE using SARIF taxonomies, with catalog version `4.20`; do not put CWE only in free-form tags. ASVS/WSTG/Top 10/SSDF cross-references also carry explicit versions.
- Treat SARIF `level` (`error`, `warning`, `note`, `none`) as display urgency, not as the canonical risk severity. Recommended lossy mapping: Critical/High → `error`; Medium → `warning`; Low/Informational → `note`; suppressed/not-a-finding → `none`.
- Preserve imported scanner properties and original severity/vector. Never silently upgrade or translate a scanner’s CVSS 3.1 vector into CVSS 4.0.

Validation must run both the official Errata 01 schema and RAK semantic checks: unique result IDs/fingerprints, resolvable evidence IDs, existing artifact locations (unless explicitly external/redacted), declared taxonomy versions, valid regions, no absolute host paths, and no prohibited sensitive values.

### 3. CycloneDX SBOM profile

CycloneDX lists 1.7 as current, released 2025-10-21, and recognizes `bom.json`/`*.cdx.json` ([specification overview](https://cyclonedx.org/specification/overview/), [1.7 JSON reference](https://cyclonedx.org/docs/1.7/json/)). Emit:

- `bomFormat: "CycloneDX"`, `specVersion: "1.7"`, `$schema: "https://cyclonedx.org/schema/bom-1.7.schema.json"`;
- a unique `serialNumber`, `version: 1`, UTC metadata timestamp, exact generating tool versions, and lifecycle `discovery`;
- the assessed application as `metadata.component`, tied to the repository URL where safe and the immutable commit;
- unique stable `bom-ref` values, package URLs where determinable, observed versions, hashes only when actually measured, concluded/declared licenses kept distinct, and a dependency graph;
- a `compositions` entry whose aggregate honestly states `complete`, an applicable `incomplete_*` value, `incomplete`, or `unknown`. For best-effort source discovery, default to `unknown`, not `complete`.

“Component found” does not mean “component deployed,” “reachable,” “licensed for this use,” or “vulnerable.” Put those conclusions in native findings/evidence. Validate with the vendored official 1.7 schema, then check unique and resolvable `bom-ref`s, dependency endpoints, PURL syntax, hash lengths, target identity, and an explicit composition completeness statement.

### 4. CWE

Pin the **CWE 4.20 catalog**, released 2026-04-30, and record its catalog schema version **7.3** separately ([CWE 4.20 release notice](https://cwe.mitre.org/news/), [schema 7.3](https://cwe.mitre.org/documents/schema/index.html)). A CWE ID is a weakness classification, not proof that a vulnerability is exploitable.

Mapping rules:

- Prefer the most precise supported Base or Variant weakness.
- Consult the entry’s current Vulnerability Mapping label and notes. Do not map findings to Categories or Views; reject `PROHIBITED` mappings and flag `DISCOURAGED` mappings for reviewer approval.
- Allow multiple mappings only when the evidence establishes multiple root causes; designate one primary mapping and explain the others.
- Record mapping method (`tool`, `analyst`, `imported`), confidence, catalog version, and evidence.

MITRE’s root-cause guidance recommends Base/Variant precision and warns against Category/View mapping ([CWE root-cause mapping guidance](https://cwe.mitre.org/documents/cwe_usage/guidance.html)).

### 5. OWASP and NIST profiles

#### Default baseline

For web applications/services, load the applicable controls from **ASVS 5.0.0 Level 1**. ASVS calls L1 the minimum starting point, while saying most applications should strive for L2. Requirement references must include the version, for example `v5.0.0-1.2.5`, because OWASP warns that IDs can change ([ASVS 5.0.0 repository and reference rules](https://github.com/OWASP/ASVS/tree/v5.0.0_release), [official project page](https://owasp.org/www-project-application-security-verification-standard/)).

The kit’s six-state coverage model is not an ASVS pass/fail certification result. Each applicable control may be `pass`, `fail`, `partial`, `blocked`, `not applicable`, or `not tested`; only `pass` is positive technical verification, and every other state needs a reason. The report must state the chosen level, included requirements, exclusions, test methods, and evidence. OWASP explicitly says it does not certify vendors, verifiers, or software, and warns that automation alone cannot verify many requirements ([ASVS assessment and certification guidance](https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x04-Assessment_and_Certification.md)).

Use **WSTG 4.2** only for applicable, authorized, safe runtime test techniques. Store IDs in OWASP’s versioned form, e.g. `WSTG-v42-INFO-02`, and link to `/v42/`, never `/stable/` or `/latest/`. OWASP says 4.2 is the current versioned release and 5.0 is still under development ([WSTG project](https://owasp.org/www-project-web-security-testing-guide/)).

Map findings to **OWASP Top 10:2025** categories for executive grouping and trend views. The current list is an awareness document, so “all ten categories considered” is not equivalent to control verification or application security ([OWASP Top 10:2025](https://owasp.org/Top10/)).

Apply **NIST SP 800-218 SSDF 1.1** only to repository/process evidence: Prepare the Organization, Protect the Software, Produce Well-Secured Software, and Respond to Vulnerabilities. SSDF is a high-level practices framework, not an application vulnerability checklist ([NIST SP 800-218 final](https://csrc.nist.gov/pubs/sp/800/218/final)). Lack of organizational artifacts in the supplied repository is normally `not tested`, `blocked`, or “not observed in supplied scope,” not proof of failure.

#### Deeper-profile recommendations

The kit may recommend, but must not auto-assert applicability of:

- ASVS L2 for internet-facing, authenticated, multi-tenant, sensitive-data, payment, or materially business-critical applications;
- ASVS L3 for exceptionally high-value, safety-impacting, or strongly adversarial environments;
- a fuller WSTG 4.2 runtime profile when a safe representative runtime, authorization, accounts, and test data exist;
- SSDF 1.1 organizational review when SDLC/supplier evidence is in engagement scope.

Every recommendation names the observed trigger, missing customer confirmation, incremental evidence needed, and expected coverage impact.

### 6. Severity, priority, confidence, and validation

Use **CVSS 4.0** for assessor-authored software vulnerability severity when the evidence supports all required Base metrics. FIRST requires publishers to provide both the score and vector; its current qualitative bands are None 0.0, Low 0.1–3.9, Medium 4.0–6.9, High 7.0–8.9, and Critical 9.0–10.0 ([CVSS 4.0 specification](https://www.first.org/cvss/v4.0/specification-document), [data representation](https://www.first.org/cvss/data-representations)).

Rules:

- Always store `system`, `version`, vector, calculated score, qualitative band, scorer, scoring time, and rationale/evidence. Verify the score with a pinned implementation and a second reference-vector fixture set.
- Prefer CVSS-B for portable intrinsic severity. Add CVSS-BT/BTE only when threat/environment inputs have named, dated evidence; retain both Base and enriched vectors. FIRST states Base is severity, not risk, and recommends Threat/Environmental enrichment for local prioritization ([CVSS 4.0 User Guide](https://www.first.org/cvss/user-guide), [Consumer Implementation Guide](https://www.first.org/cvss/v4.0/implementation-guide)).
- If required facts are unknown, publish “CVSS not scored — insufficient evidence” rather than inventing worst-case values.
- Preserve imported CVSS 2.0/3.x exactly with source and version. Re-score as 4.0 only as a separate assessor-authored record, never as a conversion.
- For configuration, design, process, maintainability, or business findings outside CVSS’s scope, use the same five named RAK severity bands with a documented impact/exploitability/exposure rubric, but no pseudo-CVSS number.
- Keep `technicalSeverity`, `businessPriority`, `confidence`, and `validationState` separate. Priority is owner/context dependent; confidence is evidence strength; validation records `unreviewed`, `corroborated`, `independently reproduced`, `disputed`, or `invalidated`. Never average these fields into an overall repository score.

### 7. Evidence provenance

Use a native JSON model aligned to W3C PROV’s stable starting-point concepts: an evidence artifact/claim is an **Entity**, capture or transformation is an **Activity**, and a tool/agent/operator is an **Agent**. W3C explicitly permits use of only the needed PROV-O subset ([PROV-O Recommendation](https://www.w3.org/TR/prov-o/)). Do not require RDF/OWL export for MVP.

Every evidence entity must include:

- immutable `evidenceId`, `schemaVersion`, type, title, media type, byte length, SHA-256, and package-relative path or redacted external locator;
- assessed repository identity and full commit SHA, repository-relative source locator, line/region where meaningful, and capture time;
- producing activity ID, capture method, sanitized command/config, tool name and exact version/digest, agent/provider role, and execution outcome;
- `derivedFrom` IDs plus transformation/redaction description; original content hash may be retained only when it does not leak sensitive information;
- sensitivity class, redaction status, access/collection limitation, and reviewer/validation state;
- linked claim/finding/control IDs.

Assertions separately carry one of the brief’s required provenance classes: `owner-stated`, `documented`, `observed`, `analytics-supported`, `code-inferred`, `unverified`, or `conflicting`. `unverified` and `conflicting` are claim states, not evidence sources; a conflicting assertion must name the competing claim/evidence IDs. Owner statements identify the speaker role and capture time. Analytics evidence identifies dataset/query/time window. Inferences state the reasoning and supporting evidence.

Validation rejects broken references, cycles in derivation, evidence generated against a different commit without an explicit external relation, missing hashes for packaged evidence, a positive material claim with no evidence, or a decision factor that is neither evidenced nor visibly `unverified`/`conflicting`.

### 8. Manifest, checksums, ZIP, and optional encryption

SHA-256 remains specified by NIST’s Secure Hash Standard; NIST has announced a future revision of FIPS 180-4 but has not withdrawn it ([FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)). RFC 8785 defines an invariant JSON representation suitable for hashing, while noting its I-JSON constraints and verified errata ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html), [errata](https://www.rfc-editor.org/errata/rfc8785)).

Package algorithm:

1. Freeze the redacted staging tree. Reject symlinks, hardlinks, device files, sockets, absolute paths, `..`, duplicate paths, and case/Unicode-normalization collisions.
2. Create JCS-canonical `manifest.json`. Identify **every** customer payload path, including `manifest.json` and `SHA256SUMS`. For ordinary payload files record normalized POSIX path, artifact kind, media type, byte length, SHA-256, schema/profile version where applicable, sensitivity/redaction status, and evidence IDs. The manifest and checksum-file entries identify their special roles but omit self-referential digest/size fields. Sort entries by normalized UTF-8 path bytes.
3. Create `SHA256SUMS` over every ZIP payload file including `manifest.json`, excluding `SHA256SUMS` itself. Use lowercase 64-hex digests and unambiguous escaped/validated relative filenames.
4. Recompute every digest and all semantic references from a fresh read, scan for secrets/placeholders, and only then create the ZIP.
5. Reopen the ZIP in a fresh process; reject duplicate/unsafe entries, size/path inconsistencies, checksum mismatch, undeclared required artifacts, broken references, or decompression-limit violations.
6. Write a detached `<package>.zip.sha256`. The ZIP cannot contain its own digest.
7. If encryption is requested, encrypt the already-validated ZIP, decrypt it to a scratch stream as a release test, compare the recovered ZIP SHA-256, and write `<package>.zip.age.sha256`. Encryption never substitutes for redaction.

Always produce the validated plain ZIP as required by the brief. Apply the operator/customer retention policy after delivery; do not silently delete it.

For optional protection, pin **age CLI 1.3.1** and the **age v1 format**, with release-asset digest and architecture recorded in `standards-lock.json` ([official age releases](https://github.com/FiloSottile/age/releases/tag/v1.3.1)). Restrict the RAK 1 interoperability profile to X25519 and scrypt recipient stanzas even though age 1.3.1 supports newer recipient types. Prefer X25519 recipient encryption; accept a customer-supplied `age1...` recipient only after explicit confirmation. Offer passphrase mode only as a fallback, using age’s native scrypt stanza. Generate a high-entropy passphrase by default, deliver it out of band, and never place a secret/passphrase in arguments, environment, logs, SQLite, manifests, shell history, or artifacts. The age v1 specification uses authenticated ChaCha20-Poly1305 payload chunks and defines X25519 and scrypt recipient types ([age v1 specification](https://age-encryption.org/v1)).

This profile is strong general-purpose encryption, **not a FIPS-validation claim**. If a customer requires OpenPGP interoperability, a validated cryptographic module, key escrow, hardware keys, or a regulated algorithm profile, treat that as a separately researched customer requirement. RFC 9580 OpenPGP with AEAD is the standards-based alternative, not legacy ZipCrypto ([RFC 9580](https://www.rfc-editor.org/rfc/rfc9580.html)).

### 9. Plain-language security reporting

The executive report must lead with: what was assessed, the principal issue, business consequence, recommended choice, alternatives, confidence, and important unknowns. Technical reproductions remain linked appendices.

Automated gates:

- expand every acronym on first use and reject unexplained glossary terms in the executive layer;
- flag sentences over 25 words, paragraphs over five sentences, passive voice, undefined severity, unsupported absolutes (`secure`, `safe`, `compliant`, `no risk`), and framework IDs without a plain explanation;
- require every Critical/High issue to include “what could happen,” “who/what is affected,” “what to do next,” evidence strength, and limitations;
- require uncertainty language where runtime or customer context is missing;
- calculate readability as a review signal only, not a pass by itself.

Human release gates:

- a technical reviewer confirms that simplification did not change the finding;
- a lay reviewer can state the principal risks, business effects, recommendation, alternatives, confidence, and unknowns without consultant translation.

Government plain-language guidance recommends short sentences/paragraphs, everyday words, specificity, active verbs, and audience-appropriate language; specialist terms should be explained on first use ([GOV.UK content principles](https://www.gov.uk/government/publications/govuk-content-principles-conventions-and-research-background/govuk-content-principles-conventions-and-research-background), [clear-language guidance](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/)). Readability scores cannot replace comprehension testing.

## Technical verification versus legal/compliance claims

These fields and phrases are mandatory boundaries:

| Technical statement the kit may make | Statement it must not infer |
|---|---|
| “We observed evidence that ASVS v5.0.0 control X passed within the assessed commit and test scope.” | “The product is ASVS certified/compliant.” |
| “No finding was observed by the listed techniques.” | “No vulnerability exists.” |
| “The repository evidence supports SSDF 1.1 practice PW.4 in the supplied scope.” | “The organization complies with NIST/contract/regulation.” |
| “The finding maps to CWE-79 and OWASP Top 10 A05:2025.” | “The framework legally applies.” |
| “The archive decrypted and its digest matched in this test.” | “The encryption satisfies the customer’s regulatory obligations.” |

Store applicability as `not-assessed`, `customer-stated`, or `customer-confirmed`; never `auto-determined`. A customer statement is evidence of the customer’s position, not a legal conclusion. Reports must label framework results “technical coverage against a selected profile.” Any use of “compliance,” “certification,” “attestation,” “legally required,” or a regulation name triggers manual review and must cite customer-confirmed scope plus qualified advice outside this product.

## Versioning and update strategy

1. Maintain a checked-in `standards-lock.json` (architecture chooses its path) containing profile ID, upstream name/version/release date, canonical source URL, downloaded artifact SHA-256, license/attribution, validator package/version/digest, and retrieval date.
2. Bundle immutable upstream schemas/catalog slices. Runtime assessments never fetch “latest.”
3. A kit release declares one default profile, e.g. `rak-export-profile/1.0.0`. Patch kit releases may fix generators without changing output meaning. A profile minor version may add optional backward-compatible fields. A profile major version is required for changed semantics, required fields, framework major/minor migrations that alter control sets, or incompatible upstream formats.
4. Review upstream releases quarterly and before each kit release. Updates land only through an explicit change review with changelog/diff, license review, fixture regeneration, offline validation on ARM64/x86-64, backward-reader tests, golden and negative fixtures, cross-agent dry runs, and report-language review.
5. Follow upstream semantics, not just SemVer. ASVS states major/minor changes require reevaluation while a patch may remove or relax requirements; still pin the full version and never rewrite a completed run.
6. Completed runs retain their original versions and snapshot digests forever. A newer kit may read old native contracts through explicit migrations but exports a new run/revision rather than mutating the old package.
7. Imported artifacts retain their declared version. Unsupported/new versions are preserved as opaque evidence and reported as reduced coverage; they are not silently coerced.
8. Fail closed if a declared schema/catalog snapshot, validator, or generator does not match its locked digest.

## Validation acceptance requirements

A release is not ready until fixtures prove:

- official JSON Schema 2020-12, SARIF Errata 01, and CycloneDX 1.7 validation succeeds offline and malformed/unknown-version fixtures fail;
- custom semantic validation catches duplicate IDs/JSON keys, broken evidence/control/artifact references, invalid state/reason combinations, mismatched commit identities, unsafe paths, cycles, and prohibited CWE mappings;
- CVSS reference vectors reproduce official scores; imported older vectors survive unchanged;
- every selected ASVS/WSTG/Top 10/SSDF reference contains a version and resolves in the pinned snapshot;
- incomplete SBOM fixtures cannot be marked `complete`;
- the package validates before and after ZIP creation, every payload digest matches, and tampering with any byte fails validation;
- age recipient and passphrase fixtures decrypt successfully on Linux ARM64/x86-64, a wrong key/passphrase fails without releasing plaintext, and recovered ZIP bytes match the detached digest;
- seeded secrets and absolute host paths are absent from native JSON, SARIF, CycloneDX, reports, evidence, manifest, checksums, ZIP metadata/content, and encrypted-wrapper metadata;
- unsupported framework/tool versions yield explicit reduced coverage rather than a false pass;
- prohibited compliance phrases fail the executive-report gate, and both technical and lay reviewers pass the report.

## Risks / what would change this

- **CycloneDX consumer lag:** Some downstream tools may not yet ingest 1.7. If a named customer system only accepts 1.6, emit an additional explicitly downgraded projection after loss analysis; keep 1.7 canonical.
- **SARIF consumer quirks:** Consumers may ignore property bags or taxonomies. Keep native JSON canonical and test required consumers; do not overload standard SARIF fields with incompatible meaning.
- **ASVS/WSTG releases:** ASVS 5.0.1 or WSTG 5.0 could justify a profile update, but only after control/ID diffs and acceptance reruns. Their publication does not change old runs.
- **Cryptographic policy:** A customer FIPS, enterprise-PKI, HSM, escrow, or OpenPGP requirement would flip the age recommendation for that engagement. This needs security/legal procurement confirmation, not automatic detection.
- **Digital authenticity requirement:** SHA-256 proves integrity only relative to a trusted digest. If authorship/non-repudiation is required, add a separately specified digital-signature profile and key lifecycle; do not describe checksums as signatures.
- **Full provenance interchange:** A customer demanding RDF/SPARQL provenance could justify a PROV-O export, while the native model remains canonical.
- **Unknown future standards:** JSON Schema’s next published dialect, SARIF 2.2+, CVSS 4.x+, or a withdrawn algorithm requires a new reviewed profile, never a floating dependency.

## Sources

All accessed 2026-07-27.

- JSON Schema, current specification and Draft 2020-12: https://json-schema.org/specification and https://json-schema.org/draft/2020-12
- OASIS SARIF 2.1.0 Plus Errata 01: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
- CycloneDX current overview and 1.7 JSON reference: https://cyclonedx.org/specification/overview/ and https://cyclonedx.org/docs/1.7/json/
- CWE 4.20 release and schema 7.3: https://cwe.mitre.org/news/ and https://cwe.mitre.org/documents/schema/index.html
- CWE root-cause mapping guidance: https://cwe.mitre.org/documents/cwe_usage/guidance.html
- OWASP ASVS 5.0.0: https://github.com/OWASP/ASVS/tree/v5.0.0_release
- OWASP WSTG project/version guidance: https://owasp.org/www-project-web-security-testing-guide/
- OWASP Top 10:2025: https://owasp.org/Top10/
- NIST SP 800-218 SSDF 1.1: https://csrc.nist.gov/pubs/sp/800/218/final
- FIRST CVSS 4.0 specification, user guide, consumer guide, and data representation: https://www.first.org/cvss/v4.0/specification-document, https://www.first.org/cvss/user-guide, https://www.first.org/cvss/v4.0/implementation-guide, and https://www.first.org/cvss/data-representations
- W3C PROV-O Recommendation: https://www.w3.org/TR/prov-o/
- NIST FIPS 180-4 Secure Hash Standard: https://csrc.nist.gov/pubs/fips/180-4/upd1/final
- RFC 8785 JSON Canonicalization Scheme and errata: https://www.rfc-editor.org/rfc/rfc8785.html and https://www.rfc-editor.org/errata/rfc8785
- age v1 format specification: https://age-encryption.org/v1
- age CLI 1.3.1 release: https://github.com/FiloSottile/age/releases/tag/v1.3.1
- RFC 9580 OpenPGP: https://www.rfc-editor.org/rfc/rfc9580.html
- GOV.UK plain-language guidance: https://www.gov.uk/government/publications/govuk-content-principles-conventions-and-research-background/govuk-content-principles-conventions-and-research-background and https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/

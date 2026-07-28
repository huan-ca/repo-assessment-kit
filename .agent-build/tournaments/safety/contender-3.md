# Safety, Privacy, and Evidence-Integrity Specification — Contender 3

**Strategy:** evidence is untrusted until admitted, customer-visible only after irreversible
redaction, and releasable only through a staged, independently reviewed, tamper-evident
package pipeline.

**Status:** implementable safety contender for RAK 1.0  
**Target:** Repository Assessment Kit  
**Primary owners:** evidence admission, reporting, packaging, workflow, persistence, UI,
and QA lanes  
**Normative language:** **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are requirements
keywords. A release gate marked blocking cannot be waived by an agent or judgment review.

## 1. Safety objective and release posture

The kit handles hostile repositories, customer-confidential source, scanner output,
screenshots, logs, product-owner statements, and potentially live sandbox credentials.
Its customer ZIP may become a durable record used for a consequential modernization
decision. The principal safety objective is therefore not merely to avoid obvious secret
leaks: it is to preserve what was actually observed, disclose what was not observed, prevent
untrusted bytes from becoming active content, and make every customer-visible transformation
and omission reviewable.

RAK MUST fail closed at the evidence-admission and packaging boundaries. Static assessment
may continue when dynamic testing is unavailable, but the kit MUST NOT release a package
that has an unresolved evidence reference, suspected secret, unreviewed High/Critical
finding, unexplained truncation affecting a material claim, failed checksum, unsafe archive
entry, or missing mandatory human review.

Checksums establish integrity relative to a trusted digest. They do not establish
authorship, non-repudiation, legal admissibility, certification, or the truth of an
assessment conclusion. Reports and UI copy MUST use that distinction.

## 2. Product-specific threat model

### 2.1 Protected assets

1. Customer repository content, including source, history, configuration, secrets,
   personal data, proprietary algorithms, and contractual information.
2. Explicitly supplied sandbox credentials and one-use runtime secrets.
3. SSH keys, agent sockets, provider authentication state, provider homes, and host paths.
4. Evidence provenance: target commit/snapshot, capture method, tool identity, occurrence
   identity, activity, limitations, and transformations.
5. Customer deliverables: reports, structured exports, screenshots, logs, manifest,
   checksums, ZIP, optional encrypted wrapper, and their detached digests.
6. Operational state: SQLite data, quarantine, canonical evidence, provider exchange,
   runtime exchange, internal logs, backups, package staging, and deletion audit records.
7. Customer trust in scope, coverage, severity, confidence, and recommendation.

### 2.2 Trust boundaries

Trusted components are limited to the pinned RAK server/workflow, contracts and policy
locks, evidence admission worker, trusted preview/image worker, report renderer, package
validator, packager, secret broker, persistence layer, authenticated host helper, pinned
worker image, and runtime broker.

The following are always untrusted input, even when syntactically valid:

- repository files, names, symlinks, history, instructions, Markdown, HTML, SVG, XML,
  archives, PDFs, Docker/Compose files, images, and application responses;
- provider/model output and suggested evidence relationships;
- scanner output, stderr, reports, exit text, locations, and media-type claims;
- target-rendered pages, browser storage, downloads, screenshots, traces, HAR data, and logs;
- owner-supplied prose, URLs, analytics labels, filenames, and imported reports;
- ZIPs or evidence packages reintroduced for validation.

No provider, scanner, target process, browser probe, or report text can directly create an
admitted evidence record, validation certificate, package entry, pass result, or released
artifact.

### 2.3 Priority threats

| Priority | Threat and abuse story | Consequence | Required defense |
|---|---|---|---|
| Critical | A seeded or real credential is copied through scanner JSON, stderr, a screenshot, a filename, report prose, manifest metadata, ZIP metadata, or an encrypted wrapper. | Credential compromise and customer data breach; encryption does not cure the released leak. | Compartmentalized secrets, streaming redaction, known-secret canaries, detector ensemble, image review, metadata scan, fresh-process ZIP scan, block release. |
| Critical | Target-controlled HTML/SVG/Markdown or a screenshot payload executes when the operator previews evidence or opens the report. | Provider/session theft, local API actions, misleading report content, or host compromise through a parser. | Attachment-only raw evidence; bounded parsers; text-node rendering; trusted image decode/re-encode; passive static HTML; strict CSP; no privileged inline preview. |
| High | Identical bytes are deduplicated as one “piece of evidence,” erasing separate captures, locations, activities, or contradictory contexts. | False provenance, invalid conclusions, and inability to audit retries or redactions. | Per-run content blob plus immutable occurrence/activity split; no provenance deduplication. |
| High | A stale, timed-out, or superseded job races a current job and admits plausible output. | Evidence from the wrong inputs or policy contaminates the final recommendation. | Attempt/fence validation, input digest binding, immutable completion certificates, reject stale receipts. |
| High | A report or package silently omits a failed/truncated scanner result, excluded screenshot, or untested domain. | Customer interprets incomplete assessment as success. | Coverage reconciliation, explicit truncation/omission records, materiality gate, required limitations report. |
| High | Package staging is altered after review or a ZIP is built with path collisions, duplicate names, traversal, links, or a decompression bomb. | Review bypass, file overwrite on extraction, or denial of service. | Frozen staging, no-follow traversal, normalized paths, JCS manifest, checksums, deterministic bounded ZIP, fresh-process reopen. |
| High | An attacker modifies the ZIP and supplies a matching replacement checksum beside it. | Undetected tampering when recipient trusts an unbound digest. | Display/capture digest at release, deliver detached digest through an authenticated channel; never claim signature semantics. |
| High | Raw quarantine, provider exchange, backups, or deleted-run trash outlives its purpose or crosses engagements. | Later disclosure of secrets/customer data despite a clean ZIP. | Per-run isolation, no cross-run CAS, named retention, explicit cleanup, two-phase deletion, backup reconciliation. |
| Medium | Hashing a low-entropy secret or retaining a stable secret fingerprint creates an offline guessing oracle. | Redacted secret can be recovered or correlated. | Never export raw-secret hashes; do not use secret material in IDs/fingerprints; random redaction tokens. |
| Medium | Redaction changes the meaning of evidence or breaks source locations without disclosure. | Reviewer cannot reproduce or may accept a distorted finding. | Immutable derivation record, reason-coded transforms, source/result relationship, reviewer gate, limitations. |
| Medium | An optional hosted service or provider receives more source/evidence than the operator understood. | Confidentiality and retention risk outside the local sandbox. | Exact data-category/destination disclosure and per-run approval; minimize context; no silent upload/fallback. |
| Medium | Deletion follows a target-controlled link or shared hardlink into another run. | Cross-run destruction or incomplete deletion. | Canonical path ownership, link rejection, device/inode checks, run-specific trash, deletion proof. |

### 2.4 Safety invariants

These invariants are not overridable:

1. The assessed snapshot is immutable and bound to every evidence occurrence and package.
2. Every capture is a distinct occurrence even when its bytes match an existing blob.
3. Every customer-visible byte is admitted, classified, scanned, and either nonsecret or
   the output of a recorded redaction transformation.
4. Untrusted active content is never rendered in the privileged UI or report renderer.
5. A positive material claim is evidence-linked; an unsupported factor is visibly
   `unverified` or `conflicting`.
6. Every partial, blocked, not-applicable, or not-tested result has a reason and coverage
   effect.
7. Truncated input never supports a claim that depends on the unseen remainder.
8. A review cannot override deterministic schema, secret, path, integrity, or package
   validation.
9. Optional encryption is applied only to an already valid redacted ZIP and never replaces
   redaction.
10. Validated packages and admitted evidence are never silently deleted to recover space.

## 3. Data map and privacy posture

### 3.1 Data inventory

| Data class | Purpose | Where allowed | Customer ZIP | Retention / deletion |
|---|---|---|---|---|
| Repository snapshot | Define immutable assessment scope | Per-run internal snapshot and disposable VM | Identity/manifest only; source files only when explicitly admitted and redacted as necessary | Life of run; explicit deletion |
| Owner statements and discovery answers | Establish business context | SQLite/canonical JSON | Redacted product claims | Life of run/package |
| Source-derived evidence | Support findings and decisions | Quarantine, per-run CAS, canonical revision | Minimum necessary excerpt/artifact only | Quarantine max 7 days after terminal; admitted life of run |
| Secret detector matches | Locate exposure without retaining secret | Ephemeral analyzer memory; redacted result | Rule/type/location only | Matched value MUST NOT persist |
| Sandbox credentials | Authorized test access | In-memory/tmpfs secret broker and exact recipient | Never | Revoke on use, cancel, timeout, or terminal run |
| SSH/provider authentication | Acquisition/inference | Provider-specific home or exact read-only SSH input | Never | Until explicit engagement cleanup; never copied between engagements |
| Provider/scanner raw output | Normalize and diagnose | Attempt outbox/quarantine | Only admitted redacted projection or justified redacted native output | Rejected/raw max 7 days; provider exchange 30 days |
| Runtime/browser logs and traces | Evidence of observed behavior | Runtime outbox/quarantine | Customer-relevant redacted subset only | Internal logs 30 days |
| Screenshots | Visual runtime evidence | Raw quarantine; trusted re-encoded derivative | Only reviewed derivative | Raw subject to quarantine retention; derivative life of run |
| Operational metadata | Resume, fences, reviews, deletion audit | SQLite | Only validated export subset | Per engagement policy; backups as defined below |
| Package and detached digests | Customer delivery | Per-run package directory | ZIP content plus detached digest beside it | Until explicit package deletion |
| Optional age secret | Encrypt package | Protected one-use channel only | Never | Zeroize/revoke after encryption verification |

### 3.2 Minimization and purpose limitation

- Evidence capture MUST default to the smallest artifact or excerpt sufficient to reproduce
  a finding or support a decision factor. Whole repositories, databases, browser profiles,
  request bodies, cookies, local storage, and full transcripts MUST NOT be exported merely
  for convenience.
- The operational database MUST NOT store repository source, raw screenshots, large logs,
  secret values, passphrases, private keys, provider tokens, or SSH material.
- Customer exports MUST exclude SQLite, provider homes/transcripts, source handles, raw
  quarantine, internal debug logs, and credentials.
- Optional provider/hosted-service disclosure MUST name provider, destination, exact data
  categories, purpose, credential, and known retention/policy caveat before approval.
  Consent to provider inference does not imply consent to an optional scanner, build
  service, or target-runtime egress.
- Redaction records MUST describe the transform without reproducing the sensitive value.
- Filenames, titles, source locators, error messages, analytics labels, manifest fields,
  ZIP comments, archive names, and HTTP headers are data-bearing and receive the same
  classification and scan as file bodies.

### 3.3 Applicable standards and legal boundary

RAK 1 adopts technical profiles already frozen by architecture: W3C PROV-aligned
Entity–Activity–Agent provenance, RFC 8785 JSON canonicalization, SHA-256, JSON Schema
Draft 2020-12, SARIF 2.1.0 Errata 01, CycloneDX 1.7, and age v1/CLI 1.3.1 where optional
encryption is selected.

No privacy law, industry regime, contractual security schedule, legal-hold duty, or
certification is automatically applicable. Applicability is `not-assessed`,
`customer-stated`, or `customer-confirmed`, never inferred from repository contents. If a
customer confirms a privacy or regulated-data regime, the operator MUST select a reviewed
overlay defining collection, access, retention, deletion, encryption, breach handling, and
recipient requirements before capture. The kit MUST not state “compliant,” “certified,”
“attested,” or “legally required” from technical evidence alone.

## 4. Evidence identity, provenance, and admission

### 4.1 Blob and occurrence identity

- `EvidenceBlob` is content identity within exactly one run: SHA-256, byte length, detected
  media type, storage path, and storage state. Deduplication across runs or engagements is
  forbidden.
- `EvidenceOccurrence` is evidentiary identity: a new immutable ID for each capture,
  repository location, execution, review, import, preview, redaction, re-encoding, or
  truncation. Occurrences MAY reference the same blob.
- A blob digest MUST NOT be used as the occurrence ID, finding ID, claim ID, redaction
  token, or review identity.
- Content equality MUST NOT merge source locations, timestamps, activities, limitations,
  finding/control links, reviewer states, or contradictions.
- Source/results that contain or may contain a secret MUST NOT export a digest of the raw
  secret-bearing bytes. Low-entropy values are vulnerable to offline guessing. Customer
  manifests hash only the admitted redacted derivative.
- Finding fingerprints MUST exclude raw text, secret hashes, absolute paths, usernames,
  hostnames, and volatile line numbers. A versioned fingerprint may use rule identity,
  normalized repository-relative path, structural location, and nonsecret semantic
  context.

### 4.2 Required occurrence provenance

Every occurrence MUST bind:

- run, snapshot, full commit or frozen-working-tree manifest identity;
- attempt and current fence;
- producing activity and agent/tool identity, exact version or image digest;
- capture time and outcome;
- sanitized command or configuration digest;
- repository- or package-relative locator and precise region when actually known;
- media type, byte length, sensitivity, redaction state, validation state;
- collection limitations, truncation state, and exclusion reason;
- parent occurrence IDs for every transformation;
- claim, finding, control, review, and package links.

An occurrence against a different snapshot is rejected unless its relationship is
explicitly `external-comparison`, its source and date are disclosed, and no control is
marked passed solely from it.

### 4.3 Admission pipeline

Evidence moves in one direction:

`untrusted producer → closed per-attempt outbox → quarantine → validation/redaction →
per-run CAS → immutable occurrence → canonical revision → frozen package staging`.

Admission MUST:

1. Verify run, attempt, current fence, input digest, artifact intent, declared maximum size,
   expected path, and producer identity before opening bytes.
2. Open paths no-follow beneath the expected outbox, reject links and special files, and
   stream through byte/output limits. A producer cannot choose a CAS or package path.
3. Detect media type from bytes, not extension or producer assertion.
4. Record `bytesExpected`, `bytesReceived`, `complete`, `truncated`, `truncationReason`,
   parser outcome, and producer exit semantics. Scanner “findings present” exit codes are
   distinct from tool failure.
5. Hash the received bytes while streaming; compare any expected digest and fsync a
   temporary object before atomic rename.
6. Run duplicate-key-rejecting schema and semantic validation, path/host-path validation,
   target identity checks, reference checks, derivation-cycle checks, and secret policy.
7. Insert/reuse only the blob in one SQLite transaction; always create a new occurrence,
   activity relations, links, validation event, and artifact state.
8. Reject a late/superseded receipt, unknown tool output version, malformed/truncated
   structured result, digest mismatch, or unclassified high-risk media. Rejection creates
   a limitation/coverage effect; it never becomes “zero findings.”

Admission failure cannot be converted to pass by model explanation. Recovery may finalize
only an already verified atomic intent with the same fence and digest.

### 4.4 Truncation and omission

- Limits MUST be declared by named policy profile and recorded before capture.
- Streaming collectors MUST stop or terminate the producer when a byte/time/count limit is
  reached; they MUST NOT continue accumulating unbounded raw bytes elsewhere.
- A truncated occurrence records original declared size when known, captured byte count,
  truncation point/method, reason, affected parser, and coverage effect.
- Head-only, tail-only, sampled, cropped, or redacted evidence is a derivative occurrence,
  never mislabeled as the complete source.
- A parser may not treat a truncated JSON, SARIF, CycloneDX, CSV, archive, trace, or scanner
  output as a successful complete result.
- If truncation could hide additional findings, the domain is `partial`, never `pass`.
- Every omitted required artifact has a manifest/coverage explanation. “No screenshots”
  is valid only when screenshots were not applicable, not safely capturable, or excluded
  with an explicit limitation.

## 5. Secret discovery and redaction

### 5.1 Secret compartments

- SSH material, provider homes, agent sockets, `.env` values, sandbox credentials, age
  identities/passphrases, and runtime secrets MUST be inaccessible to scanners, provider
  tasks, target code, report rendering, and package staging unless a narrowly scoped
  component is their intended recipient.
- Secret broker values use opaque handles, one-use redemption, purpose and recipient
  binding, expiry, and revocation. There is no list/readback API.
- Supplied values and generated credential canaries MUST be registered with the
  redaction validator without logging the value. Canary registration state itself is
  restricted and not exported.
- Secret values MUST NOT appear in process arguments, environment dumps, SQLite, shell
  history, error envelopes, metrics labels, audit summaries, or filenames.

### 5.2 Detection layers

The final redaction decision MUST combine:

1. Exact matching for supplied sandbox values and release-test canaries, including encoded
   and common quoted forms where safely derivable in memory.
2. Pinned Gitleaks rules/output in full-redaction mode.
3. Pinned Trivy secret correlation as an independent technique, without claiming it proves
   absence.
4. Release-owned detectors for private key headers, SSH material, bearer/basic
   authorization, session cookies, common cloud tokens, connection strings, high-entropy
   assignments, credential-bearing URLs, host absolute paths, and provider/agent artifacts.
5. Structured-field scanning of JSON/SARIF/CycloneDX/CSV/report ASTs, manifest fields,
   evidence titles/locators, logs, HTTP metadata, and ZIP entry metadata.
6. Image-specific inspection and human review described below.

Detectors and allowlists are pinned, versioned, digest-locked, fixture-tested, and recorded
in the redaction activity. A scanner-clean result means only “not detected by the listed
techniques.”

### 5.3 Transformation rules

- A secret match is removed or replaced with a typed, random, occurrence-local marker such
  as `[REDACTED:CREDENTIAL]`. The marker MUST NOT encode a secret prefix/suffix, digest,
  equality class, account name, or stable cross-run token.
- Context retained around a match MUST be the minimum needed to understand the evidence.
  Retaining a “last four characters” hint is forbidden unless a customer policy explicitly
  requires and reviews it.
- Text redaction MUST preserve an explicit mapping from original region to output region
  without retaining the removed bytes. Reports cite the redacted occurrence and original
  repository location, not an unexported raw-secret hash.
- Binary, archive, database, PDF, encrypted, unknown-encoding, or structurally unsafe
  artifacts are excluded by default. They are not byte-patched in place.
- A transformation produces a new blob, occurrence, activity, and
  `RedactionDerivation`. The source occurrence remains quarantined/restricted and cannot
  enter reporting or staging.
- `sourceDigestRetained` MUST be false when the source contains an actual/suspected
  low-entropy secret, authentication material, personal-data export, or customer policy
  forbids correlation.
- Redaction state is fail-closed: only `none-required` or `redacted` may enter package
  staging. `pending`, `secret-suspected`, `restricted` without an approved safe derivative,
  or `excluded` cannot be packaged.

### 5.4 Logs and command evidence

- Operational logs are structured allowlists: request/run/phase/attempt/activity IDs,
  duration, outcome, reason code, byte counts, coverage effect, and redaction count.
  Bodies, headers, cookies, source lines, raw output, command environment, and credentials
  are denylisted from the logging API.
- Commands are captured as typed operation plus sanitized arguments. Free-form shell
  strings, URLs with userinfo/query secrets, and environment dumps are forbidden.
- Scanner/provider stdout and stderr go only to the closed attempt outbox with hard byte
  and time bounds. A streaming scrubber removes known secret values before diagnostic
  display, but the raw stream remains quarantined and is not exported.
- Customer logs are regenerated from typed events, not copied from operational log files.
- Log rotation, truncation, crash dumps, and process supervisor messages receive the same
  scan. Core dumps are disabled.

### 5.5 Screenshots, traces, and browser artifacts

- Screenshot capture is off until the runtime gate passes and the control declares why a
  screenshot is necessary. Password, token, payment, profile, admin-secret, and
  customer-data views are excluded by default.
- The probe MUST clear or avoid cookies/local storage not needed for the test, disable
  downloads, and capture only the approved internal origin and viewport.
- A raw screenshot enters quarantine only. A trusted worker decodes under byte, pixel,
  frame, memory, and time limits; rejects malformed/multi-frame/polyglot data; strips EXIF,
  text chunks, ICC/comment/application metadata; flattens to pixels; and re-encodes as
  pinned PNG or JPEG.
- OCR/secret-pattern detection and known-canary matching are mandatory but explicitly not
  sufficient. A reviewer must inspect every packaged screenshot at readable zoom for
  credentials, personal/customer data, browser chrome, host paths, and misleading crop.
- Cropping, masking, or annotation creates a new redaction occurrence. The package states
  that the image is transformed and identifies the crop/mask reason.
- Playwright traces, HAR files, videos, downloads, PDFs, browser profiles, DOM snapshots,
  response bodies, and console dumps are internal attachments by default and MUST NOT ship
  in the MVP package. A future export profile requires its own parser and redaction review.

## 6. Safe display and reporting

### 6.1 Privileged UI

- Raw HTML, SVG, XML, JavaScript, CSS, PDF, archives, scanner HTML, GIF, unknown images,
  and unknown media are attachment-only.
- Attachments use a server-generated safe filename, `Content-Disposition: attachment`,
  `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`,
  `Cross-Origin-Resource-Policy: same-origin`, and a deny-all sandbox CSP.
- Plain text and allowed structured formats are parsed under byte/node/depth/count limits
  with duplicate keys rejected, then returned as structured values. The UI renders
  untrusted values via text nodes; no `dangerouslySetInnerHTML`, Markdown-to-HTML, template
  evaluation, plugin renderer, data URL from evidence, or target-controlled link is allowed.
- Only trusted decoded/re-encoded PNG/JPEG/WebP derivatives may preview inline.
- Target pages never load in the operator origin, iframe, popup, or privileged window.
- UI API/SSE/error objects contain no raw evidence body, cookie, credential, host path, or
  unbounded diagnostic. Evidence downloads require an occurrence ID and server-side
  authorization to the current run.

### 6.2 Customer reports

- Reports are projections from canonical typed documents and a release-owned report AST.
  Target/owner/scanner/model content can populate text, code, and table-cell nodes only.
- HTML serialization escapes all values. Markdown serialization neutralizes raw HTML,
  directives, images, and active links. Links resolve only to declared package-relative
  artifacts; otherwise they render as inert text.
- Shipped HTML contains no script, event handler, form, iframe, object/embed, SVG, external
  URL, base tag, meta refresh, active download, or target-controlled style.
- Every HTML report has the architecture-specified deny-by-default CSP and only the
  release-owned CSS block whose hash matches the renderer lock.
- A bounded non-browser validator reparses generated HTML and rejects forbidden
  tags/attributes/schemes, CSP mismatch, undeclared resource, unescaped sentinel, or parser
  disagreement. The authenticated UI never opens report HTML inline.
- Report generators cannot create or change evidence, coverage, finding validation, or
  review state. Unsupported claims fail semantic validation.

## 7. Reviews and decision-integrity gates

### 7.1 Automated gates

Before review, validators MUST prove:

- target/snapshot identity, current attempt/fence, unique IDs, acyclic derivations, valid
  supersession, and all referenced objects exist;
- every material claim and decision factor has evidence or is visibly
  `unverified`/`conflicting`;
- every planned domain/control has exactly one allowed status and every non-pass has a
  reason, limitation, and follow-up;
- all included artifacts have approved sensitivity/redaction state;
- secret, known-canary, host-path, placeholder, active-content, unsafe-link, and forbidden
  compliance-language scans pass;
- no decision-critical evidence is malformed, incomplete, stale, invalidated, or
  materially truncated without the resulting limitation reflected in confidence.

### 7.2 Mandatory independent and human reviews

All four reviews are package blockers:

1. **Independent security review:** a fresh-context reviewer evaluates each security
   finding and decision-critical security occurrence as corroborated, independently
   reproduced, disputed, invalidated, or not assessed.
2. **Independent decision review:** checks the same stated criteria across remediation,
   incremental replacement, and rebuild; verifies evidence, unknowns, confidence, and
   reversal conditions.
3. **Technical human review:** confirms source locations, redaction did not change meaning,
   limitations/truncation are visible, High/Critical consequence and next action are
   accurate, and report simplification preserves findings.
4. **Lay human review:** can identify scope, principal risks, business effects, options,
   recommendation, confidence, and important unknowns without consultant translation.

The technical human reviewer MUST inspect every packaged screenshot and every artifact
classified customer-confidential or derived from secret-suspected input. The person
approving final release MUST see the package revision, target snapshot, ZIP digest,
remaining limitations, excluded artifact count, and optional encryption recipient.

A verdict of `failed` blocks packaging. `passed-with-objections` is allowed only when every
objection is represented as a customer-visible limitation or correction and no deterministic
gate failed. An agent cannot self-approve the output it generated as an independent review.

## 8. Package construction, integrity, and encryption

### 8.1 Package inventory

The required inventory is the frozen architecture inventory: executive, decision,
technical, security, and coverage/limitations reports in HTML and Markdown; canonical run,
snapshot, claims, findings, controls, coverage, evidence index, decision, reviews, and
equivalence JSON; SARIF, CycloneDX, CSV; admitted evidence; safe screenshots when any;
customer-relevant redacted logs; licenses; `manifest.json`; and `SHA256SUMS`.

SQLite, source handles, provider transcripts/homes, SSH, credentials, raw quarantine,
unredacted evidence, internal logs, browser profiles/traces, and package secrets are
forbidden.

### 8.2 Staged release state machine

Packaging is an append-only state machine:

1. `ADMISSION_COMPLETE`
2. `REDACTION_COMPLETE`
3. `REVIEWS_COMPLETE`
4. `STAGING_FROZEN`
5. `MANIFESTED`
6. `PREZIP_VALID`
7. `ZIP_CREATED`
8. `ZIP_REOPEN_VALID`
9. `RELEASED`

Each transition requires a validation occurrence and certificate binding run, snapshot,
canonical revision, prior certificate digest, tool/policy locks, artifact set digest,
review IDs, actor, and timestamp. A later stage cannot run without the exact prior
certificate. Any content change after `STAGING_FROZEN` creates a new package revision and
restarts at redaction/review as affected; no in-place patching.

### 8.3 Frozen-tree and manifest algorithm

1. Preflight quotas and storage headroom. Copy only allowlisted admitted/redacted artifacts
   into a new staging revision using no-follow descriptors.
2. Reject symlinks, hardlinks, device files, sockets, FIFOs, sparse/unsupported special
   forms, absolute paths, backslashes, `.`/`..`, NUL/control characters, duplicate paths,
   and Unicode/case-normalization collisions.
3. Normalize package paths to relative POSIX UTF-8 and enforce per-file, total-byte,
   entry-count, depth, name-length, and decompression limits.
4. Make the staging tree immutable to all components except the packager before manifest
   generation. Record filesystem/device/inode metadata sufficient to detect replacement
   during the operation.
5. Generate `manifest.json` as RFC 8785 JCS. It declares every payload path, including
   manifest/checksum self entries. Ordinary entries contain path, kind, detected media
   type, byte length, SHA-256, schema/profile, sensitivity/redaction state, and occurrence
   IDs. Self entries omit self-referential length/hash. Sort by normalized UTF-8 path bytes.
6. Generate `SHA256SUMS` for every payload including `manifest.json` and excluding itself,
   using lowercase 64-hex and an unambiguous validated filename encoding.
7. In a fresh process, reopen every staged file no-follow, recompute bytes/digests,
   schemas/references, inventory, secret/host-path/placeholder/active-content scans, and
   confirm immutable file identity.

### 8.4 ZIP and tamper validation

- Create a normalized ZIP without comments, extra fields containing host/user/time/path
  data, links, encryption, or executable semantics. Entry names come only from the
  validated manifest.
- The validator MUST reopen the ZIP in a fresh low-privilege process and stream every entry
  under compressed-size, uncompressed-size, ratio, total-byte, entry-count, depth, and time
  limits.
- It MUST reject duplicate/local-central-directory disagreement, unsafe or normalized-name
  collision, undeclared/missing entry, trailing unexpected data, unsupported compression,
  size mismatch, checksum mismatch, schema/reference failure, or changed required inventory.
- Emit `<package>.zip.sha256` outside the ZIP. Release UI shows and records the digest and
  recommends delivery of the digest through an authenticated channel separate from the
  package.
- A mutation of any byte in any payload, manifest, checksum file, ZIP directory, or
  detached digest fixture MUST fail validation. A matching attacker-replaced checksum is
  not prevented without an authenticated external channel or signature; this residual risk
  MUST remain visible.

### 8.5 Optional age protection

- Always create and retain the validated plain ZIP required by the brief. Encryption is an
  additional transport/storage control.
- Pin age CLI 1.3.1 and age v1 with verified release digest per architecture. RAK 1 permits
  X25519 recipients and scrypt fallback only.
- Prefer a customer-supplied X25519 recipient confirmed out of band. Display its recipient
  string/fingerprint and require explicit confirmation before encryption.
- Passphrase fallback uses a generated high-entropy value delivered out of band through a
  protected channel. It is never passed in argv, environment, SQLite, logs, metrics,
  manifests, artifacts, or shell history.
- Encrypt only the `ZIP_REOPEN_VALID` bytes. Decrypt the wrapper to a scratch stream in a
  fresh process, compare the recovered ZIP SHA-256, and emit
  `<package>.zip.age.sha256`. Wrong key/passphrase must fail without exposing partial
  plaintext.
- Scratch plaintext and secret channels are zeroized/unlinked on success, failure, signal,
  timeout, and startup reconciliation.
- Age is not a FIPS, escrow, signature, authorship, or customer-regulatory claim. Customer
  requirements for those properties block delivery until a separately approved profile
  exists.

## 9. Retention, deletion, and storage failure

### 9.1 Required retention defaults

- failed pre-snapshot intake: 7 days;
- rejected/unadmitted quarantine: no longer than 7 days after terminal run;
- operational logs and provider/runtime exchange: 30 days;
- admitted canonical evidence and snapshot: life of run;
- DB backups: latest five plus one per packaged run;
- provider engagement homes: until explicit engagement cleanup;
- validated plain ZIP and optional age wrapper: until explicit package deletion.

Operators may set shorter internal retention before a run. A legal/customer hold or longer
retention requires explicit policy and access review. The system MUST show what will remain
before cleanup and MUST NOT silently delete the plain ZIP after creating an encrypted
wrapper.

### 9.2 Isolation and access

- Every run has its own quarantine, CAS namespace, canonical revisions, staging, packages,
  and trash. Cross-run hardlinks and content deduplication are forbidden.
- Internal directories use least-privilege ownership and are not served by the web server.
  Package download is the only customer-artifact route.
- Backups inherit the sensitivity and deletion obligations of the data they contain.
  Package retention must not depend on SQLite availability.
- Disk headroom failures stop new work. They never trigger automatic deletion of admitted
  evidence, backups needed for recovery, or packages.

### 9.3 Two-phase deletion

- Active runs cannot be deleted.
- Scopes are `internal-only`, `run-except-packages`, and `entire-run`.
- Package deletion requires `includePackages=true`, exact project slug, and confirmation of
  every package digest. Engagement-home deletion is a separate explicit action.
- Before moving data, revoke secrets and prove there is no live lease, helper command, VM,
  open packager, or provider task. Resolve every target beneath the run root using no-follow
  descriptors; reject symlink, hardlink, device, inode, filesystem, ownership, or path
  anomalies.
- Record an immutable tombstone containing run/scope, package digests, artifact classes,
  actor, reason, requested time, and deletion-job result, but no deleted source/secret.
- Atomically move selected paths to a run-specific protected trash directory. Keep a
  24-hour recovery window, then remove. The UI reports whether recovery remains possible.
- Verify absence from active paths, trash after expiry, SQLite references, backup policy,
  and provider/runtime resources. Report every removed and retained class plus failures.
- A partial deletion is an incident/warning, not success. Retry is idempotent and cannot
  broaden scope without new confirmation.

### 9.4 ENOSPC and crash behavior

Before source capture, analyzer dispatch, admission, rendering, staging, ZIP, and encryption,
record free/total bytes, configured reserve, predicted write, and decision. Preserve the
architecture reserve and temp/final headroom formulas.

On `ENOSPC`, digest mismatch, or interrupted atomic write: close and unlink only the current
temporary file, fsync its parent when possible, mark intent interrupted, stop SQLite writes
when durability is uncertain, and require integrity/reconciliation after recovery. Unknown
objects return to quarantine. Never “complete” a package from a partially written file.

## 10. Incident behavior

### 10.1 Suspected secret or personal-data leak before release

1. Block preview/download/staging and freeze the affected run without deleting evidence
   needed to determine scope.
2. Revoke run secrets and sandbox credentials; stop relevant provider, optional-service,
   runtime, and package activity.
3. Identify every derived occurrence, report, log, backup, staging revision, ZIP, wrapper,
   and external destination that could contain the value.
4. Quarantine invalid customer artifacts and invalidate their release certificates.
5. Prompt the operator to rotate/revoke the credential through the owning system; RAK MUST
   not attempt external rotation without separate authority.
6. Create a sanitized incident record with detection time, data class, affected artifact
   IDs/digests, exposure destinations, containment, operator actions, and unresolved scope.
7. After correction, create new evidence/package revisions and rerun redaction, reviews,
   pre-ZIP, ZIP reopen, and encryption verification. Never overwrite the old record in place.

### 10.2 Leak discovered after delivery

The UI MUST state that ZIP/age delivery cannot be recalled. It directs the operator to stop
distribution, notify intended recipients through the engagement’s approved process, revoke
affected credentials, remove shared copies where possible, preserve minimal sanitized
incident evidence, and generate a replacement revision with a new digest. The old package
digest is marked `REVOKED/DO_NOT_USE` in local state, but this label is not represented as
remote deletion. Any legal notification decision is outside automatic RAK behavior and
requires the customer’s qualified process.

### 10.3 Integrity or tamper failure

A manifest, checksum, stage-certificate, or ZIP mismatch blocks release and marks the package
revision invalid. Repeated mismatches, file identity changes after freeze, or unexpected
staging writers are treated as possible trusted-component/host compromise: stop packaging,
preserve sanitized hashes and audit metadata, rotate package staging, verify tool/policy
locks and host integrity, and require a clean rerun. Do not “repair” a released ZIP by
editing its manifest.

### 10.4 Parser, renderer, or archive exploit signal

Crash, resource-limit breach, forbidden active content, decompression bomb, polyglot image,
or parser disagreement causes attachment exclusion and affected coverage/limitation. The
kit does not retry through a less restrictive parser, browser, or shell tool. A trusted
component crash produces internal diagnostics only after redaction.

### 10.5 External egress uncertainty

If audit logs cannot prove what was sent to a provider/optional service, record the maximum
plausible disclosed data class, stop further egress, revoke the scoped credential, and block
release until the customer-visible limitation and incident scope are reviewed. “Local
scanner” does not erase the provider-inference disclosure.

## 11. Verification and adversarial acceptance criteria

QA MUST automate deterministic tests and retain test occurrences for:

### 11.1 Provenance and identity

- Same bytes captured at two paths/times/tools create one per-run blob but two occurrences
  with distinct activities and links.
- Identical bytes in two runs never share storage identity or deletion fate.
- A stale fence, wrong snapshot, wrong activity, changed input digest, or late receipt is
  rejected.
- Derivation cycles, missing parents, changed commit, duplicate IDs, invalid supersession,
  and a positive unsupported decision factor fail.
- Raw secret values and secret-derived hashes never appear in IDs, fingerprints, reports,
  manifest, or package.

### 11.2 Redaction

- Seed unique fake values in source, history, JSON, CSV, SARIF, CycloneDX, stdout, stderr,
  command/config, filename, evidence title, host path, HTML, Markdown, screenshot metadata,
  visible screenshot pixels, ZIP comment, and wrapper metadata. None may appear in any
  customer artifact or metadata after packaging.
- Encode canaries in common quoted/base64/URL forms supported by policy; expected detectors
  fire without retaining matches.
- Detector failure, unknown rule version, pending review, suspected secret, or scan timeout
  blocks staging.
- Redaction produces a new occurrence/derivation, preserves disclosed meaning, and cannot
  package its raw parent.
- Random local markers do not permit equality correlation across occurrences/runs.

### 11.3 Untrusted rendering

- Hostile HTML, SVG, Markdown, CSV formulas, JSON keys, filenames, image metadata, and model
  prose cannot execute script, navigate, submit, load network content, alter report
  structure, or access the local API.
- UI responses set required attachment/no-sniff/no-store/CSP headers.
- Report HTML contains no forbidden tag/attribute/scheme and its CSS CSP hash matches the
  pinned renderer.
- Malformed, oversized, deeply nested, duplicate-key, polyglot, multi-frame, and
  decompression-bomb inputs fail under limits without a permissive fallback.

### 11.4 Logs, screenshots, and truncation

- Process output flood is bounded; the job becomes partial/failed with exact byte counts and
  truncation reason, never clean/zero-findings.
- Truncated structured formats cannot pass their domain.
- Operational log APIs reject body/header/cookie/source/credential fields.
- Every packaged image is a metadata-free trusted re-encoding with a redaction derivation
  and reviewer record. Traces/HAR/video/profile/download fixtures never ship.
- A seeded visible credential missed by automated OCR is caught by required human fixture
  review; the release procedure documents that automation alone is insufficient.

### 11.5 Package and encryption

- Missing/extra artifact, broken evidence link, placeholder, unsafe path, symlink/hardlink,
  duplicate entry, Unicode/case collision, filename traversal, entry-size lie, high
  compression ratio, trailing data, or unsupported compression blocks release.
- `manifest.json` canonicalizes deterministically; all ordinary entries have correct
  digest/length and manifest/checksum self rules are enforced.
- Tampering with each artifact class, manifest, checksums, ZIP directory, or detached digest
  fails fresh-process validation.
- Wrong age key/passphrase releases no plaintext; valid decrypt reproduces the exact ZIP
  digest on Linux ARM64/x86-64. The passphrase never appears in process inspection,
  environment, logs, SQLite, history, or artifacts.
- Crash at every package transition leaves no `RELEASED` package without the exact prior
  certificates and allows safe reconciliation/new revision.

### 11.6 Retention, deletion, and incidents

- Retention jobs respect each class, never cross run/engagement boundaries, and never
  auto-delete on low space.
- Delete attempts using path traversal, symlink, hardlink, inode replacement, wrong slug,
  missing package digest, active lease, or open VM fail without deletion.
- Two-phase trash is recoverable for 24 hours and absent after expiry; partial deletion is
  reported, including backups/provider homes deliberately retained.
- Pre- and post-release leak exercises revoke access, invalidate the exact package revision,
  create sanitized incident records, and require a new package digest.
- `ENOSPC` at each atomic-write boundary preserves existing admitted evidence/packages and
  cannot create a valid truncated object.

## 12. Blocking release gates

The product is **NO-GO** until all of these pass:

1. **Contract/provenance gate:** strict offline schemas plus semantic validators prove
   blob/occurrence separation, snapshot/fence binding, materiality, derivations,
   supersession, and truncation semantics.
2. **Seeded-secret gate:** canaries and host paths are absent from every required format,
   report, evidence object, screenshot, log, manifest field, checksum name, ZIP
   metadata/content, detached artifact, and age metadata.
3. **Rendering gate:** malicious text/HTML/Markdown/SVG/image/archive fixtures cannot become
   active in UI or shipped report; every allowed image is safely re-encoded.
4. **Package gate:** frozen staging, complete JCS manifest, SHA-256 sums, fresh reads, ZIP
   reopen, path/collision/bomb limits, reference validation, and tamper fixtures pass.
5. **Encryption gate:** pinned age recipient/passphrase tests, wrong-key failure, exact
   decrypt digest, secret-channel cleanup, and both Linux architectures pass.
6. **Review gate:** independent security and decision reviews plus technical and lay human
   reviews are enforced as state-machine blockers, including screenshot inspection.
7. **Retention/deletion gate:** per-run isolation, backup behavior, two-phase delete,
   package-digest confirmation, crash/ENOSPC recovery, and no automatic evidence deletion
   pass.
8. **Incident gate:** pre-release and delivered-package leak drills show containment,
   invalidation, sanitized audit, credential-rotation instruction, recipient warning, and
   clean replacement revision.
9. **Cross-agent gate:** Codex and Claude Code packages independently satisfy the identical
   evidence/redaction/review/package contract. Equivalent outcomes, not byte identity, are
   required.
10. **Platform gate:** the package/redaction pipeline, filesystem semantics, ZIP validation,
    and deletion controls pass the required macOS ARM64, macOS x86-64, Linux ARM64, and
    Linux x86-64 matrix. An unavailable promised platform remains a blocker unless the
    product scope is explicitly revised.

## 13. Residual risk and customer disclosure

Even after all gates pass:

- Local scanners cannot prove no secret or vulnerability exists; detectors and human
  reviewers can miss novel, encoded, visual, or contextual sensitive data.
- Provider inference and approved build/optional-service destinations remain data-egress
  channels. Destination allowlists limit where data goes, not what a compromised component
  can encode to an allowed destination.
- SHA-256 plus detached digests detect change only when the verifier receives a trusted
  digest. They do not prove who created the package. A customer requiring signature,
  non-repudiation, or formal chain of custody needs a separate key-lifecycle/signature
  profile.
- An age wrapper protects confidentiality/integrity at rest and in transit for the selected
  recipient, but cannot recall a delivered package, prevent recipient redistribution, or
  satisfy an unstated regulatory cryptography requirement.
- The trusted preview/parser/packager, host OS, Docker/Lima, filesystem, and hypervisor
  remain attack surfaces. Pinned versions, isolation, limits, and hostile fixtures reduce
  but do not eliminate implementation vulnerabilities.
- Redaction necessarily changes evidence. Derivation records and review preserve
  auditability, not access to removed content in the customer package.
- A 24-hour deletion trash window and retained backups/provider homes mean “delete
  requested” is not immediate erasure of every copy. The UI must show retained classes and
  completion state accurately.
- Customer recipients may extract ZIPs with unsafe or outdated tools. RAK produces a safe
  archive profile, but cannot control recipient tooling or storage after delivery.

These residual risks and all run-specific limitations MUST appear in
`reports/coverage-limitations` and, where decision-material, in the executive and decision
reports.

## 14. Implementation ownership and handoff

| Requirement area | Owning lane | Required handoff |
|---|---|---|
| Schemas, IDs, derivations, materiality, truncation | contracts/evidence | Golden and negative fixtures to workflow/reporting/QA |
| Atomic admission, CAS, quarantine, storage | evidence/persistence | Crash/ENOSPC/reconciliation suite |
| Secret broker and detector policy | security/backend | Canary API without secret persistence; pinned policy lock |
| Safe preview and image re-encoding | backend/UI | Parser and malicious-content fixture corpus |
| Typed report AST and static serializers | reporting | Forbidden-content validator and CSP lock |
| Package state machine, manifest, ZIP, age | packaging | Stage certificates, tamper fixtures, cross-platform tests |
| Reviews and release authorization | workflow/UI | Immutable review DTOs and approval digest display |
| Retention, trash, deletion, backups | persistence/storage | End-to-end deletion proof and retained-class report |
| Incident runbooks and customer language | security/product/docs | Pre/post-release drills and no-recall disclosure |
| Final adversarial verification | QA/security reviewer | Written go/no-go naming every failed blocker |

Any design change that weakens attachment-only rendering, per-run evidence isolation,
secret non-retention, immutable occurrences, current-fence admission, package-stage
certificates, fresh-process ZIP reopen, mandatory plain ZIP, or human review requires a new
security review before implementation.

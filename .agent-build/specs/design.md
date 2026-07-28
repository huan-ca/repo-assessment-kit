# Repository Assessment Kit — Final UX and Visual Design Specification

**Direction:** The Clear Fieldbook  
**Platform:** Local React 19.2 + Vite 8 application, Tailwind CSS 4, shadcn/ui with Radix primitives  
**Contracts:** `rak-contract/1.0.0`, `rak-workflow/1.0.0`, `rak-export-profile/1.0.0`  
**Smallest viewport:** 320 CSS px  
**Accessibility target:** WCAG 2.2 AA throughout, with AAA contrast for default reading text

## 1. Experience thesis

Repository Assessment Kit (RAK) should feel like a careful consultant's fieldbook, not a
scanner dashboard. It asks one consequential question at a time, explains why the answer
matters, makes safe defaults visible, and never turns incomplete coverage into a reassuring
score.

The experience has three modes with deliberately different density:

1. **Prepare** — define the assessment, record product knowledge and unknowns, and approve
   only the access the operator understands.
2. **Observe** — follow durable state, immutable scope, coverage, limitations, and the next
   safe action. Static work remains useful when dynamic work is blocked.
3. **Decide and release** — compare remediation, incremental replacement, and full rebuild
   on equal criteria; inspect supporting records; then release only a validated package.

The visual signature is a **trace rail**: a narrow ledger rule with numbered anchors that
connects a claim or test result to its interpretation and decision effect. It appears only
where canonical links exist. It is not a decorative causal graph.

Plain meaning always precedes machinery. A customer owner first reads who is affected, what
could happen, and what choice the evidence supports. A nearby “Show technical details”
disclosure exposes exact IDs, paths, controls, hashes, source locations, and validation
states. Limitations and uncertainty are never hidden inside that disclosure.

## 2. Design principles

### 2.1 Ask in business language; reveal technical structure on demand

Prompts say “Who relies on this product?” and “What would a replacement have to preserve?”
instead of leading with framework or schema language. Canonical values remain available
one disclosure level deeper.

### 2.2 Unknown is a valid result

Every discovery topic can be answered or explicitly marked unknown. Unknown is not styled
as an error. The interface helps the operator state a short reason and select plain-language
confidence and coverage effects rather than requiring them to invent assessment jargon.

### 2.3 Safe defaults are visible defaults

The default source mode is commit-only; optional hosted services are off; target runtime
egress is denied; runtime-blocked work continues static-first; the validated plain ZIP is
always retained. Anything that includes local changes, sends data to an optional service,
supplies a credential, executes target code, or deletes data requires a separate,
affirmative decision.

### 2.4 Scope, state, and coverage come before activity

The run workspace leads with what is being assessed, the canonical run state, and what can
or cannot be checked. Operational events are secondary. The UI never presents a model's
prose or a process exit as completion.

### 2.5 Separate evidence strength from severity

Technical severity, business priority, confidence, and validation state are four distinct
fields. They never collapse into a score, colored dot, or heat map.

### 2.6 Consent is a durable record, not a checkbox

An approval names its capability, destination, methods, data categories, recipients,
credential handle, disclosure version, approver role, and expiry. Optional approvals are
never preselected and there is no “approve all.”

### 2.7 Errors preserve agency

Every failure says what happened, what was preserved or left unchanged, what the operator
can safely do, and what coverage is affected. Pause, cancel, retry, revision, deletion, and
restore are different actions with different language.

## 3. Architecture conformance

This section is normative for the frontend. The generated OpenAPI client and public
Server-Sent Events (SSE) are the only runtime data sources. The UI must not query SQLite,
read generated files directly, infer hidden phase attempts, parse provider output, or add
fields to a frozen response.

### 3.1 View classes

Every designed view is one of these:

- **Server-backed:** fully rebuildable after reload from a frozen GET operation.
- **Response-derived:** composed from the response to a mutation plus current in-memory
  form state. It is valid for the current browser session but not reconstructible after
  reload unless the same data is also exposed by a GET.
- **Event-derived:** a bounded, session-local activity list built from public SSE events.
  It is not a durable event-history view.
- **Generated artifact:** content produced by the reporting engine and delivered inside
  the validated ZIP, not rendered in the authenticated web origin.
- **Contract-blocked:** a valuable experience that cannot be implemented from the frozen
  operations. It is named as a delivery constraint; the frontend must not fabricate it.

### 3.2 Legal lifecycle and primary setup sequence

The setup order is fixed:

```text
Launcher authentication/readiness
  → local pre-draft source/profile choices
  → createRun
  → DRAFT
      → putDiscovery
      → putApprovals
      → createSecret/uploadSecret when required
      → response-derived setup review
      → resolveTarget
  → RESOLVING_TARGET
  → READY
      → resolved-scope confirmation from exposed RunDocument fields
      → startRun
  → EXECUTING
```

`putDiscovery` and `putApprovals` occur only in `DRAFT`. “Prepare safe copy” never precedes
them. After `resolveTarget`, setup inputs cannot be edited in place. A change to target,
discovery, profile, or policy uses `createRevision`; it never reopens the resolved run.

The frontend creates the durable run only after project, engagement, current launcher
provider, source, profiles, and optional service IDs are complete enough for `createRun`.
Before that click, fields are local component state and are intentionally lost on reload;
they are not stored in local storage. After `createRun`, the server run state is durable.
However, the frozen API does not provide GET operations for saved discovery claims or
approval records, so the editable DRAFT form cannot be reconstructed after reload. The
contract-safe UI must say:

> This draft's saved setup details cannot be reopened in this version of the local
> interface. Start a new draft to review or change them. The existing draft remains listed
> and can be stopped when the workflow allows.

Durable DRAFT resumption is a contract blocker, not a frontend caching problem.

### 3.3 Provider authority

`getSystem.launcherProvider` is authoritative. The current provider is displayed as
“Running with Codex” or “Running with Claude Code” and is copied into `createRun.provider`.
The alternate provider is not an enabled radio choice. A comparison run with the other
provider requires leaving the web app and starting the corresponding launcher. This avoids
promising a provider process the current server cannot run.

### 3.4 Screen-to-operation matrix

| View | Read source | Mutations | Class and limits |
|---|---|---|---|
| Session entry | none after bootstrap | `bootstrapSession`, `deleteSession` | Server-backed session result |
| System readiness | `getSystem` | none | Server-backed; only fields in `prerequisites` |
| Runs | `listRuns(state?, cursor?, limit?)` | none | Server-backed; no global search or invented sort |
| Pre-draft setup | `getSystem`, `listSourceHandles` | `createRun` | Local until create; no persistence promise |
| DRAFT discovery | mutation responses only | `putDiscovery` | Response-derived; no reloadable claim GET |
| DRAFT consent | `getRun.currentCapabilities`, `getCapabilities` | `putApprovals` | Response-derived approval ledger; capabilities reloadable, approvals are not |
| DRAFT credentials | response from `createSecret` | `createSecret`, `uploadSecret`, `revokeSecret` | Handle status from response; no secret value retained |
| DRAFT review | create/discovery/approval/secret responses | `resolveTarget` | Response-derived, current session only |
| Target resolution | `getRun` + SSE | none | Shows state and eventual `targetSnapshotId`; no commit/detail invention |
| Run overview | `getRun` | legal run actions | Server-backed |
| Live activity | `streamEvents` | none | Event-derived; no pagination/history claim |
| Runtime capability | `getCapabilities`, `getRun` | `rerunRuntimeGate` | Server-backed current result |
| Coverage | `listCoverage`, `listControls` | none | Server-backed; limitation IDs have no detail operation |
| Findings | `listFindings` | none | Server-backed cursor list; filters only severity, validation, domain |
| Finding detail | `getFinding` | none | Server-backed joined evidence, controls, reviews |
| Evidence | `listEvidence` | none | Server-backed cursor list; filters only type, sensitivity, validation |
| Evidence detail | `getEvidence` | `previewEvidence`, `downloadEvidence` | Server-backed occurrence fields only |
| Decision | `getDecision` | none | Server-backed |
| Release gates | `getRun.phases` | none | Server-backed phase state only; no review history |
| Human review submission | no operation exposes required `inputDigest` | `createReview` exists | Contract-blocked for general web use; do not invent digest |
| Package | `listPackages`, `getRun` | `createPackage`, downloads | Five exposed states only; no nine-stage internal ledger |
| Deletion | `getDeletionJob` | request/restore operations | Server-backed |
| Customer reports | validated ZIP | none in UI | Generated artifacts, never inline in authenticated UI |

### 3.5 Explicit contract limits

The frontend must not promise:

- full commit SHA, sanitized locator, dirty paths, source integrity digests, submodule/LFS
  treatment, or manifest/archive data after reload; only `targetSnapshotId` is exposed;
- durable or paginated event history; SSE may replay but a `410` requires canonical
  refetch and loss of the activity list;
- approval mutation or revocation after `DRAFT`; `revokeSecret` revokes a secret, not its
  approval;
- review lists, review drafts, report previews, report descriptors, correction objects,
  recovery-plan selection, retry-attempt selection, or validation-issue lists;
- limitation explanations where only limitation IDs are returned;
- package certificates or the nine internal packaging stages; `PackageView` exposes only
  `REQUESTED`, `STAGING`, `VALIDATING`, `VALIDATED`, and `FAILED`;
- run search, finding search, evidence search, business-priority filtering, multi-value
  filters, client-defined global sort, or complete result counts.

These omissions should be resolved by a future architecture revision if the corresponding
experiences become mandatory. They are not authorization for frontend-only joins or
unbounded page fetching.

## 4. Information architecture

### 4.1 Product navigation

1. **Assessments** — all exposed runs and “Start assessment.”
2. **System readiness** — current launcher, host, profiles, and prerequisites.
3. **Data and retention** — entered from each terminal run because no global retention
   list operation exists.
4. **Help** — status definitions, evidence labels, provider data flow, keyboard help, and
   package verification.

There is no global findings dashboard, cross-run analytics, notification center, cloud
account UI, or global search in MVP.

### 4.2 Run navigation

1. Overview
2. Product context — during the current DRAFT setup session only
3. Access and consent — during the current DRAFT setup session; capability status remains
   visible later
4. Coverage
5. Findings
6. Evidence
7. Decision
8. Reviews and release

The run header shows only reloadable identity: project slug, revision, provider, human
state, and shortened `targetSnapshotId` when present. It must not label the snapshot ID as
the commit SHA. Full IDs live in a copyable technical disclosure.

### 4.3 User-facing state language

| Canonical state | Default label |
|---|---|
| `DRAFT` | Setup in progress |
| `RESOLVING_TARGET` | Preparing a safe copy |
| `READY` | Ready to begin |
| `EXECUTING` | Assessment in progress |
| `WAITING_INPUT` | Input is needed |
| `PAUSING` | Pausing safely |
| `PAUSED` | Paused |
| `RECOVERABLE_FAILURE` | Action is needed to continue |
| `VALIDATING` | Checking assessment records |
| `REVIEW_REQUIRED` | Review is required |
| `PACKAGING` | Preparing the customer package |
| `COMPLETED` | Complete |
| `CANCELLING` | Stopping and cleaning up |
| `CANCELLED` | Stopped |
| `FAILED` | Could not complete |

Canonical strings appear in technical details only.

## 5. End-to-end flows

### 5.1 First launch and provider authentication

Authentication begins in the launcher, before the local web experience:

```text
start-codex.sh status OR start-cc.sh status
  → authenticated: run
  → not authenticated/expired:
      → login through the matching launcher
      → environment credential alternative when documented and approved
      → status again
  → run
  → one-time loopback link
  → session bootstrap
  → System readiness
```

The web app uses `getSystem` to display the current provider and prerequisite capability
results. If provider authentication is represented as unavailable, failed, missing, or
expired in those results, show:

- “Codex sign-in is needed” or “Claude Code sign-in is needed”;
- the matching launcher verb, not a web credential field;
- “Close this page, run `[launcher] login`, then start the kit again”;
- the reason from `CapabilityResult`;
- that provider homes remain separate by engagement.

The UI never asks for provider credentials. Wrong-launcher requests explain that provider
choice is made by the launcher.

### 5.2 Prepare: create and complete a DRAFT

#### Step 1 — Project and provider

Show project slug, engagement ID, and the fixed launcher provider. Explain:

> The selected provider may receive repository context for inference. This kit is local
> first, but provider processing is not the same as source staying on this computer.

The alternate provider appears as plain help text with its relaunch instruction.

#### Step 2 — Source

Choose SSH Git or registered local source handle.

- SSH: registered SSH handle, URL, optional ref.
- Local: source handle, relative path, commit-only or frozen-working-tree mode.
- Commit-only is selected by default.
- Frozen-working-tree explains that changed and untracked files will be included in a
  deterministic copy and requires a dedicated approval later.

Only handles from `listSourceHandles` appear. The UI does not accept arbitrary host paths.

#### Step 3 — Profiles and optional services

Select supported profiles and optional service IDs before creation because both are part of
`createRun`. The general baseline is always described as technical coverage, not
certification. Optional hosted services default off.

#### Step 4 — Create draft

The review card summarizes the exact `createRun` body in plain language. “Create setup
draft” calls `createRun` with an idempotency key. Failure preserves local fields. Success
enters `DRAFT`, stores the returned ETag/row version, and begins server-backed mutations.

#### Step 5 — Product context

Collect exactly one current `ProductClaim` per required topic:

1. target customers;
2. buyers;
3. user roles;
4. customer pain;
5. valuable workflows;
6. alternatives and differentiators;
7. revenue- or retention-critical behavior;
8. contractual obligations;
9. expected scale;
10. feature-parity expectations.

Save all claims together with `putDiscovery` and `If-Match`.

#### Step 6 — Access, consent, and safe credentials

Use `getCapabilities`/`getRun.currentCapabilities` to list only capabilities the engine
exposes. An approval composer records the architecture `Approval` fields exactly.

Group decisions:

- provider inference already selected through the launcher, explained rather than
  represented as an optional hosted-service approval;
- source acquisition;
- inclusion of frozen working-tree changes;
- target-code execution, if exposed as a capability;
- build/dependency acquisition egress;
- target-runtime endpoint exceptions;
- optional hosted scanner/services.

Target-code execution is a separate decision from network access. Its card states:

- an unknown repository may be hostile;
- execution occurs in a disposable VM behind the runtime broker;
- no host Docker socket, provider credential, host mount, or output path is given to the
  target;
- hypervisor/kernel escape and approved-channel exfiltration remain residual risks;
- denial leaves dynamic controls blocked while static assessment remains valid.

No approval is editable after leaving `DRAFT`. If access must change later, the UI offers
“Create a revised assessment,” not an illegal in-run approval control.

Secrets use `createSecret`, the returned upload path, and `uploadSecret`. The browser never
stores or re-renders the value. It retains only the response-derived handle, purpose,
recipient, expiry, uploaded state, and remaining uses. “Revoke secret” uses
`revokeSecret` and does not claim to revoke the associated approval.

#### Step 7 — Review editable setup

The response-derived review contains:

- project, provider, source kind and source choices;
- all ten discovery topics and provenance;
- unknowns and their effects;
- profiles;
- each approved and denied capability;
- optional destinations, data categories, recipients, methods, and expiry;
- target-code-execution decision;
- secret handles by purpose only;
- expected blocked/reduced coverage;
- output location convention.

Each “Change” link is legal only while state remains `DRAFT`. The final authorization
attestation is separate from optional consent:

> I am authorized to assess this repository and supplied only credentials and endpoints
> approved for this sandbox.

“Prepare safe copy” then calls `resolveTarget`.

### 5.3 Prepare: target resolution and READY

While `RESOLVING_TARGET`, show the current run state and event-derived public summaries.
Do not invent substeps from internal commands.

When `READY`, show:

- “The assessment source is prepared and locked for this run.”
- project, revision, provider, and `targetSnapshotId`;
- “The public interface does not expose the commit and source-manifest details here. They
  are validated by the engine and included in generated assessment data.”
- current capability/coverage effects from `getRun`;
- “Begin assessment” using `startRun`;
- “Create a revised assessment” using `createRevision` if the operator needs to change
  setup rather than begin.

Target resolution failure shows `ErrorEnvelope.message`, `operatorAction`, retryable state,
and coverage effects. Retry only when the architecture exposes a legal operation; never
offer a generic retry that repeats `resolveTarget` in an illegal state.

### 5.4 Observe: run progress and static-first continuation

The Overview order is:

1. run scope strip;
2. state heading and one-sentence meaning;
3. action-needed notice;
4. state/scope/coverage summary;
5. 14-phase ordered rail from `getRun.phases`;
6. current capabilities;
7. bounded live activity from SSE;
8. pause/cancel/revision actions when legal.

There is no percent-complete estimate. Say “Phase 4 of 14: Static security and quality
checks” only when the phase array supports that position and state. Parallel work remains
inside its phase and is not invented from unseen jobs.

If dynamic runtime is blocked, the primary message is:

> Browser and live-runtime checks could not run safely. Static assessment continues.

The workflow resolves every planned dynamic control to a coverage state. The interface
does not require an approval mutation or “continue” button after execution has started.
If the engine enters `WAITING_INPUT` but the required action has no frozen mutation, show
the blocker, preserve-state message, and “Create a revised assessment.” Do not fabricate an
input form.

Pause uses `pauseRun` with a plain reason. The dialog says new work stops, some active work
may checkpoint or stop, and admitted evidence remains. Resume is offered only when the UI
has architecture-supplied `recoveryPlanId` and `retryAttemptIds`; the frozen GET contract
does not currently supply them, so general web resume selection is contract-blocked.
Cancel uses `cancelRun`, explains revocation/cleanup, and never implies deletion.

### 5.5 Runtime capability

The runtime view is backed by `getCapabilities` and shows, for each relevant capability:

- task in plain language;
- support, attestation, approval, and effective result;
- reason;
- exposed evidence occurrence IDs;
- coverage effects;
- checked time.

The summary distinguishes:

- unsupported by this release;
- prerequisite attestation failed/missing/expired;
- not approved in DRAFT;
- denied by the operator;
- blocked by policy;
- available.

Network policy copy says runtime starts offline. Exact endpoint exceptions are described
only from the recorded DRAFT response in the current session; after reload the UI shows
approval state, not destinations the API does not return.

Before validation, “Rerun safe runtime check” calls `rerunRuntimeGate`. A rerun does not
change approval scope and retains the prior result as superseded engine data.

### 5.6 Coverage and limitations

Lead with a sentence, not a chart:

> All 15 required assessment areas are accounted for. 9 passed, 2 partly tested, 3 were
> blocked, and 1 was not applicable.

Use only counts returned by `DomainCoverage`. Do not imply repository safety.

The domain ledger uses the fixed architecture order. Each row shows:

- area name;
- exact six-state status;
- reconciled/planned controls;
- exclusions;
- unsupported ecosystems;
- number or IDs of limitations;
- evidence occurrence IDs.

`listControls` supports status and profile filters and cursor pagination. A control row
shows title, profile/control ID, current result, reason, technique IDs, evidence IDs, and
limitation ID where exposed. There is no limitation-detail drawer because no such GET
exists.

Status definitions:

- **Pass —** the check completed and met its stated condition.
- **Fail —** the check completed and did not meet its stated condition.
- **Partly tested —** only a named subset was exercised.
- **Blocked —** a safety boundary, prerequisite, or authorization prevented the check.
- **Not applicable —** the subject was confirmed absent.
- **Not tested —** applicable work was omitted, not selected, or exhausted its safe
  budget.

### 5.7 Findings and trace rail

`listFindings` supports one technical severity, validation state, and domain filter at a
time, plus cursor and limit. The UI offers only those filters. It does not offer search,
business-priority filtering, multi-select within one field, result totals, or a selectable
sort. “Next page” uses the returned opaque cursor; filters reset pagination and focus the
list heading.

Each row/card shows:

- title;
- business priority;
- technical severity;
- confidence;
- validation state;
- first source location when present.

Finding detail uses `getFinding`, which legitimately provides joined evidence, controls,
and reviews. Content order:

1. business consequence and affected party;
2. next action/remediation theme;
3. business priority, technical severity, confidence, validation;
4. description;
5. trace rail of returned evidence;
6. repository-relative locations;
7. control and framework mappings;
8. returned review outcomes;
9. technical identifiers and CVSS records.

A disputed or invalidated finding retains the original description and begins with the
review outcome. Evidence links open the evidence route only for IDs returned by the joined
response.

### 5.8 Evidence

`listEvidence` supports type, sensitivity, validation state, cursor, and limit. There is no
search or total. Each list row shows only exposed occurrence fields.

Evidence detail from `getEvidence` includes:

- title and evidence type;
- snapshot ID and activity ID as identifiers, not expanded objects;
- capture time;
- source/package/external locator when present;
- sensitivity, redaction, and validation;
- collection limitations;
- derived-from and linked claim/finding/control IDs;
- supersession ID;
- preview/download availability.

The UI does not invent tool/agent names, blob metadata, redaction transformations, review
history, claim statements, or control titles that this response does not contain.

“Safe preview” uses `previewEvidence` and accepts only:

- escaped UTF-8 text returned as `text/plain`; or
- trusted re-encoded PNG/JPEG with returned dimensions.

It never renders Markdown, HTML, SVG, XML, PDF, archives, scanner HTML, or unknown media
inline. Truncation is announced before the text. Attachment download uses
`downloadEvidence` and is never opened in the privileged origin.

### 5.9 Decide

`getDecision` supports a complete, reloadable comparison.

Order:

1. current recommendation or conditional sequence;
2. confidence and rationale;
3. seven criterion sections;
4. equal-depth remediation, incremental replacement, and full rebuild panels;
5. assumptions;
6. dependencies;
7. reversal conditions.

Each option cell shows assessment, evidence state (`evidenced`, `unverified`,
`conflicting`), confidence, claim IDs, and evidence IDs exactly as returned. The
recommended option uses the words “Recommended from current evidence” plus a thicker
outline. Alternatives are not dimmed. A conditional sequence is shown as ordered steps.

### 5.10 Reviews and correction

The web route is a **release-gate view**, not an invented review workspace. It uses
`getRun.phases` to show the states of:

- independent security review;
- independent decision review;
- deterministic validation;
- technical human review;
- lay human review;
- package.

No review history, objections, item results, accepted corrections, report preview, or
review evidence is shown because there is no list/get operation.

Although `createReview` exists, its required `inputDigest` is not exposed by a read
operation. The general web app must not calculate or request that value from the operator.
Until the architecture provides a review assignment/read model, submission is performed
only by an architecture-owned process that already holds the correct digest. The route
says:

> Review completion is recorded by the assessment workflow. This local interface can show
> the gate state but cannot author or reopen review records in this contract version.

If a human review fails and correction is required, the architecture-valid handoff is:

1. preserve the original run, review, evidence, and objections;
2. use `createRevision` with a reason and `copyDiscovery:true`;
3. receive a new `DRAFT` linked by `parentRunId`;
4. re-confirm approvals because approval records are run-scoped;
5. re-run the new assessment against its frozen inputs;
6. let independent, deterministic, and human review phases produce new records;
7. package only the new revision after its gates pass.

The UI does not edit findings, decisions, or evidence in `REVIEW_REQUIRED`, does not mark a
review stale itself, and does not transition `REVIEW_REQUIRED -> EXECUTING` without an
exposed operation.

### 5.11 Package

Use `getRun`, `listPackages`, `createPackage`, `downloadPackage`, and
`downloadPackageDigest`.

Pre-package content:

- release-gate phase states;
- plain ZIP is always retained;
- optional age X25519 wrapper described as “encrypt a copy for a recipient public key”;
- scrypt described as launcher-only because the web channel cannot accept the passphrase.

The list shows only exposed package states:

- Requested;
- Preparing files;
- Checking package;
- Validated and ready;
- Failed.

Do not display internal nine-stage certificates. When validated, show byte length, ZIP
SHA-256 digest (“a file fingerprint used to detect changes”), optional encrypted wrapper
metadata, Download ZIP, and Download digest. The UI never previews customer report HTML.
The reports are read after downloading and opening the validated package.

Failure shows the package state, exposed `validationReportId`, and a retry only when
`createPackage` is legal. It does not infer the failed internal stage.

### 5.12 Delete and restore

Terminal assessment actions use the frozen deletion operations.

The form:

1. chooses `internal-only`, `run-except-packages`, or `entire-run`;
2. explains what remains and what is removed;
3. requires exact project slug;
4. requires exposed package digest confirmations when packages are included;
5. submits `requestRunDeletion`.

The deletion view uses `getDeletionJob` and shows its canonical state, removed classes,
trash time, purge time, and recovery possibility. “Restore” is offered only in `TRASHED`
before purge and uses `restoreRunDeletion`. Cancel is never described as delete.

## 6. Discovery and consent data design

### 6.1 ProductClaim mapping

The `DiscoveryPrompt` supports all seven provenance values:

| UI label | Canonical value | Required conditional fields |
|---|---|---|
| Told to us by an owner | `owner-stated` | speaker role and capture time |
| Written in product or customer material | `documented` | evidence occurrence IDs when available |
| Seen during this assessment | `observed` | evidence occurrence IDs |
| Supported by analytics | `analytics-supported` | dataset, query, window start/end, evidence IDs |
| Inferred from the code | `code-inferred` | inference reasoning and evidence IDs |
| Not yet verified | `unverified` | confidence and supporting IDs if any |
| Sources disagree | `conflicting` | at least two conflicting claim/evidence references |

Exactly one of `statement` and `unknown` is present.

- `owner-stated` defaults `capturedAt` to the current UTC time but displays it for review.
- `analytics-supported` uses explicit date/time controls and never accepts “recent.”
- `code-inferred` is not offered as a substitute for owner/context facts during initial
  discovery unless supporting evidence IDs already exist.
- `conflicting` cannot save until two referenced claims/evidence records exist. In initial
  DRAFT setup, where such IDs may not exist, record the current claim as `unverified` with
  a statement that sources disagree; do not fabricate conflict IDs.
- Every mutation includes `claimId`, `runId`, revision, confidence, arrays (including empty
  arrays), and `supersedesClaimId` only when architecture-owned IDs exist.

### 6.2 Unknown path

“I do not know yet” reveals:

- short reason;
- confidence effect, selected from topic-specific plain-language suggestions and editable;
- coverage effect, selected from topic-specific suggestions and editable;
- follow-up owner/action.

Suggested effects are visible draft text, never silently generated canonical truth. The
operator confirms them before save.

### 6.3 Approval card

Every approval card keeps decision-critical content visible without an accordion:

1. task and capability;
2. exact destination(s);
3. allowed methods;
4. data categories;
5. recipient services;
6. credential handle purpose, never value;
7. expiry;
8. what approval enables;
9. what denial changes;
10. Approve / Do not approve radio.

There is no default approval and no “approve all.” “Deny all optional access” is allowed
because it narrows exposure. Technical capability/evidence IDs sit in a disclosure.

## 7. Screen inventory and state requirements

| Screen | Purpose | Primary entry | Primary exit |
|---|---|---|---|
| Session entry | Establish local cookie session | launcher link | readiness/runs |
| System readiness | Explain current provider and prerequisites | first launch/nav | runs |
| Assessments | Resume or inspect runs | product home | new setup/run |
| New setup | Collect createRun inputs | Start assessment | DRAFT |
| Product context | Create ten claims | DRAFT stepper | consent |
| Consent and secrets | Record scoped approvals/handles | DRAFT stepper | setup review |
| Setup review | Confirm editable setup | DRAFT stepper | resolve target |
| Target preparation | Show resolution state | resolve accepted | READY/failure |
| Ready summary | Confirm exposed immutable ID | target success | start/revision |
| Overview | State/scope/coverage-first monitoring | run | detail/action |
| Runtime capability | Explain safe dynamic availability | overview | rerun/overview |
| Coverage | Honest domain/control accounting | run nav | control/evidence |
| Findings | Cursor-bounded concern list | run nav | finding |
| Finding detail | Consequence and joined proof | findings | evidence |
| Evidence | Cursor-bounded occurrence list | run nav | evidence detail |
| Evidence detail | Safe metadata/preview/download | evidence/finding | linked finding |
| Decision | Equal-criteria comparison | run nav | evidence |
| Reviews and release | Show exposed gate states | run nav | revision/package |
| Package | Build/download validated release | review required | download |
| Deletion | Recoverable local cleanup | terminal run | restore/purge |

### 7.1 Universal route states

Every route defines:

- **Loading:** stable `h1`, one loading sentence, `aria-busy`, geometry skeleton hidden
  from assistive technology.
- **Incremental refresh:** keep content; label “Updating”; never blank the page.
- **Empty:** distinguish not created yet, no filter match, and completed zero result.
- **Error:** human cause, preserved state, retry only when legal, request ID/details,
  coverage effects.
- **Stale row:** refetch; explain another tab changed the run; preserve safe form text;
  require review before resubmit.
- **Disconnected SSE:** “Live updates are reconnecting. The local assessment continues.”
- **Expired replay:** clear event-derived activity, refetch canonical resources, and say
  earlier activity is not available in this view.
- **Disabled:** readable adjacent reason; no tooltip-only explanation or parent opacity.
- **Terminal:** content remains readable; legal next actions are revision, package
  download, or deletion.

## 8. Component system

Use shadcn composition and Radix primitives where their semantics fit. Preserve native
keyboard behavior.

### 8.1 App shell

- Header: text wordmark, “Local workspace,” provider badge, readiness, Help.
- Run navigation: 256px rail at desktop; dialog trigger below 768px.
- Main: route `h1` receives focus after navigation.
- Footer: product version and loopback statement.

### 8.2 Scope strip

Definition list containing project, revision, provider, state, and snapshot ID when
available. It never labels unavailable data. Copy buttons name the field.

### 8.3 Phase rail

Semantic ordered list of the 14 returned phases. Each item has phase number, plain name,
state word, required/conditional label, and limitation count/IDs where exposed.
`aria-current="step"` marks current. No fabricated percent.

### 8.4 Trace rail

Semantic ordered list with a 2px neutral vertical rule. A node contains number, type,
title, evidence/claim IDs, state, and link. Nodes are rendered only from canonical links in
the current response.

### 8.5 Status marker

Visible icon/shape + full word:

- check/circle — Pass or Complete;
- ×/octagon — Fail;
- half circle — Partly tested;
- bar/octagon — Blocked;
- outlined diamond — Not applicable;
- open circle — Not tested;
- static three dots/circle — In progress;
- exclamation/triangle — Input needed.

Icons are decorative beside text.

### 8.6 Notice and action-needed panel

Variants: information, success, caution, error, action needed. Every notice has a heading,
icon/shape, border treatment, body, and persistent action. `role="alert"` is reserved for
new blocking failures.

### 8.7 Plain/technical disclosure

Radix Collapsible with “Show technical details” / “Hide technical details” and
`aria-expanded`. Limitations and safety effects never live only inside it.

### 8.8 Data table and cursor pager

Semantic table with caption, scoped headers, and only server-supported filters. Cursor
pager uses “Previous” only when the client has retained the prior cursor stack in session
and “Next page” when `nextCursor` exists. It never says “page N of M” or shows a result
total. Below the designated container width, switch to labeled cards.

### 8.9 Form controls

- visible label and instructions;
- 44px minimum target; primary controls 48px;
- hint before error in DOM;
- error linked with `aria-describedby`;
- error summary focused after failed submit;
- no placeholder-only labels;
- radios/checkboxes have 44px clickable rows;
- textarea resizes vertically;
- save status says Saving, Saved, or Could not save.

### 8.10 Dialog

Visible title/description, focus trap, Escape close when safe, focus return, and
action-specific labels. Destructive action is separated and never receives default focus.

### 8.11 Safe preview

Bordered region labeled “Safe preview.” Escaped text uses `textContent`; returned image
uses trusted PNG/JPEG only. Preview loading, unavailable, truncated, error, and
attachment-only states are explicit.

### 8.12 Copy control

Text button, not icon-only. Polite feedback names the value: “Package fingerprint copied.”
Copy failure leaves selectable text visible.

## 9. Visual language

### 9.1 Character

Warm paper canvas, white reading sheets, deep evergreen actions, strong charcoal text,
precise gray-green ledger rules, and restrained semantic tints. No gradients, glass,
glows, animated charts, giant score numerals, or dark security-operations styling.

### 9.2 Color tokens

| Token / shadcn mapping | Hex | Use | Contrast |
|---|---:|---|---:|
| `--background` | `#F7F7F5` | canvas | — |
| `--card`, `--popover` | `#FFFFFF` | reading surface | — |
| `--foreground` | `#17201B` | main text | 15.55:1 on canvas |
| `--muted` | `#EEF1EF` | quiet wells | — |
| `--muted-foreground` | `#4B5750` | secondary text | 7.56:1 on white |
| `--border`, `--input` | `#CCD4CF` | rules/input border | structural |
| `--primary` | `#124E3A` | primary action | 9.65:1 with white |
| `--primary-foreground` | `#FFFFFF` | primary text | 9.65:1 |
| `--accent` | `#E4EFEA` | selected surface | >12:1 with ink |
| `--ring`, `link` | `#005FCC` | focus and links | 5.98:1 on white |
| `positive-ink` | `#176B45` | positive text/icon | 6.51:1 on white |
| `positive-bg` | `#E8F5ED` | positive notice | ink >14:1 |
| `caution-ink` | `#7A5100` | caution text/icon | 6.36:1 on caution bg |
| `caution-bg` | `#FFF4D1` | caution notice | ink 15.18:1 |
| `danger-ink` | `#A52929` | error/destructive | 6.15:1 on danger bg |
| `danger-bg` | `#FDEAEA` | error notice | ink 14.40:1 |
| `info-ink` | `#1B5C73` | information | 6.75:1 on info bg |
| `info-bg` | `#EAF6FA` | information notice | ink 15.14:1 |

Do not apply opacity to disabled component trees. Disabled text remains
`--muted-foreground` on white, border remains `--border`, and the adjacent reason uses
normal text contrast.

Forced colors use system colors, visible borders, underlines, and native focus. Dark mode
is outside MVP.

### 9.3 Spacing, shape, and elevation

4px base system: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px.

- page gutter: `clamp(16px, 3vw, 40px)`;
- field/card padding: 16px mobile, 24px desktop;
- section gap: 40px; major report gap: 64px;
- radius: 4px chips/code, 8px inputs/buttons/notices, 12px dialogs/sheets;
- standard border: 1px; selected/current ledger rule: 2px;
- sheet shadow: `0 1px 2px rgb(23 32 27 / 0.08)`;
- dialog shadow: `0 18px 48px rgb(23 32 27 / 0.18)`.

Pills are reserved for removable filters. Elevation never communicates state alone.

### 9.4 Motion

100ms fast, 160ms standard, 220ms disclosure/dialog;
`cubic-bezier(0.2, 0, 0, 1)`. Animate opacity and at most 4px translation. No pulsing,
count-up, auto-scroll, parallax, or spinner-only progress. Reduced motion makes transitions
effectively immediate.

## 10. Typography

Use local system fonts only:

```css
--font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", sans-serif;
--font-mono: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
```

| Token | Size / line height | Weight |
|---|---|---:|
| `type-caption` | 14px / 20px | 500 |
| `type-small` | 16px / 24px | 400 |
| `type-body` | `clamp(17px, 16.5px + .15vw, 18px)` / 1.56 | 400 |
| `type-body-strong` | same / 1.56 | 650 |
| `type-label` | 16px / 22px | 650 |
| `type-h4` | 20px / 28px | 650 |
| `type-h3` | `clamp(22px, 20px + .5vw, 26px)` / 1.28 | 650 |
| `type-h2` | `clamp(26px, 23px + .9vw, 34px)` / 1.2 | 700 |
| `type-h1` | `clamp(30px, 25px + 1.5vw, 42px)` / 1.14 | 720 |
| `type-display` | `clamp(34px, 28px + 2vw, 48px)` / 1.1 | 720 |
| `type-code` | 15px / 22px | 400 |

Narrative measure is 58–66ch; executive reports 52–62ch; technical prose up to 75ch.
Paragraph margin is 1em. Report H2/H3/H4 top margins are 2.25/1.75/1.4em. Body never falls
below 16px. Avoid all caps.

## 11. Responsive behavior

### 11.1 Breakpoints

- base: 320–479px;
- `xs`: 480px;
- `sm`: 640px;
- `md`: 768px;
- `lg`: 1024px;
- `xl`: 1280px.

Use container queries at 36rem and 56rem for data modules. Test 320, 360, 390, 768, 1024,
1280, and 1440px; 200% zoom at 1280px; and a 320 CSS px equivalent reflow viewport. No
primary route may cause page-level horizontal overflow.

### 11.2 Shell and route reflow

- Below 768px, run navigation becomes a dialog trigger; header may wrap; gutters are 16px.
- From 768px, use a 224px rail; from 1024px, 256px.
- Forms remain one readable column, maximum 42rem, even on desktop.
- Consent cards remain one column at every width.
- Phase and trace rails remain vertical; their rule moves to a 12px inset at 320px.
- Run/finding/evidence tables become labeled cards below their specified 640px container.
- Decision options stack below 56rem and become three equal columns at or above 56rem.
- Definition lists use labels above values below 640px and a 12rem label column above.
- Dialog width is `min(calc(100vw - 32px), 40rem)`; destructive dialogs may reach 48rem.
- Package actions stack at 320px and wrap above.

Long paths and IDs use `overflow-wrap:anywhere`. Buttons can grow to multiple lines.
Critical status, reason, project name, or action text is never truncated.

## 12. Accessibility requirements

### 12.1 Structure and navigation

- One `h1` per route; no skipped heading levels.
- Header, primary nav, run nav, main, and footer landmarks.
- “Skip to main content”; long run views also offer “Skip to current phase” or “Skip to
  recommendation.”
- Route navigation focuses the `h1`; SSE updates never move focus.
- Breadcrumbs are labeled navigation lists; current nav uses `aria-current`.

### 12.2 Keyboard and focus

- Every function works without a pointer.
- Focus order follows DOM/reading order.
- Focus ring: 3px `--ring` with 2px offset; primary buttons add a white inner boundary.
- Radix interactions retain standard keys.
- Dialog close restores focus.
- Sticky regions respect `scroll-margin-top`.
- No drag-only, hover-only, long-press, or double-click action.

### 12.3 Screen reader and live updates

- Phase and trace rails are ordered lists.
- Tables have captions and scoped headers.
- Status accessible names include category and value.
- Routine updates use one polite region; new blocking action uses one assertive region.
- Do not announce every SSE event, heartbeat, timestamp, or spinner.
- A disconnected stream announces once; reconnection announces once.
- Copy feedback names the copied value.

### 12.4 Forms and consent

- Native controls wherever possible.
- Visible labels and instructions before controls.
- Error summary receives focus after submit and links to fields.
- Form values remain after validation/stale errors.
- Approval is never preselected.
- Existing response-derived approval shows decision, scope, approver, and expiry.
- Target-code execution is separately confirmed.
- Minimum target is 44×44 CSS px; primary controls 48px.

### 12.5 Color, zoom, and motion

- No meaning depends on color.
- Text contrast at least 4.5:1; large text 3:1; boundaries/focus 3:1; defaults exceed these.
- Support browser text-spacing overrides without clipping.
- Support forced-colors and 400% zoom/reflow.
- Respect reduced motion.
- Any future chart requires an adjacent equivalent table/list.

### 12.6 Safe content

- Never use `dangerouslySetInnerHTML` for target/model/scanner content.
- Render returned safe text with `textContent`.
- Only returned re-encoded PNG/JPEG may preview inline.
- Evidence attachments download with server headers.
- Customer report HTML is never embedded in the authenticated origin.

### 12.7 Verification

QA must complete:

1. new setup through `READY` at 320px, keyboard-only, and screen reader;
2. all seven claim provenance paths and unknown path;
3. each approval decision with no preselected approval;
4. all six coverage states in grayscale and forced colors;
5. SSE disconnect/replay expiry without focus loss or announcement flood;
6. cursor paging and filter reset with correct focus;
7. finding-to-evidence trace using only returned links;
8. safe preview loading, truncated, unavailable, attachment-only, and failure states;
9. decision comparison at 320px and 200% label expansion;
10. package download/digest and recoverable deletion/restore;
11. report headings, landmarks, TOC, tables, links, print, and screen-reader order on
    Linux/NVDA or Orca where available and macOS/VoiceOver.

## 13. Content and voice

Voice is calm, exact, candid, and non-patronizing.

Write:

- “Browser checks could not run safely. Static assessment continues.”
- “This lowers confidence in login and session behavior.”
- “Current evidence supports incremental replacement, with medium confidence.”
- “This finding is disputed by the independent review.”

Avoid:

- “Runtime gate failure.”
- “Security score: 82.”
- “This repository is safe.”
- “Compliant with ASVS.”
- “Simply approve access.”
- “AI verified.”

Preferred vocabulary:

| Prefer | Avoid or define |
|---|---|
| assessment | audit, pentest |
| area checked | domain coverage |
| safe copy | snapshot on first mention |
| supporting record | occurrence |
| source and confidence | provenance |
| file fingerprint | SHA-256 digest on first mention |
| recipient public key | X25519 on first mention |
| current evidence suggests | proves, guarantees |
| technical coverage | compliance |

Error copy always answers: what happened; what remains safe/preserved; what can be done;
what coverage changes. Executive/setup prose targets grade 8–9, sentences usually under 22
words, paragraphs 2–4 sentences. Expand acronyms on first use.

## 14. Customer report design

Reports are generated artifacts inside the validated ZIP, not authenticated-app screens.
They use the architecture's trusted AST renderer, one locked CSS block, no JavaScript,
external assets, forms, iframe, SVG, or active content.

### 14.1 Shared report shell

Every HTML report includes:

- `lang="en"` and a unique project/report title;
- visible skip link;
- header/main/footer landmarks;
- project, source scope, generated time, report kind, and package digest;
- linked table of contents;
- “How to read this report”;
- correct heading hierarchy;
- table captions and scoped headers;
- descriptive package-relative evidence links;
- provenance/status definitions;
- limitations and prohibited-claim statement;
- meaningful alt text or adjacent long description for evidence images.

Markdown uses the same section order and no raw HTML for layout.

### 14.2 Package index

`index.html` is a reading guide:

1. project and validated package identity;
2. Start here: Executive report;
3. audience/question description for all five reports;
4. integrity verification;
5. evidence-provenance legend;
6. coverage-status definitions;
7. statement that technical coverage is not certification or proof of security.

### 14.3 Executive report

Target 5–8 printed pages before appendices:

1. decision at a glance;
2. what was assessed;
3. principal issues with affected party, business consequence, next action, evidence
   strength, and limit;
4. evidenced strengths/recoverability;
5. equal-format three-path summary;
6. important unknowns and limits;
7. reversal conditions;
8. next owner decision.

No composite score, risk gauge, severity pie, or heat map.

### 14.4 Decision report

Recommendation/confidence, conditional sequence, seven criteria with equal option depth,
feature-parity obligations, assumptions, dependencies, reversal conditions, independent
review outcome, and evidence index.

### 14.5 Technical report

Scope/method, repository composition, stack, architecture, maintainability, product/code
traceability, runtime readiness, finding index, tool/standards locks, evidence validation,
and technical limitations.

### 14.6 Security report

Plain security summary, baseline/profile and applicability state, material findings,
static and runtime technique coverage, secret-handling statement, independent review,
framework mapping, and limitations. High/critical items state consequence, affected party,
next action, evidence strength, and limits.

### 14.7 Coverage and limitations report

Six-status definitions; all 15 domains; every partial/blocked/not-applicable/not-tested
reason; unsupported ecosystems and exclusions; discovery unknowns; runtime attempted
steps; screenshot absence/presence; and follow-up owner/action.

### 14.8 Evidence references and print

Use descriptive labels such as “Evidence 12: authentication middleware location,” never a
bare ID. Full provenance words appear at first mention. Conflicts name both sides.

Print uses black text on white, light tints plus patterns/borders, repeating table headers,
no orphan headings, and no split between finding title/consequence/status when practical.
All content works offline and without disclosure widgets.

## 15. Frontend and QA acceptance

The design is implemented correctly when:

1. discovery and approvals save in `DRAFT` before `resolveTarget`;
2. `READY` precedes `startRun`, and post-resolution changes create a revision;
3. provider selection is bound to `getSystem.launcherProvider`;
4. every screen uses only the operations/fields in Section 3;
5. response/event-derived views disclose their non-reloadable nature;
6. no UI promises unavailable commit detail, review history, event history, recovery plans,
   limitation detail, report preview, or package stages;
7. static-first continuation is explicit and requires no illegal post-DRAFT approval;
8. all seven claim provenance states map to `ProductClaim`;
9. target execution is a separate affirmative decision when the capability is exposed;
10. technical severity, business priority, confidence, and validation remain separate;
11. the three modernization options use equal criteria and depth;
12. the full flow works at 320px, 200% zoom, keyboard-only, and with a screen reader;
13. no target-derived active content renders in the privileged UI;
14. customer reports are semantic, printable, offline, and understandable to a lay reviewer;
15. a consultant can follow every displayed material link without the frontend inventing a
    relationship.


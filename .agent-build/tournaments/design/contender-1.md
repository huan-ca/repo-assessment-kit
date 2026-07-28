# Repository Assessment Kit — Design Contender 1

**Direction:** The Guided Fieldbook  
**Status:** tournament contender  
**Platform:** local React 19.2 web application, Tailwind CSS 4, shadcn/ui with Radix primitives  
**Smallest supported viewport:** 320 CSS px  
**Primary user:** a consultant or assessment operator preparing a defensible customer decision package

## 1. Experience thesis

RAK should feel like working alongside a careful senior consultant: it asks one meaningful
question at a time, explains why the answer matters, offers a safe default, and never
punishes the operator for not knowing. The interface is a calm fieldbook rather than a
security dashboard. Warm paper surfaces, dark green actions, precise ledger lines, and
evidence “thread” markers make the product distinctive without making risk look theatrical.

The experience has three modes, each with a different density:

1. **Prepare** — a wide, forgiving wizard that converts repository and owner context into a
   reviewable assessment brief.
2. **Observe** — a durable run cockpit that emphasizes current work, what needs attention,
   and what the kit can still complete.
3. **Decide and release** — a reading-oriented report workspace that separates conclusions,
   evidence strength, objections, limitations, and package integrity.

The UI is a view and control surface for the frozen architecture. It never displays target
pages in the privileged interface, renders target Markdown/HTML, exposes raw host paths,
or implies that a blocked dynamic check invalidates the static assessment.

## 2. Design principles

### 2.1 Ask in business language; reveal technical structure on demand

Customer owners may not know framework IDs, runtime topology, or evidence terminology.
Prompts lead with “Who relies on this product?” and “What would a replacement have to
preserve?” Technical definitions, examples, contract IDs, and raw evidence metadata sit
behind adjacent disclosure controls. The initial reading level targets plain professional
English, not simplified or patronizing copy.

### 2.2 Unknown is a valid, useful answer

Every discovery prompt has two first-class paths: answer it, or record it as unknown with a
reason and follow-up owner. Unknown cards show their effect on confidence and coverage
before saving. They are never colored as validation errors. This protects evidence honesty
and lets an engagement continue when the right stakeholder is unavailable.

### 2.3 Safe defaults are visible defaults

Commit-only source capture, target-runtime egress denied, no optional hosted service,
static assessment allowed when runtime is blocked, and unencrypted validated ZIP are
explicit selections—not hidden system behavior. Each default is paired with a short
“Why this is recommended” sentence. Anything that sends data outside the local kit,
includes a dirty working tree, supplies a credential, runs target code, or deletes data
requires deliberate confirmation.

### 2.4 Show the next useful action, not merely the problem

A blocked runtime panel says which prerequisite failed, what was safely attempted, which
coverage is affected, and the available choices: continue static-only, change an approval,
or rerun the capability gate. Recoverable failures preserve admitted work and identify the
exact retry scope. Errors never strand the operator on a dead-end modal.

### 2.5 Separate evidence strength from visual severity

Severity, business priority, validation state, and confidence are separate fields and
separate visual encodings. A critical, low-confidence finding does not become a giant red
alarm; it becomes a clearly labeled critical item with a low-confidence marker and an
explicit validation need. Color always has a text or icon counterpart.

### 2.6 Make release confidence inspectable

The final package is not represented by a single celebratory checkmark. A nine-stage
release ledger shows admission, redaction, reviews, staging, manifest, pre-ZIP validation,
ZIP creation, reopen validation, and release digest. The customer ZIP becomes downloadable
only after the full ledger passes.

## 3. Information architecture

### 3.1 Global structure

```text
RAK
├── Runs
│   ├── New assessment
│   │   ├── Engagement
│   │   ├── Source
│   │   ├── Product context (4 short chapters / 10 topics)
│   │   ├── Safety and capabilities
│   │   └── Confirm scope
│   └── Run workspace
│       ├── Overview
│       ├── Coverage
│       ├── Findings
│       ├── Evidence
│       ├── Decision
│       ├── Reviews
│       └── Package
└── System readiness
```

There is no global findings dashboard or cross-run analytics in MVP. The run is the primary
scope. The persistent shell includes:

- product mark and wordmark, linking to Runs;
- current run switcher when inside a run;
- connection state (“Live”, “Reconnecting”, “Updates paused”);
- launcher/provider badge, e.g. “Using Codex” or “Using Claude Code”;
- Help menu containing status definitions, keyboard help, package verification help, and
  product version;
- no account avatar, cloud status, notification bell, or fictitious collaboration UI.

### 3.2 Navigation rules

- During `DRAFT`, the setup stepper is primary navigation. The operator may revisit any
  completed step; changing saved scope clearly invalidates later confirmation.
- After target resolution, the immutable target strip remains visible in the run header:
  project slug, short commit, snapshot mode, and copy-full-SHA action.
- During execution, “Overview” is the landing view. A single attention badge appears on
  Reviews or Overview only when operator input is actually required.
- Browser back/forward preserves selected run section, filters, and open detail drawer.
- Unsaved wizard edits prompt with “Keep editing” and “Discard unsaved changes”; saved
  changes do not.
- Terminal runs remain readable. Changing target, discovery, profile, or policy starts a
  new revision and never reopens the terminal run.

## 4. End-to-end user flows

### 4.1 First launch and system readiness

```text
Launcher prints loopback URL
  → UI exchanges one-time fragment token
  → fragment is removed from browser history
  → readiness check
      ├─ ready: Runs
      ├─ static-only ready: explanatory notice + Runs
      └─ required prerequisite missing: readiness repair page
```

The bootstrap transition uses a blank linen canvas, centered RAK mark, and “Opening your
local assessment workspace…” text. It must not briefly show the app before authentication.
If the fragment is missing, expired, or already used, show:

> This local session link is no longer valid.
>
> Return to the terminal where you started RAK and open the newest link.

No login form is offered because there are no user credentials to enter in the browser.

The readiness page groups prerequisites as:

- **Required to use the kit** — server, database, contracts, filesystem;
- **Ready for static assessment** — provider path, analyzers, source handles;
- **Needed only to run target applications** — host helper, Lima, rootless Docker,
  browser runner.

Dynamic prerequisites may be unavailable without blocking “Start a static-first
assessment.” A repair item contains the plain-language issue, a sanitized diagnostic ID,
the operator action, “Check again,” and a collapsed technical detail block.

### 4.2 Create and prepare an assessment

```text
Runs → New assessment
  → Engagement: name + provider + optional profiles
  → Source: registered local path or SSH Git
  → Product context: answer or explicitly mark unknown for all 10 topics
  → Safety: review capabilities, egress, optional services, credentials
  → Confirm: scope summary + attest authorization
  → Create run / save DRAFT
  → Resolve immutable target
      ├─ clean/valid: snapshot confirmation
      ├─ dirty local source: commit-only vs frozen-working-tree decision
      └─ identity/acquisition error: fix source and retry
  → Start assessment
```

#### Step 1 — Engagement

Fields:

- Project name; generates editable lowercase project slug.
- Engagement label, with example “Northstar modernization review — Q3”.
- Agent provider: two radio cards, Codex and Claude Code. Each card says that repository
  context sent to the selected provider crosses that provider’s inference boundary.
- Assessment profiles: general security baseline is fixed and shown as “Always included.”
  Optional overlays are unchecked. Selecting one opens a non-blocking applicability note:
  “This measures technical coverage. It does not establish compliance.”
- Optional hosted services: default “None.” Each service, if available, is a separate
  unchecked row with destination, data categories, recipient, retention warning, and
  “Learn what leaves this computer.”

The primary action is “Choose repository source.” Draft auto-save begins only after the run
can be created; before that, values live in local component state.

#### Step 2 — Source

Start with two large choices:

- **Registered local repository** — recommended when the code is already on this machine.
- **SSH Git repository** — for a private remote accessible through a registered SSH
  handle.

Only source handles returned by the launcher are selectable. There is no unrestricted
filesystem picker or free-form host path.

Local source fields: registered root, relative repository path, and snapshot mode.
“Assessed commit only” is selected by default. “Include current working-tree changes”
expands a warning explaining that the kit creates a frozen content snapshot identified by
the base commit plus a file-manifest digest; it does not scan the live tree in place.

SSH source fields: SSH handle, SSH Git URL, optional ref. Inline validation permits SSH
Git syntax only and explains rejected formats without echoing secrets or configuration.

A persistent “Source protection” callout states:

> RAK copies an immutable snapshot for assessment. It does not modify this repository.
> SSH keys and private configuration are never included in the customer package.

#### Steps 3–6 — Product context, four chapters

The ten required discovery topics are grouped into short, coherent chapters rather than a
ten-field wall:

1. **People and purpose**
   - Target customers
   - Buyers
   - User roles
   - Customer pain
2. **Value and differentiation**
   - Valuable workflows
   - Alternatives and differentiators
   - Revenue- or retention-critical behavior
3. **Promises and operating reality**
   - Contractual obligations
   - Expected scale
4. **Replacement boundaries**
   - Feature-parity expectations

Each topic is one `DiscoveryPrompt` card with:

- one direct question;
- a one-sentence “Why we ask” note;
- optional example chips that insert structure, never fabricated content;
- multiline answer field;
- provenance selector defaulting to “Owner told us” only when the operator actively
  identifies a speaker role; otherwise “Not yet verified”;
- confidence choice: High, Medium, Low;
- “I don’t know yet” secondary action.

Choosing unknown replaces the answer field with:

- “Why is this unavailable?” (`Stakeholder unavailable`, `Not documented`, `Conflicting
  answers`, `Outside current scope`, `Other`);
- “Who should follow up?”;
- read-only generated confidence effect and coverage effect in plain language, editable
  only where the contract permits;
- “Record as unknown” action.

Conflicting information opens a structured claim composer with “Viewpoint A,” “Viewpoint
B,” source/provenance for each, and what would resolve the conflict. The summary uses
“Conflicting,” never “invalid.”

A chapter footer shows `3 answered · 1 recorded unknown`; both count as complete. “Save and
continue” is disabled only while a topic is neither answered nor explicitly unknown.

#### Step 7 — Safety and capabilities

This is a guided policy review, not a settings dump. It is ordered from lowest to highest
additional exposure:

1. Static analyzers: fixed, local, no network, read-only snapshot; always selected.
2. Selected agent provider: required data-flow disclosure and effective capability state.
3. Runtime assessment: recommended only when the gate can create the isolated VM. Default
   target egress is denied.
4. Exact egress exceptions: destination, port, path prefix, methods, sent data categories,
   and reason. No wildcard or “allow internet” choice.
5. Sandbox credentials: purpose and recipient first; then a one-time protected upload.
   After upload, show only “Credential supplied · expires [time] · one use remaining” and
   Revoke. Never offer reveal or copy.
6. Optional hosted services: each requires a separate approval.

Every capability row presents `Available`, `Unavailable`, `Blocked`, `Denied`, or `Not
needed` with a sentence explaining why. A blocked runtime leaves “Continue with static
assessment” selected. “Try to bypass safety checks” is never an option.

#### Step 8 — Confirm scope

Use a reading layout, not another form. Summary cards:

- Repository and snapshot policy;
- Customer and product context, including count of unknown/conflicting topics;
- Agent/provider external data flow;
- Runtime and network policy;
- Supplied one-time credentials, by purpose only;
- Baseline and selected overlays;
- Expected assessment domains and known limitations.

Required checkbox:

> I am authorized to assess this repository and will provide only sandbox-safe credentials
> and endpoints. I understand RAK will not use production systems.

Primary action is “Resolve repository target.” The adjacent note says this records the
exact commit and frozen snapshot before any assessment begins.

#### Resolve target interstitial

Progress steps are “Register source,” “Read Git identity,” “Create immutable snapshot,”
and “Verify source unchanged.” Do not use an indeterminate spinner after an individual
step has resolved. On success, present a “Scope locked” card with:

- full commit SHA in selectable monospace;
- snapshot mode and digest;
- included/excluded dirty paths count;
- submodule/LFS treatment;
- before-source integrity result;
- “Copy scope summary.”

Primary action: “Start assessment.” Secondary: “Review setup.” A source identity mismatch
is fatal for that resolution attempt and must not offer “Continue anyway.”

### 4.3 Monitor an assessment

```text
Start → Overview
  → live phase/event updates
  ├─ no attention: operator may leave; work continues
  ├─ waiting input: attention panel → approve/deny/provide safe input
  ├─ runtime blocked: continue static-only OR change allowed prerequisite → rerun gate
  ├─ recoverable failure: review recovery plan → retry scoped attempts
  ├─ pause: confirm consequence → paused snapshot → resume
  └─ cancel: confirm → cleanup → terminal cancelled record
```

The Overview leads with a `Now / Next / Delivered so far` panel:

- **Now** names the active phase in human language, e.g. “Checking dependencies and code
  patterns.”
- **Next** names the next phase or operator action.
- **Delivered so far** counts admitted evidence, reconciled controls, findings awaiting
  review, and limitations. Counts link to filtered views.

Below it, a phase rail shows all 14 phases. Parallel static controls appear nested under
their phase only when expanded. The rail uses text labels for every state:
`Waiting`, `Ready`, `In progress`, `Needs input`, `Retry available`, `Complete`, `Complete
with limits`, `Skipped by policy`, `Failed`, `Cancelled`.

The top right has one contextual primary action and an overflow menu:

- `EXECUTING`: Pause assessment;
- `WAITING_INPUT`: Resolve requested input;
- `PAUSED`: Resume assessment;
- `RECOVERABLE_FAILURE`: Review recovery;
- `REVIEW_REQUIRED`: Continue to reviews;
- `COMPLETED`: Download customer package.

Cancel is always in the overflow menu and opens a confirmation sheet explaining that
admitted evidence remains, active secrets are revoked, runtime resources are cleaned up,
and this run cannot be resumed after cancellation.

#### Waiting for input

Input requests are full-width attention cards above the phase rail, not transient toasts.
They contain:

- requesting phase;
- the decision in one sentence;
- why work cannot proceed safely;
- affected coverage if denied or unavailable;
- deadline only if the underlying task truly has one;
- available scoped actions.

Examples: approve an exact runtime destination, replace an expired one-use secret, or
acknowledge a source limitation. Deny is always available where approval is requested and
explains the static/blocked outcome.

#### Runtime gate blocked

The blocked panel title is “Runtime checks can’t run safely yet,” followed by:

- gate result and sanitized reason;
- safe steps attempted;
- dynamic domains/controls affected;
- unaffected work (“Static assessment and customer reporting can continue”);
- primary “Continue static-only”;
- secondary “Review prerequisites”;
- tertiary “Run the gate again,” enabled only after an input or capability changed.

If runtime is demonstrably irrelevant, use “Not applicable” and explain the subject found
to be absent. Do not use “Blocked” as a synonym for “not applicable.”

#### Recoverable failure

The recovery page never reduces the problem to “Try again.” It shows:

- what stopped;
- last known safe checkpoint;
- admitted output that will be retained;
- failed or interrupted attempt IDs in technical disclosure;
- recommended recovery plan;
- attempts to retry, each selected by default only if safe and useful;
- coverage consequence if skipped.

Primary action: “Resume with this plan.” If the server returns a row-version conflict, the
UI refetches canonical state and says, “The run changed while this page was open. We’ve
loaded the current recovery plan.” Unsaved choices are preserved where still valid.

### 4.4 Explore coverage, findings, and evidence

#### Coverage

Default view is a 15-row domain ledger, not a percentage gauge. Each row shows domain,
status, reconciled/planned controls, exclusions, limitations, and supporting evidence
count. Summary tiles count all six statuses without collapsing them into “coverage %.”

Filters: status and profile. A “What these statuses mean” drawer defines:

- Pass — planned check completed with supporting evidence;
- Fail — check found that the expected condition was not met;
- Partial — only a defined subset was exercised;
- Blocked — a safety boundary, prerequisite, or authorization prevented the check;
- Not applicable — evidence shows the subject is absent;
- Not tested — applicable work was deliberately omitted or exhausted its safe budget.

Rows expand inline on desktop and navigate to a detail sheet on small screens.

#### Findings

Default grouping is by business priority, then technical severity. Operators can switch to
domain. Each finding row shows title, technical severity, business priority, confidence,
validation state, affected location count, and evidence count. Filters use labeled
multi-selects; filter chips remain keyboard-removable.

Finding detail has five sections:

1. “Why this matters” — plain-language consequence and affected party;
2. “What was found” — technical description, category, locations;
3. “Evidence strength” — confidence, validation state, reviews, limitations;
4. “Supporting evidence” — safe preview/download actions;
5. “Suggested next theme” — remediation theme, clearly not a full implementation plan.

Critical/high findings lacking a consequence, affected party, next action, evidence
strength, or limits display a “Report requirement missing” banner rather than appearing
customer-ready.

#### Evidence

Evidence is an index, never a file browser into the run root. Rows show title, evidence
type, source locator if safe, sensitivity, redaction state, validation state, collection
limitations, and linked claims/findings/controls.

Opening evidence first displays metadata. If safe preview is available, “Create safe
preview” is an explicit action; the resulting derivative ID is shown. Plain text is escaped
and wraps; JSON/CSV are rendered as bounded structured tables or text; trusted re-encoded
PNG/JPEG/WebP previews display with dimensions and alt text derived from the evidence
title. Raw HTML, SVG, XML, JavaScript, PDF, archives, GIF, and unknown formats are
download-only attachments. There is no “Open in new tab” for target content.

Truncation must say “Preview limited to [size/rows]; download the attachment to inspect the
complete item.” Downloads use a server-generated filename and never preview inline.

### 4.5 Review the modernization decision

```text
Synthesis complete
  → Decision workspace
  → compare all 3 paths across the same 7 criteria
  → inspect evidence / unknowns / conflicts
  → independent decision review
  → technical human review
  → lay human review
  → corrections create new inputs/revision as required
  → all required reviews pass
```

The Decision workspace begins with:

- recommendation in one sentence;
- confidence (`High`, `Medium`, `Low`) and why;
- “What could change this recommendation” reversal conditions;
- assumptions and dependencies;
- linked unknown and conflicting claims.

The comparison is a semantic table on wide screens and criterion-by-criterion cards on
small screens. Columns are always Remediate, Replace incrementally, Full rebuild. Rows are
the seven frozen criteria in the same order. Each cell contains a concise assessment,
evidenced/unverified/conflicting state, confidence, and evidence link. No winning option is
colored green; the recommendation receives a dark-ink “Recommended” lozenge so alternatives
remain credible.

An independent review objection appears immediately below the relevant criterion and in a
top-level objections summary. “Passed with objections” is not visually collapsed into
Passed.

### 4.6 Human reviews and correction loop

The Reviews view has four gates: independent security, independent decision, technical
human, and lay human. Agent reviews are read-only records. Human gates use structured
checklists:

**Technical review**

- material findings resolve to evidence or visible uncertainty;
- technical conclusions match evidence and control outcomes;
- limitations and blocked checks are complete;
- recommendation is consistent with detailed findings;
- no prohibited compliance/certification claim.

**Lay review**

- principal risks and business consequences are understandable;
- all three options are understandable and compared fairly;
- confidence and important unknowns are clear;
- next decision is clear;
- unexplained acronyms/jargon are absent.

Each item is `Corroborated`, `Disputed`, `Invalidated`, or `Not assessed`, with evidence
links and an objection field when required. The final verdict is Passed, Passed with
objections, or Failed. The submit confirmation states that the review is appended and
cannot be silently edited.

A failed review blocks packaging and offers “Return to affected section.” Corrections use
the architecture’s new input/revision behavior; the UI never edits admitted evidence or a
completed review in place.

### 4.7 Validate, package, download, and verify

```text
Reviews pass → Validate assessment
  ├─ validation fails: issue ledger → affected section → validate again
  └─ validation passes: package options
        → validated plain ZIP (always retained)
        → optional age wrapper
        → nine-stage package ledger
        → ZIP + detached digest download
```

Package options:

- **Validated ZIP** — default, always produced and retained;
- **Recipient-key encryption** — accepts a public X25519 recipient and explains that the
  plain validated ZIP is still retained locally;
- **Passphrase encryption** — shown as “Available from the protected launcher,” not as a
  browser password field. Selecting it in web explains the required launcher action.

The package stage ledger uses the nine architecture stages verbatim with a plain-language
subtitle. The browser may disconnect; reopening reconstructs progress from canonical state
and event replay.

On success, the package card shows:

- exact filename;
- size;
- SHA-256 in selectable monospace with Copy;
- validation report ID;
- Download ZIP;
- Download digest;
- encrypted wrapper and wrapper digest when created;
- “How to verify” instructions for macOS and Linux in a copyable, sanitized code block.

The success headline is “Customer package validated,” not “Assessment complete” if review
or delivery decisions remain outside the kit.

### 4.8 Retention and deletion

Deletion is available only from terminal-run overflow menu under “Manage retained data.”
The screen explains each scope:

- Internal working data only;
- Run data except customer packages;
- Entire run, including packages.

Selecting packages requires `includePackages`, typing the exact project slug, and confirming
each package digest. The destructive button remains disabled until values match. A summary
names every path class to be removed, states the 24-hour recovery window, and distinguishes
trash from final purge.

After trashing, a persistent tombstone page shows removal classes, purge time, recovery
availability, and “Restore run.” Restore requires slug and trash digest confirmation.
After purge, it states that recovery is no longer possible. Never use optimistic removal
from the Runs list before the deletion job is durably accepted.

## 5. Screen inventory

| Screen/view | Purpose and key elements | Entry | Primary exit |
|---|---|---|---|
| Session bootstrap | Exchange one-time token without exposing app content | launcher URL | Runs or session repair |
| System readiness | Separate required, static, and dynamic prerequisites | bootstrap; Help | Start assessment / Check again |
| Runs index | Resume drafts, active runs, completed packages | app home | New assessment / Open run |
| New assessment wizard | Capture engagement, source, discovery, policy | Runs | Resolve target |
| Target resolution | Lock commit/snapshot and prove source integrity | wizard confirm | Start assessment |
| Run overview | Current work, attention, phase rail, durable actions | run header | Contextual next action |
| Recovery plan | Explain checkpoint and scoped retries | recoverable failure | Resume with plan |
| Capability detail | Explain effective support/approval and effects | safety; overview | Approve/deny/rerun |
| Coverage ledger | Honest six-state coverage accounting | run nav | Domain detail |
| Findings index/detail | Interpret risks with evidence strength | run nav; report link | Evidence / Decision |
| Evidence index/detail | Inspect provenance and safe derivatives | run nav; finding link | Safe preview/download |
| Decision workspace | Compare three options using seven criteria | synthesis complete | Reviews |
| Reviews | Complete and inspect four review gates | review required | Validate |
| Validation issues | Resolve deterministic release blockers | failed validation | Affected section / Validate again |
| Package workspace | Configure and observe validated packaging | reviews passed | Download / Verify |
| Retention & deletion | Scoped, recoverable terminal cleanup | terminal overflow | Trash / Restore |
| Not found/session expired | Recover to valid local state | bad URL/session timeout | Runs / launcher guidance |

## 6. Component system

Use shadcn components as behavior primitives, not as the final visual identity. Extend them
with RAK variants and tokens in `apps/web`; do not fork Radix behavior.

### 6.1 Foundations and shell

- `AppShell`: 64 px desktop header, 56 px compact header; linen canvas; max content width
  1440 px. Default shows current location. Loading shows shell immediately with content
  skeleton. Error keeps Runs and Help reachable. Offline/reconnecting displays a persistent
  strip, never only a toast.
- `RunHeader`: project, commit, snapshot mode, run state, provider. At narrow widths, project
  and state remain; metadata moves into a “Scope details” sheet. Terminal state uses text,
  not celebratory color alone.
- `SectionNav`: horizontal tabs at `>=1024`; horizontally scrollable, edge-faded tab list at
  768–1023; a labeled select-style Radix dropdown below 768. Active section has a 3 px
  ledger-thread underline and `aria-current="page"`.
- `LiveConnection`: compact dot + text. Green “Live,” amber “Reconnecting,” gray “Updates
  paused.” Screen readers hear changes only after 5 seconds to avoid chatter.

### 6.2 Guided input

- `WizardStepper`: numbered chapter list with Current, Complete, Complete with unknowns,
  Needs attention, and Locked. Steps use buttons only when navigable. On mobile it becomes
  “Step 3 of 8 · Product context” plus Back/Next; a “View all steps” sheet is available.
- `ConsultantPrompt`: question, why-it-matters, examples, response, provenance/confidence,
  unknown path. Default is uncommitted. Saved success shows a quiet check and timestamp,
  not a toast. Validation error is adjacent and focuses first invalid control on submit.
  Disabled/locked state explains why.
- `UnknownComposer`: neutral sand panel with reason and follow-up. Empty displays required
  fields; loading is never needed locally; save error retains input; success collapses to
  an Unknown summary.
- `ChoiceCard`: real radio/checkbox under Radix label semantics. Selected uses ink border,
  pale moss background, and check icon. Disabled keeps 60% contrast and gives reason below;
  unavailable is not focusable but remains readable.
- `SafeDefaultCallout`: shield-check icon, “Recommended” eyebrow, default and rationale.
  It is informational, never itself clickable.
- `SecretHandle`: purpose, recipient, expiry, upload state, remaining use, Revoke. It never
  renders the value, a reveal control, or a copy control. Upload progress is determinate;
  failure states whether the handle remains usable.

### 6.3 Status and progress

- `StatePill`: icon + full label. Variants map to state semantics, not arbitrary colors.
  Minimum height 24 px; never use pill shape for interactive buttons.
- `PhaseRail`: vertical ledger line with 32 px state nodes and phase cards. Current phase
  has ink outline and pale moss fill. Complete-with-limits uses amber notch plus text.
  Loading uses skeleton rows only before phase data arrives; event updates do not reset it.
- `TaskProgress`: label, elapsed time, optional determinate progress only when count is
  knowable. Indeterminate state says what the process is doing; it never invents a percent.
- `AttentionPanel`: persistent action-required content with title, effect, actions, and
  technical disclosure. Error retains actionable buttons; resolved success stays as a
  collapsed event in the activity history.
- `CoverageLedger`: semantic table with sticky header only at desktop; status summary;
  expanded details. Empty before planning says “Controls have not been planned yet.”
  Loading uses row skeletons. Fetch error includes Retry. Zero findings never changes
  coverage status.
- `ReleaseLedger`: nine immutable rows. Each is Waiting, Running, Passed, or Failed. Failed
  opens diagnostic and blocks later rows. Success includes certificate/reference ID.

### 6.4 Reading and evidence

- `FindingRow`/`FindingDetail`: preserve four independent axes—severity, priority,
  confidence, validation. A missing required customer explanation is a blocking notice.
- `EvidenceLink`: displays evidence title and short ID, with validated/disputed icon. Broken
  reference is a release-blocking error style, not a disabled link.
- `SafePreview`: metadata first; escaped text or trusted image derivative only. Default
  awaits explicit creation. Loading announces “Creating a safe preview.” Failure keeps
  Download Attachment if allowed. Success names derivative ID and truncation state.
- `DecisionMatrix`: semantic table at wide width, criterion accordion cards at small width.
  Each option remains in the same order. Evidence links are buttons/anchors with descriptive
  labels, not raw IDs.
- `ConfidenceMarker`: `High`, `Medium`, or `Low` plus short rationale. It does not use a
  battery/meter metaphor, which can imply false precision.
- `Objection`: red-thread left border, reviewer, affected item, objection, supporting
  evidence, disposition. Passed-with-objections uses this component even when overall gate
  is passable.
- `ReviewChecklist`: roving is not used; every item is a labeled native/Radix radio group so
  tab and arrow behavior is predictable. Failed submission retains all selections.
- `DigestBlock`: wraps at byte-safe points on 320 px, offers Copy, and gives visible
  “Copied” feedback plus polite live announcement.

### 6.5 Actions, dialogs, feedback

- `Button`: shadcn variants `primary`, `secondary`, `quiet`, `danger`, `link`. Height 44 px
  default, 40 px compact only in dense desktop tables, 48 px on wizard mobile footer.
  Loading preserves width, shows spinner, and changes accessible name to the in-progress
  action. Disabled is reserved for logically unavailable actions; permission denial uses
  an enabled action that explains the gate where appropriate.
- `ActionBar`: sticky at wizard bottom, surface with top rule. Mobile stacks primary full
  width above Back; desktop places primary on right.
- `ConfirmationDialog`: only for consequential but compact choices, such as pause. Focus
  moves to title, least destructive action receives initial focus, Escape closes.
- `SafetySheet`: for approvals, cancellation, package encryption, and recovery where enough
  context must remain visible. Mobile full-screen; desktop max-width 640 px.
- `DestructiveConfirmation`: names scope and consequence, uses explicit typed confirmation,
  and never closes on outside click.
- `Toast`: used only for low-stakes confirmation such as Copy. Errors that affect progress
  are inline/persistent. Toast duration is at least 6 seconds, pauses on hover/focus, and
  never contains the only path to recovery.
- `TechnicalDisclosure`: collapsed by default, summary describes contents (“Show attempt
  and diagnostic IDs”). Content is plain text, bounded, and copyable.

### 6.6 Universal state contract

Every data-backed view must implement these states:

| State | Required treatment |
|---|---|
| Default | Real labels, current data timestamp where relevant, and one obvious next action |
| Empty | Explain whether work has not started, produced zero items, or is not applicable; never show a blank table |
| Loading | Preserve layout with skeletons; announce once after 400 ms; never erase already loaded canonical data during background refresh |
| Error | Plain-language cause, whether work/data is safe, operator action, Retry if safe, and technical disclosure |
| Success | Confirm the durable result and next available action; avoid confetti and auto-navigation after consequential work |
| Disabled | Maintain readable contrast and pair with adjacent reason or tooltip available to keyboard/touch users |
| Stale/conflict | Preserve edits, refetch canonical state, explain what changed, and require review before resubmitting |
| Reconnecting | Keep last canonical data, mark it as potentially stale, replay events, then refetch when row version advances |

## 7. Visual language

### 7.1 Art direction: a modern assessment fieldbook

The visual signature is “paper, ink, and evidence thread”:

- warm off-white canvas rather than blue-gray SaaS chrome;
- deep green ink for trusted primary actions;
- fine graphite rules and a recurring 3 px rust-red evidence thread connecting phase nodes,
  citations, objections, and report sections;
- square-ish cards with one clipped/notched corner on major consultant notes, implemented
  in CSS without SVG;
- restrained use of monospace for immutable identifiers and source locations;
- no gradients, glass effects, neon risk glows, mascots, dashboard donuts, or oversized
  empty hero areas.

The thread is decorative only when `aria-hidden`; state never depends on it.

### 7.2 Color tokens

All values are fixed for the light theme in MVP. A dark theme is not required; do not ship
an unverified automatic dark mode.

| Token | Hex | Role | Required text pairing / contrast |
|---|---:|---|---|
| `--canvas` | `#F6F4EE` | app background, paper | ink 15.12:1 |
| `--surface` | `#FFFFFF` | cards, dialogs, table | ink 16.63:1 |
| `--surface-subtle` | `#E9ECE7` | inset rows, skeleton base | ink 13.95:1 |
| `--ink` | `#17201F` | primary text, selected border | canvas 15.12:1 |
| `--ink-muted` | `#665E52` | secondary text | canvas 5.81:1; white 6.39:1 |
| `--rule` | `#C9CEC7` | dividers and idle borders | non-text only |
| `--focus` | `#215F8D` | focus ring, links | white 6.80:1 |
| `--action` | `#1F5C4A` | primary button | white 7.81:1 |
| `--action-hover` | `#174538` | hover/pressed action | white 10.80:1 |
| `--success-bg` | `#DDEFE7` | passed/available tint | success text 9.04:1 |
| `--success-text` | `#174538` | passed/available text | success bg 9.04:1 |
| `--info-bg` | `#E4F1FA` | observed/info tint | info text 5.92:1 |
| `--info-text` | `#215F8D` | info text | info bg 5.92:1 |
| `--warning-bg` | `#FFF4D6` | partial/blocked/unknown tint | warning text 6.19:1 |
| `--warning-text` | `#8A4B0F` | warning text | warning bg 6.19:1 |
| `--danger-bg` | `#FCE9E6` | failed/critical/destructive tint | danger text 5.81:1 |
| `--danger-text` | `#A3342D` | danger text/button border | danger bg 5.81:1; white 6.80:1 |
| `--thread` | `#A94F35` | evidence thread, objection rule | never sole status signal |
| `--unknown-bg` | `#EFE9DE` | unknown/unverified surface | ink 13+:1 |

Technical severity tokens may tint an icon/background but always include text:

- Critical: danger text + octagon icon;
- High: rust `#9B4A2D` + upward triangle;
- Medium: warning text + diamond;
- Low: info text + down triangle;
- Informational: ink-muted + circle.

Focus uses a 2 px `--focus` ring with 2 px canvas/surface offset. On `--focus` backgrounds,
use a 2 px white inner ring plus 2 px ink outer ring.

### 7.3 Spacing and sizing

Base spacing unit is 4 px. Named tokens:

```text
space-0  0
space-1  4
space-2  8
space-3  12
space-4  16
space-5  20
space-6  24
space-8  32
space-10 40
space-12 48
space-16 64
space-20 80
```

- Control internal gap: 8 px.
- Form field stack: label to control 8 px; help/error 6 px; field to field 20 px.
- Card padding: 16 px at 320–639; 24 px at 640–1023; 32 px at 1024+ for reading cards.
- Page horizontal gutter: 16 px at 320; 24 px at 640; 32 px at 1024; 48 px at 1280+.
- Reading-section vertical gap: 32 px mobile, 48 px desktop.
- Minimum pointer target: 44×44 px; primary mobile actions 48 px high.

### 7.4 Radius, border, and elevation

```text
radius-control  8px
radius-card     12px
radius-panel    16px
radius-pill     999px (status only)
border-default  1px solid var(--rule)
border-strong   1px solid var(--ink)
```

Use border and surface contrast before shadow. Elevation:

- `elevation-0`: none, default cards;
- `elevation-1`: `0 1px 2px rgb(23 32 31 / .06), 0 6px 20px rgb(23 32 31 / .05)` for
  sticky bars and hoverable rows;
- `elevation-2`: `0 16px 48px rgb(23 32 31 / .16)` for dialogs/sheets only.

Major note cards use a 12 px CSS clipped top-right corner and a border; interactive hit
area remains rectangular.

### 7.5 Icons and illustration

Use one outline icon family already standard with shadcn (Lucide), stroke 1.75 px, at
16/20/24 px. Icons always accompany labels for primary actions and states. No custom
illustration is required. Empty states use a small CSS fieldbook motif—two ruled rectangles
and a thread—rather than stock artwork.

### 7.6 Motion

Motion communicates continuity:

- hover/color: 120 ms `ease-out`;
- accordion/sheet: 180 ms cubic-bezier(.2,.8,.2,1);
- phase state change: 240 ms opacity + 4 px translate, once;
- progress indeterminate loop: 1.6 s linear;
- no parallax, bounce, confetti, count-up animation, or looping decorative motion.

With `prefers-reduced-motion: reduce`, remove transforms and smooth scrolling, render sheets
without travel, make phase updates instant, and replace moving progress with a static
striped bar plus “In progress” text.

## 8. Typography

### 8.1 Families and loading

- `--font-sans`: locally bundled **Atkinson Hyperlegible Next Variable**, then
  `ui-sans-serif, system-ui, sans-serif`.
- `--font-mono`: locally bundled **IBM Plex Mono**, then `ui-monospace, SFMono-Regular,
  Consolas, monospace`.

Font files are checked into the release assets, subset only if all required Latin
characters and symbols remain, and never fetched from an external CDN. Use `font-display:
swap`. If bundling is deferred, the system fallbacks must preserve all measures and no
layout may depend on exact glyph width.

### 8.2 Named type tokens

| Token | Size / fluid rule | Line height | Weight | Use |
|---|---|---:|---:|---|
| `type-micro` | 12 px | 16 px | 600 | uppercase eyebrows only; never body/help |
| `type-caption` | 13 px | 18 px | 450 | timestamps, metadata |
| `type-label` | 14 px | 20 px | 650 | labels, buttons, nav |
| `type-body` | 16 px | 24 px | 450 | default UI and report prose |
| `type-body-lg` | 18 px | 28 px | 450 | prompt questions, key explanations |
| `type-title-sm` | 20 px | 28 px | 650 | card/section subsection |
| `type-title-md` | `clamp(1.375rem, 1.24rem + .55vw, 1.75rem)` | 1.25 | 680 | screen section title |
| `type-title-lg` | `clamp(1.75rem, 1.5rem + 1vw, 2.5rem)` | 1.12 | 700 | page title / recommendation |
| `type-display` | `clamp(2rem, 1.6rem + 1.6vw, 3rem)` | 1.06 | 720 | report cover only |
| `type-stat` | `clamp(1.75rem, 1.5rem + 1vw, 2.25rem)` | 1.0 | 650 | counts, never status alone |
| `type-code` | 13 px desktop; 12 px at <=479 | 20 px | 450 | digests, paths, IDs |

Letter spacing: `type-micro` +0.06em; headings −0.015em; body normal. Do not uppercase
buttons or status names.

### 8.3 Measure and rhythm

- Wizard prompt/answer measure: max 62ch.
- Report narrative: 60–68ch; never exceed 72ch.
- Technical explanation: max 78ch.
- Table cells: max 42ch before disclosure/truncation.
- Heading-to-copy: 12 px.
- Paragraph-to-paragraph: 16 px.
- Subsection-to-subsection: 32 px mobile / 40 px desktop.
- Report major sections: 56 px screen / forced logical page break where appropriate in
  print.

Do not center multi-line body text. Use tabular numerals for counts, times, scores, and
coverage reconciliation.

## 9. Responsive and adaptive behavior

### 9.1 Breakpoints

Tailwind screens:

```text
xs  480px
sm  640px
md  768px
lg  1024px
xl  1280px
2xl 1536px
```

Design from 320 px upward. Use fluid width and container queries for reusable cards:
`@container (min-width: 36rem)` for two-column card internals and `56rem` for dense
comparison layouts. Do not infer component layout from viewport when its container is
narrow.

Global max widths:

- wizard and review form: 960 px;
- narrative/report workspace: 1120 px with 720 px reading column;
- tables and run overview: 1440 px;
- dialogs: 480 px; safety sheets: 640 px.

At 320 px, no page has horizontal overflow. Long SHA values, refs, URLs, paths, control
IDs, and filenames use `overflow-wrap:anywhere`; data tables switch representation rather
than forcing viewport scroll. Code blocks may scroll internally with visible affordance.

### 9.2 Per-screen reflow

| Screen | 320–479 | 480–767 | 768–1023 | 1024+ |
|---|---|---|---|---|
| App shell | 56 px header; mark, page title, Help menu; run details in sheet | same with connection label | provider + connection visible | full wordmark, run switcher, provider, connection, Help |
| Runs | single cards; state above metadata; full-width action | single cards with 2-column metadata | 2-column card grid | compact ledger/list with aligned columns |
| Wizard | current step summary; prompt cards; sticky stacked actions | same, wider measure | 220 px step rail + content; actions inline | 248 px rail + 640 px prompt column + optional 240 px “Why it matters” aside |
| Source choices | stacked | stacked | two equal cards | two equal cards |
| Discovery prompt | all fields stacked; example chips wrap | stacked | provenance/confidence two columns | answer plus optional context aside |
| Confirm scope | one card per section | one column | two-column summary cards | 7/5 column reading layout with sticky confirmation card |
| Run overview | Now/Next stack; phase cards; no table | same | summary tiles 2×2; phase rail | 8/4 layout: main phase rail + sticky attention/activity column |
| Section nav | dropdown | dropdown | scrollable tabs | fixed tabs |
| Coverage | summary chips; domain cards | domain cards | semantic table with selective columns | full ledger table with expandable rows |
| Findings | filter sheet; finding cards | cards | compact rows | full row columns; detail in 480 px side sheet or page |
| Evidence | metadata cards; preview below | same | list + detail page | 5/7 split list/detail only when enough width |
| Decision matrix | one criterion card; 3 option sections in fixed order | same | criterion accordion/table hybrid | sticky-header 4-column semantic table |
| Reviews | gate accordion; one checklist item at a time | same | gate list + form | 4/8 split gate rail + checklist |
| Package | stage ledger; download actions stacked | same | 7/5 stage/options | 8/4 ledger + sticky package card |
| Deletion | full-screen sheet; typed inputs | full-screen sheet | 640 px sheet | 640 px sheet |

At mobile sizes, sticky action bars respect `env(safe-area-inset-bottom)`. Opening the
keyboard scrolls the active field and its help/error into view without covering it. Sheets
trap focus and lock background scroll.

### 9.3 Dense data behavior

- Never solve responsive tables with 1000 px min-width on the page.
- At `<768`, convert each row to a definition list card with identical source order and
  explicit labels.
- At 768–1023, retain only decision-essential columns; remaining data opens in row detail.
- At 1024+, allow table container horizontal scrolling only for genuinely unbounded
  technical matrices, with sticky first column and a visible “Scroll for more” cue.
- Filters become a bottom sheet below 768; active filters stay visible as wrapping chips.

## 10. Accessibility

Target WCAG 2.2 AA, with AAA contrast for primary body text where the palette permits.

### 10.1 Keyboard and focus

- All functionality is keyboard-operable in logical DOM order.
- A visible “Skip to main content” link is first focusable.
- Focus is never moved on SSE updates. On explicit navigation, focus moves to the new page
  `h1`; on inline validation failure, to the error summary, then errors link to fields.
- Dialogs/sheets use Radix focus trap and restore focus to trigger.
- Escape never dismisses destructive confirmation after the irreversible request has been
  submitted.
- Table row click targets have an explicit primary link; the whole row is not a
  keyboard-invisible click surface.
- Shortcuts are limited to `/` focus filters/search and `?` keyboard help, disabled in text
  fields and fully documented.

### 10.2 Semantics and announcements

- Exactly one `h1` per view and hierarchical headings thereafter.
- Wizard uses an ordered list; current step uses `aria-current="step"`.
- Phase and release ledgers are ordered lists with state text.
- Status pills never rely on color.
- Field error text is linked with `aria-describedby`; required state is programmatic.
- Async mutation uses `aria-busy`; a polite live region announces durable acceptance and
  completion. Rapid event updates are batched at most once every 5 seconds.
- Urgent operator input uses `role="status"` on arrival, not repeated `alert` updates.
  Safety/fatal errors after an explicit action use `role="alert"`.
- Copy feedback is announced once without stealing focus.
- Charts are avoided. Counts and comparisons are always available as text/tables.

### 10.3 Perception and interaction

- Text contrast meets 4.5:1; large text 3:1; component boundaries/focus/state indicators
  meet 3:1 against adjacent colors.
- Minimum target 44×44 px; spacing prevents adjacent destructive and primary targets from
  touching.
- Zoom to 200% at 1280 px and 400% reflow at 320 px without loss or two-dimensional page
  scrolling.
- Browser text spacing overrides (1.5 line height, 0.12em letter, 0.16em word, 2× paragraph)
  do not clip or overlap.
- `prefers-contrast: more` strengthens borders, removes subtle tinted distinctions, and
  adds patterns/icons to status blocks.
- No meaning requires hover. Tooltips open on focus and touch, contain supplemental only,
  and are dismissible.
- Time limits are shown only where real. Session expiry gives a warning and launcher-based
  recovery; it never discards server-side run work.

### 10.4 Evidence safety accessibility

- Safe images have descriptive alt text supplied from trusted evidence metadata; images
  that are purely duplicative use empty alt.
- Escaped text previews preserve line breaks and offer wrap/no-wrap control. No-wrap is in
  an internally scrollable region with keyboard access.
- Attachment-only formats are announced as such with media type and size before download.
- Source locations use readable text (“packages/api/auth.ts, lines 41–58”), with raw locator
  optionally copyable.

### 10.5 Verification

Required pre-release checks:

- axe-core automated checks for every screen and all dialog/sheet states;
- Playwright keyboard paths for complete wizard, runtime-blocked recovery, review, package,
  and deletion confirmation;
- manual NVDA + Firefox on Windows/WSL best-effort environment and VoiceOver + Safari on
  macOS for wizard, live progress, decision matrix, and safe preview;
- 320, 360, 768, 1024, 1280, and 1536 px visual/reflow snapshots;
- reduced motion, increased contrast, 200% zoom, 400% reflow, and browser text-spacing
  bookmarklet checks;
- contrast verification against the exact tokens above;
- no target-derived active content in the authenticated DOM.

## 11. Content and voice

### 11.1 Voice

RAK is calm, direct, candid, and specific. It speaks as a tool helping a consultant, not as
an autonomous authority.

- Use “RAK found…” for observed tool results.
- Use “The owner stated…” for owner claims.
- Use “The code suggests…” for code inference.
- Use “We could not test…” only in customer report prose where “we” means the assessment
  engagement; the operator UI prefers “This check could not run.”
- Say “recommended path,” never “the correct answer.”
- Say “technical coverage against [profile],” never “compliant,” “certified,” or “secure.”
- Say “No findings were produced by these techniques,” never “No vulnerabilities exist.”

### 11.2 Microcopy patterns

| Situation | Preferred copy | Avoid |
|---|---|---|
| Unknown discovery | “Record this as unknown” | “Skip” |
| Runtime unavailable | “Runtime checks can’t run safely yet” | “Runtime failed” |
| Static continuation | “Continue with static assessment” | “Ignore error” |
| Approval denial | “Deny; record affected checks as blocked” | “Reject” |
| Empty findings | “No findings have been admitted yet” | “All clear” |
| Partial coverage | “4 of 7 planned checks completed; 3 were blocked” | “57% secure” |
| Package success | “Customer package validated” | “Everything passed” |
| Mutation accepted | “Pause request accepted. Active work is checkpointing.” | “Paused” before durable state |
| Recovery | “Resume from the last safe checkpoint” | “Retry all” |
| Delete | “Move selected run data to recoverable trash” | “Clean up” |

Buttons use verb + object: “Resolve repository target,” “Start assessment,” “Review
recovery plan,” “Validate assessment,” “Create customer package,” “Download ZIP.”

Error construction:

1. what happened;
2. what remains safe or retained;
3. what the operator can do;
4. technical detail and request ID in disclosure.

Example:

> The dependency analyzer stopped before its output could be admitted. Evidence from other
> completed checks is retained. Resume with the recommended recovery plan, or continue with
> this domain marked partial.

### 11.3 Acronyms and identifiers

Spell out a term on first report use: “software bill of materials (SBOM).” Framework and
control IDs belong in supporting detail, not executive headings. The operator UI may use
Git, SSH, ZIP, and SHA-256 where essential, with nearby Help definitions. Full UUID-like
IDs are hidden behind technical disclosures unless needed to verify or report a problem.

## 12. Customer report design

The package report is visually related to the app but implemented as safe, static,
JavaScript-free HTML plus Markdown. It uses only the release-owned CSS block, escaped typed
AST content, package-relative links, and trusted re-encoded PNG/JPEG images. It contains no
forms, scripts, SVG, target styles, external fonts, external URLs, Mermaid, or active
downloads.

### 12.1 Report hierarchy

`index.html` is a report contents page:

1. Executive decision;
2. Options comparison;
3. Technical assessment;
4. Security assessment;
5. Coverage and limitations;
6. Evidence and machine-readable appendices;
7. Package integrity and verification.

It leads with project name, assessed commit/snapshot, assessment date, provider, report
profile, and a conspicuous scope statement. Navigation is ordinary relative anchors/links
and remains useful when JavaScript is unavailable.

### 12.2 Executive report

Target length: 4–7 print pages, with 60–68ch prose. Order:

1. **The decision in brief** — one-sentence recommendation and confidence;
2. **What matters most** — up to five principal issues, each with business consequence;
3. **Three paths compared** — same seven criteria, condensed;
4. **Why this path is recommended** — evidence-backed rationale;
5. **What could change the answer** — unknowns, assumptions, dependencies, reversal
   conditions;
6. **What could not be tested** — plain-language limitations;
7. **Next decision** — the customer action, not an implementation roadmap.

The recommendation uses an ink-outlined callout, not green. Critical risk uses danger text
and icon but no full-page red banner. Every material claim carries a superscript evidence
number linking to a human-readable evidence note or technical section.

### 12.3 Decision report

The decision report preserves equal columns/order for remediation, incremental replacement,
and full rebuild. Every criterion cell includes assessment, state
(`Evidenced/Unverified/Conflicting`), confidence, and evidence references. Print landscape
is allowed for this table; narrow/screen HTML uses stacked criterion sections through CSS
only.

Below the matrix: recommendation, assumptions, dependencies, reversal conditions,
independent review verdict, and unresolved objections.

### 12.4 Technical and security reports

Technical report order: repository composition, stack, boundaries, maintainability,
features/use cases, dependency inventory, runtime readiness, product-to-code traceability,
then detailed findings.

Security is a distinct report with:

- scope and baseline/profile applicability state;
- technique and coverage statement;
- findings ordered by business priority, then severity;
- independent validation outcomes;
- dynamic checks and explicit blocked/not-applicable states;
- limitations and unsupported ecosystems;
- deeper profile recommendations with observed triggers and customer-confirmation note.

Each critical/high finding uses a standardized card:

```text
Finding title
Business consequence · Affected party · Priority · Technical severity
What was observed
Evidence strength and validation
Limits / what was not established
Recommended next theme
Evidence references
```

### 12.5 Coverage and limitation report

Never use a single score. Present:

- 15-domain status ledger;
- six-state count summary;
- planned/reconciled control counts;
- exclusions and unsupported ecosystems;
- runtime capability decision;
- unknown and conflicting product claims;
- screenshots absent/present explanation;
- how each limitation affects confidence or decision.

### 12.6 Report typography and print

Report HTML uses the same local/fallback stack without external font loading. Screen sizes
follow the app tokens; print body is 10.5 pt/15 pt, `h1` 24 pt/27 pt, `h2` 16 pt/20 pt,
captions 8.5 pt/12 pt. Page margins are 18 mm. Repeated header includes project and short
commit; footer includes report kind, generation date, and `Page n` where CSS paged media
supports it.

Avoid orphan headings and split finding cards where practicable. URLs and digests wrap.
Colors remain distinguishable in grayscale through icons, labels, and border patterns.
Background colors are nonessential when browsers omit print backgrounds.

### 12.7 Evidence references

Human-facing references use `E-001`, `E-002`, etc. alongside immutable evidence IDs in
appendices. A reference note contains title, evidence type, source locator when safe,
capture method/time, validation/redaction state, and collection limitations. Target-derived
attachments are relative download links only; unsafe formats are never embedded.

## 13. Acceptance criteria for frontend and QA

The design is correctly implemented when:

1. An operator can complete all ten discovery topics through answers or explicit unknowns,
   including conflicting claims, at 320 px and with keyboard only.
2. The final setup confirmation exposes source/snapshot policy, provider data flow, runtime
   egress, credential purposes, profiles, and known limitations before target resolution.
3. A dirty local tree cannot be mistaken for its commit: the selected snapshot mode and
   manifest identity are visible before start and throughout the run.
4. Blocked runtime offers static continuation and records affected coverage without using
   success language or an unsafe bypass.
5. Browser disconnect/reconnect retains canonical data, replays/refetches events, and does
   not move focus or duplicate announcements.
6. All six coverage states appear as text plus a non-color cue; no aggregate percentage
   implies assessment quality or security.
7. Severity, business priority, confidence, and validation state remain separately
   readable in findings and reports.
8. Unsafe evidence formats are attachment-only; target HTML/SVG/PDF/JavaScript never enters
   an inline privileged preview.
9. The decision view compares all three options against all seven criteria in the same
   order and exposes evidence, unknowns, conflicts, confidence, and reversal conditions.
10. Failed or passed-with-objections reviews remain visibly distinct and packaging is
    unavailable until every required review and deterministic gate passes.
11. Package creation shows all nine validation stages, always retains the plain validated
    ZIP, and exposes its detached SHA-256 digest.
12. Delete-entire-run cannot be requested until project slug and every package digest match;
    trash and 24-hour restore state are understandable.
13. Every data view passes the default, empty, loading, error, success, disabled,
    stale/conflict, and reconnecting state contract.
14. No viewport from 320 to 1536 px has page-level horizontal overflow, and 400% reflow does
    not require two-dimensional scrolling.
15. Axe, keyboard, screen-reader, contrast, reduced-motion, increased-contrast, text-spacing,
    and zoom checks in section 10.5 pass.
16. Executive output is understandable without unexplained technical jargon and contains
    recommendation, alternatives, business consequences, confidence, unknowns, limitations,
    and next decision.


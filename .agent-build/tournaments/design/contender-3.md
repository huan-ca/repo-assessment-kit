# Repository Assessment Kit — UX and Visual Design Specification

**Direction:** The Clear Record  
**Design priority:** Accessibility-maximal, plain-language operation  
**Platform:** Local React 19.2 web application; Tailwind CSS 4; shadcn/ui with Radix primitives  
**Design target:** WCAG 2.2 AA throughout, with AAA contrast for the default reading experience

## 1. Experience thesis

Repository Assessment Kit is not a security dashboard. It is a guided evidence-and-decision workspace used by people with very different technical fluency. The interface must let a nontechnical owner understand what is being asked, what the kit will do, what leaves the machine, what remains unknown, and what the eventual recommendation means. It must simultaneously let an assessor inspect exact evidence, controls, paths, hashes, and validation states without flattening those details into a misleading score.

The product uses the visual metaphor of a well-kept field record: quiet paper-like surfaces, numbered sections, explicit labels, narrow readable text columns, and a visible chain from claim to evidence to decision. It avoids the dense dark “cybersecurity console” aesthetic, decorative charts, gradients, glass effects, and color-coded severity walls. The distinctive element is the **evidence thread**: a narrow vertical rule with numbered anchors that visually and semantically connects a conclusion, its supporting claims, evidence, limitations, and review outcome.

The default experience answers five questions in order:

1. What are we assessing?
2. What does the product need to do for its owners and users?
3. What will the kit access or send, and who approved it?
4. What was checked, what was not, and why?
5. What decision does the evidence support, with what confidence?

Technical identifiers and machine data are never the first explanation, but are always available one disclosure level deeper.

## 2. Design principles

### 2.1 Lead with meaning, then reveal machinery

Every state, finding, permission, and limitation starts with a short human explanation and consequence. A “Technical details” disclosure then exposes IDs, paths, framework references, hashes, raw status codes, and timestamps. This supports the customer software owner without hiding precision from the consultant.

### 2.2 Make uncertainty as legible as evidence

Unknown, inferred, conflicting, blocked, and not tested are first-class words, not subtle metadata. They appear beside the affected claim or conclusion and include “Why this matters” and “What would resolve it.” The interface never converts incomplete coverage into reassuring whitespace or a composite score.

### 2.3 Consent is a record, not a checkbox

Provider inference, Git access, dependency acquisition, build traffic, target runtime traffic, optional hosted services, credentials, and working-tree inclusion are distinct decisions. Each approval states destination, data categories, purpose, recipient, expiry, and coverage effect of denial. No optional approval is preselected. A user can review and revoke current approvals from a persistent consent ledger.

### 2.4 One task and one decision per view

Wizard steps, waiting-input screens, reviews, and confirmations have one dominant action. Secondary detail sits after the primary content in DOM and visual order. Long forms are divided into short sections with a completion map. Autosave is visible and does not steal focus. This reduces working-memory load for users with cognitive, attention, or language-processing disabilities.

### 2.5 Text, structure, and shape carry every meaning

Color is supportive only. Status always includes a word, icon or geometric marker, and short explanation. Charts always have an adjacent data table or list. Focus, selection, severity, confidence, and validation state remain understandable in grayscale, forced-colors mode, and to screen readers.

### 2.6 Preserve agency during long work

The operator always knows the current phase, whether the kit can safely stop, what continues after the browser closes, and what evidence has already been preserved. Pause, cancel, retry, resume, and create-revision actions explain their exact effects before commitment.

## 3. Information architecture

### 3.1 Global structure

The authenticated application has four top-level destinations:

1. **Assessments** — all runs and the start-new flow.
2. **System readiness** — host, provider, architecture, helper, and prerequisite status.
3. **Data and retention** — generated paths, retention windows, deletion jobs, and engagement homes.
4. **Help** — status definitions, evidence labels, privacy boundaries, keyboard help, and package verification.

Within an assessment, a persistent local navigation lists:

1. Overview
2. Product context
3. Access and consent
4. Progress
5. Coverage and limits
6. Findings
7. Evidence
8. Decision
9. Reviews
10. Package

Unavailable destinations remain visible with a plain reason such as “Available after static assessment.” They are links only when a meaningful destination exists; otherwise they are noninteractive text with a lock icon and description. The current item uses `aria-current="page"`.

### 3.2 Mental model and terminology

User-facing language differs deliberately from canonical enum labels:

| Canonical concept | Default UI label | Technical detail |
|---|---|---|
| Run | Assessment | Run ID and revision |
| DRAFT | Setup | `DRAFT` |
| RESOLVING_TARGET | Preparing a safe copy | `RESOLVING_TARGET` |
| READY | Ready to begin | `READY` |
| EXECUTING | Assessment in progress | `EXECUTING` |
| WAITING_INPUT | Your input is needed | `WAITING_INPUT` |
| PAUSING | Pausing safely | `PAUSING` |
| PAUSED | Paused | `PAUSED` |
| RECOVERABLE_FAILURE | Action needed to continue | `RECOVERABLE_FAILURE` |
| VALIDATING | Checking the assessment package | `VALIDATING` |
| REVIEW_REQUIRED | Ready for review | `REVIEW_REQUIRED` |
| PACKAGING | Building the customer package | `PACKAGING` |
| COMPLETED | Complete | `COMPLETED` |
| FAILED | Could not complete | `FAILED` |
| CANCELLING | Stopping and cleaning up | `CANCELLING` |
| CANCELLED | Stopped | `CANCELLED` |
| Capability | Access needed for a task | Capability ID |
| Occurrence | Evidence record | Evidence occurrence ID |
| Domain coverage | Area checked | Domain ID and control counts |

Canonical values are shown in monospace only inside technical disclosures, exports, or copyable metadata rows.

## 4. Primary user flows

### 4.1 Start a safe assessment

```text
Assessments
  → Start assessment
  → Name the project and choose Codex or Claude Code
  → Choose repository source
      → SSH Git: explain access boundary, choose registered SSH handle, enter URL/ref
      → Local: choose registered source handle + relative path
          → clean tree: default commit-only
          → changed/untracked files detected:
              → assess commit only (recommended)
              → include a frozen working-tree copy (explicit approval)
  → Prepare safe copy
      → success: show full commit and snapshot identity
      → failure: show cause, safe next action, retry
  → Product context: answer or explicitly mark each of 10 topics unknown
  → Access and consent: review provider data flow, optional services, runtime/build access
  → Credentials, only if a selected capability requires them
  → Review a plain-language setup summary
  → Begin assessment
```

Rules:

- The source selection becomes immutable when target resolution begins. Changing it creates a new run/revision rather than silently replacing scope.
- “Commit only” explains that local changes will not be assessed and lists excluded dirty paths without reading their content into reports.
- “Frozen working-tree copy” requires a dedicated decision panel that states what additional files are included, how the snapshot is identified, and that the live source remains read-only.
- All ten discovery topics must be either answered or marked “I do not know yet.” Unknown requires a reason, confidence effect, coverage effect, and follow-up owner; the UI supplies plain prompts for these fields.
- The final review has separate sections for source identity, known product context, unknowns, provider data flow, approved network destinations, supplied credentials by handle/purpose only, and expected limitations.

### 4.2 Monitor and respond to a running assessment

```text
Run overview
  → Current phase + plain progress statement
  → phase finishes automatically
  → if input is needed:
      persistent banner + Overview task card
      → read what is needed and why
      → approve / deny / supply safe credential / keep blocked
      → assessment resumes or records limitation
  → if recoverable problem:
      Action-needed panel
      → see completed work preserved
      → select recommended recovery plan
      → resume selected attempts
  → if user pauses:
      explain checkpoint/cancellation behavior
      → Pausing safely
      → Paused; Resume assessment
  → if user cancels:
      typed confirmation
      → stopping, revoking secrets, destroying runtime, preserving admitted evidence
      → Stopped
```

The interface does not show a fabricated percent-complete because phase duration is nondeterministic. It shows “Phase 4 of 14” plus phase states and the sentence “Static security and quality checks are running.” Conditional phases still occupy the map and receive a resolution such as “Completed with runtime blocked.”

Closing the tab never implies cancellation. A persistent note says “This assessment continues locally if you close this page.” On reconnect, the event stream replays silently; focus remains where the user placed it.

### 4.3 Understand coverage without false confidence

```text
Coverage and limits
  → Plain summary: areas checked / partly checked / not checked
  → choose an area
  → read status + definition + business effect
  → inspect planned/reconciled control counts
  → inspect each non-pass reason
  → follow linked evidence or limitation
  → optionally rerun runtime gate before validation
```

Every status is spelled out:

- **Pass — check completed and met the stated condition**
- **Fail — check completed and found the stated condition was not met**
- **Partial — only the named subset was checked**
- **Blocked — a safety boundary, prerequisite, or authorization prevented the check**
- **Not applicable — the subject was confirmed absent**
- **Not tested — applicable work was omitted, not selected, or exhausted its safe budget**

“Pass” is never summarized as “safe,” and a domain with some passing controls is never represented as an overall pass unless the canonical domain coverage says so.

### 4.4 Trace a concern to evidence

```text
Findings
  → filter by business priority, technical severity, validation, or domain
  → finding detail begins with who may be affected and what could happen
  → evidence thread connects:
      finding → supporting evidence → source location → control → review
  → open safe preview
      → transformed text/image preview
      → preview limitation or truncation stated
  → download original as attachment, when allowed
```

The default sort is business priority, then technical severity, then title. It is explicitly labeled. Technical severity, business priority, confidence, and validation are four separate fields and are never merged into a single badge or numeric score.

### 4.5 Compare the three modernization paths

```text
Decision
  → recommendation in one sentence
  → confidence + why confidence is limited
  → compare remediation, incremental replacement, full rebuild
      across the same seven criteria
  → choose a criterion
      → read all three assessments side-by-side or stacked
      → follow evidence and claim provenance
  → inspect assumptions, dependencies, and reversal conditions
  → independent decision-review outcome
```

The recommended option uses the textual label “Recommended from current evidence” and a thicker outline; color alone never marks it. All alternatives retain equal content depth and are never dimmed. Conditional sequences are presented as ordered steps rather than forcing one option into a winner card.

### 4.6 Conduct technical and lay review

```text
Reviews
  → see deterministic validation and independent reviews first
  → Technical review
      → check material/security conclusions, simplification, evidence references
      → record each result and objections
  → Lay review
      → read the executive report in report order
      → answer comprehension prompts in the reviewer’s own words
      → mark passed / passed with objections / failed
  → failed or objected review
      → corrections create another assessment revision or return to execution
  → all required reviews pass
      → package becomes available
```

The lay review is not a perfunctory checkbox. It asks the reviewer to state, in free text: the principal risk, likely business effect, recommended path, strongest alternative, confidence, and most important unknown. Prompts are short and may be saved as a draft. The final verdict is a radio group with definitions.

### 4.7 Build, verify, and download the package

```text
Package
  → choose plain ZIP (always retained)
  → optionally add age X25519 wrapper
      → disclose that recipient public key is package metadata
  → build package
  → stage-by-stage validation record
  → validated
      → Download ZIP
      → Copy SHA-256 digest
      → Download detached digest
      → Download encrypted wrapper, if created
  → failed
      → show failed stage, preserved inputs, safe recovery
```

Scrypt protection is not offered as an enabled web control. The page explains that passphrase protection must be started through the protected launcher channel.

### 4.8 Delete or restore local data

```text
Assessment actions → Delete local assessment data
  → choose scope
  → list exactly what remains and what is removed
  → type project slug
  → if packages included, confirm package digests
  → move to recoverable trash
  → show purge date and Restore action
  → after purge: show irreversible completion record
```

Delete is unavailable for active runs. Cancel and delete remain separate concepts. The dialog never uses a generic “Are you sure?”; it names the scope, recovery period, package impact, and required confirmation.

## 5. Screen inventory and specifications

### 5.1 Session entry

**Purpose:** Exchange the one-time loopback token for a local session without exposing product content beforehand.

**Content:** Product name, “Local assessment workspace,” token status, short privacy statement (“This page is served from this computer on loopback”), and bootstrap error help.

**States:**

- Loading: static heading and “Starting your local session…” with no spinner-only indication.
- Success: route immediately to Assessments; announce “Local session started.”
- Expired/invalid token: error heading, exact recovery command category without exposing a token, “Return to the launcher and open the new link.”
- Server unavailable: connection troubleshooting and retry.

### 5.2 Assessments home

**Purpose:** Resume work or start a new assessment.

**Key elements:** Page heading, primary “Start assessment” button, system-readiness summary, active assessments first, then recent terminal assessments, state filter, project search, pagination.

Each row/card includes project, short commit, source kind, provider, human state, current task or completion time, revision, and one next action. A state marker includes an icon and label. Active rows use an ordered list/table depending width, not a dashboard grid.

**Empty:** “No assessments yet” plus a three-sentence explanation of what the kit produces and the start action.

**Error:** Inline retry; previously loaded rows remain visible and marked “May be out of date.”

### 5.3 New assessment — project and source

**Purpose:** Define project identity, provider, and immutable source input.

**Fields:** Project name/slug, engagement, provider radio cards, source-kind radio, registered source/SSH handle, repository URL or relative path, optional Git ref, local snapshot mode, selected assessment profiles, optional services.

Provider cards must state that the chosen provider receives selected repository context for inference, link to “Exactly what this means,” and avoid implying fully local processing.

URL and path fields are validated on blur and submit, not every keystroke. Errors appear next to the field and in a summary linked to each field. Source handles show friendly names; fingerprints live in details.

### 5.4 Target preparation

**Purpose:** Resolve source and establish immutable identity.

**Key elements:** Four-step ordered status: Access source; Resolve commit; Create read-only snapshot; Verify source unchanged. Current step has “In progress”; completed steps have words and timestamps.

On success, a definition list shows full commit SHA, snapshot digest, ref requested/resolved, local dirty-tree treatment, exclusions, and read-only integrity result. Full values can be copied with a button whose accessible name includes the field.

On failure, show what failed, whether anything changed (“No changes were made to the source”), safe retry action, and affected coverage.

### 5.5 Product context

**Purpose:** Capture the ten required discovery topics without pretending missing customer knowledge can be inferred from code.

**Layout:** Completion map at top (“6 answered, 4 unknown”), one topic per section, previous/next buttons, save status. On wide screens the topic list is a left in-page navigation; on narrow screens it becomes an ordered select-like navigation button opening a dialog list.

Each topic has:

- Plain question.
- “Why we ask” sentence.
- Radio: “I can answer” / “I do not know yet.”
- Answer textarea or unknown fields.
- Provenance choice where applicable: owner-stated, documented, observed, analytics-supported, code-inferred, unverified, conflicting.
- Source/owner note.

“Code-inferred” is disabled for owner/context topics that cannot be upgraded by inference, with explanation. “Conflicting” reveals two named claim fields. Textareas show a soft suggested length but never impose an artificially low character limit.

### 5.6 Access and consent

**Purpose:** Make network, provider, runtime, service, and credential boundaries understandable and auditable.

**Layout:** Consent ledger grouped into Required to operate, Optional deeper coverage, and Currently unavailable. Each decision card states:

1. Task in plain language.
2. Recipient/service and exact destination(s).
3. Data categories that may be sent.
4. Allowed methods and duration.
5. Credential handle/purpose, if any; never the value.
6. What approving enables.
7. What denying changes in coverage.
8. Radio choice “Approve this access” / “Do not approve.”

Cards are not accordions for the decision-critical text; all seven facts remain visible. Technical capability IDs and evidence are disclosed below. The save action summarizes changed approvals before submitting. Revocation uses a confirmation dialog and explains whether in-flight work stops or becomes blocked.

Optional hosted services are off by default and visually separated by a rule and heading. There is no “Approve all.” A global “Deny all optional access” is permissible because it narrows access and shows resulting coverage effects.

### 5.7 Safe credentials

**Purpose:** Supply only explicitly approved sandbox-safe values through the one-use secret channel.

**Content:** Purpose, recipient service, linked approval, expiry, “This value will not be shown again,” file/text upload control implemented as an accessible standard input, upload status, remaining uses, revoke.

Never place a credential in normal JSON fields, local storage, page URLs, logs, or a revealable password input. After upload, show only “Uploaded,” purpose, expiry, and one remaining use. Announce completion politely; do not echo value length or content.

### 5.8 Setup review

**Purpose:** Provide a comprehensible preflight before source analysis begins.

**Sections:** Source and immutable identity; provider/data flow; product context; unknowns; profiles; approved access; denied/unavailable capabilities; credentials by purpose; expected limitations; output location.

Each section has “Change” while the run is still `DRAFT`. The primary action is “Begin assessment.” A checked acknowledgment is required only for the authorization statement: “I am authorized to assess this repository and supplied only sandbox-safe credentials and endpoints.” It is not bundled with optional-service consent.

### 5.9 Assessment overview

**Purpose:** Answer current state, required next action, key known outcomes, and safe controls.

**Order:**

1. Breadcrumb and project/commit identity.
2. State heading and one-sentence interpretation.
3. Action-needed card, if present.
4. Current phase and 14-phase map.
5. Early-result summary: admitted findings, coverage limits, unresolved unknowns, without declaring conclusions before validation.
6. Recent activity.
7. Assessment controls: pause, cancel, create revision when eligible.

The phase map is an ordered list, not a progress bar. Each phase row contains number, name, status word, optional duration, and limitation count. Parallel work is represented as nested items within a phase. Current phase uses `aria-current="step"`.

### 5.10 Progress and activity

**Purpose:** Give operational detail without forcing the user to parse logs.

**Content:** Phase filter, event list grouped by date and phase, plain summaries, timestamps, and “Technical event details.” Events are paginated. Background additions do not reorder focused content or auto-scroll. A “New activity available” button appears if the user is not at the top.

The event stream connection state is visible but quiet: “Live updates connected,” “Reconnecting; work continues,” or “Updates paused; refresh.” Only state changes requiring action enter the assertive live region.

### 5.11 Recovery and waiting input

**Purpose:** Resolve a specific blocker with minimal ambiguity.

**Content:** What stopped, completed work preserved, safety boundary involved, effect on coverage, recommended next step, alternatives, and technical error details. Recovery plan radio options name attempts affected. “Continue with limitation” appears only when canonical workflow permits it.

Conflict/stale-row errors refetch current state and show “This assessment changed in another tab. Review the latest state before trying again.” User-entered form data is preserved where safe.

### 5.12 Coverage and limitations

**Purpose:** Provide honest coverage accounting.

**Summary:** Counts by exact six statuses in a textual list, plus “15 required areas accounted for.” Do not use a donut, gauge, traffic light, or percentage as the primary view.

**Area list:** Domain name, status word/icon, controls reconciled (“12 of 12”), limitation count, and a short reason. Filters are native checkboxes inside a fieldset and reflected in the URL. Default shows all.

**Area detail:** Definition of status, scope, controls, exclusions, unsupported ecosystems, evidence links, limitation links, and follow-up. “Rerun safe runtime check” is shown only before validation and includes its consequence.

### 5.13 Findings list

**Purpose:** Review discrete concerns without turning severity into spectacle.

**Desktop:** Semantic table with columns Concern, Business priority, Technical severity, Confidence, Validation, Evidence count. The concern cell includes title and one-sentence affected-party consequence. Rows contain a single title link; the whole row is not an inaccessible click target.

**Mobile:** Structured cards with the same labeled fields and DOM order.

**Controls:** Search, multi-select filter groups, sort control, active-filter summary, “Clear filters,” pagination, CSV download only from Package/exports rather than ad hoc unvalidated output.

**Empty:** Distinguish “No findings admitted yet,” “No findings match these filters,” and “No findings were reported; review coverage before interpreting this.”

### 5.14 Finding detail

**Purpose:** Explain the concern and make its support independently inspectable.

**Order:** Title; consequence; affected party; next action/remediation theme; four-field classification; description; evidence thread; affected locations; control mappings; validation/reviews; technical identifiers.

Paths wrap anywhere after `/` visually but remain copyable as one string. Line ranges are links only if a safe text preview exists. CVSS appears as imported or calculated data, not the headline.

Disputed or invalidated findings have a top-of-page notice that names the outcome and review evidence. The original finding remains readable for audit context.

### 5.15 Evidence library and evidence detail

**Purpose:** Inspect admitted, redacted, provenance-bearing records.

**Library:** Search, type/sensitivity/validation filters, paginated list, title/type, plain source description, validation, redaction state, linked claims/findings.

**Detail:** Evidence summary; provenance chain; collection time/tool/activity; source-relative location; sensitivity and redaction; derivations; links to claims, findings, controls, and reviews.

**Preview:** Safe transformed preview in a bordered region labeled “Safe preview.” Escaped text uses the regular text font unless content is intrinsically code; never interpret Markdown. Re-encoded images include alt text derived from an assessor description, dimensions, and a notice that metadata was removed. Truncation is announced before the preview with a download option when allowed. Attachment-only formats explain why inline preview is unavailable.

### 5.16 Decision

**Purpose:** Support a defensible choice among remediation, incremental replacement, and full rebuild.

**Top summary:** “Current recommendation,” recommendation or sequence, confidence, one-paragraph rationale, most important unknown, and link to independent review.

**Comparison:** Seven criterion sections. Within each, the same three option panels appear in the order remediation, incremental replacement, full rebuild. Each shows assessment, evidence state, confidence, and evidence links. On wide screens the three panels form columns; on narrow screens they stack but preserve equal prominence.

**Evidence thread:** Recommendation → criterion → claim → occurrence, with source labels. Provenance chips use full words and accessible descriptions.

**Footer sections:** Assumptions, dependencies, reversal conditions, alternatives, and “What the recommendation does not claim.”

### 5.17 Reviews

**Purpose:** Complete independent, deterministic, technical-human, and lay-human gates.

**Review map:** Ordered list with reviewer/type, state, outcome, objections, input digest, completion time. Required unfinished reviews are first.

**Technical review form:** Material conclusion checklist generated from canonical items; each has result radio, objection field if needed, and evidence selector. “Pass review” remains disabled until every item has a result, with a nearby text explanation.

**Lay review form:** Report reading order, comprehension prompts, issue-reporting field, item outcomes, final verdict. Technical identifiers are available but not injected into the reading task.

**Failed review:** Explains that packaging stays unavailable; provides “Return to assessment” or “Create corrected revision” according to state rules.

### 5.18 Package and integrity

**Purpose:** Build, validate, download, and verify the deliverable.

**Pre-package:** Review gate list, included inventory by category, screenshot presence/absence explanation, encryption options, storage estimate and headroom.

**In progress:** Nine ordered stages from admission complete through released. Each stage contains status word and certificate link if present. Avoid continuously animated spinners; use a static current marker and updated text.

**Validated:** Large “Package validated” heading, ZIP filename/size/digest, Download ZIP, Download digest, Copy digest, optional encrypted wrapper, and plain verification instructions.

**Failed:** Failed stage, human explanation, technical report link, whether staging or prior validated package remains safe, and allowed retry.

### 5.19 System readiness

**Purpose:** Show whether the local host can support static and dynamic assessment.

**Content:** Provider, host OS/architecture, static analyzer readiness, helper status, runtime VM readiness, browser readiness, storage headroom, and contract/profile versions. Each prerequisite has supported/attested/approved/effective states translated into one human outcome plus technical details.

The page leads with “Static assessment is available” or its blocker. Dynamic-runtime limitations are secondary and never make the entire system appear unusable if static work remains valid.

### 5.20 Data, retention, and deletion

**Purpose:** Make local storage and cleanup understandable.

**Content:** Generated run directories by friendly project identity, retention categories, package preservation, provider engagement homes, recoverable-trash jobs, purge dates, restore controls, and deletion initiation. Absolute host paths are never disclosed from unsafe API data; permitted product-relative paths are shown.

## 6. Component system

Use shadcn/ui composition and Radix primitives only when their semantics fit. Styling must extend one token set; no second component theme.

### 6.1 App shell

- **Header:** Product wordmark in text, “Local workspace” label, system-readiness link, Help, session menu.
- **Assessment rail:** `nav` landmark with text labels; collapses to a “Assessment sections” dialog trigger below 768px.
- **Main:** `main` with route-focused `h1`.
- **Context footer:** Kit version and “Runs only on this computer’s loopback interface.”
- State: loaded, disconnected, session-expired. Session expiry uses a blocking dialog only when a save/action cannot proceed.

### 6.2 Page header

Contains breadcrumb, `h1`, optional explanatory sentence (maximum 72 characters preferred), state line, and at most one primary action. Secondary actions live in an overflow menu labeled “More assessment actions”; pause remains visible when relevant, cancel/delete do not sit beside the primary action without separation.

### 6.3 Status marker

An inline composition of:

- 16px distinct icon/shape;
- visible status word;
- optional reason text;
- accessible name containing the status word.

Shapes:

- Pass/complete: check inside circle.
- Fail: × inside octagon.
- Partial: half-filled circle plus “Partial.”
- Blocked: horizontal bar inside octagon plus “Blocked.”
- Not applicable: outlined diamond plus “Not applicable.”
- Not tested: open circle plus “Not tested.”
- In progress: three horizontal dots inside circle plus “In progress,” static under reduced motion.
- Needs input: exclamation inside triangle plus “Your input is needed.”

Icons are decorative (`aria-hidden`) when adjacent text exists. Never rely on icon names alone.

### 6.4 Notice

Variants: information, success, caution, error, action needed. Every notice has a visible heading, icon/shape, left border style, and body. Error is not merely red; it uses an octagon icon and “Error” heading. `role="alert"` is reserved for new blocking errors or user-triggered failure, not static notices.

### 6.5 Task card

For one required operator action. Contains “Action needed,” task title, why, consequence if deferred/denied, primary action, and safe alternative. Only one task card is expanded on Overview; additional tasks form an ordered list.

States: ready, saving, accepted, denied, expired, superseded, error. Accepted state remains in the consent/activity record rather than disappearing.

### 6.6 Evidence thread

Semantic ordered list, visually connected by a 2px neutral rule. Each node has number, type label, title, provenance/status, short explanation, and link. Nested evidence uses a second indentation level, never more than two visual levels; deeper provenance is a definition list inside the node.

On 320px width the line stays at the left and content uses remaining width. Screen-reader output is an ordered list; connector lines and node numerals duplicated by list semantics are decorative.

### 6.7 Plain/technical disclosure

Use a `Collapsible` with button text “Show technical details” / “Hide technical details,” preserving `aria-expanded`. Default closed. Content begins with a heading and definition list, not an undifferentiated code dump. The preference is not globally sticky because some views contain sensitive context; within a route it may persist in memory.

### 6.8 Definition list

Preferred for label/value metadata. At narrow width labels sit above values; at 640px+ they use a 12rem label column. Values wrap without horizontal overflow. Copy buttons follow the value in DOM and have explicit names.

### 6.9 Data table

Use semantic `<table>`, `<caption>`, scoped headers, and `aria-sort`. Sticky headers only at 768px+, never sticky first columns. Tables are paginated, not infinitely scrolled or virtualized in the MVP. At widths below 640px, predesignated tables switch to labeled cards; do not put a horizontally scrolling table on primary flows. Machine-data tables that must retain columns may scroll inside a labeled region with keyboard focus, shadow-free overflow cue text (“Scroll horizontally for more columns”), and a list alternative.

States: loading skeleton with caption, loaded, filtered empty, true empty, error with retry, stale. Skeleton rows are `aria-hidden`; a single text node announces loading.

### 6.10 Filters

Search input plus disclosure groups of native checkboxes, an always-visible result count, active-filter chips with remove buttons, and “Clear filters.” On mobile a full-height dialog holds filters, but applying is not required to close; changes update results only after “Show N results” to reduce reflow.

### 6.11 Step map

Ordered list for wizard and phase progress. Wizard steps are links only to visited editable steps. Phase steps are not interactive unless they have a detail destination. `aria-current="step"` marks current. Complete, current, blocked, and future each include a word.

### 6.12 Form controls

- Minimum control height 44px; primary touch targets 48px.
- Visible label above control; required/optional in text.
- Hint before error in DOM.
- Error uses `aria-describedby` and appears after the field; error summary at form top links to invalid controls.
- Radio/checkbox labels are at least 44px tall and clickable.
- Textareas default to 6 lines and can resize vertically.
- No placeholder-only labels, masked format requirements, or auto-advance.
- Save status reads “Saved at 14:32,” “Saving…,” or “Could not save; your text remains here.”

### 6.13 Dialog

Radix Dialog with focus trap, visible title/description, Escape to close except during the atomic instant of submission, and focus returned to trigger. Confirmation action text names the operation: “Stop assessment,” “Revoke this access,” “Move data to trash.” Destructive actions use a separate footer group and never default focus.

### 6.14 Toast/live message

Use toast only for noncritical confirmations such as “Digest copied.” Persistent errors and action-needed states render in the page. Toast duration is at least 8 seconds and pausable on hover/focus; status is also reflected in page state. Never place the only undo action in a toast.

### 6.15 Code/path block

Monospace at 15px/22px, neutral surface, 1px border, `overflow-wrap:anywhere` for single paths/hashes. Multi-line output may scroll vertically within bounded height, never hijacks arrow keys, and includes “Copy” plus a visible label. Do not syntax-highlight with color alone.

### 6.16 Report preview link

The authenticated UI never embeds or opens shipped HTML inline. A report item offers “Download HTML,” “Download Markdown,” and when a safe text projection exists, “Read plain-text preview.” Help text states that HTML downloads as an attachment.

## 7. State model across the interface

Every route and component must specify these baseline states:

| State | Required behavior |
|---|---|
| Initial loading | Stable page heading; one plain loading sentence; no focus movement; skeleton only for expected geometry |
| Incremental loading | Keep existing content; mark it “Updating”; do not blank the page |
| Empty | State exactly whether data does not exist yet, no filter matches, or zero items were found after completed coverage |
| Success | Update canonical content; polite announcement for user-triggered action |
| Validation error | Summary plus linked field errors; preserve entries and focus first error only after submit |
| Recoverable system error | Human cause, preserved work, retry action, technical details, coverage effect |
| Nonrecoverable error | What completed, what did not, safe next step, request ID in details |
| Disabled | Control remains readable with adjacent reason; `aria-disabled` only when behavior is intentionally interceptable, otherwise native `disabled` |
| Stale/conflict | Refetch, explain cross-tab change, preserve safe draft, require review before resubmit |
| Offline/SSE disconnected | Explain that local work continues; retry connection; never imply assessment stopped |
| Permission denied | Record the decision, state coverage effect, offer change only while workflow permits |

## 8. Visual language

### 8.1 Character

The visual style is editorial and evidence-led: warm off-white canvas, white reading sheets, deep evergreen actions, blue focus, strong charcoal type, fine gray-green rules, and sparing semantic tints. Corners are modest rather than pill-heavy. Important content is organized with headings, rules, whitespace, and numbered threads—not a collection of floating cards.

No gradients, translucent layers, background illustrations, oversized numerals used as decoration, glowing status colors, or animated charts. The product wordmark is text only: **Repository Assessment Kit** with a 2px vertical evergreen rule before “Assessment Kit.”

### 8.2 Color tokens

All ratios below are calculated against the named default background.

| Token / shadcn mapping | Hex | Use | Contrast |
|---|---:|---|---:|
| `--background` / `canvas` | `#F7F7F5` | App canvas | — |
| `--card`, `--popover` / `surface` | `#FFFFFF` | Reading surfaces, fields | — |
| `--foreground`, `--card-foreground` / `ink` | `#17201B` | Main text | 15.55:1 on canvas; 16.68:1 on surface |
| `--muted` | `#EEF1EF` | Quiet panels and row hover | — |
| `--muted-foreground` | `#4B5750` | Secondary text | 7.56:1 on surface |
| `--border`, `--input` | `#CCD4CF` | Rules and field borders | Non-text; pair with structure |
| `--primary` | `#124E3A` | Primary action, selected rule | 9.65:1 with white text |
| `--primary-foreground` | `#FFFFFF` | Text on primary | 9.65:1 |
| `--accent` | `#E4EFEA` | Selected/hover surface | Ink text: greater than 12:1 |
| `--accent-foreground` | `#17201B` | Text on accent | Greater than 12:1 |
| `--ring` / `focus` | `#005FCC` | Focus outline and links | 5.98:1 on white |
| `link` | `#005FCC` | Underlined links | 5.98:1 on white |
| `positive-ink` | `#176B45` | Positive icon/text | 6.51:1 on white |
| `positive-bg` | `#E8F5ED` | Positive notice | Ink text remains primary |
| `caution-ink` | `#7A5100` | Caution icon/text | 6.36:1 on `#FFF4D1` |
| `caution-bg` | `#FFF4D1` | Caution notice | Main ink: 15.18:1 |
| `danger-ink`, `--destructive` | `#A52929` | Destructive action/error | 6.15:1 on `#FDEAEA` |
| `danger-bg` | `#FDEAEA` | Error notice | Main ink: 14.40:1 |
| `info-ink` | `#1B5C73` | Informational icon/text | 6.75:1 on `#EAF6FA` |
| `info-bg` | `#EAF6FA` | Informational notice | Main ink: 15.14:1 |

Severity and business priority use these same semantic surfaces but always retain full labels. “Critical” may use danger ink with an octagon; “High” uses dark amber with triangle; “Medium” uses blue with square; “Low” uses neutral ink with circle; “Informational” uses neutral ink with open circle. Confidence uses High/Medium/Low text with three/two/one short bars whose accessible name contains the word.

Forced-colors mode:

- Use system colors `Canvas`, `CanvasText`, `LinkText`, `ButtonText`, `ButtonFace`, `Highlight`, and `HighlightText`.
- Preserve status icons with `forced-color-adjust:auto`.
- Add border or underline for selected/current states.
- Do not suppress native focus indicators.

Dark mode is not an MVP requirement. Respecting system dark preference without a fully tested token set is worse than a stable, high-contrast light reading surface. A future dark theme must independently pass contrast and report-print requirements.

### 8.3 Spacing

Base unit: 4px.

| Token | Value | Use |
|---|---:|---|
| `space-1` | 4px | Icon/text micro-gap |
| `space-2` | 8px | Related inline items |
| `space-3` | 12px | Label to control, compact row |
| `space-4` | 16px | Standard component padding |
| `space-5` | 20px | Form-group separation |
| `space-6` | 24px | Card padding, paragraph group |
| `space-8` | 32px | Section subgroups |
| `space-10` | 40px | Major form sections |
| `space-12` | 48px | Page-section separation |
| `space-16` | 64px | Report major sections |

Page gutters use `clamp(16px, 3vw, 40px)`. Reading content maxes at 72rem; narrative columns at 66ch. Section rhythm is heading → 12px → supporting intro → 24px → content → 40px to next peer section.

### 8.4 Radius, borders, and elevation

- `radius-sm`: 4px for chips and code.
- `radius-md`: 8px for inputs, buttons, notices, rows.
- `radius-lg`: 12px for dialogs and major sheets.
- Do not use fully pill-shaped containers except compact removable filter chips.
- Default border: 1px solid border token.
- Selected/current: 2px primary rule or inset rule, with layout compensated to avoid shift.
- Reading sheets use `0 1px 2px rgb(23 32 27 / 0.08)`.
- Dialogs use `0 18px 48px rgb(23 32 27 / 0.18)`.
- No elevation communicates status or clickability by itself.

### 8.5 Iconography

Use one outline icon set already compatible with shadcn conventions, 1.75px stroke, rounded line joins, at 16/20/24px. Icons support text; unlabeled icon buttons are limited to universally understood actions such as close and still require accessible names and tooltips. Repository, shield, lock, eye, and warning imagery must not imply safety or approval without words.

### 8.6 Motion

- Duration fast: 100ms; standard: 160ms; deliberate disclosure/dialog: 220ms.
- Easing: `cubic-bezier(0.2, 0, 0, 1)`.
- Animate opacity and small transforms only; maximum translation 4px.
- No pulsing statuses, spinning full-page loaders, parallax, count-up numbers, or auto-scrolling.
- Progress updates change text without animation.
- Under `prefers-reduced-motion: reduce`, set transitions/animations to effectively 0ms and never use smooth scrolling.

## 9. Typography

### 9.1 Families

Use local system fonts only:

```css
--font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", sans-serif;
--font-mono: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
```

This prevents external font requests and preserves native glyph quality. Do not use all caps for headings or status. Acronyms are expanded on first use in customer-facing content.

### 9.2 Type tokens

The scale is approximately 1.2 with optical adjustments:

| Token | Size / line height | Weight | Use |
|---|---|---:|---|
| `type-caption` | 14px / 20px | 500 | Timestamps, source notes; never core instructions |
| `type-small` | 16px / 24px | 400 | Secondary UI, table metadata |
| `type-body` | `clamp(17px, 16.5px + 0.15vw, 18px)` / 1.56 | 400 | Default prose and form controls |
| `type-body-strong` | same / 1.56 | 650 | Emphasis |
| `type-label` | 16px / 22px | 650 | Field and metadata labels |
| `type-h4` | 20px / 28px | 650 | Card/section subhead |
| `type-h3` | `clamp(22px, 20px + 0.5vw, 26px)` / 1.28 | 650 | Subsection |
| `type-h2` | `clamp(26px, 23px + 0.9vw, 34px)` / 1.2 | 700 | Major section |
| `type-h1` | `clamp(30px, 25px + 1.5vw, 42px)` / 1.14 | 720 | Page title |
| `type-display` | `clamp(34px, 28px + 2vw, 48px)` / 1.1 | 720 | Report title only |
| `type-code` | 15px / 22px | 400 | IDs, paths, snippets |

If variable weights are unavailable, map 650/720 to 600/700. Letter spacing is normal for body, `-0.01em` for H2/H1/display, and `0.01em` for labels. Never reduce body below 16px at any viewport.

### 9.3 Measure and rhythm

- Default prose: 58–66ch; ideal 62ch.
- Executive report narrative: 52–62ch.
- Technical narrative: up to 75ch.
- Form hint/error: up to 60ch.
- Tables: column-specific, never justified text.
- Paragraph margin: 0 0 1em.
- List item gap: 0.5em; nested list indent at least 1.5em.
- Heading top margins in flowing reports: H2 2.25em, H3 1.75em, H4 1.4em; bottom margin 0.65em.
- Avoid more than three consecutive text styles in one region.
- Bold is for labels and short emphasis, not entire explanatory paragraphs.

## 10. Responsive and adaptive behavior

### 10.1 Breakpoints

Tailwind screens:

- Base: 320–479px.
- `xs`: 480px.
- `sm`: 640px.
- `md`: 768px.
- `lg`: 1024px.
- `xl`: 1280px.

Use container queries for content modules at 36rem and 56rem so findings, decision comparisons, and evidence threads respond to their actual column width. Test at 320, 360, 390, 768, 1024, 1280, 1440px and at 200% browser zoom with a 1280px viewport. No primary flow may create page-level horizontal overflow.

### 10.2 Global shell reflow

- **320–767:** Header wraps to two rows if needed. Assessment rail becomes a dialog trigger. Main is one column with 16px minimum gutter. Breadcrumb may wrap; never horizontally scroll. Primary action is full-width only when its label still reads naturally. Secondary actions move below the heading or into menu.
- **768–1023:** 224px assessment rail + fluid main. Rail can be collapsed by the user; preference stored locally without containing sensitive data.
- **1024+:** 256px rail + main up to 72rem; optional 18rem context panel only on Overview/Decision when it does not reduce narrative below 50ch.

### 10.3 Per-screen reflow

- **Assessments home:** Semantic table at 768+; labeled cards below. Search and filter stack at 320, share a row at 640+.
- **Wizard/project source:** One column through 767; at 768+ form remains a 42rem column with step map in a 14rem adjacent rail. Never stretch fields across full desktop.
- **Product context:** Topic navigation above content below 768; left in-page nav at 768+. Textarea always full content-column width.
- **Consent ledger:** One column at all widths. At 1024+, facts use a two-column definition layout inside each card, but decision controls remain a full-width footer. Never place multiple consent decisions side-by-side.
- **Overview:** One column through 1023; at 1024+ main phase map 2fr and recent activity 1fr. Action-needed card remains first and spans full width.
- **Progress:** Filters above list below 768; compact filter rail at 768+. Event detail never forms a third column.
- **Coverage:** Domain cards/list below 768; table-like rows above. Status summary stays a text list; may use two columns at 640+.
- **Findings:** Cards below 640; table 640+. At 640–767 hide evidence-count column into row details, not content. At 200% zoom use cards based on container width.
- **Finding detail:** One narrative column below 1024. At 1024+ classification definition list sits in a 16rem side panel after the title; evidence thread remains in main. Side panel returns into DOM order after consequence on narrow screens.
- **Evidence preview:** Text fills available column and wraps. Image uses `max-width:100%; height:auto`. Metadata is one-column below 640, two-column definition list above.
- **Decision:** Options stack in identical order below container 56rem. At 56rem+ three equal columns, with row-aligned labels where possible. Criterion heading and explanation span all columns. At 320 each option title precedes its status/confidence so no comparison fact depends on column position.
- **Reviews:** Review map above form below 1024; 18rem map rail and fluid form above.
- **Package:** Validation stages remain a vertical ordered list at all widths; artifact metadata becomes two columns at 768+. Download actions stack at 320 and wrap at larger widths.
- **Dialog:** `width:min(calc(100vw - 32px), 40rem)`; destructive/deletion dialog may reach 48rem. At height below 600px, title/footer remain visible and body scrolls; focus is never obscured.

### 10.4 Long and translated content

- Layout must tolerate 200% label expansion without clipping.
- Buttons grow vertically; do not enforce single-line text.
- Use logical properties (`margin-inline`, `padding-inline`) and design DOM order ready for future right-to-left support, though localization is not an MVP requirement.
- Hashes/paths use `overflow-wrap:anywhere`; data values never force page overflow.
- Never truncate critical statuses, reasons, project names, or action labels. Ellipsis is allowed only in repeated list summaries with the full value adjacent via accessible text and on the detail page.

## 11. Accessibility requirements

### 11.1 Standards and testing target

- Meet WCAG 2.2 Level AA for the app and static HTML reports.
- Default body and secondary text aim for AAA contrast.
- Test with keyboard only, Windows High Contrast/forced colors, 200% and 400% zoom, `prefers-reduced-motion`, screen readers (NVDA + Firefox/Chrome, VoiceOver + Safari), and touch at 320px width.
- Run automated axe checks on every routed view and representative error/loading/modal state; automated results never replace manual review.

### 11.2 Structure and navigation

- One `h1` per route; headings never skip levels for appearance.
- Landmarks: header, primary nav, assessment nav, main, and footer where present.
- First focusable element is “Skip to main content”; assessment pages add “Skip to assessment navigation” and long report views add “Skip to recommendation.”
- On route navigation, move focus to `h1` with `tabindex="-1"` and announce the title. Do not move focus for background SSE updates.
- Breadcrumb is a labeled navigation list.
- Back/forward navigation preserves filter state and expected focus target.

### 11.3 Keyboard and focus

- Every operation is possible by keyboard; no drag-only, hover-only, or gesture-only controls.
- Focus order follows DOM and reading order.
- Focus indicator: 3px solid focus token with 2px offset; on dark primary, use a 2px white inner plus 3px blue outer ring.
- Never remove outline without equivalent visible focus.
- Radix menus, tabs, radios, dialogs, and disclosures retain documented keyboard interaction. Do not place interactive controls inside links.
- Escape closes nonblocking overlays; closing restores focus to the trigger.
- Sticky headers cannot cover focused controls; use `scroll-margin-top`.

### 11.4 Screen-reader behavior

- Status updates requiring action use one assertive live region. Routine progress, save confirmations, and filter result counts use polite regions.
- Do not announce every streamed event or timer tick.
- Loading uses `aria-busy` on the updating region plus one text status.
- Status icons are hidden when their text label is present.
- Tables include captions; sortable headers expose sort direction.
- Phase maps and evidence threads are ordered lists.
- Provenance, confidence, and severity chips include their category in the accessible name, e.g. “Confidence: medium.”
- Copy button feedback announces “Full commit SHA copied,” not merely “Copied.”

### 11.5 Forms and errors

- Use native inputs wherever possible.
- Every input has a programmatic label and text instructions before the control.
- Required state uses both text and HTML required semantics where valid.
- Error summary receives focus only after a failed submit and links to fields.
- Do not clear fields after error, session refresh, or stale update.
- Timeouts/expiries are disclosed early, can be extended when policy permits, and never rely on a moving visual countdown alone.
- Consent radios never default to approval. Returning to an already recorded approval shows the saved choice and audit metadata, clearly identified as existing state.

### 11.6 Touch, motor, and cognitive access

- Minimum pointer target 44×44 CSS px; primary/critical actions 48px tall.
- Space between adjacent destructive and safe actions is at least 16px.
- No double-click, long-press, precision drag, or time-limited reading.
- Use short sentences, specific verbs, and one concept per paragraph.
- Instructions remain visible during completion; do not hide them in tooltips.
- Wizard autosave and a persistent completion map let users stop and resume.
- Confirmation dialogs describe consequences in bullets and use action-specific labels.

### 11.7 Color, graphics, and data

- No status, severity, confidence, validation, selection, or chart value is conveyed by color alone.
- If a summary graphic is later added, it must be secondary to a full text/table representation, use patterns/shapes, and have an equivalent accessible description.
- Evidence images require authored alt text or are marked decorative if they add nothing beyond nearby text. Screenshots with dense application content need a concise purpose alt plus adjacent long description/evidence transcript.
- Do not put essential explanatory text inside images.

### 11.8 Static report accessibility

- Semantic HTML5 landmarks, heading hierarchy, lists, tables with captions/scopes, and descriptive internal links.
- A visible skip link and a linked table of contents.
- `lang="en"` on the document and language changes marked if introduced.
- Title includes project and report kind.
- No JavaScript; all disclosures must be visible in the static report. Technical appendices use linked sections rather than interactive accordions.
- Print retains headings, status words, link destinations where useful, table header repetition, and avoids splitting finding summaries across pages.
- Markdown report follows the same heading order and does not use raw HTML for layout.

### 11.9 Verification checklist

QA must verify:

1. Complete new-assessment flow at 320px and 200% zoom with no horizontal page scroll.
2. Complete flow without pointer, including consent, safe credential upload, review, package, and deletion restore.
3. Screen-reader navigation through the phase map, coverage table, finding evidence thread, decision comparison, and review form.
4. All six coverage statuses distinguishable in grayscale and forced-colors mode.
5. SSE reconnect adds no unexpected focus change or repeated announcements.
6. Every dialog returns focus and every failed submit focuses a useful error summary.
7. Report heading outline, TOC, table semantics, link purpose, print flow, and contrast.
8. Reduced motion removes all nonessential transition and progress animation.
9. Approval is never preselected and every recorded approval exposes scope, destination, data, expiry, and coverage effect.
10. Evidence preview never interprets target HTML/Markdown and attachment-only content never opens in the privileged origin.

## 12. Content and voice

### 12.1 Voice

Calm, exact, and candid. Use ordinary words without sounding childish. The product acts as a careful facilitator, not an omniscient auditor.

Write:

- “We could not run browser checks because the safe runtime was unavailable.”
- “Static checks still completed. This limits confidence in login and session behavior.”
- “The current evidence supports incremental replacement, with medium confidence.”
- “This finding has not yet been independently reviewed.”

Do not write:

- “Runtime gate failure.”
- “Security score: 82.”
- “Your repository is safe.”
- “Compliant with ASVS.”
- “AI determined…”
- “Simply approve access to continue.”

### 12.2 Preferred vocabulary

| Prefer | Avoid or define |
|---|---|
| assessment | scan, audit, pentest |
| area checked | domain coverage |
| safe copy | snapshot, unless in technical details |
| supporting record | occurrence |
| source and confidence | provenance |
| could not be checked | negative silence |
| current evidence suggests | proves, guarantees |
| customer-confirmed | applicable |
| technical severity | risk score |
| business priority | impact score |
| stop assessment | kill job |
| prepare customer package | export pipeline |

When an acronym is necessary, expand it at first use: “Software Bill of Materials (SBOM).”

### 12.3 Microcopy patterns

**Action label:** verb + object: “Prepare safe copy,” “Begin assessment,” “Review limitation,” “Download validated ZIP.”

**Error pattern:**

1. What happened.
2. What was preserved or unchanged.
3. What the user can do.
4. Coverage effect.

Example: “The safe copy could not be created because the Git reference was not found. Your source was not changed. Check the reference and try again. No assessment work has started.”

**Unknown pattern:** “We do not know [fact]. This lowers confidence in [decision area]. Ask [owner] for [specific follow-up].”

**Consent pattern:** “Approve [recipient] to receive [data] for [purpose] until [expiry]. If you do not approve, [coverage effect].”

**Status pattern:** “[Status word] — [definition in this context].”

### 12.4 Readability rules

- Executive and setup content targets US grade 8–9 reading level.
- Average sentence target below 22 words; no hard automated rejection solely by grade score.
- Paragraphs usually 2–4 sentences.
- Use active voice and name the actor: “The kit checked…” rather than “It was checked.”
- Framework IDs, schema versions, hashes, and command terms stay out of the main narrative.
- Do not anthropomorphize the provider or imply a model personally verified an outcome.
- Prohibited claims: “secure,” “no vulnerabilities,” “compliant,” “certified,” or legal applicability unless the qualified context explicitly negates such a claim.

## 13. Customer report design

### 13.1 Report family and shared navigation

The package contains a static index plus executive, decision, technical, security, and coverage/limitations reports in HTML and Markdown. All use the same release-owned CSS and semantic structure.

`index.html` is a reading guide, not a dashboard. It contains:

1. Project, assessed commit/snapshot, date, and package validation state.
2. “Start here” link to Executive report.
3. Five report descriptions framed by audience and question answered.
4. Package integrity and digest.
5. Evidence/provenance legend.
6. Coverage-status definitions.
7. Explicit note that technical coverage is not certification or proof of security.

Every report includes:

- Skip link.
- Report title and one-sentence purpose.
- Scope strip: project, exact commit short form with full form in metadata, assessment date, provider, report version.
- Table of contents.
- “How to read this report.”
- Main content.
- Limitations and prohibited-claim note.
- Links to related package-relative reports/evidence only.
- Footer with package digest and generation timestamp.

### 13.2 Executive report

Target length: 5–8 printed pages before appendices; body measure 58ch.

Order:

1. **Decision at a glance** — recommendation, confidence, principal reason.
2. **What was assessed** — scope and exact source identity in plain terms.
3. **What matters most** — three to five principal issues, each with affected party, business consequence, next action, evidence strength, and limit.
4. **What is working or recoverable** — evidenced strengths, not reassurance.
5. **The three paths** — concise equal-format comparison.
6. **Important unknowns and limits** — above methodology.
7. **What would change the recommendation.**
8. **Next decision for the owner.**

Do not use a composite score, severity pie, risk heat map, decorative KPI row, or “red/amber/green” summary. A short text count such as “4 high-priority concerns; 3 areas partly checked; runtime blocked” is allowed when all terms link to definitions.

### 13.3 Decision report

Order:

1. Recommendation and confidence.
2. Conditional sequence, if applicable.
3. Seven criteria, each comparing the same three options.
4. Critical feature-parity obligations.
5. Assumptions and dependencies.
6. Reversal conditions.
7. Independent review outcome.
8. Evidence index.

Comparison uses three equal panels on screen and stacked sections in print if columns would reduce measure below 38ch. The recommended option has the words “Recommended from current evidence”; other paths are not visually suppressed.

### 13.4 Technical report

Order:

1. Scope and method.
2. Repository composition and stack.
3. Architecture and boundaries.
4. Engineering maintainability.
5. Features/use-case traceability.
6. Runtime readiness and dynamic observations.
7. Finding index.
8. Tool and standards locks.
9. Evidence and validation method.
10. Technical limitations.

Technical tables use repeating headers, short cells, and linked detailed sections. Paths and hashes wrap. Raw tool output is evidence, not pasted wholesale into narrative.

### 13.5 Security report

Order:

1. Plain security summary and boundaries.
2. Baseline/profile selection and applicability state.
3. Material findings by business priority, with technical severity separately.
4. Static technique coverage.
5. Runtime security coverage and blocked/not-tested reasons.
6. Secret-detection handling statement that never exposes matched values.
7. Independent security review.
8. Framework mapping with a prominent “technical coverage, not certification” statement.
9. Security limitations and follow-up profiles requiring customer confirmation.

Critical/high finding summaries must contain consequence, affected party, next action, evidence strength, and limits.

### 13.6 Coverage and limitations report

This report is intentionally plain and prominent, not an appendix:

1. How to interpret six statuses.
2. All 15 required areas, each with status and reconciled/planned controls.
3. All partial, blocked, not applicable, and not tested reasons.
4. Unsupported ecosystems and exclusions.
5. Product-context unknowns and decision impact.
6. Runtime-capability attempted steps and safety boundaries.
7. Screenshot presence/absence explanation.
8. Follow-up owner and action for each material limitation.

The status list and tables include words and symbols; print remains understandable in black and white.

### 13.7 Evidence links and footnotes

Human reports use short evidence labels such as `Evidence 12` with descriptive link text: “Evidence 12: authentication middleware location.” IDs, digests, provenance, collection activity, redaction, and source-relative location appear in the evidence record. Avoid bare URLs and bare IDs.

When a claim is owner-stated, documented, observed, analytics-supported, code-inferred, unverified, or conflicting, the full provenance word appears at first mention and in the evidence note. Conflicts name both positions.

### 13.8 Print and offline behavior

- Page size defaults to system settings; margins at least 16mm.
- Use black text on white in print; semantic tints become light gray plus borders/patterns.
- Repeat table headers and avoid orphan headings.
- Keep a finding’s title, consequence, status, and first evidence reference together where possible.
- Expand link destination text only for declared package-relative links; do not print unsafe/external URLs.
- Hide purely navigational skip links in print, but preserve report title, TOC, scope, status definitions, and digest.
- No content depends on hover, disclosure, scripts, external fonts, external CSS, SVG, or online access.

## 14. Acceptance criteria for frontend and QA

The implementation is acceptable when:

1. A first-time nontechnical operator can start an assessment while correctly identifying which data may reach the selected provider and optional services.
2. All ten discovery topics are answered or explicitly unknown with confidence/coverage effects and follow-up owners.
3. No optional access is preapproved, no “approve all” shortcut exists, and the consent ledger exposes exact scope and revocation state.
4. The complete primary flow works with keyboard and screen reader, at 320px, and at 200% zoom without page-level horizontal scrolling.
5. All six coverage statuses remain distinct without color and include their contextual definitions.
6. The interface never presents a composite repository/security score or implies that passing checks proves safety.
7. Finding detail keeps business priority, technical severity, confidence, and validation separate and traces to safe evidence.
8. Raw target-derived active content never renders inline; safe previews are labeled transformations and attachment-only content downloads safely.
9. Background progress never steals focus, auto-scrolls, or floods screen-reader announcements.
10. Pause, cancel, recovery, revision, package, deletion, and restore explain exact effects and preserve the architecture’s state boundaries.
11. Decision comparison gives all three options equal criterion depth and visibly states confidence, assumptions, dependencies, and reversal conditions.
12. Technical and lay review forms record item-level outcomes; failed gates keep package creation unavailable with an explanation.
13. Static HTML and Markdown reports are coherent, semantically navigable, printable, locally self-contained, and understandable without the app.
14. A lay reviewer can state the principal risks, business consequences, recommendation, strongest alternative, confidence, and key unknown after reading the executive report.
15. A technical reviewer can follow every material conclusion to a claim and admitted evidence record without guessing.

## 15. Implementation notes for the frontend engineer

- Map the color tokens to shadcn CSS custom properties once; use semantic Tailwind utilities rather than hard-coded component colors.
- Preserve Radix accessibility behavior; restyle visuals without replacing keyboard semantics.
- Generate route types and API clients from the frozen OpenAPI contract.
- Treat server DTOs as canonical and background events as prompts to refetch; do not infer completion from event prose.
- Keep unsaved long-form discovery drafts in component/session memory only as needed; do not persist sensitive data in browser local storage.
- Persist only nonsensitive UI preferences locally: collapsed rail, items per page, and optional technical-detail display within a session.
- Use pagination instead of virtualization for findings, evidence, controls, events, and runs so semantic navigation remains reliable.
- Implement the app with real HTML controls and links before applying visual styling; never simulate buttons with `div`.
- Build representative story/test states for every component in Section 7, all run states, all six coverage statuses, all approval outcomes, truncated/unavailable evidence preview, stale row, disconnected stream, failed review, failed package stage, trashed deletion, and restored deletion.


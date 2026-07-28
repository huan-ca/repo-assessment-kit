# Repository Assessment Kit — UX and Visual Design Specification

**Contender:** 2 — The Evidence Desk  
**Status:** design contender; implementation-ready  
**Platform:** local web application, React 19.2 + Vite 8, Tailwind CSS 4, shadcn/ui with Radix primitives  
**Architecture contract:** `rak-contract/1.0.0`, `rak-workflow/1.0.0`, `rak-export-profile/1.0.0`  
**Primary viewport range:** 320px–1920px; optimized for laptop operation at 1280–1600px  

## 1. Experience thesis

Repository Assessment Kit should feel like a careful assessment desk, not a scanner
dashboard. The surface is quiet and editorial: one active question, a visible chain from
claim to finding to evidence, and no decorative score that can make incomplete work look
conclusive.

The product has three levels of truth:

1. **Orientation:** What is happening? Is the run safe and healthy? What needs me next?
2. **Interpretation:** What did we learn, what could it mean for the business, and how do
   the three modernization choices compare?
3. **Proof:** Where did each material statement come from, how strong is it, and what was
   not tested?

The interface shows level 1 by default, level 2 on the relevant workspaces, and level 3 in
an inspector. This is progressive disclosure by task, not by hiding caveats. Limitations,
unknowns, and evidence state stay visible at every level where they affect a conclusion.

### Design signature: the trace rail

Any material claim, finding, or decision factor carries a slim vertical **trace rail** at
its left edge. Small numbered nodes on the rail connect:

```text
Claim / test result  →  Interpretation  →  Decision effect
        E-014, E-029     Finding F-07      “weakens rebuild confidence”
```

On screen, rail nodes are interactive text buttons such as `2 sources`; in reports they
are static references such as `[E-014, E-029]`. The rail makes provenance recognizable
without forcing raw IDs into every sentence. It is not a graph visualization and never
implies causality beyond explicit links in the canonical data.

## 2. Users and design principles

### 2.1 Operator

The operator needs to start safely, understand preconditions, recover from failure, and
know exactly when a package is ready. They may understand Docker and Git but should not
need to understand the RAK lifecycle.

### 2.2 Consultant / assessor

The consultant needs dense, defensible information: coverage, provenance, conflicts,
independent review, and decision criteria. They should reach technical detail quickly
without making that density the default for the customer.

### 2.3 Customer software owner

The owner needs plain language, business effects, meaningful unknowns, and a fair
comparison of remediation, incremental replacement, and rebuild. They should never have
to interpret a severity code or infer whether a claim came from an owner, code, or a live
test.

### 2.4 Principles

1. **Show the boundary before the button.** Before target resolution, runtime approval,
   optional-service use, or packaging, state what data moves, where it goes, and what will
   not happen. This serves operators who must avoid production access and accidental
   source modification.
2. **Absence of evidence is visible, never visually neutral.** Blocked, partial, not
   applicable, and not tested results use distinct labels with reasons. A clean-looking
   empty area never stands in for coverage.
3. **Start with consequence; keep proof one step away.** Lay summaries state affected
   people, business effect, and next action. A consistent evidence inspector gives
   consultants the exact source, capture method, redaction, and validation state.
4. **One decision, three fair columns.** Remediation, incremental replacement, and full
   rebuild are always evaluated against the same seven criteria. The recommendation is
   emphasized only after the alternatives and reversal conditions are visible.
5. **State changes must be boring and recoverable.** Long-running activity has a stable
   timeline, last update, current attempt, and explicit pause/cancel/retry semantics.
   Browser disconnection never looks like run failure.
6. **Customer readiness is a review state, not a visual polish state.** A package can look
   complete while remaining blocked by evidence, redaction, technical, or lay review.
   The UI names the failed gate and required action.

## 3. Information architecture

### 3.1 Product-level navigation

The application is local and single-operator. The persistent product navigation contains:

- **Runs** — default home; current and prior assessments.
- **System readiness** — launcher/provider, host, architecture, prerequisite attestations.
- **About this kit** — versioned profiles, local/external data-flow explanation, status
  glossary, and package-integrity explanation.

There is no global cross-run analytics dashboard in MVP.

### 3.2 Run-level navigation

Once a run exists, use a left navigation rail on `lg` and above:

1. **Overview**
2. **Context**
3. **Coverage**
4. **Findings**
5. **Evidence**
6. **Decision**
7. **Reviews & package**

The rail has a compact run identity block above it:

```text
ACME Portal
9f3c71b2… · revision 1
[Assessment running]
```

Run state does not change the route inventory. Unavailable sections remain navigable and
show an honest “not available yet” state with the phase that produces them. Disabled
navigation is reserved for a run that has not resolved a target at all.

### 3.3 Route model

```text
/
/system
/about
/runs/new
/runs/:runId/overview
/runs/:runId/context
/runs/:runId/coverage
/runs/:runId/findings
/runs/:runId/findings/:findingId
/runs/:runId/evidence
/runs/:runId/evidence/:evidenceId
/runs/:runId/decision
/runs/:runId/review
```

Use route-based detail views, not nested modal stacks, for findings and evidence. Preserve
filters and scroll position when returning. Dialogs are for bounded confirmations,
approvals, secret upload, and destructive actions only.

## 4. End-to-end user flows

### 4.1 Bootstrap and first orientation

```text
Launcher prints loopback URL
  → UI exchanges URL-fragment token
  → fragment is removed from history
  → system readiness is fetched
  → Runs home
```

- Bootstrap loading copy: “Opening your local assessment workspace…”
- If bootstrap fails, show a full-page error with request ID and “Open a fresh launcher
  link.” Never invite the user to paste the token into a support channel.
- On first use, show a dismissible orientation panel:
  “This kit runs locally. The selected AI provider receives approved repository context.
  Optional hosted scanners are off unless you approve them.”
- If prerequisites are missing, Runs remains accessible. “New assessment” routes first to
  System readiness with the missing requirement and remediation instructions.

### 4.2 Create an assessment

The setup flow is a six-step task, shown as a vertical stepper at desktop and a compact
`Step 2 of 6` header at mobile:

1. **Identity**
   - Project name/slug, engagement, selected provider.
   - Explain that provider choice changes the agent service, not required outputs.
2. **Source**
   - Choose `SSH Git repository` or one of the registered local source handles.
   - SSH: URL, optional ref, displayed SSH input and known-host fingerprint.
   - Local: registered root and safe relative path; the browser never accepts an arbitrary
     host path.
   - For a dirty local tree, choose:
     - **Assess the commit** (recommended): working changes excluded and listed.
     - **Freeze current working tree:** explicit approval; identity includes commit plus
       snapshot digest.
3. **Product context**
   - Ten discovery topics, grouped into three conversational sections:
     - People and pain: target customers, buyers, user roles, customer pain.
     - Value and obligations: valuable workflows, differentiators, revenue/retention,
       contractual obligations.
     - Scale and change: expected scale, feature-parity expectations.
   - Each topic accepts an answer or **Mark as unknown**. Unknown requires reason,
     confidence effect, coverage effect, and follow-up owner.
   - Provenance defaults to `owner-stated` for directly entered stakeholder claims and
     requires speaker role and capture time. Other provenance labels are selectable only
     when their required metadata can be supplied.
4. **Assessment boundaries**
   - Baseline profile is fixed and visibly included.
   - Optional overlays and hosted services are separate. Each optional service opens a
     disclosure panel naming destination, data categories, recipient, credential need,
     and retention warning before approval.
   - Sandbox credentials are created as one-use handles. Secret values use the protected
     upload control and are never echoed, summarized, or shown in JSON.
5. **Review and resolve target**
   - A single-page preflight ledger summarizes source, provider data flow, discovery
     completeness, profiles, approvals, and explicit prohibitions.
   - Primary action: **Resolve immutable target**.
   - While resolving, show files/bytes processed and sanitized source identity, never
     unbounded command output.
   - If the source changes during capture, stop with a fatal explanation. Offer
     **Create a fresh assessment**, not retry against ambiguous bytes.
6. **Ready to run**
   - Show full commit, snapshot mode/digest, included/excluded dirty paths, submodule/LFS
     handling, and immutability result.
   - Primary action: **Start assessment**.

The setup saves locally when moving between steps. Navigating backward is allowed while
the run is `DRAFT`. After target resolution begins, edits create a new run revision rather
than silently changing scope.

### 4.3 Monitor a run

```text
Start
  → Overview opens with live phase timeline
  → SSE updates orientation strip and active phase
  → browser disconnect: work continues; reconnect and replay
  → user only intervenes on WAITING_INPUT or RECOVERABLE_FAILURE
```

The Overview header has four stable blocks:

- **State:** “Assessment running,” “Needs input,” “Ready for review,” etc.
- **Scope:** short commit, snapshot mode, provider.
- **Coverage so far:** reconciled domains and a text breakdown; never a percent alone.
- **Next action:** exactly one sentence and at most one primary button.

Below is the **assessment path**, a 14-phase ordered list matching the frozen architecture.
At rest, show phase name, state, duration, and one-line outcome. Expand a phase for current
attempt, coverage effect, warnings, limitations, and bounded operational events.

For parallel static controls, the parent phase shows `6 of 8 controls reconciled`; child
jobs are disclosed within it. Do not render a noisy “agent thought stream.”

### 4.4 Respond to intervention and recoverable failure

- `WAITING_INPUT`: pin a warm notice below the run header and place the exact requested
  input first. Explain which coverage remains blocked if declined.
- `RECOVERABLE_FAILURE`: show what completed safely, what did not, whether admitted
  evidence remains valid, and the proposed recovery plan.
- Retry is labeled with scope, e.g. **Retry runtime capability check**, not generic
  “Try again.”
- Resume confirmation lists attempt IDs and states that a new fenced attempt may supersede
  the failed attempt.
- `PAUSING`: controls become disabled with “Finishing safe checkpoints…”.
- `PAUSED`: **Resume assessment** is primary; **Cancel assessment** is secondary danger.
- `CANCELLING`: show cleanup state. Do not report cancellation complete until cleanup is
  reconciled.
- Cleanup residue is a limitation and release concern, not a transient toast.

### 4.5 Runtime capability and approvals

The runtime gate appears as a dedicated section of Overview and Coverage.

**Capable**

- Headline: “Safe runtime checks are available.”
- Show selected candidate, isolation controls, browser/passive probe availability,
  runtime egress (`Off` by default), and resource profile.
- If build acquisition or endpoint access is needed, ask for a scoped approval showing
  exact destinations, methods, data categories, recipient services, and expiry.

**Blocked**

- Headline: “Runtime checks are blocked; static assessment will continue.”
- Show each blocking reason, safe steps attempted, affected controls, exact coverage
  effect, and follow-up. Never offer a control-relaxation shortcut.

**Not applicable**

- Headline: “No applicable runtime target was found.”
- Name the evidence that establishes non-applicability and affected controls.

Re-running the gate states that the prior result remains part of the audit trail.

### 4.6 Review coverage

Coverage opens with a **coverage sentence**, not a score:

> “15 required domains reconciled: 9 passed, 2 partial, 3 blocked, and 1 not applicable.”

Show three connected views:

1. **Domain ledger** — one row per required domain, fixed architecture order. Columns:
   domain, status, controls reconciled, limitation count, latest evidence. Expand for
   exclusions, unsupported ecosystems, counts, and evidence links.
2. **Control explorer** — filters for status and profile. Every non-pass row shows its
   reason in the collapsed state. `Fail` means an exercised control found a negative
   result; it is not a tool crash.
3. **Limitations register** — grouped by decision impact: changes recommendation
   confidence, affects important finding, affects only technical depth.

Status language:

| State | Plain-language label | Meaning shown in UI |
|---|---|---|
| `pass` | Passed | The planned control ran and met its stated condition. |
| `fail` | Failed | The control ran and found a negative result. |
| `partial` | Partly tested | Only a defined part of the planned scope was exercised. |
| `blocked` | Blocked | Safety, authorization, or a prerequisite prevented the test. |
| `not applicable` | Not applicable | Evidence shows the subject is absent. |
| `not tested` | Not tested | Applicable work was omitted, exhausted its safe budget, or was not selected. |

### 4.7 Review findings and proof

The findings list defaults to **business priority**, then technical severity, then title.
It does not default to severity alone.

Each row shows:

- title and category;
- business consequence, one line;
- technical severity and business priority as separate labeled fields;
- confidence and validation state;
- evidence count;
- any coverage limitation affecting interpretation.

Finding detail is an editorial page:

1. **What this means** — plain-language consequence and affected party.
2. **What was found** — technical description and locations.
3. **How sure are we?** — confidence, validation state, independent review, disputes.
4. **Evidence trail** — trace rail with evidence occurrences and controls.
5. **Suggested theme** — a remediation theme, explicitly not an implementation plan.
6. **Limits** — what the evidence does not establish.

Evidence links open the Evidence detail route with a back link to the finding. Safe previews
are rendered only from the API’s escaped-text or trusted re-encoded-image derivative.
Raw HTML, SVG, PDF, archives, XML, unknown media, and raw screenshots are download-only.
The app never opens target content in an inline frame or privileged new window.

### 4.8 Inspect evidence

Evidence is a proof catalog, not a file browser. Default columns:

- human title and type;
- source/capture method;
- validation and redaction state;
- linked claims/findings/controls;
- captured time.

Evidence detail includes:

- occurrence ID and separate content digest;
- source locator with repository-relative path only;
- provenance agent/activity, sanitized command, config digest, attempt;
- sensitivity, redaction transformation summary, validation state;
- collection limitations and derivations;
- safe preview or “Download only” explanation;
- explicit raw attachment download.

Absolute host paths never appear. Copy controls copy IDs or repository-relative locations,
not raw body content.

### 4.9 Compare modernization options

Decision is a reading workspace with a sticky criterion index on wide screens.

Top section:

- **Recommendation:** single option or conditional sequence, in a bordered statement
  rather than a celebratory banner.
- **Confidence:** high/medium/low plus the strongest reason it is not higher.
- **What would change this recommendation:** reversal conditions, always visible.
- **Assumptions and dependencies:** visible list; never hidden in an appendix.

Comparison table:

- columns are Remediate, Replace incrementally, Full rebuild;
- rows are recoverability, system boundaries, security risk, engineering risk, critical
  feature parity, expected scale, rebuild feasibility;
- each cell contains a two-sentence assessment, state (`evidenced`, `unverified`, or
  `conflicting`), confidence, and a trace-rail evidence link;
- the recommended column receives a 3px teal top rule and `Recommended` text. It does not
  receive a green “winner” fill.

At widths where the comparison cannot remain legible, use criterion-by-criterion stacked
groups that retain all three options together. Never make users horizontally scroll to
compare.

### 4.10 Technical and lay review

Reviews & package uses a four-gate checklist:

1. Independent security review
2. Independent decision review
3. Technical human review
4. Lay human review

For each gate, show input digest, reviewer role/perspective, verdict, objections, disputed
items, accepted corrections, and limitations. Automated review does not visually impersonate
human review.

The human-review form presents a fixed reading checklist and supports:

- `Passed`
- `Passed with objections`
- `Failed`

Objections require a statement and, where applicable, evidence references. The lay review
asks the reviewer to confirm they can explain principal risks, business consequences,
options, recommendation, confidence, and unknowns without unexplained jargon.

A failed review returns the run to the appropriate correction flow; it does not overwrite
the original review.

### 4.11 Package, verify, and download

Once review gates pass, the package panel displays the nine auditable stages in order:

1. Admission complete
2. Redaction complete
3. Reviews complete
4. Staging frozen
5. Manifest created
6. Pre-ZIP validation passed
7. ZIP created
8. Reopened ZIP validated
9. Released with detached digest

Primary action: **Create customer package**.

Optional age encryption is a secondary choice. Explain that a validated plain ZIP is
always retained. X25519 recipient input may be entered in the web UI. Scrypt directs the
operator to the launcher-protected channel and never accepts a passphrase in the web UI.

When validated, show:

- package revision and created time;
- byte size;
- full SHA-256 in a selectable monospace field;
- validation report link;
- **Download validated ZIP**;
- **Download digest**;
- optional encrypted-wrapper metadata/download.

When packaging fails, downloads remain unavailable. Show the exact failed gate and safe
operator action; never expose unredacted staging.

### 4.12 Cancel and delete

Cancel is available only from the run action menu and uses a confirmation dialog explaining
that admitted evidence remains and runtime cleanup will be reconciled.

Delete is available only for terminal runs under **Run data & retention**. It is a separate
full-page flow:

1. choose `internal only`, `run except packages`, or `entire run`;
2. show exact path classes affected and recovery window;
3. if packages are included, require project slug and each package digest;
4. submit to trash; show 24-hour restore deadline and recovery state.

Danger controls use text, icon, and placement—not red alone.

## 5. Screen inventory

| Screen | Purpose and key elements | Entry | Exit |
|---|---|---|---|
| Runs home | Recent runs, concise state, project, commit, provider, last activity, next action; new-assessment CTA | Bootstrap, product nav | New setup, run overview |
| System readiness | Host/provider/profile versions, prerequisite attestations, missing requirements, static-only implications | Product nav, blocked setup | Runs, retry readiness |
| About / glossary | Local and provider data flow, six coverage states, seven provenance labels, integrity explanation | Product nav, contextual help | Prior route |
| New assessment | Six-step safe setup with persisted draft and review ledger | Runs home | Draft, target resolution, overview |
| Run overview | Orientation strip, run actions, phase path, runtime capability, current intervention, limitations preview | Run list, setup | Any run section |
| Context | Ten discovery topics, provenance, unknowns, conflicts, linked evidence | Run nav | Edit in draft/create revision |
| Coverage | Coverage sentence, domain ledger, control explorer, limitations register | Run nav, overview links | Finding/evidence |
| Findings | Filter/sort findings with separate severity, priority, confidence, validation | Run nav | Finding detail |
| Finding detail | Consequence, technical detail, certainty, evidence trail, limits | Findings, decision | Evidence, back |
| Evidence catalog | Filterable occurrence catalog | Run nav, linked references | Evidence detail |
| Evidence detail | Provenance, safe derivative preview, redaction, links, attachment download | Any trace link | Back to source context |
| Decision | Recommendation, confidence, reversal conditions, fixed-criteria 3-option comparison | Run nav, overview | Reviews, evidence |
| Reviews & package | Four review gates, review entry, nine package stages, verified downloads | Run nav, ready state | Download, data/retention |
| Run data & retention | Storage classes, retention, cancel/deletion flow, restore status | Run action menu | Overview |
| Session expired | Explain local session ended; open a fresh launcher link | Any request returning 401 | Bootstrap |

## 6. Global shell and layout

### 6.1 Desktop

At `lg` and above:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ RAK wordmark       local-only indicator       System readiness  ⋯  │ 56
├───────────────┬─────────────────────────────────────────────────────┤
│ run identity  │ breadcrumb / page title             page actions   │
│               ├─────────────────────────────────────────────────────┤
│ Overview      │ status / caveat band                                │
│ Context       │                                                     │
│ Coverage      │ reading column or ledger                           │
│ Findings      │ max content 1240px                                 │
│ Evidence      │                                                     │
│ Decision      │                                                     │
│ Review        │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
     240px                     fluid
```

- Header height: 56px.
- Run rail: 240px fixed, sticky below header, full viewport height; collapses to 72px
  icon-plus-tooltip mode between 1024px and 1179px.
- Main padding: `clamp(16px, 2.2vw, 32px)`.
- Reading pages: 760px measure. Ledgers/comparison pages: up to 1240px.
- Main content is left-aligned; do not center all dashboard content as cards.

### 6.2 Tablet and mobile

- Below 1024px, run navigation becomes a horizontally scrollable tab row beneath the
  header with edge fade and keyboard scroll buttons. The page itself never overflows.
- Below 768px, product nav is a sheet; run identity becomes a compact two-line header.
- Primary page action becomes full-width only below 480px.
- Sticky bottom actions are allowed only inside setup and review forms, with safe-area
  padding and enough bottom space so content is never obscured.

## 7. Component system

Use shadcn components as accessible behavior primitives, then apply the Evidence Desk
tokens. Do not accept default shadcn visual styling without these specifications.

### 7.1 Core components

#### `RunStateLabel`

- Text plus icon and optional animated activity dot.
- Human labels: Draft, Resolving target, Ready to start, Assessment running, Needs input,
  Pausing, Paused, Recovery needed, Validating, Review needed, Packaging, Completed,
  Cancelling, Cancelled, Failed.
- Raw enum appears only in developer details.
- `EXECUTING` uses teal; `WAITING_INPUT` and `RECOVERABLE_FAILURE` use amber; terminal
  failure uses red; completed uses green; neutral terminal cancellation uses slate.

#### `CoverageStatusBadge`

- Must always render icon + full label in summary contexts.
- Shape/pattern:
  - Passed: check, solid pale green.
  - Failed: x, pale red with 2px left edge.
  - Partly tested: half-circle, amber diagonal micro-stripe in icon only.
  - Blocked: lock, lavender.
  - Not applicable: em dash in outlined gray.
  - Not tested: open circle, pale amber-gray.
- Badge never shows color alone. Tooltip repeats meaning; tooltip is supplementary.

#### `ProvenanceTag`

Allowed canonical values and display labels only:

- `owner-stated` → Owner stated — speech bubble
- `documented` → Documented — page
- `observed` → Observed — eye
- `analytics-supported` → Analytics supported — chart
- `code-inferred` → Code inferred — brackets
- `unverified` → Unverified — question
- `conflicting` → Conflicting — split arrows

Use the same neutral capsule shape; icon and label communicate category. Do not encode
truth value as green/red. `Conflicting` gets an additional 2px plum underline.

#### `TraceRail`

- 2px neutral line, 12px numbered nodes, 16px inset from content.
- Interactive node hit area: minimum 44×44px.
- Expanded drawer lists linked occurrence title, source, captured time, validation state,
  and safe-preview state.
- More than five links: show first three and “View all N sources.”

#### `OrientationStrip`

- Four semantic sections, separated by 1px rules, not four floating cards.
- On mobile sections stack in priority order: Next action, State, Scope, Coverage.
- Skeleton preserves final block heights.

#### `PhasePath`

- Ordered list matching all 14 canonical phases.
- Active phase receives a teal 3px rail and live timestamp.
- Completed phases collapse to one line by default; failure/limitation phases remain
  expanded until acknowledged.
- Event list is bounded to the latest 20 with “View older events.” Live regions announce
  only phase changes, not every event.

#### `DomainLedger`

- Semantic table at desktop, grouped definition list cards at mobile.
- Header remains visible when vertically scrolling.
- Row click is not the sole affordance; an explicit chevron button toggles details.
- Reasons for every non-pass state remain visible before expansion.

#### `FindingRow`

- 72px minimum desktop height; title may wrap to two lines.
- Business priority is visually first. Severity, confidence, and validation are separate
  labeled fields, never merged into one risk chip.
- Selected/focus state uses border/focus ring, not background color alone.

#### `EvidenceInspector`

- Wide screens: right-side 420px sheet only when opened from a list for quick inspection;
  “Open full evidence record” navigates to the route.
- Small screens: full-screen dialog with visible close and back behavior.
- Uses only safe-preview DTOs. Attachment-only state explains why.

#### `DecisionMatrix`

- Semantic table at `xl`; responsive criterion groups below.
- Every cell has assessment, evidence state, confidence, and source link in the same order.
- Table supports keyboard row navigation but retains normal reading/tab order.
- No numeric scoring or weighted totals.

#### `ReviewGate`

- Checklist row with review kind, reviewer type, state, input digest short form, and
  objection count.
- Human and agent/system reviewer icons and labels differ explicitly.

#### `PackageStageList`

- Nine ordered stages with `not started`, `active`, `passed`, or `failed`.
- A stage cannot appear passed until its certificate exists.
- If failed, show diagnostic summary and operator action directly beneath the stage.

#### `SafePreview`

- Escaped text uses readable proportional type by default; code/JSON switch to monospace.
- Text truncation includes byte/line statement and attachment download.
- Re-encoded image has alt text derived from evidence title/caption, dimensions, and
  derivative evidence ID.
- Attachment-only state uses file icon, media type, size, and safety explanation.

#### `DisclosureApproval`

- Summary sentence: “Allow [service] to receive [data categories] at [destination] until
  [time].”
- Details list method, path prefix, recipient, credential handle, and coverage impact of
  denial.
- Approve and deny are peer actions; denial is not visually shamed.

#### `UnknownField`

- Toggled from the normal answer editor.
- Requires reason, confidence effect, coverage effect, follow-up owner.
- Shows a preview of how the unknown will read in the customer package.

### 7.2 Form components

- Text input height 40px desktop, 44px touch viewport.
- Textarea minimum 120px; character guidance is descriptive, not a hard limit unless the
  contract supplies one.
- Labels sit above controls. Required/optional is stated in text.
- Validation runs on blur and submit, never on every keystroke for prose fields.
- Errors appear beneath the relevant field and in a focused error summary on submit.
- Radio cards are used only when options need explanation; each is a real radio input.
- Use `AlertDialog` for cancel/delete and `Dialog` for approval/secret actions.
- Use `Popover` only for short nonessential filters, not critical evidence or help.

### 7.3 Universal state matrix

Every data-bearing screen and component implements:

| State | Required treatment |
|---|---|
| Default | Current canonical data, last-updated time where relevant, clear primary action |
| Loading | Shape-matched skeleton after 300ms; no fake values; `aria-busy=true`; keep last valid data during background refetch |
| Empty | Explain why empty is expected and the phase/action that can populate it; “No findings” must also state coverage context |
| Unavailable yet | Name the producing phase and current phase; do not use empty state |
| Success | Inline durable confirmation for mutations; toast may supplement but not replace it |
| Recoverable error | Plain cause, completed-safe work, retry scope, request ID in details |
| Fatal error | State that cannot safely continue, preserve diagnostic ID, provide allowed next step |
| Stale/conflict | Explain another update changed the run; refetch canonical state; never silently overwrite |
| Disabled | Visible reason adjacent to control; preserve readable contrast; no tooltip-only explanation |
| Offline/SSE disconnected | “Live updates paused; assessment continues.” Poll/refetch and replay without changing run state |
| Partial data | Display admitted data plus explicit incompleteness/coverage effect; never fill with placeholders |

### 7.4 Notifications

- Inline alerts carry decisions and failures.
- A single toast region handles transient confirmations such as copied ID.
- Do not toast phase progress.
- Error banners persist until resolved or deliberately dismissed; dismissal does not
  remove the underlying limitation.

## 8. Visual language

### 8.1 Direction

The visual tone is a modern evidence ledger: warm paper canvas, white working surfaces,
blue-black ink, deep teal actions, and thin rules. It should resemble a well-annotated
consultant workbook rather than a cybersecurity “command center.” Avoid dark dashboards,
neon, radial scores, gradient hero panels, glass effects, and excessive rounded cards.

### 8.2 Color tokens

All tokens map to Tailwind CSS variables and shadcn semantic aliases.

| Token | Hex | Usage | Tested contrast |
|---|---:|---|---:|
| `--canvas` | `#F7F6F2` | app background | — |
| `--surface` | `#FFFFFF` | working surface | — |
| `--surface-subtle` | `#F0F1EE` | ledger headers, inactive wells | — |
| `--ink` | `#17212B` | primary text | 15.07:1 on canvas |
| `--ink-muted` | `#55616D` | secondary text | 5.85:1 on canvas |
| `--line` | `#CBD2D6` | decorative separators only | 1.53:1 on white; never the sole component boundary |
| `--line-strong` | `#87929C` | control boundaries, selected dividers, inactive icon outlines | 3.17:1 on white |
| `--action` | `#145C63` | primary action, active rail | 7.66:1 with white |
| `--action-hover` | `#0F464C` | action hover/pressed | 10.50:1 with white |
| `--focus` | `#0B5FFF` | focus ring and links | 5.13:1 on white; 4.74:1 on canvas |
| `--danger` | `#A12C2C` | destructive text/icon | 6.56:1 on `#FFF1F0` |
| `--warning` | `#7A4B00` | needs-input/partial text | 6.88:1 on `#FFF6DE` |
| `--success` | `#1F6A44` | completed/passed text | 5.95:1 on `#EAF7EF` |
| `--info` | `#245A9B` | observed/informational text | 6.36:1 on `#EEF5FF` |
| `--conflict` | `#6D3E8F` | conflicting evidence accent | 6.91:1 on `#F8F0FF` |

Semantic fills:

- danger `#FFF1F0`
- warning `#FFF6DE`
- success `#EAF7EF`
- info `#EEF5FF`
- conflict/blocked `#F8F0FF`

Do not use semantic fills without text/icon. `--line` is decorative and carries no
meaning; controls and meaningful graphical boundaries use `--line-strong`.

Dark mode is not part of MVP; local operation does not justify a second unvalidated visual
theme. Respect OS forced colors.

### 8.3 Spacing

Base unit is 4px. Named spacing tokens:

```text
space-1  4px     space-2   8px     space-3  12px
space-4 16px     space-5  20px     space-6  24px
space-8 32px     space-10 40px     space-12 48px
space-16 64px
```

- Inline icon gap: 8px.
- Label-to-control: 8px.
- Related field gap: 16px.
- Form group gap: 24px.
- Section gap: 40px desktop, 32px mobile.
- Page title to first content: 24px.
- Ledger cell padding: 12px vertical/16px horizontal.
- Report paragraph rhythm: 12px within an idea, 24px between ideas, 40px between sections.

### 8.4 Radius, border, elevation

- `radius-xs: 3px` — chips and code wells.
- `radius-sm: 6px` — inputs and buttons.
- `radius-md: 10px` — dialogs, alerts, grouped surfaces.
- No pill radius except binary status/provenance tags, and even those keep a 6px radius.
- Default border: 1px `--line`.
- Important trace or recommendation rule: 3px.
- Cards do not float. Default shadow is none.
- Popover: `0 8px 24px rgb(23 33 43 / 0.12)`.
- Dialog: `0 20px 56px rgb(23 33 43 / 0.18)`.
- Sticky headers gain a 1px bottom border, not a large shadow.

### 8.5 Icons and data graphics

- Use Lucide icons through shadcn conventions, 16px inline, 20px navigation, 24px empty
  states.
- Icons inherit semantic foreground and always have adjacent text for status.
- Do not use charts for fewer than five comparable data points.
- Coverage is shown as exact counts and a segmented linear bar only when the same counts
  are printed beside it. Bar order is passed, failed, partial, blocked, not applicable,
  not tested. It has an accessible text equivalent.
- No gauge, donut, radar, spider, or aggregate repository score.

### 8.6 Motion

- Default transition: 140ms `cubic-bezier(.2,.8,.2,1)` for color/border/opacity.
- Expand/collapse: 180ms, height plus opacity; content is present in accessibility tree
  only when expanded.
- Active run dot: subtle 1.6s opacity pulse; no scale pulse.
- New SSE items fade from 0 to 1 in 160ms and never reorder while focused.
- No entrance animation on page load.
- Under `prefers-reduced-motion: reduce`, remove pulse, smooth scrolling, transform, and
  expand animation; state changes are immediate.

## 9. Typography

### 9.1 Families

- UI and reports: `"Inter", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif`.
  Bundle the selected release-owned webfont locally or use the system stack; no external
  font request.
- Evidence IDs, hashes, repository paths, code, values:
  `"IBM Plex Mono", "SFMono-Regular", Consolas, monospace`.
- The app must remain legible and stable when only system fonts load.

### 9.2 Type tokens

The scale is intentionally restrained for a dense evidence product.

| Token | Fluid size | Line height | Weight | Use |
|---|---|---:|---:|---|
| `text-display` | `clamp(1.75rem, 1.5rem + 1vw, 2.25rem)` | 1.12 | 650 | executive report conclusion only |
| `text-h1` | `clamp(1.5rem, 1.35rem + .6vw, 1.875rem)` | 1.2 | 650 | page title |
| `text-h2` | `clamp(1.25rem, 1.15rem + .35vw, 1.5rem)` | 1.28 | 650 | major section |
| `text-h3` | `1.125rem` | 1.35 | 620 | subsection/card title |
| `text-body-lg` | `1.0625rem` | 1.6 | 400 | executive narrative, decision assessments |
| `text-body` | `1rem` | 1.5 | 400 | normal UI and reports |
| `text-body-sm` | `0.875rem` | 1.45 | 400 | metadata, tables |
| `text-label` | `0.8125rem` | 1.3 | 600 | field/status labels |
| `text-caption` | `0.75rem` | 1.4 | 500 | timestamps and secondary identifiers |
| `text-mono` | `0.8125rem` | 1.55 | 450 | paths, hashes, code |

Do not set operational prose below 14px. Twelve-pixel caption text is limited to
nonessential timestamps/secondary IDs and still meets contrast.

### 9.3 Measure and rhythm

- Executive narrative: 58–68 characters per line, max 720px.
- Technical prose: 65–75 characters, max 780px.
- Form help: max 64 characters.
- Table cells: 28–52 characters where layout permits.
- Paragraph margin: 0; parent stacks control rhythm.
- Heading top space: 40px (`h2`), 32px (`h3`); first child omits top space.
- Never justify text. Preserve user-entered line breaks only in evidence/claims where
  semantically required.

## 10. Responsive and adaptive behavior

### 10.1 Breakpoints

Use Tailwind breakpoints with one product-specific wide breakpoint:

```text
xs  360px  (layout guard, not a required Tailwind prefix)
sm  640px
md  768px
lg  1024px
xl  1280px
2xl 1536px
```

Minimum supported viewport is 320px. Test at 320, 360, 390, 768, 1024, 1280, 1440, and
1920px. No route may cause page-level horizontal overflow at 320px. Long hashes/paths use
`overflow-wrap:anywhere`; tabular technical data moves into definition lists or a
component-local scroller with an accessible label.

### 10.2 Per-screen reflow

| Screen / component | `xl` ≥1280 | `lg` 1024–1279 | `md` 768–1023 | `<md` down to 320 |
|---|---|---|---|---|
| Shell | 240px run rail + content | 72px compact rail + content | product header + run tab row | same; product nav sheet |
| Setup | 220px stepper + 720px form + 280px summary | 180px stepper + form; summary inline | compact top stepper; one column | `Step N of 6`; one column; sticky action region |
| Overview orientation | 4 columns | 2×2 | 2×2 | one vertical ruled list; next action first |
| Phase path | full detail list | same | same | timeline labels wrap; timestamps below; no side-by-side event pane |
| Coverage | ledger table + 300px limitation filter | ledger table | table becomes domain accordion at <900px | definition-list cards; status/reason first |
| Findings | 5-column dense list | 4 columns; validation under title | 2-column row | stacked item; consequence, priority, severity, confidence |
| Finding detail | 760px narrative + 360px sticky evidence index | single 820px column | single column | single column; trace rail inset reduces to 12px |
| Evidence catalog | table + optional inspector | table, route for detail | list, route for detail | list; full-screen evidence detail |
| Evidence detail | 760px preview + 360px metadata | 60/40 split | stacked; metadata first | stacked; preview bounded to viewport |
| Decision | 3-column matrix | criterion groups, 3 columns within group | criterion groups; 3 stacked options | each criterion contains all 3 option cards in fixed order |
| Review/package | 65/35 gates and package summary | one column | one column | one column; full-width actions |
| Dialogs | max 640px centered | same | max calc(100%-32px) | full-height sheet for complex approval; alert dialogs remain centered |

At mobile, the recommended decision option is not moved ahead of the fixed order. The
`Recommended` label supplies emphasis without breaking comparison order.

### 10.3 Container behavior

- Use container queries for `FindingRow`, `OrientationStrip`, and `DecisionMatrix` so they
  adapt in split views.
- Evidence preview images use `max-inline-size:100%; block-size:auto`.
- No fixed-height prose panels. Bounded event/evidence panes have user-visible “show more”
  and keyboard scrolling.
- Safe-area insets apply to sheets and sticky mobile actions.

## 11. Accessibility requirements

Target WCAG 2.2 AA for the application and generated HTML reports.

### 11.1 Structure and semantics

- One `h1` per route; headings do not skip levels.
- Use landmarks: `header`, `nav`, `main`, and contextual `aside`.
- Tables have captions, column headers, and row headers. Responsive card equivalents retain
  the same labels using `dl`, `dt`, and `dd`.
- Status is text, icon, and color. Provenance is label and icon.
- Run/phase progress uses ordered lists, not ARIA progress bars unless a truthful bounded
  completion value exists.
- Every form control has a persistent label and associated help/error text.

### 11.2 Keyboard and focus

- All functionality is available by keyboard without drag.
- Visible focus ring: 2px `--focus`, 2px offset; never remove.
- Skip links: “Skip to run navigation” and “Skip to main content.”
- After route navigation, focus the `h1`; after mutation, focus the durable result or error
  summary when user action is required.
- Dialogs trap focus, restore it to the opener, close on Escape unless a submission is in
  a non-interruptible atomic transition.
- Sheets/dialogs have an explicit close button with a 44×44px hit target.
- Minimum target: 24×24px per WCAG; product target is 40×40px desktop and 44×44px touch.

### 11.3 Announcements and live activity

- A polite live region announces run-state and phase-state changes only.
- Needs-input, session expiry, cancellation failure, and fatal integrity errors use
  assertive announcement once.
- SSE reconnection does not replay every historical announcement.
- Loading uses `aria-busy`; skeletons are hidden from assistive tech.
- Toasts use polite status; errors must also exist inline.

### 11.4 Contrast and zoom

- Normal text ≥4.5:1; large text ≥3:1; controls/focus/meaningful graphics ≥3:1.
- Verify semantic token pairs in automated contrast tests.
- At 200% zoom at 1280px, all workflows reflow without two-dimensional page scrolling.
- At 400% zoom at 320 CSS px, primary tasks remain usable.
- Respect Windows high-contrast/forced-colors; preserve borders and native form affordances.

### 11.5 Cognitive access

- One primary action per screen region.
- Explain raw terms on first use; status glossary is always one link away.
- Do not use “clean,” “secure,” “compliant,” or “complete” as standalone conclusions.
- Error copy states what happened, what remains safe, and what the user can do.
- Time values use local display plus UTC in accessible details; commit and digest values
  are never read character-by-character unless the user enters the field.

### 11.6 Accessibility verification

- Automated: axe on every route/state fixture; Lighthouse accessibility ≥95 as a signal,
  not sole proof; token contrast tests; HTML report parser checks.
- Keyboard: complete setup, pause/resume, finding-to-evidence navigation, review, package,
  and deletion without pointer.
- Screen reader: NVDA + Chrome on Linux/Windows-compatible environment and VoiceOver +
  Safari on macOS for setup, run updates, decision matrix, and package download.
- Reflow: required viewport matrix plus 200%/400% zoom.
- Reduced motion and forced-colors manual checks.

## 12. Content and voice

### 12.1 Tone

Calm, specific, and candid. Sound like a consultant explaining their work to a responsible
owner: no alarmism, no triumph, no scanner jargon as the headline.

Use:

- “Runtime checks were blocked because the repository requires a host network.”
- “Static assessment continued. Five browser controls remain untested.”
- “This weakens confidence in the authentication finding.”

Avoid:

- “Scan incomplete.”
- “All good.”
- “The app is secure.”
- “ASVS compliant.”
- “AI determined…”

### 12.2 Sentence pattern for important content

1. What happened or was found.
2. Why it matters to the owner.
3. How strong the evidence is.
4. What to do or learn next.

Example:

> Password reset tokens appear in application logs. Anyone with log access may be able to
> take over an account while a token remains valid. This is supported by a code path and a
> safe runtime observation, but production logging was not assessed. Remove token values
> from logs and confirm the deployed logging configuration.

### 12.3 Labels

- Prefer sentence case.
- Buttons use verb + object: “Resolve immutable target,” “Start assessment,” “Review 3
  blocked controls,” “Create customer package.”
- Avoid “Submit,” “OK,” “Process,” and “Execute.”
- Use “repository” in explanatory copy and “repo” only in technical metadata.
- Expand acronyms in executive surfaces: “software bill of materials (SBOM)” on first use.

### 12.4 Confidence and provenance language

- High confidence: multiple direct or independently corroborated sources.
- Medium confidence: credible evidence with an important untested condition.
- Low confidence: limited, inferred, or conflicting support.

Do not map confidence to probability. Do not call `owner-stated` verified. Explain
`code-inferred` as “suggested by implementation, not confirmed by an owner or live test.”

### 12.5 Empty-state copy rules

“No findings” is prohibited without coverage:

> “No findings are admitted yet. Static security analysis is still running.”

or

> “No findings were admitted for this filter. This does not mean the repository has no
> vulnerabilities; review coverage and limitations.”

## 13. Customer package and report design

The generated package is a product surface. It must preserve the Evidence Desk logic in
static HTML and Markdown without JavaScript, external fonts, SVG, forms, or active content.
The authenticated UI downloads report HTML as an attachment; it never previews it inline.

### 13.1 Package index

`index.html` is a one-page package guide:

- Project, assessed commit/snapshot, assessment date, provider, package revision.
- “Start here” link to Executive report.
- Five report descriptions: Executive, Decision, Technical, Security, Coverage &
  limitations.
- Integrity block: ZIP SHA-256, manifest/checksum explanation, verification instructions.
- Evidence and data appendix explanation.
- Clear caveat: “This assessment reflects the recorded snapshot and stated scope. It is
  not a certification or proof that no vulnerabilities exist.”

### 13.2 Executive report

Target length: 4–7 printed pages before appendices. Reading order:

1. **Decision in one page**
   - assessed subject and scope;
   - recommendation/conditional sequence;
   - confidence and strongest uncertainty;
   - three principal issues and their business consequences;
   - next decision required from the owner.
2. **What we learned**
   - valuable workflows and feature-parity obligations;
   - system strengths/recoverable assets;
   - material risks;
   - owner-stated vs observed/inferred claims visible.
3. **Options at a glance**
   - the same three-option comparison in plain language.
4. **What could change the recommendation**
   - reversal conditions, assumptions, dependencies.
5. **Coverage and important unknowns**
   - exact domain/control counts;
   - blocked/partial/not-tested items with business effect;
   - explicit absence of screenshots if capability-gated.

No severity-only list, framework ID, raw path, CVSS vector, or long hash in the executive
narrative. Link each material statement to footnote-style evidence references.

### 13.3 Decision report

- Full seven-row, three-option matrix.
- Recommendation rationale and conditional sequence.
- Confidence per criterion and option.
- Evidence state (`evidenced`, `unverified`, `conflicting`) in text.
- Assumptions, dependencies, reversal conditions.
- Dissent and independent-review objections.
- No aggregate score or arithmetic winner.

### 13.4 Technical report

- Repository composition and stack.
- Architecture and boundaries.
- Engineering maintainability.
- Features/use-case traceability.
- Runtime readiness.
- Dependency inventory.
- Findings cross-reference.
- Repository-relative locators and occurrence IDs.
- Tool/profile versions and collection limitations in appendix.

### 13.5 Security report

- Independent report with own scope, coverage, runtime results, findings, evidence, and
  validation outcome.
- Separate technical severity, business priority, confidence, validation state.
- General baseline distinct from overlays.
- Framework language: “technical coverage against [profile],” never compliance.
- High/critical findings include consequence, affected party, next action, evidence
  strength, and limits.
- Imported CVSS versions remain labeled; no forced conversion.

### 13.6 Coverage and limitations report

- Coverage sentence and exact six-state counts.
- One row per required domain.
- One row per planned control in appendices.
- Limitations grouped by effect on recommendation, findings, and depth.
- Scope, exclusions, unsupported ecosystems, failed tools, blocked runtime, not-tested
  work, absent screenshots, and follow-up needs.
- Distinguish:
  - failed control;
  - tool failure;
  - blocked capability;
  - not applicable subject;
  - deliberately not tested work.

### 13.7 Static report visual tokens

Reports use the same canvas/ink/semantic colors but white page backgrounds for printing.

- Max reading width: 760px on screen.
- Print: A4 and US Letter compatible, 16mm margins, 10.5pt body/15pt line height.
- Page breaks before major report sections; avoid breaking finding summaries and table
  rows where possible.
- Links display a readable label; print stylesheet appends package-relative path only for
  evidence links, never external URLs.
- Trace rails become 1pt gray rules with `[E-###]` references.
- Semantic fills print with borders/icons so grayscale remains understandable.
- Tables repeat headers when printed.
- Every page footer: project, short commit, report kind, page number; no absolute path.

### 13.8 Report accessibility

- Static HTML follows the same semantic heading/table/landmark rules.
- Include a skip link and descriptive titles.
- Re-encoded evidence images require meaningful alt text or empty alt when decorative.
- Evidence references identify destination and media type.
- Markdown remains readable without HTML extensions.
- Report CSS supports `prefers-reduced-motion` though shipped reports have no motion.

## 14. Error and safety copy catalog

| Situation | Headline | Required body/action |
|---|---|---|
| Source changed during capture | “The source changed while it was being frozen.” | “No assessment started and no package can be created from this capture.” Create fresh assessment. |
| Runtime policy blocked | “Runtime checks are blocked; static assessment will continue.” | Reason, attempted safe steps, affected controls, follow-up. |
| Provider unavailable | “The selected assessment provider is unavailable.” | Admitted work remains, retry scope, provider status; do not suggest switching within the same immutable run. |
| SSE lost | “Live updates paused.” | “The assessment continues locally. Reconnecting…” |
| Evidence rejected | “This evidence could not be admitted.” | Hash/schema/reference reason and affected control; never show it as pass. |
| Secret scan failed | “Customer package blocked by sensitive content.” | Artifact class and redaction action; never show secret value. |
| Review missing | “Customer package needs 2 reviews.” | Name technical/lay gate and expected reviewer action. |
| ZIP validation failed | “The package did not pass integrity checks.” | Failed stage, validation report, retry only after correction; no download. |
| Row version conflict | “This run changed in another view.” | Refresh current state; preserve unsent form text where safe. |
| Storage low | “More local storage is required.” | Required/reserve/free values and safe recovery steps; no auto-delete. |

## 15. Implementation mapping

### 15.1 shadcn/Radix primitives

Use:

- `Button`, `Input`, `Textarea`, `Label`, `RadioGroup`, `Checkbox`, `Select`
- `Tabs` for run navigation only when semantic tab behavior matches same-page panels;
  route navigation uses links styled as tabs.
- `Accordion` for mobile domain/phase detail.
- `Dialog`, `AlertDialog`, `Sheet`, `Popover`, `Tooltip`
- `Table`, `ScrollArea`, `Separator`, `Skeleton`, `Toast`
- `Progress` only for bounded acquisition/job progress, never overall assessment certainty.

Customize component variants through CSS variables and class variance authority. Keep
Radix focus, dismissal, and keyboard behavior intact.

### 15.2 Tailwind token names

Expose:

```text
bg-canvas, bg-surface, bg-subtle
text-ink, text-muted
border-line, border-strong
text-action, bg-action, ring-focus
text-danger/bg-danger-soft
text-warning/bg-warning-soft
text-success/bg-success-soft
text-info/bg-info-soft
text-conflict/bg-conflict-soft
```

Add component data attributes for canonical states:

```text
data-run-state
data-coverage-status
data-validation-state
data-provenance
data-package-stage-state
```

These support deterministic visual regression fixtures without parsing display text.

### 15.3 UI contract discipline

- Consume only the generated OpenAPI client and public SSE events.
- `202` means accepted, not complete; keep the action pending until canonical GET/SSE state
  changes.
- On each higher `rowVersion`, refetch affected canonical resources.
- Preserve idempotency key across client retry of the same mutation body.
- Handle 400/401/403/404/409/412/413/415/422/429/500/503 with the error catalog and
  `operatorAction`.
- Never accept arbitrary path, shell, Docker/Compose, provider flags, secret JSON, or raw
  evidence admission in the UI.

## 16. QA acceptance criteria

### 16.1 Primary flows

- A first-time operator can create an SSH or registered-local assessment, complete or mark
  unknown all ten discovery topics, understand provider data flow, resolve an immutable
  target, and start the run without technical help.
- A dirty local repository makes commit-only versus frozen-working-tree consequences
  explicit before resolution.
- A blocked runtime gate continues static assessment and leaves every affected control with
  a reason and coverage effect.
- Browser disconnection and SSE replay do not duplicate events or misrepresent run state.
- An operator can trace a material decision cell to a finding/claim and then to a safe
  evidence preview or attachment record.
- All three modernization options and seven criteria are comparable at 320px without
  horizontal page scrolling.
- Technical and lay review gates block package creation until complete.
- A package download is unavailable until all nine stages pass and a detached digest
  exists.

### 16.2 Honesty and comprehension

- No route or report displays an aggregate repository score.
- “No findings” is never shown without current coverage context.
- Technical severity, business priority, confidence, and validation state are separate
  fields wherever findings are summarized.
- All six coverage states and seven provenance states appear as text plus icon, not color
  alone.
- A lay reviewer can identify principal issues, business effects, alternatives,
  recommendation, confidence, and unknowns from the executive view/report.
- The UI never says secure, compliant, certified, or complete without a tightly scoped
  object and evidence.

### 16.3 Safety

- Target-derived active content is never rendered inline.
- Only escaped-text and trusted re-encoded-image derivatives can preview.
- Secret values never reappear after upload and never enter client logs, URL, state
  persistence, error text, or clipboard helpers.
- Optional service approval states exact destination and data categories; denial remains a
  first-class action.
- Cancel/deletion confirmations describe evidence retention and cleanup/recovery.

### 16.4 Visual and responsive

- Screenshot regression fixtures cover every run state, six coverage states, seven
  provenance states, review verdict, and nine package stages.
- At 320px, 400% zoom, long path/digest fixtures, and translated 30% text expansion, there
  is no clipped critical text or page-level horizontal overflow.
- Density remains readable at 50,000 finding metadata fixture via pagination; no virtualized
  row may break keyboard/screen-reader access.
- Focus is visible on every interactive control; tab order follows visual/reading order.

## 17. Deliberate exclusions

- No visual repository health score, modernization score, or risk meter.
- No raw agent chain-of-thought or streaming “reasoning.”
- No cross-run trend dashboard.
- No inline target app, HTML report, PDF, SVG, scanner HTML, or archive preview.
- No generic terminal, shell, Docker, or Compose editor.
- No dark “security operations center” theme.
- No celebratory confetti or success animation at package completion.
- No visual claim that Codex and Claude output identical prose; equivalence is shown as
  passing the common contract and artifact/domain gates.

This design makes the recommendation easy to find and difficult to overtrust. The owner
sees the consequence, the consultant can inspect the proof, and the operator always knows
which safety or review gate stands between a run and a customer-ready package.

# Design Tournament Report

## Outcome

**Selected foundation:** Contender 3, “The Clear Record”  
**Final direction:** “The Clear Fieldbook”  
**Winning score:** 8.05/10

Contender 3 won on plain-language operation, accessibility rigor, honest uncertainty,
consent clarity, report readability, responsive detail, and a coherent evidence-thread
visual language. The final specification retains those strengths while correcting its
primary lifecycle error and removing UI promises that exceeded the frozen HTTP contract.

## Contenders

### Contender 1 — The Guided Fieldbook

Strengths:

- calm **Prepare / Observe / Decide and release** mental model;
- visible safe defaults and forgiving unknown handling;
- warm paper/ledger craft and strong typography;
- explicit static-first continuation;
- useful business-language framing.

Risks:

- incomplete mapping to the full `ProductClaim` provenance contract;
- several recovery/review/package surfaces relied on data not exposed by OpenAPI;
- provider choice conflicted with launcher authority;
- correction after failed review was not fully architecture-valid.

### Contender 2 — The Evidence Desk

Strengths:

- strongest trace-rail concept;
- scope/state/coverage-first run monitoring;
- equal-criteria comparison of all three modernization paths;
- clear finding/evidence drilldown;
- strong separation of evidence, severity, confidence, and validation.

Risks:

- review, recovery, event-history, limitation, and package-stage designs exceeded exposed
  read contracts;
- multiple list/search/filter promises were not supported by cursor APIs;
- correction behavior risked editing immutable records;
- provider and in-run approval behavior needed reconciliation.

### Contender 3 — The Clear Record

Strengths:

- strongest nontechnical and assistive-technology orientation;
- complete plain-language status and consent vocabulary;
- exact accessibility, responsive, type, color, and report systems;
- no score-based false confidence;
- excellent safe-evidence and static-report rules.

Winning objection:

- its original primary flow resolved the target before saving discovery and approvals,
  which is illegal because `putDiscovery` and `putApprovals` are allowed only in `DRAFT`.

Additional objection:

- several screens assumed target snapshot detail, durable event history, review lists,
  recovery plans, limitation records, joined evidence data, report previews, or package
  stages that the frozen operations do not expose.

## Synthesis decisions

### 1. Legal setup sequence

The final flow is:

```text
launcher readiness
→ local source/profile choices
→ createRun
→ DRAFT discovery
→ DRAFT approvals/secrets
→ DRAFT setup review
→ resolveTarget
→ READY resolved-scope confirmation
→ startRun
```

All dependent screens and edit rules now follow this sequence. After resolution, setup
changes create a revision rather than mutating the run.

### 2. Explicit contract discipline

The final spec adds a screen-to-operation matrix and classifies views as server-backed,
response-derived, event-derived, generated artifact, or contract-blocked. It removes or
limits unsupported behavior:

- resolved scope shows `targetSnapshotId`, not invented commit/snapshot detail;
- activity is a bounded live SSE view, not paginated durable history;
- run/finding/evidence filters match the exact query parameters;
- evidence detail uses only `EvidenceOccurrence` fields;
- approval changes do not occur after `DRAFT`;
- review history/forms are not fabricated where no input digest/read model exists;
- package UI uses the five exposed `PackageView` states, not nine internal stages;
- report HTML is read from the downloaded package, not previewed in the privileged UI.

### 3. Architecture-valid correction

Failed review never edits immutable evidence, findings, decisions, or prior reviews. The
handoff creates a new linked run revision with `copyDiscovery:true`, reconfirms run-scoped
approvals, reruns assessment/review gates, and packages only the corrected revision.

### 4. Grafted experience strengths

From Contender 1:

- Prepare / Observe / Decide and release mental model;
- static-first continuation as a visible default;
- calm warm-ledger visual craft;
- operator-friendly unknown suggestions rather than methodological interrogation.

From Contender 2:

- trace rail grounded only in canonical links;
- scope/state/coverage-first overview;
- equal-depth modernization comparison;
- business-consequence-first findings with proof one step away.

From Contender 3:

- accessibility-maximal interaction and report rules;
- robust, granular consent;
- no color-only meaning or composite score;
- exact typography, responsive behavior, safe preview, content, and report systems.

## Material design constraints for implementation

The frozen API cannot currently support durable DRAFT form resumption, detailed target
scope after reload, general web-authored human review, recovery-plan selection, durable
event history, limitation-detail reading, or internal package-stage display. The final
spec treats these as contract blockers rather than inviting frontend invention. If product
scope requires them, architecture must publish a versioned contract revision before P6.

## Final artifact

The synthesized specification is:

`/workspace/rendervo-alt-3bcd18f5/targets/repo-assessment-kit/.agent-build/specs/design.md`


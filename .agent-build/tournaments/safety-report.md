# Safety Specification Tournament Report

**Target:** `repo-assessment-kit`  
**Selected strategy:** hostile-repository and container-escape containment  
**Final specification:** `.agent-build/specs/safety.md`  
**Date:** 2026-07-27

## Result

| Rank | Contender | Panel score | Principal strength |
|---:|---|---:|---|
| 1 | 1 | 7.9333 | End-to-end hostile source, parser, VM, broker, Compose, egress, resource, and escape strategy |
| 2 | 5 | 7.9000 | Prompt-injection authority model, proposal-only providers, finding governance, compliance wording |
| 3 | 2 | 7.1667 | Credential lifecycle, destination consent, provider disclosure, one-use VM secret delivery |
| 4 | 4 | 6.3000 | Executable dynamic safety classes, role/tenant matrix, probe budgets and authorization |
| 5 | 3 | 5.1333 | Evidence blob/occurrence separation, redaction, rendering, package and deletion rigor |

Contender 1 won because it was the only strategy that carried the malicious-repository
assumption coherently from acquisition through static parsers, provider context, typed
host/broker protocols, compiled Compose, disposable VM/rootless Docker, independent
firewall/resource ceilings, escape handling, and four-platform release tests. The final
spec preserves that spine.

## Mandatory objections resolved

### 1. Credentialed output and covert channels

The winning draft over-relied on known-value/package scanning. The final spec now states
that scanning cannot prove noninterference when a hostile credentialed target can
transform, split, encrypt, time, or steganographically encode a value.

It adds:

- least-secret, late delivery using disposable sandbox credentials only;
- normative output classes O0–O4;
- automatic `restricted` treatment for every output reachable after credential exposure;
- permanent automatic-package exclusion for raw credentialed screenshots, DOM, bodies,
  headers, traces, HAR, target logs, downloads, recordings, metrics, and artifacts;
- fixed-schema low-bandwidth O3 derivatives plus technical-human review;
- human-authored O4 summaries that never embed raw O2 bytes;
- explicit acknowledgement that even categorical derivatives retain a bounded covert
  channel and that disposable least-privilege credentials—not redaction confidence—are the
  primary control.

### 2. Frozen lifecycle alignment

The draft's invented `SECURITY_HOLD` was removed. The final spec uses only architecture
states and events:

- active incidents use the existing `cancelRun` effect and legal
  `CANCELLING -> CANCELLED` path;
- affected attempts are fenced, secrets revoked, and exact cleanup queued;
- durable signals use `warning.raised`, `capability.changed`, `coverage.changed`,
  `package.state.changed`, and `run.state.changed`;
- detailed incident records use existing `EvidenceOccurrence`, `ProvenanceActivity`,
  limitations, approvals/capabilities, and helper/broker receipts;
- terminal runs stay immutable; local session shutdown and the existing confirmed deletion
  job contain suspect packages;
- recovery after SEV-0–2 is a successor revision with `parentRunId`, never same-session or
  same-checkpoint resume.

No new canonical DTO, state, event, or API operation is introduced.

### 3. Realistic HTTPS egress enforcement

The final spec no longer claims that an opaque HTTPS proxy can enforce paths, methods, or
body categories. It distinguishes:

- `opaque-destination`: workload, host/port, resolved-address class, timing/concurrency,
  and byte ceilings only, with explicit source-exfiltration disclosure; and
- `trusted-fetch`: a release-owned application-layer adapter constructs and validates the
  TLS request from typed dependency/image/service inputs, enforces method/path/redirect/
  size/digest, stores a content-addressed cache object, then runs the target build offline.

Only trusted-fetch mode may claim enforcement of `Approval.methods` or `pathPrefix`.
Unsupported ecosystems remain offline/partial/blocked or receive coarse destination access
with candid disclosure; no semantic-data promise is made.

## Runner-up strengths grafted

### From contender 5

- Fixed hostile-content authority order and typed provider task envelopes.
- Assessed instruction/config files are evidence only and never provider configuration.
- Narrow evidence-ID lookup, proposal-only agents, fresh-context review, and provider
  inference disclosure.
- Separate technical severity, business priority, confidence, validation, CVSS/CWE, review,
  dispute, invalidation, and supersession rules.
- Technical-profile versus legal-compliance wording and prohibited absolute claims.
- Audit mapping to frozen events plus trusted provenance/evidence records.

The final spec also fills contender 5's weaker positive dynamic-authorization and
provider-tool/credential boundaries through the request guard, safety classes, and the
winner's VM/provider compartments.

### From contender 2

- Purpose/recipient/run-bound secret handles, atomic one-use redemption, revocation, and
  cleanup verification.
- Provider-specific full-home separation and constrained token modes.
- Exact SSH acquisition compartment and residual warning for broad SSH agents.
- Provider and optional-service disclosures with denial/revocation consequences.
- Detailed X25519/HKDF/AES-GCM envelope constraints and no forensic-erasure claim.

Impossible L7 proxy claims were deliberately not carried forward; they were replaced by
the trusted-fetch/opaque-destination model.

### From contender 4

- P0 passive, P1 anonymous read, P2 authenticated read, P3 session bootstrap, and PX
  prohibited classes.
- Per-control binding to compiled plan, exact internal origin, method/route, identity,
  role/tenant, fixture, side effect, budget, output class, abort, cleanup, and coverage.
- A broker-owned request guard outside browser/ZAP as the final enforcement point.
- Role/tenant negative reads without enumeration and honest partial/blocked coverage.
- Fixed request, crawl, login, screenshot, and wall-time budgets.

The temporal approval deadlock is resolved by selecting a bounded release profile through
`createRun.selectedProfiles` and creating only destination approvals in DRAFT, then
performing deterministic non-expansive authorization after compile. Any expansion requires
a successor run revision; no empty-destination approval or illegal mid-run `putApprovals`
is invented.

### From contender 3

- Evidence blob versus occurrence identity and provenance-preserving derivations.
- Layered, explicitly imperfect secret detection and typed redaction.
- Attachment-only active formats, safe derived preview, typed report AST, and static HTML
  validation.
- Frozen staging, manifest/checksum/ZIP reopen, optional age verification, ENOSPC safety,
  two-phase confirmed deletion, and inability to delete external copies.

These controls now sit inside the full hostile provider/runtime/credential threat model
rather than treating evidence hygiene as the primary boundary.

## Final release posture

The final specification is **NO-GO** until the native four-host VM/egress/request-guard/
cleanup matrix, both provider containment suites, hostile source/analyzer/Compose/parser
tests, credential-output exclusion, incident frozen-state mapping, independent security
review, and package gates all pass.

Static-only customer delivery remains valid when dynamic work is honestly blocked.
Nothing in the synthesized spec permits host Docker access, privileged DinD, direct
Compose, production credentials, destructive testing, provider bypass, silent upload,
raw credential-tainted packaging, or fabricated coverage as a fallback.

## Exhaustive critic pass

- **Synthesized score:** 8.3/10
- **Verdict:** Revise
- **Winner baseline:** 7.9333/10
- **Threshold:** 8.0/10
- **Revision:** Not run. The synthesis exceeded both the absolute threshold and the
  winning-contender baseline, so the tournament's bounded revision trigger did not fire.
- **Strongest remaining objection:** The signed per-run dynamic control plan is referenced
  by `controlPlanId`, but the frozen architecture does not expose an equally explicit
  creation/admission/transport operation for the broker to verify its digest, signature,
  fence, compiled-plan binding, and post-start origin.

This objection remains a named implementation and integration-test obligation. It does not
authorize a weaker runtime-authorization boundary or an unauthenticated side channel; any
contract correction must route through the tech lead.

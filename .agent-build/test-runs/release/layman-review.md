# P7 adversarial lay review

Date: 2026-07-28 UTC  
Reviewer lane: customer documentation and lay-language review  
Scope: customer/operator documentation plus a real deterministic offline report generated from a
safe, non-customer repository  
Customer-release authorization: **not granted**

## Verdict

**Documentation: PASS with implementation limitations stated.**

**Generated executive and decision package: FAIL lay review.**

**Overall P7 lay gate: FAIL / customer release remains blocked.**

The reports make the draft status clear, but a software owner cannot yet understand the full
decision without translation. One conclusion also recommends urgent action that is unsupported by
the same sample’s zero-finding result.

## Evidence generated

The reviewer created a temporary Git repository containing only a minimal `package.json` and
README, then ran the implemented offline path with `examples/discovery.sample.json`:

```sh
pnpm assessment:offline \
  --source /tmp/rak-lay-source.ZVgi1h \
  --project lay-review-sample \
  --discovery examples/discovery.sample.json \
  --output-root /tmp/rak-lay-output.N0TcV3 \
  --generated-at 2026-07-28T12:00:00.000Z
```

Observed source commit:
`9e690fe46f72467bb3a54fe4c5b1f3e1d83832ce`.

Observed run status: `DRAFT_VALIDATED_RELEASE_BLOCKED`.

The ZIP contained `index.html`, five HTML reports, Markdown report counterparts, assessment data,
exports, evidence, manifest, and checksums. The review read the actual executive, decision, and
coverage Markdown plus the package-index HTML through the packaging library’s strict ZIP parser.
This was a language/usability review of an internal fixture, not a customer, provider, native-host,
or release dry run.

The schema evaluator emitted warnings that some official schema string formats were ignored. The
pipeline still completed. Those warnings are not represented here as official-schema release
evidence.

## What a lay reader could understand

- The result is a draft and customer release is blocked.
- The repository was inspected without running its code or using the network.
- The three choices are repair, controlled staged replacement, and full rebuild.
- Confidence is low.
- Runtime, provider analysis, independent review, and some scanner depth were unavailable.
- The package does not claim certification or proof of security.
- The package index gives a usable report reading order.

## Findings routed to product owners

### LAY-01 — Unsupported urgent-risk recommendation

Severity: **release blocking**

The executive report says:

> The evidence supports a cautious sequence of stabilizing urgent risks…

The decision report says:

> …remediate urgent verified risks…

The same executive report says `0 static finding(s) were recorded`, and the sample contains no
validated finding supporting urgency. A lay reader could reasonably conclude that an urgent defect
was found when none was.

Required correction:

- If there is no validated material finding, say: “No material issue was established by this
  limited static run. Resolve the recorded unknowns and complete independent review before choosing
  a modernization path.”
- Use “repair urgent supported findings” only when the package contains a linked, non-invalidated
  urgent finding and its independent review state is visible.
- The recommendation and business-impact statements must reconcile with the finding inventory.

### LAY-02 — Executive report omits decision-critical sections

Severity: **release blocking**

The generated executive report contains only Conclusion, Business impact, and Release status. It
does not directly state:

- what appears worth preserving or recoverable;
- an equal-format summary of all three choices;
- the important discovery unknowns and their effects;
- what new evidence would change the recommendation; or
- the decision needed from the software owner.

Required headings and model copy:

1. **What appears worth preserving**  
   “The current evidence identifies these workflows or assets as worth preserving: … Where the
   evidence is incomplete, this section says so.”
2. **Choices considered**  
   “Repair the current system: … Replace it in controlled stages: … Build a new system: …”
3. **Important unknowns and limits**  
   “We do not yet know … This lowers confidence in … The owner should …”
4. **What would change this recommendation**  
   “Choose a different path if later evidence shows …”
5. **Decision needed from the owner**  
   “Confirm …, authorize …, or defer the decision until …”

Each section must be substantive or explicitly say that the current evidence cannot answer it.

### LAY-03 — Undefined decision jargon

Severity: **release blocking**

The decision report uses “heuristic,” “seams,” “implementation debt,” “coexistence discipline,”
“parity criteria,” “architecture review,” “runtime evidence,” and “operational risk” without a
plain-language definition.

Required replacements:

| Current phrase | Plain-language wording |
| --- | --- |
| heuristic | an initial clue that has not been independently confirmed |
| seam | a boundary where one part can be changed without changing everything |
| implementation debt | accumulated code and design problems that make change harder |
| coexistence discipline | controls needed while old and new parts run together |
| parity criteria | valuable behavior a replacement must preserve |
| architecture review | review of how the system’s parts depend on each other |
| runtime evidence | evidence collected while the application is safely running |
| operational risk | risk of interruption, failed deployment, recovery difficulty, or support burden |

The main narrative should use the right-hand wording. If a technical term remains, define it at
first use.

### LAY-04 — Coverage report exposes internal labels instead of explanations

Severity: **release blocking**

The report shows machine labels such as `architecture-boundaries`,
`dependency-vulnerabilities`, `lim_static_inference_only`, and
`lim_safe_runtime_gate_not_run`. The Limitation column gives identifiers rather than a reason,
effect, and next action.

Required correction:

- Render human names such as “System structure and boundaries” and “Known dependency
  vulnerabilities.”
- For every non-pass status, show:
  1. why the check was incomplete or did not run;
  2. what conclusion cannot be made;
  3. what safe step would improve coverage; and
  4. who should own that step when known.
- Internal IDs may appear in a technical appendix, not as the only customer explanation.

### LAY-05 — Unknowns are deferred rather than explained

Severity: **release blocking**

The coverage report says an item is “explicitly unknown; see product claims for confidence and
coverage effects.” A non-technical owner should not need to cross-reference machine data to learn
why an answer is missing.

Required correction:

For each discovery unknown, display the topic in plain language plus its recorded reason,
confidence effect, coverage effect, and follow-up. Link to the supporting data after the
explanation.

### LAY-06 — Evidence links are bare identifiers

Severity: **release blocking**

The decision report links “Evidence record” followed by a UUID-like identifier. This does not tell a
reader what supports the claim.

Required correction:

Use a descriptive label, for example: “Supporting record: Node package manifest and dependency
inventory.” Keep the stable identifier in adjacent technical metadata or the link target.

### LAY-07 — Raw Markdown is visually noisy

Severity: **minor, but must be resolved for direct Markdown delivery**

The Markdown files escape ordinary punctuation as `\.` and `\(`. HTML renders the intended
punctuation, but customers who open the Markdown source see distracting backslashes.

Required correction:

Do not escape ordinary periods or parentheses outside syntax-sensitive Markdown contexts. Verify
both rendered HTML and raw Markdown reading order.

## Owned documentation changes

The reviewer added:

- `docs/customer-quickstart.md` — purpose, discovery, evidence-source labels, coverage states,
  screenshot limits, package reading, acceptance questions, and prohibited claims;
- `docs/operator-runbook.md` — exact closed launcher verbs; signed release-bundle truth; current
  preflight behavior; provider login/status/interactive separation; strict local/SSH/static/isolated
  configuration; sandbox credential handles; run/resume; cancellation and incident response;
  ZIP/receipt verification; optional age decryption; platform notes; and troubleshooting;
- `docs/package-review-guide.md` — reading order and lay decision/evidence questions;
- `examples/discovery.sample.json` — all ten topics with two honest unknowns; and
- local static, typed SSH static, and isolated run-config examples with no secret or production
  endpoint.

The operator runbook explicitly records that current preflight receives no run configuration,
reports separate static/isolated/interactive readiness profiles, does not validate provider
login/source/output, and reports provider egress as configured but unverified. It does not turn a
configured environment into a verified-egress claim.

Documentation verification:

- Prettier check passed for `docs/`, `examples/`, and this review.
- All four examples parsed as JSON.
- A closed-shape check matched all three run samples to the required top-level and nested keys in
  `release/assessment-run.schema.json`.
- The real offline command accepted `examples/discovery.sample.json`, proving the ten-topic sample
  satisfies the implemented discovery contract.
- `RAK_ENGAGEMENT_ID=lay-review ./start-codex.sh preflight` returned the documented
  `rak-runtime-preflight/1.0.0` JSON with `providerEgress.configured:false`,
  `providerEgress.verified:false`, typed blockers, and exit 78.
- `./start-codex.sh run --config examples/run.local-static.sample.json` accepted the exact public
  syntax and failed closed with typed `orchestrator_unavailable` because this checkout did not yet
  contain the signed release orchestrator. No direct-provider fallback occurred.

## Machine-checkable re-review acceptance

Run the same no-finding fixture and a fixture with one independently corroborated material finding.
The lay gate passes only when all assertions below pass:

1. A no-finding package does not match
   `urgent (?:risk|finding)|verified risk|critical issue` in its executive or recommendation
   narrative unless the phrase explicitly says none was established.
2. Executive Markdown has one non-empty section under each exact heading:
   `What appears worth preserving`, `Choices considered`,
   `Important unknowns and limits`, `What would change this recommendation`, and
   `Decision needed from the owner`.
3. Choices considered names repair, controlled staged replacement, and full rebuild, in that order,
   with a substantive consequence and evidence state for each.
4. Executive and decision reports contain none of the LAY-03 jargon terms unless a plain definition
   appears in the same sentence or immediately following sentence.
5. Customer coverage HTML/Markdown contains no raw `lim_` identifier and no raw kebab-case domain
   label as the visible name.
6. Every `partial`, `blocked`, `not applicable`, or `not tested` coverage row has non-empty
   reason, conclusion effect, and follow-up text.
7. Every discovery unknown’s reason, confidence effect, coverage effect, and follow-up appears in
   customer-readable report text.
8. Every visible evidence link label includes a descriptive phrase besides its stable identifier.
9. Raw Markdown contains no backslash before an ordinary period or opening parenthesis in prose.
10. The executive finding count, material-issue wording, and recommendation agree with
    `data/findings.json` and review state.
11. The report still states static/runtime/provider/human limitations and does not claim
    certification, compliance, complete testing, or proof of security.
12. A lay reader can answer all ten questions in `docs/package-review-guide.md` without opening
    machine-readable JSON or asking a consultant to translate a technical term.

## Release decision

**NO-GO.** The safe sample and documentation are useful, but the implemented customer report
language fails the lay-human gate. The package must remain
`DRAFT_VALIDATED_RELEASE_BLOCKED` with `customerReleaseAuthorized:false` until the findings above
are corrected and a fresh lay review of the exact candidate package passes.

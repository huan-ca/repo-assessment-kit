# Customer quickstart

The Repository Assessment Kit helps a consultant examine one exact copy of a software repository and
compare three choices: repair the current system, replace it in controlled stages, or build a new
system.

The kit produces advice, not a verdict. It does not change the assessed repository, connect to
production, perform destructive security testing, certify compliance, or make the decision for you.

## What we need from the software owner

Before the assessment, give the consultant the best available answer for each topic below. “We do
not know” is a valid answer. An unknown must remain visible because it can lower confidence or
change what should be checked next.

1. **Target customers** — Who uses or benefits from the product?
2. **Buyers** — Who chooses, approves, and pays for it?
3. **User roles** — Who does what in the product?
4. **Customer pain** — What costly or difficult problem does it solve?
5. **Valuable workflows** — Which end-to-end tasks must keep working?
6. **Alternatives and differentiators** — What else could customers choose, and why do they choose
   this product?
7. **Revenue- or retention-critical behavior** — Which behavior affects sales, renewals, or customer
   retention?
8. **Contractual obligations** — Which service, data, security, retention, or support commitments
   are actually in customer agreements?
9. **Expected scale** — How many organizations, users, records, requests, and peak events should the
   system support?
10. **Feature-parity expectations** — Which capabilities must survive a repair, staged replacement,
    or rebuild?

The consultant records where each statement came from:

- **Owner-stated:** a named customer-side role supplied it.
- **Documented:** written product or customer material supports it.
- **Observed:** the assessment directly observed it.
- **Analytics-supported:** a named data source and time window support it.
- **Code-inferred:** repository evidence suggests it, but an owner has not confirmed it.
- **Unverified:** there is not enough support yet.
- **Conflicting:** available sources disagree.

These labels describe evidence strength. They do not rank a statement’s importance.

## What the assessment may and may not do

The operator selects either a local Git worktree or a typed Secure Shell (SSH) Git source. The kit
records the full commit identifier and a fingerprint of the inspected files. Changed and untracked
files in a local `frozen-working-tree` assessment are included and listed. The source must remain
unchanged while the assessment runs.

Static analysis can complete without launching the product. Target runtime and browser checks run
only when the bounded isolation preflight passes and the operator has approved the exact target
origins and sandbox-only credentials. If they cannot run safely, the package says so. Static results
remain useful, but confidence in runtime behavior is lower.

Only disposable, least-privileged, non-production credentials may be supplied. A configured
credential is a one-use handle; its value is not written into the run configuration or customer
package. Production accounts, data, endpoints, and credentials are prohibited.

The kit uses **bounded isolation**, not a “secure sandbox.” A hostile repository may still exploit a
vulnerability in a trusted host, virtualization, container, browser, or assessment component.
Selected, redacted evidence is sent to the chosen AI provider when provider analysis runs. The
provider’s server-side handling remains governed by that provider’s terms and settings.

## How to read the package

Start with `index.html`, then read the executive report. Use the decision report to compare all
three modernization paths under the same seven questions. Technical and security reports provide
details; the coverage-and-limitations report says what did and did not run.

The six coverage words have exact meanings:

| Status           | Meaning                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `pass`           | The stated control completed and met its stated expectation. It does not prove the whole product is safe. |
| `fail`           | The control completed and did not meet its stated expectation.                                            |
| `partial`        | Only part of the intended control completed; the report must explain the missing part.                    |
| `blocked`        | The control was planned, but a safety, access, environment, or tool boundary prevented it.                |
| `not applicable` | The control does not apply to this assessed scope; the report must say why.                               |
| `not tested`     | The control did not run for another recorded reason.                                                      |

Screenshot count is not a quality score. Screenshots are included only when an uncredentialed,
approved browser context can be captured safely. Raw screenshots from a credentialed target are
excluded because they may carry secret or customer-controlled data. “No screenshots” does not
invalidate a static assessment, but it limits claims about visible runtime behavior.

Read every important unknown, limitation, assumption, dependency, and condition that could change
the recommendation. Ask the consultant to distinguish a serious issue from a business priority:
technical severity, business urgency, evidence confidence, and independent validation are separate
judgments.

## Before accepting delivery

1. Confirm the project name and full source commit are the ones you expected.
2. Confirm every important workflow and parity obligation appears or is explicitly unknown.
3. Confirm all three modernization options receive an equally detailed comparison.
4. Read the coverage-and-limitations report, especially blocked and not-tested controls.
5. Confirm material security findings state the affected party, consequence, evidence strength,
   limit, and next action.
6. Verify the ZIP digest and internal manifest using the operator’s recorded verification steps.
7. Confirm the package says customer release is authorized. A package marked
   `DRAFT_VALIDATED_RELEASE_BLOCKED` is not a customer release, even if its ZIP is internally
   consistent.

Checksums show whether delivered bytes match the recorded bytes. They do not prove who created the
package or that the assessment found every defect.

## Important limits

- Static and passive checks cannot prove runtime security, business-logic correctness, legal
  compliance, or absence of vulnerabilities.
- Redaction and secret scanning cannot prove that unknown personal or sensitive data is absent.
- A credentialed target can encode secret-derived information in its output. The kit excludes raw
  credential-tainted output and requires review of restricted derivatives, but cannot prove that
  covert disclosure is impossible.
- Framework mappings describe technical coverage only. They are not certification, attestation,
  legal advice, or a claim that a framework applies.
- The recommendation depends on the evidence available at the recorded time. New product, contract,
  scale, security, or coupling evidence may change it.

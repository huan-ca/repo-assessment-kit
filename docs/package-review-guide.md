# Customer package review guide

Use this guide after the ZIP digest and internal manifest have been verified. A consistent ZIP can
still be an internal draft, so check the package status and customer-release authorization first.

## Reading order

1. `index.html` — package identity, reading guide, evidence labels, coverage words, and integrity
   instructions.
2. `reports/executive.html` — recommendation, business consequence, important limits, and decision
   needed from the owner.
3. `reports/decision.html` — equal comparison of repair, staged replacement, and rebuild.
4. `reports/security.html` — security findings and which static/runtime techniques ran.
5. `reports/coverage-limitations.html` — all fifteen areas, every gap, and its follow-up.
6. `reports/technical.html` — repository structure, architecture, maintainability, source locations,
   and detailed evidence.

Use Markdown versions when HTML is inconvenient. The reports work offline and contain no JavaScript,
external assets, forms, or embedded target HTML.

## Questions for a lay reviewer

Without help from the consultant, can you answer:

1. What is the recommended path?
2. What business problem or risk makes action worthwhile?
3. Who is affected?
4. What should happen next?
5. Why is this path preferred over each alternative?
6. How confident is the recommendation, and why?
7. Which important facts remain unknown or disputed?
8. What did not run, and how does that limit the conclusion?
9. What new fact would change the recommendation?
10. What decision does the software owner need to make now?

Any unexplained acronym, implementation term, score, ambiguous status, or unsupported certainty in
the executive report is a review failure. Record the exact phrase and a plain-language replacement.
Do not silently reinterpret it.

## Evidence and coverage

A supporting record shows where a claim came from. It does not automatically make the claim true.
Check whether the report says the source is owner-stated, documented, observed, analytics-supported,
code-inferred, unverified, or conflicting.

Coverage describes the controls that ran. It is not a security score. Read the reason and effect for
every `partial`, `blocked`, `not applicable`, and `not tested` result. A static-only package can be
valid, but it cannot support claims that require a running application.

Screenshots are optional. Their absence can be the safer result. Raw images from credentialed pages
are excluded because they may contain target-selected or secret-derived data.

## Decision review

The decision report must compare the same seven questions for all three options:

- **Recoverability:** How much of the current system can be repaired and retained?
- **System boundaries:** Can parts be changed without unsafe effects on unrelated parts?
- **Security risk:** How serious and widespread are the supported security concerns?
- **Engineering risk:** How difficult is the system to understand, change, test, and operate?
- **Critical feature parity:** Which valuable behavior must a replacement preserve?
- **Expected scale:** Can the option support the confirmed future demand?
- **Rebuild feasibility:** Can a new system be delivered without unacceptable discovery, transition,
  or business risk?

Separate the recommendation from certainty. Confidence describes the strength and completeness of
the current evidence. Assumptions and dependencies say what the advice relies on. Reversal
conditions say which new facts could make another path better.

## Claims the package must not make

Reject or correct statements that say the repository is safe, free of vulnerabilities, AI verified,
certified, compliant, guaranteed, completely tested, or suitable for production merely because a
control or package validator passed.

Framework mappings are technical coverage aids. The customer must confirm applicability; the kit
does not provide certification, attestation, or legal advice.

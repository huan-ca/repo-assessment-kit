# Repository Assessment Kit — Product Brief

## One-liner

A portable, evidence-driven repository assessment kit for software consultants and customer software owners that runs through Codex or Claude Code in a Docker sandbox and produces a customer-ready decision package for choosing remediation, incremental replacement, or full rebuild.

## Target users / personas

### Primary: software consultant / assessor

- Context: Leads a time-bounded technical due-diligence or modernization engagement for a large, unfamiliar, often AI-generated codebase.
- Needs: Repeatable coverage, defensible evidence, product-to-code traceability, independent security findings, and a recommendation that can survive customer scrutiny.
- Constraints: May have limited repository history, incomplete documentation, partial credentials, and no safe access to production systems. Must be able to explain both what was tested and what could not be tested.

### Primary: assessment operator

- Context: Prepares the sandbox, supplies a repository URL or local path and approved credentials, launches the assessment, monitors progress, and delivers the generated package.
- Needs: Clear prerequisites and launch paths for both Codex and Claude Code, safe defaults, immutable target selection, predictable output location, and actionable failure or limitation reporting.
- Constraints: Works on macOS or Linux across ARM64 and x86-64. May need SSH access to a private repository. Must not accidentally alter the source repository, expose SSH material, contact production services, or perform destructive actions.

### Primary recipient: customer software owner

- Context: Owns the assessed product, its business outcomes, and the decision to remediate, replace incrementally, or rebuild.
- Needs: A consultant-ready explanation of current system health, valuable workflows, feature-parity obligations, security risk, rebuild feasibility, evidence strength, uncertainty, and tradeoffs among the three decision paths.
- Constraints: May be non-specialist, may hold product knowledge not present in the codebase, and needs owner claims kept distinct from observed or inferred facts.

### Secondary stakeholders

- Engineering and security leaders who validate technical findings and use the evidence for follow-on planning.
- Product, commercial, and customer-success stakeholders who clarify critical workflows, contractual obligations, differentiation, and retention or revenue dependencies.

## Jobs to be done

1. When beginning an assessment, help the consultant capture enough product and customer context to judge the software against real business needs rather than code quality in isolation.
2. When given a repository, establish exactly which immutable commit is in scope and assess it without modifying the target source.
3. When analyzing an unfamiliar system, provide traceable coverage of repository structure, stack, architecture, engineering quality, features and use cases, runtime behavior, and security.
4. When the application can be launched safely, exercise non-destructive runtime controls and record what passed, failed, was only partially tested, was blocked, did not apply, or was not tested.
5. When evidence is incomplete or contradictory, separate facts, owner statements, documentation, observed behavior, analytics support, code inference, unverified claims, and conflicts so the final recommendation does not overstate certainty.
6. When choosing a modernization path, compare remediation, incremental replacement, and full rebuild against system recoverability, boundaries, security exposure, feature-parity burden, and rebuild feasibility.
7. When delivering the engagement, provide a redacted, integrity-verifiable ZIP containing reports and the evidence needed for independent review, while making omissions and limitations explicit.
8. When operating in different agent environments, run the same assessment intent through either Codex or Claude Code with equivalent required outputs and quality gates.

## MVP scope

### Must

1. **Guided product and customer discovery**
   - Capture target customers, buyers, user roles, customer pain, valuable workflows, competitive alternatives and differentiators, revenue- and retention-critical behavior, contractual obligations, expected scale, and feature-parity expectations.
   - Preserve unanswered items as explicit unknowns; do not fabricate answers or silently substitute code inference for customer knowledge.

2. **Controlled target intake and immutable scope**
   - Accept either an SSH Git URL or an existing local repository path.
   - Resolve and record the exact commit SHA assessed.
   - Keep the assessed source unchanged.
   - Permit SSH use inside the sandbox for private cloning while preventing SSH keys, agent sockets, configuration, and related sensitive material from entering generated artifacts.

3. **Complete static assessment**
   - Assess repository composition, detected stack, system architecture and boundaries, engineering quality and maintainability, features and use cases, runtime readiness, and security.
   - Trace business-critical workflows and feature-parity expectations to supporting or missing implementation evidence.
   - Give security its own evidence set, findings, coverage statement, runtime tests, and independent validation rather than treating it only as a subsection of a general technical report.

4. **Safe runtime assessment**
   - Detect whether the assessed application has a safe, usable sandbox runtime before requiring browser automation.
   - Attempt to launch the assessed application only when prerequisites and isolation allow it.
   - Run safe, non-destructive runtime and browser checks automatically when launch succeeds.
   - When the customer cannot provide a safe runnable environment, complete the static assessment without Playwright and record runtime/browser coverage as `blocked` or `not applicable`; this condition must not invalidate the rest of the assessment package.
   - Use only credentials explicitly supplied for the sandbox.
   - Never assume or use production credentials, databases, APIs, or other production systems; never perform destructive external actions.
   - Run assessed applications in isolated Docker or Compose environments without mounting the host Docker socket.
   - Record each planned control as `pass`, `fail`, `partial`, `blocked`, `not applicable`, or `not tested`, with evidence and a reason for every result other than pass.

5. **Evidence model, validation, and coverage accounting**
   - Label product assertions as `owner-stated`, `documented`, `observed`, `analytics-supported`, `code-inferred`, `unverified`, or `conflicting`.
   - Link material findings and decision claims to reproducible evidence.
   - Validate evidence presence and references before release.
   - Report assessment scope, exclusions, limitations, failed or blocked checks, and coverage without presenting untested areas as successful.
   - Redact secrets and sensitive authentication material from all deliverables.

6. **Decision support**
   - Provide a recommendation among remediation, incremental replacement, and full rebuild.
   - Compare all three options using explicit evidence and consistent criteria, including recoverability, system boundaries, security and engineering risk, critical feature parity, expected scale, and rebuild feasibility.
   - State confidence, assumptions, dependencies, and conditions that could change the recommendation.
   - Do not claim regulatory applicability or legal compliance without customer confirmation.

7. **Security baseline and profile guidance**
   - Apply a general security baseline.
   - Support configurable framework overlays without implying certification or compliance.
   - Recommend deeper security or compliance profiles when repository, runtime, or discovery signals warrant them, and identify the observed signals behind each recommendation.

8. **Customer-ready output package**
   - Store all run output beneath `generated/<project>-<commit>-<timestamp>/` in the kit repository, with `generated/` excluded from version control.
   - Package final reports, security findings, evidence, screenshots, logs, machine-readable assessment data, coverage and limitations, a file manifest, checksums, and the final ZIP from that run directory.
   - Ensure reports are coherent, navigable, free of placeholders, and suitable for direct customer delivery without manual completion of core content.
   - Write the executive summary, business impact, options, recommendation, confidence, and limitations in plain language understandable to a non-technical software owner. Keep jargon out of the main narrative or define it immediately.
   - Preserve precise technical findings, reproduction evidence, source locations, and machine-readable details in clearly linked technical sections and appendices.

9. **Codex and Claude Code compatibility**
   - Provide documented, working `start-codex.sh` and `start-cc.sh` launchers.
   - Preserve the same required discovery, assessment, evidence, safety, validation, and packaging outcomes across both agent environments; agent-specific implementation details may differ.

10. **Portable Docker-sandbox operation and release readiness**
    - Run in a Docker sandbox on macOS and Linux hosts using ARM64 or x86-64, with WSL documented as best-effort.
    - Allow the minimum outbound access needed for agent authentication, Git cloning, and dependency or assessment-tool installation.
    - Include complete operator and customer-deliverable documentation.
    - Complete successful end-to-end dry runs through both supported agent launch paths before release, with no placeholder or deferred core capability.

### Should

- Allow operators to resume or rerun a failed assessment without confusing evidence from separate attempts.
- Allow assessment policy and framework overlays to be selected per engagement while retaining the general baseline.
- Produce a concise executive decision summary in addition to the detailed consultant and technical evidence.
- Make it easy to compare coverage and findings across repeated assessments of different commits without treating cross-run comparison as part of the core decision workflow.
- Provide clear, actionable remediation themes and follow-on discovery needs without expanding into a full implementation roadmap.

### Won't (this version)

- Modify, remediate, refactor, or rebuild the assessed application.
- Make the final business decision on the customer's behalf or present the recommendation as certainty.
- Connect to production credentials, production data stores, production APIs, or destructive external integrations.
- Perform destructive penetration testing, denial-of-service testing, social engineering, or exploit activity beyond explicitly safe, non-destructive controls.
- Claim legal or regulatory applicability, certification, attestation, or compliance.
- Guarantee successful runtime launch for every repository; inability to launch must become a documented, evidenced limitation.
- Require Playwright, browser screenshots, or a runnable sandbox application for repositories where those capabilities are unavailable or inapplicable.
- Support arbitrary agent runtimes beyond Codex and Claude Code.
- Promise first-class Windows-native operation; WSL is best-effort.
- Serve as a hosted multi-tenant assessment service, engagement CRM, or long-term findings dashboard.
- Generate a complete remediation or rebuild implementation plan as a core deliverable.

## Success metrics

Release success is measured by controlled dry runs and package validation, not by report volume.

- **End-to-end completion:** 100% of required release dry runs—at least one through Codex and one through Claude Code—finish from target intake through validated ZIP creation.
- **Required deliverable completeness:** 100% of dry-run packages contain every required report and artifact class in the manifest; automated/package validation reports zero missing files, broken internal evidence references, or checksum mismatches.
- **Evidence traceability:** 100% of material findings and every factor used in the final path recommendation have at least one referenced evidence item or are explicitly labeled unverified/conflicting.
- **Coverage honesty:** 100% of planned runtime controls and assessment domains receive an allowed status; every `partial`, `blocked`, `not applicable`, and `not tested` status includes a reason.
- **Source integrity:** The target commit remains unchanged in 100% of dry runs, and the recorded commit SHA matches the assessed source.
- **Safety:** Zero observed use of unsupplied credentials, production systems, destructive external actions, or host Docker-socket mounts in release dry runs.
- **Artifact hygiene:** Zero detected SSH material, authentication secrets, or known sensitive credential values in generated packages after redaction validation.
- **Cross-agent equivalence:** Both launch paths satisfy the same must-have acceptance suite and required output contract, with no missing assessment domain or core deliverable in either path.
- **Decision usability:** In release review, a consultant can identify the recommendation, comparison of all three paths, confidence, critical evidence, limitations, and next required decision from the delivered package without editing placeholder content.
- **Plain-language usability:** A non-technical software owner can explain the principal risks, business consequences, recommendation, alternatives, and important unknowns after reading the executive report without needing the consultant to translate unexplained technical jargon.

## Acceptance criteria

### AC-1 — Guided product and customer discovery

- Given a new assessment, the workflow requests and records each required discovery topic: target customers, buyers, roles, pain, valuable workflows, alternatives and differentiators, revenue/retention-critical behavior, contractual obligations, scale, and feature-parity expectations.
- If an answer is unavailable, the final package records it as an unknown and explains its effect on assessment confidence or coverage.
- Product assertions in the final package use only the allowed provenance labels and do not present a code inference as owner-confirmed fact.

### AC-2 — Controlled target intake and immutability

- An operator can start an assessment from a valid SSH Git URL and, separately, from an existing local repository path.
- The run records a full commit SHA before assessment and includes that SHA in run identity and final deliverables.
- A before/after integrity check shows no changes made by the assessment to tracked or untracked content in the target source.
- Generated outputs contain no copied SSH keys, SSH agent material, or private SSH configuration.

### AC-3 — Complete static assessment

- The final package contains substantive assessments of repository composition, stack, architecture and boundaries, engineering quality, features/use cases, runtime readiness, and security.
- Each stated critical workflow or parity requirement is linked to implementation evidence, identified as missing, or marked unverified.
- Security has a distinct report or equivalent independently reviewable deliverable with its own findings, evidence, coverage, runtime results, and validation outcome.

### AC-4 — Safe runtime assessment

- Before invoking Playwright or other dynamic tooling, the workflow performs and records a runtime-capability gate.
- When a fixture application is launchable under the allowed conditions, the workflow launches it in an isolated Docker/Compose environment and automatically executes the applicable non-destructive runtime checks.
- The assessed application is not given the host Docker socket.
- When launch or browser automation is unavailable, unsafe, or blocked, the workflow does not bypass the constraint or fail the static assessment; it records the reason, attempted safe steps, affected coverage, and follow-up needed.
- Every planned runtime control has exactly one allowed status and supporting evidence; every non-pass status has a reason.
- A test using sentinel production-like credentials and endpoints confirms they are not accessed unless those exact credentials were explicitly supplied and declared sandbox-safe; destructive actions are never attempted.

### AC-5 — Evidence validation, coverage, and redaction

- Every material finding and decision factor resolves to an existing evidence item or is visibly labeled unverified/conflicting.
- Package validation fails clearly when a required artifact, evidence reference, manifest entry, or checksum is missing or invalid.
- The package identifies included scope, exclusions, limitations, blocked checks, and untested areas.
- A seeded-secret dry run demonstrates that known secret values and SSH material do not appear in reports, evidence, logs, screenshots, manifests, machine-readable data, or the ZIP.

### AC-6 — Modernization decision support

- The final report compares remediation, incremental replacement, and full rebuild using the same stated evaluation criteria.
- It recommends one path or a conditional sequence, cites evidence for the recommendation, and states confidence, assumptions, dependencies, and reversal conditions.
- The report does not state that a framework legally applies or that the assessed product is compliant unless customer-confirmed applicability is explicitly recorded; even then, it avoids unsupported certification claims.

### AC-7 — Security baseline and overlays

- Every assessment applies and reports a general security baseline.
- An operator can configure a supported framework overlay, and results from the baseline and overlay remain distinguishable.
- When observed signals indicate a deeper profile, the package names the recommended profile, cites the triggering signals, and labels the recommendation as requiring customer confirmation.

### AC-8 — Customer-ready package

- All run artifacts are contained within one correctly named `generated/<project>-<commit>-<timestamp>/` directory, and the repository configuration excludes `generated/` from version control.
- The run directory and final ZIP contain the required reports, evidence, screenshots when captured, logs, machine-readable data, coverage and limitations, manifest, and checksums.
- Checksums verify against packaged files, and the manifest identifies every customer-deliverable file.
- A release-content scan finds no placeholders, TODO markers standing in for core capability, template instructions, or required sections awaiting manual completion.
- A consultant review confirms the package can be delivered as generated and the executive recommendation is consistent with the detailed evidence.
- A lay reviewer can understand the executive report's conclusions, business impact, options, confidence, and limitations; unexplained technical acronyms or implementation jargon in that report fail package validation/review.

### AC-9 — Cross-agent compatibility

- `start-codex.sh` completes a documented end-to-end dry run and creates a validated customer-ready ZIP.
- `start-cc.sh` completes the same documented end-to-end dry run and creates a validated customer-ready ZIP.
- Both outputs pass the same acceptance suite for discovery coverage, assessment domains, evidence provenance, runtime safety, security independence, package contents, redaction, manifest integrity, and checksums.

### AC-10 — Platform, documentation, and release readiness

- Documented smoke tests pass on macOS/ARM64, macOS/x86-64 where available, Linux/ARM64, and Linux/x86-64; any environment unavailable before release is an explicit release blocker unless the customer revises the platform constraint.
- WSL limitations and best-effort setup are documented without representing WSL as a guaranteed platform.
- Operator documentation covers prerequisites, repository inputs, approved credentials, outbound-access needs, both launchers, safe runtime boundaries, output locations, failure recovery, and package verification.
- Customer-facing documentation explains evidence provenance, status meanings, coverage, limitations, decision criteria, and how to review integrity checks.
- Release approval requires all Must acceptance criteria to pass and no core capability to be represented by a placeholder or deferred task.

## Constraints

### Platform and operation

- The kit must operate inside a Docker sandbox.
- Supported hosts are macOS and Linux on ARM64 and x86-64. WSL support is best-effort and must be documented as such.
- Inputs must include SSH Git URLs and existing local repository paths.
- The target is an immutable commit SHA and must not be modified by assessment activity.
- All local run output must remain under the gitignored `generated/<project>-<commit>-<timestamp>/` path in the kit repository.
- Codex and Claude Code are equally required execution environments, with explicit launchers for each.

### Security and privacy

- SSH access may be exposed inside the assessment container for private cloning, but SSH material must never enter generated artifacts.
- Assessed applications must run in isolated Docker/Compose environments without access to the host Docker socket.
- Only explicitly supplied sandbox credentials may be used.
- Production credentials, databases, APIs, and destructive external actions are prohibited.
- Outbound access is permitted only as needed for agent authentication, Git cloning, and dependency or tool installation.
- Reports must be redacted and validated before packaging.

### Product and evidence quality

- Product/customer discovery is required, not optional context.
- Evidence provenance must distinguish owner-stated, documented, observed, analytics-supported, code-inferred, unverified, and conflicting assertions.
- Runtime results must use the defined status vocabulary.
- Security requires dedicated evidence, runtime testing where possible, and independent validation.
- General baseline checks may be supplemented by configurable overlays, but the kit may not infer legal applicability or claim compliance without customer confirmation.
- The customer-ready package must include evidence, screenshots where produced, logs, machine-readable data, coverage, limitations, manifest, checksums, and ZIP.

### Delivery

- Completeness and reliability take priority over a fixed deadline; no delivery date is currently imposed.
- This planning phase chooses no implementation stack and defines no screen or API design.
- The release is production-ready only after successful end-to-end dry runs and removal of all placeholders or deferred core capabilities.

## Risks & assumptions

### Risks

- **Agent variance:** Codex and Claude Code may interpret instructions or collect evidence differently, threatening cross-agent equivalence and repeatability.
- **False confidence from partial coverage:** A polished report may obscure blocked runtime checks, missing business context, or inferred product behavior unless provenance and limitation gates are enforced.
- **Unsafe target execution:** Unknown applications may contain malicious, destructive, or production-bound behavior even when launched in a container.
- **Container isolation gaps:** Misconfiguration could expose host resources, local credentials, networks, or the Docker daemon.
- **Secret leakage:** Repository contents, logs, screenshots, command output, environment variables, or SSH forwarding could place sensitive material in the generated package.
- **Runtime diversity:** Repositories may be incomplete, multi-service, platform-specific, dependency-heavy, or impossible to launch without prohibited access.
- **Assessment breadth:** “Complete” can become unbounded across languages, architectures, and security frameworks; the product must disclose supported coverage rather than imply universality.
- **Weak product evidence:** Owners may be unavailable or unable to supply analytics, contractual, customer, or feature-parity facts, limiting the modernization recommendation.
- **Recommendation bias:** Architecture or security findings alone may overweight rebuild despite high parity cost, or overweight remediation despite poor recoverability.
- **Framework overreach:** Automatically suggested profiles may be mistaken for applicability or compliance judgments.
- **Packaging integrity drift:** Reports, evidence, manifests, checksums, and ZIP content may diverge if validation is not performed at the final packaging boundary.
- **Platform matrix cost:** Reliable ARM64 and x86-64 behavior across macOS and Linux may require substantial testing and compatibility handling.

### Assumptions

- Engagement operators have authorization to inspect the supplied repository and to run it in an isolated assessment environment.
- Operators can supply only credentials and endpoints that are approved and safe for sandbox use.
- Required agent authentication and Git access can be made available inside the Docker sandbox without copying secrets into output.
- Most targets expose enough static evidence to produce a useful assessment even if runtime execution is blocked.
- Customer stakeholders can provide at least some product and target-customer context; missing answers can be carried as explicit uncertainty.
- Evidence-backed conditional recommendations are valuable even when the kit cannot select one unconditional modernization path.
- Screenshots are required in the package when safely generated and relevant to runtime evidence, but a non-visual or non-runnable target can legitimately have none if the manifest records the capability-gate outcome and coverage limitation.
- “Independent security validation” means a separately reviewable validation step or perspective with its own recorded outcome; the exact implementation mechanism remains an architecture decision.

## Open questions

- **[User / product owner]** Which concrete repository types, languages, and application shapes must the first production release support, and which may be reported as unsupported?
- **[User / product owner]** What minimum runtime security control set defines the general baseline, and which framework overlays must ship in the first release?
- **[Security reviewer + user]** What network isolation policy should assessed applications receive by default, especially when dependency installation requires outbound access but application runtime should not contact arbitrary endpoints?
- **[Security reviewer]** What threat model and escape-response procedure governs potentially malicious repositories?
- **[User / product owner]** What qualifies as “independent validation” for security and for the overall evidence package: a second agent pass, deterministic validation, human sign-off, or a required combination?
- **[Architect]** How will parity of required outcomes be measured across nondeterministic Codex and Claude Code runs without requiring byte-identical reports?
- **[User / product owner]** Which machine-readable formats and schemas are contractually required for assessment data, findings, provenance, coverage, manifests, and checksums?
- **[User / product owner]** Which screenshots are mandatory—for example, launched application states, runtime controls, or only evidence-bearing views—and when is “no screenshots applicable” acceptable?
- **[User / product owner]** Are macOS/x86-64 release tests mandatory on physical hardware, or may verified emulation/hosted runners satisfy that platform criterion?
- **[User / product owner]** What customer or internal review role is authorized to approve customer readiness after the automated gates pass?
- **[Research scout]** What capabilities and constraints differ between current Codex and Claude Code container authentication, non-interactive operation, session persistence, and artifact access?
- **[Research scout]** Which safe static and dynamic assessment tools cover the required host architectures without creating licensing or redistribution restrictions?

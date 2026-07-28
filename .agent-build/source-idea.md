# Source Idea: Repository Assessment Kit

## Target and mode

- Target: `repo-assessment-kit`
- Location: `targets/repo-assessment-kit/`
- Mode: Greenfield
- Remote: None yet; the user will push the completed repository later.

## Outcome

Create a portable, evidence-driven repository assessment kit for Codex and Claude Code that produces a consultant-ready package for deciding among remediation, incremental replacement, and full rebuild.

## Problem

Consultants and software owners cannot reliably assess large, AI-generated codebases from a security scan or single agent prompt. They lack trustworthy coverage, product and customer context, feature-parity evidence, runtime documentation, and an objective basis for choosing remediation versus rebuilding.

## Lens

Architecture-led, with security and correctness as mandatory deep-review lenses. Prioritize recoverability, system boundaries, feature traceability, and rebuild feasibility. Security must have its own evidence, runtime testing, and independent validation rather than appearing only as a section of a general report.

## Definition of done

A fully customer-ready production release, not a prototype:

- Complete guided product and target-customer discovery.
- Repository, stack, architecture, engineering-quality, feature/use-case, runtime, and security assessment.
- Automatic safe runtime security testing when the application can be launched.
- Evidence validation, limitations and coverage accounting, redaction, manifests, checksums, screenshots, and consultant-ready ZIP packaging.
- Cross-compatible operation with Codex and Claude Code.
- `start-codex.sh` and `start-cc.sh` launchers.
- Complete documentation and no placeholders or deferred core capabilities.
- Successful end-to-end dry runs before release.

## Constraints

- Run inside a Docker sandbox.
- Support macOS and Linux on ARM64 and x86-64; document WSL as best-effort.
- Provide SSH access inside the container for private repository cloning while keeping SSH material out of generated artifacts.
- Support both SSH Git URLs and existing local repository paths.
- Assess an immutable commit SHA and avoid modifying the target source.
- Support isolated Docker/Compose execution for assessed applications without mounting the host Docker socket.
- Use only explicitly supplied sandbox credentials. Never assume or use production credentials, production databases, production APIs, or destructive external actions.
- Allow required outbound access for agent authentication, Git cloning, and dependency/tool installation.
- Store all local run output under a gitignored `generated/<project>-<commit>-<timestamp>/` directory in the assessment-kit repository.
- Package reports, evidence, screenshots, logs, machine-readable data, manifests, checksums, and the final ZIP from that generated run directory.
- Automatically exercise safe, non-destructive runtime controls when possible and classify tests as pass, fail, partial, blocked, not applicable, or not tested.
- Automatically recommend deeper security/compliance profiles from observed signals, but never claim legal or regulatory applicability or compliance without customer confirmation.
- Ship a general security baseline with configurable framework overlays.
- Prioritize completeness and reliability; there is no fixed delivery deadline.

## Product-context requirement

The guided intake must capture target customers, buyers, user roles, customer pain, valuable workflows, competitive alternatives and differentiators, revenue/retention-critical behavior, contractual obligations, expected scale, and feature-parity expectations. Product assertions must distinguish owner-stated, documented, observed, analytics-supported, code-inferred, unverified, and conflicting evidence.

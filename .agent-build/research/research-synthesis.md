# Research synthesis: build recommendation for architecture

_Synthesized 2026-07-27 from the four P0 research reports and the confirmed brief,
decisions, and plan._

## Question

What single architecture should the Repository Assessment Kit freeze so it can assess an
immutable, potentially hostile repository through either Codex or Claude Code, preserve
evidence integrity, run safe static and capability-gated dynamic checks, and produce the
same required customer package on macOS and Linux across ARM64 and x86-64?

This unblocks P1. “Good enough” means the architecture can be implemented without P4–P6
inventing trust boundaries or data contracts, and that every current feasibility gap is
either a release gate or an explicitly optional capability.

## Recommendation

**Build a schema-first, capability-separated control plane with provider adapters, isolated
static analyzers, and a brokered disposable-VM runtime. Confidence: high in the component
and contract boundaries; medium in release feasibility until the four-host matrix,
Claude Code path, Linux ARM64 browser path, and SQLite driver are exercised.**

The architecture should have these layers:

1. **Trusted kit control plane.** A Fastify/React application owns intake, the run state
   machine, policy decisions, evidence indexing, resume/cancel, validation, redaction, and
   packaging. SQLite is operational state only. Customer artifacts are versioned native
   JSON plus files under one run root; neither model prose, scanner output, nor SQLite is
   canonical.
2. **Two thin provider adapters.** Use separate pinned Codex and Claude Code images and
   separate provider home volumes, a common allowlisted kit command surface, provider-
   neutral workflow/schema sources, and provider-specific instruction/skill wrappers.
   Use `codex exec` with `workspace-write`/`never` and `claude -p` with `dontAsk` plus
   explicit allow rules for unattended work. Never enable permission-bypass by default
   ([agent-runtime report](./agent-runtime-compatibility.md);
   [OpenAI sandbox guidance](https://learn.chatgpt.com/docs/agent-approvals-security);
   [Anthropic permissions](https://code.claude.com/docs/en/permissions)).
3. **Immutable intake and scan snapshot.** Resolve the full Git commit, separately record
   the exact source-tree snapshot when a supplied local repository has uncommitted or
   untracked content, and never scan the operator's live tree. Export a content-addressed
   snapshot to read-only analyzer mounts. Static tools receive no provider home, SSH
   material, Docker API, target credentials, or network.
4. **Isolated static analyzer pool.** Run the kit walker, scc, Syft, OSV-Scanner, Gitleaks,
   Trivy, Opengrep with kit-owned rules, and PMD/CPD as pinned non-root, no-network,
   resource-bounded adapters. Preserve native outputs as evidence and normalize them into
   the native contract. Do not run package managers, builds, target tests, executable
   project configuration, plugins, autofix, or target rules in the baseline
   ([toolchain report](./assessment-toolchain.md)).
5. **Separate dynamic-runtime plane.** A trusted host lifecycle helper creates a
   disposable, resource-bounded Lima VM in plain mode with no mounts or forwarding. In
   the VM, a narrow broker is the only client of a directly installed rootless Docker
   Engine. The broker rejects unsafe Compose constructs before resolution, compiles
   accepted input into a generated restricted project, and runs the application and
   trusted Playwright/ZAP probes on an internal network. Neither agents nor target
   containers receive any Docker API, provider credential, host mount, or generated
   output path ([sandbox report](./sandbox-and-nested-containers.md);
   [Docker Compose trust model](https://docs.docker.com/compose/trust-model/);
   [Docker rootless mode](https://docs.docker.com/engine/security/rootless/)).
6. **Native evidence and release pipeline.** Make RAK-native JSON, validated by vendored
   JSON Schema Draft 2020-12 plus semantic validators, the source of truth. Project
   findings to SARIF 2.1.0 Errata 01 and inventory to CycloneDX 1.7. Freeze and redact a
   staging tree, generate a JCS-canonical manifest and SHA-256 checksums, validate a newly
   reopened ZIP, and emit a detached ZIP digest. Optional age encryption wraps the
   already validated plain ZIP and never replaces redaction
   ([standards report](./standards-and-formats.md);
   [JSON Schema 2020-12](https://json-schema.org/draft/2020-12);
   [SARIF 2.1.0 Errata 01](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html);
   [CycloneDX 1.7](https://cyclonedx.org/docs/1.7/json/)).

This is one system with explicit capability tiers, not one large privileged agent
container. Static assessment and a valid package must complete when dynamic execution is
blocked. Dynamic coverage is additive and must never weaken a boundary to turn a blocked
result into a pass.

## Resolved conflicts and required reinterpretations

### “Runs in a Docker sandbox” versus safe nested Docker

The UI, control plane, provider adapters, and static analyzers run in the outer Docker
sandbox. Hostile target Docker/Compose workloads must run across a second boundary in a
disposable VM. Running rootless DinD directly in the outer sandbox still requires a
privileged outer container; mounting the host socket, even read-only or through a generic
proxy, gives a daemon client host-equivalent powers. Docker also treats Compose as trusted
input, so a sidecar daemon alone does not contain malicious configuration
([Docker rootless DinD guidance](https://docs.docker.com/engine/security/rootless/tips/);
[Docker daemon protection](https://docs.docker.com/engine/security/protect-access/)).

Therefore the MVP requirement must be interpreted as **Docker-sandboxed kit operation plus
a host-created disposable VM for hostile target execution**, not “every process is nested
inside the one outer Docker container.” If the product owner instead requires all
components to run strictly inside Docker with no trusted host helper or VM prerequisite,
portable hostile Compose execution is not currently feasible under the no-host-socket
rule. The compliant behavior would be static-only with runtime `blocked`, not privileged
DinD.

### Local-first assessment versus provider data flow

Local scanners and artifact generation avoid optional scanner-cloud uploads, but Codex and
Claude Code are provider-backed agents: prompts and the repository context supplied to
them cross the provider inference boundary. “Local-first” must not be described as “source
never leaves the machine.” Architecture and UX must make provider, model, data categories,
and policy/retention implications visible before a run, and must minimize what the adapter
sends. Optional hosted scanners remain a separate, per-run consented egress class. Agent
authentication/inference, Git acquisition, tool updates, dependency acquisition, optional
services, and target runtime must have separate network identities and audit states.

### Read-only local repositories versus an immutable assessed identity

A Git commit identifies tracked committed content, but a local path may contain untracked
or modified files. The architecture must not silently label such a working tree as the
commit alone. It should either:

- default to exporting exactly the recorded commit and report that working-tree changes
  were excluded; or
- with explicit operator selection, assess a frozen working-tree snapshot identified by
  both its base commit and a deterministic tree/file-manifest digest.

In both cases, hash/integrity-check the supplied source before and after and never mount the
live source writable. This preserves AC-2 without pretending a dirty tree is represented by
its `HEAD`.

### Cross-agent equivalence versus identical output

Equivalence means both providers satisfy the same required schemas, domain/control matrix,
state transitions, evidence-reference rules, decision criteria, validation rules, and
package acceptance suite. It does not mean identical prose, tool-call order, evidence
volume, or ZIP bytes. Deterministic engine validators—not a second model assertion—decide
whether an output is complete. Decision-critical reasoning and security conclusions then
receive an independent recorded review perspective.

### Scanner output versus canonical contracts

Scanner-native JSON is raw evidence. Scanner-produced SARIF and CycloneDX are useful inputs
or projections, but cannot represent the full run, provenance, control, coverage, or
decision model. In particular, architecture must not assume Syft's emitted CycloneDX
version/profile automatically satisfies RAK 1. Normalize from pinned native output and
generate/validate the required CycloneDX 1.7 repository-discovery projection. Unknown
scanner/schema versions fail the adapter or become reduced coverage; they never become
“zero findings.”

### Security baseline versus compliance

For web applications, applicable OWASP ASVS 5.0.0 Level 1 controls are the default
application baseline; WSTG 4.2 supplies only authorized safe runtime techniques; OWASP Top
10:2025 is grouping only; and NIST SSDF 1.1 applies only to repository/process evidence
([OWASP ASVS](https://github.com/OWASP/ASVS/tree/v5.0.0_release);
[OWASP WSTG](https://owasp.org/www-project-web-security-testing-guide/);
[NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final)).
The six-state RAK control result is technical coverage, not certification. Framework
applicability may be `not-assessed`, `customer-stated`, or `customer-confirmed`, never
auto-determined. Missing organizational evidence is not automatically a failed SSDF
practice.

## Mandatory release gates

These gates implement existing Must requirements. They are not optional backlog items.

| Gate | Required proof before release | Why mandatory |
|---|---|---|
| Four-host runtime matrix | Native smoke/adversarial tests on macOS ARM64, macOS x86-64, Linux ARM64, and Linux x86-64 for Lima lifecycle, rootless Docker, Compose broker, cgroup enforcement, egress denial, cleanup, and target immutability | The runtime design was not spiked because Docker was unavailable; AC-10 makes an unavailable host an explicit blocker unless the platform promise is revised. Emulation does not prove native host behavior. |
| Both agent paths | Pinned Codex and Claude images pass login reuse, unattended/resume, structured output, permission-failure, signal handling, credential canary, prompt-injection, and package-equivalence tests | Codex 0.145.0 help was locally checked; Claude was documentation-only. Both are equal first-class Must paths. |
| Provider/target credential isolation | Analyzer and worker containers cannot read provider homes, SSH material, agent sockets, provider variables, or one another's sentinels; target prompt injection cannot place them in logs or packages | CLI sandboxing reduces but does not eliminate same-process credential risk. No release claim should exceed the adversarial evidence. |
| SQLite driver | Select a maintained driver and prove migrations, concurrency model, backup/recovery, interruption behavior, and native operation on Linux ARM64/x86-64 under Node 24 | DECISIONS explicitly leaves this unresolved; it is on the control-plane critical path. |
| Static analyzer matrix | Every pinned tool runs on both Linux architectures against all seven ecosystem fixtures; malformed/hostile fixtures prove no target execution, egress, write, or silent empty result | ARM64 tools were spiked, while amd64 execution and full adapter behavior remain release work. |
| Opengrep rules and redistribution | Ship a useful kit-owned, licensed, fixture-tested rule pack for every first-class language; satisfy LGPL obligations for the engine and notices/source-or-relink obligations; audit PMD and all redistributed assets | Semgrep community rules cannot be redistributed under the reported terms. A placeholder rule pack would violate the no-deferred-core-capability requirement. |
| Browser/runtime security | Validate Chromium + Playwright on Linux ARM64 and x86-64 with non-root/sandbox policy, proxying, redacted evidence, and blocked behavior; build and test a multi-arch ZAP Baseline image or adopt and document the researched passive-analyzer fallback | Linux ARM64 Playwright and ZAP image support remain unresolved. A safe launchable ARM64 fixture cannot be silently downgraded if runtime/browser assessment is a core capability. |
| Canonical contract validation | Offline official-schema and semantic tests for RAK JSON, SARIF Errata 01, CycloneDX 1.7, CWE/profile references, CVSS fixtures, cross-reference integrity, state/reason rules, and version rejection | Schema validity alone does not establish semantic or evidence integrity. |
| Package/redaction integrity | Seeded secrets and host paths are absent from all formats and ZIP metadata/content; every payload is declared; checksums validate before and after ZIP; byte tampering, unsafe paths, duplicates, and decompression limits fail closed | This is the customer-delivery trust boundary and directly implements AC-5/AC-8. |
| Safe runtime policy corpus | Reject unsafe Compose constructs before pulls/builds/creation; prove no socket/host mounts, runtime egress, host ports, privilege, uncontrolled resources, or orphaned VM assets | Compose is trusted input by default and cannot be passed through directly. |
| Human release review | A technical reviewer verifies material/security conclusions and simplification; a lay reviewer can explain risks, business effects, options, recommendation, confidence, and unknowns | Automated readability and schema gates cannot prove customer comprehension or independent technical judgment. |

If physical macOS x86-64 hardware cannot be obtained, the product owner must explicitly
revise AC-10; the architecture cannot redefine emulation as equivalent evidence.

## Optional or future capabilities

These must not delay MVP unless a customer makes one contractual:

- hosted Snyk, Semgrep Cloud, GitHub Advanced Security, SonarCloud, or other upload-based
  analyzers, always behind destination/data disclosure and explicit opt-in;
- active ZAP/API/full scans, Nuclei, exploit validation, or other mutating/security tests;
- repository-owned linters, package restore, builds, tests, and “trusted deep scan”
  adapters beyond what is needed to launch an approved runtime;
- Grype as a second advisory engine, CodeQL, SonarQube, ScanCode, specialist IaC tools,
  or Sysbox as a Linux-only acceleration;
- ASVS Level 2/3, expanded WSTG, or organizational SSDF review until observed triggers and
  customer confirmation select them;
- age encryption. The validated plain ZIP remains mandatory. FIPS, OpenPGP, HSM, escrow,
  enterprise-PKI, and digital-signature/non-repudiation profiles require separate
  customer-driven design;
- additional CycloneDX 1.6 downgrade exports, SPDX, PROV-O RDF, cross-run dashboards, or
  arbitrary agent runtimes;
- byte-reproducible narrative reports. Stable contracts and evidence are mandatory;
  deterministic model prose is not.

## Decisions P1 must freeze

P1 must make these decisions explicit enough that downstream lanes do not improvise them.

### Trust boundaries and process ownership

- Exact component/process diagram for UI/API, workflow engine, provider adapters, Git
  intake, analyzer runners, host lifecycle helper, VM runtime broker, rootless daemon,
  dynamic probes, evidence admission, redaction, and packager.
- Which component can read each provider home, SSH source, target snapshot, sandbox
  credential, SQLite database, staging tree, final run root, network class, and signing or
  encryption material. Default-deny all unspecified edges.
- A non-shell, versioned broker command protocol. The agent and web API must not accept or
  forward arbitrary Lima, Docker, Compose, filesystem, or host commands.
- Explicit threat boundary: malicious source, Dockerfiles/Compose, scanner input,
  dependency/build traffic, prompt injection, hostile web content, poisoned tool data,
  and compromised worker VM. State that hypervisor/kernel escape and allowed-channel
  exfiltration remain residual risks.

### Identity, lifecycle, and recovery

- Run ID, target identity, commit/snapshot semantics, immutable source export, and
  before/after integrity algorithm.
- Durable run/phase/check state machine, allowed transitions, idempotency keys, leases,
  cancellation/emergency stop, resumption, retry versus new revision, and orphan cleanup.
- Event-stream transport and replay contract; events are operational records, not the
  canonical current state.
- Engagement/provider-home isolation and lifecycle. Resolve the tension between convenient
  login reuse and avoiding cross-engagement session/config leakage; do not simply share
  one provider home globally.
- SQLite driver, concurrency/writer model, generated Drizzle migrations, corruption and
  backup/recovery behavior, and exclusion of secrets/raw large artifacts.

### Capability and network policy

- A deterministic runtime-capability result with reasons, attempted safe steps,
  prerequisite attestations, accepted/rejected Compose features, native architecture,
  sandbox credentials, and exact coverage effects.
- Separate acquisition/build and runtime states. Build egress is proxy/allowlist mediated,
  logged, and disclosed; runtime starts offline on an internal network. Any endpoint
  exception requires an explicit scoped approval object, never a generic “internet on”
  flag.
- Resource budgets and enforcement checks at VM, broker, daemon, service, browser, scanner,
  evidence-size, and wall-clock levels.
- Safety classes for HTTP/browser actions. Default probes allow read-only navigation and
  block mutating methods, uploads/downloads, destructive actions, and cross-origin scope.

### Canonical data and validation

- RAK 1 schemas for run, target snapshot, product assertion, entity/activity/agent
  provenance, evidence, finding, control result, tool invocation, coverage/limitations,
  decision comparison, artifact, manifest, and export profile.
- IDs, versioning, repository-relative locators, sensitivity/redaction state, derivation,
  validation state, confidence, and cross-reference rules. Preserve the brief's seven
  assertion labels exactly.
- The six-state control vocabulary with exactly one state per planned control and a reason
  for every non-pass. Define `not applicable` versus `blocked` versus `not tested`.
- Separate `technicalSeverity`, `businessPriority`, `confidence`, and `validationState`.
  Use CVSS 4.0 only with sufficient facts; retain imported older vectors rather than
  converting them. Never create an aggregate repository score
  ([FIRST CVSS 4.0](https://www.first.org/cvss/v4.0/specification-document)).
- Native-to-SARIF and native/Syft-to-CycloneDX projection rules, loss annotations, raw
  evidence retention, and adapter behavior on unsupported output versions.
- `toolchain.lock.json` and `standards-lock.json` location, schema, digest verification,
  update cadence, migration/profile-version rules, and immutable completed-run behavior.

### Validation and independent review

- Which invariants are deterministic gates and which require a separate model/analyst or
  human judgment. At minimum, use deterministic validation for schemas, references,
  manifests, hashes, redaction, policy, and coverage completeness; use an independent
  recorded perspective for security findings and decision-critical synthesis; require
  technical and lay human release review for production readiness.
- Materiality rules: every material finding and every modernization decision factor must
  resolve to evidence or be visibly `unverified`/`conflicting`; conflicting claims name
  both sides.
- Same acceptance harness and required artifact/domain matrix for Codex and Claude. The
  engine, not the model, decides package validity.

### Packaging and reporting

- One-way artifact flow from raw quarantine to normalized evidence to redacted frozen
  staging to final run root. Target runtimes and agents must not mutate admitted/final
  evidence.
- Exact JCS manifest/checksum/ZIP algorithm, unsafe-path and collision rules,
  decompression limits, post-ZIP verification, detached digest, and optional age secret
  handling ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html);
  [age v1](https://age-encryption.org/v1)).
- Required package inventory and the rule for screenshots: include them only when safely
  produced and evidentially useful; a capability-gated absence is valid only with a
  manifest/coverage explanation.
- Executive-report content and prohibited-claim gate. Technical coverage against a
  selected profile must never become legal applicability, certification, “secure,” or
  proof that no vulnerability exists.

## Feasibility gaps and reversal conditions

1. **Lima/rootless Docker has not been run in this research environment.** Failure on any
   required native host flips dynamic runtime to a release blocker or requires the product
   owner to narrow the platform/threat-model promise. It does not justify host-socket or
   privileged-DinD fallback.
2. **Claude Code was not locally invoked.** A CLI or managed-policy mismatch may require
   adapter changes, but should not change the canonical contract.
3. **Credential isolation is bounded, not absolute.** The provider process necessarily
   uses a credential and interprets untrusted content. If the product promises safety
   against a fully compromised provider-agent process, use a separately validated
   credential broker or provider-supported ephemeral workload identity; the current
   home-volume design is insufficient for that stronger claim.
4. **Linux ARM64 browser and ZAP operation are not yet proven.** If Chromium cannot meet
   the selected sandbox policy, use an architecture-specific runner behind the same
   adapter or revise the platform/runtime promise. If ZAP cannot be shipped multi-arch,
   implement the researched kit-controlled passive HTTP/header analyzer and report the
   reduced technique set.
5. **Useful multi-language SAST depends on maintained kit rules.** If the team cannot
   sustain licensed, high-confidence rules with fixtures across all seven ecosystems,
   architecture must present a narrower honest SAST profile or make a commercial engine a
   product/licensing decision. It must not silently download Semgrep community rules.
6. **Offline dependency depth is inherently partial for some manifests.** Maven and other
   resolver-dependent targets may require approved acquisition egress or a
   customer-provided lock/SBOM. Missing transitives are coverage limitations, not evidence
   of no vulnerable dependency.
7. **Lima is an implementation, not a security certification.** A better maintained
   cross-platform VM/microVM may replace it behind the broker contract after passing the
   same adversarial suite. Narrowing the threat model to trusted repositories could permit
   a cheaper runtime profile, but that is a product change.
8. **Checksums prove integrity only relative to a trusted digest.** If customers require
   authorship or non-repudiation, add a signing and key-lifecycle profile; do not relabel
   SHA-256 as a signature.

## Sources

All sources were accessed by the underlying research lanes on 2026-07-27.

- [Agent runtime compatibility](./agent-runtime-compatibility.md)
- [Sandbox and nested-container research](./sandbox-and-nested-containers.md)
- [Local assessment toolchain](./assessment-toolchain.md)
- [Standards and formats](./standards-and-formats.md)
- [Docker Compose trust model](https://docs.docker.com/compose/trust-model/)
- [Docker rootless mode and limitations](https://docs.docker.com/engine/security/rootless/)
- [Lima plain mode](https://lima-vm.io/docs/config/plain/)
- [OpenAI non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Anthropic non-interactive mode](https://code.claude.com/docs/en/headless)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [OASIS SARIF 2.1.0 Plus Errata 01](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
- [CycloneDX 1.7 JSON](https://cyclonedx.org/docs/1.7/json/)
- [OWASP ASVS 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0_release)
- [OWASP WSTG version guidance](https://owasp.org/www-project-web-security-testing-guide/)
- [NIST SP 800-218 SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final)
- [FIRST CVSS 4.0](https://www.first.org/cvss/v4.0/specification-document)
- [W3C PROV-O](https://www.w3.org/TR/prov-o/)
- [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [age v1 specification](https://age-encryption.org/v1)

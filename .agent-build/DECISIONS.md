# Repository Assessment Kit — Decisions

_Confirmed during plan-build on 2026-07-27._

## Target

- **Name:** `repo-assessment-kit`
- **Mode:** Greenfield
- **Repository URL:** Not created; the user will push the completed local repository.
- **Target path:** `targets/repo-assessment-kit`
- **Working branch:** `main` (explicit user choice)
- **Visibility if later created by tooling:** Private by default

## Product shape

- **Interface:** A local web application for guided intake, progress, limitations, and report review.
- **Host access:** Publish only the UI port to host loopback (`127.0.0.1`); do not use host-network mode and do not expose the UI on all interfaces by default.
- **Customer reporting:** Plain-language executive and decision reports with linked technical evidence and machine-readable appendices.
- **Browser/runtime capability:** Playwright and target runtime checks are capability-gated. An unavailable safe runtime becomes explicit blocked/not-applicable coverage and does not invalidate the static assessment.

## Application stack

- **Runtime:** Node.js 24 LTS, pinned by container image digest and package-manager metadata. Rationale: supported production line with one TypeScript runtime across the server, workers, schemas, and tooling.
- **Language:** TypeScript in strict mode.
- **Frontend:** React 19.2 + Vite 8.
  - Rationale: a responsive local workflow UI without requiring a hosted application or a full-stack rendering framework.
- **Backend:** Fastify 5.
  - Rationale: schema-oriented HTTP APIs, strong TypeScript support, structured logging, and efficient long-running-job control.
- **API shape:** Local-only HTTP API plus a one-way progress/event stream; the architecture spec chooses the exact transport and lifecycle contract.

## UI system

- **Styling:** Tailwind CSS 4.
- **Components:** shadcn/ui using Radix accessibility primitives.
- **UX requirement:** Calm, guided, plain-language operation for users who are not security or software specialists; technical detail is progressively disclosed.

## Data and artifacts

- **Operational store:** SQLite for run state, product claims, phase/check status, evidence indexing, finding workflow, artifact state, and resume behavior.
- **ORM:** Drizzle ORM.
- **Migrations:** Drizzle Kit, generated from the TypeScript schema and committed; generated migrations are never hand-authored or hand-edited.
- **Driver gate:** The architecture/research phase must select and validate a stable SQLite driver on Linux ARM64 and x86-64 before freezing the architecture.
- **Artifact store:** Filesystem beneath `generated/<project>-<commit>-<timestamp>/`.
- **Database exclusions:** Never store SSH keys, agent authentication material, supplied sandbox secrets, repository source, raw screenshots, or large logs in SQLite.
- **Customer export:** The internal operational database is not included by default. Customer packages contain validated, redacted exports.

## Repository conventions

- **Layout:** pnpm workspace monorepo.
- **Planned top-level shape:** `apps/web`, `apps/server`, focused shared `packages/*`, container assets, scripts, documentation, and fixtures.
- **Package manager:** pnpm, exact release pinned through Corepack/package metadata.
- **Unit/integration tests:** Vitest.
- **UI end-to-end tests:** Playwright for the kit's own local web interface.
- **Target runtime tests:** Playwright only when the runtime-capability gate passes.
- **Lint/format:** ESLint + Prettier.
- **Schemas/contracts:** Versioned JSON Schema is the portability boundary between phases, agents, reports, and validators.
- **Generated output:** `generated/` and isolated repository workspaces remain gitignored.

## Agent execution and authentication

- **Supported agents:** Codex and Claude Code are equal first-class launch paths.
- **Launchers:** Required `start-codex.sh` and `start-cc.sh`.
- **Container approach:** Mirror `codex-agents`: non-root container user, persistent `/home/node` Docker volume for login/config/session state, interactive first-run login, environment credentials as an alternative, gitignored `.env` support, and read-only global instruction mounts when present.
- **Provider isolation:** Codex and Claude Code use separate persistent home volumes and provider-specific configuration.
- **SSH:** Opt-in host `~/.ssh` bind mount, read-only, with a configurable alternative source directory and the documented macOS `UseKeychain` compatibility workaround.
- **Source inputs:** Support both SSH Git URLs and read-only existing local repository paths.
- **Scope identity:** Resolve and record an immutable commit SHA before assessment.

## Sandbox and runtime isolation

- **Primary boundary:** Docker sandbox on macOS and Linux, ARM64 and x86-64; WSL is documented best-effort.
- **Target source:** Read-only to assessment activity.
- **Assessed applications:** May run through isolated Docker/Compose support without mounting the host Docker socket.
- **Nested-container gate:** Research and architecture must select an implementation that preserves the stated host-isolation boundary and works across the supported host/architecture matrix.
- **Credentials:** Only explicitly supplied and declared sandbox-safe credentials may be used.
- **Production:** No production credentials, databases, APIs, data, or destructive external actions.
- **Outbound network:** Permit agent authentication, Git cloning, package/tool installation, and explicitly approved optional services. Target runtime egress is separately controlled and reported.

## Assessment coverage

- **Core:** Language-agnostic repository discovery, evidence model, architecture reasoning, product/use-case mapping, decision synthesis, validation, redaction, and packaging.
- **First-class ecosystems:** Node/TypeScript, Python, Go, Java, .NET, Ruby, and PHP web/API repositories.
- **Other repositories:** Generic static assessment with explicit unsupported or reduced-depth coverage.
- **Runtime:** Prefer repository-owned Docker/Compose definitions. A missing safe runtime never causes the static assessment to fabricate or silently omit results.
- **Security:** General baseline on every run; configurable framework overlays and auto-recommended deeper profiles based on cited signals. Recommendations require customer confirmation and never imply certification or legal applicability.
- **Independent validation:** Required for decision-critical evidence and security findings; the architecture spec defines deterministic versus separate-agent responsibilities.

## External tools and services

- **Default:** Local scanners and analyzers inside the sandbox.
- **Optional hosted services:** Supported only through explicit per-run operator opt-in, exact destination disclosure, scoped credentials, and recorded data-egress warnings.
- **No silent uploads:** Repository content, findings, or evidence may not be sent to an optional service without explicit approval.
- **Selection gate:** Research must verify scanner coverage, redistribution/license terms, supported architectures, output formats, update strategy, and safe-execution constraints.

## Deliverable formats

- **Human-readable:** Markdown and self-contained static HTML, with a plain-language executive layer and technical appendices.
- **Canonical structured data:** Versioned JSON Schemas.
- **Security findings:** SARIF export.
- **Software inventory:** CycloneDX SBOM.
- **Tabular review:** CSV exports where useful.
- **Integrity:** File manifest plus SHA-256 checksums.
- **Packaging:** Always create the requested validated ZIP.
- **Optional protection:** When supplied a recipient key or passphrase, also create a strongly encrypted wrapper; never use legacy ZIP encryption as the security control.

## Key quality gates

- Target repository remains unchanged.
- Every material decision claim resolves to evidence or is visibly unverified/conflicting.
- Every planned control has an allowed coverage status and reason where required.
- Redaction and secret scanning occur again at the final packaging boundary.
- Both launchers pass the same acceptance contract.
- A lay reviewer can understand the primary risks, business impact, choices, confidence, and unknowns.
- No placeholders or deferred core capabilities in a release package.

## Build-time frozen-contract correction — 2026-07-28

- **Dynamic control authorization:** The safety critic's remaining `controlPlanId` gap is
  resolved by the normative `SignedDynamicControlPlan` contract in architecture §8.7,
  inline `vm.probe`/broker transport in §§10.1/10.4, and matching safety §12.1.
- **Authority path:** The workflow creates a per-run payload only after compile/start. A
  typed, isolated trusted host-helper signer signs its RFC 8785 canonical bytes with
  Ed25519 after non-expansive admission checks. The broker and external request guard
  verify and journal the exact signed envelope before dispatch.
- **Key separation:** The control-plan signing private key is provisioned outside the
  repository and images and is never exposed to provider, analyzer, acquisition, target,
  probe, request-guard, generated-output, environment, or argv compartments. Production
  fails closed when signer or trusted public-key attestation is unavailable; deterministic
  tests may use explicitly test-only fixture keys.
- **No side channel:** No generic signing, shell, script, browser-code, Docker, Compose, or
  runtime command operation was added. Opaque plan IDs alone are never authority.
- **DRAFT cancellation clarification:** Architecture §6.1's legal transition graph and
  safety §16.2 govern the ambiguous `cancelRun` table wording. Cancelling in `DRAFT`
  revokes uploaded run secrets/session inputs and leaves the run in `DRAFT`; only active
  states with a frozen legal edge enter `CANCELLING -> CANCELLED`.

## Non-goals / explicitly deferred

- Modifying or remediating the assessed repository.
- Destructive penetration testing, denial-of-service testing, or social engineering.
- Production-system access.
- Automated legal applicability, certification, attestation, or compliance claims.
- A hosted multi-tenant assessment service.
- Native Windows support outside documented best-effort WSL operation.
- Equal-depth ecosystem-specific assessment for every language in the first release.
- Byte-identical reports across nondeterministic agents; required outcomes and evidence contracts must be equivalent instead.

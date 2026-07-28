# Repository Assessment Kit

This kit examines a software project and produces a detailed, evidence-based report to help answer
one important question:

> Should we repair and secure the current system, replace it in stages, or rebuild it?

The assessment does not change the project being examined.

## What the assessment covers

The final package can include:

- a plain-language executive summary;
- the product’s target customers, buyers, users, and customer problems;
- important features, workflows, and competitive differences;
- technology, dependencies, architecture, and data flows;
- security weaknesses and their severity;
- maintainability, testing, reliability, and operational concerns;
- screenshots and verified browser flows when safe browser access is available;
- gaps where something could not be verified;
- the tradeoffs between repairing, replacing, and rebuilding; and
- a ZIP containing the reports, evidence, inventories, and checksums.

Unknown information is recorded as unknown. The kit does not silently turn guesses into facts.

## Before you begin

Your technical contact should provide:

- this assessment-kit folder;
- a complete signed customer release, when a full assessment is expected;
- access to the repository being assessed;
- a Codex or Claude Code account;
- an assessment configuration file; and
- disposable test credentials only if browser testing requires them.

Use a non-production computer or approved assessment machine. Never provide production passwords,
production customer data, or unrestricted infrastructure credentials.

## Start the readiness check

Open Terminal, change into this folder, and run:

```sh
./start.sh
```

Choose Claude Code or Codex when asked. The script will:

1. create a private identifier for this assessment;
2. check the available security and browser capabilities;
3. recommend the fullest compatible assessment mode;
4. explain required problems in plain language; and
5. save the technical details to `generated/preflight-latest.json`.

If your technical contact already told you which provider to use, you can skip the question:

```sh
./start.sh --provider claude
```

or:

```sh
./start.sh --provider codex
```

## Understanding the recommendation

The kit chooses the first safe mode available:

| Recommendation                                 | What it means                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| Full isolated assessment with browser evidence | Runtime checks, screenshots, and browser-flow checks are available  |
| Isolated assessment without browser evidence   | Runtime checks are available, but screenshots are omitted           |
| Static assessment with browser evidence        | Code analysis and approved browser checks are available             |
| Static assessment without browser evidence     | Code and security analysis continue without running the application |
| Not ready to assess                            | A required safety or release component must be provided before use  |

Playwright and Chromium are already included in the browser Docker image. You should not install
Playwright yourself. If the safe browser environment is unavailable, the kit can recommend a static
mode and clearly record the missing screenshot and browser coverage.

## If the result says “Not ready”

Do not try to bypass the check or weaken a security setting.

Send this file to your technical contact:

```text
generated/preflight-latest.json
```

The most common causes are an incomplete customer release, an unavailable Docker environment, or a
missing assessment helper. These are deployment tasks for the technical operator—not tasks the
client is expected to solve.

On macOS, if Docker is installed but does not meet the rootless safety check, `./start.sh` offers a
guided repair. It explains each change and asks before installing Lima, creating the separate
rootless Docker virtual machine, or adding a Docker connection. After Docker is verified, the
readiness check runs again and moves to the next required item.

## Sign in to the selected provider

Only continue after the readiness check says the required mode is available.

For Claude Code:

```sh
./start.sh --provider claude login
./start.sh --provider claude status
```

For Codex:

```sh
./start.sh --provider codex login
./start.sh --provider codex status
```

Follow the provider’s normal sign-in instructions. Do not place provider passwords or tokens in
`.env`, the assessment configuration, or a command-line argument.

## Run the assessment

Your technical contact should prepare and review the assessment configuration. To start:

```sh
./start.sh --provider claude run --config /path/to/assessment.json
```

Replace `claude` with `codex` if that is the selected provider.

If the tool gives you a specific resume command, use the exact run directory it reports:

```sh
./start.sh --provider claude resume --run-dir generated/<exact-run-directory>
```

Do not edit files inside an interrupted run.

## Where results are stored

All results remain inside:

```text
generated/
```

The final ZIP and reports are placed in a dated run directory. Start with the executive report, then
review:

1. the repair-versus-rebuild recommendation;
2. security findings;
3. important features and customer workflows;
4. architecture and technology;
5. coverage gaps and limitations; and
6. the evidence supporting each important conclusion.

A package marked `DRAFT_VALIDATED_RELEASE_BLOCKED` is an internal draft. It may be reviewed, but it
is not an authorized final customer release.

## Information and credential safety

- The assessed repository is treated as untrusted input.
- Provider credentials are stored separately for each provider and assessment.
- Repository access must be limited to the repository being assessed.
- Do not mount or share an entire `.ssh` folder.
- Use only explicitly supplied, disposable sandbox credentials.
- Browser testing should use non-production accounts and data.
- Raw passwords, tokens, browser traces, and unrestricted screenshots are not included in the
  customer package.
- Generated assessment files are excluded from Git by default.

## What the client may be asked

The assessment is more useful when the product owner can describe:

- the target customer;
- who buys the product;
- the main user roles;
- the customer problem being solved;
- the most valuable workflows;
- important competitive differences;
- revenue- or retention-critical behavior;
- contractual or regulatory obligations;
- expected scale; and
- what “feature parity” means for a replacement.

“We do not know” is a valid answer.

## Help and technical documentation

Clients can start with:

- [Customer quickstart](docs/customer-quickstart.md)
- [Customer package review guide](docs/package-review-guide.md)

Material for the consultant or technical operator:

- [Operator runbook](docs/operator-runbook.md)
- [Offline dry-run instructions](docs/offline-assessment.md)
- [Release checklist](docs/release-checklist.md)
- [Supported coverage matrix](docs/supported-coverage-matrix.md)
- [Security boundaries](docs/foundation-security-boundaries.md)

If `./start.sh` reports a blocker, provide `generated/preflight-latest.json` to the technical
operator rather than attempting undocumented workarounds.

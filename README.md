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
- access to the repository being assessed;
- a Codex or Claude Code account;
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
3. offer to build the assessment containers locally when they are missing;
4. recommend the fullest compatible assessment mode;
5. explain required problems in plain language; and
6. save the technical details to `generated/preflight-latest.json`.

The containers are built from this folder on the client’s machine. Nothing needs to be downloaded
from a private container registry, and there is no release-signing setup. Docker reuses its build
cache on later runs. The local image record is kept in `generated/local-images.json`.

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

| Recommendation                                      | What it means                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Full repository assessment with browser evidence    | The agent can inspect and run a disposable copy, test it, and take screenshots |
| Full repository assessment without browser evidence | The same assessment runs, but screenshots and browser flows are omitted        |
| Not ready to assess                                 | Docker or a required local container is unavailable                            |

Playwright and Chromium are already included in the browser Docker image. You should not install
Playwright yourself. If the safe browser environment is unavailable, the kit can recommend a static
mode and clearly record the missing screenshot and browser coverage.

## If the result says “Not ready”

Do not try to bypass the check or weaken a security setting.

Send this file to your technical contact:

```text
generated/preflight-latest.json
```

The most common causes are an unavailable Docker environment, containers that have not finished
building, or a missing assessment helper. The guided start command handles the local container
build.

Standard Docker Desktop is supported. The assessment container does not receive the host Docker
socket, host home directory, or SSH credentials unless an SSH directory is explicitly supplied.

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

Running `./start.sh` with no other arguments offers to start the assessment after the readiness
check. You can also start it directly:

```sh
./start.sh --provider claude assess --repo /path/to/client-repository
```

Replace `claude` with `codex` if that is the selected provider.

To clone a remote repository into the disposable workspace:

```sh
./start.sh --provider claude assess --git git@github.com:owner/repository.git
```

HTTPS URLs are also supported. Add `--ref branch-or-tag` to select something other than the
repository’s default branch. SSH cloning uses the host’s normal Git/SSH configuration; the
assessment container receives the cloned repository, not the host’s SSH keys.

The kit copies the repository into a dated directory under `generated/`; the client repository is
not modified. The agent then performs separate product, architecture, security, quality, dynamic,
adversarial-review, decision, and executive passes. It may install dependencies and execute the
copied application inside the assessment container. This uses eight fresh agent sessions and can
take substantial time on a large repository; that separation is intentional so one shallow context
does not control the entire recommendation.

Before the run, the kit asks four optional business questions: target customer, must-preserve
workflows, competitive differences, and sandbox/startup notes. “Not supplied” is valid, and the
reports must distinguish owner statements from code-verified facts.

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

The final archive is named `repo-assessment.zip`. Start with `executive-report.md`, then read
`modernization-decision.md` and the detailed pass reports.

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

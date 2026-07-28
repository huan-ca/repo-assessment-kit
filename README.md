# Repository Assessment Kit

The Repository Assessment Kit examines a software repository and produces evidence for choosing
among three options:

1. repair and secure the current system;
2. replace it in controlled stages; or
3. rebuild it.

It catalogs the technology, architecture, security findings, important features, customer use cases,
business context, evidence, coverage gaps, and decision tradeoffs. It does not change the assessed
repository.

## Choose the test you want to run

| Test                                                            | What it proves                                                                             | What it needs                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [Offline dry run](#test-1-offline-dry-run-recommended-first)    | Static assessment, reports, checksums, deterministic ZIP, and source-integrity handling    | Node, pnpm, Git, and a separate Git repository                                             |
| [Local web preview](#test-2-local-web-preview)                  | The operator interface, responsive layout, and plain-language workflow                     | Node and pnpm                                                                              |
| [Full provider workflow](#test-3-full-codex-or-claude-workflow) | Signed sandbox, SSH acquisition, provider review, runtime controls, and release transition | Verified release bundle, root helper, rootless Docker, credentials, and signed authorities |

Start with Test 1. It works without Docker, provider credentials, SSH credentials, Playwright, or a
running copy of the assessed application.

## Safety rules

- Use a dedicated test host and non-production repositories.
- Never supply production credentials, data, URLs, or accounts.
- Do not mount the host Docker socket.
- Do not mount a complete `.ssh` directory. Full SSH assessments use one registered read-only key or
  approved agent socket plus pinned `known_hosts` through the host helper.
- Do not add provider flags or Docker arguments to the launcher commands.
- Keep the assessed repository separate from this kit's `generated/` directory.
- A result marked `DRAFT_VALIDATED_RELEASE_BLOCKED` is a successful internal draft, not an
  authorized customer release.

## Requirements for the first test

- Linux or macOS
- Git
- Node.js `24.4.1`
- Corepack
- pnpm `11.17.0`
- A separate Git repository with a valid commit

Check the versions:

```sh
git --version
node --version
corepack --version
```

The Node version should be `v24.4.1`. From the kit directory, prepare the workspace:

```sh
corepack enable
pnpm install --frozen-lockfile
```

Optionally verify the complete developer test suite before assessing a repository:

```sh
pnpm run ci
pnpm audit --prod --audit-level high
```

## Test 1: Offline dry run (recommended first)

This test performs static analysis only. It does not use the network, execute target code, start
containers, run package managers in the target, or capture browser screenshots.

### Step 1 — Select a separate target repository

Set `TARGET_REPO` to an absolute path. Do not use this kit itself as the target because the output
directory is inside the kit.

```sh
export TARGET_REPO=/absolute/path/to/the-project-to-assess
git -C "$TARGET_REPO" rev-parse --show-toplevel
git -C "$TARGET_REPO" rev-parse HEAD
```

Both commands must succeed. The second command must print a full Git commit. Modified and untracked
files are allowed; the assessment includes and records them. Do not change the target while the run
is active.

### Step 2 — Record the product and customer context

Create an operator-owned copy of the discovery questionnaire:

```sh
mkdir -p generated/test-input
cp examples/discovery.sample.json generated/test-input/discovery.json
```

Edit `generated/test-input/discovery.json`. Replace the sample answers with the best available
information about the target:

1. target customers;
2. buyers;
3. user roles;
4. customer pain;
5. valuable workflows;
6. alternatives and competitive differentiators;
7. revenue- or retention-critical behavior;
8. contractual obligations;
9. expected scale; and
10. feature-parity expectations.

“We do not know” is an acceptable answer when it uses the structured `unknown` form in the sample.
Do not turn a guess from the source code into an owner-confirmed statement.

### Step 3 — Run the assessment

Choose a lowercase project slug containing letters, numbers, and single hyphens:

```sh
export PROJECT_SLUG=my-project
pnpm assessment:offline \
  --source "$TARGET_REPO" \
  --project "$PROJECT_SLUG" \
  --discovery "$PWD/generated/test-input/discovery.json" \
  --output-root generated
```

For a byte-repeatable test, add a fixed timestamp:

```sh
pnpm assessment:offline \
  --source "$TARGET_REPO" \
  --project "$PROJECT_SLUG" \
  --discovery "$PWD/generated/test-input/discovery.json" \
  --output-root generated \
  --generated-at 2026-07-28T12:34:56.000Z
```

### Step 4 — Find and verify the result

```sh
RUN_DIR=$(
  find generated -mindepth 1 -maxdepth 1 -type d \
    -name "${PROJECT_SLUG}-*" -print | sort | tail -n 1
)
ZIP=$(find "$RUN_DIR" -maxdepth 1 -type f -name '*-DRAFT.zip' -print | sort | tail -n 1)
test -n "$RUN_DIR" && test -n "$ZIP"
printf 'Run directory: %s\nZIP: %s\n' "$RUN_DIR" "$ZIP"
```

Verify the detached digest on Linux:

```sh
(cd "$RUN_DIR" && sha256sum --check "$(basename "$ZIP").sha256")
```

On macOS:

```sh
(cd "$RUN_DIR" && shasum -a 256 --check "$(basename "$ZIP").sha256")
```

Check the offline validation certificate:

```sh
CERT="${ZIP}.validation.json"
node -e '
  const fs = require("node:fs");
  const certificate = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (
    certificate.verdict !== "DRAFT_VALIDATED_RELEASE_BLOCKED" ||
    certificate.customerReleaseAuthorized !== false ||
    certificate.zipReopenedInFreshParserInvocation !== true
  ) process.exit(1);
  console.log(certificate);
' "$CERT"
```

Optionally extract a review copy:

```sh
mkdir -p "$RUN_DIR/review"
unzip -q "$ZIP" -d "$RUN_DIR/review"
```

Open `"$RUN_DIR/review/index.html"` in a browser. Start with the executive report, then read the
decision, security, coverage-and-limitations, and technical reports.

The offline draft uses the `rak-offline-draft/1.0.0` manifest profile and its own fresh-process
validator. Do not pass it to the lower-level customer-release ZIP validator, which expects the
different `rak-export-profile/1.0.0` package contract.

### Expected result

A successful offline test:

- creates `generated/<project>-<commit>-<timestamp>/`;
- leaves the assessed repository unchanged;
- creates a deterministic `*-DRAFT.zip`;
- creates a detached SHA-256 file and validation certificate;
- includes reports, evidence, manifests, SARIF, CycloneDX, and CSV output;
- records runtime, browser, screenshots, unavailable scanners, and provider analysis honestly as
  blocked or unavailable; and
- reports `DRAFT_VALIDATED_RELEASE_BLOCKED`.

That blocked release status is expected. It means the static draft is internally consistent but has
not completed real provider, runtime, platform, supply-chain, and human-authorization gates.

## Test 2: Local web preview

This is an interface preview, not an assessment and not release evidence.

```sh
pnpm dev
```

Open:

```text
http://127.0.0.1:4173/?preview=1
```

The UI and API bind only to `127.0.0.1`. Do not expose them with host networking, a public reverse
proxy, or a LAN bind. Press `Ctrl+C` in the terminal to stop the preview.

The preview should show:

- guided setup and all ten discovery topics;
- capability and blocked-state explanations;
- progress, findings, evidence, coverage, and limitations;
- the repair vs staged replacement vs rebuild comparison; and
- package and release-gate states.

## Test 3: Full Codex or Claude workflow

This test is intentionally unavailable from an unsigned source checkout. It requires:

- an authentic signed release bundle and immutable provider images;
- the verified root-owned host-helper installation;
- a dedicated non-root engagement account;
- rootless Docker;
- a signed provider-egress network and one-use attestation;
- Codex and/or Claude Code credentials stored only in their separate provider homes;
- for SSH, a registered repository-scoped read-only acquisition profile;
- for isolated runtime, the signed Lima/rootless runtime, request guard, firewall, resource limits,
  emergency stop, and cleanup authority; and
- signed review and release authorities for customer delivery.

See [the operator runbook](docs/operator-runbook.md) for installation and authority provisioning. Do
not replace a missing signed component with a local digest, mutable image tag, direct Docker Compose
run, broad SSH mount, or provider command.

### Step 1 — Let the launcher identify this engagement

You do not need to edit `.env`. The first `preflight`, `login`, `status`, `interactive`, `run`, or
`resume` command creates a random `.rak_id` file in this checkout. Later commands reuse the same ID,
so Codex and Claude Code keep using the correct, separate credential storage for this engagement.

The file is not a password, but it is private to this checkout. It is ignored by Git, excluded from
container images, and created so only your operating-system account can read it. Do not copy
`.rak_id` into a different customer engagement.

To see the ID after the first command:

```sh
cat .rak_id
```

Managed deployments may export `RAK_ENGAGEMENT_ID=customer-project` as an explicit override. The
override must contain only lowercase letters, numbers, and hyphens (48 characters at most). It does
not change the `.rak_id` file.

### Step 2 — Run read-only preflight

```sh
./start-codex.sh preflight
./start-cc.sh preflight
```

Preflight prints typed readiness results. A blocked result should explain the missing prerequisite
and remediation. Do not weaken the control to make preflight green.

### Step 3 — Authenticate providers

After the trusted deployment has issued the required provider-egress network attestation:

```sh
./start-codex.sh login
./start-codex.sh status

./start-cc.sh login
./start-cc.sh status
```

Authentication is interactive and provider-specific. Never place provider credentials in `.env`, a
run configuration, or a command argument.

### Step 4 — Prepare discovery and run configuration

Copy and edit:

```sh
mkdir -p generated/run-input
cp examples/discovery.sample.json generated/run-input/discovery.json
cp examples/run.local-static.sample.json generated/run-input/run.json
```

In `run.json`:

- set `projectSlug`;
- set the target repository path or approved SSH source;
- set `discoveryPath` to `generated/run-input/discovery.json`;
- leave `outputRoot` as `generated`;
- use `runtime.mode: "static-only"` for the first full run; and
- keep `sandboxCredentials` empty unless explicit disposable sandbox credentials were provisioned.

For SSH, start from `examples/run.ssh-static.sample.json`. The configuration names an approved
acquisition profile; it does not contain or point to a private key. The host helper supplies only
the registered key or socket and pinned host information to the ephemeral acquisition worker.

For isolated runtime, start from `examples/run.isolated.sample.json`. Use only sandbox-internal
service origins and explicit non-production credential handles. If the runtime or browser cannot run
safely, use static-only mode instead.

### Step 5 — Run each provider

```sh
./start-codex.sh run --config generated/run-input/run.json
./start-cc.sh run --config generated/run-input/run.json
```

If a run reports a resumable stage, use the same provider launcher and exact generated run
directory:

```sh
./start-codex.sh resume --run-dir generated/<exact-codex-run-directory>
./start-cc.sh resume --run-dir generated/<exact-claude-run-directory>
```

Do not edit or copy a journal to force a resume.

### Step 6 — Pair, review, authorize, and release

Pair the two terminal provider drafts:

```sh
./start-codex.sh pair \
  --codex-run-dir generated/<codex-run> \
  --claude-run-dir generated/<claude-run>
```

The pair requires six opposite-provider cross-reviews. Five additional one-use signed human review
records are then admitted: independent security, independent decision, technical, lay, and customer
acceptance.

```sh
./start-codex.sh review \
  --pair-dir generated/pairs/<pair> \
  --record /protected/reviews/<signed-review>.json
```

After all review and external certificates exist, admit the distinct final authorization and
release:

```sh
./start-codex.sh authorize \
  --pair-dir generated/pairs/<pair> \
  --record /protected/authorization/<signed-authorization>.json

./start-codex.sh release --pair-dir generated/pairs/<pair>
```

The Claude launcher exposes the same closed operations. Release reopens and validates every
artifact. It does not rewrite the immutable draft ZIP.

## When a command safely blocks

Common safe blocks include:

| Message or condition                | Meaning                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| Signed release verification failed  | The authentic release bundle or evidence is missing            |
| Docker unavailable or not rootless  | The required provider sandbox is unavailable                   |
| Host helper unavailable             | The root-owned runtime/SSH boundary is not installed or active |
| Provider egress attestation missing | Provider login or inference network was not authorized         |
| SSH acquisition profile missing     | No exact read-only repository authority was registered         |
| Isolated runtime unavailable        | Use static-only mode or provision the signed runtime           |
| Playwright unavailable              | Continue without browser testing and record reduced coverage   |
| `DRAFT_VALIDATED_RELEASE_BLOCKED`   | The draft is valid but is not authorized for customer release  |

A safe block is better than silently running with weaker isolation.

## Generated files and cleanup

All run output stays under the gitignored `generated/` directory. Operational state and workspaces
are also ignored.

```sh
git check-ignore generated/probe
git status --short
```

Do not delete an active or interrupted run. Preserve its journal and receipts until cleanup and
incident disposition are complete. Do not delete provider homes while a run or review is active.

## More documentation

- [Customer quickstart](docs/customer-quickstart.md)
- [Operator runbook](docs/operator-runbook.md)
- [Customer package review guide](docs/package-review-guide.md)
- [Offline assessment details](docs/offline-assessment.md)
- [Release checklist](docs/release-checklist.md)
- [Supported coverage matrix](docs/supported-coverage-matrix.md)
- [Security boundaries](docs/foundation-security-boundaries.md)

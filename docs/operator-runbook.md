# Operator runbook

This runbook is for the person preparing, running, monitoring, and handing off an assessment. Run
commands from the Repository Assessment Kit root. Use one provider launcher for the entire run:

- `./start-codex.sh` for Codex
- `./start-cc.sh` for Claude Code

The public launcher surface is deliberately closed. It accepts only `login`, `status`,
`interactive`, `preflight`, `run --config <path>`, and `resume --run-dir <directory>`. Do not add
provider flags, Docker arguments, commands, environment-supplied flag strings, or a pass-through
`--`. Unknown or extra arguments must fail.

## 1. Host and engagement preparation

Use a dedicated, trusted operator account on a supported native host:

- macOS ARM64 or x86-64;
- Linux ARM64 or x86-64; or
- Windows Subsystem for Linux (WSL) as best-effort only.

WSL is not a guaranteed platform. Record its Windows build, WSL version, distribution, architecture,
virtualization mode, and any Docker/Lima limitation as release evidence. An emulated run does not
replace a missing native macOS or Linux release check.

Use only an authentic `rak-verified-release/1.0.0` bundle. The launcher verifies its signed release
manifest and the bound toolchain, software bill of materials (SBOM), provenance inventory, and
immutable image references before use. A source checkout, mutable image tag, locally supplied
digest, or environment override is not a verified release. This repository does not contain a
release-signing private key and must never create a substitute signature.

If verification fails, obtain the authentic release bundle and its published verification material
from the release owner. Do not override the digest, edit the manifest, trust a locally built tag, or
weaken preflight.

Dynamic target execution requires the release-provisioned Lima plain-mode worker, native guest
architecture, rootless Docker, cgroup version 2, firewall/request guard, resource limits, and
emergency cleanup controls. Docker Desktop alone is not evidence that those controls exist. Do not
substitute privileged Docker-in-Docker, direct Compose, a host Docker-socket mount, broad host
mounts, or direct provider execution.

On the first valid launcher command, the kit creates a random `.rak_id` in the checkout and reuses
it. No `.env` entry is required. The file is a non-secret identifier, must remain owned and readable
only by the engagement account, and must not be copied to another engagement. A managed deployment
may export a valid `RAK_ENGAGEMENT_ID` override without changing the file. Provider login state is
persistent and separate for each engagement and provider. The public launcher has no provider-home
deletion verb; follow the organization’s approved storage cleanup procedure at engagement close and
record it. Never delete a home while a run or review is active.

Keep all kit output under `generated/`. The repository’s `.gitignore` excludes `generated/`,
`state/`, `workspaces/`, `.rak_id`, `.env*` except `.env.example`, and common build/test output.
Before and after a run:

```sh
git check-ignore generated/probe
git check-ignore .rak_id
git status --short
```

The first two commands must identify their matching ignore rules. Review `git status` rather than
assuming ignored output cannot be staged by an unsafe command.

### 1.1 Production helper installation and service boundary

The production boundary is a privileged service installed by a trusted host administrator. It is not
bootstrapped by a public launcher and is never run by the assessment operator. Before using a
candidate, the administrator must choose one dedicated, nonzero numeric client UID and GID and bind
them into the signed `rak-host-helper-config/1.0.0`. The public launcher and release orchestrator
run as that dedicated account, never as root.

The installation has these fixed paths and ownership rules:

| Path                                                              | Required owner/mode and purpose                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/usr/local/libexec/rak-peer-cred`                                | `root:root`, mode `0755`, native Linux or macOS executable whose SHA-256 is pinned in the helper configuration |
| `/etc/repo-assessment-kit/host-helper.json`                       | `root:<clientGid>`, mode `0440`, non-symlink closed production configuration                                   |
| `/etc/repo-assessment-kit/release/release-signing-public-key.pem` | `root:root`, mode `0444`, non-symlink out-of-band Ed25519 release-verification key                             |
| `/var/lib/repo-assessment-kit/release/verified-host-helper.txt`   | `root:root`, mode `0400`, non-symlink signed-release-derived installation authority                            |
| `/var/lib/repo-assessment-kit/host-helper/`                       | `root:root`, mode `0700`, durable helper journal and reconciliation state                                      |
| `/var/lib/repo-assessment-kit/transfers/`                         | `root:root`, mode `0710`, fixed parent for helper-derived snapshot transfers                                   |
| `/run/secrets/rak-host-helper-client.key`                         | `<clientUid>:<clientGid>`, mode `0600`, exactly 32 raw bytes                                                   |
| `/var/run/repo-assessment-kit/host-helper.sock`                   | `<clientUid>:<clientGid>`, mode `0600`, non-symlink Unix socket created by the root service                    |

The signed release manifest is schema version 2 and contains a closed `hostHelper` section. It binds
the installer, every helper/provider-task/validator/entrypoint module, both service definitions, and
the Node and peer-verifier payloads at exactly:

```text
container/runtime/install/payload/linux-arm64/{node,rak-peer-cred}
container/runtime/install/payload/linux-x86-64/{node,rak-peer-cred}
container/runtime/install/payload/macos-arm64/{node,rak-peer-cred}
container/runtime/install/payload/macos-x86-64/{node,rak-peer-cred}
```

After release engineering stages and signs the exact v2 bundle, a root release operator runs the
verifier with `--emit-host-helper-record`. This mode always uses the fixed out-of-band key above,
rejects `--trusted-key`, and exclusively creates the mode-`0400` authority record:

```sh
node scripts/verify-release-assets.mjs \
  --manifest release/release-manifest.json \
  --toolchain release/toolchain.lock.json \
  --signature release/release-signature.json \
  --output /protected/runtime/verified-release.json \
  --emit-host-helper-record
```

Do not generate, copy, edit, or replace `verified-host-helper.txt` manually. The installer accepts
only the closed record for the current platform and architecture. It copies the bounded payload into
a new root-owned mode-`0700` staging directory, hashes every staged regular non-symlink file against
that authority, then installs only those staged bytes. It never executes the payload or mutates the
installation before verification and never returns to mutable checkout paths after verification.

The fixed installer commands are:

```sh
sudo scripts/install-production-host-helper.sh --dry-run
sudo scripts/install-production-host-helper.sh install
sudo scripts/install-production-host-helper.sh verify
```

The installer creates or verifies the exact dedicated identity: Linux `rak-client` UID/GID 62345
with `/nonexistent`, `/usr/sbin/nologin`, no supplementary groups, and no other account using the
primary group; or hidden macOS `_rakclient` UID/GID 62345 with `/var/empty`, `/usr/bin/false`, empty
group membership, and no other account using that primary group. Any pre-existing mismatch blocks.

The service definition uses fixed installed Node and `service-entrypoint.mjs` paths, runs as root
with a restrictive umask, and accepts no environment file or caller arguments. The installer and
verifier never start, enable, bootstrap, or change the running state of the service. Activation is a
separate explicit root-operator action after installation verification. Its only maintenance verbs
are `reconcile` and the administrator-only `emergency-stop --run-id <id> --runtime-id <id>`.

The Linux service definition has fixed systemd hardening. The macOS launchd definition fixes
identity, paths, arguments, umask, and `RunAtLoad=false`, but launchd does not provide verified
parity for every Linux systemd sandbox directive. Treat macOS sandbox/hardening parity as an
unverified native-platform gate, not as a deterministic installer pass.

Final full CI passes 176/176 Vitest checks, 129/129 release seams, fixtures, shell syntax, build,
foundation smoke, security smoke, and a production audit with no known vulnerabilities. The CI
environment has no native C compiler, so it did not compile or execute the four platform-specific
`rak-peer-cred` payloads. A release operator must retain the NO-GO until real Linux ARM64/x86-64 and
macOS ARM64/x86-64 installation, peer, and sandbox evidence exists.

Both client and service invoke the pinned native peer verifier on the already-connected socket
descriptor. The service admits only the configured client UID; the client admits only UID 0. Owner,
group, mode, digest, platform, or peer mismatch blocks before protocol framing or effects. Do not
replace this with Node-internal socket-handle inspection.

At service start and after any crash, the administrator runs the fixed `reconcile` maintenance path
before accepting new work. Reconciliation must recover or close prepared idempotent effects, fence
stale work, and report exact resource or cleanup residue. Restarting the daemon, deleting its
journal, changing a counter, or manually removing a runtime does not prove recovery. Any
unreconciled or uncertain resource remains a release blocker.

### 1.2 Fixed snapshot transfer directories

The helper is permitted to return bytes only for a finalized source snapshot. It derives—not
accepts—the directory
`/var/lib/repo-assessment-kit/transfers/<installationId>/<runId>/<sourceCommandId>/`. The directory
is `root:<clientGid>` mode `0750`; it contains exactly root-owned, client-group, mode-`0440`
`snapshot.tar` and `manifest.json`.

The unprivileged client derives the same path from the authenticated helper result, opens it with
no-follow descriptors, rechecks ownership/modes/digests, validates and extracts the bounded
canonical archive, and always requests `source.release`. A caller-supplied destination, symlink,
extra file, changed digest, special archive entry, or residue blocks the run. Never copy a transfer
by hand or use it to exchange provider, runtime, secret, or package bytes.

## 2. Provider login, status, and interactive session

Provider authentication is separate from assessment execution. It never belongs in a run JSON file,
`.env`, shell history, target environment, or customer package.

For Codex:

```sh
./start-codex.sh login
./start-codex.sh status
./start-codex.sh interactive
```

For Claude Code:

```sh
./start-cc.sh login
./start-cc.sh status
./start-cc.sh interactive
```

`login` and `interactive` run the release-owned fixed provider command inside the provider-specific
persistent home. They require the signed, nonce-bound provider-inference network configured by the
trusted deployment. `status` is networkless and reports only local provider-session metadata.

The provider receives a bounded, redacted evidence view and typed task context. It does not receive
the live source or snapshot tree, sandbox credentials, SSH material, operational database,
`generated/` tree, package staging, runtime control, helper socket, or Docker socket. Provider
sessions and transcripts remain internal operational material and are not customer-package content.
Selected content sent for inference remains subject to provider-side retention and handling that the
kit cannot enforce.

Do not run `interactive` as a substitute for `run`, and do not ask a provider shell to read a
customer repository. A successful provider login proves authentication only.

## 3. Preflight and self-check

Run preflight with the same launcher that will run the assessment:

```sh
./start-codex.sh preflight
```

or:

```sh
./start-cc.sh preflight
```

Preflight is read-only and does not receive a run configuration. It emits one
`rak-runtime-preflight/1.0.0` JSON document with three readiness profiles:

- `staticRelease` — engagement identifier, authentic release bundle, immutable provider image,
  rootless Docker and Compose, and trusted orchestrator;
- `isolatedRuntime` — all static controls plus the named native Lima worker; and
- `interactiveProvider` — all static controls plus a completely configured provider-egress tuple.

It exits 78 only when `staticRelease` is blocked. An isolated-runtime or interactive-provider
profile may remain blocked in the same report without making the static profile unavailable. SSH,
age, and host provider CLIs are diagnostics only. The top-level `recommendation` names the fullest
compatible mode in this order: full isolated assessment with browser evidence, isolated assessment
without browser evidence, static assessment with browser evidence, then static assessment without
browser evidence.

Preflight does **not** authenticate the provider, validate a source or output path, or verify a
configured provider-egress attestation. Its `providerEgress.verified` value remains false; the
launcher verifies and consumes a fresh attestation immediately before `login` or `interactive`. Run
and resume have their own configuration/journal checks.

Because preflight does not see `runtime.mode`, read the named readiness profile that matches the
planned activity. Missing Lima blocks `isolatedRuntime`, not `staticRelease`. Playwright and
Chromium are installed in the signed, non-root browser-runner image rather than on the host or in a
provider image. Preflight runs a bounded, networkless probe in that image. Browser failure appears
under `limitations.browserCoverage`; it does not block static analysis. The run receipt must still
state whether screenshots and browser-flow verification actually ran.

Treat any typed `blocked` result as a boundary, not permission to widen access. The correct response
to a release-asset or image/provenance mismatch is to obtain the authentic matching bundle from the
release owner.

For a source-only assessment, choose `runtime.mode: "static-only"`. Browser and target runtime
capabilities may be unavailable without invalidating static work. For an isolated run, do not start
until preflight reports the exact runtime controls available.

Maintainers may also run the repository acceptance suite:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run ci
pnpm audit --prod --audit-level high
```

This developer check does not replace provider, SSH, native-platform, human-review, or per-run
release evidence.

## 4. Complete product and customer discovery

Copy `examples/discovery.sample.json` to an engagement-controlled location outside the assessed
source. Record all ten topics:

1. `target-customers`
2. `buyers`
3. `user-roles`
4. `customer-pain`
5. `valuable-workflows`
6. `alternatives-differentiators`
7. `revenue-retention-critical-behavior`
8. `contractual-obligations`
9. `expected-scale`
10. `feature-parity-expectations`

Every topic contains exactly one substantive `statement` or one structured `unknown`. An unknown
records its reason, confidence effect, coverage effect, and follow-up. Use only the supported source
labels: `owner-stated`, `documented`, `observed`, `analytics-supported`, `code-inferred`,
`unverified`, or `conflicting`.

Do not turn repository guesses into owner statements. Do not infer regulatory applicability from a
framework, dependency, geography, or finding.

## 5. Create a strict run configuration

Copy the closest safe example:

- `examples/run.local-static.sample.json`
- `examples/run.ssh-static.sample.json`
- `examples/run.isolated.sample.json`

The document is a closed `rak-release-run-config/1.0.0` contract:

| Field                   | Required rule                                          |
| ----------------------- | ------------------------------------------------------ |
| `schemaVersion`         | Exactly `"1.0.0"`                                      |
| `projectSlug`           | Lowercase letters/numbers joined by single hyphens     |
| `source`                | Exactly one typed `local` or `ssh` object              |
| `discoveryPath`         | Path to the complete discovery JSON                    |
| `outputRoot`            | Must resolve beneath this kit’s `generated/` directory |
| `runtime.mode`          | Exactly `"static-only"` or `"isolated"`                |
| `runtime.targetOrigins` | Exact sandbox-internal HTTP or HTTPS service origins   |
| `sandboxCredentials`    | Handle metadata only, always `production: false`       |
| `optionalServices`      | Empty for this local-only release                      |

Unknown fields fail. Never add raw secrets, provider credentials, an SSH private-key path, Docker
arguments, provider flags, arbitrary commands, production destinations, wildcard origins, or
optional-service destinations.

### Local source

Use:

```json
{
  "kind": "local",
  "path": "../sample-customer-portal",
  "workingTreeMode": "frozen-working-tree"
}
```

The path must resolve to the canonical root of an existing Git worktree. The assessment records the
full commit and includes modified and untracked files in its frozen snapshot. Do not edit, generate
files in, run hooks in, or rebase the source during the run. The discovery file and output root must
not be inside the source.

### SSH source

Use:

```json
{
  "kind": "ssh",
  "url": "ssh://git@source.example.invalid/acme/sample-customer-portal.git",
  "ref": "main",
  "acquisitionProfileId": "sample-read-only-deploy-key"
}
```

Replace the `.invalid` sample with the exact approved Git host and repository. Provision the named
acquisition profile through the trusted host setup, using a short-lived, repository-scoped,
read-only deploy key and pinned known-hosts data. The run JSON names the profile; it never contains
or points to a private key. SSH is confined to the acquisition worker and approved Git host, then
destroyed before assessment.

Reject URLs containing credentials, unknown transports, proxy commands, control characters, or a
host not covered by the signed Git-egress attestation. Do not forward the operator’s general SSH
agent or mount `~/.ssh`.

For a production SSH run, the root configuration must already register the opaque
`acquisitionProfileId` to one exact repository-scoped read-only key or approved agent socket, one
pinned known-hosts file, the expected host/port/fingerprint, expiry, use limit, signed acquisition
image, and Git-egress policy. The public run remains the ordinary closed command:

```sh
./start-codex.sh run --config examples/run.ssh-static.sample.json
```

or the equivalent Claude Code launcher. Internally, the orchestrator may use only
`source.acquire -> source.status -> source.finalize -> fixed transfer import -> source.release`. The
ephemeral non-root worker mounts only the registered key as `0400` (or registered socket),
known-hosts as `0444`, and a bounded work volume. Strict host checking, fixed Git arguments,
disabled hooks/helpers/file transport/submodules, and exact host/port egress are mandatory.

After an interruption, resume only through the original provider launcher and exact run directory.
The helper reconciles the acquisition command by its durable command/request digest; it must not
clone twice. Finalization and `source.release` remain mandatory. Any process, network, mount,
temporary directory, key, agent socket, or transfer residue is `RESIDUE`, blocks resume/release, and
requires administrator reconciliation or emergency stop—not a broader SSH mount or manual cleanup
claim.

### Static-only and isolated target origins

For static-only:

```json
{
  "mode": "static-only",
  "targetOrigins": []
}
```

Static-only performs no target launch or browser checks. Runtime and screenshots must be reported as
blocked, not applicable, or not tested with reasons. They are never counted as passes.

For isolated runtime, list only service origins inside the disposable target network:

```json
{
  "mode": "isolated",
  "targetOrigins": [
    {
      "scheme": "http",
      "host": "app",
      "port": 8080
    }
  ]
}
```

`app` is a sandbox service name, not a public hostname. Do not list production, staging shared with
real users, the physical host, host gateway, local-area network, link-local/metadata address,
wildcard host, or arbitrary Internet URL. A target origin is permission to attempt only registered,
non-destructive controls; it is not general egress approval.

### Sandbox credential handles

The configuration contains metadata, not a secret:

```json
{
  "purpose": "sample-customer-portal-test-login",
  "recipient": "app",
  "handleEnvironment": "RAK_SANDBOX_SAMPLE_LOGIN_HANDLE",
  "production": false
}
```

The trusted broker reads the referenced value once and does not persist it. Supply only a newly
created or explicitly disposable, short-lived, least-privileged, non-billing test credential for the
exact sandbox recipient. An empty list is valid for static-only runs.

Never reuse production or shared test credentials. Never give a target a provider token, SSH key,
cloud credential chain, `.env` file, personal account, or wildcard authority. If safety cannot be
confirmed, omit the handle and accept reduced coverage.

## 6. Run and resume

Run Codex:

```sh
./start-codex.sh run --config examples/run.local-static.sample.json
```

Run Claude Code:

```sh
./start-cc.sh run --config examples/run.local-static.sample.json
```

`run` invokes the trusted host orchestrator. It validates the configuration, resolves one immutable
snapshot, builds the deterministic static draft, admits typed provider proposals, records
limitations, validates reports and exports, builds the package, and writes a verification receipt.
It never exposes the provider image’s private task command.

Each attempt creates one unique directory:

```text
generated/<project-slug>-<full-commit>-<UTC-timestamp>/
```

Do not combine files from separate run directories. The run journal binds the provider, config
digest, source and snapshot, attempts, fences, admitted tasks, receipts, package, limitations, and
cleanup.

If the launcher reports an explicitly resumable stage, use its exact run directory:

```sh
./start-codex.sh resume --run-dir generated/sample-customer-portal-0123456789abcdef0123456789abcdef01234567-20260728T120000Z
```

Use the same provider launcher. Resume revalidates every binding and increases the affected fence.
Completed, cancelled, failed-integrity, or drifted runs do not resume. Do not copy or edit a journal
to make a run resumable; start a successor run instead.

## 7. Monitor coverage honestly

The allowed control results are `pass`, `fail`, `partial`, `blocked`, `not applicable`, and
`not tested`. Every non-pass result must state a reason; `partial`, `blocked`, and `not tested` must
also explain affected coverage and next action.

Browser automation is conditional. It runs only after isolated-runtime and request-guard controls
pass. If unavailable, static assessment continues. Report what was attempted safely, why it stopped,
which controls were affected, how confidence changed, and what would enable a later check.

For isolated mode, run configuration selects only registered profile, approval, control, probe, and
candidate-relative-path IDs. Root configuration owns the immutable runtime catalog, its digest, the
fixed external signer binary and digest, the request-guard issuer public key, signed Lima guest,
resource/network profiles, and exact internal origins. After `vm.create`, snapshot staging,
compilation, and start are durable for the same run/attempt/fence, `request-guard.issue` resolves
those selections against the root catalog and signs the complete one-use dynamic control plan. Node,
the launcher, and run JSON never receive the private signing key or choose methods, routes, budgets,
destinations, or signature bytes. The resulting plan is admitted through `request-guard.admit`; the
request guard remains the only probe-to-target path.

The runtime must use native Lima plain mode, rootless Docker behind the VM broker, cgroup v2
resource enforcement, default-deny root-owned firewalling, no host mounts/forwarding/containerd, and
no physical-host or Docker socket in workloads. A missing catalog, signer, signed origin, approval,
current fence, runtime creation nonce, cleanup receipt, or zero-residue result is a typed blocker.
There is no direct Compose or rootful fallback.

Screenshots are optional evidence, not a success measure. Only approved, uncredentialed PNG/JPEG
captures may enter the package automatically. Raw credentialed screenshots, page bodies, headers,
recordings, browser traces, and downloads remain restricted and are not customer-package content.

## 8. Cancellation and emergency response

The public provider launcher has no `cancel` verb. For an API-backed workflow run, use **Stop and
clean up** in the authenticated loopback interface. For a release-orchestrator run, use only the
trusted cancellation control exposed by the installed release. If that control is unavailable,
record the run as interrupted and escalate; do not invent a shell command.

Request cancellation once. Do not kill individual provider, target, browser, broker, or container
processes first. A completed cancellation fences new work, revokes run secrets, closes egress,
terminates process groups, preserves admitted evidence, and reconciles cleanup. It does not delete
the audit record or customer source.

An interrupt to the foreground launcher is not proof that fenced cancellation or cleanup completed.
Keep the run directory. Confirm the journal’s terminal state and cleanup receipt before release or
host reuse.

For suspected credential disclosure, production contact, source drift, forged/stale authority,
unexpected egress, host-socket exposure, containment drift, or package/redaction failure:

1. Stop approving new activity.
2. Isolate the assessment host from unapproved networks using the organization’s incident process.
3. Preserve the run directory, immutable receipts, timestamps, and released package recipient list.
4. Revoke affected sandbox, SSH, and provider credentials outside the target.
5. Let the trusted cleanup/reconciliation path terminate exact run resources.
6. Do not broaden mounts/network, manually merge evidence, edit the journal, or represent an
   interrupted run as clean.
7. Record which controls became blocked or not tested and start a successor run only after human
   disposition and credential rotation.

If trusted cleanup cannot be verified, the run is not releasable. Do not use broad recursive
deletion, delete another engagement’s provider home, or mount the host Docker socket as a recovery
shortcut.

### Crash and host-service recovery

Preserve the run/pair directories and helper journal. Do not edit either. After a launcher,
provider, SSH worker, VM broker, helper, or host crash:

1. stop approving new activity and keep the dedicated client account from starting another run;
2. have the host administrator run the fixed helper `reconcile` path;
3. inspect only typed status/cleanup results and exact residue IDs;
4. if a runtime may still exist, use the fixed administrator emergency-stop with the exact run and
   runtime IDs;
5. restart `serve` only after reconciliation state is durably recorded;
6. resume through the matching public launcher only when the run journal says the stage is resumable
   and cleanup/residue gates permit it; and
7. create a successor run or pair after any integrity, authority, source, or final-package drift.

Unknown effect state, stale fence, changed transfer, reused nonce, missing cleanup receipt, or
unresolved residue blocks pairing, authorization, and release.

## 9. Verify the package

Identify the run directory and plain ZIP:

```sh
RUN_DIR=$(find generated -mindepth 1 -maxdepth 1 -type d -name 'sample-customer-portal-*' -print | sort | tail -n 1)
ZIP=$(find "$RUN_DIR" -maxdepth 1 -type f -name '*.zip' -print | sort | tail -n 1)
test -n "$RUN_DIR" && test -n "$ZIP"
```

On Linux or WSL, verify the detached digest:

```sh
(cd "$RUN_DIR" && sha256sum --check "$(basename "$ZIP").sha256")
```

On macOS:

```sh
(cd "$RUN_DIR" && shasum -a 256 --check "$(basename "$ZIP").sha256")
```

Create or refresh the journal-bound immutable verification receipt:

```sh
node scripts/verify-release-run.mjs --run-dir "$RUN_DIR"
```

The receipt is `release-verification-receipt.json` in the run directory. It binds the journal,
configuration, source, snapshot, provider outcomes, ZIP, manifest, limitations, and customer-release
status. Then build and run the lower-level independent ZIP validator if a package-only check is also
needed:

```sh
pnpm --filter @rak/packaging build
node packages/packaging/dist/zip-validator-cli.js "$ZIP"
```

A pass must report the reopened ZIP digest and validation digest. Inspect both the receipt and
package status. Digest and ZIP validation do not authorize delivery. The current deterministic
orchestrator writes `DRAFT_VALIDATED_RELEASE_BLOCKED` and `customerReleaseAuthorized:false`; it is
an internal draft until the separate release authority produces evidence for every missing gate.

Open `index.html` only after verification. Reports are static and work without JavaScript or network
access. Do not preview target-supplied HTML in the authenticated operator application.

### Optional age-encrypted copy

The public run configuration has no encryption field. The packaging library can produce an optional
`age`-encrypted copy only when a trusted age-v1 provider successfully decrypts a test copy and
verifies that its digest matches the retained plain ZIP. If no `.age` file and detached digest are
present, encryption was not offered; do not create a release claim from the preflight age diagnostic
or substitute an archive password or home-grown encryption.

Verify the encrypted file’s detached digest before decryption:

```sh
AGE_FILE="${ZIP}.age"
(cd "$RUN_DIR" && sha256sum --check "$(basename "$AGE_FILE").sha256")
```

On macOS, replace `sha256sum` with `shasum -a 256`.

Decrypt with the recipient’s protected identity outside the kit and target trees:

```sh
RECOVERED="$RUN_DIR/recovered-customer-package.zip"
age --decrypt --identity /secure/operator/recipient-identity.txt --output "$RECOVERED" "$AGE_FILE"
EXPECTED=$(awk '{print $1}' "$ZIP.sha256")
ACTUAL=$(sha256sum "$RECOVERED" | awk '{print $1}')
test "$EXPECTED" = "$ACTUAL"
node packages/packaging/dist/zip-validator-cli.js "$RECOVERED"
```

On macOS, calculate `ACTUAL` with `shasum -a 256 "$RECOVERED" | awk '{print $1}'`. Never place the
recipient identity or passphrase in `generated/`, the source, `.env`, shell arguments shared with
others, logs, or the delivered package.

## 10. Delivery checklist

### Paired-provider review and public release transition

Both launchers expose identical closed release operations. They accept no extra provider flags,
signing keys, network, mounts, or pass-through arguments:

```sh
./start-codex.sh pair --codex-run-dir generated/<codex-run> --claude-run-dir generated/<claude-run>
./start-codex.sh review --pair-dir generated/pairs/<pair> --record /protected/reviews/<signed-review>.json
./start-codex.sh authorize --pair-dir generated/pairs/<pair> --record /protected/authorization/<signed-authorization>.json
./start-codex.sh release --pair-dir generated/pairs/<pair>
```

The Claude Code launcher provides the same four operations. `pair` accepts only terminal blocked
drafts with matching immutable inputs, one from each provider, and runs foreign-provider
cross-review. `review` admits one one-use Ed25519 record for exactly one of independent security,
independent decision, technical human, lay human, or customer acceptance. All five records,
reviewers, keys, and nonces must be distinct and bind the exact pair, successor ZIP, reconciliation,
and input digests.

`authorize` accepts only the distinct release-authority signature binding the five reviews and all
required signed release, toolchain, image, software bill of materials, provenance, vulnerability,
official-schema, provider, native-platform, applicable SSH, and cleanup certificates. `release`
reopens and revalidates everything. Only then may it write the exclusive
`rak-customer-release-certificate/1.0.0` sidecar and set the pair journal to
`CUSTOMER_RELEASE_AUTHORIZED`; it never rewrites the immutable draft ZIP.

Until an exact deployed production path and its required real evidence complete these operations,
the status remains `DRAFT_VALIDATED_RELEASE_BLOCKED`. Deterministic tests and fixture signatures do
not authorize use of the public transition.

Do not deliver until all are true:

- the source commit and before/after integrity records match;
- all ten discovery topics are substantive or explicit unknowns;
- all fifteen assessment domains and every planned control reconcile;
- the general security baseline is present; overlay applicability is customer-confirmed where
  claimed;
- material findings and every decision factor resolve to evidence or visibly state
  unverified/conflicting;
- runtime, browser, scanner, screenshot, and platform gaps remain visible;
- independent security, decision, technical-human, and lay-human reviews passed for this package;
- Codex/Claude conformance and required native-platform evidence apply to the released build;
- redaction, secret scan, report validation, manifest, checksums, fresh-process ZIP reopen, and
  optional encryption recovery passed;
- cleanup is reconciled;
- the immutable receipt remains valid and the exclusive digest-bound customer-release sidecar is
  present; and
- no report claims certification, legal compliance, guaranteed security, or completeness.

If any gate is absent, keep the visible blocked status and hand off only as an internal draft.

## Troubleshooting

| Symptom                                                                         | Safe interpretation and action                                                                                                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified release bundle missing, signature invalid, or immutable image mismatch | Obtain the authentic matching `rak-verified-release/1.0.0` bundle from the release owner. Do not create a signature, override a digest, or use a mutable tag.    |
| `preflight` reports provider authentication missing                             | Run the matching provider’s `login`, then networkless `status`; do not pass a token as an argument or config field.                                              |
| Signed provider or Git egress attestation missing/expired                       | Ask the trusted deployment operator to issue a fresh one-use attestation. Do not attach a general network.                                                       |
| Local source integrity changes                                                  | Stop. Preserve the run, determine who or what changed the source, and start a new run after it is stable.                                                        |
| SSH clone blocked                                                               | Check exact host approval, pinned host key, read-only repository access, and acquisition profile. Do not mount general SSH state or change transport.            |
| Runtime capability blocked                                                      | Continue static-only or create a successor run after the bounded isolation control is repaired. Do not run target code directly.                                 |
| Browser cannot run                                                              | Record attempted safe steps, affected controls, confidence effect, and follow-up. Do not count screenshots or runtime behavior as passed.                        |
| Provider proposal is invalid or times out                                       | Preserve the typed failure and limitation. Resume only if the orchestrator marks the stage resumable; never paste prose into the package.                        |
| Package validation or checksum fails                                            | Quarantine the package and run directory. Do not edit the ZIP or regenerate one file by hand; correct the source condition and rebuild through the orchestrator. |
| `age` is unavailable or recovery differs                                        | Deliver the validated plain ZIP only through an approved secure channel, or block delivery if encryption is required. Never claim encryption succeeded.          |
| Run is cancelled or cleanup is incomplete                                       | Do not resume or release. Preserve receipts, complete incident disposition, and use a successor run after reconciliation.                                        |

# Agent runtime compatibility: Codex and Claude Code

_Accessed and validated against current documentation on 2026-07-27._

## Question and decision unblocked

How should the kit launch Codex and Claude Code in Docker while supporting:

- interactive first-run login and persistent sessions;
- unattended execution;
- project instructions, skills, and specialized agents;
- predictable access to generated artifacts;
- optional read-only host instructions; and
- equivalent assessment outcomes without exposing provider credentials to an assessed repository?

This unblocks the P1 agent-adapter and trust-boundary design and the P4 implementation of `start-codex.sh` and `start-cc.sh`.

“Good enough” means both launchers have a documented first-run and repeat-run path, work as a non-root user on Linux ARM64 and x86-64 containers, preserve provider state in separate volumes, support interactive and machine-readable execution, write all customer artifacts to the same mounted `generated/` contract, and fail closed when unattended work requests an unapproved capability.

## Recommendation

**Use two thin, provider-specific launchers over one hardened container contract, with separate pinned CLI images and separate persistent `/home/node` volumes. Do not use either provider’s permission-bypass flag in the normal or unattended assessment path.** Confidence: **high** for CLI/auth/config mechanics; **medium-high** for the complete security posture because neither CLI documents a way to make a credential used by its own process absolutely inaccessible to a malicious prompt running in that same process.

The launchers should share these invariants:

1. Run as a fixed non-root UID/GID. Mount the kit repository read-write at a stable container path derived from its canonical host path; mount local repository inputs read-only at a distinct path. Never mount the host Docker socket.
2. Use different named home volumes, for example `rak-codex-home-v1:/home/node` and `rak-claude-home-v1:/home/node`. Persisting the full home captures Codex's `CODEX_HOME`, Claude's `~/.claude`, and Claude's separate `~/.claude.json` state. Never share a home volume across providers or engagements.
3. Pin the Codex and Claude Code CLI versions in image builds, verify each with `--version`, disable runtime auto-update, and rebuild deliberately to upgrade. Anthropic's dev-container feature installs the latest CLI and auto-updates unless the version and updater are explicitly controlled, which is unsuitable for release-reproducible dry runs ([Anthropic development containers](https://code.claude.com/docs/en/devcontainer)).
4. Keep the canonical assessment workflow in checked-in, provider-neutral files and schemas. Supply runtime adapters:
   - Codex: root `AGENTS.md`, project skills in `.agents/skills/<name>/SKILL.md`, and Codex-only role configuration where needed.
   - Claude Code: root `CLAUDE.md` containing `@AGENTS.md`, project skills in `.claude/skills/<name>/SKILL.md`, and Claude-only subagents in `.claude/agents/*.md`.
   - A shared `SKILL.md` can satisfy both formats; use generated copies or CI-verified thin wrappers rather than assuming either runtime scans the other's directory. Codex scans `.agents/skills`; Claude scans `.claude/skills` ([OpenAI skills](https://learn.chatgpt.com/docs/build-skills), [Anthropic skills](https://code.claude.com/docs/en/slash-commands)).
5. Write assessment artifacts directly beneath the mounted `generated/<project>-<commit>-<timestamp>/`. Treat provider JSON/JSONL streams and transcripts as operational logs, not as the canonical evidence model. Stage logs outside the customer package until redaction and package validation finish.
6. Use a capability-separated assessment engine for cloning, analyzers, and target runtimes. The agent should invoke a small allowlisted kit command surface; untrusted repository build/install/test commands run in the separately isolated target-runtime boundary and receive neither provider home nor provider credential environment.

### Exact launcher modes

Implement an explicit launcher mode instead of passing an ambiguous free-form argument list:

| Kit mode | `start-codex.sh` mapping | `start-cc.sh` mapping |
|---|---|---|
| Interactive | `codex --cd "$KIT" --sandbox workspace-write --ask-for-approval on-request` | `claude --permission-mode default` from `$KIT` |
| Unattended | `codex exec --cd "$KIT" --sandbox workspace-write --ask-for-approval never --json --output-last-message "$RUN_LOG/final.txt" "$PROMPT"` | `claude -p --permission-mode dontAsk --output-format stream-json --verbose "$PROMPT"` with a checked-in/managed narrow `permissions.allow` list |
| Resume interactive | `codex resume <session-id>` (or `--last`) | `claude --resume <session-id>` (or `--continue`) |
| Resume unattended | `codex exec resume <session-id> "$PROMPT"` | `claude -p --resume <session-id> --output-format stream-json --verbose "$PROMPT"` |
| Auth/status | `codex login --device-auth`; `codex login status` | launch `claude` and use `/login`; use `/status` to inspect the active credential |

The unattended modes intentionally differ. Codex's documented default for `exec` is read-only; `workspace-write` plus `never` allows work inside the bounded workspace and returns failures instead of pausing for escalation. Claude's `dontAsk` auto-denies anything not in its explicit allow rules or read-only set. Those are the closest fail-closed equivalents ([OpenAI non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Anthropic non-interactive mode](https://code.claude.com/docs/en/headless), [Anthropic permissions](https://code.claude.com/docs/en/permissions)).

Do not make `--dangerously-bypass-approvals-and-sandbox` or `--dangerously-skip-permissions` the launcher default. If retained for maintainer diagnostics, hide it behind an explicitly named `--unsafe-bypass` option, print a blocking warning, prohibit repository inputs and secrets in that mode, and exclude it from acceptance dry runs.

## Options compared

| Option | Auth/session persistence | Unattended behavior | Host/repository safety | Reproducibility | Decision |
|---|---|---|---|---|---|
| **Separate pinned images + separate full-home volumes + constrained permissions** | Native login caching and resume work for both | Codex `exec`; Claude `-p`; failures are machine-visible | Best fit. Target execution can be separated and CLI escalation fails closed | High when versions and image digests are recorded | **Choose** |
| One image and one shared home volume | Technically possible | Same commands | Provider secrets, state, and project indexes become commingled; provider config can affect the other path | Medium | Reject |
| Blanket bypass inside the outer Docker container | Login/session work | Lowest prompt friction | Explicitly unsafe for malicious repositories; assessed source, provider state, and outbound network coexist | Medium | Reject |
| Ephemeral containers with environment API keys | No browser login persistence | Easy for CI | Keys are present in the process environment; OpenAI explicitly says not to expose a job-wide key where repository-controlled code runs | High but unsafe for this product | Reject as normal path |
| Bind-mount the operator's actual home/provider config | Seamless local login | Works | Exposes unrelated sessions, settings, connectors, and secrets and makes runs non-reproducible | Low | Reject |
| Treat `AGENTS.md`, `CLAUDE.md`, skills, and agents as one portable directory | N/A | N/A | Runtimes discover different paths and agent formats; silent capability loss is likely | Low | Reject |

## Evidence and implementation constraints

### Authentication and persistence

**Codex.** Codex supports ChatGPT login and API-key login. `codex login` uses the browser flow; on a headless/container host, `codex login --device-auth` is the documented fallback. Login state is cached in `auth.json` or an OS keyring, and ChatGPT tokens refresh during use. `CODEX_HOME` defaults to `~/.codex` and contains auth, config, sessions, logs, and skills. File credentials must be treated like a password ([OpenAI authentication](https://learn.chatgpt.com/docs/auth), [OpenAI environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)).

For non-interactive calls, `codex exec` reuses saved CLI authentication. `CODEX_API_KEY` is supported only for a single `codex exec` invocation; OpenAI warns not to expose API-key environment variables to jobs that run repository-controlled code ([OpenAI non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)). Therefore:

- the normal local path should use cached login in the private Codex volume;
- the launcher must not forward `OPENAI_API_KEY`, `CODEX_API_KEY`, or a general `.env` wholesale;
- an API-key mode, if added, must accept the key through a dedicated secret input, scope it to the CLI invocation, and prohibit in-process execution of assessed repository code.

**Claude Code.** On Linux, login credentials live at `~/.claude/.credentials.json` with mode `0600`; `CLAUDE_CONFIG_DIR` relocates that file. Claude Code supports Claude/Console credentials, API credentials, and supported cloud-provider credentials ([Anthropic authentication](https://code.claude.com/docs/en/team)). Anthropic's container guidance says auth, settings, and session history live under `~/.claude` and recommends a named volume there. It also documents `ANTHROPIC_API_KEY` and a `CLAUDE_CODE_OAUTH_TOKEN` created by `claude setup-token` for non-browser environments ([Anthropic development containers](https://code.claude.com/docs/en/devcontainer)).

Persist the full `/home/node`, not only `/home/node/.claude`, because Claude also keeps some global/project state in `~/.claude.json`, including local/user MCP configuration ([Anthropic MCP scopes](https://code.claude.com/docs/en/mcp)). The launcher's volume initialization must run as the final non-root UID so credential files and session directories are not root-owned.

### Interactive, non-interactive, and session behavior

Codex provides an interactive TUI, stable `codex exec`, JSONL event output, schema-constrained final output, `--output-last-message`, and interactive/non-interactive resume by session ID. `--ephemeral` deliberately suppresses session rollout persistence and should not be used for resumable assessment runs ([OpenAI developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [OpenAI non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)).

Claude Code provides interactive `claude`, print mode via `claude -p`, `text`/`json`/`stream-json` output, `--json-schema`, `--continue`, and `--resume`. Print-mode sessions do not appear in the interactive picker but remain resumable by ID. `--no-session-persistence` and `CLAUDE_CODE_SKIP_PROMPT_HISTORY` disable persistence and should not be set in normal assessment runs ([Anthropic CLI reference](https://code.claude.com/docs/en/cli-usage), [Anthropic sessions](https://code.claude.com/docs/en/sessions), [Anthropic non-interactive mode](https://code.claude.com/docs/en/headless)).

Both launcher scripts must:

- allocate a TTY only for interactive/login modes (`-it`), and use `-i` without `-t` for stream mode;
- preserve the CLI's exit status and terminate cleanly on `SIGINT`/`SIGTERM`;
- capture the session/thread ID from JSONL for run metadata;
- keep a stable container working path per host kit path, because both products associate sessions with working/project directories;
- expose explicit `login`, `status`, `interactive`, `run`, and `resume` subcommands in launcher help.

### Instructions, skills, and agents

Codex loads a global `AGENTS.md` from `CODEX_HOME`, then repository `AGENTS.md`/`AGENTS.override.md` files from root to the working directory. It discovers repository skills under `.agents/skills` and supports custom agent roles through Codex configuration. Project `.codex/config.toml` is applied only to trusted projects, so the kit must establish trust for its own checked-in configuration but must never treat the assessed repository as a Codex project root ([OpenAI AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [OpenAI advanced config](https://learn.chatgpt.com/docs/config-file/config-advanced), [OpenAI skills](https://learn.chatgpt.com/docs/build-skills)).

Claude Code loads managed, user, project, and local `CLAUDE.md` files. It does **not** natively read `AGENTS.md`; Anthropic recommends a root `CLAUDE.md` that imports `@AGENTS.md`. Project skills live in `.claude/skills`, and project subagents live in `.claude/agents`. Subagent definitions have provider-specific tool, model, permission, skill, and MCP fields and should be treated as an adapter rather than the canonical workflow ([Anthropic memory](https://code.claude.com/docs/en/memory), [Anthropic `.claude` directory](https://code.claude.com/docs/en/claude-directory), [Anthropic subagents](https://code.claude.com/docs/en/sub-agents)).

For the decision's “read-only global instruction mounts when present” requirement:

- Codex: optionally bind the selected host file to `/home/node/.codex/AGENTS.md:ro`.
- Claude Code: optionally bind the selected host file to `/home/node/.claude/CLAUDE.md:ro`.
- Pre-create the mount parents as the non-root user before adding file mounts.
- Print the source path and SHA-256 of every mounted instruction file and record them in run metadata.
- Provide `--no-host-instructions`; use it for clean release dry runs. Host guidance is behavioral input, not an enforceable policy, and must not silently alter acceptance evidence.

Do not auto-mount arbitrary `~/AGENTS.md`, `~/CLAUDE.md`, settings, hooks, agents, MCP files, or entire host config directories.

### Permissions and the credential boundary

Codex separates the sandbox from approval policy. Its documented low-risk automation pattern is a bounded sandbox with explicit approvals; `approval_policy=never` means an unavailable capability fails rather than prompts. `danger-full-access`/bypass removes the OS sandbox and is documented for externally hardened environments only ([OpenAI sandbox and approvals](https://learn.chatgpt.com/docs/agent-approvals-security)).

Claude Code offers deny/ask/allow rules and `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions` modes. Deny rules take precedence. `dontAsk` is appropriate for locked-down CI; `bypassPermissions` is only for isolated containers/VMs ([Anthropic permissions](https://code.claude.com/docs/en/permissions), [Anthropic permission modes](https://code.claude.com/docs/en/permission-modes)).

Most importantly, Anthropic explicitly warns that a malicious project under `--dangerously-skip-permissions` can exfiltrate anything available inside the container, including credentials under `~/.claude`, and recommends not mounting host SSH or cloud credentials ([Anthropic development containers](https://code.claude.com/docs/en/devcontainer)). The outer container alone is therefore not a sufficient boundary for this assessment kit.

Implement these controls in P1/P2:

- provider auth homes are mounted only in the provider CLI container, never in analyzer/target-runtime containers;
- provider secret variables are removed from child/analyzer environments;
- the target source is not the agent project root and is read-only to the agent path;
- Claude managed settings deny direct reads of its config/credential paths, its sandbox `filesystem.denyRead` covers the same paths for shell commands, and `permissions.allow` exposes only the kit's narrow command surface ([Anthropic settings](https://code.claude.com/docs/en/settings));
- Codex stays in `workspace-write`; managed `[permissions.filesystem].deny_read` covers `~/.codex/auth.json` and other credential paths, and any broader command is rejected in unattended mode. OpenAI documents that a deny-read requirement prevents full-access mode so the local sandbox can enforce it ([OpenAI managed configuration](https://learn.chatgpt.com/docs/enterprise/managed-configuration));
- target runtime network policy is separate from the provider CLI's inference/auth network;
- acceptance includes prompt-injection fixtures that ask the agent to read or transmit both provider credential paths.

This reduces exposure but does not prove that the provider process can safely hold a long-lived credential while following arbitrary hostile instructions. If release requirements are raised to a hostile-code execution guarantee, the recommendation flips to a credential-broker/proxy architecture or a provider-supported ephemeral workload identity, validated separately for each provider.

### Artifact access

Both local CLIs can read and write the mounted working tree through their tools; no cloud artifact transfer is required. Provider output controls are useful for orchestration:

- Codex: `--json`, `--output-schema`, and `--output-last-message`.
- Claude: `--output-format json|stream-json` and `--json-schema`.

Canonical artifacts must remain filesystem outputs under `generated/`, with the assessment engine—not the model's final text—responsible for schema validation, redaction, manifest generation, checksums, and ZIP creation. The launcher should mount no host output directory other than the kit workspace, so all deliverable access is auditable from the single run root.

### Small local spike

The target environment was checked on 2026-07-27. Installed `codex-cli 0.145.0` exposes the documented `exec`, `login`, `resume`, `doctor`, `--sandbox`, `--ask-for-approval`, `--cd`, and dangerous-bypass flags; `codex --help` completed successfully. Claude Code was not installed in this research container, so its command contract is based on the current official CLI reference and must be exercised by the P4 multi-architecture image smoke test. This is the principal item not directly verified by a local invocation.

## Rejected alternatives

1. **Copy the existing `codex-agents` blanket-bypass launcher unchanged.** It is convenient for a trusted tooling repository, but it violates this kit's malicious/prompt-injected repository threat model and Claude's explicit credential warning.
2. **Use `OPENAI_API_KEY` as the Codex unattended credential.** Current Codex documentation specifies `CODEX_API_KEY` for one `codex exec` call and warns against exposing it around repository-controlled code. Persisted `codex login --with-api-key` is possible, but it creates another long-lived secret in the provider home and does not solve tool access.
3. **Share one `.env` across both launchers.** It overexposes unrelated provider and sandbox credentials to every child process. Parse an allowlist of non-provider configuration and pass sandbox credentials only to the separately isolated component that needs them.
4. **Rely on interactive approvals for release dry runs.** They are not reproducible and can deadlock automation. Use Codex `never` and Claude `dontAsk`, with explicit allowlists and a fail-closed result.
5. **Use Claude's dev-container feature unmodified.** Its feature tag pins the installer feature, not the Claude Code release, and the installed CLI auto-updates by default. Install a pinned CLI in the product Dockerfile and set `DISABLE_AUTOUPDATER=1`.
6. **Claim byte-identical output across providers.** The brief correctly requires equivalent outcome and validation contracts, not identical prose. Enforce shared JSON Schemas, evidence validation, and package acceptance instead.

## Validation plan

P4 should automate all checks below; P7 should retain their logs outside the customer package and add redacted summaries to release evidence.

1. **Image/platform:** build each pinned image for `linux/amd64` and `linux/arm64`; assert non-root UID, exact CLI version, writable provider home, no Docker socket, and no unexpected host mounts.
2. **First login and reuse:** on a fresh provider volume complete container login, stop the container, launch a new one, and verify `codex login status` / Claude `/status` without logging in again. Inspect permissions: Codex auth and Claude `.credentials.json` must not be group/world readable.
3. **Volume isolation:** seed unique sentinels in each provider home; prove the other launcher and every target-runtime/analyzer container cannot read them.
4. **Interactive smoke:** start each TUI at the same stable kit path, verify root project instructions and one provider-neutral skill, create a harmless file only under a temporary generated run, exit, and resume by captured ID.
5. **Unattended smoke:** run the same structured fixture through `codex exec` and `claude -p`; parse JSONL, assert a non-zero exit on forced permission failure, capture the session ID, resume it, and validate the same output schema.
6. **Instruction mounts:** run with no host file, each provider's fixture global file, and `--no-host-instructions`; verify printed path/hash and actual instruction discovery. Ensure a read-only mount cannot be edited.
7. **Permissions:** attempt writes to target source, provider home, `.git`, an unrelated host path, and `generated/`. Only the declared generated staging path may succeed. Attempt undeclared network access and assert failure.
8. **Credential/prompt-injection:** place prompts and repository files instructing the agent to print, copy, encode, or transmit auth files and sentinel environment values. Assert denials and scan stdout, stderr, JSONL, screenshots, `generated/`, manifests, and ZIP bytes for sentinels.
9. **Artifact equivalence:** run one runnable and one deliberately blocked fixture through both launchers; both packages must pass the same discovery, evidence, security, coverage-status, manifest, checksum, redaction, and no-placeholder acceptance suite.
10. **Signal/cleanup:** interrupt each mode; verify the container stops, the target source remains unchanged, the run is resumable or honestly marked interrupted, and no orphan process or credential-bearing temporary file remains.

## Risks and what would change the recommendation

- **Credential isolation remains the hardest unresolved point.** A future official local credential proxy/workload-identity mechanism that keeps secrets outside tool-visible process state would strengthen and may alter the launcher architecture.
- **CLI surfaces change quickly.** Pin versions and rerun `--help`, login, resume, permission, skills, and JSON-stream contract tests on every upgrade. Claude documents several behaviors with minimum-version gates, and Codex configuration/profile semantics have also changed.
- **Managed workspace policy can disable auth types, bypass modes, models, or features.** Preflight must report the active auth/provider and fail with operator guidance rather than silently switching.
- **Host global instructions reduce reproducibility.** If release review finds they can change required outcomes, make `--no-host-instructions` the production default and retain mounts only as an explicit operator option.
- **A fully non-interactive fresh login is not equivalent across consumer subscriptions.** Unattended runs should consume a previously initialized private volume or an approved enterprise/API credential path; launchers must not scrape or automate browser login.

## Sources

All sources accessed 2026-07-27.

### OpenAI

- [Authentication](https://learn.chatgpt.com/docs/auth)
- [Environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)
- [Advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)
- [Managed configuration](https://learn.chatgpt.com/docs/enterprise/managed-configuration)
- [Agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Developer commands / CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Build skills](https://learn.chatgpt.com/docs/build-skills)

### Anthropic

- [Development containers](https://code.claude.com/docs/en/devcontainer)
- [Authentication and credential management](https://code.claude.com/docs/en/team)
- [CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- [Manage sessions](https://code.claude.com/docs/en/sessions)
- [Configure permissions](https://code.claude.com/docs/en/permissions)
- [Settings](https://code.claude.com/docs/en/settings)
- [Permission modes](https://code.claude.com/docs/en/permission-modes)
- [Project memory and CLAUDE.md](https://code.claude.com/docs/en/memory)
- [Explore the `.claude` directory](https://code.claude.com/docs/en/claude-directory)
- [Skills](https://code.claude.com/docs/en/slash-commands)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [MCP scopes and state](https://code.claude.com/docs/en/mcp)

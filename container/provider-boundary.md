# Provider task capsule boundary

The provider image contains only the pinned provider CLI, its immutable entrypoint, and the
task-capsule runner. Public `login`, `status`, and `interactive` use one writable persistent home
scoped to the exact engagement and provider. That interactive home is never a task mount. A trusted
broker-owned task invocation may mount exactly:

- one fresh sterile tmpfs home at `/home/node`;
- one release-allowlisted provider auth/session regular file, read-only, at its fixed
  `/run/rak/provider-auth/<provider>/` path;
- one immutable directory containing `/run/rak/task/task.json`;
- one empty proposal outbox at `/run/rak/proposal`.

`task.json` is the strict `provider-task-envelope/1.0.0` contract in `task-capsule.schema.json`. It
binds the invoked provider to the same typed `AgentTaskCapsule`, requested-capability object, output
schema ID, and release-owned acceptance-check IDs used by both adapters. Unknown fields and the
former `{schemaVersion, taskId, prompt}` shape are rejected. The runner also rejects a
provider/inference mismatch, unattested provider inference, permission bypass,
source/SSH/state/kit/generated/helper/runtime visibility, arbitrary network, non-outbox output,
unknown commands, and non-allowlisted evidence.

Provider flags are fixed in the image and regression-checked against the adapter's exported
canonical CLI specification. The complete typed capsule—not a prompt extracted from untrusted
input—is sent on stdin. Codex remains pinned to read-only sandboxing with approval `never`, an exact
proposal working directory, ephemeral/strict configuration, ignored user config/rules, an explicit
stdin marker, empty MCP/notification configuration, and project-instruction discovery disabled.
Claude remains pinned to `dontAsk`, no user/project/local settings sources, strict empty MCP/tool
configuration, and deny precedence. The writable interactive/login home is never mounted into a
task. The broker admits only one provider-specific auth/session regular file through an opaque
handle after rejecting symlinks, permissive modes, and unexpected siblings; its bytes never enter
the journal or logs. Provider stdout is bounded by the admitted task output budget and written once
to the proposal outbox.

The provider home ID is not derived from a run ID or accepted from the orchestrator. A signed
launcher/deployment receipt binds the engagement, provider, opaque auth-store ID, deployment ID,
home ID, validity interval, and nonce. The broker independently verifies that receipt and requires
the session reader and staged auth file to report the same identities and authority digest.

Codex receives the immutable release-owned `rak-agent-proposal/1.0.0` JSON Schema through its fixed
`--output-schema` path. Provider stdout remains an event stream, not a proposal: pinned
version-specific Codex/Claude parsers reject binary, duplicate-member, oversized, unknown,
out-of-order, error, tool, multiple-final, and trailing events. Exactly one final structured payload
is extracted, identity/evidence/schema validated again, and written as
`/run/rak/proposal/proposal.json`.

The runner creates a dedicated provider process group. At the earlier of the admitted wall limit or
deadline it signals the entire group, immediately closes its local stdio endpoints, and force-kills
the group after a fixed 250 ms grace. This process-group boundary is deterministic runner evidence
only; it is not a claim about real provider, container-cgroup, or host containment. Source,
snapshots, evidence storage, kit code, SQLite, `state/`, `generated/`, SSH material, Docker/Lima
sockets, and other-run data are forbidden.

The `task` entrypoint is reserved for a trusted signed broker after it has authenticated and
admitted the task, evidence view, fence, acceptance catalog, and provider-egress attestation. The
public launchers do not expose `task`. `run` and `resume` call only the fixed trusted host
orchestrator; `interactive` invokes only the provider's fixed entrypoint command. There is no public
or environment-variable flag bypass. No private broker signing material belongs in either provider
image.

`container/compose.yaml` is a networkless build/status diagnostic only. Its `/home/node` mounts are
fresh anonymous volumes, so it cannot retain login credentials or stand in for the public launchers.
Credentialed launchers verify the signed release-assets bundle and run only the verifier-returned
`reference@sha256:...`; mutable Compose tags and self-declared labels are never authority.

The fixed flags and sterile-home contract are deterministic release controls, not evidence that a
real provider version ignores every plugin/config surface. P7 real-CLI canary evidence must prove
that hostile Codex config/AGENTS/MCP/notification files and Claude settings/hooks/MCP files in the
interactive home cannot influence task launch or output.

Provider output is an untrusted proposal. The runner does not admit evidence, change workflow state,
or create a package. The adapter/broker must parse the provider event stream, apply every named
release-owned acceptance check to the proposal, and produce the normalized `AgentOutcome` before any
downstream admission.

# P7 frozen release-run contract

Status: frozen by the tech lead on 2026-07-28. Only the tech lead changes this interface.

## Public launcher surface

Both `start-codex.sh` and `start-cc.sh` expose the same closed verbs:

```text
login
status
interactive
preflight
run --config <absolute-or-repository-relative JSON path>
resume --run-dir <generated run directory>
pair --codex-run-dir <generated run directory> --claude-run-dir <generated run directory>
review --pair-dir <generated pair directory> --record <signed review JSON path>
authorize --pair-dir <generated pair directory> --record <signed authorization JSON path>
release --pair-dir <generated pair directory>
```

No other arguments, provider flags, commands, environment-supplied flag strings, or pass-through
separator are accepted. `login` and `interactive` use the provider's separate persistent home and
the release-owned fixed CLI command. `status` is networkless. `preflight` is read-only.

The production helper/runtime, trusted SSH, provider-pair, human-review, authorization, and final
release operations are frozen in `.agent-build/specs/production-release-contract.md`. It is part of
this interface. Public `run`/`resume` use its production helper adapter; injected capabilities are
test-only. `pair`, `review`, `authorize`, and `release` are identical from either provider launcher
and never accept provider flags or private signing material.

`run` and `resume` execute the trusted host release orchestrator. They never expose the provider
image's private `task` verb. When Docker/rootless isolation, the pinned provider CLI/image, the
signed provider-egress attestation, or another required control is missing, the command exits
fail-closed with a typed reason and concrete remediation. It never falls back to direct provider
execution.

Every credentialed or networked container launch consumes only
`rak-verified-release/1.0.0` output from `scripts/verify-release-assets.mjs`. That verifier checks
an Ed25519-signed, digest-bound release manifest and toolchain/SBOM/provenance/license/vulnerability
inventory against the pinned release public key. The launcher runs only the returned
`immutableReference` (`reference@sha256:...`). A mutable tag, local image label/ID, raw environment
digest, unsigned manifest, or auto-built image is never authority for a provider/acquisition task.

## Assessment configuration

`run --config` accepts one strict, versioned `rak-release-run-config/1.0.0` JSON document:

```text
schemaVersion: "1.0.0"
projectSlug: lowercase slug
source:
  {kind:"local"; path:string; workingTreeMode:"frozen-working-tree"}
  or {kind:"ssh"; url:string; ref?:string; acquisitionProfileId:string}
discoveryPath: string
outputRoot: string                         # must resolve beneath generated/
runtime:
  mode: "static-only"|"isolated"
  targetOrigins: [{scheme:"http"|"https"; host:string; port:number}]
sandboxCredentials: [{
  purpose:string; recipient:string; handleEnvironment:string; production:false
}]
optionalServices: []                       # MVP release run remains local-only
```

Unknown fields fail. Raw credentials, provider credentials, SSH private-key paths, Docker
arguments, provider flags, arbitrary commands, production endpoints, wildcard origins, and
optional-service destinations are not configuration fields. `sandboxCredentials` contains handle
metadata only; the referenced environment value is read once by the trusted broker, never
persisted, and must be explicitly non-production. Empty credentials are valid for static-only
runs.

## Release orchestration and journal

The host orchestrator:

1. validates the config and runtime capability;
2. resolves an immutable source snapshot without modifying it;
3. creates a deterministic offline/static draft and safe evidence view;
4. creates release-owned typed provider task capsules only from that view;
5. submits each task to the private broker and validates its proposal/receipts;
6. records limitations when a gated activity is unavailable;
7. validates reports, exports, manifest, checksums, ZIP reopen, and optional encryption;
8. writes an immutable verification receipt.

Every run has one `rak-release-run-state/1.0.0` journal beneath its unique directory under
`generated/`. It binds provider, config digest, immutable source/snapshot digests, task IDs,
attempt/fence tokens, admitted task-envelope digests and one-use nonces, provider session IDs,
proposal receipts, stages, package paths/digests, limitations, and cleanup. Atomic replace plus
fsync is required. Resume revalidates every binding, increments the affected fence, and continues
only an explicitly resumable stage. Completed, cancelled, failed-integrity, or drifted runs do not
resume.

## Private provider broker

The broker is invoked only by the orchestrator with a generated journaled job ID. It independently
revalidates the strict `provider-task-envelope/1.0.0`, registered schema/check IDs, current
attempt/fence, deadline/budgets, exact provider, one-use nonce, provider-egress network
attestation, and admission digest before launch.

Each admitted task also binds one release-owned proposal profile and its exact instruction text
inside `instructionBundleDigest`. Author tasks use
`rak-author-claims-proposal/1.0.0`: `content` contains only bounded evidence-cited `claims` and
`limitations`. Reviewer tasks use `rak-review-proposal/1.0.0`: `content` contains only the exact
admitted `authorProposalDigest`, verdict, objection codes, and admitted evidence IDs. The reviewer
digest is present in both the typed task and run context. The output JSON Schema admits only those
two closed shapes; the task runner, adapter, orchestrator, and successor validator independently
recheck the selected task/role profile, evidence allowlist, limitation binding, safe text, and
reviewer digest. A generic object or profile mismatch is quarantined and cannot create a successor
package.

The provider container receives only:

- a fresh per-task sterile home/tmpfs;
- release-allowlisted provider authentication/session files mounted read-only from the
  provider-specific login store, after no-follow/type/mode checks;
- one exact task file, read-only;
- one fresh proposal outbox, read-write;
- bounded tmpfs; and
- the explicitly attested provider-inference network.

It receives no source/snapshot tree, host Docker socket, SSH material, SQLite/state, kit source,
generated tree, runtime, helper socket, sandbox credential, or arbitrary network. The broker
validates and closes proposal and operational-log receipts, kills the process group on
timeout/cancellation, removes the task/outbox staging tree after admission, and records cleanup.
The writable home used by `login`/`interactive` is never mounted into a brokered task. Provider
configuration, instructions, hooks, MCP settings, plugins, and updater state are not copied from
that home; only release-allowlisted credential/session regular files may cross the boundary.

## Output and release truth

A successful provider run means the typed proposal and resulting assessment draft/package passed
the deterministic validators. It does not itself satisfy independent human review or authorize
customer release. Until every P7 gate has evidence, output remains visibly
`DRAFT_VALIDATED_RELEASE_BLOCKED` and `customerReleaseAuthorized:false`.

A validated single-provider successor is still a blocked draft. Same-provider reviewer output is
not organizational independence, and separate provider runs are not cross-provider equivalence
until their immutable run identities are bound by the paired-run profile and the required outcomes
are reconciled. Final-digest human and release-authority records remain external to provider
proposals and to the ZIP they authorize.

Codex and Claude Code consume equivalent task capsules, registered checks, evidence views, budgets,
and output schemas. Cross-provider conformance compares required outcome/evidence/limitation
contracts, not byte-identical prose.

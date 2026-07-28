# Isolated runtime boundary

This Lima template deliberately has no host mounts, port forwarding, containerd, or host Docker
access. The trusted host helper may create this disposable VM only through the typed runtime
protocol defined in the architecture. A runtime is reported `blocked` until native architecture,
rootless Docker, broker identity, cgroups, default-deny egress, cleanup, and resource enforcement
attestations pass.

The kit container never receives `/var/run/docker.sock`, a Lima socket, or a generic host command
channel. Do not add those mounts to make a capability check pass.

`rak-runtime-gate` is the fixed native release interface. It delegates only named adversarial
self-tests to the installed P5 broker and fails if that broker is absent. Installation of the
broker, gate, fixtures, and read-only attestation is part of runtime image promotion; P4 does not
fabricate successful broker evidence.

## Operator gates

The public launchers expose only `login`, `status`, `interactive`, `preflight`,
`run --config <path>`, and `resume --run-dir <generated/run-directory>`. Set a unique lowercase
`RAK_ENGAGEMENT_ID` before an interactive-home verb. Credentialed verbs also require the trusted
helper's one-use provider-network variables; provider flags and credentials are never launcher
inputs.

`preflight` emits `rak-runtime-preflight/1.0.0` JSON and exits 78 when static release controls are
blocked. It reports static readiness separately from isolated-runtime readiness. It diagnoses
Docker, Podman (unsupported diagnostic only), Lima/native architecture, host provider CLIs
(diagnostic only), SSH, age, the locally built browser image containing Playwright and Chromium,
locally built provider images, and the trusted orchestrator. It does not consume or claim to verify
a one-use egress attestation.

`run` and `resume` pass only the fixed provider identity and validated path to
`scripts/run-release-assessment.mjs`. They never mount the interactive home or invoke the private
image `task` verb. Missing controls emit typed `RAK_LAUNCHER_BLOCKED` output and exit nonzero; there
is no direct-host, mutable-tag, rootful-Docker, or broad-mount fallback.

## Production helper and isolated-runtime deployment

The runtime template is usable in production only behind the installed root host helper. The public
launcher remains the configured nonroot client UID/GID. The helper owns the root-only journal, Lima,
firewall, request guard, secret broker, runtime broker, and fixed operation catalog; the client
communicates only through `/var/run/repo-assessment-kit/host-helper.sock` using the mode-`0600`
32-byte key at `/run/secrets/rak-host-helper-client.key`.

Installation authority comes from the signed schema-v2 release manifest's closed `hostHelper`
section, not from a checkout-local digest. It binds the installer, modules, service definitions, and
native payload pair at
`container/runtime/install/payload/{linux-arm64,linux-x86-64,macos-arm64,macos-x86-64}/`. A root
release-verification ceremony checks the signature only with the fixed out-of-band
`/etc/repo-assessment-kit/release/release-signing-public-key.pem` and uses
`--emit-host-helper-record` to exclusively create root-owned mode-`0400`
`/var/lib/repo-assessment-kit/release/verified-host-helper.txt`. Trusted-key overrides cannot emit
that record.

The root installer verifies the platform/architecture record and every payload digest, copies the
bounded set into a fresh root-owned mode-`0700` staging directory, rehashes it there, and installs
only from those staged bytes. This closes checkout hash/use races. It also enforces the exact
dedicated client account/group closure: UID/GID 62345, no login/home authority, no supplementary
members, and no other primary-group users. `install`, `verify`, and `--dry-run` never start, enable,
or bootstrap systemd/launchd; service activation is a separate root-operator decision.

The launchd unit fixes root identity, installed paths, arguments, umask, and `RunAtLoad=false`, but
it has not demonstrated sandbox-hardening parity with all Linux systemd directives. Native macOS
evidence must clear that platform caveat.

The service and client must authenticate the already-connected socket with the pinned native
`/usr/local/libexec/rak-peer-cred`: service expects the configured client UID, client expects UID 0.
The verifier is root-owned mode `0755`, platform-matched, and digest-pinned in the root-owned
mode-`0440` configuration. A missing verifier or owner/mode/digest/peer mismatch blocks before any
request.

The production VM path is fixed:

1. `vm.preflight` proves native architecture and the registered immutable guest/profile.
2. `vm.create`, `vm.stageSnapshot`, `vm.compile`, and `vm.start` durably bind one creation nonce,
   snapshot, plan, exact internal origins, approvals, and resource/network profiles.
3. `request-guard.issue` resolves only registered selections from the root-owned immutable catalog
   and invokes the configured fixed external signer. The caller cannot supply methods, routes,
   budgets, destinations, private-key paths, or signature bytes.
4. `request-guard.admit` installs that one-use signed plan. All probes traverse the request guard.
5. Stop/destroy and helper reconciliation must report zero residue before resume, pairing, or
   release.

Lima plain mode has no host mounts, agent/guest forwarding, dynamic forwarding, bridged networking,
built-in containerd, or target port forwarding. Workloads use rootless Docker through the VM broker,
never a physical-host/rootful/broker socket. The root-owned firewall denies external IP, DNS, LAN,
metadata, control, and provider destinations by default.

## Crash and residue handling

The root service journals prepared effects before execution and fsyncs counter, nonce, idempotency,
fence, resource, result, and cleanup state. A service restart must run the fixed `reconcile`
maintenance path before accepting new work. Reconciliation may return a byte-identical durable
result for the same request or typed residue; it never guesses success.

For an uncertain runtime, the administrator may invoke only the fixed
`emergency-stop --run-id <id> --runtime-id <id>` maintenance verb. Emergency stop fences work,
revokes network plans and secrets, cancels exact process groups/cgroups, destroys the
creation-nonce-bound runtime, fsyncs cleanup, and reports remaining IDs. Any uncertainty or residue
blocks resume and customer release. Manual VM/container deletion is not a cleanup certificate.

## Evidence status

The repository contains the closed production interfaces and deterministic fail-closed checks. Final
full CI passes 174/174 Vitest checks, 126/126 release seams, fixtures, shell syntax, build,
foundation smoke, security smoke, and a production audit with no known vulnerabilities. That is
product evidence only.

The CI environment has no native C compiler, so it did not compile the four `rak-peer-cred` payloads
or execute real peer checks. Customer release remains blocked until the exact signed deployment
passes native Linux ARM64/x86-64 and macOS ARM64/x86-64 containment, peer verification,
hostile-runtime, credential-output, crash/recovery, and zero-residue exercises. Do not mark this
runtime supported from fixtures or contract tests alone.

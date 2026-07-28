# Repository Assessment Kit — Safety and Security Specification

**Status:** safety contender 1  
**Strategy:** assume a deliberately malicious repository and design for container, daemon,
parser, provider, and VM compromise  
**Applies to:** `rak-contract/1.0.0`, `rak-workflow/1.0.0`,
`rak-export-profile/1.0.0`  
**Normative language:** MUST, MUST NOT, SHOULD, and MAY are requirements terms. A MUST
failure is fail-closed unless this document explicitly permits reduced coverage.

## 1. Safety posture and ship decision

The assessed repository is hostile input, not merely imperfect code. Git objects,
filenames, symlinks, archives, Compose YAML, Dockerfiles, images, application traffic,
scanner output, screenshots, documentation, issue text, and instructions embedded in source
may attempt code execution, credential theft, prompt injection, network exfiltration,
resource exhaustion, evidence forgery, or escape to the physical host.

The product is safe enough to ship only when:

1. static acquisition and analysis cannot execute target-controlled code or configuration;
2. provider jobs can treat target text as evidence without giving that text authority over
   tools, credentials, policy, evidence admission, or packaging;
3. dynamic execution occurs only in a disposable, mount-free worker VM whose rootless
   Docker daemon is reachable solely through a typed policy broker;
4. untrusted Compose is compiled into a new release-owned plan and is never passed through
   to Docker Compose as authority;
5. external egress is denied by default and every exception is destination-, purpose-,
   data-, credential-, run-, and time-scoped;
6. a compromised target, browser, scanner, or worker daemon cannot access provider/SSH
   credentials, the physical-host Docker API, the live source, the operational database,
   or package staging;
7. any failed attestation, ambiguity, timeout, crash, exhaustion, stale fence, cleanup
   residue, or unsupported runtime becomes explicit blocked/partial coverage and never a
   relaxed control or false pass.

No dynamic finding is worth weakening one of these boundaries. Static-only packages are a
supported outcome. Host socket mounting, privileged DinD, broad home/source mounts,
production credentials, arbitrary runtime egress, direct Compose execution, and
permission-bypass provider modes are release-blocking and have no override.

## 2. Threat model

### 2.1 Protected people and assets

| Asset/person | Harm to prevent |
|---|---|
| Assessment operator and physical host | Host compromise, persistence, LAN exposure, resource exhaustion, unrelated-file access |
| Customer software owner | Source or trade-secret disclosure, false assurance, secret leakage, destructive production activity |
| Repository contributors and users represented in fixtures | Exposure of personal data, tokens, logs, screenshots, or customer records committed to source |
| Provider and SSH accounts | Credential theft, session takeover, unauthorized inference/API spend, private-repository access |
| Assessment integrity | Target alteration, forged evidence, stale-attempt admission, fabricated coverage, tampered package |
| Other local projects/runs | Cross-run reads, writes, deletion, credential or evidence confusion |

### 2.2 Adversaries and assumed capabilities

- A repository author controls every target byte, path, Git object, submodule/LFS pointer,
  configuration file, dependency, build step, image, runtime response, and embedded
  instruction.
- A malicious Git, package, image-registry, or optional-service endpoint may return
  malformed, oversized, mutable, or exploit-oriented content.
- Target code may obtain arbitrary code execution as root inside an inner target container.
- A parser, analyzer, browser, target container, or rootless worker daemon may be
  compromised by target input.
- A provider model may follow prompt injection and propose arbitrary commands, reads,
  uploads, claims, or policy changes.
- The local operator may make a mistake, but is the sole authorized approver. Remote web
  attackers are out of normal reach because the UI is loopback-only; the product MUST
  nevertheless authenticate state-changing browser requests.

The physical host kernel/hypervisor, the pinned RAK server/helper, the policy compiler,
evidence admission, packager, VM image, and broker are trusted. A vulnerability in that
trusted computing base is residual risk, not an acceptable reason to expand it.

### 2.3 Principal abuse stories

1. A Compose file hides `/`, `/var/run/docker.sock`, a device, host networking, or a remote
   include behind interpolation/extends and escapes to the host.
2. A Dockerfile or package hook uses approved build egress to upload the repository or
   probes metadata/LAN services.
3. A malicious filename, archive, XML/JSON/YAML document, image, or scanner result exploits
   acquisition, normalization, preview, or reporting.
4. Repository text tells Codex/Claude to read its auth home, call an optional service,
   change policy, suppress a finding, or forge evidence.
5. A target compromises Playwright/ZAP or the rootless daemon, then attacks the VM broker,
   guest firewall, control channel, or physical hypervisor.
6. A fork bomb, log flood, decompression bomb, huge repository, excessive replicas, or disk
   fill makes safety checks fail open or damages other runs.
7. A stale or replayed helper/broker response admits old evidence, redeems a secret twice,
   destroys the wrong resource, or marks a control passed after cancellation.
8. Raw evidence, screenshots, logs, source snippets, or provider transcripts place secrets
   or personal data in the customer ZIP.

## 3. Non-negotiable trust invariants

The following invariants are machine-tested and continuously attested:

**SI-01 — no physical Docker authority.** No server, provider, analyzer, target, probe, or
worker-VM process receives the physical-host Docker/Podman socket, API certificate,
`DOCKER_HOST`, containerd socket, Lima control socket, or a socket proxy. Only the fixed
host helper may invoke physical Docker/Lima operations.

**SI-02 — no generic privileged operation.** The web API, workflow/helper protocol, and
broker protocol contain no `exec`, shell, arbitrary argv, arbitrary image, arbitrary
environment, arbitrary path, arbitrary destination, generic copy, generic delete, or
Compose passthrough. Unknown protocol fields and unknown enum values are rejected.

**SI-03 — one-way content movement.** Live source can move only through acquisition into a
verified immutable snapshot; snapshots can move only by registered digest into a worker;
worker output can move only as declared, closed, quota-bounded receipts into quarantine;
only validated/redacted occurrences can move into admitted storage and package staging.
Targets never mount `generated/`, SQLite, provider exchange, or package staging.

**SI-04 — credential separation.** Provider auth exists only in its provider/engagement
home. SSH input exists only in one acquisition worker. Sandbox credentials are one-use,
purpose- and recipient-bound. No component receives a general `.env`. Provider and SSH
credentials are forbidden VM-envelope purposes.

**SI-05 — immutable identity.** Every job is bound to `{runId, attemptId, fenceToken,
snapshotId, commitSha, manifestDigest}`. Any mismatch or stale fence rejects the operation
and all its receipts. Retries append; completed evidence is never overwritten.

**SI-06 — default deny.** Mounts, commands, network, plugins, target configuration,
credentials, evidence display, Compose fields, and exported files are denied unless a
release-owned policy explicitly allows them.

**SI-07 — two containment layers for dynamic work.** Target code runs in rootless
containers inside a disposable VM. Inner container hardening is defense in depth; the VM
is the primary hostile-runtime boundary. Rootless Docker without the VM is not an allowed
hostile-repository mode.

**SI-08 — independent enforcement.** `internal: true`, proxy configuration, Compose
resource declarations, and provider tool instructions are not sufficient on their own.
Egress has a root-owned guest-firewall enforcement point; resources have a VM ceiling;
provider permissions have OS/container policy; evidence claims have deterministic
admission.

**SI-09 — no silent weakening.** Missing tools, stale databases, unsupported architecture,
parser ambiguity, security-control incompatibility, denied approval, scanner crash,
browser failure, or unavailable isolation changes coverage to `partial`, `blocked`,
`not applicable`, or `not tested` with a reason. It never triggers online fallback,
broader permissions, different tools, or a pass.

**SI-10 — target bytes are inert at privileged surfaces.** Target-derived active content
is never interpreted in the operator origin, a report template, a shell, a provider
configuration file, a scanner config, or a package path. It is escaped text or an
attachment; previews are bounded, metadata-stripped derived occurrences.

## 4. Data map and privacy requirements

| Data class | Purpose | Permitted location/recipient | Default retention | Required controls |
|---|---|---|---|---|
| Repository source and Git history | Assessment input | Immutable local snapshot; selected snippets sent to chosen inference provider only after disclosure/approval | Life of run; deletion on explicit run deletion | Customer authorization, minimization, content digest, no target egress |
| SSH key/agent and known-host input | Private Git acquisition | Exact ephemeral acquisition worker only | Never persisted by RAK; worker destroyed after capture | strict host verification, no logs/artifacts/fingerprints except selected key and host-key fingerprints |
| Provider credentials/session | Agent inference | One provider-specific engagement home and provider CLI | Until explicit engagement cleanup | mode 0600, separate volumes, deny tool reads, never packaged |
| Sandbox credentials/test accounts | Authorized runtime checks | In-memory secret broker and one named VM service/probe | Until expiry, consumption, cancellation, or run end, whichever is first | one use, envelope binding, tmpfs, revocation, no production values |
| Owner statements/discovery | Product context | SQLite and redacted package exports | Life of run | purpose notice, provenance, edit/audit history, do not solicit unnecessary personal data |
| Raw scanner/runtime evidence | Findings and reproducibility | Per-attempt quarantine | 7 days after terminal run unless shortened | quotas, sensitivity classification, redaction before admission |
| Operational logs/provider exchange | Diagnosis and resume | Internal run directories only | 30 days | allowlisted fields only; no bodies, source, cookies, tokens, prompts, or raw output in logs |
| Admitted evidence and snapshot | Auditable assessment | Run CAS/canonical storage | Life of run | immutable occurrences, access through safe APIs, explicit deletion |
| Customer package/plain ZIP | Delivery | Validated package directory/operator download | Until explicit package deletion | final secret scan, manifest/checksums, loopback authenticated download |
| Optional hosted-service payload | Explicit deeper analysis | Exact disclosed recipient only | Recipient-specific; shown before approval | data-category disclosure, destination/method scope, separate credential, no silent fallback |

RAK is local and single-operator, but assessed source can contain personal data. The intake
MUST require the operator to attest that they are authorized to process the repository and
to disclose the selected provider and optional external recipients before source-derived
content leaves the machine. Provider inference is an external data flow even when it is a
core product dependency.

The provider context builder MUST minimize source transfer: task-specific evidence only,
repository-relative paths, no `.git` credentials/config, no secret-classified occurrences,
no raw environment files, no provider/SSH data, and fixed per-task byte/file budgets.
Sending the full repository merely for convenience is prohibited. Every provider task
records the selected evidence IDs, byte count, provider, model if known, and disclosure
version; it MUST NOT log the content itself.

Telemetry is off. No analytics, crash report, package, finding, prompt, hostname, path, or
usage data leaves the installation except declared provider inference, approved
acquisition, approved build acquisition, or an explicitly approved optional service.

Where personal data is in scope, data minimization and purpose limitation reflect GDPR
Article 5(1)(b)-(c), data-protection-by-design reflects Article 25, and technical safeguards
reflect Article 32. Whether GDPR, CCPA/CPRA, contractual secrecy, export controls, or another
regime applies is customer/legal context and MUST remain `not-assessed`,
`customer-stated`, or `customer-confirmed`; RAK MUST NOT claim compliance.

## 5. Controlled source acquisition

### 5.1 SSH Git

- Accept only normalized `ssh://` or SCP-like Git URLs. Reject URL credentials, control
  characters, extra options, unknown schemes, local/file transports, proxy commands, and
  ambiguous IPv6/port syntax.
- Resolve the Git host exactly against a pre-registered known-host entry. Strict host-key
  checking is mandatory; interactive prompts, TOFU, agent forwarding, port forwarding,
  X11, and arbitrary SSH config are disabled.
- Use a pinned acquisition image as numeric non-root with read-only root, all capabilities
  dropped, `no-new-privileges`, network limited to the single approved Git host/port,
  fixed Git argv, empty tmpfs home, no system/global config, no credential helper, no
  hooks, no shell, and bounded CPU/RAM/PIDs/disk/time/output.
- Disable smudge/clean filters and LFS; do not initialize submodules. LFS/submodules require
  a new approval and acquisition attempt with host, recursive-depth, object-count, byte,
  and time limits. A gitlink or pointer is preserved and reported when not acquired.
- Fetch only the requested ref/object. A ref resolved before fetch MUST be rechecked after
  fetch; the recorded full commit/object format and snapshot digest are authoritative.

### 5.2 Local repository

- The API receives only a registered source-handle plus relative path. The helper opens
  each component no-follow beneath the registered root; an absolute path, `..`, symlink
  escape, mount crossing outside the handle, or race fails acquisition.
- `commit-only` is default. `frozen-working-tree` requires explicit approval and a
  no-follow open plus pre/post `fstat` for each file and a complete before/after status and
  manifest equality check.
- The live repository is read-only to acquisition and unavailable to providers,
  analyzers, the VM, and packaging. Its source-state digest is repeated at assessment
  completion. Any mismatch is fatal to package release.

### 5.3 Snapshot and archive safety

- Snapshot entries are limited to regular file, symlink metadata, directory, and gitlink.
  FIFOs, sockets, devices, hardlinks, sparse-file amplification, invalid UTF-8 names,
  absolute/escaping symlinks, duplicate names, and case/NFC collisions fail atomically.
  Symlinks are recorded but never followed by acquisition, analyzers, builds, or exporters.
- The archive extractor MUST be a bounded trusted implementation, not a general shell
  extractor. It validates the complete manifest before materialization, uses no-follow
  directory-relative opens, writes to a new private tree, enforces entry/file/total-byte
  and expansion-ratio limits, fsyncs, rereads/hashes every entry, then atomically renames.
- Snapshot staging accepts only a registered snapshot and exact archive/manifest digests.
  The VM broker independently revalidates both. A malformed entry, extra/missing byte, or
  digest mismatch destroys the temporary tree and blocks runtime.
- Acquisition and archive libraries are pinned, SBOMed, vulnerability-scanned, and patched
  on an expedited channel. A scanner or Git parser crash is a failed/partial attempt, not a
  reason to use a host Git client or broad mount.

## 6. Static analyzers and hostile parser controls

Each baseline analyzer runs in its own disposable container with:

- a single verified snapshot mounted read-only, one fresh outbox mounted read-write, and
  pinned tool assets mounted read-only;
- numeric non-root UID, read-only root, all capabilities dropped,
  `no-new-privileges`, default seccomp, bounded tmpfs, no devices, no Docker API, no
  provider/SSH/sandbox secrets, and network namespace `none`;
- analyzer default ceiling 2 CPU, 2 GiB RAM, 512 PIDs, 30 minutes, 100 MiB output, 20 MiB
  stderr, and release-owned file/decompression limits. A named release-owned profile may
  be lower or higher only within the outer installation ceiling; raw user Docker flags are
  forbidden;
- fixed binary and argv array, kit-owned working directory/config/rules, and an empty home.

Baseline analyzers MUST NOT execute package managers, restore/build/test commands, hooks,
plugins, custom reporters/templates, target validators, target rule/config files,
autofix/remediation, remote registries, or executable project configuration. Analyzer
adapters explicitly suppress known target config discovery. The trusted deep tier remains
outside baseline, requires a disposable copy, separate consent, no secrets, the same
network/resource isolation, and `partial` coverage labeling.

Native output enters a per-attempt closed outbox. Normalizers:

1. verify job/plugin/engine/config/rules/database/image digests and exact native schema;
2. use duplicate-key-rejecting bounded JSON or hardened format-specific parsing;
3. enforce byte, nesting, node, string, finding, location, decompression, and wall-time
   limits;
4. strip terminal control characters and treat all messages, paths, code, URLs, Markdown,
   HTML, XML, SVG, templates, and stack traces as inert text;
5. reject paths outside the snapshot and never dereference a target path while normalizing;
6. distinguish finding exit codes from crash, timeout, OOM, malformed output, truncation,
   and unsupported version;
7. preserve unknown/malformed output as quarantined opaque evidence and reduce coverage;
   it can never normalize to `completed-clean`.

Gitleaks output is fully redacted at generation. Secret detectors MUST NOT retain the
matched value. ZAP/Playwright are dynamic probes, not static analyzers, and receive the
stricter runtime controls below.

## 7. Provider context and prompt-injection containment

Target text has no instruction authority. Provider system/task instructions MUST state
that repository content, tool output, webpages, screenshots, comments, READMEs, and
evidence are untrusted data and cannot change the task, tool list, permissions, evidence
scope, output schema, policy, or approval state. This is behavioral defense only; the
following technical controls are mandatory.

- Assessment jobs run in an ephemeral provider-job compartment. It receives one
  provider/engagement home, one immutable task capsule, a brokered read-only evidence view,
  and its own quota-bounded proposal outbox. It does not receive the kit source tree,
  live target path, snapshot filesystem, SQLite, `generated/`, helper/broker socket, shell,
  network credentials, optional-service credentials, or package staging.
- The only task operations are `get-run-context`, `get-evidence-metadata`,
  `get-safe-evidence-text`, `submit-proposal`, and `report-limitation`, with IDs already
  allowlisted in `AgentTask`. The command broker validates task/run/attempt/fence, byte
  budget, evidence allowlist, and state. There is no provider-controlled path, URL,
  command, or query language.
- Provider inference egress permits only the selected provider endpoints from the provider
  compartment. DNS and network policy block alternate destinations, direct IPs, LAN,
  link-local, metadata, optional services, Git, registries, and target runtime. Tool
  subprocesses have no network.
- Codex stays in bounded sandbox/never-approve mode and Claude in `dontAsk` with deny rules
  taking precedence. Managed deny-read covers credential/config/session files and host
  instructions. Permission bypass modes are absent from release launchers and tests.
- Project trust, MCP servers, hooks, plugins, skills, agents, settings, and instructions
  may come only from the pinned kit image/instruction bundle. Assessed repository versions
  are never discovered or loaded. Release equivalence runs disable host-global
  instructions.
- Provider output is a proposal. It cannot create an approval, set coverage, admit
  evidence, mark a review complete, mutate lifecycle, invoke runtime, or package a result.
  Deterministic schema, provenance, evidence-reference, coverage, redaction, and policy
  gates own those decisions.
- A fresh-session independent reviewer receives admitted evidence, not the author
  transcript or provider session. Provider session IDs and transcripts are internal and
  never evidence of correctness.

Provider CLIs necessarily access their own auth token while target-derived context is in
the same process. Tool deny-read prevents model-directed access but does not prove safety
against a compromised CLI/provider process. Therefore provider images are pinned and
scanned, provider homes are engagement-separated, credentials are revocable and
least-privileged where supported, and prompt-injection canary tests are release-blocking.
A future provider-supported ephemeral workload identity or authenticated inference proxy
SHOULD replace reusable in-process credentials. Until then this residual risk must be
disclosed, and no provider job may hold SSH, cloud, production, optional-service, or
sandbox credentials.

## 8. Host helper and runtime broker

### 8.1 Host helper

- The helper is a fixed, independently packaged local process, not a web service. Its
  Unix socket is mode 0600, mounted only into the server container. It verifies OS peer
  credentials in addition to the per-launch HMAC key.
- The 256-bit key is generated from the OS CSPRNG into separate mode-0600 files for helper
  and server. It never appears in argv, environment, SQLite, logs, crash reports, or
  artifacts and is destroyed at launcher shutdown.
- Frames have a hard maximum before allocation. Strict JSON rejects duplicate keys,
  non-I-JSON numbers, invalid UTF-8, unknown fields, operation/body mismatch, and trailing
  bytes. MAC comparison is constant-time. The request digest is over RFC 8785 JCS without
  `mac`.
- Protocol version, installation/run/attempt/fence, registered IDs, counter, nonce,
  timestamps, request digest, MAC, state transition, and idempotency are verified before
  effects. Requests expire after 60 seconds. Counter/replay/idempotency journals are
  fsynced before reply.
- Fixed operations resolve only registered resources. Lifecycle deletion requires matching
  installation, run, runtime, resource tags, and creation nonce. The helper never follows
  a target-supplied path or deletes an unidentified resource.
- Bounded diagnostics use enumerated codes and release-owned text; they never echo raw
  request fields, environment, paths, credentials, source, or tool output.

Three consecutive authentication/replay/fence anomalies in one run, any validly MACed
unknown-resource request, or journal-integrity failure triggers the security stop procedure
in section 13, not automatic retry.

### 8.2 Disposable VM

The only allowed hostile dynamic runtime is a pinned Lima VM in plain mode on the native
guest architecture:

- no host filesystem mounts, SSH-agent forwarding, guest agent, dynamic port forwarding,
  host resolver injection, built-in containerd, bridged/L2 network, shared clipboard, or
  host integration;
- no inbound port except the authenticated loopback-only control channel established by
  the helper; target ports are never forwarded to the guest or physical host;
- fixed default ceiling 4 vCPU, 8 GiB RAM, 40 GiB disk, and 2 hours, plus a host-side
  deadline/emergency power-off. Profiles may lower these values; a higher reviewed profile
  must still have an explicit physical-host ceiling and be recorded;
- a pinned, verified guest image containing the broker, rootless Docker Engine, Compose
  plugin, RootlessKit, runc/containerd, `newuidmap`/`newgidmap`, cgroup v2/systemd
  delegation, and root-owned firewall. No runtime installer script or self-update;
- rootless Docker runs as a dedicated user with at least 65,536 subordinate UIDs/GIDs and
  a private Unix socket. Only the broker service account can open the socket. Target,
  probe, analyzer, provider, helper relay, and server receive no socket or `DOCKER_HOST`;
- the broker itself is unprivileged, read-only-root, capability-minimized, resource-limited,
  and accepts only authenticated typed messages over the VM loopback control channel.

`vm.preflight` MUST inspect effective Lima configuration, guest image digest, versions,
native architecture, UID maps, daemon rootless status, cgroup v2, systemd cgroup driver,
delegated `cpu`, `memory`, `pids`, and `io` controllers, firewall ruleset digest, control
channel, disk/memory/CPU ceilings, port forwards, and absence of mounts. An absent,
unexpected, mutable, or unenforced attestation makes runtime `blocked`.

After target data is staged, attestation drift is checked before each phase transition
(`compile`, `acquire`, `build`, `start`, `probe`, `collect`). Drift immediately disconnects
egress, stops the runtime, quarantines unadmitted receipts, and marks all affected controls
blocked. It is never repaired in place while the target remains present.

### 8.3 VM secret envelope

Before target data arrives, the broker creates a fresh X25519 keypair per runtime. The
server redeems a purpose-specific handle at most once and creates an envelope with
ephemeral X25519, HKDF-SHA-256, and AES-256-GCM. Associated data is JCS of envelope,
runtime, run, purpose, recipient, approval, issue/expiry times, and nonce.

The broker MUST reject wrong runtime/run/recipient/purpose/approval/key, bad tag, expiry,
replay, duplicate handle, unknown service, and delivery after runtime start. Plaintext is
written only to a broker-owned tmpfs object, mounted read-only into exactly one declared
service/probe without appearing in image/config inspection output, then zeroed/unlinked on
consumption, stop, cancellation, crash recovery, or expiry. Plaintext and handles never
enter logs, checkpoints, core dumps, swap, Docker inspect environment, receipts, or
artifacts. Core dumps and guest swap are disabled. Replay, wrong-recipient, expiry,
crash-before-cleanup, and post-destroy recovery fixtures are release gates.

## 9. Compose/Docker policy compiler

Untrusted Compose is never executed directly. Compilation has four ordered stages:

1. **Lexical/reference scan without Compose:** a bounded YAML parser rejects duplicate
   keys, custom tags, merge ambiguity, excessive anchors/aliases, document count, depth,
   nodes, scalar bytes, file count, recursive include/extends depth, and all remote or
   escaping references before any network, image pull, build, or container creation.
2. **Closed resolution:** local references are opened no-follow beneath the immutable
   snapshot. Resolution occurs in a no-network/no-secret parser sandbox with empty
   environment; target `.env`, host environment, and CLI interpolation are not loaded.
   Variable substitution is only from a release-owned explicit map of nonsecret values.
3. **Merged-model validation:** the complete effective model, including extensions,
   profiles, interpolated strings, Dockerfile paths, image references, mounts, networks,
   configs, secrets, healthchecks, entrypoints, and commands, is validated against the
   deny rules below.
4. **Regeneration:** the broker creates a new random project and release-owned model
   containing only allowed fields plus injected security/resource controls. The original
   YAML is evidence, never the executed plan. Plan and policy digests are recorded.

The compiler rejects:

- `privileged`, any `cap_add`, devices/CDI/device-cgroup rules, custom runtime, GPU,
  `/proc`/`/sys`/`/dev` access, setuid requirement, `use_api_socket`, Docker/Podman/
  containerd sockets, and security-label/seccomp/AppArmor disabling;
- host/container/service namespace sharing through `network_mode`, `pid`, `ipc`, `uts`,
  `userns_mode`, `cgroup`, or `cgroup_parent`; host network/IPC/PID; unsafe sysctls;
- bind mounts, propagation, `volumes_from`, external volumes/networks/configs/secrets,
  arbitrary host paths, and references outside the snapshot; target-defined secrets and
  env files are not accepted as credential channels;
- host ports, published ports, `expose` as authority, `extra_hosts`, host-gateway,
  link-local, metadata/LAN routes, static MAC/IP tricks, DNS overrides, custom network
  drivers/options, and attachable/external networks;
- remote include/extends, remote/additional build contexts, Git/HTTP contexts, mutable or
  unresolved images, incompatible platforms, BuildKit SSH/secret/device entitlements,
  privileged build, host build network, cache import/export to remote destinations;
- `provider`, lifecycle hooks, init/systemd/kernel features requiring privilege, custom
  logging drivers/remote logs, unlimited replicas, and any unsupported or unknown field
  whose semantics can affect isolation.

Accepted services are regenerated with:

- `cap_drop: [ALL]`, `no-new-privileges`, read-only root, default seccomp, non-root numeric
  user unless a kit-owned compatibility check proves the image cannot start (in which case
  runtime is blocked, not run as root), bounded `/tmp` and `/run` tmpfs, and broker-created
  scratch volumes only;
- default per-service ceiling 1 CPU, 2 GiB RAM, 256 PIDs, 256 MiB total tmpfs, 20 MiB
  local logs, one replica, startup deadline 5 minutes, probe deadline 30 minutes, and
  shutdown grace 10 seconds. The sum of service reservations must fit under 75% of VM RAM
  and CPU, leaving broker/daemon/probe headroom; otherwise compilation rejects;
- digest-pinned base and final images, content-addressed build outputs, no inherited
  healthcheck used as an assessment assertion, no published ports, and only a
  broker-created internal network;
- canonical snapshot read-only. A service needing source writes receives an ephemeral copy
  initialized from the snapshot and coverage is labeled as exercising a copy. The
  canonical snapshot is rehashed before and after build/runtime.

Dockerfile `ADD` of remote URLs and Git repositories is rejected. Archive `ADD` is either
rejected or extracted by the same bounded snapshot rules before use. Builds use a pinned
BuildKit policy with no insecure/network-host/device/SSH entitlements and no target-supplied
frontend or daemon config. Image `ONBUILD`, entrypoint, user, volumes, healthcheck, and
labels are inspected and included in the compiled-plan evidence; an unsafe inherited
setting blocks execution.

## 10. Network and egress safety

There is no generic internet capability. Network identities and audit streams for provider
inference, Git acquisition, tool update, build acquisition, target runtime, optional
service, and internal runtime are distinct.

### 10.1 Build acquisition

- Default build network is none. Each exception requires an unexpired approval naming
  scheme, normalized host, port, optional path prefix, methods, data categories,
  recipient service, credential handle, disclosure version, and run.
- The root-owned guest firewall permits the build user/namespace to reach only an
  authenticated local egress proxy. The proxy resolves approved names itself, pins the
  connection to public approved addresses, revalidates DNS on every connection, and blocks
  redirects, CONNECT to undeclared ports, alternate protocols, request smuggling,
  userinfo, IP literals unless explicitly approved, private/LAN, loopback, link-local,
  multicast, Unix sockets, and cloud metadata ranges over IPv4 and IPv6.
- Direct DNS, UDP, QUIC, raw sockets, ICMP tunneling, direct IPv4/IPv6, guest/host gateway,
  and proxy bypass are blocked by the root-owned firewall, not merely environment
  variables. Proxy logs contain approval, destination, method, status, byte counts,
  decision, and time, never headers, credentials, query values, or bodies.
- Prefer pinned pre-populated caches. Image tags may be resolved only through the approved
  registry path and become immutable digests before build. Dependency downloads are
  content-hashed where ecosystem metadata permits. No unapproved redirect or post-build
  network remains.
- The disclosure MUST say that an approved package/registry destination remains an
  exfiltration channel for repository bytes. Approval limits recipients, not the semantics
  of what malicious build code sends.

### 10.2 Runtime and probe

Before target start, the broker deletes/disconnects build networking, revokes proxy
credentials, flushes conntrack for the build identity, verifies the root firewall runtime
policy, and attaches targets/probes only to a fresh `internal: true` network. Runtime/test
denies new external IPv4, IPv6, and DNS. No target port is published even inside the guest;
the probe connects by internal service name.

The trusted Playwright/passive probe is disposable and separate from target services. It
has no source mount, Docker socket, broker/control socket, provider home, package output,
or general secret. A test credential is recipient-bound to the probe or named target
service. Browser downloads, uploads, clipboard, file URLs, extensions, service workers
beyond the test context, new external origins, and mutating HTTP methods are denied unless
the exact non-production flow is separately approved. The browser runs non-root with its
pinned seccomp profile, read-only root, bounded scratch, URL/request/time limits, and is
destroyed after each control plan. A browser compromise is assumed and bounded to the VM.

Any requested OAuth, SaaS, remote database, webhook, email, payment, cloud, or production-
like endpoint leaves the default profile and is blocked. A future approved test-endpoint
profile must use exact methods/data/accounts and the same proxy/firewall controls; it may
never authorize destructive actions or production credentials.

## 11. Resource, denial-of-service, and failure containment

Limits are enforced at analyzer/container, broker/daemon, VM, host launcher, storage
admission, parser, output, and wall-clock layers. Presence in YAML is not evidence:
preflight and runtime probes verify actual cgroup enforcement.

- The VM fixed disk is the hard dynamic-storage ceiling. Broker and daemon receive reserved
  CPU/RAM/PIDs; target plans cannot allocate the last 25% of VM RAM/CPU. Image count,
  layer bytes, build-cache bytes, volume bytes, log bytes, container/network/volume count,
  and total artifacts are separately capped.
- Static analyzer defaults are 2 CPU/2 GiB/512 PIDs/30 min/100 MiB output. Dynamic defaults
  are specified in sections 8 and 9. Every named profile records exact values in evidence.
- Logs use local bounded rotation and an aggregate run quota. Output writes use
  reserve-aware admission; crossing 80% of a job quota warns, 100% closes the outbox,
  terminates the job, and records truncation/partial coverage.
- Fork, CPU spin, memory/OOM, inode exhaustion, sparse/large files, disk fill, log flood,
  decompression/alias bombs, excessive services/replicas, image-layer explosion, slowloris,
  and hung shutdown fixtures MUST demonstrate bounded impact and useful failure evidence.
- OOM, SIGKILL, timeout, parser crash, lost heartbeat, disk full, or output truncation can
  never produce `pass` or `completed-clean`. Closed receipts produced before failure remain
  quarantined and may be admitted only as evidence of the limitation, never of completion.
- At 75% of VM wall time no new build/probe starts; at 90% graceful stop begins; at 100%
  the host helper cuts VM networking and force-stops the VM. Emergency stop is available
  throughout and does not depend on a responsive broker or guest.

On host `ENOSPC`, new dispatch stops, current temp files are closed/unlinked where safe,
SQLite writes stop if durability is uncertain, and reconciliation runs after recovery.
The system never auto-deletes admitted evidence, snapshots, packages, another run, or an
unidentified VM to free space.

## 12. Evidence, UI, logs, and package safety

- Every receipt is from a closed outbox, exact current fence, declared media type, size,
  SHA-256, and registered activity. Helper/broker success is not evidence validity.
- Raw target HTML, SVG, XML, JavaScript, CSS, PDF, archives, scanner HTML, and unknown media
  are attachment-only with `Content-Disposition: attachment`, `nosniff`, `no-store`,
  same-origin resource policy, and sandbox CSP. The authenticated UI never navigates to a
  target origin or raw artifact.
- Safe text previews use bounded parsers and UI `textContent`, never HTML/Markdown
  evaluation. Safe image previews decode under byte/pixel/time limits, remove metadata,
  and re-encode PNG/JPEG/WebP in a disposable worker. SVG/GIF/PDF remain attachment-only.
- Reports are serialized from typed AST nodes. Target/provider/scanner text can create
  text/code/cell nodes only. No template expression, Mermaid, syntax plugin, target CSS,
  external URL, script, SVG, iframe, form, event handler, or active content is permitted.
- Structured logs use allowlisted identifiers, times, outcomes, reason codes, byte counts,
  and redaction counts. They never contain request/response bodies, source, prompts,
  cookies, authorization headers, credentials, secret handles, host absolute paths, raw
  output, or passphrases.
- Redaction occurs at ingestion and again before staging. Every package candidate,
  derivative, screenshot, trace, log, report, manifest field, ZIP metadata, and optional
  wrapper metadata is scanned for seeded values, credential forms, SSH/provider material,
  authorization/cookies, source-classified secrets, and absolute host paths. A positive
  result blocks packaging; a false-positive exception requires removal or a human-reviewed
  structured redaction rule, never “ignore this value.”
- The validated plain ZIP is built only from immutable admitted/redacted staging, with
  path/type/collision checks, manifest/checksums, fresh-process validation, decompression
  limits, reopen, and detached digest. Optional encryption never substitutes for redaction.

State-changing browser requests require a per-launch high-entropy session in an
HttpOnly, SameSite=Strict cookie, exact `Origin` validation, and CSRF token. The server
binds only `127.0.0.1`; it rejects non-loopback forwarded-host/origin assumptions and sets
no permissive CORS. Package/evidence identifiers are opaque and authorization is checked
against the active local session and run; paths are never accepted from the browser.

## 13. Incident detection, stop, and recovery

### 13.1 Immediate security-stop triggers

- physical-host socket/API, host/provider/SSH/generated/SQLite mount, credential, or canary
  becomes visible in an unauthorized compartment;
- VM/hypervisor escape indicator, unexpected host process/file/network effect, unexpected
  port forward, or physical-host canary access;
- successful proxy/firewall bypass, runtime external egress, metadata/LAN reachability, or
  undeclared optional-service/provider destination;
- helper/broker MAC/journal integrity failure, attestation drift, stale-fence effect,
  cross-run resource access, secret replay/wrong-recipient delivery, or unknown resource
  mutation;
- source-state/snapshot digest mismatch, generated/staging mutation by target, or evidence
  admission from an open/stale outbox;
- provider credential read/transmission attempt that is not blocked, release bypass mode,
  secret in an admitted/package candidate, or redaction/ZIP integrity failure;
- cleanup cannot account for a matching VM, network, process, image, volume, port forward,
  or secret tmpfs object.

### 13.2 Stop sequence

The host-side monitor, not the guest, owns emergency stop:

1. atomically mark the run `SECURITY_HOLD`; fence all active attempts and reject new
   dispatch/admission/package/download;
2. revoke optional/build proxy approvals and credentials, cut VM external networking at
   the host boundary, and terminate provider inference jobs;
3. issue bounded stop to analyzers and broker; after 10 seconds terminate inner jobs, after
   30 seconds force-stop the VM process; do not wait for a compromised guest;
4. revoke all secret handles/envelopes, disable relevant provider/SSH credentials when
   exposure is plausible, and prevent provider-home reuse until operator review;
5. preserve only already closed, digest-known receipts and trusted host/helper audit
   records in a separate incident quarantine. Never collect arbitrary new files from a
   suspected compromised guest;
6. reconcile by installation/run/runtime tags and creation nonces, remove only exact
   matching resources, and record residue. Do not use broad globs or generic delete;
7. notify the operator with trigger, time, affected run/data/credential categories,
   containment status, residue, required rotations, and whether host isolation/reimage or
   customer notification should be considered.

Automatic resume after a security hold is prohibited. A human must review the incident,
rotate potentially exposed credentials, verify host/helper/install integrity from trusted
media, remove residue, and start a new fenced run/snapshot. Incident evidence never enters
the customer ZIP by default; the customer-facing limitations report states the affected
coverage and material confirmed exposure without leaking exploit payloads or secrets.

Ordinary runtime policy rejection, unsupported feature, or unavailable prerequisite is not
an incident: it cleanly destroys the VM and records blocked coverage. Repeated malformed
or escape-oriented input is evidence about the repository but does not justify executing
it.

## 14. Verification and acceptance criteria

Every assertion below is automated in CI where possible and retained as release evidence.
Adversarial tests use nonsecret canaries and disposable fixtures; they do not attempt
real-world exploitation outside the sandbox.

### 14.1 Acquisition and analyzers

1. Hostile Git fixtures cover hooks, filters, credential helpers, malicious refs, LFS,
   submodules, alternates, symlink/hardlink/FIFO/device, case/NFC collisions, invalid UTF-8,
   mutation during capture, archive traversal, sparse/huge files, decompression bombs, and
   output floods. Expected result is safe capture or atomic failure with zero target writes.
2. Before/after live-source and canonical-snapshot digests match for every successful run.
   Acquisition workers expose only the exact source/SSH inputs and are absent afterward.
3. Each analyzer is inspected for UID, rootfs, mounts, capabilities, seccomp, network,
   environment, PIDs/memory/CPU, image/config/rule/database digests, and outbox ownership.
4. Executable ESLint/Python/Ruby/PHP/MSBuild/Gradle/Maven/npm/Composer configs, hooks,
   plugins, validators, custom reporters, and repository rules never run. Canary network,
   process, and file effects remain absent.
5. Malformed/unknown/truncated native output, parser bombs, terminal escape text, path
   escapes, OOM, timeout, and crash produce partial/blocked coverage, never zero findings.

### 14.2 Provider containment

6. For both pinned providers and every release architecture, prompt-injection fixtures ask
   for credential/config/session files, host paths, arbitrary shell/network, optional
   service uploads, policy/approval changes, hidden findings, forged evidence, and package
   release. OS/network audits prove every attempt fails; proposals remain schema-valid or
   are rejected.
7. Provider job mount/environment/process/network inspection proves only its engagement
   home, task capsule, evidence view, and outbox are accessible. Cross-engagement/provider
   canaries and target/runtime/helper/generated paths are unreadable.
8. Provider-context audit proves only declared evidence IDs and bounded bytes reached the
   selected provider, and no secret-classified occurrence was sent.

### 14.3 VM, Compose, escape, and egress

9. Native macOS ARM64, macOS x86-64, Linux ARM64, and Linux x86-64 runs attest pinned Lima,
   guest, broker, Docker/Compose/RootlessKit/runc/containerd, native architecture, UID maps,
   cgroup controllers, firewall, limits, no mounts/forwards, and cleanup. Emulation does not
   satisfy this gate.
10. The Compose corpus includes every rejected field in section 9, nested include/extends,
    profiles, interpolation, `.env`, anchors/aliases, symlink/absolute escapes, mutable
    images, Dockerfile remote ADD, BuildKit entitlements, inherited image config, and
    unknown future fields. Rejection occurs before pull/build/create/secret redemption.
11. Target privilege probes attempt socket discovery, mount, mknod, raw sockets, setuid,
    capability gain, namespace joins, host PID/network, `/proc`/`sys`/devices, broker/
    control socket, canonical-source writes, generated/output access, and guest/physical
    canaries. All fail. Effective UID maps, capabilities, seccomp, NNP, rootfs, mounts, and
    networks are recorded.
12. Build egress permits only the exact approved proxy destinations. Direct DNS/IP,
    redirects, alternate ports/protocols, IPv6, UDP/QUIC, link-local, metadata, guest/host
    gateway, LAN, and tunneled requests fail. Runtime denies all external DNS/IPv4/IPv6
    while internal probe-to-service traffic succeeds. Any bypass is Critical and blocks
    release.
13. Memory/fork/CPU/log/disk/inode/layer/replica/slow/hung fixtures stop within named
    ceilings, preserve host/UI availability, produce honest limitation evidence, and leave
    no resource. Emergency stop succeeds with broker, daemon, and guest unresponsive.
14. Secret envelopes reject replay, wrong recipient/runtime/purpose/approval, expiry,
    post-start delivery, bad tag, and crash recovery. Plaintext is absent from inspect,
    logs, checkpoints, core/swap, outboxes, disk after destroy, and packages.
15. A malicious target compromises a simulated browser/analyzer/daemon process and still
    cannot read physical-host or provider canaries. This demonstrates blast-radius
    controls, not absence of kernel/hypervisor vulnerabilities.

### 14.4 Evidence and release

16. Stale/replayed/expired/bad-MAC helper and broker messages, duplicate nonces, same
    idempotency key with different digest, resource-ID swaps, and crash points cannot cause
    an effect, admission, double secret use, or cross-run cleanup.
17. Active-content fixtures in paths, findings, Markdown, HTML, SVG, XML, images, CSV,
    SARIF, CycloneDX, screenshots, and ZIP names neither execute in the UI/report nor escape
    cells/links/paths. Raw unsafe types download only as attachments.
18. Seeded SSH/provider/sandbox secrets, auth headers, cookies, private-key forms, host
    paths, target canaries, EXIF, browser storage, and provider transcript values are absent
    from every customer artifact and ZIP metadata. Any match blocks release.
19. Kill/restart at every helper, VM, admission, and package stage. Reconciliation attaches
    or removes only current tagged resources, stale receipts remain rejected, and package
    stages cannot skip certificates.
20. A safe fixture launches and probes. Fixtures requiring privilege, device, host socket,
    bind mount, host network, external service, unsupported architecture, or unenforced
    cgroup finish static assessment with precise blocked reasons and no weaker fallback.

## 15. Release and per-run gates

### 15.1 Product release blockers

The product is **NO-GO** until all are true:

- every invariant SI-01 through SI-10 has a passing automated enforcement test;
- the native four-host adversarial VM matrix in AC-10 passes, including cgroups, firewall,
  emergency stop, and residue-free teardown;
- both provider images pass prompt-injection, credential-deny, mount/network isolation, and
  common-outcome conformance tests without bypass modes;
- all acquisition/analyzer/Compose/parser/egress/resource/secret/UI/package hostile fixture
  suites pass on Linux ARM64 and x86-64, and applicable runtime suites pass on all four
  hosts;
- the pinned tool/guest/provider images have SBOMs, verified provenance/digests, license
  notices, and no unaccepted Critical/High vulnerability affecting the exercised boundary;
- an independent security reviewer approves the helper protocol, Compose compiler,
  rootless/VM confinement, firewall/proxy, provider compartment, and VM secret-envelope
  implementation;
- no physical-host Docker socket, privileged DinD, broad home/source mount, production
  credential, silent upload, runtime auto-update, mutable execution input, or direct
  Compose path exists in release code/documentation;
- incident stop is proven with an unresponsive guest and orphan reconciliation; any cleanup
  residue in a release fixture fails the release;
- known unresolved ARM64 Chromium/ZAP behavior is either validated or replaced with the
  locked reduced-coverage adapter and reported honestly. Browser unavailability may block
  browser controls, but may not weaken the VM.

### 15.2 Per-run package blockers

A customer package cannot enter `RELEASED` while any of these is true:

- target identity/live-source/snapshot mismatch, active security hold, helper/broker
  journal integrity concern, active/orphan runtime resource, or cleanup residue;
- an expected receipt is open, stale, malformed, over quota, from an unknown tool/version,
  or fails evidence admission;
- a required domain/control lacks one allowed coverage state and reason, or a failed/
  blocked/untested check is represented as pass/clean;
- secret/host-path/redaction scan fails, required independent/human review is missing, or a
  deterministic schema/reference/materiality/coverage gate fails;
- staging is mutable, inventory/manifest/checksum/ZIP reopen validation fails, or download
  authorization/loopback session is invalid.

Runtime `blocked`, `not applicable`, or `not tested` is not by itself a package blocker when
the static assessment is complete, the reason and attempted safe steps are evidenced, and
the coverage/decision reports clearly state the impact.

## 16. Residual risk and required disclosure

Even after all controls pass:

- a Lima/QEMU/VZ/hypervisor or physical-host kernel vulnerability could permit VM escape;
- a compromised pinned Git/scanner/parser/provider/helper/broker/package dependency could
  compromise its trust zone;
- provider inference necessarily sends selected customer source/context to the chosen
  provider, whose service-side retention and processing are governed by the customer’s
  provider agreement;
- approved Git/build/optional-service destinations remain possible source-exfiltration
  channels; allowlists constrain recipients, not malicious payload semantics;
- target code can deny service within the VM allocation and may compromise other target
  services or the disposable probe;
- checksums establish integrity relative to a trusted digest, not authorship or
  non-repudiation;
- secret scanning/redaction reduces but cannot prove the absence of unknown sensitive data;
- a static-only assessment cannot establish runtime security, and automated controls cannot
  establish legal compliance or absence of vulnerabilities;
- microarchitectural side channels and a malicious/compromised physical host are outside
  this threat model.

Operator and customer documentation MUST describe these limits using “bounded isolation,”
not “secure sandbox,” and must never claim that no vulnerability, leak, or escape is
possible. Any change that narrows the malicious-repository assumption must be an explicit
product/threat-model revision, not an implementation shortcut.

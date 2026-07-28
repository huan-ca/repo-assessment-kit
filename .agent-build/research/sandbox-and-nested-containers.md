# Sandbox and nested-container research

_Accessed and assessed 2026-07-27._

## Question

What cross-platform architecture can run Docker/Compose definitions from an untrusted
target repository on macOS and Linux, on ARM64 and x86-64, without mounting the physical
host's Docker socket, while preserving a read-only source, writable assessment output,
loopback-only UI, controlled egress, and enforceable resource limits?

This unblocks the P1 trust boundaries and runtime-capability gate, the P2 sandbox policy,
and the P4 container/launcher implementation.

### Interpretation and “good enough”

“Untrusted” means the repository, its Compose files, Dockerfiles, images, dependencies,
build scripts, application processes, and instructions to the coding agent may all be
hostile. Docker explicitly says Compose treats its files as trusted input and applies
requested host access and privilege; nested `include`/`extends` and file references can
hide those effects or read files outside the project. Therefore, merely locating the
daemon in a sidecar is not a sufficient hostile-code boundary
([Docker Compose trust model](https://docs.docker.com/compose/trust-model/)).

A solution is good enough only if it:

- gives target code neither the physical-host Docker socket nor any Docker API;
- contains a nested-daemon or target-container escape without exposing the physical host;
- never gives target code host mounts, agent credentials, SSH material, or generated
  deliverables;
- transforms, rather than directly executes, untrusted Compose configuration;
- defaults target runtime to no external network and makes any build-time egress explicit;
- enforces total and per-service CPU, memory, PID, disk, and wall-clock bounds;
- exposes only the kit UI, bound to physical-host `127.0.0.1`;
- works natively on all four required host/architecture combinations, with a failed
  prerequisite becoming honest `blocked` runtime coverage rather than a weaker fallback.

## Recommendation

**Use a split control/runtime architecture: keep the kit UI, workflow, and agent in their
ordinary non-privileged Docker sandbox, but run every target build and process through a
rootless Docker Engine installed directly in a disposable, resource-bounded Linux worker
VM, behind a narrow runtime broker. Confidence: high for the isolation design and medium
for the untested four-platform operational matrix.**

Use a pinned Lima release and a locally pinned VM template/image on both macOS and Linux.
Lima supports Linux VMs on macOS and non-macOS hosts, native ARM and Intel as well as
cross-architecture guests; its CLI exposes CPU, memory, disk, mount removal, and explicit
port-forward controls
([Lima overview](https://lima-vm.io/docs/),
[Lima `create`](https://lima-vm.io/docs/reference/limactl_create/)).
Use the native guest architecture for release support; emulation is useful for diagnostics,
not a substitute for the required native platform smoke matrix.

The VM must start in Lima **plain mode**, with no filesystem mounts, dynamic forwarding,
built-in containerd, guest agent, or SSH-agent forwarding; plain mode retains provisioning
and explicit static forwards
([Lima plain mode](https://lima-vm.io/docs/config/plain/)).
Give it a fixed CPU/memory/disk budget and no bridged/L2 host network. Copy the immutable
repository snapshot into the guest over its loopback SSH control channel and copy runtime
evidence back; do not use a live host share for source or output.

The implementable component split is:

1. On the physical host Docker engine, run the kit UI/workflow container and provider
   agent container as non-root, read-only-root services with dropped capabilities,
   `no-new-privileges`, bounded tmpfs/volumes, and no Docker socket. Provider-specific
   persistent home volumes attach only to their agent container; target code and the
   worker VM never receive them. Only the UI is published, and its physical-host mapping
   must explicitly use `127.0.0.1`; an omitted Compose `host_ip` binds all interfaces
   ([Compose services/ports](https://docs.docker.com/reference/compose-file/services/)).
2. Let a small trusted host launcher create/delete the Lima instance, transfer the
   content-addressed source snapshot, and establish an authenticated loopback-only
   control channel. It accepts only lifecycle and file-transfer requests from the
   workflow, never free-form shell or Compose requests from the coding agent. The host
   launcher is the only component that invokes Lima and is not exposed through the web
   API.
3. Inside the disposable VM, run a **runtime broker** as a separate unprivileged service.
   It is the only client allowed to access the worker daemon's Unix socket. The coding agent, web
   server, analyzer processes, target containers, and Playwright target tests receive no
   Docker socket, Docker client certificate, or `DOCKER_HOST`.
4. Provision a version-pinned Docker Engine, Compose plugin, RootlessKit, `newuidmap`, and
   `newgidmap` into the pinned guest image. Run `dockerd-rootless.sh` as a dedicated
   systemd user with at least 65,536 subordinate UIDs/GIDs and its Unix socket in a
   private runtime directory. Docker documents that rootless mode runs both daemon and
   containers in a user namespace and needs no root daemon; its only setuid/file-capability
   exceptions are `newuidmap` and `newgidmap`
   ([Docker rootless mode](https://docs.docker.com/engine/security/rootless/)).
   Use the distribution's signed rootless-extras package, not a network-fetched install
   script at run time. Provision cgroup v2/systemd delegation and a root-owned nftables
   default-deny policy into the guest image before target data arrives.
5. Do **not** put the rootless daemon in a DinD sidecar. The official
   `docker:<version>-dind-rootless` recipe still requires the outer container to be
   `--privileged` so it can disable seccomp, AppArmor, and mount masks
   ([Docker rootless DinD guidance](https://docs.docker.com/engine/security/rootless/tips/)).
   Docker documents that `--privileged` grants all
   capabilities, all host devices, and near-host-equivalent LSM access
   ([Docker runtime privilege](https://docs.docker.com/engine/containers/run/)).
   Installing rootless Docker directly in the already-disposable VM removes this
   unnecessary privileged-container layer and makes systemd cgroup delegation testable.
6. Destroy the VM and its disk after evidence extraction. Provider login state remains in
   the outer agent-only Docker volume and never crosses the worker boundary.

This architecture has two deliberate isolation layers:

```text
physical host
  ├─ kit Docker sandbox
  │    ├─ UI/workflow (127.0.0.1 only; no Docker API)
  │    └─ provider agent (provider-only persistent home; no runtime API)
  ├─ trusted lifecycle helper (Lima create/copy/delete; no web exposure)
  └─ disposable bounded Linux worker VM (primary hostile-code boundary; plain/no mounts)
       ├─ policy/runtime broker (only worker-daemon client)
       └─ rootless Docker Engine systemd user service (no privileged container)
            ├─ transformed target services (unprivileged, source RO, runtime offline)
            └─ trusted Playwright probe (same inner internal network, no published port)
```

### Compose must be compiled into an approved runtime, not passed through

Docker warns that Compose input can grant privilege, mount host paths, share host PID or
network namespaces, expose devices, execute a host `provider` binary, or read arbitrary
files through file references and symlinks
([Compose trust model](https://docs.docker.com/compose/trust-model/)).
The broker therefore first performs a syntax/path/reference pass without Compose to
reject remote or escaping dependencies, then renders configuration in a no-secret,
no-network parser sandbox, resolves all remaining local references beneath the immutable
snapshot, and validates the fully merged/interpolated result. This order matters because
Compose can read files or fetch remote references while resolving configuration.
`docker compose config` is useful evidence, but is not itself a policy engine.

The broker should reject, not “best-effort sanitize,” at least:

- remote or escaping `include`, `extends`, build contexts, and additional contexts;
- `privileged`, any `cap_add`, `devices`, CDI, device cgroup rules, custom runtimes,
  `use_api_socket`, and Docker/Podman socket mounts;
- host/container/service namespace sharing (`network_mode`, `pid`, `ipc`, `uts`,
  `userns_mode`, `cgroup`, `cgroup_parent`) other than an explicitly safe generated mode;
- AppArmor/seccomp/label disabling, unsafe sysctls, `provider`, and lifecycle hooks that
  request privilege;
- bind mounts, `volumes_from`, external volumes/networks/configs/secrets, and file
  references whose canonical path is outside the snapshot;
- host port publishing, `host-gateway`, link-local/metadata routes, static MAC/IP tricks,
  and network drivers other than the broker-created bridge;
- unlimited replicas, missing resource ceilings, or an image/build platform incompatible
  with the native guest.

For accepted services, generate a separate Compose project with a random run identifier;
force `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `read_only: true`,
bounded `/tmp` and `/run` tmpfs mounts, a PID limit, CPU/memory limits, a non-root user
where the image supports it, and only broker-created named scratch volumes. Docker
supports read-only container roots with selected writable volumes, `no-new-privileges`,
and capability removal
([`docker container run`](https://docs.docker.com/reference/cli/docker/container/run),
[Compose services](https://docs.docker.com/reference/compose-file/services/)).
If the application cannot run with these controls, record runtime as `blocked` or
`partial`; do not silently relax them.

### Source and generated-output layout

- Resolve the target commit on intake, create a content-addressed snapshot, transfer it
  into the mount-free VM, and verify commit plus a deterministic file manifest before use.
- Keep one canonical snapshot read-only to all assessment processes. Give Docker builds a
  read-only build context. If a target requires source-tree writes, initialize an
  ephemeral work volume from the snapshot and label the resulting runtime coverage as
  exercising a copy, while the canonical snapshot remains the integrity reference.
- Make target data locations disposable named volumes or size-bounded tmpfs. Never honor
  target-requested physical-host paths. Docker bind mounts are writable by default; `ro`
  is explicit
  ([Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)).
- Keep host-side `generated/<project>-<commit>-<timestamp>/` writable only to the kit
  evidence and packaging components. Do not mount it into the worker VM, target services,
  or the trusted target-test browser. Transfer only declared evidence objects out of the
  guest into a staging directory, validate/redact them, then admit them to `generated/`.
  Recompute the export manifest/checksums in the kit sandbox.

### Network and egress policy

Use two explicit phases:

1. **Acquisition/build:** the nested daemon may pull only digest-resolved images through
   a controlled registry path. A dedicated build network may use an authenticated egress
   proxy with an operator-approved destination list for dependency acquisition. It has
   no agent/SSH/provider credentials. Log DNS, destination, bytes, and policy decision.
   Warn that an allowed package endpoint is still an exfiltration channel; an allowlist
   limits destinations, not what a malicious build sends to them. Prefer pre-populated,
   pinned caches and builds with network disabled where feasible.
2. **Runtime/test:** disconnect the build network and attach every target service plus
   the trusted Playwright probe only to a broker-created Compose network with
   `internal: true`. Docker documents that Compose networks have external connectivity
   by default and `internal: true` creates an externally isolated network
   ([Compose networks](https://docs.docker.com/reference/compose-file/networks/)).
   No target port is published to the guest or physical host; Playwright reaches the app
   by inner service name. A target requiring OAuth, SaaS, a remote database, or arbitrary
   internet access fails the capability gate unless the operator approves a separately
   specified test endpoint and the safety spec defines a stricter proxy policy.

The guest's root-owned firewall is the outer enforcement point: in acquisition/build
state it permits only the brokered proxy path and necessary established control traffic;
in runtime state it denies all new outbound traffic. The rootless daemon user and target
containers cannot hold `CAP_NET_ADMIN` in the guest's initial namespace. The inner
`internal: true` network is a second layer, not the only egress control. A guest-kernel
exploit could bypass the guest firewall; that residual risk is bounded from the physical
host by the VM but could still exfiltrate the copied source, so runtime evidence must
record the active firewall policy and operator-approved acquisition destinations.

Agent authentication, Git acquisition, tool updates, optional hosted scanners, dependency
installation, and target runtime must be distinct egress identities and audit states.
“The VM has internet” is not an acceptable network policy.

### Resource and lifecycle policy

Apply limits at both levels:

- **VM total:** fixed vCPU, RAM, disk, maximum run duration, and a host-side emergency
  stop. The fixed VM disk is the portable hard storage ceiling. Lima exposes `--cpus`,
  `--memory`, and `--disk`
  ([Lima `create`](https://lima-vm.io/docs/reference/limactl_create/)).
- **Control and worker services:** cap the broker, kit, and agent separately; bound logs
  and tmpfs; set health/startup timeouts.
- **Inner target services:** broker injects per-service CPU, memory, PID, replica, tmpfs,
  and wall-clock bounds. Compose defines CPU/memory/PID resource limits
  ([Compose Deploy Specification](https://docs.docker.com/reference/compose-file/deploy/)).
  Docker containers otherwise have no resource constraints
  ([Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)).

The runtime gate must verify limits are actually enforced, not merely present in YAML.
Docker notes that rootless cgroup limits require cgroup v2 plus systemd, and flags may be
ignored when the rootless daemon has no cgroup driver
([rootless resource limits](https://docs.docker.com/engine/security/rootless/tips/)).
Require `docker info` to report rootless mode, cgroup v2/systemd, and delegated CPU,
memory, PID, and I/O controllers; otherwise dynamic runtime is `blocked`. The outer VM
ceiling remains mandatory because inner limits cannot reliably cap image storage,
daemon overhead, or a compromised broker.

## Options compared

| Option | Host escape boundary | Compose compatibility | macOS/Linux + ARM64/x86-64 | Operational cost | Decision |
|---|---|---|---|---|---|
| **Disposable Lima VM + broker + direct rootless Docker Engine** | VM/hypervisor is primary; rootless daemon/user namespace reduces guest blast radius | Native Docker Engine/Compose after policy transformation | Lima and Docker Engine packages cover native amd64/arm64; must test all four | Highest VM startup cost; no privileged container; deterministic disposable disk and limits | **Recommend** |
| Rootless DinD sidecar directly on host Docker | Outer sidecar is still `--privileged`; on native Linux its compromise reaches the physical-host kernel boundary | Native | Images exist for amd64/arm64; behavior depends on host userns/cgroups | Simpler | Reject for hostile repositories; acceptable only for trusted fixtures |
| Rootful DinD sidecar | Privileged root daemon in privileged outer container | Native | Broad | Simple and mature | Reject; strictly larger blast radius than rootless DinD |
| Mount host Docker socket (including read-only) or a socket proxy | Docker API control can create privileged containers and arbitrary host mounts; socket mode does not make authorization read-only | Native | Broad | Easiest | Reject. Docker says daemon keys/control confer root-equivalent host access ([daemon protection](https://docs.docker.com/engine/security/protect-access/)) |
| Sysbox/nested-container runtime | Can avoid privileged DinD in supported Linux setups | Good | Requires non-default host runtime installation; not a uniform Docker Desktop/macOS contract | Extra host dependency and support matrix | Do not select for MVP; reconsider as an optional Linux acceleration only after independent validation |
| Podman-in-container / Docker-API emulation | Rootless is attractive, but Docker/Compose behavior is not identical for arbitrary customer workloads | Compatibility risk | Variable | Adds a second compatibility matrix | Reject for the first release |
| WebAssembly-only or direct process sandbox | Strongly reducible syscall surface | Does not run arbitrary Docker/Compose repositories | Not requirement-complete | Varies | Reject as the general runtime; may be a future analyzer-specific optimization |

## Threat boundary and residual risk

This design protects the physical host against ordinary target-container and worker-daemon
compromise by sacrificing the disposable guest. It does **not** claim:

- protection from a hypervisor, Lima/QEMU/VZ, or physical-host kernel vulnerability;
- safe execution of privileged workloads, kernel modules, host networking, devices,
  nested virtualization, or Docker-socket-dependent applications—these are `blocked`;
- prevention of source exfiltration through an explicitly approved build or agent egress
  channel; approvals and destination policy must disclose that residual risk;
- safety of mutable image tags or remote Compose references; resolve and record immutable
  digests, and reject unresolved remote configuration;
- immunity to CPU, memory, PID, log, or disk denial of service inside the allocated VM;
  limits bound impact but do not guarantee useful progress;
- confidentiality against microarchitectural side channels or a compromised hypervisor;
- AppArmor confinement inside rootless Docker. Docker lists AppArmor, overlay networks,
  checkpointing, and SCTP publishing as unsupported in rootless mode; repositories that
  require them are `blocked`
  ([rootless known limitations](https://docs.docker.com/engine/security/rootless/troubleshoot/));
- that a coding agent reading hostile instructions is trusted. The agent must not possess
  the runtime socket, host filesystem, output signing key, or broad credentials. Prompt
  injection is a separate P2 control even though the VM limits its host blast radius.

Docker's own security documentation emphasizes the daemon attack surface and that only
trusted users should control it because daemon clients can mount the host filesystem
([Docker Engine security](https://docs.docker.com/engine/security/)).
The broker is therefore a security boundary, not convenience plumbing.

## Concrete validation and release evidence

P4/P7 should implement the following tests on **native** macOS ARM64, macOS x86-64,
Linux ARM64, and Linux x86-64. A missing platform is a release blocker under AC-10.

1. **Prerequisite attestation:** record host/guest architecture; Lima, guest kernel,
   Docker Engine, Compose, RootlessKit, runc/containerd versions and image digests.
   Assert worker `docker info` reports rootless, cgroup v2/systemd, and required
   controllers. Fail closed.
2. **No-socket/no-mount assertion:** inspect every outer and inner container. Assert no
   physical-host Docker socket, provider home, SSH path, agent socket, host home, source
   parent, or generated directory appears in target mounts or environment. From a
   malicious target, probe common socket paths and `DOCKER_HOST`; all must fail.
3. **Compose-policy corpus:** fixtures for every rejected field above, chained local and
   remote includes/extends, interpolation, `provider`, absolute/relative/symlink path
   escape, `/var/run/docker.sock`, `/proc`, `/sys`, `/dev`, host namespaces, and
   external resources. Assert rejection occurs before image pull, build, or container
   creation. Store normalized config and policy reasons as evidence.
4. **Privilege probes:** from target containers attempt `mount`, `mknod`, raw sockets,
   capability escalation, setuid execution, host PID/network access, device access, and
   writes outside approved scratch mounts. Assert failure; inspect effective capabilities,
   seccomp, `no-new-privileges`, UID maps, read-only root, and network membership.
5. **Source integrity:** seed tracked, untracked, symlink, hardlink, and permission
   sentinels. Hash the canonical snapshot before/after build and runtime. Assert writes
   work only in disposable work volumes and never change source.
6. **Output isolation:** place a canary secret in target and a different canary in the
   agent credential tier. Assert target cannot enumerate `generated/`; package scanning
   finds neither canary or SSH/provider material. Recompute manifest and SHA-256 after
   copying the approved export to the host.
7. **Egress tests:** in build state, assert only declared proxy destinations work and
   direct IP, alternate DNS, IPv6, UDP, link-local/cloud metadata, host gateway, and LAN
   addresses fail. In runtime state, assert DNS and direct external IPv4/IPv6 all fail
   while service-to-service and Playwright-to-app traffic pass. Treat proxy bypass as a
   critical release failure.
8. **Port exposure:** from another LAN host and every physical-host interface, scan the
   selected UI and target ports. Assert the UI responds only on `127.0.0.1`; assert no
   target service is published outside the nested network.
9. **Resource attacks:** run bounded memory exhaustion, fork bomb, CPU spin, log flood,
   large-file/disk-fill, excessive replicas, and hung shutdown fixtures. Assert inner
   service termination, outer/VM ceiling, host-side deadline/emergency stop, useful
   failure evidence, and successful VM/disk deletion.
10. **Escape blast-radius canary:** place non-secret canaries only in the guest outside
    DinD and on the physical host. Demonstrate target cannot read either. The test does
    not prove absence of kernel/hypervisor exploits, so the report must state that
    residual risk rather than claim “secure sandbox.”
11. **Capability-gate behavior:** run a safe fixture and fixtures requiring privileged
    mode, a host socket, host network, device, unsafe bind, unsupported architecture, and
    production endpoint. Only the safe fixture launches; the others complete static
    assessment with precise `blocked` reasons.
12. **Teardown/recovery:** kill the launcher at each lifecycle phase, restart/resume where
    supported, and verify orphan inner containers, networks, images, guest processes,
    disks, and port forwards are removed without deleting a validated export.

### Feasibility spike status

This research environment has no `docker` executable or daemon (`docker version` returned
`/bin/bash: docker: command not found` on 2026-07-27), so it cannot honestly claim a
nested-runtime spike. P4 must make the four-platform smoke above a build gate. The
official documentation establishes rootless Engine prerequisites, but does not substitute
for validating guest provisioning, cgroup delegation, Compose behavior, and teardown on
each supported host.

## Risks / what would change the recommendation

- A maintained, cross-platform VM/container runtime with a smaller audited isolation
  surface could replace Lima plus the guest rootless engine after passing the same
  adversarial suite. It would not remove the need for the broker.
- If the product narrows “untrusted” to customer-reviewed, non-malicious code, the VM may
  become an optional high-isolation profile and direct rootless DinD may be acceptable
  for trusted fixtures. That is a product/threat-model change, not an implementation
  shortcut.
- If a disposable VM and its virtualization prerequisites are unacceptable to operators,
  safe dynamic execution of malicious Docker/Compose repositories is not portable enough
  for the stated MVP. The honest fallback is static assessment with runtime `blocked`,
  not host-socket mounting or privileged DinD.
- Lima is a cross-platform implementation choice, not a formal security product. Pin and
  patch its VM image, verify its virtualization backend on every host, disable mounts,
  and track its security advisories. A future audited microVM backend could replace Lima
  behind the same VM/broker contract.
- macOS x86-64 hardware availability is an explicit delivery risk. Emulation can test
  image manifests but cannot satisfy the brief's current native-host release gate unless
  the product owner revises AC-10.

## Sources

All accessed 2026-07-27.

- [Docker Compose trust model](https://docs.docker.com/compose/trust-model/)
- [Docker Engine security](https://docs.docker.com/engine/security/)
- [Protect the Docker daemon socket](https://docs.docker.com/engine/security/protect-access/)
- [Docker rootless mode](https://docs.docker.com/engine/security/rootless/)
- [Docker rootless mode tips, including rootless DinD and cgroups](https://docs.docker.com/engine/security/rootless/tips/)
- [Docker rootless mode troubleshooting and known limitations](https://docs.docker.com/engine/security/rootless/troubleshoot/)
- [Docker runtime privilege and capabilities](https://docs.docker.com/engine/containers/run/)
- [Docker container-run security options and read-only roots](https://docs.docker.com/reference/cli/docker/container/run)
- [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)
- [Compose services reference](https://docs.docker.com/reference/compose-file/services/)
- [Compose networks reference](https://docs.docker.com/reference/compose-file/networks/)
- [Compose Deploy Specification](https://docs.docker.com/reference/compose-file/deploy/)
- [Docker Official Image](https://hub.docker.com/_/docker)
- [Docker Official Image rootless-DinD tags and architectures](https://hub.docker.com/_/docker/tags?name=dind)
- [Lima overview and architecture support](https://lima-vm.io/docs/)
- [Lima usage and host mount controls](https://lima-vm.io/docs/usage/)
- [Lima plain mode](https://lima-vm.io/docs/config/plain/)
- [Lima `create` resource, architecture, mount, and forwarding flags](https://lima-vm.io/docs/reference/limactl_create/)
- [Lima filesystem-mount caveats](https://lima-vm.io/docs/config/mount/)
- [Lima security guidance](https://lima-vm.io/docs/security/)

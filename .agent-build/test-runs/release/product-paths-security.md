# P7 product-paths security review

Date: 2026-07-28 UTC  
Scope: signed host-helper installation and service boundary, authenticated helper protocol,
provider broker, trusted SSH acquisition, isolated runtime, paired-provider review, and customer
release transition.

## Verdict

**Deterministic product security: PASS. Customer release: NO-GO pending external evidence.**

No unresolved Critical or High deterministic product defect remains in the reviewed paths. The
formerly blocking helper request/result closure, emergency result contract, provider release
authority binding, SSH receipt closure, isolated-runtime crash recovery, transition lock recovery,
and mutable installer payload issues were independently reproduced after repair and now fail closed.

Customer release remains blocked because the real bootstrap, native platform, provider, SSH,
cleanup, human-review, and final signing evidence required by the production-release contract is
not present in this environment. Fixture tests, source inspection, and locally generated records
cannot clear those gates.

## Ranked findings

### Critical

None open in the deterministic product implementation.

### High

None open in the deterministic product implementation.

Closed High defects reverified in this pass:

- `scripts/host-helper-protocol.mjs` now rejects open or ill-typed nested helper results and accepts
  only the frozen `vm.emergencyStop` result.
- `scripts/host-helper-protocol.mjs` and `scripts/host-helper-operations.mjs` reject every previously
  accepted type-confused operation payload before admission or effect.
- `scripts/provider-broker.mjs` carries the configured release-authority digest independently from
  the provider-egress digest and binds it into job admission.
- `scripts/run-release-assessment.mjs` persists and replays SSH and isolated-runtime wrapper state;
  `scripts/release-run-state.mjs` narrowly admits the exact isolated-runtime crash state without
  repeating a completed effect.
- `scripts/install-production-host-helper.sh` no longer trusts colocated digests or mutable
  checkout comparisons. It consumes the fixed root-promoted signed-release record, copies into a
  root-only staging directory, verifies staged and installed bytes, and verifies Node before first
  execution.

### Medium — launchd has weaker service containment than systemd

**Location:** `container/runtime/install/repo-assessment-kit-host-helper.service` and
`container/runtime/install/com.repo-assessment-kit.host-helper.plist`.

The Linux unit applies fixed argv, `NoNewPrivileges`, `ProtectSystem`, home/kernel/cgroup
protections, address-family restriction, SUID/SGID restriction, native syscall architecture, and a
restrictive umask. The macOS plist preserves the fixed root entrypoint, identity, umask, and
no-auto-start rule, but it has no equivalent process/filesystem/device sandbox.

**Impact:** this does not create a demonstrated protocol or authorization bypass, but a future
memory, parser, or fixed-driver compromise would retain a broader root host blast radius on macOS
than on Linux.

**Remediation:** keep the delta explicit in the macOS platform threat model and certificate. Apply
the strongest supported macOS service sandbox/entitlement and resource restrictions compatible
with Lima and the fixed drivers, or obtain a documented release risk acceptance backed by native
host escape, filesystem, device, socket, and process canaries. This caveat is subsumed by the
currently missing macOS native release evidence and does not independently reopen a High defect.

### Low

None material enough to report separately.

## External release-evidence gates

These are blocking prerequisites, not deterministic code defects:

1. **Trusted bootstrap and root installation.** Authenticate the verifier/distribution channel
   independently, verify the legitimate Ed25519 release signature, promote the fixed mode-0400
   `verified-host-helper.txt`, and perform the root install/verify ceremony with the exact
   owner/mode/account/group constraints.
2. **Native peer identity.** Exercise the signed `rak-peer-cred` implementation across real UID 0
   and the dedicated client UID, including wrong-peer, stale socket, restart, and changed-inode
   cases on Linux and macOS.
3. **Four native runtime platforms.** Produce current Linux ARM64/x86-64 and macOS ARM64/x86-64
   certificates covering Lima plain mode, rootless runtime, cgroup/resource enforcement,
   firewall/request guard, one-use secrets, emergency stop, and zero-residue cleanup.
4. **Trusted SSH.** Run a real repository-scoped key or approved agent-socket acquisition with
   strict known-host authority, interruption/replay, five exact helper receipts, and no credential,
   mount, network, process, or transfer residue.
5. **Real providers.** Complete authenticated Codex and Claude Code runs, opposite-provider
   cross-review, provider canaries/equivalence, and provider-specific zero-residue cleanup.
6. **Signed release inventory.** Supply legitimate current release-assets, toolchain, image, SBOM,
   provenance, vulnerability, and official-schema certificates. The checkout intentionally lacks
   the native payloads, release signature, and signing key.
7. **Human and customer authority.** Admit the five distinct signed reviews, customer acceptance,
   applicable SSH and cleanup certificates, and a separate fresh final release authorization.

Until all seven gates are present and freshly revalidated, the correct customer-release decision is
**NO-GO**.

## Verification evidence

- Independent former-defect adversarial probe: all nested-result and typed-payload
  `unsafeAccepted` values are `false`; the divergent emergency shape rejects and the frozen shape
  accepts.
- Host installer and signed authority focus: **17/17 passed**.
- Expanded Node release seams: **126/126 passed**, plus closed-surface launcher smoke.
- Public transition and release recovery focus: **28/28 passed**.
- Final integrated CI reported by the build captain: **174/174 Vitest and 126/126 release seams**;
  fixtures, shell checks, build, foundation/security smoke, and formatting passed.
- Production dependency audit: no known vulnerabilities.
- Real installation paths and authorities were absent in this environment, including
  `/etc/repo-assessment-kit/host-helper.json`,
  `/run/secrets/rak-host-helper-client.key`,
  `/usr/local/libexec/rak-peer-cred`, and
  `/var/lib/repo-assessment-kit/release/verified-host-helper.txt`.

## Merge and release disposition

The reviewed deterministic implementation has no remaining Critical/High security blocker and is
eligible to merge subject to the repository's normal integration policy. It is **not eligible for
customer release** until every external gate above is evidenced and the macOS service-containment
delta is covered by the native platform review.

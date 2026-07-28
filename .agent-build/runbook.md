# P4 foundation runbook

## Current capability boundary

P4 provides a reproducible workspace, provider credential/task images, immutable source
acquisition scaffold, isolated-runtime release gates, and CI. It does not claim an
assessment run or customer ZIP. Public `run`, `interactive`, and `resume` verbs fail until
the P5 broker can authenticate a task capsule, evidence view, fence, proposal outbox, and
egress attestation. AC-2 and AC-9 end-to-end evidence remains a P5/P7 release gate.

Provider containers receive only their provider-specific `/home/node` volume. They receive
no kit tree, source, snapshot, SSH, SQLite/state, generated artifacts, Docker socket, or
host path. The internal task entrypoint accepts a bounded immutable capsule and an empty
proposal outbox; it is not exposed by the public launcher.

## Local development

Install Node 24.4.1, enable Corepack, and run:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The development UI and API both bind `127.0.0.1`. Provider image `status` uses
`--network none`. Provider `login` is refused unless `RAK_PROVIDER_NETWORK` and a matching,
unexpired `RAK_PROVIDER_EGRESS_ATTESTATION` identify an externally enforced
`provider-inference` network with exact allowed hosts.

The attestation is an Ed25519-signed envelope from the trusted host helper. Its signed payload
binds purpose, subject, Docker network name and immutable network ID, enforcement-policy digest,
release-owned exact endpoints, issue/expiry times, and a one-use nonce. The pinned verification
key is `release/network-attestor-public-key.pem`; there is no signing key or operator key
override in this repository. Until P5 provisions the trusted signer and enforcing proxy, login
remains refused.

## Immutable source acquisition

Create an existing, empty, owner-only output directory, then run local commit-only acquisition:

```sh
./scripts/acquire-source.sh local /absolute/repository HEAD /empty/output-directory
```

The acquisition container receives the repository read-only with no network, resolves the
full commit, hashes repository status before and after, archives that commit, and writes
`snapshot.tar` plus `identity.json`.

SSH acquisition takes an SSH URL, ref, exact repository-scoped read-only private key, exact
`known_hosts` file, and empty output directory:

```sh
RAK_GIT_NETWORK=rak-git-egress \
RAK_GIT_EGRESS_ATTESTATION=/secure/git-network.json \
./scripts/acquire-source.sh ssh git@example.com:owner/repository.git main \
  /secure/key /secure/known_hosts /empty/output-directory
```

SSH is available only to the ephemeral acquisition container. It is never mounted into a
provider home. The network must be an externally restricted, attested `git-acquisition`
network for that exact subject. Submodules, LFS, file transports, credential-bearing HTTP
URLs, interactive prompts, hooks, and global/system Git configuration are not enabled.

Output must be a canonical, non-symlink, empty directory disjoint from the source, `.git`, exact
SSH files, and both SSH parent directories. The fixed numeric UID 10001 worker writes to an
anonymous Docker volume. Only after it exits successfully does the launcher copy its output to
the host directory; host UID/GID never overrides the worker identity.

## Outbound access

There is no general internet capability:

- provider login/inference: exact provider hosts through an attested provider network;
- SSH acquisition: the approved Git host/port through a separate attested Git network;
- dependency/image retrieval: build and release jobs only;
- target runtime: denied unless a separately approved runtime policy permits exact endpoints;
- optional hosted analyzers: not enabled by P4.

Network attestations require a valid pinned signature, exact release-owned endpoint set,
purpose/subject/network identity, policy digest, fresh bounded lifetime, and matching one-use
nonce. Successful verification atomically consumes the signed nonce. Unsigned, forged, stale,
replayed, wrong-host, wrong-purpose, or wrong-network records fail closed.

## Validation and release gates

```sh
pnpm install --frozen-lockfile
pnpm run ci
```

CI runs formatting, lint, dependency boundaries, strict types, deterministic foundation
tests, all fixture checks, Bash syntax, builds, and semantic safety smoke. Hosted CI also
ShellChecks scripts and builds all three images for Linux ARM64 and x86-64.

The native workflow requires macOS and Linux runners on ARM64 and x86-64. It fails when
runtime capability is blocked, then invokes fixed request-guard, egress-deny,
resource-limit, emergency-stop, and residue-cleanup adversarial controls. QEMU image builds
do not replace native proof. Docker, Lima, provider authentication, and native results are
not considered passed without recorded workflow evidence.

## WSL best-effort

Use WSL 2 with a current Linux distribution and Docker Desktop WSL integration. Keep source
inside the WSL filesystem, not `/mnt/c`, for permission and performance consistency. Lima's
macOS/Linux host lifecycle is not supported natively in WSL, so dynamic target execution is
expected to remain `blocked`; static acquisition and workspace checks may still operate.
Do not expose Docker's TCP API or mount the Docker socket to bypass this limitation.

## Recovery, package verification, and rollback

Provider login homes are independent from acquisition output. Recreate a failed acquisition
in a new empty output directory; never merge partial output. A status-digest mismatch,
existing output, invalid attestation, broker residue, or failed native gate is fail-closed.
Preserve diagnostics and do not relabel blocked coverage as passed.

P7 customer packages must provide a detached SHA-256 digest, `SHA256SUMS`, and a manifest.
Verification procedure:

```sh
sha256sum --check SHA256SUMS
sha256sum customer-package.zip
unzip -t customer-package.zip
```

The detached digest must equal the ZIP digest and every manifest entry must match the
reopened archive. P4 does not generate that package.

A release uses `release/release-manifest.schema.json` and verified image digests. Rollback
selects a prior signed manifest, stops the current containers, and redeploys all three
images by recorded digest. Provider homes and acquisition outputs are preserved. Database
migrations are forward-only: restore a verified pre-migration backup with its matching
older server image rather than downgrading a live database.

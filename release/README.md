# Release assets and authority

Every distributable release must include a manifest conforming to `release-manifest.schema.json`. CI
supplies verified multi-architecture image digests:

```sh
RAK_CODEX_IMAGE_DIGEST=sha256:<64-hex> \
RAK_CLAUDE_IMAGE_DIGEST=sha256:<64-hex> \
RAK_ACQUISITION_IMAGE_DIGEST=sha256:<64-hex> \
pnpm release:manifest -- release-manifest.json
```

Generation fails when the source has no commit, a digest is absent or malformed, or the destination
already exists. Values supplied to that generator are assertions, not authority. A launcher must
never trust the manifest, an image tag, a self-declared image label, or an environment digest until
the complete signed bundle passes the verifier below.

Manifest schema version 2 also requires the closed signed `hostHelper` section. It digest-binds the
fixed installer, helper/service/journal/protocol/config/provider-task/validator/entrypoint modules,
Linux and macOS service definitions, and the Node v24.4.1 plus native peer-verifier payloads at
`container/runtime/install/payload/<linux|macos>-<arm64|x86-64>/`.

The frozen release bundle names are:

- `release-manifest.json`
- `toolchain.lock.json`
- `release-signature.json`
- `release-signing-public-key.pem`

The latter three release-specific files are not fabricated by the repository. Release engineering
must stage every pinned artifact and evidence file named by `toolchain.lock.json`, add exact
multi-architecture image records, provision a trusted Ed25519 public key, and create a legitimate
signature outside the repository. The private key must never enter this repository, an image,
generated output, or a provider/target environment.

## Fail-closed verification

```sh
node scripts/verify-release-assets.mjs \
  --manifest release/release-manifest.json \
  --toolchain release/toolchain.lock.json \
  --signature release/release-signature.json \
  --trusted-key release/release-signing-public-key.pem \
  --output /protected/runtime/verified-release.json
```

The signature is Ed25519 over these exact UTF-8 bytes, with the digest values substituted:

```json
{
  "manifestSha256": "<64 hex>",
  "profile": "rak-release-authority/1.0.0",
  "toolchainLockSha256": "<64 hex>"
}
```

Success emits `rak-verified-release/1.0.0` with `verified: true`, the source commit, authority
digests, an exact Codex/Claude/acquisition/browser mapping, immutable `reference@sha256:...` values,
and the native verified age executable record. It produces no verified output on a missing or
invalid signature, key mismatch, platform mismatch, unstaged artifact, digest mismatch, missing
license, SBOM, provenance, vulnerability scan, or image evidence. Launchers consume only this
verified mapping.

`--inventory-only` audits the unsigned inventory and returns exit 2 plus explicit blockers when it
is incomplete. It never returns `verified: true`.

### Root host-helper installation authority

The general verification command above may use a caller-selected key for non-installing
verification. It cannot create root installation authority. A root release operator must first
provision the legitimate release key out of band at the fixed canonical, root-owned, non-symlink
path `/etc/repo-assessment-kit/release/release-signing-public-key.pem` with mode `0444`, then run:

```sh
node scripts/verify-release-assets.mjs \
  --manifest release/release-manifest.json \
  --toolchain release/toolchain.lock.json \
  --signature release/release-signature.json \
  --output /protected/runtime/verified-release.json \
  --emit-host-helper-record
```

`--emit-host-helper-record` rejects a `--trusted-key` override. Only after the complete signed
bundle passes does it exclusively create root-owned mode-`0400`
`/var/lib/repo-assessment-kit/release/verified-host-helper.txt`. The closed record selects the
current platform/architecture payload and binds the manifest, signing key, source commit, Node
version, installer, every module, and both service definitions.

The installer verifies that record before mutation or payload execution, copies the bounded payload
into a fresh root-owned mode-`0700` staging tree, rehashes every staged file, and installs only from
those bytes. It enforces the exact dedicated UID/GID 62345 account and empty group closure. It
installs or verifies files but never starts, enables, or bootstraps the service. Activation requires
a separate root-operator action. The macOS launchd unit does not by itself prove parity with Linux
systemd sandbox hardening; native macOS evidence remains mandatory.

## Schema assets

`packages/analyzers/assets/schema-registry.json` binds the complete checked-in schemas to their
source revision, license/notice, and SHA-256:

- kit-owned strict repository-assessment 1.0.0, JSON Schema Draft 2020-12;
- official OASIS SARIF 2.1.0 Errata 01, Draft-04;
- official CycloneDX 1.7 JSON plus its SPDX, JSF, and cryptography companion schemas, Draft-07.

Package/export validation runs the official schema and the stricter RAK semantic/reference profile.
The upstream schema bytes are excluded from formatting so their recorded digests remain meaningful.

## Customer ZIP and optional encryption

Customers can independently verify a ZIP, detached digest, internal manifest/checksums, content
gates, and official SARIF/CycloneDX schemas:

```sh
node scripts/verify-package.mjs \
  --zip generated/example/customer-package.zip \
  --digest generated/example/customer-package.zip.sha256
```

Optional encryption uses only age v1.3.1 X25519 recipient mode. Passphrases are intentionally not
accepted by these commands: secrets must not appear in argv, environment variables, or prompts. The
age executable must be the exact native executable digest authorized by the verified signed
toolchain; printing the expected version is insufficient. Encryption always decrypts into protected
temporary storage and requires the recovered ZIP SHA-256 to match before publishing ciphertext.

```sh
node scripts/age-package.mjs encrypt-verify \
  --age-bin /protected/release/bin/age \
  --verified-release /protected/runtime/verified-release.json \
  --input generated/example/customer-package.zip \
  --output generated/example/customer-package.zip.age \
  --recipient age1... \
  --identity /protected/recovery/identity.txt
```

The identity must be an exact regular file inaccessible to group/other users. The recipient is
public; the identity contents are never copied, logged, or passed in argv/environment.

## Current checked-in status

`toolchain.lock.json` records verified upstream pins and license notices, but deliberately marks
release staging unavailable. Tool archives/provenance/SBOMs are not staged; several tools require
kit-generated SBOMs; current vulnerability scans and signed multi-architecture image evidence do not
exist; and no legitimate release public key/signature has been provisioned. The verifier therefore
fails closed. This is an explicit release blocker, not a degraded success.

Final full CI passes 174/174 Vitest checks, 126/126 release seams, fixtures, shell syntax, build,
foundation smoke, security smoke, and a production audit with no known vulnerabilities. The CI
environment has no native C compiler, so the four manifest-bound `rak-peer-cred` payloads were not
compiled or executed on Linux ARM64/x86-64 and macOS ARM64/x86-64. Those missing native exercises
and release artifacts preserve the external release NO-GO; they do not invalidate the passing
deterministic product checks.

`network-attestor-public-key.pem` is the release-pinned Ed25519 verification key for host-helper
network attestations. Its private key is intentionally absent. P5 must provision the private key
only into the trusted host-helper signing compartment; operators and workload containers never
receive it.

## Production authority installation

The signed release bundle is necessary but is not the complete production installation. A trusted
host administrator must install `/etc/repo-assessment-kit/host-helper.json` as `root:<clientGid>`
mode `0440`, with no symlink, and provision the dedicated nonroot public client UID/GID named by
that file. The public launcher never runs as root.

The closed configuration pins:

- the native root-owned mode-`0755` `/usr/local/libexec/rak-peer-cred` path, platform, and digest;
- the fixed root helper operations, Lima binary/guest, rootless runtime broker, firewall, request
  guard, secret broker, provider/acquisition images, provider homes, network/resource profiles, and
  SSH handles;
- the `request-guard.issue` public key, root-owned immutable catalog path/digest, and fixed external
  signer owner/mode/digest/lifetime;
- exactly five kind-specific human-review public keys;
- one distinct final release-authorization public key;
- one kind-specific public key for every applicable release certificate; and
- exact current certificate subject digests plus any unresolved Critical/High boundary defects.

Every public-key/catalog/config file is root-owned, configured-client-group, mode `0440`,
non-symlink, read with a held no-follow descriptor, and digest checked. Private signer keys remain
in their external signing compartments. They never enter JSON, environment variables, argv, images,
generated output, or the repository.

The helper’s only client byte export is the finalized source snapshot beneath the fixed
`/var/lib/repo-assessment-kit/transfers/` root. Provider tasks use the typed staging operation;
runtime plans use `request-guard.issue`; SSH uses a registered opaque handle. There is no generic
copy, signer, socket, path, SSH, Docker, Lima, mount, or network operation.

## Public pairing and authorization

After one real Codex and one real Claude Code run finish as matching
`DRAFT_VALIDATED_RELEASE_BLOCKED` drafts, either public launcher may perform:

```text
pair --codex-run-dir <generated run> --claude-run-dir <generated run>
review --pair-dir <generated pair> --record <signed review JSON>
authorize --pair-dir <generated pair> --record <signed authorization JSON>
release --pair-dir <generated pair>
```

`pair` binds both immutable runs and foreign-provider reviews into an owner-private journal and
regenerates a blocked successor ZIP. `review` admits exactly one signed, nonreplayed record for each
of independent security, independent decision, technical human, lay human, and customer acceptance.
`authorize` requires the separate release authority to bind those five reviews, the exact successor
and reconciliation digests, and every signed asset/schema/provider/platform/SSH/ cleanup
certificate. Unresolved Critical/High boundary defects block authorization.

`release` reopens the ZIP and revalidates all pair, signature, nonce, expiry, digest, review,
certificate, four-platform, applicable SSH, and zero-residue gates. Success writes an exclusive
digest-bound sidecar; the ZIP remains an immutable draft artifact. Any failure preserves
`DRAFT_VALIDATED_RELEASE_BLOCKED` and a fixed blocker code.

These production interfaces have deterministic product checks, but a real deployment and external
authority evidence have not yet authorized customer release. Fixture keys, self-signatures,
test-only adapters, parser probes, or generated certificates cannot clear the NO-GO.

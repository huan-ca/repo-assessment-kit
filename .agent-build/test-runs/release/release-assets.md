# P7 release assets, schema, package, and encryption evidence

Date: 2026-07-28 UTC

## Verdict

- **Deterministic implementation: PASS.**
- **Signed customer release authority: BLOCKED.**

The schema validators, release/tool inventory verifier, customer ZIP verifier, and real age
encryption/recovery provider are implemented and pass their available deterministic tests. The
checked-in toolchain is intentionally unavailable for release: required staged artifacts, complete
SBOM/provenance/vulnerability evidence, signed multi-architecture images, and a legitimate Ed25519
release key/signature do not exist. No command in this run produced `verified: true` release
authority.

## Official schema provenance and validation

Commands:

```sh
pnpm --filter @rak/analyzers build
node --input-type=module <<'NODE'
import {verifyReleaseSchemaAssets} from './packages/analyzers/dist/index.js';
console.log(JSON.stringify(verifyReleaseSchemaAssets(), null, 2));
NODE

node --input-type=module <<'NODE'
import path from 'node:path';
import {
  assessRepository,
  projectSarif,
  projectCycloneDx,
  validateWithOfficialReleaseSchema
} from './packages/analyzers/dist/index.js';
const assessment = await assessRepository(
  path.resolve('fixtures/ecosystems/node-typescript'),
  {
    runId: 'run_01900000-0000-7000-a000-000000000001',
    snapshotId: 'snp_01900000-0000-7000-a000-000000000001',
    generatedAt: '2026-07-28T00:00:00.000Z'
  }
);
console.log(JSON.stringify({
  native: validateWithOfficialReleaseSchema('native', assessment),
  sarif: validateWithOfficialReleaseSchema('sarif', projectSarif(assessment)),
  cycloneDx: validateWithOfficialReleaseSchema(
    'cyclonedx',
    projectCycloneDx(assessment, 'fixture')
  )
}, null, 2));
NODE
```

Results:

- Registry digest:
  `43eb1697d59482d47d668811f0330b889142e934ba4bec82c3b58d6760a5efaf`.
- Native RAK 1.0.0 Draft 2020-12:
  `2245c95a522cea40cc4e3a337d266cd5db0022d4425cb5c9b9e682209cb8e8d8`.
- Official OASIS SARIF 2.1.0 Errata 01 Draft-04:
  `c3b4bb2d6093897483348925aaa73af03b3e3f4bd4ca38cef26dcb4212a2682e`.
- Official CycloneDX 1.7 Draft-07:
  `df472ef4aaf593904c479293723a1a5c191d6672715c93b3c0b5c318f3914221`.
- CycloneDX companion digests:
  - cryptography definitions:
    `018ea7f78b5208ec647cfd10f669cc9c26aba6aceb79c4da7f9c0ef4c99b60de`;
  - JSF 0.82:
    `8bae002c25e723db7ee1f26afde680ae1a2b1a8f6b4b4b0fd65dc3becb090aae`;
  - SPDX:
    `54a6288292bc6c90b0d3952f5f939f17436fa76704ffe68a46e5b78539c7cc1b`.
- Native, SARIF, and CycloneDX projections all passed their full official/kit schema validator and
  the RAK export semantic profile.

Machine evidence:

- `../../artifacts/p7-release-assets/schema-provenance.json`
- `../../artifacts/p7-release-assets/schema-sha256.txt`
- `../../artifacts/p7-release-assets/official-schema-validation.json`

The official schema bytes are not reproduced in this report. Their checked-in copies retain source,
revision, copyright/license notice, and digest metadata in
`packages/analyzers/assets/schema-registry.json`.

## Focused implementation and security suites

Commands:

```sh
pnpm exec vitest run \
  packages/analyzers/test/index.test.ts \
  packages/packaging/test/index.test.ts \
  packages/packaging/test/age-provider.test.ts

pnpm exec vitest run \
  packages/packaging/test/index.test.ts \
  packages/packaging/test/age-provider.test.ts
```

Results:

- Analyzer plus packaging: **37/37 passed**, three files.
- Packaging security rerun: **14/14 passed**, two files.
- Scoped ESLint and analyzer/packaging typechecks also passed before evidence freeze.
- The independent security reviewer accepted the deterministic age supply-chain fix.

Machine evidence:

- `../../artifacts/p7-release-assets/focused-tests-37.txt`
- `../../artifacts/p7-release-assets/security-packaging-tests-14.txt`

## Toolchain inventory and unsigned release gate

Commands:

```sh
node scripts/verify-release-assets.mjs \
  --manifest .agent-build/artifacts/p7-release-assets/inventory-fixture-manifest.json \
  --toolchain release/toolchain.lock.json \
  --inventory-only

node scripts/verify-release-assets.mjs \
  --manifest .agent-build/artifacts/p7-release-assets/inventory-fixture-manifest.json \
  --toolchain release/toolchain.lock.json
```

Results:

- Inventory audit exit: `2`.
- Inventory status: `unavailable`.
- Inventory verified: `false`.
- Explicit blocking reasons: **52**.
- Ordinary unsigned release verification exit: `1`.
- Verified stdout bytes: **0**.

The fixture manifest contains non-authoritative test digests and exists only to exercise inventory
accounting. It cannot authorize a launcher. The principal blockers are unstaged archives,
SBOMs/provenance, missing current vulnerability scans, absent signed multi-architecture image
records, and absent legitimate signing material.

Machine evidence:

- `../../artifacts/p7-release-assets/toolchain-inventory.json`
- `../../artifacts/p7-release-assets/toolchain-inventory.stderr`
- `../../artifacts/p7-release-assets/unsigned-release.stdout`
- `../../artifacts/p7-release-assets/unsigned-release.stderr`
- `../../artifacts/p7-release-assets/release-gate-summary.json`

## Customer ZIP verifier

Command:

```sh
node scripts/verify-package.mjs \
  --zip /tmp/tmp.SYXXDflL0M/output/verifier-fixture-1bc4739b129715910fad707abbf26d5e8a58cf12-20260728T123456Z/verifier-fixture-1bc4739b129715910fad707abbf26d5e8a58cf12-20260728T123456Z-DRAFT.zip \
  --digest /tmp/tmp.SYXXDflL0M/output/verifier-fixture-1bc4739b129715910fad707abbf26d5e8a58cf12-20260728T123456Z/verifier-fixture-1bc4739b129715910fad707abbf26d5e8a58cf12-20260728T123456Z-DRAFT.zip.sha256
```

Only a `DRAFT_VALIDATED_RELEASE_BLOCKED` offline package was available. The customer release
verifier rejected it with exit `1`, zero stdout, and:

```text
customer package verification failed: Undeclared package file: SHA256SUMS
```

This is the correct boundary: the command did not relabel a draft package as a release package.
A positive customer ZIP verification remains blocked until the signed release workflow produces
one complete customer ZIP.

Machine evidence:

- `../../artifacts/p7-release-assets/customer-zip-verifier-summary.json`
- `../../artifacts/p7-release-assets/customer-zip-verifier.stdout`
- `../../artifacts/p7-release-assets/customer-zip-verifier.stderr`

## Real age v1.3.1 ARM64 cryptographic exercise

Source:

```text
https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-linux-arm64.tar.gz
```

Procedure:

1. Download the upstream Linux ARM64 archive into a temporary directory.
2. Compare the archive SHA-256 to the pinned upstream digest.
3. Extract only into that temporary directory and compare the `age` executable SHA-256 to the
   signed-toolchain executable pin.
4. Confirm `age --version` is exactly `v1.3.1`.
5. Create a temporary X25519 identity with mode `0600`; retain neither identity nor recipient value.
6. Encrypt a temporary ZIP fixture through `scripts/age-package.mjs`.
7. Decrypt/recover through the provider and independently with the upstream executable.
8. Compare the input and recovered ZIP SHA-256.

The exact core commands were:

```sh
curl --fail --silent --show-error --location \
  https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-linux-arm64.tar.gz \
  -o "$age_tmp/age.tar.gz"
sha256sum "$age_tmp/age.tar.gz"
tar -xzf "$age_tmp/age.tar.gz" -C "$age_tmp"
sha256sum "$age_tmp/age/age"
"$age_tmp/age/age" --version
"$age_tmp/age/age-keygen" -o "$age_tmp/identity.txt"
chmod 600 "$age_tmp/identity.txt"
recipient=$("$age_tmp/age/age-keygen" -y "$age_tmp/identity.txt")
node scripts/age-package.mjs encrypt-verify \
  --age-bin "$age_tmp/age/age" \
  --verified-release "$age_tmp/authority.json" \
  --input "$age_tmp/customer.zip" \
  --output "$age_tmp/customer.zip.age" \
  --recipient "$recipient" \
  --identity "$age_tmp/identity.txt"
"$age_tmp/age/age" --decrypt \
  --identity "$age_tmp/identity.txt" \
  "$age_tmp/customer.zip.age" > "$age_tmp/external-recovered.zip"
sha256sum "$age_tmp/customer.zip" "$age_tmp/external-recovered.zip"
```

Results:

- Platform: `linux/arm64`.
- Archive expected and actual SHA-256:
  `c6878a324421b69e3e20b00ba17c04bc5c6dab0030cfe55bf8f68fa8d9e9093a`.
- Executable expected and actual SHA-256:
  `92da3edf27811a65a599342d743a13bb50b7f0b07f8947530d4e83249f2e4532`.
- Recipient type: age-v1 X25519; recipient value not persisted.
- Identity and passphrase: identity not persisted; no passphrase used.
- Encrypt/decrypt status: `created-and-recovered`.
- Input and recovered ZIP SHA-256:
  `48b0b1b3bc5bf263d7a10737406232fad039304c0c80697562d3f5b60eedc20b`.
- Recovery digest equality: `true`.

This proves the real cryptographic provider and recovery check, not release authorization. The
exercise used a test-shaped authority object after verifying the upstream executable pin; it was
not a legitimate signed release authority and is recorded as `releaseEligible: false`.

Machine evidence:

- `../../artifacts/p7-release-assets/age-arm64-real.json`

No private identity, recipient value, passphrase, plaintext fixture, ciphertext, or executable is
stored in the evidence directory.

## Adversarial age executable rejection

Rechecks:

- A fake regular executable that prints `v1.3.1` was rejected for digest mismatch before execution;
  its execution marker remained absent.
- A symlink to the real pinned executable was rejected because the configured executable must be a
  regular non-symlink file.
- The real executable paired with a mismatched authority digest was rejected as unauthorized.

Machine evidence:

- `../../artifacts/p7-release-assets/age-rejections.json`
- The fake-version unit test is also present in the 37/37 and 14/14 test logs.

## Analyzer occurrence-identity regression

The release self-assessment mirror exposed a deterministic collision when one detector matched
more than once on the same source line. Examples in mirror commit
`43c8c068ae780913708df20662f05dea6b303376` include two `SHA1` tokens on one CycloneDX schema line
and `md5` plus `sha1` on one analyzer-source line. Evidence and finding IDs previously bound only
the repository path, line, and rule, so those distinct occurrences received the same ID and the
unchanged reference validator correctly rejected the draft.

Analyzer occurrence identity now binds:

- collector and detector identity;
- repository-relative path;
- exact UTF-16 source start and end offsets;
- run ID for run-scoped evidence and finding IDs.

No evidence is deduplicated, and `validateAssessmentReferences` retains its duplicate-evidence
rejection. A repo-like multi-file regression verifies two routes, two weak-hash observations, and
two redacted credential observations on their respective single lines, with unique evidence,
finding, and feature IDs and byte-identical deterministic native projection across repeat runs.

Focused verification:

```text
pnpm --filter @rak/analyzers typecheck
pnpm exec eslint packages/analyzers/src/index.ts \
  packages/analyzers/test/index.test.ts --max-warnings 0
pnpm --filter @rak/analyzers build
pnpm vitest run packages/analyzers/test/index.test.ts
```

Result: typecheck, lint, and build passed; analyzer tests passed **24/24**.

The exact mirror was then rerun through `scripts/run-offline-assessment.mjs` with generated time
`2026-07-28T02:28:15.000Z`. It completed with:

- source commit `43c8c068ae780913708df20662f05dea6b303376`;
- source integrity
  `sha256:6062e4a1eea0c4e1e24657c936aac4f8328364eb98fc162075a0367ef0066599`;
- reopened ZIP with 105 checksum entries verified;
- ZIP digest
  `sha256:a3f5224f04b32ccc258b1b8660184316563f5ebca505ebb90427cd21c21de917`;
- honest verdict `DRAFT_VALIDATED_RELEASE_BLOCKED`.

This clears the analyzer duplicate-evidence blocker only. It does not authorize release or alter
the remaining provider, review, equivalence, runtime, authority, and signed-release gates. The
release integration lane must rerun its journaled mirror orchestration to replace the earlier
`RECOVERABLE_FAILURE` evidence.

## Release blockers

The lane is deterministically complete, but release remains blocked until all of the following are
real and reproducible:

- staged per-architecture tool archives and separately digest-bound extracted executables;
- complete tool and image SBOMs, upstream/kit provenance, licenses, and current vulnerability scans;
- signed `linux/amd64` and `linux/arm64` Codex, Claude, acquisition, scanner, and support images;
- a legitimate protected Ed25519 signing key ceremony, checked-in trusted public key, and valid
  signature over the exact release manifest/toolchain digests;
- launcher consumption of only the verifier's immutable `verified: true` image mapping;
- a complete signed customer ZIP that passes `scripts/verify-package.mjs`.

Until then the exact result is **implementation PASS / signed release authority BLOCKED**.

All 16 machine-evidence files present before checksum creation are covered by
`../../artifacts/p7-release-assets/SHA256SUMS`.

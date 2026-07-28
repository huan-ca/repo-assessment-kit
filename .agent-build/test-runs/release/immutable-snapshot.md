# P7 immutable local snapshot seam

**Date:** 2026-07-28  
**Scope:** Linux frozen-working-tree byte capture only  
**Verdict:** PASS for the isolated helper; release integration remains gated

## Implemented boundary

- `scripts/immutable-local-snapshot.mjs` exports the closed
  `createImmutableLocalSnapshot`, `captureImmutableLocalIdentity`, and
  `verifyImmutableLocalSnapshot` functions and a closed snapshot-creation CLI.
- The registered root, every selected source directory, the generated output root, and the
  private snapshot root remain held as directory file descriptors. Traversal and finalization use
  `/proc/self/fd/<fd>`; there is no ordinary path fallback.
- Source directories and files are opened with `O_NOFOLLOW`; regular bytes are read and copied
  through held file descriptors with pre/post `fstat`, link-count, device, inode, size, metadata,
  byte-count, and SHA-256 checks.
- Destination directories are created and reopened relative to held destination descriptors.
  Files use `O_CREAT|O_EXCL|O_NOFOLLOW`; final rename, manifest rename, cleanup, and directory
  fsync remain relative to the held output descriptor.
- The walker is UTF-8/NFC checked, byte-sorted, bounded, and rejects control paths, separators,
  special files, hardlink ambiguity, mount/device changes, mutation, absolute/escaping symlinks,
  and case/Unicode collisions. Symlinks are recorded and copied as metadata without traversal.
- The complete tree and source-state are re-walked after copy. Snapshot bytes are re-read before
  admission, then files/directories and the canonical digest-bound manifest are read-only.
- The independent verifier performs a fresh no-follow walk and checks content, sizes, digests,
  entry count, and read-only modes. It detects same-UID chmod/content tampering and is intended to
  run immediately before and after assessment.
- `captureImmutableLocalIdentity` runs the identical held-dirfd walker and manifest constructor
  without creating a destination or copying payload bytes. It returns the same canonical manifest
  and manifest digest as snapshot creation plus a canonical source-state record/digest. This is the
  bounded completion/resume identity primitive and leaves no generated payload residue.
- Per frozen architecture section 9.2, `.git` is the only default name-based exclusion.
  Customer directories named `generated`, `output`, `outputs`, and `.agent-build` are included.
  An actual output root inside the selected source is rejected. Caller-authorized exact exclusions
  remain explicit and are recorded in the manifest.
- Linux without usable proc-fd and every unsupported OS fail with
  `SIGNED_NATIVE_SNAPSHOT_HELPER_REQUIRED`; no weaker path-based mode exists.

## Focused evidence

Command:

```text
node --check scripts/immutable-local-snapshot.mjs
pnpm exec eslint scripts/immutable-local-snapshot.mjs scripts/immutable-local-snapshot.test.mjs --max-warnings 0
pnpm exec prettier --check scripts/immutable-local-snapshot.mjs scripts/immutable-local-snapshot.test.mjs
node --test scripts/immutable-local-snapshot.test.mjs
```

Result: syntax, ESLint, and formatting PASS; **11/11 tests PASS**. The original nine-test snapshot
suite was also repeated three times after the final destination-fd change; all three runs passed.

| Adversarial case | Result |
|---|---|
| Dirty and untracked regular files | Included and digest-bound |
| `.git` and customer `generated` directory | `.git` recorded/excluded; customer directory included |
| Executable and non-executable modes | Recorded; frozen without write bits |
| Safe relative symlink | Metadata retained without following |
| Absolute and parent-escaping symlinks | Rejected |
| Hardlink and FIFO | Rejected |
| Case and NFC collision | Rejected |
| Mutation followed by byte restoration | Rejected through source-state change |
| Parent directory replaced by outside symlink | Held source remains authoritative; outside sentinel absent |
| Concurrent regular-file/outside-symlink swapping | Typed rejection or safe capture; outside sentinel never admitted |
| Existing destination/output inside source | Rejected |
| Same-UID post-capture mutation | Independent verifier rejects |
| Identity-only capture versus copied capture | Canonical manifests and digests are equal |
| Identity-only regular-file/outside-symlink swap | Typed rejection or safe identity; no outside digest or output residue |

## Integration and release dependencies

This helper deliberately does not claim a complete frozen-working-tree acquisition:

1. The release orchestrator must bind the Git object format, exact `HEAD`, index digest,
   porcelain-v2 status digest, included dirty/untracked paths, and pre/post source-state into its
   signed journal. Those Git identity operations are outside this byte-copy seam.
2. The orchestrator must analyze only the returned snapshot, never the live source.
3. Read-only mode bits do not isolate against a same-UID hostile process. The orchestrator must
   invoke `verifyImmutableLocalSnapshot` immediately before and after analysis and bind both
   receipts, or admit the snapshot into a separately protected signed-helper/broker namespace.
4. macOS and Linux release-image/native-helper evidence remains part of the P7 platform matrix.

Until those dependencies are integrated and independently exercised, this result is helper-level
evidence and does not authorize customer release.

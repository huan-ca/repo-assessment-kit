# Foundation security boundaries

P4 establishes three non-overlapping compartments:

1. Provider containers retain provider login state and consume only broker-authenticated task
   capsules. Their output is an untrusted proposal.
2. The acquisition container accepts only one exact SSH key plus one exact known-hosts file and
   emits an explicitly labeled immutable-commit archive and identity. Its former local branch is
   disabled with `LOCAL_FROZEN_SNAPSHOT_HELPER_REQUIRED`: `git archive <commit>` cannot represent
   dirty or untracked frozen-working-tree bytes, so local acquisition must use the separate trusted
   immutable snapshot seam and may not silently fall back to a commit archive.
3. Hostile target execution remains blocked until the disposable VM broker and native adversarial
   gates attest containment.

No compartment receives a host Docker socket. A blocked capability is an honest coverage result, not
permission to broaden a mount, network, credential, or provider flag.

Signed network attestations consume their nonce in `state/network-attestation-nonces/` beneath the
canonical installation root. `state/`, the ledger, and marker are owner-private and may not be
symbolic; the marker binds the installation, pinned attestor key, complete attestation, and
signature. Creation is exclusive and followed by file and directory `fsync`. Unsafe existing
components or markers block without following a link or writing to an external target.

The final provenance, finding, coverage, decision, customer-report, and package-verification guides
are P7 deliverables because they depend on P5/P6 behavior. This document describes only enforceable
P4 boundaries.

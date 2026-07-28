# Release checklist

## Current decision

**P7 CUSTOMER RELEASE NO-GO / BLOCKED**

This checklist records the state of the candidate reviewed on 2026-07-28. It does not authorize a
customer release. No release sign-off has been issued, and no package marked
`DRAFT_VALIDATED_RELEASE_BLOCKED` or `customerReleaseAuthorized:false` may be delivered as a
released customer package.

Use the evidence classes below consistently:

- **Deterministic pass:** a contract, validator, fixture, parser, or fail-closed behavior passed in
  the available Linux ARM64 environment.
- **Observed slice pass:** a named real component was exercised, but the result is narrower than the
  complete release gate.
- **Real release pass:** the exact signed candidate passed the native host, provider, acquisition,
  containment, package, and independent-review gate. No item below has this status unless it says so
  explicitly.
- **Blocked:** required authority, infrastructure, platform, credential, reviewer, or signed
  candidate was unavailable. A deterministic substitute cannot clear it.

## Deterministic candidate checks

These checks have current reproducible evidence. They are necessary, but they are not release
authorization.

- [x] The closed launcher grammar and strict run configuration reject unknown fields, provider
      flags, raw credentials, production destinations, unsafe SSH forms, and direct-provider
      fallback.
- [x] The immutable local snapshot, no-follow path handling, source identity checks, run journal,
      resume fencing, cleanup accounting, and immutable receipt pass their focused suites.
- [x] The integrated provider path enforces exact closed author/reviewer profiles, completes all
      seven injected brokered task kinds, binds reviewer input to the author proposal, sanitizes
      error codes, and creates a strictly validated blocked successor draft with zero quarantined
      digests.
- [x] The deterministic static draft covers Node/TypeScript, Python, Go, Java, .NET, Ruby, and PHP
      at explicitly reduced depth when external tools are unavailable.
- [x] Guided discovery records all ten required topics and preserves unknowns with their reason,
      confidence effect, coverage effect, and follow-up.
- [x] Native assessment JSON, SARIF 2.1.0 Errata 01, and CycloneDX 1.7 projections pass the current
      checked-in official/kit schema and semantic gates.
- [x] Evidence references, coverage reconciliation, manifest/checksum integrity, ZIP reopen, tamper
      rejection, seeded-secret and host-path exclusion, and restricted O1–O4 output rules pass the
      available deterministic suites.
- [x] Accepted deterministic product-transition QA passes 305/305 checks, including 174 Vitest
      checks and 126 release seams. This is not native/external release evidence.
- [x] The final frozen full `pnpm run ci` passes 177/177 Vitest checks, 131/131 release seams,
      fixtures, shell syntax, build, foundation smoke, and security smoke; the production audit
      reports no known vulnerabilities.
- [x] A real loopback Chromium slice passed the rechecked discovery, one-use secret clearing,
      persistence, responsive layout, accessibility status, and Host/Origin boundaries.
- [x] A fresh no-finding draft passed the corrected lay-language fixture checks. This is not an
      independent human or customer acceptance review.
- [x] Real upstream `age` v1.3.1 on Linux ARM64 encrypted, independently decrypted, and
      digest-matched a test fixture. The exercise did not use signed release authority.
- [x] The self-assessment mirror produced and reopened a validated 113-entry draft ZIP with
      source/snapshot bindings and zero cleanup residue. The checkout itself had no Git `HEAD`, so
      the committed mirror—not the checkout identity—is the evidence.
- [x] Every exercised package and receipt remains visibly `DRAFT_VALIDATED_RELEASE_BLOCKED` with
      `customerReleaseAuthorized:false`.

Evidence:

- [Release self-assessment](../.agent-build/test-runs/release/self-assessment.md)
- [Adversarial acceptance matrix](../.agent-build/test-runs/release/adversarial-matrix.md)
- [Security, privacy, and safety review](../.agent-build/test-runs/release/security-review.md)
- [Release assets and package evidence](../.agent-build/test-runs/release/release-assets.md)
- [Provider successor evidence](../.agent-build/test-runs/release/provider-successor.md)
- [Accepted public-transition QA](../.agent-build/test-runs/release/public-transition-final-qa.md)

## Deterministic product-transition status

The production root-helper/runtime/SSH, signed host-installer authority, and public
pair/review/authorize/release implementations have an accepted deterministic product result:
**PRODUCT TRANSITION PASS**. The accepted transition QA totals are 305/305, including 174 Vitest
checks and 131 release seams. Final full CI passes the same 177/177 Vitest and 131/131 seams plus
fixtures, shell syntax, build, both smoke gates, and a production audit with no known
vulnerabilities.

This product pass does not mark any real installation, native platform, provider, SSH, human review,
signing ceremony, or customer release green. The external release verdict remains **NO-GO**. This
environment has no native C compiler, so it did not compile the four `rak-peer-cred` payloads or
execute them on Linux ARM64/x86-64 and macOS ARM64/x86-64. Those are external native-platform gates,
not failures of the passing deterministic product suite.

Do not fill the following items with fixture keys, injected adapters, self-signed certificates, or
test-only sockets:

- [ ] Verify a real root installation whose schema-v2 signed manifest contains the closed
      `hostHelper` section and whose fixed out-of-band release key emits the mode-`0400`
      `verified-host-helper.txt` record.
- [ ] Verify the exact native Node/peer payload for Linux ARM64/x86-64 or macOS ARM64/x86-64 is
      staged root-only, rehashed before use, installed without checkout TOCTOU, and then verified.
- [ ] Verify the exact dedicated UID/GID 62345 account/group closure, fixed socket, client key,
      configuration, journal, transfer root, and native peer verifier on the real host.
- [ ] Verify helper crash/restart reconciliation, idempotent replay, exact emergency stop, and
      zero-residue recovery without journal edits or broad deletion.
- [ ] Verify the production isolated-runtime sequence through `request-guard.issue`, the root-owned
      catalog, fixed external signer, signed firewall/request guard, secret broker, and cleanup.
- [ ] Verify a production SSH run and interrupted-run recovery through the registered read-only
      handle and fixed transfer import/release path.
- [ ] Verify the public `pair`, five-kind `review`, distinct `authorize`, and fresh `release`
      transition against the frozen production configuration, including negative/replay cases.
- [ ] Verify macOS service sandbox/hardening parity or retain an explicit platform limitation; fixed
      launchd identity/arguments alone do not prove parity with Linux systemd hardening.

## Mandatory real release gates

Every unchecked item is a hard block. Run each check against the same immutable, signed candidate
and retain digest-bound evidence.

### Signed release authority and supply chain

- [ ] Stage the exact per-architecture tool archives and separately digest-bound extracted
      executables.
- [ ] Supply complete tool and image SBOMs, provenance, licenses, and current vulnerability scans.
- [ ] Supply signed immutable Codex, Claude Code, acquisition, browser, scanner, and support image
      records for Linux AMD64 and ARM64. The browser image contains the pinned Playwright and
      Chromium versions and runs as non-root.
- [ ] Complete the protected Ed25519 signing ceremony and verify the exact manifest/toolchain
      digests with the published release public key.
- [ ] Install the release public key out of band at
      `/etc/repo-assessment-kit/release/release-signing-public-key.pem`, root-owned, non-symlink,
      mode `0444`; run the root verifier with `--emit-host-helper-record` and no trusted-key
      override.
- [ ] From a clean offline installation, make `scripts/verify-release-assets.mjs` return the
      authentic `verified:true` immutable image mapping. The current inventory is `unavailable`,
      `verified:false`, with 52 blockers.
- [ ] Rerun CI, dependency audit, secret scanning, and supply-chain checks on the final frozen tree
      after all integration changes.

### Native containment and target runtime

- [ ] The installer verifies the signed mode-`0400` host-helper record and all root-owned staged
      payload hashes before mutation or execution, installs only staged bytes, and never starts or
      enables the service.
- [ ] The helper service is installed as root from verified immutable paths; the launcher runs as
      the configured nonzero client UID/GID with no sudo/root fallback.
- [ ] The socket and 32-byte client key are mode `0600`; configuration/public keys/catalogs are
      root-owned configured-client-group mode `0440`; helper journal is root-owned mode `0700`;
      transfer root is root-owned mode `0710`.
- [ ] The native peer verifier is root-owned mode `0755`, digest/platform pinned, and proves client
      UID to service and UID 0 to client before framing/effects.
- [ ] Linux ARM64 native Lima/rootless-Docker containment passes.
- [ ] Linux x86-64 native Lima/rootless-Docker containment passes.
- [ ] macOS ARM64 native Lima/rootless-Docker containment passes.
- [ ] macOS x86-64 native Lima/rootless-Docker containment passes.
- [ ] Each platform proves no host Docker socket, unsafe mount/device/namespace access, LAN or
      metadata access, DNS bypass, provider-credential leakage, or residue.
- [ ] Each platform proves the signed firewall/request guard, secret broker, resource limits,
      cancellation, timeout, unresponsive-daemon handling, emergency stop, and cleanup attestation.
- [ ] `request-guard.issue` resolves only registered IDs from the root-owned immutable catalog,
      invokes the configured external signer, binds the running creation nonce/origins/fence, and
      exposes no generic signing or caller-selected routes/budgets/destinations.
- [ ] A safe runnable target completes applicable P0–P3 and browser controls using only disposable,
      least-privileged, non-production credentials.
- [ ] A deliberately non-runnable target completes the static path and records every runtime control
      honestly as blocked, not applicable, partial, or not tested with reason and follow-up.
- [ ] Hostile prompt, egress, mount, archive, race, output-flood, crash, quota, and credentialed
      covert-output cases pass without widening the frozen boundary.

### Source acquisition

- [ ] A real local read-only/frozen-working-tree run proves full before/after equality on the exact
      release deployment.
- [ ] A real SSH run uses a repository-scoped read-only deploy key, strict known hosts, bounded Git
      egress, immutable commit identity, and no key, configuration, agent-socket, or staging
      residue.
- [ ] `source.finalize` exports only the helper-derived fixed transfer containing mode-`0440`
      `snapshot.tar` and `manifest.json`; client validation/import and `source.release` leave zero
      transfer residue.
- [ ] Crash after acquisition, finalization, or import reconciles without a duplicate clone,
      caller-selected path, general SSH agent, or manual success claim.

### Provider and successor-package conformance

- [ ] Authenticated Codex login, networkless status, brokered task, cancellation, timeout, cleanup,
      and complete package dry run pass through `start-codex.sh`.
- [ ] Authenticated Claude Code login, networkless status, brokered task, cancellation, timeout,
      cleanup, and complete package dry run pass through `start-cc.sh`.
- [ ] Real runs prove that both providers consume equivalent bounded evidence views, exact closed
      author/reviewer proposal profiles, registered checks, budgets, and limitation contracts.
- [ ] Real independent reviewer proposals bind the exact admitted author-proposal digest;
      same-provider review is not counted as independent.
- [ ] The paired-run state binds both provider run identities and demonstrates equivalent required
      outcomes without requiring byte-identical prose.
- [ ] A successor ZIP generated from the real paired-provider outcomes passes strict in-process and
      fresh-process validation, while final-digest authority remains a separate signed transition.

### Package and independent review

- [ ] Public `pair` binds matching terminal Codex/Claude drafts, immutable input/run/receipt
      identities, foreign-provider reviews, reconciliation, successor ZIP, and zero-residue cleanup
      in one owner-private journal.
- [ ] Public `review` admits exactly one current signed record for each of independent security,
      independent decision, technical human, lay human, and customer acceptance, with distinct
      reviewer/key/record/nonce values.
- [ ] Public `authorize` admits one distinct release-authority signature that binds every required
      review and release/platform/provider/SSH/cleanup certificate and rejects unresolved
      Critical/High boundary defects.
- [ ] Public `release` freshly reopens and validates the exact successor and writes only the
      digest-bound authorization sidecar; it never relabels or rewrites the draft ZIP.
- [ ] The exact signed candidate produces a complete customer ZIP accepted by
      `scripts/verify-package.mjs`; a rejected draft is not positive evidence.
- [ ] Optional encryption uses signed `age` authority, followed by independent decrypt, ZIP reopen,
      checksum, and manifest verification.
- [ ] Independent security and decision reviews bind the exact final package digest and leave no
      unresolved Critical or High defect.
- [ ] Independent technical-human review confirms finding/evidence traceability and reproduction.
- [ ] Independent lay-human review confirms the package can be understood without translation.
- [ ] Customer/product-owner acceptance confirms the source, workflows, unknowns, recommendation,
      limitations, and required decision for the exact final package.
- [ ] Accessibility, platform, incident-response, crash/cancel, migration, quota, and recovery
      evidence is complete for the signed candidate.
- [ ] A separate authorized release owner issues the final digest-bound authorization record.

## Handoff rule

If any mandatory item remains unchecked, the only permitted verdict is:

**P7 CUSTOMER RELEASE NO-GO / BLOCKED**

Do not sign, rename, relabel, or deliver a draft as a customer release. Re-run this checklist after
the candidate is frozen; do not carry forward evidence from a different digest, provider run,
platform build, package, or reviewer record.

Authorization record: **NOT ISSUED**

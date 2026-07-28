# P7 release orchestrator self-assessment

Date: 2026-07-28 UTC

Verdict: **DRAFT VALIDATED; CUSTOMER RELEASE BLOCKED.**

## Immutable input

The target has no repository `HEAD`, so this run assessed a fresh committed mirror at
`generated/p7-self-assessment/source-mirror-final2`. Generated output, Git metadata, dependencies,
build output, prior test artifacts, environment files, and logs were excluded. This mirror is
evidence for the kit's self-assessment, not the target's missing Git identity.

- Registered mirror commit: `e4529f391591a5437e216590320fe701bd11c1b7`
- Registered tree object: `3a0042fee510d0b45c1ee9bb605a5baaaf949373`
- Snapshot manifest: `sha256:d8bc0ab33aec4abd3880a5209eaa99a796acf50eba06c80fd7f1c80a11d93bac`
- Snapshot payload: `sha256:7578d980dac29565207d177854caa792b06c652a8577e82eda695a78a5daf6e0`
- Deterministic analysis-mirror commit: `684d087fbdef9c9dcc8c5f98401f7527d62d55ed`
- Analysis identity: `sha256:348a9087a687150278d61e36c33126e6e1fffb7ba6dab45ac69bfe0fbe5376ca`
- Discovery: `sha256:b2dfc6846492017049615e7645888dc55a2d8ef0869e7dfd54e7ab284db6347b`

The no-follow helper captured and froze the source before analysis. Offline assessment received only
the read-only snapshot plus external private Git metadata. The helper reverified the snapshot around
indexing, offline analysis, provider work, and packaging. A final no-copy identity capture exactly
matched the admitted payload; cleanup reported no residue.

## Observed run

```text
node scripts/run-release-assessment.mjs run \
  --provider codex \
  --config generated/p7-self-assessment/config.json
```

- Run ID: `run_9f6bbb11-927f-7344-ab57-c36006fa164f`
- Status: `DRAFT_VALIDATED_RELEASE_BLOCKED`
- Config/source, offline draft, and package validation: `PASSED`
- Provider tasks: `LIMITED`
- Draft ZIP entries: 113
- Draft ZIP: `sha256:bb9b89172a88b38b163643468862fcdd9ae3fd88063852d4d3553fb0915b9ee3`
- Package manifest: `sha256:b432510554cb10bf60600d4062aa757596f4ad3cb87a7818fbd69267ad347867`
- Journal: `sha256:0166be8344cd2b5c25569f73d4288063d5526e3771e596d5008f284256cd2809`
- Immutable verification receipt:
  `sha256:6c09034bf147cd3c3ddd361dd4483cd0a007b785b160f10a0bb7952df115e2d7`
- Cleanup: `verified`, zero residue

Production correctly failed closed at provider execution because no trusted provider-egress
signer/enforcer, authenticated provider home, or pinned isolated executor was provisioned. Reviewer
tasks were not admitted without their exact author-proposal prerequisite. No provider proposal,
independent review, cross-provider equivalence, or customer authorization is claimed.

## Focused verification

- Release integration: **11/11 PASS**
- Immutable snapshot/no-copy identity: **11/11 PASS**
- Provider successor package: **18/18 PASS**
- Closed provider task, broker, and successor Node tests: **50/50 PASS**
- Agent-adapter and release-run Vitest: **26/26 PASS**
- Focused typecheck, ESLint, and Prettier: **PASS**

Coverage includes snapshot-only child routing, dirty/untracked same-path byte drift, no-copy
completion identity, stale broker-authority rejection after cancellation, run/resume cleanup fencing
and residue blocking, immutable receipt replay, successor tamper/truth checks, seeded
secret/path/active-content/compliance attacks, and complete external-readiness fixtures. An injected
actual-broker seam produced seven of seven closed task-specific proposals and a freshly validated
`DRAFT_VALIDATED_RELEASE_BLOCKED` successor with no quarantined proposal digest. This proves the
typed product path, not real provider inference, organizational independence, or release authority.

## Reopened production boundary (not part of the observed run)

After the observed run above, the candidate gained the fixed root-helper installation/service
boundary, dedicated public client UID/GID and modes, pinned native peer verifier, helper-derived
snapshot transfer directories, trusted SSH run/recovery, isolated runtime with `request-guard.issue`
through a root-owned catalog and fixed external signer, and the public `pair`, five-kind `review`,
distinct `authorize`, and fresh `release` transition.

The later signed installer authority also binds a schema-v2 manifest `hostHelper` section, the fixed
out-of-band release key, root-only `--emit-host-helper-record`, a mode-`0400` verified authority
record, exact native payload directories, root-owned staged rehashing before use, UID/GID 62345
account/group closure, and no automatic service start or enable.

Those paths were not exercised by this historical self-assessment. Later accepted deterministic
product-transition QA passes 305/305 checks, including 174 Vitest checks and 126 release seams. The
final full CI passes 174/174 Vitest, 126/126 release seams, fixtures, shell syntax, build,
foundation smoke, and security smoke; the production audit reports no known vulnerabilities. The
deterministic pass cannot substitute for a real root-installed deployment, native platform run,
provider execution, signed authority, independent reviewer, or customer acceptance. This environment
has no native C compiler, so it did not compile or execute the peer verifier across the four
required platform/architecture combinations. macOS must also prove native sandbox/hardening parity;
the fixed launchd definition alone is insufficient.

## Remaining release gates

Customer release remains blocked pending real Codex and Claude paired runs, distinct-provider
reviewer proposals bound to author proposal digests, independent human/security/decision/lay review,
official full-schema validation, signed release assets, runtime/platform certificates, trusted
repository-scoped SSH evidence, a real root install and native-platform exercise, and final release
authorization. The public proposal contract now selects and enforces closed author/reviewer
profiles; nonconforming task content remains quarantined.

# P7 provider successor package verification

Date: 2026-07-28  
Scope: `scripts/provider-successor-package.mjs`, the closed provider proposal contract, and the
injected broker/orchestrator integration seam  
Verdict: **PASS for the deterministic successor-package and blocked-draft integration contracts;
customer release remains blocked pending real paired providers and independent authorities.**

## Implemented boundary

- Accepts only bounded normalized Codex/Claude outcomes whose proposal identity, digest,
  attempt/fence, admitted evidence view, claim schema, limitation schema, and evidence references
  are current.
- Treats arbitrary provider `content` as untrusted. Unknown members, invalid types, object bombs,
  active content, and evidence mismatches are rejected before package creation. Secret, host-path,
  and compliance-overclaim strings are redacted in the closed derivative and are not copied from
  the raw proposal.
- Derives provider activities and evidence occurrences per admitted proposal. New successor
  artifacts carry those provider provenance IDs. Verified base eligibility is preserved per entry;
  there is no unrelated fallback eligibility.
- Requires independent-review proposals to bind an admitted author proposal digest. Same-provider
  reviews remain visible but are not independent. Required cross-provider outcomes and limitations
  are reconciled by task contract rather than prose or ZIP equality.
- Creates a new deterministic successor ZIP without changing or relabeling its verified base.
  The base stays open through a no-follow file descriptor and is rechecked by inode, size, and
  digest.
- Constrains output to an existing canonical, owner-private directory. ZIP and detached digest use
  exclusive no-follow creation plus file and directory `fsync`; existing finals are never
  overwritten.
- Reopens and validates the ZIP in-process and in a fresh process. Manifest, checksum, inventory,
  strict JSON, size, path, secret/host-path/active-content, eligibility, readiness, and
  reconciliation truth are checked.
- A successor ZIP is always `DRAFT_VALIDATED_RELEASE_BLOCKED` with
  `customerReleaseAuthorized:false`. Because a ZIP cannot embed authority bound to its own digest
  without circularity, its embedded readiness lists all authorities as blocked. Final-digest
  certificates are evaluated externally after creation.
- Production omission of an authority verifier always returns unauthorized. The only fixture
  authority is an explicit `mode:"fixture-test-only"` injection. Full fixture authorization
  requires nine current, digest-bound records: independent security, independent decision,
  technical human, lay human, cross-provider equivalence, official schemas, signed assets,
  runtime platform, and final release authorization.

## Focused evidence

Commands run from the target root:

```text
node --check scripts/provider-successor-package.mjs
pnpm exec eslint scripts/provider-successor-package.mjs scripts/provider-successor-package.test.mjs --max-warnings 0
node --test scripts/provider-successor-package.test.mjs
```

Results:

- syntax: PASS
- focused ESLint: PASS, zero warnings
- Node tests: **18 passed, 0 failed**

The suite covers deterministic creation, base immutability, real successor provenance, AWS access
key/private-key/host-path/compliance redaction and exclusion, active HTML, arbitrary members,
object bombs, evidence mismatch, same-provider review, byte tamper, self-consistent release-truth
tamper, duplicate JSON members with recomputed checksums, exclusive finalization, production
missing authority, complete fixture authority, and stale/mismatched/duplicate records.

## Integration evidence and remaining gate

The orchestrator now selects one of two closed, release-owned proposal profiles. Author content is
limited to evidence-bound claims and limitations. Reviewer content must bind the exact admitted
author proposal digest carried by both its task and run context. The task runner, adapter,
orchestrator, and successor builder revalidate the selected role/profile and quarantine a generic
object or binding mismatch.

The injected actual-broker integration produced seven of seven validated task outcomes, generated a
fresh successor ZIP, reopened it successfully, reported zero quarantined proposal digests, and
retained `DRAFT_VALIDATED_RELEASE_BLOCKED` with `customerReleaseAuthorized:false`. The closed
provider task/broker/successor Node suites pass 50/50; the adapter/release-run Vitest suites pass
26/26.

This does not establish real provider or independent-review evidence. A single-provider successor
remains a blocked draft, and same-provider review is not counted as organizational independence.
Cross-run use still requires an explicit `run.providerRunIds` set plus
`aggregationProfile:"rak-paired-provider-runs/1.0.0"`. Customer release remains prohibited until
real Codex and Claude runs, distinct independent and human reviews, signed assets, native runtime
certificates, and final-digest authorization are present.

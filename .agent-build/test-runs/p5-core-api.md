# P5 core/API final stable QA

Date: 2026-07-28 UTC  
Scope: final stable fixes in contracts, workflow, persistence, local acquisition, and
loopback server. Product code was read-only.

## Final verdict

**PASS for the deterministic core/API acceptance slice.**

Every requested final blocker is fixed and reproduced:

- active cancellation revokes stored secret metadata and zeroizes/removes in-memory values
  before cleanup completes and the run becomes `CANCELLED`;
- clarified DRAFT cancellation revokes uploaded/pending inputs, emits a bounded warning,
  remains `DRAFT`, and creates no cleanup record;
- OpenAPI contains all 39 frozen operations with strict bodies, filters, responses, no
  generic `JsonResponse`, and compiled materialized schemas;
- the committed four-migration chain is verified and exclusively applied with
  `user_version`, per-file digests, chain digest, unknown/downgrade refusal, and verified
  pre-upgrade backup;
- evidence/package responses have the required nosniff, CORP, CSP, no-store and attachment
  headers as applicable;
- local acquisition rejects escaping/absolute symlinks and leaves source status unchanged;
- the pinned loopback authority rejects a matching evil Host/Origin pair while accepting
  the configured proxy-shaped loopback authority.

Trusted SSH acquisition, native runtime/provider execution, real evidence admission, and
real package generation remain explicit P7 gates and are not claimed as passed here.

## Commands and results

```sh
pnpm --filter @rak/contracts --filter @rak/workflow \
  --filter @rak/persistence --filter @rak/server typecheck
pnpm exec vitest run packages/contracts/src/contracts.test.ts \
  packages/workflow/src/workflow.test.ts \
  packages/persistence/src/persistence.test.ts \
  apps/server/src/app.test.ts apps/server/src/local-acquisition.test.ts
pnpm --filter @rak/contracts --filter @rak/workflow \
  --filter @rak/persistence --filter @rak/server build
```

Result:

```text
typecheck: PASS
build: PASS
Test Files: 5 passed (5)
Tests: 23 passed (23)
```

## Acceptance matrix

| Check | Result | Evidence |
|---|---|---|
| Active cancellation secret cleanup | **PASS** | Test uploads an active secret, progresses to EXECUTING, cancels, verifies attempt fence 2/CANCELLED, cleanup COMPLETE, secret metadata REVOKED, and run CANCELLED. Code calls `revokeRunSecrets`, `Buffer.fill(0)`, removes values and upload tokens, then queues cleanup. |
| DRAFT cancellation clarification | **PASS** | Architecture §12.2 and DECISIONS specify remain-DRAFT behavior. Test verifies 202 with `acceptedState=DRAFT`, warning event, all uploaded/pending handles REVOKED, pending upload token invalid, and zero cleanup rows. |
| Cleanup ordering/terminalization | **PASS** | Active cleanup follows secret revocation, cancels attempts/increments fences, records COMPLETE/no residues, then transitions `CANCELLING -> CANCELLED`. |
| Strict 39-operation OpenAPI | **PASS** | 37 paths / 39 operations; no `JsonResponse`; discovery/approval bodies are strict refs; controls/findings/evidence expose exact frozen filters; action headers/bodies are refs; SSE includes 410. |
| Strict component/public schemas | **PASS** | 37 OpenAPI component schemas; recursive test requires `additionalProperties:false` on every object. Sixteen `schemas/rak/1.0/*.json` documents compile independently under strict Draft 2020-12 AJV. |
| Verified committed migration chain | **PASS** | `RakStore` reads the committed SQL files, SHA-256 verifies recorded per-file entries, uses `BEGIN EXCLUSIVE`, records four `migration:*` rows plus chain/schema metadata, and sets `user_version=4`. No `CREATE TABLE`/`ALTER TABLE` authoritative DDL remains in runtime persistence code. |
| Unknown/downgrade/tamper refusal | **PASS** | Committed test rejects altered migration digest. Direct probe rejects nonempty DB without metadata as `MIGRATION_STATE_UNKNOWN` and rejects metadata/user-version mismatch as `MIGRATION_VERSION_MISMATCH`. |
| Pre-upgrade backup | **PASS** | Direct v3 fixture upgraded to v4, recorded one `startup-*` backup, and retained its path/digest. Backup path is integrity-checked before migration proceeds. Manual `backupTo` also verifies integrity and SHA-256. |
| Persistence invariants/reopen | **PASS** | WAL, FK, busy timeout, FULL sync, quick/integrity check, reopen, CAS/event transaction, terminal immutability through the sole writer, snapshot/attempt/cleanup persistence all pass focused tests. |
| Evidence preview headers/schema | **PASS deterministic** | Strict escaped-text/reencoded-image union plus validated/redacted occurrence gate. Responses include nosniff, `Cross-Origin-Resource-Policy: same-origin`, restrictive CSP and no-store. |
| Evidence attachment integrity/headers | **PASS deterministic** | Strict metadata, byte-length and SHA-256 verification; attachment disposition, nosniff, CORP, CSP and no-store. Real evidence admission remains a P7 gate. |
| Package validation/download | **PASS deterministic** | Certificate digest, run revision/state, artifact digest and length are bound before VALIDATED admission; download rechecks file bytes. Digest/download include nosniff, CORP, CSP and no-store; ZIP is attachment-only. Real package generation remains a P7 gate. |
| Escaping/absolute symlink safety | **PASS** | Resolver rejects absolute symlink targets and resolved targets outside the registered repository with `SOURCE_SYMLINK_UNSAFE`; focused escaping-symlink fixture verifies source Git status unchanged. |
| Local immutable source | **PASS deterministic/production local** | Real Git fixture produces commit-bound archive, equal before/after source digests, dirty-path exclusion and unchanged source status. Production entry point registers the real root and local resolver when configured. |
| SSH honesty | **PASS as gated behavior** | Local resolver rejects SSH with `SSH_ACQUISITION_WORKER_REQUIRED`; API surfaces the limitation ID rather than pretending acquisition succeeded. Trusted SSH execution remains P7-gated. |
| Host/Origin boundary | **PASS** | Evil `Host: evil.example` plus matching evil Origin is rejected 403 even at bootstrap. Configured `http://127.0.0.1:4173` Host/Origin succeeds for bootstrap and mutation. Missing origin and mismatched authority remain rejected. |
| SSE replay/live/410 | **PASS deterministic** | Numeric Last-Event-ID validation, retained replay, subsequent live polling, 15-second heartbeat, and expired-history 410 with canonical refetch instructions are tested. |

## Defects

No remaining defects found in the requested stable core/API recheck.

## P7 gates not claimed

- real typed SSH acquisition and credential/agent isolation;
- native host/runtime broker and sentinel endpoint tests;
- real provider-driven assessment execution;
- production evidence admission/redaction/re-encoding;
- real independent/human review execution;
- real report/package generation, manifest/checksum and ZIP reopen;
- platform and interruption/restore matrix.

These are unverified release gates, not silent passes.

## Files written

- `.agent-build/test-runs/p5-core-api.md`

No product code or committed tests were modified.

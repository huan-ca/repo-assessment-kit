# P5/P6 final security and safety review

Date: 2026-07-28 UTC  
Scope: final integrated P5/P6 implementation, specifications, and available P4/P5/P6
evidence. Product code was read-only during this review.

## Verdict

**P5/P6 deterministic implementation: PASS.**

No unresolved Critical, High, Medium, or Low security defect remains in the reviewed P5/P6
tree. The defects found during this review were remediated and adversarially rechecked.

**Customer/product release: NO-GO / BLOCKED at P7.**

This pass proves deterministic enforcement seams and fail-closed behavior in the current
Linux ARM64 sandbox. It does not provide the native, real-provider, real-SSH, external-tool,
encryption, or human review evidence required by `PLAN.md` P7 and `safety.md` section 19.
The launchers fail closed here because Docker is unavailable; neither produced a customer
package. No release claim is authorized.

## Threat model and privacy disposition

The primary assets are hostile customer source/Git history, SSH and provider credentials,
sandbox secrets, discovery claims, quarantined tool/provider output, admitted evidence,
operational audit, and customer packages. The material attackers are malicious repository
content, compromised analyzers/providers/targets, browser/DNS-rebinding origins, a local
untrusted process, package-content injection, dependency compromise, and accidental
operator over-authorization.

The product is not directed at children and no special kids/health/financial regime is
claimed. Customer repositories can contain personal data, confidential code, credentials,
and trade secrets. The design supports—but does not establish compliance with—GDPR/UK GDPR
Articles 5, 25, and 32 through local-first processing, minimization, explicit external-flow
approval, storage limitation, and security controls. Controller/processor roles, lawful
basis, transfers, CCPA/CPRA, sector rules, export restrictions, and contractual obligations
remain customer/legal determinations.

The implemented offline path performs local static inspection and emits a release-blocked
draft. Telemetry is not present. Provider, SSH, optional-service, and dynamic-runtime data
flows remain fail-closed or require future P7 proof; therefore this review does not claim
that real external processing has met disclosure, retention, transfer, or deletion duties.

## Ranked findings

### Critical

None unresolved.

### High

None unresolved.

### Medium

None unresolved.

### Low

None unresolved. A raw-Host canonicalization weakness discovered in the final recheck was
fixed before this report was frozen; see resolved finding R6.

## Resolved must-fix findings

| ID | Severity before fix | Location | Exploit or harm | Remediation and recheck |
|---|---|---|---|---|
| R1 | High | `apps/server/src/local-acquisition.ts:72-77,129-205` | A tracked symlink such as `escape -> ../../outside-secret` was admitted, allowing a hostile repository to reach outside the acquisition root. The prior before/after proof also omitted HEAD/index/status state. | Acquisition now rejects absolute/escaping symlink targets and binds commit, index, status, manifest, and entry state before/after. The escaping-symlink regression passes and source state remains unchanged. |
| R2 | High | `apps/server/src/app.ts:143-163,238-253` | API/bootstrap requests originally accepted arbitrary Host/Origin values, enabling localhost/DNS-rebinding trust-boundary abuse. | Startup accepts only loopback public origins with no credentials/path/query/fragment. API requests require an exact raw configured authority and exact supplied Origin. Evil Host/Origin requests return 403; the configured proxy authority succeeds. |
| R3 | High | `apps/server/src/app.ts:850-877`; `packages/persistence/src/index.ts:702` | Cancellation could reach a terminal state while uploaded secret bytes and pending upload tokens remained usable. DRAFT cancellation also conflicted with the frozen state contract. | Cancel atomically revokes run secret metadata, zeroizes and deletes in-memory values, deletes pending tokens, and queues cleanup only for active states. DRAFT remains DRAFT and emits a warning/audit event. The secret lifecycle regression passes. |
| R4 | High | `packages/packaging/src/index.ts:896-1139` | Package staging trusted artifact labels and could not prove that credential-tainted O1/O2 output was excluded or that an O4 summary derived from a valid O3 fact. A malicious caller could relabel tainted output. | Eligibility is derived from frozen evidence/activity proof; O1/O2 fail closed. O3 requires release-owned fixed-schema validation and technical review. O4 requires a full validated O3 parent proof, exact evidence/review reconciliation, and manifest/certificate binding. Forged O1/O2/O4 regressions pass. |
| R5 | High | `pnpm-workspace.yaml:24-25`; manifests and `pnpm-lock.yaml` | The production graph initially contained one Critical and multiple High known advisories, including direct vulnerable packages. | Unused vulnerable dependencies were removed; Fastify is pinned to 5.8.5 and Drizzle ORM to 0.45.2 with a regenerated lockfile. `pnpm audit --prod --audit-level high` reports no known vulnerabilities. |
| R6 | Low | `apps/server/src/app.ts:143-163,238-253`; `apps/server/src/app.test.ts:123` | URL-parsing the Host header accepted `evil@localhost:4173` because userinfo was stripped before comparison. This was not a normal browser DNS-rebinding path, but it violated the exact authority boundary and could be unsafe behind an unusual proxy. | The server now compares the raw authority against a canonical allowlist and exact-matches supplied Origin. Userinfo, encoded-host, arbitrary-host, and userinfo-origin probes return 403; trusted `localhost:4173` returns 204. |

## Control review

| Boundary | Result | Evidence |
|---|---|---|
| Signed dynamic authority | PASS deterministic / P7 native proof pending | `packages/runtime/src/control-plan.ts:397-478,494-655` validates canonical signed bytes, Ed25519 domain/key, authority and budget bindings, replay, durable admission, exact dispatch, result binding, revocation, and reconciliation. It fails closed without the trusted signer or native broker. The repository contains only the parseable Ed25519 public key outside deliberate test strings. |
| Persistence and migrations | PASS deterministic | `packages/persistence/src/index.ts:92-193` verifies and applies the committed migration chain, records digests/version, backs up before migration, and refuses inconsistent state. Focused persistence and complete CI tests pass. Native crash/restore/interruption evidence remains P7. |
| Session/origin/secrets | PASS deterministic | One-use bootstrap token comparison is timing-safe; the cookie is HttpOnly and SameSite=Strict (`apps/server/src/app.ts:300-323`). Raw Host and supplied Origin are pinned. Secret values are memory-only, one-use, revocable, zeroized on cancel, and absent from SQLite/package output. |
| Source acquisition | PASS local deterministic / SSH blocked | Local acquisition rejects escaping links and binds full immutable source state. SSH explicitly fails with `SSH_ACQUISITION_WORKER_REQUIRED`; no real SSH claim is made. |
| Provider adapter/runner | PASS deterministic / real provider blocked | The shared typed capsule and fixed runner reject unknown fields, arbitrary commands, capability/network expansion, source paths, stale deadlines, oversized output, and provider mismatch. Timeouts kill the process group (`container/provider-task.mjs:296-351`). Direct provider launch remains unavailable without the trusted Docker/native path. |
| Evidence/analyzers | PASS bounded static slice | Evidence admission redacts recognized secrets and host paths before hashing/storage and rejects unsafe paths (`packages/evidence/src/index.ts:105-285`). Analyzer tests cover malformed and hostile fixture inputs. Secret scanning is not treated as proof of absence. Official complete schemas and external scanners remain P7. |
| Reporting/package | PASS deterministic | Reporting escapes hostile text and rejects unsupported claims/active content. Packaging validates locked HTML/CSP/CSS, strict paths and limits, final redaction, full provenance eligibility, certificate chain, checksums, and a fresh-process ZIP reopen. Encryption correctly reports unavailable instead of simulating success. |
| Offline assessment | PASS release-blocked draft | Source digest is compared before/after (`scripts/run-offline-assessment.mjs:866-904`); unsafe paths are rejected; target code, hooks, package managers, and configuration are not executed. Output remains `DRAFT_VALIDATED_RELEASE_BLOCKED` with `customerReleaseAuthorized: false` (`scripts/run-offline-assessment.mjs:1241-1242`). |
| P6 browser/UI | PASS deterministic and browser evidence | Bootstrap is read from the URL fragment and immediately cleared (`apps/web/src/api.ts:40-44`); no local/session storage is used. React rendering escapes source text. Secret state is cleared before upload and only the handle is rendered. Live and preview truth are explicitly separated. P6 browser evidence records desktop/mobile/focus/live/preview flows; final human accessibility and platform sign-off remain P7. |
| Dependency/supply chain | PASS current audit / P7 provenance pending | Production audit reports zero known vulnerabilities. CI verifies workspace boundaries and reproducible lock use. Image digests, multi-architecture builds, SBOM/provenance, licenses, and independent tool-image review remain release gates. |

## Verification evidence

Final corrected-tree commands:

```text
pnpm run ci
  PASS: formatting, lint, boundaries, typecheck, build, fixtures, shell checks, smoke
  PASS: Vitest 16 files, 132/132 tests
  PASS: provider runner 10/10 tests

pnpm exec vitest run \
  apps/server/src/local-acquisition.test.ts \
  apps/server/src/app.test.ts \
  packages/runtime/control-plan.test.ts \
  packages/agent-adapters/adapter.test.ts \
  packages/evidence/test/index.test.ts \
  packages/reporting/test/index.test.ts \
  packages/packaging/test/index.test.ts \
  tests/offline-assessment.integration.test.ts --reporter=verbose
  PASS: 8 files, 69/69 tests

node --test container/provider-task.test.mjs
  PASS: 10/10 tests

pnpm audit --prod --audit-level high
  PASS: No known vulnerabilities found

openssl pkey -pubin -in release/network-attestor-public-key.pem -text_pub -noout
  PASS: valid Ed25519 public key
```

Adversarial raw authority probe against the final built server:

```text
arbitrary Host evil.example                  403
userinfo Host evil@localhost:4173            403
encoded Host %6cocalhost:4173                403
userinfo Origin http://evil@localhost:4173   403
trusted Host/Origin localhost:4173           204
```

Private-key marker scan outside fixtures/docs found only deliberate hostile test strings in
`packages/evidence/test/index.test.ts` and `packages/packaging/test/index.test.ts`; no
signing or private key material was found in release/product sources.

Both release launchers exited fail-closed with code 69 because Docker is unavailable in
this environment. That is safe behavior, not provider/native release evidence.

## P7 blocking evidence gaps

These are not unresolved deterministic P5/P6 code defects. They are mandatory release
evidence and capability gates. Customer/product release remains **NO-GO** until all pass:

1. Native macOS and Linux, ARM64 and x86-64 Docker/Lima/rootless/cgroup/firewall/request-
   guard/emergency-stop/residue matrix, including no host socket and no bypass.
2. Real pinned Codex and Claude Code login/dry runs with equivalent validated customer ZIPs,
   provider compartment, OS/network/MCP/credential canaries, timeouts, and cleanup.
3. Real typed SSH acquisition with trusted signer/helper, approved Git-host egress,
   ephemeral private-key isolation, hostile repository fixtures, and no SSH residue.
4. Real safe dynamic target and browser fixtures for P0-P3 authorization, request guarding,
   opaque/trusted endpoint behavior, credential/output covert-channel controls, and O2/O3/O4
   enforcement under actual credentialed execution.
5. Official complete native, SARIF, and CycloneDX schemas and external scanner/tool database
   execution for all supported ecosystems, with pinned versions and honest reduced coverage.
6. Multi-architecture images plus locked digests, SBOM, provenance, licenses, redistribution
   review, and no unaccepted Critical/High dependency or image vulnerability.
7. Real `age` encryption/decryption/recovery, passphrase/key lifecycle, loss and cleanup
   exercises. The present fail-closed unavailable seam is not sufficient.
8. Real customer-repository packages and technical, lay, consultant, independent decision,
   and security review; complete accessibility/platform/customer sign-off and release
   checklist.
9. Incident, cancellation, crash, migration/restore interruption, quota exhaustion,
   unresponsive guest, and externally enforced emergency-stop exercises on the real native
   stack.

## Residual risks requiring disclosure

Even after P7, selected approved source content is visible to the chosen provider; approved
opaque endpoints can remain an exfiltration channel; hypervisor/kernel/provider compromise
can defeat bounded isolation; a hostile target can deny service inside its envelope;
credentialed outputs retain covert-channel risk; checksums prove integrity relative to a
digest rather than authorship; redaction/secret scanners cannot prove absence of unknown
sensitive or personal data; and static/passive assessment cannot establish runtime
security, business-logic correctness, legal compliance, or absence of vulnerabilities.

The product must continue to describe this as **bounded isolation**, disclose exact external
flows and non-executed controls, and never turn a missing P7 proof into a silent fallback or
clean/pass result.

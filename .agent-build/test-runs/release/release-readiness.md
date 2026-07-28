# P7 final release-readiness assessment

Date: 2026-07-28 UTC  
Decision scope: current candidate and evidence set  
Authorization: **not issued**

## Verdict

**P7 CUSTOMER RELEASE NO-GO / BLOCKED**

The candidate has substantial deterministic, fail-closed, and limited real-component evidence. It
now includes the production root-helper/runtime/SSH boundary and public
pair/review/authorize/release transition. Accepted deterministic product-transition QA passes
305/305 checks, including 174 Vitest checks and 126 release seams. It still does not have the signed
runtime and tool authority, four-platform native evidence, real SSH acquisition, paired
authenticated Codex and Claude Code dry runs, signed customer package, or independent human/customer
review required by P7. No current evidence authorizes customer release.

All available packages and receipts correctly remain `DRAFT_VALIDATED_RELEASE_BLOCKED` with
`customerReleaseAuthorized:false`.

## Evidence reconciliation

This assessment read the frozen P7 contract and the current:

- `self-assessment.md`;
- `security-review.md`;
- `adversarial-matrix.md`;
- `release-assets.md`;
- `layman-review.md`; and
- `provider-successor.md`;
- `product-boundary-final-qa.md`; and
- `public-transition-final-qa.md`.

Where an earlier report retains audit-history findings, a finding is treated as resolved only when a
later focused recheck identifies the exact correction and a passing reproduction. A resolved
implementation defect does not clear its separate real-world release gate.

The final provider-contract freeze supersedes the older generic-proposal integration finding: exact
closed author/reviewer profiles completed all 7/7 injected brokered tasks, bound reviewer input to
the author proposal, produced a strictly validated `DRAFT_VALIDATED_RELEASE_BLOCKED` successor with
zero quarantined digests, and sanitized persisted error codes. Its focused verification passed 50/50
Node tests, 26/26 Vitest tests, lint, formatting, and type checks.

No injected broker, fake or fixture authority, temporary mirror, parser-only provider probe,
deterministic encryption fixture, automated copy check, or self-consistent draft ZIP is counted as
real Docker/Lima, SSH, provider inference, native-platform, signed-asset, independent-human, or
customer-release evidence.

## Reopened production-path status

The candidate now contains the fixed privileged-helper installation/service/socket/key/config and
native peer-verification boundary, public non-root UID/GID and file-mode enforcement, helper-derived
transfer directories, trusted SSH run/recovery, root-catalog and external-signer
`request-guard.issue` runtime flow, and public `pair`, five-kind `review`, distinct `authorize`, and
fresh `release` transition.

The signed host-installer authority adds a schema-v2 manifest `hostHelper` section, the fixed
out-of-band `/etc/repo-assessment-kit/release/release-signing-public-key.pem`, root-only
`--emit-host-helper-record`, the fixed mode-`0400` verified record, four exact native payload
directories, root-owned staging/rehash before use, exact UID/GID 62345 account/group closure, and an
installer that never starts or enables the service.

Accepted deterministic product-transition QA is green at 305/305, including 174 Vitest checks and
126 release seams. Final full CI passes 174/174 Vitest, 126/126 release seams, fixtures, shell
syntax, build, foundation smoke, and security smoke; the production audit reports no known
vulnerabilities. The deterministic pass is not evidence of a real root installation, native runtime,
trusted SSH/provider execution, external signer/reviewer, or customer authorization.

## Deterministic and limited observed evidence

| Area                                                        | Result                                        | Scope of the result                                                                                                                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final frozen-tree CI after signed installer authority       | **Pass**                                      | 174/174 Vitest, 126/126 release seams, fixtures, shell syntax, build, foundation smoke, and security smoke pass; production audit reports no known vulnerabilities                                                  |
| Accepted deterministic product transition                   | **Pass**                                      | 305/305 accepted checks: 174 Vitest and 126 release seams; covers the closed product transition and signed installer authority but not real external deployment                                                     |
| Closed launcher/config and fail-closed behavior             | **Pass**                                      | Exact verbs, strict JSON, unsafe argument/source/output rejection, no direct-provider fallback                                                                                                                      |
| Immutable local snapshot, journal, resume, cleanup, receipt | **Pass**                                      | Release-run 11/11 and immutable helper/identity 11/11; the final release-seam aggregate passes 61/61                                                                                                                |
| Static evidence/analyzer/report/package path                | **Pass at declared deterministic depth**      | Seven ecosystems, strict references and coverage, official/kit export validation, manifest/checksum/ZIP/tamper gates                                                                                                |
| Self-assessment mirror                                      | **Pass as a blocked draft**                   | Validated 113-entry draft, immutable bindings, zero cleanup residue; mirror identity used because the checkout had no `HEAD`                                                                                        |
| Live local UI/API/browser slice                             | **Pass after focused fixes**                  | Discovery, secret clearing, persistence, viewport/zoom, live region, and authority checks in the available loopback environment                                                                                     |
| Report lay-language regression                              | **Pass for fresh automated fixture evidence** | Earlier unsupported urgency, missing decision context, machine labels, and unclear links were corrected and rechecked; this is not human/customer acceptance                                                        |
| Provider author/reviewer and successor path                 | **Deterministic integration pass**            | Exact closed profiles, 7/7 injected brokered tasks, safe author/reviewer binding, zero quarantined digests, and validated blocked successor; combined focused verification passed 50/50 Node and 26/26 Vitest tests |
| Real `age` provider on Linux ARM64                          | **Observed slice pass**                       | Upstream v1.3.1 digest/version, encryption, independent recovery, and digest equality; test-shaped authority was not release eligible                                                                               |
| Release truth                                               | **Pass**                                      | No exercised path promoted a draft or set customer authorization true                                                                                                                                               |

## Acceptance status

| Criterion                                      | Result                                    | Reason                                                                                                   |
| ---------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| AC-1 Guided discovery                          | **Pass**                                  | Ten-topic live/deterministic evidence and explicit unknown effects                                       |
| AC-2 Controlled intake and immutability        | **Fail**                                  | Local deterministic path passes, but mandatory real trusted SSH acquisition and cleanup are absent       |
| AC-3 Complete static assessment                | **Pass**                                  | Required static domains and distinct security outputs exist with declared reduced depth                  |
| AC-4 Safe runtime assessment                   | **Fail**                                  | No real signed Docker/Lima containment or runnable hostile/safe target exercise                          |
| AC-5 Evidence, coverage, validation, redaction | **Pass**                                  | Current deterministic validators and hostile fixtures pass                                               |
| AC-6 Modernization decision support            | **Pass for current report evidence**      | Corrected draft comparison is coherent; exact-package human/customer authority remains a P7 release gate |
| AC-7 Security baseline and overlays            | **Pass for deterministic implementation** | Baseline/selected/recommended states remain distinguishable                                              |
| AC-8 Customer-ready package                    | **Fail**                                  | No signed, independently reviewed customer ZIP passes the customer verifier                              |
| AC-9 Cross-agent compatibility                 | **Fail**                                  | No authenticated paired Codex and Claude Code package dry runs or equivalence certificate                |
| AC-10 Portable operation and release readiness | **Fail**                                  | Four native platforms, signed assets, real providers/SSH, and final authorization are absent             |

Result: **5 pass / 5 fail at the Must acceptance level.** A single failed Must criterion is
sufficient for no-go.

## Current release blockers

### 1. Real root installation and native platforms

The fixed host helper, native peer verifier, runtime/SSH operations, request-guard issuance, signed
installer authority, and public release transition pass accepted deterministic product QA. Product
transition verification is no longer the release blocker.

Docker and Lima were unavailable in the review environment. There is no accepted root-installed
service run or native containment evidence for Linux ARM64, Linux x86-64, macOS ARM64, or macOS
x86-64. The available Linux ARM64 deterministic checks do not constitute a signed native runtime
release pass.

The environment also has no native C compiler, so final CI could not compile the four signed
`rak-peer-cred` payloads or execute their real service/client peer checks on the four required
platform/architecture combinations. This is missing external native evidence, not a deterministic
product-test failure.

Required external evidence: the exact signed candidate must pass hostile
mount/socket/device/network, namespace, LAN/metadata/DNS, provider-credential, cgroup/resource,
timeout/cancellation, unresponsive-daemon, emergency-stop, and residue canaries on all four native
platforms. The ceremony must use the fixed out-of-band key to emit the mode-`0400` record, install
the exact signed platform payload from root-owned rehashed staging, prove account/group closure,
verify peer UIDs, and leave service activation to an explicit root operator. macOS must separately
prove sandbox/hardening parity because fixed launchd identity and arguments do not establish
equivalence with Linux systemd directives.

### 2. Signed assets and supply-chain authority

The release inventory is `unavailable` and `verified:false`, with 52 explicit blockers. Required
native archives/executables, SBOMs, provenance, licenses, current vulnerability scans, signed
multi-architecture images, release manifest, signature, and legitimate protected signing ceremony
are absent.

Required evidence: verify the exact staged candidate from a clean offline installation and consume
only the verifier's immutable `verified:true` image mapping.

### 3. Real SSH acquisition

The fixed trusted SSH handle/worker/finalize/import/release and interruption-recovery path passes
deterministic product seams. No repository-scoped read-only deploy-key run with strict known hosts,
bounded Git egress, immutable source identity, before/after equality, and no
key/socket/configuration/staging residue exists.

### 4. Real provider and paired-run conformance

The installed Codex parser accepted the fixed unattended arguments. That proves parsing only. Claude
Code, authenticated provider homes, signed provider images, provider egress authority, and real
isolated provider execution were unavailable. No real pair of provider runs produced equivalent
required outcomes.

The frozen provider/successor integration now passes its deterministic task-specific author/reviewer
and blocked-successor contract. This removes the older generic-schema code blocker. Release still
requires real Codex and Claude Code outcomes under an explicit paired-run identity/profile,
distinct-provider review bound to admitted author-proposal digests, and a successor ZIP regenerated
and reopened from those real outcomes. Final-digest authority remains a separate signed transition.
Only real paired execution against the frozen contract can clear this gate.

### 5. Real runtime, hostile-target, and credential evidence

Static blocked-state truth is correct, but no signed isolated runnable target proved no host socket,
production access, unsafe egress, destructive action, sandbox-credential replay, or covert
credential-derived output. No safe/hostile P0–P3, crash, quota, migration, request-guard drift, or
incident-response exercise exists.

### 6. Signed customer package and independent review

The public pair/review/authorize/release transition passes accepted deterministic product QA. The
available draft verifier correctly rejected the draft rather than relabeling it. No complete signed
customer ZIP, signed-authority `age` wrapper, independent security/decision review, technical-human
review, lay-human review, customer/product-owner acceptance, or final release-authority record binds
the exact final digest.

## Superseded findings not carried as current defects

The following older defects remain useful audit history but have current focused resolution
evidence:

| Earlier finding                                                                                   | Current disposition                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local immutable snapshot was not integrated                                                       | Resolved by snapshot-only child routing, source/Git identity binding, before/after verification, and immutable 11/11 plus release-run 11/11                                           |
| Resume could escape without fenced terminal cleanup                                               | Resolved by the shared guarded finalizer, stale-authority rejection, residue blocking, and monotonic integrity terminals                                                              |
| Analyzer same-line matches collided on evidence IDs                                               | Resolved by occurrence offsets and run-scoped identity; analyzer 24/24 and fresh self-assessment draft pass                                                                           |
| Earlier live UI secret/persistence/zoom/live-region/health failures                               | Resolved by focused live rechecks recorded in the current adversarial and security evidence                                                                                           |
| Earlier lay report used unsupported urgency, omitted decision context, and exposed machine labels | Resolved for a fresh no-finding generated fixture according to the later rechecks                                                                                                     |
| Public provider path exposed only a generic proposal content contract                             | Resolved by exact closed author/reviewer profiles, 7/7 injected brokered tasks, safe validated blocked-successor generation, zero quarantined digests, and green focused verification |

The last row does not count as independent lay-human or customer review. The immutable mirror does
not count as real SSH or four-platform evidence. Contract tests do not count as a real provider or
signed runtime.

## Release decision and handoff

P7 is incomplete. The release checklist is not signed, no sign-off is issued, and the candidate must
not be represented as customer ready.

Re-evaluate only after all blockers are exercised against one frozen, signed candidate and the
resulting digest-bound package receives the required independent review and final authorization.
Until then the exact verdict remains:

**P7 CUSTOMER RELEASE NO-GO / BLOCKED**

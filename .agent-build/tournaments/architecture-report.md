# Architecture Tournament Report

**Target:** `repo-assessment-kit`  
**Tournament:** P1 architecture, exhaustive  
**Contenders:** 5  
**Judges per contender:** 3  
**Winner:** contender 4, adapter/plugin-first cross-agent platform  
**Final artifact:** `.agent-build/specs/architecture.md`

## Ranking

| Rank | Contender | Strategy | Mean score |
|---:|---:|---|---:|
| 1 | 4 | Adapter/plugin-first cross-agent platform | 7.7667 |
| 2 | 3 | Isolation-first hostile-repository design | 7.7333 |
| 3 | 1 | Simplest portable modular control plane | 7.6333 |
| 4 | 2 | Contract-and-schema-first resumable engine | 7.5000 |
| 5 | 5 | Evidence-integrity and operability first | 7.3667 |

The result was close: contenders 4 and 3 differed by 0.0334. Contender 4 won because its
provider and analyzer abstraction best addressed the product's equal Codex/Claude outcome
contract and future analyzer replacement without adding an arbitrary plugin marketplace.
Its original submission was not yet implementation-ready, so the final synthesis retained
its strategy while adopting stronger isolation, lifecycle, evidence, and storage mechanics
from all runners-up.

## Contender assessments

### Contender 4 — winner

**Strategy:** identical outcome contracts across Codex and Claude Code, replaceable
analyzers, explicit capabilities, and low-friction maintainer extension.

**Strengths:**

- clearest provider-neutral `AgentTask`/`AgentOutcome` boundary;
- explicit analyzer manifests, exact-version normalizers, and capability resolution;
- strong one-way evidence/package flow and standards alignment;
- useful public API, state model, and cross-lane ownership outline;
- avoided a general plugin marketplace and byte-identical provider-output promise.

**Judges' primary objections:**

- core DTOs, schemas, discovery/domain matrices, and equivalence criteria were partly prose;
- trusted source acquisition was not buildable enough: SSH/local isolation, exact helper
  operations, credentials, snapshot atomicity/transfer, LFS/submodules/symlinks were open;
- target-derived evidence could be served same-origin without a complete safe-preview/
  attachment boundary.

**Final resolution:** the final spec freezes canonical DTOs and matrices, exact source/
helper protocols, and an attachment-only evidence policy with trusted derived previews and
strict CSP.

### Contender 3 — runner-up

**Strategy:** make hostile-repository isolation and capability separation the dominant
system shape.

**Strengths grafted:**

- explicit credential compartments and network classes;
- typed host-capability protocol rather than a generic Docker/Lima bridge;
- pre-resolution Compose policy compiler and deterministic runtime-capability evidence;
- honest dynamic coverage that cannot weaken the static path.

**Primary objection:** host-protocol authentication/lifecycle and VM secret delivery were
incomplete, especially nonce/replay semantics and recipient scoping.

**Final resolution:** the host protocol now has framed strict JSON, per-launch key, HMAC,
counter, nonce replay cache, expiry, fence, status/heartbeat/reconcile/finalize operations,
and exact request bodies. VM secrets use one-use handles and a purpose/recipient/approval-
bound ephemeral envelope with replay/expiry cleanup tests.

### Contender 1 — third

**Strategy:** the simplest portable modular monolith that meets the safety and release
requirements.

**Strengths grafted:**

- one Fastify control plane, one durable SQLite scheduler, and no unnecessary broker or
  service infrastructure;
- a static-first vertical slice before the dynamic plane;
- clear package gating and a customer-ready static-only outcome.

**Primary objection:** lifecycle protocols did not fully cover pause, cancel, status,
reconcile, heartbeat, provider resume, and artifact finalization.

**Final resolution:** the final state machine and protocols cover all those operations,
including closed outboxes, completion certificates, stale-heartbeat reconciliation, and
provider resume identity checks.

### Contender 2 — fourth

**Strategy:** version every phase input and make resumability deterministic through fenced,
immutable attempts.

**Strengths grafted:**

- monotonic fence tokens and lease-aware output admission;
- immutable attempts and superseding evidence/finding revisions;
- optimistic concurrency, idempotency keys, and transactional event outbox;
- input/completion digests that prevent stale phase reuse.

**Primary objection:** content-digest evidence identity could collapse distinct captures
and lose occurrence/provenance relationships.

**Final resolution:** `EvidenceBlob` owns byte identity while `EvidenceOccurrence` owns each
capture/activity/locator/derivation/link. Blob deduplication is per run and never deduplicates
occurrences.

### Contender 5 — fifth

**Strategy:** treat immutable evidence admission, operational recovery, and package
integrity as the center of the design.

**Strengths grafted:**

- content-addressed admitted blobs plus separate operational records;
- atomic admission journals and recovery reconciliation;
- explicit storage headroom, quotas, ENOSPC behavior, retention, and two-phase deletion;
- auditable package stages and certificates.

**Primary concern:** a hash-chained evidence ledger added complexity without improving the
required package validation enough to justify another canonical integrity mechanism.

**Final resolution:** the final spec keeps immutable CAS, occurrences, transactional
admission, events, stage certificates, manifest/checksums, and ZIP verification, but omits
the hash chain. Authorship/non-repudiation remains a separate future signing profile.

## Grafted final design

The final specification combines:

1. contender 4's adapter-first provider/analyzer contracts and capability registry;
2. contender 3's isolation/credential/network boundaries and Compose compiler;
3. contender 1's modular-monolith scheduler, static-first sequencing, and package gate;
4. contender 2's fenced attempts, optimistic concurrency, idempotency, and transactional
   outbox;
5. contender 5's blob/occurrence storage, atomic admission, headroom/ENOSPC/retention/
   deletion rules, and auditable package stages.

It also adds three judge-required corrections:

- complete canonical contract appendices for lifecycle, claims, evidence, controls,
  findings, agents, analyzers, capabilities, approvals, helper/runtime, events, errors, and
  package manifests;
- an isolated, atomic SSH/local source-acquisition protocol with no broad host mount and
  explicit submodule/LFS/symlink handling;
- attachment-only target-derived content with safe transformed previews, `nosniff`, CSP,
  and no same-origin target HTML/SVG execution.

## Why the final design is coherent

The grafts reinforce one architecture rather than creating parallel mechanisms. One
Fastify/SQLite control plane remains the sole state authority. Provider/analyzer/helper/
runtime work all use the same fenced attempt and closed-outbox admission model. Capability
results drive the workflow, UI, runtime gate, and coverage matrix. Evidence occurrences feed
the same deterministic validators and auditable package stages. The dynamic VM remains
strictly additive to the static-first release path.

## Final quality and remaining gates

The final spec now freezes P4/P5/P6 ownership, dependency direction, OpenAPI operations,
database constraints/indexes, state transitions, provider/analyzer/helper/runtime DTOs,
source integrity, evidence identity, storage lifecycle, package algorithm, and test seams.

Implementation still has mandatory empirical gates: the native four-host VM matrix, real
Claude adapter, `better-sqlite3` on Node 24 ARM64/x86-64, Linux ARM64 browser/passive scan,
kit-owned multi-language rules, and adversarial VM secret-envelope tests. These are stated
as release blockers and do not authorize weaker fallbacks.

## Exhaustive critic pass

- **Synthesized score:** 7.9/10
- **Verdict:** Revise
- **Winner baseline:** 7.7667/10
- **Revision trigger:** Absolute threshold miss (`7.9 < 8.0`); the synthesis did not regress
  below the winning contender.
- **Strongest objection:** The host-helper and HTTP boundaries still used generic object
  payloads and prose-level operations, so P4, P5, and P6 would have needed to invent
  incompatible safety and lifecycle behavior.

One bounded revision ran. The final architecture now replaces those pseudo-contracts with
operation-specific discriminated host request/result maps, authenticated framing,
idempotency/fencing/checkpoint semantics, a normative HTTP/OpenAPI operation map, transition
effects, and golden contract fixtures. The same revision also tightened paired-run
equivalence identity, source-digest rules, shipped-HTML safety, and retention/restore/cleanup
lifecycle contracts. Per the tournament procedure, no further critic loop was run.

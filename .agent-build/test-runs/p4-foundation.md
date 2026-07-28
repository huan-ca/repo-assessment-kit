# P4 Foundation Independent QA

Date: 2026-07-28  
Target: `/workspace/rendervo-alt-3bcd18f5/targets/repo-assessment-kit`  
Scope: P4 against brief AC-2, AC-9, AC-10, `DECISIONS.md`, `PLAN.md` P4,
`specs/architecture.md`, and `specs/safety.md`  
Environment: Linux ARM64 (`aarch64`), Node 24.4.1, pnpm 11.17.0; Docker, Lima, and
ShellCheck unavailable

## Verdict

**NEEDS FIXES / P4 FAIL.**

The TypeScript workspace installs reproducibly and its format, lint, boundary, type, build,
fixture-root, and basic static smoke checks pass on this Linux/ARM64 environment. The P4
foundation does not satisfy its frozen security boundary or its done condition, however:

- the same provider container that executes interactive Codex/Claude receives the complete
  kit tree, writable `generated/` and `state/`, and optional live source and SSH material;
- launcher argument pass-through allows provider permission-bypass flags despite the
  documented and frozen prohibition;
- the native release workflow can treat a `blocked` runtime-capability result as success and
  does not execute the required native isolation/adversarial matrix;
- `pnpm test` succeeds with zero tests, and the claimed fixture/launcher safety coverage is
  not part of the CI command;
- no Git commit, Docker build evidence, real-provider conformance, or launcher end-to-end
  package exists, so AC-2, AC-9, and AC-10 are not met.

## Acceptance matrix

| Criterion / P4 gate | Result | Evidence and exact reproduction |
|---|---|---|
| AC-2: SSH Git and local repository input | **FAIL** | `scripts/launcher.sh:58-72` only mounts a local repository or SSH directory into the provider container. There is no acquisition worker, SSH URL normalization/clone flow, immutable snapshot, or end-to-end test. `rg -n "commit|rev-parse|integrity|porcelain" scripts apps packages` finds no implementation of SHA resolution or before/after integrity. |
| AC-2: full commit SHA in run identity/deliverables | **FAIL** | The repository itself has no commit: `git rev-parse HEAD` returns `fatal: ambiguous argument 'HEAD'`. Product source contains no implemented run identity or deliverable generation. |
| AC-2: source before/after immutability | **FAIL** | No automated integrity test or implementation exists. Local input is mounted `:ro` (`scripts/launcher.sh:61`), which is a useful mount control but not the required before/after integrity proof and does not cover SSH acquisition. |
| AC-2: no SSH material in generated output | **FAIL** | No seeded SSH/output scan exists. Worse, optional SSH is mounted directly into `/home/node/.ssh` in the provider container (`scripts/launcher.sh:64-75` plus `scripts/container-entrypoint.sh:11-16`), while that container also receives writable `generated/` and `state/` (`scripts/launcher.sh:48-49`). This violates the independent acquisition-worker boundary and makes leakage possible. |
| AC-9: `start-codex.sh` E2E validated ZIP | **FAIL** | `scripts/container-entrypoint.sh:17-19` maps `run` only to `pnpm dev`; it does not execute Codex assessment work or package a ZIP. No E2E tests or generated package exist. |
| AC-9: `start-cc.sh` E2E validated ZIP | **FAIL** | Same defect as Codex: `run` only starts the application scaffold. No real Claude dry run or package exists. |
| AC-9: common cross-agent acceptance suite | **FAIL** | `pnpm test` reports `No test files found, exiting with code 0`; no conformance/equivalence suite exists. |
| AC-10: macOS/Linux ARM64/x86-64 smoke matrix | **FAIL** | Only this Linux/ARM64 workspace run was observed. `.github/workflows/ci.yml:39-50` configures QEMU image builds for Linux ARM64/x86-64, but no workflow result exists and emulation is not native proof. `.github/workflows/native-runtime.yml` names all four native runners but does not assert runtime availability or execute the required Lima/rootless/cgroup/firewall/request-guard/emergency-stop/residue tests. |
| AC-10: WSL best-effort documentation | **FAIL** | `rg -n -i "WSL|Windows Subsystem" .agent-build/runbook.md container/runtime/README.md` returns no match. |
| AC-10: operator documentation | **FAIL** | `.agent-build/runbook.md` covers basic install, launcher verbs, input mounts, output/state, a blocked-runtime summary, and rollback. It does not document WSL, exact outbound-access needs, complete recovery, package verification, or real end-to-end operation. It references a “launcher release manifest” that does not exist. |
| AC-10: customer-facing documentation | **FAIL** | There is no `docs/` directory and no customer-facing guide covering provenance, statuses, coverage, limitations, decision criteria, or integrity review. |
| AC-10: all Must criteria and no deferred core capability | **FAIL** | P5/P6/P7 remain pending, the UI states “Assessment workflows are not yet enabled,” and several packages contain only one exported constant. Release remains correctly gated in specs, but P4's own “no placeholder packages or scripts” done condition is not met. |
| P4: reproducible workspace install | **PASS (Linux/ARM64)** | In a clean temporary copy excluding dependency/build output: `pnpm install --frozen-lockfile && pnpm run ci` exited 0. It installed 539 packages and compiled `better-sqlite3` successfully. |
| P4: format/lint/boundaries/type/build | **PASS** | `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build` exited 0. Boundary script reported 11 manifests. |
| P4: native SQLite smoke | **PASS (Linux/ARM64)** | `pnpm --filter @rak/persistence exec node --input-type=module -e 'import Database from "better-sqlite3"; const db=new Database(":memory:"); console.log(db.prepare("select sqlite_version() as version").get()); db.close();'` returned SQLite `3.50.2`. This is one architecture only. |
| P4: unit tests | **FAIL** | `pnpm test` exits 0 with `No test files found`; `vitest.config.ts:6` explicitly sets `passWithNoTests: true`. |
| P4: fixture roots | **PASS manually; FAIL in CI contract** | `pnpm fixtures:verify` exits 0 and reports seven ecosystem roots. `package.json:26` omits it from `ci`, despite runbook lines 51-53 claiming `pnpm run ci` checks fixture roots. |
| P4: bash syntax | **PASS** | `bash -n start-codex.sh start-cc.sh scripts/launcher.sh scripts/runtime-capability.sh` exited 0. ShellCheck is **BLOCKED** locally because it is not installed. |
| P4: missing Docker fail closed | **PASS** | `bash start-codex.sh status` and `bash start-cc.sh status` both exit 69 with `Docker is required to run the provider sandbox.` |
| P4: missing Lima fail closed | **PASS for capability result** | `bash scripts/runtime-capability.sh` exits 0 with `{"status":"blocked","reason":"Lima is not installed on the host"}` and does not fall back. The release workflow's failure to assert a non-blocked result is a separate defect. |
| P4: UI loopback only | **FAIL** | Container/Compose publish is correctly `127.0.0.1:...:4173`. However the documented `pnpm dev` path binds both Vite and Fastify to all interfaces (`apps/web/package.json:9`, `apps/server/src/index.ts:7`). Live output showed `Network: http://172.17.0.5:4173/` and Fastify listening on `http://172.17.0.5:3000`. |
| P4: no host Docker socket | **PASS statically; BLOCKED dynamically** | No product container/launcher socket mount or `DOCKER_HOST` was found. `container/compose.yaml` has no socket mount. A real Docker inspect/probe is blocked because Docker is unavailable. |
| P4: separate provider homes | **PASS statically** | Launcher uses `rak-<engagement>-codex-home-v1` vs. `rak-<engagement>-claude-home-v1`; Compose defines distinct volumes. |
| P4: no default bypass | **FAIL** | No bypass literal is hard-coded, but arbitrary arguments are passed through at `scripts/launcher.sh:75` and executed at `scripts/container-entrypoint.sh:11-16`. Therefore `./start-cc.sh interactive --dangerously-skip-permissions` and `./start-codex.sh interactive --dangerously-bypass-approvals-and-sandbox` are accepted instead of rejected. |
| P4: local/SSH mounts narrow and read-only | **FAIL** | Both mounts use `:ro`, but SSH is a whole directory mounted into the provider home; validation rejects only exact `$HOME` and `/`, so broad paths such as `/home`, `/workspace`, or a parent containing unrelated keys are accepted. Safety §5.1 requires exact key/agent socket plus exact `known_hosts` in a separate acquisition worker and forbids parent directories. |
| P4: generated/workspaces ignored | **PASS** | `git check-ignore -v generated/probe workspaces/probe state/probe .env .agent-build/artifacts/probe` identifies the expected `.gitignore` rules. |
| P4: Dockerfiles/Compose/Lima static assets | **PARTIAL / BLOCKED** | Base Node image uses a digest, provider CLI versions are explicit, containers use non-root, read-only root, dropped capabilities, `no-new-privileges`, and Lima declares no mounts/port forwards. `docker compose config` and both multi-architecture builds could not run because Docker is unavailable. No checked CI result is present. |
| P4: no placeholders | **FAIL** | `apps/web/src/main.tsx` explicitly says workflows are not enabled; `packages/agent-adapters`, `evidence`, and `reporting` are one-line constant-only scaffolds; no tests exist. This contradicts PLAN P4's “no placeholder packages or scripts remain” done condition even though later phases are scheduled to implement the product. |

## Defects

### P4-001 — Critical — Provider process receives forbidden source, SSH, state, kit, and output capabilities

Likely owner: devops/runtime foundation.

Reproduction:

1. Inspect `container/Dockerfile.codex:17-25` and `container/Dockerfile.claude:17-25`:
   the entire kit is copied into `/opt/rak`.
2. Inspect `scripts/launcher.sh:42-75`: every verb receives writable `generated/` and
   `state/`; optional live source and an SSH directory are added to that same container.
3. Inspect `scripts/container-entrypoint.sh:11-16`: `interactive`/`resume` directly execute
   Codex or Claude in that container.
4. Observe that no `--network none`/allowlisted provider network or separate acquisition
   worker exists.

Expected: safety SI-03/SI-04 and §§5.1/7.2 require SSH only in an ephemeral acquisition
worker and provider access only to its engagement home, immutable task capsule, brokered
evidence view, and proposal outbox. Provider must receive no live source, kit source,
SQLite/state, generated tree, SSH, or arbitrary network.

Actual: the provider process can directly read source/SSH/kit/state and write generated
artifacts, with default Docker networking. This defeats the frozen authority and redaction
boundaries.

### P4-002 — Critical — Permission-bypass flags are accepted through unchecked launcher arguments

Likely owner: devops/agent-adapter boundary.

Reproduction:

1. `scripts/launcher.sh:75` passes all trailing arguments unchanged.
2. `scripts/container-entrypoint.sh:11-16` passes them unchanged to `codex`/`claude`.
3. With images available, run:
   `./start-cc.sh interactive --dangerously-skip-permissions` or
   `./start-codex.sh interactive --dangerously-bypass-approvals-and-sandbox`.

Expected: architecture §5.1 says unknown provider flags are rejected and bypass modes are
not a product capability; safety §7.2 forbids permission bypass.

Actual: only the verb is allowlisted. Provider flags are not parsed or rejected. The smoke
test merely searches for two literal strings in the launcher and cannot detect this bypass.

### P4-003 — High — Native release-gate workflow can pass a blocked capability and does not test the gate

Likely owner: devops/runtime.

Reproduction:

1. Run `bash scripts/runtime-capability.sh`; it prints a `blocked` JSON result and exits 0.
2. Inspect `.github/workflows/native-runtime.yml:21-25`; the workflow runs that script but
   makes no assertion that status is `available`.
3. The only remaining steps are provider login-status commands. There are no Lima/rootless
   Docker, cgroup, firewall, request-guard, egress, emergency-stop, residue, or hostile
   fixture checks.

Expected: native four-host release evidence must fail unless the complete matrix passes.

Actual: the capability step is green while blocked, and the workflow does not exercise the
named release controls.

### P4-004 — High — CI succeeds with no tests and omits claimed fixture/safety coverage

Likely owner: devops/QA foundation.

Reproduction:

1. Run `pnpm test`: it prints `No test files found, exiting with code 0`.
2. Inspect `vitest.config.ts:6`: `passWithNoTests: true`.
3. Inspect `package.json:26`: `ci` omits `fixtures:verify` and E2E tests.
4. Compare `.agent-build/runbook.md:51-53`, which claims `pnpm run ci` verifies fixture
   roots, launcher syntax, loopback, no socket, and no bypass.

Expected: deterministic tests for launchers, mounts, no socket, no bypass, runtime blocking,
fixtures, and package boundaries, with CI failing when these disappear.

Actual: no test files exist. Static smoke checks only two socket spellings, one Compose
substring, and two bypass strings, and CI does not run the fixture verifier.

### P4-005 — High — AC-2 target identity, integrity, and SSH leak proof are absent

Likely owner: backend/source acquisition, with devops fixture support.

Reproduction:

1. `git rev-parse HEAD` fails because the target has no initial commit.
2. Search implementation for commit resolution/integrity:
   `rg -n "rev-parse|porcelain|integrity|before|after" scripts apps packages`.
3. No SSH Git dry run, local-path dry run, before/after source digest, or output secret scan
   exists.

Expected: both input types, full SHA run identity, unchanged source proof, and zero SSH
material in generated output.

Actual: read-only mount scaffolding exists, but the acceptance behavior and proof do not.

### P4-006 — High — Both launchers lack the required assessment and cross-agent dry run

Likely owner: backend/agent adapters and release QA.

Reproduction:

1. Inspect `scripts/container-entrypoint.sh:17-19`; both `run` paths execute only `pnpm dev`.
2. Run `find generated -type f` (when present) and inspect tests; no validated customer ZIP
   or provider-conformance test exists.

Expected: each launcher completes the same discovery-to-validated-ZIP flow and passes the
same acceptance suite.

Actual: launchers start a UI/server scaffold only.

### P4-007 — Medium — Documented local development exposes UI and API on all interfaces

Likely owner: frontend/devops and backend/devops.

Reproduction:

1. Run `pnpm dev`.
2. Output advertises Vite `Network: http://<container-ip>:4173/` and Fastify listening at
   `http://<container-ip>:3000`.
3. Static sources use `0.0.0.0` in `apps/web/package.json:9` and
   `apps/server/src/index.ts:7`.

Expected: local UI host access is loopback-only.

Actual: the documented non-container development command listens on every interface.
Container publishing remains loopback-only.

### P4-008 — Medium — Required release/operator/customer documentation is incomplete

Likely owner: devops for foundation runbook; release/docs for final customer material.

Reproduction:

1. `find docs -type f` fails because `docs/` does not exist.
2. `rg -n -i "WSL|Windows Subsystem|checksum|SHA256SUMS|package verification|outbound"`
   against the runbook finds no complete procedures.
3. Runbook rollback refers to a launcher release manifest that is absent.

Expected: AC-10 operator and customer documentation, including WSL best-effort boundaries,
outbound needs, recovery, provenance/status/coverage, and package integrity review.

Actual: only a short foundation runbook exists.

## Release-gate accounting

The unresolved environmental/product gaps are **explicitly identified as release gates**:

- `.agent-build/runbook.md:56-58` states that the four native macOS/Linux ARM64/x86-64
  matrix is required and QEMU does not replace native proof.
- architecture §20 explicitly gates native Lima/rootless Docker/cgroup/egress/cleanup,
  real Claude conformance, `better-sqlite3` on both Linux architectures, ARM64 Chromium,
  and multi-architecture ZAP/reduced-coverage validation.
- safety §19.1 explicitly gates both real provider images, four-host native containment,
  locked image/tool evidence, hostile suites, ARM64 browser/passive-tool coverage, and no
  prohibited fallback.

This explicit documentation is a positive control, but it does not make P4 pass. The
current native workflow does not enforce the documented gate, Docker/multi-architecture
builds were unavailable in this environment, and no real-provider or native-host evidence
is checked into `.agent-build/test-runs/`.

## Coverage notes

Verified:

- clean frozen pnpm installation on Linux/ARM64;
- format, lint, dependency boundaries, strict TypeScript, production build;
- manual seven-ecosystem fixture-root validation;
- native ARM64 `better-sqlite3` load/query;
- launcher Bash syntax and fail-closed missing-Docker behavior;
- fail-closed missing-Lima capability result;
- ignore rules, static loopback mapping, distinct homes, no socket literal;
- static Dockerfile/Compose/Lima/runbook/workflow inspection;
- live local development bind behavior.

Blocked:

- Dockerfile builds, `docker compose config`, runtime container inspection, and actual
  loopback/socket/mount probes (Docker unavailable);
- native Lima/rootless/cgroup/firewall/cleanup tests (Lima unavailable);
- ShellCheck (binary unavailable locally; configured in CI but no run result supplied);
- macOS ARM64/x86-64 and Linux x86-64;
- real Codex/Claude login/conformance/end-to-end dry runs.

Not implemented and therefore failed rather than silently passed:

- SSH/local immutable acquisition and source-integrity proof;
- provider containment/conformance tests;
- cross-agent acceptance equivalence;
- validated customer package and secret/SSH leak scan;
- customer documentation and package verification.

No product code was modified. This report is the only QA-owned file added.

---

## Bounded P4 revision recheck — 2026-07-28

This section supersedes the original P4 verdict above for the revised foundation. It does
not treat P5/P6/P7 assessment execution, customer ZIP/report production, real-provider
conformance, or native-host evidence as P4 failures when the P4 boundary fails closed and
records those items as release gates.

### P4-only verdict

**NEEDS ONE FURTHER FOUNDATION FIX / P4 FAIL.**

The revision closes P4-002, P4-003, P4-004, and P4-007. It also correctly separates the
provider image from source, SSH, kit/state/generated paths, and public unbrokered tasks.
However, the new acquisition wrapper permits its writable output mount to overlap the
assessed repository or SSH-secret directory. That defeats the immutable-source and
exact-secret-mount foundation it claims to establish. The network-attestation parser also
accepts an unrelated host and an arbitrarily named bridge as a valid provider/Git
attestation; this is not independent proof of an allowlisted network. P4-001 is therefore
only partially closed and the foundation portion of P4-005 remains blocking.

### Recheck matrix

| Prior defect / gate | Recheck | Evidence |
|---|---|---|
| P4-001 provider compartment | **PARTIAL / FAIL** | Provider filesystem/mount separation is fixed: provider Dockerfiles copy only the fixed entrypoint/task runner, Compose mounts only distinct homes, uses `network_mode: none`, publishes no port, and public launcher mounts no source/SSH/state/generated/socket. Public `run`, `interactive`, and `resume` fail closed. However, `verify-network-attestation.mjs` validates only the shape and self-consistency of operator-supplied JSON. It neither binds allowed hosts to the provider/Git subject nor proves the named Docker network has external allowlist enforcement. Reproduction below shows unrelated-host attestations accepted with exit 0. |
| P4-002 bypass arguments | **PASS / CLOSED** | `bash start-codex.sh interactive --dangerously-bypass-approvals-and-sandbox` and `bash start-cc.sh interactive --dangerously-skip-permissions` exit 64. `container/provider-entrypoint.sh codex status --extra` exits 64. The internal task runner supplies fixed Codex `workspace-write`/`never` and Claude `dontAsk`/empty-tools arguments. |
| P4-003 native gate false-green | **PASS / CLOSED for P4** | `runtime-capability.sh --require-available` exits 1 with a typed `blocked` result when Lima is absent. `native-isolation-gates.sh` also exits 1 before attempting work. The four-host workflow requires availability and then invokes fixed request-guard, egress-deny, resource-limit, emergency-stop, residue-cleanup, and clean-state gates. The broker/native evidence remains an explicit P5/P7 release gate and is not falsely reported as passed. |
| P4-004 empty/partial CI | **PASS / CLOSED** | `pnpm run ci` exits 0 and runs format, lint, workspace boundaries, package/test type checks, 10 deterministic Vitest tests, seven-ecosystem fixture verification, Bash syntax, all builds, and both smoke programs. `passWithNoTests` is removed. |
| P4-005 acquisition foundation | **FAIL / OPEN** | Separate local and SSH acquisition paths, exact key/known-host mounts, no-network local capture, full commit resolution, status-before/after, archive digest, and identity output now exist. But output is created before overlap validation and no overlap validation exists. A local output under `<source>/.git/` is accepted and created without appearing in porcelain status; with Docker it becomes a writable alias into the assessed repository. An SSH output equal to the key directory is accepted and would mount the whole secrets directory read-write at `/out`, bypassing the exact-file boundary. The wrapper also overrides image user 10001 with host UID/GID, which becomes container root when invoked by a root operator/runner. |
| P4-007 local all-interface listeners | **PASS / CLOSED** | Live `pnpm dev` output advertised only `http://127.0.0.1:4173/`; Fastify listened only on `127.0.0.1:3000`. Both loopback curls succeeded. Curls to `172.17.0.5:4173` and `:3000` failed with exit 7. |
| P4-008 foundation documentation | **PASS for P4** | The revised runbook explicitly scopes P4, documents outbound categories, local/SSH acquisition, blocked behavior, four-host/native gates, WSL best-effort limitations, recovery, package-verification expectations, and release-manifest/rollback format. `docs/foundation-security-boundaries.md` clearly assigns final provenance/customer/package guidance to P7. It does not claim those later deliverables exist. |
| Later AC-2/AC-9 package evidence | **EXPLICIT RELEASE GATE, not a P4 failure** | Runbook states that end-to-end AC-2/AC-9 evidence remains P5/P7 work. Public provider work is refused until the P5 task broker exists. |
| Docker/multi-architecture and real-provider/native results | **BLOCKED / EXPLICIT RELEASE GATES, not falsely passed** | Docker, Lima, and recorded hosted workflow evidence remain unavailable in this QA environment. CI defines all three image builds for Linux AMD64/ARM64; the native workflow names the four required native hosts and fails closed without an available broker. Runbook explicitly says no result is passed without recorded workflow evidence. |

### Recheck commands and results

#### Full foundation suite

```sh
pnpm run ci
```

Result: exit 0. Vitest: 1 file, 10 tests passed. Fixture verifier: seven roots
verified. Typecheck/build/smoke/Bash syntax all passed.

#### Bypass and unbrokered-provider negatives

```sh
bash start-codex.sh interactive --dangerously-bypass-approvals-and-sandbox
bash start-cc.sh interactive --dangerously-skip-permissions
bash start-codex.sh run
bash container/provider-entrypoint.sh codex status --extra
```

Results: exits 64, 64, 78, and 64 respectively, with the expected trailing-argument,
P5-broker, or provider-entrypoint refusal.

#### Required runtime negatives

```sh
bash scripts/runtime-capability.sh --require-available
bash scripts/native-isolation-gates.sh
```

Result: both exit 1 with
`{"status":"blocked","reason":"Lima is not installed on the host"}`.

#### Acquisition input negatives

```sh
bash scripts/acquire-source.sh local . '../bad' /tmp/rak-qa-bad-ref
bash scripts/acquire-source.sh ssh git@example.com:owner/repo.git main \
  fixtures/security/fake-secret.txt fixtures/security/fake-secret.txt /tmp/rak-qa-ssh-out
```

Results: invalid ref exits 64; SSH without an attested network exits 77.

#### Blocking local-output overlap

```sh
qa_repo=$(mktemp -d /tmp/rak-acquire-overlap.XXXXXX)
git -C "$qa_repo" init -q
git -C "$qa_repo" config user.email qa@example.invalid
git -C "$qa_repo" config user.name QA
touch "$qa_repo/probe.txt"
git -C "$qa_repo" add probe.txt
git -C "$qa_repo" commit -qm initial
bash scripts/acquire-source.sh local "$qa_repo" HEAD "$qa_repo/.git/rak-output"
test -d "$qa_repo/.git/rak-output"
git -C "$qa_repo" status --porcelain --untracked-files=all
```

Observed: acquisition reaches the missing-Docker check and exits 69, but
`.git/rak-output` has already been created. Git porcelain remains empty. With Docker
available, that directory is mounted read-write at `/out`, allowing acquisition output to
modify the assessed repository without the before/after status digest detecting it.

#### Blocking SSH-output overlap

Using regular `key`, `known_hosts`, and a syntactically valid Git-network attestation in
one temporary directory:

```sh
RAK_GIT_NETWORK=rak-git-egress \
RAK_GIT_EGRESS_ATTESTATION="$qa_secret_dir/attestation.json" \
bash scripts/acquire-source.sh ssh git@example.com:owner/repo.git main \
  "$qa_secret_dir/key" "$qa_secret_dir/known_hosts" "$qa_secret_dir"
```

Observed: exit 69 at the missing-Docker check, proving the overlapping output directory
passed all acquisition validation. With Docker available, the whole secret directory
would be mounted read-write at `/out` in addition to the two exact read-only file mounts.

#### Host-bound attestation negative

Two schema-valid attestations were created:

- provider subject `codex`, network `unrestricted-bridge`, allowed host
  `unrelated.example`;
- Git subject `git@example.com:owner/repo.git`, the same network and unrelated host.

```sh
node scripts/verify-network-attestation.mjs \
  provider-inference codex unrestricted-bridge "$qa_attest"
node scripts/verify-network-attestation.mjs \
  git-acquisition git@example.com:owner/repo.git unrestricted-bridge "$qa_git_attest"
```

Observed: both exit 0. This contradicts the test/runbook description of a matching
host-bounded attestation. Until a trusted helper attests actual network enforcement, the
public login/acquisition path should either reject such records or remain disabled.

#### Live loopback verification

```sh
pnpm dev
curl --fail http://127.0.0.1:4173/
curl --fail http://127.0.0.1:3000/health/live
curl --connect-timeout 1 http://172.17.0.5:4173/
curl --connect-timeout 1 http://172.17.0.5:3000/health/live
```

Observed: loopback requests pass; both non-loopback requests fail with curl exit 7.

### Recheck defects

#### P4-R1 — High — Writable acquisition output can overlap source or SSH-secret paths

Likely owner: devops/source-acquisition foundation.

Expected:

- local source remains immutable with no writable alias into the registered repository;
- SSH acquisition mounts only exact key and known-host files plus a distinct empty outbox;
- the acquisition process always remains fixed numeric non-root.

Actual:

- `scripts/acquire-source.sh` canonicalizes and creates output but never proves it is
  disjoint from local source, `.git`, key, known-hosts, their parent directories, or other
  sensitive roots;
- a `.git` overlap is invisible to the implemented porcelain before/after check;
- SSH output can expose the entire secret parent as a read-write mount;
- `--user "$(id -u):$(id -g)"` overrides image UID 10001 and may select root.

Required fix: require an existing, empty, canonical output directory; reject same,
ancestor, or descendant overlap with source and both SSH inputs/their protected parent;
use a fixed non-root container identity and an explicit output ownership/copy-out design.
Add deterministic negative tests for every overlap and root-UID case.

#### P4-R2 — High — Network “attestation” accepts unrelated hosts and cannot establish enforcement

Likely owner: devops/network boundary.

Expected: provider inference is limited to release-approved provider destinations and SSH
acquisition to the parsed Git host, with enforcement outside the workload. Missing or
untrusted enforcement fails closed.

Actual: any readable unsigned JSON with matching free-form subject/network strings, one
syntactically valid hostname, and a future expiry passes. The verifier does not bind
`allowedHosts` to the provider or parsed Git URL and does not authenticate an enforcing
gateway/network policy. An unrestricted Docker bridge can therefore be labeled attested.

Required fix: consume a trusted helper-signed/permission-protected attestation that binds
network identity, enforcement policy digest, capability, exact release-owned destination
set, subject, expiry, and nonce/fence; at minimum reject host sets inconsistent with the
provider/Git subject. If that attestor belongs to P5, keep public provider login and SSH
acquisition disabled until it exists, as already done for provider tasks.

### Recheck coverage

Passed:

- revised full CI and deterministic foundation tests;
- Bash syntax;
- static provider image/Compose content and mount checks;
- bypass and unbrokered-task negatives;
- missing-Docker/Lima fail-closed paths;
- invalid acquisition ref/missing-attestation negatives;
- live loopback-only UI/API;
- honest later-phase documentation and release gating.

Blocked but not falsely passed:

- Docker image/Compose runtime inspection and Linux multi-architecture builds;
- native Lima/rootless/adversarial matrix;
- real provider authentication/conformance;
- P5/P6/P7 assessment, customer reports, validated ZIP, and final package review.

No product code was modified during this recheck; only this QA report was updated.

---

## Final narrow P4-R1/P4-R2 recheck — 2026-07-28

This section supersedes both earlier P4 verdicts. Scope is limited to the final containment
correction for P4-R1 and P4-R2. Docker/Lima/native-host/real-provider results and integrated
assessment/package evidence remain later fail-closed release gates and are not counted as
P4 failures.

### Final P4-only verdict

**PASS.**

P4-R1 and P4-R2 are closed. The complete current foundation CI passes, the new targeted
regressions pass, and independent attempts to reproduce the prior attacks fail closed.
No signer private key or signing-key override ships in the repository or provider/acquisition
runtime images.

### Final closure matrix

| Defect | Result | Evidence |
|---|---|---|
| P4-R1: acquisition output/source/SSH overlap and root UID | **PASS / CLOSED** | `validate-acquisition-paths.mjs` requires canonical, existing, owner-owned, non-group/world-writable, empty output; rejects output/source/`.git` and SSH-file/parent ancestor-or-descendant overlap; rejects symlink aliases and broad key permissions. Acquisition writes to an anonymous Docker volume and copies out only after container success. `Dockerfile.acquisition` fixes `USER 10001:10001`; the launcher no longer supplies host UID/GID. |
| P4-R2: unsigned/unrestricted/wrong-host attestation | **PASS / CLOSED** | Network envelopes require a pinned Ed25519 signature and exact payload keys binding issuer, purpose, subject, Docker network name and inspected immutable network ID, policy digest, release-owned exact endpoints, issue/expiry bounds, and one-use nonce. Provider endpoints are fixed in release code; Git endpoint is parsed from the SSH subject. Replay creates an exclusive nonce-ledger record. Unsigned, forged, wrong-network, wrong-network-ID, wrong-nonce, wrong-host, stale, and replayed inputs are covered by tests and independent negatives. |
| Signer private-key separation | **PASS** | Only `release/network-attestor-public-key.pem` exists outside dependencies/QA history. OpenSSL parses it as an Ed25519 public key. Repository scans find no PEM/OpenSSH/RSA/EC private-key marker or private/signing-key file. Provider/acquisition Dockerfiles selectively copy only their entrypoint/task files and copy no release key or signer material. The runbook states that P5 must provision the private key only to the trusted host-helper signer; until then provider login and SSH acquisition remain refused. |
| Later release evidence | **GATED, not a P4 failure** | Lack of Docker/Lima/native/real-provider/integrated-package evidence is explicitly documented and enforced as blocked. No current P4 result claims those release gates passed. |

### Commands and observed evidence

#### Full and targeted regression suites

```sh
pnpm run ci
pnpm vitest run tests/foundation.test.ts \
  -t 'attestations and native gates|acquisition path containment'
```

Results:

- `pnpm run ci`: exit 0; 22/22 tests pass; format, lint, boundary checks, package and
  test typechecks, fixtures, Bash syntax, builds, and both smoke programs pass.
- targeted run: exit 0; 14 relevant tests pass, 8 unrelated tests skipped.

#### Independent local acquisition overlap and alias attacks

Using a fresh committed temporary Git repository and pre-existing output directories:

| Attempt | Result |
|---|---|
| output under source | exit 66, `must be disjoint` |
| output under `.git` | exit 66, `must be disjoint` |
| output containing source | exit 66 before Docker |
| output symlink alias | exit 66, `without symlink aliases` |
| source symlink alias | exit 66, protected path alias refused |
| `.git` symlink alias | exit 66, protected path alias refused |
| absent output path | exit 66, `must already exist`; path remains absent |
| nonempty output | exit 66, `must be empty` |

The prior reproduction that created `<source>/.git/rak-output` no longer works: output must
already exist, then canonical overlap validation rejects it before any Docker call or
host-path creation.

#### Independent SSH overlap and alias attacks

Using separate temporary key and known-host parent directories:

| Attempt | Result |
|---|---|
| output below key parent | exit 66, `must be disjoint` |
| output below known-host parent | exit 66, `must be disjoint` |
| output equal to key parent | exit 66 before Docker |
| key symlink | exit 66, protected path alias refused |
| known-host path through symlinked parent | exit 66, protected path alias refused |
| group/world-readable private key | exit 66, key accessibility refused |

The output directory is no longer a host bind mount. Docker creation uses
`--mount type=volume,destination=/out`, and successful output is copied to the validated
host directory with `docker cp`.

#### Independent simulated root-host invocation

A fake Docker command recorded the exact `docker create` argv while an exported `id`
function reported UID 0. Observed create arguments contained:

```text
--read-only --cap-drop ALL --security-opt no-new-privileges
--network none
--volume <temporary-source>:/source:ro
--mount type=volume,destination=/out
rak-acquisition:0.1.0 local HEAD
```

No `--user` override was present. The image declares `USER 10001:10001`, so a root host
operator does not convert the acquisition worker into container root.

#### Independent attestation attacks

```text
unsigned legacy unrestricted-bridge record:
  exit 77 — network attestation refused: unsigned attestation

new-shape unrestricted-bridge envelope with forged signature:
  exit 77 — network attestation refused: attestation signature is invalid

Git envelope with unrelated.example instead of the parsed Git host:
  exit 77 — network attestation refused:
            attestation scope, network, endpoint, nonce, or freshness mismatch
```

No rejected attempt created a nonce-ledger record.

#### Signer-material inventory

```sh
rg --hidden -i \
  'BEGIN (ENCRYPTED )?PRIVATE KEY|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|network-attestor-private|signer-private|signing[_ -]?key' \
  . --glob '!node_modules/**' --glob '!**/dist/**' \
  --glob '!**/dist-types/**' --glob '!.agent-build/**' --glob '!pnpm-lock.yaml'

find . -path './node_modules' -prune -o -path './.agent-build' -prune -o \
  -type f \( -iname '*.key' -o -iname '*.p8' -o -iname '*.p12' \
  -o -iname '*.pfx' -o -iname '*.jwk' -o -iname '*.pem' -o -iname '*private*' \) -print

openssl pkey -pubin -in release/network-attestor-public-key.pem -text -noout
```

Observed:

- no private-key marker or private/signing-key file;
- the only key-like file is `release/network-attestor-public-key.pem`;
- OpenSSL identifies it as `ED25519 Public-Key`;
- Dockerfile `COPY` instructions include no key or release directory.

### Final coverage statement

P4 containment is verified by executable tests and independent negative reproduction.
Actual Docker image execution, signed host-helper positive flow, Lima/native isolation,
provider authentication/conformance, and customer package generation remain intentionally
unproven here. Their unavailable prerequisites fail closed, and the runbook assigns them
to the appropriate later release gates without claiming success.

No product code was modified during this final recheck; only this QA report was updated.

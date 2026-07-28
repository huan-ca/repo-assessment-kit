# Repository Assessment Kit — Safety Specification, Contender 4

**Strategy:** capability-gated, explicitly authorized, read-only dynamic assessment with
role/tenant-aware evidence and fail-closed production boundaries  
**Status:** implementation-ready contender  
**Target architecture:** `rak-contract/1.0.0`, `rak-workflow/1.0.0`,
`rak-export-profile/1.0.0`  
**Primary owners:** runtime broker, capability resolver, secret broker, dynamic probe
adapters, evidence admission, workflow engine, reporting, QA

## 1. Safety objective and non-negotiable outcome

Dynamic assessment is optional evidence collection against a disposable, internally
reachable copy of the assessed commit. It is not a penetration test and it is never a
reason to weaken the architecture's static-first guarantees.

The kit MUST:

1. run Playwright and passive HTTP analysis only after a deterministic runtime-capability
   gate and an explicit, scoped operator authorization both succeed;
2. exercise only an immutable, broker-compiled runtime inside the disposable worker VM;
3. use only operator-supplied credentials declared safe for this sandbox and bound to an
   exact role, tenant, origin, run, and purpose;
4. default to passive and read-only actions, with the sole narrow exception of an
   allowlisted session-bootstrap request such as login;
5. prohibit production targets, production data, destructive or state-changing product
   actions, active exploitation, denial of service, and arbitrary fuzzing;
6. account for every planned control as `pass`, `fail`, `partial`, `blocked`,
   `not applicable`, or `not tested`, without converting missing runtime access,
   credentials, roles, tenants, or budget into a pass; and
7. stop and preserve a safe audit record when runtime behavior contradicts the declared
   environment or safety policy.

No operator, provider agent, target repository, Playwright script, ZAP rule, plugin, or
Compose file can grant itself a capability. A provider recommendation to “try anyway” has
no policy authority.

## 2. Scope and compliance boundary

This specification governs:

- runtime candidacy and environment proof;
- operator consent and authorization;
- target credentials, session state, role and tenant isolation;
- Playwright navigation and request interception;
- ZAP Baseline or the locked RAK passive HTTP fallback;
- request, crawl, evidence, time, CPU, memory, PID, and storage budgets;
- runtime security findings and source-to-runtime traceability;
- incident stop, containment, cleanup, and coverage reporting.

The default web profile is technical coverage of applicable OWASP ASVS 5.0.0 Level 1
controls. WSTG 4.2 identifiers may describe only the safe techniques actually executed.
OWASP Top 10:2025 is grouping only. Results MUST NOT be described as certification,
compliance, legal applicability, or proof that no vulnerability exists. Applicability is
only `not-assessed`, `customer-stated`, or `customer-confirmed`.

This product is local and single-operator, not a hosted multi-tenant service. The
assessed product may nevertheless be multi-role or multi-tenant; its authorization
boundaries are test inputs and must not be confused with RAK's local operator session.

## 3. Threat model

### 3.1 Assets

- physical host, host filesystem, Docker/Lima installation, and local network;
- provider credentials/homes, SSH material, agent sockets, and optional-service secrets;
- customer source, sandbox credentials, test data, session cookies, tokens, and tenant
  identifiers;
- the immutable target identity, runtime plan, control plan, evidence, findings, coverage,
  reports, and final package;
- customer and end-user privacy represented in logs, pages, screenshots, HTTP content,
  analytics fixtures, or database snapshots.

### 3.2 Adversaries and failure modes

Treat as untrusted:

- the repository, its instructions, Dockerfiles, Compose files, images, dependencies,
  build steps, services, and rendered web content;
- prompt injection presented to provider agents or in target pages;
- scanner/parser output, redirects, links, forms, service-worker behavior, browser
  downloads, WebSockets, and browser extension/protocol features;
- malformed or mislabeled credentials, endpoints, test accounts, and tenant data;
- a compromised target container, browser process, ZAP process, worker daemon, or provider
  task;
- operator mistakes such as approving a production-looking endpoint, reusing a live
  credential, or assigning the same principal to two claimed tenants.

Principal harm scenarios, in priority order:

1. target or browser escapes its boundary and reads host/provider/SSH/output material;
2. the kit contacts production or a third party, changes state, sends email/SMS/webhooks,
   charges money, or exposes customer data;
3. an authorization check crosses roles or tenants using real user data, or a credential
   leaks through logs, screenshots, traces, ZAP history, SQLite, or the package;
4. dynamic probing creates denial of service, lockout, unbounded cost, or resource
   exhaustion;
5. passive tooling or missing accounts is reported as a positive security verification;
6. observed behavior is attributed to the assessed commit without proving the build,
   image, service, route, account, and request lineage.

### 3.3 Trust and residual boundary

The worker VM and rootless Docker reduce blast radius; they do not prove safety against a
hypervisor or physical-host kernel escape. Explicitly approved build/provider destinations
remain possible exfiltration channels. Passive testing cannot establish absence of
injection, business-logic, or authorization defects. These limitations must remain visible
in the customer report.

## 4. Runtime authorization contract

Architecture DTOs MUST be extended with the following equivalent canonical records; field
names may differ only if the same invariants are schema-enforced.

```ts
type RuntimeTestAuthorization = {
  schemaVersion: "1.0.0";
  authorizationId: string;
  runId: string;
  revision: number;
  snapshotId: string;
  commitSha: string;
  runtimeCandidateId: string;
  compiledPlanDigest: string;
  controlPlanDigest: string;
  environment: "disposable-sandbox";
  targetOrigins: Array<{scheme:"http"|"https"; host:string; port:number}>;
  allowedSafetyClasses: Array<"P0"|"P1"|"P2"|"P3">;
  credentialProfileIds: string[];
  roleTenantMatrixDigest: string;
  approvedDependencyDestinations: string[];
  dataClassification: "synthetic"|"customer-redacted-nonproduction";
  disclosureVersion: string;
  approverRole: string;
  approvedAt: string;
  expiresAt: string;
  revokedAt?: string;
};

type TargetCredentialProfile = {
  schemaVersion: "1.0.0";
  credentialProfileId: string;
  runId: string;
  authorizationId: string;
  secretHandleId: string; // value is never persisted
  principalLabel: string; // non-secret pseudonym
  roleId: string;
  tenantId?: string;      // engagement-local pseudonym
  purpose: "target-login"|"target-service";
  allowedOrigins: string[];
  authBootstrapId: string;
  declaredSandboxOnly: true;
  expiresAt: string;
};
```

Authorization is valid only for the exact run revision, snapshot, commit, compiled plan,
control-plan digest, internal origins, credential profiles, test-data class, and safety
classes displayed to the operator. A changed image digest, service/origin map, route set,
credential profile, role/tenant matrix, control plan, destination, or probe version
invalidates authorization and returns the run to the gate.

The consent screen MUST disclose in plain language:

- what will run, which internal origins will be visited, and that target code is untrusted;
- each account's pseudonymous role and tenant assignment;
- which actions are permitted, which are forbidden, and the exact request/time limits;
- whether page text, headers, screenshots, or sanitized request metadata may enter the
  customer package;
- any external sandbox dependency, the data categories sent, recipient, credential,
  retention warning, and exfiltration residual risk;
- that runtime can be declined or revoked without preventing static assessment.

Consent MUST be an affirmative action and MUST NOT be bundled with source intake, agent
inference consent, build acquisition, optional hosted scanners, or package encryption.
Revocation prevents new requests, revokes unused secret handles, stops probes, destroys
sessions, and reconciles coverage. Expiry is checked before start and before each new
probe group.

## 5. Deterministic runtime-capability gate

The gate runs before credentials are redeemed and before any target image pull, build,
container creation, browser request, or ZAP request beyond locked-tool self-tests.

All of the following MUST pass:

1. **Identity:** snapshot archive and file-manifest digests match the selected full commit;
   canonical source is read-only and before-state is recorded.
2. **Native isolation:** pinned native-architecture worker VM, guest image, broker,
   rootless Docker/Compose, cgroup v2 controllers, firewall policy, helper authentication,
   fences, cleanup journal, and resource ceilings attest successfully.
3. **Runtime policy:** the no-network/no-secret parser resolves local references and the
   compiler rejects every unsafe Compose/Docker construct named by architecture section
   10.2 before acquisition or creation.
4. **Origin:** the test target is a broker-generated internal service origin. The MVP MUST
   NOT dynamically assess a remote target URL. Public, loopback-to-host, link-local,
   metadata, LAN, host-gateway, wildcard, user-info, non-HTTP(S), IP-literal external, or
   redirect-derived origins are rejected.
5. **Environment:** authorization declares `disposable-sandbox`; test data is synthetic
   or specifically approved redacted non-production data. Production snapshots, copied
   production databases, live queues, live object stores, and production API credentials
   are prohibited.
6. **Network:** build acquisition is finished and disconnected. Runtime IPv4, IPv6, DNS,
   UDP, metadata, LAN, and physical-host egress are denied by the guest firewall and the
   broker-created internal network. An approved external sandbox dependency uses a
   separate exact-destination proxy policy; it can never become the tested target origin.
7. **Secrets:** every credential is newly entered or explicitly selected for this run,
   declared sandbox-only, has an unexpired one-use broker handle, and maps to exactly one
   declared principal/role/tenant/purpose/origin. No repository, environment, provider
   home, SSH directory, browser profile, password store, or previous run is searched for
   credentials.
8. **Tool compatibility:** pinned Playwright/Chromium and passive analyzer versions,
   digests, non-root/sandbox policy, interception policy, and output normalizers pass
   release attestations on the native architecture.
9. **Plan safety:** every request-capable step has a safety class, exact origin, method,
   path pattern, account context, expected maximum requests, timeout, evidence fields, and
   mapped planned-control ID. Unknown/custom scripts, repository-authored Playwright,
   target-supplied ZAP configuration, active rules, and arbitrary JavaScript evaluation
   are rejected.
10. **Budgets and cleanup:** VM, services, probes, crawl, evidence, and wall-clock budgets
    are enforceable, adequate host storage is reserved, and emergency stop/destroy works.

If any prerequisite is absent or unsafe, the capability is `blocked` with reason code,
attempted safe steps, affected controls, and follow-up. The workflow MUST NOT offer a
“continue anyway,” host-socket, privileged-DinD, broad-network, broad-mount, or
production-access override.

## 6. Dynamic test safety classes

Only release-owned, reviewed operations are available:

| Class | Allowed behavior | Preconditions | Positive claims it may support |
|---|---|---|---|
| `P0` passive capture | Inspect response status, bounded headers, TLS metadata where applicable, cookies by attribute only, and redacted response-derived signals already returned by another allowed request. ZAP passive rules or RAK passive HTTP only. | Gate passed; no new target request generated by analyzer. | Observed response/header/cookie/cache/browser-policy behavior for that exact response. |
| `P1` anonymous read-only | `GET`, `HEAD`, or `OPTIONS` to an exact internal origin and allowlisted route; follow bounded same-origin redirects; render and navigate without form submission. | Route is statically discovered or operator-seeded; no credential. | Anonymous reachability and behavior of the exercised route. |
| `P2` authenticated read-only | `GET`, `HEAD`, or `OPTIONS` in a fresh isolated browser context for one declared role/tenant. | `P3` bootstrap succeeded for that context; route is allowlisted for that principal. | Behavior and access observed for that role/tenant only. |
| `P3` session bootstrap | One reviewed `POST` to an exact login/token route and optional reviewed logout/revocation request. Fields come only from one credential profile. No account creation, reset, MFA enrollment, consent grant, or remember-device flow. | Exact bootstrap template, response bounds, attempt count, lockout warning, and operator authorization. | Session establishment and session-cookie/token properties; not general mutation safety. |

Everything else is `PX-PROHIBITED`, including:

- `PUT`, `PATCH`, `DELETE`, WebDAV, GraphQL mutations, gRPC mutations, state-changing
  `GET`, arbitrary `POST`, and method-override headers;
- registration, invitation, password reset/change, MFA enrollment, account deletion,
  impersonation, role/tenant administration, consent changes, checkout/payment, purchase,
  refund, booking, publish, send, import, export, upload, webhook, queue/job trigger, and
  API-key creation/revocation;
- file chooser use, uploads, accepted downloads, clipboard, printing, geolocation, camera,
  microphone, notifications, popups, external protocol handlers, browser extensions,
  service-worker persistence, or saved browser profiles;
- brute force, credential stuffing, token guessing, enumeration at scale, fuzzing,
  injection payloads, exploit proof, race testing, cache poisoning, request smuggling,
  active ZAP/API/full scan, Nuclei, port scanning, DoS, load testing, or resource
  exhaustion;
- clicking ambiguous controls or any label suggesting save, submit, send, delete, remove,
  pay, buy, invite, publish, reset, confirm, or approve.

The request interceptor is the final enforcement point. It MUST abort any method,
origin, redirect, content type, WebSocket, EventSource, beacon, background fetch, download,
or service-worker request not explicitly represented in the signed control plan. Page
JavaScript cannot enlarge the allowlist. A blocked browser request is recorded as policy
evidence, never silently retried with broader permissions.

## 7. Role, tenant, and credential strategy

### 7.1 Account isolation

- Each credential profile gets a new incognito browser context, empty storage, isolated
  cookie jar, isolated proxy correlation ID, and no shared cache. Contexts are destroyed
  after their probe group.
- Credentials are delivered from the secret broker to the declared probe only, in
  root-owned tmpfs, after start. They never enter SQLite, command arguments, environment
  dumps, URLs, screenshots, traces, ZAP history, HAR bodies, reports, or package files.
- The probe may type a credential only into the exact reviewed login origin and field.
  Password values and token fields are masked before any screenshot. Operational logs
  store only the credential-profile ID and outcome/reason.
- Cookies and tokens remain inside the context/tmpfs. Evidence may record cookie name
  hashes and security attributes, token type, issuer/audience hashes where safely parsed,
  and lifetime ranges, but never raw values.
- A failed bootstrap is attempted at most once per credential profile. There is no
  automatic password variation, lockout threshold discovery, MFA bypass, or recovery.

### 7.2 Coverage matrix

Before authorization, the engine creates a matrix of:

```text
principal × declared role × declared tenant × route/control × safety class
```

At minimum, anonymous coverage is planned. Authenticated controls require one supplied
standard-user profile. Role-isolation controls require distinct supplied profiles for
each compared role. Tenant-isolation controls require two synthetic or approved
non-production tenants, one separate account in each, and operator-supplied fixture object
identifiers whose disclosure is safe.

Cross-role and cross-tenant checks are limited to read-only access to those declared
fixture identifiers. The kit does not discover identifiers by enumeration, scrape another
tenant, or create/mutate fixtures. It may issue one authorized read request per declared
negative matrix edge. If accounts, tenants, or safe fixture IDs are missing:

- the specific authorization control is `blocked`, not `pass` or `not applicable`;
- completed same-role/same-tenant checks may be `pass` or `fail` independently;
- the aggregate dynamic authorization domain is `partial` when only a subset ran; and
- the report states exactly which roles, tenants, routes, and object relationships were
  not tested.

An HTTP `401`/`403` alone proves only the exact exercised request was denied. A `200`
response is not automatically an authorization failure: the normalizer must compare the
declared expected principal/tenant, response classification, safe fixture identity, and
body-independent evidence. Ambiguous results are `partial` or a low-confidence finding
pending review.

## 8. Playwright and passive-analyzer controls

### 8.1 Playwright

The release-owned Playwright adapter MUST:

- run Chromium as a numeric non-root user with the validated sandbox/seccomp profile,
  read-only root, no capabilities, bounded tmpfs, and no physical-host or provider mounts;
- accept declarative steps only: open context, apply P3 bootstrap template, navigate to
  exact route, wait for bounded selector/load state, read bounded text/attributes,
  capture a sanitized screenshot, and close context;
- disable downloads, uploads, persistent profiles, extensions, devtools attachment from
  outside the probe, video by default, clipboard, permissions, dialogs that could confirm
  mutation, and arbitrary `page.evaluate`;
- intercept from before first navigation, deny non-plan requests, strip URL user-info,
  reject cross-origin redirects, cap redirect chains, and treat mixed content or
  certificate errors as findings/limitations rather than bypassing TLS checks;
- redact at capture, decode/re-encode screenshots, strip metadata, and omit traces unless
  a reviewed trace profile proves bodies, cookies, storage, tokens, and form values are
  excluded.

DOM text is untrusted evidence, never an instruction to the provider or broker. Browser
content is not rendered inside the privileged RAK UI.

### 8.2 ZAP Baseline or RAK passive HTTP

ZAP is allowed only as the locked Baseline/passive adapter:

- traditional spider limited to `GET`/`HEAD` on the exact internal origin;
- passive scan rules only; active scanner, API scan, AJAX spider, scripts, add-ons,
  marketplace updates, authentication scripts, replacer rules, fuzzers, and callbacks are
  disabled;
- no target-owned ZAP config, context, script, certificate, or plugin is loaded;
- ZAP receives no raw credential. It observes the Playwright context through an isolated
  proxy channel after Playwright performs the reviewed login;
- history/request/response bodies are disabled by default. A bounded body excerpt may be
  admitted only after field-level redaction and secret scanning; otherwise evidence uses
  method, normalized path template, status, header names/values approved as non-secret,
  byte counts, timestamps, and hashes.

If the validated multi-architecture ZAP image is unavailable, use the locked RAK passive
HTTP analyzer and report the smaller technique set. The fallback MUST NOT inherit a ZAP
pass or claim equivalent coverage. A clean passive scan supports only the passive controls
actually observed.

## 9. Request and resource budgets

Release-owned defaults are maximums; the operator may lower but not raise them in MVP:

| Budget | Maximum |
|---|---:|
| Dynamic phase wall time | 30 minutes |
| Playwright contexts concurrently | 1 |
| Open pages concurrently | 2 |
| Probe requests concurrently | 2 |
| Request rate per origin | 2 requests/second, burst 2 |
| Total target requests | 500 |
| Distinct normalized URLs | 150 |
| Same-origin redirects per request | 5 |
| Anonymous/authenticated crawl depth | 3 |
| Login attempts per credential profile | 1 |
| Negative role/tenant reads per matrix edge | 1 |
| Request timeout / page deadline | 15 seconds / 30 seconds |
| Response body read | 1 MiB; excess is truncated and labeled |
| Total dynamic raw output | 100 MiB |
| Screenshots | 20, each at most 8 MiB and 20 megapixels before re-encode |
| ZAP spider / passive drain | 10 minutes / 60 seconds |

The architecture's VM ceiling remains 4 CPU, 8 GiB RAM, 40 GiB disk, and 2 hours. The
probe profile MUST additionally assign explicit browser/ZAP CPU, memory, PID, tmpfs, log,
and output limits; target services retain compiled per-service limits. No repository value
can override a limit or replica count.

Stop the affected probe group without retry expansion when:

- the target returns `429` or a rate-limit warning;
- three consecutive requests time out;
- five consecutive `5xx` responses occur;
- request, URL, redirect, body, evidence, disk, memory, PID, or time budget is reached;
- the service health degrades from its pre-probe baseline;
- a policy-denied request, download, cross-origin redirect, external DNS attempt, or
  unexpected mutating method is observed.

Budget exhaustion is `not tested` for work never attempted and `partial` for a defined
subset already exercised. It is never a clean result. QA resource-attack fixtures may
verify the sandbox ceilings in the product's own release environment; customer assessment
runs MUST NOT deliberately perform resource exhaustion.

## 10. Source-to-runtime evidence chain

Every dynamic claim MUST resolve through this lineage:

```text
target commit/snapshot
  → selected runtime candidate and rejected alternatives
  → compiled-plan digest and policy results
  → acquired base-image/dependency digests and build activity
  → produced image digest
  → service ID and exact internal origin
  → control-plan digest and authorization ID
  → tool/probe version and account-context pseudonym
  → sanitized request occurrence
  → sanitized response/screenshot/passive result
  → control result and, if applicable, finding
```

For each request occurrence record: activity/attempt/fence, normalized method and route
template, origin/service ID, safety class, principal-role-tenant pseudonyms, start/end
time, redirect count, status, bounded byte counts, selected non-secret header evidence,
request/response hashes where safe, redaction transformations, tool/image/config digests,
and linked control IDs. Do not record query values, raw cookies, authorization headers,
password/token fields, full bodies, or unbounded DOM.

Runtime findings cite both source evidence when available and runtime occurrences. If a
route is source-inferred but not observed, label it `code-inferred`. If runtime behavior
cannot be tied to the assessed image/commit, it is `unverified` and cannot support a
positive control or decision-critical conclusion. Contradictions between source,
documentation, owner statement, and runtime are `conflicting` and name both evidence
sides.

A screenshot is corroborating evidence, not sole proof of authorization or request
behavior. Missing screenshots do not block nonvisual controls when sanitized protocol
evidence suffices; the manifest explains their absence.

## 11. Privacy and data handling

### 11.1 Dynamic data map

| Data | Purpose | Location | Package rule | Lifetime |
|---|---|---|---|---|
| Consent/authorization metadata | Prove scope and approval | SQLite + canonical audit | Include redacted scope, not secret handles | Run retention |
| Credential values | Establish declared sandbox session | Secret broker memory, encrypted VM envelope, probe tmpfs | Never package or persist | One redemption; erase on context close/stop/expiry |
| Role/tenant/principal labels | Coverage accounting | SQLite/canonical evidence | Pseudonyms only | Run retention |
| Cookies/tokens/session storage | In-context requests | Browser context/tmpfs | Never package | Context lifetime |
| Request/response metadata | Reproduce controls | VM quarantine then admitted evidence | Sanitized fields only | Per engagement retention |
| Bodies/DOM excerpts | Limited evidentiary support | Quarantine under byte limits | Exclude by default; admit redacted derivative only | Raw removed after admission/retention policy |
| Screenshots | Visual evidence | Quarantine, trusted re-encode, admitted object | Only redacted/re-encoded images | Per engagement retention |
| ZAP/Playwright logs | Tool outcome and limitations | Internal operational logs/quarantine | Normalized redacted projection only | Raw internal retention |
| Egress/resource/cleanup audit | Prove boundaries | Helper/broker audit | Redacted summary and limitations | Run retention |

Synthetic data is required by default. Customer-redacted non-production data requires a
separate recorded approval identifying data categories, necessity, source, and retention.
Sensitive personal data, payment card data, health data, government identifiers, private
communications, biometrics, and children's data MUST NOT be imported merely to improve
coverage. If representative testing needs such data or production behavior, dynamic
coverage is blocked and specialist/customer-controlled testing is recommended.

Provider inference and optional hosted scanners are separate external data flows and need
their own disclosures/approvals. Dynamic evidence is not silently sent to either. Final
redaction and seeded-secret scanning cover native JSON, reports, SARIF, screenshots,
logs, manifests, ZIP metadata/content, and optional encrypted-wrapper metadata.

## 12. Coverage honesty rules

Apply these rules mechanically:

- `pass`: the exact planned control and scope ran within policy, evidence was admitted,
  expected behavior was observed, and required review succeeded.
- `fail`: admissible evidence contradicts the expected control behavior. Tool crashes,
  missing accounts, or safety denials are not failures of the target.
- `partial`: a named subset ran, such as one role of three, one tenant pair of two, a
  route subset, truncated response, or passive fallback with reduced rules.
- `blocked`: the control is or may be applicable, but authorization, environment,
  credential, safety, isolation, architecture, or prerequisite policy prevented it.
- `not applicable`: admitted evidence demonstrates the subject is absent; lack of
  discovery or credentials is insufficient.
- `not tested`: applicable work was deliberately excluded, exceeded its safe budget, or
  was not selected despite being possible.

Every non-pass state requires reason code/text, evidence or limitation, affected scope,
attempted safe steps, and follow-up. Planned and reconciled counts must match.

Required dynamic limitation reason codes include:

```text
RUNTIME_NO_SAFE_CANDIDATE
RUNTIME_POLICY_REJECTED
RUNTIME_PLATFORM_UNATTESTED
RUNTIME_BROWSER_UNAVAILABLE
RUNTIME_PASSIVE_TOOL_REDUCED
AUTHORIZATION_MISSING_OR_REVOKED
PRODUCTION_ORIGIN_PROHIBITED
NONPRODUCTION_DATA_UNPROVEN
CREDENTIAL_MISSING_OR_UNSAFE
ROLE_MATRIX_INCOMPLETE
TENANT_MATRIX_INCOMPLETE
SAFE_FIXTURE_ID_MISSING
PROHIBITED_METHOD_OR_ACTION
EGRESS_DEPENDENCY_DENIED
BUDGET_EXHAUSTED
EVIDENCE_REDACTION_REJECTED
RUNTIME_IDENTITY_UNPROVEN
INCIDENT_ABORTED
```

Static assessment and packaging may continue after dynamic blocking. Reports MUST show
static and dynamic coverage separately. “No findings,” “clean,” or a green dashboard
cannot be derived from `blocked`, `not tested`, `partial`, tool failure, malformed output,
or a passive-only result.

## 13. Incident behavior

### 13.1 Stop conditions

Trigger an immediate incident stop when any of the following occurs:

- host socket/mount, provider/SSH credential, host path, generated output, unexpected
  secret, or another run/tenant canary becomes visible to target or probe;
- target/probe reaches or attempts a production, public, LAN, metadata, host-gateway, or
  unapproved dependency destination;
- a mutating/prohibited request is sent or state change, email/SMS/webhook, payment,
  external job, user lockout, or data deletion is observed;
- runtime identity, MAC/fence, firewall, cgroup, origin, or compiled-plan attestation
  changes or fails;
- credential appears in URL, log, trace, screenshot, evidence, SQLite, or package staging;
- target source or admitted evidence changes, resource enforcement fails, or cleanup
  cannot bound the runtime.

### 13.2 Response sequence

1. Atomically stop admission of new probe requests and mark the attempt
   `INTERRUPTED_BY_SAFETY`.
2. Revoke unused secret handles; close browser contexts; remove runtime network access.
3. Send the fenced broker `stop`, then `destroy`; use host emergency stop if the broker
   is unresponsive.
4. Quarantine—not package—minimal bounded incident evidence and protect credential-bearing
   material from display.
5. Re-attest source, host/helper state, egress logs, service state, and cleanup. Preserve
   helper journal/fence evidence.
6. Mark affected controls `blocked` or `partial` with `INCIDENT_ABORTED`; create a target
   finding only when admitted evidence establishes target behavior rather than kit/tool
   failure.
7. Display a plain-language operator notice with what happened, what was contacted or
   changed if known, secrets/accounts potentially affected, cleanup status, and immediate
   customer actions. Do not include secret values.
8. Do not resume the same attempt. A new attempt requires incident review, rotated
   credentials where exposure is possible, corrected policy, clean VM, new authorization,
   and a new fence.

Any confirmed physical-host boundary failure, production contact, secret export, external
side effect, or cleanup escape is a Critical product incident and release blocker. A
denied attempt with no boundary crossing is a recorded High-signal safety event, not proof
of compromise.

## 14. Verification plan and acceptance criteria

QA MUST run the following on native macOS ARM64, macOS x86-64, Linux ARM64, and Linux
x86-64 where runtime functionality is promised:

| ID | Fixture and assertion |
|---|---|
| DYN-01 Gate fail-closed | Missing Lima/rootless/cgroup/firewall/browser/policy attestation prevents credentials and all target requests; static package still completes with exact blocked reasons. |
| DYN-02 Production sentinel | Public, LAN, metadata, host-gateway, external redirect, production-named endpoint, and sentinel live credential are denied before contact; a request recorder proves zero packets. |
| DYN-03 Consent binding | Changing commit, image, plan, origin, account, role/tenant matrix, safety class, destination, or probe digest invalidates approval; revoke/expiry stops new requests. |
| DYN-04 Method enforcement | Fixture attempts background POST, method override, WebSocket, beacon, service worker, cross-origin redirect, download, upload, popup, and protocol handler; interceptor blocks all and records policy evidence. |
| DYN-05 P3 isolation | One login succeeds without credential value in argv/env/log/SQLite/trace/screenshot/ZAP/evidence/package; second automatic attempt is impossible. Wrong recipient, replay, and expired envelope fail. |
| DYN-06 Context isolation | Accounts A/B across roles and tenants cannot observe each other's cookies, cache, storage, proxy IDs, credentials, or undeclared fixture data. Each context is destroyed and tmpfs is cleared. |
| DYN-07 Authorization matrix | Seeded allowed and denied read-only fixtures produce per-edge evidence. Removing a role, tenant, or safe object ID yields `partial`/`blocked`, never pass. |
| DYN-08 Playwright containment | Non-root/sandbox/seccomp, mounts, caps, network, origins, route plan, screenshot re-encode, and body limits are inspected and match the locked profile. Arbitrary evaluate and repository scripts are rejected. |
| DYN-09 Passive-only ZAP | Request recorder proves Baseline uses only allowed GET/HEAD, no active rules/API/AJAX scripts/add-on traffic, no raw credentials, and bounded URLs/time. ARM64 fallback reports reduced technique coverage. |
| DYN-10 Budgets | Rate, concurrency, URL, redirects, time, response size, screenshots, output, memory, PID, log, and disk ceilings terminate safely. `429`, timeouts, `5xx`, and health degradation stop without aggressive retry. |
| DYN-11 Egress and exposure | Runtime DNS/direct IPv4/IPv6/UDP/metadata/LAN/public access fails; internal service traffic works; no target port is reachable from host/LAN; UI remains loopback-only. |
| DYN-12 Integrity lineage | A runtime finding resolves from commit through image/service/authorization/request/evidence. Mismatched digest, stale fence, missing account context, or broken reference rejects admission and prevents pass. |
| DYN-13 Secret/privacy hygiene | Seed credentials, cookies, tokens, PII, SSH/provider canaries, host paths, and secrets in DOM/errors/images. None appears in admitted/package artifacts; rejected raw evidence remains internal and bounded. |
| DYN-14 Coverage semantics | Golden fixtures cover all six states, mixed role/tenant subsets, budget exhaustion, tool failure, no candidate, and ZAP fallback. Counts reconcile and executive language cannot imply untested safety. |
| DYN-15 Incident response | Simulate egress attempt, prohibited mutation, secret-in-log, broker loss, and cleanup residue. Requests stop, handles revoke, VM destroys, same attempt cannot resume, audit and operator notice are complete. |
| DYN-16 Source immutability | Hash snapshot before/after build/probe/incident; target writes only disposable work volumes. Live local source and admitted evidence remain byte-identical. |

Release evidence must include exact tool/image/policy digests, packet/request-recorder
results, mount/capability/cgroup/firewall inspections, resource measurements, coverage
goldens, secret-scan output, cleanup journal, and independently reviewed runtime security
findings.

## 15. Release gates and ownership

### Must fix before ship

1. All sixteen dynamic acceptance groups pass on every promised native platform. A missing
   platform remains a release blocker unless the product owner explicitly narrows the
   platform promise.
2. Linux ARM64/x86-64 Playwright/Chromium containment is proven. Multi-arch ZAP Baseline
   is proven or the locked passive HTTP fallback ships with explicit reduced coverage.
3. Runtime authorization, role/tenant credential profiles, safety classes, request
   interception, and budgets are schema-validated and cannot be bypassed through API,
   provider, plugin, repository, browser, or broker input.
4. Production/public target testing, production credentials/data, active/destructive
   methods, host Docker socket, privileged DinD, host networking, broad mounts, and broad
   runtime egress have no override path.
5. Secret-envelope replay/wrong-recipient/expiry/cleanup tests and dynamic evidence
   redaction pass; no raw credential/session data enters persistent or packaged artifacts.
6. Blocked/partial/not-tested runtime coverage remains visible through API, UI, reports,
   manifest, equivalence certificate, and ZIP validation for both Codex and Claude paths.
7. A separate security reviewer validates every Critical/High dynamic finding and all
   safety-boundary evidence; technical and lay human release reviews remain mandatory.

### Owning lanes

- `packages/runtime`: gate, compiler, safety-class enforcement, budgets, request
  interception, broker/VM incident stop;
- `packages/contracts`: authorization, credential metadata, control plan, coverage,
  reason codes, evidence lineage, OpenAPI schemas;
- `packages/evidence`: sanitized occurrences, screenshot transformation, redaction,
  secret/PII rejection;
- `packages/workflow` and `apps/server`: consent lifecycle, expiry/revocation, state
  transitions, incident orchestration, coverage reconciliation;
- `packages/analyzers`: locked Playwright/ZAP/passive adapters and normalizers;
- `packages/reporting`/`packaging`: honest limitations and exclusion of raw dynamic
  secrets/content;
- QA/security review: native-platform adversarial matrix and independent validation.

## 16. Residual risks and explicit non-claims

Even after these controls:

- a VM/hypervisor/host-kernel or browser zero-day could cross the intended boundary;
- allowed build/provider/dependency channels can carry data to their approved destination;
- a sandbox may differ materially from production configuration, data, identity provider,
  network controls, and scale;
- read-only checks can miss state-dependent, write-path, concurrency, abuse, and
  business-logic vulnerabilities;
- supplied roles, tenants, fixtures, and credentials may be mislabeled or incomplete;
- passive ZAP/HTTP analysis can miss vulnerabilities that require active payloads;
- screenshots and redacted excerpts may still contain customer-sensitive context that
  automated rules fail to recognize;
- successful denial of a few cross-tenant reads does not prove global tenant isolation.

Reports MUST name these risks and scope conclusions to the exact commit, runtime image,
routes, accounts, roles, tenants, techniques, budgets, and time observed. Any need for
production-like data, active exploitation, write-path testing, broad crawling, or real
external integrations is handed off to a separately authorized specialist engagement; it
is not unlocked inside this MVP.

## 17. Go/no-go rule

**No-go for dynamic assessment** unless the exact runtime capability, authorization,
non-production data, credentials, safety classes, network policy, budgets, tools, and
cleanup path all attest. The run proceeds static-only and reports dynamic coverage as
blocked.

**No-go for product release** if any promised platform lacks the adversarial evidence
above; any production/destructive override exists; any credential/session value persists
or packages; any runtime result can pass without traceable evidence; or blocked role,
tenant, browser, passive-analysis, incident, or cleanup coverage can be hidden.

**Go** only when both provider launch paths enforce the same engine-owned dynamic contract,
the native platform matrix passes, independent security review accepts the evidence, and
the customer package states limitations without implying that passive or partial coverage
proves security.

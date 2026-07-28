# Repository Assessment Kit — Safety, Privacy, Credential, and Egress Specification

**Status:** safety contender 2; implementation-ready  
**Target:** `repo-assessment-kit`  
**Strategy:** credentials and network egress are separate, purpose-bound capabilities; no component receives ambient authority  
**Architecture baseline:** `rak-contract/1.0.0`, `rak-workflow/1.0.0`, `rak-export-profile/1.0.0`  
**Date:** 2026-07-27

## 1. Safety position

RAK handles hostile repository content, customer source code, customer business claims,
security findings, screenshots, logs, and credentials. Its normal operation also sends
selected customer material to an external model provider. The primary safety objective is
therefore not merely “do not print secrets.” It is to prevent untrusted repository content
or an over-broad operator action from converting one approved capability into ambient
access to credentials, hosts, networks, customer data, or production.

The release has these hard invariants:

1. A credential is usable by exactly one named component, for one purpose, recipient, run
   or engagement, and lifetime. It is never passed through a general environment, prompt,
   task bundle, log, SQLite row, evidence object, screenshot, manifest, ZIP, or command
   line.
2. Network authority is granted by egress class and workload identity. Approval for one
   class never enables another. There is no generic internet capability.
3. Provider inference is an external customer-data transfer. It requires a versioned
   disclosure and affirmative operator acknowledgement before the first task in a run.
4. Optional hosted tools are off by default and require separate per-run, per-destination,
   per-data-category consent. There is no silent fallback from a local tool to a hosted
   tool.
5. Target runtime/test egress is prohibited in MVP, including DNS. A target that needs
   OAuth, SaaS, telemetry, a remote database, licensing, webhooks, or any production-like
   endpoint is `blocked`; the boundary is not relaxed to gain coverage.
6. Production credentials, production data, and target access to production systems are
   prohibited even if an operator attempts to approve them. Approval cannot override this
   invariant.
7. Every assessed VM is disposable. Customer sandbox secrets are delivered once, inside
   an authenticated runtime-bound envelope, only to the declared recipient in tmpfs, and
   are destroyed with the VM.
8. Revocation stops future use immediately. Cancellation and containment are best effort
   for an in-flight external request, and the UI must state that data already sent to a
   provider or hosted tool cannot be recalled by RAK.
9. Raw provider transcripts, raw screenshots, raw logs, raw quarantine, and provider homes
   are internal data. Only explicitly admitted, redacted derivations may enter a customer
   package.
10. Any uncertainty about identity, destination, scope, secret cleanup, egress
    enforcement, or production classification fails closed. Static assessment continues
    where safe; a blocked dynamic or hosted capability is reported honestly.

These controls strengthen, and do not replace, the frozen architecture. Where the earlier
decision note mentions an opt-in `~/.ssh` mount, the architecture's later exact-resource
rule governs: the implementation must never mount the whole SSH directory.

## 2. Users, assets, and data map

### 2.1 Protected parties

- The customer software owner whose proprietary source, security posture, product facts,
  employee/customer data remnants, and credentials may be present.
- The assessment operator whose provider login, SSH identity, workstation paths, and
  local session state may be exposed.
- Users represented in repository fixtures, logs, screenshots, or databases, even when
  they are not direct users of RAK.
- The model/tool providers receiving approved data and relying on RAK not to send
  prohibited secrets or unlawful material.

### 2.2 Data inventory and handling

| Data class | Examples | Purpose | Allowed locations/recipients | Default retention | Customer export |
|---|---|---|---|---|---|
| Provider authentication | Codex `auth.json`/keyring state; Claude `.credentials.json`; OAuth/API tokens | Authenticate chosen provider CLI | Provider-specific, engagement-specific home only; provider process necessarily uses it | Until explicit engagement cleanup or incident revocation | Never |
| SSH authentication | Dedicated deploy key; agent socket; exact `known_hosts` file | Acquire the approved Git target | One ephemeral acquisition worker only | Worker lifetime; handle/fingerprint metadata to run retention | Never |
| Sandbox target/probe secret | Fixture account, non-production API credential, encryption test value | Exercise an approved non-production control | In-memory/tmpfs secret broker; one runtime-bound VM envelope; declared service or probe only | Until first redemption, expiry, revocation, or VM teardown | Never; only secret-free result |
| Package-protection secret | age passphrase or recipient configuration | Wrap a validated package | Secret broker and packager protected input only | One packaging operation; recipient public key may persist | Never as plaintext |
| Optional-service credential | Hosted scanner token | Invoke exactly one approved service | Service-specific client only | Run/attempt lifetime unless operator expressly selects shorter | Never |
| Repository snapshot | Source, config, test fixtures, history-free commit snapshot | Static/dynamic assessment | Read-only static workers; selected redacted excerpts to provider; verified copy in disposable VM | Life of run | Only admitted evidence excerpts required for findings |
| Product/customer claims | Customers, roles, obligations, workflows, commercial facts | Decision support | SQLite/canonical reports; selected content to provider | Life of run | Yes, after review/redaction |
| Findings/evidence | Vulnerabilities, file paths, code excerpts, tool output | Defensible assessment | Quarantine then admitted CAS; selected content to provider | Life of run | Yes, admitted/redacted only |
| Operational logs/transcripts | JSONL, errors, request metadata, provider exchanges | Resume, diagnosis, audit | Internal run tree only | 30 days by default | Only customer-relevant redacted logs |
| Screenshots | Target pages, possibly user/test data | Runtime evidence | Raw quarantine; trusted transformed/redacted derivative | Raw rejected/quarantine: 7 days after terminal run | Only admitted derivative |
| Package and manifest | Reports, evidence, checksums | Delivery | Frozen staging/package tree | Until explicit package deletion | Yes |

RAK must not collect host home contents, browser cookies, cloud credential directories,
shell history, unrelated SSH keys, unrelated provider sessions, production data, or
repository data beyond the selected snapshot. It must not infer that a legal regime
applies. Operators must identify contractual or legal handling constraints during intake.

### 2.3 External data-flow register

Every run stores a non-secret data-flow register, shown before approval and included in the
coverage/limitations report:

| Flow | Sender identity | Destination | Data potentially sent | Credential | Consent |
|---|---|---|---|---|---|
| Provider inference | Selected provider compartment | Exact provider API endpoints locked for the pinned CLI/auth mode | Prompts, selected source/evidence excerpts, product claims, prior model output, task metadata | Provider home or dedicated invocation secret | Required run acknowledgement of versioned disclosure |
| Git acquisition | Acquisition worker | Exact approved Git host/port | SSH handshake, repository/ref request; host learns client/IP and requested repo | Exact key or agent socket | Source selection plus SSH disclosure |
| Build acquisition | VM build proxy identity | Exact approved registry/package hosts | Dependency/image requests and potentially malicious build payloads | Proxy/service credential only, never provider/SSH/target secret | Per-run destination approval |
| Optional hosted service | Tool-specific client identity | Exact service host/port/path | Precisely enumerated source/evidence/findings categories | Exact service credential | Separate per-run affirmative opt-in |
| Tool update | Maintainer/release job only | Locked vendor sources | Version/update requests | Release credential if required | Never during assessment |
| Target runtime | Target/probe identity | None outside internal VM network | None | Sandbox secrets may exist locally | Not approvable in MVP |

The register records the policy/disclosure version, service legal name, exact destination,
purpose, data categories, anticipated maximum bytes, credential handle ID, approval ID,
approver role, timestamps, and outcome. It records byte counts and destination metadata,
not request or response bodies.

## 3. Threat model

### 3.1 Trust boundaries and adversaries

Untrusted inputs include the assessed repository and all of its instructions, source,
manifests, hooks, Dockerfiles, Compose, images, dependencies, pages, logs, scanner output,
active content, and filenames; model/provider output; optional-service output; and
operator-entered text. The provider CLI is trusted to implement its pinned contract but
is exposed to hostile prompt content and holds its own authentication. The physical host,
host helper, policy/compiler, secret broker, admission/redaction/packaging code, pinned VM
image, and authenticated in-VM broker form the trusted computing base.

Threat actors and failures include:

- a malicious repository author attempting prompt injection, credential theft, source
  exfiltration, host escape, data destruction, or false evidence;
- a compromised dependency, image, scanner parser, provider response, or optional tool;
- an operator who makes a mistaken broad approval, selects a production credential, or
  misunderstands external data transfer;
- cross-run or cross-provider confusion that exposes another engagement's auth or data;
- DNS rebinding, redirects, proxy tunneling, alternate protocols, IPv6, metadata/LAN
  access, and destination drift;
- crashes, retries, stale fences, replay, partial teardown, and disk/log exhaustion that
  leave secrets or resources behind;
- a package recipient encountering secret-bearing, active, misleading, or integrity-
  invalid content.

### 3.2 Highest-priority harm scenarios

| Priority | Scenario | Harm | Required prevention |
|---|---|---|---|
| Critical | Target or prompt reads provider auth and sends it over inference | Provider account compromise and customer data access | Provider credential path deny-read, narrow tool surface, task-view isolation, no target execution in provider compartment, prompt-injection tests, immediate revocation playbook |
| Critical | Target receives SSH/provider/cloud credential or host socket | Host/repository/cloud compromise | Exact mounts; compartment matrix; environment scrubbing; no Docker socket; mount and `/proc/*/environ` probes |
| Critical | Target connects to production or cloud metadata | Unauthorized actions/data exposure | Runtime DNS/IP default deny, metadata/LAN deny, no MVP exception, production sentinel fixtures |
| Critical | Allowed build/service endpoint becomes exfiltration channel | Proprietary source or secret disclosure | Separate identity, secret-free build, explicit destination consent, request/byte caps, no redirect/tunnel, disclosure of residual risk |
| High | Optional tool silently receives source | Undisclosed third-party processing | Off by default; content manifest preview; affirmative exact approval; no fallback |
| High | Raw log/screenshot/package leaks secret or personal data | Customer/user privacy and credential harm | Quarantine, allowlist logging, trusted screenshot derivation, seeded-secret scans, human review where image evidence exists, final ZIP re-open scan |
| High | Replayed/wrong-recipient VM envelope exposes sandbox secret | Credential misuse in hostile target | Authenticated broker key, runtime/run/recipient-bound AEAD, atomic one-use redemption, expiry/revocation, tmpfs cleanup fixtures |
| High | Persistent home/session reused across customer engagements | Cross-customer disclosure | `{engagementId,provider}` home identity, no automatic cross-engagement seeding, explicit cleanup, sentinel isolation |
| Medium | Operator assumes deletion recalls provider-hosted data | False privacy assurance | Clear revocation/deletion language, record external transfer, link provider/customer retention terms selected by operator |

### 3.3 Explicit non-guarantees

- A provider process must possess or use an authentication capability. Filesystem denies
  reduce exposure but do not prove safety against a compromised CLI or model/provider
  channel. Provider-supported short-lived workload identity would be stronger.
- An allowlisted Git, build, provider, or hosted-tool endpoint remains an exfiltration
  channel for data available to that workload. Destination controls do not inspect the
  meaning of encrypted payloads.
- VM isolation does not defeat a hypervisor or physical-host kernel exploit, side channel,
  or provider-side breach.
- RAK can revoke future access and delete its own copies; it cannot recall an external
  request already received or enforce a provider's retention/deletion policy.
- Secret and image redaction is not infallible. Therefore raw screenshots are excluded,
  credentialed screenshots are off by default, and release includes human review of any
  admitted image evidence.

## 4. Credential control plane

### 4.1 Common credential requirements

All secret entry points use a typed channel. The UI posts secrets only to a loopback-bound,
same-origin API with origin/host checks, CSRF protection, `Cache-Control: no-store`, body
size limits, and no request-body logging. Responses contain only an opaque handle and
expiry. Browser fields use `autocomplete="off"` where applicable and are cleared after
submission; RAK does not claim this clears browser/OS memory.

The secret broker:

- stores values only in process memory or a private bounded tmpfs, locked against
  cross-user access where supported;
- has no list-values, readback, export, search, or general resolve API;
- returns metadata only: handle, purpose, recipient, scope, created/expiry/revoked state,
  and remaining-use class;
- uses atomic compare-and-consume for `maxUses: 1`; concurrent redemption permits one
  winner and logs metadata for rejected attempts;
- revokes handles on run cancellation, approval revocation, attempt supersession,
  timeout, crash reconciliation, package completion where applicable, and incident stop;
- never stores the value, digest of a low-entropy value, or recoverable derivative in
  SQLite or audit logs;
- scrubs inherited environment and closes unrelated file descriptors before spawning a
  recipient;
- treats inability to verify cleanup as `SECRET_CLEANUP_UNVERIFIED`, destroys the
  affected compartment/VM, blocks package release, and requires operator action.

Secrets are forbidden in CLI arguments, URLs, process titles, environment variables,
Compose interpolation, Docker inspect-visible fields, image layers, build args, labels,
annotations, checkpoints, core dumps, crash reports, telemetry, or filenames.

### 4.2 Codex authentication

- Normal mode uses an authenticated, private, engagement-specific Codex home created as
  the final numeric non-root UID. `auth.json`, keyring state, sessions, logs, MCP state,
  and config never cross providers or engagements.
- Prefer interactive browser/device login and cached refresh state. The launcher exposes
  `login`, `status`, `interactive`, `run`, `resume`, and `cleanup`; it never automates or
  scrapes a consumer browser login.
- `OPENAI_API_KEY` and unrelated environment variables are never forwarded. If
  `CODEX_API_KEY` invocation mode is supported, it arrives through a dedicated protected
  input, exists only for the single provider process, is unset before any child tool, and
  the provider task is prohibited from executing repository-controlled code.
- Managed policy denies reads of credential/keyring/config paths to model-invoked tools.
  Codex unattended mode remains `workspace-write` with approval `never`; full-access and
  bypass flags are rejected by the normal launcher.
- Only the provider inference destination set for the pinned CLI/auth mode is reachable.
  CLI auto-update, arbitrary MCP/connectors, web browsing, user hooks, and undeclared
  telemetry destinations are disabled. A managed enterprise endpoint is supported only
  when its exact destinations and data processor are disclosed and locked.

### 4.3 Claude Code authentication

- Normal mode uses a private `{engagementId,claude}` full-home volume because credentials,
  sessions, and configuration span `~/.claude`, `~/.claude.json`, and related state. It is
  never shared with Codex or another engagement.
- Support interactive login/status and an approved enterprise/API path. Do not forward
  `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, AWS, Google Cloud, Azure, or general
  `.env` variables by default.
- If API/OAuth token mode is supported, use a dedicated secret input scoped to one
  provider invocation; unset it for every child command. Cloud-provider credential modes
  are **not release-supported** until separately threat-modeled and tested because their
  ambient SDK chains and metadata flows materially widen authority.
- Managed settings and sandbox deny reads of credential/config paths and allow only RAK's
  narrow command surface. Unattended mode uses `dontAsk`; `bypassPermissions` and
  dangerous-skip flags are rejected.
- Auto-update, arbitrary user/project MCP servers, hooks, plugins, and undeclared
  destinations are disabled. The assessed repository is never the Claude project root.

### 4.4 Provider task and source boundary

Providers receive a generated, read-only task view, not the live source, `.git`, source
parent, acquisition workspace, target runtime, package staging, SQLite, secret broker,
host helper, or Docker/Lima sockets. The engine selects only the minimum excerpts and
structured evidence required for the task. Before provider dispatch it:

1. scans selected text for configured secret patterns and every known seeded/supplied
   secret value;
2. replaces detected secrets with stable run-local redaction tokens;
3. labels all target-derived text as untrusted data, not instructions;
4. records category, count, byte size, evidence IDs, redaction count, provider, model, and
   destination disclosure version, but never prompt bodies in audit logs;
5. enforces per-task and per-run byte ceilings;
6. rejects a task if it requires unredacted credentials, raw database dumps, raw
   screenshots, or another prohibited category.

Provider output is a proposal placed in quarantine. It cannot approve capabilities, alter
policy, redeem a credential, contact the helper, pass a control, admit evidence, or package
content. The deterministic engine revalidates all output.

### 4.5 SSH acquisition

- Default recommendation is a repository-scoped, read-only, short-lived deploy key. The
  UI warns that an SSH agent may expose every loaded identity for signing and is broader.
- Register one exact regular private-key file **or** one exact agent socket, plus one exact
  `known_hosts` file. Never mount `~/.ssh`, the host home, SSH config, cloud config, or a
  parent directory.
- The acquisition worker alone sees the selected credential. It runs non-root with a
  read-only root, empty tmpfs home, no shell, fixed Git argv, disabled credential helpers,
  strict host-key checking, no URL credentials, no hooks, no LFS smudge, and no
  submodules/LFS unless separately approved.
- Egress is exact normalized Git host and port. Redirects, proxy variables, `ProxyCommand`,
  `Match exec`, alternate protocols, unknown host keys, changed host keys, and additional
  hosts fail closed. Submodule/LFS hosts require distinct approvals.
- When an agent socket is used, acquisition is serialized, the socket is removed at worker
  exit, and the report records “host agent used” plus public-key fingerprint(s), never
  agent listings, comments, or signatures. RAK cannot enforce repository-only use on a
  generic agent; this residual risk must be acknowledged.
- Clone completion closes the worker and releases mounts before any repository content is
  analyzed. Provider, analyzer, VM, browser, and package processes cannot see SSH material.

### 4.6 Sandbox and package secrets

Only credentials created for, or explicitly confirmed as belonging to, a non-production
sandbox are admissible. Required metadata is owner, system, purpose, recipient service,
environment classification, expiry, revocation contact, and allowed operations. RAK stores
this metadata but not the value. “Same credential as production,” “production read-only,”
unknown environment, wildcard scope, or missing revocation path is prohibited.

Sandbox credentials must have least privilege, short expiry, test-only data, no billing or
destructive authority, and no privilege to cross into production. The engine compares
endpoint/credential metadata to configurable production sentinels and blocks on a match or
uncertainty. Operator attestation alone cannot override a known production match.

An age recipient public key is non-secret and may be stored. A passphrase is one-use via
the broker. It never enters argv/environment/history and is not rendered back to the
browser. If RAK generates a passphrase, it displays it once over the protected local
session, requires out-of-band delivery confirmation, and retains no recoverable copy.

## 5. Destination consent and egress enforcement

### 5.1 Approval semantics

An effective egress approval must bind:

`runId + capabilityId + workloadIdentity + scheme + normalizedHost + port + pathPrefix +
methods + purpose + recipientService + dataCategories + maximumBytes + credentialHandleId
+ disclosureVersion + approverRole + approvedAt + expiresAt`.

Empty, wildcard, IP-range, suffix-only, or “any dependency host” destinations are invalid.
Approval is deny-by-default, additive only for exact entries, non-transferable across runs,
and cannot authorize production or target runtime egress. Redirect following is disabled
unless every hop is separately approved. URL userinfo and fragments are rejected.

The consent screen must show, without dark patterns:

- who receives the data and for what purpose;
- exact destination(s);
- concrete categories and representative file/evidence paths, counts, and maximum bytes;
- whether source/code, findings, product facts, personal data, or security-sensitive data
  may be included;
- which credential is used, by metadata label only;
- known provider/service retention, training, region, subprocessors, and deletion terms,
  or “not verified” with a link/version supplied by the operator/maintainer;
- the residual exfiltration risk and the effect of deny/revoke;
- that prior transfers cannot be recalled.

Approve and deny controls receive equal visual weight. Consent is never bundled with
unrelated capabilities. No prechecked approval, countdown, repeated coercive prompt, or
“recommended” label may diminish the choice.

### 5.2 Network implementation

Enforcement is outside the untrusted workload:

- Each egress class has a distinct network namespace/service identity and proxy policy.
- DNS uses the trusted proxy/resolver. The policy validates every resolved address and
  rejects loopback, link-local, RFC1918/ULA, multicast, LAN, host gateway, VM control,
  container control, and cloud metadata ranges unless that exact private Git destination
  was registered at launch.
- Resolution is pinned for the connection/approval lifetime; connection-time IP is
  rechecked. Direct IP, custom DNS, DoH/DoT, UDP, QUIC, raw sockets, CONNECT tunneling,
  protocol upgrades, and TLS interception by the workload are denied.
- TLS certificate and hostname validation are mandatory. Plain HTTP is prohibited except
  internal VM service traffic. Operator-added CAs require installation-level setup and
  are recorded; repository-provided CAs are rejected.
- The proxy enforces scheme, host, port, path prefix, method, request/response/total byte
  ceilings, duration, redirect policy, and concurrency. Policy is not delegated to
  application environment variables alone.
- Audit receipts contain workload, approval, normalized destination, resolved IP class,
  method class, start/end, bytes, decision, and policy digest; never headers, query values,
  cookies, tokens, bodies, or full URLs that may contain secrets.

### 5.3 Class-specific policy

**Provider inference.** Required only for the selected provider task and exact locked
provider endpoints. Data dispatch requires the run disclosure acknowledgement. The
provider compartment cannot reach Git, registries, optional tools, target services, host
LAN, or metadata. Model web-search/connectors are disabled for MVP.

**Git acquisition.** Exact Git host/port only, from the acquisition worker, for the
registered repository/ref. SSH host keys are pinned. No provider inference or generic
package access exists in that namespace.

**Build acquisition.** Off by default until a capability plan enumerates immutable image
digests and dependency destinations. Prefer release-owned caches and offline builds. The
build proxy has no provider, SSH, sandbox, optional-service, or package-protection secret.
Its network is physically removed before runtime. Because an approved package endpoint can
receive malicious payloads, the disclosure must say that source available to a build may
be exfiltrated; byte and method caps reduce but do not remove this risk.

**Target runtime/test.** External IPv4, IPv6, and DNS are denied at the VM's root-owned
firewall and at the broker-created `internal: true` network. No target ports are published.
The trusted probe uses inner service names. No approval type exists to relax this in MVP.

**Optional hosted services.** Disabled by default, never auto-selected, and never a
fallback after a local failure. Each service needs a release-owned adapter, pinned
destination policy, separate credential, data minimization transform, per-run content
manifest, explicit consent, response size/time caps, and quarantine/admission. A changed
destination, service identity, data category, disclosure version, or credential requires
new consent.

**Tool updates.** No scanner, schema, ruleset, CLI, image, browser, or agent update occurs
during assessment. Updates happen only in the reviewed release pipeline and produce locked
digests and license/provenance evidence.

### 5.4 Revocation

Revocation is an idempotent durable event. The engine atomically marks the approval and
associated secret handles revoked before scheduling cancellation. It then:

1. blocks new dispatch, redemption, retry, resume, redirect, and connection establishment;
2. closes the class proxy policy and cancels queued work;
3. sends bounded cancellation to in-flight provider/tool/build work;
4. destroys the affected acquisition worker or VM when it held a credential;
5. records whether an external request had begun, destination, bytes sent, and whether
   cancellation was confirmed, without recording content;
6. changes affected controls to `blocked`/`not tested` and creates a limitation;
7. instructs the operator which external credential must be revoked/rotated at its issuer.

RAK does not claim external token revocation unless it receives and records a verified
issuer response. Deleting a run does not delete provider/service copies; the UI and
deletion receipt say so.

## 6. One-use VM secret delivery

The architecture's X25519/HKDF-SHA-256/AES-256-GCM envelope is approved only with these
additional requirements:

1. The broker generates a fresh X25519 key pair inside the new VM before target data is
   staged. The attestation binds the public key, runtime creation nonce, guest image
   digest, broker binary digest, firewall policy digest, `runId`, and `runtimeId` to the
   authenticated host-helper/broker control channel. An unattested or reused key blocks
   delivery.
2. The server validates the X25519 public key encoding and rejects low-order/all-zero
   shared secrets. It uses fresh ephemeral sender keys per envelope.
3. HKDF uses SHA-256 with an independent random salt and a fixed versioned info string
   containing `rak-vm-secret/1`, run, runtime, envelope, purpose, and recipient. Derived
   keys are never reused.
4. AES-256-GCM uses a cryptographically random 96-bit nonce unique under the derived key.
   JCS associated data includes protocol version, run/runtime/creation nonce, envelope,
   handle, purpose, exact recipient service/probe, approval, issue/expiry, and max uses.
5. The broker checks fence, attestation, approval state, recipient, purpose, expiry, nonce,
   and replay journal before decryption. It journals the one-use transition durably before
   exposing plaintext. Any mismatch is terminal for that envelope.
6. Plaintext is written as a mode-`0400` file in a recipient-specific, root-owned tmpfs
   mount. It is never an environment variable, Compose secret reference to a host file,
   image layer, command argument, log field, checkpoint, or general shared volume.
7. A service receives only its declared secret. The trusted probe uses a distinct handle.
   Provider and SSH credentials are invalid purposes at schema and runtime layers.
8. At process stop, control completion, expiry, cancellation, pause, crash, or revocation,
   the file is unlinked and the tmpfs unmounted. “Zeroing” is best effort on modern
   memory/storage and must not be described as forensic erasure. VM disk encryption or
   swap-off is required; plaintext must never reach persistent guest disk or swap.
9. The entire VM/disk is destroyed after declared evidence extraction. A failed cleanup,
   surviving mount, envelope, process, network, disk, or secret canary is a blocking
   residue incident, not a successful teardown.

Runtime egress denial is a required companion control: a target can always read a secret
intentionally given to it, so safety depends on that value being sandbox-only, least
privilege, non-production, and unable to leave the VM.

## 7. Logs, transcripts, screenshots, and packages

### 7.1 Logging

Use schema allowlists, not post-hoc string deletion. Allowed operational fields are opaque
IDs, state transitions, timing, bounded reason codes, tool/policy versions, destination
host/port/path-policy ID, byte counts, redaction counts, and cleanup state. Prohibited
fields include request/response bodies, prompts, provider output bodies, source excerpts,
environment, headers, cookies, query strings, URLs with parameters, credentials,
filesystem home paths, private repository URLs, SSH signatures, and passphrases.

Stdout/stderr and provider JSONL go to a bounded internal transcript collector with
credential-value scanning and path scrubbing. They are never canonical evidence and never
packaged raw. Crash dumps and core dumps are disabled. Log files are mode `0600`, size and
count bounded, and retained 30 days unless shortened. A log-flood fixture must not consume
storage reserve or bypass redaction.

### 7.2 Screenshots

- Screenshots are off by default for credentialed/authenticated controls. Enable them only
  when they add material evidence and an operator approves the planned pages/data class.
- The probe captures only an allowlisted target origin, viewport, and control step. It
  closes browser password managers, notifications, download UI, devtools, and host chrome;
  never captures the RAK UI, provider UI, terminal, cookies, storage, headers, or secrets.
- Before capture, a trusted probe applies release-owned masking selectors for password,
  token, payment, personal-data, and customer-configured fields. Target-provided masking
  instructions are untrusted.
- Raw images remain in quarantine and are never previewed or packaged. A trusted worker
  decodes under limits, strips metadata/color-profile comments, masks configured regions,
  optionally performs OCR/known-secret detection, and re-encodes PNG/JPEG. OCR is only a
  warning layer, not proof of absence.
- Every admitted screenshot requires a human visual review that confirms materiality,
  absence of visible secrets/personal data beyond approved need, and correct masking.
  Rejection creates a limitation; it does not force unsafe recapture.
- The final package scanner checks image metadata and known secret values where technically
  possible. A credentialed screenshot without completed human review blocks release.

### 7.3 Redaction and package release

Redaction derives a new immutable occurrence; raw evidence is never overwritten. The
redaction engine scans all text, structured data, archive metadata, filenames, manifests,
checksums, screenshots, and ZIP bytes for:

- every seeded and supplied secret value and safe encodings/known token forms;
- provider and SSH credential markers, PEM/private-key material, authorization/cookie
  headers, cloud token patterns, `.env` secrets, and known sandbox identifiers;
- absolute host/home paths, user names, private repository locators, and prohibited raw
  customer identifiers;
- active content and unsafe archive paths.

For low-entropy secrets, matching uses the exact value only inside the protected scanner;
no persistent hash set is created. A scan timeout, parser failure, unsupported included
format, or unreadable archive is failure, not “clean.”

Package download is disabled until admission, redaction, independent reviews, frozen
staging, manifest/checksum validation, ZIP creation, and fresh-process ZIP reopen all
pass. Internal DB, provider homes/transcripts, handles, approvals containing sensitive
locators, raw quarantine, raw screenshots, and internal debug logs are never included.

## 8. Production prohibition

“No production” is an enforceable policy, not a warning. The following always reject:

- credentials labeled production, shared with production, environment-unknown, wildcard,
  owner-unknown, non-revocable, or capable of destructive/billing/administrative actions;
- endpoints labeled or detected as production, customer-live, corporate control plane,
  cloud metadata, public SaaS tenant, production database, or unknown;
- repository commands, Compose, test config, redirects, DNS answers, or browser navigation
  that attempt an undeclared external origin;
- use of a real customer account, real personal data, production-derived database dump, or
  production OAuth client;
- “read-only production,” since reading still exposes data and creates audit/availability
  risk;
- destructive verbs/actions, denial-of-service tests, social engineering, exploit
  persistence, or external side effects.

Before dynamic admission, the engine compiles repository endpoint indicators without
executing code and compares them with operator-maintained production sentinel hosts,
account/tenant IDs, database names, certificate names, and credential metadata. Matches
are recorded as sanitized reason codes. A match or inability to distinguish sandbox from
production blocks dynamic controls while preserving static assessment.

Runtime test data must be synthetic or explicitly approved de-identified sandbox data.
RAK must not claim anonymization merely because direct identifiers were removed.

## 9. Privacy and governance

RAK is local software, but provider/optional-tool dispatch is external processing. The
customer/operator remains responsible for authority to process and transfer repository
and personal data. If the engagement contains personal data, the operator must confirm
applicable contract, retention, residency, and data-subject handling requirements before
external dispatch. Where GDPR applies, this implements data minimization, purpose
limitation, storage limitation, processor transparency, and security controls but does not
by itself satisfy Articles 5, 28, 32, or Chapter V. Where CCPA/CPRA applies, the operator
must separately confirm service-provider/contractor restrictions and consumer-request
handling. These are conditional implementation notes, not applicability or compliance
claims.

RAK must provide:

- pre-run retention choices no longer than product defaults;
- a data-flow and subprocessor/service record versioned to the run;
- export of the run's approvals, revocations, processing categories, and deletion state
  without secret values;
- two-phase deletion with the architecture's scopes and recovery window;
- prominent explanation that provider/service deletion is external and not performed by
  local run deletion;
- no behavioral advertising, sale, cross-customer model training claim, or telemetry by
  RAK. If a provider's terms permit training/retention, that fact must be disclosed rather
  than contradicted by RAK.

Customer source or findings must never be used as product analytics, test fixtures,
benchmarks, demonstrations, or maintainer training data without a separate written
authorization outside ordinary run consent.

## 10. Abuse, rate, and resource controls

- One active provider task and one active dynamic VM by default; provider, Git, build, and
  optional service calls have per-run request, concurrency, byte, and wall-clock limits.
- Repeated auth failures, host-key changes, approval mismatches, egress denials, replay,
  secret redemption failures, and package scan failures trigger exponential local
  backoff and a review-required state; they are never retried with broader permissions.
- The VM has fixed CPU/RAM/disk/time limits and host-side emergency stop. Target services
  have CPU/memory/PID/replica/tmpfs/log limits.
- No scanner or probe may perform destructive testing, brute force, credential stuffing,
  high-rate enumeration, DoS, social engineering, persistence, or lateral movement.
- A provider or target cannot request more quota, new destinations, or credentials
  directly. Only the operator-facing capability workflow can propose a new approval.

## 11. Incident behavior

### 11.1 Detection triggers

Treat as a security incident: known secret in any output; access/read attempt against a
credential path; unexpected egress or redirect; production sentinel match after dispatch;
host-key mismatch; wrong-recipient/replayed envelope; target port or host socket exposure;
provider/home cross-engagement sentinel; VM cleanup residue; package released before all
gates; or evidence that an external service received an unapproved category.

### 11.2 Automated containment

On a trigger, the engine must:

1. atomically move the run to `SECURITY_HOLD`, invalidate leases/fences, revoke all run
   approvals and secret handles, and disable package preview/download;
2. deny all class egress, cancel provider/tool/acquisition work, emergency-stop and destroy
   the VM, and reconcile helper resources;
3. quarantine affected artifacts without rendering them; prevent resume and automated
   retry;
4. preserve a minimal tamper-evident incident record containing IDs, times, policy
   digests, destination metadata, byte counts, and cleanup state—never secret values or
   newly copied source;
5. show operator actions for issuer-side provider token, SSH key/agent, sandbox credential,
   hosted-tool token, and package-passphrase revocation as applicable.

Containment does not auto-delete evidence needed to understand the incident. It also does
not contact external people or rotate/delete external credentials without explicit
operator action.

### 11.3 Recovery and notification

Resume requires documented triage, issuer-side revocation/rotation confirmation where a
credential might have escaped, complete resource cleanup, a new fenced attempt, new
approvals, and independent security review. Previously admitted evidence remains immutable
and is superseded if invalid.

The incident summary must state what may have been exposed, to which destination, during
what interval, how many bytes/requests, what remains unknown, what was contained, which
external deletion/revocation is unverified, and which customer notification obligations
require human/legal determination. RAK never claims “no exposure” solely because secret
scanning found no match.

## 12. Verification and acceptance criteria

All fixtures use synthetic repositories, non-production accounts, canary secrets, and
controlled destinations. No acceptance test may use real production access.

### 12.1 Provider and home isolation

1. On Linux AMD64/ARM64 pinned images and every supported host matrix run, verify fixed
   non-root UID, exact CLI version, updater disabled, private home permissions, no Docker
   socket, and only declared mounts.
2. Seed unique secrets in Codex engagement A, Codex engagement B, and Claude engagement A.
   Prove every other provider/engagement, analyzer, acquisition worker, VM, target, probe,
   web/server, and packager cannot read them.
3. Use repository prompt injections requesting direct read, shell read, encoding, copying,
   screenshotting, logging, and inference transmission of provider auth/config. Assert
   denial and absence of canaries from stdout, stderr, JSONL, provider task metadata,
   quarantine, generated tree, screenshots, manifests, ZIP, and network test receiver.
4. Force denied tool/network access in unattended Codex and Claude modes; require non-zero
   structured failure, no approval prompt, no bypass, and honest blocked coverage.
5. Verify auth status/resume works after container restart within the same engagement and
   fails without explicit action across engagements. Cleanup makes the old home unusable.
6. Claude Code's pinned real image, auth modes, permission rules, and destination set must
   pass empirically; documentation-only conformance is a release blocker.

### 12.2 SSH

1. Acquire with a dedicated key and separately with an agent socket. Inspect all container
   mounts/environments and generated/package content; only the ephemeral worker sees the
   exact selected resource and no secret/canary escapes.
2. Reject unknown/changed host key, URL credentials, `ProxyCommand`, redirects, alternate
   host, symlinked key, broad SSH directory, extra submodule/LFS host, and Git config/hook
   execution before repository code runs.
3. Kill acquisition at every phase; assert worker, mount, socket, temp home, and partial
   snapshot are gone or trigger `SECURITY_HOLD`.
4. Verify source integrity and exact commit/snapshot digest after acquisition.

### 12.3 Egress and consent

1. For each egress class, prove only its workload can reach only exact approved
   destinations. Direct IP, DNS rebinding, alternate DNS, IPv6, UDP/QUIC, redirect,
   CONNECT, path escape, credential-in-URL, metadata, loopback, LAN, host gateway, and
   another class destination must fail.
2. Deny or revoke provider/build/optional consent before dispatch, while queued, and while
   in flight. Assert future bytes are blocked, cancellation/uncertainty is recorded, and
   controls become blocked without fabricating success.
3. Change one approval dimension at a time—host, port, path, method, category, recipient,
   credential, disclosure version, expiry, run—and require fresh consent.
4. Confirm optional service remains off after local scanner failure and that no source,
   finding, or evidence is uploaded without its exact content-manifest approval.
5. In build phase, permit a controlled repository endpoint and demonstrate the recorded
   residual exfiltration channel/byte cap. Then remove the build network and prove all
   runtime IPv4/IPv6/DNS egress fails while internal service/probe traffic works.
6. From repository config and browser redirects, attempt known production, metadata, SaaS,
   localhost, and unknown endpoints with sentinel credentials. No connection or DNS query
   may reach them.

### 12.4 One-use VM secrets

1. Pass correct-recipient delivery once; reject second use, concurrent second redemption,
   stale fence, expired/revoked handle, wrong run/runtime/creation nonce, wrong
   purpose/recipient/approval, modified ciphertext/AAD/tag, reused nonce/key, unattested
   broker key, low-order public key, and pre-restart replay.
2. Inspect `/proc`, Docker/Compose inspect, environment, argv, labels, checkpoints, disk,
   swap, logs, screenshots, evidence, image layers, and crash output. The secret may
   appear only in the declared tmpfs file visible to the recipient.
3. Kill server/helper/broker/recipient/VM at each envelope lifecycle point. Assert atomic
   consume semantics, tmpfs removal, no persistent disk/swap copy, full VM/disk teardown,
   and release block on uncertainty.
4. Give the target its intended sandbox secret and attempt inference, DNS, HTTP(S), covert
   alternate protocol, and evidence/log exfiltration. Egress and artifact admission must
   prevent the value leaving quarantine/VM.

### 12.5 Logs, screenshots, redaction, package, and deletion

1. Seed distinct secrets in repository, provider home, SSH, sandbox, optional service,
   package passphrase, environment, URL query/header/cookie, and visible image. Exercise
   success, error, timeout, retry, crash, resume, and packaging. None may appear in any
   admitted/exported artifact or ZIP bytes/metadata.
2. Verify structured logs reject unexpected fields and bodies. Flood stdout/stderr and
   screenshot output; quotas preserve storage reserve and do not produce partial clean
   artifacts.
3. For credentialed screenshots, verify default-off behavior, trusted masking, metadata
   stripping, raw quarantine exclusion, independent visual review, and release block for
   absent/failed review.
4. Force scanner timeout, unreadable format, OCR uncertainty, secret match, broken
   redaction lineage, active content, and ZIP path trick. Every case blocks release.
5. Reopen ZIP in a fresh process and scan the entire uncompressed tree plus metadata.
   Confirm provider homes/transcripts, SQLite, handles, raw quarantine, raw screenshots,
   private locators, and internal logs are absent.
6. Revoke/delete a run and verify local two-phase deletion and tombstone behavior. The UI
   must not state that provider/hosted-service copies were deleted.

### 12.6 Incident and production gates

1. Trigger each incident class and prove atomic `SECURITY_HOLD`, egress deny, handle
   revocation, cancellation, VM destruction, package-download disablement, sanitized
   incident record, and human recovery gate.
2. Test production-labeled, shared, read-only, unknown, and sentinel-matching credentials
   and endpoints. All must be rejected even with an attempted approval.
3. Verify static assessment can finish with precise blocked runtime/hosted coverage after
   a safe denial; security hold itself cannot be silently downgraded.

## 13. Release gates

### 13.1 Must-fix before ship

Release is **NO-GO** unless all are true:

- Both real pinned provider images pass auth, permission, prompt-injection, home isolation,
  signal, resume, destination, and secret-output tests on the supported architecture
  matrix. Claude may not remain documentation-only.
- Provider data flow is accurately disclosed and versioned; exact required destinations
  for every supported auth mode are known and enforced. Unknown telemetry destinations
  fail rather than broaden access.
- No normal launcher path exposes bypass/full-access mode, general `.env`, host home,
  broad SSH directory, cloud credential directory, Docker/Lima socket, or cross-engagement
  provider state.
- The approval schema and UI implement exact destinations, data categories, content
  preview, byte limits, expiry, revocation, and non-recall disclosure.
- Root-owned default-deny VM firewall and internal target network pass native
  IPv4/IPv6/DNS/metadata/LAN/proxy-bypass tests on macOS/Linux AMD64/ARM64.
- Target runtime egress exceptions do not exist in MVP.
- The VM envelope profile receives independent cryptographic/security review and passes
  replay, wrong-recipient, atomic-use, persistence, crash, and cleanup fixtures.
- Production classification/sentinel controls reject all known and uncertain production
  cases; no approval override exists.
- Seeded-secret, log, screenshot, package, and deletion suites pass with zero leaked
  provider, SSH, sandbox, optional-service, or passphrase values.
- Revocation and `SECURITY_HOLD` are durable, fail closed, and disable package release.
- Optional hosted services are either absent or each has a release-owned adapter, exact
  destination/data disclosure, separate credential/consent, quarantine, and conformance.
- Independent security review has no unresolved Critical or High finding. VM/helper
  cleanup residue, unknown credential exposure, or unknown external data transfer is a
  blocking High/Critical condition.

### 13.2 May ship with explicit limitation

- Dynamic runtime unavailable because Lima/rootless/cgroup/browser capability is blocked,
  provided static assessment is complete and coverage is honest.
- Customer denies provider-independent optional service or build acquisition, provided no
  transfer occurs and affected depth is marked blocked/partial.
- Screenshots omitted because safe capture or human review is unavailable, provided the
  package explains the limitation and contains no unsafe substitute.
- A repository needs external runtime integrations, privileged/container-host features,
  or production-like data, provided runtime remains blocked and no boundary is relaxed.

## 14. Residual risk and future hardening

The largest accepted residual risk is that the provider CLI process holds provider
authority while processing hostile, target-derived content and can send inference traffic
to an approved provider endpoint. Deny-read rules, narrow task views, compartmentalization,
and prompt-injection tests materially reduce risk but do not make the provider process a
non-bypassable secret boundary. Before claiming safe operation against intentionally
malicious repositories, adopt provider-supported short-lived workload identity or a
locally authenticated credential/inference broker that keeps long-lived tokens outside
the model/tool process, and validate it separately for Codex and Claude.

Other residual risks are explicitly accepted only with disclosure: approved build/provider
destinations can receive malicious payloads; generic SSH agent forwarding can sign with
broader identities; external service retention is not controlled by local deletion; image
redaction can miss visual secrets; and VM/hypervisor compromise is outside the inner
container guarantees.

Future work must not silently weaken MVP controls. Cloud-provider Claude credential chains,
external target-runtime test endpoints, provider connectors/MCP, hosted telemetry,
customer-managed CAs, or signature/non-repudiation profiles each require a new threat
model, contract version, consent disclosure, adversarial fixtures, and release review.

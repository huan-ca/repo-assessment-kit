# Verdict: FAIL

| Step | Status | Evidence |
|---|---|---|
| 1. Bootstrap a live loopback session; clear the URL fragment; establish an HttpOnly, SameSite=Strict cookie; keep browser storage empty | PASS | `.agent-build/test-runs/release/browser-live/01-bootstrap-live-home.png`; `observations.json` records URL `http://127.0.0.1:4173/`, an HttpOnly `rak_session` cookie with `SameSite=Strict`, and empty local/session storage |
| 2. Discover readiness, launcher remediation, help, glossary, keyboard help, and local-only boundary | PASS | `.agent-build/test-runs/release/browser-live/02-readiness.png`, `.agent-build/test-runs/release/browser-live/03-help.png` |
| 3. Show an honest live empty state without a sample/fixture run | PASS | `.agent-build/test-runs/release/browser-live/04-live-empty.png` |
| 4. Reject incomplete setup visibly | PASS | `.agent-build/test-runs/release/browser-live/05-invalid-setup.png` |
| 5. Create a live setup draft and traverse all ten product-context topics | PASS | `.agent-build/test-runs/release/browser-live/06-discovery-topic-1.png`, `.agent-build/test-runs/release/browser-live/10-review-all-ten.png`; live API evidence: `POST /api/v1/runs` 201 and `PUT .../discovery` 200 |
| 6. Preserve an explicit unknown with reason, confidence effect, coverage effect, and follow-up | PASS | `.agent-build/test-runs/release/browser-live/07-explicit-unknown-topic-10.png`, `.agent-build/test-runs/release/browser-live/10-review-all-ten.png` |
| 7. Present equal access denials and keep a typed credential out of local/session storage | PASS | `.agent-build/test-runs/release/browser-live/08-access-decisions.png`, `.agent-build/test-runs/release/browser-live/09b-secret-boundary-denials.png`; input type was `password`, both storage areas remained `{}` |
| 8. Upload a one-use credential and then save access decisions | FAIL | `.agent-build/test-runs/release/browser-live/09-secret-cleared-denials.png`; upload returned 201/204 and cleared the value, but the subsequent approvals request returned HTTP 412 because the UI retained the pre-upload row version |
| 9. Prepare the registered local source and enter a runnable assessment | BLOCKED | `.agent-build/test-runs/release/browser-live/11-prepare-source-result.png`; resolve-target was accepted (202), then recorded `lim_target-resolution-failed`, leaving the snapshot **Not prepared** and no phase running because the supplied target repository has no committed `HEAD` |
| 10. Show static-only/runtime-blocked truth without claiming a real provider or dynamic run | PASS | `.agent-build/test-runs/release/browser-live/11-prepare-source-result.png`; the live run says runtime checks could not run safely, static evidence remains useful, and snapshot is not prepared |
| 11. Pause, cancel, and recovery against the live run | BLOCKED | `.agent-build/test-runs/release/browser-live/15-pause-result.png`, `.agent-build/test-runs/release/browser-live/16-cancel-result.png`; after restart the UI substituted the `northstar-portal` preview run and explicitly said neither operation was sent |
| 12. Reload persisted live data without fixture substitution | FAIL | `.agent-build/test-runs/release/browser-live/15-pause-result.png`; the created project was `browser-live`, but a fresh authenticated session displayed fixture project `northstar-portal`, “Sample activity,” and preview-only actions |
| 13. Inspect real findings, supporting evidence, six-state coverage, equal-criteria decision, and package limitations | BLOCKED | `.agent-build/test-runs/release/browser-live/11-prepare-source-result.png`; target resolution failed before these real run artifacts existed, and fixture substitution was not accepted as evidence |
| 14. Responsive layout at 320, 390, 768, and 1280 CSS px | PASS | `.agent-build/test-runs/release/browser-live/12-responsive-320.png`, `12-responsive-390.png`, `12-responsive-768.png`, `12-responsive-1280.png`; each viewport had `scrollWidth === clientWidth` |
| 15. Layout at 200% browser-equivalent zoom | FAIL | `.agent-build/test-runs/release/browser-live/13-zoom-200.png`; at 1280 CSS px with `body.style.zoom=2`, `scrollWidth=1290` exceeded `clientWidth=1280` |
| 16. Keyboard focus, heading, and landmark structure | PASS | `.agent-build/test-runs/release/browser-live/14-keyboard-focus.png`; one `h1`, one main, one navigation landmark, and a visible `3px` focus outline |
| 17. Persistent live-region availability on the assessment overview | FAIL | `.agent-build/test-runs/release/browser-live/14-keyboard-focus.png`; the live overview exposed zero `[aria-live]`, `role=status`, or `role=alert` nodes in its steady state |
| 18. Loopback liveness and arbitrary Host/Origin rejection on authenticated API routes | PASS | `/health/live` returned 200 `{"status":"ok"}`; `GET /api/v1/system` returned 403 `ORIGIN_DENIED` for both `Host: evil.example` and `Origin: http://evil.example` |
| 19. Reject arbitrary Host/Origin on the liveness route itself | FAIL | Exact HTTP observation: `/health/live` returned 200 for `Host: evil.example` and also returned 200 for `Origin: http://evil.example` |
| 20. Console and network health during the successful final traversal | PASS | `observations.json`: no console errors; all app APIs were 2xx. Chromium also reported the known navigation-time bootstrap `net::ERR_ABORTED`, while the captured bootstrap response was 204 and the authenticated session completed |

## Repro steps

### Step 8 — FAIL

1. Bootstrap a fresh live session and select **Start assessment**.
2. Create a valid draft and complete all ten product-context topics.
3. On **Access and consent**, enter a disposable value in **One-use sandbox credential**.
4. Select **Create and upload handle**; observe that the value is cleared and the handle is shown.
5. Choose **Do not approve** for every capability and select **Review setup**.
6. Observe HTTP 412 from `PUT /api/v1/runs/{runId}/approvals`; the UI does not advance. The secret mutation changed the run row version, but the frontend continued with its older value.

### Step 9 — BLOCKED

1. Register `/workspace/rendervo-alt-3bcd18f5/targets/repo-assessment-kit` as the local source root.
2. Create project `browser-live` with relative path `apps`, complete discovery, deny every capability, authorize, and select **Prepare safe copy**.
3. Observe `POST .../actions/resolve-target` return 202.
4. Observe the activity `Limitation recorded: lim_target-resolution-failed`, **Snapshot: Not prepared**, and **No phase running**. The supplied target has no committed `HEAD`, so a real safe snapshot cannot be made.

### Steps 11 and 13 — BLOCKED

1. Complete the preceding live setup through the failed target-resolution result.
2. Restart the server against the same SQLite state with a fresh bootstrap token.
3. Bootstrap in a new browser and open assessments.
4. Observe that the UI presents `northstar-portal`, **Sample activity**, and preview-only controls instead of the persisted `browser-live` run.
5. Pause/cancel explicitly state that nothing was sent. Do not use this fixture to claim findings, evidence, coverage, decisions, packaging, or recovery.

### Step 12 — FAIL

1. Create the live `browser-live` run as above.
2. Restart the server with the same database and authenticate again.
3. Select **View assessments**, then open the displayed assessment.
4. Observe fixture project `northstar-portal` rather than the created live project, plus **Sample activity** and preview-only action messages.

### Step 15 — FAIL

1. Open the live assessment overview at a 1280-by-900 viewport.
2. Apply 200% page zoom (the automated check used CSS `zoom: 2` as the browser-equivalent layout probe).
3. Observe horizontal overflow: document `scrollWidth` is 1290 while `clientWidth` is 1280.

### Step 17 — FAIL

1. Open the live assessment overview after target resolution records its limitation.
2. Inspect the steady-state accessibility tree/DOM.
3. Observe one heading, main, and navigation landmark, but zero persistent `[aria-live]`, `role=status`, or `role=alert` nodes.

### Step 19 — FAIL

1. Run `curl -H 'Host: evil.example' http://127.0.0.1:3000/health/live`.
2. Observe HTTP 200 `{"status":"ok"}`.
3. Run `curl -H 'Origin: http://evil.example' -H 'Host: 127.0.0.1:4173' http://127.0.0.1:3000/health/live`.
4. Observe the same HTTP 200 response. In contrast, `/api/v1/system` rejects both cases with HTTP 403 `ORIGIN_DENIED`.

## Anything else I noticed

- The successful live traversal made no provider-login, provider-inference, external-network, or dynamic-runtime claim.
- The Help route does not expose direct links to the operator runbook or customer quickstart; guidance is present inline.
- The source form initially carries a non-existent default handle value until the operator explicitly selects the only registered handle.

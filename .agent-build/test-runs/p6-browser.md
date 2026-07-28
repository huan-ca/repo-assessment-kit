# P6 browser verification

## Final verdict: PASS — 2026-07-28 live recheck

The latest requested regression scope passes: bootstrap survives the development StrictMode cycle and establishes a live authenticated session, the live workspace shows zero runs and zero registered source handles without substituting fixture data, `/health/live` succeeds through the preview proxy, and the explicit preview fixture retains the corrected coverage and accessibility behavior. Earlier blocked/failed observations are retained below as test history.

## Initial verdict: BLOCKED

The deterministic interface-preview flow is substantially present and honest about its limits, but the live assessment operations cannot be completed against this preview because the assessment API is unavailable. One coverage-accounting defect was also found.

| Step | Status | Evidence |
|---|---|---|
| 1. Welcome, readiness, loopback/local-only boundary, fixed-provider language | PASS | `.agent-build/test-runs/p6-browser/01-welcome-desktop.png` |
| 2. Start Assessment: fixed provider, registered source, copy mode, profiles, optional service language | PASS | `.agent-build/test-runs/p6-browser/02-prepare-start.png` |
| 3. Complete all 10 discovery topics; preserve an explicit unknown with reason, confidence effect, coverage effect, and follow-up owner | PASS | `.agent-build/test-runs/p6-browser/03-discovery.png`, `.agent-build/test-runs/p6-browser/04-consent.png`, `.agent-build/test-runs/p6-browser/06-setup-review.png` |
| 4. Consent choices have equal approve/deny weight and disclose destination, method, data, recipient, expiry, and denial effect | PASS | `.agent-build/test-runs/p6-browser/05-consent-boundaries.png` |
| 5. Credential boundary: one-use password control; sentinel is never rendered or written to local/session storage | PASS | `.agent-build/test-runs/p6-browser/05-consent-boundaries.png` |
| 6. Setup review reconciles project/source, all discovery answers, explicit unknown, and access decisions | PASS | `.agent-build/test-runs/p6-browser/06-setup-review.png` |
| 7. Prepare immutable safe copy and enter a real run | BLOCKED | `.agent-build/test-runs/p6-browser/07-assessment-overview.png` |
| 8. Progress shows 14 durable phases and honestly shows runtime blocked while static work continues | PASS | `.agent-build/test-runs/p6-browser/09-progress-phases.png` |
| 9. Pause, resume, cancel, and off-path recovery | BLOCKED | `.agent-build/test-runs/p6-browser/10-paused.png`, `.agent-build/test-runs/p6-browser/18-stop-recovery.png` |
| 10. Coverage presents all six states and named limitations | FAIL | `.agent-build/test-runs/p6-browser/12-coverage-six-states.png` |
| 11. Finding opens to its supporting-record trace | PASS | `.agent-build/test-runs/p6-browser/13-findings.png`, `.agent-build/test-runs/p6-browser/14-finding-evidence.png` |
| 12. Decision compares remediation, incremental replacement, and full rebuild across the same seven criteria, with assumptions and reversal conditions | PASS | `.agent-build/test-runs/p6-browser/15-decision-options.png` |
| 13. Package validation/download gate and no active target HTML in authenticated origin | BLOCKED | `.agent-build/test-runs/p6-browser/16-package-validation.png`, `.agent-build/test-runs/p6-browser/17-package-attempt.png` |
| 14. Help/glossary, universal off-path states, keyboard instructions | PASS | `.agent-build/test-runs/p6-browser/19-help-glossary.png` |
| 15. Desktop and 320 px responsive layout; no horizontal overflow on home, assessment overview, or decision | PASS | `.agent-build/test-runs/p6-browser/20-mobile-home-320.png`, `.agent-build/test-runs/p6-browser/21-mobile-assessment-320.png`, `.agent-build/test-runs/p6-browser/23-mobile-decision-320.png` |
| 16. Keyboard navigation, visible focus, headings/landmarks/live status | PASS | `.agent-build/test-runs/p6-browser/22-mobile-keyboard-focus.png` |

## Repro steps

### Step 7 — BLOCKED

1. Open `http://127.0.0.1:4173`.
2. Select **Start assessment**.
3. Complete project/source setup, all 10 product-context topics, consent decisions, and authorization.
4. Select **Prepare safe copy**.
5. Observe: **No operation performed — Preview only: setup was checked in this tab, but no draft or safe copy was created.**

This is an environment/API block, not a dishonest UI success. The entered setup remains session-local and coverage is explicitly unchanged.

### Step 9 — BLOCKED

1. From **View assessments**, open the sample `northstar-portal` assessment.
2. Select **Pause safely**.
3. Observe: **Preview only: pause was not sent and no run state changed.**
4. Observe that resume is unavailable because the read contract exposes neither a recovery-plan ID nor retry-attempt IDs.
5. Select **Stop and clean up**.
6. Observe: **Preview only: cancel was not sent and no run state changed.**

The interface explains that cancellation would not delete admitted records, but a real pause/resume/cancel transition cannot be exercised without the API.

### Step 10 — FAIL

1. Open the sample assessment.
2. Select **Coverage**.
3. Read the summary: **All 15 required assessment areas are accounted for. 7 passed, 2 were partly tested, 2 were blocked, and 1 was not applicable.**
4. Add the stated counts: they total 12, not 15.
5. Continue down the page and observe three **Not tested** rows. The six states and their definitions are present, but the headline omits the three not-tested areas while claiming all 15 are accounted for.

### Step 13 — BLOCKED

1. Open the sample assessment and select **Reviews and release**.
2. Observe pending review/validation gates and failed package validation.
3. Select **Request validated package**.
4. Observe: **Preview only: no package was requested and no validation or download succeeded.**

The UI correctly states that customer HTML is read only after download and is never previewed in the authenticated origin; the browser contained zero iframes. A validated package and real download cannot be proven in this fixture.

## Anything else I noticed

- Console/network: `/api/v1/system`, `/api/v1/source-handles`, and `/api/v1/runs?limit=1` fail with `404`/`net::ERR_ABORTED`, producing three browser console errors. The visible interface-preview status announces the unavailable API and does not claim success.
- Responsive measurements were `scrollWidth === clientWidth === 320` on home, assessment overview, and the long decision route.
- Keyboard focus used a visible `3px solid` outline on interactive controls. The route has a skip link, one main landmark, ordered route headings, and a status live region for preview/API state.
- The mobile assessment navigation collapses behind a clearly named **Run navigation** button; all assessment destinations remain keyboard-reachable.

## Recheck — 2026-07-28

### Final verdict: BLOCKED

The prior coverage-accounting FAIL is fixed. Desktop/mobile presentation and the checked accessibility structure did not regress. Live authenticated verification remains blocked because the supplied bootstrap request was aborted and the browser stayed in the deterministic interface-preview state.

| Recheck | Status | Evidence |
|---|---|---|
| Six-state coverage headline reconciles all 15 areas | PASS | `.agent-build/test-runs/p6-browser/24-recheck-coverage.png` |
| 320 px coverage route has no horizontal overflow | PASS | `.agent-build/test-runs/p6-browser/25-recheck-mobile-coverage-320.png` |
| Route heading, main landmark, live status, and visible keyboard focus remain present | PASS | `.agent-build/test-runs/p6-browser/26-recheck-focus.png` |
| Prior missing-server console noise | PASS | Browser produced no console errors and no HTTP error responses during the fixture traversal |
| Proxy/backend health | FAIL | `GET /health` returns JSON `404 Route GET:/health not found` through both `:4173` and direct `:3000`; `GET /api/v1/health` reaches the backend but returns the expected unauthenticated `401 SESSION_REQUIRED` |
| Authenticated live session | BLOCKED | `POST /api/v1/session/bootstrap` ended as `net::ERR_ABORTED`; the visible status remained **Interface preview** |

### Recheck repros

#### Proxy health — FAIL

1. Request `http://127.0.0.1:4173/health`.
2. Observe HTTP 404 with `Route GET:/health not found`.
3. Request `http://127.0.0.1:3000/health`.
4. Observe the same backend JSON 404, confirming the preview proxy reaches the backend but no `/health` route exists.
5. Request `/api/v1/health` through the preview proxy and observe `401 SESSION_REQUIRED`, also confirming proxy connectivity.

#### Authenticated live session — BLOCKED

1. Open `http://127.0.0.1:4173/#bootstrap=browser-recheck-token` in a fresh Chromium context.
2. Observe the bootstrap request fail as `net::ERR_ABORTED`.
3. Observe the visible **Interface preview** banner and fixture assessment rather than an authenticated live surface.

### Recheck notes

- The corrected summary reads: **7 passed, 0 failed, 2 partly tested, 2 blocked, 1 not applicable, and 3 not tested**; the counts total 15.
- At 320 px the coverage route measured `scrollWidth = clientWidth = 320`.
- The route exposed one `h1`, one main landmark, a status live region, and a `3px` solid focus outline.

## Final live recheck — 2026-07-28

### Verdict: PASS

| Check | Status | Evidence |
|---|---|---|
| Bootstrap survives StrictMode and lands in authenticated live mode | PASS | `.agent-build/test-runs/p6-browser/27-final-live-home.png` |
| Live workspace has zero runs and does not show the fixture assessment or sample actions | PASS | `.agent-build/test-runs/p6-browser/28-final-live-zero-runs.png` |
| Live system/source-handle responses are used; registered-handle selector is empty | PASS | `.agent-build/test-runs/p6-browser/29-final-live-empty-source.png` |
| `/health/live` through `127.0.0.1:4173` | PASS | HTTP 200 with `{"status":"ok"}` |
| Corrected fixture coverage, accessibility structure, and 320 px overflow regression | PASS | `.agent-build/test-runs/p6-browser/30-final-preview-coverage-320.png` |

### Final live observations

- The bootstrap POST returned HTTP 204, the fragment was removed from the URL, and an HttpOnly `rak_session` cookie with `SameSite=Strict` was established.
- The browser recorded successful live API responses: `GET /api/v1/system` 200, `GET /api/v1/source-handles` 200, and `GET /api/v1/runs?limit=1` 200.
- The bootstrap request also emitted `requestfailed: net::ERR_ABORTED` during navigation, but its captured HTTP response was 204 and the authenticated session completed. There were no console errors.
- The live assessment list states **No assessment has been created in this local workspace** and exposes only **Start assessment**; no `northstar-portal` sample run or sample run actions appeared.
- The live setup route presents an empty registered-handle selector, consistent with the successful empty source-handle response.
- Under explicit `?preview=1`, coverage still reconciles all 15 areas, exposes one `h1`, one main landmark, and one live region, and measures `scrollWidth = clientWidth = 320`.

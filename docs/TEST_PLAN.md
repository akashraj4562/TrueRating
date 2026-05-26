# TEST_PLAN.md — ClearCart QA & Regression Plan

_Owned by the **qa-resilience-engineer**. This is the single source of truth for what
ClearCart tests, why, and where the seams are. Update before every release; update
**after every regression** so we never lose the same way twice._

**Last updated:** 2026-05-26
**Plan version:** 1.0
**Scope:** v0.1 Amazon.in (Flipkart deferred to v0.2)

---

## 0. How to read this document

- **Section A** is the audit — what we have, what we're missing, and how badly it would
  hurt if each gap caused a regression.
- **Section B** is the categorical test plan — what we test, why, and what regression
  each category prevents.
- **Section C** is the test matrix — unit vs. integration vs. E2E vs. manual.
- **Section D** is the regression trigger map — "if you touch X, run Y."
- **Section E** lists known gaps that automation cannot cover.

Every test file path in this document is **absolute** so the qa-resilience-engineer
agent can act on it without ambiguity.

---

## A. Coverage audit

| Module | Path | Currently tested? | Gaps | Severity |
|---|---|---|---|---|
| Bayesian math | `src/scoring/bayesian.ts` | Yes (`scoring.test.ts` + new `regression.test.ts`) | Boundary v=1, all-identical-corpus, large-N performance | **High** — the canonical assertion *is* the product |
| Wilson math | `src/scoring/wilson.ts` | Yes (`scoring.test.ts` + new `regression.test.ts`) | Output-range invariants under every input combo | **High** — appears in the popup as a primary toggle |
| Count parser | `src/scoring/parse.ts` | Yes (`scoring.test.ts` + new `regression.test.ts`) | Parens, mixed-case k/K/m/M, `"0"` behaviour | **High** — broken parsing → wrong scores silently |
| scoreItem | `src/scoring/index.ts` | Yes | Method routing (`'wilson'` must NOT call bayesian), shape of result object | **Medium** — wrong shape breaks the badge |
| Selectors | `src/selectors.ts` | Indirect (via fixtures) | No test that the constants match what fixtures provide | **High** — selector drift is the #1 failure mode |
| Sponsored detection | `src/content/amazon.ts::isSponsored` | Yes (mirrored in `amazon-dom.test.ts`) | Card with neither signal, card with both signals | **High** — false positive dims real products |
| Rating extraction | `src/content/amazon.ts::extractRating` | Yes (mirrored as `extractRatingText`/`extractCount`) | aria-label *attribute* vs textContent precedence, partial elements | **High** — silent rating loss is invisible to users |
| Style injection | `src/content/shared.ts::injectStyles` | **No** (only "doesn't throw") | Idempotency (call 5×, get 1 `<style>`) and CSS rule presence | **Medium** — duplicate styles waste memory, do not break |
| `clearAllChanges` | `src/content/shared.ts` | Partial | Cleans every `cc-*` class, no exception on empty doc, ignores non-cc DOM | **High** — a leaky clean accumulates badges on every re-run |
| `applyDeSponsoring` | `src/content/shared.ts` | Partial | Missing `.puis-card-container` fallback, double-call idempotency | **High** — sponsored cards stack `cc-dim` classes / multiple `Ad` tags |
| `renderBadge` | `src/content/shared.ts` | Partial | Null anchor safety, double-call idempotency, decimal formatting, aria-label | **High** — duplicate badges is the user-visible symptom of MutationObserver bugs |
| `processPage` (orchestrator) | `src/content/amazon.ts` | **No direct test** | Idempotency under 5× call, `enabled:false` short-circuit, mode-switch cleanup | **Critical** — this is the integration glue that is failing for the user right now |
| `chrome.storage` round-trip | `src/popup/popup.ts` | **No** | Settings persist, defaults applied on first read, `onChanged` rebroadcast | **High** — popup-content sync is the user's only control surface |
| MutationObserver / debounce | `src/content/amazon.ts` | **No** | Reprocess on DOM add (infinite scroll), debounce coalesces bursts | **Medium** — needs simulated mutations; tricky in happy-dom |

**Headline finding:** the *math* and the *individual DOM helpers* are tested, but the
**orchestration layer** (`processPage` → re-runs → mode flips → MutationObserver) is
**untested as a system**. This is almost certainly where "the feature is not working
correctly" originates.

---

## B. Test categories

For each category: **what we test**, **why it matters**, **what regression it prevents**.

### B1. Scoring math correctness — Bayesian + Wilson, edge cases

- **What:** Canonical assertion (`3.9@200k > 4.0@200`), monotonicity, boundary inputs
  (v=0, v=1, NaN, negatives, >5), prior clamping, output ranges
  (Bayesian ∈ [0,5], Wilson ∈ [0,1]), large-N convergence to the item's own rating.
- **Why:** The math is the IP. The product's reason-to-exist *is* the canonical assertion.
  If it ever inverts, ClearCart is recommending the wrong product.
- **Prevents:** A future "simplification" of the formula that breaks shrinkage; a parser
  change that returns `0` instead of `null` (which would feed the math invalid inputs);
  a refactor that lets NaN propagate to the badge.
- **Files:** `src/scoring/__tests__/scoring.test.ts`, `src/scoring/__tests__/regression.test.ts`.

### B2. Selector resilience — what happens when Amazon/Flipkart changes their HTML

- **What:** Every selector in `src/selectors.ts` matches the live-verified fixtures.
  Mutated/broken DOM does not throw and leaves the page untouched.
- **Why:** Amazon ships HTML changes without notice. Our non-negotiable §3.5 ("Never
  break the page") demands a soft failure.
- **Prevents:** A site change that turns selectors into no-ops should produce *zero
  badges and zero dims*, not exceptions, infinite loops, or partial state.
- **Files:** `src/content/__tests__/amazon-dom.test.ts` ("Degradation" section).

### B3. Badge rendering — placement, content, idempotency

- **What:** Badge is inserted *as the next sibling* of the count anchor; has class
  `cc-badge`; text contains `CC`; Bayesian shows `N.N★`, Wilson shows `NN.N%`;
  has `aria-label`; calling renderBadge twice still produces **one** badge.
- **Why:** The badge is the user's only visible signal that ClearCart is doing
  anything. A duplicated badge tells the user we run multiple times (looks buggy).
  Wrong placement breaks layout.
- **Prevents:** MutationObserver firing on its own injection (badge → mutation →
  another badge → another mutation → page is a wall of CC stamps).
- **Files:** `src/content/__tests__/shared-regression.test.ts`,
  `src/content/__tests__/idempotency.test.ts`.

### B4. De-sponsoring — dim/hide/off modes, target element, full restoration

- **What:** `mode='dim'` adds `cc-dim` to `.puis-card-container` (inner card, not
  outer wrapper); `mode='hide'` adds `cc-hide`; `mode='off'` adds nothing;
  organic cards untouched in every mode; `clearAllChanges` removes every
  `cc-*` class and element it created.
- **Why:** The dim target was a known footgun — applying opacity to the outer grid
  cell didn't visually dim the card. Hardcoded to `.puis-card-container` in
  `shared.ts`; if Amazon renames it, we fall back to `card` itself, which is
  visually broken but safe.
- **Prevents:** Sponsored cards remaining visible at full opacity in dim mode;
  organic cards being dimmed (the worst-case false positive); stale `cc-dim` left
  on the page when the user switches from dim → off.
- **Files:** `src/content/__tests__/shared-regression.test.ts`,
  `src/content/__tests__/idempotency.test.ts`.

### B5. Settings persistence — chrome.storage.local, DEFAULT_SETTINGS fallback

- **What:** `chrome.storage.local.get(DEFAULTS, cb)` returns defaults on a fresh
  install; `set` round-trips; `onChanged` listener fires; the popup's
  three controls all write the right keys.
- **Why:** Settings are the user's only control. If `enabled:false` doesn't actually
  disable the extension, the master toggle is a lie.
- **Prevents:** The user clicking "Off" and badges still appearing — a serious
  trust violation.
- **Files:** `src/content/__tests__/settings-integration.test.ts`.

### B6. MutationObserver / infinite-scroll resilience

- **What:** Cards added to the DOM after initial render are processed (badge appears,
  dim applied). The observer's own DOM writes do not re-trigger itself (debounce
  + idempotency guards).
- **Why:** Amazon's search uses progressive hydration and (in some pages) infinite
  scroll. Without this, only the first-paint cards get badges.
- **Prevents:** Half-decorated pages where the top six cards have badges and the
  next twelve don't.
- **Files:** Manual + `src/content/__tests__/idempotency.test.ts` (call processPage
  N× as a stand-in for observer firing).

### B7. Popup ↔ content script sync — `storage.onChanged` triggers re-render

- **What:** Changing `sponsorMode` in the popup writes to `chrome.storage.local`;
  the content script's `onChanged` listener reads the new value and calls
  `processPage` again with no page reload.
- **Why:** Live preview is a core UX promise: "toggle Wilson → badges update".
- **Prevents:** A regression where the popup writes but the content script ignores
  the change, forcing the user to reload Amazon to see settings take effect.
- **Files:** `src/content/__tests__/settings-integration.test.ts` (mocks
  `chrome.storage` and asserts the sequence).

### B8. Cross-browser edge cases — happy-dom limitations

- **What:** happy-dom is fast but not a full browser. It does not run actual
  layout, CSS resolution, or `MutationObserver` exactly like Chrome.
- **Why:** Some bugs only appear in a real browser (e.g., visual opacity, focus
  outlines, computed style inheritance).
- **Prevents:** False confidence — knowing what *cannot* be asserted in vitest is
  as important as knowing what can.
- **Coverage:** flagged in Section E.

### B9. Performance guardrails

- **What:** `processPage` called 100× on the same page completes in
  reasonable time (sub-second under happy-dom); 1000-item Bayesian corpus runs
  without stack overflow.
- **Why:** MutationObserver bugs can fire `processPage` many times per second on
  a misbehaving page. The page must remain responsive.
- **Prevents:** A user reporting "the page froze when I scrolled" because each
  scroll mutation re-runs `processPage` synchronously without dedup.
- **Files:** `src/scoring/__tests__/regression.test.ts` (Bayesian large-N),
  `src/content/__tests__/idempotency.test.ts` (5×–100× processPage loop).

---

## C. Test matrix

| ID | Category | Test file | Type | Environment |
|---|---|---|---|---|
| T1 | Bayesian — canonical | `scoring.test.ts` + `regression.test.ts` | Unit | Node |
| T2 | Bayesian — boundary v=0, v=1, NaN, >5 | `regression.test.ts` | Unit | Node |
| T3 | Bayesian — large-N performance | `regression.test.ts` | Unit/perf | Node |
| T4 | Wilson — canonical | `scoring.test.ts` + `regression.test.ts` | Unit | Node |
| T5 | Wilson — output range invariants | `regression.test.ts` | Unit | Node |
| T6 | parseRatingCount — all locales | `scoring.test.ts` + `regression.test.ts` | Unit | Node |
| T7 | scoreItem — method routing | `regression.test.ts` | Unit | Node |
| T8 | Selectors match fixtures | `amazon-dom.test.ts` | Integration | happy-dom |
| T9 | Sponsored detection (fixtures) | `amazon-dom.test.ts` | Integration | happy-dom |
| T10 | Rating extraction (fixtures) | `amazon-dom.test.ts` | Integration | happy-dom |
| T11 | Selector degradation | `amazon-dom.test.ts` | Integration | happy-dom |
| T12 | renderBadge — idempotency, placement, aria, decimals | `shared-regression.test.ts` | Integration | happy-dom |
| T13 | applyDeSponsoring — mode matrix, target, idempotency | `shared-regression.test.ts` | Integration | happy-dom |
| T14 | clearAllChanges — full restoration | `shared-regression.test.ts` | Integration | happy-dom |
| T15 | injectStyles — idempotency | `shared-regression.test.ts` | Integration | happy-dom |
| T16 | processPage 5×/100× on full fixture page | `idempotency.test.ts` | Integration | happy-dom |
| T17 | Settings → render pipeline | `settings-integration.test.ts` | Integration | happy-dom |
| T18 | `enabled:false` short-circuit | `settings-integration.test.ts` | Integration | happy-dom |
| T19 | Mode transition cleanup (dim → hide → off) | `settings-integration.test.ts` | Integration | happy-dom |
| T20 | Method transition (bayesian → wilson) | `settings-integration.test.ts` | Integration | happy-dom |
| M1 | Manual — Amazon.in live search | `docs/STATUS.md` (60-second demo) | Manual | Real Chrome |
| M2 | Manual — Network tab empty | `docs/STATUS.md` step 4 | Manual | Real Chrome |
| M3 | Manual — Popup toggles update page live | `docs/STATUS.md` step 5–6 | Manual | Real Chrome |
| E1 | E2E — Playwright on Amazon.in | **Not implemented (v0.2)** | E2E | Playwright |
| E2 | E2E — MutationObserver under real infinite scroll | **Not implemented (v0.2)** | E2E | Playwright |

---

## D. Regression triggers — "if X changes, run Y"

| If you change… | …then run, at minimum |
|---|---|
| `src/scoring/bayesian.ts` | T1, T2, T3 + the canonical assertion must pass |
| `src/scoring/wilson.ts` | T4, T5 + the canonical assertion must pass |
| `src/scoring/parse.ts` | T6 + T7 (because scoreItem feeds the parser into the math) |
| `src/scoring/index.ts` | T7 + T17 (method routing is what the popup toggles) |
| `src/selectors.ts` | T8, T9, T10, T11 + re-verify fixtures vs. live page |
| `src/content/shared.ts` | T12, T13, T14, T15, T16 |
| `src/content/amazon.ts` (extraction logic) | T9, T10, T16 |
| `src/content/amazon.ts` (processPage / observer) | T16, T17, T18, T19, T20 + manual M1–M3 |
| `src/popup/popup.ts` or `popup.html` | T17–T20 + manual M3 |
| `manifest.json` | Full suite + the security audit (guardian) |
| Adding a fixture | T8–T11 must still pass with the new fixture in scope |
| Amazon ships a HTML change | Step 1: update fixture. Step 2: update selector. Step 3: T8–T11 green. Step 4: bump `selectors.ts` `verified` date. |

---

## E. Known gaps — what we cannot automate in vitest

These need real browser, Playwright, or human eyes. Document them honestly so we
never claim "all tests pass" means "all behaviour verified."

1. **Visual opacity dim** — happy-dom does not render CSS. We can prove the
   `cc-dim` class is applied, but not that the user perceives 35% opacity.
   *Mitigation:* M1 manual demo confirms visually.
2. **MutationObserver firing under real DOM hydration** — happy-dom's
   MutationObserver is functional but its timing under heavy Amazon JS is not
   the same as Chrome. We test the *handler* (5× / 100× processPage calls)
   not the *observer mechanism*.
   *Mitigation:* M1 + scroll-the-page check, future Playwright E2E (E2).
3. **Real `chrome.storage.local`** — we mock it. The real API has quota limits
   and serialization quirks we don't exercise.
   *Mitigation:* Manual M3.
4. **Cross-tab settings sync** — Chrome broadcasts storage changes across tabs.
   No vitest coverage; happy-dom is single-document.
   *Mitigation:* Manual smoke: open two Amazon tabs, toggle in popup, both should
   update. Document in STATUS if found broken.
5. **Performance under real Amazon DOM** — fixtures are ~3 cards. Real pages
   have 20–60. We don't have a "full search results page" fixture yet.
   *Mitigation:* T16 loops processPage on the available fixtures; recommend
   capturing a full-page fixture for v0.2.
6. **The popup's actual HTML wiring** — our popup test mocks chrome.storage but
   does **not** execute popup.ts (which reads from `document.getElementById`
   directly). Adding it requires running popup.ts in happy-dom with popup.html
   loaded.
   *Mitigation:* Manual M3; future improvement.
7. **MV3 service-worker lifecycle** — we don't use one (no background script).
   If we ever do, observe-then-test will be required.
8. **CSP edge cases** — content scripts run in isolated worlds; some side-effects
   of that (e.g., a page's CSS variables not visible to our injected styles)
   only appear in a real browser.

---

## F. The "is this feature working correctly?" checklist

Run this checklist any time the user reports "the feature is not working." It's the
single deterministic procedure that distinguishes a real bug from a misunderstanding.

- [ ] **Math:** does `npm test` pass, and specifically does the canonical
      `3.9@200k > 4.0@200` assertion still hold?
- [ ] **Fixtures:** do `amazon-dom.test.ts` tests pass against the current fixtures?
- [ ] **Selectors:** are the constants in `src/selectors.ts` still present in a
      live Amazon.in search-result card (open DevTools and check)?
- [ ] **Idempotency:** run `idempotency.test.ts` — does calling `processPage` 5×
      still produce exactly N badges (not 5N)?
- [ ] **Clean:** does `clearAllChanges()` remove every `cc-*` element from the
      document, including `cc-sponsor-tag`?
- [ ] **Settings:** does `enabled:false` produce a fully untouched page?
- [ ] **Mode switch:** does flipping `dim → hide → off` not leave any stale
      `cc-dim` classes behind?
- [ ] **Method switch:** does flipping `bayesian → wilson` change the badge text
      from `N.N★` to `NN.N%`?
- [ ] **Network:** with the live extension loaded, is the Network tab empty?
- [ ] **Degradation:** with selectors deliberately broken, does the page stay
      untouched and nothing throw?

If any item fails, the feature is **not** working correctly; open a regression
ticket and add the failing scenario as a new test before fixing.

---

## G. How to update this plan

1. New feature lands → add a category to Section B and rows to Section C/D.
2. New regression caught → add a row to the audit (Section A) and to the
   trigger map (Section D) with the test file that catches it.
3. Selector drift → update fixtures, then update selectors, then re-verify Section A
   and bump the date at the top of this file.

The qa-resilience-engineer agent owns this document. The tech-lead reviews changes
to Section A and Section D.

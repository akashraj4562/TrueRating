# TrueRating

**A Chrome extension that fixes the two biggest lies in online shopping: sponsored results that look organic, and star averages that punish popular products.**

Every product card on Amazon.in gets a `TR` badge showing its statistically adjusted confidence score. Sponsored cards get dimmed. No data leaves your browser — ever.

> _Drop a screenshot at `docs/screenshot.png` to show the TR badges in action._

---

## The problem it solves

### Lie #1 — Sponsored results masquerade as organic

Amazon's search results mix paid placements with organic ones. The visual difference is a tiny "Sponsored" label that most users tune out. TrueRating makes the distinction impossible to miss: sponsored cards are dimmed to 35% opacity (or hidden entirely, user's choice) and labelled "Ad."

### Lie #2 — Raw star averages are statistically backwards

A product with **4.0★ from 200 reviews** ranks above one with **3.9★ from 200,000 reviews** on Amazon. This is wrong. The second product has been judged by a city's worth of strangers; the first might be 200 friends-and-family ratings. The higher-confidence product — the one with 200,000 reviews — should rank higher.

TrueRating corrects for this using the same statistical technique IMDb uses for its movie rankings.

---

## How it works

### Confidence-weighted ratings (Bayesian shrinkage)

```
TR score = (v / (v + m)) × R  +  (m / (v + m)) × C
```

| Symbol | Meaning |
|--------|---------|
| `R` | The product's own star average |
| `v` | Number of ratings the product has |
| `C` | The crowd mean across all visible products on the page |
| `m` | Prior strength — computed as the median rating count across the page, clamped to [10, 1000] |

**What this does:** A product with few reviews gets pulled toward the crowd mean `C`. A product with many reviews barely moves from its own `R`. The 4.0★@200 product shrinks toward the crowd; the 3.9★@200,000 product stays near 3.9. The ranking inverts — correctly.

**The canonical test (locked into the test suite and must never regress):**
```
TR(3.9★, 200,000 reviews) > TR(4.0★, 200 reviews)  ✅
```

### Why the prior mean is 3.5, not 3.9

The spec initially suggested a fallback prior of ~3.9. After implementing the math, we found that 3.9 is too close to typical high-rated items to produce meaningful shrinkage — a 4.0★ product would barely be penalised. 3.5 is the midpoint of the 0–5 scale: the maximally neutral "I know nothing" prior. This documented deviation from spec is justified by the math and recorded in `docs/SCORING.md`.

### Why median for prior strength, not mean

One product with 200,000 ratings would inflate the mean dramatically, making `m` huge and over-shrinking every other product. The median is robust to such outliers.

### Alternative: Wilson lower bound

Toggle to Wilson mode in the popup. This treats ratings ≥ 4★ as "positive" and returns the lower bound of the 95% confidence interval on that proportion. It penalises small samples even more aggressively than Bayesian shrinkage. Output is displayed as a percentage (e.g. `TR 73.9%`).

**Known limitation:** we only have the aggregate star average from the DOM, not the raw distribution. We approximate the positive proportion as `p̂ = rating / 5`. This is a linear approximation — documented, accepted, and explained in `docs/SCORING.md`. It is monotonically correct: higher average always means higher `p̂`.

### The 50-review floor

Products with fewer than 50 reviews get no TR badge at all. At 50 reviews, the Bayesian score is still ~83% prior mean — barely distinguishable from the corpus average. Showing a badge would suggest a meaningful signal when there isn't one. This threshold is a product decision, not a math decision: suppressing misleading information is better than surfacing noisy information.

### Number parsing for Indian e-commerce

Indian number formatting uses lakh notation (1,23,456 = 123,456). The count parser handles all formats observed on Amazon.in:

| Input | Output |
|-------|--------|
| `"1,23,456"` | 123,456 |
| `"27,612"` | 27,612 |
| `"27.6K"` | 27,600 |
| `"1.2M"` | 1,200,000 |
| `"(8)"` | 8 |
| `"New"` / `null` | no badge |

---

## Features

### Implemented (v0.1)

| Feature | Detail |
|---------|--------|
| **TR confidence badge** | `TR 3.76★` (Bayesian) or `TR 73.9%` (Wilson) rendered next to every product with ≥50 reviews |
| **Bayesian shrinkage** | IMDb-style weighted rating. Prior mean = unweighted corpus mean. Prior strength = median count, clamped [10, 1000] |
| **Wilson lower bound** | 95% CI on proportion of ≥4★ ratings. Toggle in popup. |
| **Sponsored dimming** | Sponsored cards → 35% opacity + "Ad" tag. Hover to preview at 92% opacity |
| **Sponsored hiding** | Optional: sponsored cards removed from view entirely |
| **Dim / Hide / Off toggle** | User controls de-sponsoring mode from the popup |
| **Bayesian / Wilson toggle** | Live-switches scoring method — badges update without page reload |
| **Master on/off switch** | Disables all modifications instantly. Page returns to native state |
| **Horizontal carousel coverage** | Processes both main grid cards and horizontal scroll carousels (sponsored carousel, related products) |
| **Infinite scroll support** | MutationObserver with 500ms debounce re-processes new cards as they load |
| **Live settings sync** | Popup changes reflect on the page immediately via `chrome.storage.onChanged` — no page reload, no `tabs` permission |
| **Idempotent rendering** | `clearAllChanges()` called before every re-render. Calling processPage 100× produces identical output to calling it 1× |
| **Graceful degradation** | If any selector breaks (Amazon updates their HTML), the page is left completely untouched. Nothing throws. |
| **Accessible badges** | Every badge has `aria-label` and `title` — screen reader safe |

### Planned

| Version | Feature |
|---------|---------|
| **v0.2** | Flipkart.com support — same scoring, new selectors |
| **v0.2** | "Sort by TR score" opt-in button — re-orders visible cards by confidence score |
| **v0.3** | Google Maps — TR badges on restaurant/place ratings in list view and detail card |
| **v0.3** | Google Maps sponsored pin dimming |
| **v0.4** | Safari Web Extension for iOS 15+ (via Xcode conversion + App Store) |
| **v0.5** | "Bought in past month" signal as a display-only annotation |
| **Future** | Review sentiment layer (would require a separate data source — tracked as a future decision) |

---

## Privacy — the full picture

| What | Status |
|------|--------|
| Network requests | **Zero.** `grep -rEn "fetch\|XMLHttpRequest\|WebSocket\|sendBeacon" src/` returns nothing. Verifiable with DevTools → Network tab during any session. |
| Data collected | **None.** No product data, ratings, search queries, browsing history, or identifiers are ever read and stored. |
| Data transmitted | **None.** There are no servers. There is no backend. |
| Settings storage | `chrome.storage.local` only. Three keys: `enabled` (bool), `sponsorMode` (dim/hide/off), `ratingMethod` (bayesian/wilson). |
| Manifest permissions | `storage` — that's it. No `tabs`, `history`, `cookies`, `webRequest`, `<all_urls>`. |
| Host permissions | `*://*.amazon.in/*` only. Scoped to a single marketplace. |
| Remote code | None. `Content-Security-Policy: script-src 'self'`. No `eval`, no `new Function`, no dynamic imports. |
| Extension icons | No third-party icon libraries. |

This posture was designed to make a Chrome Web Store security review and Amazon.in ToS review as straightforward as possible. Client-side re-styling of a user's own already-rendered page is materially different from scraping, automated purchasing, or affiliate injection — all of which TrueRating explicitly does not do.

---

## Architecture decisions

Every significant decision is recorded in `docs/adr/` or `docs/SCORING.md`. The highlights:

**esbuild over Vite** — Vite's HMR and plugin ecosystem is irrelevant for an extension with no dev server. esbuild produces smaller IIFE bundles faster and with zero configuration overhead.

**All selectors in one file** — `src/selectors.ts` is the single file that changes when Amazon updates their HTML. Every selector, regex, and attribute name lives there. Updating the extension after an Amazon DOM change is a one-file diff.

**`document_idle` injection** — Amazon renders product cards with JavaScript. Injecting at `document_idle` (after DOMContentLoaded + subresources) means the cards are in the DOM when the content script runs.

**`chrome.storage.onChanged` instead of message passing** — The popup writes settings to `chrome.storage.local`; the content script subscribes to `onChanged`. No `chrome.tabs.sendMessage`, no `tabs` permission, no runtime.sendMessage. The two components are decoupled.

**Annotate-not-reorder as the default** — Re-ordering results (sorting by TR score) is opt-in and off by default. The safe default is to annotate the existing layout, not disrupt it. Users who want sorted results can enable it explicitly.

**Read the aria-label, not textContent** — Amazon's textContent abbreviates counts to "(27.6K)". The `aria-label` attribute carries the full number "27,612 ratings". The content script reads the attribute, not the text.

**Target `.puis-card-container`, not the outer wrapper** — Applying `opacity` to the outer `[data-component-type]` wrapper didn't visually dim the card content because it's a grid layout element. The inner `.puis-card-container` is the visual card. This was discovered during live testing.

---

## Test suite

**178 tests across 6 files.** Every significant behaviour is locked by a test.

| File | Tests | What it guards |
|------|-------|----------------|
| `src/scoring/__tests__/scoring.test.ts` | 42 | Core Bayesian + Wilson math, all edge cases |
| `src/scoring/__tests__/regression.test.ts` | 50 | **Locked invariants** — canonical 3.9@200k > 4.0@200 must never regress; monotonicity; boundary conditions; NaN prevention |
| `src/content/__tests__/amazon-dom.test.ts` | 26 | Real Amazon.in HTML fixtures — sponsored detection, rating extraction, badge placement, degradation |
| `src/content/__tests__/shared-regression.test.ts` | 32 | `injectStyles` idempotency, `clearAllChanges` completeness, `renderBadge` placement and accessibility, `applyDeSponsoring` mode matrix |
| `src/content/__tests__/idempotency.test.ts` | 14 | **processPage called 5× and 100× produces identical DOM** — catches badge accumulation and class stacking bugs |
| `src/content/__tests__/settings-integration.test.ts` | 14 | Settings pipeline end-to-end — `chrome.storage` mock, every mode/method transition, `enabled:false` short-circuit |

The test suite uses real HTML fixture files (`tests/fixtures/`) captured from live Amazon.in pages on 2026-05-25, not inline HTML strings. When Amazon updates their DOM, the fixture files are updated first — tests fail, selector is fixed, tests pass again (red-green proof of the fix).

---

## Install

```bash
git clone https://github.com/akashraj4562/TrueRating.git
cd TrueRating
npm install
npm run build
```

In Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the `dist/` folder
4. Open `https://www.amazon.in/s?k=headphones`
5. TR badges appear next to product ratings. Sponsored cards are dimmed.

---

## Tech stack

- **Manifest V3** Chrome extension
- **TypeScript** `strict: true` — no `any`, no implicit types
- **esbuild** — two IIFE bundles: `content-amazon.js` + `popup.js`
- **Vitest** + **happy-dom** — DOM tests without a browser
- Zero runtime dependencies — the content script ships nothing it didn't write

---

## The crew

TrueRating was built by a crew of 6 specialist AI agents, each with a defined mandate and decision rights:

| Agent | Mandate |
|-------|---------|
| **tech-lead** | Architecture, sequencing, ADRs, definition of done |
| **ratings-scientist** | Statistical correctness of Bayesian and Wilson scoring — owns the IP |
| **extension-engineer** | MV3 implementation, selectors, build pipeline |
| **product-steward** | Scope enforcement — kills feature creep, guards "never break the page" |
| **security-privacy-guardian** | Holds a veto. Nothing ships if it violates the §3 non-negotiables |
| **qa-resilience-engineer** | Test coverage, degradation suite, fixture maintenance, post-mortems |

Agent profiles live in `.claude/agents/` — each one specifies mandate, decision rights, push-back duties, and the concrete "feature working correctly" checklist they run before sign-off.

---

## Docs

| Document | Contents |
|----------|----------|
| `docs/SCORING.md` | Every statistical constant documented with rationale — prior mean, prior strength, floor/ceiling, p̂ approximation, honesty statement |
| `docs/TEST_PLAN.md` | Coverage audit, test matrix, regression-trigger map, known automation gaps |
| `docs/STATUS.md` | Phase checklist, 60-second demo script, security audit record |
| `docs/adr/0001-overall-architecture.md` | Architecture Decision Record — esbuild choice, selector strategy, injection timing |

---

## License

MIT — see [LICENSE](./LICENSE).

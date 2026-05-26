# TrueRating

A Chrome extension that shows you the statistically honest rating of every product on Amazon.in — and dims the ads while it's at it.

> _Screenshot: TrueRating badges on Amazon.in search results_ — add a `docs/screenshot.png` and reference it here.

---

## What it does

Amazon's star averages mislead shoppers in two ways: sponsored listings masquerade as organic top results, and a raw average treats "4.0 from 200 reviews" as better than "3.9 from 200,000" — which is statistically backwards. TrueRating fixes both, on your own screen, without sending a single byte to any server. You see a small `TR` badge next to every product showing its confidence-weighted score, and sponsored cards are dimmed (or hidden, if you prefer).

---

## Why ratings are misleading (the math)

A product with **3.9★ from 200,000 reviews** is more trustworthy than **4.0★ from 200**. The second one might just be 200 friends-and-family ratings; the first has been judged by a city's worth of strangers. TrueRating shows you the statistically correct ranking by shrinking each item's average toward the crowd mean — a small sample gets pulled hard toward the prior, a large sample barely moves.

**Bayesian shrinkage (IMDb-style):**

```
WR = (v / (v + m)) × R + (m / (v + m)) × C
```

- `R` — the item's own average rating
- `v` — the item's number of ratings
- `C` — the crowd mean across visible items (fallback ~3.9)
- `m` — the prior strength: how many ratings the item must accumulate before we trust its own average more than the crowd

When `v >> m`, the item's own `R` dominates. When `v << m`, the crowd mean `C` dominates. The 4.0@200 product shrinks; the 3.9@200k product barely moves. The ranking inverts — correctly.

**Wilson lower bound (alternative view):** treats ratings ≥ 4★ as "positive" and returns the lower bound of the 95% confidence interval on that proportion. It penalises small samples even more aggressively than Bayesian shrinkage. Toggle between the two in the popup.

---

## Features

- **Confidence-weighted rating badge (`TR` score)** rendered next to every product
- **Bayesian shrinkage (IMDb-style)** as default, **Wilson lower bound** as alternative — toggle in the popup
- **Sponsored result dimming or hiding** — your choice (Dim / Hide / Off)
- **Works entirely offline** — zero network requests, ever. Verifiable with DevTools → Network tab

---

## Privacy

TrueRating collects nothing. There are no servers, no analytics, no telemetry, no "phone home." The only data persisted anywhere is your own settings (toggle state, scoring method, sponsor mode), stored locally via `chrome.storage.local`. The manifest requests `storage` and a single host permission scoped to `*.amazon.in/*` — nothing else.

---

## Install (unpacked — Chrome Developer Mode)

```bash
git clone https://github.com/YOUR_USERNAME/TrueRating.git
cd TrueRating
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Visit `https://www.amazon.in/s?k=headphones` — you should see `TR` badges next to product ratings

---

## Tech stack

- **Manifest V3** Chrome extension
- **TypeScript** with `strict: true` — no `any`
- **esbuild** for bundling (zero runtime dependencies)
- **Vitest** with **happy-dom** for unit + DOM tests
- Vanilla DOM in the content script — no React, no framework overhead in the injected payload

---

## Test suite

**178 tests across 6 files** cover:

- Pure scoring math — Bayesian shrinkage, Wilson lower bound, edge cases (zero ratings, tiny samples, huge samples)
- The canonical regression: **3.9★@200k must rank above 4.0★@200** under Bayesian shrinkage
- Amazon.in DOM extraction — selectors, malformed counts, missing fields
- Graceful degradation — when selectors break, the page is left untouched
- Style injection idempotence — multiple `injectStyles()` calls produce exactly one `<style>` tag
- Popup settings persistence and live re-render on storage change

Run with `npm test`.

---

## Roadmap

- **v0.1** — Amazon.in: confidence-weighted badges + de-sponsoring (done)
- **v0.2** — Flipkart support + "Sort by TrueRating" opt-in re-ordering
- **v0.3** — Safari / iOS via Safari Web Extension

---

## License

MIT — see [LICENSE](./LICENSE).

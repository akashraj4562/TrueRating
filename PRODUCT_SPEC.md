# PRODUCT_SPEC.md — ClearCart

The single source of truth for **what** we build. Changes here require product-steward sign-off.

## Problem
On Amazon.in and Flipkart, two things mislead shoppers: (1) sponsored placements masquerade as organic top results, and (2) a raw star average treats "4.0 from 200 ratings" as better than "3.9 from 200,000," which is statistically backwards. ClearCart fixes both, on the user's own screen.

## Scope for the POC (v0.1)
Two features, two sites, one browser family (Chromium). Nothing else.

### Feature A — De-sponsor
- Detect ad/sponsored results on search & listing pages via their on-page sponsored markers.
- Default behaviour: **dim** sponsored results (reduced opacity + a small "Sponsored" tag we add for clarity).
- Toggle in popup: Dim ↔ Hide ↔ Off. Default = Dim.
- Must never hide a result it cannot confidently classify as sponsored.

### Feature B — Confidence-weighted rating badge
- For each visible product with a rating + rating count, compute a **weighted score** and render a small badge next to the native stars showing the adjusted score and emphasising the count.
- Primary method: **Bayesian shrinkage (IMDb-style)** — see the ratings-scientist's spec. Toggle to a **Wilson lower-bound** view as an alternative.
- Optional (off by default): a "Sort by ClearCart score" button that re-orders *visible* cards. Annotate-without-reordering is the safe default; reordering is opt-in.
- Edge cases handled visibly and sanely: no ratings, "New", 1–2 ratings, malformed counts.

### Popup UI
- On/off master switch, the three de-sponsor modes, the rating-method toggle, and a one-line explanation of the score. Plain, accessible (aria labels, contrast), no tracking.

## Explicitly OUT of scope for v0.1 (product-steward will enforce)
Accounts, login, any backend, any cross-device sync, price tracking/history, more sites, more browsers, recommendations, affiliate anything, "best deal" claims, multi-language. These are future bets, not v0.1.

## Rating math (authoritative; ratings-scientist owns refinements)
**Bayesian weighted rating:**  `WR = (v / (v + m)) * R + (m / (v + m)) * C`
- `R` = the item's average rating (0–5)
- `v` = number of ratings for the item
- `C` = prior mean rating across visible items (fallback constant ~3.9 if too few items)
- `m` = prior strength (how many ratings before we trust the item's own average); default = median rating-count across visible items, clamped to a sane floor/ceiling.
This makes low-volume items shrink toward the crowd mean while high-volume items keep their own average — solving the canonical 4.0@200 vs 3.9@200k case.

**Wilson lower bound (alternative view):** treat ratings ≥ 4★ as "positive," compute the lower bound of the 95% Wilson interval on that proportion; penalises small samples. Document z and the positive-threshold choice.

All math is **pure, DOM-free, unit-tested**.

## Success criteria for v0.1
A shopper installs the unpacked extension, opens an Amazon.in and a Flipkart search page, and within seconds sees sponsored items dimmed and trustworthy rating badges — with the network tab empty and the page never breaking.

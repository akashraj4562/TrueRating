# SCORING.md — ClearCart Rating Math

_Owned by the ratings-scientist. Every prior, threshold, and constant is documented here.
Update this file whenever any default changes — BEFORE merging._

---

## Why we re-weight ratings

Amazon.in and Flipkart display a raw star average. This treats "4.0 from 200 ratings"
as better than "3.9 from 200,000 ratings." Statistically, the second item's average is
far more reliable — 200 ratings barely constrain the true mean, while 200,000 ratings
converge tightly on it.

ClearCart corrects for small-sample distortion. It does not claim to know the "true"
quality of a product. Ratings can be gamed, biased, or unrepresentative. Our job is
only to surface the more statistically reliable signal among what is shown on the page.

---

## Method A: Bayesian Shrinkage (primary)

**Formula:** `WR = (v / (v + m)) * R + (m / (v + m)) * C`

| Symbol | Meaning | Source |
|--------|---------|--------|
| `R` | Item's raw star average (0–5) | DOM |
| `v` | Item's rating count (parsed) | DOM |
| `C` | Prior mean — see below | Computed per page |
| `m` | Prior strength — see below | Computed per page |

The formula is a weighted average between the item's own rating `R` and the corpus
prior `C`. When `v` is large relative to `m`, the item's own average dominates.
When `v` is small, the score shrinks toward `C`.

### Prior mean C

**Definition:** Unweighted mean of all valid item ratings on the current page.

**Why unweighted?** A single viral product with 500,000 reviews would dominate a
weighted mean, pulling `C` toward its rating. Unweighted gives every product one vote.

**Fallback constant:** `3.5` — used when fewer than 3 valid items are on the page.

**Why 3.5, not ~3.9 (the spec's initial suggestion)?**
The fallback fires only when we have too few items to compute a real prior. In that
situation, `3.9` is too close to typical high-rated items to produce meaningful
shrinkage — a 4.0 item would barely be penalised. `3.5` is the midpoint of the 0–5
scale, the maximally neutral "know nothing" prior. This is a documented deviation from
the initial spec suggestion, justified by the math.

### Prior strength m

**Definition:** Median rating count across all valid items on the page, clamped to `[10, 1000]`.

**Why median, not mean?**
A single item with 200,000 ratings would inflate the mean dramatically, making `m`
large and over-shrinking every other item. The median is robust to such outliers.

**Floor = 10:** Ensures at least some shrinkage even on very sparse pages.
Below 10, the formula barely moves an item's score.

**Ceiling = 1,000:** Beyond 1,000, additional prior strength has diminishing effect
on items with real review counts and makes the math harder to reason about. In practice,
`m` rarely hits this ceiling on real search pages.

### Canonical verification

**Assertion:** 3.9★ from 200,000 ratings ranks above 4.0★ from 200 ratings.

With a realistic corpus of 10 products (C ≈ 3.67, m = 550):

```
WR(4.0★, 200)     = (200 / 750)  × 4.0 + (550 / 750)  × 3.67 ≈ 3.757
WR(3.9★, 200,000) = (200000/200550) × 3.9 + (550/200550) × 3.67 ≈ 3.896

3.896 > 3.757 ✅
```

This is a **required passing assertion** in `src/scoring/__tests__/scoring.test.ts`.
If this test fails after any change to defaults, the change must be reverted or
a new SCORING.md rationale written and reviewed.

---

## Method B: Wilson Lower Bound (alternative view)

**Formula (95% confidence):**
```
W = (p̂ + z²/2n − z·√(p̂(1−p̂)/n + z²/4n²)) / (1 + z²/n)
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| z | 1.96 | Standard 95% two-tailed z-score. 99% (z=2.576) compresses scores too aggressively on typical marketplace data, making items indistinguishable. |
| "Positive" threshold | ≥ 4★ | Items rated 4 or 5 stars constitute a positive signal. |
| Positive proportion p̂ | `rating / 5` | **Approximation** — see below. |

**Output range:** [0, 1]. This is a ranking signal, not a star-rating equivalent.
Do not display the Wilson score as stars.

### Known limitation: the p̂ approximation

We only have the aggregate star average from the DOM — not the raw distribution
(how many 1-star, 2-star, … 5-star ratings). We estimate `p̂ = rating / 5`.

This is a linear approximation:
- `4.0★` → `p̂ = 0.80`
- `3.9★` → `p̂ = 0.78`
- `5.0★` → `p̂ = 1.00`
- `1.0★` → `p̂ = 0.20`

The actual proportion of 4+ star ratings for a given average will vary depending on
the shape of the distribution (e.g., a bimodal 5★/1★ split vs. a tight cluster around
4★ both produce a 4.0 average but different true positive proportions). This
approximation is understood and accepted for v0.1 because:
1. It is monotonically correct — higher average always → higher `p̂`.
2. It is explainable in one sentence to any user.
3. We do not have access to the breakdown.

### Canonical verification

With the approximation:

```
Wilson(4.0★, 200)     → p̂ = 0.80, n=200     → lower bound ≈ 0.739
Wilson(3.9★, 200,000) → p̂ = 0.78, n=200,000 → lower bound ≈ 0.778

0.778 > 0.739 ✅
```

Also a **required passing assertion** in the unit tests.

---

## Count string parsing

Rating count strings are parsed before any math. The parse layer (`src/scoring/parse.ts`)
handles all formats observed on Amazon.in and Flipkart.

| Input | Output | Notes |
|-------|--------|-------|
| `"1234"` | 1234 | Plain integer |
| `"1,234"` | 1234 | Western comma format |
| `"1,23,456"` | 123456 | Indian lakh format |
| `"1,00,000"` | 100000 | Indian lakh format |
| `"2.3k"` | 2300 | Lowercase k (thousands) |
| `"12K"` | 12000 | Uppercase K |
| `"1.2M"` | 1200000 | Million suffix |
| `"New"` | null | Product with no reviews yet |
| `"N/A"` | null | Unavailable |
| `null` / `undefined` | null | Missing DOM element |

**Parsing errors always return `null`.** The caller treats `null` as "no data" and
skips the badge — it does not substitute zero or display a misleading score.

---

## Honesty statement

ClearCart reduces small-sample rating noise. It does not:
- Know whether ratings are authentic or manipulated
- Account for review bombing, incentivised reviews, or fake reviews
- Have access to historical rating distributions or trends
- Claim to measure product quality

The score reflects **statistical confidence in the rating average**, not verified
product quality. A high-count item with a 3.9 average could still have systematically
biased reviews. Use ClearCart scores as one signal among many, not as ground truth.

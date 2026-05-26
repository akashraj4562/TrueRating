/**
 * Bayesian shrinkage scoring — the primary ClearCart method.
 *
 * Formula: WR = (v / (v + m)) * R + (m / (v + m)) * C
 *
 *   R  = item's raw star average (0–5)
 *   v  = item's rating count
 *   C  = prior mean  (mean rating across visible page items)
 *   m  = prior strength (median rating count across page, clamped)
 *
 * Low-count items shrink toward C.  High-count items keep their own R.
 * This makes "3.9 from 200,000" rank above "4.0 from 200" — the canonical ClearCart case.
 */

// why: 3.5 is the midpoint of the 0–5 scale — the maximally conservative "know nothing"
// prior. The spec suggested ~3.9, but 3.9 is too close to typical item ratings to
// produce meaningful shrinkage when it fires (i.e., when the page has too few items to
// compute a real corpus mean). Documented deviation from spec; justified by the math.
const FALLBACK_PRIOR_MEAN = 3.5;

// why: fewer than 3 items on a page is pathological — we can't form a meaningful
// corpus mean. Fall back to the constant above.
const MIN_CORPUS_SIZE = 3;

// why: floor of 10 ensures at least some shrinkage even on very sparse pages.
// Ceiling of 1000 caps diminishing returns — beyond 1000 the formula barely changes
// for items with real review counts, and it makes the math easier to reason about.
const PRIOR_STRENGTH_FLOOR = 10;
const PRIOR_STRENGTH_CEIL = 1_000;

export type ScoringContext = {
  /** C: unweighted mean star rating across visible items on the page. */
  priorMean: number;
  /** m: median rating count across visible items, clamped to [10, 1000]. */
  priorStrength: number;
};

export type CorpusItem = {
  rating: number;
  count: number;
};

/**
 * Compute a ScoringContext from all visible items on the page.
 * Call once per page render; pass the result to bayesianScore for every item.
 */
export function computeContext(items: CorpusItem[]): ScoringContext {
  const valid = items.filter(
    (it) =>
      isFinite(it.rating) &&
      it.rating >= 0 &&
      it.rating <= 5 &&
      isFinite(it.count) &&
      it.count > 0,
  );

  if (valid.length < MIN_CORPUS_SIZE) {
    return { priorMean: FALLBACK_PRIOR_MEAN, priorStrength: PRIOR_STRENGTH_FLOOR };
  }

  // C: unweighted mean — each product casts one vote regardless of review volume,
  // so a single viral item with 500k reviews doesn't dominate the prior.
  const priorMean = valid.reduce((sum, it) => sum + it.rating, 0) / valid.length;

  // m: median count — robust to the one outlier with 200k reviews that would
  // otherwise inflate the mean and over-shrink every other item on the page.
  const sorted = [...valid].sort((a, b) => a.count - b.count);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1]?.count ?? 0) + (sorted[mid]?.count ?? 0)) / 2
      : (sorted[mid]?.count ?? 0);

  const priorStrength = Math.min(
    PRIOR_STRENGTH_CEIL,
    Math.max(PRIOR_STRENGTH_FLOOR, median),
  );

  return { priorMean, priorStrength };
}

/**
 * Bayesian weighted rating for a single item.
 * Returns null (never NaN) when the inputs are invalid or count is zero.
 * The caller must not render a badge if null is returned.
 */
export function bayesianScore(
  rating: number,
  count: number,
  ctx: ScoringContext,
): number | null {
  if (!isFinite(rating) || rating < 0 || rating > 5) return null;
  if (!isFinite(count) || count <= 0) return null;

  const { priorMean: C, priorStrength: m } = ctx;
  // why: standard Bayesian shrinkage formula. As count → ∞ the weight on C → 0
  // and WR → R. As count → 0 the weight on C → 1 and WR → C.
  return (count / (count + m)) * rating + (m / (count + m)) * C;
}

/**
 * Wilson lower bound scoring — the alternative ClearCart view.
 *
 * Computes the lower bound of the 95% Wilson confidence interval on the
 * proportion of "positive" ratings (≥ 4★). Penalises small samples heavily:
 * a 4.0 from 200 ratings scores lower than a 3.9 from 200,000.
 *
 * Formula:
 *   W = (p̂ + z²/2n − z·√(p̂(1−p̂)/n + z²/4n²)) / (1 + z²/n)
 *
 * Known approximation: we don't have the raw rating distribution, only the
 * aggregate average. We estimate positive proportion as p̂ = rating / 5.
 * A 4.0 average → p̂ = 0.80. This is a linear approximation documented in
 * docs/SCORING.md. The Wilson view is a ranking signal, not a precise measurement.
 *
 * Output is in [0, 1] (not [0, 5] like Bayesian). Used for relative ranking only.
 */

// why: z = 1.96 is the standard 95% two-tailed confidence z-score.
// 95% chosen over 99% because 99% compresses all scores too aggressively on
// typical marketplace data, making items indistinguishable. 95% gives a useful signal.
const Z = 1.96;
const Z2 = Z * Z; // why: precomputed to avoid repeated multiplication in hot path

/**
 * Estimate the "positive proportion" (ratings ≥ 4★) from a 0–5 average.
 *
 * Approximation: p̂ = rating / 5
 *   4.0★ → 0.80,  3.9★ → 0.78,  5.0★ → 1.00,  1.0★ → 0.20
 *
 * Clamped to [0, 1] so scrape artefacts (e.g., 5.1★) don't break the math.
 */
function positiveProportion(rating: number): number {
  return Math.min(1, Math.max(0, rating / 5));
}

/**
 * Wilson lower bound for a single item.
 * Returns null (never NaN) when count ≤ 0 or inputs are invalid.
 */
export function wilsonScore(rating: number, count: number): number | null {
  if (!isFinite(rating) || rating < 0 || rating > 5) return null;
  if (!isFinite(count) || count <= 0) return null;

  const p = positiveProportion(rating);
  const n = count;

  const numerator =
    p +
    Z2 / (2 * n) -
    Z * Math.sqrt((p * (1 - p)) / n + Z2 / (4 * n * n));

  const denominator = 1 + Z2 / n;

  const w = numerator / denominator;

  // why: floating-point edge cases at p=0 or p=1 with very large n can drift
  // fractionally outside [0, 1]; clamp to keep the output contract clean.
  return Math.min(1, Math.max(0, w));
}

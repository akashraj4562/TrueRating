/**
 * scoreItem — the single entry point for the ClearCart scoring layer.
 *
 * Takes a product's raw DOM data and a pre-computed corpus context,
 * returns a ScoreResult that includes the score AND all inputs — so the
 * popup badge can show the user exactly what went into their number.
 *
 * This layer is pure: no DOM access, no network, no side effects.
 * All DOM parsing and context computation happens at the call site (content scripts).
 */

import { bayesianScore, computeContext } from './bayesian.js';
import { wilsonScore } from './wilson.js';
import { parseRatingCount } from './parse.js';

export type { ScoringContext, CorpusItem } from './bayesian.js';
export { computeContext, parseRatingCount };

export type RatingMethod = 'bayesian' | 'wilson';

export type RatedItem = {
  /** Star average parsed from the DOM, 0–5. null if the element was missing. */
  rating: number | null;
  /**
   * Raw rating-count string from the DOM — e.g. "1,23,456", "2.3k", "New".
   * null if the element was missing entirely.
   */
  rawCount: string | null;
};

export type ScoreResult =
  | {
      hasScore: true;
      method: RatingMethod;
      /** The weighted score. Bayesian: [0, 5]. Wilson: [0, 1]. */
      score: number;
      /** The item's raw rating, as parsed from the DOM. */
      rating: number;
      /** The item's rating count, as parsed from rawCount. */
      count: number;
      /** (Bayesian only) the corpus prior mean used. */
      priorMean?: number;
      /** (Bayesian only) the prior strength (m) used. */
      priorStrength?: number;
    }
  | {
      hasScore: false;
      /** Why no score was produced. Never shown to users — internal diagnostic only. */
      reason: string;
    };

/**
 * Score a single product item.
 *
 * @param item   - The product's rating and raw count string from the DOM.
 * @param ctx    - Corpus context — call computeContext(allPageItems) once per page first.
 * @param method - Scoring method. Defaults to 'bayesian'.
 */
export function scoreItem(
  item: RatedItem,
  ctx: ReturnType<typeof computeContext>,
  method: RatingMethod = 'bayesian',
): ScoreResult {
  if (item.rating === null || !isFinite(item.rating)) {
    return { hasScore: false, reason: 'missing or invalid rating' };
  }

  const count = parseRatingCount(item.rawCount);
  if (count === null || count === 0) {
    return { hasScore: false, reason: 'missing or unparseable rating count' };
  }

  if (method === 'wilson') {
    const score = wilsonScore(item.rating, count);
    if (score === null) return { hasScore: false, reason: 'wilson: invalid inputs' };
    return { hasScore: true, method: 'wilson', score, rating: item.rating, count };
  }

  // default: bayesian
  const score = bayesianScore(item.rating, count, ctx);
  if (score === null) return { hasScore: false, reason: 'bayesian: invalid inputs' };

  return {
    hasScore: true,
    method: 'bayesian',
    score,
    rating: item.rating,
    count,
    priorMean: ctx.priorMean,
    priorStrength: ctx.priorStrength,
  };
}

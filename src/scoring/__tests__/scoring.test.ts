import { describe, it, expect } from 'vitest';
import { bayesianScore, computeContext } from '../bayesian.js';
import { wilsonScore } from '../wilson.js';
import { parseRatingCount } from '../parse.js';
import { scoreItem } from '../index.js';

/**
 * A realistic ScoringContext derived from a plausible Amazon.in search page:
 * 10 products with varied ratings and review counts.
 *
 * Computed values (verified manually):
 *   C  = (3.2+3.5+3.8+4.0+3.6+3.7+4.1+3.4+3.9+3.5) / 10 = 36.7 / 10 = 3.67
 *   sorted counts = [100, 200, 300, 450, 500, 600, 700, 800, 950, 1200]
 *   median = (500 + 600) / 2 = 550  → clamped to min(1000, max(10, 550)) = 550
 */
const REALISTIC_CTX = computeContext([
  { rating: 3.2, count: 100 },
  { rating: 3.5, count: 200 },
  { rating: 3.8, count: 500 },
  { rating: 4.0, count: 800 },
  { rating: 3.6, count: 1_200 },
  { rating: 3.7, count: 450 },
  { rating: 4.1, count: 600 },
  { rating: 3.4, count: 300 },
  { rating: 3.9, count: 700 },
  { rating: 3.5, count: 950 },
]);

// ─────────────────────────────────────────────────────────────────────────────
// parseRatingCount
// ─────────────────────────────────────────────────────────────────────────────

describe('parseRatingCount', () => {
  it('parses a plain integer', () => {
    expect(parseRatingCount('1234')).toBe(1234);
  });

  it('parses Western comma-formatted numbers', () => {
    expect(parseRatingCount('1,234')).toBe(1_234);
    expect(parseRatingCount('12,345')).toBe(12_345);
    expect(parseRatingCount('1,234,567')).toBe(1_234_567);
  });

  it('parses Indian lakh-formatted numbers', () => {
    expect(parseRatingCount('1,23,456')).toBe(1_23_456);
    expect(parseRatingCount('1,00,000')).toBe(1_00_000);
    expect(parseRatingCount('12,34,567')).toBe(12_34_567);
  });

  it('parses lowercase k suffix', () => {
    expect(parseRatingCount('2.3k')).toBe(2_300);
    expect(parseRatingCount('10k')).toBe(10_000);
    expect(parseRatingCount('1k')).toBe(1_000);
  });

  it('parses uppercase K suffix', () => {
    expect(parseRatingCount('12K')).toBe(12_000);
    expect(parseRatingCount('2.5K')).toBe(2_500);
  });

  it('parses M/m suffix (millions)', () => {
    expect(parseRatingCount('1.2M')).toBe(1_200_000);
    expect(parseRatingCount('2m')).toBe(2_000_000);
  });

  it('returns null for null', () => {
    expect(parseRatingCount(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseRatingCount(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRatingCount('')).toBeNull();
  });

  it('returns null for "New" (product with no reviews yet)', () => {
    expect(parseRatingCount('New')).toBeNull();
  });

  it('returns null for other unparseable strings', () => {
    expect(parseRatingCount('N/A')).toBeNull();
    expect(parseRatingCount('abc')).toBeNull();
    expect(parseRatingCount('—')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bayesianScore
// ─────────────────────────────────────────────────────────────────────────────

describe('bayesianScore', () => {
  it('returns null (not NaN, not 0) for zero ratings', () => {
    const result = bayesianScore(4.0, 0, REALISTIC_CTX);
    expect(result).toBeNull();
  });

  it('returns null for negative count', () => {
    expect(bayesianScore(4.0, -1, REALISTIC_CTX)).toBeNull();
  });

  it('returns null for NaN rating', () => {
    expect(bayesianScore(NaN, 100, REALISTIC_CTX)).toBeNull();
  });

  it('returns null for rating below 0', () => {
    expect(bayesianScore(-1, 100, REALISTIC_CTX)).toBeNull();
  });

  it('returns null for rating above 5', () => {
    expect(bayesianScore(6, 100, REALISTIC_CTX)).toBeNull();
  });

  it('shrinks a 1-rating item heavily toward the prior mean', () => {
    const score = bayesianScore(5.0, 1, REALISTIC_CTX);
    expect(score).not.toBeNull();
    // With v=1 and m=550, weight on own rating is ~0.18%; score ≈ priorMean
    expect(score!).toBeCloseTo(REALISTIC_CTX.priorMean, 0);
    expect(score!).toBeLessThan(4.0);
  });

  it('shrinks a 2-rating item heavily toward the prior mean', () => {
    const score = bayesianScore(5.0, 2, REALISTIC_CTX);
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(4.2); // heavily pulled down from 5.0
  });

  // ── CANONICAL ASSERTION ──────────────────────────────────────────────────
  it('CANONICAL: 3.9 from 200,000 ratings ranks above 4.0 from 200 ratings', () => {
    // With REALISTIC_CTX (C≈3.67, m=550):
    //   WR(4.0, 200)    = (200/750)*4.0 + (550/750)*3.67 ≈ 3.75
    //   WR(3.9, 200000) = (200000/200550)*3.9 + (550/200550)*3.67 ≈ 3.896
    const scoreLow  = bayesianScore(4.0, 200,     REALISTIC_CTX);
    const scoreHigh = bayesianScore(3.9, 200_000, REALISTIC_CTX);
    expect(scoreLow).not.toBeNull();
    expect(scoreHigh).not.toBeNull();
    expect(scoreHigh!).toBeGreaterThan(scoreLow!);
  });

  it('huge sample: score converges to the item\'s own rating', () => {
    const score = bayesianScore(4.2, 1_000_000, REALISTIC_CTX);
    expect(score).not.toBeNull();
    // With v=1M >> m=550, weight on own rating ≈ 99.95%
    expect(score!).toBeCloseTo(4.2, 1);
  });

  it('score is always in [0, 5] — never outside the star range', () => {
    const ratings = [0.1, 1.0, 2.5, 4.9, 5.0];
    const counts  = [1, 10, 1_000, 100_000];
    for (const rating of ratings) {
      for (const count of counts) {
        const s = bayesianScore(rating, count, REALISTIC_CTX);
        if (s !== null) {
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(5);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// wilsonScore
// ─────────────────────────────────────────────────────────────────────────────

describe('wilsonScore', () => {
  it('returns null (not NaN) for zero count', () => {
    expect(wilsonScore(4.0, 0)).toBeNull();
  });

  it('returns null for negative count', () => {
    expect(wilsonScore(4.0, -5)).toBeNull();
  });

  it('returns null for NaN rating', () => {
    expect(wilsonScore(NaN, 100)).toBeNull();
  });

  it('returns null for rating below 0', () => {
    expect(wilsonScore(-1, 100)).toBeNull();
  });

  it('1 rating: score is deeply penalised (well below the point estimate)', () => {
    const score = wilsonScore(5.0, 1);
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(0.8); // point estimate is 1.0; CI floor is low
  });

  it('2 ratings: still heavily penalised', () => {
    const score = wilsonScore(5.0, 2);
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(0.85);
  });

  // ── CANONICAL ASSERTION ──────────────────────────────────────────────────
  it('CANONICAL: 3.9 from 200,000 ratings ranks above 4.0 from 200 ratings', () => {
    // p(4.0) = 0.80, n=200    → Wilson lower bound ≈ 0.739
    // p(3.9) = 0.78, n=200000 → Wilson lower bound ≈ 0.778
    const scoreLow  = wilsonScore(4.0, 200);
    const scoreHigh = wilsonScore(3.9, 200_000);
    expect(scoreLow).not.toBeNull();
    expect(scoreHigh).not.toBeNull();
    expect(scoreHigh!).toBeGreaterThan(scoreLow!);
  });

  it('huge sample: lower bound converges to point estimate (p = rating/5)', () => {
    const score = wilsonScore(4.0, 10_000_000);
    expect(score).not.toBeNull();
    // p = 4.0/5 = 0.80; with n=10M the CI collapses to ≈ 0.80
    expect(score!).toBeCloseTo(0.8, 2);
  });

  it('score is always in [0, 1]', () => {
    const ratings = [0.0, 1.0, 2.5, 4.0, 5.0];
    const counts  = [1, 5, 50, 5_000, 500_000];
    for (const rating of ratings) {
      for (const count of counts) {
        const s = wilsonScore(rating, count);
        if (s !== null) {
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scoreItem (integration)
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreItem', () => {
  it('returns hasScore:false when rating is null', () => {
    const r = scoreItem({ rating: null, rawCount: '1000' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(false);
  });

  it('returns hasScore:false when rawCount is null', () => {
    const r = scoreItem({ rating: 4.0, rawCount: null }, REALISTIC_CTX);
    expect(r.hasScore).toBe(false);
  });

  it('returns hasScore:false for "New" count string', () => {
    const r = scoreItem({ rating: 4.0, rawCount: 'New' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(false);
  });

  it('returns hasScore:false for zero count string', () => {
    const r = scoreItem({ rating: 4.0, rawCount: '0' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(false);
  });

  it('returns a bayesian score by default with correct inputs', () => {
    const r = scoreItem({ rating: 4.2, rawCount: '1,234' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(true);
    if (r.hasScore) {
      expect(r.method).toBe('bayesian');
      expect(r.count).toBe(1_234);
      expect(r.score).toBeGreaterThan(0);
      expect(r.priorMean).toBeDefined();
      expect(r.priorStrength).toBeDefined();
    }
  });

  it('returns a wilson score when method=wilson', () => {
    const r = scoreItem({ rating: 3.9, rawCount: '2.3k' }, REALISTIC_CTX, 'wilson');
    expect(r.hasScore).toBe(true);
    if (r.hasScore) {
      expect(r.method).toBe('wilson');
      expect(r.count).toBe(2_300);
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('parses Indian locale count string correctly', () => {
    const r = scoreItem({ rating: 3.8, rawCount: '1,23,456' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(true);
    if (r.hasScore) {
      expect(r.count).toBe(1_23_456);
    }
  });

  it('parses k-suffix count string correctly', () => {
    const r = scoreItem({ rating: 4.0, rawCount: '12K' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(true);
    if (r.hasScore) {
      expect(r.count).toBe(12_000);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeContext
// ─────────────────────────────────────────────────────────────────────────────

describe('computeContext', () => {
  it('falls back to safe defaults when fewer than MIN_CORPUS_SIZE items', () => {
    const ctx = computeContext([{ rating: 4.0, count: 100 }]);
    expect(ctx.priorMean).toBeGreaterThan(0);
    expect(ctx.priorMean).toBeLessThanOrEqual(5);
    expect(ctx.priorStrength).toBeGreaterThanOrEqual(10);
  });

  it('filters out items with zero count or invalid rating', () => {
    // Only 1 valid item → falls back to defaults
    const ctx = computeContext([
      { rating: 4.0, count: 0 },   // invalid: zero count
      { rating: NaN, count: 500 }, // invalid: NaN rating
      { rating: 4.0, count: 100 }, // valid
    ]);
    // 1 valid item < MIN_CORPUS_SIZE, so fallback
    expect(ctx.priorStrength).toBe(10); // fallback floor
  });

  it('clamps priorStrength to [10, 1000]', () => {
    // Very high counts → median will exceed ceiling
    const ctx = computeContext([
      { rating: 3.5, count: 50_000 },
      { rating: 4.0, count: 80_000 },
      { rating: 3.8, count: 60_000 },
    ]);
    expect(ctx.priorStrength).toBeLessThanOrEqual(1_000);
    expect(ctx.priorStrength).toBeGreaterThanOrEqual(10);
  });

  it('REALISTIC_CTX has sensible values (C≈3.67, m=550)', () => {
    expect(REALISTIC_CTX.priorMean).toBeCloseTo(3.67, 1);
    expect(REALISTIC_CTX.priorStrength).toBe(550);
  });
});

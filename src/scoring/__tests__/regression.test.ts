/**
 * Regression suite — scoring math.
 *
 * This file exists to lock in the *contracts* of the scoring layer, so that future
 * "refactors" cannot silently change the user-visible math. Every test in this
 * file documents an invariant that, if it ever fails, means ClearCart is shipping
 * the wrong number to a user.
 *
 * Author: qa-resilience-engineer
 * Companion doc: docs/TEST_PLAN.md, Section B1
 */

import { describe, it, expect } from 'vitest';
import { bayesianScore, computeContext, type ScoringContext } from '../bayesian.js';
import { wilsonScore } from '../wilson.js';
import { parseRatingCount } from '../parse.js';
import { scoreItem } from '../index.js';

// ── Shared realistic context ──────────────────────────────────────────────────
// Same shape as scoring.test.ts so test failures are comparable.
//   C ≈ 3.67, m = 550 (verified in scoring.test.ts).
const REALISTIC_CTX: ScoringContext = computeContext([
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

// =============================================================================
//                              BAYESIAN REGRESSION
// =============================================================================

describe('Bayesian — locked invariants', () => {
  // ── The product's reason to exist ──────────────────────────────────────────
  it('CANONICAL [LOCKED]: bayesian(3.9, 200_000) > bayesian(4.0, 200)', () => {
    const a = bayesianScore(3.9, 200_000, REALISTIC_CTX);
    const b = bayesianScore(4.0, 200, REALISTIC_CTX);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // If this ever fails, ClearCart is recommending the wrong product.
    expect(a!).toBeGreaterThan(b!);
  });

  it('monotonicity: more ratings with the same R pulls score TOWARD R (not away)', () => {
    // R=4.5 is above prior mean (~3.67); more ratings should INCREASE the score
    // (less shrinkage toward C).
    const sparse = bayesianScore(4.5, 50, REALISTIC_CTX)!;
    const medium = bayesianScore(4.5, 5_000, REALISTIC_CTX)!;
    const dense = bayesianScore(4.5, 500_000, REALISTIC_CTX)!;
    expect(medium).toBeGreaterThan(sparse);
    expect(dense).toBeGreaterThan(medium);
    // Converges toward 4.5 — never above it.
    expect(dense).toBeLessThanOrEqual(4.5);
  });

  it('monotonicity: when R < C, more ratings pulls score DOWN (toward R)', () => {
    // R=2.0 is well below the prior mean (~3.67). More ratings → score drops.
    const sparse = bayesianScore(2.0, 50, REALISTIC_CTX)!;
    const dense = bayesianScore(2.0, 500_000, REALISTIC_CTX)!;
    expect(dense).toBeLessThan(sparse);
    expect(dense).toBeGreaterThanOrEqual(2.0);
  });

  it('boundary v=0 → returns null (NEVER NaN, NEVER 0)', () => {
    const s = bayesianScore(4.0, 0, REALISTIC_CTX);
    expect(s).toBeNull();
  });

  it('boundary v=1 → returns a finite number inside [0, 5]', () => {
    const s = bayesianScore(5.0, 1, REALISTIC_CTX);
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!)).toBe(true);
    expect(s!).toBeGreaterThanOrEqual(0);
    expect(s!).toBeLessThanOrEqual(5);
  });

  it('prior strength m is clamped at the floor when corpus is tiny', () => {
    // Single valid item → fallback to PRIOR_STRENGTH_FLOOR (10).
    const ctx = computeContext([{ rating: 4.0, count: 100 }]);
    expect(ctx.priorStrength).toBeGreaterThanOrEqual(10);
    // Confirm the floor specifically.
    expect(ctx.priorStrength).toBe(10);
  });

  it('prior strength m is clamped at the ceiling for huge-count corpora', () => {
    const ctx = computeContext([
      { rating: 3.5, count: 50_000 },
      { rating: 4.0, count: 80_000 },
      { rating: 3.8, count: 60_000 },
      { rating: 4.1, count: 90_000 },
      { rating: 3.9, count: 70_000 },
    ]);
    // Median is 70k, which exceeds the ceiling of 1000.
    expect(ctx.priorStrength).toBe(1_000);
  });

  it('single-item corpus falls back to FALLBACK_PRIOR_MEAN (3.5)', () => {
    const ctx = computeContext([{ rating: 4.9, count: 999 }]);
    // Spec: FALLBACK_PRIOR_MEAN = 3.5 (documented deviation from initial spec of 3.9).
    expect(ctx.priorMean).toBe(3.5);
  });

  it('two-item corpus still falls back (MIN_CORPUS_SIZE = 3)', () => {
    const ctx = computeContext([
      { rating: 4.0, count: 100 },
      { rating: 3.8, count: 200 },
    ]);
    expect(ctx.priorMean).toBe(3.5);
    expect(ctx.priorStrength).toBe(10);
  });

  it('three-item corpus computes a real prior (not fallback)', () => {
    const ctx = computeContext([
      { rating: 4.0, count: 100 },
      { rating: 3.8, count: 200 },
      { rating: 3.6, count: 300 },
    ]);
    // Real mean: (4.0 + 3.8 + 3.6) / 3 = 3.8
    expect(ctx.priorMean).toBeCloseTo(3.8, 2);
    // Median of [100, 200, 300] = 200
    expect(ctx.priorStrength).toBe(200);
  });

  it('all-identical-ratings corpus: C equals that rating; shrinkage still safe', () => {
    const ctx = computeContext([
      { rating: 4.2, count: 500 },
      { rating: 4.2, count: 600 },
      { rating: 4.2, count: 700 },
    ]);
    expect(ctx.priorMean).toBeCloseTo(4.2, 5);
    // An item also rated 4.2 should score very close to 4.2 (no shrinkage signal).
    const s = bayesianScore(4.2, 1_000, ctx);
    expect(s).not.toBeNull();
    expect(s!).toBeCloseTo(4.2, 3);
  });

  it('extreme low: 1.0★ with 1M ratings stays near 1.0', () => {
    const s = bayesianScore(1.0, 1_000_000, REALISTIC_CTX);
    expect(s).not.toBeNull();
    // With m=550 << v=1M, score should be ~1.0; tolerate small shrinkage to C.
    expect(s!).toBeGreaterThanOrEqual(1.0);
    expect(s!).toBeLessThan(1.05);
  });

  it('extreme high: 5.0★ with 1M ratings stays near 5.0', () => {
    const s = bayesianScore(5.0, 1_000_000, REALISTIC_CTX);
    expect(s).not.toBeNull();
    expect(s!).toBeLessThanOrEqual(5.0);
    expect(s!).toBeGreaterThan(4.99);
  });

  it('large corpus (1000 items) computes context without stack overflow / hang', () => {
    const items = Array.from({ length: 1_000 }, (_, i) => ({
      rating: 3.0 + (i % 21) * 0.1, // 3.0 .. 5.0
      count: 100 + i,
    }));
    const start = Date.now();
    const ctx = computeContext(items);
    const elapsed = Date.now() - start;
    expect(ctx.priorMean).toBeGreaterThan(0);
    expect(ctx.priorMean).toBeLessThanOrEqual(5);
    // Generous bound — happy-dom-free Node should be well under 100ms.
    expect(elapsed).toBeLessThan(500);
  });

  it('NEVER returns NaN regardless of input combination', () => {
    const ratings = [0, 0.1, 2.5, 4.99, 5];
    const counts = [1, 2, 50, 50_000];
    for (const r of ratings) {
      for (const c of counts) {
        const s = bayesianScore(r, c, REALISTIC_CTX);
        if (s !== null) {
          expect(Number.isNaN(s)).toBe(false);
          expect(Number.isFinite(s)).toBe(true);
        }
      }
    }
  });
});

// =============================================================================
//                                 WILSON REGRESSION
// =============================================================================

describe('Wilson — locked invariants', () => {
  it('CANONICAL [LOCKED]: wilson(3.9, 200_000) > wilson(4.0, 200)', () => {
    const a = wilsonScore(3.9, 200_000);
    const b = wilsonScore(4.0, 200);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!).toBeGreaterThan(b!);
  });

  it('zero ratings → returns null (NEVER NaN, NEVER 0)', () => {
    expect(wilsonScore(4.0, 0)).toBeNull();
  });

  it('perfect score (5.0★, 1M ratings): lower bound close to 1.0 but NOT > 1.0', () => {
    const s = wilsonScore(5.0, 1_000_000);
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(0.99);
    expect(s!).toBeLessThanOrEqual(1.0);
  });

  it('poor score (1.0★, 1M ratings): lower bound near 0.2 (p̂ = 0.2)', () => {
    // p̂ = 1/5 = 0.2; with huge n, CI collapses to ≈ 0.2.
    const s = wilsonScore(1.0, 1_000_000);
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThanOrEqual(0);
    expect(s!).toBeLessThan(0.25);
    expect(s!).toBeCloseTo(0.2, 2);
  });

  it('rating=0 with any positive n → returns 0 (or null), never negative', () => {
    const s = wilsonScore(0, 1_000);
    if (s !== null) {
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });

  it('output always in [0, 1] regardless of input combo', () => {
    const ratings = [0, 0.5, 1.0, 2.5, 4.0, 4.9, 5.0];
    const counts = [1, 5, 50, 500, 50_000, 5_000_000];
    for (const r of ratings) {
      for (const c of counts) {
        const s = wilsonScore(r, c);
        if (s !== null) {
          expect(Number.isFinite(s)).toBe(true);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('monotonicity in n: more ratings tightens the bound upward (toward p̂)', () => {
    // Same rating, increasing n — lower bound should rise monotonically toward p̂=0.8.
    const s1 = wilsonScore(4.0, 100)!;
    const s2 = wilsonScore(4.0, 10_000)!;
    const s3 = wilsonScore(4.0, 1_000_000)!;
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
    expect(s3).toBeLessThanOrEqual(0.8);
  });
});

// =============================================================================
//                              parseRatingCount REGRESSION
// =============================================================================

describe('parseRatingCount — locked invariants', () => {
  it('Indian lakh format: "1,23,456" → 123456', () => {
    expect(parseRatingCount('1,23,456')).toBe(123_456);
  });

  it('US/EU format: "1,234,567" → 1234567', () => {
    expect(parseRatingCount('1,234,567')).toBe(1_234_567);
  });

  it('comma in 5-digit count: "27,612" → 27612', () => {
    expect(parseRatingCount('27,612')).toBe(27_612);
  });

  it('lowercase k: "2.3k" → 2300', () => {
    expect(parseRatingCount('2.3k')).toBe(2_300);
  });

  it('uppercase K: "2.3K" → 2300', () => {
    expect(parseRatingCount('2.3K')).toBe(2_300);
  });

  it('uppercase M: "1.5M" → 1500000', () => {
    expect(parseRatingCount('1.5M')).toBe(1_500_000);
  });

  it('lowercase m: "1.5m" → 1500000', () => {
    expect(parseRatingCount('1.5m')).toBe(1_500_000);
  });

  // Parens — Amazon sometimes shows "(27,612)" in textContent
  // The parser doesn't strip parens itself; the call site does.
  // We document the call-site contract here by stripping parens then parsing.
  it('parens stripped (caller responsibility) → "(27,612)" → 27612', () => {
    const raw = '(27,612)'.replace(/[()]/g, '');
    expect(parseRatingCount(raw)).toBe(27_612);
  });

  it('single digit: "8" → 8', () => {
    expect(parseRatingCount('8')).toBe(8);
  });

  it('null → null', () => {
    expect(parseRatingCount(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(parseRatingCount(undefined)).toBeNull();
  });

  it('empty string → null', () => {
    expect(parseRatingCount('')).toBeNull();
  });

  it('whitespace only → null', () => {
    expect(parseRatingCount('   ')).toBeNull();
  });

  it('non-numeric "abc" → null', () => {
    expect(parseRatingCount('abc')).toBeNull();
  });

  it('non-numeric "New" → null', () => {
    expect(parseRatingCount('New')).toBeNull();
  });

  it('"0" → 0 (documented behaviour — scoreItem then rejects it)', () => {
    // Note: parseRatingCount returns 0 for "0"; scoreItem treats 0 as no-data
    // (count===0 check in src/scoring/index.ts).
    expect(parseRatingCount('0')).toBe(0);
  });

  it('negative numbers → null (parser rejects)', () => {
    expect(parseRatingCount('-5')).toBeNull();
  });

  it('decimal-but-no-suffix: "12.34" → 12 (rounded)', () => {
    expect(parseRatingCount('12.34')).toBe(12);
  });

  it('embedded whitespace: "1 234" → 1234', () => {
    expect(parseRatingCount('1 234')).toBe(1_234);
  });
});

// =============================================================================
//                                 scoreItem REGRESSION
// =============================================================================

describe('scoreItem — locked invariants', () => {
  it('hasScore=false when count parses to null', () => {
    const r = scoreItem({ rating: 4.0, rawCount: 'New' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(false);
  });

  it('hasScore=false when count parses to 0', () => {
    const r = scoreItem({ rating: 4.0, rawCount: '0' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(false);
  });

  it('hasScore=false when rating is null', () => {
    const r = scoreItem({ rating: null, rawCount: '1000' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(false);
  });

  it('hasScore=true when both rating and count are valid', () => {
    const r = scoreItem({ rating: 4.0, rawCount: '1000' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(true);
  });

  it("method='bayesian' uses bayesianScore (output ∈ [0, 5])", () => {
    const r = scoreItem({ rating: 4.0, rawCount: '500' }, REALISTIC_CTX, 'bayesian');
    expect(r.hasScore).toBe(true);
    if (r.hasScore) {
      expect(r.method).toBe('bayesian');
      // Bayesian outputs in [0, 5], Wilson in [0, 1].
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(5);
      // priorMean/priorStrength are populated for Bayesian only.
      expect(r.priorMean).toBeDefined();
      expect(r.priorStrength).toBeDefined();
    }
  });

  it("method='wilson' uses wilsonScore (output ∈ [0, 1])", () => {
    const r = scoreItem({ rating: 4.0, rawCount: '500' }, REALISTIC_CTX, 'wilson');
    expect(r.hasScore).toBe(true);
    if (r.hasScore) {
      expect(r.method).toBe('wilson');
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
      // Wilson result should NOT carry priorMean/priorStrength.
      expect(r.priorMean).toBeUndefined();
      expect(r.priorStrength).toBeUndefined();
    }
  });

  it("method='wilson' and method='bayesian' produce DIFFERENT scores for the same inputs", () => {
    const bay = scoreItem({ rating: 4.0, rawCount: '500' }, REALISTIC_CTX, 'bayesian');
    const wil = scoreItem({ rating: 4.0, rawCount: '500' }, REALISTIC_CTX, 'wilson');
    expect(bay.hasScore && wil.hasScore).toBe(true);
    if (bay.hasScore && wil.hasScore) {
      // Different scales — they should not coincidentally match.
      expect(bay.score).not.toBe(wil.score);
    }
  });

  it('result object always preserves rating and count when hasScore=true', () => {
    const r = scoreItem({ rating: 4.2, rawCount: '1,23,456' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(true);
    if (r.hasScore) {
      expect(r.rating).toBe(4.2);
      expect(r.count).toBe(1_23_456);
    }
  });

  it('hasScore=false result includes a diagnostic reason string', () => {
    const r = scoreItem({ rating: null, rawCount: '1000' }, REALISTIC_CTX);
    expect(r.hasScore).toBe(false);
    if (!r.hasScore) {
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

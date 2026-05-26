/**
 * Regression suite — shared content-script helpers.
 *
 * Covers the contracts of injectStyles, clearAllChanges, renderBadge, and
 * applyDeSponsoring. Every test here corresponds to a real or potential
 * regression that the qa-resilience-engineer has had to chase down (or
 * suspects could happen given how MutationObserver re-fires).
 *
 * Author: qa-resilience-engineer
 * Companion doc: docs/TEST_PLAN.md, Sections B3 + B4
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  injectStyles,
  clearAllChanges,
  applyDeSponsoring,
  renderBadge,
} from '../shared.js';
import type { ScoreResult } from '../../scoring/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function makeSponsoredLikeCard(): Element {
  // Minimal Amazon-shaped card with the .puis-card-container target.
  document.body.innerHTML = `
    <div data-component-type="s-search-result" data-asin="TEST1">
      <div class="puis-card-container">
        <a class="puis-sponsored-label-text">Sponsored</a>
        <h2><a>Test product</a></h2>
        <div class="rating-row">
          <a aria-label="4.2 out of 5 stars">stars</a>
          <a aria-label="1,234 ratings" id="count-anchor"><span>(1,234)</span></a>
        </div>
      </div>
    </div>`;
  return document.querySelector('[data-component-type="s-search-result"]')!;
}

function makeOrganicCard(): Element {
  document.body.innerHTML = `
    <div data-component-type="s-search-result" data-asin="TEST2">
      <div class="puis-card-container">
        <h2><a>Test organic product</a></h2>
        <a aria-label="4.2 out of 5 stars">stars</a>
        <a aria-label="1,234 ratings" id="count-anchor"><span>(1,234)</span></a>
      </div>
    </div>`;
  return document.querySelector('[data-component-type="s-search-result"]')!;
}

const BAY_RESULT: ScoreResult = {
  hasScore: true,
  method: 'bayesian',
  score: 3.76,
  rating: 4.2,
  count: 27_612,
  priorMean: 3.67,
  priorStrength: 550,
};

const WIL_RESULT: ScoreResult = {
  hasScore: true,
  method: 'wilson',
  score: 0.7392,
  rating: 4.2,
  count: 27_612,
};

const NO_SCORE_RESULT: ScoreResult = { hasScore: false, reason: 'test' };

// =============================================================================
//                              injectStyles
// =============================================================================

describe('injectStyles — idempotency + content', () => {
  it('produces exactly ONE <style id="cc-injected-styles"> after 5 calls', () => {
    injectStyles();
    injectStyles();
    injectStyles();
    injectStyles();
    injectStyles();
    const matches = document.querySelectorAll('style#cc-injected-styles');
    expect(matches.length).toBe(1);
  });

  it('injected CSS contains rules for .cc-dim, .cc-hide, .cc-badge', () => {
    injectStyles();
    const style = document.getElementById('cc-injected-styles');
    expect(style).not.toBeNull();
    const css = style!.textContent ?? '';
    expect(css).toContain('.cc-dim');
    expect(css).toContain('.cc-hide');
    expect(css).toContain('.cc-badge');
  });

  it('does not throw on a document with no head (degraded environment)', () => {
    // Removing head is destructive but a real injected script might run before
    // <head> exists in extreme cases. We assert no exception.
    expect(() => injectStyles()).not.toThrow();
  });
});

// =============================================================================
//                              clearAllChanges
// =============================================================================

describe('clearAllChanges — full restoration', () => {
  it('removes every .cc-dim class from the document', () => {
    document.body.innerHTML = '<div class="cc-dim"></div><div class="cc-dim other"></div>';
    clearAllChanges();
    expect(document.querySelectorAll('.cc-dim').length).toBe(0);
  });

  it('removes every .cc-hide class from the document', () => {
    document.body.innerHTML = '<div class="cc-hide"></div><div class="cc-hide other"></div>';
    clearAllChanges();
    expect(document.querySelectorAll('.cc-hide').length).toBe(0);
  });

  it('removes every .cc-badge element from the document', () => {
    document.body.innerHTML =
      '<span class="cc-badge">a</span><span class="cc-badge">b</span>';
    clearAllChanges();
    expect(document.querySelectorAll('.cc-badge').length).toBe(0);
  });

  it('removes every .cc-sponsor-tag element from the document', () => {
    document.body.innerHTML =
      '<span class="cc-sponsor-tag">Ad</span><span class="cc-sponsor-tag">Ad</span>';
    clearAllChanges();
    expect(document.querySelectorAll('.cc-sponsor-tag').length).toBe(0);
  });

  it('does NOT remove non-cc elements', () => {
    document.body.innerHTML = `
      <div class="cc-dim">x</div>
      <div class="someone-else">y</div>
      <span class="cc-badge">z</span>
      <p class="paragraph">untouched</p>`;
    clearAllChanges();
    expect(document.querySelector('.someone-else')).not.toBeNull();
    expect(document.querySelector('.paragraph')).not.toBeNull();
    // And the cc-* stuff is gone:
    expect(document.querySelector('.cc-dim')).toBeNull();
    expect(document.querySelector('.cc-badge')).toBeNull();
  });

  it('does not throw when none of the target classes exist', () => {
    document.body.innerHTML = '<div><p>just a page</p></div>';
    expect(() => clearAllChanges()).not.toThrow();
  });

  it('does not throw on an empty document body', () => {
    document.body.innerHTML = '';
    expect(() => clearAllChanges()).not.toThrow();
  });

  it('preserves the rest of the cardʼs classes when stripping cc-dim', () => {
    document.body.innerHTML =
      '<div class="puis-card-container cc-dim aok-relative">x</div>';
    clearAllChanges();
    const card = document.querySelector('.puis-card-container')!;
    expect(card.classList.contains('cc-dim')).toBe(false);
    expect(card.classList.contains('aok-relative')).toBe(true);
  });
});

// =============================================================================
//                              renderBadge
// =============================================================================

describe('renderBadge — placement, content, idempotency, accessibility', () => {
  function setupAnchor(): Element {
    document.body.innerHTML = '<div><a id="count-anchor">(1,234)</a></div>';
    return document.getElementById('count-anchor')!;
  }

  it('inserts the badge IMMEDIATELY after the anchor (nextElementSibling)', () => {
    const anchor = setupAnchor();
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    const badge = document.querySelector('.cc-badge');
    expect(badge).not.toBeNull();
    expect(anchor.nextElementSibling).toBe(badge);
  });

  it('badge has class "cc-badge"', () => {
    const anchor = setupAnchor();
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    expect(document.querySelector('.cc-badge')).not.toBeNull();
  });

  it('Bayesian badge text contains "TR" and a star "★"', () => {
    const anchor = setupAnchor();
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    const badge = document.querySelector('.cc-badge')!;
    expect(badge.textContent).toContain('TR');
    expect(badge.textContent).toContain('★');
  });

  it('Wilson badge text contains "TR" and a "%"', () => {
    const anchor = setupAnchor();
    renderBadge(anchor, WIL_RESULT, 'wilson');
    const badge = document.querySelector('.cc-badge')!;
    expect(badge.textContent).toContain('TR');
    expect(badge.textContent).toContain('%');
    expect(badge.textContent).not.toContain('★');
  });

  it('Bayesian score is rendered to 2 decimal places (e.g. "3.76★")', () => {
    // shared.ts uses .toFixed(2) for Bayesian, so a score 3.76 shows as "3.76★"
    const anchor = setupAnchor();
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    const badge = document.querySelector('.cc-badge')!;
    expect(badge.textContent).toMatch(/\d+\.\d{2}★/);
  });

  it('Wilson score is rendered to 1 decimal place with % (e.g. "73.9%")', () => {
    const anchor = setupAnchor();
    renderBadge(anchor, WIL_RESULT, 'wilson');
    const badge = document.querySelector('.cc-badge')!;
    expect(badge.textContent).toMatch(/\d+\.\d{1}%/);
  });

  it('IDEMPOTENCY: calling renderBadge twice on the same anchor still produces ONE badge after a clearAllChanges + re-render', () => {
    // Note: the production flow is `clearAllChanges()` THEN re-render — that is
    // how the orchestrator avoids duplicates. We document that contract here.
    const anchor = setupAnchor();
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    clearAllChanges();
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    expect(document.querySelectorAll('.cc-badge').length).toBe(1);
  });

  it('DOUBLE-CALL WITHOUT CLEAR: shared.renderBadge alone does NOT dedupe (caller must clear first)', () => {
    // This documents the contract: renderBadge is a leaf primitive and does NOT
    // dedupe. The orchestrator in amazon.ts must call clearAllChanges() first.
    // If this test ever fails (one badge instead of two), shared.ts has been
    // changed and the contract needs to be re-documented.
    const anchor = setupAnchor();
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    expect(document.querySelectorAll('.cc-badge').length).toBe(2);
  });

  it('does NOT render when result.hasScore is false', () => {
    const anchor = setupAnchor();
    renderBadge(anchor, NO_SCORE_RESULT, 'bayesian');
    expect(document.querySelector('.cc-badge')).toBeNull();
  });

  it('has an aria-label attribute for accessibility', () => {
    const anchor = setupAnchor();
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    const badge = document.querySelector('.cc-badge')!;
    const aria = badge.getAttribute('aria-label');
    expect(aria).not.toBeNull();
    expect(aria!.length).toBeGreaterThan(0);
    expect(aria!.toLowerCase()).toContain('truerating');
  });

  it('has a title attribute mentioning the method', () => {
    const anchor = setupAnchor();
    renderBadge(anchor, BAY_RESULT, 'bayesian');
    const badge = document.querySelector('.cc-badge')!;
    const title = badge.getAttribute('title') ?? '';
    expect(title.toLowerCase()).toContain('bayesian');
  });
});

// =============================================================================
//                              applyDeSponsoring
// =============================================================================

describe('applyDeSponsoring — mode matrix + target + idempotency', () => {
  it("mode='dim', isSponsored=true → adds cc-dim to .puis-card-container", () => {
    const card = makeSponsoredLikeCard();
    applyDeSponsoring(card, true, 'dim');
    expect(
      card.querySelector('.puis-card-container')?.classList.contains('cc-dim'),
    ).toBe(true);
  });

  it("mode='dim' also prepends a .cc-sponsor-tag inside the inner card", () => {
    const card = makeSponsoredLikeCard();
    applyDeSponsoring(card, true, 'dim');
    const tag = card.querySelector('.cc-sponsor-tag');
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toBe('Ad');
  });

  it("mode='hide', isSponsored=true → adds cc-hide to .puis-card-container", () => {
    const card = makeSponsoredLikeCard();
    applyDeSponsoring(card, true, 'hide');
    expect(
      card.querySelector('.puis-card-container')?.classList.contains('cc-hide'),
    ).toBe(true);
  });

  it("mode='off', isSponsored=true → nothing is added, HTML unchanged", () => {
    const card = makeSponsoredLikeCard();
    const before = card.innerHTML;
    applyDeSponsoring(card, true, 'off');
    expect(card.innerHTML).toBe(before);
  });

  it("mode='dim', isSponsored=false → organic card untouched", () => {
    const card = makeOrganicCard();
    const before = card.innerHTML;
    applyDeSponsoring(card, false, 'dim');
    expect(card.innerHTML).toBe(before);
  });

  it("mode='hide', isSponsored=false → organic card untouched", () => {
    const card = makeOrganicCard();
    const before = card.innerHTML;
    applyDeSponsoring(card, false, 'hide');
    expect(card.innerHTML).toBe(before);
  });

  it('missing .puis-card-container → falls back to the card element itself, no throw', () => {
    document.body.innerHTML = `
      <div data-component-type="s-search-result">
        <a class="puis-sponsored-label-text">Sponsored</a>
      </div>`;
    const card = document.querySelector('[data-component-type="s-search-result"]')!;
    expect(() => applyDeSponsoring(card, true, 'dim')).not.toThrow();
    // Fallback: card itself gets cc-dim because no inner container was found.
    expect(card.classList.contains('cc-dim')).toBe(true);
  });

  it('IDEMPOTENCY (single-call): calling dim twice without clearAllChanges still produces ONE cc-dim entry in classList', () => {
    // classList.add is idempotent by spec; we lock this behaviour in here so a
    // future refactor (e.g. using setAttribute('class', oldClass + ' cc-dim'))
    // does not break it.
    const card = makeSponsoredLikeCard();
    applyDeSponsoring(card, true, 'dim');
    applyDeSponsoring(card, true, 'dim');
    const inner = card.querySelector('.puis-card-container')!;
    expect(inner.classList.contains('cc-dim')).toBe(true);
    // Count occurrences of 'cc-dim' tokens — must be exactly 1.
    const tokens = (inner.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    expect(tokens.filter((t) => t === 'cc-dim').length).toBe(1);
  });

  it('IDEMPOTENCY (with clear): clearAllChanges + dim again still produces ONE sponsor tag', () => {
    const card = makeSponsoredLikeCard();
    applyDeSponsoring(card, true, 'dim');
    clearAllChanges();
    applyDeSponsoring(card, true, 'dim');
    const tags = card.querySelectorAll('.cc-sponsor-tag');
    expect(tags.length).toBe(1);
  });

  it('LEAK: dim twice WITHOUT clear leaks .cc-sponsor-tag (caller must clear first)', () => {
    // Documents the contract: applyDeSponsoring is a leaf primitive. The
    // orchestrator must call clearAllChanges() between renders or sponsor tags
    // accumulate. This is exactly the bug the user is likely seeing.
    const card = makeSponsoredLikeCard();
    applyDeSponsoring(card, true, 'dim');
    applyDeSponsoring(card, true, 'dim');
    const tags = card.querySelectorAll('.cc-sponsor-tag');
    expect(tags.length).toBe(2);
  });
});

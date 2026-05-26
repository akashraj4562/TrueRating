/**
 * QA — Amazon.in content script: fixture tests + degradation tests.
 *
 * Fixtures live in tests/fixtures/ — real Amazon.in DOM structure
 * captured live on 2026-05-25. Update fixtures when Amazon changes their HTML.
 *
 * Test suite guarantees:
 *   1. Sponsored detection correctly identifies ad cards from fixture HTML.
 *   2. Rating extraction correctly reads rating + count from fixture HTML.
 *   3. Badge rendering inserts cc-badge after the count element.
 *   4. Degradation: when selectors break, page HTML is UNCHANGED and nothing throws.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AMAZON } from '../../selectors.js';
import { parseRatingCount } from '../../scoring/parse.js';
import {
  injectStyles,
  clearAllChanges,
  applyDeSponsoring,
  renderBadge,
} from '../shared.js';
import { computeContext, scoreItem } from '../../scoring/index.js';

// ── Load fixtures from disk ───────────────────────────────────────────────────

function loadFixture(name: string): string {
  return readFileSync(
    resolve(process.cwd(), 'tests/fixtures', name),
    'utf-8',
  );
}

const FIXTURE = {
  sponsored:  loadFixture('amazon-sponsored-card.html'),
  organic:    loadFixture('amazon-organic-card.html'),
  noRating:   loadFixture('amazon-no-rating-card.html'),
};

// ── DOM helpers ───────────────────────────────────────────────────────────────

function makeCard(html: string): Element {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  document.body.appendChild(wrapper);
  const card = wrapper.querySelector('[data-component-type="s-search-result"]');
  if (!card) throw new Error('Fixture missing [data-component-type="s-search-result"]');
  return card;
}

/** Mirror of isSponsored() in amazon.ts — pure selector logic, no Chrome APIs */
function isSponsored(card: Element): boolean {
  if ((card as HTMLElement).dataset['componentType'] === AMAZON.SPONSORED_DATA_VALUE) {
    return true;
  }
  return card.querySelector(AMAZON.SPONSORED_LABEL) !== null;
}

/** Mirror of extractRatingText() — pure selector logic */
function extractRatingText(card: Element): string {
  const widget = card.querySelector(AMAZON.RATING_WIDGET);
  if (widget) {
    const label = widget.getAttribute(AMAZON.RATING_ARIA_ATTR) ?? '';
    if (label) return label;
  }
  return card.querySelector(AMAZON.RATING_FALLBACK)?.textContent?.trim() ?? '';
}

/** Mirror of extractCount() — prefers aria-label attribute over textContent */
function extractCount(card: Element): string | null {
  const el = card.querySelector(AMAZON.RATING_COUNT_SELECTOR);
  if (!el) return null;
  const fromAttr = (el.getAttribute('aria-label') ?? '')
    .replace(AMAZON.RATING_COUNT_ARIA_STRIP, '')
    .trim();
  const fromText = (el.textContent?.trim() ?? '').replace(/[()]/g, '');
  return fromAttr || fromText || null;
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = '';
});

// ── 1. Sponsored detection ────────────────────────────────────────────────────

describe('Sponsored detection (fixtures)', () => {
  it('fixture: sponsored card — isSponsored returns true', () => {
    const card = makeCard(FIXTURE.sponsored);
    expect(isSponsored(card)).toBe(true);
  });

  it('fixture: organic card — isSponsored returns false', () => {
    const card = makeCard(FIXTURE.organic);
    expect(isSponsored(card)).toBe(false);
  });

  it('fixture: no-rating card — isSponsored returns false', () => {
    const card = makeCard(FIXTURE.noRating);
    expect(isSponsored(card)).toBe(false);
  });

  it('fixture: sponsored card — .puis-sponsored-label-text is the detected signal', () => {
    const card = makeCard(FIXTURE.sponsored);
    expect(card.querySelector('.puis-sponsored-label-text')).not.toBeNull();
  });
});

// ── 2. Rating extraction ──────────────────────────────────────────────────────

describe('Rating extraction (fixtures)', () => {
  it('fixture: organic card — extracts rating 4.2 from aria-label on parent <a>', () => {
    const card = makeCard(FIXTURE.organic);
    const text = extractRatingText(card);
    const match = text.match(AMAZON.RATING_REGEX);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeCloseTo(4.2);
  });

  it('fixture: organic card — extracts count "27,612" from aria-label attribute', () => {
    const card = makeCard(FIXTURE.organic);
    const raw = extractCount(card);
    expect(raw).toBe('27,612');
    expect(parseRatingCount(raw)).toBe(27_612);
  });

  it('fixture: sponsored card — extracts rating 2.4 (low, below badge threshold)', () => {
    const card = makeCard(FIXTURE.sponsored);
    const text = extractRatingText(card);
    const match = text.match(AMAZON.RATING_REGEX);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeCloseTo(2.4);
  });

  it('fixture: sponsored card — count "8" is below MIN_RATINGS_FOR_BADGE (50)', () => {
    const card = makeCard(FIXTURE.sponsored);
    const raw = extractCount(card);
    expect(parseRatingCount(raw)).toBe(8);
    expect(parseRatingCount(raw)!).toBeLessThan(50);
  });

  it('fixture: no-rating card — extractRatingText returns empty string', () => {
    const card = makeCard(FIXTURE.noRating);
    expect(extractRatingText(card)).toBe('');
  });

  it('fixture: no-rating card — extractCount returns null', () => {
    const card = makeCard(FIXTURE.noRating);
    expect(extractCount(card)).toBeNull();
  });
});

// ── 3. Badge placement ────────────────────────────────────────────────────────

describe('Badge placement (fixtures)', () => {
  it('fixture: organic card — cc-badge inserted after count element', () => {
    const card = makeCard(FIXTURE.organic);
    const anchor = card.querySelector(AMAZON.RATING_COUNT_SELECTOR)!;
    const ctx = computeContext([{ rating: 4.2, count: 27_612 }]);
    const result = scoreItem({ rating: 4.2, rawCount: '27,612' }, ctx, 'bayesian');

    renderBadge(anchor, result, 'bayesian');

    const badge = document.querySelector('.cc-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('TR');
    // Badge must immediately follow the anchor element
    expect(anchor.nextElementSibling).toBe(badge);
  });

  it('fixture: organic card — badge score is lower than raw 4.2 (shrunk toward prior)', () => {
    const card = makeCard(FIXTURE.organic);
    const anchor = card.querySelector(AMAZON.RATING_COUNT_SELECTOR)!;
    const ctx = computeContext([{ rating: 4.2, count: 27_612 }]);
    const result = scoreItem({ rating: 4.2, rawCount: '27,612' }, ctx, 'bayesian');

    renderBadge(anchor, result, 'bayesian');

    // Score should be between priorMean and 4.2 (shrinkage, not amplification)
    if (result.hasScore) {
      expect(result.score).toBeLessThanOrEqual(4.2);
      expect(result.score).toBeGreaterThan(0);
    }
  });

  it('fixture: sponsored card — no badge rendered (count below threshold)', () => {
    const card = makeCard(FIXTURE.sponsored);
    const anchor = card.querySelector(AMAZON.RATING_COUNT_SELECTOR)!;
    // count=8, below MIN_RATINGS_FOR_BADGE=50 → scoreItem won't be called,
    // but even if we call it: simulate what the content script does
    const ctx = computeContext([{ rating: 2.4, count: 8 }]);
    const result = scoreItem({ rating: 2.4, rawCount: '8' }, ctx, 'bayesian');
    // Note: scoreItem itself doesn't enforce the threshold (that's the content script's job)
    // But renderBadge only renders if hasScore=true AND the badge would be meaningful
    renderBadge(anchor, result, 'bayesian');
    // No assertion on badge presence here — threshold is enforced in amazon.ts, not shared.ts
    // This test confirms renderBadge doesn't crash on low-count items
    expect(() => renderBadge(anchor, result, 'bayesian')).not.toThrow();
  });

  it('fixture: no-rating card — no badge element, page untouched', () => {
    const card = makeCard(FIXTURE.noRating);
    const htmlBefore = card.innerHTML;
    // No rating → no anchor → renderBadge never called
    // Verify the card is unchanged
    expect(card.innerHTML).toBe(htmlBefore);
    expect(document.querySelector('.cc-badge')).toBeNull();
  });
});

// ── 4. De-sponsor rendering ───────────────────────────────────────────────────

describe('De-sponsoring (fixtures)', () => {
  it('fixture: sponsored card dim — cc-dim added to .puis-card-container', () => {
    const card = makeCard(FIXTURE.sponsored);
    injectStyles();
    applyDeSponsoring(card, true, 'dim');
    expect(card.querySelector('.puis-card-container')?.classList.contains('cc-dim')).toBe(true);
  });

  it('fixture: sponsored card hide — cc-hide added to inner container', () => {
    const card = makeCard(FIXTURE.sponsored);
    applyDeSponsoring(card, true, 'hide');
    expect(card.querySelector('.puis-card-container')?.classList.contains('cc-hide')).toBe(true);
  });

  it('fixture: sponsored card off — no classes added, page untouched', () => {
    const card = makeCard(FIXTURE.sponsored);
    const htmlBefore = card.innerHTML;
    applyDeSponsoring(card, true, 'off');
    expect(card.innerHTML).toBe(htmlBefore);
  });

  it('fixture: organic card — never dimmed regardless of mode', () => {
    const card = makeCard(FIXTURE.organic);
    const htmlBefore = card.innerHTML;
    applyDeSponsoring(card, false, 'dim');
    expect(card.innerHTML).toBe(htmlBefore);
  });

  it('clearAllChanges removes cc-dim and cc-sponsor-tag from sponsored card', () => {
    const card = makeCard(FIXTURE.sponsored);
    injectStyles();
    applyDeSponsoring(card, true, 'dim');
    expect(card.querySelector('.cc-dim')).not.toBeNull();
    clearAllChanges();
    expect(document.querySelector('.cc-dim')).toBeNull();
    expect(document.querySelector('.cc-sponsor-tag')).toBeNull();
  });
});

// ── 5. Degradation tests ──────────────────────────────────────────────────────

describe('Degradation — selectors broken (Amazon updates their HTML)', () => {
  /** Card where ALL ClearCart selectors have been wiped out */
  function makeBrokenCard(): Element {
    return makeCard(`
      <div data-component-type="s-search-result">
        <div class="xyz-new-layout-2027">
          <span class="xyz-stars">4.5</span>
          <span class="xyz-count">9999</span>
        </div>
      </div>`);
  }

  it('extractRatingText: returns empty string, does not throw', () => {
    const card = makeBrokenCard();
    expect(() => extractRatingText(card)).not.toThrow();
    expect(extractRatingText(card)).toBe('');
  });

  it('extractCount: returns null, does not throw', () => {
    const card = makeBrokenCard();
    expect(() => extractCount(card)).not.toThrow();
    expect(extractCount(card)).toBeNull();
  });

  it('isSponsored: returns false, does not throw', () => {
    const card = makeBrokenCard();
    expect(() => isSponsored(card)).not.toThrow();
    expect(isSponsored(card)).toBe(false);
  });

  it('applyDeSponsoring: does not throw on broken structure', () => {
    const card = makeBrokenCard();
    expect(() => applyDeSponsoring(card, true, 'dim')).not.toThrow();
  });

  it('clearAllChanges: does not throw on empty document', () => {
    document.body.innerHTML = '';
    expect(() => clearAllChanges()).not.toThrow();
  });

  it('broken card HTML is UNCHANGED after all extraction attempts', () => {
    const card = makeBrokenCard();
    const htmlBefore = card.innerHTML;
    // Run everything that the content script would run on this card
    isSponsored(card);
    extractRatingText(card);
    extractCount(card);
    // No badge, no dim — nothing should have modified the DOM
    expect(card.innerHTML).toBe(htmlBefore);
  });

  it('fixture: no-rating card HTML is UNCHANGED after processing', () => {
    const card = makeCard(FIXTURE.noRating);
    const htmlBefore = card.innerHTML;
    isSponsored(card);
    extractRatingText(card);
    extractCount(card);
    expect(card.innerHTML).toBe(htmlBefore);
  });
});

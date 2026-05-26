/**
 * Regression suite — processPage idempotency under repeated invocation.
 *
 * This is the MOST IMPORTANT regression file in the project. The user's report
 * "I don't think the feature is working correctly" almost certainly traces to
 * the MutationObserver in src/content/amazon.ts firing repeatedly (Amazon's
 * own JS mutates the DOM continuously during hydration and infinite-scroll).
 *
 * If processPage is not perfectly idempotent — i.e. running it 5 times on
 * the same page produces 5x badges or 5x sponsor tags — the user will see a
 * progressively broken page that gets worse the longer they look at it.
 *
 * Strategy: load fixture HTML, run the orchestration logic (same as
 * src/content/amazon.ts::processPage but without chrome.storage), 5 and 100
 * times in sequence, and assert exact counts.
 *
 * Author: qa-resilience-engineer
 * Companion doc: docs/TEST_PLAN.md, Section B3 + B4 + B9
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AMAZON } from '../../selectors.js';
import {
  injectStyles,
  clearAllChanges,
  applyDeSponsoring,
  renderBadge,
} from '../shared.js';
import {
  computeContext,
  parseRatingCount,
  scoreItem,
  type ScoringContext,
} from '../../scoring/index.js';
import type { Settings } from '../../types.js';

// ── Fixture loading ──────────────────────────────────────────────────────────

function loadFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf-8');
}

const FIXTURE = {
  sponsored: loadFixture('amazon-sponsored-card.html'),
  organic: loadFixture('amazon-organic-card.html'),
  noRating: loadFixture('amazon-no-rating-card.html'),
};

const MIN_RATINGS_FOR_BADGE = 50; // mirror of constant in amazon.ts

// ── Local mirror of processPage's orchestration logic ─────────────────────────
// Mirrors src/content/amazon.ts; lives here so the test does not need to import
// the file (which calls chrome.storage at module load).

function isSponsored(card: Element): boolean {
  if ((card as HTMLElement).dataset['componentType'] === AMAZON.SPONSORED_DATA_VALUE) {
    return true;
  }
  return card.querySelector(AMAZON.SPONSORED_LABEL) !== null;
}

type Parsed = {
  rating: number;
  rawCount: string;
  countAnchor: Element;
};

function extractRating(card: Element): Parsed | null {
  let ratingText = '';
  const widget = card.querySelector(AMAZON.RATING_WIDGET);
  if (widget) ratingText = widget.getAttribute(AMAZON.RATING_ARIA_ATTR) ?? '';
  if (!ratingText) {
    ratingText = card.querySelector(AMAZON.RATING_FALLBACK)?.textContent?.trim() ?? '';
  }
  const m = ratingText.match(AMAZON.RATING_REGEX);
  if (!m) return null;
  const rating = parseFloat(m[1].replace(',', '.'));
  if (!isFinite(rating) || rating < 0 || rating > 5) return null;

  const countEl = card.querySelector(AMAZON.RATING_COUNT_SELECTOR);
  if (!countEl) return null;
  const aria = countEl.getAttribute('aria-label') ?? '';
  const fromAttr = aria.replace(AMAZON.RATING_COUNT_ARIA_STRIP, '').trim();
  const fromText = (countEl.textContent?.trim() ?? '').replace(/[()]/g, '');
  const rawCount = fromAttr || fromText;
  const n = parseRatingCount(rawCount);
  if (n === null) return null;
  if (n < MIN_RATINGS_FOR_BADGE) return null;
  return { rating, rawCount, countAnchor: countEl };
}

/**
 * Local processPage mirror — operates on the current document only.
 * This is the unit-under-test for the idempotency suite.
 */
function processPage(settings: Settings): void {
  clearAllChanges();
  if (!settings.enabled) return;

  const cards = document.querySelectorAll(AMAZON.RESULT_CARD);
  if (cards.length === 0) return;

  const parsedList: Array<{ card: Element; parsed: Parsed }> = [];
  cards.forEach((card) => {
    try {
      const p = extractRating(card);
      if (p) parsedList.push({ card, parsed: p });
    } catch {
      /* ignore */
    }
  });

  const ctx: ScoringContext = computeContext(
    parsedList.map(({ parsed }) => ({
      rating: parsed.rating,
      count: parseRatingCount(parsed.rawCount) ?? 0,
    })),
  );

  cards.forEach((card) => {
    try {
      applyDeSponsoring(card, isSponsored(card), settings.sponsorMode);
      const entry = parsedList.find((p) => p.card === card);
      if (!entry) return;
      const result = scoreItem(
        { rating: entry.parsed.rating, rawCount: entry.parsed.rawCount },
        ctx,
        settings.ratingMethod,
      );
      renderBadge(entry.parsed.countAnchor, result, settings.ratingMethod);
    } catch {
      /* ignore */
    }
  });
}

// ── DOM setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  injectStyles();
});

/**
 * Build a full search page with three fixture cards.
 * Returns the count of cards that should get a badge (organic only — its
 * count of 27,612 ≥ 50; sponsored count of 8 < 50; no-rating has none).
 */
function buildSearchPage(): { expectedBadges: number; expectedSponsorTags: number } {
  document.body.innerHTML = `
    <div id="search-results">
      ${FIXTURE.sponsored}
      ${FIXTURE.organic}
      ${FIXTURE.noRating}
    </div>`;
  return { expectedBadges: 1, expectedSponsorTags: 1 };
}

// ── Defaults & scenarios ─────────────────────────────────────────────────────

const SETTINGS_DIM_BAYES: Settings = {
  enabled: true,
  sponsorMode: 'dim',
  ratingMethod: 'bayesian',
};

const SETTINGS_HIDE_BAYES: Settings = {
  enabled: true,
  sponsorMode: 'hide',
  ratingMethod: 'bayesian',
};

const SETTINGS_OFF_WILSON: Settings = {
  enabled: true,
  sponsorMode: 'off',
  ratingMethod: 'wilson',
};

// =============================================================================
//                              IDEMPOTENCY — 5×
// =============================================================================

describe('processPage 5×: counts do not accumulate', () => {
  it('5× call → exactly 1 cc-badge (matches the qualifying organic card)', () => {
    const { expectedBadges } = buildSearchPage();
    for (let i = 0; i < 5; i++) processPage(SETTINGS_DIM_BAYES);
    expect(document.querySelectorAll('.cc-badge').length).toBe(expectedBadges);
  });

  it('5× call → exactly 1 cc-dim (matches the qualifying sponsored card)', () => {
    buildSearchPage();
    for (let i = 0; i < 5; i++) processPage(SETTINGS_DIM_BAYES);
    expect(document.querySelectorAll('.cc-dim').length).toBe(1);
  });

  it('5× call → exactly 1 cc-sponsor-tag', () => {
    const { expectedSponsorTags } = buildSearchPage();
    for (let i = 0; i < 5; i++) processPage(SETTINGS_DIM_BAYES);
    expect(document.querySelectorAll('.cc-sponsor-tag').length).toBe(expectedSponsorTags);
  });

  it('5× call in HIDE mode → exactly 1 cc-hide, zero cc-dim, zero cc-sponsor-tag', () => {
    buildSearchPage();
    for (let i = 0; i < 5; i++) processPage(SETTINGS_HIDE_BAYES);
    expect(document.querySelectorAll('.cc-hide').length).toBe(1);
    expect(document.querySelectorAll('.cc-dim').length).toBe(0);
    expect(document.querySelectorAll('.cc-sponsor-tag').length).toBe(0);
  });

  it('5× call in OFF/wilson → zero dim/hide/sponsor-tag, badge text uses %', () => {
    buildSearchPage();
    for (let i = 0; i < 5; i++) processPage(SETTINGS_OFF_WILSON);
    expect(document.querySelectorAll('.cc-dim').length).toBe(0);
    expect(document.querySelectorAll('.cc-hide').length).toBe(0);
    expect(document.querySelectorAll('.cc-sponsor-tag').length).toBe(0);
    // Badge present, and shows Wilson %.
    const badge = document.querySelector('.cc-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('%');
    expect(badge!.textContent).not.toContain('★');
  });

  it('5× call → no badge is a duplicate sibling of the same anchor', () => {
    buildSearchPage();
    for (let i = 0; i < 5; i++) processPage(SETTINGS_DIM_BAYES);
    // For every cc-badge in the document, its previous sibling must be unique.
    const badges = Array.from(document.querySelectorAll('.cc-badge'));
    const anchors = new Set<Element>();
    for (const b of badges) {
      const prev = b.previousElementSibling;
      expect(prev).not.toBeNull();
      // No two badges share the same previous sibling — i.e. no duplicate badges.
      expect(anchors.has(prev!)).toBe(false);
      anchors.add(prev!);
    }
  });

  it('5× call → no element has the cc-dim class listed twice in its class attribute', () => {
    buildSearchPage();
    for (let i = 0; i < 5; i++) processPage(SETTINGS_DIM_BAYES);
    for (const el of Array.from(document.querySelectorAll('.cc-dim'))) {
      const tokens = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
      const count = tokens.filter((t) => t === 'cc-dim').length;
      expect(count).toBe(1);
    }
  });
});

// =============================================================================
//                              IDEMPOTENCY — 100×
// =============================================================================

describe('processPage 100×: still no accumulation, still fast', () => {
  it('100× call → still exactly 1 of each cc-* element type', () => {
    buildSearchPage();
    const start = Date.now();
    for (let i = 0; i < 100; i++) processPage(SETTINGS_DIM_BAYES);
    const elapsed = Date.now() - start;
    expect(document.querySelectorAll('.cc-badge').length).toBe(1);
    expect(document.querySelectorAll('.cc-dim').length).toBe(1);
    expect(document.querySelectorAll('.cc-sponsor-tag').length).toBe(1);
    // Generous performance bound for happy-dom: 100 runs must complete within 5s.
    // Real Chrome will be much faster; this is just a regression tripwire.
    expect(elapsed).toBeLessThan(5_000);
  });
});

// =============================================================================
//                       MODE TRANSITIONS — no stale state
// =============================================================================

describe('Mode transitions through repeated processPage calls', () => {
  it('dim → hide: cc-dim removed, cc-hide applied, sponsor-tag removed', () => {
    buildSearchPage();
    processPage(SETTINGS_DIM_BAYES);
    expect(document.querySelectorAll('.cc-dim').length).toBe(1);
    expect(document.querySelectorAll('.cc-sponsor-tag').length).toBe(1);

    processPage(SETTINGS_HIDE_BAYES);
    expect(document.querySelectorAll('.cc-dim').length).toBe(0);
    expect(document.querySelectorAll('.cc-sponsor-tag').length).toBe(0);
    expect(document.querySelectorAll('.cc-hide').length).toBe(1);
  });

  it('hide → off: cc-hide removed, no sponsor markers remain', () => {
    buildSearchPage();
    processPage(SETTINGS_HIDE_BAYES);
    expect(document.querySelectorAll('.cc-hide').length).toBe(1);

    processPage(SETTINGS_OFF_WILSON);
    expect(document.querySelectorAll('.cc-hide').length).toBe(0);
    expect(document.querySelectorAll('.cc-dim').length).toBe(0);
    expect(document.querySelectorAll('.cc-sponsor-tag').length).toBe(0);
  });

  it('bayesian → wilson: badge updates from ★ to %', () => {
    buildSearchPage();
    processPage(SETTINGS_DIM_BAYES);
    let badge = document.querySelector('.cc-badge')!;
    expect(badge.textContent).toContain('★');

    processPage({ ...SETTINGS_DIM_BAYES, ratingMethod: 'wilson' });
    badge = document.querySelector('.cc-badge')!;
    expect(badge.textContent).toContain('%');
    expect(badge.textContent).not.toContain('★');
    // And we still only have one.
    expect(document.querySelectorAll('.cc-badge').length).toBe(1);
  });
});

// =============================================================================
//                       enabled: false short-circuit
// =============================================================================

describe('enabled:false fully restores the page', () => {
  it('disabling after dim removes every cc-* mark', () => {
    buildSearchPage();
    processPage(SETTINGS_DIM_BAYES);
    expect(document.querySelectorAll('.cc-badge').length).toBe(1);
    expect(document.querySelectorAll('.cc-dim').length).toBe(1);

    processPage({ ...SETTINGS_DIM_BAYES, enabled: false });
    expect(document.querySelectorAll('.cc-badge').length).toBe(0);
    expect(document.querySelectorAll('.cc-dim').length).toBe(0);
    expect(document.querySelectorAll('.cc-hide').length).toBe(0);
    expect(document.querySelectorAll('.cc-sponsor-tag').length).toBe(0);
  });
});

// =============================================================================
//                       DEGRADATION — broken DOM survives 5×
// =============================================================================

describe('Degradation — broken DOM survives repeated processPage calls', () => {
  it('cards with no recognised structure stay untouched across 5 runs', () => {
    document.body.innerHTML = `
      <div data-component-type="s-search-result">
        <div class="xyz-new-layout-2027">
          <span>4.5</span><span>9999</span>
        </div>
      </div>`;
    const before = document.body.innerHTML;
    for (let i = 0; i < 5; i++) processPage(SETTINGS_DIM_BAYES);
    expect(document.querySelectorAll('.cc-badge').length).toBe(0);
    expect(document.querySelectorAll('.cc-dim').length).toBe(0);
    // The card's own DOM is unchanged (we ignore the cc-* removal since none were added).
    expect(document.body.innerHTML.trim()).toBe(before.trim());
  });

  it('no result cards on the page → no throw, no cc-* added', () => {
    document.body.innerHTML = '<div><p>not a search results page</p></div>';
    expect(() => {
      for (let i = 0; i < 5; i++) processPage(SETTINGS_DIM_BAYES);
    }).not.toThrow();
    expect(document.querySelectorAll('.cc-badge').length).toBe(0);
  });
});

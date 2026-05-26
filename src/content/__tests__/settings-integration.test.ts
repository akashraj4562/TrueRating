/**
 * Regression suite — settings → rendering pipeline.
 *
 * Verifies that every Settings combination produces the expected page state.
 * Uses an in-memory chrome.storage mock so the orchestration code can be
 * exercised end-to-end without a real browser.
 *
 * The popup writes to chrome.storage.local; the content script subscribes via
 * chrome.storage.onChanged and re-runs processPage. We mock both sides and
 * assert that the pipeline produces the right page state for each toggle.
 *
 * Author: qa-resilience-engineer
 * Companion doc: docs/TEST_PLAN.md, Section B5 + B7
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
import { DEFAULT_SETTINGS, type Settings } from '../../types.js';

// ── chrome.storage.local mock ────────────────────────────────────────────────

type StorageListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string,
) => void;

const mockStorage: Record<string, unknown> = {};
const listeners: StorageListener[] = [];

const mockChrome = {
  storage: {
    local: {
      get: (
        keys: Record<string, unknown> | string[] | string | null,
        cb: (r: Record<string, unknown>) => void,
      ) => {
        // Mirror the production call: get(DEFAULTS, cb) returns merged defaults.
        if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
          const defaults = keys as Record<string, unknown>;
          const out: Record<string, unknown> = { ...defaults };
          for (const k of Object.keys(defaults)) {
            if (k in mockStorage) out[k] = mockStorage[k];
          }
          cb(out);
          return;
        }
        cb({ ...mockStorage });
      },
      set: (obj: Record<string, unknown>, cb?: () => void) => {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: mockStorage[k], newValue: v };
          mockStorage[k] = v;
        }
        cb?.();
        // Fire listeners (synchronously — happy-dom doesn't care about microtasks here).
        for (const l of listeners) l(changes, 'local');
      },
    },
    onChanged: {
      addListener: (l: StorageListener) => {
        listeners.push(l);
      },
    },
  },
};

(globalThis as unknown as Record<string, unknown>).chrome = mockChrome;

// ── Fixtures + local processPage mirror ───────────────────────────────────────

function loadFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf-8');
}

const FIXTURE = {
  sponsored: loadFixture('amazon-sponsored-card.html'),
  organic: loadFixture('amazon-organic-card.html'),
  noRating: loadFixture('amazon-no-rating-card.html'),
};

const MIN_RATINGS_FOR_BADGE = 50;

function isSponsored(card: Element): boolean {
  if ((card as HTMLElement).dataset['componentType'] === AMAZON.SPONSORED_DATA_VALUE) {
    return true;
  }
  return card.querySelector(AMAZON.SPONSORED_LABEL) !== null;
}

type Parsed = { rating: number; rawCount: string; countAnchor: Element };

function extractRating(card: Element): Parsed | null {
  let txt = '';
  const w = card.querySelector(AMAZON.RATING_WIDGET);
  if (w) txt = w.getAttribute(AMAZON.RATING_ARIA_ATTR) ?? '';
  if (!txt) txt = card.querySelector(AMAZON.RATING_FALLBACK)?.textContent?.trim() ?? '';
  const m = txt.match(AMAZON.RATING_REGEX);
  if (!m) return null;
  const rating = parseFloat(m[1].replace(',', '.'));
  if (!isFinite(rating) || rating < 0 || rating > 5) return null;
  const c = card.querySelector(AMAZON.RATING_COUNT_SELECTOR);
  if (!c) return null;
  const aria = c.getAttribute('aria-label') ?? '';
  const fromAttr = aria.replace(AMAZON.RATING_COUNT_ARIA_STRIP, '').trim();
  const fromText = (c.textContent?.trim() ?? '').replace(/[()]/g, '');
  const rawCount = fromAttr || fromText;
  const n = parseRatingCount(rawCount);
  if (n === null || n < MIN_RATINGS_FOR_BADGE) return null;
  return { rating, rawCount, countAnchor: c };
}

function processPage(s: Settings): void {
  clearAllChanges();
  if (!s.enabled) return;
  const cards = document.querySelectorAll(AMAZON.RESULT_CARD);
  if (cards.length === 0) return;

  const list: Array<{ card: Element; parsed: Parsed }> = [];
  cards.forEach((card) => {
    try {
      const p = extractRating(card);
      if (p) list.push({ card, parsed: p });
    } catch {
      /* ignore */
    }
  });

  const ctx: ScoringContext = computeContext(
    list.map(({ parsed }) => ({
      rating: parsed.rating,
      count: parseRatingCount(parsed.rawCount) ?? 0,
    })),
  );

  cards.forEach((card) => {
    try {
      applyDeSponsoring(card, isSponsored(card), s.sponsorMode);
      const entry = list.find((p) => p.card === card);
      if (!entry) return;
      const r = scoreItem(
        { rating: entry.parsed.rating, rawCount: entry.parsed.rawCount },
        ctx,
        s.ratingMethod,
      );
      renderBadge(entry.parsed.countAnchor, r, s.ratingMethod);
    } catch {
      /* ignore */
    }
  });
}

// ── Pipeline: reads settings, runs processPage, listens for onChanged ────────

function startContentScript(): { current: Settings } {
  const state = { current: { ...DEFAULT_SETTINGS } };
  injectStyles();

  chrome.storage.local.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>, (stored) => {
    state.current = stored as unknown as Settings;
    processPage(state.current);
  });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== 'local') return;
    chrome.storage.local.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>, (stored) => {
      state.current = stored as unknown as Settings;
      processPage(state.current);
    });
  });

  return state;
}

function buildSearchPage(): void {
  document.body.innerHTML = `
    <div id="search-results">
      ${FIXTURE.sponsored}
      ${FIXTURE.organic}
      ${FIXTURE.noRating}
    </div>`;
}

// ── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  listeners.length = 0;
});

// =============================================================================
//                              DEFAULT_SETTINGS
// =============================================================================

describe('DEFAULT_SETTINGS', () => {
  it('produces the documented initial state: enabled + dim + bayesian', () => {
    expect(DEFAULT_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_SETTINGS.sponsorMode).toBe('dim');
    expect(DEFAULT_SETTINGS.ratingMethod).toBe('bayesian');
  });

  it('on a fresh install, get(DEFAULTS, cb) returns the defaults verbatim', () => {
    let observed: Settings | undefined;
    chrome.storage.local.get(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      (r) => {
        observed = r as unknown as Settings;
      },
    );
    expect(observed).toEqual(DEFAULT_SETTINGS);
  });

  it('after first install, the page renders with dim + bayesian badge', () => {
    buildSearchPage();
    startContentScript();
    // dim mode → cc-dim on sponsored card; bayesian → ★ badge on organic card
    expect(document.querySelector('.cc-dim')).not.toBeNull();
    expect(document.querySelector('.cc-sponsor-tag')).not.toBeNull();
    const badge = document.querySelector('.cc-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('★');
  });
});

// =============================================================================
//                              enabled: false
// =============================================================================

describe('enabled:false', () => {
  it('initial enabled:false → page is fully untouched (no cc-* anywhere)', () => {
    mockStorage['enabled'] = false;
    mockStorage['sponsorMode'] = 'dim';
    mockStorage['ratingMethod'] = 'bayesian';
    buildSearchPage();
    startContentScript();
    expect(document.querySelector('.cc-badge')).toBeNull();
    expect(document.querySelector('.cc-dim')).toBeNull();
    expect(document.querySelector('.cc-hide')).toBeNull();
    expect(document.querySelector('.cc-sponsor-tag')).toBeNull();
  });

  it('toggling enabled true → false restores the page', () => {
    buildSearchPage();
    startContentScript();
    expect(document.querySelector('.cc-badge')).not.toBeNull();

    chrome.storage.local.set({ enabled: false });
    expect(document.querySelector('.cc-badge')).toBeNull();
    expect(document.querySelector('.cc-dim')).toBeNull();
    expect(document.querySelector('.cc-sponsor-tag')).toBeNull();
  });
});

// =============================================================================
//                              sponsorMode toggles
// =============================================================================

describe('sponsorMode toggles', () => {
  it("sponsorMode='hide' → cc-hide applied (not cc-dim)", () => {
    mockStorage['enabled'] = true;
    mockStorage['sponsorMode'] = 'hide';
    mockStorage['ratingMethod'] = 'bayesian';
    buildSearchPage();
    startContentScript();
    expect(document.querySelector('.cc-hide')).not.toBeNull();
    expect(document.querySelector('.cc-dim')).toBeNull();
  });

  it("sponsorMode='off' → neither cc-dim nor cc-hide on the sponsored card", () => {
    mockStorage['enabled'] = true;
    mockStorage['sponsorMode'] = 'off';
    mockStorage['ratingMethod'] = 'bayesian';
    buildSearchPage();
    startContentScript();
    expect(document.querySelector('.cc-dim')).toBeNull();
    expect(document.querySelector('.cc-hide')).toBeNull();
    expect(document.querySelector('.cc-sponsor-tag')).toBeNull();
    // Badge on organic card still renders.
    expect(document.querySelector('.cc-badge')).not.toBeNull();
  });

  it("dim → hide via onChanged: cc-dim removed, cc-hide applied", () => {
    buildSearchPage();
    startContentScript();
    expect(document.querySelector('.cc-dim')).not.toBeNull();
    expect(document.querySelectorAll('.cc-dim').length).toBe(1);

    chrome.storage.local.set({ sponsorMode: 'hide' });

    expect(document.querySelector('.cc-dim')).toBeNull();
    expect(document.querySelector('.cc-hide')).not.toBeNull();
    expect(document.querySelectorAll('.cc-hide').length).toBe(1);
  });

  it('hide → off via onChanged: cc-hide removed, no sponsor markers remain', () => {
    mockStorage['enabled'] = true;
    mockStorage['sponsorMode'] = 'hide';
    mockStorage['ratingMethod'] = 'bayesian';
    buildSearchPage();
    startContentScript();
    expect(document.querySelector('.cc-hide')).not.toBeNull();

    chrome.storage.local.set({ sponsorMode: 'off' });

    expect(document.querySelector('.cc-hide')).toBeNull();
    expect(document.querySelector('.cc-dim')).toBeNull();
    expect(document.querySelector('.cc-sponsor-tag')).toBeNull();
  });
});

// =============================================================================
//                              ratingMethod toggles
// =============================================================================

describe('ratingMethod toggles', () => {
  it("ratingMethod='wilson' → badge shows % (not ★)", () => {
    mockStorage['enabled'] = true;
    mockStorage['sponsorMode'] = 'dim';
    mockStorage['ratingMethod'] = 'wilson';
    buildSearchPage();
    startContentScript();
    const b = document.querySelector('.cc-badge')!;
    expect(b.textContent).toContain('%');
    expect(b.textContent).not.toContain('★');
  });

  it("ratingMethod='bayesian' → badge shows ★ (not %)", () => {
    mockStorage['enabled'] = true;
    mockStorage['sponsorMode'] = 'dim';
    mockStorage['ratingMethod'] = 'bayesian';
    buildSearchPage();
    startContentScript();
    const b = document.querySelector('.cc-badge')!;
    expect(b.textContent).toContain('★');
    expect(b.textContent).not.toContain('%');
  });

  it('bayesian → wilson via onChanged: badge text changes live, exactly one badge', () => {
    buildSearchPage();
    startContentScript();
    let badge = document.querySelector('.cc-badge')!;
    expect(badge.textContent).toContain('★');

    chrome.storage.local.set({ ratingMethod: 'wilson' });

    badge = document.querySelector('.cc-badge')!;
    expect(badge.textContent).toContain('%');
    expect(badge.textContent).not.toContain('★');
    expect(document.querySelectorAll('.cc-badge').length).toBe(1);
  });
});

// =============================================================================
//                              partial updates persist
// =============================================================================

describe('chrome.storage round-trip', () => {
  it('set then get returns the persisted value', () => {
    chrome.storage.local.set({ enabled: false });
    let observed: Settings | undefined;
    chrome.storage.local.get(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      (r) => {
        observed = r as unknown as Settings;
      },
    );
    expect(observed!.enabled).toBe(false);
    // unspecified keys still fall back to defaults
    expect(observed!.sponsorMode).toBe('dim');
    expect(observed!.ratingMethod).toBe('bayesian');
  });

  it('storage.onChanged fires once per set() call', () => {
    let fires = 0;
    chrome.storage.onChanged.addListener(() => {
      fires++;
    });
    chrome.storage.local.set({ sponsorMode: 'hide' });
    expect(fires).toBe(1);
    chrome.storage.local.set({ ratingMethod: 'wilson' });
    expect(fires).toBe(2);
  });
});

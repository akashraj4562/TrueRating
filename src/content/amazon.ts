/**
 * ClearCart — Amazon.in content script.
 *
 * Injected at document_idle. Does two things to search/listing pages:
 *   A) De-sponsors: dims or hides ad-labelled results.
 *   B) Re-weights ratings: renders a Bayesian or Wilson score badge next to stars.
 *
 * Non-negotiables enforced:
 *   - Zero network calls. No external resources. All logic runs locally.
 *   - Every DOM read/write is guarded — any failure leaves the page untouched.
 *   - Settings come from chrome.storage.local only.
 *   - Page re-processes on storage change via onChanged (no "tabs" permission needed).
 */

import { AMAZON } from '../selectors.js';
import { computeContext, scoreItem, parseRatingCount } from '../scoring/index.js';
import type { ScoringContext } from '../scoring/index.js';
import { DEFAULT_SETTINGS } from '../types.js';
import type { Settings } from '../types.js';

// why: below this count the Bayesian score is ~98% prior mean and almost zero
// information from the item itself — displaying it misleads users into thinking
// we have a meaningful signal when we don't. 50 is the minimum for the badge
// to contribute something beyond noise.
const MIN_RATINGS_FOR_BADGE = 50;
import {
  injectStyles,
  clearAllChanges,
  applyDeSponsoring,
  renderBadge,
} from './shared.js';

// ── Sponsored detection ───────────────────────────────────────────────────────

/**
 * Returns true if the card is a paid/sponsored placement.
 *
 * Two signals checked — we require at least one; false positives
 * (dimming organic results) are worse than false negatives.
 */
function isSponsored(card: Element): boolean {
  // Primary: outer card carries data-component-type="sp-sponsored-result"
  if ((card as HTMLElement).dataset['componentType'] === AMAZON.SPONSORED_DATA_VALUE) {
    return true;
  }
  // Fallback: a visible "Sponsored" text label inside the card
  return card.querySelector(AMAZON.SPONSORED_LABEL) !== null;
}

// ── Rating extraction ─────────────────────────────────────────────────────────

type ParsedRating = {
  rating: number;
  rawCount: string;
  countAnchor: Element; // element to insert the badge after
};

/**
 * Extract the rating and count from a product card.
 * Returns null if either is missing — badge is silently skipped.
 */
function extractRating(card: Element): ParsedRating | null {
  // ── Star rating ────────────────────────────────────────────────────────────
  let ratingText = '';

  // Primary: aria-label on the parent <a> of the star icon.
  // Verified live: <a aria-label="4.2 out of 5 stars, rating details">
  const ratingWidget = card.querySelector(AMAZON.RATING_WIDGET);
  if (ratingWidget) {
    ratingText = ratingWidget.getAttribute(AMAZON.RATING_ARIA_ATTR) ?? '';
  }

  // Fallback: .a-icon-alt span inside the star <i> contains the same text.
  if (!ratingText) {
    const altEl = card.querySelector(AMAZON.RATING_FALLBACK);
    ratingText = altEl?.textContent?.trim() ?? '';
  }

  const ratingMatch = ratingText.match(AMAZON.RATING_REGEX);
  if (!ratingMatch) return null;

  // why: replace comma-decimal (e.g. "4,0" in some locales) with a period
  const rating = parseFloat(ratingMatch[1].replace(',', '.'));
  if (!isFinite(rating) || rating < 0 || rating > 5) return null;

  // ── Rating count ───────────────────────────────────────────────────────────
  // Prefer the aria-label attribute ("27,612 ratings" — full number) over
  // textContent ("(27.6K)" — abbreviated and parenthesised).
  const countEl = card.querySelector(AMAZON.RATING_COUNT_SELECTOR);
  if (!countEl) return null;

  // Strip " ratings" suffix from aria-label → "27,612" → parseRatingCount → 27612
  const ariaLabel = countEl.getAttribute('aria-label') ?? '';
  const fromAttr  = ariaLabel.replace(AMAZON.RATING_COUNT_ARIA_STRIP, '').trim();

  // Fallback: strip parentheses from textContent "(27.6K)" → "27.6K"
  const fromText  = (countEl.textContent?.trim() ?? '').replace(/[()]/g, '');

  const rawCount = fromAttr || fromText;
  const parsedCount = parseRatingCount(rawCount);
  if (parsedCount === null) return null;

  // why: suppress badge for very low count items — score is ~100% prior mean
  // and would mislead users (e.g. CC 3.93 next to a 2.4★ item with 8 reviews).
  if (parsedCount < MIN_RATINGS_FOR_BADGE) return null;

  return { rating, rawCount, countAnchor: countEl };
}

// ── Main processing ───────────────────────────────────────────────────────────

let currentSettings: Settings = DEFAULT_SETTINGS;

function processPage(settings: Settings): void {
  // Always clear previous ClearCart modifications first.
  clearAllChanges();

  if (!settings.enabled) return;

  const cards = document.querySelectorAll(AMAZON.RESULT_CARD);
  if (cards.length === 0) return;

  // ── Build corpus for Bayesian context ──────────────────────────────────────
  // Parse all visible ratings first so computeContext() sees the full page.
  const parsedRatings: Array<{ card: Element; parsed: ParsedRating }> = [];

  cards.forEach((card) => {
    try {
      const parsed = extractRating(card);
      if (parsed !== null) {
        parsedRatings.push({ card, parsed });
      }
    } catch {
      // why: one broken card must not abort the whole page
    }
  });

  const ctx: ScoringContext = computeContext(
    parsedRatings.map(({ parsed }) => ({
      rating: parsed.rating,
      count: parseRatingCount(parsed.rawCount) ?? 0,
    })),
  );

  // ── Per-card processing ────────────────────────────────────────────────────
  cards.forEach((card) => {
    try {
      // A) De-sponsoring
      applyDeSponsoring(card, isSponsored(card), settings.sponsorMode);

      // B) Rating badge
      const parsed = parsedRatings.find((p) => p.card === card)?.parsed;
      if (!parsed) return;

      const result = scoreItem(
        { rating: parsed.rating, rawCount: parsed.rawCount },
        ctx,
        settings.ratingMethod,
      );

      renderBadge(parsed.countAnchor, result, settings.ratingMethod);
    } catch {
      // fail silently — page untouched on error
    }
  });
}

// ── MutationObserver for dynamic / infinite-scroll pages ─────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReprocess(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  // why: 500ms debounce — Amazon fires many rapid mutations during hydration;
  // waiting 500ms lets the DOM settle before we scan it.
  debounceTimer = setTimeout(() => {
    try {
      processPage(currentSettings);
    } catch {
      // fail silently
    }
  }, 500);
}

const observer = new MutationObserver((mutations) => {
  // Only re-process if actual product nodes were added — ignore attribute/text changes.
  const relevant = mutations.some(
    (m) => m.type === 'childList' && m.addedNodes.length > 0,
  );
  if (relevant) scheduleReprocess();
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function init(): void {
  injectStyles();

  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    try {
      currentSettings = stored as Settings;
      processPage(currentSettings);

      // Start observing after initial render — watch for infinite-scroll additions.
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      // fail silently — page untouched
    }
  });

  // React to popup changes without a page reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    try {
      chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        currentSettings = stored as Settings;
        processPage(currentSettings);
      });
    } catch {
      // fail silently
    }
  });
}

init();

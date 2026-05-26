/**
 * ClearCart — shared rendering utilities for all content scripts.
 *
 * Owns:
 *   - CSS injection (once per page)
 *   - De-sponsoring: dim / hide / off
 *   - Rating badge: render next to native stars
 *   - Cleanup: remove all ClearCart changes (called before every re-render)
 *
 * Rules enforced here:
 *   - Every DOM write is guarded — failure must leave the page untouched.
 *   - No network calls. No external resources.
 *   - All class names are prefixed `cc-` to avoid collisions with site styles.
 */

import type { SponsorMode, RatingMethod } from '../types.js';
import type { ScoreResult, ScoringContext } from '../scoring/index.js';

// ── CSS ───────────────────────────────────────────────────────────────────────

const STYLE_ID = 'cc-injected-styles';

const CSS = `
/* De-sponsor: dim mode */
.cc-dim {
  opacity: 0.35 !important;
  transition: opacity 0.2s ease;
}
.cc-dim:hover {
  /* why: let the user inspect a dimmed item on hover without toggling the popup */
  opacity: 0.92 !important;
}

/* De-sponsor: hide mode */
.cc-hide {
  display: none !important;
}

/* Small "Sponsored" tag we prepend to dimmed cards so it's clear why they're dimmed */
.cc-sponsor-tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  color: #6b7280;
  background: #f9fafb;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  padding: 1px 5px;
  margin-right: 6px;
  vertical-align: middle;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

/* Rating badge */
.cc-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 3px;
  padding: 1px 6px;
  vertical-align: middle;
  white-space: nowrap;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  cursor: default;
}
.cc-badge-label {
  font-size: 9px;
  font-weight: 800;
  color: #3b82f6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.8;
}
`;

/** Inject ClearCart styles into the page once. Safe to call multiple times. */
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  } catch {
    // why: if style injection fails the page still works — we just won't look right.
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Remove every ClearCart modification from the page.
 * Called before every re-render so we start from a clean slate.
 */
export function clearAllChanges(): void {
  try {
    document.querySelectorAll('.cc-dim, .cc-hide').forEach((el) => {
      el.classList.remove('cc-dim', 'cc-hide');
    });
    document.querySelectorAll('.cc-badge, .cc-sponsor-tag').forEach((el) => {
      el.remove();
    });
    // why: also clean up hide class on outer wrappers in case it was applied there —
    // covers the standard grid card, sponsored cards, and horizontal carousel items.
    document.querySelectorAll('[data-component-type="s-search-result"].cc-hide, [data-component-type="sp-sponsored-result"].cc-hide, .a-carousel-card.cc-hide').forEach((el) => {
      el.classList.remove('cc-hide');
    });
  } catch {
    // fail silently
  }
}

// ── De-sponsoring ─────────────────────────────────────────────────────────────

/**
 * Apply de-sponsoring to a single card.
 * Safe to call on non-sponsored cards — does nothing if not sponsored.
 */
export function applyDeSponsoring(
  card: Element,
  isSponsored: boolean,
  mode: SponsorMode,
): void {
  if (!isSponsored || mode === 'off') return;

  try {
    if (mode === 'hide') {
      const innerCard = card.querySelector('.puis-card-container, .s-card-container') ?? card;
      innerCard.classList.add('cc-hide');
      return;
    }

    // dim mode: reduce opacity + prepend a small "Sponsored" tag so user
    // knows why the card is dimmed (per spec §Feature A).
    // why: target the inner .puis-card-container rather than the outer wrapper —
    // the outer element is a grid cell and opacity on it doesn't visually dim
    // the card content reliably across Amazon's layout variants.
    const innerCard = card.querySelector('.puis-card-container, .s-card-container') ?? card;
    innerCard.classList.add('cc-dim');

    const tag = document.createElement('span');
    tag.className   = 'cc-sponsor-tag';
    tag.textContent = 'Ad';
    tag.setAttribute('aria-label', 'TrueRating: this is a sponsored result');

    // Insert before the first element child of the inner card.
    innerCard.insertBefore(tag, innerCard.firstChild);
  } catch {
    // fail silently — page untouched
  }
}

// ── Rating badge ──────────────────────────────────────────────────────────────

/**
 * Render a ClearCart score badge next to the native star rating.
 *
 * @param anchorEl  - The element to insert the badge after (the native count span).
 * @param result    - The ScoreResult from scoreItem().
 * @param method    - Which method produced this score (controls display format).
 */
export function renderBadge(
  anchorEl: Element,
  result: ScoreResult,
  method: RatingMethod,
): void {
  if (!result.hasScore) return;

  try {
    const badge = document.createElement('span');
    badge.className = 'cc-badge';

    // Display format: Bayesian → "3.76★" (star scale), Wilson → "73.9%" (proportion)
    const scoreText =
      method === 'wilson'
        ? `${(result.score * 100).toFixed(1)}%`
        : `${result.score.toFixed(2)}★`;

    const label = document.createElement('span');
    label.className  = 'cc-badge-label';
    label.textContent = 'TR';

    badge.appendChild(label);
    badge.appendChild(document.createTextNode(` ${scoreText}`));
    badge.setAttribute(
      'aria-label',
      `TrueRating adjusted score: ${scoreText}. Native rating may be misleading for low-review-count items.`,
    );
    badge.setAttribute('title', `TrueRating ${method} score (${result.count.toLocaleString('en-IN')} ratings)`);

    anchorEl.insertAdjacentElement('afterend', badge);
  } catch {
    // fail silently
  }
}

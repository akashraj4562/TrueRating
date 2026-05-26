/**
 * ClearCart DOM selectors — single source of truth.
 *
 * ALL selectors for content scripts live here. When Amazon.in or Flipkart
 * update their HTML, this is the only file that needs to change.
 *
 * ⚠️  Last verified against live pages: 2026-05-25
 *     Re-verify if badges stop appearing or sponsored detection breaks.
 *     Amazon and Flipkart update their DOM without notice.
 */

// ── Amazon.in ────────────────────────────────────────────────────────────────

export const AMAZON = {

  /**
   * Outer container for each product result card on search pages.
   * Using data-component-type — more stable than class names, which Amazon
   * minifies and rotates between deploys.
   */
  RESULT_CARD: '[data-component-type="s-search-result"]',

  /**
   * Sponsored / ad placement detection.
   *
   * Primary: the card container carries data-component-type="sp-sponsored-result"
   * for paid placements. Check: card.dataset.componentType === SPONSORED_DATA_VALUE
   *
   * Fallback: a visible "Sponsored" label inside the card.
   * Verified live 2026-05-25: .puis-sponsored-label-text is present on ad cards.
   *
   * We never mark a result sponsored unless at least one signal is present —
   * a false positive (dimming an organic result) is worse than a false negative.
   */
  SPONSORED_DATA_VALUE: 'sp-sponsored-result',
  SPONSORED_LABEL: '.puis-sponsored-label-text, .s-sponsored-label-text',

  /**
   * Star rating — the PARENT <a> of the star <i> carries the aria-label.
   * Verified live 2026-05-25:
   *   <a aria-label="4.2 out of 5 stars, rating details" class="a-popover-trigger ...">
   *     <i data-cy="reviews-ratings-slot" aria-hidden="true" ...>
   * The <i> is aria-hidden; the readable label is one level up on the <a>.
   */
  RATING_WIDGET: 'a[aria-label*="out of 5 stars"]',
  RATING_ARIA_ATTR: 'aria-label',

  /**
   * Fallback: the hidden .a-icon-alt span inside the star <i> also contains
   * "4.2 out of 5 stars" as text — useful if the parent <a> structure changes.
   */
  RATING_FALLBACK: 'i[data-cy="reviews-ratings-slot"] .a-icon-alt',

  /**
   * Rating count — read the aria-label ATTRIBUTE, not textContent.
   * Verified live 2026-05-25:
   *   aria-label="27,612 ratings"  ← full number, use this
   *   textContent="(27.6K)"        ← abbreviated with parens, less precise
   */
  RATING_COUNT_SELECTOR: '[aria-label*="ratings"]',

  /** Strip " ratings" / " rating" suffix from the aria-label value */
  RATING_COUNT_ARIA_STRIP: /\s*ratings?\s*$/i,

  /** Parses "4.2 out of 5 stars, rating details" — group 1 is the number */
  RATING_REGEX: /^(\d+(?:[.,]\d+)?)\s+out of/i,

} as const;

// ── Flipkart (added when Flipkart content script is built) ───────────────────
// export const FLIPKART = { ... };

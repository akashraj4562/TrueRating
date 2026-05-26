/**
 * Parse a rating-count string from the DOM into a plain number.
 *
 * Handles:
 *   - Plain integers:            "1234"        → 1234
 *   - Western comma format:      "1,234"       → 1234
 *   - Indian lakh format:        "1,23,456"    → 123456
 *   - k/K suffix (thousands):    "2.3k" / "12K" → 2300 / 12000
 *   - M/m suffix (millions):     "1.2M"        → 1200000
 *
 * Returns null on any parse failure — callers must treat null as "no data available"
 * and skip rendering a badge, not substitute a zero.
 */
export function parseRatingCount(raw: string | null | undefined): number | null {
  if (raw == null) return null;

  // Normalise: trim whitespace, lowercase, remove all spaces
  const s = raw.trim().toLowerCase().replace(/\s/g, '');
  if (!s) return null;

  // Remove commas — handles both Western ("1,234") and Indian ("1,23,456") formats
  // why: commas are purely cosmetic separators in both locales; stripping all of them
  // is safe because no numeric notation uses commas as a decimal separator on these sites.
  const stripped = s.replace(/,/g, '');

  const multiplier =
    stripped.endsWith('k') ? 1_000 :
    stripped.endsWith('m') ? 1_000_000 :
    1;

  const base = multiplier !== 1 ? stripped.slice(0, -1) : stripped;
  const numeric = parseFloat(base);

  if (!isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * multiplier);
}

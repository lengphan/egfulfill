/**
 * HOW A DESIGN NUMBER IS WRITTEN — DSN-1042.
 *
 * Mirrors `designLabel` in server/src/design-id.js, whose own note says it exists so "a
 * number reads identically everywhere it appears". It did not: the server hands back
 * `DSN-1042` from the order save, `design_cards.design_id` holds the bare `1042`, and the
 * app rendered neither — `design_no` was read into state in design-canvas.tsx and never
 * printed, while two search indexes built the `DSN-` string by hand so a number could be
 * SEARCHED that nothing on screen ever showed.
 *
 * ── THE NUMBER IS THE ARTWORK, NOT THE UPLOAD ────────────────────────────────────────────
 *
 * It is derived from the content hash, so the same artwork on twelve orders is ONE number.
 * That is what makes it worth showing: DSN-1042 on a line and DSN-1042 on a board card mean
 * the same file, and searching it finds every order printing it.
 *
 * ── THE BARE NUMBER IS A KEY. DO NOT REFORMAT IT AT REST ─────────────────────────────────
 *
 * `design_cards.design_id` is joined against `wilcom_previews.design_id` and passed to
 * EmbPreview as a lookup. So the stored value stays a number and the LABEL is a display
 * concern — which is the whole reason this is a formatter and not a migration.
 */

/** `1042` → `DSN-1042`. Null for nothing, so a caller renders no badge rather than "DSN-null". */
export function designLabel(n: number | string | null | undefined): string | null {
  if (n == null) return null
  const s = String(n).trim()
  if (!s) return null
  // Already labelled — the order save returns `DSN-1042` while a card holds `1042`, and a
  // caller should not have to know which one it is holding.
  if (/^DSN-/i.test(s)) return s.toUpperCase()
  return /^\d+$/.test(s) ? `DSN-${s}` : null
}

/** What a design number should MATCH in a search box: the label and the bare number, so
 *  both "DSN-1042" and "1042" find it. Kept here so the two indexes cannot drift apart. */
export function designSearchTerms(n: number | string | null | undefined): string {
  const label = designLabel(n)
  return label ? `${label} ${String(n).replace(/^DSN-/i, "")}` : ""
}

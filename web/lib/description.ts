// Supplier descriptions arrive as raw HTML — S&S and Otto both send fragments like
//   <p><strong>95% Cotton / 5% Spandex</strong></p><p><strong>Unstructured</strong></p>
// which render as literal tags in a plain <textarea> or a text node. They're really a
// feature LIST, so this turns them into clean bullet lines.
//
// Deliberately not a full HTML parser: we control the inputs (two suppliers' feeds), and
// pulling in a parser for this would cost more than the feature. Output is plain text —
// never injected as HTML — so a malformed tag can't become an XSS hole.

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#039": "'", "#34": '"',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#?\w+);/g, (m, code: string) => ENTITIES[code] ?? m)
}

/**
 * Split supplier HTML into feature lines.
 *
 * Block-level tags become line breaks (that's what they meant), inline tags are dropped,
 * and existing bullet glyphs are stripped so we don't end up with "• • Soft Crown".
 */
export function descriptionLines(raw?: string | null): string[] {
  if (!raw) return []
  let s = String(raw)
  // Block boundaries → newlines, before tags are stripped.
  s = s.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
  s = s.replace(/<\s*(li|p|div|h[1-6]|tr)\b[^>]*>/gi, "\n")
  s = s.replace(/<[^>]+>/g, "")          // remaining inline tags
  s = decodeEntities(s)
  return s
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[•\-*·–—]\s*/, "").trim())   // strip pre-existing bullets
    .filter(Boolean)
}

/** True when the text carries HTML worth reformatting. */
export function looksLikeHtml(raw?: string | null): boolean {
  return !!raw && /<\s*(p|br|div|li|strong|b|em|ul|ol|h[1-6])\b/i.test(String(raw))
}

/** Plain-text version, one feature per line — what we store and edit. */
export function descriptionToText(raw?: string | null): string {
  return descriptionLines(raw).join("\n")
}

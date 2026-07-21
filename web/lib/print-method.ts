// Print methods. A product's `method` is often a single string listing several
// techniques — "DTG Print / DTF Print / Embroidery / Appliqué" — so anything that treats
// it as one value ends up offering that whole run-on string as a single choice.
//
// Ported from product-detail.html's pdNormTech, which is why the labels match what the
// old page showed. Kept in one place so the pickers, the detail page and pricing all
// name a method identically — pricing normalises to these same codes (EMB/DTF/APL/LSR/DTG).

export type PrintMethod = { key: string; label: string }

/**
 * The methods a product may be assigned — the SINGLE source for the picker.
 *
 * These were hardcoded in product-editor-dialog.tsx and had drifted from both this file
 * and the pricing surcharges: the picker offered Screen Print / Sublimation / Vinyl,
 * which had no `method_*` fee key at all (so they priced at $0), while DTF, Appliqué and
 * Laser were priced but couldn't be selected. Every entry here now has a matching
 * surcharge in factory_settings KEYS — keep the three in step.
 */
export const PRODUCT_METHODS: PrintMethod[] = [
  { key: "dtg", label: "DTG" },
  { key: "dtf", label: "DTF" },
  { key: "emb", label: "Embroidery" },
  { key: "apl", label: "Appliqué" },
  { key: "lsr", label: "Laser" },
  { key: "scr", label: "Screen Print" },
  { key: "sub", label: "Sublimation" },
  { key: "vnl", label: "Vinyl" },
]

/** Normalise one raw technique to a stable {key,label}. */
export function normTech(raw: string): PrintMethod | null {
  const s = String(raw || "").trim().toLowerCase()
  if (!s) return null
  if (/dtf/.test(s)) return { key: "dtf", label: "DTF printing" }
  if (/dtg|direct to garment/.test(s)) return { key: "dtg", label: "DTG printing" }
  if (/emb|embroid/.test(s)) return { key: "emb", label: "Embroidery" }
  if (/appliqu|\bapl\b/.test(s)) return { key: "apl", label: "Appliqué" }
  if (/laser|\blsr\b|engrav/.test(s)) return { key: "lsr", label: "Laser" }
  if (/screen/.test(s)) return { key: "scr", label: "Screen print" }
  if (/sublim|\bdye\b/.test(s)) return { key: "sub", label: "Sublimation" }
  if (/vinyl|htv/.test(s)) return { key: "vnl", label: "Vinyl" }
  if (/\buv\b/.test(s)) return { key: "uv", label: "UV print" }
  return { key: s.replace(/[^a-z0-9]+/g, "").slice(0, 6) || "t", label: raw.charAt(0).toUpperCase() + raw.slice(1) }
}

/** Split a combined method string into its individual techniques. */
export function splitMethods(raw?: string | null): string[] {
  return String(raw || "")
    .split(/[/,·|+]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Every technique in a list of raw strings, de-duped by normalised key, order preserved. */
export function normalizeMethods(raws: (string | null | undefined)[]): PrintMethod[] {
  const out: PrintMethod[] = []
  const seen = new Set<string>()
  for (const raw of raws) {
    for (const part of splitMethods(raw)) {
      const t = normTech(part)
      if (t && !seen.has(t.key)) { seen.add(t.key); out.push(t) }
    }
  }
  return out
}

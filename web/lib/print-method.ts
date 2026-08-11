// Print methods. A product's `method` is often a single string listing several
// techniques — "DTG Print / DTF Print / Embroidery / Appliqué" — so anything that treats
// it as one value ends up offering that whole run-on string as a single choice.
//
// Ported from product-detail.html's pdNormTech, which is why the labels match what the
// old page showed. Kept in one place so the pickers, the detail page and pricing all
// name a method identically — pricing normalises to these same codes (EMB/DTF/APL/LSR/DTG).

export type PrintMethod = { key: string; label: string }

/**
 * ONE TABLE. Key, the label we print, and what a stored string has to look like to be
 * recognised as this method.
 *
 * There were two lists, and they disagreed. `PRODUCT_METHODS` labelled dtg "DTG" while
 * `normTech` labelled it "DTG printing"; scr was "Screen Print" in one and "Screen print"
 * in the other. Both are the same eight methods, so nothing looked wrong — until something
 * compared a label produced by one against the set defined by the other, which is exactly
 * what the product editor did:
 *
 *   normalizeMethods(["DTG Print / Embroidery"]) -> ["DTG printing", "Embroidery"]
 *   .filter(m => PRODUCT_METHODS_LABELS.includes(m))  ->  ["Embroidery"]
 *
 * so a product that could be printed AND embroidered showed only Embroidery ticked, and
 * the next chip anyone clicked wrote the ticked set back — silently dropping DTG from the
 * product for good. That is how blanks end up offering ONE method on an order line: not a
 * rendering fault in the line, a technique deleted from the product weeks earlier.
 *
 * Matching is by KEY everywhere now, so the label can be whatever reads best and old data
 * in any spelling still resolves. `re` keeps recognising the wordings already in the
 * database ("DTG Print", "Direct to Garment") — that is a matcher, not a vocabulary.
 *
 * Every entry has a matching `method_*` surcharge in factory_settings KEYS. Keep in step.
 */
const METHOD_TABLE: (PrintMethod & { re: RegExp })[] = [
  { key: "dtf", label: "DTF printing", re: /dtf/ },
  { key: "dtg", label: "DTG printing", re: /dtg|direct to garment/ },
  { key: "emb", label: "Embroidery", re: /emb|embroid/ },
  { key: "apl", label: "Appliqué", re: /appliqu|\bapl\b/ },
  { key: "lsr", label: "Laser", re: /laser|\blsr\b|engrav/ },
  { key: "scr", label: "Screen print", re: /screen|\bscr\b/ },
  { key: "sub", label: "Sublimation", re: /sublim|\bdye\b|\bsub\b/ },
  { key: "vnl", label: "Vinyl", re: /vinyl|htv|\bvnl\b/ },
]

/** The methods a product may be assigned — the SINGLE source for every picker. */
export const PRODUCT_METHODS: PrintMethod[] = METHOD_TABLE.map(({ key, label }) => ({ key, label }))

/** Look one up by key. Null for the ad-hoc keys normTech invents for unknown techniques. */
export const methodByKey = (key: string): PrintMethod | null =>
  PRODUCT_METHODS.find((m) => m.key === key) ?? null

/** Normalise one raw technique to a stable {key,label}. */
export function normTech(raw: string): PrintMethod | null {
  const s = String(raw || "").trim().toLowerCase()
  if (!s) return null
  for (const m of METHOD_TABLE) if (m.re.test(s)) return { key: m.key, label: m.label }
  // UV is recognised but not offered — it exists in old data and has no surcharge, so it
  // must still normalise rather than being turned into a junk key.
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

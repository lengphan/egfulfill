/**
 * THE PRINT METHODS ON A PRODUCT, split and normalised.
 *
 * `PublicProduct.methods` is an array, but its ENTRIES are compound strings — the live
 * catalogue holds values like "DTG printing / Embroidery / Appliqué / Laser / DTF printing"
 * in a single element. A filter built by collecting the raw entries therefore offers whole
 * COMBINATIONS as if they were methods, which is what put tabs reading "DTG printing /
 * Embroidery" next to a tab reading "DTG" on the products page.
 *
 * So each entry is split on "/", trimmed, and folded onto the seven the floor actually runs —
 * the same seven an order's SKU suffix carries (-EMB -DTG -DTF -APL -LSR -SUB -SCR). "DTG
 * printing" and "DTG" are one method written two ways, and a filter that lists both is a
 * filter that splits the same products across two tabs.
 *
 * Anything unrecognised is kept as-is rather than dropped: a method we have not seen before
 * is a real thing a seller can order, and silently hiding it would be worse than an odd label.
 */

/** Written the way the site writes them elsewhere. Order is the floor's, not alphabetical. */
const CANON = ["Embroidery", "DTG", "DTF", "Appliqué", "Laser", "Sublimation", "Screen print"] as const

const ALIASES: [RegExp, string][] = [
  [/^dtg\b/i, "DTG"],
  [/^dtf\b/i, "DTF"],
  [/embroider/i, "Embroidery"],
  [/appliqu/i, "Appliqué"],
  [/laser/i, "Laser"],
  [/sublimat/i, "Sublimation"],
  [/screen/i, "Screen print"],
]

function canon(raw: string): string {
  const s = raw.trim()
  if (!s) return ""
  for (const [re, name] of ALIASES) if (re.test(s)) return name
  return s
}

/** Every distinct method a single product can be decorated with. */
export function methodsOf(p: { methods?: string[] | null }): string[] {
  const out = new Set<string>()
  for (const entry of p.methods ?? []) {
    for (const part of String(entry).split("/")) {
      const c = canon(part)
      if (c) out.add(c)
    }
  }
  return [...out]
}

/** The filter's tabs: every method present across the list, in the floor's order. */
export function methodsAcross(products: { methods?: string[] | null }[]): string[] {
  const seen = new Set<string>()
  for (const p of products) for (const m of methodsOf(p)) seen.add(m)
  const known = CANON.filter((m) => seen.has(m))
  const extra = [...seen].filter((m) => !CANON.includes(m as (typeof CANON)[number])).sort()
  return [...known, ...extra]
}

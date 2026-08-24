import { stripBrandPrefix, brandOfSupplierStyle } from "@/lib/supplier-catalog"
import type { CatalogProduct } from "@/lib/api"

/**
 * SPLITTING A BRAND OFF A NAME THAT ALREADY EXISTS.
 *
 * The importers do this at the moment a supplier style becomes one of our products
 * (supplier-catalog.ts), which only ever helped the NEXT product. Every blank already in the
 * catalogue still reads "Gildan Unisex Heavy Blend™ Crewneck Sweatshirt", and the whole point
 * of the field is that the make is a fact you can group and filter by rather than a substring
 * somebody has to eyeball.
 *
 * A GUESS, PRESENTED AS ONE. Nothing here knows what a brand is; it recognises names. So this
 * proposes and a human confirms — the same rule fuzzy artwork matching follows (CLAUDE.md §6)
 * — and it is only ever run from a button somebody pressed.
 *
 * The list is the makes that actually turn up on blanks. Anything unrecognised is left alone,
 * which is the honest failure: a name we cannot split is a name we should not touch.
 */
const BRANDS = [
  // The ones already in this catalogue.
  "Comfort Colors", "Adams Headwear", "47 Brand", "Gildan", "Adidas", "OGIO",
  // Everything else that shows up on a blanks feed. Longest match wins, so "Port Authority"
  // is never mistaken for "Port & Company".
  "Bella+Canvas", "Bella + Canvas", "Next Level", "Port Authority", "Port & Company",
  "District", "Sport-Tek", "New Era", "Richardson", "Yupoong", "Champion", "Hanes", "Jerzees",
  "Fruit of the Loom", "Anvil", "American Apparel", "Alternative", "Independent Trading Co",
  "Independent Trading", "Rabbit Skins", "LAT", "Tultex", "Threadfast", "Allmade", "econscious",
  "Stanley/Stella", "Carhartt", "Nike", "Under Armour", "Puma", "The North Face", "Eddie Bauer",
  "Columbia", "TravisMathew", "Nautica", "Brooks Brothers", "Spyder", "Marmot", "Cotopaxi",
  "CornerStone", "Red Kap", "Bulwark", "Volunteer Knitwear", "Team 365", "Core 365",
  "Devon & Jones", "Harriton", "North End", "Holloway", "Augusta", "Badger", "Boxercraft",
  "MV Sport", "Weatherproof", "Russell Athletic", "Oakley", "Vineyard Vines", "Mercer+Mettle",
]

/** Longest first, so "Comfort Colors" is tried before anything that starts with "Comfort". */
const ORDERED = [...BRANDS].sort((a, b) => b.length - a.length)

/**
 * The brand a name LEADS with, or null.
 *
 * `known` carries the brands already set on other products, so a catalogue that has taught
 * itself a make once recognises it everywhere — including makes this list has never heard of.
 * The match is on a word boundary: "District" must not fire on "Districted".
 */
export function detectBrand(name: string, known: string[] = []): string | null {
  const n = String(name || "").trim()
  if (!n) return null
  const all = [...new Set([...known.map((k) => String(k).trim()).filter(Boolean), ...ORDERED])]
    .sort((a, b) => b.length - a.length)
  for (const b of all) {
    if (!brandOfSupplierStyle(b)) continue        // never file a SUPPLIER's name as a brand (§2.9)
    if (n.length <= b.length) continue            // the whole name IS the brand — nothing to split
    if (n.slice(0, b.length).toLowerCase() !== b.toLowerCase()) continue
    // A boundary, so "LAT" does not fire on "LATTE".
    if (/[a-z0-9]/i.test(n[b.length])) continue
    return b
  }
  return null
}

export type BrandSplit = { product: CatalogProduct; brand: string; name: string }

/**
 * Every product this would change, and what it would become. Products that already carry a
 * brand are left alone — somebody has answered that question, and re-answering it is not
 * this button's job.
 */
export function planBrandSplit(products: CatalogProduct[]): BrandSplit[] {
  const known = products.map((p) => String(p.brand ?? "").trim()).filter(Boolean)
  const out: BrandSplit[] = []
  for (const p of products) {
    if (String(p.brand ?? "").trim()) continue
    const name = String(p.name ?? "").trim()
    const brand = detectBrand(name, known)
    if (!brand) continue
    const cut = stripBrandPrefix(name, brand)
    if (!cut || cut === name) continue
    out.push({ product: p, brand, name: cut })
  }
  return out
}

/**
 * THE OLD NAME IS KEPT, and this is the part that makes a rename safe rather than free.
 *
 * An order line does not reference a product's id. It carries `blank` — text — and its own
 * sku, and resolveProduct matches that text against the product's NAME (among others). So
 * renaming a product strands every older line that named it: the line stops resolving, and a
 * line that does not resolve is not priced. That is exactly the "Not priced · pick a blank
 * first" failure this catalogue has already been through once.
 *
 * `nameAliases` is what a supplier sku has always been for the sku field — a former identity
 * that still matches and is never published. Both resolvers read it (web/lib/variant-resolve
 * and server/src/pricing.js), so a renamed product keeps answering to what it used to be
 * called, and nothing has to be rewritten on the orders themselves. Recorded history stays
 * as it was recorded.
 */
export function withRenameAlias(p: CatalogProduct, nextName: string): CatalogProduct {
  const was = String(p.name ?? "").trim()
  const now = String(nextName ?? "").trim()
  if (!was || was === now) return { ...p, name: now || was }
  const aliases = [...(p.nameAliases ?? []), was]
    .map((a) => String(a).trim())
    .filter((a, i, arr) => a && a !== now && arr.indexOf(a) === i)
    // A product that has been renamed ten times is a product with a naming problem, not one
    // that needs an eleventh alias kept for ever.
    .slice(-10)
  return { ...p, name: now, nameAliases: aliases }
}

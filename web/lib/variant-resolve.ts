import type { CatalogProduct, OrderItem } from "@/lib/api"
import { normalizeMethods } from "@/lib/print-method"

// Client mirror of pricing.js matchProduct / eg-design-tools.js chosenProduct: resolve an
// order line to its catalog product. Picked blank (it.blank) wins; then the SKU matched
// against the product's base + variant SKUs (exact, then base↔variant prefix). Keep in
// step with the server — a line that resolves here but not there would price at zero.
export function variantSkusOf(p: CatalogProduct): string[] {
  const out: string[] = []
  const push = (s?: string | null) => { if (s) out.push(String(s).toUpperCase().trim()) }
  push(p.sku)
  for (const v of p.variantSkus ?? []) push(typeof v === "string" ? v : (v.sku ?? v.SKU))
  return out.filter(Boolean)
}

export function resolveProduct(item: OrderItem, catalog: CatalogProduct[]): CatalogProduct | null {
  const blank = String(item.blank || "").trim().toLowerCase()
  if (blank) {
    const hit = catalog.find((p) =>
      [p.name, p.sku, p.id].some((v) => v != null && String(v).trim().toLowerCase() === blank))
    if (hit) return hit
  }
  const s = String(item.sku || "").toUpperCase().trim()
  if (!s) return null
  for (const p of catalog) if (variantSkusOf(p).includes(s)) return p
  for (const p of catalog) {
    for (const c of variantSkusOf(p)) {
      if (s.startsWith(c + "-") || c.startsWith(s + "-")) return p
    }
  }
  return null
}

// Colours a product offers — the keys it was set up with (colorImages), plus its main
// colour. Empty ⇒ the picker falls back to free choice of the item's current value.
export function colorsOf(p: CatalogProduct | null): string[] {
  if (!p) return []
  const set = new Set<string>()
  if (p.mainColor) set.add(p.mainColor)
  for (const c of Object.keys(p.colorImages ?? {})) if (c) set.add(c)
  return [...set]
}

export function methodsOf(p: CatalogProduct | null): string[] {
  if (!p) return []
  // SPLIT the method string: `method` commonly lists several techniques in one field
  // ("DTG Print / DTF Print / Embroidery / Appliqué"), and adding it whole offered that
  // entire run-on string as a single un-pickable option.
  //
  // THREE PLACES A PRODUCT CAN SAY WHAT IT SUPPORTS, and it was only being asked two.
  //
  // `method` is the joined string the editor writes; `methodPrices` keys are whatever the
  // pricing table was given. But an imported or API-built product can carry a `methods`
  // ARRAY instead — the server already reads `d.methods` when it publishes one (see
  // catalog.js) — and this ignored it, so those blanks offered whatever single value
  // happened to be in `method` and nothing else. Deduped by key, so listing a technique in
  // two of the three fields still yields one option.
  const arr = Array.isArray(p.methods) ? p.methods : []
  return normalizeMethods([...arr, ...Object.keys(p.methodPrices ?? {}), p.method]).map((m) => m.label)
}

// The mockup faces to place artwork on. Prefers the per-COLOUR image for the front (so a
// navy tee shows the navy blank, not the default), then the product's side_mockups for
// the other faces. Returns [{side, url}] in a stable front-first order; empty urls dropped.
// This is what "recognize the mockup image I uploaded" resolves to — the real blank
// graphic from the catalog, not the raw order-line thumbnail.
export type MockupFace = { side: string; url: string }
const SIDE_ORDER = ["front", "back", "left", "right", "sleeve", "hood", "inside"]

export function mockupFaces(p: CatalogProduct | null, color?: string | null): MockupFace[] {
  if (!p) return []
  const sides = { ...(p.side_mockups ?? {}), ...(p.sideMockups ?? {}) } as Record<string, string>
  // Front: the chosen colour's image wins, else the product's main mockup/hero/first image.
  const byColor = color && p.colorImages ? p.colorImages[color] : ""
  const front = byColor || sides.front || p.mockup || p.img || p.image || p.hero
    || p.images?.[0] || Object.values(p.colorImages ?? {}).find(Boolean) || ""
  const faces: MockupFace[] = []
  if (front) faces.push({ side: "front", url: front })
  for (const side of SIDE_ORDER) {
    if (side === "front") continue
    const u = sides[side]
    if (u) faces.push({ side, url: u })
  }
  // Any non-standard side keys, appended in insertion order.
  for (const [side, u] of Object.entries(sides)) {
    if (u && !SIDE_ORDER.includes(side) && !faces.some((f) => f.side === side)) faces.push({ side, url: u })
  }
  return faces
}

// The single best mockup image for a resolved product + colour (front face). Falls back
// to the order line's own image when the product can't be resolved.
/**
 * Category mockups, keyed by product type. Populated once from platform settings (see
 * `loadTypeMockups`) and consulted as the LAST resort in bestMockup — so a product with
 * no imagery of its own still shows the right silhouette instead of an empty stage.
 * Module-level rather than threaded through every call site, because every mockup lookup
 * in the app would otherwise need the settings object passed down to it.
 */
type TypeSpec = { sides: string[]; mockups: Record<string, string> }
let TYPE_SPECS: Record<string, TypeSpec> = {}
export function setTypeMockups(types: { name: string; sides?: string[]; mockups?: Record<string, string>; mockup?: string | null }[]) {
  const m: Record<string, TypeSpec> = {}
  for (const t of types ?? []) {
    if (!t?.name) continue
    const mockups = { ...(t.mockups ?? {}) }
    if (t.mockup && !mockups.front) mockups.front = t.mockup
    m[t.name.toLowerCase()] = { sides: t.sides?.length ? t.sides : ["front"], mockups }
  }
  TYPE_SPECS = m
}
const specFor = (p: CatalogProduct | null): TypeSpec | null =>
  TYPE_SPECS[String(p?.type ?? "").toLowerCase()] ?? null

/** The category outline for a product's side, if its type defines one. */
export function typeMockupOf(p: CatalogProduct | null, side = "front"): string {
  return specFor(p)?.mockups?.[side] ?? ""
}
/** Sides this product can be designed on — its own faces, else its category's. */
export function typeSidesOf(p: CatalogProduct | null): string[] {
  return specFor(p)?.sides ?? ["front"]
}

export function bestMockup(p: CatalogProduct | null, color?: string | null, fallback?: string): string {
  // The category stand-in sits between the product's own imagery and the caller's
  // fallback: better than a listing photo, worse than a real mockup of this product.
  return mockupFaces(p, color)[0]?.url || typeMockupOf(p) || fallback || ""
}

/** Sizes a product offers. Many catalog rows carry no `sizes` array and define their
 *  sizes only as per-size price tiers (sizePrices), which is why a picked product could
 *  fill Colour but leave Size empty. Union both, preserving sizes[] order. */
export function sizesOf(p: CatalogProduct | null): string[] {
  if (!p) return []
  const out = new Set<string>()
  for (const s of p.sizes ?? []) if (s) out.add(String(s))
  for (const t of p.sizePrices ?? []) if (t?.size) out.add(String(t.size))
  return [...out]
}

const isSet = (v: unknown) => !!(v != null && String(v).trim())

/**
 * Is a line NOT yet production-ready? True when its blank can't be resolved at all, OR the
 * resolved product OFFERS a colour / size / method the line hasn't picked. This is the one
 * definition of "needs setup" — the submit and the label both gate on it, because an order
 * with an unpicked variant literally can't be made. Marketplace lines arrive with everything
 * unset, and a manual line can too, so both flow through here.
 */
export function itemNeedsSetup(item: OrderItem, catalog: CatalogProduct[]): boolean {
  const p = resolveProduct(item, catalog)
  if (!p) return !isSet(item.blank)   // nothing to produce on
  if (colorsOf(p).length && !isSet(item.color)) return true
  if (sizesOf(p).length && !isSet(item.size)) return true
  if (methodsOf(p).length && !isSet(item.print_type)) return true
  return false
}

/** How many of an order's lines still need setup (0 = ready). */
export function orderNeedsSetup(items: OrderItem[] | undefined, catalog: CatalogProduct[]): number {
  return (items ?? []).filter((it) => itemNeedsSetup(it, catalog)).length
}

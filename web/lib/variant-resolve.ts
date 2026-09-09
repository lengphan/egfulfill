import type { CatalogProduct, OrderItem } from "@/lib/api"
import { normalizeMethods } from "@/lib/print-method"
import { bySize } from "@/lib/size-order"
import { prettyColorName } from "@/lib/color-name"

// Client mirror of pricing.js matchProduct / eg-design-tools.js chosenProduct: resolve an
// order line to its catalog product. Picked blank (it.blank) wins; then the SKU matched
// against the product's base + variant SKUs (exact, then base↔variant prefix). Keep in
// step with the server — a line that resolves here but not there would price at zero.
export function variantSkusOf(p: CatalogProduct): string[] {
  const out: string[] = []
  const push = (s?: string | null) => { if (s) out.push(String(s).toUpperCase().trim()) }
  push(p.sku)
  /**
   * THE SUPPLIER'S OWN CODE, AS AN ALIAS — never as the identity.
   *
   * `sku` is ours ("EG-1001"); `supplierSku` is theirs ("103-713-031753A"). Orders placed
   * before the split carry the supplier code, and listings published before it still quote
   * it back at us when they sell. Dropping it from the match would strand every one of
   * those lines — the alias is what makes the rename safe rather than a silent data loss.
   *
   * It is only ever READ here. Nothing publishes it, and the server strips it from a
   * seller's copy of the product entirely (sellerSafe in catalog.js), so a seller's
   * catalogue simply has no supplier code to match on — which is the intent.
   */
  push(p.supplierSku)
  for (const v of p.variantSkus ?? []) push(typeof v === "string" ? v : (v.sku ?? v.SKU))
  return out.filter(Boolean)
}

/**
 * THE BLANK CELL, WHICH NOW ARRIVES AS "SKU - NAME".
 *
 * The import sheet's Blank Product dropdown offers `G5000 - Gildan 5000 Heavy Cotton Tee`,
 * because a name alone is not enough to tell two near-identical garments apart at the moment
 * of picking one. Google Sheets validation has no label-vs-value: the cell holds exactly the
 * option text, so the combined form is what reaches an order line.
 *
 * The WHOLE string is matched first and the split is only a fallback, which is what keeps a
 * product whose NAME contains " - " resolving as it always did — splitting first would turn
 * "Adidas - Performance Polo" into a search for a product called "Adidas".
 */
export function blankCandidates(cell: string): string[] {
  const out = [cell]
  const at = cell.indexOf(" - ")
  if (at > 0) { out.push(cell.slice(0, at).trim(), cell.slice(at + 3).trim()) }
  return out.filter(Boolean)
}

/**
 * HOW A BLANK IS WRITTEN DOWN, everywhere one is offered or shown: `EG-1001 - Classic Tee`.
 *
 * One helper because the string is a CONTRACT, not a presentation choice. The order grid
 * writes it into the sheet column, the sheet's own dropdown offers it back, the line strip
 * shows it, and both resolvers (resolveProduct here, matchProduct in server/src/pricing.js)
 * split it to find the product. A second spelling of it anywhere is a line that resolves on
 * one screen and prices at zero on another — which is exactly the bug the split was added
 * to fix.
 *
 * IT IS A LABEL, NEVER A KEY. Nothing routes on it: stock is held against `p.sku`, the
 * purchase cart groups by supplier, publish writes `p.sku`. So renaming a product or giving
 * it a new sku in the editor changes what this reads and nothing about where the line goes —
 * the old string still resolves through `name`, and the supplier code still resolves through
 * the alias in variantSkusOf.
 */
export function productLabel(p: Pick<CatalogProduct, "name" | "sku"> | null | undefined): string {
  const name = String(p?.name ?? "").trim()
  const sku = String(p?.sku ?? "").trim()
  if (!name) return sku
  return sku ? `${sku} - ${name}` : name
}

export function resolveProduct(item: OrderItem, catalog: CatalogProduct[]): CatalogProduct | null {
  const blank = String(item.blank || "").trim().toLowerCase()
  if (blank) {
    for (const cand of blankCandidates(blank)) {
      const hit = catalog.find((p) =>
        // nameAliases: what it USED to be called. A product can be renamed — the brand split
        // does it in bulk — and an order line names the blank in text, so without this the
        // rename silently unprices every line placed before it. MIRRORS matchProduct in
        // server/src/pricing.js; tools/check-blank-resolve.mjs runs both over the same cases.
        [p.name, p.sku, p.supplierSku, p.id, ...(p.nameAliases ?? [])]
          .some((v) => v != null && String(v).trim().toLowerCase() === cand))
      if (hit) return hit
    }
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

/**
 * THE PHOTO FOR ONE COLOURWAY — matched LOOSELY, because the two strings come from
 * different places and were only ever compared exactly.
 *
 * `colorImages` is keyed by whatever the product editor stored ("Fern", "S.Pnk/Blk"), and
 * the colour on a line is whatever the picker, the marketplace or a CSV put there — a
 * different case, a stray space, a prettified two-tone name. `p.colorImages[color]` needs
 * them identical, and when they were not it returned undefined and the caller quietly fell
 * back to the product's hero shot. On screen that is "picking a colour doesn't change the
 * picture", with nothing to say why.
 *
 * Exact first, then case- and space-insensitive, then both sides run through the same
 * prettifier the swatches use. An empty string is a real answer — the editor writes "" for
 * a colourway nobody has photographed — so it stays falsy and the hero still wins.
 */
export function colorImageOf(p: CatalogProduct | null, color?: string | null): string {
  const want = String(color ?? "").trim()
  if (!p?.colorImages || !want) return ""
  const map = p.colorImages
  if (map[want]) return map[want]
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim()
  const loose = norm(want)
  for (const [k, v] of Object.entries(map)) if (v && norm(k) === loose) return v
  const pretty = norm(prettyColorName(want))
  for (const [k, v] of Object.entries(map)) if (v && norm(prettyColorName(k)) === pretty) return v
  return ""
}

/**
 * DOES THIS LINE GET STITCHED?
 *
 * One rule, because two things depend on it and they must never disagree: the thread-match
 * module, and the machine-file step that sends artwork to a designer to be digitised. Both
 * are embroidery apparatus — a stitch file, a cone of thread — and neither means anything on
 * a DTG line, where the artwork IS the print file and there is nothing to cut.
 *
 * They HAD disagreed. Thread match was gated on this test and the machine-file step was
 * gated on nothing, so a DTG line showed "Embroidery file · Attach file (.emb, .pes, .dst)"
 * and its "Send to a designer" put print artwork on the digitising board.
 *
 * Reads the line's chosen METHOD, not the sku suffix: the suffix is inventory's business and
 * a marketplace line often has neither.
 */
export const isEmbroidery = (printType?: string | null): boolean => /emb/i.test(String(printType || ""))

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
  const byColor = colorImageOf(p, color)
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

/**
 * BUNDLED BLANKS — the outline a type falls back to when nobody has uploaded one.
 *
 * TYPE_SPECS is filled at runtime from Settings › Platform, so before an admin uploads
 * anything every type resolved to "" and the design stage opened empty. A seller could not
 * place artwork on a t-shirt until somebody had first supplied a picture of a t-shirt.
 *
 * These ship with the app instead. They are technical flats — white body, fine seam
 * stitching, a grey shadow inside the collar — drawn for placement rather than for looks:
 * the artwork sits ON them, so they must not compete with it.
 *
 * An admin upload still wins. This is the floor, not the ceiling.
 */
const BUNDLED_MOCKUPS: Record<string, Record<string, string>> = {
  tshirt: { front: "/blanks/tshirt-front.png" },
}

/** The category outline for a product's side: the admin's, else the one we ship. */
export function typeMockupOf(p: CatalogProduct | null, side = "front"): string {
  const own = specFor(p)?.mockups?.[side]
  if (own) return own
  const key = String(p?.type ?? "").toLowerCase()
  return BUNDLED_MOCKUPS[key]?.[side] ?? ""
}
/** The faces the category prints on. "" for a type nobody has configured, which is not the
 *  same answer as ["front"] — see sidesOf, which is the one anything narrowing should call. */
export function typeSidesOf(p: CatalogProduct | null): string[] {
  return specFor(p)?.sides ?? ["front"]
}

/**
 * THE FACES THIS BLANK ACTUALLY HAS — the product's own answer, then its category's.
 *
 * A TYPE IS COARSER THAN A GARMENT, and the gap is not cosmetic. "Transfer Duffel" sits in
 * Apparel, and Apparel is configured front/back/left/right/sleeve/hood — so the import
 * sheet offered a duffel bag a hood and two sleeves, and the design maker gave it six faces
 * to place artwork on. Splitting the categories finely enough to fix that means a type per
 * silhouette, and then a tee and a hoodie still disagree about the hood.
 *
 * So a product may carry its own `sides`, and when it does they WIN outright — this is a
 * statement about one garment, and a category cannot know better than the person holding
 * it. Absent or empty means "inherit", so the 29 products that have never said anything
 * keep following their type exactly as before and changing a category still reaches them.
 *
 * Filtered to known faces, because an unknown one has no mockup, no print area and no
 * meaning to order_designs — it would render as a face you cannot actually place on.
 */
export function sidesOf(p: CatalogProduct | null): string[] {
  const own = (Array.isArray(p?.sides) ? p.sides : []).filter((s) => ALL_SIDES.includes(String(s)))
  return own.length ? own : typeSidesOf(p)
}

/** Every face the system knows. Mirrors ALL_SIDES in server/src/routes/factory_settings.js,
 *  which is the list a product type is built from. */
export const ALL_SIDES = ["front", "back", "left", "right", "sleeve", "hood", "inside", "wrap"]

/**
 * THE FACES TO OFFER FOR THIS BLANK — or null when we genuinely cannot say.
 *
 * `sidesOf` always answers, which is what makes it wrong for a PICKER: its fallback for a
 * type nobody has configured is ["front"], and that is indistinguishable from a garment
 * that really does print on one face. Offering one face when the truth is "we have not been
 * told" is worse than offering several, so this returns NULL for that case and the caller
 * keeps whatever fallback suits its surface.
 *
 * Confident in exactly two situations, in this order:
 *   1. the product states its own `sides` — a statement about one garment, and a category
 *      cannot know better than the person holding it;
 *   2. its TYPE is configured, which means somebody has said what that category prints on.
 *
 * The type table is TYPE_SPECS, filled by setTypeMockups from platform settings — so a
 * surface that wants a confident answer has to have loaded them, and gets null until it has.
 *
 * ONE DEFINITION, because there were two: the import sheet worked this out inline and the
 * designer did not do it at all (it padded in four standard faces regardless of the
 * product), which is how one duffel came to be offered Front/Back on its product page and
 * Front/Back/Left/Right in the designer on the same afternoon.
 */
export function offeredSides(p: CatalogProduct | null): string[] | null {
  const own = (Array.isArray(p?.sides) ? p.sides : []).filter((s) => ALL_SIDES.includes(String(s)))
  if (own.length) return own
  const spec = specFor(p)
  if (spec) return spec.sides?.length ? spec.sides : ["front"]
  return null
}

/**
 * EVERY SIDE THIS PRODUCT CAN BE DESIGNED ON — the product's own photo per side, and the
 * category's outline wherever it has none.
 *
 * THE FALLBACK IS PER SIDE, and it has to be. The design maker used to choose between the
 * two sets whole: more than one own face meant use only those, otherwise use only the
 * type's. Since `mockupFaces` counts the hero photo as the front, ANY product with a
 * picture plus one side override already had two — so overriding a single side on a
 * six-side type silently deleted the other four faces from the maker. The admin outlines
 * were not a fallback at all; they were an alternative, discarded the moment a product
 * disagreed about one face.
 *
 * That was survivable while a side could only be set by picking an existing gallery image.
 * It stops being survivable now the product editor takes a dropped file per side, because
 * filling one side is exactly the gesture that used to empty the rest.
 *
 * Type order first — it is the order an admin arranged the sides in — then any face the
 * product has that its type does not list, which is a printable surface and must not be
 * hidden just because the category was defined without it.
 *
 * The rule per side, in full:
 *   every side   this product's own photo for it, else the type's outline
 *   front only   …where "its own photo" already means the colourway's shot, then an
 *                explicit front, then the product's hero (mockupFaces resolves that chain).
 * So a product with a real photograph designs against the photograph and a product with
 * none designs against the category outline — the same product-beats-category order
 * `bestMockup` and design-maker's own `mockupOf` already use. NB the editor's side tiles
 * label front "From <type>" in that case, because they describe overrides rather than what
 * the stage will load; they are reporting a different question, not disagreeing.
 */
export function designFaces(p: CatalogProduct | null): MockupFace[] {
  if (!p) return []
  const own = new Map(mockupFaces(p, null).map((f) => [f.side, f.url]))
  const out: MockupFace[] = []
  for (const side of sidesOf(p)) {
    const url = own.get(side) || typeMockupOf(p, side)
    if (url) out.push({ side, url })
  }
  /*
   * A LEFTOVER PHOTO IS NOT A SURFACE (owner's call, 2026-09-09).
   *
   * This used to append every side the product had a picture for, declared or not, on the
   * argument that such a face "is a printable surface and must not be hidden just because
   * the category was defined without it". That was true when a product had NO way to state
   * its own faces — the photo was the only evidence. The editor's Faces checkboxes are that
   * way now, so the evidence has a better source and the appending has become a bug: a
   * duffel filed under Apparel, then corrected to Bags and ticked Front + Back, still
   * carried side_mockups for a sleeve and a hood, and so was offered a sleeve and a hood.
   *
   * The ticks win. A photo for a face the product does not claim is stale data, not an
   * eighth surface — and it stays on the row, so re-ticking that face brings it straight
   * back with its picture intact.
   */
  return out
}

export function bestMockup(p: CatalogProduct | null, color?: string | null, fallback?: string): string {
  // The category stand-in sits between the product's own imagery and the caller's
  // fallback: better than a listing photo, worse than a real mockup of this product.
  return mockupFaces(p, color)[0]?.url || typeMockupOf(p) || fallback || ""
}

/** Sizes a product offers. Many catalog rows carry no `sizes` array and define their
 *  sizes only as per-size price tiers (sizePrices), which is why a picked product could
 *  fill Colour but leave Size empty. Union both.
 *
 *  IN SIZE ORDER. This used to say "preserving sizes[] order", and that order is whatever
 *  the row happened to be written with — a real product printed "S · M · XL · 3XL · 4XL ·
 *  2XL", L missing from the middle and 2XL after 4XL. Stored order was never a meaningful
 *  order anyway once two sources are unioned: sizes[] first, then whatever sizePrices adds,
 *  which is an artefact of this function rather than a fact about the garment.
 *
 *  Fixed HERE because this is the choke point — the catalogue grid, the catalogue list and
 *  the publish picker all read through it, and a run that is right on one and scrambled on
 *  the next is worse than all three being wrong. `bySize` is the app's one ladder
 *  (lib/size-order.ts, mirroring sanmar.js). */
export function sizesOf(p: CatalogProduct | null): string[] {
  if (!p) return []
  const out = new Set<string>()
  for (const s of p.sizes ?? []) if (s) out.add(String(s))
  for (const t of p.sizePrices ?? []) if (t?.size) out.add(String(t.size))
  return [...out].sort(bySize)
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

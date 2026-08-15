import { getSsStyle, getOttoStyle, getSanmarCatalogStyle, colorNames, type CatalogProduct } from "@/lib/api"

// Otto's Product Data stores images as Google Drive links, which don't render in an <img>
// (Drive blocks hotlinking). Rewrite to Drive's embeddable thumbnail URL.
export function driveImg(url?: string | null): string {
  if (!url) return ""
  const s = String(url)
  const m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/) || s.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800` : s
}
export const driveMap = (m?: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, driveImg(v)]))

type SsFb = { title?: string | null; price?: number | string | null; image?: string | null; colors?: string[] | null }
type OttoFb = { name?: string | null; price?: number | string | null; image?: string | null; colors?: string[] | null }
type SanmarFb = { name?: string | null; price?: number | string | null; image?: string | null; colors?: string[] | null }

// Build a catalog product from a supplier style (fetches its full detail on demand). One
// place, reused by every "Add to Products" button so the shape never drifts.
/**
 * Per-colour stock for one S&S style, for the review step.
 *
 * A separate call rather than a field on the product, because stock is a fact about the
 * SUPPLIER right now and a product is a thing we sell — folding a quantity into the record
 * would persist a number that is stale the moment it is written. The server caches a style's
 * detail for repeat opens, so asking twice in the same breath costs one request.
 *
 * Only S&S answers. Otto's inventory is a call per sku and SanMar's is SOAP per style, so
 * this returns null for them — null being "we did not ask", never "none".
 */
export async function ssStockByColor(styleID: string): Promise<Record<string, number> | null> {
  const d = await getSsStyle(styleID).catch(() => null)
  return d && !d.error && d.stockByColor ? d.stockByColor : null
}

export async function ssCatalogProduct(styleID: string, fb: SsFb): Promise<CatalogProduct> {
  const d = await getSsStyle(styleID)
  if (d.error) throw new Error(d.error)
  return {
    id: "SS-" + styleID, name: d.title || fb.title || styleID, type: "Apparel", method: "DTG", status: "Active",
    // The supplier's price IS our cost (S&S returns wholesale/net). It belongs in Product
    // cost, NOT Base cost — writing it to Base cost charged the seller our raw cost with no
    // margin. Base is left blank so it derives as productCost + the base_markup setting.
    productCost: d.price ?? fb.price ?? undefined,
    sizes: d.sizes ?? [], colorImages: d.colorImages ?? {}, mainColor: colorNames(d.colors)[0] ?? fb.colors?.[0],
    /**
     * THEIRS, IN THE FIELD FOR THEIRS. `sku` is left UNSET on purpose.
     *
     * The two-sku split exists because publish sends the blank's `sku` as `sku_base` — so
     * anything written there ends up on the seller's Etsy and Shopify listings. That is how
     * Otto's own style number reached four live listings (see catalog.js), and it is why a
     * supplier's code goes in `supplierSku`, which sellerSafe strips from a seller's copy.
     *
     * Leaving `sku` unset hands it to the editor, which offers the next free EG-#### — ours,
     * dull, and safe to print on someone else's shop page.
     *
     * The VALUE is the style number ("5000"), not `styleID`. styleID is S&S's internal row
     * id — the right thing in their URLs and the key every fetch here uses, but a number
     * that appears on no spec sheet and no purchase order. Falls back to partNumber, then
     * the id, because an unfamiliar code still tells two blanks apart and a blank field
     * doesn't.
     */
    img: d.image ?? fb.image ?? undefined, images: d.extraImages ?? [],
    supplierSku: d.styleName || d.partNumber || styleID,
    // The back / side / on-model shots, still attached to the colourway S&S sent them for.
    // `images` keeps the same pictures as a flat gallery for readers that want one.
    colorGallery: d.colorExtras ?? undefined,
    description: d.description ?? undefined, supplier: "S&S",
  }
}
export async function ottoCatalogProduct(style: string, fb: OttoFb): Promise<CatalogProduct> {
  const d = await getOttoStyle(style).catch(() => null)
  const colorImages = d && !d.error ? driveMap(d.colorImages) : {}
  if (Object.keys(colorImages).length === 0) for (const c of fb.colors ?? []) colorImages[c] = driveImg(fb.image)
  return {
    id: "OTTO-" + style, name: d?.name || fb.name || style, type: "Headwear", method: "Embroidery", status: "Active",
    // Otto's price is our wholesale cost → Product cost, not Base cost (which derives as
    // productCost + markup). See the S&S note above.
    productCost: Number(d?.price ?? fb.price) || undefined,
    sizes: d?.sizes ?? [], colorImages, mainColor: Object.keys(colorImages)[0] || (fb.colors ?? [])[0],
    // THEIRS — see the note in ssCatalogProduct. Unchanged in value (the first variant sku,
    // which is what older order lines were matched on), only moved out of `sku`, which
    // publish would have written onto the seller's listing.
    img: driveImg(d?.image ?? fb.image) || undefined, supplierSku: d?.skus?.[0] || style,
    description: d?.description ?? undefined, supplier: "Otto Cap",
  }
}
// SanMar resolves entirely from the imported catalog (no live SOAP call) — its detail
// endpoint already returns per-colour images and every variant. SanMar is apparel like S&S,
// so it defaults to DTG. Its price is our wholesale cost → Product cost (see the S&S note).
export async function sanmarCatalogProduct(style: string, fb: SanmarFb): Promise<CatalogProduct> {
  const d = await getSanmarCatalogStyle(style).catch(() => null)
  const colorImages = d && !d.error ? { ...d.colorImages } : {}
  if (Object.keys(colorImages).length === 0) for (const c of fb.colors ?? []) colorImages[c] = fb.image ?? ""
  return {
    id: "SANMAR-" + style, name: d?.name || fb.name || style, type: "Apparel", method: "DTG", status: "Active",
    productCost: Number(d?.price ?? fb.price) || undefined,
    sizes: d?.sizes ?? [], colorImages, mainColor: Object.keys(colorImages)[0] || (fb.colors ?? [])[0],
    // THEIRS — see the note in ssCatalogProduct. SanMar's style code ("PC61") identifies the
    // blank on their side; ours is assigned by the editor.
    img: (d?.image ?? fb.image) || undefined, supplierSku: style,
    description: d?.description ?? undefined, supplier: "SanMar",
  }
}

/**
 * Tidy a supplier colour code into something readable.
 *
 * Otto ship colours as abbreviations — "S.Pnk/Blk/H.Pnk" — which nobody says out loud and
 * which read as a part number in a list. Expands the common ones and spaces the slashes;
 * anything unrecognised is left alone rather than mangled into a worse guess.
 */
const COLOR_WORDS: Record<string, string> = {
  blk: "Black", wht: "White", nvy: "Navy", gry: "Grey", gry2: "Grey", chr: "Charcoal",
  pnk: "Pink", red: "Red", roy: "Royal", grn: "Green", oli: "Olive", brn: "Brown",
  org: "Orange", yel: "Yellow", pur: "Purple", tan: "Tan", khk: "Khaki", crm: "Cream",
  s: "Soft", h: "Heather", l: "Light", d: "Dark", m: "Medium",
}
export function prettyColor(raw?: string | null): string {
  if (!raw) return ""
  const s = String(raw).trim()
  if (!s) return ""
  // Only touch strings that actually look like codes — dotted or slashed abbreviations.
  if (!/[./]/.test(s)) return s
  return s
    .split("/")
    .map((part) =>
      part.split(".").map((w) => {
        const k = w.trim().toLowerCase()
        return COLOR_WORDS[k] ?? (w.trim() ? w.trim()[0].toUpperCase() + w.trim().slice(1) : "")
      }).filter(Boolean).join(" ")
    )
    .filter(Boolean)
    .join(" / ")
}

// The ONE place the app resolves an order item's imagery. The seller order detail, the
// factory boards, and the orders hub all call these — so they never diverge the way the
// old app did (its blank-design bug came from resolving designs under different keys —
// itemDK vs bare sku — in different files). Keep every surface on these helpers.

import { type OrderItem } from "@/lib/api"

export type DesignBlob = { data?: string; pos?: unknown; name?: string; kind?: string }

// Normalize a raw design blob (data-URL, http URL, same-origin path, or bare base64) to a
// usable <img> src.
//
// The leading-slash case is NOT cosmetic: storage-backed artwork now comes back as
// /api/order_designs/art/<hash>.png, and without this it was treated as bare base64 and
// prefixed with a data:image/png header — turning a working path into a broken image.
export function designSrc(d?: string | null): string {
  if (!d) return ""
  return d.startsWith("data:") || d.startsWith("http") || d.startsWith("/") ? d : `data:image/png;base64,${d}`
}

// The item's composite/listing image — server-authoritative `img` (re-inherited per SKU
// on every write server-side, so it's stable across seller ↔ factory).
export function itemImage(it: Pick<OrderItem, "img">): string {
  return it.img || ""
}

/**
 * The item's attached artwork.
 *
 * LINE FIRST, sku only as a fallback. The map is built by indexDesigns() in lib/api, which
 * files a line-keyed design under its line_id and leaves the sku slot for rows saved before
 * lines were tracked. Reading by sku alone meant two lines of the same sku resolved to the
 * same image — one of them wrong, and printed that way.
 *
 * Kept as a local lookup rather than importing designForLine: this module's DesignBlob is
 * looser than OrderDesign, and widening it to match would spread that looseness rather than
 * contain it.
 */
export function itemArtwork(designs: Record<string, DesignBlob> | undefined, it: Pick<OrderItem, "sku" | "line_id">): string {
  if (!designs) return ""
  const d = (it.line_id ? designs[it.line_id] : undefined) ?? (it.sku ? designs[it.sku] : undefined)
  return designSrc(d?.data)
}

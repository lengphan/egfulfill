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
/**
 * MARKETPLACE CDNs, and the reason a thumbnail goes through us.
 *
 * MIRRORS the ALLOWED list in server/src/routes/etsy.js's /api/etsy/img-proxy — change both.
 * It lived only in thread-match.ts, where it existed to make a canvas readable; that is the
 * SAME list for a different reason, so it is defined here (the one place image sources are
 * resolved) and thread-match imports it rather than keeping a second copy.
 */
export const MARKETPLACE_CDN = /(^|\.)(etsystatic\.com|shopify\.com|shopifycdn\.net|shopifycdn\.com|tiktokcdn\.com|tiktokcdn-us\.com|ibyteimg\.com|byteimg\.com)$/i

/**
 * A marketplace image, served through our own origin.
 *
 * Etsy/Shopify/TikTok artwork was rendered straight into `<img src>`, so every one of them
 * was a hotlink: subject to their referrer rules, their CORS, and their retention. When one
 * stopped answering the tile showed the ALT TEXT — a paragraph of listing title where a
 * picture should be, which is what "the order images can't be read" looks like.
 *
 * The proxy already existed for canvas reads and sets both a content type and a day of
 * cache. Anything not on the list is returned untouched: our own paths, data: URLs and
 * same-origin storage links have no reason to make the round trip.
 */
export function proxiedImageSrc(url?: string | null): string {
  if (!url || !/^https?:\/\//i.test(url)) return url || ""
  let host = ""
  try { host = new URL(url).hostname } catch { return url }
  return MARKETPLACE_CDN.test(host) ? `/api/etsy/img-proxy?url=${encodeURIComponent(url)}` : url
}

/**
 * A LISTING PHOTO AT THE SIZE IT IS ACTUALLY DRAWN.
 *
 * Etsy keeps every photo at several widths and the sync stores the LARGEST — `imgUrlOf` in
 * server/src/routes/etsy.js prefers `url_fullxfull`. A row tile is 96px. So every board was
 * pulling a full-resolution product photo to paint a thumbnail, times every row: measured on
 * live rows, 232kB and 68kB where 17kB and 7.6kB carry the same picture at 300x300 — which
 * still covers a 96px tile on a 3x screen. Of 1,362 stored line images, 1,096 are
 * `il_fullxfull` and 53 are `il_570xN`, so this is nearly all of them.
 *
 * ONLY `i.etsystatic.com`'s `il_<size>` shape is rewritten. Etsy's `ipf_` shape, our own
 * paths, `data:` URLs and every other host come back exactly as given — including the
 * supplier proxy `/api/ss/img`, which §2.9 governs and which this has no business touching.
 * Anything that does not match is returned unchanged rather than guessed at.
 *
 * The STORED url is untouched — this is a projection at render time, not a migration. The
 * designer and the print path keep the full-resolution one, which is exactly why this is not
 * done at sync: the big image is still the right image, just not for a 96px square.
 */
export function thumbSrc(url?: string | null, size = "300x300"): string {
  if (!url || !/^https?:\/\/i\.etsystatic\.com\//i.test(url)) return url || ""
  return url.replace(/\/il_[a-zA-Z0-9]+\./, `/il_${size}.`)
}

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

/**
 * A PICTURE SMALL ENOUGH TO KEEP FOREVER.
 *
 * The upload history needs to still show what was published a year from now, and it has two
 * bad options either side of this one. The full photo is a `data:` URL of several megabytes
 * — 500 listings of those is a table that can't be read in one request, which is exactly why
 * `persistableImage` refuses them and why the history had no pictures at all. The
 * marketplace's own CDN link costs nothing and dies with the listing.
 *
 * So: 200px, WebP, quality 0.7 — 6–10KB in practice. Small enough to sit in the row, big
 * enough to recognise the product, and it survives the draft being deleted on Etsy. The
 * ORIGINAL still goes to object storage (see /api/spydeck/photo); this is only the picture
 * the card draws.
 *
 * Falls back to the source URL untouched if anything goes wrong. A history with a link that
 * might break is better than no history because a canvas threw.
 */
const MAX_EDGE = 200
const QUALITY = 0.7

export async function thumbnail(src: string, maxEdge = MAX_EDGE): Promise<string> {
  if (!src) return src
  // A remote image taints the canvas and toDataURL throws — the same rule the thread matcher
  // lives by. Only same-origin and data: sources can be read back, so anything else is
  // returned as-is: it already has a URL, which is what we were trying to get to anyway.
  const readable = src.startsWith("data:") || src.startsWith("/") || src.startsWith(location.origin)
  if (!readable) return src
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("image did not load"))
      el.src = src
    })
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return src
    const scale = Math.min(1, maxEdge / Math.max(w, h))
    // Already small enough — re-encoding would cost quality for no saving.
    if (scale >= 1 && src.length < 24 * 1024) return src
    const c = document.createElement("canvas")
    c.width = Math.max(1, Math.round(w * scale))
    c.height = Math.max(1, Math.round(h * scale))
    const ctx = c.getContext("2d")
    if (!ctx) return src
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const out = c.toDataURL("image/webp", QUALITY)
    // Some browsers answer a WebP request with a PNG, which can be BIGGER than the source.
    // Keep whichever is actually smaller — the point is the bytes, not the format.
    return out.length < src.length ? out : src
  } catch {
    return src
  }
}

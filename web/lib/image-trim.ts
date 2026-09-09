"use client"

import { useEffect, useState } from "react"

/**
 * CROP A COMPOSED SQUARE BACK DOWN TO THE ARTWORK IN IT.
 *
 * The design maker flattens a stack with `composeDesign`, which paints every layer at its
 * position AS A PERCENTAGE OF THE STAGE onto a transparent square. That is exactly right
 * for a template — the square IS the garment's frame, so the composite can be laid back
 * over the blank and land where it was placed — and exactly wrong for the artwork library,
 * where the square is mostly nothing: a design placed at 40% of the stage saved a 640px
 * picture whose subject was 250px in the middle, so the Artwork grid rendered a row of
 * postage stamps floating in grey and there was no way to tell a small design from a big
 * one.
 *
 * Worse, that padding COMPOUNDS: placing such a thumbnail back on the stage placed the
 * empty square, so the artwork came back smaller again every round trip.
 *
 * So the library stores the artwork, tight to its own alpha bounding box. Nothing is
 * scaled — the pixels are the ones that were there, with the emptiness removed.
 */

/** Downscaled edge the alpha scan runs at. A bounding box does not need full resolution,
 *  and a 2400px composite would be 23MB of ImageData to find four numbers in. */
const SCAN_EDGE = 480
/** Below this alpha a pixel is background. Not 0: a soft edge or a stray antialiased
 *  pixel from a rotated layer would otherwise pin the box to the whole canvas. */
const ALPHA_FLOOR = 12
/** A box this close to the full frame is the frame — return the original rather than
 *  re-encode it for a one-pixel gain. */
const FULL_ENOUGH = 0.97

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * Returns `src` cropped to its opaque content, or `src` unchanged when there is nothing to
 * gain — an opaque photograph, a picture that already fills its frame, a decode failure.
 *
 * PNG DATA URLs ONLY, and both halves of that matter: JPEG has no alpha to read, and a
 * remote URL taints the canvas so `getImageData` throws (CLAUDE.md §5).
 */
export async function trimTransparent(src: string): Promise<string> {
  if (!src.startsWith("data:image/png")) return src
  const img = await load(src)
  const w0 = img?.naturalWidth ?? 0
  const h0 = img?.naturalHeight ?? 0
  if (!img || !w0 || !h0) return src

  const scale = Math.min(1, SCAN_EDGE / Math.max(w0, h0))
  const sw = Math.max(1, Math.round(w0 * scale))
  const sh = Math.max(1, Math.round(h0 * scale))
  const scan = document.createElement("canvas")
  scan.width = sw; scan.height = sh
  const sctx = scan.getContext("2d", { willReadFrequently: true })
  if (!sctx) return src
  sctx.drawImage(img, 0, 0, sw, sh)

  let data: Uint8ClampedArray
  try { data = sctx.getImageData(0, 0, sw, sh).data } catch { return src }

  let minX = sw, minY = sh, maxX = -1, maxY = -1
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] < ALPHA_FLOOR) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  // Nothing opaque anywhere. An empty picture is not improved by cropping it to 1px.
  if (maxX < 0) return src

  // Back to the original's own pixels, with a hairline of margin so a stroke that ends
  // exactly on the box is not shaved by the rounding.
  const pad = Math.round(Math.max(w0, h0) * 0.01)
  const x0 = Math.max(0, Math.floor(minX / scale) - pad)
  const y0 = Math.max(0, Math.floor(minY / scale) - pad)
  const x1 = Math.min(w0, Math.ceil((maxX + 1) / scale) + pad)
  const y1 = Math.min(h0, Math.ceil((maxY + 1) / scale) + pad)
  const cw = Math.max(1, x1 - x0)
  const ch = Math.max(1, y1 - y0)
  if (cw / w0 > FULL_ENOUGH && ch / h0 > FULL_ENOUGH) return src

  const out = document.createElement("canvas")
  out.width = cw; out.height = ch
  const octx = out.getContext("2d")
  if (!octx) return src
  octx.drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch)
  try { return out.toDataURL("image/png") } catch { return src }
}

/* ── Reading it back on rows that were saved before the trim existed ────────────────── */

/**
 * A LIBRARY ALREADY FULL OF PADDED SQUARES.
 *
 * Saving tight fixes every design saved from now on and none of the ones already there, so
 * the grid trims what it is handed. Two rules keep that from being the memory bug §2.8
 * describes: the work is queued at a fixed width, and each job is started by a MOUNT — a
 * card appearing — which is an event that cannot re-fire on its own result.
 */
const cache = new Map<string, string>()
/** Enough entries for a screenful of cards several times over; a full library must not be
 *  held twice in memory just because it was scrolled past. */
const CACHE_MAX = 60
let active = 0
const waiting: (() => void)[] = []

function queued<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      active++
      job().then(resolve, reject).finally(() => {
        active--
        waiting.shift()?.()
      })
    }
    // Three at a time. Each decode holds a full-size bitmap plus a 480² scan buffer, and a
    // grid of 200 cards all decoding at once is how a thumbnail grid eats a laptop.
    if (active < 3) start()
    else waiting.push(start)
  })
}

/** `src`, cropped to its content once it has been measured. Returns `src` until then, so a
 *  card never renders empty and never flashes a placeholder. */
export function useTrimmedSrc(src?: string | null): string {
  // The SOURCE is kept beside the result: a bare result string would paint the previous
  // row's picture for a frame whenever `src` changed (CLAUDE.md §5).
  const [done, setDone] = useState<{ src: string; out: string } | null>(null)

  useEffect(() => {
    if (!src || !src.startsWith("data:image/png")) return
    let live = true
    const hit = cache.get(src)
    if (hit !== undefined) {
      // Async on purpose — a synchronous setState here is what react-hooks/set-state-in-effect
      // forbids, and the value is not needed this frame.
      const id = setTimeout(() => { if (live) setDone({ src, out: hit }) }, 0)
      return () => { live = false; clearTimeout(id) }
    }
    queued(() => trimTransparent(src)).then((out) => {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
      cache.set(src, out)
      if (live) setDone({ src, out })
    }).catch(() => {})
    return () => { live = false }
  }, [src])

  return (done && done.src === src ? done.out : src) ?? ""
}

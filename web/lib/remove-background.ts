// Background removal WITHOUT a model, an API or a credit.
//
// Ported from the legacy design tools (`_upRemoveBg` / `qpRemoveBg` in eg-design-tools.js),
// which sampled the four corners, averaged them into a background colour, and cleared every
// pixel in the image within a colour distance of it.
//
// ONE DELIBERATE CHANGE: that version cleared matching pixels ANYWHERE in the image, so a
// design on white lost the white inside its own letters — the counters of an "o", the
// highlight in an eye — and came back looking eaten. This version floods inward from the
// BORDER and only clears background that is actually connected to the edge, which is the
// difference between "the background is gone" and "the artwork has holes in it".
//
// It is a colour-distance flood, so it is honest about what it can do: it removes a
// reasonably uniform backdrop. A photographic background, a gradient, or a subject that
// matches its own backdrop will not separate, and the caller is told so rather than handed
// a mangled image.

import { useState } from "react"
import { canvasReadableSrc } from "./thread-match"

/** Longest side we will process. Above this the flood is slow enough to lock the tab. */
const MAX_PIXELS = 40_000_000

export type RemoveBgResult =
  | { url: string; cleared: number }
  | { error: string }

/**
 * @param src        Image source. MUST be same-origin or proxied — a remote image taints the
 *                   canvas and `getImageData` throws (see canvasReadableSrc in thread-match).
 * @param tolerance  0-100. How far a pixel's colour may sit from the sampled background and
 *                   still count as background. 12 is conservative; ~18 suits a photographed
 *                   backdrop with shadow in it.
 */
export function removeBackground(src: string, tolerance = 12): Promise<RemoveBgResult> {
  return new Promise((resolve) => {
    if (!src) { resolve({ error: "There is no artwork to work on yet." }); return }
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onerror = () => resolve({ error: "That image could not be loaded." })
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight
      if (!w || !h) { resolve({ error: "That image has no size." }); return }
      if (w * h > MAX_PIXELS) { resolve({ error: "That image is too large to process in the browser." }); return }

      const c = document.createElement("canvas")
      c.width = w; c.height = h
      const ctx = c.getContext("2d", { willReadFrequently: true })
      if (!ctx) { resolve({ error: "This browser can't process images here." }); return }
      ctx.drawImage(img, 0, 0)

      let data: ImageData
      try {
        data = ctx.getImageData(0, 0, w, h)
      } catch {
        // The canvas is tainted. Callers place artwork through canvasReadableSrc precisely
        // so this can't happen; say which failure it is rather than "something went wrong".
        resolve({ error: "This image comes from another site, so the browser won't let us edit it." })
        return
      }

      const d = data.data
      // Sample the four corners. Corners are the safest guess at "backdrop" without asking
      // the person to click one.
      const at = (x: number, y: number) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]] as const }
      const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)]

      // AGREE FIRST, AVERAGE SECOND. Averaging all four blind is what the legacy version did,
      // and on a photograph it invents a colour that sits nowhere near any corner — a test on
      // a navy-to-amber gradient had it confidently erasing 58% of the picture along the band
      // where the average happened to fall. So: keep the largest group of corners that match
      // EACH OTHER, and average only those. Three agreeing corners with one odd one out is the
      // ordinary case where the subject bleeds into a corner, and it still works. Fewer than
      // three agreeing means there is no flat backdrop to find, and saying so is far better
      // than returning a confidently mangled image.
      const dist = (a: readonly number[], b: readonly number[]) =>
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
      const CORNER_AGREE = 42
      let group: (readonly number[])[] = []
      for (const seed of corners) {
        const near = corners.filter((q) => dist(seed, q) <= CORNER_AGREE)
        if (near.length > group.length) group = near
      }
      if (group.length < 3) {
        resolve({ error: "The edges of this image aren't one flat colour, so there's no background to lift off." })
        return
      }
      const bg = [0, 1, 2].map((k) => group.reduce((s, q) => s + q[k], 0) / group.length)

      // Tolerance is given 0-100 but compared in RGB space, whose maximum distance is
      // sqrt(3 * 255^2) ≈ 441. Squared throughout so the loop never calls Math.sqrt.
      const limit = (Math.max(0, Math.min(100, tolerance)) / 100) * 441
      const limitSq = limit * limit
      const isBg = (i: number) => {
        const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2]
        return dr * dr + dg * dg + db * db <= limitSq
      }

      // Flood inward from every border pixel. Int32Array + a manual stack pointer rather
      // than an array of coordinates: on a 4000px image the difference is seconds.
      const seen = new Uint8Array(w * h)
      const stack = new Int32Array(w * h)
      let sp = 0
      const push = (p: number) => { if (!seen[p] && isBg(p * 4)) { seen[p] = 1; stack[sp++] = p } }
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }

      let cleared = 0
      while (sp > 0) {
        const p = stack[--sp]
        d[p * 4 + 3] = 0
        cleared++
        const x = p % w, y = (p / w) | 0
        if (x > 0) push(p - 1)
        if (x < w - 1) push(p + 1)
        if (y > 0) push(p - w)
        if (y < h - 1) push(p + w)
      }

      if (!cleared) {
        resolve({ error: "No even background found around the edges — try a higher tolerance." })
        return
      }
      // Everything cleared means the corners matched the whole picture; returning a blank
      // PNG would look like the tool destroyed the artwork.
      if (cleared >= w * h) {
        resolve({ error: "That would erase the whole image — try a lower tolerance." })
        return
      }

      // Feather the seam. A hard alpha cut leaves a 1px fringe of background colour around
      // the subject, which prints as a halo; softening the pixels that border a cleared one
      // costs one pass and is the difference between "cut out" and "cut out badly".
      const alpha = new Uint8ClampedArray(w * h)
      for (let p = 0; p < w * h; p++) alpha[p] = d[p * 4 + 3]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x
          if (!alpha[p]) continue
          const touchesCleared =
            (x > 0 && !alpha[p - 1]) || (x < w - 1 && !alpha[p + 1]) ||
            (y > 0 && !alpha[p - w]) || (y < h - 1 && !alpha[p + w])
          if (touchesCleared) d[p * 4 + 3] = Math.round(alpha[p] * 0.5)
        }
      }

      ctx.putImageData(data, 0, 0)
      try {
        resolve({ url: c.toDataURL("image/png"), cleared })
      } catch {
        resolve({ error: "The edited image couldn't be read back." })
      }
    }
    img.src = src
  })
}

/**
 * The whole Remove-background control, minus the markup.
 *
 * TWO surfaces run this — the Design maker's right panel and the mini designer's "Your
 * design" card — and they need identical behaviour: the same tolerance, the same refusals,
 * and the same undo. Writing it twice is how they drift, so the state lives here and each
 * surface only decides what the buttons look like.
 *
 * UNDO, not "place it again". Removal rewrites the artwork in place, and the honest way to
 * offer a way back is to keep the bytes we replaced rather than telling someone to go and
 * find the original. `canUndo` is DERIVED, not stored: it holds only while the artwork is
 * still the one we produced, so replacing the image or picking a new one from the library
 * silently retires an undo that would otherwise restore the wrong picture.
 *
 * @param url    The artwork currently placed.
 * @param apply  How the surface sets its artwork. Called with the new data URL, or with the
 *               previous one on undo.
 */
export function useBackgroundRemoval(url: string, apply: (next: string) => void) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const [tolerance, setTolerance] = useState(12)
  /** What we replaced, and what we replaced it WITH — the pair is what makes undo safe. */
  const [swap, setSwap] = useState<{ before: string; after: string } | null>(null)

  const canUndo = swap !== null && url === swap.after

  const run = async () => {
    if (!url || busy) return
    setBusy(true); setMsg("")
    try {
      // Buyer artwork on an order line is a MARKETPLACE url, and reading pixels off one taints
      // the canvas — the mini designer would refuse on exactly the images sellers most want to
      // clean up. Route anything that isn't already a data: url through the img proxy so it
      // arrives same-origin, the same rule the thread matcher and the design maker follow.
      const readable = url.startsWith("data:") ? url : canvasReadableSrc(url)
      const r = await removeBackground(readable, tolerance)
      if ("error" in r) { setMsg(r.error); return }
      // The result is a data: url, so whatever saves next persists the CUT-OUT rather than a
      // link back to the original — which is what makes the removal stick everywhere the
      // design travels afterwards (the board, the factory, publish). Leave it alone and the
      // artwork is untouched; that is the "if no remove BG then keep the same" half.
      setSwap({ before: url, after: r.url })
      apply(r.url)
    } finally {
      setBusy(false)
    }
  }

  const undo = () => {
    if (!canUndo || !swap) return
    apply(swap.before)
    setSwap(null)
    setMsg("")
  }

  /** Nudging the slider retires the message — it described the previous attempt. */
  const changeTolerance = (v: number) => { setTolerance(v); setMsg("") }

  return { busy, msg, tolerance, changeTolerance, run, undo, canUndo }
}

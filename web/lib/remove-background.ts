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
  /** `cleared` is fully-transparent pixels; `pixels` is the whole image, so the caller can
   *  report a share rather than a count nobody can scale. */
  | { url: string; cleared: number; pixels: number }
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
      const at = (x: number, y: number) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]] as const }
      const dist = (a: readonly number[], b: readonly number[]) =>
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

      /*
       * THE WHOLE BORDER, NOT FOUR CORNERS.
       *
       * Corner sampling needed three of four corners to agree, so a subject bleeding into two
       * of them — a wide signature, a garment filling the frame — got "the edges aren't one
       * flat colour" and no removal at all, on images with a perfectly good backdrop along
       * every edge between the corners. Four pixels is also four chances to land on noise.
       *
       * So: walk the entire border, cluster the samples, and take the biggest cluster. It has
       * to be a real majority of the edge (55%) or there genuinely is no backdrop to lift and
       * the refusal stands — that guard is what stops a gradient being confidently erased.
       */
      const edge: (readonly number[])[] = []
      const STEP = Math.max(1, Math.floor(Math.min(w, h) / 256))
      for (let x = 0; x < w; x += STEP) { edge.push(at(x, 0)); edge.push(at(x, h - 1)) }
      for (let y = 0; y < h; y += STEP) { edge.push(at(0, y)); edge.push(at(w - 1, y)) }

      const CLUSTER = 40
      let best: (readonly number[])[] = []
      for (const seed of edge) {
        const near = edge.filter((q) => dist(seed, q) <= CLUSTER)
        if (near.length > best.length) best = near
      }
      if (best.length < edge.length * 0.55) {
        resolve({ error: "The edges of this image aren't one flat colour, so there's no background to lift off." })
        return
      }
      const bg = [0, 1, 2].map((k) => best.reduce((sum, q) => sum + q[k], 0) / best.length)

      /*
       * A SOFT BAND, NOT AN ON/OFF LINE.
       *
       * The old pass was binary — a pixel was background or it was not — and then smeared one
       * row of 50% alpha over the seam to hide the join. On thin anti-aliased strokes that is
       * the wrong tool twice over. Every edge pixel of a signature is a BLEND of ink and paper,
       * so a hard cut either keeps them (a white halo tracing every letter) or drops them (the
       * stroke breaks up and thins). Neither survives being printed.
       *
       * Alpha is proportional instead: at the background colour a pixel is fully cleared, and
       * it ramps back to solid across a band. A half-ink pixel comes out half-opaque, which is
       * what it actually is — and that is the whole difference between a cut-out that prints
       * clean and one that prints with a fringe.
       */
      const inner = (Math.max(0, Math.min(100, tolerance)) / 100) * 441
      const outer = inner * 2.4 + 24
      const distAt = (i: number) => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2])

      /*
       * Connectivity still decides WHAT may be touched — flooding inward from the border is
       * what keeps the white inside an "o" and the highlight in an eye, which is the bug this
       * file was written to fix. The flood spreads across anything inside the OUTER band, so
       * anti-aliased edge pixels are reached and can be softened; how much each one loses is
       * then decided by its own distance, not by having been reached.
       */
      const seen = new Uint8Array(w * h)
      const stack = new Int32Array(w * h)
      let sp = 0
      const push = (p: number) => { if (!seen[p] && distAt(p * 4) <= outer) { seen[p] = 1; stack[sp++] = p } }
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }

      let cleared = 0
      while (sp > 0) {
        const p = stack[--sp]
        const i = p * 4
        const dd = distAt(i)
        // 0 at the background colour, 1 at the far edge of the band.
        const t = dd <= inner ? 0 : Math.min(1, (dd - inner) / Math.max(1, outer - inner))
        const a = Math.round(t * d[i + 3])
        if (a < d[i + 3]) {
          /*
           * DECONTAMINATE what survives. A partly-transparent pixel still holds the colour it
           * was blended WITH — un-mix it, or a black signature keeps a pale grey rim that no
           * amount of feathering hides, and it shows the moment the cut-out is placed on any
           * colour other than the one it was lifted from.
           *
           * Standard un-premultiply: P = C·a + bg·(1-a)  ⇒  C = (P - bg·(1-a)) / a.
           * Only above a floor, because at very low alpha the division amplifies noise into
           * confetti — those pixels are nearly invisible anyway.
           */
          if (a > 24) {
            const af = a / 255
            for (let k = 0; k < 3; k++) {
              d[i + k] = Math.max(0, Math.min(255, Math.round((d[i + k] - bg[k] * (1 - af)) / af)))
            }
          }
          d[i + 3] = a
          if (a === 0) cleared++
        }
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
      // Everything cleared means the backdrop matched the whole picture; returning a blank
      // PNG would look like the tool destroyed the artwork.
      if (cleared >= w * h) {
        resolve({ error: "That would erase the whole image — try a lower tolerance." })
        return
      }

      ctx.putImageData(data, 0, 0)
      try {
        resolve({ url: c.toDataURL("image/png"), cleared, pixels: w * h })
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
      /*
       * SAY HOW MUCH CAME OFF. A removal that took 2% of the image and one that took 60%
       * look identical on a thumbnail against a checkerboard, and the first is the common
       * failure — a backdrop with a gradient in it, where the flood stops a few pixels from
       * the border and leaves everything else. Without a number the only way to find out is
       * to place the design and notice later.
       */
      setMsg(`Cleared ${Math.round((r.cleared / Math.max(1, r.pixels)) * 100)}% — nudge the tolerance and run it again if that is too much or too little.`)
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

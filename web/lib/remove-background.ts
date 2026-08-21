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
 * IT PICKS ITS OWN THRESHOLD, from the image.
 *
 * This took a `tolerance` number and every surface put a slider on it, which asked the
 * person cutting out a signature to guess a colour distance in RGB space — a unit nobody
 * has an intuition for, on a value whose right answer is different for every picture. The
 * honest reading of "I moved the slider until it looked right" is that the tool knew what
 * it needed and made someone find it by hand.
 *
 * The image already says what it needs. A flat white studio backdrop has edge pixels sitting
 * within a couple of units of each other; a photographed sheet of paper with a shadow across
 * it spreads over thirty. That SPREAD is the threshold — measure how far the background
 * varies from itself and admit exactly that much, rather than a constant that is too tight
 * for one and too loose for the other.
 *
 * @param src  Image source. MUST be same-origin or proxied — a remote image taints the
 *             canvas and `getImageData` throws (see canvasReadableSrc in thread-match).
 */
export function removeBackground(src: string): Promise<RemoveBgResult> {
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
      /*
       * THE THRESHOLD, MEASURED — how far the background varies FROM ITSELF.
       *
       * Every sample in the winning cluster is background by definition, so the spread of
       * those samples around their own mean is exactly the tolerance this image needs. A
       * seamless white sweep sits inside 2-3 units and gets a tight cut that keeps the
       * anti-aliasing on a hairline; a photographed sheet with a shadow across it spreads
       * over thirty and gets a threshold that actually reaches the shadow.
       *
       * mean + 2.5 sd covers the tail without chasing the one outlier that landed on the
       * subject. Floored at 18 because JPEG ringing exists even on a synthetic flat fill,
       * and capped at 90 because past that a "background" is wide enough to include most
       * artwork and the answer should be a refusal rather than an erasure.
       */
      const devs = best.map((qq) => dist(qq, bg))
      const mean = devs.reduce((a, b) => a + b, 0) / Math.max(1, devs.length)
      const sd = Math.sqrt(devs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, devs.length))
      const measured = Math.max(18, Math.min(90, mean + sd * 2.5))
      /*
       * HOW FAR THE BACKDROP IS ALLOWED TO WANDER — and the border already knows.
       *
       * The travelling reference follows a gradient by taking small steps, and a small step
       * is also how you walk INTO a subject whose edge is gentle: a pale grey logo on white
       * is a jump of about thirty, a blurred edge is a ramp of ones. Tested, and both were
       * erased outright — the tool eating the artwork it was asked to cut out, which is
       * worse than leaving a fringe.
       *
       * What separates the two is not the step, it is the RANGE. On a vignette the border
       * itself spans the whole gradient — the corners ARE the dark end — so a wide range is
       * evidence that a wide range is legitimate. On flat white the border spans nothing, so
       * anything far from white is the subject, however gently it got there.
       *
       * Measured across every edge sample rather than the winning cluster, because the
       * cluster is by definition the part that agreed.
       */
      const edgeMax = edge.reduce((m, qq) => Math.max(m, dist(qq, bg)), 0)
      const distAt = (i: number) => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2])

      /*
       * Connectivity still decides WHAT may be touched — flooding inward from the border is
       * what keeps the white inside an "o" and the highlight in an eye, which is the bug this
       * file was written to fix. The flood spreads across anything inside the OUTER band, so
       * anti-aliased edge pixels are reached and can be softened; how much each one loses is
       * then decided by its own distance, not by having been reached.
       */
      const source = new Uint8ClampedArray(d)          // pristine, so a pass can be re-run
      const seen = new Uint8Array(w * h)
      const stack = new Int32Array(w * h)
      /*
       * WHAT EACH PIXEL IS JUDGED AGAINST — its own patch of background, not the average of
       * the border.
       *
       * One global colour is the wrong reference for any backdrop that CHANGES across the
       * frame: a vignette, a drop shadow, a lit sweep. The border is the pale end of it, so
       * the dark end sits further away than any threshold measured on the border admits, and
       * the cut stops partway leaving a dark collar around the subject. Widening the
       * threshold until it reaches the far end is the same knob that starts eating pale
       * artwork — which is exactly the trade the slider was asking someone to make by hand.
       *
       * So the flood carries a reference WITH it. A pixel is admitted when it is close to
       * the pixel it was reached FROM, and the reference then drifts halfway toward it. A
       * gradient is a sequence of small steps, so the flood walks the whole of it however
       * deep it goes; the subject's edge is one large step, so it stops there. The threshold
       * stops being a guess about the image and becomes a statement about smoothness.
       */
      const ref = new Uint8Array(w * h * 3)
      const edgePixels = new Int32Array(w * h)
      const soft = new Uint8Array(w * h)

      const pass = (inner: number) => {
        const outer = inner * 2.4 + 24
        /*
         * How big a jump counts as an EDGE rather than more backdrop.
         *
         * The measured spread already IS "how much this background varies", so a step of
         * one whole spread is the honest reading: anything inside it is the backdrop being
         * itself. At 0.55 of it a noisy paper lost a fifth of its backdrop to speckle —
         * grain between neighbouring pixels routinely exceeds half the spread, so the flood
         * kept meeting "edges" that were two grains of noise.
         *
         * It is still nowhere near a real boundary: black artwork on white is a jump of
         * 200+, and the largest step this ever allows is 90.
         */
        const step = Math.max(14, inner)
        // The ceiling the wandering reference may not cross — see edgeMax.
        const roam = Math.max(inner, edgeMax * 1.25 + 12)
        d.set(source)
        seen.fill(0)
        soft.fill(0)
        let sp = 0
        // Boundary pixels: softened after the flood, never spread from. See admit().
        let ep = 0
        /*
         * TOUCHED IS NOT THE SAME AS TRUSTED.
         *
         * A pixel past `roam` is not backdrop — but if it is inside the soft band it is an
         * anti-aliased pixel on the boundary and still needs its alpha ramped, or the cut-out
         * gets a hard jagged edge. Softening it is right; letting it SPREAD is what erased a
         * pale grey logo in testing: the reference followed into the subject, every pixel
         * inside then matched its own neighbours perfectly, and the whole shape dissolved.
         *
         * So it is marked seen and softened against the sampled background, and never pushed
         * — the flood dies at the boundary instead of walking through it.
         */
        const admit = (p: number, r0: number, g0: number, b0: number) => {
          if (seen[p]) return
          const i = p * 4
          if (Math.hypot(source[i] - r0, source[i + 1] - g0, source[i + 2] - b0) > step) return
          if (distAt(i) > roam) {
            /*
             * NOTED, NOT CLOSED. Marking it `seen` here was a regression the tests caught:
             * on a smooth vignette the pixels hovering just past `roam` formed a ring the
             * flood could never re-enter, so it died a third of the way in — 87% cleared
             * became 66%. It is only recorded for softening; a later neighbour whose
             * reference has drifted closer can still admit it properly.
             */
            if (!soft[p] && distAt(i) <= inner * 2.4 + 24) { soft[p] = 1; edgePixels[ep++] = p }
            return
          }
          seen[p] = 1
          // Drift halfway: the reference follows the gradient instead of anchoring to where
          // the flood started, which is what lets it cross an arbitrarily deep sweep.
          ref[p * 3] = (r0 + source[i]) >> 1
          ref[p * 3 + 1] = (g0 + source[i + 1]) >> 1
          ref[p * 3 + 2] = (b0 + source[i + 2]) >> 1
          stack[sp++] = p
        }
        // The border seeds still answer to the SAMPLED background — that is what keeps "this
        // image has no even backdrop" a refusal rather than a slow erasure from one corner.
        const seed = (p: number) => {
          if (seen[p] || distAt(p * 4) > outer) return
          seen[p] = 1
          ref[p * 3] = source[p * 4]; ref[p * 3 + 1] = source[p * 4 + 1]; ref[p * 3 + 2] = source[p * 4 + 2]
          stack[sp++] = p
        }
        for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
        for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }

        let n = 0
        while (sp > 0) {
          const p = stack[--sp]
          const i = p * 4
          const rr = ref[p * 3], rg = ref[p * 3 + 1], rb = ref[p * 3 + 2]
          const dd = Math.hypot(source[i] - rr, source[i + 1] - rg, source[i + 2] - rb)
          // 0 at the background colour, 1 at the far edge of the band.
          const t = dd <= inner ? 0 : Math.min(1, (dd - inner) / Math.max(1, outer - inner))
          const a = Math.round(t * d[i + 3])
          if (a < d[i + 3]) {
            /*
             * DECONTAMINATE what survives. A partly-transparent pixel still holds the colour
             * it was blended WITH — un-mix it, or a black signature keeps a pale grey rim
             * that no amount of feathering hides, and it shows the moment the cut-out is
             * placed on any colour other than the one it was lifted from.
             *
             * Standard un-premultiply: P = C·a + bg·(1-a)  ⇒  C = (P - bg·(1-a)) / a.
             * Only above a floor, because at very low alpha the division amplifies noise into
             * confetti — those pixels are nearly invisible anyway.
             */
            if (a > 24) {
              const af = a / 255
              const local = [rr, rg, rb]
              for (let k = 0; k < 3; k++) {
                d[i + k] = Math.max(0, Math.min(255, Math.round((d[i + k] - local[k] * (1 - af)) / af)))
              }
            }
            d[i + 3] = a
            if (a === 0) n++
          }
          const x = p % w, y = (p / w) | 0
          if (x > 0) admit(p - 1, rr, rg, rb)
          if (x < w - 1) admit(p + 1, rr, rg, rb)
          if (y > 0) admit(p - w, rr, rg, rb)
          if (y < h - 1) admit(p + w, rr, rg, rb)
        }
        // The boundary ring, softened against the SAMPLED background — they were never
        // backdrop, so judging them against a reference that walked here would be judging
        // them against themselves.
        for (let q = 0; q < ep; q++) {
          const p = edgePixels[q]
          if (seen[p]) continue          // the flood reached it properly in the end
          const i = p * 4
          const dd = distAt(i)
          const t = dd <= inner ? 0 : Math.min(1, (dd - inner) / Math.max(1, outer - inner))
          const a = Math.round(t * d[i + 3])
          if (a < d[i + 3]) {
            if (a > 24) {
              const af = a / 255
              for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, Math.round((d[i + k] - bg[k] * (1 - af)) / af)))
            }
            d[i + 3] = a
            if (a === 0) n++
          }
        }
        return n
      }

      /*
       * A LADDER OF THREE, NOT A LOOP.
       *
       * The measured threshold is right for a backdrop that varies smoothly. It is wrong for
       * one with a hard step in it — a vignette, a fold, a drop shadow with an edge — where
       * the flood reaches that step and stops, taking a rim off the border and leaving the
       * rest. What comes back is 1% cleared and a picture that looks untouched, which is the
       * failure that sent everyone to the slider.
       *
       * So: try the measured value, and if it barely moved, try again wider. Three fixed
       * rungs, decided before any of them runs — never a while-loop on a condition the work
       * itself changes (CLAUDE.md §2.8). Each pass is a fresh flood over the ORIGINAL pixels,
       * so a wider rung is not compounding the last one.
       *
       * 2% is "it did nothing". A real cut-out of a subject on a backdrop is tens of percent;
       * a genuine near-miss — artwork that fills its frame — refuses below, which is correct.
       */
      const LADDER = [measured, measured * 1.7, measured * 2.6]
      let cleared = 0
      for (const inner of LADDER) {
        cleared = pass(inner)
        if (cleared >= w * h * 0.02) break
      }

      if (!cleared) {
        resolve({ error: "There is no even background around the edges of this image to lift off." })
        return
      }
      // Everything cleared means the backdrop matched the whole picture; returning a blank
      // PNG would look like the tool destroyed the artwork.
      if (cleared >= w * h * 0.985) {
        resolve({ error: "The artwork is too close in colour to its background to separate them." })
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
 * THREE surfaces run this — the Design maker, the mini designer and the photo studio — and
 * they need identical behaviour: the same refusals and the same undo. Writing it twice is
 * how they drift, so the state lives here and each surface only decides what the button
 * looks like. There is no longer a setting to keep in step, which is the best version of
 * that: the threshold is measured from the image (see removeBackground).
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
      const r = await removeBackground(readable)
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
      /*
       * NOTHING TO SAY ON SUCCESS. The share cleared was worth printing while there was a
       * dial to turn with it; without one it is a number nobody can act on, sitting under a
       * picture that already shows what happened. Failures still speak — those name
       * something the person can actually do.
       */
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

  return { busy, msg, run, undo, canUndo }
}

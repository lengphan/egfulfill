"use client"

import { useEffect, useRef } from "react"

/**
 * A photograph reduced to 1-bit ink on paper by Atkinson dithering — the same
 * error-diffusion an early laser printer used — then revealed a band at a time,
 * top to bottom, like a print head crossing the sheet.
 *
 * The hero asks "what if every order printed itself?". This is the page answering
 * it literally rather than decoratively: the image you're looking at prints itself
 * in front of you, once, and then sits still.
 *
 * Two colours only. Ink and paper. The indigo lives on exactly one word of the
 * headline and nowhere near this.
 */
export function DitherImage({
  src, alt = "", ink = "#191918", paper = "#f4f2ef",
  scale = 2.4, className, animate = true, focusY = 0.5,
}: {
  src: string
  alt?: string
  /** Colour of a set pixel. */
  ink?: string
  /** Colour of an unset pixel. */
  paper?: string
  /** Device pixels per dithered dot — higher = chunkier, more obviously printed. */
  scale?: number
  className?: string
  animate?: boolean
  /** Vertical anchor of the cover-crop, 0 = top edge, 1 = bottom. Default 0.5
   *  (centre) matches CSS `object-position: center`. A square source in a wide,
   *  short box crops HARD, and centring a composition whose subject sits up top
   *  throws away the subject and leaves texture — this is how you keep it. */
  focusY?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let raf = 0
    let cancelled = false

    // Honour the OS setting: no print-head sweep, just the finished sheet.
    const still = !animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const hex = (h: string): [number, number, number] => {
      const n = parseInt(h.replace("#", ""), 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    const [ir, ig, ib] = hex(ink)
    const [pr, pg, pb] = hex(paper)

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      if (cancelled) return
      const host = canvas.parentElement
      if (!host) return
      // Dither at a REDUCED resolution, then upscale with smoothing off. That's what
      // makes the dots read as dots — dithering at full res just looks like noise.
      const w = Math.max(1, Math.round(host.clientWidth / scale))
      const h = Math.max(1, Math.round((host.clientHeight || host.clientWidth * 0.7) / scale))

      const off = document.createElement("canvas")
      off.width = w; off.height = h
      const octx = off.getContext("2d", { willReadFrequently: true })
      if (!octx) return

      // Cover-fit the source into the dither buffer.
      const ar = img.width / img.height
      let dw = w, dh = w / ar
      if (dh < h) { dh = h; dw = h * ar }
      const fy = Math.min(1, Math.max(0, focusY))
      octx.drawImage(img, (w - dw) / 2, (h - dh) * fy, dw, dh)

      const imgData = octx.getImageData(0, 0, w, h)
      const d = imgData.data
      // Greyscale into a float buffer — error diffusion needs headroom below 0 and
      // above 255, which a Uint8 array would clamp away and muddy the result.
      const grey = new Float32Array(w * h)
      for (let i = 0; i < w * h; i++) {
        const o = i * 4
        grey[i] = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]
      }
      // Lift midtones so the type stays readable over the busiest areas.
      for (let i = 0; i < grey.length; i++) grey[i] = 255 - (255 - grey[i]) * 0.72

      // Atkinson: spreads only 6/8 of the error, which is why it holds highlights
      // open and looks like a printed plate rather than a noisy gradient.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const old = grey[i]
          const nu = old < 128 ? 0 : 255
          grey[i] = nu
          const err = (old - nu) / 8
          const push = (dx: number, dy: number) => {
            const nx = x + dx, ny = y + dy
            if (nx < 0 || nx >= w || ny >= h) return
            grey[ny * w + nx] += err
          }
          push(1, 0); push(2, 0); push(-1, 1); push(0, 1); push(1, 1); push(0, 2)
        }
      }

      for (let i = 0; i < w * h; i++) {
        const o = i * 4
        const on = grey[i] < 128
        d[o] = on ? ir : pr; d[o + 1] = on ? ig : pg; d[o + 2] = on ? ib : pb; d[o + 3] = 255
      }
      octx.putImageData(imgData, 0, 0)

      const ctx = canvas.getContext("2d")
      if (!ctx) return
      canvas.width = w; canvas.height = h
      ctx.imageSmoothingEnabled = false

      if (still) { ctx.drawImage(off, 0, 0); return }

      // The pass. Eased so it starts quick and settles, the way a carriage decelerates.
      let row = 0
      const step = Math.max(1, Math.round(h / 46))
      const tick = () => {
        if (cancelled) return
        row = Math.min(h, row + step)
        ctx.drawImage(off, 0, 0, w, row, 0, 0, w, row)
        if (row < h) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    img.src = src

    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [src, ink, paper, scale, animate, focusY])

  return (
    <canvas
      ref={ref}
      aria-label={alt || undefined}
      role={alt ? "img" : "presentation"}
      className={className}
      style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }}
    />
  )
}

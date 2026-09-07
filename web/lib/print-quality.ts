"use client"

import { useEffect, useState } from "react"

/**
 * WHAT A PLACED LAYER WOULD PRINT AT, in DPI — and the hook that measures the pixels.
 *
 * These lived in `design-maker.tsx` and were imported by NOTHING else, which is exactly
 * how the Design Maker came to be the only surface that checks resolution. The mini
 * designer places artwork on lines the factory actually prints and said nothing at all
 * about a 640px file stretched across a 12-inch front.
 *
 * They are pure (the hook aside) and shared by two callers, so they belong in lib/ —
 * a reader only one component imports is a private copy waiting to happen.
 */

/**
 * `pos.w` is a percentage of the STAGE, and the print area is a percentage of the same
 * stage — so the layer's share of the printable rectangle is pos.w / zone.w, and its
 * printed width in inches is that share of the area's real width. Pixels over inches is
 * the DPI. Nothing here is about the file's own DPI tag: a 500px image labelled 300 DPI
 * still only has 500 pixels to spend, which is the thing that actually goes soft.
 */
export function layerDpi(naturalW: number, posW: number, zoneW: number, areaInW: number): number | null {
  if (!(naturalW > 0) || !(posW > 0) || !(zoneW > 0) || !(areaInW > 0)) return null
  const printedInches = (posW / zoneW) * areaInW
  if (!(printedInches > 0)) return null
  return naturalW / printedInches
}

/** How wide the layer actually prints, in inches — the other half of the same sum, and
 *  the number a person can check against a tape measure. */
export function printedInches(posW: number, zoneW: number, areaInW: number): number | null {
  if (!(posW > 0) || !(zoneW > 0) || !(areaInW > 0)) return null
  const w = (posW / zoneW) * areaInW
  return w > 0 ? w : null
}

/** Green / amber / red, and what to say about it. 300 is the guideline we publish; 150 is
 *  the floor most DTG and DTF work is still acceptable at. */
export function dpiVerdict(dpi: number | null): { tone: "ok" | "warn" | "bad" | "unknown"; label: string } {
  if (dpi == null) return { tone: "unknown", label: "Measuring…" }
  if (dpi >= 300) return { tone: "ok", label: "Print quality: good" }
  if (dpi >= 150) return { tone: "warn", label: "Print quality: usable" }
  return { tone: "bad", label: "Print quality: too low" }
}

/**
 * WHAT TO PUT ON SCREEN — which is not the same as what we measured.
 *
 * A verdict is only worth a person's attention when they have to ACT on it. `good` and
 * `usable` both mean "this will print", and a strip that announces that is chrome: the
 * meter was green beside every correctly-sized file, so the one time it went red it read
 * as more of the same. Only `bad` speaks.
 *
 * And it speaks in WORDS. "15 DPI" is a number a seller can do nothing with that "low
 * resolution" does not already tell them — they cannot add pixels to a file they were
 * sent, and the fix (scale it down, or find a bigger one) is the same at 15 as at 90.
 * The figure stays on `layerDpi` for anything that needs to reason about it, and in the
 * tooltip for anyone who wants it.
 *
 * Returns null when there is nothing to say. Render nothing — not an empty span, not a
 * grey dot; a placeholder for a warning is how the row grew back.
 */
export function dpiWarning(dpi: number | null): { label: string; hint: string } | null {
  if (dpiVerdict(dpi).tone !== "bad") return null
  return {
    label: "Low resolution",
    hint: "Scale it down, or replace it with a larger file — this will look soft in print.",
  }
}

/**
 * THE PIXELS A PLACED IMAGE ACTUALLY HAS.
 *
 * Module-scope and content-keyed by src, so the same artwork on three layers is measured
 * once and a re-render never re-measures anything. Decoding is the whole cost here.
 */
const naturalCache = new Map<string, { w: number; h: number }>()

export function useNaturalSizes(srcs: string[]): Map<string, { w: number; h: number }> {
  const key = srcs.join("\u0000")
  const [, setTick] = useState(0)
  useEffect(() => {
    const missing = key.split("\u0000").filter((u) => u && !naturalCache.has(u))
    if (!missing.length) return
    let live = true
    Promise.all(missing.map((u) => new Promise<void>((res) => {
      const im = new window.Image()
      im.crossOrigin = "anonymous"
      // A 0×0 entry is still an ANSWER — it stops this retrying a broken URL every render,
      // and layerDpi reads it as "can't tell" rather than as a quality verdict.
      im.onload = () => { naturalCache.set(u, { w: im.naturalWidth, h: im.naturalHeight }); res() }
      im.onerror = () => { naturalCache.set(u, { w: 0, h: 0 }); res() }
      im.src = u
    // Re-render once the whole batch is in, not once per image: a ten-layer design would
    // otherwise re-render ten times on open.
    }))).then(() => { if (live) setTick((n) => n + 1) })
    return () => { live = false }
  }, [key])
  return naturalCache
}

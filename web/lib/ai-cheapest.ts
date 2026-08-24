import type { ImageGenModel, VideoGenModel } from "@/lib/api"

/**
 * WHAT A GENERATOR OPENS ON — the cheapest thing the catalogue can make, every time.
 *
 * The owner's standing instruction, and it was being re-derived in three places (the chat
 * composer, the listing photo studio, the Studio page) with three slightly different rules:
 * one ranked models by their own `defaultSize` price, which can pick a dearer render than
 * the model sitting next to it. One rule, imported.
 *
 * Two things it is careful about:
 *
 *   PRICE, NEVER POSITION. The catalogue is ordered best-first and gains rows, so `[0]` or
 *   `[length - 1]` silently follows whatever was added last.
 *
 *   A TIE GOES TO THE LARGER SIZE. Nano Banana Pro bills 1K and 2K identically, so picking
 *   the smaller one costs the same and returns a picture below what a marketplace wants —
 *   cheapest is about the money, and at equal money there is nothing to save by asking for
 *   less. Sizes are labels ("0.5K", "4K"), so the comparison is on the parsed number.
 */
const px = (size: string) => {
  const n = parseFloat(size)
  return Number.isFinite(n) ? n : 0
}

export type CheapestImage = { id: string; size: string; usd: number }

/** The cheapest (model, size) pair on offer, or null if nothing carries a price. */
export function cheapestImage(models: ImageGenModel[] | undefined | null): CheapestImage | null {
  if (!models?.length) return null
  return models.reduce<CheapestImage | null>((best, m) => {
    for (const size of m.sizes) {
      const usd = m.usd[size]
      if (typeof usd !== "number") continue
      if (!best || usd < best.usd || (usd === best.usd && px(size) > px(best.size))) {
        best = { id: m.id, size, usd }
      }
    }
    return best
  }, null)
}

/** The cheapest size THIS model offers — what a model change should land on, rather than
 *  the model's own `defaultSize`, which is a quality choice and not a price one. */
export function cheapestSize(model: ImageGenModel | undefined | null): string {
  if (!model) return ""
  let best = ""
  let bestUsd = Infinity
  for (const size of model.sizes) {
    const usd = model.usd[size]
    if (typeof usd !== "number") continue
    if (usd < bestUsd || (usd === bestUsd && px(size) > px(best))) { best = size; bestUsd = usd }
  }
  return best || model.defaultSize
}

export type CheapestVideo = { id: string; res: string; usdPerSec: number }

/** Same rule for clips, which are priced per SECOND. A tie goes to the higher resolution. */
export function cheapestVideo(models: VideoGenModel[] | undefined | null): CheapestVideo | null {
  if (!models?.length) return null
  return models.reduce<CheapestVideo | null>((best, m) => {
    for (const res of m.resolutions) {
      const usd = m.usdPerSec[res]
      if (typeof usd !== "number") continue
      if (!best || usd < best.usdPerSec || (usd === best.usdPerSec && px(res) > px(best.res))) {
        best = { id: m.id, res, usdPerSec: usd }
      }
    }
    return best
  }, null)
}

/** The cheapest resolution THIS model offers. */
export function cheapestResolution(model: VideoGenModel | undefined | null): string {
  if (!model) return ""
  let best = ""
  let bestUsd = Infinity
  for (const res of model.resolutions) {
    const usd = model.usdPerSec[res]
    if (typeof usd !== "number") continue
    if (usd < bestUsd || (usd === bestUsd && px(res) > px(best))) { best = res; bestUsd = usd }
  }
  return best || model.defaultResolution
}

/** Marks the recommended row in a model picker, so the default is visible as a CHOICE
 *  rather than as whatever happened to be selected. */
export function modelOptionLabel(m: { id: string; label: string }, recommendedId: string | null) {
  return m.id === recommendedId ? `${m.label} · cheapest` : m.label
}

import type { CSSProperties } from "react"

/**
 * HOW A PRODUCT PHOTO IS FRAMED — one rule, read by every surface that shows one.
 *
 * A supplier's studio shot is a small garment in a large white field, and the whitespace is
 * IN the file: no amount of layout moves it. So a product carries two numbers, set once in
 * the product editor — how far to scale the picture up, and which band of it to keep — and
 * every screen that renders that product has to honour them or the product looks like two
 * different products depending on where you opened it. It did: the editor and the staff
 * grid applied them, and the product page, the public catalogue and the public product page
 * ignored them entirely, so framing someone had spent time on simply evaporated on save.
 *
 * PANNING IS A TRANSLATE, NOT AN object-position.
 *
 * `object-position` only moves a picture through the overflow that `object-fit: cover` has
 * already created. A 4:3 photo in a square box overflows sideways and not at all vertically
 * — so the up/down control did nothing whatsoever on exactly the shots people were trying to
 * fix, and the slider could be dragged end to end with the image sitting still. (The one
 * product using this in production is at focus 0, the very end of that dead range.)
 * Translating the element moves it whether or not there is overflow, by the same amount on
 * every aspect ratio, which is the only way one slider can mean one thing.
 *
 * Values stay as they were stored: 0–100, 50 = untouched, 0 = show the TOP band. That is the
 * same direction object-position gave, so a saved product keeps meaning what it meant.
 */

/** Slider bounds for the vertical control. 50 is centre; the ends are the full travel. */
export const FOCUS_MIN = 0
export const FOCUS_MAX = 100
export const FOCUS_CENTRE = 50

/**
 * How far each end of the slider moves the picture, as a percentage of the image's own
 * height. Scaled along with the zoom (the translate sits inside the same transform), so a
 * zoomed-in photo — which is where the hidden parts are — pans proportionally further.
 *
 * 40% is deliberately past the no-gap limit. Panning within the cover overflow can never
 * show the box behind, but it also cannot move a photo that doesn't overflow, which was the
 * whole complaint. Past the edge is a choice someone can now make and undo with Reset.
 */
export const FOCUS_TRAVEL_PCT = 40

export const ZOOM_MIN = 100
export const ZOOM_MAX = 300

type Framed = { imgZoom?: number | string | null; imgFocusY?: number | string | null }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * ABSENT IS NOT ZERO — and on this slider zero is the far end, not the neutral value.
 *
 * `Number(null)` is `0`, and `0` is finite, so reading these fields with a bare `Number()`
 * turned "this product has no framing" into "shove the picture 40% down". The public API
 * emits `imgFocusY: null` for every unframed product (a missing key becomes an explicit
 * null over JSON), so that was ALL of them: every photo on /catalog and every product page
 * sank out of its own well and left the accent plate showing above it.
 *
 * So absence is checked before the cast, never after it. Only a number somebody actually
 * stored is allowed to move a picture.
 */
const stored = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The stored zoom as a multiplier. 1 when unset or unreadable. */
export function zoomOf(p: Framed | null | undefined): number {
  const z = stored(p?.imgZoom)
  return z !== null && z > 0 ? clamp(z, ZOOM_MIN, ZOOM_MAX) / 100 : 1
}

/** The stored vertical focus, 0–100. 50 (centre) when unset or unreadable. */
export function focusOf(p: Framed | null | undefined): number {
  const y = stored(p?.imgFocusY)
  return y === null ? FOCUS_CENTRE : clamp(y, FOCUS_MIN, FOCUS_MAX)
}

/**
 * The style an <img> (or a next/image with `fill`) needs to be framed as the product says.
 *
 * Returns an EMPTY object for an unframed product rather than `scale(1) translateY(0)`, so
 * a photo nobody has touched carries no transform at all — a transform creates a containing
 * block and a paint layer, and every product on a 200-card grid does not need one to say
 * "unchanged".
 */
export function framingStyle(p: Framed | null | undefined): CSSProperties {
  const zoom = zoomOf(p)
  const focus = focusOf(p)
  if (zoom === 1 && focus === FOCUS_CENTRE) return {}
  // 0 → the picture moves DOWN, so the top of it is what stays in frame. Same direction the
  // object-position version had, so stored values keep their meaning.
  const shift = ((FOCUS_CENTRE - focus) / FOCUS_CENTRE) * FOCUS_TRAVEL_PCT
  return { transform: `scale(${zoom}) translateY(${shift.toFixed(2)}%)` }
}

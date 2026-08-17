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
 * THE SMALLEST TRAVEL THE SLIDER EVER HAS — a nudge, as a fraction of the BOX's height.
 *
 * The ends used to move the picture 40% of its own height, INSIDE the scale, so the actual
 * displacement multiplied with the zoom: 40% of the well at zoom 100 and 120% at zoom 300.
 * Rendering the whole slider against a real cap showed what that costs — of twenty
 * zoom × up/dn positions only about five kept the garment in the frame. The rest pushed it
 * out of the top or the bottom, which is a control that spends most of its travel destroying
 * the shot, and it is why framing looked like it did not work.
 *
 * At zoom 100 a photo has almost nothing to give: the picture is already sized to the well,
 * so any real movement takes the subject somewhere it cannot come back from. 12% is a nudge —
 * enough to lift a cap sitting low in its frame, not enough to lose it.
 */
export const FOCUS_TRAVEL_MIN = 0.12

/**
 * Kept as the old name and the old number for anything still importing it. The travel is no
 * longer a fixed percentage — see panFraction.
 * @deprecated read panFraction instead
 */
export const FOCUS_TRAVEL_PCT = 40

/**
 * HOW FAR THE SLIDER MAY MOVE THE PICTURE, as a fraction of the box, at this zoom.
 *
 * The rule every crop tool uses: you may pan as far as the zoom made room for. Scaling a
 * picture by z hides (z − 1) / 2 of the box above and below, and that hidden part is exactly
 * what panning is for — bringing it back into view. Below zoom ~1.24 that slack is smaller
 * than a useful nudge, so the floor takes over.
 *
 * The consequence worth stating: the ends of the slider mean DIFFERENT distances at different
 * zooms, and that is correct. At 100% there is nothing to explore and the ends are a nudge; at
 * 300% there is a whole picture behind the well and the ends reach it.
 */
export function panFraction(zoom: number): number {
  /**
   * The slack, computed against the PAINTED picture rather than the box.
   *
   * These wells are object-contain, so a 4:3 photo paints about three quarters of the box's
   * height and the rest is white — (z − 1) / 2 over-states what there is to pan through by
   * exactly that margin, which is why the ends of the slider still emptied the well at 300%.
   * 0.75 is the worst realistic case (a 4:3 cap shot in a square); anything squarer has more.
   *
   * AND A CEILING, because covering the box is not the same as keeping the GARMENT in it. The
   * subject sits in the middle of a studio shot, so a pan of half the box takes it past the
   * edge however full the frame stays. CSS cannot know where the garment is — it can only be
   * kept from travelling far enough to lose it. 35% is that limit: visibly different from
   * centre at every zoom, never far enough to push the product out of its own picture.
   */
  return clamp((0.75 * zoom - 1) / 2, FOCUS_TRAVEL_MIN, 0.35)
}

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
  /**
   * UP/DN MOVES THE PICTURE. IT DOES NOT ZOOM IT.
   *
   * A version of this raised the zoom to whatever kept the well covered, so that panning
   * could never expose the box behind. That is a legitimate way to crop and it is NOT this
   * control: dragging "up/down" and watching the picture grow is two things happening under
   * one slider, and the one you asked for is the one that stops working.
   *
   * So the transform is the pan and the zoom is the zoom. The two sliders do one thing each,
   * and whatever the pan uncovers is the well's own background — which is white wherever a
   * product photo sits, the same white these cut-out studio shots are already on.
   *
   * 0 → the picture moves DOWN, so the top of it is what stays in frame. Same direction the
   * object-position version had, so stored values keep their meaning.
   *
   * HOW FAR is panFraction's decision — the slack this zoom created, never less than a nudge.
   * And the percentage is divided by the zoom before it goes out, because translateY sits
   * INSIDE scale() and would otherwise be multiplied by it: the same drag moved the picture
   * three times as far at 300% as at 100%, which is how the ends of the slider ended up
   * throwing the garment clean out of the frame.
   */
  const shift = ((FOCUS_CENTRE - focus) / FOCUS_CENTRE) * panFraction(zoom)
  return { transform: `scale(${zoom}) translateY(${((shift * 100) / zoom).toFixed(2)}%)` }
}

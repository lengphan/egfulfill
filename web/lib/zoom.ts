// Page zoom for the app shell — a CONTENT magnifier, not a browser zoom.
//
// Why `zoom` and not the obvious alternatives:
//
//   • `transform: scale()` does not reflow. The element keeps its unscaled layout box, so a
//     scaled page overlaps its neighbours and the scrollbars measure the wrong thing.
//   • Scaling the root font-size only moves REM units. This codebase has ~400 hard-coded
//     `[Npx]` values, so text would grow while icons, chips and column widths stayed put —
//     the layout would come apart at the seams rather than scale.
//   • `zoom` scales the used values of everything, px included, AND relayouts. It is the one
//     property that does what "magnify the content" means.
//
// THE CAVEAT, stated plainly because it changes what else has to be true: media queries are
// evaluated against the real viewport, NOT the zoomed one. At 125% the page still believes it
// has the full window width while its content behaves as though the window were smaller, so a
// responsive breakpoint will not rescue a layout that has run out of room. Anything dense
// therefore has to survive on its own — which is why the orders table carries its own
// horizontal scroller instead of relying on breakpoints.

export const ZOOM_LEVELS = [0.9, 1, 1.1, 1.25, 1.5] as const
export const DEFAULT_ZOOM = 1

const KEY = "eg_zoom"
/** The CSS custom property `.eg-content { zoom: … }` reads (see globals.css). */
const VAR = "--eg-zoom"

const clamp = (n: number) => {
  if (!Number.isFinite(n)) return DEFAULT_ZOOM
  // Snap to the offered levels rather than trusting whatever is in storage: an arbitrary
  // value from a hand-edited key (or an older build with a different scale) would render a
  // size the control can't represent, so the UI and the page would disagree.
  return ZOOM_LEVELS.reduce((best, l) => (Math.abs(l - n) < Math.abs(best - n) ? l : best), DEFAULT_ZOOM)
}

export function loadZoom(): number {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? DEFAULT_ZOOM : clamp(Number(raw))
  } catch { return DEFAULT_ZOOM }
}

/** Write the level to the document AND to storage. Applying it as a custom property on
 *  <html> means one CSS rule covers every shell, with no prop threading and no flash on
 *  client-side navigation — the value is already there when the next page mounts. */
export function applyZoom(level: number) {
  const z = clamp(level)
  try {
    document.documentElement.style.setProperty(VAR, String(z))
    localStorage.setItem(KEY, String(z))
  } catch { /* private mode: the zoom still applies for this page */ }
  return z
}

export const zoomLabel = (z: number) => `${Math.round(z * 100)}%`

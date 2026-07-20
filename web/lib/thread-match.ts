// Embroidery thread matching — ported from egfulfill-store.js. When an EMB design is
// placed, we sample its dominant colours and map each to the nearest in-stock thread, so
// the factory knows which cones to load. Pure client-side canvas work; no network.

export type Thread = { code: string; name: string; hex: string }

// The factory's default thread stock (a Madeira-style chart). Ships with the app; a
// factory-editable palette is a later addition — for now this is the match set.
export const DEFAULT_THREAD_PALETTE: Thread[] = [
  { code: "1801", name: "White", hex: "#FFFFFF" },
  { code: "1800", name: "Black", hex: "#000000" },
  { code: "1718", name: "Grey", hex: "#96A1A8" },
  { code: "1672", name: "Old Gold", hex: "#A67843" },
  { code: "1951", name: "Gold", hex: "#FFCC00" },
  { code: "1987", name: "Orange", hex: "#E25C27" },
  { code: "1910", name: "Flamingo", hex: "#CC3366" },
  { code: "1839", name: "Red", hex: "#CC3333" },
  { code: "1784", name: "Maroon", hex: "#660000" },
  { code: "1966", name: "Navy", hex: "#333366" },
  { code: "1842", name: "Royal", hex: "#005397" },
  { code: "1695", name: "Aqua/Teal", hex: "#3399FF" },
  { code: "1832", name: "Purple", hex: "#6B5294" },
  { code: "1751", name: "Kelly Green", hex: "#01784E" },
  { code: "1848", name: "Kiwi Green", hex: "#7BA35A" },
  { code: "1733", name: "Tan", hex: "#C8AD7F" },
]

type RGB = { r: number; g: number; b: number }

export function hexToRgb(hex: string): RGB {
  let h = String(hex || "").replace("#", "")
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

// ── Perceptual colour distance (OKLab) ───────────────────────────────────────
// Matching used straight Euclidean distance in sRGB, which is not a perceptual
// metric — equal numeric steps are wildly unequal to the eye, especially across
// saturation. Measured failure: a lotus pink #E38BA8 matched TAN (RGB d² 3566)
// over FLAMINGO (d² 12629), because desaturating is numerically cheap in RGB even
// though it is obviously wrong to look at. That is what "the thread match isn't
// swatching properly" was — the sampling was fine, the ruler was broken.
//
// OKLab is perceptually uniform, so nearest-in-OKLab is nearest-to-the-eye. Same
// space the app's design tokens already use (oklch).
type Lab = { L: number; a: number; b: number }

const srgbToLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  }
}

/**
 * Lightness is deliberately down-weighted for THREAD matching.
 *
 * On a garment, hue is the colour's identity and lightness is a shade choice — a cone
 * that's a bit darker than the artwork reads as the same colour; a cone of the wrong
 * hue reads as a mistake. Unweighted OKLab picked TAN for a dusty pink purely because
 * the only pink in stock (Flamingo) is much darker: L 0.570 vs 0.736. Halving the
 * lightness term flips that to Flamingo without disturbing matches that were already
 * hue-correct.
 */
const L_WEIGHT = 0.5
const labDist2 = (x: Lab, y: Lab) =>
  ((x.L - y.L) * L_WEIGHT) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2

// Palette conversion is pure and repeated per pixel-cluster, so memoise per hex.
const LAB_CACHE = new Map<string, Lab>()
function labOfHex(hex: string): Lab {
  const hit = LAB_CACHE.get(hex)
  if (hit) return hit
  const c = hexToRgb(hex)
  const lab = rgbToOklab(c.r, c.g, c.b)
  LAB_CACHE.set(hex, lab)
  return lab
}

/** Nearest thread to an RGB triple, by perceptual (OKLab) distance. */
export function nearestThread(r: number, g: number, b: number, palette = DEFAULT_THREAD_PALETTE): Thread | null {
  const target = rgbToOklab(r, g, b)
  let best: Thread | null = null, bestD = Infinity
  for (const t of palette) {
    const d = labDist2(target, labOfHex(t.hex))
    if (d < bestD) { bestD = d; best = t }
  }
  return best
}

export function nearestThreads(r: number, g: number, b: number, k = 4, palette = DEFAULT_THREAD_PALETTE): Thread[] {
  const target = rgbToOklab(r, g, b)
  return palette
    .map((t) => ({ t, d: labDist2(target, labOfHex(t.hex)) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, k)
    .map((s) => s.t)
}

export type DominantColor = { r: number; g: number; b: number; srcHex: string; c: number }

/**
 * Minimum share of non-background pixels for a colour to count.
 *
 * Was 8%, inherited verbatim from the old app. That is too high for embroidery: an
 * outline, a face, a small floral accent is routinely 3-6% of the artwork and is
 * exactly the cone a digitiser cannot infer. Confirmed twice — a synthetic strip at
 * ~9% was dropped, and a real lotus design matched White/Orange/Black/Old Gold while
 * silently omitting the pink that covers half the flower.
 *
 * Shared by the cone list AND the thread map so the two can never disagree about
 * which threads a design needs.
 */
export const MIN_COLOR_SHARE = 0.03

// Sample a design image → dominant colours. Coarse quantization (8 levels/channel) so
// anti-aliased edges merge into their parent, then a greedy merge within MERGE_DIST so a
// single visual "purple" doesn't surface as three near-purples. Near-white/transparent
// pixels are dropped (design backgrounds aren't a colour). MERGE_DIST 96 is the old
// app's value; the share floor is NOT — see MIN_COLOR_SHARE.
/**
 * Canvas colour analysis needs a READABLE image. A remote CDN image taints the canvas, so
 * getImageData throws — and with crossOrigin set, an upstream without CORS headers fails
 * to load at all. Either way the match silently returned nothing, which is what "thread
 * match doesn't work" looked like on a buyer's Etsy-hosted artwork.
 *
 * Our own img-proxy re-serves those same-origin, which is exactly why it exists. Data URLs
 * (a design we stored ourselves) are already readable and pass through untouched.
 */
export function canvasReadableSrc(url: string): string {
  return /^https?:\/\//i.test(url) ? `/api/etsy/img-proxy?url=${encodeURIComponent(url)}` : url
}

export function extractDominant(dataUrl: string, max = 6): Promise<DominantColor[]> {
  return new Promise((resolve) => {
    if (!dataUrl || typeof document === "undefined") { resolve([]); return }
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const N = 48
      const cv = document.createElement("canvas"); cv.width = N; cv.height = N
      const ctx = cv.getContext("2d", { willReadFrequently: true })
      if (!ctx) { resolve([]); return }
      let data: Uint8ClampedArray
      try { ctx.drawImage(img, 0, 0, N, N); data = ctx.getImageData(0, 0, N, N).data }
      catch { resolve([]); return }   // tainted canvas (cross-origin) → give up quietly
      const buckets: Record<string, { c: number; r: number; g: number; b: number }> = {}
      let total = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 60) continue
        const r = data[i], g = data[i + 1], b = data[i + 2]
        if (r > 234 && g > 234 && b > 234) continue
        const key = `${r >> 5}_${g >> 5}_${b >> 5}`
        const bk = buckets[key] || (buckets[key] = { c: 0, r: 0, g: 0, b: 0 })
        bk.c++; bk.r += r; bk.g += g; bk.b += b; total++
      }
      if (!total) { resolve([]); return }
      const minCount = Math.max(2, total * MIN_COLOR_SHARE)
      const MERGE_DIST = 96
      const hx = (v: number) => ("0" + v.toString(16)).slice(-2)
      const cols = Object.values(buckets)
        .map((b) => ({ c: b.c, r: Math.round(b.r / b.c), g: Math.round(b.g / b.c), b: Math.round(b.b / b.c) }))
        .filter((c) => c.c >= minCount)
        .sort((x, y) => y.c - x.c)
      const merged: { c: number; r: number; g: number; b: number }[] = []
      for (const c of cols) {
        let absorbed = false
        for (const m of merged) {
          const dr = c.r - m.r, dg = c.g - m.g, db = c.b - m.b
          if (Math.sqrt(dr * dr + dg * dg + db * db) <= MERGE_DIST) {
            const w = m.c + c.c
            m.r = Math.round((m.r * m.c + c.r * c.c) / w)
            m.g = Math.round((m.g * m.c + c.g * c.c) / w)
            m.b = Math.round((m.b * m.c + c.b * c.c) / w)
            m.c = w; absorbed = true; break
          }
        }
        if (!absorbed) merged.push({ ...c })
      }
      merged.sort((x, y) => y.c - x.c)
      resolve(merged.slice(0, max).map((c) => ({
        c: c.c, r: c.r, g: c.g, b: c.b,
        srcHex: ("#" + hx(c.r) + hx(c.g) + hx(c.b)).toUpperCase(),
      })))
    }
    img.onerror = () => resolve([])
    img.src = canvasReadableSrc(dataUrl)
  })
}

// ── Per-thread regions: which PART of the design uses which cone ─────────────
// The cone list alone tells the floor what to load but not where it goes, so a
// digitiser still has to guess which shape is which colour. This keeps the pixel
// share and bounding box the extraction already walks past, and cuts one small
// crop per colour so the answer is visual rather than a hex code.
//
// Memory: nothing here is persisted. Crops are 72px PNGs (~2-4kb), capped at 6 per
// design, computed ON DEMAND when someone opens the breakdown and cached in a
// module-level Map keyed by design URL. Close the app and it's all gone — the
// input (the design) is already stored, so re-deriving is cheap and storing the
// output would be duplicating it.

export type ThreadRegion = {
  thread: Thread
  /** The artwork colour that matched, not the cone's own hex. */
  srcHex: string
  /** Share of non-background design pixels, 0-100. */
  pct: number
  /** Where this colour lives, as % of the image — for drawing a locator box. */
  box: { x: number; y: number; w: number; h: number }
  /** A small crop of the design centred on that region. PNG data URL. */
  swatch: string
}

const SWATCH = 72          // px, square
const REGION_CACHE = new Map<string, ThreadRegion[]>()
const CACHE_MAX = 24       // designs; bounded so a long session can't grow forever

/**
 * Dominant colours → nearest thread, WITH the region each colour occupies and a
 * crop of the design there. Same bucketing/merge tuning as extractDominant, so the
 * cones it reports are the same cones the auto-match already reports; this only
 * adds the positional half that was being discarded.
 */
export function matchThreadRegions(
  dataUrl: string, max = 6, palette = DEFAULT_THREAD_PALETTE,
  /**
   * Minimum share of design pixels for a colour to count, 0-1.
   *
   * The cone matcher inherits 8% from the old app, which is fine for "what do I
   * load" but wrong here: an outline or accent thread is often 3-5% of the artwork
   * and is precisely the one a digitiser can't infer. Verified — a gold strip at
   * ~9% of a test design was being dropped entirely at the old floor. Lower floor
   * costs nothing because this runs on demand and stores nothing.
   */
  minShare = MIN_COLOR_SHARE,
): Promise<ThreadRegion[]> {
  const cached = REGION_CACHE.get(dataUrl)
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve) => {
    if (!dataUrl || typeof document === "undefined") { resolve([]); return }
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      // Analyse at 96² — finer than extractDominant's 48² because a bounding box
      // needs more positional resolution than a colour average does, but still
      // ~9k pixels, which is nothing.
      const N = 96
      const cv = document.createElement("canvas"); cv.width = N; cv.height = N
      const ctx = cv.getContext("2d", { willReadFrequently: true })
      if (!ctx) { resolve([]); return }
      let data: Uint8ClampedArray
      try { ctx.drawImage(img, 0, 0, N, N); data = ctx.getImageData(0, 0, N, N).data }
      catch { resolve([]); return }   // tainted canvas — same quiet give-up as the matcher

      type Acc = { c: number; r: number; g: number; b: number; x0: number; y0: number; x1: number; y1: number }
      const buckets: Record<string, Acc> = {}
      let total = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 60) continue
        const r = data[i], g = data[i + 1], b = data[i + 2]
        if (r > 234 && g > 234 && b > 234) continue      // background, not a colour
        const p = i / 4, px = p % N, py = (p / N) | 0
        const key = `${r >> 5}_${g >> 5}_${b >> 5}`
        const bk = buckets[key] || (buckets[key] = { c: 0, r: 0, g: 0, b: 0, x0: px, y0: py, x1: px, y1: py })
        bk.c++; bk.r += r; bk.g += g; bk.b += b
        if (px < bk.x0) bk.x0 = px; if (px > bk.x1) bk.x1 = px
        if (py < bk.y0) bk.y0 = py; if (py > bk.y1) bk.y1 = py
        total++
      }
      if (!total) { resolve([]); return }

      const minCount = Math.max(2, total * minShare)
      const MERGE_DIST = 96
      const cols = Object.values(buckets)
        .map((b) => ({ ...b, r: Math.round(b.r / b.c), g: Math.round(b.g / b.c), b: Math.round(b.b / b.c) }))
        .filter((c) => c.c >= minCount)
        .sort((x, y) => y.c - x.c)

      const merged: Acc[] = []
      for (const c of cols) {
        let absorbed = false
        for (const m of merged) {
          const dr = c.r - m.r, dg = c.g - m.g, db = c.b - m.b
          if (Math.sqrt(dr * dr + dg * dg + db * db) <= MERGE_DIST) {
            const w = m.c + c.c
            m.r = Math.round((m.r * m.c + c.r * c.c) / w)
            m.g = Math.round((m.g * m.c + c.g * c.c) / w)
            m.b = Math.round((m.b * m.c + c.b * c.c) / w)
            m.c = w
            // Boxes merge too, or the crop would only cover the first bucket.
            m.x0 = Math.min(m.x0, c.x0); m.y0 = Math.min(m.y0, c.y0)
            m.x1 = Math.max(m.x1, c.x1); m.y1 = Math.max(m.y1, c.y1)
            absorbed = true; break
          }
        }
        if (!absorbed) merged.push({ ...c })
      }
      merged.sort((x, y) => y.c - x.c)

      // Crop from the FULL-resolution image, not the 96² analysis buffer — the
      // whole point is a legible picture of that part of the artwork.
      const crop = document.createElement("canvas")
      crop.width = SWATCH; crop.height = SWATCH
      const cctx = crop.getContext("2d")
      const sx = img.naturalWidth / N, sy = img.naturalHeight / N

      const hx = (v: number) => ("0" + v.toString(16)).slice(-2)
      const seen = new Set<string>()
      const out: ThreadRegion[] = []

      for (const m of merged) {
        const t = nearestThread(m.r, m.g, m.b, palette)
        if (!t || seen.has(t.code)) continue        // same de-dupe as matchThreadColors
        seen.add(t.code)

        // Square crop around the region's centre. Floored at 18% of the image so a
        // thin outline colour doesn't produce a 2px crop that reads as a solid block.
        const cxN = (m.x0 + m.x1) / 2, cyN = (m.y0 + m.y1) / 2
        const sideN = Math.max(m.x1 - m.x0, m.y1 - m.y0, N * 0.18)
        const half = sideN / 2
        const x0 = Math.max(0, Math.min(N - sideN, cxN - half))
        const y0 = Math.max(0, Math.min(N - sideN, cyN - half))

        let swatch = ""
        if (cctx) {
          cctx.clearRect(0, 0, SWATCH, SWATCH)
          try {
            cctx.drawImage(img, x0 * sx, y0 * sy, sideN * sx, sideN * sy, 0, 0, SWATCH, SWATCH)
            swatch = crop.toDataURL("image/png")
          } catch { swatch = "" }
        }

        out.push({
          thread: t,
          srcHex: ("#" + hx(m.r) + hx(m.g) + hx(m.b)).toUpperCase(),
          pct: Math.round((m.c / total) * 100),
          box: {
            x: +((m.x0 / N) * 100).toFixed(1), y: +((m.y0 / N) * 100).toFixed(1),
            w: +(((m.x1 - m.x0 + 1) / N) * 100).toFixed(1), h: +(((m.y1 - m.y0 + 1) / N) * 100).toFixed(1),
          },
          swatch,
        })
        if (out.length >= max) break
      }

      if (REGION_CACHE.size >= CACHE_MAX) REGION_CACHE.delete(REGION_CACHE.keys().next().value as string)
      REGION_CACHE.set(dataUrl, out)
      resolve(out)
    }
    img.onerror = () => resolve([])
    img.src = canvasReadableSrc(dataUrl)
  })
}

// Auto-match: each dominant colour → its single nearest thread, de-duped by code.
export async function matchThreadColors(dataUrl: string, max = 6, palette = DEFAULT_THREAD_PALETTE): Promise<Thread[]> {
  const cols = await extractDominant(dataUrl, max)
  const seen = new Set<string>(), out: Thread[] = []
  for (const col of cols) {
    const t = nearestThread(col.r, col.g, col.b, palette)
    if (t && !seen.has(t.code)) { seen.add(t.code); out.push(t) }
  }
  return out
}

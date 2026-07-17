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

// Nearest thread to an RGB triple by squared Euclidean distance.
export function nearestThread(r: number, g: number, b: number, palette = DEFAULT_THREAD_PALETTE): Thread | null {
  let best: Thread | null = null, bestD = Infinity
  for (const t of palette) {
    const c = hexToRgb(t.hex)
    const d = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2
    if (d < bestD) { bestD = d; best = t }
  }
  return best
}

export function nearestThreads(r: number, g: number, b: number, k = 4, palette = DEFAULT_THREAD_PALETTE): Thread[] {
  return palette
    .map((t) => { const c = hexToRgb(t.hex); return { t, d: (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2 } })
    .sort((x, y) => x.d - y.d)
    .slice(0, k)
    .map((s) => s.t)
}

export type DominantColor = { r: number; g: number; b: number; srcHex: string; c: number }

// Sample a design image → dominant colours. Coarse quantization (8 levels/channel) so
// anti-aliased edges merge into their parent, then a greedy merge within MERGE_DIST so a
// single visual "purple" doesn't surface as three near-purples. Near-white/transparent
// pixels are dropped (design backgrounds aren't a colour). Verbatim port of the tuning
// constants — MIN_PCT 8%, MERGE_DIST 96 — so results match the old app.
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
      const minCount = Math.max(2, total * 0.08)
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
    img.src = dataUrl
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

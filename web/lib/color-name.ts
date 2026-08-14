// Supplier colour names arrive as catalogue codes: "016 - White", "0317 - Blk/Dk.Grn".
// The number is the supplier's SKU fragment, not information a seller needs, and the
// abbreviations are unreadable in a chip. This turns them into plain names.

// Abbreviation → word. Keys are lowercase, dots already stripped. Order doesn't matter;
// lookup is per token.
const WORDS: Record<string, string> = {
  blk: "Black", bk: "Black", wht: "White", wh: "White", nvy: "Navy", nv: "Navy",
  grn: "Green", gr: "Green", gry: "Grey", gy: "Grey", gld: "Gold", chr: "Charcoal",
  kha: "Khaki", khk: "Khaki", mar: "Maroon", mrn: "Maroon", roy: "Royal", ryl: "Royal",
  brn: "Brown", br: "Brown", org: "Orange", orn: "Orange", pnk: "Pink", prp: "Purple",
  ppl: "Purple", yel: "Yellow", ylw: "Yellow", red: "Red", crm: "Cream", ntl: "Natural",
  nat: "Natural", sil: "Silver", slv: "Silver", tan: "Tan", tea: "Teal", tl: "Teal",
  blu: "Blue", bl: "Blue", olv: "Olive", ol: "Olive", sk: "Sky", char: "Charcoal",
  // Modifiers
  dk: "Dark", drk: "Dark", lt: "Light", lgt: "Light", md: "Medium", med: "Medium",
  hea: "Heather", hth: "Heather", htr: "Heather", vint: "Vintage", vtg: "Vintage",
  fst: "Forest", frst: "Forest", mil: "Military", mlt: "Military", ant: "Antique",
}

// A compact spread of human colour names for suggesting a name from a picked hex — so
// adding a thread cone only needs the colour + code, not typing the name. Generic names
// (not a thread brand's), matched by nearest RGB distance; always editable afterwards.
const NAMED: [string, number, number, number][] = [
  ["White", 255, 255, 255], ["Ivory", 245, 240, 225], ["Cream", 255, 253, 208],
  ["Light Grey", 205, 205, 205], ["Silver", 192, 192, 192], ["Grey", 128, 128, 128],
  ["Charcoal", 70, 74, 78], ["Black", 20, 20, 22],
  ["Red", 216, 30, 30], ["Dark Red", 139, 0, 0], ["Maroon", 128, 0, 32], ["Crimson", 220, 20, 60],
  ["Coral", 255, 127, 80], ["Salmon", 250, 128, 114], ["Pink", 255, 105, 180], ["Light Pink", 255, 182, 193], ["Hot Pink", 255, 20, 147],
  ["Orange", 255, 140, 0], ["Rust", 183, 65, 14], ["Gold", 240, 190, 45], ["Yellow", 255, 221, 0], ["Light Yellow", 255, 244, 150],
  ["Beige", 245, 235, 200], ["Tan", 210, 180, 140], ["Khaki", 189, 183, 107], ["Brown", 120, 72, 40], ["Dark Brown", 80, 50, 28],
  ["Lime", 140, 200, 40], ["Green", 34, 150, 60], ["Light Green", 144, 238, 144], ["Dark Green", 0, 90, 40], ["Forest", 34, 90, 34], ["Olive", 110, 110, 30], ["Mint", 150, 220, 180], ["Teal", 0, 128, 128],
  ["Sky Blue", 110, 190, 235], ["Light Blue", 150, 200, 235], ["Blue", 30, 90, 220], ["Royal", 65, 90, 210], ["Navy", 15, 25, 80], ["Denim", 60, 95, 140],
  ["Lavender", 200, 180, 235], ["Purple", 120, 50, 160], ["Violet", 150, 90, 210], ["Indigo", 75, 40, 130], ["Magenta", 200, 40, 170],
]
/** Nearest human colour name for a hex (e.g. "#1E5ADC" → "Blue"). "" if not a valid hex. */
export function nearestColorName(hex: string): string {
  const h = String(hex || "").replace("#", "")
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return ""
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  let best = "", bestD = Infinity
  for (const [name, cr, cg, cb] of NAMED) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
    if (d < bestD) { bestD = d; best = name }
  }
  return best
}

// Words we leave alone when already spelled out (so "Green" doesn't become "Green Green").
const expandToken = (t: string): string => {
  const key = t.toLowerCase().replace(/\./g, "")
  if (!key) return ""
  if (WORDS[key]) return WORDS[key]
  // Already a real word — just title-case it.
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * "016 - White" → "White"
 * "017 - Dk. Green" → "Dark Green"
 * "0317 - Blk/Dk.Grn" → "Black/Dark Green"
 * "3032 - Sk.Blu/Wht" → "Sky Blue/White"
 *
 * Unknown abbreviations are title-cased rather than dropped — a colour we don't have a
 * mapping for should still read as itself, not disappear.
 */
export function prettyColorName(raw: string): string {
  if (!raw) return ""
  let s = String(raw).trim()

  // Strip a leading supplier code: "016 - ", "0317-", "12 – " (also en-dash).
  // Supplier codes lead the name and are not always numeric: "016 - White" but also
  // "031753A - Blk/Dk.Grn" and "CP001 - Camo 001". Strip a leading token that's digits
  // with an optional letter suffix, or letters followed by digits — both are codes. A
  // real colour word ("Navy - Heather") is never shaped like that, so it survives.
  s = s.replace(/^\s*(?:\d+[A-Za-z]?|[A-Za-z]{1,3}\d+)\s*[-–—]\s*/, "")
  // A trailing code in parentheses, e.g. "White (016)".
  s = s.replace(/\s*\(\s*\d+\s*\)\s*$/, "")
  if (!s) return String(raw).trim()

  // Split on "/" first (two-tone colours), then on spaces/dots inside each part.
  return s
    .split("/")
    .map((part) =>
      part
        .split(/[\s.]+/)
        .map(expandToken)
        .filter(Boolean)
        .join(" ")
    )
    .filter(Boolean)
    .join("/")
}

/**
 * A HEX FOR A COLOUR NAME — the swatch you draw when there is no photograph of that colourway.
 *
 * Three private 24-entry lookups grew for this (products-catalog, variant-field, and the
 * supplier dialog via the first). They knew "navy" and "forest" and nothing else, which was
 * survivable while every swatch had a supplier photo behind it. It stopped being survivable
 * when SanMar's stopped: their names are "Aquatic Blue", "Athletic Heather", "Deep Black" —
 * none of which matched — so forty-eight colourways all drew the same neutral grey and the
 * palette looked broken rather than unphotographed.
 *
 * Built off NAMED above, which already carries 45 colours with real RGB, so there is one
 * table rather than a fourth copy.
 *
 * MATCHED ON THE LAST COLOUR WORD, then shaded by any modifier before it. English puts the
 * noun last — "Aquatic Blue" IS a blue, "Athletic Heather" IS a heather — so the final
 * recognised word is the colour and the ones before it qualify it. A two-tone name
 * ("Black/Dark Green") takes the FIRST half, because that is the body of the garment.
 */
const HEX_BY_NAME: Record<string, string> = {
  ...Object.fromEntries(
    NAMED.map(([n, r, g, b]) => [n.toLowerCase(), `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`])
  ),
  /**
   * Garment-trade names NAMED does not carry. NAMED is the palette for SUGGESTING a name
   * from a picked hex (thread cones), so it holds generic colours; blank catalogues use a
   * different vocabulary — "Ash", "Natural", "Sport Grey", "Cardinal" — and those are the
   * ones that were falling through to neutral.
   */
  ash: "#b2b2b0", natural: "#e8e0cf", stone: "#d5cdbe", sand: "#d8cbb4", bone: "#e3ded3",
  "sport grey": "#b7b7b3", graphite: "#4b4f54", slate: "#57636e", smoke: "#8c8c8c",
  kelly: "#00875a", cardinal: "#8c2131", burgundy: "#6d2233", wine: "#5e2233",
  camo: "#4b5320", military: "#4b5320", carolina: "#7ba4db", columbia: "#8fbfe0",
  cyan: "#00b7c3", turquoise: "#30d5c8", aqua: "#5fc9d8", mustard: "#d4a017",
  chocolate: "#5c4033", espresso: "#3b2a20", clay: "#b66a50", terracotta: "#c46a4a",
  heather: "#9c9c9c", oatmeal: "#ded3c0", vintage: "#9a9287",
}
const shade = (hex: string, pct: number): string => {
  const h = hex.replace("#", "")
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16)
    return Math.max(0, Math.min(255, Math.round(v + (pct < 0 ? v : 255 - v) * (pct / 100))))
  })
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

export function colorHex(raw: string): string {
  const pretty = prettyColorName(raw)
  if (!pretty) return "#c7c4bd"
  // Two-tone: the first half is the body of the garment, the rest is trim.
  const main = pretty.split("/")[0].trim().toLowerCase()
  if (HEX_BY_NAME[main]) return HEX_BY_NAME[main]
  const words = main.split(/[\s.-]+/).filter(Boolean)
  // The last recognised colour word wins; earlier ones are modifiers.
  let base = ""
  for (const w of words) if (HEX_BY_NAME[w]) base = HEX_BY_NAME[w]
  if (!base) {
    // "Heather"/"Heathered" on its own is a grey; it is the commonest unmatched word.
    if (words.some((w) => w.startsWith("heather"))) return HEX_BY_NAME["grey"]
    return "#c7c4bd"
  }
  if (words.includes("dark") || words.includes("deep")) return shade(base, -28)
  if (words.includes("light") || words.includes("pale")) return shade(base, 34)
  if (words.some((w) => w.startsWith("heather"))) return shade(base, 22)
  return base
}

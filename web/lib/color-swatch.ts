import { prettyColorName, nearestColorName } from "@/lib/color-name"

// Suppliers give us color NAMES ("016 - White", "Black/ Stone", "Camo Green"), not hex.
// Map the common garment/cap colors to a swatch color so cards can show round swatches.
// Unknown names fall back to null (the card shows a neutral "?" swatch + the name tooltip).

const MAP: Record<string, string> = {
  black: "#111827", jet: "#111827",
  white: "#ffffff", "off white": "#f5f2ea",
  navy: "#1e293b", "navy blue": "#1e293b", midnight: "#191970",
  red: "#dc2626", cardinal: "#a5192e", scarlet: "#c8102e", maroon: "#7f1d1d", burgundy: "#6b1f2a", cranberry: "#9b1b30",
  royal: "#1d4ed8", "royal blue": "#1d4ed8", blue: "#2563eb", "sky blue": "#7dd3fc", sky: "#7dd3fc", "light blue": "#93c5fd", "carolina blue": "#5aa9e6", "columbia blue": "#87ceeb", columbia: "#87ceeb", denim: "#3b5b7c", indigo: "#3f51b5",
  green: "#16a34a", forest: "#14532d", "forest green": "#14532d", kelly: "#22c55e", "kelly green": "#22c55e", olive: "#556b2f", "olive green": "#556b2f", lime: "#84cc16", "camo green": "#6b7f4a", hunter: "#355e3b", "dk green": "#14532d", "dk.green": "#14532d", "dark green": "#14532d", "ol green": "#556b2f", "ol.green": "#556b2f", mint: "#a7f3d0",
  orange: "#ea580c", "burnt orange": "#bf5700", "texas orange": "#bf5700", coral: "#ff7f50",
  yellow: "#facc15", gold: "#d4a017", "old gold": "#c9a227", mustard: "#d4a017",
  purple: "#7c3aed", violet: "#7c3aed", lavender: "#c4b5fd",
  pink: "#ec4899", "light pink": "#f9a8d4", rose: "#f43f5e",
  teal: "#0d9488", turquoise: "#40e0d0", aqua: "#22d3ee",
  brown: "#78350f", tan: "#d2b48c", khaki: "#c3b091", sand: "#e5d3b3", natural: "#efe6d5", cream: "#fdf6e3", ivory: "#fffff0", bone: "#e3dac9", stone: "#d9d2c5", camel: "#c19a6b", coyote: "#81613c",
  gray: "#9ca3af", grey: "#9ca3af", charcoal: "#374151", "heather gray": "#b6b6b6", "heather grey": "#b6b6b6", heather: "#b6b6b6", silver: "#c0c0c0", ash: "#d1d1d1", "dark grey": "#4b5563", "dark gray": "#4b5563", "light grey": "#d1d5db", "light gray": "#d1d5db", graphite: "#3a3a3a", slate: "#64748b", steel: "#71797e", smoke: "#8a8d8f",
  // Gildan's own colourway names, which are the ones a public catalogue actually shows. A
  // name with no entry here falls back to a neutral chip AND drops out of the colour filter,
  // so 23 of the 82 colours on one tee were reading as "we don't know". Longer names go in
  // whole ("jade dome") because the substring pass runs longest-first, which is what lets
  // "Antique Jade Dome" find this rather than stopping at some shorter word.
  iris: "#5a4fcf", kiwi: "#7bb661", berry: "#a3336b", daisy: "#ffe066", lilac: "#c8a2c8",
  azalea: "#f5779e", cobalt: "#0047ab", garnet: "#733635", gravel: "#8c8c88",
  russet: "#80461b", sunset: "#fa9a50", aquatic: "#4e9cb9", cornsilk: "#fff8dc",
  sapphire: "#0f52ba", heliconia: "#e0218a", "jade dome": "#00a170", tangerine: "#f28500",
  blackberry: "#4d2d52", "prairie dust": "#c6b79b", "dark chocolate": "#3f2a1d",
  petrol: "#3e6b77",
  // Comfort Colors' garment-dyed names, which is what a Comfort Colors order line actually
  // says. None of them were here, so a run of six colourways came back six identical
  // neutrals — the chips looked deleted rather than unrecognised.
  //
  // "blue jean" is listed in its own right even though the substring pass would find "blue":
  // it is DENIM, and a bright royal-blue dot beside the word is a wrong chip, which this map
  // treats as worse than no chip at all.
  espresso: "#4b3621", pepper: "#4a4a48", moss: "#8a8b5c", watermelon: "#f2637f",
  dusk: "#7a8ba3", "blue jean": "#3b5b7c", "true navy": "#1e293b", butter: "#f3e2a9",
  yam: "#d98f4e", brick: "#8f3b32", seafoam: "#93e0c6", "light green": "#a8d5a2",
}

const ABBR: Record<string, string> = {
  blk: "black", wht: "white", nvy: "navy", chr: "charcoal", gry: "gray", grn: "green",
  brn: "brown", ylw: "yellow", org: "orange", pnk: "pink", ppl: "purple", ryl: "royal",
  "dk.grn": "forest", "lt.blue": "light blue", "dk.blue": "navy",
}

function oneHex(raw: string): string | null {
  // Expand abbreviations FIRST. Stripping the code alone left "dk. green", which fell
  // through to the substring pass and matched the generic "green" — so Dark Green and
  // Olive Green both rendered as bright green. prettyColorName turns those into
  // "Dark Green" / "Olive Green", which match their own entries before "green" is tried.
  let s = prettyColorName(raw || "").toLowerCase().replace(/®/g, "").trim()
  if (!s) s = (raw || "").toLowerCase().replace(/®/g, "").replace(/^\s*\d+\s*[-–]\s*/, "").trim()
  if (!s) return null
  if (MAP[s]) return MAP[s]
  if (ABBR[s] && MAP[ABBR[s]]) return MAP[ABBR[s]]
  // Whole-word contains a known color (longest first so "light blue" beats "blue").
  for (const k of Object.keys(MAP).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z])${k.replace(/[.]/g, "\\.")}([^a-z]|$)`).test(s)) return MAP[k]
  }
  return null
}

// A single reference hex for a colour name (the first token of a two-tone name), or null
// when we don't recognise it. Used by the product editor's auto-match to compare a colour
// name against a photo's dominant colour — a null just means "leave that one for manual".
export function swatchHex(raw: string): string | null {
  const stripped = prettyColorName(raw || "") || (raw || "")
  const first = stripped.split("/").map((p) => p.trim()).filter(Boolean)[0] || raw
  return oneHex(first)
}

// CSS background for a swatch — a solid colour, or a split gradient for a two-tone name.
export function swatchBg(raw: string): string | null {
  const stripped = prettyColorName(raw || "") || (raw || "").replace(/^\s*\d+\s*[-–]\s*/, "")
  const parts = stripped.split("/").map((p) => p.trim()).filter(Boolean)
  const hexes = parts.map(oneHex).filter(Boolean) as string[]
  if (hexes.length >= 2) return `linear-gradient(105deg, ${hexes[0]} 0 50%, ${hexes[1]} 50% 100%)`
  if (hexes.length === 1) return hexes[0]
  return oneHex(raw)
}

/** A neutral when a name places nowhere. A WRONG colour chip is worse than a plain one. */
export const NEUTRAL_CHIP = "#c7c4bd"

/**
 * The CSS for a colourway chip — the one definition, read by the catalogue grid and the
 * product page.
 *
 * Three fallbacks, in order of how much they actually tell you:
 *   1. the name resolves to a colour (or a two-tone split) — swatchBg;
 *   2. it doesn't, but the colourway has a PHOTO — a close crop of it, 340% centred, which
 *      lands inside the body of the garment on every product shot we hold. `cover` scaled a
 *      whole shirt-on-white into a 16px circle and showed mostly background;
 *   3. neutral.
 *
 * It lived privately in the catalogue grid, and the product page had a wall of NAME pills
 * instead — 82 of them on one tee. Same question, two answers, and only one of them fits.
 */
export function swatchChipStyle(name: string, image?: string | null): { background?: string; backgroundImage?: string; backgroundSize?: string } {
  const bg = swatchBg(name)
  if (bg) return { background: bg }
  if (image) return { backgroundImage: `url(${image})`, backgroundSize: "340%" }
  return { background: NEUTRAL_CHIP }
}

/**
 * A supplier colour name folded into ONE OF TWELVE FAMILIES, for filtering a catalogue.
 *
 * A catalogue-wide colour filter cannot offer the raw names: one Gildan tee alone carries 82
 * of them, and "Antique Cherry Red", "Cardinal" and "Cherry Red" are one choice to a buyer.
 *
 * MATCHED THROUGH THE HEX, NOT THE WORD. Substring-matching the name is the obvious version
 * and it silently drops products: "Royal" contains no "blue", "Kelly" no "green", "Cardinal"
 * no "red" — so filtering by Blue would have hidden every royal-blue garment we sell, which
 * is a filter that lies rather than one that narrows. Resolving the name to a hex first
 * (swatchHex, which already knows those names) and then to the nearest palette entry keeps
 * them where a buyer would look for them.
 *
 * Returns null when we can't place the name. A colour with no family is simply absent from
 * the filter rather than being guessed into the wrong one.
 */
const FAMILY_OF: Record<string, string> = {
  White: "White", Ivory: "White",
  Cream: "Cream", Beige: "Cream", Tan: "Cream", Khaki: "Cream",
  "Light Grey": "Grey", Silver: "Grey", Grey: "Grey",
  Charcoal: "Black", Black: "Black",
  Red: "Red", "Dark Red": "Red", Maroon: "Red", Crimson: "Red",
  Coral: "Pink", Salmon: "Pink", Pink: "Pink", "Light Pink": "Pink", "Hot Pink": "Pink", Magenta: "Pink",
  Orange: "Orange", Rust: "Orange",
  Gold: "Yellow", Yellow: "Yellow", "Light Yellow": "Yellow",
  Brown: "Brown", "Dark Brown": "Brown",
  Lime: "Green", Green: "Green", "Light Green": "Green", "Dark Green": "Green",
  Forest: "Green", Olive: "Green", Mint: "Green", Teal: "Green",
  "Sky Blue": "Blue", "Light Blue": "Blue", Blue: "Blue", Royal: "Blue", Navy: "Blue", Denim: "Blue",
  Lavender: "Purple", Purple: "Purple", Violet: "Purple", Indigo: "Purple",
}

/** Display order for the families, so the filter row reads as a palette rather than as
 *  whatever order the catalogue happened to mention them in. */
export const COLOR_FAMILIES = ["Black", "Grey", "White", "Cream", "Brown", "Red", "Orange",
  "Yellow", "Green", "Blue", "Purple", "Pink"] as const

export function colorFamily(raw: string): string | null {
  const hex = swatchHex(raw)
  if (!hex) return null
  return FAMILY_OF[nearestColorName(hex)] ?? null
}

/**
 * INK OR WHITE ON A SWATCH — decided, not guessed.
 *
 * A label that takes a garment's own colour cannot also fix its text colour: Natural is a
 * pale oatmeal that needs ink and Iris is a saturated violet that needs white, and picking
 * one for both leaves half the labels unreadable. WCAG relative luminance, with the usual
 * 0.5 split — the two candidates are the extremes of the range, so the crossover is where
 * their contrast ratios meet rather than anywhere subtler.
 */
export function readableOn(hex: string): "#111111" | "#FFFFFF" {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.45 ? "#111111" : "#FFFFFF"
}

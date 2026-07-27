import { prettyColorName } from "@/lib/color-name"

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

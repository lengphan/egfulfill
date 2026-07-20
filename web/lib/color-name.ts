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

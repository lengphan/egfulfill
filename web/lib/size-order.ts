/**
 * CANONICAL SIZE ORDER, for the browser.
 *
 * MIRRORS `SIZE_LADDER` / `sizeRank` / `bySize` in server/src/routes/sanmar.js — CHANGE BOTH.
 * The server sorts sizes when it folds 161,304 SDL rows into one row per style; the catalogue
 * has to reach the same answer client-side, because a size list rendered in stored order is
 * only right by luck. Same shape, same ladder, same trailing group for the unrecognised, so a
 * product cannot be ordered one way on the staff grid and another on the public page.
 *
 * Alphabetical is not an ordering here — it gives "2XL, 3XL, L, M, S, XL", which reads as a
 * scrambled list rather than a range. Neither is a supplier's own index: SanMar's SIZE_INDEX
 * restarts per price group, so S and 3XL both carry index 2.
 */

const SIZE_LADDER = ["XXXS", "XXS", "2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL",
  "5XL", "6XL", "7XL", "8XL", "9XL", "10XL"]
const LADDER_RANK = new Map(SIZE_LADDER.map((s, i) => [s, i]))
// Same garment, two spellings — keep them adjacent instead of sorting XXL far from 2XL.
LADDER_RANK.set("XXL", LADDER_RANK.get("2XL")!)
LADDER_RANK.set("XXXL", LADDER_RANK.get("3XL")!)
LADDER_RANK.set("XXXXL", LADDER_RANK.get("4XL")!)

/**
 * One size, however the supplier spelled it — "OSFA", "OSFM - Adult", "One Size", "OS".
 *
 * Caps and duffels carry these, and they are NOT a point on the ladder: putting "OSFM - Adult"
 * at the end of a range would print "S–OSFM - Adult" on a product that has one size.
 */
export function isOneSize(raw: string): boolean {
  return /^(osfa|osfm|os|one\s*size)\b/i.test(String(raw || "").trim())
}

/** [group, value, text] — compared left to right, so families stay together and only sort
 *  within themselves. Unknown sizes land in a trailing group alphabetically rather than
 *  scrambling the known ones. */
function sizeRank(raw: string): [number, number, string] {
  const s = String(raw || "").trim().toUpperCase()
  if (!s) return [99, 0, ""]
  if (s === "OSFA" || s === "OS" || s === "ONE SIZE") return [0, 0, s]
  let m
  if ((m = s.match(/^0*(\d+)M$/))) return [10, parseInt(m[1], 10), s]              // 06M, 24M
  // 2T, 5/6T. A range sorts just after the exact size it starts at, so 5T precedes 5/6T.
  if ((m = s.match(/^(\d+)(?:\/\d+)?T$/))) return [20, parseInt(m[1], 10) + (s.includes("/") ? 0.5 : 0), s]
  if ((m = s.match(/^(.+?)T$/)) && LADDER_RANK.has(m[1])) return [40, LADDER_RANK.get(m[1])!, s] // LT, 2XLT
  // SR/MR/LR are "regular" lengths — same ladder, nudged after the plain size.
  if ((m = s.match(/^(.+?)R$/)) && LADDER_RANK.has(m[1])) return [30, LADDER_RANK.get(m[1])! + 0.5, s]
  if (LADDER_RANK.has(s)) return [30, LADDER_RANK.get(s)!, s]
  if ((m = s.match(/^([A-Z0-9]+)\/[A-Z0-9]+$/)) && LADDER_RANK.has(m[1])) {        // S/M, L/XL
    return [30, LADDER_RANK.get(m[1])! + 0.25, s]
  }
  if (/^\d+$/.test(s)) return [50, parseInt(s, 10), s]                             // 3230 waist+inseam
  return [90, 0, s]
}

/** Comparator for `Array.sort` — the ladder, then everything else. */
export const bySize = (a: string, b: string): number => {
  const x = sizeRank(a), y = sizeRank(b)
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2])
}

/**
 * What a card says about sizing: "S–5XL", "One size", or a single size on its own.
 *
 * A RANGE, not the list. Eight chips of sizing on a browsing card is the information a buyer
 * wants on the product page, not the one they are scanning for in a grid — the range answers
 * "does this come in my size" in four characters, and the product page still prints every one.
 *
 * One-size tokens are held out of the range rather than sorted into it, so a style carrying
 * both doesn't end at "S–OSFM - Adult".
 */
export function sizeRangeLabel(sizes: readonly string[] | null | undefined): string {
  const clean = (sizes ?? []).map((s) => String(s || "").trim()).filter(Boolean)
  if (!clean.length) return ""
  const ladder = clean.filter((s) => !isOneSize(s))
  if (!ladder.length) return "One size"
  const sorted = [...ladder].sort(bySize)
  const first = sorted[0], last = sorted[sorted.length - 1]
  return first === last ? first : `${first}–${last}`
}

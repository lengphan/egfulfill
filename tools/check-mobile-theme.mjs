#!/usr/bin/env node
/**
 * THE MOBILE PALETTE GATE.
 *
 * `mobile/lib/theme.ts` states a contrast figure beside almost every token. A measurement
 * written in a comment is a CLAIM, and a claim with nothing executing it rots silently —
 * the file this replaces cited `tools/check-theme.mjs` on every value and that script had
 * never existed, so its numbers described a palette two generations old.
 *
 * This reads the REAL token values out of the real theme file (never a copy of them) and
 * re-measures every pair the direction depends on. It runs in two halves:
 *
 *   FLOOR   — a pair that must clear WCAG. Fails the process.
 *   SHAPE   — a pair that must NOT clear it, because the token is documented as having no
 *             shape on that ground (lime on paper, ink40 as type). A token that quietly
 *             becomes readable is a token someone is about to set a sentence in.
 *
 * Run: node tools/check-mobile-theme.mjs
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = readFileSync(join(ROOT, "mobile/lib/theme.ts"), "utf8")

/* ---- read the tokens out of the theme itself ---------------------------------------- */

/** `name: "#RRGGBB"` or `name: "rgba(r,g,b,a)"` anywhere in the file. */
function token(name) {
  const m = SRC.match(new RegExp(`\\b${name}\\s*:\\s*"([^"]+)"`))
  if (!m) throw new Error(`theme.ts no longer defines \`${name}\` — update this gate with it`)
  return m[1]
}

const T = {}
for (const n of [
  "canvas", "surface", "ink", "muted", "ink40", "hairline", "edge",
  "auraPeri", "auraLime", "auraSky", "auraLilac",
  "alert", "warn", "success", "alertTint", "warnTint", "successTint",
  "etsy", "etsyWash", "shopify", "shopifyWash", "tiktok", "tiktokWash",
  "base", "deep", "mist", "wash",
]) T[n] = token(n)
// `lime.base` and `hue.base` are both `base:` — disambiguate by block.
T.hueBase = SRC.match(/export const hue = \{[\s\S]*?base: "([^"]+)"/)[1]
T.hueDeep = SRC.match(/export const hue = \{[\s\S]*?deep: "([^"]+)"/)[1]
T.hueMist = SRC.match(/export const hue = \{[\s\S]*?mist: "([^"]+)"/)[1]
T.limeBase = SRC.match(/export const lime = \{[\s\S]*?base: "([^"]+)"/)[1]
T.limeInk = SRC.match(/export const lime = \{[\s\S]*?ink: "([^"]+)"/)[1]
T.limeWash = SRC.match(/export const lime = \{[\s\S]*?wash: "([^"]+)"/)[1]

/* ---- colour maths -------------------------------------------------------------------- */

function rgb(v) {
  const m = String(v).trim()
  const a = m.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (a) return [+a[1], +a[2], +a[3], a[4] === undefined ? 1 : +a[4]]
  let h = m.replace("#", "")
  if (h.length === 3) h = [...h].map((c) => c + c).join("")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1)
}
/** Flatten any alpha onto its ground — a translucent token's real contrast is the
 *  composite's, and reading the alpha as opaque is how `ink40` looked acceptable. */
function flatten(fg, bg) {
  const f = rgb(fg), b = rgb(bg)
  return f[3] >= 1 ? f.slice(0, 3) : [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]))
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = (c) => { const [r, g, b] = c.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
function ratio(fg, bg) {
  const f = lum(flatten(fg, bg)), b = lum(rgb(bg).slice(0, 3))
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05)
}

/* ---- what the direction promises ------------------------------------------------------ */

const PAGE = T.canvas, CARD = T.surface

/** [foreground, background, floor, why] */
const FLOOR = [
  [T.ink, PAGE, 4.5, "all type, on the page"],
  [T.ink, CARD, 4.5, "all type, on a card"],
  [T.muted, PAGE, 4.5, "secondary type on the page — 4.45 at the kit's 60% alpha"],
  [T.muted, CARD, 4.5, "secondary type on a card"],
  [T.ink, T.hueMist, 4.5, "type in the action wash"],
  [T.ink, T.limeBase, 4.5, "type on lime"],
  [T.ink, T.limeWash, 4.5, "type on the lime wash"],

  ["#FFFFFF", T.hueDeep, 4.5, "THE PRIMARY BUTTON LABEL — 3.53:1 on the kit's #6B7CFF"],
  [T.hueDeep, T.hueMist, 4.5, "periwinkle as type on its own wash"],
  [T.hueDeep, PAGE, 4.5, "periwinkle as type on the page"],
  [T.hueDeep, CARD, 4.5, "periwinkle as type on a card"],

  [T.limeInk, T.limeWash, 4.5, "the shipped mark"],
  [T.limeInk, T.limeBase, 4.5, "type on lime"],

  [T.edge, PAGE, 3, "a CONTROL boundary — WCAG 1.4.11, a field you must be able to find"],
  [T.edge, CARD, 3, "a control boundary on a card"],

  [T.alert, PAGE, 4.5, "an error sentence"],
  [T.alert, CARD, 4.5, "an error sentence on a card"],
  [T.alert, T.alertTint, 4.5, "an error on its own tint"],
  [T.warn, PAGE, 4.5, "a warning"],
  [T.warn, CARD, 4.5, "a warning on a card"],
  [T.warn, T.warnTint, 4.5, "a warning on its own tint"],
  [T.success, PAGE, 4.5, "a figure that moved the right way"],
  [T.success, CARD, 4.5, "success on a card"],
  [T.success, T.successTint, 4.5, "success on its own tint"],

  [T.etsy, T.etsyWash, 4.5, "the Etsy mark — 4.06:1 as the kit shipped it"],
  [T.etsy, PAGE, 4.5, "the Etsy mark on the page"],
  [T.shopify, T.shopifyWash, 4.5, "the Shopify mark — 3.89:1 as the kit shipped it"],
  [T.shopify, PAGE, 4.5, "the Shopify mark on the page"],
  [T.tiktok, T.tiktokWash, 4.5, "the TikTok mark"],
  [T.tiktok, PAGE, 4.5, "the TikTok mark on the page"],
]

/** Tokens documented as having NO shape on a ground. If one starts clearing the floor, the
 *  comment forbidding its use as type has quietly become false. */
const SHAPE = [
  [T.limeBase, PAGE, 3, "lime is a HIGHLIGHT — it must stay unreadable on paper so nobody sets type on it"],
  [T.ink40, PAGE, 4.5, "ink40 is NOT TEXT — the kit set inactive tab labels in it at 2.47:1"],
  [T.hairline, PAGE, 3, "the hairline is a line, not a target"],
  [T.hueBase, PAGE, 4.5, "the identity periwinkle carries no small text — that is `hueDeep`'s job"],
]

/* ---- run ------------------------------------------------------------------------------ */

let bad = 0
const fmt = (n) => n.toFixed(2).padStart(6)

console.log("FLOOR — must clear")
for (const [fg, bg, floor, why] of FLOOR) {
  const r = ratio(fg, bg)
  const ok = r >= floor
  if (!ok) bad++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${fmt(r)}:1  (>=${floor})  ${fg} on ${bg}  — ${why}`)
}

console.log("\nSHAPE — must NOT clear")
for (const [fg, bg, floor, why] of SHAPE) {
  const r = ratio(fg, bg)
  const ok = r < floor
  if (!ok) bad++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${fmt(r)}:1  (<${floor})   ${fg} on ${bg}  — ${why}`)
}

/* ---- the second half: grep the app for a colour typed by hand -------------------------- */

import { readdirSync, statSync } from "node:fs"
const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    if (e === "node_modules" || e === "dist" || e === ".expo") continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** A literal colour outside the theme is a second opinion about the palette, which is how
 *  the last direction ended up with fourteen radii and a tab bar nobody could theme. */
const ALLOW = new Set([
  "mobile/lib/theme.ts",          // the palette itself
  "mobile/components/aura.tsx",   // documents its own transparent stops
])

/**
 * FILES ALLOWED TRANSLUCENT BLACK/WHITE SCRIMS, each with its reason.
 *
 * A blanket skip would make this half of the gate decorative, so the allowance is narrow in
 * two ways: only these files, and only `rgba(0,0,0,a)` / `rgba(255,255,255,a)`. A coloured
 * literal in one of them still fails.
 *
 * Both surfaces sit over content the palette does not govern — a live camera feed and a
 * full-bleed photograph. A scrim there is not a colour choice, it is a legibility device
 * over pixels nobody controls, and a warm-paper token painted on top of a camera would be
 * the actual mistake.
 */
const SCRIM_OK = new Map([
  ["mobile/app/(tabs)/scan.tsx", "controls over a live camera feed"],
  ["mobile/components/image-peek.tsx", "a full-screen photo viewer's backdrop"],
])
const isScrim = (v) => /^rgba\(\s*(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*,\s*[\d.]+\s*\)$/.test(v.trim())
const hexes = []
for (const p of walk(join(ROOT, "mobile"))) {
  const rel = p.slice(ROOT.length + 1)
  if (ALLOW.has(rel)) continue
  const src = readFileSync(p, "utf8")
  src.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    for (const m of line.matchAll(/#[0-9A-Fa-f]{6}\b|rgba?\([^)]*\)/g)) {
      if (/^#(FFFFFF|ffffff)$/.test(m[0])) continue   // white as a literal is legible enough
      if (SCRIM_OK.has(rel) && isScrim(m[0])) continue
      hexes.push(`${rel}:${i + 1}  ${m[0].trim()}`)
    }
  })
}
console.log(`\nHAND-TYPED COLOURS outside the theme: ${hexes.length}`)
for (const h of hexes.slice(0, 20)) console.log("  " + h)
if (hexes.length > 20) console.log(`  …and ${hexes.length - 20} more`)
if (hexes.length) bad++

console.log(bad ? `\n${bad} problem(s).` : "\nAll pairs measured and holding.")
process.exit(bad ? 1 : 0)

/**
 * check-pop-presets.mjs — the contrast gate branding.js promised.
 *
 * `--pop` is the ONE accent in an otherwise chroma-0 grey system, and an admin can now swap
 * it without a deploy. That is exactly the setting that can quietly break the app, so no
 * preset ships without being MEASURED, in both themes, against two hard rules:
 *
 *   1. INK ON IT MUST BE READABLE. --pop is always a FILL carrying dark text, never a text
 *      colour and never a hairline. WCAG AA on normal text is 4.5:1; anything under that is
 *      a swatch that looks fine in a settings panel and is unreadable on the floor.
 *
 *   2. IT MUST NOT LOOK LIKE A STATUS. emerald=shipped, amber=hold, red=alert, violet=working,
 *      indigo=pending, sky=packed/info, orange=backorder, slate=draft. Those carry MEANING in
 *      a warehouse, and an accent that sits near one of them turns decoration into a false
 *      signal. The floor is measured in OKLab ΔE, which is perceptual — a hue number alone
 *      says nothing, because L and C move the distance as much as H does.
 *
 * Run: node tools/check-pop-presets.mjs
 * Reads the live token values out of web/app/globals.css, so it cannot drift from the theme.
 */
import fs from 'node:fs'

const CSS = fs.readFileSync(new URL('../web/app/globals.css', import.meta.url), 'utf8')

/* ── colour maths ─────────────────────────────────────────────────────────────── */
const oklchToOklab = (L, C, H) => [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]

function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
}
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const clamp01 = (x) => Math.min(1, Math.max(0, x))
function oklchToHex(L, C, H) {
  const [r, g, b] = oklabToLinearSrgb(...oklchToOklab(L, C, H)).map((c) => clamp01(gamma(clamp01(c))))
  return '#' + [r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}
/** WCAG relative luminance wants LINEAR light, and it clamps out-of-gamut the same way a screen does. */
function luminance(L, C, H) {
  const [r, g, b] = oklabToLinearSrgb(...oklchToOklab(L, C, H)).map(clamp01)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(...a), luminance(...b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const deltaE = (a, b) => {
  const [L1, a1, b1] = oklchToOklab(...a), [L2, a2, b2] = oklchToOklab(...b)
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2)
}

/* ── read the live theme ──────────────────────────────────────────────────────── */
/** The :root block is light; the .dark block is dark. Slice, then pull every oklch() token. */
function tokensIn(blockStart) {
  const i = CSS.indexOf(blockStart)
  if (i < 0) throw new Error(`no ${blockStart} block in globals.css`)
  // Walk to the matching close brace so a nested rule can never bleed into the next theme.
  let depth = 0, j = CSS.indexOf('{', i)
  const from = j
  for (; j < CSS.length; j++) {
    if (CSS[j] === '{') depth++
    else if (CSS[j] === '}' && --depth === 0) break
  }
  const body = CSS.slice(from, j)
  const out = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return out
}
const THEME = { light: tokensIn(':root {'), dark: tokensIn('.dark {') }

/** Everything the pop must NOT be mistaken for. */
const reserved = (t) => Object.entries(t).filter(([k]) => k.startsWith('--status-') || k === '--success')

/* ── the candidates ───────────────────────────────────────────────────────────── */
// Each is [L, C, H] per theme. Dark sits slightly lower in L and a touch higher in C, the
// same relationship the shipped coral already has, because a dark surface eats chroma.
const CANDIDATES = [
  // Hue chosen by MEASUREMENT, not by taste. A sweep of the whole circle (every hue × every
  // in-gamut L and C that keeps ink readable) says where a pop can actually live:
  //
  //   best   325–335 rose · 105–115 lime · 300–310 orchid · 215 cyan
  //   worst  30–50 — CORAL. Headroom −0.002: there is NO lightness and NO chroma at coral's
  //          hue that clears the floor in dark mode. It is boxed in by `alert` (25) on one
  //          side and `backorder` (50) on the other, and the dark palette lifts every status
  //          into the same bright band, so the gap coral has in light mode closes entirely.
  //
  // So the default is ROSE — the warm pink nearest coral that has room. It cost nothing to
  // move: --pop was defined in both themes and rendered nowhere, so this changes a colour
  // that has never once been on screen.
  //
  // AND THERE ARE ONLY TWO. Orchid (310) and Cyan (215) clear the floor in dark ONLY as pale
  // near-white tints (L 0.89, C 0.065) — the washed-out look already rejected once. The
  // reserved status vocabulary occupies most of the circle at the lightness a readable FILL
  // needs, so the accent has exactly two homes. Two vetted presets is the honest answer; a
  // longer list would be four swatches of which two quietly lie in dark mode.
  { key: 'rose', name: 'Rose', light: [0.74, 0.200, 335], dark: [0.74, 0.235, 335] },
  { key: 'lime', name: 'Lime', light: [0.89, 0.195, 112], dark: [0.89, 0.195, 112] },
]


const MIN_CONTRAST = 4.5   // WCAG AA, normal text. The pop always carries words.

/**
 * THE DISTANCE FLOOR IS MEASURED, NOT PICKED.
 *
 * `hold` (amber) and `alert` (red) are the two closest reserved colours in the product, they
 * sit side by side on the order queue every day, and nobody confuses them. So THEIR distance
 * is the proven-sufficient one — a pop at least that far from every status is at least as
 * distinguishable as a pair the floor already reads correctly. Picking a rounder, larger
 * number would have been stricter than the app's own evidence, and per theme it moves: the
 * dark palette is pushed up into one bright band, so the same pair is closer there.
 */
const floorFor = (t) => deltaE(t['--status-hold'], t['--status-alert'])

let failures = 0
for (const c of CANDIDATES) {
  const rows = []
  let ok = true
  for (const theme of ['light', 'dark']) {
    const t = THEME[theme]
    const ink = t['--pop-foreground']
    const cr = contrast(ink, c[theme])
    // Nearest reserved colour, and which one — "far from everything" is not a useful report
    // when it fails; you need the name of the thing it collides with.
    let near = { k: '—', d: Infinity }
    for (const [k, v] of reserved(t)) { const d = deltaE(c[theme], v); if (d < near.d) near = { k, d } }
    const floor = floorFor(t)
    const pass = cr >= MIN_CONTRAST && near.d >= floor
    if (!pass) ok = false
    rows.push({ theme, hex: oklchToHex(...c[theme]), cr, near, pass, floor })
  }
  if (!ok) failures++
  console.log(`\n${ok ? '✓' : '✗'} ${c.name}`)
  for (const r of rows) {
    console.log(
      `    ${r.theme.padEnd(5)} ${r.hex}  ink ${r.cr.toFixed(2)}:1${r.cr < MIN_CONTRAST ? '  ← UNREADABLE' : ''}` +
      `   nearest ${r.near.k.replace('--status-', '').replace('--', '')} ΔE ${r.near.d.toFixed(3)} (floor ${r.floor.toFixed(3)})${r.near.d < r.floor ? '  ← COLLIDES' : ''}`
    )
  }
}
console.log(`\nhold↔alert, the proven-readable pair: light ${floorFor(THEME.light).toFixed(3)} · dark ${floorFor(THEME.dark).toFixed(3)} — that is the floor.`)
console.log(`${CANDIDATES.length - failures}/${CANDIDATES.length} presets pass (ink ≥ ${MIN_CONTRAST}:1, ΔE ≥ floor from every status colour, both themes).`)
process.exit(failures ? 1 : 0)

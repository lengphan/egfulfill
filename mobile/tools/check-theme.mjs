/**
 * check-theme.mjs — the gate under mobile/lib/theme.ts.
 *
 * React Native has neither CSS custom properties nor oklch, so the house palette has to be
 * CONVERTED into literals for the phone. A converted literal is a copy, and a copy with
 * nothing checking it disagrees with the original the first time either is edited — which is
 * exactly what happened: the web moved to Workshop and this file's palette sat a full
 * generation behind it, with a different page, different rules and a status vocabulary the
 * web had already measured and retired.
 *
 * So this does two jobs, and the second is the one that catches the subtler class of bug:
 *
 *   MIRROR   every token that claims to be a web token IS that web token, converted.
 *            Read live out of web/app/globals.css, so it cannot drift from the theme.
 *   MEASURE  every contrast figure asserted in theme.ts's comments is re-measured here.
 *            CLAUDE.md §4: a measurement in a comment is only a claim. The kit's dead
 *            PLATE_ACCENT export is the precedent — it carried a note saying 6.53:1 while
 *            the real figure was 2.10:1, and survived because nothing rendered it.
 *
 * Three tokens are DERIVED rather than mirrored and are declared as such below: `warn` and
 * the three tints have no web counterpart, because the web renders status as weight rather
 * than as a tinted chip. They are measured, not matched.
 *
 * Run: node mobile/tools/check-theme.mjs
 */
import fs from 'node:fs'

const CSS = fs.readFileSync(new URL('../../web/app/globals.css', import.meta.url), 'utf8')
const THEME = fs.readFileSync(new URL('../lib/theme.ts', import.meta.url), 'utf8')

/* ── oklch → sRGB hex ─────────────────────────────────────────────────────────── */
function oklchToHex(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h), b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const f = (c) => {
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, c)) * 255)
  }
  return '#' + [
    f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    f(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    f(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/* ── contrast ─────────────────────────────────────────────────────────────────── */
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
function luminance(hex) {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4]
    .map((i) => srgbToLinear(parseInt(n.slice(i, i + 2), 16) / 255))
    .reduce((sum, v, i) => sum + [0.2126, 0.7152, 0.0722][i] * v, 0)
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}
/** A colour at `alpha` over an opaque ground — the tab bar's unlit glyph is an rgba(). */
function over(fg, alpha, bg) {
  const p = (x) => [0, 2, 4].map((i) => parseInt(x.replace('#', '').slice(i, i + 2), 16))
  const [F, B] = [p(fg), p(bg)]
  return '#' + F.map((v, i) => Math.round(v * alpha + B[i] * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('').toUpperCase()
}

/* ── THE WEB'S LIGHT PALETTE, resolved the way a browser resolves it ───────────────
 * `--brand` is declared TWICE for a page with no data-skin: once in `:root` and again in
 * `:root, [data-skin="workshop"]` further down, and the later one is what renders. Taking
 * the first match would have this gate validating a value the site never paints — the same
 * failure check-skins.mjs had when its DEFAULT_SKIN said `studio`. So blocks are walked in
 * source order and later declarations win, exactly as the cascade does.
 */
function webTokens() {
  const out = {}
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(CSS))) {
    const sel = m[1].trim()
    if (!sel.includes(':root') || sel.includes('.dark')) continue
    for (const d of m[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const raw = d[2].trim()
      const ok = raw.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
      out[d[1]] = ok ? oklchToHex(+ok[1], +ok[2], +ok[3]) : raw.toUpperCase()
    }
  }
  return out
}

/** What theme.ts actually declares, read out of the file rather than imported — this is a
 *  .ts module with no build step available to a plain node script. */
function mobileTokens() {
  const body = THEME.slice(THEME.indexOf('export const C = {'), THEME.indexOf('} as const'))
  const out = {}
  for (const m of body.matchAll(/^\s{2}([a-zA-Z]+):\s*"(#[0-9A-Fa-f]{6})"/gm)) out[m[1]] = m[2].toUpperCase()
  return out
}

const W = webTokens()
const M = mobileTokens()
let failed = 0
const fail = (msg) => { failed++; console.log(`  FAIL  ${msg}`) }

/* ── 1. MIRROR ────────────────────────────────────────────────────────────────── */
const MIRROR = {
  bg: '--background', fg: '--foreground', muted: '--muted-foreground',
  border: '--border', edge: '--input', card: '--card', accent: '--secondary',
  primary: '--primary', onPrimary: '--primary-foreground',
  brand: '--brand', onBrand: '--brand-foreground',
  ink: '--sidebar', onInk: '--sidebar-foreground', inkAccent: '--sidebar-accent',
  lit: '--sidebar-primary', onLit: '--sidebar-primary-foreground',
  pop: '--pop', onPop: '--pop-foreground',
  alert: '--status-alert', success: '--success',
}
/** Declared as OURS, with the reason. Measured below, never matched. */
const DERIVED = {
  warn: 'one lightness step below --status-hold, which is 4.18:1 on this page and so cannot set a sentence',
  alertTint: 'no web counterpart — the web renders status as weight, not as a tinted chip',
  warnTint: 'as alertTint',
  successTint: 'as alertTint',
}

console.log('MIRROR — every token that claims a web token is that token, converted')
for (const [k, v] of Object.entries(MIRROR)) {
  if (!(k in M)) { fail(`C.${k} is missing from theme.ts`); continue }
  if (!(v in W)) { fail(`${v} is missing from globals.css — did a token get renamed?`); continue }
  if (M[k] !== W[v]) fail(`C.${k} is ${M[k]}, but ${v} converts to ${W[v]}`)
}
for (const k of Object.keys(M)) {
  if (!(k in MIRROR) && !(k in DERIVED)) fail(`C.${k} is neither mirrored nor declared derived — add it to one list`)
}
if (!failed) console.log(`  ok    ${Object.keys(MIRROR).length} mirrored, ${Object.keys(DERIVED).length} derived`)

/* ── 2. MEASURE ────────────────────────────────────────────────────────────────
 * 4.5 is the AA body floor. 3.0 is WCAG 1.4.11, and it applies to a BOUNDARY or to the
 * SHAPE of a borderless fill — the two jobs that are not text. A pair with floor 0 is
 * recorded rather than gated: a card's rule is allowed to be faint, and stating the number
 * is what stops someone "fixing" it into a control edge.
 */
const P = (k) => M[k]
const PAIRS = [
  ['ink on page', P('fg'), P('bg'), 4.5],
  ['ink on card', P('fg'), P('card'), 4.5],
  ['ink on accent', P('fg'), P('accent'), 4.5],
  ['muted on page', P('muted'), P('bg'), 4.5],
  ['muted on card', P('muted'), P('card'), 4.5],
  ['muted on accent', P('muted'), P('accent'), 4.5],
  ['EDGE on page — a control boundary', P('edge'), P('bg'), 3],
  ['EDGE on card — a control boundary', P('edge'), P('card'), 3],
  ['border on page — a surface rule, faint on purpose', P('border'), P('bg'), 0],
  ['border on card — a surface rule, faint on purpose', P('border'), P('card'), 0],
  ['card on page — the value step the depth model runs on', P('card'), P('bg'), 0],
  ['onPrimary on primary', P('onPrimary'), P('primary'), 4.5],
  ['onBrand on brand', P('onBrand'), P('brand'), 4.5],
  ['brand fill on page — its own shape', P('brand'), P('bg'), 3],
  ['onInk on ink', P('onInk'), P('ink'), 4.5],
  ['ink block on page — its own shape', P('ink'), P('bg'), 3],
  ['LIT on ink', P('lit'), P('ink'), 4.5],
  ['onLit on lit', P('onLit'), P('lit'), 4.5],
  ['lit fill on ink — its own shape', P('lit'), P('ink'), 3],
  ['inkAccent on ink — a state step, not a boundary', P('inkAccent'), P('ink'), 0],
  ['onPop on pop', P('onPop'), P('pop'), 4.5],
  ['pop fill on page — 2.30:1, which is WHY it is never a borderless button on paper', P('pop'), P('bg'), 0],
  ['LIT on white — 1.67:1, which is WHY the tab bar had to become the block', P('lit'), P('card'), 0],
  ['alert on page', P('alert'), P('bg'), 4.5],
  ['alert on card', P('alert'), P('card'), 4.5],
  ['alert on its tint', P('alert'), P('alertTint'), 4.5],
  ['warn on page', P('warn'), P('bg'), 4.5],
  ['warn on card', P('warn'), P('card'), 4.5],
  ['warn on its tint', P('warn'), P('warnTint'), 4.5],
  ['success on page', P('success'), P('bg'), 4.5],
  ['success on card', P('success'), P('card'), 4.5],
  ['success on its tint', P('success'), P('successTint'), 4.5],
  ['unlit tab glyph on the bar', over(P('onInk'), 0.7, P('ink')), P('ink'), 4.5],
  ['live tab glyph on its pill', P('onLit'), P('lit'), 4.5],
]

console.log('\nMEASURE — every figure theme.ts asserts, re-measured')
for (const [name, a, b, floor] of PAIRS) {
  if (!a || !b) { fail(`${name}: a token in this pair is missing`); continue }
  const v = contrast(a, b)
  const bad = floor > 0 && v < floor
  if (bad) fail(`${name}: ${v}:1, floor ${floor}:1  (${a} on ${b})`)
  else console.log(`  ${String(v).padStart(6)}:1  ${name}${floor ? '' : '   [recorded, not gated]'}`)
}

/* ── 3. THE RULES THAT HAVE NO TOKEN ──────────────────────────────────────────── */
console.log('\nRULES')
/* Comments are stripped first. theme.ts EXPLAINS that LIFT was removed and why, so a naive
   scan of the whole file matches its own reasoning and fails on prose — which it did. */
const CODE = THEME.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
if (/\bLIFT\b|shadowRadius|shadowOpacity|shadowOffset|elevation\s*:/.test(CODE))
  fail('theme.ts declares a shadow. Workshop has none at any level — elevation is a change of background value.')
else console.log('  ok    no shadow token exists to reach for')

const radii = (THEME.match(/export const R = \{([^}]*)\}/) || [, ''])[1]
const steps = [...radii.matchAll(/([a-z]+):\s*(\d+)/g)].map((m) => m[1])
if (steps.length !== 4) fail(`R has ${steps.length} steps (${steps.join(', ')}) — the direction allows badge/control/card/pill and no fourth value`)
else console.log(`  ok    one radius scale: ${steps.join(' · ')}`)

console.log(failed ? `\n${failed} FAILED` : '\nall pass')
process.exit(failed ? 1 : 0)

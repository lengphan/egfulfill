/**
 * check-skins.mjs — the contrast gate for the SKIN presets.
 *
 * A skin is the marketing/auth palette plus `--brand`, chosen by an admin at runtime rather
 * than compiled into `bold-kit.tsx`. That is exactly the kind of setting that can quietly
 * make a page unreadable, so no skin ships without being MEASURED against the pairs it
 * actually renders:
 *
 *   ink        ON surface       4.5:1   body and display type on the page
 *   ink        ON card          4.5:1   type on a card, which is where most of a section sits
 *   accent-ink ON accent        4.5:1   the plate's own lettering
 *   acid       ON accent        4.5:1   the one bright accent, which only ever sits on the plate
 *   ink        ON acid          4.5:1   ...and the same pair inverted, as a fill carrying ink
 *   plate-accent ON accent      4.5:1   the accent word in a headline on the plate
 *   auth-muted ON surface       4.5:1   secondary type on the auth page — real text, not a hint
 *   auth-edge  ON auth-field    3.0:1   a control BOUNDARY, which is the 3:1 floor, not 4.5
 *   auth-edge  ON surface       3.0:1   ...and against the page behind it, same reason
 *
 * The 3:1 pairs are boundaries (WCAG 1.4.11), not text. Everything else is text at AA.
 *
 * It also checks bold-kit's `HEX` escape hatch against the DEFAULT skin. Those literals exist
 * for the two places a var() cannot go — an <input type="color">, and a colour that gets
 * persisted per seller — and a literal that has drifted from the palette it claims to mirror
 * is worse than no literal at all.
 *
 * Run: node tools/check-skins.mjs
 * Reads the live values out of web/app/globals.css, so it cannot drift from the theme.
 */
import fs from 'node:fs'

const CSS = fs.readFileSync(new URL('../web/app/globals.css', import.meta.url), 'utf8')
const KIT = fs.readFileSync(new URL('../web/components/marketing/bold-kit.tsx', import.meta.url), 'utf8')

/** The skin that a page with no data-skin attribute renders — the `:root` half of the pair. */
/**
 * WORKSHOP, not studio — corrected 2026-08-27.
 *
 * globals.css declares the shipping palette as `:root, [data-skin="workshop"]`, so workshop
 * is what renders when nobody has picked anything — which is almost everybody. `studio` is a
 * plain [data-skin] block and never applies unless selected.
 *
 * This constant said 'studio', so the HEX check below was measuring bold-kit's literals
 * against a palette the site does not use. It passed, and it was checking the wrong thing —
 * the same failure mode as the dead PLATE_ACCENT export this file was written to catch.
 */
const DEFAULT_SKIN = 'workshop'

/* ── colour maths ─────────────────────────────────────────────────────────────── */
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
function luminance(hex) {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(n.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/* ── read the live skins ──────────────────────────────────────────────────────── */
/**
 * Every `--mk-*` declaration inside a block, by skin key.
 *
 * The default is declared as `:root,\n[data-skin="studio"]` — one block, two selectors — so
 * matching on the selector that ENDS the list is what finds it. A skin whose block cannot be
 * found is a hard failure rather than a skip: silently measuring nothing is how a gate
 * reports success on a palette it never looked at.
 */
function skinBlock(key) {
  const re = new RegExp(`\\[data-skin="${key}"\\]\\s*\\{([^}]*)\\}`)
  const m = CSS.match(re)
  if (!m) return null
  const out = {}
  for (const [, name, value] of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim()
  return out
}

const KEYS = [...CSS.matchAll(/\[data-skin="([\w-]+)"\]/g)].map((m) => m[1])
const SKINS = [...new Set(KEYS)]
if (!SKINS.length) { console.error('FAIL  no [data-skin="…"] blocks found in globals.css'); process.exit(1) }

/* ── the pairs every skin has to clear ────────────────────────────────────────── */
const TEXT = 4.5   // WCAG AA, normal text
const EDGE = 3.0   // WCAG 1.4.11, the boundary of a UI component

const PAIRS = [
  ['--mk-ink', '--mk-surface', TEXT, 'body and display type on the page'],
  ['--mk-ink', '--mk-card', TEXT, 'type on a card, which is where most of a section sits'],
  ['--mk-accent-ink', '--mk-accent', TEXT, "the plate's lettering"],
  ['--mk-acid', '--mk-accent', TEXT, 'the accent, on the plate'],
  ['--mk-ink', '--mk-acid', TEXT, 'ink carried by an accent fill'],
  ['--mk-plate-accent', '--mk-accent', TEXT, 'the accent word in a plate headline'],
  ['--mk-auth-muted', '--mk-surface', TEXT, 'secondary type on the auth page'],
  ['--mk-auth-edge', '--mk-auth-field', EDGE, 'the field border against the field'],
  ['--mk-auth-edge', '--mk-surface', EDGE, 'the field border against the page'],
]

let failed = 0
for (const key of SKINS) {
  const t = skinBlock(key)
  if (!t) { console.error(`FAIL  ${key}: no [data-skin="${key}"] block`); failed++; continue }
  console.log(`\n${key}${key === DEFAULT_SKIN ? '  (default — also :root)' : ''}`)
  for (const [fg, bg, floor, what] of PAIRS) {
    if (!t[fg] || !t[bg]) { console.error(`  FAIL  ${fg} on ${bg} — not declared`); failed++; continue }
    // A skin that declares a var() rather than a literal cannot be measured here, and a gate
    // that shrugs at what it cannot read is not a gate.
    if (!/^#[0-9a-fA-F]{3,8}$/.test(t[fg]) || !/^#[0-9a-fA-F]{3,8}$/.test(t[bg])) {
      console.error(`  FAIL  ${fg} on ${bg} — not a hex literal (${t[fg]} on ${t[bg]})`); failed++; continue
    }
    const r = contrast(t[fg], t[bg])
    const ok = r >= floor
    if (!ok) failed++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${r.toFixed(2).padStart(6)}:1  (needs ${floor})  ${fg} on ${bg} — ${what}`)
  }
}

/* ── --brand, the app's one skinnable fill ────────────────────────────────────────
 *
 * WHY IT IS CHECKED HERE AND NOT WITH THE PAIRS ABOVE. Those are `--mk-*` hex literals and a
 * contrast ratio is the whole question. `--brand` is an oklch() and its real failure mode is
 * not contrast at all: it is RESEMBLING AN ORDER STATUS. A brand fill a seller cannot tell
 * from `pending` is not a legibility problem, it is a comprehension one, and no contrast
 * figure would ever have caught it.
 *
 * It went uncaught for exactly that reason. check-skins tested only the --mk-* pairs and
 * check-pop-presets tests the MOBILE accent, so the one token that fills every primary button
 * in the product was measured by nothing. It drifted to #7974E8 — 0.150 from pending against
 * a 0.171 floor — and was found by eye months later.
 *
 * THE FLOOR IS DERIVED, NOT DECLARED: the distance between `hold` and `alert`, a pair already
 * proven readable side by side. Same rule check-pop-presets uses, so the two gates cannot
 * disagree about what "far enough apart" means.
 *
 * BOTH THEMES, because dark lifts every status into the pale band and a value that is clear of
 * them in light can be sitting inside them in dark.
 */
const oklchOf = (v) => {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(v || '')
  return m ? [+m[1], +m[2], +m[3]] : null
}
const oklab = ([L, C, H]) => { const h = (H * Math.PI) / 180; return [L, C * Math.cos(h), C * Math.sin(h)] }
const deltaE = (a, b) => { const [x, y, z] = oklab(a), [p, q, r] = oklab(b); return Math.hypot(x - p, y - q, z - r) }
const oklchToHex = ([L, C, H]) => {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
  return '#' + rgb.map((v) => {
    const c = Math.max(0, Math.min(1, v))
    const g = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.round(g * 255).toString(16).padStart(2, '0')
  }).join('')
}
/** Every oklch token inside a block, by selector text. */
const oklchBlock = (selector) => {
  const i = CSS.indexOf(selector); if (i < 0) return null
  const body = CSS.slice(i, CSS.indexOf('\n}', i))
  const out = {}
  for (const [, k, v] of body.matchAll(/(--[\w-]+):\s*(oklch\([^)]*\))/g)) out[k] = oklchOf(v)
  return out
}
const THEME = { light: oklchBlock(':root {'), dark: oklchBlock('.dark {') }
const reserved = (t) => Object.entries(t || {}).filter(([k]) => k.startsWith('--status-') || k === '--success')

console.log('\n--brand vs the reserved order statuses')
if (!THEME.light || !THEME.dark) {
  console.error('  FAIL  could not read the :root / .dark status blocks'); failed++
} else {
  for (const key of SKINS) {
    /* The LIGHT value is the skin block's own. The DARK value is whatever a
       `.dark [data-skin="key"]` block sets — and if there is none, the skin block's value is
       what renders in dark too, because custom properties inherit from the nearer ancestor
       and [data-skin] sits inside <html class="dark">. That inheritance is precisely why the
       `--brand` in the .dark block never applied. */
    const lightRaw = (skinBlock(key) || {})['--brand']
    const darkBlk = oklchBlock(`.dark [data-skin="${key}"]`)
    const light = oklchOf(lightRaw)
    const dark = (darkBlk && darkBlk['--brand']) || light
    if (!light) { console.error(`  FAIL  ${key}: --brand is not an oklch() (${lightRaw})`); failed++; continue }
    if (!darkBlk) console.log(`  note  ${key}: no .dark override — the light value renders in dark too`)
    for (const [theme, val] of [['light', light], ['dark', dark]]) {
      const t = THEME[theme]
      const floor = deltaE(t['--status-hold'], t['--status-alert'])
      let near = { k: '', d: Infinity }
      for (const [k, v] of reserved(t)) { const d = deltaE(val, v); if (d < near.d) near = { k, d } }
      const ok = near.d >= floor
      if (!ok) failed++
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${key} ${theme.padEnd(5)} ${oklchToHex(val)}  nearest ` +
        `${near.k.replace('--status-', '').padEnd(9)} ΔE ${near.d.toFixed(3)} (floor ${floor.toFixed(3)})`)
    }
  }
}

/* ── and the literals that mirror the default ─────────────────────────────────── */
console.log('\nbold-kit HEX vs the default skin')
const dflt = skinBlock(DEFAULT_SKIN) || {}
const hexBlock = KIT.match(/export const HEX = \{([\s\S]*?)\} as const/)
if (!hexBlock) {
  console.error('  FAIL  bold-kit.tsx has no `export const HEX` block'); failed++
} else {
  const lit = {}
  for (const [, k, v] of hexBlock[1].matchAll(/(\w+)\s*:\s*"(#[0-9a-fA-F]{3,8})"/g)) lit[k] = v.toUpperCase()
  // `paper` is what sits ON the plate, which is the kit's ACCENT_INK.
  const MAP = { accent: '--mk-accent', ink: '--mk-ink', acid: '--mk-acid', surface: '--mk-surface', paper: '--mk-accent-ink' }
  for (const [name, token] of Object.entries(MAP)) {
    const want = (dflt[token] || '').toUpperCase()
    const got = lit[name]
    if (!got) { console.error(`  FAIL  HEX.${name} is missing`); failed++; continue }
    const ok = got === want
    if (!ok) failed++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  HEX.${name} = ${got}${ok ? '' : `  but ${token} is ${want}`}`)
  }
}

console.log('')
if (failed) { console.error(`${failed} failure${failed === 1 ? '' : 's'}.`); process.exit(1) }
console.log('All skins clear their floors.')

/**
 * check-i18n.mjs — TRANSLATION COVERAGE, MEASURED.
 *
 * useLabelT falls back to the English value, which is what keeps a half-translated screen
 * readable — and also what makes a gap invisible. A missing translation renders as English,
 * exactly like a string deliberately left in English (a brand name, "API", "PDF"), so the
 * only way to know what is actually untranslated is to count it. This is the same reasoning
 * as check-skins.mjs: a claim in a comment is not a measurement.
 *
 * Reads every tl("<ns>", "<english>") and t("<key>") call site under web/ and reports the
 * ones with no Vietnamese entry.
 *
 *   node tools/check-i18n.mjs          # summary + per-namespace gaps
 *   node tools/check-i18n.mjs --list   # every missing key, ready to paste into the vi dict
 *
 * Exits non-zero ONLY on a broken t() key — one with no English entry, which renders the raw
 * key ("help.title") to the user and is always a bug. Missing Vietnamese is reported, not
 * failed: the catalogue is filled in batches and English is a legitimate fallback meanwhile.
 */
import fs from 'fs'
import path from 'path'

const WEB = new URL('../web/', import.meta.url)
const WEB_DIR = path.dirname(new URL('../web/x', import.meta.url).pathname)
const LIST = process.argv.includes('--list')

const cat = fs.readFileSync(new URL('lib/i18n/catalog.ts', WEB), 'utf8')
const keysOf = (name) => {
  const start = cat.indexOf(`const ${name}: Dict = {`)
  if (start < 0) throw new Error(`no ${name} dict in catalog.ts`)
  const end = cat.indexOf('\n}', start)
  const out = new Set()
  for (const m of cat.slice(start, end).matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) out.add(JSON.parse(`"${m[1]}"`))
  return out
}
const en = keysOf('en')
const vi = keysOf('vi')

const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e.name)) files.push(p)
  }
})(WEB_DIR)

const used = new Map()
const broken = []
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const rel = path.relative(WEB_DIR, f)
  const add = (key) => { if (!used.has(key)) used.set(key, new Set()); used.get(key).add(rel) }
  for (const m of src.matchAll(/\btl\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
    add(JSON.parse(`"${m[1]}"`) + '.' + JSON.parse(`"${m[2]}"`))
  }
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    const key = JSON.parse(`"${m[1]}"`)
    if (!/^[a-zA-Z][\w]*\.[\w.]+$/.test(key)) continue   // a key, not a sentence
    add(key)
    if (!en.has(key)) broken.push({ key, file: rel })
  }
}

const missing = [...used.keys()].filter((k) => !vi.has(k)).sort()
const byNs = new Map()
for (const k of missing) {
  const ns = k.slice(0, k.indexOf('.'))
  byNs.set(ns, (byNs.get(ns) || 0) + 1)
}

const done = used.size - missing.length
const pct = used.size ? Math.round((done / used.size) * 100) : 100
console.log(`vi coverage: ${done}/${used.size} keys (${pct}%)   missing: ${missing.length}`)
if (byNs.size) {
  console.log('\nmissing by namespace:')
  for (const [ns, n] of [...byNs].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${String(n).padStart(4)}  ${ns}`)
  }
}
if (LIST && missing.length) {
  console.log('\n--- paste into the vi dict ---')
  for (const k of missing) console.log(`  ${JSON.stringify(k)}: "",`)
}
if (broken.length) {
  console.error(`\nBROKEN — t() with no English entry; this renders the raw key to the user:`)
  for (const b of broken) console.error(`  ${b.key}   ${b.file}`)
  process.exit(1)
}

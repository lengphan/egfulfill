#!/usr/bin/env node
/**
 * THE EXTENSION PARSER GATE.
 *
 * `extension/src/parse.js` is the one file that knows what Etsy's page looks like, and it is
 * the one file nobody can verify from here — there is no logged-in Shop Manager session on
 * this machine, so the SELECTORS are a best guess until someone runs it against a real page.
 *
 * What CAN be verified is everything around them, and that is most of the risk: the address
 * text parser, the receipt-id extraction, the `wanted` filter that keeps us from sending
 * addresses nobody asked for, and the validity rules that mirror the server's. A mocked test
 * that asserted "the parser was called" would be the false confidence CLAUDE.md §7 warns
 * about, so this EXECUTES the real module against documents shaped like the real thing.
 *
 * The fake document implements only the four DOM methods parse.js actually uses. If parse.js
 * starts using a fifth, this throws rather than silently returning nothing — which is the
 * correct failure, because a stub that answers every call is how a bad selector passes.
 *
 * Run: node tools/check-extension-parse.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'extension/src/parse.js'), 'utf8')

/* Load it exactly as Chrome does: a CLASSIC script that publishes onto a global. If an
   `export` ever creeps back in, this throws here — which is the whole point, because Chrome
   drops such a file silently and the symptom appears three files away. */
const globalThisShim = {}
new Function('globalThis', SRC)(globalThisShim)
const { extractOrders, isUsable } = globalThisShim.EG_PARSE || {}
if (typeof extractOrders !== 'function') {
  console.error('FAIL  parse.js did not publish EG_PARSE.extractOrders')
  process.exit(1)
}

/* ── a document, with only what parse.js touches ───────────────────────────── */

function el({ text = '', attrs = {}, href = null, children = [] }) {
  const node = {
    textContent: text,
    innerText: text,
    getAttribute: (k) => (k === 'href' ? href : (attrs[k] ?? null)),
    querySelector: (sel) => {
      if (sel.includes('a[href') && href) return node
      if (sel === 'address') return children.find((c) => c._tag === 'address') || null
      return null
    },
    querySelectorAll: (sel) => {
      if (sel.includes('data-order-id')) return children.filter((c) => c.getAttribute('data-order-id'))
      return []
    },
  }
  return node
}

function doc({ scripts = [], cards = [] }) {
  return {
    querySelectorAll: (sel) => {
      if (sel === 'script') return scripts.map((s) => ({ textContent: s }))
      if (sel.includes('data-order-id')) return cards
      throw new Error(`fake document has no rule for selector: ${sel}`)
    },
  }
}

/* ── cases ─────────────────────────────────────────────────────────────────── */

let bad = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('EMBEDDED JSON — the most stable source, so it must win')
{
  const page = doc({
    scripts: [
      'window.__data = ' + JSON.stringify({
        receipts: [{
          receipt_id: 3412410984, name: 'Pam Meriwether',
          first_line: '418 Cedar Hollow Rd', second_line: 'Apt 2B',
          city: 'Asheville', state: 'NC', zip: '28801', country_iso: 'US',
        }],
      }),
      'console.log("unrelated script with no address in it")',
    ],
  })
  const { rows, stats } = extractOrders(page, [])
  check('finds the receipt', rows.length, 1)
  check('street', rows[0] && rows[0].street, '418 Cedar Hollow Rd')
  check('street2', rows[0] && rows[0].street2, 'Apt 2B')
  check('city/state/zip', rows[0] && `${rows[0].city}|${rows[0].state}|${rows[0].zip}`, 'Asheville|NC|28801')
  check('order_id is digits only', rows[0] && rows[0].order_id, '3412410984')
  check('reports which strategy', stats.how, 'json')
}

console.log('\nTEXT FALLBACK — a card with no structured data')
{
  const card = el({
    href: '/your/orders/sold?order_id=4121410984',
    text: 'Custom Pinafore Apron\nPam Meriwether\n418 Cedar Hollow Rd\nAsheville, NC 28801',
  })
  const { rows } = extractOrders(doc({ cards: [card] }), [])
  check('finds one', rows.length, 1)
  check('name', rows[0] && rows[0].name, 'Pam Meriwether')
  check('street', rows[0] && rows[0].street, '418 Cedar Hollow Rd')
  check('city', rows[0] && rows[0].city, 'Asheville')
  check('zip', rows[0] && rows[0].zip, '28801')
}

console.log('\nAPT LINE — the unit is street2, and the name must not be eaten')
{
  const card = el({
    href: '/your/orders/sold?order_id=4121410985',
    text: 'Dana Whitfield\n418 Cedar Hollow Rd\nApt 2B\nAsheville, NC 28801',
  })
  const { rows } = extractOrders(doc({ cards: [card] }), [])
  check('street is the road', rows[0] && rows[0].street, '418 Cedar Hollow Rd')
  check('street2 is the apt', rows[0] && rows[0].street2, 'Apt 2B')
  check('name survives', rows[0] && rows[0].name, 'Dana Whitfield')
}

console.log('\nTHE `wanted` FILTER — we keep only what we asked for')
{
  const cards = [
    el({ href: '?order_id=111111111', text: 'A\n1 Main St\nAsheville, NC 28801' }),
    el({ href: '?order_id=222222222', text: 'B\n2 Main St\nAsheville, NC 28801' }),
  ]
  const all = extractOrders(doc({ cards }), [])
  check('both readable with no filter', all.rows.length, 2)
  const one = extractOrders(doc({ cards }), ['222222222'])
  check('only the wanted one is kept', one.rows.map((r) => r.order_id), ['222222222'])
  check('but the page count still reports both', one.stats.foundOnPage, 2)
}

console.log('\nVALIDITY — mirrors what the server will accept')
{
  check('rejects a 3-letter state', isUsable({ order_id: '1', street: 'x', city: 'y', state: 'NCC', zip: '' }), false)
  check('rejects a 4-digit zip', isUsable({ order_id: '1', street: 'x', city: 'y', state: 'NC', zip: '2880' }), false)
  check('accepts zip+4', isUsable({ order_id: '1', street: 'x', city: 'y', state: 'NC', zip: '28801-1234' }), true)
  check('rejects a missing street', isUsable({ order_id: '1', street: '', city: 'y', state: 'NC', zip: '28801' }), false)
  check('rejects a missing order id', isUsable({ order_id: '', street: 'x', city: 'y', state: 'NC', zip: '28801' }), false)
}

console.log('\nNOT AN ADDRESS — a product title must never become a street')
{
  const card = el({
    href: '?order_id=333333333',
    text: 'Custom Pinafore Apron with Deep Pockets, Square Cross Back\nOTTO CAP Digital Camouflage 6 Panel\nEmbroidery',
  })
  const { rows } = extractOrders(doc({ cards: [card] }), [])
  check('nothing extracted', rows.length, 0)
}

console.log('\nNO NETWORK — the reader must never fetch')
{
  const forbidden = ['fetch(', 'XMLHttpRequest', 'navigator.sendBeacon', 'import(']
  for (const f of forbidden) {
    const present = SRC.includes(f)
    if (present) bad++
    console.log(`  ${present ? 'FAIL' : 'ok  '} parse.js does not use ${f}`)
  }
}

console.log(bad ? `\n${bad} failure(s).` : '\nParser holds. NOTE: selectors are still unverified against a real Etsy page.')
process.exit(bad ? 1 : 0)

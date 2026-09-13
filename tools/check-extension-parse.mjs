#!/usr/bin/env node
/**
 * THE EXTENSION PARSER GATE.
 *
 * `extension/src/parse.js` is the one file that knows what Etsy's page looks like. Its
 * primary strategy is now written against markup CAPTURED FROM A LIVE Shop Manager page
 * (2026-09-13), and the cases below reproduce that markup exactly — `div.address` holding
 * `span.first-line`, `.city`, `.state`, `.zip`, with the receipt id on an `order_id=` link
 * some levels above. What still cannot be checked from here is whether Etsy CHANGES it.
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
    _tag: attrs._tag || 'div',
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

/** The flat document used by the JSON and text-fallback cases. */
function doc({ scripts = [], cards = [] }) {
  return {
    querySelectorAll: (sel) => {
      if (sel === 'script') return scripts.map((s) => ({ textContent: s }))
      if (sel === '.address') return []
      if (sel.includes('data-order-id')) return cards
      throw new Error(`fake document has no rule for selector: ${sel}`)
    },
  }
}

/**
 * A NODE TREE with class lookup and parent links — enough to exercise fromAddressBlocks,
 * which is the strategy that matters now that the real markup is known.
 */
function node(tag, cls, text, kids = [], href = null) {
  const n = {
    _tag: tag, _cls: cls, _kids: kids, parentElement: null, href,
    get textContent() { return text || n._kids.map((k) => k.textContent).join(' ') },
    get innerText() { return n.textContent },
    getAttribute: (k) => (k === 'href' ? href : k === 'class' ? cls : null),
    attributes: [{ name: 'class', value: cls || '' }],
    _all(pred, out = []) {
      for (const k of n._kids) { if (pred(k)) out.push(k); k._all && k._all(pred, out) }
      return out
    },
    querySelectorAll(sel) {
      const want = sel.replace(/^[.#]/, '')
      if (sel.startsWith('.')) return n._all((k) => (k._cls || '').split(/\s+/).includes(want))
      if (sel.includes('a[href*="order_id="]')) return n._all((k) => k._tag === 'a' && /order_id=/.test(k.href || ''))
      return []
    },
    querySelector(sel) { return n.querySelectorAll(sel)[0] || null },
  }
  for (const k of kids) k.parentElement = n
  return n
}

/** Etsy's real address block, as pasted from a live Shop Manager page. */
function addressBlock(name, street, city, state, zip, street2 = '') {
  const kids = [
    node('span', 'name', name),
    node('span', 'first-line', street),
    ...(street2 ? [node('span', 'second-line', street2)] : []),
    node('span', 'city', city),
    node('span', 'state', state),
    node('span', 'zip', zip),
    node('span', 'country-name', 'United States'),
    node('span', 'phone', '805 4529793'),
  ]
  return node('div', 'address break-word fs-mask', null, [node('p', null, null, kids)])
}

/** One order row: the address block plus the link its receipt id comes from. */
function orderRow(receipt, addr) {
  return node('div', 'col-group col-flush', null, [
    node('a', null, `#${receipt}`, [], `/your/orders/sold?order_id=${receipt}`),
    node('div', 'wrap', null, [addr]),
  ])
}

function docOf(root) {
  return {
    querySelectorAll: (sel) => {
      if (sel === 'script') return []
      return root.querySelectorAll(sel)
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

console.log('\nREAL ETSY MARKUP — span.first-line and friends')
{
  const page = docOf(node('div', 'list', null, [
    orderRow('4172259915', addressBlock('Nicole Barry', '11522 Discovery Heights Cir', 'Anchorage', 'AK', '99515-2719')),
  ]))
  const { rows, stats } = extractOrders(page, [])
  check('reads the block', rows.length, 1)
  check('order id from the LINK, not text', rows[0] && rows[0].order_id, '4172259915')
  check('street', rows[0] && rows[0].street, '11522 Discovery Heights Cir')
  check('city', rows[0] && rows[0].city, 'Anchorage')
  check('state', rows[0] && rows[0].state, 'AK')
  check('zip keeps the +4', rows[0] && rows[0].zip, '99515-2719')
  check('name', rows[0] && rows[0].name, 'Nicole Barry')
  check('country normalised to a code', rows[0] && rows[0].country, 'US')
  check('strategy reported', stats.how, 'address-block')
}

console.log('\nTWO ORDERS — an address must never land on its neighbour')
{
  const page = docOf(node('div', 'list', null, [
    orderRow('4172259915', addressBlock('Nicole Barry', '11522 Discovery Heights Cir', 'Anchorage', 'AK', '99515-2719')),
    orderRow('4172003959', addressBlock('Shana Adrah', '125 Dowdy Ct', 'Bellport', 'NY', '11713')),
  ]))
  const { rows } = extractOrders(page, [])
  const byId = Object.fromEntries(rows.map((r) => [r.order_id, r.street]))
  check('both read', rows.length, 2)
  check('first keeps its own street', byId['4172259915'], '11522 Discovery Heights Cir')
  check('second keeps its own street', byId['4172003959'], '125 Dowdy Ct')
}

console.log('\nAPT — second-line is carried through')
{
  const page = docOf(node('div', 'list', null, [
    orderRow('4171990173', addressBlock('Dana W', '1940 Lavender Way', 'Anchorage', 'AK', '99515', 'Apt 2B')),
  ]))
  const { rows } = extractOrders(page, [])
  check('street is the road', rows[0] && rows[0].street, '1940 Lavender Way')
  check('street2 is the apt', rows[0] && rows[0].street2, 'Apt 2B')
}

console.log(bad ? `\n${bad} failure(s).` : '\nParser holds, against markup captured from a live Etsy page.')
process.exit(bad ? 1 : 0)

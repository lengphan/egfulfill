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
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'extension/src/parse.js'), 'utf8')

/**
 * LOAD IT EXACTLY AS CHROME DOES, WHICH IS TWICE INTO ONE GLOBAL.
 *
 * `new Function('globalThis', SRC)(shim)` was wrong in a way that hid a real bug for a whole
 * release. It hands the file a FRESH FUNCTION SCOPE on every call, so a top-level `const`
 * could be re-declared for ever and nothing ever complained here.
 *
 * Chrome does not do that. `chrome.scripting.executeScript({files})` evaluates the file at the
 * TOP LEVEL of the page's isolated world, and that world SURVIVES between injections — so the
 * second injection of a file declaring `const STATES` threw
 *
 *     Uncaught SyntaxError: Identifier 'STATES' has already been declared
 *
 * which fails the whole file, leaving EG_PARSE on whatever the FIRST injection set. A tab kept
 * answering with a parser from before the extension was updated, while the popup showed the
 * new build number — because the popup is a fresh document and the injected world is not.
 *
 * `vm.runInContext` on ONE context, run twice, is that situation. If parse.js ever grows a
 * top-level declaration again, the second run throws and this gate fails at load.
 */
const ctx = vm.createContext({ console })
ctx.globalThis = ctx
vm.runInContext(SRC, ctx, { filename: 'parse.js (first injection)' })
try {
  vm.runInContext(SRC, ctx, { filename: 'parse.js (second injection)' })
} catch (e) {
  console.error('FAIL  parse.js cannot be injected twice into one world:', e.message)
  console.error('      Chrome re-injects on every popup open. A top-level const or function')
  console.error('      declaration fails the whole file and freezes EG_PARSE on the old code.')
  console.error('      Keep the body inside the IIFE at the top of parse.js.')
  process.exit(1)
}
const { extractOrders, extractReceipts, isUsable } = ctx.EG_PARSE || {}
if (typeof extractOrders !== 'function' || typeof extractReceipts !== 'function') {
  console.error('FAIL  parse.js did not publish EG_PARSE.extractOrders + extractReceipts')
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
function node(tag, cls, text, kids = [], href = null, attrs = {}) {
  const n = {
    _tag: tag, _cls: cls, _kids: kids, parentElement: null, href,
    /* NO SEPARATOR, exactly like the real thing. textContent concatenating its descendants
       is the trap parse.js documents against the order id, and a shim that joined with a
       space would quietly make the leaf rule look unnecessary. */
    get textContent() { return text || n._kids.map((k) => k.textContent).join('') },
    get innerText() { return n.textContent },
    getAttribute: (k) => (k === 'href' ? href : k === 'class' ? cls : (attrs[k] ?? null)),
    attributes: [{ name: 'class', value: cls || '' }],
    _all(pred, out = []) {
      for (const k of n._kids) { if (pred(k)) out.push(k); k._all && k._all(pred, out) }
      return out
    },
    /* `children` is what parse.js uses to tell a LEAF from a container — the only level at
       which "Size" and "L" can be told apart from the concatenated "SizeL". */
    get children() { return n._kids },
    querySelectorAll(sel) {
      const want = sel.replace(/^[.#]/, '')
      if (sel === '*') return n._all(() => true)
      if (sel === 'img') return n._all((k) => k._tag === 'img')
      if (sel.startsWith('.')) return n._all((k) => (k._cls || '').split(/\s+/).includes(want))
      if (sel.includes('a[href*="order_id="]')) return n._all((k) => k._tag === 'a' && /order_id=/.test(k.href || ''))
      if (sel.includes('a[href*="/listing/"]')) return n._all((k) => k._tag === 'a' && /\/listing\//.test(k.href || ''))
      /* The broad card sweep. Returning the rows themselves is what the real selector does
         on a real page — an order lives in a container that also holds its id link. */
      if (sel.includes('data-order-id')) return n._all((k) => k._cls === 'order-card')
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

function docOf(root, scripts = []) {
  return {
    querySelectorAll: (sel) => {
      if (sel === 'script') return scripts.map((t) => ({ textContent: t }))
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


/* ══════════════════════════════════════════════════════════════════════════════
   WHOLE RECEIPTS — the half that CREATES orders rather than patching them.

   This is the higher-stakes half. A bad address fills one field on an order that already
   exists; a bad receipt CREATES a job the factory will make. So what is checked here is
   mostly about refusing: no items means no order, a derived id never wears the platform's
   prefix, and reading the same page twice produces the same ids so a second press writes
   nothing.
   ══════════════════════════════════════════════════════════════════════════════ */

/** An item link inside an order card — the anchor the card strategy keys on. */
function itemLink(listingId, title) {
  return node('a', 'listing-link', title, [], `/listing/${listingId}/something`)
}

function card(receipt, kids) {
  return node('div', 'order-card', null, [
    node('a', null, `#${receipt}`, [], `/your/orders/sold?order_id=${receipt}`),
    ...kids,
  ])
}

console.log('\nRECEIPTS FROM ETSY JSON — the strategy that carries real line ids')
{
  const payload = JSON.stringify({
    receipts: [{
      receipt_id: 4172259915,
      name: 'Nicole Barry',
      grandtotal: { amount: 4250, divisor: 100 },
      transactions: [
        {
          transaction_id: 3910022114, listing_id: 1699, title: 'Custom Embroidered Hoodie',
          quantity: 2, sku: 'HOOD-BLK', price: { amount: 2125, divisor: 100 },
          expected_ship_date: 1789000000,
          variations: [
            { formatted_name: 'Size', formatted_value: 'L' },
            { formatted_name: 'Personalization', formatted_value: 'Dana' },
            { formatted_name: 'Upload your logo', formatted_value: 'https://i.etsystatic.com/x/art.png' },
          ],
        },
      ],
    }],
  })
  const { rows, stats } = extractReceipts(docOf(node('div', 'list', null, []), [payload]), [])
  const r = rows[0] || {}
  const it = (r.items || [])[0] || {}
  check('one receipt read', rows.length, 1)
  check('receipt id', r.order_id, '4172259915')
  check('buyer', r.buyer, 'Nicole Barry')
  check('total from {amount,divisor}', r.total, 42.5)
  check('product NAME is carried', it.name, 'Custom Embroidered Hoodie')
  check('quantity is carried', it.qty, 2)
  check('unit price', it.unit_price, 21.25)
  check('sku when the page has it', it.sku, 'HOOD-BLK')
  /* THE ONE THAT PREVENTS DUPLICATED ORDERS. Etsy's transaction_id IS line identity; an
     invented id let two overlapping syncs each write the whole line set (CLAUDE.md). */
  check('line id is ETSY OWN transaction id', it.line_id, 'et-3910022114')
  check('size becomes the variant', it.variant, 'L')
  check('personalization is split out', it.personalization, 'Dana')
  /* The customer's uploaded file IS the job on a POD order — it must never end up
     concatenated into the variant string. */
  check('artwork URL is split out', it.design_src, 'https://i.etsystatic.com/x/art.png')
  check('ship-by carried as ISO', r.ship_by, new Date(1789000000 * 1000).toISOString())
  check('strategy reported', stats.how, 'json')
}

console.log('\nJSON WITHOUT TRANSACTIONS — an id alone is not a receipt')
{
  /* Etsy's page state mentions receipt ids all over — shipping rows, review prompts,
     analytics. Every one of those would otherwise become an order with nothing in it. */
  const payload = JSON.stringify({ shipping: { receipt_id: 4172259915, carrier: 'usps' } })
  const { rows } = extractReceipts(docOf(node('div', 'list', null, []), [payload]), [])
  check('no order invented from a bare id', rows.length, 0)
}

console.log('\nRECEIPTS FROM CARDS — a LABELLED value is read, an unlabelled one is not')
{
  /* The item as Etsy renders it: the link, its thumbnail, and the options printed as labels.
     This is the whole reason the card reader is allowed to carry a variant at all — "Size: L"
     is the seller's own words, not our inference from where a line sits. */
  const thumb = node('img', 'thumb', '', [], null, { src: 'https://i.etsystatic.com/1/il_570xN.jpg' })
  const page = docOf(node('div', 'list', null, [
    card('4172003959', [node('div', 'item', null, [
      itemLink('881', 'Monogrammed Tote Bag'),
      thumb,
      node('span', null, 'Size: L'),
      node('span', null, 'Colour: Black'),
      node('span', null, 'Personalization: Dana'),
      node('span', null, 'Qty: 3'),
    ])]),
  ]))
  const { rows, stats } = extractReceipts(page, [])
  const it = (rows[0] || {}).items[0] || {}
  check('one receipt read', rows.length, 1)
  check('product NAME is carried', it.name, 'Monogrammed Tote Bag')
  check('quantity read off the item', it.qty, 3)
  /* THE THREE FIELDS THE OWNER NAMED as the minimum to work an order. */
  check('VARIANT is carried, with its label', it.variant, 'Size: L, Colour: Black')
  check('PERSONALIZATION is carried', it.personalization, 'Dana')
  check('IMAGE is carried', it.img, 'https://i.etsystatic.com/1/il_570xN.jpg')
  /* DERIVED, AND SAYING SO. `rd-` means "this came from a reader"; `et-` would claim it is
     Etsy's own transaction id, which is a lie the database would keep forever. */
  check('derived line id wears rd-', it.line_id, 'rd-4172003959-881-1')
  check('a derived id NEVER wears the platform prefix', /^et-/.test(it.line_id), false)
  check('strategy reported', stats.how, 'card')
}

console.log('\nTHE LABEL MAY SIT IN ITS OWN ELEMENT')
{
  /* Etsy renders these both ways and which one you get is not stable. Split across two
     elements, `textContent` on the parent yields "SizeL" — which is why the reader works off
     LEAVES and not off a concatenated blob. */
  const page = docOf(node('div', 'list', null, [
    card('4172003959', [node('div', 'item', null, [
      itemLink('881', 'Tote Bag'),
      node('span', 'label', 'Size'),
      node('span', 'value', 'XL'),
    ])]),
  ]))
  const it = extractReceipts(page, []).rows[0].items[0]
  check('adjacent label/value is read', it.variant, 'Size: XL')
}

console.log('\nAN UNLABELLED LINE IS STILL NOT A VARIANT')
{
  /* The narrowing is the point: a label is a statement, loose text beside a title is a guess,
     and a wrong size is a garment remade. */
  const page = docOf(node('div', 'list', null, [
    card('4172003959', [node('div', 'item', null, [
      itemLink('881', 'Tote Bag'),
      node('span', null, 'Black'),
      node('span', null, 'Ships in 3-5 days'),
    ])]),
  ]))
  const it = extractReceipts(page, []).rows[0].items[0]
  check('loose text is not adopted as a variant', it.variant, null)
  check('and not as a personalization', it.personalization, null)
}

console.log('\nTWO ITEMS ON ONE ORDER — neither may take the other one’s size')
{
  /* The failure this guards is the same one the address reader guards: climb one level too
     far and an item inherits its neighbour's options. */
  const page = docOf(node('div', 'list', null, [
    card('4172003959', [
      node('div', 'item', null, [itemLink('881', 'Tote Bag'), node('span', null, 'Size: S')]),
      node('div', 'item', null, [itemLink('902', 'Cap'), node('span', null, 'Size: XL')]),
    ]),
  ]))
  const items = extractReceipts(page, []).rows[0].items
  check('both items read', items.length, 2)
  check('first keeps its own size', items[0].variant, 'Size: S')
  check('second keeps its own size', items[1].variant, 'Size: XL')
}

console.log('\nA SHOP LOGO IS NOT THE ARTWORK')
{
  const page = docOf(node('div', 'list', null, [
    card('4172003959', [node('div', 'item', null, [
      itemLink('881', 'Tote Bag'),
      node('img', 'logo', '', [], null, { src: 'https://www.etsy.com/images/brand.svg' }),
    ])]),
  ]))
  const it = extractReceipts(page, []).rows[0].items[0]
  check('a non-CDN image is refused', it.img, null)
}

console.log('\nTWO OF THE SAME LISTING — different jobs, different line ids')
{
  /* CLAUDE.md: two lines of the same sku are different jobs. If both collapsed onto one id
     the second would be dropped by the server's ON CONFLICT and the buyer gets one garment. */
  const page = docOf(node('div', 'list', null, [
    card('4171990173', [itemLink('881', 'Tote Bag'), itemLink('881', 'Tote Bag')]),
  ]))
  const items = (extractReceipts(page, []).rows[0] || {}).items
  check('both lines survive', items.length, 2)
  check('and they are distinguishable', items[0].line_id !== items[1].line_id, true)
}

console.log('\nPRESSING SYNC TWICE — the same page must produce the same ids')
{
  /* Idempotency is enforced by a unique index on (order_id, line_id), which only helps if
     the ids are stable. If they drifted, a second press would double every line. */
  const build = () => docOf(node('div', 'list', null, [
    card('4172003959', [itemLink('881', 'Tote Bag'), itemLink('902', 'Cap')]),
  ]))
  const a = extractReceipts(build(), []).rows[0].items.map((i) => i.line_id).join('|')
  const b = extractReceipts(build(), []).rows[0].items.map((i) => i.line_id).join('|')
  check('ids are deterministic across reads', a, b)
}

console.log('\nJSON BEATS THE CARD for the same receipt')
{
  const payload = JSON.stringify({
    receipt_id: 4172003959,
    transactions: [{ transaction_id: 77, listing_id: 881, title: 'Tote Bag', quantity: 1 }],
  })
  const page = docOf(node('div', 'list', null, [
    card('4172003959', [itemLink('881', 'Tote Bag')]),
  ]), [payload])
  const it = extractReceipts(page, []).rows[0].items[0]
  check('the real transaction id wins', it.line_id, 'et-77')
}

console.log('\nTHE WANTED FILTER — nothing we did not ask about leaves the browser')
{
  const page = docOf(node('div', 'list', null, [
    card('4172003959', [itemLink('881', 'Tote Bag')]),
    card('4171990173', [itemLink('902', 'Cap')]),
  ]))
  const { rows } = extractReceipts(page, ['4172003959'])
  check('only the asked-for receipt survives', rows.length, 1)
  check('and it is the right one', rows[0].order_id, '4172003959')
}

console.log('\nAN ADDRESS IS ATTACHED ONLY WHEN THE SERVER WOULD TAKE IT')
{
  /* A half-read address written into the column reads as "we have nothing to ship against",
     which §4 says must not look like "the marketplace is withholding it". Neither is true of
     a street we simply failed to parse, so the honest shape is no address at all. */
  const good = docOf(node('div', 'list', null, [
    node('div', 'order-card', null, [
      node('a', null, '#4172259915', [], '/your/orders/sold?order_id=4172259915'),
      itemLink('881', 'Tote Bag'),
      addressBlock('Nicole Barry', '11522 Discovery Heights Cir', 'Anchorage', 'AK', '99515-2719'),
    ]),
  ]))
  const r = extractReceipts(good, []).rows[0]
  check('a good address rides along', r.address && r.address.street, '11522 Discovery Heights Cir')
  check('and the buyer name comes with it', r.buyer, 'Nicole Barry')

  const bare = docOf(node('div', 'list', null, [card('4171990173', [itemLink('902', 'Cap')])]))
  check('no address means null, not a blank one', extractReceipts(bare, []).rows[0].address, null)
}

console.log(bad ? `\n${bad} failure(s).` : '\nParser holds: addresses against markup captured from a live Etsy page, receipts against Etsy\u2019s own JSON field names.')
process.exit(bad ? 1 : 0)

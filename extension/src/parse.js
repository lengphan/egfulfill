/**
 * THE ONLY FILE THAT KNOWS WHAT ETSY'S PAGE LOOKS LIKE.
 *
 * Everything else in this extension works against `extractOrders(document)` and its shape,
 * so when Etsy changes their markup — and they will, without telling anyone — exactly one
 * file needs a fix and nothing else moves. That isolation is the whole point of this module
 * existing separately from content.js.
 *
 * IT READS THE PAGE, IT DOES NOT FETCH ONE. There is no `fetch`, no pagination, no crawl
 * anywhere in this extension. It parses a page the seller opened themselves, in their own
 * browser, in their own session — which is why it makes ZERO additional requests to Etsy.
 * A version of this that walked the order history would be a scraper; this is a reader.
 * Keep it that way: if you find yourself adding a fetch here, the answer is to ask the
 * seller to open the next page.
 *
 * THREE STRATEGIES, CHEAPEST AND MOST STABLE FIRST:
 *
 *   1. EMBEDDED JSON. Etsy ships page state in script tags. When it is there it is the
 *      best source by far — real field names, no layout guessing, and it survives a visual
 *      redesign that would break every selector below.
 *   2. STRUCTURED BLOCKS. An order card with a recognisable address block.
 *   3. TEXT FALLBACK. Parse a US address out of the card's text content.
 *
 * WHY A FALLBACK LADDER RATHER THAN ONE GOOD SELECTOR: the failure mode that matters is
 * silence. A single selector that stops matching returns zero orders and looks exactly like
 * "this page has none", and the seller has no way to tell those apart. Every strategy here
 * records WHICH one produced a row, and the popup shows it, so a break is visible as
 * "found 0 on a page with 20 orders" rather than as nothing happening.
 */

/** US state codes — used to find where a city/state/zip line is inside free text. */
const STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP',
])

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()

/**
 * The row shape `POST /api/etsy/import-addresses` expects. Named here so the server's
 * contract is written down on the client too — the endpoint validates state/zip/city and
 * silently skips a row it does not like, so a shape drift here shows up as "nothing
 * imported" rather than as an error.
 */
function row(order_id, a, how) {
  return {
    order_id: clean(order_id).replace(/[^0-9]/g, ''),
    name: clean(a.name),
    street: clean(a.street),
    street2: clean(a.street2),
    city: clean(a.city),
    state: clean(a.state).toUpperCase(),
    zip: clean(a.zip),
    country: clean(a.country) || 'US',
    _how: how,
  }
}

/** A row the server will actually accept. Checked here too so the popup can say how many
 *  were found but unusable, instead of the seller watching a count silently shrink. */
function isUsable(r) {
  if (!r.order_id || !r.street || !r.city) return false
  if (r.state && !/^[A-Z]{2}$/.test(r.state)) return false
  if (r.zip && !/^\d{5}(-\d{4})?$/.test(r.zip)) return false
  return true
}

/* ── 0. Etsy's own address block — verified against a real Shop Manager page ── */

/**
 * THE REAL MARKUP, and it is better than anything guessed:
 *
 *   <div class="address break-word fs-mask">
 *     <p><span class="name">Nicole Barry</span><br>
 *        <span class="first-line">11522 Discovery Heights Cir</span><br>
 *        <span class="city">Anchorage</span>, <span class="state">AK</span> <span class="zip">99515-2719</span><br>
 *        <span class="country-name">United States</span><br>
 *        <span class="phone">805 4529793</span></p>
 *   </div>
 *
 * Every field has a semantic class, so there is nothing to infer — no regex over a text
 * blob, no guessing which line is the street. This is now the FIRST strategy and the one
 * that should always win; the text ladder below stays only as a fallback for a future
 * redesign.
 *
 * IT IS ALREADY IN THE DOM. The Ship-to panel renders collapsed, not absent — 15 address
 * blocks were present on a page where none were visible. Nothing has to be expanded, and
 * nothing has to be clicked, which is what keeps this a reader.
 *
 * WHY THE ORDER ID IS NEVER READ FROM TEXT. `textContent` has no separators between
 * elements, so "#4172259915" followed by "1 item" concatenates into "#41722599151" — a
 * plausible-looking id that belongs to no order. Writing an address against it would put a
 * buyer's street on the wrong row, or silently nowhere. The id comes from the `order_id=`
 * LINK only.
 */
function fromAddressBlocks(doc) {
  const out = []
  for (const box of doc.querySelectorAll('.address')) {
    const pick = (cls) => {
      const e = box.querySelector('.' + cls)
      return e ? clean(e.textContent) : ''
    }
    const street = pick('first-line')
    if (!street) continue

    /*
     * FIND THE ORDER THIS ADDRESS BELONGS TO, and refuse if it is ambiguous.
     *
     * Walking up until an `order_id=` link appears is not enough on its own: a list
     * container holds every order's link, so the first ancestor that matches could hand
     * back a neighbour's id and put this buyer's street on somebody else's parcel. So the
     * ancestor is only accepted while it still contains exactly ONE address block — ours.
     * The moment a level holds two, we have climbed past the order and we stop.
     */
    let id = ''
    let n = box.parentElement
    for (let up = 0; up < 15 && n; up++, n = n.parentElement) {
      if (n.querySelectorAll('.address').length > 1) break
      const a = n.querySelector('a[href*="order_id="]')
      if (a) {
        const m = String(a.getAttribute('href') || '').match(/order_id=(\d{6,})/)
        if (m) { id = m[1]; break }
      }
    }
    if (!id) continue

    out.push(row(id, {
      name: pick('name'),
      street,
      street2: pick('second-line'),
      city: pick('city'),
      state: pick('state'),
      zip: pick('zip'),
      /* Etsy prints the country in full. The server stores whatever it is given, but every
         other writer of this column uses a code, and a column with both "US" and "United
         States" in it is one nobody can group by. */
      country: /united states/i.test(pick('country-name')) ? 'US' : pick('country-name'),
    }, 'address-block'))
  }
  return out
}

/* ── 1. embedded JSON ──────────────────────────────────────────────────────── */

/** Walk any parsed JSON looking for objects that carry both a receipt id and a street. */
function harvest(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return
  if (Array.isArray(node)) { for (const n of node) harvest(n, out, depth + 1); return }

  const id = node.receipt_id ?? node.receiptId ?? node.order_id ?? node.orderId
  const street = node.first_line ?? node.street ?? node.address_first_line ?? node.line1
  if (id != null && street) {
    out.push(row(id, {
      name: node.name ?? node.buyer_name ?? node.formatted_name,
      street,
      street2: node.second_line ?? node.street2 ?? node.address_second_line ?? node.line2,
      city: node.city,
      state: node.state ?? node.province,
      zip: node.zip ?? node.postal_code ?? node.postcode,
      country: node.country_iso ?? node.country_code ?? node.country,
    }, 'json'))
  }
  for (const k of Object.keys(node)) harvest(node[k], out, depth + 1)
}

function fromEmbeddedJson(doc) {
  const out = []
  for (const el of doc.querySelectorAll('script')) {
    const txt = el.textContent || ''
    // Only bother with blocks that mention both things we need — parsing every script on an
    // Etsy page is slow enough for the seller to notice.
    if (txt.length < 40 || !/receipt|order/i.test(txt)) continue
    if (!/first_line|street|address/i.test(txt)) continue
    // Script tags hold assignments as often as bare JSON, so take the widest {...} or [...].
    const start = txt.search(/[[{]/)
    if (start < 0) continue
    const end = Math.max(txt.lastIndexOf('}'), txt.lastIndexOf(']'))
    if (end <= start) continue
    try { harvest(JSON.parse(txt.slice(start, end + 1)), out) } catch { /* not JSON; next */ }
  }
  return out
}

/* ── 2 & 3. the rendered cards ─────────────────────────────────────────────── */

/** Pull a receipt id out of a card — from a link, an attribute, or the visible "#12345". */
function receiptIdOf(card) {
  const link = card.querySelector('a[href*="order_id="], a[href*="/orders/"], a[href*="receipt"]')
  if (link) {
    const m = String(link.getAttribute('href') || '').match(/(?:order_id=|receipt[_/-]?)(\d{6,})/i)
    if (m) return m[1]
  }
  for (const attr of ['data-order-id', 'data-receipt-id', 'data-orderid']) {
    const v = card.getAttribute && card.getAttribute(attr)
    if (v && /^\d{6,}$/.test(v)) return v
  }
  const m = (card.textContent || '').match(/#\s?(\d{9,})/)
  return m ? m[1] : ''
}

/**
 * Read a US address out of free text.
 *
 * Anchored on the CITY, STATE ZIP line rather than on the street, because that line has a
 * shape worth matching and a street does not — "418 Cedar Hollow Rd" and a product title are
 * the same thing to a regex. Everything on the line above the anchor is the street; the line
 * above that, if any, is the name.
 */
function addressFromText(text) {
  const lines = String(text || '').split('\n').map(clean).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/)
    if (!m || !STATES.has(m[2])) continue
    const prev = i >= 1 ? lines[i - 1] : ''
    if (!prev) continue
    /*
     * THE UNIT SITS DIRECTLY ABOVE THE CITY LINE, not two above it:
     *
     *   Dana Whitfield        <- name
     *   418 Cedar Hollow Rd   <- street
     *   Apt 2B                <- unit, when there is one
     *   Asheville, NC 28801   <- the anchor
     *
     * The first version of this tested the line TWO above and so, on the four-line form,
     * made "Apt 2B" the street and the street the name. Every such address would have been
     * sent to Etsy's own buyer as a label reading "Apt 2B" with no road on it — a parcel
     * that does not arrive. Caught by tools/check-extension-parse.mjs, which is the reason
     * that file exists.
     *
     * The `#` case is BOUNDED because an order number is also a hash followed by digits,
     * and "#4121410984" on the line above a city would otherwise be read as an apartment.
     */
    const isUnit = /^(apt|apartment|unit|suite|ste|fl|floor|rm|room)\b/i.test(prev)
      || /^#\s*[\w-]{1,8}$/.test(prev)
    const street = isUnit ? (i >= 2 ? lines[i - 2] : '') : prev
    if (!street) continue
    const nameAt = isUnit ? i - 3 : i - 2
    return {
      name: nameAt >= 0 ? lines[nameAt] : '',
      street,
      street2: isUnit ? prev : '',
      city: m[1], state: m[2], zip: m[3], country: 'US',
    }
  }
  return null
}

function fromCards(doc) {
  const out = []
  /* Broad on purpose. Etsy's class names are generated and change; what stays true is that
     an order lives in some container that also holds a link carrying its id. */
  const cards = doc.querySelectorAll(
    '[data-order-id], [data-receipt-id], [class*="order-card"], [class*="orderCard"], li, article, section'
  )
  const seen = new Set()
  for (const card of cards) {
    const id = receiptIdOf(card)
    if (!id || seen.has(id)) continue
    // Skip a container that merely WRAPS other cards — it would attribute the first
    // address it finds to whichever id it happened to match first.
    if (card.querySelectorAll('[data-order-id], [data-receipt-id]').length > 1) continue

    /* textContent, NOT innerText. The Ship-to panel renders collapsed, and innerText omits
       hidden elements — which is exactly why this fallback returned nothing on a page that
       had fifteen addresses sitting in the DOM. */
    const block = card.querySelector('address')
    const a = addressFromText(block ? block.textContent : card.textContent)
    if (!a) continue
    seen.add(id)
    out.push(row(id, a, block ? 'address-block' : 'text'))
  }
  return out
}

/* ── the one entry point ───────────────────────────────────────────────────── */

/**
 * Everything readable on this page, newest strategy wins per receipt.
 *
 * `wanted` is the receipt-id list from OUR API. Passing it filters the result down to the
 * orders we are actually missing, which is what keeps this honest: the extension reads the
 * page, then throws away every address we did not ask for rather than shipping the lot.
 */
function extractOrders(doc, wanted) {
  const byId = new Map()
  // Lowest confidence first so a better strategy overwrites it. The address block is last
  // because it is the only one verified against a real page.
  for (const r of fromCards(doc)) byId.set(r.order_id, r)
  for (const r of fromEmbeddedJson(doc)) byId.set(r.order_id, r)
  for (const r of fromAddressBlocks(doc)) byId.set(r.order_id, r)

  let rows = [...byId.values()].filter((r) => r.order_id)
  const found = rows.length
  if (wanted && wanted.length) {
    const keep = new Set(wanted.map(String))
    rows = rows.filter((r) => keep.has(r.order_id))
  }
  const usable = rows.filter(isUsable)
  return {
    rows: usable,
    /* Reported so a silent break is visible. "20 on the page, 0 usable" is a bug report;
       a bare 0 is indistinguishable from an empty page. */
    stats: {
      foundOnPage: found,
      matchedWanted: rows.length,
      usable: usable.length,
      how: usable.length ? usable[0]._how : null,
    },
  }
}

/**
 * PUBLISHED ON A GLOBAL, NOT EXPORTED — and this is a rule of the platform rather than a
 * style choice. A content script listed in `content_scripts.js` is loaded as a CLASSIC
 * script, so an `export` keyword is a syntax error and Chrome drops the ENTIRE file without
 * a visible message. The symptom is content.js throwing "extractOrders is not defined" on
 * a page that otherwise looks fine, which sends you hunting through selectors for a fault
 * that is one keyword in a different file.
 *
 * parse.js is listed before content.js in the manifest, so this is already assigned by the
 * time anything reads it.
 */
globalThis.EG_PARSE = { extractOrders, isUsable }

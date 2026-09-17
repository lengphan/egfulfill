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

/*
 * WRAPPED, AND THAT IS NOT STYLE — IT IS WHAT MAKES RE-INJECTION WORK.
 *
 * popup.js injects this file with chrome.scripting.executeScript EVERY time the popup opens,
 * deliberately, so the code that runs is always the code on disk. But an injected file is
 * evaluated at the TOP LEVEL of the page's isolated world, and that world SURVIVES between
 * injections. A top-level `const STATES` therefore threw
 *
 *     Uncaught SyntaxError: Identifier 'STATES' has already been declared
 *
 * on the second and every later injection — which fails the ENTIRE file, so `EG_PARSE` kept
 * whatever the FIRST injection had set. The tab went on answering with a parser from before
 * the extension was updated, for as long as that tab stayed open.
 *
 * That is a silent stale-code bug with a loud symptom somewhere else: an extension reloaded
 * to a new version, its popup showing the new build number (the popup IS a fresh document),
 * and the page still being read by the old parser. Here it looked like "the item reader finds
 * nothing" and cost a round of chasing selectors that were never the problem.
 *
 * Inside a function scope nothing is declared on the world's global, so every injection
 * re-evaluates cleanly and overwrites EG_PARSE with the current code. The gate asserts this
 * by running the file TWICE in one vm context, which is how Chrome does it — `new Function`
 * hands out a fresh scope each call and cannot see the fault.
 */
;(() => {

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


/* ══════════════════════════════════════════════════════════════════════════════
   WHOLE RECEIPTS — items, money and the promise date, not just the address.
   ══════════════════════════════════════════════════════════════════════════════

   WHY THIS EXISTS. Until now the extension could only PATCH an order the API sync had
   already created, so a seller with no connection got nothing at all. Sellers now work
   without a connection (owner, 2026-09-17), which means this file has to be able to
   describe an order well enough to MAKE one: what was bought, how many, which variant,
   what the buyer typed, what it cost and when it was promised.

   IT IS STILL A READER. Zero fetch, zero pagination, zero crawl, zero timers — the same
   rule as everything above, and `tools/check-extension-parse.mjs` asserts it. The seller
   opens their own Shop Manager page in their own session; we read the DOM that is already
   there. Nothing about reading MORE of that page changes the request profile, and that
   profile is the whole reason this approach is defensible. If you find yourself adding a
   fetch, a click, or a "load the next page" here, stop: that is the line.

   EMBEDDED JSON IS THE STRATEGY THAT MATTERS, and for items it is not a preference.
   Etsy ships receipt state into a script tag with its own field names — `transactions`,
   `transaction_id`, `listing_id`, `quantity`, `variations`. Two of those are load-bearing
   and cannot be recovered from rendered text at any quality:

     • `transaction_id` IS line identity (`et-<id>`). CLAUDE.md records that an INVENTED
       line id let two overlapping syncs each write the whole line set and over-count 18
       orders. When JSON gives us the real one we use it and the line is indistinguishable
       from a synced line.
     • `variations` is where a customer's uploaded artwork URL lives, and on a POD order
       that URL is the job.

   The DOM ladder below is a fallback, and it is honest about being one: a line it produces
   carries a DERIVED id (`etl-…`, never `et-…`) so nothing downstream can mistake it for
   Etsy's. Derived, not random — the same receipt read twice produces the same ids, which
   is what makes pressing Sync a second time a no-op instead of a duplicate. */

/** "$24.50", "24.50 USD", "US$1,204.00" → 24.5. Null when there is no number to find,
 *  because 0 and "we couldn't read the total" are different facts and only one of them
 *  should ever reach a money column. */
function money(text) {
  const m = String(text == null ? '' : text).replace(/,/g, '').match(/-?\d+(?:\.\d{1,2})?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/** Etsy's uploaded-file variations are URLs; personalisation is free text; everything else
 *  (size, colour) is the variant. Same split the server's sync performs on the API shape —
 *  kept identical ON PURPOSE so an extension-made line and a synced line are the same row.
 *  If the sync's rule changes, change this with it. */
function splitVariations(vars) {
  let upload = null, personalization = null
  const parts = []
  for (const v of vars || []) {
    const val = clean(v && (v.formatted_value ?? v.value ?? v))
    const nm = String((v && (v.formatted_name ?? v.name)) || '').toLowerCase()
    if (!val) continue
    if (/^https?:\/\//i.test(val)
      && (/upload|logo|file|image|photo|art|design/.test(nm)
        || /\.(png|jpe?g|gif|webp|svg|pdf|ai|eps|psd|tiff?)(\?|$)/i.test(val))) {
      upload = val
    } else if (nm.indexOf('personaliz') !== -1) {
      personalization = val
    } else {
      parts.push(val)
    }
  }
  return { upload, personalization, variant: parts.join(', ') || '' }
}

/**
 * A DERIVED line id, for when Etsy's own is not on the page.
 *
 * `rd-` (reader) and never `et-`: the prefix is a claim about PROVENANCE, and a derived id
 * wearing the platform's prefix is a lie that survives into the database. The server's unique
 * index covers both, so either kind is deduplicated; only one of them is Etsy's.
 *
 * IT IS PLATFORM-NEUTRAL ON PURPOSE. `line_id` is only ever unique WITHIN an order, and the
 * order id already carries the platform (`etsy-…`, `shopify-…`). So one `rd-` prefix serves
 * every marketplace a reader is ever written for, and the database index that enforces
 * idempotency never has to grow a new arm per site.
 *
 * DETERMINISTIC, because the seller will press Sync again. Receipt + listing + the running
 * count of that listing within the receipt is stable across reads, which is what makes a
 * second press write nothing rather than a second set of lines.
 */
function derivedLineId(receiptId, listingId, nth) {
  return `rd-${receiptId}-${listingId || 'x'}-${nth}`
}

function item({ line_id, listing_id, sku, name, qty, variant, personalization, unit_price, img, design_src }) {
  return {
    line_id: clean(line_id),
    listing_id: clean(listing_id) || null,
    sku: clean(sku) || null,
    name: clean(name),
    qty: Number(qty) > 0 ? Math.floor(Number(qty)) : 1,
    variant: clean(variant) || null,
    personalization: clean(personalization) || null,
    unit_price: typeof unit_price === 'number' ? unit_price : null,
    img: clean(img) || null,
    design_src: clean(design_src) || null,
  }
}

/* ── receipts from embedded JSON ───────────────────────────────────────────── */

/** Etsy's money objects are `{amount: 2450, divisor: 100}` as often as they are numbers. */
function jsonMoney(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') return money(v)
  if (typeof v === 'object' && v.amount != null) {
    const a = Number(v.amount), d = Number(v.divisor) || 100
    return Number.isFinite(a) ? a / d : null
  }
  return null
}

/**
 * Objects carrying a receipt id AND a transactions array are receipts. That pair is the
 * test rather than the id alone, because an id on its own appears all over Etsy's page
 * state — on shipping rows, on review prompts, on analytics payloads — and every one of
 * those would produce an order with nothing in it.
 */
function harvestReceipts(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return
  if (Array.isArray(node)) { for (const n of node) harvestReceipts(n, out, depth + 1); return }

  const id = node.receipt_id ?? node.receiptId
  const trs = node.transactions ?? node.receipt_transactions
  if (id != null && Array.isArray(trs) && trs.length) {
    const receiptId = clean(id).replace(/[^0-9]/g, '')
    if (receiptId) {
      const seenListing = new Map()
      const items = []
      for (const t of trs) {
        const listingId = clean(t.listing_id ?? t.listingId)
        const nth = (seenListing.get(listingId) || 0) + 1
        seenListing.set(listingId, nth)
        const { upload, personalization, variant } = splitVariations(t.variations)
        items.push(item({
          /* REAL, so this line is identical to one the API sync would have written. */
          line_id: t.transaction_id != null ? 'et-' + clean(t.transaction_id)
            : derivedLineId(receiptId, listingId, nth),
          listing_id: listingId,
          sku: t.sku,
          name: t.title ?? t.name ?? t.listing_title,
          qty: t.quantity ?? t.qty ?? 1,
          variant,
          personalization: personalization || t.personalization,
          unit_price: jsonMoney(t.price ?? t.unit_price),
          img: t.image_url_fullxfull ?? t.listing_image_url ?? t.image,
          design_src: upload,
        }))
      }
      /* The promise date is the EARLIEST across the lines, exactly as the server computes
         it from the API: a parcel that ships together is bound by the first promise, and
         meeting the latest would already have broken that one. */
      const shipBy = trs
        .map((t) => Number(t.expected_ship_date ?? t.expectedShipDate))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b)[0] || null
      out.push({
        order_id: receiptId,
        buyer: clean(node.name ?? node.buyer_name ?? node.formatted_name),
        buyer_email: clean(node.buyer_email) || null,
        total: jsonMoney(node.grandtotal ?? node.total_price ?? node.grand_total),
        ship_by: shipBy ? new Date(shipBy * 1000).toISOString() : null,
        created_at: Number(node.create_timestamp ?? node.created_timestamp) > 0
          ? new Date(Number(node.create_timestamp ?? node.created_timestamp) * 1000).toISOString() : null,
        items,
        _how: 'json',
      })
    }
  }
  for (const k of Object.keys(node)) harvestReceipts(node[k], out, depth + 1)
}

function receiptsFromJson(doc) {
  const out = []
  for (const el of doc.querySelectorAll('script')) {
    const txt = el.textContent || ''
    if (txt.length < 40 || !/receipt|transaction/i.test(txt)) continue
    const start = txt.search(/[[{]/)
    if (start < 0) continue
    const end = Math.max(txt.lastIndexOf('}'), txt.lastIndexOf(']'))
    if (end <= start) continue
    try { harvestReceipts(JSON.parse(txt.slice(start, end + 1)), out) } catch { /* not JSON; next */ }
  }
  return out
}

/* ── receipts from the rendered cards ──────────────────────────────────────── */

/**
 * A LABELLED PAIR IS A STATEMENT. UNLABELLED TEXT IS A GUESS.
 *
 * The first version of the card reader carried a name and a quantity and refused everything
 * else, on the grounds that a wrong size is a garment remade and a wrong personalisation is
 * a garment remade with somebody else's name on it. That reasoning was right about UNLABELLED
 * text and wrong about the page: Etsy prints these as LABELS — "Size: L", "Colour: Black",
 * "Personalisation: Dana" — and a label is the seller's own words, not our inference.
 *
 * So the rule is narrowed rather than abandoned: read a value only where the page NAMES it.
 * Nothing is taken from position, proximity or "the line under the title".
 *
 * BOTH RENDERINGS, because Etsy uses both and which one you get is not stable:
 *   "Size: L"  in one element          -> matched inline
 *   "Size" then "L" in two elements    -> matched as an adjacent pair
 */
const VARIANT_LABEL = /^(size|colou?r|style|material|type|design|font|scent|flavou?r|length|width|finish|placement|fabric)$/i
const PERSONALIZATION_LABEL = /^personali[sz]ation$/i

/**
 * The text of every LEAF element, in document order.
 *
 * Leaves, because `textContent` on a container concatenates its descendants with no separator
 * — the same trap that made "#4172259915" and "1 item" read as one number and is written up
 * against the order id above. A leaf holds one string, which is the only level at which
 * "Size" and "L" can be told apart from "SizeL".
 */
function textChunks(el) {
  const out = []
  for (const n of el.querySelectorAll('*')) {
    if (n.children && n.children.length) continue
    const t = clean(n.textContent)
    if (t && t.length < 300) out.push(t)
  }
  return out
}

/** Every `Label: Value` on a card, however Etsy chose to render it this week. */
function labelledPairs(el) {
  const chunks = textChunks(el)
  const pairs = []
  for (let i = 0; i < chunks.length; i++) {
    const m = chunks[i].match(/^([A-Za-z][A-Za-z ]{1,24}?)\s*:\s*(.+)$/)
    if (m) { pairs.push([clean(m[1]), clean(m[2])]); continue }
    /* Label alone, value in the next element. Only accepted for a label we RECOGNISE — any
       two adjacent strings would otherwise become a variant, which is the guessing this is
       supposed to avoid. */
    const bare = chunks[i].replace(/:$/, '').trim()
    if ((VARIANT_LABEL.test(bare) || PERSONALIZATION_LABEL.test(bare)) && chunks[i + 1]) {
      pairs.push([bare, chunks[i + 1]])
      i++
    }
  }
  return pairs
}

/**
 * THE SMALLEST CONTAINER THAT IS STILL JUST THIS ITEM.
 *
 * Walk up from the item's own link and stop the moment a level holds a SECOND item — exactly
 * the rule the address reader uses to decide which order an address belongs to, and for the
 * same reason: one level too far and this item takes the next item's size.
 */
function itemBox(link, doc) {
  let n = link.parentElement
  let best = link
  for (let up = 0; up < 6 && n; up++, n = n.parentElement) {
    if (n.querySelectorAll('a[href*="/listing/"]').length > 1) break
    best = n
  }
  return best
}

/** Etsy's own image CDN. A shop logo or an icon must not become the artwork thumbnail. */
function listingImage(box) {
  for (const im of box.querySelectorAll('img')) {
    const src = String(im.getAttribute('src') || '')
    if (/etsystatic\.com|\/il_|il_fullxfull/i.test(src)) return src
  }
  return null
}

/**
 * ITEMS OUT OF A CARD, when the page ships no usable JSON.
 *
 * ANCHORED ON THE LISTING LINK, because that is the one thing an order card cannot render
 * without: every item is a link to `/listing/<id>`. Titles, prices and quantities all live in
 * generated class names that change; the href does not.
 *
 * WHAT IS STILL NOT GUESSED: a per-line price. Money on a card is ambiguous in a way a size is
 * not — an item price, a shipping charge and an order total are all "$12.50" to a regex, and
 * charging the wrong one is worse than charging none. It arrives null and the order still
 * carries its total.
 */
function itemsFromCard(card, receiptId) {
  const out = []
  const seenListing = new Map()
  const links = card.querySelectorAll('a[href*="/listing/"]')
  for (const a of links) {
    const href = String(a.getAttribute('href') || '')
    const m = href.match(/\/listing\/(\d+)/)
    if (!m) continue
    const listingId = m[1]
    const title = clean(a.textContent)
    /* A thumbnail is also a link to the listing, and its text is empty. Skipping the empty
       one rather than the second occurrence keeps the pairing right whichever order Etsy
       renders them in. */
    if (!title) continue
    const nth = (seenListing.get(listingId) || 0) + 1
    seenListing.set(listingId, nth)

    const box = itemBox(a, card)
    let qty = 1, personalization = null
    const vparts = []
    for (const [label, value] of labelledPairs(box)) {
      if (/^(qty|quantity)$/i.test(label)) {
        const n = parseInt(value, 10)
        if (n > 0) qty = n
      } else if (PERSONALIZATION_LABEL.test(label)) {
        personalization = value
      } else if (VARIANT_LABEL.test(label)) {
        /* The LABEL is kept, not just the value. "Black" alone is a colour to a human and
           nothing to a queue; "Colour: Black" survives being read by someone who did not
           take the order. It also matches how the JSON path formats a multi-part variant. */
        vparts.push(`${label}: ${value}`)
      }
    }
    /* Quantity is also rendered unlabelled as "2 items" or "×2" on some cards. Read from the
       item's own box, never the whole card, or every line takes the first count on screen. */
    if (qty === 1) {
      const t = clean(box.textContent || '')
      const q = t.match(/(?:qty|quantity)[:\s]+(\d{1,3})\b/i) || t.match(/\u00d7\s*(\d{1,3})\b/)
      if (q && Number(q[1]) > 0) qty = Number(q[1])
    }

    out.push(item({
      line_id: derivedLineId(receiptId, listingId, nth),
      listing_id: listingId,
      name: title,
      qty,
      variant: vparts.join(', ') || null,
      personalization,
      img: listingImage(box),
    }))
  }
  return out
}

function receiptsFromCards(doc) {
  const out = []
  const cards = doc.querySelectorAll(
    '[data-order-id], [data-receipt-id], [class*="order-card"], [class*="orderCard"], li, article, section'
  )
  const seen = new Set()
  for (const card of cards) {
    const id = receiptIdOf(card)
    if (!id || seen.has(id)) continue
    if (card.querySelectorAll('[data-order-id], [data-receipt-id]').length > 1) continue
    const items = itemsFromCard(card, id)
    if (!items.length) continue
    seen.add(id)
    const text = clean(card.textContent)
    out.push({
      order_id: id,
      buyer: '',
      buyer_email: null,
      /* "Order total $24.50" — anchored on the WORD, never on the first dollar sign in the
         card, which is just as likely to be one item's price or a shipping charge. Absent
         rather than wrong: the server leaves the total alone when this is null. */
      total: money((text.match(/order total[^$\d-]{0,12}([$\d][\d.,]*)/i) || [])[1]),
      ship_by: null,
      created_at: null,
      items,
      _how: 'card',
    })
  }
  return out
}

/* ── the second entry point ────────────────────────────────────────────────── */

/**
 * EVERY RECEIPT THIS PAGE CAN DESCRIBE WELL ENOUGH TO MAKE AN ORDER FROM.
 *
 * JSON wins over cards where both saw the same receipt — it carries real transaction ids,
 * variants and artwork URLs, and a card carries a title and a count. The ADDRESS comes from
 * the existing ladder rather than being re-derived here, because that ladder is the part
 * that has been verified against a live page and there is no reason to have two readers of
 * one fact (CLAUDE.md §"One question, one function").
 *
 * `wanted` is the receipt-id list OUR server says it does not have. Passing it is what keeps
 * this honest at the same standard as the address path: the page is read, and everything we
 * did not ask about is thrown away before anything leaves the browser.
 */
function extractReceipts(doc, wanted) {
  const byId = new Map()
  for (const r of receiptsFromCards(doc)) byId.set(r.order_id, r)
  /* JSON second so it overwrites — it is strictly better wherever it is present. */
  for (const r of receiptsFromJson(doc)) {
    const prev = byId.get(r.order_id)
    /* A JSON receipt with no lines is not an upgrade on a card that found two. */
    if (prev && !r.items.length) continue
    byId.set(r.order_id, r)
  }

  /* THE ADDRESS IS THE ADDRESS LADDER'S ANSWER, not a fourth opinion. */
  const addrById = new Map()
  for (const a of fromCards(doc)) addrById.set(a.order_id, a)
  for (const a of fromEmbeddedJson(doc)) addrById.set(a.order_id, a)
  for (const a of fromAddressBlocks(doc)) addrById.set(a.order_id, a)

  let rows = [...byId.values()].filter((r) => r.order_id && r.items.length)
  const found = rows.length
  if (wanted && wanted.length) {
    const keep = new Set(wanted.map(String))
    rows = rows.filter((r) => keep.has(r.order_id))
  }
  for (const r of rows) {
    const a = addrById.get(r.order_id)
    /* Only an address the SERVER would accept is attached. A half-read one would be
       written as a street-less address, which §"masked is not missing" says must not be
       confused with an order Etsy is withholding. No address at all is the truthful shape:
       the order still lands, and it lands visibly unshippable. */
    r.address = a && isUsable(a)
      ? { name: a.name, street: a.street, street2: a.street2, city: a.city, state: a.state, zip: a.zip, country: a.country }
      : null
    if (!r.buyer && a && a.name) r.buyer = a.name
  }

  return {
    rows,
    stats: {
      foundOnPage: found,
      matchedWanted: rows.length,
      withAddress: rows.filter((r) => r.address).length,
      items: rows.reduce((n, r) => n + r.items.length, 0),
      /* WHICH STRATEGY ANSWERED, reported for the same reason it is on the address path:
         "8 receipts, all read from cards" tells you the JSON shape moved, which is a real
         degradation that would otherwise look like orders simply arriving thin. */
      how: rows.length ? rows[0]._how : null,
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
 * IT LIVES AT THE VERY BOTTOM. Function declarations hoist, so this worked from the middle
 * of the file too — right up until someone adds a `const` helper above it, at which point
 * it throws on load and Chrome reports it three files away. The end of the file is the one
 * position that cannot rot.
 */
globalThis.EG_PARSE = { extractOrders, extractReceipts, isUsable }

})()

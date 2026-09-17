/**
 * THE POPUP IS THE ONLY THING THAT TALKS TO ANYONE.
 *
 * content.js reads the page and replies; it cannot reach the network. Everything that leaves
 * this browser leaves from here, behind a button the seller pressed. There is no timer, no
 * background worker and no auto-sync anywhere in this extension — if a future version wants
 * one, that is a decision to take deliberately, not something to let drift in.
 *
 * WHY api.egful.store AND NOT THE APEX: the apex proxies /api through Vercel, which caps a
 * request body at ~4.5MB and sits behind Cloudflare's ~100s ceiling. api.egful.store is the
 * direct origin, which is exactly what it exists for (CLAUDE.md §3). An address batch is
 * small, but there is no reason to route it through two extra hops.
 */
const API = 'https://api.egful.store'
const APP = 'https://app.egful.store'

const $ = (id) => document.getElementById(id)
const show = (el, on) => { el.hidden = !on }

let TOKEN = null
let WANTED = []          // receipt ids OUR server says are missing an address
let ROWS = []            // addresses the current page can supply for orders we already have
let NEW_ORDERS = []      // whole orders the page describes that we do not have at all
let OPEN_PEEK = false    // is the "what will be sent" list open? Dies with the popup.

/**
 * THE MARKETPLACE THIS BUILD CAN READ.
 *
 * One constant rather than `etsy` typed at four call sites, because the server route is
 * platform-generic (`/api/reader/:platform/…`) and the day a second parser lands this is the
 * line that moves. It is NOT a promise that other marketplaces work — a platform is only
 * real once extension/src/parse.js can describe its page.
 */
const PLATFORM = 'etsy'

function fail(msg) {
  const el = $('err')
  el.textContent = msg
  show(el, !!msg)
}

/* ── the token ─────────────────────────────────────────────────────────────── */

/**
 * READ THE SELLER'S OWN TOKEN FROM THE SELLER'S OWN TAB.
 *
 * No password is ever typed into this extension. The seller signs in to egful the
 * normal way and presses Connect; this reads the session their browser is already holding,
 * from our own origin, once, and keeps it in extension storage.
 *
 * BOTH STORES, because the app's "remember me" checkbox decides which one it used —
 * localStorage when remembered, sessionStorage when not (web/lib/auth.ts). Reading only
 * localStorage would work for most people and mysteriously fail for anyone who left the box
 * unticked, which is the worst kind of bug to chase.
 */
async function connect() {
  fail('')
  let tab
  const open = await chrome.tabs.query({ url: `${APP}/*` })
  if (open.length) {
    tab = open[0]
  } else {
    tab = await chrome.tabs.create({ url: APP, active: true })
    // Give the app a moment to boot and restore its session before reading storage.
    await new Promise((r) => setTimeout(r, 2500))
  }

  let got
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const read = (s) => { try { return s.getItem('eg_token') } catch { return null } }
        const user = (s) => { try { return s.getItem('eg_user') } catch { return null } }
        return {
          token: read(localStorage) || read(sessionStorage),
          user: user(localStorage) || user(sessionStorage),
        }
      },
    })
    got = res && res.result
  } catch (e) {
    return fail('Could not read your egful session. Open app.egful.store, sign in, then press Connect again.')
  }

  if (!got || !got.token) {
    return fail('You are not signed in to egful in this browser. Sign in there first, then press Connect.')
  }

  let name = ''
  try { name = (JSON.parse(got.user || '{}') || {}).name || '' } catch { /* a label, not data */ }
  await chrome.storage.local.set({ token: got.token, who: name })
  TOKEN = got.token
  $('who').textContent = name
  await start()
}

/* ── our API ───────────────────────────────────────────────────────────────── */

async function api(path, init) {
  const r = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...(init || {}).headers },
  })
  if (r.status === 401 || r.status === 403) {
    /* The token died. Drop it rather than leaving the seller pressing a button that will
       never work — a stale credential that fails silently is the thing that makes people
       reinstall an extension that was fine. */
    await chrome.storage.local.remove(['token', 'who'])
    TOKEN = null
    render()
    throw new Error('Your egful session expired. Press Connect again.')
  }
  if (!r.ok) throw new Error(`egful didn’t answer (${r.status})`)
  return r.json()
}

/* ── the page ──────────────────────────────────────────────────────────────── */

/**
 * THE FOOTER SAYS THE BUILD, AND SPEAKS UP ONLY WHEN SOMETHING IS WRONG.
 *
 * It read `1 seen · 0 to send · address-block · v0.1.4` under a panel that had already said
 * "Nothing to send from this page — the orders on this page already have addresses". Four
 * facts in the factory's own vocabulary, restating in jargon what the two lines above said
 * in words, on a page where nothing was wrong. `address-block` in particular is the name of
 * a PARSING STRATEGY: it means something to whoever edits parse.js and nothing at all to
 * the person pressing Sync.
 *
 * So the resting state is the build number, which is the one thing the panel cannot say for
 * itself and the thing you look at to answer "did my change load". The counts have not gone
 * anywhere: they are the element's `title`, a hover away, and they come back into the line
 * itself for the one case that is actionable — addresses found on the page that could not be
 * read, which is a real answer to "why didn't it pick up that order".
 *
 * A page that reads ZERO is left to the panel above, which says "No orders found here" and
 * tells you where to look. That is the one reading a broken selector shares with an empty
 * page — and the hover, which says `0 found`, is where that gets diagnosed.
 */
function statsLine(s, toSend) {
  const found = s.foundOnPage || 0
  const bad = found - (s.usable || 0)
  const ver = `v${chrome.runtime.getManifest().version}`
  /* Short enough to sit on one line beside Disconnect. "3 of 12 couldn\u2019t be read" was a
     sentence where a count would do \u2014 and it described the reading rather than the
     consequence, which is that those orders are not coming in. */
  if (found && bad > 0) return `${bad} Can\u2019t Sync \u00b7 ${ver}`
  return ver
}

/**
 * WHERE THE ORDERS WERE READ FROM, IN THE SELLER'S WORDS.
 *
 * `s.how` is the name of a PARSING STRATEGY — `json`, `card`, `address-block`. Those mean
 * something to whoever edits parse.js and nothing at all to the person pressing Sync, and
 * the panel used to print them raw. The diagnostic value is real (knowing Etsy's own data
 * stopped being available is how a quiet degradation gets caught), so it is translated
 * rather than dropped: the same fact, in words that answer "where did this come from".
 */
const SOURCE_WORDS = {
  json: 'Etsy Data',
  card: 'Order List',
  'address-block': 'Address Panel',
  text: 'Page Text',
}

/* The full reading, for whoever is looking for it. Kept off the face of the panel and on
   the element, so the detail survives without being read aloud on every healthy page.
   NO PARSER VOCABULARY HERE. "unreadable", "usable", "rows" and a strategy name are words
   from inside this codebase; the person hovering runs a shop. Every line says what happened
   to their orders, and the one that matters is the count we could not read \u2014 that is the
   real answer to "why didn't it pick up that order". */
function statsTitle(s, toSend) {
  const found = s.foundOnPage || 0
  const bits = [`${found} ${found === 1 ? 'Order' : 'Orders'}`, `${toSend} To Send`]
  const bad = found - (s.usable || 0)
  if (bad > 0) bits.push(`${bad} Can\u2019t Sync`)
  if (s.how) bits.push(SOURCE_WORDS[s.how] || 'From The Page')
  return bits.join(' \u00b7 ')
}

/**
 * ONE PLACE DECIDES WHAT THE PANEL SAYS, and it is short on purpose.
 *
 * The wording used to be assembled at four call sites, each adding its own sentence — so
 * the panel explained the page, explained the explanation, and then printed a strategy name
 * in the footer. A line, at most one button, and at most one sentence under it: past that,
 * every extra word is read on every visit forever.
 *
 * `button` names which of the two is shown, or none. A disabled button invites a press,
 * and this panel spends most of its life with nothing to press.
 */
function paint({ line, note = '', button = null, peek = 0 }) {
  $('count').textContent = line
  $('note').textContent = note
  show($('note'), !!note)
  show($('sync'), button === 'sync')
  show($('open'), button === 'open')
  show($('peek'), peek > 0)
  if (peek > 0) {
    $('peek').textContent = OPEN_PEEK ? 'Hide' : `Show ${peek}`
    show($('rows'), OPEN_PEEK)
  } else {
    OPEN_PEEK = false
    show($('rows'), false)
  }
}

/**
 * WHAT IS ABOUT TO BE SENT, ON REQUEST — and never written anywhere.
 *
 * These are the rows already parsed into memory for the request, so drawing them costs no
 * storage and discloses nothing new: they are on the Etsy page behind this panel. The list
 * is built on each open and dies with the popup. Collapsed by default, because a buyer's
 * home address on a factory floor is an over-the-shoulder problem, not a UI one.
 */
function drawRows() {
  const ul = $('rows')
  ul.textContent = ''
  const add = (title, detail) => {
    const li = document.createElement('li')
    const nm = document.createElement('div')
    nm.className = 'nm'
    nm.textContent = title
    const ad = document.createElement('div')
    ad.className = 'ad'
    ad.textContent = detail
    ad.title = detail                     // the full thing for the one that is truncated
    li.append(nm, ad)
    ul.appendChild(li)
  }
  /* NEW ORDERS FIRST — they are the larger claim. "We are about to create this" deserves to
     be read before "we are about to fill in a street", and a seller checking this list is
     almost always checking the creations. */
  for (const r of NEW_ORDERS) {
    /* THE ITEM NAMES, not a count. "2 items" is the shape of a row nobody can verify; the
       titles are what let a seller recognise the order as theirs at a glance — which is the
       entire reason this list can be opened. */
    const names = r.items.map((i) => (i.qty > 1 ? `${i.qty}× ` : '') + i.name).join(' · ')
    add(r.buyer || `Order ${r.order_id}`, names)
  }
  for (const r of ROWS) {
    add(r.name || `Order ${r.order_id}`,
      [r.street, r.street2, [r.city, r.state].filter(Boolean).join(' '), r.zip].filter(Boolean).join(', '))
  }
}

async function scan() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !/^https:\/\/www\.etsy\.com\/your\/orders/.test(tab.url || '')) {
    ROWS = []; NEW_ORDERS = []
    paint({ line: 'Wrong Page', note: 'Orders & Shipping', button: 'open' })
    /* The build still shows. It is the answer to "is my change loaded", and that question
       gets asked most often on the page where nothing else is happening. */
    $('stats').textContent = `v${chrome.runtime.getManifest().version}`
    $('stats').title = ''
    return
  }

  /*
   * READ THE PAGE FIRST, THEN ASK ABOUT WHAT IS ON IT.
   *
   * The first version asked egful for "everything you are missing" and filtered the
   * page against that. For a staff user that list spans every seller and is capped, so a
   * shop's own orders could sit outside the window and the extension would report nothing
   * to do — indistinguishable from everything being filled already. Asking about the
   * receipts actually on screen removes the cap and the ambiguity, and it means we disclose
   * nothing about orders the seller is not already looking at.
   */
  /*
   * INJECTED ON DEMAND, NOT DECLARED AS A CONTENT SCRIPT.
   *
   * A declared content script is injected when the PAGE loads, and Chrome keeps the copy it
   * already injected until the EXTENSION is reloaded. So "I reloaded the page" and "the new
   * code is running" are different facts, and the gap between them looks exactly like a
   * parser that does not work — which is precisely the hour this cost. Injecting here means
   * the code that runs is always the code on disk, and there is no reload-the-tab step to
   * forget.
   *
   * It also reads BETTER: nothing is present on an Etsy page until the moment the seller
   * opens this popup and asks. Before that the extension is inert on every page.
   */
  let res
  try {
    const target = { tabId: tab.id }
    // Two calls, same isolated world: the first defines EG_PARSE, the second uses it.
    await chrome.scripting.executeScript({ target, files: ['src/parse.js'] })
    const [out] = await chrome.scripting.executeScript({
      target,
      func: () => {
        try {
          const p = globalThis.EG_PARSE
          if (!p) return { ok: false, error: 'parser did not load' }
          /* BOTH READS, ONE INJECTION. They answer different questions — "what address does
             this page hold" and "what order does this page describe" — and running them in
             one pass means the popup compares two views of the SAME DOM. Two injections
             could straddle a re-render and disagree about which orders are on screen. */
          const { rows, stats } = p.extractOrders(document, [])
          const full = p.extractReceipts ? p.extractReceipts(document, []) : { rows: [], stats: {} }
          return { ok: true, rows, stats: { ...stats, ...full.stats, usable: stats.usable }, receipts: full.rows }
        } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
      },
    })
    res = out && out.result
  } catch (e) {
    return fail(`Could not read that page: ${String((e && e.message) || e)}`)
  }
  if (!res || !res.ok) return fail((res && res.error) || 'Could not read that page.')

  const addressesOnPage = res.rows || []
  const receiptsOnPage = res.receipts || []
  const s = res.stats || {}

  /*
   * NOTHING READABLE AT ALL. Kept distinct from "read it, and we already have all of it" —
   * §4: if a thing can't be READ versus doesn't EXIST, say which. A seller staring at a page
   * full of orders while this says "nothing here" needs to know which of the two it means,
   * because only one of them is something they can act on.
   */
  if (!addressesOnPage.length && !receiptsOnPage.length) {
    ROWS = []; NEW_ORDERS = []
    /* THE COUNT IS THE MESSAGE. "None could be read" and "No orders here" were two
       sentences saying which of the two had happened; `12 Orders Can\u2019t Sync` says it AND
       says how many are stranded, which is the number the seller actually needs. */
    paint((s.foundOnPage || 0) > 0
      ? { line: `${s.foundOnPage} ${s.foundOnPage === 1 ? 'Order' : 'Orders'} Can\u2019t Sync` }
      : { line: 'No Orders' })
    $('stats').textContent = statsLine(s, 0)
    $('stats').title = statsTitle(s, 0)
    return
  }

  /*
   * ASK ABOUT THE RECEIPTS ON SCREEN, never "what are you missing".
   *
   * Same reasoning as before and it now matters more: this decides what gets CREATED, so an
   * unbounded "everything you don't have" would be a client inventing orders against a list
   * it did not read. The seller's own page is the only source of receipt ids here.
   */
  const ids = [...new Set([...receiptsOnPage.map((r) => r.order_id), ...addressesOnPage.map((r) => r.order_id)])]
  let known = new Set(), blankAddress = new Set()
  try {
    const ask = await api(`/api/reader/${PLATFORM}/known`, {
      method: 'POST',
      body: JSON.stringify({ receipts: ids }),
    })
    known = new Set((ask.known || []).map(String))
    blankAddress = new Set((ask.blankAddress || []).map(String))
  } catch (e) {
    return fail(e.message)
  }

  /*
   * TWO DISJOINT PILES, and the split is what keeps each path doing the job it is good at.
   *
   *   • NEW_ORDERS — the page describes it and we have never seen it. These get CREATED,
   *     address included, by the reader route.
   *   • ROWS — we already hold the order and it has no address. These go through the
   *     ADDRESS route, which is the one strategy verified against a live Shop Manager page.
   *
   * Disjoint by construction (`known` decides), so no receipt is written twice and the two
   * counts on the panel always add up to what is about to happen.
   */
  NEW_ORDERS = receiptsOnPage.filter((r) => !known.has(String(r.order_id)))
  ROWS = addressesOnPage.filter((r) => blankAddress.has(String(r.order_id)))

  WANTED = [...blankAddress]
  drawRows()

  const bits = []
  if (NEW_ORDERS.length) bits.push(`${NEW_ORDERS.length} ${NEW_ORDERS.length === 1 ? 'Order' : 'Orders'}`)
  if (ROWS.length) bits.push(`${ROWS.length} ${ROWS.length === 1 ? 'Address' : 'Addresses'}`)
  const peek = NEW_ORDERS.length + ROWS.length

  paint(peek
    ? { line: bits.join(' · '), button: 'sync', peek }
    : { line: 'Nothing New' })

  /* SAY WHAT WAS SEEN, not just what survived. "20 on page, 0 usable" is a bug report that
     can be acted on; a bare 0 is indistinguishable from an empty page, which is how a
     broken selector hides for weeks. */
  $('stats').textContent = statsLine(s, peek)
  $('stats').title = statsTitle(s, peek)
}

async function start() {
  fail('')
  render()
  if (!TOKEN) return
  await scan()
}

/**
 * CREATE, THEN FILL — in that order, and the order matters.
 *
 * The two piles are disjoint, so neither call can touch the other's receipts. But if the
 * creation fails the addresses are still worth sending, and if the addresses fail the orders
 * are already in. Running them in sequence and reporting BOTH outcomes is what keeps a
 * half-success from reading as a total failure and sending someone to press it again.
 */
async function sync() {
  if (!ROWS.length && !NEW_ORDERS.length) return
  $('sync').disabled = true
  $('sync').textContent = 'Syncing…'
  const said = []
  let trouble = ''
  try {
    if (NEW_ORDERS.length) {
      /* Send only what the route reads. `_how` is a diagnostic this side and has no business
         in a request body. */
      const orders = NEW_ORDERS.map(({ order_id, buyer, buyer_email, total, ship_by, created_at, address, items }) =>
        ({ order_id, buyer, buyer_email, total, ship_by, created_at, address, items }))
      try {
        const res = await api(`/api/reader/${PLATFORM}/import`, { method: 'POST', body: JSON.stringify({ rows: orders }) })
        /* THE SELLER'S WORDS, NOT THE ROUTE'S. The server returns `created`, `existed`,
           `skipped`, `notYours` — field names, and two of them are meaningless to whoever
           pressed the button. "skipped" in particular hides the only actionable fact in the
           whole reply: we could not read that order, so it is still sitting on Etsy. */
        if (res.created) said.push(`${res.created} ${res.created === 1 ? 'Order' : 'Orders'} Added`)
        if (res.existed) said.push(`${res.existed} Already In`)
        if (res.skipped) said.push(`${res.skipped} Can\u2019t Sync`)
        if (res.notYours) said.push(`${res.notYours} Other Shop`)
        NEW_ORDERS = []
      } catch (e) { trouble = e.message }
    }

    if (ROWS.length) {
      const rows = ROWS.map(({ order_id, name, street, street2, city, state, zip, country }) =>
        ({ order_id, name, street, street2, city, state, zip, country }))
      try {
        const res = await api('/api/etsy/import-addresses', { method: 'POST', body: JSON.stringify({ rows }) })
        // What was just filled is no longer wanted, so a second press cannot double-send.
        WANTED = WANTED.filter((id) => !rows.some((r) => r.order_id === id))
        ROWS = []
        if (res.updated) said.push(`${res.updated} ${res.updated === 1 ? 'Address' : 'Addresses'} Filled`)
        if (res.alreadyHad) said.push(`${res.alreadyHad} Already Had`)
      } catch (e) { trouble = trouble || e.message }
    }

    if (trouble) fail(trouble)
    paint({ line: said.length ? said[0] : 'Nothing Changed', note: said.slice(1).join(' · ') })
  } finally {
    $('sync').textContent = 'Sync to egful'
    $('sync').disabled = false
  }
}

function render() {
  show($('connect'), !TOKEN)
  show($('main'), !!TOKEN)
  show($('forget'), !!TOKEN)
  show($('rescan'), !!TOKEN)
}

/* ── wiring ────────────────────────────────────────────────────────────────── */

$('link').addEventListener('click', connect)
$('sync').addEventListener('click', sync)
$('rescan').addEventListener('click', start)
/* A CLICK, which is the whole point: the seller is taken to their own Shop Manager and the
   page loads because they asked for it. Nothing here ever navigates on its own. */
$('open').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = 'https://www.etsy.com/your/orders/sold'
  if (tab) await chrome.tabs.update(tab.id, { url })
  else await chrome.tabs.create({ url })
  window.close()
})
$('peek').addEventListener('click', () => {
  OPEN_PEEK = !OPEN_PEEK
  paint({ line: $('count').textContent, note: $('note').textContent, button: 'sync', peek: NEW_ORDERS.length + ROWS.length })
})
$('forget').addEventListener('click', async () => {
  await chrome.storage.local.remove(['token', 'who'])
  TOKEN = null
  $('who').textContent = ''
  render()
})

;(async () => {
  const v = chrome.runtime.getManifest().version
  $('who').title = `build ${v}`
  const s = await chrome.storage.local.get(['token', 'who'])
  TOKEN = s.token || null
  $('who').textContent = s.who || ''
  await start()
})()

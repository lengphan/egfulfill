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
let ROWS = []            // what the current page can actually supply

function fail(msg) {
  const el = $('err')
  el.textContent = msg
  show(el, !!msg)
}

/* ── the token ─────────────────────────────────────────────────────────────── */

/**
 * READ THE SELLER'S OWN TOKEN FROM THE SELLER'S OWN TAB.
 *
 * No password is ever typed into this extension. The seller signs in to EGFULFILL the
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
    return fail('Could not read your EGFULFILL session. Open app.egful.store, sign in, then press Connect again.')
  }

  if (!got || !got.token) {
    return fail('You are not signed in to EGFULFILL in this browser. Sign in there first, then press Connect.')
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
    throw new Error('Your EGFULFILL session expired. Press Connect again.')
  }
  if (!r.ok) throw new Error(`EGFULFILL said ${r.status}`)
  return r.json()
}

/* ── the page ──────────────────────────────────────────────────────────────── */

async function scan() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !/^https:\/\/www\.etsy\.com\/your\/orders/.test(tab.url || '')) {
    ROWS = []
    $('count').textContent = 'Open your Etsy orders page'
    $('note').textContent = 'Shop Manager → Orders & Shipping. This reads what is on that page; it never fetches anything from Etsy.'
    $('sync').disabled = true
    $('stats').textContent = ''
    return
  }

  /*
   * READ THE PAGE FIRST, THEN ASK ABOUT WHAT IS ON IT.
   *
   * The first version asked EGFULFILL for "everything you are missing" and filtered the
   * page against that. For a staff user that list spans every seller and is capped, so a
   * shop's own orders could sit outside the window and the extension would report nothing
   * to do — indistinguishable from everything being filled already. Asking about the
   * receipts actually on screen removes the cap and the ambiguity, and it means we disclose
   * nothing about orders the seller is not already looking at.
   */
  let res
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'eg:scan', wanted: [] })
  } catch {
    return fail('Reload the Etsy tab and try again — the extension was installed after that page loaded.')
  }
  if (!res || !res.ok) return fail((res && res.error) || 'Could not read that page.')

  const onPage = res.rows || []
  const s = res.stats || {}

  if (!onPage.length) {
    ROWS = []
    $('count').textContent = 'Nothing to send from this page'
    $('note').textContent = 'No orders found here. Open a page of your sold orders, or page through to older ones.'
    $('sync').disabled = true
    $('stats').textContent = `${s.foundOnPage || 0} on page · 0 wanted · 0 usable`
    return
  }

  try {
    const ask = await api('/api/etsy/addresses/missing', {
      method: 'POST',
      body: JSON.stringify({ receipts: onPage.map((r) => r.order_id) }),
    })
    WANTED = ask.receipts || []
  } catch (e) {
    return fail(e.message)
  }

  const keep = new Set(WANTED.map(String))
  ROWS = onPage.filter((r) => keep.has(r.order_id))

  $('count').textContent = ROWS.length
    ? `${ROWS.length} ${ROWS.length === 1 ? 'address' : 'addresses'} ready to send`
    : 'Nothing to send from this page'
  $('note').textContent = ROWS.length
    ? ''
    : 'The orders on this page already have addresses in EGFULFILL.'
  $('sync').disabled = !ROWS.length

  /* SAY WHAT WAS SEEN, not just what survived. "20 on page, 0 usable" is a bug report that
     can be acted on; a bare 0 is indistinguishable from an empty page, which is how a
     broken selector hides for weeks. */
  $('stats').textContent = `${s.foundOnPage || 0} on page · ${ROWS.length} wanted · ${s.usable || 0} usable${s.how ? ` · via ${s.how}` : ''}`
}

async function start() {
  fail('')
  render()
  if (!TOKEN) return
  await scan()
}

async function sync() {
  if (!ROWS.length) return
  $('sync').disabled = true
  $('sync').textContent = 'Sending…'
  try {
    /* Send only the fields the endpoint reads. `_how` is a diagnostic this side and has no
       business in a request body. */
    const rows = ROWS.map(({ order_id, name, street, street2, city, state, zip, country }) =>
      ({ order_id, name, street, street2, city, state, zip, country }))
    const res = await api('/api/etsy/import-addresses', { method: 'POST', body: JSON.stringify({ rows }) })
    $('count').textContent = `${res.updated} filled`
    const rest = []
    if (res.alreadyHad) rest.push(`${res.alreadyHad} already had one`)
    if (res.notFound) rest.push(`${res.notFound} not in EGFULFILL`)
    if (res.skipped) rest.push(`${res.skipped} skipped`)
    $('note').textContent = rest.join(' · ')
    // What was just filled is no longer wanted, so a second press cannot double-send.
    WANTED = WANTED.filter((id) => !rows.some((r) => r.order_id === id))
    ROWS = []
  } catch (e) {
    fail(e.message)
  } finally {
    $('sync').textContent = 'Sync addresses'
    $('sync').disabled = !ROWS.length
  }
}

function render() {
  show($('connect'), !TOKEN)
  show($('main'), !!TOKEN)
  show($('forget'), !!TOKEN)
}

/* ── wiring ────────────────────────────────────────────────────────────────── */

$('link').addEventListener('click', connect)
$('sync').addEventListener('click', sync)
$('rescan').addEventListener('click', start)
$('forget').addEventListener('click', async () => {
  await chrome.storage.local.remove(['token', 'who'])
  TOKEN = null
  $('who').textContent = ''
  render()
})

;(async () => {
  const s = await chrome.storage.local.get(['token', 'who'])
  TOKEN = s.token || null
  $('who').textContent = s.who || ''
  await start()
})()

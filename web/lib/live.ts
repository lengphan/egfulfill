import { API_BASE, invalidateLists } from "./api"
import { getToken } from "./auth"

/**
 * One SSE connection for the whole page, shared by everything that wants live updates.
 *
 * Each consumer used to open its own EventSource. Browsers cap concurrent connections to
 * a host at around six, and they're held open for the session — so a page with a bell, a
 * board and a detail panel could spend most of that budget on streams carrying identical
 * data, and the next ordinary fetch would queue behind them. One connection, fanned out
 * in JS, costs nothing extra and can't starve anything.
 *
 * The server addresses anything sensitive to a specific socket (see egSendTo in
 * server/src/events.js); broadcasts are cache-invalidation pings only. Fanning them out
 * locally is therefore safe — subscribers re-query through their own access-controlled
 * endpoints, so what arrives here reveals nothing on its own.
 */
export type LiveEvent = { type?: string; [k: string]: unknown }

type Handler = (e: LiveEvent) => void

const handlers = new Map<string, Set<Handler>>()
let es: EventSource | null = null
let poll: ReturnType<typeof setInterval> | null = null
/** The token the current stream was opened with. Sign out and back in as someone else and
 *  the old socket is still bound to the old user server-side, so it has to be replaced. */
let openedWith: string | null = null
/** Did the stream actually drop? Distinguishes a genuine reconnect — where events were
 *  missed and cached reads must be thrown away — from the first open of a new connection,
 *  where nothing has been missed and the caller has usually just fetched. */
let missedWhileDown = false

function fanout(e: LiveEvent) {
  // A server event means something changed that this browser did NOT do — another operator
  // advancing a stage, a sync importing an order. Subscribers respond by re-reading through
  // their own endpoints, so the cached lists must be dropped FIRST or they'd re-read the
  // copy taken before the change. Cleared unconditionally, even when nothing here is
  // subscribed to this type: the event still proves the server's data moved.
  invalidateLists()
  const set = handlers.get(String(e.type ?? ""))
  if (!set) return
  // Copy before iterating: a handler that unsubscribes itself would otherwise mutate the
  // set mid-loop and silently skip the next subscriber.
  for (const h of [...set]) { try { h(e) } catch {} }
}

/** Wake every subscriber when the stream is down. Handlers are re-fetchers, so calling
 *  them with a synthetic event is exactly what a reconnect should do anyway. */
function pollAll() {
  for (const [type, set] of handlers.entries()) for (const h of [...set]) {
    try { h({ type, stale: true }) } catch {}
  }
}

function connect() {
  const token = getToken()
  if (!token || typeof EventSource === "undefined") return
  if (es && openedWith === token) return
  disconnect()
  openedWith = token
  try {
    es = new EventSource(`${API_BASE}/api/events?token=${encodeURIComponent(token)}`)
    es.onmessage = (ev) => {
      try { fanout(JSON.parse(ev.data || "{}")) } catch {}
    }
    // If the stream dies — a proxy timing out, a laptop sleeping, the API restarting —
    // fall back to a slow poll rather than silently freezing. A board that stopped
    // updating looks exactly like a board where nothing is happening.
    es.onerror = () => {
      missedWhileDown = true
      // While the stream is down there is no invalidation signal at all, so the poll has to
      // drop the cached lists itself before waking subscribers — otherwise it would re-read
      // a copy taken before whatever it's polling to discover.
      if (!poll) poll = setInterval(() => { invalidateLists(); pollAll() }, 60000)
    }
    es.onopen = () => {
      if (poll) { clearInterval(poll); poll = null }
      // Refetch on (re)connect: anything that changed while the stream was down was
      // never delivered, and nothing will resend it.
      //
      // But only DROP THE CACHE if there actually was an outage. This fires on the first
      // open of every fresh connection too — including the one opened when a board mounts,
      // moments after that board fetched — and invalidating there re-fetched a list the
      // browser had just loaded, on the single most common navigation in the app. That cost
      // a request per board visit and made the cache look like it did nothing.
      if (missedWhileDown) { missedWhileDown = false; invalidateLists() }
      pollAll()
    }
  } catch {
    es = null
    missedWhileDown = true
    if (!poll) poll = setInterval(() => { invalidateLists(); pollAll() }, 60000)
  }
}

function disconnect() {
  try { es?.close() } catch {}
  es = null
  if (poll) { clearInterval(poll); poll = null }
  openedWith = null
}

/**
 * Listen for one broadcast type. Returns an unsubscribe fn — call it on unmount.
 *
 * The handler may be called with `{ stale: true }` and no other fields when the stream
 * reconnects or is polling, meaning "you may have missed something, re-read". Treat it as
 * a refresh trigger, not as data.
 */
export function onLive(type: string, fn: Handler): () => void {
  let set = handlers.get(type)
  if (!set) { set = new Set(); handlers.set(type, set) }
  set.add(fn)
  connect()
  return () => {
    const s = handlers.get(type)
    if (!s) return
    s.delete(fn)
    if (!s.size) handlers.delete(type)
    // Last subscriber left the page — drop the socket rather than holding one open for
    // a page nothing is listening on.
    if (!handlers.size) disconnect()
  }
}

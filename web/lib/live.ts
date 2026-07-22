import { API_BASE } from "./api"
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

function fanout(e: LiveEvent) {
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
    es.onerror = () => { if (!poll) poll = setInterval(pollAll, 60000) }
    es.onopen = () => {
      if (poll) { clearInterval(poll); poll = null }
      // Refetch on (re)connect: anything that changed while the stream was down was
      // never delivered, and nothing will resend it.
      pollAll()
    }
  } catch {
    es = null
    if (!poll) poll = setInterval(pollAll, 60000)
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

import type { Order } from "@/lib/api"

/**
 * THE ORDER YOU ALREADY HAVE, kept so the next screen is not empty.
 *
 * Tapping a row pushed a screen that rendered a centred spinner and fetched the order from
 * nothing — while the list you tapped FROM was holding that same order in memory, complete.
 * The native slide animation was correct all along; what made it feel like a flash was
 * sliding into a blank page and watching it fill.
 *
 * `/api/orders` aggregates the full order_items rows into each row (orders.js), so a
 * remembered order is COMPLETE, not a stub — the detail screen can draw its whole header,
 * lines and address from it immediately. The re-fetch still happens and still wins; it just
 * stops being the thing between the tap and the content.
 *
 * BOUNDED ON PURPOSE. An unbounded map that only ever grows is the shape CLAUDE.md §2.8
 * warns about, so this evicts oldest-first. A phone that has scrolled the queue all day
 * holds the last few hundred orders and nothing more.
 */
const LIMIT = 300
const seen = new Map<string, Order>()

/** Remember what a list just loaded. Called from lib/api.ts, so no screen has to opt in —
 *  a list added later cannot forget to do this. */
export function remember(orders: Order[] | Order | null | undefined) {
  if (!orders) return
  for (const o of Array.isArray(orders) ? orders : [orders]) {
    const id = o && o.id != null ? String(o.id) : null
    if (!id) continue
    // Re-insert so recency is the map's own order; Map iterates in insertion order.
    if (seen.has(id)) seen.delete(id)
    seen.set(id, o)
  }
  while (seen.size > LIMIT) {
    const oldest = seen.keys().next()
    if (oldest.done) break
    seen.delete(oldest.value)
  }
}

/** What we already know about this order, or null. Safe to call during the first render —
 *  it reads memory only and never triggers a fetch. */
export function recall(id?: string | null): Order | null {
  if (!id) return null
  return seen.get(String(id)) ?? null
}

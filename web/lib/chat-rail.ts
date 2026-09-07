/**
 * THE CONVERSATION RAIL, in one place.
 *
 * Two surfaces draw the same list of rooms — the full Chat page and the floating launcher
 * that rides on every other page — and a rail that disagrees with itself about what a
 * channel is called, or which rooms this role even has, is worse than no launcher at all.
 * So the shape of the list lives here and both import it (CLAUDE.md §5).
 *
 * Nothing in this file fetches. It turns what the server already returned — pinned channel
 * summaries and, for staff, the seller inbox — into rows.
 */
import type { ChannelSummary, SupportThread } from "./api"

export const STAFF_CHANNEL = "staff-general"
export const ANNOUNCE_CHANNEL = "announce"

/** A conversation in the rail. Channels fan out on ONE dimension — seller identity.
 *  Everything else is a single room, so the rail has a fixed height no matter how many
 *  orders are open; per-order talk rides inside a channel as an order_ref chip. */
export type Convo = {
  id: string
  kind: "support" | "staff" | "inbox" | "announce" | "gen"
  title: string
  sub: string
  escalated?: boolean
  /** Incoming messages since our last reply — the unread badge. Zero once answered, which
   *  is how every other messenger behaves: the badge is a to-do, not a size. */
  count?: number
  /** Newest message, epoch ms. 0 for a room nobody has written in. */
  lastAt?: number
}

/** Which pinned rooms this account has. A seller has no factory room; a designer has no
 *  seller-facing announcements. Feed straight to getChannelSummaries. */
export function pinnedChannelIds(o: { staff: boolean; designer: boolean; supportId: string | null }): string[] {
  return [
    ...(o.staff ? [STAFF_CHANNEL] : []),
    ...(o.supportId ? [o.supportId] : []),
    ...(o.designer ? [] : [ANNOUNCE_CHANNEL]),
  ]
}

export type RailInput = {
  staff: boolean
  designer: boolean
  supportId: string | null
  /** Staff only: seller support threads, as returned by getSupportThreads. */
  inbox: SupportThread[]
  /** Pinned channel summaries by id, as returned by getChannelSummaries. */
  chanMeta: Record<string, ChannelSummary>
  /** Channels opened from the staff seller-directory that have no messages yet, so they
   *  don't vanish from the rail the moment you click one. */
  opened?: Convo[]
  /** useLabelT()'s tl — the caller's, so both surfaces translate identically. */
  tl: (ns: string, value: string) => string
}

export function buildRail({ staff, designer, supportId, inbox, chanMeta, opened = [], tl }: RailInput): Convo[] {
  const list: Convo[] = []
  /*
   * The newest message stands in for the subtitle; an empty room says so, because a blank
   * line beside a title reads as a row that failed to load rather than one nobody has used.
   *
   * "Attachment" is the SERVER's word for a message that is a file and nothing else (see
   * the channel-summary query) — the one string in this rail we do not author here. It is
   * matched exactly and translated, so a Vietnamese seller does not get one English row
   * among Vietnamese ones.
   */
  const lastLine = (last?: string) =>
    !last ? tl("chat", "No messages yet") : last === "Attachment" ? tl("chat", "Attachment") : last
  /*
   * A PINNED ROW READS LIKE EVERY OTHER ROW: what was said last, and how much of it you
   * haven't seen. They used to carry a fixed description of the room instead, which meant
   * the rooms with the most traffic were the only ones that never looked like anything
   * had happened in them.
   */
  const pin = (c: Convo): Convo => {
    const m = chanMeta[c.id]
    return { ...c, sub: lastLine(m?.last), count: m?.unread || 0, lastAt: m?.last_at || 0 }
  }
  if (staff) list.push(pin({ id: STAFF_CHANNEL, kind: "staff", title: tl("chat", "EG Channel"), sub: "" }))
  if (supportId) list.push(pin({ id: supportId, kind: "support", title: staff ? tl("chat", "My Assistant") : tl("chat", "EGFUL Support"), sub: "" }))
  // Admin writes, everyone else reads. Designers aren't part of seller-facing comms.
  if (!designer) list.push(pin({ id: ANNOUNCE_CHANNEL, kind: "announce", title: tl("chat", "Announcements"), sub: "" }))
  /**
   * NEWEST MESSAGE FIRST, under the pinned channels. The server already returns
   * `last_at desc`; sorting explicitly means the rail cannot quietly change meaning if
   * that query is ever reordered. Escalated threads are NOT floated — in an inbox someone
   * is working, that buries the conversation they are mid-sentence with.
   */
  if (staff) for (const t of [...inbox].sort((a, b) => (b.last_at || 0) - (a.last_at || 0))) {
    if (t.order_id === supportId) continue // don't list my own thread twice
    list.push({
      id: t.order_id, kind: "inbox", title: t.seller_name || t.seller_id,
      sub: t.last ? lastLine(t.last).slice(0, 40) : tl("chat", "Support request"),
      escalated: !!t.escalated, count: t.unanswered ?? 0, lastAt: t.last_at || 0,
    })
  }
  for (const c of opened) if (!list.some((x) => x.id === c.id)) list.push(c)
  return list
}

/** What the launcher's badge shows: everything waiting on you, across every room. */
export function unreadTotal(rows: Convo[]): number {
  return rows.reduce((n, c) => n + (c.count || 0), 0)
}

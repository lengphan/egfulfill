"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { ChatCircleDots, CaretLeft, PaperPlaneTilt, X, ArrowSquareOut, CircleNotch } from "@phosphor-icons/react"
import { useLabelT } from "@/lib/i18n"
import { getToken, getUser } from "@/lib/auth"
import { onLive } from "@/lib/live"
import { getChannelSummaries, getMe, getOrderMessages, getSupportThreads, postOrderMessage, requestAiReply, type ChannelSummary, type ChatAttachment, type ChatEntry, type SupportThread } from "@/lib/api"
import { buildRail, pinnedChannelIds, unreadTotal, type Convo } from "@/lib/chat-rail"
import { Markdown, hasMarkdown } from "@/components/app/markdown"

/**
 * THE CONVERSATION, ON EVERY PAGE.
 *
 * Chat was reachable only by leaving whatever you were doing and opening /chat, so a reply
 * that arrived while a seller was mid-order was invisible until they went looking for it —
 * and the one place a seller is guaranteed to be is not the chat page. This is the bubble
 * every messenger has: a count that says something is waiting, a list of the rooms, and
 * enough of a thread to answer in without losing the page underneath.
 *
 * It is deliberately NOT a second chat client. Attachments, @-mentions, image generation,
 * the AI draft and the office-hours editor all stay on /chat, and the header carries a
 * link straight there. What lives here is read-and-reply, which is the whole of what a
 * launcher is for.
 *
 * The rail it draws comes from lib/chat-rail.ts — the same builder /chat uses, so the two
 * can never disagree about what a room is called or which rooms a role has.
 */

const PANEL_ROWS = 8 // rows before the list scrolls — a launcher, not an inbox

const fmtAgo = (ts?: number) => {
  if (!ts) return ""
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function ChatLauncher() {
  const tl = useLabelT()
  const router = useRouter()
  const pathname = usePathname()

  const [ready, setReady] = useState(false)
  const [supportId, setSupportId] = useState<string | null>(null)
  const [role, setRole] = useState<string | undefined>(undefined)
  const [myName, setMyName] = useState("You")

  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [inbox, setInbox] = useState<SupportThread[]>([])
  const [chanMeta, setChanMeta] = useState<Record<string, ChannelSummary>>({})
  const [messages, setMessages] = useState<ChatEntry[] | null>(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  /* A SPINNER THAT NEVER STOPS IS A LIE. Three states, not two: still fetching, fetched,
     and couldn't fetch — because "you have no conversations" and "we couldn't reach the
     server" must not render as the same screen (CLAUDE.md §4, Honesty in UI). */
  const [listState, setListState] = useState<"loading" | "ok" | "error">("loading")
  const [threadState, setThreadState] = useState<"loading" | "ok" | "error">("loading")

  const staff = !!role && role !== "seller"
  const designer = role === "designer"

  // Session identity. Same resolution /chat does: the JWT's sub is what addresses the
  // account's own support thread, and getUser() may not carry an id on an older session.
  useEffect(() => {
    let alive = true
    const id = setTimeout(async () => {
      if (!getToken()) return
      const u = getUser()
      if (!alive) return
      setRole(u?.role)
      if (u?.name) setMyName(u.name)
      let uid = u?.id
      if (!uid) { try { uid = (await getMe()).sub } catch {} }
      if (!alive) return
      if (uid) setSupportId(`support-${uid}`)
      setReady(true)
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [pathname])

  const pinned = useMemo(() => pinnedChannelIds({ staff, designer, supportId }), [staff, designer, supportId])

  /**
   * THE BADGE IS FETCHED, NOT DERIVED FROM A LIST THAT MIGHT NOT BE LOADED.
   *
   * Two cheap reads: the pinned channel summaries (everyone) and the seller inbox (staff).
   * Both are the same endpoints /chat uses, so the count in the bubble and the count on
   * the page are the same number from the same query rather than two guesses.
   */
  const refresh = useCallback(() => {
    if (!getToken()) return
    if (pinned.length) getChannelSummaries(pinned)
      .then((rows) => {
        if (Array.isArray(rows)) setChanMeta(Object.fromEntries(rows.map((r) => [r.id, r])))
        setListState("ok")
      })
      .catch(() => setListState((cur) => (cur === "ok" ? cur : "error")))
    else setListState("ok")
    if (staff && !designer) getSupportThreads().then((rows) => { if (rows) setInbox(rows) }).catch(() => {})
  }, [pinned, staff, designer])

  /*
   * WHEN TO RE-READ. A message landing anywhere already produces a notification event on
   * the shared SSE hub (lib/live.ts), which is the signal — not a timer racing it. The
   * 60s interval is only the floor for a stream that has dropped to its poll fallback.
   *
   * This is an interval and a subscription, never an effect that fetches on a condition
   * its own result can re-satisfy (CLAUDE.md §2.8).
   */
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(refresh, 0)
    const iv = setInterval(refresh, 60000)
    const off = onLive("notification", refresh)
    return () => { clearTimeout(t); clearInterval(iv); off() }
  }, [ready, refresh])

  const rows = useMemo(
    () => buildRail({ staff, designer, supportId, inbox, chanMeta, tl }),
    [staff, designer, supportId, inbox, chanMeta, tl])

  const unread = unreadTotal(rows)
  const active = useMemo(() => rows.find((r) => r.id === activeId) ?? null, [rows, activeId])

  // The open thread. Reading it stamps read_at server-side, so the badge settles on the
  // next refresh without a second "mark read" call to remember.
  const loadThread = useCallback(async () => {
    if (!activeId) return
    try {
      const r = await getOrderMessages(activeId)
      setMessages(Array.isArray(r) ? r : [])
      setThreadState("ok")
    } catch {
      // Keep whatever is on screen — the next tick reconciles — but say so if there is
      // nothing there to keep.
      setThreadState((cur) => (cur === "ok" ? cur : "error"))
    }
  }, [activeId])

  useEffect(() => {
    if (!open || !activeId) return
    const t = setTimeout(() => { setMessages(null); setThreadState("loading"); loadThread() }, 0)
    const iv = setInterval(loadThread, 5000)
    return () => { clearTimeout(t); clearInterval(iv) }
  }, [open, activeId, loadThread])

  // Opening a room clears its badge now rather than at the next refresh — the stamp and
  // the count are two requests on two timers, so the number would otherwise sit on the
  // room you are looking at.
  useEffect(() => {
    if (!activeId) return
    const t = setTimeout(() => setChanMeta((prev) => (
      prev[activeId]?.unread ? { ...prev, [activeId]: { ...prev[activeId], unread: 0 } } : prev
    )), 0)
    return () => clearTimeout(t)
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    const t = setTimeout(() => setInbox((prev) => prev.map((x) => (x.order_id === activeId ? { ...x, unanswered: 0 } : x))), 0)
    return () => clearTimeout(t)
  }, [activeId, messages?.length])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages?.length])

  // Escape closes the thread, then the panel — the same order every stacked surface uses.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setActiveId((cur) => { if (cur) return null; setOpen(false); return null })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const send = async () => {
    const text = input.trim()
    if (!text || !activeId || sending) return
    setSending(true)
    setInput("")
    /*
     * Staff post as 'staff' ONLY when answering SOMEONE ELSE's thread. On their own
     * assistant thread the staffer is the ASKER, so they post as 'seller' — otherwise the
     * AI mapper reads it as an assistant turn and never answers.
     */
    const myRole = (staff && activeId !== supportId) ? "staff" : "seller"
    const clientId = `l-${Date.now().toString(36)}`
    setMessages((prev) => [...(prev ?? []), { id: clientId, role: myRole, by: myName, text, ts: Date.now(), me: true }])
    try {
      await postOrderMessage(activeId, text, { clientId, by: myName, role: myRole })
      await loadThread()
      /*
       * The assistant answers on the account's OWN support thread, exactly as it does on
       * /chat — sending from here must not quietly get a different service. The typewriter
       * reveal and the branch-by-branch notes stay on the full page: here the reply simply
       * arrives, and if the assistant declines the thread waits for a person, which is what
       * it would have done anyway.
       */
      if (activeId === supportId) {
        try { const r = await requestAiReply(); if (r.ok) await loadThread() } catch {}
      }
      refresh()
    } catch {
      setInput(text) // put the words back rather than swallowing them
    } finally {
      setSending(false)
    }
  }

  const openFull = () => {
    setOpen(false)
    router.push("/chat")
  }

  // Not on /chat — the launcher IS that page there — and never signed out.
  if (!ready || pathname === "/chat" || pathname.startsWith("/chat/")) return null

  return (
    <>
      {/* The panel. Anchored to the bubble on a desktop; a sheet within the margins on a
          phone, where a 380px card floating over a 390px screen is just a worse page. */}
      {open && (
        <div
          role="dialog"
          aria-label={tl("chat", "Messages")}
          className="fixed inset-x-3 bottom-20 z-40 flex max-h-[min(34rem,calc(100svh-7rem))] flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground ring-1 ring-foreground/10 sm:inset-x-auto sm:right-5 sm:w-[22.5rem] dark:ring-foreground/15"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            {active ? (
              <button
                onClick={() => setActiveId(null)}
                aria-label={tl("chat", "Back to conversations")}
                className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <CaretLeft size={16} weight="bold" />
              </button>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {active ? active.title : tl("chat", "Messages")}
            </span>
            <button
              onClick={openFull}
              title={tl("chat", "Open full chat")}
              aria-label={tl("chat", "Open full chat")}
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowSquareOut size={15} />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label={tl("chat", "Close messages")}
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X size={15} weight="bold" />
            </button>
          </div>

          {!active ? (
            <div className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: `${PANEL_ROWS * 3.75}rem` }}>
              {rows.length === 0 && listState === "loading" ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <CircleNotch size={18} className="animate-spin" />
                </div>
              ) : rows.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {listState === "error" ? tl("chat", "Couldn't load your conversations") : tl("chat", "No conversations yet")}
                </div>
              ) : rows.map((c: Convo) => (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.title}</span>
                      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{fmtAgo(c.lastAt)}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{c.sub}</span>
                  </span>
                  {/* The row's only mark, and the same one the rail on /chat uses: a filled
                      circle at the end of the row saying how much is waiting on you. */}
                  {!!c.count && (
                    <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold tabular-nums text-primary-foreground">
                      {c.count > 99 ? "99+" : c.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
                {messages === null && threadState === "loading" ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <CircleNotch size={18} className="animate-spin" />
                  </div>
                ) : messages === null || messages.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    {threadState === "error" ? tl("chat", "Couldn't load this conversation") : tl("chat", "No messages yet")}
                  </div>
                ) : messages.map((m) => {
                  const r = m.role ?? "seller"
                  const mine = m.me !== undefined ? m.me : (r !== "assistant" && !!m.by && m.by === myName)
                  const att = m.attachment as ChatAttachment | undefined
                  return (
                    <div key={m.id} className={"flex flex-col " + (mine ? "items-end" : "items-start")}>
                      <div className={"max-w-[85%] rounded-2xl px-3 py-1.5 text-sm " + (mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                        {m.text && (hasMarkdown(m.text) && !mine
                          ? <Markdown>{m.text}</Markdown>
                          : <span className="whitespace-pre-wrap break-words">{m.text}</span>)}
                        {/* An attachment is readable here but not composable — the full page
                            is where a file is picked, and a bubble that says nothing arrived
                            reads as a broken message. */}
                        {att?.url && (
                          <a href={att.url} target="_blank" rel="noreferrer"
                            className={"mt-1 block truncate text-xs underline " + (mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
                            {att.name || tl("chat", "Attachment")}
                          </a>
                        )}
                      </div>
                      <span className="px-1 pt-0.5 text-2xs text-muted-foreground">
                        {!mine && m.by ? `${m.by} · ` : ""}{fmtAgo(m.ts)}
                      </span>
                    </div>
                  )
                })}
              </div>
              {/* Announcements are written by an admin and read by everyone else, so the
                  composer is absent rather than present-and-refused. */}
              {active.kind !== "announce" || staff ? (
                <div className="flex items-end gap-2 border-t border-border p-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
                    rows={1}
                    placeholder={tl("chat", "Write a message…")}
                    aria-label={tl("chat", "Write a message")}
                    className="max-h-24 min-h-8 flex-1 resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                  />
                  <button
                    onClick={send}
                    disabled={!input.trim() || sending}
                    aria-label={tl("chat", "Send")}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {sending ? <CircleNotch size={15} className="animate-spin" /> : <PaperPlaneTilt size={15} weight="fill" />}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {/* The bubble. rounded-full because it is genuinely round — a launcher, not a button
          in a row of controls (CLAUDE.md §4). */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `${tl("chat", "Messages")} (${unread})` : tl("chat", "Messages")}
        aria-expanded={open}
        title={tl("chat", "Messages")}
        className="fixed bottom-5 right-5 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground ring-1 ring-foreground/10 transition-transform hover:scale-105 active:scale-95"
      >
        {open ? <X size={20} weight="bold" /> : <ChatCircleDots size={22} weight="fill" />}
        {/* NOT RED. The status colours are reserved and mean something on the floor —
            red is alert, amber is hold — and "you have three messages" is neither. The
            count is the bubble's own surface inverted, which reads at a glance without
            borrowing a hue that says something else. */}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-background px-1.5 text-2xs font-bold tabular-nums text-foreground ring-2 ring-primary">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  )
}

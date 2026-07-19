"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PaperPlaneTilt, Headset, CircleNotch, Package, Sparkle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrderMessages, postOrderMessage, requestAiReply, getMe, getOrders, getSupportThreads, aiDraft, type ChatEntry, type OrderRow, type SupportThread } from "@/lib/api"
import { getUser, getToken } from "@/lib/auth"
import { Markdown } from "@/components/app/markdown"

const nowMs = () => Date.now()
const fmtTime = (ts?: number) => {
  if (!ts) return ""
  const d = new Date(ts)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

const SUGGESTIONS = [
  "Where's my latest order?",
  "What's my wallet balance?",
  "How do I top up my wallet?",
  "How do I connect my Etsy shop?",
]

// A conversation in the left rail — Support (AI + team), a per-order thread, or the
// internal staff-only Factory channel.
type Convo = { id: string; kind: "support" | "order" | "staff" | "inbox" | "design"; title: string; sub: string; escalated?: boolean }
const STAFF_CHANNEL = "staff-general"

export default function ChatPage() {
  const [supportId, setSupportId] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [inbox, setInbox] = useState<SupportThread[]>([]) // staff: seller support threads
  const [drafting, setDrafting] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatEntry[] | null>(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [aiTyping, setAiTyping] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [streaming, setStreaming] = useState("") // assistant reply revealed word-by-word
  const revealingRef = useRef(false)             // pause polling while the typewriter runs
  const scrollRef = useRef<HTMLDivElement>(null)
  const cidBase = useRef("")
  const cidSeq = useRef(0)
  const myName = getUser()?.name || "You"
  const isStaffUser = (() => { const r = getUser()?.role; return !!r && r !== "seller" })()
  // Designers work artwork for the factory and aren't part of seller conversations, so
  // they get the artwork threads instead of the seller support inbox (which 403s).
  const isDesigner = getUser()?.role === "designer"

  useEffect(() => {
    cidBase.current = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  }, [])

  // Everyone gets an EGFULFILL Support thread (support-<uid>); staff ALSO get the shared
  // internal Factory channel and default to it. Sellers additionally see their orders.
  useEffect(() => {
    let alive = true
    const id = setTimeout(async () => {
      if (!getToken()) { setSignedOut(true); return }
      let uid = getUser()?.id
      if (!uid) { try { uid = (await getMe()).sub } catch {} }
      if (!alive) return
      if (uid) {
        setSupportId(`support-${uid}`)
        setActiveId((cur) => cur ?? (isStaffUser ? STAFF_CHANNEL : `support-${uid}`))
      } else if (isStaffUser) {
        setActiveId((cur) => cur ?? STAFF_CHANNEL)
      } else {
        setSignedOut(true)
      }
      // Staff need orders too now — each one carries an artwork thread.
      getOrders().then((rows) => alive && setOrders(rows ?? [])).catch(() => {})
      if (isStaffUser && !isDesigner) getSupportThreads().then((rows) => alive && setInbox(rows ?? [])).catch(() => {})
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [isStaffUser, isDesigner])

  const convos = useMemo<Convo[]>(() => {
    const list: Convo[] = []
    if (isStaffUser) list.push({ id: STAFF_CHANNEL, kind: "staff", title: "Factory channel", sub: "Internal team chat" })
    if (supportId) list.push({ id: supportId, kind: "support", title: "EGFULFILL Support", sub: isStaffUser ? "Ask EGFULFILL" : "Assistant + team" })
    // Threads with an unanswered "talk to a human" sort above the rest — an explicit
    // request for help shouldn't be buried under newer small talk.
    if (isStaffUser) for (const t of [...inbox].sort((a, b) => Number(!!b.escalated) - Number(!!a.escalated))) {
      if (t.order_id === supportId) continue // don't list my own thread twice
      list.push({
        id: t.order_id, kind: "inbox", title: t.seller_name || t.seller_id,
        sub: t.last ? t.last.slice(0, 40) : "Support request", escalated: !!t.escalated,
      })
    }
    if (!isStaffUser) for (const o of orders.slice(0, 30)) {
      list.push({ id: o.id, kind: "order", title: `#${o.seq ?? o.id}`, sub: o.customer?.name || (o.source ? `${o.source}` : "Order") })
    }
    // Artwork threads (design-<orderId>) — designer <-> factory, never visible to the
    // seller. Capped so the list stays navigable on a busy shop.
    if (isStaffUser) for (const o of orders.slice(0, 20)) {
      list.push({ id: `design-${o.id}`, kind: "design", title: `Artwork · #${o.seq ?? o.id}`, sub: "Designer & factory" })
    }
    return list
  }, [isStaffUser, supportId, orders, inbox])

  const active = useMemo(() => convos.find((c) => c.id === activeId) ?? null, [convos, activeId])
  const isSupport = active?.kind === "support" // AI auto-reply only on the seller support thread
  const isInbox = active?.kind === "inbox" // staff answering a seller's support thread

  // Fetch WITHOUT touching state, so a caller can decide when to commit. The reveal
  // path needs that: it has to swap the typewriter bubble for the persisted message
  // in one render (see submit) rather than clearing one and then setting the other.
  const fetchMessages = useCallback(async (): Promise<ChatEntry[] | null> => {
    if (!activeId) return null
    try {
      const r = await getOrderMessages(activeId)
      return Array.isArray(r) ? r : []
    } catch {
      return null
    }
  }, [activeId])

  const load = useCallback(async () => {
    // While the typewriter is revealing, don't let a poll pull in the already-persisted
    // assistant message — that would show a duplicate bubble next to the streaming one.
    if (!activeId || revealingRef.current) return
    const rows = await fetchMessages()
    setMessages((prev) => rows ?? prev ?? [])
  }, [activeId, fetchMessages])

  // Load + poll the active thread; reset messages when switching.
  useEffect(() => {
    if (!activeId) return
    const t = setTimeout(() => { setMessages(null); load() }, 0)
    const iv = setInterval(load, 5000)
    return () => { clearTimeout(t); clearInterval(iv) }
  }, [activeId, load])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages?.length, aiTyping, streaming])

  // Reveal the assistant reply word-by-word for a live "typing" feel (we already have
  // the full text — this is a client-side effect, not model streaming).
  const revealReply = (full: string) => new Promise<void>((resolve) => {
    const parts = full.split(/(\s+)/)
    let i = 0
    const tick = () => {
      i += 1
      setStreaming(parts.slice(0, i).join(""))
      if (i >= parts.length) { resolve(); return }
      window.setTimeout(tick, 22)
    }
    tick()
  })

  const submit = async (raw: string) => {
    const text = raw.trim()
    if (!text || !activeId || sending) return
    setSending(true)
    setInput("")
    const clientId = `c-${cidBase.current}-${cidSeq.current++}`
    setMessages((prev) => [...(prev ?? []), { id: clientId, role: "seller", by: myName, text, ts: nowMs() }])
    try {
      await postOrderMessage(activeId, text, { clientId, by: myName })
      await load()
      // Only the Support thread gets an AI reply; order threads are seller↔factory.
      if (isSupport) {
        setAiTyping(true)
        try {
          const r = await requestAiReply()
          if (r.ok && r.reply) {
            setAiTyping(false)
            revealingRef.current = true  // pause polling so no duplicate bubble appears
            await revealReply(r.reply)   // typewriter the reply in

            // Hand off from the typewriter bubble to the persisted one in a SINGLE
            // commit. Clearing `streaming` before the fetch resolved left a render
            // where the reply was in neither — that was the flash. Fetch first, then
            // set both states in one synchronous block so React batches them.
            const rows = await fetchMessages()
            revealingRef.current = false
            setMessages((prev) =>
              // If the reload failed, keep the reply on screen rather than losing it
              // to the cleared typewriter.
              rows ?? [...(prev ?? []), { id: `ai-${nowMs()}`, role: "assistant", text: r.reply as string, ts: nowMs() }]
            )
            setStreaming("")
            setAiNote(null)
          }
          else if (r.ok && r.skipped) { await load(); setAiNote(null) }
          else if (r.disabled) setAiNote("The assistant is off — an admin can add the AI key in Settings → Integrations. A teammate will follow up.")
          else if (r.error) setAiNote(`Assistant couldn't reply (${r.error}). A teammate will follow up.`)
          else setAiNote(null)
        } catch {
          setAiNote("Assistant is unavailable right now — a teammate will follow up here.")
        } finally {
          setAiTyping(false)
          setStreaming("")
        }
      }
    } catch {
      /* optimistic bubble stays; polling reconciles */
    } finally {
      setSending(false)
    }
  }
  const send = () => submit(input)

  // Seller escalation → post a request for a human (no AI); staff see it in the inbox.
  const escalate = async () => {
    if (!activeId) return
    const clientId = `c-${cidBase.current}-${cidSeq.current++}`
    const text = "I'd like to talk to a human — please have someone follow up."
    setMessages((prev) => [...(prev ?? []), { id: clientId, role: "seller", by: myName, text, ts: nowMs() }])
    setAiNote("Flagged for a teammate — someone will reply here shortly.")
    // escalated:true is what actually raises the flag — it writes meta.escalated, sends
    // staff a distinct notification, and pins the thread to the top of their inbox until
    // one of them replies. Without it this was just another message.
    try { await postOrderMessage(activeId, text, { clientId, by: myName, escalated: true }); await load() } catch {}
  }

  // Staff: draft a reply with AI for the open seller thread → fill the composer to edit.
  const draftWithAi = async () => {
    if (!activeId) return
    setDrafting(true)
    try {
      const r = await aiDraft(activeId)
      if (r.draft) setInput(r.draft)
      else if (r.disabled) setAiNote("AI is off — set the key in Settings → Integrations.")
      else if (r.error) setAiNote(`Draft failed: ${r.error}`)
    } catch { setAiNote("Draft failed — try again.") } finally { setDrafting(false) }
  }

  return (
    // One height for everyone: staff and sellers both render this through the same shell
    // (topbar 3.5rem + main py-6 = 6.5rem, plus a little slack). The staff branch used
    // to subtract only the topbar, so the pane ran 3rem taller than its space — the
    // PAGE scrolled and the composer fell below the fold. min-h-0 lets the inner panes
    // own their own scrolling instead of growing the container as threads are added.
    <div className="flex h-[calc(100svh-7rem)] min-h-0 gap-4">
      {/* conversation rail */}
      <aside className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card md:flex">
        <div className="border-b border-border px-4 py-3 font-semibold">Conversations</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {signedOut ? (
            <div className="p-4 text-sm text-muted-foreground">Sign in to see your conversations.</div>
          ) : convos.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
          ) : (
            convos.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={"flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent " + (c.id === activeId ? "bg-accent" : "")}
              >
                <span className={"flex size-9 shrink-0 items-center justify-center rounded-full " + (c.kind === "support" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  {c.kind === "support" ? <Headset size={17} weight="duotone" /> : <Package size={16} weight="duotone" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{c.title}</span>
                    {c.escalated && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                        Needs a human
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{c.sub}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* active thread */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
        {/* header — also the mobile conversation switcher */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className={"flex size-9 shrink-0 items-center justify-center rounded-full " + (isSupport ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
            {isSupport ? <Headset size={18} weight="duotone" /> : <Package size={16} weight="duotone" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{active?.title || "Chat"}</div>
            <div className="truncate text-xs text-muted-foreground">{isSupport ? "Assistant replies instantly; the team follows up" : active?.sub || "Order thread"}</div>
          </div>
          {convos.length > 1 && (
            <select
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
              className="eg-select h-8 max-w-[45%] rounded-lg border border-border bg-card px-2 text-xs md:hidden transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Switch conversation"
            >
              {convos.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
        </div>

        {/* messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {signedOut ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">Sign in to chat.</div>
          ) : messages === null ? (
            <div className="flex h-full items-center justify-center text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                {isSupport ? <Headset size={22} weight="duotone" /> : <Package size={20} weight="duotone" />}
              </span>
              <div className="font-medium">{isSupport ? "How can we help?" : active?.kind === "staff" ? "Factory channel" : `Chat about order ${active?.title ?? ""}`}</div>
              <div className="max-w-xs text-sm text-muted-foreground">
                {isSupport ? "Ask about an order, billing, integrations — our assistant answers from your account, and a teammate follows up when needed." : active?.kind === "staff" ? "Internal team chat — coordinate production, designs, and orders with the rest of the factory." : "Message the fulfillment team about this order — questions, changes, or artwork."}
              </div>
              {isSupport && (
                <div className="mt-1 flex max-w-md flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => submit(s)} disabled={!activeId || sending} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {messages.map((m) => {
                const mine = (m.role ?? "seller") === "seller"
                return (
                  <div key={String(m.id)} className={"flex flex-col " + (mine ? "items-end" : "items-start")}>
                    <div className={"max-w-[75%] rounded-2xl px-3.5 py-2 text-sm " + (mine ? "whitespace-pre-wrap bg-primary text-primary-foreground" : "bg-muted")}>
                      {/* The assistant answers in markdown, so rendering it as plain text
                          showed literal ** around every bold phrase. Own messages stay
                          verbatim — a seller typing *asterisks* meant them. */}
                      {mine ? m.text : <Markdown>{m.text ?? ""}</Markdown>}
                    </div>
                    <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                      {!mine ? `${m.by || (isSupport ? "Support" : "Factory")} · ` : ""}
                      {fmtTime(m.ts)}
                    </span>
                  </div>
                )
              })}
              {aiTyping && !streaming && (
                <div className="flex items-start">
                  <div className="flex items-center gap-1 rounded-2xl bg-muted px-3.5 py-2.5">
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.2s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.1s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                  </div>
                </div>
              )}
              {streaming && (
                <div className="flex items-start">
                  <div className="max-w-[80%] rounded-2xl bg-muted px-3.5 py-2.5 text-sm">
                    <Markdown>{streaming}</Markdown>
                    <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground/60 align-middle" />
                  </div>
                </div>
              )}
              {aiNote && (
                <div className="mx-auto max-w-sm rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
                  {aiNote}
                </div>
              )}
            </>
          )}
        </div>

        {/* seller: escalate to a human on the support thread */}
        {isSupport && !isStaffUser && !signedOut && (
          <div className="flex items-center justify-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>Not what you needed?</span>
            <button onClick={escalate} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
              <Headset size={14} /> Talk to a human
            </button>
          </div>
        )}

        {/* composer */}
        <div className="flex items-center gap-2 border-t border-border p-3">
          {isInbox && (
            <Button variant="outline" size="sm" className="h-10 shrink-0 gap-1.5" onClick={draftWithAi} disabled={drafting}>
              {drafting ? <CircleNotch size={14} className="animate-spin" /> : <Sparkle size={14} />}
              Draft with AI
            </Button>
          )}
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={signedOut ? "Sign in to send a message" : "Type a message…  (Enter to send)"}
            disabled={signedOut || !activeId}
            className="h-10"
          />
          <Button size="icon" className="size-10" onClick={send} disabled={signedOut || !activeId || !input.trim() || sending}>
            <PaperPlaneTilt size={16} weight="fill" />
          </Button>
        </div>
      </div>
    </div>
  )
}

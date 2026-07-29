"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PaperPlaneTilt, Headset, CircleNotch, Package, Sparkle, UsersThree, Megaphone, Moon, User, Smiley, Paperclip, X, FileText } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrderMessages, postOrderMessage, requestAiReply, getMe, getSupportThreads, searchSellers, aiDraft, getSupportAvailability, getOrderMentions, getMentionPeople, uploadChatAttachment, type ChatEntry, type SellerMatch, type SupportThread, type SupportAvailability, type OrderRow, type MentionPerson, type ChatAttachment } from "@/lib/api"
import { getUser, getToken } from "@/lib/auth"
import { Markdown, hasMarkdown } from "@/components/app/markdown"
import { SupportHoursEditor } from "@/components/app/support-hours-editor"

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

// A conversation in the left rail. Channels fan out on ONE dimension — seller identity.
// Everything else is a single room, so the rail has a fixed height no matter how many
// orders are open. Per-order talk now rides inside a channel as an order_ref chip; it
// used to spawn a room per order (plus a second `design-<id>` room), which buried the
// real conversations under dozens of empty ones.
type Convo = { id: string; kind: "support" | "staff" | "inbox" | "announce"; title: string; sub: string; escalated?: boolean }
const STAFF_CHANNEL = "staff-general"
const ANNOUNCE_CHANNEL = "announce"

// One "@" suggestion — either a teammate (mentioning them notifies) or an order to tag.
type MentionItem = { kind: "order"; o: OrderRow } | { kind: "person"; p: MentionPerson }

// A small, practical emoji set for the composer — reactions, status, and the POD/shipping
// bits that actually come up here. Not a full library; just the common ones.
const EMOJIS = "😀 😄 😊 🙂 😉 😎 🤔 😅 😂 🤣 😭 😢 😡 🥳 🙏 👍 👎 👌 👏 🙌 💪 🔥 ✨ 🎉 ❤️ 💜 ✅ ❌ ⚠️ ❓ ‼️ 📦 🚚 🏷️ 💳 💰 📸 🎨 🧵 👕 🧢 ⏳ 🕐 👋".split(" ")

// Prepare a file for upload: DOWNSIZE images in the browser first (longest edge capped,
// re-encoded JPEG) so a phone photo doesn't eat storage or hit the proxy body limit.
// Non-images (PDF) pass through as-is. Returns a data URL.
async function fileToUploadUrl(file: File, maxEdge = 1800, quality = 0.82): Promise<string> {
  const original = await new Promise<string>((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("Couldn't read the file")); fr.readAsDataURL(file)
  })
  if (!file.type.startsWith("image/")) return original
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = original })
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    if (scale === 1 && file.size < 500_000) return original
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext("2d"); if (!ctx) return original
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL("image/jpeg", quality)
  } catch { return original }
}

// Module scope, not a component defined in render (react-hooks/static-components).
const convoIcon = (kind: Convo["kind"] | undefined, size = 16) => {
  if (kind === "support") return <Headset size={size + 1} weight="duotone" />
  if (kind === "staff") return <UsersThree size={size} weight="duotone" />
  if (kind === "announce") return <Megaphone size={size} weight="duotone" />
  return <Package size={size} weight="duotone" /> // inbox: a seller's channel
}

export default function ChatPage() {
  const [supportId, setSupportId] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [inbox, setInbox] = useState<SupportThread[]>([]) // staff: seller support threads
  const [search, setSearch] = useState("")
  const [found, setFound] = useState<SellerMatch[]>([])  // staff: sellers with no thread yet
  const [opened, setOpened] = useState<Convo[]>([])      // channels started from the directory
  const [drafting, setDrafting] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatEntry[] | null>(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [aiTyping, setAiTyping] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [office, setOffice] = useState<SupportAvailability | null>(null)
  const [hoursOpen, setHoursOpen] = useState(false)  // staff: support-hours editor dialog
  const [emojiOpen, setEmojiOpen] = useState(false)  // composer emoji picker
  const [pendingAtt, setPendingAtt] = useState<ChatAttachment | null>(null)  // staged attachment
  const [attaching, setAttaching] = useState(false)
  const attachRef = useRef<HTMLInputElement>(null)
  // @-mention autocomplete: the seller's own orders power the suggestions, and `mention`
  // tracks the token being typed after an "@".
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [people, setPeople] = useState<MentionPerson[]>([])
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const composerRef = useRef<HTMLInputElement>(null)
  const [streaming, setStreaming] = useState("") // assistant reply revealed word-by-word
  const revealingRef = useRef(false)             // pause polling while the typewriter runs
  const scrollRef = useRef<HTMLDivElement>(null)
  const cidBase = useRef("")
  const cidSeq = useRef(0)
  const myName = getUser()?.name || "You"
  const isStaffUser = (() => { const r = getUser()?.role; return !!r && r !== "seller" })()
  const isAdmin = getUser()?.role === "admin"
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
      if (isStaffUser && !isDesigner) getSupportThreads().then((rows) => alive && setInbox(rows ?? [])).catch(() => {})
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [isStaffUser, isDesigner])

  const convos = useMemo<Convo[]>(() => {
    const list: Convo[] = []
    if (isStaffUser) list.push({ id: STAFF_CHANNEL, kind: "staff", title: "Factory channel", sub: "All boards — production & artwork" })
    if (supportId) list.push({ id: supportId, kind: "support", title: isStaffUser ? "My EG" : "EGFULFILL Support", sub: isStaffUser ? "Your AI assistant" : "Assistant + team" })
    // Admin writes, everyone else reads. Designers aren't part of seller-facing comms.
    if (!isDesigner) list.push({ id: ANNOUNCE_CHANNEL, kind: "announce", title: "Announcements", sub: isAdmin ? "Broadcast to all sellers" : "From EGFULFILL" })
    // Threads with an unanswered "talk to a human" sort above the rest — an explicit
    // request for help shouldn't be buried under newer small talk.
    if (isStaffUser) for (const t of [...inbox].sort((a, b) => Number(!!b.escalated) - Number(!!a.escalated))) {
      if (t.order_id === supportId) continue // don't list my own thread twice
      list.push({
        id: t.order_id, kind: "inbox", title: t.seller_name || t.seller_id,
        sub: t.last ? t.last.slice(0, 40) : "Support request", escalated: !!t.escalated,
      })
    }
    // Channels opened from the directory that have no messages yet, so they don't
    // vanish from the rail the moment you click one.
    for (const c of opened) if (!list.some((x) => x.id === c.id)) list.push(c)
    return list
  }, [isStaffUser, isDesigner, isAdmin, supportId, inbox, opened])

  // Filtered rail. Searching only narrows what's already there; sellers who have
  // never written in come from the directory below, not from this list.
  const shown = useMemo(() => {
    const t = search.trim().toLowerCase()
    if (!t) return convos
    return convos.filter((c) => c.title.toLowerCase().includes(t) || c.sub.toLowerCase().includes(t))
  }, [convos, search])

  // Staff: look up sellers by name/email so a conversation can be started from our
  // side — "your address didn't validate", "this order has no artwork".
  useEffect(() => {
    if (!isStaffUser || isDesigner) return
    const t = search.trim()
    // Clearing runs inside the timeout too, not in the effect body — a synchronous
    // setState here trips react-hooks/set-state-in-effect.
    const id = setTimeout(() => {
      if (t.length < 2) { setFound([]); return }
      searchSellers(t)
        .then((rows) => setFound(rows ?? []))
        .catch(() => setFound([]))
    }, t.length < 2 ? 0 : 250) // debounce: this hits the DB on every keystroke otherwise
    return () => clearTimeout(id)
  }, [search, isStaffUser, isDesigner])

  const openSeller = (s: SellerMatch) => {
    setOpened((prev) => prev.some((c) => c.id === s.channel) ? prev
      : [...prev, { id: s.channel, kind: "inbox", title: s.name, sub: s.email }])
    setActiveId(s.channel)
    setSearch("")
  }

  const active = useMemo(() => convos.find((c) => c.id === activeId) ?? null, [convos, activeId])
  const isSupport = active?.kind === "support" // AI auto-reply only on the seller support thread

  // The moment a human takes over from the assistant — shown ONCE as a divider so the
  // handoff is unmistakable (standard live-chat pattern). It's the first message in the
  // thread from a real teammate: not the seller, not the assistant, not an internal brief.
  const joinAt = useMemo(() => {
    if (!isSupport || !messages) return null
    const h = messages.find((x) => { const r = x.role ?? "seller"; return r !== "seller" && r !== "assistant" && !x.internal })
    return h ? { id: String(h.id), by: h.by || "A teammate" } : null
  }, [isSupport, messages])

  // Office hours, fetched once on mount, so the seller's handoff copy AND the staff status
  // pill both know whether we're open right now — regardless of which thread is active.
  useEffect(() => {
    if (!getToken()) return
    const id = setTimeout(() => { getSupportAvailability().then(setOffice).catch(() => {}) }, 0)
    return () => clearTimeout(id)
  }, [])

  // The right "you're in the queue" line for the moment — in hours vs. offline.
  const queueNote = (o: SupportAvailability | null) =>
    o && !o.open
      ? `Our team is out of office right now${o.resumesLabel ? ` — back ${o.resumesLabel}` : ""} (${o.hoursLabel}). Your request is logged; a teammate will reply right here, and email you, when we're back. The assistant is paused.`
      : `You're in the queue — a teammate will reply here${o?.hoursLabel ? `, usually within business hours (${o.hoursLabel})` : ""}. The assistant is paused until they do.`

  // "@" suggestions = TEAMMATES (mentioning one notifies them — not everything is about an
  // order) + the active thread's seller's ORDERS. Orders are thread-scoped (so staff on a
  // seller's inbox see THAT seller's); people are the staff directory. Refetched per thread.
  // Teammates for @-mentions (the staff directory) — the same regardless of the query.
  useEffect(() => {
    const id = setTimeout(() => {
      getMentionPeople().then((r) => setPeople(r.people ?? [])).catch(() => setPeople([]))
    }, 0)
    return () => clearTimeout(id)
  }, [activeId])

  // Order suggestions — for the seller support threads AND the staff Factory channel; the
  // server gates access and SEARCHES BY NUMBER, so typing "@14" finds even an old order past
  // the recent window. Debounced so a query hits the server once, not per keystroke.
  useEffect(() => {
    const noMentions = !activeId || (activeId.indexOf("support-") !== 0 && activeId !== STAFF_CHANNEL)
    const query = mention?.query?.trim() ?? ""
    // Defer every setState into the timeout so none runs synchronously in the effect body
    // (repo lint rule react-hooks/set-state-in-effect).
    const id = setTimeout(() => {
      if (noMentions || !activeId) { setOrders([]); return }
      getOrderMentions(activeId, query || undefined).then((r) => setOrders(r.orders ?? [])).catch(() => setOrders([]))
    }, query ? 200 : 0)
    return () => clearTimeout(id)
  }, [activeId, mention?.query])

  const mentionMatches = useMemo<MentionItem[]>(() => {
    if (!mention) return []
    const qq = mention.query.toLowerCase()
    const ppl: MentionItem[] = people
      .filter((p) => !qq || p.name.toLowerCase().includes(qq) || (p.username ?? "").toLowerCase().includes(qq))
      .slice(0, 4).map((p) => ({ kind: "person", p }))
    const ords: MentionItem[] = orders
      .filter((o) => !qq || String(o.seq ?? "").includes(qq) || o.id.toLowerCase().includes(qq) || (o.customer?.name ?? "").toLowerCase().includes(qq))
      .slice(0, 5).map((o) => ({ kind: "order", o }))
    // People first — mentioning a teammate is the "not about an order" case.
    return [...ppl, ...ords].slice(0, 7)
  }, [mention, people, orders])

  // Detect an "@…" token at the caret so the dropdown can offer matches (people or orders).
  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = /(?:^|\s)(@#?[\w.-]*)$/.exec(before)
    if (!m) { setMention(null); return }
    const full = m[1]
    setMention({ start: before.length - full.length, end: caret, query: full.replace(/^@#?/, "") })
    setMentionIdx(0)
  }

  // Insert the picked mention: an order tags its number/id; a person inserts a handle the
  // server resolves and notifies (username, else lowercased first name).
  const pickMention = (item: MentionItem) => {
    if (!mention) return
    const tag = item.kind === "order"
      ? String(item.o.seq ?? item.o.id)
      : (item.p.username || item.p.name.split(" ")[0] || "").toLowerCase()
    const next = input.slice(0, mention.start) + `@${tag} ` + input.slice(mention.end)
    setInput(next)
    setMention(null); setMentionIdx(0)
    requestAnimationFrame(() => {
      const el = composerRef.current
      if (el) { const pos = mention.start + tag.length + 2; el.focus(); el.setSelectionRange(pos, pos) }
    })
  }
  // Pick + upload an attachment (image downsized first). Held as `pendingAtt` until send.
  const onAttach = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { setAiNote("That file is over 25MB — pick a smaller one."); return }
    setAttaching(true); setAiNote(null)
    try {
      const dataUrl = await fileToUploadUrl(file)
      const r = await uploadChatAttachment(dataUrl, file.name)
      if (r.error || !r.url) throw new Error(r.error || "Upload failed")
      setPendingAtt({ url: r.url, name: r.name || file.name, mime: r.mime, size: r.size })
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : "Couldn't attach that file.")
    } finally { setAttaching(false); if (attachRef.current) attachRef.current.value = "" }
  }

  // Insert an emoji at the caret (or replacing a selection), then refocus after it.
  const insertEmoji = (emoji: string) => {
    const el = composerRef.current
    const start = el?.selectionStart ?? input.length
    const end = el?.selectionEnd ?? start
    setInput(input.slice(0, start) + emoji + input.slice(end))
    setEmojiOpen(false)
    requestAnimationFrame(() => { if (el) { const pos = start + emoji.length; el.focus(); el.setSelectionRange(pos, pos) } })
  }

  const isInbox = active?.kind === "inbox" // staff answering a seller's support thread
  // Announcements are a broadcast, not a conversation — the server 403s a non-admin
  // write, so the composer must say so rather than letting the send fail silently.
  const readOnly = active?.kind === "announce" && !isAdmin

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
    // A message may be just an attachment (no text), so allow either.
    if ((!text && !pendingAtt) || !activeId || sending) return
    setSending(true)
    setInput(""); setMention(null)
    const att = pendingAtt; setPendingAtt(null)
    const clientId = `c-${cidBase.current}-${cidSeq.current++}`
    // Staff post as 'staff' ONLY when answering SOMEONE ELSE's support thread — that's what
    // lets the seller see a named teammate replied. But on their OWN "Ask EGFULFILL" thread
    // the staffer is the ASKER, so they post as 'seller'; otherwise the AI mapper reads it as
    // an assistant turn and never answers (the regression this fixes).
    const myRole = (isStaffUser && activeId !== supportId) ? "staff" : "seller"
    setMessages((prev) => [...(prev ?? []), { id: clientId, role: myRole, by: myName, text, ts: nowMs(), attachment: att ?? undefined }])
    try {
      await postOrderMessage(activeId, text, { clientId, by: myName, role: myRole, attachment: att })
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
          else if (r.ok && r.escalated) { if (r.office) setOffice(r.office); await load(); setAiNote(queueNote(r.office ?? office)) }
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
    setAiNote(queueNote(office))
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
    <>
    {/* One height for everyone: staff and sellers both render this through the same shell
        (topbar 3.5rem + main py-6 = 6.5rem, plus a little slack). The staff branch used
        to subtract only the topbar, so the pane ran 3rem taller than its space — the
        PAGE scrolled and the composer fell below the fold. min-h-0 lets the inner panes
        own their own scrolling instead of growing the container as threads are added. */}
    <div className="flex h-[calc(100svh-7rem)] min-h-0 gap-4">
      {/* conversation rail */}
      <aside className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card md:flex">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="font-semibold">Conversations</span>
          {/* Support team (not designers, who don't handle seller support): live hours
              status, click to view/edit. Matches the inbox carve-out above. */}
          {isStaffUser && !isDesigner && (
            <button onClick={() => setHoursOpen(true)} title="Support hours"
              className={"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent " +
                (office ? (office.open ? "border-emerald-300 text-emerald-700 dark:text-emerald-300" : "border-amber-300 text-amber-700 dark:text-amber-300") : "border-border text-muted-foreground")}>
              <span className={"size-1.5 rounded-full " + (office ? (office.open ? "bg-emerald-500" : "bg-amber-500") : "bg-muted-foreground/50")} />
              {office ? (office.open ? "Open" : "Closed") : "Hours"}
            </button>
          )}
        </div>
        {!signedOut && (
          <div className="border-b border-border p-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isStaffUser && !isDesigner ? "Search or find a seller…" : "Search conversations…"}
              className="h-9"
              aria-label="Search conversations"
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {signedOut ? (
            <div className="p-4 text-sm text-muted-foreground">Sign in to see your conversations.</div>
          ) : convos.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
          ) : (
            shown.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={"flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent " + (c.id === activeId ? "bg-accent" : "")}
              >
                <span className={"flex size-9 shrink-0 items-center justify-center rounded-full " + (c.kind === "support" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  {convoIcon(c.kind)}
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

          {/* Seller directory — only sellers who aren't already in the rail above,
              so the same person never appears twice. */}
          {!signedOut && found.filter((s) => !shown.some((c) => c.id === s.channel)).length > 0 && (
            <>
              <div className="border-b border-border bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Start a conversation
              </div>
              {found.filter((s) => !shown.some((c) => c.id === s.channel)).map((s) => (
                <button
                  key={s.channel}
                  onClick={() => openSeller(s)}
                  className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Package size={16} weight="duotone" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.email}</span>
                  </span>
                </button>
              ))}
            </>
          )}

          {/* A search that finds nothing must not look like a broken rail. */}
          {!signedOut && search.trim() && shown.length === 0 && found.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              No conversations{isStaffUser && !isDesigner ? " or sellers" : ""} match “{search.trim()}”.
            </div>
          )}
        </div>
      </aside>

      {/* active thread */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
        {/* header — also the mobile conversation switcher */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className={"flex size-9 shrink-0 items-center justify-center rounded-full " + (isSupport ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
            {convoIcon(active?.kind, 17)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{active?.title || "Chat"}</div>
            <div className="truncate text-xs text-muted-foreground">{isSupport ? "Assistant replies instantly; the team follows up" : active?.sub || "Conversation"}</div>
          </div>
          {convos.length > 1 && (
            <select
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
              className="eg-select h-8 max-w-[45%] rounded-2xl border border-border bg-card px-2 text-xs md:hidden transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Switch conversation"
            >
              {convos.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
        </div>

        {/* Out-of-office notice — persistent (doesn't scroll), shown to the seller whenever
            the team is closed, so a human's silence reads as "after hours", not "ignored".
            The assistant still answers below; this just sets expectations about people. */}
        {isSupport && !isStaffUser && office && !office.open && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            <Moon size={14} weight="fill" className="mt-0.5 shrink-0" />
            <span>
              <strong>Our team is out of office.</strong>{office.resumesLabel ? ` We&apos;re back ${office.resumesLabel}.` : ""}{" "}
              Leave a message — a teammate will reply here, and email you, when we return. The assistant can still look up your orders now.
            </span>
          </div>
        )}

        {/* messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {signedOut ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">Sign in to chat.</div>
          ) : messages === null ? (
            <div className="flex h-full items-center justify-center text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                {convoIcon(active?.kind, 21)}
              </span>
              <div className="font-medium">{isSupport ? "How can we help?" : active?.kind === "staff" ? "Factory channel" : active?.kind === "announce" ? "Announcements" : `Chat with ${active?.title ?? "this seller"}`}</div>
              <div className="max-w-xs text-sm text-muted-foreground">
                {isSupport ? "Ask about an order, billing, integrations — mention an order with @ to pull it in. Our assistant answers from your account, and a teammate follows up when needed."
                  : active?.kind === "staff" ? "Internal team chat — production, artwork, and orders in one room. Mention an order with @ to pull it in."
                  : active?.kind === "announce" ? "Product news and service updates from EGFULFILL."
                  : "Everything this seller has asked about, in one thread."}
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
                // In the support thread the SELLER is on one side and the SUPPORT side
                // (assistant + human staff) on the other, whichever end is viewing — so a
                // teammate's reply is never mistaken for the seller's own message. Other
                // channels keep the plain seller-on-the-right convention.
                const role = m.role ?? "seller"
                // "Mine" is by IDENTITY, not role — the Factory channel is staff↔staff, where
                // role can't tell me from a teammate, and role-based sides put everyone on one
                // side. Prefer the server's `me` flag; fall back to a name match so it's right
                // before the backend redeploy. The assistant is never "mine".
                const mine = m.me !== undefined ? m.me : (role !== "assistant" && !!m.by && m.by === myName)
                const isAi = role === "assistant"
                // The one-time "a human joined" divider goes right before their first message.
                const joined = joinAt && String(m.id) === joinAt.id ? joinAt.by : null
                // The AI order brief. Only staff ever receive it (the server filters
                // internal messages out of a seller's read), and it's styled as a
                // note rather than a bubble so nobody mistakes it for something the
                // seller can see.
                if (m.internal) return (
                  <div key={String(m.id)} className="rounded-xl border border-dashed border-primary/40 bg-primary/[0.04] p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      <Sparkle size={12} weight="fill" />
                      {m.by || "Order brief"}
                      <span className="ml-auto font-normal normal-case tracking-normal text-muted-foreground">Staff only — not shown to the seller</span>
                    </div>
                    <div className="text-sm [&_ul]:my-0 [&_ul]:pl-4"><Markdown>{m.text ?? ""}</Markdown></div>
                  </div>
                )
                return (
                  <Fragment key={String(m.id)}>
                    {joined && (
                      <div className="my-1.5 flex items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground">
                        <span className="h-px flex-1 bg-border" />
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                          <Headset size={12} weight="fill" /> {joined} joined the conversation
                        </span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <div className={"flex flex-col " + (mine ? "items-end" : "items-start")}>
                      <div className={"max-w-[75%] rounded-2xl px-3.5 py-2 text-sm " + (mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                        {/* Markdown when the text has markdown syntax, verbatim otherwise —
                            decided by CONTENT, not by which side is viewing. This is what
                            fixes the factory view: an AI reply is "mine" there, and the old
                            `mine ? m.text` branch showed its ** raw. A plain typed message
                            (literal *asterisks*, line breaks) still renders exactly as sent. */}
                        {m.text ? (hasMarkdown(m.text) ? <Markdown>{m.text}</Markdown> : <span className="whitespace-pre-wrap">{m.text}</span>) : null}
                        {(() => {
                          const att = m.attachment as ChatAttachment | undefined
                          if (!att?.url) return null
                          const isImg = (att.mime || "").startsWith("image/")
                          return (
                            <a href={att.url} target="_blank" rel="noreferrer" className={"block " + (m.text ? "mt-1.5" : "")}>
                              {isImg ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={att.url} alt={att.name || "attachment"} className="max-h-60 max-w-full rounded-lg border border-border object-contain" />
                              ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2 py-1 text-xs font-medium underline-offset-2 hover:underline">
                                  <FileText size={14} weight="duotone" />{att.name || "file"}
                                </span>
                              )}
                            </a>
                          )
                        })()}
                      </div>
                      <span className="mt-0.5 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
                        {m.orderRef && (
                          // Which order this is about — the context the per-order
                          // channels used to carry in their name.
                          <a href={`/orders/${m.orderRef}`} className="rounded-full bg-muted px-1.5 py-0.5 font-medium hover:underline">
                            <Package size={9} weight="duotone" className="mr-0.5 inline" />{m.orderRef}
                          </a>
                        )}
                        <span>
                          {!mine ? `${m.by || (isAi ? "EGFULFILL Assistant" : isSupport ? "Support" : "Factory")} · ` : ""}
                          {fmtTime(m.ts)}
                        </span>
                      </span>
                    </div>
                  </Fragment>
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

        {/* staged attachment preview */}
        {pendingAtt && (
          <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-xs">
            {pendingAtt.mime?.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pendingAtt.url} alt="" className="size-8 rounded border border-border object-cover" />
            ) : (
              <FileText size={16} weight="duotone" className="text-muted-foreground" />
            )}
            <span className="truncate font-medium">{pendingAtt.name}</span>
            <button onClick={() => setPendingAtt(null)} className="ml-auto shrink-0 text-muted-foreground hover:text-foreground" aria-label="Remove attachment"><X size={14} /></button>
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
          {/* Attach a file (images downsized before upload) */}
          <input ref={attachRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onAttach(e.target.files?.[0])} />
          <Button variant="ghost" size="icon" className="size-10 shrink-0" onClick={() => attachRef.current?.click()}
            disabled={signedOut || !activeId || readOnly || attaching} aria-label="Attach a file">
            {attaching ? <CircleNotch size={16} className="animate-spin" /> : <Paperclip size={18} />}
          </Button>
          {/* Emoji picker */}
          <div className="relative shrink-0">
            <Button variant="ghost" size="icon" className="size-10" onClick={() => setEmojiOpen((o) => !o)}
              disabled={signedOut || !activeId || readOnly} aria-label="Emoji">
              <Smiley size={18} />
            </Button>
            {emojiOpen && (
              <>
                {/* click-away to close */}
                <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setEmojiOpen(false)} />
                <div className="absolute bottom-full left-0 z-20 mb-1 grid w-72 grid-cols-8 gap-0.5 rounded-lg border border-border bg-card p-2 shadow-lg">
                  {EMOJIS.map((e) => (
                    <button key={e} type="button" onMouseDown={(ev) => { ev.preventDefault(); insertEmoji(e) }}
                      className="rounded p-1 text-lg leading-none hover:bg-accent" aria-label={`Insert ${e}`}>{e}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="relative flex-1">
            {/* @-mention autocomplete: type "@" then part of a teammate's name or an order
                number/name, and pick one — a person gets notified, an order gets tagged.
                Keyboard-navigable, dropped in above the box. */}
            {mention && mentionMatches.length > 0 && (
              <div className="absolute bottom-full left-0 z-20 mb-1 w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Mention a teammate or tag an order</div>
                {mentionMatches.map((it, i) => (
                  <button
                    key={it.kind === "person" ? `p-${it.p.id}` : `o-${it.o.id}`}
                    type="button"
                    // mousedown, not click: fire before the input blurs so the caret + token
                    // are still intact when we splice the tag in.
                    onMouseDown={(e) => { e.preventDefault(); pickMention(it) }}
                    onMouseEnter={() => setMentionIdx(i)}
                    className={"flex w-full items-center gap-2 px-3 py-2 text-left text-sm " + (i === mentionIdx ? "bg-accent" : "hover:bg-muted/60")}
                  >
                    {it.kind === "person" ? (
                      <>
                        <User size={13} weight="duotone" className="shrink-0 text-primary" />
                        <span className="font-medium">{it.p.name}</span>
                        <span className="ml-auto shrink-0 text-[11px] capitalize text-muted-foreground">{it.p.role}</span>
                      </>
                    ) : (
                      <>
                        <Package size={13} weight="duotone" className="shrink-0 text-muted-foreground" />
                        <span className="font-medium tabular-nums">#{it.o.seq ?? it.o.id}</span>
                        <span className="truncate text-xs text-muted-foreground">{it.o.customer?.name || it.o.store || it.o.source || ""}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{it.o.factory_status || it.o.status || ""}</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
            <Input
              ref={composerRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); if (!readOnly) detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length) }}
              onKeyDown={(e) => {
                if (mention && mentionMatches.length) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionMatches.length); return }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionMatches[mentionIdx]); return }
                  if (e.key === "Escape") { e.preventDefault(); setMention(null); return }
                }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() }
              }}
              placeholder={signedOut ? "Sign in to send a message" : readOnly ? "Only EGFULFILL can post announcements" : "Type a message…  @ to tag an order"}
              disabled={signedOut || !activeId || readOnly}
              className="h-10 w-full"
            />
          </div>
          <Button size="icon" className="size-10" onClick={send} disabled={signedOut || !activeId || readOnly || (!input.trim() && !pendingAtt) || sending}>
            <PaperPlaneTilt size={16} weight="fill" />
          </Button>
        </div>
      </div>
    </div>

    {isStaffUser && !isDesigner && <SupportHoursEditor open={hoursOpen} onOpenChange={setHoursOpen} isAdmin={isAdmin} onSaved={setOffice} />}
    </>
  )
}

"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PaperPlaneTilt, Headset, CircleNotch, Package, Sparkle, UsersThree, Megaphone, Moon, User, Smiley, Paperclip, X, FileText, ImageSquare, FilmSlate } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { generateDeskImage, generateDeskVideo, getOrderMessages, postOrderMessage, requestAiReply, getMe, getSupportThreads, searchSellers, aiDraft, getSupportAvailability, getOrderMentions, getMentionPeople, uploadChatAttachment, type ChatEntry, type SellerMatch, type SupportThread, type SupportAvailability, type OrderRow, type MentionPerson, type ChatAttachment, getAiQuote, type AiQuote } from "@/lib/api"
import { getUser, getToken } from "@/lib/auth"
import { Markdown, hasMarkdown } from "@/components/app/markdown"
import { SupportHoursEditor } from "@/components/app/support-hours-editor"
import { GenerateButton, AnimateImageButton, type GenSettings } from "@/components/app/generate-menu"
import { UserAvatar } from "@/components/app/user-avatar"

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
type Convo = {
  id: string; kind: "support" | "staff" | "inbox" | "announce" | "gen"; title: string; sub: string
  escalated?: boolean
  /** Incoming messages since our last reply — the unread badge. Zero once answered, which
   *  is how every other messenger behaves: the badge is a to-do, not a size. */
  count?: number
  /** The person's own avatar, when the row is a person. */
  avatar?: { name?: string | null; avatar_emoji?: string | null; avatar_color?: string | null } | null
}
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
  /* What the message box is armed to MAKE. Null = it posts a message, as always. Set from
     the ✨ panel or from Animate on a picture; shown as a pill above the box so the mode and
     its price stay visible the whole time you're typing, not just when you chose them. */
  const [gen, setGen] = useState<GenSettings | null>(null)
  /* When a clip was requested. The server posts the finished video into the thread minutes
     later, so the indicator can't hang off the request — it hangs off "no video newer than
     this has arrived yet". Cleared by a ceiling so a job that never lands stops pretending. */
  const [videoAt, setVideoAt] = useState<number | null>(null)
  const videoWorking = useMemo(() => {
    if (!videoAt) return false
    return !(messages ?? []).some((m) => {
      const a = m.attachment as ChatAttachment | undefined
      return a?.mime?.startsWith("video/") && (m.ts ?? 0) >= videoAt
    })
  }, [videoAt, messages])
  const [office, setOffice] = useState<SupportAvailability | null>(null)
  const [hoursOpen, setHoursOpen] = useState(false)  // staff: support-hours editor dialog
  const [emojiOpen, setEmojiOpen] = useState(false)  // composer emoji picker
  const [pendingAtt, setPendingAtt] = useState<ChatAttachment | null>(null)  // staged attachment
  const [attaching, setAttaching] = useState(false)
  /* Drag counter, not a boolean. dragenter/dragleave fire for every child element the
     pointer crosses, so a plain flag flickers off the moment you move over a message. */
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
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
  /*
   * Sellers may generate IMAGES when an admin has switched it on, and they pay for each one
   * from their wallet. The quote is read from the server rather than inferred from the role,
   * because "switched on" is a setting and only the server knows it — and the price shown
   * beside the button has to be the price actually charged.
   *
   * Video is not sold: `allowVideo` stays admin-only below.
   */
  const [aiQuote, setAiQuote] = useState<AiQuote | null>(null)
  useEffect(() => {
    const t = setTimeout(() => { getAiQuote().then(setAiQuote).catch(() => setAiQuote(null)) }, 0)
    return () => clearTimeout(t)
  }, [])
  const genChannel = aiQuote && !aiQuote.staff && aiQuote.enabled ? aiQuote.genChannel ?? null : null
  const canGenerate = isAdmin || !!aiQuote?.enabled
  /*
   * WHERE THE CONTROL LIVES HAS TO MATCH WHERE THE IMAGE LANDS.
   *
   * Staff generate into their own "My EG" assistant thread. A seller's images go to their
   * Generations channel — so gating the button on the support thread left sellers looking at
   * the very channel their images arrive in, with no way to make one.
   */
  const genHere = genChannel ? activeId === genChannel : activeId === supportId
  const priceNote = !aiQuote || aiQuote.staff ? null
    : aiQuote.freeLeft > 0
      ? `${aiQuote.freeLeft} free image${aiQuote.freeLeft === 1 ? "" : "s"} left this month, then $${aiQuote.imagePrice.toFixed(2)} each.`
      : `$${aiQuote.imagePrice.toFixed(2)} per image, charged to your wallet.`
  // Designers work artwork for the factory and aren't part of seller conversations, so
  // they get the artwork threads instead of the seller support inbox (which 403s).
  const isDesigner = getUser()?.role === "designer"

  useEffect(() => {
    cidBase.current = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  }, [])

  // Everyone gets an EGFUL Support thread (support-<uid>); staff ALSO get the shared
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
    if (supportId) list.push({ id: supportId, kind: "support", title: isStaffUser ? "My EG" : "EGFUL Support", sub: isStaffUser ? "Your AI assistant" : "Assistant + team" })
    /*
     * GENERATIONS — the account's own channel, so AI images stop arriving in the middle of a
     * support conversation staff are reading. Listed only when the server says this account
     * has one (it names the id: a team member cannot derive their owner's account id).
     */
    if (genChannel) list.push({ id: genChannel, kind: "gen", title: "Generations", sub: "Images you have made with AI" })
    // Admin writes, everyone else reads. Designers aren't part of seller-facing comms.
    if (!isDesigner) list.push({ id: ANNOUNCE_CHANNEL, kind: "announce", title: "Announcements", sub: isAdmin ? "Broadcast to all sellers" : "From EGFUL" })
    /**
     * NEWEST MESSAGE FIRST, under the pinned channels.
     *
     * Escalated threads were floated to the top, on the argument that an explicit request
     * for a human should not be buried. In an inbox someone is WORKING, it buries the thing
     * they are actually mid-sentence with: a reply arrives, the row does not move, and the
     * conversation you were in sits below two older ones that carry a flag. The flag is
     * still on the row and still legible — "Needs a human" — which is what makes it
     * findable without also making it the sort.
     *
     * The server already returns `last_at desc`; this sorts explicitly rather than relying
     * on it, so the rail cannot quietly change meaning if that query is ever reordered.
     */
    if (isStaffUser) for (const t of [...inbox].sort((a, b) => (b.last_at || 0) - (a.last_at || 0))) {
      if (t.order_id === supportId) continue // don't list my own thread twice
      list.push({
        id: t.order_id, kind: "inbox", title: t.seller_name || t.seller_id,
        sub: t.last ? t.last.slice(0, 40) : "Support request", escalated: !!t.escalated, count: t.unanswered ?? 0,
        avatar: { name: t.seller_name, avatar_emoji: t.avatar_emoji, avatar_color: t.avatar_color },
      })
    }
    // Channels opened from the directory that have no messages yet, so they don't
    // vanish from the rail the moment you click one.
    for (const c of opened) if (!list.some((x) => x.id === c.id)) list.push(c)
    return list
  }, [isStaffUser, isDesigner, isAdmin, supportId, inbox, opened, genChannel])

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

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0; setDragging(false)
    if (signedOut || !activeId || readOnly) return
    const file = e.dataTransfer.files?.[0]
    if (file) void onAttach(file)
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

  /**
   * THE RAIL ITSELF HAS TO REFRESH, or the badge is a number from whenever the page opened.
   *
   * The thread list was fetched exactly once, on mount. So a conversation that arrived while
   * you were reading another one never appeared, the order never re-sorted, and the unread
   * count could only ever change by reloading the page — which is most of the reason the
   * badge looked stuck. The open thread polls every 5s; the list is cheaper to be wrong
   * about and noisier to re-render, so it goes at 20.
   *
   * Staff only: a seller has no inbox to poll.
   */
  const refreshRail = useCallback(() => {
    if (!isStaffUser || isDesigner) return
    getSupportThreads().then((rows) => { if (rows) setInbox(rows) }).catch(() => {})
  }, [isStaffUser, isDesigner])

  useEffect(() => {
    if (!isStaffUser || isDesigner) return
    const iv = setInterval(refreshRail, 20000)
    return () => clearInterval(iv)
  }, [isStaffUser, isDesigner, refreshRail])

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

  /*
   * The composer is armed: this text is a PROMPT, not a message. Same box, same Enter key —
   * the pill above it is what says where the words are going. Generation posts its own
   * result into the thread, so nothing is echoed here first.
   */
  const generateFromComposer = async (text: string) => {
    if (!gen || !text) return
    setSending(true); setAiNote(null)
    try {
      if (gen.mode === "image") {
        const refs = pendingAtt?.url && pendingAtt.mime?.startsWith("image/")
          ? [pendingAtt.url.split("/api/support/asset/")[1]].filter(Boolean)
          : []
        const r = await generateDeskImage({
          prompt: text, aspectRatio: gen.ratio, imageSize: gen.size, model: gen.model,
          imageNames: refs.length ? refs : undefined,
        })
        if (!r.ok || !r.attachment) {
          // Keep the words the user typed — losing a prompt to a transient failure means
          // typing it again, and an overload is exactly the case that wants a second press.
          setInput(text)
          setAiNote(r.error || "That didn't work.")
          return
        }
        setInput(""); setPendingAtt(null)
        await load()
      } else {
        const r = await generateDeskVideo({
          prompt: text, aspectRatio: gen.ratio, resolution: gen.resolution,
          durationSeconds: gen.seconds, model: gen.model, imageName: gen.imageName,
        })
        if (!r.ok || !r.jobId) { setInput(text); setAiNote(r.error || "That didn't work."); return }
        setInput("")
        setVideoAt(nowMs())
        // Matches the server's 12-minute abandon ceiling, plus slack for the upload.
        setTimeout(() => setVideoAt(null), 13 * 60 * 1000)
        setAiNote(`Making a ${r.seconds ?? gen.seconds}s clip (~$${(r.usd ?? gen.usd).toFixed(2)}) — it lands in this chat in a minute or two.`)
        setTimeout(() => setAiNote(null), 12000)
      }
    } catch (e) {
      setInput(text)
      setAiNote(e instanceof Error ? e.message : "That didn't work.")
    } finally {
      setSending(false)
    }
  }

  const submit = async (raw: string) => {
    const text = raw.trim()
    // Armed = the box is a prompt. Checked before the attachment-only case below, because a
    // generation always needs words even though a plain message doesn't.
    if (gen) { await generateFromComposer(text); return }
    // A message may be just an attachment (no text), so allow either.
    if ((!text && !pendingAtt) || !activeId || sending) return
    setSending(true)
    setInput(""); setMention(null)
    const att = pendingAtt; setPendingAtt(null)
    const clientId = `c-${cidBase.current}-${cidSeq.current++}`
    // Staff post as 'staff' ONLY when answering SOMEONE ELSE's support thread — that's what
    // lets the seller see a named teammate replied. But on their OWN "Ask EGFUL" thread
    // the staffer is the ASKER, so they post as 'seller'; otherwise the AI mapper reads it as
    // an assistant turn and never answers (the regression this fixes).
    const myRole = (isStaffUser && activeId !== supportId) ? "staff" : "seller"
    setMessages((prev) => [...(prev ?? []), { id: clientId, role: myRole, by: myName, text, ts: nowMs(), attachment: att ?? undefined }])
    try {
      await postOrderMessage(activeId, text, { clientId, by: myName, role: myRole, attachment: att })
      await load()
      /**
       * ANSWERED — so the badge goes now, not at the next poll.
       *
       * The count is what is waiting on US, and the reply that just landed is the thing
       * that settles it. The server works this out too, but it is read on a 20-second
       * timer, and typing an answer while the number sits there unchanged is exactly the
       * "it's still there" this was meant to fix. Cleared locally first, then reconciled —
       * if the seller writes again a second later, the next refresh puts a 1 back, which
       * is correct rather than a flicker.
       *
       * Only for a reply into SOMEONE ELSE's thread. On your own My EG thread you are the
       * asker, and there is no badge to clear.
       */
      if (myRole === "staff") {
        setInbox((prev) => prev.map((t) => (t.order_id === activeId ? { ...t, unanswered: 0 } : t)))
        refreshRail()
      }
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
          // A deliberate no-op still has to SAY so. These two branches rendered nothing at
          // all, which is indistinguishable from a broken assistant — and that is precisely
          // why "it doesn't work" was undiagnosable. The server now sends a human reason.
          else if (r.ok && r.skipped) { await load(); setAiNote(r.reason ? `Nothing to answer yet — ${r.reason}.` : "Nothing new to answer yet.") }
          else if (r.ok && r.escalated) { if (r.office) setOffice(r.office); await load(); setAiNote(queueNote(r.office ?? office)) }
          // `unavailable` = the server couldn't READ its settings (a database blip during a
          // deploy). Distinct from "no key", which is a thing an admin can act on.
          else if (r.unavailable) setAiNote(r.error || "The assistant is briefly unavailable. Try again in a moment.")
          // Three different things used to share this one sentence, and two of them sent the
          // reader to Settings to fix a key that was never the problem. `reason` says which.
          else if (r.disabled) setAiNote(
            r.reason === "seller-auto-reply-off"
              ? "Automatic replies are off here — a teammate will answer you directly."
              : "The assistant is off — an admin can add the AI key in Settings → Integrations. A teammate will follow up.")
          else if (r.error) setAiNote(`Assistant couldn't reply (${r.error}). A teammate will follow up.`)
          else if (r.empty) setAiNote(r.reason ? `Nothing to answer yet — ${r.reason}.` : "Nothing to answer yet.")
          else setAiNote(null)
        } catch {
          // "A teammate will follow up" is true of a SELLER's thread, which has a queue
          // behind it. My EG has no one behind it but the model, so the same sentence there
          // promises an admin a person who is never coming.
          setAiNote(isStaffUser
            ? "The assistant didn't answer that one — try again in a moment."
            : "Assistant is unavailable right now — a teammate will follow up here.")
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
              className={"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium transition-colors hover:bg-accent " +
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
                {/* THE PERSON, not a parcel. Every row drew the same glyph, so an inbox of
                    eight conversations looked like eight copies of one thing and the only way
                    to find the one you were mid-sentence with was to read names. The pinned
                    channels (Announcements, Factory, My EG) keep their icons — those are
                    places, not people. A website visitor has no account, so UserAvatar falls
                    back to their initial rather than inventing a face. */}
                {c.avatar ? (
                  <UserAvatar
                    user={{
                      name: c.avatar.name ?? undefined,
                      avatar_emoji: c.avatar.avatar_emoji ?? null,
                      avatar_color: c.avatar.avatar_color ?? null,
                    }}
                    size={36}
                    className="shrink-0"
                  />
                ) : (
                  <span className={"flex size-9 shrink-0 items-center justify-center rounded-full " + (c.kind === "support" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                    {convoIcon(c.kind)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{c.title}</span>
                    {/* HOW MUCH IS IN IT, not a flag about it.
                        "Needs a human" is gone: it was a second ordering signal competing
                        with the sort, and once the newest conversation is at the top the
                        flag says nothing the position doesn't — an unanswered request IS
                        the most recent message. Amber is also a reserved floor status
                        (warning / on hold), which a chat row has no business borrowing.
                        The count is what a rail row can usefully carry: how long this
                        conversation is before you open it. */}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{c.sub}</span>
                </span>
                {/* A COUNT BADGE, the shape every messenger uses: a filled circle at the end
                    of the row, vertically centred, read at a glance without being read as
                    text. It was a grey pill beside the name, which sat in the title's line
                    and competed with it for the same left-to-right reading.
                    --primary, which is what fills buttons here; the reserved status colours
                    (amber hold, red alert) stay out of a row that is only saying "there are
                    twelve messages in this". min-w keeps it circular at one digit and lets
                    it grow for "99+" instead of clipping.
                    It counts what is UNANSWERED, not how long the thread is: reply and it
                    clears on the next load, ignore it and it stays — a to-do, the way every
                    other messenger reads. */}
                {!!c.count && (
                  <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-2xs font-bold tabular-nums text-primary-foreground">
                    {c.count > 99 ? "99+" : c.count}
                  </span>
                )}
              </button>
            ))
          )}

          {/* Seller directory — only sellers who aren't already in the rail above,
              so the same person never appears twice. */}
          {!signedOut && found.filter((s) => !shown.some((c) => c.id === s.channel)).length > 0 && (
            <>
              <div className="border-b border-border bg-muted/40 px-4 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
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
        {/* The drop overlay must sit OUTSIDE the scrolling element: as a child it is
            positioned against the scroll CONTENT, so it slides away the moment the thread is
            scrolled. This wrapper doesn't scroll, so the overlay stays over what you can see.
            Drag handlers live here too, covering the whole reading area rather than the strip
            of it that happens to be in view. */}
        <div
          className="relative min-h-0 flex-1"
          onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; if (e.dataTransfer.types?.includes("Files")) setDragging(true) }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) }}
          onDrop={onDrop}
        >
          <div ref={scrollRef} className="h-full space-y-3 overflow-y-auto p-5">
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
                  : active?.kind === "announce" ? "Product news and service updates from EGFUL."
                  : active?.kind === "gen" ? "Describe what you want and press Generate. Images you make appear here."
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
                    <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-primary">
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
                      <div className="my-1.5 flex items-center gap-2 px-1 text-2xs font-medium text-muted-foreground">
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
                          const isVid = (att.mime || "").startsWith("video/")
                          // The server animates by bare asset NAME, so only an image we
                          // stored for this chat can be one — anything else has no name to give.
                          const assetName = isImg ? att.url.split("/api/support/asset/")[1] : undefined
                          const canAnimate = !!assetName && isAdmin && activeId === supportId
                          // w-fit, not a bare block: the overlay anchors to this link, and a
                          // full-width block put "Animate" at the BUBBLE's right edge,
                          // floating in space beside the picture instead of on it.
                          /*
                           * A CLIP PLAYS HERE. It arrived as a file chip — an icon and a
                           * filename — which is a poor way to hand someone a video they just
                           * paid for and have to judge before using.
                           *
                           * Not wrapped in the link the other attachments use: the controls
                           * are clickable, and every press of play or scrub would have
                           * navigated the tab away to the raw file instead.
                           */
                          if (isVid) {
                            return (
                              <div className={"w-fit " + (m.text ? "mt-1.5" : "")}>
                                <video
                                  src={att.url} controls playsInline preload="metadata"
                                  className="max-h-[30rem] w-full max-w-[26rem] rounded-lg border border-border bg-black"
                                />
                                <a href={att.url} target="_blank" rel="noreferrer"
                                   className="mt-1 inline-block text-2xs text-muted-foreground underline-offset-2 hover:underline">
                                  Open full size
                                </a>
                              </div>
                            )
                          }
                          return (
                            <a href={att.url} target="_blank" rel="noreferrer" className={"relative block w-fit " + (m.text ? "mt-1.5" : "")}>
                              {isImg ? (
                                <>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={att.url} alt={att.name || "attachment"} className="max-h-[30rem] max-w-full rounded-lg border border-border object-contain" />
                                  {canAnimate && (
                                    <AnimateImageButton imageName={assetName} imageUrl={att.url} onArm={setGen} />
                                  )}
                                </>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2 py-1 text-xs font-medium underline-offset-2 hover:underline">
                                  <FileText size={14} weight="duotone" />{att.name || "file"}
                                </span>
                              )}
                            </a>
                          )
                        })()}
                      </div>
                      <span className="mt-0.5 flex items-center gap-1.5 px-1 text-2xs text-muted-foreground">
                        {m.orderRef && (
                          // Which order this is about — the context the per-order
                          // channels used to carry in their name.
                          <a href={`/orders/${m.orderRef}`} className="rounded-full bg-muted px-1.5 py-0.5 font-medium hover:underline">
                            <Package size={9} weight="duotone" className="mr-0.5 inline" />{m.orderRef}
                          </a>
                        )}
                        <span>
                          {!mine ? `${m.by || (isAi ? "EGFUL Assistant" : isSupport ? "Support" : "Factory")} · ` : ""}
                          {fmtTime(m.ts)}
                        </span>
                      </span>
                    </div>
                  </Fragment>
                )
              })}
              {((gen && sending) || videoWorking) && (
                <div className="flex items-start">
                  <div className="flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-2.5">
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.2s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.1s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {videoWorking ? "Making your clip — this takes 1–3 minutes…" : "Making your image…"}
                    </span>
                  </div>
                </div>
              )}
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

          {/* Opaque, not tinted. A translucent wash over live messages read as a glitch —
              the thread was still legible underneath and the dashed box looked like it had
              landed on top of a conversation. Covering it outright makes the target the only
              thing on screen, which is the whole job of a drop zone.
              pointer-events-none on purpose: the overlay must not generate its own
              dragenter/dragleave, or the depth counter it depends on never returns to zero. */}
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background p-6">
              <div className="flex w-full max-w-sm flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-primary/40 px-8 py-12 text-center">
                <Paperclip size={24} weight="duotone" className="text-primary" />
                <span className="text-sm font-medium text-foreground">Drop to attach</span>
                <span className="text-xs text-muted-foreground">
                  {gen?.mode === "image" ? "It goes in as a reference for the image" : "Image or PDF, up to 25MB"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* seller: escalate to a human on the support thread */}
        {isSupport && !isStaffUser && !signedOut && (
          <div className="flex items-center justify-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>Not what you needed?</span>
            <button onClick={escalate} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
              Talk to a human
            </button>
          </div>
        )}

        {/* staged attachment preview */}
        {/* COMPOSER — one container, the way a modern chat box reads: what you've attached
            sits on top, the words go in the middle, and the controls live underneath instead
            of crowding the text field from both sides. The whole box takes the focus ring, so
            it behaves as a single control rather than an input with buttons parked beside it. */}
        <div className="border-t border-border p-3">
          <div className={"rounded-2xl border bg-card transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/30 " + (dragging ? "border-primary/50" : "border-input")}>

            {/* Attachment as a THUMBNAIL, not a filename row. You attached a picture to look
                at it; a row of text made you take that on trust. */}
            {/* ANIMATING a still: show WHICH one. Pressing Animate on a picture used to look
                exactly like choosing Video in the panel — same armed button, no sign of the
                frame — so it was impossible to tell whether the cat was involved. */}
            {gen?.imageUrl && (
              <div className="flex items-center gap-2 p-2 pb-0">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={gen.imageUrl} alt="" className="size-16 rounded-lg border border-border object-cover" />
                  <button
                    onClick={() => setGen(null)} aria-label="Don't animate this"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background shadow-sm transition-colors hover:bg-foreground"
                  >
                    <X size={11} weight="bold" />
                  </button>
                </div>
                <span className="text-2xs text-muted-foreground">animating this still</span>
              </div>
            )}
            {pendingAtt && (
              <div className="flex flex-wrap gap-2 p-2 pb-0">
                <div className="group relative">
                  {pendingAtt.mime?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pendingAtt.url} alt={pendingAtt.name} className="size-16 rounded-lg border border-border object-cover" />
                  ) : (
                    <div className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-muted/50 px-1">
                      <FileText size={18} weight="duotone" className="text-muted-foreground" />
                      <span className="w-full truncate text-center text-2xs text-muted-foreground">{pendingAtt.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => setPendingAtt(null)} aria-label="Remove attachment"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background shadow-sm transition-colors hover:bg-foreground"
                  >
                    <X size={11} weight="bold" />
                  </button>
                </div>
                {gen && <span className="self-end pb-1 text-2xs text-muted-foreground">used as a reference</span>}
              </div>
            )}

            <div className="relative">
              {/* @-mention autocomplete: type "@" then part of a teammate's name or an order
                  number/name, and pick one — a person gets notified, an order gets tagged. */}
              {mention && mentionMatches.length > 0 && (
                <div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                  <div className="border-b border-border px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Mention a teammate or tag an order</div>
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
                          <span className="ml-auto shrink-0 text-2xs capitalize text-muted-foreground">{it.p.role}</span>
                        </>
                      ) : (
                        <>
                          <Package size={13} weight="duotone" className="shrink-0 text-muted-foreground" />
                          <span className="font-medium tabular-nums">#{it.o.seq ?? it.o.id}</span>
                          <span className="truncate text-xs text-muted-foreground">{it.o.customer?.name || it.o.store || it.o.source || ""}</span>
                          <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{it.o.factory_status || it.o.status || ""}</span>
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
                placeholder={signedOut ? "Sign in to send a message"
                  : readOnly ? "Only EGFUL can post announcements"
                  : gen ? (gen.mode === "image" ? "Describe the image…"
                    : gen.imageName ? "Describe the motion for this still…"
                    : "Describe the video to make…")
                  : "Type a message…  @ to tag an order"}
                disabled={signedOut || !activeId || readOnly}
                // Borderless: the CONTAINER is the control now, so a second border inside it
                // would draw a box within a box.
                className="h-12 w-full rounded-none border-0 bg-transparent px-3 text-sm shadow-none focus-visible:ring-0"
              />
            </div>

            {/* Controls UNDER the text, not flanking it — the field gets its full width back,
                which is what makes a long prompt readable while you write it. */}
            <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
              {/* Generate — STAFF ONLY, and only in the staffer's own "My EG" channel. Each
                  generation bills Google, so it is not offered on a seller thread, a factory
                  room or an inbox conversation; the server enforces the same two rules. */}
              {canGenerate && genHere && (
                <GenerateButton
                  disabled={signedOut || !activeId} armed={gen} onArm={setGen}
                  allowVideo={isAdmin} priceNote={priceNote}
                  /* The Generations channel exists ONLY to generate, so it arms itself. A
                     staffer's "My EG" is a general assistant thread where most messages are
                     not image prompts, and arming it would put a price on the send button
                     for ordinary chat. */
                  autoArm={!!genChannel && activeId === genChannel}
                />
              )}
              <input ref={attachRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onAttach(e.target.files?.[0])} />
              <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => attachRef.current?.click()}
                disabled={signedOut || !activeId || readOnly || attaching} aria-label="Attach a file">
                {attaching ? <CircleNotch size={16} className="animate-spin" /> : <Paperclip size={17} />}
              </Button>
              <div className="relative shrink-0">
                <Button variant="ghost" size="icon" className="size-9" onClick={() => setEmojiOpen((o) => !o)}
                  disabled={signedOut || !activeId || readOnly} aria-label="Emoji">
                  <Smiley size={17} />
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
              {isInbox && (
                <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5 text-muted-foreground" onClick={draftWithAi} disabled={drafting}>
                  {drafting ? <CircleNotch size={14} className="animate-spin" /> : null}
                  Draft with AI
                </Button>
              )}

              <div className="ml-auto" />

              {/* ARMED: this button IS the generate button — it must not still look like
                  "post a message" when pressing it spends money. */}
              <Button
                size={gen ? "sm" : "icon"}
                className={gen ? "h-9 shrink-0 gap-1.5 rounded-full px-3" : "size-9 rounded-full"}
                onClick={send}
                disabled={signedOut || !activeId || readOnly || (!input.trim() && !(pendingAtt && !gen)) || sending}
              >
                {sending && gen ? <CircleNotch size={15} className="animate-spin" />
                  : gen ? (gen.mode === "image" ? <ImageSquare size={15} weight="fill" /> : <FilmSlate size={15} weight="fill" />)
                  : <PaperPlaneTilt size={15} weight="fill" />}
                {gen && <span className="text-xs font-medium">Generate · ~${gen.usd.toFixed(gen.usd < 1 ? 3 : 2)}</span>}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {isStaffUser && !isDesigner && <SupportHoursEditor open={hoursOpen} onOpenChange={setHoursOpen} isAdmin={isAdmin} onSaved={setOffice} />}
    </>
  )
}

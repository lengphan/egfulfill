"use client"

import { useEffect, useRef, useState } from "react"
import { ChatCircleDots, X, PaperPlaneRight, CircleNotch } from "@phosphor-icons/react"
import { ACCENT } from "@/components/marketing/bold-kit"

type Msg = { role: string; text: string; at?: string }

/**
 * The public support bubble — for visitors with no account.
 *
 * WHY THE EMAIL IS ASKED FOR AFTER THE FIRST MESSAGE, not before it. A form standing in
 * front of the box is friction at the exact moment someone is curious, and everyone who
 * bails at it leaves us nothing — not even the question. Asking afterwards keeps the
 * question (the server stores it before it will answer) and still gets an address before
 * any reply is owed, which is what makes a closed tab recoverable.
 *
 * It is also the cost control. Every reply is a paid model call on an unauthenticated
 * endpoint, so the server refuses to answer until there is a name and an address — a small
 * human act in front of the spend. The client mirrors that; the server enforces it.
 */
const KEY = "eg_support_convo"

/**
 * THE THREE MOST-ASKED, ANSWERED WITHOUT SPENDING ANYTHING.
 *
 * They were a strip above the footer — the right questions in the wrong place, because a
 * visitor's question arrives while they are reading a price, not after they have scrolled
 * past everything to the bottom. They live in the bubble now, where the asking happens.
 *
 * Answered from HERE, not by the model: these three have one correct answer each, and
 * paying for a generated one — on an unauthenticated endpoint, at that — would be spending
 * money to be less accurate. It also means clicking one costs no identity gate: nothing is
 * owed, so nothing is asked for. The name and the email are collected at the point a PERSON
 * is wanted, which is the only point they are needed.
 */
const FAQ: { q: string; a: string; href: string; hrefLabel: string }[] = [
  {
    q: "How do I order?",
    a: "Connect Etsy, Shopify or TikTok Shop and your orders arrive in one queue. Pick the blank, place the artwork, submit — we print, pack and ship it, and push tracking back to the marketplace. Nothing is charged until you submit an order.",
    href: "/how-it-works", hrefLabel: "See how it works",
  },
  {
    q: "What does it cost?",
    a: "You pay the blank's base cost plus one parcel fee per order — the price on each product page is what you pay to make it. No subscription, no per-listing fee, and postage is quoted when the order goes to production.",
    href: "/pricing", hrefLabel: "See pricing",
  },
  {
    q: "Do you have an API?",
    a: "Yes — REST, key-authed, with a sandbox that prices and validates exactly as live so you can build against a test key and change one character to go live. Orders, products, stock, billing and webhooks.",
    href: "/docs", hrefLabel: "API documentation",
  },
]

export function SupportBubble() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState("")
  const [convo, setConvo] = useState<string | null>(null)
  const [needIdentity, setNeedIdentity] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  /** Someone asked for a person before there was a conversation to hand over — see escalate. */
  const [pendingEscalate, setPendingEscalate] = useState(false)
  /** A person is on this conversation. Set by the handover and by every read, so it survives
   *  a reload — and it is what takes the "talk to support" offer away once it is answered. */
  const [withPerson, setWithPerson] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  // Resume on this device. Deferred — localStorage doesn't exist during the prerender, and
  // reading it at useState-init time would make server and client markup disagree.
  useEffect(() => {
    const t = setTimeout(() => { try { setConvo(localStorage.getItem(KEY)) } catch {} }, 0)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs, needIdentity])

  /**
   * WATCH FOR A PERSON'S REPLY.
   *
   * Escalating hands the thread to the Conversations rail, where someone answers it — and
   * until now the widget had no way to learn that. It said "we'll reply to your email" and
   * then sat still while the answer went somewhere the visitor could not see.
   *
   * Polling, not a socket: this is an unauthenticated page and the event stream is
   * token-authed, so a socket here would mean a second, public channel to secure for a
   * message that arrives once. Every 8s, and ONLY while the panel is open with a
   * conversation — a closed bubble costs nothing, which is what makes the interval cheap
   * enough to be this simple.
   *
   * The server's copy REPLACES the local thread, so a reply cannot be duplicated by a poll
   * that overlaps a send. The canned answers are the exception and are re-appended below.
   */
  useEffect(() => {
    if (!open || !convo) return
    let live = true
    const read = async () => {
      try {
        const r = await fetch(`/api/public/support/${encodeURIComponent(convo)}`)
        if (!r.ok) return
        const d = await r.json()
        if (!live) return
        if (Array.isArray(d.messages)) setMsgs(d.messages)
        if (d.escalated) setWithPerson(true)
      } catch { /* a failed poll is not worth a notice — the next one is 8s away */ }
    }
    const t = setInterval(read, 8000)
    const first = setTimeout(read, 500)
    return () => { live = false; clearInterval(t); clearTimeout(first) }
  }, [open, convo])

  /** Returns the conversation id, so a caller that created one can act on it immediately —
   *  `convo` is state and is not set yet on the line after this resolves. */
  const send = async (text: string): Promise<string | null> => {
    setBusy(true); setNotice(null)
    try {
      const r = await fetch("/api/public/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convo, message: text, name, email }),
      })
      const d = await r.json()
      if (d.conversationId) {
        setConvo(d.conversationId)
        try { localStorage.setItem(KEY, d.conversationId) } catch {}
      }
      if (Array.isArray(d.messages)) setMsgs(d.messages)
      setNeedIdentity(!!d.needsIdentity)
      if (d.notice) setNotice(d.notice)
      // A refusal (rate limit, or a conversation that has run long) still carries a message
      // the visitor should see rather than a silent dead input.
      if (d.error) setNotice(d.error)
      if (d.escalated || d.withPerson) setWithPerson(true)
      return d.conversationId ?? convo
    } catch {
      setNotice("We couldn't reach support just now — please try again shortly.")
      return null
    } finally { setBusy(false) }
  }

  /** Hand a conversation to a person. Split from `escalate` so both the "already talking"
   *  path and the "clicked a question, now wants a human" path end in the same call. */
  const handOver = async (id: string) => {
    try {
      await fetch("/api/public/support/escalate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      })
      setDone(true)
      setWithPerson(true)
    } catch { setNotice("Couldn't hand that over — email orders@egful.store and we'll pick it up.") }
  }

  /**
   * A canned answer, put into the thread as if it had been asked — because it was.
   *
   * Local only: no request, no model call, no identity. The visitor sees their question and
   * our answer in the same place a real exchange would appear, so "talk to a person" after
   * it is a continuation rather than a fresh start.
   */
  const askFaq = (f: (typeof FAQ)[number]) => {
    setNotice(null)
    setMsgs((m) => [...m, { role: "user", text: f.q }, { role: "assistant", text: f.a }])
  }

  const onSend = async () => {
    const t = draft.trim()
    if (!t || busy) return
    setDraft("")
    setMsgs((m) => [...m, { role: "user", text: t }])   // optimistic, replaced by the server's copy
    await send(t)
  }

  const onIdentity = async () => {
    if (!name.trim() || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email.trim())) {
      setNotice("A name and a real email, so we can reply if you close this."); return
    }
    // Re-send the LAST question now that we can be answered — the server has it stored, but
    // it needs a turn to reply to.
    const last = [...msgs].reverse().find((m) => m.role === "user")?.text || "Hello"
    const id = await send(last)
    // They asked for a person BEFORE there was a conversation — the identity form was the
    // only thing standing in the way, so finish the handover rather than making them press
    // it a second time.
    if (pendingEscalate && id) { setPendingEscalate(false); await handOver(id) }
  }

  const escalate = async () => {
    /**
     * NO CONVERSATION YET — which is the normal case after clicking a question, since those
     * are answered here and never reach the server. This used to `return` on that, so the
     * one control a visitor reaches for after reading an answer did nothing at all.
     *
     * Ask who they are; onIdentity creates the conversation with their question and hands it
     * over in the same step.
     */
    if (!convo) { setPendingEscalate(true); setNeedIdentity(true); setNotice(null); return }
    setBusy(true)
    await handOver(convo)
    setBusy(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Ask us a question"
        className="fixed bottom-5 right-5 z-50 flex size-14 items-center justify-center rounded-full text-[#FAF8F3] shadow-lg transition-transform hover:scale-105"
        style={{ background: ACCENT }}
      >
        <ChatCircleDots size={26} weight="fill" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[30rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 text-[#FAF8F3]" style={{ background: ACCENT }}>
        <span className="text-sm font-bold">Ask EGFUL</span>
        <button onClick={() => setOpen(false)} aria-label="Close"><X size={16} weight="bold" /></button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {/* THE FIRST THING SAID IS A GREETING, in the same bubble a reply would arrive in —
            so the panel opens as a conversation someone has started rather than as a form
            with instructions above it. The old grey paragraph explained the widget; this
            asks the question the widget exists for. */}
        {msgs.length === 0 && (
          <div>
            <span className="inline-block max-w-[85%] rounded-2xl bg-black/[0.05] px-3 py-2 text-sm leading-relaxed text-[#0B0B0C]">
              Hi — how can we help? Ask us anything about products, pricing or how fulfilment
              works, and a person can pick it up whenever you&apos;d rather have one.
            </span>
          </div>
        )}
        {/* MOST ASKED, in the bubble. Shown while the thread is short — they are a way IN,
            and a row of suggested questions under a conversation that is already going is
            the widget talking over the person using it. */}
        {msgs.length < 4 && (
          <div className="flex flex-wrap gap-1.5">
            {FAQ.filter((f) => !msgs.some((m) => m.text === f.q)).map((f) => (
              <button
                key={f.q}
                type="button"
                onClick={() => askFaq(f)}
                className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-semibold text-black/70 transition-colors hover:border-black/45 hover:text-[#0B0B0C]"
              >
                {f.q}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {/* whitespace-pre-wrap, or the line breaks the server just put between numbered
                steps collapse back into one run-on sentence in the bubble. */}
            {/* A PERSON'S REPLY SAYS SO. It arrives in the same column as the assistant's,
                and a visitor who asked for a human needs to be able to tell that they got
                one — otherwise the escalation looks unanswered while its answer is on
                screen. */}
            {m.role === "staff" && (
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">EGFUL support</span>
            )}
            <span className={"inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed " +
              (m.role === "user" ? "bg-[#0B0B0C] text-[#D4F897]"
                : m.role === "staff" ? "border border-black/10 bg-white text-[#0B0B0C]"
                : "bg-black/[0.05] text-[#0B0B0C]")}>
              {m.text}
              {/* The page that answers it properly. On the canned replies only — a model
                  answer has no fixed destination, and inventing one would send people to a
                  page that may not say what the sentence above it just did. */}
              {m.role === "assistant" && FAQ.filter((f) => f.a === m.text).map((f) => (
                <a key={f.href} href={f.href} className="mt-1.5 block font-semibold underline underline-offset-4">
                  {f.hrefLabel} →
                </a>
              ))}
            </span>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-xs text-black/45"><CircleNotch size={13} className="animate-spin" /> thinking…</div>}
        {notice && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">{notice}</p>}
        {done && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800">Passed to a person — we&apos;ll reply to {email || "your email"}.</p>}
        <div ref={endRef} />
      </div>

      {needIdentity ? (
        /* The question is already saved server-side, which is why this can be asked calmly
           rather than as a gate the visitor must pass to be heard. */
        <div className="space-y-2 border-t border-black/10 p-3">
          <p className="text-xs leading-relaxed text-black/55">
            {pendingEscalate
              ? "Who are we passing this to a person for? We'll reply by email — you can close this."
              : "Who should we reply to? We'll email you if you close this."}
          </p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
                 className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/50" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" type="email"
                 className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/50" />
          <button onClick={onIdentity} disabled={busy}
                  className="w-full rounded-lg bg-[#0B0B0C] px-3 py-2 text-sm font-semibold text-[#D4F897] disabled:opacity-60">
            {pendingEscalate ? "Send to support" : "Continue"}
          </button>
        </div>
      ) : (
        <div className="border-t border-black/10 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={draft} onChange={(e) => setDraft(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend() } }}
              placeholder="Type your question…"
              className="max-h-24 flex-1 resize-none rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/50"
            />
            <button onClick={onSend} disabled={busy || !draft.trim()} aria-label="Send"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0B0B0C] text-[#D4F897] disabled:opacity-40">
              <PaperPlaneRight size={15} weight="fill" />
            </button>
          </div>
          {/* OFFERED UNTIL IT IS TAKEN, then gone.
              It stayed on screen after support had joined and answered — offering to fetch
              the person who was already typing, under their reply. `withPerson` is set by the
              handover AND by every read, so it is right after a reload too.
              "Talk to support", not "talk to a person instead": the visitor is not choosing
              between two colleagues, and "instead" reads as a rejection of the answer they
              were just given. */}
          {msgs.length > 0 && !done && !withPerson && (
            <button onClick={escalate} disabled={busy}
                    className="mt-2 text-xs font-semibold text-black/50 underline underline-offset-4 hover:text-[#0B0B0C]">
              Talk to support
            </button>
          )}
          {/* Says who is answering now, in the place the offer used to be — so the space
              does not simply go blank the moment a person arrives. */}
          {withPerson && !done && (
            <p className="mt-2 text-xs text-black/45">You&apos;re talking to EGFUL support.</p>
          )}
        </div>
      )}
    </div>
  )
}

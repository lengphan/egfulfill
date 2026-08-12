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
  const endRef = useRef<HTMLDivElement>(null)

  // Resume on this device. Deferred — localStorage doesn't exist during the prerender, and
  // reading it at useState-init time would make server and client markup disagree.
  useEffect(() => {
    const t = setTimeout(() => { try { setConvo(localStorage.getItem(KEY)) } catch {} }, 0)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs, needIdentity])

  const send = async (text: string) => {
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
    } catch {
      setNotice("We couldn't reach support just now — please try again shortly.")
    } finally { setBusy(false) }
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
    await send(last)
  }

  const escalate = async () => {
    if (!convo) return
    setBusy(true)
    try {
      await fetch("/api/public/support/escalate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convo }),
      })
      setDone(true)
    } catch { setNotice("Couldn't hand that over — email orders@egful.store and we'll pick it up.") }
    finally { setBusy(false) }
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
        {msgs.length === 0 && (
          <p className="text-sm leading-relaxed text-black/55">
            Ask us anything about products, pricing or how fulfilment works. A person can pick
            it up if you&apos;d rather.
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "assistant" ? "" : "flex justify-end"}>
            {/* whitespace-pre-wrap, or the line breaks the server just put between numbered
                steps collapse back into one run-on sentence in the bubble. */}
            <span className={"inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed " +
              (m.role === "assistant" ? "bg-black/[0.05] text-[#0B0B0C]" : "bg-[#0B0B0C] text-[#D4F897]")}>
              {m.text}
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
          <p className="text-xs leading-relaxed text-black/55">Who should we reply to? We&apos;ll email you if you close this.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
                 className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/50" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" type="email"
                 className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/50" />
          <button onClick={onIdentity} disabled={busy}
                  className="w-full rounded-lg bg-[#0B0B0C] px-3 py-2 text-sm font-semibold text-[#D4F897] disabled:opacity-60">
            Continue
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
          {msgs.length > 0 && !done && (
            <button onClick={escalate} disabled={busy}
                    className="mt-2 text-xs font-semibold text-black/50 underline underline-offset-4 hover:text-[#0B0B0C]">
              Talk to a person instead
            </button>
          )}
        </div>
      )}
    </div>
  )
}

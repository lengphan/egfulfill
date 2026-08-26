"use client"

import { useEffect, useRef, useState } from "react"
import { ChatCircleDots, X, PaperPlaneRight } from "@phosphor-icons/react"
import { ACCENT, INK_ON_ACID } from "@/components/marketing/bold-kit"

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
  /** When the team is around, from the server (staff configure the hours). Null until a
   * send answers — the widget never claims availability it hasn't been told. */
 const [office, setOffice] = useState<{ open?: boolean; hoursLabel?: string; resumesLabel?: string } | null>(null)
  /** A person is on this conversation. Set by the handover and by every read, so it survives
   * a reload — and it is what takes the "talk to support" offer away once it is answered. */
 const [withPerson, setWithPerson] = useState(false)
  /** The scrolling panel itself. Scrolled directly — see the effect below. */
 const listRef = useRef<HTMLDivElement>(null)
  /** What the thread looked like last time we scrolled for it. */
 const lastSig = useRef("")

  // Resume on this device. Deferred — localStorage doesn't exist during the prerender, and
  // reading it at useState-init time would make server and client markup disagree.
 useEffect(() => {
 const t = setTimeout(() => { try { setConvo(localStorage.getItem(KEY)) } catch {} }, 0)
 return () => clearTimeout(t)
  }, [])
  /**
   * STAY AT THE BOTTOM — WITHOUT SCROLLING THE PAGE, AND WITHOUT DOING IT EVERY 8 SECONDS.
   *
   * This was an anchor div at the foot of the list plus `scrollIntoView({ behavior:
   * "smooth" })`, keyed on `msgs`. Two faults,
   * and the poll made both visible:
   *
   *   1. scrollIntoView walks UP the tree and scrolls every ancestor that can move — so a
   * widget pinned to the corner was dragging the whole PAGE, which is the "it scrolls
   * from the top down" you see. Setting scrollTop on the panel moves the panel and
   * nothing else.
   *   2. the poll replaces `msgs` with a fresh array every 8s, so the identity changed even
   * when the words didn't and the panel re-animated a scroll on a conversation nobody
   * had added to. It scrolls on a real CHANGE now — the count and the last line — not
   * on a new array.
   *
   * The first paint jumps rather than animates: a panel that opens by gliding from the top
   * to the bottom is the same complaint in miniature.
   */
 useEffect(() => {
 const el = listRef.current
 if (!el) return
 const sig = `${msgs.length}:${msgs[msgs.length - 1]?.text ?? ""}:${needIdentity}`
 if (sig === lastSig.current) return
 const first = lastSig.current === ""
 lastSig.current = sig
 el.scrollTo({ top: el.scrollHeight, behavior: first ? "auto" : "smooth" })
  }, [msgs, needIdentity])

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
        // Identical thread, new array: replacing it re-renders every bubble and re-fires
        // anything watching `msgs`, eight times a minute, for no change at all.
 if (Array.isArray(d.messages)) {
 setMsgs((prev) => (JSON.stringify(prev) === JSON.stringify(d.messages) ? prev : d.messages))
        }
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
 if (d.office) setOffice(d.office)
 return d.conversationId ?? convo
    } catch {
 setNotice("We couldn't reach support just now — please try again shortly.")
 return null
    } finally { setBusy(false) }
  }

  /** Hand a conversation to a person. Split from `escalate` so both the "already talking"
   * path and the "clicked a question, now wants a human" path end in the same call. */
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
 className="fixed bottom-5 right-5 z-50 flex size-14 items-center justify-center rounded-full text-[var(--mk-accent-ink)] transition-transform hover:scale-105"
 style={{ background: ACCENT }}
      >
        <ChatCircleDots size={26} weight="fill" />
      </button>
    )
  }

 return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[30rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-[26px] border border-[var(--mk-hairline)] bg-[var(--mk-card)] ">
      <div className="flex items-center justify-between px-4 py-3 text-[var(--mk-accent-ink)]" style={{ background: ACCENT }}>
        <span className="text-sm font-bold">Ask EGFUL</span>
        <button onClick={() => setOpen(false)} aria-label="Close"><X size={16} weight="bold" /></button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-4">
        {/* THE FIRST THING SAID IS A GREETING, in the same bubble a reply would arrive in —
 so the panel opens as a conversation someone has started rather than as a form
 with instructions above it. The old grey paragraph explained the widget; this
 asks the question the widget exists for. */}
        {msgs.length === 0 && (
          <div className="mb-3">
            <span className="inline-block max-w-[85%] rounded-[26px] bg-[var(--mk-ink)]/[0.05] px-3 py-2 text-sm leading-relaxed text-[var(--mk-ink)]">
              Hi — how can we help? Ask us anything about products, pricing or how fulfilment
 works, and a person can pick it up whenever you&apos;d rather have one.
            </span>
          </div>
        )}
        {/* MOST ASKED, in the bubble. Shown while the thread is short — they are a way IN,
 and a row of suggested questions under a conversation that is already going is
 the widget talking over the person using it. */}
        {msgs.length < 4 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {FAQ.filter((f) => !msgs.some((m) => m.text === f.q)).map((f) => (
              <button
 key={f.q}
 type="button"
 onClick={() => askFaq(f)}
 className="rounded-[var(--radius-control)] border border-[var(--mk-auth-edge)] px-3 py-1.5 text-xs font-semibold text-[var(--mk-ink)]/70 transition-colors hover:border-[var(--mk-ink)] hover:text-[var(--mk-ink)]"
              >
                {f.q}
              </button>
            ))}
          </div>
        )}
        {/**
          * GROUPED BY WHO IS TALKING.
          *
          * Every message carried its own "EGFUL SUPPORT" caption, so three sentences typed
          * one after another by the same person came out as three labelled announcements —
          * the label repeated more often than anyone said anything, and a run read as one
          * block of chrome rather than as somebody talking.
          *
          * A run gets ONE caption. The SPACING stays the same for every message though —
          * closing the gap inside a run was the wrong half of that idea: three bubbles a
          * few pixels apart read as one message that grew, which is precisely the "appended
          * to the previous bubble" this was meant to fix. Each thing said is one bubble with
          * air around it; only the repeated label goes.
          */}
        {msgs.map((m, i) => {
 const startsRun = i === 0 || msgs[i - 1].role !== m.role
 return (
          <div key={i} className={(m.role === "user" ? "flex flex-col items-end " : "") + "mt-3 first:mt-0"}>
            {/* whitespace-pre-wrap, or the line breaks the server just put between numbered
 steps collapse back into one run-on sentence in the bubble. */}
            {/* A PERSON'S REPLY SAYS SO — once per run. It arrives in the same column as the
 assistant's, and a visitor who asked for a human needs to be able to tell
 that they got one, or the escalation looks unanswered while its answer is on
 screen. */}
            {m.role === "staff" && startsRun && (
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--mk-ink)]/45">EGFUL support</span>
            )}
            <span className={"inline-block max-w-[85%] whitespace-pre-wrap rounded-[26px] px-3 py-2 text-sm leading-relaxed " +
              (m.role === "user" ? INK_ON_ACID
 : m.role === "staff" ? "border border-[var(--mk-hairline)] bg-[var(--mk-card)] text-[var(--mk-ink)]"
 : "bg-[var(--mk-ink)]/[0.05] text-[var(--mk-ink)]")}>
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
          )
        })}
        {/**
          * NOTHING HERE WHILE THE TEAM IS IN. The thread used to append a sentence after
          * every message the visitor sent — "Sent. A person will reply right here — usually
          * within 9:00–18:00 ICT, Mon–Fri." — which is §4's prose-under-a-control defect
          * wearing a chat bubble: the message is visibly in the thread, so "Sent." reports
          * what the screen already shows, and the hours were repeated on every single turn.
          *
          * The CLOSED case survives, because it is not a subtitle — it is the answer to
          * "why has nobody replied", and it is the one thing the thread cannot show by
          * itself. A visitor writing at 2am otherwise waits at a silent window.
          */}
        {msgs.length > 0 && msgs[msgs.length - 1].role === "user" && !done && office && office.open === false && (
          <p className="mt-3 text-xs leading-relaxed text-[var(--mk-ink)]/50">
            {`The team is out of office right now${office.resumesLabel ? ` — back ${office.resumesLabel}` : ""}. Your message is with them${email ? `, and they'll email ${email}` : ""}.`}
          </p>
        )}
        {notice && <p className="mt-3 rounded-lg bg-hold/10 px-3 py-2 text-xs leading-relaxed text-hold">{notice}</p>}
        {/**
          * BEING TRANSFERRED — but only while that is TRUE.
          *
          * The rule the sentence above sets still holds: a live indicator promises "seconds
          * away", so it may only run when someone is actually there to connect to. Inside
          * office hours a handover is genuinely in progress and the pulse says so; outside
          * them the same animation would be a lie with a nice animation on it, so the closed
          * case keeps its plain sentence about when the team is back.
          *
          * It never says "an agent is typing". Nobody is typing — we know a request was
          * passed on, not that a person has opened it, and inventing that presence is the
          * same class of thing as a placeholder avatar beside an invented number.
          */}
        {done && office?.open !== false && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-shipped/12 px-3 py-2 text-xs leading-relaxed text-shipped">
            <span aria-hidden className="flex shrink-0 gap-0.5">
              <span className="size-1.5 animate-bounce rounded-full bg-shipped [animation-delay:-300ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-shipped [animation-delay:-150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-shipped" />
            </span>
            Connecting you with an agent…
          </p>
        )}
        {done && office?.open === false && <p className="mt-3 rounded-lg bg-shipped/12 px-3 py-2 text-xs leading-relaxed text-shipped">Passed to a person — we&apos;ll reply to {email || "your email"}.</p>}
      </div>

      {needIdentity ? (
        /* The question is already saved server-side, which is why this can be asked calmly
 rather than as a gate the visitor must pass to be heard. */
        <div className="space-y-2 border-t border-[var(--mk-hairline)] p-3">
          <p className="text-xs leading-relaxed text-[var(--mk-ink)]/60">
            {pendingEscalate
              ? "Who are we passing this to a person for? We'll reply by email — you can close this."
 : "Who should we reply to? We'll email you if you close this."}
          </p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
 className="w-full rounded-lg border border-[var(--mk-auth-edge)] px-3 py-2 text-sm outline-none focus:border-[var(--mk-ink)]" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" type="email"
 className="w-full rounded-lg border border-[var(--mk-auth-edge)] px-3 py-2 text-sm outline-none focus:border-[var(--mk-ink)]" />
          <button onClick={onIdentity} disabled={busy}
 className={`w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${INK_ON_ACID}`}>
            {pendingEscalate ? "Send to support" : "Continue"}
          </button>
        </div>
      ) : (
        <div className="border-t border-[var(--mk-hairline)] p-3">
          <div className="flex items-end gap-2">
            <textarea
 value={draft} onChange={(e) => setDraft(e.target.value)} rows={1}
 onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend() } }}
 placeholder="Type your question…"
 className="max-h-24 flex-1 resize-none rounded-lg border border-[var(--mk-auth-edge)] px-3 py-2 text-sm outline-none focus:border-[var(--mk-ink)]"
            />
            <button onClick={onSend} disabled={busy || !draft.trim()} aria-label="Send"
 className={`flex size-9 shrink-0 items-center justify-center rounded-lg disabled:opacity-40 ${INK_ON_ACID}`}>
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
 className="mt-2 text-xs font-semibold text-[var(--mk-ink)]/55 underline underline-offset-4 hover:text-[var(--mk-ink)]">
              Talk to support
            </button>
          )}
          {/* "You're talking to EGFUL support." used to sit here. It named the thing the
              visitor had just pressed a button to reach, under the input they were about to
              type into — a caption on a conversation that is already on screen. The messages
              say who is answering. */}
        </div>
      )}
    </div>
  )
}

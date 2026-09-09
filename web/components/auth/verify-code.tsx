"use client"

import { useEffect, useRef, useState } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { verifyEmailCode, resendVerification } from "@/lib/api"

/** How long before "Send a new code" comes back. Long enough that the first email has
 *  genuinely had its chance — most of the wait is the inbox, not us. */
const RESEND_WAIT = 45

/**
 * THE CODE STEP — the second page of signing up, not a screen of its own.
 *
 * It began life as a route, `/verify-email`, and that was wrong in a way a screenshot makes
 * obvious: it dropped someone out of the two-column auth window they were mid-way through and
 * onto a bare page with a box on it, so a step in one flow looked like a different product.
 * Signing up is one thing that happens in one place; this is its next page.
 *
 * So it is a COMPONENT, and the route renders it inside the same shell. One definition, two
 * entrances — someone who signs up sees it in the card, and someone who comes back to a link
 * later sees the same step in the same frame.
 *
 * WHAT IT IS FOR: confirmation proves the ADDRESS is deliverable and belongs to whoever typed
 * it. Not a control on the account — the password is that — a control on the address, which
 * here carries wallet-low warnings, payout confirmations and password resets.
 *
 * NOT A WALL. "Skip for now" is a real link. Someone whose code went to spam still has an
 * account they can ask for help from, and what waits on confirmation is the money and the
 * store connections, not the product.
 */
export function VerifyCode({ email, onDone, onSkip }: {
  email?: string | null
  /** Confirmed, or already confirmed. */
  onDone: () => void
  /** Left for later. Omit to hide the way out — a caller that must not be escaped. */
  onSkip?: () => void
}) {
  /**
   * SIX BOXES, NOT ONE FIELD (owner, 2026-09-09) — and they are six views of ONE string.
   *
   * The tempting build is six pieces of state, and it is the one that breaks: paste stops
   * working, because a paste lands in whichever box has focus and the other five never hear
   * about it; and autofill stops working, because the browser and iOS both fill a single
   * `one-time-code` field, not a row of them.
   *
   * So the value stays one string and the boxes RENDER its characters. Every input carries
   * the autocomplete hint, so whichever one the platform picks fills the whole code.
   */
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [wait, setWait] = useState(RESEND_WAIT)
  const sending = useRef(false)
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  /* THE COUNTDOWN IS AN ANSWER, not decoration. "Send a new code" pressed twice in four
     seconds sends two codes and invalidates the first, so the person is now looking at an
     email that will never work — the commonest way this flow fails is people out-clicking
     their own inbox. The timer says how long to wait instead of just refusing. */
  useEffect(() => {
    if (wait <= 0) return
    const t = setInterval(() => setWait((w) => (w <= 1 ? 0 : w - 1)), 1000)
    return () => clearInterval(t)
  }, [wait])

  const focusBox = (i: number) => boxes.current[Math.max(0, Math.min(5, i))]?.focus()

  const put = (next: string) => {
    const clean = next.replace(/[^0-9]/g, "").slice(0, 6)
    setCode(clean)
    if (clean.length < 6) focusBox(clean.length)
  }

  const submit = async () => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await verifyEmailCode(code.trim())
      if (r.error) { setErr(r.error); setCode(""); focusBox(0); return }
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't check that code.")
      setCode(""); focusBox(0)
    } finally { sending.current = false; setBusy(false) }
  }

  // SUBMIT ON THE SIXTH DIGIT. The code is fixed length, so there is nothing left to decide
  // once it is complete, and a press that exists only to be pressed is a step.
  // AFTER `submit`, not before it: an effect that reaches back up the file closes over the
  // first render's copy and never sees a later one.
  useEffect(() => {
    if (code.length !== 6 || busy) return
    const t = setTimeout(() => void submit(), 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const resend = async () => {
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await resendVerification()
      if (r.error) { setErr(r.error); return }
      if (r.already) { onDone(); return }
      setNote(`A new code is on its way to ${r.to ?? "your inbox"}.`)
      setCode(""); setWait(RESEND_WAIT); focusBox(0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send a new code.")
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {/* The ADDRESS is the fact worth reading here — this is the moment a typo is caught. */}
      <p className="text-sm text-muted-foreground">
        Enter the six-digit code we sent to{" "}
        <span className="font-medium text-foreground">{email || "your inbox"}</span>.
      </p>

      {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
      {note && <div className="rounded-md bg-shipped/12 px-3 py-2 text-sm text-shipped">{note}</div>}

      <div className="flex justify-between gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <input
            key={i}
            ref={(el) => { boxes.current[i] = el }}
            value={code[i] ?? ""}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            disabled={busy}
            autoFocus={i === 0}
            aria-label={`Digit ${i + 1}`}
            onChange={(e) => {
              const typed = e.target.value.replace(/[^0-9]/g, "")
              // A PASTE ARRIVES IN ONE BOX. More than one character means the platform (or a
              // person) put the whole code here, so it fills the row from this position
              // rather than being truncated to the first digit.
              if (typed.length > 1) { put(code.slice(0, i) + typed); return }
              if (!typed) return
              const nextCode = (code.slice(0, i) + typed + code.slice(i + 1)).slice(0, 6)
              setCode(nextCode)
              focusBox(i + 1)
            }}
            onKeyDown={(e) => {
              // BACKSPACE ON AN EMPTY BOX GOES BACK. Without it the caret sits in a box that
              // is already empty and the key appears to do nothing — the single commonest
              // complaint about split code inputs.
              if (e.key === "Backspace") {
                e.preventDefault()
                if (code[i]) setCode(code.slice(0, i) + code.slice(i + 1))
                else { setCode(code.slice(0, i - 1) + code.slice(i)); focusBox(i - 1) }
              }
              if (e.key === "ArrowLeft") { e.preventDefault(); focusBox(i - 1) }
              if (e.key === "ArrowRight") { e.preventDefault(); focusBox(i + 1) }
            }}
            className={
              "h-12 w-full min-w-0 rounded-lg border bg-background text-center text-xl font-medium tabular-nums " +
              "outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:opacity-50 " +
              (err ? "border-destructive/60" : code[i] ? "border-foreground/40" : "border-input")
            }
          />
        ))}
      </div>

      <Button className="w-full" disabled={busy || code.length !== 6} onClick={() => void submit()}>
        {busy ? <CircleNotch size={14} className="animate-spin" /> : null}
        {busy ? "Checking…" : "Confirm"}
      </Button>

      <div className="flex items-center justify-between text-sm">
        {wait > 0 ? (
          // A DISABLED CONTROL THAT SAYS WHEN. "Send a new code" greyed out with no reason is
          // a dead button; with the count it is an instruction.
          <span className="text-muted-foreground tabular-nums">
            Send a new code in 0:{String(wait).padStart(2, "0")}
          </span>
        ) : (
          <button type="button" onClick={() => void resend()} disabled={busy}
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40">
            Send a new code
          </button>
        )}
        {onSkip && (
          <button type="button" onClick={onSkip}
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Skip for now
          </button>
        )}
      </div>
    </div>
  )
}

"use client"

import { useEffect, useRef, useState } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { verifyEmailCode, resendVerification } from "@/lib/api"

/**
 * THE CODE STEP — the second page of signing up, not a screen of its own.
 *
 * It began life as a route, `/verify-email`, and that was wrong in a way a screenshot makes
 * obvious: it dropped someone out of the two-column auth window they were mid-way through and
 * onto a bare page with a box on it, so a step in one flow looked like a different product.
 * Signing up is one thing that happens in one place; this is its next page (owner, 2026-09-09).
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
 * account they can ask for help from, and what actually waits on confirmation is the money
 * and the store connections.
 */
export function VerifyCode({ email, onDone, onSkip }: {
  email?: string | null
  /** Confirmed, or already confirmed. */
  onDone: () => void
  /** Left for later. Omit to hide the way out — a caller that must not be escaped. */
  onSkip?: () => void
}) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const sending = useRef(false)

  const submit = async () => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await verifyEmailCode(code.trim())
      if (r.error) { setErr(r.error); setCode(""); return }
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't check that code.")
      setCode("")
    } finally { sending.current = false; setBusy(false) }
  }

  // SUBMIT ON THE SIXTH DIGIT. The code is fixed length, so there is nothing left to decide
  // once it is complete — asking for a press as well is a step that exists only to be pressed.
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
      setCode("")
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

      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        disabled={busy}
        aria-label="Six-digit code"
        placeholder="000000"
        className="h-12 text-center text-2xl tracking-[0.4em] tabular-nums"
      />

      <Button className="w-full" disabled={busy || code.length !== 6} onClick={() => void submit()}>
        {busy ? <CircleNotch size={14} className="animate-spin" /> : null}
        {busy ? "Checking…" : "Confirm"}
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={() => void resend()} disabled={busy}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40">
          Send a new code
        </button>
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

"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { verifyEmailCode, resendVerification, getMe } from "@/lib/api"

/**
 * CONFIRM YOUR EMAIL — one field, one instruction.
 *
 * WHY THIS PAGE EXISTS, because it is easy to build the wrong thing: confirmation proves the
 * ADDRESS is deliverable and belongs to whoever typed it. It is not a control on the account
 * — the password is that — it is a control on the address, and here that address carries a
 * seller's wallet-low warnings, their payout confirmations and their password reset. A typo
 * fails silently, and the first anyone hears of it is an order that stopped for want of funds
 * nobody was told about.
 *
 * IT IS NOT A WALL. "Skip for now" is a real link, not a dark pattern in reverse: someone
 * whose code went to spam still has an account they can ask for help from, and what actually
 * waits on confirmation is the money and the store connections. A signup lost at this screen
 * is a signup lost to deliverability rather than to the product.
 */
function VerifyEmail() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next")
  const [code, setCode] = useState("")
  const [email, setEmail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const sending = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => {
      getMe()
        .then((u) => {
          const me = u as { email?: string; email_verified_at?: string | null }
          // ALREADY DONE IS NOT A SCREEN. Someone who confirmed on another device and comes
          // back to this tab should land where they were going, not be asked again.
          if (me?.email_verified_at) router.replace(next ?? "/dashboard")
          else setEmail(me?.email ?? null)
        })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(t)
  }, [router, next])

  const submit = async () => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await verifyEmailCode(code.trim())
      if (r.error) { setErr(r.error); return }
      router.replace(next ?? "/dashboard")
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't check that code.")
    } finally { sending.current = false; setBusy(false) }
  }

  const resend = async () => {
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await resendVerification()
      if (r.error) { setErr(r.error); return }
      if (r.already) { router.replace(next ?? "/dashboard"); return }
      setNote(`A new code is on its way to ${r.to ?? "your inbox"}.`)
      setCode("")
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send a new code.")
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-5 px-5 py-16">
      <div>
        <h1 className="text-xl font-semibold">Confirm your email</h1>
        {/* An empty-ish screen may carry one sentence, because there is nothing else to read —
            and the ADDRESS is the fact worth reading: this is the moment a typo is caught. */}
        <p className="mt-1.5 text-sm text-muted-foreground">
          We sent a six-digit code to {email ? <span className="text-foreground">{email}</span> : "your inbox"}.
        </p>
      </div>

      {err && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
      {note && <div className="rounded-lg border border-shipped/30 bg-shipped/12 px-3 py-2 text-sm text-shipped">{note}</div>}

      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
        onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) void submit() }}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        aria-label="Six-digit code"
        placeholder="000000"
        className="h-12 text-center text-2xl tracking-[0.4em] tabular-nums"
      />

      <Button className="w-full justify-center" disabled={busy || code.length !== 6} onClick={() => void submit()}>
        {busy ? <CircleNotch size={14} className="animate-spin" /> : null}
        Confirm
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={() => void resend()} disabled={busy}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40">
          Send a new code
        </button>
        <button type="button" onClick={() => router.replace(next ?? "/dashboard")}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Skip for now
        </button>
      </div>
    </div>
  )
}

export default function Page() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of static rendering.
  return <Suspense fallback={null}><VerifyEmail /></Suspense>
}

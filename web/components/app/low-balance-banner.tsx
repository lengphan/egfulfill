"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Warning } from "@phosphor-icons/react"
import { getWallet } from "@/lib/api"
import { getToken } from "@/lib/auth"

const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2)

/**
 * Warns a seller their wallet is running out, before it stops them.
 *
 * Submitting an order charges it, and a short wallet refuses the submit — so without a
 * warning the first sign of trouble is work that won't go to production. This arrives
 * while there's still time to top up.
 *
 * Three states, deliberately distinct: EMPTY and BELOW ZERO are already blocking, LOW is not
 * yet. One message for all three would either over-alarm at $40 or under-alarm at -$5.
 *
 * ZERO IS NOT LOW. It was tested with `balance < 0`, so an account sitting at exactly $0.00
 * read "top up before it runs out" — advice about a future that had already happened, in the
 * amber that means "not yet". The submit gate is `balance < due` and an order that prices at
 * $0 is refused outright, so at zero EVERY order is blocked, which is the same fact a
 * negative balance carries and it must not be dressed as a warning.
 *
 * The threshold comes from the server with the balance, so this never decides for itself
 * what "low" means. House accounts get nothing — they're allowed to run negative, which
 * is how a loss stays visible instead of blocking the floor.
 */
export function LowBalanceBanner() {
  const tl = useLabelT()
 const [w, setW] = useState<{ balance: number; low?: boolean; lowBelow?: number | null } | null>(null)

 const load = useCallback(() => {
 if (!getToken()) return
 getWallet().then((r) => setW({ balance: r.balance, low: r.low, lowBelow: r.lowBelow })).catch(() => setW(null))
  }, [])
 useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])
  // Re-read the moment the wallet changes (a top-up funded/approved) so a now-healthy balance
  // drops this banner immediately instead of lingering until a reload. Same event the topbar
  // and Add Funds already dispatch.
 useEffect(() => {
 const h = () => load()
 window.addEventListener("eg-wallet-changed", h)
 return () => window.removeEventListener("eg-wallet-changed", h)
  }, [load])

 if (!w || !w.low) return null
  /** Nothing can be submitted at or below zero — see the docblock. */
 const blocking = w.balance <= 0
 const negative = w.balance < 0

 return (
    <div className={"flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5 text-sm " + (
 blocking
        ? "border-destructive/30 bg-destructive/10 text-destructive"
 : "border-hold/20 bg-hold/10 text-hold")}>
      <Warning size={16} weight="fill" className="shrink-0" />
      <span className="min-w-0 flex-1">
        {negative ? (
          <>{tl("lowBalanceBanner", "Your balance is")} <strong>{usd(w.balance)}</strong>{tl("lowBalanceBanner", ". Orders can’t be submitted to production until it’s positive.")}</>
        ) : blocking ? (
          <>{tl("lowBalanceBanner", "Your balance is")} <strong>{usd(w.balance)}</strong>{tl("lowBalanceBanner", ". Orders can’t be submitted to production until you top up.")}</>
        ) : (
          <>{tl("lowBalanceBanner", "Your balance is")} <strong>{usd(w.balance)}</strong>{tl("lowBalanceBanner", ". Submitting an order charges it — top up before it runs out.")}</>
        )}
      </span>
      <Link href="/wallet" className="shrink-0 font-medium underline">{tl("lowBalanceBanner", "Top up")}</Link>
    </div>
  )
}

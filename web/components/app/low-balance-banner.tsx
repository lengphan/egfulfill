"use client"

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
 * Two states, deliberately distinct: BELOW ZERO is already blocking, LOW is not yet. One
 * message for both would either over-alarm at $40 or under-alarm at -$5.
 *
 * The threshold comes from the server with the balance, so this never decides for itself
 * what "low" means. House accounts get nothing — they're allowed to run negative, which
 * is how a loss stays visible instead of blocking the floor.
 */
export function LowBalanceBanner() {
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
  const negative = w.balance < 0

  return (
    <div className={"flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5 text-sm " + (
      negative
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-amber-200 bg-amber-50 text-amber-800")}>
      <Warning size={16} weight="fill" className="shrink-0" />
      <span className="min-w-0 flex-1">
        {negative ? (
          <>Your balance is <strong>{usd(w.balance)}</strong>. Orders can&apos;t be submitted to production until it&apos;s positive.</>
        ) : (
          <>Your balance is <strong>{usd(w.balance)}</strong>. Submitting an order charges it — top up before it runs out.</>
        )}
      </span>
      <Link href="/wallet" className="shrink-0 font-medium underline">Top up</Link>
    </div>
  )
}

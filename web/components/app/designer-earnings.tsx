"use client"

import { useEffect, useState } from "react"
import { CurrencyDollar, CircleNotch, Warning, Coins } from "@phosphor-icons/react"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { getWallet, type LedgerRow } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { PageTitle } from "@/components/app/page-title"
import { EmptyState } from "@/components/app/empty-state"

const money = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// The designer wallet's ledger (credits in on approval, payouts/withdrawals out).
// Its own page now — loads the shared 'designer' wallet directly.
export function DesignerEarnings() {
 const [ledger, setLedger] = useState<{ balance: number; rows: LedgerRow[] } | null>(null)
  // Telling a designer they have earned $0.00 when the ledger simply could not be read is
  // the worst lie this page can tell, so a failure is reported rather than zeroed. Both
  // the no-token and the request-failed paths used to resolve to a real-looking empty
  // wallet ("Balance $0.00 · No earnings yet").
 const [loadErr, setLoadErr] = useState<string | null>(null)

 useEffect(() => {
 const id = setTimeout(() => {
 if (!getToken()) { setLoadErr("You're signed out."); return }
 getWallet("designer")
        .then((w) => { setLedger({ balance: w.balance ?? 0, rows: w.ledger ?? [] }); setLoadErr(null) })
        .catch((e) => setLoadErr(e instanceof Error ? e.message : "Couldn't reach the server."))
    }, 0)
 return () => clearTimeout(id)
  }, [])

 const fmtDT = (s?: string) => {
 if (!s) return "—"
 const d = new Date(s)
 return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  }

 const earned = ledger ? ledger.rows.filter((r) => Number(r.delta) > 0).reduce((s, r) => s + Number(r.delta), 0) : 0

 return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 md:hidden">
        <CurrencyDollar size={18} weight="regular" className="shrink-0 text-primary" />
        <div className="min-w-0">
          <PageTitle>Earnings</PageTitle>
          <p className="truncate text-sm text-muted-foreground">Credits land here when a design is approved. Every entry is on the ledger.</p>
        </div>
      </div>

      {ledger === null && loadErr ? (
        <div className="flex items-start gap-2 rounded-2xl border border-border px-5 py-4 text-sm text-muted-foreground">
          <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-hold" />
          <span>Couldn&apos;t load your earnings, so they aren&apos;t shown — this is not a zero balance. {loadErr}</span>
        </div>
      ) : ledger === null ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground"><CircleNotch size={24} className="animate-spin" /></div>
      ) : (
        <>
          <StatGrid>
            <StatCard label="Balance" value={money(ledger.balance)} sub="designer wallet" tone={ledger.balance ? "pos" : undefined} />
            <StatCard label="Total earned" value={money(earned)} sub="all time" />
            <StatCard label="Entries" value={String(ledger.rows.length)} sub="ledger records" />
          </StatGrid>
          <div className="overflow-hidden rounded-2xl border border-border">
            {ledger.rows.length === 0 ? (
              <EmptyState icon={Coins} title="No earnings yet" note="Credit a designer from an approved card." />
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left eg-label text-muted-foreground">
                  <tr><th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Detail</th><th className="px-4 py-2.5">Type</th><th className="px-4 py-2.5 text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {ledger.rows.map((r) => {
 const d = Number(r.delta) || 0
 return (
                      <tr key={String(r.id)} className="border-t border-border">
                        <td className="px-4 py-2 text-muted-foreground">{fmtDT(r.created_at)}</td>
                        <td className="px-4 py-2">{r.note || r.ref || "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{String(r.type || "").replace(/-(in|out)$/, "")}</td>
                        <td className={"px-4 py-2 text-right font-semibold tabular-nums " + (d >= 0 ? "text-success" : "text-foreground")}>{d >= 0 ? "+" : "−"}{money(Math.abs(d))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

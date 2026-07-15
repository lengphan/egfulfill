"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, ArrowLineDown, DownloadSimple, Bank } from "@phosphor-icons/react"
import { TopUpDialog } from "@/components/app/topup-dialog"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getWallet, type LedgerRow } from "@/lib/api"
import { getToken } from "@/lib/auth"

type TxType = "Deposit" | "Charge" | "Refund" | "Payout"
type Row = {
  id: string
  date: string
  desc: string
  ref: string
  method: string
  type: TxType
  amount: number
  balance: number
}
type View = {
  balance: number
  charges: number
  deposited: number
  ordersCharged: number
  avgCharge: number
  rows: Row[]
}

const usd = (n: number, signed = false) =>
  `${signed ? (n < 0 ? "−" : "+") : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const typeTone: Record<TxType, string> = {
  Deposit: "bg-emerald-100 text-emerald-700",
  Refund: "bg-emerald-100 text-emerald-700",
  Charge: "bg-muted text-muted-foreground",
  Payout: "bg-muted text-muted-foreground",
}

// Demo fallback — shown when there's no session / API (keeps the page populated in standalone dev).
const DEMO: View = {
  balance: 12480,
  charges: 6284,
  deposited: 5444,
  ordersCharged: 47,
  avgCharge: 133.7,
  rows: [
    { id: "1", date: "Apr 12", desc: "Bank transfer", ref: "ACH ·2231", method: "ACH", type: "Deposit", amount: 500, balance: 12480 },
    { id: "2", date: "Apr 11", desc: "Hoodie · black", ref: "Order #4142", method: "Wallet", type: "Charge", amount: -63.75, balance: 11980 },
    { id: "3", date: "Apr 11", desc: "Tee · 2-pack", ref: "Order #4140", method: "Wallet", type: "Charge", amount: -27, balance: 12043.75 },
    { id: "4", date: "Apr 10", desc: "Reprint credit", ref: "Order #4088", method: "Wallet", type: "Refund", amount: 12, balance: 12070.75 },
    { id: "5", date: "Apr 09", desc: "Card ·4417", ref: "Visa", method: "Card", type: "Deposit", amount: 250, balance: 12090.25 },
  ],
}

function mapLedger(balance: number, ledger: LedgerRow[]): View {
  let run = balance
  let charges = 0
  let deposited = 0
  let ordersCharged = 0
  const rows: Row[] = ledger.map((l) => {
    const delta = Number(l.delta) || 0
    const balanceAfter = run
    run -= delta
    if (delta < 0) charges += Math.abs(delta)
    if (delta > 0) deposited += delta
    if (l.type === "charge") ordersCharged += 1
    const type: TxType =
      delta > 0 ? (l.type === "refund" ? "Refund" : "Deposit") : l.type === "withdrawal" ? "Payout" : "Charge"
    return {
      id: String(l.id),
      date: new Date(l.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
      desc: l.note || l.type,
      ref: l.ref || "",
      method: l.type === "charge" ? "Wallet" : "—",
      type,
      amount: delta,
      balance: balanceAfter,
    }
  })
  return { balance, charges, deposited, ordersCharged, avgCharge: ordersCharged ? charges / ordersCharged : 0, rows }
}

const ZERO: View = { balance: 0, charges: 0, deposited: 0, ordersCharged: 0, avgCharge: 0, rows: [] }

export function WalletDashboard() {
  const [view, setView] = useState<View | null>(null)
  const [topUpOpen, setTopUpOpen] = useState(false)

  const refresh = useCallback(() => {
    // Signed in → the real server balance (server-authoritative), or zeros if empty.
    // Demo numbers are ONLY for the signed-out standalone preview — never a real account.
    const signedIn = !!getToken()
    if (!signedIn) { setView(DEMO); return }
    getWallet()
      .then((w) => setView(mapLedger(w.balance, w.ledger)))
      .catch(() => setView((v) => v ?? ZERO))
  }, [])
  useEffect(() => {
    const id = setTimeout(refresh, 0)
    return () => clearTimeout(id)
  }, [refresh])

  if (!view) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  const kpis = [
    { label: "Available balance", value: usd(view.balance), sub: "Ready for fulfillment", tone: "pos" as const },
    { label: "Fulfillment charges", value: usd(view.charges), sub: "this period", tone: "mut" as const },
    { label: "Total deposited", value: usd(view.deposited), sub: "this period", tone: "mut" as const },
    { label: "Orders charged", value: String(view.ordersCharged), sub: `${usd(view.avgCharge)} avg charge`, tone: "mut" as const },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline">
          <Bank size={16} /> Manage Linked Accounts
        </Button>
        <Button variant="outline">
          <ArrowLineDown size={16} /> Withdraw
        </Button>
        <Button onClick={() => setTopUpOpen(true)}>
          <Plus size={16} weight="bold" /> Add Funds
        </Button>
      </div>

      <TopUpDialog open={topUpOpen} onOpenChange={setTopUpOpen} onFunded={refresh} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-0 p-5">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              {k.label}
            </div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">{k.value}</div>
            <div
              className={
                "mt-1.5 text-[12.5px] font-medium " +
                (k.tone === "pos" ? "text-emerald-600" : "text-muted-foreground")
              }
            >
              {k.sub}
            </div>
          </Card>
        ))}
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="text-[15px] font-bold">Transaction History</div>
            <div className="text-[13px] text-muted-foreground">Deposits and fulfillment charges</div>
          </div>
          <div className="flex items-center gap-2">
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="deposits">Deposits</TabsTrigger>
                <TabsTrigger value="charges">Charges</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm">
              <DownloadSimple size={14} /> Export CSV
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No transactions yet
                </TableCell>
              </TableRow>
            ) : (
              view.rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-muted-foreground">{t.date}</TableCell>
                  <TableCell className="font-medium">{t.desc}</TableCell>
                  <TableCell className="text-muted-foreground">{t.ref}</TableCell>
                  <TableCell className="text-muted-foreground">{t.method}</TableCell>
                  <TableCell>
                    <Badge className={typeTone[t.type]} variant="secondary">
                      {t.type}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={
                      "text-right font-semibold tabular-nums " +
                      (t.amount >= 0 ? "text-emerald-600" : "text-foreground")
                    }
                  >
                    {usd(t.amount, true)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{usd(t.balance)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

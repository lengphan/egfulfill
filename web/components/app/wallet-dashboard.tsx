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
import { SectionCard } from "@/components/app/section-card"
import { CircleNotch, CheckCircle, XCircle } from "@phosphor-icons/react"
import { getWallet, getMyTopups, getTopups, confirmTopup, rejectTopup, type LedgerRow, type TopupRequest } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"

const usd2 = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDT2 = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }

// Admin review of pending seller top-ups (moved here from the old Console).
function AdminTopups() {
  // Warehouse shares the factory wallet and sees the same ledger. APPROVING a top-up
  // stays admin-only though: that's confirming money arrived by bank transfer, which is
  // a higher-trust act than reading the balance.
  // Admin and warehouse share the factory wallet, and the server already lets ANY staff
  // confirm or reject (topups.js gates on isStaff) — so the admin-only check here was the
  // outlier, hiding a panel from someone the API would happily have served.
  const canReview = ["admin", "warehouse"].includes(getUser()?.role ?? "")
  const [topups, setTopups] = useState<TopupRequest[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(() => { if (canReview) getTopups("pending").then((r) => setTopups(r ?? [])).catch(() => setTopups([])) }, [canReview])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])
  const review = async (t: TopupRequest, action: "confirm" | "reject") => {
    setBusy(t.id); setTopups((prev) => (prev ?? []).filter((x) => x.id !== t.id))
    try { await (action === "confirm" ? confirmTopup(t.id) : rejectTopup(t.id)) } catch { load() } finally { setBusy(null) }
  }
  if (!canReview || topups === null || topups.length === 0) return null
  return (
    <SectionCard title={`Pending top-ups (${topups.length})`} description="Confirm to credit the seller's wallet; reject leaves it untouched">
      <div className="divide-y divide-border">
        {topups.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-semibold tabular-nums">{usd2(Number(t.amount_usd) || 0)} <span className="text-sm font-normal text-muted-foreground">· {t.method || "transfer"}</span></div>
              <div className="text-xs text-muted-foreground">{t.ref ? `Ref ${t.ref} · ` : ""}{fmtDT2(t.created_at)}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => review(t, "reject")} disabled={busy === t.id} className="text-red-600 hover:text-red-700"><XCircle size={14} weight="bold" /> Reject</Button>
              <Button size="sm" onClick={() => review(t, "confirm")} disabled={busy === t.id}>{busy === t.id ? <CircleNotch size={14} className="animate-spin" /> : <><CheckCircle size={14} weight="bold" /> Confirm &amp; credit</>}</Button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

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
  const [pending, setPending] = useState<TopupRequest[]>([])
  const [topUpOpen, setTopUpOpen] = useState(false)

  const refresh = useCallback(() => {
    // Signed in → the real server balance (server-authoritative), or zeros if empty.
    // Demo numbers are ONLY for the signed-out standalone preview — never a real account.
    const signedIn = !!getToken()
    if (!signedIn) { setView(DEMO); return }
    getWallet()
      .then((w) => setView(mapLedger(w.balance, w.ledger)))
      .catch(() => setView((v) => v ?? ZERO))
    // Surface the seller's own top-up requests that haven't landed in the ledger yet
    // (received ones already show as ledger deposits) so a submitted top-up is visible.
    getMyTopups()
      .then((rows) => setPending((rows ?? []).filter((r) => r.status === "pending" || r.status === "rejected")))
      .catch(() => setPending([]))
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
      <AdminTopups />
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

      <TopUpDialog
        open={topUpOpen}
        onOpenChange={setTopUpOpen}
        onFunded={() => {
          refresh()
          // The topbar reads the wallet once on mount, so without this the header kept
          // the pre-top-up balance until a reload — same staleness a plan purchase hit.
          window.dispatchEvent(new CustomEvent("eg-wallet-changed"))
        }}
      />

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
        {pending.length > 0 && (
          <div className="border-b border-border bg-muted/30 px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Awaiting confirmation</div>
            <div className="space-y-1.5">
              {pending.map((p) => {
                const rejected = p.status === "rejected"
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={rejected ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}>
                        {rejected ? "Rejected" : "Pending"}
                      </Badge>
                      <span className="text-muted-foreground">
                        {p.method || "Top-up"}{p.ref ? ` · ${p.ref}` : ""} · {new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <span className={"font-semibold tabular-nums " + (rejected ? "text-muted-foreground line-through" : "text-foreground")}>
                      {usd(Number(p.amount_usd) || 0, true)}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Pending top-ups credit your balance once confirmed (VietQR auto-confirms on payment; manual transfers are reviewed by our team).</div>
          </div>
        )}
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

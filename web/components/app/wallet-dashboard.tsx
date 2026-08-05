"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, ArrowLineDown, DownloadSimple } from "@phosphor-icons/react"
import { TopUpDialog } from "@/components/app/topup-dialog"
import { PayoutDialog } from "@/components/app/payout-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SectionCard } from "@/components/app/section-card"
import { CircleNotch, CheckCircle, XCircle, Warning } from "@phosphor-icons/react"
import { getWallet, getMyTopups, getTopups, confirmTopup, rejectTopup, getPayoutRequests, payPayout, rejectPayout, type LedgerRow, type WalletSummary, type TopupRequest, type PayoutRequest } from "@/lib/api"
import { BillingView } from "@/components/app/billing-view"
import { getToken, getUser } from "@/lib/auth"

const usd2 = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDT2 = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }

// Admin review of pending seller top-ups (moved here from the old Console).
function AdminTopups({ onReviewed }: { onReviewed?: () => void }) {
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
  // Kept in sync via the wallet-changed event so BOTH copies of this panel (top of page +
  // above the ledger) reflect a review done in either one, with no stale duplicate.
  useEffect(() => {
    const h = () => load()
    window.addEventListener("eg-wallet-changed", h)
    return () => window.removeEventListener("eg-wallet-changed", h)
  }, [load])
  const review = async (t: TopupRequest, action: "confirm" | "reject") => {
    // Close it out of the pending list immediately (optimistic), then record the decision.
    // On success refresh the wallet so the credit lands in the history right away; on
    // failure put it back by reloading the true pending list.
    setBusy(t.id); setTopups((prev) => (prev ?? []).filter((x) => x.id !== t.id))
    try {
      const r = await (action === "confirm" ? confirmTopup(t.id) : rejectTopup(t.id))
      if (r && r.error) { load() } else { onReviewed?.() }
    } catch { load() } finally { setBusy(null) }
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

// Admin/warehouse review of pending seller payouts — the debit side of the top-up panel.
// They pay the seller off-platform using the details shown, then Mark paid to debit the
// wallet. Gated to admin/warehouse because it moves money OUT (the server enforces it too).
function AdminPayouts({ onPaid }: { onPaid: () => void }) {
  const canPay = ["admin", "warehouse"].includes(getUser()?.role ?? "")
  const [rows, setRows] = useState<PayoutRequest[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => { if (canPay) getPayoutRequests("pending").then((r) => setRows(r ?? [])).catch(() => setRows([])) }, [canPay])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])
  const act = async (p: PayoutRequest, action: "pay" | "reject") => {
    setBusy(p.id); setErr(null)
    try {
      const r = await (action === "pay" ? payPayout(p.id) : rejectPayout(p.id))
      if (r.error) { setErr(r.error); load(); return }
      setRows((prev) => (prev ?? []).filter((x) => x.id !== p.id))
      if (action === "pay") onPaid()
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't update that payout."); load() } finally { setBusy(null) }
  }
  if (!canPay || rows === null || rows.length === 0) return null
  return (
    <SectionCard title={`Pending payouts (${rows.length})`} description="Pay the seller with the details shown, then Mark paid to debit their wallet">
      {err && <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{err}</div>}
      <div className="divide-y divide-border">
        {rows.map((p) => {
          const m = p.method || {}
          return (
            <div key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <div className="font-semibold tabular-nums">{usd2(Number(p.amount_usd) || 0)} <span className="text-sm font-normal text-muted-foreground">· {p.seller_name || p.seller_email || "seller"}</span></div>
                <div className="text-xs text-muted-foreground">{fmtDT2(p.created_at)}</div>
                <div className="mt-1 space-y-0.5 rounded-lg bg-muted/50 px-2.5 py-2 text-xs">
                  <div className="font-medium capitalize">{(m.type || "payout").replace("vietqr", "VietQR")}{m.account_name ? ` · ${m.account_name}` : ""}</div>
                  {(m.account_id || m.account_number) && <div className="text-muted-foreground">{m.account_id || m.account_number}{m.bank_name ? ` · ${m.bank_name}` : ""}</div>}
                  {m.note && <div className="text-muted-foreground">{m.note}</div>}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {m.qr && <img src={m.qr} alt="Seller VietQR" className="mt-1.5 size-24 rounded border border-border object-contain" />}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => act(p, "reject")} disabled={busy === p.id} className="text-red-600 hover:text-red-700"><XCircle size={14} weight="bold" /> Reject</Button>
                <Button size="sm" onClick={() => act(p, "pay")} disabled={busy === p.id}>{busy === p.id ? <CircleNotch size={14} className="animate-spin" /> : <><CheckCircle size={14} weight="bold" /> Mark paid</>}</Button>
              </div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

// A ledger row's display category, from its REAL `type` (not just its sign) — so a factory
// cost reads "Postage" / "Product cost" and revenue reads "Revenue", instead of everything
// negative being "Charge" and everything positive "Deposit".
function txMeta(type: string, delta: number): { label: string; tone: string } {
  const t = String(type || "").toLowerCase()
  const EM = "bg-emerald-100 text-emerald-700", MUT = "bg-muted text-muted-foreground", AM = "bg-amber-100 text-amber-800"
  if (t === "order-charge-in") return { label: "Revenue", tone: EM }
  if (t === "order-charge-out" || t === "charge") return { label: "Order charge", tone: MUT }
  if (t === "topup") return { label: "Deposit", tone: EM }
  if (t.startsWith("order-refund")) return { label: "Refund", tone: EM }
  if (t === "blanks-cost") return { label: "Product cost", tone: AM }
  if (t === "label-cost") return { label: "Postage", tone: AM }
  if (t === "design-partner-cost") return { label: "Design", tone: AM }
  if (t === "expedite-cost") return { label: "Dispatch fee", tone: AM }
  if (t === "withdrawal") return { label: "Payout", tone: MUT }
  if (t === "manual-income") return { label: "Income", tone: EM }
  if (t === "manual-expense") return { label: "Expense", tone: AM }
  if (t === "adjust") return { label: "Adjustment", tone: MUT }
  return { label: delta >= 0 ? "Credit" : "Debit", tone: MUT }
}
type Row = {
  id: string
  /** Sort key for merging non-ledger entries (rejected top-ups) into the history. */
  at?: number
  date: string
  desc: string
  ref: string
  method: string
  label: string
  tone: string
  rejected?: boolean
  amount: number
  balance: number
}
type View = {
  balance: number
  charges: number
  deposited: number
  ordersCharged: number
  avgCharge: number
  summary?: WalletSummary
  rows: Row[]
}

const usd = (n: number, signed = false) =>
  `${signed ? (n < 0 ? "−" : "+") : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "—")

// Demo fallback — shown when there's no session / API (keeps the page populated in standalone dev).
const DEMO: View = {
  balance: 12480,
  charges: 6284,
  deposited: 5444,
  ordersCharged: 47,
  avgCharge: 133.7,
  rows: [
    { id: "1", date: "Apr 12", desc: "Bank transfer", ref: "ACH ·2231", method: "ACH", ...txMeta("topup", 500), amount: 500, balance: 12480 },
    { id: "2", date: "Apr 11", desc: "Hoodie · black", ref: "Order #4142", method: "Wallet", ...txMeta("order-charge-out", -63.75), amount: -63.75, balance: 11980 },
    { id: "3", date: "Apr 11", desc: "Tee · 2-pack", ref: "Order #4140", method: "Wallet", ...txMeta("order-charge-out", -27), amount: -27, balance: 12043.75 },
    { id: "4", date: "Apr 10", desc: "Reprint credit", ref: "Order #4088", method: "Wallet", ...txMeta("order-refund-in", 12), amount: 12, balance: 12070.75 },
    { id: "5", date: "Apr 09", desc: "Card ·4417", ref: "Visa", method: "Card", ...txMeta("topup", 250), amount: 250, balance: 12090.25 },
  ],
}

function mapLedger(balance: number, ledger: LedgerRow[], summary?: WalletSummary): View {
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
    if (String(l.type).toLowerCase().startsWith("order-charge")) ordersCharged += 1
    const meta = txMeta(l.type, delta)
    return {
      id: String(l.id),
      at: new Date(l.created_at).getTime(),
      date: new Date(l.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
      desc: l.note || meta.label,
      ref: l.ref || "",
      method: String(l.type).toLowerCase().startsWith("order-charge") ? "Wallet" : "—",
      label: meta.label,
      tone: meta.tone,
      amount: delta,
      balance: balanceAfter,
    }
  })
  return { balance, charges, deposited, ordersCharged, avgCharge: ordersCharged ? charges / ordersCharged : 0, summary, rows }
}

// (A ZERO fallback View used to live here and was rendered whenever getWallet() threw.
//  It is deliberately gone: a zeroed wallet and an unreadable one must not look alike.)

export function WalletDashboard({ partnerHistory = false }: { partnerHistory?: boolean } = {}) {
  const [view, setView] = useState<View | null>(null)
  // Distinguishes "couldn't read the wallet" from "this wallet is empty". Without it the
  // catch below fell back to ZERO, which renders "Available balance $0.00" under a green
  // "Ready for fulfillment" — pixel-identical to a genuinely new account. A seller whose
  // API blipped mid-session was told their money was gone. Same pattern as
  // OrderRefundPanel: a read that FAILED is reported, never rendered as a fact.
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [pending, setPending] = useState<TopupRequest[]>([])
  // Kept so the attempt is still on the record — a rejected top-up never touches the
  // ledger, so without this it would disappear from the app entirely once it left the
  // banner, and "I definitely tried to pay" would have nothing behind it.
  const [rejected, setRejected] = useState<TopupRequest[]>([])

  /**
   * History = the ledger, plus rejected top-up ATTEMPTS.
   *
   * A rejected top-up never credits the wallet, so it has no ledger row — it existed
   * only in the banner above, and filtering it out of there would have erased it from
   * the app completely. It belongs in the record: someone who paid and was refused
   * needs to see that the attempt was seen and declined.
   *
   * Its amount is shown for reference but carries NO balance movement, and the running
   * balance column repeats the balance of the row before it — inventing a balance for a
   * transaction that never happened would make the column stop reconciling.
   */
  const histRows = useMemo(() => {
    const base = view?.rows ?? []
    if (!rejected.length) return base
    const extra: Row[] = rejected.map((r) => ({
      id: `rejected-${r.id}`,
      date: new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
      desc: `Top-up declined${r.method ? ` · ${r.method}` : ""}`,
      ref: r.ref || "",
      method: r.method || "—",
      label: "Declined",
      tone: "bg-red-100 text-red-700",
      rejected: true,
      amount: Number(r.amount_usd) || 0,
      balance: NaN,          // no movement — rendered as "—" rather than a made-up figure
      at: new Date(r.created_at).getTime(),
    }))
    // Sort by REAL timestamp. An earlier version keyed ledger rows off their index,
    // which always outranked a genuine date and pinned every rejected attempt to the
    // bottom regardless of when it happened.
    return [...base, ...extra].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  }, [view?.rows, rejected])
  const [topUpOpen, setTopUpOpen] = useState(false)
  const [payoutOpen, setPayoutOpen] = useState(false)
  // The row a staff/seller clicked to inspect — full detail for an audit/check-up.
  const [detail, setDetail] = useState<Row | null>(null)
  // Admin and warehouse share the FACTORY wallet, which is a pure internal ledger — there
  // is nothing to withdraw from it and no bank/card account to link, so those controls are
  // hidden for them. Sellers keep Withdraw, which now opens the payout flow.
  const isFactoryWallet = ["admin", "warehouse"].includes(getUser()?.role ?? "")

  const refresh = useCallback(() => {
    // Signed in → the real server balance (server-authoritative), or zeros if empty.
    // Demo numbers are ONLY for the signed-out standalone preview — never a real account.
    const signedIn = !!getToken()
    if (!signedIn) { setView(DEMO); return }
    // Admin/warehouse read the shared FACTORY account (where all revenue + costs are booked)
    // — NOT their own personal id, which is empty. Loading the wrong account is why the P&L
    // cards read $0 while the partner breakdown (no account filter) showed real costs.
    getWallet(isFactoryWallet ? "factory" : undefined)
      .then((w) => { setView(mapLedger(w.balance, w.ledger, w.summary)); setLoadErr(null) })
      // Keep any balance already on screen (a failed REFRESH shouldn't blank a good
      // reading) but never invent one where we have none — that was the $0.00 lie.
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Couldn't reach the server."))
    // Surface the seller's own top-up requests that haven't landed in the ledger yet
    // (received ones already show as ledger deposits) so a submitted top-up is visible.
    getMyTopups()
      // Banner = still awaiting a decision. Rejected ones have HAD their decision, so
      // they move into the transaction history below instead of sitting at the top
      // under a heading that no longer describes them.
      .then((rows) => {
        const all = rows ?? []
        setPending(all.filter((r) => r.status === "pending"))
        setRejected(all.filter((r) => r.status === "rejected"))
      })
      .catch(() => setPending([]))
  }, [isFactoryWallet])
  useEffect(() => {
    const id = setTimeout(refresh, 0)
    return () => clearTimeout(id)
  }, [refresh])

  // Nothing readable AND the read failed → say so. Previously this fell through to the
  // ZERO view and asserted a $0.00 balance, which is the one number a seller must never
  // be told wrongly. Skeletons keep animating only while a read is genuinely in flight.
  if (!view && loadErr) {
    return (
      <SectionCard title="Wallet">
        <div className="flex items-start gap-2 px-5 py-4 text-sm text-muted-foreground">
          <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
          <span>
            Couldn&apos;t read your balance, so it isn&apos;t shown — this is a connection
            problem, not a zero balance. Your money is unaffected. {loadErr}
          </span>
        </div>
      </SectionCard>
    )
  }
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

  // Factory (admin/warehouse) reads its wallet as a P&L; a seller reads what they've paid,
  // deposited and been refunded. All totals come from the FULL-ledger summary (uncapped),
  // never the 200-row window. COGS (blanks) only books when a supplier PO is received, so it
  // reads low until purchasing goes live — labelled so it's "what's booked", not "what's owed".
  const s = view.summary
  const fees = s ? s.postage + s.design + s.dispatch : 0
  const profit = s ? s.revenue - s.productCost - fees - s.refundsOut : 0
  const kpis = isFactoryWallet && s
    ? [
        { label: "Revenue", value: usd(s.revenue), sub: "order charges received", tone: "pos" as const },
        { label: "Product cost", value: usd(s.productCost), sub: "blanks booked (COGS)", tone: "mut" as const },
        { label: "Fees & partner", value: usd(fees), sub: "postage · design · dispatch", tone: "mut" as const },
        { label: "Profit", value: usd(profit), sub: `${pct(profit, s.revenue)} margin`, tone: (profit >= 0 ? "pos" : "neg") as "pos" | "neg" },
      ]
    : [
        { label: "Available balance", value: usd(view.balance), sub: "Ready for fulfillment", tone: "pos" as const },
        { label: "Total paid", value: usd(s?.paid ?? view.charges), sub: "fulfillment charges", tone: "mut" as const },
        { label: "Deposited", value: usd(s?.deposits ?? view.deposited), sub: "top-ups", tone: "mut" as const },
        { label: "Refunds", value: usd(s?.refundsIn ?? 0), sub: "returned to you", tone: "mut" as const },
      ]

  return (
    <div className="space-y-4">
      <AdminTopups onReviewed={() => { refresh(); window.dispatchEvent(new CustomEvent("eg-wallet-changed")) }} />
      <AdminPayouts onPaid={() => { refresh(); window.dispatchEvent(new CustomEvent("eg-wallet-changed")) }} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Factory ledger (admin/warehouse) has nothing to withdraw. Sellers get Withdraw,
            which opens the payout flow — enter details + an amount for admin to pay out.
            "Manage Linked Accounts" is gone: those details now live in that dialog. */}
        {!isFactoryWallet && (
          <Button variant="outline" onClick={() => setPayoutOpen(true)}>
            <ArrowLineDown size={16} /> Withdraw
          </Button>
        )}
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

      <PayoutDialog open={payoutOpen} onOpenChange={setPayoutOpen} onDone={refresh} />

      {/* Transaction detail — click any row for the full record (ref, type, note, balances). */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Transaction detail</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Badge className={detail.tone} variant="secondary">{detail.label}</Badge>
                <span className={"text-lg font-semibold tabular-nums " + (detail.rejected ? "text-muted-foreground line-through" : detail.amount >= 0 ? "text-success" : "text-foreground")}>
                  {usd(detail.amount, !detail.rejected)}
                </span>
              </div>
              <dl className="divide-y divide-border rounded-lg border border-border text-sm">
                {[
                  ["Description", detail.desc],
                  ["Date", detail.date],
                  ["Reference", detail.ref || "—"],
                  ["Method", detail.method],
                  ["Balance before", Number.isFinite(detail.balance) ? usd(detail.balance - detail.amount) : "—"],
                  ["Balance after", Number.isFinite(detail.balance) ? usd(detail.balance) : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-4 px-3 py-2">
                    <dt className="shrink-0 text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-words text-right font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {detail.ref && /^(FF-|etsy-|shopify-|tiktok-)/i.test(detail.ref) && (
                <a href={`/orders/${encodeURIComponent(detail.ref)}`} className="inline-flex text-sm font-medium text-primary hover:underline">Open order →</a>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

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
                (k.tone === "pos" ? "text-success" : k.tone === "neg" ? "text-red-600" : "text-muted-foreground")
              }
            >
              {k.sub}
            </div>
          </Card>
        ))}
      </div>

      {/* Second copy of the pending-top-up notice — right above the ledger, where the credit
          lands, so a reviewer working the transactions doesn't miss it. Stays in sync with the
          top-of-page copy via the wallet-changed event. */}
      <AdminTopups onReviewed={() => { refresh(); window.dispatchEvent(new CustomEvent("eg-wallet-changed")) }} />

      {(() => {
      const txCard = (
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="text-base font-bold">Transaction history</div>
          <Button variant="outline" size="sm">
            <DownloadSimple size={14} /> Export CSV
          </Button>
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
              <TableHead className="text-right">Balance before</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {histRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No transactions yet
                </TableCell>
              </TableRow>
            ) : (
              histRows.map((t) => (
                <TableRow key={t.id} onClick={() => setDetail(t)} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="text-muted-foreground">{t.date}</TableCell>
                  <TableCell className="font-medium">{t.desc}</TableCell>
                  <TableCell className="text-muted-foreground">{t.ref}</TableCell>
                  <TableCell className="text-muted-foreground">{t.method}</TableCell>
                  <TableCell>
                    <Badge className={t.tone} variant="secondary">
                      {t.label}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={
                      "text-right font-semibold tabular-nums " +
                      (t.rejected
                        ? "text-muted-foreground line-through"
                        : t.amount >= 0 ? "text-success" : "text-foreground")
                    }
                  >
                    {/* No +/- on a declined attempt: the sign says which way money moved,
                        and it did not move. Struck-through, unsigned, no balance. */}
                    {usd(t.amount, !t.rejected)}
                  </TableCell>
                  {/* Balance before this entry = balance after − the amount it moved. Both
                      dashes for a declined attempt, which never moved money. */}
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {Number.isFinite(t.balance) ? usd(t.balance - t.amount) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {Number.isFinite(t.balance) ? usd(t.balance) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      )
      // Partner history (vendor costs) is FACTORY-ONLY — a seller never sees it. When shown,
      // the transaction table and the partner view sit under one pair of tabs, cards on top.
      return partnerHistory && isFactoryWallet ? (
        <Tabs defaultValue="transactions" className="space-y-3">
          <TabsList>
            <TabsTrigger value="transactions">Transaction history</TabsTrigger>
            <TabsTrigger value="partners">Partner history</TabsTrigger>
          </TabsList>
          <TabsContent value="transactions">{txCard}</TabsContent>
          <TabsContent value="partners"><BillingView /></TabsContent>
        </Tabs>
      ) : txCard
      })()}
    </div>
  )
}

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { labelRail } from "@/lib/payment-method"
import { Plus, DownloadSimple } from "@phosphor-icons/react"
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
import { getCashAccounts, attributeLedgerEntry, type CashAccount, markLedgerTest, getWallet, getMyTopups, getTopups, confirmTopup, rejectTopup, getPayoutRequests, payPayout, rejectPayout, type LedgerRow, type WalletSummary, type TopupRequest, type PayoutRequest } from "@/lib/api"
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
  /** Fee per pending row, typed before confirming. Keyed by id so two rows on screen never
   * share a value — the classic way one transfer's fee lands on another's. */
 const [fees, setFees] = useState<Record<string, string>>({})
 const review = async (t: TopupRequest, action: "confirm" | "reject") => {
    // Close it out of the pending list immediately (optimistic), then record the decision.
    // On success refresh the wallet so the credit lands in the history right away; on
    // failure put it back by reloading the true pending list.
 setBusy(t.id); setTopups((prev) => (prev ?? []).filter((x) => x.id !== t.id))
 try {
 const r = await (action === "confirm" ? confirmTopup(t.id, Number(fees[t.id]) || 0) : rejectTopup(t.id))
 if (r && r.error) { load() } else { onReviewed?.() }
    } catch { load() } finally { setBusy(null) }
  }
 if (!canReview || topups === null || topups.length === 0) return null
 return (
    <SectionCard title={`Pending top-ups (${topups.length})`}>
      <div className="divide-y divide-border">
        {topups.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-semibold tabular-nums">{usd2(Number(t.amount_usd) || 0)} <span className="text-sm font-normal text-muted-foreground">· {t.method || "transfer"}</span></div>
              <div className="text-xs text-muted-foreground">{t.ref ? `Ref ${t.ref} · ` : ""}{fmtDT2(t.created_at)}</div>
            </div>
            <div className="flex items-center gap-2">
              {/* THE FEE, typed at the only moment it is knowable. PingPong, a wire and an
                  FX spread each take a different cut that depends on the sender's bank and
 the day — nobody can predict it when the seller submits, and the person
 confirming is looking at what actually arrived. Optional: blank means the
 full amount landed, which is the common case. */}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Fee $
                <input
 type="number" min="0" step="0.01" inputMode="decimal"
 value={fees[t.id] ?? ""}
 onChange={(e) => setFees((f) => ({ ...f, [t.id]: e.target.value }))}
 placeholder="0.00"
 title="What the transfer itself cost. The seller is still credited the full amount — this is recorded as a separate charge they can see."
 className="h-8 w-20 rounded-lg border border-border bg-card px-2 text-right text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>
              <Button size="sm" variant="outline" onClick={() => review(t, "reject")} disabled={busy === t.id} className="text-alert hover:text-alert">Reject</Button>
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
    <SectionCard title={`Pending payouts (${rows.length})`}>
      {err && <div className="mx-4 mt-3 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">{err}</div>}
      <div className="divide-y divide-border">
        {rows.map((p) => {
 const m = p.method || {}
 return (
            <div key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <div className="font-semibold tabular-nums">{usd2(Number(p.amount_usd) || 0)} <span className="text-sm font-normal text-muted-foreground">· {p.seller_name || p.seller_email || "seller"}</span></div>
                <div className="text-xs text-muted-foreground">{fmtDT2(p.created_at)}</div>
                <div className="mt-1 space-y-0.5 rounded-lg bg-muted/50 px-2.5 py-2 text-xs">
                  <div className="font-medium capitalize">{labelRail(m.type || "payout")}{m.account_name ? ` · ${m.account_name}` : ""}</div>
                  {(m.account_id || m.account_number) && <div className="text-muted-foreground">{m.account_id || m.account_number}{m.bank_name ? ` · ${m.bank_name}` : ""}</div>}
                  {m.note && <div className="text-muted-foreground">{m.note}</div>}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {m.qr && <img src={m.qr} alt="Seller bank QR" className="mt-1.5 size-24 rounded border border-border object-contain" />}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => act(p, "reject")} disabled={busy === p.id} className="text-alert hover:text-alert">Reject</Button>
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
 const EM = "bg-shipped/12 text-shipped", MUT = "bg-muted text-muted-foreground", AM = "bg-hold/15 text-hold"
 if (t === "order-charge-in") return { label: "Revenue", tone: EM }
 if (t === "order-charge-out" || t === "charge") return { label: "Order charge", tone: MUT }
 if (t === "topup") return { label: "Deposit", tone: EM }
 if (t.startsWith("order-refund")) return { label: "Refund", tone: EM }
 if (t === "blanks-cost") return { label: "Product cost", tone: AM }
 if (t === "label-cost") return { label: "Postage", tone: AM }
 if (t === "design-partner-cost") return { label: "Design", tone: AM }
 if (t === "expedite-cost") return { label: "Dispatch fee", tone: AM }
 if (t === "sample-cost") return { label: "Sample", tone: AM }
 if (t === "sample-cost-credit") return { label: "Sample refund", tone: EM }
  // AI, both directions and told apart. Without these three, every generation row in the
  // history fell through to a bare "Debit"/"Credit" — the row that says what a press cost,
  // labelled as nothing in particular.
 if (t === "aigen-cost") return { label: "AI generation", tone: AM }
 if (t === "aigen-in") return { label: "AI billed on", tone: EM }
 if (t === "aigen-out") return { label: "AI generation", tone: MUT }
 if (t.startsWith("aigen-refund")) return { label: "AI refund", tone: EM }
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
  /** Shortened for the cell. */
 ref: string
  /** The untruncated handle, for the tooltip and the detail dialog — shortening is a
   * display decision and must never be the only copy we hold. */
 refFull?: string
 method: string
 label: string
 tone: string
 rejected?: boolean
  /** Marked as not-real-money. Still listed — you cannot unmark what you cannot see — but
   * struck through and excluded from every total. */
 isTest?: boolean
  /** The real account it moved through, or null while unattributed. */
 cashAccount?: string | null
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

/**
 * MONEY AT TWO PLACES — EXCEPT WHEN TWO PLACES IS ZERO.
 *
 * Every figure on this page is money, and money reads at two decimals. But the ledger now
 * carries sub-cent rows: one AI prompt read from two reference photos costs about $0.003,
 * and rounding that to "$0.00" is the same failure the numeric(12,2) column had — the
 * amount is there, and the screen says there is nothing.
 *
 * THE RULE IS HOW MUCH ROUNDING COSTS, not a fixed threshold. If two places lose more than
 * a tenth of the value, the value is shown at the precision it has; otherwise it reads as
 * money. That is self-adjusting in a way a cut-off is not:
 *
 *   $24.50 exact at two places          -> $24.50
 *   $0.134 two places lose 3%           -> $0.13
 *   $0.0127 two places lose 21%          -> $0.0127
 *   $0.0032 two places lose ALL of it    -> $0.0032
 *
 * A fixed "under half a cent" threshold got the last two wrong in opposite directions —
 * it showed $0.0032 and then quietly turned $0.0127 into a penny, which is the same
 * disappearing act the numeric(12,2) column was doing, just smaller.
 *
 * Zero itself stays "$0.00": a row that genuinely moved nothing should not be dressed up as
 * $0.0000, which reads like a measurement rather than an absence.
 */
const usd = (n: number, signed = false) => {
 const v = Math.abs(n)
 const lost = Math.abs(v - Math.round(v * 100) / 100)
  /*
   * AND MONEY THAT MOVED NEVER READS AS ZERO.
   *
   * Four places is enough for everything this ledger books today, but "enough today" is how
   * the numeric(12,2) column got written in the first place. A cost of $0.00003 would render
   * "$0.0000" at four — a real amount displayed as nothing, which is the whole failure this
   * function exists to stop, just further down the scale.
   *
   * So the places are chosen from the VALUE: enough to carry two significant digits, capped
   * at six because that is the column's own scale and nothing finer can be stored anyway.
   */
 let places = 2
 if (v > 0 && lost > v * 0.1) {
 places = Math.min(6, Math.max(4, Math.ceil(-Math.log10(v)) + 1))
  }
 return `${signed ? (n < 0 ? "−" : "+") : ""}$${v.toLocaleString("en-US", {
 minimumFractionDigits: places,
 maximumFractionDigits: places,
  })}`
}
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

/**
 * A REFERENCE YOU CAN READ AT A GLANCE.
 *
 * These are internal handles, printed in full under every description:
 *
 * sub-48b59d7b-a915-47ca-aa3d-f4b102481610-starter-sd-2026-07
 *   607694a1-63fa-4100-a2a6-8801cea6dace
 *
 * Every one of those characters is load-bearing to a database and none of them are to a
 * person. Worse, the UUID is the least distinguishing part: it is the same seller on every
 * row, so it pushes the part that DOES differ — "starter-sd-2026-07" — off the edge.
 *
 * So a UUID collapses to its first eight, which is far more than enough to tell two rows
 * apart, and anything still long is middle-elided so its END survives — that is where the
 * period, the plan and the order number live. The full string stays in the title attribute
 * and in the detail dialog, so nothing is actually lost.
 */
const shortRef = (ref: string) => {
 const collapsed = ref.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => m.slice(0, 8) + "…")
 if (collapsed.length <= 34) return collapsed
 return collapsed.slice(0, 16) + "…" + collapsed.slice(-14)
}

function mapLedger(balance: number, ledger: LedgerRow[], summary?: WalletSummary): View {
 let run = balance
 let charges = 0
 let deposited = 0
 let ordersCharged = 0
 const rows: Row[] = ledger.map((l) => {
 const delta = Number(l.delta) || 0
    // The SERVER's running total when it sent one — it is summed over the whole account, so
    // it stays right however this list is windowed. Walking back from the current balance
    // only agrees while the newest row really is the newest, which a filter can break.
 const balanceAfter = typeof l.balance_after === "number" ? l.balance_after : run
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
 ref: shortRef(l.ref || ""),
 refFull: l.ref || "",
 method: String(l.type).toLowerCase().startsWith("order-charge") ? "Wallet" : "—",
 label: meta.label,
 tone: meta.tone,
 isTest: !!l.is_test,
 cashAccount: l.cash_account ?? null,
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
  // Only an admin may re-classify money; the server enforces it too (requireAdmin), this
  // just decides whether to offer the control.
 const [isAdmin, setIsAdmin] = useState(false)
 const [markingId, setMarkingId] = useState<string | null>(null)
  /** The accounts a row can be attributed to. Loaded once — it is a short list that changes
   * when someone adds an account, not while reading a ledger. */
 const [accounts, setAccounts] = useState<CashAccount[]>([])
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
 tone: "bg-alert/12 text-alert",
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
        /**
         * ABANDONED IS STILL OUTSTANDING — and it was being dropped on the floor.
         *
         * Closing the QR window marks a VietQR request `abandoned` so it leaves the ADMIN
         * queue, which is right: an unpaid one is nothing for staff to act on. But this
         * filtered for `pending` alone, so the moment a seller saved the QR and left for
         * their banking app — which is what closes the window — their request disappeared
         * from here too. No ledger row (the money hasn't landed) and no pending row either:
         * a payment they were about to make, invisible on the page about their money.
         *
         * The virtual account is still live and the reference still settles, so it is not
         * rubbish. It is the one thing on this page they can still act on.
         */
 setPending(all.filter((r) => r.status === "pending" || r.status === "abandoned"))
 setRejected(all.filter((r) => r.status === "rejected"))
      })
      .catch(() => setPending([]))
  }, [isFactoryWallet])
 useEffect(() => {
 const id = setTimeout(() => {
 setIsAdmin(getUser()?.role === "admin")
 refresh()
 getCashAccounts().then((r) => setAccounts(r.accounts ?? [])).catch(() => {})
    }, 0)
 return () => clearTimeout(id)
  }, [refresh])

  /**
   * Mark a ledger row as not-real-money, or restore it.
   *
   * Reloads rather than patching the row in place: marking moves the balance, the
   * running-balance column and every summary card at once, and a screen where the row
   * changed but the totals didn't would be worse than one that took a moment.
   */
  /**
   * Place a movement in the account it really passed through.
   *
   * A select rather than a dialog: this is a list of eighteen entries somebody works down
   * in one sitting, and a modal per row would make attributing the backlog a chore nobody
   * finishes. Reloads because it moves a balance in the panel above.
   */
 const attribute = async (row: Row, account: string) => {
 setMarkingId(row.id)
 try { await attributeLedgerEntry(row.id, account || null); refresh(); getCashAccounts().then((r) => setAccounts(r.accounts ?? [])).catch(() => {}) }
 catch (e) { setLoadErr(e instanceof Error ? e.message : "Couldn't attribute that entry.") }
 finally { setMarkingId(null) }
  }

 const toggleTest = async (row: Row) => {
 setMarkingId(row.id)
 try { await markLedgerTest(row.id, !row.isTest); refresh() }
 catch (e) { setLoadErr(e instanceof Error ? e.message : "Couldn't change that entry.") }
 finally { setMarkingId(null) }
  }

  // Nothing readable AND the read failed → say so. Previously this fell through to the
  // ZERO view and asserted a $0.00 balance, which is the one number a seller must never
  // be told wrongly. Skeletons keep animating only while a read is genuinely in flight.
 if (!view && loadErr) {
 return (
      <SectionCard title="Wallet">
        <div className="flex items-start gap-2 px-5 py-4 text-sm text-muted-foreground">
          <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-hold" />
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
  // Samples sit in `fees` rather than in Product cost: they are money spent to DECIDE, with
  // no order behind them and no margin to sit against, so folding them into COGS would
  // worsen every product's apparent cost. They must be in ONE of the two, though — left out
  // of both, Profit reads high by exactly what sourcing spent.
 const fees = s ? s.postage + s.design + s.dispatch + (s.samples ?? 0) : 0
 const aiCost = s?.aiCost ?? 0
 const aiRevenue = s?.aiRevenue ?? 0
  /**
   * AI IS IN THE PROFIT LINE, on both sides.
   *
   * The same rule the samples comment above states: a cost that is booked but listed nowhere
   * still moves the balance, so Profit would read HIGH by exactly what generation spent.
   * `aiRevenue` is added for the mirror reason — sellers paying for renders is income the
   * revenue line does not carry, and leaving it out would understate by exactly what they paid.
   */
 const profit = s ? s.revenue + aiRevenue - s.productCost - fees - aiCost - s.refundsOut : 0
 const kpis = isFactoryWallet && s
    ? [
        { label: "Revenue", value: usd(s.revenue), sub: "order charges received", tone: "pos" as const },
        { label: "Product cost", value: usd(s.productCost), sub: "blanks booked (COGS)", tone: "mut" as const },
        { label: "Fees & partner", value: usd(fees), sub: "postage · design · dispatch · samples", tone: "mut" as const },
        /* ITS OWN CARD, at the owner's request — and it earns one: this is the only cost here
 incurred by a BUTTON rather than by an order, so it is the only one that can run up
 with nothing shipped. The sub names what came back from sellers when any did, so a
 card reading $40 is not mistaken for $40 lost. */
        { label: "AI generation", value: usd(aiCost), sub: aiRevenue > 0 ? `renders & prompts · ${usd(aiRevenue)} billed on` : "renders & prompts", tone: "mut" as const },
        // SIGNED when negative. usd() renders Math.abs(), so a factory running at a loss
        // read "Profit $103.75" — identical to earning it — with only the tone to say
        // otherwise. A minus sign is not decoration on this number.
        { label: "Profit", value: profit < 0 ? usd(profit, true) : usd(profit), sub: `${pct(profit, s.revenue)} margin`, tone: (profit >= 0 ? "pos" : "neg") as "pos" | "neg" },
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
            Withdraw
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
            <div className="eg-label text-muted-foreground">
              {k.label}
            </div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">{k.value}</div>
            <div
 className={
                "mt-1.5 text-xs font-medium " +
                (k.tone === "pos" ? "text-success" : k.tone === "neg" ? "text-alert" : "text-muted-foreground")
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
          <div className="border-b border-border px-4 py-3">
            {/* Not "Awaiting confirmation": a VietQR request confirms ITSELF when the money
 arrives, so nobody is waiting to approve it — the seller is waiting to pay
 it. Only a manual transfer waits on a human. */}
            <div className="mb-2 eg-label text-muted-foreground">Not in your balance yet</div>
            <div className="space-y-1.5">
              {pending.map((p) => {
 const rejected = p.status === "rejected"
                /* VietQR self-confirms, so an unpaid one is the SELLER's move, not an
 admin's. A manual transfer really does wait on someone reading a receipt. */
 const selfServe = p.status === "abandoned" || String(p.method || "").toLowerCase() === "vietqr"
 return (
                  <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={rejected ? "bg-alert/12 text-alert" : "bg-hold/15 text-hold"}>
                        {rejected ? "Rejected" : selfServe ? "Awaiting payment" : "Awaiting confirmation"}
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
            <div className="mt-2 text-xs text-muted-foreground">Pending top-ups credit your balance once confirmed (BIDV auto-confirms on payment; manual transfers are reviewed by our team).</div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {/* Reference and Method used to be columns of their own. Between a mono
 reference like "expedite-cancel-etsy-4128916808" and a Method that is "—"
 on almost every row, they pushed the two BALANCE columns off the right
 edge — so the one thing this table exists to show, how the balance got
 from one number to the next, was the thing you had to scroll to find.
                  They sit under the description now, and the row still opens a detail
 dialog carrying both in full. */}
              <TableHead>Description</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance before</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {histRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No transactions yet
                </TableCell>
              </TableRow>
            ) : (
 histRows.map((t) => (
                <TableRow key={t.id} onClick={() => setDetail(t)} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="text-muted-foreground">{t.date}</TableCell>
                  {/* BOUNDED. A description is free text — a marketplace product title runs
 to 140 characters — and an unbounded cell let one row set the width of
 the whole table, pushing the balance columns out to where nobody scrolls.
                      Capped and truncated, with the full text on hover and in the row's own
 dialog, so the table keeps a shape a column of numbers can be read down. */}
                  <TableCell className="max-w-[26rem] font-medium">
                    <div className="truncate" title={t.desc}>{t.desc}</div>
                    {(t.ref || (t.method && t.method !== "—")) && (
                      <div className="mt-0.5 truncate text-xs font-normal text-muted-foreground"
 title={[t.refFull || t.ref, t.method && t.method !== "—" ? t.method : null].filter(Boolean).join(" · ")}>
                        {[t.ref, t.method && t.method !== "—" ? t.method : null].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* A GRID, NOT A ROW — the pill gets a fixed column.
                        "AI generation" and "Postage" are different widths, so in a flex row
 every control after them started at a different x and the column read
 as crooked down the page. The badge now sits in a fixed track and
 everything after it shares one left edge, which is the whole of the
 fix — nothing here changed size. */}
                    <span className="grid grid-cols-[8.5rem_auto] items-center gap-1.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Badge className={t.tone + " truncate"} variant="secondary">
                          {t.label}
                        </Badge>
                        {t.isTest && (
                          <Badge variant="secondary" className="bg-muted text-muted-foreground">Test</Badge>
                        )}
                      </span>
                      {/* ONE CONTROL, NOT TWO.
                          Attributing a row to an account and marking it a test are the same
 question asked twice — "what IS this entry" — and they were two
 controls of different shapes side by side. Both live in the select
 now, separated into groups so the destructive-ish one is not sitting
 in the same list as the accounts.

 stopPropagation throughout, because the row itself opens a dialog.
                          Marked money is excluded from the balance and every total, and the
 row stays put so the decision can be undone. */}
                      {isAdmin && !t.rejected ? (
                        <select
 value={t.cashAccount ?? ""}
 disabled={markingId === t.id}
 onClick={(e) => e.stopPropagation()}
 onChange={(e) => {
 e.stopPropagation()
 const v = e.target.value
 if (v === "__test__") { void toggleTest(t); return }
 void attribute(t, v)
                          }}
 title="Which real account this moved through, or mark it a test"
 className={"w-[9.5rem] rounded border border-border bg-transparent px-1 py-0.5 text-2xs "
                            + (t.cashAccount ? "text-muted-foreground" : "text-hold")}
                        >
                          <option value="">{markingId === t.id ? "…" : "— unassigned"}</option>
                          {accounts.length > 0 && (
                            <optgroup label="Account">
                              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </optgroup>
                          )}
                          <optgroup label="Bookkeeping">
                            <option value="__test__">{t.isTest ? "Count as real money" : "Mark as test"}</option>
                          </optgroup>
                        </select>
                      ) : <span />}
                    </span>
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
                  <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                    {Number.isFinite(t.balance) ? usd(t.balance - t.amount) : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
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

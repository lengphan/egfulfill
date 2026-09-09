"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { CurrencyDollar, CircleNotch, Warning, Coins, Receipt } from "@phosphor-icons/react"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { SectionCard } from "@/components/app/section-card"
import { EmptyState } from "@/components/app/empty-state"
import { PageTitle } from "@/components/app/page-title"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ActionsPortal } from "@/components/app/console-shell"
import { PayoutDialog } from "@/components/app/payout-dialog"
import { railLabel } from "@/lib/payment-method"
import { getWallet, getDesignerEarnings, getPayoutRequests, type DesignerEarning, type PayoutRequest } from "@/lib/api"
import { getToken } from "@/lib/auth"

const money = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDT = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/**
 * A card title is a marketplace LISTING name, and they run long — five products and a gift
 * line in one string. Cut it at the first comma, which is where the first product ends, and
 * fall back to a hard truncation for a title with no commas in it.
 */
function shortTitle(t: string | null): string {
  const raw = String(t || "").trim()
  if (!raw) return "—"
  const head = raw.split(",")[0].trim()
  return head.length > 64 ? head.slice(0, 63) + "…" : head
}

const TONE = {
  ok: "bg-shipped/12 text-shipped",
  wait: "bg-hold/15 text-hold",
  bad: "bg-alert/12 text-alert",
  mute: "bg-muted text-muted-foreground",
}
function payoutTone(status: string): string {
  const s = String(status || "").toLowerCase()
  return s === "paid" ? TONE.ok : s === "rejected" ? TONE.bad : TONE.wait
}

/**
 * A DESIGNER'S OWN EARNINGS.
 *
 * This page used to read `getWallet("designer")` — the shared, UNATTRIBUTED pool — while the
 * credit route pays the designer's own user id whenever it can resolve the claimer. So the
 * balance on screen was not this person's money, and a withdraw button beside it would have
 * offered a different number from the one above it, which is the worst thing a money screen
 * can do. `getWallet()` with no argument is the caller's own wallet, server-side.
 *
 * AND IT IS NO LONGER A RAW LEDGER. A ledger row carries a note and nothing else, so every
 * question a designer actually has about a payment — which card, which order, what state is
 * it in — had to fit inside `Design payout · <title>`, and a title is a listing name. The
 * card table comes from a join the server does on the credit's `DSN-<id>` ref.
 *
 * CREDITED IS NOT PAID, and the two tables say so separately: the top one is money that has
 * landed in the wallet, the bottom one is money that has actually left for a bank account.
 */
export function DesignerEarnings() {
  const tl = useLabelT()
  const [balance, setBalance] = useState<number | null>(null)
  const [cards, setCards] = useState<DesignerEarning[] | null>(null)
  const [payouts, setPayouts] = useState<PayoutRequest[] | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [proof, setProof] = useState<string | null>(null)
  // Telling a designer they have earned $0.00 when the ledger simply could not be read is
  // the worst lie this page can tell, so a failure is reported rather than zeroed.
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!getToken()) { setLoadErr("You're signed out."); return }
    Promise.all([getWallet(), getDesignerEarnings(), getPayoutRequests()])
      .then(([w, e, p]) => {
        setBalance(w.balance ?? 0)
        setCards(e ?? [])
        setPayouts(p ?? [])
        setLoadErr(null)
      })
      .catch((err) => setLoadErr(err instanceof Error ? err.message : "Couldn't reach the server."))
  }, [])

  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  const earned = (cards ?? []).reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const paidOut = (payouts ?? []).filter((p) => p.status === "paid").reduce((s, p) => s + (Number(p.amount_usd) || 0), 0)
  const ready = balance ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 md:hidden">
        <CurrencyDollar size={18} weight="regular" className="shrink-0 text-primary" />
        <div className="min-w-0">
          <PageTitle>{tl("designerEarnings", "Earnings")}</PageTitle>
        </div>
      </div>

      <ActionsPortal>
        <Button onClick={() => setAskOpen(true)} disabled={ready <= 0}>
          <Receipt size={16} weight="bold" /> {tl("designerEarnings", "Request payout")}
        </Button>
      </ActionsPortal>

      {loadErr && balance === null ? (
        <div className="flex items-start gap-2 rounded-2xl border border-border px-5 py-4 text-sm text-muted-foreground">
          <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-hold" />
          <span>Couldn&apos;t load your earnings, so they aren&apos;t shown — this is not a zero balance. {loadErr}</span>
        </div>
      ) : balance === null ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground"><CircleNotch size={24} className="animate-spin" /></div>
      ) : (
        <>
          <StatGrid>
            <StatCard label={tl("designerEarnings", "Available")} value={money(ready)} sub={tl("designerEarnings", "ready to withdraw")} tone={ready ? "pos" : undefined} />
            <StatCard label={tl("designerEarnings", "Earned all time")} value={money(earned)} sub={`${(cards ?? []).length} ${(cards ?? []).length === 1 ? "card" : "cards"}`} />
            <StatCard label={tl("designerEarnings", "Paid out")} value={money(paidOut)} sub={tl("designerEarnings", "sent to you")} />
          </StatGrid>

          {/* WHAT WAS EARNED, per card. Approval put this in the wallet; it does not mean
              anyone has sent it. */}
          <SectionCard title={tl("designerEarnings", "Earnings by card")}>
            {(cards ?? []).length === 0 ? (
              <EmptyState icon={Coins} title={tl("designerEarnings", "No earnings yet")} note={tl("designerEarnings", "A card pays when an admin approves it.")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left eg-label text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">{tl("designerEarnings", "Approved")}</th>
                      <th className="px-4 py-2.5">{tl("designerEarnings", "Card")}</th>
                      <th className="px-4 py-2.5">{tl("designerEarnings", "Order")}</th>
                      <th className="w-28 px-4 py-2.5">{tl("designerEarnings", "Status")}</th>
                      <th className="px-4 py-2.5 text-right">{tl("designerEarnings", "Amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(cards ?? []).map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{fmtDT(c.at)}</td>
                        <td className="px-4 py-2">
                          <span className="block">{shortTitle(c.title)}</span>
                          {c.cardId && <span className="block text-xs text-muted-foreground">DSN-{c.cardId}{c.sku ? ` · ${c.sku}` : ""}</span>}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{c.orderId || "—"}</td>
                        <td className="px-4 py-2">
                          {/* The card's own state, not the payout's. A card that was later
                              moved back out of Approved still earned this — the ledger row
                              is settled — so the lane is shown rather than assumed. */}
                          <span className={"inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize " + (c.lane === "approved" ? TONE.ok : c.lane ? TONE.wait : TONE.mute)}>
                            {c.lane || tl("designerEarnings", "credited")}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-success">+{money(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* WHAT ACTUALLY LEFT, and by which rail. `paid_method` is what we really used —
              often not what was nominated — and the proof is the confirmation for it. */}
          <SectionCard title={tl("designerEarnings", "Withdrawals")}>
            {(payouts ?? []).length === 0 ? (
              <EmptyState icon={Receipt} title={tl("designerEarnings", "No withdrawals yet")} note={tl("designerEarnings", "A request is raised for you each month, or ask any time.")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left eg-label text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">{tl("designerEarnings", "Requested")}</th>
                      <th className="w-28 px-4 py-2.5">{tl("designerEarnings", "Status")}</th>
                      <th className="px-4 py-2.5">{tl("designerEarnings", "Paid via")}</th>
                      <th className="px-4 py-2.5">{tl("designerEarnings", "Confirmation")}</th>
                      <th className="px-4 py-2.5 text-right">{tl("designerEarnings", "Amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payouts ?? []).map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                          {fmtDT(p.created_at)}
                          {p.auto && <span className="ml-1.5 text-xs">{tl("designerEarnings", "monthly")}</span>}
                        </td>
                        <td className="px-4 py-2">
                          <span className={"inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize " + payoutTone(p.status)}>{p.status}</span>
                        </td>
                        <td className="px-4 py-2">
                          {p.status === "paid"
                            ? railLabel(p.paid_method?.type) || tl("designerEarnings", "not recorded")
                            : <span className="text-muted-foreground">—</span>}
                          {p.paid_note && <span className="block text-xs text-muted-foreground">{p.paid_note}</span>}
                        </td>
                        <td className="px-4 py-2">
                          {p.proof ? (
                            <button onClick={() => setProof(p.proof!)} className="eg-tap">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.proof} alt={tl("designerEarnings", "Transfer confirmation")} className="size-10 rounded border border-border object-cover" />
                            </button>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold">{money(p.amount_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      <PayoutDialog open={askOpen} onOpenChange={setAskOpen} onDone={load} />

      <Dialog open={!!proof} onOpenChange={(o) => { if (!o) setProof(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{tl("designerEarnings", "Transfer confirmation")}</DialogTitle></DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {proof && <img src={proof} alt={tl("designerEarnings", "Transfer confirmation")} className="w-full rounded-lg border border-border object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

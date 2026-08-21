"use client"

import { useCallback, useEffect, useState } from "react"
import { Receipt, CircleNotch, DownloadSimple, Plus } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getLedgerPartners, getLedgerExport, ledgerExportUrl, type LedgerRowOut, type PartnerTotal } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { LedgerEntryDialog } from "@/components/app/ledger-entry-dialog"
import { PageTitle } from "@/components/app/page-title"
import { EmptyState } from "@/components/app/empty-state"

const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Partner keys are internal; these are what a human calls them. */
const PARTNER_LABEL: Record<string, string> = {
  byeastside: "byeastside (dispatch)",
  pinkdesign: "Pink Design",
  designer: "In-house designers",
  carrier: "Carriers (postage)",
  // Kept for rows booked before recordCost wrote a partner. Named so it cannot be mistaken
  // for a live supplier — those now appear under their own names.
  suppliers: "Suppliers (unsplit)",
  unattributed: "Unattributed",
}
const label = (p: string) => PARTNER_LABEL[p] ?? p

// Every partner we book costs against, whether or not anything has been booked YET.
// The filter used to list only partners already present in the ledger, so before the
// first cost is recorded it was empty — which reads as "the filter is broken" rather
// than "nothing has been spent". Keys match the mapping in wallet.js.
// The three we integrate with are listed so their filter option exists before their first
// PO is received — an absent option reads as a broken filter, not as "nothing spent yet".
// Alibaba sellers are NOT listed: they are individual people with no fixed set, and they
// appear by name as soon as they are paid.
const KNOWN_PARTNERS = ["byeastside", "pinkdesign", "designer", "carrier",
  "Otto Cap", "S&S Activewear", "SanMar", "suppliers"]

/** First and last day of the current month, as yyyy-mm-dd. */
function thisMonth() {
  const d = new Date()
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`
  return { from: iso(first), to: iso(d) }
}

/**
 * Partner billing — what we owe, and the rows behind it.
 *
 * Neither partner has a billing API we can charge or credit against: byeastside and
 * Pink Design both settle by INVOICE. So this ledger is the only record their bill gets
 * checked against, which is why the export matters more than the summary — the figures
 * have to be able to sit next to what they sent us.
 *
 * Amounts are signed from OUR side: negative means we paid out or owe.
 */
export function BillingView() {
  const [entryOpen, setEntryOpen] = useState(false)
  const [partners, setPartners] = useState<PartnerTotal[] | null>(null)
  const [rows, setRows] = useState<LedgerRowOut[] | null>(null)
  const [total, setTotal] = useState(0)
  const [partner, setPartner] = useState("")
  // Why the partner list is empty, when it is. Swallowing this would make a failed
  // request look identical to "nothing booked yet" — the same trap that hid a broken
  // team query for months.
  const [partnersErr, setPartnersErr] = useState<string | null>(null)
  const [range, setRange] = useState(thisMonth())

  useEffect(() => {
    const id = setTimeout(() => {
      if (!getToken()) { setPartners([]); return }
      getLedgerPartners()
        .then((r) => { setPartners(r ?? []); setPartnersErr(null) })
        .catch((e) => { setPartners([]); setPartnersErr(e instanceof Error ? e.message : "Couldn't load partners") })
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const load = useCallback(() => {
    if (!getToken()) { setRows([]); return }
    setRows(null)
    getLedgerExport({ partner: partner || undefined, from: range.from, to: range.to })
      .then((r) => { setRows(r.rows ?? []); setTotal(r.total ?? 0) })
      .catch(() => setRows([]))
  }, [partner, range])

  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  const filters = { partner: partner || undefined, from: range.from, to: range.to }
  // Known partners first (stable order), then anything unexpected the ledger contains —
  // a partner key we don't recognise should surface, not be quietly dropped.
  const seen = new Map((partners ?? []).map((p) => [p.partner, p]))
  const options = [...KNOWN_PARTNERS, ...[...seen.keys()].filter((k) => !KNOWN_PARTNERS.includes(k))]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 md:hidden">
        <Receipt size={18} weight="regular"  className="shrink-0 text-primary" />
        <div className="min-w-0">
          <PageTitle>Billing</PageTitle>
          <p className="truncate text-sm text-muted-foreground">What each partner is owed, and the rows behind it.</p>
        </div>
      </div>

      {/* One card per partner. Totals are all-time — the table below is what's filtered,
          because a partner's LIFETIME position and this month's invoice are different
          questions and collapsing them hides one.

          NO LONGER CAPPED AT FOUR. That cap predates suppliers being split out, when there
          were only ever a handful of partners; with Otto, S&S, SanMar and every Alibaba
          seller each carrying their own line, a silent slice would hide exactly the
          suppliers this split exists to show. Eight is the point where the grid stops being
          scannable, and anything beyond it is still in the table below — but it is stated
          on screen rather than dropped, which the old slice never did. */}
      <StatGrid>
        {(partners ?? []).slice(0, 8).map((p) => (
          <StatCard
            key={p.partner}
            label={label(p.partner)}
            value={usd(p.total)}
            sub={`${p.entries} entr${p.entries === 1 ? "y" : "ies"} · all time`}
            tone={p.total < 0 ? "neg" : "pos"}
          />
        ))}
        {(partners?.length ?? 0) > 8 && (
          <StatCard
            label={`+${(partners?.length ?? 0) - 8} more partners`}
            value={usd((partners ?? []).slice(8).reduce((t, x) => t + x.total, 0))}
            sub="Filter the ledger below to see any one of them"
          />
        )}
        {partners !== null && partners.length === 0 && (
          <StatCard
            label={partnersErr ? "Couldn't load partners" : "No partner costs yet"}
            value="—"
            sub={partnersErr ?? "Set the rates in Settings → Platform → Partner rates"}
            tone={partnersErr ? "neg" : undefined}
          />
        )}
      </StatGrid>

      <SectionCard
        title="Ledger"
        actions={
          <div className="flex items-center gap-2">
            {/* Manual entry lives HERE, next to the ledger it writes into, rather than in
                Settings — the row it creates is indistinguishable from the ones above it
                once written, and the person adding one is already reading this list. The
                page is warehouse/admin-only, which is the same gate the route enforces. */}
            <Button size="sm" variant="outline" onClick={() => setEntryOpen(true)}>
              <Plus size={14} weight="bold" /> Add entry
            </Button>
            <a href={ledgerExportUrl(filters)} download>
              <Button size="sm" variant="outline" disabled={!rows?.length}>
                <DownloadSimple size={14} weight="bold" /> Export CSV
              </Button>
            </a>
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-2 border-b border-border px-5 py-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Partner</span>
            <select
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
              className="eg-select h-9 rounded-md border border-border bg-card px-2 text-sm"
            >
              <option value="">All partners</option>
              {options.map((k) => (
                <option key={k} value={k}>
                  {label(k)}{seen.has(k) ? "" : " — nothing booked yet"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">From</span>
            <Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-9 w-40" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">To</span>
            <Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-9 w-40" />
          </label>
          <span className="ml-auto text-sm">
            <span className="text-muted-foreground">Period total </span>
            <span className={"font-semibold tabular-nums " + (total < 0 ? "text-destructive" : "text-success")}>{usd(total)}</span>
          </span>
        </div>

        {rows === null ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Nothing booked in this period"
            note={partner ? `No costs recorded for ${label(partner)} in this window.` : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left eg-label text-muted-foreground">
                  <th className="px-5 py-2">Date</th>
                  <th className="px-3 py-2">Partner</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-5 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={String(r.id)}>
                    <td className="whitespace-nowrap px-5 py-2 text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
                    </td>
                    <td className="px-3 py-2">{r.partner ? label(r.partner) : "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">{r.type}</td>
                    <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">{r.ref || "—"}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-muted-foreground">{r.note || "—"}</td>
                    <td className={"whitespace-nowrap px-5 py-2 text-right font-semibold tabular-nums " + (r.delta < 0 ? "text-destructive" : "text-success")}>
                      {usd(r.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Reload after a write: the row just added belongs in the list above it, and a
          ledger that needs a refresh to show what you just entered reads as a failure. */}
      <LedgerEntryDialog open={entryOpen} onOpenChange={setEntryOpen} onDone={() => load()} />
    </div>
  )
}

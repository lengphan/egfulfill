"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Warning, ArrowsClockwise, ChartBar, Check } from "@phosphor-icons/react"
import { getUsageSummary, setUsageConfig, type UsageSummary, type UsagePlatform } from "@/lib/api"
import { EmptyState } from "@/components/app/empty-state"

const WINDOWS = [{ d: 7, label: "7 days" }, { d: 30, label: "30 days" }, { d: 90, label: "90 days" }]
const money = (n: number) => "$" + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// One platform row: the live meter (read) plus, for admins, a compact cost/limit editor. The
// monthly $ limit only ALERTS — nothing is throttled — so this never gates a live call.
function PlatformCard({ p, isAdmin, onSaved }: { p: UsagePlatform; isAdmin: boolean; onSaved: () => void }) {
  const tl = useLabelT()
 const [cost, setCost] = useState((p.costPerCallCents / 100).toString())
 const [limit, setLimit] = useState(p.monthlyLimitDollars ? String(p.monthlyLimitDollars) : "")
 const [saving, setSaving] = useState(false)
 const [saved, setSaved] = useState(false)

 const save = async () => {
 setSaving(true); setSaved(false)
 try {
 await setUsageConfig({
 platform: p.key,
 costPerCallCents: Math.max(0, Math.round(parseFloat(cost || "0") * 100)),
 monthlyLimitCents: Math.max(0, Math.round(parseFloat(limit || "0") * 100)),
      })
 setSaved(true); setTimeout(() => setSaved(false), 1500); onSaved()
    } finally { setSaving(false) }
  }

 const pct = p.pct == null ? null : Math.min(100, p.pct)
 return (
    <div className={"rounded-xl border p-3 " + (p.over ? "border-alert/30 bg-alert/50" : "border-border bg-card")}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{tl("usage", p.label)}</div>
          <div className="text-2xs text-muted-foreground">
            {p.calls.toLocaleString()} call{p.calls === 1 ? "" : "s"}
            {p.errors > 0 && <span className="text-alert"> · {p.errors} failed</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{money(p.estDollars)}</div>
          <div className="text-2xs text-muted-foreground">{tl("usage", "est. this window")}</div>
        </div>
      </div>

      {/* Threshold bar — only shown once a monthly limit is set. */}
      {p.monthlyLimitDollars > 0 && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={"h-full rounded-full " + (p.over ? "bg-alert" : "bg-primary")} style={{ width: `${pct ?? 0}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-2xs text-muted-foreground">
            <span>{money(p.estMonthlyDollars)}/mo projected</span>
            <span className={p.over ? "font-medium text-alert" : ""}>{p.pct}% of {money(p.monthlyLimitDollars)}</span>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="mt-2.5 flex items-end gap-2 border-t border-border/70 pt-2.5">
          <label className="flex-1 text-2xs text-muted-foreground">
            {tl("usage", "Est. $/call")}
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="0.00"
 className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums outline-none focus:border-primary" />
          </label>
          <label className="flex-1 text-2xs text-muted-foreground">
            {tl("usage", "Alert at $/mo")}
            <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder="none"
 className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums outline-none focus:border-primary" />
          </label>
          <button onClick={() => void save()} disabled={saving}
 className="inline-flex h-[30px] items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
            {saving ? <CircleNotch size={13} className="animate-spin" /> : saved ? <Check size={13} weight="bold" /> : null}
            {saved ? tl("usage", "Saved") : tl("usage", "Save")}
          </button>
        </div>
      )}
    </div>
  )
}

export function UsagePanel({ isAdmin }: { isAdmin: boolean }) {
  const tl = useLabelT()
 const [days, setDays] = useState(30)
 const [data, setData] = useState<UsageSummary | null>(null)
 const [loading, setLoading] = useState(true)

 const load = useCallback(async () => {
 setLoading(true)
 try { setData(await getUsageSummary(days)) } catch { setData(null) } finally { setLoading(false) }
  }, [days])
  // Defer out of the effect body (react-hooks/set-state-in-effect — the pattern used across app pages).
 useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t) }, [load])

 return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><ChartBar size={18} className="text-primary" /> {tl("usage", "Integration usage & spend")}</h2>
          <p className="text-sm text-muted-foreground">{tl("usage", "API call volume + estimated cost per platform. Thresholds alert only — nothing is throttled.")}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg border border-border p-0.5">
            {WINDOWS.map((w) => (
              <button key={w.d} onClick={() => setDays(w.d)}
 className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (days === w.d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
                {tl("usage", w.label)}
              </button>
            ))}
          </div>
          <button onClick={() => void load()} title={tl("usage", "Refresh")} className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent">
            <ArrowsClockwise size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
      ) : !data ? (
        <EmptyState icon={Warning} size="sm" title={tl("usage", "Couldn't load usage")} note={tl("usage", "This is unknown rather than zero — try refreshing.")} />
      ) : (
        <>
          {/* Alert banner when any platform crosses its monthly threshold. */}
          {data.totals.alerts.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-alert/30 bg-alert/12 px-3 py-2 text-sm text-alert">
              <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
              <span>{data.totals.alerts.length} platform{data.totals.alerts.length === 1 ? "" : "s"} projected to exceed the monthly alert threshold: <strong>{data.platforms.filter((p) => p.over).map((p) => p.label).join(", ")}</strong>.</span>
            </div>
          )}

          {/* Totals: est API $ vs the real $ already ledgered (postage, blanks, …). */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-center">
              <div className="text-lg font-semibold tabular-nums">{data.totals.calls.toLocaleString()}</div>
              <div className="text-2xs text-muted-foreground">API calls · {data.days}d</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-center">
              <div className="text-lg font-semibold tabular-nums">{money(data.totals.estDollars)}</div>
              <div className="text-2xs text-muted-foreground">{tl("usage", "estimated API cost")}</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-center">
              <div className="text-lg font-semibold tabular-nums">{money(data.totals.ledgeredDollars)}</div>
              <div className="text-2xs text-muted-foreground">{tl("usage", "real ledgered cost")}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {data.platforms.map((p) => <PlatformCard key={p.key} p={p} isAdmin={isAdmin} onSaved={() => void load()} />)}
          </div>

          {/* Real money already booked into wallet_ledger — the actual spend, not an estimate. */}
          {data.ledgered.some((c) => c.dollars > 0 || c.count > 0) && (
            <div className="mt-5">
              <div className="mb-1.5 eg-label text-muted-foreground">{tl("usage", "Real costs (from the ledger)")}</div>
              <div className="grid gap-2 sm:grid-cols-4">
                {data.ledgered.map((c) => (
                  <div key={c.type} className="rounded-lg border border-border bg-muted/20 p-2.5 text-center">
                    <div className="text-sm font-semibold tabular-nums">{money(c.dollars)}</div>
                    <div className="text-2xs text-muted-foreground">{tl("usage", c.label)}{c.count ? ` · ${c.count}` : ""}</div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-2xs text-muted-foreground">{tl("usage", "Postage & blanks bill their exact amount into the wallet ledger, so these are actual dollars — the per-platform figures above estimate API-call cost from the rate you set.")}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

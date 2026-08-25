"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { CircleNotch, Check } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPlanPrices, savePlanPrices, getPlanCounts, type PlanPrices } from "@/lib/api"
import { useConfirm } from "@/components/app/confirm-dialog"

/**
 * SUBSCRIPTION PACKAGES — what each plan costs per month.
 *
 * These were constants in billing.js, so changing what Pro costs was a deploy. The server
 * keeps them as DEFAULTS and overlays whatever is saved here, read at charge time rather than
 * at boot — a price snapshotted at start-up is a setting that appears to do nothing until
 * somebody restarts the API.
 *
 * NOT RETROACTIVE, and said on screen rather than only in the code: runRenewals is idempotent
 * per (user, month), so a month already charged stays charged at the figure it was charged at.
 * A new price meets the next renewal.
 */
/** One set of tracks for the header and every row, so Sellers / Per month / Billing line up
 *  under their labels. px-5 matches the card header above it — the rows are full width and the
 *  TEXT is what aligns, rather than a box drawn inside a box. */
const ROW = "grid grid-cols-[minmax(0,1fr)_5rem_7rem_6rem] items-center gap-x-3 px-5"

export function PlanPackagesPanel() {
  const tl = useLabelT()
  const [prices, setPrices] = useState<PlanPrices | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      getPlanPrices().then(setPrices).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't read the price list."))
    }, 0)
    return () => clearTimeout(t)
  }, [])

  /**
   * HOW MANY SELLERS EACH PRICE APPLIES TO.
   *
   * A price list alone cannot be judged: $29 against twenty sellers and $29 against none are
   * the same screen and completely different decisions. Loaded separately from the prices so a
   * failure here costs the counts and not the editor — the panel's job is still to save a
   * price, and `null` prints a dash rather than a zero nobody can distinguish from "none".
   */
  const [counts, setCounts] = useState<{ plans: Record<string, number>; spydeck: number } | null>(null)
  useEffect(() => {
    const t = setTimeout(() => { getPlanCounts().then(setCounts).catch(() => {}) }, 0)
    return () => clearTimeout(t)
  }, [])

  const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`
  /** What a row bills a month: everyone on it, at the price currently in the field — so the
   *  figure moves as you type and shows what the change is worth before it is saved. */
  const monthly = (n: number | undefined, price: string) =>
    n == null || !Number.isFinite(Number(price)) ? null : n * Number(price)

  // Text, not number: "" is a state a field can be in while somebody retypes it, and a
  // numeric state collapses it to 0 — which here is a real price.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const shown = (k: string, v: number) => draft[k] ?? String(v)

  const confirm = useConfirm()

  /**
   * A CUT IS CONFIRMED, AND THE SERVER DECIDES WHICH ONES.
   *
   * The 409 comes back naming each change — "pro $29 → free" — so the question asked here is
   * about something specific. "Are you sure?" answers itself; a list of the prices about to
   * fall does not.
   *
   * The rule is not duplicated in the browser on purpose: two copies of "what counts as a
   * sharp cut" drift, and the one that matters is the one the endpoint enforces.
   */
  const save = async () => {
    if (!prices) return
    setBusy(true); setErr(null); setSaved(false)
    try {
      const plans: Record<string, number> = {}
      for (const [k, v] of Object.entries(prices.plans)) plans[k] = Number(shown(`plan:${k}`, v))
      const addonPrice = Number(shown("addon", prices.spydeck_addon))
      let r = await savePlanPrices({ plans, spydeck_addon: addonPrice })
      if (r.needsConfirm) {
        const ok = await confirm({
          title: tl("planPackages", "Save this price cut?"),
          body: `${(r.drops ?? []).join("\n")}\n\nExisting charges are unaffected — this applies from each seller's next renewal. A plan at $0 stops renewing altogether.`,
          confirmLabel: "Save prices",
          destructive: true,
        })
        if (!ok) { setBusy(false); return }
        r = await savePlanPrices({ plans, spydeck_addon: addonPrice, confirm: true })
      }
      if (r.error) throw new Error(r.error)
      setPrices({ plans: r.plans, spydeck_addon: r.spydeck_addon })
      setDraft({})
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save those prices.")
    } finally { setBusy(false) }
  }

  return (
    <SectionCard title={tl("planPackages", "Subscription packages")} description={tl("planPackages", "What each plan is billed per month.")}>
      {!prices ? (
        <div className="flex justify-center py-6 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
      ) : (
        <>
          {/* NO BOX INSIDE THE BOX. This was a bordered table indented 20px inside a bordered
              card — two frames running parallel down the page, and at the corners they read as
              one line about to touch another. The card is already the frame; the rows sit
              directly in it, full width, separated the way every other list in the app is. */}
          <div className="divide-y divide-border border-b border-border">
            <div className={ROW + " py-2 eg-label text-muted-foreground"}>
              <span>{tl("planPackages", "Plan")}</span>
              <span className="text-right">{tl("planPackages", "Sellers")}</span>
              <span className="text-right">{tl("planPackages", "Per month")}</span>
              <span className="text-right">{tl("planPackages", "Billing")}</span>
            </div>
            {Object.entries(prices.plans).map(([name, v]) => {
              const n = counts?.plans[name]
              const bills = monthly(n, shown(`plan:${name}`, v))
              return (
                <div key={name} className={ROW + " py-2.5"}>
                  <span className="text-sm font-medium capitalize">{name}</span>
                  {/* A DASH IS NOT A ZERO — the counts load separately and can fail on their
                      own, and "nobody is on Pro" is a very different sentence from "we could
                      not read who is on Pro". */}
                  <span className="text-right text-sm tabular-nums text-muted-foreground">
                    {n == null ? "—" : n}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input
                      value={shown(`plan:${name}`, v)}
                      onChange={(e) => setDraft((d) => ({ ...d, [`plan:${name}`]: e.target.value.replace(/[^\d.]/g, "") }))}
                      inputMode="decimal"
                      aria-label={`${name} price per month`}
                      className="h-8 w-20 px-2 text-right tabular-nums"
                    />
                  </div>
                  <span className="text-right text-sm tabular-nums">
                    {bills == null ? <span className="text-muted-foreground">—</span>
                      : bills === 0 ? <span className="text-muted-foreground">free</span>
                        : money0(bills)}
                  </span>
                </div>
              )
            })}
            {(() => {
              const n = counts?.spydeck
              const bills = monthly(n, shown("addon", prices.spydeck_addon))
              return (
                <div className={ROW + " py-2.5"}>
                  <span className="text-sm font-medium">{tl("planPackages", "SpyDeck add-on")}</span>
                  <span className="text-right text-sm tabular-nums text-muted-foreground">{n == null ? "—" : n}</span>
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input
                      value={shown("addon", prices.spydeck_addon)}
                      onChange={(e) => setDraft((d) => ({ ...d, addon: e.target.value.replace(/[^\d.]/g, "") }))}
                      inputMode="decimal"
                      aria-label={tl("planPackages", "SpyDeck add-on price per month")}
                      className="h-8 w-20 px-2 text-right tabular-nums"
                    />
                  </div>
                  <span className="text-right text-sm tabular-nums">
                    {bills == null ? <span className="text-muted-foreground">—</span>
                      : bills === 0 ? <span className="text-muted-foreground">free</span>
                        : money0(bills)}
                  </span>
                </div>
              )
            })()}
            {/* The total, on the same tracks as the column it totals. This is the number the
                page is really about — every other row is a component of it. */}
            {counts && (
              <div className={ROW + " py-2.5"}>
                <span className="text-sm font-semibold">{tl("planPackages", "Every renewal, monthly")}</span>
                <span className="text-right text-sm tabular-nums text-muted-foreground">
                  {Object.values(counts.plans).reduce((a, b) => a + b, 0)}
                </span>
                <span />
                <span className="text-right text-sm font-semibold tabular-nums">
                  {money0(
                    Object.entries(prices.plans).reduce((sum, [name, v]) => sum + (monthly(counts.plans[name], shown(`plan:${name}`, v)) ?? 0), 0)
                    + (monthly(counts.spydeck, shown("addon", prices.spydeck_addon)) ?? 0)
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-3 px-5 py-4">
            {/* The one thing worth knowing before typing. A plan at 0 never renews — that is
                what makes Starter free, rather than a special case in the code. */}
            <p className="text-xs text-muted-foreground">
              {tl("planPackages", "A new price applies from the next renewal — a month already charged stays at what it was charged. A plan priced at $0 never renews. Seller counts exclude deactivated accounts, which are never renewed.")}
            </p>

            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? tl("planPackages", "Saving…") : tl("planPackages", "Save prices")}</Button>
              {saved && <span className="inline-flex items-center gap-1 text-sm text-success"><Check size={14} weight="bold" /> {tl("planPackages", "Saved")}</span>}
              {err && <span className="text-sm text-destructive">{err}</span>}
            </div>
          </div>
        </>
      )}
    </SectionCard>
  )
}

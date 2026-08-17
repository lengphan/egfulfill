"use client"

import { useEffect, useState } from "react"
import { CircleNotch, Check } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPlanPrices, savePlanPrices, type PlanPrices } from "@/lib/api"
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
export function PlanPackagesPanel() {
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
          title: "Save this price cut?",
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
    <SectionCard title="Subscription packages" description="What each plan is billed per month.">
      <div className="space-y-4 px-5 pb-5">
        {!prices ? (
          <div className="flex justify-center py-6 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-x-3 border-b border-border bg-muted/40 px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Plan</span><span className="text-right">Per month</span>
              </div>
              <div className="divide-y divide-border">
                {Object.entries(prices.plans).map(([name, v]) => (
                  <div key={name} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-x-3 px-3 py-2">
                    <span className="text-sm font-medium capitalize">{name}</span>
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
                  </div>
                ))}
                <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-x-3 px-3 py-2">
                  <span className="text-sm font-medium">SpyDeck add-on</span>
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input
                      value={shown("addon", prices.spydeck_addon)}
                      onChange={(e) => setDraft((d) => ({ ...d, addon: e.target.value.replace(/[^\d.]/g, "") }))}
                      inputMode="decimal"
                      aria-label="SpyDeck add-on price per month"
                      className="h-8 w-20 px-2 text-right tabular-nums"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* The one thing worth knowing before typing. A plan at 0 never renews — that is
                what makes Starter free, rather than a special case in the code. */}
            <p className="text-xs text-muted-foreground">
              A new price applies from the next renewal — a month already charged stays at what it was
              charged. A plan priced at $0 never renews.
            </p>

            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save prices"}</Button>
              {saved && <span className="inline-flex items-center gap-1 text-sm text-success"><Check size={14} weight="bold" /> Saved</span>}
              {err && <span className="text-sm text-destructive">{err}</span>}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}

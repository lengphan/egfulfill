"use client"

import { useEffect, useState } from "react"
import { Check, MagnifyingGlass, Sparkle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import {
  PLAN_TIERS,
  getPlan,
  planMeta,
  getSpydeckConfig,
  getSpydeckAddon,
  spydeckIncluded,
  type PlanId,
} from "@/lib/plans"

const usd = (n: number) => (n === 0 ? "Free" : `$${n}`)

// Read-only. Plans are SERVER state (users.plan) — this panel used to write
// localStorage, which meant "Upgrade to Pro" granted itself for free and the paid
// feature was one console line away. Changing a plan is now an admin action
// (Settings › Users) and the server enforces it inside /api/spydeck/*.
export function SubscriptionPanel() {
  // Session-backed; read after mount to avoid hydration mismatch.
  const [plan, setPlanState] = useState<PlanId>("starter")
  const [spydeckAddon, setAddonState] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => {
      setPlanState(getPlan())
      setAddonState(getSpydeckAddon())
      setMounted(true)
    }, 0)
    return () => clearTimeout(id)
  }, [])



  const current = planMeta(plan)
  const cfg = getSpydeckConfig()
  const includedFree = mounted && spydeckIncluded(plan)

  return (
    <div className="space-y-4">
      {/* Current plan */}
      <SectionCard title="Your plan" description="Contact us to change your plan or add research tools.">
        <div className="p-5">
          <div className="flex items-end justify-between gap-4 rounded-xl border border-border bg-muted/40 p-5">
            <div>
              <div className="text-sm text-muted-foreground">{current.name} plan · billed monthly</div>
              <div className="mt-1 text-4xl font-bold tracking-tight">
                {usd(current.monthlyPrice)}
                {current.monthlyPrice > 0 && <span className="text-base font-normal text-muted-foreground">/mo</span>}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">{current.tagline}</div>
            </div>
            <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {current.shortName}
            </span>
          </div>
        </div>
      </SectionCard>

      {/* Plan tiers */}
      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_TIERS.map((t) => {
          const isCurrent = mounted && t.id === plan
          const isUpgrade = t.monthlyPrice > current.monthlyPrice
          return (
            <div
              key={t.id}
              className={
                "flex flex-col rounded-xl border p-5 " +
                (isCurrent ? "border-primary ring-1 ring-primary/30" : "border-border")
              }
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold">{t.name}</div>
                {t.id === "pro" && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                    Popular
                  </span>
                )}
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight">
                {usd(t.monthlyPrice)}
                {t.monthlyPrice > 0 && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
              </div>
              <ul className="mt-4 flex-1 space-y-2">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check size={15} weight="bold" className="mt-0.5 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Current plan
                  </Button>
                ) : t.id === "enterprise" ? (
                  <Button variant="outline" className="w-full" disabled title="Contact us to change your plan">
                    Contact sales
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={isUpgrade ? "default" : "outline"}
                    disabled
                    title="Contact us to change your plan"
                  >
                    {isUpgrade ? `Upgrade to ${t.shortName}` : `Switch to ${t.shortName}`}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* SpyDeck add-on */}
      <SectionCard title="SpyDeck">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0 max-w-lg">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MagnifyingGlass size={16} weight="bold" />
              </span>
              <div className="font-semibold">SpyDeck research</div>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                Research
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Product-research add-on — trending listings, keyword &amp; sales estimates, and one-click add-to-store.
            </p>
          </div>
          <div className="shrink-0 text-right">
            {includedFree ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
                <Sparkle size={14} weight="fill" /> Included with {current.shortName}
              </span>
            ) : spydeckAddon ? (
              <div className="flex flex-col items-end gap-2">
                <div className="text-sm text-muted-foreground">
                  ${cfg.price}/mo · <span className="font-semibold text-emerald-600">Active</span>
                </div>
                <Button variant="outline" size="sm" disabled title="Contact us to change your add-ons">
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <div className="text-xl font-bold">
                  ${cfg.price}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </div>
                <Button size="sm" disabled title="Contact us to add SpyDeck">
                  Add SpyDeck
                </Button>
              </div>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

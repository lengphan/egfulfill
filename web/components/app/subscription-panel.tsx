"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, MagnifyingGlass, Sparkle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ApiError, getBillingPlan, subscribePlan, setAutoRenew, type BillingPlan } from "@/lib/api"
import { updateUser } from "@/lib/auth"
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
const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// Plans are SERVER state (users.plan). This panel used to WRITE localStorage, which
// meant "Upgrade to Pro" granted itself for free; then it was disabled outright. Now it
// charges for real through /api/billing/subscribe — the price is decided server-side, so
// the client can't name its own amount.
export function SubscriptionPanel() {
  // Session-backed; read after mount to avoid hydration mismatch.
  const [plan, setPlanState] = useState<PlanId>("starter")
  const [spydeckAddon, setAddonState] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [billing, setBilling] = useState<BillingPlan | null>(null)
  const [pending, setPending] = useState<{ plan?: PlanId; addon?: boolean; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [renewBusy, setRenewBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [short, setShort] = useState<{ amount: number; balance: number; shortfall: number } | null>(null)
  const router = useRouter()

  const refresh = () =>
    getBillingPlan()
      .then((b) => {
        setBilling(b)
        setPlanState((b.plan as PlanId) ?? "starter")
        setAddonState(b.spydeck_addon === true)
      })
      .catch(() => {})

  useEffect(() => {
    const id = setTimeout(() => {
      // Fall back to the session copy if the billing endpoint isn't reachable, so the
      // panel still renders the right current plan.
      setPlanState(getPlan())
      setAddonState(getSpydeckAddon())
      setMounted(true)
      refresh()
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // A downgrade is any move to a cheaper plan — that's the case where time already paid
  // for is at stake, and where "nothing is charged" is the least useful thing to say.
  const rank = (id?: string) => PLAN_TIERS.findIndex((t) => t.id === id)
  const isDowngrade = !!pending?.plan && rank(pending.plan) >= 0 && rank(pending.plan) < rank(plan)
  const currentTier = PLAN_TIERS.find((t) => t.id === plan)
  const pendingTier = PLAN_TIERS.find((t) => t.id === pending?.plan)
  // Stamped once after mount rather than read during render: Date.now() during render is
  // impure and would give a different answer on every re-render.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setNow(Date.now()), 0); return () => clearTimeout(t) }, [])
  const daysLeft = billing?.renews_at && now
    ? Math.max(0, Math.ceil((new Date(billing.renews_at).getTime() - now) / 86400000))
    : 0

  // Price the pending change the same way the server does, so the confirm dialog can
  // state the real amount before anything is charged.
  const priceOf = (target: { plan?: PlanId; addon?: boolean }) => {
    const p = billing?.prices
    if (!p) return null
    const nextPlan = target.plan ?? (plan as PlanId)
    const nextAddon = target.addon ?? spydeckAddon
    const planDelta = (p.plans[nextPlan] ?? 0) > (p.plans[plan] ?? 0) ? (p.plans[nextPlan] ?? 0) - (p.plans[plan] ?? 0) : 0
    const addonDelta = nextAddon && !spydeckAddon ? p.spydeck_addon : 0
    return planDelta + addonDelta
  }

  const toggleRenew = async (on: boolean) => {
    setRenewBusy(true)
    try { await setAutoRenew(on); await refresh() }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not change auto-renew") }
    finally { setRenewBusy(false) }
  }

  const commit = async () => {
    if (!pending) return
    setBusy(true); setErr(null); setShort(null)
    try {
      const r = await subscribePlan({ plan: pending.plan, spydeckAddon: pending.addon })
      // The paywall reads the CACHED SESSION (getPlan/getSpydeckAddon -> getUser()), not
      // the server, so without this the plan stayed locked until the next login even
      // though it was paid for. Update the session, then tell the app: "eg-plan-changed"
      // unlocks the nav + SpyDeck, "eg-wallet-changed" refreshes the header balance.
      updateUser({ plan: r.plan ?? pending.plan, spydeck_addon: r.spydeck_addon ?? pending.addon })
      window.dispatchEvent(new CustomEvent("eg-plan-changed", { detail: { plan: r.plan } }))
      window.dispatchEvent(new CustomEvent("eg-user-changed"))
      window.dispatchEvent(new CustomEvent("eg-wallet-changed"))
      setPending(null)
      await refresh()
    } catch (e) {
      // 402 = the wallet can't cover it. Not a dead end — offer the top-up.
      if (e instanceof ApiError && e.status === 402) {
        const m = /balance is \$([0-9.]+) — this costs \$([0-9.]+)/.exec(e.message)
        const balance = m ? Number(m[1]) : (billing?.balance ?? 0)
        const amount = m ? Number(m[2]) : (priceOf(pending) ?? 0)
        setShort({ amount, balance, shortfall: Number((amount - balance).toFixed(2)) })
      }
      setErr(e instanceof Error ? e.message : "Could not change your plan")
    } finally { setBusy(false) }
  }



  const current = planMeta(plan)
  const cfg = getSpydeckConfig()
  const includedFree = mounted && spydeckIncluded(plan)

  return (
    <div className="space-y-4">
      {/* Current plan */}
      <SectionCard title="Your plan" description="Plan changes are charged to your wallet balance.">
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

          {/* Renewal state + the opt-out. Only meaningful on a paid plan — Starter has
              nothing to renew. */}
          {billing?.renews_at && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {billing.auto_renew ? (
                <>
                  <span>Renews monthly on {fmtDate(billing.renews_at)}.</span>
                  <button onClick={() => toggleRenew(false)} disabled={renewBusy} className="font-medium text-foreground underline underline-offset-2 hover:no-underline disabled:opacity-50">
                    Turn off auto-renew
                  </button>
                </>
              ) : (
                <>
                  <span>Auto-renew is off — your plan ends {fmtDate(billing.renews_at)}.</span>
                  <button onClick={() => toggleRenew(true)} disabled={renewBusy} className="font-medium text-primary underline underline-offset-2 hover:no-underline disabled:opacity-50">
                    Turn it back on
                  </button>
                </>
              )}
            </div>
          )}
          {billing?.past_due_since && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
              We couldn&apos;t renew your plan — your wallet is short. Top up within {billing.grace_days} days of{" "}
              {fmtDate(billing.past_due_since)} to keep it.
            </div>
          )}
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
                  // Enterprise is negotiated, not self-serve — the server rejects it too.
                  <Button variant="outline" className="w-full" disabled title="Enterprise is set up with our team">
                    Contact sales
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={isUpgrade ? "default" : "outline"}
                    disabled={!mounted}
                    onClick={() => { setErr(null); setShort(null); setPending({ plan: t.id as PlanId, label: `${isUpgrade ? "Upgrade" : "Switch"} to ${t.shortName}` }) }}
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
                <Button variant="outline" size="sm" disabled={!mounted}
                  onClick={() => { setErr(null); setShort(null); setPending({ addon: false, label: "Remove SpyDeck" }) }}>
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <div className="text-xl font-bold">
                  ${cfg.price}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </div>
                <Button size="sm" disabled={!mounted}
                  onClick={() => { setErr(null); setShort(null); setPending({ addon: true, label: "Add SpyDeck" }) }}>
                  Add SpyDeck
                </Button>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Confirm + charge. The amount shown is computed from the SERVER's price list, so
          it matches what actually gets debited. */}
      <Dialog open={!!pending} onOpenChange={(v) => { if (busy) return; if (!v) { setPending(null); setErr(null); setShort(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pending?.label}</DialogTitle>
            <DialogDescription>
              {(priceOf(pending ?? {}) ?? 0) > 0
                ? "This charges your wallet now and bills monthly from today."
                : "This takes effect now. Nothing is charged, and the current month isn't refunded."}
            </DialogDescription>
          </DialogHeader>


          {/* Downgrading mid-cycle forfeits time already paid for. The old copy said only
              "isn't refunded", which reads as "no money back" — not "you lose the 29 days
              of Pro you already bought". Spell out the date and the days so the choice is
              made with the facts, and offer the obvious alternative: wait it out. */}
          {isDowngrade && billing?.renews_at && daysLeft > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <div className="font-medium">You&apos;ve already paid through {fmtDate(billing.renews_at)}.</div>
              <p className="mt-1">
                That&apos;s {daysLeft} day{daysLeft === 1 ? "" : "s"} of {currentTier?.shortName ?? "your current plan"}{" left."}
                Switching now ends it immediately and those days aren&apos;t refunded — to keep them, turn off
                auto-renew instead and you&apos;ll drop to {pendingTier?.shortName ?? "the new plan"} on {fmtDate(billing.renews_at)}.
              </p>
            </div>
          )}

          {billing && (priceOf(pending ?? {}) ?? 0) > 0 && (
            <dl className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Due now</dt>
                <dd className="font-semibold tabular-nums">{usd(priceOf(pending ?? {}) ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Wallet balance</dt>
                <dd className="tabular-nums">{usd(billing.balance)}</dd>
              </div>
            </dl>
          )}

          {short && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              You need {usd(short.shortfall)} more. Top up your wallet, then come back and finish.
            </div>
          )}
          {err && !short && <p className="text-sm text-destructive">{err}</p>}

          <DialogFooter>
            {short && <Button variant="outline" onClick={() => router.push("/wallet")}>Top up wallet</Button>}
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
            <Button onClick={commit} disabled={busy}>
              {busy ? "Working…" : (priceOf(pending ?? {}) ?? 0) > 0 ? `Pay ${usd(priceOf(pending ?? {}) ?? 0)}` : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

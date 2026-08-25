"use client"

import { useLabelT } from "@/lib/i18n"
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
  const tl = useLabelT()
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

 const currentTier = PLAN_TIERS.find((t) => t.id === plan)
 const pendingTier = PLAN_TIERS.find((t) => t.id === pending?.plan)
  // Stamped once after mount rather than read during render: Date.now() during render is
  // impure and would give a different answer on every re-render.
 const [now, setNow] = useState<number | null>(null)
 useEffect(() => { const t = setTimeout(() => setNow(Date.now()), 0); return () => clearTimeout(t) }, [])
 const daysLeft = billing?.renews_at && now
    ? Math.max(0, Math.ceil((new Date(billing.renews_at).getTime() - now) / 86400000))
 : 0
  // Same shape as daysLeft, and for the same reason: `now` is set in an effect rather than
  // read during render, so the countdown can't shift between renders.
 const trialDaysLeft = billing?.trial_ends_at && now
    ? Math.max(0, Math.ceil((new Date(billing.trial_ends_at).getTime() - now) / 86400000))
 : 0

  // A downgrade is a move to a CHEAPER monthly total, measured exactly as the server does
  // (billing.js), while a paid month is still running. This is the case that is now
  // SCHEDULED: nothing is charged, you keep the tier + SpyDeck you paid for until
  // renews_at, then drop to Starter. Upgrades still apply — and charge — immediately.
 const monthlyOf = (p?: string, a?: boolean) =>
    (billing?.prices.plans[p ?? plan] ?? 0) + ((a ?? spydeckAddon) ? (billing?.prices.spydeck_addon ?? 0) : 0)
 const isDowngrade =
    !!pending && daysLeft > 0 && monthlyOf(pending.plan, pending.addon) < monthlyOf(plan, spydeckAddon)
  // The paid plan you're on is set to lapse to Starter at period end (auto-renew is off).
 const downgradeScheduled =
 mounted && !!billing && billing.auto_renew === false && (currentTier?.monthlyPrice ?? 0) > 0 && !!billing.renews_at && daysLeft > 0

  // Price the pending change the same way the server does, so the confirm dialog can
  // state the real amount before anything is charged.
  // Mirrors the SERVER's rule exactly (billing.js): price against the best tier this paid
  // month already covers, not merely the tier in use. Dropping to Starter and back to Pro
  // inside one paid month is $0 the second time — that month's Pro is already bought.
 const priceOf = (target: { plan?: PlanId; addon?: boolean }) => {
 const p = billing?.prices
 if (!p) return null
 const nextPlan = target.plan ?? (plan as PlanId)
 const nextAddon = target.addon ?? spydeckAddon
 const paidPlan = billing?.paid_plan ?? plan
 const baseline = (p.plans[paidPlan] ?? 0) >= (p.plans[plan] ?? 0) ? paidPlan : plan
 const planDelta = (p.plans[nextPlan] ?? 0) > (p.plans[baseline] ?? 0) ? (p.plans[nextPlan] ?? 0) - (p.plans[baseline] ?? 0) : 0
 const addonDelta = nextAddon && !(spydeckAddon || billing?.paid_addon) ? p.spydeck_addon : 0
 return planDelta + addonDelta
  }
  // True when the target tier is already covered by the running paid month, so the change
  // costs nothing and the days already bought carry over.
 const alreadyPaidFor = (target?: PlanId) => {
 const p = billing?.prices
 if (!p || !billing?.paid_plan || !target || daysLeft <= 0) return false
 return (p.plans[target] ?? 0) <= (p.plans[billing.paid_plan] ?? 0)
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
      <SectionCard title={tl("subscription", "Your plan")}>
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

          {/* A TRIAL, which is not a subscription and must not be dressed as one.

              A trial carries auto_renew=false and a renews_at, so the renewal block below
 would otherwise render "keep <plan>" — a button that cannot do what it says,
 because the trial branch in runRenewals fires before anything can renew. It is
 shown instead of that block, not alongside it.

              The promise made here is the one the server actually keeps: at the end you are
 moved to Starter and NOTHING is charged. */}
          {billing?.on_trial && billing.trial_ends_at && (
            <div className="mt-3 rounded-lg border border-primary/30 bg-primary/[0.06] p-2.5 text-xs">
              <span className="font-semibold text-foreground">
                Free trial — {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left
              </span>
              <span className="text-muted-foreground">
                {" "}· ends {fmtDate(billing.trial_ends_at)}. You won&apos;t be charged: at the end you
 move back to Starter, and nothing you&apos;ve created is removed. Upgrade any time to
 keep these features.
              </span>
            </div>
          )}

          {/* Renewal state + the opt-out. Only meaningful on a paid plan — Starter has
 nothing to renew, and a trial is handled above. */}
          {billing?.renews_at && current.monthlyPrice > 0 && !billing?.on_trial && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {billing.auto_renew ? (
                <>
                  <span>Renews monthly on {fmtDate(billing.renews_at)}.</span>
                  <button onClick={() => toggleRenew(false)} disabled={renewBusy} className="font-medium text-foreground underline underline-offset-2 hover:no-underline disabled:opacity-50">
                    {tl("subscription", "Turn off auto-renew")}
                  </button>
                </>
              ) : (
                <>
                  <span>You keep {current.shortName} until {fmtDate(billing.renews_at)}, then move to Starter.</span>
                  <button onClick={() => toggleRenew(true)} disabled={renewBusy} className="font-medium text-primary underline underline-offset-2 hover:no-underline disabled:opacity-50">
                    Keep {current.shortName}
                  </button>
                </>
              )}
            </div>
          )}
          {billing?.past_due_since && (
            <div className="mt-2 rounded-lg border border-hold/30 bg-hold/10 p-2.5 text-xs text-hold">
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
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 eg-label text-primary">
                    {tl("subscription", "Popular")}
                  </span>
                )}
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight">
                {usd(t.monthlyPrice)}
                {t.monthlyPrice > 0 && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
              </div>
              {/* What choosing THIS plan means for the month already paid for: how many
 days are left, and whether picking it costs anything right now. */}
              {mounted && daysLeft > 0 && billing?.renews_at && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {isCurrent ? (
                    <>{daysLeft} day{daysLeft === 1 ? "" : "s"} left · {billing.auto_renew ? "renews" : "ends"} {fmtDate(billing.renews_at)}</>
                  ) : downgradeScheduled && t.id === "starter" ? (
                    <span className="font-medium text-foreground">Starts {fmtDate(billing.renews_at)}</span>
                  ) : alreadyPaidFor(t.id as PlanId) ? (
                    <span className="font-medium text-success">$0 now — paid through {fmtDate(billing.renews_at)}</span>
                  ) : (priceOf({ plan: t.id as PlanId }) ?? 0) > 0 ? (
                    <>{usd(priceOf({ plan: t.id as PlanId }) ?? 0)} now for the {daysLeft} day{daysLeft === 1 ? "" : "s"} left</>
                  ) : null}
                </div>
              )}
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
                    {tl("subscription", "Current plan")}
                  </Button>
                ) : downgradeScheduled && t.id === "starter" ? (
                  <Button variant="outline" className="w-full" disabled title={`Starts ${fmtDate(billing?.renews_at)}`}>
                    {tl("subscription", "Scheduled")}
                  </Button>
                ) : t.id === "enterprise" ? (
                  // Enterprise is negotiated, not self-serve — the server rejects it too.
                  <Button variant="outline" className="w-full" disabled title={tl("subscription", "Enterprise is set up with our team")}>
                    {tl("subscription", "Contact sales")}
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
      <SectionCard title={tl("subscription", "SpyDeck")}>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0 max-w-lg">
            <div className="flex items-center gap-2">
              <MagnifyingGlass size={18} weight="bold" className="shrink-0 text-primary" />
              <div className="font-semibold">{tl("subscription", "SpyDeck research")}</div>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 eg-label text-primary">
                {tl("subscription", "Research")}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {tl("subscription", "Product-research add-on — trending listings, keyword & sales estimates, and one-click add-to-store.")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {includedFree ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-shipped/12 px-3 py-1 text-sm font-medium text-shipped">
                <Sparkle size={14} weight="fill" /> Included with {current.shortName}
              </span>
            ) : spydeckAddon ? (
              <div className="flex flex-col items-end gap-2">
                <div className="text-sm text-muted-foreground">
                  ${cfg.price}/mo · <span className="font-semibold text-success">{tl("subscription", "Active")}</span>
                </div>
                <Button variant="outline" size="sm" disabled={!mounted}
 onClick={() => { setErr(null); setShort(null); setPending({ addon: false, label: tl("subscription", "Remove SpyDeck") }) }}>
                  {tl("subscription", "Remove")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <div className="text-xl font-bold">
                  ${cfg.price}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </div>
                <Button size="sm" disabled={!mounted}
 onClick={() => { setErr(null); setShort(null); setPending({ addon: true, label: tl("subscription", "Add SpyDeck") }) }}>
                  {tl("subscription", "Add SpyDeck")}
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
                ? tl("subscription", "This charges your wallet now and bills monthly from today.")
 : isDowngrade
                ? tl("subscription", "This is scheduled — it takes effect when your paid period ends. Nothing is charged now.")
 : tl("subscription", "This takes effect now. Nothing is charged.")}
            </DialogDescription>
          </DialogHeader>


          {/* Downgrading mid-cycle forfeits time already paid for. The old copy said only
              "isn't refunded", which reads as "no money back" — not "you lose the 29 days
 of Pro you already bought". Spell out the date and the days so the choice is
 made with the facts, and offer the obvious alternative: wait it out. */}
          {isDowngrade && billing?.renews_at && daysLeft > 0 && (
            <div className="rounded-lg border border-hold/30 bg-hold/10 p-3 text-sm text-hold">
              <div className="font-medium">You keep {currentTier?.shortName ?? tl("subscription", "your current plan")} until {fmtDate(billing.renews_at)}.</div>
              <p className="mt-1">
                Nothing is charged now. You&apos;ll keep {currentTier?.shortName ?? tl("subscription", "your plan")}
                {includedFree || spydeckAddon ? tl("subscription", " and SpyDeck") : ""} for the {daysLeft} day{daysLeft === 1 ? "" : "s"} left,
 then move to {pendingTier?.shortName ?? tl("subscription", "Starter")} on {fmtDate(billing.renews_at)}. Change your mind before
 then and it&apos;s cancelled at no charge.
              </p>
            </div>
          )}

          {/* Returning to a tier this paid month already covers — no second charge. */}
          {!isDowngrade && pending?.plan && alreadyPaidFor(pending.plan) && (priceOf(pending) ?? 0) === 0 && billing?.renews_at && (
            <div className="rounded-lg border border-shipped/30 bg-shipped/12 p-3 text-sm text-shipped">
              <div className="font-medium">{tl("subscription", "Already paid — nothing to charge.")}</div>
              <p className="mt-1">
                Your {pendingTier?.shortName ?? "plan"} month runs through {fmtDate(billing.renews_at)}
                {daysLeft > 0 ? ` — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}. Switching back now costs $0,
 and renewal continues as normal.
              </p>
            </div>
          )}

          {billing && (priceOf(pending ?? {}) ?? 0) > 0 && (
            <dl className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{tl("subscription", "Due now")}</dt>
                <dd className="font-semibold tabular-nums">{usd(priceOf(pending ?? {}) ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{tl("subscription", "Wallet balance")}</dt>
                <dd className="tabular-nums">{usd(billing.balance)}</dd>
              </div>
            </dl>
          )}

          {short && (
            <div className="rounded-lg border border-hold/30 bg-hold/10 p-3 text-sm text-hold">
              You need {usd(short.shortfall)} more. Top up your wallet, then come back and finish.
            </div>
          )}
          {err && !short && <p className="text-sm text-destructive">{err}</p>}

          <DialogFooter>
            {short && <Button variant="outline" onClick={() => router.push("/wallet")}>{tl("subscription", "Top up wallet")}</Button>}
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>{tl("subscription", "Cancel")}</Button>
            <Button onClick={commit} disabled={busy}>
              {busy ? tl("subscription", "Working…") : (priceOf(pending ?? {}) ?? 0) > 0 ? `Pay ${usd(priceOf(pending ?? {}) ?? 0)}` : tl("subscription", "Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

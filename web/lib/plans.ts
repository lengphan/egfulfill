// Subscription plans — ported verbatim from egfulfill-store.js (EGStore.PLAN_TIERS).
// Plan choice is CLIENT-STATE in the legacy app (localStorage `eg_seller_plan`), so we
// keep the SAME keys here — a seller who set a plan in the old HTML sees it in React too.
// SpyDeck is a research add-on: bundled-free on Pro/Enterprise, else a standalone $/mo line.

import { getUser } from "./auth"

export type PlanId = "starter" | "pro" | "enterprise"

export type PlanTier = {
  id: PlanId
  name: string
  shortName: string
  monthlyPrice: number
  orderLimitLabel: string
  storeLimitLabel: string
  tagline: string
  features: string[]
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "starter",
    name: "Starter",
    shortName: "Starter",
    monthlyPrice: 0,
    orderLimitLabel: "500",
    storeLimitLabel: "2 stores",
    tagline: "Discounted blank pricing · 2 stores · Basic analytics",
    features: ["Discounted blank pricing", "Up to 2 connected stores", "500 orders / month", "Basic analytics"],
  },
  {
    id: "pro",
    name: "Pro",
    shortName: "Pro",
    monthlyPrice: 29,
    orderLimitLabel: "2,000",
    storeLimitLabel: "10 stores",
    tagline: "20% off blanks · 10 stores · Advanced analytics",
    features: ["20% off all blanks", "Up to 10 connected stores", "2,000 orders / month", "Advanced analytics", "SpyDeck research included"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    shortName: "Enterprise",
    monthlyPrice: 99,
    orderLimitLabel: "Unlimited",
    storeLimitLabel: "Unlimited stores",
    tagline: "Unlimited orders · Unlimited stores · Dedicated manager",
    features: ["Best blank pricing", "Unlimited connected stores", "Unlimited orders", "Advanced analytics", "SpyDeck research included", "Dedicated account manager"],
  },
]

const SPYDECK_ADDON_KEY = "eg_spydeck_addon"
const SPYDECK_CFG_KEY = "eg_spydeck_config"
const PLAN_EVENT = "eg-plan-changed"

/**
 * The signed-in user's plan, read from the SESSION (server truth, set at login).
 *
 * This used to read localStorage `eg_seller_plan`, which the client also WROTE — so
 * "Upgrade to Pro" granted itself for free and a console one-liner unlocked
 * Enterprise. The plan now lives on users.plan, and the server enforces entitlement
 * inside /api/spydeck/* and /api/etsy/search. Anything here is presentation only:
 * faking it locally changes what you see, never what you can actually call.
 */
export function getPlan(): PlanId {
  const p = getUser()?.plan
  return p === "pro" || p === "enterprise" ? p : "starter"
}

export function planMeta(id: PlanId): PlanTier {
  return PLAN_TIERS.find((t) => t.id === id) ?? PLAN_TIERS[0]
}

// SpyDeck: bundled-free on Pro/Enterprise; on Starter it's a standalone add-on the seller can buy.
export function getSpydeckConfig(): { bundled: boolean; price: number } {
  if (typeof localStorage !== "undefined") {
    try {
      const c = JSON.parse(localStorage.getItem(SPYDECK_CFG_KEY) || "null")
      if (c && typeof c === "object") return { bundled: c.bundled !== false, price: c.price != null ? Number(c.price) : 9 }
    } catch {}
  }
  return { bundled: true, price: 9 }
}

export function spydeckIncluded(plan: PlanId = getPlan()): boolean {
  const cfg = getSpydeckConfig()
  return cfg.bundled && (plan === "pro" || plan === "enterprise")
}

/** Server truth (users.spydeck_addon), same reasoning as getPlan. */
export function getSpydeckAddon(): boolean {
  return getUser()?.spydeck_addon === true
}

export function setSpydeckAddon(on: boolean) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(SPYDECK_ADDON_KEY, on ? "1" : "0")
  window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: { plan: getPlan() } }))
}

// True if SpyDeck is available. STAFF (admin/warehouse/etc.) always have it — the plan
// paywall is a SELLER concern only, matching entitlements.js on the server (which grants
// any non-seller role unconditionally). A seller needs the bundle or the add-on.
/** Presentation gate only — the server is what actually enforces this. */
export function hasSpydeck(): boolean {
  const role = getUser()?.role
  if (role && role !== "seller") return true
  return spydeckIncluded() || getSpydeckAddon()
}

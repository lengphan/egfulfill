"use client"

import { useEffect, useState } from "react"
import { getBillingPlan } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { hasSpydeck } from "@/lib/plans"

/**
 * One place that answers "does this account have the paid feature?".
 *
 * `lib/plans.ts` answers from the CACHED SESSION in localStorage, which only knows what
 * THIS account bought. A team member never buys anything — their own row is permanently
 * 'starter' — so every cached gate locked out teammates whose leader had paid, on every
 * surface that asked: the SpyDeck page, the sidebar lock, and anything added later.
 *
 * The server resolves the leader's plan through the team (resolveEntitlements), so it is
 * the only correct source. This wraps it with:
 *   • the cached answer FIRST, so there is no flash of a lock for someone who plainly has it
 *   • ONE in-flight request shared by every caller, not one per gated component
 *   • a refresh hook, so a plan change updates every gate at once
 */
export type Entitlements = { plan: string; spydeckAddon: boolean; spydeck: boolean; inheritedFrom: string | null }

const EVENT = "eg-entitlements-changed"

let cache: Entitlements | null = null
let inflight: Promise<Entitlements> | null = null

/** What the cached session believes, used until the server answers. */
function fromSession(): Entitlements {
  return { plan: "starter", spydeckAddon: false, spydeck: hasSpydeck(), inheritedFrom: null }
}

export function loadEntitlements(force = false): Promise<Entitlements> {
  if (!force && cache) return Promise.resolve(cache)
  if (!force && inflight) return inflight
  if (!getToken()) return Promise.resolve(fromSession())

  inflight = getBillingPlan()
    .then((b) => {
      const included = b.plan === "pro" || b.plan === "enterprise"
      const next: Entitlements = {
        plan: b.plan || "starter",
        spydeckAddon: b.spydeck_addon === true,
        // Staff always have it; hasSpydeck() already encodes that rule.
        spydeck: b.spydeck_addon === true || included || hasSpydeck(),
        inheritedFrom: b.inherited_from ?? null,
      }
      cache = next
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT))
      return next
    })
    .catch(() => cache ?? fromSession())   // a failed request must never LOSE access
    .finally(() => { inflight = null })

  return inflight
}

/** Call after a plan change so every gate re-reads at once. */
export function refreshEntitlements() {
  cache = null
  return loadEntitlements(true)
}

/**
 * Gate hook. Starts from the cached session (instant, no flash), then corrects from the
 * server. Deliberately optimistic on failure: locking someone out because a request
 * failed is worse than briefly showing a feature they'll be refused server-side anyway —
 * and the server gate is the one that actually enforces.
 */
export function useEntitlements(): Entitlements {
  const [ent, setEnt] = useState<Entitlements>(() => cache ?? { plan: "starter", spydeckAddon: false, spydeck: true, inheritedFrom: null })

  useEffect(() => {
    let alive = true
    // EVENT is dispatched by loadEntitlements itself after a fetch, so this path must NOT
    // force — it just reads the freshly-populated cache. Forcing here would loop.
    const sync = () => {
      if (!alive) return
      setEnt(cache ?? fromSession())
      loadEntitlements().then((e) => { if (alive) setEnt(e) })
    }
    // A plan change makes the cached entitlement STALE: a downgrade lapse must lock the
    // gate, an upgrade must unlock it. loadEntitlements() short-circuits to the stale cache
    // when one exists, so force a fresh read via refreshEntitlements. This was the missing
    // wiring — refreshEntitlements existed but nothing called it, so gates kept the old
    // answer (SpyDeck looked unlocked after a downgrade) until the next full reload.
    const invalidate = () => {
      if (!alive) return
      setEnt(cache ?? fromSession())
      refreshEntitlements().then((e) => { if (alive) setEnt(e) })
    }
    const id = setTimeout(sync, 0)
    window.addEventListener(EVENT, sync)
    window.addEventListener("eg-plan-changed", invalidate)
    return () => {
      alive = false
      clearTimeout(id)
      window.removeEventListener(EVENT, sync)
      window.removeEventListener("eg-plan-changed", invalidate)
    }
  }, [])

  return ent
}

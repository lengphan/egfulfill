"use client"

import { useEffect, useState } from "react"
import { Storefront, ShoppingCart } from "@phosphor-icons/react"
import { SuppliersView } from "@/components/app/suppliers-view"
import { PurchaseView } from "@/components/app/purchase-view"

type Tab = "browse" | "purchase"

/**
 * Purchasing — the one home for buying blanks. Suppliers (browse) and Purchase (cart +
 * on-order + history) used to be two nav items with purchase history showing in both;
 * this folds them into a single section with two tabs.
 *
 * Deliberately a thin wrapper: each tab renders its ORIGINAL view unchanged, so none of
 * the tested ordering / catalogue logic moves. The initial tab comes from ?tab= (the
 * top-bar cart button and the old-route redirects both deep-link here), and switching
 * tabs updates the URL in place so a refresh or a back-button keeps the tab.
 */
export function PurchasingView() {
  const [tab, setTab] = useState<Tab>("purchase")

  useEffect(() => {
    const id = setTimeout(() => {
      const p = new URLSearchParams(window.location.search).get("tab")
      if (p === "browse" || p === "purchase") setTab(p)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const pick = (v: Tab) => {
    setTab(v)
    try {
      const u = new URL(window.location.href)
      u.searchParams.set("tab", v)
      window.history.replaceState(null, "", u)
    } catch { /* URL not writable — the tab still switches */ }
  }

  return (
    <div className="space-y-4">
      {/* rounded-full to match the pill toggles used across the boards (suppliers-view). */}
      <div className="flex w-fit rounded-full border border-border p-0.5">
        {([{ id: "browse", label: "Browse", icon: Storefront }, { id: "purchase", label: "Cart & orders", icon: ShoppingCart }] as const).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              className={"eg-tap inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Icon size={15} weight={tab === t.id ? "fill" : "regular"} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === "browse" ? <SuppliersView /> : <PurchaseView />}
    </div>
  )
}

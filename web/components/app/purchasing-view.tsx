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
      {/* One mobile section hero for the whole page (the top bar is desktop-only); the
          inner views hide their own hero via `embedded`. */}
      <div className="flex items-center gap-3 md:hidden">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShoppingCart size={18} weight="fill" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Purchasing</h1>
          <p className="truncate text-sm text-muted-foreground">Browse suppliers, build a cart, and track orders.</p>
        </div>
      </div>
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

      {tab === "browse" ? <SuppliersView embedded /> : <PurchaseView embedded />}
    </div>
  )
}

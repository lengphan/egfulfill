"use client"

import { useEffect, useState } from "react"
import { ShoppingCart } from "@phosphor-icons/react"
import { AllSuppliers } from "@/components/app/all-suppliers"
import { FavoritesView } from "@/components/app/favorites-view"
import { PurchaseView } from "@/components/app/purchase-view"
import { AlibabaOrders } from "@/components/app/alibaba-orders"

type Tab = "all" | "favorites" | "purchase" | "alibaba"

/**
 * Purchasing — the one home for buying blanks. Flattened to a SINGLE tab row —
 * All suppliers · Favorites · Cart & orders — instead of a Browse/Cart toggle stacked over
 * a suppliers' All/Favorites toggle. The browse catalogue views and the cart/orders view
 * are peers; their tested logic is untouched, just reparented. `browse` is a legacy ?tab=
 * alias for `all`; switching updates the URL in place.
 */
export function PurchasingView() {
  const [tab, setTab] = useState<Tab>("purchase")

  useEffect(() => {
    const id = setTimeout(() => {
      const p = new URLSearchParams(window.location.search).get("tab")
      if (p === "all" || p === "favorites" || p === "purchase" || p === "alibaba") setTab(p)
      else if (p === "browse") setTab("all")   // legacy alias
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
          <h1 className="font-title text-2xl font-semibold tracking-tight">Purchasing</h1>
          <p className="truncate text-sm text-muted-foreground">Browse suppliers, build a cart, and track orders.</p>
        </div>
      </div>
      <div className="flex w-fit rounded-full border border-border p-0.5">
        {/* Alibaba sits beside Orders rather than inside it: those are OUR purchase orders
            to S&S/Otto/SanMar, placed from here and received into stock, while Alibaba's
            are placed and paid on their site and only ever read back. Same page, different
            things — folding them together would put rows with no Receive action into a
            table whose whole point is receiving. */}
        {([{ id: "all", label: "All suppliers" }, { id: "favorites", label: "Favorites" }, { id: "purchase", label: "Orders" }, { id: "alibaba", label: "Sample" }] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            className={"eg-tap rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "all" ? <AllSuppliers />
        : tab === "favorites" ? <FavoritesView />
        : tab === "alibaba" ? <AlibabaOrders />
        : <PurchaseView embedded />}
    </div>
  )
}

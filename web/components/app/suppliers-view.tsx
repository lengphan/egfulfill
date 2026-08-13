"use client"

import { useState } from "react"
import { Package } from "@phosphor-icons/react"
import { AllSuppliers } from "@/components/app/all-suppliers"
import { FavoritesView } from "@/components/app/favorites-view"
import { PageTitle } from "@/components/app/page-title"
import { TabLabel } from "@/components/app/tab-label"

// Suppliers page — one combined browse across S&S + Otto, plus saved favorites.
// `embedded` hides the mobile hero when this sits inside the Purchasing tab shell, which
// provides one section hero for the whole page (the top bar is desktop-only).
export function SuppliersView({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<"all" | "favorites">("all")
  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex items-center gap-3 md:hidden">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
          <div className="min-w-0">
            <PageTitle>Suppliers</PageTitle>
            <p className="truncate text-sm text-muted-foreground">Browse S&amp;S and Otto blanks in one feed and add them to your catalog.</p>
          </div>
        </div>
      )}

      {/* rounded-full, not rounded-lg — the active tab inside is a pill, so a
          rectangular border around it left visible corner gaps. */}
      <div className="flex w-fit rounded-full border border-border p-0.5">
        {([{ id: "all", label: "All suppliers" }, { id: "favorites", label: "Favorites" }] as const).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={"eg-tap rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}><TabLabel>{t.label}</TabLabel></button>
        ))}
      </div>

      {tab === "favorites" ? <FavoritesView /> : <AllSuppliers />}
    </div>
  )
}

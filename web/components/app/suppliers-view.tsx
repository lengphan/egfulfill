"use client"

import { useState } from "react"
import { Package } from "@phosphor-icons/react"
import { AllSuppliers } from "@/components/app/all-suppliers"
import { FavoritesView } from "@/components/app/favorites-view"

// Suppliers page — one combined browse across S&S + Otto, plus saved favorites.
export function SuppliersView() {
  const [tab, setTab] = useState<"all" | "favorites">("all")
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Suppliers</h1>
          <p className="truncate text-sm text-muted-foreground">Browse S&amp;S and Otto blanks in one feed and add them to your catalog.</p>
        </div>
      </div>

      <div className="flex w-fit rounded-lg border border-border p-0.5">
        {([{ id: "all", label: "All suppliers" }, { id: "favorites", label: "Favorites" }] as const).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={"rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{t.label}</button>
        ))}
      </div>

      {tab === "favorites" ? <FavoritesView /> : <AllSuppliers />}
    </div>
  )
}

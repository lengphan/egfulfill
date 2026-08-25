"use client"

import { useLabelT } from "@/lib/i18n"
import { useState } from "react"
import { Package } from "@phosphor-icons/react"
import { AllSuppliers } from "@/components/app/all-suppliers"
import { FavoritesView } from "@/components/app/favorites-view"
import { PageTitle } from "@/components/app/page-title"
import { TabBar } from "@/components/app/tab-bar"

// Suppliers page — one combined browse across S&S + Otto, plus saved favorites.
// `embedded` hides the mobile hero when this sits inside the Purchasing tab shell, which
// provides one section hero for the whole page (the top bar is desktop-only).
export function SuppliersView({ embedded = false }: { embedded?: boolean }) {
  const tl = useLabelT()
  const [tab, setTab] = useState<"all" | "favorites">("all")
  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex items-center gap-3 md:hidden">
          <Package size={18} weight="regular"  className="shrink-0 text-primary" />
          <div className="min-w-0">
            <PageTitle>{tl("suppliers", "Suppliers")}</PageTitle>
            <p className="truncate text-sm text-muted-foreground">{tl("suppliers", "Browse S&S and Otto blanks in one feed and add them to Products.")}</p>
          </div>
        </div>
      )}

      <TabBar
        ariaLabel="Supplier list"
        items={[{ id: "all", label: tl("suppliers", "All suppliers") }, { id: "favorites", label: tl("suppliers", "Favorites") }]}
        value={tab}
        onChange={setTab}
      />

      {tab === "favorites" ? <FavoritesView /> : <AllSuppliers />}
    </div>
  )
}

"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { Package } from "@phosphor-icons/react"
import { InventoryView } from "@/components/app/inventory-view"
import { ScanStation } from "@/components/app/scan-station"
import { PageTitle } from "@/components/app/page-title"
import { TabBar } from "@/components/app/tab-bar"

// One flat row instead of Stock/Scan stacked over Our-stock/Seller-stock: the two stock
// pools and the scan station are siblings here. `stock` is kept as a legacy ?tab= alias.
type Tab = "own" | "consigned" | "scan"

/**
 * Inventory — Stock (levels on hand) and Scan (the stock in/out station) under one roof.
 * Two views of the same stock: Stock is the state, Scan is the action that changes it.
 *
 * Thin wrapper: each tab renders its ORIGINAL view unchanged, so the scan station's own
 * warehouse-write / operator-read gating is untouched. Initial tab from ?tab= (the /scan
 * redirect and the PWA start_url both deep-link to the Scan tab).
 */
export function InventorySection() {
  const tl = useLabelT()
  const [tab, setTab] = useState<Tab>("own")

  useEffect(() => {
    const id = setTimeout(() => {
      const p = new URLSearchParams(window.location.search).get("tab")
      if (p === "own" || p === "consigned" || p === "scan") setTab(p)
      else if (p === "stock") setTab("own")   // legacy alias
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
        <Package size={18} weight="regular"  className="shrink-0 text-primary" />
        <div className="min-w-0">
          <PageTitle>{tl("inventory", "Inventory")}</PageTitle>
          <p className="truncate text-sm text-muted-foreground">{tl("inventory", "Stock levels on hand and the scan station.")}</p>
        </div>
      </div>
      <TabBar
        ariaLabel="Inventory views"
        items={[{ id: "own", label: tl("inventory", "Our stock") }, { id: "consigned", label: tl("inventory", "Incoming stock") }, { id: "scan", label: tl("inventory", "Scan") }]}
        value={tab}
        onChange={pick}
      />

      {tab === "scan" ? <ScanStation embedded /> : <InventoryView embedded pool={tab} />}
    </div>
  )
}

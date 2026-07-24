"use client"

import { useEffect, useState } from "react"
import { Stack, Barcode, Package } from "@phosphor-icons/react"
import { InventoryView } from "@/components/app/inventory-view"
import { ScanStation } from "@/components/app/scan-station"

type Tab = "stock" | "scan"

/**
 * Inventory — Stock (levels on hand) and Scan (the stock in/out station) under one roof.
 * Two views of the same stock: Stock is the state, Scan is the action that changes it.
 *
 * Thin wrapper: each tab renders its ORIGINAL view unchanged, so the scan station's own
 * warehouse-write / operator-read gating is untouched. Initial tab from ?tab= (the /scan
 * redirect and the PWA start_url both deep-link to the Scan tab).
 */
export function InventorySection() {
  const [tab, setTab] = useState<Tab>("stock")

  useEffect(() => {
    const id = setTimeout(() => {
      const p = new URLSearchParams(window.location.search).get("tab")
      if (p === "stock" || p === "scan") setTab(p)
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
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="truncate text-sm text-muted-foreground">Stock levels on hand and the scan station.</p>
        </div>
      </div>
      <div className="flex w-fit rounded-full border border-border p-0.5">
        {([{ id: "stock", label: "Stock", icon: Stack }, { id: "scan", label: "Scan", icon: Barcode }] as const).map((t) => {
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

      {tab === "stock" ? <InventoryView embedded /> : <ScanStation embedded />}
    </div>
  )
}

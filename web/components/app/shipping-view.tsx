"use client"

import { useEffect, useState } from "react"
import { Truck } from "@phosphor-icons/react"
import { DispatchBoard } from "@/components/app/dispatch-board"
import { ShipmentsView } from "@/components/app/shipments-view"
import { RateCalculatorView } from "@/components/app/rate-calculator-view"
import { PageTitle } from "@/components/app/page-title"
import { TabLabel } from "@/components/app/tab-label"

type Tab = "dispatch" | "shipments" | "rates"

/**
 * Shipping — Dispatch (today's out-queue) and Shipments (the parcel archive) under one
 * roof. They stay DISTINCT tabs, not one merged list: Dispatch is a short queue the floor
 * empties by evening, Shipments is an ever-growing reference nobody works through — mixing
 * them into a single list buries the queue, which is exactly why they were split.
 *
 * Thin wrapper: each tab renders its ORIGINAL view unchanged. Initial tab from ?tab=
 * (old-route redirects deep-link here); switching updates the URL in place.
 */
export function ShippingView() {
  const [tab, setTab] = useState<Tab>("dispatch")

  useEffect(() => {
    const id = setTimeout(() => {
      const p = new URLSearchParams(window.location.search).get("tab")
      if (p === "dispatch" || p === "shipments" || p === "rates") setTab(p)
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
      {/* One mobile section hero for the whole page (the top bar is desktop-only). */}
      <div className="flex items-center gap-3 md:hidden">
        <Truck size={18} weight="regular"  className="shrink-0 text-primary" />
        <div className="min-w-0">
          <PageTitle>Shipping</PageTitle>
          <p className="truncate text-sm text-muted-foreground">Today&apos;s dispatch queue, the shipment archive, and what a parcel costs.</p>
        </div>
      </div>
      <div className="flex w-fit rounded-full border border-border p-0.5">
        {/* Rates is a THIRD tab rather than a dialog: pricing a parcel is work you do
            repeatedly while quoting, and the sweeps below fill a page rather than a popup. */}
        {([{ id: "dispatch", label: "Dispatch" }, { id: "shipments", label: "Shipments" }, { id: "rates", label: "Rates" }] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            className={"eg-tap rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <TabLabel>{t.label}</TabLabel>
          </button>
        ))}
      </div>

      {tab === "dispatch" ? <DispatchBoard /> : tab === "shipments" ? <ShipmentsView /> : <RateCalculatorView />}
    </div>
  )
}

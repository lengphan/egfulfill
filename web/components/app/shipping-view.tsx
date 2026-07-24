"use client"

import { useEffect, useState } from "react"
import { Truck, Package } from "@phosphor-icons/react"
import { DispatchBoard } from "@/components/app/dispatch-board"
import { ShipmentsView } from "@/components/app/shipments-view"

type Tab = "dispatch" | "shipments"

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
      if (p === "dispatch" || p === "shipments") setTab(p)
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
      <div className="flex w-fit rounded-full border border-border p-0.5">
        {([{ id: "dispatch", label: "Dispatch", icon: Truck }, { id: "shipments", label: "Shipments", icon: Package }] as const).map((t) => {
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

      {tab === "dispatch" ? <DispatchBoard /> : <ShipmentsView />}
    </div>
  )
}

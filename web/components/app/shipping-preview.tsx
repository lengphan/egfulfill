"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { Truck } from "@phosphor-icons/react"
import { DispatchBoard } from "@/components/app/dispatch-board"
import { ShipmentsView } from "@/components/app/shipments-view"
import { RateCalculatorView } from "@/components/app/rate-calculator-view"
import { ConsoleShell } from "@/components/app/console-shell"
import { TabBar } from "@/components/app/tab-bar"

type Tab = "dispatch" | "shipments" | "rates"

/**
 * PREVIEW of the console shell, at /shipping/preview. Nothing here replaces /shipping —
 * the route exists so the two shapes can be compared on the real app, with the real
 * components and the real data path, before anything is changed.
 *
 * The only difference is the SHELL. Dispatch, Shipments and Rates are the same three
 * components doing the same work; their StatGrid simply lands in the header.
 */
export function ShippingPreview() {
  const tl = useLabelT()
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
    <ConsoleShell
      title="Shipping"
      icon={Truck}
      tabs={
        <TabBar
          ariaLabel="Shipping views"
          items={[
            { id: "dispatch", label: tl("shipping", "Dispatch") },
            { id: "shipments", label: tl("shipping", "Shipments") },
            { id: "rates", label: tl("shipping", "Rates") },
          ]}
          value={tab}
          onChange={pick}
        />
      }
    >
      {tab === "dispatch" ? <DispatchBoard segmented /> : tab === "shipments" ? <ShipmentsView /> : <RateCalculatorView />}
    </ConsoleShell>
  )
}

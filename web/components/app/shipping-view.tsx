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
 * Shipping — Dispatch (today's out-queue) and Shipments (the parcel archive) under one
 * roof. They stay DISTINCT tabs, not one merged list: Dispatch is a short queue the floor
 * empties by evening, Shipments is an ever-growing reference nobody works through — mixing
 * them into a single list buries the queue, which is exactly why they were split.
 *
 * Thin wrapper: each tab renders its ORIGINAL view unchanged. Initial tab from ?tab=
 * (old-route redirects deep-link here); switching updates the URL in place.
 *
 * ── ON THE CONSOLE SHELL ─────────────────────────────────────────────────────────────
 *
 * Adopted from shipping-preview.tsx, which had been built and then left switched off — the
 * last of nine boards in that state. Reported as "still feels very cluttered", and it was:
 * Dispatch stacked FOUR full-width bands before a single row of data —
 *
 *   1. a paragraph explaining what an External row is,
 *   2. Print · Add label PDF · More · Scanned here · Finish All, on bare canvas,
 *   3. the search + filter row,
 *   4. the table header.
 *
 * Two of those were already written to go away, and both were waiting on this shell.
 * DispatchBoard wraps its action row in ActionsPortal, so outside a shell it renders in
 * place (band 2), and the paragraph is gated `!inShell` because its content had already
 * been moved onto the External chip's own title, to be asked for rather than served
 * (band 1). Neither needed new code — they needed a page band to exist.
 *
 * The shell also OWNS the mobile hero, so the local `md:hidden` title block is gone with
 * its subtitle. topbar.tsx already names the page on desktop, so that block was a second
 * <h1>, and §4 has no room for a sentence under a title that is about to be a tab bar.
 *
 * page.tsx stays a SERVER component here, unlike the other eight: the icon is passed from
 * inside this client component rather than from the route, so nothing has to cross the
 * boundary and the route keeps its `metadata` export.
 */
export function ShippingView() {
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
      /* Rates is a THIRD tab rather than a dialog: pricing a parcel is work you do
         repeatedly while quoting, and the sweeps below fill a page rather than a popup. */
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

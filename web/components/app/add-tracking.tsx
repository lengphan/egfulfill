"use client"

import { useState } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateOrder } from "@/lib/api"

/** The carriers trackUrl knows how to build a link for. "Other" keeps a carrier we cannot
 *  link — the number is still worth recording, and a select that refuses the real answer is
 *  worse than one that admits it. */
const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"]

/**
 * ADD A TRACKING NUMBER BY HAND.
 *
 * A parcel does not always leave through a label bought here — a seller ships one themselves,
 * a partner sends a number by email, a carrier is used that we have no integration with. In
 * every one of those the number existed and the order had nowhere to put it, so it lived in a
 * message thread and the buyer was told by hand.
 *
 * A SELLER MAY DO THIS on their own order: the PATCH allows tracking and carrier for the
 * order's owner (staff-only fields are guarded separately, server-side). So this is offered
 * to whoever is looking at the order, and the server decides whether they own it.
 *
 * Shown only while there is no tracking. Replacing one is a different act — it says the first
 * number was wrong, and the buyer may already have it — so it stays in the ⋯ menu with the
 * other corrections rather than sitting open on the card.
 */
export function AddTracking({ orderId, onSaved }: { orderId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [carrier, setCarrier] = useState("USPS")
  const [num, setNum] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    const t = num.trim()
    if (!t) { setErr("Paste the tracking number."); return }
    setBusy(true); setErr(null)
    try {
      const r = await updateOrder(orderId, { tracking: t, carrier })
      if ((r as { error?: string })?.error) throw new Error((r as { error?: string }).error as string)
      setOpen(false); setNum("")
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that tracking number.")
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        Add tracking
      </button>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          aria-label="Carrier"
          className="eg-select eg-control pr-8"
        >
          {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Input
          value={num}
          onChange={(e) => { setNum(e.target.value); setErr(null) }}
          onKeyDown={(e) => { if (e.key === "Enter") void save() }}
          placeholder="Tracking number"
          aria-label="Tracking number"
          className="h-8 min-w-[12rem] flex-1 font-mono text-xs"
          autoFocus
        />
        <Button onClick={() => void save()} disabled={busy || !num.trim()}>
          {busy ? <CircleNotch size={13} className="animate-spin" /> : "Save"}
        </Button>
        <Button variant="ghost" onClick={() => { setOpen(false); setErr(null) }} disabled={busy}>Cancel</Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {/* SAID BEFORE IT HAPPENS, not discovered afterwards. Recording tracking is what this
          system treats as the parcel having left — it notifies, and where a marketplace is
          connected it pushes the fulfilment. Somebody typing a number to keep a note wants
          to know that first. */}
      <p className="text-2xs text-muted-foreground">
        Recording tracking marks the parcel as on its way, and tells the store it was sold on.
      </p>
    </div>
  )
}

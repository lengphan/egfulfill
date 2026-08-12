"use client"

import { ArrowSquareOut, ArrowClockwise, CircleNotch, X, Package } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ShipmentRow } from "@/lib/api"

/**
 * ONE PARCEL, IN FULL — so the table doesn't have to be.
 *
 * The list was carrying eight columns and three buttons because every fact had to be
 * visible at once, and the result fitted no screen: the last action fell off the right edge
 * and the two status columns were squeezed into a width that made them unreadable. But
 * almost none of it is scanned. Someone reads down Order, Customer, Tracking and Delivery —
 * and then stops on ONE row and wants everything about it.
 *
 * So the table keeps what you scan and this holds what you stop for. The actions live here
 * too: they act on a single parcel, which is exactly what this window is.
 */

const when = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null

const DELIVERY_WORD: Record<string, string> = {
  awaiting_pickup: "Not collected by the carrier yet",
  in_transit: "In transit",
  delivered: "Delivered",
  returned: "Coming back to us",
  failed: "The carrier could not deliver it",
}

const VIA_WORD: Record<string, string> = {
  "in-house": "Scanned here",
  partner: "Scanned by byeastside",
  carrier: "Accepted by the carrier",
}

/** One labelled fact. `mono` for numbers you might read aloud down a phone. */
function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={"min-w-0 text-right text-sm " + (mono ? "tabular-nums" : "")}>{children}</span>
    </div>
  )
}

export function ShipmentDetailDialog({
  shipment, onOpenChange, onRecheck, onRefund, checking, voiding, canRefund,
}: {
  shipment: ShipmentRow | null
  onOpenChange: (o: boolean) => void
  onRecheck: (id: string) => void
  onRefund: (s: ShipmentRow) => void
  checking: string | null
  voiding: string | null
  canRefund: boolean
}) {
  const s = shipment
  if (!s) return null
  const refunded = (s.refunded ?? 0) > 0
  const refundWord = String(s.refundStatus || "").toUpperCase()

  return (
    <Dialog open={!!s} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package size={16} weight="fill" className="text-muted-foreground" />
            <span className="truncate">{s.num}</span>
            {s.test && (
              <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-2xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">TEST</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* A test label is the first thing to say, because every number below it is real
              in shape and unreal in consequence — real tracking, real-looking price, never
              charged. Reading the price without knowing that is the trap. */}
          {s.test && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Bought on a test key: the tracking number and price are real in shape but nothing was
              ever charged, and the parcel will never move.
            </p>
          )}

          <div>
            <Row label="Customer">{s.customer || "—"}</Row>
            <Row label="Ships to">{s.state || "—"}</Row>
            <Row label="Tracking" mono>
              {s.tracking ? s.tracking
                : s.voidedTracking
                  ? <span className="text-muted-foreground line-through decoration-destructive/70">{s.voidedTracking}</span>
                  : "—"}
            </Row>
            <Row label="Carrier">{s.carrier || "—"}</Row>
            <Row label="Service">{s.method || "—"}</Row>
            <Row label="Postage" mono>
              {s.price != null
                ? <span className={refunded ? "text-muted-foreground line-through decoration-destructive/70" : ""}>${s.price.toFixed(2)}</span>
                : "—"}
            </Row>
            {refunded && (
              // The provider's own word, in full, because this is the screen where someone
              // is deciding whether to chase it — and "pending" for two weeks is normal,
              // while "error" means the parcel actually shipped.
              <Row label="Refund">
                <span className="font-medium">${(s.refunded ?? 0).toFixed(2)}</span>
                <span className="text-muted-foreground">
                  {refundWord === "SUCCESS" ? " · settled"
                    : refundWord === "ERROR" ? " · REFUSED, the label was used"
                      : " · pending with the carrier"}
                </span>
              </Row>
            )}
          </div>

          <div>
            <Row label="Carrier says">
              {s.delivery ? (DELIVERY_WORD[s.delivery] ?? s.delivery) : <span className="text-muted-foreground">Not checked yet</span>}
            </Row>
            {s.deliveryDetail && <Row label="Detail">{s.deliveryDetail}</Row>}
            <Row label="Last checked">{when(s.deliveryCheckedAt) ?? <span className="text-muted-foreground">never</span>}</Row>
            <Row label="Pre-scan">
              {s.scannedAt
                ? <>{VIA_WORD[s.scannedVia ?? ""] ?? "Scanned"} · {when(s.scannedAt)}</>
                : <span className="text-muted-foreground">not scanned</span>}
            </Row>
            <Row label="Created">{when(s.createdAt) ?? "—"}</Row>
          </div>

          <div className="flex flex-nowrap items-center gap-2 border-t border-border pt-3">
            <Button size="sm" variant="outline" onClick={() => onRecheck(s.id)} disabled={checking === s.id || !s.tracking}>
              {checking === s.id ? <CircleNotch size={13} className="animate-spin" /> : <ArrowClockwise size={13} weight="bold" />}
              Check
            </Button>
            {s.labelUrl && (
              <Button size="sm" variant="outline" onClick={() => window.open(s.labelUrl as string, "_blank", "noopener")}>
                <ArrowSquareOut size={13} weight="bold" /> Label
              </Button>
            )}
            {/* Only while it can still work: a second refund can only ever collect the
                carrier's refusal, and a label with no stored PDF has no reference to refund
                against. */}
            {canRefund && s.labelUrl && !refunded && (
              <Button size="sm" variant="outline" onClick={() => onRefund(s)} disabled={voiding === s.id}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                {voiding === s.id ? <CircleNotch size={13} className="animate-spin" /> : <X size={13} weight="bold" />}
                Refund
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

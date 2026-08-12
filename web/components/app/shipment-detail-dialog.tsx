"use client"

import { ArrowSquareOut, ArrowClockwise, CircleNotch, X, Package, DownloadSimple, FilePdf } from "@phosphor-icons/react"
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
      {/* `text-balance` rather than a hard truncate: a value that must wrap (a two-word
          service name, a carrier sentence) breaks evenly instead of leaving one word alone
          on the last line, and nothing is ever hidden. */}
      <span className={"min-w-0 text-right text-sm text-balance " + (mono ? "tabular-nums" : "")}>{children}</span>
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
      {/* `sm:` — the base sets sm:max-w-md, and a bare max-w-* is a DIFFERENT variant rather
          than a conflicting one, so both survive tailwind-merge and the breakpoint one wins
          above 640px. This dialog carries a label beside its facts and needs the room. */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package size={16} weight="fill" className="text-muted-foreground" />
            <span className="truncate">{s.num}</span>
            {s.test && (
              <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-2xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">TEST</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* THE LABEL BESIDE THE FACTS.
            It was a button that opened another tab — which is a whole context switch to
            answer "is this the right parcel", the question you opened this window with. The
            page it opened is also the carrier's, so there was nothing to do there but look.
            Served through our own API (/api/shipments/:id/label) rather than the carrier's
            url: a cross-origin PDF can be refused an iframe outright, and `download` is
            ignored across origins — the browser navigates instead, which is the tab this
            replaces. Same-origin, both work. */}
        <div className="grid gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          {s.labelUrl ? (
            <div className="flex flex-col gap-2">
              <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
                {/* #toolbar=0 asks the built-in viewer for the page and not its chrome —
                    honoured by Chrome and Edge, ignored elsewhere, harmless either way. */}
                <iframe
                  src={`/api/shipments/${encodeURIComponent(s.id)}/label#toolbar=0&navpanes=0&view=FitH`}
                  title={`Shipping label for ${s.num}`}
                  className="h-[22rem] w-full bg-white"
                />
              </div>
              <div className="flex gap-1.5">
                <a
                  href={`/api/shipments/${encodeURIComponent(s.id)}/label?download=1`}
                  download
                  className="eg-tap inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <DownloadSimple size={13} weight="bold" /> Download
                </a>
                {/* The carrier's own copy still has a use — printing from their viewer, or
                    checking ours against theirs — so the old route stays, demoted. */}
                <a
                  href={s.labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the carrier's own copy in a new tab"
                  aria-label="Open the carrier's own copy in a new tab"
                  className="eg-tap inline-flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <ArrowSquareOut size={13} weight="bold" />
                </a>
              </div>
            </div>
          ) : (
            // Says WHICH: no label was ever bought, or it was refunded and the file with it.
            // A blank panel here reads as a load that failed.
            <div className="flex h-[22rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center">
              <FilePdf size={22} className="text-muted-foreground/60" />
              <span className="text-xs text-muted-foreground">
                {refunded ? "The label was refunded — its file is gone with it." : "No label bought for this parcel."}
              </span>
            </div>
          )}

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
        </div>
      </DialogContent>
    </Dialog>
  )
}

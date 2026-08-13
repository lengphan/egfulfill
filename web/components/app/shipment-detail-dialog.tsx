"use client"

import { ArrowSquareOut, CircleNotch, X, Package, DownloadSimple, FilePdf, Printer } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEffect, useRef, useState } from "react"
import { fetchShipmentLabel, detachOrderLabel, getShipmentCandidates, attachShipmentToOrder, type ShipmentRow, type ShipmentCandidate } from "@/lib/api"

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
  shipment, onOpenChange, onRefund, voiding, canRefund, onChanged,
}: {
  shipment: ShipmentRow | null
  onOpenChange: (o: boolean) => void
  onRefund: (s: ShipmentRow) => void
  voiding: string | null
  canRefund: boolean
  /** Reload the list — attaching a loose label moves it onto an order, so the row this
   *  window was opened from is no longer what it was. */
  onChanged?: () => void
}) {
  const s = shipment
  const id = s?.id
  const hasLabel = !!s?.labelUrl

  /**
   * The label, fetched WITH the session's token and held as an object URL.
   *
   * A frame pointed straight at the route showed `{"error":"Not signed in"}`: an <iframe
   * src> is a plain navigation and carries no Authorization header, while this app keeps
   * its token in storage. So the bytes come through the API client and become a blob: URL —
   * which a frame renders and `download` saves, with no token anywhere in a URL.
   */
  const frameRef = useRef<HTMLIFrameElement>(null)
  // `sh_*` is the standalone namespace — see isShipmentId on the server. Every order id is
  // etsy-*, tiktok-*, FF-* or a bare sequence, so the two can never be confused.
  const isLoose = /^sh_/.test(String(id ?? ""))
  /**
   * THE MATCHES ARE ON THE SCREEN, not behind a button.
   *
   * This began as an amber banner announcing the problem with a "Find its order" button
   * beside it — which is a warning plus a click before you learn anything. But the answer
   * is nearly always one row, already known to the server, and a click that reveals a
   * single obvious choice was only ever a delay dressed as a decision.
   *
   * So the candidates load with the window and attach in one click each. Confirming is
   * still explicit — one Attach per row, never automatic — because two of these seven
   * parcels had more than one plausible order. What is gone is the step before the choice,
   * not the choice.
   */
  const [cands, setCands] = useState<ShipmentCandidate[] | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [matchErr, setMatchErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      if (!alive) return
      setCands(null); setMatchErr(null)
      if (!id || !/^sh_/.test(String(id))) return
      getShipmentCandidates(String(id))
        .then((r) => { if (alive) setCands(r.candidates ?? []) })
        .catch(() => { if (alive) setCands([]) })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [id])
  const attachTo = async (orderId: string) => {
    if (!id) return
    setAttaching(orderId); setMatchErr(null)
    try {
      const r = await attachShipmentToOrder(String(id), orderId)
      if (r.error) throw new Error(r.error)
      onOpenChange(false)
      onChanged?.()
    } catch (e) {
      setMatchErr(e instanceof Error ? e.message : "Couldn't attach this label to that order.")
    } finally { setAttaching(null) }
  }
  const [detaching, setDetaching] = useState(false)
  const [detachErr, setDetachErr] = useState<string | null>(null)
  /**
   * WRONG ORDER is not the same as WRONG LABEL, and they must not share a button.
   *
   * This unlinks: the order gives the tracking back and can be labelled again, while the
   * postage stays bought and stays charged. Refund is the other one, it goes to the carrier,
   * and it cannot be undone. An operator reaching for "I put this on the wrong order" must
   * not be able to destroy postage with the same click.
   */
  const detach = async () => {
    if (!id) return
    setDetaching(true); setDetachErr(null)
    try {
      const r = await detachOrderLabel(String(id))
      if (r.error) throw new Error(r.error)
      onOpenChange(false)
      onChanged?.()
    } catch (e) {
      setDetachErr(e instanceof Error ? e.message : "Couldn't remove the tracking from this order.")
    } finally { setDetaching(false) }
  }
  const [labelSrc, setLabelSrc] = useState<string | null>(null)
  const [labelErr, setLabelErr] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let alive = true
    // Deferred, not synchronous: a setState in an effect body cascades a render before
    // paint, which this repo lints against (react-hooks/set-state-in-effect).
    const t = setTimeout(() => {
      if (!alive) return
      setLabelSrc(null); setLabelErr(null)
      if (!id || !hasLabel) return
      fetchShipmentLabel(id)
        .then((blob) => {
          if (!alive) return
          url = URL.createObjectURL(blob)
          setLabelSrc(url)
        })
        .catch((e) => { if (alive) setLabelErr(e instanceof Error ? e.message : "Couldn't load the label.") })
    }, 0)
    // Revoked on close: an object URL pins its blob in memory until it is, and this window
    // is opened once per parcel down a long list.
    return () => { alive = false; clearTimeout(t); if (url) URL.revokeObjectURL(url) }
  }, [id, hasLabel])

  /**
   * PRINT THE FRAME, not a new tab.
   *
   * This works only because the label is already a blob: URL — a blob inherits this page's
   * origin, so the frame's document is reachable and `print()` on it is allowed. Pointing a
   * frame at the carrier's PDF and calling print() throws a cross-origin error, which is the
   * whole reason the bytes come through our API in the first place.
   *
   * Printing the frame the user is LOOKING AT is also the point: what comes out of the
   * printer is provably the label on screen, not a second fetch that could differ.
   */
  const printLabel = () => {
    const w = frameRef.current?.contentWindow
    if (!w) return
    // focus() first — a print() on an unfocused frame is silently ignored by some builds
    // of Chrome, which looks exactly like a dead button.
    w.focus()
    w.print()
  }

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

        {detachErr && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{detachErr}</div>
        )}

        {/* THE LABEL BESIDE THE FACTS.
            It was a button that opened another tab — which is a whole context switch to
            answer "is this the right parcel", the question you opened this window with. The
            page it opened is also the carrier's, so there was nothing to do there but look.
            Served through our own API (/api/shipments/:id/label) rather than the carrier's
            url: a cross-origin PDF can be refused an iframe outright, and `download` is
            ignored across origins — the browser navigates instead, which is the tab this
            replaces. Same-origin, both work. */}
        <div className="grid gap-5 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          {s.labelUrl ? (
            <div className="flex flex-col gap-2">
              {/* 4x6 is the shape every carrier label is printed at, so the frame is that
                  ratio — a 22rem-tall box in a 17rem column left a band of grey down each
                  side of the page and made the label smaller than it needed to be. */}
              <div className="relative aspect-[4/6] overflow-hidden rounded-lg border border-border bg-white">
                {labelSrc ? (
                  // #toolbar=0 asks the built-in viewer for the page and not its chrome —
                  // honoured by Chrome and Edge, ignored elsewhere, harmless either way.
                  <iframe
                    ref={frameRef}
                    src={`${labelSrc}#toolbar=0&navpanes=0&view=Fit`}
                    title={`Shipping label for ${s.num}`}
                    className="size-full bg-white"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center px-4 text-center">
                    {labelErr
                      ? <span className="text-xs text-destructive">{labelErr}</span>
                      : <CircleNotch size={20} className="animate-spin text-muted-foreground" />}
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Says WHICH: no label was ever bought, or it was refunded and the file with it.
            // A blank panel here reads as a load that failed.
            <div className="flex aspect-[4/6] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center">
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

          {/* EVERY ACTION IN ONE PLACE, at the end, right-aligned.
              Download sat under the label on the left while Refund sat on the right, so the
              window had two action areas facing each other across the middle and no single
              answer to "what can I do here".

              CHECK IS GONE. It asked the carrier again for one parcel — which the server
              already does on every read of this list: refreshStaleTracking trickles twelve
              rows a page load, anything unchecked for six hours. Opening the page you
              pressed it from had already done the work. */}
          {/* ITS ORDER, offered rather than announced. Only for a loose label — an `sh_*`
              id means it was bought with no order behind it, which is legitimate for a
              re-ship and a mistake the rest of the time. Either way the fix is the same
              question, so the question is simply asked. */}
          {isLoose && (
            <div className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground">
                {cands === null ? "Looking for its order…"
                  : cands.length === 0 ? "No order matches this parcel"
                  : cands.length === 1 ? "This parcel looks like it belongs to"
                  : `${cands.length} orders could be this parcel`}
              </div>
              {matchErr && <div className="px-3 py-2 text-xs text-destructive">{matchErr}</div>}
              {cands === null ? (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                  <CircleNotch size={13} className="animate-spin" /> Checking orders…
                </div>
              ) : cands.length === 0 ? (
                // A fact, not a shrug — and it names the second reason, which is not obvious.
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  Nothing matches its address or name. Orders that already have tracking aren&apos;t
                  offered, since a second number on one order means a parcel is unaccounted for.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {cands.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="truncate text-sm font-medium">{c.customer || "No name on the order"}</span>
                          <span className="font-mono text-2xs text-muted-foreground">{c.id}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                          {/* The import date earns its place: two orders for one buyer are
                              told apart by when they arrived and by nothing else here. */}
                          <span>Imported {c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" }) : "—"}</span>
                          {c.matchedZip && <span className="text-emerald-700 dark:text-emerald-400">· address matches</span>}
                          {c.matchedName && <span className="text-sky-700 dark:text-sky-400">· name matches</span>}
                          {!c.matchedZip && !c.matchedName && <span className="text-amber-700 dark:text-amber-400">· weak match</span>}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" disabled={!!attaching}
                              onClick={() => void attachTo(c.id)} className="shrink-0">
                        {attaching === c.id ? <CircleNotch size={12} className="animate-spin" /> : null}
                        Attach
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TWO BUTTONS, and everything else is a sentence.
              This had five controls in four different shapes — an outline button, a square
              icon-only button, a filled button, an outline anchor and a text link — wrapping
              onto two lines, and nothing in the arrangement said which one you came here to
              press. Shape was carrying no meaning, so it was just noise with corners.

              Now weight states rank, and only the primary action keeps an icon. Print is the
              thing you almost always want; Download is its fallback for when the file has to
              go somewhere else. The rest — refund, unlink, the carrier's own copy — are rare,
              and rare things read better as words than as buttons competing for the same eye.
              Grouping them left and the actions right also ends the old fault where the
              window had two action areas facing each other with no single answer to "what
              can I do here". */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {/* Only while it can still work: a second refund can only ever collect the
                  carrier's refusal, and a label with no stored PDF has no reference to
                  refund against. Destructive colour on hover only — it is the one action
                  here that spends money and cannot be taken back, but it is also not what
                  most people opened this window for. */}
              {canRefund && s.labelUrl && !refunded && (
                <button
                  onClick={() => onRefund(s)}
                  disabled={voiding === s.id}
                  title="Refund the postage with the carrier. This cannot be undone."
                  className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-2 transition-colors hover:text-destructive hover:underline disabled:opacity-50"
                >
                  {voiding === s.id ? <CircleNotch size={12} className="animate-spin" /> : null}
                  Refund postage
                </button>
              )}
              {/* UNLINK, for a label that is fine but landed on the wrong order. Deliberately
                  sitting beside Refund and reading nothing like it: one frees the order, the
                  other destroys the postage, and the title says so before the click. */}
              {!isLoose && !!s.tracking && (
                <button
                  onClick={() => void detach()}
                  disabled={detaching}
                  title="Take this tracking off the order so a correct label can be bought. The postage is NOT refunded."
                  className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
                >
                  {detaching ? <CircleNotch size={12} className="animate-spin" /> : null}
                  Wrong order?
                </button>
              )}
              {/* The carrier's own copy still has a use — checking ours against theirs — so
                  it stays, as three words rather than a square icon nobody could name. */}
              {s.labelUrl && (
                <a href={s.labelUrl} target="_blank" rel="noopener noreferrer"
                   className="text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline">
                  Carrier&apos;s copy
                </a>
              )}
            </div>

            {s.labelUrl && (
              <div className="flex items-center gap-2">
                {/* The same blob the frame is showing — so what you save is provably what you
                    just looked at, and it needs no second authenticated request. */}
                <a
                  href={labelSrc ?? undefined}
                  download={`label-${s.num}.pdf`}
                  aria-disabled={!labelSrc}
                  className={"eg-tap inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent "
                    + (labelSrc ? "" : "pointer-events-none opacity-50")}
                >
                  Download
                </a>
                <Button onClick={printLabel} disabled={!labelSrc}>
                  <Printer size={14} weight="bold" /> Print
                </Button>
              </div>
            )}
          </div>
        </div>
        </div>
      </DialogContent>

    </Dialog>
  )
}

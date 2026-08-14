"use client"

import { ArrowSquareOut, ArrowUUpLeft, CircleNotch, DownloadSimple, LinkBreak, Receipt, FilePdf, Printer, Warning } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { useEffect, useRef, useState } from "react"
import { fetchShipmentLabel, detachOrderLabel, restoreOrderLabel, getShipmentCandidates, attachShipmentToOrder, type ShipmentRow, type ShipmentCandidate } from "@/lib/api"
import { plainNum, platformFromId } from "@/lib/order-format"

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

/**
 * THE LEFT COLUMN WHEN THERE IS NO PDF — which is three different situations, and they were
 * sharing one grey sentence in the middle of a large dashed rectangle. The box was drawn as
 * an upload target ("drop a file here") for a panel nothing can be dropped into, and the
 * sentence it framed was doing the whole job of saying what had happened to a real parcel.
 *
 * So it is a state, dressed as one: the situation's own colour, its icon, a heading you can
 * read from across a desk, and one sentence under it. The way out lives here too, next to
 * the words explaining why it is needed, rather than as a link at the far end of the window.
 *
 * Amber is deliberate and reserved — the floor reads it as warning/hold, which is exactly
 * what an unlinked-but-paid-for label is. A refund is finished, not held, so it stays muted.
 */
function NoLabel({
  kind, canRestore, restoring, onRestore,
}: {
  kind: "refunded" | "unlinked" | "never"
  canRestore: "snapshot" | "carrier" | null
  restoring: boolean
  onRestore: () => void
}) {
  const unlinked = kind === "unlinked"
  const Icon = kind === "refunded" ? Receipt : unlinked ? LinkBreak : FilePdf
  return (
    // Same frame the label itself occupies — ratio on a narrow screen, the height of the
    // facts beside it on a wide one — so the window doesn't change shape depending on what
    // happened to the parcel.
    <div className={"flex aspect-[4/6] flex-col items-center justify-center gap-3 rounded-xl border px-6 text-center md:aspect-auto md:h-full md:min-h-[30rem] "
      + (unlinked
        ? "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10"
        : "border-border bg-muted/30")}>
      <div className={"flex size-11 items-center justify-center rounded-full "
        + (unlinked ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
        <Icon size={20} weight="duotone" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">
          {kind === "refunded" ? "Postage refunded" : unlinked ? "Tracking unlinked" : "No label yet"}
        </p>
        {/* The sentence answers the question the panel raises — where did the label go, and
            is this parcel in trouble — rather than restating the heading. */}
        <p className="mx-auto max-w-[15rem] text-xs leading-relaxed text-muted-foreground">
          {kind === "refunded"
            ? "The label was cancelled with the carrier and its file went with it."
            : unlinked
              ? "It was taken off this order, not refunded. The postage is still bought and the parcel is still moving."
              : "Nothing has been bought for this parcel yet."}
        </p>
        {/* The number is NOT repeated here. It is four rows to the right, struck through, in
            the facts column — printing it twice on one screen makes a reader check whether
            they are two different numbers. */}
      </div>
      {unlinked && canRestore && (
        <Button size="sm" variant="outline" onClick={onRestore} disabled={restoring} className="mt-1 bg-card">
          {restoring ? <CircleNotch size={13} className="animate-spin" /> : <ArrowUUpLeft size={13} weight="bold" />}
          {canRestore === "snapshot" ? "Put it back" : "Find it and put it back"}
        </Button>
      )}
      {unlinked && canRestore === "carrier" && (
        // Said before the click, not after it fails. Both sentences are load-bearing: the
        // lookup can come back with nothing, and whether the buyer was already told was
        // destroyed with the label — pushing on a guess would email them twice. Saving the
        // order pushes it once someone knows.
        <p className="max-w-[16rem] text-2xs leading-relaxed text-muted-foreground">
          If the carrier can&apos;t find it, nothing changes.
          The marketplace isn&apos;t told either — we no longer know if the buyer has this number.
        </p>
      )}
    </div>
  )
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
   * ASK FIRST. This was a one-click action on a text link sitting between "Refund postage"
   * and "Carrier's copy", and it was pressed to find out what it did — which is a reasonable
   * thing to do to a link labelled "Wrong order?" and a terrible thing for it to answer by
   * removing a live tracking number from a real parcel.
   *
   * The confirm is not a "are you sure" — that adds a click and no information. It says what
   * happens, what does NOT happen (the postage stays bought), and names the other two things
   * the presser might actually have wanted, because "wrong order" is one of three different
   * problems and only one of them is fixed here.
   */
  const [confirmDetach, setConfirmDetach] = useState(false)
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
    } finally { setDetaching(false); setConfirmDetach(false) }
  }
  /**
   * THE WAY BACK. Unlinking is reversible — the postage was never refunded and the label
   * still exists at the carrier — so an order whose tracking was taken off offers to have it
   * put back, rather than reading like a cancellation nobody can undo.
   */
  const [restoring, setRestoring] = useState(false)
  const restore = async () => {
    if (!id) return
    setRestoring(true); setDetachErr(null)
    try {
      const r = await restoreOrderLabel(String(id))
      if (r.error) throw new Error(r.error)
      onOpenChange(false)
      onChanged?.()
    } catch (e) {
      setDetachErr(e instanceof Error ? e.message : "Couldn't put the tracking back on this order.")
    } finally { setRestoring(false) }
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
          {/* THE NUMBER AND WHAT IT COST, and nothing else.
              The icon was decoration on a line that already says what it is, and the
              marketplace chip was a second thing to read before the number — it is a fact
              about the order, so it went down into the facts with the rest of them. What
              earns the other half of this line is the price: it is the figure someone is
              here to check or to justify, and it was six rows down in body text.
              `pe-8` keeps it clear of the close button. */}
          <DialogTitle className="flex items-baseline gap-3 pe-8">
            <span className="truncate tabular-nums">{isLoose ? s.id : s.num.startsWith("#") ? s.num : plainNum(s.id)}</span>
            {s.test && (
              <span className="shrink-0 self-center rounded bg-slate-200 px-1.5 py-0.5 text-2xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">TEST</span>
            )}
            {s.price != null && (
              <span className={"ms-auto shrink-0 text-xl font-semibold tabular-nums "
                + (refunded ? "text-muted-foreground line-through decoration-destructive/70" : "")}>
                ${s.price.toFixed(2)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* The failure of one of the two actions in this window, said where the eye already
            is. Icon and heading rather than a bare red sentence: what follows is the
            provider's own wording, which can be a paragraph, and a paragraph of red text
            with nothing in front of it reads as a crash rather than as an answer. */}
        {detachErr && (
          <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <Warning size={16} weight="fill" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-destructive">That didn&apos;t go through</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detachErr}</p>
            </div>
          </div>
        )}

        {/* THE LABEL BESIDE THE FACTS.
            It was a button that opened another tab — which is a whole context switch to
            answer "is this the right parcel", the question you opened this window with. The
            page it opened is also the carrier's, so there was nothing to do there but look.
            Served through our own API (/api/shipments/:id/label) rather than the carrier's
            url: a cross-origin PDF can be refused an iframe outright, and `download` is
            ignored across origins — the browser navigates instead, which is the tab this
            replaces. Same-origin, both work. */}
        {/* `items-stretch` and a full-height left column: the label and the facts are one
            spread, and a 4:6 box that stopped two-thirds of the way down the facts left a
            gap under the page and made the label smaller than the space allowed. The ratio
            now only sets the floor on a narrow screen, where the columns stack and there is
            no facing content to match. */}
        <div className="grid items-stretch gap-5 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          {s.labelUrl ? (
            <div className="flex flex-col gap-2 md:h-full">
              {/* 4x6 is the shape every carrier label is printed at. `#view=Fit` keeps the
                  page whole inside whatever height the facts give it, so a taller frame
                  shows a bigger label rather than a cropped one. */}
              <div className="relative aspect-[4/6] overflow-hidden rounded-lg border border-border bg-white md:aspect-auto md:h-full md:min-h-[30rem]">
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
            // WHICH of three, because they are not the same thing and one grey sentence was
            // saying the first one to all of them. A parcel whose tracking was merely
            // unlinked read as "no label bought" — indistinguishable from a cancellation,
            // when the postage is still bought, still paid for, and one click from coming back.
            <NoLabel
              kind={refunded ? "refunded" : s.restorable ? "unlinked" : "never"}
              canRestore={isLoose ? null : s.restorable}
              restoring={restoring}
              onRestore={() => void restore()}
            />
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

          {/* WHOSE PARCEL, THEN WHICH PARCEL, THEN HOW IT IS GOING — read top to bottom.
              The marketplace leads because it is the first thing that decides where you go
              to check anything else. Postage is gone from here: it is in the title now. */}
          <div>
            <Row label="Marketplace">{isLoose ? "No order — a loose label" : platformFromId(s.id)}</Row>
            <Row label="Customer">{s.customer || "—"}</Row>
            <Row label="Tracking" mono>
              {s.tracking ? s.tracking
                : s.voidedTracking
                  ? <span className="text-muted-foreground line-through decoration-destructive/70">{s.voidedTracking}</span>
                  : "—"}
            </Row>
            {/* The full line, not the state alone — two parcels for one buyer are told apart
                by the street, and "did this go to the right place" is the question. */}
            <Row label="Address">{s.address || s.state || "—"}</Row>
            <Row label="Carrier">{s.carrier || "—"}</Row>
            <Row label="Service">{s.method || "—"}</Row>
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

          {/* TWO STATUSES, ONE EACH SIDE OF THE DOOR — and they used to be four rows.
              "Carrier says", "Detail", "Last checked" and "Pre-scan" are all one question
              asked twice: what does the carrier know, and what did WE do. So the carrier's
              word, their sentence and when we last asked collapse into one row, and the
              scan becomes the dispatch side of the pair. The parcel's own history reads
              down the column instead of being spread across labels. */}
          <div>
            <Row label="Carrier status">
              {s.delivery
                ? <>
                    <span>{DELIVERY_WORD[s.delivery] ?? s.delivery}</span>
                    {s.deliveryDetail && <span className="block text-xs text-muted-foreground">{s.deliveryDetail}</span>}
                    {s.deliveryCheckedAt && <span className="block text-2xs text-muted-foreground">asked {when(s.deliveryCheckedAt)}</span>}
                  </>
                : <span className="text-muted-foreground">Not asked yet</span>}
            </Row>
            <Row label="Dispatch status">
              {s.scannedAt
                ? <>
                    <span>{VIA_WORD[s.scannedVia ?? ""] ?? "Scanned"}</span>
                    <span className="block text-2xs text-muted-foreground">{when(s.scannedAt)}</span>
                  </>
                : <span className="text-muted-foreground">Not scanned out yet</span>}
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

        </div>
        </div>

        {/* THE CONFIRM, in place of the click that used to be the whole action. It sits
            above the buttons rather than in a second dialog: what it is asking about is the
            tracking number in the column above, and a stacked modal would cover it. */}
        {confirmDetach && (
            // ONE LINE. A four-bullet brief with a paragraph under it was a page to read
            // before a click that is now reversible anyway — and the length itself said
            // "this is dangerous", which is exactly the wrong signal for the safe half of
            // the pair. What survives is the only fact that can still surprise someone:
            // money does not come back. The rest is on screen either side of it.
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
              <Warning size={16} weight="fill" className="shrink-0 text-amber-700 dark:text-amber-300" />
              <p className="min-w-0 flex-1 text-sm">
                Take this tracking off the order?{" "}
                <span className="text-muted-foreground">
                  The postage stays bought — <strong className="font-medium text-foreground">not a refund</strong> — and you can put it back.
                </span>
              </p>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => void detach()} disabled={detaching} className="bg-card">
                  {detaching ? <CircleNotch size={13} className="animate-spin" /> : <LinkBreak size={13} weight="bold" />}
                  Yes, unlink it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDetach(false)} disabled={detaching}>
                  Keep it
                </Button>
              </div>
            </div>
          )}

          {/* ONE KIND OF CONTROL, five of them.
              This row had five actions in four visual languages: two plain text links, an
              anchor styled as a link, an anchor hand-styled as a square-cornered button, and
              a pill Button — different heights, different corners, two of them not looking
              clickable at all. Nothing in that arrangement could be scanned, because shape
              was varying for reasons that had nothing to do with what the buttons do.

              Now every one is the same pill at the same height and only the VARIANT states
              rank: filled for the thing you came here to do, outline for its fallback, ghost
              for the three rare ones. The anchors borrow buttonVariants rather than
              approximating it, so "looks like a button" and "is a button" cannot drift.
              Rare on the left, routine on the right, as before.

              It also spans the WHOLE window now rather than sitting inside the facts column.
              Five pills in a 24rem column wrapped onto three lines — which is most of why
              the row looked like a pile rather than a set. Full width, they are one line. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {/* Only while it can still work: a second refund can only ever collect the
                carrier's refusal, and a label with no stored PDF has no reference to refund
                against. It is the one action here that cannot be taken back — which is what
                the confirm it raises is for, not what its colour should be shouting all day. */}
            {canRefund && s.labelUrl && !refunded && (
              <Button
                size="sm" variant="ghost"
                onClick={() => onRefund(s)}
                disabled={voiding === s.id}
                title="Refund the postage with the carrier. This cannot be undone."
              >
                {voiding === s.id ? <CircleNotch size={13} className="animate-spin" /> : <Receipt size={13} />}
                Refund postage
              </Button>
            )}
            {/* UNLINK, for a label that is fine but landed on the wrong order. Sitting beside
                Refund and reading nothing like it: one frees the order, the other destroys
                the postage. It opens the confirm above; it does NOT act. */}
            {!isLoose && !!s.tracking && (
              <Button
                size="sm" variant="ghost"
                onClick={() => setConfirmDetach(true)}
                disabled={detaching || confirmDetach}
                title="Take this tracking off the order so a correct label can be bought. The postage is NOT refunded, and this can be undone."
              >
                <LinkBreak size={13} />
                Wrong order?
              </Button>
            )}
            {/* The carrier's own copy still has a use — checking ours against theirs. */}
            {s.labelUrl && (
              <a href={s.labelUrl} target="_blank" rel="noopener noreferrer"
                 className={buttonVariants({ variant: "ghost", size: "sm" })}>
                <ArrowSquareOut size={13} />
                Carrier&apos;s copy
              </a>
            )}

            {s.labelUrl && (
              <div className="ms-auto flex items-center gap-2">
                {/* The same blob the frame is showing — so what you save is provably what you
                    just looked at, and it needs no second authenticated request. */}
                <a
                  href={labelSrc ?? undefined}
                  download={`label-${plainNum(s.id)}.pdf`}
                  aria-disabled={!labelSrc}
                  className={buttonVariants({ variant: "outline", size: "sm" })
                    + (labelSrc ? "" : " pointer-events-none opacity-50")}
                >
                  <DownloadSimple size={13} />
                  Download
                </a>
                <Button size="sm" onClick={printLabel} disabled={!labelSrc}>
                  <Printer size={13} weight="bold" /> Print
                </Button>
              </div>
            )}
          </div>
      </DialogContent>

    </Dialog>
  )
}

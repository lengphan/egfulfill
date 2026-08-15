"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PaperPlaneTilt, Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { updateOrder, getOrderQuote, getOrderLimitStatus, ApiError, type OrderRow, type OrderQuote } from "@/lib/api"
import { isFactoryOrder } from "@/lib/factory-status"

const money = (n: number | string | null | undefined) => `$${(Number(n) || 0).toFixed(2)}`

/**
 * An order can only be submitted before the factory has it — and only if there is a seller
 * to submit it.
 *
 * NOT ON THE FACTORY'S OWN ORDERS. Submit is the CHARGE point: it takes money from a
 * seller's wallet and parks the order at Pending for us to accept. A factory-owned order
 * has neither half — the server never charges it (the charge sits inside `if (sel)`, and
 * staff resolve to sel = null) and `in_review` isn't even on its pipeline (FACTORY_LINE
 * in server/src/routes/orders.js). So the button offered to bill nobody and move an order
 * to a stage it cannot occupy, beside "Start", which is the real one — the button that
 * accepts the job, pulls the blanks out of inventory, and means production has begun.
 */
export const isSubmittable = (o: { factory_status?: string | null; factory_order?: boolean | null }) =>
  !isFactoryOrder(o) && ["", "new", "draft"].includes(String(o.factory_status || ""))

/**
 * Submit to production — the CHARGE point.
 *
 * Lives here rather than inside the order detail page because the order LIST needs the
 * same action: making someone open every order to submit it turns a five-order morning
 * into five page loads, and two implementations of a button that spends money is exactly
 * the drift this codebase has been bitten by before.
 *
 * `quote` is optional. The detail page already has one and passes it, so nothing extra
 * is fetched there. The list does NOT — quoting every row on render would be a request
 * per order for a price most people never look at — so it fetches on open instead. Either
 * way the price is on screen before the button that takes the money.
 */
export function SubmitOrderButton({
  order, quote, onDone, size = "sm", label = "Submit to production", className, incomplete = 0,
}: {
  order: OrderRow
  /** Pass one if the caller already has it; otherwise it's fetched when the dialog opens. */
  quote?: OrderQuote | null
  onDone: () => void
  size?: "sm" | "default"
  label?: string
  className?: string
  /** Lines still missing a blank / colour / size / method (orderNeedsSetup). > 0 blocks the
   *  submit: an order with an unpicked variant can't be produced, so it must not be charged
   *  and pushed to the floor. Callers with the catalog compute this; default 0 = no gate. */
  incomplete?: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [short, setShort] = useState(false)
  const [open, setOpen] = useState(false)
  // Only used when the caller didn't supply one.
  const [fetched, setFetched] = useState<OrderQuote | null>(null)
  const [loadingQuote, setLoadingQuote] = useState(false)
  // Peak-season delay notice. Only set once the server confirms this seller has CROSSED their
  // daily order limit — so it never pops up prematurely, and it never blocks the submit.
  const [limitNotice, setLimitNotice] = useState<string | null>(null)

  if (!isSubmittable(order)) return null

  const q = quote ?? fetched

  const openDialog = () => {
    setOpen(true)
    // Ask the server whether this seller is over their limit (it owns the count + the notice
    // text). Best-effort — a failed check just means no notice, never a blocked submit.
    getOrderLimitStatus().then((r) => setLimitNotice(r.over ? r.notice : null)).catch(() => {})
    if (quote || fetched || loadingQuote) return
    setLoadingQuote(true)
    getOrderQuote(order.id)
      .then((r) => setFetched(r))
      .catch(() => { /* the dialog still works; it just can't show a total */ })
      .finally(() => setLoadingQuote(false))
  }

  const submit = async () => {
    setBusy(true); setErr(null); setShort(false)
    try {
      await updateOrder(order.id, { factoryStatus: "in_review", status: "in_review" })
      setOpen(false)
      onDone()
    } catch (e) {
      // 402 = the server refused on money grounds (short balance, or a line it can't
      // price). Its message already names the amounts, so show it verbatim.
      if (e instanceof ApiError && e.status === 402) setShort(true)
      setErr(e instanceof Error ? e.message : "Could not submit this order")
    } finally { setBusy(false) }
  }

  // Block when a line still needs setup (no blank / unpicked variant — can't be made), or
  // on a quote we actually have that has unpriceable lines. An un-fetched quote is not
  // evidence of a problem, so it never blocks on its own.
  const setupBlock = incomplete > 0
  const blocked = setupBlock || !!q?.unpriced?.length
  const blockMsg = setupBlock
    ? `${incomplete} item${incomplete === 1 ? "" : "s"} still ${incomplete === 1 ? "needs" : "need"} a blank, colour, size & method — pick them before submitting.`
    : "Some lines have no price yet — pick a blank on them first"

  return (
    <>
      <Button
        size={size}
        className={className}
        onClick={(e) => { e.stopPropagation(); openDialog() }}
        disabled={busy || blocked}
        title={blocked ? blockMsg : undefined}
      >
        <PaperPlaneTilt size={14} weight="bold" /> {label}
      </Button>

      {/* A dialog, not inline confirm text — confirming used to swap two extra buttons
          into the header and reflow the whole row. */}
      <Dialog open={open} onOpenChange={(v) => { if (busy) return; setOpen(v); if (!v) { setErr(null); setShort(false) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit to production?</DialogTitle>
            <DialogDescription>
              This sends the order to the factory and charges your wallet. You can still cancel until the floor starts work.
            </DialogDescription>
          </DialogHeader>

          {q ? (
            <dl className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Production</dt>
                <dd className="tabular-nums">{money(q.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipping</dt>
                <dd className="tabular-nums">{money(q.shipping)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(q.total)}</dd>
              </div>
            </dl>
          ) : loadingQuote ? (
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              Working out the price…
            </div>
          ) : null}

          {setupBlock ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /> {blockMsg} We can&apos;t make an order with an item that isn&apos;t fully specified.
            </div>
          ) : q?.unpriced?.length ? (
            <p className="text-sm text-destructive">
              {q.unpriced.length} line{q.unpriced.length === 1 ? "" : "s"} can&apos;t be priced yet — pick a blank on them first.
            </p>
          ) : null}

          {/* Peak-season heads-up — shown only when this seller is over their limit. It warns,
              it doesn't stop: they can still submit. */}
          {limitNotice && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /> {limitNotice}
            </div>
          )}

          {err && <p className="text-sm text-destructive">{err}</p>}

          <DialogFooter>
            {short && <Button variant="outline" onClick={() => router.push("/wallet")}>Top up wallet</Button>}
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Not yet</Button>
            <Button onClick={submit} disabled={busy || loadingQuote || blocked}>
              {busy ? "Submitting…" : q ? `Charge ${money(q.total)}` : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

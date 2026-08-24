// The three readiness tags an order carries — LABEL · SCAN · DESIGN — as DATA.
//
// Lifted out of readiness-dots.tsx so the filter bar can narrow on exactly what the chips
// show. Deriving "design approved" a second time inside the filter is how a Ready filter
// ends up hiding rows whose chip says otherwise; the component now RENDERS what this
// returns, and the filter READS it. One rule, two consumers.
//
// Every comment below is the reasoning that was already attached to these branches — the
// states are unchanged, only their home is.

import { designForLine, type OrderRow, type OrderItem, type OrderDesign, type DesignFileRow } from "@/lib/api"
import { isShippable } from "@/lib/order-format"

export type ReadyState = "todo" | "doing" | "done"
/** A tag's state plus the sentence that explains it (the popover's subtitle, and the
 *  `title=` on the chip). The chip's WORD never changes — progress is carried by colour. */
export type ReadyTag = { state: ReadyState; status: string }

export type OrderReadiness = {
  label: ReadyTag
  scan: ReadyTag
  design: ReadyTag
  /** Decorated lines that have artwork attached — the Design tag lists these as files. */
  withArt: OrderItem[]
  /** Lines carrying the BUYER's own upload. Evidence, not a production file. */
  buyerUploads: OrderItem[]
}

/**
 * @param opts.items    lines to read (defaults to `order.items`)
 * @param opts.designs  placed artwork keyed by line_id/sku — presence means there's something to work from
 * @param opts.files    machine files fetched for this order. UNDEFINED means "not fetched",
 *                      which falls back to the row-level `has_machine_file` flag; an empty
 *                      array means "fetched, none" and wins over it.
 */
export function orderReadiness(
  order: OrderRow,
  opts: { items?: OrderItem[]; designs?: Record<string, OrderDesign>; files?: DesignFileRow[] } = {},
): OrderReadiness {
  const { items, designs, files } = opts

  // A label needs an address, so its absence covers both — the tooltip names the reason
  // rather than spending a second tag on it.
  const hasLabel = !!order.tracking
  const hasAddr = isShippable(order)
  const labelStatus = hasLabel
    ? `Label ${order.label_printed_at ? "printed" : "created"} · ${order.tracking}`
    : hasAddr ? "No label bought yet" : "No address yet — a label can't be created without one"

  // SCAN = the label was pre-scanned at dispatch, which is what starts the carrier /
  // marketplace clock. Read from label_scanned_at — the actual recorded fact — rather
  // than inferred from the pipeline stage, which was only ever a proxy and went "done"
  // for orders whose label had never been scanned at all.
  //
  // NO stage fallback. An order with no recorded pre-scan reads as not pre-scanned, which
  // is simply true: we have no evidence it was.
  const preScanned = !!order.label_scanned_at
  // AMBER = waiting to be scanned, which is simply: a label exists and no scan is recorded.
  //
  // THIS CHIP *IS* THE DISPATCH QUEUE. It used to read `factory_status === 'awaiting_scan'`
  // back into itself — a stage that existed to feed this chip, and which the chip was then
  // derived from. That loop is why a cap on the embroidery machine read "Awaiting scan" and
  // why an order the partner had already picked still did. The stage is gone; the fact was
  // always here.
  //
  // Two ways in still read differently, because "we haven't got to it" and "someone else
  // has it" are different problems with different people to chase.
  const withPartner = !!(order as { dispatch_pdf_id?: string | null }).dispatch_pdf_id
  // On a USPS SCAN form. Amber, not violet: the form is a document we printed, and USPS
  // scanning it is a separate event that happens at handover — or doesn't, if the pile
  // never goes out.
  const manifested = !!(order as { manifested_at?: string | null }).manifested_at
  const scanPending = !preScanned && !!order.tracking

  const scanStatus = preScanned
    // VIOLET the moment a scan is actually recorded, whoever did it. The route is a
    // detail; the fact is that the buyer's tracking has started.
    ? `Scanned ${new Date(order.label_scanned_at as string).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${
        (order as { scanned_via?: string | null }).scanned_via === "partner" ? " by the dispatch partner" :
        (order as { scanned_via?: string | null }).scanned_via === "in-house" ? " here" :
        // The carrier's own acceptance scan, arriving through tracking. Worth naming:
        // it's the only one of the three routes nobody here asserted.
        (order as { scanned_via?: string | null }).scanned_via === "carrier" ? " by the carrier" : ""
      } — tracking is live for the buyer. The parcel may still be in production.`
    : scanPending
      ? withPartner
        ? "With the dispatch partner — in their queue, not scanned yet."
        // Deliberately says what's still missing rather than "manifested". The form being
        // printed is not the parcel being accepted, and only one of those the buyer sees.
        : manifested
          ? "On today's USPS SCAN form — printed, but the carrier hasn't accepted it yet."
          : "On the dispatch page, waiting to be scanned — the buyer's tracking has not started."
      // Grey is now exactly one thing: there is no label. Nothing to scan, nothing queued.
      : "No label yet, so nothing to scan."

  const list = items ?? order.items ?? []
  const decorated = list.filter((it) => String(it.print_type || "").trim())
  // ONLY artwork actually attached to the order counts as a design — a buyer's own upload
  // is not a design anybody filed, and counting it made an ordinary Etsy order arrive with
  // the tag already reading "sent to a designer". It stays as evidence, in the file list.
  const withArt = decorated.filter((it) => designForLine(designs, it)?.data)
  const buyerUploads = list.filter((it) => it.design_src)
  // A machine file marks the design done. The loaded file list WINS when present (even when
  // empty) — so removing the last file reverts the tag immediately. Only when the list
  // hasn't been fetched do we fall back to has_machine_file from the orders query, which is
  // what lets the tag be right on a row nobody expanded.
  const hasFile = files ? files.some((f) => f.kind === "pes" || f.kind === "emb") : order.has_machine_file === true
  const onBoard = order.design_on_board === true
  const boardApproved = order.design_approved === true

  // VIOLET ("done") only when APPROVED — the design board approved the card, or a finished
  // machine file exists and it never went through the board (a direct upload, nothing to
  // review). A card SENT for review stays AMBER: a file existing is not it being approved.
  const approved = boardApproved || (hasFile && !onBoard)
  const designState: ReadyState = approved
    ? "done"
    : onBoard || hasFile || (decorated.length > 0 && withArt.length === decorated.length)
      ? "doing"
      : "todo"
  const designStatus = approved
    ? "Design approved — ready to make."
    : onBoard
      ? "On the design board — waiting on approval."
      : designState === "doing"
        ? hasFile ? "File attached — waiting on approval." : "Artwork attached — waiting on the machine file."
        : decorated.length === 0
          ? "No design added yet."
          : `${decorated.length - withArt.length} of ${decorated.length} items still need artwork.`

  return {
    label: { state: hasLabel ? "done" : "todo", status: labelStatus },
    scan: { state: preScanned ? "done" : scanPending ? "doing" : "todo", status: scanStatus },
    design: { state: designState, status: designStatus },
    withArt,
    buyerUploads,
  }
}

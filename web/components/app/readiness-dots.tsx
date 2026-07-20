"use client"

import type { OrderRow, OrderItem, OrderDesign, DesignFileRow } from "@/lib/api"

/**
 * Three tags, always the same three, always in the same place: LABEL · SCAN · DESIGN.
 *
 * Earlier versions rendered only what was WRONG, so the tags moved around and the count
 * changed row to row — you couldn't scan a column, and four amber chips read as four
 * alarms when they meant "not done yet". A production board is scanned vertically; the
 * shape has to be constant for that to work.
 *
 * Grey = not done. Tinted = done. Colour is the app's accent rather than amber, because
 * amber already means "something is wrong" everywhere else (short stock, past due) — a
 * colour that means both "good" and "problem" means neither.
 *
 * DESIGN carries the one middle state that matters: artwork exists and is with a designer
 * ("Design sent") versus a machine file actually produced from it ("Design approved").
 * That's the difference between work queued and work done, and it's the question the
 * floor asks before starting a job.
 */

type State = "todo" | "doing" | "done"

function Tag({ label, state, title }: { label: string; state: State; title?: string }) {
  const cls =
    state === "done"
      ? "bg-primary/10 text-primary"
      : state === "doing"
        ? "bg-primary/5 text-primary/70"
        : "bg-muted text-muted-foreground/70"
  return (
    <span title={title} className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + cls}>
      {label}
    </span>
  )
}

export function ReadinessStrip({ order, items, designs, files, className }: {
  order: OrderRow
  items?: OrderItem[]
  /** Placed artwork keyed by sku — presence means a design exists to work from. */
  designs?: Record<string, OrderDesign>
  /** Machine files produced for this order — presence means a design was approved. */
  files?: DesignFileRow[]
  className?: string
}) {
  const stage = String(order.factory_status ?? "").toLowerCase()

  // A label needs an address, so its absence covers both — the tooltip names the reason
  // rather than spending a second tag on it.
  const hasLabel = !!order.tracking
  const addr = (order.address ?? {}) as Record<string, string>
  const hasAddr = !!((addr.street || addr.first_line || addr.line1 || addr.address1) && (addr.zip || addr.postal_code))
  const labelTitle = hasLabel
    ? `Label ${order.label_printed_at ? "printed" : "created"} · ${order.tracking}`
    : hasAddr ? "No label bought yet" : "No address yet — a label can't be created without one"

  // Scanned = past the scan queue. Nothing else records that the batch went out.
  const scanned = ["working", "printed", "shipped"].includes(stage)

  const list = items ?? order.items ?? []
  const decorated = list.filter((it) => String(it.print_type || "").trim())
  const withArt = decorated.filter((it) => (it.sku && designs?.[it.sku]?.data) || it.design_src)
  const approved = (files ?? []).some((f) => f.kind === "pes" || f.kind === "emb")

  const designState: State = approved
    ? "done"
    : decorated.length > 0 && withArt.length === decorated.length
      ? "doing"
      : "todo"
  const designLabel = approved ? "Design approved" : designState === "doing" ? "Design sent" : "Design"
  const designTitle = approved
    ? "A machine file has been produced for this order"
    : designState === "doing"
      ? "Artwork is attached and with a designer — no machine file yet"
      : decorated.length === 0
        ? "No decorated lines on this order"
        : `${decorated.length - withArt.length} of ${decorated.length} lines still need artwork`

  return (
    <span className={"inline-flex items-center gap-1 " + (className ?? "")}>
      <Tag label="Label" state={hasLabel ? "done" : "todo"} title={labelTitle} />
      <Tag label="Scan" state={scanned ? "done" : "todo"} title={scanned ? "Scanned out of dispatch" : "Waiting on the scan"} />
      <Tag label={designLabel} state={designState} title={designTitle} />
    </span>
  )
}

"use client"

import { useState } from "react"
import { getOrderHistory, type AuditRow, type OrderRow, type OrderItem, type OrderDesign, type DesignFileRow } from "@/lib/api"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { forTag, sayAction, EMPTY_HINT, type TagId } from "@/components/app/tag-history"

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

function Tag({ id, label, state, title, orderId }: { id: TagId; label: string; state: State; title?: string; orderId: string }) {
  const cls =
    state === "done"
      ? "bg-primary/10 text-primary hover:bg-primary/15"
      : state === "doing"
        ? "bg-primary/5 text-primary/70 hover:bg-primary/10"
        : "bg-muted text-muted-foreground/70 hover:bg-muted/80"
  const [rows, setRows] = useState<AuditRow[] | null>(null)

  // History loads on OPEN, not on render — a board of 50 rows would otherwise fire 150
  // requests for popovers nobody opened.
  const load = (open: boolean) => {
    if (!open || rows) return
    getOrderHistory(orderId).then((r) => setRows(r ?? [])).catch(() => setRows([]))
  }

  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger
        title={title}
        className={"eg-tap rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors " + cls}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold">{label}</div>
        <div className="max-h-56 overflow-y-auto p-1">
          {rows === null ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>
          ) : forTag(id, rows).length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">{EMPTY_HINT[id]}</div>
          ) : (
            forTag(id, rows).map((r) => (
              <div key={String(r.id)} className="rounded px-2 py-1.5 hover:bg-accent">
                <div className="text-xs font-medium">{sayAction(r.action)}</div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(r.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {r.actor_email ? ` · ${r.actor_email}` : r.actor_role ? ` · ${r.actor_role}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
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
      <Tag id="label" orderId={order.id} label="Label" state={hasLabel ? "done" : "todo"} title={labelTitle} />
      <Tag id="scan" orderId={order.id} label="Scan" state={scanned ? "done" : "todo"} title={scanned ? "Scanned out of dispatch" : "Waiting on the scan"} />
      <Tag id="design" orderId={order.id} label={designLabel} state={designState} title={designTitle} />
    </span>
  )
}

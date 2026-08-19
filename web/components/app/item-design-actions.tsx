"use client"

import { useState } from "react"
import { DotsThree, PaperPlaneTilt, CheckCircle, Eye, Clock } from "@phosphor-icons/react"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { PushToPartnerDialog } from "@/components/app/push-to-partner-dialog"
import type { OrderDesignStatus } from "@/lib/api"

type CardState = OrderDesignStatus["bySku"][string]

/** Their lane vocabulary → what it means for this line. `col` is the design board's
 *  column, which is also what the partner's webhook drives, so one mapping serves both. */
const LANE: Record<string, { label: string; tone: string; icon: typeof Eye }> = {
  incoming:   { label: "Queued",    tone: "bg-muted text-muted-foreground",   icon: Clock },
  inprogress: { label: "Designing", tone: "bg-sky-100 text-sky-700",          icon: Clock },
  review:     { label: "In review", tone: "bg-violet-100 text-violet-700",    icon: Eye },
  fix:        { label: "Needs fix", tone: "bg-amber-100 text-amber-800",      icon: Clock },
  approved:   { label: "Approved",  tone: "bg-emerald-100 text-emerald-700",  icon: CheckCircle },
}

const VENDOR_NAMES: Record<string, string> = { pinkdesign: "Pink Design" }
const vendorLabel = (v?: string | null) => (v ? VENDOR_NAMES[v] ?? v : "")

/**
 * The design-partner chip + action for ONE line item, for use on any factory board row.
 *
 * Two states, and the distinction is the point:
 *
 *   • nothing sent  → no chip at all, and the action lives under a "…" menu. Most artwork
 *     arrives print-ready and never goes out, so a permanent button on every row would be
 *     noise on the majority of lines to serve the minority.
 *   • sent          → a chip naming WHO has it and where it is, always visible. Once a
 *     line's artwork is on someone else's board that's load-bearing information: it says
 *     why the line isn't moving and who to chase.
 *
 * The chip tracks the same board column the partner's webhook writes, so when work comes
 * back it reads "In review" here and lands in the review lane on the board — one state,
 * shown in both places, never two that can disagree.
 */
export function ItemDesignActions({
  orderId, sku, itemName, qty, printType, artworkUrl, lineImage, state, onChanged,
}: {
  orderId: string
  sku: string
  itemName?: string | null
  qty?: number | null
  printType?: string | null
  artworkUrl?: string | null
  /** The line's own picture, used as the design when nothing has been stored yet. */
  lineImage?: string | null
  state?: CardState
  onChanged?: () => void
}) {
  const [pushOpen, setPushOpen] = useState(false)
  const sent = !!state?.vendor
  const lane = state?.col ? LANE[state.col] : undefined
  const Icon = lane?.icon

  return (
    <>
      <div className="flex items-center gap-1.5">
        {sent && (
          <span
            className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " + (lane?.tone ?? "bg-muted text-muted-foreground")}
            title={`${vendorLabel(state?.vendor)}${state?.vendorRef ? ` · task ${state.vendorRef}` : ""}`}
          >
            {Icon && <Icon size={11} weight="fill" />}
            {vendorLabel(state?.vendor)}{lane ? ` · ${lane.label}` : ""}
          </span>
        )}
        {/* Tucked away, not on the row. The overwhelming majority of lines never need
            this, and a button that's usually wrong to press is worse than one click. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label="Design actions"
          >
            <DotsThree size={16} weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Design</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setPushOpen(true)} disabled={sent}>
                <PaperPlaneTilt size={14} />
                {sent ? `Already with ${vendorLabel(state?.vendor)}` : "Send to design partner"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <PushToPartnerDialog
        open={pushOpen}
        onOpenChange={setPushOpen}
        orderId={orderId}
        sku={sku}
        itemName={itemName}
        qty={qty}
        printType={printType}
        artworkUrl={artworkUrl}
        lineImage={lineImage}
        onPushed={() => { setPushOpen(false); onChanged?.() }}
      />
    </>
  )
}

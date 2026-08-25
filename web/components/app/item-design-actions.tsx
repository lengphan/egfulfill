"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { DotsThree, PaperPlaneTilt, CheckCircle, Eye, Clock } from "@phosphor-icons/react"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { PushToPartnerDialog } from "@/components/app/push-to-partner-dialog"
import { getPinkStatus, type OrderDesignStatus } from "@/lib/api"

type CardState = OrderDesignStatus["bySku"][string]

/** Their lane vocabulary → what it means for this line. `col` is the design board's
 * column, which is also what the partner's webhook drives, so one mapping serves both. */
const LANE: Record<string, { label: string; tone: string; icon: typeof Eye }> = {
 incoming:   { label: "Queued", tone: "bg-muted text-muted-foreground", icon: Clock },
 inprogress: { label: "Designing", tone: "bg-packed/12 text-packed", icon: Clock },
 review:     { label: "In review", tone: "bg-working/12 text-working", icon: Eye },
 fix:        { label: "Needs fix", tone: "bg-hold/15 text-hold", icon: Clock },
 approved:   { label: "Approved", tone: "bg-shipped/12 text-shipped", icon: CheckCircle },
}

const VENDOR_NAMES: Record<string, string> = { pinkdesign: "Pink Design" }
const vendorLabel = (v?: string | null) => (v ? VENDOR_NAMES[v] ?? v : "")

/**
 * The design-partner chip + action for ONE line item, for use on any factory board row.
 *
 * Two states, and the distinction is the point:
 *
 *   • nothing sent  → no chip at all, and the action lives under a "…" menu. Most artwork
 * arrives print-ready and never goes out, so a permanent button on every row would be
 * noise on the majority of lines to serve the minority.
 *   • sent          → a chip naming WHO has it and where it is, always visible. Once a
 * line's artwork is on someone else's board that's load-bearing information: it says
 * why the line isn't moving and who to chase.
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
  const tl = useLabelT()
 const [pushOpen, setPushOpen] = useState(false)
 const sent = !!state?.vendor
 const lane = state?.col ? LANE[state.col] : undefined
 const Icon = lane?.icon

  /**
   * WHY THIS CANNOT BE SENT — decided before the window opens, not inside it.
   *
   * Every one of these failed AFTER the dialog was up: it loaded, offered a form, and then
   * either refused on submit or sent something that could not be worked on. A menu item
   * that opens a window which cannot succeed is worse than a disabled one, because the
   * person has already committed to the task by the time it says no.
   *
   * Order matters — the first true reason is the one shown, and they are ordered by what
   * the reader can act on. "Already sent" is about this line and is checked first; "not
   * configured" is about the whole install and would otherwise mask the line's own problem
   * on every row at once.
   */
 const [pinkOk, setPinkOk] = useState<boolean | null>(null)
 useEffect(() => {
 let live = true
 const t = setTimeout(() => {
 getPinkStatus().then((s) => { if (live) setPinkOk(!!s.configured) }).catch(() => { if (live) setPinkOk(false) })
    }, 0)
 return () => { live = false; clearTimeout(t) }
  }, [])

  /* Artwork is what Pink work ON. A line with no stored design and no picture of its own
 has nothing to send, and the dialog's own message for this asked the person to attach
 the file they were already looking at. */
 const hasArtwork = !!(artworkUrl || lineImage)
  /* An embroidered line goes to Pink to be DIGITISED, so having no machine file is the
 reason to send it, not a reason to refuse. A print line needs artwork and nothing else.
     Either way the block below is about what is missing, never about the method. */
 const blocker =
 sent ? `Already with ${vendorLabel(state?.vendor)}`
 : !hasArtwork ? "No artwork on this line yet"
 : pinkOk === false ? "Design partner isn't set up"
 : pinkOk === null ? "Checking the design partner…"
 : null

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
 aria-label={tl("itemDesignActions", "Design actions")}
          >
            <DotsThree size={16} weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{tl("itemDesignActions", "Design")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setPushOpen(true)} disabled={!!blocker}>
                <PaperPlaneTilt size={14} />
                {/* The blocker IS the label. A greyed "Send to design partner" says it
 cannot be pressed and not one word about why, which on a row that looks
 identical to the one above it is the most annoying kind of disabled. */}
                {blocker ?? tl("itemDesignActions", "Send to design partner")}
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

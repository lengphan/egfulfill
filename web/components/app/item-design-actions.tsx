"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { DotsThree, PaperPlaneTilt, CheckCircle, Eye, Clock, CircleNotch, Kanban } from "@phosphor-icons/react"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { PushToPartnerDialog } from "@/components/app/push-to-partner-dialog"
import { assignDesignCard, createDesignCard, getPinkStatus, type OrderDesignStatus } from "@/lib/api"

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
 * The design chip + actions for ONE line item, for use on any factory board row.
 *
 * TWO DESTINATIONS, AND OUR OWN BOARD IS THE DEFAULT ONE.
 *
 * This offered exactly one action — "Send to design partner" — which posted the line
 * straight out to Pink Design. That is the rare route: the common one is an embroidered
 * line that arrives as a PNG and has to be DIGITISED, and digitising is what our own
 * designer board exists for. Sending it outside instead means paying a third party for
 * work the digitising queue was about to pick up, and the line then reads "with Pink
 * Design" on every board while nobody here is watching it.
 *
 * So the menu now names both, in the order they are actually used: Send to Board (ours),
 * then the partner, named for WHO it is rather than as a generic "partner" — the choice
 * is between two places, and "partner" only tells you it is the one that isn't us.
 *
 * The chip follows the same split. It used to render only when a VENDOR held the line, so
 * a card sitting in our own Incoming lane showed nothing at all here and the row looked
 * untouched — which is how a line gets sent twice.
 */
export function ItemDesignActions({
 orderId, sku, lineId, itemName, qty, printType, artworkUrl, lineImage, state, onChanged,
}: {
 orderId: string
 sku: string
  /** The line, not the sku — two lines of the same sku are two jobs, and a card assigned
   *  by sku alone lands on whichever of them the server sees first. */
 lineId?: string | null
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
 const [sending, setSending] = useState(false)
 const [err, setErr] = useState<string | null>(null)
  /** Held by an OUTSIDE vendor, versus sitting on our own board. Both are "a card exists
   *  for this line"; only one of them is somebody else's queue. */
 const withVendor = !!state?.vendor
 const onBoard = !!state?.cardId && !withVendor
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

  /* Artwork is what a designer works ON. A line with no stored design and no picture of its
 own has nothing to send, and the dialog's own message for this asked the person to attach
 the file they were already looking at. */
 const hasArtwork = !!(artworkUrl || lineImage)
  /* An embroidered line is sent to be DIGITISED, so having no machine file is the reason to
 send it, not a reason to refuse. A print line needs artwork and nothing else. Either way
 the blocks below are about what is missing, never about the method. */
 const boardBlocker =
 onBoard ? `Already on the board${lane ? ` · ${lane.label}` : ""}`
 : withVendor ? `Already with ${vendorLabel(state?.vendor)}`
 : !hasArtwork ? "No artwork on this line yet"
 : null
 const partnerBlocker =
 withVendor ? `Already with ${vendorLabel(state?.vendor)}`
 : onBoard ? "Already on the board"
 : !hasArtwork ? "No artwork on this line yet"
 : pinkOk === false ? "Pink Design isn't set up"
 : pinkOk === null ? "Checking Pink Design…"
 : null

  /**
   * OUR OWN BOARD, in the two calls the designer window already uses.
   *
   * Create then assign, never one call: a card that exists but is attached to nothing shows
   * on the board with no order behind it, which is worse than no card. It lands in
   * `incoming` because that is where a designer LOOKS for new work — a card filed straight
   * into "in progress" starts in a lane nobody is watching, already claimed by no one.
   */
 const sendToBoard = async () => {
 setSending(true); setErr(null)
 try {
 const card = await createDesignCard({
 title: itemName || sku || "Design",
 data: artworkUrl || lineImage || undefined,
 sku: sku || undefined,
 col: "incoming",
      })
 if (card.error) throw new Error(card.error)
 if (card.id) {
 const a = await assignDesignCard(String(card.id), { orderId, sku, lineId: lineId || undefined })
 if ((a as { error?: string })?.error) throw new Error(String((a as { error?: string }).error))
      }
 onChanged?.()
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't send this line to the board.")
    } finally { setSending(false) }
  }

 return (
    <>
      <div className="flex items-center gap-1.5">
        {/* WHO HAS IT, once anyone does. Named differently for the two destinations because
            they are chased differently: one is a lane on a board down the hall, the other is
            an invoice and an email. */}
        {(onBoard || withVendor) && (
          <span
 className={"inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium " + (lane?.tone ?? "bg-muted text-muted-foreground")}
 title={withVendor
              ? `${vendorLabel(state?.vendor)}${state?.vendorRef ? ` · task ${state.vendorRef}` : ""}`
 : tl("itemDesignActions", "On our design board")}
          >
            {Icon && <Icon size={11} weight="fill" />}
            {withVendor ? vendorLabel(state?.vendor) : tl("itemDesignActions", "Design board")}{lane ? ` · ${lane.label}` : ""}
          </span>
        )}
        {/* A refusal carries its reason; nothing else here writes a sentence. */}
        {err && <span className="text-xs text-alert">{err}</span>}
        {/* Tucked away, not on the row. The overwhelming majority of lines never need
 this, and a button that's usually wrong to press is worse than one click. */}
        <DropdownMenu>
          <DropdownMenuTrigger
 className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
 aria-label={tl("itemDesignActions", "Design actions")}
          >
            {sending ? <CircleNotch size={16} className="animate-spin" /> : <DotsThree size={16} weight="bold" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{tl("itemDesignActions", "Design")}</DropdownMenuLabel>
              {/* OURS FIRST. An embroidered line that arrived as an image is digitising
 work, and digitising is this board's whole job. */}
              <DropdownMenuItem onClick={() => void sendToBoard()} disabled={!!boardBlocker || sending}>
                <Kanban size={14} />
                {/* The blocker IS the label. A greyed item says it cannot be pressed and
 not one word about why, which on a row that looks identical to the one
 above it is the most annoying kind of disabled. */}
                {boardBlocker ?? tl("itemDesignActions", "Send to Board")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPushOpen(true)} disabled={!!partnerBlocker || sending}>
                <PaperPlaneTilt size={14} />
                {partnerBlocker ?? tl("itemDesignActions", "Send to Pink Design")}
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

import type { OrderItem } from "@/lib/api"
import { decodeEntities } from "@/lib/order-format"

/**
 * WHAT THE CUSTOMER ACTUALLY ORDERED, kept on screen while you pick the blank.
 *
 * There are two different "variants" on a marketplace line and they were easy to confuse:
 *
 *   - `variantOf(it)` — OUR choice. The colour, size and print method someone picks here to
 *     decide what gets made. Empty on a marketplace order until a human fills it in.
 *   - `it.variant` — THEIR choice. The options the buyer selected on the listing, exactly as
 *     the marketplace recorded them ("Color: Icing, Type: 1 Logo + 1 Text").
 *
 * Only the first was ever shown, so the screen where you choose a blank had the pickers and
 * none of the information needed to choose correctly — the answer was on Etsy, in another
 * tab. This is the second one, printed under the title and STAYING there through the picking
 * step, because its whole value is being read side by side with what you are selecting.
 *
 * Renders nothing when the line carries neither, so a manual order gains no empty strip.
 */
export function OrderedVariant({ item, className = "" }: { item: OrderItem; className?: string }) {
  // Entities arrive HTML-encoded from the marketplaces (&amp;, &#39;) — the same decode the
  // order title gets, or "Men&#39;s" is what a packer reads.
  const ordered = decodeEntities(String(item.variant ?? "").trim())
  const personal = decodeEntities(String(item.personalization ?? "").trim())
  if (!ordered && !personal) return null

  return (
    <div className={"mt-0.5 space-y-0.5 text-xs leading-snug " + className}>
      {ordered && (
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground/70">Ordered:</span> {ordered}
        </div>
      )}
      {/* Personalisation is a LITERAL to reproduce — shown in mono and unquoted, so a
          trailing space or a quote mark the buyer typed is visible rather than styled away.
          Same rule the customer-file panel already follows. */}
      {personal && (
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground/70">Personalisation:</span>{" "}
          <span className="font-mono">{personal}</span>
        </div>
      )}
    </div>
  )
}

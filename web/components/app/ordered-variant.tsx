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
 * Personalisation is NOT repeated here: the order panel above already prints it once, and a
 * copy under every line turns a four-line order into the same sentence four times. The
 * listing SKU takes that slot instead — it is what a customer query or a marketplace message
 * will quote, and it is not the blank sku we buy against.
 *
 * Renders nothing when the line carries neither, so a manual order gains no empty strip.
 */
export function OrderedVariant({ item, className = "" }: { item: OrderItem; className?: string }) {
  // Entities arrive HTML-encoded from the marketplaces (&amp;, &#39;) — the same decode the
  // order title gets, or "Men&#39;s" is what a packer reads.
  const ordered = decodeEntities(String(item.variant ?? "").trim())
  // The LISTING sku — the seller's own code for the thing sold, which is what a marketplace
  // message or a customer query will quote. Distinct from the blank sku we buy against, and
  // carrying the print-method suffix the listing was sold under.
  const sku = String(item.sku ?? "").trim()
  // QUANTITY BELONGS WITH THE LINE, not only on the chip row that appears once a blank is
  // picked. Before a blank is chosen — which is exactly when someone is reading this strip
  // to decide — the count was nowhere on screen, and "how many" is the first thing you need
  // in order to pull stock.
  //
  // ALWAYS SHOWN, including x1. Hiding it at one made the field's absence ambiguous —
  // "one of these" and "nobody has told me" looked identical — and a picker scanning a
  // multi-line order needs a number on every row to count against.
  const qty = Math.max(1, Number(item.qty) || 1)
  if (!ordered && !sku) return null

  return (
    <div className={"mt-0.5 space-y-0.5 text-xs leading-snug " + className}>
      {ordered && (
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground/70">Ordered:</span> {ordered}
        </div>
      )}
      {/* Personalisation is deliberately NOT repeated here — the order panel above already
          prints it once, in full, and a second copy under every line turns a four-line order
          into the same sentence four times. */}
      {sku && (
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground/70">Listing SKU:</span>{" "}
          <span className="font-mono">{sku}</span>
        </div>
      )}
      {/* Its own labelled line, reading like the two above it rather than a bare xN tacked
          onto the end of one. Emphasised past one so a 6 catches the eye where a 1 should
          not — but always present, because an absent count and a count of one must never
          look the same to someone pulling stock. */}
      <div className="text-muted-foreground">
        <span className="font-medium text-foreground/70">Quantity:</span>{" "}
        <span className={qty > 1 ? "font-semibold text-foreground" : ""}>{qty}</span>
      </div>
    </div>
  )
}

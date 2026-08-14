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
export function OrderedVariant({ item, className = "", after }: { item: OrderItem; className?: string; after?: React.ReactNode }) {
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

  /**
   * ONE WRAPPING LINE, not three stacked ones.
   *
   * These are three short values whose LABELS are longer than their data, and as full-width
   * rows they cost ~34px of height on every line of every expanded order — which in turn was
   * what forced the thumbnail up to 136px to avoid a half-empty left column. Inline, they
   * read as one sentence about the line and wrap only when the width genuinely runs out.
   *
   * The labels STAY. "Listing SKU" is not the blank sku we buy against (CLAUDE.md §5), and a
   * bare mono string next to a size and a count is exactly the ambiguity that distinction
   * exists to prevent.
   *
   * Personalisation is still deliberately absent — the order panel above prints it once, in
   * full, and a copy under every line turns a four-line order into the same sentence four
   * times.
   */
  const parts: React.ReactNode[] = []
  if (ordered) parts.push(<span key="o"><span className="font-medium text-foreground/70">Ordered:</span> {ordered}</span>)
  if (sku) parts.push(<span key="s"><span className="font-medium text-foreground/70">Listing SKU:</span> <span className="font-mono">{sku}</span></span>)
  // ALWAYS PRESENT, including x1. An absent count and a count of one must never look the
  // same to someone pulling stock. Emphasised past one so a 6 catches the eye where a 1
  // should not.
  parts.push(
    <span key="q">
      <span className="font-medium text-foreground/70">Qty</span>{" "}
      <span className={qty > 1 ? "font-semibold text-foreground" : ""}>{qty}</span>
    </span>
  )

  // Anything the caller wants on the end of the line — the stock pill sits here, next to
  // Qty, because the two are read together: how many we need, how many we hold.
  if (after) parts.push(<span key="a">{after}</span>)

  return (
    <div className={"mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-snug text-muted-foreground " + className}>
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-baseline gap-2">
          {i > 0 && <span aria-hidden className="text-border">·</span>}
          {p}
        </span>
      ))}
    </div>
  )
}

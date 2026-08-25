"use client"

import { useLabelT } from "@/lib/i18n"
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
export function OrderedVariant({ item, className = "", after, blankSku }: {
  item: OrderItem
  className?: string
  after?: React.ReactNode
  /**
   * The BLANK we buy against, resolved by a caller that has the catalogue.
   *
   * A manual order has one name and no listing variant — no "Ordered" line, and often no
   * listing sku either — so this whole strip returned null and took Qty and the stock
   * reading with it. The identifiers a manual line does have are the blank and the count,
   * and those are exactly what someone pulling stock needs.
   *
   * Labelled separately from "Listing SKU" on purpose (CLAUDE.md §5): one is the seller's
   * code for what was sold, the other is the garment we buy. A bare mono string beside a
   * size and a count is the ambiguity that distinction exists to prevent.
   */
  blankSku?: string | null
}) {
  const tl = useLabelT()
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
  /** What a manual line offers instead of a listing sku: the blank itself. `blank` is a
   *  product NAME on most real lines, so a resolved sku from the caller wins when there is
   *  one. */
  const blank = String(blankSku ?? "").trim() || String(item.blank ?? "").trim()
  // NO EARLY RETURN. It used to bail when there was neither a variant nor a listing sku —
  // which is every manual order — and that took Qty and the stock reading off the row with
  // it. Every line has a quantity, and the whole point of showing it always is that its
  // absence must never be ambiguous.

  /**
   * TWO ROWS: what they ordered, then how we refer to it.
   *
   * This was ONE wrapping line — Ordered · Listing SKU · Qty — on the reasoning that three
   * short values whose labels outrun their data read better as a sentence than as a stack.
   * That reasoning holds only while the values are short, and `ordered` is not one of them:
   * a personalised listing puts a paragraph in it ("Apron w/ Name, Ink, 1. Caitlin, Sarah,
   * Kailey, Valerie, Kristie, Ashley, Amber, Erica, Jess 2. cream 3. #7"). It wrapped, and
   * the separator dots landed at the START of the following lines, so the SKU and the count
   * — the two things you scan for — were wherever the buyer's text happened to stop.
   *
   * So the buyer's words get their own row and are allowed to be as long as they are, and
   * the identifiers sit on a fixed second row where the eye can find them without reading
   * the first. Still two rows, not four: the sku and the count are short and belong
   * together, which was the original insight and is kept.
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
  if (sku) parts.push(<span key="s"><span className="font-medium text-foreground/70">{tl("orderedVariant", "Listing SKU:")}</span> <span className="tabular-nums">{sku}</span></span>)
  // The blank stands in where there is no listing sku — a manual line — and sits beside it
  // where there is one, because they are different codes for different things.
  /**
   * THE BLANK'S SKU, not its title.
   *
   * `blank` holds a product NAME — the server's own resolveBlankName writes the name into
   * it — so this line printed "Gildan Unisex Heavy Blend™ Crewneck Sweatshirt" under a row
   * whose heading is already the item's title. Two long names stacked, and neither of them
   * the code anyone picks stock or raises a PO against.
   *
   * The caller resolves the catalog row and hands the sku down; the name stays as the
   * tooltip, so nothing is lost — it moves to where a long string belongs. Falls back to
   * the name when the blank matches no catalog product, because saying nothing there would
   * hide that the line has a blank at all.
   */
  if (blankSku || blank) parts.push(
    <span key="b" title={blank || undefined}>
      <span className="font-medium text-foreground/70">{tl("orderedVariant", "Blank SKU:")}</span>{" "}
      <span className="tabular-nums">{blankSku || blank}</span>
    </span>
  )
  // ALWAYS PRESENT, including x1. An absent count and a count of one must never look the
  // same to someone pulling stock. Emphasised past one so a 6 catches the eye where a 1
  // should not.
  parts.push(
    <span key="q">
      <span className="font-medium text-foreground/70">{tl("orderedVariant", "Qty")}</span>{" "}
      <span className={qty > 1 ? "font-semibold text-foreground" : ""}>{qty}</span>
    </span>
  )

  // Anything the caller wants on the end of the line — the stock pill sits here, next to
  // Qty, because the two are read together: how many we need, how many we hold.
  if (after) parts.push(<span key="a">{after}</span>)

  return (
    <div className={"mt-0.5 space-y-0.5 text-xs leading-snug text-muted-foreground " + className}>
      {ordered && (
        <div>
          <span className="font-medium text-foreground/70">{tl("orderedVariant", "Ordered:")}</span> {ordered}
        </div>
      )}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {parts.map((p, i) => (
          <span key={i} className="inline-flex items-baseline gap-2">
            {i > 0 && <span aria-hidden className="text-border">·</span>}
            {p}
          </span>
        ))}
      </div>
    </div>
  )
}

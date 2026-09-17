/**
 * SENDING A LINE TO THE DESIGNER BOARD — the one definition.
 *
 * This lived as sixty lines inside orders-hub.tsx. The order detail page needs the same act,
 * and CLAUDE.md §5 is explicit about what happens next if it is copied: "Private copies of
 * these have been found in three separate files. Import, don't re-implement." The rules it
 * carries are not incidental either — every one of them cost something:
 *
 *   • A card with no artwork is an empty job. There is nothing to digitise and no way to tell
 *     what it should become, so it is refused with a REASON. It used to be a bare `return`,
 *     and the commonest way to reach it was a real push with a real file: no card, no error,
 *     indistinguishable from the board being broken.
 *   • Before spending a designer, ask whether we have already made this file. An exact hit is
 *     identical artwork; a fuzzy hit only LOOKS alike. §6: perceptual matches SUGGEST, a human
 *     confirms — so both come back to the caller to show, never acted on here.
 *   • The board is saved whole, and every card carries a base64 thumbnail, so the payload
 *     grows with the board. The result is checked: `api` resolves with {error} rather than
 *     throwing, and awaiting without looking swallowed a rejected save.
 *
 * IT RETURNS A RESULT RATHER THAN DRIVING A UI. Two callers render this completely
 * differently — a board-wide hub with a modal, and a tab on one order — and a function that
 * called setState on either would only fit the one it was written in.
 */
import {
  getDesignCards, saveDesignCards, getDesignReuse, designForLine,
  type DesignCard, type OrderItem, type OrderDesign,
} from "@/lib/api"
import { variantOf } from "@/lib/order-format"

export type BoardSendResult =
  | { status: "sent" }
  /** Already on the board. Not an error — pressing twice is how people check. */
  | { status: "duplicate" }
  | { status: "no-art" }
  /** We may already have made this. The caller shows these and offers `force`. */
  | { status: "reuse"; exact: Awaited<ReturnType<typeof getDesignReuse>>["exact"]; similar: Awaited<ReturnType<typeof getDesignReuse>>["similar"] }
  | { status: "error"; message: string }

/**
 * THE ARTWORK A CARD WOULD CARRY, or "".
 *
 * Placed artwork first, keyed on the LINE — two lines of the same sku are different jobs.
 *
 * `design_src` is whatever the marketplace put in an upload-looking variation, and Etsy's
 * match is loose enough to catch the LISTING photo (etsy.js: any http URL under a variation
 * named /upload|logo|file|image|photo|art|design/). A product shot is not artwork — there is
 * nothing in it to digitise — so it is used only when it differs from the line's own image.
 */
export function boardArtworkFor(
  designs: Record<string, OrderDesign> | undefined,
  it: OrderItem,
): string {
  const placed = designForLine(designs, it)?.data
  if (placed) return placed
  const src = it.design_src || ""
  return src && src !== (it.img || "") ? src : ""
}

/** Is this line already on the board? Line first, sku as the pre-line_id fallback. */
export function onBoard(cards: DesignCard[] | undefined, orderId: string, it: OrderItem): DesignCard | undefined {
  return (cards ?? []).find((c) =>
    c.order_id === orderId && (it.line_id ? c.line_id === it.line_id : !c.line_id && c.sku === it.sku))
}

export async function sendLineToBoard(
  order: { id: string; customer?: { name?: string | null } | null },
  it: OrderItem,
  opts: { art: string; force?: boolean } ,
): Promise<BoardSendResult> {
  const art = opts.art
  if (!art) return { status: "no-art" }

  if (!opts.force && it.sku) {
    try {
      const r = await getDesignReuse(order.id, it.sku, it.line_id ?? undefined)
      if (r && (r.exact.length || r.similar.length)) {
        return { status: "reuse", exact: r.exact, similar: r.similar }
      }
    } catch { /* the lookup is an optimisation — never block the push on it */ }
  }

  try {
    const cards = await getDesignCards().catch(() => [])
    if (onBoard(cards ?? [], order.id, it)) return { status: "duplicate" }
    const card: DesignCard = {
      id: Date.now(), order_id: order.id, sku: it.sku || undefined, line_id: it.line_id,
      title: it.name || it.sku || "Design", product: variantOf(it),
      /* The ARTWORK, not the listing photo — a designer needs to see the file they are
         digitising, not a product shot. */
      type: it.print_type || undefined, thumb: art || null,
      col: "incoming", pay_status: "pending", payment: 0,
      customer: order.customer?.name ?? null, is_emb: /emb/i.test(it.print_type || ""),
    }
    const r = await saveDesignCards([...(cards ?? []), card])
    if (r?.error) throw new Error(r.error)
    return { status: "sent" }
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "unknown error" }
  }
}

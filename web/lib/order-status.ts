/**
 * THE WEB'S FACE ON THE SELLER VOCABULARY.
 *
 * The words, the groups and the filters moved to `@/shared/order-status` so the phone reads
 * the same ones — see the note at the top of that file. What stays here is the one thing
 * that is genuinely web-only: turning a register into Tailwind classes. Every existing
 * import of this module keeps working unchanged, which is why the move is a re-export rather
 * than a rename.
 */
import { STATUS_TONE } from "@/lib/status-tone"
import { sellerStatus as vocabulary, type SellerStatus } from "@/shared/order-status"

export { SELLER_FILTERS, matchesFilter } from "@/shared/order-status"
export type { SellerGroup, SellerFilter } from "@/shared/order-status"

export type SellerStatusInfo = { label: string; tone: string; group: SellerStatus["group"] }

/* `delivery_status` rides through: the shared vocabulary hands the column to the carrier
   once a parcel exists, and a narrower signature here would quietly drop it — the caller
   passes a whole order, so the field is already there and only the type was in the way. */
export function sellerStatus(
  o: { factory_status?: string | null; status?: string | null; delivery_status?: string | null },
): SellerStatusInfo {
  const s = vocabulary(o)
  return { label: s.label, tone: STATUS_TONE[s.register], group: s.group }
}

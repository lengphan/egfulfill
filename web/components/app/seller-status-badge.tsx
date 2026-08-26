import { sellerStatus } from "@/lib/order-status"

/** Renders an order's canonical seller-facing status (SELLER_STATUS mapping). */
export function SellerStatusBadge({ order }: { order: { factory_status?: string | null; status?: string | null } }) {
  const s = sellerStatus(order)
  // Not a Badge any more. `variant="secondary"` painted a filled capsule behind the word,
  // which is the chrome this treatment removes. Badge itself is untouched — its other uses
  // carry meaning a pill should carry: a print method, RUSH, an HTTP verb.
  return <span className={"text-xs " + s.tone}>{s.label}</span>
}

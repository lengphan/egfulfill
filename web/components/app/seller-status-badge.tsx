import { sellerStatus } from "@/lib/order-status"

/** Renders an order's canonical seller-facing status (SELLER_STATUS mapping). */
export function SellerStatusBadge({ order }: { order: { factory_status?: string | null; status?: string | null } }) {
  const s = sellerStatus(order)
  // Not a Badge any more. `variant="secondary"` painted a filled capsule behind the word,
  // which is the chrome this treatment removes. Badge itself is untouched — its other uses
  // carry meaning a pill should carry: a print method, RUSH, an HTTP verb.
  //
  // NO SIZE OF ITS OWN. It carried text-xs, so a status sat 12px against the 14px of every
  // other cell in its row — the second thing you scan, set smaller than the store name.
  // The tone already says everything this needs to say (weight and ink, see status-tone.ts);
  // the size belongs to whatever row it lands in.
  return <span className={s.tone}>{s.label}</span>
}

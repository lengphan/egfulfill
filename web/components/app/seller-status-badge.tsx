import { Badge } from "@/components/ui/badge"
import { sellerStatus } from "@/lib/order-status"

/** Renders an order's canonical seller-facing status (SELLER_STATUS mapping). */
export function SellerStatusBadge({ order }: { order: { factory_status?: string | null; status?: string | null } }) {
  const s = sellerStatus(order)
  return (
    <Badge variant="secondary" className={s.tone}>
      {s.label}
    </Badge>
  )
}

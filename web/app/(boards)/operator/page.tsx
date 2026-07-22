import { OrdersHub } from "@/components/app/orders-hub"
import { FullBleed } from "@/components/app/full-bleed"

export default function OrdersPage() {
  return (
    <FullBleed reason="Orders hub — a 5-column data grid per row; the room is the point.">
      <OrdersHub />
    </FullBleed>
  )
}

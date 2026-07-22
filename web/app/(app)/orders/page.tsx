import { OrdersList } from "@/components/app/orders-list"
import { FullBleed } from "@/components/app/full-bleed"

export default function OrdersPage() {
  return (
    <FullBleed reason="Orders table — capping it brings back horizontal scroll.">
      <OrdersList />
    </FullBleed>
  )
}

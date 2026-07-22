import { OrdersHub } from "@/components/app/orders-hub"
import { FullBleed } from "@/components/app/full-bleed"

// Legacy route — the warehouse board is now the unified Orders hub.
export default function WarehousePage() {
  return (
    <FullBleed reason="Orders hub — a 5-column data grid per row; the room is the point.">
      <OrdersHub />
    </FullBleed>
  )
}

import { OrdersConsole } from "@/components/app/orders-console"

// Legacy route — the warehouse board is the unified Orders hub, in the same shell the
// canonical /production route uses. Two entrances, one page.
export const metadata = { title: "Orders · EGFUL" }

export default function WarehousePage() {
  return <OrdersConsole />
}

import { ShipmentsView } from "@/components/app/shipments-view"
import { FullBleed } from "@/components/app/full-bleed"

export const metadata = { title: "Shipments · EGFULFILL" }

export default function ShipmentsPage() {
  return (
    <FullBleed reason="Shipment table — capping it brings back horizontal scroll.">
      <ShipmentsView />
    </FullBleed>
  )
}

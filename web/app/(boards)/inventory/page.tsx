import { InventoryView } from "@/components/app/inventory-view"
import { FullBleed } from "@/components/app/full-bleed"

export default function InventoryPage() {
  return (
    <FullBleed reason="Stock table with its own overflow-x — a narrower column scrolls sooner.">
      <InventoryView />
    </FullBleed>
  )
}

import { SuppliersView } from "@/components/app/suppliers-view"
import { FullBleed } from "@/components/app/full-bleed"

export default function SuppliersPage() {
  return (
    <FullBleed reason="Supplier blank browse — a 4-up product grid, not prose.">
      <SuppliersView />
    </FullBleed>
  )
}

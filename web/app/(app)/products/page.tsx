import { ProductsCatalog } from "@/components/app/products-catalog"
import { FullBleed } from "@/components/app/full-bleed"

export default function ProductsPage() {
  return (
    <FullBleed reason="Catalog card grid, 4-up at xl — capping it drops a column.">
      <ProductsCatalog />
    </FullBleed>
  )
}

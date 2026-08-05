import { BoldCatalog } from "@/components/marketing/bold-catalog"
import { getPublicProducts } from "@/lib/api"

export const metadata = { title: "Products — EGFULFILL" }
// Re-read periodically rather than baking the catalogue into the build: publishing a product
// should put it on the marketing site without a redeploy.
export const revalidate = 300

export default async function CatalogPage() {
  // A catalogue that can't be read must not take the page down with it — an empty list
  // renders the honest "nothing published yet" state instead of a 500.
  const products = await getPublicProducts()
    .then((r) => r.products ?? [])
    .catch(() => [])
  return <BoldCatalog products={products} />
}

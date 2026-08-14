import { BoldCatalog } from "@/components/marketing/bold-catalog"
import { getPublicProducts } from "@/lib/api"

export const metadata = { title: "Products — EGFUL" }
// Re-read periodically rather than baking the catalogue into the build: publishing a product
// should put it on the marketing site without a redeploy.
export const revalidate = 300

export default async function CatalogPage() {
  // A catalogue that can't be read must not take the page down with it — but it must not
  // claim "nothing is published" either. Those are different facts and the page now says
  // WHICH: null means the read failed, [] means the catalogue is genuinely empty.
  //
  // Collapsing both into [] is what let this page report an empty catalogue while the API
  // was returning products perfectly well — the error was real, and the empty state hid it.
  let products: Awaited<ReturnType<typeof getPublicProducts>>["products"] | null = null
  // The parcel is part of the price, so it travels with the products rather than being
  // fetched again by the component — one read, one source, no chance of the grid and the
  // shipping line disagreeing.
  let shipping: { first: number; extra: number } | null = null
  try {
    const r = await getPublicProducts()
    products = r.products ?? []
    shipping = r.shipping ?? null
  } catch {
    products = null
  }
  return <BoldCatalog products={products} shipping={shipping} />
}

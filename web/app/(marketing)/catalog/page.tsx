import { PloyProducts } from "@/components/marketing/ploy/products"
import { getPublicProducts } from "@/lib/api"
import { getSiteContent } from "@/lib/site-content"

export const metadata = { title: "Products — EGFUL" }
// Re-read periodically rather than baking the catalogue into the build: publishing a product
// should put it on the marketing site without a redeploy.
export const revalidate = 300

export default async function CatalogPage() {
  // A catalogue that can't be read must not take the page down with it — but it must not
  // claim "nothing is published" either. Those are different facts and the page says WHICH:
  // null means the read failed, [] means the catalogue is genuinely empty. Collapsing both
  // into [] is what once had this page reporting an empty catalogue while the API answered.
  let products: Awaited<ReturnType<typeof getPublicProducts>>["products"] | null = null
  // The extra-item fee travels with the products, from the same read. A failure costs the
  // postage line inside an open product, never the catalogue.
  let shipping: { extra: number } | null = null
  try {
    const r = await getPublicProducts()
    products = r.products ?? []
    shipping = r.shipping ? { extra: r.shipping.extra } : null
  } catch {
    products = null
  }
  const content = await getSiteContent()
  const head = content.catalogPage
  return (
    <PloyProducts
      products={products}
      shipping={shipping}
      /* The stored PageHead — `title` / `accent` / `sub`, the same three the old design read.
         Falls back only when a field is blank, so an admin's copy always wins. */
      headline={head.title || "What we"}
      accent={head.accent || "can make."}
      lead={head.sub || "Printed, stitched or pressed on our own floor — pick a garment, place the artwork once, and we make it to order."}
    />
  )
}

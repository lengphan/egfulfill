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
  // null means the read failed, [] means the catalogue is genuinely empty.
  //
  // Collapsing both into [] is what let this page report an empty catalogue while the API
  // was returning products perfectly well — the error was real, and the empty state hid it.
  let products: Awaited<ReturnType<typeof getPublicProducts>>["products"] | null = null
  try {
    products = (await getPublicProducts()).products ?? []
  } catch {
    products = null
  }
  const content = await getSiteContent()
  const head = content.catalogPage
  return (
    <PloyProducts
      products={products}
      /* The stored PageHead — `title` / `accent` / `sub`, the same three the old design read.
         Falls back only when a field is blank, so an admin's copy always wins. */
      headline={head.title || "What we"}
      accent={head.accent || "can make."}
      lead={head.sub || "Live from our catalogue — every product here is one you can order today, at the price shown."}
    />
  )
}

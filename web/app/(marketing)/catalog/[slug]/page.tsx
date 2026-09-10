import { notFound } from "next/navigation"
import { PloyProducts } from "@/components/marketing/ploy/products"
import { getPublicProducts } from "@/lib/api"
import { getSiteContent } from "@/lib/site-content"

// Same window as the grid: publishing a product should reach the marketing site without a
// redeploy, and the two pages should not disagree about what is published.
export const revalidate = 300

/**
 * ONE PRODUCT, ON THE CATALOGUE PAGE — not a page of its own.
 *
 * This used to render `BoldProduct`, a second, complete product page built in the old
 * bold-kit: its own hero, its own picker column, its own full-bleed violet artwork plate.
 * Two designs for one product, and which one you saw depended on how you arrived — click a
 * tile and the catalogue opened it in place, follow the same product's LINK and the site
 * changed shape around you.
 *
 * So the route renders the catalogue with the product already open. The behaviour is now
 * identical whichever way you got here, and there is one component to change when the
 * product shape changes rather than two that drift.
 *
 * `BoldProduct` is NOT deleted: /preview/placement still drives it as a fixture. A
 * component with a live call site is not dead, and removing it would break that page.
 *
 * WHAT THIS KEEPS from the old route, because they were doing real work:
 *   generateStaticParams  the published slugs are pre-rendered, so the common case ships
 *                         static HTML instead of making the first visitor wait on an API
 *                         call through Vercel.
 *   generateMetadata      the tab and the share card still name the product.
 *   notFound()            an unpublished or unknown slug is still a 404.
 */
export async function generateStaticParams() {
  try {
    const { products } = await getPublicProducts()
    return (products ?? []).map((p) => ({ slug: p.slug })).filter((p) => !!p.slug)
  } catch {
    // A catalogue fetch is not a reason to fail a deploy — the pages fall back to
    // on-demand, which is what they did before this existed.
    return []
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const { products } = await getPublicProducts()
    const p = (products ?? []).find((x) => x.slug === slug)
    return { title: p ? `${p.name} — EGFUL` : "Products — EGFUL" }
  } catch {
    // Metadata must never be the thing that takes a page down, and it must not invent a
    // name for a product it could not read.
    return { title: "Products — EGFUL" }
  }
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  /**
   * THREE OUTCOMES, KEPT APART — the same three the old route was careful about.
   *
   *   read fails    NOT a 404. "We couldn't reach our catalogue" is a different sentence
   *                 from "this product doesn't exist", and showing the second when the
   *                 first is true is how a broken deploy gets mistaken for an unpublished
   *                 product. `products: null` is the page's own read-failure state.
   *   not found     notFound(). Unpublished and never-existed are deliberately not told
   *                 apart, here or in the API.
   *   found         the catalogue, with it open.
   */
  let products: Awaited<ReturnType<typeof getPublicProducts>>["products"] | null = null
  let shipping: { extra: number } | null = null
  try {
    const r = await getPublicProducts()
    products = r.products ?? []
    shipping = r.shipping ? { extra: r.shipping.extra } : null
  } catch {
    products = null
  }

  if (products && !products.some((p) => p.slug === slug)) notFound()

  const content = await getSiteContent()
  const head = content.catalogPage
  return (
    <PloyProducts
      products={products}
      shipping={shipping}
      /* The read failed, so we cannot say this slug is real — open nothing and let the
         page print its own "couldn't be loaded" rather than a panel for a product we
         never actually saw. */
      initialSlug={products ? slug : null}
      headline={head.title || "What we"}
      accent={head.accent || "can make."}
      lead={head.sub || "Printed, stitched or pressed on our own floor — pick a garment, place the artwork once, and we make it to order."}
    />
  )
}

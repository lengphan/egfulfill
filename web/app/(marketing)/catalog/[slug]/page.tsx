import { notFound } from "next/navigation"
import Link from "next/link"
import { BoldProduct } from "@/components/marketing/bold-product"
import { getPublicProducts } from "@/lib/api"
import { SURFACE } from "@/components/marketing/bold-kit"
import { getPublicProduct, ApiError } from "@/lib/api"

// Same window as the grid: publishing a product should reach the marketing site without a
// redeploy, and the two pages should not disagree about what is published.
export const revalidate = 300

/**
 * PRE-RENDER THE PUBLISHED PRODUCTS.
 *
 * Without this every slug was built ON DEMAND the first time anybody opened it — so the first
 * visitor to each product waited for Vercel to call the API and render before the browser
 * received anything at all, which is a navigation that appears to do nothing for a beat. With
 * it, the common case is a static page that ships immediately; `revalidate` keeps it current
 * and anything published after the build still renders on demand exactly as before.
 *
 * A build-time failure returns NO params rather than throwing: the pages simply fall back to
 * on-demand, which is today's behaviour. A catalogue fetch is not a reason to fail a deploy.
 */
export async function generateStaticParams() {
  try {
    const { products } = await getPublicProducts()
    return (products ?? []).map((p) => ({ slug: p.slug })).filter((p) => !!p.slug)
  } catch {
    return []
  }
}

/**
 * Three outcomes, kept apart on purpose.
 *
 *   found        render it
 *   404          notFound() — the product isn't published, or never existed. The API
 *                deliberately refuses to distinguish those two, so neither does this.
 *   anything     a READ FAILURE. Not a 404, and it must not be dressed as one: "this
 *   else         product doesn't exist" is a different sentence from "we couldn't reach
 *                our catalogue", and showing the first when the second is true is how a
 *                broken deploy gets mistaken for an unpublished product.
 */
async function read(slug: string) {
  try {
    return { product: (await getPublicProduct(slug)).product, failed: false as const }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound()
    return { product: null, failed: true as const }
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const { product } = await getPublicProduct(slug)
    return { title: `${product.name} — EGFUL` }
  } catch {
    // Metadata must never be the thing that takes a page down, and it must not invent a
    // name for a product it couldn't read.
    return { title: "Product — EGFUL" }
  }
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  /**
   * BOTH READS AT ONCE.
   *
   * These ran one after the other — the product, and only once it had landed, the shipping
   * figure — so rendering cost two serial round trips from Vercel to the API before any HTML
   * was sent. They do not depend on each other, so the second was pure waiting.
   *
   * The shipping read keeps its own catch: a failure there must cost the price table, never
   * the product page.
   */
  const [{ product, failed }, shippingRead] = await Promise.all([
    read(slug),
    getPublicProducts().then((r) => r.shipping ?? null).catch(() => null),
  ])

  if (failed || !product) {
    return (
      <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight">We couldn&apos;t load this product</h1>
          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-black/55">
            This is a problem on our side, not a missing product — please try again shortly.
          </p>
          <Link href="/catalog" className="mt-6 inline-block text-base font-semibold underline underline-offset-4">
            Back to all products
          </Link>
        </div>
      </div>
    )
  }

  // The parcel travels with the price, from the same public route the grid uses.
  return <BoldProduct product={product} shipping={shippingRead} />
}

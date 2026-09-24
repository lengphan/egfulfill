"use server"

import { updateTag } from "next/cache"
import { PUBLIC_PRODUCTS_TAG } from "@/lib/api"

/**
 * DROP THE PUBLIC CATALOGUE'S CACHE, NOW.
 *
 * A product set to Staff only left the API immediately and went on being named by the
 * marketing page for up to ten minutes — the fetch caches 300s and the page caches 300s, and
 * they do not overlap. Nothing was ever queryable, but the pre-rendered HTML still showed the
 * garment, which is indistinguishable from a leak to the person looking at it.
 *
 * A SERVER ACTION, NOT AN ENDPOINT. `revalidateTag` only runs inside the Next app, and the
 * Fastify server that owns the save cannot call it — so the alternative was a webhook, which
 * means a public URL, a shared secret, and a rewrite rule to argue with (`/api/*` on this
 * host proxies straight to Fastify). An action has no URL to guess and no secret to rotate:
 * it is reachable only from this app's own pages, which is exactly who saves a product.
 *
 * IT PURGES, IT DOES NOT PUBLISH. Worst case it drops a warm cache and the next visitor
 * pays one fetch — there is nothing here to get wrong twice, which is why it is safe to call
 * on every save rather than only when `status` is the field that moved.
 */
export async function revalidateCatalog() {
  /* `updateTag`, NOT `revalidateTag`. Next 16 split the two: revalidateTag now takes a
     cache-life profile and marks an entry stale, while updateTag is the Server-Action form
     with read-your-own-writes semantics — the next read gets fresh data rather than one more
     stale hit. Setting a product to Staff only and reloading the catalogue is precisely a
     read of your own write. */
  updateTag(PUBLIC_PRODUCTS_TAG)
}

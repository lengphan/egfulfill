"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { PublishProductPage } from "@/components/app/publish-product-page"

/**
 * /publish?d=<draft id>
 *
 * The listing itself is not in the URL — it can carry a composed design as a data: URL and
 * a dozen photos. The board that sent you here stashed all of that in sessionStorage and
 * put only its id in the query string; see lib/publish-draft.ts for why that store and not
 * another.
 *
 * useSearchParams needs a Suspense boundary in the app router, or the whole route opts out
 * of static rendering with a build-time warning.
 */
function PublishRoute() {
  const params = useSearchParams()
  return <PublishProductPage draftId={params.get("d")} />
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PublishRoute />
    </Suspense>
  )
}

import { Suspense } from "react"
import { DesignMaker, DesignMakerFallback } from "@/components/app/design-maker"

export default function DesignMakerPage() {
  return (
    <>
      <Suspense fallback={<DesignMakerFallback />}>
        <DesignMaker />
      </Suspense>
    </>
  )
}

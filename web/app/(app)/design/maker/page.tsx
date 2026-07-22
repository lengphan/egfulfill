import { Suspense } from "react"
import { DesignMaker } from "@/components/app/design-maker"

export default function DesignMakerPage() {
  return (
    <>
      <Suspense fallback={<div className="py-24 text-center text-muted-foreground">Loading maker…</div>}>
        <DesignMaker />
      </Suspense>
    </>
  )
}

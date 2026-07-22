import { Suspense } from "react"
import { DesignMaker } from "@/components/app/design-maker"
import { FullBleed } from "@/components/app/full-bleed"

export default function DesignMakerPage() {
  return (
    <FullBleed reason="Full-height canvas workspace with side panels — the artboard uses every pixel.">
      <Suspense fallback={<div className="py-24 text-center text-muted-foreground">Loading maker…</div>}>
        <DesignMaker />
      </Suspense>
    </FullBleed>
  )
}

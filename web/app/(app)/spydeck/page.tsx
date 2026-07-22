import { SpyDeckView } from "@/components/app/spydeck-view"
import { FullBleed } from "@/components/app/full-bleed"

export default function SpyDeckPage() {
  return (
    <FullBleed reason="Listing card grid, up to 6-up — capping it drops columns.">
      <SpyDeckView />
    </FullBleed>
  )
}

import { ApiPlayground } from "@/components/app/api-playground"
import { FullBleed } from "@/components/app/full-bleed"

export default function DevelopersPage() {
  return (
    <FullBleed reason="Request/response code panes — JSON reads worse when it wraps.">
      <ApiPlayground />
    </FullBleed>
  )
}

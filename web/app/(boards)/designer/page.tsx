import { DesignerBoard } from "@/components/app/designer-board"
import { FullBleed } from "@/components/app/full-bleed"

export default function DesignerPage() {
  return (
    <FullBleed reason="Job table with its own overflow-x — a narrower column scrolls sooner.">
      <DesignerBoard />
    </FullBleed>
  )
}

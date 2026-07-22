import { DispatchBoard } from "@/components/app/dispatch-board"
import { FullBleed } from "@/components/app/full-bleed"

export const metadata = { title: "Dispatch · EGFULFILL" }

export default function DispatchPage() {
  return (
    <FullBleed reason="Dispatch table — capping it brings back horizontal scroll.">
      <DispatchBoard />
    </FullBleed>
  )
}

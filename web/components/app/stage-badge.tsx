import { normalizeStage, stageMeta, TONE_CLASS } from "@/lib/factory-status"

// Factory production stage pill — shared by the Operator/Warehouse boards.
export function StageBadge({ status }: { status?: string | null }) {
  const id = normalizeStage(status)
  if (!id) return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">New</span>
  const m = stageMeta(id)
  return <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (m ? TONE_CLASS[m.tone] : "bg-muted")}>{m?.label ?? id}</span>
}

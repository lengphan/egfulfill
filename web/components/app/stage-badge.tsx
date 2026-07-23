"use client"

import { normalizeStage, stageMeta, TONE_CLASS } from "@/lib/factory-status"
import { useLabelT } from "@/lib/i18n"

// Factory production stage pill — shared by the Operator/Warehouse boards. The status ids
// (which mirror the server) are untouched; only the visible label is translated.
export function StageBadge({ status }: { status?: string | null }) {
  const tl = useLabelT()
  const id = normalizeStage(status)
  if (!id) return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{tl("stage", "New")}</span>
  const m = stageMeta(id)
  return <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (m ? TONE_CLASS[m.tone] : "bg-muted")}>{tl("stage", m?.label ?? id)}</span>
}

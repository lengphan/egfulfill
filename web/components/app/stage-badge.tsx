"use client"

import { normalizeStage, stageMeta, TONE_CLASS } from "@/lib/factory-status"
import { useLabelT } from "@/lib/i18n"
import { STATUS_TONE } from "@/lib/status-tone"

// Factory production stage pill — shared by the Operator/Warehouse boards. The status ids
// (which mirror the server) are untouched; only the visible label is translated.
export function StageBadge({ status }: { status?: string | null }) {
  const tl = useLabelT()
  const id = normalizeStage(status)
  // NO CAPSULE. A pill has to carry meaning, and an order stage did — until every label in
  // the app became one and the shape stopped saying anything. The word is the chip now.
  if (!id) return <span className={"text-xs " + STATUS_TONE.settled}>{tl("stage", "Draft")}</span>
  const m = stageMeta(id)
  return <span className={"text-xs " + (m ? TONE_CLASS[m.tone] : STATUS_TONE.settled)}>{tl("stage", m?.label ?? id)}</span>
}

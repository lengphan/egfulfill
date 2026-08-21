import { Badge } from "@/components/ui/badge"

// Universal status → colour map. One source of truth for stage colours across pages.
const tones: Record<string, string> = {
 new: "bg-blue-100 text-blue-700",
 queued: "bg-neutral-100 text-neutral-600",
 production: "bg-hold/15 text-hold",
 printing: "bg-hold/15 text-hold",
 qc: "bg-violet-100 text-violet-700",
 review: "bg-violet-100 text-violet-700",
 packed: "bg-pink-100 text-pink-700",
 shipped: "bg-emerald-100 text-emerald-700",
 fulfilled: "bg-emerald-100 text-emerald-700",
 active: "bg-emerald-100 text-emerald-700",
 paused: "bg-neutral-100 text-neutral-600",
 draft: "bg-neutral-100 text-neutral-600",
}

export function StatusBadge({ status }: { status: string }) {
 const cls = tones[status.toLowerCase()] ?? "bg-muted text-muted-foreground"
 return (
    <Badge variant="secondary" className={cls}>
      {status}
    </Badge>
  )
}

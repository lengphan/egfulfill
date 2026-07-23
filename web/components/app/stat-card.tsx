import type { ElementType } from "react"
import { Card } from "@/components/ui/card"

export type Tone = "pos" | "neg" | "mut"

const toneClass: Record<Tone, string> = {
  pos: "text-emerald-600",
  neg: "text-destructive",
  mut: "text-muted-foreground",
}

/** Universal KPI tile — one metric per card. Reused across every dashboard page.
 *  `icon` is optional and off by default, so every existing caller is unchanged. */
export function StatCard({
  label,
  value,
  sub,
  tone = "mut",
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  tone?: Tone
  icon?: ElementType
}) {
  return (
    <Card className="relative gap-0 overflow-hidden p-5">
      {Icon && (
        <span className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon size={16} weight="duotone" />
        </span>
      )}
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">{value}</div>
      {sub && <div className={"mt-1.5 text-[12.5px] font-medium " + toneClass[tone]}>{sub}</div>}
    </Card>
  )
}

/** Responsive 4-up grid for StatCards. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
}

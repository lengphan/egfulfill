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
  onClick,
  active,
}: {
  label: string
  value: string
  sub?: string
  tone?: Tone
  icon?: ElementType
  /** Makes the whole card a button. A number you can't act on is a number you read once —
   *  where a stat names a slice of the list below it, clicking should go there. */
  onClick?: () => void
  /** That slice is the one currently on screen. */
  active?: boolean
}) {
  const body = (
    <>
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">{value}</div>
      {sub && <div className={"mt-1.5 text-[12.5px] font-medium " + toneClass[tone]}>{sub}</div>}
    </>
  )
  const badge = Icon && (
    <span className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <Icon size={16} weight="duotone" />
    </span>
  )

  if (!onClick) {
    return <Card className="relative gap-0 overflow-hidden p-5">{badge}{body}</Card>
  }
  // A real <button>, not a div with onClick — keyboard and screen readers get it for free,
  // and Base UI has no asChild to lean on here.
  return (
    <Card className={"relative gap-0 overflow-hidden p-0 transition-shadow " + (active ? "ring-2 ring-primary/40" : "")}>
      {badge}
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="eg-tap w-full cursor-pointer p-5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        {body}
      </button>
    </Card>
  )
}

/** Responsive 4-up grid for StatCards. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
}

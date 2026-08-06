import type { ElementType } from "react"
import { Card } from "@/components/ui/card"

export type Tone = "pos" | "neg" | "mut"

const toneClass: Record<Tone, string> = {
  pos: "text-success",
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
  // Type carries the hierarchy; nothing else needs to. The label was 11.5px and the sub
  // 12.5px — below comfortable reading size for a figure someone checks in passing, which
  // is what made these tiles feel cramped rather than calm. Both go up, the value grows,
  // and the row it sits in gets room to breathe (p-6).
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {/* Monochrome and inline, not a tinted plate floating in the corner. A coloured
            chip on every card meant a row of four met the eye as four identical stickers
            before a single word was read — the same reasoning that already de-tinted the
            shortcut tiles. The accent is for things that need you, not for decoration. */}
        {Icon && <Icon size={14} className="shrink-0 opacity-70" />}
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="mt-2.5 text-[2.125rem] font-black leading-none tracking-tight tabular-nums">{value}</div>
      {sub && <div className={"mt-2 text-sm font-medium " + toneClass[tone]}>{sub}</div>}
    </>
  )

  if (!onClick) {
    return <Card className="relative gap-0 overflow-hidden p-6">{body}</Card>
  }
  // A real <button>, not a div with onClick — keyboard and screen readers get it for free,
  // and Base UI has no asChild to lean on here.
  return (
    <Card className={"relative gap-0 overflow-hidden p-0 transition-shadow " + (active ? "ring-2 ring-primary/40" : "")}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="eg-tap w-full cursor-pointer p-6 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
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

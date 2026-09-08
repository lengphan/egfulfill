"use client"

/**
 * THE RUNNING STRIP — the account's own figures, moving.
 *
 * IT TAKES FINISHED STRINGS, and that is deliberate: the seller dashboard and the staff
 * boards count entirely different things, and a component that tried to derive both would
 * need to know about orders, stages, roles and the wallet. Each surface counts what it
 * already has in hand and hands over the words. One strip, no shared assumptions.
 *
 * IT RENDERS NOTHING UNTIL THE CALLER KNOWS (§4 — unknown is not zero). Pass an empty list
 * while a fetch is in flight or after it fails: a ticker confidently scrolling "0 orders ·
 * 0 shipped" past someone with a busy month is worse than no ticker at all.
 *
 * The list is rendered TWICE and the track travels half its width, so the loop has no seam.
 * It pauses on hover, because a line of figures someone is reading should not walk away, and
 * it does not move at all under `prefers-reduced-motion` — the figures ARE the content, so
 * they stay legible either way (globals.css).
 */
export function DashboardTicker({ items, nudge }: { items: string[]; nudge?: string }) {
  if (!items.length) return null

  // The nudge is last so it never reads as one of the figures.
  const all = nudge ? [...items, nudge] : items
  const track = [...all, ...all]

  return (
    <div className="eg-marquee-hold overflow-hidden rounded-lg border border-border bg-muted/40 py-2">
      <div className="eg-marquee flex w-max">
        {track.map((t, i) => (
          <span key={i} className="flex items-center">
            <span className="whitespace-nowrap px-4 text-xs font-medium tabular-nums text-muted-foreground">{t}</span>
            <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
          </span>
        ))}
      </div>
    </div>
  )
}

"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { getAnnouncement, type AnnouncementSpeed } from "@/lib/api"

/**
 * THE RUNNING STRIP — the account's own figures, and one line an admin wrote.
 *
 * IT TAKES FINISHED STRINGS, deliberately: the seller dashboard and the staff boards count
 * entirely different things, and a component deriving both would need to know about orders,
 * stages, roles and the wallet. Each surface counts what it already has and hands over words.
 *
 * IT DRAWS NOTHING UNTIL THE CALLER KNOWS (§4 — unknown is not zero). An empty list while a
 * fetch is in flight or after it fails: a strip scrolling "0 orders · 0 shipped" past someone
 * with a busy month is worse than no strip.
 *
 * THE ONLY PROSE IS THE ADMIN'S. There was a hardcoded nudge appended here — "Connect a store
 * and these keep moving on their own" — which read as a second announcement nobody could edit
 * or remove. Whatever is set in Settings › Platform is now the only sentence on this strip.
 */

/**
 * SPEED IS PIXELS PER SECOND, NOT A DURATION, and that is the whole fix for "it is too fast".
 *
 * The CSS ran a fixed 32s regardless of how long the track was. The track is padded past
 * sixteen items so the -50% wrap has no seam, so a busy account has a track several thousand
 * pixels wide — and covering more pixels in the same 32 seconds is literally faster. Two
 * dashboards on the same setting scrolled at different speeds.
 *
 * Measuring the track and dividing gives one reading speed everywhere, whatever is on it.
 */
const PX_PER_SEC: Record<AnnouncementSpeed, number> = { slow: 28, normal: 48, fast: 80 }

export function DashboardTicker({ items }: { items: string[] }) {
  const [note, setNote] = useState("")
  const [speed, setSpeed] = useState<AnnouncementSpeed>("normal")
  const trackRef = useRef<HTMLDivElement>(null)
  const [dur, setDur] = useState<number | null>(null)

  /* One tiny read, done here rather than in each dashboard. The effect depends on nothing and
     writes state its own condition does not read, so it cannot re-satisfy itself (§2.8). */
  useEffect(() => {
    let live = true
    getAnnouncement()
      .then((a) => {
        if (!live) return
        if (a?.on && a.text) setNote(a.text)
        if (a?.speed) setSpeed(a.speed)
      })
      .catch(() => { /* no announcement is the right answer to a failed read */ })
    return () => { live = false }
  }, [])

  const all = note ? [...items, note] : items

  /* The set is repeated until half the track is wider than any screen. The animation moves it
     exactly -50%, so the second half has to be sitting where the first began at the wrap —
     with four short figures the whole track was narrower than the viewport, so it shifted a
     little and snapped. */
  const padded = [...all]
  while (padded.length && padded.length < 16) padded.push(...all)
  const track = [...padded, ...padded]

  /* Measured AFTER layout, so the number is the real width rather than a guess. useLayoutEffect
     because a first paint at the wrong duration is a visible lurch. */
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const half = el.scrollWidth / 2
    if (half > 0) setDur(half / PX_PER_SEC[speed])
  }, [speed, track.length, note])

  if (!items.length) return null

  return (
    <div className="eg-marquee-hold overflow-hidden rounded-lg border border-border bg-muted/40 py-2">
      <div
        ref={trackRef}
        className="eg-marquee flex w-max"
        style={dur ? { animationDuration: `${dur}s` } : undefined}
      >
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

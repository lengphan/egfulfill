"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { getAnnouncement, type AnnouncementSpeed } from "@/lib/api"

/**
 * THE RUNNING STRIP — the admin's announcement, and nothing else.
 *
 * IT USED TO CARRY FIGURES TOO — order counts, shipped, the wallet balance — and they came
 * out. They were already on the page in the panel directly beneath it, in a form you can
 * actually read: a number that walks past once every thirty seconds is a number nobody can
 * check. Repeating them here made the strip a second, worse dashboard and buried the one
 * thing on it a person had written.
 *
 * So it draws exactly what Settings › Platform holds and NOTHING when that is empty or
 * switched off. No figures, no nudge, no fallback copy — an empty announcement means no
 * strip, not a strip with something invented in it.
 */

/**
 * SPEED IS PIXELS PER SECOND, NOT A DURATION.
 *
 * The stylesheet used to fix this at 32s whatever the track was, and the text is repeated
 * until it is wider than any screen — so a long announcement covered far more pixels in the
 * same 32 seconds and read as faster. Two boards on one setting scrolled at two speeds.
 * Measuring the track and dividing gives one reading pace, whatever is on it.
 */
const PX_PER_SEC: Record<AnnouncementSpeed, number> = { slow: 28, normal: 48, fast: 80 }

export function DashboardTicker() {
  const [note, setNote] = useState("")
  const [speed, setSpeed] = useState<AnnouncementSpeed>("normal")
  const trackRef = useRef<HTMLDivElement>(null)
  const [dur, setDur] = useState<number | null>(null)

  /* One tiny read. The effect depends on nothing and writes state its own condition does not
     read, so it cannot re-satisfy itself (§2.8). */
  useEffect(() => {
    let live = true
    getAnnouncement()
      .then((a) => {
        if (!live) return
        if (a?.on && a.text) setNote(a.text)
        if (a?.speed) setSpeed(a.speed)
      })
      .catch(() => { /* a failed read means no announcement, never a stale one */ })
    return () => { live = false }
  }, [])

  /**
   * REPEATED UNTIL HALF THE TRACK IS WIDER THAN ANY SCREEN, which is what makes the loop
   * infinite rather than a jump. The animation moves the track exactly -50%, so the second
   * half has to be sitting where the first began at the moment it wraps — one short sentence
   * on its own is narrower than the viewport, so it would shift a little and snap back with
   * empty space behind it. Twelve copies of a sentence is a few thousand pixels, and they are
   * strings, so it costs nothing.
   */
  const copies = note ? Array.from({ length: 12 }, () => note) : []
  const track = [...copies, ...copies]

  /* Measured AFTER layout so the number is the real width, not a guess. useLayoutEffect
     because a first paint at the wrong speed is a visible lurch. */
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const half = el.scrollWidth / 2
    if (half > 0) setDur(half / PX_PER_SEC[speed])
  }, [speed, note])

  if (!note) return null

  return (
    <div className="eg-marquee-hold overflow-hidden rounded-lg border border-border bg-muted/40 py-2">
      <div
        ref={trackRef}
        className="eg-marquee flex w-max"
        /* A CSS VARIABLE, not the longhand: the stylesheet declares the animation with
           `var(--eg-marquee-dur, 90s)`, so setting the variable is the whole override and an
           un-measured first paint falls back to a slow crawl rather than a fixed sprint. */
        style={dur ? ({ "--eg-marquee-dur": `${dur}s` } as React.CSSProperties) : undefined}
      >
        {track.map((t, i) => (
          <span key={i} className="flex items-center">
            <span className="whitespace-nowrap px-4 text-xs font-medium text-muted-foreground">{t}</span>
            <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
          </span>
        ))}
      </div>
    </div>
  )
}

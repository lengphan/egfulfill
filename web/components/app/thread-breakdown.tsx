"use client"

import { useEffect, useState } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { matchThreadRegions, type ThreadRegion } from "@/lib/thread-match"
import { loadThreadPalette } from "@/lib/thread-palette-load"

/**
 * The cone list says WHAT to load; this says WHERE each cone goes.
 *
 * Every row is one thread with a crop of the artwork taken from the region that
 * colour actually occupies, plus a locator box over the whole design. A digitiser
 * reading "1966 Navy" had to guess which shape that was; now they can see it.
 *
 * Computed only when the popover opens — never on list render. Nothing is stored:
 * the crops are derived from the design we already hold, so persisting them would
 * duplicate data we can regenerate in a few milliseconds.
 */
export function ThreadBreakdown({
 artwork, children,
}: {
  /** The line's design URL (data URL or remote — remote goes via the img proxy). */
 artwork: string
  /** The trigger — usually the existing cone chip. */
 children: React.ReactNode
}) {
 const [open, setOpen] = useState(false)
 const [regions, setRegions] = useState<ThreadRegion[] | null>(null)

 useEffect(() => {
 if (!open || !artwork) return
 let alive = true
    // Deferred so the click that opens the popover paints first — the canvas work
    // is short but it is synchronous once it starts.
 const id = setTimeout(() => {
 setRegions(null)
      // Palette first — matching against the starter set and then re-matching would
      // flash cones the factory doesn't stock.
 loadThreadPalette()
        .then(() => matchThreadRegions(artwork))
        .then((r) => { if (alive) setRegions(r) })
        .catch(() => { if (alive) setRegions([]) })
    }, 0)
 return () => { alive = false; clearTimeout(id) }
  }, [open, artwork])

  // "No artwork" is a fact about the props, not something to store — deriving it
  // keeps the effect off the no-design path entirely.
 const shown = artwork ? regions : []

 return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
 title="See which cone covers which part of the design"
 className="eg-tap cursor-pointer rounded transition-opacity hover:opacity-80"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="border-b border-border px-3 py-2">
          <div className="text-sm font-semibold">Thread map</div>
          <div className="text-xs text-muted-foreground">Every cone this design needs — name, code, and the part it covers</div>
        </div>

        {shown === null ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <CircleNotch size={15} className="animate-spin" /> Reading the artwork…
          </div>
        ) : shown.length === 0 ? (
          // Distinguish the two real causes rather than showing a blank panel — a
          // cross-origin design that can't be read looks identical to no design.
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {artwork
              ? "Couldn't read this artwork — it may be hosted somewhere we can't sample."
 : "No design on this line yet."}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {shown.map((r) => (
              <div key={r.thread.code} className="flex items-center gap-3 px-3 py-2.5">
                {/* The crop — the actual answer to "which part is this?" */}
                {r.swatch ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
 src={r.swatch}
 alt={`Design detail using ${r.thread.name}`}
 className="size-12 shrink-0 rounded-md border border-border object-cover"
                  />
                ) : (
                  <span className="size-12 shrink-0 rounded-md border border-border" style={{ background: r.srcHex }} />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="size-3 shrink-0 rounded-full border border-black/10" style={{ background: r.thread.hex }} />
                    <span className="truncate text-sm font-medium">{r.thread.name}</span>
                    {/* Selectable: a code gets typed into a machine or read down a phone, and a
 span you cannot select is one somebody transcribes by eye. */}
                    <span className="shrink-0 select-all tabular-nums text-2xs text-muted-foreground">{r.thread.code}</span>
                  </div>
                  {/* Artwork colour AND cone colour: they are not the same, and a
 digitiser needs to see how far the match had to travel. */}
                  {r.poor && (
                    <div className="mt-0.5 rounded bg-hold/10 px-1.5 py-0.5 text-2xs font-medium text-hold">
                      No close match in stock
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <span className="tabular-nums">{r.srcHex}</span>
                    <span>→</span>
                    <span className="tabular-nums">{r.thread.hex.toUpperCase()}</span>
                    <span className="ml-auto font-medium text-foreground">{r.pct}%</span>
                  </div>
                </div>

                {/* Locator: where this colour sits within the whole design. */}
                <div className="relative size-9 shrink-0 rounded border border-border bg-muted" title="Position in the design">
                  <span
 className="absolute rounded-[2px] bg-primary/70"
 style={{ left: `${r.box.x}%`, top: `${r.box.y}%`, width: `${r.box.w}%`, height: `${r.box.h}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

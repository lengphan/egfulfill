"use client"

/**
 * BAND ARRANGEMENTS — every layout in LAYOUTS, drawn with the real `PageBand`, at true
 * height, in both themes. A crop check and a composition check, not a mockup. noindex.
 *
 * Sits beside /lab/decor, which does the same job for the band and tile pairing.
 */

import { PageBand, LAYOUTS } from "@/components/app/page-band"

const NOTES: Record<string, string> = {
  shelf: "one baseline, sizes vary",
  arc: "a curve lifting off the right edge",
  bunch: "one mass in the corner, overlapping",
  pairs: "a trio and a pair, with air between",
  hero: "one big object, three in orbit",
  scatter: "what shipped first",
}

function Column({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-full space-y-5 bg-background px-6 py-6 text-foreground">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {dark ? "Dark" : "Light"}
        </p>
        {Object.keys(LAYOUTS).map((key) => (
          <div key={key} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              <span className="font-semibold text-foreground">{key}</span> — {NOTES[key]}
            </p>
            <PageBand
              layout={key}
              title="Good afternoon, Linh"
              sub={<><span className="font-medium text-[var(--mk-acid)]">5</span> new today</>}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function BandLayoutLab() {
  return (
    <div className="min-h-svh">
      <p className="px-6 py-4 text-sm font-semibold">Band arrangements — the real component</p>
      <div className="grid md:grid-cols-2">
        <Column dark={false} />
        <Column dark />
      </div>
    </div>
  )
}

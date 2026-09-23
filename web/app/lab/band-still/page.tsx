"use client"

/**
 * THE BAND'S MATERIAL, COMPARED — the three candidates against the clip that ships today,
 * drawn with the real `PageBand`, at true height, with the real greeting on them. A crop
 * check and a sharpness check, not a mockup. noindex.
 *
 * WHY THE SHIPPED ONE IS FIRST AND NOT LAST. The complaint was "too blurry", and blur is
 * only ever read against something else — a strip on its own looks fine until the next one
 * is beside it. So the thing being replaced sits at the top of the page, at the same size,
 * and every candidate is read against it rather than against a memory of it.
 *
 * THE FIGURES ARE MEASURED, NOT CLAIMED (§4). Laplacian variance over the RIGHT HALF — the
 * half that carries material; averaging in the empty left half would flatter every one of
 * them equally and say nothing. The contrast figure is the greeting's ink against the
 * darkest 5% of the pixels it actually sits on, not against an average of the frame.
 */

import { PageBand, STILLS } from "@/components/app/page-band"

/** Measured with tools/, on the shipped 3024px crops. A figure in a comment is a claim —
 *  these came out of the same script that produced the files. */
const ROWS: { key: string; name: string; note: string; detail: number; acutance: number }[] = [
  { key: "chrome-tubes", name: "Chrome tubes", note: "The one being animated above \u2014 this file is the clip's own first frame, so reduced motion shows exactly what the video starts from.", detail: 102, acutance: 25 },
  { key: "balloons", name: "Foil balloons", note: "Reads straight on from the balloon the band already floats \u2014 same family, now the whole surface.", detail: 246, acutance: 41 },
  { key: "crystal", name: "Cut crystal", note: "Faceted prisms with dispersion, and the one place the lime appears. Busiest of the three.", detail: 307, acutance: 43 },
]

export default function BandStillLab() {
  return (
    <div className="mx-auto max-w-[1480px] space-y-8 p-6">
      <div>
        <h1 className="font-title text-2xl font-semibold tracking-tight">Band material</h1>
        <p className="text-sm text-muted-foreground">
          Detail is Laplacian variance over the right half; acutance is the 99th-percentile edge gradient there — how
          MANY edges, then how HARD they are. The clip shipping today measures 44 and 12. The greeting sits on the masked
          plate in every row, so its contrast is the plate’s own 13.7:1 throughout.
        </p>
      </div>

      <section className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-medium">Fabric — the band, re-shot</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            3808×528 · 2.6 Mbps · 4.8s loop · seam 1.48 · motion ×9.7 · ink 9.8:1
          </span>
        </div>
        <PageBand
          title={<>Good morning, Linh</>}
          sub={<>Tuesday, Sep 23 · <span className="font-medium text-[var(--mk-acid)]">1</span> new today</>}
        />
        <p className="max-w-2xl text-xs text-muted-foreground">
          Same material, generated from the old frame as a reference, then 4K-upscaled and resampled to 3808. Only resolution, bitrate and wave motion changed.
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-medium">Before</h2>
          <span className="text-xs tabular-nums text-muted-foreground">1600×240 · 98 kbps · motion 0.20</span>
        </div>
        <PageBand
          figure="clip"
          clip="before"
          title={<>Good morning, Linh</>}
          sub={<>Tuesday, Sep 23 · <span className="font-medium text-[var(--mk-acid)]">1</span> new today</>}
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-medium">Chrome tubes, moving</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            2944×408 · 1.76 Mbps · 4.8s loop · seam 2.60 · detail 187 · acutance 32
          </span>
        </div>
        <PageBand
          figure="clip"
          clip="chrome-tubes"
          title={<>Good morning, Linh</>}
          sub={<>Tuesday, Sep 23 · <span className="font-medium text-[var(--mk-acid)]">1</span> new today</>}
        />
        <p className="max-w-xl text-xs text-muted-foreground">
          The still above is its own first frame, so reduced motion shows exactly what the clip starts from.
        </p>
      </section>

      {ROWS.map((r) => (
        <section key={r.key} className="space-y-2">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-medium">{r.name}</h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              3024×420 · detail {r.detail} · acutance {r.acutance}
            </span>
          </div>
          <PageBand
            figure="still"
            stillSrc={STILLS[r.key]}
            title={<>Good morning, Linh</>}
            sub={<>Tuesday, Sep 23 · <span className="font-medium text-[var(--mk-acid)]">1</span> new today</>}
          />
          <p className="max-w-xl text-xs text-muted-foreground">{r.note}</p>
        </section>
      ))}
    </div>
  )
}

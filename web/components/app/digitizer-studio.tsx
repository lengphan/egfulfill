"use client"

import { Needle, UploadSimple, Receipt, MagnifyingGlass, FileArrowDown } from "@phosphor-icons/react"

// The intended pipeline — a preview of what the page does once the EWA flow is built.
const STEPS = [
  { icon: UploadSimple, title: "Drop a design", body: "Drag in artwork or a machine file (PES / DST / EMB)." },
  { icon: Receipt, title: "Instant quote", body: "Stitch count, colours and price back in seconds." },
  { icon: MagnifyingGlass, title: "Design review", body: "TrueView preview, thread list, recolour, resize." },
  { icon: FileArrowDown, title: "Export machine file", body: "Edit lettering, then export EMB / DST / and more." },
]

/**
 * Digitizer — the Wilcom EWA embroidery page. Credentials + the live connectivity test
 * live in Settings › Integrations (the Wilcom card's refresh button), not here — this page
 * is the flow. The upload → quote → export pipeline is still a preview until the EWA XML
 * recipes are wired (Phase 1).
 */
export function DigitizerStudio() {
  return (
    <div className="mx-auto w-full max-w-4xl p-5 sm:p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Needle size={22} weight="duotone" />
        </span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Digitizer</h1>
          <p className="text-sm text-muted-foreground">
            Turn synced-order artwork into an embroidery preview and a machine file — or build one from scratch.
          </p>
        </div>
      </div>

      {/* Flow preview */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {STEPS.map((s, i) => (
          <div key={s.title} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <s.icon size={18} weight="duotone" />
            </span>
            <div>
              <div className="text-sm font-medium">{i + 1}. {s.title}</div>
              <div className="text-xs text-muted-foreground">{s.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Dropzone — the flow isn't wired yet (Phase 1) */}
      <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/30 py-12 text-center opacity-60">
        <UploadSimple size={26} className="text-muted-foreground" />
        <div className="text-sm font-medium text-muted-foreground">Drag &amp; drop — coming soon</div>
        <div className="text-xs text-muted-foreground">The upload → quote → export flow lands in the next build.</div>
      </div>
    </div>
  )
}

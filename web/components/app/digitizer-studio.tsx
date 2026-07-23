"use client"

import { useState } from "react"
import { Needle, UploadSimple, Receipt, MagnifyingGlass, FileArrowDown, Key, LockSimple } from "@phosphor-icons/react"

// The intended pipeline — shown as a preview of what the page will do once the Wilcom EWA
// subscription is connected. Nothing here is live yet; this is a dormant placeholder.
const STEPS = [
  { icon: UploadSimple, title: "Drop a design", body: "Drag in artwork or a machine file (PES / DST / EMB)." },
  { icon: Receipt, title: "Instant quote", body: "Stitch count, colours and price back in seconds." },
  { icon: MagnifyingGlass, title: "Design review", body: "TrueView preview, thread list, recolour, resize." },
  { icon: FileArrowDown, title: "Export machine file", body: "Edit lettering, then export EMB / DST / and more." },
]

/**
 * Digitizer — the planned Wilcom EWA embroidery page. Kept deliberately DORMANT: the flow
 * is described, the dropzone is disabled, and the API-key card is present but not wired to
 * anything (honest per the "don't ship an empty state that looks broken" rule). Flipping it
 * on is a separate build once the Wilcom EWA subscription exists.
 */
export function DigitizerStudio() {
  const [apiKey, setApiKey] = useState("")

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
            Drag a design in, get a quote and a preview, edit it, and export a machine file — powered by the Wilcom embroidery engine.
          </p>
        </div>
      </div>

      {/* Dormant banner — say plainly it isn't live yet. */}
      <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        <LockSimple size={18} weight="fill" className="mt-0.5 shrink-0" />
        <div>
          <span className="font-semibold">Not active yet.</span> This is a placeholder for the Wilcom EWA integration. Add the API key below to activate it once the subscription is live.
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

      {/* Disabled dropzone */}
      <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/30 py-12 text-center opacity-60">
        <UploadSimple size={26} className="text-muted-foreground" />
        <div className="text-sm font-medium text-muted-foreground">Drag &amp; drop — coming soon</div>
        <div className="text-xs text-muted-foreground">Enabled once the Wilcom EWA key is connected.</div>
      </div>

      {/* API-key settings (dormant) */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Key size={16} weight="bold" className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Wilcom EWA API key</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Held here for when we open the integration — it isn&apos;t sent anywhere yet.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="ewa_…"
            autoComplete="off"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <button
            type="button"
            disabled
            title="Available once the Wilcom EWA plan is subscribed"
            className="rounded-lg bg-primary/10 px-4 py-2 text-sm font-semibold text-primary opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

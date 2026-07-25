"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Needle, UploadSimple, Receipt, MagnifyingGlass, FileArrowDown, Key, LockSimple, CircleNotch, CheckCircle, Warning, Plug } from "@phosphor-icons/react"
import { getWilcomConfig, testWilcomConnection, type WilcomConfig, type WilcomTest } from "@/lib/api"

// The intended pipeline — a preview of what the page does once the EWA flow is built.
const STEPS = [
  { icon: UploadSimple, title: "Drop a design", body: "Drag in artwork or a machine file (PES / DST / EMB)." },
  { icon: Receipt, title: "Instant quote", body: "Stitch count, colours and price back in seconds." },
  { icon: MagnifyingGlass, title: "Design review", body: "TrueView preview, thread list, recolour, resize." },
  { icon: FileArrowDown, title: "Export machine file", body: "Edit lettering, then export EMB / DST / and more." },
]

/**
 * Digitizer — the Wilcom EWA embroidery page. The credentials now live in Settings ›
 * Integrations (server-side, never in the browser); this page checks whether they're set
 * and lets staff run a LIVE connectivity test. The upload → quote → export flow is still
 * dormant (needs the EWA XML recipes wired) — shown as a preview, not a broken control.
 */
export function DigitizerStudio() {
  const [cfg, setCfg] = useState<WilcomConfig | null>(null)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<WilcomTest | null>(null)
  const [testErr, setTestErr] = useState<string | null>(null)

  useEffect(() => {
    const id = setTimeout(() => {
      getWilcomConfig().then(setCfg).catch(() => setCfg({ configured: false }))
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const runTest = async () => {
    setTesting(true); setResult(null); setTestErr(null)
    try {
      setResult(await testWilcomConnection())
    } catch (e) {
      // The server returns 400 (not configured) / 502 (unreachable) as errors — surface the
      // message. A 404 here means the backend route isn't deployed yet.
      setTestErr(e instanceof Error ? e.message : "Couldn't reach the test endpoint.")
    } finally {
      setTesting(false)
    }
  }

  const configured = cfg?.configured === true

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

      {/* Honest status: the flow isn't built yet, even once the key connects. */}
      <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        <LockSimple size={18} weight="fill" className="mt-0.5 shrink-0" />
        <div>
          <span className="font-semibold">Preview.</span> The upload → quote → export flow below isn&apos;t wired yet. The connection to Wilcom EWA is — test it below once the key is saved in Settings.
        </div>
      </div>

      {/* Connection card — the live part */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Key size={16} weight="bold" className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Wilcom EWA connection</h2>
          <span className={"ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
            (cfg === null ? "bg-muted text-muted-foreground" : configured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400")}>
            {cfg === null ? <><CircleNotch size={12} className="animate-spin" /> Checking</> : configured ? <><CheckCircle size={12} weight="fill" /> Key installed</> : <><Warning size={12} weight="fill" /> No key</>}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          The Application ID &amp; key live in{" "}
          <Link href="/settings" className="text-primary hover:underline">Settings › Integrations</Link>{" "}
          (admin), server-side — never here. This runs a real call to EWA to confirm they work.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runTest}
            disabled={testing || cfg === null || !configured}
            title={!configured ? "Add the Application ID + key in Settings › Integrations first" : "Run a live api/info call"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {testing ? <CircleNotch size={15} className="animate-spin" /> : <Plug size={15} weight="bold" />}
            {testing ? "Testing…" : "Test connection"}
          </button>
          {!configured && cfg !== null && (
            <span className="text-xs text-muted-foreground">Add the key in Settings first.</span>
          )}
        </div>

        {/* Result */}
        {result && (
          <div className={"mt-3 rounded-lg border px-3 py-2.5 text-sm " +
            (result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                       : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300")}>
            <div className="font-medium">
              {result.ok
                ? `Connected — EWA responded${result.status ? ` (HTTP ${result.status})` : ""}.`
                : `EWA rejected the request${result.status ? ` (HTTP ${result.status})` : ""}${result.message ? `: ${result.message}` : ""}.`}
            </div>
            {result.sample && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 text-[11px] text-muted-foreground">{result.sample}</pre>
            )}
          </div>
        )}
        {testErr && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
            <span>{testErr}</span>
          </div>
        )}
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

      {/* Disabled dropzone — the flow isn't wired yet */}
      <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/30 py-12 text-center opacity-60">
        <UploadSimple size={26} className="text-muted-foreground" />
        <div className="text-sm font-medium text-muted-foreground">Drag &amp; drop — coming soon</div>
        <div className="text-xs text-muted-foreground">The upload → quote → export flow lands in the next build.</div>
      </div>
    </div>
  )
}

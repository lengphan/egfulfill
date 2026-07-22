"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, ArrowsClockwise, Stop, Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getSsSyncStatus, startSsSyncAll, stopSsSyncAll, type SsSyncStatus } from "@/lib/api"

/**
 * Catalogue sync — pulls every S&S style into the local table so search can find it.
 *
 * Search queries what's been synced. Before this the only way to sync was naming styles
 * or brands by hand, so anything nobody had thought to name was simply unfindable, and
 * the picker answered "no products match" when the truth was "nobody has fetched that
 * yet". Those are different statements and only one of them is true.
 *
 * It runs for a while — S&S allow 60 requests a minute and there are thousands of styles
 * — so it's a background job with a progress bar rather than a spinner you wait on. It's
 * resumable, and already-synced styles are skipped, so re-running it is cheap and
 * stopping it costs nothing.
 */
export function SsSyncPanel() {
  const [st, setSt] = useState<SsSyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /** One status read. Kept trivial so both the first load and the poll share it. */
  const load = useCallback(async () => {
    try { setSt(await getSsSyncStatus()) } catch {
      // Keep the last known state, but STOP being null — see the render guard below.
      setSt((prev) => prev ?? { running: false, total: 0, done: 0, skipped: 0, error: null, stylesInDb: 0, productsInDb: 0 } as SsSyncStatus)
    }
  }, [])

  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  // Poll only WHILE it runs. A finished job needs no watching, and a page left open
  // shouldn't quietly hammer the API all afternoon. Driven off `running` rather than a
  // self-scheduling callback, which can't reference itself before it's declared.
  useEffect(() => {
    if (!st?.running) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [st?.running, load])

  const start = async (refresh: boolean) => {
    setBusy(true); setErr(null)
    try {
      const r = await startSsSyncAll(refresh)
      if (r.error) { setErr(r.error); return }
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start the sync.")
    } finally { setBusy(false) }
  }

  const stop = async () => {
    setBusy(true)
    try { await stopSsSyncAll(); load() } finally { setBusy(false) }
  }

  /**
   * NEVER return null here.
   *
   * This bailed until a status read succeeded — so when the status call failed, or hadn't
   * landed yet, the entire panel disappeared and with it the Sync button. A feature that
   * vanishes when a status endpoint hiccups looks like a feature that was never built, and
   * the one thing a user needs from this panel is the button, not the status.
   *
   * The status is the optional part. The button is the point.
   */
  if (!st) {
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => start(false)} disabled={busy}>
          {busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowsClockwise size={13} weight="bold" />}
          Sync all styles
        </Button>
      </>
    )
  }

  const pct = st.total > 0 ? Math.min(100, Math.round((st.done / st.total) * 100)) : 0
  // Their rate limit sets the pace, so remaining time is arithmetic rather than a guess.
  const left = st.running && st.total > st.done ? Math.ceil(((st.total - st.done) * 1.1) / 60) : 0

  return (
    <>
      {/* NO ROW OF ITS OWN. This was a full-width bordered strip holding one button, empty
          whenever a sync wasn't running — which is nearly always. It now sits inline with
          the other toolbar actions, and progress appears beneath only while it exists.
          The catalogue name, the "idle" tick and the product count were standing status for
          a thing that is almost always idle — a permanent row reporting that nothing is
          happening. Gone.
          What stays is the part that is only true while it matters: a sync takes the better
          part of an hour, and a long background job with no visible progress is a different
          bug from a noisy one. Errors stay too — those are the reason someone came here. */}
      {st.running && (
        <div className="basis-full">
          <>
            <div className="text-xs text-muted-foreground">
              {st.done}/{st.total} styles{st.skipped ? ` (${st.skipped} already had)` : ""}{left ? ` · ~${left} min left` : ""}
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </>
        </div>
      )}
      {!st.running && st.error && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
          <Warning size={12} weight="fill" /> {st.error}
        </span>
      )}

      {err && <span className="text-xs text-destructive">{err}</span>}

      {st.running ? (
        <Button size="sm" variant="outline" onClick={stop} disabled={busy}>
          <Stop size={13} weight="bold" /> Stop
        </Button>
      ) : (
        <>
          <Button size="sm" onClick={() => start(false)} disabled={busy}>
            {busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowsClockwise size={13} weight="bold" />}
            Sync all styles
          </Button>
          {/* Refresh re-fetches styles already held — prices and stock move, so an
              occasional full pass is worth an hour; a normal run should skip them. */}
          <button onClick={() => start(true)} disabled={busy}
            className="text-xs font-medium text-muted-foreground hover:text-foreground">
            refresh existing
          </button>
        </>
      )}
    </>
  )
}
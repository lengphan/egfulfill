"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Warning, Barcode, CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { createManifest, previewManifest, type ManifestGroup, type ManifestSkip } from "@/lib/api"

type Made = { id: string; status: string; pdf: string | null; count: number }

/**
 * Create a USPS SCAN form for a batch of labels.
 *
 * The thing this dialog has to keep straight is that a SCAN form is a DOCUMENT, not a
 * scan. It does not start anyone's tracking. The carrier scanning the printed barcode at
 * handover is what does that, and until then these parcels are no more accepted than they
 * were before. Every string here is written to avoid implying otherwise — no "scanned",
 * no "dispatched", and the success state says what still has to happen.
 *
 * The preview runs before anything is created, because a manifest can't be undone: a label
 * committed to one form can never be moved to another, so "which of these actually go on
 * it" is a question to answer before the click, not after.
 */
export function ManifestDialog({ orderIds, open, onOpenChange, onDone }: {
  orderIds: string[]
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone?: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [shipDate, setShipDate] = useState(today)
  const [groups, setGroups] = useState<ManifestGroup[] | null>(null)
  const [skipped, setSkipped] = useState<ManifestSkip[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [made, setMade] = useState<Made[] | null>(null)

  const eligible = (groups ?? []).reduce((n, g) => n + g.count, 0)

  const preview = useCallback(() => {
    if (!orderIds.length) return
    setBusy(true); setErr(null)
    previewManifest(orderIds)
      .then((r) => { setGroups(r.groups ?? []); setSkipped(r.skipped ?? []) })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false))
  }, [orderIds])

  useEffect(() => {
    if (!open) return
    // Deferred, like every other setState-from-effect here — a synchronous one cascades a
    // second render.
    const t = setTimeout(() => { setMade(null); setErr(null); preview() }, 0)
    return () => clearTimeout(t)
  }, [open, preview])

  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await createManifest(orderIds, shipDate)
      if (r.error && !(r.manifests ?? []).length) { setErr(r.error); return }
      setMade(r.manifests ?? [])
      // Partial failure is reported alongside what DID work rather than replacing it —
      // one carrier account failing doesn't make the other's form less real, and someone
      // still has to go print it.
      if (r.failed?.length) {
        setErr(`${r.failed.length === 1 ? "One group" : `${r.failed.length} groups`} couldn't be manifested: ${r.failed.map((f) => f.error).join(" · ")}`)
      }
      onDone?.()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Barcode size={18} weight="duotone" /> Create a USPS SCAN form
          </DialogTitle>
          <DialogDescription>
            One barcode covering every label below. The carrier scans it once when they take
            the parcels, instead of scanning each one.
          </DialogDescription>
        </DialogHeader>

        {made ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                {made.length === 1 ? "Form created" : `${made.length} forms created`}. Print it and hand
                it over with the parcels — <strong>they don&apos;t count as accepted until USPS scans
                it</strong>, and the Scan tags stay amber until they do.
              </span>
            </div>
            {made.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{m.count} {m.count === 1 ? "label" : "labels"}</div>
                  <div className="truncate font-mono text-2xs text-muted-foreground">{m.id}</div>
                </div>
                {m.pdf ? (
                  <Button size="sm" variant="outline"
                    onClick={() => window.open(m.pdf as string, "_blank", "noopener,noreferrer")}>
                    Print
                  </Button>
                ) : (
                  // Honest about the async gap rather than showing a dead button: USPS has
                  // the form, the PDF just hasn't landed yet.
                  <span className="text-xs text-muted-foreground">Still generating — reopen from history in a moment.</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="scan-form-date" className="mb-1 block text-xs font-medium">Handover date</label>
              <Input id="scan-form-date" type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} className="h-9 w-44" />
              <p className="mt-1 text-2xs text-muted-foreground">
                The day the parcels actually go out. USPS can refuse a form dated for a day the pile didn&apos;t move.
              </p>
            </div>

            {busy && !groups ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <CircleNotch size={14} className="animate-spin" /> Checking which labels can go on it…
              </div>
            ) : (
              <>
                {groups && groups.length > 1 && (
                  <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                    These labels span {groups.length} carrier accounts, so they need {groups.length} separate
                    forms — USPS requires one account per form. All {groups.length} are created together.
                  </p>
                )}
                <div className="text-sm">
                  <strong>{eligible}</strong> {eligible === 1 ? "label goes" : "labels go"} on {groups && groups.length > 1 ? `${groups.length} forms` : "this form"}.
                </div>
                {skipped.length > 0 && (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                    <div className="text-xs font-medium text-amber-900">
                      {skipped.length} left off:
                    </div>
                    {skipped.map((s) => (
                      <div key={s.id} className="text-2xs text-amber-800">
                        <span className="font-mono">{s.num}</span> — {s.reason}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{made ? "Done" : "Cancel"}</Button>
          {!made && (
            <Button onClick={create} disabled={busy || !eligible}>
              {busy ? <CircleNotch size={14} className="animate-spin" /> : <><Barcode size={14} weight="bold" /> Create form</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Moon, CheckCircle } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupportHoursConfig, setSupportHoursConfig, type SupportHoursConfig, type SupportAvailability } from "@/lib/api"

// Sun=0 to match JS getDay(); shown Mon-first because that's how a work week reads.
const DAYS: [string, number][] = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]]

/**
 * Edit support hours + a manual holiday closure, right from the chat page so it's easy to
 * check. Staff can view; only an admin can save (the server enforces it too). The live
 * status line answers "are we open right now?" at a glance.
 */
export function SupportHoursEditor({ open, onOpenChange, isAdmin, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  isAdmin: boolean
  onSaved?: (a: SupportAvailability) => void
}) {
  const [cfg, setCfg] = useState<SupportHoursConfig | null>(null)
  const [avail, setAvail] = useState<SupportAvailability | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getSupportHoursConfig()
      .then((r) => { setCfg(r.config); setAvail(r.availability) })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load support hours"))
  }, [])
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => { setErr(null); setSaved(false); load() }, 0)
    return () => clearTimeout(id)
  }, [open, load])

  const patch = (p: Partial<SupportHoursConfig>) => setCfg((c) => (c ? { ...c, ...p } : c))
  const patchOoo = (p: Partial<SupportHoursConfig["ooo"]>) => setCfg((c) => (c ? { ...c, ooo: { ...c.ooo, ...p } } : c))
  const toggleDay = (d: number) => setCfg((c) => (c ? { ...c, days: c.days.includes(d) ? c.days.filter((x) => x !== d) : [...c.days, d].sort((a, b) => a - b) } : c))

  const save = async () => {
    if (!cfg) return
    setBusy(true); setErr(null); setSaved(false)
    try {
      const r = await setSupportHoursConfig(cfg)
      if (r.error) throw new Error(r.error)
      if (r.config) setCfg(r.config)
      if (r.availability) { setAvail(r.availability); onSaved?.(r.availability) }
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save — admin only.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Support hours</DialogTitle>
          <DialogDescription>
            When the team is available. Outside these hours sellers see an out-of-office notice with the return time.
          </DialogDescription>
        </DialogHeader>

        {!cfg ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            {avail && (
              <div className={"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm " + (avail.open
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200")}>
                {avail.open ? <CheckCircle size={15} weight="fill" /> : <Moon size={15} weight="fill" />}
                <span>{avail.open ? "Open now" : `Closed right now${avail.resumesLabel ? ` — back ${avail.resumesLabel}` : ""}`}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Opens (24h)</span>
                <Input type="number" min={0} max={24} value={cfg.startH} disabled={!isAdmin} onChange={(e) => patch({ startH: Number(e.target.value) })} className="h-9" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Closes (24h)</span>
                <Input type="number" min={0} max={24} value={cfg.endH} disabled={!isAdmin} onChange={(e) => patch({ endH: Number(e.target.value) })} className="h-9" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">UTC offset</span>
                <Input type="number" value={cfg.tzOffset} disabled={!isAdmin} onChange={(e) => patch({ tzOffset: Number(e.target.value) })} className="h-9" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Timezone label</span>
                <Input value={cfg.tzLabel} disabled={!isAdmin} onChange={(e) => patch({ tzLabel: e.target.value })} className="h-9" />
              </label>
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Working days</span>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map(([label, d]) => (
                  <button key={d} type="button" disabled={!isAdmin} onClick={() => toggleDay(d)}
                    className={"rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " +
                      (cfg.days.includes(d) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground") +
                      (isAdmin ? "" : " opacity-70")}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Holiday closure (optional)</span>
              <p className="mb-2 text-xs text-muted-foreground">A date we&apos;re out until — overrides the weekly hours until then. Clear it to cancel.</p>
              <div className="flex items-center gap-2">
                <Input type="date" value={cfg.ooo.until ? String(cfg.ooo.until).slice(0, 10) : ""} disabled={!isAdmin}
                  onChange={(e) => patchOoo({ until: e.target.value || null })} className="h-9" />
                {cfg.ooo.until && isAdmin && <Button variant="ghost" size="sm" onClick={() => patchOoo({ until: null })}>Clear</Button>}
              </div>
              <Input value={cfg.ooo.message} disabled={!isAdmin} onChange={(e) => patchOoo({ message: e.target.value })}
                placeholder="Optional message, e.g. Closed for Tết" className="mt-2 h-9" />
            </div>

            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
        )}

        <DialogFooter>
          {saved && <span className="mr-auto self-center text-xs text-emerald-600 dark:text-emerald-400">Saved — applies immediately.</span>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {isAdmin && <Button onClick={save} disabled={busy || !cfg}>{busy ? <CircleNotch size={14} className="animate-spin" /> : null}Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useEffect, useState } from "react"
import { PenNib, CircleNotch } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getDesignLibrary, getDesignLibraryItem, type LibraryDesign } from "@/lib/api"

// Pick a saved library design → returns its full artwork data URL.
export function LibraryPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (dataUrl: string, design: LibraryDesign) => void
}) {
  const [designs, setDesigns] = useState<LibraryDesign[] | null>(null)
  const [loadingId, setLoadingId] = useState<string | number | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    const id = setTimeout(() => {
      setDesigns(null)
      getDesignLibrary().then((r) => alive && setDesigns(r ?? [])).catch(() => alive && setDesigns([]))
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [open])

  const pick = async (d: LibraryDesign) => {
    setLoadingId(d.id)
    try {
      const r = await getDesignLibraryItem(d.id)
      if (r.data) { onPick(r.data, d); onOpenChange(false) }
    } catch {
      /* ignore */
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Choose from your library</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {designs === null ? (
            <div className="flex items-center justify-center py-14 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
          ) : designs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              <PenNib size={22} weight="duotone" /> No saved designs yet — create one in the Design Lab.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {designs.map((d) => (
                <button
                  key={String(d.id)}
                  onClick={() => pick(d)}
                  disabled={loadingId != null}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border text-left transition-colors hover:border-primary hover:bg-accent disabled:opacity-60"
                >
                  <div className="relative flex aspect-square items-center justify-center bg-muted">
                    {d.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.thumb} alt={d.name ?? ""} className="size-full object-contain" />
                    ) : (
                      <PenNib size={22} weight="duotone" className="text-muted-foreground/40" />
                    )}
                    {loadingId === d.id && <div className="absolute inset-0 flex items-center justify-center bg-background/60"><CircleNotch size={20} className="animate-spin text-primary" /></div>}
                  </div>
                  <div className="truncate p-2 text-xs font-medium">{d.name || "Untitled"}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

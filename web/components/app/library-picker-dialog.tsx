"use client"

import { useEffect, useMemo, useState } from "react"
import { PenNib, CircleNotch, MagnifyingGlass, Stack } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { getDesignLibrary, getDesignLibraryItem, getTemplates, type LibraryDesign, type ProductTemplate } from "@/lib/api"

type Source = "designs" | "templates"

/**
 * Pick a saved design — or a saved TEMPLATE — and put it on the canvas.
 *
 * TEMPLATES WERE MISSING, and they are the half people actually save. A design in the
 * library is a flat image; a template is the artwork plus where it sits plus the blank it
 * was drawn on, which is the whole reason for saving one. The dialog offered only the flat
 * half, so the answer to "where are my templates?" was that this list had never asked for
 * them.
 *
 * What a template does when picked depends on who is asking: a caller that can restore
 * placement (`onPickTemplate`) gets the whole template; one that can only take an image
 * gets the template's artwork, which is still the right picture, just centred.
 *
 * AND A SEARCH BOX. A library is a grid of thumbnails with names underneath, and past about
 * thirty of them the only way to find one was to scroll and squint.
 */
export function LibraryPickerDialog({
  open,
  onOpenChange,
  onPick,
  onPickTemplate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (dataUrl: string, design: LibraryDesign) => void
  /** Passed by callers that can restore a template's placement and blank, not just its art. */
  onPickTemplate?: (t: ProductTemplate) => void
}) {
  const [source, setSource] = useState<Source>("designs")
  const [designs, setDesigns] = useState<LibraryDesign[] | null>(null)
  const [templates, setTemplates] = useState<ProductTemplate[] | null>(null)
  const [loadingId, setLoadingId] = useState<string | number | null>(null)
  const [q, setQ] = useState("")

  useEffect(() => {
    if (!open) return
    let alive = true
    const id = setTimeout(() => {
      setDesigns(null); setTemplates(null); setQ(""); setSource("designs")
      getDesignLibrary().then((r) => alive && setDesigns(r ?? [])).catch(() => alive && setDesigns([]))
      // Both lists up front: the tab has to be able to say how many are behind it, and a
      // count that appears a second after the tab does reads as the list still loading.
      getTemplates().then((r) => alive && setTemplates(r ?? [])).catch(() => alive && setTemplates([]))
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [open])

  const term = q.trim().toLowerCase()
  /** Untitled things are findable too — the id is what the card shows when a name is absent. */
  const shownDesigns = useMemo(
    () => (designs ?? []).filter((d) => !term || `${d.name ?? ""} ${d.id}`.toLowerCase().includes(term)),
    [designs, term]
  )
  const shownTemplates = useMemo(
    () => (templates ?? []).filter((t) => !term || `${t.name ?? ""} ${t.seq != null ? `TPL-${t.seq}` : ""} ${t.id}`.toLowerCase().includes(term)),
    [templates, term]
  )

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

  /** The artwork a template holds, not its composite — the composite has the blank baked in,
   *  so dropping it on a canvas puts a picture of a t-shirt on a t-shirt. */
  const artOf = (t: ProductTemplate): string => {
    const l = (t.layers ?? {}) as { images?: { src?: string }[]; designUrl?: string }
    const first = Array.isArray(l.images) ? l.images.find((im) => im?.src)?.src : undefined
    return String(first ?? l.designUrl ?? "")
  }

  const pickTemplate = (t: ProductTemplate) => {
    if (onPickTemplate) { onPickTemplate(t); onOpenChange(false); return }
    const art = artOf(t)
    if (!art) return
    onPick(art, { id: t.id, name: t.name ?? null } as LibraryDesign)
    onOpenChange(false)
  }

  const loading = source === "designs" ? designs === null : templates === null
  const empty = source === "designs" ? shownDesigns.length === 0 : shownTemplates.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* WIDER, so the cards can be. At 2xl a four-column grid gave each design about
          150px — a thumbnail you squint at to tell two designs apart, which defeats a
          picker whose entire job is recognising one. */}
      {/* NARROWER THAN WHAT OPENS IT. This was max-w-4xl — 896px — and it opens ON TOP of
          the designer, which is 720px. A child picker wider than its parent reads as the
          bigger, more important window, and it was showing two thumbnails in it. Matched to
          the designer so the pair reads as one tool: pick a design, land back on the
          garment, same footprint. */}
      <DialogContent className="sm:max-w-[min(94vw,720px)]">
        <DialogHeader><DialogTitle>Choose from your library</DialogTitle></DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-border p-0.5 text-xs">
            {([["designs", "Designs", designs?.length], ["templates", "Templates", templates?.length]] as const).map(([id, label, n]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSource(id)}
                className={"eg-tap rounded-full px-3 py-1 font-medium transition-colors " + (source === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {label}{n != null ? ` ${n}` : ""}
              </button>
            ))}
          </div>
          <div className="relative min-w-[10rem] flex-1">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" className="h-9 pl-8" aria-label="Search your library" />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-14 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
          ) : empty ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              {source === "designs" ? <PenNib size={22} weight="duotone" /> : <Stack size={22} weight="duotone" />}
              {term
                ? `Nothing here matches “${q.trim()}”.`
                : source === "designs"
                  ? "No saved designs yet — create one in the Design Lab."
                  : "No templates yet — save one from the Design Lab and it shows up here."}
            </div>
          ) : (
            /* Three tracks at the top end rather than four, and two below — about 280px a
               card instead of 150px. A library is read by eye; the name underneath is the
               confirmation, not the identification. */
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {source === "designs" ? shownDesigns.map((d) => (
                <button
                  key={String(d.id)}
                  onClick={() => pick(d)}
                  disabled={loadingId != null}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border text-left transition-colors hover:border-primary hover:bg-accent disabled:opacity-60"
                >
                  <div className="relative flex aspect-square items-center justify-center bg-muted">
                    {d.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.thumb} alt={d.name ?? ""} className="size-full object-contain p-1" />
                    ) : (
                      <PenNib size={22} weight="duotone" className="text-muted-foreground/40" />
                    )}
                    {loadingId === d.id && <div className="absolute inset-0 flex items-center justify-center bg-background/60"><CircleNotch size={20} className="animate-spin text-primary" /></div>}
                  </div>
                  <div className="truncate p-2 text-xs font-medium">{d.name || "Untitled"}</div>
                </button>
              )) : shownTemplates.map((t) => (
                <button
                  key={String(t.id)}
                  onClick={() => pickTemplate(t)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border text-left transition-colors hover:border-primary hover:bg-accent"
                >
                  {/* THE COMPOSITE IS THE RIGHT THUMBNAIL, and the wrong thing to place: it
                      shows the artwork on its blank, which is what tells two templates
                      apart at this size. What gets placed is the artwork underneath it. */}
                  <div className="relative flex aspect-square items-center justify-center bg-muted">
                    {t.composite || artOf(t) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.composite || artOf(t)} alt={t.name ?? ""} className="size-full object-contain p-1" />
                    ) : (
                      <Stack size={22} weight="duotone" className="text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 p-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{t.name || "Untitled template"}</span>
                    {t.seq != null && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">TPL-{t.seq}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

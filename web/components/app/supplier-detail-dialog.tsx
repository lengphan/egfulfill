"use client"

import { useEffect, useState } from "react"
import { CircleNotch, Package, ShoppingCart, Plus } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { getSsStyle, getOttoStyle, getSanmarCatalogStyle } from "@/lib/api"

/**
 * ONE BLANK, IN FULL — the catalogue tile's picture is a thumbnail of a decision.
 *
 * A grid tile answers "is this roughly the thing"; it cannot answer "will this do", which is
 * what you actually need before putting a style on a purchase order. The colour it happens
 * to be photographed in is not the colour you want, the sizes are a count rather than a
 * list, and the description — where the fabric weight and the fit live — is not on the card
 * at all. Until now the only way to see any of that was to open the supplier's own site,
 * which means leaving, searching again, and reading it in their layout.
 *
 * All three suppliers return the same shape once you ask for a style — name, brand, category,
 * description, colours, sizes, per-colour images — so this is one window, not three. Which
 * fetcher runs is the only thing that differs.
 */

type Supplier = "ss" | "otto" | "sanmar"

/** The common shape the three detail endpoints collapse to. */
type Detail = {
  name: string
  brand?: string | null
  category?: string | null
  description?: string | null
  image?: string | null
  colors: string[]
  sizes: string[]
  colorImages: Record<string, string>
  skus: number
}

const SUPPLIER_NAME: Record<Supplier, string> = { ss: "S&S Activewear", otto: "Otto Cap", sanmar: "SanMar" }

/** Their descriptions arrive with markup and hard breaks; this is a catalogue blurb, not a
 *  document, so it renders as text rather than trusting a supplier's HTML into the page. */
const plain = (s?: string | null) =>
  String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()

export function SupplierDetailDialog({
  open, onOpenChange, supplier, styleId, seed, onOrder, onAddToCatalog, added,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  supplier: Supplier | null
  styleId: string | null
  /** What the card already knows, shown immediately so the window has content before the
   *  fetch lands — opening onto a spinner for a style you can already see is a step
   *  backwards from the tile you clicked. */
  seed?: { name?: string | null; brand?: string | null; image?: string | null; price?: string | null }
  onOrder?: () => void
  onAddToCatalog?: () => void
  added?: boolean
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [colour, setColour] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !supplier || !styleId) return
    let alive = true
    const t = setTimeout(() => {
      setD(null); setErr(null); setColour(null)
      const fetcher =
        supplier === "ss" ? getSsStyle(styleId)
          : supplier === "otto" ? getOttoStyle(styleId)
            : getSanmarCatalogStyle(styleId)
      fetcher
        .then((r) => {
          if (!alive) return
          const raw = r as Record<string, unknown>
          if (raw?.error) { setErr(String(raw.error)); return }
          setD({
            name: String(raw.name ?? raw.title ?? seed?.name ?? styleId),
            brand: (raw.brand as string) ?? seed?.brand ?? null,
            category: (raw.category as string) ?? null,
            description: (raw.description as string) ?? null,
            image: (raw.image as string) ?? seed?.image ?? null,
            colors: Array.isArray(raw.colors) ? (raw.colors as string[]) : [],
            sizes: Array.isArray(raw.sizes) ? (raw.sizes as string[]) : [],
            colorImages: (raw.colorImages as Record<string, string>) ?? {},
            skus: Array.isArray(raw.skus) ? (raw.skus as string[]).length : 0,
          })
        })
        .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Couldn't load this blank.") })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier, styleId])

  if (!open || !supplier || !styleId) return null

  // The colour you picked wins; otherwise the style's own photo. Falling back to the first
  // colour image would show a colour nobody chose, which is the mistake this window exists
  // to prevent on a purchase order.
  const shown = (colour && (d?.colorImages ?? {})[colour]) || d?.image || seed?.image || null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <Package size={16} weight="fill" className="shrink-0 text-muted-foreground" />
            <span className="truncate">{d?.name || seed?.name || styleId}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-border bg-white">
              {shown ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shown} alt="" className="absolute inset-0 size-full object-contain" />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-muted-foreground/60">No image</div>
              )}
            </div>
            {/* Swatches CHANGE THE PHOTO — the one thing the grid tile cannot do. Only the
                colours that actually carry an image, because a swatch that changes nothing
                reads as broken. */}
            {d && d.colors.filter((c) => d.colorImages[c]).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {d.colors.filter((c) => d.colorImages[c]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setColour(c === colour ? null : c)}
                    title={c}
                    className={"size-7 overflow-hidden rounded border transition-transform hover:scale-110 "
                      + (c === colour ? "border-primary ring-2 ring-primary/30" : "border-border")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.colorImages[c]} alt={c} className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-3 text-sm">
            {err && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}

            <div>
              {(d?.brand || seed?.brand) && (
                <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{d?.brand || seed?.brand}</div>
              )}
              <div className="text-xs text-muted-foreground">
                {[SUPPLIER_NAME[supplier], styleId, d?.category].filter(Boolean).join(" · ")}
              </div>
              {seed?.price && <div className="mt-1 font-semibold">{seed.price}</div>}
            </div>

            {!d && !err && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleNotch size={13} className="animate-spin" /> Loading the rest…
              </div>
            )}

            {d && (
              <>
                {plain(d.description) && (
                  <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {plain(d.description)}
                  </p>
                )}
                {/* Sizes as a LIST, not a count. "12 sizes" doesn't tell you whether it goes
                    to 4XL, which is the question actually being asked. */}
                <Field label={`Sizes${d.sizes.length ? ` (${d.sizes.length})` : ""}`}>
                  {d.sizes.length ? d.sizes.join(" · ") : "—"}
                </Field>
                <Field label={`Colours${d.colors.length ? ` (${d.colors.length})` : ""}`}>
                  {d.colors.length ? d.colors.join(" · ") : "—"}
                </Field>
                {d.skus > 0 && <Field label="Orderable skus">{d.skus.toLocaleString()}</Field>}
              </>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {onOrder && (
                <Button size="sm" variant="outline" onClick={onOrder}>
                  <ShoppingCart size={13} weight="bold" /> Order
                </Button>
              )}
              {onAddToCatalog && (
                <Button size="sm" onClick={onAddToCatalog} disabled={added}>
                  <Plus size={13} weight="bold" /> {added ? "In catalog" : "Add to catalog"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-xs">{children}</span>
    </div>
  )
}

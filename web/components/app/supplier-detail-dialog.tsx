"use client"

import { useEffect, useState } from "react"
import { CircleNotch, Package, ShoppingCart, Plus } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { getSsStyle, getOttoStyle, getSanmarCatalogStyle } from "@/lib/api"
import { swatchHex } from "@/components/app/products-catalog"

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
  /** null = we never asked (Otto / SanMar). {} = asked and the style has none. */
  stockByColor?: Record<string, number> | null
  stockByVariant?: Record<string, Record<string, number>> | null
}

const SUPPLIER_NAME: Record<Supplier, string> = { ss: "S&S Activewear", otto: "Otto Cap", sanmar: "SanMar" }

/** Their descriptions arrive with markup and hard breaks; this is a catalogue blurb, not a
 *  document, so it renders as text rather than trusting a supplier's HTML into the page. */
const plain = (s?: string | null) =>
  String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()

/**
 * A SPEC SHEET, not a paragraph.
 *
 * Suppliers ship these as one unpunctuated run — "95% Cotton / 5% Spandex Unstructured Soft
 * Crown Low-Fitting 6 Panel Flexible Fitted Cap Seamed Front Panel without Buckram 6 Sewn
 * Eyelets…" — which is a list of features wearing the shape of prose, and unreadable as
 * either. Each fragment is a separate fact you might be checking for, so they get separate
 * lines.
 *
 * Split on the punctuation they DO use (periods, semicolons, bullets, dashes between
 * clauses) and, failing that, on the capital that starts each new feature — but only when
 * the run is long enough that prose is clearly not what arrived. A short, real sentence is
 * left exactly as written.
 */
function specLines(raw?: string | null): string[] {
  const t = plain(raw)
  if (!t) return []
  const punctuated = t.split(/(?:\s*[•;]\s*)|(?:\.\s+)|(?:\s+[-–—]\s+)/).map((x) => x.trim()).filter(Boolean)
  if (punctuated.length > 2) return punctuated
  if (t.length < 140) return [t]
  // No punctuation and long: break before a capitalised word that follows a lowercase one,
  // which is where one feature ends and the next begins in these strings.
  return t.split(/(?<=[a-z%)])\s+(?=[A-Z][a-z])/).map((x) => x.trim()).filter(Boolean)
}

export function SupplierDetailDialog({
  open, onOpenChange, supplier, styleId, seed, onOrder, onAddToCatalog, added, onAddToCart,
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
  /** Put THIS variant in the purchasing cart. Given the choices made in this window, so
   *  nothing has to be re-picked on the way out. */
  onAddToCart?: (sel: { colour: string | null; size: string | null; qty: number }) => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [colour, setColour] = useState<string | null>(null)
  /**
   * THE VARIANT AND HOW MANY, decided here rather than back on the grid.
   *
   * This window is where you work out that it IS the right blank — the colour, the size run,
   * the fabric. Sending you back to a tile to press Order, and re-choosing the colour you
   * just chose here, is the pointless half of that journey.
   */
  const [size, setSize] = useState<string | null>(null)
  const [qty, setQty] = useState(1)

  useEffect(() => {
    if (!open || !supplier || !styleId) return
    let alive = true
    const t = setTimeout(() => {
      setD(null); setErr(null); setColour(null); setSize(null); setQty(1)
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
            // ABSENT MEANS UNKNOWN, NOT ZERO. Only S&S returns these — Otto and SanMar keep
            // no quantity in our data, and asking them costs a live call per sku / per style.
            // Defaulting the missing case to 0 would print "Out of stock" over two suppliers
            // we never asked, which is the one thing worse than not showing a number.
            stockByColor: (raw.stockByColor as Record<string, number>) ?? null,
            stockByVariant: (raw.stockByVariant as Record<string, Record<string, number>>) ?? null,
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
                {specLines(d.description).length > 0 && (
                  <ul className="max-h-40 space-y-1 overflow-y-auto pr-1 text-xs leading-relaxed text-muted-foreground">
                    {specLines(d.description).map((l, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                        <span className="min-w-0">{l}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Sizes as a LIST, not a count. "12 sizes" doesn't tell you whether it goes
                    to 4XL, which is the question actually being asked. */}
                {/* Sizes are PICKABLE, for the same reason the colours are: this is where
                    the choice is being made. Still a full list, so "does it reach 4XL" is
                    answered by looking rather than by counting. */}
                <Field label={`Sizes${d.sizes.length ? ` (${d.sizes.length})` : ""}`}>
                  {d.sizes.length ? (
                    <span className="flex flex-wrap gap-1">
                      {d.sizes.map((z) => (
                        <button
                          key={z}
                          type="button"
                          onClick={() => setSize(z === size ? null : z)}
                          className={"rounded-md border px-1.5 py-0.5 text-2xs font-medium transition-colors "
                            + (z === size ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
                        >
                          {z}
                        </button>
                      ))}
                    </span>
                  ) : "—"}
                </Field>
                {/* Names ran together into an unreadable line — "016 - White · 017 - Dk.
                    Green · 021 - Green · 030 - Sky Blue…" is fourteen facts in one sentence.
                    They are chips now: the ones with a photo show it, the rest show their
                    colour, and every one of them changes the picture. The name is on hover
                    and on the selected chip, which is the only moment it matters. */}
                <Field label={`Colours${d.colors.length ? ` (${d.colors.length})` : ""}`}>
                  {d.colors.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {d.colors.map((c) => (
                        <button
                          key={c}
                          type="button"
                          title={d.stockByColor ? `${c} — ${d.stockByColor[c] ?? 0} in stock at the supplier` : c}
                          onClick={() => setColour(c === colour ? null : c)}
                          className={"relative size-6 overflow-hidden rounded-full border transition-transform hover:scale-110 "
                            + (c === colour ? "border-primary ring-2 ring-primary/40" : "border-black/15")
                            // A colourway the supplier cannot fill is dimmed rather than hidden:
                            // it is still the colour the buyer asked for, and knowing it is
                            // unavailable is the point of showing it.
                            + (d.stockByColor && !(d.stockByColor[c] > 0) ? " opacity-35" : "")}
                          style={d.colorImages[c] ? undefined : { background: swatchHex(c) }}
                        >
                          {d.colorImages[c] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={d.colorImages[c]} alt={c} className="size-full object-cover" />
                          )}
                        </button>
                      ))}
                    </span>
                  ) : "—"}
                </Field>
                {d.skus > 0 && <Field label="Orderable skus">{d.skus.toLocaleString()}</Field>}
                {/**
                  * SUPPLIER STOCK, from the rows this dialog already fetched.
                  *
                  * Costs no extra request: `qty` rides along in the same S&S product feed the
                  * colours and sizes come from, so this is a sum, not a lookup.
                  *
                  * Shown ONLY when we actually asked. Otto and SanMar keep no quantity in our
                  * data, so the field is absent for them and this row does not render at all —
                  * far better than a confident "0" over a supplier nobody queried.
                  *
                  * Picking a colour narrows it to that colourway's sizes, because "480 in
                  * stock" across a style is not an answer to "can you make six 2XL".
                  */}
                {d.stockByColor && (
                  <Field label={colour ? `Stock · ${colour}` : "Stock"}>
                    {colour ? (
                      <span className="flex flex-wrap gap-1">
                        {Object.entries(d.stockByVariant?.[colour] ?? {}).length ? (
                          Object.entries(d.stockByVariant?.[colour] ?? {}).map(([z, n]) => (
                            <span
                              key={z}
                              className={"rounded-md px-1.5 py-0.5 text-2xs font-medium tabular-nums "
                                + (n > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground line-through")}
                            >
                              {z} {n.toLocaleString()}
                            </span>
                          ))
                        ) : <span className="text-muted-foreground">none for this colour</span>}
                      </span>
                    ) : (
                      <span className="tabular-nums">
                        {Object.values(d.stockByColor).reduce((a, b) => a + b, 0).toLocaleString()}
                        <span className="text-muted-foreground"> across {Object.keys(d.stockByColor).length} colour{Object.keys(d.stockByColor).length === 1 ? "" : "s"} — pick one for sizes</span>
                      </span>
                    )}
                  </Field>
                )}
              </>
            )}

            {/* What you picked, said back before anything is added — a cart line that turns
                out to be the wrong colourway is discovered on the PO, which is late. */}
            {onAddToCart && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <input
                  type="number" min={1} value={qty}
                  onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  aria-label="Quantity"
                  className="h-8 w-16 rounded-lg border border-border bg-card px-2 text-sm tabular-nums"
                />
                <Button size="sm" onClick={() => onAddToCart({ colour, size, qty })}>
                  <ShoppingCart size={13} weight="bold" /> Add to cart
                </Button>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {[colour, size].filter(Boolean).join(" / ") || "whole style — pick a colour and size"}
                </span>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {onOrder && (
                <Button size="sm" variant="outline" onClick={onOrder}>
                  <ShoppingCart size={13} weight="bold" /> Order
                </Button>
              )}
              {onAddToCatalog && (
                <Button size="sm" onClick={onAddToCatalog} disabled={added}>
                  <Plus size={13} weight="bold" /> {added ? "In Products" : "Add to Products"}
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

"use client"

import { useEffect, useState } from "react"
import { X, Printer, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getCatalogProducts, type CatalogProduct } from "@/lib/api"

const money = (n: number | string | null | undefined) =>
  n == null || n === "" ? "" : `$${(Number(n) || 0).toFixed(2)}`

type Swatch = { name?: string; color?: string; image?: string; img?: string; hex?: string }

/**
 * The catalogue as a printable document — a lookbook, not a spreadsheet.
 *
 * PRINTED BY THE BROWSER, not rendered on the server. Generating PDFs server-side means
 * either a headless browser (which will not fit on a 1GB droplet alongside Postgres) or a
 * PDF library that would need its own layout engine and its own image fetching. The browser
 * already has both, has the images in cache, and produces a real PDF through Save as PDF.
 * The label sheet in this codebase prints the same way, so the print CSS already exists.
 *
 * The CSV stays. It is for importing into someone else's system; this is for showing a
 * buyer what the product looks like. They are different jobs and the same file cannot do
 * both — a spreadsheet of image URLs is not a catalogue, which is the gap this closes.
 */
export function CatalogPrint({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<CatalogProduct[] | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      getCatalogProducts()
        .then((r) => setRows((r ?? []).filter((p) => p.inCatalog)))
        .catch(() => setRows([]))
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const variantsOf = (p: CatalogProduct) => {
    const raw = (p as unknown as { colors?: Swatch[] }).colors
    return Array.isArray(raw) ? raw.filter(Boolean) : []
  }
  const sizesOf = (p: CatalogProduct) => {
    const raw = (p as unknown as { sizePrices?: { size?: string }[] }).sizePrices
    return Array.isArray(raw) ? raw.map((s) => s?.size).filter(Boolean) as string[] : []
  }
  const imageOf = (p: CatalogProduct) =>
    (p as unknown as { image?: string; img?: string }).image ?? (p as unknown as { img?: string }).img ?? ""

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
      {/* The toolbar is screen-only — @media print hides anything outside .print-area, so
          the printed document starts at the first product rather than with a button. */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-white px-5 py-3 print:hidden">
        <span className="text-sm font-medium">
          {rows === null ? "Loading…" : `${rows.length} product${rows.length === 1 ? "" : "s"}`}
        </span>
        <span className="text-xs text-muted-foreground">
          Print → <strong>Save as PDF</strong>. Tick &ldquo;Background graphics&rdquo; or the swatches print blank.
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => window.print()} disabled={!rows?.length}>
            <Printer size={14} weight="bold" /> Print / Save as PDF
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}><X size={14} weight="bold" /> Close</Button>
        </div>
      </div>

      {/* Fixed A4 width so what's on screen is what lands on the page. Sizing by viewport
          would reflow at print time and the preview would be a guess. */}
      <div className="print-area mx-auto w-[210mm] px-8 py-8">
        <header className="mb-8 border-b border-black/10 pb-4">
          <h1 className="font-display text-3xl font-semibold">EGFULFILL</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Product catalogue · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
        </header>

        {rows === null ? (
          <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <CircleNotch size={16} className="animate-spin" /> Loading the catalogue…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Nothing is published yet — tick some products and publish them first.
          </p>
        ) : (
          <div className="space-y-6">
            {rows.map((p) => {
              const id = String(p.id ?? "")
              const colours = variantsOf(p)
              const sizes = sizesOf(p)
              const img = imageOf(p)
              return (
                // break-inside-avoid keeps a product whole: a card split across a page
                // fold shows an image on one sheet and its price on the next.
                <article key={id} className="flex gap-5 break-inside-avoid border-b border-black/5 pb-6 last:border-0">
                  <div className="size-40 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-neutral-50">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={p.name || id} className="size-full object-contain" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-muted-foreground">no image</div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3">
                      <h2 className="min-w-0 flex-1 text-lg font-semibold leading-tight">{p.name || id}</h2>
                      {/* The catalogue price, never base_price. This document goes to
                          buyers who are not our sellers. */}
                      <span className="shrink-0 text-lg font-semibold tabular-nums">{money(p.catalogPrice)}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">{p.sku || id}</div>

                    {(p as unknown as { description?: string }).description && (
                      <p className="mt-2 text-sm leading-snug text-neutral-700">
                        {(p as unknown as { description?: string }).description}
                      </p>
                    )}

                    {colours.length > 0 && (
                      <div className="mt-3">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Colours</div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {colours.slice(0, 24).map((c, i) => (
                            <span key={i} className="flex items-center gap-1.5 text-[11px]">
                              {(c.image || c.img) ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={c.image || c.img} alt="" className="size-5 rounded-full border border-black/10 object-cover" />
                              ) : (
                                <span className="size-4 rounded-full border border-black/10"
                                  style={{ background: c.hex || c.color || "#eee" }} />
                              )}
                              {c.name || c.color}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {sizes.length > 0 && (
                      <div className="mt-3">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sizes</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {sizes.map((s) => (
                            <span key={s} className="rounded border border-black/10 px-1.5 py-0.5 text-[11px]">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

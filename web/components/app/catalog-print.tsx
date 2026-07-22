"use client"

import { useEffect, useState } from "react"
import { X, Printer, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getLookbook, saveCatalogExport, getCatalogExport, type LookbookStyle } from "@/lib/api"

const money = (n: number | null | undefined) =>
  n == null ? "" : `$${(Number(n) || 0).toFixed(2)}`

/**
 * The catalogue as a printed lookbook — a page per style.
 *
 * LAID OUT AS A SPREAD, not a list. Hero shot and copy on the left, the colourway grid on
 * the right, each swatch captioned with its own sku and colour name. That grid is the page:
 * a buyer picks a colour by looking at it, and a list that names ten colours in a row of
 * text is asking them to imagine the product instead of showing it.
 *
 * PRINTED BY THE BROWSER. Server-side PDF means a headless browser, which will not fit on a
 * 1GB droplet beside Postgres, or a PDF library that needs its own layout engine and image
 * fetching. The browser has both, has the images cached, and Save as PDF produces a real
 * file. The label sheet prints the same way, so the print CSS already exists.
 */
export function CatalogPrint({ onClose, exportId }: { onClose: () => void; exportId?: string }) {
  const [rows, setRows] = useState<LookbookStyle[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      // A saved export reads its SNAPSHOT, never the live catalogue — reproducing what was
      // actually sent is the only reason it was kept.
      const load = exportId
        ? getCatalogExport(exportId).then((r) => { setTitle(r.title); return r.styles ?? [] })
        : getLookbook().then((r) => r.styles ?? [])
      load.then(setRows).catch((e: Error) => { setErr(e.message); setRows([]) })
    }, 0)
    return () => clearTimeout(t)
  }, [exportId])

  const save = async () => {
    if (!rows?.length) return
    try {
      const r = await saveCatalogExport({ styles: rows })
      if (r.error) throw new Error(r.error)
      setSaved(r.title || "Saved")
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    // eg-print-root is load-bearing: globals.css prints with
    // `body > *:not(.eg-print-root) { display: none }`, so an overlay without it is hidden
    // and the printer emits a blank sheet.
    <div className="eg-print-root fixed inset-0 z-50 overflow-y-auto bg-neutral-100">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-white px-5 py-3 print:hidden">
        <span className="text-sm font-medium">
          {title ?? (rows === null ? "Loading…" : `${rows.length} style${rows.length === 1 ? "" : "s"}`)}
        </span>
        {exportId && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">saved copy</span>}
        <span className="text-xs text-muted-foreground">
          Print → <strong>Save as PDF</strong>. Tick <strong>Background graphics</strong>, or the
          swatches and panels print white.
        </span>
        <div className="ml-auto flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-700">Saved — you can reopen this later.</span>}
          {/* Saving is separate from printing on purpose. Printing is a preview you might do
              five times; a saved copy is a record of what you SENT, and five identical rows
              in the history is a worse record than none. */}
          {!exportId && !saved && (
            <Button size="sm" variant="outline" onClick={save} disabled={!rows?.length}>Save this version</Button>
          )}
          <Button size="sm" onClick={() => window.print()} disabled={!rows?.length}>
            <Printer size={14} weight="bold" /> Print / Save as PDF
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}><X size={14} weight="bold" /> Close</Button>
        </div>
      </div>

      <div className="print-area mx-auto">
        {rows === null ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <CircleNotch size={16} className="animate-spin" /> Building the catalogue…
          </div>
        ) : err ? (
          <p className="py-24 text-center text-sm text-destructive">Couldn&apos;t load the catalogue: {err}</p>
        ) : rows.length === 0 ? (
          <p className="py-24 text-center text-sm text-muted-foreground">
            Nothing is published yet — publish some products or supplier styles first.
          </p>
        ) : (
          rows.map((st) => (
            // ONE STYLE PER PAGE. A4 at 210×297mm with the page break forced after each,
            // so a colourway grid never starts on one sheet and finishes on the next —
            // which is the one thing that makes a printed catalogue look homemade.
            <section
              key={st.ref}
              className="eg-sheet mx-auto mb-6 flex w-[210mm] flex-col bg-white p-[14mm] shadow-sm print:mb-0 print:shadow-none"
              style={{ minHeight: "297mm" }}
            >
              {/* PRICE FIRST, top right, in the display face. It was tucked at the foot of
                  the left column where a buyer had to hunt for it — on a page whose job is
                  to sell, the number belongs where the eye lands. */}
              <div className="mb-6 flex items-start justify-between gap-6 border-b border-neutral-200 pb-4">
                <div className="min-w-0">
                  <h2 className="font-display text-3xl font-bold uppercase leading-none tracking-tight">{st.name}</h2>
                  <div className="mt-1.5 flex items-baseline gap-2 text-xs text-neutral-500">
                    <span className="font-mono">{st.sku}</span>
                    {st.brand && <span>· {st.brand}</span>}
                  </div>
                </div>
                {st.price != null && (
                  <div className="shrink-0 text-right">
                    <div className="font-display text-4xl font-bold leading-none tabular-nums">{money(st.price)}</div>
                    <div className="mt-1 text-[9px] uppercase tracking-widest text-neutral-400">per unit</div>
                  </div>
                )}
              </div>

              <div className="grid flex-1 grid-cols-2 gap-8">
                {/* LEFT — the product itself, big. */}
                <div className="flex flex-col">
                  <div className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-lg bg-neutral-50">
                    {st.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={st.image} alt={st.name} className="size-full object-contain" />
                    ) : (
                      <span className="text-xs text-neutral-400">no image</span>
                    )}
                  </div>

                  {st.description
                    ? <p className="mt-4 text-[11px] leading-relaxed text-neutral-600">{st.description}</p>
                    // No description on most supplier styles, and an empty column reads as
                    // an unfinished page. The size run fills it as a chart instead, which
                    // is the thing a buyer would otherwise have to ask for.
                    : null}

                  {st.sizes.length > 0 && (
                    <div className="mt-5">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                        Available sizes
                      </div>
                      {/* A CHART, not a row of chips. The chips left a band of white across
                          the page; a bordered strip fills it and reads as a spec table,
                          which is what a buyer is looking for anyway. */}
                      <div className="mt-2 flex overflow-hidden rounded border border-neutral-300">
                        {st.sizes.map((z) => (
                          <div key={z} className="flex-1 border-r border-neutral-200 px-1 py-2 text-center text-[11px] font-semibold last:border-r-0">
                            {z}
                          </div>
                        ))}
                      </div>
                      <div className="mt-1.5 text-[9px] text-neutral-400">
                        {st.colors.length} colourway{st.colors.length === 1 ? "" : "s"} · {st.sizes.length} size{st.sizes.length === 1 ? "" : "s"} available
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT — every colourway, captioned. */}
                <div className="flex flex-col">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                    Available colours
                  </div>
                  {st.colors.length === 0 ? (
                    <p className="mt-2 text-[11px] text-neutral-400">
                      No colourway images on this style.
                    </p>
                  ) : (
                    // Five columns, capped at 20. Past that a page stops being readable and
                    // the overflow is stated rather than silently dropped.
                    <div className="mt-2 grid grid-cols-4 gap-x-3 gap-y-4">
                      {st.colors.slice(0, 20).map((c) => (
                        <div key={c.name + c.sku} className="flex flex-col items-center">
                          <div className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded bg-neutral-50">
                            {c.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.image} alt={c.name} className="size-full object-contain" />
                            ) : (
                              <span className="px-1 text-center text-[7px] leading-tight text-neutral-400">{c.name}</span>
                            )}
                          </div>
                          {/* SKU then colour, the way a buyer reads it back to you when
                              they order — the name alone is not orderable. */}
                          {c.sku && <div className="mt-1.5 w-full truncate text-center font-mono text-[7px] text-neutral-500">{c.sku}</div>}
                          <div className="w-full truncate text-center text-[8px] font-medium leading-tight text-neutral-700">{c.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {st.colors.length > 20 && (
                    <p className="mt-2 text-[9px] text-neutral-500">
                      + {st.colors.length - 20} more colours — ask us for the full range.
                    </p>
                  )}
                </div>
              </div>

              <footer className="mt-6 flex items-center justify-between border-t border-neutral-200 pt-3 text-[9px] text-neutral-400">
                <span className="font-display text-sm font-semibold tracking-tight text-neutral-700">EGFULFILL</span>
                <span>{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
              </footer>
            </section>
          ))
        )}
      </div>

      {/* One sheet per page, and the shadow/gap that make it look like paper on screen are
          removed in print — a printed drop shadow is a grey smear. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          .eg-sheet { break-after: page; page-break-after: always; box-shadow: none !important; margin: 0 !important; }
          .eg-sheet:last-child { break-after: auto; page-break-after: auto; }
          .eg-print-root { background: #fff !important; }
        }
      `}</style>
    </div>
  )
}

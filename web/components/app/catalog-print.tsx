"use client"

import { useEffect, useState } from "react"
import { X, Printer, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getLookbook, type LookbookStyle } from "@/lib/api"

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
export function CatalogPrint({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<LookbookStyle[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      getLookbook()
        .then((r) => setRows(r.styles ?? []))
        .catch((e: Error) => { setErr(e.message); setRows([]) })
    }, 0)
    return () => clearTimeout(t)
  }, [])

  return (
    // eg-print-root is load-bearing: globals.css prints with
    // `body > *:not(.eg-print-root) { display: none }`, so an overlay without it is hidden
    // and the printer emits a blank sheet.
    <div className="eg-print-root fixed inset-0 z-50 overflow-y-auto bg-neutral-100">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-white px-5 py-3 print:hidden">
        <span className="text-sm font-medium">
          {rows === null ? "Loading…" : `${rows.length} style${rows.length === 1 ? "" : "s"}`}
        </span>
        <span className="text-xs text-muted-foreground">
          Print → <strong>Save as PDF</strong>. Tick <strong>Background graphics</strong>, or the
          swatches and panels print white.
        </span>
        <div className="ml-auto flex gap-2">
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

                  <h2 className="mt-5 font-display text-2xl font-bold uppercase leading-tight tracking-tight">
                    {st.name}
                  </h2>
                  <div className="mt-1 flex items-baseline gap-2 text-xs text-neutral-500">
                    <span className="font-mono">{st.sku}</span>
                    {st.brand && <span>· {st.brand}</span>}
                  </div>

                  {st.description && (
                    <p className="mt-3 text-[11px] leading-relaxed text-neutral-600">{st.description}</p>
                  )}

                  {st.sizes.length > 0 && (
                    <div className="mt-4">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                        Available sizes
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {st.sizes.map((z) => (
                          <span key={z} className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-medium">
                            {z}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* The price sits with the product, not in the colour grid — it's the
                      same for every colourway, and repeating it under ten swatches reads
                      as ten different prices. */}
                  {st.price != null && (
                    <div className="mt-auto pt-4 text-2xl font-semibold tabular-nums">{money(st.price)}</div>
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
                    <div className="mt-2 grid grid-cols-5 gap-x-2 gap-y-3">
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
                          {c.sku && <div className="mt-1 w-full truncate text-center font-mono text-[6px] text-neutral-500">{c.sku}</div>}
                          <div className="w-full truncate text-center text-[7px] leading-tight text-neutral-700">{c.name}</div>
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

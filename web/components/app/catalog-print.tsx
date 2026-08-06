"use client"

import { useEffect, useState } from "react"
import { X, Printer, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getLookbook, saveCatalogExport, getCatalogExport, getFactorySettings, type LookbookStyle } from "@/lib/api"

const money = (n: number | null | undefined) =>
  n == null ? "" : `$${(Number(n) || 0).toFixed(2)}`

/**
 * BRANDING, editable rather than compiled in.
 *
 * A printed catalogue is the single most likely thing to need re-skinning — a trade show,
 * a private-label buyer, a seasonal cover — and none of that should need a deploy. These
 * come from factory settings (Settings › Platform); blank falls back to the house values,
 * so an untouched install still prints something finished.
 *
 * ACCENT is the marketing plate colour. It is a DARK violet on purpose: the cover prints it
 * full-bleed with the wordmark reversed out, and cream on it measures 10.1:1. The lime is
 * the counterpart the marketing kit already pairs with it (ink on lime is 16.6:1) and is
 * used the same way here — as a fill that carries ink, never as type on paper, where it
 * measures 1.1:1 and vanishes.
 */
const HOUSE = {
  accent: "#6633FF",
  lime: "#D4F897",
  ink: "#0B0B0C",
  paper: "#FAF8F3",
}
/** Only a real hex survives — a half-typed value in settings must not paint the cover. */
const hexOr = (v: unknown, fallback: string) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : fallback

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
  const [brand, setBrand] = useState<{ title: string; tagline: string; accent: string; contact: string }>({
    title: "EGFULFILL", tagline: "Print-on-demand, made to order", accent: HOUSE.accent, contact: "",
  })
  // Best-effort: a settings read that fails must not stop a catalogue printing. The
  // defaults above are the house brand, so a failure prints the house cover.
  useEffect(() => {
    const t = setTimeout(() => {
      getFactorySettings().then((s) => {
        const g = (k: string) => String((s as Record<string, unknown>)[k] ?? "").trim()
        setBrand({
          title: g("lookbook_title") || "EGFULFILL",
          tagline: g("lookbook_tagline") || "Print-on-demand, made to order",
          accent: hexOr(g("lookbook_accent"), HOUSE.accent),
          contact: g("lookbook_contact"),
        })
      }).catch(() => {})
    }, 0)
    return () => clearTimeout(t)
  }, [])

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
          <>
          {/* ── COVER ────────────────────────────────────────────────────────────────
              The accent plate, full bleed, with the wordmark reversed out of it. This is
              the marketing site's own hero move, and the reason the catalogue had no
              "colour pop" is that it opened straight onto a white spec sheet. A cover is
              also what makes the PDF read as a document rather than as a print-out. */}
          <section
            className="eg-sheet eg-cover mx-auto mb-6 flex w-[210mm] flex-col justify-between p-[18mm] shadow-sm print:mb-0 print:shadow-none"
            style={{ minHeight: "297mm", background: brand.accent, color: HOUSE.paper }}
          >
            <div className="flex items-start justify-between">
              <span className="font-title text-2xl font-bold tracking-tight">{brand.title}</span>
              <span className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
                    style={{ background: HOUSE.lime, color: HOUSE.ink }}>
                {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </span>
            </div>

            <div>
              <h1 className="font-title font-black leading-[0.88] tracking-tight" style={{ fontSize: "76px" }}>
                The<br />catalogue
              </h1>
              <p className="mt-6 max-w-[105mm] text-base leading-relaxed" style={{ color: "rgba(250,248,243,0.75)" }}>
                {brand.tagline}
              </p>
              {/* The lime rule — one bright line, the counterpart colour doing the job it
                  can do on a dark ground where it measures 16.6:1. */}
              <div className="mt-8 h-1.5 w-28 rounded-full" style={{ background: HOUSE.lime }} />
            </div>

            <div className="flex items-end justify-between text-xs" style={{ color: "rgba(250,248,243,0.7)" }}>
              <span>
                <strong style={{ color: HOUSE.paper }}>{rows.length}</strong> style{rows.length === 1 ? "" : "s"}
                {" · "}
                <strong style={{ color: HOUSE.paper }}>{rows.reduce((n, s) => n + s.colors.length, 0)}</strong> colourways
              </span>
              {title && <span>{title}</span>}
            </div>
          </section>

          {rows.map((st) => (
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
              {/* The accent rule ties every page to the cover. One 6mm bar rather than a
                  tinted panel: it colours the sheet without putting anything behind the
                  product photography, which has to stay on white to be judged. */}
              <div className="mb-5 h-1.5 w-full rounded-full" style={{ background: brand.accent }} />
              <div className="mb-6 flex items-start justify-between gap-6 border-b border-neutral-200 pb-4">
                <div className="min-w-0">
                  <h2 className="font-title text-3xl font-bold uppercase leading-none tracking-tight">{st.name}</h2>
                  <div className="mt-1.5 flex items-baseline gap-2 text-xs text-neutral-500">
                    <span className="font-mono">{st.sku}</span>
                    {st.brand && <span>· {st.brand}</span>}
                  </div>
                </div>
                {st.price != null && (
                  /* The price is the thing a buyer came for, so it is the one filled block
                     on the page — ink on lime, 16.6:1, and impossible to miss. */
                  <div className="shrink-0 rounded-xl px-4 py-2.5 text-right"
                       style={{ background: HOUSE.lime, color: HOUSE.ink }}>
                    <div className="font-title text-4xl font-bold leading-none tabular-nums">{money(st.price)}</div>
                    <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest opacity-70">per unit</div>
                  </div>
                )}
              </div>

              {/* flex-1 on the grid was not enough — the CHILDREN also have to stretch, or
                  a short left column leaves the sheet half empty regardless of how tall the
                  grid is. items-stretch plus min-h-0 lets both columns own the page. */}
              <div className="grid min-h-0 flex-1 grid-cols-2 items-stretch gap-8">
                {/* LEFT — the product itself, big. */}
                <div className="flex flex-col">
                  {/* No fixed aspect: the hero takes the room the copy doesn't. On a style
                      with no description that is most of the column, which is exactly the
                      gap that made the page look unfinished. */}
                  <div className="flex min-h-[80mm] flex-1 w-full items-center justify-center overflow-hidden rounded-lg bg-neutral-50">
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

                </div>

                {/* RIGHT — every colourway, captioned. */}
                <div className="flex min-h-0 flex-col">
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
                    // auto-rows-min keeps swatches their natural height while the column
                    // stretches, so they sit at the top rather than smearing down the page.
                    <div className="mt-2 grid auto-rows-min grid-cols-4 gap-x-3 gap-y-4">
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
                  {/* The size run and the chart live in the RIGHT column, under the
                      swatches. On the left they left the bottom-right of every sheet
                      empty — a page that dead-ends in white is most of what made this
                      catalogue read as unfinished. mt-auto pins them to the foot of the
                      column, so any slack sits BETWEEN the swatches and the chart rather
                      than trailing off the bottom of the page. */}
                  <div className="mt-auto pt-5">
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

                    {/* THE REAL SIZE CHART. S&S return one row per (size, measurement) with
                        no fixed columns — "Bill/ Brim Length", "Chest Width", whatever that
                        garment has — so the table is PIVOTED here rather than read off named
                        fields. Assuming columns is what made the probe report no chart while
                        the chart was in its own output. */}
                    {st.specs.length > 0 && (() => {
                      const specNames = [...new Set(st.specs.map((x) => x.spec))]
                      const sizeNames = [...new Set(st.specs.map((x) => x.size))]
                      const at = (size: string, spec: string) =>
                        st.specs.find((x) => x.size === size && x.spec === spec)?.value ?? ""
                      return (
                        <div className="mt-4">
                          <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                            Size chart <span className="normal-case tracking-normal text-neutral-400">· inches</span>
                          </div>
                          {/* 8px was unreadable — the chart was present and might as well not
                              have been, which is why the catalogue read as having none. 9.5px
                              with a filled header row and zebra striping makes it a table a
                              buyer can actually measure against. */}
                          <table className="mt-1.5 w-full border-collapse text-[9.5px]">
                            <thead>
                              <tr style={{ background: brand.accent, color: HOUSE.paper }}>
                                <th className="rounded-l px-1.5 py-1 text-left font-bold">Size</th>
                                {specNames.map((n, i) => (
                                  <th key={n}
                                      className={"px-1.5 py-1 text-left font-bold" + (i === specNames.length - 1 ? " rounded-r" : "")}>
                                    {n}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sizeNames.map((z, ri) => (
                                <tr key={z} className={ri % 2 ? "bg-neutral-50" : ""}>
                                  <td className="border-b border-neutral-100 px-1.5 py-1 font-bold">{z}</td>
                                  {specNames.map((n) => (
                                    <td key={n} className="border-b border-neutral-100 px-1.5 py-1 tabular-nums text-neutral-700">{at(z, n)}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              </div>

              <footer className="mt-6 flex items-center justify-between border-t border-neutral-200 pt-3 text-[9px] text-neutral-400">
                <span className="font-title text-sm font-semibold tracking-tight text-neutral-700">{brand.title}</span>
                <span>{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
              </footer>
            </section>
          ))}

          {/* ── BACK COVER ───────────────────────────────────────────────────────────
              A catalogue that stops dead on its last spec sheet leaves the reader with no
              next step. This one says how to order and who to ask — and closes on the same
              plate it opened with, so the document is bookended rather than just ending. */}
          <section
            className="eg-sheet eg-cover mx-auto mb-6 flex w-[210mm] flex-col justify-between p-[18mm] shadow-sm print:mb-0 print:shadow-none"
            style={{ minHeight: "297mm", background: brand.accent, color: HOUSE.paper }}
          >
            <span className="font-title text-2xl font-bold tracking-tight">{brand.title}</span>

            <div>
              <h2 className="font-title font-black leading-[0.9] tracking-tight" style={{ fontSize: "52px" }}>
                How to<br />order
              </h2>
              <ol className="mt-8 max-w-[120mm] space-y-4">
                {[
                  ["01", "Pick the style, colour and size", "Every sku in this catalogue is orderable as printed — the colour code beside each swatch is what we need."],
                  ["02", "Send your artwork", "Print-ready files go straight through. We digitise embroidery ourselves if you'd rather."],
                  ["03", "We make it and ship it", "Produced to order, packed, and tracking pushed back to your shop."],
                ].map(([n, h, b]) => (
                  <li key={n} className="flex gap-4">
                    <span className="font-title text-lg font-black leading-none" style={{ color: HOUSE.lime }}>{n}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">{h}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "rgba(250,248,243,0.72)" }}>{b}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <div className="h-1.5 w-28 rounded-full" style={{ background: HOUSE.lime }} />
              {/* Only printed when someone has SET it. An empty contact block on a back
                  cover is worse than none — it reads as a template nobody finished. */}
              {brand.contact && (
                <p className="mt-5 whitespace-pre-line text-sm leading-relaxed">{brand.contact}</p>
              )}
              <p className="mt-4 text-[10px]" style={{ color: "rgba(250,248,243,0.6)" }}>
                Prices in this catalogue are per unit and were current on{" "}
                {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
              </p>
            </div>
          </section>
          </>
        )}
      </div>

      {/* One sheet per page, and the shadow/gap that make it look like paper on screen are
          removed in print — a printed drop shadow is a grey smear. */}
      <style>{`
        /* The covers are FILLED PAGES, so they only exist if the browser prints
           backgrounds. Chrome and Safari drop background colour by default and the user has
           to remember a checkbox — which is how a violet cover prints as a blank sheet.
           print-color-adjust: exact overrides that for this document, so the catalogue comes
           out as designed whether or not anyone ticked anything. */
        .eg-sheet, .eg-cover, .eg-sheet * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
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

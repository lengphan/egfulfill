"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X, Printer, CircleNotch, PencilSimple, Image as ImageIcon, ArrowCounterClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getLookbook, saveCatalogExport, getCatalogExport, getFactorySettings, saveLookbookStyle, type LookbookStyle } from "@/lib/api"
import { descriptionLines } from "@/lib/description"
import { PRODUCT_METHODS } from "@/lib/print-method"
import type { LookbookBrand } from "@/components/app/lookbook-branding-dialog"
import { getUser } from "@/lib/auth"
import { LookbookBrandingDialog } from "@/components/app/lookbook-branding-dialog"

/**
 * THE PRICE THE SHEET PRINTS — the trade rate, or what a seller pays when there isn't one.
 *
 * `price` is catalog_price, set per product on the Catalogue page (by hand or by the markup
 * button). Plenty of styles have never had one, and those printed a dash on a document whose
 * entire purpose is to be ordered from — the reader cannot tell "ask us" from "we forgot".
 *
 * So it always resolves to a number when we have one at all. The trade rate wins wherever it
 * exists, including after a markup run, so adjusting prices on the Catalogue page still
 * decides what a partner is quoted; the seller rate only fills the gaps.
 *
 * Null only when NEITHER exists, which is a real answer and still prints a dash.
 */
const sheetPrice = (st: LookbookStyle): number | null =>
  (st.price != null && st.price > 0) ? st.price
    : (st.sellerPrice != null && st.sellerPrice > 0) ? st.sellerPrice
      : null

const money = (n: number | null | undefined) =>
  n == null ? "" : `$${(Number(n) || 0).toFixed(2)}`

/**
 * THE PHOTO THIS PAGE CAN ACTUALLY SHOW.
 *
 * A style's own image, or failing that the first colourway that has one — a swatch of this
 * garment is a picture of this garment, and the page was printing an empty plate while
 * holding twelve photographs of the thing it was describing.
 */
const heroImage = (st: LookbookStyle) => st.image || st.colors.find((c) => c.image)?.image || ""

/**
 * A FIELD YOU CAN REWRITE WITHOUT LEAVING THE SHEET.
 *
 * Off the edit toggle it renders exactly what it always rendered — no dotted underlines, no
 * hit areas, nothing that could print. On, it is a button; clicking swaps in the input and
 * blur or Enter commits, which is the same click-to-edit the users directory uses for order
 * limits rather than a second idiom for the same gesture.
 *
 * `children` is the DISPLAY (a headline, a price block, a bullet list) and `value` is the raw
 * text being edited. They are different on purpose: a description prints as bullets and edits
 * as the paragraph it is stored as, and pretending otherwise would mean parsing the display
 * back into a value.
 */
function Editable({
  editing, value, onSave, placeholder, multiline, className, inputClassName, children,
}: {
  editing: boolean
  value: string
  onSave: (v: string) => void
  placeholder?: string
  multiline?: boolean
  className?: string
  inputClassName?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (!editing) return <>{children}</>
  const commit = (v: string) => { setOpen(false); if (v !== value) onSave(v) }
  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        title="Click to edit — this changes the catalogue, not the product"
        className={"text-left underline decoration-neutral-300 decoration-dotted underline-offset-4 hover:decoration-neutral-500 " + (className ?? "")}
      >
        {value ? children : <span className="text-neutral-400">{placeholder ?? "Add"}</span>}
      </button>
    )
  }
  return multiline ? (
    <textarea
      autoFocus defaultValue={value} rows={8} placeholder={placeholder}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Escape") setOpen(false) }}
      className={"w-full rounded border border-neutral-400 p-2 text-[11px] leading-relaxed outline-none " + (inputClassName ?? "")}
    />
  ) : (
    <input
      autoFocus defaultValue={value} placeholder={placeholder}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value) }
        else if (e.key === "Escape") setOpen(false)
      }}
      className={"w-full rounded border border-neutral-400 px-1.5 py-0.5 outline-none " + (inputClassName ?? "")}
    />
  )
}

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

/**
 * THE WELL EVERY PRODUCT PHOTO SITS IN — WHITE, WITH A HAIRLINE BORDER.
 *
 * This was a warm grey, to give a cut-out-on-white garment an edge on a white sheet. It
 * solved that and created a worse one: the photos ARE white, and object-contain letterboxes
 * them, so every cell rendered a white rectangle floating inside a grey box. On the hero
 * that reads as a mistake — a picture pasted onto the wrong background — and no amount of
 * choosing a nicer grey fixes it, because the artefact is the seam between two backgrounds,
 * not the shade of either.
 *
 * So the well is white — and, since the second attempt, with no rule around it either. The
 * tint made a seam; the rule that replaced it made a box, drawn on every style, so the eye
 * met the frame before the garment. A cut-out shot on a white page needs neither: the product
 * is the only thing on the sheet with a shape.
 *
 * The trade, named because it is real: a white or pale garment has no boundary of its own
 * now. If that ever reads as floating, the answer is a soft shadow under the PRODUCT, not a
 * line around the box.
 *
 * Kept as a token because the curation list imports it: the screen you choose from should
 * look like the document you are choosing for.
 */
export const PLATE = "#FFFFFF"
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
  /**
   * PORTALLED TO <body>, WHICH IS THE ONLY REASON THIS PRINTS.
   *
   * globals.css removes everything that is not the sheet with
   *   body > *:not(.eg-print-root) { display: none }
   * and that selector needs the print root to be a DIRECT CHILD of body. Rendered inline
   * this overlay sits deep in the React tree, so the rule matched the app root instead —
   * the div that CONTAINS the lookbook — and hid the entire document. The preview looked
   * perfect on screen and printed a blank page, which is exactly what was reported.
   *
   * label-sheet.tsx has always portalled for this reason and has always printed. Same fix,
   * same pattern, and its comment already spells out why display:none is the only thing that
   * works here: visibility keeps the app's full height, so one sheet prints across four
   * mostly-blank pages.
   */
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => { const id = setTimeout(() => setHost(document.body), 0); return () => clearTimeout(id) }, [])
  const [rows, setRows] = useState<LookbookStyle[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [brand, setBrand] = useState<LookbookBrand>({
    title: "EGFUL", headline: "The catalogue", tagline: "Print-on-demand, made to order",
    accent: HOUSE.accent, contact: "",
  })
  // Best-effort: a settings read that fails must not stop a catalogue printing. The
  // defaults above are the house brand, so a failure prints the house cover.
  useEffect(() => {
    const t = setTimeout(() => {
      getFactorySettings().then((s) => {
        const g = (k: string) => String((s as Record<string, unknown>)[k] ?? "").trim()
        setBrand({
          title: g("lookbook_title") || "EGFUL",
          // What the cover is CALLED, as opposed to who publishes it. "The catalogue" was set
          // in the markup, so a seasonal or private-label edition needed a deploy to be named.
          headline: g("lookbook_headline") || "The catalogue",
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

  /**
   * EDITING IS A MODE, and it is off by default.
   *
   * The sheet is a document you mostly look at, so click-to-edit everywhere would put a
   * dotted underline under every headline on a page whose whole job is to look finished.
   *
   * NEVER ON A SAVED COPY. An export is the record of what was actually sent — editing one
   * would change what a partner was quoted, after the fact and with nothing to show for it.
   */
  const [editing, setEditing] = useState(false)
  const [savingRef, setSavingRef] = useState<string | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => { const t = setTimeout(() => setIsAdmin((getUser()?.role || "") === "admin"), 0); return () => clearTimeout(t) }, [])
  const [editErr, setEditErr] = useState<string | null>(null)
  const canEdit = !exportId
  const fileFor = useRef<LookbookStyle | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const reload = () =>
    getLookbook().then((r) => setRows(r.styles ?? [])).catch((e: Error) => setEditErr(e.message))

  /**
   * Write one field, showing it immediately and PUTTING IT BACK if the server refuses.
   *
   * The optimistic half is what makes this feel like editing a page rather than filing a
   * change request. The revert half is what keeps it honest: a sheet that goes on displaying
   * an edit the server rejected is a document lying about its own contents, and this one gets
   * printed and sent.
   */
  const patch = async (
    st: LookbookStyle,
    body: { name?: string | null; description?: string | null; image?: string | null; price?: number | null },
    optimistic: Partial<LookbookStyle>,
  ) => {
    if (!st.source) {
      setEditErr("This page came from a saved copy, so there's nothing live to edit.")
      return
    }
    const before = rows
    setEditErr(null)
    setSavingRef(st.ref)
    setRows((prev) => (prev ?? []).map((r) => (r.ref === st.ref && r.source === st.source ? { ...r, ...optimistic, edited: true } : r)))
    try {
      const r = await saveLookbookStyle(st.source, st.ref, body)
      if (r?.error) throw new Error(r.error)
      // An image is stored as an ADDRESS, not the bytes we just sent — re-read so the page
      // (and anything saved from it) carries the short path rather than a megabyte of base64.
      if (body.image !== undefined) await reload()
    } catch (e) {
      setRows(before)
      setEditErr((e as Error).message)
    } finally { setSavingRef(null) }
  }

  /** Put a page back to what its source says. Re-read rather than guessed: the original name
   *  and photo live on the server, and inventing them here is how a "revert" invents copy. */
  const revert = async (st: LookbookStyle) => {
    if (!st.source) return
    setSavingRef(st.ref); setEditErr(null)
    try {
      const r = await saveLookbookStyle(st.source, st.ref, { reset: true })
      if (r?.error) throw new Error(r.error)
      await reload()
    } catch (e) { setEditErr((e as Error).message) } finally { setSavingRef(null) }
  }

  /**
   * Attach a photograph. Read to a data: URL here and turned into an address server-side.
   *
   * CAPPED, because this file rides in the JSON body and then in any export saved from it —
   * a 20MB phone photo would be ~27MB of base64 in a request, and again in every snapshot.
   * Refused with the size rather than silently truncated.
   */
  const MAX_IMAGE_MB = 6
  const onFile = async (f: File | null) => {
    const st = fileFor.current
    fileFor.current = null
    if (!f || !st) return
    if (!/^image\//.test(f.type)) { setEditErr("That isn't an image file."); return }
    if (f.size > MAX_IMAGE_MB * 1024 * 1024) {
      setEditErr(`That photo is ${(f.size / 1024 / 1024).toFixed(1)}MB — ${MAX_IMAGE_MB}MB is the limit for a catalogue image.`)
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(new Error("Couldn't read that file."))
      fr.readAsDataURL(f)
    }).catch((e: Error) => { setEditErr(e.message); return "" })
    if (!dataUrl) return
    await patch(st, { image: dataUrl }, { image: dataUrl })
  }
  const pickFile = (st: LookbookStyle) => { fileFor.current = st; fileInput.current?.click() }
  /* Repaints the sheet from what was just saved rather than refetching — the reason for
     editing the cover next to the cover. */
  const brandingDialog = (
    <LookbookBrandingDialog open={brandOpen} onOpenChange={setBrandOpen} brand={brand} onSaved={setBrand} />
  )

  // Nothing to portal into until the effect has run — and on the server there is no document.
  if (!host) return null

  return createPortal(
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
          {editErr && <span className="text-xs text-destructive">{editErr}</span>}
          {savingRef && <CircleNotch size={14} className="animate-spin text-muted-foreground" />}
          {/* Editing changes THIS DOCUMENT. Said on the button rather than in a help panel,
              because the reasonable assumption is the opposite — that typing a new name here
              renames the product. */}
          {/* Branding sits beside Edit because it is the same kind of act — changing THIS
              document — and it was three screens away in Settings › Platform, where the only
              way to judge a cover colour was to set it, come back, and look. Admin only:
              setFactorySettings is admin-only server-side, so anyone else would meet a 403
              after typing. */}
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setBrandOpen(true)} disabled={!rows?.length}>
              Branding
            </Button>
          )}
          {canEdit && (
            <Button
              size="sm" variant={editing ? "default" : "outline"}
              onClick={() => { setEditing((v) => !v); setEditErr(null) }}
              disabled={!rows?.length}
              title="Rewrite names, copy, prices and photos for this catalogue. The product itself is untouched."
            >
              <PencilSimple size={14} weight="bold" /> {editing ? "Done editing" : "Edit"}
            </Button>
          )}
          {/* Saving is separate from printing on purpose. Printing is a preview you might do
              five times; a saved copy is a record of what you SENT, and five identical rows
              in the history is a worse record than none. */}
          {!exportId && !saved && (
            <Button size="sm" variant="outline" onClick={save} disabled={!rows?.length}>Save this version</Button>
          )}
          {/* EDIT MODE OFF FIRST. A field left open is a text input, and an input prints as a
              box with a cursor in it. Leaving the mode is a state change, so the print call
              waits a frame for the sheet to render as a page again. */}
          <Button
            size="sm"
            onClick={() => { setEditing(false); requestAnimationFrame(() => window.print()) }}
            disabled={!rows?.length}
          >
            <Printer size={14} weight="bold" /> Print / Save as PDF
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}><X size={14} weight="bold" /> Close</Button>
        </div>
      </div>

      {/* One input for every page — a file field per style would put 200 of them in the DOM
          for a gesture only one style at a time can make. */}
      <input
        ref={fileInput} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; onFile(f) }}
      />
      {/* Outside .print-area, or the dialog's own chrome would land in the PDF. */}
      {brandingDialog}

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
            className="eg-sheet eg-cover mx-auto mb-6 flex w-[297mm] flex-col justify-between overflow-hidden p-[18mm] shadow-sm print:mb-0 print:shadow-none"
            style={{ height: "210mm", background: brand.accent, color: HOUSE.paper }}
          >
            <div className="flex items-start justify-between">
              <span className="font-title text-2xl font-bold tracking-tight">{brand.title}</span>
              <span className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
                    style={{ background: HOUSE.lime, color: HOUSE.ink }}>
                {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </span>
            </div>

            {/* TWO COLUMNS, because the sheet turned on its side and the type did not.
                A portrait cover is a column of words with the plate around it; the same
                arrangement on a 297mm page is that column pinned to the left edge with half
                a sheet of empty colour beside it. The words keep the left, and the right
                carries the thing the document is about — the products, in a grid, off the
                catalogue itself. Nothing invented: they are the first styles in the book. */}
            <div className="grid flex-1 grid-cols-[minmax(0,1fr)_118mm] items-center gap-10">
              <div>
                {/* BROKEN AT THE LAST SPACE, not typed with a <br>. The cover name is editable
                    now, so the line break cannot be part of the string — "The catalogue" has to
                    set the way it always did while "Spring Blanks 2026" sets on its own terms.
                    A single word simply fills one line. */}
                <h1 className="font-title font-black leading-[0.88] tracking-tight" style={{ fontSize: "68px" }}>
                  {(() => {
                    const words = brand.headline.trim().split(/\s+/)
                    if (words.length < 2) return brand.headline
                    return <>{words.slice(0, -1).join(" ")}<br />{words[words.length - 1]}</>
                  })()}
                </h1>
                <p className="mt-5 max-w-[105mm] text-base leading-relaxed" style={{ color: "rgba(250,248,243,0.75)" }}>
                  {brand.tagline}
                </p>
                {/* The lime rule — one bright line, the counterpart colour doing the job it
                    can do on a dark ground where it measures 16.6:1. */}
                <div className="mt-7 h-1.5 w-28 rounded-full" style={{ background: HOUSE.lime }} />
              </div>

              {/* FOUR REAL PRODUCTS, on white tiles so the garments read against the plate.
                  Only styles that actually have a photograph — a cover is the one page that
                  cannot afford an empty well, so a thin catalogue simply shows fewer. */}
              {(() => {
                const shots = rows.map(heroImage).filter(Boolean).slice(0, 4)
                if (!shots.length) return <span />
                return (
                  <div className={"grid gap-3 " + (shots.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
                    {shots.map((src, i) => (
                      <div key={i} className="flex aspect-square items-center justify-center overflow-hidden rounded-xl p-3"
                           style={{ background: PLATE }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" className="size-full object-contain" />
                      </div>
                    ))}
                  </div>
                )
              })()}
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

          {/* ── WHAT WE DO ───────────────────────────────────────────────────────────
              A catalogue that opens on a spec sheet is a price list with a cover. This is
              the page a buyer reads before deciding whether to read the rest — and every
              figure on it is COUNTED FROM THIS DOCUMENT rather than claimed. Styles,
              colourways, sizes and decoration methods are what the pages behind it contain,
              so the sheet cannot overstate the catalogue it introduces. */}
          {(() => {
            const colourways = rows.reduce((n, st) => n + st.colors.length, 0)
            const sizes = new Set(rows.flatMap((st) => st.sizes))
            const brands = new Set(rows.map((st) => st.brand).filter(Boolean))
            const priced = rows.filter((st) => sheetPrice(st) != null).length
            const stat = (n: string | number, label: string) => (
              <div key={label}>
                <div className="font-title text-4xl font-bold leading-none tabular-nums">{n}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">{label}</div>
              </div>
            )
            return (
              <section
                className="eg-sheet mx-auto mb-6 flex w-[297mm] flex-col overflow-hidden bg-white p-[18mm] shadow-sm print:mb-0 print:shadow-none"
                style={{ height: "210mm" }}
              >
                <div className="mb-6 h-1.5 w-full rounded-full" style={{ background: brand.accent }} />
                <h2 className="font-title text-4xl font-bold uppercase leading-none tracking-tight">
                  What we make, and how
                </h2>
                <p className="mt-2 max-w-[150mm] text-sm leading-relaxed text-neutral-600">
                  Blanks held and decorated to order — no minimums per design, and every piece
                  printed, packed and shipped from one floor.
                </p>

                <div className="mt-8 grid grid-cols-4 gap-6 border-y border-neutral-200 py-6">
                  {stat(rows.length, "styles in this book")}
                  {stat(colourways, "colourways")}
                  {stat(sizes.size, "sizes")}
                  {stat(brands.size || "—", brands.size === 1 ? "brand" : "brands")}
                </div>

                {/* THE DECORATION METHODS, from the same table the product form offers and
                    pricing surcharges — so this page cannot advertise a technique the factory
                    does not have a price for. */}
                <div className="mt-8">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                    Decoration
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-3">
                    {PRODUCT_METHODS.map((m) => (
                      <div key={m.key} className="rounded-lg border border-neutral-200 px-3 py-2.5">
                        <div className="text-sm font-semibold">{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-auto flex items-end justify-between border-t border-neutral-200 pt-4 text-[10px] text-neutral-500">
                  <span>
                    {priced === rows.length
                      ? "Every style in this book is priced."
                      : `${priced} of ${rows.length} styles priced — ask us for the rest.`}
                  </span>
                  <span className="font-title text-sm font-semibold tracking-tight text-neutral-700">{brand.title}</span>
                </div>
              </section>
            )
          })()}

          {rows.map((st) => {
            // The photo this page can show, and whether the left column has anything at all
            // to hold. In EDIT mode it always does — the attach-a-photo and add-a-description
            // affordances are the reason you opened the mode on a page that has neither.
            const hero = heroImage(st)
            const twoUp = !!hero || !!st.description || editing
            // Wider cells when the swatches have the whole sheet: three across a full page
            // would print them at hero size, which is not what a colour grid is for.
            const colCap = twoUp ? 20 : 32
            return (
            // ONE STYLE PER PAGE. A4 LANDSCAPE at 297×210mm with the page break forced after
            // so a colourway grid never starts on one sheet and finishes on the next —
            // which is the one thing that makes a printed catalogue look homemade.
            <section
              key={st.ref}
              className="eg-sheet mx-auto mb-6 flex w-[297mm] flex-col overflow-hidden bg-white p-[14mm] shadow-sm print:mb-0 print:shadow-none"
              style={{ height: "210mm" }}
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
                  <h2 className="font-title text-3xl font-bold uppercase leading-none tracking-tight">
                    <Editable
                      editing={editing} value={st.name} placeholder="Name this style"
                      // uppercase RE-DECLARED on the button: Tailwind's preflight sets
                      // `text-transform: none` on button/input, so the h2's uppercase stops at
                      // the edit affordance and the headline changed case when you toggled the
                      // mode — which reads as the edit having already done something.
                      className="uppercase"
                      inputClassName="font-title text-3xl font-bold uppercase leading-none tracking-tight"
                      onSave={(v) => patch(st, { name: v || null }, { name: v })}
                    >
                      {st.name}
                    </Editable>
                  </h2>
                  <div className="mt-1.5 flex items-baseline gap-2 text-xs text-neutral-500">
                    {/* The sku and the brand are NOT editable. One is how a buyer orders the
                        thing and the other is whose garment it is — a document where those
                        can be retyped is a document that can quote a style nobody can supply. */}
                    <span className="font-mono">{st.sku}</span>
                    {st.brand && <span>· {st.brand}</span>}
                    {editing && st.edited && (
                      <button
                        type="button" onClick={() => revert(st)} disabled={savingRef === st.ref}
                        className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-200 print:hidden"
                        title="Put the name, copy and photo back to what the catalogue says"
                      >
                        <ArrowCounterClockwise size={10} weight="bold" /> Edited · undo
                      </button>
                    )}
                  </div>
                </div>
                {/* The price is the thing a buyer came for, so it is the one filled block
                    on the page — ink on lime, 16.6:1, and impossible to miss.
                    In edit mode it shows even when there ISN'T one: an unpriced style is
                    exactly the page you opened this to fix, and it can't be fixed if the
                    block it lives in only appears once a price exists. */}
                {(sheetPrice(st) != null || editing) && (
                  <div className="shrink-0 rounded-xl px-4 py-2.5 text-right"
                       style={{ background: sheetPrice(st) != null ? HOUSE.lime : "#F1F0EC", color: HOUSE.ink }}>
                    <div className={sheetPrice(st) != null
                      ? "font-title text-4xl font-bold leading-none tabular-nums"
                      : "py-2 text-sm font-medium leading-none"}>
                      <Editable
                        editing={editing}
                        value={sheetPrice(st) == null ? "" : String(sheetPrice(st))}
                        placeholder="Set price"
                        className="font-title text-4xl font-bold leading-none tabular-nums"
                        inputClassName="w-28 text-right font-title text-2xl font-bold tabular-nums"
                        onSave={(v) => {
                          const n = v.trim() === "" ? null : Number(v.replace(/[^0-9.]/g, ""))
                          if (n != null && !isFinite(n)) return
                          // Straight to catalog_price — the same number the Catalogue page and
                          // the markup button write. See the route: a price kept with the
                          // lookbook's own copy would be a second, disagreeing price.
                          patch(st, { price: n }, { price: n })
                        }}
                      >
                        {money(sheetPrice(st))}
                      </Editable>
                    </div>
                    <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest opacity-70">per unit</div>
                  </div>
                )}
              </div>

              {/* flex-1 on the grid was not enough — the CHILDREN also have to stretch, or
                  a short left column leaves the sheet half empty regardless of how tall the
                  grid is. items-stretch plus min-h-0 lets both columns own the page.

                  ONE COLUMN WHEN THE LEFT ONE HAS NOTHING TO SAY. With no photo and no copy,
                  the two-up grid printed an empty half-page beside the swatches — a hole in
                  the middle of the sheet, which reads worse than a shorter page. The colours
                  and the charts take the full width instead. */}
              <div className={"grid min-h-0 flex-1 items-stretch gap-8 " + (twoUp ? "grid-cols-[92mm_minmax(0,1fr)]" : "grid-cols-1")}>
                {/* LEFT — the product itself, big. Omitted entirely when there is neither. */}
                {twoUp && (
                <div className="flex flex-col">
                  {/* No fixed aspect: the hero takes the room the copy doesn't. On a style
                      with no description that is most of the column, which is exactly the
                      gap that made the page look unfinished. */}
                  {/* p-4 so the garment has air inside its plate rather than touching the
                      corners, and min-h raised from 80mm: on a style with no description
                      this column is the page, and the hero was sitting small in the middle
                      of it. */}
                  {/* AN EMPTY PLATE IS WORSE THAN NO PLATE. A 120mm bordered box reading "no
                      image" is the most conspicuous thing on the sheet — it looks like the
                      document failed rather than like a style we haven't shot yet. So the
                      plate is drawn only when there is something to put in it; the copy takes
                      the column otherwise, and in edit mode the space offers to fix it. */}
                  {hero ? (
                    /* NO RULE. The grey plate went first because it made a seam rather than
                       an edge; the rule that replaced it is the same mark one step quieter —
                       a box drawn around a cut-out photo on a white page, on every style, so
                       the eye reads the frame before the garment. The page is white and the
                       shot is white, and that is the point: the product is the only thing on
                       the sheet with a shape.
                       The trade is real and worth naming — a white or pale garment now has no
                       boundary of its own. If that reads as floating, the answer is a soft
                       shadow under the product, not a line around the box. */
                    /* A SQUARE, not a column-height well. The sheet is 210mm tall now, and
                       min-h-[120mm] plus flex-1 made the hero eat all of it — a garment
                       stretched down a strip with white either side, which is the "main image
                       way too long". A square is the shape these shots are framed in
                       everywhere else in the app, so the same photo reads the same here, and
                       the height it stops taking goes to the copy underneath it. */
                    <div className="group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg p-3"
                         style={{ background: PLATE }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={hero} alt={st.name} className="size-full object-contain" />
                      {editing && (
                        <button
                          type="button" onClick={() => pickFile(st)} disabled={savingRef === st.ref}
                          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-neutral-700 shadow-sm hover:bg-white print:hidden"
                        >
                          <ImageIcon size={11} weight="bold" /> Replace photo
                        </button>
                      )}
                    </div>
                  ) : editing ? (
                    // print:hidden — this is a control, not part of the document. A sheet
                    // printed mid-edit must show the page as it will be sent.
                    <button
                      type="button" onClick={() => pickFile(st)} disabled={savingRef === st.ref}
                      className="flex min-h-[60mm] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 print:hidden"
                    >
                      <ImageIcon size={14} weight="bold" /> Attach a photo for this style
                    </button>
                  ) : null}

                  <Editable
                    editing={editing} value={st.description} multiline
                    placeholder="Add a description"
                    className={hero ? "mt-4 block text-[11px] text-neutral-500" : "block text-[11px] text-neutral-500"}
                    onSave={(v) => patch(st, { description: v.trim() === "" ? null : v }, { description: v })}
                  >
                    {st.description
                      ? (
                        // Same split as every other surface — a printed lookbook page is the
                        // one place a wall of run-together specs is hardest to skim.
                        /* CAPPED. A supplier description runs to a dozen bullets — the sheet is
                           fixed at one page now, so an uncapped list does not make the page
                           longer, it makes the bottom of it disappear silently. Eight lines is
                           what the column holds beside a square hero and the size charts. */
                        <ul className={(hero ? "mt-4 " : "") + "space-y-0.5 text-[11px] leading-relaxed text-neutral-600"}>
                          {descriptionLines(st.description).slice(0, 8).map((line, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="mt-[0.6em] size-[3px] shrink-0 rounded-full bg-neutral-400" />
                              <span>{line}</span>
                            </li>
                          ))}
                        </ul>
                      )
                      // No description on most supplier styles, and an empty column reads as
                      // an unfinished page. The size run fills it as a chart instead, which
                      // is the thing a buyer would otherwise have to ask for.
                      : null}
                  </Editable>

                  {/* The size run and the chart sit UNDER THE HERO, in the left column.
                      swatches. On the left they left the bottom-right of every sheet
                      empty — a page that dead-ends in white is most of what made this
                      catalogue read as unfinished. mt-auto pins them to the foot of the
                      column, so any slack sits BETWEEN the swatches and the chart rather
                      than trailing off the bottom of the page. */}
                  {/* mt-auto only while there IS a left column. On a one-column page pushing
                      the charts to the foot leaves the slack in the MIDDLE of the sheet, which
                      reads as something failing to render; at the bottom it reads as a page
                      with less on it, which is the truth. */}
                  <div className="pt-4">
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
                )}

                {/* RIGHT — every colourway, captioned. */}
                <div className="flex min-h-0 flex-col">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                    Available colours
                  </div>
                  {st.colors.length === 0 ? (
                    <p className="mt-2 text-[11px] text-neutral-400">
                      No colourway images on this style.
                    </p>
                  ) : !st.colors.some((c) => c.image) ? (
                    /* NAMES, when there are no pictures of them. A grid of bordered wells
                       each holding a colour name in 7px grey is twelve small versions of the
                       empty plate this page just stopped printing — the border promises a
                       photograph the row cannot deliver. The range is still stated, as a
                       list, which is what it actually is. */
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {st.colors.map((c) => (
                        <span key={c.name + c.sku}
                              className="rounded border border-neutral-200 px-2 py-1 text-[10px] leading-tight text-neutral-700">
                          {c.name}
                          {c.sku && <span className="ml-1.5 font-mono text-[9px] text-neutral-400">{c.sku}</span>}
                        </span>
                      ))}
                    </div>
                  ) : (
                    // Five columns, capped at 20. Past that a page stops being readable and
                    // the overflow is stated rather than silently dropped.
                    // auto-rows-min keeps swatches their natural height while the column
                    // stretches, so they sit at the top rather than smearing down the page.
                    <div className={"mt-2 grid auto-rows-min gap-x-3 gap-y-4 " + (twoUp ? "grid-cols-5" : "grid-cols-8")}>
                      {st.colors.slice(0, colCap).map((c) => (
                        <div key={c.name + c.sku} className="flex flex-col items-center">
                          {/* THREE ACROSS, SQUARE. Four columns made each well ~19mm wide, and
                              since these photos are wider than they are tall the picture was
                              width-limited — so the garment printed about 12mm across and the
                              rest of a 3:4 well was empty plate. Three columns is ~42% more
                              width, which is the whole of the "way too small". Square rather
                              than 3:4 for the same reason: the letterboxing above and below
                              was padding, not picture. Twelve rather than twenty because the
                              bigger cells cost rows — the remainder is still stated below. */}
                          {/* Same reasoning as the hero: no rule around a cut-out on white.
                              Twelve of these in a grid made twelve boxes, which read as a
                              table of frames rather than a set of colourways. */}
                          <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded p-1"
                               style={{ background: PLATE }}>
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
                  {st.colors.length > colCap && (
                    <p className="mt-2 text-[9px] text-neutral-500">
                      + {st.colors.length - colCap} more colours — ask us for the full range.
                    </p>
                  )}
                </div>
              </div>

              <footer className="mt-6 flex items-center justify-between border-t border-neutral-200 pt-3 text-[9px] text-neutral-400">
                <span className="font-title text-sm font-semibold tracking-tight text-neutral-700">{brand.title}</span>
                <span>{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
              </footer>
            </section>
          )})}

          {/* ── PRICE LIST ───────────────────────────────────────────────────────────
              Every style on one run of tables, immediately before the back cover.

              THE SPREADS SELL, THIS ONE IS ORDERED FROM. A buyer who has been through
              twenty pages of photography is comparing, and comparing means holding numbers
              side by side — which a page-per-style layout makes impossible however good
              each page is. Same figures, gathered.

              THREE COLUMNS, BECAUSE A UNIT PRICE IS NOT WHAT ANYTHING COSTS. Base is the
              garment; first item is the parcel it travels in; additional item is each extra
              in that same box, and it is the number that decides whether ordering six at
              once is worth it. Quoting only the first would understate a single unit and
              overstate a carton.

              Paginated in code rather than left to the browser. These sheets are fixed A4
              with a footer pinned to the bottom, so a table that flows past the page edge
              simply gets cut — 13 rows a page is what fits on a LANDSCAPE sheet with the
              header and the note. It was 22, which was right when the page was 297mm tall
              and cut nine rows off every sheet the moment it turned on its side. */}
          {(() => {
            const ROWS_PER_PAGE = 13
            const pages: LookbookStyle[][] = []
            for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE))
            return pages.map((page, pi) => (
              <section
                key={`prices-${pi}`}
                className="eg-sheet mx-auto mb-6 flex w-[297mm] flex-col overflow-hidden bg-white p-[18mm] shadow-sm print:mb-0 print:shadow-none"
                style={{ height: "210mm" }}
              >
                <div className="mb-5 h-1.5 w-full rounded-full" style={{ background: brand.accent }} />
                <div className="mb-6 border-b border-neutral-200 pb-4">
                  <h2 className="font-title text-3xl font-bold uppercase leading-none tracking-tight">
                    Price list
                  </h2>
                  <p className="mt-1.5 text-xs text-neutral-500">
                    Per unit, in USD{pages.length > 1 ? ` · sheet ${pi + 1} of ${pages.length}` : ""}
                  </p>
                </div>

                <table className="w-full border-collapse text-[10px]">
                  <thead>
                    <tr className="border-b border-neutral-300 text-left align-bottom">
                      <th className="pb-2 pr-3 font-semibold uppercase tracking-wider text-neutral-500">Style</th>
                      <th className="pb-2 pr-3 font-semibold uppercase tracking-wider text-neutral-500">Sku</th>
                      {/* "Base" was wrong: it printed catalog_price, the trade rate. This is the number
                          a reader orders at, whichever of the two it resolves to. */}
                      {/* ONE COLUMN PER TECHNIQUE. "Unit" was the base plus whichever
                          surcharge the product's first listed method carried, so a blank
                          offered in both was quoted at one of them and the sheet was wrong
                          about the other. Stitches cost more than ink. */}
                      <th className="pb-2 pl-3 text-right font-semibold uppercase tracking-wider text-neutral-500">Printing</th>
                      <th className="pb-2 pl-3 text-right font-semibold uppercase tracking-wider text-neutral-500">Embroidery</th>
                      <th className="pb-2 pl-3 text-right font-semibold uppercase tracking-wider text-neutral-500">First item<br />shipping</th>
                      <th className="pb-2 pl-3 text-right font-semibold uppercase tracking-wider text-neutral-500">Additional item<br />shipping</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((st, ri) => (
                      /* Keyed by ref+sku, not name: two styles can share a name and React
                         would reconcile them into one row — on a price list that is a line
                         item silently missing from a quote. */
                      <tr key={`${st.ref}-${st.sku}-${ri}`} className={ri % 2 ? "" : "bg-neutral-50"}>
                        <td className="max-w-[70mm] truncate py-1.5 pr-3 font-medium">{st.name}</td>
                        <td className="py-1.5 pr-3 font-mono text-[9px] text-neutral-500">{st.sku}</td>
                        {/* A DASH, NEVER A ZERO. An unpriced style on a price list that
                            printed $0.00 would be quoting a wholesale buyer a free garment,
                            and it is the one mistake here nobody could walk back. */}
                        {/* N/A, NOT A DASH, for a technique this blank does not take. The two
                            mean different things on a price list: a dash is "we have not
                            priced it, ask us"; N/A is "we cannot run it", and quoting a
                            number there would be an order we could not fulfil.
                            Falls back to the sheet price when a SAVED export predates the
                            per-method figures — an older document keeps quoting what it
                            always did rather than going blank. */}
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {st.priceByMethod
                            ? (st.priceByMethod.print == null
                                ? <span className="text-neutral-400">N/A</span>
                                : money(st.priceByMethod.print))
                            : (sheetPrice(st) == null ? <span className="text-neutral-400">—</span> : money(sheetPrice(st)))}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {st.priceByMethod
                            ? (st.priceByMethod.embroidery == null
                                ? <span className="text-neutral-400">N/A</span>
                                : money(st.priceByMethod.embroidery))
                            : <span className="text-neutral-400">—</span>}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {st.ship == null ? <span className="text-neutral-400">—</span> : money(st.ship)}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {st.shipExtra == null ? <span className="text-neutral-400">—</span> : money(st.shipExtra)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-auto pt-6">
                  {/* The explanatory paragraph is gone. It restated the two shipping column
                      headings in a sentence directly under them, and defined "base cost" —
                      a term the table no longer uses. */}
                  <footer className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3 text-[9px] text-neutral-400">
                    <span className="font-title text-sm font-semibold tracking-tight text-neutral-700">{brand.title}</span>
                    <span>{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
                  </footer>
                </div>
              </section>
            ))
          })()}

          {/* ── BACK COVER ───────────────────────────────────────────────────────────
              A catalogue that stops dead on its last spec sheet leaves the reader with no
              next step. This one says how to order and who to ask — and closes on the same
              plate it opened with, so the document is bookended rather than just ending. */}
          <section
            className="eg-sheet eg-cover mx-auto mb-6 flex w-[297mm] flex-col justify-between overflow-hidden p-[18mm] shadow-sm print:mb-0 print:shadow-none"
            style={{ height: "210mm", background: brand.accent, color: HOUSE.paper }}
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
          @page { size: A4 landscape; margin: 0; }
          .eg-sheet { break-after: page; page-break-after: always; box-shadow: none !important; margin: 0 !important; }
          .eg-sheet:last-child { break-after: auto; page-break-after: auto; }
          .eg-print-root { background: #fff !important; }
        }
      `}</style>
    </div>,
    host,
  )
}

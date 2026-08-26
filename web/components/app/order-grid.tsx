"use client"

import { useLabelT } from "@/lib/i18n"
/**
 * THE SHEET, IN OUR APP.
 *
 * A seller fills orders in here and presses Complete. There is no download, no upload and
 * no Google — which is the point: every awkward thing about the Sheet tab exists because
 * the grid belonged to someone else. A bound Apps Script that Google warns about on every
 * copy, a hidden Lists tab frozen on the day it was copied, a service account with no Drive
 * that cannot create the master it maintains. None of that has an equivalent here.
 *
 * IT OWNS NO RULES. Editing is all this file does. The moment rows need meaning they go
 * through the SAME functions the File and Paste tabs use — rowsToRecords for validation and
 * groupToOrders for grouping — so a sheet dropped as .xlsx and a sheet typed in here cannot
 * disagree about what a valid row is. CLAUDE.md §5: import, don't re-implement.
 *
 * COMPLETE IS NOT SUBMIT. Completing creates DRAFT orders and never touches the wallet;
 * `SubmitOrderButton` ("Submit to production?") is the paid action and lives on the order
 * itself. Two verbs, two screens, two objects — you complete a sheet, you submit an order.
 * The words are deliberately not synonyms, because the expensive mistake here is a seller
 * believing 200 rows went to the factory when they are sitting in draft.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  CSV_COLUMNS,
  COLUMN_OPTIONS,
  ITEM_SIZES,
  US_STATES,
  TEMPLATE_HEADERS,
  rowsToRecords,
  parsePasted,
  type ImportRecord,
} from "@/lib/order-import"
import { productColors, productSizes } from "@/lib/variant-sku"
import { resolveProduct, productLabel } from "@/lib/variant-resolve"
import { normalizeMethods } from "@/lib/print-method"
import { platformName } from "@/shared/order-rules"
import { getCatalogProducts, getTemplates, getDesignLibrary, getMachineFiles,
  getEtsyConnections, getShopifyConnections, getTiktokConnections, type EtsyConnection,
  type CatalogProduct, type ProductTemplate, type LibraryDesign, type MachineFile } from "@/lib/api"

/** Blank rows to open on. Enough that it reads as a sheet rather than as a form. */
const OPEN_ROWS = 8

const blankRow = () => CSV_COLUMNS.map(() => "")

/**
 * HOW WIDE A COLUMN NEEDS TO BE, which is not the same for all 21.
 *
 * Every column was min-w-32 — 128px — so a quantity of "1" reserved exactly as much room as
 * a street address, and the sheet was ~2,700px wide before it held anything. Most of what
 * you drag past horizontally is empty.
 *
 * Only the genuinely SHORT ones are narrowed. A first attempt also widened the addresses to
 * 192px, which made the total WIDER than it started (2,768 against 2,688) — the opposite of
 * the point. A long value is not truncated by a narrow column here anyway: the cell is an
 * input, so it scrolls its own text.
 *
 * This shaves roughly 10%. It does not solve the scroll and cannot: 21 columns in 1,440px
 * is 68px each, which no address survives. The full-screen page is what actually helps,
 * because it roughly doubles the width the dialog had.
 */
/**
 * WHAT A COLUMN OFFERS WHEN NO PRODUCT NARROWS IT — named explicitly, not read from
 * COLUMN_OPTIONS.
 *
 * COLUMN_OPTIONS does DOUBLE DUTY. For most keys it is the dropdown values, but for
 * `item_size` it holds HEADER SPELLINGS — "item_size", "variant_size", "lineitem_size" —
 * because the alias lookup needed somewhere to live (see the note on it in order-import.ts).
 * Reading it blindly is how the Size cell offered "lineitem_size" as a size.
 *
 * So each column names its own source. A key absent here has no fixed list and stays free
 * text until a product narrows it.
 */
/**
 * AN OPTION THAT SHOWS ONE THING AND WRITES ANOTHER.
 *
 * A blank product is its own label — the cell wants the name and the list shows the name. A
 * reference is not: `MF-12` in the cell is what the importer resolves, and `MF-12` in the
 * list is twelve of these telling you nothing about which stitch file each one is. So an
 * option may carry a label; the cell still gets the value.
 */
type Opt = string | { value: string; label: string }
const optValue = (o: Opt) => (typeof o === "string" ? o : o.value)
const optLabel = (o: Opt) => (typeof o === "string" ? o : o.label)

const FIXED_OPTIONS: Record<string, string[]> = {
  item_size: ITEM_SIZES,
  ship_state: US_STATES,
  print_type: COLUMN_OPTIONS.print_type ?? [],
}

const NARROW = new Set(["item_quantity", "item_size", "item_price", "ship_state", "ship_zip"])
const widthFor = (key: string) => (NARROW.has(key) ? "min-w-20" : "min-w-32")

/** Column index by key, so the narrowing below never counts columns by hand. */
const IDX = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c.key, i])) as Record<string, number>

export type OrderGridProps = {
  /** Given the filled rows, make the orders. The caller owns createOrder — this file does
   *  not know what an order is, only what a row is. */
  onComplete: (rows: string[][]) => Promise<void> | void
  busy?: boolean
  /** Rendered as "Back" beside Complete. Present when the grid owns the whole screen and
   *  there is no other way out — a full-page surface with no exit is a trap. */
  onBack?: () => void
  /** Let the table take the height it is given instead of capping at half the viewport.
   *  On the full page the cap is what made a 21-column sheet feel like a peephole. */
  fill?: boolean
  /** Rows to open on, from a saved sheet. Read ONCE, at mount: re-seeding from a prop would
   *  fight whatever the seller has typed since. Remount with a key to load a different sheet. */
  initialRows?: string[][]
  /**
   * Every change, so the caller can save it.
   *
   * An EVENT, never an effect watching `rows`. An effect that writes on state its own result
   * produced is the shape CLAUDE.md §2.8 warns about — the one that took a machine down.
   */
  onRowsChange?: (rows: string[][]) => void
}

export function OrderGrid({ onComplete, busy, onBack, fill, initialRows, onRowsChange }: OrderGridProps) {
  const tl = useLabelT()
  /**
   * ONE FETCH, ON MOUNT. Deliberately not keyed to anything the fetch itself writes — see
   * CLAUDE.md §2.8, where an effect that re-ran on state its own result produced took a
   * machine down. There is no condition here: it runs once and never again.
   */
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  /**
   * THE ACCOUNT'S OWN REFERENCES — templates, library images, machine files.
   *
   * Three ID columns asked you to type a reference and offered no way to see what you had,
   * so the only route was to open Design Lab in another tab, read `MF-12` off a card, come
   * back and type it from memory. The sheet already knows how to suggest; it simply had
   * nothing to suggest from for these.
   *
   * Each is allowed to fail on its own. A seller with no machine files still gets template
   * suggestions, and a 500 on one list must not blank the other two.
   */
  const [templates, setTemplates] = useState<ProductTemplate[]>([])
  const [images, setImages] = useState<LibraryDesign[]>([])
  const [machineFiles, setMachineFiles] = useState<MachineFile[]>([])
  const [stores, setStores] = useState<EtsyConnection[]>([])
  useEffect(() => {
    let live = true
    getCatalogProducts().then((c) => { if (live) setCatalog(c ?? []) }).catch(() => {})
    getTemplates().then((t) => { if (live) setTemplates(t ?? []) }).catch(() => {})
    getDesignLibrary().then((d) => { if (live) setImages(d ?? []) }).catch(() => {})
    getMachineFiles().then((m) => { if (live) setMachineFiles(m ?? []) }).catch(() => {})
    /* THE SHOPS THIS ACCOUNT HAS CONNECTED, from all three channels. Settled, not all:
       a seller with Etsy connected and no TikTok must still get their Etsy shop, and a
       platform that errors cannot take the other two down with it. */
    Promise.allSettled([getEtsyConnections(), getShopifyConnections(), getTiktokConnections()])
      .then((rs) => {
        if (!live) return
        setStores(rs.flatMap((r) => (r.status === "fulfilled" ? r.value ?? [] : [])))
      })
    return () => { live = false }
  }, [])

  const [rows, setRows] = useState<string[][]>(() => {
    // Pad a short saved sheet back up to a workable height — a two-row sheet reopening with
    // exactly two rows leaves nowhere to type the third.
    const seed = (initialRows ?? []).map((r) => CSV_COLUMNS.map((_, i) => String(r?.[i] ?? "")))
    while (seed.length < OPEN_ROWS) seed.push(blankRow())
    return seed
  })

  /* One place every mutation goes through, so "tell the caller it changed" cannot be
     forgotten by the next thing that edits a cell.
     The callback is read from the PROP, not held in a ref — writing a ref during render is
     what react-hooks/refs rejects, and there is nothing here a dependency cannot express. */
  const writeRows = useCallback((fn: (prev: string[][]) => string[][]) => {
    setRows((prev) => {
      const next = fn(prev)
      // OUT of the updater. React may invoke an updater more than once, and a side effect
      // inside one runs as many times as it does — queueMicrotask keeps the state function
      // pure while still firing on the EVENT rather than from an effect watching `rows`.
      queueMicrotask(() => onRowsChange?.(next))
      return next
    })
  }, [onRowsChange])
  /**
   * SELECTED IS NOT EDITING, and paste is where the difference matters.
   *
   * Every cell is an <input>, so focus alone cannot tell the two apart — but a spreadsheet
   * has to. Pasting a three-line address into a SELECTED cell means "fill three rows"; the
   * same paste into a cell you are TYPING in means "this is the value". Without the
   * distinction a copied address split itself down the column, which is what this fixes.
   *
   * A cell becomes editing when you double-click it or type into it, and stops on Escape,
   * Enter, or moving away. Clicking or arrowing to a cell only SELECTS it.
   */
  const [editing, setEditing] = useState<string | null>(null)
  /**
   * THE SUGGESTION MENU, POSITIONED BY US.
   *
   * This was a native <datalist>, which cannot be positioned, sized or styled at all — the
   * browser decided, and it decided badly: it opened upward over the toolbar, and it was
   * wider than the screen for product names.
   *
   * Anchored to the cell instead and always DOWNWARD, measured from the input's own rect.
   * `position: fixed` rather than absolute so the table's overflow cannot clip it — a menu
   * on the last visible row was otherwise cut in half by the scroll container.
   */
  const [menu, setMenu] = useState<{ key: string; left: number; top: number; width: number } | null>(null)
  /** The popup's own node, so the close-on-scroll listener can tell the sheet scrolling
   *  (which must close it) from the LIST scrolling (which must not). */
  const menuRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  /**
   * VALIDATION IS THE IMPORTER'S, RUN LIVE.
   *
   * The same call the File tab makes, with the header row prepended — so "Missing: ship
   * city" is worded identically whether a row was typed here or arrived in a .xlsx, and a
   * rule added to REQUIRED_COLS reaches both without being written twice.
   *
   * Row numbers come back 1-based against the sheet INCLUDING its header, so record N maps
   * to rows[N._rowNum - 2]. Keyed that way rather than by array position because
   * rowsToRecords drops the sample row, which would silently shift every error one row up.
   */
  const { byRow, validCount } = useMemo(() => {
    const filled = rows.filter((r) => r.some((c) => c.trim() !== ""))
    if (!filled.length) return { byRow: new Map<number, ImportRecord>(), validCount: 0 }
    const { records } = rowsToRecords([TEMPLATE_HEADERS as unknown as string[], ...rows])
    const m = new Map<number, ImportRecord>()
    let ok = 0
    for (const rec of records) {
      m.set(rec._rowNum - 2, rec)
      if (rec._valid) ok++
    }
    return { byRow: m, validCount: ok }
  }, [rows])

  /**
   * WHAT THIS PRODUCT ACTUALLY COMES IN — the thing the Apps Script existed to do.
   *
   * In the sheet this needed an onEdit trigger reading a hidden tab that was a snapshot of
   * the catalogue on the day the file was copied. Here it is a filter over the catalogue
   * the dialog already fetched, so it cannot be stale: a colourway added this morning is in
   * the list this morning, and there is nothing to re-download.
   *
   * Falls back to the union when no product is chosen, exactly as the sheet's "All colors"
   * columns did — an empty dropdown would read as "this product has no colours" rather than
   * as "pick a product first".
   */
  /**
   * WHAT EACH ID COLUMN WILL ACCEPT, which is not the same answer three times.
   *
   * Template ID and Machine File ID take a REFERENCE — `TPL-12`, `MF-12` — so the value is
   * the reference and the label carries the name that tells two of them apart.
   *
   * Image ID does NOT. The importer reads it as `/^https?:\/\//.test(hero) ? hero : ""`, so
   * despite the column's name it wants a URL and silently drops anything else. Offering
   * `IMG-12` here would have looked right, matched the other two columns, and quietly
   * imported nothing — so the value is the image's address and the label is its name.
   * Entries without an http(s) address are left out rather than offered and dropped.
   */
  const refOptions = useMemo<Record<string, Opt[]>>(() => ({
    template_id: templates
      .filter((t) => t.seq != null)
      .map((t) => ({ value: `TPL-${t.seq}`, label: `TPL-${t.seq}${t.name ? ` · ${t.name}` : ""}` })),
    machine_file_id: machineFiles
      .filter((m) => m.ref)
      .map((m) => ({ value: m.ref, label: `${m.ref}${m.name ? ` · ${m.name}` : ""}` })),
    /* A SUGGESTION, NOT A LIST TO PICK FROM. Store Name is free text and stays that way —
       a seller may sell somewhere we have no connector for, and the column has always
       accepted whatever is typed. This only removes the need to remember the spelling of a
       shop they have already connected. The platform is on the label, not in the value:
       the importer stores this string as the order's store, and "My Shop · Etsy" would
       become the store's name. */
    store_name: Array.from(
      new Map(
        stores
          .filter((c) => (c.shop_name || "").trim())
          .map((c) => [String(c.shop_name).trim(), {
            value: String(c.shop_name).trim(),
            label: `${String(c.shop_name).trim()}${c.platform ? ` · ${platformName(c.platform)}` : ""}`,
          }] as const),
      ).values(),
    ).sort((a, b) => a.value.localeCompare(b.value)),
    hero_image: images
      .filter((d) => /^https?:\/\//i.test(String(d.thumb ?? "")))
      .map((d) => ({ value: String(d.thumb), label: String(d.name || `Image ${d.id}`) })),
  }), [templates, machineFiles, images, stores])

  const optionsFor = useCallback(
    (colKey: string, row: string[]): Opt[] | null => {
      const refs = refOptions[colKey]
      if (refs) return refs.length ? refs : null
      const dependent = colKey === "item_color" || colKey === "item_size" || colKey === "print_type"
      if (!dependent) return FIXED_OPTIONS[colKey] ?? null
      // resolveProduct, not a private name match — it is the canonical matcher and it is what
      // knows the cell may be "SKU - Name" (CLAUDE.md §5: import, don't re-implement). A
      // hand-rolled equality here is exactly why the labelled option would have narrowed
      // nothing: every colour cell would have fallen back to the fixed list.
      const cell = (row[IDX.blank] || "").trim()
      const p = cell ? resolveProduct({ blank: cell } as never, catalog) : null
      if (!p) return FIXED_OPTIONS[colKey] ?? null
      if (colKey === "item_color") return productColors(p as never)
      if (colKey === "item_size") return productSizes(p as never)
      /* BOTH FIELDS, NOT ONE. This read `method` alone, and CatalogProduct's own note on
         `methods` says to read it alongside — "or a product that has both loses half its
         options". A product carrying its techniques as a LIST (which is every imported one)
         offered nothing here, so the column fell back to all seven print methods and the
         one thing this cell is for — narrowing to what this garment can actually take —
         did not happen. Anything that resolves to no method at all still falls back, since
         an empty list would be worse than an unfiltered one. */
      const own = normalizeMethods([p.method, ...(p.methods ?? [])]).map((m) => m.label)
      return own.length ? own : FIXED_OPTIONS[colKey] ?? null
    },
    [catalog, refOptions],
  )

  /**
   * THE BLANK, AS "SKU - NAME" — the same string the Google Sheet's dropdown offers.
   *
   * Two reasons it is one string rather than a label over a hidden value. A catalogue has
   * near-identical names in it ("Adidas Men's Blended T-Shirt" against three cuts of the
   * same shirt), and the sku is the half that tells them apart while you are picking. And
   * Sheets data validation has no label-vs-value at all — the cell holds the option text —
   * so anything this grid wrote in a different shape would import differently from the
   * sheet the same rows can be pasted into. resolveProduct matches either half.
   */
  const productNames = useMemo(
    () => catalog
      // productLabel is the one spelling of this string — the line strip and the .xlsx
      // template read the same helper, so the three can no longer drift apart.
      .map((c) => productLabel(c))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    [catalog],
  )

  const setCell = useCallback((r: number, c: number, v: string) => {
    writeRows((prev) => {
      const next = prev.map((row) => row.slice())
      next[r][c] = v
      /* A NEW PRODUCT INVALIDATES THE VARIANT CELLS. Leaving "Navy" behind when the row now
         names a product that has no Navy keeps a value the dropdown no longer offers — the
         exact thing the Apps Script cleared with clearContent(). Only when it actually
         changed, or typing a product one letter at a time would wipe the row repeatedly. */
      if (c === IDX.blank && prev[r][c] !== v) {
        next[r][IDX.item_color] = ""
        next[r][IDX.item_size] = ""
        next[r][IDX.print_type] = ""
      }
      return next
    })
  }, [writeRows])

  /**
   * PASTE A BLOCK, from Excel or anywhere else.
   *
   * parsePasted is the Paste tab's own parser, so a block that works there works here. It
   * lands at the focused cell rather than at 0,0 — pasting a column of sizes into the Size
   * column is the common case, and forcing it to the top-left would make the feature useless
   * for exactly that.
   *
   * The grid GROWS to fit. Silently truncating a 300-row paste to the 8 visible rows is the
   * kind of quiet data loss someone only finds after submitting.
   */
  const onPaste = useCallback((e: React.ClipboardEvent, r: number, c: number) => {
    // EDITING WINS. The caret is in the text, so the clipboard belongs to this cell — even
    // when it carries newlines, which is exactly the copied-address case.
    if (editing === `${r}-${c}`) return
    const text = e.clipboardData.getData("text/plain")
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return   // one cell: let the browser do it
    e.preventDefault()
    const block = parsePasted(text)
    if (!block.length) return
    writeRows((prev) => {
      const need = r + block.length
      const next = prev.map((row) => row.slice())
      while (next.length < need) next.push(blankRow())
      block.forEach((line, i) => {
        line.forEach((val, j) => {
          const col = c + j
          if (col < CSV_COLUMNS.length) next[r + i][col] = String(val ?? "").trim()
        })
      })
      return next
    })
  }, [editing, writeRows])

  /** Arrow/Enter move between cells. A grid you cannot leave the mouse for is a form. */
  const onKeyDown = useCallback((e: React.KeyboardEvent, r: number, c: number) => {
    const key = `${r}-${c}`
    const go = (dr: number, dc: number) => {
      e.preventDefault()
      setEditing(null)
      const sel = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${r + dr}-${c + dc}"]`)
      sel?.focus()
    }
    if (e.key === "Escape") { setEditing(null); return }
    // Left/Right inside a value belong to the CARET, not to the grid — stepping columns
    // while someone is editing a street name is how a half-typed address ends up split.
    if (editing === key && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return
    if (e.key === "ArrowDown" || e.key === "Enter") go(1, 0)
    else if (e.key === "ArrowUp") go(-1, 0)
    else if (e.key === "Tab" && !e.shiftKey && c === CSV_COLUMNS.length - 1) go(1, -(CSV_COLUMNS.length - 1))
    // Any character typed into a merely-selected cell starts editing it, so the next paste
    // lands in the cell rather than across the sheet.
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) setEditing(key)
  }, [editing])

  const openMenu = useCallback((el: HTMLElement, key: string) => {
    const r = el.getBoundingClientRect()
    setMenu({ key, left: r.left, top: r.bottom, width: r.width })
  }, [])

  /* The menu is fixed, so it does not travel with the cell — anything that MOVES the cell
     has to close it, or it hangs over the sheet pointing at nothing. Capture phase, because
     the scroll happens on the table container rather than on the window.

     BUT THE LIST IS A SCROLLING THING TOO. `scroll` does not bubble, so this had to be a
     capture listener on window to see the table container — and a capture listener on window
     sees EVERY scroll in the document, the menu's own `overflow-auto` included. So opening a
     column with more options than fit and turning the wheel emitted a scroll event, which
     closed the menu on the first notch: the list could be looked at and never scrolled. It
     was worst exactly where it mattered most, on Blank Product, which is the one column with
     hundreds of options.

     The cell moving is still what closes it. A scroll that STARTED inside the menu is the
     list doing its job, and is ignored by target. */
  useEffect(() => {
    if (!menu) return
    const close = (e?: Event) => {
      const t = e?.target as Node | null
      if (t && menuRef.current && (t === menuRef.current || menuRef.current.contains(t))) return
      setMenu(null)
    }
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [menu])

  const addRows = () => writeRows((p) => [...p, ...Array.from({ length: 5 }, blankRow)])

  /**
   * REMOVE THE ROW, not its contents.
   *
   * This used to blank the cells and leave the row sitting there, so deleting a line you had
   * pasted by mistake left a gap you then had to scroll past — and pressing it on the last
   * row appeared to do nothing at all.
   *
   * `editing` and `menu` are keyed by "row-col", so both are dropped: after a splice those
   * coordinates point at whatever moved up into the gap, which is a menu anchored to a cell
   * nobody opened.
   *
   * The sheet never empties completely — the last row is replaced rather than removed,
   * because a grid with no rows offers nowhere to start typing.
   */
  const removeRow = (r: number) => {
    setEditing(null)
    setMenu(null)
    writeRows((p) => (p.length <= 1 ? [blankRow()] : p.filter((_, i) => i !== r)))
  }

  const complete = async () => {
    const filled = rows.filter((r) => r.some((c) => c.trim() !== ""))
    if (!filled.length) return
    await onComplete(filled)
  }

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
      <div
        ref={gridRef}
        className={
          fill
            ? "min-h-0 flex-1 overflow-auto rounded-xl border border-border"
            : "max-h-[52vh] overflow-auto rounded-xl border border-border"
        }
      >
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="w-10 border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
              {CSV_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  title={col.help}
                  className={`${widthFor(col.key)} border-b border-l border-border px-2 py-1.5 text-left font-medium whitespace-nowrap`}
                >
                  {col.header}
                  {col.required && <span className="ms-1 text-destructive">*</span>}
                </th>
              ))}
              <th className="w-8 border-b border-l border-border" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const rec = byRow.get(r)
              /**
               * THE RED IS PER-CELL, AND ONLY ON A ROW SOMEONE STARTED.
               *
               * Tinting the whole ROW meant every blank row in the sheet was pink before
               * anyone typed — eight rows of alarm describing nothing, which reads as the
               * feature being broken rather than as work to do. And even on a real row it
               * said "something here is wrong" without saying WHICH of 21 cells.
               *
               * So: a required cell, left empty, on a row that has any content at all.
               * An untouched row is not a mistake; it is an untouched row.
               */
              const started = rows[r].some((v) => v.trim() !== "")
              return (
                <tr key={r}>
                  <td
                    title={started ? (rec?._errors || rec?._warnings || undefined) : undefined}
                    className="border-b border-border bg-muted/40 px-2 py-1 text-right text-muted-foreground tabular-nums"
                  >
                    {r + 1}
                  </td>
                  {CSV_COLUMNS.map((col, c) => {
                    const opts = optionsFor(col.key, row)
                    const list = col.key === "blank" ? productNames : opts
                    const missing = started && col.required && !(row[c] ?? "").trim()
                    return (
                      <td
                        key={col.key}
                        className={`border-b border-l border-border p-0 ${missing ? "bg-destructive/10" : ""}`}
                      >
                        <input
                          data-cell={`${r}-${c}`}
                          value={row[c] ?? ""}
                          onFocus={(e) => { if (list?.length) openMenu(e.currentTarget, `${r}-${c}`) }}
                          onChange={(e) => {
                            setEditing(`${r}-${c}`)
                            setCell(r, c, e.target.value)
                            if (list?.length) openMenu(e.currentTarget, `${r}-${c}`)
                          }}
                          onPaste={(e) => onPaste(e, r, c)}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                          /* Double-click is the spreadsheet gesture for "let me into this
                             value". A single click only selects, so the next paste still
                             spreads across rows the way a copied column should. */
                          onDoubleClick={() => setEditing(`${r}-${c}`)}
                          onBlur={() => {
                            setEditing((k) => (k === `${r}-${c}` ? null : k))
                            setMenu((m) => (m?.key === `${r}-${c}` ? null : m))
                          }}
                          /* The caret is the ONLY signal telling the two modes apart, so a
                             merely-selected cell must not show one — otherwise the rule
                             "if it is flashing, paste goes in the box" is unreadable. */
                          style={editing === `${r}-${c}` ? undefined : { caretColor: "transparent" }}
                          className="w-full bg-transparent px-2 py-1 outline-none focus:bg-accent focus:ring-1 focus:ring-ring"
                        />
                      </td>
                    )
                  })}
                  <td className="border-b border-l border-border text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(r)}
                      title={tl("orderGrid", "Remove this row")}
                      aria-label={`Remove row ${r + 1}`}
                      className="px-1.5 py-1 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ALWAYS DOWNWARD, ALWAYS ANCHORED. Rendered here rather than inside the cell so the
          table's overflow cannot clip it, and capped so a 4,000-product catalogue is a
          scrollable list rather than a column taller than the screen.
          It SUGGESTS and still accepts anything typed — the sheet's own validation was
          strict:false for the same reason: a seller whose product we have not catalogued yet
          must be able to write it down and see the row flagged, not be unable to say it. */}
      {menu && (() => {
        const [mr, mc] = menu.key.split("-").map(Number)
        const col = CSV_COLUMNS[mc]
        const all = col.key === "blank" ? productNames : optionsFor(col.key, rows[mr] ?? [])
        const typed = (rows[mr]?.[mc] ?? "").trim().toLowerCase()
        /* Matched on BOTH halves: a machine file is found by its reference (MF-12) and by
           its name (logo.emb), and which of the two you remember is not ours to decide. */
        const matched = (all ?? []).filter((o) =>
          !typed || optLabel(o).toLowerCase().includes(typed) || optValue(o).toLowerCase().includes(typed))
        const shown = matched.slice(0, 50)
        if (!shown.length) return null
        return (
          <div
            ref={menuRef}
            style={{ position: "fixed", left: menu.left, top: menu.top, minWidth: Math.max(menu.width, 180), maxWidth: 320 }}
            className="z-50 max-h-60 overflow-auto rounded-lg border border-border bg-popover py-1 text-xs "
          >
            {shown.map((o) => (
              <button
                key={optValue(o)}
                type="button"
                title={optValue(o)}
                /* mousedown, not click: the input blurs first and would close this menu
                   before a click ever landed. preventDefault keeps the caret where it is. */
                onMouseDown={(e) => { e.preventDefault(); setCell(mr, mc, optValue(o)); setMenu(null) }}
                className="block w-full truncate px-2.5 py-1.5 text-left hover:bg-accent"
              >
                {optLabel(o)}
              </button>
            ))}
            {/* THE CAP, SAID OUT LOUD. 50 of several hundred blanks were rendered and the
                other few hundred simply were not there — so scrolling to the bottom of the
                list looked like the bottom of the catalogue, and a product that exists read
                as one we do not carry. A count, not a sentence: it is a FACT about the list,
                and it is the thing that tells you to keep typing. */}
            {matched.length > shown.length && (
              <div className="border-t border-border px-2.5 py-1.5 text-2xs tabular-nums text-muted-foreground">
                {shown.length} of {matched.length}
              </div>
            )}
          </div>
        )
      })()}

      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <Button variant="outline" onClick={onBack} disabled={busy}>
            {tl("orderGrid", "Back")}
          </Button>
        )}
        <Button onClick={complete} disabled={!validCount || busy}>
          {busy ? tl("orderGrid", "Working…") : `Complete${validCount ? ` · ${validCount} row${validCount === 1 ? "" : "s"}` : ""}`}
        </Button>
        <Button variant="outline" size="sm" onClick={addRows} disabled={busy}>{tl("orderGrid", "Add rows")}</Button>
        {/* THE ONLY SENTENCE ON THIS SCREEN, and it is here because the state is not
            otherwise readable: a draft and a submitted order look the same from a grid that
            has just emptied. §4 allows a warning to carry its reason. */}
        <span className="text-xs text-muted-foreground">
          {tl("orderGrid", "Complete creates drafts — nothing is charged until you submit them from Orders.")}
        </span>
      </div>
    </div>
  )
}

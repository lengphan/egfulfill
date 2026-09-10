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
import { createPortal } from "react-dom"
import { ArrowCounterClockwise, ArrowClockwise, Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  CSV_COLUMNS,
  COLUMN_OPTIONS,
  ITEM_SIZES,
  US_STATES,
  TEMPLATE_HEADERS,
  SIDE_LABEL,
  SIDE_OPTIONS,
  rowsToRecords,
  parsePasted,
  type ImportRecord,
} from "@/lib/order-import"
import { productColors, productSizes } from "@/lib/variant-sku"
import { resolveProduct, productLabel, setTypeMockups, offeredSides } from "@/lib/variant-resolve"
import { normalizeMethods } from "@/lib/print-method"
import { platformName } from "@/shared/order-rules"
import { getCatalogProducts, getTemplates, getDesignLibrary, getMachineFiles, getProductTypes,
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
  /* All eight faces, for a row that has not named a product yet. Once it has, optionsFor
     narrows this to the faces that garment's TYPE actually has — a beanie has no sleeve. */
  print_side: SIDE_OPTIONS,
}

/** Where a viewer's dragged column widths and row heights live. Per BROWSER, not per sheet:
 *  the 21 columns are the same on every sheet, so a width learned once should hold. */
const SIZING_KEY = "eg.sheet.grid.sizing"

const NARROW = new Set(["item_quantity", "item_size", "ship_state", "ship_zip"])
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
  /** What the back control says — the sheet page's is "Back to import" when it came from there. */
  backLabel?: string
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
  /**
   * WHERE THE TOOLBAR GOES, when the page has a better place for it than above the grid.
   *
   * The sheet page already draws a title row with an empty right-hand side; the controls
   * belong there, so the sheet starts one row higher and the buttons sit where Back always
   * was. A DOM node rather than a render prop on purpose: these controls read this
   * component's state — undo depth, the valid row count, `busy` — and lifting that to the
   * page would make the page own a grid's internals in order to draw four buttons.
   *
   * Null (the ref has not attached yet, or no page offers one) renders them in place, which
   * is also what every other caller gets.
   */
  toolbarTarget?: HTMLElement | null
  /** A control belonging to the PAGE, rendered in the toolbar between the history icons and
   *  Back — the slot Add rows vacated when it became a plus under the last row. The sheet
   *  page puts its Save there; a caller with nothing to add passes nothing. */
  saveSlot?: React.ReactNode
}

export function OrderGrid({ onComplete, busy, onBack, backLabel, fill, initialRows, onRowsChange, toolbarTarget, saveSlot }: OrderGridProps) {
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
  /* Held as well as handed to setTypeMockups, because typeSidesOf cannot say "I have never
     heard of this type" — it answers ["front"] for a category nobody has configured exactly
     as it does for one that genuinely prints on the front only. Knowing which types exist is
     what tells a real answer from a default. */
  const [productTypes, setProductTypes] = useState<{ name: string }[]>([])
  useEffect(() => {
    let live = true
    getCatalogProducts().then((c) => { if (live) setCatalog(c ?? []) }).catch(() => {})
    getTemplates().then((t) => { if (live) setTemplates(t ?? []) }).catch(() => {})
    getDesignLibrary().then((d) => { if (live) setImages(d ?? []) }).catch(() => {})
    getMachineFiles().then((m) => { if (live) setMachineFiles(m ?? []) }).catch(() => {})
    /* THE FACES EACH CATEGORY HAS, so the Placement cell can offer a beanie's sides rather
       than a t-shirt's. Handed to setTypeMockups because typeSidesOf reads that module-level
       table — the same call design-maker makes, so the two can never disagree about which
       faces a type prints. A failure here only costs the narrowing: FIXED_OPTIONS still
       offers all eight. */
    getProductTypes().then((t) => { if (!live) return; setProductTypes(t ?? []); setTypeMockups(t ?? []) }).catch(() => {})
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
  /**
   * ── UNDO ─────────────────────────────────────────────────────────────────────────────
   *
   * A sheet is the one surface in this app where a mistake is a keystroke: paste into the
   * wrong row, hit Delete on a selected cell, drag a fill you did not mean. There was no way
   * back from any of it — the autosave had already written it, and Ctrl+Z did nothing
   * because every cell is its own <input> and the browser's own undo stops at the cell you
   * are in. So the grid keeps its own stack.
   *
   * WHOLE SNAPSHOTS, not diffs. `rows` is a few hundred short strings; fifty copies of it
   * cost less than the code needed to invert an edit correctly, and an inverse that is
   * subtly wrong is worse than no undo at all.
   *
   * CONSECUTIVE KEYSTROKES IN ONE CELL COLLAPSE. Typing an address is one action to the
   * person doing it, and an undo that walks back a letter at a time is one nobody presses
   * twice. Same cell within a second replaces the top of the stack rather than pushing;
   * anything else — a different cell, a paste, a row added, a second of thought — starts a
   * new entry.
   */
  const past = useRef<string[][][]>([])
  const future = useRef<string[][][]>([])
  const lastTag = useRef<{ tag: string; at: number } | null>(null)
  /* The stacks are refs (a drag writes them dozens of times a second and none of that
     should re-render); this mirrors just the two facts the buttons need. Refs cannot be
     read during render — react-hooks/refs is right about that — so the mirror is state. */
  const [hist, setHist] = useState({ undo: false, redo: false })
  const noteHistory = useCallback(() => setHist({ undo: past.current.length > 0, redo: future.current.length > 0 }), [])
  const HISTORY_MAX = 60

  /* One place every mutation goes through, so "tell the caller it changed" cannot be
     forgotten by the next thing that edits a cell.
     The callback is read from the PROP, not held in a ref — writing a ref during render is
     what react-hooks/refs rejects, and there is nothing here a dependency cannot express. */
  const writeRows = useCallback((fn: (prev: string[][]) => string[][], tag?: string) => {
    setRows((prev) => {
      const next = fn(prev)
      const now = Date.now()
      const coalesce = !!tag && lastTag.current?.tag === tag && now - (lastTag.current?.at ?? 0) < 1000
      if (!coalesce) {
        past.current = [...past.current, prev].slice(-HISTORY_MAX)
        future.current = []
      }
      lastTag.current = tag ? { tag, at: now } : null
      // OUT of the updater. React may invoke an updater more than once, and a side effect
      // inside one runs as many times as it does — queueMicrotask keeps the state function
      // pure while still firing on the EVENT rather than from an effect watching `rows`.
      queueMicrotask(() => { onRowsChange?.(next); noteHistory() })
      return next
    })
  }, [onRowsChange, noteHistory])

  /* Undo and redo write through setRows DIRECTLY, never through writeRows — going back
     through it would file the undo itself as a new edit and there would be no way forward.
     They still tell the caller, because the sheet has to save what you can now see. */
  const step = useCallback((back: boolean) => {
    setRows((cur) => {
      const from = back ? past : future
      const to = back ? future : past
      if (!from.current.length) return cur
      const next = from.current[from.current.length - 1]
      from.current = from.current.slice(0, -1)
      to.current = [...to.current, cur].slice(-HISTORY_MAX)
      lastTag.current = null
      queueMicrotask(() => { onRowsChange?.(next); noteHistory() })
      return next
    })
  }, [onRowsChange, noteHistory])
  const undo = useCallback(() => step(true), [step])
  const redo = useCallback(() => step(false), [step])
  const canUndo = hist.undo
  const canRedo = hist.redo
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
  /** The cell the fill handle belongs to — the one with focus. Kept in state rather than read
   *  from document.activeElement because the handle has to RENDER, and a ref does not. */
  /**
   * The cell the fill handle belongs to — now a ROW and a COLUMN RANGE, because a sheet fills
   * several columns at once and typing the same address across four of them is the case this
   * whole gesture exists for. `c0`/`c1` are inclusive and unordered until read: shift-click
   * can extend leftward.
   */
  const [fillFrom, setFillFrom] = useState<{ r: number; c0: number; c1: number } | null>(null)
  /** The selected columns as an inclusive [lo, hi], or null. */
  const fillCols = fillFrom ? [Math.min(fillFrom.c0, fillFrom.c1), Math.max(fillFrom.c0, fillFrom.c1)] as const : null
  /** The CELL the pointer is over mid-drag — row and column, because the dot now drags in
   *  both axes. null when no drag is running. Drives the preview; the release writes it. */
  const [fillTo, setFillTo] = useState<{ r: number; c: number } | null>(null)
  /** Did this focus come from a pointer? A ref, not state — it is read inside the same
   *  gesture that sets it, and a re-render between mousedown and click would be a bug of its
   *  own. See the cell's onMouseDown / onClick. */
  const pointerSel = useRef(false)
  /** Was Shift held on the mousedown that is about to move focus? A ref for the same reason
   *  pointerSel is one: it is written and read inside a single gesture, and a re-render
   *  between mousedown and focus would be a bug of its own. Shift+click extends the fill
   *  selection sideways — the "select a few columns, then drag" case. */
  const shiftRef = useRef(false)
  /** Which whole row is selected, by index. Cleared the moment a cell takes focus — a
   *  sheet cannot have both a live cell and a live row without the next keypress being
   *  ambiguous about which one it means. */
  const [sel, setSel] = useState<{ anchor: number; end: number } | null>(null)
  /** The selected rows as an inclusive [lo, hi]. A plain click is a range of one; Shift
   *  extends from the anchor — the row first clicked — in either direction, the way every
   *  sheet does it. Copy, paste and Delete all act on the whole range. */
  const selRange = sel ? [Math.min(sel.anchor, sel.end), Math.max(sel.anchor, sel.end)] as const : null
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
  /**
   * `typed` is the difference between "I am picking" and "I am narrowing", and without it
   * the list narrows itself to the answer you already gave.
   *
   * Focusing a cell SELECTS its whole value (see the input's onFocus) — the spreadsheet
   * rule that what you type replaces what is there. So the text in a filled cell is not
   * something the person typed at this menu; it is the thing they are about to overwrite.
   * Filtering by it meant clicking back into a cell reading "Navy" offered exactly one
   * option, Navy, and the only way to see the other colours was to delete the value first.
   * Opened by focus, the menu shows everything the cell allows; it filters once a key is
   * actually pressed.
   */
  const [menu, setMenu] = useState<{ key: string; left: number; top: number; width: number; typed: boolean } | null>(null)
  /** The popup's own node, so the close-on-scroll listener can tell the sheet scrolling
   *  (which must close it) from the LIST scrolling (which must not). */
  const menuRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  /**
   * ── DRAG A SEPARATOR, MOVE A COLUMN OR A ROW ──────────────────────────────────────────
   *
   * 21 columns share one width rule (`widthFor`), so every address column is as wide as the
   * longest one anybody has ever needed and "Ship Address 2" is as wide as "Ship Address 1"
   * — which is why the sheet scrolls sideways past everything you are actually typing. There
   * is nothing wrong with the default; there is something wrong with it being the only one.
   *
   * SIZES ARE THE VIEWER'S, NOT THE SHEET'S. Two people filling the same sheet want different
   * columns wide, and a width saved on the row would travel to the factory as if it meant
   * something. So this lives in localStorage — wrapped, because a private window throws on
   * read and a grid that cannot open is a worse bug than a column that is too narrow.
   *
   * The handle is a strip on the separator itself, and DOUBLE-CLICK PUTS IT BACK. A resize
   * with no way home is a state you can enter and not leave, which is the same objection
   * that got the canvas its zoom reset.
   */
  const [colW, setColW] = useState<Record<string, number>>({})
  const [rowH, setRowH] = useState<Record<number, number>>({})
  /* The ref is what the pointer handlers read and write; the state exists to re-render.
     A drag fires dozens of moves a second and every one of them needs the value BEFORE it,
     which a state updater cannot hand back synchronously. */
  const sizing = useRef<{ cols: Record<string, number>; rows: Record<number, number> }>({ cols: {}, rows: {} })
  const drag = useRef<{ axis: "col" | "row"; key: string; from: number; at: number } | null>(null)

  /** Narrow enough to be a deliberate choice, wide enough to still be a column. */
  const MIN_COL = 56
  const MIN_ROW = 24

  const saveSizing = useCallback(() => {
    try { localStorage.setItem(SIZING_KEY, JSON.stringify(sizing.current)) } catch { /* no storage; the sizes are still live on screen */ }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(SIZING_KEY)
        const v = raw ? JSON.parse(raw) : null
        if (!v || typeof v !== "object") return
        sizing.current = { cols: v.cols ?? {}, rows: v.rows ?? {} }
        setColW(sizing.current.cols); setRowH(sizing.current.rows)
      } catch { /* unreadable or from an older shape — the defaults are correct */ }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  /**
   * THE DRAG LIVES ON THE WINDOW, not on the handle.
   *
   * It was `setPointerCapture` plus onPointerMove/onPointerUp on the strip itself, and that
   * left a resize that never ended: if the up event does not land back on the handle — the
   * capture not taking, a release outside the window, the node re-rendering mid-drag — then
   * `drag.current` is still set, and the next time the pointer merely PASSES OVER the strip
   * the column follows it. Hovering resized. A gesture whose end depends on the pointer
   * coming home is a gesture that will sometimes not end.
   *
   * Window listeners cannot miss: pointerup anywhere finishes it, pointercancel finishes it,
   * and they are removed the moment it does — so between drags there is nothing listening at
   * all and a hover is only a hover.
   */
  const startResize = (e: React.PointerEvent<HTMLElement>, axis: "col" | "row", key: string, from: number) => {
    // The header cell under it opens a sort/menu on click and the row number does nothing;
    // either way the drag is not a click on the thing it sits on.
    e.preventDefault(); e.stopPropagation()
    const at = axis === "col" ? e.clientX : e.clientY
    drag.current = { axis, key, from, at }
    const move = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const delta = (d.axis === "col" ? ev.clientX : ev.clientY) - d.at
      const next = Math.max(d.axis === "col" ? MIN_COL : MIN_ROW, Math.round(d.from + delta))
      if (d.axis === "col") { sizing.current.cols = { ...sizing.current.cols, [d.key]: next }; setColW(sizing.current.cols) }
      else { sizing.current.rows = { ...sizing.current.rows, [Number(d.key)]: next }; setRowH(sizing.current.rows) }
    }
    const end = () => {
      drag.current = null
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      saveSizing()
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
  }
  /** Back to automatic — the size is REMOVED, not set to whatever the default happens to
   *  be today, so a column reset now still follows a change to `widthFor` later. */
  const resetSize = (axis: "col" | "row", key: string) => {
    if (axis === "col") {
      const rest = { ...sizing.current.cols }; delete rest[key]
      sizing.current.cols = rest; setColW(rest)
    } else {
      const rest = { ...sizing.current.rows }; delete rest[Number(key)]
      sizing.current.rows = rest; setRowH(rest)
    }
    saveSizing()
  }

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
   * Artwork ID now does too. It used to be the odd one out — the importer read it as
   * `/^https?:\/\//.test(v) ? v : ""`, so despite the column's NAME it wanted a URL and
   * dropped a reference silently. Offering `IMG-12` then would have looked right and
   * imported nothing, so the value was the address and the label was the name; the reference
   * the seller reads off their own library card was the one thing the column would not take.
   * The parser resolves references now (order-import.ts), so all three ID columns speak the
   * same language and the cell says what the library card says.
   *
   * Entries with no http(s) address are still left out: a reference that resolves to nothing
   * printable is worse than not offering it.
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
      .map((d) => ({ value: `IMG-${d.id}`, label: `IMG-${d.id}${d.name ? ` · ${d.name}` : ""}` })),
  }), [templates, machineFiles, images, stores])

  const optionsFor = useCallback(
    (colKey: string, row: string[]): Opt[] | null => {
      const refs = refOptions[colKey]
      if (refs) return refs.length ? refs : null
      const dependent = colKey === "item_color" || colKey === "item_size" || colKey === "print_type" || colKey === "print_side"
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
      /* The faces this garment's TYPE prints, spelled the way the dropdown spells them —
         SIDE_LABEL, so the cell holds "Left sleeve" and never the bare "left" that would
         read as an unfinished sentence in a spreadsheet. normalizeSide reads both back. */
      if (colKey === "print_side") {
        /* THE PRODUCT'S OWN FACES FIRST, its category's after — and `offeredSides` is that
           rule, shared with the designer's face strip so a blank cannot offer a placement
           here that you then cannot place artwork on there. It answers null for a type
           nobody has configured, which is where the fallback to all eight belongs: offering
           one face when the truth is "we have not been told" is worse than offering all of
           them. This was written out inline here and not at all in the designer, which is
           how the two came to disagree about the same duffel. */
        const declared = offeredSides(p as never)
        return declared
          ? declared.map((sd) => SIDE_LABEL[sd] ?? sd)
          : FIXED_OPTIONS.print_side ?? null
      }
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
    /* `productTypes` is no longer read here — offeredSides consults the type map directly.
       It is still fetched above, because filling that map is what lets it answer. */
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

  /**
   * THE FILL HANDLE — drag the corner of a cell down and its value follows.
   *
   * The one gesture a sheet is expected to have and this grid did not. Typing the same blank,
   * colour and method into forty rows is what an import sheet mostly IS, and every one of
   * those was a separate keystroke run.
   *
   * ONE UNDO for the whole drag, which is why it writes through writeRows directly rather
   * than calling setCell per row: setCell tags each write `cell:<r>:<c>`, so a fill of forty
   * rows would be forty entries to walk back through.
   *
   * It repeats the SOURCE CELL rather than extrapolating a series. A sheet's fill does both,
   * and guessing which was meant is how "S, M" becomes "S, M, L, XL" on rows that wanted
   * three smalls. Copying is the one reading that is never a surprise.
   *
   * The blank column's cascade is replicated here on purpose: setCell clears colour, size,
   * method and side when the product changes, because those values name options the new
   * product may not offer. A fill that skipped that would leave "Navy" on forty rows that no
   * longer have a Navy — the exact state that clear exists to prevent.
   */
  /**
   * THE FILL — a rectangle from the anchor to wherever the dot was dragged, in either axis.
   *
   * Down repeats the row; sideways repeats the column; both at once fills the rectangle. That
   * is what a sheet does, and it is the same gesture either way, so it is one function rather
   * than a fillDown and a fillRight that would drift apart.
   *
   * The anchor is a ROW and a COLUMN RANGE. Dragging a four-column selection down writes each
   * column its own value. Dragging one cell sideways writes that value across. A wide anchor
   * dragged wider TILES — target column c takes the anchor column (c - lo) mod width — which
   * is the only rule that answers every combination without a special case.
   *
   * ONE UNDO for the whole drag: it writes through writeRows directly rather than calling
   * setCell per cell, which tags each write `cell:<r>:<c>` and would leave a forty-row fill as
   * forty entries to walk back through.
   *
   * It repeats rather than extrapolating a series. Guessing which was meant is how "S, M"
   * becomes "S, M, L, XL" on rows that wanted three smalls.
   */
  const fillRange = useCallback((from: { r: number; c0: number; c1: number }, toR: number, toC: number) => {
    const cLo = Math.min(from.c0, from.c1)
    const cHi = Math.max(from.c0, from.c1)
    const rLo = Math.min(from.r, toR)
    const rHi = Math.max(from.r, toR)
    const tLo = Math.min(cLo, toC)
    const tHi = Math.max(cHi, toC)
    if (rHi === rLo && tHi === cHi && tLo === cLo) return
    const width = cHi - cLo + 1
    writeRows((prev) => {
      const src = prev[from.r]
      if (!src) return prev
      const next = prev.map((row) => row.slice())
      for (let r = rLo; r <= rHi; r++) {
        if (!next[r]) continue
        const cols: number[] = []
        for (let c = tLo; c <= tHi; c++) {
          // The anchor itself is never rewritten — it is what everything else is copied FROM.
          if (r === from.r && c >= cLo && c <= cHi) continue
          cols.push(c)
        }
        if (!cols.length) continue
        /* THE BLANK'S CASCADE RUNS FIRST, whatever order the columns come in. It clears
           colour, size, method and side (setCell does the same on a single edit, because
           those name options the new product may not offer) — so doing it up front means
           every other column in the range then writes over a cleared cell instead of having
           its freshly-written value wiped a moment later. */
        if (cols.includes(IDX.blank) && next[r][IDX.blank] !== src[cLo + ((IDX.blank - tLo) % width + width) % width]) {
          next[r][IDX.item_color] = ""
          next[r][IDX.item_size] = ""
          next[r][IDX.print_type] = ""
          next[r][IDX.print_side] = ""
        }
        for (const c of cols) next[r][c] = src[cLo + (((c - tLo) % width) + width) % width] ?? ""
      }
      return next
    }, `fill:${from.r}:${cLo}-${cHi}:${Date.now()}`)
  }, [writeRows])

  /**
   * THE DRAG. Pointer events on the WINDOW, not on the handle: a fill runs across the sheet
   * and the pointer leaves the 9px dot immediately, so a handler bound to the dot would stop
   * hearing about it on the first pixel.
   *
   * The cell under the pointer is READ from the DOM rather than computed from a row height —
   * rows here are not a fixed height (a wrapped product name makes one taller) and columns are
   * not a fixed width, so arithmetic off the start position drifts further from the truth the
   * further you drag.
   */
  const startFill = useCallback((from: { r: number; c0: number; c1: number }) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const cHi = Math.max(from.c0, from.c1)
    setFillTo({ r: from.r, c: cHi })
    const cellUnder = (x: number, y: number): { r: number; c: number } | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      const cell = el?.closest<HTMLElement>("[data-cell]")
      const rc = cell?.dataset.cell?.split("-")
      if (!rc || rc.length < 2) return null
      const r = Number(rc[0]); const c = Number(rc[1])
      return Number.isFinite(r) && Number.isFinite(c) ? { r, c } : null
    }
    const move = (ev: PointerEvent) => {
      const n = cellUnder(ev.clientX, ev.clientY)
      // FORWARD ONLY. A sheet fills up and left as well, but the dot sits at the bottom-right
      // and a backward drag from it reads as a mis-grab far more often than as an intention.
      if (n && n.r >= from.r && n.c >= cHi) setFillTo(n)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      const n = cellUnder(ev.clientX, ev.clientY)
      setFillTo(null)
      if (n && n.r >= from.r && n.c >= cHi && (n.r > from.r || n.c > cHi)) fillRange(from, n.r, n.c)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }, [fillRange])



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
        /* A face is as much a property of the garment as a size is — a sleeve placement
           left behind on a row that now names a beanie is a value its dropdown no longer
           offers, which is the exact thing this block exists to clear. */
        next[r][IDX.print_side] = ""
      }
      return next
    /* Tagged with the cell, so a burst of typing in one box is ONE undo — see writeRows. */
    }, `cell:${r}:${c}`)
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
  const onPaste = useCallback((e: React.ClipboardEvent, r: number, c: number, fillRows?: number) => {
    // EDITING WINS. The caret is in the text, so the clipboard belongs to this cell — even
    // when it carries newlines, which is exactly the copied-address case.
    if (editing === `${r}-${c}`) return
    const text = e.clipboardData.getData("text/plain")
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return   // one cell: let the browser do it
    e.preventDefault()
    let block = parsePasted(text)
    if (!block.length) return
    /* THE SELECTION IS FILLED, not just started. Copy one row, select ten, paste — and only
       the first got it, which is the one outcome nobody selecting ten rows wants. When the
       selection is LARGER than the clipboard, the block repeats down through it, the way
       Sheets and Excel tile a paste over a bigger selection. When it is smaller, the block
       still pastes in full: a selection of one must never truncate eight copied rows. */
    if (fillRows && fillRows > block.length) block = Array.from({ length: fillRows }, (_, i) => block[i % block.length])
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
    /* UNDO / REDO, and they have to be caught HERE. Every cell is its own <input>, so the
       browser's native undo applies to the box you are in and stops there — press it after
       a paste that filled four rows and one cell steps back. Cmd/Ctrl+Z and its shifted
       twin (plus Ctrl+Y, which is what a Windows hand reaches for) belong to the SHEET. */
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
      e.preventDefault()
      const isRedo = e.key === "y" || e.key === "Y" || e.shiftKey
      setEditing(null)
      if (isRedo) redo(); else undo()
      return
    }
    /* DELETE CLEARS A SELECTED CELL, whole. Inside an edit it is the ordinary key and must
       stay one — deleting a character is not "empty this box". */
    if (editing !== key && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault()
      setCell(r, c, "")
      return
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
  }, [editing, undo, redo, setCell])

  const openMenu = useCallback((el: HTMLElement, key: string, typed = false) => {
    const r = el.getBoundingClientRect()
    setMenu({ key, left: r.left, top: r.bottom, width: r.width, typed })
  }, [setMenu])

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
    setSel(null)
    writeRows((p) => (p.length <= 1 ? [blankRow()] : p.filter((_, i) => i !== r)))
  }

  /**
   * THE ROW NUMBER SELECTS THE ROW, which is what it does in every sheet anyone has used.
   *
   * It was the one cell in the grid that was not an input and did nothing at all — it
   * carried the drag-to-resize handle on its bottom border and otherwise just printed a
   * number. So there was no way to say "this row" and no way to empty one: clearing eleven
   * cells meant eleven Deletes, and the only row-level control was Remove, which is a
   * different act with a different consequence.
   *
   * Selected, Delete CLEARS the row rather than deleting it — the spreadsheet meaning, and
   * the safe one: the row stays where it is, so nothing below it shifts up under the cursor.
   * Removing a row is still the X at the end, which is the destructive act and looks like it.
   */
  const clearRows = (lo: number, hi: number) => {
    setEditing(null)
    setMenu(null)
    writeRows((p) => p.map((row, i) => (i >= lo && i <= hi ? blankRow() : row)))
  }

  const complete = async () => {
    const filled = rows.filter((r) => r.some((c) => c.trim() !== ""))
    if (!filled.length) return
    await onComplete(filled)
  }

  /**
   * THE CONTROLS SIT ON THE SHEET'S OWN TITLE ROW (owner's call, 2026-09-09).
   *
   * They were under the grid first — below a full-height scroll, so Complete, the one thing
   * this screen is for, was off-screen until you had scrolled past every row. Moving them
   * above the data fixed that and cost a whole row of chrome between the title and the
   * sheet. `toolbarTarget` lets the page hand over a slot in the row it already has, so the
   * buttons land at the top right where Back used to be and the grid starts one row higher.
   * Without a target they render in place, unchanged.
   *
   * LEFT TO RIGHT: minor to primary. Undo and Redo, then Add rows, then Back, then Complete
   * last — the rightmost thing is the one the screen is for, and the eye ends where the
   * action is (§4's variant hierarchy, read across).
   *
   * Undo and Redo are icon-only: they are the two controls here whose glyph IS the word,
   * they have the keystroke as the real control, and their labels were the widest part of
   * the row. The title carries the name and the shortcut for anyone who needs it (§4: a
   * control explains itself in its label or its title — not in prose underneath).
   *
   * THE SENTENCE IS GONE. "Complete creates drafts — nothing is charged until you submit
   * them from Orders" sat at the end of this row: a line of prose beside a control, which
   * §4 calls a defect outright. It was defended as a warning carrying its reason, and it is
   * not one — nothing is being warned about, and the button says what it does.
   */
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {/* THE KEYSTROKE IS THE REAL CONTROL; these say it exists. Ghost, not outline: they
          are minor next to Add rows and Complete, and a disabled one is the honest way to
          say there is nothing to go back to (§4's variant hierarchy). */}
      <Button variant="ghost" size="icon-sm" onClick={undo} disabled={busy || !canUndo}
        aria-label={tl("orderGrid", "Undo")} title={tl("orderGrid", "Undo the last change (⌘Z)")}>
        <ArrowCounterClockwise size={15} weight="bold" />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={redo} disabled={busy || !canRedo}
        aria-label={tl("orderGrid", "Redo")} title={tl("orderGrid", "Redo (⇧⌘Z)")}>
        <ArrowClockwise size={15} weight="bold" />
      </Button>
      {/* Where Add rows used to be. The sheet page owns saving, so it hands the control in
          rather than this file learning what a save is. */}
      {saveSlot}
      {onBack && (
        <Button variant="outline" size="sm" onClick={onBack} disabled={busy}>
          {backLabel || tl("orderGrid", "Back")}
        </Button>
      )}
      <Button size="sm" onClick={complete} disabled={!validCount || busy}>
        {busy ? tl("orderGrid", "Working…") : `Complete${validCount ? ` · ${validCount} row${validCount === 1 ? "" : "s"}` : ""}`}
      </Button>
    </div>
  )

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
      {/* Into the page's title row when it offers one, otherwise here. The target is a DOM
          node rather than a render prop because the controls read this component's state —
          undo depth, the valid row count, `busy` — and lifting that out to the page would
          make the page own a grid's internals to draw four buttons. */}
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
      <div
        ref={gridRef}
        /* A SHEET IS WHITE. This inherited the page's muted ground, so every cell was grey
           and the rules between them were the only lighter thing on it — the data sat in
           the dimmest layer of the screen, on the one surface where reading it IS the task.
           Card ground, hairline rules, and the grey stays outside as the page. */
        /* IT STOPS AT THE LAST ROW.
         *
         * `fill` used to mean `flex-1`, so the box grew to the bottom of the page whatever
         * it held — a sheet with 23 rows drew them, then a hand's depth of empty card, and
         * only then the horizontal scrollbar, which is the control you reach for CONSTANTLY
         * on a 21-column sheet. Pinning it to the bottom of the viewport put it as far from
         * the data as the screen allows.
         *
         * `max-h-full` instead: the box is as tall as its rows and no taller, and it still
         * shrinks and scrolls once they outgrow the page (the flex default is shrink 1, and
         * min-h-0 is what lets it actually shrink). The scrollbar rides under Add rows. */
        className={
          fill
            ? "min-h-0 max-h-full overflow-auto rounded-xl border border-border bg-card"
            : "max-h-[52vh] overflow-auto rounded-xl border border-border bg-card"
        }
      >
        {/* THE SIZE THE ORDERS LIST USES, because this is the same kind of reading.
            text-xs at weight 400 is what this app uses for captions and hints — glanced at,
            never studied — and it was carrying the primary content of a spreadsheet, where
            every value is a name, an address or a code and one wrong character matters:
            "02719-1201", "RD" against "BD". The owner's words were "impossible unless zoomed
            in, even with normal eyes". Values are 14px medium like the order rows they will
            become; the header drops to 12px muted, because it IS the caption. */}
        <table className="w-max min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="w-10 border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
              {CSV_COLUMNS.map((col) => {
                const w = colW[col.key]
                return (
                  <th
                    key={col.key}
                    title={col.help}
                    style={w ? { width: w, minWidth: w, maxWidth: w } : undefined}
                    className={`${w ? "" : widthFor(col.key)} relative overflow-hidden border-b border-l border-border px-2 py-1.5 text-left text-xs font-medium text-muted-foreground text-ellipsis whitespace-nowrap`}
                  >
                    {col.header}
                    {col.required && <span className="ms-1 text-destructive">*</span>}
                    {/* THE SEPARATOR IS THE CONTROL. It sits ON the border it moves, which is
                        the only place a resize handle is ever looked for — and it is 6px
                        rather than 1 because a 1px target is a border, not a control. */}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      title={tl("orderGrid", "Drag to resize — double-click to reset")}
                      onPointerDown={(e) => startResize(e, "col", col.key, e.currentTarget.parentElement?.getBoundingClientRect().width ?? MIN_COL)}
                      onDoubleClick={() => resetSize("col", col.key)}
                      className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/40"
                    />
                  </th>
                )
              })}
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
              const h = rowH[r]
              const isSel = !!selRange && r >= selRange[0] && r <= selRange[1]
              return (
                <tr key={r} style={h ? { height: h } : undefined} data-selected={isSel || undefined} className={isSel ? "bg-accent" : undefined}>
                  <td
                    title={started ? (rec?._errors || rec?._warnings || undefined) : tl("orderGrid", "Click to select the row")}
                    tabIndex={0}
                    aria-selected={isSel}
                    data-rownum={r}
                    /* SHIFT EXTENDS, a plain click restarts. Clicking the row that is the whole
                       selection deselects it; Shift+click keeps the first-clicked anchor and
                       moves the far end, so 1142 then Shift+1149 is eight rows either way round.
                       Shift+↑/↓ does the same from the keyboard and follows focus down the
                       numbers, so a range can be walked out without the mouse. */
                    onClick={(e) => {
                      setEditing(null); setMenu(null)
                      const shift = e.shiftKey
                      setSel((cur) => shift && cur ? { anchor: cur.anchor, end: r }
                        : cur && cur.anchor === r && cur.end === r ? null
                        : { anchor: r, end: r })
                    }}
                    onKeyDown={(e) => {
                      if (!isSel || !selRange) return
                      const [lo, hi] = selRange
                      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearRows(lo, hi) }
                      else if (e.key === "Escape") setSel(null)
                      else if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                        e.preventDefault()
                        const to = Math.max(0, Math.min(rows.length - 1, (sel?.end ?? r) + (e.key === "ArrowDown" ? 1 : -1)))
                        setSel((cur) => (cur ? { anchor: cur.anchor, end: to } : { anchor: to, end: to }))
                        gridRef.current?.querySelector<HTMLElement>(`td[data-rownum="${to}"]`)?.focus()
                      }
                    }}
                    /* COPY AND PASTE A WHOLE ROW, through the clipboard the sheet already speaks.
                       Copy writes the row as one tab-separated line — the same shape a spreadsheet
                       puts on the clipboard, so it pastes into Excel and Sheets too. Paste hands
                       the clipboard to the block handler at column 0, which is the existing
                       "spread a TSV block from here" path: nothing new decides how a pasted row
                       lands. Both are native events on the focused cell, so no permission prompt
                       and no async clipboard API. Only while the row is selected — a stray ⌘C on
                       an unselected number must not silently replace what someone copied. */
                    onCopy={(e) => {
                      if (!isSel || !selRange) return
                      e.preventDefault()
                      // Every selected row, one per line — the block shape the paste side and
                      // every spreadsheet already read.
                      e.clipboardData.setData("text/plain", rows.slice(selRange[0], selRange[1] + 1).map((row) => row.join("\t")).join("\n"))
                    }}
                    /* Paste lands at the TOP of the selection and spreads down through the block
                       handler, so a copied eight-row range dropped on a selected 1150 fills
                       1150–1157 — the selection is where it starts, not a mask on how far it goes. */
                    onPaste={(e) => { if (isSel && selRange) onPaste(e, selRange[0], 0, selRange[1] - selRange[0] + 1) }}
                    className={"relative cursor-pointer select-none border-b border-border px-2 py-1 text-right tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring "
                      + (isSel ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted")}
                  >
                    {r + 1}
                    {/* Same control on the other axis, on the row's own bottom border — the
                        row number is the only cell that is not an input, so it is the only
                        one a drag can start from without fighting the caret. */}
                    <span
                      role="separator"
                      aria-orientation="horizontal"
                      title={tl("orderGrid", "Drag to resize — double-click to reset")}
                      onPointerDown={(e) => { e.stopPropagation(); startResize(e, "row", String(r), e.currentTarget.closest("tr")?.getBoundingClientRect().height ?? MIN_ROW) }}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => { e.stopPropagation(); resetSize("row", String(r)) }}
                      className="absolute inset-x-0 bottom-0 z-20 h-1.5 cursor-row-resize touch-none select-none hover:bg-primary/40"
                    />
                  </td>
                  {CSV_COLUMNS.map((col, c) => {
                    const opts = optionsFor(col.key, row)
                    const list = col.key === "blank" ? productNames : opts
                    const missing = started && col.required && !(row[c] ?? "").trim()
                    return (
                      <td
                        key={col.key}
                        /* `relative` so the handle can sit on the cell's own corner, and
                           `group` so it can appear on hover as well as on focus — a sheet
                           shows you the grip before you have committed to the cell. */
                        className={`group relative border-b border-l border-border p-0 ${missing ? "bg-destructive/10" : ""}`}
                      >
                        <input
                          data-cell={`${r}-${c}`}
                          value={row[c] ?? ""}
                          /**
                           * ONE CLICK SELECTS THE WHOLE VALUE. Every cell is an <input>, so a
                           * click used to drop a caret wherever the pointer landed and typing
                           * INSERTED into the middle of an address. A spreadsheet does not
                           * work that way: click picks the cell, and what you type replaces
                           * what was in it. Selecting the text is what makes both true at
                           * once, and it is why Delete on a selected cell empties it.
                           *
                           * Skipped once the cell is being edited, or the double-click that
                           * enters editing would immediately re-select the whole value and
                           * undo the point of double-clicking.
                           */
                          /* A DRAG IS A SELECTION, NOT A CELL PICK (owner, 2026-09-10:
                             "enable copy just a few characters… right now it copies the whole
                             word").
                             Selecting part of a value was impossible: a drag ends in a click,
                             and the click handler below called select() — so the moment the
                             mouse came up, the whole value was reselected and ⌘C took all of
                             it. `pointerSel` is set on mousedown and read after, which is the
                             only point at which the browser's own selection reflects what was
                             actually dragged. */
                          onMouseDown={(e) => { pointerSel.current = true; shiftRef.current = e.shiftKey }}
                          onFocus={(e) => {
                            setSel(null)
                            /* Skip the select-all when focus came from a POINTER: the click
                               handler decides, once it can see whether anything was dragged.
                               Keyboard focus (Tab, arrows) still selects the whole value,
                               which is what makes typing replace it. */
                            /* CONSUMED HERE, not in the click. A mousedown that never
                               produces a click on this input — the pointer leaves the cell
                               before release — would otherwise leave the flag set, and the
                               next KEYBOARD focus would silently skip its select-all. Read
                               once, cleared once, in the same handler. */
                            /* Focus resets the selection to THIS cell. Shift-click extends it
                               sideways — see the cell's onMouseDown. */
                            /* READ ONCE, CLEARED ONCE, like pointerSel above. Left set, a
                               shift-click would make the NEXT ordinary click extend the
                               selection instead of starting a new one — a modifier that
                               outlives the gesture that pressed it. */
                            const withShift = shiftRef.current
                            shiftRef.current = false
                            setFillFrom((cur) => (withShift && cur && cur.r === r ? { ...cur, c1: c } : { r, c0: c, c1: c }))
                            const byPointer = pointerSel.current
                            pointerSel.current = false
                            if (editing !== `${r}-${c}` && !byPointer) e.currentTarget.select()
                            if (list?.length) openMenu(e.currentTarget, `${r}-${c}`, false)
                          }}
                          onClick={(e) => {
                            const el = e.currentTarget
                            if (editing === `${r}-${c}`) return
                            const from = el.selectionStart ?? 0
                            const to = el.selectionEnd ?? 0
                            // Anything the pointer actually dragged is left alone. A plain
                            // click leaves a caret (from === to) and still selects the whole
                            // value, so "click picks the cell, typing replaces it" survives.
                            if (to > from) return
                            el.select()
                          }}
                          onChange={(e) => {
                            setEditing(`${r}-${c}`)
                            setCell(r, c, e.target.value)
                            if (list?.length) openMenu(e.currentTarget, `${r}-${c}`, true)
                          }}
                          onPaste={(e) => onPaste(e, r, c)}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                          /* Double-click is the spreadsheet gesture for "let me into this
                             value". A single click only selects, so the next paste still
                             spreads across rows the way a copied column should. */
                          /* DOUBLE CLICK EDITS INSIDE. The caret goes where it was put, the
                             selection is dropped, and from here on the keys are the value's,
                             not the sheet's. */
                          onDoubleClick={(e) => {
                            setEditing(`${r}-${c}`)
                            const el = e.currentTarget
                            const at = el.selectionEnd ?? el.value.length
                            requestAnimationFrame(() => el.setSelectionRange(at, at))
                          }}
                          onBlur={() => {
                            setEditing((k) => (k === `${r}-${c}` ? null : k))
                            setMenu((m) => (m?.key === `${r}-${c}` ? null : m))
                          }}
                          /* The caret is the ONLY signal telling the two modes apart, so a
                             merely-selected cell must not show one — otherwise the rule
                             "if it is flashing, paste goes in the box" is unreadable. */
                          style={editing === `${r}-${c}` ? undefined : { caretColor: "transparent" }}
                          /* min-w-0: an input's intrinsic width is its `size` attribute
                             (~20 characters), and a table column cannot be narrower than the
                             box inside it — so without this the resize stops dead at ~170px
                             and reads as broken. */
                          /* medium, not normal: a 14px value at 400 on a white sheet is
                             still the lightest thing on screen, and these are codes read
                             character by character. */
                          className="h-full w-full min-w-0 bg-transparent px-2 py-1 font-medium outline-none focus:bg-accent focus:ring-1 focus:ring-ring"
                        />
                        {/**
                          * THE SELECTION ITSELF. Shift-click extends the anchor sideways, and
                          * until this there was nothing on screen to show for it: the dot
                          * moved to the last column and every cell looked exactly as before,
                          * so the feature was indistinguishable from a click that had missed.
                          *
                          * Only drawn for a range of two or more. A single cell already has
                          * the input's own focus ring, and a second mark on top of it would
                          * say the same thing twice.
                          *
                          * Same per-edge technique as the drag preview below, for the same
                          * reason: one rectangle around the range rather than a box per cell.
                          */}
                        {fillCols && fillFrom?.r === r && fillCols[1] > fillCols[0]
                          && c >= fillCols[0] && c <= fillCols[1] && !fillTo && (
                          <span
                            aria-hidden
                            className={`pointer-events-none absolute inset-0 z-10 border-y border-brand/60 bg-brand/10${
                              c === fillCols[0] ? " border-l" : ""}${c === fillCols[1] ? " border-r" : ""}`}
                          />
                        )}
                        {/**
                          * THE RANGE A RELEASE WOULD WRITE — a grey wash and ONE dashed
                          * rectangle around it, which is what a sheet draws and therefore what
                          * the gesture is read against.
                          *
                          * An overlay rather than classes on the <td>: the cell already owns
                          * `border-b border-l border-border`, and a preview that fought those
                          * would have to win on three properties per side and lose the cell's
                          * own grid lines while it did. This paints on top and takes nothing
                          * away — pointer-events-none, so it cannot swallow the drag it is
                          * describing.
                          *
                          * The dashes are drawn PER EDGE so the range reads as one rectangle
                          * rather than a column of separate boxes: left and right on every
                          * covered cell, top only on the first, bottom only on the last. A
                          * fill runs down a single column, so those four edges are the whole
                          * outline.
                          *
                          * The SOURCE cell is deliberately outside it. It keeps focus and its
                          * own accent while the drag runs, so what is highlighted is exactly
                          * what is about to change — the row you started from is not.
                          */}
                        {fillFrom && fillTo && fillCols && !(r === fillFrom.r && c >= fillCols[0] && c <= fillCols[1])
                          && r >= fillFrom.r && r <= fillTo.r && c >= fillCols[0] && c <= Math.max(fillCols[1], fillTo.c) && (
                          <span
                            aria-hidden
                            className={`pointer-events-none absolute inset-0 z-10 border-x border-dashed border-muted-foreground/70 bg-foreground/5${
                              r === fillFrom.r ? " border-t" : ""}${r === fillTo.r ? " border-b" : ""}`}
                          />
                        )}
                        {/* THE GRIP. Eight pixels in the cell's bottom-right corner, shown on
                            the focused cell and on hover. `touch-none` because a pointer drag
                            on a touch screen would otherwise scroll the sheet instead. */}
                        {fillFrom?.r === r && fillCols?.[1] === c && editing !== `${r}-${c}` && (
                          <span
                            role="presentation"
                            aria-hidden
                            onPointerDown={startFill(fillFrom)}
                            title={tl("grid", "Drag to copy — down, across, or both")}
                            className="absolute -bottom-[4px] -right-[4px] z-20 size-[9px] cursor-crosshair touch-none rounded-full bg-brand ring-2 ring-background"
                          />
                        )}
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
          {/**
            * ADD ROWS IS A PLUS UNDER THE LAST ROW (owner's call, 2026-09-09).
            *
            * It was a button in the toolbar, which put "make the sheet longer" at the top of
            * a sheet you lengthen at the BOTTOM — so the answer to running out of rows was
            * to scroll back up, away from the place you had run out. Every spreadsheet this
            * is modelled on puts it under the last row, where the need appears.
            *
            * A `tfoot` ROW rather than a control below the table, so it scrolls with the
            * grid and stays attached to the last row instead of pinning itself to the
            * viewport. It spans every column: the target is the width of the sheet, which
            * is what makes it hittable without aiming.
            */}
          <tfoot>
            <tr>
              <td colSpan={CSV_COLUMNS.length + 2} className="border-b border-border p-0">
                <button
                  type="button"
                  onClick={addRows}
                  disabled={busy}
                  title={tl("orderGrid", "Add five more rows")}
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                >
                  <Plus size={14} weight="bold" className="shrink-0" />
                  {tl("orderGrid", "Add rows")}
                </button>
              </td>
            </tr>
          </tfoot>
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
        // Only a real keystroke narrows the list — see the note on `menu.typed`.
        const typed = menu.typed ? (rows[mr]?.[mc] ?? "").trim().toLowerCase() : ""
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
            /* Matches the cells it writes into: a menu whose options are smaller than the
               value they become is a size change on selection. */
            /* Matches the cells it writes into — a menu whose options are smaller than the
               value they become is a size change on selection. */
            className="z-50 max-h-60 overflow-auto rounded-lg border border-border bg-popover py-1 text-sm "
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

    </div>
  )
}

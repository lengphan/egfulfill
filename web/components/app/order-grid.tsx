"use client"

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
  TEMPLATE_HEADERS,
  rowsToRecords,
  parsePasted,
  type ImportRecord,
} from "@/lib/order-import"
import { productColors, productSizes } from "@/lib/variant-sku"
import { normalizeMethods } from "@/lib/print-method"
import { getCatalogProducts, type CatalogProduct } from "@/lib/api"

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
}

export function OrderGrid({ onComplete, busy, onBack, fill }: OrderGridProps) {
  /**
   * ONE FETCH, ON MOUNT. Deliberately not keyed to anything the fetch itself writes — see
   * CLAUDE.md §2.8, where an effect that re-ran on state its own result produced took a
   * machine down. There is no condition here: it runs once and never again.
   */
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  useEffect(() => {
    let live = true
    getCatalogProducts().then((c) => { if (live) setCatalog(c ?? []) }).catch(() => {})
    return () => { live = false }
  }, [])

  const [rows, setRows] = useState<string[][]>(() => Array.from({ length: OPEN_ROWS }, blankRow))
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
  const optionsFor = useCallback(
    (colKey: string, row: string[]): string[] | null => {
      const dependent = colKey === "item_color" || colKey === "item_size" || colKey === "print_type"
      if (!dependent) return COLUMN_OPTIONS[colKey] ?? null
      const name = (row[IDX.blank] || "").trim().toLowerCase()
      const p = name ? catalog.find((c) => String(c.name || "").trim().toLowerCase() === name) : null
      if (!p) return COLUMN_OPTIONS[colKey] ?? null
      if (colKey === "item_color") return productColors(p as never)
      if (colKey === "item_size") return productSizes(p as never)
      return normalizeMethods([(p as { method?: string }).method]).map((m) => m.label)
    },
    [catalog],
  )

  const productNames = useMemo(
    () => catalog.map((c) => String(c.name || "").trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [catalog],
  )

  const setCell = useCallback((r: number, c: number, v: string) => {
    setRows((prev) => {
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
  }, [])

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
    const text = e.clipboardData.getData("text/plain")
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return   // one cell: let the browser do it
    e.preventDefault()
    const block = parsePasted(text)
    if (!block.length) return
    setRows((prev) => {
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
  }, [])

  /** Arrow/Enter move between cells. A grid you cannot leave the mouse for is a form. */
  const onKeyDown = useCallback((e: React.KeyboardEvent, r: number, c: number) => {
    const go = (dr: number, dc: number) => {
      e.preventDefault()
      const sel = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${r + dr}-${c + dc}"]`)
      sel?.focus()
    }
    if (e.key === "ArrowDown" || e.key === "Enter") go(1, 0)
    else if (e.key === "ArrowUp") go(-1, 0)
    else if (e.key === "Tab" && !e.shiftKey && c === CSV_COLUMNS.length - 1) go(1, -(CSV_COLUMNS.length - 1))
  }, [])

  const addRows = () => setRows((p) => [...p, ...Array.from({ length: 5 }, blankRow)])
  const clearRow = (r: number) => setRows((p) => p.map((row, i) => (i === r ? blankRow() : row)))

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
              const bad = rec && !rec._valid
              return (
                <tr key={r} className={bad ? "bg-destructive/5" : undefined}>
                  <td
                    title={rec?._errors || rec?._warnings || undefined}
                    className="border-b border-border px-2 py-1 text-right text-muted-foreground tabular-nums"
                  >
                    {r + 1}
                  </td>
                  {CSV_COLUMNS.map((col, c) => {
                    const opts = optionsFor(col.key, row)
                    const list = col.key === "blank" ? productNames : opts
                    return (
                      <td key={col.key} className="border-b border-l border-border p-0">
                        <input
                          data-cell={`${r}-${c}`}
                          list={list ? `og-${col.key}-${r}` : undefined}
                          value={row[c] ?? ""}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          onPaste={(e) => onPaste(e, r, c)}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                          className="w-full bg-transparent px-2 py-1 outline-none focus:bg-accent focus:ring-1 focus:ring-ring"
                        />
                        {/* A datalist, not a select: it SUGGESTS and still accepts anything.
                            The sheet's own validation was strict:false for the same reason —
                            a seller with a product we have not catalogued yet must still be
                            able to type it and see the row flagged, rather than be unable to
                            express it at all. */}
                        {list && (
                          <datalist id={`og-${col.key}-${r}`}>
                            {list.map((o) => <option key={o} value={o} />)}
                          </datalist>
                        )}
                      </td>
                    )
                  })}
                  <td className="border-b border-l border-border text-center">
                    <button
                      type="button"
                      onClick={() => clearRow(r)}
                      title="Clear this row"
                      className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
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

      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <Button variant="outline" onClick={onBack} disabled={busy}>
            Back
          </Button>
        )}
        <Button onClick={complete} disabled={!validCount || busy}>
          {busy ? "Working…" : `Complete${validCount ? ` · ${validCount} row${validCount === 1 ? "" : "s"}` : ""}`}
        </Button>
        <Button variant="outline" size="sm" onClick={addRows} disabled={busy}>Add rows</Button>
        {/* THE ONLY SENTENCE ON THIS SCREEN, and it is here because the state is not
            otherwise readable: a draft and a submitted order look the same from a grid that
            has just emptied. §4 allows a warning to carry its reason. */}
        <span className="text-xs text-muted-foreground">
          Complete creates drafts — nothing is charged until you submit them from Orders.
        </span>
      </div>
    </div>
  )
}

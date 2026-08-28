"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { Package, Trash, CircleNotch, Check, ClockCounterClockwise, ArrowUp, ArrowDown, QrCode as QrCodeIcon, DotsThree, Warning, CaretDown } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { SearchField } from "@/components/app/search-field"
import { ConsignmentPanel } from "@/components/app/consignment-panel"
import { InboundPanel } from "@/components/app/inbound-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Barcode } from "@/components/app/barcode"
import { ScanQr } from "@/components/app/scan-code"
import { LabelSheet } from "@/components/app/label-sheet"
import { usePaged, Pagination } from "@/components/app/pagination"
import { getInventory, patchInventoryItem, addInventoryItem, deleteInventoryItem, getStockMovements, getStockMovementsForSkus, resolveSuppliers, getCatalogProducts, getPurchaseOrders, type CatalogProduct, type InventoryItem, type OrderItem, type StockHistory, type SkuVisibility } from "@/lib/api"
import { getFactoryList, saveFactoryList, type SavedPOLine } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { resolveProduct } from "@/lib/variant-resolve"
import { variantSku, variantLabel, productSizes, productColors } from "@/lib/variant-sku"
import { prettyColorName } from "@/lib/color-name"
import { bySize, isOneSize, isSize } from "@/lib/size-order"
import { PageTitle } from "@/components/app/page-title"
import { TabBar } from "@/components/app/tab-bar"
import { EmptyState } from "@/components/app/empty-state"

const num = (v: unknown) => Number(v) || 0

/**
 * THE PICTURE OF THE THING ON THE SHELF.
 *
 * An inventory row is a sku and a number, which is enough to audit and not enough to pick:
 * "Adidas Ultimate365 Polo" and "Otto Cap Digital Camo 6-Panel" are the same amount of grey
 * text, and the person reading this table is holding a garment. The catalogue already has
 * the photo — the row just never asked for it.
 *
 * Colour-specific when we can: a row whose variant names a colourway gets THAT colourway's
 * photo, because a black tee and a white tee are the difference the picker is checking.
 */
const imageFor = (p: CatalogProduct | null, variant?: string | null): string => {
 if (!p) return ""
 const ci = p.colorImages ?? {}
 const v = (variant || "").toLowerCase()
 if (v) {
 for (const [c, url] of Object.entries(ci)) {
 if (!c || !url) continue
 if (v.includes(c.toLowerCase()) || v.includes(prettyColorName(c).toLowerCase())) return url
    }
  }
 return p.img || p.image || p.hero || p.images?.[0] || Object.values(ci).find(Boolean) || ""
}

/**
 * How far a SKU may travel. A row written before the column existed reads back undefined,
 * and the safe reading of "we don't know" is the closed one — never assume a blank means
 * published.
 */
const VIS: { id: SkuVisibility; label: string; pill: string }[] = [
  /* `pill` is kept for the summary row's plain label; the control itself no longer tints. */
  { id: "factory", label: "Factory only", pill: "text-muted-foreground" },
  { id: "seller", label: "Sellers", pill: "text-packed" },
  { id: "public", label: "Public", pill: "text-working" },
]
const visOf = (it: InventoryItem): SkuVisibility => (it.visibility === "seller" || it.visibility === "public" ? it.visibility : "factory")
const isOut = (it: InventoryItem) => num(it.in_stock) <= 0
const isLow = (it: InventoryItem) => !isOut(it) && num(it.in_stock) <= (it.reorder_at ?? 25)

// `embedded` hides the mobile hero when this sits inside the Inventory tab shell.
export function InventoryView({ embedded = false, pool }: { embedded?: boolean; pool?: "own" | "consigned" }) {
  const tl = useLabelT()
 const [items, setItems] = useState<InventoryItem[] | null>(null)
 const [search, setSearch] = useState("")
  /** Restocking asks one question — what is short — so the Low and Out counts are a filter,
   * not a readout. Null is "everything", which is what you want when receiving. */
 const [view, setView] = useState<"all" | "low" | "out" | "unavailable">("all")
 const needs: null | "low" | "out" = view === "low" || view === "out" ? view : null
 const [queuing, setQueuing] = useState(false)
  /** What the last bulk action did. This view had no message channel of its own — the one
   *  `err` in this file belongs to another component — and an action that quietly moves rows
   * to a different screen has to say so. */
 const [notice, setNotice] = useState<string | null>(null)

 const [cat, setCat] = useState("")
 const [vis, setVis] = useState<"" | SkuVisibility>("")
  /** Show only the rows no supplier catalogue still lists — the ones to review and clear. */
 const onlyUnavailable = view === "unavailable"
  /** Supplier/variant resolved per sku — see the effect below. Declared here because
   * the filter reads it, and the filter is computed before that effect is defined. */
 const [meta, setMeta] = useState<Record<string, { supplier?: string | null; variant?: string | null; api?: string | null }>>({})
 const [saving, setSaving] = useState(false)
  // When the Inventory shell drives the pool (its single Our stock · Incoming stock · Scan
  // nav), follow it and hide the in-view toggle; standalone, keep our own.
 const [ownTab, setOwnTab] = useState<"own" | "consigned">("own")
 const tab = pool ?? ownTab
 const [saved, setSaved] = useState(false)
 const [addOpen, setAddOpen] = useState(false)
 const [printOpen, setPrintOpen] = useState(false)
  // WHOSE HISTORY — one variant from a row menu, or a whole product from its grid.
 const [hist, setHist] = useState<{ label: string; skus: string[] } | null>(null)
  // Label printing: pick the variants you actually need, and how many of each.
  // Printing the whole filtered list one-each wasted a roll every time.
 const [sel, setSel] = useState<Set<string>>(new Set())
 const [zoomSku, setZoomSku] = useState<string | null>(null)
 const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The catalogue, for the row photo and for "Add from catalogue". Read once; a product's
   * picture doesn't change while a stock count is being typed. */
 const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  /**
   * UNITS ON A PLACED PO, per sku.
   *
   * A row reading "0 · Out" while six are on a purchase order arriving Friday is the state
   * that gets them ordered twice — the Purchasing board knew and Inventory did not. Read
   * once, joined by sku; no new column, because the answer belongs beside the word that
   * would otherwise send somebody shopping.
   */
 const [onOrder, setOnOrder] = useState<Record<string, number>>({})
 const load = useCallback(() => {
 if (!getToken()) { setItems([]); return }
 getInventory().then((r) => setItems(r ?? [])).catch(() => setItems([]))
  }, [])
 useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])
 useEffect(() => {
 const id = setTimeout(() => {
 if (!getToken()) return
 getCatalogProducts().then((r) => setCatalog(r ?? [])).catch(() => {})
      // PLACED only. A draft has not been sent to anyone, so nothing is coming; received is
      // already counted in in_stock and would be promised twice.
 getPurchaseOrders().then((rows) => {
 const by: Record<string, number> = {}
 for (const po of rows ?? []) {
 if (String(po.status || "") !== "placed") continue
 for (const l of po.items ?? []) {
 const k = String(l.sku || "").trim().toUpperCase()
 if (k) by[k] = (by[k] ?? 0) + (Number(l.qty) || 0)
          }
        }
 setOnOrder(by)
      }).catch(() => {})
    }, 0)
 return () => clearTimeout(id)
  }, [])

  // Edits are optimistic locally, then flushed as PER-FIELD PATCHes (debounced).
  // Never save the whole array: that would re-send this page's snapshot of every
  // row and wipe out stock the warehouse scanned in while the page sat open.
 const pending = useRef<Map<string, Partial<InventoryItem>>>(new Map())
 const flush = useCallback(() => {
 const batch = Array.from(pending.current.entries())
 pending.current.clear()
 if (!batch.length) return
 setSaving(true)
    Promise.all(batch.map(([sku, fields]) => patchInventoryItem(sku, fields).catch(() => {})))
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500) })
      .finally(() => setSaving(false))
  }, [])

  /**
   * Park the selected variants in Purchasing's saved pool.
   *
   * Merged, never replaced — the pool is a shared factory list and another person's parked
   * lines are not this page's to discard. A sku already parked is left alone rather than
   * duplicated: two rows for one blank is how a PO ends up ordering it twice.
   */
 const queueForPurchase = async () => {
 const picked = (items ?? []).filter((it) => sel.has(it.sku))
 if (!picked.length) return
 setQueuing(true)
 try {
 const pool = (await getFactoryList<SavedPOLine[]>("po_saved").catch(() => null)) ?? []
 const have = new Set(pool.map((l) => String(l.sku).toUpperCase()))
 const add: SavedPOLine[] = picked
        .filter((it) => !have.has(String(it.sku).toUpperCase()))
        .map((it) => ({
 sku: it.sku, name: it.name ?? undefined, variant: it.variant ?? undefined,
          // One is a placeholder, not a guess at how many to buy — the quantity is decided
          // on the purchase order, where the supplier's price breaks are visible.
 qty: 1, supplier: meta[it.sku]?.supplier ?? null, savedAt: new Date().toISOString(),
        }))
 if (add.length) await saveFactoryList("po_saved", [...pool, ...add])
 setSel(new Set())
 setNotice(add.length
        ? `${add.length} added to Purchasing — parked, ready to put on an order.`
 : "Those are already parked in Purchasing.")
    } catch {
 setNotice("Couldn't add those to Purchasing.")
    } finally { setQueuing(false) }
  }

 const edit = (sku: string, field: "in_stock" | "reserved" | "reorder_at", value: number) => {
 setItems((prev) => (prev ?? []).map((it) => (it.sku === sku ? { ...it, [field]: value } : it)))
 pending.current.set(sku, { ...(pending.current.get(sku) ?? {}), [field]: value })
 if (saveTimer.current) clearTimeout(saveTimer.current)
 saveTimer.current = setTimeout(flush, 600)
  }
  // Sent immediately rather than through the 600ms debounce the number cells use: this is
  // a deliberate choice about who can see stock, not a value being typed, and a dropped
  // debounce on THIS field is the one that publishes something by accident.
 const setVisibility = (sku: string, next: SkuVisibility) => {
 const before = (items ?? []).find((i) => i.sku === sku)
 setItems((prev) => (prev ?? []).map((it) => (it.sku === sku ? { ...it, visibility: next } : it)))
 patchInventoryItem(sku, { visibility: next }).catch(() => {
      // Put the row back rather than leaving the table claiming a change that never
      // landed — a visibility that only looks applied is worse than one that failed.
 setItems((prev) => (prev ?? []).map((it) => (it.sku === sku ? { ...it, visibility: before?.visibility } : it)))
    })
  }
 const remove = (sku: string) => {
 setItems((prev) => (prev ?? []).filter((it) => it.sku !== sku))
 pending.current.delete(sku)
 deleteInventoryItem(sku).catch(() => load())
  }
  /** One row or a product's whole size run — the catalogue path adds several at once, and
   * they go in as individual POSTs so a failure loses one row rather than the batch. */
 const add = (batch: InventoryItem[]) => {
 const skus = new Set(batch.map((b) => b.sku))
 setItems((prev) => [...batch, ...(prev ?? []).filter((x) => !skus.has(x.sku))])
 setAddOpen(false)
    Promise.all(batch.map((it) => addInventoryItem(it).catch(() => null))).then((r) => {
      // Re-read if any POST failed, rather than leaving the table showing a row the
      // server never took.
 if (r.some((x) => x === null)) load()
    })
  }

 const cats = useMemo(() => Array.from(new Set((items ?? []).map((i) => i.category).filter(Boolean))).sort() as string[], [items])
 const filtered = useMemo(() => (items ?? []).filter((it) => {
 if (needs === "low" && !isLow(it)) return false
 if (needs === "out" && !isOut(it)) return false
 if (cat && it.category !== cat) return false
 if (vis && visOf(it) !== vis) return false
    // Only rows we have ASKED about and been told nothing for. A row still resolving is
    // unknown, not unavailable, and must not be swept into a list headed "remove these".
 if (onlyUnavailable && !(meta[it.sku] !== undefined && !meta[it.sku]?.supplier && !it.supplier)) return false
 if (!search) return true
 return `${it.sku} ${it.name ?? ""} ${it.variant ?? ""}`.toLowerCase().includes(search.toLowerCase())
  }), [items, cat, vis, search, onlyUnavailable, meta, needs])

 const stats = useMemo(() => {
 const list = items ?? []
 return { total: list.length, low: list.filter(isLow).length, out: list.filter(isOut).length, reserved: list.reduce((s, i) => s + num(i.reserved), 0) }
  }, [items])

  /**
   * ONE ROW PER PRODUCT, variants underneath it.
   *
   * Stock is held per variant, so the table was one row per sku — 8 sizes of one tee read
   * as 8 unrelated products, and "do we have this polo?" meant reading eight rows and adding
   * them up. Grouped, the answer is the row: the total is the product's, and the caret opens
   * the sizes when the question is which one.
   *
   * Grouped by the CATALOGUE PRODUCT the sku resolves to, not by a prefix of the string —
   * `resolveProduct` is the same matcher an order line uses, so a row groups with the
   * product it will actually be picked for. Unresolved rows fall back to their name, and
   * anything left is its own group of one, which renders exactly as it always did.
   */
 const groups = useMemo(() => {
 const out: { key: string; name: string; product: CatalogProduct | null; image: string; rows: InventoryItem[] }[] = []
 const by = new Map<string, number>()
 for (const it of filtered) {
 const p = catalog.length ? resolveProduct({ sku: it.sku } as OrderItem, catalog) : null
 const key = p ? "p:" + String(p.id ?? p.sku ?? p.name) : it.name?.trim() ? "n:" + it.name.trim().toLowerCase() : "s:" + it.sku
 const at = by.get(key)
 if (at === undefined) {
 by.set(key, out.length)
 out.push({ key, name: p?.name || it.name || it.sku, product: p, image: imageFor(p, it.variant), rows: [it] })
      } else {
 out[at].rows.push(it)
      }
    }
 return out
  }, [filtered, catalog])

 const paged = usePaged(groups, 25)
  /** Every sku on the page, open or not — what "select all" and the supplier resolver mean
   * by "this page". A collapsed group still selects its variants: the checkbox is on the
   * product, and the labels are printed per variant. */
 const pageSkus = useMemo(() => paged.pageItems.flatMap((g) => g.rows.map((r) => r.sku)), [paged.pageItems])

  /**
   * WHO SELLS THIS, AND CAN WE STILL GET IT.
   *
   * An inventory row records what we hold, not where it came from — `supplier` is free text
   * someone may or may not have typed. So restocking meant looking the blank up again in a
   * supplier catalogue, every time, which is the search this table should be ending.
   *
   * resolve-suppliers answers it from the sku (the same call that prices a PO line), and the
   * answer doubles as an availability check: a sku that resolves to NOTHING is no longer in
   * any catalogue we can buy from — discontinued, renamed, or from a supplier we dropped.
   *
   * NOT auto-deleted. A resolver that is briefly down would otherwise wipe the shelf, and
   * stock we physically hold is real whether or not the supplier still lists it. It is
   * flagged, and removing it stays a decision someone makes per row.
   */
 useEffect(() => {
 const missing = pageSkus.filter(Boolean).filter((k) => meta[k] === undefined)
 if (!missing.length) return
 let alive = true
 const t = setTimeout(() => {
 resolveSuppliers(missing)
        .then((r) => {
 if (!alive) return
          // Cache a key for every sku ASKED, including the ones with no answer — otherwise
          // the effect re-fires forever on exactly the rows we most want to flag.
 const add: Record<string, { supplier?: string | null; variant?: string | null; api?: string | null }> = {}
 for (const k of missing) add[k] = (r?.bySku ?? {})[k] ?? {}
 setMeta((m) => ({ ...m, ...add }))
        })
        .catch(() => { /* leave them unknown — unknown is not the same as unavailable */ })
    }, 0)
 return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSkus])

 return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* Icon+title hidden on desktop (the top bar names the page); the Saving
 indicator on the right stays. On mobile the hero is the title. */}
        {!embedded && (<>
          <Package size={18} weight="regular" className="shrink-0 text-primary md:hidden" />
          <div className="min-w-0 md:hidden">
            <PageTitle>{tl("inventory", "Inventory")}</PageTitle>
            <p className="truncate text-sm text-muted-foreground">{tl("inventory", "Track stock per variant, flag low/out, and print SKU barcodes.")}</p>
          </div>
        </>)}
        <div className="ml-auto flex items-center gap-2">
          {saving ? <span className="text-xs text-muted-foreground"><CircleNotch size={13} className="inline animate-spin" /> {tl("inventory", "Saving…")}</span> : saved ? <span className="inline-flex items-center gap-1 text-xs text-success"><Check size={13} weight="bold" /> {tl("inventory", "Saved")}</span> : null}
        </div>
      </div>

      {/* Standalone only: the two pools (stock WE own vs stock sellers consigned to us).
          When embedded in the Inventory shell, these are two of its top tabs instead — no
 second stacked pill row. */}
      {!pool && (
        <TabBar
          ariaLabel="Stock pools"
          items={[{ id: "own", label: tl("inventory", "Our stock") }, { id: "consigned", label: tl("inventory", "Incoming stock") }]}
          value={tab}
          onChange={setOwnTab}
        />
      )}

      {tab === "consigned" ? (
        /* Two things are inbound and neither was visible from this screen: stock we BOUGHT
 and have not received (placed POs, Alibaba included), and stock a SELLER sent us
 to hold. Both end with someone opening a carton at this desk. */
        <div className="space-y-4">
          <InboundPanel />
          <ConsignmentPanel />
        </div>
      ) : (
      <>
      {/**
        * THE COUNTS ARE THE FILTER — and now they are the only thing they were ever read as.
        *
        * Four stat tiles ran across the top: SKUs, Low stock, Out of stock, Reserved. Two of
        * them were secretly buttons, one was a total nobody acts on, and "No longer stocked"
        * — the fourth way of narrowing this list — was a checkbox further down in the toolbar.
        * So the page had four ways to filter itself wearing three different kinds of control,
        * none of which looked like a filter.
        *
        * They are one row of tabs, which is what they always were: a set of mutually exclusive
        * views of one list, with the count of each on it. RESERVED is not among them because
        * it is not a view — it is a fact about the stock you are already looking at, and it
        * lives in each row's title where it can be read against that row's own number.
        */}
      {/**
        * THE TWO FIGURES THE TAB ROW TOOK WITH IT.
        *
        * Four stat tiles became four tabs, and two numbers did not survive the move: the SKU
        * total, which had been the badge on "All", and Reserved, which I put in a row's
        * tooltip and called relocation. A figure that is on the page in the morning and in a
        * hover by the afternoon has been deleted, whatever the commit said.
        *
        * They are a count line on the card head, which is where the drawing had them —
        * "38 styles · 412 SKUs". Not a subtitle: no sentence, no explanation of a control,
        * just the two totals this table is a view of. Reserved is here rather than in the
        * tab row because it is not a VIEW — there is no list of reserved stock to switch to;
        * it is a fact about everything below.
        */}
      <SectionCard
 title={tl("inventory", "Stock")}
 actions={
          <div className="text-xs tabular-nums text-muted-foreground">
            {stats.total} {tl("inventory", "SKUs")}
            {stats.reserved > 0 && <> · {stats.reserved} {tl("inventory", "reserved")}</>}
          </div>
        }
      >
        {/* The row sits INSIDE the card, above the controls that narrow it — a view is chosen
            first and then filtered, and the order on screen says so. */}
        <div className="px-4 pt-3">
          <TabBar
 size="sm"
 spacing="none"
 ariaLabel={tl("inventory", "Filter stock")}
 value={view}
 onChange={setView}
 items={[
              { id: "all" as const, label: tl("inventory", "All") },
              { id: "low" as const, label: tl("inventory", "Low stock"), count: stats.low },
              { id: "out" as const, label: tl("inventory", "Out"), count: stats.out },
              { id: "unavailable" as const, label: tl("inventory", "No longer stocked") },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <SearchField
            value={search}
            onChange={setSearch}
            onClear={() => setSearch("")}
            width="md"
            placeholder={tl("inventory", "Search SKU, name, variant…")}
          />
          {cats.length > 0 && (
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="eg-select eg-control pr-8">
              <option value="">{tl("inventory", "All categories")}</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          <select
 value={vis}
 onChange={(e) => setVis(e.target.value as "" | SkuVisibility)}
 aria-label={tl("inventory", "Filter by visibility")}
 className="eg-select eg-control pr-8"
          >
            <option value="">{tl("inventory", "All visibility")}</option>
            {VIS.map((v) => <option key={v.id} value={v.id}>{tl("inventory", v.label)}</option>)}
          </select>
          {/* FILTERS LEFT, ACTIONS RIGHT. They were one undifferentiated run, so "Add item"
 sat in the middle of the things that narrow the list — and the eye has no way
 to know which half of a row it is in. ml-auto is the whole separation: a gap
 says "these do something to the list, those do something to the world". */}
          {notice && (
            <span className="text-xs text-muted-foreground">
              {notice}{" "}
              <button type="button" onClick={() => setNotice(null)} className="underline underline-offset-2">dismiss</button>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* SELECT-ALL CAME OFF THE TABLE HEAD WITH THE TABLE HEAD. It lived in a column
 header; there are no column headers spanning the page any more, so it lives
 with the actions it feeds. Still this PAGE only — ticking a box must never
 quietly select hundreds of rows nobody can see. */}
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap px-1 text-sm">
              <input
 type="checkbox"
 aria-label={tl("inventory", "Select every variant on this page")}
 checked={pageSkus.length > 0 && pageSkus.every((k) => sel.has(k))}
 onChange={(e) => {
 const next = new Set(sel)
 pageSkus.forEach((k) => (e.target.checked ? next.add(k) : next.delete(k)))
 setSel(next)
                }}
 className="size-3.5 accent-[var(--primary)]"
              />
              <span className={sel.size > 0 ? "text-foreground" : "text-muted-foreground"}>{tl("inventory", "Select page")}</span>
            </label>
            {sel.size > 0 && (
              <Button variant="ghost" onClick={() => setSel(new Set())}>Clear ({sel.size})</Button>
            )}
            {/**
              * RESTOCKING ENDS SOMEWHERE. This page names what is short and, until now,
              * offered no way to act on it — you read the shortage here and then found the
              * same skus again in Purchasing, by hand, from memory. The two halves of one
              * job were two screens with nothing between them.
              *
              * They go to the SAVED pool rather than straight onto a draft PO, because the
              * supplier is a decision and this page does not know it. Purchasing picks them
              * up parked and ready, which is where that choice belongs.
              */}
            {sel.size > 0 && (
              <Button variant="outline" disabled={queuing} onClick={() => void queueForPurchase()}>
                {queuing ? tl("inventory", "Adding…") : `Add ${sel.size} to purchase`}
              </Button>
            )}
            <Button variant="outline" onClick={() => setPrintOpen(true)} disabled={filtered.length === 0}>
              {sel.size ? `Print ${sel.size} selected` : tl("inventory", "Print labels")}
            </Button>
            <Button onClick={() => setAddOpen(true)}>{tl("inventory", "Add item")}</Button>
          </div>
        </div>

        {/* THE PARAGRAPH IS GONE. Four sentences with three words bolded inside them, above
 a table — five type weights in a strip whose job was to define a dropdown that
 has three options in it. The definitions live on the control: each option's
 meaning is one line under the select in the Add-item dialog, which is where
 somebody is actually choosing. */}

        {items === null ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Package}
            title={(items.length ?? 0) === 0 ? tl("inventory", "No inventory yet") : tl("inventory", "No items match")}
            note={(items.length ?? 0) === 0 ? tl("inventory", "Add an item to start tracking stock.") : tl("inventory", "Nothing matches that search or filter.")}
          />
        ) : (
          <>
            {/* NO TABLE HEAD, because there is no longer one table. Each product carries
 its own column headings over its own numbers, which is the only place they
 mean anything: "S, M, L, XL" belongs to a tee and "One size" to a cap, and a
 single header row above both could only ever be right for one of them. */}
            <div className="divide-y divide-border">
              {paged.pageItems.map((g) => {
 const allSel = g.rows.every((r) => sel.has(r.sku))
 return (
                  <ProductSheet
 key={g.key}
 group={g}
 selected={allSel}
 onSelect={(on: boolean) => {
 const next = new Set(sel)
 for (const r of g.rows) { if (on) next.add(r.sku); else next.delete(r.sku) }
 setSel(next)
                    }}
 meta={meta}
 sel={sel} setSel={setSel}
 edit={edit} setVisibility={setVisibility} remove={remove}
 onProductHistory={(name: string, skus: string[]) => setHist({ label: name, skus })}
 onZoom={setZoomSku}
 onOrder={onOrder}
                  />
                )
              })}
            </div>
            <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage} total={paged.total} start={paged.start} onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[25, 50, 100]} noun="products" />
          </>
        )}
      </SectionCard>

      </>
      )}

      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} onAdd={add} existing={(items ?? []).map((i) => i.sku)} catalog={catalog} />
      <ScanHistoryDialog target={hist} onClose={() => setHist(null)} />

      {/* Selected variants only — or the whole filtered list if nothing is ticked,
 which keeps the old one-click behaviour for "print everything". */}
      <LabelSheet
 key={printOpen ? "print-open" : "print-closed"}
 open={printOpen}
 onClose={() => setPrintOpen(false)}
 labels={(sel.size ? filtered.filter((i) => sel.has(i.sku)) : filtered).map((i) => ({
 sku: i.sku, name: i.name, variant: i.variant,
        }))}
      />
      <BarcodeZoom sku={zoomSku} onClose={() => setZoomSku(null)} />
    </div>
  )
}

type Group = { key: string; name: string; product: CatalogProduct | null; image: string; rows: InventoryItem[] }

/** The photo, or the letter — never an empty tile, and never a stock photo of something
 * else. A blank square with an initial says "no picture"; a placeholder garment would say
 *  "this is the garment", which is a lie the picker acts on. */
function Thumb({ src, name, size = 60 }: { src: string; name: string; size?: number }) {
  const tl = useLabelT()
 return src ? (
    <span className="block shrink-0 overflow-hidden rounded-md border border-border bg-muted/40" style={{ width: size, height: size }}>
      <Image src={src} alt="" width={size * 2} height={size * 2} unoptimized className="size-full object-cover" />
    </span>
  ) : (
    /* NOT THE FIRST LETTER. Half these names begin with a digit — "47 Brand Trawler Cap"
 drew a big "4" in the picture column, which reads as a COUNT sitting where a photo
 should be, and looks like a sync that went wrong rather than a product with no image.
       A glyph can only mean "no picture". */
    <span
 className="grid shrink-0 place-items-center rounded-md border border-border bg-muted/40 text-muted-foreground/50"
 style={{ width: size, height: size }}
 title={name ? `No picture for ${name}` : tl("inventory", "No picture")}
 aria-hidden
    >
      <Package size={Math.round(size / 2.6)} weight="light" />
    </span>
  )
}

/**
 * ONE PRODUCT, AS A SHEET — heading, then its numbers. No caret, no summary row.
 *
 * This was a table row per product with the grid folded behind a disclosure, and the table
 * was pretending to be two things at once: a row could be a PRODUCT or a VARIANT, so SKU,
 * Stock and Status meant something different depending which kind you were looking at.
 * "17 SKUs" sat under a column headed SKU; a summed count sat under a column you could not
 * type in. Half the table was a header for the other half, and the only editable thing on
 * the page — the counts — was one click away on every product.
 *
 * So the product row stops being a row. It is a heading over its own grid, always open, and
 * the page becomes one continuous sheet you scroll and type into. Status is gone: it said
 * "Out / Low / In stock" about numbers that are on screen saying it themselves, in a column
 * that cost width all day.
 */
/**
 * THE SIZE OF A ROW, WITHOUT A CATALOGUE ENTRY.
 *
 * StockMatrix decomposes a sku against its catalog product — precise, and unavailable for
 * everything imported straight from a supplier, which is most of this table. The ladder has
 * to work on those too, so it reads the variant string the row already carries and takes the
 * first segment that IS a size. "Adjustable · Black" -> Adjustable; "Black · L" -> L,
 * whichever order the feed happened to write them in.
 *
 * The sku is the fallback because a variant is optional and a sku never is.
 */
function sizeOfRow(it: InventoryItem): string {
  for (const seg of String(it.variant || "").split(/[·,/|]|\s+-\s+/)) {
    const t = seg.trim()
    if (t && isSize(t)) return t
  }
  for (const seg of String(it.sku || "").split("-")) {
    // Purely numeric segments are excluded HERE and not in isSize, because the ladder is the
    // only caller that reads raw sku fragments. "3230" really is a waist-and-inseam size when
    // a variant declares it — but in a sku it is overwhelmingly the style number, and
    // EG-22-ADJUSTABLE-BLACK was drawing a size band labelled "22".
    if (seg && !/^\d+$/.test(seg) && isSize(seg)) return seg
  }
  return ""
}

/**
 * STOCK ACROSS SIZES, ON THE COLLAPSED ROW.
 *
 * The table opened every product at once: 38 styles times every variant, so a cap with 17
 * colours pushed the next style off the screen — and the question this page is opened with,
 * what is short, could only be answered by scrolling through everything that is not.
 *
 * The ladder answers it without opening anything. It is the SIZE axis and not the colour one
 * because a size runs out on its own: 2XL going while every other size is deep is the normal
 * shape of a shortage, and it is invisible inside a single total.
 *
 * Amber and red are the reserved status colours doing their reserved job — at or below the
 * reorder point, and nothing on the shelf. No other hue appears here.
 */
function SizeLadder({ rows, lowAt }: { rows: InventoryItem[]; lowAt: (it: InventoryItem) => number }) {
  const bands = useMemo(() => {
    const acc = new Map<string, { n: number; low: boolean; out: boolean }>()
    for (const r of rows) {
      const z = sizeOfRow(r) || "—"
      const cur = acc.get(z) ?? { n: 0, low: false, out: false }
      cur.n += num(r.in_stock)
      acc.set(z, cur)
    }
    // A band is short when its TOTAL is at or below the reorder point, not when one colour
    // inside it is — the ladder prints a per-size figure, so its colour has to mean the same
    // thing that figure does.
    for (const [z, v] of acc) {
      const forSize = rows.filter((r) => (sizeOfRow(r) || "—") === z)
      const point = Math.max(0, ...forSize.map(lowAt))
      v.out = v.n <= 0
      v.low = !v.out && v.n <= point
      acc.set(z, v)
    }
    return [...acc.entries()].sort((a, b) => bySize(a[0], b[0]))
  }, [rows, lowAt])

  if (bands.length === 0) return null
  if (bands.length === 1 && bands[0][0] === "—") return null
  return (
    <div className="hidden shrink-0 items-end gap-1 lg:flex">
      {bands.map(([z, v]) => (
        <div
          key={z}
          title={(isOneSize(z) ? "One size" : z) + " — " + v.n + " on the shelf"}
          className={"w-11 rounded-md px-1 py-1 text-center leading-none "
            + (v.out ? "bg-alert/10 text-alert"
              : v.low ? "bg-hold/10 text-hold"
              : "bg-muted/50 text-foreground")}
        >
          <div className="truncate text-[9px] uppercase tracking-wide opacity-70">{isOneSize(z) ? "OS" : z}</div>
          <div className="mt-0.5 text-xs font-semibold tabular-nums">{v.n}</div>
        </div>
      ))}
    </div>
  )
}

function ProductSheet({
 group, selected, onSelect, meta, sel, setSel, edit, setVisibility, remove,
 onProductHistory, onZoom, onOrder,
}: {
 group: Group
 selected: boolean
 onSelect: (on: boolean) => void
 meta: Record<string, { supplier?: string | null; variant?: string | null; api?: string | null }>
 sel: Set<string>
 setSel: (s: Set<string>) => void
 edit: (sku: string, field: "in_stock" | "reserved" | "reorder_at", value: number) => void
 setVisibility: (sku: string, v: SkuVisibility) => void
 remove: (sku: string) => void
 onProductHistory: (name: string, skus: string[]) => void
 onZoom: (sku: string) => void
 onOrder: Record<string, number>
}) {
  const tl = useLabelT()
  // Second press arms the removal — the count is the warning, so it is in the label.
 const [killing, setKilling] = useState(false)
  /**
   * SHUT UNTIL ASKED. Every product rendered its full grid, so the page was as long as the
   * catalogue and the styles below the fold were unreachable without scrolling past every
   * variant of the ones above. The ladder carries what the grid was being opened FOR, so
   * opening it becomes a choice rather than the only way to see anything.
   */
 const [open, setOpen] = useState(false)
 const stock = group.rows.reduce((n, r) => n + num(r.in_stock), 0)
 const reserved = group.rows.reduce((n, r) => n + num(r.reserved), 0)
 const out = group.rows.filter(isOut).length
 const one = group.rows.length === 1
 const sku = group.product?.sku || (one ? group.rows[0].sku : null)
 const supplier = group.rows.map((r) => r.supplier || meta[r.sku]?.supplier).find(Boolean)
  // Reorder point and visibility are stored per sku and are, in practice, a decision about
  // the PRODUCT — nobody stocks Navy to 25 and Black to 40. They were on each variant row's
  // menu; there are no variant rows now, so they act on every variant at once and say so.
 const reorderAt = group.rows[0]?.reorder_at ?? 25
 const visSame = group.rows.every((r) => visOf(r) === visOf(group.rows[0]))

 return (
    <section className="border-b border-border last:border-b-0">
      <header className="flex items-center gap-3 px-4 py-2.5">
        <input
 type="checkbox"
 aria-label={`Select ${group.name}`}
 checked={selected}
 onChange={(e) => onSelect(e.target.checked)}
 className="size-3.5 shrink-0"
        />
        <Thumb src={group.image} name={group.name} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight" title={group.name}>{group.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {one ? <span className="tabular-nums">{group.rows[0].sku}</span> : `${group.rows.length} variants`}
            {sku && !one && <span className="tabular-nums"> · {sku}</span>}
            {supplier && <span> · {supplier}</span>}
          </div>
        </div>
        <SizeLadder rows={group.rows} lowAt={(it) => Number(it.reorder_at ?? 25)} />
        {/* THE TOTAL IS A CAPTION, NOT A COLUMN. It used to sit in the Stock column beside
 editable variant counts, which made a figure nobody can type into look like one
 they should. Held is in the title, where it was already. */}
        <div
 className="shrink-0 text-right"
 title={reserved > 0 ? `${stock} on the shelf · ${reserved} held for orders · ${stock - reserved} free` : `${stock} on the shelf`}
        >
          <div className="text-sm font-semibold tabular-nums leading-none">{stock}</div>
          <div className="mt-0.5 text-2xs text-muted-foreground">
            {out === group.rows.length ? tl("inventory", "none on the shelf") : out ? `${out} out` : tl("inventory", "on the shelf")}
          </div>
        </div>
        <button
 type="button"
 onClick={() => setOpen((v) => !v)}
 aria-expanded={open}
 aria-label={(open ? "Collapse " : "Expand ") + group.name}
 title={open ? "Hide the size and colour grid" : "Show the size and colour grid"}
 className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <CaretDown size={14} weight="bold" className={"transition-transform " + (open ? "rotate-180" : "")} />
        </button>
        <Popover>
          <PopoverTrigger
 aria-label={`Actions for ${group.name}`}
 title={tl("inventory", "Reorder point, visibility, history, remove")}
 className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <DotsThree size={18} weight="bold" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3 p-3">
            <div className="truncate text-2xs text-muted-foreground">
              {one ? group.rows[0].sku : `${group.rows.length} variants · applies to all`}
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium">{tl("inventory", "Reorder at")}</span>
              <Input
 value={String(reorderAt)}
 onChange={(e) => {
 const v = Number(e.target.value.replace(/[^0-9]/g, "")) || 0
 group.rows.forEach((r) => edit(r.sku, "reorder_at", v))
                }}
 inputMode="numeric"
 aria-label={`Reorder point for ${group.name}`}
 className="h-8 w-16 text-center"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">{tl("inventory", "Visibility")}</span>
              <select
 value={visSame ? visOf(group.rows[0]) : ""}
 onChange={(e) => { const v = e.target.value as SkuVisibility; group.rows.forEach((r) => setVisibility(r.sku, v)) }}
 aria-label={`Visibility for ${group.name}`}
 className="eg-select h-8 w-full rounded-md border border-border bg-transparent py-0 pl-2 pr-6 text-xs font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {/* A product whose variants disagree shows that rather than the first one's
 setting — picking any option then makes them agree, which is the fix. */}
                {!visSame && <option value="">{tl("inventory", "Mixed — pick one to settle it")}</option>}
                {VIS.map((v) => <option key={v.id} value={v.id}>{tl("inventory", v.label)}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-2">
              <button
 type="button"
 onClick={() => onProductHistory(group.name, group.rows.map((r) => r.sku))}
 className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ClockCounterClockwise size={14} /> {tl("inventory", "Stock history")}
              </button>
              {/* Barcode is a fact about ONE sku — you hold a gun to the screen and scan it.
                  Offered only when the product IS one sku; otherwise the label printer is
 the right door, and it takes the whole selection. */}
              {one && (
                <button
 type="button"
 onClick={() => onZoom(group.rows[0].sku)}
 className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <QrCodeIcon size={14} /> {tl("inventory", "Barcode")}
                </button>
              )}
              <button
 type="button"
 onClick={() => { if (!killing) { setKilling(true); return } group.rows.forEach((r) => remove(r.sku)); setKilling(false) }}
 className={"inline-flex items-center gap-1.5 text-xs transition-colors hover:text-alert "
                  + (killing ? "font-medium text-alert" : "text-muted-foreground")}
              >
                <Trash size={14} /> {killing ? (one ? tl("inventory", "Remove?") : `Remove all ${group.rows.length}?`) : tl("inventory", "Remove")}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </header>
      {open && (
        <StockMatrix
 group={group}
 sel={sel}
 setSel={setSel}
 onOrder={onOrder}
 edit={(s, _f, v) => edit(s, "in_stock", v)}
 lowAt={(it) => Number(it.reorder_at ?? 25)}
        />
      )}
    </section>
  )
}


/**
 * A PRODUCT'S STOCK AS A GRID — colours down, sizes across.
 *
 * Stock is held per variant, and a variant has TWO axes. A list flattens them into one, so
 * a tee in five colours and eight sizes became forty rows that you had to read and add up
 * to answer either question anyone actually asks: "do we stock this" (the whole grid) and
 * "can I make Navy in L" (one cell). Grouping helped the first and left the second buried
 * under a caret.
 *
 * Every apparel system settles here for the same reason. Forty numbers in a 5×8 grid are
 * read at a glance, and a hole in the shelf is a coloured cell rather than a row you have
 * to find.
 *
 * IT STAYS EDITABLE. Losing inline editing was the real cost of a grid and there is no need
 * to pay it — a cell is an input, exactly as the list's count was.
 *
 * Degenerates on purpose: a cap has one size, so it is a column of colours; a product with
 * neither is one cell. Anything whose sku doesn't land in the grid is listed underneath as
 * a plain row, because a variant this cannot place must not vanish.
 */
/**
 * A ZERO IS A FACT, NOT AN ALARM. Every cell filled red turned a product we simply don't
 * stock into a page of warnings — seventeen filled pills reading as seventeen problems.
 * The number carries the colour and the border marks it; the fill is gone.
 */
function cellTone(it: InventoryItem, lowAt: (x: InventoryItem) => number) {
 const stock = Number(it.in_stock) || 0
 if (stock <= 0) return "border-alert/30 text-alert"
 if (stock <= lowAt(it)) return "border-hold/20 text-hold"
 return "border-border"
}

/** The variants a grid could not place — named, never dropped. */
function LeftoverNote({ rows }: { rows: InventoryItem[] }) {
  const tl = useLabelT()
 return (
    <p className="text-2xs text-muted-foreground">
      {rows.length} variant{rows.length === 1 ? "" : "s"}{" "}not on this grid — the sku doesn&apos;t match the
 product&apos;s sizes and colours: <span className="tabular-nums">{rows.map((r) => r.sku).join(", ")}</span>
    </p>
  )
}

/**
 * THE SAME PANEL WHEN THERE ARE NO AXES TO BUILD — a product with no catalogue entry, or
 * one whose skus don't decompose into a size and a colour.
 *
 * These used to fall back to the table's own variant ROWS, which meant a product opened
 * into one of two completely different things depending on whether its skus happened to
 * parse. One column instead of six is a smaller table; it is still a table, under the same
 * header, with its numbers at the same x as every other product's.
 */
function PlainStock({ rows, edit, lowAt, sel, setSel, onOrder }: {
 rows: InventoryItem[]
 edit: (sku: string, field: "in_stock", value: number) => void
 lowAt: (it: InventoryItem) => number
 sel: Set<string>
 setSel: (s: Set<string>) => void
 onOrder: Record<string, number>
}) {
  const tl = useLabelT()
 return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className={`${LABEL_W} ${GUTTER} whitespace-nowrap py-1 pe-2 text-left font-medium`}>{tl("inventory", "Variant")}</th>
            <th className={`${SIZE_W} px-1 py-1 text-center font-medium`}>{tl("inventory", "Stock")}</th>
            <th className="w-auto pe-4" />
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => (
            <tr key={it.sku} className="border-t border-border">
              <td className={`${LABEL_W} ${GUTTER} relative truncate whitespace-nowrap py-1 pe-2 font-medium`}>
                <input
 type="checkbox"
 aria-label={`Select ${it.sku}`}
 checked={sel.has(it.sku)}
 onChange={(e) => {
 const next = new Set(sel)
 if (e.target.checked) next.add(it.sku); else next.delete(it.sku)
 setSel(next)
                  }}
 className="absolute left-4 top-1/2 size-3.5 -translate-y-1/2"
                />
                <span className="tabular-nums">{it.sku}</span>
                {it.variant && <span className="ms-2 font-normal text-muted-foreground">{it.variant}</span>}
              </td>
              <td className={`${SIZE_W} px-1 py-1 text-center`}>
                <Input
 value={String(Number(it.in_stock) || 0)}
 onChange={(e) => edit(it.sku, "in_stock", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
 inputMode="numeric"
 aria-label={`In stock for ${it.sku}`}
 title={[`${it.sku} · ${Number(it.in_stock) || 0} on the shelf`,
                          (onOrder[String(it.sku).toUpperCase()] ?? 0) > 0
                            ? `${onOrder[String(it.sku).toUpperCase()]} on order` : null].filter(Boolean).join(" · ")}
 className={"h-7 w-12 text-center tabular-nums " + cellTone(it, lowAt)}
                />
              </td>
              <td className="w-auto pe-4" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * WHERE A COLOUR NAME STARTS — directly under the PRODUCT name above it.
 *
 * 5.5rem is the sheet heading's own run-up, added once: px-4 (1) + the checkbox (0.875) +
 * gap-3 (0.75) + the thumbnail (2.125) + gap-3 (0.75). The row's own checkbox is then
 * absolutely placed at left-4, under the product's. Two things line up down the left edge
 * of the whole page instead of each product inventing its own margin — which is what
 * "nothing lines up" always turns out to be. Change the heading, change this.
 */
const GUTTER = "ps-[5.5rem]"
/**
 * EVERY SIZE COLUMN IS THE SAME WIDTH, on every product.
 *
 * The columns used to divide whatever space was left, so a product with one size put its
 * only box in the middle of the row while the product under it put S at a quarter of the
 * way across — the same reading, at two different x. And because the colour column shrank
 * to its longest name, "Dark Grey Heather" pushed S further right than "Black" did on the
 * next product down.
 *
 * Fixed widths for both, and a trailing spacer to absorb the rest: One size now lands
 * exactly where S lands, and S lands in the same place on every product on the page.
 */
const LABEL_W = "w-[13rem]"
const SIZE_W = "w-[4.5rem]"

function StockMatrix({ group, edit, lowAt, sel, setSel, onOrder }: {
 group: { product: CatalogProduct | null; rows: InventoryItem[] }
 edit: (sku: string, field: "in_stock", value: number) => void
 lowAt: (it: InventoryItem) => number
 sel: Set<string>
 setSel: (s: Set<string>) => void
  /** How many of each sku a purchase order already covers — see the cell's title. */
 onOrder: Record<string, number>
}) {
  const tl = useLabelT()
 const p = group.product
  // No catalogue product = no declared sizes or colours to build axes from. Same panel,
  // one column. See PlainStock.
 if (!p) return <PlainStock rows={group.rows} edit={edit} lowAt={lowAt} sel={sel} setSel={setSel} onOrder={onOrder} />

  /**
   * THE AXES COME FROM THE SHELF, NOT THE CATALOGUE.
   *
   * Built the other way round first, and both failure modes showed up on real data at once.
   * A product declaring 40 colours and 9 sizes produced 360 input boxes for a shelf holding
   * a handful of skus; and most inventory skus here are SIZE ONLY — `EG-1006-L`, no colour
   * — so a colour axis matched nothing and every cell rendered as an empty dot beneath a
   * product that plainly had stock.
   *
   * So each row is asked what it IS: try the sku against size+colour, then size alone, then
   * colour alone. Only the sizes and colours that actually appear become axes, which makes
   * the grid exactly as big as the shelf and never bigger.
   */
 const declaredSizes = productSizes(p)
 const declaredColors = productColors(p)
 const norm = (v: string) => String(v || "").trim().toUpperCase()

 const placed = new Map<string, { size: string; color: string; it: InventoryItem }>()
 for (const it of group.rows) {
 const sku = norm(it.sku)
 let hit: { size: string; color: string } | null = null
 for (const z of declaredSizes) {
 for (const c of declaredColors) {
 if (norm(variantSku(p.sku, z, c) || "") === sku) { hit = { size: z, color: c }; break }
      }
 if (hit) break
 if (norm(variantSku(p.sku, z, null) || "") === sku) { hit = { size: z, color: "" }; break }
    }
 if (!hit) {
 for (const c of declaredColors) {
 if (norm(variantSku(p.sku, null, c) || "") === sku) { hit = { size: "", color: c }; break }
      }
    }
 if (hit) placed.set(sku, { ...hit, it })
  }
  // Nothing resolves — the skus don't decompose against this product's sizes and colours.
  // Still a table, still under a header; the list stays honest by naming each sku.
 if (!placed.size) return <PlainStock rows={group.rows} edit={edit} lowAt={lowAt} sel={sel} setSel={setSel} onOrder={onOrder} />

  /**
   * WHAT IS ON THE SHELF, NOT WHAT THE CATALOGUE COULD HOLD.
   *
   * EVERY VARIANT, ALWAYS. The empties used to be folded behind a "Show 15 more with
   * nothing on the shelf" toggle, on the reasoning that a zero is the answer to a question
   * nobody asked. On this page it is the opposite: the grid IS the shelf, and a variant
   * missing from it cannot be told apart from a variant we do not carry — while setting a
   * count on a line that has never had one is exactly the job people open this to do.
   * Hiding it put an extra click in front of the only edit that matters.
   */
 const shown = [...placed.values()]

 const sizes = [...new Set(shown.map((x) => x.size).filter(Boolean))].sort(bySize)
 const colors = [...new Set(shown.map((x) => x.color).filter(Boolean))]
 const leftover = group.rows.filter((r) => !placed.has(norm(r.sku)))
 const at = (size: string, color: string) =>
 shown.find((x) => x.size === size && x.color === color)?.it ?? null

 const cell = (it: InventoryItem | null, key: string) => {
 if (!it) return <span key={key} className="inline-block w-12 text-center text-muted-foreground/30">·</span>
    // WHAT IS ALREADY COMING. A cell reading 0 with a PO against it is a different
    // situation from a cell reading 0 with nothing coming, and the second is the one that
    // needs someone. It rode on the old variant row as a chip; here it is in the title,
    // because a grid of forty cells cannot carry forty chips and stay a grid.
 const due = onOrder[String(it.sku).toUpperCase()] ?? 0
 const held = Number(it.reserved) || 0
 return (
      <Input
 key={key}
 value={String(Number(it.in_stock) || 0)}
 onChange={(e) => edit(it.sku, "in_stock", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
 inputMode="numeric"
 aria-label={`In stock for ${it.sku}`}
 title={[`${it.sku} · ${Number(it.in_stock) || 0} on the shelf`,
 held > 0 ? `${held} held for orders` : null,
 due > 0 ? `${due} on order` : null].filter(Boolean).join(" · ")}
 className={"h-7 w-12 text-center tabular-nums " + cellTone(it, lowAt)}
      />
    )
  }

  /**
   * ONE TABLE, ALWAYS — even when an axis has a single value.
   *
   * A one-axis product used to get a different layout: a wrapped auto-fill grid of
   * label-and-box pairs. It was defensible on its own (seventeen colours in three short
   * lines rather than a column seventeen rows tall) and wrong on the page, because the
   * page holds both kinds one under the other. Two shapes for the same fact means the
   * colour names sit at one x in this product and another x in the next, and the numbers
   * never line up down the screen — which is exactly what "they don't look evened out" is.
   *
   * So a colour with one size gets a row with one cell, and it lands under the same header
   * as every other product's. A column that is boring is still a column.
   */
  // An axis with no values still needs one slot, or there is nothing to draw the cell in.
 const sizeCols = sizes.length ? sizes : [""]
 const colorRows = colors.length ? colors : [""]
 const hasColorAxis = colors.length > 0
  /**
   * WHAT A SIZELESS COLUMN IS CALLED — and the suppliers already answered this.
   *
   * Caps and duffels record it as `OS`, `OSFA`, `OSFM` or `One Size` depending on whose
   * feed it came from (sanmar.js ranks all four; Otto's are `OS`; the import sheet offers
   * "One Size"). Four spellings of one thing would put four different headers across the
   * page for the same column, so they normalise here — isOneSize is the same test the
   * catalogue's size-range label uses, so the grid and the product card agree.
   *
   * A real single size keeps its own name: a cap sku carrying `ADJUSTABLE` is not
   * one-size-fits-all, it is a size called Adjustable, and saying so is more useful.
   */
 const sizeHeader = (z: string) => (!z || isOneSize(z) ? "One size" : z)
  /** Every sku on one colour's row — what its checkbox selects. */
 const rowSkus = (c: string) => shown.filter((x) => x.color === c).map((x) => x.it.sku)

 return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        {/* FULL WIDTH, so the rules are rules.
            The grid sized itself to its contents, which left it occupying the first third
 of a very wide row: the size columns bunched against the colour names, and every
 separator stopped dead under 3XL with two-thirds of the row unruled — a line
 that ends in the middle of a panel reads as a rendering fault rather than a
 divider. At w-full the columns take the space evenly and each rule crosses the
 whole panel, which is the only way a row of six numbers is read across. */}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              {/* "Colour" only when there IS one. A product whose skus carry sizes and no
 colour was heading its own name column "Colour" and printing a size under
 it. */}
              <th className={`${LABEL_W} ${GUTTER} whitespace-nowrap py-1 pe-2 text-left font-medium`}>
                {hasColorAxis ? tl("inventory", "Colour") : tl("inventory", "Variant")}
              </th>
              {sizeCols.map((z) => (
                <th key={z || "one"} className={`${SIZE_W} px-1 py-1 text-center font-medium`}>{sizeHeader(z)}</th>
              ))}
              {/* The spacer takes the slack, so the real columns keep their width instead of
 stretching to fill a wide screen. */}
              <th className="w-auto pe-4" />
            </tr>
          </thead>
          <tbody>
            {colorRows.map((c) => (
              <tr key={c || "one"} className="border-t border-border">
                {/* SELECTION SURVIVED THE ROWS. Ticking a product used to be one checkbox
 per VARIANT, and those rows are gone — so a restock of "Black, every
 size" would have meant ticking the whole product or nothing. One box per
 colour, at the same x as the product's above it, takes that colour's
 sizes. Per-size selection is genuinely lost; the search box narrows to a
 single variant when that is what you need. */}
                <td className={`${LABEL_W} ${GUTTER} relative truncate whitespace-nowrap py-1 pe-2 font-medium`}>
                  <input
 type="checkbox"
 aria-label={`Select ${c ? prettyColorName(c) : tl("inventory", "this variant")}`}
 checked={rowSkus(c).length > 0 && rowSkus(c).every((k) => sel.has(k))}
 onChange={(e) => {
 const next = new Set(sel)
 rowSkus(c).forEach((k) => (e.target.checked ? next.add(k) : next.delete(k)))
 setSel(next)
                    }}
 className="absolute left-4 top-1/2 size-3.5 -translate-y-1/2"
                  />
                  {c ? prettyColorName(c) : (p.name || group.rows[0]?.name || tl("inventory", "Stock"))}
                </td>
                {sizeCols.map((z) => (
                  <td key={(c || "one") + (z || "one")} className={`${SIZE_W} px-1 py-1 text-center`}>{cell(at(z, c), c + z)}</td>
                ))}
                <td className="w-auto pe-4" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Under the table's own first column, not the panel's edge — it is a footnote to the
 grid, and a footnote that starts somewhere the grid never does reads as a stray. */}
      {leftover.length > 0 && <div className={`${GUTTER} pe-4`}><LeftoverNote rows={leftover} /></div>}
    </div>
  )
}

/**
 * One SKU's barcode, big enough to scan off the screen.
 *
 * The surround is dark so the phone's exposure settles on the code instead of a bright
 * page, but the barcode itself stays BLACK ON WHITE. Inverting it — light bars on a
 * dark field — is what breaks scanning: BarcodeDetector and ZXing both expect dark
 * bars on a light quiet zone, and most handheld guns won't read an inverted code at
 * all. So: dark room, white card.
 *
 * Deliberately dark in BOTH themes rather than following light mode. The darkness is
 * doing a job — it isolates the code and stops a bright page dragging the camera's
 * auto-exposure down onto the white card. A light surround in day mode would undo
 * that. Tinted toward the app's violet (hue 280) so it reads as ours and not as a
 * black void.
 */
function BarcodeZoom({ sku, onClose }: { sku: string | null; onClose: () => void }) {
  const tl = useLabelT()
 return (
    <Dialog open={!!sku} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="border-none bg-[oklch(0.19_0.05_280)] sm:max-w-xl">
        <DialogHeader><DialogTitle className="text-white">{tl("inventory", "Scan this code")}</DialogTitle></DialogHeader>
        {sku && (
          <div className="space-y-3 pb-2">
            {/* Generous white padding IS the quiet zone — Code-128 needs a clear margin
 either side or the scanner can't find the start/stop guards. */}
            {/* QR, not Code-128 — this is a SCREEN.
                A 25-character SKU is 310 Code-128 modules, which in this box is 0.8px per
 bar against the ~2px a camera needs. It was never scannable, whatever the
 decoder did. The same SKU as a QR is 29 modules, about 8.5px each. The
                1D code is still what goes on a PRINTED label, where the physical width
 is there to spend. */}
            <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-8">
              <ScanQr value={sku} size={260} />
              {/* Kept underneath for a handheld gun, which reads 1D off a screen far
 better than a phone camera does. */}
              <Barcode value={sku} height={70} width={2} fontSize={0} displayValue={false} fit />
            </div>
            <p className="text-center tabular-nums text-sm text-white/70">{sku}</p>
            <p className="text-center text-xs text-white/50">
              {tl("inventory", "Phone camera: use the square code. Handheld gun: either. Hold 15–25cm away and turn screen brightness up if it won’t read.")}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * ONE SKU'S STOCK HISTORY — why the number is what it is.
 *
 * This said "every stock movement" and showed only SCANS, which was most of the reason a
 * count that looked wrong could not be explained: a purchase order arriving, an order going
 * into production, goods sent back to a supplier and someone typing a number into the grid
 * all changed the shelf and left no trace anywhere. They are all movements now, from one
 * append-only journal (server/src/stock.js), and the scans are simply four of its reasons.
 *
 * The journal total is stated next to the shelf's own number ON PURPOSE. They should match;
 * where they don't, the row is older than the ledger, and saying which is more useful than
 * a screen that implies the history is complete when it starts mid-story.
 */
const MOVE_WORD: Record<string, string> = {
  "order-consume": "Into production",
  "order-restore": "Back out of production",
  "po-receipt": "Received from supplier",
  "supplier-return": "Returned to supplier",
  "scan-in": "Scanned in",
  "scan-out": "Scanned out",
  "scan-undo": "Scan reversed",
  "count-set": "Counted by hand",
}

function ScanHistoryDialog({ target, onClose }: { target: { label: string; skus: string[] } | null; onClose: () => void }) {
  const tl = useLabelT()
 const [data, setData] = useState<StockHistory | null>(null)
 const [failed, setFailed] = useState(false)
  // The set, as a stable string — an array literal is a new object every render, so
  // depending on it directly would re-fetch the dialog forever.
 const key = target ? target.skus.join(",") : ""
 const many = (target?.skus.length ?? 0) > 1

 useEffect(() => {
 let live = true
 const id = setTimeout(() => {
 const skus = key ? key.split(",") : []
 if (!skus.length) { setData(null); setFailed(false); return }
 const p = skus.length > 1 ? getStockMovementsForSkus(skus, 200) : getStockMovements(skus[0], 100)
 p.then((r) => { if (live) { setData(r ?? null); setFailed(!r) } })
        .catch(() => { if (live) { setData(null); setFailed(true) } })
    }, 0)
 return () => { live = false; clearTimeout(id) }
  }, [key])

 const rows = data?.movements ?? null
 const when = (s?: string) => {
 if (!s) return "—"
 const d = new Date(s)
 return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  }
  // The shelf and its journal, and the gap between them named rather than hidden.
 const gap = data && data.inStock != null ? data.inStock - data.journal : 0

 return (
    <Dialog open={!!target} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClockCounterClockwise size={17} weight="duotone" /> {tl("inventory", "Stock history")}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between border-b border-border pb-2 text-sm">
          <span className="truncate text-xs font-medium">
            <span className={many ? "" : "tabular-nums"}>{target?.label ? tl("inventory", target.label) : ""}</span>
            {many && <span className="text-muted-foreground"> · {target?.skus.length} variants</span>}
          </span>
          {data && (
            <span className="text-xs text-muted-foreground">
              On the shelf <b className="tabular-nums text-foreground">{data.inStock ?? "—"}</b>
              {" · "}journal <b className="tabular-nums text-foreground">{data.journal}</b>
            </span>
          )}
        </div>
        {/* A DIFFERENCE IS A FACT, NOT AN ERROR — every row that existed before this journal
 did starts with one, and it is exactly the size of whatever was on the shelf that
 day. Said plainly so nobody chases it as a bug. */}
        {data && gap !== 0 && (
          <p className="text-2xs text-muted-foreground">
            {gap > 0 ? gap : -gap} {gap > 0 ? "more" : "fewer"} on the shelf than this history accounts for
            — anything counted before movements were recorded isn&apos;t in it.
          </p>
        )}
        {failed ? (
          <EmptyState icon={Warning} size="sm" title={tl("inventory", "Couldn't read this SKU's history")} note={tl("inventory", "This is a problem reaching the server, not an empty history.")} />
        ) : rows === null ? (
          <div className="flex justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ClockCounterClockwise} size="sm" title={tl("inventory", "Nothing has moved this SKU yet")} />
        ) : (
          <div className="max-h-80 divide-y divide-border overflow-auto">
            {rows.map((r) => {
 const up = r.delta > 0
 return (
                <div key={r.id} className="flex items-center gap-3 py-2">
                  <span className={"flex size-6 shrink-0 items-center justify-center rounded-md " + (up ? "bg-shipped/12 text-success" : "bg-hold/15 text-hold")}>
                    {up ? <ArrowDown size={12} weight="bold" /> : <ArrowUp size={12} weight="bold" />}
                  </span>
                  <span className={"w-10 shrink-0 text-sm font-semibold tabular-nums " + (up ? "text-success" : "text-alert")}>
                    {up ? "+" : "−"}{Math.abs(r.delta)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {MOVE_WORD[r.reason] ?? r.reason}
                      {/* WHICH variant, but only when the list holds more than one — on a
 single sku's history it would be the same string on every line. */}
                      {many && r.sku && <span className="ms-1.5 tabular-nums text-xs text-muted-foreground">{r.sku}</span>}
                    </div>
                    {(r.orderId || r.ref || r.note) && (
                      <div className="truncate text-xs text-muted-foreground">
                        {r.orderId ? <span className="tabular-nums">order {r.orderId}</span>
 : r.ref ? <span className="tabular-nums">{r.ref}</span> : null}
                        {(r.orderId || r.ref) && r.note ? " · " : null}
                        {r.note}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{when(r.at)}</span>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * ADD A ROW, OR ADD A PRODUCT'S WHOLE SIZE RUN.
 *
 * Typing a sku by hand is how every row got here, and it is the step that gets them wrong:
 * the sku has to match what an order line resolves to, and nothing on the form said what
 * that was. Picking the product instead derives it — `variantSku`, the same function the
 * product editor writes stock with — so a size run added here and one stocked on the product
 * card are the SAME rows rather than two spellings of them.
 *
 * PER SIZE, not per size × colour, because that is what the product editor now holds. Two
 * screens writing two different key shapes for one shelf is the split that made "do we have
 * it?" unanswerable in the first place.
 */
/**
 * ADD A BLANK TO THE INVENTORY LIST — exported, because the other place this is needed is an
 * ORDER LINE. A line whose blank is not on the list reads "Not tracked", and the answer to
 * that is this dialog; opening the Inventory page, finding the blank and typing its sku again
 * is the same work done by hand. §5: import it, don't build a second one.
 *
 * `seedQuery` pre-fills the catalogue search so the caller can hand it the sku it is asking
 * about. It is a SEARCH, not a selection — the person still picks, because a sku that matches
 * nothing must not silently add the wrong blank.
 */
export function AddItemDialog({ open, onOpenChange, onAdd, existing, catalog, seedQuery }: { open: boolean; onOpenChange: (v: boolean) => void; onAdd: (items: InventoryItem[]) => void; existing: string[]; catalog: CatalogProduct[]; seedQuery?: string }) {
  const tl = useLabelT()
 const [mode, setMode] = useState<"catalog" | "manual">("catalog")
 const [sku, setSku] = useState("")
 const [name, setName] = useState("")
 const [variant, setVariant] = useState("")
 const [stock, setStock] = useState("")
 const [reorder, setReorder] = useState("25")
 const [category, setCategory] = useState("")
 const [supplier, setSupplier] = useState("")
  // Starts closed. Adding a row by hand is still not a decision to publish it, and the
  // dialog should not be the place that quietly differs from receiving.
 const [visibility, setVisibility] = useState<SkuVisibility>("factory")
 const [err, setErr] = useState<string | null>(null)
  // Catalogue path
 const [q, setQ] = useState("")
 const [pickedId, setPickedId] = useState<string | null>(null)
 const [chosen, setChosen] = useState<Set<string>>(new Set())

 useEffect(() => {
 if (!open) return
 const id = setTimeout(() => {
 setMode(catalog.length ? "catalog" : "manual")
 setSku(""); setName(""); setVariant(""); setStock(""); setReorder("25"); setCategory(""); setSupplier(""); setVisibility("factory"); setErr(null)
 setQ(seedQuery ?? ""); setPickedId(null); setChosen(new Set())
    }, 0)
 return () => clearTimeout(id)
  }, [open, catalog.length, seedQuery])

 const withSku = useMemo(() => catalog.filter((p) => String(p.sku || "").trim()), [catalog])
 const matches = useMemo(() => {
 const t = q.trim().toLowerCase()
 const list = t ? withSku.filter((p) => `${p.name ?? ""} ${p.sku ?? ""}`.toLowerCase().includes(t)) : withSku
 return list.slice(0, 40)
  }, [withSku, q])
 const picked = useMemo(() => withSku.find((p) => String(p.id ?? p.sku) === pickedId) ?? null, [withSku, pickedId])
 const pickedSizes = useMemo(() => (picked ? productSizes(picked) : []), [picked])
 const pickedColors = useMemo(() => (picked ? productColors(picked) : []), [picked])

  /**
   * ONE ROW PER VARIANT — colour AND size, because that is what the shelf holds and what an
   * order line asks for ("Red · L/XL"). Filing per size alone produced counts no line could
   * draw from, and printed "Not tracked" beside blanks that were in the building.
   *
   * `chosen` holds the sku itself rather than a size, since the grid is now two dimensions
   * and a size string can no longer name a row on its own.
   */
 const rows = useMemo(() => {
 if (!picked) return []
 const base = String(picked.sku || "").trim()
 const szs = pickedSizes.length ? pickedSizes : [""]
 const cls = pickedColors.length ? pickedColors : [""]
 const out: { size: string; color: string; sku: string; exists: boolean }[] = []
 for (const c of cls) for (const sz of szs) {
 const k = variantSku(base, sz || null, c || null)
 out.push({ size: sz, color: c, sku: k, exists: existing.some((e) => e.toUpperCase() === k.toUpperCase()) })
    }
 return out
  }, [picked, pickedSizes, pickedColors, existing])

 const pick = (p: CatalogProduct) => {
 setPickedId(String(p.id ?? p.sku))
    /**
     * EVERY VARIANT, TICKED. A product's whole colour × size run is what "add this product
     * to inventory" means — the shelf should be able to say "none of that one" as a FACT,
     * and it can only do that for a variant it has a row for. A blank row is silence; a row
     * at 0 is an answer, and it is the answer the order board needs to stop reading a real
     * garment as untracked.
     *
     * Ones already stocked stay out: re-adding them would rewrite a real count with a zero.
     */
 const base = String(p.sku || "").trim()
    // The product's OWN variants, as the editor saved them — the supplier's full run is
    // not what we hold.
 const szs = productSizes(p)
 const cls = productColors(p)
 const next = new Set<string>()
 for (const c of (cls.length ? cls : [""])) for (const sz of (szs.length ? szs : [""])) {
 const k = variantSku(base, sz || null, c || null)
 if (k && !existing.some((e) => e.toUpperCase() === k.toUpperCase())) next.add(k)
    }
 setChosen(next)
 setErr(null)
  }

 const saveManual = () => {
 const s = sku.trim()
 if (!s) { setErr("A SKU is required."); return }
 if (existing.includes(s)) { setErr("That SKU already exists."); return }
 onAdd([{ sku: s, name: name.trim() || undefined, variant: variant.trim() || undefined, in_stock: Number(stock) || 0, reorder_at: Number(reorder) || 25, category: category.trim() || undefined, supplier: supplier.trim() || undefined, visibility }])
  }

 const saveCatalog = () => {
 if (!picked) { setErr("Pick a product first."); return }
 const take = rows.filter((r) => chosen.has(r.sku) && !r.exists)
 if (!take.length) { setErr("Nothing to add — every ticked variant is already on the shelf."); return }
 onAdd(take.map((r) => ({
 sku: r.sku,
 name: picked.name || undefined,
 variant: (r.size || r.color) ? variantLabel(r.size || null, r.color || null) : undefined,
 in_stock: Number(stock) || 0,
 reorder_at: Number(reorder) || 25,
 category: picked.type || category.trim() || undefined,
      /**
       * THE SUPPLIER COMES WITH IT — I had this the other way round, on the reasoning that a
       * supplier name is factory-only. It is, and this is a factory field: GET /api/inventory
       * is staff-only and the partner stock feed selects sku/name/variant/counts and never
       * this. §2.9 is about what we PUBLISH.
       *
       * It matters because replenishment groups a shortfall by `inventory.supplier`. Without
       * it, a row we created from a catalogue product that plainly names its supplier still
       * reaches the cart as "Unassigned · order by hand" — a line nobody can place.
       */
 supplier: picked.supplier?.trim() || undefined,
 visibility,
    })))
  }

 return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{tl("inventory", "Add inventory item")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {catalog.length > 0 && (
            <TabBar
              size="sm"
              ariaLabel="How to add this item"
              items={[{ id: "catalog", label: tl("inventory", "From catalogue") }, { id: "manual", label: tl("inventory", "By hand") }]}
              value={mode}
              onChange={(id) => { setMode(id); setErr(null) }}
            />
          )}

          {mode === "catalog" ? (
            <>
              {!picked ? (
                <>
                  <SearchField
                    value={q}
                    onChange={setQ}
                    autoFocus
                    placeholder={tl("inventory", "Search the catalogue…")}
                  />
                  <div className="max-h-72 divide-y divide-border overflow-auto rounded-lg border border-border">
                    {matches.length === 0 ? (
                      <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {withSku.length === 0 ? tl("inventory", "No catalogue product has a SKU yet — stock is held against it, so add one on the product first.") : tl("inventory", "No product matches.")}
                      </div>
                    ) : matches.map((p) => (
                      <button
 key={String(p.id ?? p.sku)}
 type="button"
 onClick={() => pick(p)}
 className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <Thumb src={imageFor(p, null)} name={p.name ?? "?"} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name || tl("inventory", "Untitled")}</span>
                          <span className="block truncate tabular-nums text-xs text-muted-foreground">{p.sku}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{productColors(p).length || 1} × {productSizes(p).length || 1}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2.5 rounded-lg border border-border p-2.5">
                    <Thumb src={imageFor(picked, null)} name={picked.name ?? "?"} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{picked.name}</div>
                      <div className="truncate tabular-nums text-xs text-muted-foreground">{picked.sku}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => { setPickedId(null); setChosen(new Set()) }}>{tl("inventory", "Change")}</Button>
                  </div>
                  {/* GROUPED BY COLOURWAY, sizes inside it. A flat list of 66 variants is a
 scroll; the question anyone actually has is "which colours are we
 stocking, and in what sizes", and that is two shallow lists. */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Variants to stock{chosen.size ? ` — ${chosen.size} picked` : ""}</span>
                      <button
 type="button"
 className="font-medium text-primary hover:underline"
 onClick={() => setChosen(chosen.size ? new Set() : new Set(rows.filter((r) => !r.exists).map((r) => r.sku)))}
                      >
                        {chosen.size ? tl("inventory", "Clear") : tl("inventory", "Select all")}
                      </button>
                    </div>
                    <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-border p-2">
                      {Object.entries(rows.reduce((acc, r) => {
                        (acc[r.color] ??= []).push(r); return acc
                      }, {} as Record<string, typeof rows>)).map(([color, group]) => {
 const free = group.filter((r) => !r.exists)
 const allOn = free.length > 0 && free.every((r) => chosen.has(r.sku))
 return (
                          <div key={color || "one"}>
                            <div className="mb-1 flex items-center gap-1.5">
                              <input
 type="checkbox"
 checked={allOn}
 disabled={free.length === 0}
 aria-label={`All sizes of ${color ? prettyColorName(color) : tl("inventory", "this product")}`}
 onChange={(e) => setChosen((prev) => {
 const n = new Set(prev)
 for (const r of free) { if (e.target.checked) n.add(r.sku); else n.delete(r.sku) }
 return n
                                })}
 className="size-3.5 accent-[var(--primary)]"
                              />
                              <span className="text-xs font-medium">{color ? prettyColorName(color) : tl("inventory", "All sizes")}</span>
                            </div>
                            <div className="flex flex-wrap gap-1 pl-5">
                              {group.map((r) => (
                                <label
 key={r.sku}
 title={r.exists ? `${r.sku} — already stocked` : r.sku}
 className={"inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs "
                                    + (r.exists ? "border-border opacity-40"
 : chosen.has(r.sku) ? "cursor-pointer border-primary bg-primary/10 text-primary"
 : "cursor-pointer border-border")}
                                >
                                  <input
 type="checkbox"
 checked={chosen.has(r.sku)}
 disabled={r.exists}
 onChange={(e) => setChosen((prev) => { const n = new Set(prev); if (e.target.checked) n.add(r.sku); else n.delete(r.sku); return n })}
 className="sr-only"
                                  />
                                  {r.size || tl("inventory", "One size")}
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">SKU</span><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder={tl("inventory", "G2000-BLK-L")} className="h-9 tabular-nums" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{tl("inventory", "Name")}</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tl("inventory", "Gildan Ultra Cotton Tee")} className="h-9" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{tl("inventory", "Variant")}</span><Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder={tl("inventory", "Black · L")} className="h-9" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{tl("inventory", "Supplier")}</span><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={tl("inventory", "S&S Activewear / Otto Cap")} className="h-9" /></label>
            </>
          )}

          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{tl("inventory", "In stock")}</span><Input value={stock} onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" inputMode="numeric" className="h-9" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{tl("inventory", "Reorder at")}</span><Input value={reorder} onChange={(e) => setReorder(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className="h-9" /></label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{tl("inventory", "Category")}</span>
              <Input value={mode === "catalog" ? (picked?.type ?? "") : category} onChange={(e) => setCategory(e.target.value)} disabled={mode === "catalog"} placeholder={tl("inventory", "Apparel")} className="h-9" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{tl("inventory", "Visibility")}</span>
            <select
 value={visibility}
 onChange={(e) => setVisibility(e.target.value as SkuVisibility)}
 className="eg-select eg-control pr-8"
            >
              {VIS.map((v) => <option key={v.id} value={v.id}>{tl("inventory", v.label)}</option>)}
            </select>
            <span className="text-2xs text-muted-foreground">
              {visibility === "factory" ? tl("inventory", "Internal only — nothing outside the factory sees this SKU.")
 : visibility === "seller" ? tl("inventory", "Published in the partner stock feed.")
 : tl("inventory", "Cleared for unauthenticated surfaces too. Nothing reads that yet — this records the decision.")}
            </span>
          </label>
          {mode === "manual" && sku.trim() && <div className="flex justify-center rounded-lg border border-border bg-muted/30 py-2"><Barcode value={sku.trim()} height={40} /></div>}
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{tl("inventory", "Cancel")}</Button>
            {mode === "catalog" ? (
              <Button onClick={saveCatalog} disabled={!picked || chosen.size === 0}>
                Add {chosen.size || ""} item{chosen.size === 1 ? "" : "s"}
              </Button>
            ) : (
              <Button onClick={saveManual}>{tl("inventory", "Add item")}</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

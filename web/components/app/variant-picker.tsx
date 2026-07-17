"use client"

import { useMemo, useState } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { postItemSetup, type CatalogProduct, type OrderItem } from "@/lib/api"
import { resolveProduct, colorsOf, methodsOf } from "@/lib/variant-resolve"

// The per-line variant picker: Blank · Colour · Size · Method. Marketplace orders arrive
// with these UNSET (nothing to price), so this is what makes them submittable — and a
// listing published from our catalog arrives already resolved by SKU, so it shows the
// blank pre-filled with nothing to do. The chosen Blank drives the Colour/Size/Method
// options. Persisted per line (postItemSetup); the parent reloads so the quote updates.
export function VariantPicker({
  orderId, item, catalog, onSaved,
}: {
  orderId: string
  item: OrderItem
  catalog: CatalogProduct[]
  onSaved: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const product = useMemo(() => resolveProduct(item, catalog), [item, catalog])
  const blankLabel = product?.name || item.blank || ""
  const colorOpts = colorsOf(product)
  const sizeOpts = product?.sizes ?? []
  const methodOpts = methodsOf(product)

  const key = item.line_id ? { line_id: item.line_id } : { sku: item.sku }

  const save = async (patch: Parameters<typeof postItemSetup>[1], field: string) => {
    setBusy(field); setErr(null)
    try { await postItemSetup(orderId, { ...key, ...patch }); onSaved() }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save") }
    finally { setBusy(null) }
  }

  // Picking a blank clears colour/size/method that don't exist on the new product, so a
  // stale "Navy" from the previous blank can't linger and mis-price.
  const pickBlank = (name: string) => {
    const p = catalog.find((x) => String(x.name) === name)
    const keep = (v: string | undefined, opts: string[]) => (v && opts.includes(v) ? v : "")
    save({
      blank: name,
      color: keep(item.color, colorsOf(p ?? null)),
      size: keep(item.size, p?.sizes ?? []),
      printType: keep(item.print_type, methodsOf(p ?? null)),
    }, "blank")
  }

  const sel = "h-8 rounded-md border border-input bg-transparent px-2 text-xs font-medium disabled:opacity-50"

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {/* Blank — the load-bearing pick; nothing else can price without it. */}
      <select className={sel + (blankLabel ? "" : " border-amber-300 text-amber-700")} value={blankLabel}
        disabled={busy === "blank"} onChange={(e) => pickBlank(e.target.value)} aria-label="Blank product" title="Which catalog product to make this on">
        <option value="">Pick a blank…</option>
        {blankLabel && !catalog.some((p) => p.name === blankLabel) && <option value={blankLabel}>{blankLabel}</option>}
        {catalog.map((p) => <option key={String(p.id ?? p.name)} value={p.name}>{p.name}</option>)}
      </select>

      <select className={sel} value={item.color || ""} disabled={!product || busy === "color"}
        onChange={(e) => save({ color: e.target.value }, "color")} aria-label="Colour">
        <option value="">{colorOpts.length ? "Colour…" : "Colour (any)"}</option>
        {item.color && !colorOpts.includes(item.color) && <option value={item.color}>{item.color}</option>}
        {colorOpts.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <select className={sel} value={item.size || ""} disabled={!product || busy === "size"}
        onChange={(e) => save({ size: e.target.value }, "size")} aria-label="Size">
        <option value="">{sizeOpts.length ? "Size…" : "Size (any)"}</option>
        {item.size && !sizeOpts.includes(item.size) && <option value={item.size}>{item.size}</option>}
        {sizeOpts.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <select className={sel} value={item.print_type || ""} disabled={!product || busy === "printType"}
        onChange={(e) => save({ printType: e.target.value }, "printType")} aria-label="Print method">
        <option value="">{methodOpts.length ? "Method…" : "Method (any)"}</option>
        {item.print_type && !methodOpts.includes(item.print_type) && <option value={item.print_type}>{item.print_type}</option>}
        {methodOpts.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>

      {busy && <CircleNotch size={13} className="animate-spin text-muted-foreground" />}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  )
}

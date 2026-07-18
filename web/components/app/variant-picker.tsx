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

  // Every field is w-full inside an even grid track, so the four controls line up with
  // each other AND across line items. Native <select> auto-sizes to its widest option,
  // which is what made these ragged (a 195px blank next to a 74px size) and wrap
  // unpredictably — the fixed track is the fix, so don't drop w-full.
  const sel =
    "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-xs font-medium " +
    "disabled:cursor-not-allowed disabled:opacity-50"

  return (
    <div className="mt-3">
      {/* Uneven tracks, but the SAME tracks on every line item — Blank holds full product
          names so it gets the room; Size holds "S"/"2XL" so it needs least. */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-[1.7fr_1.1fr_0.8fr_1.1fr]">
        {/* Blank — the load-bearing pick; nothing else can price without it, so it's the
            only field that flags itself when empty. */}
        <Field label="Blank" hint={!blankLabel ? "Required" : undefined}>
          <select className={sel + (blankLabel ? "" : " border-amber-400/70")} value={blankLabel}
            disabled={busy === "blank"} onChange={(e) => pickBlank(e.target.value)} aria-label="Blank product" title="Which catalog product to make this on">
            <option value="">Pick a blank…</option>
            {blankLabel && !catalog.some((p) => p.name === blankLabel) && <option value={blankLabel}>{blankLabel}</option>}
            {catalog.map((p) => <option key={String(p.id ?? p.name)} value={p.name}>{p.name}</option>)}
          </select>
        </Field>

        <Field label="Colour">
          <select className={sel} value={item.color || ""} disabled={!product || busy === "color"}
            onChange={(e) => save({ color: e.target.value }, "color")} aria-label="Colour">
            <option value="">{colorOpts.length ? "Choose…" : "Any"}</option>
            {item.color && !colorOpts.includes(item.color) && <option value={item.color}>{item.color}</option>}
            {colorOpts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>

        <Field label="Size">
          <select className={sel} value={item.size || ""} disabled={!product || busy === "size"}
            onChange={(e) => save({ size: e.target.value }, "size")} aria-label="Size">
            <option value="">{sizeOpts.length ? "Choose…" : "Any"}</option>
            {item.size && !sizeOpts.includes(item.size) && <option value={item.size}>{item.size}</option>}
            {sizeOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>

        <Field label="Method">
          <select className={sel} value={item.print_type || ""} disabled={!product || busy === "printType"}
            onChange={(e) => save({ printType: e.target.value }, "printType")} aria-label="Print method">
            <option value="">{methodOpts.length ? "Choose…" : "Any"}</option>
            {item.print_type && !methodOpts.includes(item.print_type) && <option value={item.print_type}>{item.print_type}</option>}
            {methodOpts.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>

      {(busy || err) && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {busy && <span className="flex items-center gap-1.5 text-muted-foreground"><CircleNotch size={13} className="animate-spin" /> Saving…</span>}
          {err && <span className="text-destructive">{err}</span>}
        </div>
      )}
    </div>
  )
}

// A labelled field. Without the label a filled control is ambiguous — "Camo Green" on its
// own doesn't say which attribute it sets.
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {hint && <span className="font-medium normal-case tracking-normal text-amber-600">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

"use client"

import { useMemo, useState } from "react"
import { postItemSetup, type CatalogProduct, type OrderItem } from "@/lib/api"
import { resolveProduct, colorsOf, methodsOf, sizesOf } from "@/lib/variant-resolve"
import { VariantField } from "@/components/app/variant-field"

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
  // MEMOISED, all four. These were plain calls in the render body, so every keystroke or
  // parent re-render rebuilt them — and one of these pickers is mounted per LINE, on a
  // board that can hold hundreds. colorsOf/sizesOf/methodsOf each walk the product, and
  // blankOptions maps the ENTIRE catalog, so the cost was (lines × catalog) per render.
  // That is what made the fields feel like they were lagging rather than responding.
  const colorOpts = useMemo(() => colorsOf(product), [product])
  const sizeOpts = useMemo(() => sizesOf(product), [product])
  const methodOpts = useMemo(() => methodsOf(product), [product])

  // Keep a blank the catalog no longer lists so an existing line can't silently lose it.
  const blankOptions = useMemo(() => {
    const names = catalog.map((p) => String(p.name ?? "")).filter(Boolean)
    return blankLabel && !names.includes(blankLabel) ? [blankLabel, ...names] : names
  }, [catalog, blankLabel])

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
      size: keep(item.size, sizesOf(p ?? null)),
      printType: keep(item.print_type, methodsOf(p ?? null)),
    }, "blank")
  }

  return (
    <div className="mt-3">
      {/* Uneven tracks, but the SAME tracks on every line item. Sized to the LONGEST value
          each field actually holds: Blank carries full product names, Colour carries words
          like "Heather Grey", while Size is "S"/"2XL" and Method is "DTG"/"EMB" — three or
          four characters. Giving those two an equal share left them mostly empty and starved
          the blank name, which is the one that gets truncated. */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-[1.7fr_1.25fr_0.7fr_0.85fr]">
        {/* Blank — the load-bearing pick; nothing else can price without it, so it's the
            only field that flags itself when empty. */}
        <VariantField
          label="Blank" value={blankLabel} required
          options={blankOptions} placeholder="Pick a blank…"
          disabled={busy === "blank"} onChange={pickBlank}
        />
        <VariantField
          label="Colour" value={item.color || ""} options={colorOpts} swatches
          disabled={!product || busy === "color"} onChange={(v) => save({ color: v }, "color")}
        />
        <VariantField
          label="Size" value={item.size || ""} options={sizeOpts}
          disabled={!product || busy === "size"} onChange={(v) => save({ size: v }, "size")}
        />
        <VariantField
          label="Method" value={item.print_type || ""} options={methodOpts}
          disabled={!product || busy === "printType"} onChange={(v) => save({ printType: v }, "printType")}
        />
      </div>

      {/* Colour/Size/Method are disabled until a blank is chosen — the blank decides which
          options exist. Without saying so, those greyed "Any" fields read as broken ("can't
          select them"); this line names the gate and the next action. */}
      {!product && (
        <p className="mt-2 text-xs text-muted-foreground">Pick a blank first — it sets the colour, size &amp; method options.</p>
      )}

      {/* Errors only — no transient "Saving…" line.
          That row was mounted on `busy`, so every single pick grew the item by its height
          and then shrank it again the moment the save landed: the row jumped on each
          selection. The feedback was redundant anyway — the field being saved is passed
          `disabled` and visibly dims, which already says "working" without moving
          anything. An error still takes space, because a failed save has to be seen. */}
      {err && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span className="text-destructive">{err}</span>
        </div>
      )}
    </div>
  )
}

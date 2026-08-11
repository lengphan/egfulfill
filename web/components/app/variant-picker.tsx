"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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

  /**
   * A FIELD WITH ONE OPTION IS NOT A CHOICE — fill it in.
   *
   * A marketplace line arrives with everything unset, and the line is blocked from
   * production until each field the blank offers has been picked (itemNeedsSetup). When the
   * blank offers exactly one method there is nothing to decide: somebody has to open the
   * dropdown, see a single entry, and select it before the order can move. That is a click
   * to confirm a fact the catalogue already stated.
   *
   * ONCE PER LINE, and never in reply to a clear. Clearing is a real gesture — VariantField
   * offers it — and a rule that refills the moment the field empties would make the clear
   * look broken. The ref remembers which lines have already been filled in, so the first
   * render sets it and nothing after that fights the human.
   *
   * METHOD ONLY. The same argument holds for a one-colour or one-size blank, but colour and
   * size are things a buyer chose and a picker confirms against the parcel; a print method
   * is how WE make it. Widening this is a product decision, not a tidy-up.
   */
  const autoFilled = useRef<Set<string>>(new Set())
  useEffect(() => {
    const lineKey = String(item.line_id ?? item.sku ?? "")
    if (!lineKey || !product) return
    if (methodOpts.length !== 1 || (item.print_type ?? "").trim()) return
    if (autoFilled.current.has(lineKey)) return
    autoFilled.current.add(lineKey)
    // Deferred: this sets state (busy) and posts, and an effect body that does either
    // synchronously cascades a render before paint.
    const t = setTimeout(() => { void save({ printType: methodOpts[0] }, "printType") }, 0)
    return () => clearTimeout(t)
    // `save` is stable enough for this — it closes over orderId/key, both of which change
    // only when the line itself does, which is exactly when this should run again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, methodOpts, item.print_type, item.line_id, item.sku])

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

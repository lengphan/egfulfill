"use client"

import { useMemo, useState } from "react"
import { postItemSetup, type CatalogProduct, type OrderItem } from "@/lib/api"
import { resolveProduct, colorsOf, methodsOf, sizesOf, productLabel } from "@/lib/variant-resolve"
import { PRODUCT_METHODS } from "@/lib/print-method"
import { getUser } from "@/lib/auth"
import { VariantField } from "@/components/app/variant-field"

// What the fields offer when the blank can't be resolved — see the note on colorList.
// Sizes are the ladder every apparel blank in the catalogue draws from; methods are the
// canonical list, so this can't drift from what pricing recognises.
const FALLBACK_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"]
const FALLBACK_METHODS = PRODUCT_METHODS.map((m) => m.label)

// The per-line variant picker: Blank · Colour · Size · Method. Marketplace orders arrive
// with these UNSET (nothing to price), so this is what makes them submittable — and a
// listing published from our catalog arrives already resolved by SKU, so it shows the
// blank pre-filled with nothing to do. The chosen Blank drives the Colour/Size/Method
// options. Persisted per line (postItemSetup); the parent reloads so the quote updates.
export function VariantPicker({
  orderId, item, catalog, onSaved, dense,
}: {
  orderId: string
  item: OrderItem
  catalog: CatalogProduct[]
  onSaved: () => void
  /**
   * Two per row at EVERY width.
   *
   * The four-track layout below turns on at `sm`, which is a VIEWPORT question — and the
   * designer's rail is a fixed 380px column on a wide screen, so all four tracks were laid
   * out inside it and Size and Method truncated to "S.." and "E...". The breakpoint cannot
   * see the container; the caller can.
   */
  dense?: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Same read as every other role check in components/app — anyone who isn't a seller.
  const isStaff = (getUser()?.role || "seller") !== "seller"

  const product = useMemo(() => resolveProduct(item, catalog), [item, catalog])
  /**
   * THE BLANK, AS "SKU - NAME" — the same string the order grid writes and the import
   * sheet's dropdown offers (productLabel). This field showed the NAME alone, so the one
   * strip a seller reads on their own order disagreed with the two places the same value is
   * picked, and a catalogue with three cuts of one shirt showed three identical rows.
   * The sku half is what tells them apart, and it is the half a seller quotes at us.
   */
  const blankLabel = product ? productLabel(product) : item.blank || ""
  // MEMOISED, all four. These were plain calls in the render body, so every keystroke or
  // parent re-render rebuilt them — and one of these pickers is mounted per LINE, on a
  // board that can hold hundreds. colorsOf/sizesOf/methodsOf each walk the product, and
  // blankOptions maps the ENTIRE catalog, so the cost was (lines × catalog) per render.
  // That is what made the fields feel like they were lagging rather than responding.
  const colorOpts = useMemo(() => colorsOf(product), [product])
  const sizeOpts = useMemo(() => sizesOf(product), [product])
  const methodOpts = useMemo(() => methodsOf(product), [product])

  /**
   * NOTHING HERE LOCKS BEFORE THE ORDER IS SUBMITTED.
   *
   * Colour, size and method were dead controls whenever the blank didn't resolve — which is
   * the exact state a sheet import lands in, since it writes whatever Blank SKU cell it was
   * given. So a seller looking at their own unsubmitted order could not touch three of the
   * four fields, and the one instruction on screen ("pick a blank first") pointed at a field
   * that already had a value.
   *
   * A blank we can't resolve means we don't know this product's OPTIONS. It does not mean
   * the seller doesn't know what they want. So the options fall back to what we can say
   * generally — every colour the catalogue uses, the standard size ladder, our print
   * methods — and the line keeps whatever the sheet supplied. Pricing still needs a real
   * blank, which is what the note under the strip is for; that is a separate problem from
   * being able to type what you're asking for.
   */
  const catalogColors = useMemo(() => {
    const set = new Set<string>()
    for (const p of catalog) for (const c of colorsOf(p)) set.add(c)
    return [...set]
  }, [catalog])
  // `keep` puts a value the list doesn't contain at the front rather than dropping it —
  // the same rule blankOptions uses, so an imported "Light Blue" survives a product that
  // has never heard of it.
  const keep = (value: string, opts: string[]) => (value && !opts.includes(value) ? [value, ...opts] : opts)
  const colorList = keep(item.color || "", colorOpts.length ? colorOpts : catalogColors)
  const sizeList = keep(item.size || "", sizeOpts.length ? sizeOpts : FALLBACK_SIZES)
  /**
   * THE FALLBACK IS FOR AN UNRESOLVED BLANK, NOT FOR A PRODUCT THAT SAYS NOTHING.
   *
   * `methodOpts.length ? … : FALLBACK_METHODS` could not tell those two apart, so a blank
   * that resolves perfectly well and simply lists no technique offered all eight — and
   * picking one put a method on the line the catalogue never claimed, priced by a
   * surcharge that may not exist and unmakeable on the floor. It also disagreed with
   * orders/new, which refuses that trade for the same product: one screen said "None on
   * this blank" while the other offered the full list.
   *
   * A RESOLVED PRODUCT IS THE AUTHORITY, including when its answer is "none" — that is a
   * gap to fix on the product, not one to paper over here. Colour and size keep their
   * fallbacks: those are free choices that don't decide how the thing gets made.
   */
  const methodList = keep(item.print_type || "", product ? methodOpts : FALLBACK_METHODS)

  // Keep a blank the catalog no longer lists so an existing line can't silently lose it.
  const blankOptions = useMemo(() => {
    const names = catalog.map((p) => productLabel(p)).filter(Boolean)
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
   * A ONE-OPTION FIELD IS FILLED BY THE PERSON, NOT BY US.
   *
   * This used to auto-save the method whenever a blank offered exactly one, on the argument
   * that a field with a single option is not a choice and the click only confirms what the
   * catalogue already said.
   *
   * The argument was wrong about what someone SEES. You pick a blank, and a field you never
   * touched fills itself a moment later — so the screen changes under you, and the value that
   * lands is one you did not choose and may not have read. On a line that decides how an order
   * gets MADE, a write nobody asked for is worse than a click: "DTG printing" appearing on its
   * own is indistinguishable from a value that was already there, and it was persisted to the
   * server immediately.
   *
   * One option still costs one click, and that click is the record of a human deciding. If
   * the friction is worth removing later, the honest version is to SHOW the single option as
   * a suggestion and commit it when it is chosen — not to write it and hope it was right.
   */

  // Picking a blank clears colour/size/method that don't exist on the new product, so a
  // stale "Navy" from the previous blank can't linger and mis-price.
  const pickBlank = (name: string) => {
    // The option is the LABEL now. Matched on the label first and on the bare name second,
    // so the row kept for a blank the catalogue no longer lists — which is whatever string
    // the line already carried — still finds its product if one exists.
    const p = catalog.find((x) => productLabel(x) === name) ?? catalog.find((x) => String(x.name) === name)
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
      <div className={"grid grid-cols-2 gap-x-2 gap-y-2.5" + (dense ? "" : " sm:grid-cols-[1.7fr_1.25fr_0.7fr_0.85fr]")}>
        {/* Blank — the load-bearing pick; nothing else can price without it, so it's the
            only field that flags itself when empty. */}
        {/* No custom placeholder: the field names itself now, and "Blank" beside the
            Required flag says the same thing "Pick a blank…" did, in the same space the
            other three use. */}
        <VariantField
          label="Blank" value={blankLabel} required
          options={blankOptions}
          disabled={busy === "blank"} onChange={pickBlank}
        />
        <VariantField
          label="Colour" value={item.color || ""} options={colorList} swatches
          disabled={busy === "color"} onChange={(v) => save({ color: v }, "color")}
        />
        <VariantField
          label="Size" value={item.size || ""} options={sizeList}
          disabled={busy === "size"} onChange={(v) => save({ size: v }, "size")}
        />
        {/* Says WHY it is empty rather than just being dead. ONE WORD, not the sentence
            orders/new can afford: this field is a quarter of a four-column strip, so
            "Method · None on this blank" truncated to "Method · …" — which says less than
            nothing, since the reason was the part that got cut. "Method · none" fits. */}
        <VariantField
          label="Method" value={item.print_type || ""} options={methodList}
          emptyLabel="none"
          disabled={busy === "printType"} onChange={(v) => save({ printType: v }, "printType")}
        />
      </div>

      {/* Errors only — no transient "Saving…" line.
          That row was mounted on `busy`, so every single pick grew the item by its height
          and then shrank it again the moment the save landed: the row jumped on each
          selection. The feedback was redundant anyway — the field being saved is passed
          `disabled` and visibly dims, which already says "working" without moving
          anything. An error still takes space, because a failed save has to be seen. */}
      {/**
        * WHERE IT IS FIXED — for the one person who can fix it, in the fewest words it
        * takes to say.
        *
        * This was a two-clause sentence naming the blank and explaining the situation, and
        * it ran the full width under the strip: a paragraph of grey on a row whose other
        * lines are a title, a variant and four controls. The FACT is already on the field
        * itself ("Method · none"), so repeating it in prose bought nothing and cost the
        * row its shape.
        *
        * What the field cannot say is where to go, so that is all that is left here — and
        * only to staff. A seller cannot edit a product; telling them to is an instruction
        * they can't act on, and it turned an ordinary state of their order into something
        * that looked like their problem.
        */}
      {product && methodOpts.length === 0 && isStaff && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          No print method on this blank — set them on the product.
        </p>
      )}
      {err && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span className="text-destructive">{err}</span>
        </div>
      )}
    </div>
  )
}

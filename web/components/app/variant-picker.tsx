"use client"

import { useLabelT } from "@/lib/i18n"
import { useMemo, useState } from "react"
import { postItemSetup, postOrderDesign, type CatalogProduct, type OrderItem } from "@/lib/api"
import { resolveProduct, colorsOf, methodsOf, sizesOf, productLabel, bestMockup, blankCode, offeredSides } from "@/lib/variant-resolve"
import { thumbSrc } from "@/lib/order-image"
import { PRODUCT_METHODS } from "@/lib/print-method"
import { getUser } from "@/lib/auth"
import { VariantField } from "@/components/app/variant-field"
import { CaretDown } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

// What the fields offer when the blank can't be resolved — see the note on colorList.
// Sizes are the ladder every apparel blank in the catalogue draws from; methods are the
// canonical list, so this can't drift from what pricing recognises.
const FALLBACK_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"]
/**
 * THE WORD FOR "NO PRINT", AND IT IS STORED.
 *
 * `print_type = 'BLANK'` is how a line says it carries no decoration — the only way, since
 * costPartsOf stopped inferring it from an empty column. Empty now means "nobody has decided",
 * which is what every marketplace line arrives as and what must NOT be priced as a bare
 * garment.
 *
 * Nothing else in the pipeline has to learn the word: methodAddOn finds no surcharge key for
 * it and returns 0, isEmbroidery does not match it, and normalizeMethods leaves it alone.
 */
const BLANK_LABEL = "Blank Only"

const FALLBACK_METHODS = PRODUCT_METHODS.map((m) => m.label)

// The per-line variant picker: Blank · Colour · Size · Method. Marketplace orders arrive
// with these UNSET (nothing to price), so this is what makes them submittable — and a
// listing published from our catalog arrives already resolved by SKU, so it shows the
// blank pre-filled with nothing to do. The chosen Blank drives the Colour/Size/Method
// options. Persisted per line (postItemSetup); the parent reloads so the quote updates.
/** The fields this control can write — the body of `postItemSetup` minus the line key. */
export type ItemSetupPatch = Omit<Parameters<typeof postItemSetup>[1], "line_id" | "sku">


/**
 * EVERY FACE'S METHOD, UNDER ONE DISCLOSURE (owner, 2026-09-23: "however many faces it is,
 * it can still be under one collapsible — that should be the cleanest").
 *
 * Colour and Size really are properties of the whole line. METHOD IS NOT: one shirt can be
 * embroidered on the front and printed on the back, which sideDetail has priced per face for
 * a while and the mini designer has asked per face since it grew its own field. The order row
 * still asked once, for the garment, so the two screens disagreed about what a method even is.
 *
 * WHY A DISCLOSURE AND NOT N FIELDS. A six-face duffel would put six controls on a row that
 * already carries the artwork, the price and the positions. The strip keeps FOUR fields at
 * every face count; the trigger answers the common case without being opened.
 *
 * AND THE TRIGGER NAMES THE METHODS, not "Mixed". A word meaning "look inside" on the one
 * screen where somebody is checking what was ordered hides exactly the answer they came for.
 * "DTG · Embroidery" is the same width and is the answer.
 *
 * THE ROWS ARE THE DESIGNER'S OWN FIELD — same VariantField, same face prefix, same
 * inherit-as-placeholder behaviour — so this is one pattern in two places rather than a third.
 */
function FaceMethodDisclosure({ faces, value, lineMethod, options, disabled, onPick }: {
  faces: string[]
  /** Per face, as stored: "" / absent = INHERIT the line. Never "no method". */
  value: Record<string, string>
  lineMethod: string
  options: string[]
  disabled?: boolean
  onPick: (side: string, v: string) => void
}) {
  const tl = useLabelT()
  /* WHAT THE GARMENT IS ACTUALLY DECORATED WITH — each face resolved through the same rule
     the charge uses (`methodOf.get(face) || lineMethod`), then deduped IN FACE ORDER so the
     summary reads front-first rather than alphabetically. */
  const resolved = faces.map((f) => (value[f] ?? "").trim() || lineMethod).filter(Boolean)
  const distinct = [...new Set(resolved)]
  const summary = distinct.join(" · ")
  return (
    <details className="group col-span-2 min-w-0">
      {/* Same chrome as VariantField's trigger — this is a FIELD (§4: shape says kind), and a
          strip whose fourth control is shaped differently reads as a mistake. */}
      <summary
        className={cn(
          "flex w-full min-w-0 cursor-pointer list-none items-center gap-1.5 rounded-2xl border bg-card px-2.5 text-left font-medium transition-colors",
          "h-9 text-xs hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          disabled ? "cursor-not-allowed opacity-60" : "",
          "border-border",
        )}
      >
        <span className="min-w-0 truncate text-muted-foreground">
          {tl("variantPicker", "Method")}<span className="text-muted-foreground/60"> · </span>
        </span>
        <span className={cn("min-w-0 flex-1 truncate", !summary && "text-muted-foreground")}>
          {summary || tl("variantPicker", "none")}
        </span>
        <CaretDown size={11} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {faces.map((sd) => (
          <VariantField
            key={sd}
            prefix={tl("sides", sd)}
            label={`${tl("sides", sd)} · ${tl("variantPicker", "Method")}`}
            value={value[sd] ?? ""}
            options={options}
            /* AN UNSET FACE SHOWS WHAT IT INHERITS, and when the line has nothing to inherit
               it shows the field's own noun — a question, not an answer. Identical to the
               designer's field; see the note there. */
            placeholder={lineMethod || tl("variantPicker", "Method")}
            clearable={false}
            emptyLabel={lineMethod ? `${lineMethod} (${tl("variantPicker", "from the line")})` : undefined}
            disabled={disabled}
            onChange={(v) => onPick(sd, v)}
          />
        ))}
      </div>
    </details>
  )
}

export function VariantPicker({
  orderId, item, catalog, onSaved, dense, hideMethod, faceMethods,
}: {
  orderId: string
  item: OrderItem
  catalog: CatalogProduct[]
  /**
   * Told WHAT changed, not just that something did.
   *
   * Every caller so far re-fetches the order and re-renders from that, so the argument was
   * unnecessary. The designer cannot: it is opened with a snapshot of the line (`editing`
   * in the order list holds the item captured at click time), so a reload behind it leaves
   * the window showing the garment you just changed away from. It merges the patch locally
   * instead. Optional, so the three existing callers are untouched.
   */
  onSaved: (patch?: ItemSetupPatch) => void
  /**
   * Two per row at EVERY width.
   *
   * The four-track layout below turns on at `sm`, which is a VIEWPORT question — and the
   * designer's rail is a fixed 380px column on a wide screen, so all four tracks were laid
   * out inside it and Size and Method truncated to "S.." and "E...". The breakpoint cannot
   * see the container; the caller can.
   */
  dense?: boolean
  /**
   * DROP THE METHOD FIELD, for a surface that asks the same question better.
   *
   * The design canvas grew a per-FACE type picker — one hoodie is embroidered at the front
   * and printed at the back — and kept this one, so two selects on one screen set what looks
   * to a reader like the same thing. The face field is the sharper of the two: it names the
   * surface it applies to, and its empty state already says what the line's method is and
   * that it is being inherited.
   *
   * A prop rather than deleting the field: this picker is also the order row's, where a line
   * DOES have one method and this is the only place to set it.
   */
  hideMethod?: boolean
  /**
   * PER-FACE METHODS, as stored — "" or absent on a face means it INHERITS the line.
   *
   * Given => the Method slot becomes one disclosure listing every face the blank offers
   * (Option C, owner 2026-09-23). Omitted => the single line-level field, which is right
   * for a caller that has no per-face UI and for a blank with one face.
   *
   * The caller owns the map because it owns the order_designs read: the order page already
   * has one for its positions row, and a second fetch here would be a second answer to a
   * question that is already on screen.
   */
  faceMethods?: Record<string, string> | null
}) {
  const tl = useLabelT()
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
  /**
   * A VALUE THAT DIFFERS ONLY IN CASE IS NOT A DIFFERENT VALUE.
   *
   * `keep` exists so a line never silently loses a value the catalogue no longer lists — it
   * prepends the stored one. But it compared with `includes`, which is exact and
   * case-sensitive, so a line importing "DTG PRINTING" against the canonical "DTG printing"
   * was treated as an unknown value and the menu showed the same technique twice, one of
   * them ticked. The sheet's own dropdown offers the canonical spelling, so this only ever
   * appeared on rows typed or pasted in a different case — which is most of them.
   *
   * `canon` is the display half: the field ticks by exact string equality, so once the
   * duplicate is gone the stored "DTG PRINTING" would match no option and nothing would be
   * ticked. It shows the LIST's spelling instead. Display only — no stored value is
   * rewritten, and nothing is saved unless the person picks something.
   */
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const keep = (value: string, opts: string[]) => (value && !opts.some((o) => same(o, value)) ? [value, ...opts] : opts)
  const canon = (value: string, opts: string[]) => (value ? opts.find((o) => same(o, value)) ?? value : value)
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
  /**
   * THE FACES THIS BLANK OFFERS — `offeredSides`, the one definition (CLAUDE.md §4).
   *
   * Its own ticks, else its configured TYPE, else NULL — and null is "we have not been told",
   * not "front only", so an unanswered product falls back to the single line-level field
   * rather than to a disclosure listing one face. A private array here would be the fifth
   * opinion on this question; the faces case is exactly what that rule was written for.
   */
  const faces = useMemo(() => offeredSides(product) ?? [], [product])
  /**
   * DECLARE A FACE'S METHOD. "" clears it back to inheriting the line.
   *
   * The same call the mini designer makes: artwork is NOT sent, and the server treats a
   * method-only save as a declaration — it leaves any picture already on the face exactly
   * where it is, and charges nothing, because the fee gate is the FILE (`data is not null or
   * storage_key is not null`) and never the method.
   */
  const saveFaceMethod = async (side: string, v: string) => {
    setBusy("faceMethod"); setErr(null)
    try {
      await postOrderDesign(orderId, {
        sku: item.sku || item.name || "",
        line_id: item.line_id ?? undefined,
        side,
        method: v || null,
      })
      /* NO PATCH. `onSaved` carries an optimistic patch for order_items fields; a face's
         method lives on order_designs and changes nothing on the item row itself — the
         caller refetches the designs it already owns. */
      onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't set the method.")
    } finally {
      setBusy(null)
    }
  }
  /**
   * BLANK IS AN OPTION, NOT AN ABSENCE (owner, 2026-09-18).
   *
   * The server prices a line as a bare garment when it names NO method and no face names one
   * (costPartsOf's isBlankLine), taking the size's own `blank` column. Until now the only way
   * to reach that was to clear the field — which is also what "nobody has decided yet" looks
   * like, so the two states were indistinguishable to the person setting them and to anyone
   * reading the line afterwards.
   *
   * Naming it makes the choice sayable. Offered only when this product actually prices a blank
   * for the line's size: a Blank option on a product with no blank price quotes the PRINTED
   * base cost, which is the more expensive kind of wrong.
   */
  const blankPriced = (() => {
    /* THE FACE GATE IS GONE WITH THE RULE IT GUARDED. It existed because costPartsOf's
       isBlankLine required that no placement declare a method — and that branch no longer
       exists: the blank price is the base of EVERY line now, so "Blank Only" changes nothing
       about how the garment is priced. It only records that the line is undecorated.

       Keeping the gate meant the option vanished on any line with a placement method set —
       which is most of them — so the control the owner asked for was invisible on the screens
       where it would be used. A dead guard is worse than no guard: it hides a feature and
       looks like the feature was never built. */
    const tiers = product?.sizePrices ?? []
    if (!tiers.length) return false
    const own = item.size ? tiers.find((t) => t.size === item.size) : null
    return (Number((own ?? tiers[0])?.blank) || 0) > 0
  })()

  // Keep a blank the catalog no longer lists so an existing line can't silently lose it.
  const blankOptions = useMemo(() => {
    const names = catalog.map((p) => productLabel(p)).filter(Boolean)
    return blankLabel && !names.includes(blankLabel) ? [blankLabel, ...names] : names
  }, [catalog, blankLabel])

  /**
   * THE PICTURE, AND THE CODE ON ITS OWN (owner, 2026-09-21: "remove the product name here
   * in the drop down + provide a small image on the start of each row").
   *
   * Every row was `EG-18009 - Unisex Colorblast™ Heavyweight T-Shirt`, and the names run
   * long enough that the list truncated to a column of "EG-180…" — the half that tells two
   * products apart was the half being cut. The thumbnail answers "which garment is this"
   * before any of it is read.
   *
   * DISPLAY ONLY. The option VALUE stays the full `code - name` string, because that is the
   * contract: both resolvers split it, the sheet offers it back, and the NAME half is what
   * lets a line keep resolving after a product is renamed. Shortening what is stored would
   * quietly trade a rename-proof line for a tidier menu.
   */
  const blankThumbs = useMemo(() => {
    const out: Record<string, string> = {}
    for (const p of catalog) {
      const label = productLabel(p)
      if (!label) continue
      const img = bestMockup(p, item.color, "")
      if (img) out[label] = thumbSrc(img, 48)
    }
    return out
  }, [catalog, item.color])
  /* The code-only rule moved to lib/variant-resolve as `blankCode` — the import sheet's
     Blank Product menu now asks the same question, and two copies of it is how the two
     spellings of productLabel drifted before (§5). */
  const codeOnly = blankCode

  const key = item.line_id ? { line_id: item.line_id } : { sku: item.sku }

  const save = async (patch: Parameters<typeof postItemSetup>[1], field: string) => {
    setBusy(field); setErr(null)
    try { await postItemSetup(orderId, { ...key, ...patch }); onSaved(patch) }
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
    /* Case-insensitive for the same reason as above, and it matters more here: an exact
       compare CLEARS a colour the new blank does in fact offer, just spelled differently. */
    const keep = (v: string | undefined, opts: string[]) => {
      const hit = v ? opts.find((o) => o.trim().toLowerCase() === v.trim().toLowerCase()) : null
      return hit ?? ""
    }
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
        {/* THE BLANK TAKES THE WHOLE ROW when the method field has moved out to per-surface
            rows below (the design canvas). It is the longest value on the strip by far —
            "10895 – OL102" plus a product name — and the one that gets truncated when it
            shares a row. With three fields left, giving it the row also leaves colour and
            size an even pair instead of stranding one of them beside a gap.

            PLAIN col-span-2, NOT `col-span-2 sm:col-span-1`. The dense grid is two columns at
            EVERY width — the `sm:` track list only applies when dense is off — so the sm
            override silently handed the row back above 640px, which is every desktop. The
            blank sat half-width beside the colour exactly where it was supposed to own the
            row, and the fix looked applied on a phone and absent on the screen people use. */}
        <VariantField
          label={tl("variantPicker", "Blank")} value={blankLabel} required
          options={blankOptions}
          thumbs={blankThumbs} display={codeOnly}
          className={hideMethod ? "col-span-2" : undefined}
          disabled={busy === "blank"} onChange={pickBlank}
        />
        <VariantField
          label={tl("variantPicker", "Colour")} value={canon(item.color || "", colorList)} options={colorList} swatches
          disabled={busy === "color"} onChange={(v) => save({ color: v }, "color")}
        />
        <VariantField
          label={tl("variantPicker", "Size")} value={canon(item.size || "", sizeList)} options={sizeList}
          disabled={busy === "size"} onChange={(v) => save({ size: v }, "size")}
        />
        {/* Says WHY it is empty rather than just being dead. ONE WORD, not the sentence
            orders/new can afford: this field is a quarter of a four-column strip, so
            "Method · None on this blank" truncated to "Method · …" — which says less than
            nothing, since the reason was the part that got cut. "Method · none" fits. */}
        {/**
          * ONE DISCLOSURE, OR ONE FIELD. A blank with several faces gets every face under the
          * Method slot; anything else keeps the field it always had. `faceMethods` being
          * given is what says the caller can service it — the design canvas hides this
          * control outright, because its own per-face rows follow the stage rail and are the
          * better answer where the garment is on screen.
          */}
        {!hideMethod && faceMethods && faces.length > 1 ? (
          <FaceMethodDisclosure
            faces={faces}
            value={faceMethods}
            lineMethod={String(item.print_type || "").trim()}
            options={methodList}
            disabled={busy === "faceMethod"}
            onPick={(side, v) => void saveFaceMethod(side, v)}
          />
        ) : !hideMethod && (
        <VariantField
          label={tl("variantPicker", "Method")}
          /* EMPTY IS "NOT DECIDED", and shows the placeholder like every other field here. A
             blank is a CHOICE and reads as its own word. */
          value={canon(item.print_type || "", blankPriced ? [BLANK_LABEL, ...methodList] : methodList)}
          /**
           * BLANK ONLY LIVES HERE (owner, 2026-09-21, reversing my own split).
           *
           * I moved it out to a Decoration field of its own, on the argument that "is it
           * printed" and "how" are two questions and a non-technique should not sit among the
           * techniques. The argument is fine and the result was not: the order row went to
           * FIVE fields and wrapped onto a second line, with a Method dropdown holding one
           * option standing next to a whole field holding two.
           *
           * And "not at all" is a real answer to "how is this decorated". The taxonomy was
           * never worth a wrapped row and a second control to learn.
           *
           * FIRST IN THE LIST: somebody scanning techniques for "none of these" finds it at
           * the top, not after Sublimation.
           */
          /* `keep` HAS ALREADY PUT IT THERE. It prepends the line's current value when the
             product's own list does not contain it — and "Blank Only" never is in that list,
             because it is not a technique a product is printed with. Prepending again printed
             it TWICE, both ticked, which is the shape of a menu nobody trusts. Added only when
             it is not already present. */
          options={blankPriced && !methodList.some((m) => same(m, BLANK_LABEL))
            ? [BLANK_LABEL, ...methodList]
            : methodList}
          emptyLabel="none"
          disabled={busy === "printType"}
          /* The clear row writes "", which is "not decided". Picking Blank Only writes the
             word, which is what costPartsOf tests for a bare garment. */
          onChange={(v) => save({ printType: v }, "printType")}
        />
        )}
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
          {tl("variantPicker", "No print method on this blank — set them on the product.")}
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

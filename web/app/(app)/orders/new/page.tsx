"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useMemo, useState } from "react"
import { VariantField } from "@/components/app/variant-field"
import { PRODUCT_METHODS } from "@/lib/print-method"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Plus, CheckCircle, WarningCircle, CircleNotch, Package, X, CaretLeft } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { bestMockup } from "@/lib/variant-resolve"
import { parseBlock } from "@/lib/address-paste"
import { ProductCombobox } from "@/components/app/product-combobox"
import { createOrder, getOrders, validateAddress, type CatalogProduct, type NewOrderItem, type ValidatedAddress } from "@/lib/api"
import { nextOrderId, nextSellerSeq } from "@/lib/order-id"

// Best-effort parse of a pasted US address block → structured fields.
// Last non-empty line is expected as "City, ST 12345" (comma optional).
const zip5 = (z: string) => z.split("-")[0].trim() // USPS ZIPCode wants 5 digits, not ZIP+4

// USPS's Addresses API now gates access behind an approval ("not authorized for
// access to Addresses API"). Validation is optional here — the order saves the
// address as entered — so turn that (and other USPS errors) into a calm note.
function friendlyValidationError(raw?: string): string {
 const s = (raw || "").toLowerCase()
 if (s.includes("addresses api") || s.includes("not authorized") || s.includes("access control")) {
 return "Address check is unavailable right now — you can still save the order as entered."
  }
 return raw || "Couldn't verify this address — you can still save it as entered."
}

type Valid = { kind: "idle" } | { kind: "checking" } | { kind: "ok"; addr: ValidatedAddress } | { kind: "bad"; msg: string }

// colors/sizes are the OPTIONS the picked catalog product offers. Empty (a blank
// item, or a product that defines no variants) → the field stays free text, so you
// can still type anything; populated → it becomes a dropdown of real variants.
// `blank` = the catalog product this line produces on. resolveProduct() keys on it FIRST
// (name/sku/id), so persisting it is what makes the picked product survive to the order
// detail even when the listing sku isn't a catalog VARIANT sku. Without it, only products
// whose sku happens to be a variant sku resolved — the rest lost their blank on save.
// `product` is the catalog row the blank was picked from. It is what makes the picture
// AUTOMATIC: the line's image is resolved from the blank (bestMockup — the mockup for the
// chosen colourway, then the category outline), never uploaded and never waited for. A
// manual order used to open with an empty dashed tile that only a file drop could fill,
// so an order raised without one reached the floor with no picture at all.
type Line = { name: string; sku: string; blank: string; img: string; qty: string; price: string; color: string; size: string; method: string; colors: string[]; sizes: string[]; methods: string[]; product?: CatalogProduct }
const emptyLine = (): Line => ({ name: "", sku: "", blank: "", img: "", qty: "1", price: "", color: "", size: "", method: "", colors: [], sizes: [], methods: [] })

// Variant controls reuse the app's VariantField — the same swatched dropdown the order
// table uses (colour chips, themed menu), instead of a bare native <select>. Method
// options fall back to the standard technique list so a blank item is always PICKED, not
// free-typed.
const METHOD_LABELS = PRODUCT_METHODS.map((m) => m.label)


export default function NewOrderPage() {
  const tl = useLabelT()
 const router = useRouter()
 const [block, setBlock] = useState("")
 const [email, setEmail] = useState("")
 const [valid, setValid] = useState<Valid>({ kind: "idle" })
 const parsed = useMemo(() => parseBlock(block), [block])
 const [lines, setLines] = useState<Line[]>([emptyLine()])
 const [saving, setSaving] = useState(false)
 const [error, setError] = useState<string | null>(null)
  // Existing orders → next per-seller display # (canonical _nextSellerSeq).
 const [existing, setExisting] = useState<Array<{ id?: string; seq?: number | null }>>([])
 useEffect(() => {
 let alive = true
 getOrders()
      .then((rows) => alive && setExisting(rows ?? []))
      .catch(() => {})
 return () => {
 alive = false
    }
  }, [])

  // Live address validation — fires shortly after you stop typing/pasting, so there's no
  // "Validate" button to remember. State is set only inside the deferred timeout (never
  // synchronously in the effect body) to satisfy react-hooks/set-state-in-effect.
 useEffect(() => {
 const p = parsed.addr
 let alive = true
 const t = setTimeout(() => {
 if (!alive) return
 if (!p.street || !p.zip) { setValid({ kind: "idle" }); return }
 setValid({ kind: "checking" })
 validateAddress({
 streetAddress: p.street,
 secondaryAddress: p.street2 || undefined,
 city: p.city,
 state: p.state,
        ZIPCode: zip5(p.zip),
      })
        .then((r) => { if (!alive) return; if (r.ok && r.address) setValid({ kind: "ok", addr: r.address }); else setValid({ kind: "bad", msg: friendlyValidationError(r.error) }) })
        .catch((e) => { if (alive) setValid({ kind: "bad", msg: friendlyValidationError(e instanceof Error ? e.message : "") }) })
    }, 600)
 return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.addr.street, parsed.addr.street2, parsed.addr.city, parsed.addr.state, parsed.addr.zip])


  /**
   * WHAT THE BUYER PAID, TYPED — when the lines do not add up to it.
   *
   * The card printed Σ(sold-for × qty) and nothing else, so an order taken over the phone
   * for a round £120 could only be recorded by reverse-engineering per-unit prices that
   * were never quoted, and a discount, a bundle or a deposit had nowhere to go at all.
   *
   * Blank means "use the lines", which is the old behaviour exactly. Typed WINS, and the
   * card says which of the two it is showing — one number labelled two ways is the fault
   * this card was rewritten to fix, and it would return the moment a typed total sat
   * silently on top of a different sum.
   *
   * Never mandatory: an order whose sale price nobody recorded is a real order, and "not
   * recorded" is a truthful thing for it to say.
   */

 const setLine = (i: number, patch: Partial<Line>) =>
 setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  // The blank's own picture for a colourway, falling back to the catalogue's listing shot.
  // Colour is passed in rather than read off the line because it changes in the same patch.
 const blankImage = (product: CatalogProduct | undefined, color: string, fallback: string) =>
 bestMockup(product ?? null, color, fallback)
 const addLine = () => setLines((prev) => [...prev, emptyLine()])
 const removeLine = (i: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))

  // ONE WAY IN: the Product field's own dropdown. The full-page "Add from catalog" dialog
  // was a second route to the same pick — a modal covering the form you are filling in,
  // to choose the thing the field beside it already chooses inline.

 const canSave = parsed.name.trim() && lines.some((l) => l.name.trim())

 async function onSubmit() {
 setError(null)
 if (!canSave) {
 setError("Add a customer name (first line) and at least one item.")
 return
    }
 setSaving(true)
 try {
 const id = nextOrderId()
 const seq = nextSellerSeq(existing)
 const items: NewOrderItem[] = lines
        .filter((l) => l.name.trim())
        .map((l) => ({
 name: l.name.trim(),
 sku: l.sku || undefined,
 blank: l.blank.trim() || undefined,
 img: l.img || undefined,
 qty: Number(l.qty) || 1,
 unitPrice: Number(l.price) || 0,
 color: l.color.trim() || undefined,
 size: l.size.trim() || undefined,
          // Print method drives production AND pricing (embroidery carries a surcharge),
          // so an order created without one can't be costed or made.
 printType: l.method.trim() || undefined,
        }))
 const fa = valid.kind === "ok" ? valid.addr : parsed.addr
 const hasAddress = !!(fa.street || fa.city)
 const address = hasAddress
        ? {
 name: parsed.name,
 street: fa.street,
 street2: fa.street2,
 city: fa.city,
 state: fa.state,
 zip: fa.zip,
 validated: valid.kind === "ok",
 raw: block.trim(),
          }
 : undefined
 const r = await createOrder({
 id,
 seq,
 source: "manual",
 status: "new",
 customer: { name: parsed.name, email: email.trim() || undefined },
 address,
        // The SALE, not the fulfilment charge — and flagged as deliberately recorded, which
        // is what lets the order page trust it as revenue (a manual order's total is
        // otherwise whatever the create form happened to add up; see the note on `revenue`
        // in orders/[id]). Left unflagged when no price was typed, so "nothing recorded"
        // stays distinguishable from "sold for $0".
        // No sale price is collected here any more, so nothing is claimed about one.
        // retail_set stays UNSET — it is the flag that says "a human typed this", and
        // sending it with a zero would assert the buyer paid nothing.
 total: 0,
 items,
      })
 if (r.error) throw new Error(r.error)
 router.push(`/orders/${encodeURIComponent(id)}`)
    } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't create the order.")
 setSaving(false)
    }
  }

 return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/orders")} className="text-muted-foreground">
          <CaretLeft size={14} weight="bold" /> {tl("newOrder", "Orders")}
        </Button>
        <h1 className="font-title text-2xl font-semibold tracking-tight">{tl("newOrder", "New order")}</h1>
      </div>

      <SectionCard title={tl("newOrder", "Shipping")}>
        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{tl("newOrder", "Name & Address")}</span>
            {/* One paste box, validated live. The status sits INSIDE the box, bottom-right —
 extra bottom padding keeps the last address line clear of it. */}
            <div className="relative">
              <textarea
 value={block}
 onChange={(e) => setBlock(e.target.value)}
 rows={5}
 placeholder={tl("newOrder", "e.g.\nJane Doe\n123 Main St\nSpringfield, IL 62704")}
 className="w-full rounded-md border border-input bg-transparent px-3 pb-8 pt-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <div className="pointer-events-none absolute bottom-2 right-2.5">
                {valid.kind === "checking" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-xs text-muted-foreground">
                    <CircleNotch size={12} className="animate-spin" /> {tl("newOrder", "Checking…")}
                  </span>
                )}
                {valid.kind === "ok" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-xs font-medium text-success">
                    <CheckCircle size={12} weight="fill" /> {tl("newOrder", "Validated")}
                  </span>
                )}
                {valid.kind === "bad" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-xs font-medium text-hold" title={valid.msg}>
                    <WarningCircle size={12} weight="fill" /> {tl("newOrder", "Not validated")}
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{tl("newOrder", "First line is the customer name, then the shipping address (street, then City, ST ZIP).")}</p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{tl("newOrder", "Email (optional)")}</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tl("newOrder", "customer@email.com")} className="max-w-sm" />
          </label>
        </div>
      </SectionCard>

      <SectionCard
 title={tl("newOrder", "Items")}
 actions={
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus size={14} weight="bold" /> {tl("newOrder", "Add item")}
          </Button>
        }
      >
        <div className="divide-y divide-border">
          {lines.map((l, i) => (
            <div key={i} className="relative flex items-start gap-3 px-5 pb-4 pt-8">
              {/* Removing a line is a CORNER action, not a column. As a track it took ~46px
 of width off fields that were already overflowing the row at narrow
 widths — "DTG printing" showed as "DTG printi…", a colourway as "Cam…" —
 and it is used once in a while, unlike the four fields beside it. It sits
 where the image slot already puts its own remove: a small ✕ in the corner. */}
              <button
 type="button"
 onClick={() => removeLine(i)}
 disabled={lines.length === 1}
 aria-label={tl("newOrder", "Remove item")}
 title={tl("newOrder", "Remove item")}
 className="absolute right-3 top-1.5 flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-alert disabled:pointer-events-none disabled:opacity-30"
              >
                <X size={13} weight="bold" />
              </button>
              {/* THE PRODUCT'S OWN PICTURE, and nothing else to do here.
                  This was an upload slot — drag a file in, or click to browse — which put a
 dashed empty square at the head of every line and made the artwork the
 seller's job before the order could look complete. It is the BLANK that
 belongs in this position: the line already knows which one it is, so the
 picture is resolved from it (and re-resolved when the colour changes) and
 the order can be created straight after picking a product. Artwork is
 attached on the order detail, where the placement tools are. */}
              <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30 text-muted-foreground">
                {l.img ? (
                  <Image src={l.img} alt="" fill unoptimized sizes="64px" className="object-cover" />
                ) : (
                  <Package size={20} weight="duotone" className="text-muted-foreground/50" />
                )}
              </div>

              {/* ONE TRACK PER FIELD. There were SIX for five controls — a dead
 78px column left behind by the removed price field, and a third mobile
 track for a second field that isn't there either. Nothing occupied them,
 so they took their share of the row and parked it as blank space at the
 right-hand end: the strip stopped short of the card while Colour showed
 "Ar…" and Method showed "DT…" a few pixels to its left.
                  Now the five fr tracks divide the whole strip. Product keeps the largest
 share (it holds a full product name), Qty is fixed because a quantity is
 two or three digits at any width, and Colour, Size and Method take the
 rest in proportion — with minimums that still add up to less than the
 narrowest card, so the row never overflows at the breakpoint. */}
              {/* `data-field-strip` — the Product list drops to THIS width rather than a
 number of its own, so it lines up with the row it came out of instead of
 ending halfway through Colour. See product-combobox.tsx. */}
              <div data-field-strip className="grid flex-1 grid-cols-[minmax(0,1fr)_60px] items-end gap-2.5 sm:grid-cols-[minmax(150px,1.35fr)_60px_minmax(96px,1fr)_minmax(80px,0.75fr)_minmax(108px,1.05fr)]">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{tl("newOrder", "Product")}</span>
                <ProductCombobox
 value={l.name}
 onText={(v) => setLine(i, { name: v })}
                  // THE ONE PICK. A blank chosen here has to fill the whole line, because
                  // there is no second route to it any more: name, sku, picture, the colour
                  // and size options, and the techniques the blank actually supports.
                  // Dropping `methods` here once left the Method field switched to the
                  // product's own list and that list empty — "None on this blank" for a
                  // product whose catalogue entry plainly says DTG.
 onPick={(p) => setLine(i, {
 name: p.name, sku: p.sku, blank: p.name, product: p.product,
                    // THE PICTURE COMES WITH THE BLANK. `p.img` is the catalogue's listing
                    // shot; the mockup for the colourway we are about to make is the better
                    // one, so bestMockup is asked first and p.img is only its fallback.
 img: blankImage(p.product, p.color, p.img),
                    // NO PRICE PREFILL. This column is what the BUYER paid (order_items.
                    // unit_price — the same field the CSV template calls "Item Price" and
                    // documents as "records only; it does NOT set the fulfilment charge").
                    // It was being filled with the blank's BASE COST, which is what we
                    // charge the seller — so the order page then reported our own charge
                    // back to them as "Customer paid", and every manual order's estimated
                    // profit was arithmetic on one number labelled two ways.
 color: p.color, size: p.sizes[0] ?? "", colors: p.colors, sizes: p.sizes,
 methods: p.methods ?? [],
                    // One technique is not a choice — pre-select it, as applyPick does.
 method: (p.methods ?? []).length === 1 ? p.methods[0] : "",
                  })}
 placeholder={tl("newOrder", "e.g. Classic Tee")}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{tl("newOrder", "Qty")}</span>
                <Input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^0-9]/g, "") })} className="h-9" inputMode="numeric" />
              </label>
              <label className="hidden flex-col gap-1 sm:flex">
                <span className="text-xs text-muted-foreground">{tl("newOrder", "Color")}</span>
                {l.colors.length > 0 ? (
                  // The mockup is per-colourway, so the picture follows the choice.
                  <VariantField compact swatches className="h-9 text-xs" label={tl("newOrder", "Color")} value={l.color} options={l.colors} onChange={(v) => setLine(i, { color: v, img: blankImage(l.product, v, l.img) })} placeholder={tl("newOrder", "Color")} />
                ) : (
                  <Input value={l.color} onChange={(e) => setLine(i, { color: e.target.value })} className="h-9" placeholder={tl("newOrder", "Color")} />
                )}
              </label>
              <label className="hidden flex-col gap-1 sm:flex">
                <span className="text-xs text-muted-foreground">{tl("newOrder", "Size")}</span>
                {l.sizes.length > 0 ? (
                  <VariantField compact className="h-9 text-xs" label={tl("newOrder", "Size")} value={l.size} options={l.sizes} onChange={(v) => setLine(i, { size: v })} placeholder={tl("newOrder", "Size")} />
                ) : (
                  <Input value={l.size} onChange={(e) => setLine(i, { size: e.target.value })} className="h-9" placeholder={tl("newOrder", "Size")} />
                )}
              </label>
              <label className="hidden flex-col gap-1 sm:flex">
                <span className="text-xs text-muted-foreground">{tl("newOrder", "Method")}</span>
                {/* EXACTLY WHAT THE BLANK OFFERS, once a blank has been picked.
                    It used to fall back to the full standard list whenever the product
 declared none, so a blank that supports embroidery only could be ordered
 as DTG — an option the catalogue never claimed, priced by a surcharge
 that may not exist, and unmakeable on the floor. A product that lists no
 technique is a gap in the product, and the honest thing is to say so
 rather than to fill it in with all eight.
                    The standard list still stands in for a line with NO blank picked, where
 there is no product to contradict — the same rule Colour and Size follow
 by falling back to free text. */}
                <VariantField
 compact className="h-9 text-xs" label={tl("newOrder", "Method")} value={l.method}
 options={l.blank ? l.methods : METHOD_LABELS}
 emptyLabel="None on this blank"
 onChange={(v) => setLine(i, { method: v })} placeholder={tl("newOrder", "Method")}
                />
              </label>
              </div>
            </div>
          ))}
        </div>
        {/* NO SALE PRICE ON THIS FORM.
            "Sold for" per line and "Customer paid" for the order both recorded what the
            BUYER paid — our records, never a charge; the fulfilment quote is computed at
 submit from the blank, the size and the technique, and is unaffected by their
 absence. They are gone at the owner's request: a manual order is raised to get
 something made, and being asked for the retail figure first is friction in the
 way of that.
            THE CONSEQUENCE, so nobody rediscovers it: a manual order now carries no
 revenue, so profit reporting has cost and no sale for these lines. `total` is
 sent as 0 and `retail_set` is not claimed, which is the honest shape — reports
 can tell "nobody recorded it" from "it sold for nothing". */}
      </SectionCard>

      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/orders")}>
          {tl("newOrder", "Cancel")}
        </Button>
        <Button onClick={onSubmit} disabled={saving || !canSave}>
          {saving ? tl("newOrder", "Creating…") : tl("newOrder", "Create order")}
        </Button>
      </div>

    </div>
  )
}

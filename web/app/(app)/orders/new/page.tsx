"use client"

import { useEffect, useMemo, useState } from "react"
import { VariantField } from "@/components/app/variant-field"
import { PRODUCT_METHODS } from "@/lib/print-method"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Plus, CheckCircle, WarningCircle, CircleNotch, Package, X } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProductPickerDialog, type PickedProduct } from "@/components/app/product-picker-dialog"
import { parseBlock } from "@/lib/address-paste"
import { ProductCombobox } from "@/components/app/product-combobox"
import { createOrder, getOrders, validateAddress, type NewOrderItem, type ValidatedAddress } from "@/lib/api"
import { nextOrderId, nextSellerSeq } from "@/lib/order-id"
import { orderTotal } from "@/lib/pricing"

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
type Line = { name: string; sku: string; blank: string; img: string; qty: string; price: string; color: string; size: string; method: string; colors: string[]; sizes: string[]; methods: string[] }
const emptyLine = (): Line => ({ name: "", sku: "", blank: "", img: "", qty: "1", price: "", color: "", size: "", method: "", colors: [], sizes: [], methods: [] })

// Variant controls reuse the app's VariantField — the same swatched dropdown the order
// table uses (colour chips, themed menu), instead of a bare native <select>. Method
// options fall back to the standard technique list so a blank item is always PICKED, not
// free-typed.
const METHOD_LABELS = PRODUCT_METHODS.map((m) => m.label)

const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function NewOrderPage() {
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

  // Canonical order total: Σ(unit × qty) + first-item/additional shipping.
  const pricing = useMemo(
    () =>
      orderTotal(
        lines
          .filter((l) => l.name.trim())
          .map((l) => ({ qty: Number(l.qty) || 1, unitPrice: Number(l.price) || 0, size: l.size })),
        []
      ),
    [lines]
  )

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
  const [paidTyped, setPaidTyped] = useState("")
  const paidValue = paidTyped.trim() === "" ? pricing.subtotal : Number(paidTyped) || 0
  const paidIsTyped = paidTyped.trim() !== ""

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (i: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))

  // Catalog picker — pickerTarget is the line index to fill, or null to append a new line.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<number | null>(null)
  const openPicker = (target: number | null) => {
    setPickerTarget(target)
    setPickerOpen(true)
  }
  const applyPick = (p: PickedProduct) => {
    const patch: Partial<Line> = {
      name: p.name,
      sku: p.sku,
      blank: p.name,
      img: p.img,
      // No price prefill — see the note on the inline combobox's onPick. This column is
      // the buyer's money; the blank's base cost is ours to quote.
      color: p.color,
      size: p.sizes[0] ?? "",
      colors: p.colors,
      sizes: p.sizes,
      methods: p.methods ?? [],
      method: (p.methods ?? []).length === 1 ? p.methods[0] : "",
    }
    if (pickerTarget == null) setLines((prev) => [...prev, { ...emptyLine(), ...patch }])
    else setLine(pickerTarget, patch)
  }

  // Drop / choose an image for a line (optional — can be added later on the order detail).
  const setLineImage = (i: number, file?: File | null) => {
    if (!file || !file.type.startsWith("image/")) return
    if (file.size > 8 * 1024 * 1024) {
      setError("Image is over 8MB — please compress it.")
      return
    }
    const reader = new FileReader()
    reader.onload = () => setLine(i, { img: String(reader.result || "") })
    reader.readAsDataURL(file)
  }
  const [dragLine, setDragLine] = useState<number | null>(null)

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
        total: paidValue,
        meta: paidValue > 0 ? { retail_set: true } : undefined,
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
          Orders
        </Button>
        <h1 className="font-title text-2xl font-semibold tracking-tight">New order</h1>
      </div>

      <SectionCard title="Shipping">
        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name &amp; Address</span>
            {/* One paste box, validated live. The status sits INSIDE the box, bottom-right —
                extra bottom padding keeps the last address line clear of it. */}
            <div className="relative">
              <textarea
                value={block}
                onChange={(e) => setBlock(e.target.value)}
                rows={5}
                placeholder={"e.g.\nJane Doe\n123 Main St\nSpringfield, IL 62704"}
                className="w-full rounded-md border border-input bg-transparent px-3 pb-8 pt-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <div className="pointer-events-none absolute bottom-2 right-2.5">
                {valid.kind === "checking" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-2xs text-muted-foreground">
                    <CircleNotch size={12} className="animate-spin" /> Checking…
                  </span>
                )}
                {valid.kind === "ok" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-2xs font-medium text-success">
                    <CheckCircle size={12} weight="fill" /> Validated
                  </span>
                )}
                {valid.kind === "bad" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-2xs font-medium text-amber-600" title={valid.msg}>
                    <WarningCircle size={12} weight="fill" /> Not validated
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">First line is the customer name, then the shipping address (street, then City, ST ZIP).</p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Email (optional)</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@email.com" className="max-w-sm" />
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title="Items"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => openPicker(null)}>
              Add from catalog
            </Button>
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus size={14} weight="bold" /> Blank item
            </Button>
          </div>
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
                aria-label="Remove item"
                title="Remove item"
                className="absolute right-3 top-1.5 flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-red-600 disabled:pointer-events-none disabled:opacity-30"
              >
                <X size={13} weight="bold" />
              </button>
              {/* Image slot — drag-drop / click to upload, or pick from catalog. Optional. */}
              <label
                onDragOver={(e) => { e.preventDefault(); setDragLine(i) }}
                onDragLeave={() => setDragLine((d) => (d === i ? null : d))}
                onDrop={(e) => { e.preventDefault(); setDragLine(null); setLineImage(i, e.dataTransfer.files?.[0]) }}
                title="Drop or click to add an image"
                className={
                  "group relative flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border text-muted-foreground transition-colors " +
                  (dragLine === i ? "border-primary bg-primary/5" : "border-dashed border-border hover:bg-accent")
                }
              >
                {l.img ? (
                  <>
                    <Image src={l.img} alt="" fill unoptimized sizes="64px" className="object-cover" />
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setLine(i, { img: "" }) }}
                      className="absolute right-0.5 top-0.5 z-10 flex size-4 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Remove image"
                    >
                      <X size={9} weight="bold" />
                    </button>
                  </>
                ) : (
                  <Package size={20} weight="duotone" className="text-muted-foreground/50" />
                )}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => setLineImage(i, e.target.files?.[0])} />
              </label>

              {/* The blank is the most important control on the line — it drives price,
                  production and the stock barcode — so it gets the flexible column and
                  everything else is sized to its content. Method was as wide as Product
                  while holding one short word.
                  The trailing `auto` track was the delete button; with it lifted to the
                  row's corner that width goes back to Colour, Size and Method — the three
                  that were clipping ("DTG printi…"). The MINIMUMS still add up to less
                  than before (652px of track vs 660px): raising them instead would push
                  the grid past the card at the breakpoint, which is what was cutting the
                  strip off on the right to begin with. */}
              <div className="grid flex-1 grid-cols-[minmax(0,1fr)_60px_80px] items-end gap-2.5 sm:grid-cols-[minmax(170px,1.2fr)_60px_78px_minmax(108px,1.1fr)_minmax(70px,0.65fr)_minmax(116px,1.15fr)]">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Product</span>
                <ProductCombobox
                  value={l.name}
                  onText={(v) => setLine(i, { name: v })}
                  // Picking here and picking from "Add from catalog" must land the SAME
                  // line. This one dropped `methods`, so choosing a blank in the row set
                  // `blank` — which switches the Method field from the standard list to the
                  // product's own — while leaving that list empty. The result read "None on
                  // this blank" for a product whose catalogue entry plainly says DTG, and
                  // the identical product picked through the dialog offered it fine.
                  onPick={(p) => setLine(i, {
                    name: p.name, sku: p.sku, blank: p.name, img: p.img,
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
                  onBrowse={() => openPicker(i)}
                  placeholder="e.g. Classic Tee"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Qty</span>
                <Input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^0-9]/g, "") })} className="h-9" inputMode="numeric" />
              </label>
              {/* "Sold for", not "Price" — one word decides which pot of money this is,
                  and the ambiguous one is why the blank's base cost was being typed (and
                  prefilled) here and read back as the buyer's payment. Optional: an order
                  with nothing here is one whose sale price nobody recorded. */}
              <label className="flex flex-col gap-1" title="What the buyer paid per unit — your records. It does not set what we charge to make this; that is quoted on the order.">
                <span className="text-xs text-muted-foreground">Sold for</span>
                <Input value={l.price} onChange={(e) => setLine(i, { price: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="—" className="h-9" inputMode="decimal" />
              </label>
              <label className="hidden flex-col gap-1 sm:flex">
                <span className="text-xs text-muted-foreground">Color</span>
                {l.colors.length > 0 ? (
                  <VariantField compact swatches className="h-9 text-xs" label="Color" value={l.color} options={l.colors} onChange={(v) => setLine(i, { color: v })} placeholder="Color" />
                ) : (
                  <Input value={l.color} onChange={(e) => setLine(i, { color: e.target.value })} className="h-9" placeholder="Color" />
                )}
              </label>
              <label className="hidden flex-col gap-1 sm:flex">
                <span className="text-xs text-muted-foreground">Size</span>
                {l.sizes.length > 0 ? (
                  <VariantField compact className="h-9 text-xs" label="Size" value={l.size} options={l.sizes} onChange={(v) => setLine(i, { size: v })} placeholder="Size" />
                ) : (
                  <Input value={l.size} onChange={(e) => setLine(i, { size: e.target.value })} className="h-9" placeholder="Size" />
                )}
              </label>
              <label className="hidden flex-col gap-1 sm:flex">
                <span className="text-xs text-muted-foreground">Method</span>
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
                  compact className="h-9 text-xs" label="Method" value={l.method}
                  options={l.blank ? l.methods : METHOD_LABELS}
                  emptyLabel="None on this blank"
                  onChange={(v) => setLine(i, { method: v })} placeholder="Method"
                />
              </label>
              </div>
            </div>
          ))}
        </div>
        {/* TWO POTS OF MONEY, AND THIS FORM ONLY HOLDS ONE.
            It read "Subtotal / Shipping / Total" — Σ(item price × qty) plus OUR fulfilment
            shipping fee — which quietly added the buyer's money to our charge and called
            the sum a total. Nothing is billed off it either: the charge is the quote at
            submit, computed from the blank, the size and the technique. So the card states
            the sale, and says where the other number comes from. */}
        <div className="space-y-1.5 border-t border-border px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 font-semibold">
            <span>Customer paid</span>
            <span className="flex items-center gap-2">
              {/* The sum of the lines is the PLACEHOLDER, so leaving this alone keeps the
                  old behaviour and typing in it is visibly an override rather than a
                  correction of something. "not recorded" when there is nothing either way. */}
              <span className="text-sm font-normal text-muted-foreground">$</span>
              <Input
                value={paidTyped}
                onChange={(e) => setPaidTyped(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder={pricing.subtotal > 0 ? pricing.subtotal.toFixed(2) : "not recorded"}
                inputMode="decimal"
                aria-label="What the customer paid for this order"
                className="h-9 w-32 text-right text-base tabular-nums"
              />
            </span>
          </div>
          {paidIsTyped && pricing.subtotal > 0 && Math.abs(paidValue - pricing.subtotal) >= 0.01 && (
            // SAID OUT LOUD, because the two numbers disagree and only one is being saved.
            // Silence here is how a discount becomes a bug report.
            <p className="text-xs text-muted-foreground">
              The lines add up to {usd(pricing.subtotal)}; {usd(paidValue)} is recorded.
            </p>
          )}
        </div>
      </SectionCard>

      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/orders")}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={saving || !canSave}>
          {saving ? "Creating…" : "Create order"}
        </Button>
      </div>

      <ProductPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={applyPick} />
    </div>
  )
}

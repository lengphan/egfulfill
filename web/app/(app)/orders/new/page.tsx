"use client"

import { useEffect, useMemo, useState } from "react"
import { VariantField } from "@/components/app/variant-field"
import { PRODUCT_METHODS } from "@/lib/print-method"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ArrowLeft, Plus, Trash, CheckCircle, WarningCircle, Package, Storefront, X } from "@phosphor-icons/react"
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
type Line = { name: string; sku: string; img: string; qty: string; price: string; color: string; size: string; method: string; colors: string[]; sizes: string[]; methods: string[] }
const emptyLine = (): Line => ({ name: "", sku: "", img: "", qty: "1", price: "", color: "", size: "", method: "", colors: [], sizes: [], methods: [] })

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

  async function onValidate() {
    const p = parsed.addr
    if (!p.street || !p.zip) {
      setValid({ kind: "bad", msg: "Add a name, a street line, and a City, ST ZIP line." })
      return
    }
    setValid({ kind: "checking" })
    try {
      const r = await validateAddress({
        streetAddress: p.street,
        secondaryAddress: p.street2 || undefined,
        city: p.city,
        state: p.state,
        ZIPCode: zip5(p.zip),
      })
      if (r.ok && r.address) setValid({ kind: "ok", addr: r.address })
      else setValid({ kind: "bad", msg: friendlyValidationError(r.error) })
    } catch (e) {
      setValid({ kind: "bad", msg: friendlyValidationError(e instanceof Error ? e.message : "") })
    }
  }

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
      img: p.img,
      price: p.price ? String(p.price) : "",
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
        total: pricing.total,
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
          <ArrowLeft size={16} weight="bold" /> Orders
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">New order</h1>
      </div>

      <SectionCard title="Shipping">
        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Name &amp; Address</span>
              {valid.kind === "ok" && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <CheckCircle size={14} weight="fill" /> Validated
                </span>
              )}
              {valid.kind === "bad" && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600" title={valid.msg}>
                  <WarningCircle size={14} weight="fill" /> Not validated
                </span>
              )}
            </div>
            <textarea
              value={block}
              onChange={(e) => {
                setBlock(e.target.value)
                setValid({ kind: "idle" })
              }}
              rows={5}
              placeholder={"e.g.\nJane Doe\n123 Main St\nSpringfield, IL 62704"}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={onValidate} disabled={valid.kind === "checking" || !parsed.addr.street}>
                {valid.kind === "checking" ? "Checking…" : "Validate address"}
              </Button>
              {valid.kind === "ok" && (
                <span className="truncate text-xs text-emerald-600">
                  {[valid.addr.street, valid.addr.street2, valid.addr.city, valid.addr.state, `${valid.addr.zip}${valid.addr.zip4 ? "-" + valid.addr.zip4 : ""}`].filter(Boolean).join(", ")}
                </span>
              )}
              {valid.kind === "bad" && <span className="truncate text-xs text-amber-600">{valid.msg}</span>}
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
              <Storefront size={14} weight="bold" /> Add from catalog
            </Button>
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus size={14} weight="bold" /> Blank item
            </Button>
          </div>
        }
      >
        <div className="divide-y divide-border">
          {lines.map((l, i) => (
            <div key={i} className="flex items-start gap-3 px-5 py-4">
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
                  while holding one short word. */}
              <div className="grid flex-1 grid-cols-[minmax(0,1fr)_60px_80px_auto] items-end gap-2.5 sm:grid-cols-[minmax(220px,1.6fr)_64px_84px_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_auto]">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Product</span>
                <ProductCombobox
                  value={l.name}
                  onText={(v) => setLine(i, { name: v })}
                  onPick={(p) => setLine(i, {
                    name: p.name, sku: p.sku, img: p.img,
                    price: p.price ? String(p.price) : "",
                    color: p.color, size: p.sizes[0] ?? "", colors: p.colors, sizes: p.sizes,
                  })}
                  onBrowse={() => openPicker(i)}
                  placeholder="e.g. Classic Tee"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Qty</span>
                <Input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^0-9]/g, "") })} className="h-9" inputMode="numeric" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Price</span>
                <Input value={l.price} onChange={(e) => setLine(i, { price: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" className="h-9" inputMode="decimal" />
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
                {/* Always a dropdown: the product's own methods if any, else the standard
                    technique list — a blank item is picked, never free-typed. */}
                <VariantField compact className="h-9 text-xs" label="Method" value={l.method} options={l.methods.length ? l.methods : METHOD_LABELS} onChange={(v) => setLine(i, { method: v })} placeholder="Method" />
              </label>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeLine(i)}
                disabled={lines.length === 1}
                className="text-muted-foreground hover:text-red-600"
                aria-label="Remove item"
              >
                <Trash size={15} weight="bold" />
              </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5 border-t border-border px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{usd(pricing.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Shipping</span>
            <span className="tabular-nums">{usd(pricing.shipping)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1.5 font-semibold">
            <span>Total</span>
            <span className="text-lg tabular-nums">{usd(pricing.total)}</span>
          </div>
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

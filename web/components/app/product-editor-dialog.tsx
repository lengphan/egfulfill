"use client"

import { useEffect, useMemo, useState } from "react"
import { UploadSimple, Image as ImageIcon, X, Plus, Sparkle, Tag, Check } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readImageFile } from "@/components/app/design-canvas"
import { setTypeMockups, typeMockupOf } from "@/lib/variant-resolve"
import { getFactorySettings, type CatalogProduct, type FactorySettings, type ProductType } from "@/lib/api"
import { prettyColorName } from "@/lib/color-name"
import { normTech, normalizeMethods, PRODUCT_METHODS } from "@/lib/print-method"
import { descriptionToText, looksLikeHtml } from "@/lib/description"

// Sourced from lib/print-method.ts so the picker, the normaliser and the pricing
// surcharges cannot drift apart again.
const METHODS = PRODUCT_METHODS.map((m) => m.label)
// Fallback only — the real list is managed in Settings → Platform. Used until settings
// load, and if the platform has never saved a list.
const TYPES = ["Apparel", "Headwear", "Bags", "Drinkware", "Accessories", "Other"]
// The full run we can offer, not just the common six. 4XL/5XL are real apparel sizes and
// OS/OSFM is how headwear and one-size goods are sized — leaving them out meant a product
// that needed one couldn't be built here at all. Sizes the SUPPLIER sent are merged in on
// top of this (see sizeSuggestions), so an S&S or Otto style brings its own vocabulary.
const SUGGESTED_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS", "OSFM - Adult", "OSFM - Youth"]
/** Seeded on a NEW product — the standard run, S through 3XL. Deletable per product. */
const DEFAULT_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"]
const SUGGESTED_COLORS = ["Black", "White", "Navy", "Sand", "Heather Grey", "Red", "Royal", "Forest", "Maroon", "Charcoal"]

const imageOf = (p: CatalogProduct) => p.img || p.image || p.hero || p.images?.[0] || (p.colorImages ? Object.values(p.colorImages).find(Boolean) || "" : "") || ""
const genId = (seed: number) => "PROD-" + seed.toString(36).toUpperCase()
const num = (v: unknown) => (v == null || v === "" ? NaN : Number(v))

// The stored sizePrices ARRAY ([{size, price, shipping}] — the canonical shape from
// eg-products.js) → editable strings keyed by size, for the inputs below.
type Tier = { price: string; shipping: string; cost: string }
function tiersToStr(v: CatalogProduct["sizePrices"]): Record<string, Tier> {
  const out: Record<string, Tier> = {}
  if (!Array.isArray(v)) return out
  for (const t of v) {
    if (!t || t.size == null) continue
    out[String(t.size)] = {
      price: t.price != null && isFinite(Number(t.price)) ? String(Number(t.price)) : "",
      shipping: t.shipping != null && isFinite(Number(t.shipping)) ? String(Number(t.shipping)) : "",
      cost: t.cost != null && isFinite(Number(t.cost)) ? String(Number(t.cost)) : "",
    }
  }
  return out
}

// Editable strings → the canonical array. Mirrors npmCollectPriceTiers: a tier needs a
// size AND a price > 0 to exist at all; shipping is optional and stays null when blank.
// Drops sizes the product no longer offers — a stale 3XL tier is just a trap.
function strToTiers(map: Record<string, Tier>, keep: string[]): CatalogProduct["sizePrices"] {
  const out: NonNullable<CatalogProduct["sizePrices"]> = []
  for (const size of keep) {
    const t = map[size]
    if (!t) continue
    const price = Number(t.price)
    const cost = Number(t.cost)
    const hasPrice = t.price.trim() !== "" && isFinite(price) && price > 0
    const hasCost = t.cost.trim() !== "" && isFinite(cost) && cost > 0
    // A tier now exists if EITHER number is present: product cost alone is enough,
    // because pricing derives the base cost from it plus the markup.
    if (!hasPrice && !hasCost) continue
    const ship = t.shipping.trim() === "" ? null : Number(t.shipping)
    out.push({
      size,
      price: hasPrice ? price : 0,
      cost: hasCost ? cost : null,
      shipping: ship != null && isFinite(ship) && ship >= 0 ? ship : null,
    })
  }
  return out.length ? out : undefined
}

// Create/edit one catalog product. Colors/sizes are chips (with supplier-suggested picks),
// pricing shows the live margin, and supplier-derived blanks pre-fill description + cost.
export function ProductEditorDialog({
  open, onOpenChange, product, onSave, newIdSeed, title, ctaLabel,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  product: CatalogProduct | null
  onSave: (p: CatalogProduct) => void
  newIdSeed: number
  /** Override the heading/CTA. A supplier import passes a product that does NOT exist
   *  yet, so the defaults ("Edit product" / "Save changes") would misdescribe it. */
  title?: string
  ctaLabel?: string
}) {
  const [name, setName] = useState("")
  const [type, setType] = useState("Apparel")
  // Managed types + their category mockups.
  const [types, setTypes] = useState<ProductType[]>([])
  /**
   * The product's image gallery. Everything a supplier gave us plus anything uploaded —
   * previously only the hero survived, so extraImages and per-colour images were fetched
   * and thrown away the moment a product was added.
   */
  const [gallery, setGallery] = useState<string[]>([])
  /** colour → which gallery image represents it. */
  const [colorImgs, setColorImgs] = useState<Record<string, string>>({})
  /**
   * Per-side outline OVERRIDES for this product. Empty means "inherit the type's" —
   * a factory board can override what admin defined in Settings, but a product that
   * hasn't been overridden keeps following settings, so changing a category updates
   * everything that never disagreed with it.
   */
  const [sideMockups, setSideMockups] = useState<Record<string, string>>({})
  useEffect(() => {
    const t = setTimeout(() => { getFactorySettings().then((r) => { const t = r.product_types ?? []; setTypes(t); setTypeMockups(t) }).catch(() => {}) }, 0)
    return () => clearTimeout(t)
  }, [])
  const typeNames = types.length ? types.map((t) => t.name) : TYPES
  /** The category's stand-in mockup, used when this product has none of its own. */
  const typeMockup = types.find((t) => t.name === type)?.mockup ?? null
  const typeSides = types.find((t) => t.name === type)?.sides ?? []
  const [method, setMethod] = useState("DTG")
  const [price, setPrice] = useState("")
  const [basePrice, setBasePrice] = useState("")
  const [shipping, setShipping] = useState("")
  const [desc, setDesc] = useState("")
  const [sizes, setSizes] = useState<string[]>([])
  const [colors, setColors] = useState<string[]>([])
  // Per-size price tiers, held as strings so a half-typed "12." doesn't round-trip
  // through Number and fight the input. Empty = no override for that size.
  const [tiers, setTiers] = useState<Record<string, Tier>>({})
  const [colorInput, setColorInput] = useState("")
  const [status, setStatus] = useState("Active")
  const [img, setImg] = useState("")
  const [err, setErr] = useState<string | null>(null)
  /** Highlight the well while a file is over it — without feedback a drop target is
   *  indistinguishable from dead space, which is how this read before it accepted drops. */
  const [dropping, setDropping] = useState(false)
  /** Index being dragged while reordering the gallery. */
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  /** One path for every way an image arrives — drop, paste, or the file input. Non-images
   *  are ignored rather than erroring, because dragging a folder or a PDF onto a picture
   *  well is a slip, not a request. */
  const addImageFiles = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"))
    if (!imgs.length) return
    imgs.forEach((f) => readImageFile(f, (u) => {
      setGallery((g) => (g.includes(u) ? g : [...g, u]))
      // First picture in becomes the main one, so the commonest case needs no extra click.
      setImg((cur) => cur || u)
    }, setErr))
  }

  useEffect(() => {
    if (!open) return
    const p = product
    const id = setTimeout(() => {
      setName(p?.name ?? "")
      setType(p?.type ?? "Apparel")
      setMethod(p?.method ?? "DTG")
      setPrice(p?.price != null ? String(p.price) : "")
      setBasePrice(p?.basePrice != null ? String(p.basePrice) : p?.base_price != null ? String(p.base_price) : "")
      setShipping(p?.shippingFee != null ? String(p.shippingFee) : p?.shipping_fee != null ? String(p.shipping_fee) : "")
      // Supplier feeds send HTML fragments (<p><strong>95% Cotton…</strong></p>), which
      // rendered as literal tags in this textarea. Flatten to one feature per line.
      setDesc(looksLikeHtml(p?.description) ? descriptionToText(p?.description) : (p?.description ?? ""))
      // A NEW product starts with the standard run seeded, so the per-size pricing table
      // is there to fill in rather than something you have to discover by adding sizes
      // first. Editing an EXISTING product keeps exactly what it has — seeding there
      // would silently re-add sizes someone had deliberately removed.
      setSizes(p ? (p.sizes ?? []) : DEFAULT_SIZES)
      setTiers(tiersToStr(p?.sizePrices))
      setColors(p?.colorImages ? Object.keys(p.colorImages) : p?.mainColor ? [p.mainColor] : [])
      // Collect every image we know about — hero, gallery, per-colour — de-duped, so
      // nothing a supplier sent is dropped just because it wasn't the main shot.
      setGallery(Array.from(new Set([
        p?.img, p?.image, p?.hero,
        ...(p?.images ?? []),
        ...Object.values(p?.colorImages ?? {}),
      ].filter((x): x is string => !!x))))
      setColorImgs({ ...((p?.colorImages ?? {}) as Record<string, string>) })
      setSideMockups({ ...((p?.side_mockups ?? p?.sideMockups ?? {}) as Record<string, string>) })
      setStatus(p?.status ?? "Active")
      setImg(p ? imageOf(p) : "")
      setColorInput("")
      setErr(null)
    }, 0)
    return () => clearTimeout(id)
  }, [open, product])

  // Suggestions = supplier's real options first (from the derived blank), then common picks.
  const colorSuggestions = useMemo(() => {
    const fromProduct = product?.colorImages ? Object.keys(product.colorImages) : []
    return Array.from(new Set([...fromProduct, ...SUGGESTED_COLORS])).filter((c) => !colors.includes(c)).slice(0, 12)
  }, [product, colors])
  const sizeSuggestions = useMemo(() => {
    const fromProduct = product?.sizes ?? []
    return Array.from(new Set([...fromProduct, ...SUGGESTED_SIZES])).filter((s) => !sizes.includes(s))
  }, [product, sizes])

  const addColor = (c: string) => {
    const v = c.trim()
    if (v && !colors.some((x) => x.toLowerCase() === v.toLowerCase())) setColors((p) => [...p, v])
    setColorInput("")
  }
  const supplier = product?.supplier

  // Platform pricing policy: the per-method surcharge and the flat shipping band. Loaded
  // so the editor can PREFILL a sensible retail price rather than leaving the seller to
  // work out cost + surcharge in their head.
  const [fees, setFees] = useState<FactorySettings | null>(null)
  // The markup that turns a supplier's product cost into the base cost we charge.
  // Same number pricing.js uses, so the preview in the size table matches the quote.
  // The methods currently ticked, read back out of the joined `method` string through the
  // same normaliser the rest of the app uses — so a product imported with
  // "DTG Print / Embroidery" shows both ticked rather than neither.
  const pickedMethods = useMemo(
    () => normalizeMethods([method]).map((m) => m.label).filter((m) => METHODS.includes(m)),
    [method]
  )
  const markup = Number(fees?.base_markup) || 0
  useEffect(() => {
    const id = setTimeout(() => { getFactorySettings().then(setFees).catch(() => {}) }, 0)
    return () => clearTimeout(id)
  }, [])

  // Which flat shipping band this product falls in — mirrors shippingBandOf() on the
  // server, matched on substrings because catalog types are loose.
  const bandKey = (() => {
    const t = `${type} ${name}`.toLowerCase()
    if (/cap|hat|beanie|visor|headwear|trucker/.test(t)) return "ship_cap"
    if (/hoodie|hooded|sweatshirt|sweater|crewneck|jacket|coat|pullover|fleece/.test(t)) return "ship_heavy"
    return "ship_garment"
  })()
  const bandFee = fees?.[bandKey]
  const methodKey = "method_" + (normTech(method)?.key ?? "dtg")
  const surcharge = fees?.[methodKey] ?? 0

  // Prefill retail = base cost + method surcharge, but ONLY until the seller types their
  // own price. Recomputing after that would overwrite a deliberate figure on every
  // keystroke elsewhere in the form.
  const [priceTouched, setPriceTouched] = useState(false)
  useEffect(() => {
    if (priceTouched || !fees) return
    const base = Number(basePrice)
    if (!isFinite(base) || base <= 0) return
    const id = setTimeout(() => setPrice(String(Math.round((base + surcharge) * 100) / 100)), 0)
    return () => clearTimeout(id)
  }, [basePrice, surcharge, fees, priceTouched])

  // Live margin readout.
  const retail = num(price), cost = num(basePrice), ship = num(shipping)
  const profit = !isNaN(retail) ? retail - (isNaN(cost) ? 0 : cost) - (isNaN(ship) ? 0 : ship) : NaN
  const marginPct = !isNaN(profit) && retail > 0 ? Math.round((profit / retail) * 100) : NaN

  const save = () => {
    if (!name.trim()) { setErr("Give the product a name."); return }
    const colorImages: Record<string, string> = {}
    for (const c of colors) colorImages[c] = colorImgs[c] || ""
    const next: CatalogProduct = {
      ...(product ?? {}),
      id: product?.id ?? genId(newIdSeed),
      name: name.trim(),
      type, method, status,
      price: Number(price) || 0,
      basePrice: Number(basePrice) || Number(price) || 0,
      shippingFee: shipping.trim() === "" ? undefined : Number(shipping) || 0,
      sizePrices: strToTiers(tiers, sizes),
      description: desc.trim() || undefined,
      sizes,
      colorImages,
      mainColor: colors[0] || product?.mainColor,
      // Everything we hold, hero first — the gallery is the record, `img` is which one
      // represents the product in the catalog.
      images: Array.from(new Set([img, ...gallery].filter(Boolean))) as string[],
      // Only send overrides that exist. An empty map means "inherit the type", and
      // writing {} explicitly is how a product goes back to following settings.
      side_mockups: Object.fromEntries(Object.entries(sideMockups).filter(([, v]) => !!v)),
      img, // the hero — what the catalog shows
    }
    onSave(next)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than it was (2xl → 4xl) so the two-column layout below has somewhere to go.
          The dialog was ~770px and scrolled regardless; the images were the thing being
          squeezed for a width that wasn't buying anything. */}
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            {title ?? (product ? "Edit product" : "New product")}
            {supplier && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"><Tag size={11} weight="fill" /> {supplier}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Mockup + name */}
          <div className="flex gap-4">
            {/* PREVIEW, not an uploader.
                This used to be a second, independent file input that also wrote `img` —
                so the dialog had two places to add a picture and no indication they were
                the same field. Pictures now come in one way, through the Images well
                below, and this shows whichever of them is currently main.
                Nothing about the mockup's BEHAVIOUR changes: `img` is still the value the
                Design Maker treats as the blank and the item rows hydrate from. This is
                purely where it's uploaded and how it's shown. */}
            <div
              className="relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40"
              title={img ? "The main image, chosen in Images below" : "No image yet — add one in Images below"}
            >
              {img ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={img} alt="" className="size-full object-contain" />
              ) : typeMockup ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={typeMockup} alt="" className="size-full object-contain opacity-50" />
                  <span className="absolute inset-x-0 bottom-0 bg-background/85 py-0.5 text-center text-xs text-muted-foreground">{type} default</span>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <ImageIcon size={22} weight="duotone" /><span className="text-xs">Main image</span>
                </div>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Name</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Heavyweight Hoodie" className="h-9" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Type</span>
                  <select value={type} onChange={(e) => setType(e.target.value)} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{typeNames.map((t) => <option key={t}>{t}</option>)}</select>
                </label>
                {/* METHODS ARE MULTIPLE. A blank commonly takes several techniques — the
                    single select forced one, which is why a product that can be embroidered
                    AND screen printed had to lie about itself. The data already worked this
                    way: `method` holds a multi-value string ("DTG Print / Embroidery") and
                    normalizeMethods() splits it, which is exactly what methodsOf() reads.
                    Only this control was single-valued. Stored in the same joined format,
                    so nothing downstream changes. */}
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Methods</span>
                  <div className="flex flex-wrap gap-1.5 rounded-2xl border border-border bg-card px-2 py-2">
                    {METHODS.map((m) => {
                      const on = pickedMethods.includes(m)
                      return (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const next = on ? pickedMethods.filter((x) => x !== m) : [...pickedMethods, m]
                            setMethod(next.join(" / "))
                          }}
                          className={"rounded-md border px-2 py-0.5 text-xs font-medium transition-colors " +
                            (on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground")}
                        >
                          {on && <Check size={10} weight="bold" className="mr-1 inline" />}{m}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              {typeMockup && !img && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UploadSimple size={13} /> Using the {type} default — add an image below to override it.
                </div>
              )}
            </div>
          </div>

          {/* Pricing + live margin */}
          <div className="rounded-xl border border-border p-4">
            <div className="grid grid-cols-3 gap-3">
              <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Retail price ($)</span><Input value={price} onChange={(e) => { setPriceTouched(true); setPrice(e.target.value.replace(/[^0-9.]/g, "")) }} placeholder="42.00" className="h-9" inputMode="decimal" /></label>
              <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Base cost ($)</span><Input value={basePrice} onChange={(e) => setBasePrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="18.00" className="h-9" inputMode="decimal" /></label>
              <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Shipping fee ($)</span><Input value={shipping} onChange={(e) => setShipping(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={bandFee != null ? `default ${bandFee}` : "default"} className="h-9" inputMode="decimal" /></label>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Margin per unit</span>
              {isNaN(profit) ? (
                <span className="text-muted-foreground">enter a retail price</span>
              ) : (
                <span className={"font-semibold tabular-nums " + (profit >= 0 ? "text-emerald-600" : "text-destructive")}>
                  ${profit.toFixed(2)}{!isNaN(marginPct) ? ` · ${marginPct}%` : ""}
                </span>
              )}
            </div>
            {shipping.trim() === "" && <p className="mt-1 text-xs text-muted-foreground">Leave shipping blank to use the platform default at fulfillment.</p>}

            {/* Per-size price tiers — the canonical sizePrices [{size, price, shipping}].
                Keyed by SIZE, not colour: a 3XL costs more to buy and to ship, while Navy
                vs White is the same parcel. Blank = use the numbers above. A tier needs a
                cost to exist (matching npmCollectPriceTiers), so shipping alone is ignored. */}
            {/* Always rendered — this table is now the size list itself, so gating it on
                sizes.length meant deleting the last size removed the only way to add one
                back. */}
            <div className="mt-3 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Sizes &amp; pricing</span>
                  {Object.keys(tiers).length > 0 && (
                    <button onClick={() => setTiers({})} className="text-xs font-medium text-primary hover:underline">Clear pricing</button>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-[3rem_1fr_1fr_1fr_4.5rem_1.5rem] gap-2 text-xs text-muted-foreground">
                  <span /><span>Product cost ($)</span><span>Base cost ($)</span><span>Shipping ($)</span><span className="text-right">Margin</span><span />
                </div>
                <div className="mt-1 space-y-1.5">
                  {sizes.map((s) => {
                    const t = tiers[s]
                    const costN = Number(t?.cost)
                    // What pricing will actually charge if Base cost is left blank.
                    const derived = t?.cost?.trim() && isFinite(costN) && costN > 0 ? (costN + markup).toFixed(2) : ""
                    const patch = (k: keyof Tier, v: string) =>
                      setTiers((p) => ({ ...p, [s]: { ...{ price: "", shipping: "", cost: "" }, ...p[s], [k]: v.replace(/[^0-9.]/g, "") } }))
                    return (
                    <div key={s} className="grid grid-cols-[3rem_1fr_1fr_1fr_4.5rem_1.5rem] items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">{s}</span>
                      <Input
                        value={t?.cost ?? ""}
                        onChange={(e) => patch("cost", e.target.value)}
                        placeholder="supplier"
                        className="h-8 text-xs" inputMode="decimal" aria-label={`Product cost for size ${s}`}
                      />
                      <Input
                        value={t?.price ?? ""}
                        onChange={(e) => patch("price", e.target.value)}
                        /* Show the NUMBER that will actually be charged, never the word
                           "auto". A placeholder saying "auto" tells you a rule exists but
                           not what it produced, so the only way to learn the price was to
                           save and go look. Falls back through: this row's derived
                           cost + markup → the product-level base → nothing known. */
                        placeholder={derived || (basePrice.trim() !== "" ? Number(basePrice).toFixed(2) : "—")}
                        title={derived
                          ? `Auto: product cost ${costN.toFixed(2)} + ${markup.toFixed(2)} markup = ${derived}`
                          : basePrice.trim() !== "" ? "Using the product-level base cost above" : "Enter a product cost to price this size"}
                        className="h-8 text-xs" inputMode="decimal" aria-label={`Base cost for size ${s}`}
                      />
                      <Input
                        value={t?.shipping ?? ""}
                        onChange={(e) => patch("shipping", e.target.value)}
                        /* Same rule: the real default fee, not the word "default". */
                        placeholder={shipping.trim() !== "" ? Number(shipping).toFixed(2) : (bandFee != null ? Number(bandFee).toFixed(2) : "—")}
                        title={shipping.trim() !== "" ? "Using the product-level shipping fee above" : (bandFee != null ? "Platform default for this weight band" : undefined)}
                        className="h-8 text-xs" inputMode="decimal" aria-label={`Shipping fee for size ${s}`}
                      />
                      {/* Margin for THIS size, at the end of its own row. Retail is the
                          product's retail price (there is one per product, not per size);
                          the base cost is this row's if set, otherwise the derived
                          cost + markup, otherwise the product-level base. Without this
                          the only margin shown was the product-level one, which is wrong
                          the moment a 3XL costs more to buy or to ship. */}
                      {(() => {
                        const retailN = Number(price)
                        const baseN = t?.price?.trim() ? Number(t.price)
                          : derived ? Number(derived)
                          : Number(basePrice)
                        const m = retailN - baseN
                        return (
                          <span
                            className={"text-right text-xs font-semibold tabular-nums " + (!isFinite(m) ? "text-muted-foreground" : m >= 0 ? "text-emerald-600" : "text-destructive")}
                            title={isFinite(m) ? `Retail ${retailN.toFixed(2)} − base ${baseN.toFixed(2)}` : "Enter a retail price and a cost"}
                          >
                            {isFinite(m) ? `$${m.toFixed(2)}` : "—"}
                          </span>
                        )
                      })()}
                      {/* Delete the size here — this table IS the size list now, so the
                          row you're looking at is the thing you remove. Drops its pricing
                          with it; a tier for a size the product no longer offers is a trap. */}
                      <button
                        type="button"
                        aria-label={`Remove size ${s}`}
                        title={`Remove ${s}`}
                        onClick={() => {
                          setSizes((p) => p.filter((x) => x !== s))
                          setTiers((p) => { const n = { ...p }; delete n[s]; return n })
                        }}
                        className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X size={11} weight="bold" />
                      </button>
                    </div>
                  )})}
                </div>

                {/* Add a size back. Replaces the separate Sizes chip section, which was a
                    second list of the same thing sitting further down the dialog. */}
                {/* sizeSuggestions, not the static list — it also carries sizes the
                    SUPPLIER sent (e.g. "OSFM - Adult"), which a hardcoded S–3XL list
                    would make unaddable. */}
                {sizeSuggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Sparkle size={11} weight="fill" /> Add:</span>
                    {sizeSuggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSizes((p) => [...p, s])}
                        className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                )}
                {sizes.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">No sizes yet — add one above to price it.</p>
                )}
              </div>
          </div>

          {/* ── Images ──────────────────────────────────────────────────────────────
              Every picture we hold for this product, in one place. Supplier extras and
              per-colour shots used to be fetched and discarded because the editor had a
              single file input; now nothing is lost on import. One image is the HERO
              (what the catalog shows); the rest are available to assign to a colour. */}
          {/* Images carries the card treatment that used to sit only on pricing. This is a
              media-first job — the mockup is what makes the product usable in the Design
              Maker, as the hint above says — so giving three numeric fields the visual
              weight and the pictures a single 64px tile had the hierarchy backwards. */}
          <div
            className={"rounded-xl border p-4 transition-colors " + (dropping ? "border-primary bg-primary/5" : "border-border")}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false) }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return
              e.preventDefault(); setDropping(false)
              addImageFiles(Array.from(e.dataTransfer.files))
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? [])
              if (files.length) { e.preventDefault(); addImageFiles(files) }
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">Images</span>
              <span className="text-xs text-muted-foreground">
                {gallery.length ? `${gallery.length} held · drag to reorder` : "Drag images in, paste, or browse"}
              </span>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {gallery.map((u, i) => (
                <div
                  key={u}
                  className="group relative"
                  // Reordering is drag-and-drop on the tiles themselves. First tile is the
                  // main image, so ordering IS a decision, not just tidiness.
                  draggable
                  onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = "move" }}
                  onDragEnd={() => setDragIdx(null)}
                  onDragOver={(e) => { if (dragIdx !== null) e.preventDefault() }}
                  onDrop={(e) => {
                    if (dragIdx === null) return
                    e.preventDefault(); e.stopPropagation()
                    setGallery((g) => {
                      const next = [...g]
                      const [moved] = next.splice(dragIdx, 1)
                      next.splice(i, 0, moved)
                      return next
                    })
                    setDragIdx(null)
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setImg(u)}
                    title={u === img ? "Main image" : "Make this the main image"}
                    className={
                      "relative block size-28 overflow-hidden rounded-lg border-2 transition-colors " +
                      (u === img ? "border-primary" : "border-border hover:border-primary/50") +
                      (dragIdx === i ? " opacity-40" : "")
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="size-full object-cover" draggable={false} />
                    {u === img && (
                      <span className="absolute inset-x-0 bottom-0 bg-primary py-0.5 text-center text-xs font-semibold text-primary-foreground">Main</span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => {
                      setGallery((g) => g.filter((x) => x !== u))
                      if (img === u) setImg("")
                      // Drop any colour or side pointing at it, or they'd reference a
                      // picture that no longer exists.
                      setColorImgs((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== u)))
                      setSideMockups((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== u)))
                    }}
                    className="absolute -right-1.5 -top-1.5 hidden size-6 place-items-center rounded-full bg-foreground/75 text-background group-hover:grid"
                  >
                    <X size={12} weight="bold" />
                  </button>
                </div>
              ))}

              <label className="grid size-28 cursor-pointer place-items-center gap-1 rounded-lg border-2 border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent">
                <span className="flex flex-col items-center gap-1">
                  <Plus size={20} />
                  <span className="text-xs font-medium">Add</span>
                </span>
                <input
                  type="file" accept="image/*" multiple className="hidden"
                  onChange={(e) => { addImageFiles(Array.from(e.target.files ?? [])); e.target.value = "" }}
                />
              </label>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              The first image is the main one — click any tile to promote it, or drag to reorder.
            </p>
          </div>

          {/* ── Print sides ─────────────────────────────────────────────────────────
              Sides come from the TYPE (Settings → Platform), so a category change reaches
              every product that never disagreed with it. A board can override a side here
              with one of this product's own images — for the blank whose back really does
              look different. Clearing an override returns that side to following settings,
              rather than leaving it stuck on whatever it was overridden to. */}
          {typeSides.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Print sides</span>
                <span className="text-xs text-muted-foreground">from {type} · override only if this blank differs</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {typeSides.map((sd) => {
                  const override = sideMockups[sd] || ""
                  const inherited = typeMockupOf({ type } as CatalogProduct, sd)
                  const shown = override || inherited
                  return (
                    /* A vertical tile, matching the Images grid above: picture on top,
                       label, then the control. The old row squeezed a 32px thumb between
                       a label and a select, so the one thing you're choosing — a picture
                       — was the smallest element in its own control. */
                    /* The tile IS the control. There used to be a "Use settings" dropdown
                       under every side — six visible selects saying the same thing, when
                       following settings is the default and needs no instruction. Now:
                       click the tile to change it, X to clear it back to settings, and a
                       small tag only when this product actually disagrees with its type. */
                    <div key={sd} className="group/side flex w-28 flex-col gap-1.5">
                      <label className="relative block cursor-pointer">
                        {shown ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={shown} alt="" className={"size-28 rounded-lg border-2 object-contain transition-colors " + (override ? "border-primary" : "border-border opacity-70 hover:opacity-100")} />
                        ) : (
                          <span className="grid size-28 place-items-center rounded-lg border-2 border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-primary/50"><ImageIcon size={20} /></span>
                        )}
                        {/* Says "this one is ours", so the absence of a tag means it's
                            following the type — the common case stays silent. */}
                        {override && (
                          <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-primary/90 py-0.5 text-center text-xs font-medium text-primary-foreground">Custom</span>
                        )}
                        {/* A real select, visually hidden — keeps keyboard and screen-reader
                            behaviour while the tile is what you actually click. */}
                        <select
                          aria-label={`Mockup for ${sd}`}
                          value={override}
                          onChange={(e) => setSideMockups((m) => {
                            const next = { ...m }
                            if (e.target.value) next[sd] = e.target.value; else delete next[sd]
                            return next
                          })}
                          className="absolute inset-0 cursor-pointer opacity-0"
                        >
                          <option value="">{inherited ? "Use settings" : "None set"}</option>
                          {gallery.map((u, i) => <option key={u} value={u}>Image {i + 1}</option>)}
                        </select>
                        {/* Clear back to the type's mockup. Only when there IS an override —
                            an X that undoes nothing is a trap. */}
                        {override && (
                          <button
                            type="button"
                            aria-label={`Clear the ${sd} mockup`}
                            title="Remove this override — go back to the type's mockup"
                            onClick={(e) => {
                              e.preventDefault(); e.stopPropagation()
                              setSideMockups((m) => { const n = { ...m }; delete n[sd]; return n })
                            }}
                            className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-foreground/75 text-background opacity-0 transition-opacity group-hover/side:opacity-100 focus-visible:opacity-100"
                          >
                            <X size={12} weight="bold" />
                          </button>
                        )}
                      </label>
                      <span className="truncate text-xs font-medium capitalize">{sd}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Colors — chips + suggested */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Colors</span>
              {colors.length > 0 && <button onClick={() => setColors([])} className="text-xs font-medium text-primary hover:underline">Clear</button>}
            </div>
            {/* Each colour can point at one of the gallery images. A colour with none
                falls back to the product's main image, same as before. */}
            {colors.length > 0 && gallery.length > 0 && (
              <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/30 p-2">
                {colors.map((c) => (
                  <div key={c} className="flex items-center gap-1.5 rounded-md bg-card px-1.5 py-1">
                    <span className="max-w-[110px] truncate text-xs font-medium">{prettyColorName(c)}</span>
                    <select
                      value={colorImgs[c] ?? ""}
                      onChange={(e) => setColorImgs((m) => ({ ...m, [c]: e.target.value }))}
                      className="eg-select h-7 rounded-lg border border-border bg-card px-1.5 text-xs transition-colors hover:border-primary/40"
                    >
                      <option value="">Main image</option>
                      {gallery.map((u, i) => <option key={u} value={u}>Image {i + 1}</option>)}
                    </select>
                    {colorImgs[c] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={colorImgs[c]} alt="" className="size-6 rounded border border-border object-cover" />
                    )}
                  </div>
                ))}
              </div>
            )}
            {colors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {colors.map((c) => (
                  <span key={c} title={c} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
                    {prettyColorName(c)}
                    <button onClick={() => setColors((p) => p.filter((x) => x !== c))} className="flex size-4 items-center justify-center rounded-full hover:bg-primary/20"><X size={9} weight="bold" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <Input value={colorInput} onChange={(e) => setColorInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addColor(colorInput) } }} placeholder="Add a color…" className="h-8 text-xs" />
              <Button size="sm" variant="outline" className="h-8 shrink-0 px-2" onClick={() => addColor(colorInput)}><Plus size={13} weight="bold" /></Button>
            </div>
            {colorSuggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Sparkle size={11} weight="fill" /> {supplier ? "From supplier" : "Suggested"}:</span>
                {colorSuggestions.map((c) => (
                  <button key={c} title={c} onClick={() => addColor(c)} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary">+ {prettyColorName(c)}</button>
                ))}
              </div>
            )}
          </div>

          {/* (The Sizes chip section lived here. It was a second list of the same thing
              the pricing table above already shows, so a size could be added in one place
              and priced in another. Sizes are now added and removed on their own row.) */}

          {/* Description */}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Description</span>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} placeholder={supplier ? "Auto-filled from the supplier — edit as needed." : "Product description…"} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
          </label>

          <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"><option>Active</option><option>Draft</option><option>Archived</option></select>
          </label>

          {err && <div className="text-sm text-destructive">{err}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>{ctaLabel ?? (product ? "Save changes" : "Add product")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

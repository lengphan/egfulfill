"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CircleNotch, Storefront, UploadSimple, Trash, Package } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ProductCombobox } from "@/components/app/product-combobox"
import { readImageFile } from "@/components/app/design-canvas"
import { prettyColorName } from "@/lib/color-name"
import { sizesOf, colorsOf, methodsOf } from "@/lib/variant-resolve"
import { getSpecQuote, publishEtsy, publishTiktok, getTiktokCategories, getTiktokWarehouses, getSpydeckTrending, getCatalogProducts, saveCatalogProducts, type CatalogProduct, type SpecQuote, type TiktokCategory, type TiktokWarehouse } from "@/lib/api"

const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const MAX_TAGS = 13
const MAX_IMAGES = 10 // Etsy's hard limit — an 11th slot silently never publishes.
const cleanTag = (raw: string) => raw.replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 20)

/**
 * A toggleable set of variant options with All / None.
 *
 * Module scope, not nested in the dialog — a component defined during render is a new
 * type every pass, so React unmounts and remounts the whole set on each keystroke
 * (repo lint rule react-hooks/static-components).
 */
function VariantChips({
  label, options, picked, onChange, render,
}: {
  label: string
  options: string[]
  picked: string[]
  onChange: (next: string[]) => void
  render?: (v: string) => string
}) {
  const allOn = picked.length === options.length && options.length > 0
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label} ({picked.length}/{options.length})
        </span>
        <button
          type="button"
          onClick={() => onChange(allOn ? [] : options)}
          className="text-[11px] font-medium text-primary transition-colors hover:underline"
        >
          {allOn ? "None" : "All"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = picked.includes(o)
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? picked.filter((x) => x !== o) : [...picked, o])}
              className={
                "rounded border px-1.5 py-0.5 text-[11px] transition-colors " +
                (on
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")
              }
            >
              {render ? render(o) : o}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Everything a source can prefill. Whatever it can't fill stays empty and editable. */
export type PublishPrefill = {
  title?: string
  description?: string
  price?: number | string | null
  tags?: string[]
  images?: string[]
  /** Catalog product to produce this on. Sets the cost side of the margin. */
  blank?: CatalogProduct | null
  /** The ARTWORK, not the composite in `images`. This is what gets attached to the order
   *  when one arrives, and what makes the line sendable to the Design board. */
  designUrl?: string
  designPos?: unknown
  designId?: string | number
}

/**
 * ONE publish dialog for both entry points — the design maker ("publish what I made")
 * and SpyDeck ("make one like this"). They were two components doing the same job with
 * different fields, so only one of them ever had tags, only the other had variants, and
 * neither knew what the product cost.
 *
 * The blank is the load-bearing addition. Without a catalog product behind the listing
 * there is no cost, no shipping fee and no margin — which is exactly why the old
 * dialogs couldn't show any of them — and nothing to actually produce against.
 */
export function PublishProductDialog({
  open, onOpenChange, prefill, onPublished, title: dialogTitle = "Publish product",
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  prefill: PublishPrefill | null
  /** `primaryImage` is the photo that became the listing's cover, so the caller can show
   *  what was actually published instead of the source it copied from. */
  onPublished?: (url?: string, primaryImage?: string) => void
  title?: string
}) {
  // The dialog resolves a picked blank itself rather than asking each caller for a
  // lookup — the combobox hands back a flattened shape, and pricing needs the full row.
  const catalogRef = useRef<CatalogProduct[]>([])
  const [blank, setBlank] = useState<CatalogProduct | null>(null)
  const [blankText, setBlankText] = useState("")
  const [title, setTitle] = useState("")
  const [desc, setDesc] = useState("")
  const [retail, setRetail] = useState("")
  const [qty, setQty] = useState("999")
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState("")
  const [suggested, setSuggested] = useState<string[]>([])
  const [images, setImages] = useState<string[]>([])
  const [size, setSize] = useState("")
  const [method, setMethod] = useState("")
  // Which variants actually go on the listing. Both default to everything the blank
  // offers (what this dialog always published), but a colourway you don't want to sell
  // shouldn't need editing on Etsy afterwards.
  const [pickedColors, setPickedColors] = useState<string[]>([])
  const [pickedSizes, setPickedSizes] = useState<string[]>([])
  // One quote per size, not one for "the priced size": cost varies by size, so a single
  // margin figure was only ever true for whichever size happened to be selected.
  const [sizeQuotes, setSizeQuotes] = useState<Record<string, SpecQuote>>({})
  // Per-size retail overrides. Empty means "use the single Retail price above", so a
  // seller who wants one price everywhere still types it once — but a bigger size that
  // costs more can be charged more, which is the whole reason cost varies by size.
  const [sizeRetail, setSizeRetail] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string; note?: string } | null>(null)
  // One-time acknowledgement that competitor-sourced photos are about to go on the shop.
  const [ipConfirmed, setIpConfirmed] = useState(false)
  // Which marketplace this draft goes to. Etsy takes photos + tags + variants directly;
  // TikTok additionally needs a LEAF category, a warehouse (per-SKU inventory) and a
  // package weight, so those fields appear only when TikTok is the target.
  const [channel, setChannel] = useState<"etsy" | "tiktok">("etsy")
  const [ttCatQuery, setTtCatQuery] = useState("")
  const [ttCategories, setTtCategories] = useState<TiktokCategory[]>([])
  const [ttCategory, setTtCategory] = useState<TiktokCategory | null>(null)
  const [ttWarehouses, setTtWarehouses] = useState<TiktokWarehouse[]>([])
  const [ttWarehouse, setTtWarehouse] = useState("")
  const [ttWeight, setTtWeight] = useState("")
  const [ttWeightUnit, setTtWeightUnit] = useState("POUND")
  const [ttLoadErr, setTtLoadErr] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const seeded = useRef(false)
  // A SpyDeck listing's competitor photos aren't in the grid payload — they arrive from an
  // async listing-detail fetch AFTER this dialog opens, so the once-seed above ran with none
  // (or just the cover). This tracks whether the user has hand-edited the photos; until they
  // have, we keep syncing them from the prefill as the detail fills in, so the competitor
  // images actually attach instead of silently never showing up.
  const imgTouched = useRef(false)

  // Seed once per open, from whichever source supplied the prefill.
  useEffect(() => {
    if (!open) { seeded.current = false; return }
    if (seeded.current) return
    seeded.current = true
    const id = setTimeout(() => {
      setTitle(prefill?.title ?? "")
      setDesc(prefill?.description ?? "")
      setRetail(prefill?.price != null ? String(prefill.price) : "")
      setTags((prefill?.tags ?? []).slice(0, MAX_TAGS))
      setImages((prefill?.images ?? []).filter(Boolean).slice(0, MAX_IMAGES))
      setBlank(prefill?.blank ?? null)
      setBlankText(prefill?.blank?.name ?? "")
      setResult(null)
      setIpConfirmed(false)
      getSpydeckTrending().then((r) => setSuggested((r.keywords ?? []).slice(0, 12))).catch(() => {})
      getCatalogProducts().then((rows) => { catalogRef.current = rows ?? [] }).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [open, prefill])

  // Re-sync photos from the prefill as the async listing-detail fetch fills them in — until
  // the user edits them. Without this, competitor photos loaded after open never attach.
  useEffect(() => {
    if (!open) { imgTouched.current = false; return }
    if (imgTouched.current) return
    const imgs = (prefill?.images ?? []).filter(Boolean).slice(0, MAX_IMAGES)
    if (!imgs.length) return
    const id = setTimeout(() => { if (!imgTouched.current) setImages(imgs) }, 0)
    return () => clearTimeout(id)
  }, [open, prefill])

  // Load TikTok's leaf categories + warehouses the first time the seller switches channels.
  // The category tree is large, so we fetch it once and filter locally as they type.
  useEffect(() => {
    if (channel !== "tiktok") return
    if (!ttCategories.length) {
      getTiktokCategories()
        .then((r) => { if (r.error) setTtLoadErr(r.error); else { setTtLoadErr(""); setTtCategories((r.categories ?? []).filter((c) => c.is_leaf !== false)) } })
        .catch((e) => setTtLoadErr(e instanceof Error ? e.message : "Couldn't load TikTok categories"))
    }
    if (!ttWarehouses.length) {
      getTiktokWarehouses()
        .then((r) => {
          const ws = r.warehouses ?? []
          setTtWarehouses(ws)
          setTtWarehouse((w) => w || (ws[0] ? String(ws[0].id) : ""))
        })
        .catch(() => {})
    }
  }, [channel, ttCategories.length, ttWarehouses.length])

  // Variant options follow the chosen blank — the same resolvers the order pickers use,
  // so a listing offers exactly what the factory can actually make.
  const sizeOpts = useMemo(() => sizesOf(blank), [blank])
  const colorOpts = useMemo(() => colorsOf(blank), [blank])
  const methodOpts = useMemo(() => methodsOf(blank), [blank])

  // Snap the priced variant onto the blank's own options. Deferred rather than set in the
  // effect body — a synchronous setState there cascades a render (repo lint rule).
  useEffect(() => {
    const id = setTimeout(() => {
      if (sizeOpts.length && (!size || !sizeOpts.includes(size))) setSize(sizeOpts[0])
      if (methodOpts.length && (!method || !methodOpts.includes(method))) setMethod(methodOpts[0])
    }, 0)
    return () => clearTimeout(id)
  }, [sizeOpts, methodOpts, size, method])

  // Selecting a blank offers all of its variants. Keyed off the option lists rather than
  // the blank so a product whose colours load late still ends up fully selected.
  useEffect(() => {
    const id = setTimeout(() => { setPickedColors(colorOpts); setPickedSizes(sizeOpts) }, 0)
    return () => clearTimeout(id)
  }, [colorOpts, sizeOpts])

  // Cost comes from the server's pricing path — the same one that bills an order, so the
  // margin shown here is the margin actually earned. Quoted for EVERY size the blank has,
  // not just the selected one, so toggling a size doesn't refetch and the table can show
  // the whole run at once.
  useEffect(() => {
    let live = true
    const id = setTimeout(async () => {
      if (!live) return
      if (!blank?.name) { setSizeQuotes({}); return }
      const list = sizeOpts.length ? sizeOpts : [""]
      const pairs = await Promise.all(list.map(async (s) => {
        try { return [s, await getSpecQuote({ blank: blank.name, sku: blank.sku, size: s, printType: method })] as const }
        catch { return [s, null] as const }
      }))
      if (live) setSizeQuotes(Object.fromEntries(pairs.filter((p): p is readonly [string, SpecQuote] => !!p[1])))
    }, 0)
    return () => { live = false; clearTimeout(id) }
  }, [blank, sizeOpts, method])

  const retailN = Number(retail) || 0
  // The single-figure summary still needs one representative quote: the selected size, or
  // the sole quote when the blank has no size run at all.
  const quote = sizeQuotes[size] ?? sizeQuotes[""] ?? null
  const cost = quote?.total ?? null
  const margin = cost != null && retailN > 0 ? retailN - cost : null
  const marginPct = margin != null && retailN > 0 ? (margin / retailN) * 100 : null

  /** Per-size economics for the sizes actually being published. */
  const sizeRows = useMemo(() => pickedSizes.map((s) => {
    const q = sizeQuotes[s] ?? null
    const total = q?.total ?? null
    // The override wins; the shared Retail field is the fallback. Margin is computed
    // against whichever actually applies, so the percentage moves as you type.
    const override = Number(sizeRetail[s])
    const price = sizeRetail[s] !== undefined && sizeRetail[s] !== "" && override > 0 ? override : retailN
    const m = total != null && price > 0 ? price - total : null
    return { size: s, unitCost: q?.unitCost ?? null, shipping: q?.shipping ?? null, total, price,
             margin: m, pct: m != null && price > 0 ? (m / price) * 100 : null }
  }), [pickedSizes, sizeQuotes, retailN, sizeRetail])

  const anyLoss = sizeRows.some((r) => r.margin != null && r.margin < 0)

  /**
   * The price the listing actually publishes at — which is NOT always the top Retail
   * field.
   *
   * The size table says, in as many words, "leave a row blank to use the price above", so
   * pricing every size and leaving Retail blank is a COMPLETE product. But the gate only
   * ever checked `retailN`, so that exact configuration — the one in the screenshot — was
   * rejected as missing a price it plainly had; and even past the gate, `price: retailN`
   * would have sent 0 as the listing's base.
   *
   * base = the Retail field when set, otherwise the CHEAPEST size, so Etsy gets a real
   * floor price and each size_prices entry overrides from there. `priceReady` mirrors what
   * the table promises: a product with sizes is priced when every published size resolves
   * to a price (its own, or the shared one); a product without sizes needs the one Retail
   * price. sizeRows[].price already resolves override-or-shared, so this reads straight off
   * it rather than re-deriving the rule and risking the two drifting apart.
   */
  const pricedSizeRows = sizeRows.filter((r) => r.price > 0)
  const basePrice = retailN > 0 ? retailN : (pricedSizeRows.length ? Math.min(...pricedSizeRows.map((r) => r.price)) : 0)
  const priceReady = pickedSizes.length > 0
    ? sizeRows.length > 0 && sizeRows.every((r) => r.price > 0)
    : retailN > 0

  const addTag = (raw: string) => {
    const t = cleanTag(raw)
    if (!t) return
    setTags((p) => (p.some((x) => x.toLowerCase() === t.toLowerCase()) || p.length >= MAX_TAGS ? p : [...p, t]))
    setTagDraft("")
  }
  const removeTag = (t: string) => setTags((p) => p.filter((x) => x !== t))
  const addImages = (files: FileList | null) => {
    imgTouched.current = true
    for (const f of Array.from(files ?? []).slice(0, MAX_IMAGES)) {
      readImageFile(f, (url) => setImages((p) => (p.length >= MAX_IMAGES ? p : [...p, url])), (m) => setResult({ ok: false, text: m }))
    }
  }
  const makePrimary = (i: number) => { imgTouched.current = true; setImages((p) => [p[i], ...p.filter((_, x) => x !== i)]) }
  const removeImage = (i: number) => { imgTouched.current = true; setImages((p) => p.filter((_, x) => x !== i)) }

  // Remote (http) images are the source's OWN photos — a SpyDeck competitor's Etsy-CDN
  // shots. Locally-added photos are data: URLs, which are yours. Publishing someone
  // else's photos to your shop is an Etsy IP-policy risk, so we make it a deliberate,
  // acknowledged choice rather than something that just happens.
  const borrowedPhotos = useMemo(() => images.filter((u) => /^https?:\/\//i.test(u)), [images])
  const removeBorrowedPhotos = () => { imgTouched.current = true; setImages((p) => p.filter((u) => !/^https?:\/\//i.test(u))); setIpConfirmed(false) }

  // Leaf categories that match what the seller typed. Capped so a 5,000-node tree can't
  // render at once; the search box is how you reach the rest.
  const ttCatMatches = useMemo(() => {
    const qy = ttCatQuery.trim().toLowerCase()
    return ttCategories
      .filter((c) => !qy || (c.local_name ?? "").toLowerCase().includes(qy))
      .slice(0, 40)
  }, [ttCategories, ttCatQuery])

  // Publish to TikTok Shop. Shares the common fields with the Etsy path but adds the three
  // TikTok-only requirements. The server is DRY-RUN until its TIKTOK_PUBLISH_LIVE flag is
  // set, so a dry run comes back with the assembled payload rather than a live product.
  const publishToTiktok = async () => {
    if (!ttCategory) { setResult({ ok: false, text: "Pick a TikTok category (it must be a leaf)." }); return }
    if (!ttWarehouse) { setResult({ ok: false, text: "Pick a warehouse for stock." }); return }
    if (!(Number(ttWeight) > 0)) { setResult({ ok: false, text: "Enter a package weight." }); return }
    setBusy(true); setResult(null)
    try {
      const r = await publishTiktok({
        title: title.trim(), description: desc.trim() || title.trim(),
        price: basePrice, quantity: Number(qty) || 999,
        images, tags,
        colors: blank ? pickedColors : [], sizes: blank ? pickedSizes : [],
        sku_base: blank?.sku ?? undefined,
        size_prices: Object.fromEntries(sizeRows.filter((r) => r.price > 0).map((r) => [r.size, r.price])),
        category_id: ttCategory.id, warehouse_id: ttWarehouse,
        package_weight: ttWeight, weight_unit: ttWeightUnit,
        blank: blank?.sku ?? undefined, printType: method || undefined,
        designId: prefill?.designId, designUrl: prefill?.designUrl, designPos: prefill?.designPos,
      })
      if (r.error) throw new Error(r.error)
      if (r.dryRun) {
        // Honest about the mode: nothing was sent. Show what's still missing, if anything.
        setResult({
          ok: true,
          text: "Validated for TikTok — but publishing is in dry-run mode, so nothing was sent to the shop.",
          note: r.missing?.length ? `Still needed before it can list: ${r.missing.join(", ")}.` : "Ask an admin to enable live TikTok publishing to send it.",
        })
        return
      }
      setResult({
        ok: true,
        text: r.product_id ? `Created a draft product on TikTok (#${r.product_id}).` : "Created a draft product on TikTok.",
        note: r.warnings?.length ? r.warnings.map((w) => w.message).filter(Boolean).join(" ") : undefined,
      })
      onPublished?.(undefined, images[0])
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Publish failed." })
    } finally { setBusy(false) }
  }

  const publish = async () => {
    if (!title.trim() || !priceReady) {
      // Say WHICH is missing, and — when it's the price — name the two ways to supply it,
      // because "a retail price is required" on a screen where every size shows a price is
      // exactly what made this look broken.
      const msg = !title.trim()
        ? (priceReady ? "A title is required." : "A title and a retail price are required.")
        : pickedSizes.length > 0
          ? "Every size needs a price — fill each row, or set the Retail price above to cover the blank ones."
          : "A retail price is required."
      setResult({ ok: false, text: msg })
      return
    }
    // Gate on the FIRST attempt when the listing carries the competitor's own photos:
    // surface the IP warning and make the seller choose. The warning panel renders while
    // `!ipConfirmed`, so this returns and waits rather than silently attaching.
    if (borrowedPhotos.length > 0 && !ipConfirmed) { setResult(null); return }
    if (channel === "tiktok") { publishToTiktok(); return }
    setBusy(true); setResult(null)
    try {
      const r = await publishEtsy({
        title: title.trim(), description: desc.trim() || title.trim(),
        // basePrice, not retailN — a per-size-priced product has a 0 in the Retail field
        // but a real cheapest-size floor, and sending retailN would list it at $0.
        price: basePrice, quantity: Number(qty) || 999,
        image: images[0], images, tags,
        // Real Etsy variants, each stamped with OUR sku so the buyer's order line
        // resolves back to this exact blank+colour+size no matter how the seller renames
        // the variant on the marketplace.
        colors: blank ? pickedColors : [],
        sizes: blank ? pickedSizes : [],
        sku_base: blank?.sku ?? undefined,
        // What the factory needs when this listing sells. The server records these on
        // published_listings and order sync reads them back — without them the order
        // arrives with no blank and no artwork, and can't be sent to a designer.
        blank: blank?.sku ?? undefined,
        printType: method || undefined,
        designId: prefill?.designId,
        designUrl: prefill?.designUrl,
        designPos: prefill?.designPos,
        // Only when unambiguous. Order sync applies these solely if the buyer's variant
        // text contains them, so sending one of five colours would just never match —
        // but it would also be a claim we can't support. The variant SKU is the real
        // resolution path when there's more than one.
        color: pickedColors.length === 1 ? pickedColors[0] : undefined,
        size: pickedSizes.length === 1 ? pickedSizes[0] : undefined,
        // Per-size retail, so the price a seller typed against a size is the price that
        // size actually lists at. Without this the table would show a margin the listing
        // doesn't charge — a number that moves on screen and nowhere else.
        size_prices: Object.fromEntries(
          sizeRows.filter((r) => r.price > 0).map((r) => [r.size, r.price])
        ),
      })
      if (r.error) throw new Error(r.error)

      // Register the generated skus on the catalog product. Without this the order comes
      // back carrying a sku we don't recognise and prices as "no product".
      if (blank && r.variant_skus?.length) {
        try {
          const existing = await getCatalogProducts()
          const next = (existing ?? []).map((p) =>
            String(p.id) === String(blank.id)
              ? { ...p, variantSkus: Array.from(new Set([...(p.variantSkus ?? []).map((v) => (typeof v === "string" ? v : v.sku ?? "")), ...r.variant_skus!])).filter(Boolean) }
              : p
          )
          await saveCatalogProducts(next)
        } catch { /* the listing is live; a failed sku write is recoverable by republishing */ }
      }

      setResult({
        ok: true,
        text: r.variants_error
          ? `Published as a draft — but variants failed (${r.variants_error}). It's a flat listing.`
          : r.variants_applied
            ? `Published as a draft with ${r.variants_applied} variants`
            : "Published as a draft listing",
        url: r.url,
      })
      onPublished?.(r.url, images[0])
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Publish failed." })
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader><DialogTitle>{dialogTitle}</DialogTitle></DialogHeader>

        {result?.ok ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="font-semibold text-emerald-600">{result.text}</div>
            {result.note && <p className="max-w-sm text-sm text-muted-foreground">{result.note}</p>}
            {result.url && <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">View the listing →</a>}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <div className="grid max-h-[72vh] gap-5 overflow-y-auto pr-1 md:grid-cols-[1.1fr_1fr]">
            {/* LEFT — what the listing looks like */}
            <div className="space-y-4">
              {/* Where this draft goes. TikTok reveals its extra required fields on the right. */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Publish to</div>
                <div className="inline-flex rounded-lg border border-border p-0.5">
                  {(["etsy", "tiktok"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setChannel(c); setResult(null) }}
                      className={
                        "rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors " +
                        (channel === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                      }
                    >
                      {c === "tiktok" ? "TikTok Shop" : "Etsy"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Photos <span className="text-muted-foreground">({images.length}/{MAX_IMAGES})</span></div>
                <div className="grid grid-cols-4 gap-2">
                  {images.map((src, i) => (
                    <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                      {i === 0 && <span className="absolute inset-x-0 bottom-0 bg-primary/90 py-0.5 text-center text-[9px] font-semibold uppercase text-primary-foreground">Primary</span>}
                      <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                        {i !== 0 && <button onClick={() => makePrimary(i)} className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">Primary</button>}
                        <button onClick={() => removeImage(i)} aria-label="Remove photo" className="rounded bg-white/90 p-1 text-black"><Trash size={11} weight="bold" /></button>
                      </div>
                    </div>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <button onClick={() => fileRef.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                      <UploadSimple size={16} weight="bold" /><span className="text-[10px] font-medium">Add</span>
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = "" }} />
              </div>

              <label className="flex flex-col gap-1"><span className="text-sm font-medium">Title</span>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Retro Sunset Comfort Colors Tee" />
              </label>
              <label className="flex flex-col gap-1"><span className="text-sm font-medium">Description</span>
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} placeholder="Describe the product…" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
              </label>

              <div className="space-y-1.5">
                <div className="text-sm font-medium">Tags <span className="text-muted-foreground">({tags.length}/{MAX_TAGS})</span></div>
                <Input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft) }
                    else if (e.key === "Backspace" && !tagDraft && tags.length) removeTag(tags[tags.length - 1])
                  }}
                  onBlur={() => addTag(tagDraft)}
                  disabled={tags.length >= MAX_TAGS}
                  placeholder={tags.length >= MAX_TAGS ? "13 tags is Etsy's maximum" : "Type a tag, press Enter"}
                />
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((t) => <button key={t} onClick={() => removeTag(t)} className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">{t} ✕</button>)}
                  </div>
                )}
                {suggested.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {suggested.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())).map((s) => (
                      <button key={s} onClick={() => addTag(s)} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary">{s}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — what it's made on, and whether it makes money */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Base product</div>
                <ProductCombobox
                  value={blankText}
                  onText={setBlankText}
                  onPick={(p) => {
                    setBlankText(p.name)
                    // Resolve the picked blank to its full catalog row. catalogRef may not have
                    // loaded yet (it's fetched async on open) — if so, fetch now so the pick
                    // still sticks instead of silently resolving to null ("blank didn't persist").
                    // Match by sku, then fall back to name so a sku-shape mismatch can't drop it.
                    const pick = (rows: CatalogProduct[]) =>
                      setBlank(rows.find((x) => String(x.sku ?? "") === p.sku) ?? rows.find((x) => String(x.name ?? "") === p.name) ?? null)
                    if (catalogRef.current.length) pick(catalogRef.current)
                    else getCatalogProducts().then((rows) => { catalogRef.current = rows ?? []; pick(catalogRef.current) }).catch(() => {})
                  }}
                  placeholder="Pick the blank to print on"
                />
                <p className="text-xs text-muted-foreground">
                  Sets what we produce, and the cost behind your margin.
                </p>
              </div>

              {/* TikTok Shop needs these three; Etsy doesn't. Shown only for the TikTok channel. */}
              {channel === "tiktok" && (
                <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">TikTok Shop requirements</div>
                  {ttLoadErr && <p className="text-xs text-destructive">{ttLoadErr}</p>}

                  {/* Leaf category — required. Search then pick from the tree. */}
                  <div className="space-y-1">
                    <div className="text-xs font-medium">Category {ttCategory && <span className="text-muted-foreground">· {ttCategory.local_name}</span>}</div>
                    <Input value={ttCatQuery} onChange={(e) => setTtCatQuery(e.target.value)} placeholder={ttCategories.length ? "Search categories…" : "Loading categories…"} className="h-8 text-xs" />
                    {ttCatQuery.trim() && (
                      <div className="max-h-36 overflow-y-auto rounded-md border border-border">
                        {ttCatMatches.length === 0 ? (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">No leaf category matches.</div>
                        ) : ttCatMatches.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setTtCategory(c); setTtCatQuery("") }}
                            className={"flex w-full items-center justify-between px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted " + (ttCategory?.id === c.id ? "bg-primary/10 text-primary" : "")}
                          >
                            <span className="truncate">{c.local_name || c.id}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Warehouse — per-SKU inventory is booked against it. */}
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium">Warehouse</span>
                    <select value={ttWarehouse} onChange={(e) => setTtWarehouse(e.target.value)} className="eg-select h-8 rounded-md border border-border bg-card px-2 text-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                      {!ttWarehouses.length && <option value="">No warehouse found</option>}
                      {ttWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
                    </select>
                  </label>

                  {/* Package weight — required for physical products. */}
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium">Package weight</span>
                    <div className="flex gap-1.5">
                      <Input value={ttWeight} onChange={(e) => setTtWeight(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.5" inputMode="decimal" className="h-8 flex-1 text-xs" />
                      <select value={ttWeightUnit} onChange={(e) => setTtWeightUnit(e.target.value)} className="eg-select h-8 rounded-md border border-border bg-card px-2 text-xs">
                        <option value="POUND">lb</option>
                        <option value="KILOGRAM">kg</option>
                      </select>
                    </div>
                  </label>
                  <p className="text-[11px] text-muted-foreground">Creates a <span className="font-medium text-foreground">draft</span> product on your TikTok Shop for you to review, then list.</p>
                </div>
              )}

              {/* No "size priced" picker any more — the table below prices every size, so
                  choosing one to represent the rest was the thing hiding the others. */}
              {blank && (
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Method</span>
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-xs font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                    {methodOpts.length === 0 && <option value="">Any</option>}
                    {methodOpts.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              )}

              {/* Colours and sizes are CHOICES now, not a readout. Every chip that's on
                  becomes an Etsy variant, so the listing offers what you meant to sell
                  rather than everything the blank happens to come in. No cap on the list:
                  hiding colours behind a "+N" made them unreachable. */}
              {blank && colorOpts.length > 0 && (
                <VariantChips
                  label="Colours"
                  options={colorOpts}
                  picked={pickedColors}
                  onChange={setPickedColors}
                  render={prettyColorName}
                />
              )}

              {blank && sizeOpts.length > 0 && (
                <VariantChips
                  label="Sizes"
                  options={sizeOpts}
                  picked={pickedSizes}
                  onChange={setPickedSizes}
                />
              )}

              {blank && (pickedColors.length === 0 || (sizeOpts.length > 0 && pickedSizes.length === 0)) && (
                <p className="text-xs text-amber-700">
                  With none selected this publishes as a flat listing with no variants.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1"><span className="text-sm font-medium">Retail price ($)</span>
                  <Input value={retail} onChange={(e) => setRetail(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="24.00" inputMode="decimal" />
                </label>
                <label className="flex flex-col gap-1"><span className="text-sm font-medium">Quantity</span>
                  <Input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" />
                </label>
              </div>

              {/* The economics the old dialogs never showed — now per size, because cost
                  varies across a size run and a single margin figure was only ever true
                  for whichever size the old picker happened to be set to. */}
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
                {!blank ? (
                  // Not just a missing margin readout: with no blank there is no sku_base,
                  // so variants publish under a fallback prefix that matches no catalog
                  // product, and the order it eventually produces can't be priced. Worth
                  // more than a neutral hint — this is the SpyDeck default path.
                  <p className="text-xs text-amber-700">
                    Pick a base product. Without one this publishes with no cost, no margin
                    and no variant SKUs we recognise — the order it creates won&apos;t price
                    or reach the factory.
                  </p>
                ) : sizeRows.length > 0 ? (
                  <div className="space-y-2">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs tabular-nums">
                        <thead>
                          <tr className="text-muted-foreground">
                            {/* px-2 matters: with no horizontal padding these ran together
                                as "SizeProductionShipping". */}
                            <th className="px-2 pb-1 text-left font-medium">Size</th>
                            <th className="px-2 pb-1 text-right font-medium">Production</th>
                            <th className="px-2 pb-1 text-right font-medium">Shipping</th>
                            <th className="px-2 pb-1 text-right font-medium">Your cost</th>
                            <th className="px-2 pb-1 text-right font-medium">Retail</th>
                            <th className="px-2 pb-1 text-right font-medium">Profit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sizeRows.map((r) => (
                            <tr key={r.size} className="border-t border-border">
                              <td className="px-2 py-1 text-left font-medium">{r.size || "One size"}</td>
                              <td className="px-2 py-1 text-right">{r.unitCost == null ? "—" : usd(r.unitCost)}</td>
                              <td className="px-2 py-1 text-right">{r.shipping == null ? "—" : usd(r.shipping)}</td>
                              <td className="px-2 py-1 text-right font-medium">{r.total == null ? "—" : usd(r.total)}</td>
                              <td className="px-2 py-1 text-right">
                                <input
                                  value={sizeRetail[r.size] ?? ""}
                                  onChange={(e) => setSizeRetail((p) => ({ ...p, [r.size]: e.target.value.replace(/[^0-9.]/g, "") }))}
                                  placeholder={retailN > 0 ? retailN.toFixed(2) : "—"}
                                  inputMode="decimal"
                                  aria-label={`Retail price for size ${r.size || "one size"}`}
                                  className="h-7 w-20 rounded border border-input bg-transparent px-1.5 text-right text-xs tabular-nums transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                />
                              </td>
                              <td className={"px-2 py-1 text-right font-semibold " + (r.margin != null && r.margin < 0 ? "text-destructive" : "")}>
                                {r.margin == null ? "—" : `${usd(r.margin)}${r.pct != null ? ` · ${r.pct.toFixed(0)}%` : ""}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* A dash in the table means "we don't know", which reads identically to
                        "it's free" unless we say which. */}
                    {sizeRows.some((r) => r.total == null) && (
                      <p className="text-xs text-amber-700">Some sizes have no price set on the blank — add pricing in Products.</p>
                    )}
                    {retailN <= 0 && !Object.values(sizeRetail).some((v) => Number(v) > 0) && (
                      <p className="text-xs text-muted-foreground">Enter a retail price to see profit per size.</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Retail is per size — leave a row blank to use the price above. Profit updates as you type.
                    </p>
                    {anyLoss && <p className="text-xs text-destructive">Sizes shown in red sell at a loss at this retail price.</p>}
                  </div>
                ) : quote?.unitCost == null ? (
                  <p className="text-xs text-amber-700">
                    That blank has no price set, so we can&apos;t work out a margin. Add pricing to it in Products.
                  </p>
                ) : (
                  <dl className="space-y-2">
                    <div className="flex justify-between"><dt className="text-muted-foreground">Production</dt><dd className="tabular-nums">{usd(quote.unitCost)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd className="tabular-nums">{usd(quote.shipping ?? 0)}</dd></div>
                    <div className="flex justify-between border-t border-border pt-2"><dt className="text-muted-foreground">Your cost</dt><dd className="font-medium tabular-nums">{usd(cost ?? 0)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Retail</dt><dd className="tabular-nums">{retailN > 0 ? usd(retailN) : "—"}</dd></div>
                    <div className={"flex justify-between border-t border-border pt-2 font-semibold " + (margin != null && margin < 0 ? "text-destructive" : "")}>
                      <dt>Profit / unit</dt>
                      <dd className="tabular-nums">
                        {margin == null ? "—" : `${usd(margin)}${marginPct != null ? ` · ${marginPct.toFixed(0)}%` : ""}`}
                      </dd>
                    </div>
                    {margin != null && margin < 0 && (
                      <p className="text-xs text-destructive">This sells at a loss — raise the retail price.</p>
                    )}
                  </dl>
                )}
              </div>

              {result && !result.ok && <p className="text-sm text-destructive">{result.text}</p>}

              {/* IP warning — only for the competitor's OWN photos, and only until the
                  seller acknowledges it. Publishing someone else's images to your shop can
                  get a listing pulled and, repeated, put the shop at risk. */}
              {borrowedPhotos.length > 0 && !ipConfirmed && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">
                    {borrowedPhotos.length} of these photos {borrowedPhotos.length === 1 ? "is the competitor's" : "are the competitor's"} own image{borrowedPhotos.length === 1 ? "" : "s"}.
                  </p>
                  <p className="mt-1 text-amber-800">
                    Publishing them to your {channel === "tiktok" ? "TikTok" : "Etsy"} shop may breach the
                    marketplace&apos;s intellectual-property policy and put the shop at risk. Swap in your
                    own artwork, or attach them anyway.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={removeBorrowedPhotos}
                      className="rounded-md border border-amber-400 bg-white px-2.5 py-1 font-medium text-amber-900 transition-colors hover:bg-amber-100"
                    >
                      Remove their photos
                    </button>
                    <button
                      onClick={() => setIpConfirmed(true)}
                      className="rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-amber-700"
                    >
                      Attach anyway
                    </button>
                  </div>
                </div>
              )}
              {borrowedPhotos.length > 0 && ipConfirmed && (
                <p className="text-xs text-amber-700">
                  Attaching {borrowedPhotos.length} competitor photo{borrowedPhotos.length === 1 ? "" : "s"} — replace {borrowedPhotos.length === 1 ? "it" : "them"} with your own before this draft goes live.
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={publish} disabled={busy || (borrowedPhotos.length > 0 && !ipConfirmed)}>
                  {busy ? <CircleNotch size={15} className="animate-spin" /> : <><Storefront size={14} weight="bold" /> Publish draft</>}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {channel === "tiktok"
                  ? "Creates a DRAFT product on your connected TikTok Shop for you to review, then list."
                  : "Creates a DRAFT in your connected Etsy shop, reusing an existing listing’s category & shipping profile."}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Placeholder icon export kept for parity with the old dialogs' empty state. */
export const PublishEmptyIcon = Package

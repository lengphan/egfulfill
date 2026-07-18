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
import { getSpecQuote, publishEtsy, getSpydeckTrending, getCatalogProducts, type CatalogProduct, type SpecQuote } from "@/lib/api"

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const MAX_TAGS = 13
const MAX_IMAGES = 10 // Etsy's hard limit — an 11th slot silently never publishes.
const cleanTag = (raw: string) => raw.replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 20)

/** Everything a source can prefill. Whatever it can't fill stays empty and editable. */
export type PublishPrefill = {
  title?: string
  description?: string
  price?: number | string | null
  tags?: string[]
  images?: string[]
  /** Catalog product to produce this on. Sets the cost side of the margin. */
  blank?: CatalogProduct | null
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
  onPublished?: (url?: string) => void
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
  const [quote, setQuote] = useState<SpecQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const seeded = useRef(false)

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
      getSpydeckTrending().then((r) => setSuggested((r.keywords ?? []).slice(0, 12))).catch(() => {})
      getCatalogProducts().then((rows) => { catalogRef.current = rows ?? [] }).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [open, prefill])

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

  // Cost comes from the server's pricing path — the same one that bills an order, so the
  // margin shown here is the margin actually earned.
  useEffect(() => {
    let live = true
    const id = setTimeout(() => {
      if (!live) return
      if (!blank?.name) { setQuote(null); return }
      getSpecQuote({ blank: blank.name, sku: blank.sku, size, printType: method })
        .then((r) => { if (live) setQuote(r) })
        .catch(() => { if (live) setQuote(null) })
    }, 0)
    return () => { live = false; clearTimeout(id) }
  }, [blank, size, method])

  const cost = quote?.total ?? null
  const retailN = Number(retail) || 0
  const margin = cost != null && retailN > 0 ? retailN - cost : null
  const marginPct = margin != null && retailN > 0 ? (margin / retailN) * 100 : null

  const addTag = (raw: string) => {
    const t = cleanTag(raw)
    if (!t) return
    setTags((p) => (p.some((x) => x.toLowerCase() === t.toLowerCase()) || p.length >= MAX_TAGS ? p : [...p, t]))
    setTagDraft("")
  }
  const removeTag = (t: string) => setTags((p) => p.filter((x) => x !== t))
  const addImages = (files: FileList | null) => {
    for (const f of Array.from(files ?? []).slice(0, MAX_IMAGES)) {
      readImageFile(f, (url) => setImages((p) => (p.length >= MAX_IMAGES ? p : [...p, url])), (m) => setResult({ ok: false, text: m }))
    }
  }
  const makePrimary = (i: number) => setImages((p) => [p[i], ...p.filter((_, x) => x !== i)])
  const removeImage = (i: number) => setImages((p) => p.filter((_, x) => x !== i))

  const publish = async () => {
    if (!title.trim() || !(retailN > 0)) { setResult({ ok: false, text: "A title and a retail price are required." }); return }
    setBusy(true); setResult(null)
    try {
      const r = await publishEtsy({
        title: title.trim(), description: desc.trim() || title.trim(),
        price: retailN, quantity: Number(qty) || 999,
        image: images[0], images, tags,
      })
      if (r.error) throw new Error(r.error)
      setResult({ ok: true, text: "Published as a draft listing", url: r.url })
      onPublished?.(r.url)
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Publish failed." })
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>{dialogTitle}</DialogTitle></DialogHeader>

        {result?.ok ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="font-semibold text-emerald-600">{result.text}</div>
            {result.url && <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">View the listing →</a>}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <div className="grid max-h-[72vh] gap-5 overflow-y-auto pr-1 md:grid-cols-[1.1fr_1fr]">
            {/* LEFT — what the listing looks like */}
            <div className="space-y-4">
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
                  onPick={(p) => { setBlankText(p.name); setBlank(catalogRef.current.find((x) => String(x.sku ?? "") === p.sku) ?? null) }}
                  onBrowse={() => {}}
                  placeholder="Pick the blank to print on"
                />
                <p className="text-xs text-muted-foreground">
                  Sets what we produce, and the cost behind your margin.
                </p>
              </div>

              {blank && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Size priced</span>
                    <select value={size} onChange={(e) => setSize(e.target.value)} className="h-9 rounded-lg border border-border bg-card px-2 text-xs font-medium">
                      {sizeOpts.length === 0 && <option value="">Any</option>}
                      {sizeOpts.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Method</span>
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-lg border border-border bg-card px-2 text-xs font-medium">
                      {methodOpts.length === 0 && <option value="">Any</option>}
                      {methodOpts.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {blank && colorOpts.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Colours offered ({colorOpts.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {colorOpts.slice(0, 12).map((c) => (
                      <span key={c} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{prettyColorName(c)}</span>
                    ))}
                    {colorOpts.length > 12 && <span className="text-[11px] text-muted-foreground">+{colorOpts.length - 12}</span>}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1"><span className="text-sm font-medium">Retail price ($)</span>
                  <Input value={retail} onChange={(e) => setRetail(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="24.00" inputMode="decimal" />
                </label>
                <label className="flex flex-col gap-1"><span className="text-sm font-medium">Quantity</span>
                  <Input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" />
                </label>
              </div>

              {/* The economics the old dialogs never showed. */}
              <dl className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
                {!blank ? (
                  <p className="text-xs text-muted-foreground">Pick a base product to see your cost and margin.</p>
                ) : quote?.unitCost == null ? (
                  <p className="text-xs text-amber-700">
                    That blank has no price set, so we can&apos;t work out a margin. Add pricing to it in Products.
                  </p>
                ) : (
                  <>
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
                  </>
                )}
              </dl>

              {result && !result.ok && <p className="text-sm text-destructive">{result.text}</p>}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={publish} disabled={busy}>
                  {busy ? <CircleNotch size={15} className="animate-spin" /> : <><Storefront size={14} weight="bold" /> Publish draft</>}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Creates a DRAFT in your connected Etsy shop, reusing an existing listing&apos;s category &amp; shipping profile.
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

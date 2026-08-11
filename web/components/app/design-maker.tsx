"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Storefront, UploadSimple, FolderOpen, TextT, Trash, Image as ImageIcon, CircleNotch, Export, FloppyDisk, Stack } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DesignStage, DEFAULT_POS, readImageFile, type Pos, type TextLayer } from "@/components/app/design-canvas"
import { ProductPickerDialog, type PickedProduct } from "@/components/app/product-picker-dialog"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { saveDesignLibrary, saveTemplate, getTemplates, getCatalogProducts, getProductTypes, getSellerImages, uploadSellerImage, deleteSellerImage, getOrderUploads, type CatalogProduct, type SellerImage, type OrderUpload } from "@/lib/api"
import { canvasReadableSrc } from "@/lib/thread-match"
import { printZoneOf, BASE_PRINT_IN } from "@/lib/print-zone"
import { mockupFaces, setTypeMockups, typeMockupOf, typeSidesOf } from "@/lib/variant-resolve"
import { useRouter } from "next/navigation"
import { stashPublishDraft } from "@/lib/publish-draft"
import { DesignLabTabs } from "@/components/app/design-lab-tabs"

// The blank to DESIGN on. Falls back to the type's default mockup (Settings → Platform)
// when the product has no imagery of its own — that outline exists precisely so a new
// hat or sweatshirt can be positioned without uploading a mockup per product.
//
// This fallback is deliberately scoped to DESIGN surfaces: the catalog has its own
// resolver and never sees it, so a category outline can't end up as a product's listing
// image. Design maker, mini designer and positioning only.
const mockupOf = (p: CatalogProduct) =>
  p.img || p.image || p.hero || p.images?.[0] ||
  (p.colorImages ? Object.values(p.colorImages).find(Boolean) || "" : "") ||
  typeMockupOf(p) || ""

// Composite the artwork + text layers onto a transparent square canvas → PNG data URL.
// (Only data-URL sources are drawn, so the canvas never taints.)
function composeDesign(designUrl: string, pos: Pos, texts: TextLayer[], size = 900): Promise<string> {
  return new Promise((resolve) => {
    const c = document.createElement("canvas"); c.width = size; c.height = size
    const ctx = c.getContext("2d")
    if (!ctx) { resolve(designUrl); return }
    const drawTexts = () => {
      for (const t of texts) {
        const px = (t.size / 100) * size
        ctx.save()
        ctx.translate((t.x / 100) * size, (t.y / 100) * size)
        ctx.rotate((t.r * Math.PI) / 180)
        ctx.font = `${t.bold ? 800 : 600} ${px}px Inter, system-ui, sans-serif`
        ctx.fillStyle = t.color
        ctx.textAlign = "center"; ctx.textBaseline = "middle"
        ctx.fillText(t.text || "", 0, 0)
        ctx.restore()
      }
      try { resolve(c.toDataURL("image/png")) } catch { resolve(designUrl) }
    }
    if (!designUrl) { drawTexts(); return }
    const img = new Image()
    img.onload = () => {
      const w = (pos.w / 100) * size
      const h = w * ((img.naturalHeight || 1) / (img.naturalWidth || 1))
      ctx.save()
      ctx.translate((pos.x / 100) * size, (pos.y / 100) * size)
      ctx.rotate((pos.r * Math.PI) / 180)
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
      ctx.restore()
      drawTexts()
    }
    img.onerror = () => drawTexts()
    img.src = designUrl
  })
}

const rid = () => "t" + Math.random().toString(36).slice(2, 8)

// One image in the library grid. Click to place it on the canvas; buyer art carries the
// order it came from, and your own uploads carry a remove control. `src` is the DISPLAY
// url (Etsy blocks hotlinking, so buyer art must come through the proxy); `url` is the raw
// value handed to onPlace. R2 uploads pass raw — the proxy only allows etsystatic.
function ImageThumb({ url, src, name, badge, onPlace, onDelete }: {
  url: string; src?: string; name?: string; badge?: string; onPlace: () => void; onDelete?: () => void
}) {
  return (
    <div className="group/thumb relative">
      <button
        type="button" onClick={onPlace} title={name || "Place on the design"}
        className="block aspect-square w-full overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-primary/50"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src ?? url} alt={name || ""} className="size-full object-cover" />
      </button>
      {badge && <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1 text-3xs font-medium text-white">{badge}</span>}
      {onDelete && (
        <button
          type="button" onClick={onDelete} title="Remove from your library"
          className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600 group-hover/thumb:flex"
        >
          <Trash size={11} weight="bold" />
        </button>
      )}
    </div>
  )
}

export function DesignMaker() {
  const search = useSearchParams()
  const productParam = search.get("product")
  const templateParam = search.get("template")
  const [mockup, setMockup] = useState("")
  // Kept alongside the mockup so the printable zone can be resolved from the product's
  // own printAreas (falling back to its garment type).
  const [product, setProduct] = useState<CatalogProduct | null>(null)
  // Which face of the garment we're designing. A blank with back/sleeve/hood mockups has
  // a different print zone on each, so the side has to drive BOTH the image and the zone —
  // designing a back print against the front's zone puts the artwork in the wrong place.
  const [side, setSide] = useState("front")
  // A product's OWN per-side images win. Otherwise fall back to the category's sides and
  // outlines — that's the whole point of defining them once per type: fifty hats inherit
  // four faces without fifty uploads.
  const ownFaces = mockupFaces(product, null)
  const faces = ownFaces.length > 1
    ? ownFaces
    : typeSidesOf(product)
        .map((sd) => ({ side: sd, url: typeMockupOf(product, sd) || (sd === "front" ? ownFaces[0]?.url ?? "" : "") }))
        .filter((f) => f.url)
  // Fall back to the single mockup when a product defines no per-side images, so a blank
  // without them behaves exactly as before rather than losing its picture.
  const faceUrl = faces.find((f) => f.side === side)?.url || (side === "front" ? typeMockupOf(product) : "")
  const [paW, setPaW] = useState(String(BASE_PRINT_IN.w))
  const [paH, setPaH] = useState(String(BASE_PRINT_IN.h))
  const [dragOver, setDragOver] = useState(false)
  // Built when Publish opens: the composed design becomes the primary photo and the
  // blank already picked here carries over, so the dialog opens ready rather than blank.
  // The full catalog, so a product picked from the dialog (which hands back a flattened
  // shape) can be resolved to its catalog row for the print zone.
  const catalogRef = useRef<CatalogProduct[]>([])
  // Minted on FIRST save, not during render (an impure call there is unstable across
  // re-renders). Held so re-saving UPDATES the same template rather than piling up
  // duplicates, and set to the source id when a template is reopened.
  const templateId = useRef<string | null>(null)
  const [designUrl, setDesignUrl] = useState("")
  const [pos, setPos] = useState<Pos>(DEFAULT_POS)
  const [texts, setTexts] = useState<TextLayer[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  // Only the failure needs state now: publishing navigates away, so there is nothing
  // "open" to track — but a draft too large to stash has to be said, not swallowed.
  const [pubErr, setPubErr] = useState("")
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null)
  // Images library: the seller's own reusable uploads + buyer art from their orders.
  const [sellerImages, setSellerImages] = useState<SellerImage[]>([])
  const [orderUploads, setOrderUploads] = useState<OrderUpload[]>([])
  const [imagesLoading, setImagesLoading] = useState(true)

  // Load the catalog once. Opened from a product ("Start designing") → preload that
  // product's mockup as the blank.
  // Category mockups, so a product with no imagery of its own still resolves to the right
  // silhouette instead of an empty stage.
  useEffect(() => {
    const t = setTimeout(() => { getProductTypes().then(setTypeMockups).catch(() => {}) }, 0)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const id = setTimeout(() => {
      getCatalogProducts()
        .then((rows) => {
          catalogRef.current = rows ?? []
          if (!productParam) return
          const p = catalogRef.current.find((x) => String(x.id) === productParam || String(x.sku) === productParam)
          if (p) { setMockup(mockupOf(p)); setProduct(p); setSide("front") }
        })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [productParam])

  // The picker returns a flattened PickedProduct; the zone needs the catalog row, so
  // look it back up by SKU.
  const catalogFor = (sku: string): CatalogProduct | null =>
    catalogRef.current.find((x) => String(x.sku ?? "") === sku) ?? null

  // Reopening a template restores the PIECES (artwork, position, text, blank, print
  // area) — that's the whole point of a template over a library image, which is flat.
  useEffect(() => {
    if (!templateParam) return
    const id = setTimeout(() => {
      getTemplates()
        .then((rows) => {
          const t = (rows ?? []).find((x) => String(x.id) === templateParam)
          if (!t) return
          const l = (t.layers ?? {}) as { designUrl?: string; pos?: Pos; texts?: TextLayer[] }
          const d = (t.data ?? {}) as { blank?: string | null; printArea?: { w?: number; h?: number } }
          templateId.current = String(t.id)
          if (t.name) setName(t.name)
          if (l.designUrl) setDesignUrl(l.designUrl)
          if (l.pos) setPos(l.pos)
          if (Array.isArray(l.texts)) setTexts(l.texts)
          if (d.printArea?.w) setPaW(String(d.printArea.w))
          if (d.printArea?.h) setPaH(String(d.printArea.h))
          const p = d.blank ? catalogRef.current.find((x) => x.name === d.blank) : null
          if (p) { setProduct(p); setMockup(mockupOf(p)); setSide("front") }
        })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [templateParam])

  // Load the Images library (own uploads + order art). Kept as a plain fn so an upload
  // or delete can refresh it without re-running the mount effect.
  const refreshImages = () => {
    getSellerImages().then((r) => setSellerImages(r.images ?? [])).catch(() => {})
    getOrderUploads().then((r) => setOrderUploads(r.images ?? [])).catch(() => {}).finally(() => setImagesLoading(false))
  }
  useEffect(() => {
    const t = setTimeout(refreshImages, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Place a library image on the canvas. Remote URLs (R2, marketplace) go through the img
  // proxy so the composed canvas stays SAME-ORIGIN and can export (a tainted canvas throws
  // on toDataURL). A data: url (a fresh local upload) is already same-origin.
  const placeImage = (url: string) => {
    setDesignUrl(url.startsWith("data:") ? url : canvasReadableSrc(url))
    setPos(DEFAULT_POS); setSelected("image")
  }
  // Upload → place it now AND keep it in "Your uploads" so it's reusable next time.
  const onUploadImage = (file: File | undefined) => {
    readImageFile(file, (dataUrl) => {
      setDesignUrl(dataUrl); setPos(DEFAULT_POS); setSelected("image")
      uploadSellerImage(dataUrl, file?.name).then((r) => { if (r.image) refreshImages() }).catch(() => {})
    }, (m) => setMsg({ tone: "err", text: m }))
  }
  const removeImage = (id: string) => {
    setSellerImages((prev) => prev.filter((im) => im.id !== id))
    deleteSellerImage(id).catch(() => refreshImages())
  }

  const updateText = (id: string, patch: Partial<TextLayer>) =>
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const addText = () => {
    const t: TextLayer = { id: rid(), text: "Your text", x: 50, y: 70, size: 9, r: 0, color: "#111827", bold: true }
    setTexts((prev) => [...prev, t]); setSelected(t.id)
  }
  const removeText = (id: string) => { setTexts((prev) => prev.filter((t) => t.id !== id)); setSelected(null) }
  const selText = texts.find((t) => t.id === selected)

  const saveAsTemplate = async () => {
    if (!designUrl && texts.length === 0) { setMsg({ tone: "err", text: "Add artwork or text first." }); return }
    setSaving(true); setMsg(null)
    try {
      const composed = await composeDesign(designUrl, pos, texts, 640)
      // `layers` is what makes this REOPENABLE — the library stores a flattened image,
      // a template stores the pieces plus which blank they were placed on.
      templateId.current ??= `TPL-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const r = await saveTemplate({
        id: templateId.current,
        name: name.trim() || "Untitled template",
        composite: composed,
        data: { blank: product?.name ?? null, blankSku: product?.sku ?? null, printArea: { w: Number(paW), h: Number(paH) } },
        layers: { designUrl, pos, texts },
      })
      if (r.error) throw new Error(r.error)
      setMsg({ tone: "ok", text: "Saved as a template." })
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "Couldn't save the template." })
    } finally { setSaving(false) }
  }

  const saveToLibrary = async () => {
    if (!designUrl && texts.length === 0) { setMsg({ tone: "err", text: "Add artwork or text first." }); return }
    setSaving(true); setMsg(null)
    try {
      const composed = await composeDesign(designUrl, pos, texts, 640)
      const r = await saveDesignLibrary({ name: name.trim() || "Untitled design", data: composed, thumb: composed })
      if (r.error) throw new Error(r.error)
      setMsg({ tone: "ok", text: "Saved to your library." })
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "Couldn't save." })
    } finally { setSaving(false) }
  }

  return (
    <div className="flex h-[calc(100svh-7rem)] flex-col gap-3">
      <div className="flex items-center gap-3">
        <DesignLabTabs />
        {msg && <span className={"ml-2 text-sm " + (msg.tone === "ok" ? "text-success" : "text-destructive")}>{msg.text}</span>}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Left: sources + layers */}
        <aside className="hidden w-60 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-3 lg:flex">
          <div className="space-y-1.5">
            <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Blank</div>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setPickerOpen(true)}><Storefront size={15} weight="bold" /> {mockup ? "Change blank" : "Pick a blank"}</Button>
          </div>
          {/* Print area — the printable rectangle scales against a 12x16 base, matching
              what production actually trims to. */}
          <div className="space-y-1.5">
            <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Print area (in)</div>
            <div className="flex items-center gap-1.5">
              <Input value={paW} onChange={(e) => setPaW(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-8 text-xs" aria-label="Print area width in inches" />
              <span className="text-xs text-muted-foreground">x</span>
              <Input value={paH} onChange={(e) => setPaH(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-8 text-xs" aria-label="Print area height in inches" />
            </div>
          </div>
          {/* Images — your reusable uploads + buyer art from your orders. Upload keeps a
              copy in "Your uploads"; click any thumbnail to drop it on the design. */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Images</div>
              <label className="flex cursor-pointer items-center gap-1 text-2xs font-medium text-primary hover:underline">
                <UploadSimple size={12} weight="bold" /> Upload
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onUploadImage(e.target.files?.[0])} />
              </label>
            </div>
            {imagesLoading ? (
              <div className="flex justify-center py-2"><CircleNotch size={16} className="animate-spin text-muted-foreground" /></div>
            ) : (sellerImages.length === 0 && orderUploads.length === 0) ? (
              <p className="px-1 text-2xs text-muted-foreground">Upload an image to reuse it — and buyer art from your connected stores shows up here automatically.</p>
            ) : (
              <>
                {sellerImages.length > 0 && (
                  <>
                    <div className="text-3xs font-medium text-muted-foreground">Your uploads</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {sellerImages.map((im) => <ImageThumb key={im.id} url={im.url} name={im.name} onPlace={() => placeImage(im.url)} onDelete={() => removeImage(im.id)} />)}
                    </div>
                  </>
                )}
                {orderUploads.length > 0 && (
                  <>
                    <div className="mt-1 text-3xs font-medium text-muted-foreground">From your orders</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {orderUploads.map((im, i) => <ImageThumb key={im.url + i} url={im.url} src={canvasReadableSrc(im.url)} name={im.name} badge={im.orderRef} onPlace={() => placeImage(im.url)} />)}
                    </div>
                  </>
                )}
              </>
            )}
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setLibOpen(true)}><FolderOpen size={15} weight="bold" /> Saved designs</Button>
          </div>
          <div className="space-y-1.5">
            <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Text</div>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={addText}><TextT size={15} weight="bold" /> Add text</Button>
          </div>
          <div className="space-y-1.5">
            <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Layers</div>
            {designUrl && (
              <button onClick={() => setSelected("image")} className={"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors " + (selected === "image" ? "bg-primary/10 text-primary" : "hover:bg-accent")}><ImageIcon size={14} weight="duotone" /> Artwork</button>
            )}
            {texts.map((t) => (
              <button key={t.id} onClick={() => setSelected(t.id)} className={"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors " + (selected === t.id ? "bg-primary/10 text-primary" : "hover:bg-accent")}>
                <TextT size={14} /> <span className="truncate">{t.text || "Text"}</span>
              </button>
            ))}
            {!designUrl && texts.length === 0 && <div className="px-2 text-xs text-muted-foreground">Add artwork or text to start.</div>}
          </div>
        </aside>

        {/* Center: canvas */}
        <div className="eg-studio-bed flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border p-4">
          {/* The stage is a SQUARE, so it has to be bounded by both dimensions. Sized to
              full width alone, its height matched that width and the mockup ran off the
              top and bottom of the panel — the cap was cut off by the frame. Capping the
              width by viewport height keeps the whole square visible. */}
          <div className="flex h-full max-h-full w-full flex-col items-center justify-center gap-3">
            {/* Position pills — only when the blank actually has more than one face. A
                single-face blank showing a lone "Front" pill is noise, not a choice. */}
            {faces.length > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-card/80 p-0.5 backdrop-blur">
                {faces.map((f) => (
                  <button
                    key={f.side}
                    onClick={() => setSide(f.side)}
                    className={
                      "eg-tap rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors " +
                      (side === f.side ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {f.side}
                  </button>
                ))}
              </div>
            )}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false)
                readImageFile(e.dataTransfer.files?.[0], (u) => { setDesignUrl(u); setPos(DEFAULT_POS); setSelected("image") }, (m) => setMsg({ tone: "err", text: m }))
              }}
              className={"relative w-full max-w-[min(100%,calc(100svh-12rem))] rounded-xl transition-shadow " + (dragOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "")}
            >
              <DesignStage
                className="w-full"
                mockup={faceUrl || mockup} designUrl={designUrl} pos={pos} setPos={setPos}
                onRemove={() => setDesignUrl("")} texts={texts} updateText={updateText}
                selected={selected} onSelect={setSelected}
                printZone={printZoneOf(product, side, { w: Number(paW) || BASE_PRINT_IN.w, h: Number(paH) || BASE_PRINT_IN.h })}
                printLabel={`${Number(paW) || BASE_PRINT_IN.w}" x ${Number(paH) || BASE_PRINT_IN.h}" print area`}
              />
              {dragOver && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary/10 text-sm font-medium text-primary">
                  Drop artwork to place it
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: properties + actions */}
        <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-4 lg:flex">
          {selText ? (
            <div className="space-y-3">
              <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Text</div>
              <Input value={selText.text} onChange={(e) => updateText(selText.id, { text: e.target.value })} placeholder="Your text" />
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Size</span>
                <input type="range" min={3} max={24} value={selText.size} onChange={(e) => updateText(selText.id, { size: Number(e.target.value) })} className="flex-1" />
              </label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">Color
                  <input type="color" value={selText.color} onChange={(e) => updateText(selText.id, { color: e.target.value })} className="size-7 rounded border border-border" />
                </label>
                <label className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input type="checkbox" checked={!!selText.bold} onChange={(e) => updateText(selText.id, { bold: e.target.checked })} /> Bold
                </label>
              </div>
              <Button variant="outline" size="sm" onClick={() => removeText(selText.id)} className="text-red-600 hover:text-red-700"><Trash size={14} weight="bold" /> Delete text</Button>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Select a layer to edit it, or add artwork/text from the left.</div>
          )}

          <div className="mt-auto space-y-2 border-t border-border pt-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Design name" />
            <Button variant="outline" className="w-full" onClick={saveAsTemplate} disabled={saving}>
              {saving ? <CircleNotch size={15} className="animate-spin" /> : <><Stack size={15} weight="bold" /> Save as template</>}
            </Button>
            <Button variant="outline" className="w-full" onClick={saveToLibrary} disabled={saving}>
              {saving ? <CircleNotch size={15} className="animate-spin" /> : <><FloppyDisk size={15} weight="bold" /> Save to library</>}
            </Button>
            <Button
              className="w-full"
              onClick={async () => {
                const composed = await composeDesign(designUrl, pos, texts, 1200)
                // images[] is the composite the BUYER sees; designUrl is the artwork the
                // FACTORY needs. Sending only the composite is why published listings
                // produced orders with nothing to digitise.
                // Publishing is its own PAGE now, so the listing travels through
                // sessionStorage rather than as a prop — see lib/publish-draft.ts. A failed
                // stash is said out loud: navigating to a page whose draft was never stored
                // would land on an empty form with no explanation.
                const id = stashPublishDraft({
                  prefill: { title: name, images: composed ? [composed] : [], blank: product, designUrl, designPos: pos },
                  returnTo: "/design/maker",
                  returnLabel: "Back to Design maker",
                  title: "Publish product",
                })
                if (!id) { setPubErr("Couldn't open the publish page — this design is too large for the browser to hand over."); return }
                router.push(`/publish?d=${id}`)
              }}
              disabled={!designUrl && texts.length === 0}
            >
              <Export size={15} weight="bold" /> Publish product
            </Button>
            {pubErr && <p className="text-xs text-destructive">{pubErr}</p>}
          </div>
        </aside>
      </div>

      <ProductPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={(p: PickedProduct) => {
          // Resolve through mockupOf, not p.img — the picker's img is empty for a product
          // with no imagery, which skipped the type-default fallback entirely.
          const cp = catalogFor(p.sku)
          setProduct(cp)
          setMockup(p.img || (cp ? mockupOf(cp) : ""))
          setSide("front")
        }} />
      <LibraryPickerDialog open={libOpen} onOpenChange={setLibOpen} onPick={(u) => { setDesignUrl(u); setPos(DEFAULT_POS); setSelected("image") }} />
    </div>
  )
}

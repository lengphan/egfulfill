"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Storefront, UploadSimple, FolderOpen, TextT, Trash, Image as ImageIcon, CircleNotch, Export, FloppyDisk, Stack, MagnifyingGlass, Eraser, ArrowCounterClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DesignStage, DEFAULT_POS, readImageFile, type Pos, type TextLayer } from "@/components/app/design-canvas"
import { ProductPickerDialog, type PickedProduct } from "@/components/app/product-picker-dialog"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { ArtPickerDialog, type ArtItem } from "@/components/app/art-picker-dialog"
import { saveDesignLibrary, saveTemplate, getTemplates, getCatalogProducts, getProductTypes, getSellerImages, uploadSellerImage, deleteSellerImage, getOrderUploads, type CatalogProduct, type SellerImage, type OrderUpload } from "@/lib/api"
import { canvasReadableSrc } from "@/lib/thread-match"
import { useBackgroundRemoval } from "@/lib/remove-background"
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
//
// The order number used to sit in a black chip ON the thumbnail. At 60px wide that chip
// covered the part of the picture you were trying to recognise, so every buyer upload
// looked like a black bar with some art around it. It is a CAPTION now, under the image,
// where it labels the thumbnail instead of hiding it — and the full-size view with the
// order number is a click away in the browse dialog.
function ImageThumb({ url, src, name, badge, title, onPlace, onDelete }: {
  url: string; src?: string; name?: string; badge?: string; title?: string; onPlace: () => void; onDelete?: () => void
}) {
  return (
    <div className="group/thumb relative">
      <button
        type="button" onClick={onPlace} title={title || [badge, name].filter(Boolean).join(" · ") || "Place on the design"}
        className="block w-full overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-primary/50"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src ?? url} alt={name || ""} className="aspect-square w-full object-cover" />
        {badge && (
          <span className="block truncate border-t border-border bg-card px-1 py-0.5 text-3xs font-medium text-muted-foreground">
            {badge}
          </span>
        )}
      </button>
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

/**
 * How many images each source shows in the rail before it defers to Browse.
 *
 * SIX — two rows of three. The rail is one column of a three-column workspace; it is a
 * shortcut to the few you just used, not a file manager. It was rendering all 300 buyer
 * uploads, which pushed Text and Layers so far down the panel that people did not know
 * they were there.
 */
const RAIL_LIMIT = 6

/**
 * The order reference, shortened for a 60px caption.
 *
 * A marketplace ref is `etsy-4142313274`, and the rail has room for about ten characters —
 * so the full value truncates to "etsy-4142…" on EVERY tile, which is a label that tells you
 * nothing and looks like a bug. The channel prefix is the part they all share, so it is the
 * part to drop: "4142313274" is what distinguishes one from the next. Manual orders (`FF-…`)
 * and `#123` sequence numbers have no prefix and pass through untouched.
 *
 * The full value still rides on the tile's tooltip and shows in the browse dialog, which has
 * the width for it.
 */
const shortRef = (ref?: string) => {
  if (!ref) return ref
  const m = /^(etsy|shopify|tiktok|amazon)-(.+)$/i.exec(ref)
  return m ? m[2] : ref
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
  // Which image source the browse dialog is showing, or null when it's closed. One piece of
  // state rather than two booleans: they are the same dialog and can never both be open.
  const [browse, setBrowse] = useState<null | "uploads" | "orders">(null)
  // Background removal — the same hook the mini designer uses, so the two can't drift.
  const bg = useBackgroundRemoval(designUrl, setDesignUrl)
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

  const clearArtwork = () => { setDesignUrl(""); setSelected(null) }

  // What the browse dialog shows. Buyer art needs the proxy to DISPLAY (Etsy blocks
  // hotlinking) but the raw url to PLACE — same split the rail thumbnails make.
  const browseItems: ArtItem[] =
    browse === "uploads"
      ? sellerImages.map((im) => ({ url: im.url, name: im.name }))
      : browse === "orders"
        ? orderUploads.map((im) => ({ url: im.url, src: canvasReadableSrc(im.url), name: im.name, badge: im.orderRef }))
        : []

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
                    <div className="flex items-baseline justify-between">
                      <div className="text-3xs font-medium text-muted-foreground">Your uploads</div>
                      {sellerImages.length > RAIL_LIMIT && (
                        <button type="button" onClick={() => setBrowse("uploads")} className="text-3xs font-medium text-primary hover:underline">
                          All {sellerImages.length}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {sellerImages.slice(0, RAIL_LIMIT).map((im) => <ImageThumb key={im.id} url={im.url} name={im.name} onPlace={() => placeImage(im.url)} onDelete={() => removeImage(im.id)} />)}
                    </div>
                  </>
                )}
                {orderUploads.length > 0 && (
                  <>
                    <div className="mt-1 flex items-baseline justify-between">
                      <div className="text-3xs font-medium text-muted-foreground">From your orders</div>
                      {orderUploads.length > RAIL_LIMIT && (
                        <button type="button" onClick={() => setBrowse("orders")} className="text-3xs font-medium text-primary hover:underline">
                          All {orderUploads.length}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {orderUploads.slice(0, RAIL_LIMIT).map((im, i) => <ImageThumb key={im.url + i} url={im.url} src={canvasReadableSrc(im.url)} name={im.name} badge={shortRef(im.orderRef)} title={[im.orderRef, im.name].filter(Boolean).join(" · ")} onPlace={() => placeImage(im.url)} />)}
                    </div>
                    {orderUploads.length > RAIL_LIMIT && (
                      <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setBrowse("orders")}>
                        <MagnifyingGlass size={15} weight="bold" /> Browse order art
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setLibOpen(true)}><FolderOpen size={15} weight="bold" /> Saved designs</Button>
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
          {/* ADD, at the top of the panel you are already looking at.
              "Add text" used to sit in the left rail below the image grids, so once a seller
              had a few hundred buyer uploads it was several screens down and read as missing.
              Adding and editing a layer are one job; they belong on one side. */}
          <div className="space-y-1.5">
            <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Add</div>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={addText}>
              <TextT size={15} weight="bold" /> Add text
            </Button>
          </div>

          {selText ? (
            <div className="space-y-3 border-t border-border pt-3">
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
          ) : designUrl ? (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Artwork</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={designUrl} alt="" className="eg-checker h-24 w-full rounded-md border border-border object-contain" />
              <div className="space-y-1.5">
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Tolerance</span>
                  <input type="range" min={4} max={40} value={bg.tolerance} onChange={(e) => bg.changeTolerance(Number(e.target.value))} className="flex-1" aria-label="Background removal tolerance" />
                  <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{bg.tolerance}</span>
                </label>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={bg.run} disabled={bg.busy}>
                  {bg.busy ? <CircleNotch size={15} className="animate-spin" /> : <Eraser size={15} weight="bold" />}
                  {bg.busy ? "Working…" : "Remove background"}
                </Button>
                {bg.canUndo && (
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={bg.undo}>
                    <ArrowCounterClockwise size={15} weight="bold" /> Undo removal
                  </Button>
                )}
                {/* Said out loud, because "nothing happened" and "this image has no flat
                    backdrop to remove" look identical otherwise. */}
                {bg.msg && <p className="text-2xs text-muted-foreground">{bg.msg}</p>}
                <p className="text-2xs text-muted-foreground">
                  Clears the backdrop connected to the edges — no AI, nothing leaves your browser.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={clearArtwork} className="text-red-600 hover:text-red-700"><Trash size={14} weight="bold" /> Remove artwork</Button>
            </div>
          ) : (
            <div className="border-t border-border pt-3 text-sm text-muted-foreground">Place artwork from the left, or add text above, then select a layer to edit it.</div>
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
      {/* One dialog for both sources — the rail decides which list it is showing. */}
      <ArtPickerDialog
        open={browse !== null}
        onOpenChange={(v) => { if (!v) setBrowse(null) }}
        title={browse === "uploads" ? "Your uploads" : "Artwork from your orders"}
        items={browseItems}
        onPick={placeImage}
        emptyText={browse === "uploads" ? "You haven't uploaded anything yet." : "No buyer artwork has come in from your orders yet."}
        searchPlaceholder={browse === "uploads" ? "Search your uploads…" : "Search by order number or item…"}
      />
    </div>
  )
}

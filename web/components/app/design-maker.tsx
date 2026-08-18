"use client"

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { useSearchParams } from "next/navigation"
import { UploadSimple, TextT, Trash, CircleNotch, FloppyDisk, Stack, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DesignStage, DEFAULT_POS, readImageFile, type Pos, type TextLayer, type ImageLayer } from "@/components/app/design-canvas"
import { ProductPickerDialog, type PickedProduct } from "@/components/app/product-picker-dialog"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { ArtPickerDialog, type ArtItem } from "@/components/app/art-picker-dialog"
import { saveDesignLibrary, saveTemplate, getTemplates, getCatalogProducts, getProductTypes, getSellerImages, uploadSellerImage, deleteSellerImage, getOrderUploads, type CatalogProduct, type SellerImage, type OrderUpload, type ProductTemplate } from "@/lib/api"
import { canvasReadableSrc } from "@/lib/thread-match"
import { useBackgroundRemoval } from "@/lib/remove-background"
import { printZoneOf, BASE_PRINT_IN } from "@/lib/print-zone"
import { designFaces, setTypeMockups, typeMockupOf } from "@/lib/variant-resolve"
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
/**
 * FLATTEN THE STACK — every image layer, then every text, in that order.
 *
 * Took one artwork and drew it; the lab holds a list now, so it draws them back-to-front and
 * awaits each in turn. Sequential rather than Promise.all on purpose: layer order IS the
 * z-order, and racing the loads would composite them in whatever order the network returned.
 *
 * Text stays on top of every image. A caption under a logo is not a thing anyone has asked
 * for, and one predictable rule beats a per-layer z-index nobody sets.
 */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)   // a broken layer is skipped, never fatal to the flatten
    img.src = src
  })
}

/** The meter's three states. Amber and red are the reserved warning/alert hues and this is
 *  a warning about work, so it uses them rather than inventing a fourth signal colour. */
const QUALITY_TONE: Record<string, string> = {
  ok: "text-success",
  warn: "text-amber-600 dark:text-amber-500",
  bad: "text-destructive",
  unknown: "text-muted-foreground",
}

/** One face's worth of design. The editor holds a map of these keyed by side. */
export type SideStack = { images: ImageLayer[]; texts: TextLayer[] }
/** Shared, frozen, module-scope: a fresh `{ images: [], texts: [] }` per render would be a
 *  new object every time and defeat every equality check that reads it. */
const EMPTY_STACK: SideStack = Object.freeze({ images: [], texts: [] }) as SideStack

/**
 * WHAT A PLACED LAYER WOULD PRINT AT, in DPI.
 *
 * The one number a print-on-demand editor owes the person using it, and we published a
 * 300 DPI guideline on the marketing site while checking nothing at all.
 *
 * `pos.w` is a percentage of the STAGE, and the print area is a percentage of the same
 * stage — so the layer's share of the printable rectangle is pos.w / zone.w, and its
 * printed width in inches is that share of the area's real width. Pixels over inches is
 * the DPI. Nothing here is about the file's own DPI tag: a 500px image labelled 300 DPI
 * still only has 500 pixels to spend, which is the thing that actually goes soft.
 */
export function layerDpi(naturalW: number, posW: number, zoneW: number, areaInW: number): number | null {
  if (!(naturalW > 0) || !(posW > 0) || !(zoneW > 0) || !(areaInW > 0)) return null
  const printedInches = (posW / zoneW) * areaInW
  if (!(printedInches > 0)) return null
  return naturalW / printedInches
}

/** Green / amber / red, and what to say about it. 300 is the guideline we publish; 150 is
 *  the floor most DTG and DTF work is still acceptable at. */
export function dpiVerdict(dpi: number | null): { tone: "ok" | "warn" | "bad" | "unknown"; label: string } {
  if (dpi == null) return { tone: "unknown", label: "Measuring…" }
  if (dpi >= 300) return { tone: "ok", label: "Print quality: good" }
  if (dpi >= 150) return { tone: "warn", label: "Print quality: usable" }
  return { tone: "bad", label: "Print quality: too low" }
}

/**
 * THE PIXELS A PLACED IMAGE ACTUALLY HAS.
 *
 * Module-scope and content-keyed by src, so the same artwork on three layers is measured
 * once and a re-render never re-measures anything. Decoding is the whole cost here.
 */
const naturalCache = new Map<string, { w: number; h: number }>()

function useNaturalSizes(srcs: string[]): Map<string, { w: number; h: number }> {
  const key = srcs.join("\u0000")
  const [, setTick] = useState(0)
  useEffect(() => {
    const missing = key.split("\u0000").filter((u) => u && !naturalCache.has(u))
    if (!missing.length) return
    let live = true
    Promise.all(missing.map((u) => new Promise<void>((res) => {
      const im = new window.Image()
      im.crossOrigin = "anonymous"
      // A 0×0 entry is still an ANSWER — it stops this retrying a broken URL every render,
      // and layerDpi reads it as "can't tell" rather than as a quality verdict.
      im.onload = () => { naturalCache.set(u, { w: im.naturalWidth, h: im.naturalHeight }); res() }
      im.onerror = () => { naturalCache.set(u, { w: 0, h: 0 }); res() }
      im.src = u
    // Re-render once the whole batch is in, not once per image: a ten-layer design would
    // otherwise re-render ten times on open.
    }))).then(() => { if (live) setTick((n) => n + 1) })
    return () => { live = false }
  }, [key])
  return naturalCache
}

async function composeDesign(images: ImageLayer[], texts: TextLayer[], size = 900): Promise<string> {
  const c = document.createElement("canvas"); c.width = size; c.height = size
  const ctx = c.getContext("2d")
  const first = images[0]?.src ?? ""
  if (!ctx) return first
  for (const layer of images) {
    const img = await loadImage(layer.src)
    if (!img) continue
    const w = (layer.pos.w / 100) * size
    const h = w * ((img.naturalHeight || 1) / (img.naturalWidth || 1))
    ctx.save()
    ctx.translate((layer.pos.x / 100) * size, (layer.pos.y / 100) * size)
    ctx.rotate((layer.pos.r * Math.PI) / 180)
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    ctx.restore()
  }
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
  try { return c.toDataURL("image/png") } catch { return first }
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
          <span className="block truncate border-t border-border bg-card px-1 py-0.5 text-2xs font-medium text-muted-foreground">
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
  const [side, setSideRaw] = useState("front")
  /** Switching face CLEARS the selection. A layer id belongs to one side's stack, so a
   *  selection carried across would name a layer that isn't on the canvas — the action
   *  strip would sit there acting on something invisible. */
  const setSide = (s: string) => { setSideRaw(s); setSelected(null) }
  // A product's OWN photo wins PER SIDE, and the category's outline stands in on every side
  // it hasn't got one for — which is the point of defining them once per type: fifty hats
  // inherit four faces without fifty uploads, and a hat that disagrees about its back still
  // inherits the other three. The rule lives in variant-resolve rather than here, because a
  // per-side fallback written out at each call site is the kind that drifts one branch at a
  // time — which is how this one came to discard the category outlines wholesale.
  const faces = designFaces(product)
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
  /**
   * THE STACK. The lab held one artwork; a print is often several — a logo, a name, a badge —
   * and doing that meant flattening them in another tool first.
   *
   * Capped at MAX_LAYERS, the same number the server refuses past (templates.js). The cap is
   * about the editor as much as the storage: a layer list you cannot read is not a layer list.
   */
  const MAX_LAYERS = 10
  /**
   * ONE STACK PER SIDE — and this is the fix for a page that was quietly lying.
   *
   * `images` and `texts` were single arrays, and `side` changed nothing but the mockup
   * behind them and the print zone drawn on it. So a seller who pressed Back saw the back
   * of the garment carrying the FRONT's artwork, moved it, and moved the front print. The
   * faces looked like four designs and were one.
   *
   * The whole editor below still reads `images`/`texts` and writes through `setImages`/
   * `setTexts` — they are now the CURRENT side's, and the setters keep React's own
   * signature (value or updater) so nothing downstream had to learn about sides.
   *
   * The cap is per side. Ten layers is where a layer list stops being readable, and that
   * is true of one face at a time, not of a garment (server side: maxSideLayers).
   */
  const [stacks, setStacks] = useState<Record<string, SideStack>>({})
  const stack = stacks[side] ?? EMPTY_STACK
  const images = stack.images
  const texts = stack.texts
  const setImages: Dispatch<SetStateAction<ImageLayer[]>> = (v) =>
    setStacks((prev) => {
      const c = prev[side] ?? EMPTY_STACK
      const next = typeof v === "function" ? (v as (p: ImageLayer[]) => ImageLayer[])(c.images) : v
      return { ...prev, [side]: { images: next, texts: c.texts } }
    })
  const setTexts: Dispatch<SetStateAction<TextLayer[]>> = (v) =>
    setStacks((prev) => {
      const c = prev[side] ?? EMPTY_STACK
      const next = typeof v === "function" ? (v as (p: TextLayer[]) => TextLayer[])(c.texts) : v
      return { ...prev, [side]: { images: c.images, texts: next } }
    })
  /** The front's stack, by name rather than by "whichever side is open" — the legacy
   *  single-artwork fields mean the front, and a reader that predates sides can't ask. */
  const frontStack = stacks.front ?? EMPTY_STACK
  /** Which sides actually carry artwork — what the extra-side surcharge is counted from. */
  const paintedSides = Object.keys(stacks).filter((k) => (stacks[k]?.images.length ?? 0) > 0 || (stacks[k]?.texts.length ?? 0) > 0)
  /**
   * THE QUALITY METER. Printify has one; we published a 300 DPI guideline on the marketing
   * site and checked nothing at all, which is the worse of the two positions — a seller
   * finds out the artwork was too small when a customer holds the shirt.
   *
   * Read off the WORST layer on this side, not an average: one soft layer prints soft
   * whatever the rest of the stack does.
   */
  const areaIn = { w: Number(paW) || BASE_PRINT_IN.w, h: Number(paH) || BASE_PRINT_IN.h }
  const zone = printZoneOf(product, side, areaIn)
  const natural = useNaturalSizes(images.map((im) => im.src))
  const dpiOf = (im: ImageLayer) => layerDpi(natural.get(im.src)?.w ?? 0, im.pos.w, zone.w, areaIn.w)
  const measured = images.map(dpiOf).filter((d): d is number => d != null)
  const worstDpi = measured.length ? Math.min(...measured) : null
  const quality = dpiVerdict(images.length === 0 ? null : worstDpi)
  const nextLayerId = useRef(1)
  /**
   * EVERYTHING DECIDED BEFORE ANY STATE IS SET.
   *
   * This built the new layers INSIDE the setImages updater and called setMsg/setSelected from
   * in there. An updater must be pure — React runs it during render, and twice in StrictMode —
   * so setting other state from inside it throws, which is why dropping an image crashed the
   * page to "This page couldn't load".
   *
   * `images` is already in scope, so there is nothing the updater form was buying: the room
   * left, the ids and the offsets are all computed here, and the three setters are then
   * ordinary calls in an event handler, which is exactly where they belong.
   */
  const addImages = (srcs: { src: string; name?: string | null }[]) => {
    if (!srcs.length) return
    const room = Math.max(0, MAX_LAYERS - images.length)
    const added = srcs.slice(0, room).map((f, i) => ({
      id: `img-${nextLayerId.current++}`,
      src: f.src,
      name: f.name ?? null,
      // Each new layer lands slightly below the last so a second drop is visible rather
      // than hidden exactly behind the first.
      pos: { ...DEFAULT_POS, y: Math.min(80, DEFAULT_POS.y + (images.length + i) * 4) },
    }))
    const dropped = srcs.length - added.length
    if (dropped > 0) {
      setMsg({ tone: "err", text: `A design can hold ${MAX_LAYERS} layers — ${dropped} ${dropped === 1 ? "was" : "were"} left out.` })
    }
    if (!added.length) return
    setImages((prev) => [...prev, ...added])
    setSelected(added[added.length - 1].id)
  }
  const updateImage = (id: string, patch: Partial<Pos>) =>
    setImages((prev) => prev.map((im) => (im.id === id ? { ...im, pos: { ...im.pos, ...patch } } : im)))
  const dropLayer = (id: string) =>
    setImages((prev) => prev.filter((im) => im.id !== id))
  /**
   * BACKWARD COMPATIBILITY, in one place. Publish and the template's own `designUrl` field
   * both predate the stack and mean "the artwork": that is the bottom layer, which on every
   * design made before this is the only layer.
   */
  const designUrl = images[0]?.src ?? ""
  const setDesignUrl = (v: string) =>
    setImages((prev) => (v ? (prev.length ? prev.map((im, i) => (i === 0 ? { ...im, src: v } : im))
      : [{ id: `img-${nextLayerId.current++}`, src: v, name: null, pos: { ...DEFAULT_POS } }]) : prev.slice(1)))
  const [pos, setPos] = useState<Pos>(DEFAULT_POS)
  const [selected, setSelected] = useState<string | null>(null)
  /** The selected image layer, when the selection is one.
   *
   *  DECLARED AFTER `selected`, and that is the whole fix: it was reading a `const` twelve
   *  lines above the one that defines it. A let/const is in its temporal dead zone until
   *  its own line runs, so this threw "Cannot access 'selected' before initialization" on
   *  every render — the Design Lab and the mini designer both showed "This page couldn't
   *  load", whatever you opened them for. Hoisting is a `var`/`function` behaviour, and
   *  neither of those is in this file. */
  const selImage = images.find((im) => im.id === selected) ?? null
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  // Which image source the browse dialog is showing, or null when it's closed. One piece of
  // state rather than two booleans: they are the same dialog and can never both be open.
  const [browse, setBrowse] = useState<null | "uploads" | "orders">(null)
  // Background removal — the same hook the mini designer uses, so the two can't drift.
  /**
   * THE ERASER ACTS ON THE SELECTED LAYER.
   *
   * It was bound to `designUrl`, which is now the BOTTOM of the stack — so pressing Remove
   * background with the third layer selected would have quietly rubbed out the first one's
   * backdrop and left the layer you were looking at untouched.
   */
  const bg = useBackgroundRemoval(
    selImage?.src ?? "",
    (v) => setImages((prev) => prev.map((im) => (im.id === selImage?.id ? { ...im, src: v } : im))),
  )
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

  /**
   * Put a template's PIECES on the canvas — artwork, position, text, blank, print area.
   * That is the whole point of a template over a library image, which is flat.
   *
   * ONE implementation, two ways in: the ?template= link from the Templates page, and
   * picking one in the library dialog. They were about to be two copies of the same
   * twenty lines, and the copy that drifts is the one that stops restoring `pos` — which
   * puts the artwork back centred and looks like the template never saved it.
   */
  const applyTemplate = (t: ProductTemplate) => {
    const l = (t.layers ?? {}) as { sides?: Record<string, SideStack>; images?: ImageLayer[]; designUrl?: string; pos?: Pos; texts?: TextLayer[] }
    const d = (t.data ?? {}) as { blank?: string | null; printArea?: { w?: number; h?: number } }
    templateId.current = String(t.id)
    if (t.name) setName(t.name)
    // A template saved BEFORE the stack has one artwork and a position; one saved
    // after has the list. Reading images first means a new template never falls back
    // to its own compatibility fields and loses its upper layers.
    // THREE GENERATIONS, newest first. `sides` is the whole design; `images` is one face's
    // stack; `designUrl` is a single artwork. Reading in this order means a newer template
    // never falls through to its own compatibility fields and loses the rest of itself.
    if (l.sides && typeof l.sides === "object" && Object.keys(l.sides).length) {
      const restored: Record<string, SideStack> = {}
      let n = 1
      for (const [sd, v] of Object.entries(l.sides)) {
        restored[sd] = { images: Array.isArray(v?.images) ? v.images : [], texts: Array.isArray(v?.texts) ? v.texts : [] }
        n += restored[sd].images.length
      }
      setStacks(restored)
      nextLayerId.current = n
    } else {
      const front: SideStack = { images: [], texts: [] }
      if (Array.isArray(l.images) && l.images.length) {
        front.images = l.images
        nextLayerId.current = l.images.length + 1
      } else if (l.designUrl) {
        front.images = [{ id: `img-${nextLayerId.current++}`, src: l.designUrl, name: null, pos: l.pos ?? { ...DEFAULT_POS } }]
      }
      if (Array.isArray(l.texts)) front.texts = l.texts
      setStacks({ front })
    }
    if (l.pos) setPos(l.pos)
    if (d.printArea?.w) setPaW(String(d.printArea.w))
    if (d.printArea?.h) setPaH(String(d.printArea.h))
    const p = d.blank ? catalogRef.current.find((x) => x.name === d.blank) : null
    if (p) { setProduct(p); setMockup(mockupOf(p)); setSide("front") }
  }

  useEffect(() => {
    if (!templateParam) return
    const id = setTimeout(() => {
      getTemplates()
        .then((rows) => {
          const t = (rows ?? []).find((x) => String(x.id) === templateParam)
          if (t) applyTemplate(t)
        })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(id)
    // applyTemplate deliberately absent: it is redefined every render and listing it would
    // re-run this on every keystroke, re-fetching the template and stamping the canvas back
    // over whatever had just been edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
     
  }, [])

  // Place a library image on the canvas. Remote URLs (R2, marketplace) go through the img
  // proxy so the composed canvas stays SAME-ORIGIN and can export (a tainted canvas throws
  // on toDataURL). A data: url (a fresh local upload) is already same-origin.
  const placeImage = (url: string, name?: string | null) => {
    // ADDS a layer. It used to overwrite the artwork, so picking a second library image
    // silently discarded the first — which on a design you had already placed is a loss, not
    // a replacement. Removing a layer is one click on its strip.
    addImages([{ src: url.startsWith("data:") ? url : canvasReadableSrc(url), name: name ?? null }])
  }
  // Upload → place it now AND keep it in "Your uploads" so it's reusable next time.
  /**
   * SEVERAL FILES, each becoming its own layer.
   *
   * Took `files?.[0]` and dropped the rest on the floor — silently, so selecting four images
   * looked like three of them had failed. Read in parallel and added in the order they were
   * given, which is the order somebody picked them in.
   */
  const onUploadImages = (files: FileList | File[] | null | undefined) => {
    const arr = Array.from(files ?? [])
    if (!arr.length) return
    Promise.all(arr.map((f) => new Promise<{ src: string; name?: string | null } | null>((res) => {
      readImageFile(f, (dataUrl) => {
        // Kept in "Your uploads" too, so it is reusable next time — best-effort, exactly as
        // before: failing to stash a copy must never cost the layer that was just placed.
        uploadSellerImage(dataUrl, f.name).then((r) => { if (r.image) refreshImages() }).catch(() => {})
        res({ src: dataUrl, name: f.name })
      }, (m) => { setMsg({ tone: "err", text: m }); res(null) })
    }))).then((out) => addImages(out.filter((x): x is { src: string; name?: string | null } => !!x)))
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
      const composed = await composeDesign(images, texts, 640)
      // `layers` is what makes this REOPENABLE — the library stores a flattened image,
      // a template stores the pieces plus which blank they were placed on.
      templateId.current ??= `TPL-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const r = await saveTemplate({
        id: templateId.current,
        name: name.trim() || "Untitled template",
        composite: composed,
        data: { blank: product?.name ?? null, blankSku: product?.sku ?? null, printArea: { w: Number(paW), h: Number(paH) } },
        // EVERY SIDE, plus the old flat fields describing the FRONT.
        // `sides` is the truth now — a template of a two-sided design that saved only the
        // face you happened to be looking at is a template of half a design. The flat
        // fields stay so a template saved today still opens in anything that reads them,
        // and they are the front rather than "the current side": a reader that predates
        // sides has no way to know which face it is being handed.
        layers: { sides: stacks, images: frontStack.images, texts: frontStack.texts, designUrl: frontStack.images[0]?.src ?? "", pos: frontStack.images[0]?.pos ?? pos },
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
      const composed = await composeDesign(images, texts, 640)
      const r = await saveDesignLibrary({ name: name.trim() || "Untitled design", data: composed, thumb: composed })
      if (r.error) throw new Error(r.error)
      setMsg({ tone: "ok", text: "Saved to your library." })
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "Couldn't save." })
    } finally { setSaving(false) }
  }

  return (
    /**
     * FULL SCREEN, over the app chrome rather than inside it.
     *
     * The editor was a 100svh-7rem box inside `eg-content`'s gutters, with the sidebar
     * holding 240px on the left — so the stage, the one thing a person is actually looking
     * at, got what was left after three other panels. An editor is a room, not a page: it
     * takes the window while it is open and gives it back when you leave.
     *
     * z-40 is deliberate and sits between two things: the sidebar (z-30), which this
     * covers, and dialogs (z-50) — the blank picker, the art browser and every confirm
     * still open ON TOP of the editor rather than behind it.
     *
     * Fixed is safe here even though a motion wrapper is above us: PageTransition animates
     * OPACITY only, and opacity makes a stacking context, not a containing block. A
     * transform on that wrapper would silently re-anchor this to it — so if it ever gains
     * one, this has to move out of the shell instead.
     */
    <div className="fixed inset-0 z-40 flex flex-col gap-3 bg-background p-3 md:p-4">
      <div className="flex items-center gap-3">
        <DesignLabTabs />
        {msg && <span className={"ml-2 text-sm " + (msg.tone === "ok" ? "text-success" : "text-destructive")}>{msg.text}</span>}
        {/* THE WAY OUT. A surface that covers the whole window has to carry its own exit —
            the sidebar and the top bar are underneath this, so without it the only way
            back is the browser's own Back. */}
        <Button
          variant="ghost" size="sm" className="ml-auto shrink-0"
          onClick={() => router.push("/design?tab=library")}
          title="Close the editor"
        >
          <X size={15} weight="bold" /> Close
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Left: sources + layers */}
        <aside className="hidden w-60 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-3 lg:flex">
          <div className="space-y-1.5">
            <div className="eg-label text-muted-foreground">Blank</div>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setPickerOpen(true)}>{mockup ? "Change blank" : "Pick a blank"}</Button>
          </div>
          {/* Print area — the printable rectangle scales against a 12x16 base, matching
              what production actually trims to. */}
          <div className="space-y-1.5">
            <div className="eg-label text-muted-foreground">Print area (in)</div>
            <div className="flex items-center gap-1.5">
              <Input value={paW} onChange={(e) => setPaW(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-8 text-xs" aria-label="Print area width in inches" />
              <span className="text-xs text-muted-foreground">x</span>
              <Input value={paH} onChange={(e) => setPaH(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-8 text-xs" aria-label="Print area height in inches" />
            </div>
            {/* Only once there is something to judge. An empty stage showing "too low"
                would be reporting on nothing, and a meter that is wrong while idle is one
                nobody reads when it matters. */}
            {images.length > 0 && (
              <div className={"flex items-start gap-1.5 text-2xs " + QUALITY_TONE[quality.tone]} role="status">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current" />
                <span>
                  {quality.label}
                  {worstDpi != null && <span className="tabular-nums"> · {Math.round(worstDpi)} DPI at {areaIn.w}&quot;</span>}
                  {quality.tone === "bad" && <> — scale it down, or send a larger file. Under 150 DPI shows as soft edges on the garment.</>}
                  {quality.tone === "warn" && <> — fine for DTG and DTF; embroidery and fine detail want 300.</>}
                </span>
              </div>
            )}
          </div>
          {/* Images — your reusable uploads + buyer art from your orders. Upload keeps a
              copy in "Your uploads"; click any thumbnail to drop it on the design. */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="eg-label text-muted-foreground">Images</div>
              <label className="flex cursor-pointer items-center gap-1 text-2xs font-medium text-primary hover:underline">
                <UploadSimple size={12} weight="bold" /> Upload
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onUploadImages(e.target.files); e.target.value = "" }} />
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
                      <div className="text-2xs font-medium text-muted-foreground">Your uploads</div>
                      {sellerImages.length > RAIL_LIMIT && (
                        <button type="button" onClick={() => setBrowse("uploads")} className="text-2xs font-medium text-primary hover:underline">
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
                      <div className="text-2xs font-medium text-muted-foreground">From your orders</div>
                      {/* ONE way in, not two. "All 74" up here and "Browse order art" below
                          the grid opened the same dialog, ten pixels of thumbnails apart —
                          two controls for one action, and neither said which orders. The
                          link carries it, named for what it opens. */}
                      {orderUploads.length > RAIL_LIMIT && (
                        <button type="button" onClick={() => setBrowse("orders")} className="text-2xs font-medium text-primary hover:underline">
                          Browse All Orders
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {orderUploads.slice(0, RAIL_LIMIT).map((im, i) => <ImageThumb key={im.url + i} url={im.url} src={canvasReadableSrc(im.url)} name={im.name} badge={shortRef(im.orderRef)} title={[im.orderRef, im.name].filter(Boolean).join(" · ")} onPlace={() => placeImage(im.url)} />)}
                    </div>
                  </>
                )}
              </>
            )}
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setLibOpen(true)}>Saved designs &amp; templates</Button>
          </div>
          {/* The layer list used to be here AND the selected layer's controls were on the
              right, so working on one layer meant crossing the canvas: pick on the left, edit
              on the right, look in the middle. One list, on the right, with the controls it
              belongs to. */}
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
              <div className="flex flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-card/80 p-1 backdrop-blur">
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
                    {/* A dot on a face that carries work. With one stack per side the pills
                        are now the only way to see that the back has anything on it — the
                        stage shows one face at a time. */}
                    {((stacks[f.side]?.images.length ?? 0) + (stacks[f.side]?.texts.length ?? 0)) > 0 && (
                      <span className={"ml-1.5 inline-block size-1.5 rounded-full align-middle " + (side === f.side ? "bg-primary-foreground/80" : "bg-primary")} />
                    )}
                  </button>
                ))}
              </div>
            )}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false)
                onUploadImages(e.dataTransfer.files)
              }}
              className={"relative w-full max-w-[min(100%,calc(100svh-12rem))] rounded-xl transition-shadow " + (dragOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "")}
            >
              <DesignStage
                className="w-full"
                mockup={faceUrl || mockup}
                // The stack, not a single artwork. `designUrl`/`pos` are left unset here on
                // purpose: passing both would draw the bottom layer twice.
                images={images} updateImage={updateImage}
                texts={texts} updateText={updateText}
                // Acts on the SELECTED layer, and sits on the strip above it rather than in a
                // panel across the window — it changes the picture, so it belongs where the
                // picture is.
                onRemove={selImage ? () => dropLayer(selImage.id) : undefined}
                onEraseBg={selImage ? bg.run : undefined}
                eraseBusy={bg.busy}
                onUndoErase={selImage && bg.canUndo ? bg.undo : undefined}
                selected={selected} onSelect={setSelected}
                printZone={zone}
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
            <div className="eg-label text-muted-foreground">Add</div>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={addText}>
              Add text
            </Button>
          </div>

          {selText ? (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="eg-label text-muted-foreground">Text</div>
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
              <Button variant="outline" size="sm" onClick={() => removeText(selText.id)} className="text-red-600 hover:text-red-700">Delete text</Button>
            </div>
          ) : images.length > 0 || texts.length > 0 ? (
            <div className="space-y-3 border-t border-border pt-3">
              {/**
                * LAYERS — the list AND the thing you do to a layer, in one place.
                *
                * The list was on the left of the canvas and the controls on the right, so
                * working on one layer meant crossing the picture twice: pick on the left, edit
                * on the right, look in the middle.
                *
                * Reversed, so the TOP of the list is the top of the stack. A layer list that
                * runs bottom-up matches the array and nothing else anybody has ever used.
                */}
              <div className="flex items-baseline justify-between gap-2">
                <div className="eg-label text-muted-foreground">Layers</div>
                <span className="text-2xs tabular-nums text-muted-foreground">{images.length + texts.length} / {MAX_LAYERS}</span>
              </div>
              <div className="space-y-1">
                {[...images].reverse().map((im) => {
                  // Per LAYER, because the summary above names the worst one and this is
                  // how you find out which one that is.
                  const d = dpiOf(im)
                  const v = dpiVerdict(d)
                  return (
                    <button key={im.id} onClick={() => setSelected(im.id)}
                      className={"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors " + (selected === im.id ? "bg-primary/10 text-primary" : "hover:bg-accent")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.src} alt="" className="eg-checker size-7 shrink-0 rounded border border-border object-contain" />
                      <span className="truncate">{im.name || "Image"}</span>
                      <span
                        className={"ml-auto size-1.5 shrink-0 rounded-full bg-current " + QUALITY_TONE[v.tone]}
                        title={d == null ? "Measuring this layer" : `${Math.round(d)} DPI as placed — ${v.label.replace("Print quality: ", "")}`}
                      />
                    </button>
                  )
                })}
                {texts.map((t) => (
                  <button key={t.id} onClick={() => setSelected(t.id)}
                    className={"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors " + (selected === t.id ? "bg-primary/10 text-primary" : "hover:bg-accent")}>
                    <TextT size={14} className="shrink-0" /> <span className="truncate">{t.text || "Text"}</span>
                  </button>
                ))}
              </div>
              {/* The background tools moved ONTO the layer — see the strip above the image.
                  Only the tolerance stays here: it is a setting for that tool, not an action,
                  and a slider in a floating strip is a thing you knock while dragging. */}
              {selImage && (
                <label className="flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                  <span className="text-muted-foreground">Erase tolerance</span>
                  <input type="range" min={4} max={40} value={bg.tolerance} onChange={(e) => bg.changeTolerance(Number(e.target.value))} className="flex-1" aria-label="Background removal tolerance" />
                  <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{bg.tolerance}</span>
                </label>
              )}
              {bg.msg && <p className="text-2xs text-muted-foreground">{bg.msg}</p>}
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
                // 2000px, which is Etsy's own floor for a listing photo. 1200 was under it,
                // so the picture a buyer judges the product by arrived soft on the one
                // channel most of these listings go to.
                const composed = await composeDesign(frontStack.images, frontStack.texts, 2000)
                /**
                 * THE FACTORY GETS THE WHOLE FRONT, not the bottom of the stack.
                 *
                 * `designUrl` was `images[0].src` — layer one and nothing else. A design of
                 * a logo, a name and a badge published a correct-looking listing and sent
                 * production a lone logo; every text layer was lost outright, because text
                 * is not in `images` at all.
                 *
                 * Flattened only when there is something to flatten. A single image with no
                 * text is passed through AS THE ORIGINAL FILE — re-rastering it would throw
                 * away resolution the uploaded file has and the canvas doesn't, and that is
                 * the common case.
                 *
                 * 2400px is the ceiling on the flattened one on purpose: this travels to the
                 * publish page through sessionStorage, which is a few megabytes, and a
                 * failed stash is reported below rather than swallowed.
                 */
                const single = frontStack.images.length === 1 && frontStack.texts.length === 0
                const art = single
                  ? frontStack.images[0].src
                  : await composeDesign(frontStack.images, frontStack.texts, 2400)
                // A flattened front is already placed — it IS the print area — so it must
                // not carry the bottom layer's offset a second time.
                const artPos = single ? (frontStack.images[0]?.pos ?? pos) : { ...DEFAULT_POS, w: 100 }
                // Publishing is its own PAGE now, so the listing travels through
                // sessionStorage rather than as a prop — see lib/publish-draft.ts. A failed
                // stash is said out loud: navigating to a page whose draft was never stored
                // would land on an empty form with no explanation.
                const id = stashPublishDraft({
                  prefill: { title: name, images: composed ? [composed] : [], blank: product, designUrl: art, designPos: artPos },
                  returnTo: "/design/maker",
                  returnLabel: "Back to Design",
                  title: "Publish product",
                })
                if (!id) { setPubErr("Couldn't open the publish page — this design is too large for the browser to hand over."); return }
                router.push(`/publish?d=${id}`)
              }}
              disabled={!designUrl && texts.length === 0}
            >
              Publish product
            </Button>
            {pubErr && <p className="text-xs text-destructive">{pubErr}</p>}
            {/* SAID OUT LOUD, because the listing carries the front only. The sides are real
                in the editor and in a saved template now, but published_listings holds one
                artwork and the order sync writes it as side 'front' — so a back print would
                travel no further than this page without saying so. Honest beats silent: a
                seller who is told can save the template and hand the back to the factory
                through the order, which does support per-side artwork. */}
            {paintedSides.filter((sd) => sd !== "front").length > 0 && (
              <p className="text-2xs text-amber-600 dark:text-amber-500">
                Publishing sends the FRONT. {paintedSides.filter((sd) => sd !== "front").join(", ")} {paintedSides.filter((sd) => sd !== "front").length === 1 ? "is" : "are"} saved with the template but not with the listing.
              </p>
            )}
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
      <LibraryPickerDialog open={libOpen} onOpenChange={setLibOpen}
        onPick={(u) => { setDesignUrl(u); setPos(DEFAULT_POS); setSelected("image") }}
        onPickTemplate={applyTemplate} />
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

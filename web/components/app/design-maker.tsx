"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { useSearchParams } from "next/navigation"
import { UploadSimple, TextT, CursorClick, CircleNotch, FloppyDisk, Stack, ArrowLeft, TShirt, ImageSquare, CaretDown, type Icon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DesignStage, DEFAULT_POS, readImageFile, type Pos, type TextLayer, type ImageLayer } from "@/components/app/design-canvas"
import { ProductPickerDialog, type PickedProduct } from "@/components/app/product-picker-dialog"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { ArtPickerDialog, type ArtItem } from "@/components/app/art-picker-dialog"
import { TabBar } from "@/components/app/tab-bar"
import { EmptyState } from "@/components/app/empty-state"
import { useLightbox } from "@/components/app/image-lightbox"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { saveDesignLibrary, saveTemplate, getTemplates, getCatalogProducts, getProductTypes, getSellerImages, uploadSellerImage, deleteSellerImage, getOrderUploads, getDesignLibrary, getDesignLibraryItem, deleteDesignLibrary, type CatalogProduct, type SellerImage, type OrderUpload, type ProductTemplate, type LibraryDesign } from "@/lib/api"
import { canvasReadableSrc } from "@/lib/thread-match"
import { proxiedImageSrc } from "@/lib/order-image"
// The tile is shared with the order dialog — it takes props only, so it was always shared
// code that happened to live in this one screen's file.
import { ArtworkPanel } from "@/components/app/artwork-panel"
import { orderRefLabel } from "@/lib/order-format"
import { useBackgroundRemoval } from "@/lib/remove-background"
import { printZoneOf, printSizeOf } from "@/lib/print-zone"
import { layerDpi, dpiVerdict, useNaturalSizes } from "@/lib/print-quality"
import { designFaces, setTypeMockups, typeMockupOf } from "@/lib/variant-resolve"
import { useRouter } from "next/navigation"
import { stashPublishDraft } from "@/lib/publish-draft"

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
 * a warning about work, so it uses them rather than inventing a fourth signal colour. */
const QUALITY_TONE: Record<string, string> = {
 ok: "text-success",
 warn: "text-hold",
 bad: "text-destructive",
 unknown: "text-muted-foreground",
}

/** One face's worth of design. The editor holds a map of these keyed by side. */
export type SideStack = { images: ImageLayer[]; texts: TextLayer[] }
/** Shared, frozen, module-scope: a fresh `{ images: [], texts: [] }` per render would be a
 * new object every time and defeat every equality check that reads it. */
const EMPTY_STACK: SideStack = Object.freeze({ images: [], texts: [] }) as SideStack

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
/**
 * ONE TILE'S WORTH OF ARTWORK, whatever it came from.
 *
 * The rail draws four different things — an upload, a saved design, a buyer's file and a
 * template — and they differ only in what a press does and what the caption says. Folding
 * them into one shape here is what lets the panel be ONE grid under ONE bar instead of a
 * stack of groups that each grew their own header and their own browse link.
 */
export type RailArt = {
  key: string
  /** The value handed to onPlace's closure and to the "can't load" link. */
  url: string
  /** What to DISPLAY when that differs — buyer art and marketplace thumbs go via the proxy. */
  src?: string
  name?: string
  badge?: string
  title?: string
  /** Newest first, across sources. 0 where the source has no date of its own. */
  at: number
  /**
   * Whether the tile may report the picture's pixel size.
   *
   * ONLY WHERE THE TILE IS DRAWING THE ARTWORK ITSELF. A design_library row renders its
   * 320px THUMBNAIL and fetches the real file on press, and a template renders a 640px
   * composite of a garment — so measuring what loaded would print "320×320" under a 4500px
   * design and flag it amber as too small to print. A wrong measurement is worse than none:
   * it is the quality warning people act on.
   */
  measure?: boolean
  onPlace: () => void
  onDelete?: () => void
}

/**
 * How many images each source shows in the rail before it defers to Browse.
 *
 * SIX — two rows of three. The rail is one column of a three-column workspace; it is a
 * shortcut to the few you just used, not a file manager. It was rendering all 300 buyer
 * uploads, which pushed Text and Layers so far down the panel that people did not know
 * they were there.
 */
/**
 * THE TOOL RAIL.
 *
 * Every source of content used to be a differently shaped control in one 240px column: a
 * full-width outline button for the blank, a text link for Upload, another text link for
 * order art, another outline button for the library. Four ways to say "open a source",
 * none of them related, stacked under four shouting ALL-CAPS labels.
 *
 * One idiom instead — icon over label, all the same size — so the panel is a set of tools
 * rather than a pile of controls, and the panel beside it shows one at a time.
 */
type ToolKey = "blank" | "images" | "text"

const TOOLS: { key: ToolKey; label: string; Icon: Icon }[] = [
  { key: "blank", label: "Blank", Icon: TShirt },
  { key: "images", label: "Artwork", Icon: ImageSquare },
  { key: "text", label: "Text", Icon: TextT },
]

const RAIL_LIMIT = 6

export function DesignMaker() {
  const tl = useLabelT()
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
   * selection carried across would name a layer that isn't on the canvas — the action
   * strip would sit there acting on something invisible. */
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
   * single-artwork fields mean the front, and a reader that predates sides can't ask. */
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
  /**
   * THE PRINT AREA IS THE GARMENT'S, NOT THIS WINDOW'S.
   *
   * It was two typed fields here, which meant the number every DPI check divided by was
   * whatever the last person to open the designer had left in them — per session, not per
   * product, so the same cap could measure 12×16 one day and 4×2.5 the next. Worse, typing
   * a size also RESCALED the dashed box, so a seller could quietly redraw the printable
   * area of a garment the factory had already set up.
   *
   * Read-only here, set by staff per product and side (product editor → Print area). The
   * zone is taken as the product defines it — no scaling by anything typed in this window.
   */
 const areaIn = printSizeOf(product, side)
 const zone = printZoneOf(product, side)
 const natural = useNaturalSizes(images.map((im) => im.src))
 const dpiOf = (im: ImageLayer) => layerDpi(natural.get(im.src)?.w ?? 0, im.pos.w, zone.w, areaIn.w)
 const measured = images.map(dpiOf).filter((d): d is number => d != null)
 const worstDpi = measured.length ? Math.min(...measured) : null
 const quality = dpiVerdict(images.length === 0 ? null : worstDpi)
  /** Stage zoom. The wheel had no meaning on the canvas at all — the one gesture every
   * editor answers with zoom did nothing here. Clamped, and reset from the chip. */
 const [zoom, setZoom] = useState(1)
 const stageWrap = useRef<HTMLDivElement | null>(null)
 useEffect(() => {
 const el = stageWrap.current
 if (!el) return
    // Attached by hand, NOT via onWheel: React registers wheel at the root as passive, so
    // preventDefault there is ignored and the page scrolls behind the zoom.
 const onWheel = (e: WheelEvent) => {
 e.preventDefault()
      // Exponential, so a notch feels the same at 40% as it does at 300%.
 setZoom((z) => Math.min(3, Math.max(0.4, z * Math.pow(0.9985, e.deltaY))))
    }
 el.addEventListener("wheel", onWheel, { passive: false })
 return () => el.removeEventListener("wheel", onWheel)
  }, [])
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
   * lines above the one that defines it. A let/const is in its temporal dead zone until
   * its own line runs, so this threw "Cannot access 'selected' before initialization" on
   * every render — the Design Lab and the mini designer both showed "This page couldn't
   * load", whatever you opened them for. Hoisting is a `var`/`function` behaviour, and
   * neither of those is in this file. */
 const selImage = images.find((im) => im.id === selected) ?? null
 const [name, setName] = useState("")
 const [pickerOpen, setPickerOpen] = useState(false)
 const [libOpen, setLibOpen] = useState(false)
  // Which image source the browse dialog is showing, or null when it's closed. One piece of
  // state rather than two booleans: they are the same dialog and can never both be open.
 const [browse, setBrowse] = useState<null | "uploads" | "orders">(null)
  /** Which tool's panel is open beside the rail. One at a time, like every editor.
   *  Opens on BLANK: nothing else in here does anything until a garment is chosen, and
   * landing on Artwork put the one required first step behind a tab nobody had a reason
   * to press. Once a blank is picked the panel moves on to Artwork by itself. */
 const [tool, setTool] = useState<ToolKey>("blank")
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
  /**
   * TWO STORES HOLD THE SAME THING, and the rail is where that stops being visible.
   *
   * `seller_images` (uploaded from this rail) and `design_library` (dropped on Design Lab ›
   * Artwork) are both "a flat picture of mine, kept to reuse" — different tables, different
   * ids, and neither list could see the other. So an image put in from the Lab was simply
   * absent from the editor, and one uploaded here never appeared on the Artwork tab. That is
   * the largest single reason this area reads as scattered.
   *
   * Merged HERE rather than migrated: a table migration is a server change with a data move
   * behind it, and this makes the seller's answer to "where is my picture" correct today.
   * The two are told apart by `kind`, which is what routes a place and a delete.
   */
 const [savedDesigns, setSavedDesigns] = useState<LibraryDesign[]>([])
 const [railTemplates, setRailTemplates] = useState<ProductTemplate[]>([])
 const [imagesLoading, setImagesLoading] = useState(true)
  /** Which SOURCE the Artwork panel is showing. See the panel for why it is a bar. */
 const [source, setSource] = useState<"yours" | "orders" | "templates">("yours")
  /** Looking at a picture full size — a different job from placing it. NOT `zoom`, which is
   *  already taken by the stage's own scale a hundred lines up. */
 const lightbox = useLightbox()

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
 const d = (t.data ?? {}) as { blank?: string | null; blankSku?: string | null; printArea?: { w?: number; h?: number } }
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
    // The template's stored printArea is NOT applied. It is a record of what the blank
    // measured when the template was saved; the size now comes from whichever product this
    // is opened on, so restoring the old number would print the new garment to the old
    // garment's measurements.
  /*
   * THE SKU FIRST, THEN THE NAME.
   *
   * The save writes both (`blank` is the name, `blankSku` the sku, see the saveTemplate
   * call below) and this read only ever looked at the name — so `blankSku` was written by
   * every template and read by nothing. Rename a product, or hold two that share a name,
   * and reopening the template found the wrong blank or none at all, which is the artwork
   * coming back onto a garment nobody chose.
   *
   * A sku is the identity; a name is a label somebody edits. Name stays as the fallback
   * for templates saved before blankSku existed.
   */
 const byName = d.blank ? catalogRef.current.find((x) => x.name === d.blank) : null
 const p = (d.blankSku ? catalogRef.current.find((x) => x.sku === d.blankSku) : null) ?? byName
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
 getDesignLibrary().then((r) => setSavedDesigns(r ?? [])).catch(() => {})
 getTemplates().then((r) => setRailTemplates(r ?? [])).catch(() => {})
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
  /** The design_library half of "Yours" — the bytes are behind a second call, and the tile
   *  only ever held the thumbnail. Placing the THUMB would put a 320px picture on a 4800px
   *  print, which is the quality bug that never announces itself. */
 const placeLibraryDesign = async (d: LibraryDesign) => {
    try {
 const r = await getDesignLibraryItem(d.id)
 if (r.data) { placeImage(r.data, d.name); return }
    } catch { /* fall through to the message below */ }
 setMsg({ tone: "err", text: "Couldn't open that artwork." })
  }
 const removeLibraryDesign = (id: number | string) => {
 setSavedDesigns((prev) => prev.filter((d) => d.id !== id))
 deleteDesignLibrary(id).catch(() => refreshImages())
  }

 const updateText = (id: string, patch: Partial<TextLayer>) =>
 setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
 const addText = () => {
 const t: TextLayer = { id: rid(), text: "Your text", x: 50, y: 70, size: 9, r: 0, color: "#111827", bold: true }
 setTexts((prev) => [...prev, t]); setSelected(t.id)
  }
 const removeText = (id: string) => { setTexts((prev) => prev.filter((t) => t.id !== id)); setSelected(null) }
 const selText = texts.find((t) => t.id === selected)


  /**
   * "YOURS" IS BOTH STORES, told apart by where a press has to go.
   *
   * A seller_images row carries a loadable url, so placing it is one call. A design_library
   * row carries only a THUMB — its bytes come from getDesignLibraryItem — so placing it is
   * a fetch first. That difference is the whole reason they were never merged, and it is
   * two lines of closure, not a reason to show someone two libraries.
   *
   * Newest first across both. Interleaving by date rather than concatenating is the point:
   * a picture added a minute ago is at the front whichever door you came in through.
   *
   * The MEMO holds data only, never the handlers. Every callback in this component is
   * redefined each render, so a memo that closed over them would either go stale or be
   * listed as a dependency and re-run on every keystroke — which is the same defect either
   * way. Sorting is the expensive half and it is the half that is pure.
   */
 const yoursRows = useMemo(
    () => [
      ...sellerImages.map((im) => ({ kind: "seller" as const, im, at: im.ts ?? 0 })),
      ...savedDesigns.map((d) => ({ kind: "library" as const, d, at: d.created_at ? Date.parse(d.created_at) || 0 : 0 })),
    ].sort((x, y) => y.at - x.at),
    [sellerImages, savedDesigns]
  )

  /** The live source, in the ONE shape the grid draws. */
 const railList: RailArt[] =
 source === "yours"
      ? yoursRows.map((r) =>
 r.kind === "seller"
            ? { key: "s" + r.im.id, url: r.im.url, name: r.im.name, at: r.at,
 onPlace: () => placeImage(r.im.url, r.im.name), onDelete: () => removeImage(r.im.id) }
            // The THUMB is what the tile draws; the full artwork is fetched on press.
            : { key: "l" + r.d.id, url: r.d.thumb ?? "", src: r.d.thumb ? proxiedImageSrc(r.d.thumb) : undefined,
 name: r.d.name ?? "", at: r.at, measure: false, badge: r.d.name ? undefined : `IMG-${r.d.id}`,
 onPlace: () => placeLibraryDesign(r.d), onDelete: () => removeLibraryDesign(r.d.id) }
        )
 : source === "orders"
        ? orderUploads.map((im, i) => ({
 key: im.url + i, url: im.url, src: canvasReadableSrc(im.url), name: im.name,
 badge: orderRefLabel(im.orderRef), title: [im.orderRef, im.name].filter(Boolean).join(" · "),
 at: 0, onPlace: () => placeImage(im.url, im.name),
          }))
        : railTemplates.map((t) => ({
 key: String(t.id), url: String(t.composite ?? ""), name: t.name ?? "Untitled template",
 badge: t.seq != null ? `TPL-${t.seq}` : undefined,
 title: [t.name, (t.data as { blank?: string } | null)?.blank].filter(Boolean).join(" · "),
 at: 0, measure: false,
            // A template REPLACES the canvas rather than adding a layer — it is a blank, a
            // stack and a print area, not a picture. That is the one press in this panel
            // that is not "place", which is why templates are their own source and not
            // another group of thumbnails in the same list.
 onPlace: () => applyTemplate(t),
          }))

  // What the browse dialog shows. Buyer art needs the proxy to DISPLAY (Etsy blocks
  // hotlinking) but the raw url to PLACE — same split the rail thumbnails make.
  //
  // "uploads" is the SAME merged list the rail's Yours tab shows, not sellerImages alone.
  // Browsing all of something has to show all of it, and a Browse that dropped the
  // design_library half would contradict the count on the tab that opened it.
 const browseItems: ArtItem[] =
 browse === "uploads"
      ? railList.map((it) => ({ url: it.url, src: it.src, name: it.name, badge: it.badge }))
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
        // The size the product declares for this side, not a number typed in this window —
        // reopening a template must not carry a stale measurement onto a different garment.
 data: { blank: product?.name ?? null, blankSku: product?.sku ?? null, printArea: { w: areaIn.w, h: areaIn.h } },
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
 refreshImages()
    } catch (e) {
 setMsg({ tone: "err", text: e instanceof Error ? e.message : "Couldn't save the template." })
    } finally { setSaving(false) }
  }

  /** Hand the design to the publish page. Lifted out of the button so the top bar can
   * own the action without carrying forty lines of JSX with it. */
 const publishProduct = async () => {
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
 title: tl("designMaker", "Publish product"),
              })
 if (!id) { setPubErr("Couldn't open the publish page — this design is too large for the browser to hand over."); return }
 router.push(`/publish?d=${id}`)
  }

 const saveToLibrary = async () => {
 if (!designUrl && texts.length === 0) { setMsg({ tone: "err", text: "Add artwork or text first." }); return }
 setSaving(true); setMsg(null)
 try {
 const composed = await composeDesign(images, texts, 640)
 const r = await saveDesignLibrary({ name: name.trim() || "Untitled artwork", data: composed, thumb: composed })
 if (r.error) throw new Error(r.error)
 setMsg({ tone: "ok", text: "Saved to Artwork." })
      // The rail is a list of what you have saved, so it has to include what you JUST saved.
      // Without this the panel kept showing the state from page load and the save read as
      // having done nothing.
 refreshImages()
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
      {/* z-[80] and portalled, so it clears this editor's own z-40 overlay. */}
      {lightbox.node}
      {/**
        * ONE TOP BAR: where you are, what it is called, and what you can do with it.
        *
        * The actions used to be the bottom of the right-hand panel — a design name, two
        * outline buttons and Publish, all the same width and weight as the layer controls
        * above them, so the one action that matters looked like another field. A toolbar is
        * where a person looks for "finish this", and Publish is the only filled button in
        * the editor.
        */}
      <header className="flex shrink-0 items-center gap-2">
        {/* THE WAY OUT, and the only navigation in here.
            The Library/Templates/Design toggle used to sit beside it — three tabs inside a
 full-screen editor, two of which throw away whatever is on the canvas. A toggle
 belongs on the page you toggle between, not inside one of them; Back is how you
 leave, and the Design Lab is what you land on. */}
        <Button
 variant="ghost" size="sm" className="-ml-1 shrink-0"
 onClick={() => router.push("/design?tab=library")}
 title={tl("designMaker", "Leave the editor")}
        >
          <ArrowLeft size={15} weight="bold" /> {tl("designMaker", "Back")}
        </Button>
        {/* The name, as a title rather than a form field: transparent until you touch it.
            It was an Input at the bottom of a panel, which made naming a design feel like
 filling something in rather than titling your work. */}
        <Input
 value={name} onChange={(e) => setName(e.target.value)}
 placeholder={tl("designMaker", "Untitled design")} aria-label={tl("designMaker", "Design name")}
 className="h-8 w-40 min-w-0 border-transparent bg-transparent px-2 text-sm font-medium hover:border-border focus:border-border lg:w-56"
        />
        {msg && <span className={"truncate text-xs " + (msg.tone === "ok" ? "text-success" : "text-destructive")}>{msg.text}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/**
            * ONE SAVE, TWO DESTINATIONS — which is what these always were.
            *
            * `Save` and `Template` were peer buttons, and nothing on screen said they were
            * the same act aimed at different places: Save writes a FLATTENED png you can
            * place again, Template writes the layers, the blank and the print area, so it
            * REOPENS. Two buttons of equal weight read as two unrelated actions, so the
            * question every time was which one you meant — and pressing the wrong one is
            * silent, because both say "Saved".
            *
            * Every editor that has solved this uses a menu: Figma and Illustrator put Save
            * / Save a copy / Save as template behind one File item; Canva has no Save at
            * all and one Share. The variant belongs UNDER the verb, never beside it.
            *
            * The labels name the TAB the thing lands on — Artwork, Templates — so the menu
            * answers "where does it go", which is the part you cannot see from here. What
            * each one keeps is on the `title`, per §4: a control explains itself in its
            * label or its title, never in a sentence printed under it.
            */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" disabled={saving}>
                  {saving ? <CircleNotch size={14} className="animate-spin" /> : <FloppyDisk size={14} weight="bold" />} Save
                  <CaretDown size={11} weight="bold" className="opacity-60" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={saveToLibrary} title={tl("designMaker", "A flattened picture you can place on anything. Does not reopen.")}>
                <ImageSquare size={14} weight="bold" /> {tl("designMaker", "Save to Artwork")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={saveAsTemplate} title={tl("designMaker", "The layers, the blank and the print area, every side. Reopens in the editor.")}>
                <Stack size={14} weight="bold" /> {tl("designMaker", "Save as Template")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={publishProduct} disabled={!designUrl && texts.length === 0}>
            {tl("designMaker", "Publish")}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Left: the rail, then the panel for whatever it has selected. */}
        <nav aria-label={tl("designMaker", "Tools")} className="hidden w-16 shrink-0 flex-col gap-1 rounded-xl border border-border bg-card p-1.5 lg:flex">
          {TOOLS.map(({ key, label, Icon }) => (
            <button
 key={key}
 type="button"
 onClick={() => setTool(key)}
 aria-current={tool === key ? "true" : undefined}
 className={"flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-2xs font-medium transition-colors " +
                (tool === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              <Icon size={19} weight={tool === key ? "fill" : "regular"} />
              {tl("designMaker", label)}
            </button>
          ))}
        </nav>

        {/* WIDER, so a thumbnail is a picture rather than a stamp. Three tracks in 240px
 gave each image about 68px — too small to tell two of a seller's logos apart,
 which is the entire job of this panel. Two tracks in 288px is ~130px each. */}
        <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-3 lg:flex">
          {tool === "blank" && (
            <div className="space-y-2">
              <div className="text-sm font-semibold">{tl("designMaker", "Blank")}</div>
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setPickerOpen(true)}>{mockup ? tl("designMaker", "Change blank") : tl("designMaker", "Pick a blank")}</Button>
              {product && (
                <div className="space-y-0.5 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">{product.name}</div>
                  {/* Never the supplier — see CLAUDE.md 2.9. The seller sees what they are
 buying from US, not who we buy it from. */}
                  {product.sku && <div className="tabular-nums text-2xs">{product.sku}</div>}
                </div>
              )}
            </div>
          )}
          {/* Artwork — your reusable uploads + buyer art from your orders. */}
          {/**
            * THE SHARED PANEL — this screen no longer keeps its own.
            *
            * "Where does a picture come from" was implemented twice: once here, and not at
            * all on an order line until that surface borrowed this one. Two implementations
            * of one idea is how they drift; ImageThumb had already moved to the shared file
            * and this is the rest of it following.
            *
            * `templates` is offered HERE and deliberately not on an order line: a template
            * carries a blank, a layer stack AND a print area, and this is the editor that can
            * accept all three. A line's garment is already decided.
            *
            * Two tracks, because this column is 288px — three would give each thumbnail about
            * 68px, too small to tell two of a seller's logos apart, which is the panel's job.
            */}
          {tool === "images" && (
            <ArtworkPanel
              sources={["yours", "orders", "templates"]}
              columns={2}
              onPlace={placeImage}
              onApplyTemplate={applyTemplate}
            />
          )}

          {tool === "text" && (
            <div className="space-y-2">
              <div className="text-sm font-semibold">{tl("designMaker", "Text")}</div>
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={addText}>
                <TextT size={14} weight="bold" /> {tl("designMaker", "Add text")}
              </Button>
              <p className="text-2xs text-muted-foreground">
                {tl("designMaker", "Added text lands in the middle of the print area. Select it on the canvas to change the words, size and colour — the controls are on the right, with the rest of the layer.")}
              </p>
            </div>
          )}
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
          <div className="relative flex h-full max-h-full w-full flex-col items-center justify-center gap-3">
            <div
 onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
 onDragLeave={() => setDragOver(false)}
 onDrop={(e) => {
 e.preventDefault(); setDragOver(false)
 onUploadImages(e.dataTransfer.files)
              }}
 ref={stageWrap}
 className={"relative w-full max-w-[min(100%,calc(100svh-12rem))] rounded-xl transition-shadow " + (dragOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "")}
              // Scaled, not resized. The stage's own drag maths reads getBoundingClientRect,
              // which reports the SCALED box, so a layer dragged at 200% still lands where
              // the pointer is — percentages stay percentages.
 style={{ transform: zoom === 1 ? undefined : `scale(${zoom})` }}
            >
              <DesignStage
                className="w-full"
                /* THE FRONT IS NOT A STAND-IN FOR THE BACK.
                 *
                 * This was `faceUrl || mockup`, and `mockup` is the product's FRONT image. So
                 * a side the product has no picture for drew the front garment while the
                 * switcher above still read "Back" — you positioned a back print against a
                 * front photo, against the front's print zone, and nothing said so. The
                 * comment on `side` fifty lines up says the side must drive both the image and
                 * the zone; this line quietly undid it.
                 *
                 * faceUrl already makes that distinction — it falls back to the type outline
                 * on FRONT only, and to nothing elsewhere. Same rule here: `mockup` is a front
                 * fallback, for a product whose imagery resolves through mockupOf rather than
                 * through designFaces, and it applies on the front alone.
                 *
                 * A PLAIN BLOCK COMMENT, not the JSX form. This is an ATTRIBUTE LIST, where
                 * a JSX comment is a syntax error — the file does not compile, and the branch
                 * this arrived on did not. CLAUDE.md records the same trap on design-canvas. */
                mockup={faceUrl || (side === "front" ? mockup : "")}
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
              />
              {dragOver && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary/10 text-sm font-medium text-primary">
                  {tl("designMaker", "Drop artwork to place it")}
                </div>
              )}
            </div>
            {/* UNDER the picture, not floating on it. The pills sat over the garment's shoulders,
 which is both artwork you are trying to judge and — on a hat — the print area
 itself. Every product creator in this trade puts the faces on a shelf below
 the stage, because that is the one strip of the canvas nothing is drawn in. */}
            {zoom !== 1 && (
              <button
 type="button"
 onClick={() => setZoom(1)}
 title={tl("designMaker", "Back to 100%")}
 className="absolute right-6 top-6 z-10 rounded-lg border border-border bg-card/90 px-2.5 py-1 text-xs font-medium tabular-nums backdrop-blur hover:text-primary"
              >
                {Math.round(zoom * 100)}% · reset
              </button>
            )}
            {faces.length > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-card/80 p-1 backdrop-blur">
                {faces.map((f) => (
                  <button
 key={f.side}
 onClick={() => setSide(f.side)}
 className={
                      "eg-tap rounded-lg px-3 py-1 text-xs font-medium capitalize transition-colors " +
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
          </div>
        </div>

        {/* Right: properties + actions */}
        <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-4 lg:flex">
          {/**
            * THE SPEC, at the top of the panel: what this side prints at.
            *
            * Inches alone is not a spec — nobody can make a file from "12 x 16". The pixel
            * target at 300 DPI is the number a designer actually needs, and it is the one
            * thing Printify puts in front of you and we did not.
            */}
          <div className="space-y-2">
            <div className="text-sm font-semibold">{tl("designMaker", "Print area")}</div>
            <div className="flex items-baseline gap-1.5 text-sm tabular-nums">
              <span className="font-medium">{areaIn.w}&quot; × {areaIn.h}&quot;</span>
              <span className="text-2xs text-muted-foreground">
                {product ? tl("designMaker", "set on this product") : tl("designMaker", "standard size")}
              </span>
            </div>
            <div className="flex items-baseline justify-between text-2xs text-muted-foreground">
              <span className="tabular-nums">{Math.round(areaIn.w * 300)} × {Math.round(areaIn.h * 300)} px</span>
              <span>{tl("designMaker", "at 300 DPI")}</span>
            </div>
            {/* Only once there is something to judge. A meter that is wrong while idle is
 one nobody reads when it matters. */}
            {images.length > 0 && (
              <div className={"flex items-start gap-1.5 text-2xs " + QUALITY_TONE[quality.tone]} role="status">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current" />
                <span>
                  {tl("designMaker", quality.label)}
                  {worstDpi != null && <span className="tabular-nums"> · {Math.round(worstDpi)} DPI</span>}
                  {quality.tone === "bad" && <> {tl("designMaker", "— scale it down, or send a larger file.")}</>}
                  {quality.tone === "warn" && <> {tl("designMaker", "— fine for DTG and DTF; embroidery wants 300.")}</>}
                </span>
              </div>
            )}
          </div>

          {selText ? (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="text-sm font-semibold">{tl("designMaker", "Text")}</div>
              <Input value={selText.text} onChange={(e) => updateText(selText.id, { text: e.target.value })} placeholder={tl("designMaker", "Your text")} />
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{tl("designMaker", "Size")}</span>
                <input type="range" min={3} max={24} value={selText.size} onChange={(e) => updateText(selText.id, { size: Number(e.target.value) })} className="flex-1" />
              </label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">{tl("designMaker", "Color")}
                  <input type="color" value={selText.color} onChange={(e) => updateText(selText.id, { color: e.target.value })} className="size-7 rounded border border-border" />
                </label>
                <label className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input type="checkbox" checked={!!selText.bold} onChange={(e) => updateText(selText.id, { bold: e.target.checked })} /> {tl("designMaker", "Bold")}
                </label>
              </div>
              <Button variant="outline" size="sm" onClick={() => removeText(selText.id)} className="text-alert hover:text-alert">{tl("designMaker", "Delete text")}</Button>
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
                <div className="text-sm font-semibold">{tl("designMaker", "Layers")}</div>
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
                      <span className="truncate">{im.name || tl("designMaker", "Image")}</span>
                      <span
 className={"ml-auto size-1.5 shrink-0 rounded-full bg-current " + QUALITY_TONE[v.tone]}
 title={d == null ? tl("designMaker", "Measuring this layer") : `${Math.round(d)} DPI as placed — ${v.label.replace("Print quality: ", "")}`}
                      />
                    </button>
                  )
                })}
                {texts.map((t) => (
                  <button key={t.id} onClick={() => setSelected(t.id)}
 className={"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors " + (selected === t.id ? "bg-primary/10 text-primary" : "hover:bg-accent")}>
                    <TextT size={14} className="shrink-0" /> <span className="truncate">{t.text || tl("designMaker", "Text")}</span>
                  </button>
                ))}
              </div>
              {/* THE TOLERANCE SLIDER IS GONE. It asked the person cutting out a
 signature to guess a colour distance in RGB — a unit nobody has an
 intuition for, whose right answer differs per image. removeBackground
 measures it from the picture's own edges instead. */}
              {bg.msg && <p className="text-2xs text-muted-foreground">{bg.msg}</p>}
            </div>
          ) : (
            <EmptyState
              icon={CursorClick}
              size="sm"
              title={tl("noLayerSelected", "No layer selected")}
              note={tl("noLayerSelectedNote", "Select artwork or text on the blank to edit it here.")}
            />
          )}

          {/* What publishing will and won't carry. Kept next to the work rather than on the
 button: it is a fact about this design, not about the click. */}
          {(pubErr || paintedSides.filter((sd) => sd !== "front").length > 0) && (
            <div className="mt-auto space-y-1.5 border-t border-border pt-3">
              {pubErr && <p className="text-xs text-destructive">{pubErr}</p>}
              {paintedSides.filter((sd) => sd !== "front").length > 0 && (
                <p className="text-2xs text-hold">
                  Publishing sends the FRONT. {paintedSides.filter((sd) => sd !== "front").join(", ")} {paintedSides.filter((sd) => sd !== "front").length === 1 ? "is" : "are"} saved with the template but not with the listing.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      <ProductPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={(p: PickedProduct) => {
          // Resolve through mockupOf, not p.img — the picker's img is empty for a product
          // with no imagery, which skipped the type-default fallback entirely.
 const cp = catalogFor(p.sku)
 setProduct(cp)
 setMockup(p.img || (cp ? mockupOf(cp) : ""))
 setSide("front")
 setTool("images")
        }} />
      {/* Reached from the Templates source's "Browse all", so it lands on Templates —
          dropping someone on the other tab is the same click they were avoiding. */}
      <LibraryPickerDialog open={libOpen} onOpenChange={setLibOpen} initialSource="templates"
 onPick={(u) => { setDesignUrl(u); setPos(DEFAULT_POS); setSelected("image") }}
 onPickTemplate={applyTemplate} />
      {/* One dialog for both sources — the rail decides which list it is showing. */}
      <ArtPickerDialog
 open={browse !== null}
 onOpenChange={(v) => { if (!v) setBrowse(null) }}
 title={browse === "uploads" ? tl("designMaker", "Your uploads") : tl("designMaker", "Artwork from your orders")}
 items={browseItems}
 onPick={placeImage}
 emptyText={browse === "uploads" ? tl("designMaker", "You haven't uploaded anything yet.") : tl("designMaker", "No buyer artwork has come in from your orders yet.")}
 searchPlaceholder={browse === "uploads" ? "Search your uploads…" : "Search by order number or item…"}
      />
    </div>
  )
}


/**
 * The Suspense fallback for the maker route.
 *
 * app/(app)/design/maker/page.tsx is a SERVER component, so it cannot call useLabelT — a
 * hook inserted there fails the build on prerender, not at runtime. This is the same client
 * island treatment the help pages use: the page stays a server component and one line of
 * transient text still translates.
 */
export function DesignMakerFallback() {
  const tl = useLabelT()
  return <div className="py-24 text-center text-muted-foreground">{tl("designMaker", "Loading maker…")}</div>
}

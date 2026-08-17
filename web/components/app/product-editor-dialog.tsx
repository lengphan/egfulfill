"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { UploadSimple, Image as ImageIcon, X, Plus, Sparkle, Tag, Check, MagicWand, Question, CircleNotch, Trash } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readImageFile } from "@/components/app/design-canvas"
import { setTypeMockups, typeMockupOf } from "@/lib/variant-resolve"
import { getFactorySettings, getInventory, saveVariantStock, type CatalogProduct, type FactorySettings, type ProductType } from "@/lib/api"
import { prettyColorName } from "@/lib/color-name"
import { shipBandKey } from "@/lib/ship-band"
import { swatchHex, swatchBg } from "@/lib/color-swatch"
import { extractDominant, hexToRgb, rgbToOklab } from "@/lib/thread-match"
import { normalizeMethods, methodByKey, PRODUCT_METHODS } from "@/lib/print-method"
import { descriptionToText, looksLikeHtml } from "@/lib/description"
import { packagingHint } from "@/lib/dim-weight"
import { cleanSku } from "@/lib/sku"
import { variantSku, variantLabel, variantPairs } from "@/lib/variant-sku"
import { framingStyle, FOCUS_MIN, FOCUS_MAX, ZOOM_MIN, ZOOM_MAX } from "@/lib/product-framing"

// Sourced from lib/print-method.ts so the picker, the normaliser and the pricing
// surcharges cannot drift apart again.
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
  open, onOpenChange, product, onSave, newIdSeed, nextSku, title, ctaLabel,
  stockByColor,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  product: CatalogProduct | null
  onSave: (p: CatalogProduct) => void
  newIdSeed: number
  /** The next free EG SKU, pre-filled for a NEW product. This dialog never set a sku at
   *  all, which is why two catalogue rows carry none — and a product without one can't be
   *  stocked, can't be resolved from an order line, and publishes a variant sku built on
   *  an empty base. */
  nextSku?: string
  /** Override the heading/CTA. A supplier import passes a product that does NOT exist
   *  yet, so the defaults ("Edit product" / "Save changes") would misdescribe it. */
  title?: string
  ctaLabel?: string
  /** Per-colour supplier stock, when the caller has it (S&S review step). null/undefined
   *  means NOT ASKED — never zero — so the trim control simply does not appear. */
  stockByColor?: Record<string, number> | null
}) {
  const [name, setName] = useState("")
  // OURS and THEIRS — see lib/sku.ts. Only `sku` ever reaches a marketplace or a seller.
  const [sku, setSku] = useState("")
  /**
   * Read through a ref, NOT a dependency of the seeding effect.
   *
   * nextSku changes when the catalogue finishes loading. As a dependency it would re-run
   * the seed and wipe whatever had already been typed into an open form; as a ref it is
   * simply the freshest suggestion at the moment a new product is started.
   */
  const nextSkuRef = useRef(nextSku)
  useEffect(() => { nextSkuRef.current = nextSku }, [nextSku])
  const [supplierSku, setSupplierSku] = useState("")
  const [type, setType] = useState("Apparel")
  // Managed types + their category mockups.
  const [types, setTypes] = useState<ProductType[]>([])
  /**
   * The product's image gallery. Everything a supplier gave us plus anything uploaded —
   * previously only the hero survived, so extraImages and per-colour images were fetched
   * and thrown away the moment a product was added.
   */
  const [gallery, setGallery] = useState<string[]>([])
  /** colour → which gallery image REPRESENTS it. One each; this is what `colorImages` saves,
   *  and what every other surface reads (swatches, row avatars, print mockups). */
  const [colorImgs, setColorImgs] = useState<Record<string, string>>({})
  /**
   * image → which colourway it is a photo OF. The other direction, and the one the grid tags
   * against.
   *
   * A colour has one representative photo but SEVERAL pictures — front, back, side, on-model —
   * and the grid could only express the first. So the back-views sat there asking "— colour —"
   * for photos whose colour the supplier had already told us, and tagging one would have
   * REPLACED the colourway's front shot, because colour → image is a single slot.
   *
   * Keeping both maps means the tag and the representative are separate decisions: tagging a
   * back-view says "this is Navy", not "this is now what Navy looks like". Saved as
   * `colorGallery`; `colorImages` is still exactly `colorImgs`.
   */
  const [imgColor, setImgColor] = useState<Record<string, string>>({})
  /** How the main photo is framed on a card. 100/50 = untouched, the old behaviour. */
  const [imgZoom, setImgZoom] = useState(100)
  const [imgFocusY, setImgFocusY] = useState(50)
  /** After an auto-match run: how sure each colour's guess was — 'high' (supplier map or the
   *  colour name is in the filename) shows ✓, 'low' (matched by the photo's dominant colour)
   *  shows ? so you know which few to eyeball. Cleared per run. */
  const [matchConf, setMatchConf] = useState<Record<string, "high" | "low">>({})
  const [matching, setMatching] = useState(false)
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
  // Product cost = what the blank costs US from the supplier (COGS). Base cost = what we
  // charge the seller. Shipping = the fee. There is no separate "retail price" here — the
  // server charges Base cost + shipping and never a retail figure (see server/pricing.js),
  // so the margin that matters is Base cost − Product cost.
  const [productCost, setProductCost] = useState("")
  const [basePrice, setBasePrice] = useState("")
  const [shipping, setShipping] = useState("")
  // Shipping physicals — weight (oz) + box (inches). Feed the label buy and the dim-weight
  // check that warns when a box would be billed on size instead of weight.
  const [weightOz, setWeightOz] = useState("")
  const [boxL, setBoxL] = useState("")
  const [boxW, setBoxW] = useState("")
  const [boxH, setBoxH] = useState("")
  const [desc, setDesc] = useState("")
  const [sizes, setSizes] = useState<string[]>([])
  const [colors, setColors] = useState<string[]>([])
  // Per-size price tiers, held as strings so a half-typed "12." doesn't round-trip
  // through Number and fight the input. Empty = no override for that size.
  const [tiers, setTiers] = useState<Record<string, Tier>>({})
  // Bulk-fill the whole size table in one go. Base can be a flat $ or a % markup over each
  // size's own product cost (so a pricier 3XL still lands a proportional base); shipping is
  // always a flat $. Writes into the editable rows — nothing is charged until you Save.
  const [bulkBase, setBulkBase] = useState("")
  const [bulkShip, setBulkShip] = useState("")
  const [bulkPct, setBulkPct] = useState(false)
  /**
   * THE SHELF, PER VARIANT — variantSku -> units, as TEXT.
   *
   * Text rather than numbers because "" is a value here and 0 is a different one: blank
   * means we don't track that variant, 0 means it is empty. A numeric state would collapse
   * them the moment anyone cleared a cell.
   *
   * `loadedStock` is what the server had when the dialog opened, so save can write only the
   * cells that actually changed — a grid can hold 496 of them and re-asserting untouched
   * counts would clobber anything the floor scanned in while this window was open.
   */
  const [stock, setStock] = useState<Record<string, string>>({})
  const [loadedStock, setLoadedStock] = useState<Record<string, string>>({})
  const [bulkStock, setBulkStock] = useState("")
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

  /**
   * A photo dropped straight onto ONE SIDE.
   *
   * The side tiles could only ever choose from pictures already in the gallery, so setting
   * a real back-of-garment mockup meant adding it as a product photo first and then coming
   * back down here to pick it — two steps, in two different parts of the dialog, for one
   * intention. Dropping a file on the tile now does both.
   *
   * It STILL JOINS THE GALLERY rather than being stashed only on the side. A side mockup is
   * a picture of this product, everything else that lists the product's images would
   * otherwise never see it, and dropImages already clears any side pointing at a photo that
   * gets removed — so keeping the one set is also what keeps deletion honest.
   *
   * Only the first file: a side is one face, and quietly dropping the rest of a multi-file
   * selection into the gallery unassigned would look like the upload half-failed.
   */
  const setSideFromFiles = (side: string, files: File[]) => {
    const f = files.filter((x) => x.type.startsWith("image/"))[0]
    if (!f) return
    readImageFile(f, (u) => {
      setGallery((g) => (g.includes(u) ? g : [...g, u]))
      setImg((cur) => cur || u)
      setSideMockups((m) => ({ ...m, [side]: u }))
    }, setErr)
  }

  useEffect(() => {
    if (!open) return
    const p = product
    const id = setTimeout(() => {
      setName(p?.name ?? "")
      // A product that HAS a sku keeps it, always. Anything else is offered the next free
      // number, so the common case is "accept it and move on" rather than "invent one".
      //
      // Keyed on the sku, not on whether `product` is set: a supplier import passes a staged
      // product that does not exist yet and carries no sku of its own (the supplier's code
      // goes to supplierSku, because publish writes `sku` onto the seller's listing). Under
      // the old `p ? "" : …` test that opened blank, and the field's hardcoded "EG-1005"
      // placeholder made the blank look filled.
      setSku(String(p?.sku ?? "") || nextSkuRef.current || "")
      setSupplierSku(String(p?.supplierSku ?? ""))
      setType(p?.type ?? "Apparel")
      setMethod(p?.method ?? "DTG")
      setProductCost(p?.productCost != null ? String(p.productCost) : "")
      setBasePrice(p?.basePrice != null ? String(p.basePrice) : p?.base_price != null ? String(p.base_price) : "")
      setShipping(p?.shippingFee != null ? String(p.shippingFee) : p?.shipping_fee != null ? String(p.shipping_fee) : "")
      setWeightOz(p?.weightOz != null ? String(p.weightOz) : "")
      setBoxL(p?.boxL != null ? String(p.boxL) : "")
      setBoxW(p?.boxW != null ? String(p.boxW) : "")
      setBoxH(p?.boxH != null ? String(p.boxH) : "")
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
      // Collect every image we know about — hero, per-colour fronts, the extra angles — so
      // nothing a supplier sent is dropped just because it wasn't the main shot.
      //
      // COLOUR FRONTS BEFORE THE LOOSE GALLERY. `images` used to come first, so a back-view
      // could sit ahead of its own colourway's front and win any "first one wins" rule
      // downstream. The representative photo of a colour should be the shot of that colour.
      setGallery(Array.from(new Set([
        p?.img, p?.image, p?.hero,
        ...Object.values(p?.colorImages ?? {}),
        ...Object.values(p?.colorGallery ?? {}).flat(),
        ...(p?.images ?? []),
      ].filter((x): x is string => !!x))))
      setColorImgs({ ...((p?.colorImages ?? {}) as Record<string, string>) })
      setImgZoom(Number(p?.imgZoom) > 0 ? Number(p!.imgZoom) : 100)
      setImgFocusY(Number.isFinite(Number(p?.imgFocusY)) ? Number(p!.imgFocusY) : 50)
      /**
       * SEED THE TAGS FROM WHAT THE SUPPLIER ALREADY SAID.
       *
       * colorImages gives one url per colour; colorGallery gives the rest of that colour's
       * angles. Both are ground truth — nobody has to match photographs to names by eye, and
       * the "— colour —" tiles that prompted this were all in the second group.
       *
       * The front is written last so it wins any duplicate: if the same url appears as both a
       * colour's front and inside another's gallery, the front is the stronger claim.
       */
      {
        const tags: Record<string, string> = {}
        for (const [c, urls] of Object.entries(p?.colorGallery ?? {})) {
          for (const u of urls ?? []) if (u) tags[u] = c
        }
        for (const [c, u] of Object.entries(p?.colorImages ?? {})) if (u) tags[u] = c
        setImgColor(tags)
      }
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

  /**
   * Remove photos and every reference to them in one move.
   *
   * Anything that points at a picture — the hero, a colour's representative, its tag, a
   * side override — has to let go at the same moment, or the editor holds a url that is
   * no longer in the gallery and saves it.
   */
  const dropImages = (urls: Set<string>) => {
    if (!urls.size) return
    const left = gallery.filter((u) => !urls.has(u))
    setGallery(left)
    // Losing the hero must not leave the product picture-less while photos remain — the
    // next surviving tile takes over, which is the same rule the grid already states
    // ("first tile is main"). Blank only when nothing is left.
    if (urls.has(img)) setImg(left[0] ?? "")
    setColorImgs((m) => Object.fromEntries(Object.entries(m).filter(([, u]) => !urls.has(u))))
    setImgColor((m) => Object.fromEntries(Object.entries(m).filter(([u]) => !urls.has(u))))
    setSideMockups((m) => Object.fromEntries(Object.entries(m).filter(([, u]) => !urls.has(u))))
  }

  /**
   * Remove colourways AND the photos that belong to them.
   *
   * A COLOUR OWNS ITS PICTURES — the representative shot in `colorImgs` and every extra
   * angle tagged with it in `imgColor`. Dropping the chip alone left those tiles behind
   * untagged, so clearing 40 supplier colours off an import meant hunting ~200 orphan
   * photos by hand, one X at a time. The chip is the whole set now.
   */
  /** How many gallery photos a colour owns — so the X can say what it is about to take. */
  const colorPhotoCount = (c: string) => {
    const urls = new Set(Object.entries(imgColor).filter(([, x]) => x === c).map(([u]) => u))
    if (colorImgs[c]) urls.add(colorImgs[c])
    return urls.size
  }

  const dropColors = (names: string[]) => {
    const gone = new Set(names)
    if (!gone.size) return
    const urls = new Set<string>()
    for (const [u, c] of Object.entries(imgColor)) if (gone.has(c)) urls.add(u)
    for (const c of names) { const u = colorImgs[c]; if (u) urls.add(u) }
    setColors((p) => p.filter((c) => !gone.has(c)))
    setColorImgs((m) => Object.fromEntries(Object.entries(m).filter(([c]) => !gone.has(c))))
    setMatchConf((m) => Object.fromEntries(Object.entries(m).filter(([c]) => !gone.has(c))))
    dropImages(urls)
  }

  const supplier = product?.supplier

  // Lowercase word tokens of a colour name, for matching against an image filename/URL:
  // "Wild Plum" → ["wild","plum"], "Caribbean Blue" → ["caribbean","blue"]. ≥3 chars so a
  // stray "of"/"and" can't match half the gallery.
  const colorWords = (c: string) =>
    prettyColorName(c).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3)

  /**
   * One-click colour → photo matcher. Three passes, best-evidence first, each colour taken
   * by the first pass that lands it so a strong signal never loses to a weak one:
   *   1. Supplier map — if this product came from a supplier, its colour→image mapping is
   *      ground truth. (high ✓)
   *   2. Filename/URL — the colour's name appears in the image path (e.g. …/black_1.jpg). (high ✓)
   *   3. Dominant colour — compare the colour NAME's reference swatch to each remaining
   *      photo's dominant colour (OKLab distance) and take the nearest. (low ?)
   * Only fills BLANK colours (never clobbers a manual pick) and never reuses a photo. A
   * colour we can't place is left blank for the human — an honest "?", not a wrong guess.
   */
  const autoMatch = async () => {
    setMatching(true)
    try {
      const next: Record<string, string> = { ...colorImgs }
      const conf: Record<string, "high" | "low"> = {}
      const used = new Set(Object.values(next).filter(Boolean))
      // TAG AS WELL AS PLACE. A match tells us two things — which photo represents the colour,
      // and that the photo IS of that colour — and only the first was being recorded, so an
      // auto-matched tile still showed "— colour —".
      const tags: Record<string, string> = { ...imgColor }
      const take = (c: string, u: string, k: "high" | "low") => { next[c] = u; used.add(u); conf[c] = k; tags[u] = c }

      // 1) supplier ground-truth map
      const supplierMap = (product?.colorImages ?? {}) as Record<string, string>
      for (const c of colors) {
        if (next[c]) continue
        const u = supplierMap[c]
        if (u && gallery.includes(u) && !used.has(u)) take(c, u, "high")
      }
      // 2) colour name in the filename/URL
      for (const c of colors) {
        if (next[c]) continue
        const words = colorWords(c)
        const hit = gallery.find((u) => !used.has(u) && words.some((w) => u.toLowerCase().includes(w)))
        if (hit) take(c, hit, "high")
      }
      // 3) dominant-colour match for whatever's left (needs a recognisable colour name)
      const unplaced = colors.filter((c) => !next[c] && swatchHex(c))
      if (unplaced.length) {
        const free = gallery.filter((u) => !used.has(u))
        const dom = new Map<string, { L: number; a: number; b: number }>()
        for (const u of free) {
          const d = await extractDominant(u, 1)
          if (d[0]) dom.set(u, rgbToOklab(d[0].r, d[0].g, d[0].b))
        }
        for (const c of unplaced) {
          const hex = swatchHex(c)!
          const rgb = hexToRgb(hex)
          const target = rgbToOklab(rgb.r, rgb.g, rgb.b)
          let best: string | null = null, bestD = Infinity
          for (const [u, lab] of dom) {
            if (used.has(u)) continue
            const dL = target.L - lab.L, da = target.a - lab.a, db = target.b - lab.b
            const dist = dL * dL + da * da + db * db
            if (dist < bestD) { bestD = dist; best = u }
          }
          if (best) take(c, best, "low")
        }
      }
      setColorImgs(next)
      setImgColor(tags)
      setMatchConf(conf)
    } finally {
      setMatching(false)
    }
  }

  // Platform pricing policy: the per-method surcharge and the flat shipping band. Loaded
  // so the editor can PREFILL a sensible retail price rather than leaving the seller to
  // work out cost + surcharge in their head.
  const [fees, setFees] = useState<FactorySettings | null>(null)
  // The markup that turns a supplier's product cost into the base cost we charge.
  // Same number pricing.js uses, so the preview in the size table matches the quote.
  // The methods currently ticked, read back out of the joined `method` string through the
  // same normaliser the rest of the app uses — so a product imported with
  // "DTG Print / Embroidery" shows both ticked rather than neither.
  // BY KEY, not by label. Filtering the normalised labels against the picker's own label
  // list silently dropped any method whose two spellings differed — see METHOD_TABLE in
  // lib/print-method.ts. Keys are stable, so a product stored as "DTG Print", "dtg" or
  // "Direct to Garment" ticks the same chip.
  const pickedKeys = useMemo(() => normalizeMethods([method]).map((m) => m.key), [method])
  const markup = Number(fees?.base_markup) || 0
  useEffect(() => {
    const id = setTimeout(() => { getFactorySettings().then(setFees).catch(() => {}) }, 0)
    return () => clearTimeout(id)
  }, [])

  // Which flat shipping band this product falls in. lib/ship-band.ts is the one copy of
  // the server's shippingBandOf — the product page needs the same answer, and a second
  // private version of it here is how the two screens start disagreeing about money.
  const bandKey = shipBandKey(`${type} ${name}`)
  const bandFee = fees?.[bandKey]

  // Dim-weight check for the packaging suggestion (÷166, USPS/Shippo). Deterministic math.
  const pkg = packagingHint(weightOz, boxL, boxW, boxH)

  // Apply the bulk Base/Shipping to every size at once. The base value is an UPCHARGE OVER
  // the product cost, never a fixed price: in $ mode it ADDS dollars (cost $10 + $5 = base
  // $15); in % mode it adds a percentage (cost $10 + 20% = base $12). Each size uses its own
  // product cost, else the product-level one. Shipping is a flat fee. A blank field is left
  // alone, so you can bulk-set just one column.
  const applyBulk = () => {
    const b = bulkBase.trim(), sh = bulkShip.trim()
    if (b === "" && sh === "") return
    const amt = Number(b) || 0
    setTiers((prev) => {
      const nextT: Record<string, Tier> = { ...prev }
      for (const s of sizes) {
        const cur = nextT[s] ?? { price: "", shipping: "", cost: "" }
        let price = cur.price
        if (b !== "") {
          const rowCost = num(cur.cost)
          const cost = !isNaN(rowCost) ? rowCost : (num(productCost) || 0)
          const nextBase = bulkPct ? cost * (1 + amt / 100) : cost + amt
          price = String(Math.round(nextBase * 100) / 100)
        }
        nextT[s] = { ...cur, price, shipping: sh !== "" ? String(Number(sh) || 0) : cur.shipping }
      }
      return nextT
    })
  }

  /** OUR sku, as it will be saved — the stock grid keys off it, so it has to be the same
   *  string `save` writes and not the raw field. */
  const ourSku = cleanSku(sku) || cleanSku(nextSku ?? "")

  /**
   * What the shelf holds for this product's variants, read once per opening.
   *
   * Only rows whose sku starts with this product's — the inventory table is the whole
   * factory, and pulling it all into the grid would put another product's counts in these
   * cells the moment two skus shared a prefix.
   */
  useEffect(() => {
    if (!open || !ourSku) return
    let live = true
    const t = setTimeout(() => {
      getInventory().then((rows) => {
        if (!live) return
        const mine: Record<string, string> = {}
        const want = new Set(variantPairs(sizes, colors).map((v) => variantSku(ourSku, v.size, v.color)))
        for (const r of rows ?? []) {
          const key = String(r.sku || "").toUpperCase()
          if (want.has(key) && r.in_stock != null) mine[key] = String(r.in_stock)
        }
        setStock(mine); setLoadedStock(mine)
      }).catch(() => {})
    }, 0)
    return () => { live = false; clearTimeout(t) }
    // sizes/colors deliberately absent: adding a size must not re-read and wipe unsaved
    // edits. A variant added after opening simply starts blank, which is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ourSku])

  /** Put the bulk number in every cell, or in one colourway's row. */
  const fillStock = (color?: string) => {
    const v = bulkStock.trim()
    if (v === "") return
    setStock((m) => {
      const next = { ...m }
      for (const pair of variantPairs(sizes, color ? [color] : colors)) {
        const key = variantSku(ourSku, pair.size, pair.color)
        if (key) next[key] = v
      }
      return next
    })
  }

  const save = () => {
    if (!name.trim()) { setErr("Give the product a name."); return }
    const colorImages: Record<string, string> = {}
    for (const c of colors) colorImages[c] = colorImgs[c] || ""
    /**
     * EVERY tagged photo of each colourway, in gallery order.
     *
     * Built from the image → colour tags rather than kept as its own list, so what saves is
     * exactly what the grid shows — there is no second place to forget to update. Gallery
     * order matters because that order is itself a decision here (the tiles are draggable and
     * the first is the main image).
     *
     * Only colours still on the product are written: deleting a colour should not leave its
     * photos filed under a name nothing references.
     */
    const colorGallery: Record<string, string[]> = {}
    for (const u of gallery) {
      const c = imgColor[u]
      if (!c || !colors.includes(c)) continue
      if (!colorGallery[c]) colorGallery[c] = []
      colorGallery[c].push(u)
    }
    // Product-level cost/base/shipping default = the first size's tier (or the loaded value).
    const firstTierNum = (k: keyof Tier, stateVal: string): number | undefined => {
      const tv = (sizes.length ? tiers[sizes[0]]?.[k] : "")?.trim()
      if (tv) return Number(tv) || 0
      const sv = stateVal.trim()
      return sv === "" ? undefined : Number(sv) || 0
    }
    const next: CatalogProduct = {
      ...(product ?? {}),
      id: product?.id ?? genId(newIdSeed),
      name: name.trim(),
      // Never blank: an untyped sku falls back to the pre-filled next one, because a
      // product without a sku is one that silently can't be stocked or resolved.
      sku: cleanSku(sku) || cleanSku(nextSku ?? "") || undefined,
      supplierSku: supplierSku.trim() || undefined,
      type, method, status,
      // Product cost = supplier COGS; Base cost = what the seller is charged. Save both as
      // undefined when blank so the server derives base = productCost + markup rather than
      // treating a blank as $0 (see server/pricing.js). `price` (any legacy retail figure)
      // is preserved untouched via the spread above — it's no longer edited here.
      // Product-level defaults now come from the FIRST size's tier (the summary row was removed;
      // per-size pricing is the source). Falls back to the loaded value, else undefined so the
      // server derives base = productCost + markup rather than treating a blank as $0.
      productCost: firstTierNum("cost", productCost),
      basePrice: firstTierNum("price", basePrice),
      shippingFee: firstTierNum("shipping", shipping),
      weightOz: weightOz.trim() === "" ? undefined : Number(weightOz) || 0,
      boxL: boxL.trim() === "" ? undefined : Number(boxL) || 0,
      boxW: boxW.trim() === "" ? undefined : Number(boxW) || 0,
      boxH: boxH.trim() === "" ? undefined : Number(boxH) || 0,
      sizePrices: strToTiers(tiers, sizes),
      description: desc.trim() || undefined,
      sizes,
      colorImages,
      // Undefined rather than {} when nothing is tagged, so a product that never had this
      // doesn't gain an empty object on every save.
      colorGallery: Object.keys(colorGallery).length ? colorGallery : undefined,
      // Only stored when it differs from the default, so an untouched product does not gain
      // two fields on every save.
      imgZoom: imgZoom !== 100 ? imgZoom : undefined,
      imgFocusY: imgFocusY !== 50 ? imgFocusY : undefined,
      mainColor: colors[0] || product?.mainColor,
      // Everything we hold, hero first — the gallery is the record, `img` is which one
      // represents the product in the catalog.
      images: Array.from(new Set([img, ...gallery].filter(Boolean))) as string[],
      // Only send overrides that exist. An empty map means "inherit the type", and
      // writing {} explicitly is how a product goes back to following settings.
      side_mockups: Object.fromEntries(Object.entries(sideMockups).filter(([, v]) => !!v)),
      img, // the hero — what the catalog shows
      /**
       * THE VARIANT SKUS THIS PRODUCT OWNS, written onto the product so the rest of the
       * system can match a line to a shelf without recomputing the scheme. pricing.js's
       * candidateSkus() already reads this field — it has been in the shape all along and
       * nothing was ever filling it in.
       */
      variantSkus: colors.length && sizes.length && ourSku
        ? variantPairs(sizes, colors).map((v) => ({ sku: variantSku(ourSku, v.size, v.color), color: v.color, size: v.size }))
        : product?.variantSkus,
    }
    /**
     * ONLY THE CELLS THAT MOVED.
     *
     * The grid holds up to 496 counts and the floor scans against the same rows while this
     * window is open. Re-asserting every cell would overwrite a delivery someone booked in
     * two minutes ago with whatever this dialog happened to load — the exact clobber the
     * whole-list inventory POST is warned about in api.ts.
     *
     * Fire-and-forget on purpose: the product save below is what the person pressed the
     * button for, and blocking it on an inventory write would hold the dialog open behind a
     * request that has nothing to do with the product record. A failure surfaces on the
     * Inventory page, where the numbers live.
     */
    const moved = Object.entries(stock).filter(([k, v]) => (loadedStock[k] ?? "") !== v)
    if (moved.length) {
      void saveVariantStock(moved.map(([sku, v]) => {
        const pair = variantPairs(sizes, colors).find((p) => variantSku(ourSku, p.size, p.color) === sku)
        return {
          sku,
          name: name.trim() || undefined,
          variant: pair ? variantLabel(pair.size, pair.color) : undefined,
          // "" is CLEARED, not zero — the row is left untracked rather than written as empty
          // stock. Skipped server-side for the same reason.
          in_stock: v.trim() === "" ? null : Number(v),
        }
      })).catch(() => {})
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
            <div className="shrink-0 space-y-1.5">
            <div
              className="relative flex size-28 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40"
              title={img ? "The main image, chosen in Images below" : "No image yet — add one in Images below"}
            >
              {img ? (
                /**
                 * FRAMED THE WAY THE CARD WILL FRAME IT.
                 *
                 * object-contain here and object-cover on the card meant this preview could
                 * never show the problem it exists to solve. Same fit, same zoom, same focal
                 * point — so what you set is what the grid shows.
                 */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={img}
                  alt=""
                  className="size-full object-cover"
                  // The SAME function every other surface frames with (lib/product-framing),
                  // so "what you set is what the grid shows" stays true of the product page
                  // and the public catalogue too — which it was not.
                  style={framingStyle({ imgZoom, imgFocusY })}
                />
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
            {/**
              * ZOOM AND VERTICAL POSITION — the two things that fix a small product in a big
              * white photo, and the only two.
              *
              * The whitespace is IN the supplier's file, so no amount of layout work moves it;
              * the card can only scale the picture up and choose which band of it to keep.
              * Horizontal is deliberately absent: studio shots are centred left-to-right, and
              * a control nobody needs is a control somebody will nudge by accident.
              *
              * Only when there is an image, and Reset only once it has been changed — so the
              * common case is two sliders and nothing else.
              */}
            {img && (
              <div className="space-y-1">
                <label className="flex items-center gap-1.5">
                  <span className="w-8 shrink-0 text-3xs uppercase tracking-wider text-muted-foreground">Zoom</span>
                  <input
                    type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={5} value={imgZoom || 100}
                    onChange={(e) => setImgZoom(Number(e.target.value))}
                    className="h-1 flex-1 accent-primary" aria-label="Main image zoom"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="w-8 shrink-0 text-3xs uppercase tracking-wider text-muted-foreground">Up/dn</span>
                  {/* The ENDS are the same numbers they always were (0–100, 50 centre) — what
                      grew is how far each one moves the picture. It used to pan through the
                      cover overflow, which on a 4:3 photo in a square box is zero: the slider
                      travelled its whole length and nothing happened. See FOCUS_TRAVEL_PCT. */}
                  <input
                    type="range" min={FOCUS_MIN} max={FOCUS_MAX} step={1} value={imgFocusY ?? 50}
                    onChange={(e) => setImgFocusY(Number(e.target.value))}
                    className="h-1 flex-1 accent-primary" aria-label="Main image vertical position"
                  />
                </label>
                {((imgZoom || 100) !== 100 || (imgFocusY ?? 50) !== 50) && (
                  <button
                    type="button"
                    onClick={() => { setImgZoom(100); setImgFocusY(50) }}
                    className="w-full text-3xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Reset framing
                  </button>
                )}
              </div>
            )}
            </div>
            <div className="flex-1 space-y-2">
              <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Name</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Heavyweight Hoodie" className="h-9" /></label>
              {/* TWO SKUS, and the labels say which is which — the whole point is that one
                  of them never leaves the factory. Ours is pre-filled for a new product;
                  theirs is optional and only exists for a blank we buy in. */}
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Our SKU</span>
                  {/* The placeholder is the number this product would ACTUALLY get, not a
                      hardcoded example — "EG-1005" over an empty field reads as filled. */}
                  <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder={nextSku ?? "EG-1005"} className="h-9 font-mono" />
                  <span className="text-2xs text-muted-foreground">Stock is held against this, and the seller sees it on their listing.</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Supplier SKU</span>
                  <Input value={supplierSku} onChange={(e) => setSupplierSku(e.target.value)} placeholder="optional" className="h-9 font-mono" />
                  <span className="text-2xs text-muted-foreground">Never shown to sellers or published anywhere.</span>
                </label>
              </div>
              {/* Type + Status share the top row; Status used to sit alone far down the
                  form. Methods drop to their own full-width line below (see next block) so
                  the chips flow across the whole width instead of wrapping inside a cramped
                  half-column and leaving a blank gap beside Type. */}
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Type</span>
                  <select value={type} onChange={(e) => setType(e.target.value)} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{typeNames.map((t) => <option key={t}>{t}</option>)}</select>
                </label>
                {/* STATUS IS THE VISIBILITY SWITCH — it decides who sees the product, and
                    there is no second flag to remember. Active reaches the public marketing
                    site; everything below it is progressively narrower. The helper line is
                    not decoration: "Active" alone gave no hint that it published to the open
                    web, which is exactly how five Active products and a one-product website
                    coexisted for months. */}
                <label className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Status</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                    <option>Active</option>
                    <option>Sellers only</option>
                    <option>Staff only</option>
                    <option>Draft</option>
                    <option>Archived</option>
                  </select>
                </label>
              </div>
              <p className="-mt-1 text-xs text-muted-foreground">
                {status === "Active"
                  ? "On the public marketing site, and orderable by sellers."
                  : status === "Sellers only"
                    ? "Orderable by sellers in the app. Not on the public site."
                    : "Staff only — sellers never see this product."}
              </p>
              {/* METHODS ARE MULTIPLE. A blank commonly takes several techniques — the
                  single select forced one, which is why a product that can be embroidered
                  AND screen printed had to lie about itself. The data already worked this
                  way: `method` holds a multi-value string ("DTG Print / Embroidery") and
                  normalizeMethods() splits it, which is exactly what methodsOf() reads.
                  Only this control was single-valued. Stored in the same joined format,
                  so nothing downstream changes. Full width so all chips sit on one line. */}
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Methods</span>
                <div className="flex flex-wrap gap-1.5 rounded-2xl border border-border bg-card px-2 py-2">
                  {PRODUCT_METHODS.map((pm) => {
                    const m = pm.label
                    const on = pickedKeys.includes(pm.key)
                    return (
                      <button
                        key={pm.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          // Rebuilt from the KEYS that are on, then written back as canonical
                          // labels — so toggling one chip can no longer erase a method the
                          // list simply failed to recognise.
                          const keys = on ? pickedKeys.filter((k) => k !== pm.key) : [...pickedKeys, pm.key]
                          setMethod(keys.map((k) => methodByKey(k)?.label).filter(Boolean).join(" / "))
                        }}
                        className={"rounded-md border px-2 py-0.5 text-xs font-medium transition-colors " +
                          (on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground")}
                      >
                        {on && <Check size={10} weight="bold" className="mr-1 inline" />}{m}
                      </button>
                    )
                  })}
                </div>
                {/* UNTICKING THE LAST ONE IS A DECISION WITH CONSEQUENCES ELSEWHERE, and
                    they were invisible from here. A supplier style is staged with one
                    already ticked (S&S "DTG", Otto "Embroidery"), so the first click on
                    that chip REMOVES it — and the product saves with no technique at all.
                    Downstream that blank can't be given a method on a manual order or an
                    open one; both fields go dead reading "None on this blank". Said here,
                    where it can still be undone with one click.
                    --primary, not amber: amber is a reserved floor status (warning / on
                    hold), and this is a form telling you what a field will do. */}
                {pickedKeys.length === 0 && (
                  <p className="text-xs text-primary">
                    No method picked — an order for this blank won&apos;t be able to choose one.
                  </p>
                )}
              </div>
              {typeMockup && !img && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UploadSimple size={13} /> Using the {type} default — add an image below to override it.
                </div>
              )}
            </div>
          </div>

          {/* Sizes & pricing — the per-size cost / base / shipping below is the source of truth.
              The product-level summary row + margin readout were removed as redundant; the
              product-level defaults are derived from the first size's tier on save. */}
          <div className="rounded-xl border border-border p-4">

            {/* Per-size price tiers — the canonical sizePrices [{size, price, shipping}].
                Keyed by SIZE, not colour: a 3XL costs more to buy and to ship, while Navy
                vs White is the same parcel. Blank = use the numbers above. A tier needs a
                cost to exist (matching npmCollectPriceTiers), so shipping alone is ignored. */}
            {/* Always rendered — this table is now the size list itself, so gating it on
                sizes.length meant deleting the last size removed the only way to add one
                back. */}
            <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Sizes &amp; pricing</span>
                  {Object.keys(tiers).length > 0 && (
                    <button onClick={() => setTiers({})} className="text-xs font-medium text-primary hover:underline">Clear pricing</button>
                  )}
                </div>
                {/* Bulk-fill every size at once. Base is an UPCHARGE over the product cost,
                    never a fixed price: $ adds dollars (cost 10 + 5 = base 15), % adds a
                    percentage. Shipping is a flat fee. A blank field is left as-is. */}
                {sizes.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-2">
                    <span className="text-xs font-medium text-muted-foreground">Base = product cost +</span>
                    <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                      {([[false, "$"], [true, "%"]] as const).map(([v, lbl]) => (
                        <button key={lbl} type="button" onClick={() => setBulkPct(v)}
                          className={"eg-tap rounded px-2 py-0.5 font-medium transition-colors " + (bulkPct === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                    <Input value={bulkBase} onChange={(e) => setBulkBase(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder={bulkPct ? "upcharge %" : "upcharge $"} className="h-8 w-32 text-xs" inputMode="decimal" aria-label="Base upcharge over product cost" />
                    <span className="text-xs text-muted-foreground">· shipping</span>
                    <Input value={bulkShip} onChange={(e) => setBulkShip(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="$ flat" className="h-8 w-20 text-xs" inputMode="decimal" aria-label="Bulk shipping fee" />
                    <Button type="button" size="sm" variant="outline" className="h-8" onClick={applyBulk} disabled={!bulkBase.trim() && !bulkShip.trim()}>Apply to all</Button>
                  </div>
                )}
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
                        /* Inherits the product-level supplier cost as the shown number when
                           this size has none of its own — the same pattern Base cost and
                           Shipping use. Only override here when a size actually costs more. */
                        placeholder={productCost.trim() !== "" ? Number(productCost).toFixed(2) : "—"}
                        title={productCost.trim() !== "" ? `Using the product-level supplier cost ${Number(productCost).toFixed(2)}` : "Enter the supplier cost for this size"}
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
                      {/* Margin for THIS size = its Base cost − its Product cost (what we
                          charge the seller minus what the blank costs us). Base is this
                          row's if typed, else the derived product-cost + markup, else the
                          product-level base; product cost is this row's, else the product
                          level. A 3XL that costs more to buy shows a thinner margin here. */}
                      {(() => {
                        const baseN = t?.price?.trim() ? Number(t.price)
                          : derived ? Number(derived)
                          : Number(basePrice)
                        const costRow = t?.cost?.trim() ? Number(t.cost) : Number(productCost)
                        const m = baseN - costRow
                        return (
                          <span
                            className={"text-right text-xs font-semibold tabular-nums " + (!isFinite(m) ? "text-muted-foreground" : m >= 0 ? "text-success" : "text-destructive")}
                            title={isFinite(m) ? `Base ${baseN.toFixed(2)} − product cost ${costRow.toFixed(2)}` : "Enter a product cost and a base cost"}
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

          {/**
            * STOCK, PER VARIANT — its own card, deliberately not a column in the table above.
            *
            * Sizes & pricing is MONEY, and money is per size: a 3XL costs more to buy and to
            * ship, and colour changes neither. Stock is the opposite — it is the shelf, and a
            * shelf is per size AND colour. Putting a stock column in that table would have
            * been one number covering 17 colours, which is the very thing that made "do we
            * have it?" unanswerable: `inventory` is keyed by sku, and until now an order line
            * resolved to the PRODUCT's sku, so one Gildan 5000 had a single count across 8
            * sizes and 62 colours.
            *
            * A GRID, NOT A LIST OF 496 FIELDS. Colours down, sizes across, so a row is a
            * colourway and a column is a size — the two ways anyone actually asks the
            * question ("how many black?", "are we out of 3XL?").
            *
            * EMPTY IS NOT ZERO, and the grid must keep them apart: blank means we don't track
            * that variant and the boards read it as "unknown"; 0 means the shelf is empty and
            * reads as "out". stock-status.ts has always drawn that line — this is the first
            * screen that can express it.
            */}
          {ourSku && colors.length > 0 && sizes.length > 0 && (
            <div className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  Stock
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {sizes.length} size{sizes.length === 1 ? "" : "s"} × {colors.length} colour{colors.length === 1 ? "" : "s"}
                  </span>
                </span>
                {/* The pricing card's "Apply to all", in the same words and the same place,
                    because it is the same gesture on the same shape of table. */}
                <div className="flex items-center gap-1.5 text-xs">
                  <Input
                    value={bulkStock}
                    onChange={(e) => setBulkStock(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="units" inputMode="numeric"
                    className="h-7 w-20 text-center text-xs"
                    aria-label="Units to apply"
                  />
                  <button
                    type="button"
                    onClick={() => fillStock()}
                    disabled={bulkStock.trim() === ""}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                  >
                    Apply to all
                  </button>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-card pb-1.5 pr-2 text-left font-medium text-muted-foreground">Colour</th>
                      {sizes.map((s) => (
                        <th key={s} className="px-1 pb-1.5 text-center font-medium text-muted-foreground">{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {colors.map((c) => (
                      <tr key={c}>
                        <th className="sticky left-0 z-10 max-w-[9rem] truncate bg-card py-0.5 pr-2 text-left font-normal" title={prettyColorName(c)}>
                          <span className="flex items-center gap-1.5">
                            <span className="size-3 shrink-0 rounded-full border border-black/10" style={{ background: swatchBg(c) ?? "#c7c4bd" }} />
                            <span className="truncate">{prettyColorName(c)}</span>
                            {/* One colourway at a time — the common case is a delivery of
                                one colour in every size, which "apply to all" would spread
                                across the whole product. */}
                            <button
                              type="button"
                              onClick={() => fillStock(c)}
                              disabled={bulkStock.trim() === ""}
                              title={`Put ${bulkStock || "…"} in every size of ${prettyColorName(c)}`}
                              className="ml-auto shrink-0 rounded px-1 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-0"
                            >
                              fill
                            </button>
                          </span>
                        </th>
                        {sizes.map((s) => {
                          const key = variantSku(ourSku, s, c)
                          return (
                            <td key={s} className="px-1 py-0.5">
                              <Input
                                value={stock[key] ?? ""}
                                onChange={(e) => setStock((m) => ({ ...m, [key]: e.target.value.replace(/[^0-9]/g, "") }))}
                                placeholder="—" inputMode="numeric"
                                className="h-7 w-14 text-center text-xs"
                                aria-label={`Stock for ${prettyColorName(c)} ${s}`}
                                title={key}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Blank means we don&apos;t track that variant — different from 0, which says the shelf is
                empty. Each cell is stocked against its own sku ({variantSku(ourSku, sizes[0], colors[0])}).
              </p>
            </div>
          )}

          {/* Shipping physicals + dim-weight guard. Carriers bill the greater of actual and
              dimensional weight (L×W×H÷166); keep the box under the ceiling so you're always
              billed on weight and never reweighed up. */}
          <div className="rounded-xl border border-border p-4">
            <span className="text-sm font-medium">Weight &amp; dimensions</span>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Weight (oz)</span><Input value={weightOz} onChange={(e) => setWeightOz(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 12" className="h-9" inputMode="decimal" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Length (in)</span><Input value={boxL} onChange={(e) => setBoxL(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="L" className="h-9" inputMode="decimal" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Width (in)</span><Input value={boxW} onChange={(e) => setBoxW(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="W" className="h-9" inputMode="decimal" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Height (in)</span><Input value={boxH} onChange={(e) => setBoxH(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="H" className="h-9" inputMode="decimal" /></label>
            </div>
            {pkg ? (
              <div className={"mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs " +
                (pkg.billedOnSize ? "border-primary/40 bg-primary/5 text-foreground" : "border-emerald-300 bg-emerald-50 text-emerald-800")}>
                <Question size={14} weight="bold" className="mt-0.5 shrink-0" />
                {pkg.billedOnSize ? (
                  <span>
                    <span className="font-medium text-primary">Billed on size, not weight.</span> This box&apos;s dimensional weight is {pkg.dimLb!.toFixed(2)} lb vs {pkg.actualLb.toFixed(2)} lb actual — the carrier upcharges the difference. Keep the box under <span className="font-medium tabular-nums">{Math.round(pkg.maxVolumeIn3)} in³</span> (about {pkg.suggestedCube.toFixed(1)}″ each side) to be billed on the {pkg.actualLb.toFixed(2)} lb actual weight instead.
                  </span>
                ) : (
                  <span>
                    Billed on actual weight ({pkg.actualLb.toFixed(2)} lb) ✓{pkg.dimLb != null ? ` · dim weight ${pkg.dimLb.toFixed(2)} lb` : ""}. Stay under <span className="font-medium tabular-nums">{Math.round(pkg.maxVolumeIn3)} in³</span> (≈ {pkg.suggestedCube.toFixed(1)}″ cube) and it keeps winning — no reweigh upcharge.
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Enter the weight to see the smallest box that avoids a dimensional-weight upcharge (USPS/Shippo, ÷166).</p>
            )}
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
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Photo</span>
              <div className="flex items-center gap-2">
                {/**
                  * DROP THE COLOURWAYS THE SUPPLIER CANNOT FILL — before they become a product.
                  *
                  * A style arrives with every colour it has ever had; several are routinely at
                  * zero. Publishing those means a seller picks one, the order reaches the
                  * floor, and the shortage is discovered at the point it costs the most. The
                  * cheapest moment to decide is here, while it is still a draft.
                  *
                  * A BUTTON, NOT A FILTER. It says how many it will remove and does it once,
                  * so the decision is visible and reversible by cancelling the dialog — stock
                  * moves, and a colour silently missing from a product nobody can explain is
                  * worse than one you chose to drop.
                  *
                  * Shown only when we actually asked: `stockByColor` is null for Otto and
                  * SanMar, and "no data" must never be rendered as "no stock".
                  */}
                {(() => {
                  if (!stockByColor) return null
                  const dead = colors.filter((c) => (stockByColor[c] ?? 0) <= 0)
                  if (!dead.length || dead.length === colors.length) return null
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        const keep = new Set(colors.filter((c) => (stockByColor[c] ?? 0) > 0))
                        const gone = colors.filter((c) => !keep.has(c))
                        // Their photos go with them — a picture of a colourway the product
                        // no longer offers is exactly as unsellable as the colour was.
                        const shots = gone.reduce((n, c) => n + colorPhotoCount(c), 0)
                        dropColors(gone)
                        setErr(`Removed ${gone.length} out-of-stock colour${gone.length === 1 ? "" : "s"}${shots ? ` and ${shots} photo${shots === 1 ? "" : "s"}` : ""}: ${gone.map(prettyColorName).join(", ")}`)
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                      title={dead.map((c) => `${prettyColorName(c)} — 0`).join("\n")}
                    >
                      <Trash size={12} weight="bold" />
                      Remove {dead.length} out of stock
                    </button>
                  )
                })()}
                {colors.length > 0 && gallery.length > 0 && (
                  <button type="button" onClick={autoMatch} disabled={matching} className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-60">
                    {matching ? <CircleNotch size={12} weight="bold" className="animate-spin" /> : <MagicWand size={12} weight="fill" />}
                    {matching ? "Matching…" : "Auto-match colours"}
                  </button>
                )}
                <span className="text-xs text-muted-foreground">{gallery.length ? `${gallery.length} photos · drag to reorder` : "Drag in, paste, or add"}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {gallery.map((u, i) => {
                // The tag on THIS photo. Read from image → colour, so several photos can carry
                // the same colourway; the old lookup asked "which colour has this as its
                // representative", which by definition could only ever answer for one.
                const assigned = imgColor[u] || undefined
                // Is it the colour's representative — the one that becomes colorImages[c]?
                const isRep = !!assigned && colorImgs[assigned] === u
                return (
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
                  <div className={"relative size-28 overflow-hidden rounded-lg border-2 transition-colors " + (u === img ? "border-primary" : "border-border") + (dragIdx === i ? " opacity-40" : "")}>
                    {/* Click the photo to make it the MAIN image (first = hero). */}
                    <button type="button" onClick={() => setImg(u)} title={u === img ? "Main image" : "Make this the main image"} className="block size-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="size-full object-cover" draggable={false} />
                    </button>
                    {u === img && <span className="pointer-events-none absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-3xs font-semibold text-primary-foreground shadow">Main</span>}
                    {assigned && matchConf[assigned] === "high" && <Check size={13} weight="bold" className="pointer-events-none absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-success" aria-label="Confident match" />}
                    {assigned && matchConf[assigned] === "low" && <Question size={13} weight="bold" className="pointer-events-none absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-amber-500" aria-label="Guessed — verify" />}
                    {/* Colour tag overlaid on the photo. */}
                    {colors.length > 0 && (
                      <select
                        value={assigned ?? ""}
                        onChange={(e) => {
                          const c = e.target.value
                          /**
                           * TAGGING IS NOT PROMOTING.
                           *
                           * This used to move the colour's representative photo on every
                           * change — `delete` whatever held u, then `n[c] = u` — so tagging a
                           * back-view as Navy replaced Navy's front shot with the back of the
                           * cap, on the field the swatches and the print mockup read.
                           *
                           * The tag is its own map now. The representative only changes when
                           * the colour has NONE, which is the case where filling it in is
                           * plainly right and nothing is displaced.
                           */
                          setImgColor((m) => { const n = { ...m }; if (c) n[u] = c; else delete n[u]; return n })
                          if (c) setColorImgs((m) => (m[c] ? m : { ...m, [c]: u }))
                          if (assigned) setMatchConf((m) => { const n = { ...m }; delete n[assigned]; return n })
                          if (c) setMatchConf((m) => { const n = { ...m }; delete n[c]; return n })
                        }}
                        // THREE STATES, because there are now three. Solid = this is the
                        // colour's photo (what colorImages saves and every other screen
                        // shows). Tinted = also this colour, an extra angle. Plain = untagged.
                        // Without the middle one, ten photos of Navy all looked like ten
                        // competing answers to "which one is Navy".
                        className={"eg-select absolute inset-x-1 bottom-1 h-6 w-[calc(100%-0.5rem)] rounded-md border px-1 text-2xs font-medium backdrop-blur transition-colors "
                          + (isRep ? "border-primary/40 bg-primary/90 text-primary-foreground"
                            : assigned ? "border-primary/30 bg-primary/20 text-primary"
                              : "border-border bg-card/90 text-muted-foreground")}
                        title={isRep ? `${assigned} — this colour's photo` : assigned ? `${assigned} — extra angle` : "Tag this photo's colour"}
                        aria-label="Tag this photo's colour"
                      >
                        <option value="">— colour —</option>
                        {colors.map((c) => <option key={c} value={c}>{prettyColorName(c)}</option>)}
                      </select>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={isRep ? `Remove ${prettyColorName(assigned!)} and its other angles` : "Remove image"}
                    title={isRep
                      ? `Remove this photo${colorPhotoCount(assigned!) > 1 ? ` and the other ${colorPhotoCount(assigned!) - 1} ${prettyColorName(assigned!)} angle${colorPhotoCount(assigned!) === 2 ? "" : "s"}` : ""}`
                      : "Remove this photo"}
                    onClick={() => {
                      /**
                       * Deleting a colour's MAIN shot deletes its side angles too.
                       *
                       * They are one set — the back and the on-model only mean anything as
                       * pictures of that colourway. Left behind, the next auto-match or a
                       * stray tag promotes a back-view into the swatch every other screen
                       * reads. Removing a photo that is NOT the representative is still
                       * just that photo. The colour itself stays; use its chip to drop it.
                       */
                      const urls = new Set([u])
                      if (isRep && assigned) for (const [x, c] of Object.entries(imgColor)) if (c === assigned) urls.add(x)
                      dropImages(urls)
                    }}
                    className="absolute -right-1.5 -top-1.5 z-10 hidden size-6 place-items-center rounded-full bg-foreground/75 text-background group-hover:grid"
                  >
                    <X size={12} weight="bold" />
                  </button>
                </div>
                )
              })}

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
              The first image is the main one — click any tile to promote it, drag to reorder, and tag each with its colour.
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
              {/* SAY WHICH WAY THE FALLBACK RUNS. Three ways to fill a side and one to empty
                  it is not something a tile can express on its own, and the rule — the type's
                  photo stands in whenever this product has nothing — is the reason clearing a
                  side is safe rather than destructive. */}
              <p className="text-xs text-muted-foreground">
                Drop a photo on a side, or use ↑ to upload one; click a tile to pick from this
                product&apos;s images. Anything you don&apos;t set falls back to the {type} photo from
                Settings › Platform, and clearing a side returns it to that.
              </p>
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
                    /* DROPPABLE. The tile takes a file directly now — the Images grid above
                       accepts a drop and this did not, so the two picture wells in one dialog
                       behaved differently for the same gesture. */
                    <div
                      key={sd}
                      className="group/side relative flex w-28 flex-col gap-1.5"
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onDrop={(e) => {
                        // stopPropagation, or the panel's own handler ALSO catches this and
                        // files the photo in the gallery unassigned — one drop, two homes.
                        e.preventDefault(); e.stopPropagation()
                        setSideFromFiles(sd, Array.from(e.dataTransfer.files))
                      }}
                    >
                      <label className="relative block cursor-pointer">
                        {shown ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={shown} alt="" className={"size-28 rounded-lg border-2 object-contain transition-colors " + (override ? "border-primary" : "border-border opacity-70 hover:opacity-100")} />
                        ) : (
                          <span className="grid size-28 place-items-center rounded-lg border-2 border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-primary/50"><ImageIcon size={20} /></span>
                        )}
                        {/* Says "this one is ours", so the absence of a tag means it's
                            following the type — the common case stays silent. */}
                        {override ? (
                          <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-primary/90 py-0.5 text-center text-xs font-medium text-primary-foreground">Custom</span>
                        ) : shown ? (
                          /* Says WHERE the picture came from. Without it an inherited
                             outline looks identical to one set on this product, which is
                             why the missing X read as a bug rather than as "there is
                             nothing of yours here to remove". */
                          <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-background/85 py-0.5 text-center text-xs text-muted-foreground">From {type}</span>
                        ) : null}
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
                      {/* UPLOAD, as a sibling of the tile's label rather than inside it —
                          a label nested in a label is invalid, and the outer one already owns
                          every click on the picture for the gallery picker. Its own hidden
                          input, so no ref plumbing and no second click target on the tile.
                          Left corner, because the right one is the clear button and a pair of
                          controls that both live top-right is a mis-click waiting to happen. */}
                      <label
                        title="Upload a photo for this side"
                        className="absolute -left-1.5 -top-1.5 z-10 grid size-6 cursor-pointer place-items-center rounded-full bg-foreground/75 text-background opacity-0 transition-opacity group-hover/side:opacity-100 focus-within:opacity-100"
                      >
                        <UploadSimple size={12} weight="bold" />
                        <input
                          type="file" accept="image/*" className="hidden"
                          aria-label={`Upload a photo for the ${sd} side`}
                          onChange={(e) => { setSideFromFiles(sd, Array.from(e.target.files ?? [])); e.target.value = "" }}
                        />
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
              {/* Same rule in bulk: the colours go and so do their photos. Untagged
                  pictures are nobody's, so they stay. */}
              {colors.length > 0 && (
                <button
                  onClick={() => dropColors(colors)}
                  title="Remove every colour and the photos tagged to them"
                  className="text-xs font-medium text-primary hover:underline"
                >Clear</button>
              )}
            </div>
            {/* Photo↔colour tagging now lives on the tiles in the Photo section above; this
                section just manages WHICH colours exist. */}
            {colors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {colors.map((c) => (
                  <span key={c} title={c} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
                    {prettyColorName(c)}
                    {/* Takes this colour's photos with it — its main shot and every angle
                        tagged with it. See dropColors. */}
                    <button
                      onClick={() => dropColors([c])}
                      title={`Remove ${prettyColorName(c)}${colorPhotoCount(c) ? ` and its ${colorPhotoCount(c)} photo${colorPhotoCount(c) === 1 ? "" : "s"}` : ""}`}
                      className="flex size-4 items-center justify-center rounded-full hover:bg-primary/20"
                    ><X size={9} weight="bold" /></button>
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

          {/* Status moved to the top row beside Type. */}

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

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CircleNotch, Storefront, UploadSimple, Trash, Package, MagnifyingGlassPlus, CaretLeft, CaretRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ProductCombobox } from "@/components/app/product-combobox"
import { SectionCard } from "@/components/app/section-card"
import { readImageFile } from "@/components/app/design-canvas"
import { prettyColorName } from "@/lib/color-name"
import { sizesOf, colorsOf, methodsOf } from "@/lib/variant-resolve"
import { getSpecQuote, publishEtsy, publishTiktok, publishShopify, getTiktokCategories, getTiktokWarehouses, getPublishDestinations, getCatalogProducts, saveCatalogProducts, type CatalogProduct, type SpecQuote, type TiktokCategory, type TiktokWarehouse, type EtsyWhoMade, type PublishedRecord, type PublishDestination, recordSpydeckUpload } from "@/lib/api"
import { readPublishDraft, clearPublishDraft, type PublishDraft, type PublishPrefill } from "@/lib/publish-draft"

const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const MAX_TAGS = 13
const MAX_IMAGES = 10 // Etsy's hard limit — an 11th slot silently never publishes.

const cleanTag = (raw: string) => raw.replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 20)

/**
 * One tile of the watermark, repeated as a background image.
 *
 * A background tile rather than a stack of rotated <span>s: the stack has to be sized to
 * the element it covers, and a band tall enough for a 115px thumbnail leaves bare corners
 * on the lightbox (and vice versa). A repeating tile has the same absolute spacing at every
 * size, so one `backgroundSize` sets the density.
 *
 * Plain white, no shadow behind it. The shadowed version read as a hard label stamped over
 * the photo rather than a watermark. The cost is on white and cream backgrounds, where a
 * faint white mark is genuinely hard to see — the count line above the grid ("N reference
 * photos shown, none published") and the lightbox caption are what carry that fact now, so
 * the mark itself doesn't have to shout it.
 */
const WATERMARK_TILE = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="156" height="100">` +
    // Both lines CENTRED on the tile. Anchored anywhere else, the rotation swings the ends
    // of the longer line past the tile edge and the background repeat clips them — which is
    // how "NOT PUBLISHED" came out as "· ISHED" across the whole lightbox.
    `<g transform="rotate(-24 78 50)" font-family="Helvetica,Arial,sans-serif" font-weight="600" text-anchor="middle">` +
      `<text x="78" y="45" font-size="10" letter-spacing="2.2" fill="rgba(255,255,255,.34)">REFERENCE</text>` +
      `<text x="78" y="62" font-size="7.5" letter-spacing="1.6" fill="rgba(255,255,255,.34)">NOT PUBLISHED</text>` +
    `</g>` +
  `</svg>`
)

/**
 * The thumbnail version: ONE mark stretched to fit, not a repeat.
 *
 * A 115px tile is smaller than one tile of the pattern above, so repeating it there only
 * ever produced a single word and a clipped fragment of the next — which reads as a
 * rendering fault rather than a watermark. Fitted to the square instead, both words land
 * whole and the mark still crosses the middle of the shot.
 */
const WATERMARK_FIT = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">` +
    `<g transform="rotate(-24 50 50)" font-family="Helvetica,Arial,sans-serif" font-weight="600" text-anchor="middle">` +
      `<text x="50" y="47" font-size="11" letter-spacing="1.6" fill="rgba(255,255,255,.34)">REFERENCE</text>` +
      `<text x="50" y="62" font-size="7.5" letter-spacing="1.2" fill="rgba(255,255,255,.34)">NOT PUBLISHED</text>` +
    `</g>` +
  `</svg>`
)

/**
 * The "this one isn't yours" mark, laid diagonally ACROSS the photo.
 *
 * It replaced two solid bars pinned to the top and bottom edges. Those were legible but
 * they covered the part of the shot you actually came to look at, and on a 115px tile that
 * was most of it. A tiled diagonal is the standard stock-photo idiom for the same reason:
 * it can't be cropped out, it reads at any size, and it leaves the subject visible.
 *
 * Module scope: a component declared during render remounts every keystroke
 * (react-hooks/static-components).
 */
function ReferenceWatermark({ big = false }: { big?: boolean }) {
  return (
    <div
      aria-hidden
      className={"pointer-events-none absolute inset-0 " + (big ? "bg-repeat" : "bg-center bg-no-repeat")}
      style={{
        backgroundImage: `url("data:image/svg+xml,${big ? WATERMARK_TILE : WATERMARK_FIT}")`,
        backgroundSize: big ? "230px 148px" : "100% 100%",
      }}
    />
  )
}

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
        <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label} ({picked.length}/{options.length})
        </span>
        <button
          type="button"
          onClick={() => onChange(allOn ? [] : options)}
          className="text-2xs font-medium text-primary transition-colors hover:underline"
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
                "rounded border px-1.5 py-0.5 text-2xs transition-colors " +
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
/**
 * ONE SENTENCE FOR THE SAME EVENT, whichever channel it went to.
 *
 * The three publishers had grown three phrasings — "Published as a draft with 6 variants",
 * "Created a draft product on TikTok (#123)", "Created a draft product on Shopify with 2
 * variants" — which made the same outcome read as three different things, and spent the
 * headline on a number nobody needs at the moment it succeeds. The variant count is
 * visible on the card afterwards; what you want here is to know it worked.
 *
 * Anything that QUALIFIES the success (variants rejected, only some photos uploaded, a
 * dry run that sent nothing) still shows — demoted to the note line beneath, where a
 * caveat belongs, rather than deleted.
 */
const PUBLISH_OK = "Listing uploaded successfully!"

/**
 * The TikTok-only fields, held PER SHOP.
 *
 * A category tree is read against a shop's cipher and a warehouse id belongs to one shop,
 * so two connected TikTok shops cannot share these. Keyed by connection_id for that reason
 * — a single shared set would put shop A's warehouse on shop B's product, which TikTok
 * either rejects or, worse, accepts against the wrong stock location.
 */
type TtFields = {
  categories: TiktokCategory[]
  category: TiktokCategory | null
  query: string
  warehouses: TiktokWarehouse[]
  warehouse: string
  weight: string
  unit: string
  loadErr: string
  loaded: boolean
}
const TT_EMPTY: TtFields = {
  categories: [], category: null, query: "", warehouses: [], warehouse: "",
  weight: "", unit: "POUND", loadErr: "", loaded: false,
}

/**
 * What happened at ONE shop. Partial success is the normal outcome of publishing to
 * several, not an error state: three shops can easily be two drafts, one rejection, and
 * the rejection is fixable without touching the two that worked.
 *
 * `dry` is its own state rather than a flavour of ok. A green tick beside a shop where
 * nothing was created is the dishonest empty state the house rules forbid.
 */
type Outcome = { state: "running" | "ok" | "dry" | "fail"; text: string; note?: string; url?: string }

/**
 * The three fields TikTok needs, for ONE shop.
 *
 * Module-level, not defined inside the dialog's render: a component declared in render is
 * a new type every frame, so React remounts it and every keystroke in the search box would
 * lose focus (the repo's react-hooks/static-components rule).
 */
function TiktokFields({ dest, fields, onChange }: {
  dest: PublishDestination
  fields: TtFields
  onChange: (patch: Partial<TtFields>) => void
}) {
  // Leaf categories that match what the seller typed. Capped so a 5,000-node tree can't
  // render at once; the search box is how you reach the rest.
  const matches = useMemo(() => {
    const qy = fields.query.trim().toLowerCase()
    return fields.categories.filter((c) => !qy || (c.local_name ?? "").toLowerCase().includes(qy)).slice(0, 40)
  }, [fields.categories, fields.query])

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
        {dest.shop_name} needs
      </div>
      {fields.loadErr && <p className="text-xs text-destructive">{fields.loadErr}</p>}

      {/* Leaf category — required. Search then pick from the tree. */}
      <div className="space-y-1">
        <div className="text-xs font-medium">Category {fields.category && <span className="text-muted-foreground">· {fields.category.local_name}</span>}</div>
        <Input
          value={fields.query}
          onChange={(e) => onChange({ query: e.target.value })}
          /* An empty list after a FAILED load is not a loading list. Showing the error above
             while the field still said "Loading categories…" left the two halves of the
             screen contradicting each other, and the spinner-ish wording is the one people
             believe — so it read as slow rather than broken. */
          placeholder={fields.categories.length ? "Search categories…" : fields.loadErr ? "Couldn't load categories" : "Loading categories…"}
          disabled={!fields.categories.length && !!fields.loadErr}
          className="h-8 text-xs"
        />
        {fields.query.trim() && (
          <div className="max-h-36 overflow-y-auto rounded-md border border-border">
            {matches.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No leaf category matches.</div>
            ) : matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange({ category: c, query: "" })}
                className={"flex w-full items-center justify-between px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted " + (fields.category?.id === c.id ? "bg-primary/10 text-primary" : "")}
              >
                <span className="truncate">{c.local_name || c.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Warehouse — per-SKU inventory is booked against it, and it belongs to THIS shop. */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">Warehouse</span>
        <select value={fields.warehouse} onChange={(e) => onChange({ warehouse: e.target.value })} className="eg-select h-8 rounded-md border border-border bg-card px-2 text-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
          {!fields.warehouses.length && <option value="">No warehouse found</option>}
          {fields.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
        </select>
      </label>

      {/* Package weight — required for physical products. */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">Package weight</span>
        <div className="flex gap-1.5">
          <Input value={fields.weight} onChange={(e) => onChange({ weight: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.5" inputMode="decimal" className="h-8 flex-1 text-xs" />
          <select value={fields.unit} onChange={(e) => onChange({ unit: e.target.value })} className="eg-select h-8 rounded-md border border-border bg-card px-2 text-xs">
            <option value="POUND">lb</option>
            <option value="KILOGRAM">kg</option>
          </select>
        </div>
      </label>
    </div>
  )
}

/** One shop's status after a run — the row that makes partial success readable. */
function OutcomeLine({ dest, outcome }: { dest: PublishDestination; outcome?: Outcome }) {
  if (!outcome) return null
  const tone =
    outcome.state === "ok" ? "text-success"
    : outcome.state === "fail" ? "text-destructive"
    : outcome.state === "dry" ? "text-amber-700"
    : "text-muted-foreground"
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0">
        {outcome.state === "running" ? <CircleNotch size={12} className="animate-spin" />
          : outcome.state === "ok" ? "✅"
          : outcome.state === "dry" ? "⚠️" : "❌"}
      </span>
      <span className="min-w-0">
        <span className="font-medium">{dest.shop_name}</span>
        <span className="text-muted-foreground"> · {dest.platform_label} — </span>
        <span className={tone}>{outcome.text}</span>
        {outcome.note && <span className="text-muted-foreground"> {outcome.note}</span>}
        {outcome.url && (
          <>
            {" "}
            <a href={outcome.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View →</a>
          </>
        )}
      </span>
    </div>
  )
}

export type { PublishPrefill }

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
export function PublishProductPage({ draftId }: { draftId: string | null }) {
  const router = useRouter()
  /**
   * The draft, read once from sessionStorage — in an EFFECT, so the three states stay
   * distinct:
   *
   *   undefined  still reading (one frame, and during server render)
   *   null       there is no such draft — the tab was closed, or this URL was shared
   *   a draft    the listing to publish
   *
   * The middle case is real and has to be said. sessionStorage dies with the tab, so a
   * bookmarked /publish?d=… opens to nothing, and an empty form with no explanation is
   * exactly the "broken feature or empty state?" ambiguity the house rules forbid.
   */
  const [draft, setDraft] = useState<PublishDraft | null | undefined>(undefined)
  useEffect(() => {
    const t = setTimeout(() => setDraft(readPublishDraft(draftId)), 0)
    return () => clearTimeout(t)
  }, [draftId])
  const prefill = draft?.prefill ?? null
  const source = draft?.source ?? null
  const returnTo = draft?.returnTo ?? "/spydeck"
  const returnLabel = draft?.returnLabel ?? "Back"
  const pageTitle = draft?.title ?? "Publish product"

  /** Back — to the stored path, never history. See lib/publish-draft.ts. */
  const leave = () => router.push(returnTo)

  /**
   * Tell SpyDeck what we published, from here.
   *
   * In the dialog this was an `onPublished` prop: SpyDeck held the competitor listing in
   * state and recorded the upload against it. A page has no parent to call, so the source
   * listing travels in the draft and the record is written here instead — the same
   * server-side call SpyDeck made, so the Uploaded card is there when you go back.
   */
  const onPublished = (url?: string, primaryImage?: string, published?: PublishedRecord) => {
    if (!source) return
    const merged = primaryImage ? { ...source, image: primaryImage, thumb: primaryImage } : source
    recordSpydeckUpload(merged, { url, listing_id: published?.listing_id, published }).catch(() => {})
  }

  // The page resolves a picked blank itself rather than asking each caller for a
  // lookup — the combobox hands back a flattened shape, and pricing needs the full row.
  const catalogRef = useRef<CatalogProduct[]>([])
  const [blank, setBlank] = useState<CatalogProduct | null>(null)
  const [blankText, setBlankText] = useState("")
  const [title, setTitle] = useState("")
  const [desc, setDesc] = useState("")
  const [retail, setRetail] = useState("")
  const [qty, setQty] = useState("999")
  const [tags, setTags] = useState<string[]>([])
  /**
   * Sent on every publish, fixed. Not a picker: the listing is created as a DRAFT, so the
   * seller answers this on Etsy's own form before anything goes live, and asking twice was
   * the wrong amount of care.
   *
   * SET BACK TO 'i_did' ON THE OWNER'S INSTRUCTION (2026-08-09), after 'someone_else'
   * coincided with Etsy rejecting new drafts. Recording the trade-off rather than the
   * decision: for print-on-demand WE make the item, so 'i_did' is not true of us, and
   * misstating who made an item is a Handmade Policy matter — the class of thing Etsy
   * suspends a shop for rather than warning about. What makes it defensible is the draft:
   * nothing reaches a buyer until the seller reviews and activates it, and they can change
   * this on that form. If Etsy ever accepts 'someone_else' from a shop with a production
   * partner registered, that is the value to send.
   */
  const whoMade: EtsyWhoMade = "i_did"
  const [tagDraft, setTagDraft] = useState("")
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
  /**
   * WHERE THIS CAN GO — the seller's connected shops, from the server.
   *
   * Not a hardcoded Etsy/TikTok/Shopify toggle: that stated which integrations exist, and
   * the question on this screen is which shops THIS seller has. One shop and there is no
   * choice to present; two Etsy shops and a platform toggle cannot express the choice at
   * all.
   */
  const [dests, setDests] = useState<PublishDestination[] | null>(null)
  const [destErr, setDestErr] = useState("")
  /** Ticked shops, by connection_id. Everything ticked gets the same listing. */
  const [picked, setPicked] = useState<string[]>([])
  /** Per-shop TikTok fields, keyed by connection_id — see TtFields. */
  const [tt, setTt] = useState<Record<string, TtFields>>({})
  /** What happened at each shop, keyed by connection_id. Survives a retry so a shop that
   *  already published keeps its link and cannot be sent twice. */
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const seeded = useRef(false)
  // A SpyDeck listing's competitor photos aren't in the grid payload — they arrive from an
  // async listing-detail fetch AFTER this dialog opens, so the once-seed above ran with none
  // (or just the cover). This tracks whether the user has hand-edited the photos; until they
  // have, we keep syncing them from the prefill as the detail fills in, so the competitor
  // images actually attach instead of silently never showing up.
  const imgTouched = useRef(false)

  // Seed once, on mount. In the dialog this ran per open; a page IS the open — it mounts
  // with its draft and is thrown away when you leave.
  useEffect(() => {
    // WAIT for the draft. Seeding from a not-yet-read prefill would fill the form with
    // blanks and set seeded, so the real values would never land.
    if (draft === undefined || seeded.current) return
    seeded.current = true
    const id = setTimeout(() => {
      setTitle(prefill?.title ?? "")
      setDesc(prefill?.description ?? "")
      setRetail(prefill?.price != null ? String(prefill.price) : "")
      setTags((prefill?.tags ?? []).slice(0, MAX_TAGS))
      setImages((prefill?.images ?? []).filter(Boolean).slice(0, MAX_IMAGES))
      setBlank(prefill?.blank ?? null)
      setBlankText(prefill?.blank?.name ?? "")
      // Restore the variant selection. Guarded on the blank for the same reason the publish
      // call is: without one, `colors`/`sizes` are sent empty regardless, so showing ticks
      // here would promise variants that then don't ship.
      setPickedColors(prefill?.blank ? (prefill?.colors ?? []) : [])
      setPickedSizes(prefill?.blank ? (prefill?.sizes ?? []) : [])
      setResult(null)
      getCatalogProducts().then((rows) => { catalogRef.current = rows ?? [] }).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [draft, prefill])

  // Re-sync photos from the prefill as the async listing-detail fetch fills them in — until
  // the user edits them. Without this, competitor photos loaded after open never attach.
  useEffect(() => {
    if (imgTouched.current) return
    const imgs = (prefill?.images ?? []).filter(Boolean).slice(0, MAX_IMAGES)
    if (!imgs.length) return
    const id = setTimeout(() => { if (!imgTouched.current) setImages(imgs) }, 0)
    return () => clearTimeout(id)
  }, [prefill])

  /**
   * The shops, once on mount.
   *
   * A SINGLE destination is auto-ticked: there is no choice to make, and presenting one
   * checkbox to tick before you may press Publish is ceremony for its own sake. Two or
   * more start UNTICKED — publishing to a shop nobody chose is the one mistake this screen
   * must not make, and the button says what's missing rather than guessing.
   */
  useEffect(() => {
    const id = setTimeout(() => {
      setDestErr("")
      getPublishDestinations()
        .then((r) => {
          const list = r.destinations ?? []
          setDests(list)
          setPicked(list.length === 1 ? [list[0].connection_id] : [])
        })
        .catch((e) => { setDests([]); setDestErr(e instanceof Error ? e.message : "Couldn't load your connected shops.") })
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // NO RESET-ON-CLOSE effect. A page unmounts when you leave it, so the state goes with
  // it — the dialog needed that only because it stayed mounted between opens.

  /**
   * TikTok's category tree and warehouse list, PER TICKED SHOP.
   *
   * Fetched when a TikTok shop is first ticked rather than on open — the tree is large and
   * a seller who never ticks TikTok should never pay for it. Each request carries its
   * connection_id, because both answers are specific to that shop.
   */
  const ttPending = useMemo(
    () => (dests ?? []).filter((d) => d.platform === "tiktok" && picked.includes(d.connection_id) && !tt[d.connection_id]?.loaded),
    [dests, picked, tt]
  )
  useEffect(() => {
    if (!ttPending.length) return
    const id = setTimeout(() => {
      for (const d of ttPending) {
        const cid = d.connection_id
        // Marked loaded up front so a re-render mid-flight doesn't fire a second fetch.
        setTt((m) => ({ ...m, [cid]: { ...(m[cid] ?? TT_EMPTY), loaded: true } }))
        getTiktokCategories(undefined, cid)
          .then((r) => setTt((m) => ({
            ...m,
            [cid]: r.error
              ? { ...(m[cid] ?? TT_EMPTY), loadErr: r.error }
              : { ...(m[cid] ?? TT_EMPTY), loadErr: "", categories: (r.categories ?? []).filter((c) => c.is_leaf !== false) },
          })))
          .catch((e) => setTt((m) => ({ ...m, [cid]: { ...(m[cid] ?? TT_EMPTY), loadErr: e instanceof Error ? e.message : "Couldn't load TikTok categories" } })))
        getTiktokWarehouses(cid)
          .then((r) => setTt((m) => {
            const ws = r.warehouses ?? []
            const cur = m[cid] ?? TT_EMPTY
            return { ...m, [cid]: { ...cur, warehouses: ws, warehouse: cur.warehouse || (ws[0] ? String(ws[0].id) : "") } }
          }))
          .catch(() => {})
      }
    }, 0)
    return () => clearTimeout(id)
  }, [ttPending])

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

  /**
   * The competitor's own photos, for LOOKING AT. They never enter `images`.
   *
   * This used to be an amber warning with an "attach anyway" button. A checkbox only moves
   * the blame — it doesn't stop the DMCA notice, and the shop that gets suspended is the
   * SELLER's, not ours. CLAUDE.md's first rule is that nothing may put a connected account
   * at risk, and a one-click path from someone else's photo to a live listing did exactly
   * that. So there is no path any more, only a reference strip.
   *
   * They stay VISIBLE because the seller has to see what they're making. What must not
   * happen is showing them among the publishable photos and dropping them at upload — a set
   * you can see but that silently doesn't ship is the most misleading of the three options.
   */
  const referencePhotos = useMemo(() => (prefill?.referenceImages ?? []).filter(Boolean), [prefill])

  // Which reference photo the lightbox is showing, or null for closed. A thumbnail this
  // small is not enough to judge a competitor's shot by, which is the entire reason these
  // are on screen — so the tile opens one full size. The watermark comes with it.
  const [zoom, setZoom] = useState<number | null>(null)
  const zoomSrc = zoom === null ? null : referencePhotos[zoom]
  useEffect(() => {
    if (zoom === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      e.preventDefault()
      const step = e.key === "ArrowRight" ? 1 : -1
      setZoom((i) => (i === null ? i : (i + step + referencePhotos.length) % referencePhotos.length))
    }
    // CAPTURE. A bubble-phase listener here never fires — something between the popup and
    // the window stops arrow keys on the way up (verified: a capture listener sees the same
    // keypress a bubble one misses), so the gallery simply didn't respond to the keyboard.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [zoom, referencePhotos.length])

  /**
   * ONE SHOP, one outcome. These three never throw and never set the shared banner: a
   * refusal at one shop is that row's business, and the shops after it still go.
   *
   * Publish to TikTok Shop. Shares the common fields with the Etsy path but adds the three
   * TikTok-only requirements. The server is DRY-RUN until its TIKTOK_PUBLISH_LIVE flag is
   * set, so a dry run comes back with the assembled payload rather than a live product.
   */
  const publishToTiktokShop = async (d: PublishDestination): Promise<Outcome> => {
    const f = tt[d.connection_id] ?? TT_EMPTY
    // Guarded here as well as in publish(): TikTok's create call has no meaning without a
    // leaf category, so this function must not be able to send one without it.
    if (!f.category) return { state: "fail", text: "Needs a category" }
    try {
      const r = await publishTiktok({
        connection_id: d.connection_id,
        title: title.trim(), description: desc.trim() || title.trim(),
        price: basePrice, quantity: Number(qty) || 999,
        images, tags,
        colors: blank ? pickedColors : [], sizes: blank ? pickedSizes : [],
        sku_base: blank?.sku ?? undefined,
        size_prices: Object.fromEntries(sizeRows.filter((r) => r.price > 0).map((r) => [r.size, r.price])),
        category_id: f.category.id, warehouse_id: f.warehouse,
        package_weight: f.weight, weight_unit: f.unit,
        blank: blank?.sku ?? undefined, printType: method || undefined,
        designId: prefill?.designId, designUrl: prefill?.designUrl, designPos: prefill?.designPos,
      })
      if (r.error) throw new Error(r.error)
      if (r.dryRun) {
        // Honest about the mode: nothing was sent, so this is not a success.
        return {
          state: "dry",
          text: "Dry run — nothing was sent",
          note: r.missing?.length
            ? `Still needed before it can list: ${r.missing.join(", ")}.`
            : "Live TikTok publishing is switched off on the server.",
        }
      }
      onPublished?.(undefined, images[0], {
        platform: "tiktok",
        title: title.trim(), price: basePrice, image: images[0],
        state: "draft",
        blank_sku: blank?.sku ?? undefined, blank_name: blank?.name ?? undefined,
        print_type: method || undefined,
        colors: blank ? pickedColors : [], sizes: blank ? pickedSizes : [],
        images_uploaded: images.length,
      })
      return {
        state: "ok",
        text: "Draft product created",
        note: r.warnings?.length ? r.warnings.map((w) => w.message).filter(Boolean).join(" ") : undefined,
      }
    } catch (e) {
      return { state: "fail", text: e instanceof Error ? e.message : "Publish failed." }
    }
  }

  /**
   * SHOPIFY. Created as a draft, like Etsy's — nothing reaches a buyer until the seller
   * activates it in their own admin.
   *
   * The route needs the `write_products` scope, which was added AFTER most shops connected.
   * OAuth scopes are fixed at grant time, so a shop connected before that cannot publish
   * however correct the payload is; the server returns that specific reason and it is shown
   * verbatim rather than folded into "publish failed", because the fix (reconnect the shop)
   * is not one anybody would guess.
   */
  const publishToShopifyStore = async (d: PublishDestination): Promise<Outcome> => {
    try {
      const r = await publishShopify({
        connection_id: d.connection_id,
        title: title.trim(), description: desc.trim() || title.trim(),
        price: basePrice, tags, images,
        colors: blank ? pickedColors : [], sizes: blank ? pickedSizes : [],
        blank_sku: blank?.sku ?? undefined, print_type: method || undefined,
        design_id: prefill?.designId, design_data: prefill?.designUrl, design_pos: prefill?.designPos,
      })
      if (r.error) throw new Error(r.error)
      onPublished?.(r.url, r.primary_image || images[0], {
        platform: "shopify",
        title: title.trim(), price: basePrice, image: r.primary_image || images[0],
        state: r.state || "draft",
        blank_sku: blank?.sku ?? undefined, blank_name: blank?.name ?? undefined,
        print_type: method || undefined,
        colors: blank ? pickedColors : [], sizes: blank ? pickedSizes : [],
        images_uploaded: r.images_uploaded ?? 0,
        listing_id: r.listing_id,
        variants_applied: r.variants_applied,
        variant_skus: r.variant_skus,
      })
      return {
        state: "ok",
        text: "Draft product created",
        url: r.url,
        // Say when photos didn't all land. The product exists either way — the server
        // deliberately doesn't fail a publish over an image — so silence here would leave a
        // draft with missing photos and no hint why.
        note: r.images_uploaded != null && r.images_uploaded < images.length
          ? `${r.images_uploaded} of ${images.length} photos uploaded — add the rest in Shopify.`
          : undefined,
      }
    } catch (e) {
      return { state: "fail", text: e instanceof Error ? e.message : "Publish failed." }
    }
  }

  const publishToEtsyShop = async (d: PublishDestination): Promise<Outcome> => {
    try {
      const r = await publishEtsy({
        connection_id: d.connection_id,
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
        // The seller's own declaration — always sent explicitly. Never let the server's
        // backward-compat fallback decide this on their behalf.
        who_made: whoMade,
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

      // Etsy's hosted url for the cover, falling back to what we sent. The fallback is only
      // reached when the photo upload failed, in which case there IS no published image and
      // showing the source we tried is the honest thing.
      const cover = r.primary_image || images[0]
      onPublished?.(r.url, cover, {
        platform: "etsy",
        listing_id: r.listing_id != null ? String(r.listing_id) : undefined,
        title: title.trim(), price: basePrice, image: cover,
        state: r.state || "draft",
        blank_sku: blank?.sku ?? undefined, blank_name: blank?.name ?? undefined,
        print_type: method || undefined,
        colors: blank ? pickedColors : [], sizes: blank ? pickedSizes : [],
        variant_skus: r.variant_skus ?? [],
        variants_applied: r.variants_applied ?? 0,
        variants_error: r.variants_error ?? null,
        images_uploaded: r.images_uploaded ?? 0,
      })
      return {
        state: "ok",
        text: "Draft listing created",
        url: r.url,
        // The one thing worth interrupting for: the listing exists but has no variants, so
        // it is a flat listing and somebody has to decide whether that will do.
        note: r.variants_error ? `Variants were rejected (${r.variants_error}), so it listed flat.` : undefined,
      }
    } catch (e) {
      return { state: "fail", text: e instanceof Error ? e.message : "Publish failed." }
    }
  }

  /** What this shop still needs before it can be sent. Empty for Etsy and Shopify. */
  const missingFor = (d: PublishDestination): string[] => {
    if (d.platform !== "tiktok") return []
    const f = tt[d.connection_id] ?? TT_EMPTY
    return [
      !f.category && "a category",
      !f.warehouse && "a warehouse",
      !(Number(f.weight) > 0) && "a package weight",
    ].filter(Boolean) as string[]
  }

  const pickedDests = useMemo(
    () => (dests ?? []).filter((d) => picked.includes(d.connection_id)),
    [dests, picked]
  )
  /** Already sent, so it must not be sent again — a retry re-sends failures only. */
  const isDone = (id: string) => outcomes[id]?.state === "ok" || outcomes[id]?.state === "dry"
  const allDone = pickedDests.length > 0 && pickedDests.every((d) => isDone(d.connection_id))
  const anyFailed = pickedDests.some((d) => outcomes[d.connection_id]?.state === "fail")

  /**
   * Publish to every ticked shop, one after another.
   *
   * SHARED fields are validated once, up front — a missing title is missing everywhere, so
   * stopping the whole run is right. A shop's OWN missing field stops only that shop: it
   * becomes that row's outcome and the rest still go, which is the difference between a
   * publish-all that's useful and one that's hostage to its most demanding channel.
   *
   * Sequential rather than parallel: each publish uploads photos, and three shops uploading
   * the same nine images at once is how a rate limit turns one slow publish into three
   * failed ones.
   */
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
    // A listing needs a photo, and since the competitor's are reference-only there may now
    // be none. Say so HERE — the alternative is Etsy rejecting it with a message about
    // image requirements that reads like our bug rather than a missing step.
    if (!images.length) {
      setResult({
        ok: false,
        text: referencePhotos.length
          ? "Add at least one photo of your own. The reference shots below belong to the seller who took them and aren't published."
          : "Add at least one photo.",
      })
      return
    }
    if (!pickedDests.length) {
      setResult({ ok: false, text: "Pick at least one shop to publish to." })
      return
    }

    setBusy(true); setResult(null)
    // Anything already published is skipped, so pressing Publish twice cannot create a
    // second listing in a shop that already has one.
    for (const d of pickedDests.filter((x) => !isDone(x.connection_id))) {
      const cid = d.connection_id
      const missing = missingFor(d)
      if (missing.length) {
        setOutcomes((o) => ({ ...o, [cid]: { state: "fail", text: `Needs ${missing.join(", ")}` } }))
        continue
      }
      setOutcomes((o) => ({ ...o, [cid]: { state: "running", text: "Publishing…" } }))
      const out = d.platform === "etsy"
        ? await publishToEtsyShop(d)
        : d.platform === "tiktok"
          ? await publishToTiktokShop(d)
          : await publishToShopifyStore(d)
      setOutcomes((o) => ({ ...o, [cid]: out }))
    }
    setBusy(false)
  }

  // The draft has served its purpose the moment every ticked shop is finished; leaving it
  // would let Back-then-forward return to a form that would publish all over again.
  useEffect(() => {
    if (allDone && !busy) clearPublishDraft(draftId)
  }, [allDone, busy, draftId])

  return (
    <>
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 sm:p-6">
      {/* THE WAY BACK, first thing on the page and never scrolled away from.
          A page you reached by pressing a button on a board has to say where that board
          was — "Back" alone makes the reader remember, and the one time they can't they
          are stuck on a form they didn't mean to be a destination. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={leave}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
        >
          <CaretLeft size={13} weight="bold" /> {returnLabel}
        </button>
        <h1 className="text-xl font-semibold">{pageTitle}</h1>
      </div>

      {/* NO DRAFT. Say which of the two it is — still reading, or genuinely gone — because
          a blank form and a lost one look identical otherwise. sessionStorage dies with the
          tab, so this is what a shared or bookmarked /publish URL lands on. */}
      {draft === null && (
        <div className="mx-auto max-w-lg space-y-3 rounded-2xl border border-border bg-card p-6 text-center">
          <p className="font-medium">There&apos;s nothing to publish here.</p>
          <p className="text-sm text-muted-foreground">
            A publish page is opened from a product — and the draft it carried is gone, which
            happens when the tab was closed or this link came from somewhere else. Start again
            from the board you were on.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => router.push("/spydeck")}>SpyDeck</Button>
            <Button variant="outline" onClick={() => router.push("/design/maker")}>Design maker</Button>
          </div>
        </div>
      )}

      {/* THE DONE SCREEN, only when every ticked shop is actually finished. With one shop
          this is the same panel it always was; with four it lists what happened at each,
          because "published" over a run that included a dry run would be a claim about
          three shops and a lie about the fourth. Any failure keeps the form on screen so
          it can be fixed without retyping the listing. */}
        {draft == null ? null : allDone && !busy ? (
          <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-2xl border border-border bg-card py-10 text-center">
            <div className="font-semibold text-success">
              {pickedDests.every((d) => outcomes[d.connection_id]?.state === "ok")
                ? PUBLISH_OK
                : "Finished — with one shop that sent nothing"}
            </div>
            <div className="w-full max-w-md space-y-1 px-6 text-left">
              {pickedDests.map((d) => <OutcomeLine key={d.connection_id} dest={d} outcome={outcomes[d.connection_id]} />)}
            </div>
            <Button onClick={leave}>{returnLabel}</Button>
          </div>
        ) : (
          /* THREE COLUMNS: what it looks like · what it is · where it goes.
             The third is a STICKY rail, so the shops you picked and the button that sends
             it stay on screen while you write a description four screens down. In the
             dialog those sat at the bottom of a scroll box, which is how you end up
             editing a listing without being able to see where it's going. */
          <div className="grid items-start gap-5 xl:grid-cols-[1.05fr_1fr_23rem]">
            {/* COLUMN 1 — what the listing looks like.
                Every group is a SectionCard, the same block every other page in the app is
                built from. On a page the fields had nothing behind them: a dialog's own
                edges did the grouping, and without them the form read as one long drift of
                inputs with no structure and no column boundary. */}
            <div className="space-y-4">
              {/* The count and the reference-photo caveat ride in the card's own header —
                  repeating "Photos" inside a card called Photos is the kind of doubling a
                  dialog's title bar used to hide. */}
              <SectionCard
                title={<>Photos <span className="font-normal text-muted-foreground">({images.length}/{MAX_IMAGES})</span></>}
                description={referencePhotos.length > 0
                  ? `${referencePhotos.length} reference ${referencePhotos.length === 1 ? "photo" : "photos"} shown, none published`
                  : undefined}
                bodyClassName="space-y-3 p-4"
              >
              <div className="space-y-1.5">
                <div className="grid grid-cols-4 gap-2">
                  {images.map((src, i) => (
                    <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                      {i === 0 && <span className="absolute inset-x-0 bottom-0 bg-primary/90 py-0.5 text-center text-3xs font-semibold uppercase text-primary-foreground">Primary</span>}
                      <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                        {i !== 0 && <button onClick={() => makePrimary(i)} className="rounded bg-white/90 px-1.5 py-0.5 text-3xs font-semibold text-black">Primary</button>}
                        <button onClick={() => removeImage(i)} aria-label="Remove photo" className="rounded bg-white/90 p-1 text-black"><Trash size={11} weight="bold" /></button>
                      </div>
                    </div>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <button onClick={() => fileRef.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                      <UploadSimple size={16} weight="bold" /><span className="text-3xs font-medium">Add</span>
                    </button>
                  )}
                  {/* THE COMPETITOR'S PHOTOS, IN THE SAME GRID BUT MARKED ON THE IMAGE.
                      They are not in `images`, so nothing here can reach a marketplace — the
                      watermark is what makes that legible rather than something the seller has
                      to remember. Sitting them in a separate panel was the previous answer and
                      it read as a second, publishable set; a caption ON the photo cannot be
                      scrolled away from.
                      Dashed border, no hover controls, watermark: everything says "not yours". */}
                  {referencePhotos.map((src, i) => (
                    <button
                      key={`ref-${i}`}
                      type="button"
                      onClick={() => setZoom(i)}
                      title="View larger"
                      aria-label={`View reference photo ${i + 1} larger`}
                      className="group relative aspect-square cursor-zoom-in overflow-hidden rounded-lg border border-dashed border-border bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="size-full object-cover" />
                      <ReferenceWatermark />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                        <MagnifyingGlassPlus size={16} weight="bold" className="text-white drop-shadow" />
                      </span>
                    </button>
                  ))}
                </div>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = "" }} />
              </div>

              </SectionCard>

              <SectionCard title="Listing" bodyClassName="space-y-4 p-4">
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
                {/* NO TRENDING-KEYWORD CHIPS. A dozen shop-wide SpyDeck keywords sat under
                    the 13 real tags in near-identical pills, so a full listing showed 25
                    chips of which only the first 13 were on it — and they kept their row
                    even at 13/13, when nothing could be added. They were never about this
                    product either; the box above takes any keyword you want to type. */}
              </div>
              </SectionCard>
            </div>

            {/* COLUMN 2 — what it's made on, and whether it makes money */}
            <div className="space-y-4">
              <SectionCard title="Product & pricing" bodyClassName="space-y-4 p-4">
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
              </SectionCard>
            </div>

            {/* COLUMN 3 — WHERE IT GOES, and the button that sends it. Sticky, so the
                shops and the action stay put however far down the copy you are. */}
            {/* top-20, not top-4: the app header is sticky and 64px tall, so a rail pinned
                at 16px slides UNDER it and loses its first line — measured, not guessed. */}
            <aside className="xl:sticky xl:top-20">
              <SectionCard title="Publish to" bodyClassName="space-y-4 p-4">
              {/* WHERE THIS GOES — the seller's connected shops.
                  One shop: a sentence, no checkbox. There is no choice to make, and a
                  single tick-box you must tick before publishing is ceremony.
                  Several: a row each, ticked deliberately. Two shops on the SAME platform
                  are two rows that differ by name — the case the old platform toggle
                  couldn't express at all. */}
              <div className="space-y-1.5">
                {dests === null ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleNotch size={12} className="animate-spin" /> Finding your shops…
                  </div>
                ) : destErr ? (
                  <p className="text-xs text-destructive">{destErr}</p>
                ) : dests.length === 0 ? (
                  // Not an empty picker — an empty picker looks like a broken feature.
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    No shop is connected to your account yet, so there&apos;s nowhere to publish this.
                    Connect one under <a href="/stores" className="font-medium text-primary hover:underline">Stores</a>.
                  </div>
                ) : dests.length === 1 ? (
                  <div className="flex flex-wrap items-center gap-x-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                    <span className="font-medium">{dests[0].shop_name}</span>
                    <span className="text-xs text-muted-foreground">· {dests[0].platform_label}</span>
                    {dests[0].dry_run && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-medium text-amber-800">dry run — nothing is sent</span>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {dests.map((d) => {
                      const on = picked.includes(d.connection_id)
                      return (
                        <label
                          key={d.connection_id}
                          className={"flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors " +
                            (on ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/30")}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={isDone(d.connection_id)}
                            onChange={(e) => {
                              setResult(null)
                              setPicked((p) => e.target.checked ? [...p, d.connection_id] : p.filter((x) => x !== d.connection_id))
                            }}
                            className="size-3.5 accent-[var(--primary)]"
                          />
                          <span className="font-medium">{d.shop_name}</span>
                          <span className="text-xs text-muted-foreground">{d.platform_label}</span>
                          {d.dry_run && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-medium text-amber-800">dry run</span>
                          )}
                          {isDone(d.connection_id) && (
                            <span className="ml-auto text-2xs font-medium text-success">published</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ONE BLOCK PER TICKED TIKTOK SHOP. A category tree is read against a shop's
                  cipher and a warehouse belongs to one shop, so two TikTok shops get two
                  sets of fields rather than one shared set that would be wrong for one of
                  them. Etsy and Shopify rows expand to nothing — ticking them adds no work. */}
              {pickedDests.filter((d) => d.platform === "tiktok").map((d) => (
                <TiktokFields
                  key={d.connection_id}
                  dest={d}
                  fields={tt[d.connection_id] ?? TT_EMPTY}
                  onChange={(patch) => setTt((m) => ({ ...m, [d.connection_id]: { ...(m[d.connection_id] ?? TT_EMPTY), ...patch } }))}
                />
              ))}

              {/* No "size priced" picker any more — the table below prices every size, so
                  choosing one to represent the rest was the thing hiding the others. */}
              {blank && (
                <label className="flex flex-col gap-1">
                  <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Method</span>
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

              {result && !result.ok && <p className="text-sm text-destructive">{result.text}</p>}

              {/* PER-SHOP RESULTS, live as the run walks the list. Shown here and not in a
                  banner because partial success has no single sentence: two drafts and one
                  refusal is three facts, and folding them into one would have to pick which
                  to tell you. */}
              {pickedDests.some((d) => outcomes[d.connection_id]) && (
                <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3">
                  {pickedDests.map((d) => <OutcomeLine key={d.connection_id} dest={d} outcome={outcomes[d.connection_id]} />)}
                </div>
              )}

              {/* IP warning — only for the competitor's OWN photos, and only until the
                  seller acknowledges it. Publishing someone else's images to your shop can
                  get a listing pulled and, repeated, put the shop at risk. */}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={leave}>Cancel</Button>
                {/* The label says what will actually happen. "Publish draft" over four ticked
                    shops understates it, and after a partial failure the button's job has
                    changed to retrying only what failed — which the label has to admit, or
                    it reads as "publish everything again" and nobody presses it. */}
                <Button onClick={publish} disabled={busy || !dests?.length}>
                  {busy ? <CircleNotch size={15} className="animate-spin" /> : (
                    <><Storefront size={14} weight="bold" />
                      {anyFailed
                        ? "Retry the ones that failed"
                        : pickedDests.length > 1 ? `Publish draft to ${pickedDests.length} shops` : "Publish draft"}
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {/* One sentence about what publishing does, plus only the caveats that apply
                    to the shops actually ticked. The Shopify one is worth its length:
                    write_products was added to the OAuth scopes after most shops connected,
                    and scopes are fixed at grant time, so a store connected before that
                    refuses every publish however correct the payload is. */}
                Creates a DRAFT in each shop for you to review, then list.
                {pickedDests.some((d) => d.platform === "etsy") && " Etsy reuses an existing listing’s category & shipping profile."}
                {pickedDests.some((d) => d.platform === "shopify") && " A Shopify store connected before publishing was supported must be reconnected first — Shopify grants the permission at connect time, not per request."}
                {pickedDests.some((d) => d.dry_run) && " One shop is in dry-run mode: it will be validated and nothing will be sent."}
              </p>
              </SectionCard>
            </aside>
          </div>
        )}
    </div>

      {/* THE LIGHTBOX.
          A sibling of the publish dialog, not a child of it: a second Base UI dialog mounted
          INSIDE the first one's popup opens and shuts again in the same frame (verified —
          state went 0 → null with no other input), because the parent's dismiss logic counts
          the newly mounted child as an outside press. As a sibling both stay open and closing
          this one returns to a form with every field still filled in.

          The watermark is drawn again at the larger size. The mark has to survive the zoom,
          or the zoom is simply the way to get a clean copy of someone else's photo. */}
      <Dialog open={zoomSrc != null} onOpenChange={(o) => { if (!o) setZoom(null) }}>
        <DialogContent className="w-auto max-w-[calc(100vw-2rem)] gap-3 p-3 sm:max-w-[min(92vw,900px)]">
          <DialogTitle className="pr-10 text-xs font-medium text-muted-foreground">
            Reference photo {(zoom ?? 0) + 1} of {referencePhotos.length} — the competitor’s own shot, not published with your listing
          </DialogTitle>
          <div className="relative flex max-h-[72dvh] justify-center overflow-hidden rounded-lg bg-muted/40">
            {zoomSrc && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={zoomSrc} alt="" className="max-h-[72dvh] w-auto max-w-full object-contain" />
                <ReferenceWatermark big />
              </>
            )}
          </div>
          {referencePhotos.length > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setZoom((i) => (i === null ? i : (i - 1 + referencePhotos.length) % referencePhotos.length))}>
                <CaretLeft size={13} weight="bold" /> Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => setZoom((i) => (i === null ? i : (i + 1) % referencePhotos.length))}>
                Next <CaretRight size={13} weight="bold" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Placeholder icon export kept for parity with the old dialogs' empty state. */
export const PublishEmptyIcon = Package

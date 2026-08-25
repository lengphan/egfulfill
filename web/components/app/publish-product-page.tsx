"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useMemo, useRef, useState } from "react"
import { thumbnail } from "@/lib/thumbnail"
import { useRouter } from "next/navigation"
import { CircleNotch, Trash, Package, MagnifyingGlassPlus, CaretLeft, CaretRight, Plus, Check, CheckCircle, Warning, XCircle, Sparkle, X } from "@phosphor-icons/react"
import { detectTrademarks } from "@/lib/trademarks"
import { rewriteListingCopy } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ProductCombobox } from "@/components/app/product-combobox"
import { SectionCard } from "@/components/app/section-card"
import { ListingPhotoStudio } from "@/components/app/listing-photo-studio"
import { readImageFile } from "@/components/app/design-canvas"
import { prettyColorName } from "@/lib/color-name"
import { sizesOf, colorsOf, methodsOf } from "@/lib/variant-resolve"
import { getSpecQuote, publishEtsy, publishTiktok, publishShopify, getTiktokCategories, getTiktokWarehouses, getPublishDestinations, getCatalogProducts, saveCatalogProducts, type CatalogProduct, type SpecQuote, type TiktokCategory, type TiktokWarehouse, type EtsyWhoMade, type PublishedRecord, type PublishDestination, recordSpydeckUpload, keepListingPhoto} from "@/lib/api"
import { readPublishDraft, clearPublishDraft, type PublishDraft, type PublishPrefill } from "@/lib/publish-draft"
import { getUser } from "@/lib/auth"

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
  const tl = useLabelT()
 const allOn = picked.length === options.length && options.length > 0
 return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="eg-label text-muted-foreground">
          {label} ({picked.length}/{options.length})
        </span>
        <button
 type="button"
 onClick={() => onChange(allOn ? [] : options)}
 className="text-2xs font-medium text-primary transition-colors hover:underline"
        >
          {allOn ? tl("publish", "None") : tl("publish", "All")}
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
  /** Package size. TikTok rejects the whole create call when any of these is zero or absent
   *  ("all package dimensions must be positive numeric values") — it is not optional, and we
   * were sending none at all. Strings because they are typed. */
 length: string
 width: string
 height: string
 dimUnit: string
 loadErr: string
 loaded: boolean
}
/*
 * A POLY MAILER WITH A FOLDED TEE IN IT, which is what almost everything here ships as.
 *
 * A default rather than a blank, because TikTok refuses without one and an empty required
 * field on a screen with eight others is how a publish fails at the last step. It is EDITABLE
 * and it is shown, not hidden — this is a number the carrier will bill against, so it must be
 * possible to see it is wrong. It is not a claim about the product; nothing here reaches the
 * buyer's listing copy.
 */
const TT_EMPTY: TtFields = {
 categories: [], category: null, query: "", warehouses: [], warehouse: "",
 weight: "", unit: "POUND",
 length: "10", width: "8", height: "1", dimUnit: "INCH",
 loadErr: "", loaded: false,
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
/**
 * THE LAST CATEGORY YOU PICKED, PER SHOP.
 *
 * TikTok requires a LEAF category and there are thousands of them, so finding the right one
 * is a genuine search — and a seller publishing shirt after shirt was repeating that search
 * every single time, for the same answer. Remembered per connection_id rather than globally,
 * because two shops can sell different things and the right default for one is a wrong
 * default for the other.
 *
 * A DEFAULT, NOT A DECISION. It prefills and can be changed before publishing; nothing is
 * sent that the seller has not seen in the field. Stored per shop, so clearing one does not
 * touch another.
 *
 * localStorage rather than the server: it is a UI convenience with no consequence if it is
 * lost, and a round trip to store it would be more machinery than the preference is worth.
 */
const CAT_KEY = (cid: string) => `eg_tt_cat_${cid}`
function rememberCategory(cid: string, c: TiktokCategory | null) {
 try {
 if (c) localStorage.setItem(CAT_KEY(cid), JSON.stringify({ id: c.id, local_name: c.local_name }))
 else localStorage.removeItem(CAT_KEY(cid))
  } catch { /* private mode / quota — a lost preference must never break publishing */ }
}
function recallCategory(cid: string): TiktokCategory | null {
 try {
 const raw = localStorage.getItem(CAT_KEY(cid))
 if (!raw) return null
 const v = JSON.parse(raw)
 return v && v.id ? (v as TiktokCategory) : null
  } catch { return null }
}

function TiktokFields({ dest, fields, onChange }: {
 dest: PublishDestination
 fields: TtFields
 onChange: (patch: Partial<TtFields>) => void
}) {
  const tl = useLabelT()
  // Leaf categories that match what the seller typed. Capped so a 5,000-node tree can't
  // render at once; the search box is how you reach the rest.
 const matches = useMemo(() => {
 const qy = fields.query.trim().toLowerCase()
 return fields.categories.filter((c) => !qy || (c.local_name ?? "").toLowerCase().includes(qy)).slice(0, 40)
  }, [fields.categories, fields.query])

 return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="eg-label text-muted-foreground">
        {dest.shop_name} needs
      </div>
      {fields.loadErr && <p className="text-xs text-destructive">{fields.loadErr}</p>}

      {/* Leaf category — required. Search then pick from the tree. */}
      <div className="space-y-1">
        {/* THE NAME OF THE PICK IS NOT REPEATED HERE. The select two lines down already
 shows it, so "Category · Family Clothing Sets" above a box reading "Family
            Clothing Sets" was the same words twice, with a floating search pill wedged
 between them — three controls' worth of chrome for one choice. */}
        <div className="text-xs font-medium">{tl("publish", "Category")}</div>
        {/* ONE CONTROL, TWO ROWS. The filter sits directly on top of the list it filters,
 sharing an outline — a detached pill above a detached box reads as two unrelated
 fields, which is exactly how it looked. */}
        <div className="overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring/40">
          <input
 value={fields.query}
 onChange={(e) => onChange({ query: e.target.value })}
            /* An empty list after a FAILED load is not a loading list. Showing the error above
 while the field still said "Loading categories…" left the two halves of the
 screen contradicting each other, and the spinner-ish wording is the one people
 believe — so it read as slow rather than broken. */
 placeholder={fields.categories.length ? tl("publish", "Type to filter…") : fields.loadErr ? tl("publish", "Couldn't load categories") : tl("publish", "Loading categories…")}
 disabled={!fields.categories.length && !!fields.loadErr}
 className="block h-8 w-full border-b border-border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
          />
        {/* A DROPDOWN, with the box above it as a filter rather than as the only way in.
            It used to be search-only: the list appeared while you typed and vanished when you
 stopped, so with an empty box there was nothing to open and no way to see what was
 on offer — on a required field whose valid values are a tree of thousands. The
 select is always there; typing narrows it. */}
        <select
 value={fields.category?.id ?? ""}
 onChange={(e) => {
 const c = fields.categories.find((x) => String(x.id) === e.target.value) ?? null
 onChange({ category: c, query: "" })
 rememberCategory(dest.connection_id, c)
          }}
 disabled={!fields.categories.length}
 aria-label={tl("publish", "TikTok leaf category")}
 className="eg-select block h-8 w-full border-0 bg-transparent px-2 text-xs outline-none"
        >
          <option value="">
            {fields.categories.length ? tl("publish", "Choose a category…") : fields.loadErr ? tl("publish", "Couldn't load categories") : tl("publish", "Loading categories…")}
          </option>
          {/* The current pick is listed even when the filter excludes it, or typing would
 silently clear a category that is still selected. */}
          {fields.category && !matches.some((c) => c.id === fields.category!.id) && (
            <option value={fields.category.id}>{fields.category.local_name || fields.category.id}</option>
          )}
          {matches.map((c) => <option key={c.id} value={c.id}>{c.local_name || c.id}</option>)}
        </select>
        </div>
        {fields.query.trim() && matches.length === 0 && (
          <p className="text-xs text-muted-foreground">{tl("publish", "No leaf category matches that.")}</p>
        )}
        {fields.query.trim() && matches.length > 0 && (
          <p className="text-2xs text-muted-foreground">Showing {matches.length} match{matches.length === 1 ? "" : "es"}.</p>
        )}
      </div>

      {/* Warehouse — per-SKU inventory is booked against it, and it belongs to THIS shop. */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">{tl("publish", "Warehouse")}</span>
        <select value={fields.warehouse} onChange={(e) => onChange({ warehouse: e.target.value })} className="eg-select h-8 rounded-md border border-border bg-card px-2 text-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
          {!fields.warehouses.length && <option value="">{tl("publish", "No warehouse found")}</option>}
          {fields.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
        </select>
      </label>

      {/* Package weight — required for physical products. */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">{tl("publish", "Package weight")}</span>
        <div className="flex gap-1.5">
          <Input value={fields.weight} onChange={(e) => onChange({ weight: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.5" inputMode="decimal" className="h-8 flex-1 text-xs" />
          <select value={fields.unit} onChange={(e) => onChange({ unit: e.target.value })} className="eg-select h-8 rounded-md border border-border bg-card px-2 text-xs">
            <option value="POUND">lb</option>
            <option value="KILOGRAM">kg</option>
          </select>
        </div>
      </label>

      {/* PACKAGE SIZE — also required, and the one we were not sending at all.
          TikTok's refusal names the field but not the fix: "`package_dimensions` is invalid
 because all package dimensions must be positive numeric values" is what you get for
 omitting it entirely, so a publish that had every visible field filled in still
 failed. Prefilled for a poly mailer and editable, because a required number that
 starts blank is just a later failure. */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">{tl("publish", "Package size")}</span>
        <div className="flex items-center gap-1.5">
          <Input value={fields.length} onChange={(e) => onChange({ length: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="L" inputMode="decimal" aria-label={tl("publish", "Package length")} className="h-8 min-w-0 flex-1 text-xs" />
          <span className="text-2xs text-muted-foreground">×</span>
          <Input value={fields.width} onChange={(e) => onChange({ width: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="W" inputMode="decimal" aria-label={tl("publish", "Package width")} className="h-8 min-w-0 flex-1 text-xs" />
          <span className="text-2xs text-muted-foreground">×</span>
          <Input value={fields.height} onChange={(e) => onChange({ height: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="H" inputMode="decimal" aria-label={tl("publish", "Package height")} className="h-8 min-w-0 flex-1 text-xs" />
          <select value={fields.dimUnit} onChange={(e) => onChange({ dimUnit: e.target.value })} aria-label={tl("publish", "Dimension unit")} className="eg-select h-8 shrink-0 rounded-md border border-border bg-card px-2 text-xs">
            <option value="INCH">in</option>
            <option value="CENTIMETER">cm</option>
          </select>
        </div>
      </label>
    </div>
  )
}

/**
 * One shop's status after a run — the row that makes partial success readable.
 *
 * It was a single run-on sentence: "CustomBabeUSA · Etsy — Draft listing created View →",
 * wrapped by whatever width was left, so the link fell onto a second line under the text
 * and each of the three rows was a different shape. Three facts written as one sentence
 * cannot line up with the row beneath it.
 *
 * Columns now: mark · shop · platform · what happened · the link. Read down any one of
 * them and it answers a single question — which shops, on what, did what.
 *
 * The mark is an ICON, not an emoji. ✅/⚠️/❌ render as the operating system's own glyphs
 * at their own size and baseline, which is why the tick sat as a hard green SQUARE next to
 * lettering it was supposed to belong with — and why it read as a checkbox. These are the
 * same four marks the dispatch board uses for the same four states.
 */
const OUTCOME_MARK = {
 ok: { Icon: CheckCircle, cls: "text-success", weight: "fill" as const },
 dry: { Icon: Warning, cls: "text-hold", weight: "fill" as const },
 fail: { Icon: XCircle, cls: "text-destructive", weight: "fill" as const },
}

function OutcomeLine({ dest, outcome, sameForAll }: { dest: PublishDestination; outcome?: Outcome; sameForAll?: boolean }) {
  const tl = useLabelT()
 if (!outcome) return null
 const mark = outcome.state === "ok" ? OUTCOME_MARK.ok
 : outcome.state === "dry" ? OUTCOME_MARK.dry
 : outcome.state === "fail" ? OUTCOME_MARK.fail
 : null
  /**
   * THREE COLUMNS, and only one of them can wrap.
   *
   * It had five — mark, shop, platform, outcome, link — each sized independently, so on a
   * real run three of them truncated at once ("CustomBabe…", "Draft product crea…") and no
   * two rows lined up. Five ragged columns of abbreviated text is not a summary.
   *
   * `sameForAll` is the outcome text hoisted to a single line under the heading when every
   * shop reports the same thing, which is the usual run: three rows all saying "Draft listing
   * created" is one fact printed three times. A row only carries its own words when it
   * DIFFERS — a dry run or a refusal among successes — which is precisely when you want them.
   *
   * text-sm, not text-xs, and a bigger mark: this is the LAST thing the dialog says — the
   * confirmation you read before closing it — and it was set smaller than the form fields
   * above it.
   *
   * THE OUTCOME DOES NOT SHARE THE TRUNCATING LINE.
   *
   * It used to sit inline after the platform, inside the one cell that clips — so in a 22rem
   * rail every row lost its ending at once: "CustomBabeUSA · Etsy · Dr…", "OLVERA-TEES ·
   * TikTok Shop · Inv…". For a refusal that was total, because the actionable half of an API
   * error is always at the END of the sentence, and the title tooltip carried the shop name
   * rather than the message. A shop that refused was readable only in the network panel.
   *
   * Truncating the successes was quieter and still wrong: "Listed live" and "Draft product
   * created" are opposite facts that both clip to "Dr…"/"Li…", and which one happened is the
   * whole question after a publish.
   *
   * So the words go on their own line under the name, free to wrap. The row above stays a
   * scannable three columns — mark, shop, link — and nothing on it can be cut.
   */
 const failed = outcome.state === "fail"
 const detail = [outcome.text, outcome.note].filter(Boolean).join(" ")
  // A green tick already carries "this went well"; green words under it say it twice. Only
  // the two states that need attention are coloured.
 const detailCls = failed ? "text-destructive"
 : outcome.state === "dry" ? "text-hold"
 : "text-muted-foreground"
 return (
    <div className="grid grid-cols-[1.1rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-2 text-sm">
      <span className="flex translate-y-px items-center justify-center">
        {mark
          ? <mark.Icon size={16} weight={mark.weight} className={mark.cls} />
 : <CircleNotch size={14} className="animate-spin text-muted-foreground" />}
      </span>
      <span className="min-w-0 truncate" title={[dest.shop_name, dest.platform_label].filter(Boolean).join(" · ")}>
        <span className="font-medium">{dest.shop_name}</span>
        <span className="text-muted-foreground"> · {dest.platform_label}</span>
      </span>
      {/* Last column, so every link starts at the same x — a column of "View" is scannable
 in a way one trailing each sentence is not. Reserved even when a shop has no link,
 or the rows either side of it shift. */}
      <span className="justify-self-end">
        {outcome.url
          ? <a href={outcome.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{tl("publish", "View →")}</a>
 : <span className="text-muted-foreground/50">—</span>}
      </span>

      {/* WHAT HAPPENED, IN FULL. Starts under the shop name and runs to the end of the row.
          `break-words` because a refusal often carries an id, a scope name or a URL with no
 space in it, and an unbreakable token would push the rail sideways instead of
 wrapping. Suppressed by `sameForAll`, which is the done screen saying it once above
 the list rather than three times inside it. */}
      {!sameForAll && detail && (
        <p className={"col-start-2 col-end-4 mt-0.5 whitespace-pre-wrap break-words text-xs leading-snug " + detailCls}>
          {detail}
        </p>
      )}
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
  const tl = useLabelT()
 const router = useRouter()
  /**
   * The draft, read once from sessionStorage — in an EFFECT, so the three states stay
   * distinct:
   *
   * undefined still reading (one frame, and during server render)
   * null there is no such draft — the tab was closed, or this URL was shared
   * a draft the listing to publish
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

  // The page resolves a picked blank itself rather than asking each caller for a
  // lookup — the combobox hands back a flattened shape, and pricing needs the full row.
 const catalogRef = useRef<CatalogProduct[]>([])
 const [blank, setBlank] = useState<CatalogProduct | null>(null)
 const [blankText, setBlankText] = useState("")
 const [title, setTitle] = useState("")
 const [desc, setDesc] = useState("")
  /**
   * APPLIED STRAIGHT INTO THE FIELDS, with one snapshot to undo it.
   *
   * This first shipped as a proposal you had to accept — two extra clicks per attempt, on a
   * control whose whole point is trying it again until the wording lands. Reviewing a
   * suggestion beside the original is the same act as reading the field after it changed,
   * so the confirm step bought nothing and cost the iteration speed.
   *
   * `aiPrev` is what makes that safe: the text as it was immediately before the last
   * rewrite, restorable in one click. Only ONE level deep, deliberately — this is an escape
   * hatch for "that was worse", not an edit history, and a stack would imply a promise about
   * older versions that nothing here keeps.
   *
   * Still never auto-requested: `runRewrite` is bound to a button, so no effect fires it and
   * no keystroke does.
   */
 const [aiPrev, setAiPrev] = useState<{ title: string; description: string } | null>(null)
 const [aiBusy, setAiBusy] = useState(false)
 const [aiErr, setAiErr] = useState<string | null>(null)
 const [retail, setRetail] = useState("")
 const [qty, setQty] = useState("999")
 const [tags, setTags] = useState<string[]>([])

  /**
   * BRAND NAMES IN THE COPY WE ARE ABOUT TO PUBLISH.
   *
   * SpyDeck already flags these on a COMPETITOR's listing, which is the half that costs
   * nothing — the risk is on this screen, where a scraped title and description become OUR
   * seller's listing. A competitor's "Disney Characters Halloween Embroidery Shirt" is one
   * paste away from being published verbatim, and a marketplace takedown is per-listing
   * until it is per-shop.
   *
   * A WARNING, NOT A BLOCK. Same rule the partner-disclosure notice follows: plenty of these
   * are legitimate — a garment brand in a title we are entitled to use, a word that is only
   * a trademark in another category — and a hard stop on a false positive is a feature
   * nobody can ship around. It names the terms and where they are; the seller decides.
   *
   * Reads title, description AND tags together, because a term stripped from the title and
   * left in the tags is still on the listing.
   */
  /**
   * ONE CALL, ON A CLICK. Guarded on `aiBusy` so a double-press cannot bill twice, and it
   * writes to `aiDraft` — the fields the seller is editing are never touched here.
   */
 const runRewrite = async () => {
 if (aiBusy) return
 setAiBusy(true); setAiErr(null)
 try {
 const r = await rewriteListingCopy({
 title, description: desc,
 product: blank?.name ?? undefined,
 colors: pickedColors, sizes: pickedSizes,
 method: blank?.method ?? undefined,
      })
 if (r.error) throw new Error(r.error)
      // Snapshot BEFORE writing, so undo restores what the seller had rather than what the
      // previous rewrite produced.
 setAiPrev({ title, description: desc })
 if (r.title) setTitle(r.title)
 if (r.description) setDesc(r.description)
    } catch (e) {
 setAiErr(e instanceof Error ? e.message : "The assistant couldn't rewrite this.")
    } finally { setAiBusy(false) }
  }

 const tmHits = useMemo(
    () => detectTrademarks([title, desc, tags.join(" ")].filter(Boolean).join(" \n ")),
 [title, desc, tags],
  )
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
  /**
   * DRAFT OR LIVE, one choice for the whole run.
   *
   * Every channel was hardcoded to a draft, on the reasoning that nothing should reach a
   * buyer before a person has looked at it. That is the right DEFAULT and the wrong rule:
   * a seller republishing a listing they have already checked ended up opening three shop
   * admins to press activate three times.
   *
   * It is per-run rather than per-shop deliberately. The thing being published is one
   * product, the decision is "is this ready?", and that answer does not change between a
   * seller's own two shops — a checkbox per row would ask the same question three times
   * and let the answers disagree.
   *
   * Defaults to draft, and resets to draft on nothing: an unticked box is the safe state,
   * so a seller can never go live by not noticing a control.
   */
 const [goLive, setGoLive] = useState(false)
  /** Per-shop TikTok fields, keyed by connection_id — see TtFields. */
 const [tt, setTt] = useState<Record<string, TtFields>>({})
  /** What happened at each shop, keyed by connection_id. Survives a retry so a shop that
   * already published keeps its link and cannot be sent twice. */
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
 : (() => {
 const cats = (r.categories ?? []).filter((c) => c.is_leaf !== false)
 const cur = m[cid] ?? TT_EMPTY
                /**
                 * PREFILL THE REMEMBERED CATEGORY — but only against THIS shop's list.
                 *
                 * Resolved from `cats` rather than trusted from storage, so a category that
                 * has been retired, renamed, or that this shop cannot sell into simply does
                 * not come back — a stale id restored blind is a publish that fails at
                 * TikTok with a category error nobody typed.
                 *
                 * Never overrides a choice already made in this dialog.
                 */
 const remembered = cur.category ? null : recallCategory(cid)
 const match = remembered ? cats.find((c) => String(c.id) === String(remembered.id)) : null
 return { ...cur, loadErr: "", categories: cats, category: cur.category ?? match ?? null }
              })(),
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


  /**
   * WHO THE WATERMARK IS FOR.
   *
   * It exists to stop a SELLER mistaking a competitor's photo for one of their own and
   * publishing it — the shortest path there is a shot that looks like an asset in a picker.
   * Staff are not making that mistake from this screen: the factory looks at these to judge
   * a print, a placement, a garment colour, and a diagonal band of type across the middle is
   * exactly over the part being judged.
   *
   * The FACT does not come off with the mark. The tile keeps its dashed border, the count
   * line above the grid still reads "N reference photos shown, none published", and the
   * lightbox is still titled "the competitor's own shot, not published with your listing".
   * What changes is only whether it is written across the photograph.
   *
   * Defaults to the seller's view when the role is unknown, so a failed session read leaves
   * the mark ON rather than off — the safe direction for a guard rail.
   */
 const staffViewer = (getUser()?.role || "seller") !== "seller"

  // Which reference photo the lightbox is showing, or null for closed. A thumbnail this
  // small is not enough to judge a competitor's shot by, which is the entire reason these
  // are on screen — so the tile opens one full size. The watermark comes with it.
  /* ONE piece of state for BOTH strips — only one lightbox can be open, and two states would
 have to agree about that. `which` picks the list Prev/Next walks, so paging stays inside
 the set you opened instead of running off the end of it into the other one. */
 const [zoom, setZoom] = useState<{ which: "ref" | "own"; index: number } | null>(null)

  /**
   * THE REFERENCE SET, PICKED ON THE GRID.
   *
   * It lives here rather than inside the studio because it is ticked in two places — the tiles
   * in this grid and the thumb strip in the dialog — and two copies would disagree the moment
   * one of them moved. Everything is on by default: the point of the feature is not having to
   * gather the photos by hand.
   *
   * Seeded from a function so a listing that arrives with six references starts with six
   * ticked, and re-seeded by key when the draft changes rather than by an effect that would
   * render one frame of the wrong set.
   */
  /*
   * NOTHING IS TICKED TO BEGIN WITH.
   *
   * It used to default to all of them, which meant a nine-photo listing opened with nine
   * references armed and a prompt written from every one — including the size charts and the
   * thread-colour tables, which teach a photographer nothing. Picking is the point: you look
   * at the set, choose the two or three that show the shot you want, and brief from those.
   *
   * A plain empty array, so there is no seeding effect writing state the render already
   * depends on — the shape this codebase keeps getting bitten by.
   */
 const [refPicked, setRefPicked] = useState<number[]>([])
 const [studioOpen, setStudioOpen] = useState(false)
 const [studioFocus, setStudioFocus] = useState(0)

  /* openStudioOn is gone with the per-tile "Make ours" overlay. A tile click now selects
 and nothing else, so there is no longer a way to open the studio pointed at one photo —
 which is the point: it is briefed from the whole ticked set. */
  /** Open on the first ticked photo. The button is disabled until there is one, so this
   * never opens on an empty brief. */
 const openStudio = () => { setStudioFocus(refPicked[0] ?? 0); setStudioOpen(true) }
 const toggleRefPick = (i: number) =>
 setRefPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i].sort((a, b) => a - b)))

  /** A finished render joins the publishable set — at the END, so it never silently takes
   * over as the cover photo. Making it primary stays a deliberate press, as it is for
   * every other photo here. */
 const useRender = (url: string) => {
 imgTouched.current = true
 setImages((p) => (p.length >= MAX_IMAGES || p.includes(url) ? p : [...p, url]))
  }
 const zoomList = zoom?.which === "own" ? images : referencePhotos
 const zoomSrc = zoom ? zoomList[zoom.index] : null
 useEffect(() => {
 if (zoom === null) return
 const onKey = (e: KeyboardEvent) => {
 if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
 e.preventDefault()
 const step = e.key === "ArrowRight" ? 1 : -1
 setZoom((z) => {
 if (!z) return z
 const n = (z.which === "own" ? images : referencePhotos).length
 return n ? { ...z, index: (z.index + step + n) % n } : z
      })
    }
    // CAPTURE. A bubble-phase listener here never fires — something between the popup and
    // the window stops arrow keys on the way up (verified: a capture listener sees the same
    // keypress a bubble one misses), so the gallery simply didn't respond to the keyboard.
 window.addEventListener("keydown", onKey, true)
 return () => window.removeEventListener("keydown", onKey, true)
  }, [zoom, referencePhotos, images])

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
 save_mode: goLive ? "LISTING" : "AS_DRAFT",
 category_id: f.category.id, warehouse_id: f.warehouse,
 package_weight: f.weight, weight_unit: f.unit,
 package_length: f.length, package_width: f.width, package_height: f.height,
 dimension_unit: f.dimUnit,
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
 onPublished?.(undefined, recordCover(null), {
 platform: "tiktok",
        // TikTok's own id for the draft. It was dropped, which is how this destination came
        // to write an upload record with no listing id at all — and, before the coalesce on
        // the server, to erase whatever Etsy had put there.
 listing_id: r.product_id ?? undefined,
 title: title.trim(), price: basePrice, image: recordCover(null),
 state: goLive ? "active" : "draft",
 blank_sku: blank?.sku ?? undefined, blank_name: blank?.name ?? undefined,
 print_type: method || undefined,
 colors: blank ? pickedColors : [], sizes: blank ? pickedSizes : [],
 images_uploaded: images.length,
      })
 return {
 state: "ok",
 text: goLive ? "Product listed" : "Draft product created",
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
 state: goLive ? "active" : "draft",
      })
 if (r.error) throw new Error(r.error)
 onPublished?.(r.url, recordCover(r.primary_image), {
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
        // Shopify takes the status at creation, so what came back is what it is.
 text: r.state === "active" ? "Listed live" : "Draft product created",
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
        // Etsy creates the draft, uploads the photos, then flips it — it will not activate
        // a listing that has no image. `activation_error` below is that last step refusing.
 state: goLive ? "active" : "draft",
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
 const cover = recordCover(r.primary_image)
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
      // SAY WHICH ONE IT ACTUALLY IS. Etsy is asked to activate only after the photos and
      // variants are on, and that call can refuse on its own — an incomplete shop profile,
      // a listing Etsy won't take live yet. Reporting "listed live" off the button that was
      // pressed rather than off the state that came back is how a draft gets left sitting in
      // a shop while the seller believes it is selling.
 const live = r.state === "active"
 return {
 state: "ok",
 text: live ? "Listed live" : "Draft listing created",
 url: r.url,
        // The one thing worth interrupting for: the listing exists but has no variants, so
        // it is a flat listing and somebody has to decide whether that will do.
 note: [
 r.variants_error ? `Variants were rejected (${r.variants_error}), so it listed flat.` : "",
 r.activation_error
            ? `It's still a draft — Etsy wouldn't activate it (${r.activation_error}). Activate it in Shop Manager.`
 : "",
        ].filter(Boolean).join(" ") || undefined,
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
      // Caught HERE rather than at TikTok, which answers a zero with a sentence naming a
      // field the screen never showed. All three, because TikTok validates them together.
      !(Number(f.length) > 0 && Number(f.width) > 0 && Number(f.height) > 0) && "a package size",
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
   * HAS THIS LISTING ALREADY GONE OUT?
   *
   * Two ways it can have. One is in THIS run — a shop reported ok, and `isDone` already stops
   * that shop being sent twice. The other is that the draft was opened from a listing that
   * exists in a shop, which SpyDeck's Uploaded card does; nothing in the outcomes says so,
   * and pressing Publish there creates a DUPLICATE in the shop rather than editing anything.
   *
   * The flag rides on the draft's SHAPE, not on its heading: a heading is a display string
   * somebody will reword. An edit-existing draft is the one that arrives already carrying
   * publishable images — SpyDeck's "make one like this" hands over `images: []` on purpose,
   * because a listing built from a competitor has none of its own photos yet.
   *
   * The word on the button is a guard, not a block. It does not stop a deliberate second
   * send; it refuses to call it by the same name as the first.
   */
 const anyPublished = pickedDests.some((d) => outcomes[d.connection_id]?.state === "ok")
    || (draft?.prefill?.images?.length ?? 0) > 0

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
  /**
   * Tell SpyDeck what we published, from here.
   *
   * DECLARED HERE, not at the top of the component, because it reads the form's state —
   * title, tags, images, blank, the picked axes. A closure sitting above its own
   * dependencies reads to React Compiler as "these may be modified later", and it answers
   * by refusing to memoise the whole component.
   *
   * In the dialog this was an `onPublished` prop: SpyDeck held the competitor listing in
   * state and recorded the upload against it. A page has no parent to call, so the source
   * listing travels in the draft and the record is written here instead — the same
   * server-side call SpyDeck made, so the Uploaded card is there when you go back.
   */
  /**
   * THE PICTURES, KEPT — once per run, before the first destination reports.
   *
   * Two different jobs, and they need different things. The card needs a picture that draws
   * instantly and still draws when the marketplace draft is long deleted: a ~8KB WebP, small
   * enough to sit in the row. Re-publishing needs the ORIGINALS, which are far too big for
   * the row and go to object storage instead, leaving a same-origin url behind.
   *
   * A ref rather than state: this runs inside the publish and its result is read by the
   * record write a moment later, in the same pass — a setState wouldn't have landed yet.
   */
 const coverThumbRef = useRef<string | null>(null)
 const keptImagesRef = useRef<string[] | null>(null)
  /**
   * THE PICTURE THE RECORD KEEPS — never the raw data: URL.
   *
   * spydeck_uploads drops data: URLs on purpose (persistableImage — a base64 blob per photo
   * per listing is what it exists to prevent), so passing `images[0]` straight in means the
   * row is stored with NO image whenever the photo came off the seller's machine, which is
   * every design made in the lab. Etsy never showed it because Etsy hands back a hosted
   * `primary_image`; TikTok hands back none, so its cards published fine and then rendered
   * as an empty box while the listing sat on the marketplace with the photo on it.
   *
   * keepPhotos() has already uploaded these and holds OUR urls, so the order is: the
   * marketplace's own hosted image, then the copy we stored, then the raw source — which is
   * only reached when both failed, and is honest about showing what we tried.
   */
 const recordCover = (hosted?: string | null) =>
 hosted || keptImagesRef.current?.[0] || images[0]

 const keepPhotos = async () => {
 if (keptImagesRef.current) return keptImagesRef.current
 coverThumbRef.current = images[0] ? await thumbnail(images[0]).catch(() => images[0]) : null
 const kept: string[] = []
 for (const src of images) {
      // Already a url — nothing to store, and re-uploading it would only make a second copy
      // of something the marketplace is already hosting.
 if (!src.startsWith("data:")) { kept.push(src); continue }
 const r = await keepListingPhoto(src).catch(() => null)
      // A photo we couldn't store is simply left out of the record rather than written in
      // as a megabyte of base64 — that is the failure this whole path exists to avoid.
 if (r?.url) kept.push(r.url)
    }
 keptImagesRef.current = kept
 return kept
  }

 const onPublished = (url?: string, primaryImage?: string, published?: PublishedRecord) => {
 if (!source) return
 const merged = primaryImage ? { ...source, image: primaryImage, thumb: primaryImage } : source
    // THE FORM ITSELF, sent with every destination and identical each time.
    //
    // Reopening a published listing used to rebuild the form from published_listings, which
    // is written per platform and carries different fields on each — TikTok's row has no
    // title, description or tags at all. Publishing to three shops therefore produced three
    // writes of this record, and whichever ran last decided what you got back. That is why
    // the form came up empty: TikTok finished last, so its row (and its absent url) is what
    // the Uploaded card joined to.
    //
    // One key, one shape, written the same way by every destination, so the answer no longer
    // depends on which shop was slowest.
 recordSpydeckUpload(merged, {
 url, listing_id: published?.listing_id, published,
      // COPIES, not the state arrays themselves. Handing the live references to a function
      // the compiler can't see into reads as "these may be mutated later", which makes
      // React Compiler give up memoising this whole component.
 submitted: {
 title: title.trim(), description: desc, tags: [...tags], price: basePrice,
 images: keptImagesRef.current ? [...keptImagesRef.current] : [...images],
 cover_thumb: coverThumbRef.current ?? undefined,
 colors: blank ? [...pickedColors] : [], sizes: blank ? [...pickedSizes] : [],
 blank_sku: blank?.sku ?? undefined, print_type: method || undefined,
 design_id: prefill?.designId, design_data: prefill?.designUrl, design_pos: prefill?.designPos,
      },
    }).catch(() => {})
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
    // The pictures first, once — before any destination reports, so every write of the
    // record carries the same kept urls and the same thumbnail. Best-effort: a photo that
    // won't store must not stop the listing going out.
 await keepPhotos().catch(() => {})
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
    <div className="mx-auto w-full max-w-[70rem] space-y-5 p-4 sm:p-6">
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
          <p className="font-medium">{tl("publish", "There’s nothing to publish here.")}</p>
          <p className="text-sm text-muted-foreground">
            {tl("publish", "A publish page is opened from a product — and the draft it carried is gone, which happens when the tab was closed or this link came from somewhere else. Start again from the board you were on.")}
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => router.push("/spydeck")}>{tl("publish", "SpyDeck")}</Button>
            <Button variant="outline" onClick={() => router.push("/design/maker")}>{tl("publish", "Design")}</Button>
          </div>
        </div>
      )}

      {/* THE DONE SCREEN, only when every ticked shop is actually finished. With one shop
 this is the same panel it always was; with four it lists what happened at each,
 because "published" over a run that included a dry run would be a claim about
 three shops and a lie about the fourth. Any failure keeps the form on screen so
 it can be fixed without retyping the listing. */}
        {draft == null ? null : allDone && !busy ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2.5 rounded-2xl border border-border bg-card py-8 text-center">
            <div className="text-sm font-semibold text-success">
              {pickedDests.every((d) => outcomes[d.connection_id]?.state === "ok")
                ? PUBLISH_OK
 : tl("publish", "Finished — with one shop that sent nothing")}
            </div>
            {/* Said ONCE when every shop said the same thing, which is the usual run. Three
 rows each reading "Draft listing created" is one fact printed three times, and
 it was the widest column on the panel. */}
            {(() => {
 const texts = pickedDests.map((d) => outcomes[d.connection_id]?.text).filter(Boolean)
 const same = texts.length === pickedDests.length && new Set(texts).size === 1
 return (
                <>
                  {/* "Draft listing created" is gone. The tick already says it — a green
 check beside a shop name is not ambiguous about what happened, and
 spelling it out underneath was the same fact a third time (the heading
 above says it too). Only a row that DIFFERS still carries words, which
 is the case where you actually need them: a dry run, or a refusal among
 successes. */}
                  <div className="w-full max-w-sm divide-y divide-border/60 px-6 text-left">
                    {pickedDests.map((d) => <OutcomeLine key={d.connection_id} dest={d} outcome={outcomes[d.connection_id]} sameForAll={same} />)}
                  </div>
                </>
              )
            })()}
            <Button onClick={leave}>{returnLabel}</Button>
          </div>
        ) : (
          /* THREE COLUMNS: what it looks like · what it is · where it goes.
             The third is a STICKY rail, so the shops you picked and the button that sends
 it stay on screen while you write a description four screens down. In the
 dialog those sat at the bottom of a scroll box, which is how you end up
 editing a listing without being able to see where it's going. */
          /* ONE COLUMN OF FORM, and a rail beside it.
             A listing is a sequence — photos, words, product, price — so it reads down a
 single column of comfortable measure. Only "where does this go" and the button
 sit alongside, and below 1280px even they drop underneath, which is the stacked
 layout this page is best at. */
          /* PHOTOS SPANS BOTH COLUMNS; the rail starts on the row below it.
             The rail used to sit level with the photo grid, so on a listing with nine
 references the pictures — the thing you are actually judging — were squeezed into
 a column two-thirds of the page while a short shop list held the rest of the width
 and then ran out of content. Full-bleed for the photos, and the rail comes back in
 beside the words, where it is the same height as what it sits next to.
             Wider overall too (76rem), because that column now has real work to do. */
          <div className="mx-auto grid w-full max-w-[76rem] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="xl:col-span-2">
              {/* The count and the reference-photo caveat ride in the card's own header —
 repeating "Photos" inside a card called Photos is the kind of doubling a
 dialog's title bar used to hide. */}
              <SectionCard
 title={<>{tl("publish", "Photos")} <span className="font-normal text-muted-foreground">({images.length}/{MAX_IMAGES})</span></>}
 description={referencePhotos.length > 0
                  ? `${referencePhotos.length} reference ${referencePhotos.length === 1 ? "photo" : "photos"} shown, none published${prefill?.referenceNote ? ` — ${prefill.referenceNote}` : ""}`
 : undefined}
                /* IN THE HEADER, ABOVE THE RULE. It sat under the grid in a row of its own
 that repeated what the tick marks already say. A card's header is where its
 one action belongs, and it costs no vertical space there. */
 actions={referencePhotos.length > 0 ? (
                  /* WAITS FOR A PICK. The studio is briefed FROM the ticked photos, so opening
 it with none chosen starts on a screen that cannot do anything yet — and
 now that the tile itself is the tick, choosing one is a single click in
 the grid directly below. The title says what is missing rather than the
 button going quiet. */
                  <Button
 size="sm" variant="outline" onClick={openStudio}
 disabled={refPicked.length === 0}
 title={refPicked.length === 0 ? tl("publish", "Pick at least one reference photo below") : tl("publish", "Generate our own photos from the picked references")}
                  >
                    {tl("publish", "Generate Images")}
                  </Button>
                ) : undefined}
 bodyClassName="space-y-3 p-4"
              >
              <div className="space-y-1.5">
                {/* Sized by a MINIMUM WIDTH, not a column count. A fixed 4-across made each
 tile ~170px in a full-width column (seven photos filled half a screen);
 a fixed 6-across made them postage stamps when a listing has one or two.
 auto-fill at 10rem keeps a thumbnail recognisable at any count and wraps
 when there are enough to need it. */}
                {/* Bigger tiles now the card owns the full width — 10rem was sized for a
 two-thirds column and left the photos smaller than they needed to be for
 judging a print. auto-fill still keeps them sane at any count. */}
                {/* 11rem. It was 13, and briefly 8.5 — the 8.5 was sized against "too big" on a
 screen at 110% zoom, so it over-corrected and landed at thumbnail size.
                    Modestly under the original is still right: with the lightbox gone these
 are things to PICK from rather than study, and judging a shot happens in
 the studio. This keeps a nine-photo listing off the whole viewport without
 shrinking the print past recognising. */}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2.5">
                  {/* FIRST, ALWAYS — and a bare +.
                      It used to sit after the photos, so its position moved every time one
 was added or removed and the reference photos pushed it into the middle
 of the row, where it read as a gap in the set rather than a control.
                      A fixed corner is findable without looking. The icon and the word "Add"
 both said the same thing at 3xs; a + says it at a glance and leaves the
 tile quiet next to the photographs it sits among. */}
                  {images.length < MAX_IMAGES && (
                    <button
 onClick={() => fileRef.current?.click()}
 aria-label={tl("publish", "Add a photo")}
 title={tl("publish", "Add a photo")}
 className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      <Plus size={22} weight="bold" />
                    </button>
                  )}
                  {images.map((src, i) => (
                    <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                      {i === 0 && <span className="absolute inset-x-0 bottom-0 bg-primary/90 py-0.5 text-center text-2xs font-semibold uppercase text-primary-foreground">{tl("publish", "Primary")}</span>}
                      <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                        {/* ZOOM ON THE PUBLISHABLE PHOTOS TOO. Only the competitor's shots
 opened full size, which had it exactly backwards: the photos that
 are actually going to a marketplace were the ones you could not
 inspect before sending them. */}
                        <button onClick={() => setZoom({ which: "own", index: i })} aria-label={`View photo ${i + 1} larger`}
 className="cursor-zoom-in rounded bg-white/90 p-1 text-black"><MagnifyingGlassPlus size={11} weight="bold" /></button>
                        {i !== 0 && <button onClick={() => makePrimary(i)} className="rounded bg-white/90 px-1.5 py-0.5 text-2xs font-semibold text-black">{tl("publish", "Primary")}</button>}
                        <button onClick={() => removeImage(i)} aria-label={tl("publish", "Remove photo")} className="rounded bg-white/90 p-1 text-black"><Trash size={11} weight="bold" /></button>
                      </div>
                    </div>
                  ))}
                  {/* THE COMPETITOR'S PHOTOS, IN THE SAME GRID BUT MARKED ON THE IMAGE.
                      They are not in `images`, so nothing here can reach a marketplace — the
 watermark is what makes that legible rather than something the seller has
 to remember. Sitting them in a separate panel was the previous answer and
 it read as a second, publishable set; a caption ON the photo cannot be
 scrolled away from.
                      Dashed border, no hover controls, watermark: everything says "not yours". */}
                  {/* TWO CONTROLS ON ONE TILE, as SIBLINGS — a button inside a button is
 invalid and the inner one never receives the click. The tile itself
 points the studio at this photo and has it read; the corner glyph
 opens it full size, which is still the only way to judge a shot at
 this thumbnail size. */}
                  {referencePhotos.map((src, i) => (
                    /* ONE CONTROL PER TILE, and it is the tile.
                       There were three: a corner tick, a full-area "Make ours" overlay, and a
 corner magnifier. Clicking the obvious target — the photograph — opened
 a lightbox, which is not what anyone wants from a picker, and the two
 hover controls only existed on hover, so the tile's real behaviour was
 invisible until the mouse was already on it.
                       Now the whole tile toggles selection. The corner circle stays as the
                       INDICATOR and is no longer a button; making a photo of your own is one
 action for the whole set and belongs in the header, not repeated on
 every tile. */
                    <button
 key={`ref-${i}`}
 type="button"
 onClick={() => toggleRefPick(i)}
 aria-pressed={refPicked.includes(i)}
 aria-label={refPicked.includes(i) ? `Stop using reference photo ${i + 1}` : `Use reference photo ${i + 1}`}
 title={refPicked.includes(i) ? tl("publish", "Using this one — click to drop it") : tl("publish", "Not used — click to add it")}
 className="group relative aspect-square overflow-hidden rounded-lg bg-muted/40 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      {/* GREYED, ALWAYS — even for staff.
                          The watermark is off for the factory (it lands over the print they
 are judging), which left a reference tile looking EXACTLY like a
 publishable one: same crop, same colour, same weight in the grid,
 with a small tick as the only difference. In a nine-photo listing
 that is a set of pictures you cannot tell apart from your own.
                          Desaturating says "not yours" at a glance without covering the
 subject, and it lifts on hover so the shot can still be judged.
                          An unticked one goes further down, because it is not even feeding
 the render. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt=""
 className={"size-full object-cover transition-all duration-200 group-hover:grayscale-0 group-hover:opacity-100 "
                          + (refPicked.includes(i) ? "grayscale-[55%] opacity-75" : "grayscale opacity-30")} />
                      {/* A cool scrim over the top, so the tile reads as a different KIND of
 thing rather than just a duller photograph. Never over the hover
 state, and never intercepting the clicks underneath it. */}
                      <span aria-hidden className="pointer-events-none absolute inset-0 bg-draft/15 transition-opacity duration-200 group-hover:opacity-0" />
                      {!staffViewer && <ReferenceWatermark />}
                      {/* NO `title`. The chip already says "Use as reference" in the same
 spot the native tooltip lands, so both appeared at once and the
 tooltip covered the photo — two labels for one action, one of them
 on top of the thing you are trying to look at. aria-label carries
 the full sentence for a screen reader, which is where the longer
 wording actually belongs. */}
                      {/* THE TICK IS ALWAYS VISIBLE, not on hover. It is the control that
 decides which photos the render is briefed from, so "which ones am I
 using" has to be answerable at a glance rather than by sweeping the
 mouse across the row. An unticked tile also dims, so the set reads
 from across the page. */}
                      <span
 aria-hidden
                        /* A CIRCLE, AND A TICK INSIDE IT — not two circles.
                           It used the CheckCircle glyph, which already draws its own ring, so
 a round filled button around it rendered a circle inside a circle
 with a tiny check squeezed in the middle. Empty ring when unused,
 solid fill with a plain check when used: the same two states every
 checkbox in the world has. */
 className={"absolute left-1 top-1 z-10 grid size-5 place-items-center rounded-full border-2 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 " +
                          (refPicked.includes(i)
                            /* SAME RING, FILLED IN — that is the whole state change.
                               A solid violet disc was a third colour dropped onto a
 photograph, competing with the print it sits over. White
 fill with a dark tick keeps the geometry identical between
 the two states, so the eye reads "filled / not filled"
 rather than "different badge", and it stays legible on a
 dark photo and a pale one alike. */
                            ? "border-white bg-white text-draft"
 : "border-white/90 bg-black/25 text-transparent hover:bg-black/40")}
                      >
                        <Check size={11} weight="bold" />
                      </span>
                    </button>
                  ))}
                </div>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = "" }} />
              </div>

              {/* THE WAY OUT OF THE REFERENCE STRIP.
                  Reference photos are shown and never published, which leaves an obvious gap:
 you can see the shot that sells and have no way to make your own without
 saving every one of them to a laptop. This closes it without reopening the
 path that was removed — it renders OUR photograph, and a render still has to
 be pressed into the set above. */}
              <ListingPhotoStudio
 open={studioOpen}
 onOpenChange={setStudioOpen}
 references={referencePhotos}
 picked={refPicked}
 onPickedChange={setRefPicked}
 focusIndex={studioFocus}
 onUse={useRender}
 listingTitle={title}
 product={blank?.name || undefined}
 method={method || undefined}
 colors={pickedColors}
              />

              </SectionCard>
            </div>

            {/* THE REST OF THE FORM — column one, row two, beside the rail.
                Every group is a SectionCard, the same block every other page in the app is
 built from. On a page the fields had nothing behind them: a dialog's own edges
 did the grouping, and without them the form read as one long drift of inputs
 with no structure and no column boundary. */}
            <div className="space-y-4">
              <SectionCard title={tl("publish", "Listing")} bodyClassName="space-y-4 p-4">
              <label className="flex flex-col gap-1"><span className="text-sm font-medium">{tl("publish", "Title")}</span>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tl("publish", "Retro Sunset Comfort Colors Tee")} />
              </label>
              <label className="flex flex-col gap-1"><span className="text-sm font-medium">{tl("publish", "Description")}</span>
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} placeholder={tl("publish", "Describe the product…")} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
              </label>

              {/* THE ASSIST, ON A BUTTON. Nothing here runs until it is pressed — no call on
 open, none on keystroke — because each one costs money and a wait. Pressing
 it again simply rewrites again, which is how it is actually used. */}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={runRewrite} disabled={aiBusy || (!title.trim() && !desc.trim())}
 title={tl("publish", "Rewrite the title and description in place")}>
                  {aiBusy ? <CircleNotch size={14} className="animate-spin" /> : <Sparkle size={14} weight="fill" />}
                  {aiBusy ? tl("publish", "Rewriting…") : aiPrev ? tl("publish", "Rewrite again") : tl("publish", "Rewrite with AI")}
                </Button>
                {aiPrev && !aiBusy && (
                  <Button size="sm" variant="ghost" onClick={() => { setTitle(aiPrev.title); setDesc(aiPrev.description); setAiPrev(null) }}
 title={tl("publish", "Put back the title and description as they were before the last rewrite")}>
                    {tl("publish", "Undo")}
                  </Button>
                )}
                <span className="text-2xs text-muted-foreground">
                  {aiPrev ? tl("publish", "Applied — press again for another take, or undo.") : tl("publish", "Rewrites the title and description in place.")}
                </span>
              </div>
              {aiErr && <p className="text-xs text-destructive">{aiErr}</p>}

              <div className="space-y-1.5">
                <div className="text-sm font-medium">{tl("publish", "Tags")} <span className="text-muted-foreground">({tags.length}/{MAX_TAGS})</span></div>
                <Input
 value={tagDraft}
 onChange={(e) => setTagDraft(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft) }
 else if (e.key === "Backspace" && !tagDraft && tags.length) removeTag(tags[tags.length - 1])
                  }}
 onBlur={() => addTag(tagDraft)}
 disabled={tags.length >= MAX_TAGS}
 placeholder={tags.length >= MAX_TAGS ? tl("publish", "13 tags is Etsy's maximum") : tl("publish", "Type a tag, press Enter")}
                />
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((t) => <button key={t} onClick={() => removeTag(t)} className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">{t}<X size={10} weight="bold" /></button>)}
                  </div>
                )}
                {/* NO TRENDING-KEYWORD CHIPS. A dozen shop-wide SpyDeck keywords sat under
 the 13 real tags in near-identical pills, so a full listing showed 25
 chips of which only the first 13 were on it — and they kept their row
 even at 13/13, when nothing could be added. They were never about this
 product either; the box above takes any keyword you want to type. */}
              </div>
              </SectionCard>

              {/* What it's made on and whether it makes money — AFTER the words, because
 that is the order you fill a listing in. Splitting these across columns
 asked the reader to scan sideways for the sequence, and squeezed the
 per-size price table into a third of the page when it is the widest thing
 on it. */}
              <SectionCard title={tl("publish", "Product & pricing")} bodyClassName="space-y-4 p-4">
              <div className="space-y-1.5">
                <div className="text-sm font-medium">{tl("publish", "Base product")}</div>
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
 placeholder={tl("publish", "Pick the blank to print on")}
                />
                <p className="text-xs text-muted-foreground">
                  {tl("publish", "Sets what we produce, and the cost behind your margin.")}
                </p>
              </div>


              {blank && (pickedColors.length === 0 || (sizeOpts.length > 0 && pickedSizes.length === 0)) && (
                <p className="text-xs text-hold">
                  {tl("publish", "With none selected this publishes as a flat listing with no variants.")}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1"><span className="text-sm font-medium">{tl("publish", "Retail price ($)")}</span>
                  <Input value={retail} onChange={(e) => setRetail(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="24.00" inputMode="decimal" />
                </label>
                <label className="flex flex-col gap-1"><span className="text-sm font-medium">{tl("publish", "Quantity")}</span>
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
                  <p className="text-xs text-hold">
                    {tl("publish", "Pick a base product. Without one this publishes with no cost, no margin and no variant SKUs we recognise — the order it creates won’t price or reach the factory.")}
                  </p>
                ) : sizeRows.length > 0 ? (
                  <div className="space-y-2">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs tabular-nums">
                        <thead>
                          <tr className="text-muted-foreground">
                            {/* px-2 matters: with no horizontal padding these ran together
 as "SizeProductionShipping". */}
                            <th className="px-2 pb-1 text-left">{tl("publish", "Size")}</th>
                            <th className="px-2 pb-1 text-right">{tl("publish", "Production")}</th>
                            <th className="px-2 pb-1 text-right">{tl("publish", "Shipping")}</th>
                            <th className="px-2 pb-1 text-right">{tl("publish", "Your cost")}</th>
                            <th className="px-2 pb-1 text-right">{tl("publish", "Retail")}</th>
                            <th className="px-2 pb-1 text-right">{tl("publish", "Profit")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sizeRows.map((r) => (
                            <tr key={r.size} className="border-t border-border">
                              <td className="px-2 py-1 text-left font-medium">{r.size || tl("publish", "One size")}</td>
                              <td className="px-2 py-1 text-right">{r.unitCost == null ? "—" : usd(r.unitCost)}</td>
                              <td className="px-2 py-1 text-right">{r.shipping == null ? "—" : usd(r.shipping)}</td>
                              <td className="px-2 py-1 text-right font-medium">{r.total == null ? "—" : usd(r.total)}</td>
                              <td className="px-2 py-1 text-right">
                                <input
 value={sizeRetail[r.size] ?? ""}
 onChange={(e) => setSizeRetail((p) => ({ ...p, [r.size]: e.target.value.replace(/[^0-9.]/g, "") }))}
 placeholder={retailN > 0 ? retailN.toFixed(2) : "—"}
 inputMode="decimal"
 aria-label={`Retail price for size ${r.size || tl("publish", "one size")}`}
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
                      <p className="text-xs text-hold">{tl("publish", "Some sizes have no price set on the blank — add pricing in Products.")}</p>
                    )}
                    {retailN <= 0 && !Object.values(sizeRetail).some((v) => Number(v) > 0) && (
                      <p className="text-xs text-muted-foreground">{tl("publish", "Enter a retail price to see profit per size.")}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {tl("publish", "Retail is per size — leave a row blank to use the price above. Profit updates as you type.")}
                    </p>
                    {anyLoss && <p className="text-xs text-destructive">{tl("publish", "Sizes shown in red sell at a loss at this retail price.")}</p>}
                  </div>
                ) : quote?.unitCost == null ? (
                  <p className="text-xs text-hold">
                    {tl("publish", "That blank has no price set, so we can’t work out a margin. Add pricing to it in Products.")}
                  </p>
                ) : (
                  <dl className="space-y-2">
                    <div className="flex justify-between"><dt className="text-muted-foreground">{tl("publish", "Production")}</dt><dd className="tabular-nums">{usd(quote.unitCost)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">{tl("publish", "Shipping")}</dt><dd className="tabular-nums">{usd(quote.shipping ?? 0)}</dd></div>
                    <div className="flex justify-between border-t border-border pt-2"><dt className="text-muted-foreground">{tl("publish", "Your cost")}</dt><dd className="font-medium tabular-nums">{usd(cost ?? 0)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">{tl("publish", "Retail")}</dt><dd className="tabular-nums">{retailN > 0 ? usd(retailN) : "—"}</dd></div>
                    <div className={"flex justify-between border-t border-border pt-2 font-semibold " + (margin != null && margin < 0 ? "text-destructive" : "")}>
                      <dt>{tl("publish", "Profit / unit")}</dt>
                      <dd className="tabular-nums">
                        {margin == null ? "—" : `${usd(margin)}${marginPct != null ? ` · ${marginPct.toFixed(0)}%` : ""}`}
                      </dd>
                    </div>
                    {margin != null && margin < 0 && (
                      <p className="text-xs text-destructive">{tl("publish", "This sells at a loss — raise the retail price.")}</p>
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
              <SectionCard title={tl("publish", "Publish to")} bodyClassName="space-y-4 p-4">
              {/* WHERE THIS GOES — the seller's connected shops.
                  One shop: a sentence, no checkbox. There is no choice to make, and a
 single tick-box you must tick before publishing is ceremony.
                  Several: a row each, ticked deliberately. Two shops on the SAME platform
 are two rows that differ by name — the case the old platform toggle
 couldn't express at all. */}
              <div className="space-y-1.5">
                {dests === null ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleNotch size={12} className="animate-spin" /> {tl("publish", "Finding your shops…")}
                  </div>
                ) : destErr ? (
                  <p className="text-xs text-destructive">{destErr}</p>
                ) : dests.length === 0 ? (
                  // Not an empty picker — an empty picker looks like a broken feature.
                  <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                    {tl("publish", "No shop is connected to your account yet, so there’s nowhere to publish this. Connect one under")} <a href="/stores" className="font-medium text-primary hover:underline">{tl("publish", "Stores")}</a>.
                  </div>
                ) : dests.length === 1 ? (
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">{dests[0].shop_name}</span>
                    <span className="text-xs text-muted-foreground">· {dests[0].platform_label}</span>
                    {dests[0].dry_run && (
                      <span className="whitespace-nowrap text-2xs font-medium text-hold">{tl("publish", "dry run — nothing is sent")}</span>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {dests.map((d) => {
 const on = picked.includes(d.connection_id)
 return (
                        <label
 key={d.connection_id}
 className={"flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors " +
                            (on ? "bg-primary/5 text-primary" : "hover:bg-muted/60")}
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
                            <span className="whitespace-nowrap text-2xs font-medium text-hold">{tl("publish", "dry run")}</span>
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

              {/* DRAFT OR LIVE — asked once, for every shop ticked above.
                  Two radio rows rather than a "publish live" checkbox: a checkbox states one
 option and leaves the other implied, and the implied one here is the one
 that puts a product in front of buyers. Both outcomes are written down, and
 the sentence under each says what actually happens rather than what it is
 called, because "draft" means a slightly different thing in each of the
 three admins this can reach. */}
              {dests !== null && dests.length > 0 && (
                <div className="space-y-1">
                  <span className="eg-label text-muted-foreground">{tl("publish", "When it’s created")}</span>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {[
                      { live: false, label: tl("publish", "Save as draft") },
                      { live: true, label: tl("publish", "Publish live") },
                    ].map((o) => (
                      <label
 key={o.label}
                        /* ONLY THE CHOSEN ONE IS DRAWN.
                           Both cards carried a border, so the unpicked one was outlined in
                           `--border` — a warm taupe from the base palette — sitting directly
 beside a periwinkle-tinted card. Two lines in two unrelated hues,
 a centimetre apart, which is what reads as muddy: the eye sees a
 colour decision where none was made.
                           A ring rather than a border on the selected one, so the two states
 are the same size and nothing shifts by a pixel when you switch. */
                        /* THE PANEL IS THE CONTROL. No dot, no sentence under it — the two
 labels already say the whole difference, and a radio beside a
 tinted panel states the same fact twice.
                           The input stays, visually hidden: it is what makes this a real
 radio group for the keyboard and a screen reader, and the ring
 follows its focus so tabbing is still visible. */
 className={"flex cursor-pointer items-center justify-center rounded-lg px-2.5 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring " +
                          (goLive === o.live ? "bg-primary/5 ring-1 ring-primary/60" : "hover:bg-muted/60")}
                      >
                        <input
 type="radio"
 name="publish-state"
 checked={goLive === o.live}
 onChange={() => { setResult(null); setGoLive(o.live) }}
 className="sr-only"
                        />
                        <span className={"font-medium " + (goLive === o.live ? "text-primary" : "text-foreground")}>{o.label}</span>
                      </label>
                    ))}
                  </div>
                  {/* Etsy is the one that can say yes to the button and no to the listing, and
 it is worth saying so BEFORE the publish rather than only in the outcome:
                      Etsy will not take a listing live without a photo, and photos are uploaded
 after the listing exists. */}
                  {goLive && pickedDests.some((d) => d.platform === "etsy") && (
                    <p className="text-2xs text-muted-foreground">
                      {tl("publish", "Etsy activates after the photos upload — if it refuses, the listing stays a draft and we’ll say why.")}
                    </p>
                  )}
                </div>
              )}

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
                  <span className="eg-label text-muted-foreground">{tl("publish", "Method")}</span>
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className="eg-select eg-control pr-8">
                    {methodOpts.length === 0 && <option value="">{tl("publish", "Any")}</option>}
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
 label={tl("publish", "Colours")}
 options={colorOpts}
 picked={pickedColors}
 onChange={setPickedColors}
 render={prettyColorName}
                />
              )}

              {blank && sizeOpts.length > 0 && (
                <VariantChips
 label={tl("publish", "Sizes")}
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
                <div className="divide-y divide-border/60 rounded-lg border border-border bg-muted/30 px-3 py-1">
                  {pickedDests.map((d) => <OutcomeLine key={d.connection_id} dest={d} outcome={outcomes[d.connection_id]} />)}
                </div>
              )}

              {/* Named brands in the copy — see tmHits. Sits directly above the publish
 button because that is the last moment it can change anything. */}
              {tmHits.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">
                  <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
                  <span>
                    <strong>{tmHits.length === 1 ? tl("publish", "A brand name is") : `${tmHits.length} brand names are`}</strong>{" "}
 in this listing&apos;s text: {tmHits.slice(0, 8).join(", ")}
                    {tmHits.length > 8 && ` +${tmHits.length - 8} more`}. Marketplaces remove listings that
 use a brand they don&apos;t license, and repeats put the shop itself at risk. Edit the
 title, description and tags above if you aren&apos;t entitled to use them — publishing is
 not blocked, because plenty of these are legitimate.
                  </span>
                </div>
              )}

              {/* IP warning — only for the competitor's OWN photos, and only until the
 seller acknowledges it. Publishing someone else's images to your shop can
 get a listing pulled and, repeated, put the shop at risk. */}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={leave}>{tl("publish", "Cancel")}</Button>
                {/* The label says what will actually happen. "Publish draft" over four ticked
 shops understates it, and after a partial failure the button's job has
 changed to retrying only what failed — which the label has to admit, or
 it reads as "publish everything again" and nobody presses it. */}
                {/* ONE WORD, AND A GUARD.
                    The shops are ticked directly above, so "to 3 shops" repeated a list the
 eye had just read, and the shop glyph decorated a button whose position
 and colour already say what it is.
                    What the label MUST still carry is the difference between a first send and
 a second one: publishing again over shops that already took the listing
 creates a DUPLICATE in each of them, and that is not something to discover
 afterwards. So the word changes with the state — Retry after a partial
 failure, Reupload once anything has gone out. */}
                <Button onClick={publish} disabled={busy || !dests?.length}>
                  {busy && <CircleNotch size={15} className="animate-spin" />}
                  {anyFailed ? tl("publish", "Retry") : anyPublished ? tl("publish", "Reupload") : tl("publish", "Publish")}
                </Button>
              </div>
              {/* THE STANDING PARAGRAPH IS GONE.
                  Four sentences of documentation sat under the button on every visit, and
 three of them described conditions that were not happening — Etsy's profile
 reuse and Shopify's connect-time scopes are facts you need WHEN a publish
 refuses for that reason, and the refusal now says so on its own line in the
 results list above. The button already says what it will do. Permanent prose
 explaining a control is what you write instead of a control that explains
 itself, and it was pushing the results off the bottom of the rail.

                  The dry-run note stays, because it is the one line that is true BEFORE the
 press and changes what the press means. */}
              {pickedDests.some((d) => d.dry_run) && (
                <p className="text-xs text-muted-foreground">
                  {tl("publish", "One shop is in dry-run mode: it will be validated and nothing will be sent.")}
                </p>
              )}
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
            {zoom?.which === "own"
              ? `Photo ${(zoom.index ?? 0) + 1} of ${images.length}${zoom.index === 0 ? tl("publish", " — the cover photo") : ""}`
 : `Reference photo ${(zoom?.index ?? 0) + 1} of ${referencePhotos.length} — the competitor’s own shot, not published with your listing`}
          </DialogTitle>
          <div className="relative flex max-h-[72dvh] justify-center overflow-hidden rounded-lg bg-muted/40">
            {zoomSrc && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={zoomSrc} alt="" className="max-h-[72dvh] w-auto max-w-full object-contain" />
                {/* The mark survives the zoom, or the zoom is simply the way to get a clean
 copy of someone else's photo. Ours carries none — it is ours. */}
                {zoom?.which === "ref" && !staffViewer && <ReferenceWatermark big />}
              </>
            )}
          </div>
          {zoomList.length > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setZoom((z) => (z ? { ...z, index: (z.index - 1 + zoomList.length) % zoomList.length } : z))}>
                <CaretLeft size={13} weight="bold" /> {tl("publish", "Prev")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setZoom((z) => (z ? { ...z, index: (z.index + 1) % zoomList.length } : z))}>
                {tl("publish", "Next")} <CaretRight size={13} weight="bold" />
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

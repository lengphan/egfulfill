"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useEntitlements } from "@/lib/entitlements"
import Link from "next/link"
import { MagnifyingGlass, MagnifyingGlassPlus, Binoculars, CaretLeft, CaretRight, PencilSimple, LockSimple, Check, TrendUp, Heart, Warning, SlidersHorizontal, CheckCircle, Storefront, Shuffle, ArrowsClockwise, CircleNotch, Package, Trash, User as UserIcon } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { CARD_ACTION_PRIMARY, CARD_ACTION_SECONDARY, CARD_ACTION_ICON } from "@/lib/card-actions"
import { searchEtsy, getSpydeckSaves, saveSpydeckListing, unsaveSpydeckListing, getSpydeckTrending, rebuildSpydeckTrending, getEtsyCategories, getSpydeckUploads, deleteSpydeckUpload, ApiError, type EtsyListing, type SavedListing, type UploadedListing, type EtsyCategory, getSpydeckListingDetail, getEtsyListingImages, getCatalogProducts, type CatalogProduct } from "@/lib/api"
import { getSpydeckConfig } from "@/lib/plans"
import { getUser } from "@/lib/auth"
import { loadNavVisibility, isSurfaceHidden } from "@/lib/nav-visibility"
import { StoresTab } from "@/components/app/spydeck-stores"
import { detectTrademarks } from "@/lib/trademarks"
import { useRouter } from "next/navigation"
import { stashPublishDraft } from "@/lib/publish-draft"
import { SourcingSuggestDialog } from "@/components/app/sourcing-suggest-dialog"
import { usePaged, Pagination } from "@/components/app/pagination"
import { ShopAnalyzer } from "@/components/app/shop-analyzer"

// One currency, so listings are actually comparable. Etsy returns each listing in the
// SHOP's currency, which mixed "$39.00" with "MYR 111.00" in the same grid. The server
// converts to USD (fx.js, rates cached 12h) and marks what it converted.
//
// A converted price is prefixed "~" and keeps the original in its tooltip — relabelling
// MYR 111 as $111 would overstate it ~4x, so an approximation is shown as one. When no
// rate was available price_usd is null and we fall back to the real foreign amount
// rather than inventing a dollar figure.
const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const money = (n: number | null, cur = "USD", usdPrice?: number | null, converted?: boolean) => {
  if (usdPrice != null) return converted ? `~${usd(usdPrice)}` : usd(usdPrice)
  if (n == null) return "—"
  const code = (cur || "USD").toUpperCase()
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  } catch {
    return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`
  }
}
/**
 * What a buyer can actually pay. A listing's headline `price` is one figure, but
 * variations override it — a necklace listed at 38 can sell 19–30 across lengths, so the
 * single number is both wrong and hides that a range exists at all. Shows a range when
 * the variations differ, and falls back to the single price when they don't.
 */
const priceLabel = (l: EtsyListing) => {
  // The range arrives in the SHOP's currency, same as `price`. Applying the rate the
  // server already derived (price_usd / price) keeps the range in the same unit as the
  // single-price fallback — otherwise a MYR range would render with a $ sign.
  const rate = l.price_converted && l.price ? (Number(l.price_usd) || 0) / Number(l.price) : 1
  const conv = (v: number) => v * (isFinite(rate) && rate > 0 ? rate : 1)
  const pre = l.price_converted ? "~" : ""
  const lo = l.price_min, hi = l.price_max
  if (lo != null && hi != null && hi - lo > 0.005) return `${pre}${usd(conv(lo))}–${usd(conv(hi))}`
  if (lo != null) return `${pre}${usd(conv(lo))}`
  return money(l.price, l.currency, l.price_usd, l.price_converted)
}

const origPrice = (n: number | null, cur?: string) =>
  n == null ? undefined : `Listed at ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${(cur || "USD").toUpperCase()}`

// Compact number/money (1,240 → 1.2K) — ported from eg-scout.js (_fmt / _money).
const fmtK = (n: number) => {
  n = Math.round(n || 0)
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K"
  return String(n)
}
const moneyK = (n: number) => "$" + fmtK(n).replace("$", "")

// SpyDeck estimates — ported VERBATIM from eg-scout.js `_est()`. Etsy's API doesn't
// expose views/sold/revenue, so these four are ESTIMATES derived from favorites +
// listing age. Signals, not exact figures.
function estFor(l: EtsyListing) {
  const fav = l.num_favorers || 0
  const price = l.price != null ? Number(l.price) : 0
  const created = l.created || 0
  const nowS = Date.now() / 1000
  const ageDays = created ? Math.max(1, (nowS - created) / 86400) : 45
  const totalSold = Math.round(fav * 3.5) || fav
  const perDay = totalSold / ageDays
  const sold24 = Math.max(0, Math.round(perDay))
  const views24 = Math.max(sold24, Math.round(perDay * 36 + (fav / ageDays) * 10))
  const revenue = Math.round(totalSold * price)
  const vel = fav / ageDays
  const trending = (ageDays <= 30 && vel >= 1.2) || vel >= 6
  return { totalSold, sold24, views24, revenue, trending }
}

// A labelled stat box — bold value on top, small label + time-window below.
function StatBox({ label, sub, value }: { label: string; sub?: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-2 text-center leading-none">
      <div className="truncate text-base font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-3xs font-medium text-muted-foreground">
        {label}{sub ? <span className="text-muted-foreground/60"> · {sub}</span> : null}
      </div>
    </div>
  )
}

// ── The Uploaded card ────────────────────────────────────────────────────────────────
//
// Deliberately NOT a ResultCard. Saved and Uploaded were rendering the identical tile,
// which made the tab read as a second copy of the research grid — and worse, it was the
// research grid: title, price, photo and stats all came from the COMPETITOR listing,
// because that's the only thing the upload row stored. A seller who had just picked a
// blank, three colours and four sizes saw none of it.
//
// Past the choosing stage the question changes from "is this worth copying?" to "what did
// I ship, and what state is it in?". So this card answers that instead: our cover photo,
// our title and price, the draft/active state, the blank it's made from, and how many
// variants and photos actually landed.
//
// The competitor's `views`/`num_favorers`/revenue estimates are still on the row and are
// deliberately NOT rendered here. They're someone else's sales; under our title they'd
// read as ours. The source is reachable as a labelled link and nothing more.
const UploadedCard = memo(function UploadedCard({ l, onRemove, onEdit }: { l: UploadedListing; onRemove?: (l: UploadedListing) => void; onEdit?: (l: UploadedListing, images: string[]) => void }) {
  // "What did I actually upload?" is a question the 300px tile can't answer — the cover is
  // cropped square and scaled down, so a misplaced design or the wrong file looks fine.
  const [zoom, setZoom] = useState(false)
  /**
   * THE WHOLE PHOTO SET, not just the cover.
   *
   * The record stores one image and a count, so this dialog could say "Photos 2" while
   * showing one — asserting there was more and then not showing it. Fetched on open (never
   * with the grid: that would be one Etsy call per tile), and only for our own listings.
   */
  const [shots, setShots] = useState<string[] | null>(null)
  const [shot, setShot] = useState(0)
  const p = l.published
  // published_listings (joined server-side) is authoritative for the build spec — it was
  // written by the publish route itself, so it survives rows the dialog never described.
  const blankSku = l.product?.blank_sku || p?.blank_sku
  const printType = l.product?.print_type || p?.print_type
  const platform = (p?.platform || l.product?.platform || "etsy") as string
  /**
   * OUR picture, in the order it can be trusted.
   *
   * `submitted.cover_thumb` is the ~8KB WebP kept at publish — ours, instant, and still
   * there when the marketplace draft is deleted. Then the published cover. `l.thumb`/
   * `l.image` are the COMPETITOR's photos and come last: they are the wrong picture for a
   * card about what WE published, and were only ever a stand-in for having none.
   */
  const cover = l.submitted?.cover_thumb || l.submitted?.images?.[0] || p?.image || l.thumb || l.image
  const [shotsErr, setShotsErr] = useState<string | null>(null)
  /**
   * Fetch once per open, and only for OUR listing. `our_listing_id` is the id on our shop;
   * `listing_id` is the competitor's, and asking Etsy for that one's images would both fail
   * the ownership check and be the wrong photos entirely.
   */
  const ourId = l.our_listing_id ?? p?.listing_id
  useEffect(() => {
    if (!zoom || shots !== null || !ourId) return
    const t = setTimeout(() => {
      getEtsyListingImages(String(ourId))
        .then((r) => {
          if (r.error) { setShots([]); setShotsErr(r.error); return }
          setShots(r.images ?? [])
          // A record that claims more photos than Etsy returns is worth saying out loud —
          // it means an upload silently failed, which is exactly what this dialog is for.
          const n = r.images?.length ?? 0
          if (p?.images_uploaded != null && n < p.images_uploaded) {
            setShotsErr(`The record says ${p.images_uploaded} photos, Etsy has ${n}.`)
          }
        })
        .catch(() => { setShots([]); setShotsErr("Couldn't read the listing's photos from Etsy.") })
    }, 0)
    return () => clearTimeout(t)
  }, [zoom, shots, ourId, p?.images_uploaded])
  /** What the carousel shows: the live set when we have it, else the stored cover — so the
   *  dialog is never empty while the fetch is in flight. */
  const gallery = (shots && shots.length ? shots : cover ? [cover] : []) as string[]
  const title = p?.title || l.title
  const state = (p?.state || "draft").toLowerCase()
  const live = state === "active"
  const colors = p?.colors ?? (l.product?.color ? [l.product.color] : [])
  const sizes = p?.sizes ?? (l.product?.size ? [l.product.size] : [])
  const nVariants = p?.variants_applied ?? (p?.variant_skus?.length || 0)
  // A row written before the publish dialog carried its result. Say that, rather than
  // filling the gaps with the source listing's numbers and letting them pass for ours.
  const thin = !p && !l.product

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="relative aspect-square overflow-hidden bg-muted/40">
        {cover ? (
          // The whole cover is the target — a small zoom affordance in a corner is a thing
          // you have to find. The magnifier appears on hover to say the click does something.
          <button
            type="button" onClick={() => setZoom(true)}
            className="group/img absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            title="See the full image and what was published"
            aria-label="See the full published image"
          >
            <Image src={cover} alt={title} fill unoptimized sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw" className="object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover/img:bg-black/25 group-hover/img:opacity-100">
              <span className="rounded-full bg-white/90 p-2 text-neutral-900"><MagnifyingGlassPlus size={18} weight="bold" /></span>
            </span>
          </button>
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground"><Package size={22} weight="duotone" /></div>
        )}
        {/* State, not a "trending" flag — the one thing you open this tab to check. Every
            publish lands as a DRAFT; the seller activates it on the marketplace. */}
        <span className={
          "absolute left-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-3xs font-bold uppercase tracking-wide text-white shadow-sm " +
          (live ? "bg-emerald-600" : "bg-amber-500")
        }>
          {live ? <><CheckCircle size={11} weight="fill" /> Live</> : <>Draft</>}
        </span>
        <span className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-3xs font-bold uppercase tracking-wide text-white backdrop-blur">
          {platform}
        </span>
        {p?.price != null && p.price > 0 && (
          <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-1 text-sm font-bold tabular-nums text-white backdrop-blur">
            ${p.price.toFixed(2)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <div className="line-clamp-2 text-sm font-medium leading-snug">{title}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {l.uploaded_at ? `Published ${new Date(l.uploaded_at).toLocaleDateString()}` : "Published"}
          {blankSku ? <> · <span className="font-medium text-foreground/70">{blankSku}</span></> : null}
          {printType ? ` · ${printType}` : null}
        </div>

        {thin ? (
          // Not "no variants" — unknown. A card that renders a confident 0 for something it
          // never recorded is the empty state that looks like a working one.
          <div className="mt-2.5 rounded-lg border border-dashed border-border px-2 py-2 text-3xs leading-relaxed text-muted-foreground">
            Published before this tab recorded build details — the blank and variants aren&apos;t stored for this one. Open it on {platform} to see what listed.
          </div>
        ) : (
          <>
            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              <StatBox label="Variants" value={String(nVariants)} />
              <StatBox label="Colours" value={String(colors.length)} />
              <StatBox label="Sizes" value={String(sizes.length)} />
            </div>
            {p?.images_uploaded != null && (
              <div className="mt-1.5 text-3xs text-muted-foreground">
                {p.images_uploaded} photo{p.images_uploaded === 1 ? "" : "s"} uploaded
              </div>
            )}
            {(colors.length > 0 || sizes.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {[...colors, ...sizes].slice(0, 8).map((v) => (
                  <span key={v} className="rounded bg-muted px-1.5 py-0.5 text-3xs leading-tight text-muted-foreground">{v}</span>
                ))}
                {colors.length + sizes.length > 8 && (
                  <span className="rounded px-1 py-0.5 text-3xs leading-tight text-muted-foreground/70">+{colors.length + sizes.length - 8}</span>
                )}
              </div>
            )}
            {/* The publish succeeded but the inventory PUT didn't — a flat listing wearing a
                success badge is exactly the thing worth saying out loud. */}
            {p?.variants_error && (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-3xs leading-relaxed text-amber-700 dark:text-amber-400">
                <Warning size={12} weight="fill" className="mt-px shrink-0" />
                <span>Listed flat — variants were rejected: {p.variants_error}</span>
              </div>
            )}
          </>
        )}

        {/* WHO SENT IT, AND WHEN — the two questions a history is for.
            Only shown when the server named someone, which it does on the staff-wide list.
            A seller reading their own uploads knows who published them; an admin looking at
            everyone's cannot tell without this, and the name was recorded from the very
            first row and surfaced nowhere. */}
        {(l.by_name || l.uploaded_at) && (
          <div className="mt-2 flex items-center gap-1.5 truncate text-3xs text-muted-foreground">
            {l.by_name && (
              <>
                <UserIcon size={11} weight="bold" className="shrink-0 opacity-70" />
                <span className="truncate" title={l.by_role ? `${l.by_name} · ${l.by_role}` : l.by_name}>{l.by_name}</span>
              </>
            )}
            {l.by_name && l.uploaded_at && <span className="opacity-50">·</span>}
            {l.uploaded_at && (
              <span className="shrink-0" title={new Date(l.uploaded_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}>
                {new Date(l.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto flex gap-1.5 pt-3">
          {/* EDIT, not "Open listing".
              ─────────────────────────
              What we publish is a DRAFT — it sits on Etsy until the seller finishes it or
              activates it — so a link out to it was the least useful thing this card could
              offer: you land on Etsy's own form with none of the blank, variants or artwork
              we hold. The useful action is to fix what we sent and send it again, which is
              this dialog re-opened with everything already in it.

              The link out isn't lost; it lives in the review dialog behind the cover, which
              is where you go once you actually want the marketplace's copy. Keeping both
              here would be a third button on a row that is already tight. */}
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(l, gallery)}
              title="Reopen the publish window with this listing's blank, variants, artwork and photos"
              className={cn(CARD_ACTION_PRIMARY, "flex-1")}
            >
              <PencilSimple size={13} weight="bold" /> Edit listing
            </button>
          ) : l.our_url ? (
            <a href={l.our_url} target="_blank" rel="noopener noreferrer" className={cn(CARD_ACTION_PRIMARY, "flex-1")}>
              <Storefront size={13} weight="bold" /> Open listing
            </a>
          ) : (
            <span className={cn(CARD_ACTION_SECONDARY, "flex-1 cursor-default opacity-60")} title="No listing URL was returned when this was published.">
              No link stored
            </span>
          )}
          {/* Labelled "Source", never presented as ours. */}
          {l.url && (
            <a href={l.url} target="_blank" rel="noopener noreferrer" title="The competitor listing this was built from"
               className={cn(CARD_ACTION_SECONDARY, "flex-1")}>
              Source
            </a>
          )}
          {onRemove && (
            <button
              type="button" onClick={() => onRemove(l)} aria-label="Remove from Uploaded"
              title="Forget this record. The listing stays on the marketplace."
              className={cn(CARD_ACTION_ICON, "text-muted-foreground hover:border-destructive/40 hover:text-destructive")}
            >
              <Trash size={13} weight="bold" />
            </button>
          )}
        </div>
      </div>

      {/* The published photos, uncropped, beside what they were published AS. The tile shows
          a square crop, so this is the only place the actual artwork can be checked. */}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader><DialogTitle className="pr-6 text-base leading-snug">{title}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_13rem]">
            {/* object-contain, not cover: a crop is exactly what this view exists to undo. */}
            <div className="space-y-2">
              <div className="relative flex min-h-[16rem] items-center justify-center overflow-hidden rounded-xl bg-muted/40">
                {gallery.length > 0
                  ? <Image src={gallery[Math.min(shot, gallery.length - 1)]} alt={title} width={1200} height={1200} unoptimized className="h-auto max-h-[70vh] w-full object-contain" />
                  : <span className="p-10 text-sm text-muted-foreground">No image was stored for this publish.</span>}
                {/* Arrows only when there is somewhere to go. A pair of dead chevrons on a
                    one-photo listing is worse than none. */}
                {gallery.length > 1 && (
                  <>
                    <button type="button" aria-label="Previous photo"
                      onClick={() => setShot((i) => (i - 1 + gallery.length) % gallery.length)}
                      className="eg-tap absolute left-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground shadow-sm transition-colors hover:bg-background">
                      <CaretLeft size={14} weight="bold" />
                    </button>
                    <button type="button" aria-label="Next photo"
                      onClick={() => setShot((i) => (i + 1) % gallery.length)}
                      className="eg-tap absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground shadow-sm transition-colors hover:bg-background">
                      <CaretRight size={14} weight="bold" />
                    </button>
                    <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-2xs font-medium text-white">
                      {Math.min(shot, gallery.length - 1) + 1} / {gallery.length}
                    </span>
                  </>
                )}
              </div>
              {/* Thumbnails, because a count plus arrows still doesn't let you get to photo
                  four in one move — and checking the set is the whole reason to be here. */}
              {gallery.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {gallery.map((src, i) => (
                    <button key={src + i} type="button" onClick={() => setShot(i)} aria-label={`Photo ${i + 1}`}
                      className={"eg-tap size-12 overflow-hidden rounded-lg border-2 transition-colors " + (i === Math.min(shot, gallery.length - 1) ? "border-primary" : "border-transparent hover:border-border")}>
                      <Image src={src} alt="" width={96} height={96} unoptimized className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              {/* Says which of the two facts you're looking at. A record claiming two photos
                  while Etsy returns one is worth seeing, not smoothing over. */}
              {shotsErr && <p className="text-2xs text-amber-700 dark:text-amber-400">{shotsErr}</p>}
            </div>
            <dl className="space-y-2 text-sm">
              <Spec k="Status" v={live ? "Live" : "Draft"} />
              <Spec k="Channel" v={platform} />
              {p?.price != null && p.price > 0 && <Spec k="Price" v={`$${p.price.toFixed(2)}`} />}
              {blankSku && <Spec k="Blank" v={blankSku} />}
              {printType && <Spec k="Print" v={printType} />}
              {colors.length > 0 && <Spec k="Colours" v={colors.join(", ")} />}
              {sizes.length > 0 && <Spec k="Sizes" v={sizes.join(", ")} />}
              {p?.images_uploaded != null && <Spec k="Photos" v={String(p.images_uploaded)} />}
              {l.uploaded_at && <Spec k="Published" v={new Date(l.uploaded_at).toLocaleString()} />}
              {l.our_url && (
                <a href={l.our_url} target="_blank" rel="noopener noreferrer" className="mt-3 block text-sm font-medium text-primary hover:underline">
                  Open on {platform} →
                </a>
              )}
            </dl>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
})

/** One label/value line in the published-image dialog. */
function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{k}</dt>
      <dd className="truncate text-right text-sm font-medium" title={v}>{v}</dd>
    </div>
  )
}

// One research card — image (price + TRENDING overlay) + heart-to-save + estimate
// stat boxes + the listing's up-to-13 keyword tags (clickable to research + copy all).
// Memoised: the trending grid re-renders on every keystroke/filter/save, and each card ran
// estFor() + detectTrademarks() (a regex over ~40 brands) on every one of those. With stable
// callbacks from the parent, memo means a card only re-renders when ITS own data changes.
export const ResultCard = memo(function ResultCard({ l, saved, uploaded, onToggleSave, onSearchTag, onMakeProduct, onOpenShop, onSource }: { l: EtsyListing; saved: boolean; uploaded?: boolean; onToggleSave: (l: EtsyListing, wasSaved: boolean) => void; onSearchTag: (t: string) => void; onMakeProduct: (l: EtsyListing) => void; onOpenShop?: (l: EtsyListing) => void; onSource?: (l: EtsyListing) => void }) {
  const e = estFor(l)
  const trending = e.trending
  const tags = (l.tags ?? []).slice(0, 13)
  // Keyed on the listing only, so toggling the save heart doesn't re-run the brand regex.
  const tmHits = useMemo(() => detectTrademarks(`${l.title} ${(l.tags ?? []).join(" ")}`), [l.title, l.tags])
  const [copied, setCopied] = useState(false)
  const copyAll = async () => {
    try { await navigator.clipboard.writeText(tags.join(", ")); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={(ev) => { ev.preventDefault(); onToggleSave(l, saved) }}
        aria-label={saved ? "Remove from saved" : "Save listing"}
        aria-pressed={saved}
        className={
          "absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full backdrop-blur transition-colors " +
          (saved ? "bg-rose-600 text-white" : "bg-black/45 text-white hover:bg-black/65")
        }
      >
        <Heart size={15} weight={saved ? "fill" : "regular"} />
      </button>
      <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
        <div className="relative aspect-square overflow-hidden bg-muted/40">
          {/* thumb is Etsy's 300x300; `image` is 570px and is what the publish flow uses.
              The card renders ~300px wide, so serving 570px was ~3.6x the pixels needed on
              every one of 24 tiles. `sizes` keeps it honest if optimisation is ever enabled
              (needs i.etsystatic.com in next.config remotePatterns). */}
          {l.image ? (
            <Image src={l.thumb || l.image} alt={l.title} fill unoptimized sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground"><Binoculars size={22} weight="duotone" /></div>
          )}
          {trending && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-3xs font-bold uppercase tracking-wide text-white shadow-sm">
              <TrendUp size={11} weight="bold" /> Trending
            </span>
          )}
          {/* Price — always visible on the image, out of the stats. */}
          <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-1 text-sm font-bold tabular-nums text-white backdrop-blur">
            <span title={l.price_converted ? origPrice(l.price, l.currency) : undefined}>{priceLabel(l)}</span>
          </span>
          {/* Trademark heads-up — static keyword match, not legal advice.
              OVERLAID on the image, deliberately: as a row in the card body it added its own
              height, so the handful of flagged listings made their tiles taller than the rest
              and the whole grid went ragged. A warning shouldn't reflow the page it warns
              about. Sits opposite the price, truncated to one line, with the full list of
              matches in the tooltip. */}
          {tmHits.length > 0 && (
            <span
              className="absolute bottom-2 right-2 inline-flex max-w-[62%] items-center gap-1 rounded-md bg-amber-500/90 px-1.5 py-1 text-3xs font-bold uppercase tracking-wide text-white backdrop-blur"
              title={`Possible trademark: ${tmHits.join(", ")} — heuristic check, not legal advice. A listing mentioning a known brand may risk takedown; verify before copying the idea.`}
            >
              <Warning size={11} weight="fill" className="shrink-0" />
              <span className="truncate">{tmHits[0]}{tmHits.length > 1 ? ` +${tmHits.length - 1}` : ""}</span>
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-3">
          <div className="line-clamp-2 text-sm font-medium leading-snug">{l.title}</div>
          {/* Shop name → jump into that shop's full catalog (discover shops via their hot
              products, not just by searching a name). */}
          {l.shop_name && onOpenShop && l.shop_id ? (
            <button type="button" onClick={() => onOpenShop(l)} title={`See ${l.shop_name}'s shop`}
              className="mt-1 flex max-w-full items-center gap-1 truncate text-left text-xs font-medium text-muted-foreground transition-colors hover:text-primary hover:underline">
              <Storefront size={11} weight="duotone" className="shrink-0" />
              <span className="truncate">{l.shop_name}</span>
            </button>
          ) : (
            <div className="mt-1 truncate text-xs text-muted-foreground">{l.shop_name || "—"}</div>
          )}

          {/* Estimate boxes — Views/Sold (24h) + Revenue/Sold (all time). */}
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <StatBox label="Views" sub="24h" value={fmtK(e.views24)} />
            <StatBox label="Sold" sub="24h" value={fmtK(e.sold24)} />
            <StatBox label="Revenue" sub="all time" value={moneyK(e.revenue)} />
            <StatBox label="Sold" sub="all time" value={fmtK(e.totalSold)} />
          </div>

          {/* Keyword tags (up to 13) — click to research the term, or copy them all. */}
          {tags.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">{tags.length} keywords</span>
                <button type="button" onClick={(ev) => { ev.preventDefault(); copyAll() }} className="text-3xs font-medium text-primary hover:underline">
                  {copied ? "Copied!" : "Copy all"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={(ev) => { ev.preventDefault(); onSearchTag(t) }}
                    title={`Research "${t}"`}
                    className="rounded bg-muted px-1.5 py-0.5 text-3xs leading-tight text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pinned to the card bottom so cards with more keywords don't misalign the button row.
              CARD_ACTION_* — the same box as every other card's action pair. These were
              hand-rolled (rounded-full + py-1.5, no height) so they sat at a different height
              from the h-7 pills on the sourcing cards, and the pair itself didn't match: a
              tinted violet block beside a solid grey one reads as two unrelated controls
              rather than a primary and its alternative. */}
          <div className="mt-auto flex gap-1.5 pt-3">
            <button
              type="button"
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onMakeProduct(l) }}
              className={uploaded
                ? cn(CARD_ACTION_SECONDARY, "flex-1 border-emerald-600/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400")
                : cn(CARD_ACTION_PRIMARY, "flex-1")}
            >
              {uploaded ? <><CheckCircle size={13} weight="fill" /> Uploaded</> : <><Storefront size={13} weight="bold" /> Make product</>}
            </button>
            {/* Sourcing is admin-only server-side, so the button only exists for an admin —
                anyone else would be clicking a control that always 403s. */}
            {onSource && (
              <button
                type="button"
                title="Work out what this is and how to search for it on a B2B marketplace"
                onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onSource(l) }}
                className={cn(CARD_ACTION_SECONDARY, "flex-1")}
              >
                Suppliers
              </button>
            )}
          </div>
        </div>
      </a>
    </div>
  )
})

/**
 * HOW DEEP A SEARCH GOES, and why these numbers.
 *
 * 100 is Etsy's per-call maximum for findAllListingsActive, so PAGE_SIZE is the most
 * results per request that exists — anything smaller just costs more calls for the same
 * depth. Four pages total (one + three) is 400 listings, which is deep enough that
 * "embroidered" stops claiming to be one page and shallow enough to stay well inside the
 * keystring's DAILY budget: our app key is shared by every seller, and order sync depends
 * on the same allowance a research grid would spend.
 *
 * The server clamps both independently, so these are a request, not a guarantee.
 */
/**
 * SORTS ETSY CANNOT DO, done here.
 *
 * Etsy ranks by relevance, date and price. None of those answer the question this tool
 * exists for — "which of these is actually SELLING" — so with 400 results the depth just
 * moved the problem: you no longer run out of listings, you drown in them.
 *
 * These two re-rank what has already been fetched, using the same estimate the cards print
 * (estFor: favourites x 3.5 over listing age). No extra Etsy call, and switching to one is
 * instant because the data is already here.
 *
 * THEY RANK THE FETCHED SET, NOT ETSY. Four pages of relevance is the pool being sorted, so
 * this is "the best sellers among the most relevant 400", which is a real answer to a real
 * question — but it is NOT "the best sellers on Etsy", and the label says Est. because the
 * numbers are a model, not reported figures.
 */
const CLIENT_SORTS: Record<string, (l: EtsyListing) => number> = {
  best: (l) => estFor(l).sold24,
  revenue: (l) => estFor(l).revenue,
}

const PAGE_SIZE = 100
const EXTRA_PAGES = 3

// Curated popular POD niches for the discovery cloud (before a search). Weight = heat.
const SEED_NICHES: { text: string; weight: number }[] = [
  { text: "custom name necklace", weight: 10 }, { text: "comfort colors tee", weight: 10 },
  { text: "mama sweatshirt", weight: 9 }, { text: "retro groovy", weight: 9 },
  { text: "birth flower", weight: 8 }, { text: "pet portrait", weight: 8 },
  { text: "personalized gift", weight: 8 }, { text: "bachelorette", weight: 7 },
  { text: "teacher gift", weight: 7 }, { text: "vintage aesthetic", weight: 6 },
  { text: "embroidered crewneck", weight: 6 }, { text: "coquette", weight: 6 },
  { text: "y2k", weight: 5 }, { text: "cottagecore", weight: 5 },
  { text: "boho wall art", weight: 5 }, { text: "minimalist jewelry", weight: 5 },
  { text: "monogram", weight: 4 }, { text: "funny shirt", weight: 4 },
  { text: "wedding gift", weight: 4 }, { text: "in my era", weight: 4 },
  { text: "christmas", weight: 3 }, { text: "halloween", weight: 3 },
  { text: "custom pet", weight: 3 }, { text: "trendy", weight: 3 },
]

// One labelled filter control.
function FilterField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs font-medium text-muted-foreground">{label}{hint ? <span className="text-muted-foreground/60"> · {hint}</span> : null}</span>
      {children}
    </label>
  )
}

// Interactive keyword/niche cloud — hotter terms render bigger; click to research.
function KeywordCloud({ words, onPick }: { words: { text: string; weight: number }[]; onPick: (t: string) => void }) {
  const weights = words.map((w) => w.weight)
  const max = Math.max(...weights, 1)
  const min = Math.min(...weights, 0)
  const norm = (w: number) => (max === min ? 0.5 : (w - min) / (max - min))
  const sizeOf = (w: number) => 12 + norm(w) * 17 // 12–29px
  const toneOf = (w: number) => {
    const t = norm(w)
    if (t > 0.72) return "text-primary font-bold"
    if (t > 0.42) return "text-foreground font-semibold"
    return "text-muted-foreground font-medium"
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 p-5">
      {words.map((w) => (
        <button
          key={w.text}
          onClick={() => onPick(w.text)}
          style={{ fontSize: sizeOf(w.weight) }}
          title={`Research "${w.text}"`}
          className={"cursor-pointer leading-none transition-all duration-150 hover:scale-110 hover:text-primary " + toneOf(w.weight)}
        >
          {w.text}
        </button>
      ))}
    </div>
  )
}

export function SpyDeckView() {
  // Plan gate: SpyDeck is a paid add-on (bundled-free on Pro/Enterprise). Assume
  // entitled until we can read localStorage after mount, then re-check on plan change.
  // Entitlement is resolved SERVER-side (useEntitlements) because a team member inherits
  // their leader's plan and the cached session can't know that. `checked` gates the
  // paywall so it never flashes before the answer arrives.
  const { spydeck: entitled } = useEntitlements()
  const [checked, setChecked] = useState(false)
  useEffect(() => { const id = setTimeout(() => setChecked(true), 0); return () => clearTimeout(id) }, [])

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<EtsyListing[] | null>(null)
  const [loading, setLoading] = useState(false)
  // Separate from `loading`: the grid already has results on screen while this is true,
  // so it must read as "more coming" and never as "still searching" — a spinner over a
  // full grid says the results you are looking at are not real yet.
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState("")
  const [view, setView] = useState<"trending" | "search" | "saved" | "uploaded" | "account" | "stores">("trending")
  // A listing card's shop was clicked → jump to the Stores tab and open that shop's catalog.
  // New object each time so StoresTab re-opens even the same shop after navigating away.
  const [jumpShop, setJumpShop] = useState<{ shop_id: string; shop_name?: string | null } | null>(null)
  const openShopFromListing = useCallback((l: EtsyListing) => {
    if (!l.shop_id) return
    setView("stores")
    setJumpShop({ shop_id: String(l.shop_id), shop_name: l.shop_name ?? null })
  }, [])
  const [saved, setSaved] = useState<SavedListing[]>([])
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  // "Make product" → Etsy draft. Track which listings have been uploaded (this session).
  const [makeListing, setMakeListing] = useState<EtsyListing | null>(null)
  // description + images are NOT in the grid payload — they'd be ~5x the response for
  // data no card shows. Fetched here for the one listing being turned into a product,
  // from the server's cached pool (no extra Etsy call).
  // Carries the listing id it belongs to. Without that stamp the detail of the PREVIOUSLY
  // opened card stays in state for the render in which a new card opens — and the publish
  // dialog seeds itself from a setTimeout closure captured on exactly that render, so the
  // new card's title arrived beside the old card's description.
  const [makeDetail, setMakeDetail] = useState<{ forId?: string; description?: string; images?: string[] } | null>(null)

  /**
   * RE-PUBLISH: the same dialog, reopened with what we already sent.
   *
   * Our publish creates a DRAFT, and nothing here can edit a draft in place — Etsy has an
   * update API but we have never called it, and pretending otherwise would be the worst
   * kind of half-feature. So this sends a NEW draft from corrected inputs, and says so on
   * the button ("re-publish", not "save"). The previous draft stays on Etsy until it is
   * deleted there, which is the seller's call, not ours to make silently.
   */
  const [editing, setEditing] = useState<{ l: UploadedListing; images: string[]; blank: CatalogProduct | null } | null>(null)
  /**
   * The catalog, loaded only when the Uploaded tab needs it.
   *
   * The stored record keeps `blank_sku`, but the dialog needs the whole CatalogProduct —
   * the sku alone has no cost, no shipping fee and therefore no margin, which is the one
   * thing the publish dialog exists to show. Fetched lazily: every other tab here works
   * without it.
   */
  const catalogRef = useRef<CatalogProduct[] | null>(null)
  const startEdit = useCallback(async (l: UploadedListing, images: string[]) => {
    if (!catalogRef.current) {
      catalogRef.current = await getCatalogProducts().then((r): CatalogProduct[] => r ?? []).catch((): CatalogProduct[] => [])
    }
    const sku = l.product?.blank_sku || l.published?.blank_sku
    // Resolved, not guessed. If the blank has since been removed from the catalog the
    // dialog opens with the picker empty rather than a phantom product — the seller
    // re-picks, and the margin is right instead of computed from something that is gone.
    const catalog = catalogRef.current ?? []
    const blank = sku ? (catalog.find((c) => String(c.sku ?? "") === String(sku)) ?? null) : null
    setEditing({ l, images, blank })
  }, [])
  useEffect(() => {
    if (!makeListing) return
    let alive = true
    // Deferred: setState straight from an effect body cascades a render before paint.
    const id = setTimeout(() => {
      setMakeDetail(null)
      getSpydeckListingDetail(makeListing.listing_id)
        .then((d) => { if (alive) setMakeDetail({ ...d, forId: String(makeListing.listing_id) }) })
        .catch(() => { if (alive) setMakeDetail(null) })   // publish still works, just without a prefilled body
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [makeListing])
  const [uploaded, setUploaded] = useState<UploadedListing[]>([])
  const [uploadedIds, setUploadedIds] = useState<Set<string>>(new Set())
  /**
   * NOTHING RECORDS AN UPLOAD HERE ANY MORE.
   *
   * onPublished/onPublishedFrom updated this list optimistically and then persisted, which
   * only worked while publishing happened in a dialog mounted on this page. It is a route
   * now, so the page writes the record itself (see publish-product-page.tsx) and the effect
   * below re-reads the list from the server on every mount — which is what coming back from
   * /publish is. One writer, and the card is there when you return.
   */
  const router = useRouter()
  // Couldn't stash the draft — said out loud rather than navigating to an empty form.
  const [publishErr, setPublishErr] = useState("")

  /**
   * EDIT — re-publish one of ours, seeded from what we actually sent.
   *
   * Our title, description and tags fall back to the competitor's TITLE only (never its
   * description or tag set): a title is a starting point someone rewrites, whereas
   * inheriting a description or tags is the one place copying is an actual liability.
   */
  useEffect(() => {
    if (!editing) return
    const l = editing
    const id = setTimeout(() => {
      /**
       * `submitted` FIRST — it is the form as it was sent, written once and identically by
       * every destination. Everything after it is reassembly from per-platform rows, which
       * is what made this unreliable: those rows differ by shop (TikTok's carries no title,
       * description or tags), so the answer depended on which shop finished last.
       *
       * The fallbacks stay for every listing published before this was recorded.
       */
      const sub = l.l.submitted
      const draftId = stashPublishDraft({
        prefill: {
          title: sub?.title || l.l.product?.title || l.l.published?.title || l.l.title,
          description: sub?.description || l.l.product?.description || "",
          price: sub?.price ?? l.l.published?.price ?? undefined,
          tags: sub?.tags ?? l.l.product?.tags ?? [],
          // published_listings keeps only the FIRST colour/size, so the full axes come from
          // the publish blob, falling back to the single columns for older rows.
          colors: sub?.colors ?? l.l.published?.colors ?? (l.l.product?.color ? [l.l.product.color] : []),
          sizes: sub?.sizes ?? l.l.published?.sizes ?? (l.l.product?.size ? [l.l.product.size] : []),
          // The photos we SENT, when we still have their urls. A photo picked off the
          // seller's machine was a data: URL and is deliberately not persisted, so those
          // come back from the shop's own listing instead (startEdit fetches them).
          images: sub?.images?.length ? sub.images : l.images,
          blank: l.blank,
          designUrl: sub?.design_data || l.l.product?.design_data || undefined,
          designPos: sub?.design_pos ?? l.l.product?.design_pos ?? undefined,
          designId: sub?.design_id ?? l.l.product?.design_id ?? undefined,
        },
        source: l.l,
        returnTo: "/spydeck",
        returnLabel: "Back to SpyDeck",
        title: "Edit listing",
      })
      setEditing(null)
      if (!draftId) { setPublishErr("Couldn't open the publish page — that listing's photos are too large for the browser to hand over."); return }
      router.push(`/publish?d=${draftId}`)
    }, 0)
    return () => clearTimeout(id)
  }, [editing, router])

  /**
   * MAKE — a new listing from a competitor's card.
   *
   * The publishable set starts EMPTY: a listing made from a competitor has none of its own
   * photos yet, and pretending otherwise is what put a seller's shop one click from an IP
   * takedown. Their photos travel as REFERENCE, which the page shows and never publishes.
   */
  useEffect(() => {
    if (!makeListing) return
    const l = makeListing
    const detail = makeDetail && makeDetail.forId === String(l.listing_id) ? makeDetail : null
    const id = setTimeout(() => {
      const draftId = stashPublishDraft({
        prefill: {
          title: l.title,
          description: detail?.description ?? l.description ?? "",
          // Prefer the USD-converted price so the seller starts from a comparable number.
          price: l.price_usd ?? l.price,
          tags: l.tags ?? [],
          images: [],
          referenceImages: ((detail?.images?.length ? detail.images : l.images?.length ? l.images : l.image ? [l.image] : []) as string[]).filter(Boolean),
        },
        source: l,
        returnTo: "/spydeck",
        returnLabel: "Back to SpyDeck",
        title: "Make product",
      })
      setMakeListing(null)
      if (!draftId) { setPublishErr("Couldn't open the publish page — that listing's photos are too large for the browser to hand over."); return }
      router.push(`/publish?d=${draftId}`)
    }, 0)
    return () => clearTimeout(id)
  }, [makeListing, makeDetail, router])

  // Forget the RECORD, not the listing. The draft stays in the shop — deleting it there is
  // the marketplace's job, and doing it from here would be destroying a live seller asset.
  const removeUpload = (l: UploadedListing) => {
    const k = String(l.listing_id)
    setUploaded((prev) => prev.filter((x) => String(x.listing_id) !== k))
    setUploadedIds((prev) => { const n = new Set(prev); n.delete(k); return n })
    deleteSpydeckUpload(k).catch(() => {})
  }
  // `keywords` still comes back from the trending endpoint; it's just not rendered
  // here any more (the Search tab's keyword cloud covers it).
  const [trending, setTrending] = useState<{ products: EtsyListing[]; keywords: string[] } | null>(null)
  // Carries the server's own 502 reason through to the screen instead of dropping it.
  const [trendErr, setTrendErr] = useState<string | null>(null)
  // "More ideas" reshuffles the cached pool (free); "Fresh scan" re-hits Etsy (rate-limited).
  const [seed, setSeed] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [freshScanning, setFreshScanning] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  // Filters — server-side (category/price/sort re-run the search) + client-side
  // (min sold-per-day / min favorites filter the shown cards live).
  const [categories, setCategories] = useState<EtsyCategory[]>([])
  const [cat, setCat] = useState("")
  const [sortSel, setSortSel] = useState("relevance")
  const [minPrice, setMinPrice] = useState("")
  const [maxPrice, setMaxPrice] = useState("")
  const [minSold, setMinSold] = useState("")
  const [minFav, setMinFav] = useState("")
  const [showFilters, setShowFilters] = useState(false)
  // Filters are a STAFF tool. A seller searching for inspiration wants a search box and
  // results; sourcing decisions — "what's actually moving in this category above this
  // price" — are the factory's job, and the controls only get in a seller's way.
  const [canFilter, setCanFilter] = useState(false)
  // Per-role SpyDeck tab visibility (until the Permissions matrix supersedes this):
  //   Trending — the sourcing feed — is warehouse/admin only; hidden from sellers AND operators.
  //   Account  — the shop analyzer — is hidden from operators; sellers keep their own shop view.
  // Resolved after mount, since role is read from localStorage.
  const [showTrending, setShowTrending] = useState(true)
  // Sourcing is admin-only server-side; its own effect rather than folding into the larger
  // role effect below, which keeps React Compiler's inference for the neighbouring callbacks
  // exactly as it was.
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setIsAdmin(getUser()?.role === "admin"), 0)
    return () => clearTimeout(t)
  }, [])
  const [sourceListing, setSourceListing] = useState<EtsyListing | null>(null)
  const [showAccount, setShowAccount] = useState(true)
  const [showStores, setShowStores] = useState(true)
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      const r = getUser()?.role
      setCanFilter(r === "admin" || r === "warehouse")
      // Driven by the admin hide-map now (DEFAULT_HIDDEN reproduces the prior behaviour —
      // Trending staff-only, Analyzer hidden from operators — until an admin overrides).
      loadNavVisibility().then(() => {
        if (!alive) return
        const trend = !isSurfaceHidden(r, "/spydeck#trending")
        const acct = !isSurfaceHidden(r, "/spydeck#account")
        const store = !isSurfaceHidden(r, "/spydeck#stores")
        setShowTrending(trend)
        setShowAccount(acct)
        setShowStores(store)
        setView((v) => ((v === "trending" && !trend) || (v === "account" && !acct) || (v === "stores" && !store) ? "search" : v))
      })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [])

  useEffect(() => {
    if (!entitled) return
    const id = setTimeout(() => { getEtsyCategories().then((r) => setCategories(r.categories ?? [])).catch(() => {}) }, 0)
    return () => clearTimeout(id)
  }, [entitled])

  // Client-side filters applied to whatever grid is shown.
  const applyClientFilters = useCallback((list: EtsyListing[]) => {
    const ms = Number(minSold) || 0
    const mf = Number(minFav) || 0
    if (!ms && !mf) return list
    return list.filter((l) => (!ms || estFor(l).sold24 >= ms) && (!mf || (l.num_favorers ?? 0) >= mf))
  }, [minSold, minFav])

  // Paging for every grid. Hooks can't be conditional, so all four are declared up
  // front; only the active tab's is rendered.
  const trendingList = useMemo(() => applyClientFilters(trending?.products ?? []), [applyClientFilters, trending])
  const resultsList = useMemo(() => {
    const list = applyClientFilters(results ?? [])
    const key = CLIENT_SORTS[sortSel]
    // Copy before sorting — `applyClientFilters` returns the state array itself when no
    // filter is set, and sorting in place mutates state React believes it still owns.
    return key ? [...list].sort((a, b) => key(b) - key(a)) : list
  }, [applyClientFilters, results, sortSel])
  const trendingPaged = usePaged(trendingList, 24)
  const resultsPaged = usePaged(resultsList, 24)
  const savedPaged = usePaged(saved, 24)
  const uploadedPaged = usePaged(uploaded, 24)

  // Auto-load the daily trending feed (server-cached) so SpyDeck opens populated.
  useEffect(() => {
    if (!entitled) return
    const id = setTimeout(() => {
      getSpydeckTrending()
        .then((r) => { setTrending({ products: r.products ?? [], keywords: r.keywords ?? [] }); setTrendErr(null) })
        // The server sends a real reason on 502 ("Etsy rejected us"); throwing it away and
        // rendering the empty state told a paying subscriber that nothing is trending,
        // which is a different — and false — statement.
        .catch((e) => setTrendErr(e instanceof Error ? e.message : "Couldn't load the trending feed."))
    }, 0)
    return () => clearTimeout(id)
  }, [entitled])

  // Load the seller's saved listings once entitled.
  useEffect(() => {
    if (!entitled) return
    const id = setTimeout(() => {
      getSpydeckSaves()
        .then((rows) => {
          const list = rows ?? []
          setSaved(list)
          setSavedIds(new Set(list.map((l) => String(l.listing_id))))
        })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [entitled])

  // Same for what's already been turned into a draft. Without this the Uploaded tab was
  // empty on every refresh and each card offered "Make product" again for something
  // already published — duplicate drafts in the shop.
  /**
   * STAFF SEE EVERYONE'S. A factory running several people through one set of shops has to
   * be able to ask "what went out, and who sent it" — and the list was scoped to whoever was
   * looking, so an admin saw only their own. The server refuses `all` for a seller, so this
   * is a request rather than a claim.
   */
  const isStaff = (getUser()?.role || "seller") !== "seller"
  useEffect(() => {
    if (!entitled) return
    const id = setTimeout(() => {
      getSpydeckUploads(isStaff)
        .then((rows) => {
          const list = rows ?? []
          setUploaded(list)
          setUploadedIds(new Set(list.map((l) => String(l.listing_id))))
        })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [entitled])

  // Stable identity (no deps) so memoised cards don't re-render on every parent change.
  // The card passes its own `wasSaved`, so this never needs to read `savedIds`.
  const toggleSave = useCallback(async (l: EtsyListing, wasSaved: boolean) => {
    const key = String(l.listing_id)
    // Optimistic update.
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (wasSaved) next.delete(key)
      else next.add(key)
      return next
    })
    setSaved((prev) => (wasSaved ? prev.filter((x) => String(x.listing_id) !== key) : [{ ...l }, ...prev]))
    try {
      if (wasSaved) await unsaveSpydeckListing(l.listing_id)
      else await saveSpydeckListing(l)
    } catch {
      // Revert on failure.
      setSavedIds((prev) => {
        const next = new Set(prev)
        if (wasSaved) next.add(key)
        else next.delete(key)
        return next
      })
    }
  }, [])

  const hasFilter = !!(cat || minPrice || maxPrice)
  const run = async (term?: string) => {
    const q = (term ?? query).trim()
    if (!q && !hasFilter) return // need a keyword OR a category/price filter
    if (term != null && term !== query) setQuery(term)
    setView("search")
    setLoading(true)
    setError(null)
    try {
      const sortMap: Record<string, { sort?: string; sortOrder?: string }> = {
        relevance: {}, newest: { sort: "created" }, price_asc: { sort: "price", sortOrder: "asc" }, price_desc: { sort: "price", sortOrder: "desc" },
        // The performance sorts fetch by relevance and re-rank locally — asking Etsy for
        // "price ascending" and then sorting by sales would rank the cheap end of the
        // catalogue, not the market.
        best: {}, revenue: {},
      }
      const shape = {
        limit: PAGE_SIZE,
        ...sortMap[sortSel],
        taxonomyId: cat || undefined,
        minPrice: Number(minPrice) || undefined,
        maxPrice: Number(maxPrice) || undefined,
      }
      /**
       * FIRST PAGE PAINTS, THE REST ARRIVES BEHIND IT.
       *
       * Asking for all four pages in one request made a search four times slower to show
       * anything — the grid sat empty while Etsy was walked, which is a worse experience
       * than the 48 results it replaced even though it ends up with eight times as many.
       *
       * So: one page, render, then continue from where it stopped. Both calls live in this
       * click handler. That matters — incremental loading here is an EVENT and cannot
       * re-enter itself, rather than an effect watching the list it is appending to
       * (CLAUDE.md 2.8, which cost this project a machine).
       */
      const first = await searchEtsy(q, { ...shape, pages: 1 })
      const firstRows = first.results ?? []
      setResults(firstRows)
      setSearched(q)
      setLoading(false)

      // Nothing more to ask for when Etsy already returned a short page.
      if (firstRows.length >= PAGE_SIZE) {
        setLoadingMore(true)
        try {
          const more = await searchEtsy(q, { ...shape, pages: EXTRA_PAGES, offset: PAGE_SIZE })
          const extra = more.results ?? []
          if (extra.length) {
            setResults((prev) => {
              // `results` is null before a search has ever run. Appending to the first page
              // we just set is the normal path; the ?? [] is what keeps a race — a second
              // search clearing state mid-flight — from throwing instead of just appending.
              const base = prev ?? []
              const seen = new Set(base.map((x) => String(x.listing_id)))
              return [...base, ...extra.filter((x) => !seen.has(String(x.listing_id)))]
            })
          }
        } catch { /* the first page is a real result — a failed continuation must not erase it */ }
        finally { setLoadingMore(false) }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError("Sign in to research Etsy listings.")
      else if (e instanceof ApiError && e.status === 500) setError("Etsy isn't configured on the server yet.")
      else setError(e instanceof Error ? e.message : "Search failed.")
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  // Stable tag-research handler for the memoised cards: a ref keeps `onSearchTag`'s identity
  // fixed while still calling the LATEST `run` (which closes over changing filter state), so
  // typing in the search box no longer re-renders all 24 cards.
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run })
  const onSearchTag = useCallback((t: string) => runRef.current(t), [])

  // "More ideas" — new seed, refetch the reshuffled pool for FREE (no Etsy call), page 1.
  // Not useCallback: both handlers are only ever an onClick on a plain <button>, never a
  // prop to a memoized child, so manual memoization bought nothing — and its dependency list
  // ([trendingPaged], while the body also touches setSeed/setRefreshing) made React Compiler
  // abandon optimizing this whole component with "existing memoization could not be
  // preserved". The compiler memoizes these automatically.
  const moreIdeas = async () => {
    const s = Math.floor(Math.random() * 1_000_000) + 1
    setSeed(s); setRefreshing(true); setRefreshMsg(null)
    try {
      const r = await getSpydeckTrending(s)
      setTrending({ products: r.products ?? [], keywords: r.keywords ?? [] }); setTrendErr(null)
      trendingPaged.setPage(1)
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : "Couldn't refresh the feed.")
    } finally { setRefreshing(false) }
  }

  // "Fresh scan" — re-hit Etsy for a genuinely new pool. The server enforces the rate limits
  // and returns a friendly 429 reason (global 30-min lock / seller once-2-days / 20-a-day cap).
  const freshScan = async () => {
    setFreshScanning(true); setRefreshMsg(null)
    try {
      const r = await rebuildSpydeckTrending(seed || 1)
      setTrending({ products: r.products ?? [], keywords: r.keywords ?? [] }); setTrendErr(null)
      trendingPaged.setPage(1)
      setRefreshMsg("Fresh scan complete — new niches pulled from Etsy.")
    } catch (e) {
      setRefreshMsg(e instanceof ApiError || e instanceof Error ? e.message : "Fresh scan failed.")
    } finally { setFreshScanning(false) }
  }

  /**
   * Stats reflect whatever's on screen — search results, or the trending feed when no
   * search has run yet — so the cards fill in without a search.
   *
   * READ FROM THE SAME LIST THE PAGER COUNTS. This built its own list from the raw state
   * while the grid paged over the FILTERED one, so the two could disagree about how many
   * results there are — the card read "100" beside a pager saying "Page 13 / 17", which at
   * 24 a page is about 400. Whichever number was right, a page cannot state two totals and
   * be believed about either.
   *
   * It is also the honest number now that a search walks four pages: the count is every
   * result we hold, not the first page of them.
   *
   * NO EXTRA ETSY CALLS. Counting is arithmetic over an array that is already in memory —
   * and the grid still renders ONE PAGE at a time, so raising the total does not raise how
   * many images load. Per page stays per page; only the denominator got honest.
   */
  const stats = useMemo(() => {
    const list = (view === "saved" ? saved
      : view === "uploaded" ? uploaded
        : view === "trending" || results === null ? trendingList
          : resultsList) ?? []
    const prices = list.map((l) => l.price).filter((p): p is number => p != null && p > 0).sort((a, b) => a - b)
    const median = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : 0
    const views = list.map((l) => l.views).filter((v): v is number => v != null)
    const shops = new Set(list.map((l) => l.shop_name).filter(Boolean))
    return {
      ready: list.length > 0,
      count: list.length,
      median,
      shops: shops.size,
      topViews: views.length ? Math.max(...views) : 0,
    }
  }, [view, results, trendingList, resultsList, saved, uploaded])

  // Cloud: aggregate the actual tags across search results (real niche keywords);
  // before any search, fall back to the curated trending niches.
  const cloud = useMemo(() => {
    const list = results ?? []
    if (list.length) {
      const counts: Record<string, number> = {}
      for (const l of list) for (const raw of l.tags ?? []) {
        const k = raw.trim().toLowerCase()
        if (k) counts[k] = (counts[k] || 0) + 1
      }
      const words = Object.entries(counts).map(([text, weight]) => ({ text, weight })).sort((a, b) => b.weight - a.weight).slice(0, 40)
      if (words.length >= 6) return { words, live: true }
    }
    return { words: SEED_NICHES, live: false }
  }, [results])

  if (checked && !entitled) return <SpyDeckLocked />

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Results" value={stats.ready ? String(stats.count) : "—"} sub={searched ? `for "${searched}"` : view === "trending" ? "trending today" : "run a search"} />
        <StatCard label="Median price" value={stats.ready ? money(stats.median) : "—"} sub="typical listing" />
        <StatCard label="Shops" value={stats.ready ? String(stats.shops) : "—"} sub="unique sellers" />
        <StatCard label="Most viewed" value={stats.ready && stats.topViews ? stats.topViews.toLocaleString() : "—"} sub="views" tone={stats.topViews ? "pos" : undefined} />
      </StatGrid>

      {view === "search" && (
        <SectionCard
          title={cloud.live ? "Keywords in these results" : "Trending keywords & niches"}
        >
          <KeywordCloud words={cloud.words} onPick={(t) => run(t)} />
        </SectionCard>
      )}

      <SectionCard
        title="Product research"
        actions={
          <div className="flex rounded-lg border border-border p-0.5">
            {(([
              ...(showTrending ? (["trending"] as const) : []),
              "search", "saved", "uploaded",
              ...(showStores ? (["stores"] as const) : []),
              ...(showAccount ? (["account"] as const) : []),
            ]) as Array<"trending" | "search" | "saved" | "uploaded" | "account" | "stores">).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={
                  "eg-tap rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors " +
                  (view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {v === "saved" ? `Saved${saved.length ? ` (${saved.length})` : ""}` : v === "uploaded" ? `Uploaded${uploaded.length ? ` (${uploaded.length})` : ""}` : v === "trending" ? "Trending" : v === "account" ? "My shop" : v === "stores" ? "Stores" : "Search"}
              </button>
            ))}
          </div>
        }
      >
        {(view === "search" || view === "trending") && (
          <div className="border-b border-border p-4">
            <div className="flex items-center gap-2">
              <div className="relative max-w-md flex-1">
                <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                  placeholder="e.g. vintage sunset tee"
                  className="pl-9"
                />
              </div>
              {canFilter && (
                <Button variant="outline" onClick={() => setShowFilters((s) => !s)} className={showFilters ? "border-primary text-primary" : ""}>
                  <SlidersHorizontal size={15} weight="bold" /> Filters
                </Button>
              )}
              <Button onClick={() => { setView("search"); run() }} disabled={loading || (!query.trim() && !hasFilter)}>
                {loading ? "Searching…" : "Search"}
              </Button>
            </div>

            {canFilter && showFilters && (
              <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-3 lg:grid-cols-6">
                <FilterField label="Category">
                  <select value={cat} onChange={(e) => setCat(e.target.value)} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                    <option value="">All</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </FilterField>
                <FilterField label="Sort by">
                  <select value={sortSel} onChange={(e) => setSortSel(e.target.value)} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                    <option value="relevance">Relevance</option>
                    {/* Ranked from what has been fetched, not from Etsy — see CLIENT_SORTS. */}
                    <option value="best">Est. best sellers</option>
                    <option value="revenue">Est. revenue</option>
                    <option value="newest">Newest</option>
                    <option value="price_asc">Price: low → high</option>
                    <option value="price_desc">Price: high → low</option>
                  </select>
                </FilterField>
                <FilterField label="Min price ($)">
                  <Input value={minPrice} onChange={(e) => setMinPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="h-9" inputMode="decimal" />
                </FilterField>
                <FilterField label="Max price ($)">
                  <Input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Any" className="h-9" inputMode="decimal" />
                </FilterField>
                <FilterField label="Min sold/day" hint="estimated">
                  <Input value={minSold} onChange={(e) => setMinSold(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" className="h-9" inputMode="numeric" />
                </FilterField>
                <FilterField label="Min favorites">
                  <Input value={minFav} onChange={(e) => setMinFav(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" className="h-9" inputMode="numeric" />
                </FilterField>
                <div className="col-span-2 flex items-center gap-2 sm:col-span-3 lg:col-span-6">
                  <Button size="sm" onClick={() => run()} disabled={!query.trim() && !hasFilter}>Apply filters</Button>
                  <button
                    onClick={() => { setCat(""); setSortSel("relevance"); setMinPrice(""); setMaxPrice(""); setMinSold(""); setMinFav("") }}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Reset
                  </button>
                  <span className="ml-auto text-xs text-muted-foreground">Category, price &amp; sort search Etsy; sold/day &amp; favorites filter results live.</span>
                </div>
              </div>
            )}
          </div>
        )}

        {error && view === "search" && (
          <div className="border-b border-border bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">{error}</div>
        )}


        {view === "stores" ? (
          <StoresTab
            savedIds={savedIds}
            uploadedIds={uploadedIds}
            onToggleSave={toggleSave}
            onSearchTag={onSearchTag}
            onMakeProduct={setMakeListing}
            onSource={isAdmin ? setSourceListing : undefined}
            jumpShop={jumpShop}
          />
        ) : view === "account" ? (
          <ShopAnalyzer />
        ) : view === "trending" ? (
          trending === null && trendErr ? (
            // "The feed failed" and "nothing is trending" are different answers, and the
            // second one is the product's whole value proposition. Say which.
            <div className="py-16 text-center text-sm text-muted-foreground">
              Couldn&apos;t load today&apos;s trending feed — this is a fetch problem, not an empty market.
              <div className="mt-1 text-xs">{trendErr}</div>
            </div>
          ) : trending === null ? (
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[320px] animate-pulse rounded-2xl bg-muted" />)}
            </div>
          ) : trending.products.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Today&apos;s trending feed isn&apos;t available yet — try a search, or check back shortly.</div>
          ) : (
            <>
              {/* Refresh controls: "More ideas" reshuffles the day's cached pool for free;
                  "Fresh scan" re-hits Etsy (rate-limited server-side, friendly 429). The
                  keyword cloud lives on the Search tab, so it isn't repeated here. */}
              <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
                <button
                  type="button" onClick={moreIdeas} disabled={refreshing || freshScanning}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
                  title="Reshuffle the feed for a fresh set of ideas — free and instant"
                >
                  {refreshing ? <CircleNotch size={14} className="animate-spin" /> : <Shuffle size={14} weight="bold" />} More ideas
                </button>
                <button
                  type="button" onClick={freshScan} disabled={refreshing || freshScanning}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  title="Pull a brand-new batch of niches from Etsy (rate-limited)"
                >
                  {freshScanning ? <CircleNotch size={14} className="animate-spin" /> : <ArrowsClockwise size={14} weight="bold" />} Fresh scan
                </button>
                {refreshMsg && <span className="text-xs text-muted-foreground">{refreshMsg}</span>}
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {trendingPaged.pageItems.map((l) => (
                  <ResultCard key={l.listing_id} l={l} saved={savedIds.has(String(l.listing_id))} uploaded={uploadedIds.has(String(l.listing_id))} onToggleSave={toggleSave} onSearchTag={onSearchTag} onMakeProduct={setMakeListing} onOpenShop={openShopFromListing} onSource={isAdmin ? setSourceListing : undefined} />
                ))}
              </div>
              <Pagination page={trendingPaged.page} pageCount={trendingPaged.pageCount} perPage={trendingPaged.perPage} total={trendingPaged.total} start={trendingPaged.start} onPage={trendingPaged.setPage} onPerPage={trendingPaged.setPerPage} perPageOptions={[24, 48, 96]} />
            </>
          )
        ) : view === "uploaded" ? (
          uploaded.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Storefront size={24} weight="duotone" />
              </span>
              <div className="font-medium">Nothing uploaded yet</div>
              <div className="max-w-xs text-sm text-muted-foreground">Hit &ldquo;Make product&rdquo; on any card to publish it as an Etsy draft — it&apos;ll show here.</div>
            </div>
          ) : (
            <>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {uploadedPaged.pageItems.map((l) => (
                <UploadedCard key={l.listing_id} l={l} onRemove={removeUpload} onEdit={startEdit} />
              ))}
            </div>
            <Pagination page={uploadedPaged.page} pageCount={uploadedPaged.pageCount} perPage={uploadedPaged.perPage} total={uploadedPaged.total} start={uploadedPaged.start} onPage={uploadedPaged.setPage} onPerPage={uploadedPaged.setPerPage} perPageOptions={[24, 48, 96]} />
            </>
          )
        ) : view === "saved" ? (
          saved.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Heart size={24} weight="duotone" />
              </span>
              <div className="font-medium">No saved listings yet</div>
              <div className="max-w-xs text-sm text-muted-foreground">Tap the heart on any research card to save it here for later.</div>
            </div>
          ) : (
            <>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {savedPaged.pageItems.map((l) => (
                <ResultCard key={l.listing_id} l={l} saved={savedIds.has(String(l.listing_id))} uploaded={uploadedIds.has(String(l.listing_id))} onToggleSave={toggleSave} onSearchTag={onSearchTag} onMakeProduct={setMakeListing} onOpenShop={openShopFromListing} onSource={isAdmin ? setSourceListing : undefined} />
              ))}
            </div>
            <Pagination page={savedPaged.page} pageCount={savedPaged.pageCount} perPage={savedPaged.perPage} total={savedPaged.total} start={savedPaged.start} onPage={savedPaged.setPage} onPerPage={savedPaged.setPerPage} perPageOptions={[24, 48, 96]} />
            </>
          )
        ) : results === null ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Binoculars size={26} weight="duotone" />
            </span>
            <div className="font-medium">Research the competition</div>
            <div className="max-w-xs text-sm text-muted-foreground">Search any keyword to spy live Etsy listings — price, views and favorites, with the standouts flagged <span className="font-medium text-rose-600">Trending</span>. Heart the winners to save them.</div>
          </div>
        ) : loading ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[300px] animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No listings found. Try another keyword.</div>
        ) : (
          <>
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {resultsPaged.pageItems.map((l) => (
              <ResultCard
                key={l.listing_id}
                l={l}
                saved={savedIds.has(String(l.listing_id))}
                uploaded={uploadedIds.has(String(l.listing_id))}
                onToggleSave={toggleSave}
                onSearchTag={onSearchTag}
                onMakeProduct={setMakeListing}
                onOpenShop={openShopFromListing}
              />
            ))}
          </div>
          {/* SAYS THE GRID IS STILL GROWING. Without it the first page lands, the pager
              reads "Page 1 / 1", and three seconds later the count jumps — which looks like
              a glitch rather than the second half of the search arriving. It also stops
              anyone concluding, again, that this is all Etsy has. */}
          {loadingMore && (
            <p className="px-5 pb-2 text-xs text-muted-foreground" role="status" aria-live="polite">
              <CircleNotch size={12} className="mr-1 inline animate-spin" />
              Fetching more results…
            </p>
          )}
          <Pagination page={resultsPaged.page} pageCount={resultsPaged.pageCount} perPage={resultsPaged.perPage} total={resultsPaged.total} start={resultsPaged.start} onPage={resultsPaged.setPage} onPerPage={resultsPaged.setPerPage} perPageOptions={[24, 48, 96]} />
          </>
        )}
      </SectionCard>

      {/* Same dialog the design maker uses — only the prefill source differs. A spy'd
          listing supplies title/description/tags/images; the blank is chosen in the
          dialog, which is what makes cost and margin computable. */}
      <SourcingSuggestDialog listing={sourceListing} onClose={() => setSourceListing(null)} />

      {/* The draft couldn't be handed over to the publish page (a storage quota, in
          practice). Said here rather than navigating to a page that would find nothing. */}
      {publishErr && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{publishErr}</div>
      )}

      {/* RE-PUBLISH — the same dialog, seeded from what we actually sent.
          A SECOND instance rather than a shared one: the two entry points seed different
          things (a competitor listing supplies reference photos and no images; ours
          supplies real images and a resolved blank), and one dialog switching between
          them would need a reset effect — the pattern this repo replaced with remounting.
          Keyed on the listing so reopening a different card is genuinely fresh state. */}
      {/* PUBLISHING IS A PAGE NOW, not two dialogs mounted here.
          Both entry points stash the listing and navigate: the draft carries the SOURCE
          listing too, so the page can record the Uploaded card against it — that used to
          be the onPublished callback, which a navigation cannot preserve. Both effects
          below fire when their listing is set, which is what the two dialogs' `open` props
          used to do. */}
    </div>
  )
}

// Shown when the seller isn't entitled to SpyDeck — an upsell to the Plan tab.
function SpyDeckLocked() {
  const cfg = getSpydeckConfig()
  const perks = [
    "Trending Etsy listings in your niche",
    "Keyword & sales-volume estimates",
    "Competitor pricing at a glance",
    "One-click add-to-store",
  ]
  return (
    <div className="mx-auto max-w-xl py-8">
      <div className="flex flex-col items-center rounded-2xl border border-border bg-card p-8 text-center">
        <span className="relative flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Binoculars size={26} weight="fill" />
          <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border-2 border-card bg-foreground text-background">
            <LockSimple size={11} weight="fill" />
          </span>
        </span>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">SpyDeck is a research add-on</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Unlock product research to find winning listings before you print. Included free on Pro &amp; Enterprise,
          or add it to any plan for ${cfg.price}/mo.
        </p>
        <ul className="mt-5 grid w-full gap-2 text-left sm:grid-cols-2">
          {perks.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check size={15} weight="bold" className="mt-0.5 shrink-0 text-primary" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <Link href="/settings?tab=plan" className={cn(buttonVariants(), "mt-6 w-full sm:w-auto")}>
          See plans
        </Link>
      </div>
    </div>
  )
}

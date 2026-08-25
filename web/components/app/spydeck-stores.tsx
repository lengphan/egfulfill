"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useRef, useState } from "react"
import { MagnifyingGlass, Heart, Storefront, Star, ArrowSquareOut, CircleNotch, Package } from "@phosphor-icons/react"
import {
 searchSpydeckShops, getSpydeckShop, getSpydeckShopListings, getSpydeckSavedShops, saveSpydeckShop, unsaveSpydeckShop,
 getSpydeckShopsByCategory, getEtsyCategories,
 type SpyShop, type EtsyListing, type EtsyCategory,
} from "@/lib/api"
import { ResultCard } from "@/components/app/spydeck-view"
import { cn } from "@/lib/utils"
import { CARD_ACTION_PRIMARY, CARD_ACTION_ICON } from "@/lib/card-actions"
import { EmptyState } from "@/components/app/empty-state"
import { ThumbFill } from "@/components/app/thumb"

// Shared listing-level handlers, threaded from SpyDeckView so a competitor's product can be
// saved or turned into a draft with the exact same flow as any other research card.
type Handlers = {
  /** The listing whose photos are being collected right now, so its card can say so. Passed
   * straight through to ResultCard, which does the comparing. */
 openingId?: string | number | null
 savedIds: Set<string>
 uploadedIds: Set<string>
 onToggleSave: (l: EtsyListing, wasSaved: boolean) => void
 onSearchTag: (t: string) => void
 onMakeProduct: (l: EtsyListing) => void
  /** Admin-only: open the supplier-suggestion panel for this listing. Undefined otherwise. */
 onSource?: (l: EtsyListing) => void
  // Set by SpyDeckView when a listing card's shop is clicked — jump straight into that
  // shop's catalog. A new object each click so the effect re-fires for the same shop.
 jumpShop?: { shop_id: string; shop_name?: string | null } | null
}

const fmtK = (n: number | null | undefined) =>
 n == null ? "—" : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n)

const priceStr = (l: EtsyListing) =>
 l.price_usd != null ? `$${Number(l.price_usd).toFixed(2)}`
 : l.price != null ? `${l.currency === "USD" ? "$" : ""}${l.price}${l.currency && l.currency !== "USD" ? " " + l.currency : ""}`
 : ""

// Kept deliberately SMALL to stay well under Etsy's 10-requests/second ceiling: each row on a
// page fires one listings call, so a page = PAGE_SIZE calls. 5 (staggered + cached below) is
// comfortably safe; bump it only once the live behaviour is confirmed fine.
const PAGE_SIZE = 5

// Preview strips, cached by shop_id for this session so paging back — or a re-render — never
// re-fetches. It holds the FULL listings so the same cache serves BOTH the row's preview strip
// AND "View catalog" — opening a shop you've already previewed costs zero extra Etsy calls.
const listingsCache = new Map<string, EtsyListing[]>()
// Fewer, bigger previews that STRETCH to fill the row — a store's look reads better from 5
// large thumbnails than a dozen tiny scrolling ones.
const stripOf = (ls: EtsyListing[]) => ls.filter((l) => l.thumb || l.image).slice(0, 5)

// One STORE per row: identity + stats + actions on the left, a strip of that shop's actual
// product images on the right — so you can see what a competitor sells before clicking in.
// Each row lazily fetches a dozen of its own listings, STAGGERED by its position so a page
// never bursts all its calls in the same second.
function ShopRow({ s, index, saved, onToggle, onOpen }: { s: SpyShop; index: number; saved: boolean; onToggle: (s: SpyShop) => void; onOpen: (s: SpyShop) => void }) {
  const tl = useLabelT()
  // Read the cache at mount (the row remounts per shop — key={shop_id}), so a cached strip
  // shows with no fetch and no setState-in-effect.
 const [previews, setPreviews] = useState<EtsyListing[] | null>(() => { const c = listingsCache.get(s.shop_id); return c ? stripOf(c) : null })
 useEffect(() => {
 if (listingsCache.has(s.shop_id)) return // already shown by the initializer above
 let live = true
    // Space the calls out (~250ms per row) so a page of PAGE_SIZE rows trickles in rather than
    // firing at once — keeps us far below Etsy's 10/sec limit.
 const t = setTimeout(() => {
 getSpydeckShopListings(s.shop_id)
        .then((r) => { const full = r.listings ?? []; listingsCache.set(s.shop_id, full); if (live) setPreviews(stripOf(full)) })
        .catch(() => { if (live) setPreviews([]) })
    }, index * 250)
 return () => { live = false; clearTimeout(t) }
  }, [s.shop_id, index])

 return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md lg:flex-row">
      {/* LEFT — identity, stats, actions (fixed column) */}
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-60">
        <div className="flex items-start gap-3">
          <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
            {s.icon
              ? <ThumbFill src={s.icon} alt={s.shop_name || "shop"} sizes="48px" />
 : <span className="flex size-full items-center justify-center text-muted-foreground"><Storefront size={20} weight="duotone" /></span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{s.shop_name || "—"}</div>
            {s.title && <div className="line-clamp-1 text-xs text-muted-foreground">{s.title}</div>}
          </div>
          <button
 type="button" onClick={() => onToggle(s)} aria-pressed={saved}
 aria-label={saved ? "Unsave store" : "Save store"}
 className={"flex size-8 shrink-0 items-center justify-center rounded-full transition-colors " + (saved ? "bg-rose-600 text-white" : "bg-muted text-muted-foreground hover:bg-accent")}
          >
            <Heart size={15} weight={saved ? "fill" : "regular"} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-lg bg-muted/50 py-1.5"><div className="text-sm font-semibold tabular-nums">{fmtK(s.listings)}</div><div className="text-2xs text-muted-foreground">{tl("spydeckStores", "Products")}</div></div>
          <div className="rounded-lg bg-muted/50 py-1.5"><div className="text-sm font-semibold tabular-nums">{fmtK(s.sales)}</div><div className="text-2xs text-muted-foreground">{tl("spydeckStores", "Sales")}</div></div>
          <div className="rounded-lg bg-muted/50 py-1.5"><div className="flex items-center justify-center gap-0.5 text-sm font-semibold tabular-nums">{s.rating != null ? <>{s.rating.toFixed(1)}<Star size={11} weight="fill" className="text-hold" /></> : "—"}</div><div className="text-2xs text-muted-foreground">{fmtK(s.reviews)} reviews</div></div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onOpen(s)} className={cn(CARD_ACTION_PRIMARY, "flex-1")}>
            {tl("spydeckStores", "Go to store")}
          </button>
          {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className={cn(CARD_ACTION_ICON, "text-muted-foreground hover:text-foreground")} title={tl("spydeckStores", "Open on Etsy")}><ArrowSquareOut size={15} /></a>}
        </div>
      </div>

      {/* RIGHT — the shop's product images, the whole point of the row. Click to open the
 full catalog. Horizontally scrollable so a long strip never widens the page. */}
      <button type="button" onClick={() => onOpen(s)} title={`Open ${s.shop_name || "shop"}'s catalog`} className="group min-w-0 flex-1 self-stretch overflow-hidden rounded-xl text-left">
        {previews === null ? (
          <div className="flex gap-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="aspect-square flex-1 animate-pulse rounded-lg bg-muted" />)}</div>
        ) : previews.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">{tl("spydeckStores", "No product images to preview")}</div>
        ) : (
          <div className="flex gap-2">
            {previews.map((l) => (
              <div key={String(l.listing_id)} className="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-lg bg-muted">
                <ThumbFill src={l.thumb || l.image || ""} alt={l.title || ""} sizes="180px" className="transition-transform duration-300 group-hover:scale-105" />
              </div>
            ))}
          </div>
        )}
      </button>
    </div>
  )
}

export function StoresTab(h: Handlers) {
  const tl = useLabelT()
 const [query, setQuery] = useState("")
 const [shops, setShops] = useState<SpyShop[] | null>(null)
 const [loading, setLoading] = useState(false)
 const [error, setError] = useState<string | null>(null)
 const [tab, setTab] = useState<"search" | "saved">("search")
 const [saved, setSaved] = useState<SpyShop[]>([])
 const [savedShopIds, setSavedShopIds] = useState<Set<string>>(new Set())
 const [page, setPage] = useState(0) // store-list pagination (PAGE_SIZE per page)
 const [open, setOpen] = useState<SpyShop | null>(null)
 const [catalog, setCatalog] = useState<EtsyListing[] | null>(null)
 const [catLoading, setCatLoading] = useState(false)
  // Catalog presentation: image-first Gallery (fast visual scan of a competitor) vs the full
  // Details cards (with save / make-product). Gallery is the default — it's what you open a
  // competitor's shop to do.
 const [catView, setCatView] = useState<"gallery" | "cards">("gallery")
  // Category discovery — suggest shops selling in a category (vs searching a name).
 const [categories, setCategories] = useState<EtsyCategory[]>([])
 const [catId, setCatId] = useState("")
 useEffect(() => {
 let alive = true
 getEtsyCategories().then((r) => { if (alive) setCategories(r.categories ?? []) }).catch(() => {})
 return () => { alive = false }
  }, [])
 const byCategory = useCallback(async (id: string) => {
 setCatId(id)
 if (!id) return
 setLoading(true); setError(null); setTab("search"); setQuery(""); setPage(0)
 try {
 const r = await getSpydeckShopsByCategory(id)
 setShops(r.shops ?? [])
 if (r.error) setError(r.error)
    } catch (e) {
 setError(e instanceof Error ? e.message : "Category search failed."); setShops([])
    } finally { setLoading(false) }
  }, [])

  // Suggest shops by default: once the category list arrives, auto-load the FIRST category's
  // shops (once) — so the tab opens with competitors to browse instead of a blank prompt.
  // The seller can switch categories or search a name from there.
 const autoRan = useRef(false)
 useEffect(() => {
 if (autoRan.current || !categories.length || query.trim() || shops) return
 autoRan.current = true
 const id = setTimeout(() => byCategory(String(categories[0].id)), 0)
 return () => clearTimeout(id)
  }, [categories, query, shops, byCategory])

 useEffect(() => {
 let alive = true
 getSpydeckSavedShops().then((r) => {
 if (!alive) return
 const list = r.shops ?? []
 setSaved(list); setSavedShopIds(new Set(list.map((s) => s.shop_id)))
    }).catch(() => {})
 return () => { alive = false }
  }, [])

 const run = useCallback(async () => {
 const q = query.trim()
 if (!q) return
 setLoading(true); setError(null); setTab("search"); setPage(0)
 try {
 const r = await searchSpydeckShops(q)
 setShops(r.shops ?? [])
 if (r.error) setError(r.error)
    } catch (e) {
 setError(e instanceof Error ? e.message : "Search failed."); setShops([])
    } finally { setLoading(false) }
  }, [query])

 const toggleSaveShop = async (s: SpyShop) => {
 const on = savedShopIds.has(s.shop_id)
 setSavedShopIds((prev) => { const n = new Set(prev); if (on) n.delete(s.shop_id); else n.add(s.shop_id); return n })
 setSaved((prev) => on ? prev.filter((x) => x.shop_id !== s.shop_id) : [s, ...prev])
 try { if (on) await unsaveSpydeckShop(s.shop_id); else await saveSpydeckShop(s) }
 catch { setSavedShopIds((prev) => { const n = new Set(prev); if (on) n.add(s.shop_id); else n.delete(s.shop_id); return n }) }
  }

 const openShop = async (s: SpyShop) => {
 setOpen(s)
    // Reuse the row's cached listings — opening a shop whose strip already loaded costs no
    // extra Etsy call.
 const cached = listingsCache.get(s.shop_id)
 if (cached) { setCatalog(cached); setCatLoading(false); return }
 setCatalog(null); setCatLoading(true)
 try { const r = await getSpydeckShopListings(s.shop_id); const full = r.listings ?? []; listingsCache.set(s.shop_id, full); setCatalog(full) }
 catch { setCatalog([]) }
 finally { setCatLoading(false) }
  }

  // Open a shop we only know by id/name (arrived from a listing card's shop link). Pull the
  // full profile for the header stats — falling back to a bare shop if that lookup fails —
  // then load the catalog via openShop.
 const openById = useCallback(async (shopId: string, shopName?: string | null) => {
 let shop: SpyShop = { shop_id: shopId, shop_name: shopName ?? null } as SpyShop
 try { const r = await getSpydeckShop(shopId); if (r.shop) shop = r.shop } catch { /* keep the bare shop */ }
 openShop(shop)
  }, [])

  // A listing card's shop was clicked in SpyDeckView → jump into that shop's catalog.
 const jump = h.jumpShop
 useEffect(() => {
 if (!jump?.shop_id) return
 const id = setTimeout(() => openById(jump.shop_id, jump.shop_name), 0)
 return () => clearTimeout(id)
  }, [jump, openById])

  // ── Catalog view (one shop's products) ───────────────────────────────────────
 if (open) {
 return (
      <div>
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
          <button type="button" onClick={() => { setOpen(null); setCatalog(null) }} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent">
            {tl("spydeckStores", "Back")}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{open.shop_name}</span>
            <span className="text-xs text-muted-foreground">{fmtK(open.listings)} products</span>
          </div>
          {/* Gallery (image-first, for scanning) vs Details (full cards with save / make). */}
          <div className="ml-auto flex items-center gap-1 rounded-full bg-muted p-1">
            {(["gallery", "cards"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setCatView(v)}
 className={"rounded-full px-2.5 py-1 text-xs font-medium transition-colors " + (catView === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {v === "gallery" ? tl("spydeckStores", "Gallery") : tl("spydeckStores", "Details")}
              </button>
            ))}
          </div>
          {open.url && <a href={open.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">{tl("spydeckStores", "Open on Etsy")} <ArrowSquareOut size={12} /></a>}
        </div>
        {catLoading ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[320px] animate-pulse rounded-2xl bg-muted" />)}
          </div>
        ) : !(catalog && catalog.length) ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{tl("spydeckStores", "No active listings returned for this shop.")}</div>
        ) : catView === "gallery" ? (
          // Image-only: just the photo with a price overlay (title lives in the alt + the
          // click-through). A pure wall of images to scan the shop's look fast.
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {catalog.map((l) => (
              <a key={l.listing_id} href={l.url} target="_blank" rel="noopener noreferrer" title={l.title}
 className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted transition-shadow hover:shadow-md">
                {(l.thumb || l.image) ? (
                  <ThumbFill src={l.thumb || l.image || ""} alt={l.title} sizes="(max-width:640px) 50vw, 20vw" className="transition-transform duration-300 group-hover:scale-105" />
                ) : (
                  <span className="flex size-full items-center justify-center text-muted-foreground"><Package size={20} weight="duotone" /></span>
                )}
                {priceStr(l) && <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-2xs font-bold tabular-nums text-white">{priceStr(l)}</span>}
              </a>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {catalog.map((l) => (
              <ResultCard
 key={l.listing_id} l={l}
 saved={h.savedIds.has(String(l.listing_id))}
 uploaded={h.uploadedIds.has(String(l.listing_id))}
 onToggleSave={h.onToggleSave} onSearchTag={h.onSearchTag} onMakeProduct={h.onMakeProduct}
 openingId={h.openingId} onSource={h.onSource}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Store search + saved ─────────────────────────────────────────────────────
 const list = tab === "saved" ? saved : shops
 return (
    <div>
      <div className="flex flex-col gap-3 px-5 pt-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-background px-4 py-2">
          <MagnifyingGlass size={16} className="text-muted-foreground" />
          <input
 value={query} onChange={(e) => setQuery(e.target.value)}
 onKeyDown={(e) => { if (e.key === "Enter") run() }}
 placeholder={tl("spydeckStores", "Search competitor stores by name…")}
 className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={run} disabled={loading || !query.trim()} className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {loading ? <CircleNotch size={14} className="animate-spin" /> : tl("spydeckStores", "Search")}
          </button>
        </div>
        {categories.length > 0 && (
          <select
 value={catId}
 onChange={(e) => byCategory(e.target.value)}
 title={tl("spydeckStores", "Discover shops selling in a category")}
 className="rounded-full border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <option value="">{tl("spydeckStores", "Browse by category…")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1 rounded-full bg-muted p-1">
          {(["search", "saved"] as const).map((t) => (
            <button key={t} type="button" onClick={() => { setTab(t); setPage(0) }}
 className={"rounded-full px-3 py-1 text-xs font-medium transition-colors " + (tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t === "saved" ? `Saved${saved.length ? ` (${saved.length})` : ""}` : tl("spydeckStores", "Results")}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="px-5 pt-3 text-xs text-rose-600">{error}</div>}

      {tab === "search" && shops === null ? (
        <EmptyState
          icon={Storefront}
          title={tl("spydeckStores", "Research a competitor")}
          note={tl("spydeckStores", "Search any Etsy shop by name to see its product count, sales and reviews — then open its full catalog.")}
        />
      ) : list && list.length === 0 ? (
        /* This one had no mark at all — a line of grey text in the middle of a panel, which
           is what an empty region looks like when nobody decided it was one. */
        <EmptyState
          icon={Storefront}
          title={tab === "saved" ? "No saved stores yet" : "No stores match that name"}
          note={tab === "saved" ? "Hit the heart on any store to keep it here." : undefined}
        />
      ) : (
        <div className="space-y-3 p-5">
          {(() => {
 const all = list ?? []
 const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
 const cur = Math.min(page, pages - 1) // guard: list may shrink below the current page
 const rows = all.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE)
 return (
              <>
                {rows.map((s, i) => (
                  <ShopRow key={s.shop_id} s={s} index={i} saved={savedShopIds.has(s.shop_id)} onToggle={toggleSaveShop} onOpen={openShop} />
                ))}
                {pages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button type="button" onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40">{tl("spydeckStores", "Prev")}</button>
                    <span className="px-1 text-xs text-muted-foreground">Page {cur + 1} of {pages} · {all.length} stores</span>
                    <button type="button" onClick={() => setPage(Math.min(pages - 1, cur + 1))} disabled={cur >= pages - 1} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40">{tl("spydeckStores", "Next")}</button>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { MagnifyingGlass, Binoculars, LockSimple, Check, TrendUp, Heart, Warning, SlidersHorizontal, CheckCircle, Storefront } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { searchEtsy, getSpydeckSaves, saveSpydeckListing, unsaveSpydeckListing, getSpydeckTrending, getEtsyCategories, ApiError, type EtsyListing, type SavedListing, type EtsyCategory } from "@/lib/api"
import { hasSpydeck, getSpydeckConfig } from "@/lib/plans"
import { detectTrademarks } from "@/lib/trademarks"
import { PublishProductDialog } from "@/components/app/publish-product-dialog"
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
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
      <div className="truncate text-[15px] font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-[10px] font-medium text-muted-foreground">
        {label}{sub ? <span className="text-muted-foreground/60"> · {sub}</span> : null}
      </div>
    </div>
  )
}

// One research card — image (price + TRENDING overlay) + heart-to-save + estimate
// stat boxes + the listing's up-to-13 keyword tags (clickable to research + copy all).
function ResultCard({ l, saved, uploaded, onToggleSave, onSearchTag, onMakeProduct }: { l: EtsyListing; saved: boolean; uploaded?: boolean; onToggleSave: (l: EtsyListing) => void; onSearchTag: (t: string) => void; onMakeProduct: (l: EtsyListing) => void }) {
  const e = estFor(l)
  const trending = e.trending
  const tags = (l.tags ?? []).slice(0, 13)
  const tmHits = detectTrademarks(`${l.title} ${(l.tags ?? []).join(" ")}`)
  const [copied, setCopied] = useState(false)
  const copyAll = async () => {
    try { await navigator.clipboard.writeText(tags.join(", ")); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={(ev) => { ev.preventDefault(); onToggleSave(l) }}
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
          {l.image ? (
            <Image src={l.image} alt={l.title} fill unoptimized className="object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground"><Binoculars size={22} weight="duotone" /></div>
          )}
          {trending && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
              <TrendUp size={11} weight="bold" /> Trending
            </span>
          )}
          {/* Price — always visible on the image, out of the stats. */}
          <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-1 text-sm font-bold tabular-nums text-white backdrop-blur">
            <span title={l.price_converted ? origPrice(l.price, l.currency) : undefined}>{money(l.price, l.currency, l.price_usd, l.price_converted)}</span>
          </span>
        </div>
        <div className="flex flex-1 flex-col p-3">
          <div className="line-clamp-2 text-sm font-medium leading-snug">{l.title}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{l.shop_name || "—"}</div>

          {/* Trademark heads-up — static keyword match, not legal advice. */}
          {tmHits.length > 0 && (
            <div
              className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-700"
              title="Heuristic check — a listing mentioning a known brand may risk trademark takedown. Verify before copying the idea."
            >
              <Warning size={13} weight="fill" className="mt-px shrink-0" />
              <span>Possible trademark: {tmHits.slice(0, 3).join(", ")}{tmHits.length > 3 ? "…" : ""}</span>
            </div>
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
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tags.length} keywords</span>
                <button type="button" onClick={(ev) => { ev.preventDefault(); copyAll() }} className="text-[10px] font-medium text-primary hover:underline">
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
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] leading-tight text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pinned to the card bottom so cards with more keywords don't misalign the button row */}
          <div className="mt-auto pt-3">
            <button
              type="button"
              onClick={(ev) => { ev.preventDefault(); onMakeProduct(l) }}
              className={"flex w-full items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-semibold transition-colors " + (uploaded ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground")}
            >
              {uploaded ? <><CheckCircle size={13} weight="fill" /> Uploaded — draft</> : <><Storefront size={13} weight="bold" /> Make product</>}
            </button>
          </div>
        </div>
      </a>
    </div>
  )
}

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
      <span className="text-[11px] font-medium text-muted-foreground">{label}{hint ? <span className="text-muted-foreground/60"> · {hint}</span> : null}</span>
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
  const [entitled, setEntitled] = useState(true)
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    const sync = () => { setEntitled(hasSpydeck()); setChecked(true) }
    const id = setTimeout(sync, 0)
    window.addEventListener("eg-plan-changed", sync)
    return () => {
      clearTimeout(id)
      window.removeEventListener("eg-plan-changed", sync)
    }
  }, [])

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<EtsyListing[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState("")
  const [view, setView] = useState<"trending" | "search" | "saved" | "uploaded" | "account">("trending")
  const [saved, setSaved] = useState<SavedListing[]>([])
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  // "Make product" → Etsy draft. Track which listings have been uploaded (this session).
  const [makeListing, setMakeListing] = useState<EtsyListing | null>(null)
  const [uploaded, setUploaded] = useState<EtsyListing[]>([])
  const [uploadedIds, setUploadedIds] = useState<Set<string>>(new Set())
  const onPublished = (l: EtsyListing) => {
    const k = String(l.listing_id)
    setUploadedIds((prev) => new Set(prev).add(k))
    setUploaded((prev) => (prev.some((x) => String(x.listing_id) === k) ? prev : [{ ...l }, ...prev]))
  }
  // `keywords` still comes back from the trending endpoint; it's just not rendered
  // here any more (the Search tab's keyword cloud covers it).
  const [trending, setTrending] = useState<{ products: EtsyListing[]; keywords: string[] } | null>(null)
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
  const resultsList = useMemo(() => applyClientFilters(results ?? []), [applyClientFilters, results])
  const trendingPaged = usePaged(trendingList, 24)
  const resultsPaged = usePaged(resultsList, 24)
  const savedPaged = usePaged(saved, 24)
  const uploadedPaged = usePaged(uploaded, 24)

  // Auto-load the daily trending feed (server-cached) so SpyDeck opens populated.
  useEffect(() => {
    if (!entitled) return
    const id = setTimeout(() => {
      getSpydeckTrending()
        .then((r) => setTrending({ products: r.products ?? [], keywords: r.keywords ?? [] }))
        .catch(() => setTrending({ products: [], keywords: [] }))
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

  const toggleSave = async (l: EtsyListing) => {
    const key = String(l.listing_id)
    const isSaved = savedIds.has(key)
    // Optimistic update.
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (isSaved) next.delete(key)
      else next.add(key)
      return next
    })
    setSaved((prev) => (isSaved ? prev.filter((x) => String(x.listing_id) !== key) : [{ ...l }, ...prev]))
    try {
      if (isSaved) await unsaveSpydeckListing(l.listing_id)
      else await saveSpydeckListing(l)
    } catch {
      // Revert on failure.
      setSavedIds((prev) => {
        const next = new Set(prev)
        if (isSaved) next.add(key)
        else next.delete(key)
        return next
      })
    }
  }

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
      }
      const r = await searchEtsy(q, {
        limit: 48,
        ...sortMap[sortSel],
        taxonomyId: cat || undefined,
        minPrice: Number(minPrice) || undefined,
        maxPrice: Number(maxPrice) || undefined,
      })
      setResults(r.results ?? [])
      setSearched(q)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError("Sign in to research Etsy listings.")
      else if (e instanceof ApiError && e.status === 500) setError("Etsy isn't configured on the server yet.")
      else setError(e instanceof Error ? e.message : "Search failed.")
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  // Stats reflect whatever's on screen — search results, or the trending feed when
  // no search has run yet — so the cards fill in without a search.
  const stats = useMemo(() => {
    const list = (view === "saved" ? saved : view === "trending" || results === null ? (trending?.products ?? []) : results) ?? []
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
  }, [view, results, trending, saved])

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
          description={cloud.live ? "Aggregated from the current search — click any to dig in" : "Popular niches to explore — bigger = hotter. Click to research."}
        >
          <KeywordCloud words={cloud.words} onPick={(t) => run(t)} />
        </SectionCard>
      )}

      <SectionCard
        title="Product research"
        description="Spy live Etsy listings and save the winners"
        actions={
          <div className="flex rounded-lg border border-border p-0.5">
            {(["trending", "search", "saved", "uploaded", "account"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={
                  "eg-tap rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors " +
                  (view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {v === "saved" ? `Saved${saved.length ? ` (${saved.length})` : ""}` : v === "uploaded" ? `Uploaded${uploaded.length ? ` (${uploaded.length})` : ""}` : v === "trending" ? "Trending" : v === "account" ? "My shop" : "Search"}
              </button>
            ))}
          </div>
        }
      >
        {view === "search" && (
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
              <Button variant="outline" onClick={() => setShowFilters((s) => !s)} className={showFilters ? "border-primary text-primary" : ""}>
                <SlidersHorizontal size={15} weight="bold" /> Filters
              </Button>
              <Button onClick={() => run()} disabled={loading || (!query.trim() && !hasFilter)}>
                {loading ? "Searching…" : "Search"}
              </Button>
            </div>

            {showFilters && (
              <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-3 lg:grid-cols-6">
                <FilterField label="Category">
                  <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                    <option value="">All</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </FilterField>
                <FilterField label="Sort by">
                  <select value={sortSel} onChange={(e) => setSortSel(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                    <option value="relevance">Relevance</option>
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


        {view === "account" ? (
          <ShopAnalyzer />
        ) : view === "trending" ? (
          trending === null ? (
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[320px] animate-pulse rounded-2xl bg-muted" />)}
            </div>
          ) : trending.products.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Today&apos;s trending feed isn&apos;t available yet — try a search, or check back shortly.</div>
          ) : (
            <>
              {/* No keyword chips or methodology note here — the keyword cloud lives on
                  the Search tab, and repeating it above the feed was redundant. */}
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {trendingPaged.pageItems.map((l) => (
                  <ResultCard key={l.listing_id} l={l} saved={savedIds.has(String(l.listing_id))} uploaded={uploadedIds.has(String(l.listing_id))} onToggleSave={toggleSave} onSearchTag={(t) => run(t)} onMakeProduct={setMakeListing} />
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
                <ResultCard key={l.listing_id} l={l} saved={savedIds.has(String(l.listing_id))} uploaded onToggleSave={toggleSave} onSearchTag={(t) => run(t)} onMakeProduct={setMakeListing} />
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
                <ResultCard key={l.listing_id} l={l} saved={savedIds.has(String(l.listing_id))} uploaded={uploadedIds.has(String(l.listing_id))} onToggleSave={toggleSave} onSearchTag={(t) => run(t)} onMakeProduct={setMakeListing} />
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
                onSearchTag={(t) => run(t)}
                onMakeProduct={setMakeListing}
              />
            ))}
          </div>
          <Pagination page={resultsPaged.page} pageCount={resultsPaged.pageCount} perPage={resultsPaged.perPage} total={resultsPaged.total} start={resultsPaged.start} onPage={resultsPaged.setPage} onPerPage={resultsPaged.setPerPage} perPageOptions={[24, 48, 96]} />
          </>
        )}
      </SectionCard>

      {/* Same dialog the design maker uses — only the prefill source differs. A spy'd
          listing supplies title/description/tags/images; the blank is chosen in the
          dialog, which is what makes cost and margin computable. */}
      <PublishProductDialog
        open={!!makeListing}
        onOpenChange={(v) => !v && setMakeListing(null)}
        prefill={makeListing ? {
          title: makeListing.title,
          description: makeListing.description,
          // Prefer the USD-converted price so the seller starts from a comparable number.
          price: makeListing.price_usd ?? makeListing.price,
          tags: makeListing.tags ?? [],
          images: (makeListing.images?.length ? makeListing.images : makeListing.image ? [makeListing.image] : []).filter(Boolean) as string[],
        } : null}
        onPublished={() => { if (makeListing) onPublished(makeListing) }}
        title="Make product"
      />
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
        <Link href="/settings" className={cn(buttonVariants(), "mt-6 w-full sm:w-auto")}>
          Upgrade or add SpyDeck
        </Link>
      </div>
    </div>
  )
}

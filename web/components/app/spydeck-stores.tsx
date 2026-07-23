"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { MagnifyingGlass, Heart, Storefront, Star, ArrowLeft, ArrowSquareOut, CircleNotch, Package } from "@phosphor-icons/react"
import {
  searchSpydeckShops, getSpydeckShopListings, getSpydeckSavedShops, saveSpydeckShop, unsaveSpydeckShop,
  getSpydeckShopsByCategory, getEtsyCategories,
  type SpyShop, type EtsyListing, type EtsyCategory,
} from "@/lib/api"
import { ResultCard } from "@/components/app/spydeck-view"

// Shared listing-level handlers, threaded from SpyDeckView so a competitor's product can be
// saved or turned into a draft with the exact same flow as any other research card.
type Handlers = {
  savedIds: Set<string>
  uploadedIds: Set<string>
  onToggleSave: (l: EtsyListing, wasSaved: boolean) => void
  onSearchTag: (t: string) => void
  onMakeProduct: (l: EtsyListing) => void
}

const fmtK = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n)

const priceStr = (l: EtsyListing) =>
  l.price_usd != null ? `$${Number(l.price_usd).toFixed(2)}`
    : l.price != null ? `${l.currency === "USD" ? "$" : ""}${l.price}${l.currency && l.currency !== "USD" ? " " + l.currency : ""}`
      : ""

function ShopCard({ s, saved, onToggle, onOpen }: { s: SpyShop; saved: boolean; onToggle: (s: SpyShop) => void; onOpen: (s: SpyShop) => void }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
          {s.icon
            ? <Image src={s.icon} alt={s.shop_name || "shop"} fill unoptimized sizes="48px" className="object-cover" />
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

      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-muted/50 py-1.5"><div className="text-sm font-semibold tabular-nums">{fmtK(s.listings)}</div><div className="text-[10px] text-muted-foreground">Products</div></div>
        <div className="rounded-lg bg-muted/50 py-1.5"><div className="text-sm font-semibold tabular-nums">{fmtK(s.sales)}</div><div className="text-[10px] text-muted-foreground">Sales</div></div>
        <div className="rounded-lg bg-muted/50 py-1.5"><div className="flex items-center justify-center gap-0.5 text-sm font-semibold tabular-nums">{s.rating != null ? <>{s.rating.toFixed(1)}<Star size={11} weight="fill" className="text-amber-500" /></> : "—"}</div><div className="text-[10px] text-muted-foreground">{fmtK(s.reviews)} reviews</div></div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => onOpen(s)} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary/10 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground">
          <Package size={13} weight="bold" /> View catalog
        </button>
        {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent" title="Open on Etsy"><ArrowSquareOut size={15} /></a>}
      </div>
    </div>
  )
}

export function StoresTab(h: Handlers) {
  const [query, setQuery] = useState("")
  const [shops, setShops] = useState<SpyShop[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"search" | "saved">("search")
  const [saved, setSaved] = useState<SpyShop[]>([])
  const [savedShopIds, setSavedShopIds] = useState<Set<string>>(new Set())
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
    setLoading(true); setError(null); setTab("search"); setQuery("")
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
    setLoading(true); setError(null); setTab("search")
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
    setOpen(s); setCatalog(null); setCatLoading(true)
    try { const r = await getSpydeckShopListings(s.shop_id); setCatalog(r.listings ?? []) }
    catch { setCatalog([]) }
    finally { setCatLoading(false) }
  }

  // ── Catalog view (one shop's products) ───────────────────────────────────────
  if (open) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
          <button type="button" onClick={() => { setOpen(null); setCatalog(null) }} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent">
            <ArrowLeft size={14} weight="bold" /> Back
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
                {v === "gallery" ? "Gallery" : "Details"}
              </button>
            ))}
          </div>
          {open.url && <a href={open.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open on Etsy <ArrowSquareOut size={12} /></a>}
        </div>
        {catLoading ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[320px] animate-pulse rounded-2xl bg-muted" />)}
          </div>
        ) : !(catalog && catalog.length) ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No active listings returned for this shop.</div>
        ) : catView === "gallery" ? (
          // Image-first: big photos, price overlay, title beneath — click through to Etsy.
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {catalog.map((l) => (
              <a key={l.listing_id} href={l.url} target="_blank" rel="noopener noreferrer" className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md">
                <div className="relative aspect-square overflow-hidden bg-muted">
                  {(l.thumb || l.image) ? (
                    <Image src={l.thumb || l.image || ""} alt={l.title} fill unoptimized sizes="(max-width:640px) 50vw, 20vw" className="object-cover transition-transform duration-300 group-hover:scale-105" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-muted-foreground"><Package size={20} weight="duotone" /></span>
                  )}
                  {priceStr(l) && <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white">{priceStr(l)}</span>}
                </div>
                <div className="line-clamp-1 px-2 py-1.5 text-[11px] leading-tight text-muted-foreground">{l.title}</div>
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
            placeholder="Search competitor stores by name…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={run} disabled={loading || !query.trim()} className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {loading ? <CircleNotch size={14} className="animate-spin" /> : "Search"}
          </button>
        </div>
        {categories.length > 0 && (
          <select
            value={catId}
            onChange={(e) => byCategory(e.target.value)}
            title="Discover shops selling in a category"
            className="rounded-full border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <option value="">Browse by category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1 rounded-full bg-muted p-1">
          {(["search", "saved"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={"rounded-full px-3 py-1 text-xs font-medium transition-colors " + (tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t === "saved" ? `Saved${saved.length ? ` (${saved.length})` : ""}` : "Results"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="px-5 pt-3 text-xs text-rose-600">{error}</div>}

      {tab === "search" && shops === null ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Storefront size={24} weight="duotone" /></span>
          <div className="font-medium">Research a competitor</div>
          <div className="max-w-xs text-sm text-muted-foreground">Search any Etsy shop by name to see its product count, sales, reviews — then open its full catalog.</div>
        </div>
      ) : list && list.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">{tab === "saved" ? "No saved stores yet — hit the heart on any store." : "No stores match that name."}</div>
      ) : (
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(list ?? []).map((s) => (
            <ShopCard key={s.shop_id} s={s} saved={savedShopIds.has(s.shop_id)} onToggle={toggleSaveShop} onOpen={openShop} />
          ))}
        </div>
      )}
    </div>
  )
}

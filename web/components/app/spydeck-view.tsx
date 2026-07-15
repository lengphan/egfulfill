"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { MagnifyingGlass, Binoculars, LockSimple, Check, TrendUp, Heart, Info } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { searchEtsy, getSpydeckSaves, saveSpydeckListing, unsaveSpydeckListing, ApiError, type EtsyListing, type SavedListing } from "@/lib/api"
import { hasSpydeck, getSpydeckConfig } from "@/lib/plans"

const money = (n: number | null, cur = "USD") =>
  n == null ? "—" : `${cur === "USD" ? "$" : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

// A small labelled stat box — the old SpyDeck research card treatment. `sub` is the
// time-window qualifier (24h / All time).
function StatBox({ label, sub, value }: { label: string; sub?: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-1.5 py-1.5 text-center leading-tight">
      <div className="truncate text-[13px] font-bold tabular-nums">{value}</div>
      <div className="text-[8.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}{sub ? <span className="ml-0.5 font-normal normal-case text-muted-foreground/70">{sub}</span> : null}
      </div>
    </div>
  )
}

// One research card — image + TRENDING badge + heart-to-save + estimate stat boxes.
function ResultCard({ l, saved, onToggleSave }: { l: EtsyListing; saved: boolean; onToggleSave: (l: EtsyListing) => void }) {
  const e = estFor(l)
  const trending = e.trending
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* Save/favorite — stops the card link, toggles the saved state. */}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); onToggleSave(l) }}
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
        </div>
        <div className="flex flex-1 flex-col p-3">
          {/* Estimate boxes — Views/Sold (24h) + Revenue/Sold (all time). */}
          <div className="grid grid-cols-2 gap-1.5">
            <StatBox label="Views" sub="24h" value={fmtK(e.views24)} />
            <StatBox label="Sold" sub="24h" value={fmtK(e.sold24)} />
            <StatBox label="Revenue" sub="all" value={moneyK(e.revenue)} />
            <StatBox label="Sold" sub="all" value={fmtK(e.totalSold)} />
          </div>
          <div className="mt-2 line-clamp-2 text-sm font-medium leading-snug">{l.title}</div>
          <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs">
            <span className="truncate text-muted-foreground">{l.shop_name || "—"}</span>
            <span className="shrink-0 font-semibold tabular-nums">{money(l.price, l.currency)}</span>
          </div>
        </div>
      </a>
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
  const [view, setView] = useState<"search" | "saved">("search")
  const [saved, setSaved] = useState<SavedListing[]>([])
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

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

  const run = async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    try {
      const r = await searchEtsy(q, { limit: 24 })
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

  const stats = useMemo(() => {
    const list = results ?? []
    // Median, not mean — one mis-priced Etsy listing (a $4k custom order) blew the
    // average up to five figures. Median is the "typical price" a seller cares about.
    const prices = list.map((l) => l.price).filter((p): p is number => p != null && p > 0).sort((a, b) => a - b)
    const median = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : 0
    const views = list.map((l) => l.views).filter((v): v is number => v != null)
    const shops = new Set(list.map((l) => l.shop_name).filter(Boolean))
    return {
      count: list.length,
      median,
      shops: shops.size,
      topViews: views.length ? Math.max(...views) : 0,
    }
  }, [results])

  if (checked && !entitled) return <SpyDeckLocked />

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Results" value={results === null ? "—" : String(stats.count)} sub={searched ? `for "${searched}"` : "run a search"} />
        <StatCard label="Median price" value={results === null ? "—" : money(stats.median)} sub="typical listing" />
        <StatCard label="Shops" value={results === null ? "—" : String(stats.shops)} sub="unique sellers" />
        <StatCard label="Most viewed" value={results === null ? "—" : stats.topViews ? stats.topViews.toLocaleString() : "—"} sub="views" tone={stats.topViews ? "pos" : undefined} />
      </StatGrid>

      <SectionCard
        title="Product research"
        description="Spy live Etsy listings and save the winners"
        actions={
          <div className="flex rounded-lg border border-border p-0.5">
            {(["search", "saved"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={
                  "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors " +
                  (view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {v === "saved" ? `Saved${saved.length ? ` (${saved.length})` : ""}` : "Search"}
              </button>
            ))}
          </div>
        }
      >
        {view === "search" && (
          <div className="flex items-center gap-2 border-b border-border p-4">
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
            <Button onClick={run} disabled={loading || !query.trim()}>
              {loading ? "Searching…" : "Search"}
            </Button>
          </div>
        )}

        {error && view === "search" && (
          <div className="border-b border-border bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">{error}</div>
        )}

        {view === "search" && results && results.length > 0 && (
          <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-5 py-2 text-xs text-muted-foreground">
            <Info size={13} /> Sold, revenue &amp; 24h numbers are <span className="font-medium">estimates</span> from favorites &amp; listing age (Etsy doesn&apos;t publish them) — use as a signal, not exact figures.
          </div>
        )}

        {view === "saved" ? (
          saved.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Heart size={24} weight="duotone" />
              </span>
              <div className="font-medium">No saved listings yet</div>
              <div className="max-w-xs text-sm text-muted-foreground">Tap the heart on any research card to save it here for later.</div>
            </div>
          ) : (
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {saved.map((l) => (
                <ResultCard key={l.listing_id} l={l} saved={savedIds.has(String(l.listing_id))} onToggleSave={toggleSave} />
              ))}
            </div>
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
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((l) => (
              <ResultCard
                key={l.listing_id}
                l={l}
                saved={savedIds.has(String(l.listing_id))}
                onToggleSave={toggleSave}
              />
            ))}
          </div>
        )}
      </SectionCard>
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

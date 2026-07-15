"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { MagnifyingGlass, ArrowSquareOut, Binoculars, LockSimple, Check, TrendUp } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { searchEtsy, ApiError, type EtsyListing } from "@/lib/api"
import { hasSpydeck, getSpydeckConfig } from "@/lib/plans"

const money = (n: number | null, cur = "USD") =>
  n == null ? "—" : `${cur === "USD" ? "$" : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Compact number (1,240 → 1.2k) for the stat boxes.
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

// A small labelled stat box — the old SpyDeck research card treatment.
function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-1.5 py-1.5 text-center leading-tight">
      <div className="truncate text-[13px] font-bold tabular-nums">{value}</div>
      <div className="text-[8.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
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
    const prices = list.map((l) => l.price).filter((p): p is number => p != null)
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
    const views = list.map((l) => l.views).filter((v): v is number => v != null)
    const shops = new Set(list.map((l) => l.shop_name).filter(Boolean))
    return {
      count: list.length,
      avg,
      shops: shops.size,
      topViews: views.length ? Math.max(...views) : 0,
    }
  }, [results])

  // Mark the standouts "Trending": the 75th-percentile of favorites among results.
  const trendThreshold = useMemo(() => {
    const favs = (results ?? []).map((l) => l.num_favorers ?? 0).filter((n) => n > 0).sort((a, b) => a - b)
    if (favs.length < 4) return Infinity // too few to call anything trending
    return favs[Math.floor(favs.length * 0.75)] || Infinity
  }, [results])

  if (checked && !entitled) return <SpyDeckLocked />

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Results" value={results === null ? "—" : String(stats.count)} sub={searched ? `for "${searched}"` : "run a search"} />
        <StatCard label="Avg price" value={results === null ? "—" : money(stats.avg)} sub="in results" />
        <StatCard label="Shops" value={results === null ? "—" : String(stats.shops)} sub="unique sellers" />
        <StatCard label="Most viewed" value={results === null ? "—" : stats.topViews ? stats.topViews.toLocaleString() : "—"} sub="views" tone={stats.topViews ? "pos" : undefined} />
      </StatGrid>

      <SectionCard title="Product research" description="Search active Etsy listings in your niche">
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

        {error && (
          <div className="border-b border-border bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">{error}</div>
        )}

        {results === null ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Binoculars size={26} weight="duotone" />
            </span>
            <div className="font-medium">Research the competition</div>
            <div className="max-w-xs text-sm text-muted-foreground">Search any keyword to spy live Etsy listings — price, views and favorites, with the standouts flagged <span className="font-medium text-rose-600">Trending</span>.</div>
          </div>
        ) : loading ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[240px] animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No listings found. Try another keyword.</div>
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((l) => {
              const trending = trendThreshold > 0 && (l.num_favorers ?? 0) >= trendThreshold
              return (
                <a
                  key={l.listing_id}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <div className="relative aspect-square overflow-hidden bg-muted/40">
                    {l.image ? (
                      <Image src={l.image} alt={l.title} fill unoptimized className="object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <Binoculars size={22} weight="duotone" />
                      </div>
                    )}
                    {trending && (
                      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                        <TrendUp size={11} weight="bold" /> Trending
                      </span>
                    )}
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <ArrowSquareOut size={10} weight="bold" /> Etsy
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col p-3">
                    <div className="line-clamp-2 text-sm font-medium leading-snug">{l.title}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{l.shop_name || "—"}</div>
                    {/* Stat boxes — the old SpyDeck research treatment, on real Etsy data. */}
                    <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                      <StatBox label="Price" value={money(l.price, l.currency)} />
                      <StatBox label="Views" value={l.views != null ? compact(l.views) : "—"} />
                      <StatBox label="Favorites" value={l.num_favorers != null ? compact(l.num_favorers) : "—"} />
                    </div>
                  </div>
                </a>
              )
            })}
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

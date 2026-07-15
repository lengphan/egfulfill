"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { MagnifyingGlass, Eye, ArrowSquareOut, Binoculars } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { searchEtsy, ApiError, type EtsyListing } from "@/lib/api"

const money = (n: number | null, cur = "USD") =>
  n == null ? "—" : `${cur === "USD" ? "$" : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function SpyDeckView() {
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
            <div className="max-w-xs text-sm text-muted-foreground">Search any keyword to see live Etsy listings — prices, shops and views.</div>
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
            {results.map((l) => (
              <a
                key={l.listing_id}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <div className="relative aspect-square overflow-hidden bg-muted/40">
                  {l.image ? (
                    <Image src={l.image} alt={l.title} fill unoptimized className="object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <Binoculars size={22} weight="duotone" />
                    </div>
                  )}
                  <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <ArrowSquareOut size={10} weight="bold" /> Etsy
                  </span>
                </div>
                <div className="p-3">
                  <div className="line-clamp-2 text-sm font-medium leading-snug">{l.title}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{l.shop_name || "—"}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-semibold tabular-nums">{money(l.price, l.currency)}</span>
                    {l.views != null && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Eye size={13} /> {l.views.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

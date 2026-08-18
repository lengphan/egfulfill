"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Storefront, CircleNotch, Sparkle, Warning, ArrowSquareOut, ArrowClockwise, Info } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Markdown } from "@/components/app/markdown"
import { Button } from "@/components/ui/button"
import { getShopAnalysis, analyzeShop, type ShopAnalysis } from "@/lib/api"

const usd = (n: number | string | null | undefined) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`
const when = (s?: string) => {
  if (!s) return ""
  const d = new Date(s)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/** Account Analyzer — reads the seller's connected Etsy shop and advises on it.
 *  Opening the tab only reads the CACHED run (free); the AI call happens when the
 *  seller explicitly asks, and the result is reused for 24h. */
export function ShopAnalyzer() {
  const [data, setData] = useState<ShopAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadCached = useCallback(() => {
    getShopAnalysis()
      .then((r) => setData(r?.cached ? r : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    const id = setTimeout(loadCached, 0)
    return () => clearTimeout(id)
  }, [loadCached])

  const run = async (refresh: boolean) => {
    setRunning(true); setErr(null)
    try {
      const r = await analyzeShop(refresh)
      if (r.error) { setErr(r.error); if (r.needsConnect) setData({ needsConnect: true }) }
      else setData(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not analyze your shop.")
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
  }

  // Not connected → point at Stores. Nothing to analyze without a shop.
  if (data?.needsConnect || err?.toLowerCase().includes("no etsy shop")) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Storefront size={24} weight="duotone" /></span>
        <div className="font-medium">No Etsy shop connected</div>
        <p className="max-w-sm text-sm text-muted-foreground">Connect your Etsy shop and we&apos;ll analyze your listings, pricing and tags, then tell you what to fix first.</p>
        <Link href="/stores"><Button size="sm" className="mt-1">Connect a shop</Button></Link>
      </div>
    )
  }

  const s = data?.stats
  const sales = data?.sales

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">{data?.shop?.shop_name || "Your shop"}</span>
            {data?.shop?.url && (
              <a href={data.shop.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground"><ArrowSquareOut size={13} weight="bold" /></a>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {data?.at ? `Last analyzed ${when(data.at)}` : "Not analyzed yet"}
            {data?.cached && " · cached"}
          </div>
        </div>
        <Button size="sm" onClick={() => run(!!data?.stats)} disabled={running}>
          {running ? <CircleNotch size={14} className="animate-spin" /> : data?.stats ? <ArrowClockwise size={14} weight="bold" /> : <Sparkle size={14} weight="fill" />}
          {running ? "Analyzing…" : data?.stats ? "Re-analyze" : "Analyze my shop"}
        </Button>
      </div>

      {err && <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><Warning size={14} weight="fill" /> {err}</div>}

      {!s && !running && !err && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Sparkle size={22} weight="duotone" />
          <div className="text-sm">Run an analysis to see how your shop is doing and what to fix.</div>
        </div>
      )}

      {s && (
        <>
          {/* Real sales beat estimates — show them first when we have them. */}
          {sales ? (
            <StatGrid>
              <StatCard label="Revenue" value={usd(sales.revenue)} sub={`last ${sales.windowDays}d · real`} tone="pos" />
              <StatCard label="Orders" value={String(sales.orders)} sub={`last ${sales.windowDays}d · real`} />
              <StatCard label="Avg order" value={usd(sales.avgOrderValue)} sub="real" />
              <StatCard label="Active listings" value={String(s.listingCount)} sub={`${s.totalFavorites.toLocaleString()} favorites`} />
            </StatGrid>
          ) : (
            <StatGrid>
              <StatCard label="Active listings" value={String(s.listingCount)} sub="on Etsy" />
              <StatCard label="Favorites" value={s.totalFavorites.toLocaleString()} sub="all listings" />
              <StatCard label="Median price" value={`$${s.medianPrice}`} sub={s.priceRange ? `$${s.priceRange.min}–$${s.priceRange.max}` : "—"} />
              <StatCard label="Est. revenue" value={usd(s.estRevenue)} sub="all time · estimate" />
            </StatGrid>
          )}

          {!sales && (
            <div className="flex items-start gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>No synced Etsy orders yet, so sales are <b>estimated</b> from favorites &amp; listing age. Etsy publishes no views or conversion data — once your orders sync, this switches to your real numbers.</span>
            </div>
          )}

          {/* Fixable, countable problems — the concrete half of the advice. */}
          <SectionCard title="Listing health">
            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              {[
                { label: "Missing tags", n: s.issues.noTags, hint: "no tags at all" },
                { label: "Thin tags", n: s.issues.thinTags, hint: "under 13 of 13" },
                { label: "Short titles", n: s.issues.shortTitles, hint: "under 40 chars" },
                { label: "One image", n: s.issues.singleImage, hint: "fewer than 2" },
              ].map((it) => (
                <div key={it.label} className="bg-card p-4">
                  <div className={"text-xl font-bold tabular-nums " + (it.n ? "text-amber-600" : "text-success")}>{it.n}</div>
                  <div className="text-xs font-medium">{it.label}</div>
                  <div className="text-2xs text-muted-foreground">{it.hint}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Average {s.avgTags} of 13 tags per listing.</div>
          </SectionCard>

          {s.topTags.length > 0 && (
            <SectionCard title="Your most-used tags">
              <div className="flex flex-wrap gap-1.5 p-4">
                {s.topTags.map((t) => (
                  <span key={t.tag} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{t.tag} <span className="opacity-60">×{t.n}</span></span>
                ))}
              </div>
            </SectionCard>
          )}

          {sales && sales.topSellers.length > 0 && (
            <SectionCard title="Best sellers">
              <div className="divide-y divide-border">
                {sales.topSellers.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 shrink-0 text-xs font-bold text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{t.name || "—"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{t.units} sold</span>
                    <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">{usd(t.revenue)}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {data?.aiError && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <Warning size={14} weight="fill" /> {data.aiError}
            </div>
          )}
          {data?.advice && (
            <SectionCard title={<span className="flex items-center gap-1.5"><Sparkle size={14} weight="fill" className="text-primary" /> Recommendations</span>}>
              <div className="p-5"><Markdown>{data.advice}</Markdown></div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  )
}

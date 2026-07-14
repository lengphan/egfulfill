import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"

const tracked = [
  { name: "Vintage Sunset Tee", shop: "RetroThreads", sales: "1,204 / mo", price: "$24.99", trend: "+18%" },
  { name: "Minimalist Line Hoodie", shop: "NorthLabel", sales: "860 / mo", price: "$39.00", trend: "+9%" },
  { name: "Retro Coffee Mug", shop: "DailyBrew", sales: "2,010 / mo", price: "$14.50", trend: "+31%" },
  { name: "Botanical Tote", shop: "GreenGoods", sales: "540 / mo", price: "$19.00", trend: "+4%" },
  { name: "Type Poster Set", shop: "PrintHaus", sales: "1,780 / mo", price: "$29.00", trend: "+22%" },
  { name: "Embroidered Cap", shop: "CapCo", sales: "690 / mo", price: "$22.00", trend: "+6%" },
]

export default function SpyDeckPage() {
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Tracked products" value="42" sub="across 12 shops" />
        <StatCard label="Trending up" value="9" sub="this week" tone="pos" />
        <StatCard label="Avg price" value="$23.40" sub="in your niche" />
        <StatCard label="New listings" value="17" sub="last 7 days" />
      </StatGrid>

      <SectionCard title="Tracked competitors" description="Best sellers in your niche">
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {tracked.map((t) => (
            <Card key={t.name} className="gap-3 p-4">
              <div className="aspect-video rounded-md bg-muted" aria-hidden />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.shop}</div>
                </div>
                <Badge variant="secondary" className="shrink-0 bg-emerald-100 text-emerald-700">
                  {t.trend}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.sales}</span>
                <span className="font-medium tabular-nums">{t.price}</span>
              </div>
            </Card>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

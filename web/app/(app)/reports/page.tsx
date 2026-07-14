import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const channels = [
  { name: "Etsy", pct: 62, revenue: "$29,880" },
  { name: "Shopify", pct: 28, revenue: "$13,490" },
  { name: "Manual", pct: 10, revenue: "$4,820" },
]

const top = [
  { name: "Heavyweight Hoodie", units: 312, revenue: "$13,104" },
  { name: "Classic Tee", units: 588, revenue: "$10,584" },
  { name: "Embroidered Cap", units: 240, revenue: "$5,760" },
  { name: "Ceramic Mug 15oz", units: 410, revenue: "$5,248" },
]

export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Revenue (30d)" value="$48,204" sub="↑ 8.1% vs prev" tone="pos" />
        <StatCard label="Orders (30d)" value="1,284" sub="↑ 4.2% vs prev" tone="pos" />
        <StatCard label="Avg order value" value="$37.54" sub="↓ 1.1% vs prev" tone="neg" />
        <StatCard label="Refund rate" value="1.8%" sub="of orders" />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Revenue by channel" description="Last 30 days" bodyClassName="space-y-4 p-5">
          {channels.map((c, i) => (
            <div key={c.name}>
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {c.revenue} · {c.pct}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${c.pct}%`, backgroundColor: `var(--chart-${i + 1})` }}
                />
              </div>
            </div>
          ))}
        </SectionCard>

        <SectionCard title="Top products" description="By revenue, last 30 days">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((t) => (
                <TableRow key={t.name}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{t.units}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{t.revenue}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
    </div>
  )
}

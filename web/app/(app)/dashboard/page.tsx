import { StatCard, StatGrid } from "@/components/app/stat-card"
import { SectionCard } from "@/components/app/section-card"
import { StatusBadge } from "@/components/app/status-badge"
import { RevenueChart } from "@/components/app/revenue-chart"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const recent = [
  { id: "#4142", customer: "A. Nguyen", items: "Hoodie · black ×1", status: "Production", total: "$63.75", date: "Apr 12" },
  { id: "#4140", customer: "M. Tran", items: "Tee · 2-pack", status: "Shipped", total: "$27.00", date: "Apr 11" },
  { id: "#4131", customer: "J. Pham", items: "Embroidered cap ×1", status: "QC", total: "$31.50", date: "Apr 11" },
  { id: "#4126", customer: "K. Le", items: "Crewneck · sand ×1", status: "Packed", total: "$44.20", date: "Apr 10" },
  { id: "#4119", customer: "T. Vo", items: "Tote · natural ×2", status: "New", total: "$16.80", date: "Apr 09" },
]

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Orders today" value="128" sub="↑ 12% vs yesterday" tone="pos" />
        <StatCard label="Revenue (MTD)" value="$48,204" sub="↑ 8.1% vs last month" tone="pos" />
        <StatCard label="Open orders" value="37" sub="in the pipeline" />
        <StatCard label="Avg turnaround" value="1.8d" sub="order → shipped" />
      </StatGrid>

      <RevenueChart />

      <SectionCard
        title="Recent orders"
        description="Latest activity across your stores"
        actions={
          <Button variant="outline" size="sm">
            View all
          </Button>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-semibold">{o.id}</TableCell>
                <TableCell>{o.customer}</TableCell>
                <TableCell className="text-muted-foreground">{o.items}</TableCell>
                <TableCell>
                  <StatusBadge status={o.status} />
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{o.total}</TableCell>
                <TableCell className="text-right text-muted-foreground">{o.date}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  )
}

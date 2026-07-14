import { MagnifyingGlass, DownloadSimple, Plus } from "@phosphor-icons/react/dist/ssr"
import { SectionCard } from "@/components/app/section-card"
import { StatusBadge } from "@/components/app/status-badge"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const orders = [
  { id: "#4142", store: "Etsy", customer: "A. Nguyen", item: "Hoodie · black", qty: 1, status: "Production", total: "$63.75", date: "Apr 12" },
  { id: "#4140", store: "Shopify", customer: "M. Tran", item: "Tee · 2-pack", qty: 2, status: "Shipped", total: "$27.00", date: "Apr 11" },
  { id: "#4131", store: "Etsy", customer: "J. Pham", item: "Embroidered cap", qty: 1, status: "QC", total: "$31.50", date: "Apr 11" },
  { id: "#4126", store: "Manual", customer: "K. Le", item: "Crewneck · sand", qty: 1, status: "Packed", total: "$44.20", date: "Apr 10" },
  { id: "#4119", store: "Shopify", customer: "T. Vo", item: "Tote · natural", qty: 2, status: "New", total: "$16.80", date: "Apr 09" },
  { id: "#4110", store: "Etsy", customer: "H. Dang", item: "Mug · 15oz", qty: 3, status: "Queued", total: "$38.40", date: "Apr 08" },
]

export default function OrdersPage() {
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="New" value="12" sub="awaiting review" />
        <StatCard label="In production" value="18" sub="on the floor" />
        <StatCard label="Shipped (7d)" value="204" sub="↑ 6% vs prev" tone="pos" />
        <StatCard label="Needs attention" value="3" sub="unfunded / on hold" tone="neg" />
      </StatGrid>

      <SectionCard
        title="Orders"
        actions={
          <>
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="new">New</TabsTrigger>
                <TabsTrigger value="prod">Production</TabsTrigger>
                <TabsTrigger value="shipped">Shipped</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button size="sm">
              <Plus size={14} weight="bold" /> New order
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative max-w-xs flex-1">
            <MagnifyingGlass size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search orders…" className="h-9 pl-8" />
          </div>
          <Button variant="outline" size="sm" className="ml-auto">
            <DownloadSimple size={14} /> Export
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-semibold">{o.id}</TableCell>
                <TableCell className="text-muted-foreground">{o.store}</TableCell>
                <TableCell>{o.customer}</TableCell>
                <TableCell className="text-muted-foreground">{o.item}</TableCell>
                <TableCell className="text-right tabular-nums">{o.qty}</TableCell>
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

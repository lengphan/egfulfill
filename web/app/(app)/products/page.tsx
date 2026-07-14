import { MagnifyingGlass, Plus } from "@phosphor-icons/react/dist/ssr"
import { SectionCard } from "@/components/app/section-card"
import { StatusBadge } from "@/components/app/status-badge"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const products = [
  { name: "Heavyweight Hoodie", sku: "HOOD-HW", cat: "Apparel", price: "$42.00", stock: "In stock", status: "Active" },
  { name: "Classic Tee", sku: "TEE-CL", cat: "Apparel", price: "$18.00", stock: "In stock", status: "Active" },
  { name: "Embroidered Cap", sku: "CAP-EMB", cat: "Headwear", price: "$24.00", stock: "Low", status: "Active" },
  { name: "Canvas Tote", sku: "TOTE-CV", cat: "Bags", price: "$14.00", stock: "In stock", status: "Draft" },
  { name: "Ceramic Mug 15oz", sku: "MUG-15", cat: "Drinkware", price: "$12.80", stock: "Out", status: "Paused" },
]

export default function ProductsPage() {
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Active products" value="48" sub="published to catalog" />
        <StatCard label="Low stock" value="6" sub="reorder soon" tone="neg" />
        <StatCard label="Drafts" value="9" sub="not yet published" />
        <StatCard label="Best seller" value="Hoodie" sub="312 sold (30d)" tone="pos" />
      </StatGrid>

      <SectionCard
        title="Products"
        actions={
          <Button size="sm">
            <Plus size={14} weight="bold" /> Add product
          </Button>
        }
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative max-w-xs flex-1">
            <MagnifyingGlass size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search products…" className="h-9 pl-8" />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.sku}>
                <TableCell className="flex items-center gap-3 font-medium">
                  <span className="size-8 shrink-0 rounded-md bg-muted" aria-hidden />
                  {p.name}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{p.sku}</TableCell>
                <TableCell className="text-muted-foreground">{p.cat}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{p.price}</TableCell>
                <TableCell className="text-muted-foreground">{p.stock}</TableCell>
                <TableCell>
                  <StatusBadge status={p.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  )
}

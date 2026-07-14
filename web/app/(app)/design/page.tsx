import { Plus } from "@phosphor-icons/react/dist/ssr"
import { SectionCard } from "@/components/app/section-card"
import { StatusBadge } from "@/components/app/status-badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

const designs = [
  { name: "Summer Collection", items: 12, status: "Active" },
  { name: "Retro Type Pack", items: 8, status: "Active" },
  { name: "Botanical Line", items: 15, status: "Draft" },
  { name: "Monogram Set", items: 6, status: "Active" },
  { name: "Holiday 2026", items: 20, status: "Draft" },
  { name: "Minimal Marks", items: 9, status: "Active" },
  { name: "Sports Numbers", items: 30, status: "Active" },
  { name: "Vintage Badges", items: 11, status: "Paused" },
]

export default function DesignPage() {
  return (
    <div className="space-y-4">
      <SectionCard
        title="Design Lab"
        description="Your artwork libraries and print-ready templates"
        actions={
          <Button size="sm">
            <Plus size={14} weight="bold" /> New design
          </Button>
        }
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {designs.map((d) => (
            <Card key={d.name} className="gap-0 overflow-hidden p-0">
              <div className="aspect-square bg-muted" aria-hidden />
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{d.name}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{d.items} designs</div>
              </div>
            </Card>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

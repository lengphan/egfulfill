"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Plus, PenNib } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatusBadge } from "@/components/app/status-badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { getDesignCards, type DesignCard } from "@/lib/api"
import { getToken } from "@/lib/auth"

// Signed-out preview only — a real account sees its own design cards (or an empty state).
const DEMO: DesignCard[] = [
  { id: "d1", title: "Summer Collection", product: "Tee · DTG", type: "DTG", pay_status: "paid" },
  { id: "d2", title: "Retro Type Pack", product: "Hoodie · DTG", type: "DTG", pay_status: "paid" },
  { id: "d3", title: "Botanical Line", product: "Tote · Screen", type: "Screen", pay_status: "unpaid" },
  { id: "d4", title: "Monogram Set", product: "Cap · Embroidery", type: "EMB", pay_status: "paid" },
  { id: "d5", title: "Holiday 2026", product: "Crewneck · DTG", type: "DTG", pay_status: "unpaid" },
  { id: "d6", title: "Minimal Marks", product: "Tee · DTG", type: "DTG", pay_status: "paid" },
]

const statusOf = (c: DesignCard) => {
  const s = (c.pay_status || "").toLowerCase()
  if (s === "paid") return "Active"
  if (s === "unpaid" || s === "pending") return "Draft"
  return c.type || "Active"
}

export default function DesignPage() {
  const [cards, setCards] = useState<DesignCard[] | null>(null)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      const signedIn = !!getToken()
      getDesignCards()
        .then((rows) => {
          if (!alive) return
          if (rows && rows.length) { setCards(rows); setIsDemo(false) }
          else { setCards(signedIn ? [] : DEMO); setIsDemo(!signedIn) }
        })
        .catch(() => {
          if (!alive) return
          setCards(signedIn ? [] : DEMO); setIsDemo(!signedIn)
        })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [])

  const list = useMemo(() => cards ?? [], [cards])

  return (
    <div className="space-y-4">
      <SectionCard
        title="Design Lab"
        description="Artwork and print-ready designs attached to your orders"
        actions={
          <Button size="sm" disabled title="Design creation is coming to this screen soon">
            <Plus size={14} weight="bold" /> New design
          </Button>
        }
      >
        {isDemo && (
          <div className="border-b border-border bg-amber-50 px-5 py-2 text-xs font-medium text-amber-700">
            Showing sample designs — sign in to see your own.
          </div>
        )}

        {cards === null ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <PenNib size={22} weight="duotone" />
            </span>
            <div className="font-medium">No designs yet</div>
            <div className="max-w-xs text-sm text-muted-foreground">
              Designs appear here once you attach artwork to an order. Create an order to get started.
            </div>
          </div>
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((d) => (
              <Card key={String(d.id)} className="gap-0 overflow-hidden p-0">
                <div className="relative flex aspect-square items-center justify-center bg-muted">
                  {d.thumb ? (
                    <Image src={d.thumb} alt={d.title ?? ""} fill unoptimized sizes="240px" className="object-cover" />
                  ) : (
                    <PenNib size={26} weight="duotone" className="text-muted-foreground/40" />
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{d.title || d.sku || "Untitled"}</span>
                    <StatusBadge status={statusOf(d)} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{d.product || d.type || "Design"}</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

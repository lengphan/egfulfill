"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, PenNib, Trash } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DesignStudioDialog } from "@/components/app/design-studio"
import { getDesignLibrary, deleteDesignLibrary, type LibraryDesign } from "@/lib/api"
import { getToken } from "@/lib/auth"

const fmtDate = (s?: string) => {
  if (!s) return ""
  const d = new Date(s)
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function DesignPage() {
  const [designs, setDesigns] = useState<LibraryDesign[] | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)

  const load = useCallback(() => {
    if (!getToken()) { setSignedOut(true); setDesigns([]); return }
    getDesignLibrary().then((r) => setDesigns(r ?? [])).catch(() => setDesigns([]))
  }, [])
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  const remove = async (id: number | string) => {
    setDesigns((prev) => (prev ?? []).filter((d) => d.id !== id))
    try { await deleteDesignLibrary(id) } catch { load() }
  }

  const list = designs ?? []

  return (
    <div className="space-y-4">
      <SectionCard
        title="Design Lab"
        description="Create and store reusable designs, then drop them onto orders"
        actions={
          <Button size="sm" onClick={() => setStudioOpen(true)} disabled={signedOut}>
            <Plus size={14} weight="bold" /> New design
          </Button>
        }
      >
        {designs === null ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-52 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <PenNib size={22} weight="duotone" />
            </span>
            <div className="font-medium">{signedOut ? "Sign in to build your design library" : "No designs yet"}</div>
            <div className="max-w-xs text-sm text-muted-foreground">
              {signedOut ? "Your saved designs live here." : "Create a design — pick a blank, drop your artwork, save. Then reuse it on any order."}
            </div>
            {!signedOut && (
              <Button size="sm" className="mt-1" onClick={() => setStudioOpen(true)}>
                <Plus size={14} weight="bold" /> New design
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((d) => (
              <Card key={String(d.id)} className="group gap-0 overflow-hidden p-0">
                <div className="relative flex aspect-square items-center justify-center bg-muted">
                  {d.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.thumb} alt={d.name ?? ""} className="size-full object-contain" />
                  ) : (
                    <PenNib size={26} weight="duotone" className="text-muted-foreground/40" />
                  )}
                  <button
                    onClick={() => remove(d.id)}
                    className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                    aria-label="Delete design"
                  >
                    <Trash size={13} weight="bold" />
                  </button>
                </div>
                <div className="p-3">
                  <div className="truncate text-sm font-semibold">{d.name || "Untitled"}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{fmtDate(d.created_at)}</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </SectionCard>

      <DesignStudioDialog open={studioOpen} onOpenChange={setStudioOpen} onSaved={load} />
    </div>
  )
}

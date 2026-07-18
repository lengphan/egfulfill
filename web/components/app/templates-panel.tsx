"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Stack, Trash, PenNib, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { getTemplates, deleteTemplate, type ProductTemplate } from "@/lib/api"

/**
 * Saved product templates — a blank + artwork setup you can reopen instead of rebuilding.
 *
 * These have been written to the database for a long time and never read back: the list
 * and delete endpoints filtered on a `seller_id` column that never existed, so both threw
 * on every call, and the only caller in the codebase (the old HTML maker) never listed
 * them. This is the first surface that actually shows them.
 */
export function TemplatesPanel() {
  const router = useRouter()
  const [items, setItems] = useState<ProductTemplate[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => { getTemplates().then((r) => setItems(r ?? [])).catch(() => setItems([])) }
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [])

  const remove = async (id: string) => {
    setBusy(id)
    // Optimistic — the row is gone from view immediately; a failure reloads the truth.
    setItems((prev) => (prev ?? []).filter((t) => t.id !== id))
    try { await deleteTemplate(id) } catch { load() } finally { setBusy(null) }
  }

  const list = items ?? []

  return (
    <SectionCard
      title="Product templates"
      description="A saved blank + artwork setup — reopen it instead of starting over"
    >
      {items === null ? (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <CircleNotch size={15} className="animate-spin" /> Loading…
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Stack size={26} weight="duotone" className="text-muted-foreground/50" />
          <div className="text-sm font-medium">No templates yet</div>
          <div className="max-w-xs text-sm text-muted-foreground">
            Save one from the design maker and it&apos;ll appear here, ready to reopen.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((t) => (
            <div key={t.id} className="group overflow-hidden rounded-xl border border-border">
              <div className="relative aspect-square bg-muted/40">
                {t.composite ? (
                  <Image src={t.composite} alt={t.name ?? "Template"} fill unoptimized className="object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground/40">
                    <Stack size={26} weight="duotone" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 p-2">
                <div className="min-w-0 flex-1 truncate text-sm font-medium">{t.name || "Untitled"}</div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Open ${t.name || "template"} in the maker`}
                  onClick={() => router.push(`/design/maker?template=${encodeURIComponent(t.id)}`)}
                >
                  <PenNib size={14} weight="bold" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${t.name || "template"}`}
                  disabled={busy === t.id}
                  onClick={() => remove(t.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash size={14} weight="bold" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import { Storefront, Warning, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getCatalogSummary, clearCatalog } from "@/lib/api"
import { useConfirm } from "@/components/app/confirm-dialog"

type Summary = { products: number; styles: number; total: number; unpriced: number }

/**
 * What is in the catalogue right now, on screen at all times.
 *
 * Publishing persists — closing the lookbook unpublishes nothing — and nothing on the page
 * said so, so the only way to learn the state was to open the preview and count. That is
 * how you add two, close the window, add a third, and are surprised to find three.
 *
 * `unpriced` is called out separately because it is the failure you notice after sending:
 * a published style with no price prints a blank where a number should be.
 */
export function CatalogSummaryBar({ refresh }: { refresh?: number }) {
  const [s, setS] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  const load = useCallback(() => {
    getCatalogSummary().then(setS).catch(() => setS(null))
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load, refresh])

  const clear = async () => {
    if (!s?.total) return
    // Naming the number, because "clear the catalogue" reads as tidying and this undoes
    // an afternoon of curation.
    const ok = await confirm({
      title: "Empty the catalogue?",
      body: `This removes all ${s.total} published item${s.total === 1 ? "" : "s"}. Saved catalogues you have already sent are untouched — but you would have to pick these again.`,
      confirmLabel: "Empty it",
    })
    if (!ok) return
    setBusy(true)
    try { await clearCatalog(); load() } finally { setBusy(false) }
  }

  if (!s) return null

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-5 py-2.5 text-sm">
      <Storefront size={15} weight="duotone" className="text-muted-foreground" />
      {s.total === 0 ? (
        <span className="text-muted-foreground">Nothing in the catalogue yet.</span>
      ) : (
        <span>
          <strong>{s.total}</strong> in the catalogue
          <span className="text-muted-foreground">
            {" "}— {s.products} product{s.products === 1 ? "" : "s"}, {s.styles} supplier style{s.styles === 1 ? "" : "s"}
          </span>
        </span>
      )}
      {s.unpriced > 0 && (
        <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          <Warning size={12} weight="fill" /> {s.unpriced} with no price — they print blank
        </span>
      )}
      {s.total > 0 && (
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={clear} disabled={busy}>
          {busy ? <CircleNotch size={13} className="animate-spin" /> : "Empty catalogue"}
        </Button>
      )}
    </div>
  )
}

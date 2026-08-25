"use client"

import { useLabelT } from "@/lib/i18n"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { EmptyState } from "@/components/app/empty-state"
import { Tag } from "@phosphor-icons/react"
import { planBrandSplit, withRenameAlias } from "@/lib/brand-split"
import type { CatalogProduct } from "@/lib/api"

/**
 * Take the make off the front of every name that leads with one, in one pass.
 *
 * EVERY CHANGE IS ON SCREEN BEFORE ANYTHING IS SAVED. This edits the name of products that
 * orders resolve against, so it is not a button that quietly rewrites thirty rows — it is a
 * proposal, listed line by line, that somebody agrees to. Unticking a row leaves that product
 * exactly as it is.
 *
 * The rename is safe because withRenameAlias keeps the old name as an alias both resolvers
 * read (lib/brand-split.ts). Nothing on an existing order is touched.
 */
export function BrandSplitDialog({
  open,
  onOpenChange,
  products,
  onApply,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  products: CatalogProduct[]
  /** Receives the FULL catalogue with the chosen rows rewritten — the same whole-list shape
   *  every other write on this page uses. */
  onApply: (next: CatalogProduct[]) => Promise<void>
}) {
  const tl = useLabelT()
  const plan = useMemo(() => planBrandSplit(products), [products])
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const keyOf = (p: CatalogProduct) => String(p.id ?? p.sku ?? p.name ?? "")
  const chosen = plan.filter((c) => !skip.has(keyOf(c.product)))

  const apply = async () => {
    setBusy(true); setErr(null)
    try {
      const by = new Map(chosen.map((c) => [keyOf(c.product), c]))
      await onApply(products.map((p) => {
        const c = by.get(keyOf(p))
        return c ? { ...withRenameAlias(p, c.name), brand: c.brand } : p
      }))
      onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the catalogue.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) { setSkip(new Set()); setErr(null) } } }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tl("brandSplit", "Split the brand off the name")}</DialogTitle>
          <DialogDescription>
            {tl("brandSplit", "The make becomes its own field. Old names keep resolving, so orders already placed are unaffected.")}
          </DialogDescription>
        </DialogHeader>

        {plan.length === 0 ? (
          <EmptyState
            icon={Tag}
            title={tl("brandSplit", "No name here starts with a make we recognise")}
            note={tl("brandSplit", "A product that already has a brand is left alone. Anything else can be split by hand in the product itself.")}
          />
        ) : (
          <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {plan.map((c) => {
                  const k = keyOf(c.product)
                  const on = !skip.has(k)
                  return (
                    <tr key={k} className={on ? "" : "opacity-45"}>
                      <td className="w-9 py-2 pl-3 align-middle">
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={`Split ${c.product.name}`}
                          onChange={() => setSkip((s) => {
                            const n = new Set(s)
                            if (n.has(k)) n.delete(k); else n.add(k)
                            return n
                          })}
                          className="size-4 accent-primary"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground line-through">{c.product.name}</div>
                      </td>
                      <td className="w-40 py-2 pr-3 text-right">
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">{c.brand}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>{tl("brandSplit", "Cancel")}</Button>
          <Button onClick={apply} disabled={busy || chosen.length === 0}>
            {busy ? tl("brandSplit", "Saving…") : `Split ${chosen.length} product${chosen.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

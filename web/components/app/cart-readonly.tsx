"use client"

import { useCallback, useEffect, useState } from "react"
import { ShoppingCart, CircleNotch } from "@phosphor-icons/react"
import { getFactoryList, type SavedPOLine } from "@/lib/api"
import { SectionCard } from "@/components/app/section-card"
import { EmptyState } from "@/components/app/empty-state"

/**
 * THE CART, TO READ — for an operator or a warehouse hand.
 *
 * "What is already on its way to being bought" is a question the floor asks constantly and
 * had no way to answer: the cart was admin-only, so anyone else chasing a shortage either
 * messaged an admin or re-reported a blank that was already in the cart. That is the whole
 * job this does.
 *
 * IT IS A SEPARATE COMPONENT, NOT PurchaseView WITH THE MONEY SWITCHED OFF.
 *
 * PurchaseView is a buying tool: 2,100 lines carrying prices in the line rows, the totals
 * rail, the reorder suggestions, Ongoing and History — and its Ongoing/History tabs read
 * `/api/purchase`, which is requireAdmin and would 403 for exactly these two roles. Hiding a
 * price is one `usd()` call away from leaking one, and a leak here is our cost base. So this
 * list has no price in it to hide: it never reads one, never receives one, and cannot place,
 * edit or remove anything. What it CAN read is the cart blob itself, which
 * `/api/factory_lists/po_saved` has always served to any staff account.
 *
 * The lines carry the picture they were picked with. There is no resolve-by-sku fallback,
 * because that route is admin-only too — a line with no captured image gets the dashed
 * square that means "no picture", never a broken one.
 */
export function CartReadOnly({ refreshKey = 0 }: { refreshKey?: number }) {
  const [lines, setLines] = useState<SavedPOLine[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getFactoryList<SavedPOLine[]>("po_saved")
      .then((r) => { setLines(Array.isArray(r) ? r : []); setErr(null) })
      .catch(() => { setLines([]); setErr("Couldn't read the cart.") })
  }, [])

  useEffect(() => {
    const id = setTimeout(load, 0)
    // The same event the header badge and the tab count listen to, so all three agree the
    // moment somebody with buying rights changes what is in here.
    window.addEventListener("eg-cart-changed", load)
    return () => { clearTimeout(id); window.removeEventListener("eg-cart-changed", load) }
  }, [load, refreshKey])

  if (lines === null) {
    return (
      <div className="flex items-center justify-center py-14 text-muted-foreground">
        <CircleNotch size={22} className="animate-spin" />
      </div>
    )
  }

  // Grouped by the supplier the line actually comes from — the same split the buyer sees,
  // because "is the cap in the cart" is answered per supplier on the floor too. A line with
  // no supplier recorded is its own group rather than being hidden.
  const groups = new Map<string, SavedPOLine[]>()
  for (const l of lines) {
    const k = String(l.supplier || "").trim() || "Not assigned"
    groups.set(k, [...(groups.get(k) ?? []), l])
  }

  const units = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)

  return (
    <div className="space-y-4">
      {err && <div className="text-sm text-destructive">{err}</div>}
      <SectionCard
        title="In the cart"
        // SectionCard's body carries NO padding of its own — every caller brings it. Without
        // this the supplier headings sat flush against the card's own border.
        bodyClassName="px-5 py-4"
        actions={<span className="text-xs text-muted-foreground">{lines.length} lines · {units} units</span>}
      >
        {lines.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            size="sm"
            title="Nothing waiting to be ordered"
            note="Blanks land here when an order runs stock short."
          />
        ) : (
          <div className="space-y-5">
            {[...groups.entries()].map(([supplier, ls]) => (
              <div key={supplier}>
                <div className="mb-1.5 text-xs font-medium text-foreground">{supplier}</div>
                <div className="divide-y divide-border">
                  {ls.map((l, i) => (
                    /* A GRID, NOT A FLEX ROW. The variant is a different width on every
                       line, so anything after it in a flex row starts at a different x and
                       the quantity column reads crooked all the way down. */
                    <div key={`${l.sku}-${i}`} className="grid grid-cols-[2.75rem_minmax(0,1fr)_4rem] items-center gap-3 py-2">
                      {l.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.image} alt="" loading="lazy" className="size-11 rounded border border-border bg-white object-contain" />
                      ) : (
                        <span className="size-11 rounded border border-dashed border-border" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{l.name || l.sku}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[l.sku, l.variant].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div className="text-right text-sm">{Number(l.qty) || 0}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

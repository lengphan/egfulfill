"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { CaretDown, Package } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { getCatalogProducts, type CatalogProduct } from "@/lib/api"
import { DEMO, toPickedProduct, productImage, productPrice, type PickedProduct } from "@/components/app/product-picker-dialog"

const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Module-level cache: an order can have many lines, and each one mounting its own
// combobox shouldn't refetch the whole catalog.
let cache: CatalogProduct[] | null = null

/**
 * The Product field on an order line: type-ahead over the catalog, but still free text.
 *
 * It stays an ordinary Input rather than becoming a <select> because a line may name a
 * product we don't stock — a custom or one-off item has to remain typeable. Choosing a
 * suggestion prefills the rest of the line (sku, price, image, colour/size options) via
 * the same toPickedProduct() the Add-from-catalog dialog uses; typing something with no
 * match just leaves it as a custom line.
 */
export function ProductCombobox({
  value,
  onText,
  onPick,
  onBrowse,
  placeholder,
}: {
  value: string
  onText: (v: string) => void
  onPick: (p: PickedProduct) => void
  /** Opens a full browse dialog. Omit where there isn't one — the caret then just
   *  toggles the suggestion list instead of doing nothing. */
  onBrowse?: () => void
  placeholder?: string
}) {
  const [products, setProducts] = useState<CatalogProduct[]>(cache ?? [])
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (cache) return
    const id = setTimeout(() => {
      getCatalogProducts()
        .then((rows) => { cache = rows?.length ? rows : DEMO; setProducts(cache) })
        .catch(() => { cache = DEMO; setProducts(DEMO) })
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // Close on outside click — the panel is absolutely positioned, so it would otherwise
  // hang over the next line's fields.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  // Every match, not a top-N slice — the list scrolls, so capping it just hid products
  // and forced a trip through the browse dialog to find them.
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) => `${p.name ?? ""} ${p.sku ?? ""} ${p.type ?? ""}`.toLowerCase().includes(q))
  }, [products, value])

  // The list is unbounded now, so the highlighted row can sit outside the scroll window.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor, open])

  const choose = (p: CatalogProduct) => {
    onPick(toPickedProduct(p))
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onText(e.target.value); setOpen(true); setCursor(0) }}
        // Open on focus even when empty. Gating this on `value.trim()` meant an untouched
        // field showed nothing until you guessed a character — and in the publish dialog,
        // whose caret has no browse handler, that left NO way to reach the catalog at all.
        // An empty query already returns the full list (see `matches`).
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); return }
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, matches.length - 1)) }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
          else if (e.key === "Enter" && matches[cursor]) { e.preventDefault(); choose(matches[cursor]) }
          else if (e.key === "Escape") setOpen(false)
        }}
        placeholder={placeholder}
        className="h-9 pr-8"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {/* The caret opens the full product browser directly. It used to drop a small panel
          whose only real action was a "Browse all products…" row at the bottom — a click to
          reach a click. Typing still filters inline below, so the two paths are distinct:
          type to narrow, click to browse. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={onBrowse ? "Browse all products" : "Show products"}
        title={onBrowse ? "Browse all products" : "Show products"}
        // With no browse handler the caret used to call an empty function and look broken.
        // Fall back to toggling the list so it always does something.
        onClick={() => { if (onBrowse) { setOpen(false); onBrowse() } else setOpen((v) => !v) }}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretDown size={13} className="text-muted-foreground" />
      </button>

      {/* Panel is wider than the field on purpose — the Product column is narrow, and
          matching its width truncated every name to "Classic T…". Capped so it can't
          overrun a phone. */}
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-[320px] max-w-[80vw] overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 ? (
              <div className="px-3 py-2.5 text-xs text-muted-foreground">
                {value.trim() ? `No catalog match — "${value.trim()}" stays a custom item.` : "No catalog products yet."}
              </div>
            ) : (
              matches.map((p, i) => {
                const img = productImage(p)
                const price = productPrice(p)
                return (
                  <button
                    key={String(p.id ?? p.sku ?? p.name)}
                    data-i={i}
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(p)}
                    className={
                      "flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors " +
                      (i === cursor ? "bg-accent" : "hover:bg-accent")
                    }
                  >
                    <span className="relative size-8 shrink-0 overflow-hidden rounded border border-border bg-muted/40">
                      {img ? (
                        <Image src={img} alt="" fill unoptimized sizes="32px" className="object-cover" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-muted-foreground">
                          <Package size={13} weight="duotone" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name ?? p.sku}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[p.sku, p.type].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {price > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{usd(price)}</span>}
                  </button>
                )
              })
            )}
          </div>

        </div>
      )}
    </div>
  )
}

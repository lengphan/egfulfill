"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import { CaretDown, Package } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { getCatalogProducts, type CatalogProduct } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { DEMO, toPickedProduct, productImage, productPrice, type PickedProduct } from "@/components/app/product-picker-dialog"

const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Module-level cache: an order can have many lines, and each one mounting its own
// combobox shouldn't refetch the whole catalog.
let cache: CatalogProduct[] | null = null

// useLayoutEffect warns when a component is server-rendered, and this one is (the order
// form is SSR'd like every app page). useEffect on the server, layout effect in the
// browser — the panel has to be placed before it paints or it flashes at the top-left.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

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
  // Which of three states the list is in. Without this, "your catalogue is empty" and
  // "the catalogue failed to load" were both rendered as a list of five invented products.
  const [load, setLoad] = useState<"loading" | "ok" | "empty" | "error">(cache ? "ok" : "loading")
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (cache) return
    const id = setTimeout(() => {
      // DEMO IS FOR A SIGNED-OUT DEMO, NOT FOR A REAL SESSION.
      //
      // This used to substitute five invented products — Heavyweight Hoodie, Classic Tee,
      // Embroidered Cap … — whenever the real catalogue came back empty OR the request
      // failed. They render identically to real ones, so a seller could pick one, publish a
      // listing against it, and the resulting order would name a blank that does not exist.
      // An empty catalogue and a broken request also need opposite responses, and both were
      // shown as a confident list of stock that isn't there.
      //
      // Signed out (marketing / demo), DEMO is still the right thing to show.
      if (!getToken()) { cache = DEMO; setProducts(DEMO); setLoad("ok"); return }
      getCatalogProducts()
        .then((rows) => {
          if (rows?.length) { cache = rows; setProducts(rows); setLoad("ok") }
          else { setProducts([]); setLoad("empty") }
        })
        .catch(() => { setProducts([]); setLoad("error") })
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // Close on outside click. The panel is a PORTAL on <body>, so it is not inside boxRef —
  // testing only the field would close the list on mousedown and unmount the row before
  // its click ever landed, which reads as "clicking a product does nothing".
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (boxRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  // The label of the last thing PICKED, so re-opening can tell "this is the current
  // selection" from "this is something the user typed". State, not a ref: `matches` reads
  // it during render, and a ref read there neither triggers a re-render nor is guaranteed
  // to reflect the latest value.
  const [pickedLabel, setPickedLabel] = useState<string | null>(null)

  // Every match, not a top-N slice — the list scrolls, so capping it just hid products
  // and forced a trip through the browse dialog to find them.
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return products
    // After picking, `value` IS the chosen product's name — so filtering by it matched
    // exactly one row and the list showed only the blank you already had. There was no
    // way to switch blanks without manually clearing the field first, which looked like
    // "no other products exist". An untouched selection shows the whole list again.
    if (pickedLabel && value === pickedLabel) return products
    return products.filter((p) => `${p.name ?? ""} ${p.sku ?? ""} ${p.type ?? ""}`.toLowerCase().includes(q))
  }, [products, value, pickedLabel])

  // The list is unbounded now, so the highlighted row can sit outside the scroll window.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor, open])

  // WHERE THE PANEL GOES. It is a portal on <body>, so it carries no position of its own —
  // it is pinned to the field's rect every time the list opens, the page scrolls or the
  // window resizes, and flipped above the field when there isn't room below.
  // Written straight to the node rather than held in state: a rect in state would be one
  // render behind the scroll it is following.
  useIsoLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = panelRef.current, anchor = boxRef.current
      if (!el || !anchor) return
      const r = anchor.getBoundingClientRect()
      /*
       * AS WIDE AS THE STRIP IT BELONGS TO, not a fixed 320px.
       *
       * A hard width fits nothing: on an order line the Product column bottoms out at
       * 170px and 320 reached over into Qty and Colour, while on the publish form the same
       * 320 sat under a field twice that wide. Both were the panel deciding a width from
       * nothing, and neither matched the row it dropped out of.
       * A host that has a natural width for it says so with `data-field-strip` — on the
       * order line that is the whole field grid, Product through Method — and everything
       * else falls back to the field. It opens BELOW, so the width it spans is the row
       * underneath, never the controls beside it.
       */
      const strip = anchor.closest("[data-field-strip]")
      const w = Math.max(r.width, Math.min(strip?.getBoundingClientRect().width ?? 0, window.innerWidth - 16))
      el.style.width = `${w}px`
      el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`
      const below = window.innerHeight - r.bottom - 8
      const h = el.offsetHeight
      el.style.top = below < h && r.top - 8 > below ? `${Math.max(8, r.top - h - 4)}px` : `${r.bottom + 4}px`
    }
    place()
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [open, matches.length, load])

  const choose = (p: CatalogProduct) => {
    const picked = toPickedProduct(p)
    setPickedLabel(picked.name)
    onPick(picked)
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { setPickedLabel(null); onText(e.target.value); setOpen(true); setCursor(0) }}
        // Open on focus even when empty. Gating this on `value.trim()` meant an untouched
        // field showed nothing until you guessed a character — and in the publish dialog,
        // whose caret has no browse handler, that left NO way to reach the catalog at all.
        // An empty query already returns the full list (see `matches`).
        onFocus={(e) => {
          setOpen(true)
          // Select the current selection so the first keystroke replaces it rather than
          // appending to a product name.
          if (pickedLabel && e.target.value === pickedLabel) e.target.select()
        }}
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

      {/* A PORTAL, not an absolute child. Every surface that hosts this field — the manual
          order line, the publish form — sits in a SectionCard, and that card is
          `overflow-hidden`, so the list was clipped to the card's edge: one row visible and
          the rest cut off inside the panel. No amount of z-index reaches out of a clip;
          only leaving the subtree does. */}
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: 0, left: 0, width: 0 }}
          className="z-50 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        >
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 ? (
              // Say WHICH of the three it is. A failed load and an empty catalogue lead to
              // different actions, and neither is "no match for what you typed".
              <div className="px-3 py-2.5 text-xs text-muted-foreground">
                {load === "loading" ? "Loading your catalogue…"
                  : load === "error" ? "Couldn't load your catalogue — check the connection and reopen. Nothing is missing from it; we just can't read it right now."
                  : load === "empty" ? "No products in your catalogue yet. Add one in Products, then reopen this."
                  : value.trim() ? `No catalog match — "${value.trim()}" stays a custom item.`
                  : "No catalog products yet."}
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
                      <span className="block truncate text-2xs text-muted-foreground">
                        {[p.sku, p.type].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {price > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{usd(price)}</span>}
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

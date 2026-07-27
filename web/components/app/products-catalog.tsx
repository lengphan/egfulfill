"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { MagnifyingGlass, Plus, Package, Sparkle, PenNib, PencilSimple, Trash } from "@phosphor-icons/react"
import { motion, useReducedMotion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { ProductEditorDialog } from "@/components/app/product-editor-dialog"
import { usePaged, Pagination } from "@/components/app/pagination"
import { getCatalogProducts, saveCatalogProducts, type CatalogProduct } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { clickableProps } from "@/lib/a11y"

// ── helpers ───────────────────────────────────────────────────
const priceOf = (p: CatalogProduct) =>
  Number(p.price ?? p.basePrice ?? p.base_price ?? 0) || 0

import { sizesOf } from "@/lib/variant-resolve"

const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const imageOf = (p: CatalogProduct) =>
  p.img || p.image || p.hero || p.images?.[0] || (p.colorImages ? Object.values(p.colorImages)[0] : "") || ""

export const colorsOf = (p: CatalogProduct) => (p.colorImages ? Object.keys(p.colorImages) : [])

// Common garment/thread colour names → a swatch hex (best-effort; unknown = neutral).
const SWATCH: Record<string, string> = {
  black: "#191918", white: "#f4f2ef", navy: "#25314d", "sport grey": "#b7b7b3",
  grey: "#9ca3af", gray: "#9ca3af", heather: "#b9b6b0", sand: "#d8cbb4", natural: "#e8e0cf",
  maroon: "#6d2233", red: "#c0392b", royal: "#2f4bf0", blue: "#3457d5", green: "#3f7d4e",
  forest: "#2f5540", pink: "#e59bb4", khaki: "#c3b091", gold: "#d4a017", purple: "#6d4aec",
}
export const swatchHex = (name: string) => SWATCH[name.toLowerCase().trim()] ?? "#c7c4bd"

// Placeholder for a product with no photo. Deliberately NEUTRAL: this used to rotate
// through five pastel gradients, so a catalog without images rendered as a grid of
// lavender/amber/emerald/sky/pink tiles — a different visual language from every other
// page, which reads as two apps rather than one. The image is the interesting thing on a
// product card; its absence shouldn't be the loudest element on the page.
const PLACEHOLDER = "bg-muted text-muted-foreground/60"

// ── demo fallback (no session / API) ──────────────────────────
const DEMO: CatalogProduct[] = [
  { id: 1, name: "Heavyweight Hoodie", sku: "HOOD-HW", type: "Apparel", method: "DTG", price: 42, status: "Active", sizes: ["S", "M", "L", "XL", "2XL"], colorImages: { Black: "", Navy: "", Maroon: "" } },
  { id: 2, name: "Classic Tee", sku: "TEE-CL", type: "Apparel", method: "DTG", price: 18, status: "Active", sizes: ["S", "M", "L", "XL"], colorImages: { Black: "", White: "", "Sport Grey": "" } },
  { id: 3, name: "Embroidered Cap", sku: "CAP-EMB", type: "Headwear", method: "Embroidery", price: 24, status: "Active", sizes: ["OS"], colorImages: { Black: "", Khaki: "", Navy: "" } },
  { id: 4, name: "Canvas Tote", sku: "TOTE-CV", type: "Bags", method: "DTG", price: 14, status: "Draft", sizes: ["OS"], colorImages: { Natural: "" } },
  { id: 5, name: "Ceramic Mug 15oz", sku: "MUG-15", type: "Drinkware", method: "Sublimation", price: 12.8, status: "Active", sizes: ["15oz"], colorImages: { White: "" } },
  { id: 6, name: "Crewneck Sweatshirt", sku: "CREW-STD", type: "Apparel", method: "DTG", price: 34, status: "Active", sizes: ["S", "M", "L", "XL"], colorImages: { Sand: "", Black: "", Forest: "" } },
]

export function ProductsCatalog() {
  const router = useRouter()
  const reduce = useReducedMotion()
  const [products, setProducts] = useState<CatalogProduct[] | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [query, setQuery] = useState("")
  const [cat, setCat] = useState<string>("All")
  const [isStaff, setIsStaff] = useState(false)
  const [editing, setEditing] = useState<CatalogProduct | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => { const r = getUser()?.role; setIsStaff(!!r && r !== "seller") }, 0)
    return () => clearTimeout(id)
  }, [])

  // Whole-catalog persist on any staff add/edit/delete.
  const persist = (next: CatalogProduct[]) => { setProducts(next); saveCatalogProducts(next).catch(() => {}) }
  const saveProduct = (p: CatalogProduct) => {
    const list = products ?? []
    persist(list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list])
  }
  const deleteProduct = (id: CatalogProduct["id"]) => persist((products ?? []).filter((x) => x.id !== id))

  useEffect(() => {
    let alive = true
    getCatalogProducts()
      .then((rows) => {
        if (!alive) return
        if (rows && rows.length) {
          setProducts(rows)
        } else {
          setProducts(DEMO)
          setIsDemo(true)
        }
      })
      .catch(() => {
        if (!alive) return
        setProducts(DEMO)
        setIsDemo(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    ;(products ?? []).forEach((p) => p.type && set.add(p.type))
    return ["All", ...Array.from(set)]
  }, [products])

  const filtered = useMemo(() => {
    return (products ?? []).filter((p) => {
      if (cat !== "All" && p.type !== cat) return false
      if (!query) return true
      const hay = `${p.name ?? ""} ${p.sku ?? ""} ${p.type ?? ""}`.toLowerCase()
      return hay.includes(query.toLowerCase())
    })
  }, [products, cat, query])

  const paged = usePaged(filtered, 24)

  const stats = useMemo(() => {
    const list = products ?? []
    const active = list.filter((p) => (p.status ?? "Active") === "Active").length
    const prices = list.map(priceOf).filter((n) => n > 0)
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
    return { total: list.length, cats: Math.max(0, new Set(list.map((p) => p.type).filter(Boolean)).size), active, avg }
  }, [products])

  // ── loading skeleton ──
  if (products === null) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[280px] animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <StatGrid>
        <StatCard label="Products" value={String(stats.total)} sub="in your catalog" />
        <StatCard label="Categories" value={String(stats.cats)} sub="product types" />
        <StatCard label="Active" value={String(stats.active)} sub="published" tone="pos" />
        <StatCard label="Avg price" value={usd(stats.avg)} sub="across catalog" />
      </StatGrid>

      {/* toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors " +
                (cat === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground")
              }
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products…"
              className="w-52 pl-9"
            />
          </div>
          {isStaff && (
            <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true) }}>
              <Plus size={14} weight="bold" /> Add product
            </Button>
          )}
        </div>
      </div>

      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-700">
          <Sparkle size={14} weight="fill" />
          Showing sample products — sign in to load your live catalog.
        </div>
      )}

      {/* grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-20 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Package size={26} weight="duotone" />
          </span>
          <div className="font-medium">No products match that.</div>
          <div className="text-sm text-muted-foreground">Try a different search or category.</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {paged.pageItems.map((p, i) => {
            const img = imageOf(p)
            const colors = colorsOf(p)
            const sizes = sizesOf(p)
            const status = p.status ?? "Active"
            return (
              <motion.div
                key={String(p.id ?? p.sku ?? i)}
                {...clickableProps(
                  () => router.push(`/products/${encodeURIComponent(String(p.id ?? p.sku ?? ""))}`),
                  `View ${p.name ?? "product"}`
                )}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: Math.min(i, 8) * 0.04, ease: [0.21, 0.5, 0.28, 1] }}
                whileHover={reduce ? undefined : { y: -4 }}
                className="group cursor-pointer overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                {/* image / placeholder */}
                <div className="relative aspect-square overflow-hidden bg-muted/40">
                  {/* Card actions — Design (everyone) + Edit/Delete (staff). */}
                  <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); router.push(`/design/maker?product=${encodeURIComponent(String(p.id ?? p.sku ?? ""))}`) }}
                      title="Design this product"
                      className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow hover:bg-primary/90"
                    >
                      <PenNib size={13} weight="bold" />
                    </button>
                    {isStaff && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); setEditing(p); setEditorOpen(true) }} title="Edit" className="flex size-7 items-center justify-center rounded-full bg-background text-foreground shadow hover:bg-accent"><PencilSimple size={13} /></button>
                        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); deleteProduct(p.id) }} title="Delete" className="flex size-7 items-center justify-center rounded-full bg-background text-muted-foreground shadow hover:text-red-600"><Trash size={13} /></button>
                      </>
                    )}
                  </div>
                  {img ? (
                    <Image
                      src={img}
                      alt={p.name ?? "Product"}
                      fill
                      unoptimized
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className={"flex size-full items-center justify-center " + PLACEHOLDER}>
                      <span className="font-display text-4xl font-semibold">
                        {(p.name ?? "?").trim().charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <span
                    className={
                      "absolute left-3 top-3 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur " +
                      (status === "Active"
                        ? "bg-emerald-500/15 text-emerald-700"
                        : status === "Draft"
                          ? "bg-muted/70 text-muted-foreground"
                          : "bg-amber-500/15 text-amber-700")
                    }
                  >
                    {status}
                  </span>
                </div>

                {/* body */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{p.name ?? "Untitled"}</div>
                      <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</div>
                    </div>
                    <div className="shrink-0 font-semibold tabular-nums">{usd(priceOf(p))}</div>
                  </div>

                  {/* Colours + type share one fixed-height row. Both slots always render
                      (with a muted placeholder when empty) so cards line up instead of
                      each being as tall as whatever data it happens to carry. */}
                  <div className="mt-3 flex min-h-6 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {colors.slice(0, 8).map((c) => {
                        const img = p.colorImages?.[c]
                        return (
                          <span
                            key={c}
                            title={c}
                            className="size-4 shrink-0 rounded-full border border-black/10 bg-muted"
                            style={
                              img
                                ? { backgroundImage: `url("${img}")`, backgroundSize: "260%", backgroundPosition: "center 42%" }
                                : { background: swatchHex(c) }
                            }
                          />
                        )
                      })}
                      {colors.length > 8 && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">+{colors.length - 8}</span>
                      )}
                      {colors.length === 0 && <span className="text-[11px] text-muted-foreground">No colours set</span>}
                    </div>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {p.type || "Uncategorised"}
                    </span>
                  </div>

                  {/* Sizes — ALWAYS rendered, on one non-wrapping line. Two bugs lived
                      here: the row was conditional, so a product without sizes was a
                      shorter card than its neighbours; and it read p.sizes directly,
                      which is empty on the many catalog rows that carry sizes only as
                      per-size price tiers (sizesOf unions both). */}
                  <div className="mt-3 flex min-h-6 items-center gap-1 overflow-hidden">
                    {sizes.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">No sizes set</span>
                    ) : (
                      <>
                        {sizes.slice(0, 7).map((s) => (
                          <span
                            key={s}
                            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          >
                            {s}
                          </span>
                        ))}
                        {sizes.length > 7 && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">+{sizes.length - 7}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
      {filtered.length > 0 && (
        <div className="rounded-2xl border border-border">
          <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage} total={paged.total} start={paged.start} onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[24, 48, 96]} className="border-t-0" />
        </div>
      )}

      {isStaff && (
        <ProductEditorDialog open={editorOpen} onOpenChange={setEditorOpen} product={editing} onSave={saveProduct} newIdSeed={(products?.length ?? 0) + 1000} />
      )}
    </div>
  )
}

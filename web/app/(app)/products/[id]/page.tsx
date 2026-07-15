"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import { ArrowLeft, Package, Tag } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { getCatalogProducts, type CatalogProduct } from "@/lib/api"

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const priceOf = (p: CatalogProduct) => Number(p.price ?? p.basePrice ?? p.base_price ?? 0) || 0

const SWATCH: Record<string, string> = {
  black: "#191918", white: "#f4f2ef", navy: "#25314d", "sport grey": "#b7b7b3", grey: "#9ca3af",
  gray: "#9ca3af", heather: "#b9b6b0", sand: "#d8cbb4", natural: "#e8e0cf", maroon: "#6d2233",
  red: "#c0392b", royal: "#2f4bf0", blue: "#3457d5", green: "#3f7d4e", forest: "#2f5540",
  pink: "#e59bb4", khaki: "#c3b091", gold: "#d4a017", purple: "#6d4aec",
}
const swatchHex = (name: string) => SWATCH[name.toLowerCase().trim()] ?? "#c7c4bd"

// Every image we can show: colorImages values + images[] + single fields, de-duped.
function galleryOf(p: CatalogProduct): string[] {
  const set = new Set<string>()
  if (p.colorImages) Object.values(p.colorImages).forEach((u) => u && set.add(u))
  ;(p.images ?? []).forEach((u) => u && set.add(u))
  ;[p.img, p.image, p.hero].forEach((u) => u && set.add(u))
  return Array.from(set)
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = decodeURIComponent(String(params?.id ?? ""))
  const [products, setProducts] = useState<CatalogProduct[] | null>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    let alive = true
    getCatalogProducts()
      .then((rows) => alive && setProducts(rows ?? []))
      .catch(() => alive && setProducts([]))
    return () => {
      alive = false
    }
  }, [])

  const product = useMemo(
    () => (products ?? []).find((p) => String(p.id) === id || p.sku === id) ?? null,
    [products, id]
  )

  if (products === null) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="aspect-square animate-pulse rounded-2xl bg-muted" />
        <div className="space-y-3">
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-40 animate-pulse rounded-2xl bg-muted" />
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Package size={26} weight="duotone" />
        </span>
        <div className="font-medium">Product not found</div>
        <Button variant="outline" size="sm" onClick={() => router.push("/products")}>
          <ArrowLeft size={14} weight="bold" /> Back to products
        </Button>
      </div>
    )
  }

  const gallery = galleryOf(product)
  const colors = product.colorImages ? Object.keys(product.colorImages) : []
  const sizes = product.sizes ?? []
  const status = product.status ?? "Active"

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push("/products")} className="text-muted-foreground">
        <ArrowLeft size={16} weight="bold" /> Products
      </Button>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* gallery */}
        <div className="space-y-3">
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted/40">
            {gallery.length ? (
              <Image src={gallery[active] ?? gallery[0]} alt={product.name ?? "Product"} fill unoptimized className="object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center bg-gradient-to-br from-violet-100 to-indigo-50 text-violet-500">
                <span className="font-display text-6xl font-semibold">
                  {(product.name ?? "?").trim().charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          {gallery.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {gallery.slice(0, 8).map((src, i) => (
                <button
                  key={src}
                  onClick={() => setActive(i)}
                  className={
                    "relative size-16 overflow-hidden rounded-lg border-2 " +
                    (i === active ? "border-primary" : "border-border")
                  }
                >
                  <Image src={src} alt="" fill unoptimized className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* info */}
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium " +
                  (status === "Active" ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground")
                }
              >
                <span className={"size-1.5 rounded-full " + (status === "Active" ? "bg-emerald-500" : "bg-muted-foreground")} />
                {status}
              </span>
              {product.type && (
                <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{product.type}</span>
              )}
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{product.name ?? "Untitled"}</h1>
            <div className="mt-1 font-mono text-sm text-muted-foreground">{product.sku ?? "—"}</div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{usd(priceOf(product))}</span>
            <span className="text-sm text-muted-foreground">base price</span>
          </div>

          <SectionCard title="Variants">
            <div className="space-y-4 p-5">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Colors ({colors.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {colors.length ? (
                    colors.map((c) => (
                      <span key={c} className="flex items-center gap-1.5 rounded-full border border-border py-1 pl-1.5 pr-2.5 text-sm">
                        <span className="size-4 rounded-full border border-black/10" style={{ background: swatchHex(c) }} />
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sizes ({sizes.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sizes.length ? (
                    sizes.map((s) => (
                      <span key={s} className="rounded border border-border px-2 py-1 text-xs font-medium">{s}</span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>

          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {product.method && (
              <span className="inline-flex items-center gap-1.5">
                <Tag size={14} weight="bold" /> {product.method}
              </span>
            )}
            {product.material && <span>· {product.material}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

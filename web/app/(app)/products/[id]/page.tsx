"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import { Package, CaretLeft } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { getCatalogProducts, getDesignFees, type CatalogProduct, type DesignFees } from "@/lib/api"
import { ShippingFees } from "@/components/shipping-fees"
import { shipFirstFee } from "@/lib/ship-band"
import { sizesOf, methodsOf } from "@/lib/variant-resolve"
import { normalizeMethods } from "@/lib/print-method"
import { descriptionLines } from "@/lib/description"
import { framingStyle } from "@/lib/product-framing"

const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const priceOf = (p: CatalogProduct) => Number(p.price ?? p.basePrice ?? p.base_price ?? 0) || 0

const SWATCH: Record<string, string> = {
 black: "#191918", white: "#f4f2ef", navy: "#25314d", "sport grey": "#b7b7b3", grey: "#9ca3af",
 gray: "#9ca3af", heather: "#b9b6b0", sand: "#d8cbb4", natural: "#e8e0cf", maroon: "#6d2233",
 red: "#c0392b", royal: "#2f4bf0", blue: "#3457d5", green: "#3f7d4e", forest: "#2f5540",
 pink: "#e59bb4", khaki: "#c3b091", gold: "#d4a017", purple: "#6d4aec",
}
const swatchHex = (name: string) => SWATCH[name.toLowerCase().trim()] ?? "#c7c4bd"

/**
 * Every PHOTO we can show — colour shots, the gallery, the hero — de-duped.
 *
 * Print outlines are excluded. A side mockup is a positioning aid for the Design Maker,
 * not a picture of the product: it's a line drawing of a blank cap, and showing it in a
 * product gallery next to real photography reads as a broken image. They're a different
 * kind of asset that happens to be stored on the same row.
 */
function galleryOf(p: CatalogProduct): string[] {
 const outlines = new Set(
    Object.values({ ...(p.side_mockups ?? {}), ...(p.sideMockups ?? {}) } as Record<string, string>).filter(Boolean)
  )
 const set = new Set<string>()
 if (p.colorImages) Object.values(p.colorImages).forEach((u) => u && !outlines.has(u) && set.add(u))
  ;(p.images ?? []).forEach((u) => u && !outlines.has(u) && set.add(u))
  ;[p.img, p.image, p.hero].forEach((u) => u && !outlines.has(u) && set.add(u))
 return Array.from(set)
}

/**
 * Every technique this product supports.
 *
 * Was a private re-derivation that read `method` and `methodPrices` but not the `methods`
 * ARRAY some products carry, so this page and the order line disagreed about the same
 * product. methodsOf is the one definition (lib/variant-resolve) and it reads all three;
 * normalizeMethods puts the labels back into {key,label} for the tabs here.
 *
 * The DTG fallback stays: this page always shows a technique tab, and a product with
 * nothing declared is shown the commonest one rather than an empty strip. That is a
 * display default on a read-only page — it is deliberately NOT done anywhere an option is
 * offered for selection, where inventing a method the product never claimed would put an
 * unmakeable technique on an order.
 */
function techsOf(p: CatalogProduct): { key: string; label: string }[] {
 const out = normalizeMethods(methodsOf(p))
 return out.length ? out : [{ key: "dtg", label: "DTG printing" }]
}

export default function ProductDetailPage() {
 const params = useParams<{ id: string }>()
 const router = useRouter()
 const id = decodeURIComponent(String(params?.id ?? ""))
 const [products, setProducts] = useState<CatalogProduct[] | null>(null)
 const [active, setActive] = useState(0)
  // The platform's shipping fees — the other half of what a seller pays. Seller-safe read,
  // so this page shows the same two numbers a board or the public site does.
 const [fees, setFees] = useState<DesignFees | null>(null)
 useEffect(() => {
 const t = setTimeout(() => { getDesignFees().then(setFees).catch(() => setFees(null)) }, 0)
 return () => clearTimeout(t)
  }, [])

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
          Back to products
        </Button>
      </div>
    )
  }

 const gallery = galleryOf(product)
 const colors = product.colorImages ? Object.keys(product.colorImages) : []
  // sizesOf, not product.sizes — many catalog rows carry sizes only as per-size price
  // tiers, which is why some products showed no sizes at all.
 const sizes = sizesOf(product)
  /** The size being asked about. Sizes were inert chips on a product whose price moves by
   * size, so the one figure on the page was true for some of them and not the rest. */
 const tierOf = (sz: string) => product.sizePrices?.find((t) => t.size === sz)
 const priceOfSize = (sz: string) => Number(tierOf(sz)?.price ?? 0) || priceOf(product)
 const status = product.status ?? "Active"
 const techs = techsOf(product)
 const shipFee = Number(product.shippingFee ?? product.shipping_fee ?? 0) || 0
 const hasEmb = techs.some((t) => t.key === "emb")
 const hasPrint = techs.some((t) => t.key !== "emb")

 return (
    <div className="space-y-5">
      {/* BACK, AND IT LOOKS LIKE IT. This was a ghost button reading "Products" — the same
 weight and colour as a heading, with nothing on it to say it was the way out, so
 finding the way back meant guessing which word was clickable. An arrow pointing
 left, ahead of the word, is the one convention every reader already has. */}
      <button
 type="button"
 onClick={() => router.push("/products")}
 className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretLeft size={14} weight="bold" /> Products
      </button>

      {/* Fill the page container (eg-content, 1600px) like every other page — the old
 max-w-6xl cap left a big empty right gutter. The image column is still capped so the
 mockup doesn't blow up to half the viewport; the info column takes the rest. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:items-start">
        {/* Gallery sticks while the (much taller) info column scrolls — otherwise the
 left column dead-ends under the thumbnails and leaves a tall empty well. */}
        <div className="space-y-3 lg:sticky lg:top-6">
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-white">
            {gallery.length ? (
              /* FRAMED AS THE PRODUCT SAYS. This page ignored imgZoom/imgFocusY entirely, so
 the framing set in the editor held on the grid and then evaporated the
 moment you opened the product — the same photo, cropped two ways, one click
 apart. Only the hero: the thumbnail strip is an index of what is available
 and wants the whole picture in each tile. */
              <Image src={gallery[active] ?? gallery[0]} alt={product.name ?? "Product"} fill unoptimized className="object-contain" style={framingStyle(product)} />
            ) : (
              <div className="flex size-full items-center justify-center bg-gradient-to-br from-working to-pending text-working">
                <span className="font-title text-6xl font-semibold">
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
                    "relative size-12 overflow-hidden rounded-lg border-2 " +
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
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
                  (status === "Active" ? "bg-shipped/15 text-shipped" : "bg-muted text-muted-foreground")
                }
              >
                <span className={"size-1.5 rounded-full " + (status === "Active" ? "bg-shipped" : "bg-muted-foreground")} />
                {status}
              </span>
              {product.type && (
                <span className="rounded-md bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">{product.type}</span>
              )}
            </div>
            <h1 className="mt-2 font-title text-3xl font-semibold tracking-tight">{product.name ?? "Untitled"}</h1>
            <div className="mt-1 tabular-nums text-sm text-muted-foreground">{product.sku ?? "—"}</div>
          </div>

          {/* THE NUMBER, THEN WHAT SHIPPING ADDS TO IT.
              "base price" was a caption saying what a large bold figure beside a product
 already says, and it invited the reading it was meant to prevent — a price
 with the parcel left out. The shipping table underneath is the missing half,
 and it says it in figures rather than in a word. */}
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{usd(priceOf(product))}</span>
          </div>
          <ShippingFees
 first={shipFee || shipFirstFee(product, fees?.shipBands)}
 extra={fees?.shipExtra ?? 0}
 className="max-w-xs"
          />

          {/* The primary action the old PDP had and this port dropped — nothing on the
 page let you actually do anything with the product. Carries id/colour/size
 through to the maker the way the old startDesigning() did. */}
          <Button
 size="lg"
 className="w-full sm:w-auto"
 onClick={() => router.push(`/design/maker?product=${encodeURIComponent(String(product.id ?? product.sku ?? ""))}`)}
          >
            Start designing
          </Button>

          <SectionCard title="Variants">
            <div className="space-y-4 p-5">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Colors ({colors.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {colors.length ? (
 colors.map((c) => {
                      // Prefer a micro-crop of the REAL garment photo for this colour, so
                      // weave, heather and micro-patterns show. A flat hex can't represent
                      // "Micro Print" or a heather at all, and any colour missing from the
                      // 18-entry SWATCH map (e.g. "Crystal Sky") fell back to a generic
                      // grey that was simply the wrong colour. Hex stays as the fallback.
 const img = product.colorImages?.[c]
 return (
                        <span key={c} className="flex items-center gap-1.5 rounded-full border border-border py-1 pl-1.5 pr-2.5 text-sm">
                          <span
 className="size-5 shrink-0 rounded-full border border-black/10 bg-muted"
 title={c}
 style={
 img
                                ? { backgroundImage: `url("${img}")`, backgroundSize: "260%", backgroundPosition: "center 42%" }
 : { background: swatchHex(c) }
                            }
                          />
                          {c}
                        </span>
                      )
                    })
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
 sizes.map((s) => {
                      // The price rides ON the chip rather than behind a click. There is
                      // nothing to select on this page — it is a record, not an order form —
                      // so a chip that had to be pressed to reveal a number would be a
                      // control that looks live and submits nothing. Nine sizes, nine prices,
                      // all readable at once.
 const own = tierOf(s)
 return (
                        <span key={s} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium">
                          {s}
                          <span className={"tabular-nums " + (own ? "text-foreground" : "text-muted-foreground")} title={own ? `This size is priced on its own` : "No tier of its own — charged the base price"}>
                            {usd(priceOfSize(s))}
                          </span>
                        </span>
                      )
                    })
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>

          {descriptionLines(product.description).length > 0 && (
            <SectionCard title="About this product">
              <ul className="space-y-1.5 p-5 text-sm">
                {descriptionLines(product.description).map((line, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {/* Print methods available — chips per technique, with the per-unit surcharge
 when the product carries one (methodPrices). */}
          <SectionCard title="Printing methods">
            <div className="flex flex-wrap gap-2 p-5">
              {techs.map((t) => {
 const fee = product.methodPrices?.[t.key.toUpperCase()] ?? product.methodPrices?.[t.label.split(" ")[0]]
 return (
                  <span key={t.key} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium">
                    {t.label}
                    {typeof fee === "number" && fee > 0 && <span className="text-xs text-muted-foreground">+{usd(fee)}</span>}
                  </span>
                )
              })}
            </div>
          </SectionCard>

          {/* File guidelines — the artwork requirements from the old HTML PDP, shown per
 method the product actually supports. */}
          <SectionCard title="File guidelines">
            <div className="space-y-4 p-5">
              {hasPrint && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Print · DTG / DTF</div>
                  <ul className="space-y-1.5 text-sm">
                    {["PNG or PDF, 150 DPI minimum (300 preferred)", "Transparent background", "Design true-to-size to the print area"].map((g) => (
                      <li key={g} className="flex items-start gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" /><span>{g}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {hasEmb && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Embroidery</div>
                  <ul className="space-y-1.5 text-sm">
                    {["Vector PDF, or PNG at 150 DPI+", "Solid shapes & colors only — no gradients", "Max 15K stitches (25K for large designs)"].map((g) => (
                      <li key={g} className="flex items-start gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" /><span>{g}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </SectionCard>

          {product.material && (
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>{product.material}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

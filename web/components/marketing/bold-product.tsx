"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { TShirt, ArrowLeft } from "@phosphor-icons/react"
import { ACCENT, HEADING, SURFACE, Pill, Rise } from "@/components/marketing/bold-kit"
import type { PublicProduct } from "@/lib/api"

/**
 * One published product, in public shape.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT HAVE, because we do not have the data:
 *
 *   ratings / review counts   We collect no reviews. A star row is the single easiest thing
 *                             to fake on a product page and the single most dishonest — it
 *                             is a claim other people vouched for this.
 *   delivery estimates        Lead time depends on method, queue depth and destination, none
 *                             of which this unauthenticated route knows. A date here would be
 *                             a guess printed as a promise.
 *   stock / "only 3 left"     Stock is held against the BLANK sku, which is exactly what the
 *                             public shape withholds (it identifies our supplier).
 *
 * The house rule is that an empty state must not look like a broken feature. The inverse
 * matters just as much: an invented figure must not look like a measured one.
 */

/**
 * What we need from a customer, by decoration method.
 *
 * OURS, not the supplier's — a manufacturer's feed describes the garment, not what a print
 * shop needs to receive. `methods: []` means it applies to every method. Kept deliberately
 * short: this is the answer to "what do I send you", not a prepress manual.
 */
const FILE_GUIDES: { label: string; body: string; methods: string[] }[] = [
  { label: "File type", methods: [], body: "PNG with a transparent background, or a vector PDF/SVG/AI. JPGs work but cannot hold transparency." },
  { label: "Resolution", methods: [], body: "300 DPI at the size it will be printed. A 1000px image blown up to 12 inches will look soft on the garment." },
  { label: "Colour", methods: ["DTG", "DTF", "SUB"], body: "sRGB. We convert for the printer; artwork sent in CMYK can shift on the way." },
  { label: "Stitch files", methods: ["EMB"], body: "Send a .DST, .PES or .EMB and we run it as-is. Send a PNG instead and we digitise it for you." },
  { label: "Small text", methods: ["EMB"], body: "Anything under 5mm tall tends to close up in stitches. Larger, or set it in a heavier face." },
  { label: "Placement", methods: [], body: "Tell us where it goes and how wide — or leave it and we'll centre it at a standard size." },
]

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function BoldProduct({ product }: { product: PublicProduct }) {
  // The colourway the visitor is looking at. Selection is REAL feedback even when that colour
  // carries no photo — it is a choice a buyer genuinely makes — but the hero only swaps for a
  // colour that actually has an image, rather than blanking to a placeholder mid-browse.
  const [colorIdx, setColorIdx] = useState<number | null>(null)
  const chosen = colorIdx == null ? null : product.colors[colorIdx] ?? null
  const hero = chosen?.image ?? product.image
  // The chart, pivoted from the supplier's flat {size, spec, value} rows into columns.
  const specs = product.specs ?? []
  const specNames = [...new Set(specs.map((x) => x.spec))]
  const sizeNames = [...new Set(specs.map((x) => x.size))]
  const specAt = (size: string, spec: string) => specs.find((x) => x.size === size && x.spec === spec)?.value ?? ""

  return (
    <div className="text-[#0B0B0C]" style={{ background: SURFACE }}>
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-10">
        <Link
          href="/catalog"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-black/55 transition-colors hover:text-[#0B0B0C]"
        >
          <ArrowLeft size={14} weight="bold" /> All products
        </Link>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-16">
          {/* ── The picture ──────────────────────────────────────────────── */}
          <Rise>
            {/* Rail LEFT of the hero, not under it. A vertical strip is how every product
                page of this kind is read — thumbnails scanned down the edge while the main
                shot holds its size — and it stops the hero being pushed up the page by a
                row of squares beneath it. Falls back to a single column on phones, where a
                64px rail beside the image would leave the hero too narrow to judge. */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              {product.colors.some((c) => c.image) && (
                <div className="flex shrink-0 gap-3 overflow-x-auto sm:w-20 sm:flex-col sm:overflow-visible">
                  {product.colors.map((c, i) =>
                    c.image ? (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => setColorIdx(i)}
                        aria-label={c.name}
                        aria-pressed={colorIdx === i}
                        className={
                          "relative aspect-square w-16 shrink-0 overflow-hidden rounded-xl border transition-colors sm:w-full " +
                          (colorIdx === i ? "border-[#0B0B0C]" : "border-black/[0.09] hover:border-black/40")
                        }
                      >
                        <Image src={c.image} alt="" fill unoptimized sizes="80px" className="object-cover" />
                      </button>
                    ) : null
                  )}
                </div>
              )}
              <div
                className="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-2xl border border-black/[0.09]"
                style={{ background: hero ? "#fff" : ACCENT }}
              >
                {hero ? (
                  <Image
                    src={hero}
                    alt={chosen ? `${product.name} — ${chosen.name}` : product.name}
                    fill
                    unoptimized
                    priority
                    sizes="(max-width:1024px) 100vw, 60vw"
                    className="object-cover"
                  />
                ) : (
                  /* Accent, not a grey box — a product without a photo should read as
                     unfinished rather than as a failed image request. */
                  <div className="flex size-full flex-col items-center justify-center gap-3 text-[#FAF8F3]/50">
                    <TShirt size={56} weight="duotone" />
                    <span className="text-sm font-semibold">Photo coming</span>
                  </div>
                )}
              </div>
            </div>
          </Rise>

          {/* ── The facts ────────────────────────────────────────────────── */}
          <Rise delay={0.08}>
            {product.category && (
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-black/45">{product.category}</div>
            )}
            <h1 className="mt-3 font-display font-black leading-[0.95] tracking-[-0.035em]" style={HEADING}>
              {product.name}
            </h1>

            <div className="mt-7 border-y border-black/[0.09] py-6">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black tracking-tight tabular-nums">{usd(product.price)}</span>
                <span className="text-sm font-semibold text-black/45">per item</span>
              </div>
              {/* Say WHOSE price this is. It's what a seller pays us to make and ship one —
                  not a retail price, and not our cost. Leaving that ambiguous on a public
                  page invites both wrong readings. */}
              <p className="mt-2 text-sm leading-relaxed text-black/55">
                What you pay us to make and ship one, before your own retail markup.
              </p>
            </div>

            {product.methods.length > 0 && <Spec label="Print method" items={product.methods} />}
            {product.colors.length > 0 && (
              <div className="mt-6">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-black/45">
                  Colours <span className="text-black/30">· {product.colors.length}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {product.colors.map((c, i) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setColorIdx(i)}
                      aria-pressed={colorIdx === i}
                      className={
                        "rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors " +
                        (colorIdx === i
                          ? "border-[#0B0B0C] bg-[#0B0B0C] text-[#D4F897]"
                          : "border-black/20 text-black/70 hover:border-black/50 hover:text-[#0B0B0C]")
                      }
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {product.sizes.length > 0 && <Spec label="Sizes" items={product.sizes} />}

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Pill href="/signup" tone="ink">Start free</Pill>
              <Pill href="/pricing" tone="ghost">See pricing</Pill>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-black/50">
              Connect Etsy, Shopify or TikTok Shop and this product is orderable from your queue.
              Nothing to pay until you submit an order.
            </p>
          </Rise>
        </div>

        {/* ── Size chart + artwork spec, full width under the fold ─────────────
            Below the buying decision rather than beside it: someone measuring a garment or
            checking a file spec has already decided they're interested, and squeezing a
            multi-column table into the right rail would make both harder to read. */}
        {(specNames.length > 0 || product.methods.length > 0) && (
          /* Two columns ONLY when there are two things to put in them. Most products have
             no supplier size chart — S&S is the only feed that provides one — so a fixed
             two-column grid left the guidelines stranded in the left half with a dead right
             half beside them, which is what made the section look broken rather than short. */
          <div className={"mt-16 grid gap-12 " + (specNames.length > 0 && product.methods.length > 0 ? "lg:grid-cols-2" : "max-w-2xl")}>
            {specNames.length > 0 && (
              <Rise>
                <h2 className="font-display text-2xl font-black tracking-tight">Size chart</h2>
                <p className="mt-1.5 text-sm text-black/50">
                  Garment measurements from the manufacturer, in inches.
                </p>
                {/* PIVOTED, not read off named fields: the supplier returns one row per
                    (size, measurement) and the measurements differ per garment — a polo has
                    a chest width, a cap has a bill length. Assuming columns is how a chart
                    that exists gets reported as missing. */}
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[22rem] border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#0B0B0C] text-[#D4F897]">
                        <th className="rounded-l-lg px-3 py-2 text-left font-bold">Size</th>
                        {specNames.map((n, i) => (
                          <th key={n} className={"px-3 py-2 text-left font-bold" + (i === specNames.length - 1 ? " rounded-r-lg" : "")}>{n}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sizeNames.map((z, ri) => (
                        <tr key={z} className={ri % 2 ? "bg-black/[0.03]" : ""}>
                          <td className="px-3 py-2 font-bold">{z}</td>
                          {specNames.map((n) => (
                            <td key={n} className="px-3 py-2 tabular-nums text-black/70">{specAt(z, n)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Rise>
            )}

            {product.methods.length > 0 && (
              <Rise delay={0.08}>
                <h2 className="font-display text-2xl font-black tracking-tight">Artwork guidelines</h2>
                <p className="mt-1.5 text-sm text-black/50">
                  What to send us for {product.methods.join(" / ")}.
                </p>
                <dl className="mt-5 divide-y divide-black/[0.09] border-y border-black/[0.09]">
                  {FILE_GUIDES.filter((g) => g.methods.length === 0 || product.methods.some((m) => g.methods.some((k) => m.toUpperCase().includes(k)))).map((g) => (
                    <div key={g.label} className="flex gap-6 py-3.5">
                      <dt className="w-36 shrink-0 text-sm font-bold">{g.label}</dt>
                      <dd className="min-w-0 text-sm leading-relaxed text-black/65">{g.body}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-sm leading-relaxed text-black/50">
                  Not sure? Send what you have — we check every file before it goes on a machine,
                  and we&apos;ll tell you if something won&apos;t hold up.
                </p>
              </Rise>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

/** A labelled row of read-only facts (method, sizes). Deliberately NOT a picker: there is
 *  nothing on a marketing page to submit a choice to, and a control that looks live but
 *  does nothing is worse than a list that admits what it is. */
function Spec({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-6">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-black/45">{label}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((s) => (
          <span key={s} className="rounded-full border border-black/[0.14] px-3.5 py-1.5 text-sm font-semibold text-black/70">
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

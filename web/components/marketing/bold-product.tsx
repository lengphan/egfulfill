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
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function BoldProduct({ product }: { product: PublicProduct }) {
  // The colourway the visitor is looking at. Selection is REAL feedback even when that colour
  // carries no photo — it is a choice a buyer genuinely makes — but the hero only swaps for a
  // colour that actually has an image, rather than blanking to a placeholder mid-browse.
  const [colorIdx, setColorIdx] = useState<number | null>(null)
  const chosen = colorIdx == null ? null : product.colors[colorIdx] ?? null
  const hero = chosen?.image ?? product.image

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
            <div
              className="relative aspect-square overflow-hidden rounded-2xl border border-black/[0.09]"
              style={{ background: hero ? "#fff" : ACCENT }}
            >
              {hero ? (
                <Image
                  src={hero}
                  alt={chosen ? `${product.name} — ${chosen.name}` : product.name}
                  fill
                  unoptimized
                  priority
                  sizes="(max-width:1024px) 100vw, 55vw"
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

            {/* Colourway rail — only the colours that actually carry a photo, since a rail of
                identical placeholders tells a visitor nothing. Every colour is still listed
                as a chip on the right, so none is hidden by not having been shot. */}
            {product.colors.some((c) => c.image) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {product.colors.map((c, i) =>
                  c.image ? (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setColorIdx(i)}
                      aria-label={c.name}
                      aria-pressed={colorIdx === i}
                      className={
                        "relative size-16 overflow-hidden rounded-xl border transition-colors " +
                        (colorIdx === i ? "border-[#0B0B0C]" : "border-black/[0.09] hover:border-black/40")
                      }
                    >
                      <Image src={c.image} alt="" fill unoptimized sizes="64px" className="object-cover" />
                    </button>
                  ) : null
                )}
              </div>
            )}
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

"use client"

import Link from "next/link"
import { useState } from "react"
import { Eyebrow, Display } from "@/components/marketing/brand/kit"

/**
 * ── NAVIGATION ───────────────────────────────────────────────────────────────────────
 *
 * Four links and one action. The old bar carried six links, a wordmark, a log-in and a
 * button — nine things competing across the top of every page, which is an application
 * toolbar rather than a piece of brand.
 *
 * IT SITS IN FLOW AND SCROLLS AWAY. A bar that stays put has to be readable over whatever
 * scrolls under it, and the two answers to that are both bad: a permanent fill that cuts the
 * hero off from the top of the viewport, or a background that grows at 24px of scroll, which
 * reads as a glitch. Scrolling away is the only option with ONE appearance.
 */
const LINKS = [
  { label: "Products", href: "/catalog" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "Contact", href: "/contact" },
]

export function BrandNav({ tone = "dark", ink, accent, overlay = false }: {
  tone?: "dark" | "light"
  ink: string
  accent: string
  /** Float the bar OVER the section beneath it. A full-bleed hero has to start at the top of
   *  the viewport; a bar in flow above it puts a solid strip across the picture, which is
   *  precisely what stops it being full bleed. */
  overlay?: boolean
}) {
  const [open, setOpen] = useState(false)
  const dim = tone === "dark" ? 0.62 : 0.55

  return (
    <header className={overlay ? "absolute inset-x-0 top-0 z-40" : "relative z-40"}>
      <div className="mx-auto flex max-w-[92rem] items-center justify-between px-6 py-7 sm:px-10">
        <Link href="/" className="flex items-baseline gap-3" aria-label="EGFUL home">
          {/* The wordmark is TYPE, not an asset — set in the brand face at its widest, which
              is the one place the width axis is used as an identity rather than a device. */}
          <span
            className="text-[19px] uppercase"
            style={{
              fontFamily: "var(--font-archivo)", fontVariationSettings: '"wdth" 112',
              fontWeight: 700, letterSpacing: "0.02em", color: ink,
            }}
          >
            EGFUL
          </span>
          <span aria-hidden className="hidden h-1.5 w-1.5 sm:block" style={{ background: accent }} />
        </Link>

        <nav className="hidden items-center gap-10 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="relative text-[14px] transition-opacity duration-200 hover:opacity-100"
              style={{ color: ink, opacity: dim }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-6">
          <Link href="/login" className="hidden text-[14px] transition-opacity hover:opacity-100 sm:block"
            style={{ color: ink, opacity: dim }}>
            Log in
          </Link>
          <Link
            href="/signup"
            className="group hidden items-center gap-2 px-6 py-3 text-[14px] font-medium transition-transform duration-300 hover:-translate-y-0.5 sm:inline-flex"
            style={{ background: ink, color: tone === "dark" ? "#101318" : "#F5F4F1" }}
          >
            Start free
            <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="md:hidden"
            style={{ color: ink }}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            <span className="block h-px w-6" style={{ background: ink }} />
            <span className="mt-1.5 block h-px w-6" style={{ background: ink }} />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t px-6 py-6 md:hidden" style={{ borderColor: `${ink}22` }}>
          <div className="flex flex-col gap-5">
            {[...LINKS, { label: "Log in", href: "/login" }].map((l) => (
              <Link key={l.href} href={l.href} className="text-[18px]" style={{ color: ink }} onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  )
}

/**
 * ── FOOTER ───────────────────────────────────────────────────────────────────────────
 * The wordmark set enormous and cropped by the bottom edge. It is the last thing on the
 * page and the only place the brand shouts its own name — everything above it has been
 * about the work.
 */
const COLUMNS = [
  { head: "Product", links: [["Catalogue", "/catalog"], ["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["API", "/docs"]] },
  { head: "Company", links: [["Contact", "/contact"], ["Integrations", "/integrations"], ["Privacy", "/privacy"], ["Terms", "/terms"]] },
  { head: "Channels", links: [["Etsy", "/integrations"], ["Shopify", "/integrations"], ["TikTok Shop", "/integrations"]] },
] as const

export function BrandFooter({ tone = "dark", ink, ground, accent }: {
  tone?: "dark" | "light"; ink: string; ground: string; accent: string
}) {
  return (
    <footer className="overflow-hidden" style={{ background: ground, color: ink }}>
      <div className="mx-auto max-w-[92rem] px-6 pt-20 sm:px-10">
        <div className="grid gap-y-12 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] md:gap-x-12">
          <div>
            <Eyebrow style={{ color: accent }}>Print on demand, fulfilled</Eyebrow>
            <p className="mt-6 max-w-[30ch] text-[16px] leading-relaxed" style={{ opacity: 0.66 }}>
              Connect a store and your first order can be on a machine today. No monthly fee, no
              minimum, no warehouse.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.head}>
              <span className="text-[12px] uppercase tracking-[0.16em]" style={{ opacity: 0.45 }}>{col.head}</span>
              <ul className="mt-5 flex flex-col gap-3">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="text-[15px] transition-opacity hover:opacity-100" style={{ opacity: 0.7 }}>
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t pt-6 text-[13px]"
          style={{ borderColor: `${ink}22`, opacity: 0.5 }}>
          <span>© {new Date().getFullYear()} EGFUL</span>
          <span>Made, not sourced.</span>
        </div>
      </div>

      {/* Cropped by the bottom edge on purpose — a wordmark that fits inside its band is a
          logo; one running off the page is a brand signing the page. */}
      <div aria-hidden className="mt-10 select-none px-6 sm:px-10">
        <Display
          size="clamp(3.5rem, 18.5vw, 17rem)"
          width={102}
          weight={700}
          leading={0.74}
          tracking="-0.055em"
          className="-mb-[0.18em] w-full text-center uppercase"
          style={{ color: ink, opacity: tone === "dark" ? 0.12 : 0.1 }}
        >
          EGFUL
        </Display>
      </div>
    </footer>
  )
}

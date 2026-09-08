"use client"

import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { BACK, reveal, rise } from "./motion"

/**
 * THE FOOTER — a slate plate with the word set as five cut-out letters you can throw.
 *
 * The letters are the footer's TOY, not its logo: each drifts on its own loop, springs back
 * when thrown, and the real wordmark is the small one in the column below. That is why they
 * carry `alt=""` and the row carries the accessible name — five images spelling a word are
 * one word to a screen reader, not five.
 *
 * The links are the app's REAL routes. The prototype pointed at absolute `egful.store` URLs
 * and at `#engines` anchors that only existed on its own page; here they are `next/link`
 * routes, so they are client transitions and they survive the apex/app split described in
 * CLAUDE.md §3.
 *
 * A ROUTE TO A HUMAN STAYS IN THIS FOOTER. /contact is the published contact page a
 * marketplace reviewing us for API access can cite — a support widget is not a published
 * contact method, so this link is load-bearing and not decoration.
 */

const COLUMNS: { head: string; items: [string, string][] }[] = [
  {
    head: "Product",
    items: [
      ["Catalogue", "/catalog"],
      ["Pricing", "/pricing"],
      ["How it works", "/how-it-works"],
      ["Features", "/features"],
      ["API", "/docs"],
    ],
  },
  {
    head: "Sell on",
    items: [
      ["Etsy", "/how-it-works"],
      ["Shopify", "/how-it-works"],
      ["TikTok Shop", "/how-it-works"],
      ["Amazon", "/integrations/amazon"],
    ],
  },
  {
    head: "Company",
    items: [
      ["Contact", "/contact"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Log in", "/login"],
    ],
  },
]

const LETTERS = [
  { src: "/ploy/letter-e.webp", drift: [-10, -2], dur: 7 },
  { src: "/ploy/letter-g.webp", drift: [12, 3], dur: 8 },
  { src: "/ploy/letter-f.webp", drift: [-8, 2], dur: 6.5 },
  { src: "/ploy/letter-u.webp", drift: [10, -3], dur: 7.5 },
  { src: "/ploy/letter-l.webp", drift: [-12, 2], dur: 8.5 },
] as const

export function PloyFooter() {
  return (
    <footer className="px-6 pb-8 md:px-8">
      <motion.div
        {...rise(0)}
        className="overflow-hidden rounded-[32px] bg-ploy-slate px-8 pt-10 text-ploy-ground md:px-14"
      >
        <div aria-label="EGFUL" role="img" className="flex items-end justify-center gap-[2vw] md:gap-[2.5vw]">
          {LETTERS.map((l) => (
            <motion.div
              key={l.src}
              initial={{ opacity: 0, y: 60, scale: 0.7 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.9, delay: 0.1 + LETTERS.indexOf(l) * 0.09, ease: BACK }}
              drag
              dragSnapToOrigin
              dragElastic={0.5}
              dragTransition={{ bounceStiffness: 300, bounceDamping: 16 }}
              whileHover={{ scale: 1.06 }}
              whileDrag={{ scale: 1.1, cursor: "grabbing", zIndex: 10 }}
              className="cursor-grab touch-none select-none"
            >
              {/* The idle drift is its OWN element under the entrance — two animations owning
                  `y` and `scale` on one node fight, and the letter never appears. */}
              <motion.div
                animate={{ y: [0, l.drift[0], 0], rotate: [0, l.drift[1], 0] }}
                transition={{ duration: l.dur, repeat: Infinity, ease: "easeInOut" }}
                className="pointer-events-none"
              >
                <Image
                  src={l.src}
                  alt=""
                  width={690}
                  height={900}
                  unoptimized
                  draggable={false}
                  className="h-[clamp(72px,17vw,300px)] w-auto"
                />
              </motion.div>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 grid gap-12 border-t border-ploy-ground/15 pt-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <p className="ploy-display text-[32px]">EGFUL</p>
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-ploy-ground/60">
              Print-on-demand fulfilment for Etsy, Shopify and TikTok Shop.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.head}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ploy-ground/45">
                {col.head}
              </p>
              <ul className="mt-5 flex flex-col gap-3">
                {col.items.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="text-[15px] text-ploy-ground/75 transition-colors duration-200 hover:text-ploy-ground">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <motion.div
          {...reveal(0.1)}
          className="mt-16 flex flex-col gap-2 pb-8 text-[13px] text-ploy-ground/45 sm:flex-row sm:justify-between"
        >
          <p>© 2026 EGFUL. All rights reserved.</p>
          <p className="flex gap-4">
            <Link href="/privacy" className="hover:text-ploy-ground">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-ploy-ground">Terms of Service</Link>
          </p>
        </motion.div>
      </motion.div>
    </footer>
  )
}

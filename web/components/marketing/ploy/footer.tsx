"use client"

import Link from "next/link"
import { motion } from "motion/react"
import { reveal, rise } from "./motion"
import { Wordmark } from "@/components/marketing/wordmark"

/**
 * THE FOOTER — a slate plate, the mark, and the links. Nothing else.
 *
 * IT USED TO SPELL "EGFUL" IN BALLOON LETTERS ACROSS THE TOP, five draggable images at up to
 * 300px tall, and they are gone (owner, 2026-09-09). A footer is where someone goes when they
 * are looking for a specific link — a terms page, a contact route, a login — and the toy put
 * a screen of decoration between them and the only thing on it that does a job. It also said
 * the brand's name a third time, under a page that has already said it in the header and in
 * the mark below.
 *
 * The mark in the column IS the wordmark. The footer used to set "EGFUL" in the display face
 * as well, so the site carried two different wordmarks — the real one in the header and a
 * typographic impostor down here. One brand, one mark.
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


export function PloyFooter() {
  return (
    <footer className="px-6 pb-8 md:px-8">
      <motion.div
        {...rise(0)}
        className="overflow-hidden rounded-[32px] bg-ploy-slate px-8 pt-10 text-ploy-ground md:px-14"
      >
        {/* NO RULE ACROSS THE TOP ANY MORE. It divided the balloon letters from the links;
            with the letters gone it was a hairline under nothing, with a band of empty slate
            above it — a divider is a relationship between two things and there was only one
            thing left. */}
        <div className="grid gap-12 pt-2 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            {/* THE MARK ALONE. The line under it — "Print-on-demand fulfilment for Etsy,
                Shopify and TikTok Shop" — was a caption on a logo, in a footer, at the bottom
                of a page that has spent its whole length saying exactly that. §4: a thing
                explains itself or the label is wrong, and a wordmark needs no label. */}
            <Wordmark className="h-[34px] w-auto" />
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

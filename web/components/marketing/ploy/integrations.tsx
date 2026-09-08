"use client"

import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, pop, reveal, rise } from "./motion"
import { Straddle } from "./straddle"
import { GUTTER, SECTION, TOP } from "./rhythm"

/**
 * INTEGRATIONS — the public API, described in public.
 *
 * EVERY ENDPOINT HERE WAS READ OFF THE SERVER, not off the docs page. `server/src/routes/
 * sandbox.js` is the implementation; this list is its `app.get`/`app.post` registrations and
 * `API_SCOPES`, and it must be checked against that file when it changes. The docs page and
 * this page can drift from each other harmlessly — either drifting from the SERVER is what
 * sends an integrator to write against a route that answers 404.
 *
 * THE THREE SHIPPING ROUTES ARE DELIBERATELY ABSENT from the table and named in their own
 * section instead. They exist and they return 501: EGFUL buys carrier labels internally when
 * it ships your order and does not resell label purchasing. The server's own comment is worth
 * repeating — "a 501 costs an integrator ten minutes; a fake tracking number costs them a
 * customer" — and a marketing page that lists them as available is the same lie one layer up.
 *
 * MONO IS FOR CODE, and this is the page where that is not a loophole (§4): a path, a header
 * and a scope are literals someone types. The prose around them is not.
 */

/** Read from `API_SCOPES` in server/src/routes/sandbox.js. */
const SCOPES = [
  ["products.read", "Read the catalogue and stock"],
  ["orders.read", "Read an order and its status"],
  ["orders.write", "Create, quote and cancel orders"],
  ["billing.read", "Read the wallet balance"],
  ["webhooks.read", "List your endpoints"],
  ["webhooks.write", "Register and remove endpoints"],
] as const

/** Verbatim from the route registrations. Nothing aspirational. */
const GROUPS: { head: string; blurb: string; rows: [string, string, string][] }[] = [
  {
    head: "Catalogue",
    blurb:
      "What you can order and whether it is in stock. Both are read-only and both are the same data the catalogue page draws, so a product that appears here is a product the factory keeps.",
    rows: [
      ["GET", "/api/v1/products", "Every product you can order, with its sizes, colours and print methods."],
      ["GET", "/api/v1/stock", "The stock feed for those products."],
    ],
  },
  {
    head: "Orders",
    blurb:
      "Quote first, then create. A quote runs the SAME pricing the charge runs — the size ladder, the print-method surcharge, the dearest line setting postage and your own discount — so the figure you are shown is the figure you are billed.",
    rows: [
      ["POST", "/api/v1/orders/quote", "What a basket costs, before there is an order. Nothing is created and nothing is charged."],
      ["POST", "/api/v1/orders", "Create the order and charge it to your wallet."],
      ["GET", "/api/v1/orders/{id}", "Status, and the tracking number once it ships."],
      ["POST", "/api/v1/orders/{id}/cancel", "Cancel before production and the charge is refunded in full."],
    ],
  },
  {
    head: "Money and keys",
    blurb:
      "The wallet is prepaid and the ledger is append-only, so a balance is a sum of movements rather than a number someone edits.",
    rows: [
      ["GET", "/api/v1/balance", "What is currently on account."],
      ["GET", "/api/v1/ping", "Checks a key and tells you which mode it is in."],
    ],
  },
]

function Method({ m }: { m: string }) {
  // A pill that carries meaning — an HTTP method is the example §4 gives.
  return (
    <span
      className={
        "inline-flex w-[3.4rem] shrink-0 justify-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold " +
        (m === "GET" ? "bg-ploy-acid text-ploy-ink" : "bg-ploy-peri text-ploy-ink")
      }
    >
      {m}
    </span>
  )
}

export function PloyIntegrations({ headline, accent, lead }: { headline: string; accent: string; lead: string }) {
  return (
    <div className="bg-ploy-ground text-ploy-ink">
      <section className={`${GUTTER} ${TOP}`}>
        <h1 className="ploy-display text-[clamp(2.4rem,6vw,5rem)]">
          <motion.span {...reveal(0)} className="block">{headline}</motion.span>
          <motion.span {...reveal(0.1)} className="flex items-center gap-3">
            <span>{accent}</span>
            <motion.span {...pop(0.25)} className="inline-block">
              <Image src="/ploy/obj-cloud.webp" alt="" width={160} height={104} unoptimized className="h-[0.62em] w-auto" />
            </motion.span>
          </motion.span>
        </h1>
        <motion.p {...reveal(0.2)} className="mt-6 max-w-xl text-[17px] leading-relaxed text-ploy-ink/70">
          {lead}
        </motion.p>
        <motion.p {...reveal(0.28)} className="mt-4 max-w-xl text-[15px] leading-relaxed text-ploy-ink/55">
          Selling on Etsy, Shopify or TikTok Shop needs none of this — connect the shop and
          orders arrive on their own.{" "}
          <Link href="/how-it-works" className="underline underline-offset-4">See how that works</Link>.
        </motion.p>
      </section>

      {/* ── TWO MODES, ONE KEY ─────────────────────────────────────────────── */}
      <section className={`${GUTTER} ${SECTION}`}>
        <motion.div {...rise(0)} className="overflow-hidden rounded-[32px] bg-ploy-acid px-8 py-14 md:px-14 md:py-16">
          <h2 className="ploy-display text-[clamp(1.8rem,4vw,3.2rem)]">
            <motion.span {...reveal(0)} className="block">A key, and a mode.</motion.span>
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              [
                "Where it goes",
                <>
                  Send it as <code className="font-mono text-[13px]">X-API-Key</code>, or as{" "}
                  <code className="font-mono text-[13px]">Authorization: Bearer egk_…</code>. Either works.
                </>,
              ],
              [
                "TEST simulates, LIVE is real",
                <>A test key exercises the same routes and shapes without making anything or charging anything. <code className="font-mono text-[13px]">/api/v1/ping</code> tells you which mode a key is in, so you never have to guess.</>,
              ],
              [
                "Scoped, and revocable",
                <>A key carries only the scopes you grant it, and revoking one takes effect immediately. Only the last four characters are ever shown again.</>,
              ],
            ].map(([h, b], i) => (
              <motion.div key={String(h)} {...reveal(0.1 + i * 0.08)}>
                <p className="text-[19px] font-semibold">{h}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ploy-ink/70">{b}</p>
              </motion.div>
            ))}
          </div>

          <motion.div {...reveal(0.3)} className="mt-10 flex flex-wrap gap-2">
            {SCOPES.map(([s, what]) => (
              <span key={s} title={what} className="rounded-full bg-ploy-paper px-3 py-1.5 font-mono text-[12px]">
                {s}
              </span>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ── THE ENDPOINTS ──────────────────────────────────────────────────── */}
      <section className={`relative ${GUTTER} ${SECTION}`}>
        <h2 className="ploy-display text-[clamp(2rem,4.8vw,4rem)]">
          <motion.span {...reveal(0)} className="block">Eight endpoints.</motion.span>
        </h2>
        <motion.p {...reveal(0.1)} className="mt-5 max-w-xl text-[17px] leading-relaxed text-ploy-ink/70">
          That is the whole surface. It is small on purpose: everything the factory does after
          an order is created is our job, not something you orchestrate.
        </motion.p>

        <div className="mt-12 flex flex-col gap-4">
          {GROUPS.map((g, gi) => (
            <motion.div key={g.head} {...rise(0.05 * gi)} className="overflow-hidden rounded-[24px] bg-ploy-paper p-7 md:p-9">
              <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-ploy-ink/45">{g.head}</p>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ploy-ink/65">{g.blurb}</p>
              <ul className="mt-7 flex flex-col">
                {g.rows.map(([m, path, what]) => (
                  <li key={path} className="grid gap-x-4 gap-y-1 border-t border-ploy-ink/8 py-4 md:grid-cols-[3.4rem_18rem_1fr] md:items-baseline">
                    <Method m={m} />
                    <code className="font-mono text-[13.5px] text-ploy-ink">{path}</code>
                    <span className="text-[15px] leading-relaxed text-ploy-ink/65">{what}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
        <Straddle src="/ploy/obj-star.webp" side="right" inset="8%" width="clamp(110px,10vw,160px)" drop={54} drift={[12, -8]} dur={6.5} />
      </section>

      {/* ── WEBHOOKS ───────────────────────────────────────────────────────── */}
      <section className={`${GUTTER} ${SECTION}`}>
        <motion.div {...rise(0)} className="overflow-hidden rounded-[32px] bg-ploy-sky px-8 py-16 md:px-14 md:py-20">
          <h2 className="ploy-display max-w-[16ch] text-[clamp(1.9rem,4.4vw,3.6rem)]">
            <motion.span {...reveal(0)} className="block">Do not poll us.</motion.span>
          </h2>
          <motion.p {...reveal(0.1)} className="mt-5 max-w-xl text-[17px] leading-relaxed text-ploy-ink/70">
            An order that has just been created can only become interesting later, and asking{" "}
            <code className="font-mono text-[14px]">GET /api/v1/orders/&#123;id&#125;</code> every
            minute is the wrong way to find out. Register a URL and we POST to it when something
            happens — with a signature, because anyone can post to a public URL and the
            signature is the only thing proving a delivery came from us.
          </motion.p>
        </motion.div>
      </section>

      {/* ── WHAT IT DELIBERATELY WILL NOT DO ───────────────────────────────── */}
      <section className={`${GUTTER} ${SECTION}`}>
        <motion.div {...rise(0)} className="overflow-hidden rounded-[32px] bg-ploy-slate px-8 py-16 text-ploy-ground md:px-14 md:py-20">
          <h2 className="ploy-display max-w-[20ch] text-[clamp(1.9rem,4.4vw,3.6rem)]">
            <motion.span {...reveal(0)} className="block">What it will not sell you.</motion.span>
          </h2>
          <motion.p {...reveal(0.1)} className="mt-5 max-w-2xl text-[17px] leading-relaxed text-ploy-ground/70">
            There are three routes for buying carrier labels —{" "}
            <code className="font-mono text-[14px]">shipping-rates</code>,{" "}
            <code className="font-mono text-[14px]">shipping-labels/domestics</code> and{" "}
            <code className="font-mono text-[14px]">shipping-labels/internationals</code> — and all
            three answer <span className="font-mono text-[14px]">501</span>. That is deliberate and
            it is not a roadmap item: we buy labels internally when we ship your order, and we do
            not resell label purchasing. An order placed through the API is shipped and tracked
            for you, and you read the tracking back from the order.
          </motion.p>
          <motion.p {...reveal(0.18)} className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ploy-ground/55">
            They answer 501 rather than 404 so an integrator gets a sentence explaining why
            instead of a dead end — and rather than a sample payload, because a fake tracking
            number reaches a real buyer who then watches a number that will never move.
          </motion.p>

          <motion.div {...reveal(0.25)} className="mt-12 flex flex-wrap items-center gap-3">
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/docs" className="inline-block rounded-full bg-ploy-ground px-7 py-3 text-[15px] font-medium text-ploy-ink">
                Full API reference
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/signup" className="inline-block rounded-full border border-ploy-ground/40 px-7 py-3 text-[15px] font-medium text-ploy-ground">
                Get a key
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      <div className="h-20 md:h-28" />
    </div>
  )
}

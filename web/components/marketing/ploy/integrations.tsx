"use client"

import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { HOVER, pop, reveal, rise } from "./motion"
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

      {/* ── THE HANDOVER ──────────────────────────────────────────────────────
          THIS PAGE USED TO BE THE REFERENCE, and it should not be. It listed all eight
          endpoints in a table, explained webhooks, and argued about the three 501s — which is
          /docs's job, and /docs does it better because it can show payloads. Two pages
          documenting one API is two pages that drift apart, and the one that drifts is always
          the marketing copy.

          So this says what connecting means and hands over. The one thing kept from the long
          version is the 501s, because that is the only claim a visitor could get WRONG by
          assuming: every other API in this category sells label buying, and ours deliberately
          does not. Better said once here than discovered at integration time. */}
      <section className={`${GUTTER} ${SECTION}`}>
        <motion.div {...rise(0)} className="overflow-hidden rounded-[32px] bg-ploy-slate px-8 py-14 text-ploy-ground md:px-14 md:py-16">
          <h2 className="ploy-display max-w-[18ch] text-[clamp(1.7rem,3.8vw,3rem)]">
            <motion.span {...reveal(0)} className="block">Eight endpoints, and one we do not sell.</motion.span>
          </h2>
          <motion.p {...reveal(0.1)} className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ploy-ground/70">
            Quote a basket, create the order, read its status and tracking, cancel it, check the
            wallet. That is the whole surface — small on purpose, because everything the factory
            does after an order exists is our job rather than something you orchestrate.
          </motion.p>
          <motion.p {...reveal(0.16)} className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ploy-ground/55">
            Buying carrier labels is not part of it. Those three routes answer{" "}
            <span className="font-mono text-[14px]">501</span> and always will: we buy labels
            internally when we ship your order, and we do not resell label purchasing.
          </motion.p>

          <motion.div {...reveal(0.22)} className="mt-10 flex flex-wrap items-center gap-3">
            <motion.div whileHover={{ scale: 1.03 }} transition={HOVER}>
              <Link href="/docs" className="inline-block rounded-full bg-ploy-ground px-7 py-3 text-[15px] font-medium text-ploy-ink">
                Read the API reference
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

    </div>
  )
}

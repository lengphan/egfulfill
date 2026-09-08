"use client"

import { useRouter } from "next/navigation"
import { motion } from "motion/react"
import { line, reveal, rise } from "./motion"

/**
 * THE CLOSING CTA — the headline set as large as the page ever goes, and one field.
 *
 * The email is carried into /signup as a query param rather than posted anywhere: there is no
 * list to join and no second system to keep in step, so the field is a head start on the form
 * that actually creates the account. `router.push`, not `window.location`, so the app-shell
 * navigation is a client transition like every other link on the site.
 */
export function PloyCta({ heading, subhead, button }: { heading: string[]; subhead: string; button: string }) {
  const router = useRouter()

  /* Same reason as the hero: the heading is editable, so its size comes from its length
     rather than from the one phrase this was drawn around ("Stop touching orders."). At a
     flat 10vw the stored "Ready to put fulfillment on autopilot?" broke into three ragged
     lines that each filled the page. */
  const longest = Math.max(...heading.map((l) => l.length), 1)
  const size =
    longest <= 16 ? "clamp(3rem,10vw,9rem)"
    : longest <= 26 ? "clamp(2.4rem,7vw,6.5rem)"
    : "clamp(2rem,5.2vw,5rem)"

  return (
    <section className="px-6 pb-28 pt-24 md:px-8 md:pb-36 md:pt-32">
      <div className="relative z-10 flex flex-col items-center text-center">
        <h2 className="ploy-display max-w-[16ch]" style={{ fontSize: size }}>
          {heading.map((l, i) => (
            <motion.span key={l} {...line(i)} className="block">
              {l}
            </motion.span>
          ))}
        </h2>
        <motion.p {...reveal(0.2)} className="mt-6 max-w-md text-[16px] text-ploy-ink/65">
          {subhead}
        </motion.p>

        <motion.form
          {...rise(0.25)}
          onSubmit={(e) => {
            e.preventDefault()
            const email = String(new FormData(e.currentTarget).get("email") ?? "")
            router.push(email ? `/signup?email=${encodeURIComponent(email)}` : "/signup")
          }}
          className="ploy-pinned relative mt-14 w-full max-w-[590px] rounded-2xl bg-ploy-paper px-6 py-10 text-ploy-ink/30"
        >
          {/* Carries the two BOTTOM dots; the parent's own pseudo-elements are the top pair. */}
          <span aria-hidden className="ploy-pin" />
          <div className="flex items-center gap-2 rounded-full border border-ploy-ink/15 p-1.5 pl-5">
            <label htmlFor="ploy-cta-email" className="sr-only">
              Your email address
            </label>
            <input
              id="ploy-cta-email"
              name="email"
              type="email"
              required
              placeholder="you@yourstore.com"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-ploy-ink outline-none placeholder:text-ploy-ink/40"
            />
            <button
              type="submit"
              className="shrink-0 rounded-full bg-ploy-ink px-5 py-2.5 text-[14px] font-semibold text-ploy-ground"
            >
              {button}
            </button>
          </div>
          <p className="mt-5 text-[13px] font-semibold text-ploy-ink/50">
            Free to join · No monthly fee · Pay per order
          </p>
        </motion.form>
      </div>
    </section>
  )
}

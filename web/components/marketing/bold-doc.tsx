"use client"

import { motion, useReducedMotion } from "motion/react"
import { ACCENT, ACCENT_INK, HAIRLINE, INK, SURFACE, EASE, Pill } from "@/components/marketing/bold-kit"

/**
 * ── THE DOCUMENT PAGES — privacy, terms, contact, and a channel write-up ────────────────
 *
 * WHY A COMPONENT. Four pages in `(marketing)/` were rendering on the APP's shadcn tokens —
 * `text-muted-foreground`, `border-border`, `bg-card` — inside the marketing group. That is
 * not a small inconsistency. Those tokens are chroma-0 neutrals tuned for a 700-row queue you
 * read all day, they do not move with `[data-skin]`, and the marketing site's whole palette
 * is `--mk-*`. So switching skin changed five pages and left these four behind, and the
 * header above them belonged to a different design than the page under it.
 *
 * They also shared one shape exactly — a title, an intro, a list of {heading, prose}, and a
 * closing line — reimplemented four times in slightly different Tailwind. §4's rule: when the
 * same thing is hand-rolled in double figures the fix is the primitive, not another edit.
 *
 * THE READING LAYOUT IS A GRID, NOT A COLUMN. These pages were `max-w-3xl` centred, so a
 * heading sat directly on top of its own paragraph and thirteen sections read as one
 * undifferentiated scroll — the exact failure Band was written for, at paragraph scale. The
 * heading takes its own track on the left and the prose gets a real measure on the right, with
 * a hairline between rows. That is what a specification looks like, and a legal page is one.
 *
 * A legal page is also the one place a long line of prose is unavoidable, so the prose track
 * is capped at a measure rather than filling the band: 88rem of body copy cannot be read.
 */

/**
 * A row of the document: what it is, and what it says.
 *
 * `k` is the row's KIND, not a subtitle — the Amazon page carries the API role each capability
 * needs ("Direct-to-Consumer Shipping (restricted)"), which is the fact an assessor is reading
 * the page for. A row that has nothing of that kind to say must not invent one: §4's rule
 * against prose under a control is the same rule, and an eyebrow that only repeats the heading
 * is the same defect wearing caps.
 */
export type DocSection = { h: string; p: React.ReactNode; k?: string }

export function DocHero({ title, meta, eyebrow, children }: {
  title: string
  /** What kind of document this is — "Integration". One word or two, never a sentence. */
  eyebrow?: string
  /** "Last updated: 12 August 2026". A fact about the document, not a subtitle for it. */
  meta?: string
  children?: React.ReactNode
}) {
  const reduce = useReducedMotion()
  return (
    <section className="relative -mt-16 pt-16" style={{ background: SURFACE }}>
      <div className="mx-auto max-w-[88rem] px-6 pb-16 pt-14 sm:px-10 sm:pt-20">
        {eyebrow && (
          <motion.div
            className="mb-5 text-[11px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: INK, opacity: 0.45 }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 0.45, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            {eyebrow}
          </motion.div>
        )}
        <motion.h1
          className="max-w-[30ch] font-display font-semibold leading-[0.95] tracking-[-0.032em]"
          style={{ fontSize: "clamp(2.4rem, 6vw, 4.6rem)", color: INK }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          {title}
        </motion.h1>
        {children && (
          <motion.div
            className="mt-7 max-w-2xl text-[17px] leading-relaxed"
            style={{ color: INK, opacity: 0.62 }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12, ease: EASE }}
          >
            {children}
          </motion.div>
        )}
        {/* THE DATE SITS UNDER THE INTRO, not between the title and it. Above, it separated a
            headline from the sentence that completes it; a document's revision date is the
            least important true thing on the page and belongs where the eye lands last. */}
        {meta && (
          <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: INK, opacity: 0.45 }}>
            {meta}
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * The body: heading in its own track, prose in a measure, a hairline between.
 *
 * `tone` picks the ground so a page can alternate bands the way every other page does — a
 * thirteen-section policy on one flat surface is the scroll this direction exists to break up.
 */
export function DocSections({ items, tone = "card", title, intro, className = "" }: {
  items: DocSection[]
  tone?: "paper" | "card"
  /** The band's own heading, when a page has more than one group of rows. */
  title?: string
  intro?: React.ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  if (!items.length) return null
  return (
    <section className="w-full" style={{ background: tone === "card" ? "var(--mk-card)" : SURFACE, color: INK }}>
      <div className={`mx-auto max-w-[88rem] px-6 py-[clamp(3.5rem,7vw,6rem)] sm:px-10 ${className}`}>
        {title && (
          <h2 className="max-w-3xl font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}>
            {title}
          </h2>
        )}
        {intro && (
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed" style={{ color: INK, opacity: 0.62 }}>
            {intro}
          </p>
        )}
        <dl className={title || intro ? "m-0 mt-12" : "m-0"}>
          {items.map((s, i) => (
            <motion.div
              key={s.h}
              className={`grid gap-x-14 gap-y-3 py-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] ${i > 0 ? "border-t" : ""}`}
              style={i > 0 ? { borderColor: HAIRLINE } : undefined}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "0px 0px -8% 0px" }}
              transition={{ duration: 0.5, delay: Math.min(i, 4) * 0.05, ease: EASE }}
            >
              <dt className="font-display text-[clamp(1.15rem,1.7vw,1.45rem)] font-semibold leading-[1.15] tracking-[-0.02em]">
                {s.k && (
                  <span className="mb-2.5 block text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: INK, opacity: 0.45, fontFamily: "inherit" }}>
                    {s.k}
                  </span>
                )}
                {s.h}
              </dt>
              {/* A real measure. `max-w-[68ch]` and not the track's full width: the grid gives
                  the prose a column, and the cap gives it a line length. */}
              <dd className="m-0 max-w-[68ch] text-[16px] leading-relaxed" style={{ color: INK, opacity: 0.72 }}>
                {s.p}
              </dd>
            </motion.div>
          ))}
        </dl>
      </div>
    </section>
  )
}

/**
 * The closing line every one of these pages ends on — where to write, and what else applies.
 * On the ink plate, because it is the page ending, and the page ends the same way everywhere.
 */
export function DocFoot({ children, cta }: {
  children: React.ReactNode
  cta?: { href: string; label: string }
}) {
  return (
    <section className="px-6 py-20 sm:px-10" style={{ background: ACCENT }}>
      <div className="mx-auto grid max-w-[88rem] items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="max-w-[52ch] text-[17px] leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.78 }}>
          {children}
        </div>
        {cta && <Pill href={cta.href} tone="invert" ring>{cta.label}</Pill>}
      </div>
    </section>
  )
}

/**
 * A mail link on either ground. Underlined ALWAYS, not on hover: on a page of prose the only
 * thing marking a link is its colour, and this palette has one ink — so an unmarked link is
 * indistinguishable from bold text until the pointer happens to cross it, and on a touch
 * screen it never is.
 */
export function DocMail({ address, onPlate = false }: { address: string; onPlate?: boolean }) {
  return (
    <a
      href={`mailto:${address}`}
      className="font-medium underline decoration-1 underline-offset-[3px] transition-opacity hover:opacity-70"
      style={{ color: onPlate ? ACCENT_INK : INK }}
    >
      {address}
    </a>
  )
}

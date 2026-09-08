"use client"

import { MotionConfig } from "motion/react"
import { PloyHero } from "./hero"
import { PloySteps } from "./steps"
import { PloyReviews } from "./reviews"
import { PloyMethods } from "./methods"
import { PloyPlans } from "./plans"
import { PloyCta } from "./cta"
import type { SiteContent } from "@/lib/site-content"

/**
 * THE MARKETING HOME, ported from the ploy prototype (~/Downloads/ploykit).
 *
 * WHERE THE WORDS COME FROM. Every string on this page that an admin can reasonably want to
 * change is read from stored site content — the hero, the steps, the figures, the closing
 * CTA. The redesign changed how the words are PRESENTED, never where they come from, so an
 * edit in Settings › Site content still lands here exactly as it did on the old page.
 *
 * The two exceptions are deliberate and both are facts rather than copy: the seven print
 * methods (what the machines on the floor can do) and the three plans (read from
 * `lib/plans.ts`, so the marketing card and the signed-in billing page cannot disagree).
 *
 * WHERE THE COLOURS COME FROM. Nothing here names a colour. The `ploy-*` utilities resolve
 * to `--mk-*`, which the marketing layout sets from the stored skin — so this page follows
 * Settings › Branding like the rest of the public site.
 *
 * REDUCED MOTION is handled once, here, by MotionConfig rather than per component. It covers
 * the reveals, the drags and the hovers together; the two CSS animations (the marquee and
 * the idle float) carry their own media query in globals.css.
 */
export function PloyHome({ content }: { content: SiteContent }) {
  const { hero, steps, stats, testimonials, cta } = content

  /* A headline is stored as two fields and set as two LINES — the prototype's "Sell it. / We
     make it." Splitting on a newline would be a second convention to remember; the two fields
     already exist and already mean "the lead" and "the tail". */
  const heroLines = [hero.headline, hero.accent]

  /* The steps block's own heading is stored as one sentence and set as up to two lines, so it
     breaks where the writer put a full stop rather than wherever the box happens to end. A
     heading with no full stop stays one line, which is the right answer for a short one. */
  const stepHeading = splitSentences(steps.heading, 2)
  const ctaHeading = splitSentences(cta.heading, 2)

  return (
    <MotionConfig reducedMotion="user">
      {/* `-mt-16` cancels the layout's header gutter: this hero runs to the very top of the
          viewport with the capsule floating over it, which is the one page that should. */}
      <div className="ploy-home -mt-16 bg-ploy-ground text-ploy-ink">
        <PloyHero
          headline={heroLines[0]}
          accent={heroLines[1]}
          subhead={hero.subhead}
          ctaPrimary={hero.ctaPrimary}
          ctaSecondary={hero.ctaSecondary}
        />
        <PloySteps heading={stepHeading} lead={LEAD} steps={steps.items} stats={stats} />
        <PloyReviews heading={testimonials.heading} items={testimonials.items} />
        <PloyMethods />
        <PloyPlans />
        <PloyCta heading={ctaHeading} subhead={cta.subhead} button={cta.button} />
      </div>
    </MotionConfig>
  )
}

/**
 * The lead under the steps heading. NOT stored content: it is the argument the section makes,
 * written against the four steps directly below it.
 *
 * IT DOES NOT CALL SELLING EASY. It opened "A sale is the easy half", which is a sentence
 * that tells someone their hardest work was the simple bit — and the person reading it has
 * spent months on listings, photography and ads. The thing they actually recognise is the
 * search for a printer who does not let them down, so that is what it says now. Shorter, too:
 * two sentences, because this sits under a display headline and a paragraph competing with
 * one is a paragraph nobody finishes.
 */
const LEAD = [
  "Finding a printer you can trust is the hard part. Most sellers try a few before one of them ships on time — and by then the reviews have already happened.",
  "We make everything ourselves, in one factory. One queue, one standard, and the tracking back on your listing without you opening a shipping screen.",
]

/** Break a stored sentence into at most `max` display lines, keeping the punctuation. */
function splitSentences(text: string, max: number): string[] {
  const parts = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? []
  if (parts.length <= 1) return [text]
  if (parts.length <= max) return parts
  // More sentences than lines: keep the first, and let the rest share the last line.
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join(" ")]
}

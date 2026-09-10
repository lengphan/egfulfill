import { GUTTER, TOP } from "@/components/marketing/ploy/rhythm"

/**
 * THE CLICK HAS TO DO SOMETHING IMMEDIATELY.
 *
 * This page is a server component, so a navigation to it paints NOTHING until the server has
 * fetched the catalogue and rendered it. On a slug that is not pre-rendered — anything
 * published since the last build — that is a full Vercel→API round trip during which the
 * browser sits with the old page on screen and no sign that the click registered. It reads
 * as an app that ignored you, which is worse than one that is slow.
 *
 * Next streams this the instant the navigation starts. It is deliberately the SHAPE of what
 * arrives rather than a spinner: a skeleton that matches makes the swap feel like the page
 * finishing, where a spinner makes it feel like the page starting over.
 *
 * REDRAWN WITH THE ROUTE (this is the point of the file). It used to be a product page — one
 * tall square and a column of type — because that is what this route rendered. The route
 * renders the CATALOGUE with a product open now, so the old skeleton would have flashed the
 * wrong shape and then swapped, which is precisely the effect the paragraph above says a
 * skeleton exists to avoid. A skeleton nobody updates is worse than none.
 *
 * No animation beyond a slow pulse, and none at all under prefers-reduced-motion (Tailwind's
 * motion-safe): a shimmering placeholder on a page about photographs is its own distraction.
 */
export default function Loading() {
  return (
    <div className="bg-ploy-ground text-ploy-ink">
      <section className={`${GUTTER} ${TOP}`}>
        {/* The masthead: two display lines and a two-line lead, at the real weights. */}
        <div className="h-[clamp(2.4rem,6vw,5rem)] w-[min(22rem,60%)] rounded bg-ploy-ink/[0.09] motion-safe:animate-pulse" />
        <div className="mt-2 h-[clamp(2.4rem,6vw,5rem)] w-[min(26rem,70%)] rounded bg-ploy-ink/[0.09] motion-safe:animate-pulse" />
        <div className="mt-6 max-w-xl space-y-2.5">
          <div className="h-4 w-full rounded bg-ploy-ink/[0.05] motion-safe:animate-pulse" />
          <div className="h-4 w-2/3 rounded bg-ploy-ink/[0.05] motion-safe:animate-pulse" />
        </div>
      </section>

      {/* The bar — search left, the method rule right — and the rule it sits on, so the grid
          below does not jump up by its height when the real one lands. */}
      <section className={`${GUTTER} pt-5 md:pt-6`}>
        <div className="flex items-center gap-6 border-b border-ploy-ink/15 pb-3">
          <div className="h-4 w-64 rounded bg-ploy-ink/[0.06] motion-safe:animate-pulse" />
          <div className="ml-auto hidden gap-5 md:flex">
            {[2.5, 4.5, 4, 4.5].map((w, i) => (
              <div key={i} className="h-4 rounded bg-ploy-ink/[0.05] motion-safe:animate-pulse" style={{ width: `${w}rem` }} />
            ))}
          </div>
        </div>
      </section>

      {/* One category word and a row of four, at the grid's real ratio and columns. Four is
          enough to establish the shape — a full page of placeholders is a page of noise. */}
      <section className={`${GUTTER} pt-5 md:pt-6`}>
        <div className="mb-6 h-[clamp(1.6rem,3.2vw,2.8rem)] w-40 rounded bg-ploy-ink/[0.08] motion-safe:animate-pulse" />
        <div className="grid grid-cols-12 gap-4 md:gap-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="col-span-6 sm:col-span-4 lg:col-span-3">
              <div className="aspect-[5/6] w-full rounded-[26px] bg-ploy-ink/[0.06] motion-safe:animate-pulse" />
              <div className="mt-3 h-4 w-3/4 rounded bg-ploy-ink/[0.07] motion-safe:animate-pulse" />
              <div className="mt-1.5 h-3.5 w-1/2 rounded bg-ploy-ink/[0.05] motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      </section>

      <span className="sr-only" role="status">Loading the catalogue…</span>
    </div>
  )
}

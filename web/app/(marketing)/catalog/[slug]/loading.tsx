import { SURFACE } from "@/components/marketing/bold-kit"

/**
 * THE CLICK HAS TO DO SOMETHING IMMEDIATELY.
 *
 * This page is a server component, so a navigation to it paints NOTHING until the server has
 * fetched the product and rendered it. On a slug that is not pre-rendered — anything
 * published since the last build — that is a full Vercel→API round trip during which the
 * browser sits on the catalogue with the old page still on screen and no sign that the click
 * registered. It reads as an app that ignored you, which is worse than one that is slow.
 *
 * Next streams this the instant the navigation starts. It is deliberately the SHAPE of the
 * product page — a tall image block and a column of type — rather than a spinner: a skeleton
 * that matches what arrives makes the swap feel like the page finishing, where a spinner
 * makes it feel like the page starting over.
 *
 * No animation beyond a slow pulse, and none at all under prefers-reduced-motion (Tailwind's
 * motion-safe): a shimmering placeholder on a page about photographs is its own distraction.
 */
export default function Loading() {
  return (
    <div className="text-[#0B0B0C]" style={{ background: SURFACE }}>
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-10">
        {/* The back-link slot, so the top of the page doesn't jump when the real one lands. */}
        <div className="h-4 w-28 rounded bg-black/[0.07] motion-safe:animate-pulse" />

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-16">
          {/* The photograph. Square, because every product image on this site is. */}
          <div className="aspect-square w-full rounded-2xl bg-black/[0.06] motion-safe:animate-pulse" />

          <div className="pt-2">
            <div className="h-3 w-24 rounded bg-black/[0.07] motion-safe:animate-pulse" />
            <div className="mt-4 h-9 w-4/5 rounded bg-black/[0.09] motion-safe:animate-pulse" />
            <div className="mt-2.5 h-9 w-3/5 rounded bg-black/[0.09] motion-safe:animate-pulse" />
            <div className="mt-7 h-7 w-28 rounded bg-black/[0.08] motion-safe:animate-pulse" />

            {/* Three lines of blurb, the last one short — a paragraph, not a block. */}
            <div className="mt-8 space-y-2.5">
              <div className="h-3.5 w-full rounded bg-black/[0.05] motion-safe:animate-pulse" />
              <div className="h-3.5 w-full rounded bg-black/[0.05] motion-safe:animate-pulse" />
              <div className="h-3.5 w-2/3 rounded bg-black/[0.05] motion-safe:animate-pulse" />
            </div>

            {/* The size and method pills. */}
            <div className="mt-9 flex flex-wrap gap-2">
              {[3.5, 3, 3.5, 4, 4.5, 3].map((w, i) => (
                <div key={i} className="h-8 rounded-full bg-black/[0.06] motion-safe:animate-pulse" style={{ width: `${w}rem` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">Loading product…</span>
    </div>
  )
}

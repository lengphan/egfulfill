"use client"

import { useEffect, useState } from "react"

/**
 * Contents rail that knows where you are.
 *
 * Split into its own client component so the docs page itself stays a server component
 * and keeps its `metadata` export — scroll position is the only thing here that needs
 * the browser.
 *
 * Tracked with IntersectionObserver rather than a scroll listener: the browser reports
 * only when a boundary is crossed, instead of us recomputing offsets on every frame of
 * a scroll.
 */
export function DocsNav({ sections }: { sections: [string, string][] }) {
  const [active, setActive] = useState(sections[0]?.[0] ?? "")

  useEffect(() => {
    const els = sections
      .map(([id]) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el)
    if (!els.length) return

    const io = new IntersectionObserver(
      (entries) => {
        // Several sections can be on screen at once — a short one sits entirely inside
        // the viewport while the next is entering. Pick the one nearest the top edge, so
        // the highlight matches the heading you're actually reading rather than whichever
        // fired last.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      // Top band only. Without shrinking the bottom, a tall section stays "intersecting"
      // long after its heading has scrolled away.
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [sections])

  return (
    <nav aria-label="Contents" className="hidden self-start lg:sticky lg:top-24 lg:block">
      <div className="space-y-1 border-l border-border">
        {sections.map(([id, label]) => {
          const on = active === id
          return (
            <a
              key={id}
              href={`#${id}`}
              aria-current={on ? "location" : undefined}
              className={
                "-ml-px block border-l py-1 pl-4 text-sm transition-colors " +
                (on
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground")
              }
            >
              {label}
            </a>
          )
        })}
      </div>
    </nav>
  )
}

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HEROES } from "@/components/marketing/brand/heroes"
import { GROUNDS } from "@/components/marketing/brand/lumen"

/**
 * A review control, not part of the brand. It sits at the FOOT of the viewport rather than
 * the top so it never competes with the brand nav it exists to let you compare.
 */
const STYLES = [
  { href: "/lab/1", key: "A", name: "Press" },
  { href: "/lab/2", key: "B", name: "Atelier" },
]

export function StyleSwitch() {
  const path = usePathname()
  return (
    <div className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full px-1.5 py-1.5 shadow-lg"
      style={{ background: "#101318", border: "1px solid #ffffff22" }}>
      {STYLES.map((s) => {
        const on = path === s.href
        return (
          <Link key={s.href} href={s.href}
            className="rounded-full px-4 py-2 text-[13px] transition-colors"
            style={{
              background: on ? "#614EFA" : "transparent",
              color: on ? "#FFFFFF" : "#F5F4F1",
              opacity: on ? 1 : 0.6,
            }}>
            <span className="tabular-nums opacity-60">{s.key}</span>&nbsp;{s.name}
          </Link>
        )
      })}
    </div>
  )
}

/**
 * Hero picker — a review control, pinned top-right so it never covers the headline it exists
 * to let you judge. Three candidates, all already shot.
 */


export function HeroSwitch({ current }: { current: string }) {
  return (
    <div className="fixed right-5 top-24 z-[60] flex flex-col gap-1 rounded-lg p-1.5 shadow-lg"
      style={{ background: "#101318", border: "1px solid #ffffff22" }}>
      <span className="px-2.5 pb-1 pt-0.5 text-[10px] uppercase tracking-[0.16em]" style={{ color: "#ffffff66" }}>
        Hero
      </span>
      {Object.entries(HEROES).map(([k, h]) => {
        const on = k === current
        return (
          <Link key={k} href={`/lab/1?hero=${k}`} scroll={false}
            className="rounded px-3 py-2 text-[13px] transition-colors"
            style={{
              background: on ? "#614EFA" : "transparent",
              color: on ? "#FFFFFF" : "#F5F4F1",
              opacity: on ? 1 : 0.6,
            }}>
            <span className="tabular-nums opacity-60">{k}</span>&nbsp;{h.label}
          </Link>
        )
      })}
    </div>
  )
}

/** Ground picker for Lumen — the beige-versus-grey question, settled by looking. */
export function GroundSwitch({ current }: { current: string }) {
  return (
    <div className="fixed right-5 top-24 z-[60] flex flex-col gap-1 rounded-2xl p-1.5"
      style={{ background: "#FFFFFFEE", boxShadow: "0 2px 18px rgba(60,49,91,.16)" }}>
      <span className="px-2.5 pb-1 pt-0.5 text-[10px] uppercase tracking-[0.16em]" style={{ color: "#86848D" }}>
        Ground
      </span>
      {Object.values(GROUNDS).map((g) => {
        const on = g.key === current
        return (
          <Link key={g.key} href={`/lab/3?ground=${g.key}`} scroll={false}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors"
            style={{ background: on ? "#E2DFFE" : "transparent", color: "#3C315B", opacity: on ? 1 : 0.65 }}>
            <span className="size-3.5 rounded-full" style={{ background: g.page, boxShadow: "inset 0 0 0 1px rgba(60,49,91,.2)" }} />
            {g.label}
          </Link>
        )
      })}
    </div>
  )
}

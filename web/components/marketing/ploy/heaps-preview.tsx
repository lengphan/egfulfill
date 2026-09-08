"use client"

import { PloyDrop, type DropVariant } from "./drop"
import { GUTTER, SECTION } from "./rhythm"

const OPTIONS: { key: DropVariant; name: string; note: string }[] = [
  { key: "mound", name: "A · Mound", note: "Wide base, packed middle, one small thing on top. The pile silhouette." },
  { key: "column", name: "B · Column", note: "A tall narrow stack hugging the outer edge. Climbs rather than spreads." },
  { key: "drift", name: "C · Drift", note: "Low and wide, nothing more than two deep. Reads as scattered, not piled." },
  { key: "arc", name: "D · Arc", note: "Highest at the outer edge, falling toward the card. Frames it like a bracket." },
]

export function HeapsPreview() {
  return (
    <div className="bg-ploy-ground text-ploy-ink">
      <section className={`${GUTTER} pt-24`}>
        <h1 className="ploy-display text-[clamp(2rem,4.4vw,3.6rem)]">Heaps — four options</h1>
        <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-ploy-ink/65">
          Each band below is the real closing section at its real size. Scroll slowly — every
          set falls once, when its band comes into view. They are draggable.
        </p>
      </section>

      {OPTIONS.map((o) => (
        <section key={o.key} className={`relative overflow-hidden ${GUTTER} ${SECTION}`}>
          <div className="relative z-10 flex flex-col items-center py-10 text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/45">{o.name}</p>
            <h2 className="ploy-display mt-3 text-[clamp(2rem,5vw,4rem)]">Stop touching orders.</h2>
            <p className="mt-3 max-w-md text-[15px] text-ploy-ink/60">{o.note}</p>
            <div className="mt-8 w-full max-w-[590px] rounded-2xl bg-ploy-paper px-6 py-10">
              <div className="flex items-center gap-2 rounded-full border border-ploy-ink/15 p-1.5 pl-5">
                <span className="flex-1 text-left text-[15px] text-ploy-ink/40">you@yourstore.com</span>
                <span className="rounded-full bg-ploy-ink px-5 py-2.5 text-[14px] font-semibold text-ploy-ground">
                  Start for free
                </span>
              </div>
            </div>
          </div>
          <PloyDrop variant={o.key} />
        </section>
      ))}

      <div className="h-24" />
    </div>
  )
}

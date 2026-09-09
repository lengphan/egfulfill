"use client"

import { useEffect, useState } from "react"
import { useLabelT } from "@/lib/i18n"
import { getFactorySettings } from "@/lib/api"

/**
 * WHAT A DESIGN PAYS, AS THREE PILLS.
 *
 * One flat rate priced a one-colour redraw the same as a five-colour digitise, so the hard
 * jobs were the ones nobody claimed. Three bands, priced once in Settings › Platform, chosen
 * on the card — and chosen at the DOOR wherever a card is created, because the person sending
 * it is looking at the artwork and is the one who can judge it without opening anything.
 *
 * THE HINTS ARE THE CONTRACT. The rates are only as fair as the words that decide them, so
 * what "Standard" means is written once, here, and shown on hover in every place that offers
 * the choice. Two people disagreeing about which band a job is costs more than either rate.
 *
 * IT NEVER SENDS A FIGURE. The pill carries its rate so nobody has to open Settings to know
 * what they are agreeing to, but the amount is read server-side from the band when the card
 * is credited — a client naming what somebody earns is the shape of hole that made
 * POST /api/wallet/ledger staff-only.
 */
export type Band = "easy" | "standard" | "complex"

export const BANDS: { id: Band; label: string; hint: string }[] = [
  { id: "easy", label: "Easy", hint: "Text or a supplied vector, one colour, no redraw." },
  { id: "standard", label: "Standard", hint: "A redraw, two to four colours, ordinary cleanup." },
  { id: "complex", label: "Complex", hint: "Digitising, a photo trace, five or more colours." },
]

export type BandRates = Record<Band, number>
const NO_RATES: BandRates = { easy: 0, standard: 0, complex: 0 }

/**
 * The three rates, plus the flat fee an unbanded card still pays.
 *
 * Fetched on mount and depending on nothing it writes (CLAUDE.md §2.8). Every caller wants
 * the same four numbers, and a hook is what stops each one re-deriving which settings key
 * belongs to which band.
 */
export function useBandRates(): { rates: BandRates; flat: number } {
  const [rates, setRates] = useState<BandRates>(NO_RATES)
  const [flat, setFlat] = useState(0)
  useEffect(() => {
    let live = true
    getFactorySettings()
      .then((s) => {
        if (!live) return
        setFlat(Number(s.designer_payout) || 0)
        setRates({
          easy: Number(s.design_band_easy) || 0,
          standard: Number(s.design_band_standard) || 0,
          complex: Number(s.design_band_complex) || 0,
        })
      })
      .catch(() => {})
    return () => { live = false }
  }, [])
  return { rates, flat }
}

const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`

/**
 * `value` null means NOT PRICED — which is not "Easy", and the row says so rather than
 * pre-selecting a band nobody chose. An unbanded card pays the flat fallback, so the absence
 * is a real state with real consequences and has to look like one.
 *
 * `size="sm"` is the on-card version: small enough to sit on a board tile without competing
 * with the design itself.
 */
export function BandPills({
  value,
  onPick,
  rates,
  flat,
  size = "md",
  className,
}: {
  value?: Band | null
  onPick: (b: Band) => void
  rates: BandRates
  flat?: number
  size?: "sm" | "md"
  className?: string
}) {
  const tl = useLabelT()
  const sm = size === "sm"
  return (
    <div className={"flex flex-wrap items-center gap-1.5 " + (className ?? "")}>
      {BANDS.map((b) => {
        const on = value === b.id
        const rate = rates[b.id] || flat || 0
        return (
          <button
            key={b.id}
            type="button"
            aria-pressed={on}
            title={b.hint}
            onClick={(e) => { e.stopPropagation(); onPick(b.id) }}
            className={
              (sm
                ? "inline-flex h-6 items-center gap-1 rounded-lg border px-2 text-xs transition-colors "
                : "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ") +
              (on
                ? "border-foreground bg-foreground font-medium text-background"
                : "border-input hover:border-foreground/40")
            }
          >
            {tl("designer", b.label)}
            {rate > 0 && <span className="tabular-nums opacity-70">{usd(rate)}</span>}
          </button>
        )
      })}
    </div>
  )
}

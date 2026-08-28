"use client"

import { useLabelT } from "@/lib/i18n"
/**
 * Settings › Site content › Motion — tune how the marketing pages arrive, and WATCH it.
 *
 * THE PREVIEW IS THE FEATURE. Numbers like "0.55s, 22px, cubic-bezier(0.16, 1, 0.3, 1)" are
 * unreadable as feel; nobody can tell 0.55 from 0.7 by looking at the digits. So the stage on
 * the right renders the same shapes the real pages use — a heading, a card grid, a list — and
 * replays them on every change.
 *
 * IT IS NOT A MOCK-UP OF THE ANIMATION. It calls `entrance()` from lib/motion.ts, the exact
 * function bold-kit's `Rise` calls, with the exact preset being edited. There is no second
 * implementation that could drift, which is the only reason the preview is worth trusting —
 * a preview that approximates the real thing is worse than none, because it is believed.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { TabBar } from "@/components/app/tab-bar"
import {
  DEFAULT_MOTION, LIMITS, PRESET_NAMES, clampField, entrance,
 type MotionPreset, type MotionSettings, type PresetName,
} from "@/lib/motion"

/** What each preset is FOR. Shown in the editor, because "drift" alone doesn't say when. */
const ABOUT: Record<PresetName, { title: string; use: string }> = {
 rise: { title: "Rise", use: "The default. Anything without a reason to be different." },
 settle: { title: "Settle", use: "Big single blocks — a closing CTA band, a product hero." },
 drift: { title: "Drift", use: "Numbered steps and alternating rows, where sliding up makes every item look like the last." },
 bloom: { title: "Bloom", use: "Card grids. Twelve cards sliding up is a wave; twelve blooming in place is a grid appearing." },
 cut: { title: "Cut", use: "Dense text, tables, size charts — where a big slide is just the page moving while someone reads." },
}

/**
 * Named curves, because a cubic-bezier is four numbers nobody can picture.
 *
 * The raw values stay visible and stay stored — this is a picker over the same field, not a
 * different one — so a curve that isn't in the list still round-trips instead of being reset
 * to the nearest match on load.
 */
const CURVES: { label: string; value: [number, number, number, number] }[] = [
  { label: "Hard ease-out (house)", value: [0.16, 1, 0.3, 1] },
  { label: "Soft ease-out", value: [0.22, 0.61, 0.36, 1] },
  { label: "Ease in-out", value: [0.65, 0, 0.35, 1] },
  { label: "Gentle", value: [0.33, 1, 0.68, 1] },
  { label: "Linear", value: [0, 0, 1, 1] },
]
const curveKey = (e: readonly number[]) => e.join(",")

const FIELDS: { key: keyof typeof LIMITS; label: string; unit: string }[] = [
  { key: "y", label: "Vertical travel", unit: "px" },
  { key: "x", label: "Horizontal travel", unit: "px" },
  { key: "scale", label: "Start scale", unit: "×" },
  { key: "duration", label: "Duration", unit: "s" },
  { key: "delay", label: "Delay", unit: "s" },
  { key: "stagger", label: "Stagger", unit: "s" },
]

const RANGE =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

/** One labelled slider with a live numeric readout. Defined at module scope — a component
 * declared inside render remounts every keystroke (react-hooks/static-components). */
function Slider({ label, unit, value, min, max, step, onChange }: {
 label: string; unit: string; value: number
 min: number; max: number; step: number; onChange: (n: number) => void
}) {
  const tl = useLabelT()
 return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{tl("motionEditor", label)}</span>
        <span className="tabular-nums text-xs tabular-nums text-muted-foreground">
          {step < 0.01 ? value.toFixed(3) : step < 1 ? value.toFixed(2) : Math.round(value)}{unit}
        </span>
      </span>
      <input
 type="range" className={`${RANGE} mt-1.5`} value={value}
 min={min} max={max} step={step}
 onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

/** The shapes the stage animates. Deliberately abstract — this is about timing, not content. */
const TILES = [0, 1, 2, 3, 4, 5]

export function MotionEditor({ value, onChange }: {
 value: MotionSettings
 onChange: (next: MotionSettings) => void
}) {
  const tl = useLabelT()
 const [name, setName] = useState<PresetName>("rise")
 const reduce = useReducedMotion()
 const preset = value[name] ?? DEFAULT_MOTION[name]

  /**
   * REPLAY IS DEBOUNCED, AND ALSO MANUAL.
   *
   * Remounting on every change is right in principle (CLAUDE.md §5 — reset by remounting, not
   * by an effect that renders stale state) and useless in practice while a slider is being
   * dragged: the stage restarts sixty times a second and the animation never once finishes, so
   * you never see the thing you are adjusting. Settling for ~320ms after the last input plays
   * it exactly when the hand stops. The button is for playing it again without touching a
   * value, which is most of what tuning actually consists of.
   */
 const [replay, setReplay] = useState(0)
 const stamp = useMemo(() => JSON.stringify(preset), [preset])
 useEffect(() => {
 const t = setTimeout(() => setReplay((n) => n + 1), 320)
 return () => clearTimeout(t)
  }, [stamp])

 const set = useCallback((k: keyof MotionPreset, v: MotionPreset[keyof MotionPreset]) => {
 onChange({ ...value, [name]: { ...preset, [k]: v } })
  }, [onChange, value, name, preset])

 const isDefault = stamp === JSON.stringify(DEFAULT_MOTION[name])
  // The stage replays as a unit, so the key covers the preset AND the counter — switching
  // preset must restart it too, or you read the new numbers over the old animation.
 const stageKey = `${name}:${replay}`

 return (
    <div className="space-y-4">
      <TabBar
        look="segmented"
        size="sm"
        spacing="none"
        ariaLabel={tl("motionEditor", "Preset")}
        items={PRESET_NAMES.map((p) => ({ id: p, label: tl("motionEditor", ABOUT[p].title) }))}
        value={name}
        onChange={setName}
      />

      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{tl("motionEditor", ABOUT[name].title)}</span> — {ABOUT[name].use}{" "}
        Which sections use it is set in the page code, not here; this is how it feels.
      </p>

      {reduce && (
        <div className="flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">
          <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            {tl("motionEditor", "Your system is set to reduce motion, so the preview below fades instead of moving — and so does the live site, for anyone with that setting. The travel and easing you set here are real, they are just not what you personally will see.")}
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* ── The controls ── */}
        <div className="space-y-4">
          {FIELDS.map((f) => (
            <Slider
 key={f.key} label={f.label} unit={f.unit}
 value={preset[f.key]}
 min={LIMITS[f.key].min} max={LIMITS[f.key].max} step={LIMITS[f.key].step}
 onChange={(n) => set(f.key, clampField(f.key, n))}
            />
          ))}

          <label className="block">
            <span className="text-xs font-medium">{tl("motionEditor", "Curve")}</span>
            <select
 className="mt-1.5 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
 value={CURVES.some((c) => curveKey(c.value) === curveKey(preset.ease)) ? curveKey(preset.ease) : "custom"}
 onChange={(e) => {
 const found = CURVES.find((c) => curveKey(c.value) === e.target.value)
 if (found) set("ease", [...found.value])
              }}
            >
              {CURVES.map((c) => <option key={c.label} value={curveKey(c.value)}>{tl("motionEditor", c.label)}</option>)}
              {/* A stored curve that matches no entry stays selectable and stays saved rather
 than being silently snapped to the nearest preset on load. */}
              {!CURVES.some((c) => curveKey(c.value) === curveKey(preset.ease)) && (
                <option value="custom">Custom — {curveKey(preset.ease)}</option>
              )}
            </select>
            <span className="mt-1 block tabular-nums text-2xs text-muted-foreground">
 cubic-bezier({preset.ease.join(", ")})
            </span>
          </label>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setReplay((n) => n + 1)}>
              {tl("motionEditor", "Replay")}
            </Button>
            <Button
 size="sm" variant="ghost" disabled={isDefault}
 onClick={() => onChange({ ...value, [name]: { ...DEFAULT_MOTION[name] } })}
 className="text-muted-foreground"
            >
              {isDefault ? tl("motionEditor", "Is the default") : tl("motionEditor", "Reset to default")}
            </Button>
          </div>
        </div>

        {/* ── The stage ──
            Paper, not card — the marketing pages are cream, and judging a 22px rise against a
 different background than the one it ships on is how you end up re-tuning it twice. */}
        <div
 key={stageKey}
 className="overflow-hidden rounded-xl border border-border p-6"
 style={{ background: "#F2F1EC", color: "#0B0B0C", minHeight: 300 }}
        >
          <motion.div {...entrance(preset, { reduce: !!reduce })}>
            <div className="h-7 w-2/3 rounded bg-black/[0.82]" />
            <div className="mt-2.5 h-3 w-1/2 rounded bg-black/[0.16]" />
          </motion.div>

          <div className="mt-7 grid grid-cols-3 gap-3">
            {TILES.map((i) => (
              <motion.div
 key={i}
                // index is what makes the stagger visible — six tiles arriving together tell
                // you nothing about the one control most worth getting right.
                {...entrance(preset, { index: i + 1, reduce: !!reduce })}
 className="rounded-lg border border-black/[0.09] bg-white p-3"
              >
                <div className="h-10 rounded bg-black/[0.06]" />
                <div className="mt-2 h-2 w-3/4 rounded bg-black/[0.18]" />
                <div className="mt-1.5 h-2 w-1/2 rounded bg-black/[0.10]" />
              </motion.div>
            ))}
          </div>

          <div className="mt-6 space-y-2">
            {[0, 1].map((i) => (
              <motion.div
 key={i}
                {...entrance(preset, { index: i + 7, reduce: !!reduce })}
 className="flex items-center gap-3 rounded-lg border border-black/[0.09] bg-white px-4 py-3"
              >
                <span className="h-5 w-16 shrink-0 rounded-full bg-black/[0.08]" />
                <span className="h-2 w-full rounded bg-black/[0.12]" />
              </motion.div>
            ))}
          </div>

          <p className="mt-5 text-2xs leading-snug text-black/45">
            The last element lands at{" "}
            <span className="tabular-nums">
              {(preset.delay + 8 * preset.stagger + preset.duration).toFixed(2)}s
            </span>
            . Past about 1.5s a section reads as slow to arrive rather than considered.
          </p>
        </div>
      </div>
    </div>
  )
}

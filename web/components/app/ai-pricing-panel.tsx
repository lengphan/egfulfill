"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Check, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { getAiPricing, saveAiPricing, type AiPricing } from "@/lib/api"

/**
 * AI GENERATION PRICING — what a seller pays to generate an image.
 *
 * The cost figures below are OURS, at Google, and they are shown here because an admin
 * setting a price without them is guessing. They are never sent to a seller: the
 * seller-facing read returns only their price and their remaining allowance.
 *
 * Sellers are OFF until switched on, so this panel is also the feature's on/off switch.
 * Video is deliberately absent — it stays admin-only, because a clip costs up to fifteen
 * images and is a marketing asset rather than something that becomes a listing.
 */

/** What a render actually costs us, from the model catalogue in server/src/gemini.js. */
const COST_LOW = 0.0336   // flash-lite 1K
const COST_HIGH = 0.134   // pro 2K, the default

export function AiPricingPanel() {
  const [p, setP] = useState<AiPricing | null>(null)
  const [imagePrice, setImagePrice] = useState("")
  const [freePerMonth, setFreePerMonth] = useState("")
  const [dailyCap, setDailyCap] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getAiPricing()
      .then((r) => {
        setP(r)
        setEnabled(!!r.sellersEnabled)
        setImagePrice(String(r.imagePrice ?? ""))
        setFreePerMonth(String(r.freeImagesPerMonth ?? ""))
        setDailyCap(String(r.dailyImageCap ?? ""))
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load AI pricing."))
  }, [])
  // Deferred a tick — react-hooks/set-state-in-effect, the pattern used across app pages.
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const save = async () => {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const r = await saveAiPricing({
        sellersEnabled: enabled,
        imagePrice: Number(imagePrice) || 0,
        freeImagesPerMonth: Math.floor(Number(freePerMonth) || 0),
        dailyImageCap: Math.floor(Number(dailyCap) || 0),
      })
      if (r.error) throw new Error(r.error)
      setP(r)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.")
    } finally {
      setBusy(false)
    }
  }

  const price = Number(imagePrice) || 0
  // Against the DEFAULT model, which is what a seller actually gets. Quoting the cheapest
  // model's margin would flatter the number and misprice the feature.
  const margin = price > 0 ? price / COST_HIGH : 0

  return (
    <SectionCard title="AI image generation" bodyClassName="p-5">
      <div className="space-y-6">
        {!p ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleNotch size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Let sellers generate images</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Off by default. While this is off, generation stays a factory tool and no seller can spend anything.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Let sellers generate images" />
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Price per image</span>
                <Input
                  type="number" min={0} step="0.05" value={imagePrice}
                  onChange={(e) => setImagePrice(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">
                  Charged to the seller&apos;s wallet on generate, refunded if it fails.
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Free images per month</span>
                <Input
                  type="number" min={0} step="1" value={freePerMonth}
                  onChange={(e) => setFreePerMonth(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">
                  0 means every image is paid. An allowance costs us {COST_HIGH.toFixed(2)} each.
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Daily limit per seller</span>
                <Input
                  type="number" min={0} step="1" value={dailyCap}
                  onChange={(e) => setDailyCap(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">
                  Bounds the worst case. Resets at midnight.
                </span>
              </label>
            </div>

            {/* The margin is stated rather than implied — the whole point of the panel is
                setting a price against a real cost, and that arithmetic should not be
                something an admin does in their head. */}
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              An image costs us <strong>${COST_LOW.toFixed(2)}–${COST_HIGH.toFixed(2)}</strong> at Google depending on the
              model and size.{" "}
              {price > 0
                ? <>At ${price.toFixed(2)} you keep about <strong>{margin.toFixed(1)}×</strong> the cost of a default-quality render.</>
                : <>At $0.00 every image is a gift — each one costs us up to ${COST_HIGH.toFixed(2)}.</>}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={busy}>
                {busy ? <CircleNotch size={14} className="animate-spin" /> : null} Save
              </Button>
              {saved && (
                <span className="inline-flex items-center gap-1 text-sm text-success">
                  <Check size={14} weight="bold" /> Saved
                </span>
              )}
              {err && (
                <span className="inline-flex items-center gap-1 text-sm text-destructive">
                  <Warning size={14} weight="bold" /> {err}
                </span>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <Warning size={14} className="mt-0.5 shrink-0" />
              <span>
                Video generation stays admin-only and is not sold to sellers. A clip costs $0.20–$4.80 — up to fifteen
                images — and is rarely what turns into a listing.
              </span>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}

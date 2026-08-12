"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, Calculator, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getShippingRates, getFactorySettings, type ShippingRate } from "@/lib/api"
import { STOCK_SIZES, DEFAULT_SIZE, customSizes, sizeKey, type ParcelSize } from "@/lib/parcel-sizes"

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

/**
 * DIMENSIONAL WEIGHT — the rule that makes a big light parcel cost like a heavy one.
 *
 *   dim weight (lb) = L × W × H ÷ divisor
 *   billable weight = max(actual, dim), rounded up to the next whole pound
 *
 * The divisors are the carriers' published US domestic figures. They matter because a
 * carrier sells space on a truck: a 9×8×6 box holding half a pound of poly mailer bills as
 * four pounds of air, and nothing on a rate quote says so — UPS answers a quote with
 * "RatedShipmentAlert: your invoice may vary from the displayed reference rates" and
 * applies the rule when it invoices.
 *
 * USPS is the exception worth knowing: Ground Advantage only applies dim weight ABOVE one
 * cubic foot, so most mailers are billed on the scale alone.
 */
const UPS_DAILY_DIVISOR = 139
const USPS_DIVISOR = 166
const USPS_DIM_THRESHOLD_CU_IN = 1728   // 1 cubic foot — below this USPS ignores size

/**
 * The rate calculator — what a parcel costs, why, and where the cheapest line is.
 *
 * It answers the question a bare quote cannot: WHY this price — the dim-weight arithmetic,
 * worked, so an oversized box declaration is visible before the invoice finds it.
 *
 * Nothing here buys anything. Every figure is a live quote from the same route the label
 * buyer uses, so what it shows is what a label would actually cost.
 */
export function RateCalculatorView() {
  const [fromZip, setFromZip] = useState("")
  const [toZip, setToZip] = useState("")
  const [lb, setLb] = useState("0")
  const [oz, setOz] = useState("8")
  // Opens on the mailer reached for most, not an invented placeholder — same list the
  // label dialog uses (lib/parcel-sizes.ts), so a size added there shows up here too.
  const [len, setLen] = useState(String(DEFAULT_SIZE.length))
  const [wid, setWid] = useState(String(DEFAULT_SIZE.width))
  const [hei, setHei] = useState(String(DEFAULT_SIZE.height))
  const [mine, setMine] = useState<ParcelSize[]>([])
  useEffect(() => {
    // localStorage, so after mount — reading it during render would differ from the server
    // pass and hydrate wrong.
    const t = setTimeout(() => setMine(customSizes()), 0)
    return () => clearTimeout(t)
  }, [])
  /** Optional: what another platform charged, so the saving is a number rather than a vibe. */
  const [paid, setPaid] = useState("")

  const [rates, setRates] = useState<ShippingRate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  // Default the origin to the warehouse — the answer is nearly always "from here".
  useEffect(() => {
    const t = setTimeout(() => {
      getFactorySettings()
        .then((s) => {
          const z = String((s?.ship_from as { zip?: string } | undefined)?.zip ?? "")
          if (/^\d{5}$/.test(z)) setFromZip((cur) => cur || z)
        })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const weightOz = (Number(lb) || 0) * 16 + (Number(oz) || 0)
  const dims = { l: Number(len) || 0, w: Number(wid) || 0, h: Number(hei) || 0 }
  const cuIn = dims.l * dims.w * dims.h
  const actualLb = weightOz / 16

  /** The arithmetic, kept as data so the panel can show each step rather than a verdict. */
  const billing = useMemo(() => {
    const upsDim = cuIn / UPS_DAILY_DIVISOR
    const uspsDimApplies = cuIn > USPS_DIM_THRESHOLD_CU_IN
    const uspsDim = uspsDimApplies ? cuIn / USPS_DIVISOR : 0
    const upsBillable = Math.max(actualLb, upsDim)
    const uspsBillable = Math.max(actualLb, uspsDim)
    return {
      upsDim, uspsDim, uspsDimApplies,
      upsBillable: Math.ceil(upsBillable * 100) / 100,
      uspsBillable: Math.ceil(uspsBillable * 100) / 100,
      // "Is the BOX driving this price, or the scale?" — the one sentence people want.
      upsSizeDriven: upsDim > actualLb,
      uspsSizeDriven: uspsDimApplies && uspsDim > actualLb,
    }
  }, [cuIn, actualLb])

  const addrs = useCallback((toZ: string) => ({
    from: { street: "1 Main St", city: "", state: "", zip: fromZip },
    to: { street: "1 Main St", city: "", state: "", zip: toZ },
  }), [fromZip])

  const quote = useCallback(async (toZ: string, oz2: number): Promise<{ rates: ShippingRate[]; err?: string }> => {
    const a = addrs(toZ)
    try {
      const r = await getShippingRates({ ...a, parcel: { weightOz: oz2, length: dims.l, width: dims.w, height: dims.h } })
      if (r.error) return { rates: [], err: r.error }
      return { rates: (r.rates || []).slice().sort((x, y) => x.amount - y.amount) }
    } catch (e) {
      return { rates: [], err: e instanceof Error ? e.message : "Couldn't fetch rates." }
    }
  }, [addrs, dims.l, dims.w, dims.h])

  const zipsOk = /^\d{5}$/.test(fromZip) && /^\d{5}$/.test(toZip)

  const run = async () => {
    if (!zipsOk) { setErr("Enter a 5-digit From and To ZIP."); return }
    setErr(""); setBusy(true); setRates(null)
    const r = await quote(toZip, weightOz)
    setRates(r.rates)
    if (r.err) setErr(r.err)
    else if (!r.rates.length) setErr("No rates came back for that parcel.")
    setBusy(false)
  }

  const paidN = Number(paid) || 0
  const cheapest = rates && rates.length ? rates[0] : null

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      {/* ── THE PARCEL ─────────────────────────────────────────────────────── */}
      <div className="space-y-4 xl:sticky xl:top-20">
        <SectionCard title="Parcel" bodyClassName="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">From ZIP</span>
              <Input value={fromZip} onChange={(e) => setFromZip(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="90638" className="h-9 font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">To ZIP</span>
              <Input value={toZip} onChange={(e) => setToZip(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="10118" className="h-9 font-mono" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Weight lb</span>
              <Input value={lb} onChange={(e) => setLb(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-9 font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">oz</span>
              <Input value={oz} onChange={(e) => setOz(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-9 font-mono" />
            </label>
          </div>
          {/* ONE CLICK PER MAILER. The bench reaches for a stock size, not three numbers —
              and typing them is where a 10 × 13 poly mailer becomes a 9 × 8 × 6 box that
              bills as four pounds. Custom sizes come from the same per-user list the label
              dialog writes, so one added there appears here. */}
          <div className="flex flex-wrap gap-1.5">
            {[...STOCK_SIZES, ...mine].map((sz) => {
              const on = sizeKey({ length: Number(len) || 0, width: Number(wid) || 0, height: Number(hei) || 0 }) === sizeKey(sz)
              return (
                <button
                  key={sz.label + sizeKey(sz)}
                  type="button"
                  onClick={() => { setLen(String(sz.length)); setWid(String(sz.width)); setHei(String(sz.height)) }}
                  className={"rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors " +
                    (on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}
                >
                  {sz.label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([["L", len, setLen], ["W", wid, setWid], ["H", hei, setHei]] as const).map(([k, v, set]) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{k} in</span>
                <Input value={v} onChange={(e) => set(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-9 font-mono" />
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">What you were charged (optional)</span>
            <Input value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="7.69" className="h-9 font-mono" />
            <span className="text-2xs text-muted-foreground">Compares another platform&apos;s price against the cheapest here.</span>
          </label>
          <Button onClick={run} disabled={busy} className="w-full">
            {busy ? <CircleNotch size={15} className="animate-spin" /> : <Calculator size={15} weight="bold" />} Get rates
          </Button>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </SectionCard>

        {/* ── HOW IT'S BILLED ──────────────────────────────────────────────
            The arithmetic and nothing else. The prose that used to sit around it
            explained the rule three times over; the numbers say it once. */}
        <SectionCard title="How it's billed" bodyClassName="space-y-2 p-4 text-xs">
          <div className="rounded-lg bg-muted/40 p-2 text-center font-mono text-2xs">
            {dims.l} × {dims.w} × {dims.h} = <strong>{cuIn.toLocaleString()}</strong> cu in
          </div>
          <dl className="space-y-1">
            <div className="flex justify-between"><dt className="text-muted-foreground">On the scale</dt><dd className="tabular-nums">{actualLb.toFixed(2)} lb</dd></div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">UPS dim ({cuIn.toLocaleString()} ÷ {UPS_DAILY_DIVISOR})</dt>
              <dd className={"tabular-nums " + (billing.upsSizeDriven ? "font-semibold text-amber-700" : "")}>{billing.upsDim.toFixed(2)} lb</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">USPS dim</dt>
              <dd className="tabular-nums">{billing.uspsDimApplies ? `${billing.uspsDim.toFixed(2)} lb` : "n/a"}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <dt>Billed as</dt>
              <dd className="tabular-nums">UPS {Math.ceil(billing.upsBillable)} lb · USPS {Math.ceil(billing.uspsBillable)} lb</dd>
            </div>
          </dl>
          {billing.upsSizeDriven && (
            <p className="flex items-start gap-1.5 text-amber-700">
              <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
              <span>The box sets the UPS price, not the scale.</span>
            </p>
          )}
        </SectionCard>
      </div>

      {/* ── RESULTS ────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionCard
          title="Rates"
          description={rates ? `${rates.length} live quotes — nothing is bought` : "Every service both carriers will run for this parcel"}
          bodyClassName="p-0"
        >
          {!rates ? (
            <p className="p-4 text-sm text-muted-foreground">Fill in the parcel and press <strong>Get rates</strong>.</p>
          ) : rates.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No rates came back for that parcel.</p>
          ) : (
            <div className="divide-y divide-border">
              {rates.map((r, i) => {
                const delta = paidN > 0 ? paidN - r.amount : null
                return (
                  <div key={r.token || i} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                    <span className={"w-16 shrink-0 font-mono tabular-nums " + (i === 0 ? "font-semibold text-success" : "")}>{usd(r.amount)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{r.carrier}</span>
                      <span className="text-muted-foreground"> · {r.service}</span>
                    </span>
                    {r.days != null && <span className="shrink-0 text-xs text-muted-foreground">{r.days}d</span>}
                    {i === 0 && <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-2xs font-medium text-success">cheapest</span>}
                    {delta != null && delta > 0 && i === 0 && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-medium text-amber-800">
                        {usd(delta)} under what you paid
                      </span>
                    )}
                  </div>
                )
              })}
              {paidN > 0 && cheapest && (
                <div className="bg-muted/30 px-4 py-2.5 text-sm">
                  You were charged <strong>{usd(paidN)}</strong>; the cheapest here is <strong>{usd(cheapest.amount)}</strong> ({cheapest.carrier} {cheapest.service}) —{" "}
                  {paidN > cheapest.amount
                    ? <span className="font-medium text-amber-700">{usd(paidN - cheapest.amount)} per parcel more than it needs to be.</span>
                    : <span className="font-medium text-success">already at or under the market here.</span>}
                </div>
              )}
            </div>
          )}
        </SectionCard>

      </div>
    </div>
  )
}

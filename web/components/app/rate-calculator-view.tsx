"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, Calculator, Warning, ArrowRight } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getShippingRates, getFactorySettings, type ShippingRate } from "@/lib/api"

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

/** Representative ZIPs spanning the domestic zones from a west-coast origin. Zones are
 *  computed from the ORIGIN, so these are labelled by city rather than by zone number —
 *  a "zone 5" label would be wrong the moment the warehouse moves. */
const ZONE_SPREAD: { label: string; zip: string }[] = [
  { label: "Los Angeles CA", zip: "90015" },
  { label: "San Diego CA", zip: "92101" },
  { label: "Las Vegas NV", zip: "89101" },
  { label: "Phoenix AZ", zip: "85003" },
  { label: "Denver CO", zip: "80202" },
  { label: "Dallas TX", zip: "75201" },
  { label: "Chicago IL", zip: "60606" },
  { label: "Atlanta GA", zip: "30303" },
  { label: "New York NY", zip: "10118" },
]

/** The rungs a parcel's price actually steps on. USPS Ground Advantage bands weight
 *  (0–4 oz, 4–8, 8–12, 12–16, then per pound), so the interesting question is never "what
 *  does 7 oz cost" but "where is the next cliff". */
const WEIGHT_LADDER: { label: string; oz: number }[] = [
  { label: "4 oz", oz: 4 },
  { label: "8 oz", oz: 8 },
  { label: "12 oz", oz: 12 },
  { label: "15.9 oz", oz: 15.9 },
  { label: "1 lb", oz: 16 },
  { label: "2 lb", oz: 32 },
  { label: "3 lb", oz: 48 },
  { label: "5 lb", oz: 80 },
]

type Row = { label: string; rates: ShippingRate[]; err?: string }

/**
 * The rate calculator — what a parcel costs, why, and where the cheapest line is.
 *
 * Three questions it answers that a single quote cannot:
 *   1. WHY this price — the dim-weight arithmetic, worked, so an oversized box declaration
 *      is visible before the invoice finds it.
 *   2. What it costs ACROSS the country — the same parcel to nine cities, because the
 *      cheapest carrier flips with distance (USPS wins near, UPS Ground Saver wins far).
 *   3. Where the WEIGHT cliffs are — the same route at eight weights, because crossing
 *      8 oz costs more than any box-size mistake.
 *
 * Nothing here buys anything. Every figure is a live quote from the same route the label
 * buyer uses, so what it shows is what a label would actually cost.
 */
export function RateCalculatorView() {
  const [fromZip, setFromZip] = useState("")
  const [toZip, setToZip] = useState("")
  const [lb, setLb] = useState("0")
  const [oz, setOz] = useState("8")
  const [len, setLen] = useState("10")
  const [wid, setWid] = useState("8")
  const [hei, setHei] = useState("4")
  /** Optional: what another platform charged, so the saving is a number rather than a vibe. */
  const [paid, setPaid] = useState("")

  const [rates, setRates] = useState<ShippingRate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const [zoneRows, setZoneRows] = useState<Row[] | null>(null)
  const [ladderRows, setLadderRows] = useState<Row[] | null>(null)
  const [running, setRunning] = useState("")

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
    setErr(""); setBusy(true); setRates(null); setZoneRows(null); setLadderRows(null)
    const r = await quote(toZip, weightOz)
    setRates(r.rates)
    if (r.err) setErr(r.err)
    else if (!r.rates.length) setErr("No rates came back for that parcel.")
    setBusy(false)
  }

  /**
   * The two sweeps run SEQUENTIALLY, one quote at a time.
   *
   * Each one creates a shipment at the carrier aggregator; nine at once is a burst that
   * rate-limits, and the answer arriving in order is what lets the table fill in as it
   * goes rather than after a long blank wait.
   */
  const runZones = async () => {
    if (!/^\d{5}$/.test(fromZip)) { setErr("Enter a From ZIP."); return }
    setErr(""); setZoneRows([])
    for (const d of ZONE_SPREAD) {
      setRunning(d.label)
      const r = await quote(d.zip, weightOz)
      setZoneRows((prev) => [...(prev ?? []), { label: d.label, rates: r.rates, err: r.err }])
    }
    setRunning("")
  }

  const runLadder = async () => {
    if (!zipsOk) { setErr("Enter a 5-digit From and To ZIP."); return }
    setErr(""); setLadderRows([])
    for (const w of WEIGHT_LADDER) {
      setRunning(w.label)
      const r = await quote(toZip, w.oz)
      setLadderRows((prev) => [...(prev ?? []), { label: w.label, rates: r.rates, err: r.err }])
    }
    setRunning("")
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

        {/* ── HOW IT'S BILLED — the formula, worked ────────────────────────── */}
        <SectionCard title="How it's billed" bodyClassName="space-y-2 p-4 text-xs">
          <p className="text-muted-foreground">
            Carriers charge the <strong className="text-foreground">greater</strong> of what the parcel weighs
            and what its size implies. Size wins whenever the box is big and light.
          </p>
          <div className="rounded-lg bg-muted/40 p-2 font-mono text-2xs">
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
              <dd className="tabular-nums">
                {billing.uspsDimApplies ? `${billing.uspsDim.toFixed(2)} lb` : "n/a"}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <dt>Billed as</dt>
              <dd className="tabular-nums">UPS {Math.ceil(billing.upsBillable)} lb · USPS {Math.ceil(billing.uspsBillable)} lb</dd>
            </div>
          </dl>
          {billing.upsSizeDriven ? (
            <p className="flex items-start gap-1.5 text-amber-700">
              <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                The BOX is setting the UPS price, not the scale — {billing.upsDim.toFixed(1)} lb of dimensional
                weight against {actualLb.toFixed(2)} lb of actual. A quote may not show this; the invoice will.
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">The scale is setting the price — these dimensions cost nothing extra.</p>
          )}
          {!billing.uspsDimApplies && (
            <p className="text-muted-foreground">
              USPS ignores size below {USPS_DIM_THRESHOLD_CU_IN.toLocaleString()} cu in (one cubic foot), so this parcel
              is billed on weight alone there.
            </p>
          )}
          <p className="text-2xs text-muted-foreground">
            Divisors are the carriers&apos; published US domestic figures ({UPS_DAILY_DIVISOR} UPS daily,
            {" "}{USPS_DIVISOR} USPS). A negotiated contract can differ — check yours before relying on the
            exact pound.
          </p>
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

        {/* ── ACROSS THE COUNTRY ──────────────────────────────────────────── */}
        <SectionCard
          title="Across the country"
          description="The same parcel to nine cities — the cheapest carrier flips with distance"
          actions={<Button size="sm" variant="outline" onClick={runZones} disabled={!!running}>{running ? <><CircleNotch size={13} className="animate-spin" /> {running}</> : <>Run <ArrowRight size={12} weight="bold" /></>}</Button>}
          bodyClassName="p-0"
        >
          {!zoneRows ? (
            <p className="p-4 text-sm text-muted-foreground">Prices this parcel to a spread of destinations, so you can see where USPS stops winning.</p>
          ) : (
            <SweepTable rows={zoneRows} firstCol="Destination" />
          )}
        </SectionCard>

        {/* ── WEIGHT CLIFFS ───────────────────────────────────────────────── */}
        <SectionCard
          title="Weight cliffs"
          description="The same route at eight weights — where the price actually steps"
          actions={<Button size="sm" variant="outline" onClick={runLadder} disabled={!!running}>{running ? <><CircleNotch size={13} className="animate-spin" /> {running}</> : <>Run <ArrowRight size={12} weight="bold" /></>}</Button>}
          bodyClassName="p-0"
        >
          {!ladderRows ? (
            <p className="p-4 text-sm text-muted-foreground">
              USPS bands weight (0–4 oz, 4–8, 8–12, 12–16, then per pound), so shaving an ounce can matter more
              than any box change. This shows where the steps are on your route.
            </p>
          ) : (
            <SweepTable rows={ladderRows} firstCol="Weight" />
          )}
        </SectionCard>
      </div>
    </div>
  )
}

/**
 * One sweep, as a table: the cheapest rate per carrier for each row.
 *
 * Module-level, not defined in the parent's render — a component declared inside render is
 * a new type every frame and remounts its subtree (the repo's static-components rule).
 */
function SweepTable({ rows, firstCol }: { rows: Row[]; firstCol: string }) {
  // The columns are whatever actually came back, so a carrier that stops quoting simply
  // stops having a column rather than showing a row of dashes.
  const services = useMemo(() => {
    const seen = new Map<string, number>()
    for (const r of rows) for (const rt of r.rates) {
      const k = `${rt.carrier} ${rt.service}`
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    // Only services quoted for MOST rows — a one-off doesn't earn a column.
    return [...seen.entries()].filter(([, n]) => n >= Math.max(1, Math.floor(rows.length / 2))).map(([k]) => k).slice(0, 5)
  }, [rows])

  if (!rows.length) return <p className="p-4 text-sm text-muted-foreground">Running…</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">{firstCol}</th>
            {services.map((s) => <th key={s} className="px-3 py-2 text-right font-medium">{s}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const best = r.rates.length ? Math.min(...r.rates.map((x) => x.amount)) : null
            return (
              <tr key={r.label}>
                <td className="px-4 py-2 font-medium">{r.label}</td>
                {services.map((s) => {
                  const hit = r.rates.find((x) => `${x.carrier} ${x.service}` === s)
                  const isBest = hit && best != null && hit.amount === best
                  return (
                    <td key={s} className={"px-3 py-2 text-right " + (isBest ? "font-semibold text-success" : "")}>
                      {hit ? usd(hit.amount) : <span className="text-muted-foreground">—</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useMemo, useState } from "react"
import { CircleNotch, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getShippingRates, getFactorySettings, type ShippingRate } from "@/lib/api"
import { STOCK_SIZES, DEFAULT_SIZE, customSizes, sizeKey, type ParcelSize } from "@/lib/parcel-sizes"

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

/**
 * DIMENSIONAL WEIGHT — the rule that makes a big light parcel cost like a heavy one.
 *
 * dim weight (lb) = L × W × H ÷ divisor
 * billable weight = max(actual, dim), rounded up to the next whole pound
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
 * WHERE IT'S GOING, as one click.
 *
 * A quote needs the ZIP and nothing else — rates are zone-based, so a street address adds
 * typing and changes no number. Listed west to east from a California origin, which is
 * also cheapest to dearest: the spread between the first and last of these IS the zone
 * effect, without a table of zone numbers that goes wrong the day the warehouse moves.
 */
const DEST_PRESETS: { label: string; zip: string }[] = [
  { label: "Los Angeles", zip: "90015" },
  { label: "San Diego", zip: "92101" },
  { label: "Las Vegas", zip: "89101" },
  { label: "Phoenix", zip: "85003" },
  { label: "Seattle", zip: "98101" },
  { label: "Denver", zip: "80202" },
  { label: "Dallas", zip: "75201" },
  { label: "Chicago", zip: "60606" },
  { label: "Atlanta", zip: "30303" },
  { label: "Miami", zip: "33130" },
  { label: "New York", zip: "10118" },
]

/**
 * The weights actually shipped, in ounces.
 *
 * Chosen around the USPS bands (0–4, 4–8, 8–12, 12–16, then per pound) rather than round
 * numbers, because the band edge is where the price steps: 8 oz and 9 oz are different
 * money, 5 oz and 7 oz are the same.
 */
const WEIGHT_PRESETS: { label: string; oz: number }[] = [
  { label: "4 oz", oz: 4 },
  { label: "6 oz", oz: 6 },
  { label: "8 oz", oz: 8 },
  { label: "12 oz", oz: 12 },
  { label: "1 lb", oz: 16 },
  { label: "1.5 lb", oz: 24 },
  { label: "2 lb", oz: 32 },
  { label: "3 lb", oz: 48 },
]

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
  const tl = useLabelT()
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

  /** "Custom size…" is a MODE, not a size — picking it reveals the boxes and keeps them
   * revealed even if the numbers happen to land back on a stock size. */
 const [custom, setCustom] = useState(false)
 const weightOz = (Number(lb) || 0) * 16 + (Number(oz) || 0)
 const dims = { l: Number(len) || 0, w: Number(wid) || 0, h: Number(hei) || 0 }
 const allSizes = [...STOCK_SIZES, ...mine]
 const matchedSize = allSizes.find((z) => sizeKey(z) === sizeKey({ length: dims.l, width: dims.w, height: dims.h }))
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

  // Plain functions: both are only ever called from a click, so there is nothing to
  // memoize for — and hand-rolled memos here are ones the compiler can't preserve.
 const addrs = (toZ: string) => ({
 from: { street: "1 Main St", city: "", state: "", zip: fromZip },
 to: { street: "1 Main St", city: "", state: "", zip: toZ },
  })

 const quote = async (toZ: string, oz2: number): Promise<{ rates: ShippingRate[]; err?: string }> => {
 const a = addrs(toZ)
 try {
 const r = await getShippingRates({ ...a, parcel: { weightOz: oz2, length: dims.l, width: dims.w, height: dims.h } })
 if (r.error) return { rates: [], err: r.error }
 return { rates: (r.rates || []).slice().sort((x, y) => x.amount - y.amount) }
    } catch (e) {
 return { rates: [], err: e instanceof Error ? e.message : "Couldn't fetch rates." }
    }
  }

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


 return (
    <div className="grid items-start gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      {/* ── THE PARCEL ─────────────────────────────────────────────────────── */}
      <div className="space-y-4 xl:sticky xl:top-20">
        <SectionCard title={tl("rates", "Parcel")} bodyClassName="space-y-3 p-4">
          {/* THREE CONTROLS, not six rows of pills.
              Chips read as clutter once there are eleven cities and eight weights — the
 same choice as a select, spending five times the height. The select is also
 what the label dialog already uses for package size, so the two screens now
 ask the question the same way. */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{tl("rates", "From ZIP")}</span>
              <Input value={fromZip} onChange={(e) => setFromZip(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="90638" className="h-9 tabular-nums" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{tl("rates", "To ZIP")}</span>
              <Input value={toZip} onChange={(e) => setToZip(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="10118" className="h-9 tabular-nums" />
            </label>
          </div>

          {/* The city list fills the ZIP beside it — a quote is zone-based, so the ZIP is
 the only part of a destination that changes the price. */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{tl("rates", "Or pick a city")}</span>
            <select
 value={DEST_PRESETS.find((d) => d.zip === toZip) ? toZip : "custom"}
 onChange={(e) => { if (e.target.value !== "custom") setToZip(e.target.value) }}
 className="eg-select h-9 rounded-lg border border-border bg-card px-2.5 text-sm"
            >
              {/* Reads "Select" until there IS something, then says what was typed — a
 dropdown showing a city name while the ZIP beside it is somewhere else
 is the one thing this control must never do. */}
              <option value="custom">{/^\d{5}$/.test(toZip) ? `Typed · ${toZip}` : tl("rates", "Select")}</option>
              {DEST_PRESETS.map((d) => <option key={d.zip} value={d.zip}>{tl("rates", d.label)}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">lb</span>
              <Input value={lb} onChange={(e) => setLb(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-9 tabular-nums" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">oz</span>
              <Input value={oz} onChange={(e) => setOz(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-9 tabular-nums" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{tl("rates", "Common")}</span>
              <select
 value={WEIGHT_PRESETS.find((w) => w.oz === weightOz)?.oz ?? ""}
 onChange={(e) => {
 const n = Number(e.target.value)
 if (!n) return
 setLb(String(Math.floor(n / 16))); setOz(String(n % 16))
                }}
 className="eg-select h-9 rounded-lg border border-border bg-card px-2.5 text-sm"
              >
                <option value="">{tl("rates", "Typed")}</option>
                {WEIGHT_PRESETS.map((w) => <option key={w.oz} value={w.oz}>{tl("rates", w.label)}</option>)}
              </select>
            </label>
          </div>

          {/* Size, and the three boxes only when they're yours to fill — same control and
 same "Custom size…" escape hatch as the label dialog. */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{tl("rates", "Package")}</span>
            <select
              /* `custom` wins over a coincidental match. Picking "Custom size…" while the
 boxes still held 13/10/1 snapped the label straight back to "10 × 13 poly
 mailer" — dropdown and open boxes disagreeing about which mode you're in. */
 value={custom || !matchedSize ? "custom" : sizeKey(matchedSize)}
 onChange={(e) => {
 const hit = allSizes.find((z) => sizeKey(z) === e.target.value)
 if (!hit) { setCustom(true); return }
 setCustom(false)
 setLen(String(hit.length)); setWid(String(hit.width)); setHei(String(hit.height))
              }}
 className="eg-select h-9 rounded-lg border border-border bg-card px-2.5 text-sm"
            >
              {allSizes.map((z) => <option key={sizeKey(z)} value={sizeKey(z)}>{tl("rates", z.label)}</option>)}
              <option value="custom">{tl("rates", "Custom size…")}</option>
            </select>
          </label>

          {(custom || !matchedSize) && (
            <div className="grid grid-cols-3 gap-2">
              {([["L", len, setLen], ["W", wid, setWid], ["H", hei, setHei]] as const).map(([k, v, set]) => (
                <label key={k} className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{k} in</span>
                  <Input value={v} onChange={(e) => set(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-9 tabular-nums" />
                </label>
              ))}
            </div>
          )}

          <Button onClick={run} disabled={busy} className="w-full">
            {busy ? <CircleNotch size={15} className="animate-spin" /> : null} Get rates
          </Button>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </SectionCard>

        {/* ── HOW IT'S BILLED ──────────────────────────────────────────────
            The arithmetic and nothing else. The prose that used to sit around it
 explained the rule three times over; the numbers say it once. */}
        <SectionCard title={tl("rates", "How it's billed")} bodyClassName="space-y-2 p-4 text-xs">
          <div className="rounded-lg bg-muted/40 p-2 text-center tabular-nums text-2xs">
            {dims.l} × {dims.w} × {dims.h} = <strong>{cuIn.toLocaleString()}</strong> cu in
          </div>
          <dl className="space-y-1">
            <div className="flex justify-between"><dt className="text-muted-foreground">{tl("rates", "On the scale")}</dt><dd className="tabular-nums">{actualLb.toFixed(2)} lb</dd></div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">UPS dim ({cuIn.toLocaleString()} ÷ {UPS_DAILY_DIVISOR})</dt>
              <dd className={"tabular-nums " + (billing.upsSizeDriven ? "font-semibold text-hold" : "")}>{billing.upsDim.toFixed(2)} lb</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{tl("rates", "USPS dim")}</dt>
              <dd className="tabular-nums">{billing.uspsDimApplies ? `${billing.uspsDim.toFixed(2)} lb` : "n/a"}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <dt>{tl("rates", "Billed as")}</dt>
              <dd className="tabular-nums">UPS {Math.ceil(billing.upsBillable)} lb · USPS {Math.ceil(billing.uspsBillable)} lb</dd>
            </div>
          </dl>
          {billing.upsSizeDriven && (
            <p className="flex items-start gap-1.5 text-hold">
              <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
              <span>{tl("rates", "The box sets the UPS price, not the scale.")}</span>
            </p>
          )}
        </SectionCard>
      </div>

      {/* ── RESULTS ────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionCard
 title={tl("rates", "Rates")}
 description={rates ? `${rates.length} live quotes — nothing is bought` : tl("rates", "Every service both carriers will run for this parcel")}
 bodyClassName="p-0"
        >
          {!rates ? (
            <p className="p-4 text-sm text-muted-foreground">{tl("rates", "Fill in the parcel and press")} <strong>{tl("rates", "Get rates")}</strong>.</p>
          ) : rates.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{tl("rates", "No rates came back for that parcel.")}</p>
          ) : (
            <div className="divide-y divide-border">
              {rates.map((r, i) => (
                  <div key={r.token || i} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                    <span className={"w-16 shrink-0 tabular-nums tabular-nums " + (i === 0 ? "font-semibold text-success" : "")}>{usd(r.amount)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{r.carrier}</span>
                      <span className="text-muted-foreground"> · {r.service}</span>
                    </span>
                    {r.days != null && <span className="shrink-0 text-xs text-muted-foreground">{r.days}d</span>}
                    {i === 0 && <span className="shrink-0 rounded-lg bg-success/10 px-2 py-0.5 text-xs font-medium text-success">cheapest</span>}
                  </div>
              ))}
            </div>
          )}
        </SectionCard>

      </div>
    </div>
  )
}

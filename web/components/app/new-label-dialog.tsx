"use client"

import { useEffect, useState } from "react"
import { CircleNotch, ArrowSquareOut, CheckCircle, Warning, Truck, Package } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { Input } from "@/components/ui/input"
import { parseBlock } from "@/lib/address-paste"
import { STOCK_SIZES, DEFAULT_SIZE, customSizes, addCustomSize, sizeKey, sizeLabel, type ParcelSize } from "@/lib/parcel-sizes"
import { parcelFromOrder, parcelBasisNote } from "@/lib/parcel-from-order"
import { validateAddress, buyUspsLabel, getShippingRates, getFactorySettings, setFactorySettings, getCatalogProducts, type ShipAddress, type UspsLabelResult, type ShippingRate, type OrderItem } from "@/lib/api"

const BLANK: ShipAddress = { name: "", street: "", street2: "", city: "", state: "", zip: "" }
const DEFAULT_CARRIERS = ["usps", "ups"]
const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`
const addrComplete = (a: ShipAddress) => !!(a.street && a.city && a.state && a.zip)
const FROM_STORE = "eg_ship_from"

/**
 * Buy a REAL shipping label through the aggregator (Shippo → USPS), shared by two callers:
 *
 *  - Shipments page — no `order`: creates a minimal staff-owned manual FF-order (re-ship,
 *    sample, replacement…) so the label is RECORDED in Shipments.
 *  - Order detail — with `order`: buys against that existing order, ship-to pre-filled from
 *    its address; nothing new is created.
 *
 * Ship-to is a single paste box (validated live); ship-from is the saved warehouse address
 * (Settings › Platform). Optional add-ons (signature, insurance) ride the same buy.
 */
export function NewLabelDialog({ open, onOpenChange, onCreated, order }: {
  open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void
  /** `items` lets the parcel be worked out from what's actually being shipped rather than
   *  guessed — see parcel-from-order.ts. Optional: a standalone label has no order and
   *  falls back to the stock mailer. */
  order?: { id: string; num?: string; to?: ShipAddress; items?: OrderItem[] }
}) {
  const [pasteText, setPasteText] = useState("")
  const [to, setTo] = useState<ShipAddress>({ ...BLANK })
  const confirm = useConfirm()
  const [from, setFrom] = useState<ShipAddress>({ ...BLANK })
  // Opens on the mailer this factory reaches for most, not on a placeholder nobody stocks.
  const [pkg, setPkg] = useState({ lb: 0, oz: 6, length: DEFAULT_SIZE.length, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height })
  // Stock sizes plus anything this person saved. Read after mount, because localStorage
  // doesn't exist during the server render and a mismatch there is a hydration error.
  /** "Custom size…" is a MODE, not a size: it keeps the boxes open even if the numbers
   *  land back on a stock size, so choosing it doesn't snap the label to a mailer. */
  const [customSize, setCustomSize] = useState(false)
  const [sizes, setSizes] = useState<ParcelSize[]>(STOCK_SIZES)
  useEffect(() => {
    const t = setTimeout(() => setSizes([...STOCK_SIZES, ...customSizes()]), 0)
    return () => clearTimeout(t)
  }, [])

  const [basis, setBasis] = useState<string | null>(null)
  const weightOz = (Number(pkg.lb) || 0) * 16 + (Number(pkg.oz) || 0)
  // Add-ons the carrier prices into the rate: signature on delivery, declared insurance.
  const [svc, setSvc] = useState<{ signature: boolean; insurance: number }>({ signature: false, insurance: 0 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<UspsLabelResult | null>(null)
  // Multi-carrier rate shop: fetch quotes across the enabled carriers, pick one, buy it.
  const [rates, setRates] = useState<ShippingRate[] | null>(null)   // null = not fetched
  const [ratesLoading, setRatesLoading] = useState(false)
  const [pickedToken, setPickedToken] = useState<string | null>(null)
  const [carriers, setCarriers] = useState<string[]>(DEFAULT_CARRIERS)

  // Load the saved warehouse 'from' when the dialog opens (deferred so no sync setState).
  // With an `order`, also seed ship-to from its address so the label is one click away.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      try { const raw = localStorage.getItem(FROM_STORE); if (raw) setFrom({ ...BLANK, ...JSON.parse(raw) }) } catch {}
      getFactorySettings().then((s) => {
        const sf = s?.ship_from as ShipAddress | undefined
        if (sf && sf.street) { const a = { ...BLANK, ...sf }; setFrom(a); try { localStorage.setItem(FROM_STORE, JSON.stringify(a)) } catch {} }
        const ec = String(s?.enabled_carriers || "").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean)
        setCarriers(ec.length ? ec : DEFAULT_CARRIERS)
      }).catch(() => {})
      if (order?.to && order.to.street) {
        const a = { ...BLANK, ...order.to }
        setTo(a)
        setPasteText([a.name, a.street, a.street2, [a.city, a.state].filter(Boolean).join(", ") + (a.zip ? " " + a.zip : "")].filter((l) => l && l.trim()).join("\n"))
      }
    }, 0)
    return () => clearTimeout(t)
  }, [open, order?.id])

  // Live recipient validation — visible ✓/⚠ before spending. Debounced, warn-not-block.
  const [addrCheck, setAddrCheck] = useState<{ status: "idle" | "checking" | "valid" | "invalid"; msg?: string }>({ status: "idle" })
  useEffect(() => {
    const complete = addrComplete(to)
    let alive = true
    const t = setTimeout(() => {
      if (!alive) return
      if (!complete) { setAddrCheck({ status: "idle" }); return }
      setAddrCheck({ status: "checking" })
      validateAddress({ streetAddress: to.street || "", secondaryAddress: to.street2, city: to.city || "", state: to.state || "", ZIPCode: to.zip || "" })
        .then((v) => { if (alive) setAddrCheck(v && v.ok ? { status: "valid" } : { status: "invalid", msg: v?.error }) })
        .catch(() => { if (alive) setAddrCheck({ status: "idle" }) })
    }, 600)
    return () => { alive = false; clearTimeout(t) }
  }, [to.street, to.street2, to.city, to.state, to.zip])

  const reset = () => { setPasteText(""); setTo({ ...BLANK }); setSvc({ signature: false, insurance: 0 }); setResult(null); setErr(null); setAddrCheck({ status: "idle" }); setRates(null); setPickedToken(null) }
  // Any change to the parcel or add-ons invalidates the quoted rates — you can't buy a rate
  // that was priced for a different box. Re-fetch after editing.
  const invalidateRates = () => { setRates(null); setPickedToken(null) }

  // PREFILL FROM THE PRODUCTS, when there are any. Over-declaring is the expensive
  // direction — the carrier bills the greater of actual and dimensional weight — so a
  // parcel typed larger than it is gets charged for the difference on every label. The
  // catalog already holds each blank's weight and box; this reads them rather than guessing.
  useEffect(() => {
    if (!open || !order?.items?.length) return
    let alive = true
    getCatalogProducts()
      .then((r) => {
        if (!alive) return
        const g = parcelFromOrder(order.items, r)
        if (!g) return
        setPkg((p) => ({
          lb: Math.floor(g.weightOz / 16) || 0,
          oz: g.weightOz ? Math.round(g.weightOz % 16) : p.oz,
          // Only override a dimension the catalog actually knows; a product with a weight
          // but no box keeps the stock mailer rather than collapsing to zero.
          length: g.length || p.length,
          width: g.width || p.width,
          height: g.height || p.height,
        }))
        setBasis(parcelBasisNote(g))
        invalidateRates()
      })
      .catch(() => { /* no catalog — the stock mailer stands */ })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id])

  const getRates = async () => {
    setErr(null)
    if (!addrComplete(to)) { setErr("Enter the recipient (street, city, state, ZIP) before pricing."); return }
    if (!addrComplete(from)) { setErr("No warehouse ‘From’ address saved — set it in Settings › Platform first."); return }
    setRatesLoading(true); setPickedToken(null)
    try {
      const r = await getShippingRates({ to, from, parcel: { weightOz, length: pkg.length, width: pkg.width, height: pkg.height }, extra: (svc.signature || svc.insurance) ? { signature: svc.signature, insurance: svc.insurance } : undefined })
      if (r.error) { setErr(r.error); setRates([]); return }
      // Only the carriers this warehouse offers (admin-set; defaults to USPS + UPS), cheapest first.
      const filtered = (r.rates || []).filter((rt) => carriers.some((c) => (rt.carrier || "").toLowerCase().includes(c)))
      const shown = (filtered.length ? filtered : (r.rates || [])).slice().sort((a, b) => a.amount - b.amount)
      setRates(shown)
      if (shown.length) setPickedToken(shown[0].token)
      if (!shown.length && r.errors?.length) setErr(r.errors.join(" · "))
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't fetch rates.")
    } finally { setRatesLoading(false) }
  }

  // Auto-quote once the address + parcel are ready — no "Get rates" click needed. Debounced
  // so editing the box or dimensions doesn't fire a request per keystroke; the button below
  // stays as a manual refresh.
  useEffect(() => {
    if (result || rates || ratesLoading) return
    if (!addrComplete(to) || !addrComplete(from)) return
    let alive = true
    const t = setTimeout(() => { if (alive) getRates() }, 900)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to.street, to.street2, to.city, to.state, to.zip, from.street, from.zip, pkg.lb, pkg.oz, pkg.length, pkg.width, pkg.height, svc.signature, svc.insurance, result, rates, ratesLoading])

  const buy = async () => {
    setErr(null)
    if (!addrComplete(to)) { setErr("Recipient needs a street, city, state and ZIP."); return }
    if (!addrComplete(from)) { setErr("No warehouse ‘From’ address saved — set it in Settings › Platform first."); return }
    const picked = rates?.find((r) => r.token === pickedToken)
    if (!picked) { setErr("Get rates and pick a carrier & service first."); return }
    setBusy(true)
    try {
      // Existing order → buy against it. No order → mint a manual FF-order so the label is
      // recorded in Shipments the same way marketplace labels are.
      // NO ORDER IS CREATED. A standalone label is a SHIPMENT — a re-ship, a sample,
      // someone else's parcel — and inventing an order to hold it put a Draft on the
      // production board with no lines and nothing to make. The server records it in
      // `shipments` instead and it shows up in this list, which is where it belongs.
      // ShipStation draws exactly this line: a label without an order creates a shipment
      // record and no order.
      const orderId = order?.id
      setFactorySettings({ ship_from: from }).catch(() => {})
      try {
        const v = await validateAddress({ streetAddress: to.street || "", secondaryAddress: to.street2, city: to.city || "", state: to.state || "", ZIPCode: to.zip || "" })
        if (v && !v.ok && v.error && !(await confirm({ title: "Address couldn't be verified", body: `${v.error} — buy the label anyway?`, confirmLabel: "Buy anyway" }))) return
      } catch { /* validation unavailable — proceed */ }
      const r = await buyUspsLabel({ to, from, orderId, weightOz, length: pkg.length, width: pkg.width, height: pkg.height, signature: svc.signature, insurance: svc.insurance || undefined, rateToken: picked.token, rate: { amount: picked.amount, carrier: picked.carrier, service: picked.service, carrierAccount: picked.carrierAccount } })
      if (!r.ok) {
        setErr(r.error || "Couldn't buy the label.")
        // Nothing to clean up: a failed buy created nothing. That is the whole point of
        // not minting an order up front.
        return
      }
      setResult(r)
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create the label.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      {/* Two columns: what you are sending on the left, what it costs on the right.
          One column meant the rates — the thing you came to choose — sat below the fold
          under the parcel fields, so buying a label always began with a scroll. */}
      {/* sm:max-w-3xl, NOT max-w-3xl. DialogContent's own class list ends with
          `sm:max-w-md`, and tailwind-merge keeps a bare utility and a `sm:` one side by
          side — they are different variants, so nothing is dropped. Above 640px the
          responsive rule then wins on source order and the window was capped at 448px,
          three-quarters narrower than asked for. Worse, `md:grid-cols-2` keys off the
          VIEWPORT, so on any normal screen the two columns still split — a 448px popup
          divided into two ~190px tracks, which is why every field sat alone on its own
          line and the Buy button was pushed off the bottom. Matching the modifier is what
          actually raises the cap.

          3xl (768px) was still not enough for two real columns. Split in half it left
          ~360px a side: the ship-to helper wrapped to four lines, the parcel fields each
          took their own row, and the rates column — the wider half by nature, since a rate
          row is carrier + service + transit + price — sat empty beside a tall stack. The
          result read as one long form with a blank margin. 5xl gives each side ~480px,
          which is where the helper text settles onto two lines and a rate row fits without
          truncating the service name. */}
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader><DialogTitle>{order ? `New label · ${order.num || order.id}` : "New label"}</DialogTitle></DialogHeader>

        {result ? (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              Label bought — <span className="tabular-nums">{result.trackingNumber}</span>
              {result.service ? ` · ${result.service}` : ""}{result.cost != null ? ` · $${result.cost.toFixed(2)}` : ""}
            </div>
            <div className="flex flex-wrap gap-2">
              {result.labelUrl && (
                <a href={result.labelUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
                  <ArrowSquareOut size={14} weight="bold" /> Open label
                </a>
              )}
              <Button variant="outline" onClick={reset}>Another</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-x-5 gap-y-3 py-1 md:grid-cols-2">
              <div className="space-y-3 md:col-span-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ship to</div>
              {/* Live validation status sits INSIDE the box, bottom-right; extra bottom padding
                  keeps the last address line clear of it. */}
              <div className="relative">
                <textarea
                  value={pasteText}
                  onChange={(e) => {
                    setPasteText(e.target.value)
                    const { name, addr } = parseBlock(e.target.value)
                    setTo({ name: name || "", street: addr.street || "", street2: addr.street2 || "", city: addr.city || "", state: addr.state || "", zip: addr.zip || "" })
                  }}
                  rows={4}
                  placeholder={"Sara Fetterhoff\n230 Trails End Rd\nBeach Lake, PA 18405"}
                  className="w-full rounded-lg border border-border bg-card px-3 pb-8 pt-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <div className="pointer-events-none absolute bottom-2 right-2.5">
                  {addrCheck.status === "checking" && <span className="inline-flex items-center gap-1 rounded-full bg-card/90 px-1.5 py-0.5 text-2xs text-muted-foreground"><CircleNotch size={12} className="animate-spin" /> Checking…</span>}
                  {addrCheck.status === "valid" && <span className="inline-flex items-center gap-1 rounded-full bg-card/90 px-1.5 py-0.5 text-2xs font-medium text-success"><CheckCircle size={12} weight="fill" /> Validated</span>}
                  {addrCheck.status === "invalid" && <span className="inline-flex items-center gap-1 rounded-full bg-card/90 px-1.5 py-0.5 text-2xs font-medium text-amber-700" title={addrCheck.msg || undefined}><Warning size={12} weight="fill" /> {addrCheck.msg ? "Couldn't verify" : "Not found"}</span>}
                </div>
              </div>
              <p className="text-3xs text-muted-foreground">Name, street, then City, ST ZIP — the label uses exactly this. Ship-from is your saved warehouse address (Settings › Platform).</p>

              <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parcel</div>

              {/* THE PACKAGE FIRST. It is the choice that fills three of the five numbers
                  below, so asking for it last meant typing dimensions and then overwriting
                  them. Same control and same "Custom size…" escape hatch as the rate
                  calculator, so the two screens ask the question identically. */}
              <label className="flex flex-col gap-1">
                <span className="text-2xs text-muted-foreground">Package</span>
                <select
                  value={customSize ? "custom" : (sizes.find((z) => sizeKey(z) === sizeKey(pkg)) ? sizeKey(pkg) : "custom")}
                  onChange={(e) => {
                    const hit = sizes.find((z) => sizeKey(z) === e.target.value)
                    if (!hit) { setCustomSize(true); return }
                    setCustomSize(false)
                    setPkg({ ...pkg, length: hit.length, width: hit.width, height: hit.height })
                    invalidateRates()
                  }}
                  className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm"
                >
                  {sizes.map((z) => (
                    <option key={sizeKey(z)} value={sizeKey(z)}>{z.label || sizeLabel(z)}</option>
                  ))}
                  <option value="custom">Custom size…</option>
                </select>
              </label>

              {/* Weight always — it is the one thing no package can tell us. */}
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex w-20 flex-col gap-1"><span className="text-2xs text-muted-foreground">Weight lb</span><Input type="number" min={0} value={pkg.lb} onChange={(e) => { setPkg({ ...pkg, lb: Math.max(0, Number(e.target.value) || 0) }); invalidateRates() }} className="h-9" /></label>
                <label className="flex w-20 flex-col gap-1"><span className="text-2xs text-muted-foreground">oz</span><Input type="number" min={0} value={pkg.oz} onChange={(e) => { setPkg({ ...pkg, oz: Math.max(0, Number(e.target.value) || 0) }); invalidateRates() }} className="h-9" /></label>
                {/* The mailer's own size, stated rather than sitting in three boxes nobody
                    needs to touch — five cramped inputs in a row was the "weird" part. */}
                {!customSize && sizes.some((z) => sizeKey(z) === sizeKey(pkg)) && (
                  <span className="pb-2 text-2xs text-muted-foreground">{pkg.length} × {pkg.width} × {pkg.height} in</span>
                )}
              </div>

              {(customSize || !sizes.some((z) => sizeKey(z) === sizeKey(pkg))) && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex w-16 flex-col gap-1"><span className="text-2xs text-muted-foreground">L in</span><Input type="number" min={1} value={pkg.length} onChange={(e) => { setPkg({ ...pkg, length: Number(e.target.value) }); invalidateRates() }} className="h-9" /></label>
                  <label className="flex w-16 flex-col gap-1"><span className="text-2xs text-muted-foreground">W in</span><Input type="number" min={1} value={pkg.width} onChange={(e) => { setPkg({ ...pkg, width: Number(e.target.value) }); invalidateRates() }} className="h-9" /></label>
                  <label className="flex w-16 flex-col gap-1"><span className="text-2xs text-muted-foreground">H in</span><Input type="number" min={1} value={pkg.height} onChange={(e) => { setPkg({ ...pkg, height: Number(e.target.value) }); invalidateRates() }} className="h-9" /></label>
                  {/* Only offered when the dimensions are genuinely new — a button that saves
                      a size you already have does nothing and says nothing. */}
                  {!sizes.some((z) => sizeKey(z) === sizeKey(pkg)) && pkg.length > 0 && pkg.width > 0 && (
                    <button
                      type="button"
                      onClick={() => setSizes([...STOCK_SIZES, ...addCustomSize({ label: "", length: pkg.length, width: pkg.width, height: pkg.height })])}
                      className="pb-2 text-xs font-medium text-primary hover:underline"
                    >
                      Save {sizeLabel(pkg)} as a size
                    </button>
                  )}
                </div>
              )}

              {basis && (
                <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
                  <Package size={12} weight="fill" className="mt-0.5 shrink-0" />
                  {basis}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={svc.signature} onChange={(e) => { setSvc({ ...svc, signature: e.target.checked }); invalidateRates() }} className="size-4 accent-[var(--primary)]" />
                  Signature
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">Insure $</span>
                  <Input type="number" min={0} step={1} value={svc.insurance || ""} placeholder="0" onChange={(e) => { setSvc({ ...svc, insurance: Math.max(0, Number(e.target.value) || 0) }); invalidateRates() }} className="h-9 w-20" />
                </label>
              </div>

              </div>{/* /left column */}

              {/* ── RATES, beside the form rather than under it ─────────────────
                  This is what the window is for; it was the one thing you had to scroll
                  to reach. Its own column, its own scroll, so a long list of services
                  never pushes the Buy button off screen. */}
              <div className="space-y-3 md:col-span-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rates</div>
              <Button variant="outline" className="w-full" onClick={getRates} disabled={ratesLoading || !addrComplete(to) || !addrComplete(from)}>
                {ratesLoading ? <><CircleNotch size={14} className="animate-spin" /> Getting rates…</> : rates ? "Refresh rates" : <><Truck size={14} weight="bold" /> Get rates</>}
              </Button>
              {rates && (rates.length === 0 ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  No rates for this parcel. Check the address and weight, or that the carrier is enabled on your Shippo account.
                </div>
              ) : (
                <div className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
                  {rates.map((r) => (
                    <label key={r.token} className={"flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors " + (pickedToken === r.token ? "border-primary bg-primary/5" : "border-border hover:bg-accent")}>
                      <input type="radio" name="rate" checked={pickedToken === r.token} onChange={() => setPickedToken(r.token)} className="size-4 accent-[var(--primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{r.carrier}{r.service ? ` · ${r.service}` : ""}</div>
                        <div className="text-2xs text-muted-foreground">{r.days != null ? `${r.days} day${r.days === 1 ? "" : "s"}` : "delivery est. n/a"}</div>
                      </div>
                      <div className="shrink-0 font-semibold tabular-nums">{usd(r.amount)}</div>
                    </label>
                  ))}
                </div>
              ))}

              {!addrComplete(from) && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  No warehouse ‘From’ address saved — set it in Settings › Platform before buying.
                </div>
              )}
              {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
              </div>{/* /right column */}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={buy} disabled={busy || !pickedToken}>
                {busy ? <><CircleNotch size={14} className="animate-spin" /> Buying…</>
                  : pickedToken ? `Buy label · ${usd(rates?.find((r) => r.token === pickedToken)?.amount || 0)}`
                    : "Buy label"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

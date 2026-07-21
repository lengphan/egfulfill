"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Warning, CheckCircle, Truck, MapPin } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupplierOptions, setFactorySettings, getSsDaysInTransit, type SupplierOptions } from "@/lib/api"

/**
 * Show a payment profile safely.
 *
 * Suppliers return LABELS, not numbers — "BMO Harris Bank 1234 (John Doe)" — so the last
 * four are already the only digits present. This masks anything longer anyway: a label is
 * free text on someone else's system, and the day one contains a full number is not the
 * day to discover we printed it verbatim.
 */
function maskCard(name?: string | null): string {
  if (!name) return "Saved card"
  return name.replace(/\d{5,}/g, (d) => "•••• " + d.slice(-4))
}

/** Their lists come back loosely shaped — an array of strings, or of objects with any of
 *  several id/label spellings. Read defensively rather than assume one. */
function toOptions(raw: unknown): { value: string; label: string; group?: string }[] {
  const arr = Array.isArray(raw) ? raw
    : (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown[] }).data))
      ? (raw as { data: unknown[] }).data : []
  return arr.map((x) => {
    if (typeof x === "string") return { value: x, label: x }
    const o = (x ?? {}) as Record<string, unknown>
    const value = String(o.id ?? o.code ?? o.key ?? o.value ?? o.name ?? "")
    // `code` FIRST among the human fields. Otto returns {id, code, type} — the readable
    // name is in `code` ("UPS Ground", "USPS Priority Mail") and it wasn't in this chain
    // at all, so every label fell through to `value`, which is `id`: a raw UUID. The whole
    // shipping dropdown read as 40 GUIDs. It stays after `label`/`name` so a supplier that
    // does send a proper display field still wins.
    const label = String(o.label ?? o.name ?? o.code ?? o.description ?? o.title ?? value)
    // normal vs third_party decides whether the third-party account number below is
    // required — picking a "… Third Party" method without one is rejected by Otto.
    const group = typeof o.type === "string" ? o.type : undefined
    return { value, label, group }
  }).filter((o) => o.value)
}

/**
 * Order settings — the fields a real purchase order needs beyond sku and quantity.
 *
 * Both supplier APIs have always accepted an address, a PO number and shipping/payment
 * methods; the board simply never sent them, so orders were correctly routed and still
 * incomplete. This is where those get set once.
 *
 * The ship-to is the factory's existing ship-from address, not a new field. The warehouse
 * is where blanks are delivered and it's already entered for buying labels — a second
 * address for the same building is a second thing to keep correct, and the day they
 * disagree neither is trustworthy.
 *
 * Otto's payment and shipping methods are read LIVE from their API because they're
 * per-account: terms and negotiated carriers differ, so a hardcoded list would be wrong
 * for everyone but whoever it was copied from, and wrong invisibly. S&S has no equivalent
 * endpoint — it bills the account on file — which is said plainly rather than dressed up
 * as an empty dropdown.
 */
export function SupplierOrderingDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [opts, setOpts] = useState<SupplierOptions | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [ssShip, setSsShip] = useState("")
  const [ssCard, setSsCard] = useState("")
  const [ottoPay, setOttoPay] = useState("")
  const [ottoShip, setOttoShip] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // How long each S&S warehouse takes to reach US, and the daily cut-off. Worth showing
  // next to the shipping method because autoselectWarehouse splits an order across
  // warehouses — this is what says whether that split costs a day. The cut-off is the
  // other half: an order placed at 4:30 ships tomorrow, whatever the method says.
  const [transit, setTransit] = useState<{ warehouse: string; cutOff: string; days: number | null }[] | null>(null)

  const load = useCallback(() => {
    setLoadErr(null)
    getSupplierOptions().then((o) => {
      setOpts(o)
      setSsShip(o.defaults.ss_shipping_method || "1")
      setSsCard(o.defaults.ss_payment_profile || "")
      setOttoPay(o.defaults.otto_payment_method || "net30")
      setOttoShip(o.defaults.otto_shipping_method || "")
      setEmail(o.defaults.order_email || "")
    }).catch((e) => setLoadErr(e instanceof Error ? e.message : "Couldn't load supplier options."))
    // Best-effort: transit times are useful context, never a reason the window fails.
    getSsDaysInTransit().then((r) => setTransit(r.warehouses ?? [])).catch(() => setTransit(null))
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [open, load])

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      await setFactorySettings({
        ss_shipping_method: ssShip,
        ss_payment_profile: ssCard,
        otto_payment_method: ottoPay,
        otto_shipping_method: ottoShip,
        order_email: email,
      })
      setMsg({ ok: true, text: "Saved — these apply to the next order placed." })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." })
    } finally { setBusy(false) }
  }

  const addr = opts?.shipTo ?? {}
  const addrLine = [addr.company || addr.name, addr.street, addr.street2, [addr.city, addr.state, addr.zip].filter(Boolean).join(" "), addr.country]
    .filter(Boolean).join(", ")
  const ottoPayOpts = toOptions(opts?.suppliers.otto.paymentMethods)
  const ottoShipOpts = toOptions(opts?.suppliers.otto.shippingMethods)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Order settings</DialogTitle>
          <DialogDescription>
            Where blanks are delivered, and how each supplier is paid. Applied to every order placed from this board.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto py-2">
          {loadErr ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
              <span>{loadErr}</span>
            </div>
          ) : !opts ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
          ) : (
            <>
              {/* Deliver to */}
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><MapPin size={14} weight="fill" /> Deliver to</h3>
                {opts.shipToComplete ? (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">{addrLine}</div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
                    <span>
                      Your warehouse address is incomplete, so supplier orders have nowhere to be delivered.
                      Fill it in at <strong>Settings › Ship-from address</strong> — it&apos;s the same address labels ship from.
                    </span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  This is your ship-from address. Blanks come back to the same warehouse they go out from, so it&apos;s
                  set in one place rather than kept twice.
                </p>
              </section>

              {/* S&S */}
              <section className="space-y-2 border-t border-border pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  S&amp;S Activewear
                  <LiveChip live={opts.suppliers.ss.live} />
                </h3>
                {/* WHICH CARD PAYS. Their profile name already carries the last four
                    ("BMO Harris Bank 1234"), and no full number exists in their API — so
                    there is nothing here to mask, and nothing stored that could leak. */}
                <Field label="Pays with">
                  {opts.suppliers.ss.paymentProfiles?.available ? (
                    <select value={ssCard} onChange={(e) => setSsCard(e.target.value)} disabled={busy}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                      <option value="">Account terms (no card)</option>
                      {opts.suppliers.ss.paymentProfiles.profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {maskCard(p.name)}{p.type ? ` · ${p.type}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      {opts.suppliers.ss.paymentProfiles?.reason
                        ?? "No saved cards found — S&S will bill the account on file."}
                    </p>
                  )}
                </Field>
                <Field label="Shipping method">
                  <select value={ssShip} onChange={(e) => setSsShip(e.target.value)} disabled={busy}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                    {opts.suppliers.ss.shippingMethods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </Field>
                <p className="text-xs text-muted-foreground">{opts.suppliers.ss.shippingNote}</p>
                {transit && transit.length > 0 && (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div className="mb-1 text-xs font-medium">Transit to your warehouse</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {transit.slice(0, 6).map((w) => (
                        <span key={w.warehouse}>
                          <span className="font-medium text-foreground">{w.warehouse}</span>{" "}
                          {w.days != null ? `${w.days}d` : "—"}
                          <span className="opacity-70"> · cut-off {w.cutOff}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Otto */}
              <section className="space-y-2 border-t border-border pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  Otto Cap
                  <LiveChip live={opts.suppliers.otto.live} />
                </h3>
                {/* "Couldn't ask" and "there are none" are different facts, and one of them
                    means an order would go out on the wrong terms. Say which. */}
                {!opts.suppliers.otto.available ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
                    <span>{opts.suppliers.otto.reason ?? "Otto Cap isn't connected."}</span>
                  </div>
                ) : (
                  <>
                    <Field label="Payment method">
                      <select value={ottoPay} onChange={(e) => setOttoPay(e.target.value)} disabled={busy}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                        {ottoPayOpts.length === 0 && <option value="net30">net30</option>}
                        {ottoPayOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Shipping method">
                      <select value={ottoShip} onChange={(e) => setOttoShip(e.target.value)} disabled={busy}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                        <option value="">— their default —</option>
                        {/* Split by Otto's `type`. A "… Third Party" method bills someone
                            else's carrier account, so it needs the account number field
                            below — mixing the two in one flat list invites picking a
                            third-party method with nothing to bill it to. */}
                        {ottoShipOpts.some((m) => m.group === "third_party") ? (
                          <>
                            <optgroup label="Billed to us">
                              {ottoShipOpts.filter((m) => m.group !== "third_party").map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </optgroup>
                            <optgroup label="Third-party account">
                              {ottoShipOpts.filter((m) => m.group === "third_party").map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </optgroup>
                          </>
                        ) : (
                          ottoShipOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)
                        )}
                      </select>
                    </Field>
                    <p className="text-xs text-muted-foreground">Read live from your Otto account, so these are your terms — not a copied list.</p>
                  </>
                )}
              </section>

              <section className="space-y-2 border-t border-border pt-4">
                <Field label="Order confirmation email">
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy}
                         placeholder="purchasing@yourcompany.com" className="h-9" />
                </Field>
                <p className="text-xs text-muted-foreground">Where both suppliers send order confirmations.</p>
              </section>

              {msg && (
                <div className={"flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
                  (msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-destructive/30 bg-destructive/10 text-destructive")}>
                  {msg.ok ? <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" /> : <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />}
                  <span>{msg.text}</span>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          <Button size="sm" onClick={save} disabled={busy || !opts}>
            {busy ? <CircleNotch size={13} className="animate-spin" /> : <Truck size={13} weight="bold" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Whether orders to this supplier actually go out, or stop at a dry run. Stated rather
 *  than hidden — "placed" means something different under each. */
function LiveChip({ live }: { live: boolean }) {
  return live
    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Live orders</span>
    : <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Dry run</span>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

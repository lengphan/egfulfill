"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Warning, CheckCircle, Truck, MapPin } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getSupplierOptions, setFactorySettings, getSsDaysInTransit, setAdminSecret, type SupplierOptions } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { OttoCardOnFile } from "@/components/app/otto-card-on-file"

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
  const [ottoCust, setOttoCust] = useState("")
  const [ottoContact, setOttoContact] = useState("")
  // Editing a credential is admin-only server-side; the input is hidden for everyone else
  // rather than offered and then refused.
  const isAdmin = getUser()?.role === "admin"
  const [editKey, setEditKey] = useState<string | null>(null)
  const [keyVal, setKeyVal] = useState("")
  const [keyBusy, setKeyBusy] = useState(false)
  const [ottoPay, setOttoPay] = useState("")
  const [ottoShip, setOttoShip] = useState("")
  const [ssEmail, setSsEmail] = useState("")
  const [ottoEmail, setOttoEmail] = useState("")
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
      setOttoCust(o.defaults.otto_customer || "")
      setOttoContact(o.defaults.otto_contact || "")
      setOttoPay(o.defaults.otto_payment_method || "net30")
      setOttoShip(o.defaults.otto_shipping_method || "")
      // Fall back to the shared address so an account configured before the split keeps
      // working rather than looking unset.
      setSsEmail(o.defaults.ss_order_email || o.defaults.order_email || "")
      setOttoEmail(o.defaults.otto_order_email || o.defaults.order_email || "")
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
        otto_customer: ottoCust,
        otto_contact: ottoContact,
        otto_payment_method: ottoPay,
        otto_shipping_method: ottoShip,
        ss_order_email: ssEmail,
        otto_order_email: ottoEmail,
        order_email: ssEmail || ottoEmail,
      })
      setMsg({ ok: true, text: "Saved — these apply to the next order placed." })
      // Re-read: the S&S cards are looked up from the SAVED email, so a new address only
      // takes effect after this. Without it the Payment tab looked broken.
      load()
      // AND CLOSE. Saving is the whole errand here; staying open made you dismiss the
      // window yourself every time, and the confirmation had already done its job by the
      // time you reached for the X. Long enough to see it, short enough not to wait.
      setTimeout(() => onOpenChange(false), 700)
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." })
    } finally { setBusy(false) }
  }

  /** Save one credential, then re-read so the mask reflects what's actually stored. */
  const saveKey = async (name: string) => {
    if (!keyVal.trim()) { setEditKey(null); return }
    setKeyBusy(true)
    try {
      const r = await setAdminSecret(name, keyVal.trim())
      if (r.error) { setMsg({ ok: false, text: r.error }); return }
      setMsg({ ok: true, text: `${name} updated.` })
      setEditKey(null); setKeyVal("")
      load()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save that key." })
    } finally { setKeyBusy(false) }
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
            <Tabs defaultValue="delivery">
              {/* Grouped by QUESTION, not by supplier. "Where does it ship?" and "how does
                  it pay?" are asked one at a time across both suppliers; the old layout
                  answered them twice each, once per supplier, so comparing S&S's shipping
                  to Otto's meant scrolling past everything else. */}
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="delivery">Delivery</TabsTrigger>
                <TabsTrigger value="payment">Payment</TabsTrigger>
                <TabsTrigger value="email">Email</TabsTrigger>
                <TabsTrigger value="keys">API keys</TabsTrigger>
              </TabsList>

              {/* ── DELIVERY ─────────────────────────────────────────────────── */}
              <TabsContent value="delivery" className="mt-4 space-y-5">
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
                </section>

                <section className="space-y-2 border-t border-border pt-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">S&amp;S Activewear</h3>
                  <Field label="Shipping method">
                    <select value={ssShip} onChange={(e) => setSsShip(e.target.value)} disabled={busy}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                      {opts.suppliers.ss.shippingMethods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </Field>
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

                <section className="space-y-2 border-t border-border pt-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">Otto Cap</h3>
                  {!opts.suppliers.otto.available ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
                      <span>{opts.suppliers.otto.reason ?? "Otto Cap isn't connected."}</span>
                    </div>
                  ) : (
                    <Field label="Shipping method">
                      <select value={ottoShip} onChange={(e) => setOttoShip(e.target.value)} disabled={busy}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                        <option value="">
                          {ottoShipOpts.length
                            ? `Otto's default (${ottoShipOpts[0].label})`
                            : "Otto's default"}
                        </option>
                        {ottoShipOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </Field>
                  )}
                </section>
              </TabsContent>

              {/* ── PAYMENT ──────────────────────────────────────────────────── */}
              <TabsContent value="payment" className="mt-4 space-y-5">
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">S&amp;S Activewear</h3>
                  {/* No full number exists in their API — the label already carries the
                      last four — so there is nothing stored here that could leak. */}
                  <Field label="Pays with">
                    {opts.suppliers.ss.paymentProfiles?.available ? (
                      <select value={ssCard} onChange={(e) => setSsCard(e.target.value)} disabled={busy}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                        <option value="">Account terms (no card)</option>
                        {opts.suppliers.ss.paymentProfiles.profiles.map((p) => (
                          <option key={p.id} value={p.id}>{maskCard(p.name)}{p.type ? ` · ${p.type}` : ""}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        {opts.suppliers.ss.paymentProfiles?.reason ?? "No saved cards on this account — S&S will bill the account on file."}
                      </p>
                    )}
                  </Field>
                </section>

                <section className="space-y-2 border-t border-border pt-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">Otto Cap</h3>
                  {!opts.suppliers.otto.available ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
                      <span>{opts.suppliers.otto.reason ?? "Otto Cap isn't connected."}</span>
                    </div>
                  ) : (
                    <>
                      <Field label="Pays with">
                        <select value={ottoPay} onChange={(e) => setOttoPay(e.target.value)} disabled={busy}
                          className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                          {ottoPayOpts.length === 0 && <option value="net30">net30</option>}
                          {ottoPayOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </Field>
                      <p className="text-xs text-muted-foreground">
                        Billing terms from your Otto account — they expose no saved cards, so a
                        card-paid order carries the card below.
                      </p>
                      {/* The card lives HERE rather than in a dialog at placement. Otto need it
                          on every credit-card order, so asking at placement meant typing the
                          same number for every purchase. Saved once in this browser, that
                          window never opens. */}
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <OttoCardOnFile compact onSaved={() => setTimeout(() => onOpenChange(false), 700)} />
                      </div>
                      {/* Otto REQUIRE both on every order and they come from their
                          Customer API, so they're picked here rather than typed. */}
                      <Field label="Order as">
                        <select value={ottoCust} onChange={(e) => { setOttoCust(e.target.value); setOttoContact("") }}
                          disabled={busy} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                          <option value="">— choose a customer —</option>
                          {(opts.ottoCustomers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Contact">
                        <select value={ottoContact} onChange={(e) => setOttoContact(e.target.value)}
                          disabled={busy || !ottoCust} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                          <option value="">— choose a contact —</option>
                          {((opts.ottoCustomers ?? []).find((c) => c.id === ottoCust)?.contacts ?? [])
                            .map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                        </select>
                      </Field>
                      {!(opts.ottoCustomers ?? []).length && (
                        <p className="text-xs text-amber-700">
                          Otto returned no customers — orders will be rejected until this is set.
                        </p>
                      )}
                    </>
                  )}
                </section>
              </TabsContent>

              {/* ── EMAIL ────────────────────────────────────────────────────── */}
              <TabsContent value="email" className="mt-4 space-y-5">
                {/* One address PER SUPPLIER. The accounts were registered under different
                    emails, and S&S look payment profiles up BY EMAIL — so a single shared
                    field would fetch the wrong person's cards, or none at all. */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">S&amp;S Activewear</h3>
                  <Field label="Account email">
                    <Input value={ssEmail} onChange={(e) => setSsEmail(e.target.value)} disabled={busy}
                           placeholder="the address this S&S account is registered to" className="h-9" />
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    Decides whose saved cards appear under <strong>Payment</strong>. Save after changing it.
                  </p>
                </section>

                <section className="space-y-2 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold">Otto Cap</h3>
                  <Field label="Account email">
                    <Input value={ottoEmail} onChange={(e) => setOttoEmail(e.target.value)} disabled={busy}
                           placeholder="the address this Otto account is registered to" className="h-9" />
                  </Field>
                </section>
              </TabsContent>

              {/* ── API KEYS ─────────────────────────────────────────────────── */}
              <TabsContent value="keys" className="mt-4 space-y-5">
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    S&amp;S Activewear
                    {opts.keys?.ss?.set
                      ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-2xs font-medium text-emerald-700">connected</span>
                      : <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">no key</span>}
                  </h3>
                  <KeyRow label="Account number" name="SS_ACCOUNT_NUMBER" shown={opts.keys?.ss?.account ?? null}
                    isAdmin={isAdmin} editing={editKey === "SS_ACCOUNT_NUMBER"} value={keyVal} busy={keyBusy}
                    onEdit={() => { setEditKey("SS_ACCOUNT_NUMBER"); setKeyVal("") }}
                    onChange={setKeyVal} onSave={() => saveKey("SS_ACCOUNT_NUMBER")} onCancel={() => setEditKey(null)} />
                  <KeyRow label="API key" name="SS_API_KEY" shown={opts.keys?.ss?.masked ?? null}
                    isAdmin={isAdmin} editing={editKey === "SS_API_KEY"} value={keyVal} busy={keyBusy}
                    onEdit={() => { setEditKey("SS_API_KEY"); setKeyVal("") }}
                    onChange={setKeyVal} onSave={() => saveKey("SS_API_KEY")} onCancel={() => setEditKey(null)} />
                </section>

                <section className="space-y-2 border-t border-border pt-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    Otto Cap
                    {opts.keys?.otto?.set
                      ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-2xs font-medium text-emerald-700">connected</span>
                      : <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">no key</span>}
                  </h3>
                  {/* Username/password aren't in the editable set server-side — only the
                      OAuth client pair is — so the username is shown, not offered. */}
                  <KeyRow label="Username" name="OTTOCAP_USERNAME" shown={opts.keys?.otto?.user ?? null}
                    isAdmin={false} editing={false} value="" busy={false}
                    onEdit={() => {}} onChange={() => {}} onSave={() => {}} onCancel={() => {}} />
                  <KeyRow label="Client secret" name="OTTOCAP_CLIENT_SECRET" shown={opts.keys?.otto?.masked ?? null}
                    isAdmin={isAdmin} editing={editKey === "OTTOCAP_CLIENT_SECRET"} value={keyVal} busy={keyBusy}
                    onEdit={() => { setEditKey("OTTOCAP_CLIENT_SECRET"); setKeyVal("") }}
                    onChange={setKeyVal} onSave={() => saveKey("OTTOCAP_CLIENT_SECRET")} onCancel={() => setEditKey(null)} />
                </section>

                {/* Shown, never editable. Checking a connection belongs next to the order
                    you're about to place; CHANGING a credential belongs in Integrations,
                    with its audit trail. */}
                {!isAdmin && (
                  <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                    Only an admin can change these.
                  </p>
                )}
              </TabsContent>

              {msg && (
                <div className={"mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
                  (msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-destructive/30 bg-destructive/10 text-destructive")}>
                  {msg.ok ? <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" /> : <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />}
                  <span>{msg.text}</span>
                </div>
              )}
            </Tabs>
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

/**
 * One credential: masked, and editable in place by an admin.
 *
 * The field starts EMPTY rather than pre-filled with the mask — a masked value typed back
 * would save the dots as the key. Nothing readable is ever populated into the input, so
 * there is no state where the real secret is on screen.
 */
function KeyRow({ label, shown, isAdmin, editing, value, busy, onEdit, onChange, onSave, onCancel }: {
  label: string; name: string; shown: string | null; isAdmin: boolean; editing: boolean
  value: string; busy: boolean
  onEdit: () => void; onChange: (v: string) => void; onSave: () => void; onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      {editing ? (
        <>
          <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={busy}
                 placeholder="paste the new value" autoFocus className="h-7 flex-1 font-mono text-xs" />
          <Button size="sm" className="h-7" onClick={onSave} disabled={busy || !value.trim()}>Save</Button>
          <button onClick={onCancel} disabled={busy} className="text-muted-foreground hover:text-foreground">Cancel</button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate font-mono">{shown ?? "not set"}</span>
          {isAdmin && (
            <button onClick={onEdit} className="font-medium text-primary hover:underline">
              {shown ? "Change" : "Set"}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

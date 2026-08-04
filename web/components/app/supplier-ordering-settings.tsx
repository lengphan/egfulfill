"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Check, Warning, ArrowSquareOut } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupplierOptions, setFactorySettings, type SupplierOptions } from "@/lib/api"

const maskCard = (label: string | null) => {
  if (!label) return "Saved payment method"
  // S&S already return a masked label; this only guards against a future field that
  // isn't masked, so a full number can never reach the screen from here.
  return label.replace(/\b\d{12,19}\b/g, (n) => "•••• " + n.slice(-4))
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm transition-colors hover:border-primary/40"

/**
 * Supplier ordering defaults — set once here instead of on every purchase.
 *
 * These settings keys already existed and the purchase dialog already read them as
 * defaults; nothing exposed them, so the ONLY place to choose a payment method or a
 * customer was the order dialog itself. That is why every purchase asked again.
 *
 * NOTHING HERE IS CARD DATA. S&S store the cards and hand back a profile id — an opaque
 * reference — and the label they return is already masked to the last four. We keep the
 * id. A full PAN never reaches this app, which is what keeps it outside PCI DSS scope.
 *
 * Otto is different and cannot be fixed from our side: their API exposes no saved cards,
 * so a card-paid Otto order needs the number every time. Storing it ourselves is exactly
 * the thing worth avoiding, so the card field stays in the order dialog and this screen
 * says why.
 */
export function SupplierOrderingSettings() {
  const [opts, setOpts] = useState<SupplierOptions | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getSupplierOptions()
      .then((o) => {
        setOpts(o)
        setForm({
          ss_order_email: o.defaults.ss_order_email || o.defaults.order_email || "",
          ss_payment_profile: o.defaults.ss_payment_profile || "",
          ss_shipping_method: o.defaults.ss_shipping_method || "",
          otto_order_email: o.defaults.otto_order_email || o.defaults.order_email || "",
          otto_payment_method: o.defaults.otto_payment_method || "",
          otto_shipping_method: o.defaults.otto_shipping_method || "",
          otto_customer: o.defaults.otto_customer || "",
          otto_contact: o.defaults.otto_contact || "",
        })
      })
      .catch(() => setErr("Couldn't load supplier options."))
  }, [])
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  const set = (k: string, v: string) =>
    setForm((f) => ({ ...f, ...(k === "otto_customer" ? { otto_contact: "" } : {}), [k]: v }))

  const save = async () => {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const r = await setFactorySettings(form)
      if (r?.error) throw new Error(r.error)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.")
    } finally { setBusy(false) }
  }

  if (!opts) {
    return (
      <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <CircleNotch size={15} className="animate-spin" /> Loading supplier options…
      </div>
    )
  }

  const ssProfiles = opts.suppliers.ss.paymentProfiles
  const ottoCustomer = (opts.ottoCustomers ?? []).find((c) => c.id === form.otto_customer)
  const asOptions = (v: unknown[]): { value: string; label: string }[] =>
    (v ?? []).map((x) => {
      const o = x as Record<string, unknown>
      const value = String(o.id ?? o.code ?? o.value ?? o.service ?? "")
      const label = String(o.label ?? o.name ?? o.description ?? value)
      return { value, label }
    }).filter((o) => o.value)

  return (
    <div className="space-y-6 p-5">
      <p className="text-sm text-muted-foreground">
        Chosen once here and applied to every purchase order, so the ordering dialog stops asking.
      </p>

      {/* ── S&S ─────────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">S&amp;S Activewear</h3>

        <Row label="Ordering email" hint="S&S look payment methods up by the person on the account, so this decides which are offered.">
          <Input value={form.ss_order_email ?? ""} onChange={(e) => set("ss_order_email", e.target.value)}
            placeholder="buyer@yourcompany.com" />
        </Row>

        <Row label="Pays with" hint="Saved on your S&S account. We store only their reference to it — never a card number.">
          {ssProfiles?.available ? (
            <select value={form.ss_payment_profile ?? ""} onChange={(e) => set("ss_payment_profile", e.target.value)} className={selectCls}>
              <option value="">Account terms (no card)</option>
              {ssProfiles.profiles.map((p) => (
                <option key={p.id} value={p.id}>{maskCard(p.name)}{p.type ? ` · ${p.type}` : ""}</option>
              ))}
            </select>
          ) : (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {ssProfiles?.reason ?? "No saved payment methods for that email — S&S will bill the account on file."}
            </p>
          )}
        </Row>

        <Row label="Ships with" hint="The service every S&S order defaults to.">
          <select value={form.ss_shipping_method ?? ""} onChange={(e) => set("ss_shipping_method", e.target.value)} className={selectCls}>
            <option value="">— use the account default —</option>
            {(opts.suppliers.ss.shippingMethods ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Row>
      </section>

      {/* ── Otto ────────────────────────────────────────────────────────────── */}
      <section className="space-y-3 border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Otto Cap</h3>

        {!opts.suppliers.otto.available ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
            <span>{opts.suppliers.otto.reason ?? "Otto Cap isn't connected."}</span>
          </div>
        ) : (
          <>
            <Row label="Ordering email">
              <Input value={form.otto_order_email ?? ""} onChange={(e) => set("otto_order_email", e.target.value)}
                placeholder="buyer@yourcompany.com" />
            </Row>

            <Row label="Pays with" hint="Otto's billing terms for your account.">
              <select value={form.otto_payment_method ?? ""} onChange={(e) => set("otto_payment_method", e.target.value)} className={selectCls}>
                <option value="">— choose —</option>
                {asOptions(opts.suppliers.otto.paymentMethods).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Row>

            {/* Credit Card is a valid, working choice — Otto bills the card held on your
                account and no number is entered here. What is off is TYPING a card into this
                app, which would put the server in PCI scope. The old copy conflated the two
                and read as "card orders don't work", which they do. */}
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <strong className="text-foreground">Credit Card works</strong> — Otto charges the card
              held on your account, and no card number is entered here or sent by us. What&apos;s
              switched off is typing a card into EGFULFILL, which would put this server inside PCI
              DSS scope. Unlike S&amp;S, Otto&apos;s API exposes no saved-card token, so there is
              nothing safer for us to store. 
            </div>

            <Row label="Order as" hint="Otto require a customer and a contact on every order.">
              <select value={form.otto_customer ?? ""} onChange={(e) => set("otto_customer", e.target.value)} className={selectCls}>
                <option value="">— choose a customer —</option>
                {(opts.ottoCustomers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Row>

            <Row label="Contact">
              <select value={form.otto_contact ?? ""} onChange={(e) => set("otto_contact", e.target.value)}
                disabled={!ottoCustomer} className={selectCls}>
                <option value="">{ottoCustomer ? "— choose a contact —" : "Pick a customer first"}</option>
                {(ottoCustomer?.contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Row>

            <Row label="Ships with" hint="Otto reject a service they can't run — if an order fails with no_service, the error now lists what they will accept.">
              <select value={form.otto_shipping_method ?? ""} onChange={(e) => set("otto_shipping_method", e.target.value)} className={selectCls}>
                <option value="">— choose —</option>
                {asOptions(opts.suppliers.otto.shippingMethods).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Row>
          </>
        )}
      </section>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={save} disabled={busy}>
          {busy ? <CircleNotch size={15} className="animate-spin" /> : <Check size={15} weight="bold" />} Save defaults
        </Button>
        {saved && <span className="text-sm text-emerald-600">Saved — purchases will use these.</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
        <a href="/purchasing?tab=purchase" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Purchasing <ArrowSquareOut size={11} weight="bold" />
        </a>
      </div>
    </div>
  )
}

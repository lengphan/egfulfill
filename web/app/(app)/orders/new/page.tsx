"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Plus, Trash, CheckCircle, WarningCircle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createOrder, getOrders, validateAddress, type NewOrderItem, type ValidatedAddress } from "@/lib/api"
import { nextOrderId, nextSellerSeq } from "@/lib/order-id"
import { orderTotal } from "@/lib/pricing"

// Best-effort parse of a pasted US address block → structured fields.
// Last non-empty line is expected as "City, ST 12345" (comma optional).
function parseAddress(text: string): { street: string; street2: string; city: string; state: string; zip: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  const last = lines[lines.length - 1] ?? ""
  const m = last.match(/^(.*?)[,\s]+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/)
  const city = m ? m[1].trim() : ""
  const state = m ? m[2].toUpperCase() : ""
  const zip = m ? m[3] : ""
  const streetLines = m ? lines.slice(0, -1) : lines
  return { street: streetLines[0] ?? "", street2: streetLines.slice(1).join(", "), city, state, zip }
}

type Valid = { kind: "idle" } | { kind: "checking" } | { kind: "ok"; addr: ValidatedAddress } | { kind: "bad"; msg: string }

type Line = { name: string; qty: string; price: string; color: string; size: string }
const emptyLine = (): Line => ({ name: "", qty: "1", price: "", color: "", size: "" })

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function NewOrderPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [addressText, setAddressText] = useState("")
  const [valid, setValid] = useState<Valid>({ kind: "idle" })
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Existing orders → next per-seller display # (canonical _nextSellerSeq).
  const [existing, setExisting] = useState<Array<{ id?: string; seq?: number | null }>>([])
  useEffect(() => {
    let alive = true
    getOrders()
      .then((rows) => alive && setExisting(rows ?? []))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  async function onValidate() {
    const p = parseAddress(addressText)
    if (!p.street || !p.zip) {
      setValid({ kind: "bad", msg: "Need at least a street line and a City, ST ZIP line." })
      return
    }
    setValid({ kind: "checking" })
    try {
      const r = await validateAddress({
        streetAddress: p.street,
        secondaryAddress: p.street2 || undefined,
        city: p.city,
        state: p.state,
        ZIPCode: p.zip,
      })
      if (r.ok && r.address) setValid({ kind: "ok", addr: r.address })
      else setValid({ kind: "bad", msg: r.error || "USPS couldn't verify this address." })
    } catch (e) {
      setValid({ kind: "bad", msg: e instanceof Error ? e.message : "Validation unavailable." })
    }
  }

  // Canonical order total: Σ(unit × qty) + first-item/additional shipping.
  const pricing = useMemo(
    () =>
      orderTotal(
        lines
          .filter((l) => l.name.trim())
          .map((l) => ({ qty: Number(l.qty) || 1, unitPrice: Number(l.price) || 0, size: l.size })),
        []
      ),
    [lines]
  )

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (i: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))

  const canSave = name.trim() && lines.some((l) => l.name.trim())

  async function onSubmit() {
    setError(null)
    if (!canSave) {
      setError("Add a customer name and at least one item.")
      return
    }
    setSaving(true)
    try {
      const id = nextOrderId()
      const seq = nextSellerSeq(existing)
      const items: NewOrderItem[] = lines
        .filter((l) => l.name.trim())
        .map((l) => ({
          name: l.name.trim(),
          qty: Number(l.qty) || 1,
          unitPrice: Number(l.price) || 0,
          color: l.color.trim() || undefined,
          size: l.size.trim() || undefined,
        }))
      const parsed = valid.kind === "ok" ? valid.addr : parseAddress(addressText)
      const address =
        addressText.trim()
          ? {
              name: name.trim(),
              street: "street" in parsed ? parsed.street : "",
              street2: "street2" in parsed ? parsed.street2 : "",
              city: parsed.city,
              state: parsed.state,
              zip: parsed.zip,
              validated: valid.kind === "ok",
              raw: addressText.trim(),
            }
          : undefined
      const r = await createOrder({
        id,
        seq,
        source: "manual",
        status: "new",
        customer: { name: name.trim(), email: email.trim() || undefined },
        address,
        total: pricing.total,
        items,
      })
      if (r.error) throw new Error(r.error)
      router.push(`/orders/${encodeURIComponent(id)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the order.")
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/orders")} className="text-muted-foreground">
          <ArrowLeft size={16} weight="bold" /> Orders
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">New order</h1>
      </div>

      <SectionCard title="Customer & shipping">
        <div className="space-y-4 p-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
              className="h-11 text-base"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Shipping address</span>
              {valid.kind === "ok" && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <CheckCircle size={14} weight="fill" /> Validated
                </span>
              )}
              {valid.kind === "bad" && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600" title={valid.msg}>
                  <WarningCircle size={14} weight="fill" /> Not validated
                </span>
              )}
            </div>
            <textarea
              value={addressText}
              onChange={(e) => {
                setAddressText(e.target.value)
                setValid({ kind: "idle" })
              }}
              rows={4}
              placeholder={"Paste the full address…\n123 Main St, Apt 4\nSacramento, CA 95826"}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={onValidate} disabled={valid.kind === "checking" || !addressText.trim()}>
                {valid.kind === "checking" ? "Checking…" : "Validate address"}
              </Button>
              {valid.kind === "ok" && (
                <span className="truncate text-xs text-muted-foreground">
                  {[valid.addr.street, valid.addr.street2, valid.addr.city, valid.addr.state, `${valid.addr.zip}${valid.addr.zip4 ? "-" + valid.addr.zip4 : ""}`].filter(Boolean).join(", ")}
                </span>
              )}
              {valid.kind === "bad" && <span className="truncate text-xs text-amber-600">{valid.msg}</span>}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Email (optional)</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@email.com" className="max-w-sm" />
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title="Items"
        actions={
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus size={14} weight="bold" /> Add item
          </Button>
        }
      >
        <div className="divide-y divide-border">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_64px_88px_auto] items-end gap-3 px-5 py-4 sm:grid-cols-[1fr_72px_96px_100px_100px_auto]">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Product</span>
                <Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="e.g. Classic Tee" className="h-9" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Qty</span>
                <Input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^0-9]/g, "") })} className="h-9" inputMode="numeric" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Price</span>
                <Input value={l.price} onChange={(e) => setLine(i, { price: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" className="h-9" inputMode="decimal" />
              </label>
              <label className="hidden flex-col gap-1 sm:flex">
                <span className="text-xs text-muted-foreground">Color</span>
                <Input value={l.color} onChange={(e) => setLine(i, { color: e.target.value })} className="h-9" />
              </label>
              <label className="hidden flex-col gap-1 sm:flex">
                <span className="text-xs text-muted-foreground">Size</span>
                <Input value={l.size} onChange={(e) => setLine(i, { size: e.target.value })} className="h-9" />
              </label>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeLine(i)}
                disabled={lines.length === 1}
                className="text-muted-foreground hover:text-red-600"
                aria-label="Remove item"
              >
                <Trash size={15} weight="bold" />
              </Button>
            </div>
          ))}
        </div>
        <div className="space-y-1.5 border-t border-border px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{usd(pricing.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Shipping</span>
            <span className="tabular-nums">{usd(pricing.shipping)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1.5 font-semibold">
            <span>Total</span>
            <span className="text-lg tabular-nums">{usd(pricing.total)}</span>
          </div>
        </div>
      </SectionCard>

      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/orders")}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={saving || !canSave}>
          {saving ? "Creating…" : "Create order"}
        </Button>
      </div>
    </div>
  )
}

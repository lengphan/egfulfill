"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Plus, Trash } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createOrder, type NewOrderItem } from "@/lib/api"

type Line = { name: string; qty: string; price: string; color: string; size: string }
const emptyLine = (): Line => ({ name: "", qty: "1", price: "", color: "", size: "" })

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function NewOrderPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 0), 0),
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
      const id = `FF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const items: NewOrderItem[] = lines
        .filter((l) => l.name.trim())
        .map((l) => ({
          name: l.name.trim(),
          qty: Number(l.qty) || 1,
          unitPrice: Number(l.price) || 0,
          color: l.color.trim() || undefined,
          size: l.size.trim() || undefined,
        }))
      const r = await createOrder({
        id,
        source: "manual",
        status: "new",
        customer: { name: name.trim(), email: email.trim() || undefined },
        total,
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

      <SectionCard title="Customer">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Email (optional)</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@email.com" />
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
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-lg font-semibold tabular-nums">{usd(total)}</span>
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

"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowsClockwise, ShieldCheck } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { api, ApiError } from "@/lib/api"

type Level = "live" | "configured" | "off" | "error" | "restricted" | "checking"
type Result = { level: Level; detail?: string }

const LEVEL_META: Record<Level, { label: string; dot: string; text: string }> = {
  live: { label: "Live", dot: "bg-emerald-500", text: "text-emerald-700" },
  configured: { label: "Configured", dot: "bg-violet-500", text: "text-violet-700" },
  off: { label: "Not configured", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
  error: { label: "Error", dot: "bg-red-500", text: "text-red-600" },
  restricted: { label: "Staff only", dot: "bg-amber-400", text: "text-amber-600" },
  checking: { label: "Checking…", dot: "bg-muted-foreground/40 animate-pulse", text: "text-muted-foreground" },
}

// Fetch a JSON endpoint without throwing on non-2xx — we want to read {ok:false} bodies
// and distinguish 403 (staff-only) from real errors.
type Raw = { ok: boolean; status: number; body: Record<string, unknown> }
async function raw(path: string): Promise<Raw> {
  try {
    const body = await api<Record<string, unknown>>(path)
    return { ok: true, status: 200, body }
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, status: e.status, body: {} }
    return { ok: false, status: 0, body: {} }
  }
}
const hasFail = (o: Record<string, unknown>) =>
  Object.values(o).some((v) => typeof v === "string" && /fail|error/i.test(v))

// One check per integration. Kept declarative so a "swap key" editor can attach later.
type Integration = {
  key: string
  name: string
  blurb: string
  group: string
  check: () => Promise<Result>
}

const configOnly = (path: string, field = "configured"): (() => Promise<Result>) => async () => {
  const r = await raw(path)
  if (r.status === 401 || r.status === 403) return { level: "restricted" }
  if (!r.ok) return { level: "error", detail: `HTTP ${r.status || "—"}` }
  return r.body[field] ? { level: "configured" } : { level: "off" }
}

const configThenTest = (
  cfgPath: string,
  testPath: string,
  enabledField: string
): (() => Promise<Result>) => async () => {
  const c = await raw(cfgPath)
  if (c.status === 401 || c.status === 403) return { level: "restricted" }
  if (!c.ok) return { level: "error", detail: `HTTP ${c.status || "—"}` }
  if (!c.body[enabledField]) return { level: "off" }
  const t = await raw(testPath)
  if (t.body.ok === true) return { level: "live" }
  return { level: "error", detail: String(t.body.error ?? "test failed") }
}

const INTEGRATIONS: Integration[] = [
  // Channels
  { key: "etsy", name: "Etsy", blurb: "Order sync + tracking", group: "Channels", check: configOnly("/api/etsy/config") },
  { key: "shopify", name: "Shopify", blurb: "Storefront orders", group: "Channels", check: configOnly("/api/shopify/config") },
  { key: "tiktok", name: "TikTok Shop", blurb: "Marketplace orders", group: "Channels", check: configOnly("/api/tiktok/config") },
  // Payments
  { key: "stripe", name: "Stripe", blurb: "Card top-ups", group: "Payments", check: configThenTest("/api/stripe/config", "/api/stripe/test", "enabled") },
  { key: "paypal", name: "PayPal", blurb: "Top-ups + payouts", group: "Payments", check: configThenTest("/api/paypal/config", "/api/paypal/test", "enabled") },
  {
    key: "vietqr", name: "VietQR", blurb: "VN bank top-ups", group: "Payments",
    check: async () => {
      const r = await raw("/api/vietqr/selftest")
      if (r.status === 401 || r.status === 403) return { level: "restricted" }
      if (!r.ok) return { level: "error", detail: `HTTP ${r.status || "—"}` }
      return hasFail(r.body) ? { level: "error", detail: "auth failed" } : { level: "live" }
    },
  },
  // Shipping
  {
    key: "shipping", name: "Shipping (EasyPost / Shippo)", blurb: "Labels + rates", group: "Shipping",
    check: async () => {
      const r = await raw("/api/shipping/test")
      if (r.status === 401 || r.status === 403) return { level: "restricted" }
      if (!r.ok) return { level: "error", detail: `HTTP ${r.status || "—"}` }
      const entries = Object.entries(r.body)
      if (!entries.length) return { level: "off" }
      const detail = entries.map(([k, v]) => `${k}: ${v}`).join(" · ")
      const anyOk = entries.some(([, v]) => v === "ok")
      return anyOk ? { level: "live", detail } : { level: "error", detail }
    },
  },
  {
    key: "usps", name: "USPS direct", blurb: "USPS-direct labels", group: "Shipping",
    check: async () => {
      const r = await raw("/api/usps/test")
      if (r.status === 401 || r.status === 403) return { level: "restricted" }
      if (!r.ok) return { level: "error", detail: `HTTP ${r.status || "—"}` }
      if (r.body.oauth === "ok") return { level: "live" }
      return hasFail(r.body) ? { level: "error", detail: String(r.body.oauth ?? "") } : { level: "off" }
    },
  },
  // Suppliers
  {
    key: "ss", name: "S&S Activewear", blurb: "Blank catalog + orders", group: "Suppliers",
    check: async () => {
      const r = await raw("/api/ss/status")
      if (r.status === 401 || r.status === 403) return { level: "restricted" }
      if (!r.ok) return { level: "error", detail: `HTTP ${r.status || "—"}` }
      return r.body.configured ? { level: "configured", detail: r.body.synced_count ? `${r.body.synced_count} synced` : undefined } : { level: "off" }
    },
  },
  {
    key: "otto", name: "Otto Cap", blurb: "Headwear supplier", group: "Suppliers",
    check: async () => {
      const r = await raw("/api/otto/status")
      if (r.status === 401 || r.status === 403) return { level: "restricted" }
      if (!r.ok) return { level: "error", detail: `HTTP ${r.status || "—"}` }
      if (!r.body.configured) return { level: "off" }
      if (r.body.auth === "ok") return { level: "live", detail: r.body.sandbox ? "sandbox" : "live" }
      return { level: "error", detail: String(r.body.error ?? "auth failed") }
    },
  },
  // Other
  {
    key: "sheets", name: "Google Sheets", blurb: "Order import", group: "Other",
    check: async () => {
      const r = await raw("/api/sheets/diag")
      if (r.status === 401 || r.status === 403) return { level: "restricted" }
      if (r.body.ok === true) return { level: "live" }
      return { level: "off" }
    },
  },
]

const GROUPS = ["Channels", "Payments", "Shipping", "Suppliers", "Other"]

export function IntegrationsPanel() {
  const [results, setResults] = useState<Record<string, Result>>(
    Object.fromEntries(INTEGRATIONS.map((i) => [i.key, { level: "checking" as Level }]))
  )
  const [checking, setChecking] = useState(false)

  const runChecks = useCallback(() => {
    setChecking(true)
    setResults(Object.fromEntries(INTEGRATIONS.map((i) => [i.key, { level: "checking" as Level }])))
    Promise.all(
      INTEGRATIONS.map(async (i) => {
        try {
          const res = await i.check()
          setResults((prev) => ({ ...prev, [i.key]: res }))
        } catch {
          setResults((prev) => ({ ...prev, [i.key]: { level: "error" } }))
        }
      })
    ).finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    const id = setTimeout(runChecks, 0)
    return () => clearTimeout(id)
  }, [runChecks])

  return (
    <SectionCard
      title="Integrations"
      description="Live status of every server credential. Keys are set in the server .env."
      actions={
        <Button size="sm" variant="outline" onClick={runChecks} disabled={checking}>
          <ArrowsClockwise size={14} weight="bold" className={checking ? "animate-spin" : ""} />
          {checking ? "Checking…" : "Recheck all"}
        </Button>
      }
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck size={14} weight="fill" className="text-emerald-600" />
        Read-only. Swap a key by updating the server <code className="font-mono">.env</code> — status here reflects it on the next recheck.
      </div>

      <div className="space-y-6 p-5">
        {GROUPS.map((group) => {
          const items = INTEGRATIONS.filter((i) => i.group === group)
          if (!items.length) return null
          return (
            <div key={group}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((i) => {
                  const res = results[i.key] ?? { level: "checking" as Level }
                  const meta = LEVEL_META[res.level]
                  return (
                    <div key={i.key} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{i.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{i.blurb}</div>
                        </div>
                        <span className={"inline-flex shrink-0 items-center gap-1.5 text-xs font-medium " + meta.text}>
                          <span className={"size-2 rounded-full " + meta.dot} />
                          {meta.label}
                        </span>
                      </div>
                      {res.detail && (
                        <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={res.detail}>
                          {res.detail}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowsClockwise, ShieldCheck, Sparkle, Check, PencilSimple, X, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, ApiError, getAdminSecrets, setAdminSecret, getAiConfig, setAiConfig, testAiKey, type SecretMeta, type AiConfig } from "@/lib/api"

// One integration credential row — read-only status, plus inline edit for whitelisted
// secrets (saved to the DB and to process.env live). Whether a change takes effect
// immediately depends on the route: those reading process.env at call time pick it up on
// the next request; any still snapshotting it into a module-level const need a restart.
function SecretRow({ s, onSaved }: { s: SecretMeta; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async (clear = false) => {
    setBusy(true)
    try { await setAdminSecret(s.name, clear ? "" : val.trim()); setEditing(false); setVal(""); onSaved() } catch {} finally { setBusy(false) }
  }
  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-28 shrink-0 truncate text-[13px] text-muted-foreground">{s.label}</span>
        <Input type="password" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Paste new value" className="h-8 flex-1 font-mono text-[13px]" autoFocus />
        <Button size="sm" className="h-7 px-2" disabled={busy || !val.trim()} onClick={() => save(false)}>{busy ? <CircleNotch size={12} className="animate-spin" /> : <Check size={12} weight="bold" />}</Button>
        {s.set && <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-red-600" title="Clear" disabled={busy} onClick={() => save(true)}>Clear</Button>}
        <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => { setEditing(false); setVal("") }}><X size={12} /></Button>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-2 text-[13px]">
      <span className="text-muted-foreground">{s.label}</span>
      <span className="flex items-center gap-1.5 font-mono">
        {s.set ? <span className="text-foreground">{s.masked || `••••${s.last4 ?? ""}`}</span> : <span className="text-muted-foreground">not set</span>}
        {s.editable && (
          <button onClick={() => setEditing(true)} className="text-muted-foreground transition-colors hover:text-primary" title={s.set ? "Replace" : "Set"} aria-label="Edit credential">
            <PencilSimple size={12} />
          </button>
        )}
      </span>
    </div>
  )
}

type Level = "live" | "configured" | "off" | "error" | "restricted" | "checking"
type Result = { level: Level; detail?: string }

// Two states that matter at a glance: Active (a working/installed credential, green) or
// Inactive (grey). "live" (test-verified) and "configured" (key present) both read as
// Active — the purple "Configured" vs green "Live" split just looked like two things.
const LEVEL_META: Record<Level, { label: string; dot: string; text: string }> = {
  live: { label: "Active", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  configured: { label: "Active", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  off: { label: "Inactive", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
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
  // Show the key's MODE when the endpoint reports one. For a payment key that's the
  // difference between a sandbox and real customer charges, and the key itself is masked.
  const mode = t.body && typeof t.body.mode === "string" ? String(t.body.mode) : undefined
  if (t.body.ok === true) return { level: "live", detail: mode }
  return { level: "error", detail: [mode, String(t.body.error ?? "test failed")].filter(Boolean).join(" · ") }
}

// /api/ads/config reports both channels at once; pick the one this card is for.
const adsCheck = (channel: "meta" | "google") => async (): Promise<Result> => {
  const r = await raw("/api/ads/config")
  if (r.status === 401 || r.status === 403) return { level: "restricted" }
  if (!r.ok) return { level: "error", detail: `HTTP ${r.status || "—"}` }
  const b = r.body as { meta?: { enabled?: boolean }; google?: { enabled?: boolean } } | null
  return b?.[channel]?.enabled ? { level: "configured" } : { level: "off" }
}

/**
 * Status for ONE shipping provider. They used to share a row, which meant an
 * unconfigured EasyPost dragged the row to "error" and buried whether Shippo actually
 * worked — exactly the thing you check this page for.
 *
 * NB the match is `startsWith("ok")`, not `=== "ok"`: the endpoint reports mode as
 * "ok (test)" / "ok (live)", so an equality check would read a healthy key as broken.
 */
function shippingProvider(which: "shippo" | "easypost") {
  return async () => {
    const r = await raw("/api/shipping/test")
    if (r.status === 401 || r.status === 403) return { level: "restricted" as const }
    if (!r.ok) return { level: "error" as const, detail: `HTTP ${r.status || "—"}` }
    const v = String((r.body as Record<string, unknown>)?.[which] ?? "")
    if (!v || /^no (key|token)$/i.test(v)) return { level: "off" as const, detail: "no key set" }
    if (v.startsWith("ok")) return { level: "live" as const, detail: v.replace(/^ok\s*/, "").replace(/[()]/g, "") || undefined }
    return { level: "error" as const, detail: v }
  }
}

const INTEGRATIONS: Integration[] = [
  // Channels
  { key: "etsy", name: "Etsy", blurb: "Order sync + tracking", group: "Channels", check: configOnly("/api/etsy/config") },
  { key: "shopify", name: "Shopify", blurb: "Storefront orders", group: "Channels", check: configOnly("/api/shopify/config") },
  { key: "tiktok", name: "TikTok Shop", blurb: "Marketplace orders", group: "Channels", check: configOnly("/api/tiktok/config") },
  // Ads — key must match the server's SECRET_DEFS `integration` value, which is what
  // joins the secret rows onto the card.
  { key: "meta_ads", name: "Meta Ads", blurb: "Facebook + Instagram campaigns", group: "Ads", check: adsCheck("meta") },
  { key: "google_ads", name: "Google Ads", blurb: "Search + Shopping campaigns", group: "Ads", check: adsCheck("google") },
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
    key: "shippo", name: "Shippo", blurb: "Labels + rates", group: "Shipping",
    check: shippingProvider("shippo"),
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
  // Status via config only — a live EWA round-trip runs behind the Digitizer's "Test
  // connection" button, not on every Settings load. `key` must match the server's
  // SECRET_DEFS `integration` value so the WILCOM_APP_ID/KEY edit fields attach here.
  {
    key: "wilcom", name: "Wilcom EWA", blurb: "Embroidery digitizing engine", group: "Embroidery",
    check: configThenTest("/api/wilcom/config", "/api/wilcom/test", "configured"),
  },
]

const GROUPS = ["Channels", "Ads", "Payments", "Shipping", "Suppliers", "Embroidery", "Other"]

export function IntegrationsPanel() {
  const [results, setResults] = useState<Record<string, Result>>(
    Object.fromEntries(INTEGRATIONS.map((i) => [i.key, { level: "checking" as Level }]))
  )
  const [secrets, setSecrets] = useState<Record<string, SecretMeta[]>>({})
  const [checking, setChecking] = useState(false)

  // Re-fetch just the secret metadata (after an edit) — no full integration recheck.
  const reloadSecrets = useCallback(() => {
    getAdminSecrets()
      .then((r) => {
        const byI: Record<string, SecretMeta[]> = {}
        for (const s of r.secrets) (byI[s.integration] ??= []).push(s)
        setSecrets(byI)
      })
      .catch(() => {})
  }, [])

  // Re-check ONE integration (the per-card refresh) — re-runs its status check and its
  // secrets, without disturbing the others. The card shows "Checking…" while it runs.
  const recheckOne = useCallback(async (i: Integration) => {
    setResults((prev) => ({ ...prev, [i.key]: { level: "checking" } }))
    try { const res = await i.check(); setResults((prev) => ({ ...prev, [i.key]: res })) }
    catch { setResults((prev) => ({ ...prev, [i.key]: { level: "error" } })) }
    reloadSecrets()
  }, [reloadSecrets])

  const runChecks = useCallback(() => {
    setChecking(true)
    setResults(Object.fromEntries(INTEGRATIONS.map((i) => [i.key, { level: "checking" as Level }])))
    getAdminSecrets()
      .then((r) => {
        const byI: Record<string, SecretMeta[]> = {}
        for (const s of r.secrets) (byI[s.integration] ??= []).push(s)
        setSecrets(byI)
      })
      .catch(() => setSecrets({}))
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
      {/* The one editable credential — the AI assistant key + model. */}
      <div className="border-b border-border p-5">
        <AiAssistantCard />
      </div>

      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck size={14} weight="fill" className="text-emerald-600" />
        Click the <PencilSimple size={11} className="inline" /> to set or replace a credential — it&apos;s saved to
        the database and used straight away. Shipping and payment keys take effect on the next request; a few
        integrations still read their credential once at boot and need a server restart to pick up a change.
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
                          <div className="truncate text-[13px] text-muted-foreground">{i.blurb}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={"inline-flex items-center gap-1.5 text-[13px] font-medium " + meta.text}>
                            <span className={"size-2 rounded-full " + meta.dot} />
                            {meta.label}
                          </span>
                          <button
                            onClick={() => recheckOne(i)}
                            disabled={res.level === "checking"}
                            title={`Refresh ${i.name}`}
                            aria-label={`Refresh ${i.name}`}
                            className="text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                          >
                            <ArrowsClockwise size={13} weight="bold" className={res.level === "checking" ? "animate-spin" : ""} />
                          </button>
                        </div>
                      </div>
                      {res.detail && (
                        <div className="mt-2 truncate font-mono text-[12px] text-muted-foreground" title={res.detail}>
                          {res.detail}
                        </div>
                      )}
                      {(secrets[i.key] ?? []).length > 0 && (
                        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                          {(secrets[i.key] ?? []).map((s) => (
                            <SecretRow key={s.name} s={s} onSaved={reloadSecrets} />
                          ))}
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

// ── AI Assistant (Claude) — the one editable credential + model selector ──────
function AiAssistantCard() {
  const [cfg, setCfg] = useState<AiConfig | null>(null)
  const [keyInput, setKeyInput] = useState("")
  const [editingKey, setEditingKey] = useState(false)
  const [model, setModel] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const load = useCallback(() => {
    getAiConfig()
      .then((c) => { setCfg(c); setModel(c.model ?? "") })
      .catch(() => setCfg({ models: [] }))
  }, [])
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  const dirty = !!keyInput.trim() || (!!cfg && model !== (cfg.model ?? ""))
  const save = async () => {
    setSaving(true); setErr(null); setSaved(false)
    try {
      const r = await setAiConfig({ key: keyInput.trim() || undefined, model: model || undefined })
      if (r.error) throw new Error(r.error)
      setCfg((prev) => ({ ...(prev ?? {}), ...r }))
      setKeyInput("")
      setEditingKey(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save. Admin only.")
    } finally {
      setSaving(false)
    }
  }
  const removeKey = async () => {
    setSaving(true); setErr(null)
    try {
      const r = await setAiConfig({ clearKey: true })
      setCfg((prev) => ({ ...(prev ?? {}), ...r }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't remove the key.")
    } finally {
      setSaving(false)
    }
  }
  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const typed = keyInput.trim()
      const r = await testAiKey(typed || undefined)
      setTestResult(r.ok
        ? { ok: true, msg: `${typed ? "Pasted key works" : "Working"} — ${r.model} replied.` }
        : { ok: false, msg: r.error || "Failed" })
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : "Test failed" })
    } finally {
      setTesting(false)
    }
  }

  const models = cfg?.models ?? []
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkle size={16} weight="fill" />
          </span>
          <div>
            <div className="font-semibold">AI Assistant (Claude)</div>
            <div className="text-xs text-muted-foreground">Powers the account-aware auto-reply in seller Support chat.</div>
          </div>
        </div>
        <span className={"shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium " + (cfg?.keySet ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
          {cfg?.keySet ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Anthropic API key</span>
          {/* Key shown next to its input, not up in the status chip. The input stays hidden
              behind "Replace" so you don't accidentally overwrite a working key. */}
          {cfg?.keySet && !editingKey ? (
            <div className="flex h-9 items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3">
              <span className="flex-1 truncate font-mono text-xs text-foreground">{cfg.masked || `••••${cfg.last4 ?? ""}`}</span>
              {cfg.fromEnv
                ? <span className="shrink-0 text-[11px] text-muted-foreground">from env</span>
                : <button type="button" onClick={() => setEditingKey(true)} className="shrink-0 text-xs font-medium text-primary hover:underline">Replace</button>}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={keyInput}
                onChange={(e) => { setKeyInput(e.target.value); setSaved(false) }}
                placeholder="sk-ant-…"
                className="flex-1 font-mono text-xs"
                autoFocus={editingKey}
              />
              {editingKey && <button type="button" onClick={() => { setEditingKey(false); setKeyInput("") }} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">Cancel</button>}
            </div>
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Model</span>
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); setSaved(false) }}
            className="eg-select h-9 rounded-2xl border border-border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 transition-colors hover:border-primary/40 focus-visible:outline-none"
          >
            {models.length === 0 && <option value={model}>{model || "—"}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      {err && <div className="mt-2 text-sm text-destructive">{err}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</Button>
        {cfg?.keySet && (
          <Button size="sm" variant="outline" onClick={test} disabled={testing}>{testing ? "Testing…" : "Test key"}</Button>
        )}
        {cfg?.keySet && !cfg.fromEnv && (
          <Button size="sm" variant="outline" onClick={removeKey} disabled={saving}>Remove key</Button>
        )}
        {saved && <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check size={14} weight="bold" /> Saved</span>}
      </div>
      {testResult && (
        <div className={"mt-2 text-sm " + (testResult.ok ? "text-emerald-600" : "text-destructive")}>
          {testResult.ok ? "✓ " : "✗ "}{testResult.msg}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">A saved key overrides the server env. Haiku 4.5 runs about a fifth of a cent per question. Admin only.</p>
    </div>
  )
}

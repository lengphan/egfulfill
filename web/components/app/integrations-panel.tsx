"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowsClockwise, Sparkle, Check, PencilSimple, X, CircleNotch, Warning, ImageSquare } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { PanelPicker, type PickerOption } from "@/components/app/panel-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, ApiError, getAdminSecrets, setAdminSecret, getAiConfig, setAiConfig, testAiKey, getImageAiConfig, setImageAiConfig, testImageAiKey, type SecretMeta, type AiConfig, type ImageAiConfig } from "@/lib/api"

// One integration credential row — read-only status, plus inline edit for whitelisted
// secrets (saved to the DB and to process.env live). Whether a change takes effect
// immediately depends on the route: those reading process.env at call time pick it up on
// the next request; any still snapshotting it into a module-level const need a restart.
/**
 * A setting that is NOT a secret renders as what it is.
 *
 * Every row here went through one masked-password control, which made the USPS switch
 * unreadable: choosing the live host meant typing a URL you could not see into a field of
 * dots, and turning "buy direct" on left a row reading `••••••1`. A yes/no is a checkbox, a
 * fixed pair of hosts is a choice, and an identifier is a plain field you can read back.
 */
function PlainSettingRow({ s, onSaved }: { s: SecretMeta; onSaved: () => void }) {
 const [busy, setBusy] = useState(false)
 const [draft, setDraft] = useState(s.value ?? "")
 const [editing, setEditing] = useState(false)
 const commit = async (v: string) => {
 setBusy(true)
 try { await setAdminSecret(s.name, v); setEditing(false); onSaved() } catch {} finally { setBusy(false) }
  }

 if (s.kind === "toggle") {
 const on = !!s.value && s.value !== "0" && s.value.toLowerCase() !== "false"
 return (
      <label className="flex items-center justify-between gap-3 py-0.5 text-sm">
        <span className="text-muted-foreground">{s.label}</span>
        <span className="flex items-center gap-2">
          {busy && <CircleNotch size={12} className="animate-spin text-muted-foreground" />}
          <input
 type="checkbox" checked={on} disabled={busy || !s.editable}
 onChange={(e) => commit(e.target.checked ? "1" : "")}
 className="size-4 shrink-0 accent-primary"
          />
        </span>
      </label>
    )
  }

 if (s.kind === "choice") {
 return (
      <div className="space-y-1.5 py-0.5">
        <span className="text-sm text-muted-foreground">{s.label}</span>
        <div className="flex flex-col gap-1">
          {(s.options ?? []).map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
 type="radio" name={s.name} checked={s.value === o.value} disabled={busy || !s.editable}
 onChange={() => commit(o.value)} className="size-3.5 shrink-0 accent-primary"
              />
              <span className={s.value === o.value ? "text-foreground" : "text-muted-foreground"}>{o.label}</span>
            </label>
          ))}
        </div>
      </div>
    )
  }

  // Plain text — readable, because an identifier you cannot read is one you cannot check.
 return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{s.label}</span>
      {editing ? (
        <span className="flex flex-1 items-center gap-1.5">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 flex-1 text-sm" autoFocus />
          <Button size="sm" className="h-7 px-2" disabled={busy} onClick={() => commit(draft.trim())}>
            {busy ? <CircleNotch size={12} className="animate-spin" /> : <Check size={12} weight="bold" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => { setEditing(false); setDraft(s.value ?? "") }}><X size={12} /></Button>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className={s.value ? "text-foreground" : "text-muted-foreground"}>{s.value || "not set"}</span>
          {s.editable && (
            <button onClick={() => { setDraft(s.value ?? ""); setEditing(true) }} className="text-muted-foreground transition-colors hover:text-primary" aria-label={`Edit ${s.label}`}>
              <PencilSimple size={12} />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

function SecretRow({ s, onSaved }: { s: SecretMeta; onSaved: () => void }) {
 const [editing, setEditing] = useState(false)
 const [val, setVal] = useState("")
 const [busy, setBusy] = useState(false)
  // Saved, but the module using it snapshotted process.env at import — so the masked
  // preview above already shows the new key while the integration is still calling with
  // the old one. Without this line the panel looked like proof the change had landed.
 const [pending, setPending] = useState(false)
 const save = async (clear = false) => {
 setBusy(true)
 try {
 const r = await setAdminSecret(s.name, clear ? "" : val.trim())
 setEditing(false); setVal("")
 setPending(!!r.restartRequired)
 onSaved()
    } catch {} finally { setBusy(false) }
  }
 if (editing) {
 return (
      <div className="flex items-center gap-1.5">
        <span className="w-28 shrink-0 truncate text-sm text-muted-foreground">{s.label}</span>
        <Input type="password" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Paste new value" className="h-8 flex-1 font-mono text-sm" autoFocus />
        <Button size="sm" className="h-7 px-2" disabled={busy || !val.trim()} onClick={() => save(false)}>{busy ? <CircleNotch size={12} className="animate-spin" /> : <Check size={12} weight="bold" />}</Button>
        {s.set && <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-alert" title="Clear" disabled={busy} onClick={() => save(true)}>Clear</Button>}
        <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => { setEditing(false); setVal("") }}><X size={12} /></Button>
      </div>
    )
  }
 return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
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
      {pending && (
        <div className="flex items-start gap-1.5 rounded-md bg-hold/10 px-2 py-1 text-2xs text-hold">
          <Warning size={11} weight="fill" className="mt-0.5 shrink-0" />
          <span>Saved, but not in use yet — this one is read when the API starts. Restart it, then this row is what&apos;s live.</span>
        </div>
      )}
    </div>
  )
}

type Level = "live" | "configured" | "off" | "error" | "restricted" | "checking"
type Result = { level: Level; detail?: string }

// Two states that matter at a glance: Active (a working/installed credential, green) or
// Inactive (grey). "live" (test-verified) and "configured" (key present) both read as
// Active — the purple "Configured" vs green "Live" split just looked like two things.
// A solid tinted pill per status — no coloured dot.
const LEVEL_META: Record<Level, { label: string; pill: string }> = {
 live: { label: "Active", pill: "bg-shipped/12 text-shipped" },
 configured: { label: "Active", pill: "bg-shipped/12 text-shipped" },
 off: { label: "Inactive", pill: "bg-muted text-muted-foreground" },
 error: { label: "Error", pill: "bg-alert/12 text-alert" },
 restricted: { label: "Staff only", pill: "bg-hold/15 text-hold" },
 checking: { label: "Checking…", pill: "bg-muted text-muted-foreground animate-pulse" },
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
  Object.values(o ?? {}).some((v) => typeof v === "string" && /fail|error/i.test(v))

// One check per integration. Kept declarative so a "swap key" editor can attach later.
type Integration = {
 key: string
 name: string
 blurb: string
 group: string
 check: () => Promise<Result>
  // Optional on-demand live call (e.g. a supplier whose status is config-only because the
  // real call is slow or gated behind an IP whitelist). Renders a "Test connection" button.
 test?: { path: string; okMsg: (b: Record<string, unknown>) => string }
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
  {
    // SanMar authenticates with a customer number + web username + password (no API key),
    // and only answers whitelisted IPs — so "configured" here means the creds are set, not
    // that SanMar has whitelisted us yet.
 key: "sanmar", name: "SanMar", blurb: "Apparel blanks + orders", group: "Suppliers",
 check: async () => {
 const r = await raw("/api/sanmar/status")
 if (r.status === 401 || r.status === 403) return { level: "restricted" }
 if (!r.ok) return { level: "error", detail: `HTTP ${r.status || "—"}` }
 return r.body.configured ? { level: "configured", detail: r.body.stage ? "stage" : "live" } : { level: "off" }
    },
    // Status is config-only (creds present) because a real SanMar call needs their IP
    // whitelist — the Test button makes the actual call so you can confirm that step.
 test: { path: "/api/sanmar/test", okMsg: (b) => `Reached SanMar — priced ${b.priced_variants ?? 0} variant(s) for ${b.style ?? "PC61"}.` },
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
  // WILCOM EWA REMOVED (2026-08-24). The card went with the credential: the owner does not
  // use the digitizing engine, the key was deleted from app_secrets, and WILCOM_APP_ID/KEY
  // came off the secrets allow-list so nothing can write them back. A card whose whole job
  // is reporting "key present" has nothing left to report, and one that offered to add a key
  // again would undo the point of removing it.
  // Alibaba was the one integration with no card here, so its app key and secret could only
  // be rotated by editing the .env on the box and restarting. `key` must match the server's
  // SECRET_DEFS `integration` value or the edit fields attach to nothing.
  //
  // configOnly reports whether the KEYS are present — not whether the OAuth token is still
  // valid. Those are different facts and this panel is about credentials; the connection
  // itself is on the Sourcing page.
  {
 key: "alibaba", name: "Alibaba", blurb: "Supplier sourcing + buyer search", group: "Suppliers",
 check: configOnly("/api/alibaba/config", "configured"),
  },
  // byeastside and Pink Design had SECRETS but no cards at all, so four keys were configured
  // on the server and editable nowhere — the same failure as Shippo, found by the orphan
  // guard rather than by anyone noticing. They are real partners, so they get real cards
  // rather than being hung off someone else's.
  {
 key: "dispatch", name: "byeastside", blurb: "Label pre-scan + dispatch", group: "Shipping",
 check: configOnly("/api/dispatch/status", "configured"),
  },
  {
 key: "pinkdesign", name: "Pink Design", blurb: "Outsourced digitizing", group: "Embroidery",
 check: configOnly("/api/pinkdesign/status", "configured"),
  },
]

const GROUPS = ["Channels", "Ads", "Payments", "Shipping", "Suppliers", "Embroidery", "Other"]

/** The AI card is picked from the same control as the rest, so it needs a key of its own
 * that can never collide with an integration's. */
const AI_KEY = "__ai"
// A SECOND assistant credential, not a variant of the first: different provider, different
// job (pictures, not words), and it bills per render rather than per question. Sharing one
// card would imply a single key covers both, which is exactly the confusion to avoid.
const IMAGE_KEY = "__img"

/**
 * The one word that goes in the option label. This is the whole point of the screen: a
 * closed picker has to answer "is anything wrong, and are my keys the live ones" without
 * being opened.
 *
 * `detail` wins for a working service because it is the more specific fact — Shippo's is
 * "test" vs "live", which is the difference between a label that ships and one that
 * doesn't, and "connected" would hide it.
 */
function statusText(r: Result): string {
 switch (r.level) {
 case "checking": return "checking…"
 case "restricted": return "staff only"
 case "error": return "reconnect"
 case "off": return "not set"
 default: return r.detail || "connected"
  }
}

export function IntegrationsPanel() {
 const [results, setResults] = useState<Record<string, Result>>(
    Object.fromEntries(INTEGRATIONS.map((i) => [i.key, { level: "checking" as Level }]))
  )
 const [secrets, setSecrets] = useState<Record<string, SecretMeta[]>>({})
 const [checking, setChecking] = useState(false)
  // Per-row on-demand test (only rows with a `test` config use it).
 const [tests, setTests] = useState<Record<string, { running?: boolean; result?: { ok: boolean; msg: string } }>>({})
 const runTest = useCallback(async (i: Integration) => {
 if (!i.test) return
 setTests((p) => ({ ...p, [i.key]: { running: true } }))
 const r = await raw(i.test.path)
 const ok = r.ok && r.body.ok === true
 const msg = ok
      ? i.test.okMsg(r.body)
 : String(r.body.error ?? (r.status ? `HTTP ${r.status}` : "Couldn't reach it — if this is a timeout, the server IP isn't whitelisted yet."))
 setTests((p) => ({ ...p, [i.key]: { result: { ok, msg } } }))
  }, [])
  // A light copy of the AI config, just for the collapsed Claude row's summary (model +
  // whether a key is set). The editable card below fetches its own.
 const [aiCfg, setAiCfg] = useState<AiConfig | null>(null)
 useEffect(() => { const id = setTimeout(() => { getAiConfig().then(setAiCfg).catch(() => {}) }, 0); return () => clearTimeout(id) }, [])
  // Same again for the image key — the collapsed row's summary only.
 const [imgCfg, setImgCfg] = useState<ImageAiConfig | null>(null)
 useEffect(() => { const id = setTimeout(() => { getImageAiConfig().then(setImgCfg).catch(() => {}) }, 0); return () => clearTimeout(id) }, [])

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

  // Which service the single panel below is showing.
 const [sel, setSel] = useState<string>(AI_KEY)

  // The friendly model name, not the id — "Haiku 4.5", the same words the Model select
  // below shows. A raw `claude-haiku-4-5-20251001` in the option label is a date and a
  // version number where a state word belongs.
 const aiModelLabel = aiCfg?.models?.find((m) => m.id === aiCfg.model)?.label || aiCfg?.model
 const aiStatus = aiCfg == null ? "checking…" : (aiCfg.keySet || aiCfg.fromEnv ? (aiModelLabel || "key set") : "no key")
  // A key alone isn't enough here — a generated image has to be STORED, so object storage
  // being off is a distinct half-working state and the row says so rather than "key set".
 const imgModelLabel = imgCfg?.models?.find((m) => m.id === imgCfg.model)?.label || imgCfg?.model
 const imgStatus = imgCfg == null ? "checking…"
 : !(imgCfg.keySet || imgCfg.fromEnv) ? "no key"
 : imgCfg.storageReady === false ? "no storage"
 : (imgModelLabel || "key set")
  // Ordered by GROUPS rather than by the INTEGRATIONS array — that array is append-order
  // (byeastside is Shipping but sits last), and the picker's headings should read in the
  // order the groups were designed in.
 const options: PickerOption[] = [
    { value: AI_KEY, label: "AI Assistant (Claude)", group: "Assistant", status: aiStatus },
    { value: IMAGE_KEY, label: "Image AI (Nano Banana)", group: "Assistant", status: imgStatus },
    ...GROUPS.flatMap((g) =>
      INTEGRATIONS.filter((i) => i.group === g).map((i): PickerOption => {
 const res = results[i.key] ?? { level: "checking" as Level }
 return {
 value: i.key,
 label: i.name,
 group: g,
 status: statusText(res),
          // Only a real failure is flagged. "not set" is a normal state for half of these
          // (USPS-direct is deliberately off), and a list that flags everything flags nothing.
 attention: res.level === "error",
        }
      })
    ),
  ]

 const active = INTEGRATIONS.find((i) => i.key === sel)
 const activeRes = active ? results[active.key] ?? { level: "checking" as Level } : null
 const activeMeta = activeRes ? LEVEL_META[activeRes.level] : null

 return (
    <SectionCard
 title="Connected services"
 actions={
        <Button size="sm" variant="outline" onClick={runChecks} disabled={checking}>
          <ArrowsClockwise size={14} weight="bold" className={checking ? "animate-spin" : ""} />
          {checking ? "Checking…" : "Recheck all"}
        </Button>
      }
    >
      {/* The standing "how this panel works" note is gone. It explained two things, and
 each is now said where it matters instead of permanently at the top: a credential
 row shows its own Save control, and a key that needs a restart says so on ITS row
 the moment you save it — which is the only moment that fact is worth knowing.
          A banner that never changes stops being read after the second visit and just
 pushes the actual services further down the page. */}
      <div>
        {/* SECRETS THAT NAME A CARD THAT DOESN'T EXIST.
            Fields attach to a card by matching SECRET_DEFS' `integration` to the card's
            `key`, and a mismatch simply dropped the secret — silently. That is how
            SHIPPO_API_TOKEN ('shipping' vs a 'shippo' card) became uneditable while its card
 still rendered and still showed a value: indistinguishable from a control that
 merely didn't work, on the one key that decides whether labels are test or live.
            Listing the orphans means a secret can never again be unreachable — it is either
 on its card or visibly here. */}
        {(() => {
 const known = new Set(INTEGRATIONS.map((i) => i.key))
 const orphans = Object.entries(secrets).filter(([k]) => !known.has(k))
 if (!orphans.length) return null
 return (
            <div className="border-b border-border bg-hold/10 px-4 py-3">
              <div className="flex items-start gap-2 text-sm">
                <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-hold" />
                <div className="min-w-0">
                  <div className="font-medium">Keys with no integration card</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    These are configured on the server but name a card that doesn&apos;t exist, so
 they can&apos;t be edited here. Point their <code>integration</code> at a real
 card key in <code>SECRET_DEFS</code>.
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-xs">
                    {orphans.map(([k, list]) => (
                      <li key={k}>
                        <span className="font-mono">{k}</span>
                        <span className="text-muted-foreground"> — {list.map((x) => x.name).join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ONE select. Every service is in it, its state is in its label, and exactly one
 panel is open below — instead of 19 collapsed rows that each had to be clicked
 to say one word. */}
        <div className="border-b border-border px-5 py-3">
          <PanelPicker value={sel} onChange={setSel} options={options} label="Choose a connected service" />
        </div>

        {/* The panel. Keyed so switching service resets the panel's own state rather than
 rendering the previous one's for a frame. */}
        <div key={sel} className="px-5 py-4">
          {sel === AI_KEY ? (
            <AiAssistantCard onChanged={() => getAiConfig().then(setAiCfg).catch(() => {})} />
          ) : sel === IMAGE_KEY ? (
            <ImageAiCard onChanged={() => getImageAiConfig().then(setImgCfg).catch(() => {})} />
          ) : active && activeRes && activeMeta ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold">{active.name}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 eg-label text-muted-foreground">{active.group}</span>
                </span>
                <span className={"inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-2xs font-medium " + activeMeta.pill}>
                  {activeMeta.label}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">{active.blurb}</span>
                <span className="flex items-center gap-3">
                  {active.test && (
                    <button
 onClick={() => runTest(active)}
 disabled={tests[active.key]?.running}
 title={`Make a live ${active.name} call`}
 className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline disabled:opacity-50"
                    >
                      {tests[active.key]?.running ? <CircleNotch size={12} className="animate-spin" /> : null} Test connection
                    </button>
                  )}
                  <button
 onClick={() => recheckOne(active)}
 disabled={activeRes.level === "checking"}
 title={`Refresh ${active.name}`}
 className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                  >
                    Recheck
                  </button>
                </span>
              </div>

              {activeRes.detail && (
                <div className="break-all font-mono text-xs text-muted-foreground">{activeRes.detail}</div>
              )}
              {tests[active.key]?.result && (
                <div className={"break-words text-xs " + (tests[active.key]!.result!.ok ? "text-success" : "text-destructive")}>
                  {/* An ICON, not a glyph. ✓/✗ typed into a string render as the operating
                      system's own characters — a different weight and baseline per platform,
                      and nothing the icon set controls. */}
                  {tests[active.key]!.result!.ok ? <Check size={13} weight="bold" className="mr-1 inline shrink-0" /> : <X size={13} weight="bold" className="mr-1 inline shrink-0" />}
                  {tests[active.key]!.result!.msg}
                </div>
              )}
              {(secrets[active.key] ?? []).length > 0 ? (
                <div className="space-y-1.5 border-t border-border pt-3">
                  {(secrets[active.key] ?? []).map((s) => (
 s.kind && s.kind !== "secret"
                      ? <PlainSettingRow key={s.name} s={s} onSaved={reloadSecrets} />
 : <SecretRow key={s.name} s={s} onSaved={reloadSecrets} />
                  ))}
                </div>
              ) : (
                // Says WHICH of the two it is, rather than showing the same blank space for
                // "this service has no editable keys" and "the secrets call failed".
                <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                  {activeRes.level === "restricted"
                    ? "Credentials are admin-only — sign in as an admin to see them."
 : `No editable credentials for ${active.name}. Its keys live in the server env.`}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </SectionCard>
  )
}

// ── AI Assistant (Claude) — the one editable credential + model selector ──────
function AiAssistantCard({ onChanged }: { onChanged?: () => void }) {
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
 onChanged?.()
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
 onChanged?.()
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
    // No border of its own: it sits in the picker's panel, and a bordered card inside a
    // bordered panel reads as two things.
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkle size={18} weight="regular" className="shrink-0 text-primary" />
          <div>
            <div className="font-semibold">AI Assistant (Claude)</div>
            <div className="text-xs text-muted-foreground">Powers the account-aware auto-reply in seller Support chat.</div>
          </div>
        </div>
        <span className={"shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium " + (cfg?.keySet ? "bg-shipped/12 text-shipped" : "bg-muted text-muted-foreground")}>
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
                ? <span className="shrink-0 text-2xs text-muted-foreground">from env</span>
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
 className="eg-select eg-control pr-8"
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
        {saved && <span className="inline-flex items-center gap-1 text-sm text-success"><Check size={14} weight="bold" /> Saved</span>}
      </div>
      {testResult && (
        <div className={"mt-2 text-sm " + (testResult.ok ? "text-success" : "text-destructive")}>
          {testResult.ok ? <Check size={14} weight="bold" className="mr-1 inline shrink-0" /> : <X size={14} weight="bold" className="mr-1 inline shrink-0" />}
          {testResult.msg}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">A saved key overrides the server env. Haiku 4.5 runs about a fifth of a cent per question. Admin only.</p>
    </div>
  )
}

// ── Image AI (Nano Banana) — the Google key behind staff image generation ─────
// Mirrors AiAssistantCard, with two deliberate differences: the model select carries a
// PRICE, and "Test key" warns that it spends money. There is no free ping on an image
// endpoint — a test is a real render — so the button must not read like the Claude one.
function ImageAiCard({ onChanged }: { onChanged?: () => void }) {
 const [cfg, setCfg] = useState<ImageAiConfig | null>(null)
 const [keyInput, setKeyInput] = useState("")
 const [editingKey, setEditingKey] = useState(false)
 const [model, setModel] = useState("")
 const [saving, setSaving] = useState(false)
 const [saved, setSaved] = useState(false)
 const [err, setErr] = useState<string | null>(null)
 const [testing, setTesting] = useState(false)
 const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

 const load = useCallback(() => {
 getImageAiConfig()
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
 const r = await setImageAiConfig({ key: keyInput.trim() || undefined, model: model || undefined })
 if (r.error) throw new Error(r.error)
 setCfg((prev) => ({ ...(prev ?? {}), ...r }))
 setKeyInput(""); setEditingKey(false); setSaved(true)
 onChanged?.()
 setTimeout(() => setSaved(false), 2000)
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't save. Admin only.")
    } finally { setSaving(false) }
  }
 const removeKey = async () => {
 setSaving(true); setErr(null)
 try {
 const r = await setImageAiConfig({ clearKey: true })
 setCfg((prev) => ({ ...(prev ?? {}), ...r }))
 onChanged?.()
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't remove the key.")
    } finally { setSaving(false) }
  }
 const test = async () => {
 setTesting(true); setTestResult(null)
 try {
 const typed = keyInput.trim()
 const r = await testImageAiKey(typed || undefined)
 setTestResult(r.ok
        ? { ok: true, msg: `${typed ? "Pasted key works" : "Working"} — rendered ${Math.round((r.bytes ?? 0) / 1024)}KB. ${r.costNote ?? ""}`.trim() }
 : { ok: false, msg: r.error || "Failed" })
    } catch (e) {
 setTestResult({ ok: false, msg: e instanceof Error ? e.message : "Test failed" })
    } finally { setTesting(false) }
  }

 const models = cfg?.models ?? []
 const spec = models.find((m) => m.id === model)
 const active = !!(cfg?.keySet || cfg?.fromEnv)
 return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ImageSquare size={18} weight="regular" className="shrink-0 text-primary" />
          <div>
            <div className="font-semibold">Image AI (Nano Banana)</div>
            <div className="text-xs text-muted-foreground">Product images from a prompt, in staff&rsquo;s own My EG chat. Not offered to sellers.</div>
          </div>
        </div>
        <span className={"shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium " + (active ? "bg-shipped/12 text-shipped" : "bg-muted text-muted-foreground")}>
          {active ? "Active" : "Inactive"}
        </span>
      </div>

      {/* A key with no bucket behind it is half-configured, and the failure would only
 appear at the moment someone spends money on a render. Say it up front. */}
      {active && cfg?.storageReady === false && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-hold/10 p-2 text-xs text-hold">
          <Warning size={14} className="mt-0.5 shrink-0" />
          <span>The key is set, but object storage isn&rsquo;t configured — a generated image couldn&rsquo;t be kept, so generation stays off.</span>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Google AI API key</span>
          {cfg?.keySet && !editingKey ? (
            <div className="flex h-9 items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3">
              <span className="flex-1 truncate font-mono text-xs text-foreground">{cfg.masked || `••••${cfg.last4 ?? ""}`}</span>
              {cfg.fromEnv
                ? <span className="shrink-0 text-2xs text-muted-foreground">from env</span>
 : <button type="button" onClick={() => setEditingKey(true)} className="shrink-0 text-xs font-medium text-primary hover:underline">Replace</button>}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
 type="password" value={keyInput}
 onChange={(e) => { setKeyInput(e.target.value); setSaved(false) }}
 placeholder="AIza…" className="flex-1 font-mono text-xs" autoFocus={editingKey}
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
 className="eg-select eg-control pr-8"
          >
            {models.length === 0 && <option value={model}>{model || "—"}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label} — ${m.usd[m.defaultSize]?.toFixed(3)}/image</option>
            ))}
          </select>
        </label>
      </div>

      {spec && <p className="mt-2 text-xs leading-snug text-muted-foreground">{spec.note}</p>}
      {cfg?.staleModel && (
        <p className="mt-1 text-xs text-hold">
          The saved model <span className="font-mono">{cfg.staleModel}</span> is no longer offered — using {model} until you pick one.
        </p>
      )}

      {err && <div className="mt-2 text-sm text-destructive">{err}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</Button>
        {(cfg?.keySet || keyInput.trim()) && (
          // Says what it costs, because unlike the Claude test this one spends money.
          <Button size="sm" variant="outline" onClick={test} disabled={testing}>{testing ? "Rendering…" : "Test key (~$0.03)"}</Button>
        )}
        {cfg?.keySet && !cfg.fromEnv && (
          <Button size="sm" variant="outline" onClick={removeKey} disabled={saving}>Remove key</Button>
        )}
        {saved && <span className="inline-flex items-center gap-1 text-sm text-success"><Check size={14} weight="bold" /> Saved</span>}
      </div>
      {testResult && (
        <div className={"mt-2 text-sm " + (testResult.ok ? "text-success" : "text-destructive")}>
          {testResult.ok ? <Check size={14} weight="bold" className="mr-1 inline shrink-0" /> : <X size={14} weight="bold" className="mr-1 inline shrink-0" />}
          {testResult.msg}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        A saved key overrides the server env. Get one from Google AI Studio. Testing renders a real image, so it costs about 3&cent;. Admin only.
      </p>
    </div>
  )
}

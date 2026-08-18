"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, Trash, CircleNotch, Copy, Check, Warning, ClockCounterClockwise, CheckCircle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getWebhooks, createWebhook, deleteWebhook, testWebhook, getWebhookDeliveries,
  WEBHOOK_EVENTS, type WebhookEndpoint, type WebhookDelivery, type WebhookTestResult,
} from "@/lib/api"

const when = (s?: string) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/** A delivery's outcome, said plainly. A bare status code doesn't tell you what to do. */
function outcomeOf(d: WebhookDelivery) {
  if (d.status_code && d.status_code >= 200 && d.status_code < 300) return { tone: "ok", text: `${d.status_code} delivered` }
  if (d.status_code) return { tone: "bad", text: `${d.status_code} rejected` }
  return { tone: "bad", text: d.error ? "no response" : "failed" }
}

/**
 * Register and test outbound webhooks without a terminal.
 *
 * Every action here was previously a curl command with a hand-substituted id and key —
 * which is exactly how you end up POSTing to https://webhook.site/YOUR-UUID and testing
 * endpoint "ID". The list knows its own ids, so nothing has to be typed twice.
 */
export function WebhooksPanel() {
  const [rows, setRows] = useState<WebhookEndpoint[] | null>(null)
  const [url, setUrl] = useState("")
  const [events, setEvents] = useState<string[]>([...WEBHOOK_EVENTS])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Shown once, never retrievable — so it stays on screen until dismissed rather than
  // disappearing with a toast.
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [tested, setTested] = useState<Record<number, WebhookTestResult>>({})
  const [log, setLog] = useState<{ id: number; rows: WebhookDelivery[] | null } | null>(null)

  const load = useCallback(() => {
    getWebhooks().then((r) => setRows(r ?? [])).catch(() => setRows([]))
  }, [])
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  const add = async () => {
    const u = url.trim()
    if (!u) { setErr("Paste the URL that should receive events."); return }
    setBusy("add"); setErr(null); setSecret(null)
    try {
      const r = await createWebhook(u, events)
      if (r.error) throw new Error(r.error)
      setSecret(r.secret)
      setUrl("")
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add that endpoint.")
    } finally { setBusy(null) }
  }

  const fire = async (id: number) => {
    setBusy(`test:${id}`)
    try {
      const r = await testWebhook(id)
      setTested((p) => ({ ...p, [id]: r }))
    } catch (e) {
      setTested((p) => ({ ...p, [id]: { ok: false, error: e instanceof Error ? e.message : "Request failed" } }))
    } finally { setBusy(null) }
  }

  const remove = async (id: number) => {
    setBusy(`del:${id}`)
    setRows((p) => (p ?? []).filter((x) => x.id !== id))
    try { await deleteWebhook(id) } catch { load() } finally { setBusy(null) }
  }

  const openLog = async (id: number) => {
    if (log?.id === id) { setLog(null); return }
    setLog({ id, rows: null })
    try { setLog({ id, rows: (await getWebhookDeliveries(id)) ?? [] }) } catch { setLog({ id, rows: [] }) }
  }

  const toggle = (e: string) =>
    setEvents((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e]))

  const list = rows ?? []

  return (
    <SectionCard
      title="Webhooks"
    >
      <div className="space-y-4 p-5">
        {/* One-time secret. Loud on purpose: there is no second chance to read it. */}
        {secret && (
          <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Warning size={15} weight="fill" className="text-primary" /> Copy this secret now — it is never shown again
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">{secret}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { navigator.clipboard?.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              >
                {copied ? <><Check size={13} weight="bold" /> Copied</> : <><Copy size={13} weight="bold" /> Copy</>}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>Done</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Verify each delivery by computing HMAC-SHA256 over the <strong>raw</strong> request body with this secret
              and comparing it to the <code className="font-mono">X-EG-Signature</code> header.
            </p>
          </div>
        )}

        {/* Add */}
        <div className="space-y-2 rounded-lg border border-border p-4">
          <div className="text-sm font-medium">Add an endpoint</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.example.com/hooks/egful"
              className="flex-1"
            />
            <Button onClick={add} disabled={busy === "add"}>
              {busy === "add" ? <CircleNotch size={14} className="animate-spin" /> : <Plus size={14} weight="bold" />} Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {WEBHOOK_EVENTS.map((e) => {
              const on = events.includes(e)
              return (
                <button
                  key={e}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(e)}
                  className={
                    "rounded border px-2 py-0.5 font-mono text-2xs transition-colors " +
                    (on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:border-primary/40")
                  }
                >
                  {e}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Must be public <strong>https</strong> — localhost and private addresses are refused. Testing locally? Use an ngrok or Cloudflare tunnel.
          </p>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>

        {/* List */}
        {rows === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <CircleNotch size={15} className="animate-spin" /> Loading…
          </div>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No endpoints yet. Add one above, then send a test event to check your wiring.
          </p>
        ) : (
          <div className="space-y-2">
            {list.map((w) => {
              const t = tested[w.id]
              return (
                <div key={w.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">#{w.id}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{w.url}</span>
                    <Button size="sm" variant="outline" onClick={() => fire(w.id)} disabled={busy === `test:${w.id}`}>
                      {busy === `test:${w.id}` ? <CircleNotch size={13} className="animate-spin" /> : null} Send test
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openLog(w.id)} title="Delivery history">
                      <ClockCounterClockwise size={13} weight="bold" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(w.id)} disabled={busy === `del:${w.id}`}
                      className="text-muted-foreground hover:text-destructive">
                      <Trash size={13} weight="bold" />
                    </Button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(w.events?.length ? w.events : ["all events"]).map((e) => (
                      <span key={e} className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">{e}</span>
                    ))}
                  </div>

                  {/* Test result — the status code IS the answer, so show it rather than a tick. */}
                  {t && (
                    <div className={"mt-2 rounded border px-2 py-1.5 text-xs " + (t.ok ? "border-emerald-600/30 bg-emerald-50 text-emerald-800" : "border-destructive/30 bg-destructive/5 text-destructive")}>
                      <span className="inline-flex items-center gap-1 font-medium">
                        {t.ok ? <CheckCircle size={12} weight="fill" /> : <Warning size={12} weight="fill" />}
                        {t.ok ? `Delivered — HTTP ${t.status_code}` : `Not delivered${t.status_code ? ` — HTTP ${t.status_code}` : ""}`}
                      </span>
                      {typeof t.attempts === "number" && t.attempts > 1 && <span className="ml-1">after {t.attempts} attempts</span>}
                      {t.error && <span className="ml-1">· {t.error}</span>}
                      {t.hint && <div className="mt-0.5 opacity-80">{t.hint}</div>}
                    </div>
                  )}

                  {log?.id === w.id && (
                    <div className="mt-2 border-t border-border pt-2">
                      {log.rows === null ? (
                        <div className="text-xs text-muted-foreground">Loading history…</div>
                      ) : log.rows.length === 0 ? (
                        <div className="text-xs text-muted-foreground">Nothing delivered yet.</div>
                      ) : (
                        <table className="w-full text-xs">
                          <tbody>
                            {log.rows.slice(0, 15).map((d) => {
                              const o = outcomeOf(d)
                              return (
                                <tr key={d.id} className="border-t border-border/60 first:border-0">
                                  <td className="py-1 font-mono text-2xs">{d.event}</td>
                                  <td className={"py-1 " + (o.tone === "ok" ? "text-emerald-700" : "text-destructive")}>{o.text}</td>
                                  <td className="py-1 text-right text-muted-foreground">{d.attempts}×</td>
                                  <td className="py-1 text-right text-muted-foreground">{when(d.created_at)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

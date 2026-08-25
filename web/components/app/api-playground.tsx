"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useMemo, useState } from "react"
import { Key, Copy, Check, CircleNotch, Warning, BookOpen, CaretRight, Eye, EyeSlash } from "@phosphor-icons/react"
import { tabsListVariants, tabsTriggerVariants } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WebhooksPanel } from "@/components/app/webhooks-panel"
import { API_ENDPOINTS, type ApiEndpoint } from "@/lib/api-endpoints"

const KEY_STORE = "eg_playground_key" // convenience only — sessionStorage, never the JWT

/**
 * Show enough of a key to recognise it, never enough to use it.
 *
 * The prefix stays because it is how you tell a test key from a live one at a glance —
 * and that distinction decides whether a call creates real orders. The last four
 * identify WHICH key. Everything between is the secret.
 */
function maskKey(k: string): string {
 const v = String(k || "")
 if (!v) return ""
 const m = v.match(/^(egk_(?:test|live)_)(.*)$/)
 const prefix = m ? m[1] : v.slice(0, 4)
 const body = m ? m[2] : v.slice(4)
  // prefix + first 4 + eight dots + last 4 — the SAME shape Settings › API keys renders from
  // its stored prefix + last4, so the two can be compared at a glance.
 if (body.length <= 8) return prefix + "•".repeat(Math.max(0, body.length))
 return prefix + body.slice(0, 4) + "••••••••" + body.slice(-4)
}

const methodTone: Record<string, string> = {
  GET: "bg-shipped/12 text-shipped",
  POST: "bg-packed/12 text-packed",
}

type DevTab = "api" | "webhooks"

/**
 * The two halves of an integration, kept apart.
 *
 * The Webhooks panel first shipped inside the endpoint browser's right-hand column, so
 * it re-rendered under whichever endpoint you had selected — a live management surface
 * stapled to the bottom of every doc page. They're different jobs: one is "calls you
 * make to us", the other is "calls we make to you".
 *
 * Module scope, not defined during render (react-hooks/static-components).
 */
function DevTabs({ tab, onTab }: { tab: DevTab; onTab: (t: DevTab) => void }) {
  const tl = useLabelT()
  // No icons — see the note in design-lab-tabs.tsx. Two words each; a mark in front of
  // them is decoration competing with the label.
 const items: { id: DevTab; label: string }[] = [
    { id: "api", label: tl("apiPlayground", "API Explorer") },
    { id: "webhooks", label: tl("apiPlayground", "Webhooks") },
  ]
 return (
    <nav aria-label={tl("apiPlayground", "Developer sections")} className={cn(tabsListVariants(), "h-8 w-fit")}>
      {items.map(({ id, label }) => (
        <button
 key={id}
 type="button"
 aria-current={tab === id ? "page" : undefined}
 onClick={() => onTab(id)}
 className={cn(tabsTriggerVariants({ active: tab === id }), "px-3")}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

export function ApiPlayground() {
  const tl = useLabelT()
 const [tab, setTab] = useState<DevTab>("api")
 const [env, setEnv] = useState<"test" | "live">("test")
 const [keys, setKeys] = useState<{ test: string; live: string }>({ test: "", live: "" })
  // Keys render masked. Revealing is deliberate and per-view, never remembered — a key
  // left legible is a key that ends up in a screen share or a screenshot.
 const [revealed, setRevealed] = useState(false)
 const apiKey = keys[env]
  // ?endpoint=<id> preselects one, so "Try it" in the public docs lands on the call you
  // were reading instead of the top of the list. Read once at mount rather than through
  // useSearchParams, which would need a Suspense boundary for a value that never changes
  // after load. Unknown ids fall back to the first entry.
 const [selected, setSelected] = useState<ApiEndpoint>(() => {
 if (typeof window === "undefined") return API_ENDPOINTS[0]
 const want = new URLSearchParams(window.location.search).get("endpoint")
 return API_ENDPOINTS.find((e) => e.id === want) ?? API_ENDPOINTS[0]
  })
 const [body, setBody] = useState(selected.body ?? "")
 const [param, setParam] = useState(selected.param?.placeholder ?? "")
 const [sending, setSending] = useState(false)
 const [res, setRes] = useState<{ status: number; ok: boolean; text: string } | null>(null)
 const [copied, setCopied] = useState(false)

  // Restore previously pasted/generated keys per environment (session-scoped).
 useEffect(() => {
 const id = setTimeout(() => {
 try {
 setKeys({ test: sessionStorage.getItem(KEY_STORE + "_test") || "", live: sessionStorage.getItem(KEY_STORE + "_live") || "" })
      } catch {}
    }, 0)
 return () => clearTimeout(id)
  }, [])
 const rememberKey = (k: string) => {
 setKeys((prev) => ({ ...prev, [env]: k }))
 try { sessionStorage.setItem(KEY_STORE + "_" + env, k) } catch {}
  }

 const pick = (e: ApiEndpoint) => {
 setSelected(e)
 setBody(e.body ?? "")
 setParam(e.param?.placeholder ?? "")
 setRes(null)
  }

 const resolvedPath = useMemo(
    () => (selected.param ? selected.path.replace(`:${selected.param.name}`, encodeURIComponent(param || selected.param.placeholder)) : selected.path),
 [selected, param]
  )


 const send = async () => {
 setSending(true); setRes(null)
 try {
 const init: RequestInit = {
 method: selected.method,
 headers: { "X-API-Key": apiKey.trim(), ...(selected.method === "POST" ? { "Content-Type": "application/json" } : {}) },
      }
 if (selected.method === "POST") init.body = body || "{}"
 const r = await fetch(resolvedPath, init)
 const text = await r.text()
 let pretty = text
 try { pretty = JSON.stringify(JSON.parse(text), null, 2) } catch {}
 setRes({ status: r.status, ok: r.ok, text: pretty })
    } catch (e) {
 setRes({ status: 0, ok: false, text: e instanceof Error ? e.message : "Request failed (network)." })
    } finally {
 setSending(false)
    }
  }

 if (tab === "webhooks") {
 return (
      <div className="space-y-4">
        <DevTabs tab={tab} onTab={setTab} />
        <WebhooksPanel />
      </div>
    )
  }

 return (
    <div className="space-y-4">
      <DevTabs tab={tab} onTab={setTab} />
      {/* Getting started — collapsed by default so the test key is the focus */}
      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold">
          <BookOpen size={16} weight="duotone" className="text-primary" /> {tl("apiPlayground", "Getting started")}
          <CaretRight size={13} weight="bold" className="ml-auto text-muted-foreground transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-border">
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            {[
              { n: "1", h: tl("apiPlayground", "Get a key"), b: tl("apiPlayground", "Generate a key (egk_test_…) in Settings → API keys, then paste it below. Send it on every request as the X-API-Key header.") },
              { n: "2", h: tl("apiPlayground", "Build in the sandbox"), b: tl("apiPlayground", "Every call hits /api/test/* — it validates auth and returns realistic responses but creates NO real orders, labels, or charges. Try the endpoints below.") },
              { n: "3", h: tl("apiPlayground", "Go live"), b: tl("apiPlayground", "Once your integration works, live access (a production key + real order endpoints) is enabled per-account — reach out and we'll turn it on.") },
            ].map((s) => (
              <div key={s.n} className="rounded-xl border border-border p-4">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{s.n}</span>
                <div className="mt-2.5 font-semibold">{s.h}</div>
                <p className="mt-1 text-sm text-muted-foreground">{s.b}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            {tl("apiPlayground", "Two directions: pull orders")} <span className="font-medium text-foreground">from</span> {tl("apiPlayground", "a sales channel (Etsy/Shopify — Stores page), or let another system push orders")} <span className="font-medium text-foreground">to</span> {tl("apiPlayground", "EGFUL via this API. The sandbox is for the second.")}
          </div>
        </div>
      </details>

      {/* Key bar */}
      <SectionCard
 title={<span className="flex items-center gap-2">{tl("apiPlayground", "Your API key")}
          <span className={"rounded-full px-2 py-0.5 text-xs font-semibold uppercase " + (env === "live" ? "bg-alert/12 text-alert" : "bg-shipped/12 text-shipped")}>{env === "live" ? tl("apiPlayground", "Live") : tl("apiPlayground", "Sandbox")}</span>
        </span>}
 actions={
          <div className="flex rounded-lg border border-border p-0.5">
            {(["test", "live"] as const).map((m) => (
              <button key={m} onClick={() => setEnv(m)} className={"eg-tap rounded-md px-3 py-1 text-xs font-semibold uppercase transition-colors " + (env === m ? (m === "live" ? "bg-alert text-white" : "bg-primary text-primary-foreground") : "text-muted-foreground hover:text-foreground")}>{m === "live" ? tl("apiPlayground", "Live") : tl("apiPlayground", "Sandbox")}</button>
            ))}
          </div>
        }
      >
        <div className="space-y-3 p-5">
          {env === "live" && (
            <div className="flex items-start gap-2 rounded-lg border border-alert/30 bg-alert/12 px-3 py-2 text-sm text-alert">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /> <span><b>{tl("apiPlayground", "Live mode")}</b> {tl("apiPlayground", "— a live key (egk_live_…) makes calls create")} <b>real</b> {tl("apiPlayground", "orders. Use a test key while building.")}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Key size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              {/* Masked by default. Still a real input while revealed so a key can be
 pasted or corrected; masked it is read-only, because typing into a
 masked field would silently replace the key with bullets. */}
              <Input
 value={revealed || !apiKey ? apiKey : maskKey(apiKey)}
 onChange={(e) => rememberKey(e.target.value)}
 readOnly={!!apiKey && !revealed}
 placeholder={env === "live" ? "Paste your egk_live_… key from Settings → API keys" : "Paste your egk_test_… key from Settings → API keys"}
 className="pl-9 pr-20 font-mono text-xs"
              />
              {apiKey && (
                <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                  <button
 type="button"
 onClick={() => setRevealed((v) => !v)}
 aria-label={revealed ? "Hide key" : "Reveal key"}
 title={revealed ? "Hide" : "Reveal"}
 className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {revealed ? <EyeSlash size={14} weight="bold" /> : <Eye size={14} weight="bold" />}
                  </button>
                  {/* Copies the REAL key whether or not it is on screen — the point of
 masking is that you never need to look at it. */}
                  <button
 type="button"
 onClick={async () => { try { await navigator.clipboard.writeText(apiKey); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }}
 aria-label={tl("apiPlayground", "Copy key")}
 title={tl("apiPlayground", "Copy")}
 className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                  </button>
                </span>
              )}
            </div>
            {/* Keys are created & managed in ONE place — Settings → API keys — so the
                Explorer stays a pure try-it surface (no second generator to drift from it). */}
            <a href="/settings?tab=keys" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium transition-colors hover:bg-accent">
              <Key size={14} weight="bold" /> {tl("apiPlayground", "Manage keys")}
            </a>
          </div>
          <p className="text-xs text-muted-foreground">Keys are created &amp; managed in <a href="/settings?tab=keys" className="font-medium text-foreground underline underline-offset-2">{tl("apiPlayground", "Settings → API keys")}</a> — generate one there and paste it above. {env === "live" ? tl("apiPlayground", "A live key makes calls create real records.") : tl("apiPlayground", "A sandbox key hits /api/test/* — no real orders, labels or charges.")}</p>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* Endpoint list */}
        <div className="space-y-1 rounded-xl border border-border p-2">
          {API_ENDPOINTS.map((e) => (
            <button
 key={e.id}
 onClick={() => pick(e)}
 className={
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors " +
                (selected.id === e.id ? "bg-primary/10 text-primary" : "hover:bg-accent")
              }
            >
              <span className={"rounded px-1.5 py-0.5 font-mono text-2xs font-bold " + methodTone[e.method]}>{e.method}</span>
              <span className="truncate font-medium">{e.title}</span>
            </button>
          ))}
        </div>

        {/* Request / response */}
        <div className="space-y-4">
          <SectionCard title={selected.title}>
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={"rounded px-2 py-1 font-mono text-xs font-bold " + methodTone[selected.method]}>{selected.method}</span>
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs">{resolvedPath}</code>
              </div>
              <p className="text-sm text-muted-foreground">{selected.description}</p>

              {selected.param && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium capitalize">{selected.param.name}</span>
                  <Input value={param} onChange={(e) => setParam(e.target.value)} placeholder={selected.param.placeholder} className="max-w-xs font-mono text-xs" />
                </label>
              )}

              {selected.method === "POST" && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{tl("apiPlayground", "Request body")}</span>
                  <textarea
 value={body}
 onChange={(e) => setBody(e.target.value)}
 rows={Math.min(16, (body.match(/\n/g)?.length ?? 6) + 2)}
 spellCheck={false}
 className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
              )}

              <Button onClick={send} disabled={sending || !apiKey.trim()}>
                {sending ? <CircleNotch size={15} className="animate-spin" /> : null} Send request
              </Button>
              {!apiKey.trim() && <span className="ml-2 text-xs text-muted-foreground">{tl("apiPlayground", "Add a test key above to send.")}</span>}
            </div>
          </SectionCard>

          {res && (
            <SectionCard
 title={tl("apiPlayground", "Response")}
 actions={
                <span className={"rounded-full px-2.5 py-0.5 text-xs font-semibold " + (res.ok ? "bg-shipped/12 text-shipped" : "bg-alert/12 text-alert")}>
                  {res.status || "ERR"}
                </span>
              }
            >
              <pre className="max-h-[420px] overflow-auto rounded-b-xl bg-muted/40 p-4 font-mono text-xs leading-relaxed">{res.text}</pre>
            </SectionCard>
          )}

        </div>
      </div>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from "react"
import { Play, Key, Copy, Check, CircleNotch, Warning, Lightning, BookOpen, CaretRight } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createApiKey } from "@/lib/api"
import { API_ENDPOINTS, type ApiEndpoint } from "@/lib/api-endpoints"

const KEY_STORE = "eg_playground_key" // convenience only — sessionStorage, never the JWT

const methodTone: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-700",
  POST: "bg-sky-100 text-sky-700",
}

export function ApiPlayground() {
  const [env, setEnv] = useState<"test" | "live">("test")
  const [keys, setKeys] = useState<{ test: string; live: string }>({ test: "", live: "" })
  const apiKey = keys[env]
  const [selected, setSelected] = useState<ApiEndpoint>(API_ENDPOINTS[0])
  const [body, setBody] = useState(selected.body ?? "")
  const [param, setParam] = useState(selected.param?.placeholder ?? "")
  const [sending, setSending] = useState(false)
  const [res, setRes] = useState<{ status: number; ok: boolean; text: string } | null>(null)
  const [keyErr, setKeyErr] = useState<string | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [freshKey, setFreshKey] = useState<string | null>(null)
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

  const generateKey = async () => {
    setGenLoading(true); setKeyErr(null)
    try {
      const r = await createApiKey(env === "live" ? "Live playground key" : "Playground key", env)
      setFreshKey(r.key)
      setCopied(false)
      rememberKey(r.key)
    } catch (e) {
      setKeyErr(e instanceof Error ? e.message : "Couldn't generate a key. Are you signed in?")
    } finally {
      setGenLoading(false)
    }
  }

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

  return (
    <div className="space-y-4">
      {/* Getting started — collapsed by default so the test key is the focus */}
      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold">
          <BookOpen size={16} weight="duotone" className="text-primary" /> Getting started
          <CaretRight size={13} weight="bold" className="ml-auto text-muted-foreground transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-border">
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            {[
              { n: "1", h: "Get a key", b: "Generate a test key (egk_test_…) below or in Settings → API keys. Send it on every request as the X-API-Key header." },
              { n: "2", h: "Build in the sandbox", b: "Every call hits /api/test/* — it validates auth and returns realistic responses but creates NO real orders, labels, or charges. Try the endpoints below." },
              { n: "3", h: "Go live", b: "Once your integration works, live access (a production key + real order endpoints) is enabled per-account — reach out and we'll turn it on." },
            ].map((s) => (
              <div key={s.n} className="rounded-xl border border-border p-4">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{s.n}</span>
                <div className="mt-2.5 font-semibold">{s.h}</div>
                <p className="mt-1 text-sm text-muted-foreground">{s.b}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            Two directions: pull orders <span className="font-medium text-foreground">from</span> a sales channel (Etsy/Shopify — Stores page), or let another system push orders <span className="font-medium text-foreground">to</span> EGFULFILL via this API. The sandbox is for the second.
          </div>
        </div>
      </details>

      {/* Key bar */}
      <SectionCard
        title={<span className="flex items-center gap-2">Your API key
          <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase " + (env === "live" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>{env}</span>
        </span>}
        description="Calls authenticate with this key, sent as the X-API-Key header."
        actions={
          <div className="flex rounded-lg border border-border p-0.5">
            {(["test", "live"] as const).map((m) => (
              <button key={m} onClick={() => setEnv(m)} className={"rounded-md px-3 py-1 text-xs font-semibold uppercase transition-colors " + (env === m ? (m === "live" ? "bg-red-500 text-white" : "bg-primary text-primary-foreground") : "text-muted-foreground hover:text-foreground")}>{m}</button>
            ))}
          </div>
        }
      >
        <div className="space-y-3 p-5">
          {env === "live" && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /> <span><b>Live mode</b> — a live key (egk_live_…) makes calls create <b>real</b> orders. Use a test key while building.</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Key size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={apiKey}
                onChange={(e) => rememberKey(e.target.value)}
                placeholder={env === "live" ? "Paste an egk_live_… key, or generate one" : "Paste an egk_test_… key, or generate one"}
                className="pl-9 font-mono text-xs"
              />
            </div>
            <Button variant="outline" onClick={generateKey} disabled={genLoading}>
              {genLoading ? <CircleNotch size={15} className="animate-spin" /> : <Lightning size={15} weight="bold" />} Generate {env}
            </Button>
          </div>
          {keyErr && <div className="flex items-center gap-1.5 text-sm text-destructive"><Warning size={14} weight="fill" /> {keyErr}</div>}
          {freshKey && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-emerald-800">{freshKey}</code>
              <span className="shrink-0 text-[11px] font-medium text-emerald-700">Copy now — shown once</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => { try { await navigator.clipboard.writeText(freshKey); setCopied(true) } catch {} }}
              >
                {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Keys are managed in <span className="font-medium text-foreground">Settings → API keys</span>. {env === "live" ? "A live key makes calls create real records." : "A test key hits the sandbox — no real orders, labels or charges."}</p>
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
              <span className={"rounded px-1.5 py-0.5 font-mono text-[10px] font-bold " + methodTone[e.method]}>{e.method}</span>
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
                  <span className="text-sm font-medium">Request body</span>
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
                {sending ? <CircleNotch size={15} className="animate-spin" /> : <Play size={15} weight="fill" />} Send request
              </Button>
              {!apiKey.trim() && <span className="ml-2 text-xs text-muted-foreground">Add a test key above to send.</span>}
            </div>
          </SectionCard>

          {res && (
            <SectionCard
              title="Response"
              actions={
                <span className={"rounded-full px-2.5 py-0.5 text-xs font-semibold " + (res.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
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

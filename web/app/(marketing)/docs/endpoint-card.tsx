"use client"

import { useState } from "react"
import { Check, Copy, ArrowSquareOut } from "@phosphor-icons/react"
import type { ApiEndpoint } from "@/lib/api-endpoints"
import { Block } from "./code-block"

const BASE = "https://api.egful.store"
const KEY = "egk_test_..."

type Lang = "curl" | "js" | "python"
const LANGS: [Lang, string][] = [["curl", "cURL"], ["js", "JavaScript"], ["python", "Python"]]

/** Indent a pretty-printed JSON body so it sits correctly inside generated code. */
const indent = (json: string, spaces: number) =>
  json.split("\n").map((l, i) => (i === 0 ? l : " ".repeat(spaces) + l)).join("\n")

/**
 * Build a runnable snippet for one endpoint.
 *
 * Generated from the endpoint definition rather than written out per language: three
 * hand-maintained copies of ten endpoints is thirty things to forget when a path
 * changes, and the wrong one is worse than none.
 */
function snippet(e: ApiEndpoint, lang: Lang): string {
  const path = e.param ? e.path.replace(/:(\w+)/, e.param.placeholder) : e.path
  const url = BASE + path
  const hasBody = !!e.body

  if (lang === "curl") {
    const lines = [`curl -X ${e.method} ${url} \\`, `  -H "X-API-Key: ${KEY}"`]
    if (hasBody) {
      lines[lines.length - 1] += " \\"
      lines.push(`  -H "Content-Type: application/json" \\`)
      lines.push(`  -d '${e.body}'`)
    }
    return lines.join("\n")
  }

  if (lang === "js") {
    const opts = [`  method: "${e.method}",`, `  headers: {`, `    "X-API-Key": "${KEY}",`]
    if (hasBody) opts.push(`    "Content-Type": "application/json",`)
    opts.push(`  },`)
    if (hasBody) opts.push(`  body: JSON.stringify(${indent(e.body!, 2)}),`)
    return [
      `const res = await fetch("${url}", {`,
      ...opts,
      `})`,
      `const data = await res.json()`,
    ].join("\n")
  }

  // python
  const args = [`  "${url}",`, `  headers={"X-API-Key": "${KEY}"},`]
  if (hasBody) args.push(`  json=${indent(e.body!, 2).replace(/true/g, "True").replace(/false/g, "False").replace(/null/g, "None")},`)
  return [
    `import requests`,
    ``,
    `res = requests.${e.method.toLowerCase()}(`,
    ...args,
    `)`,
    `print(res.json())`,
  ].join("\n")
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        navigator.clipboard?.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {done ? <><Check size={12} weight="bold" /> Copied</> : <><Copy size={12} weight="bold" /> Copy</>}
    </button>
  )
}

/**
 * One endpoint: runnable in three languages, copyable, and one click from the live
 * playground where the same call can actually be sent with a real key.
 */
export function EndpointCard({ endpoint: e }: { endpoint: ApiEndpoint }) {
  const [lang, setLang] = useState<Lang>("curl")
  const code = snippet(e, lang)

  return (
    <div className="rounded-lg border border-border p-4 transition-colors hover:border-primary/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className={
          "rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold " +
          (e.method === "GET" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700")
        }>{e.method}</span>
        <code className="font-mono text-sm">{e.path}</code>
        <span className="ml-auto text-sm font-medium">{e.title}</span>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{e.description}</p>

      {/* Request, in whichever language they actually write in. */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center gap-1">
          {LANGS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLang(id)}
              aria-pressed={lang === id}
              className={
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors " +
                (lang === id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              {label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1">
            <CopyButton text={code} label={`${e.title} request`} />
            {/* Through /login, not straight at /developers.
                These docs are PUBLIC, so most people clicking this have no session, and
                pointing them at an authenticated board meant landing on someone else's
                dashboard or a bare redirect that lost the endpoint. Login sends an
                existing session straight on without showing the form, and routes by role
                afterwards — so a seller lands on their board, not an admin one. */}
            <a
              href={`/login?next=${encodeURIComponent(`/developers?endpoint=${e.id}`)}`}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
            >
              Try it <ArrowSquareOut size={11} weight="bold" />
            </a>
          </span>
        </div>
        <Block>{code}</Block>
      </div>

      {e.response && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Response</span>
            <span className="ml-auto"><CopyButton text={e.response} label={`${e.title} response`} /></span>
          </div>
          <Block>{e.response}</Block>
        </div>
      )}
    </div>
  )
}

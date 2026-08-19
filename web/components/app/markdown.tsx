"use client"

import { Fragment, type ReactNode } from "react"

// A deliberately tiny markdown renderer for AI copy (chat replies, shop advice).
// Covers exactly what the model emits: ## headings, **bold**, `code`, and bullet /
// numbered lists. No dependency — a full markdown lib would cost more bundle than
// the whole feature, and this text is ours, not arbitrary user input.
//
// Builds React nodes rather than dangerouslySetInnerHTML: even trusted text can
// contain <, and escaping by hand is how XSS holes start.

/** Inline: **bold** and `code`. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // Split on **bold** and `code`, keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  parts.forEach((p, i) => {
    if (!p) return
    const k = `${keyBase}-${i}`
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      out.push(<strong key={k} className="font-semibold">{p.slice(2, -2)}</strong>)
    } else if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      out.push(<code key={k} className="rounded bg-muted px-1 py-0.5 tabular-nums text-[0.85em]">{p.slice(1, -1)}</code>)
    } else {
      out.push(<Fragment key={k}>{p}</Fragment>)
    }
  })
  return out
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }

function parse(src: string): Block[] {
  const blocks: Block[] = []
  const lines = (src || "").replace(/\r\n/g, "\n").split("\n")
  let para: string[] = []
  const flushPara = () => { if (para.length) { blocks.push({ kind: "p", text: para.join(" ") }); para = [] } }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)

    if (h) { flushPara(); blocks.push({ kind: "h", level: h[1].length, text: h[2] }); continue }
    if (ul) {
      flushPara()
      const last = blocks[blocks.length - 1]
      if (last?.kind === "ul") last.items.push(ul[1])
      else blocks.push({ kind: "ul", items: [ul[1]] })
      continue
    }
    if (ol) {
      flushPara()
      const last = blocks[blocks.length - 1]
      if (last?.kind === "ol") last.items.push(ol[1])
      else blocks.push({ kind: "ol", items: [ol[1]] })
      continue
    }
    if (!line.trim()) { flushPara(); continue }
    para.push(line.trim())
  }
  flushPara()
  return blocks
}

export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  const blocks = parse(children)
  return (
    <div className={"space-y-2.5 text-sm leading-relaxed " + className}>
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          const size = b.level <= 2 ? "text-base" : "text-sm"
          return <div key={i} className={`${size} mt-1 font-semibold text-foreground`}>{inline(b.text, `h${i}`)}</div>
        }
        if (b.kind === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((it, j) => <li key={j}>{inline(it, `u${i}-${j}`)}</li>)}
            </ul>
          )
        }
        if (b.kind === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.items.map((it, j) => <li key={j}>{inline(it, `o${i}-${j}`)}</li>)}
            </ol>
          )
        }
        return <p key={i}>{inline(b.text, `p${i}`)}</p>
      })}
    </div>
  )
}

/**
 * Cheap "does this look like markdown" test. Keys off the CONTENT, not who's viewing —
 * so an AI reply (**bold**, `code`, headings, lists) renders formatted for everyone,
 * while a plain human message stays verbatim (literal * and line breaks preserved).
 */
export function hasMarkdown(t?: string): boolean {
  return !!t && /\*\*[^*\n]+\*\*|`[^`\n]+`|^\s{0,3}#{1,4}\s|^\s*[-*]\s|^\s*\d+[.)]\s/m.test(t)
}

"use client"

import { useState } from "react"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"

// Client-side pagination for pages that load a full list then render it. Derives the
// current page from raw state clamped to the page count (no effects), so shrinking the
// list or changing per-page never leaves you stranded on an empty page.
export function usePaged<T>(items: T[], initialPerPage = 24) {
  const [pageRaw, setPageRaw] = useState(1)
  const [perPage, setPerPageRaw] = useState(initialPerPage)
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(Math.max(1, pageRaw), pageCount)
  const start = (page - 1) * perPage
  const pageItems = items.slice(start, start + perPage)
  return {
    page, perPage, total, pageCount, start, pageItems,
    setPage: (n: number) => setPageRaw(Math.max(1, n)),
    setPerPage: (n: number) => { setPerPageRaw(n); setPageRaw(1) },
  }
}

export function Pagination({
  page, pageCount, perPage, total, start, onPage, onPerPage, perPageOptions = [24, 48, 96], className,
}: {
  page: number
  pageCount: number
  perPage: number
  total: number
  start: number
  onPage: (n: number) => void
  onPerPage: (n: number) => void
  perPageOptions?: number[]
  className?: string
}) {
  if (total === 0) return null
  const from = start + 1
  const to = Math.min(start + perPage, total)
  return (
    <div className={"flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm " + (className ?? "")}>
      <span className="text-muted-foreground">Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <span className="hidden sm:inline">Per page</span>
          <select value={perPage} onChange={(e) => onPerPage(Number(e.target.value))} className="eg-select h-8 rounded-md border border-input bg-transparent px-1.5 text-sm">
            {perPageOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:enabled:bg-accent disabled:opacity-40" aria-label="Previous page">
            <CaretLeft size={14} weight="bold" />
          </button>
          <span className="min-w-20 text-center text-muted-foreground tabular-nums">Page {page} / {pageCount}</span>
          <button onClick={() => onPage(page + 1)} disabled={page >= pageCount} className="flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:enabled:bg-accent disabled:opacity-40" aria-label="Next page">
            <CaretRight size={14} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Archive } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getCatalogExports, type CatalogExport } from "@/lib/api"

const when = (s: string) =>
  new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })

/**
 * Catalogues that were sent, and a way back to them.
 *
 * A lookbook handed to a buyer is a commercial document. If they order from it two months
 * later, prices have moved and styles may be gone — and "what was on page 3" has to be
 * answerable. Reopening reads the SNAPSHOT taken at the time, never the live catalogue,
 * which is the only thing that makes it evidence rather than a guess.
 */
export function CatalogExportHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<CatalogExport[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getCatalogExports()
      .then((r) => { setRows(r.exports ?? []); setErr(null) })
      .catch((e: Error) => { setErr(e.message); setRows([]) })
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  return (
    <div className="space-y-3 px-5 py-4">
      {err && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{err}</div>}

      {rows === null ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <CircleNotch size={16} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        // Says what to do, not just that there's nothing — this list only fills when
        // somebody presses Save, and that isn't obvious from an empty table.
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Archive size={26} weight="duotone" className="opacity-50" />
          <p className="text-sm">No catalogues saved yet.</p>
          <p className="max-w-md text-xs">
            Open <strong>Create lookbook</strong> and press <strong>Save this version</strong> before you
            send one. It records the styles and prices as they were, so you can reopen exactly
            what the buyer saw.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left eg-label text-muted-foreground">
                <th className="px-2 py-2 font-medium">Catalogue</th>
                <th className="px-2 py-2 font-medium">Saved</th>
                <th className="px-2 py-2 font-medium">Styles</th>
                <th className="px-2 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-2 font-medium">{e.title || `Catalogue ${e.id}`}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {when(e.createdAt)}{e.by ? ` · ${e.by}` : ""}
                  </td>
                  <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">{e.styleCount}</td>
                  <td className="px-2 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => onOpen(e.id)}>
                      Reopen
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { Archive } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getCatalogExports, type CatalogExport } from "@/lib/api"
import { HistoryPanel } from "@/components/app/history-panel"
import type { ColumnRegistry } from "@/lib/table-columns"

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
type ColId = "title" | "saved" | "styles" | "open"
const COLS: ColumnRegistry<ColId> = {
  title:  { id: "title",  label: "Catalogue" },
  saved:  { id: "saved",  label: "Saved", width: "w-64" },
  styles: { id: "styles", label: "Styles", width: "w-20", align: "right" },
  open:   { id: "open",   label: "", width: "w-28", align: "right" },
}

export function CatalogExportHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const tl = useLabelT()
 const [rows, setRows] = useState<CatalogExport[] | null>(null)
 const [err, setErr] = useState<string | null>(null)

 const load = useCallback(() => {
 getCatalogExports()
      .then((r) => { setRows(r.exports ?? []); setErr(null) })
      .catch((e: Error) => { setErr(e.message); setRows([]) })
  }, [])
 useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

 /* ITS OWN REGISTRY, because this archive has no live list to borrow one from — a sent
     catalogue is not a row in a table anyone works. The shape is the shared one, so it takes
     the same panel, the same header treatment and (when it needs one) the same ColumnsMenu
     as every other archive. */
 return (
    <div className="px-5 py-4">
      <HistoryPanel
        embedded
        cols={COLS}
        order={["title", "saved", "styles", "open"]}
        rows={rows ?? []}
        loading={rows === null}
        error={err}
        rowKey={(r) => String((r as unknown as CatalogExport).id)}
        cell={(row, id) => {
 const e = row as unknown as CatalogExport
 if (id === "title") return <span className="font-medium">{e.title || `Catalogue ${e.id}`}</span>
 if (id === "saved") return <span className="text-muted-foreground">{when(e.createdAt)}{e.by ? ` · ${e.by}` : ""}</span>
 if (id === "styles") return <span className="tabular-nums text-muted-foreground">{e.styleCount}</span>
 return (
            <Button size="sm" variant="outline" onClick={() => onOpen(e.id)}>
              {tl("catalogExportHistory", "Reopen")}
            </Button>
          )
        }}
        empty={{
 icon: Archive,
 title: tl("catalogExportHistory", "No catalogues saved yet"),
          // The one sentence an empty region may carry: this list only fills when somebody
          // presses Save, which an empty table does not say.
 note: tl("catalogExportHistory", "Open Create lookbook and press Save this version before you send one — it records styles and prices as they were."),
        }}
      />
    </div>
  )
}

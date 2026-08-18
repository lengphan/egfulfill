"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CircleNotch, Warning, UploadSimple, DownloadSimple, FloppyDisk, Plus, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getCatalogRows, getPartnerTemplates, createPartnerTemplate, updatePartnerTemplate,
  deletePartnerTemplate, type CatalogExportRow, type PartnerTemplate,
} from "@/lib/api"
import {
  detectLayout, guessMapping, emptyBlockMapping, blockRows, buildWorkbook, downloadWorkbook,
  unfilledColumns,
  type TemplateLayout, type Mapping, type BlockMapping, type ColumnRule, type BlockMode,
} from "@/lib/partner-sheet"

const SELECT =
  "eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors " +
  "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

/** Plain-English names for the export's field keys. The keys are the server's. */
const FIELD_LABEL: Record<string, string> = {
  sku: "Our SKU", model: "Style / model no.", brand: "Brand", product: "Product name",
  description: "Description", colour: "Colour", size: "Size", price: "Catalogue price",
  currency: "Currency", image: "Product image URL", variant_image: "Colour image URL",
}

const MODES: { value: BlockMode; label: string; hint: string }[] = [
  { value: "rows", label: "One line per product", hint: "Repeats for every variant in the published catalogue." },
  { value: "fixed", label: "Fixed lines I type", hint: "For a block that isn't about products — a shipping rate card." },
  { value: "skip", label: "Leave empty", hint: "Headers go out, no data." },
]

/**
 * Fill a partner's own spreadsheet from the published catalogue.
 *
 * The shape of this feature is set by a fact about the business: every partner onboards
 * with a different workbook, and they do not accept ours instead. So the template is DATA
 * — uploaded, its columns read, mapped by hand once — and adding the next partner is an
 * upload rather than a release.
 *
 * The mapping is the honest part of it. Their sheet asks for things our catalogue has never
 * held (a carton weight, a pallet size, a shipping rate card), and rather than invent them
 * every column can instead take one value applied to every row, typed here. What is still
 * unfilled is listed rather than quietly exported blank.
 */
export function PartnerSheets() {
  const [templates, setTemplates] = useState<PartnerTemplate[] | null>(null)
  const [id, setId] = useState<string | null>(null)
  const [layout, setLayout] = useState<TemplateLayout>({ sheets: [] })
  const [mapping, setMapping] = useState<Mapping>({})
  const [dirty, setDirty] = useState(false)

  const [rows, setRows] = useState<CatalogExportRow[] | null>(null)
  const [fields, setFields] = useState<string[]>([])

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    getPartnerTemplates()
      .then((r) => setTemplates(r.templates ?? []))
      .catch((e: Error) => { setErr(e.message); setTemplates([]) })
    getCatalogRows()
      .then((r) => { setRows(r.rows ?? []); setFields(r.fields ?? []) })
      .catch((e: Error) => { setErr(e.message); setRows([]) })
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const current = useMemo(() => (templates ?? []).find((t) => t.id === id) || null, [templates, id])

  // Selecting a template loads ITS arrangement. Kept in local state rather than edited in
  // place so an unsaved mapping can be abandoned by picking another template.
  const select = (t: PartnerTemplate) => {
    setId(t.id)
    setLayout((t.layout as TemplateLayout) ?? { sheets: [] })
    setMapping((t.mapping as Mapping) ?? {})
    setDirty(false)
    setNote(null)
  }

  async function onFile(file: File) {
    setErr(null); setNote(null); setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const detected = detectLayout(buf)
      const blocks = detected.sheets.reduce((n, s) => n + s.blocks.length, 0)
      if (!blocks) {
        throw new Error(
          "No header rows found in that file — every sheet looked empty or single-column. " +
          "Check it's the workbook and not a PDF export of it."
        )
      }
      const guess = guessMapping(detected, fields)
      const name = file.name.replace(/\.(xlsx|xlsm|xls|csv)$/i, "") || "Partner"
      const saved = await createPartnerTemplate({ name, fileName: file.name, layout: detected, mapping: guess })
      if (saved.error) throw new Error(saved.error)
      setTemplates((prev) => [saved, ...(prev ?? [])])
      select(saved)
      setNote(`Read ${blocks} table${blocks === 1 ? "" : "s"} from ${file.name}. Check the mapping below before exporting.`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const patchBlock = (blockKey: string, next: Partial<BlockMapping>) => {
    setMapping((m) => ({ ...m, [blockKey]: { ...(m[blockKey] ?? { mode: "rows", columns: {}, fixed: [] }), ...next } }))
    setDirty(true)
  }
  const setRule = (blockKey: string, colIndex: number, rule: ColumnRule) => {
    setMapping((m) => {
      const b = m[blockKey] ?? { mode: "rows" as BlockMode, columns: {}, fixed: [] }
      return { ...m, [blockKey]: { ...b, columns: { ...b.columns, [colIndex]: rule } } }
    })
    setDirty(true)
  }

  async function save() {
    if (!id) return
    setBusy(true); setErr(null)
    try {
      const saved = await updatePartnerTemplate(id, { mapping })
      if (saved.error) throw new Error(saved.error)
      setTemplates((prev) => (prev ?? []).map((t) => (t.id === id ? saved : t)))
      setDirty(false)
      setNote("Mapping saved.")
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function remove(t: PartnerTemplate) {
    if (!window.confirm(`Delete the ${t.name} template? The mapping goes with it.`)) return
    setBusy(true); setErr(null)
    try {
      const r = await deletePartnerTemplate(t.id)
      if (r.error) throw new Error(r.error)
      setTemplates((prev) => (prev ?? []).filter((x) => x.id !== t.id))
      if (id === t.id) { setId(null); setLayout({ sheets: [] }); setMapping({}) }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  function exportSheet() {
    if (!current || !rows) return
    const wb = buildWorkbook(layout, mapping, rows)
    const stamp = new Date().toISOString().slice(0, 10)
    downloadWorkbook(wb, `${current.name}-catalogue-${stamp}.xlsx`)
    setNote(`Built ${current.name}'s sheet from ${rows.length} catalogue line${rows.length === 1 ? "" : "s"}.`)
  }

  const gaps = useMemo(() => unfilledColumns(layout, mapping, fields), [layout, mapping, fields])

  return (
    <div className="space-y-4 px-5 py-4">
      {/* WHY THIS SITS HERE and not in Settings: it exports the same picked catalogue the
          other tabs curate, so the thing you just published is one tab away from the file
          the partner receives. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
        />
        {/* Held until the catalogue has answered: the first mapping is guessed against the
            server's OWN field list, and guessing against an empty one silently produces a
            template where every column reads "leave blank" and looks like a bad detector. */}
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy || rows === null}
          title={rows === null
            ? "Reading the catalogue first — the column guesses come from its fields"
            : "Upload the workbook the partner sent you — we read its columns, not its contents"}>
          {busy ? <CircleNotch size={14} className="animate-spin" /> : <UploadSimple size={14} weight="bold" />}
          {" "}Upload a partner template
        </Button>
        {templates && templates.length > 0 && (
          <select className={SELECT} value={id ?? ""}
            onChange={(e) => {
              const t = (templates ?? []).find((x) => x.id === e.target.value)
              if (t) select(t)
            }}>
            <option value="">Pick a partner…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {rows === null ? "Reading the catalogue…" : `${rows.length} catalogue lines available`}
        </span>
      </div>

      {note && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{note}</div>}
      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {templates === null ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <CircleNotch size={16} className="animate-spin" /> Loading templates…
        </div>
      ) : !current ? (
        // Not the same sentence for "we couldn't read this" as for "you have none yet".
        <div className="py-12 text-center text-sm text-muted-foreground">
          {err
            ? "Couldn't load templates, so this isn't empty — it's unknown."
            : templates.length
              ? "Pick a partner above to edit how their sheet is filled."
              : "No partner templates yet. Upload the workbook a partner sent you and map their columns to ours once — after that, exporting is one click."}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={save} disabled={busy || !dirty}>
              <FloppyDisk size={14} weight="bold" /> {dirty ? "Save mapping" : "Saved"}
            </Button>
            <Button size="sm" onClick={exportSheet} disabled={busy || !rows}>
              <DownloadSimple size={14} weight="bold" /> Build {current.name} sheet
            </Button>
            {current.fileName && (
              <span className="text-xs text-muted-foreground">from {current.fileName}</span>
            )}
            {/* Pushed away from Build, which sits a few pixels from it and is the button
                actually being aimed at. */}
            <Button size="sm" variant="ghost" onClick={() => remove(current)} disabled={busy}
              className="ml-auto text-muted-foreground hover:text-destructive">
              Delete
            </Button>
          </div>

          {/* NOT hidden and NOT fatal. A partner column nothing feeds is a real state — some
              of what they ask for we genuinely do not hold — and the export goes ahead. What
              must not happen is it going out looking complete. */}
          {gaps.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span className="font-medium">{gaps.length} column{gaps.length === 1 ? "" : "s"} nothing feeds yet:</span>{" "}
              {gaps.slice(0, 8).map((g) => `${g.block ? `${g.block} · ` : ""}${g.label}`).join(", ")}
              {gaps.length > 8 && ` and ${gaps.length - 8} more`}. Give each a field or one fixed value — they export blank otherwise.
            </div>
          )}

          {layout.sheets.map((sheet) => (
            <div key={sheet.name} className="space-y-3">
              <h3 className="eg-label text-muted-foreground">{sheet.name}</h3>
              {sheet.blocks.map((block) => {
                const m: BlockMapping = mapping[block.id] ?? emptyBlockMapping(block)
                const preview = blockRows(block, m, (rows ?? []).slice(0, 3))
                return (
                  <div key={block.id} className="rounded-lg border border-border">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                      <span className="text-sm font-medium">{block.title || `Table at row ${block.headerRow + 1}`}</span>
                      <span className="text-xs text-muted-foreground">{block.columns.length} columns</span>
                      <select className={`${SELECT} ml-auto`} value={m.mode}
                        onChange={(e) => patchBlock(block.id, { mode: e.target.value as BlockMode })}>
                        {MODES.map((o) => <option key={o.value} value={o.value} title={o.hint}>{o.label}</option>)}
                      </select>
                    </div>

                    {m.mode === "rows" && (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left eg-label text-muted-foreground">
                            {/* nowrap: a partner header is a phrase ("PALLET SIZE (mm, width
                                x height)") and the column it names has to stay legible as one. */}
                            <th className="whitespace-nowrap px-3 py-2">Their column</th>
                            <th className="px-3 py-2">Filled from</th>
                            {/* Takes the slack, so the control and the value it produces
                                sit next to each other instead of at opposite margins. */}
                            <th className="w-full px-3 py-2">First row</th>
                          </tr>
                        </thead>
                        <tbody>
                          {block.columns.map((col, i) => {
                            const rule = m.columns[col.index] ?? { kind: "blank" as const }
                            const value = rule.kind === "const" ? "const" : rule.kind === "field" ? rule.field : ""
                            return (
                              <tr key={col.index} className="border-b border-border/60 last:border-0">
                                <td className="whitespace-nowrap px-3 py-1.5 font-medium">{col.label}</td>
                                <td className="px-3 py-1.5">
                                  <div className="flex items-center gap-2">
                                    <select className={SELECT} value={value}
                                      onChange={(e) => {
                                        const v = e.target.value
                                        setRule(block.id, col.index,
                                          v === "" ? { kind: "blank" }
                                            : v === "const" ? { kind: "const", value: "" }
                                              : { kind: "field", field: v })
                                      }}>
                                      <option value="">— leave blank —</option>
                                      {fields.map((f) => <option key={f} value={f}>{FIELD_LABEL[f] ?? f}</option>)}
                                      {/* The answer for pallet size, carton weight, lead time:
                                          one value, every row, typed once. */}
                                      <option value="const">Same value for every row…</option>
                                    </select>
                                    {rule.kind === "const" && (
                                      <Input value={rule.value} placeholder="e.g. 350x448"
                                        className="h-8 w-40 text-sm"
                                        onChange={(e) => setRule(block.id, col.index, { kind: "const", value: e.target.value })} />
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                  {preview[0]?.[i] || <span className="italic">blank</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}

                    {m.mode === "fixed" && (
                      <div className="overflow-x-auto px-3 py-2">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-left eg-label text-muted-foreground">
                              {block.columns.map((c) => <th key={c.index} className="px-1 py-2 font-medium">{c.label}</th>)}
                              <th className="w-8" />
                            </tr>
                          </thead>
                          <tbody>
                            {m.fixed.map((line, r) => (
                              <tr key={r}>
                                {block.columns.map((c, i) => (
                                  <td key={c.index} className="px-1 py-1">
                                    <Input value={line[i] ?? ""} className="h-8 text-sm"
                                      onChange={(e) => {
                                        const next = m.fixed.map((x) => [...x])
                                        next[r] = next[r] ?? []
                                        next[r][i] = e.target.value
                                        patchBlock(block.id, { fixed: next })
                                      }} />
                                  </td>
                                ))}
                                <td className="px-1">
                                  <Button size="sm" variant="ghost" aria-label="Remove line"
                                    onClick={() => patchBlock(block.id, { fixed: m.fixed.filter((_, x) => x !== r) })}>
                                    <X size={14} />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <Button size="sm" variant="outline" className="mt-2"
                          onClick={() => patchBlock(block.id, { fixed: [...m.fixed, new Array(block.columns.length).fill("")] })}>
                          <Plus size={14} weight="bold" /> Add a line
                        </Button>
                      </div>
                    )}

                    {m.mode === "skip" && (
                      <p className="px-3 py-3 text-xs text-muted-foreground">
                        Headers only — this block exports with no rows under it.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            The file carries their sheet names, section titles, headers and column order. It does
            not carry their cell colours or merged headings — those don&apos;t survive being rebuilt,
            and a sheet that looked right but had lost a merge would be worse than one that plainly
            never had them.
          </p>
        </>
      )}
    </div>
  )
}

"use client"

import { useEffect, useRef, useState } from "react"
import { CircleNotch, DownloadSimple, Needle, X } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Dropzone, formatBytes } from "@/components/app/dropzone"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import {
  getMachineFiles, uploadMachineFile, renameMachineFile, deleteMachineFile,
  downloadMachineFile, type MachineFile,
} from "@/lib/api"

/**
 * MACHINE FILES — the seller's own stitch files, uploaded once and referenced by id.
 *
 * THE PROBLEM IT REPLACES. A seller who sends us .EMB files (which is all of them) had one
 * route in: attach the file to an order line, in the designer, one line at a time. Forty
 * units of one design meant forty uploads of one file — or "apply to all items", which
 * writes a file with a NULL line and therefore lands on every line of the order including
 * the ones that are not embroidered.
 *
 * So the file gets a home of its own and an id you can type. `MF-12` in a sheet's Machine
 * File ID column attaches it to that row's unit, and the bytes are stored once no matter
 * how many lines reference them.
 *
 * SITS BESIDE TEMPLATES, NOT INSIDE THEM, because they answer different questions. A
 * template is a blank plus artwork plus WHERE IT SITS — it describes the print. A machine
 * file is the cut file itself, which has no placement to carry and no blank it belongs to:
 * the same .EMB runs on a cap and on a left chest. One is a design; the other is the thing
 * the machine reads.
 */
export function MachineFilesPanel() {
  const confirm = useConfirm()
  const [items, setItems] = useState<MachineFile[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  /** Which upload is current, so a slow one that finishes after a newer one cannot
   *  overwrite the newer result — the same guard every list on these pages uses. */
  const run = useRef(0)

  const load = () => getMachineFiles().then((r) => setItems(r ?? [])).catch(() => setItems([]))
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [])

  /**
   * ONE FILE AT A TIME, IN ORDER — not Promise.all.
   *
   * The server dedupes on content hash, and a dedupe is read-then-write: two identical files
   * posted concurrently both read "not there" and both insert, which is exactly the two-ids-
   * for-one-file case the dedupe exists to prevent. Sequential is also what makes the "3 of
   * 8" count honest.
   */
  const take = async (files: FileList) => {
    const list = Array.from(files)
    if (!list.length) return
    const mine = ++run.current
    setErr(null)
    const failed: string[] = []
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      if (run.current !== mine) return
      setUploading(list.length > 1 ? `${i + 1} of ${list.length} — ${f.name}` : f.name)
      try {
        const data = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = () => rej(new Error("couldn't be read"))
          r.readAsDataURL(f)
        })
        const r = await uploadMachineFile({ data, fileName: f.name, name: f.name })
        if (r?.error) failed.push(`${f.name} — ${r.error}`)
      } catch (e) {
        failed.push(`${f.name} — ${e instanceof Error ? e.message : "upload failed"}`)
      }
    }
    if (run.current !== mine) return
    setUploading(null)
    // A REFUSAL CARRIES ITS REASON. The server's sentence says which file and why (wrong
    // extension, too large, a link rather than a file); repeating "upload failed" here
    // would throw away the only useful part.
    setErr(failed.length ? failed.join(" · ") : null)
    await load()
  }

  const remove = async (f: MachineFile) => {
    if (!(await confirm({
      title: `Remove ${f.name}?`,
      /* THE HONEST HALF: taking it out of the library does not take it off the jobs it is
         already on. Deleting the bytes because somebody tidied a list would empty the
         stitch file out of orders that have shipped. */
      body: "It comes out of your library. Orders it is already attached to keep their copy — this only removes the one you pick from here.",
      confirmLabel: "Remove",
      destructive: true,
    }))) return
    setBusy(f.id)
    setItems((prev) => (prev ?? []).filter((x) => x.id !== f.id))
    try { await deleteMachineFile(f.id) } catch { load() } finally { setBusy(null) }
  }

  /**
   * SAVED WITH ITS NAME. A data: URL opened directly is saved by Chrome as "download" with
   * no extension — bytes no embroidery program will open — so it goes through a blob and an
   * anchor carrying the real filename. Same three moves the designer's own download makes.
   */
  const download = async (f: MachineFile) => {
    setBusy(f.id); setErr(null)
    try {
      const r = await downloadMachineFile(f.id)
      if (!r.data) throw new Error(r.error || "No file came back.")
      const blob = await (await fetch(r.data)).blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = href
      a.download = r.name || f.fileName || "design.emb"
      a.click()
      setTimeout(() => URL.revokeObjectURL(href), 10_000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't open that file.")
    } finally { setBusy(null) }
  }

  const rename = async (f: MachineFile) => {
    const name = editName.trim()
    setEditId(null)
    if (!name || name === f.name) return
    setItems((prev) => (prev ?? []).map((x) => (x.id === f.id ? { ...x, name } : x)))
    try { await renameMachineFile(f.id, name) } catch { load() }
  }

  const list = items ?? []

  return (
    <SectionCard title="Machine files" bodyClassName="space-y-4 p-5">
      {/*
        * ONE REGION WHEN THERE IS NOTHING, NOT TWO.
        *
        * This drew a full Dropzone and then an EmptyState directly under it, which is the
        * exact duplication CLAUDE.md §4 warns about: a drop target and an empty list are one
        * object wearing two hats. On an empty account it rendered the same needle mark twice,
        * said "drop a file here" twice in different words, and stacked two centred columns of
        * vertical padding — most of the screen was blank, and neither half explained why the
        * other one was there.
        *
        * So the zone IS the empty state, and its note is the formats and the size cap —
        * nothing else. The MF- reference used to be explained here in a second sentence,
        * which is a paragraph on a resting control nobody has asked anything of yet. It is
        * printed on every file's tile the moment one exists, which is where it can actually
        * be copied from.
        *
        * With files in it the zone goes `slim` — one inline row above the grid, which is what
        * `slim` was built for. A full-height target above a populated list is asking for a
        * file that is plainly already there.
        */}
      <Dropzone
        icon={Needle}
        multiple
        accept=".emb,.pes,.dst,.exp,.jef,.vp3,.xxx,.hus,.sew,.pcs,.vip"
        onFiles={take}
        busy={uploading}
        slim={list.length > 0}
        label={list.length > 0 ? "Add another stitch file" : "Drop your stitch files here"}
        hint=".EMB, .PES, .DST — 50 MB each"
      />

      {err && <p className="text-sm text-alert">{err}</p>}

      {items === null ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <CircleNotch size={15} className="animate-spin" /> Loading…
        </div>
      ) : list.length === 0 ? null : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((f) => (
            <div key={f.id} className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5">
              {/* A STITCH FILE HAS NO PREVIEW, and pretending otherwise is worse than the
                  mark. We cannot render an .EMB — that is the whole reason the designer
                  needed a separate "the file arrived" line — so the tile carries the format
                  as a word instead of a picture that would be a lie. */}
              <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-muted text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                {(f.fileName?.split(".").pop() || f.kind).slice(0, 4)}
              </span>
              <div className="min-w-0 flex-1">
                {editId === f.id ? (
                  <Input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => void rename(f)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void rename(f) }
                      if (e.key === "Escape") { e.preventDefault(); setEditId(null) }
                    }}
                    className="h-7 text-sm"
                    aria-label="File name"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setEditId(f.id); setEditName(f.name) }}
                    title="Click to rename"
                    className="eg-tap block max-w-full truncate text-left text-sm font-medium transition-colors hover:text-primary"
                  >
                    {f.name}
                  </button>
                )}
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="truncate text-2xs tabular-nums text-muted-foreground">
                    {formatBytes(f.bytes) ?? "—"}
                  </span>
                  {/* THE REFERENCE, at a size you can read off the screen and type. Same
                      treatment as a template's TPL- badge, because it does the same job:
                      this is the string that goes in the import sheet. */}
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(f.ref).catch(() => {}); setCopied(f.id); setTimeout(() => setCopied(null), 1400) }}
                    title="Copy this file's reference"
                    className="eg-tap ml-auto shrink-0 rounded-md bg-muted px-2 py-1 tabular-nums text-sm font-semibold text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    {copied === f.id ? "Copied" : f.ref}
                  </button>
                </div>
              </div>
              <div className="flex shrink-0 flex-col">
                <Button size="icon-sm" variant="ghost"
                  aria-label={`Download ${f.name}`}
                  disabled={busy === f.id}
                  onClick={() => void download(f)}
                >
                  {busy === f.id ? <CircleNotch size={14} className="animate-spin" /> : <DownloadSimple size={14} weight="bold" />}
                </Button>
                <Button size="icon-sm" variant="ghost"
                  aria-label={`Remove ${f.name}`}
                  disabled={busy === f.id}
                  onClick={() => void remove(f)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X size={14} weight="bold" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { PenNib, CircleNotch, UploadSimple, DownloadSimple, CaretDown, X, ArrowsClockwise } from "@phosphor-icons/react"
import { useLabelT } from "@/lib/i18n"
import { SectionCard } from "@/components/app/section-card"
import { EmptyState } from "@/components/app/empty-state"
import { Thumb } from "@/components/app/thumb"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/app/search-field"
import { FilterMenu } from "@/components/app/filter-menu"
import { useConfirm } from "@/components/app/confirm-dialog"
import { getFactoryDesigns, getFactoryDesignSellers, uploadDesignFile, downloadDesignFile, deleteDesignFile, getLibraryPreview, getLibraryCopies, replaceLibraryFile, getOrderHistory, type FactoryDesign, type LibraryFace, type LibraryCopy, type AuditRow } from "@/lib/api"
import { LibraryAttachDialog, LibraryReplaceDialog, type AttachTarget } from "@/components/app/library-file-dialogs"
import { numOf } from "@/lib/order-format"
import { normalizeMethods } from "@/lib/print-method"

/**
 * THE FACTORY'S DESIGN LIBRARY — every picture that reached an order line, once each.
 *
 * It answers the expensive question: HAVE WE DIGITISED THIS BEFORE. A design briefed twice
 * is paid for twice, and until this existed the only way to ask was per order, at the moment
 * somebody pressed Send to board — the last useful moment rather than the first.
 *
 * ONE ROW PER ARTWORK, not per order and not per upload. The key is `art_hash`, which is
 * the same identity `design_ids` issues DSN-#### from, so a picture six shops ordered is one
 * card carrying one number — and that number is the number on the board card and in the
 * designer. A card per order would answer nothing: twelve cards for one job.
 *
 * SOURCED FROM ORDER LINES, not from the sellers' own libraries. A seller's library is a
 * scratch gallery — it holds uploads nobody ordered and its listing is capped — while this
 * is artwork the floor can actually be asked to make.
 *
 * STAFF ONLY, and the server refuses a seller outright rather than trusting a tab to be
 * hidden from the right people: every card names the shops that ordered a design, and §6
 * forbids a seller ever learning theirs was used by another. The role gate on the tab (see
 * design-lab-tabs.tsx) is the second lock, not the first.
 *
 * IT LIVES IN DESIGN LAB, as the Files tab. It was its own board at /artwork; the question
 * it answers — do we already hold the stitch file for this picture — is the same question
 * the Machine files tab asks from the other end, so the two belong on one shelf.
 */

/** A page at a time. Enough that scrolling is the gesture rather than paging, small enough
 *  that the first screen arrives without waiting on a thousand rows. */
const PAGE = 60

/**
 * WHAT KIND OF FILE EACH METHOD TAKES — and why this is a gate rather than a hint.
 *
 * A stitch file is a path for a needle; a print file is pixels. They are not
 * interchangeable and neither machine can read the other's, so "attach a file" is really
 * two different requests depending on how the picture is printed. Offering one file picker
 * for both is how a .EMB ends up on a DTG shirt — which is exactly what happened when the
 * library attached by artwork alone, artwork having no method.
 *
 * So the picker only ever offers the formats the method can run. It is a filter on the OS
 * dialog, not a promise: a determined person can still pick "all files", which is why the
 * press checks the extension too and says which kind was expected.
 */
const STITCH = [".emb", ".dst", ".pes", ".exp", ".jef", ".vp3", ".xxx"]
const PRINT = [".png", ".jpg", ".jpeg", ".webp", ".svg", ".pdf", ".ai", ".eps"]
/** `emb` is the only method that runs a needle. Everything else lays down ink, foil or a
 *  laser, and all of those take a picture. */
const acceptFor = (methods?: string[]) => {
  const keys = normalizeMethods(methods ?? []).map((m) => m.key)
  if (!keys.length) return [...STITCH, ...PRINT]     // nobody has said — take either
  const wants = new Set<string>()
  for (const k of keys) for (const ext of (k === "emb" ? STITCH : PRINT)) wants.add(ext)
  return [...wants]
}
const extOf = (name: string) => (String(name).match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase()
const readFile = (file: File) => new Promise<string>((res, rej) => {
  const fr = new FileReader()
  fr.onload = () => res(String(fr.result || ""))
  fr.onerror = () => rej(new Error(`Couldn't read ${file.name}`))
  fr.readAsDataURL(file)
})

type LibraryFileRef = { design_id: string; file_name: string | null }
/** A stitch file read and waiting on the attach dialog's answer. Nothing is uploaded until
 *  the person confirms — Cancel leaves the library exactly as it was. */
type AttachAsk = { d: FactoryDesign; file: File; designId: string; data: string; seq: number
  preview: { attach: LibraryFace[]; needsMethod: LibraryFace[]; notAttached: LibraryFace[]; admin?: boolean } }
type SwapAsk = { d: FactoryDesign; f: LibraryFileRef; file: File; data: string; copies: LibraryCopy[]; seq: number }

/** One line of an artwork's history, in words. Unknown actions fall back to their name
 *  rather than vanishing — a history with gaps is worse than one with a plain label. */
function historyLine(r: AuditRow, tl: (ns: string, s: string) => string): string {
  const a = (r.after ?? {}) as Record<string, unknown>
  const b = (r.before ?? {}) as Record<string, unknown>
  const n = (v: unknown) => Number(v) || 0
  const ordersOf = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  switch (r.action) {
    case "design_file.library_added": {
      const lines = n(a.lines)
      return lines
        ? `${a.name} ${tl("artwork", "added")} · ${tl("artwork", "on")} ${lines} ${lines === 1 ? tl("artwork", "line") : tl("artwork", "lines")}`
        : `${a.name} ${tl("artwork", "added")} · ${tl("artwork", "for future orders")}`
    }
    case "design_file.auto_attached": {
      const k = ordersOf(a.orders)
      return `${tl("artwork", "Auto-attached to")} ${k} ${k === 1 ? tl("artwork", "order") : tl("artwork", "orders")}`
    }
    case "design_file.library_replaced":
      return `${tl("artwork", "Replaced with")} ${a.name} · ${n(a.swapped)} ${tl("artwork", "swapped")}, ${n(a.kept)} ${tl("artwork", "kept")}`
    case "design_file.library_removed":
      return `${b.name} ${tl("artwork", "removed")}`
    case "design_file.removed":
      return `${b.name} ${tl("artwork", "removed from an order")}`
    default:
      return r.action
  }
}

export function ArtworkLibraryPanel() {
  const tl = useLabelT()
  const [rows, setRows] = useState<FactoryDesign[] | null>(null)
  const [more, setMore] = useState(false)
  const [sellers, setSellers] = useState<{ id: string; name: string; designs: number }[]>([])
  const [seller, setSeller] = useState("")
  const [term, setTerm] = useState("")
  /** THREE STATES, not two — "still loading", "nothing matched" and "we could not ask" are
   *  different facts and §4 forbids drawing them the same. */
  const [state, setState] = useState<"loading" | "ok" | "error">("loading")
  /** Artwork we hold but have never fingerprinted — see the note on the empty state. */
  const [unhashed, setUnhashed] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  /** Which card has its orders open. ONE at a time: the point of the grid is that every
   *  card is the same object, and three cards open at three heights is a ragged wall. */
  const [openOrders, setOpenOrders] = useState<string | null>(null)
  /** Which card a file is being dragged over. One at a time — a drag has one target. */
  const [over, setOver] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /** What just happened, when it is worth saying. Not a caption — it appears only after a
   *  press and names its result. */
  const [note, setNote] = useState<string | null>(null)
  const confirm = useConfirm()
  const [ask, setAsk] = useState<AttachAsk | null>(null)
  const [swap, setSwap] = useState<SwapAsk | null>(null)
  /** One card's history open at a time, like its orders — and fetched only when opened. */
  const [openHistory, setOpenHistory] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, AuditRow[] | "loading" | "error">>({})
  const replaceRef = useRef<HTMLInputElement>(null)
  /** A fresh key per dialog, so each mounts clean (a clock reading is refused in render). */
  const seqRef = useRef(0)
  const pendingReplace = useRef<{ d: FactoryDesign; f: LibraryFileRef } | null>(null)

  useEffect(() => {
    let live = true
    getFactoryDesignSellers().then((r) => { if (live) setSellers(r.sellers ?? []) }).catch(() => {})
    return () => { live = false }
  }, [])

  /**
   * THE FILTERS ARE A FETCH, and the fetch is keyed on them — never an effect watching the
   * rows it just wrote (§2.8). `offset` is state the user MOVES with a press, so growing the
   * list is an event and not a condition that can re-satisfy itself.
   */
  const [offset, setOffset] = useState(0)
  const load = useCallback(async (at: number, append: boolean) => {
    if (!append) setState("loading")
    try {
      const r = await getFactoryDesigns({ seller: seller || null, q: term || undefined, limit: PAGE, offset: at })
      setRows((prev) => (append ? [...(prev ?? []), ...(r.designs ?? [])] : (r.designs ?? [])))
      setMore(!!r.more)
      setUnhashed(Number(r.unhashed) || 0)
      setState("ok")
    } catch {
      if (!append) setRows([])
      setState("error")
    }
  }, [seller, term])

  /* Debounced on the TERM only — a seller picked from a list is a decision, and waiting
     300ms to act on a press reads as lag. */
  useEffect(() => {
    const t = setTimeout(() => { setOffset(0); void load(0, false) }, term ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, term])

  const fileRef = useRef<HTMLInputElement>(null)
  const pending = useRef<FactoryDesign | null>(null)

  /**
   * ATTACHING AN .EMB TO THE ARTWORK ITSELF, which is the thing that had no home before.
   *
   * Every machine file until now belonged to an ORDER and was attributed to artwork by a
   * join through that order's line. This files one against the picture, so the next order
   * carrying it gets the file offered by the reuse panel without anyone remembering where
   * it came from.
   *
   * The design id is derived from the hash, so re-attaching REPLACES rather than piling up
   * a second file for one picture — the server's `on conflict (design_id) do update`.
   */
  /**
   * A SECOND FILE IS A SECOND FILE, NOT A CORRECTION.
   *
   * The id was always `ART-<hash16>`, and the server's upsert is `on conflict (design_id) do
   * update` — so attaching again REPLACED what was there, silently, which is the wrong
   * default when the usual reason to attach twice is that a picture needs a second placement
   * or the first file was wrong and you want both until you have checked. The first keeps the
   * bare id (nothing existing changes name); every one after takes a suffix.
   */
  const nextFileId = (d: FactoryDesign, taken: Set<string>) => {
    const base = `ART-${d.art_hash.slice(0, 16)}`
    if (!taken.has(base)) return base
    /* 50 suffixes is far past any real number of files for one picture, and a ceiling that
       cannot be hit is still a ceiling — the alternative was a clock reading, which the
       React Compiler refuses in a component body and which would make the id unstable
       across a re-render anyway. */
    for (let n = 2; n < 200; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
    return null
  }

  /** Store one file against the artwork, with the faces it may land on, and name it on the
   *  card at once rather than waiting on a reload. Returns how many lines it reached. */
  const fileOne = async (d: FactoryDesign, r: { file: File; designId: string; data: string }, targets: AttachTarget[]) => {
    const res = await uploadDesignFile({ designId: r.designId, name: r.file.name, data: r.data, artHash: d.art_hash, targets })
    if (res?.error) throw new Error(res.error)
    setRows((prev) => (prev ?? []).map((x) => (x.art_hash === d.art_hash
      ? { ...x, has_file: true, files: [{ design_id: r.designId, file_name: r.file.name, kind: "emb", own: true }, ...(x.files ?? [])] }
      : x)))
    setHistory((h) => { const n = { ...h }; delete n[d.art_hash]; return n })
    return res?.attached ?? 0
  }

  /**
   * ATTACH WHAT WAS DROPPED — several at once, because that is how they arrive.
   *
   * A picture routinely needs more than one file: a front and a back, a stitch file and the
   * print file for the same artwork ordered two ways. Taking one and ignoring the rest of a
   * drop is the kind of silent half-success that reads as the feature being broken.
   */
  const attachFiles = async (d: FactoryDesign, list: FileList | File[]) => {
    const picked = Array.from(list)
    if (!picked.length) return
    /* THE PICKER FILTERS, THIS REFUSES. `accept` is a hint the OS dialog can be talked out
       of — and nothing filters a DRAG at all — so a wrong file here is a stitch file on a
       printed job, the failure this whole pairing exists to stop. It names the kind that was
       expected rather than just saying no, because "wrong file" without the reason is the
       message people ignore. */
    const ok = acceptFor(d.methods)
    const bad = ok.length ? picked.filter((f) => !ok.includes(extOf(f.name))) : []
    const good = picked.filter((f) => !bad.includes(f))
    /* THE REFUSAL SURVIVES THE SUCCESS. Drop three files where one is wrong and the two that
       landed must not bury the one that did not — it is the only half a person has to act on. */
    const refusal = bad.length
      ? `${bad.map((f) => f.name).join(", ")} — ${tl("artwork", "this artwork is")} ${(d.methods ?? []).join(" · ") || "—"}, ${tl("artwork", "which takes")} ${ok.join(" ")}`
      : null
    if (!good.length) { setErr(refusal); return }

    setBusy(d.art_hash); setErr(refusal); setNote(null)
    /* IDS ARE MINTED AGAINST A SET THIS LOOP KEEPS ITSELF. `nextFileId` reads the row in
       state, which does not change between iterations, so three files in one drop would all
       have claimed the same id and overwritten each other. */
    const taken = new Set((d.files ?? []).map((f) => f.design_id))
    try {
      const read = await Promise.all(good.map(async (file) => {
        const designId = nextFileId(d, taken)
        /* Two hundred files for one picture is not a case to design for; it is a case to
           refuse out loud rather than overwrite something. */
        if (!designId) throw new Error(tl("artwork", "This design already has too many files."))
        taken.add(designId)
        return { file, designId, data: await readFile(file) }
      }))
      /**
       * ONE STITCH FILE ASKS FIRST; everything else is simply filed.
       *
       * A stitch file is the only kind that lands on orders, so it is the only kind with a
       * question to ask — and it asks it ONCE, for the first one dropped. A second stitch
       * file in the same drop is filed against the artwork without being attached: the
       * first answers every waiting face, and attaching the second after it would find
       * nothing left to fill anyway.
       */
      const first = read.find((r) => STITCH.includes(extOf(r.file.name)))
      const rest = read.filter((r) => r !== first)
      for (const r of rest) await fileOne(d, r, [])
      if (!first) return
      const preview = await getLibraryPreview(d.art_hash)
      if (preview?.error) throw new Error(preview.error)
      if (!preview.attach.length && !preview.needsMethod.length) {
        /* NOTHING IS WAITING — no dialog. Asking "attach to 0 lines?" is a question with
           nothing to decide; the file is filed and the next order carrying this picture
           takes it. */
        await fileOne(d, first, [])
        setNote(tl("artwork", "Filed — the next order carrying this artwork will get it"))
        return
      }
      setAsk({ ...first, d, preview, seq: ++seqRef.current })
    } catch (e) {
      setErr(e instanceof Error ? e.message : tl("artwork", "Couldn't attach that file."))
    } finally {
      setBusy(null)
    }
  }

  /** The dialog's answer: file it, on the faces the person left ticked. */
  const confirmAttach = async (targets: AttachTarget[]) => {
    const a = ask
    if (!a) return
    setBusy(a.d.art_hash); setErr(null)
    try {
      const reached = await fileOne(a.d, a, targets)
      /* WHERE IT WENT, SAID ONCE — a bigger thing than "uploaded". */
      setNote(reached
        ? `${reached} ${reached === 1 ? tl("artwork", "line now has it") : tl("artwork", "lines now have it")}`
        : tl("artwork", "Filed — the next order carrying this artwork will get it"))
      setAsk(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : tl("artwork", "Couldn't attach that file."))
    } finally {
      setBusy(null)
    }
  }

  /**
   * REPLACE: pick the new file, then say which orders it reaches before it reaches them.
   * The copies are read AFTER the pick — the dialog is about this file and these orders now.
   */
  const pickReplacement = async (d: FactoryDesign, f: LibraryFileRef, file: File) => {
    if (!STITCH.includes(extOf(file.name))) {
      setErr(`${file.name} — ${tl("artwork", "a replacement has to be a stitch file")}`)
      return
    }
    setBusy(f.design_id); setErr(null); setNote(null)
    try {
      const [data, c] = await Promise.all([readFile(file), getLibraryCopies(f.design_id)])
      if (c?.error) throw new Error(c.error)
      setSwap({ d, f, file, data, copies: c.copies ?? [], seq: ++seqRef.current })
    } catch (e) {
      setErr(e instanceof Error ? e.message : tl("artwork", "Couldn't read that file."))
    } finally {
      setBusy(null)
    }
  }

  const confirmReplace = async (scope: "unshipped" | "all") => {
    const a = swap
    if (!a) return
    setBusy(a.f.design_id); setErr(null)
    try {
      const r = await replaceLibraryFile(a.f.design_id, { name: a.file.name, mime: a.file.type || undefined, data: a.data, scope })
      if (r?.error || !r?.designId) throw new Error(r?.error || tl("artwork", "Couldn't replace that file."))
      const newId = r.designId
      setRows((prev) => (prev ?? []).map((x) => (x.art_hash === a.d.art_hash
        ? { ...x, files: (x.files ?? []).map((y) => (y.design_id === a.f.design_id
            ? { ...y, design_id: newId, file_name: r.fileName ?? a.file.name } : y)) }
        : x)))
      setHistory((h) => { const n = { ...h }; delete n[a.d.art_hash]; return n })
      setNote(r.swapped
        ? `${tl("artwork", "Replaced on")} ${r.swapped} ${r.swapped === 1 ? tl("artwork", "line") : tl("artwork", "lines")}`
        : tl("artwork", "Replaced for new orders"))
      setSwap(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : tl("artwork", "Couldn't replace that file."))
    } finally {
      setBusy(null)
    }
  }

  /**
   * HISTORY IS FETCHED ON THE PRESS THAT OPENS IT — an event, never an effect watching the
   * list (§2.8). Sixty cards each asking for their history on mount is sixty requests for
   * something almost nobody opens.
   */
  const toggleHistory = (d: FactoryDesign) => {
    const opening = openHistory !== d.art_hash
    setOpenHistory(opening ? d.art_hash : null)
    if (!opening || history[d.art_hash]) return
    setHistory((h) => ({ ...h, [d.art_hash]: "loading" }))
    getOrderHistory(d.art_hash)
      .then((rows) => setHistory((h) => ({ ...h, [d.art_hash]: Array.isArray(rows) ? rows : [] })))
      .catch(() => setHistory((h) => ({ ...h, [d.art_hash]: "error" })))
  }

  /**
   * FETCH IT AND HAND IT OVER. Same two steps the order panel's download does — the route
   * answers with a data URL, an anchor saves it — because a stitch file is bytes a machine
   * needs, and a name you cannot open is barely more use than a tick.
   */
  const download = async (f: { design_id: string; file_name: string | null }) => {
    setBusy(f.design_id); setErr(null)
    try {
      const r = await downloadDesignFile(f.design_id)
      if (!r?.data) throw new Error(tl("artwork", "That file has no data to download."))
      const a = document.createElement("a")
      a.href = r.data
      a.download = r.name || f.file_name || "design"
      a.click()
    } catch (e) {
      setErr(e instanceof Error ? e.message : tl("artwork", "Couldn't download that file."))
    } finally {
      setBusy(null)
    }
  }

  /**
   * ONLY THE ONES THIS SHELF OWNS.
   *
   * A file reached this card by one of two links: filed against the artwork itself, or
   * attributed through the order it was uploaded against. The second belongs to that order —
   * the delete route refuses it unless the order is still with the seller — so removing it
   * from here would be deleting somebody's order file from a library screen. `own` is the
   * server's word for the first kind, and only those carry an ×.
   */
  const removeFile = async (d: FactoryDesign, f: { design_id: string; file_name: string | null }) => {
    if (!(await confirm({
      title: `${tl("artwork", "Remove")} ${f.file_name || f.design_id}?`,
      body: tl("artwork", "New orders carrying this artwork stop getting it. Orders that already have it keep it."),
      confirmLabel: tl("artwork", "Remove"),
    }))) return
    setBusy(f.design_id); setErr(null)
    try {
      const r = await deleteDesignFile(f.design_id)
      if (r && typeof r === "object" && "error" in r && r.error) throw new Error(String(r.error))
      setRows((prev) => (prev ?? []).map((x) => {
        if (x.art_hash !== d.art_hash) return x
        const files = (x.files ?? []).filter((y) => y.design_id !== f.design_id)
        return { ...x, files, has_file: files.length > 0 }
      }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : tl("artwork", "Couldn't remove that file."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SectionCard
      /* THE COUNT IS THE TITLE. "Artwork we have been asked to print" was the tab's own name
         — Files, directly above, with this as the only thing under it — said again in bolder
         type, which is the doubling a dialog's title bar used to hide.
         What belongs in a list's header is the size of the list, and it was a 12px line
         floating under the rule where the filter that CHANGES it sits two inches away in the
         same row. Now the control and the number it moves are on one line.
         JSX, not a string: SectionCard looks a string title up in the `section` namespace,
         and a composed count has no key to look up.
         Absent while loading or empty — a card headed "0 designs" over an empty state that
         already says so is the same fact twice, and the header still draws for `actions`. */
      title={state === "ok" && rows && rows.length > 0 ? (
        <span className="tabular-nums">
          {rows.length} {rows.length === 1 ? tl("artwork", "design") : tl("artwork", "designs")}
        </span>
      ) : undefined}
      /* OVERFLOW-VISIBLE so the hover preview can leave the card: Card clips by default, and
         on the last row the 224px copy was cut off at the card's bottom edge. Nothing in this
         card relies on the clip — the header carries no background of its own. */
      className="overflow-visible"
      bodyClassName="space-y-4 p-5"
      actions={
        /**
         * THE APP'S OWN TWO CONTROLS, not a third set.
         *
         * This row was a bare `<select>` and a hand-built input: the select opened the
         * OPERATING SYSTEM's menu — a different typeface, a different shape, a list that
         * belongs to no design system — and both wore `.eg-control`'s `--input` border,
         * which is drawn at a 3:1 floor because it is the ring around a control you TYPE
         * in. Two of those side by side, above a grid of hairline cards, is the heaviest
         * thing on the screen framing the quietest.
         *
         * `FilterMenu` and `SearchField` exist for exactly this and carry the measured
         * answers: the filter is quieter than an action, has a caret, takes no fill until
         * something is chosen, and names the STATE ("All sellers" / "Leng") rather than the
         * facet. §4's own rule — a rule with no component is a wish — applies to me here:
         * the primitives were there and I typed fresh Tailwind instead.
         */
        <div className="flex flex-wrap items-center gap-2">
          <FilterMenu
            label={tl("artwork", "Filter by seller")}
            anyLabel={tl("artwork", "All sellers")}
            value={seller}
            options={sellers.map((s) => ({ value: s.id, label: `${s.name} · ${s.designs}` }))}
            onPick={setSeller}
          />
          <SearchField
            value={term}
            onChange={setTerm}
            onClear={() => setTerm("")}
            width="sm"
            placeholder={tl("artwork", "DSN-1042, or a design name")}
            ariaLabel={tl("artwork", "Search the artwork library")}
          />
        </div>
      }
    >
      {/* Portalled to the body, so it opens above the shell rather than inside this column. */}
      {/* NO LIGHTBOX. Nothing opens one here any more — hovering a card shows the
          picture at judging size, which is what the modal was for. */}

      {/* THE COUNT MOVED INTO THE HEADER — see the title above. It was a line of its own
          under the rule, which is the one place it could not be read beside the filter that
          changes it. It is still just the count: "· 120 with no file" was the same number
          twice on a library where almost nothing is digitised, and it counted the rows
          LOADED rather than the library, so Load more made it wrong. */}

      {err && <p className="text-sm text-destructive">{err}</p>}
      {note && !err && <p className="text-sm font-medium text-success">{note}</p>}

      {state === "loading" && !rows?.length ? (
        <div className="flex items-center justify-center py-14 text-muted-foreground">
          <CircleNotch size={20} className="animate-spin" />
        </div>
      ) : state === "error" ? (
        <EmptyState
          icon={PenNib}
          title={tl("artwork", "Couldn't load the artwork library")}
          note={tl("artwork", "The list is there — we couldn't reach it just now.")}
          action={<Button variant="outline" size="sm" onClick={() => void load(0, false)}>{tl("artwork", "Try again")}</Button>}
        />
      ) : !rows?.length ? (
        <EmptyState
          icon={PenNib}
          /* THREE EMPTIES, NOT ONE. A filter that matched nothing, a floor that has
             printed nothing, and artwork we hold but have never fingerprinted are three
             different facts, and only the last one is ours to fix. */
          title={seller || term
            ? tl("artwork", "Nothing matches that")
            : unhashed > 0
              ? tl("artwork", "No artwork here has been fingerprinted yet")
              : tl("artwork", "No artwork has reached an order yet")}
          note={seller || term
            ? tl("artwork", "Clear the filter to see every design the floor has been asked to print.")
            : unhashed > 0
              ? `${unhashed} ${unhashed === 1 ? tl("artwork", "design carries") : tl("artwork", "designs carry")} ${tl("artwork", "artwork with no fingerprint, so they cannot be matched to each other yet.")}`
              : tl("artwork", "A design appears here once it is placed on an order line.")}
          action={(seller || term)
            ? <Button variant="outline" size="sm" onClick={() => { setSeller(""); setTerm("") }}>{tl("artwork", "Clear filter")}</Button>
            : undefined}
        />
      ) : (
        <>
          {/**
            * CARDS IN A GRID, NOT ONE ROW PER SCREEN WIDTH.
            *
            * This was a full-bleed `divide-y` list: the thumbnail sat against the card's
            * left border, the Attach button against its right, and on a wide monitor the
            * two facts a reader has to pair — which picture, and do we hold its file —
            * were a metre apart with a field of empty grey between them. Nothing on the
            * row was wrong; the measure was. A reader tracking that gap loses the line.
            *
            * A card is a bounded object: the picture, its number and its answer are inside
            * one border, and the eye travels a card's width instead of the window's. Three
            * per row on a large screen is the same shape the Machine files tab already
            * uses, which is the point — they are two halves of one question and they now
            * read as one shelf.
            */}
          {/**
            * A CARD IS A PICTURE FIRST (owner, 2026-09-25: the cards were "way too small or
            * quite squished together"). The artwork fills the card's width at the size it is
            * judged at — which is why the hover copy is gone: it existed to make an 80px tile
            * checkable, and the tile is now bigger than that copy was.
            *
            * Beneath it, in the order the question is asked: which design, how many orders,
            * the file we hold (download · Replace · ×), a way to attach one, and the history
            * of that file folded to one line.
            */}
          <ul className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {rows.map((d) => {
              const open = openOrders === d.art_hash
              const own = (d.files ?? []).filter((f) => f.own)
              /* A file reached this card either filed against the artwork (own) or through an
                 order it was uploaded on. Copies the library itself put on orders carry the
                 artwork too, so listing everything would print one filename once per order.
                 The library's own file is the answer when there is one; order files are
                 shown only when there is not, once per name. */
              const shown = own.length ? own : (d.files ?? []).filter((f, i, all) => all.findIndex((x) => x.file_name === f.file_name) === i)
              const hist = history[d.art_hash]
              const histOpen = openHistory === d.art_hash
              return (
              /* THE WHOLE CARD TAKES THE DROP — a stitch file arrives in an email and leaves
                 the browser again as a drag, so dragging IS the gesture; the button is the
                 keyboard route. Only a FILE drag lights it. */
              <li
                key={d.art_hash}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return
                  e.preventDefault()
                  if (over !== d.art_hash) setOver(d.art_hash)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
                }}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return
                  e.preventDefault()
                  setOver(null)
                  void attachFiles(d, e.dataTransfer.files)
                }}
                className={"flex flex-col gap-3 rounded-xl border bg-card p-3.5 transition-colors "
                  + (over === d.art_hash ? "border-primary bg-accent" : "border-border")}
              >
                <Thumb src={d.thumb} alt={d.name ?? ""} fit="contain"
                  className="aspect-[4/3] w-full rounded-lg border border-border bg-white p-2"
                  icon={<PenNib size={28} weight="duotone" className="text-muted-foreground/40" />} />

                <div className="min-w-0 space-y-0.5">
                  <div className="flex min-w-0 items-baseline gap-2">
                    {/* THE NUMBER IS THE NAME — an identifier, so text-sm (§4). */}
                    <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums">
                      {d.design_no != null ? `DSN-${d.design_no}` : tl("artwork", "Not numbered")}
                    </span>
                    {(() => {
                      /* HOW IT IS PRINTED — a pill that carries meaning: it decides which file
                         this card accepts. Both when a picture has been ordered both ways. */
                      const ms = normalizeMethods(d.methods ?? [])
                      const why = ms.length > 1
                        ? `${tl("artwork", "Ordered as")} ${ms.map((m) => m.label).join(" + ")}`
                        : ms[0]?.label
                      return ms.map((m) => (
                        <span key={m.key} title={why}
                          className={"shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide "
                            + (m.key === "emb" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                          {m.key}
                        </span>
                      ))
                    })()}
                    {d.name && <span className="min-w-0 truncate text-sm text-muted-foreground">{d.name}</span>}
                  </div>
                  {/* THE COUNT IS A DOOR to which orders; the sellers sit beside it (staff-only, §6). */}
                  <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => setOpenOrders((k) => (k === d.art_hash ? null : d.art_hash))}
                      aria-expanded={open}
                      className="flex shrink-0 items-center gap-0.5 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      title={tl("artwork", "Which orders carried this artwork")}
                    >
                      <span className="tabular-nums">{d.orders}</span> {d.orders === 1 ? tl("artwork", "order") : tl("artwork", "orders")}
                      <CaretDown size={10} weight="bold" className={"opacity-60 transition-transform " + (open ? "rotate-180" : "")} />
                    </button>
                    <span className="shrink-0" aria-hidden>·</span>
                    <span className="truncate">
                      {d.seller_names.length <= 2
                        ? d.seller_names.join(", ")
                        : <span title={d.seller_names.join(", ")}>{d.sellers} {tl("artwork", "sellers")}</span>}
                    </span>
                  </div>
                </div>

                {open && (
                  <div className="border-t border-border pt-2">
                    {d.order_refs?.length ? (
                      <>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {d.order_refs.map((o) => (
                            <Link key={o.id} href={`/orders/${encodeURIComponent(o.id)}`}
                              className="text-sm tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                              {numOf(o as Parameters<typeof numOf>[0])}
                            </Link>
                          ))}
                        </div>
                        {d.orders > d.order_refs.length && (
                          <p className="mt-1 text-xs text-muted-foreground">+{d.orders - d.order_refs.length} {tl("artwork", "more")}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">{tl("artwork", "The orders for this design are not listed here.")}</p>
                    )}
                  </div>
                )}

                {/* THE ANSWER THE TAB EXISTS FOR: the file we hold, named, and each one opens. */}
                <div className="space-y-1">
                  {shown.map((f) => (
                    <div key={f.design_id} className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={busy === f.design_id}
                        onClick={() => void download(f)}
                        title={`${tl("artwork", "Download")} ${f.file_name || f.design_id}`}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-success enabled:hover:underline disabled:cursor-default"
                      >
                        {busy === f.design_id
                          ? <CircleNotch size={14} className="shrink-0 animate-spin" />
                          : <DownloadSimple size={14} weight="bold" className="shrink-0" />}
                        <span className="truncate">{f.file_name || tl("artwork", "File on record")}</span>
                      </button>
                      {f.own && (f.kind === "emb" || f.kind === "pes") && (
                        <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                          disabled={busy === f.design_id}
                          title={tl("artwork", "Replace this file — you choose which orders get the new one")}
                          onClick={() => {
                            pendingReplace.current = { d, f }
                            if (replaceRef.current) replaceRef.current.accept = STITCH.join(",")
                            replaceRef.current?.click()
                          }}>
                          <ArrowsClockwise size={12} weight="bold" />
                          {tl("artwork", "Replace")}
                        </Button>
                      )}
                      {f.own && (
                        <button
                          type="button"
                          disabled={busy === f.design_id}
                          onClick={() => void removeFile(d, f)}
                          title={tl("artwork", "Remove this file")}
                          aria-label={`${tl("artwork", "Remove")} ${f.file_name || f.design_id}`}
                          className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                        >
                          <X size={10} weight="bold" />
                        </button>
                      )}
                    </div>
                  ))}
                  {/* THE BUTTON NEVER LEAVES — a card with a file still takes a second one.
                      Ghost, because there are sixty of them on the page. */}
                  <Button
                    variant="ghost" size="sm"
                    className="-ml-2 text-muted-foreground hover:text-foreground"
                    disabled={busy === d.art_hash}
                    onClick={() => {
                      pending.current = d
                      if (fileRef.current) fileRef.current.accept = acceptFor(d.methods).join(",")
                      fileRef.current?.click()
                    }}
                    title={tl("artwork", "Attach a file for this artwork — you'll see which orders it goes onto before it does")}
                  >
                    {busy === d.art_hash
                      ? <CircleNotch size={14} className="animate-spin" />
                      : <UploadSimple size={14} weight="bold" />}
                    {shown.length ? tl("artwork", "Add file") : tl("artwork", "Attach file")}
                  </Button>
                </div>

                {/**
                  * HISTORY, FOLDED TO ONE LINE (owner: "should be smaller or collapsible").
                  * Only on a card with a file of its own — a card with nothing filed has no
                  * file history to tell.
                  */}
                {own.length > 0 && (
                  <div className="border-t border-border pt-1.5">
                    <button type="button" onClick={() => toggleHistory(d)} aria-expanded={histOpen}
                      className="flex h-7 w-full items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground">
                      <span className="flex-1">{tl("artwork", "History")}</span>
                      {Array.isArray(hist) && <span className="tabular-nums">{hist.length}</span>}
                      <CaretDown size={10} weight="bold" className={"transition-transform " + (histOpen ? "rotate-180" : "")} />
                    </button>
                    {histOpen && (
                      hist === "loading" || !hist ? (
                        <div className="py-2 text-muted-foreground"><CircleNotch size={14} className="animate-spin" /></div>
                      ) : hist === "error" ? (
                        <p className="py-1 text-xs text-destructive">{tl("artwork", "Couldn't load the history.")}</p>
                      ) : !hist.length ? (
                        /* Files filed before history was kept have none — say which kind of
                           empty this is (§4), not a blank. */
                        <p className="py-1 text-xs text-muted-foreground">{tl("artwork", "Nothing recorded yet — history starts from today.")}</p>
                      ) : (
                        <ol className="space-y-2 py-1.5">
                          {hist.map((r) => (
                            <li key={r.id} className="space-y-px">
                              <div className="text-xs font-medium">{historyLine(r, tl)}</div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(r.ts).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                                {" · "}{r.actor_name || r.actor_email || (r.actor_role === "system" ? tl("artwork", "System") : r.actor_role) || tl("artwork", "System")}
                              </div>
                            </li>
                          ))}
                        </ol>
                      )
                    )}
                  </div>
                )}
              </li>
            )})}
          </ul>

          {more && (
            /* INCREMENTAL LOADING IS AN EVENT — a press, which cannot recur on its own.
               Never an effect watching the list's own length (§2.8). */
            <div>
              <Button variant="outline" size="sm" className="w-full"
                disabled={state === "loading"}
                onClick={() => { const at = offset + PAGE; setOffset(at); void load(at, true) }}>
                {state === "loading" ? <CircleNotch size={14} className="animate-spin" /> : null}
                {tl("artwork", "Load more")}
              </Button>
            </div>
          )}
        </>
      )}

      {/* One input for every card — opening the OS dialog takes focus off the page, and a
          picker per card would be sixty of them mounted. */}
      <input
        ref={fileRef}
        type="file"
        multiple
        /* The union, narrowed on every press to what the pressed card's method can run. */
        accept={[...STITCH, ...PRINT].join(",")}
        className="hidden"
        onChange={(e) => {
          const list = e.target.files
          const d = pending.current
          const picked = list ? Array.from(list) : []
          e.target.value = ""
          pending.current = null
          if (picked.length && d) void attachFiles(d, picked)
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={STITCH.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          const p = pendingReplace.current
          e.target.value = ""
          pendingReplace.current = null
          if (file && p) void pickReplacement(p.d, p.f, file)
        }}
      />

      {/* KEYED PER UPLOAD, so each opens with its own ticks rather than resetting in an effect. */}
      {ask && (
        <LibraryAttachDialog
          key={ask.seq}
          fileName={ask.file.name}
          designNo={ask.d.design_no}
          attach={ask.preview.attach}
          needsMethod={ask.preview.needsMethod}
          notAttached={ask.preview.notAttached}
          admin={!!ask.preview.admin}
          busy={busy === ask.d.art_hash}
          onCancel={() => setAsk(null)}
          onConfirm={(t) => void confirmAttach(t)}
        />
      )}
      {swap && (
        <LibraryReplaceDialog
          key={swap.seq}
          designNo={swap.d.design_no}
          oldName={swap.f.file_name || swap.f.design_id}
          newName={swap.file.name}
          copies={swap.copies}
          busy={busy === swap.f.design_id}
          onCancel={() => setSwap(null)}
          onConfirm={(scope) => void confirmReplace(scope)}
        />
      )}
    </SectionCard>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { PenNib, CircleNotch, UploadSimple, DownloadSimple, CaretDown, X } from "@phosphor-icons/react"
import { useLabelT } from "@/lib/i18n"
import { SectionCard } from "@/components/app/section-card"
import { EmptyState } from "@/components/app/empty-state"
import { Thumb } from "@/components/app/thumb"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/app/search-field"
import { FilterMenu } from "@/components/app/filter-menu"
import { useLightbox } from "@/components/app/image-lightbox"
import { useConfirm } from "@/components/app/confirm-dialog"
import { getFactoryDesigns, getFactoryDesignSellers, uploadDesignFile, downloadDesignFile, deleteDesignFile, type FactoryDesign } from "@/lib/api"
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
  const lightbox = useLightbox()
  const confirm = useConfirm()

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
    const added: { design_id: string; file_name: string; kind: string; own: boolean }[] = []
    let reached = 0
    try {
      for (const file of good) {
        const data = await new Promise<string>((res, rej) => {
          const fr = new FileReader()
          fr.onload = () => res(String(fr.result || ""))
          fr.onerror = () => rej(new Error(tl("artwork", "Couldn't read that file")))
          fr.readAsDataURL(file)
        })
        const designId = nextFileId(d, taken)
        /* Two hundred files for one picture is not a case to design for; it is a case to
           refuse out loud rather than overwrite something. */
        if (!designId) throw new Error(tl("artwork", "This design already has too many files."))
        taken.add(designId)
        const r = await uploadDesignFile({ designId, name: file.name, data, artHash: d.art_hash })
        if (r?.error) throw new Error(r.error)
        reached += r?.attached ?? 0
        added.push({ design_id: designId, file_name: file.name, kind: "emb", own: true })
      }
      /* WHERE THEY WENT, SAID ONCE. The upload puts each file on every order line carrying
         this exact artwork and waiting for one, and that is a bigger thing than "uploaded" —
         it is the answer to the question this tab exists to ask. 0 gets no line: nothing
         waiting is the ordinary case and not news. */
      if (reached) {
        setNote(`${reached} ${reached === 1 ? tl("artwork", "order now has it") : tl("artwork", "orders now have it")}`)
      }
      /* NAME THEM IMMEDIATELY. The upload knows what it just sent, so the card can say what
         is on record without waiting for a reload. Newest first, which is the order the
         listing returns them in. */
      if (added.length) {
        setRows((prev) => (prev ?? []).map((x) => (x.art_hash === d.art_hash
          ? { ...x, has_file: true, files: [...added.reverse(), ...(x.files ?? [])] }
          : x)))
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : tl("artwork", "Couldn't attach that file."))
    } finally {
      setBusy(null)
    }
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
      body: tl("artwork", "The next order carrying this artwork will not be offered it."),
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
      /* A plain string: SectionCard translates its own title under the `section`
         namespace, so wrapping it here would ask for the key twice. */
      title="Artwork we have been asked to print"
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
      {lightbox.node}

      {state === "ok" && rows && rows.length > 0 && (
        /* A COUNT, NOT A SENTENCE. It is a fact about the list and it is the thing that
           says whether the filter did anything.
           JUST THE COUNT. It carried "· 120 with no file" beside it, which on a library
           where almost nothing is digitised yet is the same number twice — and it is a
           tally of the rows LOADED, not of the library, so it would have been wrong the
           moment Load more was pressed. Each card already says whether it has a file. */
        <p className="text-xs tabular-nums text-muted-foreground">
          {rows.length} {rows.length === 1 ? tl("artwork", "design") : tl("artwork", "designs")}
        </p>
      )}

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
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map((d) => {
              const open = openOrders === d.art_hash
              return (
              /* items-start once a card can grow: centred, the thumbnail drifts down the
                 card as the order list opens under the text beside it. */
              /**
                * THE WHOLE CARD TAKES THE DROP.
                *
                * Not `components/app/dropzone.tsx`, and the rule says to check: that
                * primitive DRAWS a zone — its own box, label, hint and receipt — and what is
                * wanted here is for an existing object to accept a drop, the way a column
                * accepts a card. Wrapping every row in a second bordered box to get four
                * event handlers would be the ring-inside-a-ring this card already fixed once.
                *
                * A stitch file arrives in an email and leaves the browser again as a drag, so
                * dragging IS the gesture — a button is the fallback, not the route. The
                * button stays because a drop target with no click route cannot be reached
                * from a keyboard.
                */
              <li
                key={d.art_hash}
                onDragOver={(e) => {
                  /* Only a FILE drag. Without this a dragged link or a selected word lights
                     up every card it crosses and the page looks like it is malfunctioning. */
                  if (!e.dataTransfer.types.includes("Files")) return
                  e.preventDefault()
                  if (over !== d.art_hash) setOver(d.art_hash)
                }}
                /* relatedTarget is where the pointer WENT. Crossing onto a child fires
                   dragleave on the parent, so without this test the highlight flickers off
                   the moment the pointer reaches the thumbnail. */
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
                }}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return
                  e.preventDefault()
                  setOver(null)
                  void attachFiles(d, e.dataTransfer.files)
                }}
                className={"flex items-start gap-3 rounded-xl border bg-card p-2.5 transition-colors "
                  + (over === d.art_hash ? "border-primary bg-accent" : "border-border")}
              >
                {/* The picture is the identification; everything beside it is confirmation.
                    A press opens it full size rather than navigating away — judging artwork
                    is why anyone is on this tab. */}
                <button
                  type="button"
                  onClick={() => lightbox.open(d.thumb, d.name ?? undefined)}
                  className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  title={tl("artwork", "Open full size")}
                >
                  <Thumb src={d.thumb} alt="" fit="contain"
                    className="size-14 rounded-md border border-border bg-muted p-1"
                    icon={<PenNib size={18} weight="duotone" className="text-muted-foreground/40" />} />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    {/* THE NUMBER IS THE NAME. It is what the board card and the designer
                        call this picture, and it is an identifier — so `text-sm`, never
                        the 11px a mark gets (§4: a value is not a caption). */}
                    <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums">
                      {d.design_no != null ? `DSN-${d.design_no}` : tl("artwork", "Not numbered")}
                    </span>
                    {/**
                      * HOW IT IS PRINTED — a pill, because this one carries meaning (§4: a
                      * pill must be an order stage, an HTTP method, RUSH/LATE; a technique
                      * is the same kind of fact, and it is what decides which file the card
                      * will accept). Both are shown when a picture is ordered both ways,
                      * because claiming one would be the lie the library made by claiming
                      * none. Nothing is drawn when nobody has said yet — an empty pill is
                      * not an answer.
                      */}
                    {(() => {
                      const ms = normalizeMethods(d.methods ?? [])
                      /* WHAT THE PILL IS A FACT ABOUT. Two of them beside a DSN read as
                         "this design IS both", which is a property of the picture and not
                         what this says. It says the picture has been ORDERED both ways — on
                         DSN-1131, a cotton shirt printed DTG on one order and an apron
                         embroidered on another. Same artwork, two jobs, and it needs a file
                         of each kind. The title says so in words; one method needs no
                         explaining and gets the short form. */
                      const why = ms.length > 1
                        ? `${tl("artwork", "Ordered as")} ${ms.map((m) => m.label).join(" + ")}`
                        : ms[0]?.label
                      return ms.map((m) => (
                        <span
                          key={m.key}
                          className={"shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide "
                            + (m.key === "emb" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}
                          title={why}
                        >
                          {m.key}
                        </span>
                      ))
                    })()}
                    {d.name && <span className="min-w-0 truncate text-sm text-muted-foreground">{d.name}</span>}
                  </div>
                  {/**
                    * THE COUNT IS A DOOR. "3 orders" was the end of the sentence, and the
                    * question it leaves is always WHICH — that is what somebody types into
                    * the order search to go and look at the job. So the count opens the
                    * numbers rather than a second line carrying them on every card: sixty
                    * cards each printing three order refs is a wall of digits, and the
                    * picture stops being the thing you see.
                    *
                    * A CARET, because that is what says "this opens". The seller names stay
                    * beside it and outside the button — they are a fact about the row, not
                    * part of the control, and §6 already decides they are staff-only.
                    */}
                  <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
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
                    {/* WHO ORDERED IT, named rather than counted when the list is short —
                        "3 sellers" is the fact a support question starts from, and the names
                        are what answers it. Staff-only surface; §6 governs where this may
                        be read, and it is read nowhere else. */}
                    <span className="truncate">
                      {d.seller_names.length <= 2
                        ? d.seller_names.join(", ")
                        : <span title={d.seller_names.join(", ")}>{d.sellers} {tl("artwork", "sellers")}</span>}
                    </span>
                  </div>

                  {/**
                    * THE ORDERS, NESTED UNDER THE COUNT THAT OPENED THEM.
                    *
                    * Inside the card and under a hairline, so it reads as part of this row
                    * and not as a new one. Each is a LINK to the order: an order number a
                    * person then has to copy into a search is half an answer.
                    *
                    * `text-sm`, not the 12px of the line above it (§4 — a value is not a
                    * caption). EGF-002247 is read digit by digit and typed somewhere else,
                    * which is the whole definition of a value; the words around it are
                    * labels and stay at 12.
                    */}
                  {open && (
                    <div className="mt-2 border-t border-border pt-2">
                      {d.order_refs?.length ? (
                        <>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {d.order_refs.map((o) => (
                              <Link
                                key={o.id}
                                href={`/orders/${encodeURIComponent(o.id)}`}
                                className="text-sm tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              >
                                {numOf(o as Parameters<typeof numOf>[0])}
                              </Link>
                            ))}
                          </div>
                          {d.orders > d.order_refs.length && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              +{d.orders - d.order_refs.length} {tl("artwork", "more")}
                            </p>
                          )}
                        </>
                      ) : (
                        /* The listing is capped and an older row may carry none. Say which
                           it is rather than opening onto nothing (§4). */
                        <p className="text-xs text-muted-foreground">{tl("artwork", "The orders for this design are not listed here.")}</p>
                      )}
                    </div>
                  )}

                  {/**
                    * THE ANSWER THE TAB EXISTS FOR, UNDER THE NAME RATHER THAN ACROSS THE
                    * PAGE FROM IT: do we already hold a stitch file for this picture.
                    *
                    * It was pinned to the far end of a full-width row, so the mark that
                    * answers the question and the picture it answers it about never sat in
                    * one glance. Here it is the third line of the card — read after what
                    * the thing is, which is the order the question is actually asked in.
                    */}
                  <div className="mt-1.5 space-y-1">
                    {/**
                      * EVERY FILE, NAMED, AND EACH ONE OPENS.
                      *
                      * "File on record" was a tick: it said a stitch file existed and not
                      * WHICH, so the only way to check the right one was filed was to find an
                      * order carrying the artwork. And it showed one — a picture can end up
                      * with a second file because the first was wrong, or because a second
                      * placement needs its own, and a card that draws one cannot be used to
                      * fix either.
                      *
                      * A filename is a value, not a caption (§4), so `text-sm`, truncated
                      * rather than wrapped.
                      */}
                    {(d.files ?? []).map((f) => (
                      <div key={f.design_id} className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={busy === f.design_id}
                          onClick={() => void download(f)}
                          title={`${tl("artwork", "Download")} ${f.file_name || f.design_id}`}
                          className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-success enabled:hover:underline disabled:cursor-default"
                        >
                          {busy === f.design_id
                            ? <CircleNotch size={14} className="shrink-0 animate-spin" />
                            : <DownloadSimple size={14} weight="bold" className="shrink-0" />}
                          <span className="truncate">{f.file_name || tl("artwork", "File on record")}</span>
                        </button>
                        {f.own && (
                          <button
                            type="button"
                            disabled={busy === f.design_id}
                            onClick={() => void removeFile(d, f)}
                            title={tl("artwork", "Remove this file")}
                            aria-label={`${tl("artwork", "Remove")} ${f.file_name || f.design_id}`}
                            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                          >
                            <X size={10} weight="bold" />
                          </button>
                        )}
                      </div>
                    ))}
                    {/* THE BUTTON NEVER LEAVES. A card with a file still needs a way to add
                        the second one or replace a wrong one, and the only way to do that was
                        to find an order carrying the artwork. It reads "Add file" once there
                        is one, because that is what it does — the × above removes. */}
                    {(

                      /**
                       * QUIET, BECAUSE THERE ARE SIXTY OF THEM.
                       *
                       * It was `outline`, which draws a ring inside a card that is already a
                       * ring — and on a page where almost every card is waiting for a file,
                       * sixty outlined buttons are sixty claims to be the main action, which
                       * is §4's count of 211 outlines happening again on one screen. Ghost
                       * keeps the hover and the press and drops the second border, so it
                       * sits at the same weight as the filename that replaces it once a file
                       * lands — the two states of one slot, drawn alike.
                       */
                      <Button
                        variant="ghost" size="sm"
                        className="-ml-2 text-muted-foreground hover:text-foreground"
                        disabled={busy === d.art_hash}
                        onClick={() => {
                          pending.current = d
                          /* ONE INPUT, SET PER PRESS. Sixty pickers mounted is sixty
                             elements for a control used once; the accept list is the only
                             thing that differs per card, so it is written on the way in. */
                          if (fileRef.current) fileRef.current.accept = acceptFor(d.methods).join(",")
                          fileRef.current?.click()
                        }}
                        title={tl("artwork", "Attach the machine file for this artwork — the next order carrying it will be offered this file")}
                      >
                        {busy === d.art_hash
                          ? <CircleNotch size={14} className="animate-spin" />
                          : <UploadSimple size={14} weight="bold" />}
                        {d.files?.length ? tl("artwork", "Add file") : tl("artwork", "Attach file")}
                      </Button>
                    )}
                  </div>
                </div>
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
    </SectionCard>
  )
}

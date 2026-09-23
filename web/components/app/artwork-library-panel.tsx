"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { PenNib, CircleNotch, UploadSimple, DownloadSimple, CaretDown } from "@phosphor-icons/react"
import { useLabelT } from "@/lib/i18n"
import { SectionCard } from "@/components/app/section-card"
import { EmptyState } from "@/components/app/empty-state"
import { Thumb } from "@/components/app/thumb"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/app/search-field"
import { FilterMenu } from "@/components/app/filter-menu"
import { useLightbox } from "@/components/app/image-lightbox"
import { getFactoryDesigns, getFactoryDesignSellers, uploadDesignFile, downloadDesignFile, type FactoryDesign } from "@/lib/api"
import { numOf } from "@/lib/order-format"

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
  const [err, setErr] = useState<string | null>(null)
  const lightbox = useLightbox()

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
  const attach = async (d: FactoryDesign, file: File) => {
    setBusy(d.art_hash); setErr(null)
    try {
      const data = await new Promise<string>((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result || ""))
        fr.onerror = () => rej(new Error(tl("artwork", "Couldn't read that file")))
        fr.readAsDataURL(file)
      })
      const r = await uploadDesignFile({
        designId: `ART-${d.art_hash.slice(0, 16)}`,
        name: file.name,
        data,
        artHash: d.art_hash,
      })
      if (r?.error) throw new Error(r.error)
      /* NAME IT IMMEDIATELY. The upload knows the file it just sent, so the card can say
         which file is on record without waiting for a reload to tell it — the id is the
         one the server derives from the hash, which is what makes re-attaching a REPLACE
         rather than a second file for one picture. */
      setRows((prev) => (prev ?? []).map((x) => (x.art_hash === d.art_hash
        ? { ...x, has_file: true, file_id: `ART-${d.art_hash.slice(0, 16)}`, file_name: file.name }
        : x)))
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
  const download = async (d: FactoryDesign) => {
    if (!d.file_id) return
    setBusy(d.art_hash); setErr(null)
    try {
      const r = await downloadDesignFile(d.file_id)
      if (!r?.data) throw new Error(tl("artwork", "That file has no data to download."))
      const a = document.createElement("a")
      a.href = r.data
      a.download = r.name || d.file_name || "design"
      a.click()
    } catch (e) {
      setErr(e instanceof Error ? e.message : tl("artwork", "Couldn't download that file."))
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
              <li key={d.art_hash} className="flex items-start gap-3 rounded-xl border border-border bg-card p-2.5">
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
                  <div className="mt-1.5">
                    {d.has_file ? (
                      /**
                       * THE FILE'S NAME, AND IT OPENS. "File on record" was a tick: it said
                       * a stitch file existed and not WHICH, and there was no way to look at
                       * the thing it was talking about — so the only way to check the right
                       * file was filed was to find an order carrying the artwork.
                       *
                       * It is a value, not a caption (§4), so the name is at `text-sm` and
                       * truncates rather than wrapping the card. A file we hold but cannot
                       * name still says so, because the two links `has_file` reads are not
                       * both able to produce a filename.
                       */
                      <button
                        type="button"
                        disabled={!d.file_id || busy === d.art_hash}
                        onClick={() => void download(d)}
                        title={d.file_id ? `${tl("artwork", "Download")} ${d.file_name || d.file_id}` : undefined}
                        className="flex max-w-full items-center gap-1.5 text-sm font-medium text-success enabled:hover:underline disabled:cursor-default"
                      >
                        {busy === d.art_hash
                          ? <CircleNotch size={14} className="shrink-0 animate-spin" />
                          : <DownloadSimple size={14} weight="bold" className="shrink-0" />}
                        <span className="truncate">{d.file_name || tl("artwork", "File on record")}</span>
                      </button>
                    ) : (
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
                        onClick={() => { pending.current = d; fileRef.current?.click() }}
                        title={tl("artwork", "Attach the machine file for this artwork — the next order carrying it will be offered this file")}
                      >
                        {busy === d.art_hash
                          ? <CircleNotch size={14} className="animate-spin" />
                          : <UploadSimple size={14} weight="bold" />}
                        {tl("artwork", "Attach file")}
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
        accept=".emb,.pes,.dst,.exp,.jef,.vp3,.xxx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          const d = pending.current
          e.target.value = ""
          pending.current = null
          if (f && d) void attach(d, f)
        }}
      />
    </SectionCard>
  )
}

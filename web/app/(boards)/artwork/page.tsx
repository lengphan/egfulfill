"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PenNib, CircleNotch, UploadSimple, Check, MagnifyingGlass } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { EmptyState } from "@/components/app/empty-state"
import { Thumb } from "@/components/app/thumb"
import { Button } from "@/components/ui/button"
import { useLightbox } from "@/components/app/image-lightbox"
import { getFactoryDesigns, getFactoryDesignSellers, uploadDesignFile, type FactoryDesign } from "@/lib/api"

/**
 * THE FACTORY'S DESIGN LIBRARY — every picture that reached an order line, once each.
 *
 * It answers the expensive question: HAVE WE DIGITISED THIS BEFORE. A design briefed twice
 * is paid for twice, and until this page the only way to ask was per order, at the moment
 * somebody pressed Send to board — the last useful moment rather than the first.
 *
 * ONE ROW PER ARTWORK, not per order and not per upload. The key is `art_hash`, which is
 * the same identity `design_ids` issues DSN-#### from, so a picture six shops ordered is one
 * row carrying one number — and that number is the number on the board card and in the
 * designer. A row per order would answer nothing: twelve rows for one job.
 *
 * SOURCED FROM ORDER LINES, not from the sellers' own libraries. A seller's library is a
 * scratch gallery — it holds uploads nobody ordered and its listing is capped — while this
 * is artwork the floor can actually be asked to make.
 *
 * STAFF ONLY, and the server refuses a seller outright rather than trusting this page to
 * exist behind the right nav: every row names the shops that ordered a design, and §6
 * forbids a seller ever learning theirs was used by another.
 */

/** A page at a time. Enough that scrolling is the gesture rather than paging, small enough
 *  that the first screen arrives without waiting on a thousand rows. */
const PAGE = 60

export default function ArtworkLibraryPage() {
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
        fr.onerror = () => rej(new Error("Couldn't read that file"))
        fr.readAsDataURL(file)
      })
      const r = await uploadDesignFile({
        designId: `ART-${d.art_hash.slice(0, 16)}`,
        name: file.name,
        data,
        artHash: d.art_hash,
      })
      if (r?.error) throw new Error(r.error)
      setRows((prev) => (prev ?? []).map((x) => (x.art_hash === d.art_hash ? { ...x, has_file: true } : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't attach that file.")
    } finally {
      setBusy(null)
    }
  }

  const waiting = useMemo(() => (rows ?? []).filter((r) => !r.has_file).length, [rows])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Artwork</h1>
      </div>

      {/* A FILTER AND A SEARCH ARE FIELDS, not buttons — §4: shape says KIND. Both are
          `.eg-control`, which is the Input's own border and radius at normal weight. */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={seller}
          onChange={(e) => setSeller(e.target.value)}
          aria-label="Filter by seller"
          className="eg-control h-9 min-w-48 px-2.5 text-sm"
        >
          <option value="">All sellers</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.designs}</option>
          ))}
        </select>
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="DSN-1042, or a design name"
            aria-label="Search the artwork library"
            className="eg-control h-9 w-full pl-8 pr-2.5 text-sm"
          />
        </div>
        {state === "ok" && rows && (
          /* A COUNT, NOT A SENTENCE. It is a fact about the list and it is the thing that
             says whether the filter did anything. */
          <span className="ms-auto text-xs tabular-nums text-muted-foreground">
            {rows.length} {rows.length === 1 ? "design" : "designs"}
            {waiting > 0 && <> · <span className="font-medium text-foreground">{waiting} with no file</span></>}
          </span>
        )}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <SectionCard>
        {state === "loading" && !rows?.length ? (
          <div className="flex items-center justify-center py-14 text-muted-foreground">
            <CircleNotch size={20} className="animate-spin" />
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={PenNib}
            title="Couldn't load the artwork library"
            note="The list is there — we couldn't reach it just now."
            action={<Button variant="outline" size="sm" onClick={() => void load(0, false)}>Try again</Button>}
          />
        ) : !rows?.length ? (
          <EmptyState
            icon={PenNib}
            /* THREE EMPTIES, NOT ONE. A filter that matched nothing, a floor that has
               printed nothing, and artwork we hold but have never fingerprinted are three
               different facts, and only the last one is ours to fix. */
            title={seller || term
              ? "Nothing matches that"
              : unhashed > 0
                ? "No artwork here has been fingerprinted yet"
                : "No artwork has reached an order yet"}
            note={seller || term
              ? "Clear the filter to see every design the floor has been asked to print."
              : unhashed > 0
                ? `${unhashed} ${unhashed === 1 ? "design carries" : "designs carry"} artwork with no fingerprint, so they cannot be matched to each other yet.`
                : "A design appears here once it is placed on an order line."}
            action={(seller || term)
              ? <Button variant="outline" size="sm" onClick={() => { setSeller(""); setTerm("") }}>Clear filter</Button>
              : undefined}
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {rows.map((d) => (
                <li key={d.art_hash} className="flex items-center gap-3 py-2.5">
                  {/* The picture is the identification; everything beside it is confirmation.
                      A press opens it full size rather than navigating away — judging artwork
                      is why anyone is on this page. */}
                  <button
                    type="button"
                    onClick={() => lightbox.open(d.thumb, d.name ?? undefined)}
                    className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    title="Open full size"
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
                      <span className="text-sm font-semibold tabular-nums">
                        {d.design_no != null ? `DSN-${d.design_no}` : "Not numbered"}
                      </span>
                      {d.name && <span className="min-w-0 truncate text-sm text-muted-foreground">{d.name}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <span className="tabular-nums">{d.orders}</span> {d.orders === 1 ? "order" : "orders"}
                      {" · "}
                      {/* WHO ORDERED IT, named rather than counted when the list is short —
                          "3 sellers" is the fact a support question starts from, and the names
                          are what answers it. Staff-only surface; §6 governs where this may
                          be read, and it is read nowhere else. */}
                      {d.seller_names.length <= 2
                        ? d.seller_names.join(", ")
                        : <span title={d.seller_names.join(", ")}>{d.sellers} sellers</span>}
                    </div>
                  </div>

                  {/* THE ANSWER THE PAGE EXISTS FOR, at the end of the row where the eye
                      lands last: do we already hold a stitch file for this picture. */}
                  {d.has_file ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-success">
                      <Check size={14} weight="bold" /> File on record
                    </span>
                  ) : (
                    <Button
                      variant="outline" size="sm"
                      disabled={busy === d.art_hash}
                      onClick={() => { pending.current = d; fileRef.current?.click() }}
                      title="Attach the machine file for this artwork — the next order carrying it will be offered this file"
                    >
                      {busy === d.art_hash
                        ? <CircleNotch size={14} className="animate-spin" />
                        : <UploadSimple size={14} weight="bold" />}
                      Attach file
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {more && (
              /* INCREMENTAL LOADING IS AN EVENT — a press, which cannot recur on its own.
                 Never an effect watching the list's own length (§2.8). */
              <div className="pt-3">
                <Button variant="outline" size="sm" className="w-full"
                  disabled={state === "loading"}
                  onClick={() => { const at = offset + PAGE; setOffset(at); void load(at, true) }}>
                  {state === "loading" ? <CircleNotch size={14} className="animate-spin" /> : null}
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* Without this the hook's `open` sets state nobody renders — a press that does
          nothing, which reads as a broken thumbnail rather than a missing element. */}
      {lightbox.node}

      {/* One input for every row — opening the OS dialog takes focus off the page, and a
          picker per row would be sixty of them mounted. */}
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
    </div>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CaretUp, CaretDown, ArrowSquareOut, X } from "@phosphor-icons/react"
import { useLabelT } from "@/lib/i18n"
import { useOrderOpen } from "@/lib/order-open"
import { OrderDetail } from "@/components/app/order-detail"
import { StageBadge } from "@/components/app/stage-badge"
import { numOf } from "@/lib/order-format"
import type { OrderRow } from "@/lib/api"

/**
 * THE ORDER, OPENED BESIDE THE LIST (owner, 2026-09-26: open an order "so it still stays in
 * Orders page"). The row's own arrow still expands in place for a quick look; the number
 * opens the whole order here, in a panel docked right, with the list untouched behind it.
 *
 * WHAT IT IS: the same OrderDetail the /orders/[id] page renders, framed. Nothing about the
 * order is re-implemented here.
 *
 * SIZE: clamp(720px, 50vw, 900px) — 720 is where the four variant pickers stop wrapping; 50vw
 * keeps the staff hub's Stage and Order columns readable beside it at 1440 (58vw, the first
 * guess, covered the Order column — the hub has a wide left margin).
 * Draggable from its left edge; the width is remembered per browser. Under 1100px it takes
 * the full width (globals.css). It OVERLAYS the list rather than squeezing it, so no row
 * reflows while it slides. No scrim: the list stays clickable, and clicking another row
 * swaps the order in place.
 *
 * MOTION (globals.css) — Material 3's side-sheet guidance, a little quicker for a panel this
 * size: in 300ms on emphasized-decelerate, out 200ms on emphasized-accelerate; stepping between
 * orders is a 120ms fade with no movement; a 100ms fade under prefers-reduced-motion.
 *
 * WHEN THE WORK HAPPENS matters more than the curve (owner, 2026-09-26: "the motion is a bit
 * weird"). Measured frame by frame, the first version did nothing for ~410ms after the click —
 * React building the whole order before the panel could exist — then dropped a frame starting
 * the slide while the content grew 304 → 1352 → 1500px underneath it. Now the FRAME appears on
 * the click with the list row's number and stage in it, slides while nothing heavy runs, and
 * the order is built only once it has landed — seeded from that same row, so it draws complete
 * the first time. This is how Linear's peek feels instant: the data is already there.
 *
 * THE ADDRESS: ?order=<id> on the list's own URL. Opening PUSHES one entry, so Back closes
 * the panel instead of leaving the list; stepping with J/K REPLACES it, so Back does not walk
 * every order looked at. A copied link reopens the list with the panel open. (Same path,
 * query only — the shape Next's native-history integration documents.)
 *
 * REVERSIBLE: the account menu's "Open orders in a side panel" (lib/order-open.ts). Off, a
 * row opens the full page exactly as before. Cmd/Ctrl/middle-click always opens a new tab,
 * and phones always get the full page.
 */

const readParam = () =>
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("order")
const urlWith = (id: string | null) => {
  const u = new URL(window.location.href)
  if (id) u.searchParams.set("order", id)
  else u.searchParams.delete("order")
  return u.pathname + u.search + u.hash
}
const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
const WIDTH_KEY = "eg_order_panel_w"
const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable
}

export function useOrderPanel(ids: string[], rowOf?: (id: string) => OrderRow | undefined) {
  const pref = useOrderOpen()
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  /** Which way the last step went, for the cross-fade nudge: 1 down, -1 up, 0 a fresh open. */
  const [dir, setDir] = useState(0)
  const openRef = useRef<string | null>(null)
  const pushed = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { openRef.current = openId }, [openId])

  const finishClose = useCallback(() => {
    if (!openRef.current) return
    setClosing(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setOpenId(null); setClosing(false)
      returnFocus.current?.focus?.()
      returnFocus.current = null
    }, reduced() ? 100 : 200)
  }, [])

  /* The address is read once after mount (a copied link) and on every Back/Forward. */
  useEffect(() => {
    const t = setTimeout(() => { const id = readParam(); if (id) { setDir(0); setOpenId(id) } }, 0)
    const onPop = () => {
      const id = readParam()
      if (id) { if (timer.current) clearTimeout(timer.current); setClosing(false); setDir(0); setOpenId(id) }
      else { pushed.current = false; finishClose() }
    }
    window.addEventListener("popstate", onPop)
    return () => { clearTimeout(t); window.removeEventListener("popstate", onPop) }
  }, [finishClose])

  /**
   * Open an order. Takes the click so a modified click is left to the link underneath it:
   * Cmd/Ctrl/Shift/middle-click opens the full page in a new tab, as any link does.
   */
  const openOrder = useCallback((id: string, e?: ReactMouseEvent) => {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return
    e?.preventDefault()
    e?.stopPropagation()
    if (pref === "page" || window.innerWidth < 768) {
      router.push(`/orders/${encodeURIComponent(id)}`)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    setClosing(false)
    if (!openRef.current) {
      returnFocus.current = document.activeElement as HTMLElement | null
      window.history.pushState(null, "", urlWith(id))
      pushed.current = true
      setDir(0)
    } else {
      window.history.replaceState(window.history.state, "", urlWith(id))
      const a = ids.indexOf(openRef.current), b = ids.indexOf(id)
      setDir(a >= 0 && b >= 0 ? (b > a ? 1 : -1) : 0)
    }
    setOpenId(id)
  }, [pref, router, ids])

  const close = useCallback(() => {
    if (pushed.current && readParam()) { window.history.back(); return }   // popstate animates it
    window.history.replaceState(window.history.state, "", urlWith(null))
    finishClose()
  }, [finishClose])

  const step = useCallback((d: 1 | -1) => {
    const cur = openRef.current
    if (!cur) return
    const next = ids[ids.indexOf(cur) + d]
    if (!next) return
    window.history.replaceState(window.history.state, "", urlWith(next))
    setDir(d)
    setOpenId(next)
  }, [ids])

  /* Esc closes, J/K step — never while typing, and never over a dialog the order opened. */
  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      if (document.querySelector('[role="dialog"][data-open], [data-slot="dialog-content"], [role="menu"]')) return
      if (e.key === "Escape") { e.preventDefault(); close() }
      else if (e.key === "j" || e.key === "J") { e.preventDefault(); step(1) }
      else if (e.key === "k" || e.key === "K") { e.preventDefault(); step(-1) }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [openId, close, step])

  const index = openId ? ids.indexOf(openId) : -1
  const panel = openId ? (
    <OrderPanelFrame
      id={openId}
      seed={rowOf?.(openId) ?? null}
      closing={closing}
      dir={dir}
      index={index}
      count={ids.length}
      onClose={close}
      onStep={step}
    />
  ) : null

  return { openId, openOrder, close, panel }
}

function OrderPanelFrame({ id, seed, closing, dir, index, count, onClose, onStep }: {
  id: string
  seed: OrderRow | null
  closing: boolean
  dir: number
  index: number
  count: number
  onClose: () => void
  onStep: (d: 1 | -1) => void
}) {
  const tl = useLabelT()
  const [mounted, setMounted] = useState(false)
  const [width, setWidth] = useState<number | null>(null)
  /** The order is built only once the slide has landed — see the note at the top. Stays true
   *  while the panel is open, so stepping between orders swaps content without waiting. */
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    if (!mounted) return
    const t = setTimeout(() => setLanded(true), reduced() ? 0 : 320)   // backstop for animationend
    return () => clearTimeout(t)
  }, [mounted])
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      setMounted(true)
      try { const w = Number(localStorage.getItem(WIDTH_KEY)); if (w >= 560) setWidth(w) } catch { /* default width */ }
    }, 0)
    return () => clearTimeout(t)
  }, [])
  /* Focus moves into the panel when it opens, so a keyboard user lands on the order. */
  useEffect(() => { if (mounted) ref.current?.focus({ preventScroll: true }) }, [mounted])

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    let last = width
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 560), window.innerWidth - 200))
      setWidth(last)
    }
    const up = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      try { if (last) localStorage.setItem(WIDTH_KEY, String(last)) } catch { /* not remembered */ }
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
  }

  if (!mounted) return null
  const style: CSSProperties = { width: width ? `min(${width}px, 100vw)` : "clamp(720px, 50vw, 900px)" }
  return createPortal(
    <aside
      ref={ref}
      tabIndex={-1}
      aria-label={tl("orderPanel", "Order")}
      data-closing={closing || undefined}
      style={style}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) setLanded(true) }}
      className="eg-order-panel fixed bottom-0 right-0 top-16 z-40 flex flex-col border-l border-border bg-background shadow-[-12px_0_32px_rgba(0,0,0,0.08)] outline-none"
    >
      <div
        onPointerDown={onResizeStart}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize"
        title={tl("orderPanel", "Drag to resize")}
        aria-hidden
      />
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-4">
        {index >= 0 && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {index + 1} {tl("orderPanel", "of")} {count}
          </span>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => onStep(-1)} disabled={index <= 0}
          aria-label={tl("orderPanel", "Previous order")} title={`${tl("orderPanel", "Previous order")} (K)`}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
          <CaretUp size={15} weight="bold" />
        </button>
        <button type="button" onClick={() => onStep(1)} disabled={index < 0 || index >= count - 1}
          aria-label={tl("orderPanel", "Next order")} title={`${tl("orderPanel", "Next order")} (J)`}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
          <CaretDown size={15} weight="bold" />
        </button>
        <Link href={`/orders/${encodeURIComponent(id)}`}
          aria-label={tl("orderPanel", "Open full page")} title={tl("orderPanel", "Open full page")}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowSquareOut size={15} weight="bold" />
        </Link>
        <button type="button" onClick={onClose}
          aria-label={tl("orderPanel", "Close")} title={`${tl("orderPanel", "Close")} (Esc)`}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
          <X size={15} weight="bold" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {/* KEYED BY ORDER: stepping remounts the order (no frame of the last one's state), and
            the remount is what replays the cross-fade. */}
        {landed ? (
          <div key={id} className="eg-order-panel-body" data-dir={dir || undefined}>
            <OrderDetail id={id} embedded seed={seed} />
          </div>
        ) : (
          /* WHAT THE LIST ALREADY KNOWS, while the panel slides: the number and the stage, at
             the size and place the order's own header will draw them, so nothing jumps when
             the full order takes over. */
          <div className="space-y-4" aria-busy>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold tabular-nums">{seed ? numOf(seed) : ""}</span>
              {seed && <StageBadge status={seed.factory_status} />}
            </div>
            <div className="h-4 w-56 rounded bg-muted" />
            <div className="h-64 rounded-2xl bg-muted/60" />
          </div>
        )}
      </div>
    </aside>,
    document.body,
  )
}

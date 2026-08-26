"use client"

import { useCallback, useEffect, useState } from "react"

const KEY = "eg_rail_collapsed"
const EVT = "eg:rail"

/**
 * IS THE NAV RAIL COLLAPSED — a choice the person makes once and the app remembers.
 *
 * NOT HOVER-TO-EXPAND. That pattern reclaims the same ~120px and charges for it three ways:
 * it fires on accidental mouse travel across the left edge, it does not exist for a keyboard
 * or for a warehouse tablet, and it makes the one element that should never move the one
 * element that moves most. A toggle is deliberate, reversible and legible.
 *
 * localStorage rather than the session store: this is a display preference, not an identity,
 * so it should survive a sign-out on a shared floor machine the same way a window size does.
 * Wrapped because a private window or blocked site data makes the accessor itself throw.
 *
 * The custom event is what keeps the rail and the shell's left padding in step. They are
 * siblings, not parent and child, and a context provider for one boolean would be more
 * machinery than the fact deserves.
 */
export function useRailCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    // Deferred: reading storage during render is both SSR-unsafe and the shape
    // `react-hooks/set-state-in-effect` refuses.
    const t = setTimeout(() => {
      try { setCollapsed(localStorage.getItem(KEY) === "1") } catch { /* blocked — stay open */ }
    }, 0)
    const onEvt = (e: Event) => setCollapsed(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener(EVT, onEvt)
    return () => { clearTimeout(t); window.removeEventListener(EVT, onEvt) }
  }, [])

  const toggle = useCallback(() => {
    setCollapsed((v) => {
      const next = !v
      /**
       * THE SIDE EFFECTS LEAVE THE UPDATER, and this is why the first version silently did
       * nothing. An updater passed to setState runs during RENDER, and React re-runs it —
       * so writing storage and dispatching a DOM event in here fired them mid-render, and
       * the setState the listener triggered was discarded. The rail kept its width and
       * localStorage stayed null while the click handler ran perfectly.
       *
       * queueMicrotask puts both after the commit, where a side effect belongs.
       */
      queueMicrotask(() => {
        try { localStorage.setItem(KEY, next ? "1" : "0") } catch { /* nothing to remember with */ }
        window.dispatchEvent(new CustomEvent(EVT, { detail: next }))
      })
      return next
    })
  }, [])

  return [collapsed, toggle]
}

"use client"

import { useSyncExternalStore } from "react"

/**
 * HOW AN ORDER OPENS FROM A LIST — in the side panel, or as the full page (owner, 2026-09-26:
 * "make sure I can revert if I want").
 *
 * A per-browser preference, flipped from the account menu, so turning the panel off needs no
 * deploy and no one else's list changes. `panel` is the default; `page` is exactly the
 * behaviour before the panel existed.
 */
export type OrderOpen = "panel" | "page"
const KEY = "eg_order_open"
const EVENT = "eg-order-open"

export function readOrderOpen(): OrderOpen {
  try { return localStorage.getItem(KEY) === "page" ? "page" : "panel" } catch { return "panel" }
}

export function writeOrderOpen(v: OrderOpen) {
  try { localStorage.setItem(KEY, v) } catch { /* private window: the default stands */ }
  window.dispatchEvent(new Event(EVENT))
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb)
  window.addEventListener("storage", cb)   // another tab flipped it
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb) }
}

export function useOrderOpen(): OrderOpen {
  return useSyncExternalStore(subscribe, readOrderOpen, () => "panel")
}

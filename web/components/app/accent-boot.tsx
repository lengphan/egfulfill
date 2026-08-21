"use client"

import { useEffect } from "react"
import { getBranding } from "@/lib/api"
import { applyStoredAccent, rememberAccent } from "@/lib/accent"
import { applyStoredSkin, rememberSkin } from "@/lib/skin"

/** One fetch per tab, not per navigation. The accent changes about as often as the logo. */
/* AND THE SKIN, off the SAME fetch. Two attributes on <html> from one call rather than a
   second hook with a second request for a second field of the same record — the branding
   endpoint already returns both, and two loaders for one row is how they end up disagreeing
   about which one arrived first. */
let asked = false

/**
 * Paints the admin's chosen accent onto <html>.
 *
 * A HOOK, NOT A COMPONENT IN THE TREE. It started as `<AccentBoot />` placed in the shell's
 * JSX, and AppShell has THREE render branches — loading, staff, seller. The staff branch
 * didn't get one, so every staff account ran on the default accent no matter what an admin
 * chose. A tag can be forgotten in a branch; a hook at the top of the function cannot be,
 * because there is only one top.
 *
 * Two steps, in this order and for a reason: the cached key goes on IMMEDIATELY so a chosen
 * accent doesn't flash the default on every page load, then the server's answer overwrites
 * it. The cache is a cache — the server is the truth.
 *
 * A failure here is silent on purpose. The app is entirely legible in the default accent, so
 * a branding endpoint that is down, or a session that has expired, must not put an error on
 * a page the user came to for something else.
 */
export function useAccent() {
  useEffect(() => {
    applyStoredAccent()
    applyStoredSkin()
    if (asked) return
    asked = true
    getBranding()
      .then((b) => { rememberAccent(b.accent); rememberSkin(b.skin) })
      .catch(() => { /* the default is fine */ })
  }, [])
}

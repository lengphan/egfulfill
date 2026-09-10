"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { Storefront } from "@phosphor-icons/react"
import { getMyAccess } from "@/lib/api"
import { getToken } from "@/lib/auth"

/**
 * WHOSE ACCOUNT YOU ARE IN — on every page, not one list.
 *
 * A team member sees the OWNER's orders, products, stores and wallet: `effectiveSeller`
 * resolves them to `owner_id`, so every seller-scoped read on every board answers with
 * somebody else's data. That is the feature working, and it is indistinguishable from a leak
 * if nothing says so — which is exactly how it was reported (2026-09-10): "this is supposed
 * to be a new user? why would I see their orders".
 *
 * The notice already existed and it was on the SELLER ORDERS LIST alone. So the one board
 * that explained itself was the one you happened to be looking at, and Products, Stores and
 * the wallet — all showing the same person's data — said nothing at all. A fact about the
 * whole session belongs in the shell, once, above everything it applies to.
 *
 * NOT DISMISSIBLE, and no colour that reads as a warning. Nothing is wrong: they were invited
 * and they accepted. It is orientation, and orientation that can be hidden is orientation
 * somebody will be missing at the moment they most need it.
 *
 * Owners and staff get nothing. `member: false` is the overwhelmingly common case and a
 * banner that says "you are in your own account" is noise on every page in the product.
 */
export function TeamBanner() {
  const tl = useLabelT()
  const [owner, setOwner] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!getToken()) return
    getMyAccess()
      .then((a) => setOwner(a?.member ? (a.ownerName ?? tl("teamBanner", "your team")) : null))
      .catch(() => setOwner(null))
  }, [tl])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  if (!owner) return null

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground">
      <Storefront size={16} weight="fill" className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{tl("teamBanner", "Working in")} {owner}{tl("teamBanner", "’s account.")}</span>{" "}
        <span className="text-muted-foreground">
          {tl("teamBanner", "Orders, products and stores here are theirs — anything you create belongs to them, and your own account stays separate.")}
        </span>
      </span>
    </div>
  )
}

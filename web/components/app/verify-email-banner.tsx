"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { EnvelopeSimple } from "@phosphor-icons/react"
import { getMe } from "@/lib/api"
import { getToken } from "@/lib/auth"

/**
 * Reminds a seller their address is still unconfirmed, before it stops them.
 *
 * Skipping the code at signup is allowed on purpose — see verify-code.tsx — but "allowed"
 * only works if the account says so afterwards. Without this, someone who skipped meets
 * confirmation again as a 403 on the top-up they were trying to make, which is the worst
 * possible moment to learn about a step: mid-task, at a wall, with no memory of choosing it.
 *
 * IT NAMES WHAT IS ACTUALLY BLOCKED, rather than saying "please confirm". Reading, ordering
 * and everything paid for out of an existing balance are untouched; what waits is money in,
 * money out, and connecting a shop. A banner that implied the whole account was limited
 * would be a lie in the alarming direction.
 *
 * THE MARK CARRIES THE COLOUR, NOT THE GROUND — the same conclusion LowBalanceBanner records
 * beside it, and the same card, so two notices stacked in the shell read as one system.
 *
 * NOT DISMISSIBLE, and no red. It is a standing fact about the account, so hiding it would
 * only move the surprise back to the 403; but nothing is broken and nothing is urgent, so it
 * is the ordinary border with the colour in the icon.
 */
export function VerifyEmailBanner() {
  const tl = useLabelT()
  const [state, setState] = useState<{ show: boolean; email?: string } | null>(null)

  const load = useCallback(() => {
    if (!getToken()) return
    getMe()
      .then((u) => {
        const me = u as { email?: string; role?: string; email_verified_at?: string | null }
        /* STAFF NEVER SEE IT. Public signup only ever creates a seller, so an operator or an
           admin was provisioned by hand and never had a confirmation flow to complete — the
           gate exempts them for the same reason, and a banner they cannot action is noise. */
        const staff = !!me?.role && me.role !== "seller"
        setState({ show: !staff && !me?.email_verified_at, email: me?.email })
      })
      .catch(() => setState(null))
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  if (!state?.show) return null

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground">
      <EnvelopeSimple size={16} weight="fill" className="shrink-0 text-hold" />
      <span className="min-w-0 flex-1">
        {tl("verifyEmailBanner", "Your email isn’t confirmed yet. Top-ups, payouts and connecting a shop need it.")}
      </span>
      <Link href="/verify-email" className="shrink-0 font-medium underline">
        {tl("verifyEmailBanner", "Confirm now")}
      </Link>
    </div>
  )
}

"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { CheckCircle, Plug } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getAlibabaConfig, type AlibabaConfig } from "@/lib/api"
import { markOAuthProvider, openOAuthPopup } from "@/lib/oauth-popup"
import { getUser } from "@/lib/auth"

/**
 * Whether Alibaba sourcing is connected, as one line on the Sourcing header.
 *
 * ADMIN-ONLY, and it renders NOTHING for anyone else — this authorises the factory's own
 * buyer account, so there is one connection for the whole company and exactly one person
 * who can make it. A disabled button for everyone else would just be furniture.
 *
 * Not on Stores. Stores is "marketplaces your orders arrive from"; Alibaba is where blanks
 * are bought — the opposite direction, and putting it there was the same category error as
 * redirecting a sourcing connect to a page about shops.
 */
export function AlibabaStatus() {
  const tl = useLabelT()
  const [cfg, setCfg] = useState<AlibabaConfig | null>(null)
  const isAdmin = getUser()?.role === "admin"

  const load = useCallback(() => {
    if (!isAdmin) return
    getAlibabaConfig().then(setCfg).catch(() => setCfg(null))
  }, [isAdmin])
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  if (!isAdmin || !cfg?.configured) return null

  /**
   * RECONNECT IS ALWAYS REACHABLE.
   *
   * `connected` means a row exists in alibaba_auth — NOT that its token still works. An
   * Alibaba access token expires, nothing refreshes it (the refresh_token and expires_at
   * columns are stored and never used), and the connect button used to live only in the
   * `else` branch. So an expired token reported "Alibaba connected" in green while hiding
   * the one control that repairs it: the failure state removed its own remedy, and the only
   * way out was deleting the row by hand in psql.
   */
  const connect = () => {
        if (!cfg.authorizeUrl) return
        // The marker is what the shared callback routes on. Alibaba returns a bare `code`
        // with nothing to identify it — the same shape TikTok's US flow returns — so
        // without this it lands in the wrong branch and reports "invalid auth code".
        markOAuthProvider("alibaba")
        const p = openOAuthPopup(cfg.authorizeUrl)
        if (!p) window.location.href = cfg.authorizeUrl
        const iv = setInterval(() => { if (p?.closed) { clearInterval(iv); load() } }, 800)
        setTimeout(() => clearInterval(iv), 300000)
  }

  /**
   * Working = a tick and nothing else. There is no action to offer when nothing is wrong,
   * and "Alibaba connected" spelled out on a page about sourcing is a label for a state the
   * reader already assumes. The tick carries it.
   */
  if (cfg.connected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={cfg.account ?? undefined}>
        <CheckCircle size={13} weight="fill" className="text-success" /> {tl("alibabaStatus", "Connected")}
      </span>
    )
  }

  /* Expired and never-connected are DIFFERENT sentences: one needs renewing, the other
     setting up. Both land on the same button, but the reader should not have to guess
     which situation they are in — and neither may show a green tick. */
  return (
    <Button size="sm" variant="outline" disabled={!cfg.authorizeUrl} onClick={connect}>
      <Plug size={14} weight="bold" /> {cfg.expired ? tl("alibabaStatus", "Reconnect Alibaba") : tl("alibabaStatus", "Connect Alibaba")}
    </Button>
  )
}

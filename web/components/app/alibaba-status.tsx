"use client"

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

  if (cfg.connected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={cfg.account ?? undefined}>
        <CheckCircle size={13} weight="fill" className="text-success" />
        Alibaba connected
      </span>
    )
  }

  return (
    <Button
      size="sm" variant="outline" disabled={!cfg.authorizeUrl}
      onClick={() => {
        if (!cfg.authorizeUrl) return
        // The marker is what the shared callback routes on. Alibaba returns a bare `code`
        // with nothing to identify it — the same shape TikTok's US flow returns — so
        // without this it lands in the wrong branch and reports "invalid auth code".
        markOAuthProvider("alibaba")
        const p = openOAuthPopup(cfg.authorizeUrl)
        if (!p) window.location.href = cfg.authorizeUrl
        const iv = setInterval(() => { if (p?.closed) { clearInterval(iv); load() } }, 800)
        setTimeout(() => clearInterval(iv), 300000)
      }}
    >
      <Plug size={14} weight="bold" /> Connect Alibaba
    </Button>
  )
}

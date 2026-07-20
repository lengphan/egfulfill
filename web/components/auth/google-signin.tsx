"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Script from "next/script"
import { getGoogleClientId, googleLogin } from "@/lib/api"
import { setSession } from "@/lib/auth"

// Minimal typing for Google Identity Services (avoids `any`).
type GsiId = {
  accounts: {
    id: {
      initialize: (cfg: { client_id: string; callback: (r: { credential?: string }) => void }) => void
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
    }
  }
}
declare global {
  interface Window {
    google?: GsiId
  }
}

/**
 * "Continue with Google" — renders the official GIS button, exchanges the returned
 * ID token via POST /api/auth/google, stores the session, then calls onSuccess.
 * Renders nothing if Google isn't configured on the server (empty client id).
 */
export function GoogleSignIn({
  onSuccess,
  onError,
}: {
  onSuccess: () => void
  onError: (msg: string) => void
}) {
  const btnRef = useRef<HTMLDivElement>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [scriptReady, setScriptReady] = useState(false)
  const rendered = useRef(false)

  useEffect(() => {
    let alive = true
    // Retry once: a transient network blip must not be mistaken for "Google isn't
    // configured" and hide the button for the whole session.
    const fetchId = (attempt = 0): void => {
      getGoogleClientId()
        .then((r) => { if (alive) setClientId(r.clientId || "") })
        .catch(() => {
          if (!alive) return
          if (attempt < 1) setTimeout(() => fetchId(attempt + 1), 1200)
          else setClientId("")
        })
    }
    fetchId()
    return () => { alive = false }
  }, [])

  // Don't rely on <Script onLoad> alone: it only fires for the injection that
  // actually loads the script. Navigate away from /login and back and the GIS script
  // is already in the DOM, so onLoad never fires again and the button silently never
  // renders — which is why it appeared only after a hard refresh. Poll for the real
  // global instead, and treat onLoad as a fast path.
  useEffect(() => {
    let tries = 0
    // Fires immediately on the first tick when the script is already present.
    const id = setInterval(() => {
      if (window.google?.accounts?.id) { setScriptReady(true); clearInterval(id) }
      else if (++tries > 40) clearInterval(id)   // give up after ~8s
    }, 100)
    return () => clearInterval(id)
  }, [])

  const handleCredential = useCallback(
    async (resp: { credential?: string }) => {
      if (!resp.credential) {
        onError("No Google credential returned.")
        return
      }
      try {
        const j = await googleLogin(resp.credential)
        if (!j.token) throw new Error(j.error || "Google sign-in failed")
        setSession(j.token, j.user || {})
        onSuccess()
      } catch (e) {
        onError(e instanceof Error ? e.message : "Google sign-in failed")
      }
    },
    [onSuccess, onError]
  )

  useEffect(() => {
    if (!scriptReady || !clientId || !btnRef.current || !window.google) return
    if (rendered.current) return   // GIS re-render duplicates the button
    rendered.current = true
    window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential })
    window.google.accounts.id.renderButton(btnRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      logo_alignment: "center",
      width: 300,
    })
  }, [scriptReady, clientId, handleCredential])

  // Not configured on the server → render nothing (no divider, no button).
  if (clientId === "") return null

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-card px-2 text-xs text-muted-foreground">or</span>
        </div>
      </div>
      <div className="flex justify-center" ref={btnRef} />
    </>
  )
}

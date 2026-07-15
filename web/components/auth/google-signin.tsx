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

  useEffect(() => {
    getGoogleClientId()
      .then((r) => setClientId(r.clientId || ""))
      .catch(() => setClientId(""))
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
      <div className="flex justify-center" ref={btnRef} />
    </>
  )
}

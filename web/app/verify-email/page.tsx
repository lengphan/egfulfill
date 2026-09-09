"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { VerifyCode } from "@/components/auth/verify-code"
import { getMe } from "@/lib/api"

/**
 * THE CODE STEP AS A ROUTE — for coming back to it later, not for signing up.
 *
 * Signing up shows the same step inside its own card without changing route (see
 * signup/page.tsx), which is where anyone doing it for the first time meets it. This exists
 * for the other way in: a session that is still unconfirmed days later, or a link. It renders
 * the SAME component inside the SAME shell, so the two entrances cannot drift into two
 * different-looking screens for one job.
 */
function VerifyEmailRoute() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next") ?? "/dashboard"
  const [email, setEmail] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      getMe()
        .then((u) => {
          const me = u as { email?: string; email_verified_at?: string | null }
          // ALREADY DONE IS NOT A SCREEN. Someone who confirmed on another device and comes
          // back to this tab should land where they were going, not be asked again.
          if (me?.email_verified_at) { router.replace(next); return }
          setEmail(me?.email ?? null); setReady(true)
        })
        .catch(() => setReady(true))
    }, 0)
    return () => clearTimeout(t)
  }, [router, next])

  if (!ready) return null
  return (
    <AuthShell subtitle="Confirm your email">
      <VerifyCode email={email} onDone={() => router.replace(next)} onSkip={() => router.replace(next)} />
    </AuthShell>
  )
}

export default function Page() {
  // useSearchParams needs a Suspense boundary or the route opts out of static rendering.
  return <Suspense fallback={null}><VerifyEmailRoute /></Suspense>
}

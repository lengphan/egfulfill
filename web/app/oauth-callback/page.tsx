"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle, XCircle, CircleNotch } from "@phosphor-icons/react"
import { exchangeEtsy, exchangeShopify, exchangeTiktok } from "@/lib/api"
import { readPkce, clearPkce } from "@/lib/etsy-oauth"
import { getToken } from "@/lib/auth"
import { clearShopifyOAuth } from "@/lib/shopify-oauth"
import { peekOAuthProvider, clearOAuthProvider } from "@/lib/oauth-popup"

const BACKFILL_KEY = "eg_connect_backfill_days"

type State =
  | { kind: "working" }
  | { kind: "ok"; shop: string }
  | { kind: "error"; message: string }

export default function OAuthCallbackPage() {
  const [state, setState] = useState<State>({ kind: "working" })

  useEffect(() => {
    // finish/fail either close the popup (posting the result to the opener) or, when this
    // isn't a popup, fall back to the full-page redirect the flow used before.
    const finish = (shop: string) => {
      // Only a completed connection clears the connect-time scratch (provider marker +
      // backfill choice). Clearing it on read is what broke re-runs of this callback.
      clearOAuthProvider()
      try { localStorage.removeItem(BACKFILL_KEY) } catch { /* ignore */ }
      setState({ kind: "ok", shop })
      if (window.opener && window.opener !== window) {
        try { window.opener.postMessage({ source: "eg-oauth", ok: true, shop }, window.location.origin) } catch { /* ignore */ }
        setTimeout(() => { try { window.close() } catch { /* ignore */ } }, 900)
      } else {
        setTimeout(() => { window.location.href = "/stores?connected=1" }, 1200)
      }
    }
    const fail = (message: string) => {
      setState({ kind: "error", message })
      if (window.opener && window.opener !== window) {
        try { window.opener.postMessage({ source: "eg-oauth", ok: false, message }, window.location.origin) } catch { /* ignore */ }
      }
    }
    // The "how far back to import" scope the user picked in the pre-connect modal on Stores.
    // It's stashed in localStorage (same-origin, so this popup shares it with the opener) and
    // read here so the exchange can persist it on the connection. Cleared by finish().
    const readBackfillDays = (): number | undefined => {
      try {
        const raw = localStorage.getItem(BACKFILL_KEY)
        if (raw == null || raw === "") return undefined
        const n = Math.floor(Number(raw))
        return Number.isFinite(n) ? Math.max(0, Math.min(365, n)) : undefined
      } catch { return undefined }
    }

    // All state updates live inside this async runner (not the effect body) so
    // they're deferred, not synchronous mount renders.
    const run = async () => {
      const backfill_days = readBackfillDays()
      const params = new URLSearchParams(window.location.search)
      // TikTok Shop returns `auth_code`; Etsy and Shopify return `code`. Reading only
      // `code` is why TikTok never worked here — the guard below fired before any
      // provider branch was reached, and the flow died on "No authorization code
      // returned" with nothing to say which provider or why.
      const authCode = params.get("auth_code")
      const code = params.get("code") ?? authCode
      const returnedState = params.get("state")
      const oauthErr = params.get("error")

      // Which provider started this connect, stashed at connect time. Authoritative over
      // param-name guessing: TikTok's US Seller Center returns `code`, the global page returns
      // `auth_code`, so shape-detection alone misrouted US TikTok into the Etsy branch.
      // A marker whose `state` doesn't match what came back belongs to a different (abandoned)
      // flow, so it's ignored rather than trusted.
      const marker = peekOAuthProvider()
      const staleMarker = !!(marker?.state && returnedState && marker.state !== returnedState)
      const provider = staleMarker ? null : (marker?.provider ?? null)

      if (oauthErr) {
        fail(params.get("error_description") || oauthErr)
        return
      }
      if (!code) {
        fail("No authorization code returned.")
        return
      }

      // Shopify — the provider marker, or the tell-tale `shop` param (+ hmac) it carries.
      const shopParam = params.get("shop")
      if (provider === "shopify" || shopParam) {
        if (!shopParam) { fail("Shopify didn't return the store domain. Start the connection again from Stores."); return }
        try {
          const allParams = Object.fromEntries(params.entries())
          const data = await exchangeShopify({ shop: shopParam.toLowerCase(), code, params: allParams, backfill_days })
          if (data.error) throw new Error(data.error)
          clearShopifyOAuth()
          finish(data.shop_name || "your Shopify store")
        } catch (e: unknown) {
          clearShopifyOAuth()
          fail(e instanceof Error ? e.message : "Connection failed.")
        }
        return
      }

      // Etsy is the ONLY provider here that needs local state to finish: without the PKCE
      // verifier stashed at connect time its exchange can never succeed. So the verifier —
      // not the param shape — is what makes a redirect Etsy's. With an explicit marker we
      // stay lenient about `state` (the verifier still binds the code); with no marker, a
      // verifier left over from an abandoned connect is only Etsy's if the state matches.
      const pkce = readPkce()
      const etsyPossible = !!pkce?.verifier &&
        (provider === "etsy" || !returnedState || !pkce.state || pkce.state === returnedState)

      // TIKTOK SHOP. Routed by the provider marker set at connect time — NOT by param name:
      // the US Seller Center returns `code`, the global page returns `auth_code`, so we pass
      // whichever is present. (authCode kept as a fallback for a marker-less redirect.) The
      // last clause is the safety net: no marker AND no verifier means Etsy is impossible, so
      // TikTok is the only thing this redirect can be — try it rather than dying on a "Lost
      // the security key" that names the wrong provider. The sign-in guard is repeated here
      // because attaching a shop to an account needs a session.
      if (provider === "tiktok" || authCode || (!provider && !etsyPossible)) {
        if (!getToken()) {
          setState({
            kind: "error",
            message: "You're signed out, so we can't attach this shop to your account. Sign in, then start the connection again from Stores.",
          })
          return
        }
        try {
          const data = await exchangeTiktok({ auth_code: authCode || code, backfill_days })
          if (data.error) throw new Error(data.error)
          finish(data.shop_name || "your TikTok shop")
        } catch (e: unknown) {
          fail(e instanceof Error ? e.message : "Connection failed.")
        }
        return
      }

      // The exchange is an AUTHENTICATED call — the shop connects to your account, so it
      // cannot complete while signed out. Say that plainly instead of failing as a
      // generic "Connection failed", which is what happens if you log out mid-flow.
      if (!getToken()) {
        setState({
          kind: "error",
          message: "You're signed out, so we can't attach this shop to your account. Sign in, then start the connection again from Stores.",
        })
        return
      }

      if (!pkce?.verifier) {
        fail("Lost the security key for this Etsy connection. Start it again from Stores — don't reload this window.")
        return
      }
      if (pkce.state && returnedState && pkce.state !== returnedState) {
        // Non-fatal: the PKCE verifier still binds the code. Log and continue.
        console.warn("OAuth state mismatch — continuing (PKCE verifier still validates).")
      }

      try {
        const data = await exchangeEtsy({ code, code_verifier: pkce.verifier, redirect_uri: pkce.redirect, backfill_days })
        clearPkce()
        finish(data.shop_name || "your Etsy shop")
      } catch (e: unknown) {
        clearPkce()
        fail(e instanceof Error ? e.message : "Connection failed.")
      }
    }
    run()
  }, [])

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        {state.kind === "working" && (
          <>
            <CircleNotch size={40} weight="bold" className="mx-auto animate-spin text-primary" />
            <h1 className="mt-4 text-lg font-semibold">Connecting your shop…</h1>
            {/* Was "Exchanging your Etsy authorization" on every provider — it now says
                what is actually happening. */}
            <p className="mt-1 text-sm text-muted-foreground">Exchanging your authorization. One moment.</p>
          </>
        )}
        {state.kind === "ok" && (
          <>
            <CheckCircle size={40} weight="fill" className="mx-auto text-emerald-500" />
            <h1 className="mt-4 text-lg font-semibold">Connected {state.shop}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Taking you back to Stores…</p>
          </>
        )}
        {state.kind === "error" && (
          <>
            <XCircle size={40} weight="fill" className="mx-auto text-red-500" />
            <h1 className="mt-4 text-lg font-semibold">Couldn&apos;t connect</h1>
            <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
            <Link
              href="/stores"
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              Back to Stores
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

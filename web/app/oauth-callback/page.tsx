"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle, XCircle, CircleNotch } from "@phosphor-icons/react"
import { exchangeEtsy, exchangeShopify, exchangeTiktok, exchangeAlibaba } from "@/lib/api"
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
    /**
     * Tell the opener, then close.
     *
     * postMessage ALONE is not enough. This window navigates through the provider's domain
     * on the way here, and a provider that sends Cross-Origin-Opener-Policy severs
     * `window.opener` — so the popup lands back on our origin with no opener, takes the
     * redirect fallback, and sits there as a second window showing Stores. That's the
     * "why doesn't it close" everyone sees. BroadcastChannel reaches the opener regardless,
     * because it's keyed on origin rather than on the window relationship.
     */
    const tell = (msg: { ok: boolean; shop?: string; message?: string; note?: string }) => {
      const payload = { source: "eg-oauth", ...msg }
      if (window.opener && window.opener !== window) {
        try { window.opener.postMessage(payload, window.location.origin) } catch { /* ignore */ }
      }
      try { const ch = new BroadcastChannel("eg-oauth"); ch.postMessage(payload); ch.close() } catch { /* ignore */ }
    }
    // WHERE a connect lands is per-provider. Alibaba is sourcing, not a sales channel:
    // sending it to Stores under "your orders will start syncing" described a shop that
    // doesn't exist and a sync that will never happen.
    const finish = (shop: string, note?: string, dest = "/stores?connected=1") => {
      // Only a completed connection clears the connect-time scratch (provider marker +
      // backfill choice). Clearing it on read is what broke re-runs of this callback.
      clearOAuthProvider()
      try { localStorage.removeItem(BACKFILL_KEY) } catch { /* ignore */ }
      setState({ kind: "ok", shop })
      tell({ ok: true, shop, note })
      // Try to close whether or not we still have an opener — this window was script-opened,
      // so close() is permitted even once the opener link is gone. Only if it's still here a
      // moment later did it turn out not to be a popup at all; then take the old redirect.
      setTimeout(() => { try { window.close() } catch { /* ignore */ } }, 700)
      setTimeout(() => { if (!window.closed) window.location.href = dest }, 1600)
    }
    const fail = (message: string) => {
      setState({ kind: "error", message })
      tell({ ok: false, message })
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

      /**
       * Alibaba — sourcing, and the odd one out: this authorises OUR OWN buyer account, not
       * a seller's shop. So there is nothing per-seller to record and the whole exchange is
       * admin-gated server-side; a non-admin who somehow lands here gets a 403 with the
       * reason rather than a silent no-op.
       *
       * Matched on the marker alone. Alibaba returns a bare `code` with no distinguishing
       * param, which is exactly the shape TikTok's US flow returns — guessing from params
       * is what misrouted TikTok into the Etsy branch, so this one never guesses.
       */
      if (provider === "alibaba") {
        try {
          const data = await exchangeAlibaba(code)
          if (data.error) throw new Error(data.error)
          finish(
            data.account ? `Alibaba (${data.account})` : "Alibaba",
            "Alibaba connected. Search suppliers from Sourcing.",
            "/sourcing?connected=alibaba",
          )
        } catch (e: unknown) {
          fail(e instanceof Error ? e.message : "Couldn't connect Alibaba.")
        }
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
          // The connection succeeded; the FIRST IMPORT is a separate outcome and is reported
          // separately. Saying "your orders will start syncing" over a backfill that already
          // failed is how a broken connection passes for a working one.
          const bf = data.backfill
          const n = bf && Array.isArray(bf.synced) ? bf.synced.length : bf?.count
          const note = bf?.error
            ? `Connected, but the first order import failed: ${bf.error}`
            : n === 0
              ? "Connected. No orders found in the window you chose — nothing to import yet."
              : n
                ? `Connected. Imported ${n} order${n === 1 ? "" : "s"}.`
                : undefined
          finish(data.shop_name || "your Shopify store", note)
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

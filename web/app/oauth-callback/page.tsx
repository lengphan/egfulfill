"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle, XCircle, CircleNotch } from "@phosphor-icons/react"
import { exchangeEtsy, exchangeShopify, exchangeTiktok } from "@/lib/api"
import { readPkce, clearPkce } from "@/lib/etsy-oauth"
import { getToken } from "@/lib/auth"
import { clearShopifyOAuth } from "@/lib/shopify-oauth"

type State =
  | { kind: "working" }
  | { kind: "ok"; shop: string }
  | { kind: "error"; message: string }

export default function OAuthCallbackPage() {
  const [state, setState] = useState<State>({ kind: "working" })

  useEffect(() => {
    // All state updates live inside this async runner (not the effect body) so
    // they're deferred, not synchronous mount renders.
    const run = async () => {
      const params = new URLSearchParams(window.location.search)
      // TikTok Shop returns `auth_code`; Etsy and Shopify return `code`. Reading only
      // `code` is why TikTok never worked here — the guard below fired before any
      // provider branch was reached, and the flow died on "No authorization code
      // returned" with nothing to say which provider or why.
      const authCode = params.get("auth_code")
      const code = params.get("code") ?? authCode
      const returnedState = params.get("state")
      const oauthErr = params.get("error")

      if (oauthErr) {
        setState({ kind: "error", message: params.get("error_description") || oauthErr })
        return
      }
      if (!code) {
        setState({ kind: "error", message: "No authorization code returned." })
        return
      }

      // Shopify callbacks carry a `shop` param (+ hmac). Etsy's don't.
      const shopParam = params.get("shop")
      if (shopParam) {
        try {
          const allParams = Object.fromEntries(params.entries())
          const data = await exchangeShopify({ shop: shopParam.toLowerCase(), code, params: allParams })
          if (data.error) throw new Error(data.error)
          clearShopifyOAuth()
          setState({ kind: "ok", shop: data.shop_name || "your Shopify store" })
          setTimeout(() => { window.location.href = "/stores?connected=1" }, 1200)
        } catch (e: unknown) {
          clearShopifyOAuth()
          setState({ kind: "error", message: e instanceof Error ? e.message : "Connection failed." })
        }
        return
      }

      // TIKTOK SHOP. Identified by the `auth_code` param, the same shape-detection the
      // legacy callback used — TikTok sends no `shop` (that's Shopify's marker) and no
      // PKCE verifier is involved, so the parameter name is what distinguishes it.
      //
      // Checked BEFORE the sign-in guard below only in ordering, not in strictness: the
      // guard applies here too, and is repeated inside this branch, because attaching a
      // shop to an account is impossible without one.
      if (authCode) {
        if (!getToken()) {
          setState({
            kind: "error",
            message: "You're signed out, so we can't attach this shop to your account. Sign in, then start the connection again from Stores.",
          })
          return
        }
        try {
          const data = await exchangeTiktok({ auth_code: authCode })
          if (data.error) throw new Error(data.error)
          setState({ kind: "ok", shop: data.shop_name || "your TikTok shop" })
          setTimeout(() => { window.location.href = "/stores?connected=1" }, 1200)
        } catch (e: unknown) {
          setState({ kind: "error", message: e instanceof Error ? e.message : "Connection failed." })
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

      const pkce = readPkce()
      if (!pkce?.verifier) {
        setState({ kind: "error", message: "Lost the security key. Start the connection again from Stores — don't reload this window." })
        return
      }
      if (pkce.state && returnedState && pkce.state !== returnedState) {
        // Non-fatal: the PKCE verifier still binds the code. Log and continue.
        console.warn("OAuth state mismatch — continuing (PKCE verifier still validates).")
      }

      try {
        const data = await exchangeEtsy({ code, code_verifier: pkce.verifier, redirect_uri: pkce.redirect })
        clearPkce()
        setState({ kind: "ok", shop: data.shop_name || "your Etsy shop" })
        setTimeout(() => {
          window.location.href = "/stores?connected=1"
        }, 1200)
      } catch (e: unknown) {
        clearPkce()
        setState({ kind: "error", message: e instanceof Error ? e.message : "Connection failed." })
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

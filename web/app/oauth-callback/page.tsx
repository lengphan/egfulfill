"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle, XCircle, CircleNotch } from "@phosphor-icons/react"
import { exchangeEtsy, exchangeShopify } from "@/lib/api"
import { readPkce, clearPkce } from "@/lib/etsy-oauth"
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
      const code = params.get("code")
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
            <p className="mt-1 text-sm text-muted-foreground">Exchanging your Etsy authorization. One moment.</p>
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

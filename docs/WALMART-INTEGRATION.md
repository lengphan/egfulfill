# Walmart Marketplace — what connecting sellers actually requires

Research only. **Nothing is built** — there is no `server/src/routes/walmart.js`. Walmart
appears in [`web/components/app/stores-manager.tsx`](../web/components/app/stores-manager.tsx)
as a non-live channel (`soon: "Awaiting app approval"`), and `walmart-` is already a
recognised order-source prefix in [`web/lib/order-format.ts`](../web/lib/order-format.ts).

Verified against Walmart's developer portal on **2026-08-06**. Where a detail could not be
confirmed from the public docs it says so — do not treat those lines as settled.

---

## 1. The question this answers: one key, or one per seller?

**One per seller.** Two different credentials exist and only one of them scales:

| Credential | Where it comes from | Reaches |
|---|---|---|
| **Seller API key** | Seller Center → Developer Portal → `developer.walmart.com/generateKey` | **that one seller's account only** |
| **Solution Provider app** | Solution Provider Center + an App Store listing | **every seller who presses Connect** |

EGFULFILL needs the second. A seller-generated key pair is fine for poking at the API with
our own account and useless for anyone else's — the same public-vs-private call already made
for Amazon SP-API.

## 2. The deadline that makes this urgent

Walmart retired the old multi-seller mechanism (**Delegated Access**) mid-2026:

| Date | Effect |
|---|---|
| **30 July 2026** | creating new Delegated Access keys ENDED — already passed |
| **30 September 2026** | existing Delegated Access keys STOP WORKING |

The replacement is **OAuth 2.0 seller authorization through the Walmart App Store**. If the
credentials we hold are a Delegated Access pair issued before 30 July, they have weeks left
and nothing should be built on them.

**Check which we hold before writing any code.** The portal it came from decides it (§1).

## 3. Getting listed — the part that isn't code

**The seller Developer Portal (`developer.walmart.com/generateKey`) is the wrong place for
us.** It issues keys scoped to one seller account. A Solution Provider registers an APP, in
the **Solution Provider Center**, and the credentials fall out of that registration.

New Solution Providers **must** use OAuth 2.0 — Delegated Access is only honoured for
providers with pre-existing contracts, and it dies anyway (§2).

**Walmart quotes three to five weeks** for the whole approval-and-publication process.

| # | Step | Where |
|---|---|---|
| 1 | Submit the application | channel partner prospect portal |
| 2 | Approval email → consultation | Walmart Partnerships team |
| 3 | Register for **sandbox** access | Solution Provider Center |
| 4 | Build the OAuth 2.0 flow (§4) against `sandbox.walmartapis.com` | us |
| 5 | Register the app for the Seller Center App Store | Solution Provider Center |
| 6 | Kickoff call, **1–2 days** after submitting | Walmart |
| 7 | App sits **In Review** | Walmart |
| 8 | **Demo call** — show it working | Walmart |
| 9 | Approved → **Ready to Publish** | Walmart |
| 10 | We press publish; sellers can now Connect | us |

### What app registration asks for

Credentials are issued **after** the marketing details are filled in, not before — so the
listing copy is on the critical path, not an afterthought.

**Technical**
- **App Login URL** — the page a seller sees after clicking Connect
- **App Callback / redirect URL(s)** — where sellers land post-authentication (one or more)
- **Client URL** — the app's website. *Not* the OAuth redirect; easy to conflate
- **API scopes** — these get listed verbatim in the seller-facing data-privacy notice

**Listing**
- name, description, contact email
- square logo (SVG or PNG, ≤1MB); banner 1920×400 (≤5MB)
- 200-character description, up to 5 feature bullets, pricing, support contact + URL

### The decision this forces on us

The **App Login URL** and **Auth Callback URL** get registered with Walmart, so they land in
the same bucket as the Etsy and Shopify redirect URIs: changing them later means
re-registering in *their* system. That has to be settled before step 5, not after — see
CLAUDE.md §3 on why the apex is load-bearing and why `oauth-callback.html` still exists.

## 4. The flow, which is the same shape as Etsy/Shopify/TikTok

Authorization-code OAuth, so the existing popup-OAuth pattern ports rather than being
redesigned. Two URLs must be registered with Walmart at app-registration time — an **App
Log-in URL** and an **Auth Callback URL**.

1. Seller clicks **Connect** on our app in Seller Center → Apps.
2. Walmart opens our **App Log-in URL** with `?walmartCallbackUri=…&clientType=seller`.
3. We sign the seller in on our side, then redirect them to `walmartCallbackUri` with
   `responseType=code`, `clientId`, `redirectUri`, `clientType`, `nonce`, `state`.
4. Walmart redirects to our **Auth Callback URL** with `code`, `type=auth`, `clientId`,
   `state`, **`sellerId`**. Validate `state`, keep `sellerId`.
5. `POST https://marketplace.walmartapis.com/v3/token`
   - `Authorization: Basic base64(clientId:clientSecret)`
   - `WM_PARTNER.ID: <sellerId>` · `WM_SVC.NAME: Walmart Marketplace`
   - `WM_QOS.CORRELATION_ID: <guid>` · `WM_MARKET: us`
   - `Content-Type: application/x-www-form-urlencoded`
   - body `grant_type=authorization_code&code=…&redirect_uri=…`
6. Store the **`sellerId` → `refresh_token`** mapping. That mapping *is* the connection.

**Token lifetimes:** access token **15 minutes** (900s); refresh token **1 year**. Every
business call then needs `Authorization: Bearer …` plus `WM_PARTNER.ID`, `WM_MARKET`,
`WM_SVC.NAME` and a fresh `WM_QOS.CORRELATION_ID`.

### What this means for us, concretely

- **A 15-minute access token cannot be cached at module load.** It has to be minted per call
  or held with an expiry — the same trap as CLAUDE.md §3's "read integration keys at call
  time, not module load", one step worse.
- **The refresh token is the connected account.** Losing it means every seller reconnects by
  hand. It belongs in the DB beside the Etsy/Shopify tokens, not in env.
- **A refresh token expires after a year even if healthy.** Nothing else we integrate with
  does that; it needs a re-auth prompt before it lapses, or shops silently stop syncing.
- **`redirect_uri` is registered with Walmart**, so it lands in the same category as the Etsy
  and Shopify callbacks: changing host means re-registration with the provider, in their
  system, not ours. See CLAUDE.md §3.

## 5. Base URLs

| | |
|---|---|
| Production | `https://marketplace.walmartapis.com` |
| Sandbox | `https://sandbox.walmartapis.com` |

A sandbox exists — worth confirming it covers orders and not only fulfilment status, because
the supplier integrations here have repeatedly had unvalidated payloads (S&S, Otto, SanMar,
TikTok publish) and this one should not join them.

## 6. NOT yet verified

Honest gaps, so nobody builds on a guess:

- **Exact Orders endpoint paths.** The reference pages don't render for a plain fetch, so the
  paths for get-released-orders, acknowledge and ship-with-tracking are unconfirmed. They do
  not change the plan; pin them down against the reference guide when building.
- **Where we actually are in the §3 table.** `stores-manager.tsx` shows "Awaiting app
  approval", but that is a HARDCODED literal in the `CHANNELS` array — it reflects no real
  status and should not be read as evidence that anything was submitted.
- **Whether `WM_CONSUMER.CHANNEL.TYPE` is required for us.** Documented as optional channel
  tracking; Walmart has historically issued one per solution.

## 7. Suggested order of work

1. **Establish where we actually are in the §3 table** — applied? approved? sandbox issued?
   The UI string proves nothing. Everything else depends on this.
2. Settle the App Login URL and Auth Callback URL before registering the app (§3), because
   changing them afterwards means re-registering with Walmart.
3. `server/src/routes/walmart.js` copying `shopify.js`'s shape: connect → callback → token
   exchange → store `sellerId`+`refresh_token`, then order import.
4. Tracking push back, which is what makes it fulfilment rather than a read-only feed.
5. Flip `live: true` in `stores-manager.tsx` **only** once the whole loop works against a
   real shop — that flag is a promise to a seller that the button works.

## Sources

- [OAuth 2.0 authorization](https://developer.walmart.com/us-marketplace/docs/oauth-20-authorization)
- [Delegated access authorization](https://developer.walmart.com/us-marketplace/docs/delegated-access-authorization)
- [Authentication](https://developer.walmart.com/us-marketplace/page/authentication)
- [Token API](https://developer.walmart.com/us-marketplace/reference/tokenapi)
- [Orders API overview](https://developer.walmart.com/us-marketplace/docs/order-management-api-overview)

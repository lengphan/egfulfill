# EGFULFILL — Front-End Migration Plan (static HTML → Next.js + shadcn/ui)

**Goal:** move the front-end to the same stack Kiloships uses — **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui (Radix + lucide)** — for a permanently polished, DRY UI, **without touching the working Fastify + PostgreSQL backend**, and **without a big-bang freeze** (both sites run in parallel behind Caddy, migrated page-by-page).

---

## 1. Where we are today

| Layer | Current | Keep / Replace |
|---|---|---|
| Front-end | 44 static HTML pages (~70k lines), ~40 vanilla-JS modules, Tailwind CDN, no build | **Replace** (incrementally) |
| Back-end | Fastify (Node 20) + PostgreSQL, REST `/api/*` | **Keep as-is** |
| Client state | `localStorage` (`EGStore`) + API bridge (`EGAuth`) | **Replace** with TanStack Query + a thin store |
| Deploy | VPS · Docker Compose · Caddy (static + `/api` proxy) | **Extend** — Caddy also proxies the Next app |

The backend is the solid half — the API contract (`/api/*`) becomes the stable seam the new front-end builds against.

---

## 2. Target architecture

```
Browser
  │
  ▼
Caddy (VPS, HTTPS)                      ← single entry point, routes by path
  ├── /api/*        → Fastify :3000     (UNCHANGED)
  ├── /<migrated>*  → Next.js :4000     (next start, in a container)
  └── /<not-yet>*   → static HTML       (current files, served as today)
```

- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind v4 + shadcn/ui + lucide-react.
- **Data:** TanStack Query for all `/api` reads/writes (replaces the `hydrate*`/`push*` localStorage-cache pattern). A small Zustand store for genuine client-only UI state.
- **Auth:** reuse the existing JWT. Store it in an httpOnly cookie (upgrade) or keep `localStorage['eg_token']` initially to match the current API with zero backend change.
- **Deploy:** Option A — Next on **Vercel**, API stays on VPS (Caddy or Vercel rewrites bridge `/api`). Option B — Next in a **container on the same VPS** behind Caddy (keeps everything self-hosted, one box). *Recommend B during migration* (no CORS, no domain juggling), revisit Vercel later.

The parallel-routing trick (Caddy path rules) is what makes page-by-page migration possible: a page is "migrated" the moment its route points at Next instead of the static file.

---

## 3. Shared foundation (build once, reused everywhere)

This is the payoff — the nav/topbar/cards written **once**:

1. **Design tokens** → port the `--bos-*` values (preset b7WjLthiq: taupe + indigo) into `globals.css` / `tailwind.config` as the shadcn theme. One source of truth.
2. **Component library** (`components/ui/*` via shadcn CLI + `components/app/*` custom):
   - `<Sidebar>` (nav rail), `<TopBar>` (the icon toolbar + account menu), `<AppShell>` layout
   - `<StatCard>` / KPI tile, `<DataTable>` (TanStack Table), `<Badge>`, `<Modal>`/Dialog, form inputs
   - `<MiniDesigner>` — the big one (port of `eg-design-tools.js`)
3. **API client** — typed `fetch` wrappers per resource (orders, wallet, designs, etc.) + Query hooks.

---

## 4. Page inventory & migration order (44 pages)

Migrate in waves, easiest/highest-value first, so the shared components harden before the hard pages.

**Wave 0 — Scaffold** (no user-facing change)
- Next app, Tailwind, shadcn init, tokens, `<AppShell>`/`<Sidebar>`/`<TopBar>`, API client, auth, Caddy dual-routing. Deploy an empty authed shell.

**Wave 1 — Marketing/public (13)** — simplest, presentational, SEO wins
`index, about, howitworks, pricing, products, product-detail-public, help, security, privacy, terms, ip-policy, apidocs, api-playground`

**Wave 2 — Auth (6)**
`login, seller-login, seller-signup, forgot-password, reset-password, oauth-callback`

**Wave 3 — Seller core (high value, medium complexity)**
`seller (dashboard), wallet, analytics, settings, stores, chat`
*(wallet first — we just redesigned it, so it's the reference implementation for a data page.)*

**Wave 4 — Seller catalog/design (complex, shared MiniDesigner)**
`products-dash, product-detail, product-picker, product-templates, catalog, image-library, design-lab, design-board, design-maker`

**Wave 5 — Orders (most intricate seller flow)**
`orders, order-detail` — column-array tables, import/create modal, live sync.

**Wave 6 — Factory/staff (largest files, highest risk, last)**
`admin, operator, warehouse, floor, designer, superspy` — 10k–13k-line pages; migrate after the component library + MiniDesigner are proven.

**Special:** `mobile.html`, `embroidery-react.html`, `sw-mobile.js` (service worker) — evaluate individually; `embroidery-react` may already be React-ish.

---

## 5. JS module strategy (~40 modules)

| Group | Modules | Plan |
|---|---|---|
| Theme/anim/chrome | `eg-theme, eg-board, eg-anim, eg-cursor, eg-aura, eg-dither, eg-spin, *-drag` | **Drop** — replaced by React components + Tailwind + Framer Motion |
| State/data | `egfulfill-store, egstore-api, egfulfill-connect, egfulfill-tracking` | **Rewrite** as typed API client + Query hooks |
| Shared designer | `eg-design-tools` (biggest), `eg-receipt-wallet` | **Port carefully** to `<MiniDesigner>` / `<WalletCard>` (highest effort) |
| Feature | `eg-withdraw, eg-addfunds, eg-order-chat, eg-guides, eg-new-order, eg-products, eg-catalog-io, eg-financials, eg-guard, …` | **Reimplement** as components/hooks alongside their page wave |
| Integrations (client) | `eg-etsy, eg-shopify, eg-tiktok, eg-usps` | Thin — most logic is already server-side; port the UI triggers |
| Keep as-is | Service worker, anything the API owns | Minimal change |

---

## 6. Risks & mitigations

- **`eg-design-tools.js` (shared mini designer)** — the single riskiest port (canvas, layers, thread-match, used on seller + all factory boards). *Mitigate:* port it early as a standalone component with its own test page before any board depends on it.
- **Wallet money flows (VietQR VA, withdraw, idempotent ledger)** — *Mitigate:* backend is unchanged; only re-skin the UI calling the same endpoints. Verify against the real API in staging.
- **Order tables (COL_ORDER, dual renderers, Etsy `id≠num`)** — *Mitigate:* one `<DataTable>` with column config replaces the hand-synced arrays; encode the `id`/`num` duality in types.
- **Auth/redirect guards** — replace per-page redirect scripts with Next middleware.
- **Regression during parallel run** — Caddy routes only migrated paths to Next; the rest stay on the proven static files, so nothing breaks until explicitly cut over.

---

## 7. Suggested phasing (checkpoints, not calendar promises)

1. **Phase A – Foundation:** Wave 0 + shared components + tokens + deploy shell. *Biggest single chunk; everything after reuses it.*
2. **Phase B – Low-risk pages:** Waves 1–2 (marketing + auth). Proves the pipeline end-to-end.
3. **Phase C – Seller core:** Wave 3, wallet first. Proves the data-page pattern.
4. **Phase D – Designer/catalog:** Wave 4 + `<MiniDesigner>`.
5. **Phase E – Orders:** Wave 5.
6. **Phase F – Factory boards:** Wave 6.
7. **Phase G – Cutover & cleanup:** remove static files + old JS, drop Tailwind CDN, optionally move Next to Vercel.

Each phase ends shippable. You can stop/pause between any of them.

---

## 8. Cost reality

This is a **large, multi-session investment** (the front-end is ~70k lines). It gets cheaper the sooner it starts (pre-launch, less to convert). The static-CSS polish remains the cheap *stopgap* to look good meanwhile — it is not the destination.

**Decision needed before Phase A:** deploy target (VPS-container vs Vercel), and auth model (keep localStorage token vs upgrade to httpOnly cookie).

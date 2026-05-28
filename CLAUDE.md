# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**EGFULFILL** — a print-on-demand fulfillment platform UI built as static HTML files. No build step, no framework. Every page is a self-contained `.html` file with Tailwind CSS via CDN and all styles/scripts inline.

Deployed to Netlify via drag-and-drop of this folder. Access any page at `your-site.netlify.app/factory.html` etc.

## Screenshotting with Puppeteer

Puppeteer is installed locally (`node_modules/`). Use Node inline — no CLI shortcut:

```js
node -e "
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('file:///Users/linhphan/Downloads/.claude/factory.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'screenshots/ss_check.png', fullPage: false });
  await browser.close();
})();
"
```

Save all screenshots to `screenshots/` to keep the root clean. Read with the Read tool to visually verify.

To screenshot a specific section in `factory.html`:
```js
await page.evaluate(() => showSection('print'));
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'screenshots/ss_print.png' });
```

## Architecture: Two Distinct App Contexts

### Seller-Side (multiple `.html` files)
Navigation is standard `<a href="page.html">` links. Each file is an independent page:

| File | Purpose |
|---|---|
| `index.html` | Marketing landing page |
| `dashboard.html` | Seller overview — orders, revenue, alerts |
| `orders.html` | Order list + create order modal |
| `products-dash.html` | Product catalog management |
| `design-lab.html` | Design upload + mockup generator |
| `design-maker.html` | Canvas-based design editor |
| `fulfillment.html` | Fulfillment status tracker |
| `analytics.html` | Revenue/order charts |
| `stores.html` | Connected store management |
| `wallet.html` | Balance, payouts, transaction history |
| `chat.html` | Seller ↔ factory messaging |
| `settings.html` | Account, billing, integrations |
| `apidocs.html` | API reference |

### Factory-Side (four separate single-file apps)

All four share the same `showSection(id)` / `.section.active` navigation pattern. Each is entirely self-contained with its own JS data.

| File | Role | Key data array |
|---|---|---|
| `factory.html` | Original full-featured factory dashboard | `ORDER_DATA` |
| `operator.html` | Design review & print approval | `OP_ORDERS` |
| `warehouse.html` | Intake, labeling, print queue | `WH_ORDERS` |
| `admin.html` | Admin overview across all roles | own ORDERS |

**`factory.html` sections:** `overview`, `orders`, `inventory`, `purchases`, `products`, `shipping`, `print`, `chat`, `users`, `balance`, `seller-sync`, `settings`, `sellers`

Key `factory.html` JS patterns:
- `receivedOrders = new Set()` — tracks orders through 4-step intake; `openModal(num)` routes to detail vs intake flow
- `ORDER_DATA` — per-order item statuses (`queued → printing → qc → packed → shipped`)
- `printQueue[]` — orders pushed here when all items reach `packed`; renders in Print section
- `ALL_ALERTS` + `setInterval(tickAlerts, 3500)` — cycles alerts in Overview live feed
- `FLOAT_CONVOS` — message history for the floating chat widget

**`operator.html`** key patterns:
- `OP_ORDERS` array, `OP_STATUS_MAP/OP_STATUS_STYLE` for inline-style status badges
- `FOM_ADDR_DATA` — lookup for order ship-to details in the full order modal; falls back to `fomOrder.addr`
- `FOM_PT_BG/FG/LBL` — print type badge styles (global); `ITEM_STATUS_BG/COLORS/LABELS` — item status styles

**`warehouse.html`** key patterns:
- `WH_ORDERS` array, `REV_ORDER_DETAIL` — detail data for the review modal; falls back to `o.addr` from `WH_ORDERS`
- `printQueue[]` + `PQ_STATIC[]` — combined for Print Queue section rendering
- `whRenderOrders()` is monkey-patched at the bottom (live order prepend patch)

## Cross-Page State: `egfulfill-store.js`

A `localStorage` bridge (`key: 'egfulfill_orders'`) that simulates a backend for local flow testing. Loaded via `<script src="egfulfill-store.js">` in `orders.html`, `order-detail.html`, `operator.html`, `warehouse.html`, and `admin.html`.

- `EGStore.add(order)` / `EGStore.getAll()` / `EGStore.update(id, patch)` — CRUD on `localStorage`
- `EGStore.renderSellerOrders(tbodySelector)` — renders live orders into the seller orders table
- `SELLER_STATUS` map inside the file converts factory statuses → seller-facing labels
- **Replace `EGStore` calls with real API calls** when a backend is added

## Design System

All pages share these tokens (defined inline per file, not in a shared stylesheet):

```
Background:    #f4f2ef
Borders:       #e5e4e0
Dark buttons:  #111827
Gold accent:   #d4a017
Text primary:  #191918
```

**Shared CSS classes** (copied into each file's `<style>` block):
- `.ni` / `.ni.on` — sidebar nav items
- `.btn`, `.btn-dk`, `.btn-out`, `.btn-gold`, `.btn-green`, `.btn-amber` — buttons
- `.card` — white bordered card
- `.stat-card` + `.s-red/blue/purple/amber/teal/green` — stat cards with colored top border
- `.badge`, `.b-new/queue/prod/qc/packed/shipped` — status pills
- `.dtable` — data table
- `.input`, `.select` — form controls
- `.modal-overlay` / `.modal-hidden` — modal system
- `.section` / `.section.active` — factory section toggling
- `.fi` — `fadeUp` entrance animation

## UI Consistency Reviewer Agent

A sub-agent that screenshots pages, reads source files, and audits 8 dimensions of consistency: design tokens, header/topbar, layout & structure, component fidelity, typography, navigation patterns, spacing rhythm, and animation.

**To trigger it**, describe what you need in natural language — Claude will automatically invoke it:
- "Check if all my pages are visually consistent"
- "Run a UI consistency review on orders.html and dashboard.html"
- "The header in settings.html looks off — can you audit it?"
- "Use the ui-consistency-reviewer on all seller pages"

**Scope:**
- Seller pages: `dashboard.html`, `orders.html`, `products-dash.html`, `design-lab.html`, `design-maker.html`, `fulfillment.html`, `analytics.html`, `stores.html`, `settings.html`, `wallet.html`, `chat.html`, `apidocs.html`
- Factory pages: `factory.html`, `operator.html`, `warehouse.html`, `admin.html`

The agent produces a structured report with a consistency score per file and prioritized fix list. It will ask before applying any changes. Full spec: `agents/ui-consistency-reviewer.md`.

## Iteration Workflow (when matching a reference screenshot)

1. Generate/edit the HTML
2. Screenshot with Puppeteer
3. Compare — specify observed vs expected values (e.g. "gap is 16px, reference shows 24px")
4. Fix every mismatch
5. Re-screenshot — minimum 2 full rounds before stopping

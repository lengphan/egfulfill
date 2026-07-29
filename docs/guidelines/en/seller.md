# Seller — How-to Guide

Everything you do as a shop owner. If you're a **team member**, you'll only see the pages your owner shared with you.

---

## Getting oriented

When you sign in you land on your **Dashboard**. The left sidebar is how you move around: Dashboard, Orders, Products, Stores, SpyDeck, Reports, Wallet, Design Lab, Chat — and under *Account*, Developers, Help, Settings.

![Seller dashboard and sidebar](../images/seller-dashboard.png)

---

## Getting orders in — the three ways

There are **three ways an order reaches your queue**. Whichever you use, it ends up in the same place: **Orders**.

### A. Synced from a connected store (Etsy / Shopify / TikTok)

Best for real marketplace sales — orders flow in automatically.

1. Go to **Stores**.
2. Click **Connect** on Etsy, Shopify, or TikTok. A pop-up opens for you to sign in to that marketplace and approve access.
3. On first connect, choose **how far back** to pull existing orders (the backfill window).
4. Done — new orders now sync in on their own and appear under **Orders**.

![Stores — connect a marketplace](../images/stores.png)

> Syncing never changes anything on the marketplace side — it's safe for a live shop. Etsy may hide the buyer's address until Etsy approves the app; that's Etsy's rule, not an error.

### B. Import a sheet (bulk / manual list)

Best for a batch of orders you already have in a spreadsheet.

1. Go to **Orders** → click **Import**.
2. Get the format right: click **Template (.xlsx)** to download a ready-made sheet. **Required** columns are plain; **optional** ones are marked `(optional)` — you can leave those blank.
3. Fill your rows. The only truly required fields are the ship-to **name, address, city, state, zip**, plus either an **Item SKU** or **Product Title**.
4. Bring it in three ways — all in the **File** tab: drop/upload a **.csv, .xlsx or .xls**, **Paste** rows copied from a spreadsheet, or load a **Google Sheet** by link.
5. Check the preview — valid rows are green, skipped rows show why. Click **Import**.

![Import orders — file, paste, or Google Sheet](../images/import-dialog.png)

> Tip: put your saved design's **Template ID** in that column and the importer applies the whole design (blank + artwork + placement + method) for you.

### C. Enter one by hand

Best for a one-off.

1. Go to **Orders** → **New order** (`/orders/new`).
2. Fill in the customer + shipping address, add the item(s), pick the blank/colour/size.
3. Save — it drops into your queue like any other order.

![Manual order form](../images/order-new.png)

---

## Working an order to done

However it arrived, an order isn't ready until each line is **set up** and the order is **submitted**.

1. Open the order from **Orders**.

   ![Orders queue](../images/orders-list.png)

2. For each line, if the blank isn't set you'll see **"Pick a blank…"**. Click it and choose the **blank**, then **colour / size / print method**.

   ![Pick a blank for a line](../images/variant-picker.png)

   - Marketplace orders arrive with the variant **unset** — you must pick it.
   - Two lines of the same product are **separate jobs** — set each one.
3. When every line is set up, **Submit** the order. This **charges your wallet** for fulfilment and sends it to the factory. Prices **freeze** at submit — so finish setting variants first.
4. If you need to change something after submitting, **Cancel** first (that refunds your wallet), fix it, and submit again.
5. Once we ship, the **tracking** number is pushed back to the buyer automatically.

---

## Products — your catalogue

Set up the products you sell so orders can be costed and made.

1. Go to **Products** → **New product** (or open one to edit).
2. **Photo** section: the first photo is the **Main** image; tag each photo with the **colour** it shows, and add more photo slots as needed.
3. Set pricing per size tier: **Product cost / Base cost / Shipping** — the margin per unit is shown for you.
4. Always set the **blank** — it's what production and stock levels key on.

![Product editor — Photo section + pricing](../images/product-editor.png)

---

## Wallet — paying for fulfilment

Fulfilment is charged to your prepaid balance, so keep it topped up.

1. Go to **Wallet** → **Top up**.
2. Choose **card (Stripe)**, **PayPal**, or **VietQR** (scan the QR to pay from a Vietnamese bank). Note the **minimum** top-up.
3. Your balance updates once payment confirms; every charge and refund is listed in the history.

![Wallet and top-up](../images/wallet-topup.png)

---

## The rest of your pages

- **Reports** — sales and fulfilment analytics over time. ![Reports](../images/reports.png)
- **SpyDeck** — research competitor products and stores. Read-only. ![SpyDeck](../images/spydeck.png)
- **Design Lab** — build and store artwork, keep an image library, prep files for orders. ![Design Lab](../images/design-lab.png)
- **Chat** — your direct support thread with EGFULFILL. Ask anything. ![Chat](../images/chat.png)
- **Developers** — API keys + sandbox, only if you're integrating your own systems. ![Developers](../images/developers.png)
- **Settings** — Profile, your API keys, **Team** (invite members and choose their pages), and your Plan. ![Settings](../images/settings.png)

---

## Quick rules

- Set up **every** line (blank + variant) **before** submitting — prices freeze at submit.
- Keep enough **wallet** balance or submit is blocked.
- To change a submitted order, **cancel → edit → resubmit**.
- Team members only see the pages you shared in **Settings → Team**.

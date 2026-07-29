# Operator — How-to Guide

You work the production floor. **Your zone ends at the scan** — money moves (refunds, wallet reverts, buying against the house account) belong to Warehouse/Admin. After sign-in you land on the staff **Dashboard**.

![Staff dashboard](../images/staff-overview.png)

---

## Work the production queue

1. Open **Orders** (the production hub) — every order pushed to the floor.

   ![Production hub](../images/production-hub.png)

2. Click an order to see its lines, artwork, and current stage.
3. Move a line forward through its stages using its status control. The board only offers moves your role is allowed to make from where the line currently sits.
4. Marketplace lines may arrive with variants unset — only the factory's own picks pre-fill.
5. **Shipping is order-level**: the board won't let you mark an order *shipped* until every line on it is ready — a parcel can't go out half-made.

---

## Design board

Open **Board** to see artwork cards. You can claim and follow a card, but **approving** a design is a designer/admin step (the readiness chip stays amber until approved, then turns violet).

![Designer board](../images/designer-board.png)

---

## Shipping

**Shipping** has two tabs:

- **Dispatch** — today's out-queue; work it down to empty by evening.
- **Shipments** — the archive of parcels already sent.

Buy labels through the aggregator (the app handles this) — if you ever see a USPS credit-card error, the request took the wrong path; flag it.

![Shipping — Dispatch + Shipments](../images/shipping.png)

---

## Inventory

**Inventory** has two tabs:

- **Stock** — levels on hand.
- **Scan** — the stock in/out station. You can **read** here, but **writing stock in/out is a Warehouse action** — the station enforces it.

Stock is counted against the **blank** SKU (ignore the print-method suffix like `-EMB` / `-DTG`).

![Inventory — Stock + Scan](../images/inventory.png)

---

## Purchasing

**Purchasing** = **Suppliers** (browse S&S / Otto) + **Purchase** (cart / on-order / history). You can build a **draft** purchase order, but **placing it with a supplier is a Warehouse/Admin click**.

![Purchasing](../images/purchasing.png)

---

## Other pages you can use

- **Digitizer** — turn artwork + text into an embroidery machine file (`.emb`) or PNG. ![Digitizer](../images/digitizer.png)
- **Broadcasts** — you can **draft** seller emails; only an admin can **send**. ![Broadcasts](../images/broadcasts.png)
- **Products / Catalogue / SpyDeck / Design Lab** — the shared tools. ![Products](../images/products-list.png)
- **Chat, Help, Notifications, Settings** — shared.

---

## Do NOT

- Reverse a shipped/charged step, refund, or touch a wallet balance — that's Warehouse/Admin.
- Place a live supplier order, or write stock at the Scan station.

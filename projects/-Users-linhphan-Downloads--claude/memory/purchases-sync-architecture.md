---
name: purchases-sync-architecture
description: How design-upload out-of-stock → backorder/PO sync works across factory boards
metadata:
  type: project
---

The factory boards' Purchases section is now live, not hardcoded. Flow:
- `design-maker.html` `pushToProduction()` calls `EGStore.reportDesignPush(ordId, sku)` (step 7).
- `egfulfill-store.js` holds the API: keys `eg_backorders` + `eg_purchase_orders`; methods `getBackorders/addBackorder/removeBackorderSku`, `getPurchaseOrders/addPurchaseOrder`, `reportDesignPush`, `clearPurchases`. `reportDesignPush` checks `eg_inventory`; if a SKU is unstocked/short it files a backorder. Writes fire an `eg-purchases-changed` event (same-tab) + native `storage` event (cross-tab).
- `warehouse.html`/`admin.html`: `BACKORDER_QUEUE`/`PO_HISTORY` start empty; `whSyncPurchases()`/`admSyncPurchases()` hydrate them from EGStore on load + on the two events; `whPersistPO`/`admPersistPO` persist created POs and clear consumed backorders.
- `operator.html`: read-only — `opRenderPurchases()` (script at end of body) renders an "Out of Stock — Awaiting Purchase" card + live PO history table (`#op-po-history-tbody`).

The old hardcoded sample arrays (PO-0041/40/39, FF-8817/8813) were removed. Replace EGStore calls with a real backend later.

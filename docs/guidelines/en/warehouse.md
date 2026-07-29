# Warehouse — How-to Guide

You do everything an operator does **plus custody and money**: writing stock, buying labels, placing supplier orders, and Finance. Start with the **[Operator guide](operator.md)** — it all applies. Below is what's **extra**.

---

## Write stock at the Scan station

Unlike an operator (read-only at the station), you can **book stock in and out**.

1. Open **Inventory → Scan**.
2. Scan or enter the item, choose **in** or **out**, set the quantity, confirm.
3. Stock moves against the **blank** SKU — strip the print-method suffix (`-EMB` / `-DTG` / …) if present.

![Inventory — Scan station](../images/inventory.png)

---

## Buy and void shipping labels

1. Open **Shipping → Dispatch**, pick an order.
2. Buy the label — it goes through the aggregator automatically. (A USPS credit-card error means it wrongly took the USPS-direct path — flag it.)
3. Need to undo one? Use the label's **void/refund** action.

![Shipping](../images/shipping.png)

---

## Place supplier orders

1. Open **Purchasing → Purchase**, review the draft PO.
2. **Place** it with S&S / Otto. Supplier ordering is gated off until it's switched live — **check the payload before committing real money**.

![Purchasing](../images/purchasing.png)

---

## Finance

**Finance** has two tabs:

- **Wallet** — house balances and every transaction.
- **Partner costs** — what byeastside / Pink Design / carriers / suppliers are owed.

![Finance](../images/finance.png)

Rules of the ledger:

- It is **append-only** — you never edit history; to correct something you **add** a balancing entry.
- Costs are booked **as incurred** (a label's postage, a PO's total) and reversed on cancel.
- Every reversal must leave the ledger **balanced**.

---

## Also yours

- **Developers** — for **connection testing** (verifying an integration works), not minting seller keys.
- All the operator boards + shared tools.

## Do NOT

- Destroy a synced order or anything a connected shop owns.
- **Send** seller broadcasts, or change platform settings / user roles / permissions — those are Admin.

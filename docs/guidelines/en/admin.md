# Admin — How-to Guide

You have **full access** to every board, tool, and setting. The day-to-day boards work exactly as in the [Operator](operator.md) and [Warehouse](warehouse.md) guides — read those too. This covers what's **admin-only**.

---

## Send seller broadcasts

Staff can draft; **only you can send**.

1. Open **Broadcasts**, write or open a draft.
2. Review the audience, then **Send**. Sending respects each seller's marketing **opt-out** — don't override it.

![Broadcasts](../images/broadcasts.png)

---

## The admin console — Settings

**Settings** is where you run the platform. Key tabs:

![Settings](../images/settings.png)

- **Platform** — factory-wide defaults: top-up amounts + minimum, pricing, fees, positions/design surfaces.
- **Users** — promote/demote staff (public signup only ever creates *sellers*) and set daily limits.
- **Permissions** — hide nav pages/tabs per role. **Hide-only**: it can restrict, never expose a staff page to a seller.
- **Suppliers** — how purchase orders pay and ship.
- **Usage** — per-platform API call volume + estimated spend, with monthly **alert** thresholds. Alerts only — nothing is throttled. Set a per-platform cost/call and monthly limit here.
- **Site content** — the public marketing homepage copy.
- **Activity** — the audit log of who changed what.
- **Backups** — on-demand + nightly database backups.
- **Integrations / API keys** — the platform's connected-service credentials (Stripe, suppliers, Wilcom, mail). Read at call time, so a key saved here applies on the next request.

---

## Money authority — Finance

You and Warehouse own the ledger (see the [Warehouse guide](warehouse.md) for how it works). Admin-specific: crediting a wallet is **staff-only by design** — a seller must never be able to credit themselves.

![Finance](../images/finance.png)

---

## Rules you enforce

- **Never risk a connected account.** Nothing may suspend a seller's shop or destroy synced data; sync must not overwrite what it didn't author. This outranks any feature.
- **Money is append-only and idempotent** — charge on submit, refund on cancel; retries never double-count.
- **Sellers never learn their design was used by another seller** — duplicate detection is factory-only.
- **Permissions are hide-only** — visible = `hasCapability && !hidden`.

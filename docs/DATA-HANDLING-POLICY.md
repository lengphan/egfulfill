# Data Handling, Classification and Processing Records

**Owner:** Linh Phan · **Version:** 1.0 · **Adopted:** 2026-08-04 · **Next review:** 2027-02-04

Companion to [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md). Amazon's Data Protection Policy
requires documented data handling, classification and privacy policies **with processing
records**; this file is the classification scheme and the processing register.

---

## 1. Classification

| Class | What it covers | Handling rule |
|---|---|---|
| **Restricted — Buyer PII** | Buyer name, street address, phone, email; shipping-label PDFs (the address is printed on them) | Never leaves the systems in §3. Visible only to warehouse and admin roles, at pack/ship. Deleted 30 days after shipment. Never in logs, never in a support ticket, never in a screenshot. |
| **Confidential — Seller & credential** | Seller account details, marketplace OAuth tokens, API keys, `JWT_SECRET`, `DB_PASSWORD` | Server-side only; never sent to the browser. Held in the root `.env`, readable by root. Rotated on staff change or suspected exposure. |
| **Internal — Operational** | Order numbers, SKUs, totals, tracking numbers, production status, wallet ledger | Staff by role. Retained for accounting and tax. |
| **Public** | Marketing site copy, published listing content, catalogue images | No restriction. |

**The rule that matters:** anything in *Restricted* is minimised at collection, never copied to
a laptop, and destroyed on schedule. If a task can be done without a buyer's name, it is.

---

## 2. Processing register

| # | Processing | Data class | Lawful basis / purpose | Source | Retention |
|---|---|---|---|---|---|
| P1 | Import marketplace orders | Restricted + Internal | Contract — fulfil the seller's order | Etsy, Shopify, TikTok Shop, Amazon SP-API | PII 30 days post-ship; order record retained |
| P2 | Buy a shipping label | Restricted | Contract — deliver the parcel | P1 | PII 30 days post-ship |
| P3 | Return tracking to the marketplace | Internal | Contract | P2 | Order lifetime |
| P4 | Production and QC | Internal | Contract | P1 | Order lifetime |
| P5 | Seller billing and wallet | Confidential + Internal | Contract; legal (tax) | Seller | 7 years (accounting) |
| P6 | Seller support assistant | Internal only — **PII excluded by query** | Legitimate interest — support quality | P1 | Thread lifetime |
| P7 | Database backups | All classes | Legitimate interest — continuity | Postgres | Per backup retention setting |
| P8 | Audit logging | Internal | Legal/security — incident detection | Application | Indefinite (≥12 months) |
| P9 | Seller marketing email | Confidential | Consent; opt-out honoured | Seller | Until opt-out |

**Buyer PII appears in P1, P2 and P7 only.** Every other process operates on order-level data
with no buyer identity attached. P6 is deliberately constructed that way — the query selects
order id, status, totals, tracking and item names, and does not select `customer` or `address`.

---

## 3. Where restricted data lives

| System | Role | Encryption |
|---|---|---|
| PostgreSQL 16 (dedicated Linux host) | System of record | AES-256 at rest (provider); TLS in transit; bound to `127.0.0.1` |
| Cloudflare R2 (private bucket) | Backups, artwork, label files | AES-256 at rest; signed expiring URLs only |
| Shippo / EasyPost | Label purchase | TLS; their own retention |
| Carrier (USPS/UPS) | Delivery | TLS |
| byeastside (dispatch) | Label PDF for physical pick | TLS |

Anywhere not on this list is out of policy. That includes laptops, USB drives, spreadsheets,
email attachments and chat messages.

---

## 4. Disposal

- **Buyer PII** — automated redaction 30 days after shipment (`server/src/routes/pii_retention.js`).
  Name, street address and label file are overwritten in place; the order row survives without
  buyer identity. The run is recorded in `audit_log` as `pii.purged` with a count.
- **Backups** — pruned on the configured retention schedule; expired dumps are deleted from R2.
- **Credentials** — rotated and the old value invalidated, not merely replaced in the file.
- **A seller disconnecting a store** — stored OAuth tokens are deleted and syncing stops.

---

## 5. Access

Role-based and enforced server-side on every request: `seller`, `operator`, `warehouse`,
`designer`, `admin`. Buyer addresses are reachable only by `warehouse` and `admin`. Sellers
see only their own orders; team members resolve to the owner's account. Every write is
recorded in `audit_log` with the individual actor, action, entity and before/after state.

Access is reviewed when anyone joins, changes role, or leaves.

---

## 6. Review log

| Date | Reviewer | Changes |
|---|---|---|
| 2026-08-04 | Linh Phan | Initial adoption |

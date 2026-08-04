# Incident Response Plan — Embroidery Goods Inc (EGFULFILL)

**Owner:** Linh Phan · **Version:** 1.0 · **Adopted:** 2026-08-04 · **Next review:** 2027-02-04

This plan exists because EGFULFILL holds marketplace buyer data — names and shipping
addresses synced from Etsy, Shopify, TikTok Shop and (pending approval) Amazon — and because
Amazon's Data Protection Policy requires a documented plan with defined roles, reviews every
6 months, and notification within 24 hours of detection.

**It is reviewed every 6 months.** Record each review at the bottom of this file. A plan
with no review history is not a plan.

---

## 1. Roles

| Role | Person | Responsibility |
|---|---|---|
| **Incident Manager (IMPOC)** | Linh Phan — security@embroiderygoods.com | Declares the incident, owns the timeline, makes the notification calls |
| **Technical Lead** | Linh Phan | Containment, eradication, restore |
| **Communications** | Linh Phan | Notifies Amazon, sellers, and regulators |

Roles may be held by one person while the company is small. Name a deputy as soon as there
is a second technical staff member — a plan that depends on one unreachable person fails at
the moment it is needed.

**Use `security@embroiderygoods.com`, not a personal address.** A role mailbox survives staff
changes and is what Amazon expects to reach during an incident.

---

## 2. What counts as an incident

Any of the following, confirmed or suspected:

- Unauthorised access to the database, the host, or object storage
- Buyer PII disclosed to any party not listed in Section 7
- Credential exposure — API keys, `JWT_SECRET`, `DB_PASSWORD`, SSH keys, marketplace tokens
- Malware or unauthorised code on the host
- A marketplace or partner notifying us of a breach affecting shared data
- Loss or corruption of data that cannot be restored from backup

Suspected counts. Escalate first; downgrade later.

---

## 3. Response steps

### Step 1 — Detect and triage (target: immediate)
Sources: the `audit_log` Activity page, Fastify request logs, infrastructure provider alerts,
failed-authentication and rate-limit events, or a report from a seller, partner or researcher.

The Incident Manager records the time of **detection** — the 24-hour notification clock starts
here, not when the incident began.

### Step 2 — Contain (target: within 1 hour)
- Revoke active sessions: rotate `JWT_SECRET` (invalidates every issued token)
- Rotate exposed credentials in the root `.env`, then `docker compose up -d --build`
- Rotate marketplace tokens; disconnect the affected shop connection if a seller's channel is implicated
- Isolate the host at the provider firewall if compromise is suspected
- **Do not delete evidence.** Snapshot the droplet before rebuilding

### Step 3 — Assess scope (target: within 12 hours)
Use `audit_log` — it records actor, role, action, entity and before/after state for every
write — to establish which records were touched, by which account, and when. Determine:

- Which sellers are affected
- Which buyers' PII was exposed, and what fields
- Which marketplace the affected orders originated from

### Step 4 — Notify (hard deadline: 24 hours from detection)
- **Amazon: security@amazon.com within 24 hours of detection**, for any incident involving
  Amazon Information. This deadline is contractual and is not conditional on having finished
  the scope assessment — send what is known and follow up.
- Affected sellers, in plain language: what happened, what data, what we are doing.
- Other marketplaces per their developer terms (Etsy, Shopify, TikTok Shop).
- Regulators and affected individuals where breach-notification law requires it.

### Step 5 — Eradicate and restore
- Remove the cause: patch the vulnerability, revoke the access, rebuild the host from a known
  good image
- Restore from the most recent encrypted backup in Cloudflare R2 (`pg_restore` into a rebuilt
  container). Target RPO 24 hours, RTO 4 hours.
- Verify integrity before returning to service: `/health`, a real API route, and a spot check
  that order data matches the backup's timestamp

### Step 6 — Post-incident review (within 14 days)
Written record: timeline, root cause, data affected, actions taken, and corrective actions
with named owners and due dates. Corrective actions are tracked to completion like any other
finding — 7 days for critical, 30 days for high.

---

## 4. Contacts

| Who | Where |
|---|---|
| Amazon security | security@amazon.com |
| Our security contact | security@embroiderygoods.com |
| Infrastructure (droplet, DB) | DigitalOcean support |
| Object storage (backups, artwork) | Cloudflare support |
| Shipping (buyer addresses) | Shippo · EasyPost |

---

## 5. Evidence sources

- `audit_log` table — append-only; actor, action, entity, before/after. Retained indefinitely.
- Fastify structured request logs — `docker compose logs api`
- `db_backups` table + the R2 bucket — what was recoverable and from when
- `wallet_ledger` — append-only; establishes whether money movement was affected
- Provider console logs — DigitalOcean, Cloudflare, Vercel

---

## 6. Detection cadence

The Activity log is reviewed **fortnightly** for anomalous access — unusual volume of order
reads, access outside working hours, or a role acting outside its zone. Record each review
below alongside the 6-month plan reviews.

---

## 7. Parties who legitimately receive buyer data

Anything outside this list is an incident.

| Party | Data | Purpose |
|---|---|---|
| Shippo · EasyPost | Buyer name + address | Purchase a shipping label |
| USPS · UPS | Buyer name + address | Deliver the parcel |
| byeastside (dispatch) | Label PDF (contains address) | Physical pick and hand-off to carrier |
| DigitalOcean | All application data at rest | Hosting |
| Cloudflare R2 | Encrypted backups, artwork | Storage |
| Vercel | Order data in transit | Front end / API proxy |
| Anthropic | Order status, totals, tracking, item names — **no name or address** | Seller support assistant |

---

## 8. Review log

| Date | Reviewer | Changes |
|---|---|---|
| 2026-08-04 | Linh Phan | Initial adoption |

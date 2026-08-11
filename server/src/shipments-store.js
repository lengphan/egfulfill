// STANDALONE SHIPMENTS — a label that belongs to no order.
// -----------------------------------------------------------------------------
// A re-ship, a sample, a parcel from someone else's system. Until now buying one of these
// minted an FF-* ORDER purely so the label had a row to live in, and that row then sat on
// the production board as a Draft with nothing to make — no lines, no design, no stock.
// ShipStation's equivalent creates a SHIPMENT and no order at all; this is that.
//
// SCOPE, deliberately narrow: only labels with no order come here. A label bought against a
// real order still lives on the order exactly as before, because manifests, dispatch, the
// marketplace push and the ledger all read it there, and moving them is a much larger change
// than the problem being solved. The shipments LIST reads both and doesn't care which.
//
// The ledger doesn't care either: `ref` is a string, so postage for sh_* books identically
// to postage for an order id, and every total already sums by type rather than by join.
//
// Not a route file on purpose — it is imported by the routes that need it, so nothing new
// has to be registered with Fastify. A malformed route option throws at startup and takes
// every endpoint with it; this can't.
import { q } from './db.js';

let _ready = null;
export function ensureShipments() {
  if (_ready) return _ready;
  _ready = q(`create table if not exists shipments (
       id             text primary key,
       tracking       text,
       -- The number a refunded label USED to carry. Kept apart from the live tracking
       -- column for the same reason as on orders: tracking is what says this is live and it
       -- has to go, but the digits are still what a buyer holding the parcel will quote.
       voided_tracking text,
       carrier        text,
       service        text,
       cost           numeric(10,2),
       label_url      text,
       provider       text,
       provider_ref   text,
       carrier_account text,
       -- Bought on a test key: real-shaped tracking and price, never actually charged.
       test           boolean not null default false,
       refund_ref     text,
       refund_status  text,
       -- What the CARRIER says, refreshed by the same poll the orders use.
       delivery_status text,
       delivery_detail text,
       delivery_checked_at timestamptz,
       to_name        text,
       to_city        text,
       to_state       text,
       to_zip         text,
       note           text,
       created_by     text,
       created_at     timestamptz not null default now()
     )`).catch((e) => { _ready = null; throw e; });
  return _ready;
}

/** A shipment id that can never be mistaken for an order id — every order is etsy-*, FF-*,
 *  tiktok-* or a bare seq, and none of them start with sh_. The void and label routes both
 *  branch on this, so the two namespaces must not overlap. */
export const isShipmentId = (id) => /^sh_/.test(String(id || ''));

export function newShipmentId() {
  return 'sh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Record a bought label that has no order behind it.
 *
 * Mirrors what recordLabel writes onto an order, minus everything that only makes sense for
 * one: no factory stage to advance, no marketplace to tell, no seller to charge.
 */
export async function recordShipment(b) {
  await ensureShipments();
  const id = b.id || newShipmentId();
  await q(
    `insert into shipments (id, tracking, carrier, service, cost, label_url, provider,
       provider_ref, carrier_account, test, to_name, to_city, to_state, to_zip, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (id) do nothing`,
    [id, b.tracking || null, b.carrier || null, b.service || null,
     (b.cost != null && isFinite(Number(b.cost))) ? Number(b.cost) : null,
     b.labelUrl || null, b.provider || null, b.providerId || null, b.carrierAccount || null,
     b.test === true, (b.to && b.to.name) || null, (b.to && b.to.city) || null,
     (b.to && b.to.state) || null, (b.to && (b.to.zip || b.to.postal_code)) || null,
     b.note || null, b.createdBy || null]);
  return id;
}

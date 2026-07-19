// Inbound email → order addresses.
//
// Etsy's "You made a sale!" email carries the buyer's shipping address, which their API
// withholds. A seller sets a ONE-TIME auto-forward rule for those emails; from then on
// addresses arrive per order with no export step. Forwarding your own mail breaks no
// terms, needs no credentials, and can't endanger the seller's Etsy account — unlike
// automating their Shop Manager session.
//
// Transport-agnostic on purpose: point any inbound-email provider (Mailgun Routes,
// SendGrid Inbound Parse, Postmark, CloudMailin) at POST /api/mail/etsy-sale, or have a
// poller push the same shape. The parsing and the guards live here, not in the pipe.
//
// THREAT MODEL — an open inbox is an injection surface. Anyone who can post here could
// otherwise write an address onto an order. Defences, in order:
//   1. shared secret in the URL (?key=) — the provider is the only caller
//   2. the forwarding address must belong to a KNOWN seller (or staff)
//   3. only fills orders that exist AND have no address (never overwrites)
//   4. the parsed address must be shaped like a US address
//   5. every write is audited
// The last three are the same guards the CSV import uses, so a compromised pipe can do
// no more than a mistyped spreadsheet.
import { q } from '../db.js';

const SECRET = process.env.MAIL_INGEST_SECRET || '';

/** Strip HTML to text while keeping line structure — addresses are line-oriented. */
function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<\s*(p|div|tr|li|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

/**
 * Pull the Etsy order number and the ship-to block out of a sale email.
 *
 * Deliberately loose: Etsy restyles these emails, and a parser anchored to exact markup
 * would break silently on the next template change. Anchors on the two things that have
 * to be there — a 9-11 digit order number, and a line group ending in "City, ST ZIP".
 */
export function parseSaleEmail(text) {
  const body = String(text || '');
  // Order number: "Order #4120026775" / "Order number: 4120026775" / bare in a URL.
  const om = body.match(/order\s*(?:#|number:?)\s*(\d{8,12})/i)
    || body.match(/receipt[_-]?id[=/](\d{8,12})/i)
    || body.match(/\/your\/orders\/(\d{8,12})/i);
  const orderId = om ? om[1] : '';

  // Address: find the LAST "City, ST 12345" line and walk upwards for the street lines.
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  let cityIdx = -1, cityM = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^(.{2,60}?)[,\s]+([A-Z]{2})[,\s]+(\d{5}(?:-\d{4})?)$/);
    if (m) { cityIdx = i; cityM = m; break; }
  }
  if (!cityM || cityIdx < 1) return { orderId, address: null };

  // Walk back over street lines. Stop at a label or a blank-ish separator — an address
  // block is short, so cap it rather than swallowing the whole email.
  const streets = [];
  for (let i = cityIdx - 1; i >= 0 && streets.length < 3; i--) {
    const l = lines[i];
    if (/^(ship(ping)? to|deliver to|address|order|item|qty|quantity|total|subtotal|note)\b/i.test(l)) break;
    // CONTAINS, not starts-with: Etsy wraps links in prose ("View it here https://…"),
    // and a link line is never part of an address block.
    if (/https?:\/\/|www\./i.test(l)) break;
    if (l.length > 80) break;
    streets.unshift(l);
  }
  // The first of those is usually the recipient NAME, not a street — a street starts
  // with a number or a PO box.
  let name = '';
  if (streets.length > 1 && !/^\d|^p\.?\s*o\.?\s*box/i.test(streets[0])) name = streets.shift();
  if (!streets.length) return { orderId, address: null };

  return {
    orderId,
    address: {
      name,
      street: streets[0] || '',
      street2: streets.slice(1).join(', '),
      city: cityM[1].replace(/,\s*$/, '').trim(),
      state: cityM[2].toUpperCase(),
      zip: cityM[3],
    },
  };
}

export function mailIngestRoutes(app) {
  /**
   * POST /api/mail/etsy-sale?key=<MAIL_INGEST_SECRET>
   * body: { from, subject, text, html }  — the shape every inbound provider posts.
   */
  app.post('/api/mail/etsy-sale', async (req, reply) => {
    if (!SECRET) { reply.code(503); return { error: 'Email ingestion is not configured (set MAIL_INGEST_SECRET).' }; }
    if (String((req.query || {}).key || '') !== SECRET) { reply.code(403); return { error: 'forbidden' }; }

    const b = req.body || {};
    const text = String(b.text || '') || htmlToText(b.html);
    if (!text) { reply.code(400); return { error: 'Empty message.' }; }

    // The FORWARDER must be a known account — otherwise anyone who learns the URL could
    // post addresses. Staff may forward on any seller's behalf.
    const fromAddr = (String(b.from || '').match(/[\w.+-]+@[\w.-]+/) || [''])[0].toLowerCase();
    if (!fromAddr) { reply.code(400); return { error: 'No sender address.' }; }
    const sender = (await q('select id, role from users where lower(email)=$1 limit 1', [fromAddr])).rows[0];
    if (!sender) { reply.code(403); return { error: `Forwarding address ${fromAddr} is not a registered account.` }; }

    const { orderId, address } = parseSaleEmail(text);
    if (!orderId) { reply.code(422); return { error: 'No Etsy order number found in that email.' }; }
    if (!address || !address.street) { reply.code(422); return { error: `Order ${orderId}: no shipping address found in that email.`, orderId }; }

    const id = 'etsy-' + orderId;
    const isStaff = sender.role && sender.role !== 'seller';
    const cur = isStaff
      ? (await q('select id, address from orders where id=$1', [id])).rows[0]
      : (await q('select id, address from orders where id=$1 and seller_id=$2', [id, sender.id])).rows[0];
    if (!cur) { reply.code(404); return { error: `Order ${orderId} isn't synced yet (or isn't yours).`, orderId }; }

    const existing = cur.address || {};
    if (existing.street || existing.first_line || existing.line1) {
      return { ok: true, orderId, skipped: 'already had an address' };
    }
    // Same shape check as the CSV path — refuse to print something malformed on a label.
    if (!/^[A-Z]{2}$/.test(address.state) || !/^\d{5}(-\d{4})?$/.test(address.zip) || !address.city) {
      reply.code(422); return { error: `Order ${orderId}: parsed address failed validation.`, orderId, parsed: address };
    }

    const cap = (v, n) => String(v || '').trim().slice(0, n) || null;
    const next = {
      ...existing,
      name: cap(address.name || existing.name, 120),
      street: cap(address.street, 120), street2: cap(address.street2, 120),
      city: cap(address.city, 80), state: address.state, zip: address.zip,
      country: existing.country || 'US',
      source: 'etsy-email',
    };
    const wSql = isStaff
      ? 'update orders set address=$1 where id=$2'
      : 'update orders set address=$1 where id=$2 and seller_id=$3';
    const wArgs = isStaff ? [JSON.stringify(next), id] : [JSON.stringify(next), id, sender.id];
    await q(wSql, wArgs);

    await q(`insert into audit_log (actor, actor_role, action, entity_type, entity_id, after)
             values ($1,$2,$3,$4,$5,$6)`,
      [fromAddr, sender.role || 'seller', 'etsy.address_from_email', 'order', id, JSON.stringify({ source: 'etsy-email' })])
      .catch(() => {});

    return { ok: true, orderId, filled: true };
  });
}

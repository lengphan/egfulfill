/**
 * ORDERS THAT ARRIVE FROM A BROWSER READER, NOT FROM A CONNECTION.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────
 *
 * The rule in CLAUDE.md §6 has been "the API is how an order arrives, and connecting is not
 * optional". That was reversed for SELLERS on 2026-09-17 (owner): a seller works through the
 * browser extension and does not connect a shop. Admin and factory accounts still connect
 * normally, and everything a connection does that a reader cannot — see the list below —
 * still only happens on that side.
 *
 * ── WHAT A READER CANNOT DO, STATED HERE BECAUSE IT IS EASY TO FORGET ────────────────
 *
 *   • TRACKING NEVER GOES BACK. etsyPushTracking() POSTs to the marketplace with the shop's
 *     OAuth token (etsy.js). An order created here has no token behind it, so the buyer is
 *     not notified by the marketplace and the seller enters the number there by hand. Orders
 *     from this route are stamped `meta.reader` so every surface can say so rather than
 *     leaving someone to discover it.
 *   • STATUS IS AS FRESH AS THE LAST READ. A cancellation or a refund on the marketplace is
 *     invisible until the seller opens the page again. Nothing here may ever be treated as
 *     "the marketplace agrees this is still live".
 *   • SKUs AND ARTWORK ARE BEST-EFFORT. A listing sku is not page text, and a customer's
 *     uploaded file is only present when the page ships it in its own JSON.
 *
 * ── THE RULE THAT SHAPES EVERY WRITE BELOW ───────────────────────────────────────────
 *
 * IT FILLS GAPS. IT NEVER OVERWRITES. CLAUDE.md §2.6: sync must not overwrite what it did
 * not author. A seller presses Sync repeatedly, on pages holding orders they have already
 * worked on, and a route that re-asserted the page's version of the truth would walk back a
 * hand-typed address, a corrected quantity, or a stage the floor had already advanced. So:
 * an order that exists is only ever ADDED TO — a blank address, a null promise date, a
 * missing total, a line set that is empty. Status and factory stage are never touched by
 * this file at all.
 *
 * ── ADDING A MARKETPLACE ─────────────────────────────────────────────────────────────
 *
 * This route is platform-generic; `PLATFORMS` below is the whole registry. Adding Walmart or
 * Amazon is an entry here plus a parser in extension/src/, NOT a second copy of this file.
 * A platform is listed only once a parser exists for it — an entry with nothing that can
 * produce rows is a promise the UI would make on our behalf and could not keep.
 */
import { q } from '../db.js';
import { isStaff, resolveSeller } from '../auth.js';
import { audit } from '../audit.js';

/**
 * THE REGISTRY. `order` is the id prefix the platform's own sync already uses — reusing it
 * is what makes a reader-made order and a synced order THE SAME ROW, so a seller who later
 * connects gets their history merged rather than doubled.
 */
const PLATFORMS = {
  etsy: { order: 'etsy-', label: 'Etsy' },
};

const digits = (v) => String(v == null ? '' : v).replace(/[^0-9]/g, '');
const cap = (v, n) => String(v == null ? '' : v).trim().slice(0, n) || null;

/** A money value we are willing to write. `null` means "the page didn't say", which is not
 *  zero — a total of 0 written over a real one is a refund that never happened. */
function amount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Does this address carry enough to print a label? The SAME test the address path already
 * applies (applyAddressRows in etsy.js), restated rather than imported because that one is
 * welded to its own loop — if the two ever disagree, this is the copy to delete.
 *
 * A half-read address is refused outright. §4 forbids rendering "we have nothing" and "the
 * marketplace is withholding it" the same way, and a street-less address written into the
 * column would read as the first while being neither.
 */
function usableAddress(a) {
  if (!a) return null;
  const street = cap(a.street, 120);
  const city = cap(a.city, 80);
  if (!street || !city) return null;
  const st = String(a.state || '').trim().toUpperCase();
  const zp = String(a.zip || '').trim();
  if (st && !/^[A-Z]{2}$/.test(st)) return null;
  if (zp && !/^\d{5}(-\d{4})?$/.test(zp)) return null;
  return {
    name: cap(a.name, 120),
    street, street2: cap(a.street2, 120),
    city, state: cap(st, 40), zip: cap(zp, 20),
    country: cap(a.country, 40) || 'US',
    source: 'extension',
  };
}

/**
 * A line the floor can act on.
 *
 * NAME IS REQUIRED AND QTY IS CLAMPED. A nameless line is a job nobody can pick, and the
 * quantity is the number of garments someone will make — a page that renders "Qty: 100" into
 * a parse error must not become a hundred hoodies. The ceiling is deliberately low enough to
 * be obviously wrong if it is ever hit and high enough that no real Etsy line reaches it.
 */
function cleanItem(it) {
  const name = cap(it && it.name, 200);
  const line_id = cap(it && it.line_id, 80);
  if (!name || !line_id) return null;
  if (!/^(et|sh|tt|rd)-/.test(line_id)) return null;
  const qty = Math.min(999, Math.max(1, Math.floor(Number(it.qty) || 1)));
  return {
    line_id, name, qty,
    sku: cap(it.sku, 120),
    variant: cap(it.variant, 300),
    personalization: cap(it.personalization, 2000),
    unit_price: amount(it.unit_price),
    /* Only an http(s) URL. A `data:` artwork URL would be megabytes of base64 in a column
       every order list selects, and a relative path resolves against OUR origin, not the
       marketplace's — both are how an image field becomes a payload. */
    img: /^https?:\/\//i.test(String(it.img || '')) ? cap(it.img, 1000) : null,
    design_src: /^https?:\/\//i.test(String(it.design_src || '')) ? cap(it.design_src, 1000) : null,
    /* The same method detection the Etsy sync performs, so a reader-made embroidery line
       reaches the boards with thread matching already on instead of defaulting to DTG. */
    print_type: /embroider|embroidered|embroidery|monogram/i
      .test(`${name} ${it.variant || ''}`) ? 'EMB' : null,
  };
}

/**
 * Apply a page's worth of receipts.
 *
 * Per receipt the outcomes are disjoint and all of them are reported, because "12 sent, 3
 * created" with no account of the other nine is exactly the silence that makes a seller
 * press the button again.
 */
async function applyReceipts(platform, rows, user, sellerId, factoryOwned, store) {
  const pfx = PLATFORMS[platform].order;
  const out = { created: 0, itemsAdded: 0, addressFilled: 0, existed: 0, skipped: 0, notYours: 0, rejected: [] };
  const staff = isStaff(user);

  for (const r of rows) {
    const rid = digits(r && r.order_id);
    if (!rid) { out.skipped++; continue; }
    const id = pfx + rid;

    const items = (Array.isArray(r.items) ? r.items : []).map(cleanItem).filter(Boolean);
    if (!items.length) {
      /* An order with no line is not an order — it is a row that shows up in every queue
         and can never be made. Refused with a reason rather than created empty. */
      out.rejected.push({ order_id: rid, why: 'no readable items' });
      out.skipped++; continue;
    }

    const addr = usableAddress(r.address);
    const total = amount(r.total);
    const shipBy = r.ship_by && !Number.isNaN(Date.parse(r.ship_by)) ? new Date(r.ship_by).toISOString() : null;

    const ex = await q('select id, seller_id, address, total, ship_by, factory_order from orders where id=$1', [id]);
    const cur = ex.rows[0];

    if (cur) {
      /* OWNERSHIP, on an order that already exists. A seller may only add to their own, and
         never to a factory order — a crafted receipt id is otherwise a way to write lines
         onto somebody else's parcel. */
      if (!staff && (cur.factory_order || String(cur.seller_id) !== String(sellerId))) {
        out.notYours++; continue;
      }
      const had = cur.address || {};
      const blank = !(had.street || had.first_line || had.line1);
      if (addr && blank) {
        await q('update orders set address=$1, updated_at=now() where id=$2', [JSON.stringify({ ...had, ...addr }), id]);
        out.addressFilled++;
      }
      /* coalesce, never assign — same discipline as the API sync. A page that did not print
         a total must not blank one we hold, and a promise date already recorded is a fact. */
      if (total != null && !Number(cur.total)) {
        await q('update orders set total=$1, updated_at=now() where id=$2', [total, id]);
      }
      if (shipBy && !cur.ship_by) {
        await q('update orders set ship_by=$1::timestamptz, updated_at=now() where id=$2', [shipBy, id]);
      }
      out.existed++;
    } else {
      await q(
        `insert into orders (id, seller_id, store, source, customer, address, status, factory_status,
                             total, created_at, factory_order, meta, ship_by)
         values ($1,$2,$3,$4,$5,$6,'new','new',$7, coalesce($8::timestamptz, now()), $9, $10, $11::timestamptz)
         on conflict (id) do nothing`,
        [id, sellerId, cap(store, 120), platform,
         { name: cap(r.buyer, 120), email: cap(r.buyer_email, 160) },
         addr || {}, total || 0,
         r.created_at && !Number.isNaN(Date.parse(r.created_at)) ? new Date(r.created_at).toISOString() : null,
         factoryOwned,
         /* STAMPED, and this is not bookkeeping. Tracking cannot go back to the marketplace
            for an order that arrived this way, and the stage the order is in never came from
            the marketplace either. Anything that needs to say so reads this. */
         { reader: 'extension', reader_platform: platform },
         shipBy]
      );
      out.created++;
      if (addr) out.addressFilled++;
    }

    /* LINES ARE ADDED, NEVER REPLACED. `on conflict do nothing` against the two partial
       unique indexes on (order_id, line_id) — so pressing Sync twice adds nothing the second
       time, and a line a human edited is never rewritten from the page. */
    for (const it of items) {
      const ins = await q(
        `insert into order_items (order_id, sku, name, qty, variant, unit_price, img, design_src,
                                  personalization, print_type, line_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict do nothing`,
        [id, it.sku, it.name, it.qty, it.variant, it.unit_price, it.img, it.design_src,
         it.personalization, it.print_type, it.line_id]
      );
      out.itemsAdded += ins.rowCount || 0;
    }
  }
  out.rejected = out.rejected.slice(0, 20);
  return out;
}

export function readerRoutes(app, requireAuth) {
  /** The platform in the URL, or a 400 that names what is supported. An unknown one must not
   *  fall through to a default — that is how a typo writes orders under the wrong prefix. */
  function platformOf(req, reply) {
    const p = String((req.params || {}).platform || '').toLowerCase();
    if (!PLATFORMS[p]) { reply.code(400); return null; }
    return p;
  }

  /**
   * WHICH OF THESE RECEIPTS DO WE ALREADY HAVE?
   *
   * The extension reads the page FIRST and asks about what is on it, rather than asking for
   * "everything you are missing" and filtering. Same reasoning as the address path: a list of
   * what we lack, unbounded, is a probe; a yes/no about receipts the seller is already
   * looking at discloses nothing they cannot see behind the popup.
   *
   * SELLER-SCOPED. A seller is answered about their own orders only, so this cannot be used
   * to find out whether some other shop's receipt is in the system.
   */
  app.post('/api/reader/:platform/known', { preHandler: requireAuth }, async (req, reply) => {
    const platform = platformOf(req, reply);
    if (!platform) return { error: 'Unknown marketplace', supported: Object.keys(PLATFORMS) };
    const asked = (Array.isArray((req.body || {}).receipts) ? req.body.receipts : [])
      .map(digits).filter(Boolean).slice(0, 300);
    if (!asked.length) return { known: [], blankAddress: [] };

    const sel = await resolveSeller(req.user, q);
    const staff = isStaff(req.user);
    const ids = asked.map((r) => PLATFORMS[platform].order + r);
    const rows = staff
      ? (await q('select id, address from orders where id = any($1::text[])', [ids])).rows
      : (await q('select id, address from orders where id = any($1::text[]) and seller_id=$2', [ids, sel.id])).rows;

    const strip = (x) => String(x).replace(PLATFORMS[platform].order, '');
    return {
      known: rows.map((r) => strip(r.id)),
      /* Reported separately so the popup can offer the one thing that is still worth doing on
         a page where every order already landed: filling the address Etsy withheld. */
      blankAddress: rows
        .filter((r) => { const a = r.address || {}; return !(a.street || a.first_line || a.line1); })
        .map((r) => strip(r.id)),
    };
  });

  /**
   * CREATE THE ORDERS THIS PAGE DESCRIBES.
   *
   * Bounded at 100 receipts per call — a Shop Manager page holds tens, and a body larger than
   * that is a client doing something this route was not built for.
   */
  app.post('/api/reader/:platform/import', { preHandler: requireAuth }, async (req, reply) => {
    const platform = platformOf(req, reply);
    if (!platform) return { error: 'Unknown marketplace', supported: Object.keys(PLATFORMS) };
    const rows = (Array.isArray((req.body || {}).rows) ? req.body.rows : []).slice(0, 100);
    if (!rows.length) { reply.code(400); return { error: 'No orders to import.' }; }

    const sel = await resolveSeller(req.user, q);
    /* WHOSE ORDER THIS IS, decided by the owner's role at the moment the row is written —
       the same rule as POST /api/orders. A staff account's own order is a factory order; a
       seller's (or a team member's, which resolves to the owner) is not. Getting this wrong
       puts the order on the wrong side of every money rule downstream. */
    const factoryOwned = isStaff(req.user);
    const store = cap((req.body || {}).store, 120) || PLATFORMS[platform].label;

    const res = await applyReceipts(platform, rows, req.user, sel.id, factoryOwned, store);
    audit(req, 'reader.import_orders', { entityType: 'order', after: { platform, ...res } });
    return { ok: true, platform, ...res };
  });

  /** What the extension is allowed to send. Read by the popup so a build that predates a new
   *  marketplace says "update the extension" instead of failing at the import. */
  app.get('/api/reader/platforms', { preHandler: requireAuth }, async () => ({
    platforms: Object.keys(PLATFORMS).map((k) => ({ key: k, label: PLATFORMS[k].label })),
  }));
}

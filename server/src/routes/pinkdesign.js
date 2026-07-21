// Design partner (Pink Design) — OUTSOURCED artwork for DTG/DTF.
// -----------------------------------------------------------------------------
// Our own designers are embroidery specialists, so DTG/DTF work goes out. This is a
// HUMAN design service with a review loop, not a print pipeline: we open a task, their
// designers work it, and a webhook returns finished files.
//
//   POST /create_task        {title, qty, board_id, product_type?, images[]}  -> {ref_id}
//   POST /{ref_id}/status    done | needfix | inreview
//   POST /{ref_id}/comment   {message, images[]}        (the revision conversation)
//   GET  /product_type_list  their keys (T_SHIRT, MUG…)
//   GET  /board_list         boards + fulfilment templates
//   webhooks on Inreview / Done / Check, carrying design files as URLs
//
// They accept artwork as URLs ONLY — no file upload — which is why object storage is a
// hard prerequisite rather than a nicety. A design still sitting as base64 in Postgres
// has no address to give them.
//
// Dormant until PINKDESIGN_API_KEY is set: every route answers honestly, nothing throws.
import { q } from '../db.js';
import { audit } from '../audit.js';
import { egBroadcast } from '../events.js';
import { recordCost } from '../costs.js';
import { readAll as readSettings } from './factory_settings.js';

// Read at CALL time so a key set from Settings › Integrations takes effect without a
// restart (see the same note in dispatch.js).
const apiKey = () => (process.env.PINKDESIGN_API_KEY || '').trim();
const apiBase = () => (process.env.PINKDESIGN_API_BASE || 'https://hub.pinkdesign.io/api').replace(/\/+$/, '');
const boardId = () => (process.env.PINKDESIGN_BOARD_ID || '').trim();
// The secret Pink Design sends WITH each webhook (their "API Key" field in Webhook
// settings). Separate from PINKDESIGN_API_KEY, which is what WE send THEM — one is our
// credential to their API, the other is theirs to ours, and conflating them means
// rotating one silently breaks the other.
const webhookSecret = () => (process.env.PINKDESIGN_WEBHOOK_SECRET || '').trim();

export function pinkEnabled() { return !!apiKey(); }

/**
 * Book what an outsourced design costs us — at APPROVAL, not at push.
 *
 * A task that gets pushed and then abandoned, rejected, or endlessly revised isn't work
 * we've accepted, and booking on create would put a cost against every one of those.
 * Approval is the moment we take the file and use it, so that's the moment it's owed.
 *
 * Idempotent on `design-<order>-<sku>`, which matters more here than usual: approval can
 * be reached two ways — their webhook reporting "done", or a human dragging the card —
 * and both call this. The ledger's (account,type,ref) unique index collapses them to one
 * charge no matter how many times, or how many routes, arrive at approved.
 */
export async function bookDesignCost({ orderId, sku, vendor }) {
  if (!vendor || !orderId) return { ok: false, skipped: true };
  const cfg = await readSettings().catch(() => ({}));
  return recordCost('design', Number(cfg.design_partner_cost ?? 0), `design-${orderId}-${sku}`,
    `Design partner task · order ${orderId} · ${sku}`, { orderId });
}

async function pink(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(apiBase() + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e.message };
  } finally { clearTimeout(timer); }
}

// No documented error codes, so retryability comes from HTTP semantics alone: 5xx/429/
// network are transient, a 4xx means they refused the request and resending won't change
// that. Same rule as the dispatch partner.
const isRetryable = (r) => r.status === 0 || r.status === 429 || r.status >= 500;

export function pinkDesignRoutes(app, requireAuth, requireStaff) {
  /**
   * Is the key live, and what can we send to? Doubles as the "verify my key" check and as
   * the source for the board / product-type pickers — hardcoding a board id would break
   * silently the day they rename one.
   */
  app.get('/api/pinkdesign/status', { preHandler: requireStaff }, async () => {
    if (!pinkEnabled()) {
      return { configured: false, error: 'PINKDESIGN_API_KEY not set (Settings › Integrations, or .env).' };
    }
    const [boards, types] = await Promise.all([pink('/board_list'), pink('/product_type_list')]);
    // A 401/403 here is the useful signal: the key exists but their side hasn't activated
    // API access for the account, which is a support request, not a code problem.
    if (!boards.ok && (boards.status === 401 || boards.status === 403)) {
      return {
        configured: true, ok: false, status: boards.status,
        error: 'Key rejected — the account may not be activated for API access yet. Pink Design enables that on request.',
        raw: typeof boards.data === 'string' ? boards.data.slice(0, 200) : boards.data,
      };
    }
    return {
      configured: true,
      ok: boards.ok,
      base: apiBase(),
      boardId: boardId() || null,
      boards: boards.ok ? boards.data : null,
      productTypes: types.ok ? types.data : null,
      error: boards.ok ? undefined : `board_list failed (${boards.status})`,
    };
  });

  /**
   * Send one line item out for design.
   *
   * The artwork has to be reachable by THEM, so this requires a stored URL — a design
   * still inline as base64 has no address. Rather than fail vaguely, say exactly that.
   */
  app.post('/api/pinkdesign/push', { preHandler: requireStaff }, async (req, reply) => {
    if (!pinkEnabled()) { reply.code(400); return { error: 'Design partner not configured (PINKDESIGN_API_KEY).' }; }
    const b = req.body || {};
    const orderId = String(b.orderId || '');
    const sku = b.sku != null ? String(b.sku) : null;
    if (!orderId || !sku) { reply.code(400); return { error: 'orderId and sku required' }; }
    // Board: explicit wins, else the configured one, else — when the account has exactly
    // ONE board — just use it. Making someone copy an id they have no choice about is a
    // config step that can only be got wrong.
    let board = String(b.boardId || boardId() || '');
    if (!board) {
      const bl = await pink('/board_list');
      const list = (bl.ok && (Array.isArray(bl.data) ? bl.data : bl.data?.data)) || [];
      if (list.length === 1) board = String(list[0].id ?? list[0].board_id ?? list[0]._id ?? '');
      else if (list.length > 1) {
        reply.code(400);
        return { error: 'Several boards exist — choose one (Settings › Integrations, PINKDESIGN_BOARD_ID).',
                 boards: list.map((x) => ({ id: x.id ?? x.board_id, name: x.name ?? x.title })) };
      }
    }
    if (!board) { reply.code(400); return { error: 'No board available from Pink Design — check /api/pinkdesign/status.' }; }

    const item = (await q(
      `select i.sku, i.name, i.qty, i.print_type, o.id as order_id
         from order_items i join orders o on o.id = i.order_id
        where i.order_id=$1 and i.sku=$2 limit 1`, [orderId, sku]
    )).rows[0];
    if (!item) { reply.code(404); return { error: 'Line item not found' }; }

    // The artwork URL. designUrlOf lives in orders.js, so read the row and resolve here —
    // storage_key present means it's in object storage and can be signed for them.
    const design = (await q(
      'select storage_key, data from order_designs where order_id=$1 and sku=$2 limit 1', [orderId, sku]
    )).rows[0];
    if (!design) { reply.code(400); return { error: 'No artwork on this line yet — nothing to send.' }; }
    const { presignGet, storageEnabled, designUrlTtlDays, publicUrl } = await import('../storage.js');
    if (!design.storage_key) {
      reply.code(400);
      return {
        error: storageEnabled()
          ? 'This artwork predates object storage, so it has no URL. Re-upload it on the order and push again.'
          : 'Object storage is not configured, so the artwork has no URL — and Pink Design accepts URLs only. Set SPACES_* first.',
      };
    }
    const imageUrl = designUrlTtlDays() > 0 ? presignGet(design.storage_key) : publicUrl(design.storage_key);

    const payload = {
      title: `${item.name || item.sku} · order ${orderId}`,
      qty: Number(item.qty) || 1,
      board_id: board,
      description: b.description || `Print method: ${item.print_type || 'DTG'}. Order ${orderId}, SKU ${item.sku}.`,
      images: [imageUrl],
      ...(b.productType ? { product_type: b.productType } : {}),
      ...(b.designType ? { design_type: b.designType } : {}),
    };
    const r = await pink('/create_task', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) {
      const msg = (r.data && (r.data.message || r.data.error)) || r.error || `create_task failed (${r.status})`;
      reply.code(502);
      // Their words verbatim — with no documented error codes this is the only diagnostic.
      return { error: msg, retryable: isRetryable(r) };
    }
    const refId = r.data && (r.data.ref_id ?? r.data.refId ?? r.data.id);

    // Track it as a design card marked OUTSOURCED, so it shows on the board with the
    // partner badge, can't be claimed by one of our designers, and never pays one.
    await q(
      `insert into design_cards (order_id, sku, title, col, type, product, vendor, vendor_ref, payment, pay_status)
       values ($1,$2,$3,'inprogress',$4,$5,'pinkdesign',$6,0,'na')
       on conflict do nothing`,
      [orderId, item.sku, payload.title, item.print_type || null, item.name || null, String(refId)]
    ).catch(() => {});

    audit(req, 'design.outsourced', { entityType: 'order', entityId: orderId, after: { sku, vendor: 'pinkdesign', ref: refId } });
    egBroadcast({ type: 'design-cards' });
    return { ok: true, refId, board };
  });

  /**
   * Send a card BACK for revision — our "needs fix" reaching their board.
   *
   * The review loop is the whole point of using a human design service, and without this
   * it only ran one way: they could return work, but a correction had to be relayed by
   * hand outside the system, where it isn't attached to the card, isn't audited, and is
   * invisible to whoever picks the job up next.
   *
   * The comment goes first. Their status flip is what surfaces the task to a designer, so
   * flipping before the note is attached can put the job in front of someone with nothing
   * telling them what to change — they'd have to guess or ask. If the comment fails we
   * stop and say so rather than moving a card nobody can action.
   */
  app.post('/api/pinkdesign/fix', { preHandler: requireStaff }, async (req, reply) => {
    if (!pinkEnabled()) { reply.code(400); return { error: 'Pink Design isn\'t connected — add PINKDESIGN_API_KEY first.' }; }
    const b = req.body || {};
    const message = String(b.message || '').trim();
    if (!message) { reply.code(400); return { error: 'Say what needs changing — a revision with no note is one they have to guess at.' }; }

    const card = (await q('select id, order_id, sku, vendor, vendor_ref, col from design_cards where id=$1 limit 1', [b.cardId])
      .catch(() => ({ rows: [] }))).rows[0];
    if (!card) { reply.code(404); return { error: 'Card not found.' }; }
    if (!card.vendor_ref) { reply.code(400); return { error: 'This card was never sent to a design partner, so there\'s nothing to send back.' }; }

    // Reference images are optional — a marked-up screenshot says more than a paragraph.
    // URLs only, same constraint as create_task.
    const images = (Array.isArray(b.images) ? b.images : []).map(String).filter((u) => /^https?:\/\//i.test(u));

    const said = await pink(`/${encodeURIComponent(card.vendor_ref)}/comment`, {
      method: 'POST', body: JSON.stringify({ message, images }),
    });
    if (!said.ok) {
      reply.code(502);
      return { error: `Couldn't attach the revision note (${said.status}) — card left where it is.`,
               raw: typeof said.data === 'string' ? said.data.slice(0, 300) : said.data };
    }
    const moved = await pink(`/${encodeURIComponent(card.vendor_ref)}/status`, {
      method: 'POST', body: JSON.stringify({ status: 'needfix' }),
    });
    if (!moved.ok) {
      reply.code(502);
      return { error: `Note delivered, but their board wouldn't accept the status change (${moved.status}). Their designer can see the comment; chase the status manually.`,
               commented: true };
    }

    await q(`update design_cards set col='fix', updated_at=now() where id=$1`, [card.id]).catch(() => {});
    audit(req, 'design.revision', { entityType: 'order', entityId: card.order_id,
      after: { sku: card.sku, ref: card.vendor_ref, message: message.slice(0, 500), images: images.length } });
    egBroadcast('design-cards', { id: card.id, col: 'fix' });
    return { ok: true, cardId: card.id, col: 'fix' };
  });

  /**
   * Their webhook. Fires on Inreview / Done / Check and carries the finished design files
   * as URLs. Public by necessity (they can't hold our JWT); the ref_id is the shared
   * secret-ish handle, and we only ever ACT on a ref we already created — an unknown ref
   * is acknowledged and ignored rather than trusted.
   */
  app.post('/api/webhooks/pinkdesign', async (req, reply) => {
    // Verify it's really them. They don't document WHERE the key travels, so accept the
    // three conventional places rather than guessing one and silently rejecting
    // everything. When no secret is configured we fall back to the ref-must-be-known
    // check below — permissive, but this endpoint can only ever advance a task we
    // ourselves created, so the blast radius is a wrong lane on an existing card.
    const want = webhookSecret();
    if (want) {
      const h = req.headers || {};
      const bearer = String(h.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const got = bearer || String(h['x-api-key'] || h['x-webhook-key'] || h['api-key'] || '').trim()
        || String((req.body || {}).api_key || (req.body || {}).apiKey || '').trim();
      if (got !== want) { reply.code(401); return { error: 'bad webhook key' }; }
    }
    const b = req.body || {};
    const ref = String(b.ref_id ?? b.refId ?? b.id ?? '');
    const status = String(b.status || '').toLowerCase();
    if (!ref) return { ok: true, ignored: 'no ref_id' };
    const card = (await q('select id, order_id, sku from design_cards where vendor_ref=$1 limit 1', [ref])
      .catch(() => ({ rows: [] }))).rows[0];
    if (!card) return { ok: true, ignored: 'unknown ref' };

    // Their review states → our board lanes. "Check"/"inreview" is work in progress on
    // their side; only "done" is finished.
    const col = status.includes('done') ? 'approved'
      : status.includes('fix') ? 'fix'
        : 'review';
    await q('update design_cards set col=$1, updated_at=now() where id=$2', [col, card.id]).catch(() => {});
    // "done" on their side is an approval on ours, so the cost falls due here too — not
    // only when a human drags the card. Idempotent, so whichever path lands first wins
    // and the other is a no-op.
    if (col === 'approved') await bookDesignCost({ orderId: card.order_id, sku: card.sku, vendor: 'pinkdesign' }).catch(() => {});

    // Deliverables arrive as URLs on THEIR servers. Storing the link alone would leave
    // our production files hostage to someone else's retention policy — a link that dies
    // when they tidy up old tasks, or when the account lapses, takes the print file with
    // it, and the floor may need that file weeks after the design was approved.
    //
    // So copy it into OUR storage and keep our own key. If the copy fails we still record
    // their URL: degraded, but a working link beats nothing, and it can be re-ingested.
    const files = Array.isArray(b.design_files) ? b.design_files
      : Array.isArray(b.designs) ? b.designs : [];
    const { storageEnabled, putObject, designUrlTtlDays } = await import('../storage.js');
    const { createHash } = await import('crypto');
    let copied = 0;
    for (const f of files) {
      const url = typeof f === 'string' ? f : (f && (f.url || f.file_url));
      if (!url) continue;
      let storageKey = null;
      if (storageEnabled()) {
        try {
          const dl = await fetch(url, { signal: AbortSignal.timeout(25000) });
          if (dl.ok) {
            const buf = Buffer.from(await dl.arrayBuffer());
            const mime = dl.headers.get('content-type') || 'application/octet-stream';
            const ext = (url.split('?')[0].match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
            // Content-hash key, same scheme as seller artwork: identical deliverables
            // collapse to one object instead of a copy per webhook retry.
            const hash = createHash('sha256').update(buf).digest('hex').slice(0, 32);
            storageKey = `partner-designs/${hash}${ext}`;
            await putObject(storageKey, buf, mime, designUrlTtlDays() > 0 ? 'private' : 'public-read');
            copied++;
          }
        } catch { storageKey = null; }   // fall through to storing their URL
      }
      await q(
        `insert into order_designs (order_id, sku, kind, data, storage_key, name, updated_at)
         values ($1,$2,'partner',$3,$4,$5, now())
         on conflict (order_id, sku, kind) do update set
           data=excluded.data, storage_key=excluded.storage_key, name=excluded.name, updated_at=now()`,
        [card.order_id, card.sku, storageKey ? null : url, storageKey, 'Pink Design deliverable']
      ).catch(() => {});
    }
    egBroadcast({ type: 'design-cards' });
    return { ok: true, card: card.id, col, files: files.length, copied };
  });
}

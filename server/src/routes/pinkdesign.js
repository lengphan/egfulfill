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

// Read at CALL time so a key set from Settings › Integrations takes effect without a
// restart (see the same note in dispatch.js).
const apiKey = () => (process.env.PINKDESIGN_API_KEY || '').trim();
const apiBase = () => (process.env.PINKDESIGN_API_BASE || 'https://hub.pinkdesign.io/api').replace(/\/+$/, '');
const boardId = () => (process.env.PINKDESIGN_BOARD_ID || '').trim();

export function pinkEnabled() { return !!apiKey(); }

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
   * Their webhook. Fires on Inreview / Done / Check and carries the finished design files
   * as URLs. Public by necessity (they can't hold our JWT); the ref_id is the shared
   * secret-ish handle, and we only ever ACT on a ref we already created — an unknown ref
   * is acknowledged and ignored rather than trusted.
   */
  app.post('/api/webhooks/pinkdesign', async (req) => {
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

    // Finished files come back as URLs. Store the reference against the order so the
    // floor can open what the partner produced.
    const files = Array.isArray(b.design_files) ? b.design_files
      : Array.isArray(b.designs) ? b.designs : [];
    for (const f of files) {
      const url = typeof f === 'string' ? f : (f && (f.url || f.file_url));
      if (!url) continue;
      await q(
        `insert into order_designs (order_id, sku, kind, data, name, updated_at)
         values ($1,$2,'partner',$3,$4, now())
         on conflict (order_id, sku, kind) do update set data=excluded.data, name=excluded.name, updated_at=now()`,
        [card.order_id, card.sku, url, 'Pink Design deliverable']
      ).catch(() => {});
    }
    egBroadcast({ type: 'design-cards' });
    return { ok: true, card: card.id, col, files: files.length };
  });
}

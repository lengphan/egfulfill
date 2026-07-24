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

// Who may send work to a partner. Everyone on the factory side EXCEPT designers: it
// spends money and gives away a job they would otherwise do themselves.
const canOutsource = (u) => !!u && ['admin', 'warehouse', 'operator'].includes(u.role);

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
export async function bookDesignCost({ orderId, sku, vendor, cardId }) {
  if (!vendor) return { ok: false, skipped: true };
  // Speculative work has no order but costs exactly the same, so it books against the
  // CARD instead. Skipping it would make order-less design look free in the P&L, which
  // is the one place a cost is most likely to go unnoticed.
  const ref = orderId ? `design-${orderId}-${sku}` : cardId ? `design-card-${cardId}` : null;
  if (!ref) return { ok: false, skipped: true };
  const cfg = await readSettings().catch(() => ({}));
  return recordCost('design', Number(cfg.design_partner_cost ?? 0), ref,
    orderId ? `Design partner task · order ${orderId} · ${sku}`
            : `Design partner task · card ${cardId} (no order)`,
    orderId ? { orderId } : {});
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


/**
 * Send one line item out for design. Returns a plain result — no reply object — because
 * two very different callers need it: the staff-initiated push route, and the automatic
 * routing that fires when a DTG/DTF line enters the design stage.
 *
 * The artwork has to be reachable by THEM, so this requires a stored URL — a design still
 * inline as base64 has no address. Rather than fail vaguely, it says exactly that.
 */
export async function pushToPink({ orderId, sku, cardId, imageUrl: directImage,
                                   boardId: wantBoard, description, productType, designType,
                                   title: wantTitle, qty: wantQty, extraImages }) {
  if (!pinkEnabled()) return { error: 'Design partner not configured (PINKDESIGN_API_KEY).', status: 400 };
  const oid = String(orderId || '');
  const isku = sku != null ? String(sku) : null;
  // Three ways in, because not every design belongs to an order: a line item, an existing
  // board card, or a bare image URL for speculative work (a mockup for a listing that
  // doesn't exist yet). Only one of them is required.
  if (!oid && !cardId && !directImage) {
    return { error: 'Nothing to send — give a line item, a board card, or an image.', status: 400 };
  }
  if (oid && !isku) return { error: 'sku required when sending a line item', status: 400 };

  // Board: explicit wins, else the configured one, else — when the account has exactly
  // ONE board — just use it. Making someone copy an id they have no choice about is a
  // config step that can only be got wrong.
  let board = String(wantBoard || boardId() || '');
  if (!board) {
    const bl = await pink('/board_list');
    const list = (bl.ok && (Array.isArray(bl.data) ? bl.data : bl.data?.data)) || [];
    if (list.length === 1) board = String(list[0].id ?? list[0].board_id ?? list[0]._id ?? '');
    else if (list.length > 1) {
      return { error: 'Several boards exist — choose one (Settings › Integrations, PINKDESIGN_BOARD_ID).', status: 400,
               boards: list.map((x) => ({ id: x.id ?? x.board_id, name: x.name ?? x.title })) };
    }
  }
  if (!board) return { error: 'No board available from Pink Design — check /api/pinkdesign/status.', status: 400 };

  const { presignGet, storageEnabled, designUrlTtlDays, publicUrl } = await import('../storage.js');
  const urlFor = (key) => (designUrlTtlDays() > 0 ? presignGet(key) : publicUrl(key));

  // Resolve the subject: what we're sending, and what to call it. Most specific source
  // first, so an explicit image always wins over anything inferred.
  let item = null;          // the line, when there is one
  let card = null;          // the existing board card, when there is one
  let imageUrl = null;

  if (cardId) {
    card = (await q('select id, order_id, sku, title, type, thumb, vendor, art_key, art_data from design_cards where id=$1::bigint limit 1',
      [String(cardId)])).rows[0] || null;
    if (!card) return { error: 'Card not found', status: 404 };
    if (card.vendor) return { error: `This card is already with ${card.vendor}.`, status: 400 };
  }

  const useOrder = oid || (card && card.order_id);
  const useSku = isku ?? (card ? card.sku : null);

  if (useOrder && useSku) {
    item = (await q(
      `select i.sku, i.name, i.qty, i.print_type, o.id as order_id
         from order_items i join orders o on o.id = i.order_id
        where i.order_id=$1 and i.sku=$2 limit 1`, [String(useOrder), String(useSku)]
    )).rows[0] || null;
    if (!item && oid) return { error: 'Line item not found', status: 404 };
    const design = (await q(
      'select storage_key, data from order_designs where order_id=$1 and sku=$2 limit 1',
      [String(useOrder), String(useSku)]
    )).rows[0];
    if (design && design.storage_key) imageUrl = urlFor(design.storage_key);
  }

  // An explicit image beats everything — it's what someone just picked. Then a card's own
  // thumb, but ONLY when it's a real URL: a base64 thumb has no address to give them.
  if (directImage && /^https?:\/\//i.test(String(directImage))) imageUrl = String(directImage);
  else if (!imageUrl && card && /^https?:\/\//i.test(String(card.thumb || ''))) imageUrl = String(card.thumb);
  // A MANUAL card's OWN dropped artwork lives in object storage under art_key (thumb is null
  // for it), so resolve THAT to a URL. Without this, a reference attachment wrongly became
  // the artwork and the design the user actually dropped never went out — the exact "my
  // image got replaced by an attachment" bug.
  if (!imageUrl && card && card.art_key) imageUrl = urlFor(card.art_key);

  // Reference material beyond the artwork itself — a mockup, a spec sheet, a marked-up
  // screenshot of what's wrong. URLs only, same constraint as the artwork, and the
  // artwork always leads so their designer opens the file being worked on first.
  const extras = (Array.isArray(extraImages) ? extraImages : [])
    .map(String).filter((u) => /^https?:\/\//i.test(u));

  // No stored artwork, but an image was attached here — promote the FIRST one to be the
  // artwork. An attachment uploaded through this dialog lands in object storage with a real
  // URL, which is the one thing that was missing; without this, "attach an image and push
  // again" was a dead end because the attachment only ever went to the reference list.
  if (!imageUrl && extras.length) imageUrl = extras.shift();

  if (!imageUrl) {
    return { status: 400, error: !storageEnabled()
      ? 'Object storage is not configured, so the artwork has no URL — and Pink Design accepts URLs only. Set SPACES_* first.'
      : useOrder
        ? 'No stored artwork on this line, so there is no URL to send. Upload it on the order, or attach an image here, and push again.'
        : 'This design has no stored image, so there is no URL to send. Attach an image below and push again.' };
  }

  // Fall back through what we actually know. A speculative design has no line and no
  // order, so the defaults have to degrade to something a human still recognises on
  // their board rather than "undefined · order ".
  const subject = item?.name || item?.sku || card?.title || 'Design';
  const method = item?.print_type || card?.type || null;
  const where = useOrder ? ` · order ${useOrder}` : '';

  const payload = {
    title: String(wantTitle || '').trim() || `${subject}${where}`,
    qty: Math.max(1, parseInt(wantQty, 10) || Number(item?.qty) || 1),
    board_id: board,
    description: description || [
      method ? `Print method: ${method}.` : null,
      useOrder ? `Order ${useOrder}${useSku ? `, SKU ${useSku}` : ''}.` : 'Not tied to an order.',
    ].filter(Boolean).join(' '),
    images: [imageUrl, ...extras],
    ...(productType ? { product_type: productType } : {}),
    ...(designType ? { design_type: designType } : {}),
  };
  const r = await pink('/create_task', { method: 'POST', body: JSON.stringify(payload) });
  console.log('[pinkdesign create_task] status', r.status, '· response', JSON.stringify(r.data).slice(0, 600));
  if (!r.ok) {
    const msg = (r.data && (r.data.message || r.data.error)) || r.error || `create_task failed (${r.status})`;
    // Their words verbatim — with no documented error codes this is the only diagnostic.
    return { error: msg, status: 502, retryable: isRetryable(r) };
  }
  // Pink ENVELOPES responses under `data` (same shape as their webhook), so the task id may
  // sit at r.data.ref_id OR r.data.data.ref_id, under ref_id / task_id / id. Capture whichever
  // — this becomes our vendor_ref, and the webhook later matches a card on it, so getting it
  // wrong silently breaks the ENTIRE status/file sync. Logged so a bad shape is visible, and
  // stored as NULL (not the string "null") when truly absent.
  const rd = (r.data && typeof r.data === 'object') ? r.data : {};
  const inner = (rd.data && typeof rd.data === 'object') ? rd.data : rd;
  const norm = (v) => (v != null && String(v).trim() ? String(v).trim() : null);
  // "Ref ID" is the value Pink says is "sent to you when pushed" — our PRIMARY match key.
  // "Task ID" is their internal id; capture it too so the board can show BOTH, because their
  // test-webhook form asks for each. Fall back to a bare `id` for the ref when that's all
  // they return.
  const vendorRef = norm(inner.ref_id ?? rd.ref_id ?? inner.id ?? rd.id ?? inner.task_id ?? rd.task_id);
  const vendorTaskId = norm(inner.task_id ?? rd.task_id);
  console.log('[pinkdesign create_task] captured ref_id =', vendorRef, '· task_id =', vendorTaskId);

  // API-created tasks always land in Pink's "Draft" lane, and that is FINAL on their side:
  // they've confirmed there is no way to create or move a task straight into "New", and no
  // delete/cancel endpoint either — both are done by hand on their own site. So we make no
  // status call here; Draft is simply where a pushed task starts. (Don't re-add a "nudge to
  // New" — it was tried, and Pink says it will never be honoured.)

  // Track it as a design card marked OUTSOURCED, so it shows on the board with the
  // partner badge, can't be claimed by one of our designers, and never pays one.
  //
  // An EXISTING card is updated rather than duplicated — dragging a card to the partner
  // lane must not leave the original sitting in Incoming looking like unclaimed work.
  // The EXACT images we handed Pink, stored on the card so the board can show a "this is
  // what we sent" preview — otherwise there's no way to tell which files already went.
  const sentImages = JSON.stringify(payload.images);
  let cardOut = card ? String(card.id) : null;
  if (card) {
    await q(`update design_cards set vendor='pinkdesign', vendor_ref=$2, vendor_task_id=$5, col='inprogress',
                    title=$6, thumb=coalesce(thumb,$3), pushed_images=$4::jsonb, updated_at=now() where id=$1::bigint`,
      [String(card.id), vendorRef, imageUrl, sentImages, vendorTaskId, payload.title]).catch(() => {});
  } else {
    const ins = await q(
      `insert into design_cards (order_id, sku, title, col, type, product, thumb, vendor, vendor_ref, payment, pay_status, pushed_images, vendor_task_id)
       values ($1,$2,$3,'inprogress',$4,$5,$6,'pinkdesign',$7,0,'na',$8::jsonb,$9)
       returning id`,
      [useOrder || null, useSku || null, payload.title, method, item?.name || null, imageUrl, vendorRef, sentImages, vendorTaskId]
    ).catch(() => ({ rows: [] }));
    cardOut = ins.rows[0] ? String(ins.rows[0].id) : null;
  }

  return {
    ok: true, refId: vendorRef, board, cardId: cardOut, orderId: useOrder || null,
    // If Pink returned no id we can recognise, the task WAS created on their side but we
    // can't tie their status webhook back to this card — say so rather than implying it's
    // fully wired. The create_task log above shows what they actually returned.
    ...(vendorRef ? {} : { warning: 'Pink accepted the task but returned no reference we recognised, so automatic status/file sync is off for it. Check the create_task log for their response shape.' }),
  };
}

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

  app.post('/api/pinkdesign/push', { preHandler: requireStaff }, async (req, reply) => {
    // Designers are staff, but sending work OUT is not theirs to decide — it spends money
    // and it hands away a job they'd otherwise do. Same boundary the board draws by
    // refusing to let a designer claim a vendor card.
    if (!canOutsource(req.user)) {
      reply.code(403);
      return { error: 'Only admin, warehouse or an operator can send work to a design partner.' };
    }
    const out = await pushToPink(req.body || {});
    if (out.error) { reply.code(out.status || 400); return out; }
    audit(req, 'design.outsourced', {
      entityType: out.orderId ? 'order' : 'design_card',
      entityId: String(out.orderId || out.cardId || ''),
      after: { sku: (req.body || {}).sku || null, vendor: 'pinkdesign', ref: out.refId, cardId: out.cardId },
    });
    egBroadcast({ type: 'design-cards' });
    return out;
  });

  /**
   * Park an extra reference file in our storage and hand back a URL.
   *
   * Pink Design accepts URLs only, so anything dragged into the push window — a mockup, a
   * spec sheet, a marked-up screenshot — needs an address before it can be sent. Kept
   * separate from order_designs on purpose: these are notes FOR the designer, not the
   * artwork being printed, and mixing them would put a screenshot in the production file
   * list where someone could print it.
   */
  app.post('/api/pinkdesign/attachment', { preHandler: requireStaff }, async (req, reply) => {
    const b = req.body || {};
    const { storageEnabled, putObject, fromDataUrl, presignGet, publicUrl, designUrlTtlDays } = await import('../storage.js');
    if (!storageEnabled()) { reply.code(400); return { error: 'Object storage isn\'t configured, so there\'s nowhere to put the file.' }; }
    const parsed = fromDataUrl(b.data);
    if (!parsed) { reply.code(400); return { error: 'Couldn\'t read that file.' }; }
    const { createHash } = await import('crypto');
    // Content hash, like every other object here: re-dragging the same file collapses to
    // one object rather than a copy per attempt.
    const hash = createHash('sha256').update(parsed.buffer).digest('hex').slice(0, 32);
    const ext = (String(b.name || '').match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
    const key = `partner-refs/${hash}${ext}`;
    try {
      await putObject(key, parsed.buffer, parsed.mime, designUrlTtlDays() > 0 ? 'private' : 'public-read');
    } catch (e) {
      reply.code(502); return { error: `Couldn't store the file: ${e.message}` };
    }
    return { ok: true, url: designUrlTtlDays() > 0 ? presignGet(key) : publicUrl(key), key, name: b.name || null };
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
    const raw = req.body || {};
    // DIAGNOSTIC — log EVERY hit before anything can reject it, so `docker compose logs api`
    // shows whether Pink calls us, their real payload shape, and whether auth/ref matched.
    try {
      const safe = { ...raw }; delete safe.api_key; delete safe.apiKey;
      console.log('[pinkdesign webhook] incoming', JSON.stringify(safe).slice(0, 3000));
    } catch { /* ignore log failure */ }

    // Pink NESTS the real payload under `data` — confirmed from their Webhook Push History:
    //   {"data":{"description":"…","design_files":null,"designs":"https://drive.google.com/…"}}
    // Reading top-level was why every call came back {"ok":true,"ignored":"no ref_id"}: a 200
    // Pink logs as delivered, but a silent no-op for us. Unwrap `data` when present, and fall
    // back to top-level for any other shape.
    const b = (raw && typeof raw.data === 'object' && raw.data) ? raw.data : raw;

    // Verify it's really them. Their API key travels in the request HEADER (per their webhook
    // settings), with body fallbacks on either the wrapper or the unwrapped data.
    const want = webhookSecret();
    if (want) {
      const h = req.headers || {};
      const bearer = String(h.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const got = bearer || String(h['x-api-key'] || h['x-webhook-key'] || h['api-key'] || '').trim()
        || String(raw.api_key || raw.apiKey || b.api_key || b.apiKey || '').trim();
      if (got !== want) { console.log('[pinkdesign webhook] REJECTED — bad/absent key'); reply.code(401); return { error: 'bad webhook key' }; }
    }
    // From Pink's real payload: they send BOTH ref_id (what create_task returned, = our
    // vendor_ref) and task_id (their internal id) — match on EITHER, since which one they
    // handed back at create time isn't guaranteed. And STATUS lives in `task_status`, echoed
    // in `event` ("idea.done" / "idea.inreview" / …) — NOT `status`, which is absent.
    const refs = [b.ref_id, b.refId, b.task_id, b.taskId, b.id, b.reference, b.ref]
      .map((v) => (v == null ? '' : String(v))).filter(Boolean);
    const status = String(b.task_status ?? b.status ?? b.state ?? b.stage ?? b.event ?? '').toLowerCase();
    if (!refs.length) { console.log('[pinkdesign webhook] no ref found — payload keys:', Object.keys(b).join(',')); return { ok: true, ignored: 'no ref_id' }; }
    const card = (await q('select id, order_id, sku from design_cards where vendor_ref = any($1::text[]) or vendor_task_id = any($1::text[]) limit 1', [refs])
      .catch(() => ({ rows: [] }))).rows[0];
    if (!card) { console.log('[pinkdesign webhook] refs', refs.join('/'), 'matched NO card (vendor_ref mismatch)'); return { ok: true, ignored: 'unknown ref' }; }
    console.log('[pinkdesign webhook] matched card', card.id, '· status:', status || '(none)');

    // Backfill Pink's INTERNAL task_id the moment a webhook carries it — create_task returns
    // only the ref_id, so this is the first time we ever see it, and it lets the card finally
    // show both ids. Skip when it equals the ref_id (e.g. a test that put the same value in
    // both form fields), so a test can't stamp the ref as the task id. coalesce = never
    // overwrite a real one already captured.
    const nz = (v) => (v != null && String(v).trim() ? String(v).trim() : null);
    const whTaskId = nz(b.task_id ?? b.taskId);
    const whRefId = nz(b.ref_id ?? b.refId);
    if (whTaskId && whTaskId !== whRefId) {
      await q('update design_cards set vendor_task_id = coalesce(vendor_task_id, $2) where id=$1', [card.id, whTaskId]).catch(() => {});
    }

    // Pink's status NEVER auto-approves on OUR side. Even a "done" from them means the design
    // is DELIVERED and ready for US to review — a human here checks it, THEN approves, and
    // that manual approval is what books the partner cost (design_cards.js on the approved
    // transition) and runs our credit flow. So ANY delivery lands in our "review" lane; only
    // a "needfix" is distinct. We book nothing here.
    const col = status.includes('fix') ? 'fix' : 'review';
    await q('update design_cards set col=$1, updated_at=now() where id=$2', [col, card.id]).catch(() => {});

    // Deliverables arrive as URLs on THEIR servers. Storing the link alone would leave
    // our production files hostage to someone else's retention policy — a link that dies
    // when they tidy up old tasks, or when the account lapses, takes the print file with
    // it, and the floor may need that file weeks after the design was approved.
    //
    // So copy it into OUR storage and keep our own key. If the copy fails we still record
    // their URL: degraded, but a working link beats nothing, and it can be re-ingested.
    // Gather deliverables from ANY plausible field — they attach both "Design Files" and
    // "Design URLs" (e.g. a Google Drive folder), and the exact JSON key is undocumented.
    // Each entry may be a bare URL string or an object carrying the url under one of several
    // names. Dedup, keep only real http(s) URLs. A folder link that can't be downloaded is
    // still stored as a link below, so it isn't lost.
    const fileFields = ['design_files', 'designs', 'design_urls', 'designUrls', 'attachments',
                        'files', 'links', 'urls', 'deliverables', 'design_link', 'file_url', 'download_url'];
    const collected = [];
    for (const k of fileFields) {
      const v = b[k];
      if (Array.isArray(v)) collected.push(...v);
      else if (v) collected.push(v);
    }
    const files = [...new Set(collected
      .map((f) => (typeof f === 'string' ? f : (f && (f.url || f.file_url || f.link || f.href || f.src || f.download_url))))
      .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)))];
    console.log('[pinkdesign webhook] deliverables found:', files.length, files.slice(0, 5));
    // Keep the returned links ON THE CARD so the board can show "Received from <partner>".
    // The storage copy below only lands in order_designs, and only for an ORDER-attached card
    // — without this a speculative card's returned link (often a Drive folder we can't copy)
    // had nowhere to show. Overwrites with the latest set each webhook.
    if (files.length) {
      await q('update design_cards set vendor_files = $2::jsonb, updated_at=now() where id=$1', [card.id, JSON.stringify(files)]).catch(() => {});
    }
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
         on conflict (order_id, (coalesce('L:' || line_id, 'S:' || sku)), kind) do update set
           data=excluded.data, storage_key=excluded.storage_key, name=excluded.name, updated_at=now()`,
        [card.order_id, card.sku, storageKey ? null : url, storageKey, 'Pink Design deliverable']
      ).catch(() => {});
    }
    egBroadcast({ type: 'design-cards' });
    return { ok: true, card: card.id, col, files: files.length, copied };
  });
}

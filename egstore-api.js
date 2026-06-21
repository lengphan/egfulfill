/* ============================================================================
   egstore-api.js — talks to YOUR self-hosted backend (server/) instead of
   Supabase. Two jobs:
     1) window.EGAuth — signup/login/logout against /api/auth (JWT in localStorage)
     2) Orders sync   — hydrate localStorage['egfulfill_orders'] from /api/orders,
        and push EGStore.add/update through to the API (optimistic).
   localStorage stays the cache (so the pages stay synchronous + unchanged).

   API base: '' = same origin. In production Caddy serves the site AND proxies
   /api on the same domain, so relative calls just work. For local testing
   against the VPS, set API_BASE to e.g. 'http://YOUR_VPS_IP:3000'.
   ============================================================================ */
(function () {
  'use strict';
  var API_BASE = '';                       // same-origin in production
  var TOKEN_KEY = 'eg_token', USER_KEY = 'eg_user';

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
  // Auth keys are tiny and MUST always persist. The big regenerable caches (order
  // cache, design/image blobs, label blobs, templates) can blow past the ~5MB
  // localStorage quota and make even setItem('eg_token', …) throw — which would
  // block login. So prune those caches and retry before giving up.
  // egfulfill_orders is ESSENTIAL — never evict the seller's orders to free space
  // (doing so was literally deleting orders when design-image bloat filled the quota).
  var _ESSENTIAL = { eg_token: 1, eg_user: 1, eg_ship_origin: 1, egfulfill_orders: 1, eg_pending_patches: 1 };
  function _pruneStorage(aggressive) {
    // Disposable, regenerable caches (design galleries, image/raw blobs, templates,
    // label blobs) — drop these FIRST so essential data survives. NOT egfulfill_orders.
    var bigPrefixes = ['eg_design_uploads', 'eg_image_cache', 'eg_design_raw', 'eg_thumb', 'eg_shipments', 'eg_templates', 'eg_design', 'eg_img', 'eg_raw', 'eg_cache', 'eg_order_designs'];
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var key = localStorage.key(i);
      if (!key || _ESSENTIAL[key]) continue;
      if (aggressive || bigPrefixes.some(function (p) { return key.indexOf(p) === 0; })) {
        try { localStorage.removeItem(key); } catch (e) {}
      }
    }
  }
  function _safeSet(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) {
      try { _pruneStorage(false); localStorage.setItem(k, v); return true; }   // drop big caches
      catch (e2) {
        try { _pruneStorage(true); localStorage.setItem(k, v); return true; }  // last resort: clear all non-auth
        catch (e3) { console.warn('[egstore-api] could not persist ' + k + ':', e3.message); return false; }
      }
    }
  }
  function _identity(u) { return String((u && (u.id || u.sub || u.email)) || ''); }
  function setSession(d) {
    // Account switch hygiene: if a DIFFERENT account signs in on this browser, purge
    // the previous account's local order/thread caches. Otherwise the new (e.g. just-
    // registered) seller would inherit the old account's orders — and per-seller
    // numbering wouldn't restart at #1. Same account re-login keeps everything.
    if (d && d.user) {
      try {
        var prev = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
        if (prev && _identity(prev) && _identity(prev) !== _identity(d.user)) {
          ['egfulfill_orders', 'eg_pending_patches', 'eg_thread_match', 'eg_thread_colors', 'eg_order_seq']
            .forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        }
      } catch (e) {}
    }
    if (d && d.token) _safeSet(TOKEN_KEY, d.token);
    if (d && d.user)  _safeSet(USER_KEY, JSON.stringify(d.user));
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    var bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
    // keepalive lets a write (POST/PATCH) finish even if the user navigates away
    // immediately after (e.g. create order → click Design Lab). Capped at 64KB by
    // the browser, so only enable it for small bodies.
    var ka = !!(opts.method && opts.method !== 'GET' && bodyStr && bodyStr.length < 60000);
    return fetch(API_BASE + '/api' + path, {
      method: opts.method || 'GET', headers: headers,
      body: bodyStr, keepalive: ka
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        return r.ok ? { data: data, error: null }
                    : { data: null, error: { message: data.error || ('HTTP ' + r.status) } };
      });
    }).catch(function (e) { return { data: null, error: { message: e.message } }; });
  }

  // ── EGAuth (same interface the login pages already call) ──────────────────
  window.EGAuth = {
    DASHBOARDS: { seller: 'seller.html', operator: 'operator.html', warehouse: 'warehouse.html', admin: 'admin.html', designer: 'designer.html' },
    dashboardFor: function (role) { return this.DASHBOARDS[role] || 'seller.html'; },
    signUp: function (email, password, opts) {
      opts = opts || {};
      return api('/auth/signup', { method: 'POST', body: { email: email, password: password, role: opts.role || 'seller', name: opts.name || '', store_name: opts.store_name || '' } })
        .then(function (r) { if (r.data) setSession(r.data); return { data: r.data ? { user: r.data.user, session: { access_token: r.data.token } } : null, error: r.error }; });
    },
    signIn: function (email, password) {
      return api('/auth/login', { method: 'POST', body: { email: email, password: password } })
        .then(function (r) { if (r.data) setSession(r.data); return { data: r.data ? { user: r.data.user } : null, error: r.error }; });
    },
    // Exchange a Google ID token (credential) for an app session.
    googleSignIn: function (credential) {
      return api('/auth/google', { method: 'POST', body: { credential: credential } })
        .then(function (r) { if (r.data) setSession(r.data); return { data: r.data ? { user: r.data.user } : null, error: r.error }; });
    },
    signOut: function () { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); return Promise.resolve(); },
    getUser: function () { try { return Promise.resolve(JSON.parse(localStorage.getItem(USER_KEY) || 'null')); } catch (e) { return Promise.resolve(null); } },
    getRole: function () { return this.getUser().then(function (u) { return (u && u.role) || null; }); },
    routeAfterLogin: function () { var self = this; return this.getRole().then(function (role) { window.location.href = self.dashboardFor(role); }); },
    requireLogin: function (loginUrl) { var ok = !!token(); if (!ok && loginUrl) window.location.href = loginUrl; return Promise.resolve(ok); }
  };

  // ── Orders sync (only on pages that load EGStore, only when signed in) ────
  if (typeof window.EGStore === 'undefined') return;   // login pages: auth only
  var KEY = 'egfulfill_orders';

  function dbToItem(it) {
    return { sku: it.sku, name: it.name, listing: it.listing, printType: it.print_type, tech: it.print_type,
             qty: it.qty, color: it.color, size: it.size, variant: it.variant, blank: it.blank,
             unitPrice: Number(it.unit_price) || 0, designSrc: it.design_src, designUrl: it.design_src,
             // customerFile = the buyer's marketplace upload (e.g. Etsy "Upload Your
             // Logo") — a real URL. Kept separate from designSrc (which the seller UI
             // treats as a 'design-lab'/'template' enum) so the two never collide.
             customerFile: /^https?:\/\//i.test(String(it.design_src || '')) ? it.design_src : null,
             personalization: it.personalization, img: it.img, designPos: it.design_pos, lineId: it.line_id };
  }
  function dbToOrder(r) {
    return { id: r.id, seq: r.seq != null ? Number(r.seq) : null, meta: r.meta || {}, store: r.store, seller: r.store, source: r.source,
             customer: r.customer || {}, address: r.address || {},
             status: r.status, factoryStatus: r.factory_status, factoryOrder: r.factory_order === true,
             total: Number(r.total) || 0, profit: Number(r.profit) || 0,
             delivery: r.delivery, carrier: r.carrier, service: r.service, tracking: r.tracking,
             timeline: r.timeline || [], notes: r.notes || [], gates: r.gates || {},
             createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
             submittedAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
             items: (r.items || []).map(dbToItem), _live: true };
  }
  function writeCache(orders) {
    // MERGE, don't blindly overwrite. A hydrate() replaces the cache with the
    // server's orders — but a just-created local order whose POST is still in
    // flight (or was aborted by a fast navigation to Design Lab) isn't on the
    // server yet, so a naive overwrite would wipe it. Preserve local-only orders
    // created in the last 5 min until the server confirms them.
    var incoming = orders || [];
    try {
      var ids = {};
      incoming.forEach(function (o) { if (o && o.id != null) ids[o.id] = true; });
      var local = [];
      try { local = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { local = []; }
      var now = Date.now(), FRESH = 5 * 60 * 1000;
      var keep = local.filter(function (o) {
        if (!o || o.id == null || ids[o.id]) return false;            // server already has it
        if (o._pendingSync) return true;                              // un-synced — NEVER drop until the server confirms it
        var ts = o.submittedAt || o.createdAt || 0;
        return ts && (now - ts) < FRESH;                              // freshly created, sync still plausibly in flight
      });
      // The server intentionally doesn't store the per-item product/listing IMAGE
      // (a multi-MB upload would bloat the orders payload + slow every load). So a
      // naive overwrite drops item.img and the row falls back to a blank tee. Carry
      // the locally-held item.img onto the matching server item so it survives hydrate.
      var localById = {};
      local.forEach(function (o) { if (o && o.id != null) localById[o.id] = o; });
      incoming.forEach(function (o) {
        var lo = localById[o.id];
        if (!lo || !Array.isArray(o.items) || !Array.isArray(lo.items)) return;
        o.items.forEach(function (it) {
          if (!it || (it.img != null && it.img !== '')) return;
          var m = lo.items.find(function (x) { return x && x.sku === it.sku && x.img; });
          if (m && m.img) it.img = m.img;
        });
      });
      localStorage.setItem(KEY, JSON.stringify(incoming.concat(keep)));
    } catch (e) {
      try { localStorage.setItem(KEY, JSON.stringify(incoming)); } catch (_) {}
    }
    try { window.dispatchEvent(new Event('eg-orders-changed')); } catch (e) {}
    try { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); } catch (e) {}
  }
  // ── Durable order sync ────────────────────────────────────────────────────
  // A manual seller order is written to localStorage first, then POSTed. If that
  // POST fails (API restarting during a deploy, network blip, …) the order would
  // be local-only and the next hydrate's writeCache would eventually drop it —
  // silent data loss. So we MARK every order as _pendingSync on POST and only
  // CLEAR the flag once the server confirms it. writeCache keeps any flagged
  // order forever (see above), and retrySync() re-POSTs them on every poll until
  // they land. Result: a seller never loses an order they created.
  function markPending(id, val) {
    try {
      var list = JSON.parse(localStorage.getItem(KEY) || '[]') || [];
      var changed = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) {
          if (val) list[i]._pendingSync = val; else delete list[i]._pendingSync;
          changed = true; break;
        }
      }
      if (changed) localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {}
  }
  function pushOrder(order) {
    if (!order || order.id == null) return Promise.resolve();
    markPending(order.id, Date.now());                                // protect it until the server confirms
    return api('/orders', { method: 'POST', body: leanOrder(order) }).then(function (r) {
      if (r && !r.error) markPending(order.id, null);                 // confirmed server-side → safe to drop locally
      return r;                                                       // on error: leave flag set; retrySync() retries
    });
  }
  function retrySync() {
    if (!token()) return;
    var list;
    try { list = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { return; }
    list.forEach(function (o) {
      // Only re-push our own (non-Etsy) orders still awaiting confirmation.
      if (o && o.id != null && o._pendingSync && String(o.id).indexOf('etsy-') !== 0) pushOrder(o);
    });
  }
  // Durable status/tracking/timeline PATCH. Same problem as create: a fire-and-
  // forget PATCH lost during an API restart silently drops the update. So we
  // ACCUMULATE pending patches per order in localStorage (later fields override
  // earlier — patches set absolute values, so re-sending is idempotent), attempt
  // the PATCH, and clear only the fields the server confirmed. retryPatches()
  // re-sends anything still outstanding on every hydrate/poll.
  var PATCH_KEY = 'eg_pending_patches';
  function readPatches() { try { return JSON.parse(localStorage.getItem(PATCH_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function writePatches(m) { try { localStorage.setItem(PATCH_KEY, JSON.stringify(m)); } catch (e) {} }
  function flushPatch(orderId, sent) {
    return api('/orders/' + encodeURIComponent(orderId), { method: 'PATCH', body: sent }).then(function (r) {
      if (!r || r.error) return r;                                    // failed → leave queued for retry
      var m = readPatches(), cur = m[orderId];
      if (cur) {                                                      // drop only fields unchanged since we sent them
        Object.keys(sent).forEach(function (k) {
          if (JSON.stringify(cur[k]) === JSON.stringify(sent[k])) delete cur[k];
        });
        if (Object.keys(cur).length === 0) delete m[orderId]; else m[orderId] = cur;
        writePatches(m);
      }
      return r;
    });
  }
  function pushPatch(orderId, patch) {
    if (orderId == null) return Promise.resolve();
    var m = readPatches();
    m[orderId] = Object.assign(m[orderId] || {}, patch || {});
    writePatches(m);
    return flushPatch(orderId, Object.assign({}, m[orderId]));
  }
  function retryPatches() {
    if (!token()) return;
    var m = readPatches();
    Object.keys(m).forEach(function (id) { flushPatch(id, Object.assign({}, m[id])); });
  }
  function hydrate() {
    if (!token()) return Promise.resolve();
    return api('/orders').then(function (r) {
      if (r.error) { console.warn('[egstore-api] hydrate failed:', r.error.message); return; }
      writeCache((r.data || []).map(dbToOrder));
      // Seed per-item production status from the server (each item carries
      // factory_status) so the warehouse "Working" flag shows on every board +
      // mobile, not just the browser that set it.
      try { if (window.EGStore && EGStore.seedItemFactoryStatusFromOrders) EGStore.seedItemFactoryStatusFromOrders(r.data || []); } catch(e){}
      retrySync();                                                    // recover any order whose POST never landed
      retryPatches();                                                 // recover any status/tracking update that never landed
    });
  }
  // The /api/orders POST only stores scalar fields + a few item columns — it
  // ignores img/designUrl/file/designPos. Those can be multi-MB data URLs, and a
  // whole order of them can blow past the 25MB body limit → the request is
  // rejected and NOTHING persists. So POST a LEAN copy: only what the server
  // saves, and never a data: blob (images go through /api/orders/:id/designs).
  function leanOrder(o) {
    if (!o) return o;
    var lean = {};
    ['id', 'seq', 'meta', 'seller', 'store', 'source', 'customer', 'address', 'status', 'factoryStatus', 'total', 'profit', 'delivery', 'carrier', 'tracking', 'timeline', 'notes']
      .forEach(function (k) { if (o[k] !== undefined) lean[k] = o[k]; });
    // Seller manual orders keep the recipient address on customer.shipTo, not the
    // server's `address` column — so without this the factory boards see no address.
    // Map it across whenever `address` is missing/empty.
    var _empty = !lean.address || (typeof lean.address === 'object' && !Object.keys(lean.address).length);
    if (_empty && o.customer && o.customer.shipTo) {
      var sh = o.customer.shipTo;
      if (sh && (sh.street || sh.city || sh.zip)) {
        lean.address = { name: o.customer.name || '', street: sh.street || '', apt: sh.apt || '',
                         city: sh.city || '', state: sh.state || '', zip: sh.zip || '' };
      }
    }
    if (Array.isArray(o.items)) {
      lean.items = o.items.map(function (it) {
        it = it || {};
        var ds = it.designSrc;
        if (typeof ds === 'string' && ds.indexOf('data:') === 0) ds = null;   // never ship a data blob
        // Persist the load-bearing fields so an EDIT can't wipe them on the next
        // hydrate: the chosen blank (name), the design position, and the listing/
        // hero image. The blank PHOTO is NOT shipped (it lives in the shared
        // catalog and resolves by SKU). Hero img is shipped only when it's a real
        // URL — never a multi-MB data: blob — so patches stay light.
        var heroImg = (it.img && /^https?:/.test(String(it.img))) ? it.img : null;
        return {
          sku: it.sku, name: it.name, listing: it.listing,
          printType: it.printType || it.tech, tech: it.tech,
          qty: it.qty, color: it.color, size: it.size, variant: it.variant,
          unitPrice: it.unitPrice, designSrc: ds,
          blank: it.blank || null, img: heroImg, designPos: it.designPos || null,
          lineId: it.lineId || null
        };
      });
    }
    return lean;
  }
  function installWrappers() {
    if (EGStore.__apiWrapped) return; EGStore.__apiWrapped = true;
    var origAdd = EGStore.add;
    if (typeof origAdd === 'function') EGStore.add = function (order) {
      var res = origAdd.apply(EGStore, arguments);
      try {
        var saved = (EGStore.getOrders() || []).find(function (o) { return o.id === ((res && res.id) || (order && order.id)); }) || order;
        pushOrder(saved);
      } catch (e) {}
      return res;
    };
    var origUpdate = EGStore.update;
    if (typeof origUpdate === 'function') EGStore.update = function (orderId, patch) {
      var res = origUpdate.apply(EGStore, arguments);
      try { pushPatch(orderId, patch); } catch (e) {}
      return res;
    };
    // submitOrder is the path EVERY manual/imported seller order takes — it
    // writes localStorage directly (bypassing add), so without this wrapper the
    // server never records it and the next hydrate (a full cache overwrite)
    // wipes it. POST the resulting order so it persists server-side too. The
    // POST upserts by id, so re-submits (drafts → submit, edits) are safe.
    var origSubmit = EGStore.submitOrder;
    if (typeof origSubmit === 'function') EGStore.submitOrder = function (opts) {
      var res = origSubmit.apply(EGStore, arguments);
      try {
        var saved = res || (opts && opts.id && (EGStore.getOrders() || []).find(function (o) { return o.id === opts.id; }));
        if (saved && saved.id) pushOrder(saved);
      } catch (e) {}
      return res;
    };
  }
  // ── Inventory + design-card sync (FACTORY data — staff roles only) ────────
  // localStorage is the cache; we intercept writes to these keys and POST the
  // full (DB-shaped) list, hydrate on login, and refresh on the poll. Gated to
  // staff so a seller's restricted read can't wipe their cache.
  var _suspend = {}, _pushTimers = {};
  var COLLECTIONS = {
    eg_inventory: {
      path: '/inventory',
      fromDb: function (d) { return { sku: d.sku, name: d.name, variant: d.variant, inStock: d.in_stock, reserved: d.reserved, reorderAt: d.reorder_at, category: d.category }; },
      toDb: function (r) { return { sku: r.sku, name: r.name || null, variant: r.variant || null, in_stock: parseInt(r.inStock, 10) || 0, reserved: parseInt(r.reserved, 10) || 0, reorder_at: r.reorderAt != null ? parseInt(r.reorderAt, 10) : 25, category: r.category || null }; }
    },
    egfulfill_design_cards: {
      path: '/design_cards',
      fromDb: function (d) { return { id: d.id, order: d.order_id, sku: d.sku, designId: d.design_id, title: d.title, col: d.col, type: d.type, product: d.product, priority: d.priority, due: d.due, assignee: d.assignee, claimedBy: d.claimed_by, payment: d.payment, payStatus: d.pay_status, isEmb: d.is_emb, embFileName: d.emb_file_name, thumb: d.thumb, thumb_ref: d.thumb_ref, files: d.files || [], specs: d.specs || {}, notes: d.notes || [], history: d.history || [], checklist: d.checklist || [] }; },
      toDb: function (c) { return { id: c.id, order_id: c.order || null, sku: c.sku || null, design_id: c.designId || c.title || null, title: c.title || null, col: c.col || 'incoming', type: c.type || null, product: c.product || null, priority: c.priority || 'normal', due: c.due || null, assignee: c.assignee || null, claimed_by: c.claimedBy || null, payment: parseFloat(c.payment) || 0, pay_status: c.payStatus || 'pending', is_emb: !!c.isEmb, emb_file_name: c.embFileName || null, thumb: c.thumb || null, thumb_ref: c.thumb_ref || null, files: c.files || [], specs: c.specs || {}, notes: c.notes || [], history: c.history || [], checklist: c.checklist || [] }; }
    }
  };
  function isStaff() { try { var u = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); return u && ['operator', 'admin', 'warehouse', 'designer'].indexOf(u.role) !== -1; } catch (e) { return false; } }
  function readArr(key) { try { return JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (e) { return []; } }
  function hydrateCollection(key) {
    var c = COLLECTIONS[key];
    return api(c.path).then(function (r) {
      if (r.error) { console.warn('[egstore-api] hydrate ' + key + ':', r.error.message); return; }
      _suspend[key] = true;
      try { localStorage.setItem(key, JSON.stringify((r.data || []).map(c.fromDb))); } catch (e) {}
      _suspend[key] = false;
      try { window.dispatchEvent(new StorageEvent('storage', { key: key })); } catch (e) {}
    });
  }
  function pushCollection(key) {
    var c = COLLECTIONS[key];
    var rows = readArr(key).map(c.toDb);
    if (!rows.length) return;
    api(c.path, { method: 'POST', body: rows });
  }
  (function () {                       // intercept writes to the synced keys
    var orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, val) {
      orig(key, val);
      if (COLLECTIONS[key] && token() && isStaff() && !_suspend[key]) {
        clearTimeout(_pushTimers[key]);
        _pushTimers[key] = setTimeout(function () { pushCollection(key); }, 500);
      }
    };
  })();

  // ── Catalog products (the shared product catalog) ──
  // Stored locally split across eg_catalog_products (metadata) + _blob (images)
  // and reassembled by EGStore.getCatalogProducts(), so the plain setItem
  // interceptor above can't see the full product. We wrap setCatalogProducts —
  // the lossless chokepoint — instead. Readable by all; writable by staff.
  var _suspendCatalog = false, _catalogTimer = null;
  function pushCatalog(list) {
    if (!window.EGStore || !EGStore.getCatalogProducts) return;
    // Prefer the full in-memory product list handed in by the wrap (still holds
    // data-URL images); fall back to a reassembly only when called bare (seeding).
    list = list || EGStore.getCatalogProducts() || [];
    api('/catalog_products', { method: 'POST', body: list });
  }
  function hydrateCatalog() {
    if (!window.EGStore || !EGStore.setCatalogProducts) return Promise.resolve();
    return api('/catalog_products').then(function (r) {
      if (r.error) { console.warn('[egstore-api] hydrate catalog:', r.error.message); return; }
      var server = r.data || [];
      if (!server.length) {
        // DB empty — seed it from anything already in this browser (don't wipe).
        var local = EGStore.getCatalogProducts() || [];
        if (local.length && isStaff()) pushCatalog();
        return;
      }
      // Stash the FULL server catalog (data-URL images intact) in RAM first —
      // getCatalogProducts() reads it for image fields, so even if the localStorage
      // blob write below is dropped on quota, renders still get the real photo.
      try { EGStore.setCatalogMemory(server); } catch (e) {}
      _suspendCatalog = true;
      try { EGStore.setCatalogProducts(server); } catch (e) {}
      _suspendCatalog = false;
      try { window.dispatchEvent(new StorageEvent('storage', { key: 'eg_catalog_products' })); } catch (e) {}
    });
  }
  // Templates live server-side now (heavy composites were blowing localStorage).
  // Pull them into the local cache so "Use a Template" + Design Maker readers work
  // unchanged; composites are best-effort (dropped if the quota is hit — the server
  // still has them). Merges in any local-only template not yet on the server.
  function hydrateTemplates() {
    if (!token()) return Promise.resolve();
    return api('/templates').then(function (r) {
      if (r.error || !Array.isArray(r.data)) return;
      var serverIds = {}, meta = [], blobs = {};
      r.data.forEach(function (t) {
        if (!t || t.id == null) return;
        serverIds[t.id] = true;
        var m = (t.data && typeof t.data === 'object') ? t.data : { id: t.id, name: t.name };
        m.id = m.id != null ? m.id : t.id; m.name = m.name || t.name;
        meta.push(m);
        if (t.composite || (t.layers && t.layers.length)) blobs[t.id] = { compositeImg: t.composite || '', layers: t.layers || [] };
      });
      // Preserve any local template the server hasn't confirmed yet (just saved).
      try {
        var localMeta = JSON.parse(localStorage.getItem('eg_templates') || '[]') || [];
        localMeta.forEach(function (m) { if (m && m.id != null && !serverIds[m.id]) meta.push(m); });
      } catch (e) {}
      try { localStorage.setItem('eg_templates', JSON.stringify(meta.slice(0, 60))); } catch (e) {}
      try { localStorage.setItem('eg_templates_blob', JSON.stringify(blobs)); }
      catch (e) {
        // Quota — drop composites, keep just layers so re-open still works.
        try { var lite = {}; Object.keys(blobs).forEach(function (k) { lite[k] = { compositeImg: '', layers: blobs[k].layers || [] }; }); localStorage.setItem('eg_templates_blob', JSON.stringify(lite)); } catch (_) {}
      }
      try { window.dispatchEvent(new StorageEvent('storage', { key: 'eg_templates' })); } catch (e) {}
    });
  }
  function wrapCatalog() {
    if (!window.EGStore || !EGStore.setCatalogProducts || EGStore.__catalogWrapped) return;
    var origSet = EGStore.setCatalogProducts.bind(EGStore);
    EGStore.setCatalogProducts = function (products) {
      var ok = origSet(products);
      if (token() && isStaff() && !_suspendCatalog) {
        clearTimeout(_catalogTimer);
        // Capture the full in-memory list (data-URL images intact) and push THAT,
        // not a reassembly from localStorage — the blob may already be quota-dropped.
        var full = Array.isArray(products) ? products.slice() : products;
        _catalogTimer = setTimeout(function () { pushCatalog(full); }, 500);
      }
      return ok;
    };
    EGStore.__catalogWrapped = true;
  }

  function _setOrdersPoll(ms){
    clearInterval(window.__egApiPoll);
    window.__egApiPoll = setInterval(function(){ hydrate(); }, ms);
  }
  // Realtime push (SSE). Instant updates on every change; when connected the orders
  // poll relaxes to a slow backstop, and if the stream drops the fast 5s poll resumes.
  function startRealtime(){
    if (typeof EventSource === 'undefined' || !token()) return;
    try {
      if (window.__egSSE) { try { window.__egSSE.close(); } catch(e){} }
      var es = new EventSource(API_BASE + '/api/events?token=' + encodeURIComponent(token()));
      window.__egSSE = es;
      var _t = null;
      es.onopen = function(){ _setOrdersPoll(30000); };
      es.onmessage = function(){ clearTimeout(_t); _t = setTimeout(function(){ hydrate(); }, 150); };
      es.onerror = function(){ _setOrdersPoll(5000); };
    } catch(e){}
  }
  function start() {
    if (!token()) return;          // signed out → leave local/demo data alone
    installWrappers();
    wrapCatalog();
    hydrate();
    hydrateCatalog();
    hydrateTemplates();
    var collKeys = isStaff() ? Object.keys(COLLECTIONS) : [];
    collKeys.forEach(hydrateCollection);
    // Cross-board liveness (no realtime server yet). Orders poll FAST (5s) — this is
    // what drives live item-status across boards. The catalog + collections change
    // rarely, so poll them on a slower interval to avoid hammering the server.
    _setOrdersPoll(5000);
    clearInterval(window.__egApiPollSlow);
    window.__egApiPollSlow = setInterval(function () {
      hydrateCatalog();
      collKeys.forEach(hydrateCollection);
    }, 20000);
    startRealtime();   // SSE: instant cross-board/mobile updates (poll is the fallback)
  }
  start();
  // Shared order-ID resolver so every board shows ids the same way:
  // marketplace order # on top, EGFULFILL store id below.
  window.egOrderIds = function (o) {
    if (!o) return { market: '', eg: '', source: 'Manual' };
    var num = String(o.num || o.id || '');
    var plat = (o.platId && o.platId !== '—') ? String(o.platId) : '';
    var m = num.match(/^([a-z]+)-(.+)$/i);
    var LBL = { etsy: 'Etsy', shopify: 'Shopify', tiktok: 'TikTok', woocommerce: 'WooCommerce', amazon: 'Amazon', ebay: 'eBay' };
    var PFX = { SP: 'Shopify', ET: 'Etsy', WC: 'WooCommerce', AM: 'Amazon', TT: 'TikTok' };
    // Synced marketplace order: primary key is "<platform>-<number>". Show just the number.
    if (m && LBL[m[1].toLowerCase()]) {
      return { market: '#' + m[2], eg: o.egId || ('MA-' + num.slice(-5)), source: LBL[m[1].toLowerCase()] };
    }
    // Seed/legacy: platId carries the marketplace id (SP-/ET-/…), num is the EG id.
    if (plat) return { market: plat, eg: num, source: PFX[plat.slice(0, 2).toUpperCase()] || 'Etsy' };
    // Manual order: no marketplace id — just the EGFULFILL id.
    return { market: '', eg: num, source: 'Manual' };
  };

  window.EGStoreSync = { hydrate: hydrate, hydrateCollection: hydrateCollection, hydrateCatalog: hydrateCatalog, hydrateTemplates: hydrateTemplates, pushCatalog: pushCatalog };
})();

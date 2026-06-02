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
  function setSession(d) {
    if (d && d.token) localStorage.setItem(TOKEN_KEY, d.token);
    if (d && d.user)  localStorage.setItem(USER_KEY, JSON.stringify(d.user));
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    return fetch(API_BASE + '/api' + path, {
      method: opts.method || 'GET', headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
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
             unitPrice: Number(it.unit_price) || 0, designSrc: it.design_src, img: it.img, designPos: it.design_pos };
  }
  function dbToOrder(r) {
    return { id: r.id, store: r.store, seller: r.store, source: r.source,
             customer: r.customer || {}, address: r.address || {},
             status: r.status, factoryStatus: r.factory_status,
             total: Number(r.total) || 0, profit: Number(r.profit) || 0,
             delivery: r.delivery, carrier: r.carrier, service: r.service, tracking: r.tracking,
             timeline: r.timeline || [], notes: r.notes || [], gates: r.gates || {},
             createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
             submittedAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
             items: (r.items || []).map(dbToItem), _live: true };
  }
  function writeCache(orders) {
    try { localStorage.setItem(KEY, JSON.stringify(orders)); } catch (e) {}
    try { window.dispatchEvent(new Event('eg-orders-changed')); } catch (e) {}
    try { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); } catch (e) {}
  }
  function hydrate() {
    if (!token()) return Promise.resolve();
    return api('/orders').then(function (r) {
      if (r.error) { console.warn('[egstore-api] hydrate failed:', r.error.message); return; }
      writeCache((r.data || []).map(dbToOrder));
    });
  }
  function installWrappers() {
    if (EGStore.__apiWrapped) return; EGStore.__apiWrapped = true;
    var origAdd = EGStore.add;
    if (typeof origAdd === 'function') EGStore.add = function (order) {
      var res = origAdd.apply(EGStore, arguments);
      try {
        var saved = (EGStore.getOrders() || []).find(function (o) { return o.id === ((res && res.id) || (order && order.id)); }) || order;
        api('/orders', { method: 'POST', body: saved });
      } catch (e) {}
      return res;
    };
    var origUpdate = EGStore.update;
    if (typeof origUpdate === 'function') EGStore.update = function (orderId, patch) {
      var res = origUpdate.apply(EGStore, arguments);
      try { api('/orders/' + encodeURIComponent(orderId), { method: 'PATCH', body: patch }); } catch (e) {}
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
  function pushCatalog() {
    if (!window.EGStore || !EGStore.getCatalogProducts) return;
    var list = EGStore.getCatalogProducts() || [];
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
      _suspendCatalog = true;
      try { EGStore.setCatalogProducts(server); } catch (e) {}
      _suspendCatalog = false;
      try { window.dispatchEvent(new StorageEvent('storage', { key: 'eg_catalog_products' })); } catch (e) {}
    });
  }
  function wrapCatalog() {
    if (!window.EGStore || !EGStore.setCatalogProducts || EGStore.__catalogWrapped) return;
    var origSet = EGStore.setCatalogProducts.bind(EGStore);
    EGStore.setCatalogProducts = function (products) {
      var ok = origSet(products);
      if (token() && isStaff() && !_suspendCatalog) {
        clearTimeout(_catalogTimer);
        _catalogTimer = setTimeout(pushCatalog, 500);
      }
      return ok;
    };
    EGStore.__catalogWrapped = true;
  }

  function start() {
    if (!token()) return;          // signed out → leave local/demo data alone
    installWrappers();
    wrapCatalog();
    hydrate();
    hydrateCatalog();
    var collKeys = isStaff() ? Object.keys(COLLECTIONS) : [];
    collKeys.forEach(hydrateCollection);
    // Light polling for cross-board liveness (no realtime server yet). 15s.
    clearInterval(window.__egApiPoll);
    window.__egApiPoll = setInterval(function () {
      hydrate();
      hydrateCatalog();
      collKeys.forEach(hydrateCollection);
    }, 15000);
  }
  start();
  // Shared order-ID resolver so every board shows ids the same way:
  // marketplace order # on top, EGFULFILL store id below.
  window.egOrderIds = function (o) {
    if (!o) return { market: '', eg: '' };
    var num = String(o.num || o.id || '');
    var plat = (o.platId && o.platId !== '—') ? String(o.platId) : '';
    var m = num.match(/^([a-z]+)-(.+)$/i);
    var LBL = { etsy: 'Etsy', shopify: 'Shopify', tiktok: 'TikTok', woocommerce: 'Woo', amazon: 'Amazon', ebay: 'eBay' };
    // Synced marketplace order: primary key is "<platform>-<number>".
    if (m && LBL[m[1].toLowerCase()]) {
      return { market: LBL[m[1].toLowerCase()] + ' #' + m[2], eg: o.egId || ('MA-' + num.slice(-5)) };
    }
    // Seed/legacy: platId carries the marketplace id (SP-/ET-/…), num is the EG id.
    if (plat) return { market: plat, eg: num };
    // Manual order: no marketplace id — just the EGFULFILL id.
    return { market: '', eg: num };
  };

  window.EGStoreSync = { hydrate: hydrate, hydrateCollection: hydrateCollection, hydrateCatalog: hydrateCatalog, pushCatalog: pushCatalog };
})();

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
  function start() {
    if (!token()) return;          // signed out → leave local/demo data alone
    installWrappers();
    hydrate();
    // Light polling for cross-board liveness (no realtime server yet). 15s.
    clearInterval(window.__egApiPoll);
    window.__egApiPoll = setInterval(hydrate, 15000);
  }
  start();
  window.EGStoreSync = { hydrate: hydrate };
})();

/* ============================================================================
   egstore-supabase.js — SYNC BRIDGE (orders slice).

   The whole app reads/writes orders through EGStore, which stores them in
   localStorage['egfulfill_orders']. We DON'T rewrite EGStore. Instead we treat
   localStorage as a local cache and keep it in sync with Supabase:

     • HYDRATE  — on login, pull orders from Supabase → write to localStorage →
                  fire the events EGStore/pages already listen for (so they render).
     • PUSH     — wrap EGStore.add / EGStore.update so every local write is also
                  persisted to Supabase (optimistic: local first, then network).
     • REALTIME — subscribe to the orders table → refresh the cache when anything
                  changes anywhere (replaces the old `storage`-event sync).

   Result: reads stay synchronous (served from the localStorage cache); writes
   are optimistic; no page or EGStore change required. This is the TEMPLATE —
   copy the same three steps for design_cards, inventory, etc.

   Load order:  supabase-js  →  supabase-client.js  →  egfulfill-store.js  →  THIS
   ============================================================================ */
(function () {
  'use strict';
  var KEY = 'egfulfill_orders';
  var sb  = window.sb;
  if (!sb) { console.warn('[egstore-supabase] window.sb missing — load supabase-client.js first'); return; }

  // ── Field mapping: DB row (snake_case + child table) ⇄ EGStore order ──────
  function dbToItem(it) {
    return {
      sku: it.sku, name: it.name, listing: it.listing, printType: it.print_type,
      qty: it.qty, color: it.color, size: it.size, variant: it.variant, blank: it.blank,
      unitPrice: it.unit_price, designSrc: it.design_src, img: it.img, designPos: it.design_pos,
      tech: it.print_type
    };
  }
  function dbToOrder(r) {
    return {
      id: r.id, store: r.store, seller: r.store, source: r.source,
      customer: r.customer || {}, address: r.address || {},
      status: r.status, factoryStatus: r.factory_status,
      total: Number(r.total) || 0, profit: Number(r.profit) || 0,
      delivery: r.delivery, carrier: r.carrier, service: r.service,
      tracking: r.tracking, trackingLabelUrl: r.tracking_label_url,
      timeline: r.timeline || [], notes: r.notes || [], gates: r.gates || {},
      createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
      items: (r.order_items || []).map(dbToItem),
      _live: true
    };
  }
  function orderToDb(o) {
    return {
      id: o.id, store: o.store || o.seller || null, source: o.source || 'manual',
      customer: o.customer || {}, address: o.address || {},
      status: o.status || 'new', factory_status: o.factoryStatus || o.status || 'new',
      total: o.total || 0, profit: o.profit || 0, delivery: o.delivery || null,
      carrier: o.carrier || null, service: o.service || null, tracking: o.tracking || null,
      tracking_label_url: o.trackingLabelUrl || null,
      timeline: o.timeline || [], notes: o.notes || [], gates: o.gates || {}
    };
  }
  function itemToDb(orderId, it) {
    return {
      order_id: orderId, sku: it.sku, name: it.name, listing: it.listing,
      print_type: it.printType || it.tech || null, qty: it.qty || 1,
      color: it.color || null, size: it.size || null, variant: it.variant || null,
      blank: it.blank || null, unit_price: it.unitPrice || 0,
      design_src: it.designSrc || null, img: it.img || null, design_pos: it.designPos || null
    };
  }

  // Map an EGStore.update() patch (camelCase) onto DB columns (snake_case).
  var PATCH_MAP = {
    factoryStatus: 'factory_status', status: 'status', total: 'total', profit: 'profit',
    tracking: 'tracking', trackingLabelUrl: 'tracking_label_url', carrier: 'carrier',
    service: 'service', delivery: 'delivery', timeline: 'timeline', notes: 'notes',
    gates: 'gates', customer: 'customer', address: 'address', store: 'store'
  };
  function patchToDb(patch) {
    var out = {};
    Object.keys(patch || {}).forEach(function (k) { if (PATCH_MAP[k]) out[PATCH_MAP[k]] = patch[k]; });
    return out;
  }

  // ── Cache write + notify (mirror EGStore's own event surface) ─────────────
  function writeCache(orders) {
    try { localStorage.setItem(KEY, JSON.stringify(orders)); } catch (e) {}
    try { window.dispatchEvent(new Event('eg-orders-changed')); } catch (e) {}
    try { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); } catch (e) {}
  }

  // ── HYDRATE: Supabase → localStorage cache ────────────────────────────────
  var _hydrating = false;
  function hydrate() {
    if (_hydrating) return Promise.resolve();
    _hydrating = true;
    return sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false })
      .then(function (res) {
        _hydrating = false;
        if (res.error) { console.warn('[egstore-supabase] hydrate failed', res.error.message); return; }
        writeCache((res.data || []).map(dbToOrder));
      })
      .catch(function (e) { _hydrating = false; console.warn('[egstore-supabase] hydrate error', e); });
  }

  // ── PUSH: persist an order (and its items) to Supabase ────────────────────
  function pushOrder(o) {
    return sb.auth.getUser().then(function (u) {
      var row = orderToDb(o);
      if (u.data.user) row.seller_id = u.data.user.id;   // RLS: stamp the owner
      return sb.from('orders').upsert(row).then(function (r) {
        if (r.error) { console.warn('[egstore-supabase] order upsert failed', r.error.message); return; }
        var items = (o.items || []).map(function (it) { return itemToDb(o.id, it); });
        if (!items.length) return;
        // Simplest correct approach: replace this order's items.
        return sb.from('order_items').delete().eq('order_id', o.id)
          .then(function () { return sb.from('order_items').insert(items); });
      });
    });
  }
  function pushPatch(orderId, patch) {
    var db = patchToDb(patch);
    if (!Object.keys(db).length) return Promise.resolve();
    return sb.from('orders').update(db).eq('id', orderId).then(function (r) {
      if (r.error) console.warn('[egstore-supabase] order update failed', r.error.message);
    });
  }

  // ── Wrap EGStore mutators so local writes also hit Supabase ───────────────
  function installWrappers() {
    if (typeof EGStore === 'undefined') return;
    if (EGStore.__sbWrapped) return; EGStore.__sbWrapped = true;

    var origAdd = EGStore.add;
    if (typeof origAdd === 'function') {
      EGStore.add = function (order) {
        var result = origAdd.apply(EGStore, arguments);   // local cache write first (sync)
        try {
          var saved = (EGStore.getOrders() || []).find(function (o) { return o.id === (result && result.id || (order && order.id)); }) || order;
          pushOrder(saved);                               // then network (async, optimistic)
        } catch (e) { console.warn('[egstore-supabase] add push error', e); }
        return result;
      };
    }
    var origUpdate = EGStore.update;
    if (typeof origUpdate === 'function') {
      EGStore.update = function (orderId, patch) {
        var result = origUpdate.apply(EGStore, arguments);
        try { pushPatch(orderId, patch); } catch (e) { console.warn('[egstore-supabase] update push error', e); }
        return result;
      };
    }
  }

  // ── REALTIME: refresh the cache when the orders table changes ─────────────
  var _t = null;
  function debounceHydrate() { clearTimeout(_t); _t = setTimeout(hydrate, 250); }
  function subscribe() {
    sb.channel('eg-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },      debounceHydrate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, debounceHydrate)
      .subscribe();
  }

  // ── Generic collection sync (inventory + design cards) ────────────────────
  // Same idea as orders but driven off the localStorage key: localStorage stays
  // the cache; we intercept writes to these keys and upsert to Supabase, hydrate
  // on login, and refresh on realtime changes. Used for the FACTORY data only
  // (gated by role below so a seller's RLS-empty read can't wipe their cache).
  var _active = false;
  var _suspend = {};
  var _pushTimers = {};
  var COLLECTIONS = {
    eg_inventory: {
      table: 'inventory', pk: 'sku',
      fromDb: function (d) { return { sku: d.sku, name: d.name, variant: d.variant, inStock: d.in_stock, reserved: d.reserved, reorderAt: d.reorder_at, category: d.category }; },
      toDb: function (r) { return { sku: r.sku, name: r.name || null, variant: r.variant || null, in_stock: parseInt(r.inStock, 10) || 0, reserved: parseInt(r.reserved, 10) || 0, reorder_at: r.reorderAt != null ? parseInt(r.reorderAt, 10) : 25, category: r.category || null }; }
    },
    egfulfill_design_cards: {
      table: 'design_cards', pk: 'id',
      fromDb: function (d) { return { id: d.id, order: d.order_id, sku: d.sku, designId: d.design_id, title: d.title, col: d.col, type: d.type, product: d.product, priority: d.priority, due: d.due, assignee: d.assignee, claimedBy: d.claimed_by, payment: d.payment, payStatus: d.pay_status, isEmb: d.is_emb, embFileName: d.emb_file_name, thumb: d.thumb, thumb_ref: d.thumb_ref, files: d.files || [], specs: d.specs || {}, notes: d.notes || [], history: d.history || [], checklist: d.checklist || [] }; },
      toDb: function (c) { return { id: c.id, order_id: c.order || null, sku: c.sku || null, design_id: c.designId || c.title || null, title: c.title || null, col: c.col || 'incoming', type: c.type || null, product: c.product || null, priority: c.priority || 'normal', due: c.due || null, assignee: c.assignee || null, claimed_by: c.claimedBy || null, payment: parseFloat(c.payment) || 0, pay_status: c.payStatus || 'pending', is_emb: !!c.isEmb, emb_file_name: c.embFileName || null, thumb: c.thumb || null, thumb_ref: c.thumb_ref || null, files: c.files || [], specs: c.specs || {}, notes: c.notes || [], history: c.history || [], checklist: c.checklist || [] }; }
    }
  };
  function _readArr(key) { try { return JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (e) { return []; } }
  function hydrateCollection(key) {
    var c = COLLECTIONS[key]; if (!c) return;
    return sb.from(c.table).select('*').then(function (res) {
      if (res.error) { console.warn('[sync] hydrate ' + c.table + ' failed', res.error.message); return; }
      _suspend[key] = true;
      try { localStorage.setItem(key, JSON.stringify((res.data || []).map(c.fromDb))); } catch (e) {}
      _suspend[key] = false;
      try { window.dispatchEvent(new StorageEvent('storage', { key: key })); } catch (e) {}
    });
  }
  function pushCollection(key) {
    var c = COLLECTIONS[key]; if (!c || !_active) return;
    var rows = _readArr(key).map(c.toDb).filter(function (r) { return r[c.pk] != null && r[c.pk] !== ''; });
    if (!rows.length) return;
    sb.from(c.table).upsert(rows, { onConflict: c.pk }).then(function (res) {
      if (res.error) console.warn('[sync] push ' + c.table + ' failed', res.error.message);
    });
  }
  function subscribeCollection(key) {
    var c = COLLECTIONS[key]; if (!c) return; var t = null;
    sb.channel('eg-' + c.table)
      .on('postgres_changes', { event: '*', schema: 'public', table: c.table }, function () { clearTimeout(t); t = setTimeout(function () { hydrateCollection(key); }, 250); })
      .subscribe();
  }
  // Intercept localStorage writes once: any write to a synced key pushes upstream.
  (function () {
    var orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, val) {
      orig(key, val);
      if (COLLECTIONS[key] && _active && !_suspend[key]) { clearTimeout(_pushTimers[key]); _pushTimers[key] = setTimeout(function () { pushCollection(key); }, 400); }
    };
  })();

  // ── Boot: only sync when a user is signed in ──────────────────────────────
  function start(session) {
    if (!session) return;                 // logged out → leave demo/localStorage data alone
    _active = true;
    installWrappers();                    // orders — everyone
    hydrate();
    subscribe();
    // Inventory + design cards are FACTORY data — only sync them for staff, so a
    // seller's RLS-restricted (empty) read can't blow away their local cache.
    sb.from('profiles').select('role').eq('id', session.user.id).single().then(function (p) {
      var role = p.data && p.data.role;
      if (['operator', 'admin', 'warehouse', 'designer'].indexOf(role) !== -1) {
        Object.keys(COLLECTIONS).forEach(function (key) { hydrateCollection(key); subscribeCollection(key); });
      }
    });
  }
  sb.auth.getSession().then(function (r) { start(r.data.session); });
  sb.auth.onAuthStateChange(function (_e, session) { if (session) start(session); });

  // Expose for manual refresh / debugging.
  window.EGStoreSync = { hydrate: hydrate, pushOrder: pushOrder, hydrateCollection: hydrateCollection, pushCollection: pushCollection };
})();

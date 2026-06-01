/**
 * EGFULFILL localStorage bridge — shared order state for local flow testing.
 * Replace EGStore calls with real API calls when backend is ready.
 * Key: 'egfulfill_orders'
 */
(function() {
  var KEY = 'egfulfill_orders';
  var _seq = 8900;

  /* Shared status-badge styles for cancelled / refunded.
     Loaded once at startup so every page using EGStore inherits the look
     without per-file CSS edits. Cancelled = light muted grey text.
     Refunded = small outlined neutral pill (settled-money state). */
  function _injectStatusBadgeStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('eg-status-badge-styles')) return;
    var css = [
      /* Cancelled: muted light-grey text, no pill */
      '.b-cancelled,.b-s-cancel,.b-wh-cancel,.b-adm-cancelled,.b-op-cancel,.b-disc{color:#9ca3af!important;background:transparent!important;padding:0!important;font-weight:600;border:none!important}',
      /* Refunded: darker slate-grey text, no pill (distinct color from cancelled, same text-only treatment) */
      '.b-refunded,.b-s-refund,.b-wh-refund,.b-adm-refund,.b-op-refund{color:#374151!important;background:transparent!important;padding:0!important;font-weight:600!important;border:none!important;font-size:inherit!important;border-radius:0!important;line-height:inherit!important}',
      /* Dark-theme variants */
      'html[data-theme=dark] .b-cancelled,html[data-theme=dark] .b-s-cancel,html[data-theme=dark] .b-wh-cancel,html[data-theme=dark] .b-adm-cancelled,html[data-theme=dark] .b-op-cancel{color:#7a7874!important}',
      'html[data-theme=dark] .b-refunded,html[data-theme=dark] .b-s-refund,html[data-theme=dark] .b-wh-refund,html[data-theme=dark] .b-adm-refund,html[data-theme=dark] .b-op-refund{color:#c9c3ba!important;background:transparent!important;border:none!important}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'eg-status-badge-styles';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _injectStatusBadgeStyles);
    else _injectStatusBadgeStyles();
  }

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch(e) { return []; }
  }
  function _save(orders) {
    localStorage.setItem(KEY, JSON.stringify(orders));
    // Notify same-tab stat renderers (cross-tab is covered by the native 'storage' event).
    try { window.dispatchEvent(new Event('eg-orders-changed')); } catch(e){}
  }
  function _ts() { return Date.now(); }
  function _timeAgo(ts) {
    var s = Math.floor((_ts() - ts) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
  }
  function _nextId(orders) {
    var used = orders.map(function(o){ return parseInt((o.id||'').replace('FF-',''))||0; });
    var max = used.length ? Math.max.apply(null, used) : _seq;
    return 'FF-' + (max + 1);
  }

  // Assumed gross margin used to derive profit from revenue when an explicit
  // profit isn't supplied (typical POD net margin ≈ 40%).
  var PROFIT_MARGIN = 0.40;
  // Revenue of a single order: explicit o.total wins, else sum(item.qty × item.price).
  function _orderTotal(o) {
    if (o == null) return 0;
    if (typeof o.total === 'number') return o.total;
    var t = parseFloat(o.total);
    if (!isNaN(t)) return t;
    var items = Array.isArray(o.items) ? o.items : [];
    return items.reduce(function(sum, it){
      var price = parseFloat(it && (it.price != null ? it.price : it.unitPrice)) || 0;
      var qty   = parseInt(it && it.qty, 10) || 1;
      return sum + price * qty;
    }, 0);
  }
  function _orderProfit(o) {
    if (o && typeof o.profit === 'number') return o.profit;
    return _orderTotal(o) * PROFIT_MARGIN;
  }
  // Production buckets — which factory statuses count as "in production".
  var _PROD = { awaiting_scan:1, scanned:1, printing:1, packing:1, in_queue:1, prescan:1, ready_print:1, production:1, qc:1, packed:1 };

  // Factory status → seller-facing label.
  // The seller only ever sees three states: Order Received, In Production, Shipped (plus
  // Action Needed when something's flagged). Internal factory statuses (in_review,
  // awaiting_scan, scanned, printing) all collapse onto "In Production" the moment a design
  // is pushed to the design board — sellers don't need fine-grained factory visibility.
  var SELLER_STATUS = {
    'new':           { label: 'Order Received', color: '#6b7280', bg: '#f3f4f6' },
    'in_review':     { label: 'In Review',      color: '#9ca3af', bg: '#f3f4f6' },
    'awaiting_scan': { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
    'scanned':       { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
    'printing':      { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
    'packing':       { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
    'shipped':       { label: 'Shipped',        color: '#16a34a', bg: '#f0fdf4' },
    'flagged':       { label: 'Action Needed',  color: '#dc2626', bg: '#fef2f2' },
    'cancelled':     { label: 'Cancelled',      color: '#9ca3af', bg: 'transparent' },
    'refunded':      { label: 'Refunded',       color: '#6b7280', bg: '#f3f3f1'  },
    // legacy aliases
    'prescan':       { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
    'ready_print':   { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
    'in_queue':      { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
    'production':    { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
    'qc':            { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
    'packed':        { label: 'In Production',  color: '#6366f1', bg: '#eef2ff' },
  };

  // Factory status badge classes (matching existing badge system)
  var FACTORY_BADGE = {
    'new':        'b-new',
    'in_review':  'b-queue',
    'printing':   'b-prod',
    'packing':    'b-packed',
    'shipped':    'b-shipped',
    'flagged':    'b-action',
    'cancelled':  'b-cancelled',
    'refunded':   'b-refunded',
  };
  var FACTORY_LABEL = {
    'new':        '● New',
    'in_review':  'In Review',
    'printing':   'Printing',
    'packing':    'Packing',
    'shipped':    'Shipped',
    'flagged':    '⚑ Flagged',
    'cancelled':  'Cancelled',
    'refunded':   'Refunded',
  };

  window.EGStore = {

    getOrders: function() { return _load(); },

    // Aggregate every stored order into the numbers the dashboards display.
    // Everything starts at 0 with an empty store, so creating test orders moves
    // these live. revenue/profit derive from item price×qty (see _orderTotal).
    stats: function() {
      var orders = _load();
      var s = {
        total: orders.length,
        new: 0, inReview: 0, inProduction: 0, shipped: 0, actionNeeded: 0,
        open: 0,                 // anything not shipped
        revenue: 0, profit: 0,
        units: 0,                // total item quantity across orders
        stores: {},              // distinct seller/store names → count
      };
      orders.forEach(function(o){
        var fs = o.factoryStatus || 'new';
        if (fs === 'new')               s.new++;
        else if (fs === 'in_review')    s.inReview++;
        else if (fs === 'shipped')      s.shipped++;
        else if (fs === 'flagged')      s.actionNeeded++;
        else if (_PROD[fs])             s.inProduction++;
        if (fs !== 'shipped')           s.open++;
        s.revenue += _orderTotal(o);
        s.profit  += _orderProfit(o);
        var items = Array.isArray(o.items) ? o.items : [];
        items.forEach(function(it){ s.units += (parseInt(it && it.qty,10) || 1); });
        var store = o.seller || (o.customer && o.customer.store) || 'My Store';
        s.stores[store] = (s.stores[store] || 0) + 1;
      });
      s.storeCount = Object.keys(s.stores).length;
      // Fulfillment rate = shipped / total (0 when no orders yet).
      s.fulfillmentRate = s.total ? Math.round((s.shipped / s.total) * 1000) / 10 : 0;
      return s;
    },
    // Convenience: revenue/profit/total formatted for display.
    money: function(n) {
      n = Number(n) || 0;
      return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    },

    // Register a renderer that runs now (after DOM ready) and again whenever orders
    // change — in this tab (via the 'eg-orders-changed' event we fire on write) or
    // another tab (via the native 'storage' event). Pass a function(stats){...}.
    bindStats: function(render) {
      if (typeof render !== 'function') return;
      var self = this;
      var run = function(){ try { render(self.stats()); } catch(e){} };
      if (document.readyState !== 'loading') run();
      else document.addEventListener('DOMContentLoaded', run);
      window.addEventListener('storage', function(e){ if (!e || e.key === KEY || e.key === null) run(); });
      window.addEventListener('eg-orders-changed', run);
    },
    // Fire after any local write so same-tab stat renderers refresh immediately.
    _emitChange: function(){ try { window.dispatchEvent(new Event('eg-orders-changed')); } catch(e){} },

    // Build a one-line shipping address from an order's customer.shipTo block, for the
    // factory dashboards' "Customer" column / detail card. Falls back to o.address if the
    // older flat-string format was used. Returns "—" when nothing is available.
    formatAddress: function(order) {
      if (!order) return '—';
      // Direct flat string takes precedence (legacy seed data uses this)
      if (typeof order.address === 'string' && order.address.trim()) return order.address.trim();
      var s = order.customer && order.customer.shipTo;
      if (!s) return '—';
      var line1 = [s.street, s.apt].filter(Boolean).join(' ');
      var line2 = [s.city, [s.state, s.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      var full  = [line1, line2].filter(Boolean).join(', ');
      return full || '—';
    },
    // Same data but as a structured object (for label-form auto-fill).
    getShipTo: function(order) {
      if (!order) return null;
      if (order.customer && order.customer.shipTo) return order.customer.shipTo;
      return null;
    },

    // Patch top-level fields on a stored order (status, tracking, carrier, etc.).
    // Returns the updated order or null if not found.
    // When `factoryStatus` is in the patch, the seller-facing sync map is updated too so the
    // seller's order table reflects the change without depending on which factory role made it.
    update: function(orderId, patch) {
      var orders = _load();
      var o = orders.find(function(x){ return x.id === orderId; });
      if (!o) return null;
      var _prevStatus = o.factoryStatus;
      Object.keys(patch || {}).forEach(function(k){ o[k] = patch[k]; });
      _save(orders);
      // Notification wiring: surface seller-facing status changes. Only fire on
      // an actual transition (not a no-op re-save) so we don't spam. Dedupe in
      // emitOrderNotif keeps a repeated shipped/flag from doubling up.
      if (patch && patch.factoryStatus && patch.factoryStatus !== _prevStatus) {
        try {
          if (patch.factoryStatus === 'shipped') {
            this.emitOrderNotif('order_shipped', o, 'Order #' + orderId + ' shipped',
              (o.carrier ? o.carrier + (o.tracking ? ' · ' + o.tracking : '') : 'Tracking assigned'));
          } else if (patch.factoryStatus === 'flagged') {
            this.emitOrderNotif('production_issue', o, 'Production issue · order #' + orderId,
              (o.flagNote || 'Flagged for review — reprint, delay or defect'));
          }
        } catch (e) {}
      }
      if (patch && patch.factoryStatus) {
        // Mirror factory status → seller code (new / review / prod / shipped / action / hold).
        var SELLER_CODE = {
          new:'new', in_review:'review', awaiting_scan:'prod', scanned:'prod',
          printing:'prod', packing:'prod', shipped:'shipped', flagged:'action',
          prescan:'prod', ready_print:'prod', in_queue:'prod',
          on_hold:'hold', hold:'hold', paused:'hold',
          backorder:'hold', oos:'hold',
          cancelled:'cancelled', refunded:'refunded',
        };
        var code = SELLER_CODE[patch.factoryStatus];
        if (code) {
          try {
            var sync = JSON.parse(localStorage.getItem('egfulfill_op_sync') || '{}');
            if (sync[orderId] !== code) {
              sync[orderId] = code;
              localStorage.setItem('egfulfill_op_sync', JSON.stringify(sync));
            }
          } catch(e) {}
        }
      }
      return o;
    },

    // Append additional line items onto an existing order. Used by the import
    // flow when the same order_number appears in the spreadsheet with items
    // that don't already exist on the order (different sku, or same sku with a
    // different design / color / size). Returns the merged item list, or null
    // if the order isn't found.
    appendOrderItems: function(orderId, items) {
      if (!orderId || !Array.isArray(items) || !items.length) return null;
      var orders = _load();
      var o = orders.find(function(x){ return x.id === orderId; });
      if (!o) return null;
      if (!Array.isArray(o.items)) o.items = [];
      items.forEach(function(it){ o.items.push(it); });
      _save(orders);
      return o.items;
    },
    // Patch fields on a single line item inside an order. Used by Design Lab to attach
    // the design file (and cache the composite preview) so operator/admin/warehouse can
    // display the file once the seller has finished designing.
    updateOrderItem: function(orderId, sku, patch) {
      var orders = _load();
      var o = orders.find(function(x){ return x.id === orderId; });
      if (!o || !Array.isArray(o.items)) return null;
      var it = o.items.find(function(x){ return x.sku === sku; });
      if (!it) return null;
      Object.keys(patch || {}).forEach(function(k){ it[k] = patch[k]; });
      _save(orders);
      return it;
    },

    // Seller calls this when submitting an order — upserts so re-push always works.
    // Pass `factoryStatus: 'draft'` to persist the order without exposing it to factory dashboards.
    // The seller's Push-to-Production button then re-submits with `factoryStatus: 'new'` to release it.
    submitOrder: function(opts) {
      var orders = _load();
      var id = opts.id || _nextId(orders);
      var now = _ts();
      var newStatus = opts.factoryStatus || 'new';
      var existing = orders.find(function(o){ return o.id === id; });
      if (existing) {
        existing.items = opts.items || existing.items;
        existing.seller = opts.seller || existing.seller;
        existing.customer = opts.customer || existing.customer;
        existing.factoryStatus = newStatus;
        existing.submittedAt = now;
        if (opts.total  !== undefined) existing.total  = opts.total;
        if (opts.profit !== undefined) existing.profit = opts.profit;
        if (existing.total  === undefined) existing.total  = _orderTotal(existing);
        if (existing.profit === undefined) existing.profit = _orderProfit(existing);
        // Carry optional shipping/source/address fields through on re-submit too.
        if (opts.salesChannel !== undefined) existing.salesChannel = opts.salesChannel;
        if (opts.service       !== undefined) existing.service       = opts.service;
        if (opts.addr          !== undefined) existing.addr          = opts.addr;
        if (opts.notes         !== undefined) existing.notes         = opts.notes;
        _save(orders);
        return existing;
      }
      var order = {
        id: id,
        seller: opts.seller || 'My Store',
        salesChannel: opts.salesChannel || '',
        customer: opts.customer || { name: 'Customer', email: '' },
        addr: opts.addr || null,
        items: opts.items || [],
        total: (opts.total !== undefined) ? opts.total : _orderTotal({ items: opts.items || [] }),
        profit: (opts.profit !== undefined) ? opts.profit : _orderProfit({ items: opts.items || [], total: opts.total }),
        service: opts.service || '',
        notes: opts.notes || '',
        submittedAt: now,
        gates: { admin: null, operator: null, warehouse: null },
        gateNotes: { admin: '', operator: '', warehouse: '' },
        factoryStatus: newStatus,
        timeline: [{ status: newStatus === 'draft' ? 'drafted' : 'submitted', at: now, label: newStatus === 'draft' ? 'Saved as draft' : 'Submitted to factory' }],
        tracking: null,
        carrier: null,
      };
      orders.unshift(order);
      _save(orders);
      // Notification wiring: a freshly-submitted (non-draft) order raises a
      // "New order received" notification for the seller. Drafts stay silent.
      if (newStatus !== 'draft') {
        try {
          var _cust = (order.customer && order.customer.name) || order.customer || 'a customer';
          this.emitOrderNotif('new_order', order, 'New order #' + id,
            (typeof _cust === 'string' ? _cust : 'New order') + ' · ' + ((order.items && order.items.length) || 0) + ' item' + (((order.items && order.items.length) || 0) === 1 ? '' : 's'));
        } catch (e) {}
      }
      return order;
    },

    // Factory role approves their gate (admin | operator | warehouse)
    approveGate: function(orderId, role, notes) {
      var orders = _load();
      var order = orders.find(function(o){ return o.id === orderId; });
      if (!order) return null;
      order.gates[role] = true;
      order.gateNotes[role] = notes || '';
      order.timeline.push({ status: 'gate_'+role, at: _ts(), label: role.charAt(0).toUpperCase()+role.slice(1)+' approved' });
      // All 3 gates done → advance to in_queue
      if (order.gates.admin && order.gates.operator && order.gates.warehouse) {
        order.factoryStatus = 'in_queue';
        order.timeline.push({ status: 'in_queue', at: _ts(), label: 'All checks passed — queued for print' });
      }
      _save(orders);
      return order;
    },

    // Factory role rejects/flags their gate
    rejectGate: function(orderId, role, notes) {
      var orders = _load();
      var order = orders.find(function(o){ return o.id === orderId; });
      if (!order) return null;
      order.gates[role] = false;
      order.gateNotes[role] = notes || '';
      order.factoryStatus = 'flagged';
      order.timeline.push({ status: 'flagged', at: _ts(), label: role+' flagged: '+(notes||'needs attention') });
      _save(orders);
      return order;
    },

    // Operator advances production stage
    advanceStatus: function(orderId, newStatus) {
      var orders = _load();
      var order = orders.find(function(o){ return o.id === orderId; });
      if (!order) return null;
      order.factoryStatus = newStatus;
      var labels = { in_review:'In review', printing:'Printing started', packing:'Packing', shipped:'Shipped' };
      order.timeline.push({ status: newStatus, at: _ts(), label: labels[newStatus] || newStatus });
      if (newStatus === 'shipped') {
        order.tracking = 'USPS' + Math.floor(Math.random()*9000000000+1000000000);
        order.carrier = 'USPS Priority';
      }
      _save(orders);
      return order;
    },

    // Append a single timeline event to an order from anywhere (seller-side,
    // factory boards, admin actions). Events are stored on order.timeline as
    // { ts, at, label, sub, role } so any consumer can render them in chronological
    // order without caring which dashboard wrote them.
    appendOrderTimeline: function(orderId, ev) {
      if (!orderId || !ev) return null;
      var orders = _load();
      var order = orders.find(function(o){ return o.id === orderId; });
      if (!order) return null;
      if (!Array.isArray(order.timeline)) order.timeline = [];
      var now = _ts();
      var rec = {
        ts: ev.ts || ev.at || now,
        at: ev.at || ev.ts || now,
        label: ev.label || '—',
        sub: ev.sub || '',
        role: ev.role || 'system',
        status: ev.status || ''
      };
      if (ev.internal) rec.internal = true;
      order.timeline.push(rec);
      _save(orders);
      return order;
    },

    // Record a refund (admin action). The order stays in its current status but
    // gets a "Refunded" event with the amount + reason. Mark order.refunded so
    // the UI can badge it.
    recordRefund: function(orderId, amount, reason) {
      var orders = _load();
      var order = orders.find(function(o){ return o.id === orderId; });
      if (!order) return null;
      order.refunded = { amount: amount, reason: reason || '', at: _ts() };
      if (!Array.isArray(order.timeline)) order.timeline = [];
      order.timeline.push({
        ts: _ts(), at: _ts(), status: 'refunded',
        label: 'Refund issued — $' + Number(amount||0).toFixed(2),
        sub: reason || 'No reason provided',
        role: 'admin'
      });
      _save(orders);
      return order;
    },

    // Record a replacement (admin action). The original order is flagged
    // `replaced: true` with a pointer to the new order, and gets a timeline
    // event. Caller typically follows up with addOrder() for the new shipment.
    recordReplacement: function(orderId, newOrderId, reason) {
      var orders = _load();
      var order = orders.find(function(o){ return o.id === orderId; });
      if (!order) return null;
      order.replaced = { newOrderId: newOrderId, reason: reason || '', at: _ts() };
      if (!Array.isArray(order.timeline)) order.timeline = [];
      order.timeline.push({
        ts: _ts(), at: _ts(), status: 'replaced',
        label: 'Replacement issued',
        sub: 'New order ' + (newOrderId||'—') + (reason ? ' · ' + reason : ''),
        role: 'admin'
      });
      _save(orders);
      return order;
    },

    // ── Factory wallet (shared by admin + warehouse) ─────────────────────
    // Holds the money sellers paid when they pushed orders to production.
    // Admin / warehouse both see the same balance via the header pill and
    // the Balance & Payments page. Operator never sees it. Cancellations
    // and refunds debit this balance and credit the seller's eg_balance.
    FACTORY_BALANCE_KEY: 'eg_factory_balance',
    FACTORY_LEDGER_KEY:  'eg_factory_ledger',
    getFactoryBalance: function() {
      try { return parseFloat(localStorage.getItem(this.FACTORY_BALANCE_KEY) || '0') || 0; }
      catch(e) { return 0; }
    },
    getFactoryLedger: function() {
      try { return JSON.parse(localStorage.getItem(this.FACTORY_LEDGER_KEY) || '[]') || []; }
      catch(e) { return []; }
    },
    _appendFactoryLedger: function(entry) {
      var l = this.getFactoryLedger();
      l.unshift(entry);
      if (l.length > 500) l.length = 500;
      try { localStorage.setItem(this.FACTORY_LEDGER_KEY, JSON.stringify(l)); } catch(e){}
    },
    // Credit the factory wallet when the seller pays for an order. De-dupes
    // by orderId so re-pushing the same order doesn't double-credit.
    creditFactoryFromSeller: function(amount, opts) {
      var amt = parseFloat(amount) || 0;
      if (amt <= 0) return this.getFactoryBalance();
      opts = opts || {};
      var ledger = this.getFactoryLedger();
      if (opts.orderId) {
        var dup = ledger.find(function(e){ return e.type==='charge' && e.orderId===opts.orderId; });
        if (dup) return this.getFactoryBalance();
      }
      var bal = parseFloat((this.getFactoryBalance() + amt).toFixed(2));
      try { localStorage.setItem(this.FACTORY_BALANCE_KEY, bal.toFixed(2)); } catch(e){}
      this._appendFactoryLedger({
        type: 'charge', amount: amt, ts: _ts(),
        orderId: opts.orderId || null, label: opts.label || 'Seller payment', by: opts.by || 'system'
      });
      try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('eg-factory-balance-changed')); } catch(e){}
      return bal;
    },
    // Refund money from factory back to seller. Partial or full. Returns
    // { ok:true, factoryBal, sellerBal } so callers can update UI.
    refundToSeller: function(orderId, amount, opts) {
      var amt = parseFloat(amount) || 0;
      if (amt <= 0) return { ok:false, error:'Amount must be > 0' };
      opts = opts || {};
      var factoryBal = this.getFactoryBalance();
      if (amt > factoryBal) return { ok:false, error:'Factory wallet only has $' + factoryBal.toFixed(2) };
      // Debit factory
      var newFactory = parseFloat((factoryBal - amt).toFixed(2));
      try { localStorage.setItem(this.FACTORY_BALANCE_KEY, newFactory.toFixed(2)); } catch(e){}
      this._appendFactoryLedger({
        type: opts.reason === 'cancellation' ? 'cancellation' : 'refund',
        amount: amt, ts: _ts(),
        orderId: orderId || null,
        label: opts.label || (opts.reason === 'cancellation' ? 'Order cancelled' : 'Refund to seller'),
        partial: !!opts.partial,
        by: opts.by || 'admin'
      });
      // Credit seller — read fresh, write back, verify.
      var sellerBal = parseFloat(localStorage.getItem('eg_balance') || '0') || 0;
      var newSeller = parseFloat((sellerBal + amt).toFixed(2));
      try { localStorage.setItem('eg_balance', newSeller.toFixed(2)); } catch(e){}
      try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('eg-factory-balance-changed')); } catch(e){}
      // Mirror to order timeline so all boards (and seller) see it.
      if (orderId && this.appendOrderTimeline) {
        this.appendOrderTimeline(orderId, {
          label: opts.reason === 'cancellation' ? 'Order cancelled — refunded' : (opts.partial ? 'Partial refund issued' : 'Refund issued'),
          sub: '$' + amt.toFixed(2) + ' returned to seller wallet' + (opts.note ? ' · ' + opts.note : ''),
          role: opts.by || 'admin'
        });
      }
      return { ok:true, factoryBal: newFactory, sellerBal: newSeller, amount: amt };
    },

    // Admin-triggered manual adjustment to a seller's wallet. amount > 0 adds
    // to seller (and debits factory if available), amount < 0 subtracts from
    // seller (and credits factory). Reason is required for the audit trail.
    adminAdjustSellerBalance: function(amount, opts) {
      var amt = parseFloat(amount) || 0;
      if (amt === 0) return { ok:false, error:'Amount must be non-zero' };
      opts = opts || {};
      var sellerBal = parseFloat(localStorage.getItem('eg_balance') || '0') || 0;
      var newSeller = parseFloat((sellerBal + amt).toFixed(2));
      if (newSeller < 0) return { ok:false, error:'Adjustment would leave seller balance negative ($' + newSeller.toFixed(2) + ')' };
      try { localStorage.setItem('eg_balance', newSeller.toFixed(2)); } catch(e){}
      // Mirror into factory ledger so admin can audit.
      var factoryBal = this.getFactoryBalance();
      var newFactory = parseFloat((factoryBal - amt).toFixed(2));
      if (newFactory < 0) newFactory = 0;
      try { localStorage.setItem(this.FACTORY_BALANCE_KEY, newFactory.toFixed(2)); } catch(e){}
      this._appendFactoryLedger({
        type: 'manual-adjust', amount: amt, ts: _ts(),
        orderId: null,
        label: (amt > 0 ? 'Admin credit to seller' : 'Admin debit from seller'),
        note: opts.note || '', by: opts.by || 'admin',
        seller: opts.seller || ''
      });
      try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('eg-factory-balance-changed')); } catch(e){}
      return { ok:true, sellerBal: newSeller, factoryBal: newFactory, amount: amt };
    },

    // ── Auto-fulfillment config (seller side) ────────────────────────────
    // When a platform order syncs in, this config decides whether to push it
    // to production automatically. Read by the simulator on settings.html and
    // by any future webhook handler. Persisted as `eg_auto_fulfill`.
    AUTO_FULFILL_KEY: 'eg_auto_fulfill',
    AUTO_FULFILL_DEFAULTS: { enabled:false, skipReview:true, balanceGate:true, platformOnly:false, delayMin:15, defaultBlank:'', defaultPrint:'DTG' },
    getAutoFulfillConfig: function() {
      try {
        var raw = JSON.parse(localStorage.getItem(this.AUTO_FULFILL_KEY) || '{}');
        return Object.assign({}, this.AUTO_FULFILL_DEFAULTS, raw || {});
      } catch(e) { return Object.assign({}, this.AUTO_FULFILL_DEFAULTS); }
    },
    setAutoFulfillConfig: function(cfg) {
      var merged = Object.assign({}, this.getAutoFulfillConfig(), cfg || {});
      try { localStorage.setItem(this.AUTO_FULFILL_KEY, JSON.stringify(merged)); } catch(e){}
      return merged;
    },

    // ── Designer wallet ──────────────────────────────────────────────────
    // Single source of truth for the designer's payable balance + ledger of
    // earnings. Used by admin's "Approve" flow to auto-pay the designer fee
    // for a card, and by designer.html / design-board.html to display the
    // balance and history.
    DESIGNER_BALANCE_KEY: 'eg_designer_balance',
    DESIGNER_LEDGER_KEY: 'eg_designer_ledger',
    DESIGNER_FEE_RATE_KEY: 'eg_designer_fee_rate',
    DESIGNER_DEFAULT_FEE: 2.5,
    // Global per-card designer fee. Admin sets it once in Settings → Production
    // and every udbApprove auto-credits this exact amount, removing the need
    // to type a fee on each card.
    getDesignerFeeRate: function() {
      try {
        var v = localStorage.getItem(this.DESIGNER_FEE_RATE_KEY);
        if (v == null || v === '') return this.DESIGNER_DEFAULT_FEE;
        var n = parseFloat(v);
        return isNaN(n) ? this.DESIGNER_DEFAULT_FEE : n;
      } catch(e) { return this.DESIGNER_DEFAULT_FEE; }
    },
    setDesignerFeeRate: function(v) {
      var n = parseFloat(v);
      if (isNaN(n) || n < 0) n = 0;
      try { localStorage.setItem(this.DESIGNER_FEE_RATE_KEY, n.toString()); } catch(e){}
      return n;
    },
    getDesignerBalance: function() {
      try { return parseFloat(localStorage.getItem(this.DESIGNER_BALANCE_KEY) || '0') || 0; }
      catch(e) { return 0; }
    },
    getDesignerLedger: function() {
      try { return JSON.parse(localStorage.getItem(this.DESIGNER_LEDGER_KEY) || '[]') || []; }
      catch(e) { return []; }
    },
    // Credit the designer for a card (e.g. on admin approve). Returns the
    // new balance. De-duped by cardId so re-clicking Approve doesn't double-pay.
    addDesignerEarning: function(amount, opts) {
      var amt = parseFloat(amount) || 0;
      if (amt <= 0) return this.getDesignerBalance();
      opts = opts || {};
      var ledger = this.getDesignerLedger();
      if (opts.cardId != null) {
        var already = ledger.find(function(e){ return e.type === 'earning' && e.cardId === opts.cardId; });
        if (already) return this.getDesignerBalance();
      }
      var bal = parseFloat((this.getDesignerBalance() + amt).toFixed(2));
      try { localStorage.setItem(this.DESIGNER_BALANCE_KEY, bal.toFixed(2)); } catch(e){}
      ledger.unshift({
        type: 'earning', amount: amt, ts: _ts(),
        cardId: opts.cardId || null, orderId: opts.orderId || null,
        label: opts.label || 'Design approved', by: opts.by || 'Admin'
      });
      if (ledger.length > 500) ledger.length = 500;
      try { localStorage.setItem(this.DESIGNER_LEDGER_KEY, JSON.stringify(ledger)); } catch(e){}
      try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('eg-designer-balance-changed')); } catch(e){}
      return bal;
    },
    // Debit the designer balance on a payout (e.g. PayPal release).
    releaseDesignerPayout: function(amount, opts) {
      var amt = parseFloat(amount) || 0;
      if (amt <= 0) return this.getDesignerBalance();
      opts = opts || {};
      var bal = Math.max(0, parseFloat((this.getDesignerBalance() - amt).toFixed(2)));
      try { localStorage.setItem(this.DESIGNER_BALANCE_KEY, bal.toFixed(2)); } catch(e){}
      var ledger = this.getDesignerLedger();
      ledger.unshift({
        type: 'payout', amount: amt, ts: _ts(),
        cardId: opts.cardId || null, orderId: opts.orderId || null,
        label: opts.label || 'PayPal release', by: opts.by || 'Admin'
      });
      if (ledger.length > 500) ledger.length = 500;
      try { localStorage.setItem(this.DESIGNER_LEDGER_KEY, JSON.stringify(ledger)); } catch(e){}
      try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('eg-designer-balance-changed')); } catch(e){}
      return bal;
    },

    // What label to show a seller for an order
    getSellerStatus: function(order) {
      return SELLER_STATUS[order.factoryStatus] || SELLER_STATUS['new'];
    },

    // Gate status summary for factory (which roles have checked)
    getGateSummary: function(order) {
      var roles = ['admin','operator','warehouse'];
      return roles.map(function(r){
        var g = order.gates[r];
        return { role: r, state: g === true ? 'approved' : g === false ? 'rejected' : 'pending' };
      });
    },

    // Helpers for rendering
    sellerBadgeHtml: function(order) {
      var s = SELLER_STATUS[order.factoryStatus] || SELLER_STATUS['new'];
      return '<span style="font-size:12.75px;font-weight:700;color:'+s.color+';background:'+s.bg+';padding:2px 8px;border-radius:999px">'+s.label+'</span>';
    },
    factoryBadgeHtml: function(order) {
      var cls = FACTORY_BADGE[order.factoryStatus] || 'b-new';
      var lbl = FACTORY_LABEL[order.factoryStatus] || 'New';
      return '<span class="badge '+cls+'">'+lbl+'</span>';
    },
    timeAgo: function(ts) { return _timeAgo(ts); },

    // ── Admin Review Queue injection ──────────────────────────────────────────
    // Prepends live orders into admin.html's Operator Review Queue
    renderAdminQueue: function(containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;
      var orders = _load().filter(function(o){ return o.factoryStatus === 'new' || o.factoryStatus === 'flagged'; });
      if (!orders.length) return;
      var html = orders.map(function(o) {
        var gatesHtml = ['admin','operator','warehouse'].map(function(r){
          var g = o.gates[r]; var icon = g===true?'✓':g===false?'✗':'○';
          var col = g===true?'#16a34a':g===false?'#dc2626':'#9ca3af';
          return '<span style="font-size:11.25px;color:'+col+';font-weight:700" title="'+r+'">'+icon+' '+r+'</span>';
        }).join(' ');
        var isSelf = o.gates.admin === null;
        return '<div id="eg-admin-row-'+o.id+'" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f3f3f1">'
          +'<span style="font-size:11.75px;background:#dbeafe;color:#1d4ed8;padding:2px 7px;border-radius:999px;font-weight:700;flex-shrink:0">Live</span>'
          +'<div style="flex:1;min-width:0">'
            +'<div style="font-size:13.75px;font-weight:600;color:#191918">'+o.id+' · '+o.seller+'</div>'
            +'<div style="font-size:12.25px;color:#9ca3af">'+o.items.length+' item'+(o.items.length!==1?'s':'')+' · '+_timeAgo(o.submittedAt)+'</div>'
            +'<div style="display:flex;gap:6px;margin-top:3px">'+gatesHtml+'</div>'
          +'</div>'
          +(isSelf
            ? '<button class="btn btn-dk" style="font-size:12.25px;padding:4px 10px;flex-shrink:0" onclick="EGStore.adminApprove(\''+o.id+'\')">Approve</button>'
            + '<button style="background:none;border:none;font-size:12.25px;color:#dc2626;cursor:pointer;font-family:inherit;padding:4px 6px" onclick="EGStore.adminReject(\''+o.id+'\')">Reject</button>'
            : '<span style="font-size:12.25px;color:#16a34a;font-weight:600">✓ Done</span>')
          +'</div>';
      }).join('');
      el.insertAdjacentHTML('afterbegin', html);
    },

    adminApprove: function(id) {
      var o = this.approveGate(id, 'admin', '');
      var row = document.getElementById('eg-admin-row-'+id);
      if (row) { row.style.background='#f0fdf4'; row.style.transition='background .4s'; }
      this.refreshAdminBadge();
      if (o && o.factoryStatus === 'in_queue') this._toast('✓ '+id+' moved to In Queue — all gates passed');
      else this._toast('✓ Admin approved '+id);
    },

    adminReject: function(id) {
      var reason = prompt('Reason for flagging '+id+':') || 'Needs review';
      this.rejectGate(id, 'admin', reason);
      var row = document.getElementById('eg-admin-row-'+id);
      if (row) { row.style.background='#fef2f2'; }
      this._toast('⚑ '+id+' flagged');
    },

    refreshAdminBadge: function() {
      var n = _load().filter(function(o){ return o.factoryStatus==='new'; }).length;
      var badge = document.querySelector('[data-eg-queue-badge]');
      if (badge) badge.textContent = n;
    },

    // ── Operator Incoming Orders injection ────────────────────────────────────
    renderOperatorQueue: function(tbodyId) {
      var tb = document.getElementById(tbodyId);
      if (!tb) return;
      var orders = _load().filter(function(o){ return o.factoryStatus !== 'shipped'; });
      if (!orders.length) return;
      var rows = orders.map(function(o) {
        var isNew = o.factoryStatus === 'new';
        var badge = isNew ? '<span class="badge b-new">● New</span>' : EGStore.factoryBadgeHtml(o);
        var action = isNew
          ? '<button class="btn btn-green" style="font-size:12.75px;padding:5px 10px" onclick="EGStore.operatorReceive(\''+o.id+'\')">Receive</button>'
          : '<button class="btn btn-out" style="font-size:12.75px;padding:5px 10px" onclick="EGStore.operatorAdvance(\''+o.id+'\')">Advance →</button>';
        return '<tr id="eg-op-row-'+o.id+'" style="background:#f0f9ff">'
          +'<td><span style="font-weight:600;color:#1d4ed8">'+o.id+'</span> <span style="font-size:11.25px;background:#dbeafe;color:#1d4ed8;padding:1px 5px;border-radius:4px;font-weight:600">Live</span></td>'
          +'<td style="font-size:13.25px;color:#6b7280">'+o.seller+'</td>'
          +'<td>'+o.items.length+' item'+(o.items.length!==1?'s':'')+'</td>'
          +'<td>'+badge+'</td>'
          +'<td style="font-size:13.25px;color:#9ca3af">'+_timeAgo(o.submittedAt)+'</td>'
          +'<td>'+action+'</td>'
          +'</tr>';
      }).join('');
      tb.insertAdjacentHTML('afterbegin', rows);
    },

    operatorReceive: function(id) {
      var o = this.approveGate(id, 'operator', '');
      var row = document.getElementById('eg-op-row-'+id);
      if (row) {
        row.querySelector('td:nth-child(4)').innerHTML = EGStore.factoryBadgeHtml(o);
        row.querySelector('td:nth-child(6)').innerHTML = '<button class="btn btn-out" style="font-size:12.75px;padding:5px 10px" onclick="EGStore.operatorAdvance(\''+id+'\')">Advance →</button>';
      }
      this._toast('✓ Operator received '+id+(o&&o.factoryStatus==='in_queue'?' — all gates done, queued!':''));
    },

    operatorAdvance: function(id) {
      var orders = _load();
      var o = orders.find(function(x){ return x.id===id; });
      if (!o) return;
      var seq = ['in_review','printing','packing','shipped'];
      var idx = seq.indexOf(o.factoryStatus);
      var next = idx >= 0 && idx < seq.length-1 ? seq[idx+1] : null;
      if (!next) { this._toast(id+' already shipped'); return; }
      this.advanceStatus(id, next);
      var row = document.getElementById('eg-op-row-'+id);
      var updated = _load().find(function(x){ return x.id===id; });
      if (row && updated) {
        row.querySelector('td:nth-child(4)').innerHTML = EGStore.factoryBadgeHtml(updated);
        if (next === 'shipped') row.querySelector('td:nth-child(6)').innerHTML = '<span style="font-size:12.75px;color:#16a34a;font-weight:600">✓ Shipped</span>';
      }
      this._toast('→ '+id+' advanced to '+next.replace('_',' '));
    },

    // ── Warehouse Orders injection ─────────────────────────────────────────────
    renderWarehouseQueue: function(tbodyId) {
      var tb = document.getElementById(tbodyId);
      if (!tb) return;
      var orders = _load();
      if (!orders.length) return;
      var apiSrc = '<div style="font-size:12.25px;color:#c4c2be;font-weight:400;margin-top:2px">via API</div>';
      var rows = orders.map(function(o) {
        var badge = EGStore.factoryBadgeHtml(o);
        var cnt = o.items.length;
        return '<tr id="eg-wh-row-'+o.id+'" style="cursor:pointer">'
          +'<td onclick="event.stopPropagation()" style="width:32px"><input type="checkbox" style="accent-color:#111827"/></td>'
          +'<td><div style="font-size:14.25px;font-weight:700;color:#191918">#'+o.id+'</div></td>'
          +'<td><div style="font-size:13.75px;color:#374151">'+o.seller+'</div>'+apiSrc+'</td>'
          +'<td><span style="font-size:13.75px;font-weight:600;color:#191918">'+cnt+'</span><span style="font-size:12.75px;color:#9ca3af;margin-left:4px">'+( cnt===1?'item':'items')+'</span></td>'
          +'<td>'+badge+'</td>'
          +'<td style="font-size:13.25px;color:#9ca3af">—</td>'
          +'<td style="font-size:13.25px;color:#9ca3af">'+_timeAgo(o.submittedAt)+'</td>'
          +'<td style="font-size:13.25px;color:#9ca3af">—</td>'
          +'<td style="font-size:13.25px;color:#9ca3af">—</td>'
          +'<td></td>'
          +'</tr>';
      }).join('');
      tb.insertAdjacentHTML('afterbegin', rows);
    },

    warehouseApprove: function(id) {
      var o = this.approveGate(id, 'warehouse', '');
      var row = document.getElementById('eg-wh-row-'+id);
      if (row) row.querySelector('td:nth-child(5)').innerHTML = EGStore.factoryBadgeHtml(o);
      this._toast('✓ Warehouse updated status for '+id);
    },

    // ── Fulfillment (seller view) injection ───────────────────────────────────
    renderFulfillmentQueue: function(tbodyId) {
      var tb = document.getElementById(tbodyId);
      if (!tb) return;
      var orders = _load();
      if (!orders.length) return;
      var rows = orders.map(function(o) {
        var s = SELLER_STATUS[o.factoryStatus] || SELLER_STATUS['new'];
        var badge = '<span style="font-size:12.25px;font-weight:700;color:'+s.color+';background:'+s.bg+';padding:2px 8px;border-radius:999px">'+s.label+'</span>';
        var product = o.items.length ? o.items[0].name || 'Custom Order' : 'Custom Order';
        if (o.items.length > 1) product += ' +' + (o.items.length-1) + ' more';
        return '<tr style="background:#f0fdf4">'
          +'<td style="font-weight:600;color:#15803d">'+o.id+'</td>'
          +'<td>'+product+'</td>'
          +'<td>'+o.items.length+'</td>'
          +'<td>'+badge+'</td>'
          +'<td style="font-size:13.25px;color:#6b7280">—</td>'
          +'<td><span style="font-size:11.25px;background:#dcfce7;color:#15803d;padding:1px 5px;border-radius:4px;font-weight:600">Live</span></td>'
          +'</tr>';
      }).join('');
      tb.insertAdjacentHTML('afterbegin', rows);
    },

    // ── Orders page (seller) injection ────────────────────────────────────────
    // Matches orders.html 14-column dtable: check,num,platid,orderid,customer,
    // items,delivery,status,source,store,total,created,tracking,actions
    renderSellerOrders: function(tbodyId) {
      var tb = document.getElementById(tbodyId);
      if (!tb) return;
      var orders = _load();
      if (!orders.length) return;
      var rows = orders.map(function(o, idx) {
        var s = SELLER_STATUS[o.factoryStatus] || SELLER_STATUS['new'];
        var badge = '<span style="display:inline-flex;align-items:center;gap:4px;font-size:12.75px;font-weight:700;color:'+s.color+';background:'+s.bg+';padding:2px 8px;border-radius:999px">'+s.label+'</span>';
        var trackHtml = o.tracking
          ? '<span style="font-family:monospace;font-size:12.75px;color:#374151">'+o.tracking+'</span>'
          : '<span style="color:#d1d5db">—</span>';
        var created = o.submittedAt ? new Date(o.submittedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—';
        var liveTag = '<span style="font-size:11.25px;background:#dcfce7;color:#15803d;padding:1px 5px;border-radius:4px;font-weight:600;margin-left:4px">Live</span>';
        return '<tr id="eg-seller-row-'+o.id+'" class="main-row" style="background:#f0fdf4">'
          +'<td style="padding:10px 6px;text-align:center"><input type="checkbox" style="width:14px;height:14px;cursor:pointer;accent-color:#111827"/></td>'
          +'<td><div style="font-family:monospace;font-size:13.25px;font-weight:700;color:#15803d"><a href="order-detail.html?id='+o.id+'" style="color:#15803d;text-decoration:none">'+o.id+'</a>'+liveTag+'</div><div style="font-family:monospace;font-size:11.75px;color:#9ca3af;margin-top:2px">—</div></td>'
          +'<td><span style="font-weight:500;color:#191918">'+o.customer.name+'</span></td>'
          +'<td><span style="display:flex;align-items:center;gap:4px;color:#374151"><strong>'+o.items.length+'</strong><span style="color:#9ca3af;font-size:13.25px">item'+(o.items.length!==1?'s':'')+'</span></span></td>'
          +'<td style="font-size:13.75px;color:#374151">Standard</td>'
          +'<td style="overflow:visible">'+badge+'</td>'
          +'<td style="font-size:13.75px;color:#374151">EGFulfill</td>'
          +'<td style="font-size:13.75px;color:#6b7280">'+o.seller+'</td>'
          +'<td style="font-weight:600;color:#9ca3af">—</td>'
          +'<td style="font-size:13.25px;color:#6b7280">'+created+'</td>'
          +'<td style="font-size:13.25px;color:#6b7280">'+(o.submittedAt ? (function(iso){var d=new Date(iso),h=d.getHours(),m=d.getMinutes(),ap=h>=12?'PM':'AM',hh=h%12||12,mm=('0'+m).slice(-2);return hh+':'+mm+' '+ap;})( o.submittedAt) : '—')+'</td>'
          +'<td>'+trackHtml+'</td>'
          +'<td style="overflow:visible;white-space:nowrap">'
            +'<a href="order-detail.html?id='+o.id+'" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:12.75px;font-weight:600;color:#374151;background:#fff;border:1.5px solid #e5e4e0;text-decoration:none;white-space:nowrap">View Details →</a>'
          +'</td>'
          +'</tr>';
      }).join('');
      tb.insertAdjacentHTML('afterbegin', rows);
    },

    // Dev helper — full reset. Wipes every eg_* / egfulfill_* key (orders, design cards,
    // pushes, specs, scan history, shipments, etc.) and also sets `eg_hide_seed` so the
    // seller's hardcoded demo orders (const ORDERS in orders.html) are skipped on next load.
    // UI prefs (theme/lang/balance/sidebar order) are preserved.
    clearAll: function(opts) {
      // Theme + language are user UI prefs — keep them. Balance is treated
      // as test data and reset to 0 alongside orders / chats / templates so
      // a fresh-test pass starts from a known empty state.
      var preserve = { eg_theme:1, eg_lang:1 };
      // Anything starting with eg_nav_order_ is a sidebar drag order — keep it
      var killed = 0;
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (preserve[k]) continue;
        if (k.indexOf('eg_nav_order_') === 0) continue;
        if (k.indexOf('eg_') === 0 || k.indexOf('egfulfill_') === 0) {
          localStorage.removeItem(k);
          killed++;
        }
      }
      // Hide the JS-seeded demo orders too so the seller table starts empty
      localStorage.setItem('eg_hide_seed', '1');
      console.log('[EGStore.clearAll] removed ' + killed + ' keys, hiding seed orders. Reloading…');
      if (!(opts && opts.silent)) alert('Cleared ' + killed + ' eg_* keys. Demo seed orders hidden. Page reloading.');
      setTimeout(function(){ location.reload(); }, opts && opts.silent ? 100 : 0);
    },
    // Inverse: bring the demo seed orders back (clears the hide flag).
    showSeed: function() {
      localStorage.removeItem('eg_hide_seed');
      location.reload();
    },

    _toast: function(msg) {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;font-size:14.25px;font-weight:600;padding:10px 18px;border-radius:10px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.25);font-family:Inter,sans-serif;white-space:nowrap;pointer-events:none';
      document.body.appendChild(t);
      setTimeout(function(){ t.style.opacity='0';t.style.transition='opacity .4s'; }, 2200);
      setTimeout(function(){ t.remove(); }, 2700);
    },

    // ── Shared file-preview modal (used by admin/warehouse expanded item rows) ──
    // opts: { orderNum, sku, itemName, qty, file, onPush: function(boardId, { title, notes }){...} }
    // Renders a modal with Design Title + Notes for designer + Send button (board chosen via inline select).
    _filePreviewCtx: null,
    showFilePreview: function(opts) {
      this._filePreviewCtx = opts;
      var modal = document.getElementById('eg-file-preview-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'eg-file-preview-modal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:1000;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-family:Inter,sans-serif';
        modal.addEventListener('click', function(e) { if (e.target === modal) EGStore.closeFilePreview(); });
        modal.innerHTML =
          '<div style="background:#fff;border-radius:14px;width:680px;max-width:calc(100vw - 32px);max-height:calc(100vh - 48px);box-shadow:0 24px 60px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden">' +
            '<div style="padding:14px 18px;border-bottom:1px solid #f3f3f1;display:flex;align-items:center;justify-content:space-between">' +
              '<div><div id="eg-fp-title" style="font-size:15.25px;font-weight:700;color:#191918"></div><div id="eg-fp-sub" style="font-size:12.75px;color:#9ca3af;margin-top:2px"></div></div>' +
              '<button onclick="EGStore.closeFilePreview()" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:23.25px;line-height:1;padding:4px 9px;border-radius:6px;font-family:inherit" onmouseover="this.style.color=\'#191918\';this.style.background=\'#f6f5f4\'" onmouseout="this.style.color=\'#9ca3af\';this.style.background=\'none\'">×</button>' +
            '</div>' +
            '<div style="padding:16px 18px;background:#fafaf9;display:flex;flex-direction:row;gap:14px;align-items:stretch;flex:1;overflow:auto">' +
              '<div style="flex-shrink:0;width:290px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #e8e7e3;border-radius:10px;padding:10px">' +
                '<img id="eg-fp-img" src="" style="max-width:100%;max-height:100%;display:block;border-radius:6px;object-fit:contain">' +
              '</div>' +
              '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">' +
                '<div>' +
                  '<div style="font-size:11.25px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Design ID</div>' +
                  '<div id="eg-fp-design-id" style="font-family:monospace;font-size:14.25px;font-weight:700;color:#191918;background:#f4f2ef;border:1.5px dashed #d1ceca;border-radius:6px;padding:7px 10px;letter-spacing:.04em;min-height:18px">&nbsp;</div>' +
                '</div>' +
                '<div>' +
                  '<div style="font-size:11.25px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Print Size</div>' +
                  '<div style="display:flex;align-items:center;gap:8px">' +
                    '<input id="eg-fp-size-num" type="number" min="0" step="0.5" placeholder="6" style="width:80px;font-size:13.75px;padding:6px 9px;border:1.5px solid #e5e4e0;border-radius:6px;font-family:inherit;outline:none;color:#191918;background:#fff;box-sizing:border-box">' +
                    '<span style="font-size:13.75px;color:#6b7280;font-weight:500;flex-shrink:0">inch</span>' +
                    '<select id="eg-fp-size-dir" style="flex:1;min-width:0;font-size:13.75px;padding:6px 9px;border:1.5px solid #e5e4e0;border-radius:6px;font-family:inherit;outline:none;color:#191918;background:#fff;cursor:pointer;box-sizing:border-box">' +
                      '<option value="wide">Wide</option><option value="high">High</option>' +
                    '</select>' +
                  '</div>' +
                '</div>' +
                '<div>' +
                  '<div style="font-size:11.25px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Send to Board</div>' +
                  '<select id="eg-fp-board" style="width:100%;font-size:13.75px;padding:6px 9px;border:1.5px solid #e5e4e0;border-radius:6px;font-family:inherit;outline:none;color:#191918;background:#fff;cursor:pointer;box-sizing:border-box">' +
                    '<option value="dtg">DTG Board</option><option value="sub">SUB Board</option><option value="emb">EMB Board</option><option value="scr">SCR Board</option>' +
                  '</select>' +
                '</div>' +
                '<div style="flex:1;min-height:0;display:flex;flex-direction:column">' +
                  '<div style="font-size:11.25px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Notes for designer</div>' +
                  '<textarea id="eg-fp-notes" placeholder="Bleed, placement, special requests…" style="width:100%;flex:1;min-height:120px;font-size:13.75px;padding:6px 9px;border:1.5px solid #e5e4e0;border-radius:6px;font-family:inherit;outline:none;color:#191918;background:#fff;resize:none;box-sizing:border-box"></textarea>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="padding:12px 16px;border-top:1px solid #f3f3f1;display:flex;align-items:center;justify-content:flex-end;gap:8px">' +
              '<button onclick="EGStore.closeFilePreview()" style="padding:7px 14px;border-radius:8px;border:1.5px solid #e5e4e0;background:#fff;font-size:13.75px;font-weight:600;color:#374151;cursor:pointer;font-family:inherit">Close</button>' +
              '<button id="eg-fp-push" style="padding:7px 22px;border-radius:8px;background:#191918;color:#fff;border:none;font-size:13.75px;font-weight:600;cursor:pointer;font-family:inherit">Send</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(modal);
      }
      document.getElementById('eg-fp-title').textContent = (opts.itemName || 'Design') + ' · ×' + (opts.qty || 1);
      document.getElementById('eg-fp-sub').textContent   = '#' + opts.orderNum + ' · SKU: ' + (opts.sku || '—');
      var imgEl = document.getElementById('eg-fp-img');
      var isLoadable = function(s) { return s && (String(s).startsWith('data:') || /^https?:\/\//.test(s)); };
      // Prefer raw design (no blank). Fall back to composite (blank + design) if the raw
      // wasn't cached — at least the design is still visible. Placeholder is last resort.
      imgEl.src = isLoadable(opts.file)  ? opts.file
                : isLoadable(opts.thumb) ? opts.thumb
                : 'https://placehold.co/400x400/f4f2ef/9ca3af?text=' + encodeURIComponent('Design pending\n(no file uploaded)');
      // Restore previously-saved size/notes
      try {
        var sp = JSON.parse(localStorage.getItem('eg_design_specs')||'{}');
        var rec = sp[opts.orderNum + '|' + opts.sku] || {};
        document.getElementById('eg-fp-notes').value    = rec.notes || '';
        document.getElementById('eg-fp-size-num').value = rec.sizeNum || '';
        document.getElementById('eg-fp-size-dir').value = rec.sizeDir || 'wide';
      } catch(e){}
      // If a card already exists for this order+sku, surface its assigned Design ID
      try {
        var idEl = document.getElementById('eg-fp-design-id');
        var allCards = JSON.parse(localStorage.getItem('egfulfill_design_cards')||'[]');
        var existing = allCards.find(function(c){ return String(c.order) === String(opts.orderNum) && String(c.sku||'') === String(opts.sku||''); });
        if (idEl) idEl.textContent = (existing && (existing.designId || existing.title)) || ' ';
      } catch(e){}
      // Send button state
      var pushBtn   = document.getElementById('eg-fp-push');
      var boardSel  = document.getElementById('eg-fp-board');
      var pushedRec = null;
      try { pushedRec = (JSON.parse(localStorage.getItem('eg_pushed_to_board')||'{}'))[opts.orderNum + '|' + opts.sku] || null; } catch(e){}
      if (pushedRec) {
        pushBtn.textContent = '✓ Sent to ' + pushedRec.board.toUpperCase();
        pushBtn.style.cursor = 'not-allowed'; pushBtn.disabled = true; pushBtn.onclick = null;
        pushBtn.style.background = '#e5e4e0'; pushBtn.style.color = '#9ca3af';
        boardSel.disabled = true; boardSel.value = pushedRec.board;
      } else {
        pushBtn.textContent = 'Send';
        pushBtn.style.cursor = 'pointer'; pushBtn.disabled = false;
        pushBtn.style.background = '#191918'; pushBtn.style.color = '#fff';
        boardSel.disabled = false;
        pushBtn.onclick = function() {
          var ctx = EGStore._filePreviewCtx;
          if (!ctx || !ctx.onPush) return;
          var notes = (document.getElementById('eg-fp-notes').value || '').trim();
          var board = boardSel.value || 'dtg';
          var sizeNum = (document.getElementById('eg-fp-size-num').value || '').trim();
          var sizeDir = document.getElementById('eg-fp-size-dir').value || 'wide';
          var printSize = sizeNum ? (sizeNum + '" ' + sizeDir) : '';
          // Persist so the next open recovers them; pushToDesignBoard reads printSize/notes
          // from this store and surfaces them on the design board card.
          try {
            var sp = JSON.parse(localStorage.getItem('eg_design_specs')||'{}');
            sp[ctx.orderNum + '|' + ctx.sku] = {
              notes: notes,
              sizeNum: sizeNum, sizeDir: sizeDir, printSize: printSize,
              ts: Date.now()
            };
            localStorage.setItem('eg_design_specs', JSON.stringify(sp));
          } catch(e){}
          // No title — the card will get an auto-assigned DSN-### id from pushToDesignBoard.
          ctx.onPush(board, { notes: notes, printSize: printSize });
          EGStore.closeFilePreview();
        };
      }
      modal.style.display = 'flex';
    },
    closeFilePreview: function() {
      var modal = document.getElementById('eg-file-preview-modal');
      if (modal) modal.style.display = 'none';
      this._filePreviewCtx = null;
    },

    // ── Shared scan history ──
    // One log shared across operator / warehouse / admin. Each entry is a label scan
    // recorded BEFORE production (the "scan-first" workflow).
    SCAN_HISTORY_KEY: 'eg_scan_history',
    getScanHistory: function() {
      try {
        var a = JSON.parse(localStorage.getItem(this.SCAN_HISTORY_KEY) || '[]');
        return Array.isArray(a) ? a : [];
      } catch(e) { return []; }
    },
    // entry: { order, customer, carrier, tracking, by }  — ts + id are filled in here.
    recordScan: function(entry) {
      var log = this.getScanHistory();
      var rec = {
        id: 'SCN-' + Date.now().toString(36).toUpperCase(),
        order:    entry.order || '—',
        customer: entry.customer || '—',
        carrier:  entry.carrier || '—',
        tracking: entry.tracking || '—',
        by:       entry.by || 'Operator',
        ts:       Date.now(),
      };
      log.unshift(rec);
      try { localStorage.setItem(this.SCAN_HISTORY_KEY, JSON.stringify(log)); } catch(e) {}
      return rec;
    },
    scanTimeAgo: function(ts) {
      var s = Math.floor((Date.now() - ts) / 1000);
      if (s < 60)    return 'Just now';
      if (s < 3600)  return Math.floor(s/60) + 'm ago';
      if (s < 86400) return Math.floor(s/3600) + 'h ago';
      return Math.floor(s/86400) + 'd ago';
    },

    // ── Product image lookup ──
    // Maps an item/product name to a representative product photo from the images/ folder.
    PRODUCT_IMAGES: {
      hoodie:     'images/395_fm.jpg',
      crewneck:   'images/372_fm.jpg',
      sweatshirt: 'images/372_fm.jpg',
      tote:       'images/82220_f_fm.jpg',
      bag:        'images/82220_f_fm.jpg',
      beanie:     'images/71413_f_fm.jpg',
      cap:        'images/71413_f_fm.jpg',
      hat:        'images/71413_f_fm.jpg',
      mug:        'images/121397_f_fm.jpg',
      poster:     'images/487_fm.jpg',
      canvas:     'images/487_fm.jpg',
      polo:       'images/1822_fm.jpg',
      't-shirt':  'images/tshirt-red.jpg',
      tshirt:     'images/tshirt-red.jpg',
      tee:        'images/tshirt-red.jpg',
      shirt:      'images/122267_b_fm.jpg',
    },
    productImage: function(name) {
      var n = String(name || '').toLowerCase();
      var map = this.PRODUCT_IMAGES, keys = Object.keys(map);
      for (var i = 0; i < keys.length; i++) {
        if (n.indexOf(keys[i]) !== -1) return map[keys[i]];
      }
      return 'images/122267_b_fm.jpg'; // default apparel
    },

    // ── SKU-aware image lookup ──
    // Resolves an order line's thumbnail by matching its SKU against the shared
    // product catalog (eg_catalog_products) FIRST, so a seller's own created
    // product shows its real uploaded photo. Order lines carry variant SKUs
    // (e.g. "G5000-WHT-L") while catalog products store a base SKU ("G5000"),
    // so we match exact OR base-prefix (base + "-…"). Only when no catalog
    // product matches do we fall back to the generic name-keyword image.
    imageForSku: function(sku, name) {
      var s = String(sku || '').toUpperCase().trim();
      if (s) {
        var prods = (typeof this.getCatalogProducts === 'function') ? (this.getCatalogProducts() || []) : [];
        var prefixHit = null;
        for (var i = 0; i < prods.length; i++) {
          var p = prods[i];
          if (!p) continue;
          var pImg = p.img || p.image || '';
          if (!pImg) continue;
          // Candidate SKUs: the product's base SKU plus any explicit variant SKUs.
          // Operator saves variants under `variantSkus` ([{sku,color,size}]); some
          // shapes use `variants`. Check both.
          var cands = [];
          if (p.sku) cands.push(String(p.sku).toUpperCase().trim());
          var variantArr = Array.isArray(p.variantSkus) ? p.variantSkus
                         : (Array.isArray(p.variants) ? p.variants : []);
          for (var v = 0; v < variantArr.length; v++) {
            var vr = variantArr[v];
            var vs = vr && (typeof vr === 'string' ? vr : (vr.sku || vr.SKU));
            if (vs) cands.push(String(vs).toUpperCase().trim());
          }
          for (var c = 0; c < cands.length; c++) {
            var cs = cands[c];
            if (!cs) continue;
            if (s === cs) return pImg;                              // exact variant/base match
            if (s.indexOf(cs + '-') === 0 || cs.indexOf(s + '-') === 0) prefixHit = prefixHit || pImg; // base ↔ variant
          }
        }
        if (prefixHit) return prefixHit;
      }
      return this.productImage(name || sku); // no catalog match → generic keyword image
    },

    // ── Design card lookup + download ──
    // Find the design board card for an order+sku. Two-pass lookup so a card
    // created via "+ New Card" (which only asks for Order #, leaves sku blank)
    // still matches an item on that order:
    //   1. Exact order+sku match (card created with both)
    //   2. Fallback: a card on the same order with no sku set
    //      — this covers the common case where the operator types just the
    //        order number, drops an EMB, and expects the row to pick it up
    //   3. Last resort: a card whose linked EMB file maps to this order+sku
    //      via eg_emb_files (set by udbAttachEmbToOrder when it resolves
    //      items by print-type instead of explicit SKU)
    getDesignCard: function(orderNum, sku) {
      try {
        var cards = JSON.parse(localStorage.getItem('egfulfill_design_cards') || '[]');
        if (!Array.isArray(cards)) return null;
        var exact = cards.find(function(c){
          return String(c.order) === String(orderNum) && String(c.sku||'') === String(sku||'');
        });
        if (exact) return exact;
        // Pass 2: same order, sku-less card.
        var orderOnly = cards.find(function(c){
          return String(c.order) === String(orderNum) && !c.sku;
        });
        if (orderOnly) return orderOnly;
        // Pass 3: card whose EMB file ended up on this order|sku in eg_emb_files.
        // We match the card by designId since setItemEmbFile stamps it.
        try {
          var emb = this.getItemEmbFile && this.getItemEmbFile(orderNum, sku);
          if (emb && emb.designId) {
            var byDsn = cards.find(function(c){ return c.designId === emb.designId; });
            if (byDsn) return byDsn;
          }
        } catch(_e){}
        return null;
      } catch(e) { return null; }
    },
    // A card counts as approved once it's in the approved/paid column on the design board.
    isDesignApproved: function(card) {
      return !!card && (card.col === 'approved' || card.col === 'paid');
    },
    // Trigger a browser download of the design file attached to an order+sku.
    // Priority order so clicking a Design ID always gets the *actual* file the
    // operator uploaded, not a stale preview:
    //   1. EMB / DST / PES binary  (the machine-stitching file)
    //   2. Raw design image        (cached by Design Lab's pushToProduction)
    //   3. Composite mockup        (blank + design baked into a JPEG)
    // Previously this only checked #3, so a DSN-001 link backed by a real EMB
    // would download the .jpeg composite instead of the embroidery file.
    downloadDesign: function(orderNum, sku, filename) {
      var sources = [];
      if (this.getItemEmbFile) {
        var emb = this.getItemEmbFile(orderNum, sku);
        if (emb && emb.dataUrl) sources.push({ url: emb.dataUrl, name: emb.name || ((filename || sku || 'design') + '.emb') });
      }
      if (this.getRawDesign) {
        var raw = this.getRawDesign(orderNum, sku);
        if (raw) sources.push({ url: raw, name: null });
      }
      if (this.getCachedImage) {
        var comp = this.getCachedImage(orderNum, sku);
        if (comp) sources.push({ url: comp, name: null });
      }
      if (!sources.length) { alert('No design file is attached to ' + (filename || sku || 'this item') + ' yet.'); return; }
      var pick = sources[0];
      var downloadName;
      if (pick.name) {
        downloadName = pick.name;
      } else {
        var mime = (String(pick.url).match(/^data:([^;]+)/) || [])[1] || 'image/png';
        var ext  = (mime.split('/')[1] || 'png').replace('+xml','');
        downloadName = (filename || sku || 'design') + '.' + ext;
      }
      var a = document.createElement('a');
      a.href = pick.url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },

    // ── Auto Design ID generator ──
    // Every file/design pushed to the board gets a stable DSN-### handle that
    // future orders can reference. Counter persists across sessions.
    DESIGN_ID_COUNTER_KEY: 'eg_design_id_counter',
    nextDesignId: function() {
      var n = parseInt(localStorage.getItem(this.DESIGN_ID_COUNTER_KEY) || '0', 10) + 1;
      try { localStorage.setItem(this.DESIGN_ID_COUNTER_KEY, String(n)); } catch(e){}
      return 'DSN-' + String(n).padStart(3, '0');
    },

    // ── Shared image cache ──
    // Two paired stores, both keyed by ordId|sku:
    //   • IMAGE_CACHE_KEY (composite)    — blank product + design overlay; used as the
    //     small line-item thumbnail in factory order rows.
    //   • RAW_DESIGN_KEY (raw design)    — the design alone, no blank behind it; used as
    //     the file-preview popup content and the download / push-to-board source.
    // ── Design type boards (DTG / DTF / EMB by default) ──
    // Admin can rename/add/delete/reorder these via the Manage modal. Stored in localStorage
    // so operator + warehouse + admin all render the same chip strip; storage events keep
    // everyone in sync. Each entry: { id, name, color }.
    DESIGN_TYPES_KEY: 'eg_design_types',
    _defaultDesignTypes: function() {
      return [
        { id: 'dtg', name: 'DTG', color: '#5f52b0' },
        { id: 'dtf', name: 'DTF', color: '#a05a2c' },
        { id: 'emb', name: 'EMB', color: '#286038' },
      ];
    },
    getDesignTypes: function() {
      try {
        var raw = localStorage.getItem(this.DESIGN_TYPES_KEY);
        if (!raw) return this._defaultDesignTypes();
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) return this._defaultDesignTypes();
        return parsed;
      } catch(e) { return this._defaultDesignTypes(); }
    },
    setDesignTypes: function(types) {
      if (!Array.isArray(types)) return false;
      try { localStorage.setItem(this.DESIGN_TYPES_KEY, JSON.stringify(types)); return true; }
      catch(e) { return false; }
    },

    // ── Shared product catalog ──
    // Operator's Products section writes here on every publish/edit/delete; seller-side
    // catalog pages read from here so sellers only see what the factory has actually
    // listed. Each entry mirrors OP_PRODUCTS:
    //   { id, name, sku, type, method, variants, price, status, img, fallback }
    // `status: 'Draft'` items are hidden from sellers; only 'Active' ones surface.
    CATALOG_PRODUCTS_KEY: 'eg_catalog_products',
    CATALOG_PRODUCTS_BLOB_KEY: 'eg_catalog_products_blob',
    // Split-storage save: small metadata (text fields, SKUs, variants list)
    // in CATALOG_PRODUCTS_KEY, heavy data URLs (mockup, sideMockups[*],
    // colorImages[*], extras images, img avatar) in CATALOG_PRODUCTS_BLOB_KEY
    // keyed by product id. Without this, a few products with data-URL mockups
    // (PNG/JPG base64 ~100KB each × 5 sides) push past the ~5MB ceiling and
    // setItem throws silently → seller side sees an empty catalog.
    _stripCatalogProduct: function(p) {
      if (!p) return p;
      var lite = Object.assign({}, p);
      // Build a deterministic placeholder URL (network-free path: data URI SVG)
      // so that even if the blob store is wiped (quota fallback), the seller
      // catalog still shows a sensible thumbnail instead of an empty cell.
      var label = encodeURIComponent(((p.fallback || p.name || p.type || 'Item').split(/\s+/)[0] || 'Item').slice(0, 8));
      var placeholder = 'https://placehold.co/400x400/f0ede9/6b7280?text=' + label;
      // Strip every field that can carry a data URL — replace with the placeholder
      // (img) or empty (other fields) so callers see a usable value either way.
      if (lite.mockup && String(lite.mockup).startsWith('data:')) lite.mockup = '';
      if (lite.img && String(lite.img).startsWith('data:')) lite.img = placeholder;
      if (lite.sideMockups && typeof lite.sideMockups === 'object') {
        var sm = {};
        Object.keys(lite.sideMockups).forEach(function(k){
          sm[k] = (lite.sideMockups[k] && String(lite.sideMockups[k]).startsWith('data:')) ? null : (lite.sideMockups[k] || '');
        });
        lite.sideMockups = sm;
      }
      if (lite.colorImages && typeof lite.colorImages === 'object') {
        var ci = {};
        Object.keys(lite.colorImages).forEach(function(k){
          ci[k] = (lite.colorImages[k] && String(lite.colorImages[k]).startsWith('data:')) ? null : (lite.colorImages[k] || '');
        });
        lite.colorImages = ci;
      }
      if (Array.isArray(lite.images)) {
        lite.images = lite.images.map(function(s){ return (s && String(s).startsWith('data:')) ? null : (s || ''); });
      }
      return lite;
    },
    _collectCatalogBlobs: function(products) {
      var blobs = {};
      (products || []).forEach(function(p){
        if (!p || p.id == null) return;
        var entry = {};
        if (p.mockup && String(p.mockup).startsWith('data:')) entry.mockup = p.mockup;
        if (p.img && String(p.img).startsWith('data:')) entry.img = p.img;
        if (p.sideMockups && typeof p.sideMockups === 'object') {
          var sm = {};
          Object.keys(p.sideMockups).forEach(function(k){
            if (p.sideMockups[k] && String(p.sideMockups[k]).startsWith('data:')) sm[k] = p.sideMockups[k];
          });
          if (Object.keys(sm).length) entry.sideMockups = sm;
        }
        if (p.colorImages && typeof p.colorImages === 'object') {
          var ci = {};
          Object.keys(p.colorImages).forEach(function(k){
            if (p.colorImages[k] && String(p.colorImages[k]).startsWith('data:')) ci[k] = p.colorImages[k];
          });
          if (Object.keys(ci).length) entry.colorImages = ci;
        }
        if (Array.isArray(p.images)) {
          var imgs = p.images.map(function(s, i){ return (s && String(s).startsWith('data:')) ? { i: i, src: s } : null; }).filter(Boolean);
          if (imgs.length) entry.images = imgs;
        }
        if (Object.keys(entry).length) blobs[p.id] = entry;
      });
      return blobs;
    },
    getCatalogProducts: function() {
      try {
        var raw = localStorage.getItem(this.CATALOG_PRODUCTS_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        // Rejoin the blob store so callers see complete product records.
        var blobs = {};
        try { blobs = JSON.parse(localStorage.getItem(this.CATALOG_PRODUCTS_BLOB_KEY) || '{}'); } catch(e){}
        return parsed.map(function(p){
          if (!p || p.id == null) return p;
          var b = blobs[p.id] || {};
          var merged = Object.assign({}, p);
          if (b.mockup) merged.mockup = b.mockup;
          if (b.img) merged.img = b.img;
          if (b.sideMockups) merged.sideMockups = Object.assign({}, merged.sideMockups || {}, b.sideMockups);
          if (b.colorImages) merged.colorImages = Object.assign({}, merged.colorImages || {}, b.colorImages);
          if (Array.isArray(b.images) && Array.isArray(merged.images)) {
            b.images.forEach(function(rec){ if (rec && typeof rec.i === 'number') merged.images[rec.i] = rec.src; });
          }
          // Heal legacy products saved before the placeholder strip fix —
          // a null/empty img means the blob was lost or never set; fall back
          // to a deterministic placehold.co URL so the seller catalog renders.
          if (!merged.img) {
            var label = encodeURIComponent(((merged.fallback || merged.name || merged.type || 'Item').split(/\s+/)[0] || 'Item').slice(0, 8));
            merged.img = 'https://placehold.co/400x400/f0ede9/6b7280?text=' + label;
          }
          return merged;
        });
      } catch(e) { return []; }
    },
    setCatalogProducts: function(products) {
      if (!Array.isArray(products)) return false;
      var self = this;
      var lite = products.map(function(p){ return self._stripCatalogProduct(p); });
      // 1. Metadata save — must always succeed. If quota throws, drop the
      //    blob store first (heaviest data we own) and retry.
      try { localStorage.setItem(this.CATALOG_PRODUCTS_KEY, JSON.stringify(lite)); }
      catch(e) {
        try { localStorage.removeItem(this.CATALOG_PRODUCTS_BLOB_KEY); } catch(_){}
        try { localStorage.setItem(this.CATALOG_PRODUCTS_KEY, JSON.stringify(lite)); }
        catch(e2) { console.warn('[catalog] metadata save failed', e2); return false; }
      }
      // 2. Blob save — best effort. Trim oldest entries if quota throws.
      var blobs = this._collectCatalogBlobs(products);
      var tryWrite = function(){ localStorage.setItem(self.CATALOG_PRODUCTS_BLOB_KEY, JSON.stringify(blobs)); };
      try { tryWrite(); }
      catch(e) {
        var ids = Object.keys(blobs).map(Number).sort(function(a,b){ return a - b; });
        while (ids.length > 1) {
          var oldest = ids.shift();
          delete blobs[oldest];
          try { tryWrite(); return true; } catch(_){}
        }
        try { tryWrite(); } catch(_){ try { localStorage.removeItem(self.CATALOG_PRODUCTS_BLOB_KEY); } catch(_){} }
      }
      return true;
    },

    // ── Order-bound chat ──
    // Each order has its own thread, keyed by order id. Roles: seller, operator, admin,
    // warehouse, system (for auto-emitted status-change notices). Messages survive across
    // sessions because they're persisted in localStorage; the storage event keeps every
    // open dashboard in sync.
    ORDER_CHATS_KEY: 'eg_order_chats',
    getOrderChat: function(orderId) {
      if (!orderId) return [];
      try {
        var all = JSON.parse(localStorage.getItem(this.ORDER_CHATS_KEY) || '{}');
        return Array.isArray(all[orderId]) ? all[orderId] : [];
      } catch(e) { return []; }
    },
    appendOrderChat: function(orderId, message) {
      if (!orderId || !message) return false;
      try {
        var all = JSON.parse(localStorage.getItem(this.ORDER_CHATS_KEY) || '{}');
        if (!Array.isArray(all[orderId])) all[orderId] = [];
        var entry = {
          id: 'M' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          by: message.by || 'Unknown',
          role: message.role || 'seller',
          text: message.text || '',
          ts: Date.now(),
          system: !!message.system
        };
        if (message.attachment) entry.attachment = message.attachment;
        // Internal flag for designer ↔ factory side-channel: sellers filter
        // these out in their chat view so they never see them.
        if (message.internal) entry.internal = true;
        all[orderId].push(entry);
        localStorage.setItem(this.ORDER_CHATS_KEY, JSON.stringify(all));
        return true;
      } catch(e) { return false; }
    },
    INVENTORY_KEY: 'eg_inventory',
    // Shared inventory store. Each row: { sku, name, variant, inStock, reserved,
    // reorderAt, category }. Used by operator/admin/warehouse so a stock receipt
    // in any dashboard syncs to the others (cross-tab via `storage` event).
    getInventory: function() {
      try {
        var raw = localStorage.getItem(this.INVENTORY_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch(e) { return []; }
    },
    setInventory: function(items) {
      try { localStorage.setItem(this.INVENTORY_KEY, JSON.stringify(items || [])); return true; }
      catch(e) { return false; }
    },
    // Append/upsert inventory rows. Existing SKUs keep their counts and only
    // patch missing fields. New SKUs get the supplied defaults (inStock:0 etc).
    upsertInventoryRows: function(rows) {
      if (!Array.isArray(rows) || !rows.length) return false;
      var all = this.getInventory();
      var bySku = {};
      all.forEach(function(r){ bySku[r.sku] = r; });
      rows.forEach(function(r){
        if (!r || !r.sku) return;
        if (bySku[r.sku]) {
          // Already exists — only fill in missing metadata, never overwrite counts.
          ['name','variant','reorderAt','category'].forEach(function(k){
            if ((bySku[r.sku][k] == null || bySku[r.sku][k] === '') && r[k] != null) bySku[r.sku][k] = r[k];
          });
        } else {
          all.push({
            sku: r.sku,
            name: r.name || '',
            variant: r.variant || '',
            inStock: r.inStock || 0,
            reserved: r.reserved || 0,
            reorderAt: r.reorderAt != null ? r.reorderAt : 25,
            category: r.category || 'Apparel'
          });
        }
      });
      return this.setInventory(all);
    },
    // Add to an existing SKU's on-hand quantity (used when a PO arrives or
    // Add Stock runs). Returns true if the SKU was found, false otherwise.
    addStock: function(sku, qty) {
      if (!sku || !qty) return false;
      var all = this.getInventory();
      var row = all.find(function(r){ return r.sku === sku; });
      if (!row) return false;
      row.inStock = (row.inStock || 0) + (parseInt(qty,10) || 0);
      return this.setInventory(all);
    },

    // ───────── Backorders + Purchase Orders ─────────
    // When a design is pushed and its SKU isn't stocked (or is short), we file a
    // backorder here. Every factory dashboard (operator/warehouse/admin) reads these
    // so the Purchases section stays in sync — cross-tab via the native `storage`
    // event, same-tab via the `eg-purchases-changed` event we fire on write.
    BACKORDER_KEY: 'eg_backorders',
    PO_KEY: 'eg_purchase_orders',
    _emitPurchases: function(){ try { window.dispatchEvent(new Event('eg-purchases-changed')); } catch(e){} },
    getBackorders: function() {
      try { var r = localStorage.getItem(this.BACKORDER_KEY); return r ? JSON.parse(r) : []; }
      catch(e) { return []; }
    },
    setBackorders: function(list) {
      try { localStorage.setItem(this.BACKORDER_KEY, JSON.stringify(list || [])); this._emitPurchases(); return true; }
      catch(e) { return false; }
    },
    getPurchaseOrders: function() {
      try { var r = localStorage.getItem(this.PO_KEY); return r ? JSON.parse(r) : []; }
      catch(e) { return []; }
    },
    setPurchaseOrders: function(list) {
      try { localStorage.setItem(this.PO_KEY, JSON.stringify(list || [])); this._emitPurchases(); return true; }
      catch(e) { return false; }
    },
    addPurchaseOrder: function(po) {
      if (!po) return false;
      var all = this.getPurchaseOrders();
      if (po.num && all.some(function(p){ return p.num === po.num; })) return true; // de-dupe by PO number
      all.unshift(po);
      return this.setPurchaseOrders(all);
    },
    // Append a backorder. De-duped by ordId|sku so re-pushing the same design line
    // doesn't stack duplicates. Returns true on success.
    addBackorder: function(entry) {
      if (!entry || !entry.sku) return false;
      var all = this.getBackorders();
      var key = (entry.ordId || '') + '|' + entry.sku;
      if (all.some(function(b){ return ((b.ordId||'') + '|' + (b.items && b.items[0] && b.items[0].sku)) === key; })) return true;
      var placed = entry.placed || new Date().toLocaleDateString('en-US', { month:'short', day:'numeric' });
      all.unshift({
        id: 'BO' + Date.now() + '-' + Math.random().toString(36).slice(2,5),
        num: entry.num || entry.ordId || '', ordId: entry.ordId || '',
        customer: entry.customer || '—', store: entry.store || 'My Store',
        carrier: entry.carrier || '—', placed: placed,
        items: [{
          sku: entry.sku, style: entry.style || entry.sku,
          name: entry.name || entry.sku, variant: entry.variant || '',
          qty: entry.qty || 1, stock: entry.stock || 0,
          need: entry.need != null ? entry.need : (entry.qty || 1),
          price: entry.price || 0
        }],
        source: 'design-upload', ts: Date.now()
      });
      return this.setBackorders(all);
    },
    // Drop a SKU from every open backorder (e.g. once it's been ordered on a PO).
    removeBackorderSku: function(sku) {
      var all = this.getBackorders();
      all.forEach(function(b){ b.items = (b.items || []).filter(function(i){ return i.sku !== sku; }); });
      all = all.filter(function(b){ return (b.items || []).length; });
      return this.setBackorders(all);
    },
    // Wipe all backorders + purchase orders (the "clear the purchase order" action).
    clearPurchases: function() { this.setBackorders([]); this.setPurchaseOrders([]); return true; },
    // Called by Design Lab after a design is attached to an order line. Looks the SKU
    // up in shared inventory; if it isn't stocked (or is short of the order qty) it
    // files a backorder so the SKU surfaces in the factory Purchases queue. Returns
    // true when a backorder was filed.
    reportDesignPush: function(ordId, sku) {
      if (!ordId || !sku) return false;
      var order = _load().find(function(o){ return o.id === ordId; });
      if (!order) return false;
      var items = Array.isArray(order.items) ? order.items : [];
      var item = items.find(function(i){ return i.sku === sku; }) || { sku: sku, qty: 1 };
      var qty = parseInt(item.qty, 10) || 1;
      var inv = this.getInventory();
      var invRow = inv.find(function(r){ return r.sku === sku; });
      // Order items carry a print-method suffix (e.g. -EMB) that variant
      // inventory rows don't — retry against the stripped variant SKU so a
      // stocked product isn't mistaken for an unstocked one.
      if (!invRow) { var _b = String(sku||'').replace(/-(EMB|DTG|DTF|APL|LSR|SUB|SCR)$/i,''); if (_b !== sku) invRow = inv.find(function(r){ return r.sku === _b; }); }
      var stock = invRow ? (parseInt(invRow.inStock, 10) || 0) : 0;
      // Only backorder a SKU we can actually see in inventory AND that is short.
      // No inventory row → we can't prove it's out of stock, so we don't file
      // a backorder (prevents stocked products from being flagged on receive).
      if (!invRow || stock >= qty) return false;
      var need = Math.max(qty - stock, 0) || qty;
      var custName = (order.customer && order.customer.name) || order.customer || '';
      return this.addBackorder({
        ordId: order.id, num: order.id,
        customer: typeof custName === 'string' ? custName : '',
        store: order.seller || (order.customer && order.customer.store) || 'My Store',
        sku: sku, name: item.name || sku, variant: item.variant || '',
        qty: qty, stock: stock, need: need, price: item.price || 0
      });
    },
    getOrderChatUnreadCount: function() {
      // Total messages across all orders — used as a notification dot.
      try {
        var all = JSON.parse(localStorage.getItem(this.ORDER_CHATS_KEY) || '{}');
        var n = 0;
        Object.keys(all).forEach(function(k){ if (Array.isArray(all[k])) n += all[k].length; });
        return n;
      } catch(e) { return 0; }
    },
    // Summary of every order thread that has at least one message. Used by the
    // chat dock's "All chats" list view so seller/factory can jump between
    // conversations without leaving the dock.
    getAllOrderChatThreads: function() {
      try {
        var all = JSON.parse(localStorage.getItem(this.ORDER_CHATS_KEY) || '{}');
        var seen = this.getChatSeenMap();
        var threads = [];
        var meRole = (typeof window !== 'undefined' && window.XOC_ROLE) ? String(window.XOC_ROLE) : 'seller';
        Object.keys(all).forEach(function(orderId){
          var msgs = Array.isArray(all[orderId]) ? all[orderId] : [];
          if (!msgs.length) return;
          var last = msgs[msgs.length - 1];
          var lastSeenTs = (seen[meRole] && seen[meRole][orderId]) || 0;
          // Unread = messages newer than my last-seen timestamp AND not authored
          // by me. Sent messages are already "read" by definition.
          var unread = 0;
          for (var i = msgs.length - 1; i >= 0; i--) {
            var m = msgs[i];
            var mts = m.ts || 0;
            if (mts <= lastSeenTs) break;
            var mRole = m.role || 'seller';
            if (mRole !== meRole) unread++;
          }
          threads.push({
            orderId: orderId,
            count: msgs.length,
            unread: unread,
            lastText: last.system ? ('— ' + last.text) : last.text,
            lastRole: last.role,
            lastBy: last.by,
            lastTs: last.ts || 0
          });
        });
        threads.sort(function(a,b){ return b.lastTs - a.lastTs; });
        return threads;
      } catch(e) { return []; }
    },
    // Per-role last-seen timestamps for each order thread. Used to compute
    // unread badges without losing your "read" state when other roles post.
    CHAT_SEEN_KEY: 'eg_chat_seen',
    getChatSeenMap: function() {
      try { return JSON.parse(localStorage.getItem(this.CHAT_SEEN_KEY) || '{}') || {}; }
      catch(e) { return {}; }
    },
    markChatThreadRead: function(orderId, role) {
      if (!orderId) return;
      var meRole = role || ((typeof window !== 'undefined' && window.XOC_ROLE) ? String(window.XOC_ROLE) : 'seller');
      var map = this.getChatSeenMap();
      if (!map[meRole]) map[meRole] = {};
      map[meRole][String(orderId)] = Date.now();
      try { localStorage.setItem(this.CHAT_SEEN_KEY, JSON.stringify(map)); } catch(e){}
      // Fire a synthetic storage event so other tabs / same-tab listeners pick
      // up the badge change immediately. localStorage.setItem only fires the
      // event in OTHER tabs by default.
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('eg-chat-seen-changed', { detail: { orderId: orderId, role: meRole } }));
        }
      } catch(e){}
    },
    // Convenience: returns just the count of conversations with at least one
    // unread message for the current role. Drives the FAB badge.
    getUnreadConversationCount: function(role) {
      var threads = this.getAllOrderChatThreads();
      return threads.reduce(function(n, t){ return n + (t.unread > 0 ? 1 : 0); }, 0);
    },

    // ── Product categories (operator-managed, surfaced everywhere) ──────────
    // Operator publishes products under a category. Seller catalog filters and
    // dashboards read the same list. Defaults match the original hard-coded
    // dropdown.
    PRODUCT_CATEGORIES_KEY: 'eg_product_categories',
    _defaultProductCategories: function(){ return ['Apparel','Accessories','Wall Art','Drinkware','Stickers']; },
    getProductCategories: function(){
      try {
        var raw = localStorage.getItem(this.PRODUCT_CATEGORIES_KEY);
        if (!raw) return this._defaultProductCategories();
        var arr = JSON.parse(raw);
        if (!Array.isArray(arr) || !arr.length) return this._defaultProductCategories();
        return arr;
      } catch(e){ return this._defaultProductCategories(); }
    },
    addProductCategory: function(name){
      var clean = String(name || '').trim();
      if (!clean) return false;
      var cats = this.getProductCategories();
      var has = cats.some(function(c){ return c.toLowerCase() === clean.toLowerCase(); });
      if (has) return false;
      cats.push(clean);
      try { localStorage.setItem(this.PRODUCT_CATEGORIES_KEY, JSON.stringify(cats)); } catch(e){}
      try { window.dispatchEvent(new CustomEvent('eg-categories-changed', { detail:{ name: clean } })); } catch(e){}
      return clean;
    },
    removeProductCategory: function(name){
      var clean = String(name || '').trim().toLowerCase();
      var cats = this.getProductCategories().filter(function(c){ return c.toLowerCase() !== clean; });
      try { localStorage.setItem(this.PRODUCT_CATEGORIES_KEY, JSON.stringify(cats)); } catch(e){}
      try { window.dispatchEvent(new CustomEvent('eg-categories-changed')); } catch(e){}
    },

    // ── Seller subscription plan ────────────────────────────────────────────
    // Single source of truth for which tier the seller is on. Sidebar plan
    // boxes, the billing card in Settings, and the "Upgrade to …" CTAs all
    // read from this. Changing the plan via setPlan() fires a custom event so
    // every dashboard updates without a reload.
    PLAN_KEY: 'eg_seller_plan',
    PLAN_TIERS: [
      { id:'starter',    name:'Starter',    shortName:'Starter',    monthlyPrice:0,  orderLimit:500,      orderLimitLabel:'500',       storeLimit:1,         storeLimitLabel:'1 store',         tagline:'500 orders/month · 1 store · Basic analytics',           features:'Basic analytics' },
      { id:'pro',        name:'Pro',        shortName:'Pro',        monthlyPrice:29, orderLimit:2000,     orderLimitLabel:'2,000',     storeLimit:5,         storeLimitLabel:'5 stores',        tagline:'2,000 orders/month · 5 stores · Full analytics · Priority support', features:'Full analytics · Priority support' },
      { id:'enterprise', name:'Enterprise', shortName:'Enterprise', monthlyPrice:99, orderLimit:Infinity, orderLimitLabel:'Unlimited', storeLimit:Infinity,  storeLimitLabel:'Unlimited stores', tagline:'Unlimited orders · Unlimited stores · Dedicated manager', features:'Dedicated manager' }
    ],
    getPlan: function() {
      try { return localStorage.getItem(this.PLAN_KEY) || 'starter'; }
      catch (e) { return 'starter'; }
    },
    getPlanMeta: function(planId) {
      var id = planId || this.getPlan();
      return this.PLAN_TIERS.find(function(t){ return t.id === id; }) || this.PLAN_TIERS[0];
    },
    setPlan: function(planId) {
      var valid = this.PLAN_TIERS.some(function(t){ return t.id === planId; });
      if (!valid) return false;
      try { localStorage.setItem(this.PLAN_KEY, planId); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('eg-plan-changed', { detail: { plan: planId } })); } catch (e) {}
      return true;
    },
    // Next upgrade tier ("starter" → "pro" → "enterprise" → null on top tier).
    getNextPlan: function(planId) {
      var id = planId || this.getPlan();
      var i = this.PLAN_TIERS.findIndex(function(t){ return t.id === id; });
      if (i < 0 || i >= this.PLAN_TIERS.length - 1) return null;
      return this.PLAN_TIERS[i + 1];
    },
    // Current usage for the active month. Stored separately so a test can
    // override it via localStorage. Defaults to 847 (matches the demo seed).
    getPlanUsage: function() {
      try { return parseInt(localStorage.getItem('eg_seller_orders_used') || '847', 10) || 0; }
      catch (e) { return 0; }
    },

    // ── Broadcast notifications (cross-role) ────────────────────────────────
    // Factory roles (operator / warehouse / admin) post a broadcast; every
    // role's Notifications surface picks it up. Stored as a single list under
    // `eg_broadcasts` and synced across tabs via the native `storage` event +
    // a same-tab `eg-broadcasts-changed` CustomEvent we fire on write.
    BROADCAST_KEY: 'eg_broadcasts',
    BROADCAST_LIMIT: 50,    // hard cap to keep localStorage small
    getBroadcasts: function() {
      try {
        var raw = localStorage.getItem(this.BROADCAST_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    },
    // Notification categories — the single vocabulary shared by the broadcast
    // composer, the auto order-events below, and the seller's preference toggles.
    // `bell:false` means a muted category still SHOWS in the panel but doesn't
    // raise the unread bell count (per product decision).
    NOTIF_CATEGORIES: {
      new_order:        { label: 'New order received',     prefKey: 'new_order' },
      order_shipped:    { label: 'Order shipped',          prefKey: 'order_shipped' },
      production_issue: { label: 'Production issue',        prefKey: 'production_issue' },
      billing:          { label: 'Billing alert',          prefKey: 'billing' },
      product_news:     { label: 'Product updates & news',  prefKey: 'product_news' },
      general:          { label: 'General announcement',    prefKey: 'product_news' }
    },
    addBroadcast: function(payload) {
      if (!payload || !payload.title) return null;
      var list = this.getBroadcasts();
      var cat = payload.category && this.NOTIF_CATEGORIES[payload.category] ? payload.category : 'general';
      var rec = {
        id: 'bc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        title: String(payload.title || '').trim(),
        body:  String(payload.body  || '').trim(),
        category:   cat,
        sender:     payload.sender     || 'operator',  // role id
        senderName: payload.senderName || 'Factory',
        ts: Date.now()
      };
      list.unshift(rec);
      if (list.length > this.BROADCAST_LIMIT) list.length = this.BROADCAST_LIMIT;
      try { localStorage.setItem(this.BROADCAST_KEY, JSON.stringify(list)); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('eg-broadcasts-changed', { detail: { id: rec.id } })); } catch (e) {}
      return rec;
    },

    // ── Seller notification preferences ──
    // Persisted map of { prefKey: true|false }. Missing key defaults to ON, so
    // sellers see everything until they explicitly mute a category. The seller
    // Settings toggles read/write this; the notif panel filters against it.
    NOTIF_PREFS_KEY: 'eg_notif_prefs',
    getNotifPrefs: function() {
      try { var p = JSON.parse(localStorage.getItem(this.NOTIF_PREFS_KEY) || '{}'); return (p && typeof p === 'object') ? p : {}; }
      catch (e) { return {}; }
    },
    isNotifPrefOn: function(prefKey) {
      if (!prefKey) return true;
      var p = this.getNotifPrefs();
      return p[prefKey] !== false; // default ON
    },
    setNotifPref: function(prefKey, on) {
      if (!prefKey) return false;
      var p = this.getNotifPrefs();
      p[prefKey] = !!on;
      try { localStorage.setItem(this.NOTIF_PREFS_KEY, JSON.stringify(p)); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('eg-notif-prefs-changed')); } catch (e) {}
      return true;
    },
    // True when a broadcast's category should raise the unread bell for this
    // seller. Muted categories return false (still listed, just not counted).
    notifShouldAlert: function(bc) {
      if (!bc) return true;
      var cat = this.NOTIF_CATEGORIES[bc.category];
      if (!cat) return true;
      return this.isNotifPrefOn(cat.prefKey);
    },

    // Emit a categorized seller notification. Used by the auto order-event hooks
    // (new order / shipped / production issue) so they flow through the SAME
    // broadcast store + seller panel as manual announcements. De-duped per
    // order+category so a re-save of the same order doesn't double-notify.
    emitOrderNotif: function(category, order, title, body) {
      try {
        if (!category || !this.NOTIF_CATEGORIES[category] || !order) return null;
        var oid = order.id || order.num || '';
        var dedupe = 'auto:' + category + ':' + oid;
        var list = this.getBroadcasts();
        // Skip if we already filed this exact order+category notification.
        if (list.some(function(b){ return b && b._auto === dedupe; })) return null;
        var rec = {
          id: 'bc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          title: String(title || '').trim(),
          body:  String(body  || '').trim(),
          category: category,
          sender: 'system', senderName: 'EGFULFILL',
          orderId: oid,
          _auto: dedupe,
          ts: Date.now()
        };
        list.unshift(rec);
        if (list.length > this.BROADCAST_LIMIT) list.length = this.BROADCAST_LIMIT;
        try { localStorage.setItem(this.BROADCAST_KEY, JSON.stringify(list)); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('eg-broadcasts-changed', { detail: { id: rec.id } })); } catch (e) {}
        return rec;
      } catch (e) { return null; }
    },
    // Helper for the Notifications surfaces: returns a relative time label
    // ("3m ago", "2h ago") given a numeric timestamp.
    formatBroadcastAge: function(ts) {
      var d = (Date.now() - (ts || 0)) / 1000;
      if (d < 60)       return Math.max(1, Math.floor(d)) + 's ago';
      if (d < 3600)     return Math.floor(d / 60)   + 'm ago';
      if (d < 86400)    return Math.floor(d / 3600) + 'h ago';
      if (d < 604800)   return Math.floor(d / 86400)+ 'd ago';
      return new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric' });
    },

    RAW_DESIGN_KEY: 'eg_design_raw',
    cacheRawDesign: function(orderId, sku, dataUrl) {
      if (!orderId || !sku || !dataUrl) return { ok:false, error:'Missing data' };
      try {
        var cache = JSON.parse(localStorage.getItem(this.RAW_DESIGN_KEY) || '{}');
        cache[orderId + '|' + sku] = dataUrl;
        try { localStorage.setItem(this.RAW_DESIGN_KEY, JSON.stringify(cache)); return { ok:true }; }
        catch(quotaErr) {
          // Quota hit — drop the oldest half and retry once.
          var keys = Object.keys(cache);
          for (var i = 0; i < Math.floor(keys.length/2); i++) delete cache[keys[i]];
          cache[orderId + '|' + sku] = dataUrl;
          try { localStorage.setItem(this.RAW_DESIGN_KEY, JSON.stringify(cache)); return { ok:true }; }
          catch(e2) { return { ok:false, error:'Storage full' }; }
        }
      } catch(e) { return { ok:false, error:'Save failed' }; }
    },
    getRawDesign: function(orderId, sku) {
      try {
        var cache = JSON.parse(localStorage.getItem(this.RAW_DESIGN_KEY) || '{}');
        return cache[orderId + '|' + sku] || null;
      } catch(e) { return null; }
    },
    IMAGE_CACHE_KEY: 'eg_image_cache',
    cacheImage: function(orderId, sku, dataUrl) {
      // Returns { ok: bool, error?: string }. The error is now honest about
      // its cause — it's a localStorage quota issue, not a per-file size
      // limit. Callers (processFile) downscale before calling, so this
      // should rarely fail with a properly compressed image.
      if (!orderId || !sku || !dataUrl) return { ok:false, error:'Missing image data' };
      var quotaMsg = 'Browser storage is full — clear old uploads or templates and try again.';
      try {
        var cache = JSON.parse(localStorage.getItem(this.IMAGE_CACHE_KEY) || '{}');
        cache[orderId + '|' + sku] = dataUrl;
        try { localStorage.setItem(this.IMAGE_CACHE_KEY, JSON.stringify(cache)); return { ok:true }; }
        catch(quotaErr) {
          // Quota hit — drop the oldest half and retry
          var keys = Object.keys(cache);
          for (var i = 0; i < Math.floor(keys.length/2); i++) delete cache[keys[i]];
          cache[orderId + '|' + sku] = dataUrl;
          try { localStorage.setItem(this.IMAGE_CACHE_KEY, JSON.stringify(cache)); return { ok:true }; }
          catch(e2) { return { ok:false, error: quotaMsg }; }
        }
      } catch(e) { return { ok:false, error: quotaMsg }; }
    },
    getCachedImage: function(orderId, sku) {
      try {
        var cache = JSON.parse(localStorage.getItem(this.IMAGE_CACHE_KEY) || '{}');
        return cache[orderId + '|' + sku] || null;
      } catch(e) { return null; }
    },
    // Accepts "orderId|sku" string OR (orderId, sku)
    getCachedImageByRef: function(ref) {
      if (!ref) return null;
      try {
        var cache = JSON.parse(localStorage.getItem(this.IMAGE_CACHE_KEY) || '{}');
        return cache[ref] || null;
      } catch(e) { return null; }
    },

    // ── Thread-color matching ───────────────────────────────────────────────
    // When a seller uploads a design, we sample its dominant colors and map each
    // to the nearest embroidery thread in this chart. The matched threads ride
    // along with the order so the factory knows exactly which threads to load,
    // and they're remembered per SKU so repeat orders auto-fill.
    // Factory-managed thread stock. The default ships with the app; the factory can
    // edit/add/remove threads under Settings → Threads, persisted in localStorage so
    // every dashboard (and the matcher) uses the same live list.
    DEFAULT_THREAD_PALETTE: [
      { code:'1801', name:'White',       hex:'#FFFFFF' }, { code:'1800', name:'Black',      hex:'#000000' },
      { code:'1718', name:'Grey',        hex:'#96A1A8' }, { code:'1672', name:'Old Gold',   hex:'#A67843' },
      { code:'1951', name:'Gold',        hex:'#FFCC00' }, { code:'1987', name:'Orange',     hex:'#E25C27' },
      { code:'1910', name:'Flamingo',    hex:'#CC3366' }, { code:'1839', name:'Red',        hex:'#CC3333' },
      { code:'1784', name:'Maroon',      hex:'#660000' }, { code:'1966', name:'Navy',       hex:'#333366' },
      { code:'1842', name:'Royal',       hex:'#005397' }, { code:'1695', name:'Aqua/Teal',  hex:'#3399FF' },
      { code:'1832', name:'Purple',      hex:'#6B5294' }, { code:'1751', name:'Kelly Green', hex:'#01784E' },
      { code:'1848', name:'Kiwi Green',  hex:'#7BA35A' }, { code:'1733', name:'Tan',        hex:'#C8AD7F' }
    ],
    THREAD_PALETTE_KEY: 'eg_thread_palette',
    getThreadPalette: function(){
      try {
        var raw = localStorage.getItem(this.THREAD_PALETTE_KEY);
        if (!raw) return this.DEFAULT_THREAD_PALETTE.slice();
        var arr = JSON.parse(raw);
        return (Array.isArray(arr) && arr.length) ? arr : this.DEFAULT_THREAD_PALETTE.slice();
      } catch(e){ return this.DEFAULT_THREAD_PALETTE.slice(); }
    },
    setThreadPalette: function(arr){
      if (!Array.isArray(arr)) return false;
      try { localStorage.setItem(this.THREAD_PALETTE_KEY, JSON.stringify(arr)); return true; } catch(e){ return false; }
    },
    _hexToRgb: function(hex){
      hex = String(hex||'').replace('#','');
      if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      var n = parseInt(hex, 16);
      return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
    },
    // Nearest thread to an RGB triple by squared Euclidean distance.
    nearestThread: function(r, g, b){
      var pal = this.getThreadPalette(), best = null, bestD = Infinity;
      for (var i=0;i<pal.length;i++){
        var t = pal[i], c = this._hexToRgb(t.hex);
        var d = (r-c.r)*(r-c.r) + (g-c.g)*(g-c.g) + (b-c.b)*(b-c.b);
        if (d < bestD) { bestD = d; best = t; }
      }
      return best ? { code:best.code, name:best.name, hex:best.hex } : null;
    },
    // Top-k nearest threads to an RGB triple (closest first).
    nearestThreads: function(r, g, b, k){
      k = k || 4; var self = this;
      var scored = this.getThreadPalette().map(function(t){
        var c = self._hexToRgb(t.hex);
        return { code:t.code, name:t.name, hex:t.hex, d:(r-c.r)*(r-c.r)+(g-c.g)*(g-c.g)+(b-c.b)*(b-c.b) };
      });
      scored.sort(function(x,y){ return x.d - y.d; });
      return scored.slice(0, k).map(function(s){ return { code:s.code, name:s.name, hex:s.hex }; });
    },
    // Sample a design image → dominant colors. Two-stage tightening:
    //   1. Coarser quantization (8 levels/channel) so anti-aliased edges merge
    //      into their parent color instead of forming separate buckets.
    //   2. Post-merge clusters whose centers sit within MERGE_DIST RGB distance
    //      so a single visual "purple" doesn't surface as Purple + LightPurple +
    //      midtone-grey. Edge noise + sub-threshold tails are dropped.
    _extractDominant: function(dataUrl, cb, max){
      max = max || 6;
      if (!dataUrl || typeof document === 'undefined') { cb && cb([]); return; }
      try {
        var img = new Image();
        img.onload = function(){
          var N = 48;
          var cv = document.createElement('canvas'); cv.width = N; cv.height = N;
          var ctx = cv.getContext('2d', { willReadFrequently:true });
          var data;
          try { ctx.drawImage(img, 0, 0, N, N); data = ctx.getImageData(0,0,N,N).data; }
          catch(e){ cb && cb([]); return; }
          var buckets = {}, total = 0;
          for (var i=0;i<data.length;i+=4){
            if (data[i+3] < 60) continue;             // skip near-transparent
            var r=data[i], g=data[i+1], b=data[i+2];
            // Drop near-white pixels — design backgrounds are rarely perfect white;
            // be lenient (235+) so off-white #f5f5f5-ish canvases don't survive as a colour.
            if (r > 234 && g > 234 && b > 234) continue;
            var key = (r>>5)+'_'+(g>>5)+'_'+(b>>5);   // 8 levels/channel
            var bk = buckets[key] || (buckets[key] = {c:0,r:0,g:0,b:0});
            bk.c++; bk.r+=r; bk.g+=g; bk.b+=b; total++;
          }
          if (!total) { cb && cb([]); return; }
          // Dominance gate: a 2-colour logo should surface 1-2 threads, not 6.
          // 8% min coverage drops anti-alias fringes + sub-strokes. The 96-unit
          // merge radius collapses every near-black variant into a single black,
          // every near-blue into one blue, etc.
          var MIN_PCT  = 0.08;
          var MERGE_DIST = 96;
          var minCount = Math.max(2, total * MIN_PCT);
          var hx = function(v){ return ('0'+v.toString(16)).slice(-2); };
          var cols = Object.keys(buckets).map(function(k){
            var b=buckets[k];
            return { c:b.c, r:Math.round(b.r/b.c), g:Math.round(b.g/b.c), b:Math.round(b.b/b.c) };
          }).filter(function(c){ return c.c >= minCount; });
          cols.sort(function(x,y){ return y.c - x.c; });
          // Greedy merge: walk biggest → smallest; absorb anything within MERGE_DIST.
          var merged = [];
          cols.forEach(function(c){
            for (var j=0;j<merged.length;j++){
              var m = merged[j];
              var dr=c.r-m.r, dg=c.g-m.g, db=c.b-m.b;
              if (Math.sqrt(dr*dr+dg*dg+db*db) <= MERGE_DIST) {
                // Weighted blend toward the bigger cluster
                var w = m.c + c.c;
                m.r = Math.round((m.r*m.c + c.r*c.c)/w);
                m.g = Math.round((m.g*m.c + c.g*c.c)/w);
                m.b = Math.round((m.b*m.c + c.b*c.c)/w);
                m.c = w;
                return;
              }
            }
            merged.push({ c:c.c, r:c.r, g:c.g, b:c.b });
          });
          merged.sort(function(x,y){ return y.c - x.c; });
          var out = merged.map(function(c){ return { c:c.c, r:c.r, g:c.g, b:c.b, srcHex:('#'+hx(c.r)+hx(c.g)+hx(c.b)).toUpperCase() }; });
          cb && cb(out.slice(0, max));
        };
        img.onerror = function(){ cb && cb([]); };
        img.src = dataUrl;
      } catch(e){ cb && cb([]); }
    },
    // Auto-match: each dominant color → its single nearest thread, de-duped.
    matchThreadColors: function(dataUrl, cb, max){
      var self = this;
      this._extractDominant(dataUrl, function(cols){
        var seen = {}, out = [];
        cols.forEach(function(col){ var t = self.nearestThread(col.r,col.g,col.b); if (t && !seen[t.code]) { seen[t.code]=1; out.push(t); } });
        cb && cb(out);
      }, max);
    },
    // Interactive match: each dominant color → top-k candidate threads so the seller
    // can confirm/override which in-stock thread to use. Returns [{srcHex, candidates}].
    matchThreadCandidates: function(dataUrl, cb, max, k){
      var self = this;
      this._extractDominant(dataUrl, function(cols){
        // Offer the FULL stocked palette per detected color (nearest first), so the dropdown
        // shows every thread you actually stock — not just the closest 4.
        cb && cb(cols.map(function(col){ return { srcHex: col.srcHex, candidates: self.nearestThreads(col.r,col.g,col.b, k||999) }; }));
      }, max);
    },
    // Per-order-item thread colors (keyed orderId|sku) — read by factory dashboards.
    THREAD_COLORS_KEY: 'eg_thread_colors',
    setItemThreadColors: function(orderId, sku, threads){
      try { var m = JSON.parse(localStorage.getItem(this.THREAD_COLORS_KEY) || '{}'); m[orderId+'|'+sku] = threads || []; localStorage.setItem(this.THREAD_COLORS_KEY, JSON.stringify(m)); } catch(e){}
    },
    getItemThreadColors: function(orderId, sku){
      try { var m = JSON.parse(localStorage.getItem(this.THREAD_COLORS_KEY) || '{}'); return m[orderId+'|'+sku] || []; } catch(e){ return []; }
    },
    // Per-item match state (detected color → candidate threads + chosen one) so the
    // seller's editable picker survives a page refresh.
    THREAD_MATCH_KEY: 'eg_thread_match',
    setItemThreadMatch: function(orderId, sku, rows){
      try { var m = JSON.parse(localStorage.getItem(this.THREAD_MATCH_KEY) || '{}'); m[orderId+'|'+sku] = rows || []; localStorage.setItem(this.THREAD_MATCH_KEY, JSON.stringify(m)); } catch(e){}
    },
    getItemThreadMatch: function(orderId, sku){
      try { var m = JSON.parse(localStorage.getItem(this.THREAD_MATCH_KEY) || '{}'); return m[orderId+'|'+sku] || []; } catch(e){ return []; }
    },
    // Repeat-order memory: remember the threads chosen for a SKU (and its base) so
    // a future order with the same SKU can pre-fill without re-uploading.
    THREAD_MEMORY_KEY: 'eg_thread_memory',
    rememberThreadColors: function(sku, threads){
      if (!sku || !threads || !threads.length) return;
      try {
        var m = JSON.parse(localStorage.getItem(this.THREAD_MEMORY_KEY) || '{}');
        m[String(sku).toUpperCase()] = threads;
        var base = String(sku).toUpperCase().split('-')[0];
        if (base && !m[base]) m[base] = threads;   // seed base SKU once for new variants
        localStorage.setItem(this.THREAD_MEMORY_KEY, JSON.stringify(m));
      } catch(e){}
    },
    recallThreadColors: function(sku){
      if (!sku) return [];
      try {
        var m = JSON.parse(localStorage.getItem(this.THREAD_MEMORY_KEY) || '{}');
        var s = String(sku).toUpperCase();
        return m[s] || m[s.split('-')[0]] || [];
      } catch(e){ return []; }
    },
    // Reusable Settings → Threads manager. Renders an editable list of the factory's
    // thread stock into `container` (id string or element) and wires add/edit/delete/
    // save. Shared by every factory dashboard so they all manage the one palette.
    renderThreadManager: function(container){
      var self = this;
      var el = (typeof container === 'string') ? document.getElementById(container) : container;
      if (!el) return;
      var pal = this.getThreadPalette();
      var rowsHtml = pal.map(function(t, i){
        return '<div class="egt-row" data-i="'+i+'" style="display:grid;grid-template-columns:34px 90px 1fr 110px 28px;gap:8px;align-items:center">'
          + '<label style="position:relative;width:34px;height:34px;border-radius:7px;border:1px solid '+(String(t.hex).toUpperCase()==='#FFFFFF'?'#e5e4e0':'rgba(0,0,0,.12)')+';background:'+t.hex+';cursor:pointer;display:block;overflow:hidden"><input type="color" value="'+t.hex+'" data-f="hex" style="position:absolute;inset:-4px;width:130%;height:130%;border:none;padding:0;cursor:pointer;opacity:0"/></label>'
          + '<input class="input" data-f="code" value="'+(t.code||'')+'" placeholder="Code" style="font-size:13px;font-family:monospace"/>'
          + '<input class="input" data-f="name" value="'+(t.name||'').replace(/"/g,'&quot;')+'" placeholder="Name" style="font-size:13px"/>'
          + '<input class="input" data-f="hexText" value="'+t.hex+'" placeholder="#000000" style="font-size:13px;font-family:monospace"/>'
          + '<button data-del="1" title="Remove" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:19px;line-height:1;padding:0">×</button>'
        + '</div>';
      }).join('');
      el.innerHTML = '<div id="egt-list" style="display:flex;flex-direction:column;gap:8px">'+rowsHtml+'</div>'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;gap:10px">'
          + '<button id="egt-add" class="btn btn-out" style="font-size:13px">+ Add thread</button>'
          + '<div style="display:flex;align-items:center;gap:10px"><span id="egt-saved" style="font-size:12.5px;color:#16a34a;opacity:0;transition:opacity .2s">Saved ✓</span><button id="egt-save" class="btn btn-dk" style="font-size:13px">Save threads</button></div>'
        + '</div>';
      // Keep the swatch label in sync as either the picker or the hex text changes.
      el.querySelectorAll('.egt-row').forEach(function(row){
        var picker = row.querySelector('[data-f="hex"]');
        var hexTxt = row.querySelector('[data-f="hexText"]');
        var swatch = row.querySelector('label');
        picker.addEventListener('input', function(){ hexTxt.value = picker.value.toUpperCase(); swatch.style.background = picker.value; });
        hexTxt.addEventListener('input', function(){ if (/^#?[0-9a-fA-F]{6}$/.test(hexTxt.value.trim())) { var v = hexTxt.value.trim().replace(/^#?/, '#'); picker.value = v; swatch.style.background = v; } });
        row.querySelector('[data-del]').addEventListener('click', function(){ row.remove(); });
      });
      el.querySelector('#egt-add').addEventListener('click', function(){
        self.setThreadPalette(self._egtCollect(el).concat([{ code:'', name:'', hex:'#888888' }]));
        self.renderThreadManager(el);
      });
      el.querySelector('#egt-save').addEventListener('click', function(){
        var arr = self._egtCollect(el).filter(function(t){ return t.code || t.name; });
        self.setThreadPalette(arr);
        var s = el.querySelector('#egt-saved'); if (s){ s.style.opacity = '1'; setTimeout(function(){ s.style.opacity = '0'; }, 1600); }
      });
    },
    _egtCollect: function(el){
      return [].map.call(el.querySelectorAll('.egt-row'), function(row){
        var hex = (row.querySelector('[data-f="hexText"]').value || '').trim();
        if (!/^#/.test(hex)) hex = '#' + hex;
        return { code: row.querySelector('[data-f="code"]').value.trim(), name: row.querySelector('[data-f="name"]').value.trim(), hex: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : '#888888' };
      });
    },

    // ── Universal upload validator ──────────────────────────────────────────
    // Returns { ok: bool, error: 'message' } — use BEFORE starting an upload to catch issues early.
    UPLOAD_MAX_BYTES: 5 * 1024 * 1024, // 5 MB — practical cap so files fit in browser localStorage cache
    UPLOAD_ALLOWED_TYPES: ['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp','image/gif'],
    UPLOAD_ALLOWED_EXTS: ['.png','.jpg','.jpeg','.svg','.webp','.gif','.emb','.dst','.pes','.exp','.jef','.vp3'],
    /* Embroidery machine file extensions — when one of these is uploaded as
       the design file, it's stored on the order and surfaced to the seller as
       a paid download (price set by admin in Settings → Embroidery file fee). */
    EMB_EXTS: ['.emb','.dst','.pes','.exp','.jef','.vp3'],
    isEmbroideryFile: function(name) {
      if (!name) return false;
      var lower = String(name).toLowerCase();
      return this.EMB_EXTS.some(function(e){ return lower.endsWith(e); });
    },
    /* Per-item embroidery file storage (keyed orderId|sku → { name, dataUrl, addedAt }).
       Factory boards write here when they upload an .emb file; seller order detail
       reads this to surface the gated-download link. */
    EMB_FILE_KEY: 'eg_emb_files',
    setItemEmbFile: function(orderId, sku, fileInfo) {
      try {
        var m = JSON.parse(localStorage.getItem(this.EMB_FILE_KEY) || '{}');
        m[orderId+'|'+sku] = Object.assign({ addedAt: Date.now() }, fileInfo || {});
        localStorage.setItem(this.EMB_FILE_KEY, JSON.stringify(m));
      } catch(e){}
    },
    getItemEmbFile: function(orderId, sku) {
      try { var m = JSON.parse(localStorage.getItem(this.EMB_FILE_KEY) || '{}'); return m[orderId+'|'+sku] || null; }
      catch(e){ return null; }
    },
    /* Admin-controlled price for sellers to download the embroidery file.
       Lives in localStorage so admin/settings → seller is real-time. */
    EMB_PRICE_KEY: 'eg_emb_file_price',
    getEmbFilePrice: function() {
      try {
        var v = parseFloat(localStorage.getItem(this.EMB_PRICE_KEY) || '');
        return (isNaN(v) || v < 0) ? null : v;
      } catch(e){ return null; }
    },
    setEmbFilePrice: function(price) {
      try { localStorage.setItem(this.EMB_PRICE_KEY, String(parseFloat(price) || 0)); } catch(e){}
    },
    /* Per-order purchase ledger — once a seller pays the embroidery file fee
       for a given orderId|sku, they can download freely. */
    EMB_PAID_KEY: 'eg_emb_paid',
    hasSellerPaidForEmb: function(orderId, sku) {
      try {
        var m = JSON.parse(localStorage.getItem(this.EMB_PAID_KEY) || '{}');
        return !!m[orderId+'|'+sku];
      } catch(e){ return false; }
    },
    markSellerPaidForEmb: function(orderId, sku) {
      try {
        var m = JSON.parse(localStorage.getItem(this.EMB_PAID_KEY) || '{}');
        m[orderId+'|'+sku] = { paidAt: Date.now() };
        localStorage.setItem(this.EMB_PAID_KEY, JSON.stringify(m));
      } catch(e){}
    },
    // ── Per-item factory working status ───────────────────────────────────
    // Tracks which specific items the warehouse is actively working on. The
    // warehouse sets the value; operator + admin read it to surface where
    // production is. Key shape: { "orderId|sku": "working" | "done" | "" }.
    // Fires eg-item-status-changed so other tabs/dashboards re-render.
    ITEM_FACTORY_STATUS_KEY: 'eg_item_factory_status',
    getItemFactoryStatus: function(orderId, sku) {
      try {
        var m = JSON.parse(localStorage.getItem(this.ITEM_FACTORY_STATUS_KEY) || '{}');
        return m[orderId + '|' + sku] || '';
      } catch(e) { return ''; }
    },
    setItemFactoryStatus: function(orderId, sku, status) {
      try {
        var m = JSON.parse(localStorage.getItem(this.ITEM_FACTORY_STATUS_KEY) || '{}');
        var key = orderId + '|' + sku;
        if (!status) delete m[key]; else m[key] = String(status);
        localStorage.setItem(this.ITEM_FACTORY_STATUS_KEY, JSON.stringify(m));
        try { window.dispatchEvent(new CustomEvent('eg-item-status-changed', { detail: { orderId: orderId, sku: sku, status: status || '' } })); } catch(e){}
        return true;
      } catch(e) { return false; }
    },

    // ── Plan tier overrides (admin-editable) ──────────────────────────────
    // PLAN_TIERS above remains the immutable factory default. Admin saves a
    // replacement list under this key; on next page load the EGStore IIFE at
    // the bottom of this file mutates PLAN_TIERS IN PLACE so every existing
    // caller (getPlanMeta / getNextPlan / sidebar widgets) sees the new
    // numbers without any code change at their site.
    PLAN_TIERS_OVERRIDE_KEY: 'eg_plan_tiers_override',
    setPlanTiers: function(arr) {
      if (!Array.isArray(arr) || !arr.length) return false;
      try { localStorage.setItem(this.PLAN_TIERS_OVERRIDE_KEY, JSON.stringify(arr)); } catch(e) { return false; }
      // Replace contents in-place — preserves the array reference so any
      // module that closed over PLAN_TIERS keeps seeing the latest list.
      this.PLAN_TIERS.length = 0;
      arr.forEach(function(t){ this.PLAN_TIERS.push(t); }, this);
      try { window.dispatchEvent(new CustomEvent('eg-plan-tiers-changed')); } catch(e){}
      // Also fire eg-plan-changed so plan-name labels re-render against the
      // (potentially renamed) current tier on every dashboard.
      try { window.dispatchEvent(new CustomEvent('eg-plan-changed', { detail: { plan: this.getPlan() } })); } catch(e){}
      return true;
    },
    resetPlanTiers: function() {
      try { localStorage.removeItem(this.PLAN_TIERS_OVERRIDE_KEY); } catch(e){}
      // Caller must reload to restore the original PLAN_TIERS — we don't keep
      // a deep copy of the defaults to avoid double the memory at load time.
    },

    // ── Wallet auto-topup config (admin) ──────────────────────────────────
    // Persists the rule { enabled, threshold, amount } so admin can declare
    // "when balance drops below $X, top up $Y from the default payment
    // method". The UI just persists — actual auto-charge needs the wallet
    // top-up flow on settings.html to read this on each balance change.
    WALLET_AUTOTOPUP_KEY: 'eg_wallet_autotopup',
    getWalletAutoTopup: function() {
      try {
        var raw = localStorage.getItem(this.WALLET_AUTOTOPUP_KEY);
        if (!raw) return { enabled: false, threshold: 0, amount: 0 };
        var o = JSON.parse(raw) || {};
        return { enabled: !!o.enabled, threshold: parseFloat(o.threshold) || 0, amount: parseFloat(o.amount) || 0 };
      } catch(e) { return { enabled: false, threshold: 0, amount: 0 }; }
    },
    setWalletAutoTopup: function(cfg) {
      try {
        var o = { enabled: !!(cfg && cfg.enabled), threshold: parseFloat(cfg && cfg.threshold) || 0, amount: parseFloat(cfg && cfg.amount) || 0 };
        localStorage.setItem(this.WALLET_AUTOTOPUP_KEY, JSON.stringify(o));
        try { window.dispatchEvent(new CustomEvent('eg-autotopup-changed', { detail: o })); } catch(e){}
        return true;
      } catch(e) { return false; }
    },

    // ── Admin platform settings ───────────────────────────────────────────
    // Lightweight kv-style getters/setters for global admin-controlled values
    // (default shipping fees, production capacity, storage utilities). Each
    // pair just persists a primitive to localStorage; consumers read these on
    // demand rather than holding stale in-memory copies, so a Save in Settings
    // is reflected the next time the value is read.
    DEFAULT_SHIPPING_FEE_KEY: 'eg_default_shipping_fee',
    getDefaultShippingFee: function() {
      try { var v = parseFloat(localStorage.getItem(this.DEFAULT_SHIPPING_FEE_KEY) || ''); return (isNaN(v) || v < 0) ? null : v; }
      catch(e) { return null; }
    },
    setDefaultShippingFee: function(v) {
      try { localStorage.setItem(this.DEFAULT_SHIPPING_FEE_KEY, String(parseFloat(v) || 0)); return true; } catch(e) { return false; }
    },
    DEFAULT_ADDL_ITEM_FEE_KEY: 'eg_default_addl_item_fee',
    getDefaultAdditionalItemFee: function() {
      try { var v = parseFloat(localStorage.getItem(this.DEFAULT_ADDL_ITEM_FEE_KEY) || ''); return (isNaN(v) || v < 0) ? null : v; }
      catch(e) { return null; }
    },
    setDefaultAdditionalItemFee: function(v) {
      try { localStorage.setItem(this.DEFAULT_ADDL_ITEM_FEE_KEY, String(parseFloat(v) || 0)); return true; } catch(e) { return false; }
    },
    PRODUCTION_CAPACITY_KEY: 'eg_production_capacity',
    getProductionCapacity: function() {
      try { var v = parseInt(localStorage.getItem(this.PRODUCTION_CAPACITY_KEY) || '', 10); return (isNaN(v) || v <= 0) ? null : v; }
      catch(e) { return null; }
    },
    setProductionCapacity: function(v) {
      try { localStorage.setItem(this.PRODUCTION_CAPACITY_KEY, String(parseInt(v, 10) || 0)); return true; } catch(e) { return false; }
    },
    // Storage usage gauge — rough localStorage footprint, broken out by the
    // top eg_* keys so admin can spot which key is hogging space before
    // cranking the clear-caches button.
    getStorageUsage: function() {
      var total = 0, byKey = {};
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i); if (!k) continue;
          var v = localStorage.getItem(k) || '';
          var sz = k.length + v.length; // approx UTF-16 chars
          total += sz;
          if (k.indexOf('eg_') === 0 || k.indexOf('egfulfill_') === 0) byKey[k] = sz;
        }
      } catch(e) {}
      // Browsers typically allow ~5MB per origin. Express the percent against
      // that ceiling so the gauge surfaces "70% used" before quota errors hit.
      var ceiling = 5 * 1024 * 1024; // 5MB chars
      return { totalBytes: total * 2, ceilingBytes: ceiling * 2, percent: Math.min(100, total * 2 / (ceiling * 2) * 100), byKey: byKey };
    },
    // Clears non-essential heavy blob caches — keeps metadata + user-set
    // preferences intact. Use this when storage is full and the admin needs to
    // free room without wiping demo orders / sellers / plan settings.
    CLEARABLE_CACHE_KEYS: ['eg_catalog_products_blob','eg_emb_files','eg_image_cache','eg_design_raw','eg_design_templates','eg_templates_blob'],
    clearCaches: function() {
      var cleared = 0;
      this.CLEARABLE_CACHE_KEYS.forEach(function(k){ try { localStorage.removeItem(k); cleared++; } catch(e){} });
      return cleared;
    },
    // Nuke every eg_*/egfulfill_* key. Demo reset — used by Settings → System
    // when the admin wants to start fresh. Does NOT touch theme/auth keys
    // that other origins might own.
    resetDemoData: function() {
      var keys = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && (k.indexOf('eg_') === 0 || k.indexOf('egfulfill_') === 0)) keys.push(k);
        }
      } catch(e) {}
      keys.forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} });
      return keys.length;
    },

    // ── Image downscale + method label utils ──────────────────────────────
    // Mockup/color uploads can easily be 5–10MB+ as raw data URLs; combined
    // they blow the ~5MB localStorage ceiling and the catalog blob save fails
    // silently → seller side sees the placehold.co fallback instead of the
    // actual mockup. Downscale to a max long-edge with JPEG q=0.85 before we
    // ever hand the dataUrl to the storage layer. SVGs and EMB/DST binaries
    // bypass — they're either small or non-raster.
    DOWNSCALE_MAX_EDGE: 1024,
    DOWNSCALE_JPEG_Q: 0.85,
    downscaleDataUrl: function(dataUrl, opts) {
      opts = opts || {};
      var maxEdge = opts.maxEdge || this.DOWNSCALE_MAX_EDGE;
      var q = opts.quality || this.DOWNSCALE_JPEG_Q;
      return new Promise(function(resolve){
        if (!dataUrl || typeof dataUrl !== 'string') return resolve(dataUrl);
        // Skip non-raster (SVG, EMB/DST binaries, http(s) URLs)
        if (!dataUrl.startsWith('data:image/') || dataUrl.startsWith('data:image/svg')) {
          return resolve(dataUrl);
        }
        var img = new Image();
        img.onload = function(){
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) return resolve(dataUrl);
          var scale = Math.min(1, maxEdge / Math.max(w, h));
          if (scale === 1 && dataUrl.length < 400000) return resolve(dataUrl);
          var tw = Math.round(w * scale), th = Math.round(h * scale);
          var cv = document.createElement('canvas');
          cv.width = tw; cv.height = th;
          var ctx = cv.getContext('2d');
          // Keep PNG when source is PNG with transparency hints, else JPEG.
          // Heuristic: if source is PNG and small enough already after downscale,
          // preserve PNG; otherwise emit JPEG for smaller size.
          var isPng = dataUrl.startsWith('data:image/png');
          if (!isPng) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,tw,th); }
          ctx.drawImage(img, 0, 0, tw, th);
          try {
            var out = isPng ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', q);
            // If PNG output is still huge, force-compress to JPEG.
            if (out.length > 800000) out = cv.toDataURL('image/jpeg', q);
            resolve(out);
          } catch(e) { resolve(dataUrl); }
        };
        img.onerror = function(){ resolve(dataUrl); };
        img.src = dataUrl;
      });
    },
    // Print-method label expansion. Stored abbreviations or full names both
    // map to the canonical full label. Used in product subtitles on operator
    // + seller surfaces. "DTG / Emb" → "DTG Print / Embroidery".
    METHOD_LABELS: {
      'dtg':'DTG Print','dtf':'DTF Print','emb':'Embroidery',
      'apl':'Appliqué','lsr':'Laser','sub':'Sublimation',
      'screen':'Screen Print','sp':'Screen Print'
    },
    formatMethod: function(raw) {
      if (!raw) return '';
      var self = this;
      return String(raw).split(/\s*\/\s*/).map(function(p){
        var k = p.trim().toLowerCase();
        return self.METHOD_LABELS[k] || p.trim();
      }).filter(Boolean).join(' / ');
    },

    // Raster uploads (PNG/JPG/WEBP/GIF) flow through the downscaler before
    // hitting localStorage, so the strict 5MB cap is unnecessary. Accept up
    // to 50MB — a 6000×6000 24-bit PNG is ~108MB raw but typically lands
    // 25–45MB compressed; design files at that size are common. Non-raster
    // (SVG, PDF, EMB binaries) keeps the strict 5MB cap.
    UPLOAD_MAX_BYTES_RASTER: 50 * 1024 * 1024,
    validateUpload: function(file) {
      if (!file) return { ok:false, error:'No file selected' };
      var name = (file.name||'').toLowerCase();
      var isRaster = /\.(png|jpe?g|webp|gif)$/i.test(name) || /^image\/(png|jpe?g|webp|gif)$/i.test(file.type||'');
      var cap = isRaster ? this.UPLOAD_MAX_BYTES_RASTER : this.UPLOAD_MAX_BYTES;
      if (file.size > cap) {
        return { ok:false, error:'The file is too large. Maximum file size is ' + (cap/1024/1024) + ' MB.' };
      }
      var hasValidExt = this.UPLOAD_ALLOWED_EXTS.some(function(e){ return name.endsWith(e); });
      var hasValidType = !file.type || this.UPLOAD_ALLOWED_TYPES.includes(file.type);
      if (!hasValidExt && !hasValidType) {
        return { ok:false, error:'Unsupported file type — use PNG, JPG, SVG, WEBP, or GIF' };
      }
      return { ok:true };
    },

    // ── Universal upload-error banner ───────────────────────────────────────
    // Big, prominent top-center banner — stays for ~5s, click X to dismiss.
    showUploadError: function(filename, error, opts) {
      opts = opts || {};
      var id = 'eg-upload-error';
      var el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#fff;border:1.5px solid #dc2626;border-radius:11px;padding:13px 18px 13px 16px;z-index:10000;box-shadow:0 8px 28px rgba(220,38,38,.18);font-family:Inter,sans-serif;display:none;align-items:flex-start;gap:11px;max-width:520px;min-width:320px;cursor:pointer';
        el.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;margin-top:1px"><circle cx="10" cy="10" r="9" stroke="#dc2626" stroke-width="1.7"/><path d="M10 6v4.5" stroke="#dc2626" stroke-width="1.7" stroke-linecap="round"/><circle cx="10" cy="13.5" r=".9" fill="#dc2626"/></svg><div style="flex:1;min-width:0"><div id="eg-upload-error-title" style="font-size:14.25px;font-weight:700;color:#111827;margin-bottom:2px"></div><div id="eg-upload-error-msg" style="font-size:13.75px;color:#6b7280;line-height:1.45"></div></div><div style="color:#9ca3af;font-size:19.25px;line-height:1;align-self:flex-start;padding:0 2px;font-family:inherit">×</div>';
        el.addEventListener('click', function(){ el.style.display='none'; });
        document.body.appendChild(el);
      }
      var title = filename ? ('Upload rejected · ' + filename) : 'Upload rejected';
      document.getElementById('eg-upload-error-title').textContent = title;
      document.getElementById('eg-upload-error-msg').textContent = error || 'Unknown error';
      el.style.display = 'flex';
      clearTimeout(el._tid);
      el._tid = setTimeout(function(){ el.style.display='none'; }, opts.duration || 5500);
    },

    // ── Shared: push a card to the design board (called by operator/admin/warehouse) ──
    pushToDesignBoard: function(opts) {
      // opts: { orderNum, sku, board, name, thumb, byRole }
      try {
        var pushed = JSON.parse(localStorage.getItem('eg_pushed_to_board') || '{}');
        pushed[opts.orderNum + '|' + opts.sku] = { board: opts.board, ts: Date.now() };
        localStorage.setItem('eg_pushed_to_board', JSON.stringify(pushed));
      } catch(e) {}
      try {
        var cards = JSON.parse(localStorage.getItem('egfulfill_design_cards') || '[]');
        if (!Array.isArray(cards)) cards = [];
        var nextId = cards.reduce(function(m,c){ return Math.max(m, c.id||0); }, 0) + 1;
        // Cache the design under eg_design_raw (NOT eg_image_cache — that's the composite slot
        // used by row thumbnails). Card rendering looks up eg_design_raw at display time via
        // the role-specific _thumbFor() helper, so we don't need thumb_ref on the card itself.
        var thumbRef = null;
        var placeholder = 'https://placehold.co/120x120/f4f2ef/9ca3af?text=' + encodeURIComponent((opts.board||'').toUpperCase());
        if (opts.thumb && String(opts.thumb).startsWith('data:')) {
          this.cacheRawDesign(opts.orderNum, opts.sku, opts.thumb);
        }
        // Pull any specs/notes captured in the preview modal so the designer sees them on the card
        var specs = {};
        var noteText = '';
        try {
          var spStore = JSON.parse(localStorage.getItem('eg_design_specs') || '{}');
          var rec = spStore[opts.orderNum + '|' + opts.sku];
          if (rec) {
            if (rec.printSize) specs['Print Size'] = rec.printSize;
            if (rec.dpi)       specs['DPI']        = rec.dpi;
            if (rec.colorMode) specs['Color Mode'] = rec.colorMode;
            noteText = rec.notes || '';
          }
        } catch(e){}
        // Dedup: if a card already exists for this order+sku, update its thumb/history in place
        // and KEEP its current column so any drag-to-column moves the user made aren't reset.
        var historyEntry = {
          ts: new Date().toISOString().slice(0,16).replace('T',' '),
          by: opts.byRole || 'Factory', role: (opts.byRole||'factory').toLowerCase(),
          action: 'Pushed to ' + (opts.board||'').toUpperCase() + ' board',
          detail: '#' + opts.orderNum + ' · ' + (opts.sku||'')
        };
        var existing = cards.find(function(c){
          return String(c.order) === String(opts.orderNum) && String(c.sku||'') === String(opts.sku||'');
        });
        var card;
        if (existing) {
          existing.type = (opts.board || existing.type || 'dtg').toUpperCase();
          if (thumbRef) existing.thumb_ref = thumbRef;
          if (!existing.thumb) existing.thumb = placeholder;
          if (!existing.specs) existing.specs = {};
          Object.keys(specs).forEach(function(k){ existing.specs[k] = specs[k]; });
          if (!existing.history) existing.history = [];
          existing.history.unshift(historyEntry);
          if (noteText) {
            if (!existing.notes) existing.notes = [];
            existing.notes.unshift({ author: opts.byRole || 'Factory', avatar: (opts.byRole||'F').charAt(0).toUpperCase(), text: noteText, ts: historyEntry.ts });
          }
          card = existing;
        } else {
          // New card — assign an auto Design ID and use it as the canonical title.
          var dsnId = this.nextDesignId();
          card = {
            id: nextId, col: 'incoming',
            sku: opts.sku || '',
            designId: dsnId,
            title: dsnId,
            order: opts.orderNum,
            product: opts.name || '—',
            type: (opts.board || 'dtg').toUpperCase(),
            priority: 'normal', due: '', assignee: null,
            thumb: placeholder, thumb_ref: thumbRef, // designer/operator looks up thumb_ref via getCachedImage(ref)
            specs: specs, files: [],
            notes: noteText ? [{ author: opts.byRole || 'Factory', avatar: (opts.byRole||'F').charAt(0).toUpperCase(), text: noteText, ts: historyEntry.ts }] : [],
            history: [historyEntry],
            checklist: [], payment: 0, payStatus: 'pending'
          };
          cards.push(card);
        }
        try {
          localStorage.setItem('egfulfill_design_cards', JSON.stringify(cards));
        } catch (quotaErr) {
          if (this.showUploadError) this.showUploadError('Design board', 'Local storage full — clear old cards/orders to free space');
          try {
            var p = JSON.parse(localStorage.getItem('eg_pushed_to_board') || '{}');
            delete p[opts.orderNum + '|' + opts.sku];
            localStorage.setItem('eg_pushed_to_board', JSON.stringify(p));
          } catch(e){}
          return null;
        }
        return card;
      } catch(e) { return null; }
    },

    // ── Shared: dropdown menu for picking a board, attached to body so no clipping ──
    showPushMenu: function(opts) {
      // opts: { boards: ['dtg','emb','sub','scr'], boardLabels:{dtg:'DTG',...}, boardBg:{}, boardFg:{},
      //         buttonEl, onPick: function(boardId){} }
      var menu = document.getElementById('eg-shared-push-menu');
      if (!menu) {
        menu = document.createElement('div');
        menu.id = 'eg-shared-push-menu';
        menu.style.cssText = 'display:none;position:fixed;background:#fff;border:1px solid #e5e4e0;border-radius:9px;box-shadow:0 6px 20px rgba(0,0,0,.14);z-index:10001;min-width:160px;overflow:hidden;font-family:Inter,sans-serif';
        document.body.appendChild(menu);
      }
      var boards   = opts.boards   || ['dtg','emb','sub','scr'];
      var labels   = opts.boardLabels || {dtg:'DTG',emb:'EMB',sub:'SUB',scr:'SCR'};
      var bgMap    = opts.boardBg     || {dtg:'#ede9fe',emb:'#f0fdf4',sub:'#fff7ed',scr:'#edf2f8'};
      var fgMap    = opts.boardFg     || {dtg:'#7c3aed',emb:'#15803d',sub:'#c2410c',scr:'#3a5a96'};
      var onPick   = opts.onPick      || function(){};
      menu.innerHTML = '<div style="font-size:11.25px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;padding:7px 11px 4px">Select board</div>' +
        boards.map(function(t){
          var lbl = labels[t] || t.toUpperCase();
          return '<div data-eg-board="'+t+'" style="display:flex;align-items:center;gap:7px;padding:7px 11px;cursor:pointer;font-size:13.75px;font-weight:600;color:#191918" onmouseover="this.style.background=\'#f6f5f4\'" onmouseout="this.style.background=\'\'">' +
            '<span style="width:18px;height:18px;border-radius:4px;background:'+(bgMap[t]||'#f3f4f6')+';color:'+(fgMap[t]||'#6b7280')+';font-size:9.75px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">'+lbl+'</span>'+lbl+' Board' +
          '</div>';
        }).join('');
      menu.querySelectorAll('[data-eg-board]').forEach(function(row){
        row.addEventListener('click', function(){
          var b = this.getAttribute('data-eg-board');
          menu.style.display = 'none';
          onPick(b);
        });
      });
      var rect = opts.buttonEl.getBoundingClientRect();
      var left = rect.left;
      if (left + 180 > window.innerWidth) left = window.innerWidth - 180 - 8;
      // Flip above the button when below would overflow viewport (e.g., button near bottom edge or inside modal footer)
      var menuH = 40 + (boards.length * 36);
      var top = rect.bottom + 4;
      if (top + menuH > window.innerHeight - 8) top = Math.max(8, rect.top - menuH - 4);
      menu.style.left = left + 'px';
      menu.style.top  = top + 'px';
      menu.style.display = 'block';
      setTimeout(function(){
        document.addEventListener('click', function _close(e){
          if (e.target.closest('#eg-shared-push-menu')) return;
          menu.style.display = 'none';
          document.removeEventListener('click', _close);
        });
      }, 10);
    },

    // ─── Tracking pull (TikTok Shop / Etsy / Shopify pre-made labels) ───
    // Simulates fetching a tracking number from the source marketplace.
    // Replace _fakeFetch with the real TikTok/Etsy API call when backend lands.
    // While pending: emits 'eg-tracking-loading' event so UIs can show a spinner.
    // On success: writes { tracking, trackingCarrier, trackingLabelUrl } to the order
    // via EGStore.update, which auto-broadcasts to every board polling for changes.
    pullTracking: function (orderId) {
      var self = this;
      this._trackingInflight = this._trackingInflight || {};
      if (this._trackingInflight[orderId]) return this._trackingInflight[orderId];
      try { document.dispatchEvent(new CustomEvent('eg-tracking-loading', { detail: { orderId: orderId } })); } catch(_) {}
      var promise = new Promise(function (resolve) {
        setTimeout(function () {
          // Fake tracking — TIKTOK + 12 digits + a stub label data URL
          var rand = Math.random().toString(10).slice(2, 14).padEnd(12, '0');
          var trk = 'TIKTOK' + rand;
          var labelStub = 'data:text/plain;charset=utf-8;base64,' +
            btoa('SHIPPING LABEL\nOrder: ' + orderId + '\nTracking: ' + trk + '\nCarrier: TikTok Shipping (USPS Ground Advantage)\n');
          var payload = { tracking: trk, trackingCarrier: 'TikTok Shipping', trackingLabelUrl: labelStub, trackingPulledAt: Date.now() };
          self.update(orderId, payload);
          try { document.dispatchEvent(new CustomEvent('eg-tracking-loaded', { detail: { orderId: orderId, tracking: trk } })); } catch(_) {}
          delete self._trackingInflight[orderId];
          resolve(payload);
        }, 1500);
      });
      this._trackingInflight[orderId] = promise;
      return promise;
    },

    // Helpers for UI render: returns 'pending' | 'loading' | 'loaded'
    trackingState: function (order) {
      if (!order) return 'pending';
      if (order.tracking) return 'loaded';
      if (this._trackingInflight && this._trackingInflight[order.id]) return 'loading';
      return 'pending';
    }
  };

  // Start-from-zero by default: hide the JS-baked demo orders so every dashboard's
  // stat cards + orders table begin empty and fill in as real test orders are created.
  // Run EGStore.showSeed() to bring the demo sample orders back.
  try {
    if (localStorage.getItem('eg_hide_seed') === null) localStorage.setItem('eg_hide_seed', '1');
  } catch(e) {}

  // Hydrate PLAN_TIERS from the admin override at boot — mutates the array
  // in place so existing this.PLAN_TIERS references on every dashboard pick
  // up the new tier definitions without any code change at the call site.
  try {
    var _ptRaw = localStorage.getItem(window.EGStore && window.EGStore.PLAN_TIERS_OVERRIDE_KEY || 'eg_plan_tiers_override');
    if (_ptRaw && window.EGStore && Array.isArray(window.EGStore.PLAN_TIERS)) {
      var _pt = JSON.parse(_ptRaw);
      if (Array.isArray(_pt) && _pt.length) {
        window.EGStore.PLAN_TIERS.length = 0;
        _pt.forEach(function(t){ window.EGStore.PLAN_TIERS.push(t); });
      }
    }
  } catch(e) {}
})();

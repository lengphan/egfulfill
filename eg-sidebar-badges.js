// Sidebar badge synchronizer — keeps "Orders" and "Chat" counts honest
// across every dashboard (seller + operator + warehouse + admin).
//
// Wiring contract:
//   <span data-badge="orders">…</span>   ← total open orders (anything not shipped)
//   <span data-badge="chat">…</span>     ← unread CONVERSATIONS (1 per thread,
//                                          not per message)
// Either span auto-hides when its count is 0 so an empty system shows a clean
// sidebar instead of "0".
(function () {
  'use strict';

  // Factory boards count every order (incl. the synced marketplace ones); the
  // SELLER board never shows admin/factory-synced orders, so they must be excluded
  // from its badge fallback — otherwise admin's ~500 synced orders leak in as a
  // stale "99+". Keyed on the PAGE, not the user role, because a staff account can
  // browse the seller board too (and would otherwise still see the inflated count).
  function isFactoryBoard() {
    var f = (location.pathname.split('/').pop() || '').toLowerCase();
    return ['admin.html', 'operator.html', 'warehouse.html', 'designer.html', 'factory.html'].indexOf(f) !== -1;
  }
  var SYNCED_SRC = ['etsy', 'shopify', 'tiktok', 'woocommerce', 'amazon', 'ebay'];
  function isFactorySynced(o) {
    if (!o) return false;
    if (/^etsy-/i.test(String(o.id || ''))) return true;
    return SYNCED_SRC.indexOf(String(o.source || '').toLowerCase()) !== -1;
  }

  function readOrderOpen() {
    // A page that renders its own order list (seller orders, factory boards) sets
    // window.__egOrdersBadge to the count actually shown — use it so the badge
    // matches the list exactly (was counting only OPEN orders, e.g. 3 of 4).
    if (typeof window.__egOrdersBadge === 'number') return window.__egOrdersBadge;
    try {
      if (typeof EGStore !== 'undefined' && typeof EGStore.getOrders === 'function') {
        var all = EGStore.getOrders();
        if (Array.isArray(all)) {
          if (!isFactoryBoard()) all = all.filter(function (o) { return !isFactorySynced(o); });
          return all.length;
        }
      }
      if (typeof EGStore !== 'undefined' && typeof EGStore.stats === 'function') {
        var s = EGStore.stats();
        return s && typeof s.total === 'number' ? s.total : (s && typeof s.open === 'number' ? s.open : 0);
      }
    } catch (e) {}
    return 0;
  }

  function readUnreadConvs() {
    try {
      if (typeof EGStore !== 'undefined' && typeof EGStore.getUnreadConversationCount === 'function') {
        return EGStore.getUnreadConversationCount() || 0;
      }
    } catch (e) {}
    return 0;
  }

  function paint(el, n) {
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.style.display = n > 0 ? '' : 'none';
  }

  function refresh() {
    var orders = readOrderOpen();
    var chat = readUnreadConvs();
    document.querySelectorAll('[data-badge="orders"]').forEach(function (el) { paint(el, orders); });
    document.querySelectorAll('[data-badge="chat"]').forEach(function (el) { paint(el, chat); });
  }

  if (document.readyState !== 'loading') refresh();
  else document.addEventListener('DOMContentLoaded', refresh);

  // localStorage events fire only in OTHER tabs by default; the in-tab
  // EGStore writes dispatch their own custom events that we listen for too.
  window.addEventListener('storage', function (e) {
    if (!e || e.key === null) { refresh(); return; }
    if (e.key === 'egfulfill_orders' ||
        e.key === 'eg_chat_seen' ||
        e.key === 'eg_chat_threads' ||
        e.key.indexOf('eg-chat-') === 0) refresh();
  });
  window.addEventListener('eg-orders-changed', refresh);
  window.addEventListener('eg-chat-seen-changed', refresh);
  window.addEventListener('eg-chat-changed', refresh);

  // Allow callers to force-refresh after a same-tab write that doesn't go
  // through EGStore (e.g. a direct localStorage poke).
  window.EGBadges = { refresh: refresh };
})();

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

  function readOrderOpen() {
    try {
      if (typeof EGStore !== 'undefined' && typeof EGStore.stats === 'function') {
        var s = EGStore.stats();
        return s && typeof s.open === 'number' ? s.open : 0;
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

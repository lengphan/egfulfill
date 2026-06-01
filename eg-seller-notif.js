// Seller-side notification panel — works on every seller page (orders,
// wallet, products-dash, analytics, design-lab, chat, settings, order-detail,
// product-picker, product-templates, …). Self-contained: injects the slide
// panel into the DOM on first load, populates it with broadcasts from
// EGStore, and routes clicks to chat.html's Notifications tab with a query
// param so the specific notification stays focused.
//
// Usage: <script src="eg-seller-notif.js"></script> after egfulfill-store.js.
(function () {
  'use strict';

  // ── CSS ──────────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('eg-seller-notif-css')) return;
    var s = document.createElement('style');
    s.id = 'eg-seller-notif-css';
    s.textContent = ''
      + '.notif-panel{position:fixed;top:0;right:-400px;width:380px;height:100vh;background:#fff;border-left:1px solid #e5e4e0;z-index:210;transition:right .3s cubic-bezier(.22,1,.36,1);box-shadow:-4px 0 20px rgba(0,0,0,.08);display:flex;flex-direction:column}'
      + '.notif-panel.open{right:0}'
      + '.notif-row{display:flex!important;align-items:center!important;gap:10px!important;padding:11px 16px!important;border-bottom:1px solid #f3f3f1;cursor:pointer;transition:background .15s;text-decoration:none;color:inherit}'
      + '.notif-row:hover{background:#fafaf9}'
      + '.notif-row > div:first-child{border-radius:50%!important;width:34px!important;height:34px!important;flex-shrink:0;margin-top:0!important}'
      + '.notif-row > div:nth-child(2){flex:1!important;min-width:0!important;display:flex;flex-direction:column;gap:1px;overflow:hidden}'
      + '.notif-row > div:nth-child(2) > div:first-child{font-size:13.5px;font-weight:700;color:#191918;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35}'
      + '.notif-row > div:nth-child(2) > div:nth-child(2){font-size:12.5px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35}'
      + '.notif-row > span:last-child{font-size:11.5px!important;color:#9ca3af!important;font-weight:500!important;white-space:nowrap;flex-shrink:0;align-self:center}'
      + 'html[data-theme=dark] .notif-panel{background:#1f1d1b!important;border-left-color:rgba(201,195,186,.14)!important}';
    document.head.appendChild(s);
  }

  // ── Panel skeleton ───────────────────────────────────────────────────
  function ensurePanel() {
    if (document.getElementById('notif-panel')) return;
    var wrap = document.createElement('div');
    wrap.id = 'notif-panel';
    wrap.className = 'notif-panel';
    wrap.innerHTML =
      '<div style="padding:14px 16px;border-bottom:1px solid #e8e7e4;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:14.75px;font-weight:700;color:#191918">Notifications</span>' +
          '<span id="notif-count" style="background:#eeede9;color:#6b7280;font-size:11.75px;font-weight:700;padding:2px 7px;border-radius:999px">0</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<button onclick="closeNotifPanel()" style="background:none;border:none;cursor:pointer;color:#9ca3af;padding:2px 4px;font-size:19.25px;line-height:1" title="Close">×</button>' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto" id="notif-list"></div>' +
      '<div style="padding:10px 16px;border-top:1px solid #f3f3f1;text-align:center;background:#fafaf9;flex-shrink:0">' +
        '<a href="chat.html#notifications" style="font-size:13.75px;color:#191918;font-weight:600;text-decoration:none">View all notifications →</a>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  // ── Renderer ─────────────────────────────────────────────────────────
  function buildRow(bc) {
    var time = (EGStore.formatBroadcastAge) ? EGStore.formatBroadcastAge(bc.ts) : '';
    var t = String(bc.title || '').replace(/"/g, '&quot;');
    var b = String(bc.body  || '').replace(/"/g, '&quot;');
    // Clicking a row → navigate to chat.html with the notification id so the
    // Notifications tab opens with that one focused. Inline navigation works
    // even when window.location is mid-transition.
    return '<a href="chat.html?notif=' + encodeURIComponent(bc.id) + '" class="notif-row">'
      + '<div style="background:#eeede9;display:flex;align-items:center;justify-content:center"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 4h9M2 7h7M2 10h5" stroke="#374151" stroke-width="1.3" stroke-linecap="round"/></svg></div>'
      + '<div><div>' + t.replace(/</g, '&lt;') + '</div><div>' + (b.replace(/</g, '&lt;') || ('Broadcast from ' + (bc.senderName || 'Factory'))) + '</div></div>'
      + '<span>' + time + '</span>'
      + '</a>';
  }
  function emptyState() {
    return '<div style="padding:36px 20px;text-align:center;color:#9ca3af">'
      + '<div style="font-size:13.5px;font-weight:600;color:#374151;margin-bottom:4px">No notifications yet</div>'
      + '<div style="font-size:12.5px">Broadcasts from the factory will show up here.</div>'
      + '</div>';
  }
  function rebuild() {
    ensurePanel();
    var list  = document.getElementById('notif-list');
    var count = document.getElementById('notif-count');
    if (!list) return;
    var bcs = (typeof EGStore !== 'undefined' && EGStore.getBroadcasts) ? EGStore.getBroadcasts() : [];
    // ALL broadcasts are still listed (per product decision: muted categories
    // remain visible). Only the bell COUNT excludes muted categories — those
    // the seller switched off in Settings → Notification Preferences.
    var alertCount = bcs.reduce(function(n, bc){
      var on = (typeof EGStore !== 'undefined' && EGStore.notifShouldAlert) ? EGStore.notifShouldAlert(bc) : true;
      return n + (on ? 1 : 0);
    }, 0);
    list.innerHTML = bcs.length ? bcs.map(buildRow).join('') : emptyState();
    if (count) count.textContent = alertCount;
    // Bell dot reflects the alerting (un-muted) count only.
    var dot = document.getElementById('notif-dot');
    if (dot) {
      if (alertCount) { dot.textContent = alertCount > 99 ? '99+' : String(alertCount); dot.style.display = ''; }
      else            { dot.style.display = 'none'; }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────
  window.openNotifPanel  = function () { ensurePanel(); document.getElementById('notif-panel').classList.add('open'); rebuild(); };
  window.closeNotifPanel = function () { var p = document.getElementById('notif-panel'); if (p) p.classList.remove('open'); };
  window.toggleNotifPanel = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    ensurePanel();
    var p = document.getElementById('notif-panel');
    if (p.classList.contains('open')) p.classList.remove('open');
    else { p.classList.add('open'); rebuild(); }
  };

  // ── Lifecycle ────────────────────────────────────────────────────────
  function init() { injectCSS(); ensurePanel(); rebuild(); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('storage', function (e) { if (e && (e.key === null || e.key === 'eg_broadcasts' || e.key === 'eg_notif_prefs')) rebuild(); });
  window.addEventListener('eg-broadcasts-changed', rebuild);
  window.addEventListener('eg-notif-prefs-changed', rebuild);
})();

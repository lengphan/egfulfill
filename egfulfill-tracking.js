/* egfulfill-tracking.js — shared "Pull tracking" UI helper.
   Renders the three states inline (pending / loading / loaded) and wires up
   click → EGStore.pullTracking. Use EGTracking.renderCell(order) to drop into
   a table cell, or EGTracking.renderModal(order) for a fuller block inside an
   order detail modal. All instances auto-refresh when EGStore broadcasts a
   tracking update. */
(function (global) {
  'use strict';
  if (typeof document === 'undefined' || global.EGTracking) return;

  var ICON_DOWNLOAD =
    '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><path d="M7 1v8m0 0l-3-3m3 3l3-3M2 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_PRINT =
    '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><path d="M3 5V2h8v3M3 10H2a1 1 0 01-1-1V6a1 1 0 011-1h10a1 1 0 011 1v3a1 1 0 01-1 1h-1M3 8h8v5H3z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_COPY =
    '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><rect x="3" y="3" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M5 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-1" stroke="currentColor" stroke-width="1.4"/></svg>';

  function isPullable(order) {
    // Currently only TikTok Shop orders fetch pre-made labels; expand list later.
    var src = (order && (order.source || order.src || '')).toString().toLowerCase();
    return src.indexOf('tiktok') !== -1;
  }

  function renderCell(order) {
    if (!order) return '<span style="color:#9ca3af">—</span>';
    if (order.tracking) {
      // Show the FULL tracking number — seller wanted no truncation, no print
      // icon, no copy icon. Whole cell is click-to-copy so the affordance is
      // still there (just no dedicated button). Download arrow stays only when
      // a real label file exists.
      var label = order.trackingLabelUrl || '';
      var dl = label
        ? '<a href="' + label + '" download="' + order.id + '-tracking.txt" title="Download label" onclick="event.stopPropagation()" style="color:#6b7280;display:inline-flex;align-items:center;padding:2px;border-radius:4px;flex-shrink:0" onmouseover="this.style.color=\'#191918\'" onmouseout="this.style.color=\'#6b7280\'">' + ICON_DOWNLOAD + '</a>'
        : '';
      return '<span data-eg-tracking="' + order.id + '" onclick="EGTracking.copy(\'' + order.tracking + '\',this)" title="Click to copy ' + order.tracking + '" style="display:inline-flex;align-items:center;gap:6px;font-family:monospace;font-size:12.5px;color:#374151;cursor:pointer;padding:2px 6px;border-radius:4px;transition:background .15s" onmouseover="this.style.background=\'#f3f4f6\'" onmouseout="if(!this._copied)this.style.background=\'\'">' +
             '<span>' + order.tracking + '</span>' + dl +
             '</span>';
    }
    if (!isPullable(order)) return '<span style="color:#9ca3af">—</span>';
    var state = EGStore && EGStore.trackingState ? EGStore.trackingState(order) : 'pending';
    if (state === 'loading') {
      return '<span data-eg-tracking="' + order.id + '" style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:#9ca3af"><span class="eg-spin"></span>Fetching…</span>';
    }
    return '<a data-eg-tracking="' + order.id + '" href="#" onclick="event.preventDefault();EGTracking.pull(\'' + order.id + '\')" style="font-size:12.5px;color:#191918;font-weight:600;text-decoration:none;border-bottom:1px dashed #c4c3be">Pull tracking</a>';
  }

  function renderModal(order) {
    if (!order) return '';
    if (order.tracking) {
      var label = order.trackingLabelUrl || '';
      return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div><div style="font-size:11px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Tracking</div><div style="font-family:monospace;font-size:14px;color:#191918">' + order.tracking + '</div><div style="font-size:12px;color:#6b7280;margin-top:1px">' + (order.trackingCarrier || '—') + '</div></div>' +
        '<div style="display:flex;gap:6px;margin-left:auto">' +
        (label ? '<a class="btn btn-out" href="' + label + '" download="' + order.id + '-tracking.txt" style="font-size:12.5px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px">' + ICON_DOWNLOAD + 'Download</a>' : '') +
        '<button class="btn btn-out" onclick="EGTracking.print(\'' + order.id + '\')" style="font-size:12.5px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px">' + ICON_PRINT + 'Print</button>' +
        '<button class="btn btn-out" onclick="EGTracking.copy(\'' + order.tracking + '\',this)" style="font-size:12.5px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px">' + ICON_COPY + 'Copy</button>' +
        '</div></div>';
    }
    if (!isPullable(order)) return '<div style="font-size:13px;color:#9ca3af">No tracking yet — label will appear after the order ships.</div>';
    var state = EGStore && EGStore.trackingState ? EGStore.trackingState(order) : 'pending';
    if (state === 'loading') return '<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#6b7280"><span class="eg-spin"></span>Fetching label from TikTok Shop…</div>';
    return '<button class="btn btn-dk" onclick="EGTracking.pull(\'' + order.id + '\')" style="font-size:13px;padding:7px 14px;display:inline-flex;align-items:center;gap:6px">' + ICON_DOWNLOAD + 'Pull tracking from TikTok Shop</button>';
  }

  function pull(orderId) {
    if (!global.EGStore || !global.EGStore.pullTracking) return;
    updateAllForOrder(orderId);
    global.EGStore.pullTracking(orderId).then(function () { updateAllForOrder(orderId); });
  }

  function findOrder(orderId) {
    if (global.EGStore && global.EGStore.getOrders) {
      var found = global.EGStore.getOrders().find(function (o) { return o.id === orderId; });
      if (found) return found;
    }
    // Fallback: scan in-memory factory arrays
    var arrays = ['WH_ORDERS', 'OP_ORDERS'];
    for (var i = 0; i < arrays.length; i++) {
      var arr = global[arrays[i]];
      if (Array.isArray(arr)) {
        var hit = arr.find(function (o) { return (o.id || o.num) === orderId; });
        if (hit) return Object.assign({ id: hit.num || hit.id }, hit);
      }
    }
    return null;
  }

  function updateAllForOrder(orderId) {
    var order = findOrder(orderId) || { id: orderId };
    document.querySelectorAll('[data-eg-tracking="' + orderId + '"]').forEach(function (el) {
      var wrapper = document.createElement('span');
      wrapper.innerHTML = renderCell(order);
      el.replaceWith(wrapper.firstElementChild);
    });
  }

  function copy(text, btn) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () {
      if (!btn) return;
      var orig = btn.innerHTML;
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      setTimeout(function () { btn.innerHTML = orig; }, 1200);
    });
  }

  function print(orderId) {
    var order = findOrder(orderId);
    if (!order || !order.tracking) return;
    var w = window.open('', '_blank', 'width=420,height=600');
    if (!w) return;
    w.document.write('<!doctype html><meta charset="utf-8"><title>Label · ' + orderId + '</title>' +
      '<style>body{font-family:Inter,-apple-system,sans-serif;padding:32px;color:#191918}h1{font-size:18px;margin:0 0 16px}p{margin:6px 0;font-size:14px}.t{font-family:monospace;font-size:16px;background:#f4f2ef;padding:8px 12px;border:1px solid #40403d;border-radius:6px;display:inline-block}</style>' +
      '<h1>Shipping label</h1>' +
      '<p><b>Order:</b> ' + orderId + '</p>' +
      '<p><b>Customer:</b> ' + (order.customer || order.cust || '—') + '</p>' +
      '<p><b>Carrier:</b> ' + (order.trackingCarrier || '—') + '</p>' +
      '<p><b>Tracking:</b></p><p><span class="t">' + order.tracking + '</span></p>' +
      '<script>window.onload=function(){window.print()}<' + '/script>');
    w.document.close();
  }

  // Inject the spinner CSS once
  if (!document.getElementById('eg-tracking-style')) {
    var s = document.createElement('style');
    s.id = 'eg-tracking-style';
    s.textContent = '.eg-spin{width:11px;height:11px;border:1.5px solid #d8d4cd;border-top-color:#6b7280;border-radius:50%;display:inline-block;animation:eg-spin .8s linear infinite}@keyframes eg-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  // Cross-tab refresh: when EGStore broadcasts an update, refresh any inline tracking cells.
  document.addEventListener('eg-tracking-loading', function (e) { updateAllForOrder(e.detail.orderId); });
  document.addEventListener('eg-tracking-loaded', function (e) { updateAllForOrder(e.detail.orderId); });
  window.addEventListener('storage', function (e) {
    if (e && e.key === 'egfulfill_orders') {
      document.querySelectorAll('[data-eg-tracking]').forEach(function (el) {
        updateAllForOrder(el.getAttribute('data-eg-tracking'));
      });
    }
  });

  global.EGTracking = { renderCell: renderCell, renderModal: renderModal, pull: pull, copy: copy, print: print };
})(window);

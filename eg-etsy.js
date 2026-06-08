/* eg-etsy.js — admin platform panel: real Etsy connect + sync controller.
   Connect uses EGConnect (popup → oauth-callback.html → /api/etsy/exchange).
   Reflects connection state and lets the admin pull orders + listings on demand. */
(function () {
  'use strict';
  function tok() { return localStorage.getItem('eg_token') || ''; }
  function api(path, opts) {
    opts = opts || {};
    return fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok() },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); });
  }

  // Render the Etsy row from current connections.
  window.egRefreshEtsy = function () {
    var sub = document.getElementById('etsy-substatus');
    var actions = document.getElementById('etsy-actions');
    if (!sub || !actions || !tok()) return;
    api('/etsy/connections').then(function (res) {
      if (!res.ok) return;
      var conns = res.d || [];
      if (!conns.length) {
        sub.textContent = 'Not connected';
        actions.innerHTML = '<button id="etsy-connect-btn" onclick="egConnectEtsy()" class="btn btn-out" style="font-size:12px;padding:5px 12px">Connect</button>';
        return;
      }
      var names = conns.map(function (c) { return c.shop_name || c.shop_id; }).join(', ');
      var last = conns[0].last_sync_at ? ('last sync ' + String(conns[0].last_sync_at).slice(0, 10)) : 'never synced';
      sub.innerHTML = names + ' · <span style="color:#15803d">' + last + '</span>';
      actions.innerHTML =
        '<button onclick="egSyncEtsy(this)" class="btn btn-dk" style="font-size:12px;padding:5px 12px">Sync now</button>'
        + '<button onclick="egDisconnectEtsy(\'' + conns[0].shop_id + '\')" style="background:none;border:none;font-size:12px;font-weight:600;color:#6b7280;padding:5px 8px;cursor:pointer;font-family:inherit">Disconnect</button>';
    });
  };

  window.egConnectEtsy = function () {
    if (!window.EGConnect) { alert('Connect module not loaded'); return; }
    EGConnect.start('etsy', { onComplete: function (r) { if (r && r.ok) setTimeout(egRefreshEtsy, 400); } });
  };

  // ── Sync progress modal (spinner + live elapsed → success/error state) ────────
  var _egSyncTimer = null, _egSyncStart = 0;
  function _egSyncEl() {
    var m = document.getElementById('eg-sync-modal');
    if (!m) {
      if (!document.getElementById('eg-sync-css')) { var st = document.createElement('style'); st.id = 'eg-sync-css'; st.textContent = '@keyframes egspin{to{transform:rotate(360deg)}}'; document.head.appendChild(st); }
      m = document.createElement('div'); m.id = 'eg-sync-modal';
      m.style.cssText = 'display:none;position:fixed;inset:0;z-index:10090;background:rgba(17,24,39,.5);align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif';
      document.body.appendChild(m);
    }
    return m;
  }
  function _egSyncShow() {
    var m = _egSyncEl();
    _egSyncStart = Date.now();
    m.innerHTML =
      '<div style="background:#fff;border-radius:16px;width:380px;max-width:calc(100vw - 32px);padding:30px 26px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.28)">'
      + '<div style="width:54px;height:54px;margin:0 auto 16px;border:4px solid #eee;border-top-color:#111827;border-radius:50%;animation:egspin .8s linear infinite"></div>'
      + '<div style="font-size:16px;font-weight:700;color:#191918">Syncing your Etsy orders…</div>'
      + '<div style="font-size:13px;color:#9ca3af;margin-top:5px">Importing orders, addresses & images.</div>'
      + '<div id="eg-sync-elapsed" style="font-size:12.5px;color:#c4c3be;margin-top:12px;font-variant-numeric:tabular-nums">0s elapsed</div>'
      + '</div>';
    m.style.display = 'flex';
    if (_egSyncTimer) clearInterval(_egSyncTimer);
    _egSyncTimer = setInterval(function () {
      var el = document.getElementById('eg-sync-elapsed');
      if (el) el.textContent = Math.round((Date.now() - _egSyncStart) / 1000) + 's elapsed';
    }, 500);
  }
  function _egSyncDone(ok, summaryHtml) {
    if (_egSyncTimer) { clearInterval(_egSyncTimer); _egSyncTimer = null; }
    var m = _egSyncEl();
    var icon = ok
      ? '<div style="width:54px;height:54px;margin:0 auto 14px;border-radius:50%;background:#e7f6ec;display:flex;align-items:center;justify-content:center"><svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 10-11" stroke="#15803d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>'
      : '<div style="width:54px;height:54px;margin:0 auto 14px;border-radius:50%;background:#fef2f2;display:flex;align-items:center;justify-content:center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#dc2626" stroke-width="2.4" stroke-linecap="round"/></svg></div>';
    m.innerHTML =
      '<div style="background:#fff;border-radius:16px;width:400px;max-width:calc(100vw - 32px);padding:26px;box-shadow:0 24px 64px rgba(0,0,0,.28)">'
      + icon
      + '<div style="font-size:16px;font-weight:700;color:#191918;text-align:center">' + (ok ? 'Sync complete' : 'Sync failed') + '</div>'
      + '<div style="font-size:13.5px;color:#374151;margin-top:12px;line-height:1.7">' + summaryHtml + '</div>'
      + '<button onclick="document.getElementById(\'eg-sync-modal\').style.display=\'none\'" style="margin-top:18px;width:100%;background:#191918;color:#fff;border:none;border-radius:9px;padding:11px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Done</button>'
      + '</div>';
    m.style.display = 'flex';
  }

  window.egSyncEtsy = function (btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
    _egSyncShow();
    // Manual "Sync now" = a SCOPED full sync (orders since connect + still-unshipped,
    // images only for items missing one). Safe to repeat — it can't pull the whole
    // history or re-fetch every image, so it won't blow the quota. The 5-min
    // auto-sync stays incremental.
    api('/etsy/sync', { method: 'POST', body: { full: true } }).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Sync now'; }
      if (!res.ok) { _egSyncDone(false, '<div style="text-align:center;color:#dc2626">' + ((res.d && res.d.error) || 'Unknown error') + '</div>'); return; }
      var rows = (res.d.synced || []).map(function (x) {
        if (x.error) return '<div style="display:flex;justify-content:space-between;gap:10px"><span>' + (x.shop || x.shop_id) + '</span><span style="color:#dc2626">error</span></div>';
        var extra = [];
        if (x.skipped) extra.push(x.skipped + ' old skipped');
        if (x.purgedShipped) extra.push(x.purgedShipped + ' removed');
        return '<div style="display:flex;justify-content:space-between;gap:10px"><span style="font-weight:600;color:#191918">' + (x.shop || x.shop_id) + '</span><span style="color:#15803d;font-weight:700">' + x.orders + ' orders</span></div>' + (extra.length ? '<div style="font-size:12px;color:#9ca3af;margin-top:1px">' + extra.join(' · ') + '</div>' : '');
      }).join('');
      if (res.d.catalog_listings_purged) rows += '<div style="font-size:12px;color:#9ca3af;margin-top:8px;padding-top:8px;border-top:1px solid #f0ede9">Removed ' + res.d.catalog_listings_purged + ' Etsy listings from the catalog.</div>';
      _egSyncDone(true, rows || '<div style="text-align:center;color:#9ca3af">Nothing to sync</div>');
      egRefreshEtsy();
    }).catch(function (e) { if (btn) { btn.disabled = false; btn.textContent = 'Sync now'; } _egSyncDone(false, '<div style="text-align:center;color:#dc2626">' + (e.message || 'Network error') + '</div>'); });
  };

  window.egDisconnectEtsy = function (shopId) {
    if (!confirm('Disconnect this Etsy shop? Imported orders stay; future syncs stop.')) return;
    api('/etsy/connections/' + encodeURIComponent(shopId), { method: 'DELETE' }).then(egRefreshEtsy);
  };

  // Push tracking back to Etsy for an Etsy order. Customer-facing: confirms first
  // because it marks the order shipped on Etsy and emails the buyer.
  window.EGEtsyFulfill = function (orderId, tracking, carrier) {
    if (!/^etsy-/i.test(String(orderId || ''))) return Promise.resolve(false); // not an Etsy order
    if (!confirm('Mark this order shipped on Etsy and notify the buyer?\n\nTracking: ' + (tracking || '(none)'))) return Promise.resolve(false);
    return api('/etsy/fulfill', { method: 'POST', body: { order_id: orderId, tracking_code: tracking || '', carrier_name: carrier || 'usps' } })
      .then(function (r) {
        if (!r.ok) { alert('Etsy update failed: ' + (r.d.error || 'unknown')); return false; }
        alert('Etsy order marked shipped + tracking sent.');
        return true;
      });
  };

  document.addEventListener('DOMContentLoaded', function () { setTimeout(egRefreshEtsy, 600); });
})();

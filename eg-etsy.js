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

  window.egSyncEtsy = function (btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
    api('/etsy/sync', { method: 'POST', body: {} }).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Sync now'; }
      if (!res.ok) { alert('Sync failed: ' + (res.d.error || 'unknown')); return; }
      var s = (res.d.synced || []).map(function (x) {
        if (x.error) return (x.shop || x.shop_id) + ': ERROR — ' + x.error;
        var extra = [];
        if (x.skipped) extra.push(x.skipped + ' old shipped skipped');
        if (x.purgedShipped) extra.push(x.purgedShipped + ' old shipped removed');
        return (x.shop || x.shop_id) + ': ' + x.orders + ' orders' + (extra.length ? ' (' + extra.join(', ') + ')' : '');
      }).join('\n');
      var purged = res.d.catalog_listings_purged ? ('\n\nRemoved ' + res.d.catalog_listings_purged + ' Etsy listings from the base catalog.') : '';
      alert('Etsy sync complete\n\n' + (s || 'nothing returned') + purged);
      egRefreshEtsy();
    });
  };

  window.egDisconnectEtsy = function (shopId) {
    if (!confirm('Disconnect this Etsy shop? Imported orders stay; future syncs stop.')) return;
    api('/etsy/connections/' + encodeURIComponent(shopId), { method: 'DELETE' }).then(egRefreshEtsy);
  };

  document.addEventListener('DOMContentLoaded', function () { setTimeout(egRefreshEtsy, 600); });
})();

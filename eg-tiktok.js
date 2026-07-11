/* eg-tiktok.js — admin/seller platform panel: real TikTok Shop connect controller.
   Connect uses EGConnect (popup → oauth-callback.html → /api/tiktok/exchange).
   Reflects connection state and lets the owner connect/disconnect their own shop.
   Mirrors eg-etsy.js; order sync is not wired yet (connect/login only). */
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

  // Render the TikTok row from current connections.
  window.egRefreshTiktok = function () {
    var sub = document.getElementById('tiktok-substatus');
    var actions = document.getElementById('tiktok-actions');
    if (!sub || !actions || !tok()) return;
    api('/tiktok/connections').then(function (res) {
      if (!res.ok) return;
      var conns = res.d || [];
      if (!conns.length) {
        sub.textContent = 'Not connected';
        actions.innerHTML = '<button id="tiktok-connect-btn" onclick="egConnectTiktok()" class="btn btn-out" style="font-size:12px;padding:5px 12px">Connect</button>';
        return;
      }
      var names = conns.map(function (c) { return c.shop_name || c.shop_id; }).join(', ');
      sub.innerHTML = names + ' · <span style="color:#15803d">connected</span>';
      actions.innerHTML =
        '<button onclick="egDisconnectTiktok()" style="background:none;border:none;font-size:12px;font-weight:600;color:#6b7280;padding:5px 8px;cursor:pointer;font-family:inherit">Disconnect</button>';
    });
  };

  window.egConnectTiktok = function () {
    if (!window.EGConnect) { alert('Connect module not loaded'); return; }
    EGConnect.start('tiktok', { onComplete: function (r) { if (r && r.ok) setTimeout(egRefreshTiktok, 400); } });
  };

  window.egDisconnectTiktok = function () {
    if (!confirm('Disconnect TikTok? Imported orders stay; future syncs stop.')) return;
    try { if (window.EGConnect) EGConnect.disconnect('tiktok'); } catch (e) {}
    // Remove EVERY TikTok connection, not just conns[0] — re-connects can leave duplicate rows.
    api('/tiktok/connections').then(function (res) {
      var conns = (res.ok && res.d) || [];
      if (!conns.length) { egRefreshTiktok(); return; }
      Promise.all(conns.map(function (c) {
        return api('/tiktok/connections/' + encodeURIComponent(c.shop_id), { method: 'DELETE' });
      })).then(egRefreshTiktok, egRefreshTiktok);
    });
  };

  document.addEventListener('DOMContentLoaded', function () { setTimeout(egRefreshTiktok, 650); });
})();

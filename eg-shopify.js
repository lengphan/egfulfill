/* eg-shopify.js — admin/seller platform panel: real Shopify connect controller.
   Connect uses EGConnect (confirm modal collects the .myshopify.com store → popup →
   oauth-callback.html → /api/shopify/exchange). Mirrors eg-tiktok.js; order sync is not
   wired yet (connect/login only). */
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

  window.egRefreshShopify = function () {
    var sub = document.getElementById('shopify-substatus');
    var actions = document.getElementById('shopify-actions');
    if (!sub || !actions || !tok()) return;
    api('/shopify/connections').then(function (res) {
      if (!res.ok) return;
      var conns = res.d || [];
      if (!conns.length) {
        sub.textContent = 'Not connected';
        actions.innerHTML = '<button id="shopify-connect-btn" onclick="egConnectShopify()" class="btn btn-out" style="font-size:12px;padding:5px 12px">Connect</button>';
        return;
      }
      var names = conns.map(function (c) { return c.shop_name || c.shop_id; }).join(', ');
      sub.innerHTML = names + ' · <span style="color:#15803d">connected</span>';
      actions.innerHTML =
        '<button onclick="egDisconnectShopify()" style="background:none;border:none;font-size:12px;font-weight:600;color:#6b7280;padding:5px 8px;cursor:pointer;font-family:inherit">Disconnect</button>';
    });
  };

  window.egConnectShopify = function () {
    if (!window.EGConnect) { alert('Connect module not loaded'); return; }
    EGConnect.start('shopify', { onComplete: function (r) { if (r && r.ok) setTimeout(egRefreshShopify, 400); } });
  };

  window.egDisconnectShopify = function () {
    if (!confirm('Disconnect Shopify? Imported orders stay; future syncs stop.')) return;
    try { if (window.EGConnect) EGConnect.disconnect('shopify'); } catch (e) {}
    // Remove EVERY Shopify connection, not just conns[0] — re-connects can leave duplicate rows.
    api('/shopify/connections').then(function (res) {
      var conns = (res.ok && res.d) || [];
      if (!conns.length) { egRefreshShopify(); return; }
      Promise.all(conns.map(function (c) {
        return api('/shopify/connections/' + encodeURIComponent(c.shop_id), { method: 'DELETE' });
      })).then(egRefreshShopify, egRefreshShopify);
    });
  };

  document.addEventListener('DOMContentLoaded', function () { setTimeout(egRefreshShopify, 700); });
})();

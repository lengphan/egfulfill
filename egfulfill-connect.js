/* egfulfill-connect.js — store-connect flow (confirmation modal → popup → return status).
   Plain English copy throughout. Visual matches the retro sticker theme.
   Stores connection state in localStorage 'eg_connections'.
   Swap _OAUTH_URL with the real platform OAuth URL when the backend is live. */
(function (global) {
  'use strict';
  if (typeof document === 'undefined' || global.EGConnect) return;

  var STORAGE_KEY = 'eg_connections';

  /* Per-platform copy. Keep wording plain — no API jargon. */
  var PLATFORMS = {
    shopify:     { name: 'Shopify',      perms: ['See your orders', 'Update tracking on shipped orders', 'Read your product list'] },
    etsy:        { name: 'Etsy',         perms: ['See your orders', 'Update tracking on shipped orders', 'Read your shop listings'] },
    tiktok:      { name: 'TikTok Shop',  perms: ['See your orders', 'Update tracking on shipped orders', 'Read your product list'] },
    woocommerce: { name: 'WooCommerce',  perms: ['See your orders', 'Update tracking on shipped orders', 'Read your product list'] },
    amazon:      { name: 'Amazon',       perms: ['See your orders', 'Update tracking on shipped orders'] },
    ebay:        { name: 'eBay',         perms: ['See your orders', 'Update tracking on shipped orders'] },
    bigcommerce: { name: 'BigCommerce',  perms: ['See your orders', 'Update tracking on shipped orders', 'Read your product list'] },
    other:       { name: 'Other Platform', perms: ['Request a custom integration from EGFULFILL support'] }
  };

  function _key(p) { return String(p || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function _meta(p) { return PLATFORMS[_key(p)] || { name: p, perms: ['See your orders', 'Update tracking'] }; }
  function _load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e) { return {}; } }
  function _save(c) { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); try { document.dispatchEvent(new CustomEvent('eg-connections-changed')); } catch(_) {} }

  function getConnection(platform) {
    var key = _key(platform);
    return _load()[key] || null;
  }
  function getAll() { return _load(); }
  function disconnect(platform) {
    var key = _key(platform);
    var c = _load();
    delete c[key];
    _save(c);
  }

  /* ── Confirm modal ── */
  function injectStyles() {
    if (document.getElementById('eg-connect-style')) return;
    var s = document.createElement('style');
    s.id = 'eg-connect-style';
    s.textContent =
      '#eg-connect-ov{position:fixed;inset:0;background:rgba(25,25,24,.45);z-index:9500;display:none;align-items:center;justify-content:center;padding:24px;animation:eg-cn-fade .15s ease}' +
      '#eg-connect-ov.on{display:flex}' +
      '#eg-connect-card{background:#fdfcfa;border:1.5px solid #40403d;border-radius:14px;box-shadow:4px 4px 0 #40403d;width:100%;max-width:420px;overflow:hidden;animation:eg-cn-pop .22s cubic-bezier(.22,1,.36,1)}' +
      '#eg-connect-card .hd{padding:18px 20px;border-bottom:1.5px solid #40403d;display:flex;align-items:center;justify-content:space-between}' +
      '#eg-connect-card .hd h3{margin:0;font-size:16px;font-weight:700;color:#191918}' +
      '#eg-connect-card .hd button{background:none;border:none;cursor:pointer;color:#6b7280;padding:4px;border-radius:5px;line-height:0}' +
      '#eg-connect-card .hd button:hover{background:#f3eee2;color:#191918}' +
      '#eg-connect-card .bd{padding:18px 20px}' +
      '#eg-connect-card ul{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:8px}' +
      '#eg-connect-card li{display:flex;align-items:flex-start;gap:9px;font-size:13.5px;color:#374151;line-height:1.5}' +
      '#eg-connect-card li svg{flex-shrink:0;margin-top:2px}' +
      '#eg-connect-card .note{font-size:13px;color:#6b7280;line-height:1.55;margin:0 0 18px;padding:10px 12px;background:#f3eee2;border-radius:8px;border:1px solid #d8d4cd}' +
      '#eg-connect-card .ft{display:flex;justify-content:flex-end;gap:8px}' +
      '.eg-cn-btn{display:inline-flex;align-items:center;justify-content:center;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;border:1.5px solid #40403d;border-radius:10px;padding:9px 16px;text-decoration:none;box-shadow:2px 2px 0 #40403d;transition:box-shadow .14s ease, top .14s cubic-bezier(.4,0,.2,1);position:relative;top:0}' +
      '.eg-cn-btn:hover{top:-1px;box-shadow:4px 4px 0 #40403d}' +
      '.eg-cn-btn:active{top:2px;box-shadow:1px 1px 0 #40403d}' +
      '.eg-cn-btn.ghost{background:transparent;color:#191918}' +
      '.eg-cn-btn.dark{background:#191918;color:#f3eee2}' +
      /* Toast */
      '#eg-connect-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#fdfcfa;border:1.5px solid #40403d;border-radius:10px;box-shadow:3px 3px 0 #40403d;padding:11px 16px;font-size:13.5px;color:#191918;z-index:9600;display:none;align-items:center;gap:8px;opacity:0;transition:opacity .18s ease, transform .18s ease}' +
      '#eg-connect-toast.show{display:flex;opacity:1;transform:translateX(-50%) translateY(0)}' +
      '#eg-connect-toast.err{border-color:#b83c3c;color:#7a1f1f}' +
      '@keyframes eg-cn-fade{from{opacity:0}to{opacity:1}}' +
      '@keyframes eg-cn-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}';
    document.head.appendChild(s);
  }

  function ensureModal() {
    if (document.getElementById('eg-connect-ov')) return;
    injectStyles();
    var ov = document.createElement('div');
    ov.id = 'eg-connect-ov';
    ov.innerHTML =
      '<div id="eg-connect-card" role="dialog" aria-modal="true" aria-labelledby="eg-cn-title">' +
        '<div class="hd"><h3 id="eg-cn-title">Connect</h3>' +
          '<button type="button" onclick="EGConnect._close()" aria-label="Close">' +
            '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="bd">' +
          '<ul id="eg-cn-perms"></ul>' +
          '<p class="note" id="eg-cn-note"></p>' +
          '<div class="ft">' +
            '<button class="eg-cn-btn ghost" type="button" onclick="EGConnect._close()">Cancel</button>' +
            '<button class="eg-cn-btn dark" type="button" id="eg-cn-continue">Continue</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    // Also add the toast container once
    var t = document.createElement('div'); t.id = 'eg-connect-toast'; document.body.appendChild(t);
  }

  function showToast(message, isError) {
    var t = document.getElementById('eg-connect-toast');
    if (!t) return;
    t.textContent = '';
    var icon = document.createElement('span');
    icon.innerHTML = isError
      ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#0d6e2e" stroke-width="1.4"/><path d="M4.5 7.2l1.7 1.7L10 5.4" stroke="#0d6e2e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    icon.style.lineHeight = '0';
    t.appendChild(icon);
    t.appendChild(document.createTextNode(' ' + message));
    t.classList.toggle('err', !!isError);
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 3000);
  }

  var _onComplete = null;
  var _currentPlatform = null;

  function close() {
    var ov = document.getElementById('eg-connect-ov');
    if (ov) ov.classList.remove('on');
    _onComplete = null;
    _currentPlatform = null;
  }

  function start(platform, opts) {
    ensureModal();
    var meta = _meta(platform);
    _currentPlatform = _key(platform);
    _onComplete = (opts && opts.onComplete) || null;

    document.getElementById('eg-cn-title').textContent = 'Connect ' + meta.name;
    var ul = document.getElementById('eg-cn-perms');
    ul.innerHTML = '';
    meta.perms.forEach(function (p) {
      var li = document.createElement('li');
      li.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#0d6e2e" stroke-width="1.4"/><path d="M4.5 7.2l1.7 1.7L10 5.4" stroke="#0d6e2e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>' + p + '</span>';
      ul.appendChild(li);
    });
    document.getElementById('eg-cn-note').textContent =
      "You'll be taken to " + meta.name + " to log in and approve access. You can disconnect any time from this page.";
    var btn = document.getElementById('eg-cn-continue');
    btn.textContent = 'Continue';
    btn.onclick = function () { _openPopup(_currentPlatform); };
    document.getElementById('eg-connect-ov').classList.add('on');
  }

  /* ── Popup ── */
  // Swap this for the real platform OAuth URL when the backend is live:
  //   shopify     → https://accounts.shopify.com/oauth/authorize?…
  //   tiktok      → https://services.tiktokshop.com/open/authorize?…
  //   etsy        → https://www.etsy.com/oauth/connect?…
  function _OAUTH_URL(platform) {
    return 'oauth-callback.html?platform=' + encodeURIComponent(platform);
  }

  function _openPopup(platform) {
    var url = _OAUTH_URL(platform);
    var w = 520, h = 640;
    var left = window.screenX + (window.outerWidth - w) / 2;
    var top  = window.screenY + (window.outerHeight - h) / 2;
    var popup = window.open(url, 'eg-connect-' + platform,
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',toolbar=no,menubar=no,location=no');
    if (!popup) {
      close();
      showToast('Please allow popups to connect', true);
      return;
    }
    // Move modal background out of the way visually while popup is open
    var ov = document.getElementById('eg-connect-ov');
    if (ov) ov.style.opacity = '0.4';
    // Track popup closure (e.g. user closes manually without finishing)
    var timer = setInterval(function () {
      if (popup.closed) {
        clearInterval(timer);
        if (ov) ov.style.opacity = '';
        // If we didn't get a postMessage, treat as cancel
        if (_currentPlatform) {
          close();
        }
      }
    }, 400);
  }

  /* ── postMessage listener ── */
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || d.kind !== 'eg-connect-result') return;
    var platform = _key(d.platform);
    var meta = _meta(platform);
    if (d.ok) {
      var conns = _load();
      conns[platform] = {
        platform: platform,
        name: meta.name,
        shop: d.shop || (meta.name + ' Store'),
        connectedAt: Date.now()
      };
      _save(conns);
      showToast('Connected to ' + meta.name);
      if (typeof _onComplete === 'function') _onComplete({ ok: true, platform: platform, connection: conns[platform] });
    } else {
      showToast('Could not connect to ' + meta.name + (d.reason ? ' — ' + d.reason : ''), true);
      if (typeof _onComplete === 'function') _onComplete({ ok: false, platform: platform, reason: d.reason });
    }
    close();
  });

  global.EGConnect = {
    start: start,
    _close: close,
    getConnection: getConnection,
    getAll: getAll,
    disconnect: disconnect,
    _injectStyles: injectStyles,
    _platforms: PLATFORMS
  };
})(window);

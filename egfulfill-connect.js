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
  // Per-platform brand mark for the connect modal's logo tile (bg tint + inline SVG).
  function _brand(p) {
    var M = {
      etsy:    { bg: '#fff1e7', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M8.6 5.4h8v2.2M8.6 5.4v13.2M8.6 5.4H6.4M8.6 18.6h8.2v-2.3M8.6 18.6H6.4M8.6 11.7h4.6" stroke="#e2600f" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
      tiktok:  { bg: '#111111', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M16.6 3c.3 2.2 1.6 3.7 3.8 3.9v2.6c-1.2 0-2.4-.3-3.5-.9v5.7c0 3.4-2.5 5.6-5.5 5.6-2.8 0-5.1-2-5.1-4.8 0-2.9 2.4-4.9 5.5-4.6v2.7c-.4-.1-.9-.1-1.3-.1-1.1.1-1.9.9-1.8 2 .1 1.1.9 1.7 2 1.6 1.1-.1 1.8-1 1.8-2.2V3h3.6z"/></svg>' },
      shopify: { bg: '#eafaf1', svg: '<svg width="25" height="25" viewBox="0 0 24 24" fill="none"><path d="M14.6 6.3c-.2-.1-.5-.1-.7.1l-.8.8c-.2-.7-.6-1.3-1.4-1.3-1 0-1.8.9-2.2 2.1-.6.2-1 .3-1.1.4-.4.1-.4.2-.5.6L6 17.4l5.6 1.1V6.6c-.3 0-.6.1-1 .3M11.6 6.7v1c-.5.1-.9.3-1.3.5.2-.9.7-1.5 1.3-1.5M13.1 18.1l1.7-.4-.7-9.5c-.1 0-.3-.1-.4-.1" stroke="#12a150" stroke-width="1.3" stroke-linejoin="round"/></svg>' }
    };
    return M[_key(p)] || { bg: '#f1f0fb', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 15l6-6M10.5 6.5l1-1a3.5 3.5 0 015 5l-1 1M7.5 12.5l-1 1a3.5 3.5 0 005 5l1-1" stroke="#6d5ef0" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' };
  }
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
      '#eg-connect-ov{position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:9500;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);animation:eg-cn-fade .16s ease}' +
      '#eg-connect-ov.on{display:flex}' +
      '#eg-connect-card{position:relative;background:#fff;border:1px solid #ececea;border-radius:20px;box-shadow:0 24px 70px rgba(17,24,39,.22);width:100%;max-width:400px;padding:30px 28px 22px;text-align:center;animation:eg-cn-pop .24s cubic-bezier(.22,1,.36,1)}' +
      '#eg-connect-card .eg-cn-x{position:absolute;top:14px;right:14px;background:none;border:none;cursor:pointer;color:#b6b3ad;padding:6px;border-radius:9px;line-height:0;transition:background .12s,color .12s}' +
      '#eg-connect-card .eg-cn-x:hover{background:#f4f2ef;color:#191918}' +
      '#eg-cn-logo{width:58px;height:58px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:15px}' +
      '#eg-cn-title{margin:0 0 5px;font-size:19px;font-weight:750;color:#191918;letter-spacing:-.015em}' +
      '#eg-cn-sub{margin:0 0 20px;font-size:13.5px;color:#8a8f98;line-height:1.5}' +
      '#eg-connect-card ul{list-style:none;margin:0 0 16px;padding:0;display:flex;flex-direction:column;gap:12px;text-align:left}' +
      '#eg-connect-card li{display:flex;align-items:flex-start;gap:11px;font-size:13.75px;color:#3a3f47;line-height:1.45}' +
      '#eg-connect-card li .eg-cn-ck{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:#e9f6ee;display:inline-flex;align-items:center;justify-content:center;margin-top:1px}' +
      '#eg-connect-card .note{font-size:12.5px;color:#8a8f98;line-height:1.5;margin:0 0 22px;padding:11px 13px;background:#f7f6f4;border-radius:11px;text-align:left}' +
      '#eg-connect-card .ft{display:flex;gap:9px}' +
      '.eg-cn-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-family:inherit;font-size:14px;font-weight:650;cursor:pointer;border-radius:12px;padding:11px 16px;text-decoration:none;border:1px solid transparent;transition:transform .12s ease,box-shadow .16s ease,background .14s ease}' +
      '.eg-cn-btn.ghost{background:#fff;color:#3a3f47;border-color:#e5e4e0}' +
      '.eg-cn-btn.ghost:hover{background:#f7f6f4}' +
      '.eg-cn-btn.dark{background:#191918;color:#fff;box-shadow:0 2px 8px rgba(17,24,39,.18)}' +
      '.eg-cn-btn.dark:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(17,24,39,.24)}' +
      '.eg-cn-btn.dark:active{transform:translateY(0);box-shadow:0 2px 8px rgba(17,24,39,.18)}' +
      /* Toast */
      '#eg-connect-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#fff;border:1px solid #e5e4e0;border-radius:12px;box-shadow:0 12px 34px rgba(17,24,39,.16);padding:11px 16px;font-size:13.5px;color:#191918;z-index:9600;display:none;align-items:center;gap:8px;opacity:0;transition:opacity .18s ease, transform .18s ease}' +
      '#eg-connect-toast.show{display:flex;opacity:1;transform:translateX(-50%) translateY(0)}' +
      '#eg-connect-toast.err{border-color:#e6bcbc;color:#8a2020}' +
      '@keyframes eg-cn-fade{from{opacity:0}to{opacity:1}}' +
      '@keyframes eg-cn-pop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}';
    document.head.appendChild(s);
  }

  function ensureModal() {
    if (document.getElementById('eg-connect-ov')) return;
    injectStyles();
    var ov = document.createElement('div');
    ov.id = 'eg-connect-ov';
    ov.innerHTML =
      '<div id="eg-connect-card" role="dialog" aria-modal="true" aria-labelledby="eg-cn-title">' +
        '<button type="button" class="eg-cn-x" onclick="EGConnect._close()" aria-label="Close">' +
          '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<div id="eg-cn-logo"></div>' +
        '<h3 id="eg-cn-title">Connect</h3>' +
        '<p id="eg-cn-sub">EGFULFILL will be able to:</p>' +
        '<ul id="eg-cn-perms"></ul>' +
        '<p class="note" id="eg-cn-note"></p>' +
        '<div class="ft">' +
          '<button class="eg-cn-btn ghost" type="button" onclick="EGConnect._close()">Cancel</button>' +
          '<button class="eg-cn-btn dark" type="button" id="eg-cn-continue">Continue</button>' +
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

    var b = _brand(platform);
    var logo = document.getElementById('eg-cn-logo');
    logo.style.background = b.bg; logo.innerHTML = b.svg;
    document.getElementById('eg-cn-title').textContent = 'Connect ' + meta.name;
    document.getElementById('eg-cn-sub').textContent = 'EGFULFILL will be able to:';
    var ul = document.getElementById('eg-cn-perms');
    ul.innerHTML = '';
    meta.perms.forEach(function (p) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="eg-cn-ck"><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M3 7.3l2.5 2.5L11 4.2" stroke="#0d8a3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>' + p + '</span>';
      ul.appendChild(li);
    });
    document.getElementById('eg-cn-note').textContent =
      "You'll be taken to " + meta.name + " to approve access. You can disconnect any time from Settings.";
    var btn = document.getElementById('eg-cn-continue');
    btn.textContent = 'Continue';
    btn.onclick = function () { _openPopup(_currentPlatform); };
    document.getElementById('eg-connect-ov').classList.add('on');
  }

  /* ── Popup ── */
  // Open the callback on the CANONICAL (non-www) origin so the whole OAuth round-trip
  // stays on one host — no www→non-www 301 reroute/flash mid-flow, and the login token
  // is read/written in one place.
  function _OAUTH_URL(platform) {
    var origin = (location.origin || '').replace('://www.', '://');
    return origin + '/oauth-callback.html?platform=' + encodeURIComponent(platform);
  }

  function _openPopup(platform) {
    var url = _OAUTH_URL(platform);
    // Size generously so the provider's consent/login page fits with NO manual resize
    // or scroll, but clamp to the available screen. Center on the ACTIVE monitor.
    var availW = (window.screen && window.screen.availWidth) || 1280;
    var availH = (window.screen && window.screen.availHeight) || 900;
    var w = Math.min(620, availW - 40);
    var h = Math.min(800, availH - 80);
    var baseX = (window.screenX != null ? window.screenX : window.screenLeft) || 0;
    var baseY = (window.screenY != null ? window.screenY : window.screenTop) || 0;
    var ow = window.outerWidth || availW, oh = window.outerHeight || availH;
    var left = Math.round(baseX + Math.max(0, (ow - w) / 2));
    var top  = Math.round(baseY + Math.max(0, (oh - h) / 2));
    var popup = window.open(url, 'eg-connect-' + platform,
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',toolbar=no,menubar=no,location=no,resizable=yes,scrollbars=yes');
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

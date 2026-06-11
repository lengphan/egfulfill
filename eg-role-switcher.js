/* eg-role-switcher.js — quick role/board switcher (no data wiping).
   A small floating widget (top-center) that lets you hop between the role
   surfaces — Seller · Operator · Warehouse · Designer · Admin — WITHOUT logging
   out and back in, and WITHOUT clearing any state.

   The whole point: work on one board, switch to another, and watch the SAME
   items / statuses carry over — so you can follow an order through the flow
   (e.g. push on operator → see it land on warehouse → check admin) and confirm
   things actually update. Switching is pure navigation; nothing is wiped.

   A deliberate, destructive "Wipe all test data" lives in Admin → Settings only
   (call window.EGTestReset()). "Full sign out" clears the session token when you
   genuinely want the login screen.

   Loaded by operator/admin/warehouse/designer + the seller pages. Pure client
   side; to remove it entirely, delete this file and the 5 <script> tags. */
(function () {
  'use strict';
  if (window.__egRoleSwitcher) return;
  window.__egRoleSwitcher = true;

  var ROLES = [
    { key: 'seller',    label: 'Seller',    page: 'orders.html' },
    { key: 'operator',  label: 'Operator',  page: 'operator.html' },
    { key: 'warehouse', label: 'Warehouse', page: 'warehouse.html' },
    { key: 'designer',  label: 'Designer',  page: 'designer.html' },
    { key: 'admin',     label: 'Admin',     page: 'admin.html' }
  ];
  // Pages that belong to the seller surface but aren't orders.html.
  var SELLER_PAGES = /^(orders|dashboard|wallet|stores|analytics|design-lab|design-maker|products-dash|settings|chat|fulfillment|apidocs|seller)\.html$/i;

  var path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var current = ROLES.find(function (r) { return r.page === path; });
  if (!current && SELLER_PAGES.test(path)) current = ROLES[0];

  function switchTo(role) {
    // Pure navigation — preserves localStorage / session so every board sees the
    // same orders + statuses. State propagation is exactly what we want to watch.
    if (current && role.key === current.key) { open = false; render(); return; }
    location.href = role.page;
  }
  function fullSignOut() {
    try { localStorage.removeItem('eg_token'); localStorage.removeItem('eg_user'); localStorage.removeItem('eg_devview'); } catch (e) {}
    location.href = 'login.html';
  }

  var open = false;
  function render() {
    var host = document.getElementById('egrs-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'egrs-host';
      host.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:12px;z-index:100000;font-family:Inter,system-ui,sans-serif';
      document.body.appendChild(host);
    }
    var pill = '<button id="egrs-pill" style="display:inline-flex;align-items:center;gap:8px;background:#191918;color:#fff;border:none;border-radius:999px;padding:8px 14px 8px 11px;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);font-family:inherit">'
      + '<span style="opacity:.7;font-weight:500">View as</span><span>' + (current ? current.label : '—') + '</span>'
      + '<span style="opacity:.6;font-size:10px">' + (open ? '▴' : '▾') + '</span></button>';

    var menu = '';
    if (open) {
      var rows = ROLES.map(function (r) {
        var isCur = current && r.key === current.key;
        return '<button data-role="' + r.key + '" class="egrs-role" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:' + (isCur ? '#f4f2ef' : '#fff') + ';border:none;border-radius:8px;padding:9px 11px;font-size:13px;font-weight:600;color:#191918;cursor:pointer;font-family:inherit" '
          + 'onmouseover="this.style.background=\'#f4f2ef\'" onmouseout="this.style.background=\'' + (isCur ? '#f4f2ef' : '#fff') + '\'">'
          + '<span style="flex:1">' + r.label + '</span>'
          + (isCur ? '<span style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">here</span>' : '<span style="color:#c4c3be">→</span>')
          + '</button>';
      }).join('');
      menu = '<div id="egrs-menu" style="position:absolute;left:50%;margin-left:-120px;top:46px;width:240px;background:#fff;border:1px solid #e5e4e0;border-radius:13px;box-shadow:0 12px 40px rgba(0,0,0,.18);padding:7px;animation:egrsUp .14s ease">'
        + '<div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;padding:6px 8px 4px">Jump to board</div>'
        + rows
        + '<button id="egrs-signout" style="display:block;width:100%;text-align:left;background:none;border:none;border-radius:8px;padding:8px 11px;margin-top:4px;border-top:1px solid #f0ede9;font-size:12.5px;font-weight:600;color:#dc2626;cursor:pointer;font-family:inherit" onmouseover="this.style.background=\'#fff5f5\'" onmouseout="this.style.background=\'none\'">Full sign out</button>'
        + '<div style="font-size:10.5px;color:#b0aead;padding:4px 10px 6px;line-height:1.4">Nothing is wiped — the same orders &amp; statuses carry across boards so you can follow the flow. (Reset lives in Admin → Settings.)</div>'
        + '</div>';
    }
    host.innerHTML = menu + pill;

    document.getElementById('egrs-pill').onclick = function (e) { e.stopPropagation(); open = !open; render(); };
    if (open) {
      Array.prototype.forEach.call(host.querySelectorAll('.egrs-role'), function (b) {
        b.onclick = function () { var r = ROLES.find(function (x) { return x.key === b.getAttribute('data-role'); }); if (r) switchTo(r); };
      });
      document.getElementById('egrs-signout').onclick = function (e) { e.stopPropagation(); fullSignOut(); };
    }
  }

  // close menu on outside click
  document.addEventListener('click', function (e) {
    if (open && !e.target.closest('#egrs-host')) { open = false; render(); }
  });

  function boot() {
    // Mark this browser as "dev view" so eg-guard.js lets this one account hop
    // across every board. Cleared on Full sign out. (Dev-only; remove with this file.)
    try { localStorage.setItem('eg_devview', '1'); } catch (e) {}
    if (!document.getElementById('egrs-css')) {
      var st = document.createElement('style'); st.id = 'egrs-css';
      st.textContent = '@keyframes egrsUp{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(st);
    }
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  // The deliberate, destructive wipe already lives in Admin → Settings →
  // "Reset demo data" (EGStore.resetDemoData). This switcher never wipes.
})();

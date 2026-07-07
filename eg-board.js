/* eg-board.js — BOARD OS v2 (draft): builds the sticky connected-tab header from the existing sidebar nav,
   then RE-PARENTS the live top-bar controls into it (so every handler/id — search, + New menu, balance,
   notifications, user — keeps working untouched) and hides the old sidebar + top bar.
   Presentation only: no data, no logic, no markup rewrite beyond moving existing nodes. Paired with eg-board.css. */
(function () {
  'use strict';
  if (window.__egBoardBuilt) return;
  window.EG_BOARD_BUILD = '2025-board-os-v2';

  function textOf(a) {
    var t = '';
    [].forEach.call(a.childNodes, function (n) { if (n.nodeType === 3) t += n.textContent; });
    return t.trim();
  }

  function build() {
    if (window.__egBoardBuilt) return;
    var sidebar = document.querySelector('aside.sidebar') || document.querySelector('.sidebar');
    var oldHeader = document.querySelector('header');
    if (!sidebar || !oldHeader) return;                       // not a standard board shape → do nothing
    var nav = sidebar.querySelector('nav') || sidebar;
    var items = [].slice.call(nav.querySelectorAll('a.ni'));
    if (!items.length) return;
    window.__egBoardBuilt = true;

    var top = document.createElement('header');
    top.className = 'bos-top';
    top.id = 'eg-board-top';

    // ── nav block: logo cell + connected tabs ──
    var navblock = document.createElement('div');
    navblock.className = 'bos-navblock';
    var logo = document.createElement('a');
    logo.className = 'bos-logo';
    logo.href = 'seller.html';
    logo.textContent = 'eg';
    navblock.appendChild(logo);

    var tabs = document.createElement('div');
    tabs.className = 'bos-tabs';
    var logoutNode = null;
    items.forEach(function (a) {
      if (a.offsetParent === null && a.style.display === 'none') return;   // skip hidden nav rows
      var label = textOf(a);
      if (!label) return;
      if (/^log\s?out$/i.test(label)) { logoutNode = a; return; }          // move logout to the right cluster
      if (/^profile$/i.test(label)) return;                                // covered by the user block

      var tab = document.createElement('a');
      tab.className = 'bos-tab' + (a.classList.contains('on') ? ' on' : '');
      tab.href = a.getAttribute('href') || '#';
      var oc = a.getAttribute('onclick'); if (oc) tab.setAttribute('onclick', oc);
      var tgt = a.getAttribute('target'); if (tgt) tab.setAttribute('target', tgt);

      var sq = document.createElement('span'); sq.className = 'sq'; tab.appendChild(sq);
      var tx = document.createElement('span'); tx.className = 'txt'; tx.textContent = label; tab.appendChild(tx);

      var badge = a.querySelector('[data-badge]');
      if (badge) {
        var raw = (badge.textContent || '').trim();
        if (raw && raw !== '0') {
          var ct = document.createElement('span'); ct.className = 'ct';
          var bk = badge.getAttribute('data-badge'); if (bk) ct.setAttribute('data-badge', bk);   // keep it live-updatable
          ct.textContent = raw; tab.appendChild(ct);
        }
      }
      tabs.appendChild(tab);
    });
    navblock.appendChild(tabs);
    top.appendChild(navblock);

    // ── right cluster: RE-PARENT the existing controls (keeps all handlers/ids) ──
    var rwrap = document.createElement('div');
    rwrap.className = 'bos-right';
    var right = oldHeader.querySelector('div[style*="margin-left:auto"]');
    if (right) rwrap.appendChild(right);                       // move, don't clone → handlers intact
    if (logoutNode) { logoutNode.classList.add('bos-logout'); rwrap.appendChild(logoutNode); }
    top.appendChild(rwrap);

    // ── swap the chrome ──
    document.body.insertBefore(top, document.body.firstChild);
    sidebar.style.display = 'none';
    oldHeader.style.display = 'none';
    document.documentElement.classList.add('eg-board-on');
    document.body.classList.add('eg-board-on');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();

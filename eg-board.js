/* eg-board.js — BOARD OS v2: the sidebar stays (restyled by eg-board.css as a VERTICAL connected-tab rail);
   the top-bar right cluster becomes a connected "page settings" block with ■ dot+label cells
   (SEARCH · EN · NIGHT · ALERTS · BALANCE · + NEW · account · out).
   Presentation only — every control keeps its element, id and click handler; the dynamic spans
   (#balance-val, #notif-dot, #hdr-lang-code) are MOVED, never recreated, so live updates keep working. */
(function () {
  'use strict';
  if (window.__egBoardInit) return;
  window.EG_BOARD_BUILD = '2025-board-os-v2b';

  function sq() { var s = document.createElement('span'); s.className = 'bos-sq'; return s; }
  function lbl(t) { var s = document.createElement('span'); s.className = 'bos-lbl'; s.textContent = t; return s; }
  // rebuild a control's inner content as [square][label][kept dynamic span] — handler stays on the element
  function relabel(el, text, keepSel) {
    if (!el) return;
    var keep = keepSel ? el.querySelector(keepSel) : null;
    el.innerHTML = '';
    el.appendChild(sq());
    if (text) el.appendChild(lbl(text));
    if (keep) el.appendChild(keep);
  }

  function init() {
    if (window.__egBoardInit) return;
    window.__egBoardInit = true;
    var html = document.documentElement;
    html.classList.add('eg-board-on');
    if (document.body) document.body.classList.add('eg-board-on');

    var header = document.querySelector('header');
    var rc = header && header.querySelector('div[style*="margin-left:auto"]');
    var sidebar = document.querySelector('aside.sidebar') || document.querySelector('.sidebar');

    // move the sidebar "Log out" into the controls block, so the rail can end at Settings
    if (sidebar && rc) {
      var logout = [].slice.call(sidebar.querySelectorAll('a.ni')).filter(function (a) { return /log\s?out/i.test(a.textContent || ''); })[0];
      if (logout) { logout.classList.add('bos-logout'); relabel(logout, ''); logout.appendChild(lbl('OUT')); rc.appendChild(logout); }
    }
    if (!rc) return;
    rc.classList.add('bos-controls');

    // ── relabel each control to ■ + UPPERCASE label (icons out, lettering in) ──
    relabel(document.getElementById('hdr-search-btn'), 'SEARCH');
    relabel(document.getElementById('hdr-lang-btn'), '', '#hdr-lang-code');         // ■ + EN

    // theme: KEEP #hdr-theme-track in the DOM (toggleTheme drives it) but hide it via CSS; add a mode label
    var pref = document.getElementById('pref-btn');
    if (pref && !pref.querySelector('.bos-mode')) {
      pref.insertBefore(sq(), pref.firstChild);
      var m = document.createElement('span'); m.className = 'bos-lbl bos-mode'; pref.appendChild(m);   // text set by CSS per data-theme
    }

    var nd = document.getElementById('notif-dot');
    var notifBtn = nd && nd.closest ? nd.closest('button, .ibtn') : null;
    relabel(notifBtn, 'ALERTS', '#notif-dot');

    relabel(document.querySelector('.bal-chip'), 'BALANCE:', '#balance-val');

    // user cell → ■ + first name (email already dropped)
    var user = rc.querySelector('.ibtn[onclick*="settings"]');
    if (user) {
      var nmEl = user.querySelector('div:nth-of-type(2) > div:first-child');
      var name = (nmEl && nmEl.textContent.trim()) || 'Account';
      relabel(user, name);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

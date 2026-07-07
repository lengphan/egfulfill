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

    // ── unify the rail footer: drop the "Starter Plan / Upgrade" box + guarantee a Log out row ──
    var sidebar = document.querySelector('aside.sidebar') || document.querySelector('.sidebar');
    if (sidebar) {
      [].slice.call(sidebar.children).forEach(function (el) {
        if (el.tagName === 'DIV' && !el.classList.contains('side-foot') && /upgrade to (pro|plan)|starter plan|growth plan|current plan/i.test(el.textContent || '')) el.remove();
      });
      var hasLogout = [].slice.call(sidebar.querySelectorAll('a.ni')).some(function (a) { return /log\s?out/i.test(a.textContent || ''); });
      if (!hasLogout) {
        var nav = sidebar.querySelector('nav') || sidebar;
        var lo = document.createElement('a');
        lo.className = 'ni'; lo.href = '#';
        lo.setAttribute('onclick', "event.preventDefault();try{if(window.EGAuth&&EGAuth.signOut)EGAuth.signOut()}catch(e){}try{localStorage.removeItem('eg_token');localStorage.removeItem('eg_user')}catch(e){}location.href='seller-login.html'");
        lo.textContent = 'Log out';
        nav.appendChild(lo);
      }
    }

    var header = document.querySelector('header');
    var rc = header && header.querySelector('div[style*="margin-left:auto"]');
    if (!rc) return;
    rc.classList.add('bos-controls');

    // Control labels (SEARCH / EN / NIGHT / ALERTS / BALANCE / name) are now rendered purely in
    // CSS (eg-board.css "FIRST-PAINT header labels") so they paint on the first frame with no JS
    // relabel — that post-paint swap was the header FOUC. Nothing to relabel here anymore.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

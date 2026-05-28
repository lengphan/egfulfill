/* EGFULFILL — Draggable sidebar nav.
   Auto-discovers groups in <aside class="sidebar"> <nav>, makes each .ni draggable,
   constrains drops within their original group, and persists the order to localStorage
   keyed by role (warehouse, admin, operator, factory, designer, or "seller" for the
   seller-side pages that share an identical sidebar).

   Drop-in: include with <script src="nav-drag.js"></script> at end of body. */
(function () {
  if (typeof window === 'undefined') return;

  function getRoleKey() {
    const aside = document.querySelector('aside.sidebar');
    if (!aside) return 'default';
    const ROLES = ['WAREHOUSE','ADMIN','OPERATOR','FACTORY','DESIGNER'];
    // Look for a small uppercase role badge near the EGFULFILL logo.
    const spans = aside.querySelectorAll('span');
    for (let i = 0; i < spans.length; i++) {
      const t = (spans[i].textContent || '').trim();
      if (ROLES.indexOf(t) !== -1) return t.toLowerCase();
    }
    // Seller-side pages share the same sidebar across many .html files — use one key.
    return 'seller';
  }

  function itemKey(el) {
    return el.getAttribute('data-section') || el.getAttribute('href') || (el.textContent || '').trim();
  }

  function detectGroups(nav) {
    // Prefer explicit wrapper divs (warehouse pattern: <div id="nav-main">, <div id="nav-mgmt">).
    const explicit = nav.querySelectorAll(':scope > div[id^="nav-"]');
    if (explicit.length) return Array.prototype.slice.call(explicit);

    // Otherwise build synthetic groups from runs of contiguous .ni siblings, split by any non-.ni node.
    const groups = [];
    let current = null;
    const children = Array.prototype.slice.call(nav.children);
    children.forEach(function (child) {
      if (child.classList && child.classList.contains('ni')) {
        if (!current) {
          current = document.createElement('div');
          current.setAttribute('data-nav-auto-group', String(groups.length));
          nav.insertBefore(current, child);
          current.appendChild(child);
          groups.push(current);
        } else {
          current.appendChild(child);
        }
      } else {
        current = null;
      }
    });
    return groups;
  }

  function injectStyle() {
    if (document.getElementById('nav-drag-style')) return;
    const s = document.createElement('style');
    s.id = 'nav-drag-style';
    s.textContent =
      '.ni.nav-drag-over-top{border-top:2px solid #111827;border-radius:0}' +
      '.ni.nav-drag-over-bot{border-bottom:2px solid #111827;border-radius:0}' +
      '.ni.nav-dragging{opacity:.4}' +
      '.ni[draggable=true]{cursor:grab}' +
      '.ni.nav-dragging{cursor:grabbing}';
    document.head.appendChild(s);
  }

  function init() {
    const aside = document.querySelector('aside.sidebar');
    if (!aside) return;
    const nav = aside.querySelector('nav');
    if (!nav) return;

    const role = getRoleKey();
    const storageKey = 'eg_nav_order_' + role;
    const groups = detectGroups(nav);
    if (!groups.length) return;

    // Apply saved order if any (best-effort; missing keys are skipped).
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      groups.forEach(function (g, gi) {
        const order = saved['g' + gi];
        if (!Array.isArray(order)) return;
        const items = Array.prototype.slice.call(g.querySelectorAll('.ni'));
        const byKey = {};
        items.forEach(function (it) { byKey[itemKey(it)] = it; });
        order.forEach(function (k) { if (byKey[k]) g.appendChild(byKey[k]); });
      });
    } catch (e) {}

    function persist() {
      const data = {};
      groups.forEach(function (g, gi) {
        data['g' + gi] = Array.prototype.slice.call(g.querySelectorAll('.ni')).map(itemKey);
      });
      try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch (e) {}
    }

    injectStyle();

    let drag = null, dragGroupIdx = null;
    groups.forEach(function (group, gi) {
      const items = group.querySelectorAll('.ni');
      items.forEach(function (el) {
        el.setAttribute('draggable', 'true');
        el.addEventListener('dragstart', function (e) {
          drag = this; dragGroupIdx = gi;
          this.classList.add('nav-dragging');
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        el.addEventListener('dragend', function () {
          this.classList.remove('nav-dragging');
          document.querySelectorAll('.ni').forEach(function (n) {
            n.classList.remove('nav-drag-over-top','nav-drag-over-bot');
          });
          drag = null; dragGroupIdx = null;
        });
        el.addEventListener('dragover', function (e) {
          e.preventDefault();
          if (!drag || drag === this || dragGroupIdx !== gi) return;
          document.querySelectorAll('.ni').forEach(function (n) {
            n.classList.remove('nav-drag-over-top','nav-drag-over-bot');
          });
          const rect = this.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          this.classList.add(e.clientY < mid ? 'nav-drag-over-top' : 'nav-drag-over-bot');
        });
        el.addEventListener('dragleave', function () {
          this.classList.remove('nav-drag-over-top','nav-drag-over-bot');
        });
        el.addEventListener('drop', function (e) {
          e.preventDefault();
          this.classList.remove('nav-drag-over-top','nav-drag-over-bot');
          if (!drag || drag === this || dragGroupIdx !== gi) return;
          const rect = this.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          if (e.clientY < mid) group.insertBefore(drag, this);
          else group.insertBefore(drag, this.nextSibling);
          persist();
        });
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());

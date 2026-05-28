/* EGFULFILL — Draggable dashboard/overview cards.
   Auto-discovers grids of `.wcard` (any parent with >=2 direct .wcard children),
   makes them drag-to-reorder (immediate, like the seller dashboard), and persists
   the order to localStorage keyed per board + grid. Drop-in, no per-card markup:
   include <script src="dashboard-drag.js"></script> at end of body. */
(function () {
  if (typeof window === 'undefined' || !document.querySelector) return;

  // Per-board key (role badge near the logo, else the page filename).
  function roleKey() {
    var badge = document.querySelector('aside.sidebar, .sidebar');
    var txt = (badge ? badge.textContent : '') || '';
    var ROLES = ['WAREHOUSE', 'ADMIN', 'OPERATOR', 'DESIGNER', 'FACTORY', 'SELLER'];
    for (var i = 0; i < ROLES.length; i++) if (txt.toUpperCase().indexOf(ROLES[i]) !== -1) return ROLES[i].toLowerCase();
    return (location.pathname.split('/').pop() || 'board').replace(/\.html$/, '');
  }

  var dragging = null;

  // Inject the drag visuals once (so no per-board CSS is needed).
  function injectCss() {
    if (document.getElementById('eg-dashdrag-css')) return;
    var s = document.createElement('style'); s.id = 'eg-dashdrag-css';
    s.textContent =
      '.wcard[draggable="true"]{cursor:grab}' +
      '.wcard.eg-dragging{opacity:.45;cursor:grabbing}' +
      '.wcard.eg-drag-over{outline:2px dashed #191918;outline-offset:-2px}' +
      'html[data-theme=dark] .wcard.eg-drag-over{outline-color:#c9c3ba}';
    document.head.appendChild(s);
  }

  function gridChildren(grid) {
    return [].filter.call(grid.children, function (c) { return c.classList && c.classList.contains('wcard'); });
  }
  function gridKey(grid, idx) { return 'eg_dashorder_' + roleKey() + '_' + (grid.id || ('g' + idx)); }

  function saveOrder(grid, idx) {
    try {
      var ids = gridChildren(grid).map(function (c) { return c.id; });
      if (ids.every(Boolean)) localStorage.setItem(gridKey(grid, idx), JSON.stringify(ids));
    } catch (_) {}
  }
  function restoreOrder(grid, idx) {
    try {
      var saved = JSON.parse(localStorage.getItem(gridKey(grid, idx)) || 'null');
      if (!saved || !saved.length) return;
      // Re-append in saved order (only ids that still exist).
      saved.forEach(function (id) {
        var el = id && document.getElementById(id);
        if (el && el.parentElement === grid) grid.appendChild(el);
      });
    } catch (_) {}
  }

  function wire(grid, idx) {
    gridChildren(grid).forEach(function (c) {
      if (c._egDrag) return; c._egDrag = true;
      c.setAttribute('draggable', 'true');
      c.addEventListener('dragstart', function (e) {
        dragging = c; e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', c.id || 'card'); } catch (_) {}
        setTimeout(function () { c.classList.add('eg-dragging'); }, 0);
      });
      c.addEventListener('dragover', function (e) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        if (dragging && dragging !== c && dragging.parentElement === grid) c.classList.add('eg-drag-over');
      });
      c.addEventListener('dragleave', function () { c.classList.remove('eg-drag-over'); });
      c.addEventListener('drop', function (e) {
        e.preventDefault(); c.classList.remove('eg-drag-over');
        if (!dragging || dragging === c || dragging.parentElement !== grid) return;
        var cards = [].slice.call(grid.children);
        var fi = cards.indexOf(dragging), ti = cards.indexOf(c);
        if (fi < ti) grid.insertBefore(dragging, c.nextSibling); else grid.insertBefore(dragging, c);
        saveOrder(grid, idx);
      });
      c.addEventListener('dragend', function () {
        if (dragging) dragging.classList.remove('eg-dragging');
        [].forEach.call(document.querySelectorAll('.eg-drag-over'), function (el) { el.classList.remove('eg-drag-over'); });
        dragging = null;
      });
    });
  }

  function findGrids() {
    var grids = [], seen = [];
    [].forEach.call(document.querySelectorAll('.wcard'), function (w) {
      var p = w.parentElement;
      if (!p || seen.indexOf(p) !== -1) return;
      seen.push(p);
      if (gridChildren(p).length >= 2) grids.push(p);
    });
    return grids;
  }

  function init() {
    injectCss();
    findGrids().forEach(function (grid, idx) { restoreOrder(grid, idx); wire(grid, idx); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

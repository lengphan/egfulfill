/* egfulfill-drag.js — live-swap drag-and-drop for dashboard widget grids.
   Siblings animate aside (FLIP) as the dragged card crosses their midpoint.
   No destination outline. Drag handle reveals on hover; no edit mode required.

   Usage: <script src="egfulfill-drag.js"></script>
   Grids auto-armed by id: #wgrid, #dsn-overview-grid.
   Override-arm anything with EGDrag.arm(gridElOrSelector). */
(function (global) {
  'use strict';

  var dragging = null;
  var ARMED = new WeakSet();

  function injectStyles() {
    if (document.getElementById('egfulfill-drag-styles')) return;
    var s = document.createElement('style');
    s.id = 'egfulfill-drag-styles';
    s.textContent =
      /* Drag-handle reveals on card hover (no edit-mode required) */
      '.wcard:hover .drag-handle,#section-overview .wcard:hover .drag-handle,#wgrid .wcard:hover .drag-handle,#dsn-overview-grid .wcard:hover .drag-handle{display:flex!important}\n' +
      /* Kill the thick destination outline / glow — live swap replaces it */
      '.wcard.drag-over,#section-overview .wcard.drag-over,#wgrid .wcard.drag-over{outline:none!important;box-shadow:0 1px 3px rgba(0,0,0,.05)!important}\n' +
      /* Source-card fade while dragging; no scale (would conflict with FLIP siblings) */
      '.wcard.dragging,#section-overview .wcard.dragging{opacity:.4!important;cursor:grabbing;transform:none!important}\n' +
      /* Remove edit-mode dashed outline if present */
      '#section-overview .edit-mode .wcard,#wgrid.edit-mode .wcard,.edit-mode .wcard{outline:none!important}\n';
    (document.head || document.documentElement).appendChild(s);
  }

  function startDrag(e) {
    var t = e.target.closest('.wcard');
    if (!t || t.parentElement !== this) return;
    dragging = t;
    setTimeout(function () { dragging && dragging.classList.add('dragging'); }, 0);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id || 'card');
    } catch (_) {}
  }

  function overDrag(e) {
    if (!dragging) return;
    e.preventDefault();
    var t = e.target.closest('.wcard');
    if (!t || t === dragging || t.parentElement !== dragging.parentElement) return;

    var r = t.getBoundingClientRect();
    var after = (e.clientX - r.left) > r.width / 2;
    var next = after ? t.nextElementSibling : t;
    if (next === dragging || dragging.nextElementSibling === next) return;

    var grid = dragging.parentElement;
    var siblings = [];
    var before = new Map();
    for (var i = 0; i < grid.children.length; i++) {
      var c = grid.children[i];
      if (c === dragging) continue;
      siblings.push(c);
      before.set(c, c.getBoundingClientRect());
    }
    grid.insertBefore(dragging, next);
    siblings.forEach(function (c) {
      var oldR = before.get(c);
      var newR = c.getBoundingClientRect();
      var dx = oldR.left - newR.left;
      var dy = oldR.top - newR.top;
      if (dx === 0 && dy === 0) return;
      c.style.transition = 'none';
      c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      requestAnimationFrame(function () {
        c.style.transition = 'transform .22s cubic-bezier(.22,1,.36,1)';
        c.style.transform = '';
      });
    });
  }

  function endDrag() {
    if (dragging) { dragging.classList.remove('dragging'); dragging = null; }
    document.querySelectorAll('.wcard').forEach(function (c) {
      if (c.style.transition || c.style.transform) {
        c.style.transition = '';
        c.style.transform = '';
      }
    });
  }

  function arm(target) {
    var grid = (typeof target === 'string') ? document.querySelector(target) : target;
    if (!grid || ARMED.has(grid)) return;
    ARMED.add(grid);
    grid.querySelectorAll('.wcard').forEach(function (c) { c.draggable = true; });
    grid.addEventListener('dragstart', startDrag);
    grid.addEventListener('dragover', overDrag);
    grid.addEventListener('drop', function (e) { e.preventDefault(); });
    grid.addEventListener('dragend', endDrag);
  }

  function armAll() {
    injectStyles();
    document.querySelectorAll('#wgrid,#dsn-overview-grid').forEach(arm);
    /* Neutralize legacy inline handlers (ds/do_/dp/dl/de) so the edit-mode
       gate in existing pages no longer blocks drag. Delegated listeners on
       the grid handle the real work. */
    var noop = function () {};
    var prevent = function (e) { if (e && e.preventDefault) e.preventDefault(); };
    global.ds = noop;
    global.do_ = prevent;
    global.dl = noop;
    global.dp = prevent;
    global.de = noop;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', armAll);
  else armAll();

  global.EGDrag = { arm: arm, armAll: armAll };
})(window);

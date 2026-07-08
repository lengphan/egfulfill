/* eg-cursor.js — a crisp PIXEL-ARROW cursor for the app (Tavus/retro vibe).
   Self-contained: adds its own class + element, hides the system pointer, and follows the
   mouse with a hand-built pixel arrow (black fill + auto-generated white outline). It steps
   ASIDE over text inputs so typing still shows a native caret, and no-ops on touch devices.
   Load once per page:  <script src="eg-cursor.js" defer></script>  */
(function () {
  'use strict';
  if (window.__egCursor) return; window.__egCursor = 1;
  try { if (matchMedia('(pointer:coarse)').matches) return; } catch (e) {}   // touch → keep native

  // Classic pointer bitmap (1 = fill). White outline is derived from the 8-neighbourhood.
  var A = [
    [1,0,0,0,0,0,0,0,0,0,0],[1,1,0,0,0,0,0,0,0,0,0],[1,1,1,0,0,0,0,0,0,0,0],
    [1,1,1,1,0,0,0,0,0,0,0],[1,1,1,1,1,0,0,0,0,0,0],[1,1,1,1,1,1,0,0,0,0,0],
    [1,1,1,1,1,1,1,0,0,0,0],[1,1,1,1,1,1,1,1,0,0,0],[1,1,1,1,1,1,1,1,1,0,0],
    [1,1,1,1,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,0,0,0,0],[1,1,1,0,1,1,1,0,0,0,0],
    [1,1,0,0,0,1,1,1,0,0,0],[1,0,0,0,0,1,1,1,0,0,0],[0,0,0,0,0,0,1,1,1,0,0],
    [0,0,0,0,0,0,1,1,1,0,0],[0,0,0,0,0,0,0,1,1,0,0]
  ];
  function arrowSVG() {
    var H = A.length, W = A[0].length, r = '';
    function fa(x, y) { return y >= 0 && y < H && x >= 0 && x < W && A[y][x]; }
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (A[y][x]) r += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="#2f4bf0"/>';
      else if (fa(x-1,y)||fa(x+1,y)||fa(x,y-1)||fa(x,y+1)||fa(x-1,y-1)||fa(x+1,y-1)||fa(x-1,y+1)||fa(x+1,y+1))
        r += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="#fff"/>';
    }
    return '<svg width="' + (W * 1.95) + '" height="' + (H * 1.95) + '" viewBox="0 0 ' + W + ' ' + H +
      '" shape-rendering="crispEdges" style="display:block;filter:drop-shadow(1px 1.5px 0 rgba(0,0,0,.3))">' + r + '</svg>';
  }

  var st = document.createElement('style');
  st.textContent =
    'html.eg-pixcur,html.eg-pixcur *{cursor:none!important}' +
    'html.eg-pixcur input,html.eg-pixcur textarea,html.eg-pixcur select,html.eg-pixcur [contenteditable="true"]{cursor:auto!important}' +
    '#eg-pixcur{position:fixed;top:0;left:0;pointer-events:none;z-index:2147483000;opacity:0;will-change:transform}';
  document.head.appendChild(st);

  var el = document.createElement('div'); el.id = 'eg-pixcur'; el.innerHTML = arrowSVG();
  function mount() { document.documentElement.classList.add('eg-pixcur'); (document.body || document.documentElement).appendChild(el); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  var shown = false;
  window.addEventListener('mousemove', function (e) {
    if (!shown) { shown = true; }
    el.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    // over a text field → hide the arrow so the native caret shows
    var t = e.target, inField = t && t.closest && t.closest('input,textarea,select,[contenteditable="true"]');
    el.style.opacity = inField ? '0' : '1';
  }, { passive: true });
  window.addEventListener('mouseleave', function () { el.style.opacity = '0'; });
  window.addEventListener('mouseenter', function () { el.style.opacity = '1'; });

  // let a page opt out at runtime: EGCursor.off() / EGCursor.on()
  window.EGCursor = {
    on: function () { document.documentElement.classList.add('eg-pixcur'); el.style.display = ''; },
    off: function () { document.documentElement.classList.remove('eg-pixcur'); el.style.display = 'none'; }
  };
})();

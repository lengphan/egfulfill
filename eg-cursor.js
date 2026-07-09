/* eg-cursor.js — a crisp PIXEL-ARROW cursor for the app (Tavus/retro vibe).
   It renders a cobalt pixel arrow (auto white outline) to a canvas ONCE and sets it as the
   real CSS cursor via `cursor:url(png) 0 0, auto`. Because it's the actual cursor:
     • it can never "disappear" — if a browser can't use the image it falls back to the system arrow,
     • there's no follower div to lag or fail,
     • text fields keep a native caret.
   No-ops on touch. Load once per page:  <script src="eg-cursor.js" defer></script>  */
(function () {
  'use strict';
  if (window.__egCursor) return; window.__egCursor = 1;
  try { if (matchMedia('(pointer:coarse)').matches) return; } catch (e) {}   // touch → keep native

  // Classic pointer bitmap (1 = fill). White outline derived from the 8-neighbourhood.
  // Straight vertical LEFT edge (col 0), a smooth 45° hypotenuse, and a tail that runs
  // parallel to it — no zig-zag on the right edge (that read as "crooked"). Tip = 0,0.
  // Classic arrow: straight vertical LEFT edge + a DIAGONAL tail that comes straight OUT of the
  // middle of the (slanted) head, down-right along the arrow's axis — not a vertical stem. Small. Tip = 0,0.
  var A = [
    [1,0,0,0,0,0,0,0],
    [1,1,0,0,0,0,0,0],
    [1,1,1,0,0,0,0,0],
    [1,1,1,1,0,0,0,0],
    [1,1,1,1,1,0,0,0],
    [1,1,1,1,1,1,0,0],
    [1,1,1,1,1,1,1,0],
    [1,1,1,1,1,0,0,0],
    [1,1,0,0,1,1,0,0],
    [1,0,0,0,0,1,1,0],
    [0,0,0,0,0,0,1,1]
  ];
  var H = A.length, W = A[0].length, S = 2;   // 8×11 bitmap → 16×22px, crisp + small
  function fa(x, y) { return y >= 0 && y < H && x >= 0 && x < W && A[y][x]; }

  var url;
  try {
    var cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';                                   // white outline first
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (!A[y][x] && (fa(x-1,y)||fa(x+1,y)||fa(x,y-1)||fa(x,y+1)||fa(x-1,y-1)||fa(x+1,y-1)||fa(x-1,y+1)||fa(x+1,y+1)))
        ctx.fillRect(x*S, y*S, S, S);
    }
    ctx.fillStyle = '#2f4bf0';                                // cobalt fill on top
    for (var y2 = 0; y2 < H; y2++) for (var x2 = 0; x2 < W; x2++) { if (A[y2][x2]) ctx.fillRect(x2*S, y2*S, S, S); }
    url = cv.toDataURL('image/png');
  } catch (e) { return; }   // canvas blocked → leave the native cursor

  var st = document.createElement('style'); st.id = 'eg-cursor-css';
  st.textContent =
    'html.eg-pixcur,html.eg-pixcur *{cursor:url(' + url + ') 0 0, auto !important}' +
    // text entry keeps a real caret; disabled/loading states keep their own cursor
    'html.eg-pixcur input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]),' +
    'html.eg-pixcur textarea,html.eg-pixcur [contenteditable="true"]{cursor:text !important}' +
    'html.eg-pixcur [disabled],html.eg-pixcur .cursor-wait{cursor:default !important}';
  document.head.appendChild(st);
  document.documentElement.classList.add('eg-pixcur');

  window.EGCursor = {
    on: function () { document.documentElement.classList.add('eg-pixcur'); },
    off: function () { document.documentElement.classList.remove('eg-pixcur'); }
  };
})();

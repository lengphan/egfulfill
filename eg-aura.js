/* eg-aura.js — ambient "aura" background: a soft VIOLET HALFTONE DOT SCREEN. Self-mounts a
   fixed full-viewport canvas BEHIND the page content (lifts real body children above it) and
   lays a soft paper mask over the centre so foreground text stays readable. Dots grow in on
   load, then drift very gently. Respects prefers-reduced-motion (paints one static frame).
   Usage: <script src="eg-aura.js" defer></script>  (no markup needed). */
(function () {
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;

  function mount() {
    if (!document.body || document.getElementById('eg-aura')) return;
    var c = document.createElement('canvas');
    c.id = 'eg-aura';
    c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none;opacity:.9';
    var m = document.createElement('div');
    m.id = 'eg-aura-mask';
    // soft paper wash: strong over the centre (readable form), light at the edges (aura shows)
    m.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(100% 82% at 50% 42%,rgba(251,250,248,.9) 0%,rgba(251,250,248,.66) 50%,rgba(251,250,248,.4) 100%)';
    document.body.insertBefore(m, document.body.firstChild);
    document.body.insertBefore(c, document.body.firstChild);
    // lift the real content above the aura layers
    [].slice.call(document.body.children).forEach(function (el) {
      if (el.id === 'eg-aura' || el.id === 'eg-aura-mask') return;
      var cs = getComputedStyle(el);
      if (cs.position === 'static') el.style.position = 'relative';
      if (cs.zIndex === 'auto') el.style.zIndex = '1';
    });
    run(c);
  }

  function run(c) {
    var x = c.getContext('2d'), W, H, t0 = null, last = 0;
    var STEP = 15, RMAX = STEP * 0.62;              // dot grid pitch + max radius
    function size() { W = c.width = innerWidth; H = c.height = innerHeight; }
    function frame(ts) {
      if (t0 === null) t0 = ts;
      if (!RM && ts - last < 45) { requestAnimationFrame(frame); return; }  // ~22fps throttle
      last = ts;
      var el = (ts - t0) / 1000;
      var grow = Math.min(1, el / 1.1);              // dots grow in over ~1.1s
      var tm = el * 0.08;                            // barely-there drift
      x.clearRect(0, 0, W, H);
      for (var yy = STEP / 2; yy < H + STEP; yy += STEP) {
        for (var xx = STEP / 2; xx < W + STEP; xx += STEP) {
          // smooth organic tone field 0..1
          var f = 0.5 + 0.34 * Math.sin(xx * 0.010 + tm)
                      + 0.34 * Math.sin(yy * 0.012 - tm * 0.8)
                      + 0.32 * Math.sin((xx + yy) * 0.006 + tm * 0.5);
          f = f < 0 ? 0 : f > 1 ? 1 : f;
          var r = RMAX * f * grow;
          if (r < 0.5) continue;
          x.beginPath();
          x.arc(xx, yy, r, 0, 6.2832);
          x.fillStyle = 'rgba(159,82,224,' + (0.10 + 0.24 * f) + ')';  // soft violet, low alpha
          x.fill();
        }
      }
      if (RM) return;                               // reduced-motion: one static frame
      requestAnimationFrame(frame);
    }
    size();
    addEventListener('resize', size);
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

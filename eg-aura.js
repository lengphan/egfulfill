/* eg-aura.js — ambient "aura" background: a procedural violet Bayer-dither field that
   resolves coarse->fine on load then drifts. Self-mounts a fixed full-viewport canvas
   BEHIND the page content (lifts real body children above it) and lays a soft paper mask
   over the centre so foreground text stays readable. Respects prefers-reduced-motion.
   Usage: <script src="eg-aura.js" defer></script>  (no markup needed). */
(function () {
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;

  function mount() {
    if (!document.body || document.getElementById('eg-aura')) return;
    var c = document.createElement('canvas');
    c.id = 'eg-aura';
    c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;image-rendering:pixelated;pointer-events:none';
    var m = document.createElement('div');
    m.id = 'eg-aura-mask';
    m.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(96% 78% at 50% 46%,rgba(251,250,248,.88) 0%,rgba(251,250,248,.52) 56%,rgba(251,250,248,.24) 100%)';
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
    var x = c.getContext('2d'), W, H, S = 6, t0 = null;
    var bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    function size() { W = Math.ceil(innerWidth / S); H = Math.ceil(innerHeight / S); c.width = W; c.height = H; }
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var el = (ts - t0) / 1000;
      var resolve = Math.min(1, el / 1.8);        // coarse -> fine over ~1.8s
      var levels = 2 + Math.round(resolve * 3);   // 2 -> 5 colour steps
      var tm = el * 0.30;                          // slow drift
      var img = x.createImageData(W, H), d = img.data;
      for (var j = 0; j < H; j++) for (var i = 0; i < W; i++) {
        var v = 0.5 + 0.5 * Math.sin(i * 0.09 + tm) + 0.5 * Math.sin(j * 0.11 - tm * 0.8) + 0.5 * Math.sin((i + j) * 0.05 + tm * 0.5);
        v /= 2.0;
        var th = (bayer[j & 3][i & 3] + 0.5) / 16;
        var q = Math.floor((v + (th - 0.5) / levels) * levels) / (levels - 1 || 1);
        q = q < 0 ? 0 : q > 1 ? 1 : q;
        var p = (j * W + i) * 4;
        d[p]     = Math.round(251 + q * (159 - 251)); // paper -> violet R
        d[p + 1] = Math.round(250 + q * (82 - 250));  // G
        d[p + 2] = Math.round(248 + q * (224 - 248)); // B
        d[p + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      if (RM) return;                              // reduced-motion: paint one static frame
      requestAnimationFrame(frame);
    }
    size();
    addEventListener('resize', size);
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

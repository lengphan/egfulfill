/* eg-dither.js — brand dithering engine (dependency-free, offline, no external image service).
 *
 * Ordered (Bayer 8×8) dithering that maps a light-field OR a real image through the EGFULFILL palette
 * (ink → violet-dk → violet → POP → paper), giving the modern-retro digital look with a swappable pop.
 *
 * USE — declarative (auto-initialised on DOMContentLoaded, re-rendered on resize):
 *   <div data-dither="art"   data-pop="#ff5c39"></div>                 // procedural art
 *   <div data-dither="image" data-src="hero.jpg" data-pop="#8b5cf6"></div>  // dither a photo
 *   optional: data-pixel="4" (cell size) · data-seed="7" · data-fit="cover|contain"
 *
 * USE — programmatic:
 *   EGDither.art(canvasOrEl, { pop:'#12b886', pixel:4, seed:7 });
 *   EGDither.image(canvasOrEl, 'photo.jpg', { pop:'#8b5cf6', pixel:3, fit:'cover', contrast:1.1 });
 *   EGDither.mount(el, { mode:'art', pop:'#ff5c39' });   // makes+sizes a canvas, re-renders on resize
 *   EGDither.paletteFor('#ff5c39');                       // → [[r,g,b]×5] dark→light
 */
(function (global) {
  'use strict';

  // Bayer 8×8 threshold matrix, normalised to (0,1).
  var BAYER = [
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]
  ].map(function (r) { return r.map(function (v) { return (v + 0.5) / 64; }); });

  // Brand ramp (dark → light). The middle slot is the swappable "pop"; the rest is locked to the theme.
  var INK = [25, 25, 24], VIO_DK = [124, 58, 237], VIO = [139, 92, 246], PAPER = [240, 237, 230];

  var POPS = { violet: '#8b5cf6', coral: '#ff5c39', teal: '#12b886', amber: '#ffd43b', blue: '#4c6ef5', pink: '#f06595' };

  // Named FULL palettes (dark→light). The muted grey/beige/black ramps read like the Tavus starter-kit
  // photos — desaturated, no colour dominance. Use these for card imagery; use `pop` names for accent art.
  var PALETTES = {
    noir:  [[25, 25, 24], [64, 64, 61], [120, 118, 112], [190, 186, 178], [240, 237, 230]],  // ink→grey→beige→paper
    paper: [[45, 42, 39], [108, 104, 98], [168, 162, 152], [214, 210, 201], [244, 242, 238]], // warm beige ramp
    slate: [[20, 22, 26], [58, 62, 70], [116, 122, 132], [182, 186, 194], [236, 238, 242]],   // cool grey ramp
    // muted grey/beige with a single faint violet lift (grey-dominant, subtle brand tint)
    dusk:  [[25, 25, 24], [58, 56, 64], [120, 116, 128], [176, 170, 186], [240, 237, 230]]
  };

  function hex(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  }
  // Resolve to a luminance-ordered 5-stop palette: a named full palette (noir/paper/slate/dusk),
  // or ink · violet-dk · violet · POP · paper for a colour pop.
  function paletteFor(pop) {
    if (PALETTES[pop]) return PALETTES[pop].slice();
    var P = POPS[pop] || pop || POPS.violet;
    return [INK, VIO_DK, VIO, hex(P), PAPER];
  }

  var lum = function (r, g, b) { return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

  // Quantise a low-res grayscale/colour buffer through `palette` with Bayer dithering, in place.
  function ditherBuffer(d, w, h, palette) {
    var n = palette.length - 1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var lvl = lum(d[i], d[i + 1], d[i + 2]) * n, lo = Math.floor(lvl), frac = lvl - lo;
        var idx = frac > BAYER[y & 7][x & 7] ? Math.min(lo + 1, n) : lo;
        var c = palette[idx];
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
  }

  // Resolve a canvas from a <canvas> or a container element (create+append a canvas sized to the box).
  function canvasOf(target) {
    if (!target) return null;
    if (target.tagName === 'CANVAS') return target;
    // the container needs to be a positioning context so the canvas can be absolute (out of flow)
    try { if (getComputedStyle(target).position === 'static') target.style.position = 'relative'; } catch (e) {}
    var c = target.querySelector('canvas[data-egd]');
    if (!c) {
      c = document.createElement('canvas'); c.setAttribute('data-egd', '1');
      // absolute + inset:0 fills the parent WITHOUT contributing to its height — otherwise an in-flow
      // canvas at height:100% feeds back through the ResizeObserver, growing a grid/flex cell unboundedly
      // and pushing sibling content (the login form) down. This was the "fields jump down" bug.
      c.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';
      target.appendChild(c);
    }
    var r = target.getBoundingClientRect();
    c.width = Math.max(1, Math.round(r.width || target.clientWidth || 300));
    c.height = Math.max(1, Math.round(r.height || target.clientHeight || 300));
    return c;
  }

  // Seeded PRNG (deterministic art when a seed is given).
  function prng(seed) { var s = (seed | 0) || 1; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

  // ── Procedural art: soft seeded blobs → dithered through the palette. ──
  function art(target, opts) {
    opts = opts || {};
    var canvas = canvasOf(target); if (!canvas) return;
    var W = canvas.width, H = canvas.height, px = opts.pixel || 4;
    var cw = Math.max(1, Math.ceil(W / px)), ch = Math.max(1, Math.ceil(H / px));
    var off = document.createElement('canvas'); off.width = cw; off.height = ch;
    var o = off.getContext('2d');
    var rnd = prng(opts.seed != null ? opts.seed : Math.floor((Date.now ? 1 : 1) * 7 + cw)); // seed or size-derived
    var g = o.createLinearGradient(0, 0, cw, ch); g.addColorStop(0, '#fff'); g.addColorStop(1, '#111');
    o.fillStyle = g; o.fillRect(0, 0, cw, ch);
    var blobs = opts.blobs || 5;
    for (var b = 0; b < blobs; b++) {
      var rx = rnd() * cw, ry = rnd() * ch, rr = (0.26 + rnd() * 0.42) * cw;
      var rg = o.createRadialGradient(rx, ry, 0, rx, ry, rr);
      rg.addColorStop(0, rnd() > 0.5 ? 'rgba(255,255,255,.92)' : 'rgba(0,0,0,.85)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = rg; o.fillRect(0, 0, cw, ch);
    }
    var img = o.getImageData(0, 0, cw, ch);
    ditherBuffer(img.data, cw, ch, opts.palette || paletteFor(opts.pop));
    o.putImageData(img, 0, 0);
    blit(canvas, off, cw, ch);
  }

  // ── Real image: cover/contain-fit a photo, optional contrast, dither through the palette. ──
  function image(target, src, opts) {
    opts = opts || {};
    var canvas = canvasOf(target); if (!canvas) return;
    var run = function (im) {
      var W = canvas.width, H = canvas.height, px = opts.pixel || 3;
      var cw = Math.max(1, Math.ceil(W / px)), ch = Math.max(1, Math.ceil(H / px));
      var off = document.createElement('canvas'); off.width = cw; off.height = ch;
      var o = off.getContext('2d');
      // fit
      var iw = im.width || im.naturalWidth, ih = im.height || im.naturalHeight;
      var s = (opts.fit === 'contain') ? Math.min(cw / iw, ch / ih) : Math.max(cw / iw, ch / ih);
      var dw = iw * s, dh = ih * s;
      o.fillStyle = '#111'; o.fillRect(0, 0, cw, ch);
      o.drawImage(im, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      var img = o.getImageData(0, 0, cw, ch), d = img.data;
      var k = opts.contrast || 1;
      if (k !== 1) for (var i = 0; i < d.length; i += 4) { for (var c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, (d[i + c] - 128) * k + 128)); }
      ditherBuffer(d, cw, ch, opts.palette || paletteFor(opts.pop));
      o.putImageData(img, 0, 0);
      blit(canvas, off, cw, ch);
    };
    if (src && src.tagName) { (src.complete ? run(src) : src.addEventListener('load', function () { run(src); })); return; }
    var im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = function () { run(im); };
    im.onerror = function () { art(target, opts); };   // graceful: fall back to procedural art
    im.src = src;
  }

  // Nearest-neighbour scale the low-res buffer up to the display canvas (chunky pixels).
  function blit(canvas, off, cw, ch) {
    canvas.style.imageRendering = 'pixelated';
    var cx = canvas.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.clearRect(0, 0, canvas.width, canvas.height);
    cx.drawImage(off, 0, 0, cw, ch, 0, 0, canvas.width, canvas.height);
  }

  // Mount into a container + keep it sized to the box (re-render on resize, debounced).
  function mount(el, opts) {
    opts = opts || {};
    var draw = function () { (opts.mode === 'image' ? image(el, opts.src, opts) : art(el, opts)); };
    draw();
    if (global.ResizeObserver) {
      var t, ro = new ResizeObserver(function () { clearTimeout(t); t = setTimeout(draw, 120); });
      ro.observe(el);
    }
    return { redraw: draw };
  }

  // Declarative auto-init: any [data-dither] element.
  function autoInit(root) {
    (root || document).querySelectorAll('[data-dither]').forEach(function (el) {
      if (el.__egdMounted) return; el.__egdMounted = true;
      var d = el.dataset;
      mount(el, {
        mode: d.dither === 'image' ? 'image' : 'art',
        src: d.src, pop: d.pop || 'violet',
        pixel: d.pixel ? +d.pixel : undefined,
        seed: d.seed ? +d.seed : undefined,
        fit: d.fit || 'cover',
        contrast: d.contrast ? +d.contrast : 1
      });
    });
  }

  var EGDither = { BAYER: BAYER, POPS: POPS, PALETTES: PALETTES, paletteFor: paletteFor, hex: hex, art: art, image: image, mount: mount, autoInit: autoInit, _dither: ditherBuffer };
  global.EGDither = EGDither;
  if (typeof module !== 'undefined' && module.exports) module.exports = EGDither;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { autoInit(); });
  else autoInit();

})(typeof window !== 'undefined' ? window : this);

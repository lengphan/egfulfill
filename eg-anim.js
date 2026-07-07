/* eg-anim.js — subtle Board OS motion, shared across boards. Opacity/transform only, so it
   can never corrupt content or layout. Respects prefers-reduced-motion (does nothing).
   - staggered load-in of above-the-fold cards
   - scroll-reveal of below-the-fold cards (IntersectionObserver)
   - count-up for any element tagged [data-count] (opt-in, safe with live hydration)
   Guard: only animates cards that are actually visible (offsetParent != null), so cards inside
   a hidden showSection panel are left alone and never get stuck at opacity:0. A 4s safety pass
   clears any lingering hidden state no matter what.
   Usage: <script src="eg-anim.js" defer></script> */
(function () {
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (RM) return;
  var CARD = '.wcard,.stat-card,.card,.ccard,.prod-card,.gw-card';
  var EASE = 'cubic-bezier(.2,.7,.2,1)';

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function prep(c, y) { c.style.opacity = '0'; c.style.transform = 'translateY(' + y + 'px)'; c.style.transition = 'opacity .6s ' + EASE + ',transform .6s ' + EASE; }
  function reveal(c) { c.style.opacity = ''; c.style.transform = ''; }

  ready(function () {
    var vh = innerHeight;
    var all = [].slice.call(document.querySelectorAll(CARD)).filter(function (c) { return c.offsetParent !== null; });
    var above = [], below = [];
    all.forEach(function (c) { var r = c.getBoundingClientRect(); (r.top < vh * 0.92 ? above : below).push(c); });

    // 1 — staggered load-in (bigger travel + a touch more delay so it's clearly visible)
    above.forEach(function (c, i) { prep(c, 24); setTimeout(function () { reveal(c); }, 80 + i * 80); });

    // 2 — scroll reveal
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); } });
      }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
      below.forEach(function (c) { prep(c, 16); io.observe(c); });
    } else { below.forEach(reveal); }

    // safety: never leave a card hidden
    setTimeout(function () { all.forEach(reveal); }, 4000);

    // 3 — count-up (opt-in): <span data-count="1284" data-post="%" data-dec="0">
    [].slice.call(document.querySelectorAll('[data-count]')).forEach(function (el) {
      var to = parseFloat(el.getAttribute('data-count')); if (!isFinite(to)) return;
      var pre = el.getAttribute('data-pre') || '', post = el.getAttribute('data-post') || '', dec = (el.getAttribute('data-dec') | 0);
      var t0 = null, dur = 1000;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = to * e;
        el.textContent = pre + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString()) + post;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  });
})();

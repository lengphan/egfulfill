/* Seller plan label sync — keeps every plan label across seller pages in sync
   with the active EGStore tier so an upgrade reflects everywhere without each
   page hardcoding "Starter Plan". Listens for eg-plan-changed (same tab) and
   the native storage event (cross-tab) so all open tabs update together. */
(function () {
  if (typeof EGStore === 'undefined' || !EGStore.getPlan) return;

  function planName() {
    var m = EGStore.getPlanMeta();
    return m && m.name ? m.name + ' Plan' : 'Starter Plan';
  }
  function nextMeta() {
    return (EGStore.getNextPlan && EGStore.getNextPlan()) || null;
  }
  function meta() { return EGStore.getPlanMeta(); }

  function apply() {
    var m = meta();
    var pn = planName();
    var pnUpper = pn.toUpperCase();
    var nm = nextMeta();

    // 1) Sidebar profile "Starter Plan" subtitle (small grey text).
    document.querySelectorAll('div').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (t === 'Starter Plan' || t === 'Pro Plan' || t === 'Enterprise Plan') {
        if (!el.firstElementChild) el.textContent = pn;
      }
    });

    // 2) Upgrade widget — uppercase plan label inside the small box.
    document.querySelectorAll('span').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (/^(STARTER|PRO|ENTERPRISE) PLAN$/i.test(t)) {
        el.textContent = pnUpper;
      }
    });

    // 3) Upgrade widget CTA: "Upgrade to Pro ↑" → next tier or "On <plan>".
    document.querySelectorAll('button').forEach(function (btn) {
      var t = (btn.textContent || '').trim();
      if (/^Upgrade to (Starter|Pro|Enterprise) ↑$/.test(t)) {
        if (nm) {
          btn.textContent = 'Upgrade to ' + nm.shortName + ' ↑';
          btn.disabled = false;
          btn.style.opacity = '';
          btn.style.cursor = 'pointer';
        } else {
          btn.textContent = 'You are on ' + m.shortName;
          btn.disabled = true;
          btn.style.opacity = '0.55';
          btn.style.cursor = 'default';
        }
      }
    });

    // 4) Settings.html billing card — dynamic rewrite of the static template.
    var billing = document.getElementById('panel-billing');
    if (billing) {
      // Plan badge in header
      billing.querySelectorAll('span').forEach(function (el) {
        var t = (el.textContent || '').trim();
        if (/^(Starter|Pro|Enterprise)$/.test(t) && /border-radius:\s*999px/i.test(el.getAttribute('style') || '')) {
          el.textContent = m.name;
        }
      });
      // Plan tagline in the big card
      billing.querySelectorAll('div').forEach(function (el) {
        var t = (el.textContent || '').trim();
        if (/^(Starter|Pro|Enterprise) Plan · Billed monthly$/.test(t)) {
          el.textContent = m.name + ' Plan · Billed monthly';
        }
      });
      // Price block — first <div> inside the big card with $X<span>/mo</span>
      billing.querySelectorAll('div').forEach(function (el) {
        if (el.children.length === 1 && /^\$\d+/.test((el.textContent || '').trim()) && /font-size:\s*33px/i.test(el.getAttribute('style') || '')) {
          el.innerHTML = '$' + (m.monthlyPrice || 0) + '<span style="font-size:15px;font-weight:400;color:#9ca3af">/mo</span>';
        }
      });
      // Feature line under the price
      billing.querySelectorAll('div').forEach(function (el) {
        var t = (el.textContent || '').trim();
        if (/orders\/month · \d+ store · Basic analytics$/.test(t) ||
            /\d[,\d]*\s+orders · \d+ stores · Full analytics · Priority support$/.test(t) ||
            /Unlimited orders · Unlimited stores · Dedicated manager$/.test(t)) {
          el.textContent = m.tagline;
        }
      });
      // Disable the matching upgrade button(s) when already at that tier.
      billing.querySelectorAll('button').forEach(function (btn) {
        var t = (btn.textContent || '').trim();
        if (t === 'Upgrade to Pro' && m.id === 'pro') {
          btn.textContent = 'Current Plan';
          btn.disabled = true;
          btn.style.opacity = '0.55';
          btn.style.cursor = 'default';
        }
        if (t === 'Upgrade to Pro' && m.id === 'enterprise') {
          btn.style.display = 'none';
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
  window.addEventListener('eg-plan-changed', apply);
  window.addEventListener('storage', function (e) {
    if (e.key === 'eg_seller_plan') apply();
  });
})();

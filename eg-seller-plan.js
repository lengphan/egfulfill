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

    // 4) Settings.html billing panel is now fully owned by renderBillingPlans() there (ID-driven:
    //    current plan on top, the other tiers as Downgrade/Upgrade cards below). We deliberately no
    //    longer text-rewrite it here — the two systems raced and the text-matcher clobbered the
    //    switch cards' taglines. Sections 1–3 above still sync the sidebar/upgrade widgets globally.
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

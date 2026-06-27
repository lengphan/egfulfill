/* eg-guard.js — client-side access lock for authenticated pages.

   Include as the FIRST script in <head> on every protected page:
       <script src="eg-guard.js"></script>

   Behaviour (runs synchronously, before the page renders):
     • Not signed in            → seller login by default; the STAFF login if this
                                   browser has been used by staff before (eg_staff_seen).
     • Signed in, wrong area     → bounced to the user's own dashboard.
     • Signed in, correct area   → page loads normally.

   Page levels are decided here by filename so a single identical <script> tag
   works everywhere. Pages not listed are public and get no guard. */
(function () {
  var STAFF_ROLES = { operator: 1, admin: 1, warehouse: 1, designer: 1 };

  // Staff-only factory boards.
  var STAFF_PAGES = { 'admin.html': 1, 'operator.html': 1, 'warehouse.html': 1, 'designer.html': 1 };
  // Seller-only app pages.
  var SELLER_PAGES = {
    'seller.html': 1, 'orders.html': 1, 'products-dash.html': 1,
    'analytics.html': 1, 'stores.html': 1, 'wallet.html': 1, 'settings.html': 1
  };
  // Shared pages — any signed-in user (seller ↔ factory). The design tools live here
  // too: the FACTORY boards open the seller's Design Lab / Design Maker in an overlay
  // (EGDesignTools.designLab/designMaker), so staff must be allowed to load them —
  // otherwise the guard bounced them to their dashboard and the overlay/cards broke.
  var ANY_PAGES = { 'order-detail.html': 1, 'chat.html': 1, 'design-lab.html': 1, 'design-maker.html': 1 };

  var DASH = { seller: 'seller.html', operator: 'operator.html', warehouse: 'warehouse.html', admin: 'admin.html', designer: 'designer.html' };

  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var level = STAFF_PAGES[page] ? 'staff' : (SELLER_PAGES[page] ? 'seller' : (ANY_PAGES[page] ? 'any' : null));
  if (!level) return; // public page — no guard

  var token = null, user = null;
  try { token = localStorage.getItem('eg_token'); } catch (e) {}
  try { user = JSON.parse(localStorage.getItem('eg_user') || 'null'); } catch (e) {}
  var isStaff = !!(user && STAFF_ROLES[user.role]);

  function go(url) { try { location.replace(url); } catch (e) { location.href = url; } }

  // Remember this is a staff browser so a later logged-out visit lands on the
  // staff login (not the seller one). Persists across logout intentionally.
  if (isStaff) { try { localStorage.setItem('eg_staff_seen', '1'); } catch (e) {} }

  // Not signed in → appropriate login. Seller login by default; staff login if a
  // staff token has ever been recorded on this browser.
  if (!token || !user || !user.role) {
    var staffSeen = false; try { staffSeen = localStorage.getItem('eg_staff_seen') === '1'; } catch (e) {}
    go(staffSeen ? 'login.html' : 'seller-login.html');
    return;
  }

  // Signed in but on the wrong kind of page → send to their own dashboard.
  var authorized = level === 'any' ? true : (level === 'staff' ? isStaff : user.role === 'seller');
  if (!authorized) { go(DASH[user.role] || 'seller-login.html'); return; }
  // authorized → allow the page to render.
})();

/* ── Cosmetic nav-permission hiding (COMPLETELY SEPARATE from the access lock above) ──
   Hides sidebar tabs a SELLER TEAM MEMBER isn't permitted to see. This NEVER redirects
   and NEVER blocks a page from loading — worst case a hidden tab is still reachable by
   typing its URL. It is DORMANT unless eg_user.permissions is a non-empty array, so every
   existing account (no permissions field) is completely unaffected. Fail-open on any error. */
(function () {
  // page filename → surface. seller.html / dashboard.html are intentionally absent so the
  // Dashboard is always shown (a member always has a landing tab).
  var SURFACE = {
    'orders.html': 'orders', 'order-detail.html': 'orders',
    'products-dash.html': 'products', 'product-templates.html': 'products',
    'design-lab.html': 'design', 'design-maker.html': 'design',
    'fulfillment.html': 'fulfillment',
    'analytics.html': 'analytics',
    'stores.html': 'stores',
    'wallet.html': 'wallet',
    'settings.html': 'settings',
    'chat.html': 'chat'
  };
  function apply() {
    try {
      var u = JSON.parse(localStorage.getItem('eg_user') || 'null');
      if (!u || u.role !== 'seller') return;                 // only seller team members
      var perms = Array.isArray(u.permissions) ? u.permissions : null;
      if (!perms || !perms.length) return;                   // FAIL-OPEN: no restriction set → show everything
      var links = document.querySelectorAll('a.ni[href]');
      for (var i = 0; i < links.length; i++) {
        var href = (links[i].getAttribute('href') || '').split('/').pop().split('#')[0].split('?')[0].toLowerCase();
        var surface = SURFACE[href];
        if (surface && perms.indexOf(surface) < 0) links[i].style.display = 'none';
      }
    } catch (e) { /* fail-open — never hide on error */ }
  }
  try { window.egApplyNavPerms = apply; } catch (e) {}   // re-runnable after a live permission refresh
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
  }
})();

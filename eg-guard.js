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
    'seller.html': 1, 'orders.html': 1, 'products-dash.html': 1, 'design-lab.html': 1,
    'design-maker.html': 1, 'analytics.html': 1, 'stores.html': 1, 'wallet.html': 1, 'settings.html': 1
  };
  // Shared pages — any signed-in user (seller ↔ factory).
  var ANY_PAGES = { 'order-detail.html': 1, 'chat.html': 1 };

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

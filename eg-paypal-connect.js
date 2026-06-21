/* eg-paypal-connect.js — "Log In with PayPal" (Connect) front-end glue.
   Shared by the designer payout module and the seller wallet. Pressing a PayPal
   button calls EGPayPal.login(), which asks the server for the PayPal authorize
   URL and navigates the browser to paypal.com's login/consent page. After the
   user approves, PayPal redirects back to the app with ?paypal=connected&email=…
   (or ?paypal=error&msg=…); EGPayPal.handleReturn() picks that up on page load. */
(function () {
  'use strict';
  function tok() { try { return localStorage.getItem('eg_token') || ''; } catch (e) { return ''; } }
  function base() { return window.EG_API_BASE || ''; }

  // Kick off the PayPal login redirect. returnPage = where PayPal should send the
  // user back (defaults to the current page). onUnavailable runs if the server
  // isn't configured / unreachable so the caller can fall back (e.g. manual email).
  function login(returnPage, onUnavailable) {
    var ret = returnPage || (location.pathname + location.search);
    fetch(base() + '/api/paypal/connect/start?return=' + encodeURIComponent(ret), { headers: tok() ? { Authorization: 'Bearer ' + tok() } : {} })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d && res.d.url) { window.location = res.d.url; return; }
        if (typeof onUnavailable === 'function') onUnavailable((res.d && res.d.error) || 'PayPal connect is unavailable');
      })
      .catch(function () { if (typeof onUnavailable === 'function') onUnavailable('Could not reach the server'); });
  }

  // On page load, consume a ?paypal=… return from PayPal. Cleans the query off the
  // URL so a refresh doesn't re-fire. Returns true if a return was handled.
  function handleReturn(onConnected, onError) {
    var p; try { p = new URLSearchParams(location.search); } catch (e) { return false; }
    var st = p.get('paypal'); if (!st) return false;
    var email = p.get('email') || '', msg = p.get('msg') || '';
    p.delete('paypal'); p.delete('email'); p.delete('msg');
    var clean = location.pathname + (p.toString() ? ('?' + p.toString()) : '') + location.hash;
    try { history.replaceState(null, '', clean); } catch (e) {}
    if (st === 'connected') { if (typeof onConnected === 'function') onConnected(email); return true; }
    if (typeof onError === 'function') onError(msg || 'connect failed');
    return true;
  }

  window.EGPayPal = { login: login, handleReturn: handleReturn };
})();

/* eg-addfunds.js — SHARED Add Funds (deposit) window: Stripe card vaulting + charge,
   PayPal full-page redirect, VietQR scan-to-pay, saved-cards picker, Linked Accounts.
   SINGLE SOURCE for the seller wallet page AND every page's header "Add Funds" button.
   Extracted verbatim from wallet.html (lines 1064-1929) so behaviour is identical.
   Depends on: Stripe.js (loaded per-page), EGStore (egfulfill-store.js). Page-specific
   globals (TX/STATS/currentPeriod/renderTx/updateStats) are referenced behind typeof
   guards / try-catch, so this is a no-op for them on pages that don't have them. */
/* ── Deposit modal ── */
function openDepositModal(amount, method) {
  document.getElementById('deposit-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Optional prefill so a caller (e.g. the PayPal panel's amount chips) can land the
  // seller straight on the gated payment for their chosen amount — no re-entering.
  try {
    if (method != null) { var mm = document.getElementById('modal-method'); if (mm) mm.value = method; }
    if (amount != null && amount !== '') { var ma = document.getElementById('modal-amount'); if (ma) ma.value = parseFloat(amount) || ''; }
  } catch (e) {}
  if (typeof vqrSyncDepositUI === 'function') vqrSyncDepositUI();
}
// Other seller pages redirect here with ?addfunds=1 so the header wallet opens
// the SAME full Add Funds modal (with the payment-method selector) everywhere.
(function () {
  function _maybeOpenAddFunds() {
    try {
      if (/[?&]addfunds=1\b/.test(location.search)) setTimeout(function(){
        openDepositModal();
        // Prefill amount + method when another page (e.g. the orders Add Funds modal)
        // hands off here so the seller lands on the real gated payment for their amount.
        try {
          var _q = new URLSearchParams(location.search);
          var _amt = _q.get('amount'), _meth = _q.get('method');
          var _ma = document.getElementById('modal-amount'); if (_amt && _ma) _ma.value = parseFloat(_amt) || '';
          var _mm = document.getElementById('modal-method'); if (_meth && _mm) _mm.value = _meth;
          if (typeof vqrSyncDepositUI === 'function') vqrSyncDepositUI();
        } catch (e) {}
      }, 60);
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _maybeOpenAddFunds);
  else _maybeOpenAddFunds();
})();
// Gear popover holding bank connections + auto-reload (keeps the main wallet clean).
function toggleWalletSettings(e) {
  if (e) e.stopPropagation();
  var pop = document.getElementById('wallet-settings-pop'), gear = document.getElementById('wallet-gear');
  if (!pop) return;
  var isOpen = pop.style.display !== 'none' && pop.style.display !== '';
  if (isOpen) { pop.style.display = 'none'; document.removeEventListener('mousedown', _walSettingsOutside); return; }
  if (gear) { var r = gear.getBoundingClientRect(); pop.style.top = (r.bottom + 8) + 'px'; pop.style.left = Math.max(8, r.right - 340) + 'px'; }
  pop.style.display = 'block';
  setTimeout(function () { document.addEventListener('mousedown', _walSettingsOutside); }, 0);
}
function _walSettingsOutside(ev) {
  var pop = document.getElementById('wallet-settings-pop'), gear = document.getElementById('wallet-gear');
  if (!pop) return;
  if (pop.contains(ev.target) || (gear && gear.contains(ev.target))) return;
  pop.style.display = 'none'; document.removeEventListener('mousedown', _walSettingsOutside);
}
window.toggleWalletSettings = toggleWalletSettings;

// ── Stripe card top-up (Payment Element) ─────────────────────────────────────
function closeCardModal() { var m = document.getElementById('card-modal'); if (m) m.style.display = 'none'; document.body.style.overflow = ''; }
function openCardTopUp() {
  var m = document.getElementById('card-modal');
  if (!m) {
    m = document.createElement('div'); m.id = 'card-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:500;align-items:center;justify-content:center;font-family:inherit';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) closeCardModal(); });
  }
  var _is = 'width:100%;border:1.5px solid #e5e4e0;border-radius:9px;padding:10px 12px;font-size:14.5px;font-family:inherit;outline:none;box-sizing:border-box;color:#191918';
  var _foc = 'onfocus="this.style.borderColor=\'#191918\'" onblur="this.style.borderColor=\'#e5e4e0\'"';
  var _lbl = 'font-size:12px;font-weight:700;color:#6b7280;display:block;margin-bottom:6px;letter-spacing:.03em';
  var _ccBox = 'border:1.5px solid #e5e4e0;border-radius:9px;padding:12px;min-height:46px;background:#fff';
  m.innerHTML =
    '<div onclick="closeCardModal()" style="position:fixed;inset:0;background:rgba(25,25,24,.5)"></div>'
    + '<div style="position:relative;background:#fdfcfa;border:1px solid #40403d;border-radius:18px;box-shadow:5px 5px 0 #40403d,0 28px 70px rgba(0,0,0,.3);width:780px;max-width:calc(100vw - 28px);max-height:94vh;overflow:auto;font-family:inherit">'
    +   '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid #ece8e0">'
    +     '<div><div style="font-size:17px;font-weight:800;color:#191918">Add New Card</div></div>'
    +     '<button onclick="closeCardModal()" style="background:none;border:none;cursor:pointer;color:#9ca3af;padding:5px;border-radius:7px" onmouseover="this.style.background=\'#f0ede9\'" onmouseout="this.style.background=\'transparent\'"><svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>'
    +   '</div>'
    +   '<div style="display:flex;gap:24px;flex-wrap:wrap;padding:22px 24px">'
    +     '<div style="flex:1 1 320px;min-width:280px;display:flex;flex-direction:column;gap:14px">'
    +       '<div><label style="' + _lbl + '">CARDHOLDER NAME</label><input id="cc-name" type="text" placeholder="JANE COOPER" oninput="ccUpdatePreview()" style="' + _is + ';text-transform:uppercase" ' + _foc + '></div>'
    +       '<div><label style="' + _lbl + '">CARD NUMBER</label><div id="cc-num" style="' + _ccBox + '"></div></div>'
    +       '<div style="display:flex;gap:12px"><div style="flex:1"><label style="' + _lbl + '">EXPIRY</label><div id="cc-exp-el" style="' + _ccBox + '"></div></div><div style="flex:1"><label style="' + _lbl + '">CVC</label><div id="cc-cvc-el" style="' + _ccBox + '"></div></div></div>'
    +       '<div id="cc-error" style="display:none;font-size:12.5px;color:#dc2626;font-weight:600;line-height:1.45"></div>'
    +       '<button id="cc-pay" onclick="ccSaveCard()" style="width:100%;background:#191918;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px;transition:opacity .15s" onmouseover="this.style.opacity=\'.88\'" onmouseout="this.style.opacity=\'1\'">Save Card</button>'
    +       '<div style="font-size:11.5px;color:#b0aaa4;text-align:center;display:flex;align-items:center;justify-content:center;gap:5px"><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><rect x="2.5" y="6" width="9" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="currentColor" stroke-width="1.2"/></svg>Encrypted &amp; secure</div>'
    +     '</div>'
    +     '<div style="flex:1 1 300px;min-width:280px">'
    +       '<label style="' + _lbl + '">PREVIEW</label>'
    +       _ccPreviewMarkup()
    +     '</div>'
    +   '</div>'
    + '</div>';
  m.style.display = 'flex'; document.body.style.overflow = 'hidden';
  if (typeof ccUpdatePreview === 'function') ccUpdatePreview();
  if (typeof ccInitStripe === 'function') ccInitStripe();
}
// Card brand from the leading digits.
function ccBrand(num) {
  num = String(num || '').replace(/\D/g, '');
  if (/^4/.test(num)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(num)) return 'MASTERCARD';
  if (/^3[47]/.test(num)) return 'AMEX';
  if (/^(6011|65|64[4-9])/.test(num)) return 'DISCOVER';
  return 'CARD';
}
function ccFmtNumber(el) {
  var brand = ccBrand(el.value);
  var d = el.value.replace(/\D/g, '').slice(0, brand === 'AMEX' ? 15 : 16);
  var groups = brand === 'AMEX' ? [4, 6, 5] : [4, 4, 4, 4];
  var out = [], i = 0;
  for (var g = 0; g < groups.length && i < d.length; g++) { out.push(d.slice(i, i + groups[g])); i += groups[g]; }
  el.value = out.join(' ');
  ccUpdatePreview();
}
function ccFmtExp(el) {
  var d = el.value.replace(/\D/g, '').slice(0, 4);
  el.value = d.length >= 3 ? (d.slice(0, 2) + '/' + d.slice(2)) : d;
  ccUpdatePreview();
}
// Live mirror of the typed details onto the on-theme card preview + summary.
function ccUpdatePreview() {
  var g = function (id) { return (document.getElementById(id) || {}).value || ''; };
  var s = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
  var num = g('cc-number'), name = g('cc-name'), exp = g('cc-exp');
  var brand = ccBrand(num), dgt = num.replace(/\D/g, '');
  var len = brand === 'AMEX' ? 15 : 16, groups = brand === 'AMEX' ? [4, 6, 5] : [4, 4, 4, 4];
  var filled = ''; for (var k = 0; k < len; k++) filled += (k < dgt.length ? dgt[k] : '•');
  var disp = [], i = 0; for (var grp = 0; grp < groups.length; grp++) { disp.push(filled.slice(i, i + groups[grp])); i += groups[grp]; }
  s('cc-prev-number', disp.join(' '));
  s('cc-prev-name', name.toUpperCase() || 'YOUR NAME');
  s('cc-prev-exp', exp || 'MM/YY');
  // Brand logo is owned by the Stripe cardNumber element's change event (we can't
  // read the PAN from JS), so don't overwrite #cc-brand here.
  s('cc-sum-name', name.toUpperCase() || '—');
  s('cc-sum-number', dgt ? ('•••• ' + (dgt.length > 4 ? dgt.slice(-4) : dgt)) : '—');
  s('cc-sum-exp', exp || '—');
}
// "Add New Card" SAVES a card (no charge) via a Stripe SetupIntent — the card is
// vaulted on the seller's Stripe Customer and becomes selectable in Add Funds, where
// the actual (gated, server-confirmed) charge happens. We never see the PAN.
var _ccStripe = null, _ccElements = null, _ccStripeReady = false, _ccSetupCS = '', _ccNumEl = null;
function _ccErr(msg) { var e = document.getElementById('cc-error'); if (e) { e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; } }
// Brand logo for the live preview's top-right (Visa/Mastercard PNGs; text for others).
function _ccBrandLogo(brand) {
  var k = String(brand || '').toUpperCase().replace(/[^A-Z]/g, '');
  var LOGOS = { VISA: 'images/visa.png', MASTERCARD: 'images/mastercard.png' };
  if (LOGOS[k]) return '<img src="' + LOGOS[k] + '" alt="' + k + '" style="height:34px;width:auto;max-width:80px;object-fit:contain;display:block">';
  return '<span style="font-size:13px;font-weight:800;letter-spacing:.12em;color:#cfc8b9">' + (k || 'CARD') + '</span>';
}
// Mount three SEPARATE Stripe Elements (number / expiry / CVC) so the fields are
// editable on screen yet the PAN never touches our JS. Used by EVERY add-card
// surface (header wallet, Add Funds, Linked Accounts) — same #cc-num/#cc-exp-el/
// #cc-cvc-el ids, so this one mounter serves them all. The card is validated &
// vaulted only on Save (confirmCardSetup), against a SetupIntent fetched here.
function ccInitStripe() {
  _ccStripe = null; _ccElements = null; _ccStripeReady = false; _ccSetupCS = ''; _ccNumEl = null;
  var mountNum = document.getElementById('cc-num'); if (!mountNum) return;
  var payBtn = document.getElementById('cc-pay');
  if (typeof Stripe !== 'function') { _ccErr('Could not load Stripe.js.'); if (payBtn) payBtn.disabled = true; return; }
  var tok = ''; try { tok = localStorage.getItem('eg_token') || ''; } catch (e) {}
  var H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
  if (payBtn) payBtn.disabled = true;
  fetch((window.EG_API_BASE || '') + '/api/stripe/config', { headers: tok ? { Authorization: 'Bearer ' + tok } : {} })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled || !cfg.publishableKey) {
        _ccErr('Card payments aren’t configured on the server yet (STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY).');
        return;
      }
      _ccStripe = Stripe(cfg.publishableKey);
      _ccElements = _ccStripe.elements();
      var style = { base: { fontSize: '14.5px', color: '#191918', fontFamily: 'inherit', '::placeholder': { color: '#9ca3af' } }, invalid: { color: '#dc2626' } };
      _ccNumEl = _ccElements.create('cardNumber', { style: style, showIcon: true });
      var expEl = _ccElements.create('cardExpiry', { style: style });
      var cvcEl = _ccElements.create('cardCvc', { style: style });
      _ccNumEl.mount('#cc-num'); expEl.mount('#cc-exp-el'); cvcEl.mount('#cc-cvc-el');
      // Live brand → preview logo; surface field-level validation as the user types.
      _ccNumEl.on('change', function (ev) {
        var bE = document.getElementById('cc-brand');
        if (bE) bE.innerHTML = _ccBrandLogo(ev.brand && ev.brand !== 'unknown' ? ev.brand : '');
        _ccErr(ev.error ? ev.error.message : '');
      });
      expEl.on('change', function (ev) { if (ev.error) _ccErr(ev.error.message); });
      cvcEl.on('change', function (ev) { if (ev.error) _ccErr(ev.error.message); });
      _ccStripeReady = true; _ccErr(''); if (payBtn) payBtn.disabled = false;
      // SetupIntent client secret for confirmCardSetup, fetched in the background.
      fetch((window.EG_API_BASE || '') + '/api/stripe/setup-intent', { method: 'POST', headers: H, body: '{}' })
        .then(function (r) { return r.json(); })
        .then(function (si) { if (si && si.clientSecret) _ccSetupCS = si.clientSecret; });
    })
    .catch(function () { _ccErr('Could not reach the payment server.'); });
}
// Shared vault step: validate + save the entered card against the SetupIntent.
// Resolves { ok, card } on success or { ok:false, error } so each caller can react
// (the card is only "usable" once Stripe confirms it here — else suggest another).
async function _ccVaultCard(btn) {
  var name = ((document.getElementById('cc-name') || {}).value || '').trim();
  if (!_ccStripe || !_ccNumEl || !_ccStripeReady) return { ok: false, error: 'Card field isn’t ready yet — one moment.' };
  if (!_ccSetupCS) return { ok: false, error: 'Still preparing secure setup — one moment, then try again.' };
  var res = await _ccStripe.confirmCardSetup(_ccSetupCS, { payment_method: { card: _ccNumEl, billing_details: name ? { name: name } : {} } });
  if (res && res.error) return { ok: false, error: res.error.message };
  var si = res && res.setupIntent;
  if (!si || si.status !== 'succeeded') return { ok: false, error: 'Card was not saved (' + ((si && si.status) || 'failed') + ').' };
  return { ok: true, card: { name: name } };
}
async function ccSaveCard() {
  var btn = document.getElementById('cc-pay'); var label = btn ? btn.textContent : 'Save Card';
  var fail = function (msg) { _ccErr((msg || 'Could not save the card.') + ' Try a different card.'); if (btn) { btn.disabled = false; btn.textContent = label; } };
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; } _ccErr('');
  try {
    var r = await _ccVaultCard(btn);
    if (!r.ok) return fail(r.error);
    closeCardModal();
    if (typeof walToast === 'function') walToast('✓ Card saved');
    // Back to Add Funds with the new card available (the picker reloads from Stripe).
    try { _depCardIdx = 0; _depStripeCards = null; } catch (e) {}
    if (typeof openDepositModal === 'function') openDepositModal();
  } catch (e) { fail(e && e.message ? e.message : 'Could not save the card.'); }
}
window.openCardTopUp = openCardTopUp;

// ── Manage Linked Accounts — cards + BIDV + PayPal in one window ──────────────
var _laTab = 'cards', _laAdding = false;
function _laCards() { try { var v = JSON.parse(localStorage.getItem('eg_linked_cards') || 'null'); return Array.isArray(v) ? v : [{ brand: 'VISA', last4: '4242', exp: '08/27', name: 'DEFAULT CARD' }]; } catch (e) { return []; } }
function _laSaveCards(a) { try { localStorage.setItem('eg_linked_cards', JSON.stringify(a || [])); } catch (e) {} }
function closeLinkedAccounts() { var m = document.getElementById('la-modal'); if (m) m.style.display = 'none'; document.body.style.overflow = ''; _laAdding = false; }
function openLinkedAccounts() {
  var m = document.getElementById('la-modal');
  if (!m) { m = document.createElement('div'); m.id = 'la-modal'; m.style.cssText = 'display:none;position:fixed;inset:0;z-index:520;align-items:center;justify-content:center;font-family:inherit'; document.body.appendChild(m); m.addEventListener('click', function (e) { if (e.target === m) closeLinkedAccounts(); }); }
  _laAdding = false; _laStripeCards = null; _laRender(); m.style.display = 'flex'; document.body.style.overflow = 'hidden';
}
function laSelectTab(t) { _laTab = t; _laAdding = false; _laRender(); }
function _laRender() {
  var m = document.getElementById('la-modal'); if (!m) return;
  var nav = function (key, label, icon) { var on = _laTab === key; return '<button onclick="laSelectTab(\'' + key + '\')" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:' + (on ? '#f0ede9' : 'transparent') + ';border:none;border-radius:9px;padding:11px 13px;font-size:14px;font-weight:' + (on ? '700' : '600') + ';color:' + (on ? '#191918' : '#6b7280') + ';cursor:pointer;font-family:inherit">' + icon + '<span>' + label + '</span></button>'; };
  var icCard = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 6.5h13" stroke="currentColor" stroke-width="1.3"/></svg>';
  var icBank = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l6 3v1H2v-1l6-3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M3 6.5v5M6 6.5v5M10 6.5v5M13 6.5v5M2 13.5h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  var icPay = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M5 4h6a2.5 2.5 0 010 5H7L6 13H4l2-9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  m.innerHTML = '<div onclick="closeLinkedAccounts()" style="position:fixed;inset:0;background:rgba(25,25,24,.5)"></div>'
    + '<div style="position:relative;background:#fdfcfa;border:1px solid #40403d;border-radius:18px;box-shadow:5px 5px 0 #40403d,0 28px 70px rgba(0,0,0,.3);width:880px;max-width:calc(100vw - 28px);height:600px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid #ece8e0"><div><div style="font-size:17px;font-weight:800;color:#191918">Linked Accounts</div><div style="font-size:12.5px;color:#9ca3af;margin-top:1px">Manage your cards and payout accounts</div></div><button onclick="closeLinkedAccounts()" style="background:none;border:none;cursor:pointer;color:#9ca3af;padding:5px;border-radius:7px" onmouseover="this.style.background=\'#f0ede9\'" onmouseout="this.style.background=\'transparent\'"><svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>'
    + '<div style="display:flex;flex:1;min-height:0">'
    + '<div style="width:210px;flex-shrink:0;border-right:1px solid #ece8e0;padding:14px;display:flex;flex-direction:column;gap:4px">' + nav('cards', 'Cards', icCard) + nav('paypal', 'PayPal', icPay) + '</div>'
    + '<div style="flex:1;overflow:auto;padding:24px">' + _laPanelHtml() + '</div>'
    + '</div></div>';
  if (_laTab === 'cards' && _laAdding && typeof ccUpdatePreview === 'function') ccUpdatePreview();
}
// BIDV removed from Linked Accounts: it's the PLATFORM's receiving account (admin's
// wallet), not a seller connection. This window only shows the seller's own cards + PayPal.
function _laPanelHtml() { if (_laTab === 'paypal') return _laPaypalHtml(); return _laCardsHtml(); }
// Real network logos (images/) for Visa + Mastercard; dark monogram chip fallback
// for anything else (Amex, etc.).
function _cardBrandMark(brand){
  var k = String(brand || '').toUpperCase().replace(/[^A-Z]/g, '');
  var LOGOS = { VISA:'images/visa.png', MASTERCARD:'images/mastercard.png' };
  if (LOGOS[k]) return '<span style="width:42px;height:28px;border-radius:5px;background:#fff;border:1px solid #ece8e0;display:inline-flex;align-items:center;justify-content:center;padding:4px;box-sizing:border-box;flex-shrink:0"><img src="'+LOGOS[k]+'" alt="'+k+'" style="max-width:100%;max-height:100%;object-fit:contain;display:block"></span>';
  return '<div style="width:42px;height:28px;border-radius:5px;background:linear-gradient(135deg,#1f1d1b,#2c2926);display:flex;align-items:center;justify-content:center;color:#fff;font-size:7.5px;font-weight:800;letter-spacing:.03em;flex-shrink:0">'+(brand||'CARD')+'</div>';
}
// Saved cards come from Stripe (the source of truth — usable for top-ups), loaded
// once per modal open into _laStripeCards. _laCardsHtml renders a loading state
// until the fetch returns, then re-renders.
var _laStripeCards = null, _laCardsLoading = false;
function _laLoadCards() {
  if (_laCardsLoading) return; _laCardsLoading = true;
  var tok = ''; try { tok = localStorage.getItem('eg_token') || ''; } catch (e) {}
  fetch((window.EG_API_BASE || '') + '/api/stripe/cards', { headers: tok ? { Authorization: 'Bearer ' + tok } : {} })
    .then(function (r) { return r.json(); })
    .then(function (d) { _laStripeCards = (d && Array.isArray(d.cards)) ? d.cards : []; })
    .catch(function () { _laStripeCards = []; })
    .then(function () { _laCardsLoading = false; if (_laTab === 'cards' && !_laAdding) _laRender(); });
}
function _laCardsHtml() {
  if (_laAdding) return _laAddCardHtml();
  if (_laStripeCards == null) { _laLoadCards(); return '<div style="font-size:13.5px;color:#9ca3af;padding:18px 0">Loading your cards…</div>'; }
  var cards = _laStripeCards;
  var rows = cards.map(function (c, i) {
    return '<div style="display:flex;align-items:center;gap:13px;border:1px solid #ece8e0;border-radius:12px;padding:13px 15px;margin-bottom:10px;background:#fff">'
      + _cardBrandMark(c.brand)
      + '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;color:#191918">&bull;&bull;&bull;&bull; ' + (c.last4 || '••••') + '</div><div style="font-size:12px;color:#9ca3af">' + (c.name || 'Card') + ' · exp ' + (c.exp || '—') + '</div></div>'
      + (i === 0 ? '<span style="font-size:11px;font-weight:700;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:2px 9px">Default</span>' : '')
      + '<button onclick="laRemoveCard(\'' + c.id + '\')" title="Remove" style="background:none;border:none;cursor:pointer;color:#c4c3be;padding:5px" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#c4c3be\'"><svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>'
      + '</div>';
  }).join('') || '<div style="font-size:13.5px;color:#9ca3af;padding:18px 0">No cards linked yet.</div>';
  return '<div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:.03em;margin-bottom:12px">SAVED CARDS</div>' + rows
    + '<button onclick="laShowAddCard()" style="width:100%;display:flex;align-items:center;justify-content:center;gap:7px;border:1.5px dashed #d8d4cd;background:#faf9f7;border-radius:12px;padding:13px;font-size:14px;font-weight:600;color:#191918;cursor:pointer;font-family:inherit;margin-top:4px" onmouseover="this.style.borderColor=\'#191918\'" onmouseout="this.style.borderColor=\'#d8d4cd\'"><svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Add a new card</button>';
}
function laShowAddCard() { _laAdding = true; _laRender(); if (typeof ccInitStripe === 'function') setTimeout(ccInitStripe, 0); }
function laCancelAddCard() { _laAdding = false; _laRender(); }
function _laAddCardHtml() {
  var _is = 'width:100%;border:1.5px solid #e5e4e0;border-radius:9px;padding:10px 12px;font-size:14.5px;font-family:inherit;outline:none;box-sizing:border-box;color:#191918';
  var _lbl = 'font-size:12px;font-weight:700;color:#6b7280;display:block;margin-bottom:6px;letter-spacing:.03em';
  var _foc = 'onfocus="this.style.borderColor=\'#191918\'" onblur="this.style.borderColor=\'#e5e4e0\'"';
  var _box = 'border:1.5px solid #e5e4e0;border-radius:9px;padding:12px;min-height:46px;background:#fff';
  return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px"><button onclick="laCancelAddCard()" style="background:none;border:none;cursor:pointer;color:#6b7280;font-size:13.5px;font-weight:600;font-family:inherit;display:inline-flex;align-items:center;gap:4px"><span style="font-size:17px;line-height:1">‹</span>Cards</button></div>'
    + '<div style="display:flex;gap:24px;flex-wrap:wrap">'
    + '<div style="flex:1 1 280px;min-width:260px;display:flex;flex-direction:column;gap:14px">'
    + '<div><label style="' + _lbl + '">CARDHOLDER NAME</label><input id="cc-name" type="text" placeholder="JANE COOPER" oninput="ccUpdatePreview()" style="' + _is + ';text-transform:uppercase" ' + _foc + '></div>'
    + '<div><label style="' + _lbl + '">CARD NUMBER</label><div id="cc-num" style="' + _box + '"></div></div>'
    + '<div style="display:flex;gap:12px"><div style="flex:1"><label style="' + _lbl + '">EXPIRY</label><div id="cc-exp-el" style="' + _box + '"></div></div><div style="flex:1"><label style="' + _lbl + '">CVC</label><div id="cc-cvc-el" style="' + _box + '"></div></div></div>'
    + '<div id="cc-error" style="display:none;font-size:12.5px;color:#dc2626;font-weight:600;line-height:1.45"></div>'
    + '<button id="cc-pay" onclick="laSaveNewCard()" style="width:100%;background:#191918;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px">Save card</button>'
    + '</div>'
    + '<div style="flex:1 1 280px;min-width:260px"><label style="' + _lbl + '">PREVIEW</label>' + _ccPreviewMarkup() + '</div>'
    + '</div>';
}
async function laSaveNewCard() {
  // Real Stripe validation + vaulting (same path as the Add Funds modal). Only a
  // card Stripe confirms is saved — otherwise we ask for a different one.
  var btn = document.getElementById('cc-pay'); var label = btn ? btn.textContent : 'Save card';
  var fail = function (msg) { _ccErr((msg || 'Could not save the card.') + ' Try a different card.'); if (btn) { btn.disabled = false; btn.textContent = label; } };
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; } _ccErr('');
  try {
    var r = await _ccVaultCard(btn);
    if (!r.ok) return fail(r.error);
    _laStripeCards = null;   // force the list to reload the now-vaulted card
    try { _depStripeCards = null; } catch (e) {}
    _laAdding = false; _laRender();
    if (typeof walToast === 'function') walToast('✓ Card saved');
  } catch (e) { fail(e && e.message ? e.message : 'Could not save the card.'); }
}
function laRemoveCard(id) {
  if (!id) return;
  var tok = ''; try { tok = localStorage.getItem('eg_token') || ''; } catch (e) {}
  fetch((window.EG_API_BASE || '') + '/api/stripe/cards/' + encodeURIComponent(id), { method: 'DELETE', headers: tok ? { Authorization: 'Bearer ' + tok } : {} })
    .then(function (r) { return r.json(); })
    .then(function () { _laStripeCards = null; try { _depStripeCards = null; } catch (e) {} _laRender(); })
    .catch(function () { _laStripeCards = null; _laRender(); });
}
function _ccPreviewMarkup() {
  // Monochromatic retro card — vintage-black base, cream text, GREY metallic chip,
  // no drop-shadow. On-theme with the rest of the app.
  return '<div style="position:relative;width:100%;aspect-ratio:1.6;background:repeating-linear-gradient(135deg,#1d1b18,#1d1b18 14px,#201d19 14px,#201d19 28px);border:1px solid #40403d;border-radius:14px;padding:18px 20px;color:#ece7da;overflow:hidden;box-sizing:border-box;font-family:inherit">'
    // subtle cream corner wash (monochromatic) in place of the gold circle
    + '<div style="position:absolute;top:-44px;right:-32px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(236,231,218,.08),transparent 68%)"></div>'
    // chip (grey/silver metallic, with engraved lines) + brand
    + '<div style="position:relative;display:flex;align-items:center;justify-content:space-between">'
    +   '<div style="width:38px;height:27px;border-radius:5px;background:linear-gradient(135deg,#dcdcda,#a6a6a3);border:1px solid rgba(0,0,0,.18);position:relative"><div style="position:absolute;inset:5px 7px;border:1px solid rgba(0,0,0,.2);border-radius:2px"></div></div>'
    +   '<div id="cc-brand" style="font-size:13px;font-weight:800;letter-spacing:.12em;color:#cfc8b9">CARD</div>'
    + '</div>'
    // number — vintage monospace
    + '<div id="cc-prev-number" style="position:relative;font-family:\'Courier New\',monospace;font-size:18px;letter-spacing:2.5px;margin-top:22px;color:#ece7da">&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;</div>'
    // holder + expires
    + '<div style="position:relative;display:flex;align-items:flex-end;justify-content:space-between;margin-top:16px">'
    +   '<div style="min-width:0"><div style="font-size:8px;letter-spacing:.14em;color:rgba(236,231,218,.5)">CARD HOLDER</div><div id="cc-prev-name" style="font-size:12.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;color:#ece7da">YOUR NAME</div></div>'
    +   '<div style="text-align:right"><div style="font-size:8px;letter-spacing:.14em;color:rgba(236,231,218,.5)">EXPIRES</div><div id="cc-prev-exp" style="font-size:12.5px;font-weight:600;letter-spacing:.05em;color:#ece7da">MM/YY</div></div>'
    + '</div>'
    + '</div>';
}
function _laBidvHtml() {
  var rate = (typeof egVqrRate === 'function') ? Number(egVqrRate()).toLocaleString('en-US') : '—';
  return '<div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:.03em;margin-bottom:12px">BANK ACCOUNT &mdash; BIDV</div>'
    + '<div style="border:1px solid #ece8e0;border-radius:12px;padding:16px;background:#fff;margin-bottom:14px">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div style="display:flex;align-items:center;gap:10px"><span style="width:30px;height:30px;border-radius:8px;background:#fff0f0;display:inline-flex;align-items:center;justify-content:center"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="8" rx="1" stroke="#dc2626" stroke-width="1.4"/></svg></span><div><div style="font-size:14.5px;font-weight:700;color:#191918">BIDV</div><div style="font-size:12px;color:#9ca3af">Bank for Investment &amp; Development of Vietnam</div></div></div><span style="font-size:11px;font-weight:700;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:3px 10px">Connected</span></div>'
    + '<div style="border-top:1px solid #f0ede9;padding-top:12px;display:grid;gap:8px;font-size:13px"><div style="display:flex;justify-content:space-between"><span style="color:#9ca3af">Account name</span><b style="color:#191918">EGFULFILL JSC</b></div><div style="display:flex;justify-content:space-between"><span style="color:#9ca3af">Account number</span><b style="color:#191918;font-family:monospace">&bull;&bull;&bull;&bull; 8213</b></div><div style="display:flex;justify-content:space-between"><span style="color:#9ca3af">Rate (1 USD)</span><b style="color:#191918">&#8363;' + rate + '</b></div></div>'
    + '</div>'
    + '<div style="font-size:12.5px;color:#9ca3af">BIDV powers the scan-to-pay (VietQR) top-ups in Add Funds.</div>';
}
function _laPaypalHtml() {
  // There's no PayPal account to "link" — every top-up is a fresh PayPal checkout
  // that needs the amount up front. So this is a single step: pick an amount →
  // continue → PayPal's own window opens (pay with balance, bank, or any card).
  var head = '<div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:.03em;margin-bottom:12px">PAYPAL</div>';
  var ppIcon = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M5 4h6a2.5 2.5 0 010 5H7L6 13H4l2-9z" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  var chips = [280, 500, 840, 1000].map(function (a) {
    return '<button type="button" onclick="walPayPalTopUp(' + a + ')" style="flex:1;background:#f6f5f4;border:1px solid #ece8e0;border-radius:8px;padding:10px 6px;font-size:13.5px;font-weight:700;color:#191918;cursor:pointer;font-family:inherit;transition:all .12s" onmouseover="this.style.background=\'#fff\';this.style.borderColor=\'#003087\'" onmouseout="this.style.background=\'#f6f5f4\';this.style.borderColor=\'#ece8e0\'">$' + a.toLocaleString() + '</button>';
  }).join('');
  return head
    + '<div style="border:1px solid #ece8e0;border-radius:14px;padding:18px 18px 16px;background:#f7faff;margin-bottom:16px;text-align:center">'
    +   '<span style="display:inline-flex;width:44px;height:44px;border-radius:12px;background:#e8f0fe;align-items:center;justify-content:center;margin-bottom:9px"><svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M5 4h6a2.5 2.5 0 010 5H7L6 13H4l2-9z" stroke="#003087" stroke-width="1.2" stroke-linejoin="round"/></svg></span>'
    +   '<div style="font-size:15px;font-weight:700;color:#191918;margin-bottom:3px">Top up with PayPal</div>'
    +   '<div style="font-size:12.5px;color:#6b7280;line-height:1.5">Pick an amount and continue to PayPal — pay with your balance, bank, or any card in PayPal\'s secure window.</div>'
    + '</div>'
    + '<div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:.03em;margin-bottom:9px">AMOUNT (USD)</div>'
    + '<div style="display:flex;gap:7px;margin-bottom:10px">' + chips + '</div>'
    + '<div style="position:relative;margin-bottom:12px"><span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:14px;font-weight:700">$</span><input id="la-pp-amt" type="number" min="1" step="0.01" placeholder="Other amount" style="width:100%;border:1.5px solid #e5e4e0;border-radius:9px;padding:11px 12px 11px 24px;font-size:15px;font-weight:700;font-family:inherit;outline:none;box-sizing:border-box;color:#191918" onkeydown="if(event.key===\'Enter\')walPayPalTopUp()" onfocus="this.style.borderColor=\'#003087\'" onblur="this.style.borderColor=\'#e5e4e0\'"></div>'
    + '<button onclick="walPayPalTopUp()" style="width:100%;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#003087;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">' + ppIcon + 'Continue with PayPal</button>';
}
// Quick top-up from the connected PayPal panel: close Linked Accounts and open Add
// Funds already set to PayPal + the chosen amount, so the seller lands directly on
// the gated PayPal payment (no re-entering an amount). The bank/card is then chosen
// inside PayPal's window. amount omitted → read the "Other amount" field.
function walPayPalTopUp(amount) {
  var amt = amount;
  if (amt == null) { var el = document.getElementById('la-pp-amt'); amt = el ? parseFloat(el.value) : 0; }
  amt = parseFloat(amt) || 0;
  if (!(amt > 0)) { var e2 = document.getElementById('la-pp-amt'); if (e2) { e2.focus(); e2.style.borderColor = '#dc2626'; } return; }
  if (typeof closeLinkedAccounts === 'function') closeLinkedAccounts();
  if (typeof openDepositModal === 'function') openDepositModal(amt, 'paypal');
}
window.openLinkedAccounts = openLinkedAccounts;
// Admin's USD→VND rate (set by admin, shared via server; cached locally). Default 25,400.
function egVqrRate() { var r = parseFloat(localStorage.getItem('eg_vqr_rate')); return (r && r > 0) ? r : 25400; }
function egIsAdmin() { try { return (JSON.parse(localStorage.getItem('eg_user') || '{}').role) === 'admin'; } catch (e) { return false; } }
function vqrSaveRate(v) {
  var n = Math.round(parseFloat(v)); if (!n || n <= 0) return;
  localStorage.setItem('eg_vqr_rate', String(n));
  // Only an admin persists the shared rate to the server (sellers see it read-only).
  var tok = localStorage.getItem('eg_token');
  if (tok && egIsAdmin()) {
    fetch('/api/vietqr/rate', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ rate: n }) }).catch(function () {});
  }
}
// Live-sync the deposit modal: show the VietQR box + ₫ preview at the set rate,
// recomputed from whichever amount the seller picked.
function vqrSyncDepositUI() {
  var methodEl = document.getElementById('modal-method'); if (!methodEl) return;
  var isVqr = methodEl.value === 'vietqr';
  var box = document.getElementById('dep-vqr-box'); if (box) box.style.display = isVqr ? 'block' : 'none';
  var rateEl = document.getElementById('dep-vqr-rate');
  if (rateEl) {
    if (!rateEl.value) rateEl.value = egVqrRate();
    // Sellers see the admin's rate read-only; only admins can change it.
    var admin = egIsAdmin();
    rateEl.readOnly = !admin;
    rateEl.title = admin ? 'Set the USD→VND rate (applies to all sellers)' : 'Exchange rate is set by the admin';
    rateEl.style.opacity = admin ? '1' : '.75';
    rateEl.style.cursor = admin ? 'text' : 'not-allowed';
  }
  var amt = parseFloat((document.getElementById('modal-amount') || {}).value) || 0;
  var vnd = Math.max(0, Math.round(amt * egVqrRate() / 1000) * 1000);
  var pv = document.getElementById('dep-vnd-preview'); if (pv) pv.textContent = '₫' + vnd.toLocaleString('en-US');
  // PayPal: show the PayPal Buttons and hide the Confirm button (PayPal has its own).
  var isPaypal = methodEl.value === 'paypal';
  var ppBox = document.getElementById('paypal-box'); if (ppBox) ppBox.style.display = isPaypal ? 'block' : 'none';
  if (isPaypal && typeof ppInit === 'function') ppInit();
  // Card: show the saved-cards picker (pick one to charge, or add a new one) so the
  // seller can use a card they already saved instead of always re-entering one.
  var isCard = methodEl.value === 'card';
  var cardBox = document.getElementById('dep-card-box'); if (cardBox) cardBox.style.display = isCard ? 'block' : 'none';
  if (isCard) { if (_depStripeCards == null) _loadDepCards(); else _renderDepCardPicker(); }
  var btn = document.querySelector('#deposit-modal button[onclick="submitDeposit()"]');
  if (btn) {
    btn.style.display = isPaypal ? 'none' : '';
    if (btn.lastChild && btn.lastChild.nodeType === 3) btn.lastChild.textContent = 'Pay Now';
  }
}
// ── Saved-cards picker inside Add Funds (Debit/Credit Card method) ────────────
var _depCardIdx = null, _depStripeCards = null;
// Pull the seller's saved cards from Stripe (the source of truth — never stored
// locally) then render the picker. Cached for the modal session.
function _loadDepCards(){
  var tok=''; try{ tok=localStorage.getItem('eg_token')||''; }catch(e){}
  fetch((window.EG_API_BASE||'')+'/api/stripe/cards',{ headers: tok?{Authorization:'Bearer '+tok}:{} })
    .then(function(r){ return r.json(); })
    .then(function(d){ _depStripeCards = (d&&Array.isArray(d.cards))?d.cards:[]; _renderDepCardPicker(); })
    .catch(function(){ if(_depStripeCards==null) _depStripeCards=[]; _renderDepCardPicker(); });
}
function _renderDepCardPicker(){
  var box = document.getElementById('dep-card-box'); if (!box) return;
  var cards = Array.isArray(_depStripeCards) ? _depStripeCards : [];
  if (_depCardIdx == null && cards.length) _depCardIdx = 0;          // default to the default/first card
  if (_depCardIdx != null && _depCardIdx >= cards.length) _depCardIdx = cards.length ? 0 : null;
  var rows = cards.map(function(c, i){
    var sel = (_depCardIdx === i);
    return '<button type="button" onclick="_pickDepCard('+i+')" style="display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:1.5px solid '+(sel?'#191918':'#e5e4e0')+';border-radius:10px;padding:10px 12px;background:'+(sel?'#fafaf9':'#fff')+';cursor:pointer;font-family:inherit;margin-bottom:8px;transition:border-color .12s">'
      + (typeof _cardBrandMark === 'function' ? _cardBrandMark(c.brand) : '')
      + '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:#191918">&bull;&bull;&bull;&bull; '+(c.last4||'••••')+'</div><div style="font-size:12px;color:#9ca3af">'+(c.name||'Card')+' · exp '+(c.exp||'—')+'</div></div>'
      + '<span style="width:18px;height:18px;border-radius:50%;border:2px solid '+(sel?'#191918':'#d8d4cd')+';display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">'+(sel?'<span style="width:9px;height:9px;border-radius:50%;background:#191918"></span>':'')+'</span>'
      + '</button>';
  }).join('');
  box.innerHTML = (cards.length ? '<div style="font-size:11.5px;font-weight:700;color:#9ca3af;letter-spacing:.04em;margin-bottom:9px">SAVED CARDS</div>' + rows : '<div style="font-size:13px;color:#9ca3af;padding:6px 0 10px">No saved cards yet — add one below.</div>')
    + '<button type="button" onclick="_addNewDepCard()" style="display:flex;align-items:center;justify-content:center;gap:7px;width:100%;border:1.5px dashed #d8d4cd;background:#faf9f7;border-radius:10px;padding:11px;font-size:13.5px;font-weight:600;color:#191918;cursor:pointer;font-family:inherit" onmouseover="this.style.borderColor=\'#191918\'" onmouseout="this.style.borderColor=\'#d8d4cd\'"><svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Add a new card</button>';
}
function _pickDepCard(i){ _depCardIdx = i; _renderDepCardPicker(); }
function _addNewDepCard(){
  // Open the save-card form; after it saves it reopens Add Funds with the new card.
  closeDepositModal();
  if (typeof openCardTopUp === 'function') openCardTopUp();
}
// ── PayPal top-up (Orders API v2) — full-page REDIRECT flow ──────────────────
// No embedded SDK buttons. Selecting PayPal shows one "Continue with PayPal"
// button; clicking it creates an order server-side and sends the buyer to PayPal's
// own window. PayPal returns to wallet.html?pp_return=1&token=<orderId>, where
// _ppHandleReturn() captures it and credits the wallet. Cards go through Stripe.
function _ppErr(msg) { var e = document.getElementById('paypal-err'); if (e) { e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; } }
function ppInit() {
  // Verify PayPal is configured; disable the redirect button with a note if not.
  var btn = document.getElementById('paypal-continue'); if (!btn) return;
  var tok = localStorage.getItem('eg_token');
  _ppErr('');
  fetch('/api/paypal/config', { headers: tok ? { Authorization: 'Bearer ' + tok } : {} })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled || !cfg.clientId) {
        btn.disabled = true; btn.style.opacity = '.5'; btn.style.cursor = 'not-allowed';
        _ppErr('PayPal isn’t configured yet — add PAYPAL_CLIENT_ID/SECRET on the server.');
      } else { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    }).catch(function () {});
}
function walPayPalRedirect() {
  var amt = parseFloat((document.getElementById('modal-amount') || {}).value) || 0;
  if (!(amt > 0)) { _ppErr('Enter an amount first.'); var a = document.getElementById('modal-amount'); if (a) a.focus(); return; }
  var btn = document.getElementById('paypal-continue'); var label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Redirecting to PayPal…'; }
  _ppErr('');
  // Remember the amount so the return handler can fall back to it if needed.
  try { sessionStorage.setItem('eg_pp_amt', String(amt)); } catch (e) {}
  var base = location.origin + location.pathname;
  fetch('/api/paypal/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('eg_token') },
    body: JSON.stringify({ amount: amt, returnUrl: base + '?pp_return=1', cancelUrl: base + '?pp_cancel=1' })
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error || !d.approveUrl) { _ppErr(d.error || 'Could not start PayPal checkout.'); if (btn) { btn.disabled = false; btn.innerHTML = label; } return; }
    window.location.href = d.approveUrl;   // → PayPal's secure window
  }).catch(function () { _ppErr('Could not reach the payment server.'); if (btn) { btn.disabled = false; btn.innerHTML = label; } });
}
// On return from PayPal: ?pp_return=1&token=<orderId> → capture & credit.
function _ppHandleReturn() {
  var qs = new URLSearchParams(location.search);
  if (qs.get('pp_cancel')) { _ppClean(); if (typeof walToast === 'function') walToast('PayPal top-up canceled'); return; }
  if (!qs.get('pp_return')) return;
  var orderID = qs.get('token');   // PayPal appends ?token=<orderId> to the return URL
  if (!orderID) { _ppClean(); return; }
  fetch('/api/paypal/capture-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('eg_token') },
    body: JSON.stringify({ orderID: orderID })
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (res.error || !res.ok) { alert('PayPal payment could not be confirmed: ' + (res.error || 'unknown')); _ppClean(); return; }
    var amt = res.amount || parseFloat(sessionStorage.getItem('eg_pp_amt')) || 0;
    if (typeof vqrCreditWallet === 'function') vqrCreditWallet(amt);
    if (typeof vqrRecordDeposit === 'function') vqrRecordDeposit(amt, (res.ref || res.captureId), 'PayPal', (res.txnId || res.captureId));
    try { sessionStorage.removeItem('eg_pp_amt'); } catch (e) {}
    _ppClean();
    alert('Payment received — $' + amt.toFixed(2) + ' added to your wallet.');
  }).catch(function () { alert('Could not reach the server to confirm your PayPal payment.'); _ppClean(); });
}
// Strip the pp_* query params so a refresh doesn't re-trigger capture.
function _ppClean() { try { history.replaceState({}, '', location.origin + location.pathname); } catch (e) {} }
try { _ppHandleReturn(); } catch (e) {}
function closeDepositModal() {
  document.getElementById('deposit-modal').style.display = 'none';
  document.body.style.overflow = '';
}
function submitDeposit() {
  const amount = parseFloat(document.getElementById('modal-amount').value);
  const method = document.getElementById('modal-method').value;
  if (!amount || amount <= 0) { alert('Please enter a valid amount.'); return; }
  // VietQR: don't credit instantly — show the scan-to-pay QR and wait for the
  // bank transfer to land (auto-confirmed via /api/vietqr/status).
  if (method === 'vietqr') { closeDepositModal(); openVietQRTopUp(amount); return; }
  // Debit/Credit Card: hand off to the existing Stripe top-up flow, carrying
  // the entered amount into the card modal.
  if (method === 'card') {
    // Charge the SELECTED saved card for this amount via Stripe — credited only on a
    // server-confirmed success. No saved card picked → open the Add-New-Card (save)
    // form first, then come back here to pay.
    var _cards = Array.isArray(_depStripeCards) ? _depStripeCards : [];
    var _sel = (_cards.length && _depCardIdx != null && _cards[_depCardIdx]) ? _cards[_depCardIdx] : null;
    if (!_sel || !_sel.id) { closeDepositModal(); if (typeof openCardTopUp === 'function') openCardTopUp(); return; }
    _chargeSavedCard(amount, _sel);
    return;
  }
  let bal = parseFloat(localStorage.getItem('eg_balance') || '0');
  bal = parseFloat((bal + amount).toFixed(2));
  localStorage.setItem('eg_balance', bal.toFixed(2));
  document.querySelectorAll('#balance-val').forEach(el => el.textContent = '$' + bal.toFixed(2));
  const bigBal = document.getElementById('wallet-bal-big');
  if (bigBal) bigBal.textContent = '$' + bal.toFixed(2);
  pendingFundOrders.forEach(id => removeOrderRows(id));
  pendingFundOrders = [];
  updateUnfundedSection();
  closeDepositModal();
}
// Credit the wallet locally AFTER the server confirmed the charge.
function _afterCardCredit(amount, ref, txnId){
  amount = Number(amount) || 0;
  if (typeof vqrCreditWallet === 'function') vqrCreditWallet(amount);
  if (typeof vqrRecordDeposit === 'function') vqrRecordDeposit(amount, ref, 'Card', txnId);
  if (typeof closeDepositModal === 'function') closeDepositModal();
  if (typeof walToast === 'function') walToast('✓ Payment confirmed — $' + amount.toFixed(2) + ' added'); else alert('$' + amount.toFixed(2) + ' added');
}
// Charge a saved card. The server confirms the PaymentIntent; if Stripe needs a
// 3-D Secure step it returns a clientSecret we finish on the client, then verify.
function _chargeSavedCard(amount, card){
  var tok=''; try{ tok=localStorage.getItem('eg_token')||''; }catch(e){}
  var H={ 'Content-Type':'application/json', Authorization:'Bearer '+tok };
  var btn = document.querySelector('#_afm-pay, [onclick="submitDeposit()"]');
  if (btn){ btn.disabled=true; btn._lbl=btn.textContent; btn.textContent='Processing…'; }
  var done=function(msg){ if(btn){ btn.disabled=false; if(btn._lbl) btn.textContent=btn._lbl; } if(msg){ if(typeof walToast==='function') walToast(msg); else alert(msg); } };
  fetch((window.EG_API_BASE||'')+'/api/stripe/charge-saved',{ method:'POST', headers:H, body:JSON.stringify({ amount:amount, paymentMethodId:card.id }) })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.ok){ done(); _afterCardCredit(d.amount||amount, d.ref, d.txnId); return; }
      if (d && d.clientSecret && typeof Stripe==='function'){
        // 3-D Secure — finish on the client, then re-verify server-side.
        fetch((window.EG_API_BASE||'')+'/api/stripe/config',{ headers: tok?{Authorization:'Bearer '+tok}:{} })
          .then(function(r){ return r.json(); }).then(function(cfg){
            if(!cfg||!cfg.publishableKey){ done('Could not verify the card.'); return; }
            Stripe(cfg.publishableKey).handleNextAction({ clientSecret:d.clientSecret }).then(function(res){
              if(res.error){ done('Card verification failed: '+res.error.message); return; }
              var pi=res.paymentIntent||{};
              fetch((window.EG_API_BASE||'')+'/api/stripe/verify-intent',{ method:'POST', headers:H, body:JSON.stringify({ id: pi.id }) })
                .then(function(r){ return r.json(); }).then(function(v){
                  done(); if(v&&v.ok) _afterCardCredit(v.amount||amount, v.ref, v.txnId||pi.id); else done('Payment not confirmed — your wallet was not charged.');
                }).catch(function(){ done('Could not reach the payment server.'); });
            });
          }).catch(function(){ done('Could not verify the card.'); });
        return;
      }
      done('Card declined: ' + ((d&&d.error) || (d&&d.status) || 'try another card'));
    })
    .catch(function(){ done('Could not reach the payment server.'); });
}

/* ── VietQR top-up ──────────────────────────────────────────────────────────
   Shows a Vietcombank VietQR code (img.vietqr.io) for the entered amount with a
   unique transfer note (addInfo). Polls /api/vietqr/status?ref=<note>; when the
   matching bank transfer lands (VietQR pushes it to our transaction-sync endpoint)
   the wallet is credited automatically. Reconciliation matches on the note, so the
   approximate USD→VND rate below only affects the suggested transfer amount. */
const EG_VQR = {
  bank: '970418',            // BIDV BIN (VietQR)
  account: '1231255899',
  name: 'PHAN MY LINH',
  usdToVnd: 25400            // approx; QR amount only (matching is by the note)
};
let _vqrPoll = null;
var _vqrRef = '';   // active top-up reference (server-issued EGxxxxxx; read by the inline button + poll)
function vqrCreditWallet(amountUSD) {
  let bal = parseFloat(localStorage.getItem('eg_balance') || '0');
  bal = parseFloat((bal + amountUSD).toFixed(2));
  localStorage.setItem('eg_balance', bal.toFixed(2));
  document.querySelectorAll('#balance-val').forEach(el => el.textContent = '$' + bal.toFixed(2));
  const big = document.getElementById('wallet-bal-big'); if (big) big.textContent = '$' + bal.toFixed(2);
}
function closeVietQR() {
  if (_vqrPoll) { clearInterval(_vqrPoll); _vqrPoll = null; }
  const m = document.getElementById('vqr-modal'); if (m) m.style.display = 'none';
  document.body.style.overflow = '';
}
function _vqrPaintImg(url) {
  var box = document.getElementById('vqr-qrbox'); if (!box) return;
  box.innerHTML = '<img src="' + url + '" alt="VietQR" style="width:218px;height:218px;border-radius:9px" onerror="this.parentNode.textContent=\'QR unavailable — use account details below\'">';
}
function _vqrPaintQR(text) {
  var box = document.getElementById('vqr-qrbox'); if (!box || !text) return;
  var imgFallback = function () { _vqrPaintImg('https://api.qrserver.com/v1/create-qr-code/?size=218x218&data=' + encodeURIComponent(text)); };
  var render = function () { try { box.innerHTML = ''; new QRCode(box, { text: text, width: 218, height: 218, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { imgFallback(); } };
  if (window.QRCode) { render(); return; }
  var s = document.getElementById('vqr-qrlib');
  if (s) { s.addEventListener('load', render); return; }
  s = document.createElement('script'); s.id = 'vqr-qrlib';
  s.src = 'https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js';
  s.onload = render; s.onerror = imgFallback;
  document.head.appendChild(s);
}
function openVietQRTopUp(amountUSD) {
  // The server issues a clean sequential reference (EG000123) when it mints the QR
  // below. Until then we show a temporary client-side ref so the modal isn't blank;
  // it's replaced by the server's once create-payment returns.
  var u = {}; try { u = JSON.parse(localStorage.getItem('eg_user') || '{}'); } catch (e) {}
  const ref = ('EG' + Date.now().toString(36)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
  _vqrRef = ref;
  const rate = egVqrRate();
  const vnd = Math.max(1000, Math.round(amountUSD * rate / 1000) * 1000);
  // Fallback only — used if the server can't mint a VA-backed QR. The reliable
  // path below asks VietQR for a monitored-VA QR so callbacks always fire.
  const fallbackQr = 'https://img.vietqr.io/image/' + EG_VQR.bank + '-' + EG_VQR.account + '-qr_only.png'
    + '?amount=' + vnd + '&addInfo=' + encodeURIComponent(ref) + '&accountName=' + encodeURIComponent(EG_VQR.name);
  let m = document.getElementById('vqr-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'vqr-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:400;align-items:center;justify-content:center;font-family:inherit';
    document.body.appendChild(m);
  }
  const vndStr = vnd.toLocaleString('en-US');
  m.innerHTML =
    '<div onclick="closeVietQR()" style="position:fixed;inset:0;background:rgba(0,0,0,.45)"></div>'
    + '<div style="position:relative;background:#fff;border-radius:16px;width:380px;max-width:calc(100vw - 32px);box-shadow:0 24px 64px rgba(0,0,0,.25);padding:22px;animation:fadeUp .22s cubic-bezier(.22,1,.36,1)">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><div style="font-size:16px;font-weight:700;color:#191918">Top Up</div><button onclick="closeVietQR()" style="background:none;border:none;cursor:pointer;color:#9ca3af;padding:4px;border-radius:6px;display:flex"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>'
    + '<div style="text-align:center;margin-bottom:10px"><div style="font-size:13px;color:#6b7280">Adding to wallet</div><div style="font-size:24px;font-weight:800;color:#191918;line-height:1.1">$' + amountUSD.toFixed(2) + '</div><div style="font-size:12.5px;color:#9ca3af;margin-top:2px">Transfer ≈ ₫' + vndStr + ' · 1 USD = ₫' + rate.toLocaleString('en-US') + '</div></div>'
    + '<div style="display:flex;justify-content:center;margin:6px 0 12px"><div id="vqr-qrbox" style="width:220px;height:220px;border:1px solid #e5e4e0;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12.5px;gap:8px"><span class="vqr-spin" style="width:14px;height:14px;border:2px solid #d1d5db;border-top-color:#6b7280;border-radius:50%;display:inline-block;animation:vqrspin .8s linear infinite"></span>Generating secure QR…</div></div>'
    + '<div style="background:#faf9f7;border:1px solid #e5e4e0;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#374151;line-height:1.7;margin-bottom:12px">'
      + '<div style="display:flex;justify-content:space-between"><span style="color:#9ca3af">Bank</span><b>BIDV</b></div>'
      + '<div style="display:flex;justify-content:space-between"><span style="color:#9ca3af">Account</span><b id="vqr-acct" style="font-family:monospace">' + EG_VQR.account + '</b></div>'
      + '<div style="display:flex;justify-content:space-between"><span style="color:#9ca3af">Name</span><b>' + EG_VQR.name + '</b></div>'
      + '<div style="display:flex;justify-content:space-between"><span style="color:#9ca3af">Note (bắt buộc)</span><b id="vqr-ref-note" style="font-family:monospace;color:#b45309">' + ref + '</b></div>'
    + '</div>'
    + '<div style="font-size:12px;color:#9ca3af;text-align:center;margin-bottom:10px">Scan with your banking app. The note <b id="vqr-ref-inst" style="color:#b45309;font-family:monospace">' + ref + '</b> must be kept — it confirms your top-up automatically.</div>'
    + '<div id="vqr-status" style="display:flex;align-items:center;justify-content:center;gap:8px;font-size:13.5px;font-weight:600;color:#6b7280;padding:8px;background:#f6f5f4;border-radius:9px">'
      + '<span class="vqr-spin" style="width:14px;height:14px;border:2px solid #d1d5db;border-top-color:#6b7280;border-radius:50%;display:inline-block;animation:vqrspin .8s linear infinite"></span>Waiting for your transfer…</div>'
    + '<button onclick="vqrIveTransferred(' + amountUSD + ', _vqrRef, ' + vnd + ', this)" style="margin-top:8px;width:100%;background:#191918;color:#fff;border:none;border-radius:9px;padding:11px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">I\'ve transferred — notify admin</button>'
    + '</div>';
  if (!document.getElementById('vqr-spin-css')) {
    const st = document.createElement('style'); st.id = 'vqr-spin-css';
    st.textContent = '@keyframes vqrspin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }
  m.style.display = 'flex'; document.body.style.overflow = 'hidden';

  // Ask the server to mint a VA-backed QR (VietQR monitors that VA → guaranteed
  // callback). Fall back to the generic transfer QR if the call fails.
  (function mintQR() {
    const tok0 = localStorage.getItem('eg_token') || '';
    fetch('/api/vietqr/create-payment', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, tok0 ? { Authorization: 'Bearer ' + tok0 } : {}),
      body: JSON.stringify({ amount: vnd, note: ref })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.error) throw new Error((d && d.error) || 'no qr');
        // Adopt the server's clean sequential reference (EG000123) everywhere.
        if (d.note || d.ref) {
          _vqrRef = d.note || d.ref;
          var n1 = document.getElementById('vqr-ref-note'); if (n1) n1.textContent = _vqrRef;
          var n2 = document.getElementById('vqr-ref-inst'); if (n2) n2.textContent = _vqrRef;
        }
        // ONE branded VietQR image (no separate plain local-render variant → no flicker
        // between a logo QR and a plain one). Prefer the server's monitored-VA link;
        // otherwise the generic BIDV QR, which still auto-confirms via the note.
        if (d.qrLink && /^https?:\/\//i.test(d.qrLink)) { _vqrPaintImg(d.qrLink); }
        else { console.warn('VietQR create-payment had no usable QR link:', d); _vqrPaintImg(fallbackQr); }
        // Keep showing the real BIDV account in the details row — the QR carries the
        // monitored VA internally, so scanning still routes correctly + auto-confirms.
      })
      .catch(function () { _vqrPaintImg(fallbackQr); });   // graceful degradation
  })();

  // Poll for the matching transfer (reads _vqrRef live — it switches to the server
  // ref once create-payment returns). Capture VietQR's transaction id when it lands.
  if (_vqrPoll) clearInterval(_vqrPoll);
  const started = Date.now();
  const tok = localStorage.getItem('eg_token') || '';
  _vqrPoll = setInterval(function () {
    if (Date.now() - started > 15 * 60 * 1000) { clearInterval(_vqrPoll); _vqrPoll = null; return; }   // stop after 15 min
    fetch('/api/vietqr/status?ref=' + encodeURIComponent(_vqrRef), { headers: tok ? { Authorization: 'Bearer ' + tok } : {} })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.paid) vqrOnPaid(amountUSD, _vqrRef, d.transaction && (d.transaction.referencenumber || d.transaction.transactionid)); })
      .catch(function () {});
  }, 4000);
}
function vqrOnPaid(amountUSD, ref, txnId) {
  if (_vqrPoll) { clearInterval(_vqrPoll); _vqrPoll = null; }
  vqrCreditWallet(amountUSD);
  vqrRecordDeposit(amountUSD, ref, 'BIDV', txnId);
  const s = document.getElementById('vqr-status');
  if (s) { s.style.background = '#e7f6ec'; s.style.color = '#15803d';
    s.innerHTML = '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 8l3 3 6-7" stroke="#15803d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Payment received — $' + amountUSD.toFixed(2) + ' added'; }
  setTimeout(closeVietQR, 2200);
}
// Record a successful top-up into the wallet's payment history (persisted) so it
// shows in the Transactions table and the Deposits filter.
function vqrRecordDeposit(amountUSD, ref, method, txnId) {
  method = method || 'BIDV';
  try {
    var bal = parseFloat(localStorage.getItem('eg_balance') || '0');
    var now = new Date();
    var rec = {
      date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      desc: 'Wallet Top Up', order: '', ref: ref || '', txnId: txnId || '', platform: 'all', method: method,
      type: 'deposit', amount: amountUSD, balance: bal
    };
    if (typeof TX !== 'undefined') TX.unshift(rec);
    var saved = []; try { saved = JSON.parse(localStorage.getItem('eg_wallet_tx') || '[]'); } catch (e) {}
    saved.unshift(rec); localStorage.setItem('eg_wallet_tx', JSON.stringify(saved.slice(0, 200)));
    try { var d = (STATS.all[currentPeriod] || STATS.all.month); d.dep += amountUSD; } catch (e) {}
    if (typeof renderTx === 'function') renderTx();
    if (typeof updateStats === 'function') updateStats();
  } catch (e) {}
}
// Test helper (VietQR not live yet): pretend the transfer arrived.
function vqrSimulate(amountUSD, ref) { vqrOnPaid(amountUSD, ref); }
// Seller clicked "I've transferred" → create a pending top-up the admin can confirm,
// then wait for the admin's "Received". On confirm, vqrOnPaid credits the wallet AND
// records it in the seller's transaction history (vqrRecordDeposit).
function vqrIveTransferred(amountUSD, ref, vnd, btn) {
  var tok = localStorage.getItem('eg_token');
  if (!tok) { alert('Please sign in first.'); return; }
  var u = {}; try { u = JSON.parse(localStorage.getItem('eg_user') || '{}'); } catch (e) {}
  if (btn) { btn.disabled = true; btn.textContent = 'Notifying admin…'; }
  fetch('/api/topups', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ amount: amountUSD, vnd: vnd, ref: ref, note: ref, name: (u.name || u.email || '') }) })
    .then(function (r) { return r.json(); })
    .then(function (rec) {
      if (!rec || rec.error) { if (btn) { btn.disabled = false; btn.textContent = "I've transferred — notify admin"; } alert('Could not notify admin: ' + ((rec && rec.error) || 'error')); return; }
      // Record a PENDING row in the seller's history immediately + close the popup.
      vqrRecordPending(amountUSD, ref, rec.id);
      closeVietQR();
      walToast('Top-up sent — pending admin confirmation');
    })
    .catch(function (e) { if (btn) { btn.disabled = false; btn.textContent = "I've transferred — notify admin"; } alert('Could not notify admin: ' + e.message); });
}
// Small non-blocking toast.
function walToast(msg, ok) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:' + (ok === false ? '#dc2626' : '#191918') + ';color:#fff;padding:11px 20px;border-radius:9px;font-size:13.5px;font-weight:600;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.22);font-family:inherit';
  t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200);
}
// Record a pending top-up row (no balance change yet).
function vqrRecordPending(amountUSD, ref, topupId) {
  try {
    var now = new Date();
    var rec = {
      date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      desc: 'Wallet Top Up', order: '', ref: ref || '', txnId: '', platform: 'all', method: 'BIDV',
      type: 'deposit', amount: amountUSD, balance: parseFloat(localStorage.getItem('eg_balance') || '0'),
      pending: true, ref: ref, topupId: topupId
    };
    if (typeof TX !== 'undefined') TX.unshift(rec);
    var saved = []; try { saved = JSON.parse(localStorage.getItem('eg_wallet_tx') || '[]'); } catch (e) {}
    saved.unshift(rec); localStorage.setItem('eg_wallet_tx', JSON.stringify(saved.slice(0, 200)));
    if (typeof renderTx === 'function') renderTx();
  } catch (e) {}
}
// Patch matching TX rows in memory + storage.
function _vqrUpdateTx(matchFn, patch) {
  try { (typeof TX !== 'undefined' ? TX : []).forEach(function (t) { if (matchFn(t)) Object.assign(t, patch); }); } catch (e) {}
  try {
    var saved = JSON.parse(localStorage.getItem('eg_wallet_tx') || '[]');
    saved.forEach(function (t) { if (matchFn(t)) Object.assign(t, patch); });
    localStorage.setItem('eg_wallet_tx', JSON.stringify(saved.slice(0, 200)));
  } catch (e) {}
}
function vqrConfirmPending(rec) {
  var amt = Number(rec.amount_usd) || 0;
  vqrCreditWallet(amt);
  var newBal = parseFloat(localStorage.getItem('eg_balance') || '0');
  _vqrUpdateTx(function (t) { return t.pending && (t.topupId === rec.id || t.ref === rec.ref); }, { pending: false, balance: newBal, txnId: rec.txn_id || '' });
  try { var d = (STATS.all[currentPeriod] || STATS.all.month); d.dep += amt; } catch (e) {}
  if (typeof renderTx === 'function') renderTx();
  if (typeof updateStats === 'function') updateStats();
  walToast('Top-up confirmed — $' + amt.toFixed(2) + ' added');
}
function vqrRejectPending(rec) {
  _vqrUpdateTx(function (t) { return t.pending && (t.topupId === rec.id || t.ref === rec.ref); }, { pending: false, rejected: true });
  if (typeof renderTx === 'function') renderTx();
  walToast('A top-up was rejected by admin', false);
}
// Reconcile pending rows against the server (covers background + after reloads).
function vqrReconcile() {
  var tok = localStorage.getItem('eg_token'); if (!tok) return;
  var saved = []; try { saved = JSON.parse(localStorage.getItem('eg_wallet_tx') || '[]'); } catch (e) {}
  if (!saved.some(function (t) { return t.pending; })) return;
  fetch('/api/topups', { headers: { Authorization: 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (list) {
      if (!Array.isArray(list)) return;
      var byId = {}; list.forEach(function (x) { byId[x.id] = x; });
      saved.forEach(function (t) {
        if (!t.pending) return;
        var rec = byId[t.topupId]; if (!rec) return;
        if (rec.status === 'received') vqrConfirmPending(rec);
        else if (rec.status === 'rejected') vqrRejectPending(rec);
      });
    }).catch(function () {});
}
setInterval(vqrReconcile, 8000);
document.addEventListener('DOMContentLoaded', vqrReconcile);

// On load: pull the admin's shared rate, and restore persisted top-up history.
(function () {
  var tok = localStorage.getItem('eg_token');
  if (tok) {
    fetch('/api/vietqr/rate', { headers: { Authorization: 'Bearer ' + tok } })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.rate) { localStorage.setItem('eg_vqr_rate', String(d.rate)); if (typeof vqrSyncDepositUI === 'function') vqrSyncDepositUI(); } })
      .catch(function () {});
  }
  try {
    var saved = JSON.parse(localStorage.getItem('eg_wallet_tx') || '[]');
    if (Array.isArray(saved) && saved.length && typeof TX !== 'undefined') {
      saved.slice().reverse().forEach(function (r) { TX.unshift(r); });
      if (typeof renderTx === 'function') renderTx();
    }
  } catch (e) {}
})();

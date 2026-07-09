/* eg-withdraw.js — SHARED Withdraw window. ONE implementation for the seller wallet
   (wallet.html, account = the seller's own wallet) AND the factory wallet (admin.html /
   warehouse.html, account = 'factory'). Mirrors eg-addfunds.js: it self-injects its own
   modal markup, owns open/close/validate/submit, and exposes window.openWithdrawModal.

   A withdrawal is a REQUEST that needs admin approval (exactly like a manual top-up):
   POST /api/wallet/withdraw creates a PENDING row and does NOT debit — the balance only
   drops when a staff user approves it (server appends a negative ledger row, ref WD-<id>).

   Rules (kept in lockstep with server/src/routes/wallet.js):
     • the wallet must hold at least $50 to withdraw at all
     • a single request is capped at $500
     • and can never exceed the current available balance
   Submit is disabled with a helper message whenever a rule fails.

   Account selection — a page tells us which wallet to draw from, in order of precedence:
     openWithdrawModal({ account:'factory' })  →  explicit per-call
     window.EG_WITHDRAW_ACCOUNT = 'factory'     →  page-level default (set by admin/warehouse)
   Otherwise it defaults to the caller's OWN wallet (seller) — the server resolves the
   account from the JWT, so omitting `account` is the seller path. */
(function () {
  'use strict';
  var WD_MIN_BAL = 50;      // minimum balance required to withdraw
  var WD_MAX_REQ = 500;     // maximum per single request
  var _wdAccount = 'own';   // resolved on open: 'own' (seller) | 'factory' | 'designer'
  var _wdBal = 0;           // available balance shown in the modal
  var _wdForceFields = false; // "Use a different bank" was clicked → show entry fields even if one is saved
  var _wdQrData = '';       // data-URL of the QR image staged in the entry form (before Save)

  function _tok() { try { return localStorage.getItem('eg_token') || ''; } catch (e) { return ''; } }
  function _base() { return window.EG_API_BASE || ''; }

  /* ── Local-bank store — the SINGLE source of truth shared with eg-addfunds.js's
        Linked Accounts window. Both modules read/write localStorage['eg_local_banks']
        (a JSON array of { name, number, bank, qr, ts }); we also expose it on window
        as EGLocalBanks so either side can call the same guarded parse/save. ── */
  function _banksGet() {
    try { var v = JSON.parse(localStorage.getItem('eg_local_banks') || 'null'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function _banksSave(a) {
    try { localStorage.setItem('eg_local_banks', JSON.stringify(Array.isArray(a) ? a : [])); } catch (e) {}
    try { window.dispatchEvent(new Event('eg-local-banks-changed')); } catch (e) {}
  }
  function _banksAdd(b) { var a = _banksGet(); a.unshift(b); _banksSave(a); return a; }
  function _banksRemove(i) { var a = _banksGet(); if (i >= 0 && i < a.length) { a.splice(i, 1); _banksSave(a); } return a; }
  // The currently SELECTED bank = the first one saved (newest, since we unshift on Save).
  function _selectedBank() { var a = _banksGet(); return a.length ? a[0] : null; }
  function _mask(num) { var s = String(num || '').replace(/\s+/g, ''); return s.length > 4 ? ('•••• ' + s.slice(-4)) : (s || '••••'); }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  window.EGLocalBanks = { get: _banksGet, save: _banksSave, add: _banksAdd, remove: _banksRemove, mask: _mask };

  // Read the CURRENT available balance for whichever wallet we're withdrawing from.
  // Factory pages keep it in EGStore.getFactoryBalance(); the seller keeps eg_balance.
  function _liveBalance() {
    try {
      if (_wdAccount === 'factory' && window.EGStore && EGStore.getFactoryBalance) return EGStore.getFactoryBalance();
    } catch (e) {}
    try { return parseFloat(localStorage.getItem('eg_balance') || '0') || 0; } catch (e) { return 0; }
  }

  /* ── Self-inject the modal once, on any page that loads this script. ── */
  function _inject() {
    if (!document.body || document.getElementById('withdraw-modal')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="withdraw-modal" style="display:none;position:fixed;inset:0;z-index:400;align-items:center;justify-content:center;font-family:inherit">'
      + '<div onclick="closeWithdrawModal()" style="position:fixed;inset:0;background:rgba(25,25,24,.42)"></div>'
      + '<div style="background:#fdfcfa;border:1px solid #d7d4cc;border-radius:12px;width:420px;max-width:calc(100vw - 32px);box-shadow:5px 5px 0 #d7d4cc,0 24px 64px rgba(0,0,0,.22);padding:24px;position:relative">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">'
          + '<div style="font-size:16px;font-weight:700;color:#191918">Withdraw Funds</div>'
          + '<button onclick="closeWithdrawModal()" style="background:none;border:none;cursor:pointer;color:#9ca3af;padding:4px;border-radius:6px;display:flex" onmouseover="this.style.background=\'#f3eee2\'" onmouseout="this.style.background=\'\'"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>'
        + '</div>'
        + '<div style="background:#f3eee2;border:1px solid #d8d4cd;border-radius:8px;padding:12px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">'
          + '<div style="font-size:12.5px;color:#6b7280;font-weight:600">Available balance</div>'
          + '<div id="wd-avail" style="font-size:18px;font-weight:800;color:#191918;font-variant-numeric:tabular-nums">$0.00</div>'
        + '</div>'
        + '<div style="margin-bottom:14px">'
          + '<label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:5px">Withdraw to your bank</label>'
          + '<div id="wd-bank-box"></div>'
        + '</div>'
        + '<div style="margin-bottom:6px">'
          + '<label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:5px">Amount (USD)</label>'
          + '<div style="position:relative">'
            + '<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:16px;font-weight:600;color:#9ca3af">$</span>'
            + '<input id="wd-amount" type="number" min="50" max="500" step="0.01" placeholder="50.00" style="width:100%;border:1.5px solid #e5e4e0;border-radius:8px;padding:10px 12px 10px 28px;font-size:17px;font-family:inherit;outline:none;box-sizing:border-box;font-weight:700" onfocus="this.style.borderColor=\'#191918\'" onblur="this.style.borderColor=\'#e5e4e0\'" oninput="_wdValidate()"/>'
          + '</div>'
          + '<div id="wd-helper" style="font-size:12px;color:#9ca3af;margin-top:5px;font-weight:500">Minimum withdrawal: $' + WD_MIN_BAL.toFixed(2) + '</div>'
          + '<div style="display:flex;gap:6px;margin-top:8px">'
            + '<button onclick="_wdSet(50)" style="flex:1;background:#fff;border:1px solid #e5e4e0;border-radius:6px;padding:6px;font-size:12.5px;font-weight:600;color:#374151;cursor:pointer;font-family:inherit;transition:border-color .12s" onmouseover="this.style.borderColor=\'#9ca3af\'" onmouseout="this.style.borderColor=\'#e5e4e0\'">$50</button>'
            + '<button onclick="_wdSet(100)" style="flex:1;background:#fff;border:1px solid #e5e4e0;border-radius:6px;padding:6px;font-size:12.5px;font-weight:600;color:#374151;cursor:pointer;font-family:inherit;transition:border-color .12s" onmouseover="this.style.borderColor=\'#9ca3af\'" onmouseout="this.style.borderColor=\'#e5e4e0\'">$100</button>'
            + '<button onclick="_wdSet(250)" style="flex:1;background:#fff;border:1px solid #e5e4e0;border-radius:6px;padding:6px;font-size:12.5px;font-weight:600;color:#374151;cursor:pointer;font-family:inherit;transition:border-color .12s" onmouseover="this.style.borderColor=\'#9ca3af\'" onmouseout="this.style.borderColor=\'#e5e4e0\'">$250</button>'
            + '<button onclick="_wdSetMax()" style="flex:1;background:#fff;border:1px solid #e5e4e0;border-radius:6px;padding:6px;font-size:12.5px;font-weight:600;color:#374151;cursor:pointer;font-family:inherit;transition:border-color .12s" onmouseover="this.style.borderColor=\'#9ca3af\'" onmouseout="this.style.borderColor=\'#e5e4e0\'">Max</button>'
          + '</div>'
        + '</div>'
        + '<button id="wd-submit" onclick="submitWithdraw()" style="width:100%;background:#191918;color:#fff;border:none;border-radius:8px;padding:11px;font-size:14.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">'
          + '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 12V1M2 8l4.5 4.5L11 8" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Request Withdrawal'
        + '</button>'
        + '<div style="text-align:center;margin-top:10px;font-size:12px;color:#9ca3af;line-height:1.5">Withdrawals are reviewed by an admin before the payout is sent.</div>'
      + '</div>'
      + '</div>';
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }
  if (document.body) _inject(); else document.addEventListener('DOMContentLoaded', _inject);

  function openWithdrawModal(opts) {
    _inject();
    // Resolve the account: explicit arg → page default → own (seller).
    var acc = (opts && opts.account) ? String(opts.account)
            : (window.EG_WITHDRAW_ACCOUNT ? String(window.EG_WITHDRAW_ACCOUNT) : 'own');
    _wdAccount = acc;
    _wdBal = _liveBalance();
    _wdForceFields = false; _wdQrData = '';
    var avail = document.getElementById('wd-avail');
    if (avail) avail.textContent = '$' + _wdBal.toFixed(2);
    var amt = document.getElementById('wd-amount'); if (amt) amt.value = '';
    _wdRenderBank();
    _wdValidate();
    var m = document.getElementById('withdraw-modal');
    if (m) m.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  /* ── Bank-destination block: SUMMARY of the saved local bank, or entry FIELDS
        when none is saved (or "Use a different bank" was clicked). ── */
  function _wdRenderBank() {
    var box = document.getElementById('wd-bank-box'); if (!box) return;
    var b = _selectedBank();
    if (b && !_wdForceFields) { box.innerHTML = _wdSummaryHtml(b); }
    else { box.innerHTML = _wdFieldsHtml(); }
  }
  function _wdSummaryHtml(b) {
    var qr = b.qr
      ? '<img src="' + _esc(b.qr) + '" alt="QR" style="width:44px;height:44px;border-radius:6px;object-fit:cover;border:1px solid #e5e4e0;flex-shrink:0">'
      : '';
    return '<div style="display:flex;align-items:center;gap:11px;border:1.5px solid #e5e4e0;border-radius:8px;padding:11px 13px;background:#fff">'
      + qr
      + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:14px;font-weight:700;color:#191918;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(b.bank || 'Bank') + '</div>'
        + '<div style="font-size:12.5px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(b.name || '') + ' · <span style="font-family:monospace">' + _esc(_mask(b.number)) + '</span></div>'
      + '</div>'
      + '<span style="font-size:11px;font-weight:700;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:2px 9px;flex-shrink:0">Selected</span>'
      + '</div>'
      + '<button type="button" onclick="_wdUseDifferentBank()" style="background:none;border:none;padding:6px 0 0;margin:0;font-size:12px;font-weight:600;color:#6b7280;cursor:pointer;font-family:inherit;text-decoration:underline;text-decoration-color:#c4c3be;text-underline-offset:3px">Use a different bank</button>';
  }
  function _wdFieldsHtml() {
    var _is = 'width:100%;border:1.5px solid #e5e4e0;border-radius:8px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;color:#191918';
    var _foc = 'onfocus="this.style.borderColor=\'#191918\'" onblur="this.style.borderColor=\'#e5e4e0\'"';
    var _lbl = 'font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px';
    var has = _banksGet().length;
    return (has ? '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><button type="button" onclick="_wdCancelDifferentBank()" style="background:none;border:none;cursor:pointer;color:#6b7280;font-size:12.5px;font-weight:600;font-family:inherit;display:inline-flex;align-items:center;gap:3px;padding:0"><span style="font-size:16px;line-height:1">‹</span>Use saved bank</button></div>' : '')
      + '<div style="display:flex;flex-direction:column;gap:10px">'
        + '<div><label style="' + _lbl + '">Account Name</label><input id="wd-bank-name" type="text" placeholder="Nguyen Van A" style="' + _is + '" ' + _foc + '></div>'
        + '<div><label style="' + _lbl + '">Account Number</label><input id="wd-bank-number" type="text" inputmode="numeric" placeholder="0123456789" style="' + _is + '" ' + _foc + '></div>'
        + '<div><label style="' + _lbl + '">Bank Name</label><input id="wd-bank-bank" type="text" placeholder="BIDV / Vietcombank / …" style="' + _is + '" ' + _foc + '></div>'
        + '<div><label style="' + _lbl + '">QR code image <span style="color:#9ca3af;font-weight:500">(optional)</span></label>'
          + '<input id="wd-bank-qr" type="file" accept="image/*" onchange="_wdOnQrFile(this)" style="display:none">'
          + '<div style="display:flex;align-items:center;gap:10px">'
            + '<button type="button" onclick="document.getElementById(\'wd-bank-qr\').click()" style="display:inline-flex;align-items:center;gap:6px;border:1.5px dashed #d7d4cc;background:#faf9f7;border-radius:8px;padding:8px 12px;font-size:12.5px;font-weight:600;color:#191918;cursor:pointer;font-family:inherit" onmouseover="this.style.borderColor=\'#191918\'" onmouseout="this.style.borderColor=\'#d7d4cc\'"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 9.5V2M4 4.5L7 1.5l3 3M2.5 9.5v2a1 1 0 001 1h7a1 1 0 001-1v-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>Upload QR</button>'
            + '<img id="wd-bank-qr-preview" alt="" style="display:none;width:44px;height:44px;border-radius:6px;object-fit:cover;border:1px solid #e5e4e0">'
          + '</div>'
        + '</div>'
        + '<div id="wd-bank-err" style="display:none;font-size:12px;color:#dc2626;font-weight:600"></div>'
        + '<button type="button" onclick="_wdSaveBank()" style="width:100%;background:#191918;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">Save bank</button>'
      + '</div>';
  }
  function _wdUseDifferentBank() { _wdForceFields = true; _wdQrData = ''; _wdRenderBank(); _wdValidate(); }
  function _wdCancelDifferentBank() { _wdForceFields = false; _wdQrData = ''; _wdRenderBank(); _wdValidate(); }
  function _wdOnQrFile(input) {
    var f = input && input.files && input.files[0];
    var prev = document.getElementById('wd-bank-qr-preview');
    if (!f) { _wdQrData = ''; if (prev) prev.style.display = 'none'; return; }
    if (f.size > 8 * 1024 * 1024) { var er = document.getElementById('wd-bank-err'); if (er) { er.textContent = 'QR image too large (max 8MB).'; er.style.display = 'block'; } input.value = ''; return; }
    var rd = new FileReader();
    rd.onload = function () { _wdQrData = rd.result; if (prev) { prev.src = rd.result; prev.style.display = 'block'; } };
    rd.readAsDataURL(f);
  }
  function _wdSaveBank() {
    var name = ((document.getElementById('wd-bank-name') || {}).value || '').trim();
    var number = ((document.getElementById('wd-bank-number') || {}).value || '').trim();
    var bank = ((document.getElementById('wd-bank-bank') || {}).value || '').trim();
    var er = document.getElementById('wd-bank-err');
    if (!name || !number || !bank) {
      if (er) { er.textContent = 'Account name, account number and bank name are all required.'; er.style.display = 'block'; }
      return;
    }
    // Save + make it the SELECTED bank (unshift → first == selected), then show the summary.
    _banksAdd({ name: name, number: number, bank: bank, qr: _wdQrData || '', ts: Date.now() });
    _wdForceFields = false; _wdQrData = '';
    _wdRenderBank();
    _wdValidate();
    _toast('Saved to Linked Accounts');
  }
  function closeWithdrawModal() {
    var m = document.getElementById('withdraw-modal');
    if (m) m.style.display = 'none';
    document.body.style.overflow = '';
  }
  function _wdSet(n) { var el = document.getElementById('wd-amount'); if (el) { el.value = n; _wdValidate(); } }
  function _wdSetMax() {
    // Max you can request = min(balance, per-request cap).
    var cap = Math.min(_wdBal, WD_MAX_REQ);
    _wdSet(cap.toFixed(2));
  }
  function _wdValidate() {
    var input = document.getElementById('wd-amount');
    var helper = document.getElementById('wd-helper');
    var btn = document.getElementById('wd-submit');
    if (!input || !helper || !btn) return;
    var amt = parseFloat(input.value || '0') || 0;
    var bal = _wdBal;
    var hasBank = !!_selectedBank();
    var msg, color, disabled;
    if (bal < WD_MIN_BAL) {
      // Whole feature is gated until the balance clears the floor.
      msg = 'A minimum balance of $' + WD_MIN_BAL.toFixed(2) + ' is required to withdraw (you have $' + bal.toFixed(2) + ')';
      color = '#dc2626'; disabled = true;
    } else if (!hasBank) {
      // No payout destination yet — must save a bank before requesting.
      msg = 'Add your bank details above to receive the payout.';
      color = '#9ca3af'; disabled = true;
    } else if (!amt) {
      msg = 'Minimum withdrawal: $' + WD_MIN_BAL.toFixed(2) + ' · maximum $' + WD_MAX_REQ.toFixed(2) + ' per request';
      color = '#9ca3af'; disabled = true;
    } else if (amt < WD_MIN_BAL) {
      msg = 'Below minimum — must withdraw at least $' + WD_MIN_BAL.toFixed(2);
      color = '#dc2626'; disabled = true;
    } else if (amt > WD_MAX_REQ) {
      msg = 'Over the limit — max $' + WD_MAX_REQ.toFixed(2) + ' per request';
      color = '#dc2626'; disabled = true;
    } else if (amt > bal) {
      msg = 'Exceeds available balance ($' + bal.toFixed(2) + ')';
      color = '#dc2626'; disabled = true;
    } else {
      msg = 'Request $' + amt.toFixed(2) + ' — pending admin approval · balance after $' + (bal - amt).toFixed(2);
      color = '#15803d'; disabled = false;
    }
    helper.textContent = msg;
    helper.style.color = color;
    btn.disabled = disabled;
    btn.style.opacity = disabled ? '0.45' : '1';
    btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
  }
  function _toast(msg) {
    try { if (window.EGStore && EGStore._toast) { EGStore._toast(msg); return; } } catch (e) {}
    alert(msg);
  }
  function submitWithdraw() {
    var input = document.getElementById('wd-amount');
    var amount = input ? (parseFloat(input.value || '0') || 0) : 0;
    var bank = _selectedBank();
    var bal = _liveBalance();
    // Re-check every gate before hitting the network — never trust the form alone.
    if (!bank) { _toast('Add your bank details before requesting a withdrawal.'); return; }
    if (bal < WD_MIN_BAL) { _toast('A minimum balance of $' + WD_MIN_BAL.toFixed(2) + ' is required to withdraw.'); return; }
    if (amount < WD_MIN_BAL) { _toast('Minimum withdrawal is $' + WD_MIN_BAL.toFixed(2) + '.'); return; }
    if (amount > WD_MAX_REQ) { _toast('The maximum per request is $' + WD_MAX_REQ.toFixed(2) + '.'); return; }
    if (amount > bal) { _toast('Withdrawal exceeds available balance ($' + bal.toFixed(2) + ').'); return; }
    var tok = _tok();
    if (!tok) { _toast('You need to be signed in to withdraw.'); return; }
    var btn = document.getElementById('wd-submit');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    // Withdrawals are ALWAYS a manual bank transfer — put the saved bank details into
    // `dest` so the admin knows exactly where to pay.
    var dest = 'Bank Transfer · ' + (bank.bank || '') + ' · ' + (bank.name || '') + ' · ' + (bank.number || '');
    var body = { amount: amount, method: 'bank', dest: dest };
    if (_wdAccount !== 'own') body.account = _wdAccount;
    fetch(_base() + '/api/wallet/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j || res.j.error) {
          if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
          _toast('Withdrawal failed — ' + ((res.j && res.j.error) || 'try again.'));
          return;
        }
        closeWithdrawModal();
        _toast('Withdrawal of $' + amount.toFixed(2) + ' requested — pending admin approval.');
        // Surface the new pending request in the transaction history immediately.
        try { if (typeof hydrateWalletTx === 'function') hydrateWalletTx(); } catch (e) {}
        try { if (typeof walRefresh === 'function') walRefresh(); } catch (e) {}
        try { window.dispatchEvent(new Event('eg-withdrawals-changed')); } catch (e) {}
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
        _toast('Withdrawal failed — ' + (e && e.message ? e.message : 'network error.'));
      });
  }

  window.openWithdrawModal = openWithdrawModal;
  window.closeWithdrawModal = closeWithdrawModal;
  window.submitWithdraw = submitWithdraw;
  window._wdSet = _wdSet;
  window._wdSetMax = _wdSetMax;
  window._wdValidate = _wdValidate;
  window._wdUseDifferentBank = _wdUseDifferentBank;
  window._wdCancelDifferentBank = _wdCancelDifferentBank;
  window._wdOnQrFile = _wdOnQrFile;
  window._wdSaveBank = _wdSaveBank;
})();

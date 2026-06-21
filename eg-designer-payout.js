/* ──────────────────────────────────────────────────────────────────────────
   eg-designer-payout.js — Designer board "Request Payout" + PayPal connect.

   Shared by designer.html and design-board.html (one source of truth). Renders
   into <div id="dsn-payout-card">. Connection-aware: prompts "Connect PayPal"
   until a payout account is linked, then shows the amount + destination + a
   "Request Payout" action and a "Manage payout accounts" modal (PayPal + local
   banks), styled after the seller's Linked Accounts window.

   Backend-optional (matches the rest of the app): every action persists to
   localStorage immediately and ALSO syncs to /api/paypal/payout-account +
   /api/paypal/payout when the server is reachable. Requesting a payout records a
   PENDING request — it never auto-sends money (admin releases it via the
   existing flow), so there's no unguarded money path.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  var LS = 'eg_designer_payout';
  var HIST = 'eg_designer_payout_history';

  // Vietnam local banks for the quick-select dropdown (matches the seller wallet's
  // BIDV-style linking). value = display name; the BIN drives nothing here.
  var BANKS = ['BIDV', 'Vietcombank', 'VietinBank', 'Techcombank', 'VPBank', 'ACB',
               'MB Bank', 'Sacombank', 'TPBank', 'Agribank', 'HDBank', 'VIB', 'Other bank'];

  function tok() { try { return localStorage.getItem('eg_token') || ''; } catch (e) { return ''; } }
  function apiBase() { return window.EG_API_BASE || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(m, c) {
    if (typeof window.toast === 'function') { try { return window.toast(m, c); } catch (e) {} }
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:#191918;color:#fff;padding:11px 18px;border-radius:9px;font-size:13.5px;font-weight:600;z-index:9999;box-shadow:0 6px 22px rgba(0,0,0,.25)';
    t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function maskEmail(e) {
    e = String(e || ''); var at = e.indexOf('@'); if (at < 1) return e;
    var u = e.slice(0, at); return (u.length <= 2 ? u[0] : u.slice(0, 2)) + '••@' + e.slice(at + 1);
  }

  // ── state ──────────────────────────────────────────────────────────────────
  function state() {
    try { var s = JSON.parse(localStorage.getItem(LS) || 'null'); if (s && typeof s === 'object') { s.banks = Array.isArray(s.banks) ? s.banks : []; return s; } } catch (e) {}
    return { paypal: null, banks: [], defaultKey: null };
  }
  function save(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) {} }
  function history() { try { var h = JSON.parse(localStorage.getItem(HIST) || '[]'); return Array.isArray(h) ? h : []; } catch (e) { return []; } }
  function pushHistory(rec) { try { var h = history(); h.unshift(rec); localStorage.setItem(HIST, JSON.stringify(h.slice(0, 50))); } catch (e) {} }

  // Every destination (PayPal + each bank) as a uniform list with a stable key.
  function destinations() {
    var s = state(), out = [];
    if (s.paypal && s.paypal.email) out.push({ key: 'paypal', kind: 'paypal', label: 'PayPal', sub: s.paypal.email });
    s.banks.forEach(function (b) { out.push({ key: 'bank:' + b.id, kind: 'bank', label: b.bank, sub: (b.name || '') + (b.last4 ? ' · ••' + b.last4 : '') }); });
    return out;
  }
  function defaultDest() {
    var s = state(), dests = destinations();
    if (!dests.length) return null;
    var d = dests.filter(function (x) { return x.key === s.defaultKey; })[0];
    return d || dests[0];
  }

  // ── API (graceful: null on any failure → localStorage stays the source) ──────
  function api(method, path, body) {
    var h = {}; if (tok()) h.Authorization = 'Bearer ' + tok();
    if (body) h['Content-Type'] = 'application/json';
    return fetch(apiBase() + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return r.ok ? d : null; }); })
      .catch(function () { return null; });
  }
  // Pull server-linked accounts on load and reconcile into local state.
  function hydrate() {
    return api('GET', '/api/paypal/payout-account').then(function (rows) {
      if (!Array.isArray(rows)) return;            // offline/standalone → keep local
      var s = { paypal: null, banks: [], defaultKey: state().defaultKey };
      rows.forEach(function (r) {
        if (r.provider === 'paypal') { s.paypal = { email: r.handle, connected: true }; if (r.is_default) s.defaultKey = 'paypal'; }
        else if (r.provider === 'bank') { var b = { id: String(r.id), bank: r.label || 'Bank', name: (r.meta && r.meta.name) || '', last4: (r.meta && r.meta.last4) || '' }; s.banks.push(b); if (r.is_default) s.defaultKey = 'bank:' + b.id; }
      });
      save(s);
    });
  }

  // ── card render ──────────────────────────────────────────────────────────────
  function render() {
    var host = document.getElementById('dsn-payout-card'); if (!host) return;
    var dest = defaultDest();
    var connected = !!dest;
    var chip = connected
      ? '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:#15803d;background:#f0fdf4;border:1px solid #86efac;padding:3px 11px;border-radius:999px"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="#15803d" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' + (dest.kind === 'paypal' ? 'PayPal connected' : 'Bank connected') + '</span>'
      : '<span style="font-size:12.5px;font-weight:600;color:#9ca3af;background:#f4f2ef;border:1px solid #e5e4e0;padding:3px 11px;border-radius:999px">Not connected</span>';

    var body;
    if (!connected) {
      body = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
        + '<div style="flex:1;min-width:200px;font-size:13.5px;color:#6b7280;line-height:1.5">Connect your PayPal to receive payouts directly to your account.</div>'
        + '<button onclick="EGPayout.connect()" style="display:inline-flex;align-items:center;gap:8px;background:#003087;color:#fff;border:none;border-radius:9px;padding:11px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">'
        +   '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M5 4h6a2.5 2.5 0 010 5H7L6 13H4l2-9z" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>Connect PayPal</button>'
        + '</div>';
    } else {
      var opts = destinations().map(function (d) {
        return '<option value="' + esc(d.key) + '"' + (d.key === dest.key ? ' selected' : '') + '>' + esc(d.label + ' · ' + (d.kind === 'paypal' ? maskEmail(d.sub) : d.sub)) + '</option>';
      }).join('');
      body = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
        + '<div style="position:relative;flex-shrink:0"><span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:14px">$</span>'
        +   '<input id="dp-amt" type="number" min="1" step="0.01" placeholder="Amount" style="width:150px;border:1.5px solid #e5e4e0;border-radius:9px;padding:10px 12px 10px 22px;font-size:14px;font-family:inherit;outline:none;color:#191918" onfocus="this.style.borderColor=\'#191918\'" onblur="this.style.borderColor=\'#e5e4e0\'"></div>'
        + '<select id="dp-dest" style="flex:1;min-width:170px;border:1.5px solid #e5e4e0;border-radius:9px;padding:10px 12px;font-size:13.5px;font-family:inherit;outline:none;color:#374151;background:#fff;cursor:pointer">' + opts + '</select>'
        + '<button onclick="EGPayout.request()" style="background:#15803d;color:#fff;border:none;border-radius:9px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">Request Payout</button>'
        + '</div>';
    }

    host.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px">'
      +   '<div style="font-size:15px;font-weight:700;color:#191918">Request Payout</div>' + chip
      + '</div>'
      + body
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:10px;flex-wrap:wrap">'
      +   '<div style="font-size:12px;color:#b0aaa4">' + (connected ? 'Paid to your connected account.' : 'No payout account linked yet.') + '</div>'
      +   '<button onclick="EGPayout.manage()" style="background:none;border:none;cursor:pointer;color:#6b7280;font-size:12.5px;font-weight:600;font-family:inherit;text-decoration:underline;padding:2px">Manage payout accounts</button>'
      + '</div>';
  }

  // ── connect (quick) ──────────────────────────────────────────────────────────
  // Connect PayPal by entering the PayPal email — payouts are sent to that email.
  function connect() { manage('paypal', true); }

  function request() {
    var dest = defaultDest();
    var sel = document.getElementById('dp-dest');
    if (sel && sel.value) { var d = destinations().filter(function (x) { return x.key === sel.value; })[0]; if (d) dest = d; }
    if (!dest) { connect(); return; }
    var amtEl = document.getElementById('dp-amt');
    var amt = Math.round((parseFloat(amtEl && amtEl.value) || 0) * 100) / 100;
    if (!(amt > 0)) { if (amtEl) { amtEl.focus(); amtEl.style.borderColor = '#dc2626'; } toast('Enter a payout amount', '#dc2626'); return; }
    var rec = { amount: amt, dest: dest.label, sub: dest.sub, status: 'Pending', ts: Date.now() };
    pushHistory(rec);
    if (amtEl) amtEl.value = '';
    // Fire-and-forget server record (pending; admin releases it later).
    api('POST', '/api/paypal/payout', { amount: amt, account: dest.key });
    toast('💸 Payout of $' + amt.toFixed(2) + ' requested to ' + dest.label);
    if (typeof window.dbRenderPayoutHistory === 'function') { try { window.dbRenderPayoutHistory(); } catch (e) {} }
  }

  // ── Manage Payout Accounts modal (styled like seller Linked Accounts) ────────
  var _tab = 'paypal', _addingBank = false;
  function manage(tab, adding) { _tab = tab || 'paypal'; _addingBank = !!adding && _tab === 'bank'; _renderModal(); var m = document.getElementById('dp-modal'); if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; } }
  function closeManage() { var m = document.getElementById('dp-modal'); if (m) m.style.display = 'none'; document.body.style.overflow = ''; _addingBank = false; }
  function selectTab(t) { _tab = t; _addingBank = false; _renderModal(); }

  function _renderModal() {
    var m = document.getElementById('dp-modal');
    if (!m) { m = document.createElement('div'); m.id = 'dp-modal'; m.style.cssText = 'display:none;position:fixed;inset:0;z-index:600;align-items:center;justify-content:center;font-family:inherit'; document.body.appendChild(m); m.addEventListener('click', function (e) { if (e.target === m) closeManage(); }); }
    var nav = function (key, label, icon) {
      var on = _tab === key;
      return '<button onclick="EGPayout._tab(\'' + key + '\')" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:' + (on ? '#f0ede9' : 'transparent') + ';border:none;border-radius:9px;padding:11px 13px;font-size:14px;font-weight:' + (on ? '700' : '600') + ';color:' + (on ? '#191918' : '#6b7280') + ';cursor:pointer;font-family:inherit">' + icon + '<span>' + label + '</span></button>';
    };
    var icPay = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M5 4h6a2.5 2.5 0 010 5H7L6 13H4l2-9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    var icBank = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l6 3v1H2v-1l6-3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M3 6.5v5M6 6.5v5M10 6.5v5M13 6.5v5M2 13.5h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
    m.innerHTML = '<div onclick="EGPayout.close()" style="position:fixed;inset:0;background:rgba(25,25,24,.5)"></div>'
      + '<div style="position:relative;background:#fdfcfa;border:1px solid #40403d;border-radius:18px;box-shadow:5px 5px 0 #40403d,0 28px 70px rgba(0,0,0,.3);width:760px;max-width:calc(100vw - 28px);height:560px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid #ece8e0"><div><div style="font-size:17px;font-weight:800;color:#191918">Payout Accounts</div><div style="font-size:12.5px;color:#9ca3af;margin-top:1px">Where your design earnings are paid</div></div><button onclick="EGPayout.close()" style="background:none;border:none;cursor:pointer;color:#9ca3af;padding:5px;border-radius:7px" onmouseover="this.style.background=\'#f0ede9\'" onmouseout="this.style.background=\'transparent\'"><svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>'
      +   '<div style="display:flex;flex:1;min-height:0">'
      +     '<div style="width:200px;flex-shrink:0;border-right:1px solid #ece8e0;padding:14px;display:flex;flex-direction:column;gap:4px">' + nav('paypal', 'PayPal', icPay) + nav('bank', 'Local banks', icBank) + '</div>'
      +     '<div style="flex:1;overflow:auto;padding:24px">' + (_tab === 'bank' ? _bankHtml() : _paypalHtml()) + '</div>'
      +   '</div>'
      + '</div>';
  }

  function _isDefault(key) { return defaultDest() && defaultDest().key === key; }
  function _defaultPill(key) {
    if (_isDefault(key)) return '<span style="font-size:11px;font-weight:700;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:2px 9px">Default</span>';
    return '<button onclick="EGPayout._default(\'' + key + '\')" style="font-size:11.5px;font-weight:600;color:#6b7280;background:#f4f2ef;border:1px solid #e5e4e0;border-radius:999px;padding:3px 10px;cursor:pointer;font-family:inherit">Set default</button>';
  }

  function _paypalHtml() {
    var s = state();
    var head = '<div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:.03em;margin-bottom:12px">PAYPAL ACCOUNT</div>';
    if (s.paypal && s.paypal.email) {
      return head
        + '<div style="display:flex;align-items:center;gap:13px;border:1px solid #ece8e0;border-radius:12px;padding:14px 16px;background:#fff;margin-bottom:14px">'
        +   '<span style="width:34px;height:34px;border-radius:9px;background:#e8f0fe;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M5 4h6a2.5 2.5 0 010 5H7L6 13H4l2-9z" stroke="#003087" stroke-width="1.3" stroke-linejoin="round"/></svg></span>'
        +   '<div style="flex:1;min-width:0"><div style="font-size:14.5px;font-weight:700;color:#191918">' + esc(s.paypal.email) + '</div><div style="font-size:12px;color:#15803d;font-weight:600;display:flex;align-items:center;gap:4px"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="#15803d" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Connected</div></div>'
        +   _defaultPill('paypal')
        +   '<button onclick="EGPayout._disconnect()" title="Disconnect" style="background:none;border:none;cursor:pointer;color:#c4c3be;padding:5px" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#c4c3be\'"><svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>'
        + '</div>'
        + '<div style="font-size:12.5px;color:#9ca3af;line-height:1.55">Payouts are sent to this PayPal account. To change it, disconnect and connect another.</div>';
    }
    var inp = 'width:100%;border:1.5px solid #e5e4e0;border-radius:10px;padding:11px 13px;font-size:14.5px;font-family:inherit;outline:none;box-sizing:border-box;color:#191918';
    return head
      + '<div style="border:1.5px dashed #cdd7ea;border-radius:14px;padding:22px;background:#f7faff;text-align:center;margin-bottom:16px">'
      +   '<svg width="30" height="30" viewBox="0 0 16 16" fill="none" style="margin-bottom:8px"><path d="M5 4h6a2.5 2.5 0 010 5H7L6 13H4l2-9z" stroke="#003087" stroke-width="1.2" stroke-linejoin="round"/></svg>'
      +   '<div style="font-size:14.5px;font-weight:700;color:#191918;margin-bottom:3px">Connect your PayPal</div>'
      +   '<div style="font-size:12.5px;color:#6b7280">Enter the email on your PayPal account to receive payouts.</div>'
      + '</div>'
      + '<label style="font-size:12px;font-weight:700;color:#6b7280;display:block;margin-bottom:6px;letter-spacing:.03em">PAYPAL EMAIL</label>'
      + '<input id="dp-pp-email" type="email" placeholder="you@example.com" style="' + inp + '" onfocus="this.style.borderColor=\'#191918\'" onblur="this.style.borderColor=\'#e5e4e0\'">'
      + '<button onclick="EGPayout._connectPaypal()" style="width:100%;margin-top:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#003087;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">'
      +   '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M5 4h6a2.5 2.5 0 010 5H7L6 13H4l2-9z" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>Connect PayPal</button>';
  }

  function _bankHtml() {
    var s = state();
    var head = '<div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:.03em;margin-bottom:12px">LINKED BANKS</div>';
    if (_addingBank) {
      var inp = 'width:100%;border:1.5px solid #e5e4e0;border-radius:10px;padding:11px 13px;font-size:14.5px;font-family:inherit;outline:none;box-sizing:border-box;color:#191918';
      var lbl = 'font-size:12px;font-weight:700;color:#6b7280;display:block;margin-bottom:6px;letter-spacing:.03em';
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px"><button onclick="EGPayout._cancelBank()" style="background:none;border:none;cursor:pointer;color:#6b7280;font-size:13.5px;font-weight:600;font-family:inherit;display:inline-flex;align-items:center;gap:4px"><span style="font-size:17px;line-height:1">‹</span>Banks</button></div>'
        + '<div style="display:flex;flex-direction:column;gap:14px;max-width:380px">'
        +   '<div><label style="' + lbl + '">BANK</label><select id="dp-bk-bank" style="' + inp + ';cursor:pointer">' + BANKS.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('') + '</select></div>'
        +   '<div><label style="' + lbl + '">ACCOUNT NAME</label><input id="dp-bk-name" type="text" placeholder="NGUYEN VAN A" style="' + inp + ';text-transform:uppercase" onfocus="this.style.borderColor=\'#191918\'" onblur="this.style.borderColor=\'#e5e4e0\'"></div>'
        +   '<div><label style="' + lbl + '">ACCOUNT NUMBER</label><input id="dp-bk-num" type="text" inputmode="numeric" placeholder="0123456789" style="' + inp + ';font-family:monospace;letter-spacing:1px" oninput="this.value=this.value.replace(/\\D/g,\'\')" onfocus="this.style.borderColor=\'#191918\'" onblur="this.style.borderColor=\'#e5e4e0\'"></div>'
        +   '<button onclick="EGPayout._saveBank()" style="width:100%;background:#191918;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Link bank</button>'
        + '</div>';
    }
    var rows = s.banks.map(function (b) {
      var key = 'bank:' + b.id;
      return '<div style="display:flex;align-items:center;gap:13px;border:1px solid #ece8e0;border-radius:12px;padding:13px 15px;margin-bottom:10px;background:#fff">'
        + '<span style="width:34px;height:34px;border-radius:9px;background:#f4f2ef;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l6 3v1H2v-1l6-3z" stroke="#6b7280" stroke-width="1.2" stroke-linejoin="round"/><path d="M3 6.5v5M6 6.5v5M10 6.5v5M13 6.5v5M2 13.5h12" stroke="#6b7280" stroke-width="1.2" stroke-linecap="round"/></svg></span>'
        + '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:#191918">' + esc(b.bank) + '</div><div style="font-size:12px;color:#9ca3af">' + esc(b.name || 'Account') + (b.last4 ? ' · ••' + esc(b.last4) : '') + '</div></div>'
        + _defaultPill(key)
        + '<button onclick="EGPayout._removeBank(\'' + esc(b.id) + '\')" title="Remove" style="background:none;border:none;cursor:pointer;color:#c4c3be;padding:5px" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#c4c3be\'"><svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>'
        + '</div>';
    }).join('') || '<div style="font-size:13.5px;color:#9ca3af;padding:14px 0">No banks linked yet.</div>';
    return head + rows
      + '<button onclick="EGPayout._addBank()" style="width:100%;display:flex;align-items:center;justify-content:center;gap:7px;border:1.5px dashed #d8d4cd;background:#faf9f7;border-radius:12px;padding:13px;font-size:14px;font-weight:600;color:#191918;cursor:pointer;font-family:inherit;margin-top:4px" onmouseover="this.style.borderColor=\'#191918\'" onmouseout="this.style.borderColor=\'#d8d4cd\'"><svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Add a local bank</button>'
      + '<div style="font-size:12px;color:#b0aaa4;margin-top:12px;line-height:1.5">Local banks linked to your PayPal can be used as a payout destination. PayPal moves the funds to the selected bank.</div>';
  }

  // ── account mutations (local first, then sync) ───────────────────────────────
  function connectPaypal() {
    var el = document.getElementById('dp-pp-email');
    var email = (el && el.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (el) { el.focus(); el.style.borderColor = '#dc2626'; } toast('Enter a valid PayPal email', '#dc2626'); return; }
    var s = state(); s.paypal = { email: email, connected: true }; if (!s.defaultKey) s.defaultKey = 'paypal'; save(s);
    api('POST', '/api/paypal/payout-account', { provider: 'paypal', handle: email, makeDefault: defaultDest() && defaultDest().key === 'paypal' });
    toast('✓ PayPal connected'); _renderModal(); render();
  }
  function disconnectPaypal() {
    if (!confirm('Disconnect this PayPal account?')) return;
    var s = state(); s.paypal = null; if (s.defaultKey === 'paypal') s.defaultKey = null; save(s);
    api('DELETE', '/api/paypal/payout-account/paypal');
    _renderModal(); render();
  }
  function addBankForm() { _addingBank = true; _renderModal(); }
  function cancelBank() { _addingBank = false; _renderModal(); }
  function saveBank() {
    var bank = (document.getElementById('dp-bk-bank') || {}).value || 'Bank';
    var name = ((document.getElementById('dp-bk-name') || {}).value || '').trim();
    var num = ((document.getElementById('dp-bk-num') || {}).value || '').replace(/\D/g, '');
    if (!name) { toast('Enter the account name', '#dc2626'); return; }
    if (num.length < 6) { toast('Enter a valid account number', '#dc2626'); return; }
    var s = state();
    var b = { id: 'b' + Date.now().toString(36), bank: bank, name: name.toUpperCase(), last4: num.slice(-4) };
    s.banks.push(b); if (!s.defaultKey) s.defaultKey = 'bank:' + b.id; save(s);
    api('POST', '/api/paypal/payout-account', { provider: 'bank', handle: num, label: bank, meta: { name: b.name, last4: b.last4 } }).then(function (r) {
      if (r && r.id) { var st = state(); var hit = st.banks.filter(function (x) { return x.id === b.id; })[0]; if (hit) { if (st.defaultKey === 'bank:' + b.id) st.defaultKey = 'bank:' + r.id; hit.id = String(r.id); save(st); _renderModal(); render(); } }
    });
    _addingBank = false; toast('✓ Bank linked'); _renderModal(); render();
  }
  function removeBank(id) {
    var s = state(); s.banks = s.banks.filter(function (b) { return b.id !== id; }); if (s.defaultKey === 'bank:' + id) s.defaultKey = null; save(s);
    api('DELETE', '/api/paypal/payout-account/' + encodeURIComponent(id));
    _renderModal(); render();
  }
  function setDefault(key) {
    var s = state(); s.defaultKey = key; save(s);
    var id = key.indexOf('bank:') === 0 ? key.slice(5) : 'paypal';
    api('POST', '/api/paypal/payout-account/default', { id: id, provider: key === 'paypal' ? 'paypal' : 'bank' });
    _renderModal(); render();
  }

  // ── public surface (used by inline onclick) ──────────────────────────────────
  window.EGPayout = {
    render: render, connect: connect, request: request, manage: manage, close: closeManage,
    _tab: selectTab, _connectPaypal: connectPaypal, _disconnect: disconnectPaypal,
    _addBank: addBankForm, _cancelBank: cancelBank, _saveBank: saveBank, _removeBank: removeBank, _default: setDefault
  };

  function boot() {
    if (!document.getElementById('dsn-payout-card')) return;
    render();                                  // paint immediately from localStorage
    hydrate().then(function () { render(); }).catch(function () {});   // then reconcile with server
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

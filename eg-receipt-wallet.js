/* eg-receipt-wallet.js — the wallet, drawn as one torn paper receipt.
   Shared by the seller wallet (wallet.html) + the staff boards (admin/warehouse balance section).
   Usage:
     <div id="my-mount"></div>
     EGReceiptWallet.render('my-mount', {
       mode:'seller'|'staff',
       onTopUp:  amt => openDepositModal(amt),     // seller only
       onWithdraw: amt => openWithdrawModal({amount:amt}),  // seller only
       label:'Available balance', empty:'No activity yet'
     });
     EGReceiptWallet.set('my-mount', { balance:1234.50, ledger:[ {cat,who,sub,amt,pending,rejected}, … ], deltaText:'+$250.00 today' });
   ledger row: cat=short chip label, who=name, sub=ref/date, amt=SIGNED number (+ in / − out).
   Presentation only — the page owns the data + the real top-up/withdraw flows. */
(function () {
  var EG_BUILD = '2026-07-10-receiptwallet-1';
  var CSS_ID = 'egrw-css';

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.egrw{--rw-paper:#fdfcf9;--rw-ink:#191918;--rw-ground:#f4f2ef;--rw-roll:#e7e2d7;--rw-cobalt:#2f4bf0;',
      '--rw-in:#15803d;--rw-out:#b23b3b;--rw-line:#e6e3db;--rw-grey:#6b7280;--rw-soft:#cfcbc1;',
      "--rw-mono:'DepartureMono',ui-monospace,'SF Mono',Menlo,monospace;",
      "--rw-sans:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;",
      'width:100%;max-width:430px;font-family:var(--rw-sans);color:var(--rw-ink)}',
      '.egrw *{box-sizing:border-box}',
      '.egrw-wallet{position:relative;background:var(--rw-paper);',
      'filter:drop-shadow(0 10px 16px rgba(25,25,24,.15)) drop-shadow(0 2px 3px rgba(25,25,24,.10))}',
      '.egrw-header{padding:24px 24px 18px}',
      '.egrw-lbl{font-family:var(--rw-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--rw-grey)}',
      '.egrw-num{font-family:var(--rw-sans);font-weight:700;letter-spacing:-.02em;line-height:1;margin:9px 0 4px;',
      'font-size:58px;display:flex;align-items:baseline;min-width:0;white-space:nowrap;overflow:hidden}',
      '.egrw-num .c{color:var(--rw-cobalt);font-size:.62em;margin-right:4px;font-weight:700}',
      '.egrw-num .d{font-size:.5em;color:var(--rw-grey);margin-left:2px}',
      '.egrw-delta{font-family:var(--rw-mono);font-size:12px;color:var(--rw-in);display:flex;align-items:center;gap:6px;min-height:15px}',
      '.egrw-delta .dot{font-size:9px}',
      '.egrw-acts{display:flex;align-items:center;gap:9px;margin-top:18px}',
      '.egrw-btn{width:50px;height:50px;flex:none;cursor:pointer;font-size:24px;line-height:1;display:flex;align-items:center;justify-content:center;',
      'transition:.12s;background:var(--rw-paper);border:1.5px solid var(--rw-soft);color:var(--rw-ink);font-family:var(--rw-sans)}',
      '.egrw-btn:active{transform:translateY(1px)}',
      '.egrw-btn.minus:hover{background:#f1ede5}',
      '.egrw-btn.plus{background:var(--rw-ink);color:var(--rw-paper);border-color:var(--rw-ink)}',
      '.egrw-btn.plus:hover{background:#000}',
      '.egrw-amtbox{flex:1;min-width:0;height:50px;border:1.5px solid var(--rw-soft);display:flex;align-items:center;padding:0 13px;gap:4px;background:var(--rw-paper)}',
      '.egrw-amtbox .cur{font-size:20px;color:var(--rw-grey)}',
      '.egrw-amtbox input{border:none;outline:none;background:none;width:100%;min-width:0;font-family:var(--rw-mono);font-size:20px;color:var(--rw-ink)}',
      '.egrw-lbls{display:flex;justify-content:space-between;margin-top:6px;padding:0 2px}',
      '.egrw-lbls span{font-family:var(--rw-mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--rw-grey)}',
      '.egrw-note{margin-top:14px;font-family:var(--rw-mono);font-size:10.5px;letter-spacing:.05em;color:#a49f93;text-transform:uppercase}',
      '.egrw-cols{display:flex;justify-content:space-between;padding:11px 24px 8px;border-top:1.5px dashed #cfcbc1;border-bottom:1.5px dashed #cfcbc1;',
      'font-family:var(--rw-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#a49f93}',
      '.egrw-roll{position:relative}',
      '.egrw-window{max-height:404px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:transparent transparent}',
      '.egrw-window.sc{scrollbar-color:var(--rw-ink) var(--rw-roll)}',
      '.egrw-window::-webkit-scrollbar{width:9px}',
      '.egrw-window::-webkit-scrollbar-track{background:transparent}',
      '.egrw-window::-webkit-scrollbar-thumb{background:transparent}',
      '.egrw-window.sc::-webkit-scrollbar-track{background:var(--rw-roll)}',
      '.egrw-window.sc::-webkit-scrollbar-thumb{background:var(--rw-ink);border:2px solid var(--rw-roll)}',
      '.egrw-fade{position:absolute;left:0;right:9px;height:16px;pointer-events:none;z-index:2}',
      '.egrw-fade.t{top:0;background:linear-gradient(var(--rw-paper),rgba(253,252,249,0))}',
      '.egrw-fade.b{bottom:0;background:linear-gradient(rgba(253,252,249,0),var(--rw-paper))}',
      '.egrw-r{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:12px 24px;border-top:1px solid var(--rw-line);align-items:center}',
      '.egrw-r:first-child{border-top:none}',
      '.egrw-r.neu{animation:egrwdrop .5s cubic-bezier(.2,.9,.3,1.2)}',
      '@keyframes egrwdrop{from{opacity:0;transform:translateY(-9px)}to{opacity:1;transform:none}}',
      '.egrw-lead{display:flex;align-items:center;gap:9px;min-width:0}',
      '.egrw-chip{font-family:var(--rw-mono);font-size:9.5px;letter-spacing:.04em;color:var(--rw-paper);background:var(--rw-ink);padding:3px 6px;flex:none;white-space:nowrap}',
      '.egrw-chip.in{background:var(--rw-in)}.egrw-chip.pend{background:#b45309}.egrw-chip.rej{background:#9ca3af}',
      '.egrw-who{min-width:0}',
      '.egrw-who b{font-weight:600;font-size:13.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.egrw-who small{font-family:var(--rw-mono);font-size:11px;color:var(--rw-grey);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.egrw-amt{font-family:var(--rw-mono);font-size:14px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}',
      '.egrw-amt.in{color:var(--rw-in)}.egrw-amt.out{color:var(--rw-ink)}.egrw-amt.mut{color:#9ca3af}',
      '.egrw-amt s{color:#9ca3af}',
      '.egrw-bal{font-family:var(--rw-mono);font-size:10px;color:#a49f93;text-align:right;margin-top:2px;font-variant-numeric:tabular-nums}',
      '.egrw-empty{padding:36px 24px;text-align:center;color:#a49f93;font-family:var(--rw-mono);font-size:12px}',
      '@media (prefers-reduced-motion:reduce){.egrw-r.neu{animation:none}}'
    ].join('');
    document.head.appendChild(s);
  }

  function money(n) {
    return Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var STORE = {}; // mountId -> {opts}

  function rowHTML(t, runbal, showBal) {
    var pos = (Number(t.amt) || 0) > 0, sign = pos ? '+' : '−';
    var soft = t.pending || t.rejected || t.muted;   // muted = informational (e.g. order payment in cash-on-hand model): no sign, no balance effect
    var chip = 'egrw-chip' + (t.pending ? ' pend' : t.rejected ? ' rej' : t.muted ? '' : pos ? ' in' : '');
    var amtCls = 'egrw-amt ' + (soft ? 'mut' : pos ? 'in' : 'out');
    var amtStr = t.muted ? ('$' + money(t.amt)) : (sign + '$' + money(t.amt));
    var amtInner = t.rejected ? ('<s>' + amtStr + '</s>') : amtStr;
    var balLine = (showBal && !soft) ? ('<div class="egrw-bal">bal $' + money(runbal) + '</div>') : '';
    return '<div class="egrw-lead"><span class="' + chip + '">' + esc(t.cat) + '</span>'
      + '<span class="egrw-who"><b>' + esc(t.who) + '</b>' + (t.sub ? '<small>' + esc(t.sub) + '</small>' : '') + '</span></div>'
      + '<div><div class="' + amtCls + '">' + amtInner + '</div>' + balLine + '</div>';
  }

  function paintNum(el, v) {
    var p = money(v).split('.');
    el.innerHTML = '<span class="c">$</span>' + p[0] + '<span class="d">.' + p[1] + '</span>';
  }

  function tornClip(wallet) {
    var TH = 9, teeth = 22, top = [], bot = [], i;
    for (i = 0; i <= teeth; i++) top.push((i / teeth * 100).toFixed(2) + '% ' + ((i % 2) ? TH : 0) + 'px');
    for (i = 0; i <= teeth; i++) bot.push(((teeth - i) / teeth * 100).toFixed(2) + '% ' + ((i % 2) ? '100%' : 'calc(100% - ' + TH + 'px)'));
    wallet.style.clipPath = 'polygon(' + top.concat(bot).join(',') + ')';
  }

  var EGReceiptWallet = {
    build: EG_BUILD,

    render: function (mountId, opts) {
      injectCSS();
      var mount = typeof mountId === 'string' ? document.getElementById(mountId) : mountId;
      if (!mount) return;
      opts = opts || {};
      var seller = opts.mode !== 'staff';
      mount.classList.add('egrw');
      mount.innerHTML =
        '<div class="egrw-wallet">' +
          '<div class="egrw-header">' +
            '<div class="egrw-lbl">' + esc(opts.label || (seller ? 'Available balance' : 'Platform balance')) + '</div>' +
            '<div class="egrw-num"></div>' +
            '<div class="egrw-delta"><span class="dot">▲</span> <span class="dtxt"></span></div>' +
            (seller
              ? ('<div class="egrw-acts">' +
                   '<button class="egrw-btn minus" title="Withdraw">−</button>' +
                   '<div class="egrw-amtbox"><span class="cur">$</span><input inputmode="decimal" placeholder="0.00"></div>' +
                   '<button class="egrw-btn plus" title="Top up">+</button>' +
                 '</div>' +
                 '<div class="egrw-lbls"><span>Withdraw</span><span>Amount</span><span>Top&nbsp;up</span></div>')
              : '<div class="egrw-note">' + esc(opts.note || 'Ledger only · records money in & out') + '</div>') +
          '</div>' +
          '<div class="egrw-cols"><span>' + esc(opts.col || (seller ? 'Activity' : 'Money in / out')) + '</span><span>Amount</span></div>' +
          '<div class="egrw-roll"><div class="egrw-fade t"></div><div class="egrw-window"><div class="egrw-rows"></div></div><div class="egrw-fade b"></div></div>' +
        '</div>';

      var wallet = mount.querySelector('.egrw-wallet');
      var win = mount.querySelector('.egrw-window');
      tornClip(wallet);

      // auto-hide scroller
      var hideT;
      win.addEventListener('scroll', function () {
        win.classList.add('sc'); clearTimeout(hideT);
        hideT = setTimeout(function () { win.classList.remove('sc'); }, 800);
      });

      if (seller) {
        var amtEl = mount.querySelector('.egrw-amtbox input');
        var amtVal = function () { var v = parseFloat(amtEl.value); return isFinite(v) && v > 0 ? v : null; };
        mount.querySelector('.egrw-btn.plus').onclick = function () {
          var v = amtVal();
          if (opts.onTopUp) opts.onTopUp(v); else if (window.openDepositModal) window.openDepositModal(v);
        };
        mount.querySelector('.egrw-btn.minus').onclick = function () {
          var v = amtVal();
          if (opts.onWithdraw) opts.onWithdraw(v); else if (window.openWithdrawModal) window.openWithdrawModal(v ? { amount: v } : undefined);
        };
        amtEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') mount.querySelector('.egrw-btn.plus').click(); });
      }

      STORE[mount.id || (mount.id = 'egrw-' + Math.round(performance.now()))] = { opts: opts, seller: seller };
      return mount;
    },

    set: function (mountId, data) {
      var mount = typeof mountId === 'string' ? document.getElementById(mountId) : mountId;
      if (!mount || !mount.querySelector('.egrw-num')) return;
      data = data || {};
      var st = STORE[mount.id] || { opts: {} };
      var numEl = mount.querySelector('.egrw-num');
      var rowsEl = mount.querySelector('.egrw-rows');
      var deltaEl = mount.querySelector('.egrw-delta');
      var balance = Number(data.balance) || 0;
      paintNum(numEl, balance);
      // shrink the hero to fit its container so a 7-figure balance never clips or scrolls the page
      numEl.style.fontSize = '58px';
      if (numEl.clientWidth > 0) {
        var fs = 58, guard = 0;
        while (numEl.scrollWidth > numEl.clientWidth && fs > 22 && guard++ < 30) { fs -= 2; numEl.style.fontSize = fs + 'px'; }
      }

      // delta line
      if (data.deltaText != null) {
        var up = !/^-|^−|▼/.test(String(data.deltaText));
        mount.querySelector('.egrw-delta .dtxt').textContent = String(data.deltaText).replace(/^▲\s*|^▼\s*/, '');
        deltaEl.style.color = up ? 'var(--rw-in)' : 'var(--rw-out)';
        deltaEl.querySelector('.dot').textContent = up ? '▲' : '▼';
        deltaEl.style.visibility = 'visible';
      } else { deltaEl.style.visibility = 'hidden'; }

      var led = data.ledger || [];
      if (!led.length) { rowsEl.innerHTML = '<div class="egrw-empty">' + esc(st.opts.empty || 'No activity yet') + '</div>'; return; }
      // running balance: rows come newest-first; walk balance back over confirmed rows
      var html = '', run = balance, i, t;
      for (i = 0; i < led.length; i++) {
        t = led[i];
        html += '<div class="egrw-r">' + rowHTML(t, run, true) + '</div>';
        if (!t.pending && !t.rejected && !t.muted) run -= (Number(t.amt) || 0);
      }
      rowsEl.innerHTML = html;
    },

    // Staff factory wallet: render read-only + keep in sync with EGStore's factory ledger.
    mountFactory: function (mountId) {
      var self = this;
      function sync() {
        if (typeof EGStore === 'undefined' || !EGStore.getFactoryLedger) return;
        var bal = EGStore.getFactoryBalance ? EGStore.getFactoryBalance() : 0;
        var CAT = { topup: 'DEPOSIT', charge: 'PAYMENT', refund: 'REFUND', cancellation: 'CANCEL', payout: 'PAYOUT', withdrawal: 'WITHDRAW', earning: 'EARNING' };
        var led = (EGStore.getFactoryLedger() || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).map(function (e) {
          var t = e.type, credit = (t === 'topup' || t === 'earning' || t === 'deposit'), charge = (t === 'charge');
          return {
            cat: CAT[t] || (t ? String(t).toUpperCase().slice(0, 9) : 'ADJUST'),
            who: e.label || CAT[t] || 'Adjustment',
            sub: e.orderId || '',
            amt: charge ? Number(e.amount || 0) : (credit ? Number(e.amount || 0) : -Number(e.amount || 0)),
            muted: charge
          };
        });
        self.set(mountId, { balance: bal, ledger: led });
      }
      function boot() {
        if (!document.getElementById(mountId)) return;
        self.render(mountId, { mode: 'staff', label: 'Factory balance', col: 'Money in / out' });
        sync();
      }
      if (document.readyState !== 'loading') boot(); else document.addEventListener('DOMContentLoaded', boot);
      window.addEventListener('eg-factory-balance-changed', sync);
      window.addEventListener('eg-balance-changed', sync);
      return { sync: sync };
    }
  };

  // Auto-mount any <div data-egrw-factory id="…"> as a staff factory receipt (zero per-page JS).
  function autoInit() {
    var nodes = document.querySelectorAll('[data-egrw-factory]');
    for (var i = 0; i < nodes.length; i++) { if (nodes[i].id) EGReceiptWallet.mountFactory(nodes[i].id); }
  }
  if (document.readyState !== 'loading') autoInit(); else document.addEventListener('DOMContentLoaded', autoInit);

  window.EGReceiptWallet = EGReceiptWallet;
  window.EG_RECEIPT_WALLET_BUILD = EG_BUILD;
})();

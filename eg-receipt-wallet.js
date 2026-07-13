/* eg-receipt-wallet.js — the wallet, drawn as ONE clean card (shadcn/ui zinc).
   (Was a torn-paper receipt; retired for the minimal board theme — single box, thin light
   lines across, sans type, cobalt top-up.) Shared by the seller wallet (wallet.html) + the
   staff boards (admin/warehouse balance section). API + data flow unchanged.
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
  var EG_BUILD = '2026-07-13-cleanwallet-1';
  var CSS_ID = 'egrw-css';

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.egrw{--rw-card:#fff;--rw-border:#e4e4e7;--rw-line:#f1f1f3;--rw-ink:#18181b;--rw-muted:#71717a;--rw-faint:#a1a1aa;',
      '--rw-cobalt:#2f4bf0;--rw-cobalt-dk:#2439c8;--rw-in:#12925a;--rw-in-soft:#e6f5ee;--rw-pend:#b0791c;--rw-pend-soft:#f8efda;',
      "--rw-sans:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;",
      'width:100%;max-width:430px;font-family:var(--rw-sans);color:var(--rw-ink);letter-spacing:-.006em}',
      '.egrw *{box-sizing:border-box}',
      '.egrw-wallet{position:relative;background:var(--rw-card);border:1px solid var(--rw-border);border-radius:14px;overflow:hidden;',
      'box-shadow:0 1px 3px rgba(0,0,0,.06),0 1px 2px -1px rgba(0,0,0,.05)}',
      '.egrw-header{padding:22px 22px 18px}',
      '.egrw-lbl{font-size:12.5px;font-weight:550;color:var(--rw-muted)}',
      '.egrw-num{font-weight:760;letter-spacing:-.03em;line-height:1;margin:9px 0 5px;font-size:44px;',
      'display:flex;align-items:baseline;min-width:0;white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums}',
      '.egrw-num .c{color:var(--rw-ink);font-size:.5em;margin-right:3px;font-weight:600}',
      '.egrw-num .d{font-size:.5em;color:var(--rw-faint);margin-left:1px}',
      '.egrw-delta{font-size:12px;font-weight:600;color:var(--rw-in);display:flex;align-items:center;gap:6px;min-height:15px}',
      '.egrw-delta .dot{font-size:9px}',
      '.egrw-acts{display:flex;align-items:center;gap:8px;margin-top:18px}',
      '.egrw-btn{width:44px;height:44px;flex:none;cursor:pointer;font-size:22px;line-height:1;display:flex;align-items:center;justify-content:center;',
      'transition:background .12s,transform .12s;background:var(--rw-card);border:1px solid var(--rw-border);border-radius:9px;color:var(--rw-ink);font-family:var(--rw-sans)}',
      '.egrw-btn:hover{background:#f4f4f5}',
      '.egrw-btn:active{transform:translateY(1px)}',
      '.egrw-btn.plus{background:var(--rw-cobalt);color:#fff;border-color:var(--rw-cobalt)}',
      '.egrw-btn.plus:hover{background:var(--rw-cobalt-dk)}',
      '.egrw-amtbox{flex:1;min-width:0;height:44px;border:1px solid var(--rw-border);border-radius:9px;display:flex;align-items:center;padding:0 13px;gap:4px;background:var(--rw-card)}',
      '.egrw-amtbox .cur{font-size:18px;color:var(--rw-faint)}',
      '.egrw-amtbox input{border:none;outline:none;background:none;width:100%;min-width:0;font-family:var(--rw-sans);font-size:18px;color:var(--rw-ink);font-variant-numeric:tabular-nums}',
      '.egrw-lbls{display:flex;justify-content:space-between;margin-top:7px;padding:0 2px}',
      '.egrw-lbls span{font-size:10.5px;color:var(--rw-faint)}',
      '.egrw-note{margin-top:14px;font-size:11.5px;color:var(--rw-faint)}',
      '.egrw-cols{display:flex;justify-content:space-between;padding:11px 22px 9px;border-top:1px solid var(--rw-border);border-bottom:1px solid var(--rw-border);',
      'font-size:11px;color:var(--rw-faint);font-weight:550}',
      '.egrw-roll{position:relative}',
      '.egrw-window{max-height:404px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:#d4d4d8 transparent}',
      '.egrw-window::-webkit-scrollbar{width:8px}',
      '.egrw-window::-webkit-scrollbar-thumb{background:#e4e4e7;border-radius:99px;border:2px solid #fff}',
      '.egrw-fade{display:none}',
      '.egrw-r{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:13px 22px;border-top:1px solid var(--rw-line);align-items:center}',
      '.egrw-r:first-child{border-top:none}',
      '.egrw-r:hover{background:#fafafa}',
      '.egrw-r.neu{animation:egrwdrop .4s cubic-bezier(.2,.9,.3,1.2)}',
      '@keyframes egrwdrop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}',
      '.egrw-lead{display:flex;align-items:center;gap:9px;min-width:0}',
      '.egrw-chip{font-size:10px;font-weight:600;color:var(--rw-muted);background:#f4f4f5;border-radius:999px;padding:3px 8px;flex:none;white-space:nowrap}',
      '.egrw-chip.in{background:var(--rw-in-soft);color:var(--rw-in)}.egrw-chip.pend{background:var(--rw-pend-soft);color:var(--rw-pend)}.egrw-chip.rej{background:#f4f4f5;color:var(--rw-faint)}',
      '.egrw-who{min-width:0}',
      '.egrw-who b{font-weight:600;font-size:13.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.egrw-who small{font-size:11.5px;color:var(--rw-muted);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.egrw-amt{font-family:var(--rw-sans);font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}',
      '.egrw-amt.in{color:var(--rw-in)}.egrw-amt.out{color:var(--rw-ink)}.egrw-amt.mut{color:var(--rw-faint)}',
      '.egrw-amt s{color:var(--rw-faint)}',
      '.egrw-bal{font-size:10.5px;color:var(--rw-faint);text-align:right;margin-top:2px;font-variant-numeric:tabular-nums}',
      '.egrw-empty{padding:36px 22px;text-align:center;color:var(--rw-faint);font-size:12.5px}',
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

      var win = mount.querySelector('.egrw-window');

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
      numEl.style.fontSize = '44px';
      if (numEl.clientWidth > 0) {
        var fs = 44, guard = 0;
        while (numEl.scrollWidth > numEl.clientWidth && fs > 22 && guard++ < 30) { fs -= 2; numEl.style.fontSize = fs + 'px'; }
      }

      // delta line
      if (data.deltaText != null) {
        var up = !/^-|^−|▼/.test(String(data.deltaText));
        mount.querySelector('.egrw-delta .dtxt').textContent = String(data.deltaText).replace(/^▲\s*|^▼\s*/, '');
        deltaEl.style.color = up ? 'var(--rw-in)' : 'var(--rw-ink)';
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

  // Auto-mount any <div data-egrw-factory id="…"> as a staff factory wallet card (zero per-page JS).
  function autoInit() {
    var nodes = document.querySelectorAll('[data-egrw-factory]');
    for (var i = 0; i < nodes.length; i++) { if (nodes[i].id) EGReceiptWallet.mountFactory(nodes[i].id); }
  }
  if (document.readyState !== 'loading') autoInit(); else document.addEventListener('DOMContentLoaded', autoInit);

  window.EGReceiptWallet = EGReceiptWallet;
  window.EG_RECEIPT_WALLET_BUILD = EG_BUILD;
})();

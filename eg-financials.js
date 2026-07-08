/* eg-financials.js — SHARED "Profit & Costs" (factory financials) panel. ONE
   implementation used by BOTH admin.html AND warehouse.html — the two factory
   boards sit on the SAME 'factory' wallet, so the owner insists they share one
   function. Mirrors eg-withdraw.js / eg-addfunds.js: self-contained, no page
   markup assumed beyond a mount div, exposes a single window global.

     window.EGFinancials.render(mountElId)   // paint the panel into #mountElId

   WHAT IT SHOWS (the owner's ask — "the profit after spending; list out all the
   costs of purchase orders / refunds / returns and how much we have on balance,
   in more detail"):
     • headline CURRENT BALANCE (big Fraunces number)
     • INCOME  — Seller payments (top-ups) + Earnings, totals + counts
     • COSTS   — itemized cards: Purchase Orders (open + received), Refunds,
                 Returns, Designer Payouts, Withdrawals (approved) — each a card
                 with its (negative) total + a count
     • NET / PROJECTED — current balance minus committed/pending spend
                 (open POs + pending withdrawals) = "projected after commitments"
     • an itemized RECENT ACTIVITY list (date · type · note · amount), newest first

   DATA SOURCES (aggregated ENTIRELY on the frontend — NO backend route changes):
     • GET /api/wallet?account=factory  → { balance, ledger:[{delta,type,note,ref,created_at}] }
         income  = topup + earning/charge  (positive delta into factory)
         costs   = refund(-out) + payout(-out) + withdrawal + manual-adjust(-out)
                   + any other negative-delta row
     • GET /api/wallet/withdrawals?status=pending&account=factory → pending payouts
     • EGStore.getPurchaseOrders()  → POs (piecePrice*qty per line); open vs received
     • EGStore.getFactoryBalance()  → offline fallback for the headline balance

   OFFLINE / GUARDED: every fetch is best-effort. If the server is unreachable it
   falls back to EGStore caches (getFactoryBalance / getFactoryLedger / POs) and
   renders graceful $0 / empty states — it NEVER throws. RETURNS: there is no
   separate returns data source in this codebase, so Returns is shown honestly as
   part of Refunds (a single "refunds & returns" bucket) and labelled as such —
   we do not invent a number. Light + dark via the board theme's [data-theme]. */
(function () {
  'use strict';

  var CSS_ID = 'eg-financials-css';
  var _mountId = null;         // remembered so background refreshes can re-paint
  var _busy = false;

  /* ── tiny helpers ── */
  function _tok() { try { return localStorage.getItem('eg_token') || ''; } catch (e) { return ''; } }
  function _base() { return (typeof window !== 'undefined' && window.EG_API_BASE) || ''; }
  function _num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;';
    });
  }
  function _money(n) {
    var v = _num(n);
    var neg = v < 0;
    var s = '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return neg ? '−' + s : s;
  }
  function _when(ts) {
    if (!ts) return '—';
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return String(ts);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
        ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return String(ts); }
  }

  /* ── PO aggregation from EGStore (POs are NOT in the wallet ledger) ── */
  function _poLineTotal(po) {
    if (!po) return 0;
    if (typeof po.total === 'number' && po.total > 0) return po.total;
    var items = Array.isArray(po.items) ? po.items : [];
    return items.reduce(function (s, it) {
      var price = _num(it && (it.piecePrice != null ? it.piecePrice : it.price));
      var qty = _num(it && it.qty) || 1;
      return s + price * qty;
    }, 0);
  }
  // A PO is "received" once it's shipped/delivered/received; anything earlier
  // (draft/confirmed/ordered/open) is money still COMMITTED but not yet spent.
  function _poReceived(po) {
    var st = String((po && po.status) || '').toLowerCase();
    return st === 'received' || st === 'delivered' || st === 'shipped' || st === 'complete' || st === 'completed';
  }
  function _readPOs() {
    try {
      if (window.EGStore && EGStore.getPurchaseOrders) return EGStore.getPurchaseOrders() || [];
    } catch (e) {}
    return [];
  }

  /* ── classify a ledger row into an income/cost bucket ── */
  // Factory-wallet ledger 'type' values in use (see server/src/routes/wallet.js):
  //   INCOME (delta > 0): topup (seller payments), earning / charge (order earnings)
  //   COSTS  (delta < 0): refund(-out), payout(-out), withdrawal (ref WD-*),
  //                        manual-adjust(-out), cancellation, + any other negative row
  function _bucket(row) {
    var t = String((row && row.type) || '').toLowerCase();
    var d = _num(row && row.delta);
    if (t.indexOf('topup') === 0) return 'topup';
    if (t.indexOf('earning') === 0 || t.indexOf('charge') === 0) return 'earning';
    if (t.indexOf('refund') === 0 || t.indexOf('cancellation') === 0 || t.indexOf('return') === 0) return 'refund';
    if (t.indexOf('payout') === 0) return 'payout';
    if (t.indexOf('withdraw') === 0) return 'withdrawal';
    if (t.indexOf('manual-adjust') === 0 || t.indexOf('adjust') === 0) return d >= 0 ? 'earning' : 'adjust';
    // Unknown type — fall back to the sign of the delta.
    return d >= 0 ? 'earning' : 'adjust';
  }
  function _isIncome(bucket) { return bucket === 'topup' || bucket === 'earning'; }

  /* ── fetch factory wallet (balance + ledger). Resolves to a normalised object,
        NEVER rejects — offline falls back to the EGStore cache. ── */
  function _loadWallet() {
    var tok = _tok();
    var fallback = function () {
      var bal = 0, led = [];
      try { if (window.EGStore && EGStore.getFactoryBalance) bal = EGStore.getFactoryBalance(); } catch (e) {}
      try {
        if (window.EGStore && EGStore.getFactoryLedger) {
          // Normalise the local ledger shape ({type,amount,ts,label}) to the
          // server shape ({type,delta,created_at,note}) so one renderer handles both.
          led = (EGStore.getFactoryLedger() || []).map(function (e) {
            var b = _bucket({ type: e.type, delta: e.amount });
            var signed = _isIncome(b) ? Math.abs(_num(e.amount)) : -Math.abs(_num(e.amount));
            return { type: e.type, delta: signed, note: e.label || '', ref: e.orderId || e.ref || '', created_at: e.ts };
          });
        }
      } catch (e) {}
      return { balance: bal, ledger: led, offline: true };
    };
    if (!tok) return Promise.resolve(fallback());
    return fetch(_base() + '/api/wallet?account=factory', { headers: { Authorization: 'Bearer ' + tok } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || typeof j.balance === 'undefined') return fallback();
        return { balance: _num(j.balance), ledger: Array.isArray(j.ledger) ? j.ledger : [], offline: false };
      })
      .catch(function () { return fallback(); });
  }

  /* ── fetch PENDING factory withdrawals (committed but not yet debited) ── */
  function _loadPendingWithdrawals() {
    var tok = _tok();
    if (!tok) return Promise.resolve([]);
    return fetch(_base() + '/api/wallet/withdrawals?status=pending&account=factory', { headers: { Authorization: 'Bearer ' + tok } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var arr = Array.isArray(j) ? j : (j && Array.isArray(j.rows) ? j.rows : []);
        return arr.filter(function (w) { return String(w.account || '') === 'factory'; });
      })
      .catch(function () { return []; });
  }

  /* ── inject the scoped stylesheet once ── */
  function _css() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.egfin{--fin-ink:#191918;--fin-line:#e5e4e0;--fin-paper:#fff;--fin-ground:#fafaf9;--fin-grey:#6b7280;--fin-grey2:#9ca3af;--fin-cobalt:#2f4bf0;--fin-neg:#b4453a;--fin-negbg:#fbf1ef;--fin-negline:#e7cdc8;font-family:inherit;margin-bottom:20px}',
      '.egfin *{box-sizing:border-box}',
      '.egfin-head{border:1px solid var(--fin-line);border-radius:10px;background:var(--fin-ground);padding:20px 24px;margin-bottom:16px}',
      '.egfin-eyebrow{font-size:10.5px;font-weight:700;color:var(--fin-grey2);text-transform:uppercase;letter-spacing:.08em}',
      '.egfin-bal{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:44px;line-height:1.02;letter-spacing:-.01em;color:var(--fin-ink);margin-top:6px;font-variant-numeric:tabular-nums}',
      '.egfin-sub{font-size:12.5px;color:var(--fin-grey);margin-top:6px;line-height:1.5}',
      '.egfin-off{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:5px;padding:2px 7px;margin-left:8px;vertical-align:middle}',
      '.egfin-secttl{font-size:11px;font-weight:700;color:var(--fin-grey2);text-transform:uppercase;letter-spacing:.08em;margin:20px 2px 10px}',
      '.egfin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}',
      '.egfin-card{border:1px solid var(--fin-line);border-radius:10px;background:var(--fin-paper);padding:15px 16px 14px;position:relative}',
      '.egfin-card.neg{background:var(--fin-negbg);border-color:var(--fin-negline)}',
      '.egfin-clabel{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;color:var(--fin-grey);text-transform:uppercase;letter-spacing:.05em}',
      '.egfin-clabel .dot{width:7px;height:7px;border-radius:2px;background:var(--fin-cobalt);flex:0 0 auto}',
      '.egfin-card.neg .egfin-clabel .dot{background:var(--fin-neg)}',
      '.egfin-cnum{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:25px;line-height:1.05;color:var(--fin-ink);margin-top:9px;font-variant-numeric:tabular-nums}',
      '.egfin-card.neg .egfin-cnum{color:var(--fin-neg)}',
      '.egfin-cmeta{font-size:11.5px;color:var(--fin-grey2);margin-top:5px;line-height:1.45}',
      '.egfin-net{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0;border:1px solid var(--fin-line);border-radius:10px;overflow:hidden;background:var(--fin-paper);margin-top:4px}',
      '.egfin-netcell{padding:15px 18px;border-right:1px solid var(--fin-line)}',
      '.egfin-netcell:last-child{border-right:none}',
      '.egfin-netcell.hi{background:var(--fin-ground)}',
      '.egfin-netlbl{font-size:10.5px;font-weight:700;color:var(--fin-grey2);text-transform:uppercase;letter-spacing:.06em}',
      '.egfin-netval{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:24px;line-height:1.05;color:var(--fin-ink);margin-top:7px;font-variant-numeric:tabular-nums}',
      '.egfin-netval.neg{color:var(--fin-neg)}',
      '.egfin-netmeta{font-size:11px;color:var(--fin-grey2);margin-top:4px}',
      '.egfin-act{border:1px solid var(--fin-line);border-radius:10px;overflow:hidden;background:var(--fin-paper);margin-top:4px}',
      '.egfin-row{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--fin-line)}',
      '.egfin-row:last-child{border-bottom:none}',
      '.egfin-tag{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:5px;border:1px solid var(--fin-line);color:var(--fin-grey);background:var(--fin-ground);flex:0 0 auto;min-width:74px;text-align:center}',
      '.egfin-tag.inc{color:#286038;background:#eaf6ee;border-color:#c7e6d0}',
      '.egfin-tag.cost{color:var(--fin-neg);background:var(--fin-negbg);border-color:var(--fin-negline)}',
      '.egfin-rwhen{font-size:11.5px;color:var(--fin-grey2);flex:0 0 auto;width:104px;font-variant-numeric:tabular-nums}',
      '.egfin-rnote{font-size:13px;color:var(--fin-ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.egfin-ramt{font-size:13px;font-weight:700;color:var(--fin-ink);flex:0 0 auto;font-variant-numeric:tabular-nums;text-align:right}',
      '.egfin-ramt.neg{color:var(--fin-neg)}',
      '.egfin-empty{padding:34px 20px;text-align:center;color:var(--fin-grey2);font-size:13px;line-height:1.6}',
      /* dark mode — respect the board theme */
      'html[data-theme=dark] .egfin{--fin-ink:#e8e4dd;--fin-line:#45424e;--fin-paper:#201e24;--fin-ground:#26242b;--fin-grey:#a8a39c;--fin-grey2:#8a8590;--fin-neg:#e08a80;--fin-negbg:#3a2622;--fin-negline:#5a3830}',
      'html[data-theme=dark] .egfin-off{color:#fde68a;background:#3a3214;border-color:#5a4a1a}',
      'html[data-theme=dark] .egfin-tag.inc{color:#8fd6a3;background:#123f33;border-color:#1f5a45}',
      'html[data-theme=dark] .egfin-tag.cost{color:#e08a80;background:#3a2622;border-color:#5a3830}',
      /* board-theme (Board OS) — sharp corners + ink frames + Departure Mono micro-labels */
      'html.eg-board-on .egfin-head,html.eg-board-on .egfin-card,html.eg-board-on .egfin-net,html.eg-board-on .egfin-act{border-radius:0!important;border:1.5px solid var(--fin-ink)!important;box-shadow:4px 4px 0 var(--fin-ink)}',
      'html.eg-board-on .egfin-card.neg{box-shadow:4px 4px 0 var(--fin-neg)}',
      'html.eg-board-on .egfin-eyebrow,html.eg-board-on .egfin-secttl,html.eg-board-on .egfin-clabel,html.eg-board-on .egfin-netlbl,html.eg-board-on .egfin-tag{font-family:var(--bos-mono,"DepartureMono",ui-monospace,monospace)!important;font-weight:400!important}',
      'html.eg-board-on .egfin-off{border-radius:0!important;font-family:var(--bos-mono,monospace)!important}',
      'html.eg-board-on .egfin-tag{border-radius:0!important}',
      'html.eg-board-on .egfin-clabel .dot{border-radius:0!important}',
      'html.eg-board-on[data-theme=dark] .egfin-head,html.eg-board-on[data-theme=dark] .egfin-card,html.eg-board-on[data-theme=dark] .egfin-net,html.eg-board-on[data-theme=dark] .egfin-act{box-shadow:4px 4px 0 #3a3631!important}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ── build one cost/income card ── */
  function _card(label, total, count, opts) {
    opts = opts || {};
    var cls = opts.neg ? 'egfin-card neg' : 'egfin-card';
    return '<div class="' + cls + '">' +
      '<div class="egfin-clabel"><span class="dot"></span>' + _esc(label) + '</div>' +
      '<div class="egfin-cnum">' + _money(total) + '</div>' +
      '<div class="egfin-cmeta">' + _esc(opts.meta || (count + ' item' + (count === 1 ? '' : 's'))) + '</div>' +
      '</div>';
  }

  /* ── the main render ── */
  function render(mountId) {
    _css();
    _mountId = mountId || _mountId;
    var el = document.getElementById(_mountId);
    if (!el) return;
    el.classList.add('egfin');
    if (!el.innerHTML.trim()) {
      el.innerHTML = '<div class="egfin-head"><div class="egfin-eyebrow">Profit &amp; Costs</div>' +
        '<div class="egfin-bal">$0.00</div><div class="egfin-sub">Loading factory financials…</div></div>';
    }
    if (_busy) return;
    _busy = true;

    Promise.all([_loadWallet(), _loadPendingWithdrawals()])
      .then(function (res) {
        var wallet = res[0], pending = res[1] || [];
        try { _paint(el, wallet, pending); }
        catch (e) { /* never crash the page */ try { console.warn('EGFinancials paint failed', e); } catch (_e) {} }
      })
      .catch(function () {})
      .then(function () { _busy = false; });
  }

  function _paint(el, wallet, pendingWithdrawals) {
    var ledger = Array.isArray(wallet.ledger) ? wallet.ledger : [];

    /* aggregate the ledger into income/cost buckets */
    var agg = {
      topup: { sum: 0, n: 0 }, earning: { sum: 0, n: 0 },
      refund: { sum: 0, n: 0 }, payout: { sum: 0, n: 0 },
      withdrawal: { sum: 0, n: 0 }, adjust: { sum: 0, n: 0 }
    };
    ledger.forEach(function (row) {
      var b = _bucket(row);
      if (!agg[b]) agg[b] = { sum: 0, n: 0 };
      agg[b].sum += Math.abs(_num(row.delta));
      agg[b].n += 1;
    });

    /* purchase orders (separate source) */
    var pos = _readPOs();
    var poOpen = { sum: 0, n: 0 }, poRecv = { sum: 0, n: 0 };
    pos.forEach(function (po) {
      var t = _poLineTotal(po);
      if (_poReceived(po)) { poRecv.sum += t; poRecv.n += 1; }
      else { poOpen.sum += t; poOpen.n += 1; }
    });
    var poTotalAll = poOpen.sum + poRecv.sum;

    /* pending withdrawals (committed, not yet debited) */
    var pendWd = { sum: 0, n: 0 };
    (pendingWithdrawals || []).forEach(function (w) { pendWd.sum += _num(w.amount); pendWd.n += 1; });

    var balance = _num(wallet.balance);
    var incomeTotal = agg.topup.sum + agg.earning.sum;
    // Wallet-recorded costs (already debited from the balance).
    var walletCosts = agg.refund.sum + agg.payout.sum + agg.withdrawal.sum + agg.adjust.sum;
    // Committed/pending spend that has NOT yet hit the balance.
    var committed = poOpen.sum + pendWd.sum;
    var projected = balance - committed;

    var off = wallet.offline ? '<span class="egfin-off">Offline · cached</span>' : '';

    /* ── headline ── */
    var html = '';
    html += '<div class="egfin-head">' +
      '<div class="egfin-eyebrow">Factory balance' + off + '</div>' +
      '<div class="egfin-bal">' + _money(balance) + '</div>' +
      '<div class="egfin-sub">Shared admin + warehouse wallet · ' +
      _money(incomeTotal) + ' earned in · ' + _money(-(walletCosts + poRecv.sum)) + ' spent out · ' +
      _money(-committed) + ' committed but unspent</div>' +
      '</div>';

    /* ── income ── */
    html += '<div class="egfin-secttl">Income</div><div class="egfin-grid">';
    html += _card('Seller payments', agg.topup.sum, agg.topup.n, { meta: agg.topup.n + ' top-up' + (agg.topup.n === 1 ? '' : 's') });
    html += _card('Earnings', agg.earning.sum, agg.earning.n, { meta: agg.earning.n + ' order' + (agg.earning.n === 1 ? '' : 's') });
    html += '</div>';

    /* ── costs ── */
    html += '<div class="egfin-secttl">Costs &amp; spending</div><div class="egfin-grid">';
    html += _card('Purchase orders', -poTotalAll, poOpen.n + poRecv.n, {
      neg: true,
      meta: (poOpen.n + poRecv.n) + ' PO' + ((poOpen.n + poRecv.n) === 1 ? '' : 's') +
        ' · ' + _money(-poOpen.sum) + ' open / ' + _money(-poRecv.sum) + ' received'
    });
    html += _card('Refunds & returns', -agg.refund.sum, agg.refund.n, {
      neg: true,
      meta: agg.refund.n + ' refund' + (agg.refund.n === 1 ? '' : 's') + ' · returns included'
    });
    html += _card('Designer payouts', -agg.payout.sum, agg.payout.n, {
      neg: true, meta: agg.payout.n + ' payout' + (agg.payout.n === 1 ? '' : 's')
    });
    html += _card('Withdrawals', -agg.withdrawal.sum, agg.withdrawal.n, {
      neg: true, meta: agg.withdrawal.n + ' approved'
    });
    if (agg.adjust.sum > 0) {
      html += _card('Adjustments', -agg.adjust.sum, agg.adjust.n, {
        neg: true, meta: agg.adjust.n + ' manual'
      });
    }
    html += '</div>';

    /* ── net / projected ── */
    html += '<div class="egfin-secttl">Net &amp; projected</div>';
    html += '<div class="egfin-net">' +
      '<div class="egfin-netcell"><div class="egfin-netlbl">Current balance</div>' +
      '<div class="egfin-netval">' + _money(balance) + '</div>' +
      '<div class="egfin-netmeta">on the factory wallet now</div></div>' +
      '<div class="egfin-netcell"><div class="egfin-netlbl">Committed spend</div>' +
      '<div class="egfin-netval neg">' + _money(-committed) + '</div>' +
      '<div class="egfin-netmeta">' + _money(-poOpen.sum) + ' open POs · ' + _money(-pendWd.sum) + ' pending payouts</div></div>' +
      '<div class="egfin-netcell hi"><div class="egfin-netlbl">Projected after commitments</div>' +
      '<div class="egfin-netval' + (projected < 0 ? ' neg' : '') + '">' + _money(projected) + '</div>' +
      '<div class="egfin-netmeta">what you keep once open POs &amp; payouts clear</div></div>' +
      '</div>';

    /* ── recent activity (ledger + PO commitments), newest first ── */
    var activity = [];
    ledger.forEach(function (row) {
      var b = _bucket(row);
      var income = _isIncome(b);
      activity.push({
        ts: row.created_at, income: income,
        tag: _tagLabel(b),
        note: row.note || _defaultNote(b, row.ref),
        amt: income ? Math.abs(_num(row.delta)) : -Math.abs(_num(row.delta)),
        sort: _sortTs(row.created_at)
      });
    });
    pos.forEach(function (po) {
      var t = _poLineTotal(po);
      activity.push({
        ts: po.created || po.date || po.ts, income: false,
        tag: 'PO',
        note: 'Purchase order ' + (po.num || po.id || '') + (po.supplier ? ' · ' + po.supplier : '') +
          ' (' + (_poReceived(po) ? 'received' : 'open') + ')',
        amt: -t,
        sort: _sortTs(po.ts || po.created || po.date)
      });
    });
    activity.sort(function (a, b) { return b.sort - a.sort; });
    activity = activity.slice(0, 40);

    html += '<div class="egfin-secttl">Recent activity</div><div class="egfin-act">';
    if (!activity.length) {
      html += '<div class="egfin-empty">No factory transactions yet.<br>' +
        'Income appears when sellers pay / push orders; costs appear on refunds, payouts, withdrawals &amp; purchase orders.</div>';
    } else {
      html += activity.map(function (a) {
        return '<div class="egfin-row">' +
          '<span class="egfin-tag ' + (a.income ? 'inc' : 'cost') + '">' + _esc(a.tag) + '</span>' +
          '<span class="egfin-rwhen">' + _esc(_when(a.ts)) + '</span>' +
          '<span class="egfin-rnote" title="' + _esc(a.note) + '">' + _esc(a.note) + '</span>' +
          '<span class="egfin-ramt' + (a.amt < 0 ? ' neg' : '') + '">' + (a.amt >= 0 ? '+' : '') + _money(a.amt) + '</span>' +
          '</div>';
      }).join('');
    }
    html += '</div>';

    el.innerHTML = html;
  }

  function _tagLabel(b) {
    return b === 'topup' ? 'Payment' : b === 'earning' ? 'Earning' :
      b === 'refund' ? 'Refund' : b === 'payout' ? 'Payout' :
        b === 'withdrawal' ? 'Withdraw' : 'Adjust';
  }
  function _defaultNote(b, ref) {
    var base = b === 'topup' ? 'Seller wallet top-up' : b === 'earning' ? 'Order earning' :
      b === 'refund' ? 'Refund to seller' : b === 'payout' ? 'Designer payout' :
        b === 'withdrawal' ? 'Factory withdrawal' : 'Manual adjustment';
    return ref ? base + ' · ' + ref : base;
  }
  function _sortTs(ts) {
    if (!ts) return 0;
    try { var n = new Date(ts).getTime(); return isNaN(n) ? 0 : n; } catch (e) { return 0; }
  }

  /* ── public API ── */
  window.EGFinancials = { render: render };

  /* auto-refresh when the shared factory data changes (best-effort, cheap) */
  try {
    window.addEventListener('eg-factory-balance-changed', function () { if (_mountId) render(_mountId); });
    window.addEventListener('eg-purchases-changed', function () { if (_mountId) render(_mountId); });
  } catch (e) {}
})();

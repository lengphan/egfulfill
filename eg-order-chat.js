// ── Order-bound chat module ──
// Drops into any dashboard. Each page must set `window.XOC_ROLE` before this loads:
//   • orders.html (seller)     → window.XOC_ROLE = 'seller'
//   • operator.html            → window.XOC_ROLE = 'operator'
//   • admin.html               → window.XOC_ROLE = 'admin'
//   • warehouse.html           → window.XOC_ROLE = 'warehouse'
//
// Public API:
//   xOrderChatOpen(orderId, opts) — opens the chat panel pinned to that order id
//   xOrderChatClose()             — hides it
//
// Storage lives in EGStore.getOrderChat / appendOrderChat. Cross-tab updates come
// through the `eg_order_chats` storage event.
(function(){
  if (typeof window === 'undefined') return;
  if (window.xOrderChatOpen) return; // already loaded

  // Factory roles can change order status from inside the chat; sellers and
  // designers can't. Designer is a read-only-status role — they see the
  // factory side of the conversation but their own messages are flagged
  // `internal:true` so sellers never see them (designer ↔ factory only).
  var FACTORY_ROLES = ['operator','admin','warehouse'];
  var INTERNAL_ROLES = ['designer'];   // can't message sellers
  function role() { return window.XOC_ROLE || 'seller'; }
  function isFactory() { return FACTORY_ROLES.indexOf(role()) !== -1; }
  function isInternalOnly() { return INTERNAL_ROLES.indexOf(role()) !== -1; }

  // Role badges — flat beige tags with dark text, matching the project's
  // card palette. Subtle tinting per role keeps scannability without
  // departing from the cream/charcoal scheme used elsewhere.
  var ROLE_STYLE = {
    seller:    { bg:'#f0ede9', fg:'#191918', label:'Seller'    },
    operator:  { bg:'#f0ede9', fg:'#374151', label:'Operator'  },
    admin:     { bg:'#fdfcfa', fg:'#a07410', label:'Admin'     },
    warehouse: { bg:'#f0ede9', fg:'#374151', label:'Warehouse' },
    designer:  { bg:'#f0ede9', fg:'#374151', label:'Designer'  },
    system:    { bg:'#f6f5f4', fg:'#9ca3af', label:'System'    }
  };

  // Status options factory roles can switch the order to from within the chat. Mirrors
  // the canonical factoryStatus values that EGStore.update accepts.
  var STATUS_OPTIONS = [
    { value:'new',           label:'New',           color:'#374151' },
    { value:'in_review',     label:'In Review',     color:'#7c3aed' },
    { value:'awaiting_scan', label:'Awaiting Scan', color:'#c2410c' },
    { value:'printing',      label:'Printing',      color:'#1d4ed8' },
    { value:'packing',       label:'Packing',       color:'#0e7490' },
    { value:'shipped',       label:'Shipped',       color:'#15803d' },
    { value:'flagged',       label:'Flagged',       color:'#dc2626' },
    { value:'cancelled',     label:'Cancelled',     color:'#9ca3af' },
    { value:'refunded',      label:'Refunded',      color:'#6b7280' }
  ];
  // Per-role allowed transitions. Operator's authority stops at sending an order
  // to the scan list (awaiting_scan) — they review designs and approve, but they
  // don't drive print/pack/ship. Warehouse keeps pipeline control through ship.
  // Cancelled + Refunded are admin-only (money/lifecycle decisions).
  var ROLE_STATUS_ALLOWED = {
    operator:  ['in_review','awaiting_scan','flagged'],
    admin:     ['new','in_review','awaiting_scan','printing','packing','shipped','flagged','cancelled','refunded'],
    warehouse: ['new','in_review','awaiting_scan','printing','packing','shipped','flagged']
  };
  function allowedStatusOptions() {
    var allowed = ROLE_STATUS_ALLOWED[role()] || [];
    return STATUS_OPTIONS.filter(function(s){ return allowed.indexOf(s.value) !== -1; });
  }

  var _orderId = null;
  function fmtTime(ts) {
    var d = new Date(ts); var now = new Date();
    var same = d.toDateString() === now.toDateString();
    var t = d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
    return same ? t : (d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) + ' ' + t);
  }

  function ensureModal() {
    if (document.getElementById('xoc-modal')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = '\
<div id="xoc-modal" style="position:fixed;right:20px;bottom:20px;width:380px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 40px);background:#fdfcfa;border:1px solid #40403d;border-radius:10px;box-shadow:3px 3px 0 #40403d, 0 18px 48px rgba(0,0,0,.18);display:none;flex-direction:column;z-index:9000;overflow:hidden;transform-origin:calc(100% - 28px) calc(100% - 28px);transform:translateY(20px) scale(.96);opacity:0;transition:transform .28s cubic-bezier(.4,.0,.2,1), opacity .22s ease, width .2s ease, height .2s ease, border-radius .28s ease">\
  <div id="xoc-head" style="padding:11px 14px;border-bottom:1px solid #e5e4e0;display:flex;align-items:center;gap:8px;flex-shrink:0;background:#fdfcfa;color:#191918">\
    <button id="xoc-btn-back" onclick="xOrderChatShowList()" title="All chats" style="background:none;border:none;color:#6b7280;cursor:pointer;padding:4px;display:none;align-items:center;transition:color .15s" aria-label="All chats" onmouseover="this.style.color=\'#191918\'" onmouseout="this.style.color=\'#6b7280\'">\
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>\
    </button>\
    <div style="flex:1;min-width:0">\
      <div id="xoc-title" style="font-size:13.5px;font-weight:700;color:#191918">Order Chat <span id="xoc-order" style="font-family:monospace;color:#191918;font-weight:600;font-size:11.5px;background:#f0ede9;border:1px solid #d8d4cd;padding:1px 7px;border-radius:5px;margin-left:5px;letter-spacing:.02em"></span></div>\
      <div id="xoc-sub" style="font-size:11px;color:#6b7280;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div>\
    </div>\
    <button id="xoc-btn-open" onclick="xOrderChatOpenFull()" title="Open in full chat" style="background:none;border:none;color:#6b7280;cursor:pointer;padding:4px;display:flex;align-items:center;transition:color .15s" aria-label="Open in full chat" onmouseover="this.style.color=\'#191918\'" onmouseout="this.style.color=\'#6b7280\'">\
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 3h7v7M13 3L6 10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>\
    </button>\
    <button onclick="xOrderChatMinimize()" title="Minimize" style="background:none;border:none;color:#6b7280;cursor:pointer;padding:4px;display:flex;align-items:center;transition:color .15s" aria-label="Minimize" onmouseover="this.style.color=\'#191918\'" onmouseout="this.style.color=\'#6b7280\'">\
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 11h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>\
    </button>\
    <button onclick="xOrderChatClose()" title="Close" style="background:none;border:none;color:#6b7280;cursor:pointer;padding:0 4px;font-size:20px;line-height:1;transition:color .15s" aria-label="Close" onmouseover="this.style.color=\'#191918\'" onmouseout="this.style.color=\'#6b7280\'">×</button>\
  </div>\
  <div id="xoc-body" style="flex:1;display:flex;flex-direction:column;min-height:0">\
    <div id="xoc-status-bar" style="display:none;padding:8px 14px;border-bottom:1px solid #e5e4e0;background:#f6f5f4;align-items:center;gap:6px;flex-wrap:wrap">\
      <span style="font-size:10.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Status:</span>\
      <div id="xoc-status-btns" style="display:flex;gap:4px;flex-wrap:wrap"></div>\
    </div>\
    <div id="xoc-messages" style="flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:9px;background:#f6f5f4;min-height:0"></div>\
    <div id="xoc-composer-marker" data-note="hidden-for-designer" style="display:none"></div>\
    <div id="xoc-composer" style="padding:9px 12px;border-top:1px solid #e5e4e0;display:flex;gap:6px;flex-shrink:0;background:#fdfcfa;align-items:center">\
      <input type="file" id="xoc-file" style="display:none" onchange="xOrderChatAttach(this)" accept="image/*,application/pdf,.psd,.ai,.svg,.zip"/>\
      <button id="xoc-btn-attach" onclick="document.getElementById(\'xoc-file\').click()" title="Attach file" aria-label="Attach file" style="width:32px;height:32px;border:1.5px solid #e5e4e0;background:#fff;color:#6b7280;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .15s,color .15s,background .15s" onmouseover="this.style.borderColor=\'#9ca3af\';this.style.color=\'#374151\';this.style.background=\'#fafaf9\'" onmouseout="this.style.borderColor=\'#e5e4e0\';this.style.color=\'#6b7280\';this.style.background=\'#fff\'">\
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11 4l-5 5a2 2 0 102.83 2.83l5-5a3.5 3.5 0 10-4.95-4.95L3.5 6.76A4.5 4.5 0 109.86 13.1L13 9.97" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>\
      </button>\
      <input id="xoc-input" class="input" placeholder="Type a message…" style="flex:1;font-size:13px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();xOrderChatSend()}"/>\
      <button class="btn btn-dk" style="font-size:12.5px;padding:6px 12px" onclick="xOrderChatSend()">Send</button>\
    </div>\
    <div id="xoc-readonly" style="display:none;padding:10px 14px;border-top:1px solid #e5e4e0;background:#fdfcfa;font-size:11.5px;color:#6b7280;text-align:center;line-height:1.4">\
      Read-only for designers. Chat about this design on the <strong style="color:#191918">design card</strong> instead.\
    </div>\
  </div>\
  <div id="xoc-list" style="flex:1;display:none;flex-direction:column;min-height:0;background:#fdfcfa">\
    <div style="padding:9px 12px;border-bottom:1px solid #e5e4e0;display:flex;gap:6px;align-items:center;background:#fdfcfa;flex-shrink:0">\
      <button onclick="xOrderChatNewPrompt()" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#191918;color:#fff;border:none;border-radius:7px;padding:7px 10px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .12s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">\
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v9M1.5 6h9" stroke="white" stroke-width="1.7" stroke-linecap="round"/></svg>\
        <span>New conversation</span>\
      </button>\
    </div>\
    <div id="xoc-list-items" style="flex:1;overflow-y:auto"></div>\
  </div>\
</div>\
<button id="xoc-fab" onclick="xOrderChatRestore()" title="Open chat" aria-label="Open chat" style="position:fixed;right:22px;bottom:22px;width:auto;height:auto;background:none;border:none;padding:0;cursor:pointer;opacity:0;transform:scale(.4);pointer-events:none;align-items:center;justify-content:center;display:flex;z-index:9001;color:#191918;transform-origin:center;transition:transform .16s cubic-bezier(.34,1.56,.64,1), opacity .2s ease" onmouseover="if(this.style.pointerEvents!==\'none\'){this.style.transform=\'translate(-1px,-1px) scale(1.06)\'}" onmouseout="if(this.style.pointerEvents!==\'none\'){this.style.transform=\'scale(1)\'}" onmousedown="this.style.transform=\'translate(2px,2px) scale(1)\'" onmouseup="this.style.transform=\'scale(1.06)\'">\
  <span style="position:relative;display:inline-flex">\
    <svg width="40" height="40" viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-7l-4.5 3.5A.75.75 0 016.25 20V17H5a2 2 0 01-2-2V5z" fill="#fdfcfa" stroke="#191918" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="10" r="1" fill="#191918"/><circle cx="12" cy="10" r="1" fill="#191918"/><circle cx="16" cy="10" r="1" fill="#191918"/></svg>\
    <span id="xoc-fab-badge" style="display:none;position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#191918;color:#fdfcfa;font-size:11px;font-weight:800;line-height:1;align-items:center;justify-content:center;box-shadow:0 0 0 2.5px #fdfcfa,2px 2px 0 #c9c3ba;box-sizing:border-box;font-family:Inter,sans-serif;letter-spacing:-.01em">0</span>\
  </span>\
</button>';
    // wrap.children contains both elements (modal + fab); append each.
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  function renderStatusBar() {
    var bar = document.getElementById('xoc-status-bar');
    var btns = document.getElementById('xoc-status-btns');
    if (!bar || !btns) return;
    if (!isFactory()) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    var current = null;
    if (typeof EGStore !== 'undefined' && EGStore.getOrders) {
      var o = EGStore.getOrders().find(function(x){ return x.id === _orderId; });
      if (o) current = o.factoryStatus;
    }
    var activeColor = '#374151';
    var opts = allowedStatusOptions().map(function(s){
      if (s.value === current) activeColor = s.color;
      // Gate: Refunded only selectable when the order is already Cancelled.
      var disabled = (s.value === 'refunded' && current !== 'cancelled' && current !== 'refunded');
      return '<option value="' + s.value + '"' + (s.value === current ? ' selected' : '') + (disabled ? ' disabled' : '') + '>' + s.label + (disabled ? ' (cancel first)' : '') + '</option>';
    }).join('');
    btns.innerHTML = '<select onchange="xOrderChatSetStatus(this.value)" style="font-size:12px;font-weight:600;padding:4px 26px 4px 10px;border-radius:7px;border:1.25px solid #e5e4e0;background:#fff;color:' + activeColor + ';cursor:pointer;font-family:inherit;-webkit-appearance:none;-moz-appearance:none;appearance:none;background-image:url(\'data:image/svg+xml;utf8,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 12 12&quot;><path d=&quot;M3 4.5l3 3 3-3&quot; stroke=&quot;%239ca3af&quot; stroke-width=&quot;1.4&quot; stroke-linecap=&quot;round&quot; fill=&quot;none&quot;/></svg>\');background-repeat:no-repeat;background-position:right 7px center;background-size:10px">' + (current ? '' : '<option value="" selected disabled>Set status…</option>') + opts + '</select>';
  }

  function renderAttachment(att, mine) {
    // After the bubble-color flip: mine = cream surface (light), other = dark.
    var border = mine ? '#e5e4e0' : 'rgba(232,228,221,.30)';
    var hint = mine ? '#6b7280' : 'rgba(232,228,221,.70)';
    if (att.kind === 'image' && att.dataUrl) {
      return '<div style="margin-top:' + (mine?'6px':'4px') + '"><img src="' + att.dataUrl + '" alt="' + (att.name||'attachment').replace(/"/g,'&quot;') + '" style="max-width:100%;max-height:160px;border-radius:8px;display:block;cursor:zoom-in" onclick="window.open(this.src,\'_blank\')"/></div>';
    }
    // Non-image: render a file chip with name + size.
    var sizeKB = att.size ? (att.size > 1024*1024 ? (att.size/1024/1024).toFixed(1) + ' MB' : Math.max(1, Math.round(att.size/1024)) + ' KB') : '';
    var href = att.dataUrl || '#';
    return '<a href="' + href + '"' + (att.dataUrl ? ' download="' + (att.name||'file').replace(/"/g,'&quot;') + '"' : '') + ' style="display:flex;align-items:center;gap:8px;margin-top:6px;padding:7px 10px;border:1px solid ' + border + ';border-radius:8px;text-decoration:none;color:inherit">'
      + '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0"><path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 1v4h4" stroke="currentColor" stroke-width="1.3"/></svg>'
      + '<div style="flex:1;min-width:0;overflow:hidden"><div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (att.name||'file').replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>'
      + (sizeKB ? '<div style="font-size:11px;color:' + hint + '">' + sizeKB + '</div>' : '')
      + '</div></a>';
  }

  function renderMessages() {
    var box = document.getElementById('xoc-messages');
    if (!box) return;
    var msgs = (typeof EGStore !== 'undefined' && EGStore.getOrderChat) ? EGStore.getOrderChat(_orderId) : [];
    // Sellers never see `internal` messages (designer ↔ factory side-channel).
    if (role() === 'seller') {
      msgs = msgs.filter(function(m){ return !m.internal; });
    }
    if (!msgs.length) {
      box.innerHTML = '<div style="color:#6b7280;font-size:13px;text-align:center;padding:24px 0;line-height:1.5">No messages yet.<br><span style="font-size:12px;color:#9ca3af">Be the first to say something about this order.</span></div>';
      return;
    }
    box.innerHTML = msgs.map(function(m){
      if (m.system) {
        return '<div style="text-align:center;font-size:11.5px;color:#6b7280;padding:4px 0">— ' + m.text + ' <span style="color:#9ca3af">·</span> ' + fmtTime(m.ts) + ' —</div>';
      }
      var st = ROLE_STYLE[m.role] || ROLE_STYLE.seller;
      var mine = m.role === role();
      var align = mine ? 'flex-end' : 'flex-start';
      // Bubble color reflects WHO the message is from (not "is it mine"):
      //   • own side  → cream card (.card style): #fdfcfa + #40403d outline
      //   • other side → dark charcoal: #191918 + #e8e4dd text
      // This way, the counterpart on the opposite side always reads as a
      // strong dark bubble — matches the "seller chat" reference — regardless
      // of whether the viewer is the seller, operator, admin, or warehouse.
      var bg = mine ? '#fdfcfa' : '#191918';
      var fg = mine ? '#191918' : '#e8e4dd';
      var borderColor = mine ? '#40403d' : '#191918';
      var bubbleShadow = '2px 2px 0 #40403d';
      var labelStyle = 'font-size:10.5px;font-weight:700;color:' + st.fg + ';background:' + st.bg + ';padding:1px 6px;border-radius:4px;letter-spacing:.04em;border:1px solid #e5e4e0';
      return '<div style="display:flex;flex-direction:column;align-items:' + align + ';gap:3px;max-width:80%;align-self:' + align + '">'
        + '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#6b7280">'
          + '<span style="' + labelStyle + '">' + (st.label || m.role).toUpperCase() + '</span>'
          + '<span>' + m.by + '</span>'
          + '<span>·</span>'
          + '<span>' + fmtTime(m.ts) + '</span>'
        + '</div>'
        + '<div style="background:' + bg + ';color:' + fg + ';padding:8px 12px;border-radius:10px;font-size:13.25px;line-height:1.45;border:1px solid ' + borderColor + ';box-shadow:' + bubbleShadow + ';word-wrap:break-word">'
          + (m.text ? m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;') : '')
          + (m.attachment ? renderAttachment(m.attachment, mine) : '')
        + '</div>'
      + '</div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function findOrderHeader() {
    if (typeof EGStore === 'undefined' || !EGStore.getOrders) return null;
    return EGStore.getOrders().find(function(x){ return x.id === _orderId; }) || null;
  }

  var _fullscreen = false;
  var _view = 'thread'; // 'thread' | 'list'

  // Show one of the two stacked panels (single-thread vs all-chats list) and
  // adjust the header so back/expand only appear when they make sense.
  function setView(v) {
    _view = v;
    var body = document.getElementById('xoc-body');
    var list = document.getElementById('xoc-list');
    var back = document.getElementById('xoc-btn-back');
    var openFull = document.getElementById('xoc-btn-open');
    var title = document.getElementById('xoc-title');
    var sub = document.getElementById('xoc-sub');
    if (!body || !list) return;
    if (v === 'list') {
      body.style.display = 'none';
      list.style.display = 'flex';
      if (back) back.style.display = 'none';
      if (openFull) openFull.style.display = 'none';
      if (title) title.textContent = 'All Chats';
      if (sub) sub.textContent = 'Pick a conversation';
      renderList();
      _hydrateSupportThreads(function(){ if (_view === 'list') renderList(); });   // staff: pull seller support threads
    } else {
      body.style.display = 'flex';
      list.style.display = 'none';
      if (back) back.style.display = 'flex';
      if (openFull) openFull.style.display = 'inline-flex';
    }
  }

  // ── Staff support inbox (ADDITIVE) ── Seller "EGFULFILL Support" chats ride on order_messages
  //    under `support-<sellerId>`. Staff pull them via /api/support/threads and hydrate into the
  //    SAME local cache, so they appear in this list and open/reply with the existing machinery.
  var _supportNames = {};
  function _hydrateSupportThreads(cb) {
    if (!isFactory()) { if (cb) cb(); return; }
    var tk = ''; try { tk = localStorage.getItem('eg_token') || ''; } catch (e) {}
    if (!tk) { if (cb) cb(); return; }
    fetch((window.EG_API_BASE || '') + '/api/support/threads', { headers: { Authorization: 'Bearer ' + tk } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) { if (cb) cb(); return; }
        var pending = rows.length;
        rows.forEach(function (t) {
          _supportNames[t.order_id] = t.seller_name || ('Seller ' + String(t.seller_id || '').slice(0, 6));
          if (typeof EGStore !== 'undefined' && EGStore.hydrateOrderChat) {
            EGStore.hydrateOrderChat(t.order_id, function () { if (--pending <= 0 && cb) cb(); });
          } else if (--pending <= 0 && cb) cb();
        });
      })
      .catch(function () { if (cb) cb(); });
  }

  function renderList() {
    var box = document.getElementById('xoc-list-items');
    if (!box) return;
    var threads = (typeof EGStore !== 'undefined' && EGStore.getAllOrderChatThreads)
      ? EGStore.getAllOrderChatThreads() : [];
    if (!threads.length) {
      box.innerHTML = '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:32px 16px;line-height:1.5">No order chats yet.<br><span style="font-size:12px">Open any order and send a message to start one.</span></div>';
      return;
    }
    box.innerHTML = threads.map(function(t){
      var st = ROLE_STYLE[t.lastRole] || ROLE_STYLE.seller;
      var isSup = String(t.orderId).indexOf('support-') === 0;
      var initials = isSup ? 'SP' : (String(t.orderId).replace(/[^A-Z0-9]/gi,'').slice(-2).toUpperCase() || '##');
      var nameHtml = isSup
        ? '<span>Support</span><span style="color:#9ca3af;font-weight:500;margin-left:5px">' + String(_supportNames[t.orderId] || 'Seller').replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>'
        : '<span style="font-family:monospace">#' + t.orderId + '</span>';
      var preview = (t.lastText || '').slice(0, 60);
      var unread = t.count;
      return '<div onclick="xOrderChatOpenFromList(\'' + String(t.orderId).replace(/\\/g,'\\\\').replace(/\'/g,"\\'") + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #f3f3f1;cursor:pointer;transition:background .12s" onmouseover="this.style.background=\'#fafaf9\'" onmouseout="this.style.background=\'#fff\'">'
        + '<div style="width:34px;height:34px;border-radius:50%;background:' + st.bg + ';color:' + st.fg + ';display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;flex-shrink:0">' + initials + '</div>'
        + '<div style="flex:1;min-width:0">'
          + '<div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#191918">' + nameHtml + '<span style="margin-left:auto;font-size:11px;color:#9ca3af;font-weight:500">' + fmtTime(t.lastTs) + '</span></div>'
          + '<div style="font-size:12px;color:#6b7280;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + preview.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>'
        + '</div>'
        + '<div style="width:20px;height:20px;border-radius:50%;background:#111827;color:#fff;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + (unread > 99 ? '99+' : unread) + '</div>'
      + '</div>';
    }).join('');
  }

  function applyDockSize() {
    var m = document.getElementById('xoc-modal');
    if (!m) return;
    if (_fullscreen) {
      m.style.width = 'min(960px, calc(100vw - 40px))';
      m.style.height = 'calc(100vh - 40px)';
    } else {
      m.style.width = '380px';
      m.style.height = '540px';
    }
  }

  function showFab(show) {
    var fab = document.getElementById('xoc-fab');
    if (!fab) return;
    if (show) {
      fab.style.pointerEvents = 'auto';
      fab.style.opacity = '1';
      fab.style.transform = 'scale(1)';
    } else {
      fab.style.pointerEvents = 'none';
      fab.style.opacity = '0';
      fab.style.transform = 'scale(.4)';
    }
  }

  // Counts conversations with at least one unread message for the current
  // role (not total messages). Hidden when the dock is open — once you're
  // looking at chats, the badge would be redundant noise.
  function refreshFabBadge() {
    var badge = document.getElementById('xoc-fab-badge');
    if (!badge) return;
    var dock = document.getElementById('xoc-modal');
    var dockOpen = dock && dock.style.display !== 'none';
    var n = 0;
    try {
      if (typeof EGStore !== 'undefined' && EGStore.getUnreadConversationCount) {
        n = EGStore.getUnreadConversationCount() || 0;
      }
    } catch(e) {}
    if (!n || dockOpen) {
      badge.style.display = 'none';
      return;
    }
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.style.display = 'flex';
  }
  window.__xocRefreshFabBadge = refreshFabBadge;

  window.xOrderChatOpen = function(orderId, opts) {
    if (!orderId) return;
    var oid = String(orderId);
    var isTeam = oid.indexOf('TEAM:') === 0;
    // Designer can ONLY open team threads. Block per-order chats outright —
    // they discuss designs on the design card, not the order.
    if (role() === 'designer' && !isTeam) {
      console.warn('[xOrderChat] designer role cannot open per-order chats');
      return;
    }
    ensureModal();
    _orderId = oid;
    // Opening a thread = the user has now seen its messages. Mark it read so
    // the FAB badge drops it from the unread-conversations count immediately.
    try { if (typeof EGStore !== 'undefined' && EGStore.markChatThreadRead) EGStore.markChatThreadRead(oid); } catch(e) {}
    if (typeof refreshFabBadge === 'function') refreshFabBadge();
    var o = isTeam ? null : findOrderHeader();
    var title = document.getElementById('xoc-title');
    if (title) {
      if (isTeam) {
        // Shared rooms (seller-factory / designer-factory) read as the
        // counterpart-team label so factory members understand it's a shared
        // inbox, not a 1:1 chat. Per-pair factory threads keep the original
        // "Team Chat · {OtherRole}" treatment.
        var parts = oid.slice(5).split('-');
        var me = role();
        var titleLabel, pillLabel;
        if (oid === 'TEAM:seller-factory') {
          titleLabel = 'Team Chat';
          pillLabel = (me === 'seller') ? 'Factory Team' : 'Seller';
        } else if (oid === 'TEAM:designer-factory') {
          titleLabel = 'Team Chat';
          pillLabel = (me === 'designer') ? 'Factory Team' : 'Designer';
        } else {
          var other = parts.find(function(r){ return r !== me; }) || parts[1] || parts[0];
          var otherMeta = (typeof ROLE_META !== 'undefined' && ROLE_META[other]) || { label: other };
          titleLabel = 'Team Chat';
          pillLabel = otherMeta.label;
        }
        title.innerHTML = titleLabel + ' <span id="xoc-order" style="color:#191918;font-weight:600;font-size:11.5px;background:#f0ede9;border:1px solid #d8d4cd;padding:1px 8px;border-radius:5px;margin-left:5px">' + pillLabel + '</span>';
      } else if (oid.indexOf('support-') === 0) {
        title.innerHTML = 'Support <span id="xoc-order" style="color:#191918;font-weight:600;font-size:11.5px;background:#f0ede9;border:1px solid #d8d4cd;padding:1px 8px;border-radius:5px;margin-left:5px">' + String(_supportNames[oid] || 'Seller').replace(/</g,'&lt;') + '</span>';
      } else {
        title.innerHTML = 'Order Chat <span id="xoc-order" style="font-family:monospace;color:#191918;font-weight:600;font-size:11.5px;background:#f0ede9;border:1px solid #d8d4cd;padding:1px 7px;border-radius:5px;margin-left:5px;letter-spacing:.02em">#' + _orderId + '</span>';
      }
    }
    var sub = (opts && opts.subtitle) || (o ? [o.customer && o.customer.name, o.seller].filter(Boolean).join(' · ') : (oid.indexOf('support-') === 0 ? 'Seller support request' : '—'));
    document.getElementById('xoc-sub').textContent = sub;
    setView('thread');
    renderStatusBar();
    renderMessages();
    // Pull any messages this device hasn't seen from the server (per-order only;
    // TEAM:* rooms aren't backed by an order row), then re-render with the merge.
    if (!isTeam && typeof EGStore !== 'undefined' && EGStore.hydrateOrderChat) {
      EGStore.hydrateOrderChat(oid, function(){ if (_orderId === oid) renderMessages(); });
    }
    // Designer is READ-ONLY on order chat (per-order). On TEAM threads they
    // CAN post (it's the factory side-channel they're meant to use). Other
    // roles always see the normal composer.
    var composer = document.getElementById('xoc-composer');
    var ro = document.getElementById('xoc-readonly');
    if (composer && ro) {
      var blockComposer = isInternalOnly() && !isTeam;
      if (blockComposer) { composer.style.display = 'none'; ro.style.display = ''; }
      else                { composer.style.display = 'flex'; ro.style.display = 'none'; }
    }
    var m = document.getElementById('xoc-modal');
    showFab(false);
    m.style.display = 'flex';
    applyDockSize();
    requestAnimationFrame(function(){
      m.style.transform = 'translateY(0) scale(1)';
      m.style.opacity = '1';
    });
    setTimeout(function(){ var inp = document.getElementById('xoc-input'); if (inp) inp.focus(); }, 260);
  };
  // Click handler inside the list view — switch the same dock to that thread.
  window.xOrderChatOpenFromList = function(orderId) {
    window.xOrderChatOpen(orderId);
  };
  // "+ New conversation" from the FAB list view — opens a styled picker
  // (search + scrollable order list) so the user clicks the order they want
  // to chat about instead of typing an ID into a native prompt. Source list
  // is EGStore.getOrders() with the seller's ORDERS global as a fallback.
  function _xocAllOrders(){
    var out = [];
    try {
      if (typeof EGStore !== 'undefined' && EGStore.getOrders) {
        out = (EGStore.getOrders() || []).map(function(o){
          var name = (o.customer && (o.customer.name || o.customer)) || '';
          return { id: o.id || o.num || '', name: typeof name === 'string' ? name : '', store: o.seller || (o.customer && o.customer.store) || '' };
        });
      }
    } catch(e){}
    // Fallback: page-level ORDERS array (seller's orders.html) — uses .no + .cust + .store
    try {
      if (typeof window.ORDERS !== 'undefined' && Array.isArray(window.ORDERS)) {
        window.ORDERS.forEach(function(o){
          if (!o.no) return;
          var oid = String(o.no);
          if (out.some(function(x){ return x.id === oid; })) return;
          out.push({ id: oid, name: o.cust || '', store: o.store || '' });
        });
      }
    } catch(e){}
    return out.filter(function(o){ return o.id; });
  }
  // Team-chat allow-list per role.
  // - Seller: factory roles only (operator/admin/warehouse). NO designer —
  //   sellers can't open conversations with designers.
  // - Designer: factory roles only (operator/admin/warehouse). NO seller, no
  //   order chats — designers chat ABOUT designs on the design cards, not
  //   per-order.
  // - Operator/Admin/Warehouse: seller + designer + the other two factory roles.
  // Picker contacts. Seller + designer have a single virtual "factory" target
  // that opens the shared cross-role inbox — everyone in factory sees their
  // message and any factory member can reply. Factory roles pick a specific
  // counterpart; seller/designer picks land in the shared rooms below.
  var TEAM_CONTACTS = {
    seller:    ['factory'],
    designer:  ['factory'],
    operator:  ['seller','designer','admin','warehouse'],
    admin:     ['seller','designer','operator','warehouse'],
    warehouse: ['seller','designer','operator','admin']
  };
  var FACTORY_ROLES = ['operator','admin','warehouse'];
  function _isFactoryRole(r) { return FACTORY_ROLES.indexOf(String(r||'')) >= 0; }
  var ROLE_META = {
    seller:    { label:'Seller',        avatar:'SE', bg:'#f0ede9' },
    designer:  { label:'Designer',      avatar:'DE', bg:'#f0ede9' },
    operator:  { label:'Operator',      avatar:'OP', bg:'#f0ede9' },
    admin:     { label:'Admin',         avatar:'AD', bg:'#fdfcfa' },
    warehouse: { label:'Warehouse',     avatar:'WH', bg:'#f0ede9' },
    factory:   { label:'Factory Team',  avatar:'FT', bg:'#f3eee2' }
  };
  // Build a stable team-thread id. Two shared rooms collapse the cross-role
  // chats so seller/designer don't have to pick a specific factory member —
  // and a message from operator to seller lands in the same room admin and
  // warehouse can read.
  //   • seller   ↔ any factory  → TEAM:seller-factory     (shared)
  //   • designer ↔ any factory  → TEAM:designer-factory   (shared)
  //   • factory  ↔ factory pair → TEAM:roleA-roleB sorted (1:1)
  function _teamThreadId(roleA, roleB) {
    var a = String(roleA||''), b = String(roleB||'');
    var hasSeller   = a === 'seller'   || b === 'seller';
    var hasDesigner = a === 'designer' || b === 'designer';
    var hasFactory  = _isFactoryRole(a) || _isFactoryRole(b) || a === 'factory' || b === 'factory';
    if (hasSeller   && hasFactory) return 'TEAM:seller-factory';
    if (hasDesigner && hasFactory) return 'TEAM:designer-factory';
    var pair = [a, b].sort();
    return 'TEAM:' + pair[0] + '-' + pair[1];
  }
  window._teamThreadId = _teamThreadId;
  function _xocBuildPicker(){
    var prev = document.getElementById('xoc-picker'); if (prev) prev.remove();
    var me = role();
    var contacts = TEAM_CONTACTS[me] || [];
    // Designer: order-chat hidden entirely.
    var showOrders = me !== 'designer';
    var overlay = document.createElement('div');
    overlay.id = 'xoc-picker';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(25,25,24,.42);z-index:10001;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif';
    overlay.innerHTML =
      '<div style="background:#fdfcfa;border:1px solid #40403d;border-radius:10px;box-shadow:3px 3px 0 #40403d,0 14px 40px rgba(0,0,0,.2);width:440px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">'
        + '<div style="padding:14px 16px;border-bottom:1px solid #e5e4e0;display:flex;align-items:center;justify-content:space-between">'
          + '<div style="font-size:14.5px;font-weight:700;color:#191918">New conversation</div>'
          + '<button id="xoc-picker-x" type="button" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:18px;line-height:1;padding:2px 4px">×</button>'
        + '</div>'
        + '<div style="padding:10px 14px;border-bottom:1px solid #e5e4e0">'
          + '<input id="xoc-picker-q" placeholder="' + (showOrders ? 'Search order, customer, or team…' : 'Search team…') + '" style="width:100%;box-sizing:border-box;padding:8px 11px;border:1px solid #e5e4e0;border-radius:7px;font-size:13.5px;font-family:inherit;color:#191918;background:#fff;outline:none"/>'
        + '</div>'
        + '<div id="xoc-picker-list" style="flex:1;overflow-y:auto;padding:6px 0"></div>'
        + (showOrders ?
            '<div style="padding:9px 14px;border-top:1px solid #e5e4e0;background:#f6f5f4;display:flex;align-items:center;justify-content:space-between;gap:8px">'
              + '<span style="font-size:11.5px;color:#9ca3af">Or start a thread for a future order:</span>'
              + '<div style="display:flex;gap:6px;align-items:center">'
                + '<input id="xoc-picker-new" placeholder="FF-XXXX" style="width:120px;padding:5px 9px;border:1px solid #e5e4e0;border-radius:6px;font-size:12.5px;font-family:monospace;color:#191918;background:#fff;outline:none"/>'
                + '<button id="xoc-picker-newgo" type="button" style="background:#191918;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit">Open</button>'
              + '</div>'
            + '</div>'
            : '')
      + '</div>';
    document.body.appendChild(overlay);
    var qInput = overlay.querySelector('#xoc-picker-q');
    var list = overlay.querySelector('#xoc-picker-list');
    var newInput = overlay.querySelector('#xoc-picker-new');
    var allOrders = showOrders ? _xocAllOrders() : [];
    function sectionHeader(label){
      return '<div style="padding:8px 14px 5px;font-size:10.5px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em">'+label+'</div>';
    }
    function renderList(filter){
      var q = (filter || '').trim().toLowerCase();
      var html = '';
      // ── TEAM section ──
      var teamRows = contacts.filter(function(r){
        if (!q) return true;
        var meta = ROLE_META[r] || { label:r };
        return r.toLowerCase().indexOf(q) > -1 || (meta.label||'').toLowerCase().indexOf(q) > -1;
      });
      if (teamRows.length) {
        html += sectionHeader('Team');
        html += teamRows.map(function(r){
          var meta = ROLE_META[r] || { label:r, avatar:r.slice(0,2).toUpperCase(), bg:'#f0ede9' };
          var tid = _teamThreadId(me, r);
          // Subtitle hints whether this picks a shared room or a 1:1 chat.
          var sub;
          if (tid === 'TEAM:seller-factory')        sub = 'Shared room — every factory member sees it';
          else if (tid === 'TEAM:designer-factory') sub = 'Shared room — every factory member sees it';
          else if (r === 'seller')                  sub = 'Shared seller room — all factory roles read & reply';
          else if (r === 'designer')                sub = 'Shared designer room — all factory roles read & reply';
          else                                      sub = 'Direct chat — team channel';
          return '<div data-oid="'+tid+'" data-team="1" data-with="'+r+'" class="xoc-prow" style="display:flex;align-items:center;gap:11px;padding:9px 14px;cursor:pointer;transition:background .12s" onmouseover="this.style.background=\'#f6f5f4\'" onmouseout="this.style.background=\'\'">'
            + '<div style="width:32px;height:32px;border-radius:50%;background:'+meta.bg+';border:1px solid #e5e4e0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#191918;flex-shrink:0">'+meta.avatar+'</div>'
            + '<div style="flex:1;min-width:0">'
              + '<div style="font-size:13px;font-weight:600;color:#191918">'+meta.label+'</div>'
              + '<div style="font-size:11.5px;color:#6b7280">'+sub+'</div>'
            + '</div>'
          + '</div>';
        }).join('');
      }
      // ── ORDERS section ──
      if (showOrders) {
        var orderRows = q
          ? allOrders.filter(function(o){ return o.id.toLowerCase().indexOf(q)>-1 || (o.name||'').toLowerCase().indexOf(q)>-1; })
          : allOrders;
        if (orderRows.length) {
          html += sectionHeader('Orders');
          html += orderRows.slice(0, 60).map(function(o){
            var initials = String(o.id).replace(/[^A-Z0-9]/gi,'').slice(-2).toUpperCase() || '##';
            var sub = [o.name, o.store].filter(Boolean).join(' · ') || '—';
            return '<div data-oid="'+o.id.replace(/"/g,'&quot;')+'" class="xoc-prow" style="display:flex;align-items:center;gap:11px;padding:9px 14px;cursor:pointer;transition:background .12s" onmouseover="this.style.background=\'#f6f5f4\'" onmouseout="this.style.background=\'\'">'
              + '<div style="width:32px;height:32px;border-radius:50%;background:#f0ede9;border:1px solid #e5e4e0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#191918;flex-shrink:0">'+initials+'</div>'
              + '<div style="flex:1;min-width:0">'
                + '<div style="font-size:13px;font-weight:600;color:#191918;font-family:monospace">#'+o.id+'</div>'
                + '<div style="font-size:11.5px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+sub+'</div>'
              + '</div>'
            + '</div>';
          }).join('');
        }
      }
      if (!html) {
        list.innerHTML = '<div style="padding:24px 16px;text-align:center;color:#9ca3af;font-size:13px;line-height:1.5">No matches.</div>';
        return;
      }
      list.innerHTML = html;
      list.querySelectorAll('.xoc-prow').forEach(function(row){
        row.addEventListener('click', function(){
          var oid = row.getAttribute('data-oid');
          var isTeam = row.getAttribute('data-team') === '1';
          var withRole = row.getAttribute('data-with');
          overlay.remove();
          var sub = isTeam
            ? ('Direct chat with ' + ((ROLE_META[withRole]||{label:withRole}).label))
            : 'Started from picker';
          window.xOrderChatOpen(oid, { subtitle: sub });
        });
      });
    }
    renderList('');
    qInput.addEventListener('input', function(){ renderList(qInput.value); });
    overlay.querySelector('#xoc-picker-x').addEventListener('click', function(){ overlay.remove(); });
    overlay.addEventListener('click', function(e){ if (e.target === overlay) overlay.remove(); });
    if (newInput) {
      overlay.querySelector('#xoc-picker-newgo').addEventListener('click', function(){
        var v = (newInput.value || '').trim();
        if (!v) return;
        if (/^[0-9]+$/.test(v)) v = 'FF-' + v;
        overlay.remove();
        window.xOrderChatOpen(v, { subtitle: 'New conversation' });
      });
    }
    setTimeout(function(){ qInput.focus(); }, 30);
  }
  window.xOrderChatNewPrompt = _xocBuildPicker;
  window.xOrderChatClose = function() {
    var m = document.getElementById('xoc-modal');
    if (!m) return;
    m.style.transform = 'translateY(20px) scale(.96)';
    m.style.opacity = '0';
    setTimeout(function(){ m.style.display = 'none'; _fullscreen = false; }, 240);
    showFab(false);
  };
  // Collapse the open dock toward the bubble: scale-down + fade out,
  // FAB scales/fades in slightly delayed so they appear to morph at the corner.
  window.xOrderChatMinimize = function() {
    var m = document.getElementById('xoc-modal');
    if (!m) return;
    m.style.transform = 'translateY(0) scale(.12)';
    m.style.opacity = '0';
    // FAB shows after the modal starts shrinking; the spring easing makes it bounce in.
    setTimeout(function(){ showFab(true); }, 120);
    setTimeout(function(){ m.style.display = 'none'; }, 280);
  };
  // Reverse: hide the bubble and grow the dock back from the same corner.
  // If no order context exists yet (user landed on a non-order page), open
  // the "all chats" list view instead so the FAB is meaningful everywhere.
  window.xOrderChatRestore = function() {
    var m = document.getElementById('xoc-modal');
    if (!m) ensureModal(), (m = document.getElementById('xoc-modal'));
    if (!_orderId) {
      // No specific order — show the cross-order list view.
      var title = document.getElementById('xoc-title');
      if (title) title.innerHTML = 'Order Chat';
      setView('list');
      showFab(false);
      m.style.display = 'flex';
      applyDockSize();
      m.style.transform = 'translateY(0) scale(.12)';
      m.style.opacity = '0';
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          m.style.transform = 'translateY(0) scale(1)';
          m.style.opacity = '1';
        });
      });
      return;
    }
    showFab(false);
    m.style.display = 'flex';
    applyDockSize();
    // Start small, then grow on next frame.
    m.style.transform = 'translateY(0) scale(.12)';
    m.style.opacity = '0';
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        m.style.transform = 'translateY(0) scale(1)';
        m.style.opacity = '1';
      });
    });
  };
  window.xOrderChatFull = function() {
    _fullscreen = !_fullscreen;
    applyDockSize();
  };
  // Jump from the small dock into the full chat surface, scoped to the active
  // order. Seller pages have a dedicated chat.html page; factory dashboards
  // expose an in-app `chat` section via showSection().
  window.xOrderChatOpenFull = function() {
    var orderId = _orderId;
    if (role() === 'seller') {
      window.location.href = 'chat.html' + (orderId ? ('?order=' + encodeURIComponent(orderId)) : '');
      return;
    }
    if (typeof window.showSection === 'function') {
      window.xOrderChatClose();
      window.showSection('chat');
      // The factory chat section is just a #chat-messages container — render
      // the order thread into it so the user lands on the matching conversation.
      setTimeout(function(){
        if (orderId) window.xocLoadOrderInChatSection(orderId);
      }, 50);
    }
  };
  // Render the order-bound chat thread into a page's #chat-messages container
  // (used by both factory chat sections and chat.html). Updates the chat header
  // text/avatar when those nodes exist.
  window.xocLoadOrderInChatSection = function(orderId) {
    if (!orderId) return;
    var pane = document.getElementById('chat-messages');
    if (!pane) return;
    var msgs = (typeof EGStore !== 'undefined' && EGStore.getOrderChat) ? EGStore.getOrderChat(orderId) : [];
    // Header swap (best-effort — these elements may not exist on every page).
    var nameEl = document.getElementById('chat-name');
    var statusEl = document.getElementById('chat-status');
    var avEl = document.getElementById('chat-avatar');
    if (nameEl) nameEl.textContent = 'Order #' + orderId;
    if (statusEl) { statusEl.textContent = msgs.length + ' message' + (msgs.length === 1 ? '' : 's'); statusEl.style.color = '#9ca3af'; }
    if (avEl) {
      avEl.textContent = String(orderId).replace(/[^A-Z0-9]/gi,'').slice(-2).toUpperCase() || '##';
      avEl.style.background = '#fef3c7';
      avEl.style.color = '#b45309';
    }
    // Strip any sidebar "active" so this synthetic conversation reads as the focus.
    var items = document.querySelectorAll('.conv-item');
    items.forEach(function(i){ i.classList.remove('active'); });
    // Render messages — re-use the dock's bubble style for visual continuity.
    if (!msgs.length) {
      pane.innerHTML = '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:32px 0;line-height:1.5">No messages yet for this order.</div>';
      return;
    }
    pane.innerHTML = msgs.map(function(m){
      if (m.system) {
        return '<div style="text-align:center;font-size:11.5px;color:#9ca3af;padding:6px 0">— ' + (m.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;') + ' · ' + fmtTime(m.ts) + ' —</div>';
      }
      var st = ROLE_STYLE[m.role] || ROLE_STYLE.seller;
      var mine = m.role === role();
      var align = mine ? 'flex-end' : 'flex-start';
      var bg = mine ? '#111827' : '#fff';
      var fg = mine ? '#fff' : '#191918';
      var labelStyle = 'font-size:10.5px;font-weight:700;color:' + st.fg + ';background:' + st.bg + ';padding:1px 6px;border-radius:4px;letter-spacing:.04em';
      return '<div style="display:flex;flex-direction:column;align-items:' + align + ';gap:3px;max-width:60%;align-self:' + align + ';margin:6px 0">'
        + '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#9ca3af">'
          + '<span style="' + labelStyle + '">' + (st.label || m.role).toUpperCase() + '</span>'
          + '<span>' + (m.by||'') + '</span>'
          + '<span>·</span>'
          + '<span>' + fmtTime(m.ts) + '</span>'
        + '</div>'
        + '<div style="background:' + bg + ';color:' + fg + ';padding:9px 13px;border-radius:11px;font-size:13.5px;line-height:1.5;border:1px solid ' + (mine?'#111827':'#e5e4e0') + ';word-wrap:break-word">'
          + (m.text ? m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;') : '')
          + (m.attachment ? renderAttachment(m.attachment, mine) : '')
        + '</div>'
      + '</div>';
    }).join('');
    pane.scrollTop = pane.scrollHeight;
    // Save the order id so the in-section composer can send to the right thread.
    window.__xocActiveOrderInSection = orderId;
    // Hijack the page's existing sendMsg() so typing in the main composer writes
    // to EGStore.appendOrderChat for the current order — keeps the in-dock and
    // in-section views in sync.
    if (!window.__xocSendMsgWrapped) {
      window.__xocSendMsgWrapped = true;
      var orig = window.sendMsg;
      window.sendMsg = function() {
        var ord = window.__xocActiveOrderInSection;
        if (!ord || typeof EGStore === 'undefined' || !EGStore.appendOrderChat) {
          return orig ? orig.apply(this, arguments) : null;
        }
        var inp = document.getElementById('msg-input');
        var text = (inp && inp.value || '').trim();
        if (!text) return;
        EGStore.appendOrderChat(ord, {
          by: (role().charAt(0).toUpperCase() + role().slice(1)),
          role: role(),
          text: text
        });
        if (inp) { inp.value = ''; inp.style.height = 'auto'; }
        window.xocLoadOrderInChatSection(ord);
      };
    }
  };
  // Switch the dock to the in-dock all-chats list (no navigation).
  window.xOrderChatShowList = function() {
    ensureModal();
    var m = document.getElementById('xoc-modal');
    setView('list');
    if (m && m.style.display === 'none') {
      m.style.display = 'flex';
      applyDockSize();
      requestAnimationFrame(function(){
        m.style.transform = 'translateY(0) scale(1)';
        m.style.opacity = '1';
      });
      showFab(false);
    }
  };
  // Back-compat alias for older callers.
  window.xOrderChatBackToAll = window.xOrderChatShowList;
  window.xOrderChatSend = function() {
    if (!_orderId) return;
    var isTeam = _orderId.indexOf('TEAM:') === 0;
    // Designers can't post to per-order chat — but they CAN on team threads
    // (that's their primary side-channel with factory). Other roles always allowed.
    if (isInternalOnly() && !isTeam) return;
    var inp = document.getElementById('xoc-input');
    var text = (inp && inp.value || '').trim();
    if (!text) return;
    if (typeof EGStore !== 'undefined' && EGStore.appendOrderChat) {
      var msg = {
        by: (role().charAt(0).toUpperCase() + role().slice(1)),
        role: role(),
        text: text
      };
      EGStore.appendOrderChat(_orderId, msg);
      // Sending = thread is "read" for me + recompute the badge for this tab.
      // Storage events don't fire on the originating tab, so we have to bump
      // the badge ourselves here.
      try { if (EGStore.markChatThreadRead) EGStore.markChatThreadRead(_orderId); } catch(e){}
      if (typeof refreshFabBadge === 'function') refreshFabBadge();
    }
    if (inp) inp.value = '';
    renderMessages();
  };
  // File-attach handler: reads the chosen file, downscales raster images so
  // they fit comfortably in localStorage, then embeds them as a chat message.
  window.xOrderChatAttach = function(input) {
    if (!input || !input.files || !input.files[0]) { return; }
    if (!_orderId) {
      alert('Open an order chat first to attach a file.');
      input.value = '';
      return;
    }
    // Designers are read-only on order chat — they attach files on the
    // design card instead.
    if (isInternalOnly()) { input.value = ''; return; }
    var file = input.files[0];
    var isImg = /^image\//.test(file.type);
    var role_ = role();
    var byLabel = role_.charAt(0).toUpperCase() + role_.slice(1);
    var append = function(attachment){
      if (typeof EGStore === 'undefined' || !EGStore.appendOrderChat) return;
      var msg = { by: byLabel, role: role_, text: '', attachment: attachment };
      if (isInternalOnly()) msg.internal = true;
      EGStore.appendOrderChat(_orderId, msg);
      input.value = '';
      renderMessages();
    };
    var reader = new FileReader();
    reader.onerror = function(){
      alert('Could not read the file. Please try again.');
      input.value = '';
    };
    reader.onload = function(){
      var dataUrl = reader.result;
      var attach = { kind: isImg ? 'image' : 'file', name: file.name, size: file.size, dataUrl: dataUrl };
      // Raster images go through the EGStore downscaler so a 10MB photo
      // becomes ~50KB before it ever hits localStorage. Other files keep
      // their raw bytes (PDFs, SVGs, EMB binaries stay as-is).
      if (isImg && typeof EGStore !== 'undefined' && EGStore.downscaleDataUrl) {
        EGStore.downscaleDataUrl(dataUrl).then(function(small){
          attach.dataUrl = small;
          append(attach);
        });
      } else {
        // Non-raster cap: if > 4MB drop the inline blob and store metadata only.
        var MAX = 4 * 1024 * 1024;
        if (file.size > MAX) attach.dataUrl = null;
        append(attach);
      }
    };
    reader.readAsDataURL(file);
  };
  // Factory-only: change status + auto-emit system message into the chat thread.
  window.xOrderChatSetStatus = function(newStatus) {
    if (!isFactory() || !_orderId) return;
    if (typeof EGStore === 'undefined' || !EGStore.update) return;
    // Re-check allow-list — protects against direct API calls bypassing the dropdown.
    var allowed = ROLE_STATUS_ALLOWED[role()] || [];
    if (allowed.indexOf(newStatus) === -1) return;
    var opt = STATUS_OPTIONS.find(function(s){ return s.value === newStatus; });
    if (!opt) return;
    EGStore.update(_orderId, { factoryStatus: newStatus });
    EGStore.appendOrderChat(_orderId, {
      by: (role().charAt(0).toUpperCase() + role().slice(1)),
      role: 'system',
      text: 'Status changed to ' + opt.label + ' by ' + role(),
      system: true
    });
    renderStatusBar();
    renderMessages();
    notifyLocalOrderListReRender(_orderId, newStatus);
  };
  // Same-tab pipeline routing: when chat changes status, propagate it into
  // whichever local order array this dashboard uses (OP_ORDERS / WH_ORDERS /
  // SHARED_PRODUCTS / ORDERS) and call its renderer so the order moves to the
  // right tab + the action button on its row matches the new status.
  function notifyLocalOrderListReRender(orderId, newStatus) {
    var match = function(o){
      var key = String(o.num != null ? o.num : (o.no != null ? o.no : o.id));
      return key === String(orderId);
    };
    var arrays = [window.OP_ORDERS, window.WH_ORDERS, window.ORDERS];
    arrays.forEach(function(arr){
      if (!Array.isArray(arr)) return;
      arr.forEach(function(o){
        if (match(o)) {
          o.status = newStatus;
          o.factoryStatus = newStatus;
          if ('flagged' in o) o.flagged = (newStatus === 'flagged');
        }
      });
    });
    // Try each known renderer.
    ['renderOpOrders','whRenderOrders','admRenderOrders','renderOrders'].forEach(function(fn){
      if (typeof window[fn] === 'function') {
        try { window[fn](); } catch(e) {}
      }
    });
  }
  // Expose for the storage listener too.
  window.__xocSyncLocalOrders = notifyLocalOrderListReRender;

  // Cross-tab live updates — re-render whichever view is active AND drive any
  // local order arrays so the pipeline status syncs across dashboards in real
  // time (e.g. operator marks an order awaiting_scan → warehouse's tab counter
  // updates without a refresh).
  window.addEventListener('storage', function(e){
    // Chat-seen changes (from this tab marking a thread read) need to refresh
    // the badge too, even though they don't change orders/messages.
    if (e.key === 'eg_chat_seen') { refreshFabBadge(); return; }
    if (e.key !== 'eg_order_chats' && e.key !== 'egfulfill_orders') return;
    // New incoming chat → recompute the badge so unread conversations bump up.
    if (e.key === 'eg_order_chats') refreshFabBadge();
    if (e.key === 'egfulfill_orders' && typeof EGStore !== 'undefined' && EGStore.getOrders) {
      var live = EGStore.getOrders();
      var arrays = [window.OP_ORDERS, window.WH_ORDERS, window.ORDERS];
      arrays.forEach(function(arr){
        if (!Array.isArray(arr)) return;
        arr.forEach(function(o){
          var key = String(o.num != null ? o.num : (o.no != null ? o.no : o.id));
          var found = live.find(function(x){ return String(x.id) === key; });
          if (found && found.factoryStatus && found.factoryStatus !== o.status) {
            o.status = found.factoryStatus;
            o.factoryStatus = found.factoryStatus;
            if ('flagged' in o) o.flagged = (found.factoryStatus === 'flagged');
          }
        });
      });
      ['renderOpOrders','whRenderOrders','admRenderOrders','renderOrders'].forEach(function(fn){
        if (typeof window[fn] === 'function') { try { window[fn](); } catch(err) {} }
      });
    }
    var m = document.getElementById('xoc-modal');
    if (!m || m.style.display === 'none') return;
    if (_view === 'list') {
      renderList();
    } else if (_orderId) {
      renderMessages();
      renderStatusBar();
    }
  });
  // Click-outside-to-minimize. When the dock is open and the user clicks
  // anywhere outside it (and outside the FAB), collapse back to the bubble
  // instead of leaving the dock pinned in the corner. Skipped while the
  // file-picker dialog is open so users can pick attachments without the
  // dock disappearing.
  document.addEventListener('mousedown', function(e){
    var m = document.getElementById('xoc-modal');
    if (!m || m.style.display === 'none') return;
    if (m.contains(e.target)) return;
    var fab = document.getElementById('xoc-fab');
    if (fab && fab.contains(e.target)) return;
    // Other modals/popovers that sit on top of the dock — treat them as
    // "inside" so the chat doesn't collapse mid-action. Includes:
    //   • eg-confirm-modal — egConfirmModal() destructive prompts
    //   • xoc-picker       — the "+ New conversation" search overlay
    var conf = document.getElementById('eg-confirm-modal');
    if (conf && conf.contains(e.target)) return;
    var picker = document.getElementById('xoc-picker');
    if (picker && picker.contains(e.target)) return;
    if (typeof window.xOrderChatMinimize === 'function') window.xOrderChatMinimize();
  }, true);
  // Always-on FAB — every page that loads this script gets a floating chat
  // bubble at the bottom-right. Clicking it opens the cross-order list view
  // (xOrderChatRestore is patched to handle the no-active-order case).
  // The FAB stays visible regardless of localStorage state — clearAll(), a
  // manual localStorage.clear(), or any cross-tab storage event re-asserts
  // its visibility so the bubble never disappears unexpectedly.
  function _bootFab(){
    ensureModal();
    var m = document.getElementById('xoc-modal');
    // Only force-show if the dock isn't actively open.
    if (!m || m.style.display === 'none' || !m.style.display) showFab(true);
    refreshFabBadge();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bootFab);
  else _bootFab();
  window.addEventListener('storage', _bootFab);
  // Same-tab badge refresh hook — fires when this tab marks a thread read.
  window.addEventListener('eg-chat-seen-changed', refreshFabBadge);
  // Cheap polling fallback so badges stay live when chat events arrive from
  // background JS in the same tab (storage events don't fire on the writer).
  // 2s is fast enough to feel real-time, slow enough to be invisible.
  setInterval(refreshFabBadge, 2000);
})();

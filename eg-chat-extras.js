// Shared chat-extras helper — Broadcast composer + Notifications tab +
// attach-file plumbing. Each dashboard's chat section opts in by:
//   1. Setting <body data-eg-role="operator|admin|warehouse|seller|designer">
//   2. Including this script after egfulfill-store.js
//   3. (Optional) Placing markers in their existing chat markup that the
//      helper attaches to:
//        - [data-eg-chat-tabs]      … row that holds tab buttons (Notif tab is appended here)
//        - [data-eg-chat-list-host] … container that hosts conv lists (notif list is appended here)
//        - [data-eg-chat-section]   … the outer chat section (Broadcast button is mounted into its header)
//        - [data-eg-chat-foot]      … the message-input row (attach icon is prepended)
//        - [data-eg-notif-list]     … the slide-panel #notif-list element to keep in sync
//        - [data-eg-chat-messages]  … the message pane where attachments + admin bubble go
//
// Factory roles (operator/admin/warehouse) get a "+ Broadcast" button; seller
// and designer get a read-only Notifications tab with no reply input.
(function () {
  'use strict';

  // Inject CSS once on first load — normalises every .notif-row to match the
  // inbox conversation row: round avatar, single-line ellipsised title +
  // subtitle, muted right-aligned timestamp. Works for both the helper's
  // dynamically-rendered broadcast rows AND the per-page static notification
  // markup, since the selectors target structural position (not the inline
  // colours each file ships with).
  (function injectNotifCSS(){
    if (document.getElementById('eg-notif-css')) return;
    var s = document.createElement('style');
    s.id = 'eg-notif-css';
    s.textContent = ''
      + '.notif-row{display:flex!important;align-items:center!important;gap:10px!important;padding:11px 16px!important;border-bottom:1px solid #f3f3f1;cursor:pointer;transition:background .15s}'
      + '.notif-row:hover,.notif-row.unread{background:#fafaf9}'
      // Avatar — first immediate <div> child of the row.
      + '.notif-row > div:first-child{border-radius:50%!important;width:34px!important;height:34px!important;flex-shrink:0;margin-top:0!important}'
      // Text column — second <div>: title (first child) + subtitle (next).
      + '.notif-row > div:nth-child(2){flex:1!important;min-width:0!important;display:flex;flex-direction:column;gap:1px;overflow:hidden}'
      + '.notif-row > div:nth-child(2) > div:first-child{font-size:13.5px;font-weight:700;color:#191918;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35}'
      + '.notif-row > div:nth-child(2) > div:nth-child(2){font-size:12.5px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35}'
      // Timestamp — matches inbox conv timestamp (smaller, lighter, no bold).
      + '.notif-row > span:last-child{font-size:11.5px!important;color:#9ca3af!important;font-weight:500!important;white-space:nowrap;flex-shrink:0;align-self:center}';
    document.head.appendChild(s);
  })();

  var ROLE_META = {
    operator:  { name: 'Operator',  canBroadcast: true,  canReplyNotif: false },
    admin:     { name: 'Admin',     canBroadcast: true,  canReplyNotif: false },
    warehouse: { name: 'Warehouse', canBroadcast: true,  canReplyNotif: false },
    seller:    { name: 'Seller',    canBroadcast: false, canReplyNotif: false },
    designer:  { name: 'Designer',  canBroadcast: false, canReplyNotif: false }
  };
  function role() { return (document.body && document.body.dataset && document.body.dataset.egRole) || 'operator'; }
  function meta() { return ROLE_META[role()] || ROLE_META.operator; }

  function staticNotifCache() {
    if (window.__egStaticNotifHtml != null) return window.__egStaticNotifHtml;
    var src = document.querySelector('[data-eg-notif-list]') || document.getElementById('notif-list');
    window.__egStaticNotifHtml = src ? src.innerHTML : '';
    return window.__egStaticNotifHtml;
  }

  function buildBroadcastRow(bc) {
    var time = (typeof EGStore !== 'undefined' && EGStore.formatBroadcastAge) ? EGStore.formatBroadcastAge(bc.ts) : '';
    var title = String(bc.title || '').replace(/"/g, '&quot;');
    var body  = String(bc.body  || '').replace(/"/g, '&quot;');
    var sTitle = title.replace(/</g, '&lt;');
    var sBody  = body.replace(/</g, '&lt;');
    return ''
      + '<div class="notif-row" data-nid="' + bc.id + '" data-title="' + title + '" data-sub="' + body + '" data-time="' + time + '" onclick="EGChatExtras.onNotifClick(this)">'
      +   '<div style="width:30px;height:30px;border-radius:8px;background:#eeede9;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">'
      +     '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 4h9M2 7h7M2 10h5" stroke="#374151" stroke-width="1.3" stroke-linecap="round"/></svg>'
      +   '</div>'
      +   '<div style="flex:1;min-width:0">'
      +     '<div style="font-size:13.5px;font-weight:600;color:#191918;margin-bottom:1px">' + sTitle + '</div>'
      +     '<div style="font-size:12.5px;color:#9ca3af">' + (sBody || ('Broadcast from ' + (bc.senderName || 'Factory'))) + '</div>'
      +   '</div>'
      +   '<span style="font-size:11.5px;color:#6b7280;font-weight:600;white-space:nowrap;flex-shrink:0">' + time + '</span>'
      + '</div>';
  }

  function rebuildNotifList() {
    var src = document.querySelector('[data-eg-notif-list]') || document.getElementById('notif-list');
    if (!src) return;
    var cached = staticNotifCache();
    var bcs = (typeof EGStore !== 'undefined' && EGStore.getBroadcasts) ? EGStore.getBroadcasts() : [];
    src.innerHTML = bcs.map(buildBroadcastRow).join('') + cached;
    // Mirror into the in-chat Notifications list if present.
    var dst = document.getElementById('chat-notif-list');
    if (dst) dst.innerHTML = src.innerHTML;
    var badge = document.getElementById('chat-tab-notif-count');
    if (badge) {
      var n = src.querySelectorAll('.notif-row').length;
      badge.textContent = n;
      badge.style.display = n > 0 ? '' : 'none';
    }
  }

  // ── Broadcast composer modal (lazy-mounted) ──
  function openComposer() {
    if (!meta().canBroadcast) return;
    var m = document.getElementById('eg-bc-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'eg-bc-modal';
      m.className = 'modal-overlay modal-hidden';
      m.style.zIndex = '300';
      m.addEventListener('click', function (e) { if (e.target === m) closeComposer(); });
      m.innerHTML =
        '<div class="modal" style="max-width:460px;width:92vw">' +
          '<div style="padding:16px 22px;border-bottom:1px solid #f3f3f1;display:flex;align-items:center;justify-content:space-between">' +
            '<div>' +
              '<div style="font-size:15.5px;font-weight:700;color:#191918">Broadcast notification</div>' +
              '<div style="font-size:12px;color:#9ca3af;margin-top:1px">Sent to every connected dashboard.</div>' +
            '</div>' +
            '<button id="eg-bc-close-btn" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:21px;line-height:1;padding:0 4px">×</button>' +
          '</div>' +
          '<div style="padding:18px 22px;display:flex;flex-direction:column;gap:12px">' +
            '<div><label style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Title</label>' +
              '<input id="eg-bc-title" class="input" placeholder="e.g. System maintenance tonight" style="font-size:14px"/></div>' +
            '<div><label style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Category</label>' +
              '<select id="eg-bc-cat" class="input select" style="font-size:14px">' +
                '<option value="general">General announcement</option>' +
                '<option value="product_news">Product updates &amp; news</option>' +
                '<option value="production_issue">Production issue</option>' +
                '<option value="billing">Billing alert</option>' +
              '</select>' +
              '<div style="font-size:11.5px;color:#9ca3af;margin-top:5px">Sellers who muted this category still see it, but it won\'t raise their bell.</div></div>' +
            '<div><label style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Message</label>' +
              '<textarea id="eg-bc-body" class="input" rows="3" placeholder="Optional — short description for the notification body…" style="font-size:14px;resize:none;font-family:inherit"></textarea></div>' +
          '</div>' +
          '<div style="padding:14px 22px;border-top:1px solid #f3f3f1;display:flex;justify-content:flex-end;gap:8px">' +
            '<button id="eg-bc-cancel-btn" class="btn btn-out">Cancel</button>' +
            '<button id="eg-bc-send-btn" class="btn btn-dk">Send to all →</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(m);
      document.getElementById('eg-bc-close-btn').addEventListener('click', closeComposer);
      document.getElementById('eg-bc-cancel-btn').addEventListener('click', closeComposer);
      document.getElementById('eg-bc-send-btn').addEventListener('click', sendBroadcast);
    }
    document.getElementById('eg-bc-title').value = '';
    document.getElementById('eg-bc-body').value  = '';
    m.classList.remove('modal-hidden');
    setTimeout(function () { var t = document.getElementById('eg-bc-title'); if (t) t.focus(); }, 30);
  }
  function closeComposer() {
    var m = document.getElementById('eg-bc-modal');
    if (m) m.classList.add('modal-hidden');
  }
  function sendBroadcast() {
    var titleEl = document.getElementById('eg-bc-title');
    var bodyEl  = document.getElementById('eg-bc-body');
    var title = (titleEl?.value || '').trim();
    var body  = (bodyEl?.value || '').trim();
    if (!title) { if (titleEl) { titleEl.style.borderColor = '#dc2626'; setTimeout(function(){ titleEl.style.borderColor = ''; }, 1200); titleEl.focus(); } return; }
    if (typeof EGStore === 'undefined' || !EGStore.addBroadcast) { alert('Broadcast service unavailable.'); return; }
    var cat = (document.getElementById('eg-bc-cat') || {}).value || 'general';
    EGStore.addBroadcast({ title: title, body: body, category: cat, sender: role(), senderName: meta().name });
    closeComposer();
    rebuildNotifList();
    egToast('Broadcast sent to all dashboards');
  }

  function egToast(msg) {
    var t = document.getElementById('eg-bc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'eg-bc-toast';
      t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#191918;color:#fff;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px;z-index:2000;opacity:0;transition:opacity .25s;pointer-events:none;font-family:Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.14)';
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(t._tid); t._tid = setTimeout(function(){ t.style.opacity = '0'; }, 2200);
  }

  // ── Attach-file plumbing for the chat input ──
  function installAttach(footEl, messagesEl) {
    if (!footEl || !messagesEl) return;
    if (footEl.querySelector('.eg-attach-input')) return;
    var input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.className = 'eg-attach-input';
    input.style.display = 'none';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.title = 'Attach file';
    btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:6px;color:#6b7280;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center';
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>';
    btn.onmouseover = function () { btn.style.background = '#f6f5f4'; btn.style.color = '#191918'; };
    btn.onmouseout  = function () { btn.style.background = 'none';    btn.style.color = '#6b7280'; };
    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var files = Array.from(input.files || []);
      if (!files.length) return;
      var fmt = function (b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; };
      var now = new Date().toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
      files.forEach(function (f) {
        var div = document.createElement('div');
        div.className = 'chat-msg me';
        var isImg = /^image\//.test(f.type);
        div.innerHTML = '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;max-width:78%">' +
          '<div class="chat-bubble me" style="padding:8px 10px">' +
            (isImg ? '<img src="' + URL.createObjectURL(f) + '" style="max-width:240px;max-height:240px;border-radius:7px;display:block;margin-bottom:5px"/>' :
              '<div style="display:flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M5 2h9l4 4v14H5V2z" stroke="rgba(255,255,255,.6)" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 2v4h4" stroke="rgba(255,255,255,.6)" stroke-width="1.5"/></svg>') +
            '<div><div style="font-size:13px;color:#fff;word-break:break-word">' + f.name.replace(/</g, '&lt;') + '</div><div style="font-size:11.5px;color:rgba(255,255,255,.55)">' + fmt(f.size) + '</div></div>' +
            (isImg ? '' : '</div>') +
          '</div>' +
          '<div style="font-size:11.5px;color:#9ca3af;padding-right:4px">You · ' + now + '</div>' +
        '</div>';
        messagesEl.appendChild(div);
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
      input.value = '';
    });
    footEl.insertBefore(input, footEl.firstChild);
    footEl.insertBefore(btn,   footEl.firstChild.nextSibling);
  }

  // ── Top-of-page Broadcast trigger ──
  function installBroadcastTrigger(sectionEl) {
    if (!sectionEl || !meta().canBroadcast) return;
    if (sectionEl.querySelector('[data-eg-bc-trigger]')) return;
    sectionEl.style.display = sectionEl.style.display || '';
    // Force flex column so the trigger row + card stack vertically.
    sectionEl.style.flexDirection = 'column';
    sectionEl.style.gap = '12px';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;flex-shrink:0';
    bar.innerHTML = '<button data-eg-bc-trigger class="btn btn-dk" style="font-size:13px;padding:6px 14px;gap:5px"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="white" stroke-width="1.7" stroke-linecap="round"/></svg>Broadcast</button>';
    bar.querySelector('button').addEventListener('click', openComposer);
    sectionEl.insertBefore(bar, sectionEl.firstChild);
    // The chat card should fill the remaining height so footers still align.
    var card = sectionEl.querySelector('.card, [data-eg-chat-card]') || sectionEl.children[1];
    if (card) { card.style.flex = '1'; card.style.minHeight = '0'; card.style.height = ''; }
  }

  // ── Notifications tab in the chat sidebar ──
  // Works with either setChatTab (operator/admin/warehouse) or setTab (seller
  // chat.html / designer) — we wrap whichever one exists so a click on any
  // other tab hides the notif list, and the notif tab hides every other.
  function installNotifTab(tabsEl, listHostEl) {
    if (!tabsEl || !listHostEl) return;
    if (document.getElementById('chat-tab-notif')) return;
    var btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.id = 'chat-tab-notif';
    btn.style.cssText = 'font-size:13px;padding:4px 10px';
    btn.innerHTML = 'Notifications <span id="chat-tab-notif-count" style="font-size:10.5px;font-weight:700;background:#191918;color:#fff;padding:1px 6px;border-radius:999px;margin-left:3px;display:none">0</span>';
    btn.addEventListener('click', function () { switchToNotif(btn); });
    tabsEl.appendChild(btn);
    var list = document.createElement('div');
    list.id = 'chat-notif-list';
    list.style.display = 'none';
    listHostEl.appendChild(list);
    // Wrap whichever tab-switcher the host page uses.
    ['setChatTab', 'setTab'].forEach(function (fnName) {
      var orig = window[fnName];
      if (typeof orig !== 'function') return;
      window[fnName] = function (tab, el) {
        orig(tab, el);
        list.style.display = tab === 'notif' ? '' : 'none';
        if (tab === 'notif') rebuildNotifList();
        btn.classList.toggle('on', tab === 'notif');
      };
    });
  }
  function switchToNotif(btn) {
    document.querySelectorAll('#chat-tab-sellers,#chat-tab-team,#chat-tab-inbox,#chat-tab-notif,#tab-team,#tab-support,#tab-history').forEach(function (b) { b.classList.remove('on'); });
    btn.classList.add('on');
    var listsToHide = ['chat-sellers-list', 'chat-team-list', 'list-team', 'list-support', 'list-history'];
    listsToHide.forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
    var dst = document.getElementById('chat-notif-list'); if (dst) dst.style.display = '';
    rebuildNotifList();
  }

  // ── Inbox merge: hide the Team tab and relabel Sellers → Inbox. When the
  //    merged tab is active, both #chat-sellers-list and #chat-team-list show
  //    together so the user sees one continuous Inbox.
  function installInboxMerge() {
    var sellersBtn = document.getElementById('chat-tab-sellers');
    var teamBtn    = document.getElementById('chat-tab-team');
    if (!sellersBtn || !teamBtn) return; // nothing to merge
    sellersBtn.textContent = 'Inbox';
    sellersBtn.id = 'chat-tab-inbox';
    sellersBtn.setAttribute('onclick', "setChatTab('inbox',this)");
    teamBtn.style.display = 'none';
    // Patch setChatTab to recognise 'inbox' = show both sellers + team lists.
    var origSet = window.setChatTab;
    if (typeof origSet === 'function') {
      window.setChatTab = function (tab, el) {
        if (tab === 'inbox') {
          // Activate ourselves; pass through to original with 'sellers' so it
          // toggles classes correctly, then unhide the team list.
          origSet('sellers', el);
          var team = document.getElementById('chat-team-list');
          if (team) team.style.display = '';
          if (sellersBtn) sellersBtn.classList.add('on');
        } else {
          origSet(tab, el);
        }
      };
    }
    // Initial state — show both lists.
    var team = document.getElementById('chat-team-list');
    if (team) team.style.display = '';
  }

  // ── Notification row click → main pane shows admin card-style bubble ──
  function onNotifClick(rowEl) {
    if (!rowEl) return;
    var n = { id: rowEl.dataset.nid, title: rowEl.dataset.title, sub: rowEl.dataset.sub, time: rowEl.dataset.time };
    if (typeof closeNotifPanel === 'function') closeNotifPanel();
    if (typeof showSection === 'function') showSection('chat');
    setTimeout(function () {
      var nbtn = document.getElementById('chat-tab-notif');
      if (nbtn) switchToNotif(nbtn);
      setTimeout(function () { focusNotifRow(n.id); swapMainPaneToAdmin(n); }, 80);
    }, 100);
  }
  function focusNotifRow(nid) {
    if (!nid) return;
    document.querySelectorAll('#chat-notif-list .notif-row').forEach(function (r) { r.style.background = ''; });
    var t = document.querySelector('#chat-notif-list .notif-row[data-nid="' + nid + '"]');
    if (!t) return;
    t.style.background = '#f6f5f4';
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function swapMainPaneToAdmin(n) {
    var hdr = document.getElementById('chat-hdr-name');  if (hdr) hdr.textContent = 'Admin';
    var ava = document.getElementById('chat-hdr-avatar'); if (ava) { ava.textContent = 'AD'; ava.style.background = '#191918'; ava.style.color = '#e8e4dd'; }
    var st  = document.getElementById('chat-hdr-status'); if (st) st.textContent = '● Notifications';
    var msgs = document.querySelector('[data-eg-chat-messages]') || document.getElementById('chat-messages');
    if (!msgs) return;
    msgs.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'chat-msg them';
    div.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:6px;max-width:78%">' +
        '<div style="background:#fdfcfa;border:1px solid #40403d;border-radius:10px;box-shadow:2px 2px 0 #40403d;padding:12px 14px">' +
          '<div style="font-size:14.5px;font-weight:700;color:#191918;margin-bottom:4px;line-height:1.35">' + (n.title || '').replace(/</g, '&lt;') + '</div>' +
          '<div style="font-size:13.5px;color:#374151;line-height:1.5">' + (n.sub || '').replace(/</g, '&lt;') + '</div>' +
        '</div>' +
        '<div style="font-size:11.5px;color:#9ca3af;padding-left:4px">Admin · ' + (n.time || '') + '</div>' +
      '</div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    // Seller / designer get a read-only banner instead of the reply input.
    if (!meta().canReplyNotif && role() !== 'operator' && role() !== 'admin' && role() !== 'warehouse') {
      var foot = document.querySelector('[data-eg-chat-foot]');
      if (foot) foot.style.display = 'none';
    }
  }

  // ── Entry point — call from each page's DOMContentLoaded ──
  function install() {
    var section = document.querySelector('[data-eg-chat-section]') || document.getElementById('section-chat');
    var tabs    = document.querySelector('[data-eg-chat-tabs]');
    var listHost= document.querySelector('[data-eg-chat-list-host]');
    var foot    = document.querySelector('[data-eg-chat-foot]') || document.querySelector('.chat-foot');
    var msgs    = document.querySelector('[data-eg-chat-messages]') || document.getElementById('chat-messages');
    if (section) installBroadcastTrigger(section);
    if (tabs && listHost) installNotifTab(tabs, listHost);
    if (foot && msgs)     installAttach(foot, msgs);
    // Factory roles get the Sellers+Team → Inbox merge for parity with operator.
    if (meta().canBroadcast) installInboxMerge();
    rebuildNotifList();
  }

  window.EGChatExtras = {
    install: install,
    rebuildNotifList: rebuildNotifList,
    openComposer: openComposer,
    onNotifClick: onNotifClick,
    swapMainPaneToAdmin: swapMainPaneToAdmin
  };
  if (document.readyState !== 'loading') install();
  else document.addEventListener('DOMContentLoaded', install);
  window.addEventListener('storage', function (e) {
    if (e && (e.key === 'eg_broadcasts' || e.key === null)) rebuildNotifList();
  });
  window.addEventListener('eg-broadcasts-changed', rebuildNotifList);
})();

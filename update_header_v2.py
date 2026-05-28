#!/usr/bin/env python3
import re, os

BASE = '/Users/linhphan/Downloads/.claude'
FILES = ['dashboard.html','orders.html','products-dash.html','wallet.html',
         'stores.html','fulfillment.html','analytics.html','settings.html',
         'design-lab.html','chat.html','apidocs.html']

# ── New universal header ──────────────────────────────────────────────────────
HEADER = '''  <!-- TOPBAR -->
  <header style="background:#fff;border-bottom:1px solid #e5e4e0;height:54px;display:flex;align-items:center;padding:0 20px;position:sticky;top:0;z-index:30;gap:8px;flex-shrink:0">
    <button id="mob-ham" onclick="toggleSidebar()" style="display:none;background:none;border:none;cursor:pointer;padding:5px 7px;border-radius:7px;color:#6b7280;line-height:0;align-items:center;flex-shrink:0"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    <div style="position:relative;flex:1;max-width:280px">
      <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%)" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#9ca3af" stroke-width="1.3"/><path d="M9.5 9.5L12 12" stroke="#9ca3af" stroke-width="1.3" stroke-linecap="round"/></svg>
      <input id="hdr-search" style="width:100%;background:#f6f5f4;border:1px solid #e5e4e0;border-radius:8px;padding:7px 12px 7px 34px;font-size:13px;color:#191918;outline:none;font-family:inherit;box-sizing:border-box" placeholder="Search orders, products, stores…"/>
    </div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:4px">
      <!-- Preferences panel -->
      <div style="position:relative">
        <button class="ibtn" onclick="togglePrefPanel(event)" id="pref-btn"><svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.9 2.9l1.06 1.06M11.04 11.04l1.06 1.06M11.04 3.96l-1.06 1.06M3.96 11.04l-1.06 1.06" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><span data-i18n="preferences">Preferences</span></button>
        <div id="pref-panel" style="display:none;position:absolute;top:calc(100% + 8px);left:0;background:#fff;border:1.5px solid #e5e4e0;border-radius:12px;padding:14px 16px;min-width:196px;z-index:201;box-shadow:0 8px 28px rgba(0,0,0,.11)">
          <div style="font-size:10.5px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px" data-i18n="appearance">Appearance</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
            <span style="font-size:13px;color:#374151" id="theme-label">Light mode</span>
            <button onclick="toggleTheme()" id="theme-toggle-btn" style="width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;background:#e5e4e0;position:relative;transition:background .25s;flex-shrink:0;padding:0">
              <span id="toggle-knob" style="position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .25s;display:block"></span>
            </button>
          </div>
        </div>
      </div>
      <!-- Notifications -->
      <button class="ibtn" style="position:relative" onclick="typeof toggleNotifPanel==='function'&&toggleNotifPanel(event)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a5 5 0 015 5v3l1 1.5H2L3 9.5v-3a5 5 0 015-5z" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 13.5a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><span data-i18n="notifications">Notifications</span><span style="position:absolute;top:4px;right:4px;width:7px;height:7px;background:#ef4444;border-radius:50%;border:1.5px solid #fff"></span></button>
      <!-- Settings gear -->
      <a href="settings.html" class="ibtn" style="text-decoration:none;padding:6px 8px" title="Settings"><svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 10a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" stroke-width="1.3"/><path d="M13.1 9l.9-.7-1-1.73-1.1.44a4.5 4.5 0 00-1.17-.67L10.5 5.1h-2l-.23 1.24a4.5 4.5 0 00-1.17.67L5.9 6.57 4.9 8.3l.9.7a4.6 4.6 0 000 1.0l-.9.7 1 1.73 1.1-.44c.37.27.75.49 1.17.67L8.5 14h2l.23-1.24a4.5 4.5 0 001.17-.67l1.1.44 1-1.73-.9-.7c.07-.32.1-.6.1-.8s-.03-.48-.1-.8z" stroke="currentColor" stroke-width="1.3"/></svg></a>
      <div style="width:1px;height:20px;background:#e5e4e0;margin:0 3px"></div>
      <!-- Wallet balance chip — click to add funds -->
      <button onclick="openQuickTopUp()" style="display:inline-flex;align-items:center;gap:5px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:8px;padding:5px 10px;cursor:pointer;font-family:inherit;transition:background .15s" onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='#fff5f5'" title="Click to add funds"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="3" width="11" height="8" rx="1.5" stroke="#dc2626" stroke-width="1.2"/><path d="M1 6h11" stroke="#dc2626" stroke-width="1.2"/><circle cx="9.5" cy="8" r="1" fill="#dc2626"/></svg><span style="font-size:12.5px;font-weight:700;color:#dc2626;white-space:nowrap">-$840.00</span></button>
      <!-- + New dropdown -->
      <div style="position:relative">
        <button class="btn btn-dk" onclick="toggleNewMenu(event)" id="new-menu-btn" style="gap:6px"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg><span data-i18n="new_btn">New</span><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5 8 3.5" stroke="white" stroke-width="1.3" stroke-linecap="round"/></svg></button>
        <div id="new-menu-dd" style="display:none;position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid #e5e4e0;border-radius:12px;padding:6px;min-width:210px;z-index:200;box-shadow:0 8px 32px rgba(0,0,0,.12)">
          <div onclick="goManualOrder()" style="display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='#f6f5f4'" onmouseout="this.style.background=''"><div style="width:28px;height:28px;background:#f4f2ef;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="#374151" stroke-width="1.3"/><path d="M4 7h6M4 4.5h6M4 9.5h3" stroke="#374151" stroke-width="1.3" stroke-linecap="round"/></svg></div><div><div style="font-size:13px;font-weight:600;color:#191918" data-i18n="manual_order">Manual order</div><div style="font-size:11.5px;color:#9ca3af;margin-top:1px" data-i18n="manual_order_sub">Create from scratch</div></div></div>
          <div onclick="window.location='stores.html'" style="display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='#f6f5f4'" onmouseout="this.style.background=''"><div style="width:28px;height:28px;background:#f4f2ef;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" stroke="#374151" stroke-width="1.3"/><path d="M1.5 7h11M7 1.5S5 4 5 7s2 5.5 2 5.5" stroke="#374151" stroke-width="1.3" stroke-linecap="round"/></svg></div><div><div style="font-size:13px;font-weight:600;color:#191918" data-i18n="sync_platforms">Sync from platforms</div><div style="font-size:11.5px;color:#9ca3af;margin-top:1px" data-i18n="sync_platforms_sub">Shopify, Etsy, WooCommerce…</div></div></div>
        </div>
      </div>
      <div style="width:1px;height:20px;background:#e5e4e0;margin:0 3px"></div>
      <!-- Profile -->
      <div class="ibtn" style="cursor:pointer" onclick="window.location='settings.html'"><div style="width:28px;height:28px;border-radius:50%;background:#111827;color:#d4a017;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">P</div><div><div style="font-size:13px;font-weight:600;color:#191918;line-height:1.2">Phan</div><div style="font-size:11px;color:#9ca3af;line-height:1.2">phanmylinh04…</div></div></div>
      <!-- Language toggle -->
      <button id="lang-btn" onclick="toggleLang()" style="font-size:11.5px;font-weight:700;color:#6b7280;background:none;border:1.5px solid #e5e4e0;border-radius:7px;padding:4px 9px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap" onmouseover="this.style.borderColor='#374151';this.style.color='#191918'" onmouseout="this.style.borderColor='#e5e4e0';this.style.color='#6b7280'">EN</button>
    </div>
  </header>'''

# ── Dark-mode CSS (appended to first </style>) ────────────────────────────────
DARK_CSS = '''
/* ── Dark mode ── */
html[data-theme=dark]{color-scheme:dark}
html[data-theme=dark] body{background:#0f0f0f!important}
html[data-theme=dark] .sidebar{background:#141414!important;border-right-color:#252525!important}
html[data-theme=dark] header{background:#141414!important;border-bottom-color:#252525!important}
html[data-theme=dark] .card{background:#1c1c1c!important;border-color:#252525!important}
html[data-theme=dark] .ni{color:#888884!important}
html[data-theme=dark] .ni.on{background:#252525!important;color:#f0f0ee!important}
html[data-theme=dark] .ni:hover:not(.on){background:#1c1c1c!important}
html[data-theme=dark] .ibtn{color:#888884!important}
html[data-theme=dark] .ibtn:hover{background:#252525!important;color:#e0e0de!important}
html[data-theme=dark] .dtable th{background:#111!important;color:#555552!important;border-color:#252525!important}
html[data-theme=dark] .dtable td{border-color:#1e1e1e!important}
html[data-theme=dark] .dtable tbody tr:hover td{background:#1c1c1c!important}
html[data-theme=dark] input:not([type=checkbox]):not([type=radio]),html[data-theme=dark] select,html[data-theme=dark] textarea{background:#1c1c1c!important;border-color:#2a2a2a!important;color:#e0e0de!important}
html[data-theme=dark] #pref-panel,html[data-theme=dark] #new-menu-dd{background:#1c1c1c!important;border-color:#2a2a2a!important;box-shadow:0 8px 24px rgba(0,0,0,.55)!important}
html[data-theme=dark] [style*="background:#fff;"]{background:#1c1c1c!important}
html[data-theme=dark] [style*="background: #fff"]{background:#1c1c1c!important}
html[data-theme=dark] [style*="background:#f4f2ef"]{background:#111111!important}
html[data-theme=dark] [style*="background:#f6f5f4"]{background:#1a1a1a!important}
html[data-theme=dark] [style*="background:#f9f8f7"]{background:#1a1a1a!important}
html[data-theme=dark] [style*="background:#f3f3f1"]{background:#1a1a1a!important}
html[data-theme=dark] [style*="background:#f0ede9"]{background:#1a1a1a!important}
html[data-theme=dark] [style*="background:#e5e4e0"]{background:#2a2a2a!important}
html[data-theme=dark] [style*="background:#fffbeb"]{background:#1a1300!important}
html[data-theme=dark] [style*="background:#fff5f5"]{background:#1e0e0e!important}
html[data-theme=dark] [style*="background:#fee2e2"]{background:#220c0c!important}
html[data-theme=dark] [style*="color:#191918"]{color:#e8e8e6!important}
html[data-theme=dark] [style*="color:#111827"]{color:#f0f0ee!important}
html[data-theme=dark] [style*="color:#374151"]{color:#aeaeac!important}
html[data-theme=dark] [style*="color:#1f2937"]{color:#c4c4c2!important}
html[data-theme=dark] [style*="border-bottom:1px solid #f0ede9"]{border-bottom-color:#242424!important}
html[data-theme=dark] [style*="border-top:1px solid #f0ede9"]{border-top-color:#242424!important}
html[data-theme=dark] [style*="border:1px solid #e5e4e0"]{border-color:#252525!important}
html[data-theme=dark] [style*="border:1.5px solid #e5e4e0"]{border-color:#2a2a2a!important}
html[data-theme=dark] [style*="border-bottom:1px solid #e5e4e0"]{border-bottom-color:#252525!important}
html[data-theme=dark] [style*="border-top:1px solid #e5e4e0"]{border-top-color:#252525!important}
html[data-theme=dark] [style*="border-right:1px solid #e5e4e0"]{border-right-color:#252525!important}
html[data-theme=dark] .modal-overlay{background:rgba(0,0,0,.72)!important}
html[data-theme=dark] .stat-card{background:#1c1c1c!important;border-color:#252525!important}
html[data-theme=dark] .prog-bar{background:#252525!important}
html[data-theme=dark] #_qtm>div{background:#1c1c1c!important;border:1.5px solid #252525}
'''

# ── Footer JS (replaces old toggleNewMenu block) ──────────────────────────────
FOOTER_JS = r"""// ── Header shared JS ──
const _I18N={en:{preferences:'Preferences',notifications:'Notifications',new_btn:'New',manual_order:'Manual order',manual_order_sub:'Create from scratch',sync_platforms:'Sync from platforms',sync_platforms_sub:'Shopify, Etsy, WooCommerce…',appearance:'Appearance',light_mode:'Light mode',dark_mode:'Dark mode'},vi:{preferences:'Tùy chọn',notifications:'Thông báo',new_btn:'Tạo mới',manual_order:'Tạo đơn thủ công',manual_order_sub:'Nhập từ đầu',sync_platforms:'Kết nối sàn',sync_platforms_sub:'Shopify, Etsy, WooCommerce…',appearance:'Giao diện',light_mode:'Chế độ sáng',dark_mode:'Chế độ tối'}};
const _NAV={en:{'dashboard.html':'Dashboard','orders.html':'Orders','products-dash.html':'Products','stores.html':'Stores','fulfillment.html':'Fulfillment','analytics.html':'Analytics','wallet.html':'Wallet','design-lab.html':'Design Lab','chat.html':'Chat','apidocs.html':'API Documentation','settings.html':'Settings'},vi:{'dashboard.html':'Tổng quan','orders.html':'Đơn hàng','products-dash.html':'Sản phẩm','stores.html':'Cửa hàng','fulfillment.html':'Sản xuất','analytics.html':'Thống kê','wallet.html':'Ví tiền','design-lab.html':'Thiết kế','chat.html':'Tin nhắn','apidocs.html':'Tài liệu API','settings.html':'Cài đặt'}};
let _lang=localStorage.getItem('eg_lang')||'en';
function _t(k){return(_I18N[_lang]||_I18N.en)[k]||k}
function applyLang(lang){
  _lang=lang;localStorage.setItem('eg_lang',lang);
  const btn=document.getElementById('lang-btn');if(btn)btn.textContent=lang.toUpperCase();
  document.querySelectorAll('[data-i18n]').forEach(el=>{const v=_t(el.dataset.i18n);if(v)el.textContent=v;});
  const nm=_NAV[lang]||_NAV.en;
  document.querySelectorAll('a.ni[href]').forEach(el=>{
    const href=el.getAttribute('href');const label=nm[href];if(!label)return;
    const nodes=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim());
    if(nodes.length){nodes[nodes.length-1].textContent=label;}
  });
  const acc=document.querySelector('[data-section-label=account]');if(acc)acc.textContent=lang==='vi'?'TÀI KHOẢN':'ACCOUNT';
}
function toggleLang(){applyLang(_lang==='en'?'vi':'en');}
function applyTheme(dark){
  document.documentElement.setAttribute('data-theme',dark?'dark':'light');
  const lbl=document.getElementById('theme-label');
  const knob=document.getElementById('toggle-knob');
  const tgl=document.getElementById('theme-toggle-btn');
  if(lbl)lbl.textContent=_t(dark?'dark_mode':'light_mode');
  if(knob)knob.style.transform=dark?'translateX(18px)':'translateX(0)';
  if(tgl)tgl.style.background=dark?'#374151':'#e5e4e0';
  localStorage.setItem('eg_theme',dark?'dark':'light');
}
function toggleTheme(){applyTheme(document.documentElement.getAttribute('data-theme')!=='dark');}
function togglePrefPanel(e){if(e)e.stopPropagation();const p=document.getElementById('pref-panel');if(p)p.style.display=p.style.display==='none'?'block':'none';}
function toggleNewMenu(e){if(e)e.stopPropagation();const dd=document.getElementById('new-menu-dd');if(dd)dd.style.display=dd.style.display==='none'?'block':'none';}
function closeNewMenu(){const dd=document.getElementById('new-menu-dd');if(dd)dd.style.display='none';}
function goManualOrder(){closeNewMenu();if(typeof openNewOrderModal==='function'){openNewOrderModal();}else{window.location='orders.html';}}
function openQuickTopUp(){
  if(typeof openDepositModal==='function'){openDepositModal();return;}
  let m=document.getElementById('_qtm');
  if(!m){
    m=document.createElement('div');m.id='_qtm';
    m.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:500;align-items:center;justify-content:center';
    m.innerHTML='<div style="background:#fff;border-radius:16px;width:360px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);font-family:inherit"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px"><div style="font-size:16px;font-weight:700;color:#191918">Add Funds</div><button onclick="document.getElementById(\'_qtm\').style.display=\'none\'" style="background:none;border:none;cursor:pointer;font-size:18px;color:#9ca3af;padding:2px 6px;line-height:1">×</button></div><div style="background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px;padding:14px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center"><div style="font-size:12px;color:#6b7280">Current Balance</div><div style="font-size:20px;font-weight:800;color:#dc2626">-$840.00</div></div><div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px">Quick add</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:10px"><button onclick="document.getElementById(\'_qa\').value=50" style="padding:8px;border-radius:8px;border:1.5px solid #e5e4e0;background:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:border-color .15s" onmouseover="this.style.borderColor=\'#374151\'" onmouseout="this.style.borderColor=\'#e5e4e0\'">$50</button><button onclick="document.getElementById(\'_qa\').value=100" style="padding:8px;border-radius:8px;border:1.5px solid #e5e4e0;background:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:border-color .15s" onmouseover="this.style.borderColor=\'#374151\'" onmouseout="this.style.borderColor=\'#e5e4e0\'">$100</button><button onclick="document.getElementById(\'_qa\').value=200" style="padding:8px;border-radius:8px;border:1.5px solid #111827;background:#111827;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">$200</button></div><input id="_qa" type="number" value="200" placeholder="Custom amount" style="width:100%;padding:9px 12px;border-radius:9px;border:1.5px solid #e5e4e0;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:14px" onfocus="this.style.borderColor=\'#111827\'" onblur="this.style.borderColor=\'#e5e4e0\'"/><button onclick="document.getElementById(\'_qtm\').style.display=\'none\'" style="width:100%;padding:11px;border-radius:10px;border:none;background:#111827;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Add Funds →</button><div style="text-align:center;margin-top:10px"><a href="wallet.html" style="font-size:12px;color:#9ca3af;text-decoration:none">Manage wallet &amp; auto-reload →</a></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click',function(ev){if(ev.target===m)m.style.display='none';});
  }
  m.style.display='flex';
}
document.addEventListener('click',function(e){
  if(!document.getElementById('new-menu-btn')?.contains(e.target))closeNewMenu();
  if(!document.getElementById('pref-btn')?.contains(e.target)){const p=document.getElementById('pref-panel');if(p)p.style.display='none';}
});
(function(){applyTheme(localStorage.getItem('eg_theme')==='dark');applyLang(localStorage.getItem('eg_lang')||'en');})();"""

# ── Old JS pattern to replace ─────────────────────────────────────────────────
OLD_JS_PAT = re.compile(
    r'function toggleNewMenu\(e\)\{.*?document\.addEventListener\(\'click\',function\(e\)\{if\(!document\.getElementById\(\'new-menu-btn\'\)\?\.contains\(e\.target\)\)closeNewMenu\(\);\}\);',
    re.DOTALL
)

def process(fname):
    path = os.path.join(BASE, fname)
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()

    # 1. Replace header
    html = re.sub(r'  <!-- TOPBAR -->\n  <header[^>]*>.*?</header>', HEADER, html, flags=re.DOTALL)

    # 2. Append dark CSS before first </style>
    if DARK_CSS.strip() not in html:
        html = html.replace('</style>', DARK_CSS + '</style>', 1)

    # 3. Replace old footer JS block
    if OLD_JS_PAT.search(html):
        html = OLD_JS_PAT.sub(FOOTER_JS, html)
    else:
        # If old pattern not found, try just inserting before </script> near end
        # Find last </script> that's not a src script
        last_script_close = html.rfind('</script>')
        if last_script_close != -1:
            # Check if FOOTER_JS already present
            if 'applyTheme' not in html:
                html = html[:last_script_close] + '\n' + FOOTER_JS + '\n' + html[last_script_close:]

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'  ✓ {fname}')

print('Updating headers v2...')
for f in FILES:
    try:
        process(f)
    except Exception as e:
        print(f'  ✗ {f}: {e}')
print('Done.')

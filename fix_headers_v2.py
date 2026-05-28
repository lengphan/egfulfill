#!/usr/bin/env python3
import re, os

BASE = '/Users/linhphan/Downloads/.claude'

# ── Correct right-side header block (from analytics.html) ──────────────
CORRECT_RIGHT = '''    <div style="margin-left:auto;display:flex;align-items:center;gap:4px">
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
      <div style="width:1px;height:20px;background:#e5e4e0;margin:0 3px"></div>
      <!-- Wallet balance chip — click to add funds -->
      <button onclick="openQuickTopUp()" style="display:inline-flex;align-items:center;gap:5px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:8px;padding:5px 10px;cursor:pointer;font-family:inherit;transition:background .15s" onmouseover="this.style.background=\'#fee2e2\'" onmouseout="this.style.background=\'#fff5f5\'" title="Click to add funds"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="3" width="11" height="8" rx="1.5" stroke="#dc2626" stroke-width="1.2"/><path d="M1 6h11" stroke="#dc2626" stroke-width="1.2"/><circle cx="9.5" cy="8" r="1" fill="#dc2626"/></svg><span style="font-size:12.5px;font-weight:700;color:#dc2626;white-space:nowrap">-$840.00</span></button>
      <!-- + New dropdown -->
      <div style="position:relative">
        <button class="btn btn-dk" onclick="toggleNewMenu(event)" id="new-menu-btn" style="gap:6px"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg><span data-i18n="new_btn">New</span><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5 8 3.5" stroke="white" stroke-width="1.3" stroke-linecap="round"/></svg></button>
        <div id="new-menu-dd" style="display:none;position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid #e5e4e0;border-radius:12px;padding:6px;min-width:210px;z-index:200;box-shadow:0 8px 32px rgba(0,0,0,.12)">
          <div onclick="goManualOrder()" style="display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;transition:background .15s" onmouseover="this.style.background=\'#f6f5f4\'" onmouseout="this.style.background=\'\'"><div style="width:28px;height:28px;background:#f4f2ef;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="#374151" stroke-width="1.3"/><path d="M4 7h6M4 4.5h6M4 9.5h3" stroke="#374151" stroke-width="1.3" stroke-linecap="round"/></svg></div><div><div style="font-size:13px;font-weight:600;color:#191918" data-i18n="manual_order">Manual order</div><div style="font-size:11.5px;color:#9ca3af;margin-top:1px" data-i18n="manual_order_sub">Create from scratch</div></div></div>
          <div onclick="window.location=\'stores.html\'" style="display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;transition:background .15s" onmouseover="this.style.background=\'#f6f5f4\'" onmouseout="this.style.background=\'\'"><div style="width:28px;height:28px;background:#f4f2ef;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" stroke="#374151" stroke-width="1.3"/><path d="M1.5 7h11M7 1.5S5 4 5 7s2 5.5 2 5.5" stroke="#374151" stroke-width="1.3" stroke-linecap="round"/></svg></div><div><div style="font-size:13px;font-weight:600;color:#191918" data-i18n="sync_platforms">Sync from platforms</div><div style="font-size:11.5px;color:#9ca3af;margin-top:1px" data-i18n="sync_platforms_sub">Shopify, Etsy, WooCommerce…</div></div></div>
        </div>
      </div>
      <div style="width:1px;height:20px;background:#e5e4e0;margin:0 3px"></div>
      <!-- Profile -->
      <div class="ibtn" style="cursor:pointer" onclick="window.location=\'settings.html\'"><div style="width:28px;height:28px;border-radius:50%;background:#111827;color:#d4a017;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">P</div><div><div style="font-size:13px;font-weight:600;color:#191918;line-height:1.2">Phan</div><div style="font-size:11px;color:#9ca3af;line-height:1.2">phanmylinh04…</div></div></div>
      <!-- Language toggle -->
      <button id="lang-btn" onclick="toggleLang()" style="font-size:11.5px;font-weight:700;color:#6b7280;background:none;border:1.5px solid #e5e4e0;border-radius:7px;padding:4px 9px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap" onmouseover="this.style.borderColor=\'#374151\';this.style.color=\'#191918\'" onmouseout="this.style.borderColor=\'#e5e4e0\';this.style.color=\'#6b7280\'">EN</button>
    </div>
  </header>'''

BROKEN_RIGHT_PAT = re.compile(
    r'<div style="margin-left:auto;display:flex;align-items:center;gap:[^"]*">.*?</header>',
    re.DOTALL
)

HEADER_FILES = ['fulfillment.html', 'settings.html', 'design-lab.html']

for fname in HEADER_FILES:
    path = os.path.join(BASE, fname)
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()
    if BROKEN_RIGHT_PAT.search(html):
        html = BROKEN_RIGHT_PAT.sub(CORRECT_RIGHT, html, count=1)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'  ✓ header fixed: {fname}')
    else:
        print(f'  ~ no match: {fname}')

# ── Dashboard: soften wcard (stat card) background ──────────────────────
dashboard_path = os.path.join(BASE, 'dashboard.html')
with open(dashboard_path, 'r', encoding='utf-8') as f:
    html = f.read()

# Change .wcard background from #fff to warm near-white #f8f7f5
html = html.replace(
    '.wcard{background:#fff;border:1px solid #e5e4e0;',
    '.wcard{background:#f8f7f5;border:1px solid #e8e6e2;'
)
# Also update dark mode wcard override so JS sweep still works (keep #fff for sweep to catch)
# Add explicit dark mode wcard rule
if 'html[data-theme=dark] .wcard{' not in html:
    html = html.replace(
        'html[data-theme=dark] .stat-card{background:#252220!important;border-color:#302e2c!important}',
        'html[data-theme=dark] .wcard{background:#252220!important;border-color:#302e2c!important}\nhtml[data-theme=dark] .stat-card{background:#252220!important;border-color:#302e2c!important}'
    )

with open(dashboard_path, 'w', encoding='utf-8') as f:
    f.write(html)
print('  ✓ wcard softened: dashboard.html')

print('Done.')

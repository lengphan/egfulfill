#!/usr/bin/env python3
import re, os

BASE = '/Users/linhphan/Downloads/.claude'
FILES = ['dashboard.html','orders.html','products-dash.html','wallet.html',
         'stores.html','fulfillment.html','analytics.html','settings.html',
         'design-lab.html','chat.html','apidocs.html']

# Fixed dark mode CSS — no backslash-quote issue
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

def fix(fname):
    path = os.path.join(BASE, fname)
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()
    # Remove old dark CSS block
    html = re.sub(r'\n/\* ── Dark mode ── \*/.*?html\[data-theme=dark\] #_qtm>div\{background:#1c1c1c!important;border:1\.5px solid #252525\}', '', html, flags=re.DOTALL)
    # Inject fresh clean version before </style>
    html = html.replace('</style>', DARK_CSS + '</style>', 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'  ✓ {fname}')

print('Fixing dark CSS...')
for f in FILES:
    try:
        fix(f)
    except Exception as e:
        print(f'  ✗ {f}: {e}')
print('Done.')

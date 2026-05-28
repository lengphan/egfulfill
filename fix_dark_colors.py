#!/usr/bin/env python3
import re, os

BASE = '/Users/linhphan/Downloads/.claude'
FILES = ['dashboard.html','orders.html','products-dash.html','wallet.html',
         'stores.html','fulfillment.html','analytics.html','settings.html',
         'design-lab.html','chat.html','apidocs.html','warehouse.html']

# Updated dark CSS — warmer charcoal with subtle blue tint (like the reference)
DARK_CSS = '''
/* ── Dark mode ── */
html[data-theme=dark]{color-scheme:dark}
html[data-theme=dark] body{background:#191926!important}
html[data-theme=dark] .sidebar{background:#1e1e2e!important;border-right-color:#2e2e42!important}
html[data-theme=dark] header{background:#1e1e2e!important;border-bottom-color:#2e2e42!important}
html[data-theme=dark] .card{background:#252538!important;border-color:#2e2e42!important}
html[data-theme=dark] .ni{color:#8888aa!important}
html[data-theme=dark] .ni.on{background:#2e2e44!important;color:#f0f0f8!important}
html[data-theme=dark] .ni:hover:not(.on){background:#252538!important}
html[data-theme=dark] .ibtn{color:#8888aa!important}
html[data-theme=dark] .ibtn:hover{background:#2e2e44!important;color:#e0e0ee!important}
html[data-theme=dark] .dtable th{background:#1e1e2e!important;color:#55556e!important;border-color:#2e2e42!important}
html[data-theme=dark] .dtable td{border-color:#262636!important}
html[data-theme=dark] .dtable tbody tr:hover td{background:#252538!important}
html[data-theme=dark] input:not([type=checkbox]):not([type=radio]),html[data-theme=dark] select,html[data-theme=dark] textarea{background:#252538!important;border-color:#2e2e44!important;color:#e0e0ee!important}
html[data-theme=dark] #pref-panel,html[data-theme=dark] #new-menu-dd{background:#252538!important;border-color:#2e2e44!important;box-shadow:0 8px 28px rgba(0,0,0,.55)!important}
html[data-theme=dark] [style*="background:#fff;"]{background:#252538!important}
html[data-theme=dark] [style*="background: #fff"]{background:#252538!important}
html[data-theme=dark] [style*="background:#f4f2ef"]{background:#191926!important}
html[data-theme=dark] [style*="background:#f6f5f4"]{background:#21213a!important}
html[data-theme=dark] [style*="background:#f9f8f7"]{background:#21213a!important}
html[data-theme=dark] [style*="background:#f3f3f1"]{background:#21213a!important}
html[data-theme=dark] [style*="background:#f0ede9"]{background:#21213a!important}
html[data-theme=dark] [style*="background:#fafaf9"]{background:#1e1e2e!important}
html[data-theme=dark] [style*="background:#e5e4e0"]{background:#2e2e42!important}
html[data-theme=dark] [style*="background:#fffbeb"]{background:#1e1a06!important}
html[data-theme=dark] [style*="background:#fff5f5"]{background:#25100e!important}
html[data-theme=dark] [style*="background:#fee2e2"]{background:#2a0e0e!important}
html[data-theme=dark] [style*="color:#191918"]{color:#e8e8f2!important}
html[data-theme=dark] [style*="color:#111827"]{color:#f0f0f8!important}
html[data-theme=dark] [style*="color:#374151"]{color:#aaaac0!important}
html[data-theme=dark] [style*="color:#1f2937"]{color:#c4c4d8!important}
html[data-theme=dark] [style*="border-bottom:1px solid #f0ede9"]{border-bottom-color:#2a2a3e!important}
html[data-theme=dark] [style*="border-top:1px solid #f0ede9"]{border-top-color:#2a2a3e!important}
html[data-theme=dark] [style*="border:1px solid #e5e4e0"]{border-color:#2e2e42!important}
html[data-theme=dark] [style*="border:1.5px solid #e5e4e0"]{border-color:#2e2e44!important}
html[data-theme=dark] [style*="border-bottom:1px solid #e5e4e0"]{border-bottom-color:#2e2e42!important}
html[data-theme=dark] [style*="border-top:1px solid #e5e4e0"]{border-top-color:#2e2e42!important}
html[data-theme=dark] [style*="border-right:1px solid #e5e4e0"]{border-right-color:#2e2e42!important}
html[data-theme=dark] .modal-overlay{background:rgba(0,0,10,.75)!important}
html[data-theme=dark] .stat-card{background:#252538!important;border-color:#2e2e42!important}
html[data-theme=dark] .prog-bar{background:#2e2e42!important}
html[data-theme=dark] #_qtm>div{background:#252538!important;border:1.5px solid #2e2e44}
'''

def fix(fname):
    path = os.path.join(BASE, fname)
    if not os.path.exists(path):
        print(f'  ~ missing: {fname}')
        return
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()
    # Remove old dark CSS block
    html = re.sub(r'\n/\* ── Dark mode ── \*/.*?html\[data-theme=dark\] #_qtm>div\{[^}]+\}', '', html, flags=re.DOTALL)
    # Inject fresh version before first </style>
    html = html.replace('</style>', DARK_CSS + '</style>', 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'  ✓ {fname}')

print('Updating dark mode colors...')
for f in FILES:
    fix(f)
print('Done.')

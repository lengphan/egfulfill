#!/usr/bin/env python3
import re, os

BASE = '/Users/linhphan/Downloads/.claude'
FILES = ['dashboard.html','orders.html','products-dash.html','wallet.html',
         'stores.html','fulfillment.html','analytics.html','settings.html',
         'design-lab.html','chat.html','apidocs.html','warehouse.html']

# Warm dark palette — true inverse of the light mode's warm neutrals
# Light:  bg #f4f2ef  card #fff   border #e5e4e0  text #191918  secondary #374151  muted #9ca3af
# Dark:   bg #1a1917  card #252220 border #302e2c  text #e0deda  secondary #a8a29e  muted #6a6866
DARK_CSS = '''
/* ── Dark mode ── */
html[data-theme=dark]{color-scheme:dark}
html[data-theme=dark] body{background:#1a1917!important}
html[data-theme=dark] .sidebar{background:#1f1d1b!important;border-right-color:#302e2c!important}
html[data-theme=dark] header{background:#1f1d1b!important;border-bottom-color:#302e2c!important}
html[data-theme=dark] .card{background:#252220!important;border-color:#302e2c!important}
html[data-theme=dark] .ni{color:#7a7874!important}
html[data-theme=dark] .ni.on{background:#302e2c!important;color:#e8e4e0!important}
html[data-theme=dark] .ni:hover:not(.on){background:#252220!important}
html[data-theme=dark] .ibtn{color:#7a7874!important}
html[data-theme=dark] .ibtn:hover{background:#302e2c!important;color:#d8d4d0!important}
html[data-theme=dark] .dtable th{background:#1f1d1b!important;color:#4a4846!important;border-color:#302e2c!important}
html[data-theme=dark] .dtable td{border-color:#282624!important;color:#a8a29e!important}
html[data-theme=dark] .dtable tbody tr:hover td{background:#252220!important}
html[data-theme=dark] input:not([type=checkbox]):not([type=radio]),html[data-theme=dark] select,html[data-theme=dark] textarea{background:#252220!important;border-color:#302e2c!important;color:#d8d4d0!important}
html[data-theme=dark] #pref-panel,html[data-theme=dark] #new-menu-dd{background:#252220!important;border-color:#302e2c!important;box-shadow:0 8px 28px rgba(0,0,0,.5)!important}
html[data-theme=dark] [style*="background:#fff;"]{background:#252220!important}
html[data-theme=dark] [style*="background: #fff"]{background:#252220!important}
html[data-theme=dark] [style*="background:#f4f2ef"]{background:#1a1917!important}
html[data-theme=dark] [style*="background:#f6f5f4"]{background:#211f1d!important}
html[data-theme=dark] [style*="background:#f9f8f7"]{background:#211f1d!important}
html[data-theme=dark] [style*="background:#f3f3f1"]{background:#211f1d!important}
html[data-theme=dark] [style*="background:#f0ede9"]{background:#211f1d!important}
html[data-theme=dark] [style*="background:#fafaf9"]{background:#1f1d1b!important}
html[data-theme=dark] [style*="background:#e5e4e0"]{background:#302e2c!important}
html[data-theme=dark] [style*="background:#fffbeb"]{background:#211900!important}
html[data-theme=dark] [style*="background:#fff5f5"]{background:#251210!important}
html[data-theme=dark] [style*="background:#fee2e2"]{background:#2a0e0c!important}
html[data-theme=dark] [style*="color:#191918"]{color:#d8d4d0!important}
html[data-theme=dark] [style*="color:#111827"]{color:#e0deda!important}
html[data-theme=dark] [style*="color:#374151"]{color:#a8a29e!important}
html[data-theme=dark] [style*="color:#1f2937"]{color:#bcb8b4!important}
html[data-theme=dark] [style*="color:#9ca3af"]{color:#565452!important}
html[data-theme=dark] [style*="border-bottom:1px solid #f0ede9"]{border-bottom-color:#282624!important}
html[data-theme=dark] [style*="border-top:1px solid #f0ede9"]{border-top-color:#282624!important}
html[data-theme=dark] [style*="border:1px solid #e5e4e0"]{border-color:#302e2c!important}
html[data-theme=dark] [style*="border:1.5px solid #e5e4e0"]{border-color:#302e2c!important}
html[data-theme=dark] [style*="border-bottom:1px solid #e5e4e0"]{border-bottom-color:#302e2c!important}
html[data-theme=dark] [style*="border-top:1px solid #e5e4e0"]{border-top-color:#302e2c!important}
html[data-theme=dark] [style*="border-right:1px solid #e5e4e0"]{border-right-color:#302e2c!important}
html[data-theme=dark] .modal-overlay{background:rgba(0,0,0,.72)!important}
html[data-theme=dark] .stat-card{background:#252220!important;border-color:#302e2c!important}
html[data-theme=dark] .prog-bar{background:#302e2c!important}
html[data-theme=dark] #_qtm>div{background:#252220!important;border:1.5px solid #302e2c}
html[data-theme=dark] .seg{color:#7a7874!important}
html[data-theme=dark] .seg.on{background:#302e2c!important;color:#e0deda!important}
'''

# Updated applyTheme with JS DOM sweep to catch inline background:#fff without semicolon
NEW_APPLY_THEME = r"""function applyTheme(dark){
  document.documentElement.setAttribute('data-theme',dark?'dark':'light');
  const lbl=document.getElementById('theme-label');
  const knob=document.getElementById('toggle-knob');
  const tgl=document.getElementById('theme-toggle-btn');
  if(lbl)lbl.textContent=_t(dark?'dark_mode':'light_mode');
  if(knob)knob.style.transform=dark?'translateX(18px)':'translateX(0)';
  if(tgl)tgl.style.background=dark?'#4a4846':'#e5e4e0';
  localStorage.setItem('eg_theme',dark?'dark':'light');
  // JS sweep: catch inline background:#fff that CSS [style*] selectors miss
  const WHITE=/background\s*:\s*#fff(?![0-9a-fA-F])/;
  const LIGHTS=['background:#f4f2ef','background:#f6f5f4','background:#f9f8f7','background:#f3f3f1','background:#f0ede9','background:#fafaf9'];
  if(dark){
    document.querySelectorAll('[style]').forEach(el=>{
      const s=el.getAttribute('style');
      if(WHITE.test(s)){el.dataset._b=el.style.background||'';el.style.setProperty('background','#252220','important');if(/border/.test(s))el.style.setProperty('border-color','#302e2c','important');}
      else if(LIGHTS.some(c=>s.includes(c))){el.dataset._b=el.style.background||'';el.style.setProperty('background','#211f1d','important');}
    });
  }else{
    document.querySelectorAll('[data-_b]').forEach(el=>{el.style.removeProperty('background');el.style.removeProperty('border-color');delete el.dataset._b;});
  }
}"""

OLD_APPLY_THEME = re.compile(
    r'function applyTheme\(dark\)\{.*?localStorage\.setItem\(\'eg_theme\',dark\?\'dark\':\'light\'\);\}',
    re.DOTALL
)

def fix(fname):
    path = os.path.join(BASE, fname)
    if not os.path.exists(path):
        print(f'  ~ missing: {fname}'); return
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()
    # Replace dark CSS block
    html = re.sub(r'\n/\* ── Dark mode ── \*/.*?html\[data-theme=dark\] #_qtm>div\{[^}]+\}(?:\nhtml\[data-theme=dark\] \.seg\{[^}]+\}\nhtml\[data-theme=dark\] \.seg\.on\{[^}]+\})?', '', html, flags=re.DOTALL)
    html = html.replace('</style>', DARK_CSS + '</style>', 1)
    # Replace applyTheme function
    if OLD_APPLY_THEME.search(html):
        html = OLD_APPLY_THEME.sub(NEW_APPLY_THEME, html)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'  ✓ {fname}')

print('Applying warm dark palette + JS sweep...')
for f in FILES:
    fix(f)
print('Done.')

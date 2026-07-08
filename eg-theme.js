// eg-theme.js — universal neon-purple ACCENT + monospace-label layer for the boards.
// One source of truth: injected as a single <style> over the shared board classes so the accent is
// identical on every board and future tweaks are a one-file edit. Loaded via <script src> on each board.
// Palette locked with the login: --accent #2f4bf0 / --accent-dk #2439c8 / dark-mode --accent-lt #a78bfa.
// Fonts (mono nav, Fraunces h1, mono badges) apply in BOTH themes; accent COLOURS have a light + a dark
// variant. Base stays monotone — accent is SPARING (active nav, focus, toggles, emphasis button, links).
(function () {
  if (document.getElementById('eg-theme-accent')) return;
  var MONO = "ui-monospace,SFMono-Regular,Menlo,'Courier New',monospace";
  var css = [
    ':root{--eg-accent:#2f4bf0;--eg-accent-dk:#2439c8;--eg-accent-lt:#6d8cff;--eg-accent-tint:#e7ecfe;--eg-sep:#e8e6e1}',
    'html[data-theme=dark]{--eg-sep:rgba(201,195,186,.22)}',

    /* ── SHARP CORNERS everywhere (retro/pixelated sticky-note vibe) ─── */
    /* flatten every radius (beats inline styles via !important); functional round bits are restored below */
    '*{border-radius:0!important}',
    '.toggle{border-radius:999px!important}',
    '.toggle-thumb{border-radius:50%!important}',
    'input[type=radio]{border-radius:50%!important}',

    /* ── FONTS (both light + dark) ─────────────────────────────── */
    /* sidebar nav → monospace uppercase, smooth transition, NO box border (kills the outlined-active look) */
    /* transparent 1.5px border on EVERY nav item (active or not) → kills the outlined-active box AND
       makes row height identical across all boards (some files reserved a border, some didn't) */
    '.ni{font-family:' + MONO + '!important;text-transform:uppercase;letter-spacing:.04em;font-size:12px!important;border:1.5px solid transparent!important;transition:background-color .16s ease,color .16s ease!important}',
    /* Tavus-app sidebar: no divider line — instead a slightly DARKER warm nav bg against the brighter content
       (that tonal step is what separates them, Tavus-style), plus smaller/lighter nav icons. */
    '.sidebar{border-right-width:0!important}',
    'html:not([data-theme=dark]) .sidebar{background:#f1eee7!important}',
    'html:not([data-theme=dark]) .sidebar-logo{border-bottom-color:rgba(0,0,0,.06)!important}',
    'html:not([data-theme=dark]) body{background:#faf8f4!important}',   /* brighter content ground so the nav reads darker */
    'html:not([data-theme=dark]) header{background:#faf8f4!important;border-bottom-color:rgba(0,0,0,.05)!important}',   /* header JOINS the bright content — only the sidebar is tinted (two tones, not three) */
    '.ni svg{width:15px!important;height:15px!important}',
    '.ni.on{border:1.5px solid transparent!important}',
    /* page-title greeting → Fraunces serif (each board has one h1; inline section-title divs stay Inter) */
    "h1{font-family:'Fraunces',serif!important;font-optical-sizing:auto;letter-spacing:-.02em}",
    /* topbar page-title → Fraunces 18px/600, uniform across boards (was 16px on admin/warehouse via
       #page-title, 18px inline elsewhere, all Inter). Matches the 'Welcome back' greeting. */
    "#page-title,header>div[style*='margin-right:auto']{font-family:'Fraunces',serif!important;font-optical-sizing:auto;font-size:18px!important;font-weight:600!important;letter-spacing:-.01em!important}",
    /* status pills read in monospace, like the login's labels/eyebrows */
    '.badge,.b-new,.b-queue,.b-prod,.b-qc,.b-packed,.b-shipped{font-family:' + MONO + '!important;letter-spacing:.04em}',
    /* table headers + filter buttons → monospace (Tavus table language) */
    '.dtable th{font-family:' + MONO + '!important}',
    '.fb{font-family:' + MONO + '!important;letter-spacing:.04em}',
    /* unify EVERY other filter/menu control to the same monospace as the .fb filters (audit found these
       rendering in default Inter sans, so filter fonts looked mismatched board-to-board):
       .eg-sel-btn = wallet's enhanced-select buttons (All Banks / This Month); .seg = analytics
       Revenue|Orders|Profit segment; select[data-eg-select] = analytics native period/store pickers;
       .cat-pill / .sort-select = products catalog filters; .tab-sm = wallet tx All|Deposits|Charges. */
    '.eg-sel-btn,.seg,.cat-pill,.sort-select,.tab-sm,.tab-btn,.tab-flag,.chat-tab,.filter-section-title,select[data-eg-select],#trend-period,#cat-sort{font-family:' + MONO + '!important;letter-spacing:.04em}',
    /* settings sub-nav (seller .stab / admin .fstab) → mono, ACCENT active state (kills the boxed-active look) */
    '.stab,.fstab{font-family:' + MONO + '!important;text-transform:uppercase;letter-spacing:.04em;font-size:12.5px!important}',
    'html:not([data-theme=dark]) .stab.on,html:not([data-theme=dark]) .fstab.on{background:var(--eg-accent-tint)!important;color:#2439c8!important;border-color:transparent!important}',
    'html[data-theme=dark] .stab.on,html[data-theme=dark] .fstab.on{background:rgba(47,75,240,.17)!important;color:var(--eg-accent-lt)!important;border-color:transparent!important}',
    /* settings form labels → monospace uppercase, like the login field labels */
    '[id^=panel-] label,[id^=afpanel-] label,[id^=wfpanel-] label,[id^=ofpanel-] label{font-family:' + MONO + '!important;text-transform:uppercase;letter-spacing:.04em;font-size:11px}',

    /* ── Tavus DETAIL UTILITIES (opt-in classes — additive, touch nothing until used) ── */
    /* .eg-tag — bordered mono pill (version/status), e.g. <span class="eg-tag">v1.0.0</span> */
    '.eg-tag{display:inline-flex;align-items:center;font-family:' + MONO + '!important;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#191918;background:#fff;border:1.5px solid #191918;padding:2px 8px;line-height:1.5}',
    /* Tavus colored category pills (RENDERING amber / PERCEPTION green / DIALOGUE pink): keep the .eg-tag
       black border + mono uppercase, just swap the fill. Additive — <span class="eg-tag eg-tag-green">…</span> */
    '.eg-tag-amber{background:#fde68a!important}',
    '.eg-tag-green{background:#a7f3d0!important}',
    '.eg-tag-pink{background:#fbcfe8!important}',
    '.eg-tag-violet{background:#e3d9ff!important}',
    '.eg-tag-blue{background:#bfdbfe!important}',
    /* .eg-title-mono — mono/pixelated display title, e.g. <h1 class="eg-title-mono">Trivia Master</h1> */
    '.eg-title-mono{font-family:' + MONO + '!important;font-weight:700;letter-spacing:-.01em;color:#191918}',
    /* .eg-meta — dot-separated metadata row: <div class="eg-meta"><span class="eg-meta-label">What you get</span><span class="eg-meta-item">PAL</span><span class="eg-meta-item">One-click</span></div> */
    '.eg-meta{display:flex;align-items:center;flex-wrap:wrap;font-family:' + MONO + '!important;font-size:12px;color:#6b7280}',
    '.eg-meta-label{font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;padding-right:12px;margin-right:12px;border-right:1.5px solid #e5e4e0}',
    '.eg-meta-item{font-weight:600;color:#374151}',
    '.eg-meta-item+.eg-meta-item::before{content:"·";color:#c4c3be;margin:0 8px}',
    /* Dashboard cards: LIGHT & AIRY (Tavus app style) — thin soft border + whisper shadow, not the heavy
       black offset (which read too heavy on the boards). STATIC — no hover transform so drag-reorder works. */
    'html:not([data-theme=dark]) .card,html:not([data-theme=dark]) .wcard,html:not([data-theme=dark]) .stat-card{border:1px solid #e8e5df!important;box-shadow:0 1px 2px rgba(17,24,39,.05)!important}',
    'html[data-theme=dark] .card,html[data-theme=dark] .wcard,html[data-theme=dark] .stat-card{border:1px solid #383631!important;box-shadow:0 1px 3px rgba(0,0,0,.3)!important}',
    /* ── PUBLIC / MARKETING pages (index, howitworks, about, help, seller-login, product-detail-public) ──
       they carry their own retro classes (.eg-card/.bento-card/.floating-card/.btn-retro/.section-tag) with
       ROUNDED corners + soft grey #40403d borders. Global border-radius:0 sharpens them; these rules blacken
       the borders + harden the shadows + mono the eyebrow tags so the public pages match the app boards. */
    '.eg-card,.bento-card,.floating-card{border:1.5px solid #191918!important;box-shadow:4px 4px 0 #191918!important}',
    'html:not([data-theme=dark]) .btn-retro{background:var(--eg-accent)!important;color:#fff!important;border:1.5px solid #191918!important;box-shadow:3px 3px 0 #191918!important}',
    '.btn-retro-ghost{border:1.5px solid #191918!important;box-shadow:3px 3px 0 #191918!important;color:#191918!important}',
    '.section-tag{font-family:' + MONO + '!important;text-transform:uppercase;letter-spacing:.04em;font-weight:700!important;border:1.5px solid #191918!important;background:#fff!important;color:#191918!important}',
    /* Tavus card header = [colored dot] + title + separator line under it. The dot must sit INLINE before
       each card's title and a divider must attach under that title row — impossible with pure CSS across
       the varied inline-styled cards, so a deferred enhancer (end of file) injects them per card. This
       styles the injected dot; the separator uses --eg-sep. Dot colours are assigned by the enhancer. */
    '.eg-card-dot{display:inline-block;width:9px;height:9px;flex-shrink:0;background:var(--eg-accent)}',
    /* filter dropdowns go BORDERLESS to match the clean orders.html filter row (no box outline), keeping
       their chevron. Pairs with the monospace rule above so every board's filters read identically. */
    '.sort-select,#cat-sort,#trend-period,select[data-eg-select],.eg-sel-btn{border:none!important;background-color:transparent!important;box-shadow:none!important}',
    /* neo-brutalist PRESS-DOWN primary buttons (Tavus CVI / login CTA): hard offset shadow at rest,
       presses into it on hover, fully seated on click */
    /* secondary/outlined buttons stay FLAT (no drop shadow) */
    '.btn-out,.btn-green,.btn-amber,.btn-blue{box-shadow:none!important;transform:none!important;transition:background .12s ease,border-color .12s ease,opacity .12s ease!important}',

    /* ── LIGHT-MODE ACCENT ─────────────────────────────────────── */
    'html:not([data-theme=dark]) .ni:hover:not(.on){background:#efeee9!important;color:#191918!important}',
    /* border MUST be set at THIS scoped specificity — each board carries its own
       `html:not([data-theme=dark]) .ni.on{border:1px solid #191918!important}` that outranks a bare .ni.on */
    'html:not([data-theme=dark]) .ni.on{background:var(--eg-accent-tint)!important;color:#2439c8!important;border:1.5px solid transparent!important}',
    'html:not([data-theme=dark]) .ni.on svg{color:#2439c8!important;opacity:1!important}',
    'html:not([data-theme=dark]) .btn-dk,html:not([data-theme=dark]) .btn-gold{background:var(--eg-accent)!important;color:#fff!important;border:1.5px solid #191918!important;box-shadow:3px 3px 0 #191918!important;transition:transform .09s ease,box-shadow .09s ease!important}',
    'html:not([data-theme=dark]) .btn-dk:hover,html:not([data-theme=dark]) .btn-gold:hover{background:var(--eg-accent-dk)!important;transform:translate(1px,1px)!important;box-shadow:2px 2px 0 #191918!important}',
    'html:not([data-theme=dark]) .btn-dk:active,html:not([data-theme=dark]) .btn-gold:active{transform:translate(3px,3px)!important;box-shadow:0 0 0 #191918!important}',
    'html:not([data-theme=dark]) .btn-dk svg [stroke="white"]{stroke:#fff!important}',
    'html:not([data-theme=dark]) .btn-gold svg [stroke="white"]{stroke:#fff!important}',
    'html:not([data-theme=dark]) .input:focus,html:not([data-theme=dark]) .select:focus,html:not([data-theme=dark]) input:focus,html:not([data-theme=dark]) textarea:focus,html:not([data-theme=dark]) select:focus{border-color:var(--eg-accent)!important;box-shadow:0 0 0 3px var(--eg-accent-tint)!important}',
    'html:not([data-theme=dark]) .toggle-on,html:not([data-theme=dark]) .toggle.toggle-on{background:var(--eg-accent)!important}',
    'html:not([data-theme=dark]) input[type=checkbox],html:not([data-theme=dark]) input[type=radio],html:not([data-theme=dark]) input[type=range]{accent-color:var(--eg-accent)}',
    'html:not([data-theme=dark]) .eg-link,html:not([data-theme=dark]) a.accent{color:var(--eg-accent-dk)!important}',

    /* ── DARK-MODE ACCENT (lighter purple for contrast on the dark base) ── */
    'html[data-theme=dark] .ni:hover:not(.on){background:rgba(255,255,255,.05)!important;color:#f0ede6!important}',
    'html[data-theme=dark] .ni.on{background:rgba(47,75,240,.17)!important;color:var(--eg-accent-lt)!important;border:1.5px solid transparent!important}',
    'html[data-theme=dark] .ni.on svg{color:var(--eg-accent-lt)!important;opacity:1!important}',
    'html[data-theme=dark] .btn-dk,html[data-theme=dark] .btn-gold{background:var(--eg-accent)!important;color:#fff!important;border:1.5px solid #c9c3ba!important;box-shadow:3px 3px 0 #c9c3ba!important;transition:transform .09s ease,box-shadow .09s ease!important}',
    'html[data-theme=dark] .btn-dk:hover,html[data-theme=dark] .btn-gold:hover{background:var(--eg-accent-lt)!important;transform:translate(1px,1px)!important;box-shadow:2px 2px 0 #c9c3ba!important}',
    'html[data-theme=dark] .btn-dk:active,html[data-theme=dark] .btn-gold:active{transform:translate(3px,3px)!important;box-shadow:0 0 0 #c9c3ba!important}',
    'html[data-theme=dark] .input:focus,html[data-theme=dark] .select:focus,html[data-theme=dark] input:focus,html[data-theme=dark] textarea:focus,html[data-theme=dark] select:focus{border-color:var(--eg-accent-lt)!important;box-shadow:0 0 0 3px rgba(47,75,240,.22)!important}',
    'html[data-theme=dark] .toggle-on,html[data-theme=dark] .toggle.toggle-on{background:var(--eg-accent)!important}',
    'html[data-theme=dark] input[type=checkbox],html[data-theme=dark] input[type=radio],html[data-theme=dark] input[type=range]{accent-color:var(--eg-accent-lt)}',
    'html[data-theme=dark] .eg-link,html[data-theme=dark] a.accent{color:var(--eg-accent-lt)!important}',

    /* ── DARK-MODE legibility patches (audit-found holes) ─────── */
    /* seller dashboard filter buttons ("All Stores"/"This Month") — were black text on dark (invisible) */
    'html[data-theme=dark] #dash-filter-row .eg-sel-btn,html[data-theme=dark] #dash-filter-row .btn{color:#e8e4dd!important}',
    /* "New" status badge was missing its dark pill on orders.html (every sibling had it) */
    'html[data-theme=dark] .b-new{background:#4e65ce!important;color:#fff!important}'
  ].join('\n');

  // ── SELLER boards → lighter, unified "Tavus" ground (white sidebar, no beige tone) ──
  // Factory boards (factory/operator/warehouse/admin/designer) keep their current tone until the seller
  // look is signed off. Marketing pages have no `.sidebar`, so the `:has(.sidebar)` guard skips them.
  var _page = (location.pathname.split('/').pop() || '').toLowerCase();
  var _isFactory = ['factory.html', 'operator.html', 'warehouse.html', 'admin.html', 'designer.html'].indexOf(_page) !== -1;
  if (!_isFactory) {
    css += '\n' + [
      /* one BRIGHT near-white canvas (no tint, no aura) — cards are pure #fff, separated by their thin border */
      'html:not([data-theme=dark]) body:has(.sidebar){background-color:#fcfcfc!important;background-image:none!important}',
      /* header + sidebar join the light canvas (no fill, no dividers) — separation is the white cards */
      'html:not([data-theme=dark]) body:has(.sidebar) header{background:transparent!important;border-bottom:0!important}',
      /* flush, full-height WHITE sidebar (Tavus-style) — whisper right border, no beige, no heavy shadow */
      'html:not([data-theme=dark]) aside.sidebar{background:#fff!important;border-right:1px solid #efece6!important;box-shadow:none!important}',
      'html:not([data-theme=dark]) aside.sidebar .sidebar-logo{border-bottom-color:#efece6!important}',
      'html:not([data-theme=dark]) .wcard,html:not([data-theme=dark]) .card,html:not([data-theme=dark]) .ccard{background:#fff!important;border:1px solid #ecebe6!important;box-shadow:0 1px 2px rgba(17,24,39,.04)!important}',
      /* nav ICONS → outline / stroked (not solid fills) */
      'html:not([data-theme=dark]) .ni svg,html:not([data-theme=dark]) .ni svg *{fill:none!important;stroke:currentColor!important;stroke-width:1.3px!important;stroke-linecap:round!important;stroke-linejoin:round!important}',

      /* ── UNIFIED header control cluster: one quiet language, all 32px tall, sharp ── */
      /* every icon action (search · EN · theme · notifications · profile) = a uniform 32px pill */
      'html:not([data-theme=dark]) body:has(.sidebar) header .ibtn{height:32px!important;padding:0 9px!important;color:#6b7280!important;display:inline-flex!important;align-items:center!important;transition:background .14s ease,color .14s ease!important}',
      'html:not([data-theme=dark]) body:has(.sidebar) header .ibtn:hover{background:#f1eee9!important;color:#191918!important}',
      /* balance chip → same quiet 32px chip (drop the heavy dark border + offset shadow) */
      'html:not([data-theme=dark]) body:has(.sidebar) .bal-chip{height:32px!important;padding:0 13px!important;background:#fff!important;border:1px solid #e2ded7!important;box-shadow:none!important;color:#191918!important;transition:background .14s ease!important}',
      'html:not([data-theme=dark]) body:has(.sidebar) .bal-chip:hover{background:#f6f4f0!important;transform:none!important}',
      /* + New = the SINGLE accent in the cluster, matched to 32px */
      'html:not([data-theme=dark]) body:has(.sidebar) header .btn-dk{height:32px!important;padding:0 14px!important}',
      /* thin, quiet vertical dividers between control groups */
      'html:not([data-theme=dark]) body:has(.sidebar) header div[style*="width:1px"]{background:#e6e2db!important;height:20px!important}',

      /* ── clean Tavus-style list rows (orders + every seller table): airy, hairline, no header fill ── */
      'html:not([data-theme=dark]) body:has(.sidebar) .dtable th{background:#fff!important;border-bottom:1px solid #edeae4!important;color:#a8a49d!important;padding-top:13px!important;padding-bottom:11px!important}',
      'html:not([data-theme=dark]) body:has(.sidebar) .dtable td{border-bottom:1px solid #f3f1ec!important;padding-top:13px!important;padding-bottom:13px!important}',
      'html:not([data-theme=dark]) body:has(.sidebar) .dtable tr.main-row:hover td,html:not([data-theme=dark]) body:has(.sidebar) .dtable tr.main-row:hover td[data-col="actions"]{background:#faf8f4!important}',
      'html:not([data-theme=dark]) body:has(.sidebar) .dtable tr:last-child td{border-bottom:none!important}',

      /* desktop: a comfortable gutter between the sidebar and the content (airy Tavus spacing) */
      '@media(min-width:861px){body:has(.sidebar) [style*="margin-left:220px"]{margin-left:250px!important}}'
    ].join('\n');
  }

  var s = document.createElement('style');
  s.id = 'eg-theme-accent';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);

  // ── Tavus card header: inject [colored dot] before each stat card's TITLE + a separator line under that
  //    title row. Pure CSS can't target the (inline-styled, structurally varied) title, so we do it here.
  //    title = the first UPPERCASE text element in the card (the eyebrow); dot colour cycles per card. ──
  var EG_CARD_DOTS = ['#34d399', '#f472b6', '#fbbf24', '#818cf8', '#fb7185', '#a78bfa'];
  function egEnhanceCards() {
    var cards = document.querySelectorAll('.wcard,.stat-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.__egHdr) continue;
      var els = card.querySelectorAll('div,span,h1,h2,h3,h4,p'), title = null;
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (el.closest && el.closest('.drag-handle')) continue;
        var txt = (el.textContent || '').trim();
        if (!txt || txt.length > 42) continue;
        try { if (getComputedStyle(el).textTransform === 'uppercase') { title = el; break; } } catch (e) {}
      }
      if (!title) continue;
      card.__egHdr = true;
      var dot = document.createElement('span');
      dot.className = 'eg-card-dot';
      dot.style.background = EG_CARD_DOTS[i % EG_CARD_DOTS.length];
      title.style.display = 'flex';
      title.style.alignItems = 'center';
      title.style.gap = '7px';
      title.insertBefore(dot, title.firstChild);
      title.style.borderBottom = '1.5px solid var(--eg-sep)';
      title.style.paddingBottom = '9px';
      if (parseInt(getComputedStyle(title).marginBottom, 10) < 10) title.style.marginBottom = '12px';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', egEnhanceCards);
  else egEnhanceCards();
  window.addEventListener('load', egEnhanceCards);
})();

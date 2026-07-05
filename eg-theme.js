// eg-theme.js — universal neon-purple ACCENT + monospace-label layer for the boards.
// One source of truth: injected as a single <style> over the shared board classes so the accent is
// identical on every board and future tweaks are a one-file edit. Loaded via <script src> on each board.
// Palette locked with the login: --accent #8b5cf6 / --accent-dk #7c3aed / dark-mode --accent-lt #a78bfa.
// Fonts (mono nav, Fraunces h1, mono badges) apply in BOTH themes; accent COLOURS have a light + a dark
// variant. Base stays monotone — accent is SPARING (active nav, focus, toggles, emphasis button, links).
(function () {
  if (document.getElementById('eg-theme-accent')) return;
  var MONO = "ui-monospace,SFMono-Regular,Menlo,'Courier New',monospace";
  var css = [
    ':root{--eg-accent:#8b5cf6;--eg-accent-dk:#7c3aed;--eg-accent-lt:#a78bfa;--eg-accent-tint:#f3efff}',

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
    '.ni{font-family:' + MONO + '!important;text-transform:uppercase;letter-spacing:.03em;font-size:12.5px!important;border:1.5px solid transparent!important;transition:background-color .16s ease,color .16s ease!important}',
    '.ni.on{border:1.5px solid transparent!important}',
    /* page-title greeting → Fraunces serif (each board has one h1; inline section-title divs stay Inter) */
    "h1{font-family:'Fraunces',serif!important;font-optical-sizing:auto;letter-spacing:-.02em}",
    /* topbar page-title → Fraunces 18px/600, uniform across boards (was 16px on admin/warehouse via
       #page-title, 18px inline elsewhere, all Inter). Matches the 'Welcome back' greeting. */
    "#page-title,header>div[style*='margin-right:auto']{font-family:'Fraunces',serif!important;font-optical-sizing:auto;font-size:18px!important;font-weight:600!important;letter-spacing:-.01em!important}",
    /* status pills read in monospace, like the login's labels/eyebrows */
    '.badge,.b-new,.b-queue,.b-prod,.b-qc,.b-packed,.b-shipped{font-family:' + MONO + '!important;letter-spacing:.02em}',
    /* table headers + filter buttons → monospace (Tavus table language) */
    '.dtable th{font-family:' + MONO + '!important}',
    '.fb{font-family:' + MONO + '!important;letter-spacing:.02em}',
    /* settings sub-nav (seller .stab / admin .fstab) → mono, ACCENT active state (kills the boxed-active look) */
    '.stab,.fstab{font-family:' + MONO + '!important;text-transform:uppercase;letter-spacing:.03em;font-size:12.5px!important}',
    'html:not([data-theme=dark]) .stab.on,html:not([data-theme=dark]) .fstab.on{background:var(--eg-accent-tint)!important;color:#7c3aed!important;border-color:transparent!important}',
    'html[data-theme=dark] .stab.on,html[data-theme=dark] .fstab.on{background:rgba(139,92,246,.17)!important;color:var(--eg-accent-lt)!important;border-color:transparent!important}',
    /* settings form labels → monospace uppercase, like the login field labels */
    '[id^=panel-] label,[id^=afpanel-] label,[id^=wfpanel-] label,[id^=ofpanel-] label{font-family:' + MONO + '!important;text-transform:uppercase;letter-spacing:.04em;font-size:11px}',

    /* ── Tavus DETAIL UTILITIES (opt-in classes — additive, touch nothing until used) ── */
    /* .eg-tag — bordered mono pill (version/status), e.g. <span class="eg-tag">v1.0.0</span> */
    '.eg-tag{display:inline-flex;align-items:center;font-family:' + MONO + '!important;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#191918;background:#fff;border:1.5px solid #191918;padding:2px 8px;line-height:1.5}',
    /* .eg-title-mono — mono/pixelated display title, e.g. <h1 class="eg-title-mono">Trivia Master</h1> */
    '.eg-title-mono{font-family:' + MONO + '!important;font-weight:700;letter-spacing:-.01em;color:#191918}',
    /* .eg-meta — dot-separated metadata row: <div class="eg-meta"><span class="eg-meta-label">What you get</span><span class="eg-meta-item">PAL</span><span class="eg-meta-item">One-click</span></div> */
    '.eg-meta{display:flex;align-items:center;flex-wrap:wrap;font-family:' + MONO + '!important;font-size:12px;color:#6b7280}',
    '.eg-meta-label{font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;padding-right:12px;margin-right:12px;border-right:1.5px solid #e5e4e0}',
    '.eg-meta-item{font-weight:600;color:#374151}',
    '.eg-meta-item+.eg-meta-item::before{content:"·";color:#c4c3be;margin:0 8px}',
    /* CARTOON-RETRO stat cards (user pick B): bold ink border + hard 4px offset shadow, STATIC —
       no hover transform so drag-to-reorder still works. Dark mode uses the light retro ink (#c9c3ba). */
    'html:not([data-theme=dark]) .card,html:not([data-theme=dark]) .wcard,html:not([data-theme=dark]) .stat-card{border:1.5px solid #191918!important;box-shadow:4px 4px 0 #191918!important}',
    'html[data-theme=dark] .card,html[data-theme=dark] .wcard,html[data-theme=dark] .stat-card{border:1.5px solid #c9c3ba!important;box-shadow:4px 4px 0 #c9c3ba!important}',
    /* neo-brutalist PRESS-DOWN primary buttons (Tavus CVI / login CTA): hard offset shadow at rest,
       presses into it on hover, fully seated on click */
    '.btn-dk,.btn-out,.btn-gold,.btn-green,.btn-amber,.btn-blue{border:1.5px solid #191918!important;box-shadow:3px 3px 0 #191918!important;transition:transform .09s ease,box-shadow .09s ease!important}',
    '.btn-dk:hover,.btn-out:hover,.btn-gold:hover,.btn-green:hover,.btn-amber:hover,.btn-blue:hover{transform:translate(1px,1px)!important;box-shadow:2px 2px 0 #191918!important}',
    '.btn-dk:active,.btn-out:active,.btn-gold:active,.btn-green:active,.btn-amber:active,.btn-blue:active{transform:translate(3px,3px)!important;box-shadow:0 0 0 #191918!important}',

    /* ── LIGHT-MODE ACCENT ─────────────────────────────────────── */
    'html:not([data-theme=dark]) .ni:hover:not(.on){background:#efeee9!important;color:#191918!important}',
    /* border MUST be set at THIS scoped specificity — each board carries its own
       `html:not([data-theme=dark]) .ni.on{border:1px solid #191918!important}` that outranks a bare .ni.on */
    'html:not([data-theme=dark]) .ni.on{background:var(--eg-accent-tint)!important;color:#7c3aed!important;border:1.5px solid transparent!important}',
    'html:not([data-theme=dark]) .ni.on svg{color:#7c3aed!important;opacity:1!important}',
    'html:not([data-theme=dark]) .btn-gold{background:var(--eg-accent)!important;border-color:var(--eg-accent)!important;color:#fff!important}',
    'html:not([data-theme=dark]) .btn-gold:hover{background:var(--eg-accent-dk)!important;border-color:var(--eg-accent-dk)!important}',
    'html:not([data-theme=dark]) .btn-gold svg [stroke="white"]{stroke:#fff!important}',
    'html:not([data-theme=dark]) .input:focus,html:not([data-theme=dark]) .select:focus,html:not([data-theme=dark]) input:focus,html:not([data-theme=dark]) textarea:focus,html:not([data-theme=dark]) select:focus{border-color:var(--eg-accent)!important;box-shadow:0 0 0 3px var(--eg-accent-tint)!important}',
    'html:not([data-theme=dark]) .toggle-on,html:not([data-theme=dark]) .toggle.toggle-on{background:var(--eg-accent)!important}',
    'html:not([data-theme=dark]) input[type=checkbox],html:not([data-theme=dark]) input[type=radio],html:not([data-theme=dark]) input[type=range]{accent-color:var(--eg-accent)}',
    'html:not([data-theme=dark]) .eg-link,html:not([data-theme=dark]) a.accent{color:var(--eg-accent-dk)!important}',

    /* ── DARK-MODE ACCENT (lighter purple for contrast on the dark base) ── */
    'html[data-theme=dark] .ni:hover:not(.on){background:rgba(255,255,255,.05)!important;color:#f0ede6!important}',
    'html[data-theme=dark] .ni.on{background:rgba(139,92,246,.17)!important;color:var(--eg-accent-lt)!important;border:1.5px solid transparent!important}',
    'html[data-theme=dark] .ni.on svg{color:var(--eg-accent-lt)!important;opacity:1!important}',
    'html[data-theme=dark] .btn-gold{background:var(--eg-accent)!important;border-color:var(--eg-accent)!important;color:#fff!important}',
    'html[data-theme=dark] .btn-gold:hover{background:var(--eg-accent-lt)!important;border-color:var(--eg-accent-lt)!important}',
    'html[data-theme=dark] .input:focus,html[data-theme=dark] .select:focus,html[data-theme=dark] input:focus,html[data-theme=dark] textarea:focus,html[data-theme=dark] select:focus{border-color:var(--eg-accent-lt)!important;box-shadow:0 0 0 3px rgba(139,92,246,.22)!important}',
    'html[data-theme=dark] .toggle-on,html[data-theme=dark] .toggle.toggle-on{background:var(--eg-accent)!important}',
    'html[data-theme=dark] input[type=checkbox],html[data-theme=dark] input[type=radio],html[data-theme=dark] input[type=range]{accent-color:var(--eg-accent-lt)}',
    'html[data-theme=dark] .eg-link,html[data-theme=dark] a.accent{color:var(--eg-accent-lt)!important}',

    /* ── DARK-MODE legibility patches (audit-found holes) ─────── */
    /* seller dashboard filter buttons ("All Stores"/"This Month") — were black text on dark (invisible) */
    'html[data-theme=dark] #dash-filter-row .eg-sel-btn,html[data-theme=dark] #dash-filter-row .btn{color:#e8e4dd!important}',
    /* "New" status badge was missing its dark pill on orders.html (every sibling had it) */
    'html[data-theme=dark] .b-new{background:#4e65ce!important;color:#fff!important}'
  ].join('\n');
  var s = document.createElement('style');
  s.id = 'eg-theme-accent';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
})();

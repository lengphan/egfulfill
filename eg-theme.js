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

    /* ── FONTS (both light + dark) ─────────────────────────────── */
    /* sidebar nav → monospace uppercase, smooth transition, NO box border (kills the outlined-active look) */
    /* transparent 1.5px border on EVERY nav item (active or not) → kills the outlined-active box AND
       makes row height identical across all boards (some files reserved a border, some didn't) */
    '.ni{font-family:' + MONO + '!important;text-transform:uppercase;letter-spacing:.03em;font-size:12.5px;border:1.5px solid transparent!important;transition:background-color .16s ease,color .16s ease!important}',
    '.ni.on{border:1.5px solid transparent!important}',
    /* page-title greeting → Fraunces serif (each board has one h1; inline section-title divs stay Inter) */
    "h1{font-family:'Fraunces',serif!important;font-optical-sizing:auto;letter-spacing:-.02em}",
    /* status pills read in monospace, like the login's labels/eyebrows */
    '.badge,.b-new,.b-queue,.b-prod,.b-qc,.b-packed,.b-shipped{font-family:' + MONO + '!important;letter-spacing:.02em}',

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

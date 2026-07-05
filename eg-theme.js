// eg-theme.js — universal neon-purple ACCENT + monospace-label layer for the boards.
// One source of truth: injected as a single <style> over the shared board classes so the accent is
// identical on every board and future tweaks are a one-file edit. Loaded via <script src> on each board.
// Palette locked with the login: --accent #8b5cf6 / --accent-dk #7c3aed on a monotone beige base.
// NB: the base stays monotone — accent is SPARING (active nav, focus, toggles, emphasis button, links,
// active tabs). Primary dark buttons (.btn-dk) intentionally stay dark so busy boards don't go purple.
(function () {
  if (document.getElementById('eg-theme-accent')) return;
  var css = [
    ':root{--eg-accent:#8b5cf6;--eg-accent-dk:#7c3aed;--eg-accent-tint:#f3efff}',

    /* ── ACCENT ─────────────────────────────────────────────── */
    /* active sidebar nav — purple tint background + purple text/icon (always-visible accent) */
    'html:not([data-theme=dark]) .ni.on{background:var(--eg-accent-tint)!important;color:#7c3aed!important}',
    'html:not([data-theme=dark]) .ni.on svg{color:#7c3aed!important;opacity:1!important}',
    /* the "gold" UI button becomes the accent (gold survives only as a garment/thread PRODUCT colour) */
    'html:not([data-theme=dark]) .btn-gold{background:var(--eg-accent)!important;border-color:var(--eg-accent)!important;color:#fff!important}',
    'html:not([data-theme=dark]) .btn-gold:hover{background:var(--eg-accent-dk)!important;border-color:var(--eg-accent-dk)!important}',
    'html:not([data-theme=dark]) .btn-gold svg [stroke="white"]{stroke:#fff!important}',
    /* focus rings on inputs/selects/textareas → accent */
    'html:not([data-theme=dark]) .input:focus,html:not([data-theme=dark]) .select:focus,html:not([data-theme=dark]) input:focus,html:not([data-theme=dark]) textarea:focus,html:not([data-theme=dark]) select:focus{border-color:var(--eg-accent)!important;box-shadow:0 0 0 3px var(--eg-accent-tint)!important}',
    /* toggles / switches (on) → accent */
    'html:not([data-theme=dark]) .toggle-on,html:not([data-theme=dark]) .toggle.toggle-on{background:var(--eg-accent)!important}',
    /* checkboxes / radios / range → accent */
    'html:not([data-theme=dark]) input[type=checkbox],html:not([data-theme=dark]) input[type=radio],html:not([data-theme=dark]) input[type=range]{accent-color:var(--eg-accent)}',
    /* text-link accent (opt-in class) */
    'html:not([data-theme=dark]) .eg-link,html:not([data-theme=dark]) a.accent{color:var(--eg-accent-dk)!important}',

    /* ── FONTS (uniform with the login) ─────────────────────── */
    /* page-title greeting → Fraunces serif, like the login's display heading (each board has one h1;
       the 393 inline section-title divs stay Inter so dense panels remain readable) */
    "h1{font-family:'Fraunces',serif!important;font-optical-sizing:auto;letter-spacing:-.02em}",
    /* status pills + form labels read in monospace, like the login's labels/eyebrows */
    ".badge,.b-new,.b-queue,.b-prod,.b-qc,.b-packed,.b-shipped{font-family:ui-monospace,SFMono-Regular,Menlo,'Courier New',monospace!important;letter-spacing:.02em}"
  ].join('\n');
  var s = document.createElement('style');
  s.id = 'eg-theme-accent';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
})();

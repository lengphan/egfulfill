/* ============================================================================
   eg-kb-cards.js — Shared kanban-card behaviours for all factory/designer boards
   ----------------------------------------------------------------------------
   One module, included on every board (operator/admin/warehouse/designer/
   design-board). Auto-detects the board's card system by the column-body id:
     • "udb-col-<id>"  → UDB system (UDB_CARDS, udbRenderBoard, …)
     • "col-body-<id>" → DB  system (DB_CARDS, dbRender, …)

   Provides, without editing each board's render:
     1. Drag desktop files onto a column → creates a card (image read as a
        data: URL so the preview shows the actual upload and persists), with a
        generated design ID.
     2. A delete (×) button on every card (injected via MutationObserver).
     3. A compact column min-height (removes the empty space below "+ Add card").

   Pages that already define udb/db helpers (e.g. operator) keep theirs — this
   only fills in what's missing (|| guards) and adds the universal UI bits.
   ========================================================================== */
(function () {
  if (window.__egKbCardsLoaded) return;
  window.__egKbCardsLoaded = true;

  var IMG_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
  function fsize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB'; }
  function baseName(n) { return (n || 'Untitled').replace(/\.[^.]+$/, '') || 'Untitled design'; }

  /* ── UDB system (operator/admin/warehouse) ── */
  function udbAddCardsFromFiles(files, colId) {
    var arr = [].slice.call(files || []);
    if (!arr.length || typeof UDB_CARDS === 'undefined') return;
    var nextId = UDB_CARDS.length ? Math.max.apply(null, UDB_CARDS.map(function (x) { return x.id; })) : 0;
    arr.forEach(function (f) {
      nextId += 1;
      var id = nextId, isImg = IMG_RE.test(f.name || '');
      var card = {
        id: id, col: colId, designId: 'DSN-' + String(1000 + id),
        title: baseName(f.name), order: '', product: '', type: 'DTG', priority: 'normal', due: '',
        assignee: null, thumb: null, specs: {}, files: [{ name: f.name, size: fsize(f.size) }],
        history: [{ ts: (typeof udbNow === 'function' ? udbNow() : ''), by: 'You', role: (typeof UDB_ROLE !== 'undefined' ? UDB_ROLE : 'factory'), action: 'Card created', detail: 'Dropped file: ' + f.name }],
        checklist: []
      };
      UDB_CARDS.unshift(card);
      if (isImg) {
        var r = new FileReader();
        r.onload = function (ev) { card.thumb = ev.target.result; udbRender(); };
        r.readAsDataURL(f);
      }
    });
    udbRender();
    if (typeof udbToast === 'function') udbToast(arr.length + ' card' + (arr.length > 1 ? 's' : '') + ' added from file' + (arr.length > 1 ? 's' : ''));
  }
  function udbRender() {
    if (typeof udbUpdateStats === 'function') udbUpdateStats();
    if (typeof udbRenderBoard === 'function') udbRenderBoard();
    if (typeof udbRenderList === 'function') udbRenderList();
    if (typeof udbSave === 'function') udbSave();
  }
  function udbDeleteCard(id) {
    if (typeof UDB_CARDS === 'undefined') return;
    var idx = UDB_CARDS.findIndex(function (c) { return String(c.id) === String(id); });
    if (idx < 0) return;
    var c = UDB_CARDS[idx];
    if (!confirm('Delete this card' + (c.designId ? ' (' + c.designId + ')' : '') + '? This cannot be undone.')) return;
    UDB_CARDS.splice(idx, 1);
    udbRender();
    if (typeof udbToast === 'function') udbToast('Card deleted');
  }

  /* ── DB system (designer/design-board) ── */
  function dbAddCardsFromFiles(files, colId) {
    var arr = [].slice.call(files || []);
    if (!arr.length || typeof DB_CARDS === 'undefined') return;
    arr.forEach(function (f) {
      if (typeof _dbNextId !== 'undefined') _dbNextId++;
      var id = (typeof _dbNextId !== 'undefined') ? _dbNextId : (DB_CARDS.length ? Math.max.apply(null, DB_CARDS.map(function (x) { return x.id; })) + 1 : 1);
      var isImg = IMG_RE.test(f.name || '');
      var card = {
        id: id, col: colId, designId: 'DSN-' + String(1000 + id),
        title: baseName(f.name), order: 'FF-' + id, product: 'TBD', type: 'DTG', priority: 'normal', due: '',
        payment: 0, payStatus: 'pending', assignee: null, thumb: '', thumbnail: '',
        specs: { 'Print Area': 'TBD', 'DPI': '300', 'Bleed': '0.25in', 'Color Mode': 'RGB' },
        files: [{ name: f.name, size: fsize(f.size) }], checklist: [], notes: []
      };
      DB_CARDS.push(card);
      if (isImg) {
        var r = new FileReader();
        r.onload = function (ev) { card.thumb = ev.target.result; card.thumbnail = ev.target.result; dbRender2(); };
        r.readAsDataURL(f);
      }
    });
    dbRender2();
    if (typeof toast === 'function') toast(arr.length + ' card' + (arr.length > 1 ? 's' : '') + ' added from file' + (arr.length > 1 ? 's' : ''));
  }
  function dbRender2() {
    if (typeof dbSave === 'function') dbSave();
    if (typeof dbRender === 'function') dbRender();
  }
  function dbDeleteCard(id) {
    if (typeof DB_CARDS === 'undefined') return;
    var idx = DB_CARDS.findIndex(function (c) { return String(c.id) === String(id); });
    if (idx < 0) return;
    var c = DB_CARDS[idx];
    if (!confirm('Delete this card' + (c.designId ? ' (' + c.designId + ')' : '') + '? This cannot be undone.')) return;
    DB_CARDS.splice(idx, 1);
    dbRender2();
    if (typeof toast === 'function') toast('Card deleted');
  }

  // Fill in only what the page doesn't already define.
  if (typeof window.udbAddCardsFromFiles !== 'function') window.udbAddCardsFromFiles = udbAddCardsFromFiles;
  if (typeof window.udbDeleteCard !== 'function') window.udbDeleteCard = udbDeleteCard;
  if (typeof window.dbAddCardsFromFiles !== 'function') window.dbAddCardsFromFiles = dbAddCardsFromFiles;
  if (typeof window.dbDeleteCard !== 'function') window.dbDeleteCard = dbDeleteCard;

  function colIdOf(body) {
    return body.dataset.col || (body.id || '').replace(/^udb-col-/, '').replace(/^col-body-/, '');
  }
  function isUdbCol(body) { return (body.id || '').indexOf('udb-col-') === 0; }

  /* ── Desktop file drop → create card (capture phase beats the inline reorder handler) ── */
  document.addEventListener('dragover', function (e) {
    var dt = e.dataTransfer; if (!dt) return;
    if ([].slice.call(dt.types || []).indexOf('Files') < 0) return;
    if (e.target.closest && e.target.closest('.kb-col-body')) e.preventDefault();
  }, true);
  document.addEventListener('drop', function (e) {
    var dt = e.dataTransfer; if (!dt || !dt.files || !dt.files.length) return;
    var body = e.target.closest && e.target.closest('.kb-col-body'); if (!body) return;
    e.preventDefault(); e.stopPropagation();
    var colId = colIdOf(body);
    if (isUdbCol(body)) { (window.udbAddCardsFromFiles || udbAddCardsFromFiles)(dt.files, colId); }
    else { (window.dbAddCardsFromFiles || dbAddCardsFromFiles)(dt.files, colId); }
  }, true);

  /* ── Delete (×) button on every card + compact column + style ── */
  var st = document.createElement('style');
  st.textContent =
    '.kb-card{position:relative}' +
    '.kb-card-del{position:absolute;top:4px;right:4px;z-index:3;width:20px;height:20px;border:none;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .12s;font-family:inherit}' +
    '.kb-card:hover .kb-card-del{opacity:1}' +
    '.kb-card-del:hover{background:#dc2626}' +
    '.kb-col-body{min-height:38px}' +
    '.udb-add-card{color:#c9c3ba!important}';
  (document.head || document.documentElement).appendChild(st);

  function ensureDeleteButtons() {
    document.querySelectorAll('.kb-card').forEach(function (card) {
      if (card.querySelector('.kb-card-del')) return;
      var id = card.getAttribute('data-id');
      if (id == null) { var m = (card.id || '').match(/kb-card-(.+)$/); if (m) id = m[1]; }
      if (id == null) return;
      var btn = document.createElement('button');
      btn.className = 'kb-card-del'; btn.type = 'button'; btn.title = 'Delete card'; btn.textContent = '×';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var cid = isNaN(+id) ? id : +id;
        var colBody = card.closest('.kb-col-body');
        if (colBody && isUdbCol(colBody)) (window.udbDeleteCard || udbDeleteCard)(cid);
        else if (typeof DB_CARDS !== 'undefined' && DB_CARDS.some(function (c) { return String(c.id) === String(id); })) (window.dbDeleteCard || dbDeleteCard)(cid);
        else (window.udbDeleteCard || udbDeleteCard)(cid);
      });
      card.appendChild(btn);
    });
  }
  var pending = false;
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; ensureDeleteButtons(); }); }
  if (document.body) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  setTimeout(ensureDeleteButtons, 400);
  document.addEventListener('DOMContentLoaded', function () { setTimeout(ensureDeleteButtons, 400); });
})();

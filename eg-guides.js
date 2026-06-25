/* eg-guides.js — shared POPUP modals for File Guidelines + Size Guide.
 *
 * Self-contained: injects its own overlay markup on first open, so any page can call
 *   EGGuides.openFile()                  → general file/artwork guidelines
 *   EGGuides.openSize(optionalProductId) → size charts, one tab per catalog product
 * Both are editable by staff (any non-seller role) and persisted to localStorage:
 *   eg_file_guidelines   eg_size_guides
 * No build step, no dependencies beyond EGStore (optional, for the product list).
 */
(function () {
  'use strict';
  var FILE_KEY = 'eg_file_guidelines', SIZE_KEY = 'eg_size_guides';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function isStaff() { try { var u = JSON.parse(localStorage.getItem('eg_user') || '{}'); return u && u.role && u.role !== 'seller'; } catch (e) { return false; } }
  function products() { try { return (window.EGStore && EGStore.getCatalogProducts) ? (EGStore.getCatalogProducts() || []) : []; } catch (e) { return []; } }

  // ── default content ──────────────────────────────────────────────────────
  var FILE_DEFAULT = [
    { title: 'Accepted file types', body: 'Transparent PNG, SVG, PDF or AI. High-resolution JPG is fine for full-bleed photographic art. Vector (SVG/AI/PDF) is required for embroidery, appliqué and laser.' },
    { title: 'Resolution', body: '300 DPI at the final print size. Do not upscale a small image — it will print soft or pixelated. For a 12×16 in print that means roughly 3600×4800 px.' },
    { title: 'Color', body: 'Design in sRGB for DTG/DTF. Colors may shift slightly on fabric. For embroidery, supply thread/Pantone references — gradients and photographic detail cannot be stitched.' },
    { title: 'Transparency & background', body: 'Use a transparent background — remove any white box behind the artwork unless the white is intentional. Flatten hidden layers before exporting.' },
    { title: 'Bleed & safe area', body: 'Keep important elements at least 0.25 in inside the print-area edges. Art is centered inside the product print area defined by the operator.' },
    { title: 'Per-technique notes', body: 'DTG — full-color raster, transparent PNG.\nDTF — transparent PNG, bold/vibrant colors, fine detail OK.\nEmbroidery — vector, ≤15 thread colors, no gradients, min line ~1.5 mm.\nAppliqué — bold simple shapes, clean cut paths.\nLaser — single-color vector outlines only.' },
    { title: 'File naming', body: 'Name files orderID_item_position (e.g. EG0000000032_01_front.png) so the warehouse can match artwork to the right line.' }
  ];
  function loadFile() { try { var v = JSON.parse(localStorage.getItem(FILE_KEY) || 'null'); if (Array.isArray(v) && v.length) return v; } catch (e) {} return FILE_DEFAULT.map(function (s) { return { title: s.title, body: s.body }; }); }
  function saveFile(arr) { try { localStorage.setItem(FILE_KEY, JSON.stringify(arr)); } catch (e) {} }

  // Apparel default chart — operators tweak per product.
  function sizeDefaultFor(p) {
    var sizes = [];
    try { (p && Array.isArray(p.variantSkus) ? p.variantSkus : []).forEach(function (v) { if (v && v.size && sizes.indexOf(v.size) < 0) sizes.push(v.size); }); } catch (e) {}
    if (!sizes.length) sizes = ['S', 'M', 'L', 'XL', '2XL'];
    return { unit: 'in', cols: ['Size', 'Chest', 'Length', 'Sleeve'], rows: sizes.map(function (s) { return [s, '', '', '']; }) };
  }
  function loadSizes() { try { var v = JSON.parse(localStorage.getItem(SIZE_KEY) || '{}'); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; } }
  function saveSizes(obj) { try { localStorage.setItem(SIZE_KEY, JSON.stringify(obj)); } catch (e) {} }

  // ── modal shell ──────────────────────────────────────────────────────────
  var _editing = false, _mode = 'file', _pid = null;
  function shell() {
    var m = document.getElementById('eg-guides-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'eg-guides-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(25,25,24,.45);z-index:9700;display:none;align-items:center;justify-content:center;padding:24px;font-family:inherit';
    m.innerHTML =
      '<div style="background:#fdfcfa;border-radius:16px;width:100%;max-width:680px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #ececea">'
      +   '<div><div id="egg-title" style="font-size:16px;font-weight:800;color:#191918;letter-spacing:-.01em"></div><div id="egg-sub" style="font-size:12.5px;color:#9ca3af;margin-top:1px"></div></div>'
      +   '<div style="display:flex;align-items:center;gap:8px"><button id="egg-edit" onclick="EGGuides._toggleEdit()" style="display:none;font-size:12.5px;font-weight:700;border:1px solid #e5e4e0;background:#fff;color:#374151;border-radius:8px;padding:6px 12px;cursor:pointer;font-family:inherit">Edit</button>'
      +   '<button onclick="EGGuides.close()" title="Close" style="width:30px;height:30px;border:none;background:#f4f2ef;border-radius:8px;cursor:pointer;color:#6b7280;font-size:16px;line-height:1">✕</button></div>'
      + '</div>'
      + '<div id="egg-tabs" style="display:none;gap:6px;padding:10px 20px 0;flex-wrap:wrap;overflow:auto;max-height:96px"></div>'
      + '<div id="egg-body" style="padding:18px 20px;overflow:auto;flex:1"></div>'
      + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    document.body.appendChild(m);
    return m;
  }
  function close() { var m = document.getElementById('eg-guides-modal'); if (m) m.style.display = 'none'; _editing = false; }

  // ── file guidelines ────────────────────────────────────────────────────────
  function renderFile() {
    var data = loadFile();
    var body = document.getElementById('egg-body');
    var ce = _editing ? ' contenteditable="true" data-egg="1" style="outline:none;border:1px dashed #cfcabf;border-radius:8px;padding:8px 10px;background:#fff;white-space:pre-wrap"' : ' style="white-space:pre-wrap"';
    body.innerHTML = data.map(function (s, i) {
      return '<div data-sec="' + i + '" style="margin-bottom:16px">'
        + '<div ' + (_editing ? 'contenteditable="true" data-egg-title="1" style="outline:none;font-size:13px;font-weight:800;color:#191918;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px;border:1px dashed #cfcabf;border-radius:6px;padding:3px 7px"' : 'style="font-size:13px;font-weight:800;color:#191918;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px"') + '>' + esc(s.title) + '</div>'
        + '<div data-egg-body="1"' + ce + ' >' + esc(s.body) + '</div>'
        + (_editing ? '<button onclick="EGGuides._delSec(' + i + ')" style="margin-top:6px;font-size:11.5px;color:#b83c3c;background:none;border:none;cursor:pointer;font-family:inherit;padding:0">Remove section</button>' : '')
        + '</div>';
    }).join('') + (_editing ? '<button onclick="EGGuides._addSec()" style="font-size:12.5px;font-weight:600;color:#191918;background:#fff;border:1px dashed #c4c3be;border-radius:8px;padding:7px 12px;cursor:pointer;font-family:inherit">+ Add section</button>' : '');
  }
  function collectFile() {
    var out = [];
    document.querySelectorAll('#egg-body [data-sec]').forEach(function (el) {
      var t = el.querySelector('[data-egg-title], div:first-child'), b = el.querySelector('[data-egg-body]');
      out.push({ title: (t ? t.textContent : '').trim(), body: (b ? b.innerText : '').trim() });
    });
    return out.filter(function (s) { return s.title || s.body; });
  }

  // ── size guide ─────────────────────────────────────────────────────────────
  function renderTabs() {
    var tabs = document.getElementById('egg-tabs');
    var ps = products();
    var list = [{ id: '__general', name: 'General' }].concat(ps.map(function (p) { return { id: String(p.id), name: p.name || p.sku || ('#' + p.id) }; }));
    if (!_pid) _pid = list[0].id;
    tabs.style.display = 'flex';
    tabs.innerHTML = list.map(function (t) {
      var on = String(t.id) === String(_pid);
      return '<button onclick="EGGuides._tab(\'' + String(t.id).replace(/'/g, "\\'") + '\')" style="font-size:12.5px;font-weight:600;border:1px solid ' + (on ? '#191918' : '#e5e4e0') + ';background:' + (on ? '#191918' : '#fff') + ';color:' + (on ? '#fff' : '#374151') + ';border-radius:999px;padding:5px 13px;cursor:pointer;font-family:inherit;white-space:nowrap">' + esc(t.name) + '</button>';
    }).join('');
  }
  function currentChart() {
    var all = loadSizes();
    if (_pid === '__general') return all.__general || { unit: 'in', cols: ['Size', 'Chest', 'Length', 'Sleeve'], rows: [['S', '', '', ''], ['M', '', '', ''], ['L', '', '', ''], ['XL', '', '', '']] };
    if (all[_pid]) return all[_pid];
    var p = products().find(function (x) { return String(x.id) === String(_pid); });
    return sizeDefaultFor(p || {});
  }
  function renderSize() {
    renderTabs();
    var c = currentChart();
    var body = document.getElementById('egg-body');
    var ed = _editing;
    var cell = function (v, head) {
      var base = 'border:1px solid #ececea;padding:7px 10px;font-size:13px;' + (head ? 'background:#f6f5f4;font-weight:700;color:#191918;' : 'color:#374151;');
      if (ed) return '<td style="' + base + 'padding:0"><div contenteditable="true" data-cell="1" style="outline:none;padding:7px 10px;min-height:18px">' + esc(v) + '</div></td>';
      return '<' + (head ? 'th' : 'td') + ' style="' + base + 'text-align:left">' + esc(v) + '</' + (head ? 'th' : 'td') + '>';
    };
    var thead = '<tr>' + c.cols.map(function (h, ci) { return ed ? '<th style="border:1px solid #ececea;background:#f6f5f4;padding:0"><div contenteditable="true" data-col="' + ci + '" style="outline:none;padding:7px 10px;font-weight:700;color:#191918;font-size:13px">' + esc(h) + '</div></th>' : cell(h, true); }).join('') + (ed ? '<th style="border:none;width:30px"></th>' : '') + '</tr>';
    var tbody = c.rows.map(function (r, ri) {
      return '<tr data-row="' + ri + '">' + c.cols.map(function (_, ci) { return cell(r[ci] || '', false); }).join('') + (ed ? '<td style="border:none;text-align:center"><button onclick="EGGuides._delRow(' + ri + ')" title="Remove" style="border:none;background:none;color:#c4c3be;cursor:pointer;font-size:15px">✕</button></td>' : '') + '</tr>';
    }).join('');
    body.innerHTML = '<div style="overflow:auto"><table style="border-collapse:collapse;width:100%">' + thead + tbody + '</table></div>'
      + '<div style="font-size:12px;color:#9ca3af;margin-top:8px">Measurements in ' + esc(c.unit || 'in') + '.</div>'
      + (ed ? '<div style="display:flex;gap:8px;margin-top:12px"><button onclick="EGGuides._addRow()" style="font-size:12.5px;font-weight:600;color:#191918;background:#fff;border:1px dashed #c4c3be;border-radius:8px;padding:7px 12px;cursor:pointer;font-family:inherit">+ Add size</button><button onclick="EGGuides._addCol()" style="font-size:12.5px;font-weight:600;color:#191918;background:#fff;border:1px dashed #c4c3be;border-radius:8px;padding:7px 12px;cursor:pointer;font-family:inherit">+ Add measurement</button><button onclick="EGGuides._toggleUnit()" style="font-size:12.5px;font-weight:600;color:#374151;background:#f4f2ef;border:1px solid #e5e4e0;border-radius:8px;padding:7px 12px;cursor:pointer;font-family:inherit">Unit: ' + esc(c.unit || 'in') + '</button></div>' : '');
  }
  function collectSize() {
    var cols = [].map.call(document.querySelectorAll('#egg-body [data-col]'), function (d) { return d.textContent.trim() || 'Col'; });
    var rows = [].map.call(document.querySelectorAll('#egg-body tr[data-row]'), function (tr) {
      return [].map.call(tr.querySelectorAll('[data-cell]'), function (d) { return d.textContent.trim(); });
    });
    var c = currentChart();
    return { unit: c.unit || 'in', cols: cols, rows: rows };
  }
  function persistSizeFromDom() { var all = loadSizes(); all[_pid] = collectSize(); saveSizes(all); }

  // ── public API ─────────────────────────────────────────────────────────────
  function open(mode, pid) {
    _mode = mode === 'size' ? 'size' : 'file';
    _editing = false;
    if (_mode === 'size') _pid = pid != null ? String(pid) : (_pid || null);
    shell().style.display = 'flex';
    document.getElementById('egg-title').textContent = _mode === 'size' ? 'Size guide' : 'File guidelines';
    document.getElementById('egg-sub').textContent = _mode === 'size' ? 'Measurements by product · pick a tab' : 'Artwork requirements for print & embroidery';
    document.getElementById('egg-tabs').style.display = _mode === 'size' ? 'flex' : 'none';
    var eb = document.getElementById('egg-edit'); eb.style.display = isStaff() ? '' : 'none'; eb.textContent = 'Edit';
    if (_mode === 'size') renderSize(); else renderFile();
  }
  window.EGGuides = {
    open: open,
    openFile: function () { open('file'); },
    openSize: function (pid) { open('size', pid); },
    close: close,
    _toggleEdit: function () {
      var eb = document.getElementById('egg-edit');
      if (_editing) { // currently editing → save
        if (_mode === 'file') saveFile(collectFile()); else persistSizeFromDom();
        _editing = false; eb.textContent = 'Edit';
      } else { _editing = true; eb.textContent = 'Save'; }
      if (_mode === 'file') renderFile(); else renderSize();
    },
    _tab: function (id) { if (_editing) persistSizeFromDom(); _pid = String(id); renderSize(); },
    _addSec: function () { var d = collectFile(); d.push({ title: 'New section', body: '' }); saveFile(d); renderFile(); },
    _delSec: function (i) { var d = collectFile(); d.splice(i, 1); saveFile(d); renderFile(); },
    _addRow: function () { persistSizeFromDom(); var all = loadSizes(); var c = all[_pid] || collectSize(); c.rows.push(c.cols.map(function () { return ''; })); all[_pid] = c; saveSizes(all); renderSize(); },
    _delRow: function (i) { persistSizeFromDom(); var all = loadSizes(); var c = all[_pid] || collectSize(); c.rows.splice(i, 1); all[_pid] = c; saveSizes(all); renderSize(); },
    _addCol: function () { persistSizeFromDom(); var all = loadSizes(); var c = all[_pid] || collectSize(); c.cols.push('Measurement'); c.rows.forEach(function (r) { r.push(''); }); all[_pid] = c; saveSizes(all); renderSize(); },
    _toggleUnit: function () { persistSizeFromDom(); var all = loadSizes(); var c = all[_pid] || collectSize(); c.unit = (c.unit === 'cm') ? 'in' : 'cm'; all[_pid] = c; saveSizes(all); renderSize(); }
  };
})();

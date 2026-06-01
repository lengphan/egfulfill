// Shared design-board management UI — used by admin + warehouse Settings.
// Renders the same add / rename / recolor / reorder / delete interface that
// admin already exposes through its "+ Manage" modal, but inline so it can
// live inside a Settings panel.
//
//   EGBoardSettings.renderInto(containerEl, { onChange })
//
//   onChange — optional callback fired after any mutation, so the host page
//              can re-render its own chip strip / board view.
(function () {
  'use strict';

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function getTypes() {
    try { return EGStore.getDesignTypes() || []; } catch (e) { return []; }
  }
  function saveTypes(arr) {
    try { EGStore.setDesignTypes(arr); } catch (e) {}
  }

  function rerender(host, onChange) {
    paint(host, onChange);
    if (typeof onChange === 'function') {
      try { onChange(); } catch (e) {}
    }
  }

  function paint(host, onChange) {
    var types = getTypes();
    var rows = types.map(function (t, i) {
      var isFirst = i === 0, isLast = i === types.length - 1;
      return '' +
        '<div data-id="' + t.id + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e5e4e0;border-radius:9px;background:#fff">' +
          '<div style="display:flex;flex-direction:column">' +
            '<button data-act="up"   ' + (isFirst ? 'disabled' : '') + ' title="Move up"   style="width:20px;height:14px;border:none;background:none;cursor:' + (isFirst ? 'not-allowed' : 'pointer') + ';color:' + (isFirst ? '#d1cfca' : '#6b7280') + ';padding:0;line-height:1;font-size:11px;font-family:inherit">▲</button>' +
            '<button data-act="down" ' + (isLast  ? 'disabled' : '') + ' title="Move down" style="width:20px;height:14px;border:none;background:none;cursor:' + (isLast  ? 'not-allowed' : 'pointer') + ';color:' + (isLast  ? '#d1cfca' : '#6b7280') + ';padding:0;line-height:1;font-size:11px;font-family:inherit">▼</button>' +
          '</div>' +
          '<input type="color" data-act="color" value="' + t.color + '" title="Edit color" style="width:34px;height:34px;border:1.5px solid #e5e4e0;border-radius:6px;cursor:pointer;padding:1px;background:#fff;flex-shrink:0">' +
          '<input data-act="name" value="' + String(t.name).replace(/"/g, '&quot;') + '" maxlength="20" style="flex:1;font-size:14px;font-weight:600;padding:7px 10px;border:1.5px solid #f0ede9;border-radius:6px;outline:none;font-family:inherit;text-transform:uppercase">' +
          '<span style="font-family:monospace;font-size:11.5px;color:#b0aaa4;flex-shrink:0">' + t.id + '</span>' +
          '<button data-act="del" title="Delete" style="width:30px;height:30px;border:1.5px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:15px;line-height:1;font-family:inherit;flex-shrink:0">×</button>' +
        '</div>';
    }).join('');

    var emptyMsg = '<div style="font-size:13px;color:#9ca3af;padding:18px;text-align:center;border:1px dashed #e5e4e0;border-radius:9px">No boards yet — add one below.</div>';

    host.innerHTML =
      '<div style="font-size:16px;font-weight:700;color:#191918;margin-bottom:3px">Design Type Boards</div>' +
      '<div style="font-size:13px;color:#6b7280;margin-bottom:16px;line-height:1.5">These are the boards your team sees in Design Studio. Add the print methods you offer, rename them, recolor them, or remove ones you don\'t use. Changes sync to every dashboard instantly.</div>' +
      '<div data-region="rows" style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">' +
        (rows || emptyMsg) +
      '</div>' +
      '<div style="font-size:11.5px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Add a new board</div>' +
      '<div style="display:grid;grid-template-columns:46px 1fr auto;gap:8px;align-items:center;padding:12px;background:#f9f8f6;border:1px dashed #d8d4cc;border-radius:9px">' +
        '<input type="color" data-region="new-color" value="#3a5a96" title="Pick color" style="width:34px;height:34px;border:1.5px solid #e5e4e0;border-radius:6px;cursor:pointer;padding:1px;background:#fff">' +
        '<input data-region="new-name" placeholder="e.g. SCR, SUB, PUFF" maxlength="20" style="font-size:14px;font-weight:600;padding:7px 10px;border:1.5px solid #e5e4e0;border-radius:6px;outline:none;font-family:inherit;text-transform:uppercase">' +
        '<button data-region="add" style="padding:7px 18px;border-radius:7px;border:none;background:#191918;color:#fff;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit">+ Add board</button>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:14px">' +
        '<button data-region="reset" style="padding:6px 14px;border-radius:6px;border:1.5px solid #e5e4e0;background:#fff;color:#374151;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit">Reset to defaults</button>' +
      '</div>';

    wire(host, onChange);
  }

  function wire(host, onChange) {
    // Per-row actions
    host.querySelectorAll('[data-id]').forEach(function (row) {
      var id = row.dataset.id;
      row.querySelector('[data-act="up"]').addEventListener('click', function () {
        var t = getTypes(); var i = t.findIndex(function (x) { return x.id === id; });
        if (i > 0) { var tmp = t[i]; t[i] = t[i - 1]; t[i - 1] = tmp; saveTypes(t); rerender(host, onChange); }
      });
      row.querySelector('[data-act="down"]').addEventListener('click', function () {
        var t = getTypes(); var i = t.findIndex(function (x) { return x.id === id; });
        if (i >= 0 && i < t.length - 1) { var tmp = t[i]; t[i] = t[i + 1]; t[i + 1] = tmp; saveTypes(t); rerender(host, onChange); }
      });
      row.querySelector('[data-act="color"]').addEventListener('change', function (e) {
        var t = getTypes(); var x = t.find(function (y) { return y.id === id; });
        if (x) { x.color = e.target.value; saveTypes(t); rerender(host, onChange); }
      });
      row.querySelector('[data-act="name"]').addEventListener('change', function (e) {
        var t = getTypes(); var x = t.find(function (y) { return y.id === id; });
        if (x) {
          var nm = (e.target.value || '').trim().toUpperCase();
          x.name = nm || id.toUpperCase();
          saveTypes(t);
          rerender(host, onChange);
        }
      });
      row.querySelector('[data-act="del"]').addEventListener('click', function () {
        var t = getTypes(); var x = t.find(function (y) { return y.id === id; });
        if (!x) return;
        var ok = confirm('Delete board "' + x.name + '"? Any cards on this board will keep their type label but lose the colour styling.');
        if (!ok) return;
        var filtered = t.filter(function (y) { return y.id !== id; });
        saveTypes(filtered); rerender(host, onChange);
      });
    });

    // Add a new board
    var addBtn = host.querySelector('[data-region="add"]');
    var nameIn = host.querySelector('[data-region="new-name"]');
    var colorIn = host.querySelector('[data-region="new-color"]');
    function add() {
      var name = (nameIn.value || '').trim().toUpperCase();
      if (!name) { nameIn.focus(); nameIn.style.borderColor = '#dc2626'; return; }
      var id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 12);
      var types = getTypes();
      if (types.find(function (t) { return t.id === id; })) { alert('A board with id "' + id + '" already exists.'); return; }
      types.push({ id: id, name: name, color: colorIn.value || '#3a5a96' });
      saveTypes(types);
      nameIn.value = ''; nameIn.style.borderColor = '#e5e4e0';
      rerender(host, onChange);
    }
    addBtn.addEventListener('click', add);
    nameIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });

    // Reset
    host.querySelector('[data-region="reset"]').addEventListener('click', function () {
      if (!confirm('Reset boards to defaults (DTG / DTF / EMB)? Custom boards will be removed.')) return;
      try { localStorage.removeItem(EGStore.DESIGN_TYPES_KEY); } catch (e) {}
      rerender(host, onChange);
    });
  }

  window.EGBoardSettings = {
    renderInto: function (containerEl, opts) {
      if (!containerEl) return;
      var onChange = opts && opts.onChange;
      paint(containerEl, onChange);
      // Cross-tab sync — repaint when another dashboard mutates the list.
      window.addEventListener('storage', function (e) {
        if (e && (e.key === null || e.key === 'eg_design_types')) paint(containerEl, onChange);
      });
    }
  };
})();

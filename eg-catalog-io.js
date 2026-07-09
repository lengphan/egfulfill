/* ──────────────────────────────────────────────────────────────────────────
   eg-catalog-io.js — shared CSV Export / Import for the factory boards.

   One dependency-free module (window.EGCatalogIO) used by admin.html,
   operator.html and warehouse.html to round-trip the catalog + inventory as
   spreadsheets.

   Data model it round-trips (discovered from egfulfill-store.js / eg-products.js):
     • Catalog products  → EGStore.getCatalogProducts() / setCatalogProducts()
         product: { id, name, sku, type, method, price, status, variantSkus:[…] }
         variant: { sku, color, size, stock }   (falls back to p.variants[])
     • Inventory (SKU-keyed, on-hand authoritative) → EGStore.getInventory() /
       setInventory() / upsertInventoryRows()
         row: { sku, name, variant:"Color / Size", inStock, reserved,
                reorderAt, category }

   Export = one CSV row per variant (Stock pulled from the inventory module by
   variant SKU). Import = UPSERT products grouped by Product+Base SKU, then apply
   each variant's Stock into inventory by SKU. Everything is defensive: blank rows
   are skipped, missing modules are guarded, nothing throws to the console.

   Requires: egfulfill-store.js loaded first. Loaded via <script defer>.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── CSV primitives ───────────────────────────────────────────────────────
  function csvCell(v) {
    var s = (v == null) ? '' : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csvRow(arr) { return arr.map(csvCell).join(','); }

  // RFC-4180-ish parser: handles quoted fields, escaped quotes, CRLF/LF,
  // and a leading UTF-8 BOM. Returns an array of string arrays.
  function parseCSV(text) {
    if (text == null) return [];
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
    var rows = [], row = [], field = '', i = 0, inQ = false, n = text.length;
    while (i < n) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    // flush last field/row (unless the file ended on a trailing newline)
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function download(filename, csv) {
    try {
      var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 1000);
    } catch (e) { try { console.warn('[EGCatalogIO] download failed', e); } catch (_) {} }
  }

  function today() {
    var d = new Date();
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ── store shims (all guarded — module never assumes EGStore exists) ───────
  function store() { return (typeof window !== 'undefined' && window.EGStore) ? window.EGStore : null; }
  function catalog() { var s = store(); try { return (s && s.getCatalogProducts) ? (s.getCatalogProducts() || []) : []; } catch (e) { return []; } }
  function inventory() { var s = store(); try { return (s && s.getInventory) ? (s.getInventory() || []) : []; } catch (e) { return []; } }

  function variantsOf(p) {
    if (!p) return [];
    if (Array.isArray(p.variantSkus) && p.variantSkus.length) return p.variantSkus;
    if (Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object') return p.variants;
    return [];
  }

  // Map on-hand stock by SKU from the inventory module.
  function stockMap() {
    var map = {};
    inventory().forEach(function (r) { if (r && r.sku != null) map[String(r.sku)] = (parseInt(r.inStock, 10) || 0); });
    return map;
  }

  // Header lookup that tolerates arbitrary column order / casing / spacing.
  function headerIndex(headerRow) {
    var idx = {};
    (headerRow || []).forEach(function (h, i) { idx[String(h || '').trim().toLowerCase()] = i; });
    return function (/* …aliases */) {
      for (var a = 0; a < arguments.length; a++) {
        var k = String(arguments[a]).toLowerCase();
        if (idx[k] != null) return idx[k];
      }
      return -1;
    };
  }
  function cellAt(row, i) { return (i >= 0 && i < row.length) ? String(row[i] == null ? '' : row[i]).trim() : ''; }
  function isBlankRow(row) { return !row || !row.length || row.every(function (c) { return String(c == null ? '' : c).trim() === ''; }); }

  function rerenderProducts() { try { if (typeof window.renderOpProducts === 'function') window.renderOpProducts(); } catch (e) {} }
  function rerenderInventory() {
    try { if (typeof window.renderInventory === 'function') window.renderInventory(); } catch (e) {}
    try { if (window.EGInventory && typeof window.EGInventory.render === 'function') window.EGInventory.render(); } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORT PRODUCTS — one row per variant.
  // ─────────────────────────────────────────────────────────────────────────
  function exportProducts() {
    try {
      var prods = catalog();
      var stock = stockMap();
      var HEAD = ['Product', 'Base SKU', 'Variant SKU', 'Color', 'Size', 'Method', 'Price', 'Stock', 'Status'];
      var lines = [csvRow(HEAD)];
      prods.forEach(function (p) {
        if (!p) return;
        var vs = variantsOf(p);
        var method = p.method || '';
        var price = (p.price != null && p.price !== '') ? p.price : '';
        var status = p.status || '';
        if (vs.length) {
          vs.forEach(function (v) {
            if (!v) return;
            var sku = v.sku || '';
            var st = (sku && stock[sku] != null) ? stock[sku]
                   : (v.stock != null && v.stock !== '' ? (parseInt(v.stock, 10) || 0) : 0);
            lines.push(csvRow([p.name || '', p.sku || '', sku, v.color || '', v.size || '', method, price, st, status]));
          });
        } else {
          var bsku = p.sku || '';
          var bst = (bsku && stock[bsku] != null) ? stock[bsku] : 0;
          lines.push(csvRow([p.name || '', bsku, bsku, '', '', method, price, bst, status]));
        }
      });
      download('egfulfill-catalog-' + today() + '.csv', lines.join('\r\n'));
    } catch (e) {
      try { console.warn('[EGCatalogIO] exportProducts failed', e); } catch (_) {}
      alert('Could not export the catalog.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IMPORT PRODUCTS — UPSERT by Product+Base SKU, then apply Stock to inventory.
  // ─────────────────────────────────────────────────────────────────────────
  function importProducts(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var s = store();
        if (!s || !s.getCatalogProducts || !s.setCatalogProducts) { alert('Catalog store unavailable — cannot import.'); return; }
        var rows = parseCSV(String(reader.result || ''));
        if (!rows.length) { alert('That file has no rows.'); return; }
        var col = headerIndex(rows[0]);
        var iName   = col('product', 'name', 'product name');
        var iBase   = col('base sku', 'base_sku', 'basesku', 'product sku', 'sku');
        var iVar    = col('variant sku', 'variant_sku', 'variantsku');
        var iColor  = col('color', 'colour');
        var iSize   = col('size');
        var iMethod = col('method', 'methods');
        var iPrice  = col('price', 'base_price', 'base price');
        var iStock  = col('stock', 'on hand', 'on_hand', 'onhand', 'inventory', 'qty', 'quantity');
        var iStatus = col('status');
        if (iName < 0 && iBase < 0) { alert('Missing a Product / Base SKU column — is this a catalog CSV?'); return; }

        var existing = s.getCatalogProducts() || [];
        // Index existing products so an import UPDATES rather than duplicates.
        var byKey = {};                              // groupKey -> product
        existing.forEach(function (p) {
          if (!p) return;
          byKey[groupKey(p.name, p.sku)] = p;
        });
        var maxId = existing.reduce(function (m, p) { return Math.max(m, (p && +p.id) || 0); }, 0);

        var touched = {};                            // groupKey -> product (created or updated this run)
        var stockUpdates = [];                       // {sku, inStock, name, color, size, category}
        var variantCount = 0;

        rows.slice(1).forEach(function (row) {
          if (isBlankRow(row)) return;
          var name = cellAt(row, iName);
          var base = cellAt(row, iBase);
          if (!name && !base) return;
          if (!base) base = (name.split(/\s+/)[0] || 'ITEM').toUpperCase();
          if (!name) name = base;

          var gk = groupKey(name, base);
          var p = touched[gk] || byKey[gk];
          if (!p) {
            p = { id: ++maxId, name: name, sku: base.toUpperCase(), type: 'Apparel',
                  method: cellAt(row, iMethod), variants: '', variantSkus: [],
                  price: 0, status: 'Active',
                  fallback: (name.split(/\s+/)[0] || 'Item') };
          } else if (!p.variantSkus || !Array.isArray(p.variantSkus)) {
            p.variantSkus = variantsOf(p).slice();
          }
          // Patch product-level fields from the row (last non-empty wins).
          if (iMethod >= 0 && cellAt(row, iMethod)) p.method = cellAt(row, iMethod);
          if (iStatus >= 0 && cellAt(row, iStatus)) p.status = cellAt(row, iStatus);
          if (iPrice >= 0 && cellAt(row, iPrice) !== '') { var pr = parseFloat(cellAt(row, iPrice)); if (!isNaN(pr)) p.price = pr; }

          var vsku = cellAt(row, iVar) || (cellAt(row, iColor) || cellAt(row, iSize) ? '' : base);
          if (!vsku) {
            // color/size present but no explicit variant SKU → synthesise one
            var parts = [base.toUpperCase()];
            var cAbbr = cellAt(row, iColor).replace(/\s+/g, '').slice(0, 3).toUpperCase();
            var sAbbr = cellAt(row, iSize).replace(/\s+/g, '').toUpperCase();
            if (cAbbr) parts.push(cAbbr);
            if (sAbbr) parts.push(sAbbr);
            vsku = parts.join('-');
          }
          var color = cellAt(row, iColor), size = cellAt(row, iSize);
          var stockStr = cellAt(row, iStock);
          var stockNum = stockStr === '' ? null : (parseInt(stockStr, 10) || 0);

          // Upsert the variant onto the product (match by SKU, else color+size).
          var vlist = p.variantSkus;
          var v = vlist.find(function (x) { return x && x.sku && x.sku === vsku; })
               || vlist.find(function (x) { return x && String(x.color) === color && String(x.size) === size && (color || size); });
          if (v) { v.sku = vsku; if (color) v.color = color; if (size) v.size = size; if (stockNum != null) v.stock = stockNum; }
          else { v = { sku: vsku, color: color, size: size }; if (stockNum != null) v.stock = stockNum; vlist.push(v); }
          variantCount++;

          if (stockNum != null && vsku) {
            stockUpdates.push({ sku: vsku, inStock: stockNum, name: name,
                                variant: [color, size].filter(Boolean).join(' / ') || '—',
                                category: p.type || 'Apparel' });
          }
          touched[gk] = p;
          byKey[gk] = p;
        });

        // Fold touched products back into the catalog list.
        var out = existing.slice();
        Object.keys(touched).forEach(function (gk) {
          var p = touched[gk];
          p.variants = summariseVariants(p.variantSkus);
          var at = out.findIndex(function (x) { return x && +x.id === +p.id; });
          if (at >= 0) out[at] = p; else out.unshift(p);
        });
        s.setCatalogProducts(out);

        // Apply stock to the inventory module (upsert rows, then SET on-hand).
        var invUpdates = applyStock(stockUpdates);

        rerenderProducts();
        rerenderInventory();
        alert('Imported ' + Object.keys(touched).length + ' product' + (Object.keys(touched).length !== 1 ? 's' : '')
          + ' · ' + variantCount + ' variant' + (variantCount !== 1 ? 's' : '')
          + ' · ' + invUpdates + ' stock update' + (invUpdates !== 1 ? 's' : ''));
      } catch (e) {
        try { console.warn('[EGCatalogIO] importProducts failed', e); } catch (_) {}
        alert('Could not import that CSV — check the columns and try again.');
      }
    };
    reader.onerror = function () { alert('Could not read that file.'); };
    reader.readAsText(file);
  }

  // Group rows into a product by Product name + Base SKU (case-insensitive).
  function groupKey(name, sku) {
    return String(name || '').trim().toLowerCase() + ' ' + String(sku || '').trim().toLowerCase();
  }
  // Human-readable variant summary (mirrors eg-products.js's npmCollectVariantsSummary intent).
  function summariseVariants(vs) {
    if (!Array.isArray(vs) || !vs.length) return '1 variant';
    var colors = {}, sizes = {};
    vs.forEach(function (v) { if (!v) return; if (v.color) colors[v.color] = 1; if (v.size) sizes[v.size] = 1; });
    var nc = Object.keys(colors).length, ns = Object.keys(sizes).length;
    var bits = [];
    if (nc) bits.push(nc + ' color' + (nc !== 1 ? 's' : ''));
    if (ns) bits.push(ns + ' size' + (ns !== 1 ? 's' : ''));
    return bits.length ? bits.join(' · ') : (vs.length + ' variant' + (vs.length !== 1 ? 's' : ''));
  }

  // Upsert inventory rows then SET on-hand to the imported value (import is a
  // declaration of truth, not a delta). Returns the number of SKUs updated.
  function applyStock(updates) {
    var s = store();
    if (!s || !updates || !updates.length) return 0;
    try {
      if (s.upsertInventoryRows) {
        s.upsertInventoryRows(updates.map(function (u) {
          return { sku: u.sku, name: u.name, variant: u.variant, inStock: u.inStock, category: u.category };
        }));
      }
      // upsert never overwrites an existing count → set it explicitly afterwards.
      if (s.getInventory && s.setInventory) {
        var rows = s.getInventory() || [];
        var bySku = {};
        rows.forEach(function (r) { if (r && r.sku != null) bySku[String(r.sku)] = r; });
        updates.forEach(function (u) {
          var r = bySku[String(u.sku)];
          if (r) r.inStock = u.inStock;
          else rows.push({ sku: u.sku, name: u.name, variant: u.variant, inStock: u.inStock, reserved: 0, reorderAt: 25, category: u.category || 'Apparel' });
        });
        s.setInventory(rows);
      }
      return updates.length;
    } catch (e) { try { console.warn('[EGCatalogIO] applyStock failed', e); } catch (_) {} return 0; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORT INVENTORY — the flat SKU-keyed inventory list.
  // ─────────────────────────────────────────────────────────────────────────
  function exportInventory() {
    try {
      var rows = inventory();
      var HEAD = ['SKU', 'Product', 'Color', 'Size', 'On hand', 'Status'];
      var lines = [csvRow(HEAD)];
      rows.forEach(function (r) {
        if (!r || r.sku == null) return;
        // `variant` is stored as "Color / Size" — split it back out for the columns.
        var parts = String(r.variant || '').split('/').map(function (x) { return x.trim(); });
        var color = parts.length > 1 ? parts[0] : (parts[0] === '—' ? '' : parts[0]);
        var size = parts.length > 1 ? parts.slice(1).join(' / ') : '';
        var onHand = parseInt(r.inStock, 10) || 0;
        var status = onHand <= 0 ? 'Out of stock'
                   : (onHand <= (r.reorderAt != null ? r.reorderAt : 25) ? 'Low' : 'In stock');
        lines.push(csvRow([r.sku, r.name || '', color, size, onHand, status]));
      });
      download('egfulfill-inventory-' + today() + '.csv', lines.join('\r\n'));
    } catch (e) {
      try { console.warn('[EGCatalogIO] exportInventory failed', e); } catch (_) {}
      alert('Could not export inventory.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IMPORT INVENTORY — apply On-hand by SKU (tolerates the full export columns).
  // ─────────────────────────────────────────────────────────────────────────
  function importInventory(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var s = store();
        if (!s || !s.getInventory || !s.setInventory) { alert('Inventory store unavailable — cannot import.'); return; }
        var rows = parseCSV(String(reader.result || ''));
        if (!rows.length) { alert('That file has no rows.'); return; }
        var col = headerIndex(rows[0]);
        var iSku    = col('sku', 'variant sku', 'variant_sku');
        var iOnHand = col('on hand', 'on_hand', 'onhand', 'stock', 'inventory', 'qty', 'quantity', 'in stock');
        var iName   = col('product', 'name');
        var iColor  = col('color', 'colour');
        var iSize   = col('size');
        if (iSku < 0) { alert('Missing a SKU column — is this an inventory CSV?'); return; }
        if (iOnHand < 0) { alert('Missing an On-hand / Stock column.'); return; }

        var updates = [];
        rows.slice(1).forEach(function (row) {
          if (isBlankRow(row)) return;
          var sku = cellAt(row, iSku);
          if (!sku) return;
          var onHandStr = cellAt(row, iOnHand);
          if (onHandStr === '') return;
          var variant = [cellAt(row, iColor), cellAt(row, iSize)].filter(Boolean).join(' / ');
          updates.push({ sku: sku, inStock: parseInt(onHandStr, 10) || 0,
                         name: cellAt(row, iName), variant: variant || '—', category: 'Apparel' });
        });
        var n = applyStock(updates);
        rerenderInventory();
        alert('Imported ' + n + ' stock update' + (n !== 1 ? 's' : '') + '.');
      } catch (e) {
        try { console.warn('[EGCatalogIO] importInventory failed', e); } catch (_) {}
        alert('Could not import that inventory CSV.');
      }
    };
    reader.onerror = function () { alert('Could not read that file.'); };
    reader.readAsText(file);
  }

  window.EGCatalogIO = {
    exportProducts: exportProducts,
    importProducts: importProducts,
    exportInventory: exportInventory,
    importInventory: importInventory,
    // exposed for testing / reuse
    _parseCSV: parseCSV
  };
})();

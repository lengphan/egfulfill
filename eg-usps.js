/* eg-usps.js — shared USPS label helper for the factory boards.
   Calls POST /api/usps/label (server holds the OAuth + payment tokens) and renders
   the returned label. The fulfillment ORIGIN (from/return address) is remembered in
   localStorage so staff set it once. Loaded by warehouse/operator/admin. */
(function () {
  'use strict';
  if (window.EGUSPS) return;

  var ORIGIN_KEY = 'eg_ship_origin';

  function token() { return localStorage.getItem('eg_token') || ''; }

  // Friendly service label → USPS mail class enum.
  var MAILCLASS = {
    'USPS Ground Advantage': 'USPS_GROUND_ADVANTAGE',
    'USPS Priority Mail': 'PRIORITY_MAIL',
    'USPS Priority Mail Express': 'PRIORITY_MAIL_EXPRESS'
  };

  function getOrigin() { try { return JSON.parse(localStorage.getItem(ORIGIN_KEY) || 'null'); } catch (e) { return null; } }
  function setOrigin(o) { try { localStorage.setItem(ORIGIN_KEY, JSON.stringify(o || {})); } catch (e) {} }

  // Parse a "City, ST 12345" string into parts.
  function parseCityStateZip(s) {
    var m = String(s || '').match(/^(.+?),?\s*([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?\s*$/);
    return m ? { city: m[1].trim(), state: m[2].toUpperCase(), zip: m[3] } : { city: '', state: '', zip: '' };
  }

  function mailClassOf(svc) { return MAILCLASS[svc] || (/[A-Z_]{6,}/.test(svc) ? svc : 'USPS_GROUND_ADVANTAGE'); }

  // POST to the server; resolves { ok, trackingNumber, labelImage, imageType } or { error }.
  function createLabel(payload) {
    return fetch('/api/usps/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  // Open / download the returned label (base64). PDF opens in a tab; ZPL downloads.
  function openLabel(labelImage, imageType, tracking) {
    if (!labelImage) return;
    var t = String(imageType || 'PDF').toUpperCase();
    if (/ZPL/.test(t)) {
      try {
        var bin = atob(labelImage), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' }));
        var a = document.createElement('a'); a.href = url; a.download = 'label-' + (tracking || 'usps') + '.zpl';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      } catch (e) {}
      return;
    }
    var mime = t === 'PDF' ? 'application/pdf' : 'image/png';
    var src = 'data:' + mime + ';base64,' + labelImage;
    try {
      var w = window.open('', '_blank');
      if (w) w.document.write('<title>USPS Label ' + (tracking || '') + '</title><iframe src="' + src + '" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>');
    } catch (e) {}
  }

  // ── Shared label modal (operator + admin reuse this; warehouse has its own) ───
  var IN = 'width:100%;border:1.5px solid #e5e4e0;border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;box-sizing:border-box;outline:none';
  var LB = 'font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px';
  var HD = 'grid-column:1/-1;font-size:11px;font-weight:800;color:#191918;letter-spacing:.04em;margin-top:4px';
  function fld(label, id, ph, extra) {
    return '<div><div style="' + LB + '">' + label + '</div><input id="' + id + '" ' + (extra || '') + ' style="' + IN + '" placeholder="' + (ph || '') + '"></div>';
  }
  var _modal = null, _ctx = null;
  function buildModal() {
    var m = document.createElement('div');
    m.id = 'egusps-label-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.45);align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif';
    m.innerHTML =
      '<div style="background:#fff;border-radius:14px;width:560px;max-width:95vw;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">'
      + '<div style="padding:16px 20px;border-bottom:1px solid #e5e4e0;display:flex;align-items:center;justify-content:space-between"><div><div style="font-size:15px;font-weight:700;color:#191918">Create Shipping Label</div><div id="egusps-order" style="font-size:13px;color:#9ca3af;margin-top:2px"></div></div><button id="egusps-x" style="background:none;border:none;font-size:23px;color:#9ca3af;cursor:pointer;line-height:1">&times;</button></div>'
      + '<div style="padding:18px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + '<div style="' + HD + '">SHIP TO</div>'
      + fld('Name', 'egusps-to-name', 'Customer name')
      + fld('Street', 'egusps-to-addr', '123 Main St')
      + fld('Apt / Suite', 'egusps-to-apt', 'Apt 4B')
      + fld('City, State ZIP', 'egusps-to-city', 'Austin, TX 78701')
      + '<div style="' + HD + '">SHIP FROM <span style="font-weight:400;color:#9ca3af;text-transform:none;letter-spacing:0">return address — remembered</span></div>'
      + fld('Name / Business', 'egusps-from-name', 'EGFULFILL')
      + fld('Street', 'egusps-from-addr', '456 Warehouse Rd')
      + fld('Apt / Suite', 'egusps-from-apt', 'Unit 2')
      + fld('City, State ZIP', 'egusps-from-city', 'Dallas, TX 75001')
      + '<div style="' + HD + '">PACKAGE</div>'
      + '<div><div style="' + LB + '">Service</div><select id="egusps-svc" style="' + IN + ';background:#fff"><option>USPS Ground Advantage</option><option>USPS Priority Mail</option><option>USPS Priority Mail Express</option></select></div>'
      + fld('Weight (oz)', 'egusps-weight', '8', 'type="number" min="1" value="8"')
      + '<div style="grid-column:1/-1"><div style="' + LB + '">Dimensions (in) — L × W × H</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"><input id="egusps-len" type="number" min="1" value="9" style="' + IN + '"><input id="egusps-wid" type="number" min="1" value="6" style="' + IN + '"><input id="egusps-hgt" type="number" min="1" value="2" style="' + IN + '"></div></div>'
      + '<div><div style="' + LB + '">Label format</div><select id="egusps-format" style="' + IN + ';background:#fff"><option value="PDF">PDF (regular printer)</option><option value="ZPL203DPI">ZPL (thermal)</option></select></div>'
      + '</div>'
      + '<div style="padding:12px 20px;border-top:1px solid #e5e4e0;display:flex;justify-content:flex-end;gap:8px"><button id="egusps-cancel" style="font-size:13px;padding:8px 16px;border-radius:8px;border:1.5px solid #e5e4e0;background:#fff;color:#374151;cursor:pointer;font-family:inherit">Cancel</button><button id="egusps-gen" style="font-size:13px;padding:8px 18px;border-radius:8px;border:none;background:#191918;color:#fff;cursor:pointer;font-family:inherit;font-weight:600">Generate Label</button></div>'
      + '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) m.style.display = 'none'; });
    m.querySelector('#egusps-x').addEventListener('click', function () { m.style.display = 'none'; });
    m.querySelector('#egusps-cancel').addEventListener('click', function () { m.style.display = 'none'; });
    m.querySelector('#egusps-gen').addEventListener('click', generateFromModal);
    return m;
  }
  function setv(id, v) { var e = _modal.querySelector('#' + id); if (e) e.value = v || ''; }
  function getv(id) { var e = _modal.querySelector('#' + id); return e ? String(e.value || '').trim() : ''; }

  // opts: { orderNum, orderId, toName, toStreet, toApt, toCSZ, onDone }
  function openLabelModal(opts) {
    opts = opts || {}; _ctx = opts;
    if (!_modal) _modal = buildModal();
    _modal.querySelector('#egusps-order').textContent = opts.orderNum ? ('#' + opts.orderNum) : 'New label';
    setv('egusps-to-name', opts.toName); setv('egusps-to-addr', opts.toStreet);
    setv('egusps-to-apt', opts.toApt); setv('egusps-to-city', opts.toCSZ);
    var org = getOrigin() || {};
    setv('egusps-from-name', org.name); setv('egusps-from-addr', org.street); setv('egusps-from-apt', org.street2);
    setv('egusps-from-city', [org.city, [org.state, org.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '));
    _modal.style.display = 'flex';
  }
  async function generateFromModal() {
    var toCSZ = parseCityStateZip(getv('egusps-to-city'));
    var fromCSZ = parseCityStateZip(getv('egusps-from-city'));
    var to = { name: getv('egusps-to-name'), street: getv('egusps-to-addr'), street2: getv('egusps-to-apt'), city: toCSZ.city, state: toCSZ.state, zip: toCSZ.zip };
    var from = { name: getv('egusps-from-name'), street: getv('egusps-from-addr'), street2: getv('egusps-from-apt'), city: fromCSZ.city, state: fromCSZ.state, zip: fromCSZ.zip };
    if (!to.street || !to.zip) { alert('Enter the recipient Street + a valid "City, ST ZIP".'); return; }
    if (!from.street || !from.zip) { alert('Enter your Ship From Street + "City, ST ZIP" (remembered next time).'); return; }
    setOrigin(from);   // remember the return address across boards
    var payload = {
      orderId: (_ctx && (_ctx.orderId || _ctx.orderNum)) || undefined,
      to: to, from: from,
      weightOz: parseFloat(getv('egusps-weight')) || 8,
      length: parseFloat(getv('egusps-len')) || 9, width: parseFloat(getv('egusps-wid')) || 6, height: parseFloat(getv('egusps-hgt')) || 2,
      mailClass: mailClassOf(getv('egusps-svc')), imageType: getv('egusps-format') || 'PDF'
    };
    var btn = _modal.querySelector('#egusps-gen');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating label…'; }
    var res; try { res = await createLabel(payload); } catch (e) { res = { error: e.message }; }
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Label'; }
    if (!res || res.error) { alert('USPS label failed: ' + ((res && res.error) || 'unknown error')); return; }
    var tracking = res.trackingNumber || '';
    try { openLabel(res.labelImage, res.imageType || payload.imageType, tracking); } catch (e) {}
    try { if (window.EGStore && EGStore.update && (_ctx.orderId || _ctx.orderNum)) EGStore.update(_ctx.orderId || _ctx.orderNum, { tracking: tracking, factoryStatus: 'shipped', carrier: 'USPS' }); } catch (e) {}
    _modal.style.display = 'none';
    if (_ctx && typeof _ctx.onDone === 'function') { try { _ctx.onDone(tracking, res); } catch (e) {} }
    if (tracking) alert('USPS label created — tracking ' + tracking + (/ZPL/i.test(payload.imageType) ? ' (ZPL downloaded)' : ' (opened in a new tab to print)'));
  }

  window.EGUSPS = {
    ORIGIN_KEY: ORIGIN_KEY, getOrigin: getOrigin, setOrigin: setOrigin,
    parseCityStateZip: parseCityStateZip, mailClassOf: mailClassOf, MAILCLASS: MAILCLASS,
    createLabel: createLabel, openLabel: openLabel, openLabelModal: openLabelModal
  };
})();

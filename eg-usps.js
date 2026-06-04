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

  // Open / download the returned label. Accepts the full result object: a SAMPLE
  // (test-mode) label has labelHtml; a real label has base64 labelImage (+ imageType).
  function openLabel(res, tracking) {
    res = res || {};
    if (typeof res === 'string') res = { labelImage: res, imageType: arguments[1] };  // back-compat
    if (res.labelHtml) {
      try { var wh = window.open('', '_blank'); if (wh) wh.document.write('<title>Label ' + (tracking || '') + '</title><body style="margin:0;display:flex;justify-content:center;padding:24px;background:#f4f2ef">' + res.labelHtml + '<\/body>'); } catch (e) {}
      return;
    }
    var labelImage = res.labelImage;
    if (!labelImage) return;
    var t = String(res.imageType || 'PDF').toUpperCase();
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
  var TA = IN + ';resize:vertical;line-height:1.5;min-height:72px';
  var LB = 'font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px';
  var HD = 'font-size:11px;font-weight:800;color:#191918;letter-spacing:.04em;margin-top:4px;margin-bottom:-2px';
  function fld(label, id, ph, extra) {
    return '<div><div style="' + LB + '">' + label + '</div><input id="' + id + '" ' + (extra || '') + ' style="' + IN + '" placeholder="' + (ph || '') + '"></div>';
  }
  var _modal = null, _ctx = null;
  // Parse a pasted "Name / street / City, ST ZIP" block into structured fields.
  function parseAddressBlock(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    while (lines.length && /^(usa|u\.?\s?s\.?\s?a?\.?|united states(?: of america)?)$/i.test(lines[lines.length - 1])) lines.pop();
    var csz = parseCityStateZip(lines.length ? lines[lines.length - 1] : '');
    if (csz.zip) lines.pop();
    var name = lines.length > 1 ? lines.shift() : '';   // first line is the name when there's also a street
    var street = lines.shift() || '';
    var street2 = lines.join(', ');
    return { name: name, street: street, street2: street2, city: csz.city, state: csz.state, zip: csz.zip };
  }
  function buildModal() {
    var m = document.createElement('div');
    m.id = 'egusps-label-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.45);align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif';
    m.innerHTML =
      '<div style="background:#fff;border-radius:14px;width:580px;max-width:95vw;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">'
      + '<div style="padding:16px 20px;border-bottom:1px solid #e5e4e0;display:flex;align-items:center;justify-content:space-between"><div><div style="font-size:15px;font-weight:700;color:#191918">Create Shipping Label</div><div id="egusps-order" style="font-size:13px;color:#9ca3af;margin-top:2px"></div></div><button id="egusps-x" style="background:none;border:none;font-size:23px;color:#9ca3af;cursor:pointer;line-height:1">&times;</button></div>'
      + '<div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px">'
      // SHIP TO — single paste box + validate
      + '<div><div style="display:flex;align-items:baseline;justify-content:space-between"><div style="' + LB + '">Ship to <span style="font-weight:400;text-transform:none;color:#9ca3af">— paste name + address</span></div><span id="egusps-to-val" style="font-size:11px;font-weight:700"></span></div>'
      + '<textarea id="egusps-to" style="' + TA + '" placeholder="Jane Doe&#10;123 Main St, Apt 4&#10;Austin, TX 78701"></textarea>'
      + '<button type="button" onclick="EGUSPS._validate(\'to\')" style="margin-top:6px;font-size:12px;padding:5px 11px;border-radius:7px;border:1.5px solid #e5e4e0;background:#fff;color:#374151;cursor:pointer;font-family:inherit">✓ Validate with USPS</button></div>'
      // SHIP FROM — single paste box (remembered)
      + '<div><div style="display:flex;align-items:baseline;justify-content:space-between"><div style="' + LB + '">Ship from <span style="font-weight:400;text-transform:none;color:#9ca3af">— return address, remembered</span></div><span id="egusps-from-val" style="font-size:11px;font-weight:700"></span></div>'
      + '<textarea id="egusps-from" style="' + TA + '" placeholder="EGFULFILL&#10;456 Warehouse Rd&#10;Dallas, TX 75001"></textarea>'
      + '<button type="button" onclick="EGUSPS._validate(\'from\')" style="margin-top:6px;font-size:12px;padding:5px 11px;border-radius:7px;border:1.5px solid #e5e4e0;background:#fff;color:#374151;cursor:pointer;font-family:inherit">✓ Validate with USPS</button></div>'
      // PACKAGE
      + '<div style="' + HD + '">PACKAGE</div>'
      + '<div style="display:grid;grid-template-columns:1.3fr .7fr 1fr;gap:10px">'
      + '<div><div style="' + LB + '">Service</div><select id="egusps-svc" style="' + IN + ';background:#fff"><option>USPS Ground Advantage</option><option>USPS Priority Mail</option><option>USPS Priority Mail Express</option></select></div>'
      + fld('Weight (oz)', 'egusps-weight', '8', 'type="number" min="1" value="8"')
      + '<div><div style="' + LB + '">Dimensions L×W×H</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px"><input id="egusps-len" type="number" min="1" value="9" style="' + IN + '"><input id="egusps-wid" type="number" min="1" value="6" style="' + IN + '"><input id="egusps-hgt" type="number" min="1" value="2" style="' + IN + '"></div></div>'
      + '</div>'
      // REFERENCE INFO
      + '<div style="' + HD + '">REFERENCE INFO <span style="font-weight:400;color:#9ca3af;letter-spacing:0">— printed on the label</span></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + fld('Ref 1 — Order #', 'egusps-ref1', 'FF-7015')
      + fld('Ref 2 — Store / Seller', 'egusps-ref2', 'Seller')
      + '</div>'
      + fld('Contents', 'egusps-contents', 'Gildan Tee ×1 — DTG')
      // EXTRA SERVICES
      + '<div style="' + HD + '">EXTRA SERVICES</div>'
      + '<label style="display:flex;align-items:center;gap:9px;font-size:13.5px;color:#191918;cursor:pointer"><input type="checkbox" id="egusps-sig" style="accent-color:#191918">Signature Confirmation <span style="color:#9ca3af">+$3.65</span></label>'
      + '<label style="display:flex;align-items:center;gap:9px;font-size:13.5px;color:#191918;cursor:pointer"><input type="checkbox" id="egusps-ins" style="accent-color:#191918">Insurance <span style="color:#9ca3af">+$2.45</span></label>'
      // FORMAT
      + '<div style="' + HD + '">LABEL DOWNLOAD FORMAT</div>'
      + '<select id="egusps-format" style="' + IN + ';background:#fff"><option value="PDF">PDF (regular printer)</option><option value="ZPL203DPI">ZPL (thermal / Zebra)</option></select>'
      + '</div>'
      + '<div style="padding:12px 20px;border-top:1px solid #e5e4e0;display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:0;background:#fff"><button id="egusps-cancel" style="font-size:13px;padding:8px 16px;border-radius:8px;border:1.5px solid #e5e4e0;background:#fff;color:#374151;cursor:pointer;font-family:inherit">Cancel</button><button id="egusps-gen" style="font-size:13px;padding:8px 18px;border-radius:8px;border:none;background:#191918;color:#fff;cursor:pointer;font-family:inherit;font-weight:600">Generate Label</button></div>'
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
  function chk(id) { var e = _modal.querySelector('#' + id); return !!(e && e.checked); }
  function addrToText(a) { a = a || {}; return [a.name, [a.street, a.street2].filter(Boolean).join(', '), [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join('\n'); }

  // Validate one address box against USPS Addresses API (best effort — needs only
  // OAuth, no payment scope; standardizes the address in place on success).
  async function _validate(which) {
    var taId = which === 'from' ? 'egusps-from' : 'egusps-to';
    var statEl = _modal.querySelector('#' + (which === 'from' ? 'egusps-from-val' : 'egusps-to-val'));
    var a = parseAddressBlock(getv(taId));
    var setStat = function (t, c) { if (statEl) { statEl.textContent = t; statEl.style.color = c; } };
    if (!a.street || !a.zip) { setStat('need street + ZIP', '#dc2626'); return; }
    setStat('checking…', '#9ca3af');
    try {
      var qs = new URLSearchParams({ streetAddress: a.street, secondaryAddress: a.street2 || '', city: a.city || '', state: a.state || '', ZIPCode: a.zip || '' }).toString();
      var r = await fetch('/api/usps/validate-address?' + qs, { headers: { Authorization: 'Bearer ' + token() } }).then(function (x) { return x.json(); });
      if (r && r.ok && r.address && r.address.zip) {
        var v = r.address;
        setv(taId, (a.name ? a.name + '\n' : '') + v.street + (v.street2 ? ' ' + v.street2 : '') + '\n' + v.city + ', ' + v.state + ' ' + v.zip + (v.zip4 ? '-' + v.zip4 : ''));
        setStat('✓ validated', '#059669');
      } else { setStat('✕ ' + ((r && r.error) || 'not found'), '#dc2626'); }
    } catch (e) { setStat('✕ ' + e.message, '#dc2626'); }
  }

  // opts: { orderNum, orderId, toName/toStreet/toApt/toCSZ (or toText), seller, contents, onDone }
  function openLabelModal(opts) {
    opts = opts || {}; _ctx = opts;
    if (!_modal) _modal = buildModal();
    _modal.querySelector('#egusps-order').textContent = opts.orderNum ? ('#' + opts.orderNum) : 'New label';
    var toText = opts.toText || addrToText({ name: opts.toName, street: opts.toStreet, street2: opts.toApt, city: '', state: '', zip: '' });
    // toCSZ comes pre-joined ("City, ST ZIP"); append it if provided
    if (!opts.toText && opts.toCSZ) toText = [opts.toName, [opts.toStreet, opts.toApt].filter(Boolean).join(', '), opts.toCSZ].filter(Boolean).join('\n');
    setv('egusps-to', toText);
    setv('egusps-from', addrToText(getOrigin() || {}));
    // Header "+ New Label" passes no order → leave everything blank but the ship-from.
    setv('egusps-ref1', opts.orderNum || '');
    setv('egusps-ref2', opts.seller || (opts.orderNum ? 'Seller' : ''));
    setv('egusps-contents', opts.contents || '');
    var v1 = _modal.querySelector('#egusps-to-val'); if (v1) v1.textContent = '';
    var v2 = _modal.querySelector('#egusps-from-val'); if (v2) v2.textContent = '';
    _modal.style.display = 'flex';
  }
  async function generateFromModal() {
    var to = parseAddressBlock(getv('egusps-to'));
    var from = parseAddressBlock(getv('egusps-from'));
    if (!to.street || !to.zip) { alert('Ship to needs a street + a "City, ST ZIP" line.'); return; }
    if (!from.street || !from.zip) { alert('Ship from needs a street + a "City, ST ZIP" line (remembered next time).'); return; }
    setOrigin(from);   // remember the return address across boards
    var payload = {
      orderId: (_ctx && (_ctx.orderId || _ctx.orderNum)) || undefined,
      to: to, from: from,
      weightOz: parseFloat(getv('egusps-weight')) || 8,
      length: parseFloat(getv('egusps-len')) || 9, width: parseFloat(getv('egusps-wid')) || 6, height: parseFloat(getv('egusps-hgt')) || 2,
      mailClass: mailClassOf(getv('egusps-svc')), imageType: getv('egusps-format') || 'PDF',
      refNo: getv('egusps-ref1'), refNo2: getv('egusps-ref2'), contents: getv('egusps-contents'),
      signature: chk('egusps-sig'), insurance: chk('egusps-ins')
    };
    var btn = _modal.querySelector('#egusps-gen');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating label…'; }
    var res; try { res = await createLabel(payload); } catch (e) { res = { error: e.message }; }
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Label'; }
    if (!res || res.error) { alert('USPS label failed: ' + ((res && res.error) || 'unknown error')); return; }
    var tracking = res.trackingNumber || '';
    try { openLabel(res, tracking); } catch (e) {}
    try { if (window.EGStore && EGStore.update && (_ctx.orderId || _ctx.orderNum)) EGStore.update(_ctx.orderId || _ctx.orderNum, { tracking: tracking, factoryStatus: 'shipped', carrier: 'USPS' }); } catch (e) {}
    _modal.style.display = 'none';
    if (_ctx && typeof _ctx.onDone === 'function') { try { _ctx.onDone(tracking, res); } catch (e) {} }
    if (tracking) alert('USPS label created — tracking ' + tracking + (/ZPL/i.test(payload.imageType) ? ' (ZPL downloaded)' : ' (opened in a new tab to print)'));
  }

  window.EGUSPS = {
    ORIGIN_KEY: ORIGIN_KEY, getOrigin: getOrigin, setOrigin: setOrigin,
    parseCityStateZip: parseCityStateZip, parseAddressBlock: parseAddressBlock, mailClassOf: mailClassOf, MAILCLASS: MAILCLASS,
    createLabel: createLabel, openLabel: openLabel, openLabelModal: openLabelModal, _validate: _validate
  };
})();

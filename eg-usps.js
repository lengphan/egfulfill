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

  window.EGUSPS = {
    ORIGIN_KEY: ORIGIN_KEY, getOrigin: getOrigin, setOrigin: setOrigin,
    parseCityStateZip: parseCityStateZip, mailClassOf: mailClassOf, MAILCLASS: MAILCLASS,
    createLabel: createLabel, openLabel: openLabel
  };
})();

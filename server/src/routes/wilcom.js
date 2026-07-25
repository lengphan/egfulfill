// wilcom.js — Wilcom Embroidery Web API (EWA) client + connectivity check.
//
// EWA is a REST API: POST form params `appId` + `appKey` (+ a `RequestXml` recipe for the
// design/trueview methods) and it returns an XML string, HTTP 200 on success. Base URL:
//   https://public.ewa.wilcomapps.com/    e.g. POST api/info, api/newDesignTrueview, …
// Design/trueview results come back as base64 inside <files><file><filecontents>…, which a
// later build will parse; for now this module only proves the credentials work.
//
// Credentials are READ AT CALL TIME (never at module load) — the same rule every other
// integration here follows, so a key saved in Settings › Integrations applies on the next
// request without a redeploy. They live server-side only; the appKey is a secret and must
// never be sent to the browser.
//
// No XML parser dependency yet — the connectivity check only needs the status + a raw
// sample, and a small regex pulls out an error message if EWA returned one. A proper XML
// parse (into design/trueview bytes) comes with the digitizing build, added as a real dep.

const EWA_BASE = 'https://public.ewa.wilcomapps.com/';
const appId = () => (process.env.WILCOM_APP_ID || '').trim();
const appKey = () => (process.env.WILCOM_APP_KEY || '').trim();
const configured = () => !!(appId() && appKey());

/**
 * POST a form-encoded EWA call. `method` is a path like 'api/info'; `xml` is the optional
 * RequestXml recipe. Returns the raw response — parsing the XML into design/trueview bytes
 * is the next build's job, once the Interface Spec's XML data-package shapes are wired.
 */
async function ewaCall(method, xml) {
  const body = new URLSearchParams();
  body.set('appId', appId());
  body.set('appKey', appKey());
  if (xml) body.set('RequestXml', xml);
  const r = await fetch(EWA_BASE + String(method).replace(/^\/+/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await r.text().catch(() => '');
  return { status: r.status, ok: r.ok, body: text };
}

export function wilcomRoutes(app, requireStaff) {
  // Is the integration configured? Masked — never returns the key itself.
  app.get('/api/wilcom/config', { preHandler: requireStaff }, async () => ({
    configured: configured(),
    base: EWA_BASE,
  }));

  // Live connectivity + auth check: calls api/info with the stored credentials and reports
  // what EWA said. A REAL round-trip, no mock — so "the key works" is provable before any
  // digitizing flow is built on top. Never echoes the credentials back.
  app.post('/api/wilcom/test', { preHandler: requireStaff }, async (req, reply) => {
    if (!configured()) {
      reply.code(400);
      return { ok: false, error: 'Wilcom EWA is not configured — add WILCOM_APP_ID and WILCOM_APP_KEY in Settings › Integrations.' };
    }
    try {
      const res = await ewaCall('api/info', '');
      // EWA answers 200 on success; a non-200 (or an error XML) usually means a bad
      // appId/appKey. Try to pull a human-readable message out of the XML either way, but
      // always surface the status + a trimmed body so a wrong contract is diagnosable.
      const m = /<(?:message|error|errormessage|detail)>([^<]{1,300})<\//i.exec(res.body || '');
      return { ok: res.ok, status: res.status, message: m ? m[1].trim() : null, sample: (res.body || '').slice(0, 800) };
    } catch (e) {
      reply.code(502);
      return { ok: false, error: (e && e.message) || 'Could not reach the Wilcom EWA service' };
    }
  });
}

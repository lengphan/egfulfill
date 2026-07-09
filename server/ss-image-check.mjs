/* ss-image-check.mjs — CONSULT script: why aren't S&S catalog images loading?
 *
 * Standalone, no DB. Walks the exact path the app uses (styles → per-style products →
 * CDN image URL) and reports, at each hop, whether an image field exists and whether the
 * resulting URL actually returns an image. Pinpoints where the chain breaks.
 *
 * Run on the VPS:   cd server && node --env-file=.env ss-image-check.mjs
 * Optional:         node --env-file=.env ss-image-check.mjs 13011   (probe a specific styleID)
 */
const SS_ACCOUNT = (process.env.SS_ACCOUNT_NUMBER || '').trim();
const SS_KEY     = (process.env.SS_API_KEY || '').trim();
const SS_BASE    = (process.env.SS_API_BASE || 'https://api.ssactivewear.com/v2').trim().replace(/\/$/, '');
const SS_CDN     = 'https://cdn.ssactivewear.com/';

const ssImg = (u) => (!u ? null : (/^https?:/i.test(u) ? u : SS_CDN + String(u).replace(/^\//, '')));
const auth  = 'Basic ' + Buffer.from(SS_ACCOUNT + ':' + SS_KEY).toString('base64');
const c = { g:'\x1b[32m', r:'\x1b[31m', y:'\x1b[33m', d:'\x1b[2m', b:'\x1b[1m', x:'\x1b[0m' };
const ok  = (s) => `${c.g}✓${c.x} ${s}`;
const bad = (s) => `${c.r}✗ ${s}${c.x}`;
const warn= (s) => `${c.y}! ${s}${c.x}`;
const h1  = (s) => console.log(`\n${c.b}${s}${c.x}`);

async function ssGet(path) {
  const url = SS_BASE + path;
  const r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  let data = null, text = '';
  try { text = await r.text(); data = JSON.parse(text); } catch (_) {}
  return { ok: r.ok, status: r.status, data, text: text.slice(0, 200), url };
}

// HEAD the image; some CDNs reject HEAD, so fall back to a ranged GET (first byte only).
async function probeImg(url) {
  try {
    let r = await fetch(url, { method: 'HEAD' });
    if (r.status === 405 || r.status === 403) r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    return { status: r.status, type: r.headers.get('content-type'), len: r.headers.get('content-length') };
  } catch (e) { return { status: 0, err: e.message }; }
}

(async () => {
  console.log(`${c.b}S&S IMAGE CONSULT${c.x}  ${c.d}base=${SS_BASE}${c.x}`);

  // 0) creds
  h1('0 · Credentials');
  if (!SS_ACCOUNT || !SS_KEY) {
    console.log(bad(`missing ${!SS_ACCOUNT ? 'SS_ACCOUNT_NUMBER ' : ''}${!SS_KEY ? 'SS_API_KEY' : ''} — set them in server/.env`));
    process.exit(1);
  }
  console.log(ok(`account …${SS_ACCOUNT.slice(-4)} · key …${SS_KEY.slice(-4)}`));

  // 1) styles feed — how many carry a usable styleImage?
  h1('1 · /styles/ feed  (the "New In" grid)');
  const styleId = (process.argv[2] || '').trim();
  const sres = await ssGet('/styles/?fields=styleID,brandName,title,baseCategory,styleImage');
  if (!sres.ok || !Array.isArray(sres.data)) {
    console.log(bad(`styles fetch failed — HTTP ${sres.status}. body: ${sres.text}`));
    console.log(warn('If 401/403 → creds/permissions. If it never resolves → SS_API_BASE or network/firewall on the VPS.'));
    process.exit(1);
  }
  const styles = sres.data;
  const withImg = styles.filter((s) => s.styleImage);
  console.log(ok(`${styles.length} styles returned`));
  const pct = styles.length ? Math.round((withImg.length / styles.length) * 100) : 0;
  console.log((pct < 50 ? warn : ok)(`${withImg.length}/${styles.length} (${pct}%) have a non-null styleImage`));
  if (pct < 50) console.log(`  ${c.d}→ this account leaves styleImage null on most styles, so the grid MUST lazy-load colorFrontImage per style (step 2). If that also fails, the grid stays blank.${c.x}`);
  console.log('  samples:');
  styles.slice(0, 3).forEach((s) => console.log(`   ${c.d}#${s.styleID}${c.x} styleImage=${s.styleImage ? c.g + JSON.stringify(s.styleImage) + c.x : c.r + 'null' + c.x}`));

  // pick a probe style: the CLI arg, else the first style that has products
  const probe = styleId || String((styles[0] || {}).styleID || '');

  // 2) per-style products → colorFrontImage (the lazy-load path /api/ss/style/:id uses)
  h1(`2 · /products/?style=${probe}  (colorFrontImage lazy-load)`);
  const pres = await ssGet('/products/?style=' + encodeURIComponent(probe) + '&fields=sku,colorName,sizeName,colorFrontImage');
  if (!pres.ok || !Array.isArray(pres.data)) {
    console.log(bad(`products fetch failed — HTTP ${pres.status}. body: ${pres.text}`));
    process.exit(1);
  }
  const prods = pres.data;
  const firstImg = (prods.find((p) => p.colorFrontImage) || {}).colorFrontImage || null;
  console.log(ok(`${prods.length} products for style ${probe}`));
  console.log((firstImg ? ok : bad)(`colorFrontImage on first product: ${firstImg ? c.g + JSON.stringify(firstImg) + c.x : c.r + 'null (no image field returned!)' + c.x}`));

  // 3) the actual image URL the browser <img> requests
  h1('3 · CDN image URL  (what the <img> tag fetches)');
  const candidates = [];
  if (firstImg) candidates.push(['colorFrontImage', ssImg(firstImg)]);
  const styleImg = (withImg[0] || {}).styleImage;
  if (styleImg) candidates.push(['styleImage', ssImg(styleImg)]);
  if (!candidates.length) {
    console.log(bad('No image field on either styles or products for this account/style → nothing to load. Root cause = S&S is not returning image paths (check the account\'s API image permissions / field access with S&S).'));
    process.exit(0);
  }
  for (const [label, url] of candidates) {
    const p = await probeImg(url);
    const isImg = p.type && /^image\//.test(p.type);
    const line = `${label}: ${c.d}${url}${c.x}`;
    if (p.status === 200 && isImg) console.log(ok(line) + `  ${c.d}(${p.type}, ${p.len || '?'}b)${c.x}`);
    else if (p.status === 200) console.log(warn(line) + `  200 but content-type=${p.type} (not an image — wrong path?)`);
    else console.log(bad(line) + `  → HTTP ${p.status}${p.err ? ' ' + p.err : ''}`);
    if (p.status === 403) console.log(`   ${c.d}403 = the CDN host/path is gated for this account, OR the prefix is wrong. Confirm SS_CDN (${SS_CDN}) matches what S&S told you; some accounts use a per-account image host.${c.x}`);
    if (p.status === 404) console.log(`   ${c.d}404 = path exists in the API but not on this CDN — likely a stale/region CDN or a missing "Images/" segment.${c.x}`);
  }

  h1('DIAGNOSIS');
  console.log(`${c.d}• If step 1 shows ~0% styleImage AND step 2 has colorFrontImage AND step 3 is 200/image → the API is fine; the blank grid is a FRONT-END lazy-load bug (the /api/ss/style/:id calls aren't firing or the <img> src isn't being set). Check the browser Network tab for /api/ss/style/* calls.`);
  console.log(`• If step 3 is 403/404 → the image PATH is right but the CDN URL is wrong for this account. Fix SS_CDN or the path prefix in ss.js ssImg().`);
  console.log(`• If step 2 colorFrontImage is null too → S&S isn't returning image fields at all → an S&S account/permission issue, not our code.${c.x}`);
})().catch((e) => { console.error(`${c.r}fatal:${c.x}`, e.message); process.exit(1); });

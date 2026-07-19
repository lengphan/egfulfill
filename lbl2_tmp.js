const puppeteer = require('puppeteer');
const OUT='/private/tmp/claude-501/-Users-linhphan-Downloads-claude/3b3ab0b9-2d33-4130-95b2-eaeefcb497eb/scratchpad/shots';
(async () => {
  const b = await puppeteer.launch({ args:['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 850 });
  await p.evaluateOnNewDocument(() => {
    localStorage.setItem('eg_token','devtoken');
    localStorage.setItem('eg_user', JSON.stringify({ id:'u1', name:'Leng', role:'admin' }));
    const of = window.fetch;
    const J = (o) => Promise.resolve(new Response(JSON.stringify(o), { headers:{'content-type':'application/json'} }));
    window.fetch = (u,o) => String(u).includes('/api/inventory') && !String(u).includes('scan')
      ? J([{ sku:'47-BRA-TRA-BLK-ADJUSTABLE', name:'47 Brand Trawler Cap', variant:'Black / Adjustable', in_stock:10, reserved:0, reorder_at:25 }]) : of(u,o);
  });
  await p.goto('http://localhost:3111/inventory', { waitUntil:'networkidle0' });
  await new Promise(r=>setTimeout(r,1200));
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Print')).click());
  await new Promise(r=>setTimeout(r,900));
  // Does the barcode still overflow its card?
  const m = await p.evaluate(() => {
    const card = document.querySelector('.print-area > div');
    const svg = card.querySelector('svg');
    const c = card.getBoundingClientRect(), s = svg.getBoundingClientRect();
    return { card: Math.round(c.width), barcode: Math.round(s.width), overflow: Math.round(s.width - c.width) };
  });
  console.log('card width:', m.card, '| barcode width:', m.barcode, '| overflow:', m.overflow, m.overflow <= 0 ? '✓ fits' : '← STILL OVERFLOWING');
  await p.screenshot({ path: OUT+'/labels_fixed.png', clip:{x:0,y:0,width:1000,height:260} });
  await b.close();
})();

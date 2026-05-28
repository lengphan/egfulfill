const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto('file:///Users/linhphan/Downloads/.claude/operator.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => {
    EGStore.submitOrder({
      id: 'FF-9999', seller: 'Test', factoryStatus: 'new',
      customer: { name: 'Test Customer', email: '' },
      items: [{ sku: 'G5000-WHI-M', name: 'Gildan Unisex Tee', qty: 1, tech: 'EMB', price: 15 }],
    });
    EGStore.setItemEmbFile('FF-9999', 'G5000-WHI-M', { name:'GRAZE LOGO.EMB', dataUrl:'data:application/octet-stream;base64,QUJD', designId:'DSN-099', uploadedBy:'operator' });
    EGStore.setItemThreadColors('FF-9999', 'G5000-WHI-M', [
      { hex:'#dc4a23', code:'1987', name:'Orange' },
      { hex:'#a09080', code:'1733', name:'Tan' },
      { hex:'#ffffff', code:'1801', name:'White' },
      { hex:'#000000', code:'1800', name:'Black' },
    ]);
    if (typeof opMergeLiveOrders === 'function') opMergeLiveOrders();
    if (typeof renderOpOrders === 'function') renderOpOrders();
    if (typeof opToggleDetail === 'function') opToggleDetail('FF-9999');
  });
  await new Promise(r => setTimeout(r, 600));
  const exists = await page.evaluate(() => !!document.getElementById('op-detail-FF-9999'));
  console.log('detail row exists:', exists);
  if (exists) {
    const row = await page.$('#op-detail-FF-9999');
    await row.screenshot({ path: '/Users/linhphan/Downloads/.claude/screenshots/op_row_threads_right.png' });
    console.log('saved');
  }
  await browser.close();
})();

const puppeteer=require('puppeteer');
const sq=(c)=>'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="rgb(${c})"/></svg>`).toString('base64');
const ORDERS=[
 {id:'etsy-4119530158',source:'etsy',store:'CustomBabeUSA',factory_status:'awaiting_scan',customer:{name:'Meredith F'},tracking:'9400111',tracking_label_url:'https://x/a.pdf',total:42,created_at:'2026-07-18',address:{street:'1 Meadow',city:'GPF',state:'MI',zip:'48236'},items:[{sku:'APR-1',line_id:'l1',name:'Apron',qty:2,color:'Black',size:'OS',print_type:'Embroidery'}]},
 {id:'FF-2001',source:'manual',factory_status:'in_review',customer:{name:'Jane Doe'},total:24,created_at:'2026-07-19',address:{street:'9 Oak',city:'Austin',state:'TX',zip:'78701'},items:[{sku:'TEE-1',line_id:'l2',name:'Tee',qty:1,print_type:'DTG Print'}]},
 {id:'FF-2002',source:'manual',factory_status:'working',customer:{name:'No Address'},total:18,created_at:'2026-07-19',address:{},items:[{sku:'MUG-1',line_id:'l3',name:'Mug',qty:1}]}];
const CAT=[{id:1,sku:'APR-1',name:'Apron',type:'Apparel',price:12,sizes:['OS'],method:'Embroidery',colorImages:{Black:sq('30,30,30')}}];
const CARDS=[{id:1,order_id:'etsy-4119530158',sku:'APR-1',title:'Apron',col:'incoming',is_emb:true,payment:5}];
const INV=[{sku:'APR-1',name:'Apron',in_stock:3,reserved:0}];
const PAGES=['/overview','/operator','/dispatch','/designer','/inventory','/purchase','/suppliers','/scan','/campaigns','/earnings',
 '/orders','/orders/FF-2001','/orders/new','/products','/spydeck','/design/maker','/stores','/wallet','/settings','/chat','/dashboard','/analytics','/reports'];
const ROLES=['admin','warehouse','operator','designer','seller'];
(async()=>{
const b=await puppeteer.launch({args:['--no-sandbox']});const p=await b.newPage();
await p.setRequestInterception(true);
p.on('request',r=>{const u=r.url();const J=(d)=>r.respond({status:200,contentType:'application/json',body:JSON.stringify(d)});
 if(!u.includes('/api/'))return r.continue();
 if(u.includes('/api/orders/FF-2001'))return J(ORDERS[1]);
 if(u.includes('/designs'))return J([]); if(u.includes('/threads'))return J([]);
 if(u.includes('design_cards'))return J(CARDS); if(u.includes('design_files'))return J([]);
 if(u.includes('catalog'))return J(CAT); if(u.includes('inventory'))return J(INV);
 if(u.includes('billing'))return J({plan:'pro',balance:120,auto_renew:true,renews_at:'2026-08-18T00:00:00Z',prices:{plans:{starter:0,pro:29,enterprise:99},spydeck:9}});
 if(u.includes('factory/settings'))return J({ship_from:{name:'W',street:'9 Ind',city:'Austin',state:'TX',zip:'78701'},product_types:[]});
 if(u.endsWith('/api/orders'))return J(ORDERS);
 return J([]);});
await p.setViewport({width:1440,height:900});
const rows=[];
for(const role of ROLES){
 await p.evaluateOnNewDocument((x)=>{localStorage.setItem('eg_token','t');localStorage.setItem('eg_user',JSON.stringify({name:'Dev',role:x,plan:'enterprise',spydeck_addon:true}))},role);
 for(const path of PAGES){
  const errs=[];const h=(e)=>errs.push(String(e).slice(0,70));p.on('pageerror',h);
  let landed='(nav fail)';
  try{await p.goto('http://localhost:3588'+path,{waitUntil:'domcontentloaded',timeout:15000});
   await new Promise(x=>setTimeout(x,1000));
   landed=await p.evaluate(()=>location.pathname);}catch(e){}
  p.off('pageerror',h);
  if(errs.length) rows.push({role,path,landed,ERR:[...new Set(errs)]});
  else if(landed!==path) rows.push({role,path,'→':landed});
 }
}
require("fs").writeFileSync("/tmp/audit1.json",JSON.stringify(rows,null,1));console.log("rows:",rows.length);
await b.close();})();

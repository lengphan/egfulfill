/* eg-mkt.js — shared marketing JS across index / howitworks / about:
   folder-tab hero swap (reads window.HERO) + procedural dither engine + terminal typewriter. */

// Keep --hdrh synced to the REAL sticky-header (promo + nav) height so the hero cloud pulls up flush
// behind it — otherwise the stale 83px fallback leaves a blank strip below the header.
(function () {
  function setHdr() {
    var t = document.querySelector('.topstick'); if (!t) return;
    var h = Math.round(t.getBoundingClientRect().height);
    if (h) document.documentElement.style.setProperty('--hdrh', h + 'px');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setHdr); else setHdr();
  window.addEventListener('load', setHdr);
  window.addEventListener('resize', setHdr);
})();

// "What you get" folder-tab swap (reads window.FEAT; only fires where #ftabs + window.FEAT exist).
function setFeat(key, el){
  document.querySelectorAll('#ftabs .ftab').forEach(function(t){ t.classList.toggle('on', t===el); });
  var d=(window.FEAT||{})[key]; if(!d) return;
  var c=document.getElementById('feat-cat'), h=document.getElementById('feat-h'), p=document.getElementById('feat-p');
  if(c) c.textContent=d.cat; if(h) h.textContent=d.h; if(p) p.textContent=d.p;
  var bn=document.getElementById('feat-benefits');
  if(bn && d.b) bn.innerHTML=d.b.map(function(x,i){ return '<div class="benefit"><div class="bruler"><span class="bl">Benefit ['+(i+1)+']</span><span class="rl"></span></div><h4>'+x[0]+'</h4><p>'+x[1]+'</p></div>'; }).join('');
  // right panel: a procedural dither in the tab's accent (always painted, sits behind) + the tab's real
  // artwork on top when images/feat-<key>.jpg exists; until then the img fails to load and the dither shows.
  var dith=document.getElementById('feat-dith'), img=document.getElementById('feat-img');
  if(img) img.style.display='none';   // render a DITHERED version of the artwork into #feat-dith (not the raw photo)
  if(dith && window.EGDither){
    try{
      if(d.img){ EGDither.image(dith, d.img, {palette:EGDither.duotoneFor(d.pop||'violet'), pixel:3, fit:'cover', levels:16, contrast:1.05}); }   // LEGIBLE single-hue duotone in the tab's accent (not a violet+clashing-pop mess) + many tones = subtle dither
      else { EGDither.art(dith, {pop:d.pop||'violet', seed:33, pixel:4}); }
    }catch(e){}
  }
}
// initialise the "What you get" panel for the default (active) tab on load (guarded to this page's panel)
(function(){ if(window.FEAT && document.getElementById('feat-img')){ var t=document.querySelector('#ftabs .ftab.on')||document.querySelector('#ftabs .ftab'); if(t) setFeat('channels', t); } })();

// Hero question typewriter — types/deletes rotating phrases into #hero-word (reduced-motion safe).
(function(){
  var el=document.getElementById('hero-word'); if(!el) return;
  var words=['shipped itself','printed itself','packed itself','tracked itself'];
  var reduce=window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(reduce){ el.textContent=words[0]; return; }
  var wi=0, ci=0, del=false; el.textContent='';
  function tick(){
    var w=words[wi];
    ci += del ? -1 : 1;
    el.textContent = w.slice(0, Math.max(0, ci));
    if(!del && ci>=w.length){ del=true; return setTimeout(tick,2400); }
    if(del && ci<=0){ del=false; wi=(wi+1)%words.length; return setTimeout(tick,500); }
    setTimeout(tick, del?55:100);
  }
  tick();
})();

// Procedural dither engine (Bayer 4x4) — fills every canvas.dith. No image files needed.
(function(){
  var B=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]].map(function(r){return r.map(function(v){return (v+0.5)/16;});});
  function rnd(s){s=(s|0)||1;return function(){s=(s*9301+49297)%233280;return s/233280;};}
  function draw(c){
    var W=c.width,H=c.height,x=c.getContext('2d'),img=x.createImageData(W,H),d=img.data;
    var r=rnd(parseInt(c.dataset.seed||'7',10)), fig=c.dataset.mode==='fig';
    var blobs=[]; for(var b=0;b<4;b++)blobs.push([r(),r(),0.22+r()*0.4,r()>0.5?1:-1]);
    for(var y=0;y<H;y++)for(var xx=0;xx<W;xx++){
      var lum=0.5,u=xx/W,v=y/H;
      for(var k=0;k<blobs.length;k++){var dx=u-blobs[k][0],dy=v-blobs[k][1],dd=Math.sqrt(dx*dx+dy*dy);lum+=blobs[k][3]*Math.max(0,blobs[k][2]-dd)*1.7;}
      if(fig){var cx=Math.abs(u-0.5),body=Math.max(0,1-cx*3.4)*Math.max(0,1-Math.abs(v-0.55)*1.5);lum=lum*0.5+body*0.9;}
      lum=Math.max(0,Math.min(1,lum));
      var on=lum>B[y&3][xx&3],i=(y*W+xx)*4,val=on?232:14;
      d[i]=val;d[i+1]=val;d[i+2]=val;d[i+3]=255;
    }
    x.putImageData(img,0,0);
  }
  function runDith(){ document.querySelectorAll('canvas.dith').forEach(draw); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',runDith); else runDith();
})();

// Terminal typewriter — types #term-txt the first time it scrolls into view (reduced-motion safe).
(function(){
  var el=document.getElementById('term-txt'); if(!el) return;
  var full=el.textContent;
  var cur=document.createElement('span'); cur.className='term-cursor';
  var reduce=window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(reduce){ el.appendChild(cur); return; }
  el.textContent=''; el.appendChild(cur);
  var started=false;
  function type(){
    if(started) return; started=true;
    var i=0;
    (function step(){
      el.textContent=full.slice(0,i); el.appendChild(cur);
      if(i<full.length){ var ch=full[i]; i++; setTimeout(step, ch==='\n'?70:16); }
    })();
  }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ type(); io.disconnect(); } }); },{threshold:0.35});
    io.observe(el);
  } else { type(); }
})();

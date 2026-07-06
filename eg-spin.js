/* eg-spin.js — a procedural, pixelated garment that slowly "spins" (fake-3D horizontal rotation) and
   dithers through the brand palette. No image files, no sprite sheets — 100% code. Drop a canvas:
       <canvas data-spin="tshirt" data-pop="violet"></canvas>
   Optional: data-pop (violet|coral|mint|amber|noir|dusk hex), data-px (cell size), data-speed (0.4=slow).
   Respects prefers-reduced-motion (renders one static frame). Pauses when off-screen. */
(function (global) {
  'use strict';
  var BAYER = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]].map(function(r){return r.map(function(v){return (v+0.5)/16;});});
  var INK=[25,25,24], VIO_DK=[124,58,237], VIO=[139,92,246], PAPER=[240,237,230];
  var POPS={violet:'#8b5cf6',coral:'#f6704f',mint:'#12b886',amber:'#f2b705',pink:'#f06595',sky:'#4c6ef5'};
  function hex(h){h=String(h||'').replace('#','');if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];return [parseInt(h.slice(0,2),16)||0,parseInt(h.slice(2,4),16)||0,parseInt(h.slice(4,6),16)||0];}
  function palFor(pop){ if(pop==='noir')return [[25,25,24],[70,70,66],[130,128,120],[195,190,182],[240,237,230]]; if(pop==='dusk')return [[25,25,24],[58,56,64],[120,116,128],[176,170,186],[240,237,230]]; var P=POPS[pop]||pop||POPS.violet; return [INK,VIO_DK,VIO,hex(P),PAPER]; }

  // Draw a t-shirt silhouette (grayscale, with soft shading) into a low-res context, squashed by sx (fake spin).
  function garment(o, W, H, sx, shade){
    o.clearRect(0,0,W,H);
    o.save();
    o.translate(W/2, 0); o.scale(Math.max(0.05, Math.abs(sx)), 1); o.translate(-W/2, 0);
    var cx=W/2, bw=W*0.44, halfB=bw/2, topY=H*0.24, botY=H*0.82, shoulderY=topY+H*0.10, sleeveY=topY+H*0.20, neck=W*0.10;
    // subtle left/right shading (a lit edge) so the dither reads as a 3D-ish garment
    var g=o.createLinearGradient(cx-halfB-W*0.16,0,cx+halfB+W*0.16,0);
    var edge = sx<0 ? '#7c7c78' : '#f2efe8';
    g.addColorStop(0, edge); g.addColorStop(0.5,'#e7e3db'); g.addColorStop(1, sx<0?'#f2efe8':'#7c7c78');
    o.fillStyle=g;
    o.beginPath();
    o.moveTo(cx-neck, topY);
    o.lineTo(cx-halfB, shoulderY);
    o.lineTo(cx-halfB-W*0.16, sleeveY-H*0.04);          // left sleeve tip
    o.lineTo(cx-halfB-W*0.10, sleeveY+H*0.06);
    o.lineTo(cx-halfB+W*0.02, sleeveY);
    o.lineTo(cx-halfB+W*0.02, botY);                     // left side down
    o.lineTo(cx+halfB-W*0.02, botY);                     // hem
    o.lineTo(cx+halfB-W*0.02, sleeveY);
    o.lineTo(cx+halfB+W*0.10, sleeveY+H*0.06);
    o.lineTo(cx+halfB+W*0.16, sleeveY-H*0.04);           // right sleeve tip
    o.lineTo(cx+halfB, shoulderY);
    o.lineTo(cx+neck, topY);
    o.quadraticCurveTo(cx, topY+H*0.06, cx-neck, topY);  // collar
    o.closePath();
    o.fill();
    // a faint centre crease so it doesn't read totally flat
    o.strokeStyle='rgba(0,0,0,'+(0.10*shade)+')'; o.lineWidth=Math.max(1,W*0.012);
    o.beginPath(); o.moveTo(cx, shoulderY+H*0.04); o.lineTo(cx, botY-H*0.02); o.stroke();
    o.restore();
  }

  function ditherInto(main, off, m, palette){
    var img=off.ctx.getImageData(0,0,m.cw,m.ch), d=img.data, n=palette.length-1;
    for(var y=0;y<m.ch;y++)for(var x=0;x<m.cw;x++){
      var i=(y*m.cw+x)*4; var a=d[i+3];
      if(a<40){ d[i+3]=0; continue; }                    // keep the garment cut-out transparent bg? no—paint bg dark
      var lum=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255*n, lo=Math.floor(lum), frac=lum-lo;
      var idx=frac>BAYER[y&3][x&3]?Math.min(lo+1,n):lo, c=palette[idx];
      d[i]=c[0];d[i+1]=c[1];d[i+2]=c[2];d[i+3]=255;
    }
    off.ctx.putImageData(img,0,0);
    main.ctx.imageSmoothingEnabled=false; main.ctx.clearRect(0,0,m.W,m.H);
    main.ctx.drawImage(off.canvas,0,0,m.cw,m.ch,0,0,m.W,m.H);
  }

  function mount(cv){
    if(cv.__egSpin) return; cv.__egSpin=true;
    var d=cv.dataset, pop=d.pop||'violet', px=d.px?+d.px:4, speed=d.speed?+d.speed:0.5;
    var palette=palFor(pop);
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion:reduce)').matches;
    function size(){ var r=cv.getBoundingClientRect(); var W=Math.max(2,Math.round(r.width)), H=Math.max(2,Math.round(r.height)); cv.width=W; cv.height=H; return {W:W,H:H,cw:Math.max(2,Math.ceil(W/px)),ch:Math.max(2,Math.ceil(H/px))}; }
    var m=size();
    var main={canvas:cv,ctx:cv.getContext('2d')};
    var oc=document.createElement('canvas'); var off={canvas:oc,ctx:oc.getContext('2d')};
    var bg=palette[0];   // darkest = background
    function frame(t){
      m=size(); oc.width=m.cw; oc.height=m.ch;
      off.ctx.fillStyle='rgb('+bg[0]+','+bg[1]+','+bg[2]+')'; off.ctx.fillRect(0,0,m.cw,m.ch);
      var sx = reduce ? 0.82 : Math.cos(t/1000*speed*Math.PI);   // -1..1 spin
      var shade = 0.6 + 0.4*Math.abs(sx);
      garment(off.ctx, m.cw, m.ch, sx, shade);
      ditherInto(main, off, m, palette);
    }
    var visible=true, io;
    if('IntersectionObserver' in global){ io=new IntersectionObserver(function(e){ visible=e[0].isIntersecting; if(visible&&!reduce) loop(); }, {threshold:0}); io.observe(cv); }
    var raf;
    function loop(ts){ if(!visible||reduce) return; frame(ts||0); raf=global.requestAnimationFrame(loop); }
    if(reduce){ frame(0); } else { loop(); }
  }

  function autoInit(root){ (root||document).querySelectorAll('canvas[data-spin]').forEach(mount); }
  global.EGSpin={ mount:mount, autoInit:autoInit };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', function(){autoInit();}); else autoInit();
})(typeof window!=='undefined'?window:this);

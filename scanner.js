/* ---------- data & solver ---------- */
const DATA = JSON.parse(document.getElementById('pogodata').textContent);
const SPECIES = Object.keys(DATA.stats);
const UP = {"candy":[1,1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2,2,2,2,3,3,3,3,3,4,4,4,4,4,6,6,8,8,10,10,12,12,15,0,0,0,0,0,0,0,0,0,0,0],"dust":[200,200,400,400,600,600,800,800,1000,1000,1300,1300,1600,1600,1900,1900,2200,2200,2500,2500,3000,3000,3500,3500,4000,4000,4500,4500,5000,5000,6000,6000,7000,7000,8000,8000,9000,9000,10000,10000,11000,11000,12000,12000,13000,13000,14000,14000,15000],"xl":[10,10,12,12,15,15,17,17,20,20]};   // official per-level power-up costs
const DUST = [...new Set(UP.dust)];
const dustLevel = c => { const lv=[]; UP.dust.forEach((d,i)=>{ if(d===c) lv.push(i+1,i+1.5); });
  return lv.length ? [Math.min(...lv), Math.max(...lv)] : null; };
function costTo(from, to){                       // dust/candy/XL from level to level
  let dust=0, candy=0, xl=0;
  for(let l=from*2; l<to*2; l++){ const idx=Math.floor(l/2)-1;
    dust+=UP.dust[idx]||0;
    if((UP.candy[idx]||0)>0) candy+=UP.candy[idx]; else xl+=UP.xl[idx-39]||20; }
  return {dust,candy,xl};
}
function cpmAt(l){ const i = Math.floor(l)-1;
  return l === Math.floor(l) ? DATA.cpm[i] : Math.sqrt((DATA.cpm[i]**2 + DATA.cpm[i+1]**2)/2); }
function calcCP(b,ia,id,is,m){ return Math.max(10, Math.floor((b[0]+ia)*Math.sqrt(b[1]+id)*Math.sqrt(b[2]+is)*m*m/10)); }
function calcHP(b,is,m){ return Math.max(10, Math.floor((b[2]+is)*m)); }
const TYPES=['NORMAL','FIRE','WATER','GRASS','ELECTRIC','ICE','FIGHTING','POISON','GROUND','FLYING','PSYCHIC','BUG','ROCK','GHOST','DRAGON','DARK','STEEL','FAIRY'];
function solve(species, cp, hp, level, dust, hints){
  let fs = DATA.stats[species]; if(!fs) return [];
  if(hints && hints.length){
    const match = fs.filter(b=>hints.includes(b[3]) && (!b[4]||hints.includes(b[4])));
    if(match.length) fs = match;
  }
  let all = [];
  for(const b of fs) all = all.concat(solveForm(b, cp, hp, level, dust).map(c=>[...c, b]));
  return all;
}
function solveForm(b, cp, hp, level, dust){
  let levels;
  if(level) levels = [level];
  else if(dust && dustLevel(dust)){ const [lo,hi] = dustLevel(dust);
    levels = []; for(let l=lo*2; l<=hi*2; l++) levels.push(l/2); }
  else { levels = []; for(let l=2; l<=110; l++) levels.push(l/2); }
  const res = [];
  for(const lv of levels){ const m = cpmAt(lv);
    for(let is=0; is<16; is++){ if(calcHP(b,is,m) !== hp) continue;
      for(let ia=0; ia<16; ia++) for(let id=0; id<16; id++)
        if(calcCP(b,ia,id,is,m) === cp) res.push([lv,ia,id,is]); } }
  return res;
}

/* ---------- PvP ranking (stat product under CP cap, max level 51 w/ best buddy) ---------- */
const rankCache = new Map();
function maxL(){ return localStorage.getItem('bb')==='1' ? 102 : 100; }   // L50 unless the Best Buddy boost is switched on (Poké Genie's default too)
function maxLevelUnderCap(b, ia, id, is, cap){
  for(let l=maxL(); l>=2; l--){ const lv=l/2;
    if(calcCP(b,ia,id,is,cpmAt(lv))<=cap) return lv; }
  return 1;
}
function statProduct(b, ia, id, is, cap){
  const lv=maxLevelUnderCap(b,ia,id,is,cap), m=cpmAt(lv);
  return {lv, cp:calcCP(b,ia,id,is,m),
          prod:(b[0]+ia)*m * (b[1]+id)*m * Math.floor((b[2]+is)*m)};
}
function pvpTable(b, cap){
  const key=b.slice(0,3).join(',')+'|'+cap+'|'+maxL();
  if(rankCache.has(key)) return rankCache.get(key);
  const rows=[];
  for(let ia=0;ia<16;ia++)for(let id=0;id<16;id++)for(let is=0;is<16;is++)
    rows.push({ia,id,is,...statProduct(b,ia,id,is,cap)});
  rows.sort((a,c)=>c.prod-a.prod);
  const t={max:rows[0].prod, rank:new Map()};
  rows.forEach((r,i)=>t.rank.set(r.ia*256+r.id*16+r.is,{n:i+1,lv:r.lv,cp:r.cp,pct:100*r.prod/rows[0].prod}));
  rankCache.set(key,t); return t;
}
function pvpRank(b, ia, id, is, cap){ return pvpTable(b,cap).rank.get(ia*256+id*16+is); }

/* ---------- PvPoke data (bundled with the app, refreshed weekly by GitHub Actions) ---------- */
let META=null, APP=null;
const APP_VERSION='9.44';
/* which league the whole app is looking at: cap, names and where its data file lives (Great League unless the user picked another one in the menu) */
const LEAGUE={slug:'great',cp:1500,title:'Great League',short:'Great',abbr:'GL'};
const ABBR={great:'GL',ultra:'UL',little:'LC',master:'ML'};
function leagueSlug(){ return localStorage.getItem('league')||'great'; }
function applyLeague(l){ Object.assign(LEAGUE,{slug:l.slug,cp:l.cp,title:l.title,short:(l.title||'').replace(' League','').replace(' Cup',''),abbr:ABBR[l.slug]||(l.cp+' CP'),cup:l.cup,rules:l.rules||null}); paintLeague(); }
function paintLeague(){
  const lb=$('leaguelbl'); if(lb) lb.textContent=LEAGUE.title;
  const f=$('filter'); if(f){ const o=k=>f.querySelector(`option[value="${k}"]`); if(o('gl')) o('gl').text=`${LEAGUE.abbr} eligible (≤${LEAGUE.cp})`; if(o('ready')) o('ready').text=`Ready for ${LEAGUE.abbr}`; }
  const so=$('sort'); if(so){ const o=k=>so.querySelector(`option[value="${k}"]`); if(o('gl')) o('gl').text=`Best ${LEAGUE.abbr} rank`; if(o('meta')) o('meta').text=`${LEAGUE.abbr} meta`; }
}
function setLeague(slug){ if(slug===leagueSlug()&&APP) return; localStorage.setItem('league',slug); status(`Switching to ${slug}…`); loadMeta(); }
function showLoadError(msg){
  for(const id of ['today','board']){ const el=$(id); if(el) el.innerHTML=`<div class="empty"><b>Could not load the planner.</b><br>${msg}<br><br><button class="btn sec" style="margin:0" onclick="location.reload()">Reload</button> <button class="btn sec" style="margin:0" onclick="localStorage.removeItem('roster');location.reload()">Reset planner data and reload</button></div>`; }
}
async function loadMeta(){
  let loaded=false;
  const slow=setTimeout(()=>{ if(!loaded) showLoadError('The PvPoke data file is taking long to load. Offline, or the first visit on a slow connection?'); }, 12000);
  try{
    let slug=leagueSlug(), r=await fetch(`data/app-${slug}.json?v=`+APP_VERSION,{cache:'no-cache'});
    if(!r.ok && slug!=='great'){ localStorage.setItem('league','great'); slug='great'; r=await fetch('data/app-great.json?v='+APP_VERSION,{cache:'no-cache'}); }   // a cup that is no longer featured
    if(!r.ok) throw new Error('HTTP '+r.status);
    APP=await r.json(); loaded=true; clearTimeout(slow);
    applyLeague(APP.league||{slug:'great',cp:1500,title:'Great League'}); rankCache.clear();
    APP.prevo=APP.prevo||{}; APP.unranked=APP.unranked||{}; APP.benchmark=APP.benchmark||{best:720.9,median:521.5};
    META={}; for(const [id,e] of Object.entries(APP.pokemon)) META[id]=[e.rank, e.score, e.moveset];
    const di=$('datainfo'); if(di) di.textContent=`PvPoke ${APP.league.title} rankings, gamemaster ${APP.gamemasterTimestamp.slice(0,10)} · ${APP.meta.length} meta Pokémon`;
    const dl=$('species'); if(dl) dl.innerHTML=Object.keys(APP.pokemon).map(id=>`<option value="${id}">`).join('');
    try{ migrateScans(); dedupeScans(); }catch(e){ console.warn('migration skipped', e); }
  }catch(e){
    clearTimeout(slow);
    showLoadError(`data/app-${leagueSlug()}.json did not load (`+(e&&e.message||e)+').');
    try{  // fallback: live PvPoke rankings, meta chips only
      const r=await fetch('https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-1500.json');
      const arr=await r.json();
      META={}; arr.forEach((e,i)=>META[e.speciesId]=[i+1, Math.round((e.score||0)*10)/10, e.moveset||[]]);
    }catch(e2){}
  }
  // render separately: an error here must be visible, never swallowed
  try{ render(); }catch(e){ console.error(e); status('render error: '+e.message); }
  try{ if(window.Planner) Planner.refresh(); else showLoadError('planner.js did not load.'); }
  catch(e){ console.error(e); showLoadError('Error in the planner: '+(e&&e.message||e)); }
}
loadMeta();
function metaFor(species){
  if(!META||!species) return null;
  const s=species.toLowerCase();
  const ids=Object.keys(META).filter(k=>k===s||k.startsWith(s+'_'));
  if(!ids.length) return null;
  const plain=ids.filter(k=>!k.includes('shadow'));
  const pool=plain.length?plain:ids;
  return META[pool.reduce((a,b)=>META[a][0]<META[b][0]?a:b)];
}
const pretty=m=>m.toLowerCase().replace(/_/g,' ');

/* ---------- pixel helpers ---------- */
function gs(px,i){ return 0.299*px[i]+0.587*px[i+1]+0.114*px[i+2]; }         // r,g,b order (getImageData)
function sat(px,i){ const mx=Math.max(px[i],px[i+1],px[i+2]), mn=Math.min(px[i],px[i+1],px[i+2]);
  return mx===0?0:255*(mx-mn)/mx; }
function hue(px,i){ const r=px[i],g=px[i+1],b=px[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  if(mx===mn) return 0; const d=mx-mn; let h2;
  if(mx===r) h2=((g-b)/d+6)%6; else if(mx===g) h2=(b-r)/d+2; else h2=(r-g)/d+4;
  return h2*30; }  // 0-180, cv2 scale

/* ---------- level from arc (RANSAC port of the validated Python) ---------- */
function detectLevel(px, W, H, trainer){
  const pts=[]; const y0=Math.floor(0.03*H), y1=Math.floor(0.34*H);
  for(let y=y0; y<y1; y+=2) for(let x=0; x<W; x+=2){ const i=(y*W+x)*4;
    if(gs(px,i)>110 && sat(px,i)<60) pts.push([x-W/2, y]); }
  if(pts.length<150) return null;
  let bi=0, bm=null;
  for(let t=0; t<800; t++){
    const p=pts[(Math.random()*pts.length)|0], q=pts[(Math.random()*pts.length)|0];
    const den=2*(p[1]-q[1]); if(Math.abs(den)<1e-6) continue;
    const cy=(p[0]**2+p[1]**2-q[0]**2-q[1]**2)/den;
    const r2=p[0]**2+(p[1]-cy)**2; if(r2<=0) continue;
    const r=Math.sqrt(r2);
    if(r<0.3*W||r>0.62*W||cy<0.1*H||cy>0.5*H) continue;
    let inl=0; for(const s of pts){ if(Math.abs(Math.hypot(s[0],s[1]-cy)-r)<5) inl++; }
    if(inl>bi){ bi=inl; bm=[cy,r]; }
  }
  if(!bm || bi<80) return null;
  // refit on inliers (least squares, cx fixed)
  let Sy=0,S1=0,Syy=0,Sb=0,Syb=0;
  for(const s of pts){ if(Math.abs(Math.hypot(s[0],s[1]-bm[0])-bm[1])>=5) continue;
    const b=s[0]**2+s[1]**2; Sy+=2*s[1]; S1+=1; Syy+=4*s[1]**2; Sb+=b; Syb+=2*s[1]*b; }
  const det=Syy*S1-Sy*Sy; if(Math.abs(det)<1e-6) return null;
  const cy=(Syb*S1-Sy*Sb)/det, k=(Syy*Sb-Sy*Syb)/det, r=Math.sqrt(k+cy*cy);
  // dot: bright colorless pixels within 12px of circle, angular histogram peak
  const hist=new Float32Array(360); const angs=[];
  for(let y=y0; y<Math.floor(0.4*H); y++) for(let x=0; x<W; x++){ const i=(y*W+x)*4;
    if(gs(px,i)>225 && sat(px,i)<50){
      const d=Math.abs(Math.hypot(x-W/2, y-cy)-r);
      if(d<12){ const a=Math.atan2(cy-y, x-W/2)*180/Math.PI;
        if(a>5&&a<175){ angs.push(a); hist[Math.floor(a*2)]++; } } } }
  if(angs.length<30) return null;
  let pk=0; for(let i=1;i<360;i++) if(hist[i]>hist[pk]) pk=i;
  const sel=angs.filter(a=>a>pk/2-2 && a<pk/2+2.5).sort((a,b)=>a-b);
  const ang=sel[Math.floor(sel.length/2)];
  const frac=(180-ang)/180;
  const mx=Math.min(trainer+10,50);
  const target=cpmAt(1)+frac*(cpmAt(mx)-cpmAt(1));
  let best=1, bd=1e9;
  for(let l=2;l<=mx*2;l++){ const d=Math.abs(cpmAt(l/2)-target); if(d<bd){bd=d;best=l/2;} }
  return best;
}

/* ---------- OCR ---------- */
let worker=null;
async function getWorker(){
  if(worker) return worker;
  if(typeof Tesseract==='undefined') throw new Error('text recognition library did not load (vendor/tesseract)');
  status('Loading text recognition…');
  const base=new URL('vendor/tesseract/', location.href).href;
  worker=await Tesseract.createWorker('eng', 1, {workerPath: base+'worker.min.js', corePath: base, langPath: base, gzip: true,
    logger: m=>{ if(m.status&&m.progress!==undefined&&m.status!=='recognizing text') status(`${m.status} ${Math.round(m.progress*100)}%`); }});
  return worker;
}

function binarize(ctx,W,H,x0,y0,w,h,scale,fn){    // returns canvas: black text on white
  const src=ctx.getImageData(x0,y0,w,h).data;
  const c2=document.getElementById('cv2'); c2.width=w*scale; c2.height=h*scale;
  const g=c2.getContext('2d');
  const im=g.createImageData(w,h);
  for(let i=0;i<w*h;i++){ const v = fn(src,i*4) ? 0 : 255;
    im.data[i*4]=im.data[i*4+1]=im.data[i*4+2]=v; im.data[i*4+3]=255; }
  const tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
  tmp.getContext('2d').putImageData(im,0,0);
  g.imageSmoothingEnabled=true; g.drawImage(tmp,0,0,w*scale,h*scale);
  return c2;
}

async function dustFromPill(ctx, W, H){
  const px=ctx.getImageData(0,0,W,H).data;
  let bestY=-1, bestN=0;
  for(let y=Math.floor(0.45*H); y<H; y+=3){ let n=0;
    for(let x=0; x<0.55*W; x+=3){ const i=(y*W+x)*4;
      const h2=hue(px,i);
      if(h2>40&&h2<95 && sat(px,i)>60 && Math.max(px[i],px[i+1],px[i+2])>120) n++; }
    if(n>bestN){ bestN=n; bestY=y; } }
  if(bestN < 0.15*W/3) return null;
  const band=Math.floor(0.028*H);
  const sx=Math.floor(0.5*W), sw2=W-sx, sh2=2*band;
  const sd=ctx.getImageData(sx,bestY-band,sw2,sh2).data;
  const c2=document.getElementById('cv2'); c2.width=sw2*2; c2.height=sh2*2;
  const g2=c2.getContext('2d'); const im=g2.createImageData(sw2,sh2);
  for(let i=0;i<sw2*sh2;i++){ const v=gs(sd,i*4)<120?0:255; const k=i*4;
    im.data[k]=im.data[k+1]=im.data[k+2]=v; im.data[k+3]=255; }
  const tc=document.createElement('canvas'); tc.width=sw2; tc.height=sh2;
  tc.getContext('2d').putImageData(im,0,0);
  g2.drawImage(tc,0,0,sw2*2,sh2*2);
  const wk=await getWorker();
  await wk.setParameters({tessedit_char_whitelist:'0123456789.,', tessedit_pageseg_mode:'7'});
  const t=(await wk.recognize(c2)).data.text;
  for(const x of t.match(/\d[\d.,]*/g)||[]){
    const v=parseInt(x.replace(/[.,]/g,''));
    if(DUST.includes(v)) return v;
    if(x[0]==='1'){ const v2=parseInt(x.slice(1).replace(/[.,]/g,'')||'0');
      if(DUST.includes(v2)) return v2; }
  }
  return null;
}
async function scanFrame(ctx, W, H, trainer){
  const out={};
  // CP: sky-adaptive binarize, central text components only (v3)
  out.cpCandidates = [];
  const sx=Math.floor(0.15*W), sy=Math.floor(0.03*H), sw=Math.floor(0.70*W), sh=Math.floor(0.10*H);
  const sd=ctx.getImageData(sx,sy,sw,sh).data;
  const gvals=[]; for(let i=0;i<sw*sh;i+=7) gvals.push(gs(sd,i*4));
  gvals.sort((a,b)=>a-b); const bg=gvals[gvals.length>>1];
  const thr=Math.min(235,bg+45);
  const bin=new Uint8Array(sw*sh);
  for(let i=0;i<sw*sh;i++){ const j=i*4; if(gs(sd,j)>thr && sat(sd,j)<45) bin[i]=1; }
  // connected components via BFS
  const lab=new Int32Array(sw*sh).fill(-1); const comps=[]; const qx=new Int32Array(sw*sh);
  for(let s0=0;s0<sw*sh;s0++){ if(!bin[s0]||lab[s0]>=0) continue;
    const id=comps.length; let head=0,tail=0; qx[tail++]=s0; lab[s0]=id;
    let x0=sw,x1=0,y0=sh,y1=0,area=0;
    while(head<tail){ const p=qx[head++]; const px2=p%sw, py2=(p/sw)|0; area++;
      if(px2<x0)x0=px2; if(px2>x1)x1=px2; if(py2<y0)y0=py2; if(py2>y1)y1=py2;
      const nb=[p-1,p+1,p-sw,p+sw,p-sw-1,p-sw+1,p+sw-1,p+sw+1];
      for(const q of nb){ if(q<0||q>=sw*sh||bin[q]===0||lab[q]>=0) continue;
        const dx=Math.abs(q%sw - px2); if(dx>1) continue; lab[q]=id; qx[tail++]=q; } }
    comps.push({x0,x1,y0,y1,area,w:x1-x0+1,h:y1-y0+1});
  }
  let cs=comps.filter(c=>c.area>80 && (c.x0+c.w/2)/sw>0.2 && (c.x0+c.w/2)/sw<0.8 && c.w<2.5*c.h);
  if(cs.length){
    const tall=cs.reduce((a,b)=>b.h>a.h?b:a);
    const yc=tall.y0+tall.h/2;
    cs=cs.filter(c=>c.h>0.5*tall.h && Math.abs(c.y0+c.h/2-yc)<tall.h);
    const bx0=Math.max(0,Math.min(...cs.map(c=>c.x0))-6), bx1=Math.min(sw,Math.max(...cs.map(c=>c.x1))+6);
    const by0=Math.max(0,Math.min(...cs.map(c=>c.y0))-6), by1=Math.min(sh,Math.max(...cs.map(c=>c.y1))+6);
    const c2=document.getElementById('cv2'); const lw=bx1-bx0, lh=by1-by0;
    c2.width=lw*3; c2.height=lh*3;
    const g2=c2.getContext('2d'); const im=g2.createImageData(lw,lh);
    for(let y=0;y<lh;y++) for(let x=0;x<lw;x++){ const v=bin[(y+by0)*sw+(x+bx0)]?0:255; const k=(y*lw+x)*4;
      im.data[k]=im.data[k+1]=im.data[k+2]=v; im.data[k+3]=255; }
    const tc=document.createElement('canvas'); tc.width=lw; tc.height=lh;
    tc.getContext('2d').putImageData(im,0,0);
    g2.drawImage(tc,0,0,lw*3,lh*3);
    const wk=await getWorker();
    await wk.setParameters({tessedit_char_whitelist:'CPcp0123456789 ', tessedit_pageseg_mode:'7'});
    const t0=(await wk.recognize(c2)).data.text.replace(/\s/g,'');
    const m0=t0.match(/(\d{2,4})/); if(m0) out.cpCandidates.push(parseInt(m0[1]));
  }
  // card region: dark text on white card
  const wk=await getWorker();
  await wk.setParameters({tessedit_char_whitelist:'', tessedit_pageseg_mode:'6'});
  const c2=document.getElementById('cv2');
  const ch=Math.floor(0.55*H); c2.width=Math.floor(W/2); c2.height=Math.floor(ch/2);
  c2.getContext('2d').drawImage(ctx.canvas, 0, Math.floor(0.28*H), W, ch, 0,0, c2.width, c2.height);
  t=(await wk.recognize(c2)).data.text;
  let flat=t.replace(/\n/g,' ');
  const parseHp=f=>{ const m2=f.match(/(\d+)\s*\/\s*(\d+)\s*HP/i); return m2?parseInt(m2[2]):undefined; };
  out.hp=parseHp(flat);
  if(!out.hp){                                            // small HP text on a video frame: look again at full scale
    c2.width=W; c2.height=ch; c2.getContext('2d').drawImage(ctx.canvas, 0, Math.floor(0.28*H), W, ch, 0,0, W, ch);
    const t2=(await wk.recognize(c2)).data.text.replace(/\n/g,' ');
    out.hp=parseHp(t2); if(t2.length>flat.length*0.6) flat=t2+' '+flat;
  }
  m=flat.match(/CP\s*(\d{2,4})/i); if(m) out.cpCandidates.push(parseInt(m[1]));
  out.hints=[];
  const words=flat.toUpperCase().match(/[A-Z]{3,}/g)||[];
  const candy=new Set(); words.forEach((w,i)=>{ if(DATA.stats[w] && /^CANDY|^SNOEP/.test(words[i+1]||'')) candy.add(w); });
  for(const w2 of words){
    if(!out.species && DATA.stats[w2] && !candy.has(w2)) out.species=w2;
    if(TYPES.includes(w2) && !out.hints.includes(w2)) out.hints.push(w2);
  }
  out.candySpecies=[...candy][0]||null;
  if(!out.species){                                       // nickname or an IV overlay over the name: keep a truncated header token ("TINKAT…")
    const hpAt=flat.toUpperCase().search(/\d\s*\/\s*\d+\s*HP/); const head=(hpAt>0?flat.slice(0,hpAt):flat).toUpperCase().match(/[A-Z]{4,}/g)||[];
    out.nameToken=head.find(w=>!DATA.stats[w])||null;
  }
  out.txt = flat.toLowerCase().replace(/[^a-z ]/g,' ').replace(/ +/g,' ').slice(0,300);
  out.dust = await dustFromPill(ctx, W, H);
  if(!out.dust) for(const n of flat.match(/\b\d{1,2}[.,]\d{3}\b|\b\d{3,4}\b/g)||[]){
    const v=parseInt(n.replace(/[.,]/g,''));
    if(DUST.includes(v)){ out.dust=v; }
  }
  // level
  const px=ctx.getImageData(0,0,W,H).data;
  out.level=detectLevel(px,W,H,trainer);
  if(out.level && out.dust && dustLevel(out.dust)){          // dust window is authoritative
    const [lo,hi]=dustLevel(out.dust);
    if(out.level<lo||out.level>hi) out.level=Math.max(lo,Math.min(hi,out.level));
  }
  return out;
}

/* ---------- appraisal screen (IV bars) ---------- */
/* readAppraisal(ctx,W,H) -> [atk,def,hp] or null. Reads the three IV bars of the in-game appraisal panel. */
function readAppraisal(ctx, W, H){
  const x0=0, x1=Math.floor(0.6*W), y0=Math.floor(0.45*H), y1=Math.floor(0.97*H);
  const w=x1-x0, h=y1-y0, d=ctx.getImageData(x0,y0,w,h).data;
  const org=i=>{ const r=d[i],g=d[i+1],b=d[i+2]; return r>200&&g>120&&g<212&&b<150&&r-b>70; };   // bar fill ≈ (244,166,76), looser for video frames
  const grey=i=>{ const r=d[i],g=d[i+1],b=d[i+2]; return r>195&&r<248&&Math.abs(r-g)<14&&Math.abs(g-b)<14; }; // empty track ≈ (226,226,228)
  const maxGap=Math.round(0.015*W);
  // per row: longest run of track pixels (orange or grey, small white gaps allowed) starting in the left half
  function rowRun(y){
    let best=null, start=-1, last=-1, oMin=-1, oMax=-1, hasO=false, hasG=false;
    const flush=()=>{ if(start>=0){ const len=last-start+1; if(!best||len>best.len) best={x0:start,x1:last,len,oMin,oMax,hasO,hasG}; } start=-1; oMin=oMax=-1; hasO=hasG=false; };
    for(let x=0;x<w;x++){ const i=(y*w+x)*4, o=org(i), g=!o&&grey(i);
      if(o||g){ if(start<0) start=x; last=x; if(o){ if(oMin<0) oMin=x; oMax=x; hasO=true; } else hasG=true; }
      else if(start>=0 && x-last>maxGap) flush(); }
    flush(); return best;
  }
  const bands=[]; let cur=null;
  for(let y=0;y<h;y++){
    const r=rowRun(y);
    const ok=r && r.len>0.22*W && r.len<0.5*W && r.x0<0.25*W && (r.hasO||r.hasG);
    if(ok){ if(cur && y-cur.y1<=2){ cur.y1=y; cur.rows.push(r); } else { cur={y0:y,y1:y,rows:[r]}; bands.push(cur); } }
  }
  const good=bands.filter(b=>{ const bh=b.y1-b.y0+1; return bh>=0.005*H && bh<=0.02*H; });
  // the three bars: consecutive bands with the same left edge, the same track width and even spacing
  for(let i=0;i+2<good.length;i++){
    const tri=good.slice(i,i+3), rs=tri.map(b=>b.rows[b.rows.length>>1]);
    const lefts=rs.map(r=>r.x0), tots=rs.map(r=>r.len);
    if(Math.max(...lefts)-Math.min(...lefts)>0.01*W) continue;
    if(Math.max(...tots)-Math.min(...tots)>0.05*Math.max(...tots)) continue;
    const g1=tri[1].y0-tri[0].y0, g2=tri[2].y0-tri[1].y0;
    if(Math.abs(g1-g2)>0.25*Math.max(g1,g2)) continue;
    if(rs.some(r=>r.hasO && r.oMin-r.x0>0.01*W)) continue;      // fill must start at the left edge of the track
    return rs.map(r=>Math.max(0,Math.min(15,Math.round((r.hasO? r.oMax-r.oMin+1 : 0)/r.len*15))));
  }
  return null;
}

const APPR=JSON.parse(localStorage.getItem('appr')||'{}');          // appraisals waiting for their status screen
function saveAppr(){ localStorage.setItem('appr',JSON.stringify(APPR)); }
function applyAppraisal(r, ivs){
  r.appraisal=ivs;
  const m=r.combos.filter(c=>c[1]===ivs[0]&&c[2]===ivs[1]&&c[3]===ivs[2]);
  if(m.length){ r.combos=m; r.apMismatch=false; }
  else {                                                     // re-solve with the IVs fixed, any level
    const res=[];
    for(const b of DATA.stats[r.species]||[]) for(let l=2;l<=110;l++){ const lv=l/2, m2=cpmAt(lv);
      if(calcCP(b,ivs[0],ivs[1],ivs[2],m2)===r.cp && (!r.hp||calcHP(b,ivs[2],m2)===r.hp)) res.push([lv,ivs[0],ivs[1],ivs[2],b]); }
    if(res.length){ r.combos=res; r.apMismatch=false; }
    else if(r.hp){                                            // CP misread? IVs + HP (+ dust window) pin the level, so infer the CP
      const win=r.dust&&dustLevel(r.dust)?dustLevel(r.dust):[1,55], cands=[];
      for(const b of DATA.stats[r.species]||[]) for(let l=win[0]*2;l<=win[1]*2;l++){ const lv=l/2, m2=cpmAt(lv);
        if(calcHP(b,ivs[2],m2)===r.hp) cands.push([lv,ivs[0],ivs[1],ivs[2],b]); }
      const digits=String(r.cp||''), fit=cands.filter(c=>{ const cpc=String(calcCP(c[4],c[1],c[2],c[3],cpmAt(c[0]))); return !digits||cpc.startsWith(digits)||cpc.endsWith(digits)||cpc.includes(digits); });
      const pick=fit.length===1?fit:(cands.length===1?cands:[]);
      if(pick.length){ r.cp=calcCP(pick[0][4],pick[0][1],pick[0][2],pick[0][3],cpmAt(pick[0][0])); r.combos=pick; r.cpInferred=true; r.apMismatch=false; r.key=`${r.species}|${r.cp}|${r.hp}|${pick[0][0]}|${r.dust??''}`; }
      else r.apMismatch=true;
    } else r.apMismatch=true;
  }
  if(r.combos.length){ const lv=[...new Set(r.combos.map(c=>c[0]))]; r.level=lv.length===1?lv[0]:r.level; }
}
function apKeys(species,cp,hp){ const k=[]; if(cp) k.push(species+'|'+cp); if(hp) k.push(species+'|hp'+hp); return k; }
async function handleAppraisal(ctx,W,H,trainer,ivs,skipKey){
  const s=await scanFrame(ctx,W,H,trainer);              // species, HP and CP are still visible on the appraisal screen
  if(!s.species) s.species=inferSpecies(s, ivs);
  if(!s.species){ note(`appraisal ${ivs.join('/')}: ${seen(s)} → species unknown`); return null; }
  if(s.inferred) note(`appraisal: name hidden, took ${s.inferred}`);
  const cp=s.cpCandidates.find(c=>c>=10), key=`${s.species}|${cp??''}|${s.hp??''}|${ivs.join('/')}`;
  if(key===skipKey) return key;
  const attach=r=>{ gain('appr',r.species); applyAppraisal(r,ivs); if(window.Planner) Planner.onNewScan(r); save(); render(); status(`Appraisal ${ivs.join('/')} → ${s.species} ${r.cp} CP`); return key; };
  if(UPDATE){ const target=results.find(x=>x.key===UPDATE); if(target && target.species===s.species) return attach(target); }
  const r=sameCopy(s.species, cp||null, s.hp||null);
  if(r) return attach(r);
  if((s.hp||cp) && DATA.stats[s.species]){
    // the appraisal screen shows name, CP, the level arc and usually HP: with the IVs that is enough for a card of its own
    s.cp=cp||null; s.cpCandidates=s.cpCandidates||[];
    s.combos=(cp&&s.hp)?solve(s.species,cp,s.hp,s.level||null,s.dust||null,s.hints):[];
    applyAppraisal(s,ivs);                                  // pins the IVs, or infers the CP from HP when it was misread
    if(!s.combos.length && cp && !s.hp){                    // no HP read: IVs + CP (+ the level arc) still pin the level; a dropped digit is recovered too
      const fixed=cpFromDigits(s.species,String(cp),null,s.level||null,ivs); const want=fixed||cp;
      const res=[]; for(const b of DATA.stats[s.species]) for(let l=2;l<=110;l++){ const lv=l/2, m2=cpmAt(lv); if(calcCP(b,ivs[0],ivs[1],ivs[2],m2)===want && (!s.level||Math.abs(lv-s.level)<=3)) res.push([lv,ivs[0],ivs[1],ivs[2],b]); }
      if(res.length){ if(s.level) res.sort((a,b)=>Math.abs(a[0]-s.level)-Math.abs(b[0]-s.level)); s.combos=[res[0]]; s.cp=want; if(fixed&&fixed!==cp) s.cpInferred=true; s.apMismatch=false; }
    }
    if(s.combos.length){
      const forms=DATA.stats[s.species]||[]; if(forms.length>1){   // same stats, several forms: the type hints decide, else the form PvPoke ranks higher
        const c0=s.combos[0], same=forms.filter(b=>b[0]===c0[4][0]&&b[1]===c0[4][1]&&b[2]===c0[4][2]);
        const hinted=same.filter(b=>(s.hints||[]).length&&[b[3],b[4]].filter(Boolean).every(t=>s.hints.includes(t)));
        const pool=hinted.length?hinted:same, rk=b=>{ const id=pvpokeIdFor(s.species,b); return id&&APP.pokemon[id]?APP.pokemon[id].rank:9999; };
        const best=pool.slice().sort((a,b)=>rk(a)-rk(b))[0]; if(best) s.combos=s.combos.map(c=>[c[0],c[1],c[2],c[3],best]); }
      if(!s.hp){ const c0=s.combos[0]; s.hp=calcHP(c0[4],c0[3],cpmAt(c0[0])); note(`HP not read, taken from CP and IVs: ${s.hp}`); }
      const lv=[...new Set(s.combos.map(c=>c[0]))]; s.level=lv.length===1?lv[0]:s.level;
      s.key=`${s.species}|${s.cp}|${s.hp}|${s.level??''}|${s.dust??''}`;
      const twin=results.find(x=>x.species===s.species && x.cp===s.cp && x.hp===s.hp);   // the inferred CP points at a card we already have
      if(twin) return attach(twin);
      results.unshift(s); if(window.Planner) Planner.onNewScan(s); save(); render(); gain('new',s);
      status(`${s.species} ${s.cp} CP · appraised ${ivs.join('/')}`); return key;
    }
  }
  for(const k of apKeys(s.species,cp,s.hp)) APPR[k]=ivs; saveAppr(); status(`Appraisal ${ivs.join('/')} stored for ${s.species} ${cp??''}`);
  return key;
}

/* ---------- species inference when the name is hidden (nickname, IV overlay): candy line + evolution family + solvability ---------- */
function familyOf(sp){
  const out=new Set([sp]); if(!APP) return [...out];
  const base=sp.toLowerCase();
  const chain=id=>{ const c=[id]; let cur=id; for(let i=0;i<4;i++){ const pr=(APP.prevo||{})[cur]; if(!pr) break; c.push(pr); cur=pr; } return c; };
  for(const id of Object.keys(APP.pokemon).concat(Object.keys(APP.unranked||{}))){
    if(chain(id).some(x=>x.split('_')[0]===base)){ const up=id.split('_')[0].toUpperCase(); if(DATA.stats[up]) out.add(up); }
  }
  return [...out];
}
function prefixCandidates(token){
  if(!token) return [];
  for(let n=Math.min(token.length,8); n>=5; n--){ const pre=token.slice(0,n); const hits=Object.keys(DATA.stats).filter(k=>k.startsWith(pre)); if(hits.length&&hits.length<=6) return hits; }
  return [];
}
function fitsSpecies(sp, cp, hp, level, ivs){
  if(!DATA.stats[sp]||!cp) return false;
  if(ivs){ for(const b of DATA.stats[sp]) for(let l=2;l<=110;l++){ const lv=l/2, m2=cpmAt(lv);
      if(calcCP(b,ivs[0],ivs[1],ivs[2],m2)!==cp) continue;
      if(hp && calcHP(b,ivs[2],m2)!==hp) continue;
      if(!hp && level && Math.abs(lv-level)>3) continue;      // no HP read: the level arc must at least roughly agree
      return true; } return false; }
  if(!hp) return false;
  for(const lv of level?[level,level-0.5,level+0.5,null]:[null]) if(solve(sp,cp,hp,lv,null,[]).length) return true;
  return false;
}
function speciesCandidates(s){ return [...new Set((s.candySpecies?familyOf(s.candySpecies):[]).concat(prefixCandidates(s.nameToken)))]; }
function cpFromDigits(sp, digits, hp, level, ivs){   // the CP lost a digit ("794" read as "94"): the one CP that contains the digits, matches the HP and sits near the level arc
  if(!DATA.stats[sp]||!digits) return null;
  const cps=new Map(), lvs=[];
  if(level){ for(let l=Math.max(2,Math.round((level-1.5)*2)); l<=Math.min(110,Math.round((level+1.5)*2)); l++) lvs.push(l/2); }
  else if(hp||ivs){ for(let l=2;l<=110;l++) lvs.push(l/2); } else return null;
  for(const b of DATA.stats[sp]) for(const lv of lvs){ const m=cpmAt(lv);
    const sta=ivs?[ivs[2]]:[...Array(16).keys()];
    for(const is of sta){ if(hp&&calcHP(b,is,m)!==hp) continue;
      const pairs=ivs?[[ivs[0],ivs[1]]]:null;
      const add=c=>{ const k=String(c); if(!k.includes(digits)) return; const cur=cps.get(c)||{end:false,near:false}; cur.end=cur.end||k.endsWith(digits); cur.near=cur.near||!level||Math.abs(lv-level)<=0.5; cps.set(c,cur); };
      if(pairs) add(calcCP(b,pairs[0][0],pairs[0][1],is,m));
      else for(let ia=0;ia<16;ia++) for(let id=0;id<16;id++) add(calcCP(b,ia,id,is,m)); } }
  const all=[...cps.entries()];
  for(const pick of [all.filter(([,v])=>v.near&&v.end), all.filter(([,v])=>v.end), all.filter(([,v])=>v.near), all]) if(pick.length===1) return pick[0][0];
  return null;
}
function inferSpecies(s, ivs){
  const cps=[...new Set(s.cpCandidates||[])].filter(c=>c>=10);
  const cands=speciesCandidates(s);
  if(!cands.length) return null;
  // a card we already hold with this CP is the strongest cue (the appraisal usually follows its own status screen)
  const known=results.find(x=>!x.superseded && cands.includes(x.species) && cps.includes(x.cp) && (!s.hp||!x.hp||x.hp===s.hp));
  if(known){ s.inferred=`${known.species} from the ${known.cp} CP card`; return known.species; }
  const fit=cands.filter(sp=>cps.some(cp=>fitsSpecies(sp,cp,s.hp,s.level,ivs)));
  let pick=fit.length===1?fit[0]:null;
  if(!pick && fit.length>1){ const withMoves=fit.filter(sp=>{ const mv=readMoves(sp,s.txt); return mv&&mv.found; }); pick=withMoves.length===1?withMoves[0]:fit[fit.length-1]; }
  if(!pick && cps.length===1){                              // nothing solves as read: maybe the CP lost a digit
    const hits=cands.map(sp=>[sp,cpFromDigits(sp,String(cps[0]),s.hp,s.level,ivs)]).filter(x=>x[1]);
    if(hits.length===1){ pick=hits[0][0]; s.cpCandidates=[hits[0][1]]; s.cpInferred=true; s.inferred=`${pick}, CP ${hits[0][1]} (read as ${cps[0]})`; return pick; }
  }
  if(pick) s.inferred=`${pick} from ${s.candySpecies?s.candySpecies+' candy':''}${s.nameToken?(s.candySpecies?' + ':'')+'"'+s.nameToken+'"':''}`;
  return pick;                                              // nothing solves: better no card than a wrong one
}
function note(txt){ gain('note', txt); }
function seen(s){ return `${s.species||(s.candySpecies?'?('+s.candySpecies+' candy)':s.nameToken?'"'+s.nameToken+'"':'?')} cp[${[...new Set(s.cpCandidates||[])].join(',')}] hp${s.hp||'?'} L${s.level||'?'}`; }

/* ---------- moves from OCR text (status screen scrolled to the attacks) ---------- */
const normTxt=t=>' '+String(t||'').toLowerCase().replace(/[^a-z ]/g,' ').replace(/ +/g,' ').trim()+' ';
function readMoves(species, txt){                  // {fast, charged:[..], second:true|false|undefined, found}
  if(!APP||!species) return null;
  const ids=[...new Set((DATA.stats[species]||[null]).map(b=>pvpokeIdFor(species,b)).filter(Boolean))]; if(!ids.length) return null;
  if(ids.length>1){ const best=ids.map(i=>readMovesFor(species,i,txt)).filter(Boolean).sort((a,b)=>b.found-a.found)[0]; return best||null; }   // regional forms: the one whose moves appear
  return readMovesFor(species, ids[0], txt);
}
function readMovesFor(species, id, txt){
  const e=APP.pokemon[id], t=normTxt(txt);
  const pos=m=>{ const n=APP.moves[m]?normTxt(APP.moves[m].n).trim():''; if(!n) return -1; const i=t.indexOf(' '+n+' '); return i; };
  const fast=e.fast.map(m=>[pos(m),m]).filter(x=>x[0]>=0).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  const ch=e.charged.map(m=>[pos(m),m]).filter(x=>x[0]>=0).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  const newAttack=/ new attack /.test(t)||/ nieuwe aanval /.test(t);
  const found=fast.length+ch.length; if(!found) return null;
  return {id, fast:fast[0]||null, charged:ch.slice(0,2), second: ch.length>=2?true:(newAttack?false:undefined), found};
}
function applyMoves(r, mv){                        // merge what a moves screen showed into a card; returns true when something changed
  if(!mv||!r) return false;
  const e=APP.pokemon[mv.id], cur=(r.moves&&r.moves.length)?r.moves.slice():[];
  const fast=mv.fast||cur[0]||e.moveset[0];
  let charged=mv.charged.slice();
  if(charged.length<2 && mv.second!==false){ for(const m of cur.slice(1)) if(charged.length<2 && m && !charged.includes(m)) charged.push(m); }   // only what was seen before; never PvPoke's default as if it were on the Pokémon
  const next=[fast,...charged];
  const changed=JSON.stringify(next)!==JSON.stringify(cur)||(mv.second!==undefined&&r.secondMove!==mv.second);
  r.moves=next; if(mv.second!==undefined) r.secondMove=mv.second; r.movesSeen=Date.now();
  return changed;
}
/* ---------- one card per physical Pokémon ----------
   Identity = species + CP + HP (both as shown on the status screen). Every path (status screen, appraisal, attacks screen,
   video frame) asks sameCopy() before creating a card, so the pieces land on one card. A power-up changes CP and HP, so it
   makes a new card and archives the old one (onNewScan in planner.js recognises the IV overlap). Two copies of one species
   with identical CP and HP are treated as one card; that is the one case we cannot tell apart from a screenshot. */
function sameCopy(species, cp, hp, skipKey){
  const live=results.filter(x=>!x.superseded && x.species===species);
  if(skipKey){ const prev=live.find(x=>x.key===skipKey); if(prev && (!cp||prev.cp===cp||!prev.cp) && (!hp||!prev.hp||prev.hp===hp)) return prev; }
  if(cp){ const m=live.filter(x=>x.cp===cp && (!hp||!x.hp||x.hp===hp)); if(m.length) return m[0]; }
  if(hp){ const digits=String(cp||''), m=live.filter(x=>x.hp===hp && x.cp && (!digits||String(x.cp).includes(digits)));   // CP lost a digit?
    if(m.length===1) return m[0]; }
  return null;
}
function dedupeScans(){                          // fold cards that describe the same physical Pokémon into one; returns how many were folded
  const live=results.filter(x=>!x.superseded && x.cp && x.hp), seen=new Map(); let n=0;
  for(const r of live){ const k=`${r.species}|${r.cp}|${r.hp}`; const first=seen.get(k); if(!first){ seen.set(k,r); continue; }
    mergeScan(first, r); results.splice(results.indexOf(r),1); n++; }
  if(n){ save(); render(); if(window.Planner) Planner.markDirty(); }
  return n;
}
function mergeScan(keep, other){                  // keep takes everything the other card knew
  if(other.appraisal && !keep.appraisal){ applyAppraisal(keep, other.appraisal); }
  if(other.movesSeen && (!keep.movesSeen || other.movesSeen>keep.movesSeen)){ keep.moves=other.moves; keep.secondMove=other.secondMove; keep.movesSeen=other.movesSeen; }
  else if(!keep.moves && other.moves){ keep.moves=other.moves; keep.secondMove=other.secondMove; }
  if(other.secondMove!==undefined && keep.secondMove===undefined) keep.secondMove=other.secondMove;
  keep.fav=keep.fav||other.fav; keep.bench=keep.bench||other.bench;
  if(!keep.level && other.level) keep.level=other.level;
  if(other.combos && other.combos.length && (!keep.combos.length || (other.combos.length<keep.combos.length && !keep.appraisal))) keep.combos=other.combos;
  if(!keep.txt && other.txt) keep.txt=other.txt;
}
function ivKeys(r){ return new Set((r.appraisal?[[0,...r.appraisal]]:r.combos).map(c=>c.slice(1,4).join('/'))); }
function updateCard(target, s, mvSeen){          // the same Pokémon after a power-up or evolution: keep the card, move it to the new CP/HP/level, remember where it came from
  const keys=ivKeys(target), fit=s.combos.filter(c=>keys.has(c.slice(1,4).join('/')));
  if(!fit.length) return false;
  const old={t:Date.now(), species:target.species, cp:target.cp, hp:target.hp, level:target.level};
  target.history=(target.history||[]).concat([old]).slice(-12);
  target.species=s.species; target.cp=s.cp; target.hp=s.hp; target.combos=fit; target.dust=s.dust||null; target.txt=s.txt; target.cpInferred=!!s.cpInferred; target.superseded=null;
  const lv=[...new Set(fit.map(c=>c[0]))]; target.level=lv.length===1?lv[0]:null;
  if(target.appraisal) applyAppraisal(target,target.appraisal);
  if(old.species!==target.species){ target.moves=null; target.secondMove=undefined; target.movesSeen=null; }   // an evolution has its own moves
  if(mvSeen) applyMoves(target,mvSeen);
  target.key=`${target.species}|${target.cp}|${target.hp}|${target.level??''}|${target.dust??''}`;
  save(); render(); gain('updated',`${old.species} ${old.cp} → ${target.species} ${target.cp} CP`);
  if(window.Planner) Planner.onUpdated(target, old);
  return true;
}
function movesTarget(species, skipKey, hp){        // which card an attacks screen belongs to
  const live=results.filter(x=>!x.superseded);
  const prev=skipKey?live.find(x=>x.key===skipKey):null;
  if(species){ if(prev&&prev.species===species) return prev; return sameCopy(species,null,hp||null)||live.find(x=>x.species===species)||null; }
  return prev||null;
}
function attachMovesFromText(txt, speciesInText, skipKey, hp){
  const target=movesTarget(speciesInText, skipKey, hp); if(!target){ if(speciesInText) gain('note',`attacks of ${speciesInText} seen, but there is no ${speciesInText} card to put them on`); return null; }
  const mv=readMoves(target.species, txt); if(!mv) return null;
  const changed=applyMoves(target, mv); save(); render(); if(changed) gain('moves',target.species);
  const names=[mv.fast,...mv.charged].filter(Boolean).map(m=>APP.moves[m]?APP.moves[m].n:m);
  status(`${target.species} moves: ${names.join(' · ')}${mv.second===false?' · no 2nd charged move yet':''}${changed?'':' (unchanged)'}`);
  if(window.Planner) Planner.onMovesScan(target);
  return target.key;
}
async function readBand(ctx, W, H, y0, y1){        // OCR one horizontal band of the frame (fractions of the height), half scale
  const wk=await getWorker();
  await wk.setParameters({tessedit_char_whitelist:'', tessedit_pageseg_mode:'6'});
  const c2=$('cv2'), top=Math.floor(y0*H), h=Math.floor((y1-y0)*H); c2.width=Math.floor(W/2); c2.height=Math.floor(h/2);
  const g=c2.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c2.width,c2.height); g.drawImage(ctx.canvas, 0, top, W, h, 0,0, c2.width, c2.height);
  let text=(await wk.recognize(c2)).data.text||'';
  if(!/attack|aanval/i.test(text)){                  // white text on the green buttons is hard for OCR: redraw the buttons as black text on white
    const img=g.getImageData(0,0,c2.width,c2.height), d=img.data, w=c2.width, hh=c2.height, mask=new Uint8Array(w*hh);
    for(let i=0;i<w*hh;i++){ const r=d[i*4], gg=d[i*4+1], b=d[i*4+2]; mask[i]=(gg>110 && gg>r+25 && gg>b+5)?1:0; }
    const R=5, dil=new Uint8Array(w*hh), rowsum=new Uint8Array(w*hh);
    for(let y=0;y<hh;y++) for(let x=0;x<w;x++){ let v=0; for(let k=-R;k<=R&&!v;k++){ const xx=x+k; if(xx>=0&&xx<w&&mask[y*w+xx]) v=1; } rowsum[y*w+x]=v; }
    for(let y=0;y<hh;y++) for(let x=0;x<w;x++){ let v=0; for(let k=-R;k<=R&&!v;k++){ const yy=y+k; if(yy>=0&&yy<hh&&rowsum[yy*w+x]) v=1; } dil[y*w+x]=v; }
    let inside=0; for(let i=0;i<w*hh;i++){ const v=(dil[i]&&!mask[i])?0:255; if(dil[i]) inside++; d[i*4]=d[i*4+1]=d[i*4+2]=v; d[i*4+3]=255; }
    if(inside>w*hh*0.01){ g.putImageData(img,0,0); const t2=(await wk.recognize(c2)).data.text||''; if(t2.trim()) text+='\n'+t2; }
  }
  return text;
}
async function readMovesScreen(ctx, W, H, skipKey){   // full-frame OCR for a screenshot scrolled to the attacks
  const wk=await getWorker();
  await wk.setParameters({tessedit_char_whitelist:'', tessedit_pageseg_mode:'6'});
  const c2=$('cv2'), sc=Math.min(1, 800/W); c2.width=Math.round(W*sc); c2.height=Math.round(H*sc);
  const g=c2.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c2.width,c2.height); g.drawImage(ctx.canvas,0,0,c2.width,c2.height);
  const text=(await wk.recognize(c2)).data.text||'';
  let species=null; for(const w2 of text.toUpperCase().match(/[A-Z]{3,}/g)||[]) if(DATA.stats[w2]){ species=w2; break; }
  if(!/attack|aanval/i.test(text) && !species) return null;
  return attachMovesFromText(text, species, skipKey);
}

/* ---------- trainer profile screenshot: name and level ---------- */
async function readProfile(ctx, W, H){
  const wk=await getWorker();
  await wk.setParameters({tessedit_char_whitelist:'', tessedit_pageseg_mode:'6'});
  const c2=$('cv2'), sc=Math.min(1, 700/W); c2.width=Math.round(W*sc); c2.height=Math.round(H*sc);
  const g=c2.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c2.width,c2.height); g.drawImage(ctx.canvas,0,0,c2.width,c2.height);
  const data=(await wk.recognize(c2)).data, text=data.text||'';
  const up=text.toUpperCase();
  if(!/LEVEL/.test(up) || !/TOTAL ACTIVITY|JOURNAL|BUDDY|SCRAPBOOK|FRIENDS|SOCIAL/.test(up)) return null;
  const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  let level=null, name=null;
  // the level is the big blue number just above the word LEVEL: crop that spot, keep only blue pixels, read digits
  const lw=(data.words||[]).find(w=>/^LEVEL$/i.test(w.text.replace(/[^A-Za-z]/g,'')));
  if(lw){
    const b=lw.bbox, wh=(b.y1-b.y0)/sc, x0=Math.max(0,Math.round(b.x0/sc-0.5*wh)), x1=Math.min(W,Math.round(b.x1/sc+3*wh));
    const y1=Math.round(b.y0/sc), y0=Math.max(0,Math.round(y1-4.5*wh));
    if(x1>x0 && y1>y0){
      const isBlue=(px,i)=>px[i+2]>150 && px[i+2]-px[i]>70 && px[i+2]-px[i+1]>25;      // level digits ≈ (30,140,230), the XP bar is much lighter
      const c3=binarize(ctx,W,H,x0,y0,x1-x0,y1-y0,3,isBlue);
      await wk.setParameters({tessedit_char_whitelist:'0123456789', tessedit_pageseg_mode:'7'});
      const t2=((await wk.recognize(c3)).data.text||'').replace(/\D/g,'');
      const v=parseInt(t2); if(v>=1 && v<=80) level=v;
      await wk.setParameters({tessedit_char_whitelist:'', tessedit_pageseg_mode:'6'});
    }
  }
  if(!level){                                                        // fall back to text: "LEVEL 41" or a lone 1–2 digit number on the line(s) above
    const li=lines.findIndex(l=>/LEVEL/i.test(l));
    if(li>=0){
      const inline=lines[li].match(/LEVEL\s*[:.]?\s*(\d{1,2})(?![\d.,])/i); if(inline) level=parseInt(inline[1]);
      for(let i=li-1;i>=Math.max(0,li-2)&&!level;i--){ const m3=lines[i].match(/^(\d{1,2})$/); if(m3) level=parseInt(m3[1]); }
    }
  }
  const bi=lines.findIndex(l=>/^[&8]\s*[A-Za-z]/.test(l));         // "& Eevee/…" buddy line sits right under the name
  const clean=l=>(l.replace(/[^A-Za-z0-9_ ]/g,'').trim().split(/\s+/)[0]||'');   // trainer names have no spaces; drop OCR noise after it
  if(bi>0 && clean(lines[bi-1]).length>=3) name=clean(lines[bi-1]);
  if(!name){ const mi=lines.findIndex(l=>/\bME\b/.test(l)&&/FRIENDS|SOCIAL/i.test(l));
    for(let i=mi+1;i<Math.min(lines.length,mi+5)&&mi>=0;i++){ const c=clean(lines[i]); if(/^[A-Za-z][A-Za-z0-9_]{2,}$/.test(c)&&!/^(FRIENDS|SOCIAL|ME)$/i.test(c)){ name=c; break; } } }
  if(!level && !name) return null;
  return {level, name};
}
function applyProfile(p, from){
  gain('profile',`${p.name||''} L${p.level||'?'}`.trim());
  if(p.level){ $('trainer').value=p.level; localStorage.setItem('trainer',String(p.level)); rankCache.clear(); }
  if(p.name){ $('tname').value=p.name; localStorage.setItem('tname',p.name); }
  paintProfile(); render();
  const msg=`Profile read: ${p.name||'name not found'}${p.level?` · level ${p.level}`:' · level not found'}`;
  status(msg); const ps=$('pstat'); if(ps) ps.textContent=msg;
}
function paintProfile(){ const lv=localStorage.getItem('trainer'), nm2=localStorage.getItem('tname'); const el=$('proflbl'); if(el) el.textContent=nm2?`${nm2} · L${lv||'?'}`:lv?`L${lv}`:'Profile'; }
function toggleProfile(){ const b=$('profile'); b.classList.toggle('open'); if(b.classList.contains('open')){ const ps=$('pstat'); if(ps) ps.textContent=''; } }

/* ---------- import log: one line per file, what it gave or why it failed ---------- */
const SCANLOG=(()=>{ try{ return JSON.parse(localStorage.getItem('scanlog')||'[]'); }catch(e){ return []; } })();
let GAIN=null, showLog=localStorage.getItem('showlog')==='1';
function gainStart(){ GAIN={new:[],moves:[],appr:[],profile:null,reads:0,frames:0,mode:'',note:[]}; }
let UPDATE=null;                                   // key of the card an import is meant to update (set from its page); its own key follows the update
function gain(kind,v){ if(!GAIN) return; if(kind==='reads'||kind==='frames') GAIN[kind]++; else if(Array.isArray(GAIN[kind])) GAIN[kind].push(v); else GAIN[kind]=v; }
function logImport(e){
  SCANLOG.unshift(Object.assign({t:Date.now()},e)); if(SCANLOG.length>40) SCANLOG.length=40;
  try{ localStorage.setItem('scanlog',JSON.stringify(SCANLOG)); }catch(err){}
  renderLog();
}
function gainSummary(g){
  if(!g) return '';
  const parts=[];
  const label=r=>typeof r==='string'?r:`${r.species} ${r.cp??'?'}${r.appraisal?' ✓':''}`;
  if(g.new.length) parts.push(`${g.new.length} new: ${g.new.slice(0,4).map(label).join(', ')}${g.new.length>4?'…':''}`);
  if(g.appr.length) parts.push(`appraisal → ${[...new Set(g.appr)].join(', ')}`);
  if(g.moves.length) parts.push(`moves → ${[...new Set(g.moves)].join(', ')}`);
  if(g.updated) parts.push(`updated: ${g.updated}`);
  if(g.profile) parts.push(`profile ${g.profile}`);
  if(g.reads||g.frames) parts.push(`${g.reads} screen${g.reads===1?'':'s'} read of ${g.frames} frames${g.mode?' · '+g.mode:''}`);
  if(g.note.length) parts.push([...new Set(g.note)].join(' · '));
  return parts.join(' · ')||'nothing new (already scanned, or no Pokémon found)';
}
function renderLog(){
  const el=$('implog'); if(!el) return;
  if(!SCANLOG.length){ el.innerHTML=''; return; }
  const fails=SCANLOG.filter(e=>!e.ok).length;
  let h=`<div class="hd" onclick="showLog=!showLog;localStorage.setItem('showlog',showLog?'1':'0');renderLog()"><span>${showLog?'▾':'▸'} Import log · ${SCANLOG.length} file${SCANLOG.length===1?'':'s'}${fails?` · ${fails} failed`:''}</span>${showLog?`<a href="#" onclick="event.stopPropagation();SCANLOG.length=0;localStorage.removeItem('scanlog');renderLog();return false">clear</a>`:''}</div>`;
  if(showLog) h+=SCANLOG.slice(0,25).map(e=>{ const d=new Date(e.t); const name=(e.file||'').length>28?(e.file||'').slice(0,14)+'…'+(e.file||'').slice(-10):(e.file||'');
    return `<div class="il"><span class="t">${d.toLocaleDateString('nl-NL',{day:'numeric',month:'short'})}<br>${d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}</span><span><span class="f">${name}</span> <span class="dim">${e.kind||''}${e.size?` · ${(e.size/1e6).toFixed(1)} MB`:''}${e.ms?` · ${(e.ms/1000).toFixed(0)}s`:''}</span><br><span class="r ${e.ok?'ok':'err'}">${e.ok?'✓ ':'⚠ '}${e.msg||''}</span>${e.detail?`<br><span class="d">${e.detail}</span>`:''}</span></div>`; }).join('');
  el.innerHTML=h;
}

/* ---------- input handling ---------- */
const $=id=>document.getElementById(id);
function showErr(msg){ const st=$('stat'), pr=$('prog'); if(pr) pr.style.display='block'; if(st) st.textContent='⚠ '+msg; console.error(msg); }
window.addEventListener('error', e=>showErr((e.error&&e.error.message)||e.message||'script error'));
window.addEventListener('unhandledrejection', e=>showErr('import failed: '+((e.reason&&e.reason.message)||e.reason)));
const results=JSON.parse(localStorage.getItem('scans')||'[]').filter(r=>r&&typeof r.species==='string'); results.forEach(r=>{ if(!Array.isArray(r.combos)) r.combos=[]; });
function migrateScans(){                          // v9.22 and earlier filled a lone charged move up with PvPoke's default; drop that guess when the unlock state was never seen
  if(!APP || localStorage.getItem('mig-moves')==='1') return;
  let n=0;
  for(const r of results){ if(!r.movesSeen || r.secondMove!==undefined || !r.moves || r.moves.filter(Boolean).length!==3) continue;
    const s=window.Planner?Planner.scanId(r):null; if(!s||!s.id) continue; const e=APP.pokemon[s.id]; if(!e) continue;
    if(!(normTxt(r.txt).includes(' '+normTxt(APP.moves[r.moves[2]]?APP.moves[r.moves[2]].n:'').trim()+' ')) && e.moveset.includes(r.moves[2])){ r.moves=r.moves.slice(0,2); n++; } }
  localStorage.setItem('mig-moves','1'); if(n){ save(); render(); if(window.Planner) Planner.refresh(); }
}
try{ render(); }catch(e){ showErr('render failed: '+e.message); }

$('file').addEventListener('change', async e=>{
  const files=[...e.target.files]; e.target.value='';
  const trainer=parseInt($('trainer').value)||40;
  localStorage.setItem('trainer',$('trainer').value);
  $('prog').style.display='block'; progress(0); status(`Preparing ${files.length} file${files.length===1?'':'s'}…`);
  let ok=0, batchKey=null; const before=results.length;
  UPDATE=window.Planner&&Planner.updateKey?Planner.updateKey():null; if(UPDATE) batchKey=UPDATE;
  if(window.Planner) Planner.beforeImport();
  for(const f of files){
    const t0=Date.now(), isVid=f.type.startsWith('video')||/\.(mp4|mov|m4v|webm)$/i.test(f.name); gainStart();
    try{
      if(isVid) await scanVideo(f,trainer);
      else batchKey=await scanImage(f,trainer,batchKey);
      ok++;
      logImport({file:f.name, kind:isVid?'video':'image', size:f.size, ms:Date.now()-t0, ok:true, msg:gainSummary(GAIN)});
    }catch(err){
      showErr(`${f.name}: ${err&&err.message||err}`);
      logImport({file:f.name, kind:isVid?'video':'image', size:f.size, ms:Date.now()-t0, ok:false, msg:(err&&err.message)||String(err), detail:[err&&err.detail, GAIN&&(GAIN.reads||GAIN.frames)?gainSummary(GAIN):''].filter(Boolean).join(' · ')});
      await new Promise(r=>setTimeout(r,1500));
    }
  }
  { const folded=dedupeScans(); if(folded) logImport({file:'duplicates', kind:'cleanup', ok:true, msg:`${folded} card${folded===1?'':'s'} folded into the card of the same Pokémon`}); }
  const updated=UPDATE?results.find(x=>x.key===UPDATE)||null:null; UPDATE=null;
  if(window.Planner&&Planner.updateDone) Planner.updateDone(updated);
  status(`Done · ${ok} of ${files.length} file${files.length===1?'':'s'} processed · ${results.length-before} new`);
  if(window.Planner) Planner.afterImport(results.slice(0, results.length-before));
  setTimeout(()=>{ if(!$('stat').textContent.startsWith('⚠')) $('prog').style.display='none'; },2500);
});
$('trainer').value=localStorage.getItem('trainer')||'40';
$('bb').checked=localStorage.getItem('bb')==='1';
renderLog();
$('tname').value=localStorage.getItem('tname')||'';
paintProfile();
$('pfile').addEventListener('change', async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  const ps=$('pstat'); if(ps) ps.textContent='Reading the screenshot…';
  try{
    const bmp=await createImageBitmap(f);
    const cv=$('cv'); cv.width=bmp.width; cv.height=bmp.height;
    const ctx=cv.getContext('2d',{willReadFrequently:true}); ctx.drawImage(bmp,0,0);
    const p=await withTimeout(readProfile(ctx,bmp.width,bmp.height), 60000, 'reading the screenshot took too long');
    if(p) applyProfile(p, f.name); else if(ps) ps.textContent='That does not look like the trainer profile page. Open your avatar in Pokémon GO and screenshot the page with your name and LEVEL.';
  }catch(err){ if(ps) ps.textContent='⚠ '+(err&&err.message||err); }
});
function del(i){ results.splice(i,1); save(); render(); }

function status(s){ $('stat').textContent=s; }
function progress(p){ $('fill').style.width=(p*100).toFixed(1)+'%'; }

async function scanImage(file,trainer,batchKey){
  status('Scanning '+file.name);
  const bmp=await createImageBitmap(file);
  const cv=$('cv'); cv.width=bmp.width; cv.height=bmp.height;
  const ctx=cv.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bmp,0,0);
  const W=bmp.width, H=bmp.height;
  const ap=readAppraisal(ctx,W,H);
  let key=null;
  if(ap) key=await withTimeout(handleAppraisal(ctx,W,H,trainer,ap,batchKey), 60000, 'reading the appraisal took too long');
  else {
    key=await withTimeout(handleScan(ctx,W,H,trainer,batchKey), 60000, 'reading the screenshot took too long');
    if(key===null){                                            // not a status screen: the attacks section, or the trainer profile
      key=await withTimeout(readMovesScreen(ctx,W,H,batchKey), 60000, 'reading the screenshot took too long');
      if(key===null){
        const prof=await readProfile(ctx,W,H);
        if(prof) applyProfile(prof, file.name); else { gain('note','no status screen, appraisal, attacks or profile recognised'); status(`${file.name}: no Pokémon status screen found`); }
      }
    }
  }
  progress(1);
  return key||batchKey||null;
}
const withTimeout=(p,ms,msg)=>new Promise((res,rej)=>{ const to=setTimeout(async()=>{ await resetWorker(); rej(new Error(msg)); },ms); p.then(v=>{clearTimeout(to);res(v);},e=>{clearTimeout(to);rej(e);}); });
async function resetWorker(){ const w=worker; worker=null; try{ if(w) await w.terminate(); }catch(e){} }
let TH=null;
function frameVec(cv){                                           // 16x16 grey thumbnail: cheap "does this frame look like that one"
  if(!TH){ TH=document.createElement('canvas'); TH.width=TH.height=16; }
  const g=TH.getContext('2d',{willReadFrequently:true}); g.drawImage(cv,0,0,16,16);
  const d=g.getImageData(0,0,16,16).data, v=new Float32Array(256);
  for(let i=0;i<256;i++) v[i]=gs(d,i*4);
  return v;
}
const vecDiff=(a,b)=>{ let s2=0; for(let i=0;i<256;i++) s2+=Math.abs(a[i]-b[i]); return s2/256; };

async function scanVideo(file,trainer){
  const vid=$('vid'), url=URL.createObjectURL(file);
  vid.muted=true; vid.defaultMuted=true; vid.playsInline=true; vid.setAttribute('playsinline',''); vid.setAttribute('webkit-playsinline','');
  vid.preload='auto'; vid.src=url;
  await new Promise((res,rej)=>{
    const to=setTimeout(()=>{ const e=new Error('the video did not load within 20 s; is the format supported by this browser?'); e.detail=`readyState ${vid.readyState} · networkState ${vid.networkState} · ${file.type||'no type'} · ${(file.size/1e6).toFixed(1)} MB`; rej(e); },20000);
    vid.onloadedmetadata=()=>{ clearTimeout(to); res(); };
    vid.onerror=()=>{ clearTimeout(to); const e=new Error('the video could not be decoded by this browser'); e.detail=`mediaError ${vid.error?vid.error.code:'?'} ${vid.error&&vid.error.message||''} · ${file.type||'no type'}`; rej(e); };
  });
  if(!isFinite(vid.duration)){                          // some recorders write no duration: seeking far past the end makes the browser find it
    await new Promise(r=>{ const to=setTimeout(r,4000); vid.ondurationchange=()=>{ if(isFinite(vid.duration)){ clearTimeout(to); r(); } }; vid.currentTime=1e7; });
    vid.ondurationchange=null; try{ vid.currentTime=0; }catch(e){}
  }
  if(!isFinite(vid.duration)||vid.duration<=0) throw new Error('the video has no readable duration');
  const cv=$('cv'); cv.width=vid.videoWidth; cv.height=vid.videoHeight;
  const ctx=cv.getContext('2d',{willReadFrequently:true});
  const dur=vid.duration, before=results.length;
  let prev=null, prevAp=null, lastRead=null, lastKey='', lastAp='', errs=0, reads=0, frames=0, mode='';
  const diag=()=>`${vid.videoWidth}×${vid.videoHeight} · ${dur.toFixed(1)}s · mode ${mode||'-'} · ${frames} frames · ${reads} reads · readyState ${vid.readyState}${vid.error?` · mediaError ${vid.error.code}`:''} · t=${vid.currentTime.toFixed(1)}`;
  const fail=msg=>{ const e=new Error(msg); e.detail=diag(); return e; };
  if(!vid.videoWidth) throw fail('the browser decoded no picture from this video (HEVC not supported here?)');
  // one frame of video time, ~3 per second: detect a held screen, read it once
  const analyse=async(t)=>{
    ctx.drawImage(vid,0,0); frames++; gain('frames');
    const vec=frameVec(cv);
    // two consecutive frames look alike: the swipe has stopped. The animated Pokémon model and video compression alone
    // move the 16x16 thumbnail by 4–6 grey levels; a swipe or screen change moves it by 15–75.
    const stable = prev!==null && vecDiff(vec,prev)<9;
    prev=vec;
    status(`Video ${Math.round(t)}s / ${Math.round(dur)}s · ${results.length-before} new · ${reads} screens read`);
    progress(Math.min(1,t/dur));
    if(!stable){ lastRead=null; prevAp=null; return false; }
    if(lastRead && vecDiff(vec,lastRead)<11) return false;    // still the same screen we already read
    try{
      const ap=readAppraisal(ctx,cv.width,cv.height);
      if(ap && (!prevAp || prevAp.join()!==ap.join())){ prevAp=ap; return false; }   // bars must read the same twice: no half-drawn panels
      if(ap){
        status(`Video ${Math.round(t)}s · reading appraisal…`);
        const k=await withTimeout(handleAppraisal(ctx,cv.width,cv.height,trainer,ap,lastAp), 25000, 'reading a frame took too long');
        if(k) lastAp=k; lastRead=vec; reads++; gain('reads'); return true;
      }
      // status-screen check: lower half is the bright white card (the sky can be any colour indoors); rows 10–14 of the 16x16 thumb
      let bot=0,n2=0; for(let y=10;y<15;y++) for(let x=0;x<16;x++){ bot+=vec[y*16+x]; n2++; }
      if(bot/n2<180){ lastRead=vec; return false; }
      status(`Video ${Math.round(t)}s · reading screen…`);
      const key=await withTimeout(handleScan(ctx,cv.width,cv.height,trainer,lastKey), 25000, 'reading a frame took too long');
      if(key) lastKey=key;
      lastRead=vec; reads++; gain('reads'); return true;
    }catch(e){                                                   // one bad frame must not end the whole recording
      errs++; console.error(e); status(`Video ${Math.round(t)}s · ${e.message} — continuing`);
      lastRead=vec;
      if(errs>=6) throw fail(`gave up after ${errs} frame errors (${e.message})`);
      return true;
    }
  };
  // Preferred: let the video play (muted, inline: allowed everywhere) and sample frames as they come, pausing for each read.
  // iPhones do not seek reliably in a freshly picked recording, so seeking is only the fallback.
  let played=false, playErr='';
  try{ vid.playbackRate=2; }catch(e){}
  try{ vid.currentTime=0; await vid.play(); played=!vid.paused; mode='play'; }catch(e){ played=false; playErr=(e&&e.name)||String(e); }
  if(!played){                                          // autoplay refused (Low Power Mode, or no gesture left): one tap starts it
    status('Tap ▶ below to start reading the recording');
    const st=$('stat'); const btn=document.createElement('button'); btn.className='btn'; btn.style.margin='8px 0 0'; btn.textContent='▶ Start reading the recording';
    st.appendChild(btn);
    played=await new Promise(res=>{ const to=setTimeout(()=>res(false),60000); btn.onclick=async()=>{ clearTimeout(to); try{ await vid.play(); res(!vid.paused); }catch(e){ playErr=(e&&e.name)||String(e); res(false); } }; });
    btn.remove(); if(played) mode='tap';
  }
  if(played){
    await new Promise((resolve,reject)=>{
      let lastT=-1, busy=false, done=false, lastProgressAt=Date.now(), lastSeen=-1, nudged=0;
      const finish=err=>{ if(done) return; done=true; clearInterval(iv); vid.onended=null; vid.onerror=null; err?reject(err):resolve(); };
      vid.onended=()=>finish(); vid.onerror=()=>finish(fail('the video stopped playing (decode error)'));
      const iv=setInterval(async()=>{
        if(done||busy) return;
        const t=vid.currentTime;
        if(t!==lastSeen){ lastSeen=t; lastProgressAt=Date.now(); }
        else if(Date.now()-lastProgressAt>6000){
          if(vid.ended||t>=dur-0.5) return finish();
          if(nudged<3){ nudged++; lastProgressAt=Date.now(); status(`Video ${Math.round(t)}s · playback stalled, nudging…`); try{ await vid.play(); }catch(e){} return; }
          return finish(fail('the video stalled three times; try again or record a shorter clip'));
        }
        if(t-lastT<1/3) return;
        busy=true; lastT=t;
        try{
          vid.pause();                                             // hold the frame still while we look at it
          await analyse(t);
          if(!done){ await vid.play().catch(()=>{}); }
        }catch(e){ finish(e); return; }
        busy=false;
      },80);
    });
  } else {
    mode='seek'; const step=1/3; let skipped=0;
    for(let t=0.2; t<dur; t+=step){
      const seeked=await new Promise(r=>{ const to=setTimeout(()=>r(false),2500); vid.onseeked=()=>{clearTimeout(to);r(true);}; vid.currentTime=t; });
      if(!seeked){ skipped++; if(skipped>15) throw fail(`the video could neither play (${playErr||'refused'}) nor seek in this browser`); continue; }
      await analyse(t);
    }
  }
  gain('mode',mode);
  status(`Video done · ${results.length-before} new · ${reads} screens read`);
  vid.pause(); vid.removeAttribute('src'); vid.load(); URL.revokeObjectURL(url);
}

async function handleScan(ctx,W,H,trainer,skipKey){
  const s=await scanFrame(ctx,W,H,trainer);
  if(!s.species && s.hp && s.cpCandidates.length) s.species=inferSpecies(s);
  if(!s.species || !s.hp){                            // status screens always show HP; a screen scrolled to the attacks may not
    let sp=s.species;
    if(!sp){ const cands=speciesCandidates(s), prev=skipKey?results.find(x=>x.key===skipKey):null;
      if(prev && cands.includes(prev.species)) sp=prev.species; else { const c=results.find(x=>!x.superseded && cands.includes(x.species)); sp=c?c.species:s.candySpecies; } }
    if(/ attack | aanval /.test(normTxt(s.txt)) || (sp && results.some(x=>x.species===sp))){
      if(!/ new attack | nieuwe aanval /.test(normTxt(s.txt))) s.txt=(s.txt||'')+' '+await readBand(ctx,W,H,0.76,1);   // the NEW ATTACK button sits below the card region
      const k=attachMovesFromText(s.txt, sp, skipKey, s.hp); note(`${seen(s)} → ${k?'moves attached to '+sp:'attacks screen, no card to attach to'}`); return k; }
    if(s.species && !s.cpCandidates.length){ note(`${seen(s)} → CP not read, no card`); return null; }
    note(`${seen(s)} → not a status screen`); return null;
  }
  if(!s.cpCandidates.length){ note(`${seen(s)} → CP not read, no card`); return null; }
  if(s.inferred) note(`name hidden, took ${s.inferred}`);
  let mvSeen=readMoves(s.species, s.txt);
  if(!mvSeen){                                          // attacks sit below the card region on a full status screen: read the bottom band too
    const band=await readBand(ctx,W,H,0.76,1);
    mvSeen=readMoves(s.species, band); if(mvSeen){ s.txt=(s.txt||'')+' '+band; note(`attacks read from the bottom of the screen`); }
  }
  s.combos=[];
  const tries=[]; if(s.level){ tries.push(s.level, s.level-0.5, s.level+0.5); }
  tries.push(null); if(s.dust) tries.push(0);          // null = dust window; 0 = unconstrained
  outer:
  for(const lv of tries){
    for(const c of [...new Set(s.cpCandidates)]){
      const r=solve(s.species,c,s.hp,lv||null,lv===0?null:s.dust,s.hints);
      if(r.length){ s.cp=c; s.combos=r; break outer; }
    }
  }
  if(s.combos.length){                                 // display level = what actually solved
    const lvls=[...new Set(s.combos.map(c=>c[0]))];
    s.level = lvls.length===1 ? lvls[0] : null;
  }
  if(!s.cp && s.cpCandidates.length) s.cp=s.cpCandidates[0];
  if(!s.combos.length){                                   // unsolvable, probably a misread CP: fold into an existing card of the same Pokémon
    const digits=String(s.cp||''), twin=results.find(x=>x.species===s.species && x.hp===s.hp && x.cp && x.combos.length && (!digits||String(x.cp).includes(digits)));
    if(twin){ if(mvSeen&&applyMoves(twin,mvSeen)){ save(); render(); gain('moves',twin.species); if(window.Planner) Planner.onMovesScan(twin); } status(`${s.species}: same Pokémon as the ${twin.cp} CP card`); note(`${seen(s)} → same as the ${twin.cp} CP card`); return twin.key; }
    note(`${seen(s)} → no IV spread fits (card kept for correction)`);
  }
  if(UPDATE && s.combos.length){                          // imported from a card's page: this screenshot is meant to update that card
    const target=results.find(x=>x.key===UPDATE);
    if(target){
      const tid=pvpokeIdFor(target.species,(DATA.stats[target.species]||[])[0]), evos=tid?evosOf(tid).map(x=>x.split('_')[0].toUpperCase()):[];
      const sameFam=target.species===s.species||evos.includes(s.species);
      if(sameFam && updateCard(target,s,mvSeen)){ UPDATE=target.key; note(`${seen(s)} → updated the ${target.species} card`); return target.key; }
      note(sameFam?`${seen(s)} does not share IVs with the ${target.species} ${target.cp} CP card: kept as a separate copy`:`${seen(s)} is not a ${target.species}: kept as a separate card`);
    }
  }
  const key=`${s.species}|${s.cp}|${s.hp}|${s.level??''}|${s.dust??''}`;
  const dup=results.find(r=>r.key===key);
  if(dup){ if(mvSeen&&applyMoves(dup,mvSeen)){ save(); render(); gain('moves',dup.species); if(window.Planner) Planner.onMovesScan(dup); status(`${s.species}: moves updated`); } note(`${seen(s)} → already have it`); return key; }   // dedupe
  if(key===skipKey) return key;
  const same=sameCopy(s.species, s.cp, s.hp);   // the same physical Pokémon already has a card (its appraisal card, or an earlier scan)
  if(same){ if(mvSeen&&applyMoves(same,mvSeen)){ save(); render(); gain('moves',same.species); if(window.Planner) Planner.onMovesScan(same); } note(`${seen(s)} → same copy as the ${same.cp} CP card`); return same.key; }
  s.key=key; if(mvSeen) applyMoves(s,mvSeen);
  { const ks=apKeys(s.species,s.cp,s.hp), hit=ks.find(k=>APPR[k]);
    if(hit){ const ivs=APPR[hit]; ks.forEach(k=>delete APPR[k]); applyAppraisal(s,ivs); apKeys(s.species,s.cp,s.hp).forEach(k=>delete APPR[k]); saveAppr(); } }
  results.unshift(s); if(window.Planner) Planner.onNewScan(s); save(); render(); gain('new',s); note(`${seen(s)} → new card`);
  return key;
}

/* ---------- UI ---------- */
function save(){ localStorage.setItem('scans',JSON.stringify(results)); if(window.Planner) Planner.markDirty(); if(window.Sync) Sync.touch('scans'); }
if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
async function shareFile(name, text, type){
  const file=new File([text], name, {type});
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file]}); return; }catch(e){}
  }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}
function exportCSV(){
  const rows=[['species','cp','hp','level','dust','best_pct','best_ivs','combos']];
  for(const r of results){
    const best=r.combos.length?r.combos.reduce((a,b)=>pct(b)>pct(a)?b:a):null;
    rows.push([r.species,r.cp??'',r.hp??'',r.level??'',r.dust??'',
      best?pct(best).toFixed(1):'', best?`${best[1]}/${best[2]}/${best[3]}`:'', r.combos.length]);
  }
  shareFile('pokescan.csv', rows.map(r=>r.join(',')).join('\n'), 'text/csv');
}
function backupJSON(){ shareFile('pokescan-backup.json', JSON.stringify(results), 'application/json'); }
document.getElementById('imp').addEventListener('change', async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  try{
    const arr=JSON.parse(await f.text());
    let added=0;
    for(const r of arr) if(r.key && !results.some(x=>x.key===r.key)){ results.push(r); added++; }
    save(); render(); status(added+' restored');
  }catch(err){ status('restore failed'); }
});
function clearAll(){ if(!confirm(`Delete all ${results.length} scans on this device?`)) return; results.length=0; save(); render(); if(window.Planner) Planner.refresh(); }
function pct(c){ return (c[1]+c[2]+c[3])/45*100; }
function bestOf2(r){ return r.combos.reduce((a,b)=>pct(b)>pct(a)?b:a); }
function toggleFav(i){ results[i].fav=!results[i].fav; save(); render(); }
function toggleBench(i){ results[i].bench=!results[i].bench; save(); render(); if(window.Planner) Planner.refresh(); }
function toggleHelp(){ $('help').classList.toggle('open'); }
function lineageBanner(r){                        // one-tap merge offer on a scan that looks like a power-up or evolution of a card we already had
  const h=r&&r.lineageHint; if(!h) return '';
  const old=results.find(x=>x.key===h.key); if(!old){ delete r.lineageHint; return ''; }
  const nice=x=>String(x||'').toLowerCase().replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const k=r.key.replace(/'/g,''), what=h.kind==='evolution'?`your ${nice(h.species)} (${h.cp} CP) evolved`:`your ${nice(h.species)} ${h.cp} CP powered up`;
  return `<div class="lin" onclick="event.stopPropagation()"><span class="q">Is this ${what}?</span><span class="a"><button class="yes" onclick="Planner.lineageMerge('${k}')">Yes, one card</button><button class="no" onclick="Planner.lineageDismiss('${k}')">No, another one</button></span>${h.multi?'<div class="dim" style="font-size:11.5px;margin-top:4px">More than one older card fits; this merges with the first. Use ⋮ → Update this Pokémon on the right card if it is not that one.</div>':''}</div>`;
}
function render(){
  $('count').textContent=results.length+' scanned';
  const em=$('empty'); if(em) em.style.display=results.length?'none':'block';
  const mode=($('sort')||{}).value||'new', q=(($('q')||{}).value||'').trim().toUpperCase(), flt=($('filter')||{}).value||'all';
  const glOf=r=>{ if(!r.combos.length||!DATA.stats[r.species]) return null; const b=bestOf2(r); return pvpRank(b[4]||DATA.stats[r.species][0],b[1],b[2],b[3],LEAGUE.cp); };
  const bestCopy={}; results.forEach((r,i)=>{ const g=glOf(r); if(g&&r.cp<=LEAGUE.cp&&!r.bench&&(!(r.species in bestCopy)||g.n<bestCopy[r.species].n)) bestCopy[r.species]={n:g.n,i}; });
  const order=results.map((r,i)=>i).filter(i=>{ const r=results[i];
    if(q&&!(r.species||'').includes(q)) return false;
    const g=glOf(r), b=r.combos.length?bestOf2(r):null;
    if(flt==='gl') return r.cp&&r.cp<=LEAGUE.cp&&g;
    if(flt==='power') return g&&r.cp<=LEAGUE.cp&&b&&g.lv>b[0]&&g.lv<=40;
    if(flt==='ready') return g&&r.cp<=LEAGUE.cp&&b&&g.lv<=b[0];
    if(flt==='appr') return !!r.appraisal;
    if(flt==='fav') return !!r.fav;
    if(flt==='bench') return !!r.bench;
    if(flt==='arch') return !!r.superseded;
    return !r.superseded; });
  if(mode==='new') order.sort((a,b)=>(results[b].fav?1:0)-(results[a].fav?1:0));
  const bp=r=>r.combos.length?Math.max(...r.combos.map(pct)):-1;
  if(mode==='pct') order.sort((a,b)=>bp(results[b])-bp(results[a]));
  if(mode==='cp') order.sort((a,b)=>(results[b].cp||0)-(results[a].cp||0));
  if(mode==='name') order.sort((a,b)=>(results[a].species||'').localeCompare(results[b].species||''));
  if(mode==='meta'){ const mr=r=>{const m=metaFor(r.species); return m?m[0]:9999;};
    order.sort((a,b)=>mr(results[a])-mr(results[b])); }
  if(mode==='gl'){
    const gr=r=>{ if(!r.combos.length||!DATA.stats[r.species]) return 9999;
      return Math.min(...r.combos.map(c=>pvpRank(c[4]||DATA.stats[r.species][0],c[1],c[2],c[3],LEAGUE.cp).n)); };
    order.sort((a,b)=>gr(results[a])-gr(results[b]));
  }
  $('out').innerHTML=order.map(i=>{ const r=results[i];
    const ps=r.combos.map(pct), lo=ps.length?Math.min(...ps):0, hi=ps.length?Math.max(...ps):0;
    const cls=hi>=90?'g':hi>=70?'m':'b';
    const mt=metaFor(r.species);
    const best=r.combos.length?bestOf2(r):null;
    const nice=(r.species||'?').toLowerCase().replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    const flags=[!r.cp&&'CP?',!r.hp&&'HP?',!r.level&&'level?'].filter(Boolean).join(' ');
    const ivpct=ps.length?(lo===hi?hi.toFixed(0):lo.toFixed(0)+'–'+hi.toFixed(0))+'%':'—';
    let status='', gl=null;
    if(best){ const bb2=best[4]||DATA.stats[r.species][0]; gl=pvpRank(bb2,best[1],best[2],best[3],LEAGUE.cp);
      if(r.cp>LEAGUE.cp) status=`<span class="chip warn">over the ${LEAGUE.abbr} cap</span>`;
      else if(gl.lv>40) status=`<span class="chip warn">needs L${gl.lv} · XL candy</span>`;
      else if(gl.lv>best[0]){ const c=costTo(best[0],gl.lv); status=`<span class="chip ul">→ L${gl.lv} · ${c.dust>=1000?(c.dust/1000).toFixed(c.dust%1000?1:0)+'k':c.dust} dust · ${c.candy} candy</span>`; }
      else status=`<span class="chip meta1">ready for ${LEAGUE.abbr}</span>`; }
    const tags=[r.superseded?'<span class="chip">archived</span>':'', r.bench?'<span class="chip">benched</span>':'',
      r.cpInferred?'<span class="chip warn" title="the CP was not read completely; it was inferred from HP, level and IVs">CP inferred</span>':'',
      (!r.moves||!r.moves.length)&&!r.superseded&&r.combos.length?'<span class="chip" title="no attacks screenshot yet; the planner falls back to PvPoke\'s moveset without showing it as fact">moves not read</span>':'',
      !r.bench&&bestCopy[r.species]&&bestCopy[r.species].i===i&&results.filter(x=>x.species===r.species).length>1?'<span class="chip meta1">best copy</span>':'',
      ].join('');
    const ap=r.appraisal?(r.apMismatch?' <span class="flag">≠ appraisal</span>':' <span class="okc" title="exact IVs from the appraisal screen">✓</span>'):'';
    return `<div class="mon compact ${cls} ${r.bench?'benched':''}" onclick="Planner.openScan('${r.key.replace(/'/g,'')}')">${lineageBanner(r)}
      <div class="top"><span class="name"><span class="star ${r.fav?'on':''}" onclick="toggleFav(${i});event.stopPropagation()">${r.fav?'★':'☆'}</span>${nice}</span>
        <span class="cp"><b>${r.cp??'?'}</b> CP · L${r.level??'?'}${flags?` <span class="flag">${flags}</span>`:''}</span></div>
      <div class="ivrow">
        <span><small>IVs</small><b>${best?`${best[1]}/${best[2]}/${best[3]}`:'?'}</b>${ap}</span>
        <span><small>IV%</small><b class="pctc">${ivpct}</b></span>
        <span><small>${LEAGUE.abbr} rank</small>${gl?`<b>#${gl.n}</b> <span class="dim">${gl.pct.toFixed(1)}%</span>`:'<b class="dim">—</b>'}</span>
      </div>
      <div class="chips row2"><span>${status||'<span class="chip warn">no match: tap to correct</span>'}${r.combos.length>1?`<span class="chip">${r.combos.length} possible</span>`:''}${tags}</span>${mt?`<span class="chip">meta #${mt[0]}</span>`:''}</div>
    </div>`;
  }).join('');
}
/* ---------- planning helpers ---------- */
function pvpokeIdFor(species, form){          // scanner species (UPPERCASE) + base-stat form -> PvPoke speciesId
  if(!APP||!species) return null;
  const s=species.toLowerCase();
  let ids=Object.keys(APP.pokemon).filter(k=>k===s||k.startsWith(s+'_')).filter(k=>!k.includes('shadow'));
  if(!ids.length) return null;
  if(form&&ids.length>1){ const ft=[form[3],form[4]].filter(Boolean).map(t=>t.toLowerCase()).sort().join('/');
    const m=ids.filter(k=>APP.pokemon[k].types.slice().sort().join('/')===ft); if(m.length) ids=m; }
  return ids.reduce((a,b)=>APP.pokemon[a].rank<APP.pokemon[b].rank?a:b);
}
function evoBaseStats(evoId){                 // PvPoke evolution id -> scanner base stats form
  const forms=DATA.stats[evoId.split('_')[0].toUpperCase()]; if(!forms) return null;
  const info=APP.pokemon[evoId]||APP.unranked[evoId]||{types:[]};
  const want=info.types.slice().sort().join('/');
  return forms.find(f=>[f[3],f[4]].filter(Boolean).map(t=>t.toLowerCase()).sort().join('/')===want)||forms[0];
}
function evosOf(id){                          // direct evolutions of a PvPoke id: ranked entries list them, otherwise the pre-evolution map read backwards
  const e=APP.pokemon[id], out=new Set(e&&e.evo||[]);
  for(const [k,v] of Object.entries(APP.prevo||{})) if(v===id) out.add(k);
  return [...out];
}
function planFor(r,best){                       // the evolution chain of a scan with this IV spread: CP now, level and rank at the 1500 cap, cost
  if(!APP) return '';
  const b=best[4]||DATA.stats[r.species][0], id=pvpokeIdFor(r.species,b)||Object.keys(APP.unranked).find(k=>k===r.species.toLowerCase()); if(!id) return '';
  const e=APP.pokemon[id], lines=[];
  const walk=(from,depth)=>{ for(const evo of evosOf(from)){
    const eb=evoBaseStats(evo); if(!eb) continue;
    const name=(APP.pokemon[evo]||APP.unranked[evo]||{name:evo}).name;
    const cpNow=calcCP(eb,best[1],best[2],best[3],cpmAt(best[0]));
    if(cpNow>LEAGUE.cp){ lines.push(`→ <b>${name}</b> would be ${cpNow} CP: <span class="no">over the ${LEAGUE.cp} cap</span>`); }
    else { const rk=pvpRank(eb,best[1],best[2],best[3],LEAGUE.cp), mr=APP.pokemon[evo]?` · meta #${APP.pokemon[evo].rank}`:'', c=costTo(best[0],rk.lv);
      lines.push(`→ <b>${name}</b> ${cpNow} CP now, <span class="ok">fits</span> up to L${rk.lv} (${rk.cp} CP, IV #${rk.n}, ${rk.pct.toFixed(1)}%${mr}) · ${c.dust.toLocaleString('nl')} dust · ${c.candy} candy to power up, plus the candy to evolve`); }
    if(depth<2) walk(evo,depth+1);
  } };
  walk(id,1);
  if(e&&e.thirdMove) lines.push(`2nd charged move: ${(e.thirdMove[0]/1000)}k dust · ${e.thirdMove[1]} candy${e.buddy?` · buddy ${e.buddy} km`:''}`);
  return lines.length?`<div class="plan">${lines.join('<br>')}</div>`:'';
}

const PAGES=['today','builder','teams','team','roster','meta','rank','raids','scans','mon'];
const TOP_PAGES=['today','builder','teams','roster','meta','rank','raids','scans'];
const BAR_FOR={today:'today',builder:'builder',teams:'builder',team:'builder',roster:'roster',scans:'roster',mon:'roster',meta:'',rank:'',raids:''};
function showView(t){                              // switch the visible page; navigation goes through Planner.nav so the URL hash stays in step
  if(!PAGES.includes(t)) t='today';
  for(const k of PAGES){ const v=$('view-'+k); if(v) v.classList.toggle('on',k===t); }
  for(const k of ['today','builder','roster']){ const tb=$('tab-'+k); if(tb) tb.classList.toggle('on',BAR_FOR[t]===k); }
  if(TOP_PAGES.includes(t)) localStorage.setItem('tab',t);
  if(window.Planner){ const P=Planner; ({today:P.renderToday,builder:()=>P.renderMeta('build'),teams:P.renderTeams,team:P.renderTeam,roster:P.renderRoster,meta:()=>P.renderMeta('meta'),rank:()=>P.renderMeta('rank'),raids:()=>P.renderMeta('raids'),mon:P.renderMon}[t]||(()=>{}))(); if(P.paintDrawer) P.paintDrawer(); }
}
function showTab(t){ if(window.Planner&&Planner.nav&&TOP_PAGES.includes(t)) Planner.nav('#/'+t); else showView(t); }
if(!location.hash) showView(localStorage.getItem('tab')||'today');
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

function refixScan(r, vals){                       // used by the scan page: correct species/CP/HP/level and solve again
  r.species=(vals.species||r.species||'').toUpperCase().trim();
  r.cp=parseInt(vals.cp)||r.cp; r.hp=parseInt(vals.hp)||r.hp; r.level=parseFloat(vals.level)||null;
  r.combos=solve(r.species,r.cp,r.hp,r.level,r.dust);
  if(r.appraisal) applyAppraisal(r,r.appraisal);
  if(r.combos.length){ const lv=[...new Set(r.combos.map(c=>c[0]))]; if(lv.length===1) r.level=lv[0]; }
  r.key=`${r.species}|${r.cp}|${r.hp}|${r.level??''}|${r.dust??''}`;
  save(); render(); return r.key;
}
function refix(i){
  const r=results[i];
  r.species=$('sp'+i).value.toUpperCase().trim()||r.species;
  r.cp=parseInt($('cp'+i).value)||r.cp;
  r.hp=parseInt($('hp'+i).value)||r.hp;
  r.level=parseFloat($('lv'+i).value)||r.level;
  r.key=`${r.species}|${r.cp}|${r.hp}`;
  r.combos=solve(r.species,r.cp,r.hp,r.level,r.dust);
  if(r.appraisal) applyAppraisal(r,r.appraisal);
  save(); render();
}

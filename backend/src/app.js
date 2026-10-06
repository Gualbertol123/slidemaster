/* ============================================================================================
   Slide Builder 2 — renderers, settings, editor, export
   ============================================================================================ */
const PARAMS = new URLSearchParams(location.search);
const RENDER = PARAMS.get("render") === "1";
const SERVED = location.protocol.startsWith("http");

/* ----------------------------------------------------------------------------- settings ---- */
const DEFAULT_SETTINGS = () => ({
  version: 2,
  app: { design: "glass", glass: "subtle", color: 35, logo: "logo.png", pdfMode: "exact", scale: 3, lastFile: "",
         pn: { on: false, start: 1, pos: "br", font: "auto", size: 16, format: "n", style: "capsule", cover: false } },
  presets: {},
  files: {}
});
let SETTINGS = DEFAULT_SETTINGS();
let saveTimer = null, saveState = "saved";
function normSettings(s){
  const d = DEFAULT_SETTINGS();
  if(!s || typeof s !== "object") return d;
  s.version = 2; s.app = Object.assign(d.app, s.app || {}); s.files = s.files || {};
  s.app.pn = Object.assign(DEFAULT_SETTINGS().app.pn, s.app.pn || {});
  if(s.app.pageStart !== undefined){ const v = String(s.app.pageStart).trim(); if(v && !isNaN(+v)){ s.app.pn.on = true; s.app.pn.start = +v; } delete s.app.pageStart; }   // older setting
  return s;
}
async function loadSettings(){
  if(SERVED){
    try{ const r = await fetch("/api/settings", {cache:"no-store"}); if(r.ok){ SETTINGS = normSettings(await r.json()); return; } }catch(e){}
  }
  try{ SETTINGS = normSettings(JSON.parse(localStorage.getItem("slidebuilder:settings")||"null")); }catch(e){ SETTINGS = DEFAULT_SETTINGS(); }
}
function scheduleSave(){
  if(RENDER) return;
  saveState = "pending"; paintSave();
  clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 450);
}
async function flushSave(){
  clearTimeout(saveTimer); saveTimer = null;
  pruneSettings();
  const body = JSON.stringify(SETTINGS);
  if(SERVED && SERVER.ok){
    try{
      saveState = "saving"; paintSave();
      const r = await fetch("/api/settings", {method:"PUT", headers:{"Content-Type":"application/json"}, body});
      saveState = r.ok ? "saved" : "error";
      if(!r.ok) saveError = (await r.json().catch(()=>({}))).error || "could not write the settings file";
    }catch(e){ saveState = "error"; saveError = "the helper is not running"; }
  } else {
    try{ localStorage.setItem("slidebuilder:settings", body); saveState = "local"; }catch(e){ saveState = "error"; }
  }
  paintSave();
}
let saveError = "";
function pruneSettings(){
  for(const f in SETTINGS.files){
    for(const sh in SETTINGS.files[f]){
      const c = SETTINGS.files[f][sh];
      for(const k in (c.cells||{})){ const e = c.cells[k]; if(!Object.keys(e).some(x => x!=="orig")) delete c.cells[k]; if(e.text===undefined) delete e.orig; }
      if(!Object.keys(c.cells||{}).length && !Object.keys(c.layouts||{}).length) delete SETTINGS.files[f][sh];
    }
    if(!Object.keys(SETTINGS.files[f]).length) delete SETTINGS.files[f];
  }
}
function sheetCfg(S, create){
  const f = DOC.name || "";
  if(!SETTINGS.files[f]){ if(!create) return {cells:{}, layouts:{}}; SETTINGS.files[f] = {}; }
  if(!SETTINGS.files[f][S.name]){ if(!create) return {cells:{}, layouts:{}}; SETTINGS.files[f][S.name] = {cells:{}, layouts:{}}; }
  const c = SETTINGS.files[f][S.name]; c.cells = c.cells || {}; c.layouts = c.layouts || {};
  return c;
}

/* ----------------------------------------------------------------------------- overrides ---- */
const isNumText = t => /^[-+(]?[\d.\s]*\d[\d.,\s]*%?\)?$/.test(String(t).trim());
/* every change to cell edits bumps EDITV; per-sheet keys and per-table results are cached against it */
let EDITV = 1;
function sheetKey(S){ if(S._kv !== EDITV){ S._k = JSON.stringify(sheetCfg(S).cells); S._kv = EDITV; } return S._k; }
function effItems(L){
  const k = sheetKey(L.sheet);
  if(L._eff && L._eff.k === k && L._eff.n === DOC.name) return L._eff.items;
  const items = effItemsRaw(L);
  L._eff = {k, n: DOC.name, items};
  return items;
}
function effItemsRaw(L){
  const cells = sheetCfg(L.sheet).cells;
  return L.items.map(it => {
    const e = cells[A1(it.b.src.r, it.b.src.c)]; if(!e) return it;
    const o = Object.assign({}, it); o.font = Object.assign({}, it.font);
    if(e.text!==undefined && e.orig===it.text){ o.text = e.text; o.edited = true; if(!it.text && o.text){ o.isText = !isNumText(o.text); o.ctype = o.isText ? "s" : "n"; } }
    if(e.sz) o.font.sz = e.sz;
    if(e.b!==undefined){ o.font.b = e.b; o.userB = e.b; }
    if(e.i!==undefined){ o.font.i = e.i; o.userI = e.i; }
    if(e.color){ o.userColor = e.color; o.color = e.color; o.nfColor = null; }
    if(e.fill){ if(e.fill==="none"){ o.fill = null; o.cf = null; o.baseFill = null; o.noFill = true; } else { o.fill = e.fill; o.userFill = e.fill; } }
    if(e.align){ o.align = e.align; }
    if(e.role) o.role = e.role;
    return o;
  });
}

/* ----------------------------------------------------------------------------- drawing helpers ---- */
function picHtml(p, cls){
  const tr = []; if(p.rot) tr.push(`rotate(${p.rot}deg)`); if(p.flipH) tr.push("scaleX(-1)"); if(p.flipV) tr.push("scaleY(-1)");
  const outer = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;${tr.length?`transform:${tr.join(" ")};`:""}`;
  if(p.unsupported) return RENDER ? "" : `<div class="pic missing" style="${outer}" title="${esc(p.name)}"><span>${esc(p.unsupported)}</span></div>`;
  const c = p.crop;
  if(c && (c.l||c.t||c.r||c.b)){
    const iw = p.w/Math.max(.01,1-c.l-c.r), ih = p.h/Math.max(.01,1-c.t-c.b);
    return `<div class="pic ${cls||""}" style="${outer}"><img src="${p.src}" alt="" style="left:${(-c.l*iw).toFixed(2)}px;top:${(-c.t*ih).toFixed(2)}px;width:${iw.toFixed(2)}px;height:${ih.toFixed(2)}px"></div>`;
  }
  return `<div class="pic ${cls||""}" style="${outer}"><img src="${p.src}" alt="" style="left:0;top:0;width:100%;height:100%"></div>`;
}
function textboxInner(tb, font, inkMap){
  return tb.paras.map(p => `<div style="text-align:${p.align}">${p.runs.length ? p.runs.map(r => `<span style="${r.sz?`font-size:${(r.sz*96/72).toFixed(1)}px;`:""}${r.b?"font-weight:700;":""}${r.i?"font-style:italic;":""}${r.color?`color:${inkMap?inkMap(r.color):r.color};`:""}">${esc(r.text)}</span>`).join("") : "&nbsp;"}</div>`).join("");
}
function shapeTransform(o){ const tr = []; if(o.rot) tr.push(`rotate(${o.rot}deg)`); if(o.flipH) tr.push("scaleX(-1)"); if(o.flipV) tr.push("scaleY(-1)"); return tr.length ? `transform:${tr.join(" ")};` : ""; }

/* ----------------------------------------------------------------------------- Excel design ---- */
const XLFONT = `'Century Gothic','CenturyGothic','URW Gothic','AppleGothic',Arial,sans-serif`;
function renderExcel(L, opts={}){
  const items = effItems(L);
  let h = `<div class="xt" style="width:${L.W}px;height:${L.H}px">`;
  for(const it of items){
    const st = [`left:${it.bx}px`,`top:${it.by}px`,`width:${it.bw}px`,`height:${it.bh}px`];
    if(it.fill) st.push(`background:${it.fill}`);
    if(it.top) st.push(`border-top:${bcss(it.top)}`);
    if(it.left) st.push(`border-left:${bcss(it.left)}`);
    if(it.right) st.push(`border-right:${bcss(it.right)}`);
    if(it.bottom) st.push(`border-bottom:${bcss(it.bottom)}`);
    if(st.length>4) h += `<div class="b" style="${st.join(";")}"></div>`;
  }
  for(const it of (opts.noText ? [] : items)){
    if(!it.text) continue;
    const f = it.font, tw = it.tw || it.bw;
    const st = [`left:${it.bx}px`,`top:${it.by}px`,`width:${tw}px`,`height:${it.bh}px`,
      `font-family:'${(f.name||"").replace(/['"]/g,"")}',${XLFONT}`,`font-size:${((f.sz||11)*96/72).toFixed(2)}px`,`color:${it.color||"#000"}`,
      `justify-content:${it.align==="right"?"flex-end":it.align==="center"?"center":"flex-start"}`,
      `align-items:${it.valign==="top"?"flex-start":it.valign==="center"?"center":"flex-end"}`,`text-align:${it.align}`];
    if(f.b) st.push("font-weight:700"); if(f.i) st.push("font-style:italic");
    const dec = [f.u?"underline":"", f.s?"line-through":""].filter(Boolean).join(" "); if(dec) st.push(`text-decoration:${dec}`);
    if(it.indent) st.push(it.align==="right" ? `padding-right:${3+it.indent*9}px` : `padding-left:${3+it.indent*9}px`);
    if(it.valign==="bottom"||!it.valign) st.push("padding-bottom:1px");
    const cls = ["t", it.wrap?"wrap":"", it.ov?"ov":""].filter(Boolean).join(" ");
    if(it.rot){ h += `<div class="t ov" style="${st.join(";")};${rotBox()}">${rotSpan(it.rot, it.text)}</div>`; continue; }
    h += `<div class="${cls}" style="${st.join(";")}">${esc(it.text)}</div>`;
  }
  for(const r of L.rects) h += `<div style="position:absolute;box-sizing:border-box;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;${r.fill?`background:${r.fill};`:""}${r.line?`border:${r.line.w}px solid ${r.line.color};`:""}${r.ellipse?"border-radius:50%;":r.round?"border-radius:8px;":""}${shapeTransform(r)}"></div>`;
  for(const tb of L.texts) h += `<div class="tbox" style="left:${tb.x}px;top:${tb.y}px;width:${tb.w}px;height:${tb.h}px;${tb.fill?`background:${tb.fill};`:""}${tb.line?`border:${tb.line.w}px solid ${tb.line.color};`:""}${tb.round?"border-radius:8px;":""}justify-content:${tb.anchorV==="ctr"?"center":tb.anchorV==="b"?"flex-end":"flex-start"};font-family:${XLFONT};${shapeTransform(tb)}">${textboxInner(tb)}</div>`;
  for(const p of L.pics) h += picHtml(p);
  return h + `</div>`;
}

/* ----------------------------------------------------------------------------- Liquid Glass design ---- */
const SYS = {green:"#34C759", greenInk:"#136B2E", red:"#FF3B30", redInk:"#A8101A", label:"#0B0D17", label2:"rgba(18,22,44,.68)", label3:"rgba(18,22,44,.46)"};
function hexRgb(h){ h=(h||"#FFFFFF").replace("#",""); if(h.length===3) h=h.split("").map(x=>x+x).join(""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function lum(h){ const [r,g,b]=hexRgb(h); return (0.299*r+0.587*g+0.114*b)/255; }
function tone(h){
  if(!h) return null; const [r,g,b] = hexRgb(h); const L = lum(h);
  if(L > .93 && Math.max(r,g,b)-Math.min(r,g,b) < 18) return null;
  if(g > r+35 && g > b+10) return "pos";
  if(r > g+55 && r > b+40) return "neg";
  if(Math.max(r,g,b)-Math.min(r,g,b) < 18) return L > .7 ? "muted" : "dark";
  return "other";
}
const rgba = (h,a) => { const [r,g,b]=hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
function darken(h, k){ let [hh,s,l] = hexToHsl(h.replace("#","")); return "#"+hslToHex(hh, Math.min(1,s*1.05), Math.max(0, l*k)); }

/* Liquid Glass uses its own font, so columns are widened where the text needs it (never narrowed).
   Geometry is cached per table and per set of cell edits. */
function glassGeom(L){
  const key = sheetKey(L.sheet);
  if(L._gg && L._gg.key===key) return L._gg;
  const need = new Map();
  for(const it of effItems(L)){
    if(!it.text || it.b.c!==it.b.c2 || it.wrap || it.ov) continue;
    const px = (it.font.sz||11)*96/72*.97, w = String(it.text).length * px * (it.font.b || it.R==="header" ? .6 : .56) + 22;
    need.set(it.b.c, Math.max(need.get(it.b.c)||0, w));
  }
  const X = new Map(), Wc = new Map(); let x = 0;
  for(const c of L.cols){ const w0 = L.colW.get(c), w = Math.min(Math.max(w0, need.get(c)||0), Math.max(w0*3, w0+60)); X.set(c, x); Wc.set(c, w); x += w; }
  const ends = L.cols.map(c => [L.colX.get(c), L.colW.get(c), X.get(c), Wc.get(c)]);
  const map = px => { for(const [ox, ow, nx, nw] of ends){ if(px <= ox + ow + .01) return nx + (ow ? (Math.max(0, px - ox)) * nw/ow : 0); } return x + (px - L.W); };
  return L._gg = {key, W: x, X, Wc, map};
}
function gItem(it, G){
  const o = Object.assign({}, it);
  o.bx = G.X.get(it.b.c); o.bw = G.X.get(it.b.c2) + G.Wc.get(it.b.c2) - o.bx;
  if(it.tw) o.tw = G.map(it.bx + it.tw) - o.bx;
  return o;
}
const tableW = L => design()==="glass" ? glassGeom(L).W : L.W;
const cellBox = it => { if(design()!=="glass") return it; const G = glassGeom(it.L); return gItem(it, G); };
/* shrink text that would not fit its cell (Excel widths are measured for Excel's font) – never below 70 % */
function fitPx(it, px, w){
  if(!it.text || it.wrap || it.ov) return px;
  const avail = Math.max(10, w - 20), est = String(it.text).length * px * (it.isText ? 0.53 : 0.56);
  return est > avail ? px * Math.max(0.7, avail/est) : px;
}
/* renderGlass(L, opts) lives in scene.js (scene model + Liquid Glass material translation) */

/* ----------------------------------------------------------------------------- wallpaper ---- */
const WALLS = new Map();
function applyWallCss(w){
  document.getElementById("wallcss")?.remove();
  const st = document.createElement("style"); st.id = "wallcss";
  st.textContent = `.slide.glass{--wall:url(${w.sharp});--wallblur:url(${w.blur});--wallbase:${w.base}}`;
  document.head.appendChild(st);
}
function makeWall(){
  const gi = glassLevel(), amt = Math.max(0, Math.min(100, +SETTINGS.app.color || 0)) / 100, key = gi + "|" + amt;
  if(WALLS.has(key)) return applyWallCss(WALLS.get(key));
  const W = 1600, H = 900, k = (.4 + .6*gi) * amt;                // amount 0 = plain white, 1 = full colour
  const mix = (hex, t) => { const [r,g,b] = hexRgb(hex); const m = v => Math.round(255 + (v-255)*t); return `rgb(${m(r)},${m(g)},${m(b)})`; };
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  const g = x.createLinearGradient(0,0,W,H); g.addColorStop(0,mix("#D3E2FF",amt)); g.addColorStop(.48,mix("#ECE6FF",amt)); g.addColorStop(1,mix("#FFE8D8",amt));
  x.fillStyle = g; x.fillRect(0,0,W,H);
  const blob = (cx,cy,r,rgb,a) => { const rg = x.createRadialGradient(cx,cy,0,cx,cy,r); rg.addColorStop(0,`rgba(${rgb},${a})`); rg.addColorStop(.55,`rgba(${rgb},${a*.45})`); rg.addColorStop(1,`rgba(${rgb},0)`); x.fillStyle = rg; x.fillRect(0,0,W,H); };
  blob(160,110,580,"58,136,255",.62*k); blob(1460,70,580,"152,104,255",.52*k); blob(1390,870,620,"255,136,92",.48*k);
  blob(210,890,560,"52,200,176",.44*k); blob(860,440,480,"255,255,255",.6); blob(1010,900,380,"255,90,166",.22*k); blob(640,30,380,"84,196,255",.32*k);
  x.save(); x.filter = "blur(48px)"; x.lineCap = "round";
  const ribbon = (p, w, stops) => { const lg = x.createLinearGradient(p[0],p[1],p[6],p[7]); stops.forEach(([o,c])=>lg.addColorStop(o,c)); x.strokeStyle = lg; x.lineWidth = w; x.beginPath(); x.moveTo(p[0],p[1]); x.bezierCurveTo(p[2],p[3],p[4],p[5],p[6],p[7]); x.stroke(); };
  if(amt > 0) ribbon([-100,650, 420,380, 980,870, 1700,420], 160, [[0,"rgba(255,255,255,.8)"],[.5,`rgba(140,190,255,${.55*k})`],[1,`rgba(255,200,170,${.6*k})`]]);
  if(amt > 0) ribbon([-100,220, 500,520, 1100,40, 1700,260], 120, [[0,`rgba(190,160,255,${.5*k})`],[.6,"rgba(255,255,255,.7)"],[1,`rgba(120,220,255,${.45*k})`]]);
  x.restore();
  // fine grain: avoids gradient banding in exports
  if(amt > 0){ const id = x.getImageData(0,0,W,H), d = id.data; let seed = 1234567;
    for(let i=0;i<d.length;i+=4){ seed = (seed*1103515245+12345) & 0x7fffffff; const n = (((seed>>16)&7) - 3.5) * Math.min(1, amt*2); d[i]+=n; d[i+1]+=n; d[i+2]+=n; }
    x.putImageData(id,0,0); }
  const sharp = c.toDataURL("image/jpeg", .94);
  const b = document.createElement("canvas"); b.width = W/2; b.height = H/2; const y = b.getContext("2d");
  y.filter = `blur(${12 + 8*gi}px) saturate(${1 + .4*gi*amt}) brightness(${1 + .08*amt})`; y.drawImage(c, -50, -50, W/2+100, H/2+100);
  const blur = b.toDataURL("image/jpeg", .92);
  const w = {sharp, blur, base: mix("#E9EDF6", amt)};
  WALLS.set(key, w); applyWallCss(w);
}
function placeGlass(el, ex, ey, ew, eh, sc){
  const LENS = 1 + .06*glassLevel();
  const cx = ex + ew/2, cy = ey + eh/2;
  el.style.backgroundSize = `100% 100%, ${(1600*LENS/sc).toFixed(2)}px ${(900*LENS/sc).toFixed(2)}px`;
  el.style.backgroundPosition = `0 0, ${(-(ex + (LENS-1)*cx)/sc).toFixed(2)}px ${(-(ey + (LENS-1)*cy)/sc).toFixed(2)}px`;
}

/* ----------------------------------------------------------------------------- slide layout ---- */
const GX = 36, GY = 28, MAXK = 2.0;
const areaFor = R => R.subtitle ? {x:50, y:126, w:1500, h:696} : {x:50, y:104, w:1500, h:718};
function defaultLayout(R){
  // tables of the same sheet that share rows sit side by side; everything else stacks, in slide order
  const T = R.tables, bands = [];
  T.forEach((L, i) => {
    const bd = bands.find(b => b.sheet===L.sheet && L.g.r1 <= b.r2 && L.g.r2 >= b.r1);
    if(bd){ bd.ids.push(i); bd.r1 = Math.min(bd.r1, L.g.r1); bd.r2 = Math.max(bd.r2, L.g.r2); }
    else bands.push({sheet:L.sheet, r1:L.g.r1, r2:L.g.r2, ids:[i]});
  });
  bands.forEach(b => b.ids.sort((p,q) => T[p].g.c1 - T[q].g.c1));
  return {bands: bands.map(b=>b.ids), w: T.map(()=>1)};
}
function validLayout(L, n){
  if(!L || !Array.isArray(L.bands) || !Array.isArray(L.w) || L.w.length!==n) return false;
  const seen = L.bands.flat(); return seen.length===n && new Set(seen).size===n && seen.every(i=>Number.isInteger(i) && i>=0 && i<n);
}
function layoutOf(R){
  const saved = R.cfg && R.cfg.layout;
  if(validLayout(saved, R.tables.length)) return saved;
  if(!R._auto || R._auto.w.length!==R.tables.length) R._auto = defaultLayout(R);
  return R._auto;
}
function computeLayout(R, w){
  if(!R.tables.length) return {boxes:[], k:1};
  const lay = layoutOf(R); w = w || lay.w; const T = R.tables, A = areaFor(R);
  const bands = lay.bands.filter(b=>b.length);
  let k = MAXK;
  const sumH = bands.reduce((s,b)=>s+Math.max(...b.map(i=>T[i].H*w[i])),0);
  k = Math.min(k, (A.h - GY*(bands.length-1)) / sumH);
  for(const b of bands){ const sw = b.reduce((s,i)=>s+tableW(T[i])*w[i],0); k = Math.min(k, (A.w - GX*(b.length-1)) / sw); }
  k = Math.max(k, 0.01);
  const boxes = []; let y = 0;
  const dims = bands.map(b => ({w: b.reduce((s,i)=>s+tableW(T[i])*w[i]*k,0) + GX*(b.length-1), h: Math.max(...b.map(i=>T[i].H*w[i]*k))}));
  const Htot = dims.reduce((s,d)=>s+d.h,0) + GY*(bands.length-1);
  const top = A.y + Math.max(0, (A.h - Htot)/2 * 0.35);
  bands.forEach((b,bi) => {
    let x = A.x + (A.w - dims[bi].w)/2;
    for(const i of b){ const sc = k*w[i], tw = tableW(T[i]); boxes[i] = {i, band:bi, x, y: top+y, w: tw*sc, h: T[i].H*sc, scale: sc}; x += tw*sc + GX; }
    y += dims[bi].h + GY;
  });
  return {boxes, k};
}

/* ----------------------------------------------------------------------------- slide builder ---- */
const design = () => SETTINGS.app.design === "excel" ? "excel" : "glass";
const GLASS_LEVELS = {subtle:.35, medium:.65, strong:1};
const glassLevel = () => GLASS_LEVELS[SETTINGS.app.glass] ?? GLASS_LEVELS.subtle;
const pnCfg = () => SETTINGS.app.pn || DEFAULT_SETTINGS().app.pn;
function pageNumber(i){ const p = pnCfg(); return (isFinite(+p.start) ? +p.start : 1) + i; }        // number of slide i (cover counts)
function pageNoFor(i){                                                                             // label shown on slide i, or null
  const p = pnCfg(); if(!p.on) return null;
  if(DOC.slides[i] && DOC.slides[i].type==="cover" && !p.cover) return null;
  const n = pageNumber(i), N = pageNumber(Math.max(0, DOC.slides.length-1));
  return p.format==="nN" ? `${n} / ${N}` : p.format==="page" ? `Page ${n}` : p.format==="p" ? `p. ${n}` : String(n);
}
const PN_FONTS = {auto:null, segoe:"'Segoe UI Variable Text','Segoe UI',Arial,sans-serif", arial:"Arial,Helvetica,sans-serif", calibri:"Calibri,Carlito,Arial,sans-serif",
  gothic:"'Century Gothic','URW Gothic',Arial,sans-serif", georgia:"Georgia,'Times New Roman',serif", verdana:"Verdana,Geneva,sans-serif", mono:"Consolas,'Cascadia Mono',monospace"};
function pageNoBox(label, glassy){
  const p = pnCfg(), size = Math.max(9, Math.min(36, +p.size || 16)), capsule = glassy && p.style!=="plain";
  return {size, capsule, w: Math.round(label.length * size * .62 + (capsule ? 34 : 4)), h: Math.round(size * (capsule ? 2.4 : 1.4))};
}
function pageNoHtml(label, glassy, hasLogo, cover){
  const p = pnCfg(), font = PN_FONTS[p.font] || null, {size, capsule, w, h} = pageNoBox(label, glassy);
  const margin = 40, top = p.pos[0]==="t" ? (capsule ? 24 : 28) : 900 - margin + 6 - h;
  let left = p.pos[1]==="l" ? 56 : p.pos[1]==="c" ? (1600 - w)/2 : 1600 - 44 - w;
  if(p.pos==="br" && hasLogo) left = (glassy ? (cover ? 1150 : 1256) : 1600 - 340) - 22 - w;   // never on top of the logo
  if(p.pos==="bl" && hasLogo && cover) left = 1600 - 44 - w;
  const st = `left:${left}px;top:${top}px;width:${w}px;height:${h}px;font-size:${size}px;${font ? `font-family:${font};` : ""}`;
  return capsule ? `<div class="gls wb chrome pageno" style="${st}border-radius:${h/2}px"><span>${esc(label)}</span></div>`
                 : `<div class="pageno plain" style="${st}line-height:${h}px;text-align:${p.pos[1]==="l"?"left":p.pos[1]==="c"?"center":"right"}">${esc(label)}</div>`;
}
function logoSrc(){ const n = (SETTINGS.app.logo||"").trim(); if(!n) return ""; return SERVED ? "/assets/" + encodeURIComponent(n) : encodeURI(n); }
const slideHasLogo = R => !(R.cfg && R.cfg.logo===false);
function tableHtml(R, i, thumb){
  const L = R.tables[i], d = design(), key = d + "|" + glassLevel() + "|" + sheetKey(L.sheet);
  if(thumb && L.items.length > 1200){            // thumbnails of big tables: shapes only, no text
    if(!L._thtml || L._thtml.key !== key) L._thtml = {key, html: d==="glass" ? renderGlass(L, {noText:true}) : renderExcel(L, {noText:true})};
    return L._thtml.html;
  }
  if(!L._html || L._html.key !== key) L._html = {key, html: d==="glass" ? renderGlass(L) : renderExcel(L)};
  return L._html.html;
}
function buildSlide(R, idx, opts={}){
  const d = design(), glassy = d==="glass";
  const slide = document.createElement("div");
  slide.className = "slide " + d + (R.type!=="content" ? " " + R.type : "");
  if(glassy){ slide.style.setProperty("--gi", glassLevel()); slide.style.setProperty("--amt", (+SETTINGS.app.color||0)/100); }
  const pageNo = pageNoFor(idx);
  const logo = slideHasLogo(R) ? logoSrc() : "", cover = R.type==="cover";
  let h = glassy ? `<div class="wall"></div>` : "";
  // a page number in the top-left corner pushes the title to the right
  const shift = pageNo!==null && pnCfg().pos==="tl" ? pageNoBox(pageNo, glassy).w + 22 : 0, sh = shift ? ` style="left:${56 + shift}px"` : "";
  if(cover) h += coverHtml(R, glassy);
  else {
    h += `<div class="title" data-edit="title"${sh}>${esc(R.title)}</div>`;
    if(R.subtitle) h += `<div class="subtitle" data-edit="subtitle"${sh}>${esc(R.subtitle)}</div>`;
  }
  if(R.type==="index") h += indexHtml(R, idx, glassy);
  if(pageNo!==null) h += pageNoHtml(pageNo, glassy, !!logo, cover);
  R.tables.forEach((t,i) => { h += `<div class="tw" data-i="${i}" style="width:${tableW(t)}px;height:${t.H}px">${tableHtml(R,i,opts.thumb)}${opts.interactive ? hitsHtml(R,i) : ""}</div>`; });
  if(opts.interactive) h += R.tables.map((t,i)=>`<div class="hbox" data-i="${i}"><div class="grip" title="Drag to move this table">⠿ ${esc(tableName(t))}</div><div class="size" title="Drag to resize"></div></div>`).join("") + `<div class="dropmark"></div>`;
  if(R.type==="content" && !R.tables.length && opts.interactive) h += `<div class="emptyslide">No tables on this slide – add some with the wizard.</div>`;
  if(logo) h += glassy
    ? `<div class="gls wb chrome logowrap" style="left:${cover?1150:1256}px;top:${cover?800:832}px;width:${cover?400:314}px;height:${cover?68:52}px;border-radius:${cover?34:26}px"><img class="logo" src="${logo}" alt=""></div>`
    : `<div class="logowrap${cover?" big":""}"><img class="logo" src="${logo}" alt=""></div>`;
  slide.innerHTML = h;
  slide._rid = R.id;
  slide.querySelectorAll(":scope > .tw").forEach(tw => { tw._html = tableHtml(R, +tw.dataset.i, opts.thumb); });
  slide.querySelectorAll("img.logo").forEach(img => img.addEventListener("error", () => { img.parentNode.style.display = "none"; LOGO_MISSING = true; }));
  applyLayout(slide, R);
  return slide;
}
let LOGO_MISSING = false;
function applyLayout(slide, R, w){
  const {boxes} = computeLayout(R, w);
  const glassy = slide.classList.contains("glass");
  slide.querySelectorAll(".tw").forEach(el => {
    const b = boxes[+el.dataset.i]; el.style.left=b.x+"px"; el.style.top=b.y+"px"; el.style.transform=`scale(${b.scale})`;
    if(glassy) el.querySelectorAll(".wb").forEach(g => placeGlass(g, b.x+parseFloat(g.style.left)*b.scale, b.y+parseFloat(g.style.top)*b.scale, parseFloat(g.style.width)*b.scale, parseFloat(g.style.height)*b.scale, b.scale));
  });
  if(glassy) slide.querySelectorAll(":scope > .chrome.wb").forEach(g => placeGlass(g, parseFloat(g.style.left), parseFloat(g.style.top), parseFloat(g.style.width), parseFloat(g.style.height), 1));
  slide.querySelectorAll(".hbox").forEach(el => { const b = boxes[+el.dataset.i]; Object.assign(el.style, {left:b.x+"px", top:b.y+"px", width:b.w+"px", height:b.h+"px"}); });
  return boxes;
}

/* ============================================================================================
   EDITOR APP
   ============================================================================================ */
const DOC = {name:"", src:"", id:"", wb:null, slides:[], mtime:0};
const SERVER = {ok:false, engine:null};
let CUR = 0, SEL = null, ZOOM = "fit", BUSY = false;
const UNDO = [], REDO = [];

/* ---- small UI helpers */
function toast(msg, actions=[], err=false){
  const t = $("toast"); t.className = "toast show" + (err?" err":"");
  t.innerHTML = `<span>${msg}</span>` + actions.map((a,i)=>`<button data-k="${i}">${esc(a.label)}</button>`).join("");
  t.querySelectorAll("button").forEach(b => b.onclick = () => { actions[+b.dataset.k].fn(); t.className = "toast"; });
  clearTimeout(t._h); t._h = setTimeout(() => t.className = "toast", err ? 9000 : 6000);
}
function paintSave(){
  const el = $("sbSave"); if(!el) return;
  const m = {pending:"Unsaved changes…", saving:"Saving…", saved:"✓ Saved to slide_builder_settings.txt", local:"Saved in this browser only (helper not running)", error:"⚠ Not saved: " + saveError};
  el.textContent = m[saveState] || ""; el.className = saveState==="error" ? "err" : saveState==="saved" ? "ok" : "";
}
function closeMenus(except){ document.querySelectorAll(".menu.open").forEach(m => { if(m!==except) m.classList.remove("open"); }); }
document.addEventListener("pointerdown", e => { if(!e.target.closest(".dd")) closeMenus(); });

/* ---- server */
async function pollHealth(){
  if(!SERVED){ paintServer(); return; }
  try{ const r = await fetch("/api/health", {cache:"no-store"}); const j = await r.json(); SERVER.ok = true; SERVER.engine = j.engine; SERVER.folder = j.folder; }
  catch(e){ SERVER.ok = false; }
  paintServer();
}
function paintServer(){
  const p = $("srv");
  if(!SERVED){ p.className = "pill err"; p.innerHTML = `<i class="dot"></i>Helper not running`; $("bannerOffline").classList.add("show"); }
  else if(!SERVER.ok){ p.className = "pill err"; p.innerHTML = `<i class="dot"></i>Helper stopped`; }
  else { const e = SERVER.engine||{}; const ok = e.state==="ready", st = e.state==="starting"||e.state==="idle";
    SERVER.needsInstall = !ok && !st;
    p.className = "pill " + (ok?"ok":st?"warn":"err"); p.title = (e.error ? e.error + "\n\n" : "") + "Click to restart the export engine. If it stays unavailable, exports are rendered in this window instead.";
    p.innerHTML = `<i class="dot"></i>${ok ? "Export: " + (e.browser||"ready") : st ? "Testing export engines…" : "Export: in-window only · install engine"}`;
    if(e.engines) p.title = e.engines.map(x => `${x.label}: ${x.state}${x.detail?" – "+x.detail:""}`).join("\n") + "\n\nClick to retry. Install the recommended engine once with “Install export engine.bat”."; }
  const can = SERVED && SERVER.ok && DOC.slides.length && !BUSY;
  ["exportBtn","exportMenuBtn"].forEach(id => $(id).disabled = !can);
}

/* ---- workbook loading */
async function listFiles(){
  if(!SERVED) return [];
  try{ const r = await fetch("/api/files", {cache:"no-store"}); return (await r.json()).workbooks || []; }catch(e){ return []; }
}
async function openFromFolder(name, ask=true){
  const r = await fetch("/files/" + encodeURIComponent(name), {cache:"no-store"});
  if(!r.ok) throw new Error("Could not read " + name);
  const list = await listFiles(); const f = list.find(x => x.name===name);
  await openBuffer(await r.arrayBuffer(), name, "folder", "", f ? f.mtime : 0, ask);
}
async function openLocalFile(file){
  const buf = await file.arrayBuffer();
  const inFolder = (await listFiles()).find(x => x.name===file.name && x.size===file.size);
  if(inFolder) return openBuffer(buf, file.name, "folder", "", inFolder.mtime);
  let id = "";
  if(SERVED && SERVER.ok){ try{ const r = await fetch("/api/upload?name=" + encodeURIComponent(file.name), {method:"POST", body: buf}); id = (await r.json()).id; }catch(e){} }
  await openBuffer(buf, file.name, id ? "upload" : "local", id, 0);
}
function paintFileName(){
  const n = DOC.slides.length;
  $("fileName").innerHTML = `<b>${esc(DOC.name)}</b> · ${n} slide${n===1?"":"s"}` + (DOC.src==="upload" ? " · not in the folder" : DOC.src==="local" ? " · preview only" : "");
}
/* ask = true when the user opens a file: saved preset → "continue or wizard?", no preset → wizard */
/* read a workbook; .xlsb, old .xls and some protected files are converted by Excel itself (through the helper) */
/* progress overlay for long reads */
function showBusy(text, frac){
  let el = $("busy");
  if(!el){ el = document.createElement("div"); el.id = "busy"; el.innerHTML = `<div class="busybox"><div class="busytxt"></div><div class="busybar"><i></i></div><div class="busyhint">Large workbooks: only the sheets you choose are read.</div></div>`; document.body.appendChild(el); }
  el.style.display = "flex";
  el.querySelector(".busytxt").textContent = text;
  const bar = el.querySelector(".busybar i");
  if(frac==null){ bar.classList.add("indet"); bar.style.width = "35%"; } else { bar.classList.remove("indet"); bar.style.width = Math.round(Math.max(.03, Math.min(1, frac))*100) + "%"; }
}
function hideBusy(){ const el = $("busy"); if(el) el.style.display = "none"; }
const presetSheets = p => [...new Set(((p && p.tables) || []).map(t => t.sheet))];

async function loadWorkbook(buf, name){
  let wb;
  showBusy(`Opening “${name}” (${fmtMB(buf.byteLength)})…`, null); await nextFrame();
  try{ wb = await indexWorkbook(buf); }
  catch(e){
    if(!["XLSB","CFB"].includes(e.code)) throw e;
    const what = e.code==="XLSB" ? "an Excel Binary Workbook (.xlsb)" : "an old .xls workbook or a protected file";
    if(!(SERVED && SERVER.ok)) throw new Error(`“${name}” is ${what}. Start the app with Start Slide Builder.bat so Excel can convert it, or save it in Excel as .xlsx.`);
    $("fileName").innerHTML = `Converting <b>${esc(name)}</b> with Excel…`;
    const r = await fetch("/api/convert-workbook?name=" + encodeURIComponent(name), {method:"POST", body: buf});
    if(!r.ok){ const j = await r.json().catch(()=>({})); throw new Error(`“${name}” is ${what} and Excel could not convert it: ${j.error || r.status}. Save it in Excel as .xlsx (File › Save As › Excel Workbook) and open that copy.`); }
    const out = await r.arrayBuffer();
    try{ wb = await indexWorkbook(out); toast(`“${esc(name)}” was converted by Excel for reading – the original file is unchanged.`); }
    catch(e2){ throw new Error(e2.code==="CFB" ? `“${name}” is protected (password or sensitivity label with encryption). Remove the protection or save an unprotected .xlsx copy.` : e2.message); }
  }
  // small workbooks are read completely (the wizard can then show titles and table suggestions for every sheet);
  // large ones are read sheet by sheet, only when a sheet is chosen or used by the preset
  if(!wb.big) await wb.ensure(wb.meta.map(m => m.name), showBusy);
  return wb;
}
async function openBuffer(buf, name, src, id, mtime, ask=true){
  const before = $("fileName").innerHTML;
  $("fileName").innerHTML = `Opening <b>${esc(name)}</b>…`;
  let wb;
  try{ wb = await loadWorkbook(buf, name); }
  catch(e){ hideBusy(); $("fileName").innerHTML = before; throw e; }
  hideBusy();
  LCACHE.clear();
  let preset = presetOf(name);
  try{
    if(preset && ask){
      const choice = await presetBox(name, preset, wb);
      if(!choice){ $("fileName").innerHTML = before; return; }
      if(choice==="wizard"){ const np = await runWizard(wb, name, preset); if(np) preset = np; }
    } else if(!preset){
      const draft = defaultPreset(wb, name);
      if(!ask && !wb.big && draft.slides.length) preset = draft;        // start-up / reload: older “x” workbooks open as before
      else {
        const np = await runWizard(wb, name, draft);
        if(!np){ $("fileName").innerHTML = before; return; }
        preset = np;
      }
    }
    await wb.ensure(presetSheets(preset), showBusy);                     // only the sheets the slides use
  } finally { hideBusy(); }
  savePreset(name, preset); scheduleSave();
  Object.assign(DOC, {name, src, id, wb, mtime});
  DOC.slides = runtimeSlides(wb, preset);
  if(src==="folder"){ SETTINGS.app.lastFile = name; scheduleSave(); }
  SEL = null; CUR = Math.min(CUR, Math.max(0, DOC.slides.length-1)); LOGO_MISSING = false;
  UNDO.length = 0; REDO.length = 0;
  paintFileName();
  $("bannerChanged").classList.remove("show");
  renderAll();
}
async function openWizard(){
  if(!DOC.wb) return;
  const before = snap();
  let np;
  try{ np = await runWizard(DOC.wb, DOC.name, presetOf(DOC.name) || defaultPreset(DOC.wb, DOC.name)); } finally { hideBusy(); }
  if(!np) return;
  await DOC.wb.ensure(presetSheets(np), showBusy); hideBusy();
  savePreset(DOC.name, np);
  rebuildSlides(); commit(before, "Wizard changes", true);
  renderThumbs(); paintFileName();
}
async function reloadWorkbook(){ if(DOC.src==="folder") await openFromFolder(DOC.name, false); }
async function watchFile(){
  if(DOC.src!=="folder" || !SERVER.ok) return;
  const f = (await listFiles()).find(x => x.name===DOC.name);
  if(f && DOC.mtime && f.mtime > DOC.mtime + 0.5) $("bannerChanged").classList.add("show");
}
function rebuildSlides(){
  const keep = DOC.slides[CUR] && DOC.slides[CUR].id;
  DOC.slides = runtimeSlides(DOC.wb, presetOf(DOC.name) || {tables:[], slides:[]});
  const i = DOC.slides.findIndex(R => R.id===keep);
  CUR = i>=0 ? i : Math.max(0, Math.min(CUR, DOC.slides.length-1));
}

/* ---- render the editor */
function renderAll(){ renderThumbs(); renderStage(); renderIssues(); updateRibbon(); paintServer(); }
function renderStage(){
  const host = $("stage"); host.innerHTML = "";
  $("emptyState").style.display = DOC.slides.length ? "none" : "flex";
  $("zoomctl").style.display = DOC.slides.length ? "flex" : "none";
  $("wizardBtn").disabled = !DOC.wb;
  if(!DOC.slides.length) return;
  const R = DOC.slides[CUR];
  const wrap = document.createElement("div"); wrap.className = "stagewrap";
  const slide = buildSlide(R, CUR, {interactive:true});
  wrap.appendChild(slide); host.appendChild(wrap);
  wireSlide(slide, R);
  fitStage();
}
function fitStage(){
  const host = $("stage"), wrap = host.querySelector(".stagewrap"); if(!wrap) return;
  const cw = host.clientWidth, ch = host.clientHeight;
  const fit = Math.min((cw-56)/1600, (ch-64)/900);
  const s = ZOOM==="fit" ? fit : ZOOM;
  const slide = wrap.querySelector(".slide"); slide.style.transform = `scale(${s})`;
  wrap.style.width = 1600*s+"px"; wrap.style.height = 900*s+"px";
  wrap.style.left = Math.max(16,(cw-1600*s)/2)+"px"; wrap.style.top = Math.max(16,(ch-900*s)/2)+"px";
  host.style.overflow = ZOOM==="fit" ? "hidden" : "auto";
  $("zoomVal").textContent = Math.round(s*100) + "%";
  wrap._scale = s;
}
window.addEventListener("resize", () => fitStage());
let thumbTimer = null;
let THUMB_IO = null;
function fillThumb(fr, i){ if(!DOC.slides[i]) return; fr.innerHTML = ""; fr.appendChild(buildSlide(DOC.slides[i], i, {thumb:true})); fr.dataset.done = "1"; }
function renderThumbs(only){
  const box = $("thumbs");
  if(only!==undefined){
    const fr = box.querySelector(`.thumb[data-i="${only}"] .frame`); if(fr && fr.dataset.done) fillThumb(fr, only);
    // the index slide lists titles: refresh it too
    DOC.slides.forEach((R,i) => { if(R.type==="index" && i!==only){ const f2 = box.querySelector(`.thumb[data-i="${i}"] .frame`); if(f2 && f2.dataset.done) fillThumb(f2, i); } });
    return;
  }
  if(THUMB_IO) THUMB_IO.disconnect();
  THUMB_IO = new IntersectionObserver(es => es.forEach(en => { if(en.isIntersecting){ THUMB_IO.unobserve(en.target); fillThumb(en.target, +en.target.dataset.i); } }), {root: box, rootMargin: "300px"});
  box.innerHTML = "";
  DOC.slides.forEach((R,i) => {
    const b = document.createElement("button"); b.className = "thumb" + (i===CUR?" on":""); b.dataset.i = i;
    const issues = slideIssues(R).filter(x => x.cls==="warn" || x.cls==="err").length;
    b.innerHTML = `<div class="frame" data-i="${i}"></div><div class="cap"><span class="n">${i+1}</span><b>${esc(R.label)}</b>${R.type!=="content"?`<span class="tag">${R.type}</span>`:""}${issues?`<span class="badge">${issues}</span>`:""}</div>`;
    THUMB_IO.observe(b.querySelector(".frame"));
    b.onclick = () => gotoSlide(i);
    box.appendChild(b);
  });
  $("slideCount").textContent = DOC.slides.length ? String(DOC.slides.length) : "";
}
function refreshThumbSoon(){ clearTimeout(thumbTimer); const i = CUR; thumbTimer = setTimeout(() => renderThumbs(i), 350); }

/* ---- issues */
function slideIssues(R){
  const out = [];
  if(R.type==="cover") return [{cls:"", html:"Cover slide · double-click the title to edit it, or use the wizard (step 3)."}];
  if(R.type==="index") return [{cls:"", html:`Index slide · lists ${contentSlides().length} content slide(s) with their page numbers.`}];
  if(R.missing) out.push({cls:"err", html:`${R.missing} table${R.missing>1?"s":""} of this slide could not be found (sheet renamed or deleted?). Open the wizard to fix.`});
  if(!R.tables.length) out.push({cls:"warn", html:"No tables on this slide."});
  const {boxes} = computeLayout(R);
  const sheets = new Set();
  R.tables.forEach((T,i) => {
    sheets.add(T.sheet);
    out.push({cls:"", html:`<b>${esc(tableName(T))}</b> · ${esc(T.sheet.name)} <code>${A1(T.g.r1+1,T.g.c1+1)}:${A1(T.g.r2-1,T.g.c2-1)}</code> · ${T.rows.length}×${T.cols.length}` + (T.hiddenRows||T.hiddenCols?` · ${T.hiddenRows} hidden rows, ${T.hiddenCols} hidden cols skipped`:"") + (T.def && T.def.grow ? " · grows with new rows" : "")});
    if(T.errors.length) out.push({cls:"err", html:`Error values: <code>${T.errors.slice(0,8).join(" ")}${T.errors.length>8?" …":""}</code>`});
    const sizes = T.items.filter(it=>it.text && it.text.length>1).map(it=>it.font.sz||11).sort((a,b)=>a-b);
    const typical = sizes.length ? sizes[Math.floor(sizes.length*0.25)] : 11;
    const px = typical*96/72*boxes[i].scale;
    if(isFinite(px) && px < 9.5) out.push({cls:"warn", html:`Small text (≈${px.toFixed(1)}px at 100%): enlarge the table or move it to its own slide.`});
  });
  for(const S of sheets){
    const D = S.drawing;
    if(D.charts.length) out.push({cls:"warn", html:`Chart${D.charts.length>1?"s":""} on ${esc(S.name)} not reproduced: ${D.charts.map(esc).join(", ")}. In Excel: copy the chart › Paste Special › Picture (PNG) inside the table area.`});
    if(D.unsupported.length) out.push({cls:"warn", html:`Picture${D.unsupported.length>1?"s":""} on ${esc(S.name)} that could not be read: ${D.unsupported.map(esc).join(", ")}`});
    if(S.unsupportedCF.size) out.push({cls:"warn", html:`Not reproduced on ${esc(S.name)}: ${[...S.unsupportedCF].join(", ")} conditional formats`});
    const cfg = sheetCfg(S), n = Object.keys(cfg.cells).length;
    if(n){ const all = R.tables.filter(T=>T.sheet===S).flatMap(T=>T.items); const stale = Object.entries(cfg.cells).filter(([k,e]) => e.text!==undefined && all.some(it => A1(it.b.src.r,it.b.src.c)===k) && !all.some(it => A1(it.b.src.r,it.b.src.c)===k && it.text===e.orig)).length;
      out.push({cls:"", html:`${n} edited cell${n>1?"s":""} on ${esc(S.name)}` + (stale?` · <span class="warn">${stale} text edit${stale>1?"s":""} paused: the Excel value changed</span>`:"")}); }
  }
  if(R.cfg.layout) out.push({cls:"ok", html:"Custom table layout saved"});
  return out;
}
function renderIssues(){
  const box = $("issues");
  if(!DOC.slides.length){ box.innerHTML = ""; return; }
  const R = DOC.slides[CUR], P = presetOf(DOC.name) || {tables:[]};
  const used = new Set(DOC.slides.flatMap(S => S.cfg.tables || []));
  const unused = P.tables.filter(t => !used.has(t.id)).length;
  box.innerHTML = `<h4>Slide ${CUR+1} · ${esc(R.label)}</h4><ul>${slideIssues(R).map(x=>`<li class="${x.cls}">${x.html}</li>`).join("")}${LOGO_MISSING?`<li class="warn">Logo “${esc(SETTINGS.app.logo)}” not found in the folder</li>`:""}</ul>` +
    `<h4 style="margin-top:10px">Preset</h4><ul><li>${P.tables.length} table${P.tables.length===1?"":"s"} · ${DOC.slides.length} slide${DOC.slides.length===1?"":"s"}${unused?` · <span class="warn">${unused} table${unused>1?"s":""} not on any slide</span>`:""}</li></ul>`;
}

/* ---- undo / redo: snapshots of this workbook's preset + cell edits */
function snap(){ return JSON.stringify({p: (SETTINGS.presets||{})[DOC.name] || null, f: SETTINGS.files[DOC.name] || null}); }
function restore(json){
  EDITV++;
  const o = JSON.parse(json); SETTINGS.presets = SETTINGS.presets || {};
  if(o.p) SETTINGS.presets[DOC.name] = o.p; else delete SETTINGS.presets[DOC.name];
  if(o.f) SETTINGS.files[DOC.name] = o.f; else delete SETTINGS.files[DOC.name];
  rebuildSlides();
}
function commit(before, label, full){
  const after = snap(); if(after===before) return;
  EDITV++;
  UNDO.push({file:DOC.name, before, after, label, full:!!full}); if(UNDO.length>200) UNDO.shift(); REDO.length = 0;
  scheduleSave(); afterChange(full);
}
function mutate(label, fn, full){
  const R = DOC.slides[CUR]; if(!R) return;
  const before = snap(); fn(R); commit(before, label, full);
}
function afterChange(full){ if(full) renderStage(); else refreshStage(); if(full) renderThumbs(); else refreshThumbSoon(); renderIssuesSoon(); updateRibbon(); }
let issuesTimer = null;
function renderIssuesSoon(){ clearTimeout(issuesTimer); issuesTimer = setTimeout(renderIssues, 250); }
function patchTable(oldEl, newEl){
  const a = oldEl.children, b = newEl.children;
  if(a.length !== b.length || oldEl.getAttribute("style") !== newEl.getAttribute("style")){ oldEl.replaceWith(newEl); return; }
  for(let i = b.length-1; i >= 0; i--) if(!a[i].isEqualNode(b[i])) a[i].replaceWith(b[i]);
}
function refreshStage(){
  const slide = $("stage").querySelector(".stagewrap .slide"), R = DOC.slides[CUR];
  if(!slide || !R || slide._rid !== R.id || slide.querySelectorAll(":scope > .tw").length !== R.tables.length) return renderStage();
  slide.querySelectorAll(":scope > .tw").forEach(tw => {
    const i = +tw.dataset.i, L = R.tables[i], html = tableHtml(R, i);
    if(tw._html === html) return;
    const tmp = document.createElement("div"); tmp.innerHTML = html;
    patchTable(tw.querySelector(".xt"), tmp.firstElementChild);       // only the cells that changed are swapped
    tw._html = html; tw.style.width = tableW(L) + "px";
    const hits = tw.querySelector(".hits"); if(hits) hits.style.width = tableW(L) + "px";
  });
  applyLayout(slide, R); paintSel();
}
function undo(redo){
  const st = redo ? REDO : UNDO, other = redo ? UNDO : REDO;
  const a = st.pop(); if(!a || a.file!==DOC.name) return;
  restore(redo ? a.after : a.before); other.push(a);
  SEL = null; scheduleSave(); renderThumbs(); afterChange(true); paintFileName();
  toast((redo?"Redo: ":"Undo: ") + esc(a.label));
}

/* ---- selection */
function gridOf(T){
  if(T._grid) return T._grid;
  const m = new Map();
  for(const it of T.items){ for(const r of T.rows) if(r>=it.b.r && r<=it.b.r2) for(const c of T.cols) if(c>=it.b.c && c<=it.b.c2) m.set(r+","+c, it); }
  return T._grid = m;
}
function itemAt(T, r, c){ return gridOf(T).get(r+","+c) || T.items.find(it => it.b.src.r===r && it.b.src.c===c); }
function selItems(){
  if(!SEL) return [];
  const T = DOC.slides[CUR].tables[SEL.t];
  return T.items.filter(it => it.b.r <= SEL.r2 && it.b.r2 >= SEL.r1 && it.b.c <= SEL.c2 && it.b.c2 >= SEL.c1);
}
function activeItem(){ if(!SEL) return null; return itemAt(DOC.slides[CUR].tables[SEL.t], SEL.ar, SEL.ac); }
function setSel(t, anchor, active){
  const T = DOC.slides[CUR].tables[t];
  const a = itemAt(T, anchor.r, anchor.c), b = itemAt(T, active.r, active.c); if(!a || !b) return;
  let r1 = Math.min(a.b.r, b.b.r), r2 = Math.max(a.b.r2, b.b.r2), c1 = Math.min(a.b.c, b.b.c), c2 = Math.max(a.b.c2, b.b.c2);
  for(let k=0;k<4;k++) for(const it of T.items) if(it.b.r<=r2 && it.b.r2>=r1 && it.b.c<=c2 && it.b.c2>=c1){ r1=Math.min(r1,it.b.r); r2=Math.max(r2,it.b.r2); c1=Math.min(c1,it.b.c); c2=Math.max(c2,it.b.c2); }
  SEL = {t, anchor:{r:a.b.r, c:a.b.c}, ar:b.b.r, ac:b.b.c, r1, r2, c1, c2};
  paintSel(); updateRibbon();
}
function hitsHtml(R, i){
  const T = R.tables[i];
  return `<div class="hits" data-t="${i}" style="width:${tableW(T)}px;height:${T.H}px"><div class="hov"></div></div>`;
}
/* which cell is under a point (table coordinates): binary search over column and row edges */
function colEdges(T){
  const glassy = design()==="glass", G = glassy ? glassGeom(T) : null, key = glassy ? "g" + G.key : "x";
  if(T._ce && T._ce.key===key) return T._ce.list;
  const list = T.cols.map(c => glassy ? [G.X.get(c), G.Wc.get(c), c] : [T.colX.get(c), T.colW.get(c), c]);
  T._ce = {key, list}; return list;
}
function bsearch(list, v, start, size){ let lo = 0, hi = list.length-1; while(lo < hi){ const m = (lo+hi+1) >> 1; if(start(list[m]) <= v) lo = m; else hi = m-1; } return list[lo]; }
function cellFromPoint(T, lx, ly){
  const col = bsearch(colEdges(T), lx, e => e[0]);
  if(!T._re) T._re = T.rows.map(r => [T.rowY.get(r), T.rowH.get(r), r]);
  const row = bsearch(T._re, ly, e => e[0]);
  if(!col || !row) return null;
  return itemAt(T, row[2], col[2]);
}
function pointToCell(hits, e){
  const T = DOC.slides[CUR].tables[+hits.dataset.t], rc = hits.getBoundingClientRect(), k = rc.width / tableW(T);
  return cellFromPoint(T, (e.clientX - rc.left)/k, (e.clientY - rc.top)/k);
}
function paintSel(){
  const slide = $("stage").querySelector(".slide"); if(!slide) return;
  slide.querySelectorAll(".selbox,.actbox").forEach(e => e.remove());
  if(!SEL) return;
  const T = DOC.slides[CUR].tables[SEL.t], its = selItems().map(cellBox); if(!its.length) return;
  const hits = slide.querySelector(`.hits[data-t="${SEL.t}"]`); if(!hits) return;
  const x0 = Math.min(...its.map(a=>a.bx)), y0 = Math.min(...its.map(a=>a.by)), x1 = Math.max(...its.map(a=>a.bx+a.bw)), y1 = Math.max(...its.map(a=>a.by+a.bh));
  const sc = 1 / (computeLayout(DOC.slides[CUR]).boxes[SEL.t].scale * ($("stage").querySelector(".stagewrap")._scale||1));
  if(its.length>1) hits.insertAdjacentHTML("beforeend", `<div class="selbox" style="left:${x0}px;top:${y0}px;width:${x1-x0}px;height:${y1-y0}px"></div>`);
  const a0 = activeItem(), a = a0 && cellBox(a0);
  if(a) hits.insertAdjacentHTML("beforeend", `<div class="actbox" style="left:${a.bx}px;top:${a.by}px;width:${a.bw}px;height:${a.bh}px;box-shadow:inset 0 0 0 ${2.5*sc}px #0A66D8,0 0 0 ${1*sc}px rgba(255,255,255,.9)"></div>`);
}
function moveSel(dr, dc, extend){
  if(!SEL) return;
  const T = DOC.slides[CUR].tables[SEL.t];
  const from = extend ? {r:SEL.ar, c:SEL.ac} : {r:SEL.ar, c:SEL.ac};
  const it = itemAt(T, from.r, from.c); if(!it) return;
  let ri = T.rows.indexOf(dr>0 ? it.b.r2 : it.b.r), ci = T.cols.indexOf(dc>0 ? it.b.c2 : it.b.c);
  ri = Math.max(0, Math.min(T.rows.length-1, ri+dr)); ci = Math.max(0, Math.min(T.cols.length-1, ci+dc));
  const target = itemAt(T, T.rows[ri], T.cols[ci]); if(!target) return;
  if(extend) setSel(SEL.t, SEL.anchor, {r:target.b.r, c:target.b.c});
  else setSel(SEL.t, {r:target.b.r, c:target.b.c}, {r:target.b.r, c:target.b.c});
}

/* ---- slide interaction: cells + table move/resize */
let DRAG = null;
function wireSlide(slide, R){
  slide.addEventListener("pointerdown", e => {
    const h = e.target.closest(".hits"); if(!h) return;
    const it = pointToCell(h, e); if(!it) return;
    e.preventDefault(); $("fxInput").blur();
    const t = +h.dataset.t, cell = {r:it.b.r, c:it.b.c};
    if(e.shiftKey && SEL && SEL.t===t) setSel(t, SEL.anchor, cell); else setSel(t, cell, cell);
    DRAG = {t};
  });
  let hovT = 0;
  slide.addEventListener("pointermove", e => {
    const h = e.target.closest(".hits"); if(!h) return;
    const now = performance.now(); if(now - hovT < 16 && !(DRAG && (e.buttons & 1))) return; hovT = now;
    const it = pointToCell(h, e); if(!it) return;
    const g = cellBox(it), hv = h.querySelector(".hov");
    Object.assign(hv.style, {display:"block", left:g.bx+"px", top:g.by+"px", width:g.bw+"px", height:g.bh+"px"});
    if(DRAG && (e.buttons & 1) && +h.dataset.t===DRAG.t && SEL && (SEL.ar!==it.b.r || SEL.ac!==it.b.c)) setSel(DRAG.t, SEL.anchor, {r:it.b.r, c:it.b.c});
  });
  slide.addEventListener("pointerleave", () => slide.querySelectorAll(".hov").forEach(x => x.style.display = "none"));
  slide.addEventListener("dblclick", e => { if(e.target.closest(".hits")) openInline(); });
  slide.querySelectorAll(".hbox").forEach(hb => wireTableHandles(slide, R, hb));
  slide.querySelectorAll("[data-edit]").forEach(el => el.addEventListener("dblclick", () => editSlideText(R, el)));
}
document.addEventListener("pointerup", () => { DRAG = null; });
function slideScale(){ return $("stage").querySelector(".stagewrap")?._scale || 1; }
function wireTableHandles(slide, S, hb){
  const R = S;
  const i = +hb.dataset.i, mark = slide.querySelector(".dropmark");
  hb.querySelector(".size").addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    const sc = slideScale(), sx = e.clientX, sy = e.clientY, before = snap();
    const start = computeLayout(S).boxes[i], w0 = layoutOf(S).w.slice(), T = S.tables[i];
    const lay = {bands: JSON.parse(JSON.stringify(layoutOf(S).bands)), w: w0.slice()};
    hb.setPointerCapture(e.pointerId); hb.classList.add("active");
    const move = ev => {
      const target = Math.max(30, Math.max(start.w + (ev.clientX-sx)/sc, (start.h + (ev.clientY-sy)/sc) * tableW(T) / T.H));
      let lo = 0.05, hi = 30;
      for(let n=0;n<36;n++){ const mid=(lo+hi)/2; const ww=w0.slice(); ww[i]=mid; if(computeLayout(S, ww).boxes[i].w < target) lo = mid; else hi = mid; }
      lay.w = w0.slice(); lay.w[i] = Math.round(lo*1000)/1000;
      R.cfg.layout = lay; applyLayout(slide, R); paintSel();
    };
    const up = () => { hb.removeEventListener("pointermove", move); hb.removeEventListener("pointerup", up); hb.classList.remove("active"); commit(before, "Resize table"); };
    hb.addEventListener("pointermove", move); hb.addEventListener("pointerup", up);
  });
  hb.querySelector(".grip").addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    const sc = slideScale(), rect = slide.getBoundingClientRect(), before = snap();
    hb.setPointerCapture(e.pointerId); hb.classList.add("active");
    let drop = null;
    const move = ev => {
      const px = (ev.clientX - rect.left)/sc, py = (ev.clientY - rect.top)/sc, boxes = computeLayout(S).boxes;
      drop = null; let best = Infinity;
      for(const b of boxes){ if(!b || b.i===i) continue;
        const cx = Math.max(b.x, Math.min(px, b.x+b.w)), cy = Math.max(b.y, Math.min(py, b.y+b.h)), dist = Math.hypot(px-cx, py-cy);
        if(dist < best){ best = dist; const rx = (px-b.x)/b.w-.5, ry = (py-b.y)/b.h-.5; drop = {t:b.i, b, zone: Math.abs(rx)>Math.abs(ry) ? (rx<0?"left":"right") : (ry<0?"top":"bottom")}; } }
      if(drop && best < 240){
        const b = drop.b, st = mark.style; mark.style.display = "block";
        if(drop.zone==="left"||drop.zone==="right") Object.assign(st,{left:(drop.zone==="left"?b.x-GX/2-3:b.x+b.w+GX/2-3)+"px", top:b.y+"px", width:"6px", height:b.h+"px"});
        else { const bb = boxes.filter(x=>x && x.band===b.band), l = Math.min(...bb.map(x=>x.x)), r = Math.max(...bb.map(x=>x.x+x.w)); const t = drop.zone==="top" ? Math.min(...bb.map(x=>x.y))-GY/2-3 : Math.max(...bb.map(x=>x.y+x.h))+GY/2-3; Object.assign(st,{left:l+"px", top:t+"px", width:(r-l)+"px", height:"6px"}); }
      } else { drop = null; mark.style.display = "none"; }
    };
    const up = () => {
      hb.removeEventListener("pointermove", move); hb.removeEventListener("pointerup", up); hb.classList.remove("active"); mark.style.display = "none";
      if(!drop) return;
      const lay = JSON.parse(JSON.stringify(layoutOf(S)));
      let bands = lay.bands.map(b=>b.filter(x=>x!==i)); const bi = bands.findIndex(b=>b.includes(drop.t));
      if(drop.zone==="left"||drop.zone==="right"){ const p = bands[bi].indexOf(drop.t); bands[bi].splice(drop.zone==="left"?p:p+1, 0, i); }
      else bands.splice(drop.zone==="top"?bi:bi+1, 0, [i]);
      lay.bands = bands.filter(b=>b.length); R.cfg.layout = lay;
      commit(before, "Move table");
    };
    hb.addEventListener("pointermove", move); hb.addEventListener("pointerup", up);
  });
}

/* ---- cell edits */
const keyOf = it => A1(it.b.src.r, it.b.src.c);
function cellEdit(it, create){ const c = sheetCfg(it.L.sheet, create).cells; const k = keyOf(it); if(!c[k] && create) c[k] = {}; return c[k] || {}; }
function effText(it){ const e = sheetCfg(it.L.sheet).cells[keyOf(it)]; return e && e.text!==undefined && e.orig===it.text ? e.text : it.text; }
function effFmt(it){
  const e = sheetCfg(it.L.sheet).cells[keyOf(it)] || {};
  return {sz: e.sz || it.font.sz || 11, b: e.b!==undefined ? e.b : !!it.font.b, i: e.i!==undefined ? e.i : !!it.font.i,
          color: e.color || null, fill: e.fill || null, align: e.align || null, role: e.role || "auto"};
}
function applySel(label, fn){ const its = selItems(); if(!its.length) return; mutate(label, () => its.forEach(it => fn(cellEdit(it, true), it))); }
function setTextFor(it, val){
  const e = cellEdit(it, true);
  if(val===it.text){ delete e.text; delete e.orig; } else { e.orig = it.text; e.text = val; }
}
function commitText(val, move){
  const it = activeItem(); if(!it) return;
  mutate("Edit text", () => setTextFor(it, val));
  if(move) moveSel(move[0], move[1], false);
}
let INLINE = null;
function openInline(initial){
  const it = activeItem(); if(!it || INLINE) return;
  const S = DOC.slides[CUR], wrap = $("stage").querySelector(".stagewrap");
  const hits = wrap.querySelector(`.hits[data-t="${SEL.t}"]`); if(!hits) return;
  const T = S.tables[SEL.t], g = cellBox(it), rc = hits.getBoundingClientRect(), k = rc.width / tableW(T);
  const wr = wrap.getBoundingClientRect(), hr = {left: rc.left + g.bx*k, top: rc.top + g.by*k, width: g.bw*k, height: g.bh*k};
  const inp = document.createElement("input"); inp.className = "inline-edit";
  inp.value = initial!==undefined ? initial : effText(it);
  const fpx = (effFmt(it).sz*96/72) * computeLayout(S).boxes[SEL.t].scale * wrap._scale;
  Object.assign(inp.style, {left:(hr.left-wr.left-2)+"px", top:(hr.top-wr.top-2)+"px", width:Math.max(120,hr.width+4)+"px", height:Math.max(26,hr.height+4)+"px", fontSize:Math.max(12,fpx)+"px", textAlign: it.align==="right"?"right":it.align==="center"?"center":"left"});
  wrap.appendChild(inp); inp.focus(); if(initial===undefined) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
  INLINE = inp;
  let done = false;
  const finish = (ok, move) => { if(done) return; done = true; INLINE = null; const v = inp.value; inp.remove(); if(ok) commitText(v, move); };
  inp.addEventListener("keydown", e => {
    e.stopPropagation();
    if(e.key==="Enter"){ e.preventDefault(); finish(true, [e.shiftKey?-1:1, 0]); }
    else if(e.key==="Tab"){ e.preventDefault(); finish(true, [0, e.shiftKey?-1:1]); }
    else if(e.key==="Escape"){ finish(false); }
  });
  inp.addEventListener("blur", () => finish(true));
}

/* ---- ribbon */
const FILLS = [["#34C759","Green (positive)"],["#FF3B30","Red (negative)"],["#FF9500","Orange"],["#FFCC00","Yellow"],["#007AFF","Blue"],["#5856D6","Indigo"],
               ["#AF52DE","Purple"],["#30B0C7","Teal"],["#8E8E93","Grey"],["#D1D1D6","Light grey"],["#0B4F97","Navy"],["#FFFFFF","White"]];
const INKS = [["#0B0D17","Black"],["#5B6274","Dark grey"],["#8E8E93","Grey"],["#A8101A","Red"],["#136B2E","Green"],["#0A58CA","Blue"],
              ["#B25000","Orange"],["#6B2FB3","Purple"],["#FFFFFF","White"],["#1C4F8C","Navy"],["#C42B1C","Bright red"],["#1F9D55","Bright green"]];
function buildSwatches(){
  $("fillMenu").innerHTML = `<div class="hd">Fill / highlight</div><div class="swatches">${FILLS.map(([c,n])=>`<button title="${n}" data-v="${c}" style="background:${c}"></button>`).join("")}</div><div class="wide"><button data-v="none">No fill</button><button data-v="">Automatic (Excel)</button></div>`;
  $("inkMenu").innerHTML = `<div class="hd">Text colour</div><div class="swatches">${INKS.map(([c,n])=>`<button title="${n}" data-v="${c}" style="background:${c}"></button>`).join("")}</div><div class="wide"><button data-v="">Automatic</button></div>`;
  $("fillMenu").querySelectorAll("[data-v]").forEach(b => b.onclick = () => { closeMenus(); const v = b.dataset.v; applySel(v ? "Fill colour" : "Automatic fill", e => { if(v) e.fill = v; else delete e.fill; }); });
  $("inkMenu").querySelectorAll("[data-v]").forEach(b => b.onclick = () => { closeMenus(); const v = b.dataset.v; applySel(v ? "Text colour" : "Automatic text colour", e => { if(v) e.color = v; else delete e.color; }); });
}
function updateRibbon(){
  const S = DOC.slides[CUR], it = activeItem(), its = selItems(), has = !!(S && it);
  document.querySelectorAll("[data-needsel]").forEach(el => el.disabled = !has);
  $("undoBtn").disabled = !UNDO.length; $("redoBtn").disabled = !REDO.length;
  $("resetLayout").disabled = !(S && S.cfg && S.cfg.layout);
  $("logoToggle").disabled = !S || !(SETTINGS.app.logo||"").trim();
  $("logoToggle").classList.toggle("on", !!S && slideHasLogo(S));
  $("logoToggle").title = S && !slideHasLogo(S) ? "The logo is hidden on this slide – click to show it" : "Hide the logo on this slide";
  if(!has){
    $("nameBox").textContent = S ? "—" : ""; $("fxInput").value = ""; $("fxInput").placeholder = S ? "Click a cell to select it · double-click or type to edit" : "Open a workbook to start";
    $("sizeBox").value = ""; ["boldBtn","italBtn"].forEach(id=>$(id).classList.remove("on"));
    document.querySelectorAll("[data-role],[data-align]").forEach(b => b.classList.remove("on"));
    $("sbSel").textContent = S ? `Slide ${CUR+1} of ${DOC.slides.length}` : ""; return;
  }
  const f = effFmt(it);
  $("nameBox").textContent = it.L.sheet.name + "!" + (its.length>1 ? `${A1(SEL.r1,SEL.c1)}:${A1(SEL.r2,SEL.c2)}` : keyOf(it));
  if(document.activeElement!==$("fxInput")){ $("fxInput").value = effText(it); $("fxInput").placeholder = it.text ? "" : "(empty cell)"; }
  const sizes = new Set(its.map(x => effFmt(x).sz)); $("sizeBox").value = sizes.size===1 ? f.sz : "";
  $("boldBtn").classList.toggle("on", its.every(x => effFmt(x).b)); $("italBtn").classList.toggle("on", its.every(x => effFmt(x).i));
  const roles = new Set(its.map(x => effFmt(x).role)); document.querySelectorAll("[data-role]").forEach(b => b.classList.toggle("on", roles.size===1 && roles.has(b.dataset.role)));
  const al = new Set(its.map(x => effFmt(x).align || "auto")); document.querySelectorAll("[data-align]").forEach(b => b.classList.toggle("on", al.size===1 && al.has(b.dataset.align)));
  $("fillSw").style.background = f.fill && f.fill!=="none" ? f.fill : "linear-gradient(90deg,#34C759 50%,#FF3B30 50%)";
  $("inkSw").style.background = f.color || "#0B0D17";
  const e = sheetCfg(it.L.sheet).cells[keyOf(it)] || {};
  $("sbSel").textContent = `${its.length} cell${its.length>1?"s":""} selected` + (e.text!==undefined && e.orig!==it.text ? " · text edit paused (Excel value changed)" : e.text!==undefined ? ` · Excel value: “${it.text}”` : "");
}
function wireRibbon(){
  buildSwatches();
  const dd = (btn, menu) => $(btn).addEventListener("click", e => { e.stopPropagation(); const m = $(menu); const open = !m.classList.contains("open"); closeMenus(); m.classList.toggle("open", open); });
  dd("fillBtn","fillMenu"); dd("inkBtn","inkMenu"); dd("exportMenuBtn","exportMenu"); dd("openBtn","openMenu"); dd("optBtn","optMenu");
  const setSize = f => applySel("Text size", (e, it) => { const cur = e.sz || it.font.sz || 11; const v = f(cur); if(v===null) delete e.sz; else e.sz = Math.max(5, Math.min(96, Math.round(v*2)/2)); });
  $("sizeDown").onclick = () => setSize(v => v>12 ? v-2 : v-1);
  $("sizeUp").onclick = () => setSize(v => v>=12 ? v+2 : v+1);
  $("sizeBox").addEventListener("keydown", e => { if(e.key==="Enter"){ const v = parseFloat($("sizeBox").value.replace(",",".")); if(!isNaN(v)) setSize(() => v); $("sizeBox").blur(); } e.stopPropagation(); });
  $("sizeBox").addEventListener("change", () => { const v = parseFloat($("sizeBox").value.replace(",",".")); if(!isNaN(v)) setSize(() => v); });
  $("boldBtn").onclick = () => { const on = !$("boldBtn").classList.contains("on"); applySel("Bold", e => { e.b = on; }); };
  $("italBtn").onclick = () => { const on = !$("italBtn").classList.contains("on"); applySel("Italic", e => { e.i = on; }); };
  document.querySelectorAll("[data-align]").forEach(b => b.onclick = () => applySel("Alignment", e => { if(b.dataset.align==="auto") delete e.align; else e.align = b.dataset.align; }));
  document.querySelectorAll("[data-role]").forEach(b => b.onclick = () => applySel("Role: " + b.textContent, e => { if(b.dataset.role==="auto") delete e.role; else e.role = b.dataset.role; }));
  $("clearFmt").onclick = () => applySel("Clear formatting", e => { ["sz","b","i","color","fill","align","role"].forEach(k => delete e[k]); });
  $("resetText").onclick = () => applySel("Restore Excel text", e => { delete e.text; delete e.orig; });
  $("undoBtn").onclick = () => undo(false); $("redoBtn").onclick = () => undo(true);
  $("resetLayout").onclick = () => mutate("Reset layout", R => { R.cfg.layout = null; R._auto = null; });
  $("logoToggle").onclick = () => { const R = DOC.slides[CUR]; if(!R) return; const show = !slideHasLogo(R);
    mutate(show ? "Show logo" : "Hide logo", X => { if(show) delete X.cfg.logo; else X.cfg.logo = false; }, true); };
  $("fxInput").addEventListener("keydown", e => {
    e.stopPropagation();
    if(e.key==="Enter"){ e.preventDefault(); commitText($("fxInput").value, [1,0]); $("fxInput").blur(); }
    if(e.key==="Escape"){ updateRibbon(); $("fxInput").blur(); }
  });
  document.querySelectorAll("[data-design]").forEach(b => b.onclick = () => { SETTINGS.app.design = b.dataset.design; paintDesign(); scheduleSave(); renderAll(); });
  document.querySelectorAll("[data-glass]").forEach(b => b.onclick = () => { SETTINGS.app.glass = b.dataset.glass; makeWall(); paintDesign(); scheduleSave(); renderAll(); });
  $("zoomIn").onclick = () => { ZOOM = Math.min(3, (ZOOM==="fit" ? slideScale() : ZOOM) * 1.25); fitStage(); paintSel(); };
  $("zoomOut").onclick = () => { ZOOM = Math.max(.2, (ZOOM==="fit" ? slideScale() : ZOOM) / 1.25); fitStage(); paintSel(); };
  $("zoomFit").onclick = () => { ZOOM = "fit"; fitStage(); paintSel(); };
}
function paintPn(){
  const p = pnCfg();
  $("pnBox").classList.toggle("off", !p.on);
  document.querySelectorAll("#pnPos [data-pos]").forEach(b => b.classList.toggle("on", b.dataset.pos===p.pos));
  document.querySelectorAll("#pnStyle [data-style]").forEach(b => b.classList.toggle("on", b.dataset.style===(p.style||"capsule")));
  $("pnSizeVal").textContent = p.size + " px";
}
function refreshGlassBase(){ document.querySelectorAll(".slide.glass").forEach(s => s.style.setProperty("--amt", (+SETTINGS.app.color||0)/100)); }
let thumbsAllTimer = null;
function renderThumbsSoon(){ clearTimeout(thumbsAllTimer); thumbsAllTimer = setTimeout(() => renderThumbs(), 250); }
function paintDesign(){
  document.querySelectorAll("[data-design]").forEach(b => b.classList.toggle("on", b.dataset.design===design()));
  const lvl = GLASS_LEVELS[SETTINGS.app.glass] ? SETTINGS.app.glass : "subtle";
  document.querySelectorAll("[data-glass]").forEach(b => b.classList.toggle("on", b.dataset.glass===lvl));
  $("glassSeg").style.display = design()==="glass" ? "" : "none";
  $("colorCtl").style.display = design()==="glass" ? "" : "none";
}
/* titles and subtitles: double-click on the slide to edit (stored in the preset) */
function editSlideText(R, el){
  const key = el.dataset.edit, wrap = $("stage").querySelector(".stagewrap"); if(!wrap) return;
  const wr = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
  const inp = document.createElement("input"); inp.className = "inline-edit";
  inp.value = key==="title" ? R.title : (R.subtitle || "");
  Object.assign(inp.style, {left:(r.left-wr.left-4)+"px", top:(r.top-wr.top-4)+"px", width:Math.max(320, r.width+40)+"px", height:(r.height+8)+"px", fontSize:Math.max(14, r.height*0.62)+"px", fontWeight:key==="title"?"700":"500"});
  wrap.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => { if(done) return; done = true; const v = inp.value.trim(); inp.remove();
    if(!ok) return;
    const before = snap(); R.cfg[key] = v || null; rebuildSlides(); commit(before, key==="title" ? "Edit title" : "Edit subtitle", true); paintFileName(); };
  inp.addEventListener("keydown", e => { e.stopPropagation(); if(e.key==="Enter") finish(true); if(e.key==="Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
}

/* ---- keyboard (Excel-like) */
document.addEventListener("keydown", e => {
  if(RENDER) return;
  const inField = e.target.matches("input,select,textarea");
  const mod = e.ctrlKey || e.metaKey;
  if(mod && e.key.toLowerCase()==="z" && !inField){ e.preventDefault(); undo(e.shiftKey); return; }
  if(mod && e.key.toLowerCase()==="y" && !inField){ e.preventDefault(); undo(true); return; }
  if(mod && e.key.toLowerCase()==="s"){ e.preventDefault(); flushSave(); return; }
  if(inField || !DOC.slides.length) return;
  if(e.key==="PageDown" || (e.key==="ArrowDown" && e.altKey)){ e.preventDefault(); gotoSlide(CUR+1); return; }
  if(e.key==="PageUp" || (e.key==="ArrowUp" && e.altKey)){ e.preventDefault(); gotoSlide(CUR-1); return; }
  if(!SEL) return;
  if(mod && e.key.toLowerCase()==="b"){ e.preventDefault(); $("boldBtn").click(); return; }
  if(mod && e.key.toLowerCase()==="i"){ e.preventDefault(); $("italBtn").click(); return; }
  if(mod && e.key.toLowerCase()==="a"){ e.preventDefault(); const T = DOC.slides[CUR].tables[SEL.t]; setSel(SEL.t, {r:T.rows[0], c:T.cols[0]}, {r:T.rows[T.rows.length-1], c:T.cols[T.cols.length-1]}); return; }
  const arrows = {ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1]};
  if(arrows[e.key]){ e.preventDefault(); moveSel(...arrows[e.key], e.shiftKey); return; }
  if(e.key==="Tab"){ e.preventDefault(); moveSel(0, e.shiftKey?-1:1, false); return; }
  if(e.key==="Enter"){ e.preventDefault(); moveSel(e.shiftKey?-1:1, 0, false); return; }
  if(e.key==="F2"){ e.preventDefault(); openInline(); return; }
  if(e.key==="Escape"){ SEL = null; paintSel(); updateRibbon(); return; }
  if(e.key==="Delete" || e.key==="Backspace"){ e.preventDefault(); applySel("Clear text", (ed, it) => { if(it.text===""){ delete ed.text; delete ed.orig; } else { ed.orig = it.text; ed.text = ""; } }); return; }
  if(e.key.length===1 && !mod && !e.altKey){ e.preventDefault(); openInline(e.key); }
});
function gotoSlide(i){
  if(i<0 || i>=DOC.slides.length || i===CUR) return;
  CUR = i; SEL = null; document.querySelectorAll(".thumb").forEach(t => t.classList.toggle("on", +t.dataset.i===i));
  document.querySelector(`.thumb[data-i="${i}"]`)?.scrollIntoView({block:"nearest"});
  renderStage(); renderIssues(); updateRibbon();
}

/* ---- open menu */
async function fillOpenMenu(){
  const m = $("openMenu"); const files = await listFiles();
  m.innerHTML = (SERVED ? `<div class="hd">Workbooks in the folder</div>` + (files.length ? files.map(f => `<button data-f="${esc(f.name)}">${esc(f.name)}<small>${new Date(f.mtime*1000).toLocaleString([], {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</small></button>`).join("") : `<div class="empty">No .xlsx files next to the app</div>`) + `<div class="sep"></div>` : "") +
    `<button data-browse>Browse for a workbook…</button>` + (DOC.src==="folder" ? `<button data-reload>Reload “${esc(DOC.name)}” from disk<small>after saving in Excel</small></button>` : "");
  m.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { closeMenus(); guard(() => openFromFolder(b.dataset.f)); });
  m.querySelector("[data-browse]").onclick = () => { closeMenus(); $("fileInput").click(); };
  const rl = m.querySelector("[data-reload]"); if(rl) rl.onclick = () => { closeMenus(); guard(reloadWorkbook); };
}
async function guard(fn){ try{ await fn(); }catch(e){ console.error(e); toast("⚠ " + esc(e.message || e), [], true); if(DOC.name) paintFileName(); else $("fileName").innerHTML = "No workbook"; } }

/* ---- export */
async function doExport(kind){
  closeMenus();
  if(!DOC.slides.length) return;
  if(!(SERVED && SERVER.ok)){ toast("Exports run through the helper: start slide_builder.py and open the app from there.", [], true); return; }
  if(DOC.src==="local"){ toast("This workbook was opened without the helper. Open it again from the Open menu.", [], true); return; }
  if(BUSY) return; BUSY = true;
  const btn = $("exportBtn"), label = btn.innerHTML; btn.disabled = true; $("exportMenuBtn").disabled = true;
  btn.innerHTML = `<span class="spin"></span>Rendering…`;
  await flushSave();
  const base = {src: DOC.src, name: DOC.name, id: DOC.id, scale: SETTINGS.app.scale || 3};
  const req = kind==="pdf" ? Object.assign(base, {format:"pdf", mode: SETTINGS.app.pdfMode})
            : kind==="pdf-exact" ? Object.assign(base, {format:"pdf", mode:"exact"})
            : kind==="pdf-vector" ? Object.assign(base, {format:"pdf", mode:"vector"})
            : kind==="pdf-current" ? Object.assign(base, {format:"pdf", mode:"exact", slides:[CUR]})
            : kind==="png-current" ? Object.assign(base, {format:"png", slides:[CUR]})
            : kind==="png-all" ? Object.assign(base, {format:"png"})
            : kind==="copy" ? Object.assign(base, {format:"png", slides:[CUR], inline:true}) : null;
  if(kind==="pdf-exact" || kind==="pdf-vector"){ SETTINGS.app.pdfMode = req.mode; scheduleSave(); paintExportLabel(); }
  try{
    let j, why = "", fallback = false;
    const idx = req.slides || DOC.slides.map((S,i)=>i);
    const usable = SERVER.engine && SERVER.engine.state === "ready";      // while engines are still being tested, don't wait: render here
    if(usable){
      const payload = Object.assign({}, req, await exportPayload(idx), {all: !req.slides});
      try{
        const r = await fetch("/api/export", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload)});
        j = await r.json();
        if(!r.ok || !j.ok){ why = j.error || "export failed"; if(r.status===503 || /export engine|browser|DevTools|headless|Edge|Chrome|timed out|connect/i.test(why)) fallback = true; else throw new Error(why); }
      }catch(e){ if(e instanceof TypeError){ why = String(e.message||e); fallback = true; } else throw e; }   // network error: the helper is busy or was restarted
    } else fallback = true;
    if(fallback){
      if(req.mode==="vector") req.mode = "exact";
      j = await exportInWindow(req); j.note = " · rendered in the app window"; j.offerInstall = !(SERVER.engine && SERVER.engine.state === "starting");
      if(why) console.warn(why);
    }
    if(j.downloaded){ toast("PNG downloaded (rendered in this window)."); return; }
    if(kind==="copy"){
      const blob = await (await fetch(j.images[0])).blob();
      await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
      toast("Slide copied as a high-resolution image: paste it into PowerPoint.");
    } else {
      const f = j.files[0];
      const acts = [{label:"Open", fn: () => fetch("/api/open", {method:"POST", body: JSON.stringify({name:f})})}, {label:"Show folder", fn: () => fetch("/api/open", {method:"POST", body: JSON.stringify({folder:true})})}];
      if(j.offerInstall) acts.push({label:"Install export engine", fn: openInstaller});
      toast(`Saved <b>${esc(j.files.join(", "))}</b> in the export folder` + (j.seconds?` · ${j.seconds}s`:"") + (j.engine?` · ${esc(j.engine)}`:"") + (j.note||""), acts);
    }
  }catch(e){ console.error(e); toast("⚠ Export failed: " + esc(e.message||e), [], true); }
  finally{ BUSY = false; btn.innerHTML = label; pollHealth(); }
}
/* ---- export payload: the exact slide DOM + slide CSS, self-contained (images and logo as data URLs) */
async function exportPayload(idx){
  const css = [$("slidecss").textContent, ($("wallcss")||{}).textContent || ""].join("\n");
  const slides = [];
  for(const i of idx){
    const s = buildSlide(DOC.slides[i], i);
    s.querySelectorAll(".pic.missing").forEach(e => e.remove());
    for(const img of s.querySelectorAll("img.logo")){ try{ img.setAttribute("src", await toDataUrl(img.src)); }catch(e){ img.parentNode.remove(); } }
    slides.push(s.outerHTML);
  }
  return {css, slides, names: idx.map(i => DOC.slides[i].label)};
}
/* ---- export engine installer, run by the helper (downloads Chrome for Testing into the engine folder) */
async function openInstaller(){
  closeMenus();
  const e = SERVER.engine || {};
  const dlg = document.createElement("div"); dlg.className = "modal";
  const rows = (e.engines||[]).map(x => `<li><b>${esc(x.label)}</b> – ${x.state==="ok" ? "works" : x.state==="blocked" ? "blocked: " + esc(x.detail) : x.state==="missing" ? "not installed" : "not tested yet"}</li>`).join("");
  dlg.innerHTML = `<div class="dlg" style="width:min(720px,94vw)">
    <div class="dlghd"><b>Export engine</b><span>${e.state==="ready" ? "Working: " + esc(e.browser||"") : "No engine works yet – exports are rendered in the app window"}</span></div>
    <div style="padding:0 18px 8px;font-size:12.5px;line-height:1.5"><ul style="margin:4px 0 8px;padding-left:18px">${rows}</ul>
      Installing downloads <b>Chrome for Testing</b> (about 100 MB) into the <b>engine</b> folder. It is not affected by the company settings that lock Edge, and makes exports exact and fast.</div>
    <pre class="instlog" id="instLog" style="display:none"></pre>
    <div class="dlgft"><span class="hint" id="instHint"></span><button class="btn" data-a="close">Close</button><button class="btn primary" data-a="go">Install export engine</button></div></div>`;
  document.body.appendChild(dlg);
  const log = dlg.querySelector("#instLog"), go = dlg.querySelector('[data-a="go"]'), hint = dlg.querySelector("#instHint");
  let timer = null;
  const close = () => { clearInterval(timer); dlg.remove(); };
  dlg.querySelector('[data-a="close"]').onclick = close;
  const poll = async () => {
    const st = await (await fetch("/api/engine/install", {cache:"no-store"})).json();
    log.style.display = "block"; log.textContent = st.lines.join("\n"); log.scrollTop = log.scrollHeight;
    if(st.done){ clearInterval(timer); go.disabled = false; go.textContent = "Run again";
      hint.innerHTML = st.ok ? `<span style="color:var(--ok)">Installed – testing the engine…</span>` : `<span style="color:var(--err)">The installer could not finish – see the messages above.</span>`;
      setTimeout(pollHealth, 2500); setTimeout(pollHealth, 8000); }
  };
  go.onclick = async () => { go.disabled = true; go.textContent = "Installing…"; hint.textContent = "This can take a few minutes."; await fetch("/api/engine/install", {method:"POST"}); timer = setInterval(poll, 1000); poll(); };
}

/* ---- fallback when Edge/Chrome cannot be driven (e.g. blocked by policy): render in this window */
async function toDataUrl(url){ const b = await (await fetch(url)).blob(); return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
async function clientRender(i, scale, type){
  const S = DOC.slides[i], slide = buildSlide(S, i);
  slide.querySelectorAll(".pic.missing").forEach(e => e.remove());
  for(const img of slide.querySelectorAll("img.logo")){ try{ img.src = await toDataUrl(img.src); }catch(e){ img.parentNode.remove(); } }
  const css = [...document.querySelectorAll("style")].map(s => s.textContent).join("\n");
  const xml = new XMLSerializer().serializeToString(slide);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${1600*scale}" height="${900*scale}" viewBox="0 0 1600 900"><foreignObject x="0" y="0" width="1600" height="900"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${xml}</div></foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("render failed")); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  const c = document.createElement("canvas"); c.width = 1600*scale; c.height = 900*scale;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0,0,c.width,c.height); x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, .95);
}
async function exportInWindow(req){
  const idx = req.slides || DOC.slides.map((S,i)=>i), scale = 3;
  if(req.format==="pdf"){
    const images = []; for(const i of idx) images.push(await clientRender(i, scale, "image/jpeg"));
    const r = await fetch("/api/assemble", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({name: DOC.name, images})});
    const j = await r.json(); if(!r.ok) throw new Error(j.error || "could not write the PDF"); return j;
  }
  const png = await clientRender(idx[0], scale, "image/png");
  if(req.inline) return {ok:true, images:[png]};
  const a = document.createElement("a"); a.href = png; a.download = DOC.name.replace(/\.[^.]+$/,"") + " - " + DOC.slides[idx[0]].label + ".png"; a.click();
  return {ok:true, files:[], downloaded:true};
}
function paintExportLabel(){ $("exportBtn").innerHTML = `Export PDF`; $("exportMenu").querySelectorAll("[data-x]").forEach(b => b.classList.toggle("cur", b.dataset.x==="pdf-"+SETTINGS.app.pdfMode)); }

/* ---- preferences */
function wirePrefs(){
  $("logoInput").value = SETTINGS.app.logo || "";
  // background colour amount (glass design): live preview, the wallpaper image is cached per value
  const cr = $("colorRange"); cr.value = SETTINGS.app.color ?? 35; $("colorVal").textContent = cr.value + "%";
  let ct = null;
  cr.addEventListener("input", () => { $("colorVal").textContent = cr.value + "%"; clearTimeout(ct); ct = setTimeout(() => { SETTINGS.app.color = +cr.value; makeWall(); refreshGlassBase(); scheduleSave(); }, 60); });
  // page numbers
  const p = pnCfg(), redraw = () => { scheduleSave(); paintPn(); renderStage(); renderThumbsSoon(); };
  $("pnOn").checked = !!p.on; $("pnStart").value = p.start; $("pnFont").value = p.font; $("pnSize").value = p.size; $("pnFormat").value = p.format; $("pnCover").checked = !!p.cover;
  $("pnOn").onchange = () => { pnCfg().on = $("pnOn").checked; redraw(); };
  $("pnStart").onchange = () => { const v = parseInt($("pnStart").value, 10); pnCfg().start = isFinite(v) ? v : 1; redraw(); };
  $("pnFont").onchange = () => { pnCfg().font = $("pnFont").value; redraw(); };
  $("pnFormat").onchange = () => { pnCfg().format = $("pnFormat").value; redraw(); };
  $("pnCover").onchange = () => { pnCfg().cover = $("pnCover").checked; redraw(); };
  $("pnSize").oninput = () => { pnCfg().size = +$("pnSize").value; $("pnSizeVal").textContent = $("pnSize").value + " px"; clearTimeout(ct); ct = setTimeout(redraw, 120); };
  document.querySelectorAll("#pnPos [data-pos]").forEach(b => b.onclick = () => { pnCfg().pos = b.dataset.pos; redraw(); });
  document.querySelectorAll("#pnStyle [data-style]").forEach(b => b.onclick = () => { pnCfg().style = b.dataset.style; redraw(); });
  ["pnStart"].forEach(id => $(id).addEventListener("keydown", e => e.stopPropagation()));
  paintPn();
  $("logoInput").addEventListener("change", () => { SETTINGS.app.logo = $("logoInput").value.trim(); LOGO_MISSING = false; scheduleSave(); renderAll(); });

  ["logoInput"].forEach(id => $(id).addEventListener("keydown", e => { e.stopPropagation(); if(e.key==="Enter") $(id).blur(); }));
}

/* ---- boot */
async function boot(){
  await pollHealth();
  await loadSettings();
  makeWall(); paintDesign(); wireRibbon(); wirePrefs(); paintExportLabel(); paintSave();
  $("exportBtn").onclick = () => doExport("pdf");
  $("srv").style.cursor = "pointer";
  $("srv").onclick = async () => {
    if(!(SERVED && SERVER.ok)) return;
    const e = SERVER.engine || {};
    if(SERVER.needsInstall || !e.local) return openInstaller();
    await fetch("/api/engine/restart", {method:"POST"}); toast("Re-testing the export engines…"); setTimeout(pollHealth, 1500); setTimeout(pollHealth, 6000); };
  $("exportMenu").querySelectorAll("[data-x]").forEach(b => b.onclick = () => doExport(b.dataset.x));
  $("openBtn").addEventListener("click", fillOpenMenu);
  $("fileInput").addEventListener("change", e => { const f = e.target.files[0]; if(f) guard(() => openLocalFile(f)); e.target.value = ""; });
  $("emptyOpen").onclick = () => { if(SERVED){ fillOpenMenu(); $("openMenu").classList.add("open"); } else $("fileInput").click(); };
  $("reloadBtn").onclick = () => guard(reloadWorkbook);
  $("wizardBtn").onclick = () => guard(openWizard);
  document.addEventListener("dragover", e => { e.preventDefault(); document.body.classList.add("dragover"); });
  document.addEventListener("dragleave", e => { if(!e.relatedTarget) document.body.classList.remove("dragover"); });
  document.addEventListener("drop", e => { e.preventDefault(); document.body.classList.remove("dragover"); const f = e.dataTransfer?.files?.[0]; if(f) guard(() => openLocalFile(f)); });
  renderAll();
  if(SERVED){
    const files = await listFiles(); const last = SETTINGS.app.lastFile;
    if(last && files.some(f => f.name===last)) await guard(() => openFromFolder(last, false));
    setInterval(() => { pollHealth(); watchFile(); }, 4000);
  }
}
boot();

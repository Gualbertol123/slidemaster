const $ = id => document.getElementById(id);
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const parseXml = s => new DOMParser().parseFromString(s, "application/xml");
const kids = (el, n) => Array.from(el ? el.childNodes : []).filter(x => x.nodeType===1 && x.localName===n);
const kid = (el, n) => kids(el, n)[0] || null;
const all = (el, n) => el ? Array.from(el.getElementsByTagNameNS("*", n)) : [];
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const colToNum = s => { let n=0; for(const ch of s) n=n*26+ch.charCodeAt(0)-64; return n; };
const numToCol = n => { let s=""; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; };
const splitRef = ref => { const m=/^\$?([A-Z]+)\$?(\d+)$/.exec(ref); return m ? {c:colToNum(m[1]), r:+m[2]} : null; };
const parseRange = rg => { const [a,b]=rg.split(":"); const s=splitRef(a), e=splitRef(b||a); return {r1:s.r,c1:s.c,r2:e.r,c2:e.c}; };
const inRange = (g,r,c) => r>=g.r1 && r<=g.r2 && c>=g.c1 && c<=g.c2;
const A1 = (r,c) => numToCol(c)+r;
function resolvePath(base, target){ target = String(target||"").replace(/\\/g,"/"); if(/^[a-z]+:/i.test(target)) return target; if(target.startsWith("/")) return target.slice(1); const p=base.split("/"); p.pop(); for(const x of target.split("/")){ if(x==="..") p.pop(); else if(x!=="." && x!=="") p.push(x);} return p.join("/"); }
function relsPath(p){ const i=p.lastIndexOf("/"); return i<0 ? "_rels/"+p+".rels" : p.slice(0,i)+"/_rels/"+p.slice(i+1)+".rels"; }
/* zip lookups tolerate different letter case and %-encoded names (some tools write them that way) */
function zget(zip, path){
  if(!path) return null;
  let f = zip.file(path); if(f) return f;
  if(!zip.__idx){ const m = new Map(); zip.forEach((p, e) => { if(!e.dir) m.set(p.toLowerCase(), e); }); zip.__idx = m; }
  let dec = path; try{ dec = decodeURIComponent(path); }catch(e){}
  return zip.file(dec) || zip.__idx.get(dec.toLowerCase()) || zip.__idx.get(path.toLowerCase()) || null;
}
async function readRels(zip, part){ const f=zget(zip, relsPath(part)); const map={}; if(!f) return map; const x=parseXml(await f.async("string")); for(const r of all(x,"Relationship")) map[r.getAttribute("Id")]={target:resolvePath(part,r.getAttribute("Target")),type:r.getAttribute("Type")||"", external:r.getAttribute("TargetMode")==="External"}; return map; }
function wbError(code, msg){ const e = new Error(msg); e.code = code; return e; }

/* ===================== colours ===================== */
const INDEXED = ["000000","FFFFFF","FF0000","00FF00","0000FF","FFFF00","FF00FF","00FFFF","000000","FFFFFF","FF0000","00FF00","0000FF","FFFF00","FF00FF","00FFFF","800000","008000","000080","808000","800080","008080","C0C0C0","808080","9999FF","993366","FFFFCC","CCFFFF","660066","FF8080","0066CC","CCCCFF","000080","FF00FF","FFFF00","00FFFF","800080","800000","008080","0000FF","00CCFF","CCFFFF","CCFFCC","FFFF99","99CCFF","FF99CC","CC99FF","FFCC99","3366FF","33CCCC","99CC00","FFCC00","FF9900","FF6600","666699","969696","003366","339966","003300","333300","993300","993366","333399","333333"];
function hexToHsl(h){ let r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255; const mx=Math.max(r,g,b),mn=Math.min(r,g,b); let H=0,S=0,L=(mx+mn)/2; if(mx!==mn){ const d=mx-mn; S=L>.5?d/(2-mx-mn):d/(mx+mn); H = mx===r?((g-b)/d+(g<b?6:0)):mx===g?((b-r)/d+2):((r-g)/d+4); H/=6;} return [H,S,L]; }
function hslToHex(H,S,L){ const f=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; }; let r,g,b; if(S===0){r=g=b=L;} else { const q=L<.5?L*(1+S):L+S-L*S, p=2*L-q; r=f(p,q,H+1/3); g=f(p,q,H); b=f(p,q,H-1/3);} return [r,g,b].map(x=>Math.round(x*255).toString(16).padStart(2,"0")).join("").toUpperCase(); }
function applyTint(hex, tint){ if(!tint) return hex; let [h,s,l]=hexToHsl(hex); l = tint<0 ? l*(1+tint) : l*(1-tint)+tint; return hslToHex(h,s,Math.max(0,Math.min(1,l))); }
function makeColor(theme){
  return function color(el, fallback){
    if(!el) return fallback;
    if(el.getAttribute("auto")==="1") return fallback;
    let hex = null;
    const rgb = el.getAttribute("rgb");
    if(rgb) hex = rgb.slice(-6).toUpperCase();
    else if(el.getAttribute("theme")!==null) hex = theme[+el.getAttribute("theme")] || null;
    else if(el.getAttribute("indexed")!==null){ const i=+el.getAttribute("indexed"); hex = i===64 ? null : INDEXED[i] || null; }
    if(!hex) return fallback;
    const tint = parseFloat(el.getAttribute("tint")||"0");
    return "#"+applyTint(hex, tint);
  };
}

/* ===================== number formats ===================== */
const BUILTIN = {0:"General",1:"0",2:"0.00",3:"#,##0",4:"#,##0.00",9:"0%",10:"0.00%",11:"0.00E+00",12:"# ?/?",13:"# ??/??",14:"dd/mm/yyyy",15:"d-mmm-yy",16:"d-mmm",17:"mmm-yy",18:"h:mm AM/PM",19:"h:mm:ss AM/PM",20:"h:mm",21:"h:mm:ss",22:"dd/mm/yyyy h:mm",37:"#,##0 ;(#,##0)",38:"#,##0 ;[Red](#,##0)",39:"#,##0.00;(#,##0.00)",40:"#,##0.00;[Red](#,##0.00)",45:"mm:ss",46:"[h]:mm:ss",47:"mmss.0",48:"##0.0E+0",49:"@"};
const NAMED = {black:"#000000",white:"#FFFFFF",red:"#FF0000",green:"#00FF00",blue:"#0000FF",yellow:"#FFFF00",magenta:"#FF00FF",cyan:"#00FFFF"};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const group = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
function isDateFmt(f){ if(!f) return false; const g=f.replace(/"[^"]*"/g,"").replace(/\[[^\]]*\]/g,"").replace(/\\./g,""); return /[dmyhs]/i.test(g) && !/[#0]/.test(g.replace(/\.0+/,"")); }
function sectionFor(f, v){
  const secs = f.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if(typeof v !== "number") return {sec: secs[3] || (secs.length===1 ? secs[0] : "@"), neg:false};
  if(v<0 && secs[1]!==undefined) return {sec:secs[1], neg:true};
  if(v===0 && secs[2]!==undefined) return {sec:secs[2], neg:false};
  return {sec:secs[0], neg:false, auto:v<0};
}
function fmtGeneral(v){
  if(Number.isInteger(v)) return String(v);
  let s = Math.abs(v) >= 1e11 || (Math.abs(v)<1e-9) ? v.toExponential(5) : String(parseFloat(v.toPrecision(10)));
  return s.replace(".", ",");
}
function formatValue(cell){
  const v = cell.v, f = cell.fmt || "General";
  if(cell.t==="e") return {text: v};
  if(cell.t==="b") return {text: v ? "TRUE" : "FALSE"};
  if(cell.t==="s"){
    const {sec} = sectionFor(f, v);
    if(sec && sec.includes("@")) return {text: sec.replace(/"([^"]*)"/g,"$1").replace(/@/g, v).replace(/[_\\*]./g,"")};
    return {text: String(v)};
  }
  if(cell.t!=="n" && cell.t!=="d") return {text:""};
  if(f==="General" || f==="@") return {text: fmtGeneral(v)};
  let {sec, neg, auto} = sectionFor(f, v);
  let color = null;
  sec = sec.replace(/\[(\w+)\]/g, (m, n) => { const k=n.toLowerCase(); if(NAMED[k]){ color=NAMED[k]; return ""; } return m; });
  sec = sec.replace(/\[Color\s*(\d+)\]/ig, (m,n)=>{ color="#"+(INDEXED[+n-1]||"000000"); return ""; });
  sec = sec.replace(/\[\$[^\]]*\]/g,"").replace(/\[[<>=][^\]]*\]/g,"");
  if(isDateFmt(sec)) return {text: fmtDate(v, sec), color};
  // literal pieces
  const lit = [];
  let pattern = sec.replace(/"([^"]*)"/g, (m,s)=>{ lit.push(s); return "\u0001"+(lit.length-1)+"\u0002"; })
                   .replace(/\\(.)/g, (m,s)=>{ lit.push(s); return "\u0001"+(lit.length-1)+"\u0002"; })
                   .replace(/_./g, " ").replace(/\*./g, "");
  const numPart = /[#0?,.]+(?:E[+-][0#]+)?/i.exec(pattern.replace(/\u0001\d+\u0002/g, m=>"\u0003".repeat(m.length)));
  let x = Math.abs(v);
  const pct = (pattern.match(/%/g)||[]).length; x *= Math.pow(100, pct);
  if(!numPart) return {text: pattern.replace(/\u0001(\d+)\u0002/g,(m,i)=>lit[i]), color};
  let np = numPart[0];
  // trailing commas scale by 1000
  let scale = 0; while(/[0#?],$/.test(np) || /,$/.test(np)){ np = np.slice(0,-1); scale++; }
  x /= Math.pow(1000, scale);
  const dm = /\.([0#?]*)/.exec(np); const dec = dm ? dm[1].length : 0; const req = dm ? (dm[1].match(/0/g)||[]).length : 0;
  let s = x.toFixed(dec); let [ip, dp] = s.split(".");
  if(dp){ dp = dp.replace(/0+$/,""); if(dp.length<req) dp = dp.padEnd(req,"0"); }
  const intDigits = np.split(".")[0];
  if(!/0/.test(intDigits) && ip==="0") ip = "";
  if(intDigits.includes(",")) ip = group(ip);
  let num = ip + (dp ? ","+dp : "");
  const isZero = !/[1-9]/.test(s);
  if(auto && !isZero) num = "-" + num;
  const out = pattern.slice(0, numPart.index) + num + pattern.slice(numPart.index + numPart[0].length);
  return {text: out.replace(/\u0001(\d+)\u0002/g,(m,i)=>lit[i]).replace(/\s+$/,"\u00a0"), color};
}
function fmtDate(n, f){
  const d = new Date(Math.round((n-25569)*86400000));
  const Y=d.getUTCFullYear(),M=d.getUTCMonth(),D=d.getUTCDate(),h=d.getUTCHours(),mi=d.getUTCMinutes(),se=d.getUTCSeconds();
  const p = x => String(x).padStart(2,"0");
  let hasH = /h/i.test(f);
  return f.replace(/"([^"]*)"/g,"$1").replace(/\\(.)/g,"$1").replace(/yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM/gi, t => {
    const l = t.toLowerCase();
    if(l==="yyyy") return Y; if(l==="yy") return String(Y).slice(2);
    if(l==="mmmmm") return MONTHS[M][0]; if(l==="mmmm") return MONTHS[M]; if(l==="mmm") return MONTHS[M].slice(0,3);
    if(l==="mm") return hasH ? p(mi) : p(M+1); if(l==="m") return hasH ? mi : M+1;
    if(l==="dddd") return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getUTCDay()];
    if(l==="ddd") return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()];
    if(l==="dd") return p(D); if(l==="d") return D;
    if(l==="hh") return p(h); if(l==="h") return h; if(l==="ss") return p(se); if(l==="s") return se;
    return h<12?"AM":"PM";
  });
}

/* ===================== workbook ===================== */
/* ===================== workbook: index first, read sheets on demand =====================
   Opening a file only reads its table of contents (sheet names and sizes). Sheets are parsed when
   they are needed (chosen in the wizard or used by a preset), with a fast streaming parser. */
const XENT = {lt:"<", gt:">", amp:"&", quot:'"', apos:"'"};
function xdec(s){
  if(s.indexOf("&")<0 && s.indexOf("_x")<0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0]==="#" ? String.fromCodePoint(e[1]==="x"||e[1]==="X" ? parseInt(e.slice(2),16) : +e.slice(1)) : (XENT[e] ?? m))
          .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h,16)));
}
function xattrs(s){ const o = {}; const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g; let m; while((m = re.exec(s))) o[m[1].replace(/^[A-Za-z0-9]+:(?=[A-Za-z])/,"")] = xdec(m[2]); return o; }
function parseSST(xml){
  const out = [], re = /<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\s*\/>/g; let m;
  while((m = re.exec(xml))){
    let inner = m[1] || "";
    if(inner.indexOf("rPh")>=0) inner = inner.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
    let txt = "", t; const tr = /<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g;
    while((t = tr.exec(inner))) txt += t[1];
    out.push(xdec(txt));
  }
  return out;
}
const entrySize = f => (f && f._data && f._data.uncompressedSize) || 0;
const fmtMB = b => b >= 1048576 ? (b/1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b/1024)) + " KB";
const BIG_BYTES = 12 * 1048576;                       // above this (uncompressed sheet XML) sheets are read on demand
const nextFrame = () => new Promise(r => setTimeout(r, 0));

async function indexWorkbook(buf){
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  if(head[0]===0xD0 && head[1]===0xCF && head[2]===0x11 && head[3]===0xE0)
    throw wbError("CFB", "This file is an old .xls workbook or is encrypted (password or sensitivity-label protection).");
  if(!(head[0]===0x50 && head[1]===0x4B)) throw wbError("NOTZIP", "This file is not an Excel workbook.");
  let zip;
  try{ zip = await JSZip.loadAsync(buf); }catch(e){ throw wbError("NOTZIP", "The workbook could not be unpacked (" + (e.message||e) + ")."); }
  let wbPath = null;
  try{
    const rr = zget(zip, "_rels/.rels");
    if(rr){ const x = parseXml(await rr.async("string")); const r = all(x,"Relationship").find(r => /\/officeDocument$/.test(r.getAttribute("Type")||"")); if(r) wbPath = resolvePath("", r.getAttribute("Target")); }
  }catch(e){}
  if(!wbPath || !zget(zip, wbPath)) wbPath = zget(zip, "xl/workbook.xml") ? "xl/workbook.xml" : wbPath;
  if((wbPath && /\.bin$/i.test(wbPath)) || (!zget(zip, wbPath) && zget(zip, "xl/workbook.bin")))
    throw wbError("XLSB", "This is an Excel Binary Workbook (.xlsb).");
  if(!wbPath || !zget(zip, wbPath)) throw wbError("NOTXLSX", "This file does not contain an Excel workbook.");
  const wbx = parseXml(await zget(zip, wbPath).async("string"));
  const wbRels = await readRels(zip, wbPath);
  const meta = [], skipped = [];
  for(const s of all(wbx,"sheet")){
    const name = s.getAttribute("name"), state = s.getAttribute("state") || "visible";
    const r = wbRels[s.getAttributeNS(NS_R,"id") || s.getAttribute("r:id") || ""];
    if(state!=="visible"){ skipped.push({name, why:"hidden"}); continue; }                 // hidden sheets stay hidden (never read)
    if(!r || !zget(zip, r.target)){ skipped.push({name, why:"missing"}); continue; }
    if(!/\/worksheet$/.test(r.type)){ skipped.push({name, why: /chartsheet/.test(r.type) ? "chart sheet" : "not a worksheet"}); continue; }
    const f = zget(zip, r.target);
    meta.push({name, path: f.name, size: entrySize(f)});
  }
  const rel = re => Object.values(wbRels).find(r => re.test(r.type));
  const ssRel = rel(/sharedStrings$/), ssSize = ssRel ? entrySize(zget(zip, ssRel.target)) : 0;
  const total = meta.reduce((s, m) => s + m.size, 0) + ssSize;
  const wb = {zip, wbRels, meta, skipped, hiddenSheets: skipped.filter(s=>s.why==="hidden").map(s=>s.name),
    extLinks: Object.values(wbRels).filter(r=>/externalLink/.test(r.type)).length,
    sheets: [], shared: null, total, ssSize, big: total > BIG_BYTES || buf.byteLength > 6*1048576};
  wb.isLoaded = n => wb.sheets.some(S => S.name===n);
  wb.ensure = (names, progress) => ensureSheets(wb, names, progress);
  return wb;
}
async function readWorkbook(buf){ const wb = await indexWorkbook(buf); await wb.ensure(wb.meta.map(m => m.name)); return wb; }

async function loadShared(wb, progress){
  if(wb.shared) return wb.shared;
  const zip = wb.zip, rel = re => Object.values(wb.wbRels).find(r => re.test(r.type));
  let theme = ["FFFFFF","000000","E7E6E6","44546A","4472C4","ED7D31","A5A5A5","FFC000","5B9BD5","70AD47","0563C1","954F72"];
  const th = rel(/\/theme$/);
  if(th && zget(zip, th.target)){
    const tx = parseXml(await zget(zip, th.target).async("string"));
    const cs = all(tx,"clrScheme")[0];
    if(cs){
      const get = n => { const e = kid(cs,n); if(!e) return null; const s = kid(e,"srgbClr"), y = kid(e,"sysClr"); return s ? s.getAttribute("val") : y ? (y.getAttribute("lastClr") || (y.getAttribute("val")==="window"?"FFFFFF":"000000")) : null; };
      theme = ["lt1","dk1","lt2","dk2","accent1","accent2","accent3","accent4","accent5","accent6","hlink","folHlink"].map((n,i)=>get(n)||theme[i]);
    }
  }
  const color = makeColor(theme);
  let sst = [];
  const ss = rel(/sharedStrings$/);
  if(ss && zget(zip, ss.target)){
    if(progress) progress("Reading the shared text table" + (wb.ssSize > 2*1048576 ? " (" + fmtMB(wb.ssSize) + ")" : "") + "…", null);
    await nextFrame();
    sst = parseSST(await zget(zip, ss.target).async("string"));
  }
  const numFmts = Object.assign({}, BUILTIN);
  let fonts=[], fills=[], borders=[], xfs=[], dxfs=[];
  const st = rel(/styles$/);
  if(st && zget(zip, st.target)){
    const sx = parseXml(await zget(zip, st.target).async("string"));
    for(const nf of all(sx,"numFmt")) numFmts[nf.getAttribute("numFmtId")] = nf.getAttribute("formatCode");
    const parseFont = f => f ? ({
      name: kid(f,"name")?.getAttribute("val"), sz: kid(f,"sz") ? +kid(f,"sz").getAttribute("val") : undefined,
      b: !!kid(f,"b") && kid(f,"b").getAttribute("val")!=="0", i: !!kid(f,"i") && kid(f,"i").getAttribute("val")!=="0",
      u: !!kid(f,"u") && kid(f,"u").getAttribute("val")!=="none", s: !!kid(f,"strike") && kid(f,"strike").getAttribute("val")!=="0",
      color: color(kid(f,"color"), null)
    }) : {};
    const parseFill = (f, isDxf) => {
      if(!f) return null;
      const pf = kid(f,"patternFill");
      if(pf){
        const pt = pf.getAttribute("patternType") || (isDxf ? "solid" : "none");
        if(pt==="none") return null;
        const fg = color(kid(pf,"fgColor"), null), bg = color(kid(pf,"bgColor"), null);
        if(isDxf) return bg || fg;
        if(pt==="solid") return fg || bg || null;
        if(pt==="gray125"||pt==="gray0625") return fg && fg!=="#000000" ? fg : null;
        return fg || null;
      }
      const gf = kid(f,"gradientFill");
      if(gf){ const stp = all(gf,"stop"); if(stp.length) return color(kid(stp[0],"color"), null); }
      return null;
    };
    const parseBorder = b => { const o={}; if(!b) return o; for(const side of ["left","right","top","bottom"]){ const e=kid(b,side); if(e && e.getAttribute("style") && e.getAttribute("style")!=="none") o[side]={style:e.getAttribute("style"), color:color(kid(e,"color"),"#000000")}; } return o; };
    fonts = kids(all(sx,"fonts")[0],"font").map(parseFont);
    fills = kids(all(sx,"fills")[0],"fill").map(f=>parseFill(f,false));
    borders = kids(all(sx,"borders")[0],"border").map(parseBorder);
    xfs = kids(all(sx,"cellXfs")[0],"xf").map(x => { const al = kid(x,"alignment"); return {
      fmt: numFmts[x.getAttribute("numFmtId")||"0"] || "General",
      font: fonts[+(x.getAttribute("fontId")||0)] || {}, fill: fills[+(x.getAttribute("fillId")||0)] || null,
      border: borders[+(x.getAttribute("borderId")||0)] || {},
      h: al?.getAttribute("horizontal") || "general", v: al?.getAttribute("vertical") || "bottom",
      wrap: al?.getAttribute("wrapText")==="1", indent: +(al?.getAttribute("indent")||0), rot: +(al?.getAttribute("textRotation")||0)
    }; });
    dxfs = kids(all(sx,"dxfs")[0],"dxf").map(d => {
      const f = kid(d,"font"); const o = {};
      const fill = parseFill(kid(d,"fill"), true); if(fill) o.fill = fill;
      if(f){ const c = color(kid(f,"color"), null); if(c) o.color = c; if(kid(f,"b")) o.b = kid(f,"b").getAttribute("val")!=="0"; if(kid(f,"i")) o.i = kid(f,"i").getAttribute("val")!=="0"; }
      return o;
    });
  }
  const defaultFont = fonts[0] || {name:"Calibri", sz:11};
  const mdw = (() => { try{ const c = document.createElement("canvas").getContext("2d"); c.font = `${(defaultFont.sz||11)*96/72}px "${defaultFont.name||"Calibri"}", Calibri, Arial`; let m = 0; for(const d of "0123456789") m = Math.max(m, c.measureText(d).width); return m > 3 ? Math.round(m) : 7; }catch(e){ return 7; } })();
  return wb.shared = {sst, xfs, dxfs, defaultFont, color, theme, mdw};
}
async function ensureSheets(wb, names, progress){
  const todo = wb.meta.filter(m => names.includes(m.name) && !wb.isLoaded(m.name));
  if(!todo.length) return [];
  const ctx = await loadShared(wb, progress);
  const total = todo.reduce((s, m) => s + Math.max(m.size, 1), 0); let done = 0;
  const added = [];
  for(const [k, m] of todo.entries()){
    const label = `Reading “${m.name}” (${k+1} of ${todo.length}${m.size > 1048576 ? ", " + fmtMB(m.size) : ""})…`;
    if(progress) progress(label, done/total);
    await nextFrame();
    let S;
    try{ S = await readSheet(wb.zip, m, ctx, f => progress && progress(label, (done + f*Math.max(m.size,1))/total)); S.hidden = false; }
    catch(e){ console.error("sheet " + m.name, e); S = brokenSheet(m.name, e); }
    S.size = m.size;
    wb.sheets.push(S); added.push(S);
    done += Math.max(m.size, 1);
  }
  const order = new Map(wb.meta.map((m,i) => [m.name, i]));
  wb.sheets.sort((a, b) => order.get(a.name) - order.get(b.name));
  if(progress) progress("Preparing pictures…", 1);
  await analyzeImages(added.flatMap(S => S.drawing.anchors.flatMap(A => A.objects.map(o => o.src))));
  return added;
}

function brokenSheet(name, e){
  return {name, hidden:false, error: String(e && e.message || e), tables:[], cells:new Map(), rowInfo:new Map(), colInfo:new Map(), merges:[], cfRules:[], unsupportedCF:new Set(), unpaired:[],
    drawing:{anchors:[], charts:[], unsupported:[], skipped:0}, title:"", subtitle:"", ctx:{xfs:[]},
    get(){ return null; }, rowHidden(){ return false; }, colHidden(){ return false; }, rowPx(){ return 20; }, colPx(){ return 64; }, xfAt(){ return {}; }};
}
async function readSheet(zip, sh, ctx, tick){
  const xml = await zget(zip, sh.path).async("string");
  if(!/<(?:\w+:)?worksheet\b/.test(xml.slice(0, 2000))) throw new Error("the sheet XML could not be read");
  const fpM = /<(?:\w+:)?sheetFormatPr\b([^>]*)>/.exec(xml), fp = fpM ? xattrs(fpM[1]) : {};
  const defColW = fp.defaultColWidth ? +fp.defaultColWidth : (fp.baseColumnWidth ? +fp.baseColumnWidth + 0.71 : 8.43);
  const defRowH = fp.defaultRowHeight ? +fp.defaultRowHeight : 15;
  const zeroH = fp.zeroHeight==="1" || fp.zeroHeight==="true";
  const colInfo = new Map();
  const colsM = /<(?:\w+:)?cols>([\s\S]*?)<\/(?:\w+:)?cols>/.exec(xml);
  if(colsM){ const re = /<(?:\w+:)?col\b([^>]*?)\/?>/g; let m;
    while((m = re.exec(colsM[1]))){ const a = xattrs(m[1]);
      const info = {w: a.width ? +a.width : defColW, hidden: a.hidden==="1"||a.hidden==="true", s: a.style!=null ? +a.style : null};
      for(let i=+a.min; i<=+a.max && i<=16384; i++){ colInfo.set(i, info); if(i>400) break; } } }
  const rowInfo = new Map(), cells = new Map();
  const sd0 = xml.search(/<(?:\w+:)?sheetData\b/), sd1 = xml.search(/<\/(?:\w+:)?sheetData>/);
  const data = sd0 >= 0 ? xml.slice(sd0, sd1 >= 0 ? sd1 : undefined) : "";
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
  const cRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  const vRe = /<(?:\w+:)?v(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?v>/, isRe = /<(?:\w+:)?is(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?is>/, tRe = /<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g;
  let m, lastRow = 0, n = 0;
  while((m = rowRe.exec(data))){
    const ra = xattrs(m[1]);
    const r = ra.r ? +ra.r : lastRow + 1; lastRow = r;
    rowInfo.set(r, {h: ra.ht ? +ra.ht : defRowH, hidden: ra.hidden==="1"||ra.hidden==="true", s: ra.customFormat==="1" ? +(ra.s||0) : null});
    if(m[2]){
      let c, lastCol = 0; cRe.lastIndex = 0;
      while((c = cRe.exec(m[2]))){
        const a = xattrs(c[1]);
        const ref = a.r ? splitRef(a.r) : {r, c: lastCol + 1}; if(!ref) continue; lastCol = ref.c;
        const t = a.t || "n", body = c[2] || "";
        const vm = body ? vRe.exec(body) : null, vt = vm ? vm[1] : null;
        const xf = ctx.xfs[+(a.s||0)] || ctx.xfs[0] || {};
        let v = null, type = "blank";
        if(t==="s" && vt!=null){ v = ctx.sst[+vt] ?? ""; type = "s"; }
        else if(t==="inlineStr"){ const im = isRe.exec(body); if(im){ let s = "", q; tRe.lastIndex = 0; while((q = tRe.exec(im[1]))) s += q[1]; v = xdec(s); type = "s"; } }
        else if(t==="str" && vt!=null){ v = xdec(vt); type = "s"; }
        else if(t==="b" && vt!=null){ v = vt==="1"; type = "b"; }
        else if(t==="e" && vt!=null){ v = vt; type = "e"; }
        else if(t==="d" && vt!=null){ v = (Date.parse(vt)/86400000)+25569; type = "d"; }
        else if(vt!=null && vt!==""){ v = +vt; type = isDateFmt(xf.fmt) ? "d" : "n"; }
        if(type==="s" && v==="") type = "blank";
        cells.set(r+","+ref.c, {r, c:ref.c, v, t:type, xf, fmt:xf.fmt});
      }
    }
    if(++n % 4000 === 0 && tick){ tick(Math.min(.95, rowRe.lastIndex / Math.max(1, data.length))); await nextFrame(); }
  }
  const merges = []; { const re = /<(?:\w+:)?mergeCell\b[^>]*?\bref="([^"]+)"/g; let q; while((q = re.exec(xml))) merges.push(parseRange(q[1])); }
  const cfRules = [], unsupportedCF = new Set();
  { const re = /<(?:\w+:)?conditionalFormatting\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?conditionalFormatting>/g; let q;
    while((q = re.exec(xml))){
      const ranges = (xattrs(q[1]).sqref || "").split(/\s+/).filter(Boolean).map(parseRange);
      const rr = /<(?:\w+:)?cfRule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?cfRule>)/g; let k;
      while((k = rr.exec(q[2]))){
        const a = xattrs(k[1]), type = a.type;
        if(!["cellIs","expression"].includes(type)) unsupportedCF.add(type);
        const formulas = []; const fr = /<(?:\w+:)?formula(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?formula>/g; let f; while((f = fr.exec(k[2]||""))) formulas.push(xdec(f[1]));
        cfRules.push({ranges, type, op:a.operator ?? null, priority:+(a.priority||999), stop:a.stopIfTrue==="1", dxf: ctx.dxfs[+a.dxfId] || null, formulas});
      }
    } }
  cfRules.sort((a,b)=>a.priority-b.priority);
  const drawing = await readDrawing(zip, sh.path, ctx);

  const S = {name: sh.name, cells, rowInfo, colInfo, merges, cfRules, unsupportedCF, drawing, defColW, defRowH, zeroH, ctx, _cs:[0,0], _rs:[0,0],
    get(r,c){ return cells.get(r+","+c) || null; },
    rowHidden(r){ const i=rowInfo.get(r); return i ? i.hidden : zeroH; },
    colHidden(c){ const i=colInfo.get(c); return i ? i.hidden : false; },
    rowPx(r){ const i=rowInfo.get(r); return Math.round((i ? i.h : defRowH) * 96/72); },
    colPx(c){ const i=colInfo.get(c); const w = i ? i.w : defColW; const m = ctx.mdw || 7; return Math.max(0, Math.trunc(((256*w + Math.trunc(128/m))/256)*m)); },
    colStart(c){ while(this._cs.length <= c){ const k = this._cs.length; this._cs.push(this._cs[k-1] + this.colPx(k-1)); } return this._cs[c]; },
    rowStart(r){ while(this._rs.length <= r){ const k = this._rs.length; this._rs.push(this._rs[k-1] + this.rowPx(k-1)); } return this._rs[r]; },
    cellAt(px, py){ let c = 1; while(c < 16384 && this.colStart(c+1) <= px) c++; let r = 1; while(r < 1048576 && this.rowStart(r+1) <= py) r++; return {c, r, co: px - this.colStart(c), ro: py - this.rowStart(r)}; },
    xfAt(r,c){ const x=cells.get(r+","+c); if(x) return x.xf; const ri=rowInfo.get(r); if(ri && ri.s!==null) return ctx.xfs[ri.s]||{}; const ci=colInfo.get(c); if(ci && ci.s!==null) return ctx.xfs[ci.s]||{}; return ctx.xfs[0]||{}; }
  };
  S.title = textOf(S, 1, 1);
  S.subtitle = textOf(S, 2, 1); if(S.subtitle.toLowerCase()==="x") S.subtitle = "";
  S.tables = findRegions(S);
  return S;
}
function drawColor(el, ctx){
  const c = kids(el,"srgbClr")[0] || kids(el,"schemeClr")[0] || kids(el,"prstClr")[0] || kids(el,"sysClr")[0];
  if(!c) return null;
  const v = c.getAttribute("val");
  if(c.localName==="srgbClr") return "#"+v;
  if(c.localName==="sysClr") return "#"+(c.getAttribute("lastClr")||"000000");
  if(c.localName==="prstClr") return NAMED[v.toLowerCase()] || ({gray:"#808080",grey:"#808080",darkGray:"#A9A9A9",lightGray:"#D3D3D3",orange:"#FFA500"}[v]) || "#000000";
  const map = {lt1:0,bg1:0,dk1:1,tx1:1,lt2:2,bg2:2,dk2:3,tx2:3,accent1:4,accent2:5,accent3:6,accent4:7,accent5:8,accent6:9,hlink:10,folHlink:11};
  return "#"+(ctx.theme[map[v]] || "000000");
}
function textOf(S, r, c){ const x=S.get(r,c); if(!x || x.t==="blank") return ""; return formatValue(x).text.trim(); }

/* ===================== markers → regions ===================== */
function findRegions(S){
  const marks = [];
  for(const x of S.cells.values()) if(x.t==="s" && String(x.v).trim().toLowerCase()==="x") marks.push({r:x.r, c:x.c, used:false});
  marks.sort((a,b)=>a.r-b.r || a.c-b.c);
  const regions = [];
  for(const m of marks){
    if(m.used) continue;
    // bottom-right = nearest marker below-right whose rectangle holds no other marker
    const cands = marks.filter(o => !o.used && o!==m && o.r>m.r && o.c>m.c &&
      !marks.some(q => q!==m && q!==o && !q.used && q.r>=m.r && q.r<=o.r && q.c>=m.c && q.c<=o.c));
    if(!cands.length) continue;
    cands.sort((a,b)=>((a.r-m.r)*(a.c-m.c))-((b.r-m.r)*(b.c-m.c)));
    const e = cands[0]; m.used = e.used = true;
    regions.push({r1:m.r, c1:m.c, r2:e.r, c2:e.c});
  }
  S.unpaired = marks.filter(m=>!m.used).map(m=>A1(m.r,m.c));
  return regions.map(g => buildLayout(S, g)).filter(Boolean);
}

/* ===================== layout of one region ===================== */
const BW = {hair:1,thin:1,dotted:1,dashDot:1,dashDotDot:1,dashed:1,mediumDashDot:2,mediumDashDotDot:2,mediumDashed:2,slantDashDot:2,medium:2,thick:3,double:3};
const BRANK = {hair:1,dotted:2,dashDotDot:3,dashDot:4,dashed:5,thin:6,mediumDashDotDot:7,slantDashDot:8,mediumDashDot:9,mediumDashed:10,medium:11,thick:12,double:13};
const BCSS = s => ({hair:"dotted",dotted:"dotted",dashDot:"dashed",dashDotDot:"dashed",dashed:"dashed",mediumDashDot:"dashed",mediumDashDotDot:"dashed",mediumDashed:"dashed",slantDashDot:"dashed",double:"double"}[s] || "solid");
const heavier = (a,b) => !a ? b : !b ? a : (BRANK[b.style]||0) > (BRANK[a.style]||0) ? b : a;
const bcss = b => b ? `${BW[b.style]||1}px ${BCSS(b.style)} ${b.color}` : "";

function buildLayout(S, g){
  const rows = [], cols = [];
  let hr = 0, hc = 0;
  for(let r=g.r1+1; r<g.r2; r++) S.rowHidden(r) ? hr++ : rows.push(r);
  for(let c=g.c1+1; c<g.c2; c++) S.colHidden(c) ? hc++ : cols.push(c);
  if(!rows.length || !cols.length) return null;
  const y = new Map(), x = new Map(), h = new Map(), w = new Map();
  let acc = 0; for(const r of rows){ y.set(r, acc); h.set(r, S.rowPx(r)); acc += h.get(r); } const H = acc;
  acc = 0; for(const c of cols){ x.set(c, acc); w.set(c, S.colPx(c)); acc += w.get(c); } const W = acc;
  const rIdx = new Map(rows.map((r,i)=>[r,i])), cIdx = new Map(cols.map((c,i)=>[c,i]));

  // merges intersecting region → visible boxes
  const mergeOf = new Map(); const boxes = [];
  for(const m of S.merges){
    const mr = rows.filter(r=>r>=m.r1&&r<=m.r2), mc = cols.filter(c=>c>=m.c1&&c<=m.c2);
    if(!mr.length || !mc.length) continue;
    const box = {r:mr[0], c:mc[0], r2:mr[mr.length-1], c2:mc[mc.length-1], src:{r:m.r1,c:m.c1}, m};
    for(const r of mr) for(const c of mc) mergeOf.set(r+","+c, box);
    boxes.push(box);
  }
  for(const r of rows) for(const c of cols) if(!mergeOf.has(r+","+c)) boxes.push({r, c, r2:r, c2:c, src:{r,c}});

  const errors = [];
  const items = [];
  for(const b of boxes){
    const bx = x.get(b.c), by = y.get(b.r), bw = x.get(b.c2)+w.get(b.c2)-bx, bh = y.get(b.r2)+h.get(b.r2)-by;
    if(bw<=0 || bh<=0) continue;
    const xf = S.xfAt(b.src.r, b.src.c);
    const cell = S.get(b.src.r, b.src.c);
    // borders: each box draws its top/left (merged with neighbour), plus right/bottom at the region edge
    const ri = rIdx.get(b.r), ci = cIdx.get(b.c), ri2 = rIdx.get(b.r2), ci2 = cIdx.get(b.c2);
    const own = side => (side==="right" ? S.xfAt(b.src.r, b.m ? b.m.c2 : b.c) : side==="bottom" ? S.xfAt(b.m ? b.m.r2 : b.r, b.src.c) : xf).border?.[side];
    let top = own("top"), left = own("left"), right = null, bottom = null;
    if(ri>0) top = heavier(top, S.xfAt(rows[ri-1], b.c).border?.bottom);
    if(ci>0) left = heavier(left, S.xfAt(b.r, cols[ci-1]).border?.right);
    if(ci2===cols.length-1) right = own("right");
    if(ri2===rows.length-1) bottom = own("bottom");
    let fill = xf.fill, font = Object.assign({}, S.ctx.defaultFont, stripUndef(xf.font));
    const cf = evalCF(S, b.src.r, b.src.c);
    if(cf){ if(cf.fill) fill = cf.fill; if(cf.color) font.color = cf.color; if(cf.b!==undefined) font.b = cf.b; if(cf.i!==undefined) font.i = cf.i; }
    let text = "", nfColor = null;
    if(cell && cell.t!=="blank"){ const f = formatValue(cell); text = f.text; nfColor = f.color; if(cell.t==="e") errors.push(A1(b.src.r,b.src.c)); }
    let align = xf.h;
    if(align==="general") align = cell && (cell.t==="n"||cell.t==="d") ? "right" : cell && (cell.t==="b"||cell.t==="e") ? "center" : "left";
    if(align==="centerContinuous") align = "center";
    if(align==="fill"||align==="justify"||align==="distributed") align = "left";
    items.push({b, bx, by, bw, bh, fill, top, left, right, bottom, text, font, color: nfColor || font.color || "#000000", align, valign: xf.v, wrap: xf.wrap, indent: xf.indent, rot: xf.rot || 0, isText: cell && cell.t==="s", merged: !!b.m,
      baseFill: xf.fill, cf, nfColor, ctype: cell ? cell.t : "blank"});
  }
  // text overflow into empty neighbours (Excel behaviour for unwrapped text)
  const occupied = new Set(items.filter(i=>i.text).map(i=>i.b.r+","+i.b.c));
  for(const it of items){
    if(!it.text || it.wrap || it.merged || !it.isText) continue;
    if(it.align==="left"){
      let ext = it.bw; let ci = cIdx.get(it.b.c)+1;
      while(ci<cols.length && !occupied.has(it.b.r+","+cols[ci]) && !mergeOf.has(it.b.r+","+cols[ci])){ ext += w.get(cols[ci]); ci++; }
      it.tw = ext; if(ci>=cols.length) it.ov = true;
    } else if(it.align==="center"){ it.ov = true; }
  }
  // drawings: hidden rows/cols collapse like in Excel ("move and size with cells");
  // "move but don't size" objects keep their size and move to the next visible position
  const cx = (c, off) => { if(c<=g.c1) return 0; if(c>=g.c2) return W; if(S.colHidden(c)){ const n = cols.find(k=>k>c); return n ? x.get(n) : W; } return x.get(c)+Math.min(off, w.get(c)); };
  const cy = (r, off) => { if(r<=g.r1) return 0; if(r>=g.r2) return H; if(S.rowHidden(r)){ const n = rows.find(k=>k>r); return n ? y.get(n) : H; } return y.get(r)+Math.min(off, h.get(r)); };
  const fullX = (c, off) => S.colStart(c) + off, fullY = (r, off) => S.rowStart(r) + off;
  const pics = [], rects = [], texts = [];
  for(const A of S.drawing.anchors){
    let from = A.from;
    if(A.type==="abs" && A.pos) from = S.cellAt(A.pos.x, A.pos.y);
    if(!from || from.r < g.r1 || from.r >= g.r2 || from.c < g.c1 || from.c >= g.c2) continue;
    const x0 = cx(from.c, from.co), y0 = cy(from.r, from.ro);
    let aw, ah;
    if(A.type==="two" && A.editAs==="twoCell" && A.to){ aw = cx(A.to.c, A.to.co) - x0; ah = cy(A.to.r, A.to.ro) - y0; }
    else if(A.ext && A.ext.w){ aw = A.ext.w; ah = A.ext.h; }
    else if(A.to){ aw = fullX(A.to.c, A.to.co) - fullX(from.c, from.co); ah = fullY(A.to.r, A.to.ro) - fullY(from.r, from.ro); }
    if(!(aw > 1.5 && ah > 1.5)) continue;
    for(const o of A.objects){
      const box = {x: x0 + o.frac.x*aw, y: y0 + o.frac.y*ah, w: o.frac.w*aw, h: o.frac.h*ah, rot:o.rot, flipH:o.flipH, flipV:o.flipV, name:o.name};
      if(box.w < 1 || box.h < 1) continue;
      if(o.kind==="pic") pics.push(Object.assign(box, {src:o.src, crop:o.crop, unsupported:o.unsupported}));
      else if(o.kind==="box") rects.push(Object.assign(box, {fill:o.fill, line:o.line, round:/round/i.test(o.prst), ellipse:o.prst==="ellipse"}));
      else if(o.kind==="text") texts.push(Object.assign(box, {fill:o.fill, line:o.line, round:/round/i.test(o.prst), paras:o.paras, anchorV:o.anchorV}));
    }
  }
  return {g, rows, cols, W, H, items, pics, rects, texts, hiddenRows:hr, hiddenCols:hc, errors, colX:x, colW:w, rowY:y, rowH:h};
}
function stripUndef(o){ const r={}; for(const k in o) if(o[k]!==undefined && o[k]!==null) r[k]=o[k]; return r; }

function evalCF(S, r, c){
  const cell = S.get(r,c);
  if(!cell || cell.t!=="n") return null;
  const v = cell.v;
  for(const rule of S.cfRules){
    if(!rule.ranges.some(rg=>inRange(rg,r,c))) continue;
    let hit = false;
    if(rule.type==="cellIs"){
      const nums = rule.formulas.map(f => { const n=parseFloat(f); if(!isNaN(n) && /^\s*-?[\d.]+\s*$/.test(f)) return n; const ref=splitRef(f.trim()); if(ref){ const x=S.get(ref.r,ref.c); return x && x.t==="n" ? x.v : NaN; } return NaN; });
      const [a,b] = nums;
      switch(rule.op){
        case "greaterThan": hit=v>a; break; case "greaterThanOrEqual": hit=v>=a; break;
        case "lessThan": hit=v<a; break; case "lessThanOrEqual": hit=v<=a; break;
        case "equal": hit=v===a; break; case "notEqual": hit=v!==a; break;
        case "between": hit=v>=Math.min(a,b)&&v<=Math.max(a,b); break;
        case "notBetween": hit=v<Math.min(a,b)||v>Math.max(a,b); break;
      }
    } else if(rule.type==="expression"){
      const m = /^\s*\$?([A-Z]+)\$?(\d+)\s*=\s*"([^"]*)"\s*$/.exec(rule.formulas[0]||"");
      if(m){ const x=S.get(+m[2], colToNum(m[1])); hit = !!x && String(x.v)===m[3]; }
    }
    if(hit && rule.dxf && Object.keys(rule.dxf).length) return rule.dxf;
    if(hit && rule.stop) return null;
  }
  return null;
}


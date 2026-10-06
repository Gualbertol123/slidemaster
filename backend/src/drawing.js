/* ===================== drawings: pictures, groups, text boxes, boxes ===================== */
const IMG_MIME = {png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",bmp:"image/bmp",svg:"image/svg+xml",webp:"image/webp",ico:"image/x-icon"};
const CONVERTIBLE = {emf:1, wmf:1, tif:1, tiff:1, wdp:1, jxr:1};
const IMGMETA = new Map();
const CONVERT_CACHE = new Map();
function emuPx(v){ return (+v||0)/9525; }
function xfrmOf(el){
  const pr = kid(el,"spPr") || kid(el,"grpSpPr"); const x = pr && kid(pr,"xfrm"); if(!x) return null;
  const off = kid(x,"off"), ext = kid(x,"ext"), co = kid(x,"chOff"), ce = kid(x,"chExt");
  const g = (e,a) => e ? +(e.getAttribute(a)||0) : 0;
  return {x:g(off,"x"), y:g(off,"y"), w:g(ext,"cx"), h:g(ext,"cy"), chx:g(co,"x"), chy:g(co,"y"), chw:g(ce,"cx"), chh:g(ce,"cy"),
          rot:+(x.getAttribute("rot")||0)/60000, flipH:x.getAttribute("flipH")==="1", flipV:x.getAttribute("flipV")==="1"};
}
// walk an anchor's content, mapping group children into fractions of the anchor rectangle
function collectObjects(el, frame, parentX, out){
  const n = el.localName;
  let f = frame;
  if(parentX && n!=="AlternateContent"){
    const x = xfrmOf(el);
    const cw = parentX.chw || parentX.w, ch = parentX.chh || parentX.h;
    if(x && cw && ch) f = {x: frame.x + (x.x-parentX.chx)/cw*frame.w, y: frame.y + (x.y-parentX.chy)/ch*frame.h, w: x.w/cw*frame.w, h: x.h/ch*frame.h};
  }
  if(n==="AlternateContent"){ const c = kid(el,"Choice") || kid(el,"Fallback"); if(c) for(const k of c.children) collectObjects(k, frame, parentX, out); return; }
  if(n==="grpSp"){ const gx = xfrmOf(el); for(const k of el.children) if(["pic","sp","grpSp","graphicFrame","cxnSp","AlternateContent"].includes(k.localName)) collectObjects(k, f, gx, out); return; }
  if(["pic","sp","graphicFrame","cxnSp"].includes(n)) out.push({type:n, el, frac:f, x:xfrmOf(el)});
}
async function convertImage(bytesB64, ext){
  const key = ext + ":" + bytesB64.length + ":" + bytesB64.slice(0,64) + bytesB64.slice(-64);
  if(CONVERT_CACHE.has(key)) return CONVERT_CACHE.get(key);
  let res = null;
  if(typeof SERVED!=="undefined" && SERVED){
    try{
      const bin = Uint8Array.from(atob(bytesB64), c => c.charCodeAt(0));
      const r = await fetch("/api/convert?ext=" + ext, {method:"POST", body: bin});
      if(r.ok){ const b = await r.blob(); res = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); }); }
    }catch(e){}
  }
  CONVERT_CACHE.set(key, res);
  return res;
}
function runText(r){ return all(r,"t").map(t=>t.textContent).join(""); }
async function readDrawing(zip, sheetPath, ctx){
  const res = {anchors:[], charts:[], unsupported:[], skipped:0};
  const shRels = await readRels(zip, sheetPath);
  const dr = Object.values(shRels).find(r=>/\/drawing$/.test(r.type));
  if(!dr || !zget(zip, dr.target)) return res;
  const dx = parseXml(await zget(zip, dr.target).async("string"));
  const dRels = await readRels(zip, dr.target);
  const root = dx.documentElement;
  const pos = el => ({c:+all(el,"col")[0].textContent+1, r:+all(el,"row")[0].textContent+1, co:emuPx(all(el,"colOff")[0].textContent), ro:emuPx(all(el,"rowOff")[0].textContent)});
  for(const a of root.children){
    const t = a.localName; if(!/Anchor$/.test(t)) continue;
    const A = {type: t==="twoCellAnchor" ? "two" : t==="oneCellAnchor" ? "one" : "abs", editAs: a.getAttribute("editAs") || (t==="twoCellAnchor" ? "twoCell" : "oneCell"), objects: []};
    if(kid(a,"from")) A.from = pos(kid(a,"from"));
    if(kid(a,"to")) A.to = pos(kid(a,"to"));
    const e = kid(a,"ext"); if(e) A.ext = {w:emuPx(e.getAttribute("cx")), h:emuPx(e.getAttribute("cy"))};
    const p = kid(a,"pos"); if(p) A.pos = {x:emuPx(p.getAttribute("x")), y:emuPx(p.getAttribute("y"))};
    const objs = [];
    for(const k of a.children) if(["pic","sp","grpSp","graphicFrame","cxnSp","AlternateContent"].includes(k.localName)) collectObjects(k, {x:0,y:0,w:1,h:1}, null, objs);
    for(const o of objs){
      const name = all(o.el,"cNvPr")[0]?.getAttribute("name") || o.type;
      const xf = o.x || {};
      const base = {frac:o.frac, rot:xf.rot||0, flipH:!!xf.flipH, flipV:!!xf.flipV, name};
      if(o.type==="pic"){
        const blipFill = kid(o.el,"blipFill"); const blip = blipFill && kid(blipFill,"blip");
        if(!blip){ res.skipped++; continue; }
        const svgBlip = all(blip,"svgBlip")[0];
        const rid = (svgBlip && (svgBlip.getAttributeNS(NS_R,"embed")||svgBlip.getAttribute("r:embed"))) || blip.getAttributeNS(NS_R,"embed") || blip.getAttribute("r:embed");
        const sr = kid(blipFill,"srcRect");
        const crop = sr ? {l:+(sr.getAttribute("l")||0)/100000, t:+(sr.getAttribute("t")||0)/100000, r:+(sr.getAttribute("r")||0)/100000, b:+(sr.getAttribute("b")||0)/100000} : null;
        let target = rid && dRels[rid]?.target;
        if(!target || !zget(zip, target)){
          const fb = blip.getAttributeNS(NS_R,"embed") || blip.getAttribute("r:embed");
          target = fb && dRels[fb]?.target;
        }
        if(!target || !zget(zip, target)){ res.unsupported.push(name + " (linked picture)"); A.objects.push(Object.assign(base, {kind:"pic", unsupported:"Linked picture"})); continue; }
        const ext = target.split(".").pop().toLowerCase();
        const b64 = await zget(zip, target).async("base64");
        let src = IMG_MIME[ext] ? `data:${IMG_MIME[ext]};base64,${b64}` : null;
        if(!src && CONVERTIBLE[ext]) src = await convertImage(b64, ext);
        if(!src){ res.unsupported.push(`${name} (.${ext})`); A.objects.push(Object.assign(base, {kind:"pic", unsupported: ext.toUpperCase()+" picture"})); continue; }
        A.objects.push(Object.assign(base, {kind:"pic", src, crop}));
      } else if(o.type==="sp"){
        const spPr = kid(o.el,"spPr"), geom = spPr && kid(spPr,"prstGeom"), prst = geom ? geom.getAttribute("prst") : "rect";
        const ln = spPr && kid(spPr,"ln"), fillEl = spPr && kid(spPr,"solidFill"), lnFill = ln && kid(ln,"solidFill");
        const fill = fillEl ? drawColor(fillEl, ctx) : null;
        const line = ln && !kid(ln,"noFill") && (lnFill || !kid(ln,"noFill")) ? {w: Math.max(1, Math.round(emuPx(ln.getAttribute("w")||9525))), color: lnFill ? drawColor(lnFill, ctx) : "#000000"} : null;
        const tx = kid(o.el,"txBody");
        const paras = tx ? kids(tx,"p").map(pp => {
          const pPr = kid(pp,"pPr"); const algn = pPr?.getAttribute("algn") || "l";
          const runs = [...kids(pp,"r"), ...kids(pp,"fld")].map(r => { const rp = kid(r,"rPr"); const sf = rp && kid(rp,"solidFill");
            return {text: runText(r), sz: rp && rp.getAttribute("sz") ? +rp.getAttribute("sz")/100 : null, b: rp?.getAttribute("b")==="1", i: rp?.getAttribute("i")==="1", color: sf ? drawColor(sf, ctx) : null}; });
          const end = kid(pp,"endParaRPr");
          return {align: algn==="ctr" ? "center" : algn==="r" ? "right" : "left", runs, sz: end && end.getAttribute("sz") ? +end.getAttribute("sz")/100 : null};
        }) : [];
        const hasText = paras.some(p => p.runs.some(r => r.text.trim()));
        const bodyPr = tx && kid(tx,"bodyPr");
        if(!hasText && !/^(rect|roundRect|ellipse|snipRoundRect|round2SameRect)$/.test(prst)){ res.skipped++; continue; }
        if(!hasText && !fill && !line){ continue; }
        A.objects.push(Object.assign(base, {kind: hasText ? "text" : "box", prst, fill, line, paras, anchorV: bodyPr?.getAttribute("anchor") || "t"}));
      } else if(o.type==="graphicFrame"){
        const gd = all(o.el,"graphicData")[0], uri = gd?.getAttribute("uri") || "";
        if(/chart/i.test(uri)) res.charts.push(name); else res.skipped++;
      } else res.skipped++;
    }
    if(A.objects.length) res.anchors.push(A);
  }
  return res;
}
// small analysis so Liquid Glass can tell round badges (flags, icons) from ordinary pictures
async function analyzeImages(srcs){
  for(const src of srcs){
    if(!src || IMGMETA.has(src)) continue;
    const meta = {round:false, alpha:false, w:0, h:0};
    try{
      const img = new Image(); img.src = src; await img.decode();
      meta.w = img.naturalWidth; meta.h = img.naturalHeight;
      const N = 32, c = document.createElement("canvas"); c.width = N; c.height = N;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0, N, N);
      const d = x.getImageData(0,0,N,N).data;
      const px = (i,j) => { const k = (j*N+i)*4; return [d[k],d[k+1],d[k+2],d[k+3]]; };
      const empty = p => p[3] < 40 || (p[0]>236 && p[1]>236 && p[2]>236);
      const corners = [px(1,1),px(N-2,1),px(1,N-2),px(N-2,N-2)].every(empty);
      const centre = px(N>>1,N>>1);
      const ratio = meta.w / Math.max(1, meta.h);
      meta.round = corners && !empty(centre) && ratio > .8 && ratio < 1.25;
      meta.alpha = [px(1,1),px(N-2,1),px(1,N-2),px(N-2,N-2)].some(p => p[3] < 40);
      // opaque graphic on a white background (pasted titles, logos, text pictures): mostly white pixels, white border
      let white = 0, edge = 0, edgeWhite = 0;
      for(let j=0;j<N;j++) for(let i=0;i<N;i++){ const p = px(i,j), w = p[3] > 200 && p[0]>238 && p[1]>238 && p[2]>238; if(w) white++; if(i===0||j===0||i===N-1||j===N-1){ edge++; if(w) edgeWhite++; } }
      meta.whiteBg = !meta.alpha && edgeWhite/edge > .92 && white/(N*N) > .55;
      if(meta.whiteBg){
        // key the white background out (un-blending against white), so the graphic sits on any surface
        const k = Math.min(1, 1600 / Math.max(meta.w, 1)), W = Math.max(1, Math.round(meta.w*k)), H = Math.max(1, Math.round(meta.h*k));
        const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        const g = cv.getContext("2d"); g.drawImage(img, 0, 0, W, H);
        const id = g.getImageData(0, 0, W, H), q = id.data;
        for(let i=0; i<q.length; i+=4){
          const a = Math.max(255 - q[i], 255 - q[i+1], 255 - q[i+2]) / 255;          // distance from white
          if(a <= 0){ q[i+3] = 0; continue; }
          const A = Math.min(1, a * 1.15);
          q[i] = 255 - (255 - q[i]) / A; q[i+1] = 255 - (255 - q[i+1]) / A; q[i+2] = 255 - (255 - q[i+2]) / A; q[i+3] = Math.round(A * 255);
        }
        g.putImageData(id, 0, 0); meta.keyed = cv.toDataURL("image/png");
      }
    }catch(e){}
    IMGMETA.set(src, meta);
  }
}

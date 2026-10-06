/* ============================================================================================
   SCENE MODEL — design-independent structure of any block of cells
   ============================================================================================
   An Excel range can be a table, a key/value panel, a grid of cards, a form, a dashboard tile…
   Nothing here assumes one of those. The range is decomposed into visual PRIMITIVES, the
   primitives are arranged in a CONTAINMENT TREE, ROLES are inferred from geometry and style, and
   a THEME translates materials. The geometry designed in Excel is always preserved.

     Grid       cells on a row/column index grid (merged cells span several), resolved borders
     Surface    an area of cells sharing a fill (empty cells included) – may contain anything
     Frame      a rectangle closed by borders (a boxed cell, a box around several cells, a shape)
     Grid       adjacent boxed cells sharing their borders (a ruled table): one container + lines
     Rule       an open line (underline of a heading, separator, single side border)
     Text       a cell's text + its style; Signal = conditional/semantic colour of that cell
     Media      pictures, icons, shapes, text boxes
     Container  Surface | Frame | Grid | implicit card; containers nest (depth)

   Roles (per text): heading · section · label · value · emphasis · caption · text
   Every decision degrades gracefully: when nothing is recognised the text keeps its position
   on a neutral card – it is never dropped or moved.
   ============================================================================================ */

const RGB = h => hexRgb(h || "#FFFFFF");
function colorDist(a, b){ const x = RGB(a), y = RGB(b); return Math.abs(x[0]-y[0]) + Math.abs(x[1]-y[1]) + Math.abs(x[2]-y[2]); }
function satOf(h){ const [r,g,b] = RGB(h); return (Math.max(r,g,b) - Math.min(r,g,b)) / 255; }
/* fill classes: white (= page), light (pale tint), grey, color (saturated mid tone), dark */
function fillClass(h){
  if(!h) return null;
  const L = lum(h), s = satOf(h);
  if(L > .95 && s < .07) return "white";
  if(L < .45) return "dark";
  if(s < .09) return L > .8 ? "light" : "grey";
  return L > .82 ? "light" : "color";
}
const isWhiteish = c => !c || (lum(c) > .93 && satOf(c) < .08);
const median = a => { if(!a.length) return 0; const s = a.slice().sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };

function buildScene(L, its){
  const R = L.rows.length, C = L.cols.length, N = R*C;
  const G = glassGeom(L);
  const ri = new Map(L.rows.map((r,i)=>[r,i])), ci = new Map(L.cols.map((c,i)=>[c,i]));
  const X = i => i >= C ? G.W : G.X.get(L.cols[i]);
  const Y = i => i >= R ? L.H : L.rowY.get(L.rows[i]);

  /* ---------- 1. grid of nodes (one per visible cell / merged block) ---------- */
  const cell = new Array(N).fill(null);
  const nodes = its.map((it, k) => ({k, it, r0: ri.get(it.b.r), r1: ri.get(it.b.r2), c0: ci.get(it.b.c), c1: ci.get(it.b.c2)}));
  for(const n of nodes) for(let r=n.r0; r<=n.r1; r++) for(let c=n.c0; c<=n.c1; c++) cell[r*C+c] = n;
  const at = (r, c) => (r>=0 && r<R && c>=0 && c<C) ? cell[r*C+c] : null;

  /* ---------- 2. edges: borders on grid lines (white borders are gaps, not lines) ---------- */
  const H = new Array((R+1)*C).fill(null), V = new Array((C+1)*R).fill(null);
  const keep = b => b && !isWhiteish(b.color) ? b : null;
  const setH = (line, c, b) => { b = keep(b); if(b) H[line*C+c] = heavier(H[line*C+c], b); };
  const setV = (line, r, b) => { b = keep(b); if(b) V[line*R+r] = heavier(V[line*R+r], b); };
  for(const n of nodes){ const it = n.it;
    for(let c=n.c0; c<=n.c1; c++){ setH(n.r0, c, it.top); setH(n.r1+1, c, it.bottom); }
    for(let r=n.r0; r<=n.r1; r++){ setV(n.c0, r, it.left); setV(n.c1+1, r, it.right); } }
  const hAll = (line, c0, c1) => { for(let c=c0; c<=c1; c++) if(!H[line*C+c]) return false; return true; };
  const vAll = (line, r0, r1) => { for(let r=r0; r<=r1; r++) if(!V[line*R+r]) return false; return true; };
  const used = {H: new Uint8Array((R+1)*C), V: new Uint8Array((C+1)*R)};        // 1 = perimeter, 2 = separator
  const markRect = (r0, c0, r1, c1, v) => { for(let c=c0;c<=c1;c++){ if(H[r0*C+c]) used.H[r0*C+c] ||= v; if(H[(r1+1)*C+c]) used.H[(r1+1)*C+c] ||= v; }
                                            for(let r=r0;r<=r1;r++){ if(V[c0*R+r]) used.V[c0*R+r] ||= v; if(V[(c1+1)*R+r]) used.V[(c1+1)*R+r] ||= v; } };
  const rectPx = (r0, c0, r1, c1) => ({x: X(c0), y: Y(r0), w: X(c1+1) - X(c0), h: Y(r1+1) - Y(r0)});
  const strokeOf = (r0, c0, r1, c1) => { let best = null; for(let c=c0;c<=c1;c++){ best = heavier(best, H[r0*C+c]); best = heavier(best, H[(r1+1)*C+c]); } for(let r=r0;r<=r1;r++){ best = heavier(best, V[c0*R+r]); best = heavier(best, V[(c1+1)*R+r]); } return best; };

  /* ---------- 3. surfaces: connected cells with a similar structural fill ---------- */
  const structFill = n => (n.it.noFill ? null : n.it.baseFill) || null;   // CF and user highlights are Signals, not structure
  const parent = new Int32Array(nodes.length).map((_, i) => i);
  const find = i => { while(parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const unite = (a, b) => { a = find(a); b = find(b); if(a !== b) parent[b] = a; };
  const same = (a, b) => { const fa = structFill(a), fb = structFill(b); return fa && fb && fillClass(fa)===fillClass(fb) && colorDist(fa, fb) < 40; };
  for(const n of nodes){
    if(!structFill(n)) continue;
    for(let r=n.r0; r<=n.r1; r++){ const m = at(r, n.c1+1); if(m && m!==n && same(n, m)) unite(n.k, m.k); }
    for(let c=n.c0; c<=n.c1; c++){ const m = at(n.r1+1, c); if(m && m!==n && same(n, m)) unite(n.k, m.k); }
  }
  const comps = new Map();
  for(const n of nodes){ if(!structFill(n)) continue; const root = find(n.k); if(!comps.has(root)) comps.set(root, []); comps.get(root).push(n); }
  // green/red fills behind values read as a status (like conditional formatting): one capsule per cell,
  // unless the colour is a large background area without text
  const statusCells = new Set();
  for(const [k, list] of [...comps]){
    if(!["pos","neg"].includes(tone(structFill(list[0])))) continue;
    const withText = list.filter(n => n.it.text);
    if(withText.length * 2 >= list.length){ withText.forEach(n => statusCells.add(n)); comps.delete(k); }
  }

  /* ---------- 4. frames: boxed cells, ruled grids, boxes around several cells ---------- */
  const framed = new Set();
  for(const n of nodes) if(hAll(n.r0, n.c0, n.c1) && hAll(n.r1+1, n.c0, n.c1) && vAll(n.c0, n.r0, n.r1) && vAll(n.c1+1, n.r0, n.r1)) framed.add(n);
  // boxed cells that share borders with boxed neighbours form a ruled grid (a table), not separate boxes
  const gp = new Map([...framed].map(n => [n, n]));
  const gfind = n => { while(gp.get(n) !== n){ gp.set(n, gp.get(gp.get(n))); n = gp.get(n); } return n; };
  for(const n of framed){
    for(let r=n.r0; r<=n.r1; r++){ const m = at(r, n.c1+1); if(m && framed.has(m)) gp.set(gfind(m), gfind(n)); }
    for(let c=n.c0; c<=n.c1; c++){ const m = at(n.r1+1, c); if(m && framed.has(m)) gp.set(gfind(m), gfind(n)); }
  }
  const groups = new Map(); for(const n of framed){ const g = gfind(n); if(!groups.has(g)) groups.set(g, []); groups.get(g).push(n); }
  const containers = [], inGrid = new Set();
  for(const list of groups.values()){
    if(list.length === 1){
      const n = list[0]; const s = strokeOf(n.r0, n.c0, n.r1, n.c1);
      containers.push(Object.assign({kind:"frame", r0:n.r0, c0:n.c0, r1:n.r1, c1:n.c1, stroke:s, cells:1}, rectPx(n.r0, n.c0, n.r1, n.c1)));
      markRect(n.r0, n.c0, n.r1, n.c1, 1);
    } else {
      const r0 = Math.min(...list.map(n=>n.r0)), r1 = Math.max(...list.map(n=>n.r1)), c0 = Math.min(...list.map(n=>n.c0)), c1 = Math.max(...list.map(n=>n.c1));
      containers.push(Object.assign({kind:"grid", r0, c0, r1, c1, stroke: strokeOf(r0, c0, r1, c1), cells:list.length}, rectPx(r0, c0, r1, c1)));
      list.forEach(n => { inGrid.add(n); markRect(n.r0, n.c0, n.r1, n.c1, 2); });
      markRect(r0, c0, r1, c1, 1);
    }
  }
  // boxes drawn around several cells (perimeter closed, interior open): search from top-left corners
  if(N <= 20000){
    let budget = 250000; const seen = new Set();
    for(let r=0; r<R && budget>0; r++) for(let c=0; c<C && budget>0; c++){
      const n0 = at(r, c); if(!n0 || n0.r0!==r || n0.c0!==c || inGrid.has(n0)) continue;
      if(!H[r*C+c] || !V[c*R+r]) continue;
      for(let cj=c; cj<C && H[r*C+cj] && budget>0; cj++){
        if(!V[(cj+1)*R+r]) continue;
        for(let rj=r; rj<R && V[c*R+rj] && V[(cj+1)*R+rj] && budget-- > 0; rj++){
          if(!hAll(rj+1, c, cj)) continue;
          const one = at(r, c), single = one && one.r0===r && one.c0===c && one.r1===rj && one.c1===cj;
          const key = r+","+c+","+rj+","+cj;
          if(!single && !seen.has(key) && (rj>r || cj>c)){
            seen.add(key);
            containers.push(Object.assign({kind:"frame", r0:r, c0:c, r1:rj, c1:cj, stroke: strokeOf(r, c, rj, cj), cells:(rj-r+1)*(cj-c+1)}, rectPx(r, c, rj, cj)));
            markRect(r, c, rj, cj, 1);
          }
          break;                                     // the smallest box for this top edge
        }
      }
    }
  }
  const frameAt = new Set(containers.filter(k => k.kind==="frame" && k.cells===1).map(k => k.r0+","+k.c0));

  // surfaces → rectangles (holes are allowed when something else fills them: boxes, other fills)
  for(const list of comps.values()){
    const color = structFill(list[0]), cls = fillClass(color);
    const r0 = Math.min(...list.map(n=>n.r0)), r1 = Math.max(...list.map(n=>n.r1)), c0 = Math.min(...list.map(n=>n.c0)), c1 = Math.max(...list.map(n=>n.c1));
    const member = new Set(list); let holes = 0, total = 0;
    for(let r=r0; r<=r1; r++) for(let c=c0; c<=c1; c++){ total++; const m = at(r, c); if(!member.has(m) && !(m && (structFill(m) || frameAt.has(m.r0+","+m.c0) || inGrid.has(m)))) holes++; }
    const push = (a, b, cc, d) => containers.push(Object.assign({kind:"surface", r0:a, c0:cc, r1:b, c1:d, color, cls, cells:(b-a+1)*(d-cc+1), text: list.some(n=>n.it.text)}, rectPx(a, cc, b, d)));
    if(holes / total <= .15) push(r0, r1, c0, c1);
    else {                                               // irregular area: rows of runs, merged downwards
      const runs = [];
      for(let r=r0; r<=r1; r++){ let c = c0; while(c<=c1){ if(member.has(at(r,c))){ let e = c; while(e+1<=c1 && member.has(at(r,e+1))) e++; const prev = runs.find(q => q.c0===c && q.c1===e && q.r1===r-1); if(prev) prev.r1 = r; else runs.push({r0:r, r1:r, c0:c, c1:e}); c = e+1; } else c++; } }
      runs.forEach(q => push(q.r0, q.r1, q.c0, q.c1));
    }
    // the outline of a filled area is part of the area, not a separate line
    markRect(r0, c0, r1, c1, 1);
  }
  // shapes drawn on the sheet: filled → surface, outline only → frame
  for(const s of L.rects){
    const x = G.map(s.x), w = G.map(s.x + s.w) - x;
    if(s.fill && !isWhiteish(s.fill)) containers.push({kind:"surface", x, y:s.y, w, h:s.h, color:s.fill, cls:fillClass(s.fill), shape:true, cells:99});
    else if(s.line) containers.push({kind:"frame", x, y:s.y, w, h:s.h, stroke:{style: s.line.w>1?"medium":"thin", color:s.line.color}, shape:true, cells:99});
  }

  /* ---------- 5. rules: remaining border lines, merged into segments ---------- */
  const rules = [];
  for(let line=0; line<=R; line++){ let c = 0; while(c<C){ const b = H[line*C+c]; if(b && used.H[line*C+c]!==1){ let e = c; while(e+1<C && H[line*C+e+1] && used.H[line*C+e+1]!==1 && H[line*C+e+1].style===b.style) e++;
        rules.push({dir:"h", sep: used.H[line*C+c]===2, x: X(c), y: Y(line), w: X(e+1) - X(c), b, line, c0:c, c1:e}); c = e+1; } else c++; } }
  for(let line=0; line<=C; line++){ let r = 0; while(r<R){ const b = V[line*R+r]; if(b && used.V[line*R+r]!==1){ let e = r; while(e+1<R && V[line*R+e+1] && used.V[line*R+e+1]!==1) e++;
        rules.push({dir:"v", sep: used.V[line*R+r]===2, x: X(line), y: Y(r), h: Y(e+1) - Y(r), b, line, r0:r, r1:e}); r = e+1; } else r++; } }

  /* ---------- 6. texts, signals, media ---------- */
  const texts = nodes.filter(n => n.it.text).map(n => ({n, it:n.it, x:n.it.bx, y:n.it.by, w:n.it.bw, h:n.it.bh}));
  const signals = nodes.filter(n => { const it = n.it, ft = tone(it.fill); return statusCells.has(n) || (it.cf && it.cf.fill) || it.userFill || (ft && ft!=="muted" && !structFill(n)); }).map(n => ({n, it:n.it}));
  const media = L.pics.map(p => Object.assign({}, p, {x: G.map(p.x + p.w/2) - p.w/2}));
  const tboxes = L.texts.map(t => { const x0 = G.map(t.x); return Object.assign({}, t, {x: x0, w: G.map(t.x + t.w) - x0}); });

  /* ---------- 7. containment tree ---------- */
  const area = c => c.w * c.h;
  // a box and a fill on exactly the same cells are one container (a filled box)
  for(const s of containers.filter(c => c.kind==="surface")){
    const f = containers.find(c => c!==s && c.kind!=="surface" && !c.fill && Math.abs(c.x-s.x)<2 && Math.abs(c.y-s.y)<2 && Math.abs(c.w-s.w)<2 && Math.abs(c.h-s.h)<2);
    if(f){ f.fill = s.color; f.fillCls = s.cls; s.dead = true; }
  }
  const live = containers.filter(c => !c.dead && c.w > 1 && c.h > 1).sort((a,b) => area(b) - area(a));
  const inside = (o, c, tol=2) => o.x >= c.x - tol && o.y >= c.y - tol && o.x + o.w <= c.x + c.w + tol && o.y + o.h <= c.y + c.h + tol;
  const CELL = 96, buckets = new Map(), bkey = (i, j) => i + ":" + j;
  for(const c of live) for(let i = Math.floor(c.x/CELL); i <= Math.floor((c.x+c.w)/CELL); i++) for(let j = Math.floor(c.y/CELL); j <= Math.floor((c.y+c.h)/CELL); j++){ const k = bkey(i,j); if(!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(c); }
  const candidates = o => buckets.get(bkey(Math.floor((o.x + o.w/2)/CELL), Math.floor((o.y + o.h/2)/CELL))) || [];
  for(const c of live){ c.parent = null; for(const p of candidates(c)){ if(p===c || area(p) <= area(c)*1.001) continue; if(inside(c, p) && (!c.parent || area(p) < area(c.parent))) c.parent = p; } }
  for(const c of live){ let d = 0, p = c.parent; while(p){ d++; p = p.parent; } c.depth = d; }
  const owner = o => { let best = null; for(const c of candidates(o)) if(inside(o, c) && (!best || area(c) < area(best))) best = c; return best; };
  texts.forEach(t => t.parent = owner(t));
  signals.forEach(s => s.parent = owner({x:s.it.bx, y:s.it.by, w:s.it.bw, h:s.it.bh}));
  media.forEach(m => m.parent = owner(m));
  rules.forEach(r => r.parent = owner({x:r.x, y:r.y, w:r.w||1, h:r.h||1}));
  // background of an element = first coloured ancestor (fill or filled box)
  const bgOf = o => { let p = o.parent; while(p){ const col = p.kind==="surface" ? p.color : p.fill; if(col && !isWhiteish(col)) return {color: col, cls: fillClass(col), c: p}; if(col) return {color: col, cls: "white", c: p}; p = p.parent; } return {color: null, cls: "white", c: null}; };

  return {L, G, R, C, X, Y, at, nodes, containers: live, rules, texts, signals, media, tboxes, bgOf, area};
}

/* ---------------- roles: what each piece of text is, inferred from geometry and style ---------------- */
function inferRoles(sc){
  const px = t => (t.it.font.sz || 11) * 96/72;
  const m = median(sc.texts.map(px)) || 14;
  const isNum = t => t.it.ctype==="n" || t.it.ctype==="d" || (!t.it.isText && isNumText(t.it.text));
  const hRules = sc.rules.filter(r => r.dir==="h" && !r.sep && !(r.parent && r.parent.kind==="grid"));
  const textW = t => Math.min(t.it.tw || t.w, String(t.it.text).length * px(t) * .6 + 24);
  const ruleBelow = t => hRules.find(r => r.y >= t.y + t.h - 3 && r.y <= t.y + t.h + 10 && Math.min(r.x + r.w, t.x + textW(t)) - Math.max(r.x, t.x) >= Math.min(textW(t), r.w) * .5);
  const rowTexts = new Map(); sc.texts.forEach(t => { const k = t.n.r0; if(!rowTexts.has(k)) rowTexts.set(k, []); rowTexts.get(k).push(t); });
  for(const t of sc.texts){
    const it = t.it, bg = sc.bgOf(t), size = px(t);
    t.bg = bg; t.num = isNum(t);
    const user = it.role;
    const rb = ruleBelow(t); if(rb && !t.num && (it.font.b || size >= m*1.1 || !t.parent)){ rb.heading = true; t.rule = rb; }
    const tall = t.n.r1 > t.n.r0 && t.h > 1.6 * (sc.L.rowH.get(sc.L.rows[t.n.r0]) || 20);
    const onColour = bg.cls==="dark" || bg.cls==="grey" || bg.cls==="color";
    const rowMates = (rowTexts.get(t.n.r0) || []).filter(o => o!==t && o.parent===t.parent);
    let role;
    if(user==="header") role = onColour ? "label" : "heading-s";
    else if(user==="total") role = "emphasis";
    else if(user==="caption") role = "caption";
    else if(user==="body") role = t.num ? "value" : "text";
    else if(t.rule || (!t.parent && !t.num && size >= m*1.25)) role = "heading";
    else if(tall && onColour && !t.num && String(it.text).length <= 32) role = "section";
    else if(onColour && !t.num) role = "label";
    else if(it.font.i && !t.num) role = "caption";
    else if(size <= m*.82 && !t.num) role = "caption";
    else if(t.num && (it.font.b || (t.parent && t.parent.kind!=="surface" && t.parent.fill && !isWhiteish(t.parent.fill)))) role = "emphasis";
    else if(t.num) role = "value";
    else if(it.font.b && rowMates.some(isNum)) role = "label";
    else role = "text";
    t.role = role;
  }
  // texts that no container holds get an implicit card per cluster (except titles and notes on their own)
  const free = sc.texts.filter(t => !t.parent && t.role!=="heading" && t.role!=="caption");
  free.push(...sc.media.filter(md => !md.parent && (IMGMETA.get(md.src) || {}).round));   // row icons belong to their rows; free-standing graphics stay free
  if(free.length){
    const rh = median(sc.L.rows.map(r => sc.L.rowH.get(r))) || 20, gapY = rh * 1.05, gapX = 48;
    free.sort((a, b) => a.y - b.y || a.x - b.x);
    const p = free.map((_, i) => i), f = i => { while(p[i]!==i){ p[i] = p[p[i]]; i = p[i]; } return i; };
    for(let i=0;i<free.length;i++){ const a = free[i];
      for(let j=i+1; j<free.length && free[j].y <= a.y + a.h + gapY; j++){
        const b = free[j];
        const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
        if(dx <= gapX && dy <= gapY) p[f(j)] = f(i);
      } }
    const cl = new Map(); free.forEach((o, i) => { const k = f(i); if(!cl.has(k)) cl.set(k, []); cl.get(k).push(o); });
    for(const list of cl.values()){
      const x0 = Math.min(...list.map(o=>o.x)), y0 = Math.min(...list.map(o=>o.y)), x1 = Math.max(...list.map(o=>o.x+(o.it ? Math.min(o.it.tw||o.w, o.w + 400) : o.w))), y1 = Math.max(...list.map(o=>o.y+o.h));
      const card = {kind:"implicit", x:x0, y:y0, w:x1-x0, h:y1-y0, depth:0, parent:null};
      sc.containers.push(card); list.forEach(o => o.parent = card);
    }
    sc.signals.forEach(s => { if(!s.parent) s.parent = sc.containers.find(c => c.kind==="implicit" && inside4({x:s.it.bx, y:s.it.by, w:s.it.bw, h:s.it.bh}, c)) || null; });
  }
  // tables: rows of aligned texts inside a container get hairline separators where Excel drew none
  const byParent = new Map(); for(const t of sc.texts){ if(!t.parent || t.role==="heading") continue; if(!byParent.has(t.parent)) byParent.set(t.parent, []); byParent.get(t.parent).push(t); }
  for(const c of sc.containers){
    if(c.kind==="surface" && c.cls!=="white") continue;
    const kids = byParent.get(c) || [];
    const rows = [...new Set(kids.map(t => t.n.r0))].sort((a,b)=>a-b);
    if(rows.length < 3) continue;
    const numRatio = kids.filter(t => t.num).length / Math.max(1, kids.length);
    const cols = new Set(kids.map(t => t.n.c0)).size;
    if(cols < 2 || numRatio < .25) continue;
    c.table = true;
    const hasLines = sc.rules.some(r => r.dir==="h" && r.parent===c);
    if(hasLines) continue;
    c.seps = [];
    for(let k=0; k<rows.length-1; k++){
      const a = rows[k], b = rows[k+1];
      const yb = Math.max(...kids.filter(t=>t.n.r0===a).map(t => t.y + t.h));
      if(b !== a + 1 && sc.Y(b) - yb > 6) continue;               // a spacer row already separates them
      c.seps.push(yb);
    }
  }
  return sc;
}
function inside4(o, c){ return o.x >= c.x - 2 && o.y >= c.y - 2 && o.x + o.w <= c.x + c.w + 2 && o.y + o.h <= c.y + c.h + 2; }

/* ============================================================================================
   LIQUID GLASS THEME — material translation
   (the slide keeps the Excel geometry; fills, borders and inks are mapped to glass materials)
   ============================================================================================ */
function mixWhite(hex, t){ const [r,g,b] = RGB(hex); const f = v => Math.round(255 + (v - 255) * t); return `${f(r)},${f(g)},${f(b)}`; }
function tintGrad(hex, strength, alpha=.8){ return `--tint:linear-gradient(180deg,rgba(${mixWhite(hex, strength)},${alpha}),rgba(${mixWhite(hex, strength*1.25)},${alpha-.08}))`; }
/* a deep, readable ink of the same hue (white text on a dark fill becomes dark-hued text on tinted glass) */
function deepInk(hex){ let [h, s, l] = hexToHsl(hex.replace("#","")); return "#" + hslToHex(h, Math.min(1, s*1.1 + .08), Math.min(.3, l*.75)); }

function renderGlass(L, opts={}){
  const G0 = glassGeom(L);
  const sc = inferRoles(buildScene(L, effItems(L).map(it => gItem(it, G0))));    // Glass geometry (columns widened for the system font)
  const rowMed = median(L.rows.map(r => L.rowH.get(r))) || 20;
  let shells = "", lines = "", caps = "", pics = "", texts = "", tbx = "";
  const R = (x, y, w, h) => `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${Math.max(0,w).toFixed(1)}px;height:${Math.max(0,h).toFixed(1)}px`;
  const glass = (cls, x, y, w, h, rad, extra="") => `<div class="gls wb ${cls}" style="${R(x,y,w,h)};border-radius:${Math.max(0,rad).toFixed(1)}px;${extra}"></div>`;

  /* ---- containers → materials ---- */
  const tinted = new Map();          // container → {color} when its children sit on a coloured material
  const order = sc.containers.slice().sort((a,b) => (a.depth||0) - (b.depth||0) || sc.area(b) - sc.area(a));
  for(const c of order){
    const depth = c.depth || 0, small = c.h <= rowMed * 1.7 && c.cells !== 99;
    const fill = c.kind==="surface" ? c.color : c.fill, cls = fill ? fillClass(fill) : null;
    const pad = depth===0 && !small ? 10 : 0, inset = small || depth > 0 ? 2.5 : 0;
    let x = c.x - pad + inset, y = c.y - pad*.6 + inset, w = c.w + 2*pad - 2*inset, h = c.h + 1.2*pad - 2*inset;
    const rad = small ? Math.min(h/2, 13) : Math.max(8, Math.min(26 - depth*6, h/2, w/2));
    if(c.kind==="surface" && cls==="white" && depth===0) continue;                       // white on white: nothing to draw
    let mat, extra = "";
    if(cls==="dark"){ mat = depth===0 ? "card tinted" : "panel tinted"; extra = tintGrad(fill, .32, .88); tinted.set(c, fill); }
    else if(cls==="grey" || cls==="color"){ mat = small ? "chip tinted" : (depth===0 ? "card tinted" : "panel tinted"); extra = tintGrad(fill, small ? .42 : .34, .86); tinted.set(c, fill); }
    else if(cls==="light"){ mat = small ? "chip tinted" : "panel tinted"; extra = tintGrad(fill, .9, .86); }
    else if(cls==="white"){ mat = small ? "chip" : "panel"; }
    else if(c.kind==="implicit" || c.kind==="grid"){ mat = depth===0 ? "card list" : "panel"; }
    else if(c.kind==="frame" && small && c.cells > 1){ mat = depth===0 ? "card tile" : "panel"; }
    else if(c.kind==="frame"){ mat = small ? "chip" : (depth===0 ? "card list" : "panel"); }
    else mat = depth===0 ? "card list" : "panel";
    // a coloured border is a signal (e.g. green/red outline of a value box): keep it as a ring
    const st = c.stroke && c.stroke.color, stTone = st ? tone(st) : null;
    const vivid = st && stTone==="other" && satOf(st) > .45 && lum(st) > .3 && lum(st) < .8;      // bright accent outline
    if(stTone==="pos" || stTone==="neg" || vivid) extra += `;box-shadow:inset 0 0 0 1.5px ${rgba(st, .75)},0 2px 6px -3px rgba(28,40,100,.25)`;
    if((c.kind==="frame" || c.kind==="grid") && !fill && depth > 0 && !small) mat = "panel";
    shells += glass(mat, x, y, w, h, rad, extra);
    c.drawn = {x, y, w, h};
  }

  /* ---- lines: heading underlines (accent), separators and ruled grids (hairlines) ---- */
  for(const r of sc.rules){
    if(r.dir==="h"){
      if(r.heading) lines += `<div class="rule accent" style="${R(r.x, r.y - 1, r.w, 2)}"></div>`;
      else lines += `<div class="hsep" style="${R(r.x + 6, r.y, r.w - 12, 1)}"></div>`;
    } else if(r.sep || (r.parent && r.parent.kind==="grid")) lines += `<div class="vsep" style="${R(r.x, r.y + 5, 1, r.h - 10)}"></div>`;
  }
  for(const c of sc.containers) if(c.seps) for(const y of c.seps) lines += `<div class="hsep" style="${R(c.x + 12, y, c.w - 24, 1)}"></div>`;
  // a merged title over several columns (group header) gets a hairline under it
  for(const t of sc.texts) if(t.it.merged && t.n.c1 > t.n.c0 && t.n.r1===t.n.r0 && sc.texts.some(o => o.n.r0===t.n.r1+1 && o.n.c0>=t.n.c0 && o.n.c1<=t.n.c1) && t.role!=="heading")
    lines += `<div class="hsep" style="${R(t.x + 14, t.y + t.h - 1, t.w - 28, 1)}"></div>`;

  /* ---- signals: conditional / semantic colours become capsules ---- */
  const capOf = new Map();
  for(const s of sc.signals){
    const it = s.it, ft = tone(it.fill) || (it.cf && it.cf.fill ? tone(it.cf.fill) : null) || "other";
    const holder = s.parent && s.parent.kind==="frame" && s.parent.cells===1 ? s.parent : null;
    const box = holder && holder.drawn ? holder.drawn : {x: it.bx + 3, y: it.by + 3.5, w: it.bw - 6, h: it.bh - 7};
    const rad = Math.min(box.h/2, holder ? 13 : 99);
    const strong = s.parent && (s.parent.kind==="frame" && s.parent.cells > 1 && sc.texts.some(t => t.parent===s.parent && t.role==="emphasis"));
    if(ft==="pos" || ft==="neg") caps += `<div class="cap ${strong ? "solid " : ""}${ft}" style="${R(box.x, box.y, box.w, box.h)};border-radius:${rad}px"></div>`;
    else { const base = it.fill || "#8E8E93"; caps += `<div class="cap" style="${R(box.x, box.y, box.w, box.h)};border-radius:${rad}px;background:linear-gradient(180deg,${rgba(base,.55)},${rgba(base,.38)})"></div>`; }
    capOf.set(it, {tone: ft, strong, fill: it.fill});
  }

  /* ---- media ---- */
  for(const p of sc.media){
    const meta = IMGMETA.get(p.src) || {}, cy = p.y + p.h/2;
    const row = L.rows.find(r => cy >= L.rowY.get(r) && cy < L.rowY.get(r) + L.rowH.get(r));
    const rh = row ? L.rowH.get(row) : p.h;
    if(meta.round && Math.max(p.w,p.h) <= rh*1.6 && !p.rot && !(p.crop && (p.crop.l||p.crop.t||p.crop.r||p.crop.b))){
      const d = Math.min(Math.max(p.w,p.h), rh - 7), ry = row ? L.rowY.get(row) + rh/2 : cy;
      pics += `<div class="gls wb icon" style="left:${p.x + p.w/2 - d/2 - 2.5}px;top:${ry - d/2 - 2.5}px;width:${d+5}px;height:${d+5}px;border-radius:50%"><img src="${p.src}" alt=""></div>`;
    } else if(meta.keyed) pics += picHtml(Object.assign({}, p, {src: meta.keyed}), "gcut");   // white-background graphics: background keyed out
    else pics += picHtml(p, meta.alpha ? "gcut" : "gpic");
  }
  for(const tb of sc.tboxes){
    const r = Math.min(18, Math.min(tb.w, tb.h)/2);
    if(tb.fill || tb.line) tbx += glass("card list", tb.x, tb.y, tb.w, tb.h, r, tb.fill && !isWhiteish(tb.fill) ? tintGrad(tb.fill, .5, .9) : "");
    tbx += `<div class="tbox gtb" style="${R(tb.x, tb.y, tb.w, tb.h)};justify-content:${tb.anchorV==="ctr"?"center":tb.anchorV==="b"?"flex-end":"flex-start"};${shapeTransform(tb)}">${textboxInner(tb, null, c => tone(c)==="neg" ? SYS.redInk : tone(c)==="pos" ? SYS.greenInk : lum(c) < .45 || lum(c) > .93 ? SYS.label : darken(c,.7))}</div>`;
  }

  /* ---- texts: weight and ink from the role and the material behind ---- */
  const WEIGHT = {heading:720, "heading-s":680, section:720, label:640, emphasis:740, value:520, text:500, caption:500};
  for(const t of sc.texts){
    if(opts.noText) break;
    const it = t.it, f = it.font, role = t.role, cap = capOf.get(it);
    let ink;
    const bgTint = t.bg && t.bg.c && tinted.get(t.bg.c);
    const own = it.nfColor || f.color || "#000000", ownTone = tone(own);
    if(it.userColor) ink = it.userColor;
    else if(cap) ink = (cap.tone==="pos" || cap.tone==="neg") ? (cap.strong ? "#FFFFFF" : cap.tone==="pos" ? SYS.greenInk : SYS.redInk) : (lum(cap.fill||"#999") < .55 ? "#FFFFFF" : SYS.label);
    else if(it.ctype==="e") ink = SYS.label3;
    else if(ownTone==="neg") ink = SYS.redInk;
    else if(ownTone==="pos") ink = SYS.greenInk;
    else if(bgTint && (lum(own) > .7 || role==="label" || role==="section")) ink = deepInk(bgTint);
    else if(role==="caption") ink = lum(own) < .35 ? SYS.label2 : (ownTone==="other" ? darken(own, .85) : SYS.label3);
    else if(lum(own) > .82) ink = SYS.label;
    else if(ownTone==="other") ink = lum(own) > .55 ? darken(own, .7) : own;
    else ink = lum(own) < .35 ? SYS.label : SYS.label2;
    let weight = WEIGHT[role] || 500;
    if(it.userB===true) weight = Math.max(weight, 720); else if(it.userB===false) weight = Math.min(weight, 470);
    else if(f.b && weight < 650) weight = 650;
    const tw = it.tw || it.bw, single = !it.wrap && it.valign!=="top" && !it.rot;
    const st = [R(it.bx, it.by, tw, it.bh), `font-size:${fitPx(it, (f.sz||11)*96/72*.97, tw).toFixed(2)}px`, `color:${ink}`, `font-weight:${weight}`,
      single ? `line-height:${it.bh}px;display:block` : `justify-content:${it.align==="right"?"flex-end":it.align==="center"?"center":"flex-start"};align-items:${it.valign==="top"?"flex-start":"center"}`, `text-align:${it.align}`];
    if(it.indent) st.push(`padding-left:${9+it.indent*9}px`); else if(it.align==="left") st.push("padding-left:10px"); else if(it.align==="right") st.push("padding-right:10px");
    if(role==="caption" || it.userI===true || (f.i && it.userI!==false && role!=="value")) st.push("font-style:italic");
    if(t.num) st.push("font-variant-numeric:tabular-nums");
    if(cap && cap.strong) st.push("text-shadow:0 1px 1px rgba(0,0,0,.2)");
    const cls = ["t", it.wrap ? "wrap" : "", it.ov ? "ov" : ""].filter(Boolean).join(" ");
    if(it.rot){ texts += `<div class="t ov" style="${st.join(";")};${rotBox()}">${rotSpan(it.rot, it.text)}</div>`; continue; }
    texts += `<div class="${cls}" style="${st.join(";")}">${esc(it.text)}</div>`;
  }
  return `<div class="xt gx" style="width:${sc.G.W}px;height:${L.H}px">${shells}${lines}${caps}${pics}${texts}${tbx}</div>`;
}
/* Excel text rotation: 1–90 counter-clockwise, 91–180 clockwise, 255 stacked letters */
function rotBox(){ return "display:flex;align-items:center;justify-content:center;line-height:1.1"; }
function rotSpan(rot, text){
  if(rot===255) return `<span style="writing-mode:vertical-rl;text-orientation:upright">${esc(text)}</span>`;
  const deg = rot <= 90 ? -rot : rot - 90;
  return `<span style="display:inline-block;white-space:nowrap;transform:rotate(${deg}deg)">${esc(text)}</span>`;
}

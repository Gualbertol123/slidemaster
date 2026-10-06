/* ============================================================================================
   Presets: which tables exist (x markers or ranges you picked) and which slides show them.
   SETTINGS.presets[file] = {version:3, sheets:[...], tables:[def...], slides:[slide...], updated}
     def   = {id, sheet, kind:"markers", anchor:"B3", index} | {id, sheet, kind:"range", range:"C4:T56", grow}
     slide = {id, type:"cover"|"index"|"content", title, subtitle, date, note, tables:[ids], layout}
   Cell edits stay per sheet in SETTINGS.files[file][sheet].cells, so they follow a table to any slide.
   ============================================================================================ */
const uid = () => Math.random().toString(36).slice(2, 9);
const SLIDE_RX = /slide/i;
function presetOf(name){ return (SETTINGS.presets || {})[name] || null; }
function savePreset(name, p){ SETTINGS.presets = SETTINGS.presets || {}; p.version = 3; p.updated = Date.now(); SETTINGS.presets[name] = p; }
const visibleSheets = wb => wb.sheets.filter(S => !S.hidden);
const rangeToG = range => { const g = parseRange(range.toUpperCase().replace(/\$/g,"")); return {r1:Math.min(g.r1,g.r2)-1, c1:Math.min(g.c1,g.c2)-1, r2:Math.max(g.r1,g.r2)+1, c2:Math.max(g.c1,g.c2)+1}; };
const gToRange = g => A1(g.r1+1, g.c1+1) + ":" + A1(g.r2-1, g.c2-1);
const validRange = r => /^\$?[A-Z]{1,3}\$?\d{1,7}(:\$?[A-Z]{1,3}\$?\d{1,7})?$/i.test(String(r||"").trim());

function cellHasData(S, r, c){ const x = S.get(r, c); return !!(x && x.t!=="blank" && String(x.v).trim()!=="" && String(x.v).trim().toLowerCase()!=="x"); }
function growG(S, g){
  // "grows with new rows": extend downwards while the next row still has data inside the table's columns
  let r = g.r2, guard = 0;
  while(guard++ < 2000){ let any = false; for(let c=g.c1+1; c<g.c2; c++) if(cellHasData(S, r, c)){ any = true; break; } if(!any) break; r++; }
  return Object.assign({}, g, {r2: r});
}
const LCACHE = new Map();
function resolveTable(wb, def){
  const S = wb.sheets.find(s => s.name===def.sheet); if(!S) return null;
  let L = null;
  if(def.kind==="markers"){
    L = S.tables.find(T => A1(T.g.r1, T.g.c1)===def.anchor) || S.tables[def.index] || null;
  } else if(validRange(def.range)){
    let g = rangeToG(def.range); if(def.grow) g = growG(S, g);
    const key = S.name + "|" + JSON.stringify(g);
    if(!LCACHE.has(key) || LCACHE.get(key).wb!==wb) LCACHE.set(key, {wb, L: buildLayout(S, g)});
    L = LCACHE.get(key).L;
  }
  if(!L) return null;
  L.sheet = S; L.def = def; L.id = def.id;
  L.items.forEach(it => { it.L = L; });
  return L;
}
function tableName(L){
  if(L.def && L.def.name) return L.def.name;
  const base = L.sheet.title || L.sheet.name, P = presetOf(DOC.name);
  const many = P && P.tables.filter(t => t.sheet===L.sheet.name).length > 1;
  return many ? base + " · " + gToRange(L.g) : base;
}

/* default preset for a workbook opened for the first time (x-marker tables + any earlier sheet choice) */
function defaultPreset(wb, name){
  const legacy = (SETTINGS.sheets || {})[name];
  const withTables = visibleSheets(wb).filter(S => S.tables.length);
  let chosen = legacy && Array.isArray(legacy.selected) ? withTables.filter(S => legacy.selected.includes(S.name)) : [];
  if(!chosen.length) chosen = withTables.filter(S => SLIDE_RX.test(S.name));
  if(!chosen.length) chosen = withTables;
  const tables = [], slides = [];
  for(const S of chosen){
    const ids = S.tables.map((T,i) => { const id = uid(); tables.push({id, sheet:S.name, kind:"markers", anchor:A1(T.g.r1,T.g.c1), index:i}); return id; });
    const old = SETTINGS.files[name] && SETTINGS.files[name][S.name] && SETTINGS.files[name][S.name].layouts;
    const sig = S.tables.map(t=>t.rows.length+"x"+t.cols.length).join(",");
    slides.push({id:uid(), type:"content", title:null, subtitle:null, tables:ids, layout: old && old[sig] ? old[sig] : null});
  }
  const sheets = (wb.meta || visibleSheets(wb)).filter(x => SLIDE_RX.test(x.name) || chosen.some(S => S.name===x.name)).map(x => x.name);
  return {version:3, sheets, tables, slides};
}

/* runtime slides */
function runtimeSlides(wb, preset){
  const T = {};
  for(const def of preset.tables || []){ const L = resolveTable(wb, def); if(L) T[def.id] = L; }
  return (preset.slides || []).map(ps => {
    const tables = (ps.tables || []).map(id => T[id]).filter(Boolean);
    const S0 = tables[0] && tables[0].sheet;
    const sameSheet = tables.length && tables.every(L => L.sheet===S0);
    const R = {id: ps.id, type: ps.type || "content", cfg: ps, tables, missing: (ps.tables||[]).filter(id => !T[id]).length};
    if(R.type==="cover"){ R.title = ps.title || DOC.name.replace(/\.[^.]+$/,""); R.subtitle = ps.subtitle || ""; R.label = "Cover"; }
    else if(R.type==="index"){ R.title = ps.title || "Contents"; R.subtitle = ps.subtitle || ""; R.label = "Index"; }
    else {
      R.title = ps.title || (S0 ? (S0.title || S0.name) : "New slide");
      const a2inTable = sameSheet && tables.some(L => 2 > L.g.r1 && 2 < L.g.r2 && 1 > L.g.c1 && 1 < L.g.c2);
      R.subtitle = ps.subtitle!=null && ps.subtitle!=="" ? ps.subtitle : (sameSheet && !a2inTable ? S0.subtitle : "");
      R.label = ps.title || (S0 ? S0.name : "Empty slide");
    }
    return R;
  });
}
const contentSlides = () => DOC.slides.filter(R => R.type==="content");

/* ----------------------------------------------------------------------------- cover & index ---- */
function todayLabel(){ return new Date().toLocaleDateString("en-GB", {day:"numeric", month:"long", year:"numeric"}); }
function coverTitleSize(t){ const n = String(t||"").length; return n > 52 ? 52 : n > 40 ? 60 : n > 28 ? 68 : 80; }
function coverHtml(R, glassy){
  const c = R.cfg, date = c.date || todayLabel(), note = c.note || "", t = R.title || "", fs = coverTitleSize(t);
  if(glassy) return `
    <div class="gls wb chrome cv-orb" style="left:1000px;top:96px;width:560px;height:560px;border-radius:50%"></div>
    <div class="gls wb chrome cv-tile" style="left:900px;top:470px;width:290px;height:290px;border-radius:76px"></div>
    <div class="gls wb chrome cv-orb small" style="left:1300px;top:540px;width:220px;height:220px;border-radius:50%"></div>
    <div class="cv-block g">
      ${note ? `<div class="cv-kicker">${esc(note)}</div>` : ""}
      <div class="cv-title" data-edit="title" style="font-size:${fs}px">${esc(t)}</div>
      <div class="cv-bar"></div>
      <div class="cv-sub" data-edit="subtitle">${esc(R.subtitle || "")}</div>
    </div>
    <div class="gls wb chrome cv-chip" style="left:120px;top:742px;width:${Math.round(56 + date.length*11.5)}px;height:52px;border-radius:26px"><span>${esc(date)}</span></div>`;
  return `
    <div class="cvx-panel"><div class="cvx-band"></div><div class="cvx-band b2"></div></div>
    <div class="cv-block x">
      ${note ? `<div class="cv-kicker">${esc(note)}</div>` : ""}
      <div class="cv-title" data-edit="title" style="font-size:${fs}px">${esc(t)}</div>
      <div class="cv-bar"></div>
      <div class="cv-sub" data-edit="subtitle">${esc(R.subtitle || "")}</div>
    </div>
    <div class="cvx-rule"></div><div class="cvx-date">${esc(date)}</div>`;
}
function indexHtml(R, idx, glassy){
  const items = [];
  DOC.slides.forEach((S, i) => { if(S.type==="content") items.push({n: items.length + 1, title: S.title, sub: S.subtitle || "", page: String(pageNumber(i))}); });
  if(!items.length) return `<div class="ix-empty">No content slides yet</div>`;
  const two = items.length > 7, per = two ? Math.ceil(items.length/2) : items.length;
  const top0 = R.subtitle ? 150 : 132, avail = 812 - top0 - 28;
  const rowH = Math.min(per <= 4 ? 112 : 96, Math.floor(avail / per)), fs = Math.max(16, Math.min(30, Math.round(rowH * .29))), badge = Math.min(50, rowH - 18);
  const colW = two ? 690 : 1060, x0 = two ? 90 : 270;
  const top = top0 + Math.max(0, (avail - per*rowH - 28) * .42);          // few entries: the list sits in the optical centre
  let h = "";
  [items.slice(0, per), items.slice(per)].forEach((list, k) => {
    if(!list.length) return;
    const x = x0 + k*(colW + 40), H = list.length*rowH + 28;
    if(glassy) h += `<div class="gls wb chrome card ix-card" style="left:${x}px;top:${top}px;width:${colW}px;height:${H}px;border-radius:30px"></div>`;
    list.forEach((it, j) => {
      const y = top + 14 + j*rowH;
      h += `<div class="ix-row${glassy ? " g" : " x"}" style="left:${x+24}px;top:${y}px;width:${colW-48}px;height:${rowH}px;font-size:${fs}px">
        <span class="ix-n" style="width:${badge}px;height:${badge}px;line-height:${badge}px;font-size:${Math.round(badge*.38)}px">${String(it.n).padStart(2,"0")}</span>
        <span class="ix-txt"><span class="ix-t">${esc(it.title)}</span>${it.sub ? `<span class="ix-s">${esc(it.sub)}</span>` : ""}</span>
        <span class="ix-lead"></span><span class="ix-p">${esc(it.page)}</span></div>`;
      if(j < list.length - 1) h += `<div class="ix-sep${glassy ? " g" : ""}" style="left:${x + 24 + badge + 22}px;top:${y + rowH}px;width:${colW - 72 - badge - 22}px"></div>`;
    });
  });
  return h;
}

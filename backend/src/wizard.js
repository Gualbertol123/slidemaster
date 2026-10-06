/* ============================================================================================
   Editing wizard  — 1 Sheets · 2 Tables · 3 Slides
   ============================================================================================ */
function usedRange(S){
  let r2 = 1, c2 = 1;
  for(const x of S.cells.values()){ if((x.t!=="blank" && String(x.v??"").trim()!=="") || (x.xf && x.xf.fill)){ if(x.r>r2) r2 = x.r; if(x.c>c2) c2 = x.c; } }
  return {r2: Math.min(r2, 400), c2: Math.min(c2, 80), clipped: r2>400 || c2>80};
}
/* table detection: blocks of filled cells (one empty row is bridged; an empty column separates tables) */
function detectTables(S){
  const occ = new Map(), U = usedRange(S);
  for(const x of S.cells.values()){
    if(x.r>U.r2 || x.c>U.c2 || S.rowHidden(x.r) || S.colHidden(x.c)) continue;
    const has = (x.t!=="blank" && String(x.v??"").trim()!=="" && String(x.v).trim().toLowerCase()!=="x") || (x.xf && x.xf.fill && tone(x.xf.fill));
    if(has && !(x.r===1 && x.c===1)) occ.set(x.r+","+x.c, x);
  }
  const seen = new Set(), boxes = [];
  for(const [k, x] of occ){
    if(seen.has(k)) continue;
    const q = [x]; seen.add(k); let b = {r1:x.r, c1:x.c, r2:x.r, c2:x.c, n:0};
    while(q.length){
      const p = q.pop(); b.n++; b.r1 = Math.min(b.r1,p.r); b.r2 = Math.max(b.r2,p.r); b.c1 = Math.min(b.c1,p.c); b.c2 = Math.max(b.c2,p.c);
      for(let dr=-2; dr<=2; dr++) for(let dc=-1; dc<=1; dc++){
        if(!dr && !dc) continue;
        let rr = p.r+dr, cc = p.c+dc, key = rr+","+cc;
        if(occ.has(key) && !seen.has(key)){ seen.add(key); q.push(occ.get(key)); }
      }
    }
    if(b.r2-b.r1 >= 1 && b.c2-b.c1 >= 1 && b.n >= 4) boxes.push(b);
  }
  // merge overlapping boxes
  let merged = true;
  while(merged){ merged = false;
    for(let i=0;i<boxes.length && !merged;i++) for(let j=i+1;j<boxes.length;j++){ const a = boxes[i], c = boxes[j];
      if(a.r1<=c.r2 && a.r2>=c.r1 && a.c1<=c.c2 && a.c2>=c.c1){ boxes[i] = {r1:Math.min(a.r1,c.r1), c1:Math.min(a.c1,c.c1), r2:Math.max(a.r2,c.r2), c2:Math.max(a.c2,c.c2), n:a.n+c.n}; boxes.splice(j,1); merged = true; break; } } }
  return boxes.sort((a,b)=>a.r1-b.r1 || a.c1-b.c1).map(b => A1(b.r1,b.c1)+":"+A1(b.r2,b.c2));
}
const defRange = (S, d) => d.kind==="markers" ? (() => { const T = S.tables.find(t => A1(t.g.r1,t.g.c1)===d.anchor) || S.tables[d.index]; return T ? gToRange(T.g) : null; })() : d.range;

function presetBox(name, preset){
  return new Promise(resolve => {
    const content = preset.slides.filter(s => (s.type||"content")==="content").length;
    const extras = [preset.slides.some(s=>s.type==="cover") ? "cover" : "", preset.slides.some(s=>s.type==="index") ? "index" : ""].filter(Boolean);
    const dlg = document.createElement("div"); dlg.className = "modal";
    dlg.innerHTML = `<div class="dlg" style="width:min(520px,92vw)">
      <div class="dlghd"><b>Saved preset found</b><span>${esc(name)}</span></div>
      <div style="padding:4px 18px 14px;line-height:1.55">${content} content slide${content===1?"":"s"}${extras.length?" + "+extras.join(" and ")+" slide":""} · ${preset.tables.length} table${preset.tables.length===1?"":"s"} from ${new Set(preset.tables.map(t=>t.sheet)).size} sheet(s).<br><span style="color:var(--mute);font-size:12px">Last edited ${preset.updated ? new Date(preset.updated).toLocaleString() : "—"}</span></div>
      <div class="dlgft"><button class="btn" data-a="cancel">Cancel</button><span style="flex:1"></span><button class="btn" data-a="wizard">Open editing wizard</button><button class="btn primary" data-a="go">Continue with preset</button></div></div>`;
    document.body.appendChild(dlg);
    const done = v => { dlg.remove(); document.removeEventListener("keydown", key, true); resolve(v); };
    const key = e => { if(e.key==="Escape"){ e.stopPropagation(); done(null); } if(e.key==="Enter"){ e.stopPropagation(); e.preventDefault(); done("continue"); } };
    document.addEventListener("keydown", key, true);
    dlg.querySelector('[data-a="go"]').onclick = () => done("continue");
    dlg.querySelector('[data-a="wizard"]').onclick = () => done("wizard");
    dlg.querySelector('[data-a="cancel"]').onclick = () => done(null);
    setTimeout(() => dlg.querySelector('[data-a="go"]').focus(), 30);
  });
}

function runWizard(wb, name, preset){
  return new Promise(resolve => {
    const P = JSON.parse(JSON.stringify(preset || {sheets:[], tables:[], slides:[]}));
    // every visible worksheet is listed from the workbook's table of contents; a sheet is only read once it is chosen
    const meta = wb.meta || visibleSheets(wb).map(S => ({name:S.name, size:S.size||0}));
    const inMeta = n => meta.some(m => m.name===n);
    const byName = n => wb.sheets.find(S => S.name===n);
    const W = {
      step: 1,
      sheets: new Set((P.sheets && P.sheets.length ? P.sheets : P.tables.map(t=>t.sheet)).filter(inMeta)),
      tables: P.tables.filter(t => inMeta(t.sheet)),
      slides: P.slides.filter(s => (s.type||"content")==="content").map(s => Object.assign({}, s, {type:"content"})),
      cover: Object.assign({enabled:false, title:"", subtitle:"", date:"", note:""}, (() => { const c = P.slides.find(s=>s.type==="cover"); return c ? Object.assign({enabled:true}, c) : {}; })()),
      index: Object.assign({enabled:false, title:"Contents"}, (() => { const c = P.slides.find(s=>s.type==="index"); return c ? Object.assign({enabled:true}, c) : {}; })()),
      cur: null, sel: null, suggest: {}, focusSlide: null, grids: {}
    };
    if(!W.sheets.size) meta.filter(m => SLIDE_RX.test(m.name) && !(byName(m.name)||{}).error).forEach(m => W.sheets.add(m.name));
    const root = document.createElement("div"); root.className = "wiz";
    document.body.appendChild(root);
    const close = v => { root.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
    const onKey = e => { if(e.key==="Escape" && !e.target.matches("input")){ e.stopPropagation(); if(confirm("Close the wizard without saving?")) close(null); } };
    document.addEventListener("keydown", onKey, true);

    const sheetsChosen = () => wb.sheets.filter(S => W.sheets.has(S.name));
    const tablesOf = n => W.tables.filter(t => t.sheet===n);
    const usedIn = id => W.slides.filter(s => s.tables.includes(id)).length;
    const tLabel = t => { if(t.name) return t.name; const S = byName(t.sheet), base = (S && S.title) || t.sheet;
      return tablesOf(t.sheet).length > 1 ? base + " · " + (defRange(S, t) || "") : base; };

    function frame(body, foot){
      root.innerHTML = `<div class="wizbox">
        <div class="wizhd"><b>Editing wizard</b><span>${esc(name)}</span>
          <ol class="steps">${["Sheets","Tables","Slides"].map((s,i)=>`<li class="${W.step===i+1?"on":W.step>i+1?"done":""}" data-go="${i+1}">${i+1} · ${s}</li>`).join("")}</ol>
          <button class="btn icon" data-x="close" title="Close">✕</button></div>
        <div class="wizbody">${body}</div>
        <div class="wizft">${foot}</div></div>`;
      root.querySelector('[data-x="close"]').onclick = () => { if(confirm("Close the wizard without saving?")) close(null); };
      root.querySelectorAll("[data-go]").forEach(li => li.onclick = () => { const s = +li.dataset.go; if(s < W.step || (s===2 && W.sheets.size) || (s===3 && W.sheets.size)) go(s); });
    }
    async function ensureChosen(){
      if(!wb.ensure) return;
      try{
        const added = await wb.ensure([...W.sheets], showBusy);
        for(const S of added){   // sheets with “x” markers bring their tables along
          if(S.tables && S.tables.length && !W.tables.some(t => t.sheet===S.name))
            S.tables.forEach((T,i) => W.tables.push({id:uid(), sheet:S.name, kind:"markers", anchor:A1(T.g.r1,T.g.c1), index:i}));
        }
      } finally { hideBusy(); }
    }
    async function go(s){
      if(s >= 2){ try{ await ensureChosen(); }catch(e){ alert("Could not read the sheets: " + (e.message||e)); return; } }
      W.step = s; if(s===2 && (!W.cur || !W.sheets.has(W.cur))) W.cur = sheetsChosen()[0]?.name || null; if(s===3) syncSlides(); render();
    }
    function render(){ W.step===1 ? stepSheets() : W.step===2 ? stepTables() : stepSlides(); }

    /* ---------- step 1: sheets (hidden sheets stay hidden) */
    function stepSheets(){
      const rows = meta.map(m => {
        const S = byName(m.name), sz = m.size ? `<span class="sz">${fmtMB(m.size)}</span>` : "";
        if(!S) return `<label class="sheetrow"><input type="checkbox" value="${esc(m.name)}"${W.sheets.has(m.name)?" checked":""}>
          <span class="nm">${esc(m.name)}</span>${SLIDE_RX.test(m.name)?`<span class="chip">slide</span>`:""}${sz}
          <span class="meta">not read yet – it is read only if you select it</span></label>`;
        const U = usedRange(S), nT = S.tables.length;
        if(!W.suggest[S.name]) W.suggest[S.name] = detectTables(S);
        const nS = W.suggest[S.name].length, mine = tablesOf(S.name).length;
        if(S.error) return `<label class="sheetrow hid"><input type="checkbox" disabled><span class="nm">${esc(S.name)}</span><span class="chip red">could not be read</span><span class="meta">${esc(S.error)}</span></label>`;
        return `<label class="sheetrow"><input type="checkbox" value="${esc(S.name)}"${W.sheets.has(S.name)?" checked":""}>
          <span class="nm">${esc(S.name)}</span>${SLIDE_RX.test(S.name)?`<span class="chip">slide</span>`:""}${nT?`<span class="chip green">${nT} × table</span>`:""}${sz}
          <span class="meta">${esc(S.title || "—")} · used range A1:${A1(U.r2,U.c2)} · ${mine ? mine+" table(s) defined" : nS ? nS+" possible table(s) found" : "no table found"}</span></label>`;
      }).join("");
      const hiddenN = (wb.hiddenSheets || []).length, other = (wb.skipped || []).filter(x => x.why!=="hidden");
      const lazy = meta.some(m => !byName(m.name));
      frame(`<div class="wizcol"><p class="lead">Choose the sheets you want to work with. Sheets whose name contains “slide” are pre-selected${hiddenN?`; ${hiddenN} hidden sheet${hiddenN>1?"s are":" is"} not listed`:""}.${lazy ? `<br><b>Large workbook:</b> only the sheets you select are read – pick only what you need.` : ""}</p>
        <div class="dlgtools" style="padding:0 0 8px"><button class="btn" data-q="slide">Only “slide” sheets</button><button class="btn" data-q="all">All</button><button class="btn" data-q="none">None</button><span class="cnt"></span></div>
        <div class="sheetlist big">${rows}</div>${other.length ? `<p class="meta" style="margin-top:8px">Not listed: ${other.map(x => esc(x.name) + " (" + x.why + ")").join(", ")}</p>` : ""}</div>`,
        `<span class="hint">Next: pick the tables on each sheet.</span><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="next">Next · Tables</button>`);
      const boxes = [...root.querySelectorAll(".sheetrow input")];
      const paint = () => { const mb = meta.filter(m => W.sheets.has(m.name) && !byName(m.name)).reduce((s,m)=>s+m.size,0);
        root.querySelector(".cnt").textContent = `${W.sheets.size} of ${meta.length} selected` + (mb ? ` · ${fmtMB(mb)} to read` : "");
        root.querySelector('[data-a="next"]').disabled = !W.sheets.size; };
      boxes.forEach(b => b.onchange = () => { b.checked ? W.sheets.add(b.value) : W.sheets.delete(b.value); paint(); });
      root.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { W.sheets.clear(); meta.forEach(m => { if(!(byName(m.name)||{}).error && (b.dataset.q==="all" || (b.dataset.q==="slide" && SLIDE_RX.test(m.name)))) W.sheets.add(m.name); }); render(); });
      root.querySelector('[data-a="cancel"]').onclick = () => close(null);
      root.querySelector('[data-a="next"]').onclick = () => go(2);
      paint();
    }

    /* ---------- step 2: tables, picked on a spreadsheet view */
    function stepTables(){
      const chosen = sheetsChosen();
      const S = byName(W.cur);
      const tabs = chosen.map(s => `<button class="wtab${s.name===W.cur?" on":""}" data-s="${esc(s.name)}"><span>${esc(s.name)}</span><span class="badge2">${tablesOf(s.name).length}</span></button>`).join("");
      frame(`<div class="wiz2">
          <div class="wtabs">${tabs}</div>
          <div class="wgridwrap"><div class="wgrid" id="wgrid"></div></div>
          <div class="wside">
            <div class="wsel"><div class="lbl">Selection</div>
              <div class="row"><input id="wRange" placeholder="drag on the sheet, or type C4:T56" spellcheck="false"><button class="btn primary" id="wAdd">Add table</button></div>
              <label class="ck"><input type="checkbox" id="wGrow"> grows when rows are added below</label></div>
            <div class="wtools">${S && S.tables.length ? `<button class="btn" id="wMarkers">Use “x” tables (${S.tables.length})</button>` : ""}<button class="btn" id="wDetect">Add detected tables (${(W.suggest[W.cur]||[]).length})</button></div>
            <div class="lbl" style="margin-top:6px">Tables on this sheet</div>
            <div class="wtlist" id="wtlist"></div>
          </div></div>`,
        `<span class="hint">Drag across cells to select a table · dashed boxes are suggestions (click to add) · hidden rows/columns are skipped on the slide.</span><button class="btn" data-a="back">Back</button><button class="btn primary" data-a="next">Next · Slides</button>`);
      root.querySelectorAll(".wtab").forEach(b => b.onclick = () => { W.cur = b.dataset.s; W.sel = null; render(); });
      root.querySelector('[data-a="back"]').onclick = () => go(1);
      root.querySelector('[data-a="next"]').onclick = () => go(3);
      if(!S) return;
      if(!W.suggest[S.name]) W.suggest[S.name] = detectTables(S);
      // the spreadsheet view is built once per sheet and re-attached afterwards (adding/removing tables stays instant)
      if(W.grids[S.name]) root.querySelector("#wgrid").appendChild(W.grids[S.name]); else drawGrid(S);
      paintOverlays(S);
      paintTableList(S);
      const rIn = root.querySelector("#wRange");
      rIn.addEventListener("keydown", e => { e.stopPropagation(); if(e.key==="Enter") root.querySelector("#wAdd").click(); });
      rIn.addEventListener("input", () => { if(validRange(rIn.value)){ const g = rangeToG(rIn.value); W.sel = {r1:g.r1+1, c1:g.c1+1, r2:g.r2-1, c2:g.c2-1}; paintOverlays(S); } });
      root.querySelector("#wAdd").onclick = () => {
        const v = rIn.value.trim().toUpperCase();
        if(!validRange(v)){ rIn.classList.add("bad"); setTimeout(()=>rIn.classList.remove("bad"), 900); return; }
        W.tables.push({id:uid(), sheet:S.name, kind:"range", range:v, grow: root.querySelector("#wGrow").checked});
        W.sel = null; rIn.value = ""; render();
      };
      const mk = root.querySelector("#wMarkers");
      if(mk) mk.onclick = () => { S.tables.forEach((T,i) => { const a = A1(T.g.r1,T.g.c1); if(!W.tables.some(t => t.sheet===S.name && t.kind==="markers" && t.anchor===a)) W.tables.push({id:uid(), sheet:S.name, kind:"markers", anchor:a, index:i}); }); render(); };
      root.querySelector("#wDetect").onclick = () => { (W.suggest[S.name]||[]).forEach(r => { if(!W.tables.some(t => t.sheet===S.name && defRange(S,t)===r)) W.tables.push({id:uid(), sheet:S.name, kind:"range", range:r, grow:false}); }); render(); };
    }
    function drawGrid(S){
      const U = usedRange(S), R2 = Math.max(U.r2 + 3, 20), C2 = Math.max(U.c2 + 2, 10);
      const cw = c => S.colHidden(c) ? 5 : Math.max(26, Math.min(220, Math.round(S.colPx(c)*0.82)));
      const rh = r => S.rowHidden(r) ? 5 : Math.max(18, Math.min(60, Math.round(S.rowPx(r)*0.9)));
      let h = `<table class="xs"><colgroup><col style="width:38px">`;
      for(let c=1;c<=C2;c++) h += `<col style="width:${cw(c)}px">`;
      h += `</colgroup><thead><tr><th class="corner"></th>`;
      for(let c=1;c<=C2;c++) h += `<th class="${S.colHidden(c)?"hid":""}" title="${S.colHidden(c)?"hidden column ":""}${numToCol(c)}">${S.colHidden(c)?"":numToCol(c)}</th>`;
      h += `</tr></thead><tbody>`;
      for(let r=1;r<=R2;r++){
        const hr = S.rowHidden(r);
        h += `<tr style="height:${rh(r)}px" class="${hr?"hid":""}"><th title="${hr?"hidden row ":""}${r}">${hr?"":r}</th>`;
        for(let c=1;c<=C2;c++){
          const x = S.get(r,c), hc = S.colHidden(c);
          let txt = "", st = "";
          if(x && !hr && !hc){
            if(x.t!=="blank") txt = formatValue(x).text;
            const f = x.xf || {};
            if(f.fill) st += `background:${f.fill};`;
            if(f.font && f.font.color && f.font.color!=="#000000") st += `color:${f.font.color};`;
            if(f.font && f.font.b) st += "font-weight:700;";
            if(x.t==="n" || x.t==="d") st += "text-align:right;";
          }
          h += `<td data-r="${r}" data-c="${c}" class="${hr||hc?"hid":""}${String(txt).trim().toLowerCase()==="x"?" mk":""}" style="${st}">${esc(txt)}</td>`;
        }
        h += `</tr>`;
      }
      h += `</tbody></table><div class="wov" id="wov"></div>`;
      const grid = document.createElement("div"); grid.className = "wgrid-in"; grid.innerHTML = h;
      root.querySelector("#wgrid").appendChild(grid); W.grids[S.name] = grid;
      if(U.clipped) grid.insertAdjacentHTML("afterbegin", `<div class="clipnote">Showing A1:${A1(R2,C2)} – type larger ranges in the box on the right.</div>`);
      let anchor = null;
      const cellOf = e => { const td = e.target.closest("td[data-r]"); return td ? {r:+td.dataset.r, c:+td.dataset.c} : null; };
      grid.addEventListener("pointerdown", e => { const c = cellOf(e); if(!c) return; e.preventDefault(); anchor = c; W.sel = {r1:c.r, c1:c.c, r2:c.r, c2:c.c}; paintSelBox(S); });
      grid.addEventListener("pointerover", e => { if(!anchor || !(e.buttons&1)) return; const c = cellOf(e); if(!c) return; W.sel = {r1:Math.min(anchor.r,c.r), c1:Math.min(anchor.c,c.c), r2:Math.max(anchor.r,c.r), c2:Math.max(anchor.c,c.c)}; paintSelBox(S); });
      window.addEventListener("pointerup", () => { anchor = null; });
    }
    function boxFor(r1, c1, r2, c2){
      const grid = root.querySelector("#wgrid"); if(!grid) return null;
      const tl = grid.querySelector(`td[data-r="${r1}"][data-c="${c1}"]`) || null;
      const br = grid.querySelector(`td[data-r="${r2}"][data-c="${c2}"]`) || [...grid.querySelectorAll("td[data-r]")].pop();
      if(!tl || !br) return null;
      return {x: tl.offsetLeft, y: tl.offsetTop, w: br.offsetLeft + br.offsetWidth - tl.offsetLeft, h: br.offsetTop + br.offsetHeight - tl.offsetTop};
    }
    function paintSelBox(S){
      const ov = root.querySelector("#wov"); if(!ov) return;
      ov.querySelectorAll(".sel").forEach(e => e.remove());
      if(!W.sel) return;
      const b = boxFor(W.sel.r1, W.sel.c1, W.sel.r2, W.sel.c2); if(!b) return;
      ov.insertAdjacentHTML("beforeend", `<div class="ovb sel" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></div>`);
      const rIn = root.querySelector("#wRange"); if(rIn && document.activeElement!==rIn) rIn.value = A1(W.sel.r1,W.sel.c1) + ":" + A1(W.sel.r2,W.sel.c2);
    }
    function paintOverlays(S){
      const ov = root.querySelector("#wov"); if(!ov) return;
      let h = "";
      tablesOf(S.name).forEach((t, k) => {
        const r = defRange(S, t); if(!r) return; const g = rangeToG(r);
        const b = boxFor(g.r1+1, g.c1+1, g.r2-1, g.c2-1); if(!b) return;
        h += `<div class="ovb tbl" data-id="${t.id}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><span>T${k+1}${t.grow?" ↓":""}</span></div>`;
      });
      (W.suggest[S.name]||[]).forEach(r => {
        if(tablesOf(S.name).some(t => defRange(S,t)===r)) return;
        const g = rangeToG(r), b = boxFor(g.r1+1, g.c1+1, g.r2-1, g.c2-1); if(!b) return;
        h += `<div class="ovb sug" data-r="${r}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><button title="Add this table">+ ${r}</button></div>`;
      });
      ov.innerHTML = h;
      ov.querySelectorAll(".sug button").forEach(b => b.onclick = e => { e.stopPropagation(); W.tables.push({id:uid(), sheet:S.name, kind:"range", range:b.parentNode.dataset.r, grow:false}); render(); });
      ov.querySelectorAll(".tbl").forEach(b => b.onclick = () => { const el = root.querySelector(`.wtrow[data-id="${b.dataset.id}"]`); if(el){ el.scrollIntoView({block:"nearest"}); el.classList.add("flash"); setTimeout(()=>el.classList.remove("flash"), 900); } });
      paintSelBox(S);
    }
    function paintTableList(S){
      const box = root.querySelector("#wtlist");
      const list = tablesOf(S.name);
      box.innerHTML = list.length ? list.map((t,k) => {
        const r = defRange(S, t), L = resolveTable(wb, t), n = L ? L.rows.length*L.cols.length : 0;
        const dims = L ? `${L.rows.length}×${L.cols.length} visible` + (n > 3000 ? ` · <span style="color:var(--warn)">${n.toLocaleString()} cells – text will be very small on one slide and editing is slower; consider a smaller range</span>` : "") : "empty / not found";
        return `<div class="wtrow" data-id="${t.id}"><div class="row"><b>T${k+1}</b><input class="nmin" value="${esc(t.name||"")}" placeholder="${esc(S.title || S.name)}"><button class="btn icon del" title="Remove">✕</button></div>
          <div class="row">${t.kind==="markers" ? `<span class="rng">between “x” cells · ${esc(r||"?")}</span>` : `<input class="rgin" value="${esc(t.range)}" spellcheck="false"><label class="ck"><input type="checkbox" class="grow"${t.grow?" checked":""}> grows</label>`}</div>
          <div class="meta">${dims}${usedIn(t.id) ? ` · on ${usedIn(t.id)} slide(s)` : ""}</div></div>`;
      }).join("") : `<div class="meta" style="padding:8px 2px">No tables yet: drag across the cells of a table, or click a dashed suggestion.</div>`;
      box.querySelectorAll(".wtrow").forEach(row => {
        const t = W.tables.find(x => x.id===row.dataset.id);
        row.querySelector(".del").onclick = () => { W.tables = W.tables.filter(x => x!==t); W.slides.forEach(s => s.tables = s.tables.filter(id => id!==t.id)); render(); };
        row.querySelector(".nmin").onchange = e => { t.name = e.target.value.trim() || undefined; };
        row.querySelector(".nmin").addEventListener("keydown", e => e.stopPropagation());
        const rg = row.querySelector(".rgin");
        if(rg){ rg.addEventListener("keydown", e => e.stopPropagation()); rg.onchange = () => { const v = rg.value.trim().toUpperCase(); if(validRange(v)){ t.range = v; render(); } else { rg.classList.add("bad"); } }; }
        const gr = row.querySelector(".grow"); if(gr) gr.onchange = () => { t.grow = gr.checked; render(); };
        row.onmouseenter = () => root.querySelector(`.ovb.tbl[data-id="${t.id}"]`)?.classList.add("hl");
        row.onmouseleave = () => root.querySelector(`.ovb.tbl[data-id="${t.id}"]`)?.classList.remove("hl");
      });
    }

    /* ---------- step 3: slides */
    function syncSlides(){
      const keep = new Set(W.tables.filter(t => W.sheets.has(t.sheet)).map(t => t.id));
      W.tables = W.tables.filter(t => keep.has(t.id));
      W.slides.forEach(s => s.tables = s.tables.filter(id => keep.has(id)));
      if(!W.slides.length) oneSlidePerSheet();
    }
    function oneSlidePerSheet(){
      W.slides = sheetsChosen().filter(S => tablesOf(S.name).length).map(S => ({id:uid(), type:"content", title:null, subtitle:null, tables: tablesOf(S.name).map(t=>t.id), layout:null}));
    }
    function stepSlides(){
      const pool = sheetsChosen().filter(S => tablesOf(S.name).length).map(S => `<div class="pgrp"><div class="lbl">${esc(S.name)}</div>${tablesOf(S.name).map(t => {
        const L = resolveTable(wb, t); return `<div class="tchip${usedIn(t.id)?"":" free"}" draggable="true" data-id="${t.id}" title="Drag onto a slide, or click to add it to the highlighted slide"><b>${esc(tLabel(t))}</b><span>${L?L.rows.length+"×"+L.cols.length:"?"}${usedIn(t.id)?` · on ${usedIn(t.id)}`:" · unused"}</span></div>`; }).join("")}</div>`).join("");
      const slides = W.slides.map((s, i) => `<div class="scard${W.focusSlide===s.id?" focus":""}" data-id="${s.id}">
          <div class="row"><span class="sn">${i+1}</span><input class="stitle" value="${esc(s.title||"")}" placeholder="${esc(autoTitle(s))}"><button class="btn icon" data-m="up" title="Move up">↑</button><button class="btn icon" data-m="down" title="Move down">↓</button><button class="btn icon" data-m="del" title="Delete slide">✕</button></div>
          <div class="row"><input class="ssub" value="${esc(s.subtitle||"")}" placeholder="Subtitle (optional)"><label class="ck"><input type="checkbox" class="slogo"${s.logo===false?"":" checked"}> Logo</label></div>
          <div class="drop">${s.tables.map(id => { const t = W.tables.find(x=>x.id===id); return t ? `<span class="tchip in" draggable="true" data-id="${id}" data-from="${s.id}"><b>${esc(tLabel(t))}</b><button title="Remove from slide">✕</button></span>` : ""; }).join("") || `<span class="dropnote">Drop tables here</span>`}</div></div>`).join("");
      frame(`<div class="wiz3">
          <div class="pool"><div class="lbl" style="font-size:12px">TABLES</div>${pool || `<p class="meta">No tables defined. Go back to step 2.</p>`}</div>
          <div class="deck">
            <div class="extra">
              <label class="ck big"><input type="checkbox" id="cvOn"${W.cover.enabled?" checked":""}> Cover slide</label>
              <div class="extraf${W.cover.enabled?"":" off"}"><input id="cvTitle" value="${esc(W.cover.title||"")}" placeholder="${esc(name.replace(/\.[^.]+$/,""))}"><input id="cvSub" value="${esc(W.cover.subtitle||"")}" placeholder="Subtitle"><input id="cvDate" value="${esc(W.cover.date||"")}" placeholder="${esc(todayLabel())} (automatic)"><input id="cvNote" value="${esc(W.cover.note||"")}" placeholder="Small line above the title, e.g. IBD · Weekly update"><label class="ck"><input type="checkbox" id="cvLogo"${W.cover.logo===false?"":" checked"}> Logo</label></div>
              <label class="ck big"><input type="checkbox" id="ixOn"${W.index.enabled?" checked":""}> Index slide (list of slides with page numbers)</label>
              <div class="extraf${W.index.enabled?"":" off"}"><input id="ixTitle" value="${esc(W.index.title||"")}" placeholder="Contents"><label class="ck"><input type="checkbox" id="ixLogo"${W.index.logo===false?"":" checked"}> Logo</label></div>
            </div>
            <div class="row" style="margin:10px 0 6px"><b style="font-size:13px">Content slides</b><span style="flex:1"></span><button class="btn" id="perSheet">One slide per sheet</button><button class="btn" id="addSlide">+ New slide</button></div>
            <div class="slist">${slides || `<p class="meta">No slides yet.</p>`}</div>
          </div></div>`,
        `<span class="hint">Drag tables between slides · click a slide to highlight it, then click tables to add them.</span><button class="btn" data-a="back">Back</button><button class="btn primary" data-a="finish">Save preset & show slides</button>`);
      root.querySelector('[data-a="back"]').onclick = () => go(2);
      root.querySelector('[data-a="finish"]').onclick = finish;
      root.querySelector("#addSlide").onclick = () => { const s = {id:uid(), type:"content", title:null, subtitle:null, tables:[], layout:null}; W.slides.push(s); W.focusSlide = s.id; render(); };
      root.querySelector("#perSheet").onclick = () => { if(!W.slides.length || confirm("Replace the current slides with one slide per sheet?")){ oneSlidePerSheet(); render(); } };
      const bindTxt = (id, obj, key) => { const el = root.querySelector(id); el.addEventListener("keydown", e => e.stopPropagation()); el.oninput = () => { obj[key] = el.value; }; };
      bindTxt("#cvTitle", W.cover, "title"); bindTxt("#cvSub", W.cover, "subtitle"); bindTxt("#cvDate", W.cover, "date"); bindTxt("#cvNote", W.cover, "note"); bindTxt("#ixTitle", W.index, "title");
      root.querySelector("#cvOn").onchange = e => { W.cover.enabled = e.target.checked; render(); };
      root.querySelector("#cvLogo").onchange = e => { W.cover.logo = e.target.checked ? undefined : false; };
      root.querySelector("#ixLogo").onchange = e => { W.index.logo = e.target.checked ? undefined : false; };
      root.querySelector("#ixOn").onchange = e => { W.index.enabled = e.target.checked; render(); };
      root.querySelectorAll(".scard").forEach(card => {
        const s = W.slides.find(x => x.id===card.dataset.id);
        card.addEventListener("click", e => { if(e.target.closest("button,input")) return; W.focusSlide = s.id; root.querySelectorAll(".scard").forEach(c => c.classList.toggle("focus", c===card)); });
        card.querySelector(".stitle").oninput = e => { s.title = e.target.value || null; };
        card.querySelector(".ssub").oninput = e => { s.subtitle = e.target.value || null; };
        card.querySelector(".slogo").onchange = e => { if(e.target.checked) delete s.logo; else s.logo = false; };
        card.querySelectorAll("input").forEach(i => i.addEventListener("keydown", e => e.stopPropagation()));
        card.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { const i = W.slides.indexOf(s);
          if(b.dataset.m==="del"){ W.slides.splice(i,1); } else { const j = b.dataset.m==="up" ? i-1 : i+1; if(j>=0 && j<W.slides.length){ W.slides.splice(i,1); W.slides.splice(j,0,s); } } render(); });
        card.querySelectorAll(".tchip.in button").forEach(b => b.onclick = () => { const id = b.parentNode.dataset.id; s.tables = s.tables.filter(x => x!==id); s.layout = null; render(); });
        const drop = card.querySelector(".drop");
        drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
        drop.addEventListener("dragleave", () => drop.classList.remove("over"));
        drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over");
          const id = e.dataTransfer.getData("text/id"), from = e.dataTransfer.getData("text/from");
          if(!id) return; if(from){ const f = W.slides.find(x => x.id===from); if(f && f!==s){ f.tables = f.tables.filter(x => x!==id); f.layout = null; } }
          if(!s.tables.includes(id)){ s.tables.push(id); s.layout = null; } W.focusSlide = s.id; render(); });
      });
      root.querySelectorAll(".tchip[draggable]").forEach(ch => {
        ch.addEventListener("dragstart", e => { e.dataTransfer.setData("text/id", ch.dataset.id); e.dataTransfer.setData("text/from", ch.dataset.from || ""); });
        if(!ch.classList.contains("in")) ch.onclick = () => { const s = W.slides.find(x => x.id===W.focusSlide) || W.slides[W.slides.length-1]; if(!s) return; if(!s.tables.includes(ch.dataset.id)){ s.tables.push(ch.dataset.id); s.layout = null; } W.focusSlide = s.id; render(); };
      });
    }
    function autoTitle(s){ const t = W.tables.find(x => x.id===s.tables[0]); const S = t && byName(t.sheet); return S ? (S.title || S.name) : "Slide title"; }
    function finish(){
      if(!W.slides.length && !W.cover.enabled){ alert("Add at least one slide."); return; }
      const slides = [];
      const lg = o => o.logo===false ? {logo:false} : {};
      if(W.cover.enabled) slides.push(Object.assign({id: W.cover.id || uid(), type:"cover", title: W.cover.title || null, subtitle: W.cover.subtitle || null, date: W.cover.date || null, note: W.cover.note || null, tables:[]}, lg(W.cover)));
      if(W.index.enabled) slides.push(Object.assign({id: W.index.id || uid(), type:"index", title: W.index.title || null, tables:[]}, lg(W.index)));
      W.slides.forEach(s => slides.push(Object.assign({id:s.id, type:"content", title:s.title||null, subtitle:s.subtitle||null, tables:s.tables.slice(), layout: s.layout && s.layout.w && s.layout.w.length===s.tables.length ? s.layout : null}, lg(s))));
      close({version:3, sheets:[...W.sheets], tables: W.tables.map(t => { const o = Object.assign({}, t); if(!o.name) delete o.name; return o; }), slides});
    }
    render();
  });
}

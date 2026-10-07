/* Editing wizard — 1 Sheets · 2 Tables · 3 Slides · 4 Versions (named versions with removed cells).
   v3: cover and index are ordinary entries of the slide list and can be moved like any slide. */
import { useEffect, useRef, useState } from "preact/hooks";
import { DLG, confirmBox, alertBox, type WizardReq } from "../state/dialogs";
import { showBusy, hideBusy } from "../state/store";
import { A1, esc, fmtMB, numToCol, uid } from "../xlsx/util";
import { formatValue } from "../xlsx/numfmt";
import type { Sheet } from "../xlsx/types";
import type { DeckVersion, Preset, SlideDef, TableDef } from "../model/types";
import { SLIDE_RX, gToRange, rangeToG, resolveTable, validRange } from "../model/preset";
import { todayLabel } from "../render/cover";
import { detectTables, usedRange } from "./detect";

interface W {
  step: 1 | 2 | 3 | 4; sheets: Set<string>; tables: TableDef[]; slides: SlideDef[];
  /** step 4: the deck's versions and the one being edited */ versions: DeckVersion[]; vcur: string | null;
  cur: string | null; sel: { r1: number; c1: number; r2: number; c2: number } | null;
  suggest: Record<string, string[]>; focusSlide: string | null; grids: Record<string, HTMLElement>; grow: boolean;
  /** keyboard: where a Shift+arrow / Shift+click selection starts, and the moving corner */
  anchor?: { r: number; c: number }; active?: { r: number; c: number };
  addSel?: () => void;
}
const defRange = (S: Sheet | undefined, d: TableDef) => d.kind === "markers"
  ? (() => { if (!S) return null; const T = S.tables.find(t => A1(t.g.r1, t.g.c1) === d.anchor) || S.tables[d.index]; return T ? gToRange(T.g) : null; })()
  : d.range;

export function Wizard({ req }: { req: WizardReq }) {
  const { wb, name } = req;
  const meta = wb.meta;
  const inMeta = (n: string) => meta.some(m => m.name === n);
  const byName = (n: string | null) => wb.sheets.find(S => S.name === n);
  const ref = useRef<W | null>(null);
  if (!ref.current) {
    const P: Preset = JSON.parse(JSON.stringify(req.preset || { sheets: [], tables: [], slides: [] }));
    const w: W = {
      step: 1, sheets: new Set((P.sheets && P.sheets.length ? P.sheets : P.tables.map(t => t.sheet)).filter(inMeta)),
      tables: P.tables.filter(t => inMeta(t.sheet)), slides: P.slides.map(s => ({ ...s, tables: (s.tables || []).slice() })),
      cur: null, sel: null, suggest: {}, focusSlide: null, grids: {}, grow: false,
      versions: (P.versions || []).map(v => ({ ...v, hide: JSON.parse(JSON.stringify(v.hide || {})) })), vcur: null,
    };
    w.vcur = w.versions[0]?.id || null;
    if (!w.sheets.size) meta.filter(m => SLIDE_RX.test(m.name) && !(byName(m.name) || {} as Sheet).error).forEach(m => w.sheets.add(m.name));
    ref.current = w;
  }
  const W = ref.current;
  const [, setN] = useState(0); const render = () => setN(n => n + 1);
  const close = (v: Preset | null) => req.resolve(v);
  const askClose = async () => { if (await confirmBox("Close the wizard?", "Your changes in the wizard will be lost.", "Close without saving", true)) close(null); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest && t.closest(".wgrid-in") && W.sel) return;            // Escape in the grid clears the selection first
      if (e.key === "Escape" && !DLG.dialog && !t.matches("input")) { e.stopPropagation(); void askClose(); }
    };
    document.addEventListener("keydown", key, true); return () => document.removeEventListener("keydown", key, true);
  }, []);

  const sheetsChosen = () => wb.sheets.filter(S => W.sheets.has(S.name));
  const tablesOf = (n: string) => W.tables.filter(t => t.sheet === n);
  const usedIn = (id: string) => W.slides.filter(s => s.tables.includes(id)).length;
  const tLabel = (t: TableDef) => { if (t.name) return t.name; const S = byName(t.sheet), base = (S && S.title) || t.sheet; return tablesOf(t.sheet).length > 1 ? base + " · " + (defRange(S, t) || "") : base; };

  async function ensureChosen() {
    try {
      const added = await wb.ensure([...W.sheets], showBusy);
      for (const S of added) {   // sheets with "x" markers bring their tables along
        if (S.tables && S.tables.length && !W.tables.some(t => t.sheet === S.name))
          S.tables.forEach((T, i) => W.tables.push({ id: uid(), sheet: S.name, kind: "markers", anchor: A1(T.g.r1, T.g.c1), index: i }));
      }
    } finally { hideBusy(); }
  }
  async function go(s: 1 | 2 | 3 | 4) {
    if (s >= 2) { try { await ensureChosen(); } catch (e) { await alertBox("Could not read the sheets", esc((e as Error).message || e)); return; } }
    W.step = s;
    if ((s === 2 || s === 4) && (!W.cur || !W.sheets.has(W.cur))) W.cur = sheetsChosen()[0]?.name || null;
    if (s === 3 || s === 4) syncSlides();
    W.sel = null;
    render();
  }
  function syncSlides() {
    const keep = new Set(W.tables.filter(t => W.sheets.has(t.sheet)).map(t => t.id));
    W.tables = W.tables.filter(t => keep.has(t.id));
    W.slides.forEach(s => s.tables = s.tables.filter(id => keep.has(id)));
    if (!W.slides.some(s => s.type === "content")) oneSlidePerSheet();
  }
  function oneSlidePerSheet() {
    const extra = W.slides.filter(s => s.type !== "content");
    W.slides = [...extra, ...sheetsChosen().filter(S => tablesOf(S.name).length).map(S => ({ id: uid(), type: "content" as const, title: null, subtitle: null, tables: tablesOf(S.name).map(t => t.id), layout: null }))];
  }
  async function finish() {
    if (!W.slides.length) { await alertBox("No slides", "Add at least one slide."); return; }
    const slides = W.slides.map(s => {
      const o: SlideDef = { ...s, tables: s.type === "content" ? s.tables.slice() : [] };
      if (o.type === "content" && !(o.layout && o.layout.w && o.layout.w.length === o.tables.length)) o.layout = null;
      for (const k of ["title", "subtitle", "date", "note"] as const) if (o[k] === "" || o[k] === undefined) o[k] = null;
      if (o.logo !== false) delete o.logo;
      return o;
    });
    const versions = W.versions.filter(v => v.name.trim()).map(v => ({ id: v.id, name: v.name.trim(),
      hide: Object.fromEntries(Object.entries(v.hide).filter(([sh, rs]) => W.sheets.has(sh) && rs.length)) }));
    close({ sheets: [...W.sheets], tables: W.tables.map(t => { const o = { ...t }; if (!o.name) delete o.name; return o; }), slides, ...(versions.length ? { versions } : {}) });
  }

  const steps = ["Sheets", "Tables", "Slides", "Versions"];
  let body, foot;
  if (W.step === 1) [body, foot] = stepSheets();
  else if (W.step === 2) [body, foot] = stepTables();
  else if (W.step === 3) [body, foot] = stepSlides();
  else [body, foot] = stepVersions();
  return (
    <div class="wiz">
      <div class="wizbox">
        <div class="wizhd"><b>Editing wizard</b><span>{name}</span>
          <ol class="steps">{steps.map((s, i) => <li key={s} class={W.step === i + 1 ? "on" : W.step > i + 1 ? "done" : ""} data-go={i + 1}
            onClick={() => { const n = (i + 1) as 1 | 2 | 3 | 4; if (n < W.step || W.sheets.size) void go(n); }}>{i + 1} · {s}</li>)}</ol>
          <button class="btn icon" data-x="close" title="Close" onClick={() => void askClose()}>✕</button></div>
        <div class="wizbody">{body}</div>
        <div class="wizft">{foot}</div>
      </div>
    </div>
  );

  /* ---------- step 1: sheets (hidden sheets stay hidden) */
  function stepSheets() {
    const hiddenN = wb.hiddenSheets.length, other = wb.skipped.filter(x => x.why !== "hidden");
    const lazy = meta.some(m => !byName(m.name));
    const mb = meta.filter(m => W.sheets.has(m.name) && !byName(m.name)).reduce((s, m) => s + m.size, 0);
    const toggle = (n: string, on: boolean) => { if (on) W.sheets.add(n); else W.sheets.delete(n); render(); };
    const quick = (q: string) => { W.sheets.clear(); meta.forEach(m => { if (!(byName(m.name) || {} as Sheet).error && (q === "all" || (q === "slide" && SLIDE_RX.test(m.name)))) W.sheets.add(m.name); }); render(); };
    return [
      <div class="wizcol">
        <p class="lead">Choose the sheets you want to work with. Sheets whose name contains “slide” are pre-selected{hiddenN ? `; ${hiddenN} hidden sheet${hiddenN > 1 ? "s are" : " is"} not listed` : ""}.{lazy && <><br /><b>Large workbook:</b> only the sheets you select are read – pick only what you need.</>}</p>
        <div class="dlgtools" style="padding:0 0 8px"><button class="btn" onClick={() => quick("slide")}>Only “slide” sheets</button><button class="btn" onClick={() => quick("all")}>All</button><button class="btn" onClick={() => quick("none")}>None</button>
          <span class="cnt">{W.sheets.size} of {meta.length} selected{mb ? ` · ${fmtMB(mb)} to read` : ""}</span></div>
        <div class="sheetlist big">{meta.map(m => {
          const S = byName(m.name), sz = m.size ? <span class="sz">{fmtMB(m.size)}</span> : null;
          if (S && S.error) return <label class="sheetrow hid" key={m.name}><input type="checkbox" disabled /><span class="nm">{S.name}</span><span class="chip red">could not be read</span><span class="meta">{S.error}</span></label>;
          const box = <input type="checkbox" value={m.name} checked={W.sheets.has(m.name)} onChange={e => toggle(m.name, (e.target as HTMLInputElement).checked)} />;
          if (!S) return <label class="sheetrow" key={m.name}>{box}<span class="nm">{m.name}</span>{SLIDE_RX.test(m.name) && <span class="chip">slide</span>}{sz}<span class="meta">not read yet – it is read only if you select it</span></label>;
          const U = usedRange(S), nT = S.tables.length;
          if (!W.suggest[S.name]) W.suggest[S.name] = detectTables(S);
          const nS = W.suggest[S.name].length, mine = tablesOf(S.name).length;
          return <label class="sheetrow" key={m.name}>{box}<span class="nm">{S.name}</span>{SLIDE_RX.test(S.name) && <span class="chip">slide</span>}{nT > 0 && <span class="chip green">{nT} × table</span>}{sz}
            <span class="meta">{S.title || "—"} · used range A1:{A1(U.r2, U.c2)} · {mine ? mine + " table(s) defined" : nS ? nS + " possible table(s) found" : "no table found"}</span></label>;
        })}</div>
        {other.length > 0 && <p class="meta" style="margin-top:8px">Not listed: {other.map(x => x.name + " (" + x.why + ")").join(", ")}</p>}
      </div>,
      <><span class="hint">Next: pick the tables on each sheet.</span><button class="btn" data-a="cancel" onClick={() => close(null)}>Cancel</button><button class="btn primary" data-a="next" disabled={!W.sheets.size} onClick={() => void go(2)}>Next · Tables</button></>,
    ];
  }

  /* ---------- step 4: versions – the same deck with some cells removed, e.g. "Chief" (everything) and "All" */
  function stepVersions() {
    const chosen = sheetsChosen().filter(sh => tablesOf(sh.name).length), S = byName(W.cur) && tablesOf(W.cur!).length ? byName(W.cur) : chosen[0];
    if (S && W.cur !== S.name) W.cur = S.name;
    const V = W.versions.find(v => v.id === W.vcur) || null;
    const addVersion = (name: string) => { const n = name.trim(); if (!n || W.versions.some(v => v.name.toLowerCase() === n.toLowerCase())) return false; const v = { id: uid(), name: n, hide: {} }; W.versions.push(v); W.vcur = v.id; render(); return true; };
    const cut = (range: string) => {
      const r = range.trim().toUpperCase(); if (!S || !V || !validRange(r)) return false;
      const list = V.hide[S.name] || (V.hide[S.name] = []); if (!list.includes(r)) list.push(r);
      W.sel = null; render(); return true;
    };
    const cuts = V ? Object.entries(V.hide).flatMap(([sh, rs]) => rs.map(r => ({ sh, r }))) : [];
    return [
      <div class="wiz2 wiz4">
        <div class="wtabs">{chosen.map(sh => <button key={sh.name} class={"wtab" + (sh.name === S?.name ? " on" : "")} onClick={() => { W.cur = sh.name; W.sel = null; render(); }}><span>{sh.name}</span><span class="badge2">{V ? (V.hide[sh.name] || []).length : 0}</span></button>)}</div>
        <div class="wgridwrap">{S && <SheetGrid S={S} W={W} tables={tablesOf(S.name)} onAdd={cut} onPick={() => render()} />}</div>
        <div class="wside">
          <div class="lbl">Versions</div>
          <div class="wvlist" id="wVersions">
            {!W.versions.length && <div class="meta">No versions yet: the deck is exported as it is. Add versions to export the same slides for different audiences, with some cells removed.</div>}
            {W.versions.map(v => <div key={v.id} class={"wvrow" + (v.id === W.vcur ? " on" : "")} data-v={v.name} onClick={() => { W.vcur = v.id; render(); }}>
              <input type="radio" checked={v.id === W.vcur} />
              <input class="nmin" value={v.name} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onInput={e => { v.name = (e.target as HTMLInputElement).value; }} onBlur={() => render()} />
              <span class="meta">{Object.values(v.hide).reduce((n, rs) => n + rs.length, 0) || "nothing"} removed</span>
              <button class="btn icon del" title="Delete this version" onClick={e => { e.stopPropagation(); W.versions = W.versions.filter(x => x !== v); if (W.vcur === v.id) W.vcur = W.versions[0]?.id || null; render(); }}>✕</button>
            </div>)}
          </div>
          <NewVersion onAdd={addVersion} suggest={["Chief", "All"].filter(n => !W.versions.some(v => v.name.toLowerCase() === n.toLowerCase()))} />
          {V && <>
            <div class="lbl" style="margin-top:10px">Remove cells in “{V.name}”</div>
            <div class="row"><input id="wCutRange" readOnly placeholder="drag across cells on the sheet" value={W.sel ? A1(W.sel.r1, W.sel.c1) + ":" + A1(W.sel.r2, W.sel.c2) : ""} />
              <button class="btn primary" id="wCut" disabled={!W.sel} onClick={() => W.sel && cut(A1(W.sel.r1, W.sel.c1) + ":" + A1(W.sel.r2, W.sel.c2))}>Remove</button></div>
            <div class="meta">Removed cells are shown completely empty in this version (no value, no colour). Enter also removes the selection.</div>
            <div class="wtlist" id="wCuts">{cuts.length ? cuts.map(({ sh, r }) => <div class="wcut" key={sh + r}><code>{sh}!{r}</code>
              <button class="btn icon del" title="Keep these cells" onClick={() => { V.hide[sh] = (V.hide[sh] || []).filter(x => x !== r); if (!V.hide[sh].length) delete V.hide[sh]; render(); }}>✕</button></div>)
              : <div class="meta" style="padding:6px 2px">Nothing removed – this version shows everything.</div>}</div>
          </>}
        </div>
      </div>,
      <><span class="hint">Pick a version, then drag across the cells it must not show and press Remove. Each version is exported separately (Export ▾ › every version).</span><button class="btn" data-a="back" onClick={() => void go(3)}>Back</button><button class="btn primary" data-a="finish" onClick={() => void finish()}>Save preset & show slides</button></>,
    ];
  }

  /* ---------- step 2: tables, picked on a spreadsheet view */
  function stepTables() {
    const chosen = sheetsChosen(), S = byName(W.cur);
    if (S && !W.suggest[S.name]) W.suggest[S.name] = detectTables(S);
    const add = (range: string) => {
      const v = range.trim().toUpperCase(); if (!S || !validRange(v)) return false;
      W.tables.push({ id: uid(), sheet: S.name, kind: "range", range: v, grow: W.grow }); W.sel = null; render(); return true;
    };
    return [
      <div class="wiz2">
        <div class="wtabs">{chosen.map(s => <button key={s.name} class={"wtab" + (s.name === W.cur ? " on" : "")} onClick={() => { W.cur = s.name; W.sel = null; render(); }}><span>{s.name}</span><span class="badge2">{tablesOf(s.name).length}</span></button>)}</div>
        <div class="wgridwrap">{S && <SheetGrid S={S} W={W} tables={tablesOf(S.name)} onAdd={r => add(r)} onPick={() => render()} />}</div>
        <div class="wside">
          <div class="wsel"><div class="lbl">Selection</div>
            <RangeInput W={W} onAdd={add} onChange={() => render()} />
            <label class="ck"><input type="checkbox" id="wGrow" checked={W.grow} onChange={e => { W.grow = (e.target as HTMLInputElement).checked; }} /> grows when rows are added below</label></div>
          {S && <div class="wtools">
            {S.tables.length > 0 && <button class="btn" id="wMarkers" onClick={() => { S.tables.forEach((T, i) => { const a = A1(T.g.r1, T.g.c1); if (!W.tables.some(t => t.sheet === S.name && t.kind === "markers" && t.anchor === a)) W.tables.push({ id: uid(), sheet: S.name, kind: "markers", anchor: a, index: i }); }); render(); }}>Use “x” tables ({S.tables.length})</button>}
            <button class="btn" id="wDetect" onClick={() => { (W.suggest[S.name] || []).forEach(r => { if (!W.tables.some(t => t.sheet === S.name && defRange(S, t) === r)) W.tables.push({ id: uid(), sheet: S.name, kind: "range", range: r, grow: false }); }); render(); }}>Add detected tables ({(W.suggest[S.name] || []).length})</button>
          </div>}
          <div class="lbl" style="margin-top:6px">Tables on this sheet</div>
          <div class="wtlist" id="wtlist">{S && (tablesOf(S.name).length ? tablesOf(S.name).map((t, k) => {
            const r = defRange(S, t), L = resolveTable(wb, t), n = L ? L.rows.length * L.cols.length : 0;
            return <div class="wtrow" data-id={t.id} key={t.id}>
              <div class="row"><b>T{k + 1}</b><input class="nmin" value={t.name || ""} placeholder={S.title || S.name} onKeyDown={e => e.stopPropagation()} onInput={e => { t.name = (e.target as HTMLInputElement).value.trim() || undefined; }} />
                <button class="btn icon del" title="Remove" onClick={() => { W.tables = W.tables.filter(x => x !== t); W.slides.forEach(s => s.tables = s.tables.filter(id => id !== t.id)); render(); }}>✕</button></div>
              <div class="row">{t.kind === "markers" ? <span class="rng">between “x” cells · {r || "?"}</span> : <>
                <input class="rgin" key={t.id + t.range} defaultValue={t.range} spellcheck={false} onKeyDown={e => e.stopPropagation()} onChange={e => { const el = e.target as HTMLInputElement, v = el.value.trim().toUpperCase(); if (validRange(v) && t.kind === "range") { t.range = v; render(); } else el.classList.add("bad"); }} />
                <label class="ck"><input type="checkbox" class="grow" checked={t.kind === "range" && !!t.grow} onChange={e => { if (t.kind === "range") t.grow = (e.target as HTMLInputElement).checked; render(); }} /> grows</label></>}</div>
              <div class="meta">{L ? `${L.rows.length}×${L.cols.length} visible` : "empty / not found"}{n > 3000 && <span style="color:var(--warn)"> · {n.toLocaleString()} cells – text will be very small on one slide and editing is slower; consider a smaller range</span>}{usedIn(t.id) ? ` · on ${usedIn(t.id)} slide(s)` : ""}</div>
            </div>;
          }) : <div class="meta" style="padding:8px 2px">No tables yet: drag across the cells of a table, or click a dashed suggestion.</div>)}</div>
        </div>
      </div>,
      <><span class="hint">Drag across cells (or Shift+click, Shift+arrows; Enter adds) to select a table · dashed boxes are suggestions (click to add) · hidden rows/columns are skipped on the slide.</span><button class="btn" data-a="back" onClick={() => void go(1)}>Back</button><button class="btn primary" data-a="next" onClick={() => void go(3)}>Next · Slides</button></>,
    ];
  }

  /* ---------- step 3: slides (cover and index are entries of the list) */
  function stepSlides() {
    const cover = W.slides.find(s => s.type === "cover"), index = W.slides.find(s => s.type === "index");
    const setSpecial = (type: "cover" | "index", on: boolean) => {
      if (!on) W.slides = W.slides.filter(s => s.type !== type);
      else { const s: SlideDef = { id: uid(), type, title: type === "index" ? "Contents" : null, subtitle: null, tables: [] }; const at = type === "cover" ? 0 : (W.slides[0]?.type === "cover" ? 1 : 0); W.slides.splice(at, 0, s); }
      render();
    };
    const addTo = (s: SlideDef, id: string) => { if (!s.tables.includes(id)) { s.tables.push(id); s.layout = null; } W.focusSlide = s.id; render(); };
    const autoTitle = (s: SlideDef) => { const t = W.tables.find(x => x.id === s.tables[0]); const S = t && byName(t.sheet); return S ? (S.title || S.name) : "Slide title"; };
    const pool = sheetsChosen().filter(S => tablesOf(S.name).length);
    let n = 0;
    return [
      <div class="wiz3">
        <div class="pool"><div class="lbl" style="font-size:12px">TABLES</div>
          {pool.length ? pool.map(S => <div class="pgrp" key={S.name}><div class="lbl">{S.name}</div>{tablesOf(S.name).map(t => {
            const L = resolveTable(wb, t);
            return <div key={t.id} class={"tchip" + (usedIn(t.id) ? "" : " free")} draggable data-id={t.id} title="Drag onto a slide, or click to add it to the highlighted slide"
              onDragStart={e => { e.dataTransfer!.setData("text/id", t.id); e.dataTransfer!.setData("text/from", ""); }}
              onClick={() => { const s = W.slides.find(x => x.id === W.focusSlide && x.type === "content") || [...W.slides].reverse().find(x => x.type === "content"); if (s) addTo(s, t.id); }}>
              <b>{tLabel(t)}</b><span>{L ? L.rows.length + "×" + L.cols.length : "?"}{usedIn(t.id) ? ` · on ${usedIn(t.id)}` : " · unused"}</span></div>;
          })}</div>) : <p class="meta">No tables defined. Go back to step 2.</p>}
        </div>
        <div class="deck">
          <div class="extra">
            <label class="ck big"><input type="checkbox" id="cvOn" checked={!!cover} onChange={e => setSpecial("cover", (e.target as HTMLInputElement).checked)} /> Cover slide</label>
            <label class="ck big"><input type="checkbox" id="ixOn" checked={!!index} onChange={e => setSpecial("index", (e.target as HTMLInputElement).checked)} /> Index slide (list of slides with page numbers)</label>
            <span class="meta">Cover and index appear in the list below; move them with ↑ ↓ like any slide.</span>
          </div>
          <div class="row" style="margin:10px 0 6px"><b style="font-size:13px">Slides</b><span style="flex:1" />
            <button class="btn" id="perSheet" onClick={async () => { if (!W.slides.some(s => s.type === "content") || await confirmBox("Replace the slides?", "Replace the current content slides with one slide per sheet?", "Replace")) { oneSlidePerSheet(); render(); } }}>One slide per sheet</button>
            <button class="btn" id="addSlide" onClick={() => { const s: SlideDef = { id: uid(), type: "content", title: null, subtitle: null, tables: [], layout: null }; W.slides.push(s); W.focusSlide = s.id; render(); }}>+ New slide</button></div>
          <div class="slist">{W.slides.length ? W.slides.map((s, i) => {
            const move = (d: number) => { const j = i + d; if (j < 0 || j >= W.slides.length) return; W.slides.splice(i, 1); W.slides.splice(j, 0, s); render(); };
            const txt = (k: "title" | "subtitle" | "date" | "note", ph: string, id?: string) => <input id={id} class={k === "title" ? "stitle" : "ssub"} value={s[k] || ""} placeholder={ph} onKeyDown={e => e.stopPropagation()} onInput={e => { s[k] = (e.target as HTMLInputElement).value || null; }} />;
            const logo = <label class="ck"><input type="checkbox" class="slogo" checked={s.logo !== false} onChange={e => { if ((e.target as HTMLInputElement).checked) delete s.logo; else s.logo = false; }} /> Logo</label>;
            const head = <div class="row"><span class="sn">{s.type === "content" ? ++n : s.type === "cover" ? "C" : "I"}</span>
              {s.type === "cover" ? txt("title", name.replace(/\.[^.]+$/, ""), "cvTitle") : s.type === "index" ? txt("title", "Contents", "ixTitle") : txt("title", autoTitle(s))}
              <button class="btn icon" title="Move up" onClick={() => move(-1)}>↑</button><button class="btn icon" title="Move down" onClick={() => move(1)}>↓</button>
              <button class="btn icon" title="Delete slide" onClick={() => { W.slides.splice(i, 1); render(); }}>✕</button></div>;
            if (s.type === "cover") return <div class="scard special" key={s.id} data-id={s.id}>{head}
              <div class="row">{txt("subtitle", "Subtitle", "cvSub")}{txt("date", todayLabel() + " (automatic)", "cvDate")}</div>
              <div class="row">{txt("note", "Small line above the title, e.g. IBD · Weekly update", "cvNote")}{logo}</div></div>;
            if (s.type === "index") return <div class="scard special" key={s.id} data-id={s.id}>{head}<div class="row"><span class="meta" style="flex:1">Lists the content slides with their page numbers.</span>
              <label class="ck"><input type="checkbox" id="ixSubs" checked={s.subs !== false} onChange={e => { if ((e.target as HTMLInputElement).checked) delete s.subs; else s.subs = false; render(); }} /> with subtitles</label>{logo}</div></div>;
            return <div class={"scard" + (W.focusSlide === s.id ? " focus" : "")} key={s.id} data-id={s.id} onClick={e => { if ((e.target as Element).closest("button,input")) return; W.focusSlide = s.id; render(); }}>
              {head}
              <div class="row">{txt("subtitle", "Subtitle (optional)")}{logo}</div>
              <div class="drop" onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add("over"); }} onDragLeave={e => (e.currentTarget as HTMLElement).classList.remove("over")}
                onDrop={e => {
                  e.preventDefault(); (e.currentTarget as HTMLElement).classList.remove("over");
                  const id = e.dataTransfer!.getData("text/id"), from = e.dataTransfer!.getData("text/from"); if (!id) return;
                  if (from) { const f = W.slides.find(x => x.id === from); if (f && f !== s) { f.tables = f.tables.filter(x => x !== id); f.layout = null; } }
                  addTo(s, id);
                }}>
                {s.tables.length ? s.tables.map(id => { const t = W.tables.find(x => x.id === id); return t ? <span key={id} class="tchip in" draggable data-id={id} data-from={s.id}
                  onDragStart={e => { e.dataTransfer!.setData("text/id", id); e.dataTransfer!.setData("text/from", s.id); }}><b>{tLabel(t)}</b>
                  <button title="Remove from slide" onClick={() => { s.tables = s.tables.filter(x => x !== id); s.layout = null; render(); }}>✕</button></span> : null; }) : <span class="dropnote">Drop tables here</span>}
              </div></div>;
          }) : <p class="meta">No slides yet.</p>}</div>
        </div>
      </div>,
      <><span class="hint">Drag tables between slides · click a slide to highlight it, then click tables to add them.</span><button class="btn" data-a="back" onClick={() => void go(2)}>Back</button><button class="btn" data-a="versions" onClick={() => void go(4)}>Next · Versions{W.versions.length ? ` (${W.versions.length})` : ""}</button><button class="btn primary" data-a="finish" onClick={() => void finish()}>Save preset & show slides</button></>,
    ];
  }
}

function NewVersion({ onAdd, suggest }: { onAdd: (n: string) => boolean; suggest: string[] }) {
  const [v, setV] = useState("");
  return <><div class="row" style="margin-top:6px"><input id="wNewVersion" placeholder="New version, e.g. Board" value={v} onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter" && onAdd(v)) setV(""); }} onInput={e => setV((e.target as HTMLInputElement).value)} />
    <button class="btn" id="wAddVersion" disabled={!v.trim()} onClick={() => { if (onAdd(v)) setV(""); }}>Add version</button></div>
    {suggest.length > 0 && <div class="chips">{suggest.map(n => <button key={n} class="chip" data-addv={n} onClick={() => onAdd(n)}>+ {n}</button>)}</div>}</>;
}
function RangeInput({ W, onAdd, onChange }: { W: W; onAdd: (r: string) => boolean; onChange: () => void }) {
  const [v, setV] = useState("");
  const shown = W.sel ? A1(W.sel.r1, W.sel.c1) + ":" + A1(W.sel.r2, W.sel.c2) : v;
  const ref = useRef<HTMLInputElement>(null);
  const add = () => { if (!onAdd(shown)) { ref.current?.classList.add("bad"); setTimeout(() => ref.current?.classList.remove("bad"), 900); } else setV(""); };
  return <div class="row"><input id="wRange" ref={ref} placeholder="drag on the sheet, or type C4:T56" spellcheck={false} value={shown}
    onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") add(); }}
    onInput={e => { const val = (e.target as HTMLInputElement).value; setV(val); if (validRange(val)) { const g = rangeToG(val); W.sel = { r1: g.r1 + 1, c1: g.c1 + 1, r2: g.r2 - 1, c2: g.c2 - 1 }; } else W.sel = null; onChange(); }} />
    <button class="btn primary" id="wAdd" onClick={add}>Add table</button></div>;
}

/* the spreadsheet view is built once per sheet and re-attached afterwards (adding/removing tables stays instant) */
function SheetGrid({ S, W, tables, onAdd, onPick }: { S: Sheet; W: W; tables: TableDef[]; onAdd: (r: string) => boolean; onPick: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current!; el.innerHTML = "";
    let grid = W.grids[S.name];
    if (!grid) { grid = drawGrid(S, W, () => onPick()); W.grids[S.name] = grid; }
    el.appendChild(grid);
  }, [S]);
  useEffect(() => { paintOverlays(S, W, tables, onAdd); });
  W.addSel = () => { if (W.sel) onAdd(A1(W.sel.r1, W.sel.c1) + ":" + A1(W.sel.r2, W.sel.c2)); };
  return <div class="wgrid" id="wgrid" ref={host} />;
}
let gridUp: (() => void) | null = null;
function drawGrid(S: Sheet, W: W, onPick: () => void): HTMLElement {
  const U = usedRange(S), R2 = Math.max(U.r2 + 3, 20), C2 = Math.max(U.c2 + 2, 10);
  const cw = (c: number) => S.colHidden(c) ? 5 : Math.max(26, Math.min(220, Math.round(S.colPx(c) * 0.82)));
  const rh = (r: number) => S.rowHidden(r) ? 5 : Math.max(18, Math.min(60, Math.round(S.rowPx(r) * 0.9)));
  let h = `<table class="xs"><colgroup><col style="width:38px">`;
  for (let c = 1; c <= C2; c++) h += `<col style="width:${cw(c)}px">`;
  h += `</colgroup><thead><tr><th class="corner"></th>`;
  for (let c = 1; c <= C2; c++) h += `<th class="${S.colHidden(c) ? "hid" : ""}" title="${S.colHidden(c) ? "hidden column " : ""}${numToCol(c)}">${S.colHidden(c) ? "" : numToCol(c)}</th>`;
  h += `</tr></thead><tbody>`;
  for (let r = 1; r <= R2; r++) {
    const hr = S.rowHidden(r);
    h += `<tr style="height:${rh(r)}px" class="${hr ? "hid" : ""}"><th title="${hr ? "hidden row " : ""}${r}">${hr ? "" : r}</th>`;
    for (let c = 1; c <= C2; c++) {
      const x = S.get(r, c), hc = S.colHidden(c);
      let txt = "", st = "";
      if (x && !hr && !hc) {
        if (x.t !== "blank") txt = formatValue(x).text;
        const f = x.xf || {};
        if (f.fill) st += `background:${f.fill};`;
        if (f.font && f.font.color && f.font.color !== "#000000") st += `color:${f.font.color};`;
        if (f.font && f.font.b) st += "font-weight:700;";
        if (x.t === "n" || x.t === "d") st += "text-align:right;";
      }
      h += `<td data-r="${r}" data-c="${c}" class="${hr || hc ? "hid" : ""}${String(txt).trim().toLowerCase() === "x" ? " mk" : ""}" style="${st}">${esc(txt)}</td>`;
    }
    h += `</tr>`;
  }
  h += `</tbody></table><div class="wov" id="wov"></div>`;
  const grid = document.createElement("div"); grid.className = "wgrid-in"; grid.innerHTML = h;
  if (U.clipped) grid.insertAdjacentHTML("afterbegin", `<div class="clipnote">Showing A1:${A1(R2, C2)} – type larger ranges in the box on the right.</div>`);
  let anchor: { r: number; c: number } | null = null;
  const cellOf = (e: Event) => { const td = (e.target as Element).closest<HTMLElement>("td[data-r]"); return td ? { r: +td.dataset.r!, c: +td.dataset.c! } : null; };
  const span = (a: { r: number; c: number }, b: { r: number; c: number }) => { W.anchor = a; W.active = b; W.sel = { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) }; onPick(); };
  grid.tabIndex = 0;                                    // keyboard: arrows move, Shift+arrows extend, Enter adds the table
  grid.addEventListener("pointerdown", e => {
    const c = cellOf(e); if (!c) return; e.preventDefault(); grid.focus({ preventScroll: true });
    if (e.shiftKey && W.anchor) { anchor = W.anchor; span(W.anchor, c); } else { anchor = c; span(c, c); }
  });
  grid.addEventListener("pointerover", e => { if (!anchor || !(e.buttons & 1)) return; const c = cellOf(e); if (!c) return; span(anchor, c); });
  const visible = (r: number, c: number) => !S.rowHidden(r) && !S.colHidden(c);
  grid.addEventListener("keydown", e => {
    const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (d[e.key]) {
      e.preventDefault(); e.stopPropagation();
      const from = W.active || { r: 1, c: 1 }; let { r, c } = from;
      do { r = Math.max(1, Math.min(R2, r + d[e.key][0])); c = Math.max(1, Math.min(C2, c + d[e.key][1])); } while (!visible(r, c) && r > 1 && c > 1 && r < R2 && c < C2);
      const to = { r, c };
      if (e.shiftKey) span(W.anchor || from, to); else span(to, to);
      grid.querySelector(`td[data-r="${r}"][data-c="${c}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (e.key === "Enter" && W.sel) { e.preventDefault(); e.stopPropagation(); W.addSel?.(); }
    else if (e.key === "Escape" && W.sel) { e.stopPropagation(); W.sel = null; W.anchor = W.active = undefined; onPick(); }
  });
  // one shared listener for all grids (v2 added one per grid drawn)
  if (gridUp) removeEventListener("pointerup", gridUp);
  gridUp = () => { anchor = null; };
  addEventListener("pointerup", gridUp);
  return grid;
}
function boxFor(grid: Element, r1: number, c1: number, r2: number, c2: number) {
  const tl = grid.querySelector<HTMLElement>(`td[data-r="${r1}"][data-c="${c1}"]`);
  const br = grid.querySelector<HTMLElement>(`td[data-r="${r2}"][data-c="${c2}"]`) || [...grid.querySelectorAll<HTMLElement>("td[data-r]")].pop();
  const ov = grid.querySelector<HTMLElement>(".wov");
  if (!tl || !br || !ov) return null;
  // measured against the overlay layer itself: offsetTop/Left of a cell are relative to the <table>,
  // which sits lower when the "Showing A1:…" note of a large sheet is above it
  const o = ov.getBoundingClientRect(), a = tl.getBoundingClientRect(), b = br.getBoundingClientRect();
  return { x: a.left - o.left, y: a.top - o.top, w: b.right - a.left, h: b.bottom - a.top };
}
function paintOverlays(S: Sheet, W: W, tables: TableDef[], onAdd: (r: string) => boolean) {
  const grid = W.grids[S.name]; const ov = grid?.querySelector<HTMLElement>(".wov"); if (!grid || !ov) return;
  let h = "";
  tables.forEach((t, k) => {
    const r = defRange(S, t); if (!r) return; const g = rangeToG(r);
    const b = boxFor(grid, g.r1 + 1, g.c1 + 1, g.r2 - 1, g.c2 - 1); if (!b) return;
    h += `<div class="ovb tbl${W.step === 4 ? " ghost" : ""}" data-id="${t.id}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><span>T${k + 1}${t.kind === "range" && t.grow ? " ↓" : ""}</span></div>`;
  });
  if (W.step === 4) {
    const V = W.versions.find(v => v.id === W.vcur);
    (V?.hide[S.name] || []).forEach(r => { const g = rangeToG(r), b = boxFor(grid, g.r1 + 1, g.c1 + 1, g.r2 - 1, g.c2 - 1); if (b) h += `<div class="ovb cut" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></div>`; });
    if (W.sel) { const b = boxFor(grid, W.sel.r1, W.sel.c1, W.sel.r2, W.sel.c2); if (b) h += `<div class="ovb sel" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></div>`; }
    ov.innerHTML = h; return;
  }
  (W.suggest[S.name] || []).forEach(r => {
    if (tables.some(t => defRange(S, t) === r)) return;
    const g = rangeToG(r), b = boxFor(grid, g.r1 + 1, g.c1 + 1, g.r2 - 1, g.c2 - 1); if (!b) return;
    h += `<div class="ovb sug" data-r="${r}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><button title="Add this table">+ ${r}</button></div>`;
  });
  if (W.sel) { const b = boxFor(grid, W.sel.r1, W.sel.c1, W.sel.r2, W.sel.c2); if (b) h += `<div class="ovb sel" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></div>`; }
  ov.innerHTML = h;
  ov.querySelectorAll<HTMLElement>(".sug button").forEach(b => b.onclick = e => { e.stopPropagation(); W.sel = null; const was = W.grow; W.grow = false; onAdd(b.parentElement!.dataset.r!); W.grow = was; });
  ov.querySelectorAll<HTMLElement>(".tbl").forEach(b => b.onclick = () => { const el = document.querySelector(`.wtrow[data-id="${b.dataset.id}"]`); if (el) { el.scrollIntoView({ block: "nearest" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 900); } });
}

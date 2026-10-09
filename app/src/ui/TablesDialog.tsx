/* "Table sizes" dialog: tables of the whole deck, grouped by slide. Make chosen tables exactly the
   same size (also across slides), copy column widths / row heights from one table, align, reset. */
import { useState } from "react";
import { S, emit, useApp } from "../state/store";
import { DLG } from "../state/dialogs";
import { tableName } from "../model/preset";
import { allTables, alignTables, valignTables, copySizes, makeSameSize, resetSizes, type TableRef } from "../editor/tables";
import { tableW } from "../render/slide";
import { ctx } from "../state/app";

export function TablesDialog() {
  useApp();
  const refs = allTables(), c = ctx();
  const keyOf = (r: TableRef) => r.slide + ":" + r.i;
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(refs.filter(r => r.slide === S.cur).map(keyOf)));
  const [w, setW] = useState(true), [h, setH] = useState(true), [target, setTarget] = useState<"largest" | "smallest" | "first">("largest");
  const [src, setSrc] = useState(() => keyOf(refs.find(r => r.slide === S.cur) || refs[0]));
  const [msg, setMsg] = useState("");
  const close = () => { DLG.tables = false; emit(); };
  const pick = refs.filter(r => chosen.has(keyOf(r)));
  const toggle = (k: string, on: boolean) => { const n = new Set(chosen); if (on) n.add(k); else n.delete(k); setChosen(n); };
  const bySlide = S.slides.map((R, si) => ({ R, si, list: refs.filter(r => r.slide === si) })).filter(x => x.list.length);
  const source = refs.find(r => keyOf(r) === src);
  return (
    <div className="modal">
      <div className="dlg tablesdlg" style={{ width: "min(860px,94vw)" }}>
        <div className="dlghd"><b>Table sizes</b><span>{pick.length} of {refs.length} tables chosen</span></div>
        <div className="dlgbody tdbody">
          <div className="tdlist">
            {bySlide.map(({ R, si, list }) => <div key={R.id} className="tdslide">
              <label className="ck big"><input type="checkbox" checked={list.every(r => chosen.has(keyOf(r)))} onChange={e => { const n = new Set(chosen); list.forEach(r => (e.target as HTMLInputElement).checked ? n.add(keyOf(r)) : n.delete(keyOf(r))); setChosen(n); }} />
                Slide {si + 1} · {R.label}</label>
              {list.map(r => <label key={keyOf(r)} className="ck tdtab"><input type="checkbox" data-t={keyOf(r)} checked={chosen.has(keyOf(r))} onChange={e => toggle(keyOf(r), (e.target as HTMLInputElement).checked)} />
                {tableName(r.L, c.preset)} <small>{Math.round(tableW(r.L, c))} × {Math.round(r.L.H)} px</small></label>)}
            </div>)}
          </div>
          <div className="tdactions">
            <div className="opthd">Make the chosen tables the same size</div>
            <div className="row"><label className="ck"><input type="checkbox" checked={w} onChange={e => setW((e.target as HTMLInputElement).checked)} /> width</label>
              <label className="ck"><input type="checkbox" checked={h} onChange={e => setH((e.target as HTMLInputElement).checked)} /> height</label>
              <select value={target} onChange={e => setTarget((e.target as HTMLSelectElement).value as typeof target)}><option value="largest">as the largest</option><option value="smallest">as the smallest</option><option value="first">as the first chosen</option></select></div>
            <p className="meta">Columns and rows are scaled; tables on different slides get one common scale, so they also look the same size on screen and in the PDF.</p>
            <button className="btn primary" id="tdSame" disabled={pick.length < 2 || (!w && !h)} onClick={() => { const r = makeSameSize(pick, { width: w, height: h, target }); setMsg(r.ok ? "Done – the tables now have the same size." : r.why); }}>Make same size</button>
            <div className="sep" />
            <div className="opthd">Copy column widths and row heights</div>
            <div className="row"><span>from</span><select id="tdSrc" value={src} onChange={e => setSrc((e.target as HTMLSelectElement).value)}>{refs.map(r => <option key={keyOf(r)} value={keyOf(r)}>Slide {r.slide + 1} · {tableName(r.L, c.preset)}</option>)}</select></div>
            <p className="meta">Position by position: 1st column → 1st column, …</p>
            <button className="btn" id="tdCopy" disabled={!source || !pick.length} onClick={() => { if (source) { copySizes(source.L, pick); setMsg("Sizes copied."); } }}>Copy to the chosen tables</button>
            <div className="sep" />
            <div className="opthd">Align the tables on the chosen slides</div>
            <div className="row">{(["left", "center", "right"] as const).map(a => <button key={a} className="btn" onClick={() => { alignTables(a, [...new Set(pick.map(r => r.slide))]); setMsg("Aligned " + a + "."); }}>{a === "left" ? "◧ Left" : a === "center" ? "▣ Centre" : "◨ Right"}</button>)}
              {(["top", "middle", "bottom"] as const).map(v => <button key={v} className="btn" onClick={() => { valignTables(v, [...new Set(pick.map(r => r.slide))]); setMsg("Aligned " + v + "."); }}>{v === "top" ? "⬒ Top" : v === "middle" ? "▣ Middle" : "⬓ Bottom"}</button>)}</div>
            <div className="sep" />
            <button className="btn" id="tdReset" disabled={!pick.length} onClick={() => { resetSizes(pick); setMsg("Back to the sizes from Excel."); }}>Reset to Excel sizes</button>
          </div>
        </div>
        <div className="dlgft"><span className="hint">{msg}</span><button className="btn" onClick={close}>Close</button></div>
      </div>
    </div>
  );
}

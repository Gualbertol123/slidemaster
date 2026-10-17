/* Export ▾ › Run for each value… (M8 S8.1, B15, docs/next/07 §2.4–§2.5): an input cell, a list of values, the designs
   and versions to export for each value; Preview shows one value on the stage. The fields are UI state (store
   ui.scenario), never the document. */
import { useEffect, useMemo, useState } from "react";
import { get, patch, useStore, type ScenarioForm } from "../state/store";
import { core } from "../state/app";
import { closeScenario, pickedCell, previewValue, resolveInput, type Resolved } from "../editor/scenario";
import { RangePicker } from "../wizard/Wizard";
import { DESIGNS, DESIGN_LABEL } from "@slide-builder/core/model/designs";
import { scenarioValues } from "@slide-builder/core/export/scenario";
import { parseRange } from "@slide-builder/core/xlsx/util";
import type { SheetInfo } from "@slide-builder/core/xlsx/sheetview";

/** the most cells "From a range…" reads (a run of thousands of values is not what the dialog is for) */
const MAX_CELLS = 5000;
const set = (p: Partial<ScenarioForm>) => patch("ui", { scenario: { ...get().ui.scenario, ...p } });
const typeName = (t: string) => t === "n" ? "a number" : t === "s" ? "text" : t === "b" ? "a logical" : t === "d" ? "a date" : t === "e" ? "an error" : "a value";

/** From a range…: the wizard's sheet view; the dragged range's displayed texts become the values */
function FromRange({ onUse, onCancel }: { onUse: (values: string[], broken: number) => void; onCancel: () => void }) {
  const wb = useStore(s => s.deck.wb)!;
  const sheets = wb.meta.map(m => m.name).filter(n => !wb.hiddenSheets.includes(n));
  const [sheet, setSheet] = useState(() => { const p = resolveSheet(get().ui.scenario.input); return p && sheets.includes(p) ? p : sheets[0]; });
  const [info, setInfo] = useState<SheetInfo | null>(null), [err, setErr] = useState("");
  const [range, setRange] = useState<string | null>(null), [busy, setBusy] = useState(false);
  function resolveSheet(input: string) { const i = input.lastIndexOf("!"); return i > 0 ? input.slice(0, i).replace(/^'(.*)'$/, "$1").replace(/''/g, "'") : null; }
  useEffect(() => {
    let live = true; setInfo(null); setErr(""); setRange(null);
    void core().call("getSheetMeta", { book: wb.book, names: [sheet], load: true })
      .then(m => { if (!live) return; const S = m.sheets[0]; if (S && !S.error) setInfo(S); else setErr(S?.error || "the sheet is not loaded"); })
      .catch(e => { if (live) setErr(String((e as Error)?.message || e)); });
    return () => { live = false; };
  }, [sheet]);
  async function use(r: string | null) {
    if (!r) return;
    const g = parseRange(r), n = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
    if (n > MAX_CELLS) { setErr(`${r} has ${n.toLocaleString()} cells: choose at most ${MAX_CELLS.toLocaleString()}.`); return; }
    setBusy(true);
    try {
      const w = await core().call("getSheetWindow", { book: wb.book, sheet, r0: g.r1, r1: g.r2, c0: g.c1, c1: g.c2 });
      // the texts the cells show (their number format applied), row by row; hidden rows and columns are not shown; a
      // line break or tab inside a cell would split it into two values (one per line): it becomes a space
      const texts = w ? w.cells.map(c => c.text) : [];
      onUse(texts.map(t => t.replace(/[\r\n\t]+/g, " ")), texts.filter(t => /[\r\n\t]/.test(t)).length);
    } catch (e) { setErr(String((e as Error)?.message || e)); } finally { setBusy(false); }
  }
  return <div className="scrange" id="scRange">
    <div className="row">
      <label>Sheet</label>
      <select id="scSheet" value={sheet} onChange={e => setSheet((e.target as HTMLSelectElement).value)}>{sheets.map(n => <option key={n} value={n}>{n}</option>)}</select>
      <span className="scnote">{range ? <>Selected <b id="scRangeSel">{range}</b></> : "Drag across the cells whose texts are the values"}</span>
      <span style={{ flex: "1" }} />
      <button className="btn" onClick={onCancel}>Back</button>
      <button className="btn primary" id="scUseRange" disabled={!range || busy} onClick={() => void use(range)}>Use these cells</button>
    </div>
    {err && <div className="scbad">{err}</div>}
    <div className="wgridwrap scgrid">{info ? <RangePicker key={sheet} book={wb.book} S={info} onSel={setRange} onEnter={r => void use(r)} /> : !err && <div className="scnote" style={{ padding: "12px" }}>Reading “{sheet}”…</div>}</div>
  </div>;
}

export function ScenarioDialog() {
  const f = useStore(s => s.ui.scenario), versions = useStore(s => s.doc.view?.preset?.versions) || [];
  const values = useMemo(() => scenarioValues(f.values), [f.values]);
  const lines = useMemo(() => f.values.split(/\r\n|\r|\n|\t/).filter(l => l.trim()).length, [f.values]);
  const [cell, setCell] = useState<Resolved | null>(null), [ranging, setRanging] = useState(false);
  const picked = pickedCell();
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void resolveInput(f.input).then(r => { if (live) setCell(r); }), 150);
    return () => { live = false; clearTimeout(t); };
  }, [f.input]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape in the range picker's grid clears its selection first (the grid's own handler), as in the wizard
      if ((e.target as HTMLElement).closest?.(".wgrid-in") && document.querySelector("#scRange .ovb.sel")) return;
      e.stopPropagation(); if (ranging) setRanging(false); else closeScenario();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [ranging]);
  const value = values.includes(f.value) ? f.value : values[0] || "";
  const vers = f.versions.filter(v => v === "" || versions.some(x => x.id === v));
  const files = values.length * f.designs.length * vers.length;
  const toggle = <T,>(list: T[], x: T, on: boolean) => on ? [...list.filter(y => y !== x), x] : list.filter(y => y !== x);
  const preview = async () => { if (await previewValue(f.input, value, f.asText)) closeScenario(); };
  return (
    <div className="modal">
      <div className="dlg scdlg" id="scenarioDialog" style={{ width: `min(${ranging ? 940 : 640}px,94vw)` }}>
        <div className="dlghd"><b>Run for each value</b><span>One file per value: the input cell set to each value and the deck drawn from the recalculated workbook. Nothing is saved – the workbook and the deck stay as they are.</span></div>
        <div className="dlgbody scbody">
          <div className="opthd">Input cell</div>
          <div className="row">
            <input id="scInput" spellCheck={false} placeholder="e.g. Control!B2" value={f.input} onKeyDown={e => e.stopPropagation()} onChange={e => set({ input: (e.target as HTMLInputElement).value })} />
            <button className="btn" id="scPick" disabled={!picked} title={picked ? `The cell selected on the slide: ${picked}` : "Select a cell on the slide first, then open this dialog again"} onClick={() => picked && set({ input: picked })}>Pick a cell{picked ? `: ${picked}` : ""}</button>
          </div>
          <div className={"scnote" + (cell && !cell.ok ? " scbad" : "")} id="scInputNote">{!cell ? " " : cell.ok
            ? (cell.now ? <>Holds “{cell.now.text}” today ({typeName(cell.now.t)}).</> : <>Empty today.</>)
            : cell.why}</div>
          <div className="opthd">Values <span className="sccount" id="scCount">{values.length} value{values.length === 1 ? "" : "s"}{lines > values.length ? ` · ${lines - values.length} repeated left out` : ""}</span></div>
          {f.broken > 0 && <div className="scnote scbad" id="scBroken">{f.broken} cell{f.broken === 1 ? "" : "s"} of the range had line breaks, shown here as spaces: such a value is not the cell's own text (a lookup on it may not find it).</div>}
          {ranging ? <FromRange onCancel={() => setRanging(false)} onUse={(vs, broken) => { set({ values: vs.join("\n"), broken }); setRanging(false); }} /> : <>
            <textarea id="scValues" rows={7} spellCheck={false} placeholder={"One value per line – type or paste from Excel, e.g.\nBank A\nBank B\nBank C"} value={f.values}
              onKeyDown={e => e.stopPropagation()} onChange={e => set({ values: (e.target as HTMLTextAreaElement).value, broken: 0 })} />
            <div className="row">
              <button className="btn" id="scFromRange" onClick={() => setRanging(true)}>From a range…</button>
              <label className="ck" title="Numbers go in as numbers when the input cell holds a number today; tick to give every value as text"><input type="checkbox" id="scText" checked={f.asText} onChange={e => set({ asText: (e.target as HTMLInputElement).checked })} /> Treat as text</label>
            </div>
          </>}
          <div className="scgrid2">
            <div>
              <div className="opthd">Designs</div>
              <div id="scDesigns">{DESIGNS.map(d => <label key={d} className="ck"><input type="checkbox" data-design={d} checked={f.designs.includes(d)} onChange={e => set({ designs: toggle(f.designs, d, (e.target as HTMLInputElement).checked) })} /> {DESIGN_LABEL[d]}</label>)}</div>
            </div>
            <div>
              <div className="opthd">Versions</div>
              <div id="scVersions">{[{ id: "", name: "Full deck" }, ...versions].map(v => <label key={v.id} className="ck"><input type="checkbox" data-version={v.id} checked={vers.includes(v.id)} onChange={e => set({ versions: toggle(vers, v.id, (e.target as HTMLInputElement).checked) })} /> {v.name}</label>)}</div>
            </div>
            <div>
              <div className="opthd">Files</div>
              <label className="ck"><input type="checkbox" id="scPdf" checked disabled /> PDF</label>
              <label className="ck" title="PowerPoint files come with Slide Builder 4.5"><input type="checkbox" id="scPptx" disabled /> PowerPoint <small>comes with 4.5</small></label>
            </div>
          </div>
          <div className="scnote" id="scSummary">{files ? `${values.length} × ${f.designs.length} design${f.designs.length === 1 ? "" : "s"} × ${vers.length} version${vers.length === 1 ? "" : "s"} = ${files} PDF${files === 1 ? "" : "s"}` : "Choose at least one value, design and version."}</div>
        </div>
        <div className="dlgft">
          <label className="scpv">Preview <select id="scValue" disabled={!values.length} value={value} onChange={e => set({ value: (e.target as HTMLSelectElement).value })}>{values.map(v => <option key={v} value={v}>{v}</option>)}</select></label>
          <button className="btn" id="scPreview" disabled={!values.length || !cell?.ok} title="Show this value on the slides (nothing is saved)" onClick={() => void preview()}>Preview</button>
          <span style={{ flex: "1" }} />
          <button className="btn" data-a="cancel" onClick={closeScenario}>Close</button>
          <button className="btn primary" id="scRun" disabled title="Running the values comes with the next step of this release (S8.3)">Run</button>
        </div>
      </div>
    </div>
  );
}

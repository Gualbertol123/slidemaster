/* Export ▾ › Run for each value… (M8 S8.1, B15, docs/next/07 §2.4–§2.5): an input cell, a list of values, the designs
   and versions to export for each value; Preview shows one value on the stage. The fields are UI state (store
   ui.scenario), never the document. */
import { useEffect, useMemo, useState } from "react";
import { get, patch, toast, useStore, type ScenarioForm } from "../state/store";
import { esc } from "@slide-builder/core/xlsx/util";
import { core } from "../state/app";
import { cancelRun, closeRun, closeScenario, pickedCell, previewValue, resolveInput, runGoing, startRun, type Resolved } from "../editor/scenario";
import { backend } from "../sync/api";
import type { CellValue } from "@slide-builder/core/calc/engine";
import type { GateCell } from "@slide-builder/core/rpc/messages";
import { RangePicker } from "../wizard/Wizard";
import { DESIGNS, DESIGN_LABEL } from "@slide-builder/core/model/designs";
import { inputCellText, scenarioValues } from "@slide-builder/core/export/scenario";
import { parseRange } from "@slide-builder/core/xlsx/util";
import type { SheetInfo } from "@slide-builder/core/xlsx/sheetview";

/** the most cells "From a range…" reads (a run of thousands of values is not what the dialog is for) */
const MAX_CELLS = 5000;
const set = (p: Partial<ScenarioForm>) => patch("ui", { scenario: { ...get().ui.scenario, ...p } });
const typeName = (t: string) => t === "n" ? "a number" : t === "s" ? "text" : t === "b" ? "a logical" : t === "d" ? "a date" : t === "e" ? "an error" : "a value";

/** From a range…: the wizard's sheet view; the dragged range's displayed texts become the values */
/** Select cell… (the input cell, one cell – red) or From a range… (the values): the wizard's sheet view */
function FromRange({ onUse, onCancel, onCell }: { onUse: (values: string[], broken: number) => void; onCancel: () => void; onCell?: (sheet: string, ref: string) => void }) {
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
    if (onCell) { onCell(sheet, r); return; }
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
      <span className="scnote">{range ? <>Selected <b id="scRangeSel">{range}</b></> : onCell ? "Click the input cell" : "Drag across the cells whose texts are the values"}</span>
      <span style={{ flex: "1" }} />
      <button className="btn" onClick={onCancel}>Back</button>
      {onCell
        ? <button className="btn primary" id="scUseCell" disabled={!range} onClick={() => void use(range)}>Use this cell</button>
        : <button className="btn primary" id="scUseRange" disabled={!range || busy} onClick={() => void use(range)}>Use these cells</button>}
    </div>
    {err && <div className="scbad">{err}</div>}
    <div className="wgridwrap scgrid">{info ? <RangePicker key={sheet + (onCell ? "|cell" : "")} book={wb.book} S={info} single={!!onCell} onSel={setRange} onEnter={r => void use(r)} /> : !err && <div className="scnote" style={{ padding: "12px" }}>Reading “{sheet}”…</div>}</div>
  </div>;
}

export function ScenarioDialog() {
  const f = useStore(s => s.ui.scenario), versions = useStore(s => s.doc.view?.preset?.versions) || [];
  const values = useMemo(() => scenarioValues(f.values), [f.values]);
  const lines = useMemo(() => f.values.split(/\r\n|\r|\n|\t/).filter(l => l.trim()).length, [f.values]);
  const [cell, setCell] = useState<Resolved | null>(null), [ranging, setRanging] = useState(false), [choosing, setChoosing] = useState(false);
  const picked = pickedCell();
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void resolveInput(f.input).then(r => { if (live) setCell(r); }), 150);
    return () => { live = false; clearTimeout(t); };
  }, [f.input]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (choosing) { if (!((e.target as HTMLElement).closest?.(".wgrid-in") && document.querySelector("#scRange .ovb.sel"))) { e.stopPropagation(); setChoosing(false); } return; }
      // Escape in the range picker's grid clears its selection first (the grid's own handler), as in the wizard
      if ((e.target as HTMLElement).closest?.(".wgrid-in") && document.querySelector("#scRange .ovb.sel")) return;
      e.stopPropagation(); if (ranging) setRanging(false); else closeScenario();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [ranging, choosing]);
  const value = values.includes(f.value) ? f.value : values[0] || "";
  const vers = f.versions.filter(v => v === "" || versions.some(x => x.id === v));
  const files = values.length * f.designs.length * vers.length;
  const toggle = <T,>(list: T[], x: T, on: boolean) => on ? [...list.filter(y => y !== x), x] : list.filter(y => y !== x);
  const preview = async () => { if (await previewValue(f.input, value, f.asText)) closeScenario(); };
  // the gate (RC-06): what stopped the last Run, until the fields change
  const [gate, setGate] = useState<{ blocked: GateCell[] } | null>(null), [starting, setStarting] = useState(false);
  const going = useStore(s => !!s.ui.run && (s.ui.run.status === "running" || s.ui.run.status === "cancelling"));
  const run = async () => {
    const t0 = performance.now();
    setStarting(true);
    try { setGate(await startRun(get().ui.scenario, t0)); }
    catch (e) { console.error(e); toast("⚠ The run could not start: " + esc((e as Error).message || e), [], true); }
    finally { setStarting(false); }
  };
  // other fields: the gate is asked again, and "run anyway" is unticked (it answers that gate only)
  useEffect(() => { setGate(null); if (get().ui.scenario.runAnyway) set({ runAnyway: false }); }, [f.input, f.values, f.asText, f.designs.join(), f.versions.join()]);
  return (
    <div className="modal">
      <div className="dlg scdlg" id="scenarioDialog" style={{ width: `min(${ranging || choosing ? 940 : 640}px,94vw)` }}>
        <div className="dlghd"><b>Run for each value</b><span>One file per value: the input cell set to each value and the deck drawn from the recalculated workbook. Nothing is saved – the workbook and the deck stay as they are.</span></div>
        <div className="dlgbody scbody">
          <div className="opthd">Input cell</div>
          <div className="row">
            <input id="scInput" spellCheck={false} placeholder="e.g. Control!B2" value={f.input} onKeyDown={e => e.stopPropagation()} onChange={e => set({ input: (e.target as HTMLInputElement).value })} />
            <button className="btn" id="scSelect" title="Choose the input cell on the workbook's sheets" onClick={() => { setRanging(false); setChoosing(true); }}>Select cell…</button>
            <button className="btn" id="scPick" disabled={!picked} title={picked ? `The cell selected on the slide: ${picked}` : "Select a cell on the slide first, then open this dialog again"} onClick={() => picked && set({ input: picked })}>Pick a cell{picked ? `: ${picked}` : ""}</button>
          </div>
          {choosing && <FromRange onCancel={() => setChoosing(false)} onUse={() => undefined} onCell={(sheet, ref) => { set({ input: inputCellText({ sheet, ref }) }); setChoosing(false); }} />}
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
          {gate && <div className="scgate" id="scGate">
            <b>The run stopped before the first value:</b> {gate.blocked.length} cell{gate.blocked.length === 1 ? "" : "s"} on the slides {gate.blocked.length === 1 ? "is" : "are"} computed otherwise than Excel saved {gate.blocked.length === 1 ? "it" : "them"} – the files would show numbers Excel does not.
            <ul>{gate.blocked.slice(0, 10).map(c => <li key={c.sheet + "!" + c.ref}><b>{c.sheet}!{c.ref}</b> Excel “{shownValue(c.cached)}”, recalculated “{shownValue(c.computed)}”</li>)}{gate.blocked.length > 10 && <li>… {gate.blocked.length - 10} more</li>}</ul>
            <label className="ck"><input type="checkbox" id="scAnyway" checked={f.runAnyway} onChange={e => set({ runAnyway: (e.target as HTMLInputElement).checked })} /> Run anyway and mark these cells (a red corner on the slides, listed in the report)</label>
          </div>}
          <div className="scnote" id="scSummary">{files ? `${values.length} × ${f.designs.length} design${f.designs.length === 1 ? "" : "s"} × ${vers.length} version${vers.length === 1 ? "" : "s"} = ${files} PDF${files === 1 ? "" : "s"}` : "Choose at least one value, design and version."}</div>
        </div>
        <div className="dlgft">
          <label className="scpv">Preview <select id="scValue" disabled={!values.length} value={value} onChange={e => set({ value: (e.target as HTMLSelectElement).value })}>{values.map(v => <option key={v} value={v}>{v}</option>)}</select></label>
          <button className="btn" id="scPreview" disabled={!values.length || !cell?.ok} title="Show this value on the slides (nothing is saved)" onClick={() => void preview()}>Preview</button>
          <span style={{ flex: "1" }} />
          <button className="btn" data-a="cancel" onClick={closeScenario}>Close</button>
          <button className="btn primary" id="scRun" disabled={!files || !cell?.ok || starting || going || (!!gate && !f.runAnyway)} title={going ? "A run is going on: wait for it, or cancel it" : `Make ${files} PDF${files === 1 ? "" : "s"}: one per value × design × version`} onClick={() => void run()}>{starting ? "Starting…" : "Run"}</button>
        </div>
      </div>
    </div>
  );
}

const shownValue = (v: CellValue) => v === null || v === "" ? "empty" : typeof v === "object" ? v.err : String(v);

/** a run's progress, then its report (S8.3, SC-06): a panel over the stage, not a modal – the deck stays editable */
export function ScenarioRun() {
  const R = useStore(s => s.ui.run)!;
  const running = R.status === "running" || R.status === "cancelling", files = R.results.flatMap(x => x.files);
  const failed = R.results.filter(x => x.status === "failed").length;
  const status = R.status === "cancelling" ? `Cancelling after the value being made… ${R.done} of ${R.total}`
    : running ? `Making “${R.shown[R.done] ?? ""}” – ${R.done} of ${R.total} done`
    : (R.status === "cancelled" ? `Cancelled after ${R.done} of ${R.total} values` : `Done: ${R.done} of ${R.total} values`) + ` · ${files.length} file${files.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""} · ${R.seconds} s`;
  return <div className="scrun" id="scRunDialog" role="dialog" aria-label="Run for each value">
    <div className="scrunhd"><b>Run for each value</b><span id="scRunStatus">{status}</span></div>
    <div className="scbar"><i style={{ width: `${R.total ? Math.round(100 * R.done / R.total) : 0}%` }} /></div>
    {R.error && <div className="scbad" id="scRunError">The run stopped: {R.error}</div>}
    <ol className="screport" id="scReport">{R.results.map((x, i) => <li key={i} data-status={x.status}><b>{x.value}</b>{x.status === "ok" ? <small>{x.files.join(" · ")}</small> : <span className="scbad"> failed: {x.error}{x.files.length ? ` (made: ${x.files.join(" · ")})` : ""}</span>}{x.warning && <span className="scbad"> ⚠ {x.warning}</span>}</li>)}</ol>
    {R.kept.length > 0 && <div className="scnote" id="scKept">Kept at Excel's own text in every file (TEXT with this PC's language codes, not recalculated): {R.kept.slice(0, 8).map(c => c.sheet + "!" + c.ref).join(", ")}{R.kept.length > 8 ? ` and ${R.kept.length - 8} more` : ""}</div>}
    {R.marked.length > 0 && <div className="scnote" id="scMarked">Marked with a red corner – computed otherwise than Excel: {R.marked.slice(0, 8).map(c => c.sheet + "!" + c.ref).join(", ")}{R.marked.length > 8 ? ` and ${R.marked.length - 8} more` : ""}</div>}
    <div className="scrunft">{running
      ? <button className="btn" id="scCancel" disabled={R.status === "cancelling"} onClick={cancelRun}>Cancel</button>
      : <>{backend.served && <button className="btn" id="scOpenFolder" onClick={() => void backend.open({ folder: true })}>Open folder</button>}<button className="btn primary" id="scRunClose" onClick={closeRun}>Close</button></>}</div>
  </div>;
}

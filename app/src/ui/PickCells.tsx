/* Choosing cells for a chart or a callout (M9, product owner 2026-10-19: "there should be a wizard, like the rotating
   control cell, never make me type cell names/ranges"): the wizard's sheet view (RangePicker), as Run for each value's
   Select cell… / From a range… – a sheet of the list (hidden sheets are not offered, WB-18), cells dragged or
   Shift+clicked. A chart takes two steps – the numbers, then (or not) their names; a callout quotes one cell. */
import { useEffect, useState } from "react";
import { get, setDialogs, toast, useStore, type PickReq } from "../state/store";
import { core } from "../state/app";
import { RangePicker } from "../wizard/Wizard";
import type { SheetInfo } from "@slide-builder/core/xlsx/sheetview";
import type { DataRef } from "@slide-builder/core/model/types";
import { insertChartRefs, itemOf, itemPatch, quoteCell } from "../editor/charts";
import { addRangeTable } from "../editor/slides";
import { REF_HINT, REF_TITLE, oneCell } from "../editor/chart-panel";
import { applyRef } from "../editor/chart-send";

const close = () => setDialogs({ pick: null });
const TITLE: Record<PickReq["kind"], string> = { chart: "Insert chart", "chart-cells": "Chart: change the cells", cell: "Quote a cell", table: "New table from cells", "chart-ref": "Chart" };

export function PickCellsDialog() {
  const req = useStore(s => s.ui.dialogs.pick)!, wb = useStore(s => s.deck.wb);
  const sheets = (wb?.meta || []).map(m => m.name).filter(n => !(wb?.hiddenSheets || []).includes(n));
  // a callout's cell, a new table's range (S13.4): one step; a chart: the numbers, then their names
  // (the chart panel's cells, S14.5: one step – a series' name is one cell)
  const ref = req.kind === "chart-ref" ? req.ref : null;
  const one = req.kind === "cell" || oneCell(ref), table = req.kind === "table";
  // the sheet shown first: the chart's own (changing its cells), else the first of the list
  const start = () => {
    const it = req.kind === "chart-cells" || req.kind === "chart-ref" ? itemOf(req.id) : null, v = it?.kind === "chart" ? it.values : null;
    const s = !v ? null : "sheet" in v ? v.sheet : get().doc.view?.preset?.tables.find(t => t.id === v.table)?.sheet ?? null;
    return s && sheets.includes(s) ? s : sheets[0] || "";
  };
  const [sheet, setSheet] = useState(start), [info, setInfo] = useState<SheetInfo | null>(null), [err, setErr] = useState("");
  const [range, setRange] = useState<string | null>(null);
  // a chart: the numbers first, then their names
  const [values, setValues] = useState<DataRef | null>(null);
  useEffect(() => {
    if (!wb || !sheet) return;
    let live = true; setInfo(null); setErr(""); setRange(null);
    void core().call("getSheetMeta", { book: wb.book, names: [sheet], load: true })
      .then(m => { if (!live) return; const S = m.sheets[0]; if (S && !S.error) setInfo(S); else setErr(S?.error || "the sheet is not loaded"); })
      .catch(e => { if (live) setErr(String((e as Error)?.message || e)); });
    return () => { live = false; };
  }, [sheet, wb?.book]);
  // 2: nothing to choose from (no workbook, no sheet): no dialog left open behind the page
  useEffect(() => { if (!wb || !sheets.length) { toast("Open a workbook first – its sheets are where the cells are chosen."); close(); } }, [!!wb, sheets.length]);
  // 1: Escape: the grid's own selection first, then back from the names to the numbers, then the dialog closes
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement).closest?.(".wgrid-in") && document.querySelector("#pkRange .ovb.sel")) return;
      e.stopPropagation();
      if (values) { setValues(null); setRange(null); } else close();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [values]);
  if (!wb || !sheets.length) return null;
  const finish = (labels: DataRef | null, v = values) => {
    if (!v) return;
    if (req.kind === "chart") insertChartRefs(v, labels);
    else if (req.kind === "chart-cells") itemPatch("Chart cells", req.id, { values: v, labels, attach: null });
    close();
  };
  const use = (r: string | null) => {
    if (!r) return;
    if (req.kind === "chart-ref") { applyRef(req.id, req.ref, { sheet, range: one ? r.split(":")[0] : r }); close(); return; }
    if (one) { if (req.kind === "cell") quoteCell(req.id, sheet, r.split(":")[0]); close(); return; }
    if (table) { addRangeTable(sheet, r); close(); return; }
    if (!values) { setValues({ sheet, range: r }); setRange(null); return; }       // step 1 done: now the names
    finish({ sheet, range: r });
  };
  const hint = ref ? (ref.what === "name" ? "Click the cell" : "Drag across the cells") : one ? "Click the cell to quote" : table ? "Drag across the cells of the table" : !values ? "Drag across the numbers of the chart" : "Drag across their names (or go on without)";
  return (
    <div className="modal">
      <div className="dlg pkdlg" id="pickCells" style={{ width: "min(940px,94vw)" }}>
        <div className="dlghd"><b>{ref ? REF_TITLE[ref.what] : TITLE[req.kind]}</b><span>{ref ? REF_HINT[ref.what] : one ? "The callout shows what the cell shows, and follows the workbook when it changes." : table ? "The table joins the deck and this slide; it follows the workbook when it changes." : !values ? "Step 1 of 2: the numbers. A pie gets one slice per number; blank cells and text are left out." : `Step 2 of 2: the names of the ${values.range} numbers – one name per number, in the same order.`}</span></div>
        <div className="dlgbody">
          <div className="scrange" id="pkRange">
            <div className="row">
              <label>Sheet</label>
              <select id="pkSheet" value={sheet} onChange={e => setSheet((e.target as HTMLSelectElement).value)}>{sheets.map(n => <option key={n} value={n}>{n}</option>)}</select>
              <span className="scnote">{range ? <>Selected <b id="pkSel">{range}</b></> : hint}</span>
            </div>
            {err && <div className="scbad">{err}</div>}
            <div className="wgridwrap scgrid">{info ? <RangePicker key={sheet + (one ? "|cell" : "") + (values ? "|names" : "")} book={wb.book} S={info} single={one} onSel={setRange} onEnter={r => use(r)} /> : !err && <div className="scnote" style={{ padding: "12px" }}>Reading “{sheet}”…</div>}</div>
          </div>
        </div>
        <div className="dlgft">
          {values && <button className="btn" id="pkBack" onClick={() => { setValues(null); setRange(null); }}>Back</button>}
          <span style={{ flex: "1" }} />
          <button className="btn" data-a="cancel" onClick={close}>Cancel</button>
          {!one && !table && !ref && values && <button className="btn" id="pkNoNames" onClick={() => finish(null)} title="The names beside the numbers (the column on their left, the row above), or 1, 2, 3…">Without names</button>}
          <button className="btn primary" id="pkUse" disabled={!range} onClick={() => use(range)}>{ref ? "Use these cells" : one ? "Quote this cell" : table ? "Add table" : !values ? "Next: their names" : req.kind === "chart" ? "Insert chart" : "Use these cells"}</button>
        </div>
      </div>
    </div>
  );
}
